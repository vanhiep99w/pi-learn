import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  discoverWikiPromptRules,
  ensureWikiPromptRuleScaffolds,
  isWikiDocumentationPath,
  isWikiMetadataPath,
  isWikiRulePath,
  relativeProjectPath,
} from "../../../harness-runtime/src/analysis/wiki-prompt-rules.js";
import { createHarnessWikiTaskPrompt } from "./wiki-prompt.js";

const execFileAsync = promisify(execFile);

// Pi-native OpenWiki port, now owned by the Harness extension.
// Upstream base: langchain-ai/openwiki@23428de0cc0b1b6d3e5d09be413e92a5d6ee451f
// See ./README.md for intentional differences and the upgrade checklist.
const WIKI_DIR = "wiki";
const UPDATE_METADATA_PATH = `${WIKI_DIR}/.last-update.json`;
const STATUS_KEY = "harness-wiki";

type HarnessWikiCommand = "init" | "update" | "chat";

type UpdateMetadata = {
  updatedAt: string;
  command: "init" | "update";
  gitHead?: string;
  model: string;
};

type RunContext = {
  lastUpdate: UpdateMetadata | null;
  gitSummary: string;
};

type ActiveWikiRun = {
  command: HarnessWikiCommand;
  cwd: string;
  snapshotBefore?: string;
};

let activeWikiRun: ActiveWikiRun | null = null;

