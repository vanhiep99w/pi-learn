import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveProject } from "../project/resolve-project.js";
import { canonicalSessionTimestamp, discoverSessions, readSessionHeader } from "../session/discover-sessions.js";
import { atomicWriteJson, ensureDir } from "../storage/atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "../storage/harness-home.js";
import { writeSessionCache } from "../storage/cache-writer.js";

const SCHEMA_VERSION = 1;
const KIND = "pi-harness.analysis-run";
const CONTEXT_KIND = "pi-harness.analysis-run-context";
const RECEIPT_KIND = "pi-harness.analysis-run-consumer-receipt";
const PROVIDER = "pi";
const MUTATION_POLICY = "explicit_partial";
const CONTEXT_INTEGRITY_ERROR = "ANALYSIS_RUN_CONTEXT_INTEGRITY";
const FROZEN_SESSION_MISMATCH = "FROZEN_SESSION_MISMATCH";
const SNAPSHOT_IDENTITY_KEYS = [
  "provider",
  "sessionId",
  "privateStableRef",
  "headerTimestamp",
  "size",
  "mtimeMs",
  "projectKey",
  "projectRoot",
  "workspace",
  "sessionProjectKey",
  "sessionProjectRoot",
  "sessionWorkspace",
];

export function createAnalysisRun({ config, project, logger, now = new Date(), runId } = {}) {
  if (!config || !project) throw new Error("createAnalysisRun requires config and project");

  const selectionLimit = normalizeSelectionLimit(config.maxSessionsPerScan ?? 50);
  // Freeze the upper bound before session discovery reads any population metadata.
  const frozenAt = normalizeDate(now, "analysis run time");
  const createdAt = frozenAt.toISOString();
  const discovery = discoverSessions(config, project, {
    maxSessions: selectionLimit,
    until: frozenAt,
  });
  const eligible = discovery.eligibleSessions.map((session) => createSessionSnapshot({
    session,
    config,
    project,
  }));
  const selectedByFile = new Map(eligible.map((snapshot) => [snapshot.sessionFile, snapshot]));
  const selected = discovery.sessions.map((session) => selectedByFile.get(session.sessionFile));
  const eligibleFingerprint = fingerprintSnapshots(eligible);
  const selectedFingerprint = fingerprintSnapshots(selected);
  const safeRunId = normalizeRunId(runId ?? createRunId(frozenAt));
  const discoveryStatus = eligible.length === 0 ? "observed_empty" : "complete";
  const authority = {
    population: "frozen",
    discoveryPasses: 1,
    source: "pi_session_headers",
    mutationPolicy: MUTATION_POLICY,
    activeSessionPolicy: "same_as_selected_session",
    privateContext: true,
    rawSessionContent: false,
    userHomeAssets: false,
    normalizedLookup: "single-exact-ref",
  };
  const selection = {
    strategy: "latest-n",
    limit: selectionLimit,
    // Kept as an additive compatibility alias for existing callers.
    maxSessions: selectionLimit,
    scannedFiles: discovery.scannedFiles ?? 0,
    eligibleCount: eligible.length,
    selectedCount: selected.length,
    eligibleFingerprint,
    selectedFingerprint,
  };
  const laneStatus = { discovery: discoveryStatus, consumer: "pending" };
  const contextPayload = jsonValue({
    schemaVersion: SCHEMA_VERSION,
    kind: CONTEXT_KIND,
    runId: safeRunId,
    createdAt,
    provider: PROVIDER,
    project: projectIdentity(project),
    workspaceTarget: workspaceTarget(project),
    window: { until: discovery.until ?? createdAt },
    selection,
    authority,
    laneStatus,
    population: { eligible, selected },
    warnings: discovery.warnings,
  });
  const contextFingerprint = stableHash(contextPayload);
  const context = { ...contextPayload, contextFingerprint };

  const contextPath = analysisRunContextPath({ config, project, runId: safeRunId });
  ensureDir(path.dirname(contextPath));
  atomicWriteJson(contextPath, context);
  logger?.info("analysis_run_frozen", "Analysis run population frozen", {
    component: "analysis_run",
    projectKey: project.projectKey,
    data: {
      runId: safeRunId,
      until: context.window.until,
      eligibleCount: eligible.length,
      selectedCount: selected.length,
      eligibleFingerprint,
      selectedFingerprint,
      contextFingerprint,
    },
  });

  return publicAnalysisRun({ context, sessions: discovery.sessions });
}

