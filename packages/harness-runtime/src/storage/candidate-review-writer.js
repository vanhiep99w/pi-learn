import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "./harness-home.js";

const RUN_ID_PATTERN = /^run-[a-zA-Z0-9._-]{1,156}$/;
const ATTEMPT_ID_PATTERN = /^attempt-[a-zA-Z0-9._-]{16,196}$/;
const MAX_AUDIT_STRING = 256;
const SAFE_COMMAND_CLASSES = new Set(["bash", "bun", "git", "node", "npm", "pnpm", "sh", "yarn"]);
const SAFE_TOOL_NAMES = new Set(["edit", "find", "grep", "read", "write"]);
const SAFE_TOOL_ERROR_KINDS = new Set(["oldText_mismatch", "not_found", "permission", "timeout"]);
const SAFE_WARNING_CODES = new Set([
  "malformed_json", "session_header_not_first", "duplicate_session_header", "missing_id", "missing_header",
  "duplicate_id", "missing_parent", "parent_cycle", "unknown_entry_type", "unknown_message_role", "unknown_warning",
]);

export function candidateReviewReceiptPath({ config, project, runId, mode, attemptId }) {
  const safeRunId = normalizeRunId(runId);
  const safeMode = normalizeMode(mode);
  const safeAttemptId = normalizeAttemptId(attemptId);
  return path.join(
    projectCacheDir(resolveHarnessHome(config), project.projectKey),
    "analysis-runs",
    safeRunId,
    "candidate-reviews",
    safeMode,
    `${safeAttemptId}.json`,
  );
}

export function beginCandidateReviewAttempt({ config, project, analysisRun, mode, review, now = new Date(), attemptId } = {}) {
  validateRunBinding(analysisRun);
  const safeMode = normalizeMode(mode);
  const safeAttemptId = normalizeAttemptId(attemptId ?? createAttemptId(now));
  const receiptPath = candidateReviewReceiptPath({
    config,
    project,
    runId: analysisRun.runId,
    mode: safeMode,
    attemptId: safeAttemptId,
  });
  const receipt = {
    schemaVersion: 1,
    kind: "pi-harness.candidate-review-receipt",
    attemptStatus: "pending-proposal-write",
    attemptId: safeAttemptId,
    runId: analysisRun.runId,
    selectedFingerprint: analysisRun.selection.selectedFingerprint,
    mode: safeMode,
    startedAt: now.toISOString(),
    authority: { project: true, userHome: false },
    candidates: (review.candidates ?? []).map(privateCandidateAudit),
    assetInventory: privateAssetInventory(review.assetLane),
    reviews: review.decisions.map((decision) => privateDecisionAudit(decision)),
  };
  writeSecureAtomicJson(receiptPath, receipt, { exclusive: true });
  return { attemptId: safeAttemptId, receiptPath, receipt };
}

export function finalizeCandidateReviewAttempt({ attempt, config, project, analysisRun, mode, review, writeResult, now = new Date() } = {}) {
  validateRunBinding(analysisRun);
  if (!attempt?.attemptId) throw new Error("Candidate review finalize requires a pending attempt");
  const receiptPath = candidateReviewReceiptPath({
    config,
    project,
    runId: analysisRun.runId,
    mode,
    attemptId: attempt.attemptId,
  });
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch {
    throw new Error("Candidate review pending receipt is unreadable");
  }
  const safeMode = normalizeMode(mode);
  if (pending.attemptStatus !== "pending-proposal-write"
    || pending.attemptId !== attempt.attemptId
    || pending.runId !== analysisRun.runId
    || pending.selectedFingerprint !== analysisRun.selection.selectedFingerprint
    || pending.mode !== safeMode) {
    throw new Error("Candidate review pending receipt binding mismatch");
  }

  const proposalWrites = proposalWriteMap(writeResult);
  const receipt = {
    ...pending,
    attemptStatus: "complete",
    completedAt: now.toISOString(),
    reviews: review.decisions.map((decision) => ({
      ...privateDecisionAudit(decision),
      proposal: proposalWrites.get(decision.candidateId),
    })),
  };
  writeSecureAtomicJson(receiptPath, receipt);
  return { attemptId: attempt.attemptId, receiptPath, receipt };
}

function privateCandidateAudit(candidate) {
  return {
    schemaVersion: candidate.schemaVersion,
    id: boundedString(candidate.id),
    detectorId: boundedString(candidate.detectorId),
    kind: boundedString(candidate.kind),
    status: boundedString(candidate.status),
    scope: {
      authority: candidate.scope?.authority,
      ownerRoutes: (candidate.scope?.ownerRoutes ?? []).slice(0, 128).map(boundedString),
    },
    signal: privateSignalAudit(candidate),
    count: candidate.count,
    evidenceRefCount: candidate.evidenceRefs?.length ?? 0,
    evidenceRefsTruncated: (candidate.evidenceRefs?.length ?? 0) > 128,
    evidenceRefs: (candidate.evidenceRefs ?? []).slice(0, 128).map((ref) => ({
      sourceFingerprint: boundedString(ref.sourceFingerprint),
      sessionId: boundedString(ref.sessionId),
      entryId: boundedString(ref.entryId),
      eventId: ref.eventId ? boundedString(ref.eventId) : undefined,
      kind: boundedString(ref.kind),
      timestamp: ref.timestamp ? boundedString(ref.timestamp) : undefined,
    })),
    likelyDimensions: (candidate.likelyDimensions ?? []).slice(0, 32).map(boundedString),
    requiredReview: (candidate.requiredReview ?? []).slice(0, 32).map(boundedString),
  };
}

