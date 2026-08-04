import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TASK_EPISODE_POLICY = "task-episode-candidate-v1";
export const TASK_EPISODE_KIND = "pi-harness.task-episode-candidate";
export const TASK_EPISODE_READER_KIND = "pi-harness.task-episode-candidate-reader";

const SCHEMA_VERSION = 1;
const SOURCE_FINGERPRINT = /^[a-f0-9]{64}$/;
const ESSENTIAL_WARNING_CODES = new Set([
  "duplicate_id",
  "malformed_json",
  "missing_header",
  "missing_id",
]);
const SUBSTANTIVE_KINDS = new Set([
  "assistant_message",
  "assistant_tool_call",
  "tool_result",
  "bash_execution",
  "custom",
  "custom_message",
  "unknown",
]);
const READ_ONLY_TOOLS = new Set([
  "ask_user_question",
  "find",
  "grep",
  "ls",
  "read",
  "tool_search",
  "web_fetch",
  "web_search",
]);

export function buildTaskEpisodeArtifacts({ analysisRun, sessionResults = [], projectRoot } = {}) {
  validateRunInput(analysisRun);
  const root = path.resolve(projectRoot ?? analysisRun.project?.projectRoot ?? ".");
  const projectKey = String(analysisRun.project?.projectKey ?? "");
  const sessions = sessionResults.map((result) => buildSessionLane({
    result,
    projectRoot: root,
    projectKey,
  }));
  const selectedCount = analysisRun.selection.selectedCount;
  const acceptedCount = analysisRun.consumption?.acceptedCount ?? sessionResults.length;
  const skippedCount = analysisRun.consumption?.skippedCount ?? Math.max(0, selectedCount - acceptedCount);
  if (acceptedCount !== sessionResults.length || acceptedCount + skippedCount !== selectedCount) {
    throw new Error("Task episode frozen consumption counts do not reconcile");
  }
  const consumerStatus = analysisRun.consumption?.status ?? analysisRun.laneStatus?.consumer ?? "pending";
  const counts = reconcileCounts({ selectedCount, acceptedCount, skippedCount, sessions });
  const status = selectedCount === 0
    ? "observed-empty"
    : consumerStatus === "partial" || sessions.some((session) => session.normalizedEvents.status === "partial")
      ? "partial"
      : "complete";
  const runBinding = {
    runId: analysisRun.runId,
    projectKey,
    projectRoot: root,
    contextFingerprint: analysisRun.contextFingerprint,
    selectedFingerprint: analysisRun.selection.selectedFingerprint,
    selectedCount,
    acceptedCount,
    skippedCount,
    consumerStatus,
  };

  const privatePayload = {
    schemaVersion: SCHEMA_VERSION,
    kind: TASK_EPISODE_KIND,
    policy: TASK_EPISODE_POLICY,
    continuation: "session-bounded",
    status,
    runBinding,
    counts,
    sessions,
  };
  const readerArtifact = buildReaderProjection(privatePayload);
  const readerProjectionFingerprint = stableHash(readerArtifact);
  const privateWithReaderBinding = { ...privatePayload, readerProjectionFingerprint };
  const privateArtifact = {
    ...privateWithReaderBinding,
    artifactFingerprint: stableHash(privateWithReaderBinding),
  };
  return { privateArtifact, readerArtifact };
}

