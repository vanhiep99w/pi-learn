import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

// Pi-native OpenWiki port.
// Upstream base: langchain-ai/openwiki@23428de0cc0b1b6d3e5d09be413e92a5d6ee451f
// See ./README.md for the intentional differences and upgrade checklist.
const OPEN_WIKI_DIR = "openwiki";
const UPDATE_METADATA_PATH = `${OPEN_WIKI_DIR}/.last-update.json`;
const STATUS_KEY = "openwiki";

type OpenWikiCommand = "init" | "update" | "chat";

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

type PendingRun = {
  command: "init" | "update";
  cwd: string;
  snapshotBefore: string;
  startedAt: number;
};

let pendingRun: PendingRun | null = null;

export default function openWikiPiNativeExtension(pi: ExtensionAPI) {
  pi.registerCommand("openwiki-init", {
    description: "Generate initial OpenWiki docs with the current Pi agent",
    handler: async (args, ctx) => {
      await startDocumentationRun(pi, ctx, "init", args);
    },
  });

  pi.registerCommand("openwiki-update", {
    description: "Update OpenWiki docs from repo changes with the current Pi agent",
    handler: async (args, ctx) => {
      await startDocumentationRun(pi, ctx, "update", args);
    },
  });

  pi.registerCommand("openwiki-ask", {
    description: "Ask a question using OpenWiki documentation context",
    handler: async (args, ctx) => {
      const question = args.trim();
      if (!question) {
        ctx.ui.notify("Usage: /openwiki-ask <question>", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent is busy. Try again after the current turn finishes.", "warning");
        return;
      }

      const context = await createRunContext("chat", ctx.cwd);
      pi.sendUserMessage(createPiNativeOpenWikiPrompt("chat", ctx.cwd, context, question));
    },
  });

  pi.registerCommand("openwiki-status", {
    description: "Show OpenWiki docs/update status for this repository",
    handler: async (_args, ctx) => {
      const status = await createStatusReport(ctx.cwd);
      ctx.ui.notify(status, "info");
    },
  });

  pi.on("agent_end", async (_event, ctx) => {
    const run = pendingRun;
    if (!run) return;
    if (run.cwd !== ctx.cwd) return;

    pendingRun = null;
    ctx.ui.setStatus(STATUS_KEY, "Finalizing...");

    try {
      const snapshotAfter = await createOpenWikiContentSnapshot(run.cwd);
      if (snapshotAfter !== run.snapshotBefore) {
        await writeLastUpdateMetadata(run.command, run.cwd, getCurrentPiModelLabel(ctx));
        ctx.ui.notify(`OpenWiki ${run.command} completed; metadata updated.`, "success");
      } else {
        ctx.ui.notify(`OpenWiki ${run.command} completed with no documentation changes.`, "info");
      }
    } catch (error) {
      ctx.ui.notify(`OpenWiki metadata finalization failed: ${formatError(error)}`, "error");
    } finally {
      ctx.ui.setStatus(STATUS_KEY, "");
    }
  });
}

async function startDocumentationRun(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  command: "init" | "update",
  args: string,
) {
  if (!ctx.isIdle()) {
    ctx.ui.notify("Agent is busy. Try again after the current turn finishes.", "warning");
    return;
  }

  const userMessage = args.trim();

  if (command === "update" && !userMessage) {
    const noop = await getUpdateNoopStatus(ctx.cwd);
    if (noop.shouldSkip) {
      ctx.ui.notify("No repository changes detected since the last OpenWiki update; skipping.", "info");
      return;
    }
  }

  const context = await createRunContext(command, ctx.cwd);
  const snapshotBefore = await createOpenWikiContentSnapshot(ctx.cwd);
  pendingRun = {
    command,
    cwd: ctx.cwd,
    snapshotBefore,
    startedAt: Date.now(),
  };

  ctx.ui.setStatus(STATUS_KEY, command === "init" ? "Generating docs..." : "Updating docs...");
  pi.sendUserMessage(createPiNativeOpenWikiPrompt(command, ctx.cwd, context, userMessage || null));
}

function createPiNativeOpenWikiPrompt(
  command: OpenWikiCommand,
  cwd: string,
  context: RunContext,
  userMessage: string | null,
): string {
  const task =
    command === "init"
      ? "Generate initial OpenWiki documentation for this repository."
      : command === "update"
        ? "Update the existing OpenWiki documentation for this repository."
        : "Answer the user's OpenWiki-related question using repository evidence.";

  const extra = userMessage?.trim()
    ? `\n\nAdditional user request:\n${userMessage.trim()}`
    : "";

  return `You are OpenWiki running as a Pi-native extension.

Task: ${task}
Repository root: ${cwd}
Documentation directory: /${OPEN_WIKI_DIR}
Metadata file: /${UPDATE_METADATA_PATH}

OpenWiki operating rules:
- Inspect the current codebase and existing /${OPEN_WIKI_DIR} docs before making claims.
- Use repository files, git context, and current implementation as evidence. Do not invent facts.
- Keep documentation useful for both humans and future coding agents.
- Keep the wiki focused and navigable. Prefer a small set of substantive pages over many thin stubs.
- Avoid reading secrets, credential files, .env files, auth files, payload logs, or unrelated private data.
- Treat the current repository root as the only project in scope.
- Use repository-local paths in docs, for example /README.md and /${OPEN_WIKI_DIR}/quickstart.md.
- Ensure top-level AGENTS.md and/or CLAUDE.md mention that OpenWiki docs live in /${OPEN_WIKI_DIR} and that future agents should start from /${OPEN_WIKI_DIR}/quickstart.md.
- Do not manually edit /${UPDATE_METADATA_PATH}; the Pi extension updates it after the run if documentation content changed.

Documentation quality rules:
- For init: create /${OPEN_WIKI_DIR}/quickstart.md plus a compact documentation map for architecture, workflows, operations, integrations, testing, and source maps as relevant to this repo.
- For update: refresh only docs affected by repository changes; preserve useful existing structure.
- Include concrete file paths and commands where helpful.
- If a page would be too thin, merge it into a broader page.
- Prefer accurate concise documentation over exhaustive but generic text.
- Include source maps in docs so future agents can jump to relevant source files.

Run context:
Last update metadata:
${context.lastUpdate ? JSON.stringify(context.lastUpdate, null, 2) : "None"}

Git summary:
${context.gitSummary}${extra}

Now perform the task. Read files as needed, then create or edit files under /${OPEN_WIKI_DIR} and update AGENTS.md/CLAUDE.md guidance when appropriate.`;
}

async function createRunContext(command: OpenWikiCommand, cwd: string): Promise<RunContext> {
  const lastUpdate = await readLastUpdate(cwd);
  if (command === "chat") {
    return { lastUpdate, gitSummary: "Not applicable for chat." };
  }
  return {
    lastUpdate,
    gitSummary: await createGitSummary(command, cwd, lastUpdate),
  };
}

async function createGitSummary(
  command: OpenWikiCommand,
  cwd: string,
  lastUpdate: UpdateMetadata | null,
): Promise<string> {
  const lines: string[] = [];
  lines.push("## Working tree status");
  lines.push(await runGitOrFallback(cwd, ["status", "--short", "--untracked-files=all"]));
  lines.push("\n## Current HEAD");
  lines.push(await runGitOrFallback(cwd, ["rev-parse", "HEAD"]));

  if (command === "update" && lastUpdate?.gitHead) {
    lines.push(`\n## Changes since last OpenWiki git head (${lastUpdate.gitHead})`);
    lines.push(await runGitOrFallback(cwd, ["log", `${lastUpdate.gitHead}..HEAD`, "--name-status", "--oneline"]));
  } else if (command === "update" && lastUpdate?.updatedAt) {
    lines.push(`\n## Changes since last OpenWiki timestamp (${lastUpdate.updatedAt})`);
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
  const lastUpdate = await readLastUpdate(cwd);
  if (!lastUpdate?.gitHead) return { shouldSkip: false, reason: "missing previous update git head" };

  const head = await getGitHead(cwd);
  if (!head) return { shouldSkip: false, reason: "missing current git head" };

  const status = await runGit(cwd, ["status", "--short", "--untracked-files=all"]);
  const meaningfulStatus = status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !line.includes(UPDATE_METADATA_PATH));

  if (meaningfulStatus.length > 0) return { shouldSkip: false, reason: "worktree has changes" };

  if (head !== lastUpdate.gitHead) {
    const changedPaths = await getChangedPathsSince(cwd, lastUpdate.gitHead);
    if (changedPaths.length === 0 || changedPaths.some((changedPath) => !isOpenWikiPath(changedPath))) {
      return { shouldSkip: false, reason: "git head changed" };
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

async function createOpenWikiContentSnapshot(cwd: string): Promise<string> {
  const hash = createHash("sha256");
  await addPathToSnapshot(hash, path.join(cwd, OPEN_WIKI_DIR), "");
  return hash.digest("hex");
}

async function addPathToSnapshot(hash: ReturnType<typeof createHash>, absolutePath: string, relativePath: string): Promise<void> {
  let info;
  try {
    info = await stat(absolutePath);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      hash.update("missing");
      return;
    }
    throw error;
  }

  if (info.isDirectory()) {
    hash.update(`dir:${relativePath}\0`);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelativePath = path.join(relativePath, entry.name);
      if (childRelativePath === path.basename(UPDATE_METADATA_PATH)) continue;
      await addPathToSnapshot(hash, path.join(absolutePath, entry.name), childRelativePath);
    }
    return;
  }

  if (info.isFile()) {
    hash.update(`file:${relativePath}\0`);
    hash.update(await readFile(absolutePath));
    hash.update("\0");
  }
}

async function createStatusReport(cwd: string): Promise<string> {
  const lastUpdate = await readLastUpdate(cwd);
  const head = await getGitHead(cwd);
  const docsExists = await pathExists(path.join(cwd, OPEN_WIKI_DIR));
  const snapshot = await createOpenWikiContentSnapshot(cwd);
  const noop = await getUpdateNoopStatus(cwd);

  return [
    "OpenWiki status",
    `- cwd: ${cwd}`,
    `- docs: ${docsExists ? `/${OPEN_WIKI_DIR} exists` : `/${OPEN_WIKI_DIR} missing`}`,
    `- git head: ${head ?? "unavailable"}`,
    `- docs snapshot: ${snapshot}`,
    `- last update: ${lastUpdate ? JSON.stringify(lastUpdate) : "none"}`,
    `- update no-op: ${noop.shouldSkip ? "yes" : `no (${noop.reason})`}`,
  ].join("\n");
}

async function getGitHead(cwd: string): Promise<string | undefined> {
  const head = await runGitOrFallback(cwd, ["rev-parse", "HEAD"], "");
  return head.trim() || undefined;
}

async function getChangedPathsSince(cwd: string, ref: string): Promise<string[]> {
  const output = await runGitOrFallback(cwd, ["diff", "--name-only", `${ref}..HEAD`], "");
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function isOpenWikiPath(value: string): boolean {
  return value === OPEN_WIKI_DIR || value.startsWith(`${OPEN_WIKI_DIR}/`);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024,
  });
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

function getCurrentPiModelLabel(ctx: ExtensionContext): string {
  const maybeCtx = ctx as unknown as { model?: { provider?: string; id?: string; name?: string }; getModel?: () => unknown };
  const model = maybeCtx.model;
  if (model?.provider && model?.id) return `${model.provider}/${model.id}`;
  if (model?.name) return model.name;
  return "pi-current-model";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