function privateAssetInventory(assetLane = {}) {
  return {
    status: assetLane.status,
    assets: (assetLane.assets ?? []).map((asset) => ({
      route: asset.route,
      type: asset.type,
      state: asset.state,
      digest: asset.digest,
      sectionIds: (asset.blocks ?? []).map((block) => block.sectionId),
    })),
    diagnostics: (assetLane.diagnostics ?? []).map((item) => ({ ...item })),
  };
}

function privateDecisionAudit(decision) {
  return {
    candidateId: decision.candidateId,
    detectorId: decision.detectorId,
    state: decision.state,
    reasonCode: decision.reasonCode,
    observedUse: decision.observedUse,
    reviewFingerprint: decision.reviewFingerprint,
    coverage: decision.coverage,
    ownerRoutes: decision.ownerRoutes,
    validationRoute: decision.validationRoute,
    diagnostics: decision.diagnostics,
  };
}

function proposalWriteMap(writeResult = {}) {
  const result = new Map();
  for (const proposal of writeResult.written ?? []) {
    if (!proposal.candidateId) continue;
    result.set(proposal.candidateId, {
      id: proposal.id,
      fingerprint: proposal.fingerprint,
      status: proposal.status,
      writeStatus: "written",
    });
  }
  for (const proposal of writeResult.skipped ?? []) {
    if (!proposal.candidateId) continue;
    result.set(proposal.candidateId, {
      id: proposal.id,
      fingerprint: proposal.fingerprint,
      status: proposal.status,
      writeStatus: "skipped",
      reason: proposal.reason,
    });
  }
  return result;
}

function writeSecureAtomicJson(filePath, value, { exclusive = false } = {}) {
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);
  const tmpPath = path.join(dirPath, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`);
  let fd;
  try {
    fd = fs.openSync(tmpPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (exclusive) fs.linkSync(tmpPath, filePath);
    else fs.renameSync(tmpPath, filePath);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* preserve the original write failure */ }
    }
    try { fs.unlinkSync(tmpPath); } catch { /* renamed or already cleaned */ }
    fsyncParentDirectory(dirPath);
  }
}

function fsyncParentDirectory(dirPath) {
  let dirFd;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0);
    dirFd = fs.openSync(dirPath, flags);
    fs.fsyncSync(dirFd);
  } catch {
    // Directory fsync is not portable; receipt file publication remains atomic.
  } finally {
    if (dirFd !== undefined) {
      try { fs.closeSync(dirFd); } catch { /* best effort portability path */ }
    }
  }
}

function createAttemptId(now) {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, "");
  return `attempt-${timestamp}-${crypto.randomUUID()}`;
}

function validateRunBinding(analysisRun) {
  normalizeRunId(analysisRun?.runId);
  if (!/^[a-f0-9]{64}$/.test(String(analysisRun?.selection?.selectedFingerprint ?? ""))) {
    throw new Error("Candidate review receipt requires a frozen selected fingerprint");
  }
}

function normalizeRunId(value) {
  const runId = String(value ?? "");
  if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Invalid analysis run id: ${runId}`);
  return runId;
}

function normalizeMode(value) {
  const raw = String(value ?? "rules").trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe || safe === "." || safe === ".." || safe.length > 80) throw new Error(`Invalid candidate review mode: ${raw}`);
  return safe;
}

function normalizeAttemptId(value) {
  const attemptId = String(value ?? "");
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) throw new Error(`Invalid candidate review attempt id: ${attemptId}`);
  return attemptId;
}

function privateSignalAudit(candidate) {
  switch (candidate.detectorId) {
    case "R-0001": {
      const raw = String(candidate.signal?.commandFamily ?? "");
      const firstToken = raw.trim().split(/\s+/, 1)[0].replace(/^['"]|['"]$/g, "");
      const executable = path.basename(firstToken).toLowerCase();
      return {
        commandClass: SAFE_COMMAND_CLASSES.has(executable) ? executable : "other",
        commandFingerprint: sha256(raw),
      };
    }
    case "R-0002": {
      const toolName = String(candidate.signal?.toolName ?? "");
      const errorKind = String(candidate.signal?.errorKind ?? "");
      return {
        toolName: SAFE_TOOL_NAMES.has(toolName) ? toolName : "other",
        errorKind: SAFE_TOOL_ERROR_KINDS.has(errorKind) || /^other-[a-f0-9]{12}$/.test(errorKind) ? errorKind : "other",
      };
    }
    case "R-0003":
      return {
        flagKinds: [...new Set(candidate.signal?.flagKinds ?? [])]
          .filter((value) => value === "sensitive-path" || value === "secret-detected")
          .sort(),
      };
    case "R-0004": {
      const warningCode = String(candidate.signal?.warningCode ?? "");
      return { warningCode: SAFE_WARNING_CODES.has(warningCode) ? warningCode : "other" };
    }
    default:
      return { classification: "unsupported", signalFingerprint: sha256(JSON.stringify(candidate.signal ?? null)) };
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function boundedString(value) {
  return String(value ?? "").slice(0, MAX_AUDIT_STRING);
}