function buildSessionLane({ result, projectRoot, projectKey }) {
  const sourceFingerprint = String(result?.sourceFingerprint ?? "");
  const expectedSessionId = result?.sessionId;
  const warningCodes = new Set((result?.warnings ?? []).map((warning) => safeCode(warning?.code)).filter(Boolean));
  let events = [];
  let loadFailure;
  try {
    events = loadNormalizedEvents(result);
  } catch {
    loadFailure = "normalized-events-unreadable";
    warningCodes.add(loadFailure);
  }

  const integrityReasons = validateNormalizedEvents(events, {
    sourceFingerprint,
    expectedSessionId,
    expectedProjectKey: projectKey,
  });
  integrityReasons.push(...validateCacheBinding(result, { expectedSessionId, expectedProjectKey: projectKey }));
  if (loadFailure) integrityReasons.push(loadFailure);
  const essentialWarningReasons = [...warningCodes].filter((code) => ESSENTIAL_WARNING_CODES.has(code));
  const suppressionReasons = [...new Set([...integrityReasons, ...essentialWarningReasons])].sort();
  for (const reason of integrityReasons) warningCodes.add(reason);
  const normalizedEvents = {
    fingerprint: stableHash(events),
    status: warningCodes.size ? "partial" : "complete",
    warningCodes: [...warningCodes].sort(),
    eventCount: events.length,
    activeEventCount: events.filter((event) => event?.activePath === true).length,
    offPathEventCount: events.filter((event) => event?.activePath === false).length,
  };

  if (suppressionReasons.length) {
    return {
      sessionId: expectedSessionId ?? null,
      sourceFingerprint: SOURCE_FINGERPRINT.test(sourceFingerprint) ? sourceFingerprint : null,
      normalizedEvents,
      candidateCount: 0,
      candidates: [],
    };
  }

  const activeEvents = events.filter((event) => event.activePath === true);
  const candidates = segmentCandidates({ activeEvents, sourceFingerprint, projectRoot });
  return {
    sessionId: expectedSessionId,
    sourceFingerprint,
    normalizedEvents,
    candidateCount: candidates.length,
    candidates,
  };
}

function loadNormalizedEvents(result) {
  if (Array.isArray(result?.events)) return jsonClone(result.events);
  const eventsPath = result?.paths?.events;
  if (!eventsPath) throw new Error("Normalized events path is missing");
  const text = fs.readFileSync(eventsPath, "utf8");
  if (!text.trim()) return [];
  return text.trimEnd().split("\n").map((line) => JSON.parse(line));
}

function validateCacheBinding(result, { expectedSessionId, expectedProjectKey }) {
  const manifest = result?.manifest;
  if (!manifest || typeof manifest !== "object") return [];
  const reasons = [];
  if (manifest.sessionId !== expectedSessionId) reasons.push("cache-session-binding-mismatch");
  if (manifest.projectKey !== expectedProjectKey) reasons.push("cache-project-binding-mismatch");
  return reasons;
}

function validateNormalizedEvents(events, { sourceFingerprint, expectedSessionId, expectedProjectKey }) {
  const reasons = [];
  if (!SOURCE_FINGERPRINT.test(sourceFingerprint)) reasons.push("source-fingerprint-malformed");
  if (typeof expectedSessionId !== "string" || !expectedSessionId.trim()) reasons.push("session-binding-malformed");
  if (typeof expectedProjectKey !== "string" || !expectedProjectKey.trim()) reasons.push("project-binding-malformed");
  if (!Array.isArray(events)) return [...new Set([...reasons, "normalized-events-malformed"])].sort();
  const eventIds = new Set();
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      reasons.push("normalized-event-malformed");
      continue;
    }
    if (event.schemaVersion !== SCHEMA_VERSION) reasons.push("event-schema-version-malformed");
    if (typeof event.eventId !== "string" || !event.eventId.trim()) reasons.push("event-id-malformed");
    else if (eventIds.has(event.eventId)) reasons.push("event-id-duplicate");
    else eventIds.add(event.eventId);
    if (typeof event.entryId !== "string" || !event.entryId.trim()) reasons.push("event-entry-id-malformed");
    if (typeof event.kind !== "string" || !event.kind.trim()) reasons.push("event-kind-malformed");
    if (typeof event.activePath !== "boolean") reasons.push("event-active-path-malformed");
    if (event.sessionId !== expectedSessionId) reasons.push("event-session-binding-mismatch");
    if (event.projectKey !== expectedProjectKey) reasons.push("event-project-binding-mismatch");
    if (!Number.isInteger(event.ordinal) || event.ordinal !== index + 1) {
      reasons.push("event-ordinal-not-file-order");
    }
  }
  return [...new Set(reasons)].sort();
}

