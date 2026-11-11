import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  formatWikiLinkIssues,
  validateWikiInternalLinks,
} from "./wiki-links.js";
import {
  discoverWikiPromptRules,
  ensureWikiPromptRuleScaffolds,
  isWikiDocumentationPath,
  isWikiMetadataPath,
  isWikiPolicyPath,
  isWikiDomainsPath,
} from "./wiki-rules.js";
import { createWikiTaskPrompt } from "./wiki-prompt.js";
import { isProtectedWikiMutationPath, commandMutatesProtectedWikiPath } from "./wiki-protection.ts";
import { WikiModelError, WikiReadModel, type WikiDiagnostic } from "./wiki-model.ts";
import { readPolicyConfigText, WikiPolicyError } from "./wiki-policy.js";

const execFileAsync = promisify(execFile);

// Pi-native repository Wiki using the current Pi model and filesystem tools.
const WIKI_DIR = "wiki";
const UPDATE_METADATA_PATH = `${WIKI_DIR}/.last-update.json`;
const WIKI_INSTRUCTIONS_PATH = `${WIKI_DIR}/INSTRUCTIONS.md`;
const MAX_WIKI_BRIEF_BYTES = 64 * 1024;
const STATUS_KEY = "wiki";

type WikiCommand = "init" | "update";

type UpdateMetadata = {
  updatedAt: string;
  command: "init" | "update";
  gitHead?: string;
  model: string;
  status: "complete" | "interrupted";
};

type RunContext = {
  lastUpdate: UpdateMetadata | null;
  wikiBrief: string | null;
};

type ActiveWikiRun = {
  command: WikiCommand;
  cwd: string;
  snapshotBefore?: string;
  agentInterrupted?: boolean;
};

type WikiRunState = { active: ActiveWikiRun | null };

export interface WikiWriteAccess {
  capture(cwd: string): () => void;
}