export async function consumeAnalysisRun({ analysisRun, config, project, logger, consumer = "consumer" } = {}) {
  const context = readAnalysisRunContext({ analysisRun, config, project });
  const consumerId = normalizeConsumerIdentity(consumer);
  const results = [];
  const statuses = [];
  const warnings = [];

  for (const frozen of context.population.selected) {
    const before = inspectFrozenSession(frozen, { config, project });
    if (!before.ok) {
      statuses.push(statusFor(frozen, "skipped", before.reason));
      warnings.push(consumerWarning(frozen, before.reason, before.detail));
      continue;
    }

    try {
      const result = await writeSessionCache({
        sessionFile: frozen.sessionFile,
        config,
        project,
        logger,
        expectedSnapshot: frozen,
      });
      results.push(result);
      statuses.push(statusFor(frozen, "consumed"));
    } catch (error) {
      const reason = error?.code === FROZEN_SESSION_MISMATCH
        ? "selected_session_mutated"
        : "selected_session_consume_failed";
      statuses.push(statusFor(frozen, "skipped", reason));
      warnings.push(consumerWarning(frozen, reason, error.message));
    }
  }

  const skippedCount = statuses.filter((status) => status.status === "skipped").length;
  const consumerStatus = context.selection.selectedCount === 0
    ? "observed_empty"
    : skippedCount > 0
      ? "partial"
      : "complete";
  const consumedAt = new Date().toISOString();
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    runId: context.runId,
    consumer: consumerId,
    consumedAt,
    selectedFingerprint: context.selection.selectedFingerprint,
    status: consumerStatus,
    selectedCount: context.selection.selectedCount,
    acceptedCount: results.length,
    skippedCount,
    sessions: statuses,
  };
  atomicWriteJson(analysisRunConsumerReceiptPath({
    config,
    project,
    runId: context.runId,
    consumer: consumerId,
  }), receipt);

  const consumption = {
    consumer: consumerId,
    status: consumerStatus,
    acceptedCount: results.length,
    skippedCount,
    sessions: statuses,
  };
  const run = {
    ...analysisRun,
    laneStatus: { discovery: context.laneStatus.discovery, consumer: consumerStatus },
    consumption,
  };
  logger?.info("analysis_run_consumed", "Frozen analysis run consumed", {
    component: "analysis_run",
    projectKey: project.projectKey,
    data: {
      runId: context.runId,
      consumer: consumerId,
      status: consumerStatus,
      acceptedCount: results.length,
      skippedCount,
      selectedFingerprint: context.selection.selectedFingerprint,
    },
  });
  return { analysisRun: run, results, warnings, context, receipt };
}

export function fingerprintSessionPopulation({ sessions = [], config, project, provider = PROVIDER } = {}) {
  const snapshots = sessions.map((session) => createSessionSnapshot({ session, config, project, provider }));
  return fingerprintSnapshots(snapshots);
}

export function analysisRunContextPath({ config, project, runId }) {
  const safeRunId = normalizeRunId(runId);
  return path.join(analysisRunDir({ config, project, runId: safeRunId }), "context.json");
}

export function analysisRunConsumerReceiptPath({ config, project, runId, consumer }) {
  const safeRunId = normalizeRunId(runId);
  const consumerId = normalizeConsumerIdentity(consumer);
  return path.join(analysisRunDir({ config, project, runId: safeRunId }), "consumers", `${consumerId}.json`);
}