function segmentCandidates({ activeEvents, sourceFingerprint, projectRoot }) {
  const candidates = [];
  let current;
  let previousEvent;

  for (const event of activeEvents) {
    if (event.kind === "user_message") {
      if (current) closeCandidate(current, { endEvent: previousEvent ?? current.startEvent, boundary: "next-user-message" });
      current = createCandidate({ event, sourceFingerprint, projectRoot });
      candidates.push(current);
      previousEvent = event;
      continue;
    }

    if (event.kind === "branch_summary") {
      if (current) {
        closeCandidate(current, { endEvent: event, boundary: "branch-summary" });
        current = undefined;
      }
      previousEvent = event;
      continue;
    }

    if (!current) {
      previousEvent = event;
      continue;
    }

    if (event.kind === "compaction") {
      current.compactionRefs.push(evidenceRef(sourceFingerprint, event));
      previousEvent = event;
      continue;
    }

    const markerTag = event.kind === "custom" ? event.harnessMarker?.tag : undefined;
    if (markerTag === "success" || markerTag === "failure") {
      current.substantive = true;
      closeCandidate(current, {
        endEvent: event,
        boundary: "explicit-harness-marker",
        markerTag,
      });
      current = undefined;
      previousEvent = event;
      continue;
    }

    if (SUBSTANTIVE_KINDS.has(event.kind)) current.substantive = true;
    observeCandidateEvent(current, event);
    previousEvent = event;
  }

  if (current) closeCandidate(current, { endEvent: previousEvent ?? current.startEvent, boundary: "session-end" });
  return candidates.map(finalizeCandidate);
}

function createCandidate({ event, sourceFingerprint, projectRoot }) {
  const id = privateId("episode", {
    policy: TASK_EPISODE_POLICY,
    sourceFingerprint,
    startEventId: event.eventId,
    startEntryId: event.entryId,
    startOrdinal: event.ordinal,
  });
  return {
    id,
    sourceFingerprint,
    projectRoot,
    startEvent: event,
    startRef: boundaryRef(event),
    endRef: undefined,
    substantive: false,
    retention: undefined,
    changeSets: [],
    validationSets: [],
    compactionRefs: [],
    closure: undefined,
    observationReasons: new Set(),
    diagnostics: {
      failedChangeResults: 0,
      missingChangeResults: 0,
      unmatchedToolResults: 0,
      markerCount: 0,
    },
    toolCallRegistry: new Map(),
    invalidToolCallIds: new Set(),
    consumedToolResultIds: new Set(),
    pendingMutationCalls: new Map(),
    pendingValidationCalls: new Map(),
    currentChangeSet: undefined,
    pendingRepairValidationSetIds: [],
  };
}

function observeCandidateEvent(candidate, event) {
  if (event.kind === "assistant_tool_call") {
    observeToolCall(candidate, event);
    return;
  }
  if (event.kind === "tool_result") {
    observeToolResult(candidate, event);
    return;
  }
  if (event.kind === "bash_execution") observeUserBash(candidate, event);
}

function observeToolCall(candidate, event) {
  const name = String(event.tool?.name ?? "");
  const callId = event.tool?.callId;
  if (!validCallId(callId)) {
    if (name === "edit" || name === "write") candidate.observationReasons.add("change-call-binding-ambiguous");
    if (name === "bash") candidate.observationReasons.add("bash-call-binding-ambiguous");
    if (!READ_ONLY_TOOLS.has(name) && name !== "edit" && name !== "write" && name !== "bash") {
      candidate.observationReasons.add("unknown-potentially-mutating-tool");
    }
    return;
  }
  if (candidate.toolCallRegistry.has(callId) || candidate.invalidToolCallIds.has(callId)) {
    candidate.invalidToolCallIds.add(callId);
    candidate.pendingMutationCalls.delete(callId);
    candidate.pendingValidationCalls.delete(callId);
    candidate.observationReasons.add("tool-call-id-duplicate");
    return;
  }
  candidate.toolCallRegistry.set(callId, { name, ordinal: event.ordinal });

  if (name === "edit" || name === "write") {
    candidate.pendingMutationCalls.set(callId, event);
    return;
  }
  if (name === "bash") {
    const classification = classifyValidationCommand(event.tool?.argsPreview?.command, {
      truncated: argsPreviewTruncated(event.tool?.argsPreview),
      cwd: event.cwd,
      projectRoot: candidate.projectRoot,
    });
    if (!classification) candidate.observationReasons.add("bash-unclassified-or-complex");
    candidate.pendingValidationCalls.set(callId, { event, classification });
    return;
  }
  if (!READ_ONLY_TOOLS.has(name)) candidate.observationReasons.add("unknown-potentially-mutating-tool");
}

