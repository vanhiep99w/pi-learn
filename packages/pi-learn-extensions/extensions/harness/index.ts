import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "@sinclair/typebox";
import { DynamicBorder, getMarkdownTheme, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Key, Markdown, matchesKey, type SelectItem, SelectList, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { registerHarnessWikiCommands } from "./wiki-commands.js";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_API = resolve(EXTENSION_DIR, "../../../harness-runtime/src/api.js");
const DEFAULT_LAST = "5";

type HarnessRun = {
  stdout: string;
  stderr: string;
};

type HarnessProposal = {
  id: string;
  title: string;
  status?: string;
  target?: string;
  risk?: string;
  evidenceCount?: number;
  filePath?: string;
};

type ProposalAction = "approve" | "apply" | "reject" | "back";

export default function harnessExtension(pi: ExtensionAPI) {
  registerHarnessWikiCommands(pi);

  pi.registerTool({
    name: "harness_import_llm_reflection",
    label: "Harness Import Reflection",
    description: "Import a Pi-session LLM reflection JSON response into private Harness draft proposals. Use only after /harness-improve asks you to create evidence-backed proposals.",
    promptSnippet: "Call `harness_import_llm_reflection` with the final JSON reflection proposals when asked by /harness-improve.",
    promptGuidelines: [
      "Use harness_import_llm_reflection only for Pi Harness reflection proposals requested by the user or extension.",
      "The proposals must include evidence refs, targetFiles, risk, testPlan, and rollbackPlan.",
    ],
    parameters: Type.Object({
      response: Type.Optional(Type.String({ description: "Full JSON string with shape { proposals: [...] }" })),
      proposals: Type.Optional(Type.Array(Type.Any(), { description: "Proposal objects; used when response is not supplied." })),
    }),
    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const cwd = ctx?.cwd ?? process.cwd();
      const payload = params?.response ?? JSON.stringify({ proposals: params?.proposals ?? [] });
      const run = await runHarness({ cwd, signal: ctx?.signal } as ExtensionCommandContext, ["reflect", "--response", payload, "--project", cwd, "--json"]);
      const output = parseJson(run.stdout);
      const written = output?.written ?? [];
      const skipped = output?.skipped ?? [];
      return {
        content: [{
          type: "text",
          text: [
            `Imported Pi-session LLM reflection proposals.`,
            `Written: ${written.length}`,
            `Skipped: ${skipped.length}`,
            ...written.map((p: any) => `- ${p.id} [${p.target}/${p.risk}] ${p.title}`),
          ].join("\n"),
        }],
        details: output,
      };
    },
  });

  pi.registerCommand("harness", {
    description: "Open the Harness status and Markdown report dashboard. Usage: /harness [last]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const last = firstArg(args) ?? DEFAULT_LAST;
      const [sessionsRun, reportRun, automationRun] = await Promise.all([
        runHarness(ctx, ["sessions", "--project", ctx.cwd, "--last", last, "--json"]),
        runHarness(ctx, ["report", "--project", ctx.cwd, "--last", last, "--json"]),
        runHarness(ctx, ["automation-status", "--project", ctx.cwd, "--json"]),
      ]);
      const sessionsOutput = parseJson(sessionsRun.stdout);
      const reportOutput = parseJson(reportRun.stdout);
      const automationOutput = parseJson(automationRun.stdout);
      const reportPath = reportOutput?.report?.latestPath;
      if (!reportPath) return notifyOrLog(ctx, "Harness report did not return latestPath.", "warning");

      const reportMarkdown = await readFile(reportPath, "utf8");
      const dashboardMarkdown = formatHarnessDashboard({
        last,
        sessionsOutput,
        reportOutput,
        automationOutput,
        reportPath,
        reportMarkdown,
      });

      if (ctx.mode === "tui" && ctx.hasUI) {
        await showHarnessDashboard(ctx, {
          last,
          markdown: dashboardMarkdown,
          projectName: sessionsOutput?.project?.projectKey ?? "current project",
          sessionCount: sessionsOutput?.sessions?.length ?? 0,
          warningCount: countHarnessWarnings(reportOutput?.results ?? []),
          automationAllowed: Boolean(automationOutput?.status?.allowed),
        });
      } else if (ctx.hasUI && ctx.ui?.editor) {
        await ctx.ui.editor(`Harness dashboard: ${reportPath}`, dashboardMarkdown);
      } else {
        console.log(dashboardMarkdown);
      }
    }),
  });

  pi.registerCommand("harness-eval", {
    description: "Run Harness eval suite. Usage: /harness-eval [scenario|proposal-id]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const first = firstArg(args);
      const cliArgs = ["eval", "--project", ctx.cwd, "--json"];
      if (first) {
        if (/^P-\d+$/i.test(first)) cliArgs.splice(1, 0, first.toUpperCase());
        else cliArgs.push("--scenario", first);
      }
      const run = await runHarness(ctx, cliArgs);
      const output = parseJson(run.stdout);
      const lines = [
        `passed: ${output?.summary?.passed ?? 0}`,
        `failed: ${output?.summary?.failed ?? 0}`,
        `skipped: ${output?.summary?.skipped ?? 0}`,
        `report: ${output?.paths?.latestMarkdownPath ?? "(missing)"}`,
        "",
        ...(output?.results ?? []).map((result: any) => `${result.scenario}: ${result.status} — ${result.message ?? ""}`),
      ].join("\n");
      await showText(ctx, "🧪 Harness eval", lines);
    }),
  });

  const harnessImproveHandler = async (args: string | undefined, ctx: ExtensionCommandContext) => withHarnessErrors(ctx, async () => {
    const last = firstArg(args) ?? DEFAULT_LAST;
    const run = await runHarness(ctx, ["reflect", "--project", ctx.cwd, "--last", last, "--json"]);
    const output = parseJson(run.stdout);
    const promptPath = output?.reflection?.latestPath;
    if (!promptPath) return notifyOrLog(ctx, "Harness improve did not return latestPath.", "warning");
    const prompt = await readFile(promptPath, "utf8");
    const userMessage = [
      "Review the Harness improvement prompt below using only its normalized evidence.",
      "Do not read raw session logs. Read no other files except an exact normalizedRef line explicitly allowed by the improvement prompt.",
      "Call `harness_import_llm_reflection` with `{ \"proposals\": [...] }`; if no strong evidence-backed proposals exist, call it with `{ \"proposals\": [] }`.",
      "Do not reply with chat prose.",
      "",
      prompt,
    ].join("\n");

    if (ctx.isIdle()) {
      pi.sendUserMessage(userMessage);
    } else {
      pi.sendUserMessage(userMessage, { deliverAs: "followUp" });
    }
    notifyOrLog(ctx, `Queued Harness improvement review on current Pi model from: ${promptPath}`, "info");
  });

  pi.registerCommand("harness-improve", {
    description: "Use the current Pi session model to create Harness improvement proposals. Usage: /harness-improve [last]",
    handler: harnessImproveHandler,
  });

  pi.registerCommand("harness-proposals", {
    description: "Review, approve, or reject Harness proposals in one interactive modal",
    handler: async (_args, ctx) => withHarnessErrors(ctx, async () => {
      await reviewHarnessProposals(ctx);
    }),
  });

  pi.registerCommand("harness-apply", {
    description: "Apply an approved Harness proposal with a JSON Patch section. Usage: /harness-apply P-0001 [--allow-dirty] [--commit]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const parts = splitArgs(args ?? "");
      const id = parts[0];
      const flags = parts.slice(1);
      if (!id) return notifyOrLog(ctx, "Usage: /harness-apply P-0001 [--allow-dirty] [--commit]", "warning");
      if (ctx.hasUI && ctx.ui?.confirm) {
        const dirty = flags.includes("--allow-dirty") ? " with dirty-worktree override" : "";
        const ok = await ctx.ui.confirm("Apply Harness proposal", `Apply ${id}${dirty} on a harness/* branch? This may edit files listed in the proposal patch.`);
        if (!ok) return notifyOrLog(ctx, `Harness apply cancelled: ${id}`, "info");
      }
      await applyHarnessProposal(ctx, id, flags);
    }),
  });

  pi.registerCommand("harness-mark", {
    description: "Mark the current session. Usage: /harness-mark success|failure|note [text]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const parts = splitArgs(args ?? "");
      const kind = parts[0] ?? "note";
      if (!["success", "failure", "note"].includes(kind)) {
        return notifyOrLog(ctx, "Usage: /harness-mark success|failure|note [text]", "warning");
      }
      let text = parts.slice(1).join(" ");
      if (kind === "note" && !text.trim() && ctx.hasUI && ctx.ui?.editor) {
        text = (await ctx.ui.editor("📝 Harness note", "")) ?? "";
      }
      const leafId = ctx.sessionManager?.getLeafId?.();
      if (leafId && (kind === "success" || kind === "failure")) {
        pi.setLabel(leafId, kind);
      }
      if (kind === "note") {
        if (!text.trim()) return;
        pi.appendEntry("harness-note", {
          text: text.trim(),
          cwd: ctx.cwd,
          createdAt: new Date().toISOString(),
        });
      } else {
        pi.appendEntry("harness-tag", {
          tag: kind,
          reason: text,
          leafId,
          cwd: ctx.cwd,
          createdAt: new Date().toISOString(),
        });
      }
      notifyOrLog(ctx, `Harness mark recorded: ${kind}${text ? ` — ${text}` : ""}`, "info");
    }),
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui?.notify("🧪 Harness: /harness, /harness-improve, /harness-proposals, /harness-wiki-ask", "info");
  });
}

