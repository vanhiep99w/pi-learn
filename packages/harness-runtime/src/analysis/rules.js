import crypto from "node:crypto";
import fs from "node:fs";

const BUILT_IN_RULES = [
  { id: "R-0001", name: "Repeated bash failure", enabled: true, params: { minOccurrences: 2 } },
  { id: "R-0002", name: "Repeated tool error", enabled: true, params: { minOccurrences: 2 } },
  { id: "R-0003", name: "Sensitive path access", enabled: true, params: { minOccurrences: 1 } },
  { id: "R-0004", name: "Parser warning pattern", enabled: true, params: { minOccurrences: 1 } },
];

const REVIEW_REQUIREMENTS = ["existing-coverage", "task-consequence", "smallest-owner", "validation-route"];

export function runRuleEngine({ sessionResults, ruleConfig }) {
  const dataset = loadDataset(sessionResults);
  const rules = ruleConfig ?? loadRuleConfig();
  return [
    ...detectRepeatedBashFailures({ dataset, rule: rules.get("R-0001") }),
    ...detectRepeatedToolErrors({ dataset, rule: rules.get("R-0002") }),
    ...detectSensitivePathAccess({ dataset, rule: rules.get("R-0003") }),
    ...detectParserWarnings({ dataset, rule: rules.get("R-0004") }),
  ].sort((left, right) => left.detectorId.localeCompare(right.detectorId) || left.id.localeCompare(right.id));
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
    const sourceFingerprint = requireSourceFingerprint(result.sourceFingerprint);
    const sessionEvents = readJsonl(result.paths?.events).map((event) => ({
      ...event,
      sessionId: event.sessionId ?? result.sessionId,
      sessionFile: event.sessionFile ?? result.sessionFile,
      sourceFingerprint,
    }));
    const sessionWarnings = (result.warnings ?? readJsonl(result.paths?.warnings)).map((warning) => ({
      ...warning,
      sessionId: warning.sessionId ?? result.sessionId,
      sessionFile: warning.sessionFile ?? result.sessionFile,
      sourceFingerprint,
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
    if (!event.activePath || !isBashFailure(event)) continue;
    const call = event.tool?.callId ? dataset.toolCallsBySessionCallId.get(callKey(event.sessionId, event.tool.callId)) : undefined;
    const command = event.bash?.command ?? call?.tool?.argsPreview?.command ?? call?.tool?.argsPreview?.cmd ?? "bash";
    pushGroup(groups, normalizeCommandFamily(command), evidenceRefFromEvent(event));
  }

  return [...groups.entries()]
    .filter(([, refs]) => refs.length >= minOccurrences)
    .map(([commandFamily, refs]) => createCandidate({
      detectorId: "R-0001",
      kind: "repeated-bash-failure",
      scope: projectScope(["wiki/operations/_rules.md"]),
      signal: { commandFamily },
      count: refs.length,
      evidenceRefs: refs,
      likelyDimensions: ["controlled-execution"],
      requiredReview: REVIEW_REQUIREMENTS,
    }));
}

function detectRepeatedToolErrors({ dataset, rule }) {
  if (!rule?.enabled) return [];
  const minOccurrences = rule.params?.minOccurrences ?? 2;
  const groups = new Map();

  for (const event of dataset.events) {
    if (!event.activePath || event.kind !== "tool_result" || !event.tool?.isError || event.tool?.name === "bash") continue;
    const toolName = event.tool?.name ?? "unknown";
    const errorKind = classifyToolError(event);
    const key = canonicalJson({ toolName, errorKind });
    if (!groups.has(key)) groups.set(key, { toolName, errorKind, refs: [] });
    groups.get(key).refs.push(evidenceRefFromEvent(event));
  }

  return [...groups.values()]
    .filter(({ refs }) => refs.length >= minOccurrences)
    .map(({ toolName, errorKind, refs }) => createCandidate({
      detectorId: "R-0002",
      kind: "repeated-tool-error",
      scope: projectScope(["wiki/_rules.md"]),
      signal: { toolName, errorKind },
      count: refs.length,
      evidenceRefs: refs,
      likelyDimensions: ["controlled-execution"],
      requiredReview: REVIEW_REQUIREMENTS,
    }));
}

function detectSensitivePathAccess({ dataset, rule }) {
  if (!rule?.enabled) return [];
  const minOccurrences = rule.params?.minOccurrences ?? 1;
  const flagged = dataset.events.filter((event) => event.activePath && (event.safety?.sensitivePath || event.safety?.secretDetected));
  if (flagged.length < minOccurrences) return [];

  const flagKinds = [...new Set(flagged.flatMap((event) => [
    event.safety?.sensitivePath ? "sensitive-path" : undefined,
    event.safety?.secretDetected ? "secret-detected" : undefined,
  ].filter(Boolean)))].sort();
  return [createCandidate({
    detectorId: "R-0003",
    kind: "sensitive-evidence-flag",
    scope: projectScope([]),
    signal: { flagKinds },
    count: flagged.length,
    evidenceRefs: flagged.map(evidenceRefFromEvent),
    likelyDimensions: ["privacy-security"],
    requiredReview: ["authorization", "exposure-consequence", "redaction-outcome", "validation-route"],
  })];
}

function detectParserWarnings({ dataset, rule }) {
  if (!rule?.enabled) return [];
  const minOccurrences = rule.params?.minOccurrences ?? 1;
  const groups = new Map();
  for (const warning of dataset.warnings) {
    pushGroup(groups, warning.code ?? "unknown_warning", evidenceRefFromWarning(warning));
  }

  return [...groups.entries()]
    .filter(([, refs]) => refs.length >= minOccurrences)
    .map(([warningCode, refs]) => createCandidate({
      detectorId: "R-0004",
      kind: "parser-warning-pattern",
      scope: projectScope([]),
      signal: { warningCode },
      count: refs.length,
      evidenceRefs: refs,
      likelyDimensions: ["correctness", "observability"],
      requiredReview: ["warning-consequence", "smallest-owner", "bounded-repair", "validation-route"],
    }));
}

function createCandidate(candidate) {
  const evidenceRefs = dedupeAndSortRefs(candidate.evidenceRefs);
  const identity = {
    detectorId: candidate.detectorId,
    kind: candidate.kind,
    scope: candidate.scope,
    signal: candidate.signal,
    evidenceRefs: evidenceRefs.map(refIdentity),
  };
  return {
    schemaVersion: 1,
    id: `candidate-${stableHash(canonicalJson(identity)).slice(0, 24)}`,
    detectorId: candidate.detectorId,
    kind: candidate.kind,
    status: "lead",
    scope: candidate.scope,
    signal: candidate.signal,
    count: candidate.count,
    evidenceRefs,
    likelyDimensions: [...candidate.likelyDimensions],
    requiredReview: [...candidate.requiredReview],
  };
}

function projectScope(ownerRoutes) {
  return {
    authority: { project: true, userHome: false },
    ownerRoutes: [...ownerRoutes].sort(),
  };
}

function evidenceRefFromEvent(event) {
  return compactRef({
    sourceFingerprint: event.sourceFingerprint,
    sessionId: event.sessionId,
    entryId: event.entryId,
    eventId: event.eventId,
    kind: event.kind,
    timestamp: event.timestamp,
  });
}

function evidenceRefFromWarning(warning) {
  const warningCode = warning.code ?? "unknown_warning";
  const entryId = warning.entryId
    ?? (Number.isInteger(warning.lineNumber) ? `line-${warning.lineNumber}` : `warning-${warningCode}`);
  return compactRef({
    sourceFingerprint: warning.sourceFingerprint,
    sessionId: warning.sessionId,
    entryId,
    eventId: warning.eventId,
    kind: warningCode,
    timestamp: warning.timestamp,
  });
}

function compactRef(ref) {
  return Object.fromEntries(Object.entries(ref).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function dedupeAndSortRefs(refs) {
  const byIdentity = new Map();
  for (const ref of refs ?? []) byIdentity.set(canonicalJson(refIdentity(ref)), compactRef(ref));
  return [...byIdentity.values()].sort((left, right) => canonicalJson(refIdentity(left)).localeCompare(canonicalJson(refIdentity(right))));
}

function refIdentity(ref) {
  return {
    sourceFingerprint: ref.sourceFingerprint,
    sessionId: ref.sessionId,
    entryId: ref.entryId,
    eventId: ref.eventId,
    kind: ref.kind,
  };
}

function requireSourceFingerprint(value) {
  const fingerprint = String(value ?? "");
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    const error = new Error("Session result requires a deterministic sourceFingerprint");
    error.code = "MISSING_SOURCE_FINGERPRINT";
    throw error;
  }
  return fingerprint;
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
  return `other-${stableHash(text).slice(0, 12)}`;
}

function normalizeCommandFamily(command) {
  const text = String(command ?? "bash").trim().replace(/\s+/g, " ");
  if (!text) return "bash";
  const tokens = text.split(" ");
  if (["npm", "pnpm", "bun", "yarn", "node", "git"].includes(tokens[0])) return tokens.slice(0, 3).join(" ");
  return tokens.slice(0, 2).join(" ");
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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