function observeToolResult(candidate, event) {
  const callId = event.tool?.callId;
  if (!validCallId(callId)) {
    candidate.diagnostics.unmatchedToolResults++;
    if (event.tool?.name === "edit" || event.tool?.name === "write") candidate.observationReasons.add("change-call-binding-ambiguous");
    if (event.tool?.name === "bash") candidate.observationReasons.add("bash-call-binding-ambiguous");
    return;
  }
  if (candidate.invalidToolCallIds.has(callId) || candidate.consumedToolResultIds.has(callId)) {
    candidate.diagnostics.unmatchedToolResults++;
    candidate.observationReasons.add("tool-result-binding-ambiguous");
    return;
  }

  const mutationCall = candidate.pendingMutationCalls.get(callId);
  if (mutationCall) {
    candidate.pendingMutationCalls.delete(callId);
    candidate.consumedToolResultIds.add(callId);
    if (event.tool?.name !== mutationCall.tool?.name) {
      candidate.observationReasons.add("change-result-tool-mismatch");
      return;
    }
    if (event.tool?.isError === true) {
      candidate.diagnostics.failedChangeResults++;
      return;
    }
    if (event.tool?.isError !== false) {
      candidate.observationReasons.add("change-result-status-ambiguous");
      return;
    }
    appendSuccessfulChange(candidate, mutationCall, event);
    return;
  }

  const validationCall = candidate.pendingValidationCalls.get(callId);
  if (validationCall) {
    candidate.pendingValidationCalls.delete(callId);
    candidate.consumedToolResultIds.add(callId);
    if (event.tool?.name !== "bash") {
      candidate.observationReasons.add("bash-result-tool-mismatch");
      return;
    }
    if (!validationCall.classification) return;
    const status = event.tool?.isError === true ? "fail" : event.tool?.isError === false ? "pass" : "unknown";
    appendValidation(candidate, {
      classification: validationCall.classification,
      status,
      ordinal: event.ordinal,
      refs: [
        evidenceRef(candidate.sourceFingerprint, validationCall.event),
        evidenceRef(candidate.sourceFingerprint, event),
      ],
    });
    return;
  }

  candidate.diagnostics.unmatchedToolResults++;
}

function observeUserBash(candidate, event) {
  const classification = classifyValidationCommand(event.bash?.command, {
    truncated: event.bash?.truncated === true,
    cwd: event.cwd,
    projectRoot: candidate.projectRoot,
  });
  if (!classification) {
    candidate.observationReasons.add("bash-unclassified-or-complex");
    return;
  }
  const status = Number.isInteger(event.bash?.exitCode)
    ? event.bash.exitCode === 0 ? "pass" : "fail"
    : "unknown";
  appendValidation(candidate, {
    classification,
    status,
    ordinal: event.ordinal,
    refs: [evidenceRef(candidate.sourceFingerprint, event)],
  });
}