function countHarnessWarnings(results: any[]) {
  return results.reduce((sum: number, result: any) => sum + (result.warningsCount ?? result.warnings?.length ?? 0), 0);
}

function formatHarnessDashboard({
  last,
  sessionsOutput,
  reportOutput,
  automationOutput,
  reportPath,
  reportMarkdown,
}: {
  last: string;
  sessionsOutput: any;
  reportOutput: any;
  automationOutput: any;
  reportPath: string;
  reportMarkdown: string;
}) {
  const sessions = sessionsOutput?.sessions ?? [];
  const results = reportOutput?.results ?? [];
  const warningCount = countHarnessWarnings(results);
  const automation = automationOutput?.status;
  const recentWarnings = results
    .flatMap((result: any) => (result.warnings ?? []).slice(0, 3).map((warning: any) => ({
      sessionId: result.sessionId,
      code: warning.code,
      message: warning.message,
    })))
    .slice(0, 10);
  const renderedReport = reportMarkdown.trim().replace(/^#\s+/, "## ");

  return [
    "## Trạng thái hiện tại",
    `- **Project:** ${markdownCode(sessionsOutput?.project?.projectRoot ?? "(unknown)")}`,
    `- **Session source:** ${markdownCode(sessionsOutput?.sessionDir ?? "(unknown)")}`,
    `- **Session gần đây:** **${sessions.length}/${last}**`,
    `- **Warnings:** **${warningCount}**`,
    `- **Automation:** **${automation?.allowed ? "allowed" : "disabled/skipped"}** — ${markdownInline(automation?.reason ?? "unknown")}`,
    `- **Report:** ${markdownCode(reportPath)}`,
    "",
    "## Session gần đây",
    ...(sessions.length
      ? sessions.slice(0, 5).map((session: any) => `- ${markdownInline(session.timestamp ?? session.mtime ?? "unknown time")} — ${markdownCode(session.sessionId ?? "unknown")}`)
      : ["_Không tìm thấy session nào._"]),
    "",
    "## Warning gần đây",
    ...(recentWarnings.length
      ? recentWarnings.map((warning: any) => `- ${markdownCode(warning.sessionId ?? "unknown")} · **${markdownInline(warning.code ?? "warning")}** — ${markdownInline(warning.message ?? "")}`)
      : ["_Không có parser/normalizer warning._"]),
    "",
    "---",
    "",
    renderedReport,
  ].join("\n").trimEnd();
}

async function showHarnessDashboard(
  ctx: ExtensionCommandContext,
  options: {
    last: string;
    markdown: string;
    projectName: string;
    sessionCount: number;
    warningCount: number;
    automationAllowed: boolean;
  },
) {
  if (ctx.mode !== "tui" || !ctx.hasUI) return;

  await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
    const panel = new Box(2, 1, (text: string) => theme.bg("customMessageBg", text));
    panel.addChild(new DynamicBorder((text: string) => theme.fg("borderAccent", text)));
    panel.addChild(new Text(theme.fg("customMessageLabel", theme.bold("HARNESS  /  DASHBOARD")), 0, 0));
    panel.addChild(new Text(theme.fg("accent", theme.bold(options.projectName)), 0, 0));
    panel.addChild(new Text([
      theme.fg("muted", `${options.sessionCount}/${options.last} sessions`),
      theme.fg(options.warningCount ? "warning" : "success", `${options.warningCount} warnings`),
      theme.fg(options.automationAllowed ? "success" : "dim", `automation ${options.automationAllowed ? "allowed" : "off"}`),
    ].join(theme.fg("dim", "  •  ")), 0, 0));

    const dashboard = new ScrollableMarkdown(
      options.markdown,
      () => Math.max(1, Math.min(30, Math.floor(tui.terminal.rows * 0.95) - 9)),
      (text: string) => theme.fg("dim", text),
    );
    panel.addChild(dashboard);
    panel.addChild(new Text(
      theme.fg("dim", "↑↓ cuộn  •  PgUp/PgDn hoặc Ctrl+U/D cuộn nhanh  •  Home/End đầu/cuối  •  Esc đóng"),
      0,
      1,
    ));
    panel.addChild(new DynamicBorder((text: string) => theme.fg("borderAccent", text)));

    return {
      render: (width: number) => panel.render(width),
      invalidate: () => panel.invalidate(),
      handleInput: (data: string) => {
        const cancel = keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"));
        if (cancel || matchesKey(data, "q")) {
          done(undefined);
          return;
        }
        if (keybindings.matches(data, "tui.select.up") || matchesKey(data, Key.up)) dashboard.scroll(-3);
        else if (keybindings.matches(data, "tui.select.down") || matchesKey(data, Key.down)) dashboard.scroll(3);
        else if (keybindings.matches(data, "tui.select.pageUp") || matchesKey(data, Key.ctrl("u"))) dashboard.scroll(-12);
        else if (keybindings.matches(data, "tui.select.pageDown") || matchesKey(data, Key.ctrl("d")) || matchesKey(data, Key.space)) dashboard.scroll(12);
        else if (matchesKey(data, Key.home)) dashboard.scrollToStart();
        else if (matchesKey(data, Key.end)) dashboard.scrollToEnd();
        tui.requestRender();
      },
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: "92%",
      minWidth: 60,
      maxHeight: "95%",
      margin: 1,
    },
  });
}