export function readAnalysisRunContext({ analysisRun, config, project }) {
  validatePublicRunShape(analysisRun, project);
  const contextPath = analysisRunContextPath({ config, project, runId: analysisRun.runId });
  let context;
  try {
    context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  } catch {
    throw integrityError("context_unreadable");
  }
  validateContextIntegrity({ context, analysisRun, config, project });
  return context;
}

function validateContextIntegrity({ context, analysisRun, config, project }) {
  assertIntegrity(context && typeof context === "object" && !Array.isArray(context), "context_shape");
  assertIntegrity(context.schemaVersion === SCHEMA_VERSION, "context_schema");
  assertIntegrity(context.kind === CONTEXT_KIND, "context_kind");
  assertIntegrity(context.runId === analysisRun.runId && isRunId(context.runId), "context_run_id");
  assertIntegrity(context.provider === PROVIDER, "context_provider");
  assertIntegrity(typeof context.contextFingerprint === "string", "context_fingerprint_missing");

  const { contextFingerprint, ...contextPayload } = context;
  assertIntegrity(stableHash(contextPayload) === contextFingerprint, "context_fingerprint_mismatch");
  assertIntegrity(analysisRun.contextFingerprint === contextFingerprint, "public_context_binding");
  assertIntegrity(isIsoDate(context.createdAt), "context_created_at");
  assertIntegrity(context.createdAt === analysisRun.createdAt, "public_created_at_binding");
  assertIntegrity(isIsoDate(context.window?.until), "context_window");
  assertIntegrity(context.window.until === context.createdAt, "context_window_created_at");

  const expectedProject = projectIdentity(project);
  const expectedTarget = workspaceTarget(project);
  assertIntegrity(stableEqual(context.project, expectedProject), "context_project");
  assertIntegrity(stableEqual(context.workspaceTarget, expectedTarget), "context_workspace_target");
  assertIntegrity(stableEqual(analysisRun.project, context.project), "public_project_binding");
  assertIntegrity(stableEqual(analysisRun.workspaceTarget, context.workspaceTarget), "public_workspace_binding");
  assertIntegrity(stableEqual(analysisRun.window, context.window), "public_window_binding");
  assertIntegrity(stableEqual(analysisRun.authority, context.authority), "public_authority_binding");
  assertIntegrity(stableEqual(analysisRun.selection, context.selection), "public_selection_binding");
  assertIntegrity(analysisRun.laneStatus?.discovery === context.laneStatus?.discovery, "public_lane_binding");
  assertIntegrity(stableEqual(analysisRun.warnings, context.warnings), "public_warning_binding");

  validateAuthority(context.authority);
  validateSelectionShape(context.selection);
  assertIntegrity(context.laneStatus?.consumer === "pending", "context_mutable_lane");
  assertIntegrity(!Object.hasOwn(context, "consumers"), "context_mutable_consumers");
  assertIntegrity(Array.isArray(context.warnings), "context_warnings");
  assertIntegrity(Array.isArray(context.population?.eligible), "eligible_population");
  assertIntegrity(Array.isArray(context.population?.selected), "selected_population");

  const eligible = validateSnapshots(context.population.eligible, { config, project, label: "eligible" });
  const selected = validateSnapshots(context.population.selected, { config, project, label: "selected" });
  assertIntegrity(context.selection.eligibleCount === eligible.length, "eligible_count");
  assertIntegrity(context.selection.selectedCount === selected.length, "selected_count");
  assertIntegrity(context.selection.selectedCount <= context.selection.limit, "selection_limit");
  assertIntegrity(context.selection.selectedCount <= context.selection.eligibleCount, "selection_count_range");
  assertIntegrity(fingerprintSnapshots(eligible) === context.selection.eligibleFingerprint, "eligible_fingerprint");
  assertIntegrity(fingerprintSnapshots(selected) === context.selection.selectedFingerprint, "selected_fingerprint");
  assertSelectedSubset(eligible, selected);

  assertIntegrity(Array.isArray(analysisRun.sessions), "public_sessions");
  assertIntegrity(analysisRun.sessions.length === selected.length, "public_session_count");
  const publicSnapshots = analysisRun.sessions.map((session) => createSessionSnapshot({ session, config, project }));
  assertIntegrity(
    stableEqual(publicSnapshots.map((snapshot) => snapshot.fingerprint), selected.map((snapshot) => snapshot.fingerprint)),
    "public_session_binding",
  );
}