function appendSuccessfulChange(candidate, callEvent, resultEvent) {
  const routes = extractTargetRoutes(callEvent, candidate.projectRoot);
  if (!routes.length) candidate.observationReasons.add("target-route-ambiguous");
  if (!candidate.currentChangeSet) {
    const id = privateId("change", {
      episodeId: candidate.id,
      sourceFingerprint: candidate.sourceFingerprint,
      startEventId: callEvent.eventId,
      startOrdinal: callEvent.ordinal,
    });
    candidate.currentChangeSet = {
      id,
      ordinalStart: callEvent.ordinal,
      ordinalEnd: resultEvent.ordinal,
      targetRoutes: [],
      eventCount: 0,
      reportedOutcome: "observed-tool-success",
      routeBinding: {
        status: "complete",
        basis: "project-relative-lexical-only",
      },
      repairOfValidationSetIds: [...candidate.pendingRepairValidationSetIds],
      validationState: "unobserved",
      evidenceRefs: [],
    };
    candidate.pendingRepairValidationSetIds = [];
  }
  const changeSet = candidate.currentChangeSet;
  changeSet.ordinalStart = Math.min(changeSet.ordinalStart, callEvent.ordinal);
  changeSet.ordinalEnd = Math.max(changeSet.ordinalEnd, resultEvent.ordinal);
  changeSet.eventCount += 2;
  changeSet.targetRoutes.push(...routes);
  changeSet.evidenceRefs.push(
    evidenceRef(candidate.sourceFingerprint, callEvent),
    evidenceRef(candidate.sourceFingerprint, resultEvent),
  );
  if (!routes.length) changeSet.routeBinding.status = "partial";
}

function finalizeCurrentChange(candidate) {
  if (!candidate.currentChangeSet) return;
  candidate.currentChangeSet.targetRoutes = [...new Set(candidate.currentChangeSet.targetRoutes)].sort();
  candidate.changeSets.push(candidate.currentChangeSet);
  candidate.currentChangeSet = undefined;
}

function appendValidation(candidate, { classification, status, ordinal, refs }) {
  finalizeCurrentChange(candidate);
  const precedingChange = candidate.changeSets.at(-1) ?? null;
  const relevance = validationRelevance(classification, precedingChange);
  const id = privateId("validation", {
    episodeId: candidate.id,
    sourceFingerprint: candidate.sourceFingerprint,
    ordinal,
    commandFingerprint: classification.commandFingerprint,
  });
  const supportsChangeSetIds = status === "pass" && relevance.status === "scope-correlated" && precedingChange
    ? [precedingChange.id]
    : [];
  const validationSet = {
    id,
    ordinal,
    checkClass: classification.checkClass,
    commandFingerprint: classification.commandFingerprint,
    scopeRoute: classification.scopeRoute,
    status,
    evaluatesChangeSetId: precedingChange?.id ?? null,
    relevance,
    supportsChangeSetIds,
    evidenceRefs: refs,
  };
  candidate.validationSets.push(validationSet);

  if (precedingChange && relevance.status === "scope-correlated") {
    if (status === "pass") precedingChange.validationState = "supported";
    else if (status === "fail") precedingChange.validationState = "observed-failure";
  }
  if (status === "pass") candidate.pendingRepairValidationSetIds = [];
  if (status === "fail") candidate.pendingRepairValidationSetIds.push(id);
}

function validationRelevance(classification, changeSet) {
  if (!changeSet) return { status: "unproven", basis: "no-prior-change" };
  if (!classification.scopeRoute || classification.scopeRoute === ".") {
    return { status: "unproven", basis: "broad-or-unknown-scope" };
  }
  if (!changeSet.targetRoutes.length || changeSet.routeBinding.status !== "complete") {
    return { status: "unproven", basis: "target-route-coverage-partial" };
  }
  const correlated = changeSet.targetRoutes.every((route) => route === classification.scopeRoute
    || route.startsWith(`${classification.scopeRoute}/`));
  return correlated
    ? { status: "scope-correlated", basis: "all-target-routes-beneath-command-scope" }
    : { status: "unproven", basis: "scope-does-not-cover-all-targets" };
}

function closeCandidate(candidate, { endEvent, boundary, markerTag }) {
  for (const call of candidate.pendingMutationCalls.values()) {
    candidate.diagnostics.missingChangeResults++;
    candidate.observationReasons.add("change-result-missing");
    if (call.tool?.name !== "edit" && call.tool?.name !== "write") candidate.observationReasons.add("change-call-binding-ambiguous");
  }
  if (candidate.pendingValidationCalls.size) candidate.observationReasons.add("bash-result-missing");
  candidate.pendingMutationCalls.clear();
  candidate.pendingValidationCalls.clear();
  finalizeCurrentChange(candidate);
  candidate.endRef = boundaryRef(endEvent);
  candidate.retention = candidate.substantive
    ? { status: "retained", reason: "substantive-active-path-signal" }
    : { status: "discarded", reason: "zero-signal" };
  candidate.closure = markerTag
    ? {
      status: markerTag === "success" ? "closed" : "failed",
      boundary,
      outcomeEvidence: "explicit-self-mark",
      deliveryStatus: "unobserved",
      evidenceRefs: [evidenceRef(candidate.sourceFingerprint, endEvent)],
    }
    : {
      status: "unobserved",
      boundary,
      outcomeEvidence: "none",
      deliveryStatus: "unobserved",
      evidenceRefs: [],
    };
  if (markerTag) candidate.diagnostics.markerCount++;
}