function markdownCode(value: unknown) {
  return `\`${markdownInline(value).replace(/`/g, "'")}\``;
}

function markdownInline(value: unknown) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

async function reviewHarnessProposals(ctx: ExtensionCommandContext) {
  const run = await runHarness(ctx, ["proposals", "--project", ctx.cwd, "--json"]);
  const output = parseJson(run.stdout);
  const proposals = (output?.proposals ?? []) as HarnessProposal[];
  if (!proposals.length) {
    notifyOrLog(ctx, "No Harness proposals found. Run /harness-improve first.", "info");
    return;
  }

  if (!ctx.hasUI) {
    printProposalList(proposals);
    return;
  }

  let proposal = await selectHarnessProposal(ctx, proposals);
  while (proposal) {
    const markdown = proposal.filePath ? await readFile(proposal.filePath, "utf8") : "";
    const action = await selectProposalAction(ctx, proposal, markdown);
    if (!action) return;

    if (action === "back") {
      proposal = await selectHarnessProposal(ctx, proposals);
      continue;
    }

    if (action === "apply") {
      const confirmed = await confirmProposalApply(ctx, proposal, markdown);
      if (!confirmed) continue;
      if (proposal.status !== "approved") {
        await transitionHarnessProposal(ctx, proposal.id, "approve", { notify: false });
      }
      await applyHarnessProposal(ctx, proposal.id, []);
      return;
    }

    const confirmed = await confirmProposalTransition(ctx, proposal, action);
    if (!confirmed) continue;
    await transitionHarnessProposal(ctx, proposal.id, action);
    return;
  }
}