export function registerHarnessWikiCommands(pi: ExtensionAPI) {
  pi.registerCommand("harness-wiki-init", {
    description: "Generate initial Harness Wiki docs with the current Pi agent",
    handler: async (args, ctx) => runWikiCommand(ctx, async () => {
      await startDocumentationRun(pi, ctx, "init", args);
    }),
  });

  pi.registerCommand("harness-wiki-update", {
    description: "Update Harness Wiki docs from repository changes",
    handler: async (args, ctx) => runWikiCommand(ctx, async () => {
      await startDocumentationRun(pi, ctx, "update", args);
    }),
  });

  pi.registerCommand("harness-wiki-ask", {
    description: "Ask a question using Harness Wiki and repository context",
    handler: async (args, ctx) => runWikiCommand(ctx, async () => {
      const question = args.trim();
      if (!question) {
        notifyOrLog(ctx, "Usage: /harness-wiki-ask <question>", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        notifyOrLog(ctx, "Agent is busy. Try again after the current run settles.", "warning");
        return;
      }

      assertPromptRulesValidForWikiRun(ctx.cwd);
      const context = await createRunContext("chat", ctx.cwd);
      activeWikiRun = { command: "chat", cwd: ctx.cwd };
      try {
        pi.sendUserMessage(createHarnessWikiTaskPrompt("chat", ctx.cwd, context, question));
      } catch (error) {
        activeWikiRun = null;
        throw error;
      }
    }),
  });

  pi.registerCommand("harness-wiki-status", {
    description: "Show Harness Wiki docs, update, and prompt-rule health",
    handler: async (_args, ctx) => runWikiCommand(ctx, async () => {
      const status = await createStatusReport(ctx.cwd);
      await showText(ctx, "Harness Wiki status", status);
    }),
  });

  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName;
    if (toolName === "write" || toolName === "edit") {
      const candidate = (event.input as { path?: unknown })?.path;
      if (isProtectedWikiMutationPath(ctx.cwd, candidate)) {
        return {
          block: true,
          reason: "Pi tool turns cannot modify wiki/**/_rules.md or wiki/.last-update.json. Prompt rules require an approved Harness proposal; metadata is extension-owned.",
        };
      }
    }

    if (toolName === "bash") {
      const command = String((event.input as { command?: unknown })?.command ?? "");
      if (commandMutatesProtectedWikiPath(command)) {
        return {
          block: true,
          reason: "Harness blocked a shell mutation of prompt-rule or metadata files. Use the proposal/approval/apply lifecycle for wiki/**/_rules.md.",
        };
      }
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const run = activeWikiRun;
    if (!run || run.cwd !== ctx.cwd) return;
    activeWikiRun = null;

    if (run.command === "chat") {
      setWikiStatus(ctx, undefined);
      return;
    }

    setWikiStatus(ctx, "Finalizing...");
    try {
      const scaffoldResult = ensureWikiPromptRuleScaffolds({ projectRoot: run.cwd });
      const snapshotAfter = await createWikiDocumentationSnapshot(run.cwd);
      const docsChanged = snapshotAfter !== run.snapshotBefore;
      if (docsChanged) {
        await writeLastUpdateMetadata(run.command, run.cwd, getCurrentPiModelLabel(ctx));
      }

      const parts = [
        docsChanged
          ? `Harness Wiki ${run.command} completed; documentation metadata updated.`
          : `Harness Wiki ${run.command} completed with no documentation changes.`,
      ];
      if (scaffoldResult.created.length) {
        parts.push(`Created prompt-rule scaffold(s): ${scaffoldResult.created.join(", ")}.`);
      }
      notifyOrLog(ctx, parts.join(" "), "info");
    } catch (error) {
      notifyOrLog(ctx, `Harness Wiki finalization failed: ${formatError(error)}`, "error");
    } finally {
      setWikiStatus(ctx, undefined);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    activeWikiRun = null;
    setWikiStatus(ctx, undefined);
  });
}

async function startDocumentationRun(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  command: "init" | "update",
  args: string,
) {
  if (!ctx.isIdle()) {
    notifyOrLog(ctx, "Agent is busy. Try again after the current run settles.", "warning");
    return;
  }

  const userMessage = args.trim();
  if (command === "update" && !userMessage) {
    const noop = await getUpdateNoopStatus(ctx.cwd);
    if (noop.shouldSkip) {
      notifyOrLog(ctx, "No meaningful repository changes detected since the last Harness Wiki update; skipping.", "info");
      return;
    }
  }

  const scaffoldResult = ensureWikiPromptRuleScaffolds({ projectRoot: ctx.cwd });
  assertPromptRulesValidForWikiRun(ctx.cwd);
  const context = await createRunContext(command, ctx.cwd);
  const snapshotBefore = await createWikiDocumentationSnapshot(ctx.cwd);
  activeWikiRun = { command, cwd: ctx.cwd, snapshotBefore };

  if (scaffoldResult.created.length) {
    notifyOrLog(ctx, `Created prompt-rule scaffold(s): ${scaffoldResult.created.join(", ")}.`, "info");
  }
  setWikiStatus(ctx, command === "init" ? "Generating docs..." : "Updating docs...");

  try {
    pi.sendUserMessage(createHarnessWikiTaskPrompt(command, ctx.cwd, context, userMessage || null));
  } catch (error) {
    activeWikiRun = null;
    setWikiStatus(ctx, undefined);
    throw error;
  }
}

async function createRunContext(command: HarnessWikiCommand, cwd: string): Promise<RunContext> {
  const lastUpdate = await readLastUpdate(cwd);
  if (command === "chat") return { lastUpdate, gitSummary: "Not applicable for chat." };
  return { lastUpdate, gitSummary: await createGitSummary(command, cwd, lastUpdate) };
}

async function createGitSummary(
  command: HarnessWikiCommand,
  cwd: string,
  lastUpdate: UpdateMetadata | null,
): Promise<string> {
  const lines: string[] = [];
  lines.push("## Working tree status");
  lines.push(await runGitOrFallback(cwd, ["status", "--short", "--untracked-files=all"]));
  lines.push("\n## Current HEAD");
  lines.push(await runGitOrFallback(cwd, ["rev-parse", "HEAD"]));

  if (command === "update" && lastUpdate?.gitHead) {
    lines.push(`\n## Changes since last wiki git head (${lastUpdate.gitHead})`);
    lines.push(await runGitOrFallback(cwd, ["log", `${lastUpdate.gitHead}..HEAD`, "--name-status", "--oneline"]));
  } else if (command === "update" && lastUpdate?.updatedAt) {
    lines.push(`\n## Changes since last wiki timestamp (${lastUpdate.updatedAt})`);
    lines.push(await runGitOrFallback(cwd, ["log", "--since", lastUpdate.updatedAt, "--name-status", "--oneline"]));
  } else {
    lines.push("\n## Recent commits");
    lines.push(await runGitOrFallback(cwd, ["log", "--max-count=20", "--name-status", "--oneline"]));
  }

  lines.push("\n## Diff summary against HEAD");
  lines.push(await runGitOrFallback(cwd, ["diff", "--name-status", "HEAD"]));
  return lines.join("\n");
}

type UpdateNoopStatus = { shouldSkip: true } | { shouldSkip: false; reason: string };

async function getUpdateNoopStatus(cwd: string): Promise<UpdateNoopStatus> {
  const promptRules = discoverWikiPromptRules({ projectRoot: cwd });
  if (!promptRules.wikiExists || !promptRules.rootRuleExists || promptRules.missingRuleSections.length > 0) {
    return { shouldSkip: false, reason: "prompt-rule scaffolds are missing" };
  }
  if (!promptRules.valid) return { shouldSkip: false, reason: "prompt-rule lint is invalid" };

  const lastUpdate = await readLastUpdate(cwd);
  if (!lastUpdate?.gitHead) return { shouldSkip: false, reason: "missing previous update git head" };

  const head = await getGitHead(cwd);
  if (!head) return { shouldSkip: false, reason: "missing current git head" };

  const status = await runGit(cwd, ["status", "--short", "--untracked-files=all"]);
  const meaningfulStatus = status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !isMetadataStatusLine(line));

  if (meaningfulStatus.length > 0) return { shouldSkip: false, reason: "worktree has changes" };

  if (head !== lastUpdate.gitHead) {
    const changedPaths = await getChangedPathsSince(cwd, lastUpdate.gitHead);
    if (changedPaths.length === 0) return { shouldSkip: false, reason: "git head changed but changed paths are unavailable" };
    if (changedPaths.some(isWikiRulePath)) return { shouldSkip: false, reason: "prompt rules changed" };
    if (changedPaths.some((changedPath) => !isWikiDocumentationPath(changedPath) && !isWikiMetadataPath(changedPath))) {
      return { shouldSkip: false, reason: "source or configuration changed" };
    }
  }

  return { shouldSkip: true };
}

