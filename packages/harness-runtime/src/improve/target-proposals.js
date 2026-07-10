import crypto from "node:crypto";
import { loadDataset } from "../analysis/rules.js";

export function generateTargetedImprovements({ project, sessionResults, target }) {
  const dataset = loadDataset(sessionResults);
  switch (target) {
    case "memory":
      return generateMemoryImprovements({ project, dataset });
    case "rules":
      return { proposals: generateRuleImprovementProposals({ dataset }), memoryItems: [] };
    case "parser":
      return { proposals: generateParserImprovementProposals({ dataset }), memoryItems: [] };
    case "redaction":
      return { proposals: generateRedactionImprovementProposals({ dataset }), memoryItems: [] };
    default:
      throw new Error(`Unsupported propose target: ${target}`);
  }
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

function generateRuleImprovementProposals({ dataset }) {
  const proposals = [];
  const editErrors = dataset.events
    .filter((event) => event.activePath && event.kind === "tool_result" && event.tool?.name === "edit" && event.tool?.isError)
    .map(evidenceFromEvent);
  if (editErrors.length >= 2) {
    proposals.push({
      ruleId: "RULE-IMPROVE-0001",
      title: "Add global prompt rule for repeated edit tool failures",
      target: "rules",
      targetFiles: ["wiki/_rules.md"],
      risk: "low",
      problem: `Edit tool failures appeared ${editErrors.length} times. The repeated workflow needs concise reviewed guidance before future edits.`,
      proposedChange: "Add a Markdown prompt rule that requires re-reading the target block and verifying exact, unique oldText before retrying edit.",
      testPlan: [
        "Review the new rule ID, scope, instruction and checklist in `wiki/_rules.md`.",
        "Run `npm --prefix packages/harness-runtime test`.",
        "Run `/harness-eval wiki-prompt-rule-lazy-loading`.",
      ],
      rollbackPlan: "Revert the Markdown rule patch if it creates noisy or misleading edit guidance.",
      evidence: editErrors.slice(0, 8),
      fingerprint: stableHash(`rules|edit_tool_failure|${editErrors.map((item) => item.entryId).join("|")}`),
    });
  }

  const bashFailures = dataset.events.filter((event) => event.activePath && isBashFailure(event)).map(evidenceFromEvent);
  if (bashFailures.length >= 2) {
    proposals.push({
      ruleId: "RULE-IMPROVE-0002",
      title: "Add operations prompt rule for repeated bash failures",
      target: "rules",
      targetFiles: ["wiki/operations/_rules.md"],
      risk: "low",
      problem: `Bash failures appeared ${bashFailures.length} times. Future operations tasks need reviewed retry and prerequisite guidance.`,
      proposedChange: "Add a Markdown prompt rule that requires inspecting command prerequisites and failure output before retrying. Keep detector thresholds in runtime code.",
      testPlan: [
        "Review the rule scope in `wiki/operations/_rules.md`.",
        "Run `npm --prefix packages/harness-runtime test`.",
        "Run `/harness-eval wiki-prompt-rule-section-routing`.",
      ],
      rollbackPlan: "Revert the Markdown rule patch if it creates false or overly broad guidance.",
      evidence: bashFailures.slice(0, 8),
      fingerprint: stableHash(`rules|bash_failure|${bashFailures.map((item) => item.entryId).join("|")}`),
    });
  }

  return proposals;
}

function generateParserImprovementProposals({ dataset }) {
  const groups = new Map();
  for (const warning of dataset.warnings) {
    const key = warning.code ?? "unknown_warning";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(evidenceFromWarning(warning));
  }

  return [...groups.entries()].map(([code, evidence]) => ({
    ruleId: "PARSER-IMPROVE-0001",
    title: `Improve parser handling for ${code}`,
    target: "parser",
    targetFiles: ["packages/harness-runtime/src/session/parse-session.js", "packages/harness-runtime/src/session/warnings.js", "packages/harness-runtime/tests/parse-tree.test.js"],
    risk: "medium",
    problem: `Parser/normalizer warning \`${code}\` appeared ${evidence.length} times.`,
    proposedChange: "Add explicit parser handling or a fixture documenting expected behavior for this warning shape.",
    testPlan: [
      "Add a focused parser fixture for this warning.",
      "Run `npm --prefix packages/harness-runtime test`.",
      "Run `/harness-warnings 5` in Pi and compare warnings count.",
    ],
    rollbackPlan: "Revert parser changes if active path or event normalization becomes less accurate.",
    evidence: evidence.slice(0, 8),
    fingerprint: stableHash(`parser|${code}|${evidence.map((item) => item.entryId).join("|")}`),
  }));
}

function generateRedactionImprovementProposals({ dataset }) {
  const evidence = dataset.events
    .filter((event) => event.activePath && (event.safety?.secretDetected || event.safety?.sensitivePath))
    .map((event) => evidenceFromEvent(event, { excerpt: firstNonEmpty(event.excerpt, event.summary, JSON.stringify(event.files ?? event.tool?.argsPreview ?? {})) }));

  if (!evidence.length) return [];
  return [{
    ruleId: "REDACTION-IMPROVE-0001",
    title: "Review redaction and sensitive path policy from flagged events",
    target: "redaction",
    targetFiles: ["packages/harness-runtime/src/safety/redaction.js", "packages/harness-runtime/tests/redaction.test.js", "AGENTS.md"],
    risk: "high",
    problem: `Normalized cache flagged ${evidence.length} secret/sensitive-path event(s).`,
    proposedChange: "Review whether current redaction patterns and sensitive path patterns need a new fixture, path guard, or stricter policy.",
    testPlan: [
      "Add redaction fixtures for any new token/path pattern.",
      "Run `npm --prefix packages/harness-runtime test`.",
      "Run scan/report and confirm no raw secrets appear in normalized outputs.",
    ],
    rollbackPlan: "Revert redaction policy changes if they over-redact useful non-secret evidence or block legitimate local inspection.",
    evidence: evidence.slice(0, 8),
    fingerprint: stableHash(`redaction|${evidence.map((item) => `${item.sessionId}:${item.entryId}`).join("|")}`),
  }];
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

function isBashFailure(event) {
  return event.kind === "bash_execution" ? Number(event.bash?.exitCode ?? 0) !== 0 : event.kind === "tool_result" && event.tool?.name === "bash" && event.tool?.isError;
}

function evidenceFromEvent(event, overrides = {}) {
  return {
    sessionId: event.sessionId,
    sessionFile: event.sessionFile,
    entryId: event.entryId,
    timestamp: event.timestamp,
    kind: event.kind,
    excerpt: truncateEvidence(firstNonEmpty(overrides.excerpt, event.excerpt, event.summary)),
  };
}

function evidenceFromWarning(warning) {
  return {
    sessionId: warning.sessionId,
    sessionFile: warning.sessionFile,
    entryId: warning.entryId,
    timestamp: warning.timestamp,
    kind: warning.code,
    excerpt: truncateEvidence(warning.message),
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