async function selectHarnessProposal(ctx: ExtensionCommandContext, proposals: HarnessProposal[]) {
  const items: SelectItem[] = proposals.map((proposal) => ({
    value: proposal.id,
    label: `${proposal.id}  ${proposal.title}`,
    description: [
      (proposal.status ?? "draft").toUpperCase(),
      (proposal.target ?? "unknown").toUpperCase(),
      `RISK ${(proposal.risk ?? "unknown").toUpperCase()}`,
    ].join("  •  "),
  }));
  const selected = await selectModalItem(ctx, {
    title: "Chọn proposal để review",
    body: `${proposals.length} proposal khả dụng. Xem nội dung và quyết định approve hoặc reject.`,
    items,
  });
  return proposals.find((proposal) => proposal.id === selected);
}

async function selectProposalAction(
  ctx: ExtensionCommandContext,
  proposal: HarnessProposal,
  markdown: string,
): Promise<ProposalAction | undefined> {
  const items: SelectItem[] = [];
  if (proposal.status !== "applied") {
    items.push({
      value: "approve",
      label: "✓ Approve proposal",
      description: "Đánh dấu approved để proposal có thể được apply.",
    });
    if (hasMachineApplicablePatch(markdown)) {
      items.push({
        value: "apply",
        label: proposal.status === "approved" ? "⚡ Apply proposal" : "⚡ Approve & Apply",
        description: proposal.status === "approved"
          ? "Áp dụng patch trên branch harness của proposal."
          : "Approve và áp dụng patch ngay sau bước xác nhận.",
      });
    }
    items.push({
      value: "reject",
      label: "✕ Reject proposal",
      description: "Đánh dấu rejected; vẫn có thể review và approve lại sau.",
    });
  }
  items.push({
    value: "back",
    label: "← Chọn proposal khác",
    description: "Quay lại danh sách proposal.",
  });
  const selected = await selectModalItem(ctx, {
    title: `${proposal.id} — ${proposal.title}`,
    body: formatProposalPreview(proposal, markdown),
    items,
    selectedValue: proposal.status === "applied" ? "back" : "approve",
    horizontal: true,
  });
  return selected as ProposalAction | undefined;
}

