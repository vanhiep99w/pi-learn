import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { atomicWriteFile, ensureDir } from "../storage/atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "../storage/harness-home.js";
import { findDraftProposal } from "./proposal-writer.js";
import { discoverWikiPromptRules, isWikiRulePath } from "../analysis/wiki-prompt-rules.js";

const VALID_STATUS = new Set(["draft", "approved", "rejected", "applied", "rolled_back"]);

export function approveProposal({ config, project, id, logger }) {
  return transitionProposal({ config, project, id, status: "approved", event: "proposal_approved", logger });
}

export function rejectProposal({ config, project, id, logger }) {
  return transitionProposal({ config, project, id, status: "rejected", event: "proposal_rejected", logger });
}

export function rollbackProposal({ config, project, id, logger }) {
  const proposal = requireProposal({ config, project, id });
  const events = readProposalHistory({ config, project, id });
  const applied = [...events].reverse().find((event) => event.event === "proposal_applied");
  if (!applied) throw cliLikeError(`Proposal has no apply history: ${id}`);

  const git = gitContext(project);

  const commitHash = applied.commitHash ?? applied.data?.commitHash;
  const changedPaths = applied.changedPaths ?? applied.data?.changedPaths ?? [];
  if (commitHash) {
    ensureCleanWorktree(git, { allowDirty: false });
    const revert = runGit(git, ["revert", "--no-edit", commitHash]);
    if (revert.status !== 0) throw cliLikeError(`git revert failed: ${revert.stderr || revert.stdout}`);
  } else {
    const paths = changedPaths;
    if (!paths.length) throw cliLikeError(`Apply history has no changed paths: ${id}`);
    ensureOnlyExpectedPathsDirty(git, paths);
    const checkout = runGit(git, ["checkout", "--", ...paths]);
    if (checkout.status !== 0) throw cliLikeError(`git checkout rollback failed: ${checkout.stderr || checkout.stdout}`);
  }

  const updated = updateProposalStatusFile(proposal.filePath, "rolled_back");
  const event = appendProposalHistory({
    config,
    project,
    proposal: updated,
    event: "proposal_rolled_back",
    data: { rolledBackCommit: commitHash, changedPaths },
  });
  logLifecycle(logger, project, event);
  return { proposal: updated, historyEvent: event };
}

export function applyProposal({ config, project, id, allowDirty = false, commit = false, logger }) {
  const proposal = requireProposal({ config, project, id });
  if (proposal.status !== "approved") {
    throw cliLikeError(`Proposal must be approved before apply: ${id} (status: ${proposal.status ?? "unknown"})`);
  }

  const markdown = fs.readFileSync(proposal.filePath, "utf8");
  const targetFiles = parseTargetFiles(markdown);
  const patches = parsePatchSection(markdown);
  if (!patches.length) {
    throw cliLikeError(`Proposal has no machine-applicable patch section: ${id}. Add a ## Patch JSON block first.`);
  }

  const git = gitContext(project);
  ensureCleanWorktree(git, { allowDirty });
  const branchName = `harness/${id}`;
  checkoutBranch(git, branchName);

  const appliedPatch = applyTextPatches({ projectRoot: project.projectRoot, targetFiles, patches });
  const { changedPaths } = appliedPatch;
  try {
    validateChangedPromptRules({ projectRoot: project.projectRoot, changedPaths });
  } catch (error) {
    restoreOriginalFiles(appliedPatch.originals);
    throw error;
  }
  const diff = runGit(git, ["diff", "--", ...changedPaths]).stdout;

  let commitHash;
  if (commit) {
    const add = runGit(git, ["add", "--", ...changedPaths]);
    if (add.status !== 0) throw cliLikeError(`git add failed: ${add.stderr || add.stdout}`);
    const commitResult = runGit(git, ["commit", "-m", `harness: apply ${id}`, "-m", `Proposal: ${id}\nEvidence: ${proposal.evidenceCount ?? "unknown"} refs`]);
    if (commitResult.status !== 0) throw cliLikeError(`git commit failed: ${commitResult.stderr || commitResult.stdout}`);
    commitHash = runGit(git, ["rev-parse", "HEAD"]).stdout.trim();
  }

  const updated = updateProposalStatusFile(proposal.filePath, "applied");
  const event = appendProposalHistory({
    config,
    project,
    proposal: updated,
    event: "proposal_applied",
    data: { branchName, changedPaths, committed: Boolean(commit), commitHash },
  });
  logLifecycle(logger, project, event);
  return { proposal: updated, historyEvent: event, branchName, changedPaths, diff, commitHash };
}

