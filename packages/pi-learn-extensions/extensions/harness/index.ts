import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_API = resolve(EXTENSION_DIR, "../../../harness-runtime/src/api.js");
const DEFAULT_LAST = "5";

type HarnessRun = {
  stdout: string;
  stderr: string;
};

export default function harnessExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "harness_import_llm_reflection",
    label: "Harness Import Reflection",
    description: "Import a Pi-session LLM reflection JSON response into private Harness draft proposals. Use only after /harness-reflect-pi asks you to create evidence-backed proposals.",
    promptSnippet: "Call `harness_import_llm_reflection` with the final JSON reflection proposals when asked by /harness-reflect-pi.",
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

  pi.registerCommand("harness-last", {
    description: "Show recent Pi sessions for current project",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const last = firstArg(args) ?? DEFAULT_LAST;
      const run = await runHarness(ctx, ["sessions", "--project", ctx.cwd, "--last", last, "--json"]);
      const output = parseJson(run.stdout);
      const sessions = output?.sessions ?? [];
      const text = sessions.length
        ? sessions.map((s: any) => `${s.timestamp ?? s.mtime}  ${s.sessionId}\n  ${s.sessionFile}`).join("\n")
        : "No sessions found for this project.";
      await showText(ctx, `🧭 Last ${last} harness sessions`, text);
    }),
  });

  pi.registerCommand("harness-warnings", {
    description: "Scan recent sessions and show parser/normalizer warnings",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const last = firstArg(args) ?? DEFAULT_LAST;
      const run = await runHarness(ctx, ["scan", "--project", ctx.cwd, "--last", last, "--json"]);
      const output = parseJson(run.stdout);
      const lines: string[] = [];
      for (const result of output?.results ?? []) {
        lines.push(`${result.sessionId}: warnings=${result.warningsCount ?? 0}`);
        for (const warning of result.warnings ?? []) {
          lines.push(`  - ${warning.code}: ${warning.message}`);
        }
      }
      await showText(ctx, `⚠️ Harness warnings (${last} sessions)`, lines.join("\n") || "No warnings found.");
    }),
  });

  pi.registerCommand("harness-automation-status", {
    description: "Show Harness gated automation status",
    handler: async (_args, ctx) => withHarnessErrors(ctx, async () => {
      const run = await runHarness(ctx, ["automation-status", "--project", ctx.cwd, "--json"]);
      const output = parseJson(run.stdout);
      const status = output?.status;
      const lines = [
        `enabled: ${status?.enabled ?? false}`,
        `allowed: ${status?.allowed ?? false}`,
        `reason: ${status?.reason ?? "unknown"}`,
        `maxSessions: ${status?.automation?.maxSessions ?? ""}`,
        `scan: ${status?.automation?.scan ?? false}`,
        `report: ${status?.automation?.report ?? false}`,
        `proposeRules: ${status?.automation?.proposeRules ?? false}`,
        `proposeTargets: ${(status?.automation?.proposeTargets ?? []).join(", ")}`,
        `eval: ${status?.automation?.eval ?? false}`,
        `createEvalFixtureDraft: ${status?.automation?.createEvalFixtureDraft ?? false}`,
      ].join("\n");
      await showText(ctx, "🧪 Harness automation status", lines);
    }),
  });

  pi.registerCommand("harness-automate", {
    description: "Run gated Harness automation if enabled in harness/config.json",
    handler: async (_args, ctx) => withHarnessErrors(ctx, async () => {
      if (ctx.hasUI && ctx.ui?.confirm) {
        const ok = await ctx.ui.confirm("Run Harness gated automation", "Run scan/report/proposal/eval drafting only? This will not apply or push changes.");
        if (!ok) return notifyOrLog(ctx, "Harness automation cancelled.", "info");
      }
      const run = await runHarness(ctx, ["automate", "--project", ctx.cwd, "--json"]);
      const output = parseJson(run.stdout);
      const lines = [
        `status: ${output?.status ?? "unknown"}`,
        output?.reason ? `reason: ${output.reason}` : undefined,
        "",
        ...(output?.actions ?? []).map((action: any) => `${action.name}: ${action.status}${action.written !== undefined ? ` written=${action.written}` : ""}${action.skipped !== undefined ? ` skipped=${action.skipped}` : ""}`),
      ].filter(Boolean).join("\n");
      await showText(ctx, "🤖 Harness gated automation", lines || "No automation actions ran.");
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

  pi.registerCommand("harness-reflect", {
    description: "Build and preview a redacted Harness reflection prompt. Usage: /harness-reflect [last]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const parts = splitArgs(args ?? "");
      const last = parts.find((part) => /^\d+$/.test(part)) ?? DEFAULT_LAST;
      const run = await runHarness(ctx, ["reflect", "--project", ctx.cwd, "--last", last, "--json"]);
      const output = parseJson(run.stdout);
      const promptPath = output?.reflection?.latestPath;
      if (!promptPath) return notifyOrLog(ctx, "Harness reflect did not return latestPath.", "warning");
      const markdown = await readFile(promptPath, "utf8");
      await showText(ctx, `🪞 Harness reflection prompt: ${promptPath}`, markdown);
      notifyOrLog(ctx, `Harness reflection prompt ready: ${promptPath}`, "info");
    }),
  });

  pi.registerCommand("harness-reflect-pi", {
    description: "Use the current Pi session model to create Harness reflection proposals. Usage: /harness-reflect-pi [last]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const last = firstArg(args) ?? DEFAULT_LAST;
      const run = await runHarness(ctx, ["reflect", "--project", ctx.cwd, "--last", last, "--json"]);
      const output = parseJson(run.stdout);
      const promptPath = output?.reflection?.latestPath;
      if (!promptPath) return notifyOrLog(ctx, "Harness reflect did not return latestPath.", "warning");
      const prompt = await readFile(promptPath, "utf8");
      const userMessage = [
        "Review the Harness reflection prompt below using only its normalized evidence.",
        "Do not read raw session logs or other files.",
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
      notifyOrLog(ctx, `Queued Harness reflection on current Pi model from: ${promptPath}`, "info");
    }),
  });

  pi.registerCommand("harness-proposals", {
    description: "List and preview draft Harness proposals",
    handler: async (_args, ctx) => withHarnessErrors(ctx, async () => {
      const run = await runHarness(ctx, ["proposals", "--project", ctx.cwd, "--json"]);
      const output = parseJson(run.stdout);
      const proposals = output?.proposals ?? [];
      if (!proposals.length) {
        notifyOrLog(ctx, "No draft Harness proposals found. Run /harness-propose first.", "info");
        return;
      }

      if (ctx.hasUI && ctx.ui?.select) {
        const labels = proposals.map((p: any) => `${p.id} [${p.target}/${p.risk}] ${p.title}`);
        const chosen = await ctx.ui.select("📋 Draft Harness proposals", labels);
        if (!chosen) return;
        const proposal = proposals[labels.indexOf(chosen)];
        if (proposal?.filePath) {
          const markdown = await readFile(proposal.filePath, "utf8");
          await ctx.ui.editor(`📋 ${proposal.id}: ${proposal.title}`, markdown);
        }
        return;
      }

      console.log(proposals.map((p: any) => `${p.id} [${p.target}/${p.risk}] ${p.title}\n  ${p.filePath}`).join("\n"));
    }),
  });

  pi.registerCommand("harness-propose", {
    description: "Generate Harness draft proposals. Usage: /harness-propose [rules|memory|rule-config|parser|redaction] [last]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const parts = splitArgs(args ?? "");
      const mode = parts[0] ?? "rules";
      const last = parts.find((part, index) => index > 0 && /^\d+$/.test(part)) ?? DEFAULT_LAST;
      const target = mode === "rule-config" || mode === "target-rules" || mode === "rules-target" ? "rules" : mode;
      const cliArgs = mode === "rules"
        ? ["propose", "--project", ctx.cwd, "--last", last, "--rules", "--json"]
        : mode === "llm"
          ? ["propose", "--project", ctx.cwd, "--last", last, "--llm", "--json"]
          : ["propose", "--project", ctx.cwd, "--last", last, "--target", target, "--json"];
      const run = await runHarness(ctx, cliArgs);
      const output = parseJson(run.stdout);
      const lines = [
        `mode: ${output?.mode ?? mode}`,
        `sessions: ${output?.sessionsScanned ?? 0}`,
        `candidates: ${output?.candidates ?? 0}`,
        `written: ${output?.written?.length ?? 0}`,
        `skipped: ${output?.skipped?.length ?? 0}`,
        output?.memory ? `memory drafts: ${output.memory.written?.length ?? 0} (${output.memory.draftPath})` : undefined,
        "",
        ...(output?.written ?? []).map((p: any) => `${p.id} [${p.target}/${p.risk}] ${p.title}\n  ${p.filePath}`),
      ].filter(Boolean).join("\n");
      await showText(ctx, "🧪 Harness propose", lines || "No proposals generated.");
    }),
  });

  pi.registerCommand("harness-approve", {
    description: "Approve a Harness proposal. Usage: /harness-approve P-0001",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const id = firstArg(args);
      if (!id) return notifyOrLog(ctx, "Usage: /harness-approve P-0001", "warning");
      const run = await runHarness(ctx, ["approve", id, "--project", ctx.cwd, "--json"]);
      const output = parseJson(run.stdout);
      notifyOrLog(ctx, `Harness proposal ${output?.proposal?.id ?? id}: ${output?.proposal?.status ?? "approved"}`, "info");
    }),
  });

  pi.registerCommand("harness-reject", {
    description: "Reject a Harness proposal. Usage: /harness-reject P-0001",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const id = firstArg(args);
      if (!id) return notifyOrLog(ctx, "Usage: /harness-reject P-0001", "warning");
      const run = await runHarness(ctx, ["reject", id, "--project", ctx.cwd, "--json"]);
      const output = parseJson(run.stdout);
      notifyOrLog(ctx, `Harness proposal ${output?.proposal?.id ?? id}: ${output?.proposal?.status ?? "rejected"}`, "info");
    }),
  });

  pi.registerCommand("harness-apply", {
    description: "Apply an approved Harness proposal with a JSON Patch section. Usage: /harness-apply P-0001 [--allow-dirty] [--skip-tests] [--commit]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const parts = splitArgs(args ?? "");
      const id = parts[0];
      const flags = parts.slice(1);
      if (!id) return notifyOrLog(ctx, "Usage: /harness-apply P-0001 [--allow-dirty] [--skip-tests] [--commit]", "warning");
      if (ctx.hasUI && ctx.ui?.confirm) {
        const dirty = flags.includes("--allow-dirty") ? " with dirty-worktree override" : "";
        const ok = await ctx.ui.confirm("Apply Harness proposal", `Apply ${id}${dirty} on a harness/* branch? This may edit files listed in the proposal patch.`);
        if (!ok) return notifyOrLog(ctx, `Harness apply cancelled: ${id}`, "info");
      }
      const run = await runHarness(ctx, ["apply", id, ...flags, "--project", ctx.cwd, "--json"]);
      const output = parseJson(run.stdout);
      const lines = [
        `${output?.proposal?.id ?? id}: ${output?.proposal?.status ?? "applied"}`,
        output?.branchName ? `branch: ${output.branchName}` : undefined,
        output?.changedPaths?.length ? `changed: ${output.changedPaths.join(", ")}` : undefined,
        output?.testResults?.length ? `tests: ${output.testResults.length}` : undefined,
        output?.diff ? `\nDiff\n${output.diff}` : undefined,
      ].filter(Boolean).join("\n");
      await showText(ctx, `🧩 Harness apply ${id}`, lines);
    }),
  });

  pi.registerCommand("harness-history", {
    description: "Show proposal lifecycle history. Usage: /harness-history [P-0001]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const id = firstArg(args);
      const cliArgs = id ? ["history", id, "--project", ctx.cwd, "--json"] : ["history", "--project", ctx.cwd, "--json"];
      const run = await runHarness(ctx, cliArgs);
      const output = parseJson(run.stdout);
      const lines = (output?.history ?? []).map((event: any) => `${event.timestamp}  ${event.proposalId}  ${event.event}  ${event.status}`);
      await showText(ctx, `🧾 Harness history${id ? ` ${id}` : ""}`, lines.join("\n") || "No proposal history found.");
    }),
  });

  pi.registerCommand("harness-note", {
    description: "Append a private Harness note to the current Pi session",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const note = args?.trim() || (ctx.hasUI && ctx.ui?.editor ? await ctx.ui.editor("📝 Harness note", "") : "");
      if (!note?.trim()) return;
      pi.appendEntry("harness-note", {
        text: note.trim(),
        cwd: ctx.cwd,
        createdAt: new Date().toISOString(),
      });
      notifyOrLog(ctx, "Harness note appended to session.", "info");
    }),
  });

  pi.registerCommand("harness-tag", {
    description: "Tag current session leaf. Usage: /harness-tag success|failure [reason]",
    handler: async (args, ctx) => withHarnessErrors(ctx, async () => {
      const parts = splitArgs(args ?? "");
      const tag = parts[0] ?? "note";
      const reason = parts.slice(1).join(" ");
      const leafId = ctx.sessionManager?.getLeafId?.();
      if (leafId && (tag === "success" || tag === "failure")) {
        pi.setLabel(leafId, tag);
      }
      pi.appendEntry("harness-tag", {
        tag,
        reason,
        leafId,
        cwd: ctx.cwd,
        createdAt: new Date().toISOString(),
      });
      notifyOrLog(ctx, `Harness tag recorded: ${tag}${reason ? ` — ${reason}` : ""}`, "info");
    }),
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui?.notify("🧪 Harness commands: /harness-report, /harness-eval, /harness-automate, /harness-reflect-pi", "info");
  });
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
      case "--skip-tests":
        options.skipTests = true;
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