async function selectModalItem(
  ctx: ExtensionCommandContext,
  options: { title: string; body: string; items: SelectItem[]; selectedValue?: string; horizontal?: boolean },
): Promise<string | undefined> {
  if (ctx.mode !== "tui") {
    if (!ctx.hasUI || !ctx.ui?.select) return undefined;
    const labels = options.items.map((item) => `${item.label} — ${item.description ?? ""}`);
    const chosen = await ctx.ui.select(options.title, labels);
    return chosen ? options.items[labels.indexOf(chosen)]?.value : undefined;
  }

  return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
    const panel = new Box(2, 1, (text: string) => theme.bg("customMessageBg", text));
    panel.addChild(new DynamicBorder((text: string) => theme.fg("borderAccent", text)));
    panel.addChild(new Text(theme.fg("customMessageLabel", theme.bold("HARNESS  /  PROPOSAL REVIEW")), 0, 0));
    panel.addChild(new Text(theme.fg("accent", theme.bold(options.title)), 0, 0));
    const detailText = new ScrollableText(
      theme.fg("customMessageText", options.body),
      9,
      (text: string) => theme.fg("dim", text),
    );
    panel.addChild(detailText);

    const selectedInModal = (text: string) => theme.fg("accent", theme.bold(text));
    const list = options.horizontal ? undefined : new SelectList(options.items, Math.min(options.items.length, 8), {
      selectedPrefix: selectedInModal,
      selectedText: selectedInModal,
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    const selectedIndex = options.items.findIndex((item) => item.value === options.selectedValue);
    if (list && selectedIndex >= 0) list.setSelectedIndex(selectedIndex);
    let actionBar: HorizontalActionBar | undefined;
    if (list) {
      list.onSelect = (item) => done(item.value);
      list.onCancel = () => done(undefined);
      panel.addChild(list);
    } else {
      actionBar = new HorizontalActionBar(
        options.items,
        options.selectedValue,
        selectedInModal,
        (text) => theme.fg("muted", text),
        done,
      );
      panel.addChild(actionBar);
    }
    panel.addChild(new Text(
      theme.fg("dim", options.horizontal
        ? "↑↓ cuộn chi tiết    ←→ chọn action    Enter xác nhận    Esc đóng"
        : "PgUp/PgDn hoặc Ctrl+U/D cuộn chi tiết    ↑↓ chọn    Enter xác nhận    Esc đóng"),
      0,
      1,
    ));
    panel.addChild(new DynamicBorder((text: string) => theme.fg("borderAccent", text)));

    return {
      render: (width: number) => panel.render(width),
      invalidate: () => panel.invalidate(),
      handleInput: (data: string) => {
        const pageUp = keybindings.matches(data, "tui.select.pageUp") || matchesKey(data, Key.ctrl("u"));
        const pageDown = keybindings.matches(data, "tui.select.pageDown") || matchesKey(data, Key.ctrl("d")) || matchesKey(data, Key.space);
        const detailUp = options.horizontal && (keybindings.matches(data, "tui.select.up") || matchesKey(data, Key.up));
        const detailDown = options.horizontal && (keybindings.matches(data, "tui.select.down") || matchesKey(data, Key.down));
        if (pageUp || detailUp) detailText.scroll(-7);
        else if (pageDown || detailDown) detailText.scroll(7);
        else if (options.horizontal) actionBar?.handleInput(data);
        else {
          list?.handleInput(data);
        }
        tui.requestRender();
      },
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: 92,
      maxHeight: "95%",
      margin: 1,
    },
  });
}