async function readLastUpdate(cwd: string): Promise<UpdateMetadata | null> {
  try {
    const raw = await readFile(path.join(cwd, UPDATE_METADATA_PATH), "utf8");
    const parsed = JSON.parse(raw) as Partial<UpdateMetadata>;
    if (typeof parsed.updatedAt === "string" && typeof parsed.command === "string" && typeof parsed.model === "string") {
      return {
        updatedAt: parsed.updatedAt,
        command: parsed.command === "init" ? "init" : "update",
        gitHead: typeof parsed.gitHead === "string" ? parsed.gitHead : undefined,
        model: parsed.model,
      };
    }
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
  return null;
}

async function writeLastUpdateMetadata(command: "init" | "update", cwd: string, model: string): Promise<void> {
  const metadataPath = path.join(cwd, UPDATE_METADATA_PATH);
  const metadata: UpdateMetadata = {
    updatedAt: new Date().toISOString(),
    command,
    gitHead: await getGitHead(cwd),
    model,
  };
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function createWikiDocumentationSnapshot(cwd: string): Promise<string> {
  const hash = createHash("sha256");
  const wikiRoot = path.join(cwd, WIKI_DIR);
  hash.update("harness-wiki-docs-v1\0");
  try {
    await addDocumentationToSnapshot(hash, wikiRoot, "");
  } catch (error) {
    if (isFileNotFoundError(error)) hash.update("missing");
    else throw error;
  }
  return hash.digest("hex");
}

async function addDocumentationToSnapshot(
  hash: ReturnType<typeof createHash>,
  absolutePath: string,
  relativePath: string,
): Promise<void> {
  const info = await stat(absolutePath);
  if (info.isDirectory()) {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      await addDocumentationToSnapshot(hash, path.join(absolutePath, entry.name), childRelativePath);
    }
    return;
  }

  const repositoryPath = `${WIKI_DIR}/${relativePath}`;
  if (!info.isFile() || !isWikiDocumentationPath(repositoryPath)) return;
  hash.update(`file:${repositoryPath}\0`);
  hash.update(await readFile(absolutePath));
  hash.update("\0");
}

async function createStatusReport(cwd: string): Promise<string> {
  const lastUpdate = await readLastUpdate(cwd);
  const head = await getGitHead(cwd);
  const promptRules = discoverWikiPromptRules({ projectRoot: cwd });
  const snapshot = await createWikiDocumentationSnapshot(cwd);
  const noop = await getUpdateNoopStatus(cwd);
  const ruleCount = promptRules.ruleIds.length;

  const lines = [
    "Harness Wiki status",
    `- cwd: ${cwd}`,
    `- docs: ${promptRules.wikiExists ? `/${WIKI_DIR} exists` : `/${WIKI_DIR} missing`}`,
    `- git head: ${head ?? "unavailable"}`,
    `- docs snapshot: ${snapshot}`,
    `- last update: ${lastUpdate ? JSON.stringify(lastUpdate) : "none"}`,
    `- update no-op: ${noop.shouldSkip ? "yes" : `no (${noop.reason})`}`,
    `- prompt rule files: ${promptRules.files.length}`,
    `- prompt rule IDs: ${ruleCount}`,
    `- sections missing rules: ${promptRules.missingRuleSections.length}`,
    `- prompt rule lint: ${promptRules.valid ? "valid" : "invalid"}`,
    "",
    "Rule files",
    ...(promptRules.files.length ? promptRules.files.map((file) => `- ${file}`) : ["- none"]),
  ];

  if (promptRules.errors.length) {
    lines.push("", "Errors", ...promptRules.errors.map((item) => `- ${item.path}: ${item.message}`));
  }
  if (promptRules.warnings.length) {
    lines.push("", "Warnings", ...promptRules.warnings.map((item) => `- ${item.path}: ${item.message}`));
  }
  return lines.join("\n");
}

function assertPromptRulesValidForWikiRun(cwd: string) {
  const report = discoverWikiPromptRules({ projectRoot: cwd });
  if (report.valid) return;
  const details = report.errors.slice(0, 5).map((item) => `${item.path}: ${item.message}`).join("; ");
  throw new Error(`Harness Wiki cannot run while prompt-rule lint is invalid. Run /harness-wiki-status for details. ${details}`);
}

function isProtectedWikiMutationPath(cwd: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const relative = relativeProjectPath(cwd, value);
  return relative !== undefined && (isWikiRulePath(relative) || isWikiMetadataPath(relative));
}

function commandMutatesProtectedWikiPath(command: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  const mentionsProtectedPath = /wiki\/(?:[^\s'";&|>]+\/)*_rules\.md\b|wiki\/\.last-update\.json\b/.test(normalized);
  if (!mentionsProtectedPath) return false;
  return /(?:>>?|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\btee\b|\bsed\s+-[^\n]*i|\bperl\s+-[^\n]*i)/i.test(normalized);
}

function isMetadataStatusLine(line: string): boolean {
  const statusPath = line.length > 3 ? line.slice(3).trim().replace(/^"|"$/g, "") : line.trim();
  return isWikiMetadataPath(statusPath);
}

async function getGitHead(cwd: string): Promise<string | undefined> {
  const head = await runGitOrFallback(cwd, ["rev-parse", "HEAD"], "");
  return head.trim() || undefined;
}

async function getChangedPathsSince(cwd: string, ref: string): Promise<string[]> {
  const output = await runGitOrFallback(cwd, ["diff", "--name-only", `${ref}..HEAD`], "");
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function runGitOrFallback(cwd: string, args: string[], fallback = "(unavailable)"): Promise<string> {
  try {
    const output = await runGit(cwd, args);
    return output || (fallback === "" ? "" : "(no output)");
  } catch {
    return fallback;
  }
}

async function runWikiCommand(ctx: ExtensionCommandContext, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    notifyOrLog(ctx, `Harness Wiki error: ${formatError(error)}`, "error");
  }
}

async function showText(ctx: ExtensionCommandContext, title: string, text: string) {
  if (ctx.hasUI && ctx.ui?.editor) await ctx.ui.editor(title, text);
  else console.log(text);
}

function notifyOrLog(
  ctx: ExtensionContext,
  message: string,
  level: "info" | "warning" | "error" = "info",
) {
  if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(message, level);
  else console.log(message);
}

function setWikiStatus(ctx: ExtensionContext, value: string | undefined) {
  if (!ctx.hasUI || !ctx.ui?.setStatus) return;
  try {
    ctx.ui.setStatus(STATUS_KEY, value);
  } catch {
    // Session replacement can invalidate UI context during cleanup.
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

function getCurrentPiModelLabel(ctx: ExtensionContext): string {
  const model = ctx.model;
  if (model?.provider && model?.id) return `${model.provider}/${model.id}`;
  if (model?.name) return model.name;
  return "pi-current-model";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