export function registerWikiCommands(pi: ExtensionAPI): WikiWriteAccess {
  const state: WikiRunState = { active: null };
  pi.on("session_start", () => { state.active = null; });
  pi.registerCommand("wiki", {
    description: "Generate initial repository Wiki docs with the current Pi agent",
    handler: async (args, ctx) => runWikiCommand(ctx, async () => {
      await startDocumentationRun(pi, ctx, "init", args, state);
    }),
  });

  pi.registerCommand("wiki-update", {
    description: "Update repository Wiki docs and applicable rules with the current Pi agent",
    handler: async (args, ctx) => runWikiCommand(ctx, async () => {
      await startDocumentationRun(pi, ctx, "update", args, state);
    }),
  });

  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName;
    const currentRun = state.active?.cwd === ctx.cwd ? state.active : null;
    const protectWikiBrief = currentRun !== null;
    const protectRules = currentRun?.command !== "update";
    if (toolName === "write" || toolName === "edit") {
      const candidate = (event.input as { path?: unknown })?.path;
      if (isProtectedWikiMutationPath(ctx.cwd, candidate, { protectRules, protectWikiBrief })) {
        return {
          block: true,
          reason: "Wiki metadata and the active run's wiki/INSTRUCTIONS.md are protected. _rules.md and wiki/_domains.json may be changed only during an active /wiki-update run; the agent chooses the applicable policy from the user's intent.",
        };
      }
    }

    if (toolName === "bash") {
      const command = String((event.input as { command?: unknown })?.command ?? "");
      if (commandMutatesProtectedWikiPath(command, { protectRules, protectWikiBrief })) {
        return {
          block: true,
          reason: "Wiki blocked a shell mutation of protected metadata, instructions, or rule files outside an active /wiki-update run.",
        };
      }
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    const run = state.active;
    if (!run || run.cwd !== ctx.cwd) return;
    const finalAssistant = [...event.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    run.agentInterrupted = finalAssistant?.role === "assistant"
      && (finalAssistant.stopReason === "aborted" || finalAssistant.stopReason === "error");
  });

  pi.on("agent_settled", async (event, ctx) => {
    const run = state.active;
    if (!run || run.cwd !== ctx.cwd) return;
    state.active = null;

    setWikiStatus(ctx, "Finalizing...");
    try {
      const scaffoldResult = ensureWikiPromptRuleScaffolds({ projectRoot: run.cwd });
      const snapshotAfter = await createWikiSnapshot(run.cwd);
      const wikiChanged = snapshotAfter !== run.snapshotBefore;
      const linkReport = validateWikiInternalLinks({ projectRoot: run.cwd });
      const linksValid = linkReport.issues.length === 0;
      const ruleReport = discoverWikiPromptRules({ projectRoot: run.cwd });
      const rulesValid = ruleReport.valid;
      const graphReport = validateWikiGraphForRun(run.cwd);
      const valid = linksValid && rulesValid && graphReport.valid;
      const agentInterrupted = event.aborted === true || run.agentInterrupted === true;
      const previousUpdate = await readLastUpdate(run.cwd);
      const clearInterruptedStatus = previousUpdate?.status === "interrupted";
      if (valid && !agentInterrupted && (wikiChanged || clearInterruptedStatus)) {
        await writeLastUpdateMetadata(run.command, run.cwd, getCurrentPiModelLabel(ctx), "complete");
      } else if (!valid || (agentInterrupted && wikiChanged)) {
        await writeLastUpdateMetadata(run.command, run.cwd, getCurrentPiModelLabel(ctx), "interrupted");
      }

      const parts = [
        !valid
          ? `Wiki ${run.command} was marked interrupted because validation failed${wikiChanged ? " after changing files" : " with no Wiki changes"}.`
          : agentInterrupted
            ? wikiChanged
              ? `Wiki ${run.command} was aborted or failed after changing Wiki files; the run was marked interrupted.`
              : `Wiki ${run.command} was aborted or failed with no Wiki changes; existing metadata was preserved.`
            : wikiChanged
              ? `Wiki ${run.command} completed; metadata updated.`
              : clearInterruptedStatus
                ? `Wiki ${run.command} completed with no changes; interrupted metadata cleared.`
                : `Wiki ${run.command} completed with no changes.`,
      ];
      if (scaffoldResult.created.length) {
        parts.push(`Created prompt-rule scaffold(s): ${scaffoldResult.created.join(", ")}.`);
      }
      if (!linksValid) parts.push(formatWikiLinkIssues(linkReport));
      if (!rulesValid) {
        const details = ruleReport.errors.slice(0, 5).map((item: { path: string; message: string }) => `${item.path}: ${item.message}`).join("; ");
        parts.push(`Rule validation failed: ${details}`);
      }
      if (!graphReport.valid) parts.push(formatGraphDiagnostics(graphReport.diagnostics, "error"));
      if (graphReport.diagnostics.some((item) => item.severity === "warning")) {
        parts.push(formatGraphDiagnostics(graphReport.diagnostics, "warning"));
      }
      notifyOrLog(ctx, parts.join(" "), valid && !agentInterrupted ? "info" : "warning");
    } catch (error) {
      notifyOrLog(ctx, `Wiki finalization failed: ${formatError(error)}`, "error");
    } finally {
      setWikiStatus(ctx, undefined);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const run = state.active;
    state.active = null;
    try {
      if (run && run.cwd === ctx.cwd) {
        const snapshotAfter = await createWikiSnapshot(run.cwd);
        if (snapshotAfter !== run.snapshotBefore) {
          await writeLastUpdateMetadata(run.command, run.cwd, getCurrentPiModelLabel(ctx), "interrupted");
          notifyOrLog(ctx, `Wiki ${run.command} was interrupted after changing files; the next update will retry.`, "warning");
        }
      }
    } catch (error) {
      notifyOrLog(ctx, `Wiki interruption metadata failed: ${formatError(error)}`, "error");
    } finally {
      setWikiStatus(ctx, undefined);
    }
  });
  return {
    capture(cwd) {
      const run = state.active;
      const check = () => {
        if (!run || run.cwd !== cwd || state.active !== run) {
          throw new WikiModelError("write_not_authorized", "Spec tools require the same active /wiki or /wiki-update run and cwd; authorization expires when that run ends.");
        }
      };
      check();
      return check;
    },
  };
}

async function startDocumentationRun(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  command: "init" | "update",
  args: string,
  state: WikiRunState,
) {
  if (!ctx.isIdle()) {
    notifyOrLog(ctx, "Agent is busy. Try again after the current run settles.", "warning");
    return;
  }

  const userMessage = args.trim();
  if (command === "update" && !userMessage) {
    const noop = await getUpdateNoopStatus(ctx.cwd);
    if (noop.shouldSkip) {
      notifyOrLog(ctx, "No meaningful repository changes detected since the last Wiki update; skipping.", "info");
      return;
    }
  }

  const scaffoldResult = ensureWikiPromptRuleScaffolds({ projectRoot: ctx.cwd });
  if (command === "init") assertPromptRulesValidForWikiRun(ctx.cwd);
  const context = await createRunContext(ctx.cwd, command);
  const snapshotBefore = await createWikiSnapshot(ctx.cwd);
  state.active = { command, cwd: ctx.cwd, snapshotBefore };

  if (scaffoldResult.created.length) {
    notifyOrLog(ctx, `Created prompt-rule scaffold(s): ${scaffoldResult.created.join(", ")}.`, "info");
  }
  setWikiStatus(ctx, command === "init" ? "Generating docs..." : "Updating docs...");

  try {
    pi.sendUserMessage(createWikiTaskPrompt(command, ctx.cwd, context, userMessage || null));
  } catch (error) {
    state.active = null;
    setWikiStatus(ctx, undefined);
    throw error;
  }
}

async function createRunContext(cwd: string, command: "init" | "update"): Promise<RunContext> {
  const [lastUpdate, wikiBrief] = await Promise.all([
    readLastUpdate(cwd),
    command === "init" ? readWikiBrief(cwd) : Promise.resolve(null),
  ]);
  return { lastUpdate, wikiBrief };
}

async function readWikiBrief(cwd: string): Promise<string | null> {
  const briefPath = path.join(cwd, WIKI_INSTRUCTIONS_PATH);
  try {
    const info = await lstat(briefPath);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`${WIKI_INSTRUCTIONS_PATH} must be a regular file inside the repository.`);
    }
    if (info.size > MAX_WIKI_BRIEF_BYTES) {
      throw new Error(`${WIKI_INSTRUCTIONS_PATH} exceeds the ${MAX_WIKI_BRIEF_BYTES}-byte limit.`);
    }
    return await readFile(briefPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

type UpdateNoopStatus = { shouldSkip: true } | { shouldSkip: false; reason: string };

async function getUpdateNoopStatus(cwd: string): Promise<UpdateNoopStatus> {
  const promptRules = discoverWikiPromptRules({ projectRoot: cwd });
  if (!promptRules.wikiExists || !promptRules.rootRuleExists || promptRules.missingRuleSections.length > 0) {
    return { shouldSkip: false, reason: "prompt-rule scaffolds are missing" };
  }
  if (!promptRules.valid) return { shouldSkip: false, reason: "prompt-rule lint is invalid" };
  const linkReport = validateWikiInternalLinks({ projectRoot: cwd });
  if (linkReport.issues.length > 0) {
    return { shouldSkip: false, reason: "internal Wiki links are invalid" };
  }

  if (!validateWikiGraphForRun(cwd).valid) {
    return { shouldSkip: false, reason: "Wiki schema or graph is invalid" };
  }

  const lastUpdate = await readLastUpdate(cwd);
  if (!lastUpdate?.gitHead) return { shouldSkip: false, reason: "missing previous update git head" };
  if (lastUpdate.status === "interrupted") {
    return { shouldSkip: false, reason: "previous update was interrupted" };
  }

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
    if (changedPaths.some(isWikiPolicyPath)) return { shouldSkip: false, reason: "prompt rules or domain configuration changed" };
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
        status: parsed.status === "interrupted" ? "interrupted" : "complete",
      };
    }
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
  return null;
}

