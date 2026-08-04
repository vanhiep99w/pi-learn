import crypto from "node:crypto";
import { loadDataset } from "../analysis/rules.js";

export function generateTargetedImprovements({ project, sessionResults, target }) {
  if (target !== "memory") {
    throw new Error(`Deterministic target ${target} must use the shared candidate review gate`);
  }
  const dataset = loadDataset(sessionResults);
  return generateMemoryImprovements({ project, dataset });
}

function generateMemoryImprovements({ project, dataset }) {
  const groups = new Map();
  for (const event of dataset.events) {
    if (!event.activePath || event.kind !== "user_message") continue;
    const text = `${event.excerpt ?? ""}`;
    const candidates = memoryCandidatesFromText(text);
    for (const candidate of candidates) {
      if (!groups.has(candidate.key)) groups.set(candidate.key, { ...candidate, evidence: [] });
      groups.get(candidate.key).evidence.push(evidenceFromEvent(event));
    }
  }

  const memoryItems = [...groups.values()].map((candidate) => {
    const fingerprint = stableHash(`memory|${project.projectKey}|${candidate.key}`);
    return {
      schemaVersion: 1,
      scope: "project",
      projectKey: project.projectKey,
      kind: candidate.kind,
      text: candidate.text,
      evidence: candidate.evidence.slice(0, 8),
      confidence: candidate.evidence.length >= 2 ? "high" : "medium",
      status: "draft",
      fingerprint,
    };
  });

  const proposals = memoryItems.map((item) => ({
    ruleId: "M-IMPROVE-0001",
    title: `Add curated memory: ${shortTitle(item.text)}`,
    target: "memory",
    targetFiles: ["harness/memory/items.jsonl", "harness/memory/project-facts.md"],
    risk: "low",
    problem: `Session evidence suggests a stable project memory candidate: ${item.text}`,
    proposedChange: "Review and approve this memory item into project harness memory if it is stable, non-secret, and useful across future sessions.",
    testPlan: [
      "Verify the memory text is accurate and does not contain secrets or temporary task details.",
      "Check AGENTS.md to avoid duplicating an existing rule.",
      "If approved, commit the reviewed memory artifact only, not raw session logs.",
    ],
    rollbackPlan: "Remove or mark the memory item as rejected/superseded if it becomes stale or noisy.",
    evidence: item.evidence,
    fingerprint: stableHash(`proposal|memory|${item.fingerprint}`),
  }));

  return { proposals, memoryItems };
}

function memoryCandidatesFromText(text) {
  const candidates = [];
  if (/packages\/pi-learn-extensions/.test(text)) {
    candidates.push({
      key: "public_extension_source",
      kind: "project_fact",
      text: "Public Pi extension/theme source for this repo is under packages/pi-learn-extensions/.",
    });
  }
  if (/\.pi\/logs|llm-payload/i.test(text)) {
    candidates.push({
      key: "protect_pi_llm_payload_logs",
      kind: "safety_rule",
      text: "Do not read, commit, or share .pi/logs/llm-payloads content unless the user explicitly asks.",
    });
  }
  if (/docs\//i.test(text) && /tiếng việt|vietnamese/i.test(text)) {
    candidates.push({
      key: "docs_vietnamese",
      kind: "project_fact",
      text: "Project docs under docs/ are Vietnamese user-facing Pi documentation; update docs/README.md when adding docs.",
    });
  }
  if (/harness runtime|packages\/harness-runtime/i.test(text)) {
    candidates.push({
      key: "harness_runtime_location",
      kind: "project_fact",
      text: "Harness runtime implementation lives in packages/harness-runtime, while pi-harness/ contains design docs/specs.",
    });
  }
  return candidates;
}

function evidenceFromEvent(event) {
  return {
    sessionId: event.sessionId,
    sessionFile: event.sessionFile,
    entryId: event.entryId,
    timestamp: event.timestamp,
    kind: event.kind,
    excerpt: truncateEvidence(firstNonEmpty(event.excerpt, event.summary)),
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? "";
}

function truncateEvidence(text, max = 500) {
  const value = String(text ?? "").replace(/\r?\n/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 16)}...<truncated>`;
}

function shortTitle(text) {
  return String(text ?? "memory item").slice(0, 80);
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}
