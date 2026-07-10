import crypto from "node:crypto";
import fs from "node:fs";

const BUILT_IN_RULES = [
  { id: "R-0001", name: "Repeated bash failure", enabled: true, params: { minOccurrences: 2 } },
  { id: "R-0002", name: "Repeated tool error", enabled: true, params: { minOccurrences: 2 } },
  { id: "R-0003", name: "Sensitive path access", enabled: true, params: { minOccurrences: 1 } },
  { id: "R-0004", name: "Parser warning pattern", enabled: true, params: { minOccurrences: 1 } },
];

export function runRuleEngine({ project, sessionResults, ruleConfig }) {
  const dataset = loadDataset(sessionResults);
  const rules = ruleConfig ?? loadRuleConfig({ project });
  const proposals = [
    ...detectRepeatedBashFailures({ project, dataset, rule: rules.get("R-0001") }),
    ...detectRepeatedToolErrors({ project, dataset, rule: rules.get("R-0002") }),
    ...detectSensitivePathAccess({ project, dataset, rule: rules.get("R-0003") }),
    ...detectParserWarnings({ project, dataset, rule: rules.get("R-0004") }),
  ];

  return proposals.map((proposal) => ({
    ...proposal,
    fingerprint: proposal.fingerprint ?? fingerprintProposal(proposal),
    status: "draft",
    createdAt: proposal.createdAt ?? new Date().toISOString(),
  }));
}

export function loadRuleConfig() {
  // Detector defaults are executable runtime behavior. Project prompt rules live
  // in wiki/**/_rules.md and are never parsed as detector configuration.
  return new Map(BUILT_IN_RULES.map((rule) => [rule.id, structuredClone(rule)]));
}

export function loadDataset(sessionResults) {
  const events = [];
  const warnings = [];
  const toolCallsBySessionCallId = new Map();

  for (const result of sessionResults ?? []) {
    const sessionEvents = readJsonl(result.paths?.events).map((event) => ({
      ...event,
      sessionId: event.sessionId ?? result.sessionId,
      sessionFile: event.sessionFile ?? result.sessionFile,
    }));
    const sessionWarnings = (result.warnings ?? readJsonl(result.paths?.warnings)).map((warning) => ({
      ...warning,
      sessionId: warning.sessionId ?? result.sessionId,
      sessionFile: warning.sessionFile ?? result.sessionFile,
    }));

    for (const event of sessionEvents) {
      events.push(event);
      if (event.kind === "assistant_tool_call" && event.tool?.callId) {
        toolCallsBySessionCallId.set(callKey(event.sessionId, event.tool.callId), event);
      }
    }
    warnings.push(...sessionWarnings);
  }

  return { events, warnings, toolCallsBySessionCallId };
}

function detectRepeatedBashFailures({ dataset, rule }) {
  if (!rule?.enabled) return [];
  const minOccurrences = rule.params?.minOccurrences ?? 2;
  const groups = new Map();

  for (const event of dataset.events) {
    if (!event.activePath) continue;
    if (!isBashFailure(event)) continue;

    const call = event.tool?.callId ? dataset.toolCallsBySessionCallId.get(callKey(event.sessionId, event.tool.callId)) : undefined;
    const command = event.bash?.command ?? call?.tool?.argsPreview?.command ?? call?.tool?.argsPreview?.cmd ?? "bash";
    const key = normalizeCommandFamily(command);
    pushGroup(groups, key, evidenceFromEvent(event, { excerpt: firstNonEmpty(event.excerpt, event.summary, command) }));
  }

  return [...groups.entries()]
    .filter(([, evidence]) => evidence.length >= minOccurrences)
    .map(([commandFamily, evidence]) => ({
      ruleId: "R-0001",
      title: `Add checklist for repeated bash failure: ${commandFamily}`,
      target: "rules",
      targetFiles: ["wiki/operations/_rules.md"],
      risk: "low",
      problem: `Bash command family \`${commandFamily}\` failed ${evidence.length} times in active session paths.`,
      proposedChange: "Add a concise reviewed prompt rule/checklist so future tasks verify command prerequisites and inspect failure output before retrying.",
      testPlan: [
        "Review the new prompt rule for a narrow operations scope and false guidance.",
        "Run `npm --prefix packages/harness-runtime test`.",
        "Run `/harness-eval wiki-prompt-rule-section-routing` and confirm operations evidence routes to the operations rule file.",
      ],
      rollbackPlan: "Revert the proposal commit or remove the added checklist/eval if it creates noise.",
      evidence: evidence.slice(0, 8),
      fingerprint: stableHash(["R-0001", commandFamily, evidence.map((item) => item.sessionId).sort()].join("|")),
    }));
}

function detectRepeatedToolErrors({ dataset, rule }) {
  if (!rule?.enabled) return [];
  const minOccurrences = rule.params?.minOccurrences ?? 2;
  const groups = new Map();

  for (const event of dataset.events) {
    if (!event.activePath) continue;
    if (event.kind !== "tool_result" || !event.tool?.isError) continue;
    if (event.tool?.name === "bash") continue;

    const errorKind = classifyToolError(event);
    const key = `${event.tool?.name ?? "unknown"}:${errorKind}`;
    pushGroup(groups, key, evidenceFromEvent(event));
  }

  return [...groups.entries()]
    .filter(([, evidence]) => evidence.length >= minOccurrences)
    .map(([key, evidence]) => {
      const [toolName, errorKind] = key.split(":");
      const isEditOldText = toolName === "edit" && errorKind === "oldText_mismatch";
      return {
        ruleId: "R-0002",
        title: isEditOldText
          ? "Add edit workflow note for exact oldText matching"
          : `Reduce repeated ${toolName} tool error: ${errorKind}`,
        target: "rules",
        targetFiles: ["wiki/_rules.md"],
        risk: "low",
        problem: `Tool \`${toolName}\` produced repeated error pattern \`${errorKind}\` ${evidence.length} times in active paths.`,
        proposedChange: isEditOldText
          ? "Add a concise global prompt rule to re-read the target block and keep edit oldText exact/unique before calling the edit tool."
          : "Add a reviewed global prompt rule/checklist for this repeated tool error pattern; change runtime detector code separately if deterministic behavior must change.",
        testPlan: [
          "Review the prompt rule scope and ensure it does not encode executable detector parameters.",
          "Run `npm --prefix packages/harness-runtime test`.",
          "Run `/harness-eval wiki-prompt-rule-lazy-loading`.",
        ],
        rollbackPlan: "Revert the proposal patch if the prompt rule creates noise or misleading guidance.",
        evidence: evidence.slice(0, 8),
        fingerprint: stableHash(["R-0002", key, evidence.map((item) => item.sessionId).sort()].join("|")),
      };
    });
}