async function writeLastUpdateMetadata(
  command: "init" | "update",
  cwd: string,
  model: string,
  status: UpdateMetadata["status"] = "complete",
): Promise<void> {
  const metadataPath = path.join(cwd, UPDATE_METADATA_PATH);
  const metadata: UpdateMetadata = {
    updatedAt: new Date().toISOString(),
    command,
    gitHead: await getGitHead(cwd),
    model,
    status,
  };
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function createWikiSnapshot(cwd: string): Promise<string> {
  const hash = createHash("sha256");
  const wikiRoot = path.join(cwd, WIKI_DIR);
  hash.update("wiki-content-v2\0");
  try {
    await addWikiContentToSnapshot(hash, wikiRoot, "");
  } catch (error) {
    if (isFileNotFoundError(error)) hash.update("missing");
    else throw error;
  }
  return hash.digest("hex");
}

async function addWikiContentToSnapshot(
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
      await addWikiContentToSnapshot(hash, path.join(absolutePath, entry.name), childRelativePath);
    }
    return;
  }

  const repositoryPath = `${WIKI_DIR}/${relativePath}`;
  if (!info.isFile() || (!isWikiDocumentationPath(repositoryPath) && !isWikiPolicyPath(repositoryPath))) return;
  hash.update(`file:${repositoryPath}\0`);
  if (isWikiDomainsPath(repositoryPath)) {
    try { hash.update(readPolicyConfigText(path.resolve(absolutePath, "../..")) ?? "missing-policy-config"); }
    catch (error) { hash.update(`invalid-policy-config:${error instanceof WikiPolicyError ? error.code : "read_failed"}`); }
  } else hash.update(await readFile(absolutePath));
  hash.update("\0");
}