class ScrollableMarkdown {
  private readonly markdown: Markdown;
  private readonly maxVisibleLines: () => number;
  private readonly statusFn: (text: string) => string;
  private offset = 0;

  constructor(value: string, maxVisibleLines: () => number, statusFn: (text: string) => string) {
    this.markdown = new Markdown(value, 0, 0, getMarkdownTheme());
    this.maxVisibleLines = maxVisibleLines;
    this.statusFn = statusFn;
  }

  render(width: number): string[] {
    const lines = this.markdown.render(width);
    const viewportSize = this.maxVisibleLines();
    const maxOffset = Math.max(0, lines.length - viewportSize);
    this.offset = Math.min(this.offset, maxOffset);
    const visible = lines.slice(this.offset, this.offset + viewportSize);
    while (visible.length < viewportSize) visible.push("");
    const status = lines.length > viewportSize
      ? `↕ Nội dung ${this.offset + 1}-${Math.min(this.offset + viewportSize, lines.length)}/${lines.length}`
      : "";
    return [...visible, this.statusFn(status)];
  }

  scroll(delta: number) {
    this.offset = Math.max(0, this.offset + delta);
  }

  scrollToStart() {
    this.offset = 0;
  }

  scrollToEnd() {
    this.offset = Number.MAX_SAFE_INTEGER;
  }

  invalidate() {
    this.markdown.invalidate();
  }
}

class ScrollableText {
  private readonly text: Text;
  private readonly maxVisibleLines: number;
  private readonly statusFn: (text: string) => string;
  private offset = 0;

  constructor(value: string, maxVisibleLines: number, statusFn: (text: string) => string) {
    this.text = new Text(value, 0, 0);
    this.maxVisibleLines = maxVisibleLines;
    this.statusFn = statusFn;
  }

  render(width: number): string[] {
    const lines = this.text.render(width);
    const maxOffset = Math.max(0, lines.length - this.maxVisibleLines);
    this.offset = Math.min(this.offset, maxOffset);
    const visible = lines.slice(this.offset, this.offset + this.maxVisibleLines);
    const status = lines.length > this.maxVisibleLines
      ? `↕ Chi tiết ${this.offset + 1}-${Math.min(this.offset + this.maxVisibleLines, lines.length)}/${lines.length}`
      : "";
    return [...visible, this.statusFn(status)];
  }

  scroll(delta: number) {
    this.offset = Math.max(0, this.offset + delta);
    this.text.invalidate();
  }

  invalidate() {
    this.text.invalidate();
  }
}

class HorizontalActionBar {
  private readonly items: SelectItem[];
  private readonly selectedStyle: (text: string) => string;
  private readonly normalStyle: (text: string) => string;
  private readonly done: (value: string | undefined) => void;
  private selectedIndex: number;

  constructor(
    items: SelectItem[],
    selectedValue: string | undefined,
    selectedStyle: (text: string) => string,
    normalStyle: (text: string) => string,
    done: (value: string | undefined) => void,
  ) {
    this.items = items;
    this.selectedStyle = selectedStyle;
    this.normalStyle = normalStyle;
    this.done = done;
    const initialIndex = items.findIndex((item) => item.value === selectedValue);
    this.selectedIndex = initialIndex >= 0 ? initialIndex : 0;
  }

  render(width: number): string[] {
    const line = this.items.map((item, index) => {
      const label = ` ${item.label} `;
      return index === this.selectedIndex
        ? this.selectedStyle(label)
        : this.normalStyle(label);
    }).join("  ");
    return [truncateToWidth(line, width, "")];
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.left)) {
      this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
    } else if (matchesKey(data, Key.right)) {
      this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
    } else if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
      this.done(this.items[this.selectedIndex]?.value);
    } else if (matchesKey(data, Key.escape)) {
      this.done(undefined);
    }
  }

  invalidate() {}
}