export function readProposalHistory({ config, project, id } = {}) {
  const historyPath = proposalsHistoryPath(config, project.projectKey);
  if (!fs.existsSync(historyPath)) return [];
  return fs.readFileSync(historyPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => !id || event.proposalId === id);
}

export function proposalsHistoryPath(config, projectKey) {
  return path.join(projectCacheDir(resolveHarnessHome(config), projectKey), "proposals", "history.jsonl");
}

export function parseTargetFiles(markdown) {
  const section = extractSection(markdown, "Target files");
  return section
    .split("\n")
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1])
    .filter(Boolean)
    .filter((item) => item !== "TBD");
}

export function parsePatchSection(markdown) {
  const section = extractSection(markdown, "Patch");
  if (!section.trim()) return [];
  const fenced = section.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i)?.[1] ?? section.trim();
  const parsed = JSON.parse(fenced);
  const patches = Array.isArray(parsed) ? parsed : [parsed];
  for (const patch of patches) {
    if (!patch || typeof patch.path !== "string" || typeof patch.oldText !== "string" || typeof patch.newText !== "string") {
      throw cliLikeError("Patch entries must include string path, oldText and newText fields.");
    }
  }
  return patches;
}

function transitionProposal({ config, project, id, status, event, logger }) {
  if (!VALID_STATUS.has(status)) throw cliLikeError(`Invalid proposal status: ${status}`);
  const proposal = requireProposal({ config, project, id });
  if (proposal.status === "applied" && status !== "rolled_back") throw cliLikeError(`Applied proposal cannot transition to ${status}: ${id}`);
  const updated = updateProposalStatusFile(proposal.filePath, status);
  const historyEvent = appendProposalHistory({ config, project, proposal: updated, event, data: { previousStatus: proposal.status ?? "draft", status } });
  logLifecycle(logger, project, historyEvent);
  return { proposal: updated, historyEvent };
}

function requireProposal({ config, project, id }) {
  const proposal = findDraftProposal({ config, project, id });
  if (!proposal) throw cliLikeError(`Proposal not found: ${id}`);
  return proposal;
}

function updateProposalStatusFile(filePath, status) {
  const markdown = fs.readFileSync(filePath, "utf8");
  const updatedAt = new Date().toISOString();
  const updated = replaceFrontmatterValue(replaceFrontmatterValue(markdown, "status", status), "updated", updatedAt);
  atomicWriteFile(filePath, updated);
  return {
    ...parseBasicFrontmatter(updated),
    id: parseBasicFrontmatter(updated).id ?? path.basename(filePath).match(/^(P-\d+)/)?.[1],
    title: extractTitle(updated),
    filePath,
  };
}

function appendProposalHistory({ config, project, proposal, event, data = {} }) {
  const historyPath = proposalsHistoryPath(config, project.projectKey);
  ensureDir(path.dirname(historyPath));
  const entry = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    projectKey: project.projectKey,
    proposalId: proposal.id,
    event,
    status: proposal.status,
    target: proposal.target,
    risk: proposal.risk,
    filePath: proposal.filePath,
    data,
  };
  fs.appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
  return entry;
}

function gitContext(project) {
  const cwd = project.gitRoot ?? project.projectRoot;
  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (probe.status !== 0) throw cliLikeError("Controlled apply requires a git repository.");
  return { cwd: probe.stdout.trim() };
}

function ensureCleanWorktree(git, { allowDirty }) {
  if (allowDirty) return;
  const status = runGit(git, ["status", "--porcelain"]);
  if (status.status !== 0) throw cliLikeError(`git status failed: ${status.stderr || status.stdout}`);
  const dirty = status.stdout.trim();
  if (dirty) {
    const preview = dirty.split("\n").slice(0, 10).join("\n");
    const more = dirty.split("\n").length > 10 ? "\n..." : "";
    throw cliLikeError(`Git worktree is not clean. Commit/stash changes or pass --allow-dirty.\n\nDirty files:\n${preview}${more}`);
  }
}

function ensureOnlyExpectedPathsDirty(git, expectedPaths) {
  const status = runGit(git, ["status", "--porcelain"]);
  if (status.status !== 0) throw cliLikeError(`git status failed: ${status.stderr || status.stdout}`);
  const expected = new Set(expectedPaths.map(normalizeRelativePath));
  const dirty = status.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => normalizeRelativePath(line.slice(3).trim().replace(/^"|"$/g, "")));
  const unexpected = dirty.filter((item) => !expected.has(item));
  if (unexpected.length) throw cliLikeError(`Rollback refused because unrelated files are dirty: ${unexpected.join(", ")}`);
}