function validateWikiGraphForRun(cwd: string): { valid: boolean; diagnostics: WikiDiagnostic[] } {
  try {
    // Per-check derived state: no session cache survives finalization/no-op checks.
    return new WikiReadModel(cwd).validate();
  } catch {
    return { valid: false, diagnostics: [{
      path: "wiki", code: "graph_validation_failed", severity: "error",
      message: "Cannot safely complete Wiki schema/graph validation.",
    }] };
  }
}

function formatGraphDiagnostics(diagnostics: WikiDiagnostic[], severity: "error" | "warning"): string {
  const selected = diagnostics.filter((item) => item.severity === severity);
  // Paths/codes only: untrusted IDs or parser text must not overflow notifications.
  const shown = selected.slice(0, 5).map((item) => `${item.path.slice(0, 180)} [${item.code}]`).join("; ");
  const remaining = selected.length > 5 ? `; ${selected.length - 5} more` : "";
  return `Wiki schema/graph ${severity === "error" ? "validation failed" : "warnings"}: ${shown}${remaining}. Run wiki_validate with scope graph for details. Structural completion is not review approval.`;
}

function assertPromptRulesValidForWikiRun(cwd: string) {
  const report = discoverWikiPromptRules({ projectRoot: cwd });
  if (report.valid) return;
  const details = report.errors.slice(0, 5).map((item: { path: string; message: string }) => `${item.path}: ${item.message}`).join("; ");
  throw new Error(`Wiki cannot initialize while rule lint is invalid. Use /wiki-update to repair the applicable rules. ${details}`);
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
  // Preserve leading status columns: isMetadataStatusLine relies on Git's XY prefix.
  return stdout.trimEnd();
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
    notifyOrLog(ctx, `Wiki error: ${formatError(error)}`, "error");
  }
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