function validatePublicRunShape(analysisRun, project) {
  assertIntegrity(analysisRun && typeof analysisRun === "object" && !Array.isArray(analysisRun), "public_run_shape");
  assertIntegrity(analysisRun.schemaVersion === SCHEMA_VERSION, "public_run_schema");
  assertIntegrity(analysisRun.kind === KIND, "public_run_kind");
  assertIntegrity(analysisRun.provider === PROVIDER, "public_run_provider");
  assertIntegrity(isRunId(analysisRun.runId), "public_run_id");
  assertIntegrity(analysisRun.project?.projectKey === project.projectKey, "public_run_project");
}

function validateAuthority(authority) {
  assertIntegrity(authority?.population === "frozen", "authority_population");
  assertIntegrity(authority?.discoveryPasses === 1, "authority_discovery");
  assertIntegrity(authority?.mutationPolicy === MUTATION_POLICY, "authority_mutation_policy");
  assertIntegrity(authority?.rawSessionContent === false, "authority_raw_content");
  assertIntegrity(authority?.userHomeAssets === false, "authority_user_assets");
  assertIntegrity(authority?.normalizedLookup === "single-exact-ref", "authority_normalized_lookup");
}

function validateSelectionShape(selection) {
  assertIntegrity(selection?.strategy === "latest-n", "selection_strategy");
  assertIntegrity(Number.isInteger(selection?.limit) && selection.limit >= 0, "selection_limit_shape");
  assertIntegrity(selection.maxSessions === selection.limit, "selection_limit_alias");
  assertIntegrity(Number.isInteger(selection.scannedFiles) && selection.scannedFiles >= 0, "selection_scanned_files");
  assertIntegrity(Number.isInteger(selection.eligibleCount) && selection.eligibleCount >= 0, "selection_eligible_count");
  assertIntegrity(Number.isInteger(selection.selectedCount) && selection.selectedCount >= 0, "selection_selected_count");
  assertIntegrity(/^[a-f0-9]{64}$/.test(selection.eligibleFingerprint ?? ""), "selection_eligible_fingerprint");
  assertIntegrity(/^[a-f0-9]{64}$/.test(selection.selectedFingerprint ?? ""), "selection_selected_fingerprint");
}

function validateSnapshots(snapshots, { config, project, label }) {
  const seenFiles = new Set();
  return snapshots.map((snapshot) => {
    assertIntegrity(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot), `${label}_snapshot_shape`);
    assertIntegrity(SNAPSHOT_IDENTITY_KEYS.every((key) => Object.hasOwn(snapshot, key)), `${label}_snapshot_identity`);
    assertIntegrity(snapshot.provider === PROVIDER, `${label}_snapshot_provider`);
    assertIntegrity(typeof snapshot.sessionFile === "string" && snapshot.sessionFile.length > 0, `${label}_snapshot_file`);
    assertIntegrity(isSessionPathContained(config.sessionDir, snapshot.sessionFile), `${label}_snapshot_containment`);
    assertIntegrity(snapshot.privateStableRef === privateStableRef(config.sessionDir, snapshot.sessionFile), `${label}_snapshot_stable_ref`);
    assertIntegrity(!path.isAbsolute(snapshot.privateStableRef) && !snapshot.privateStableRef.split("/").includes(".."), `${label}_snapshot_ref_safety`);
    assertIntegrity(snapshot.projectKey === project.projectKey, `${label}_snapshot_project_key`);
    assertIntegrity(snapshot.projectRoot === project.projectRoot, `${label}_snapshot_project_root`);
    assertIntegrity(snapshot.workspace === project.cwd, `${label}_snapshot_workspace`);
    assertIntegrity(Number.isInteger(snapshot.size) && snapshot.size >= 0, `${label}_snapshot_size`);
    assertIntegrity(Number.isFinite(snapshot.mtimeMs) && snapshot.mtimeMs >= 0, `${label}_snapshot_mtime`);
    assertIntegrity(snapshot.headerTimestamp === null || isIsoDate(snapshot.headerTimestamp), `${label}_snapshot_timestamp`);
    assertIntegrity(!seenFiles.has(snapshot.sessionFile), `${label}_snapshot_duplicate`);
    seenFiles.add(snapshot.sessionFile);
    const fingerprint = snapshotFingerprint(snapshot);
    assertIntegrity(snapshot.fingerprint === fingerprint, `${label}_snapshot_fingerprint`);
    return snapshot;
  });
}