function detectSensitivePathAccess({ dataset, rule }) {
  if (!rule?.enabled) return [];
  const minOccurrences = rule.params?.minOccurrences ?? 1;
  const evidence = dataset.events
    .filter((event) => event.activePath && event.safety?.sensitivePath)
    .map((event) => evidenceFromEvent(event, { excerpt: firstNonEmpty(event.excerpt, event.summary, JSON.stringify(event.files ?? event.tool?.argsPreview ?? {})) }));

  if (evidence.length < minOccurrences) return [];

  return [{
    ruleId: "R-0003",
    title: "Review sensitive path access policy",
    target: "redaction",
    targetFiles: ["src/safety/redaction.js", "tests/redaction.test.js", "AGENTS.md"],
    risk: "high",
    problem: `Normalized events flagged ${evidence.length} sensitive path access event(s).`,
    proposedChange: "Review whether the sensitive paths were intentional. If repeated or unsafe, add a guard/checklist, redaction fixture, or path protection rule.",
    testPlan: [
      "Add/adjust redaction tests for the sensitive path pattern if policy changes.",
      "Run `npm --prefix packages/harness-runtime test`.",
      "Run a scan and confirm sensitive paths are flagged without exposing raw contents.",
    ],
    rollbackPlan: "Revert policy/test changes or remove the guard if it blocks legitimate inspected evidence.",
    evidence: evidence.slice(0, 8),
    fingerprint: stableHash(["R-0003", evidence.map((item) => `${item.sessionId}:${item.entryId}`).sort().join("|")].join("|")),
  }];
}

function detectParserWarnings({ dataset, rule }) {
  if (!rule?.enabled) return [];
  const minOccurrences = rule.params?.minOccurrences ?? 1;
  const groups = new Map();
  for (const warning of dataset.warnings) {
    pushGroup(groups, warning.code ?? "unknown_warning", evidenceFromWarning(warning));
  }

  return [...groups.entries()]
    .filter(([, evidence]) => evidence.length >= minOccurrences)
    .map(([code, evidence]) => ({
      ruleId: "R-0004",
      title: `Add parser/normalizer support for warning: ${code}`,
      target: "parser",
      targetFiles: ["src/session/parse-session.js", "src/session/warnings.js", "src/normalize/events.js", "tests/"],
      risk: "medium",
      problem: `Harness emitted ${evidence.length} parser/normalizer warning(s) with code \`${code}\`.`,
      proposedChange: "Add explicit parser/normalizer support, downgrade noisy warnings, or add a fixture documenting the expected behavior.",
      testPlan: [
        "Add a fixture covering this warning shape.",
        "Run `npm --prefix packages/harness-runtime test`.",
        "Run `/harness-warnings 5` in Pi and confirm warnings are expected or resolved.",
      ],
      rollbackPlan: "Revert parser/normalizer changes if the new handling misclassifies session entries.",
      evidence: evidence.slice(0, 8),
      fingerprint: stableHash(["R-0004", code, evidence.map((item) => `${item.sessionId}:${item.entryId}`).sort().join("|")].join("|")),
    }));
}

function isBashFailure(event) {
  if (event.kind === "bash_execution") return Number(event.bash?.exitCode ?? 0) !== 0;
  return event.kind === "tool_result" && event.tool?.name === "bash" && event.tool?.isError;
}

function classifyToolError(event) {
  const text = `${event.summary ?? ""}\n${event.excerpt ?? ""}`;
  if (/oldText.*match|must match a unique|oldText/i.test(text)) return "oldText_mismatch";
  if (/not found|ENOENT/i.test(text)) return "not_found";
  if (/permission|EACCES/i.test(text)) return "permission";
  if (/timeout|timed out/i.test(text)) return "timeout";
  return stableHash(text).slice(0, 12);
}

function normalizeCommandFamily(command) {
  const text = String(command ?? "bash").trim().replace(/\s+/g, " ");
  if (!text) return "bash";
  const tokens = text.split(" ");
  if (["npm", "pnpm", "bun", "yarn", "node", "git"].includes(tokens[0])) return tokens.slice(0, 3).join(" ");
  return tokens.slice(0, 2).join(" ");
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

function pushGroup(groups, key, value) {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(value);
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function callKey(sessionId, callId) {
  return `${sessionId ?? ""}:${callId ?? ""}`;
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? "";
}

function truncateEvidence(text, max = 500) {
  const value = String(text ?? "").replace(/\r?\n/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 16)}...<truncated>`;
}

function fingerprintProposal(proposal) {
  return stableHash(`${proposal.ruleId}|${proposal.title}|${proposal.target}|${proposal.evidence?.map((item) => `${item.sessionId}:${item.entryId}`).join("|")}`);
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}