async function confirmProposalTransition(
  ctx: ExtensionCommandContext,
  proposal: HarnessProposal,
  action: "approve" | "reject",
) {
  if (!ctx.hasUI || !ctx.ui?.confirm) return true;
  const isApprove = action === "approve";
  return ctx.ui.confirm(
    isApprove ? "✓ Approve Harness proposal" : "✕ Reject Harness proposal",
    isApprove
      ? `Approve ${proposal.id}? Sau đó bạn có thể chạy /harness-apply ${proposal.id}.`
      : `Reject ${proposal.id}? Proposal sẽ không thể apply cho đến khi được approve lại.`,
  );
}

async function confirmProposalApply(
  ctx: ExtensionCommandContext,
  proposal: HarnessProposal,
  markdown: string,
) {
  if (!ctx.hasUI || !ctx.ui?.confirm) return true;
  const isApproved = proposal.status === "approved";
  const targetFiles = compactMarkdownSection(markdown, "Target files", 160) || "TBD";
  return ctx.ui.confirm(
    isApproved ? "⚡ Apply Harness proposal" : "⚡ Approve & Apply Harness proposal",
    [
      isApproved
        ? `Apply ${proposal.id} ngay bây giờ?`
        : `Approve ${proposal.id} và apply ngay bây giờ?`,
      `Target files: ${targetFiles}`,
      "Harness sẽ yêu cầu git worktree sạch và tạo/sử dụng branch harness/*.",
    ].join("\n"),
  );
}

async function transitionHarnessProposal(
  ctx: ExtensionCommandContext,
  id: string,
  action: "approve" | "reject",
  options: { notify?: boolean } = {},
) {
  const run = await runHarness(ctx, [action, id, "--project", ctx.cwd, "--json"]);
  const output = parseJson(run.stdout);
  const status = output?.proposal?.status ?? (action === "approve" ? "approved" : "rejected");
  if (options.notify !== false) {
    notifyOrLog(ctx, `Harness proposal ${output?.proposal?.id ?? id}: ${status}`, action === "approve" ? "info" : "warning");
  }
  return output;
}

async function applyHarnessProposal(ctx: ExtensionCommandContext, id: string, flags: string[]) {
  const run = await runHarness(ctx, ["apply", id, ...flags, "--project", ctx.cwd, "--json"]);
  const output = parseJson(run.stdout);
  const lines = [
    `${output?.proposal?.id ?? id}: ${output?.proposal?.status ?? "applied"}`,
    output?.branchName ? `branch: ${output.branchName}` : undefined,
    output?.changedPaths?.length ? `changed: ${output.changedPaths.join(", ")}` : undefined,
    output?.diff ? `\nDiff\n${output.diff}` : undefined,
  ].filter(Boolean).join("\n");
  await showText(ctx, `🧩 Harness apply ${id}`, lines);
  return output;
}

function formatProposalPreview(proposal: HarnessProposal, markdown: string) {
  const problem = compactMarkdownSection(markdown, "Problem", 1200) || "Không có mô tả.";
  const proposedChange = compactMarkdownSection(markdown, "Proposed change", 1200) || "Không có mô tả.";
  const targetFiles = compactMarkdownSection(markdown, "Target files") || "TBD";
  return [
    `STATUS  ${(proposal.status ?? "draft").toUpperCase()}    TARGET  ${(proposal.target ?? "unknown").toUpperCase()}    RISK  ${(proposal.risk ?? "unknown").toUpperCase()}    EVIDENCE  ${proposal.evidenceCount ?? "?"}`,
    "",
    "VẤN ĐỀ",
    problem,
    "",
    "THAY ĐỔI ĐỀ XUẤT",
    proposedChange,
    "",
    "TARGET FILES",
    targetFiles,
  ].join("\n");
}

function compactMarkdownSection(markdown: string, heading: string, maxLength = 240) {
  const section = extractMarkdownSection(markdown, heading)
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return section.length > maxLength ? `${section.slice(0, maxLength - 1).trimEnd()}…` : section;
}