function assertSelectedSubset(eligible, selected) {
  const remaining = new Map();
  for (const snapshot of eligible) {
    remaining.set(snapshot.fingerprint, (remaining.get(snapshot.fingerprint) ?? 0) + 1);
  }
  for (const snapshot of selected) {
    const count = remaining.get(snapshot.fingerprint) ?? 0;
    assertIntegrity(count > 0, "selected_subset");
    remaining.set(snapshot.fingerprint, count - 1);
  }
}

function inspectFrozenSession(frozen, { config, project }) {
  if (!fs.existsSync(frozen.sessionFile)) return { ok: false, reason: "selected_session_missing" };
  const parsed = readSessionHeader(frozen.sessionFile);
  if (!parsed.header) {
    return {
      ok: false,
      reason: "selected_session_header_invalid",
      detail: parsed.warning?.code,
    };
  }

  let stat;
  try {
    stat = fs.statSync(frozen.sessionFile);
  } catch (error) {
    return { ok: false, reason: "selected_session_unreadable", detail: error.message };
  }
  const sessionProject = resolveSessionProject(parsed.header.cwd);
  const timestamp = canonicalSessionTimestamp(parsed.header.timestamp);
  const session = {
    sessionId: parsed.header.id,
    sessionFile: frozen.sessionFile,
    cwd: parsed.header.cwd,
    gitRoot: sessionProject?.gitRoot,
    projectRoot: sessionProject?.projectRoot ?? parsed.header.cwd,
    projectKey: sessionProject?.projectKey,
    timestamp,
    headerTimestampMs: timestamp ? Date.parse(timestamp) : undefined,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
  const current = createSessionSnapshot({ session, config, project, provider: frozen.provider });
  return current.fingerprint === frozen.fingerprint
    ? { ok: true }
    : { ok: false, reason: "selected_session_mutated" };
}

function createSessionSnapshot({ session, config = {}, project = {}, provider = PROVIDER }) {
  const identity = {
    provider,
    sessionId: session.sessionId ?? null,
    privateStableRef: privateStableRef(config.sessionDir, session.sessionFile),
    headerTimestamp: canonicalSessionTimestamp(session.timestamp),
    size: session.size ?? null,
    mtimeMs: session.mtimeMs ?? null,
    projectKey: project.projectKey ?? null,
    projectRoot: project.projectRoot ?? null,
    workspace: project.cwd ?? null,
    sessionProjectKey: session.projectKey ?? null,
    sessionProjectRoot: session.projectRoot ?? null,
    sessionWorkspace: session.cwd ?? null,
  };
  return {
    ...identity,
    sessionFile: session.sessionFile,
    fingerprint: stableHash(identity),
  };
}

function snapshotFingerprint(snapshot) {
  return stableHash(Object.fromEntries(SNAPSHOT_IDENTITY_KEYS.map((key) => [key, snapshot[key]])));
}

function fingerprintSnapshots(snapshots) {
  const fingerprints = snapshots.map((snapshot) => snapshotFingerprint(snapshot)).sort();
  return stableHash({ provider: PROVIDER, sessions: fingerprints });
}

function publicAnalysisRun({ context, sessions }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    runId: context.runId,
    createdAt: context.createdAt,
    provider: context.provider,
    project: context.project,
    workspaceTarget: context.workspaceTarget,
    window: context.window,
    selection: context.selection,
    authority: context.authority,
    laneStatus: context.laneStatus,
    contextFingerprint: context.contextFingerprint,
    sessions,
    warnings: context.warnings,
  };
}

