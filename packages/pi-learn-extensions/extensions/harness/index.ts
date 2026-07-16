import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "@sinclair/typebox";
import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
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

type ProposalAction = "details" | "approve" | "apply" | "reject" | "back";

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

  pi.registerCommand("harness-status", {
    description: "Show consolidated Harness status, recent sessions, warnings, and automation state",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const parts = splitArgs(args ?? "");
      const last = parts.find((part) => /^\d+$/.test(part)) ?? DEFAULT_LAST;
      const sessionsOutput = parseJson((await runHarness(ctx, ["sessions", "--project", ctx.cwd, "--last", last, "--json"])).stdout);
      const scanOutput = parseJson((await runHarness(ctx, ["scan", "--project", ctx.cwd, "--last", last, "--json"])).stdout);
      const automationOutput = parseJson((await runHarness(ctx, ["automation-status", "--project", ctx.cwd, "--json"])).stdout);
      const sessions = sessionsOutput?.sessions ?? [];
      const scanResults = scanOutput?.results ?? [];
      const warningCount = scanResults.reduce((sum: number, result: any) => sum + (result.warningsCount ?? 0), 0);
      const status = automationOutput?.status;
      const lines = [
        `project: ${sessionsOutput?.project?.projectRoot ?? ctx.cwd}`,
        `sessionDir: ${sessionsOutput?.sessionDir ?? "(unknown)"}`,
        `recent sessions: ${sessions.length}/${last}`,
        `warnings: ${warningCount}`,
        `automation: ${status?.allowed ? "allowed" : "disabled/skipped"} (${status?.reason ?? "unknown"})`,
        "",
        "Recent sessions",
        ...(sessions.length ? sessions.slice(0, 5).map((s: any) => `- ${s.timestamp ?? s.mtime}  ${s.sessionId}`) : ["- none found"]),
        "",
        "Warnings",
        ...(warningCount
          ? scanResults.flatMap((result: any) => (result.warnings ?? []).slice(0, 3).map((warning: any) => `- ${result.sessionId}: ${warning.code} — ${warning.message}`)).slice(0, 10)
          : ["- none found"]),
      ];
      await showText(ctx, `🧭 Harness status (${last} sessions)`, lines.join("\n").trimEnd() || "No Harness status available.");
    }),
  });

  pi.registerCommand("harness-report", {
    description: "Generate and preview latest Pi Harness report",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const last = firstArg(args) ?? DEFAULT_LAST;
      const run = await runHarness(ctx, ["report", "--project", ctx.cwd, "--last", last, "--json"]);
      const output = parseJson(run.stdout);
      const reportPath = output?.report?.latestPath;
      if (!reportPath) return notifyOrLog(ctx, "Harness report did not return latestPath.", "warning");

      const markdown = await readFile(reportPath, "utf8");
      if (ctx.hasUI && ctx.ui?.editor) {
        await ctx.ui.editor(`📊 Harness report: ${reportPath}`, markdown);
      } else {
        console.log(markdown);
      }
      notifyOrLog(ctx, `Harness report: ${reportPath}`, "info");
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
    ctx.ui?.notify("🧪 Harness: /harness-status, /harness-report, /harness-improve, /harness-wiki-status", "info");
  });
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

    if (action === "details") {
      if (ctx.ui?.editor) {
        await ctx.ui.editor(`📋 ${proposal.id}: ${proposal.title} (preview only)`, markdown || "Proposal details are unavailable.");
      }
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
  const items: SelectItem[] = [
    {
      value: "details",
      label: "▣ Mở Markdown đầy đủ",
      description: "Mở viewer/editor có thể scroll để đọc toàn bộ nội dung; thay đổi sẽ không được lưu.",
    },
  ];
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
    selectedValue: "details",
  });
  return selected as ProposalAction | undefined;
}

async function selectModalItem(
  ctx: ExtensionCommandContext,
  options: { title: string; body: string; items: SelectItem[]; selectedValue?: string },
): Promise<string | undefined> {
  if (ctx.mode !== "tui") {
    if (!ctx.hasUI || !ctx.ui?.select) return undefined;
    const labels = options.items.map((item) => `${item.label} — ${item.description ?? ""}`);
    const chosen = await ctx.ui.select(options.title, labels);
    return chosen ? options.items[labels.indexOf(chosen)]?.value : undefined;
  }

  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const panel = new Box(2, 1, (text: string) => theme.bg("customMessageBg", text));
    panel.addChild(new DynamicBorder((text: string) => theme.fg("borderAccent", text)));
    panel.addChild(new Text(theme.fg("customMessageLabel", theme.bold("HARNESS  /  PROPOSAL REVIEW")), 0, 0));
    panel.addChild(new Text(theme.fg("accent", theme.bold(options.title)), 0, 0));
    panel.addChild(new Text(theme.fg("customMessageText", options.body), 0, 1));

    const list = new SelectList(options.items, Math.min(options.items.length, 8), {
      selectedPrefix: (text) => theme.bg("selectedBg", theme.fg("accent", text)),
      selectedText: (text) => theme.bg("selectedBg", theme.fg("accent", theme.bold(text))),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    const selectedIndex = options.items.findIndex((item) => item.value === options.selectedValue);
    if (selectedIndex >= 0) list.setSelectedIndex(selectedIndex);
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    panel.addChild(list);
    panel.addChild(new Text(theme.fg("dim", "↑↓ di chuyển    Enter chọn    Esc đóng"), 0, 1));
    panel.addChild(new DynamicBorder((text: string) => theme.fg("borderAccent", text)));

    return {
      render: (width: number) => panel.render(width),
      invalidate: () => panel.invalidate(),
      handleInput: (data: string) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: 92,
      maxHeight: "85%",
      margin: 2,
    },
  });
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
  const problem = compactMarkdownSection(markdown, "Problem", 520) || "Không có mô tả.";
  const proposedChange = compactMarkdownSection(markdown, "Proposed change", 520) || "Không có mô tả.";
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
