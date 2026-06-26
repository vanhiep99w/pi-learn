import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, ensureDir } from "../storage/atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "../storage/harness-home.js";

export function writeDraftProposals({ config, project, proposals }) {
  const draftDir = proposalsDraftDir(config, project.projectKey);
  ensureDir(draftDir);

  const existing = readDraftProposals({ config, project });
  const existingFingerprints = new Set(existing.map((proposal) => proposal.fingerprint).filter(Boolean));
  const written = [];
  const skipped = [];
  let nextNumber = nextProposalNumber(existing);

  for (const proposal of proposals ?? []) {
    if (proposal.fingerprint && existingFingerprints.has(proposal.fingerprint)) {
      skipped.push({ ...proposal, reason: "duplicate_fingerprint" });
      continue;
    }

    const id = proposal.id ?? `P-${String(nextNumber++).padStart(4, "0")}`;
    const finalProposal = { ...proposal, id, status: proposal.status ?? "draft" };
    const filePath = path.join(draftDir, `${id}-${slugify(proposal.title)}.md`);
    atomicWriteFile(filePath, renderProposalMarkdown(finalProposal));
    existingFingerprints.add(proposal.fingerprint);
    written.push({ ...finalProposal, filePath });
  }

  return { draftDir, written, skipped };
}

export function readDraftProposals({ config, project }) {
  const draftDir = proposalsDraftDir(config, project.projectKey);
  if (!fs.existsSync(draftDir)) return [];

  return fs.readdirSync(draftDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const filePath = path.join(draftDir, name);
      const markdown = fs.readFileSync(filePath, "utf8");
      const frontmatter = parseFrontmatter(markdown);
      return {
        ...frontmatter,
        id: frontmatter.id ?? name.match(/^(P-\d+)/)?.[1],
        title: extractTitle(markdown) ?? frontmatter.title,
        filePath,
      };
    });
}

export function findDraftProposal({ config, project, id }) {
  return readDraftProposals({ config, project }).find((proposal) => proposal.id === id);
}

export function renderProposalMarkdown(proposal) {
  const evidence = proposal.evidence ?? [];
  const lines = [];
  lines.push("---");
  lines.push(`id: ${proposal.id}`);
  lines.push(`status: ${proposal.status ?? "draft"}`);
  lines.push(`target: ${proposal.target}`);
  lines.push(`risk: ${proposal.risk}`);
  lines.push(`rule_id: ${proposal.ruleId}`);
  lines.push(`fingerprint: ${proposal.fingerprint}`);
  lines.push(`created: ${proposal.createdAt ?? new Date().toISOString()}`);
  lines.push(`evidence_count: ${evidence.length}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${proposal.id} — ${proposal.title}`);
  lines.push("");
  lines.push("## Problem");
  lines.push(proposal.problem ?? "");
  lines.push("");
  lines.push("## Evidence");
  if (evidence.length) {
    for (const item of evidence) {
      lines.push(`- session: ${item.sessionId ?? "unknown"}`);
      lines.push(`  entry: ${item.entryId ?? "unknown"}`);
      lines.push(`  kind: ${item.kind ?? "unknown"}`);
      if (item.reason) lines.push(`  reason: ${item.reason}`);
      if (item.timestamp) lines.push(`  timestamp: ${item.timestamp}`);
      if (item.excerpt) lines.push(`  excerpt: ${quoteEvidence(item.excerpt)}`);
      if (item.sessionFile) lines.push(`  rawRef: ${item.sessionFile}`);
    }
  } else {
    lines.push("- No evidence attached.");
  }
  lines.push("");
  lines.push("## Proposed change");
  lines.push(proposal.proposedChange ?? "");
  lines.push("");
  lines.push("## Target files");
  for (const file of proposal.targetFiles ?? []) lines.push(`- ${file}`);
  if (!proposal.targetFiles?.length) lines.push("- TBD");
  lines.push("");
  const patches = normalizePatchesForRender(proposal.patch ?? proposal.patches);
  if (patches.length) {
    lines.push("## Patch");
    lines.push("```json");
    lines.push(JSON.stringify(patches, null, 2));
    lines.push("```");
    lines.push("");
  }
  lines.push("## Risk");
  lines.push(proposal.risk ?? "unknown");
  lines.push("");
  lines.push("## Test plan");
  for (const item of proposal.testPlan ?? []) lines.push(`- ${item}`);
  if (!proposal.testPlan?.length) lines.push("- TBD");
  lines.push("");
  lines.push("## Rollback");
  lines.push(proposal.rollbackPlan ?? "Revert the proposal commit.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function proposalsDraftDir(config, projectKey) {
  return path.join(projectCacheDir(resolveHarnessHome(config), projectKey), "proposals", "draft");
}

function normalizePatchesForRender(value) {
  if (!value) return [];
  const patches = Array.isArray(value) ? value : [value];
  return patches.filter((patch) => patch && typeof patch === "object").map((patch) => ({
    path: String(patch.path ?? ""),
    oldText: String(patch.oldText ?? ""),
    newText: String(patch.newText ?? ""),
  })).filter((patch) => patch.path && patch.oldText);
}

function nextProposalNumber(existing) {
  const max = existing.reduce((value, proposal) => {
    const match = proposal.id?.match(/^P-(\d+)$/);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return max + 1;
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) return {};
  const body = markdown.slice(4, end).trim();
  const result = {};
  for (const line of body.split("\n")) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    result[camelKey(key)] = coerceFrontmatterValue(value);
  }
  return result;
}

function extractTitle(markdown) {
  const line = markdown.split("\n").find((item) => item.startsWith("# "));
  if (!line) return undefined;
  return line.replace(/^#\s+(?:P-\d+\s+—\s+)?/, "").trim();
}

function coerceFrontmatterValue(value) {
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function camelKey(key) {
  return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function quoteEvidence(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, "\\\"")}"`;
}

function slugify(value) {
  return String(value ?? "proposal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "proposal";
}