function projectIdentity(project) {
  return {
    projectKey: project.projectKey,
    projectRoot: project.projectRoot,
    gitRoot: project.gitRoot ?? null,
    workspace: project.cwd,
  };
}

function workspaceTarget(project) {
  return {
    kind: project.gitRoot ? "repo-root" : "standalone",
    route: ".",
    packageRoute: null,
    ownerRoute: ".",
  };
}

function privateStableRef(sessionDir, sessionFile) {
  if (!sessionFile) return "unknown-session";
  if (!sessionDir) return path.basename(sessionFile);
  const relative = path.relative(path.resolve(sessionDir), path.resolve(sessionFile));
  return relative.replaceAll(path.sep, "/");
}

function isSessionPathContained(sessionDir, sessionFile) {
  if (!sessionDir || !sessionFile) return false;
  const root = path.resolve(sessionDir);
  const target = path.resolve(sessionFile);
  if (!isPathWithin(root, target)) return false;
  if (!fs.existsSync(sessionFile) || !fs.existsSync(sessionDir)) return true;
  try {
    return isPathWithin(fs.realpathSync(sessionDir), fs.realpathSync(sessionFile));
  } catch {
    return false;
  }
}

function isPathWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolveSessionProject(cwd) {
  if (!cwd) return undefined;
  try {
    return resolveProject(cwd);
  } catch {
    return undefined;
  }
}

function statusFor(frozen, status, reason) {
  return {
    sessionId: frozen.sessionId,
    privateStableRef: frozen.privateStableRef,
    status,
    reason,
  };
}

function consumerWarning(frozen, code, detail) {
  return {
    schemaVersion: 1,
    code,
    message: `Frozen session ${frozen.sessionId ?? frozen.privateStableRef} was not consumed${detail ? `: ${detail}` : "."}`,
    sessionId: frozen.sessionId,
    sessionFile: frozen.sessionFile,
    timestamp: new Date().toISOString(),
  };
}

function analysisRunDir({ config, project, runId }) {
  return path.join(
    projectCacheDir(resolveHarnessHome(config), project.projectKey),
    "analysis-runs",
    runId,
  );
}

function createRunId(date) {
  return `run-${date.toISOString().replace(/[-:.TZ]/g, "")}-${crypto.randomUUID()}`;
}

function normalizeRunId(value) {
  const runId = String(value ?? "");
  if (!isRunId(runId)) throw new Error(`Invalid analysis run id: ${runId}`);
  return runId;
}

function isRunId(value) {
  return /^run-[a-zA-Z0-9._-]{1,156}$/.test(String(value ?? ""));
}

function normalizeConsumerIdentity(value) {
  const raw = String(value ?? "consumer").trim();
  const replaced = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const base = !replaced || replaced === "." || replaced === ".." ? "consumer" : replaced;
  if (raw === base && base.length <= 80) return base;
  return `${base.slice(0, 60)}-${stableHash(raw).slice(0, 12)}`;
}

function normalizeSelectionLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    const error = new RangeError("maxSessionsPerScan must be a finite non-negative number");
    error.code = "INVALID_MAX_SESSIONS_PER_SCAN";
    throw error;
  }
  return Math.trunc(numeric);
}

function normalizeDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date;
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function assertIntegrity(condition, reason) {
  if (!condition) throw integrityError(reason);
}

function integrityError(reason) {
  const error = new Error(`Analysis run context integrity check failed: ${reason}`);
  error.name = "AnalysisRunIntegrityError";
  error.code = CONTEXT_INTEGRITY_ERROR;
  error.reason = reason;
  return error;
}

function stableEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}