function checkoutBranch(git, branchName) {
  const current = runGit(git, ["branch", "--show-current"]);
  if (current.stdout.trim() === branchName) return;
  const existing = runGit(git, ["rev-parse", "--verify", branchName]);
  const args = existing.status === 0 ? ["checkout", branchName] : ["checkout", "-b", branchName];
  const result = runGit(git, args);
  if (result.status !== 0) throw cliLikeError(`git checkout branch failed: ${result.stderr || result.stdout}`);
}

function applyTextPatches({ projectRoot, targetFiles, patches }) {
  const changed = [];
  const originals = new Map();
  const root = fs.realpathSync(projectRoot);

  try {
    for (const patch of patches) {
      assertAllowedTarget(patch.path, targetFiles);
      const normalizedPath = normalizeRelativePath(patch.path);
      const filePath = path.resolve(root, normalizedPath);
      if (!isPathInside(root, filePath)) throw cliLikeError(`Patch path escapes project root: ${patch.path}`);
      if (!fs.existsSync(filePath)) throw cliLikeError(`Patch target file not found: ${patch.path}`);
      if (fs.lstatSync(filePath).isSymbolicLink()) throw cliLikeError(`Patch target cannot be a symlink: ${patch.path}`);
      const realFilePath = fs.realpathSync(filePath);
      if (!isPathInside(root, realFilePath)) throw cliLikeError(`Patch target resolves outside project root: ${patch.path}`);

      const original = fs.readFileSync(filePath, "utf8");
      if (!originals.has(filePath)) originals.set(filePath, original);
      const matches = countOccurrences(original, patch.oldText);
      if (matches !== 1) throw cliLikeError(`Patch oldText must match exactly once in ${patch.path}; found ${matches}.`);
      atomicWriteFile(filePath, original.replace(patch.oldText, patch.newText));
      changed.push(normalizedPath);
    }
  } catch (error) {
    restoreOriginalFiles(originals);
    throw error;
  }

  return { changedPaths: [...new Set(changed)], originals };
}

function validateChangedPromptRules({ projectRoot, changedPaths }) {
  if (!changedPaths.some(isWikiRulePath)) return;
  const report = discoverWikiPromptRules({ projectRoot });
  if (report.valid) return;
  const details = report.errors.slice(0, 8).map((item) => `- ${item.path}: ${item.message}`).join("\n");
  throw cliLikeError(`Prompt-rule validation failed after apply. Changes were restored.\n${details}`);
}

function restoreOriginalFiles(originals) {
  for (const [filePath, content] of originals) atomicWriteFile(filePath, content);
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertAllowedTarget(patchPath, targetFiles) {
  const normalized = normalizeRelativePath(patchPath);
  if (!targetFiles.length) throw cliLikeError("Proposal target file list is empty; refusing to apply patch.");
  const allowed = targetFiles.some((target) => {
    const item = normalizeRelativePath(target);
    return item.endsWith("/") ? normalized.startsWith(item) : normalized === item;
  });
  if (!allowed) throw cliLikeError(`Patch target is not listed in proposal target files: ${patchPath}`);
}

function normalizeRelativePath(value) {
  const normalized = String(value).replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.isAbsolute(normalized) || normalized.includes("../") || normalized === "..") throw cliLikeError(`Unsafe relative path: ${value}`);
  return normalized;
}

function extractSection(markdown, heading) {
  const pattern = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "mi");
  const match = pattern.exec(markdown);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function replaceFrontmatterValue(markdown, key, value) {
  if (!markdown.startsWith("---\n")) throw cliLikeError("Proposal markdown missing frontmatter.");
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) throw cliLikeError("Proposal markdown frontmatter is not closed.");
  const body = markdown.slice(4, end);
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index >= 0) lines[index] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---${markdown.slice(end + 4)}`;
}

function parseBasicFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) return {};
  const result = {};
  for (const line of markdown.slice(4, end).trim().split("\n")) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    result[key] = line.slice(index + 1).trim();
  }
  return result;
}

function extractTitle(markdown) {
  const line = markdown.split("\n").find((item) => item.startsWith("# "));
  if (!line) return undefined;
  return line.replace(/^#\s+(?:P-\d+\s+—\s+)?/, "").trim();
}

function runGit(git, args) {
  return spawnSync("git", args, { cwd: git.cwd, encoding: "utf8" });
}

function countOccurrences(text, search) {
  if (!search) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(search, index)) >= 0) {
    count += 1;
    index += search.length;
  }
  return count;
}

function logLifecycle(logger, project, event) {
  logger?.audit?.(event.event, `Proposal lifecycle event: ${event.event}`, {
    component: "proposal",
    projectKey: project.projectKey,
    proposalId: event.proposalId,
    data: event.data,
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cliLikeError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}