function finalizeCandidate(candidate) {
  const reasons = [...candidate.observationReasons].sort();
  return {
    id: candidate.id,
    startRef: candidate.startRef,
    endRef: candidate.endRef,
    retention: candidate.retention,
    changeSets: candidate.changeSets,
    validationSets: candidate.validationSets,
    compactionRefs: candidate.compactionRefs,
    compactionCount: candidate.compactionRefs.length,
    closure: candidate.closure,
    observation: {
      coverage: reasons.length ? "partial" : "complete",
      reasons,
    },
    diagnostics: candidate.diagnostics,
    evidenceRefs: collectCandidateEvidence(candidate),
  };
}

function collectCandidateEvidence(candidate) {
  const refs = [evidenceRef(candidate.sourceFingerprint, candidate.startEvent)];
  for (const changeSet of candidate.changeSets) refs.push(...changeSet.evidenceRefs);
  for (const validationSet of candidate.validationSets) refs.push(...validationSet.evidenceRefs);
  refs.push(...candidate.compactionRefs, ...candidate.closure.evidenceRefs);
  const byKey = new Map(refs.map((ref) => [`${ref.eventId}\u0000${ref.ordinal}`, ref]));
  return [...byKey.values()].sort((left, right) => left.ordinal - right.ordinal || left.eventId.localeCompare(right.eventId));
}

export function classifyValidationCommand(command, {
  truncated = false,
  cwd,
  projectRoot,
} = {}) {
  if (truncated || typeof command !== "string") return null;
  if ((cwd !== undefined || projectRoot !== undefined) && !validatedEventCwd(cwd, projectRoot)) return null;
  const tokens = strictCommandTokens(command);
  if (!tokens?.length) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) return null;

  if (tokens.length === 2 && tokens[0] === "npm" && tokens[1] === "test") {
    return classified("package-test", command);
  }
  if (tokens.length === 4 && tokens[0] === "npm" && tokens[1] === "--prefix" && tokens[3] === "test") {
    const scopeRoute = normalizeCommandScope(tokens[2], { cwd, projectRoot });
    if (!scopeRoute) return null;
    return classified("package-test", command, scopeRoute);
  }
  if (tokens[0] === "node" && tokens[1] === "--test" && tokens.slice(2).every(isUncomplicatedRelativeArg)) {
    return classified("node-test", command);
  }
  if (tokens.length === 3 && tokens[0] === "git" && tokens[1] === "diff" && tokens[2] === "--check") {
    return classified("git-diff-check", command);
  }
  return null;
}

function classified(checkClass, command, scopeRoute) {
  return {
    checkClass,
    commandFingerprint: crypto.createHash("sha256").update(command).digest("hex"),
    scopeRoute,
  };
}