function hasMachineApplicablePatch(markdown: string) {
  const section = extractMarkdownSection(markdown, "Patch");
  if (!section.trim()) return false;
  const fenced = section.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i)?.[1] ?? section.trim();
  try {
    const parsed = JSON.parse(fenced);
    const patches = Array.isArray(parsed) ? parsed : [parsed];
    return patches.length > 0 && patches.every((patch) =>
      patch
      && typeof patch.path === "string"
      && typeof patch.oldText === "string"
      && typeof patch.newText === "string");
  } catch {
    return false;
  }
}

function extractMarkdownSection(markdown: string, heading: string) {
  const marker = new RegExp(`^## ${heading}\\s*$`, "m");
  const match = marker.exec(markdown);
  if (!match) return "";
  const sectionStart = match.index + match[0].length;
  const remaining = markdown.slice(sectionStart).replace(/^\r?\n/, "");
  const nextHeading = remaining.search(/^## /m);
  return (nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining).trim();
}

function printProposalList(proposals: HarnessProposal[]) {
  console.log(proposals.map((proposal) => [
    `${proposal.id} [${proposal.status ?? "draft"}/${proposal.target ?? "unknown"}/${proposal.risk ?? "unknown"}] ${proposal.title}`,
    proposal.filePath ? `  ${proposal.filePath}` : undefined,
  ].filter(Boolean).join("\n")).join("\n"));
}

async function withHarnessErrors(ctx: ExtensionCommandContext, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyOrLog(ctx, `Harness error: ${message}`, "error");
  }
}

async function runHarness(ctx: ExtensionCommandContext, args: string[]): Promise<HarnessRun> {
  const apiUrl = pathToFileURL(RUNTIME_API);
  apiUrl.searchParams.set("mtime", String((await stat(RUNTIME_API)).mtimeMs));
  const api = await import(apiUrl.href);
  const { command, rest, options } = parseHarnessArgs(args, ctx.cwd);
  let output: any;

  switch (command) {
    case "report":
      output = await api.report(options);
      break;
    case "sessions":
      output = api.sessions(options);
      break;
    case "scan":
      output = await api.scan(options);
      break;
    case "reflect":
      output = options.response !== undefined
        ? api.importReflectionResponse(options)
        : options.importFile
          ? api.importReflection(options)
          : await api.reflect(options);
      break;
    case "propose":
      output = await api.propose(options);
      break;
    case "proposals":
      output = api.proposals(options);
      break;
    case "approve":
      output = api.approve({ ...options, id: rest[0] });
      break;
    case "reject":
      output = api.reject({ ...options, id: rest[0] });
      break;
    case "apply":
      output = api.apply({ ...options, id: rest[0] });
      break;
    case "history":
      output = api.history({ ...options, id: rest[0] });
      break;
    case "automation-status":
      output = api.automationStatus(options);
      break;
    case "automate":
      output = await api.automate(options);
      break;
    case "eval":
      output = await api.evalHarness({ ...options, id: rest[0] });
      break;
    default:
      throw new Error(`Unsupported Harness extension operation: ${command}`);
  }

  return { stdout: JSON.stringify(output, null, 2), stderr: "" };
}

function parseHarnessArgs(args: string[], cwd: string) {
  const positional: string[] = [];
  const options: any = { project: cwd };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json":
        break;
      case "--project":
        options.project = args[++i];
        break;
      case "--last": {
        const value = Number(args[++i]);
        if (!Number.isFinite(value) || value < 1) throw new Error("--last must be a positive number");
        options.maxSessionsPerScan = value;
        break;
      }
      case "--target":
        options.target = args[++i];
        break;
      case "--rules":
        options.rules = true;
        break;
      case "--llm":
        options.llm = true;
        break;
      case "--import":
        options.importFile = args[++i];
        break;
      case "--response":
        options.response = args[++i];
        break;
      case "--scenario":
        options.scenario = args[++i];
        break;
      case "--allow-dirty":
        options.allowDirty = true;
        break;
      case "--commit":
        options.commit = true;
        break;
      default:
        positional.push(arg);
    }
  }
  return { command: positional[0], rest: positional.slice(1), options };
}

async function showText(ctx: ExtensionCommandContext, title: string, text: string) {
  if (ctx.hasUI && ctx.ui?.editor) await ctx.ui.editor(title, text);
  else console.log(text);
}

function notifyOrLog(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info") {
  if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(message, level);
  else console.log(message);
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse harness JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function firstArg(args: string | undefined) {
  return splitArgs(args ?? "")[0];
}

function splitArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}