function strictCommandTokens(command) {
  if (!command.trim() || /[;&|<>`\\$~*?\[\]{}\u0000-\u001f\u007f]/.test(command)) return null;
  const tokens = [];
  let token = "";
  let quote;
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = undefined;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === " ") {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }
  if (quote) return null;
  if (token) tokens.push(token);
  return tokens;
}

function isUncomplicatedRelativeArg(value) {
  return !value.startsWith("-") && Boolean(normalizeRelativeToken(value));
}

function normalizeCommandScope(value, { cwd, projectRoot } = {}) {
  const normalized = normalizeRelativeToken(value);
  if (!normalized) return null;
  if (cwd === undefined && projectRoot === undefined) return normalized;
  return resolveProjectRoute(normalized, { cwd, projectRoot, allowRoot: true });
}

function normalizeRelativeToken(value) {
  if (typeof value !== "string" || !value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return null;
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized.replace(/^\.\//, "") || ".";
}

function extractTargetRoutes(callEvent, projectRoot) {
  const args = callEvent.tool?.argsPreview;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.hasOwn(args, "preview")) return [];
  const candidates = [args.path, args.file, args.filePath].filter((value) => typeof value === "string");
  return [...new Set(candidates.map((value) => resolveProjectRoute(value, {
    cwd: callEvent.cwd,
    projectRoot,
    allowRoot: false,
  })).filter(Boolean))].sort();
}

function validatedEventCwd(cwd, projectRoot) {
  if (typeof cwd !== "string" || !cwd || cwd.includes("\0") || !path.isAbsolute(cwd)) return null;
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) return null;
  const root = path.resolve(projectRoot);
  const absoluteCwd = path.resolve(cwd);
  return isPathContained(root, absoluteCwd) ? absoluteCwd : null;
}

function resolveProjectRoute(value, { cwd, projectRoot, allowRoot }) {
  const absoluteCwd = validatedEventCwd(cwd, projectRoot);
  if (!absoluteCwd || typeof value !== "string" || !value || value.includes("\0")
    || (!path.isAbsolute(value) && path.win32.isAbsolute(value))) return null;
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(absoluteCwd, value);
  const root = path.resolve(projectRoot);
  if (!isPathContained(root, absolute)) return null;
  const relative = path.relative(root, absolute);
  const route = relative.split(path.sep).join("/") || ".";
  if (route === "." && !allowRoot) return null;
  return route;
}

function isPathContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function buildReaderProjection(privateArtifact) {
  const retained = privateArtifact.sessions
    .flatMap((session) => session.candidates)
    .filter((candidate) => candidate.retention.status === "retained");
  const episodeAliases = new Map(retained.map((candidate, index) => [candidate.id, alias("E", index)]));
  const changeSets = retained.flatMap((candidate) => candidate.changeSets);
  const validations = retained.flatMap((candidate) => candidate.validationSets);
  const changeAliases = new Map(changeSets.map((changeSet, index) => [changeSet.id, alias("C", index)]));
  const validationAliases = new Map(validations.map((validationSet, index) => [validationSet.id, alias("V", index)]));

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: TASK_EPISODE_READER_KIND,
    policy: TASK_EPISODE_POLICY,
    continuation: "session-bounded",
    status: privateArtifact.status,
    runBinding: {
      runId: privateArtifact.runBinding.runId,
      selectedCount: privateArtifact.runBinding.selectedCount,
      acceptedCount: privateArtifact.runBinding.acceptedCount,
      skippedCount: privateArtifact.runBinding.skippedCount,
      consumerStatus: privateArtifact.runBinding.consumerStatus,
    },
    counts: privateArtifact.counts,
    episodes: retained.map((candidate) => ({
      id: episodeAliases.get(candidate.id),
      continuation: "session-bounded",
      boundaries: {
        startOrdinal: candidate.startRef.ordinal,
        endOrdinal: candidate.endRef.ordinal,
      },
      changeSets: candidate.changeSets.map((changeSet) => ({
        id: changeAliases.get(changeSet.id),
        ordinalStart: changeSet.ordinalStart,
        ordinalEnd: changeSet.ordinalEnd,
        targetRoutes: changeSet.targetRoutes,
        eventCount: changeSet.eventCount,
        reportedOutcome: changeSet.reportedOutcome,
        routeBinding: changeSet.routeBinding,
        repairOfValidationSetIds: changeSet.repairOfValidationSetIds.map((id) => validationAliases.get(id)).filter(Boolean),
        validationState: changeSet.validationState,
      })),
      validationSets: candidate.validationSets.map((validationSet) => ({
        id: validationAliases.get(validationSet.id),
        ordinal: validationSet.ordinal,
        checkClass: validationSet.checkClass,
        scopeRoute: validationSet.scopeRoute,
        status: validationSet.status,
        evaluatesChangeSetId: changeAliases.get(validationSet.evaluatesChangeSetId) ?? null,
        relevance: validationSet.relevance,
        supportsChangeSetIds: validationSet.supportsChangeSetIds.map((id) => changeAliases.get(id)).filter(Boolean),
      })),
      compaction: {
        count: candidate.compactionCount,
        ordinals: candidate.compactionRefs.map((ref) => ref.ordinal),
      },
      closure: {
        status: candidate.closure.status,
        boundary: candidate.closure.boundary,
        outcomeEvidence: candidate.closure.outcomeEvidence,
        deliveryStatus: candidate.closure.deliveryStatus,
      },
      observation: candidate.observation,
    })),
  };
}

function reconcileCounts({ selectedCount, acceptedCount, skippedCount, sessions }) {
  const candidates = sessions.reduce((sum, session) => sum + session.candidates.length, 0);
  const retained = sessions.reduce((sum, session) => sum + session.candidates.filter((candidate) => candidate.retention.status === "retained").length, 0);
  const discardedZeroSignal = sessions.reduce((sum, session) => sum + session.candidates.filter((candidate) => candidate.retention.reason === "zero-signal").length, 0);
  const counts = {
    selectedSessions: selectedCount,
    acceptedSessions: acceptedCount,
    skippedSessions: skippedCount,
    completeSessions: sessions.filter((session) => session.normalizedEvents.status === "complete").length,
    partialSessions: sessions.filter((session) => session.normalizedEvents.status === "partial").length,
    activeEvents: sessions.reduce((sum, session) => sum + session.normalizedEvents.activeEventCount, 0),
    offPathEventsOmitted: sessions.reduce((sum, session) => sum + session.normalizedEvents.offPathEventCount, 0),
    candidates,
    retained,
    discarded: discardedZeroSignal,
    discardedZeroSignal,
  };
  if (counts.candidates !== counts.retained + counts.discarded) throw new Error("Task episode candidate counts do not reconcile");
  return counts;
}

function evidenceRef(sourceFingerprint, event) {
  return {
    sourceFingerprint,
    eventId: event.eventId,
    entryId: event.entryId,
    ordinal: event.ordinal,
    kind: event.kind,
  };
}

function boundaryRef(event) {
  return {
    eventId: event.eventId,
    entryId: event.entryId,
    ordinal: event.ordinal,
    kind: event.kind,
  };
}

function argsPreviewTruncated(args) {
  return Boolean(args && typeof args === "object" && Object.hasOwn(args, "preview"));
}

function validCallId(value) {
  return typeof value === "string" && value.length > 0;
}

function privateId(prefix, value) {
  return `${prefix}-${stableHash(value).slice(0, 24)}`;
}

function alias(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function safeCode(value) {
  const code = String(value ?? "");
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(code) ? code : undefined;
}

function validateRunInput(analysisRun) {
  if (!analysisRun || typeof analysisRun !== "object") throw new Error("Task episode builder requires an analysis run");
  if (!/^run-[a-zA-Z0-9._-]{1,156}$/.test(String(analysisRun.runId ?? ""))) throw new Error("Task episode builder requires a valid run id");
  if (!SOURCE_FINGERPRINT.test(String(analysisRun.contextFingerprint ?? ""))) throw new Error("Task episode builder requires a context fingerprint");
  if (!SOURCE_FINGERPRINT.test(String(analysisRun.selection?.selectedFingerprint ?? ""))) throw new Error("Task episode builder requires a selected fingerprint");
  if (!Number.isInteger(analysisRun.selection?.selectedCount) || analysisRun.selection.selectedCount < 0) throw new Error("Task episode builder requires a selected count");
  if (typeof analysisRun.project?.projectKey !== "string" || !analysisRun.project.projectKey) throw new Error("Task episode builder requires a project key");
  if (typeof analysisRun.project?.projectRoot !== "string" || !path.isAbsolute(analysisRun.project.projectRoot)) throw new Error("Task episode builder requires an absolute project root");
}

export function taskEpisodeFingerprint(value) {
  return stableHash(value);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}
