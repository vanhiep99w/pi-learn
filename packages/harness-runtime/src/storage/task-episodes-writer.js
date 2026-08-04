import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  TASK_EPISODE_KIND,
  TASK_EPISODE_POLICY,
  TASK_EPISODE_READER_KIND,
  taskEpisodeFingerprint,
} from "../analysis/task-episodes.js";
import { projectCacheDir, resolveHarnessHome } from "./harness-home.js";

const RUN_ID_PATTERN = /^run-[a-zA-Z0-9._-]{1,156}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;

export function taskEpisodeArtifactPaths({ config, project, runId }) {
  const safeRunId = normalizeRunId(runId);
  const safeProjectKey = normalizeProjectKey(project?.projectKey);
  const dir = path.join(
    projectCacheDir(resolveHarnessHome(config), safeProjectKey),
    "analysis-runs",
    safeRunId,
    "task-episodes",
  );
  return {
    dir,
    privatePath: path.join(dir, "private.json"),
    readerPath: path.join(dir, "reader.json"),
  };
}

export function writeTaskEpisodeArtifacts({
  config,
  project,
  analysisRun,
  privateArtifact,
  readerArtifact,
  verificationHooks,
} = {}) {
  validateArtifactPair({ analysisRun, project, privateArtifact, readerArtifact });
  const paths = taskEpisodeArtifactPaths({ config, project, runId: analysisRun.runId });
  const binding = openSecureArtifactDirectory({ config, project, paths, create: true, verificationHooks });

  try {
    const privateState = securePathState(paths.privatePath, "private", binding);
    const readerState = securePathState(paths.readerPath, "reader", binding);
    if (privateState === "absent" && readerState !== "absent") throw publicationError("orphan-reader-artifact");

    let privateStatus = "existing";
    if (privateState === "present") {
      assertExistingArtifact(paths.privatePath, privateArtifact, "private", binding);
    } else {
      writeSecureExclusiveJson(paths.privatePath, privateArtifact, "private", binding);
      privateStatus = "written";
    }

    let readerStatus = "existing";
    if (readerState === "present") {
      assertExistingArtifact(paths.readerPath, readerArtifact, "reader", binding);
    } else {
      // Private is deliberately published first. Exact replay can complete a
      // private-only interruption after validating the bound private artifact.
      writeSecureExclusiveJson(paths.readerPath, readerArtifact, "reader", binding);
      readerStatus = "written";
    }

    assertDirectoryBinding(binding);
    const storedPrivate = readSecureJson(paths.privatePath, "private", binding);
    const storedReader = readSecureJson(paths.readerPath, "reader", binding);
    validateArtifactPair({ analysisRun, project, privateArtifact: storedPrivate, readerArtifact: storedReader });
    assertDirectoryBinding(binding);
    return { status: "complete", privateStatus, readerStatus, reader: storedReader };
  } finally {
    closeBinding(binding);
  }
}

export function readTaskEpisodeArtifacts({ config, project, analysisRun, verificationHooks } = {}) {
  const paths = taskEpisodeArtifactPaths({ config, project, runId: analysisRun?.runId });
  const binding = openSecureArtifactDirectory({ config, project, paths, create: false, verificationHooks });
  try {
    const privateArtifact = readSecureJson(paths.privatePath, "private", binding);
    const readerArtifact = readSecureJson(paths.readerPath, "reader", binding);
    validateArtifactPair({ analysisRun, project, privateArtifact, readerArtifact });
    assertDirectoryBinding(binding);
    return { reader: readerArtifact };
  } finally {
    closeBinding(binding);
  }
}

function validateArtifactPair({ analysisRun, project, privateArtifact, readerArtifact }) {
  normalizeRunId(analysisRun?.runId);
  const projectKey = normalizeProjectKey(project?.projectKey);
  const projectRoot = normalizeProjectRoot(project?.projectRoot);
  if (analysisRun?.project?.projectKey !== projectKey) throw publicationError("analysis-run-destination-project-key");
  if (normalizeProjectRoot(analysisRun?.project?.projectRoot) !== projectRoot) {
    throw publicationError("analysis-run-destination-project-root");
  }
  if (!privateArtifact || typeof privateArtifact !== "object" || Array.isArray(privateArtifact)) throw publicationError("private-artifact-shape");
  if (!readerArtifact || typeof readerArtifact !== "object" || Array.isArray(readerArtifact)) throw publicationError("reader-artifact-shape");
  if (privateArtifact.schemaVersion !== 1 || privateArtifact.kind !== TASK_EPISODE_KIND || privateArtifact.policy !== TASK_EPISODE_POLICY) {
    throw publicationError("private-artifact-contract");
  }
  if (readerArtifact.schemaVersion !== 1 || readerArtifact.kind !== TASK_EPISODE_READER_KIND || readerArtifact.policy !== TASK_EPISODE_POLICY) {
    throw publicationError("reader-artifact-contract");
  }
  if (privateArtifact.runBinding?.runId !== analysisRun.runId) throw publicationError("private-run-binding");
  if (privateArtifact.runBinding?.projectKey !== projectKey) throw publicationError("private-project-key-binding");
  if (normalizeProjectRoot(privateArtifact.runBinding?.projectRoot) !== projectRoot) {
    throw publicationError("private-project-root-binding");
  }
  if (privateArtifact.runBinding?.contextFingerprint !== analysisRun.contextFingerprint) throw publicationError("private-context-binding");
  if (privateArtifact.runBinding?.selectedFingerprint !== analysisRun.selection?.selectedFingerprint) throw publicationError("private-selection-binding");

  const expectedRunCounts = {
    runId: analysisRun.runId,
    selectedCount: analysisRun.selection?.selectedCount,
    acceptedCount: analysisRun.consumption?.acceptedCount,
    skippedCount: analysisRun.consumption?.skippedCount,
    consumerStatus: analysisRun.consumption?.status,
  };
  const privateRunCounts = {
    runId: privateArtifact.runBinding?.runId,
    selectedCount: privateArtifact.runBinding?.selectedCount,
    acceptedCount: privateArtifact.runBinding?.acceptedCount,
    skippedCount: privateArtifact.runBinding?.skippedCount,
    consumerStatus: privateArtifact.runBinding?.consumerStatus,
  };
  if (stableStringify(privateRunCounts) !== stableStringify(expectedRunCounts)) throw publicationError("private-run-count-binding");
  if (stableStringify(readerArtifact.runBinding) !== stableStringify(expectedRunCounts)) throw publicationError("reader-run-binding");
  if (!FINGERPRINT_PATTERN.test(String(privateArtifact.readerProjectionFingerprint ?? ""))) throw publicationError("reader-fingerprint-shape");
  if (!FINGERPRINT_PATTERN.test(String(privateArtifact.artifactFingerprint ?? ""))) throw publicationError("private-fingerprint-shape");

  const { artifactFingerprint, ...privatePayload } = privateArtifact;
  if (taskEpisodeFingerprint(privatePayload) !== artifactFingerprint) throw publicationError("private-fingerprint-mismatch");
  if (taskEpisodeFingerprint(readerArtifact) !== privateArtifact.readerProjectionFingerprint) throw publicationError("reader-private-binding-mismatch");

  const derivedCounts = derivePrivateCounts(privateArtifact);
  if (stableStringify(privateArtifact.counts) !== stableStringify(derivedCounts)) throw publicationError("private-count-reconciliation");
  if (stableStringify(privateArtifact.counts) !== stableStringify(readerArtifact.counts)) throw publicationError("count-binding-mismatch");
  if (!Array.isArray(readerArtifact.episodes) || readerArtifact.episodes.length !== derivedCounts.retained) {
    throw publicationError("reader-retained-count-mismatch");
  }
  const derivedStatus = derivePrivateStatus(privateArtifact, derivedCounts);
  if (privateArtifact.status !== derivedStatus) throw publicationError("private-status-reconciliation");
  if (readerArtifact.status !== privateArtifact.status || readerArtifact.continuation !== privateArtifact.continuation) {
    throw publicationError("reader-status-binding");
  }
}

function derivePrivateCounts(privateArtifact) {
  if (!Array.isArray(privateArtifact.sessions)) throw publicationError("private-sessions-shape");
  let completeSessions = 0;
  let partialSessions = 0;
  let activeEvents = 0;
  let offPathEventsOmitted = 0;
  let candidates = 0;
  let retained = 0;
  let discarded = 0;
  let discardedZeroSignal = 0;

  for (const session of privateArtifact.sessions) {
    if (!session || typeof session !== "object" || Array.isArray(session) || !Array.isArray(session.candidates)) {
      throw publicationError("private-session-shape");
    }
    if (session.candidateCount !== session.candidates.length) throw publicationError("private-session-candidate-count");
    if (session.normalizedEvents?.status === "complete") completeSessions++;
    else if (session.normalizedEvents?.status === "partial") partialSessions++;
    else throw publicationError("private-session-status");
    if (!isNonNegativeInteger(session.normalizedEvents?.activeEventCount)
      || !isNonNegativeInteger(session.normalizedEvents?.offPathEventCount)) {
      throw publicationError("private-session-event-count");
    }
    activeEvents += session.normalizedEvents.activeEventCount;
    offPathEventsOmitted += session.normalizedEvents.offPathEventCount;
    candidates += session.candidates.length;
    for (const candidate of session.candidates) {
      if (candidate?.retention?.status === "retained") retained++;
      else if (candidate?.retention?.status === "discarded") {
        discarded++;
        if (candidate.retention.reason === "zero-signal") discardedZeroSignal++;
      } else {
        throw publicationError("private-candidate-retention");
      }
    }
  }

  const selectedSessions = privateArtifact.runBinding?.selectedCount;
  const acceptedSessions = privateArtifact.sessions.length;
  if (!isNonNegativeInteger(selectedSessions) || acceptedSessions > selectedSessions) {
    throw publicationError("private-session-count-binding");
  }
  const skippedSessions = selectedSessions - acceptedSessions;
  if (acceptedSessions !== privateArtifact.runBinding?.acceptedCount
    || skippedSessions !== privateArtifact.runBinding?.skippedCount
    || completeSessions + partialSessions !== acceptedSessions) {
    throw publicationError("private-session-count-binding");
  }
  if (discarded !== discardedZeroSignal) throw publicationError("private-discard-reason");
  return {
    selectedSessions,
    acceptedSessions,
    skippedSessions,
    completeSessions,
    partialSessions,
    activeEvents,
    offPathEventsOmitted,
    candidates,
    retained,
    discarded,
    discardedZeroSignal,
  };
}

function derivePrivateStatus(privateArtifact, counts) {
  if (counts.selectedSessions === 0) return "observed-empty";
  if (privateArtifact.runBinding?.consumerStatus === "partial" || counts.partialSessions > 0) return "partial";
  return "complete";
}

function openSecureArtifactDirectory({ config, project, paths, create, verificationHooks }) {
  if (typeof fs.constants.O_NOFOLLOW !== "number") throw publicationError("secure-open-unavailable");
  const harnessHome = resolveHarnessHome(config);
  const projectDir = projectCacheDir(harnessHome, normalizeProjectKey(project?.projectKey));
  const runDir = path.dirname(paths.dir);
  assertDirectoryChainIsSafe(harnessHome, runDir);

  if (!pathEntryExists(paths.dir)) {
    if (!create) throw publicationError("task-episode-directory-missing");
    fs.mkdirSync(paths.dir, { mode: 0o700 });
  }
  const taskStat = fs.lstatSync(paths.dir);
  if (!taskStat.isDirectory() || taskStat.isSymbolicLink()) throw publicationError("task-episode-directory-unsafe");
  if ((taskStat.mode & 0o777) !== 0o700 || !ownedByCurrentUser(taskStat)) {
    throw publicationError("task-episode-directory-mode");
  }
  assertDirectoryChainIsSafe(harnessHome, paths.dir);

  let fd;
  try {
    fd = fs.openSync(paths.dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
    const descriptorStat = fs.fstatSync(fd);
    const binding = {
      fd,
      dirPath: paths.dir,
      projectDir,
      harnessHome,
      descriptorStat,
      verificationHooks,
    };
    verificationHooks?.afterDirectoryOpen?.({ fd, dirPath: paths.dir });
    assertDirectoryBinding(binding);
    return binding;
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* preserve the binding error */ }
    }
    if (error?.code === "TASK_EPISODE_PUBLICATION_FAILED") throw error;
    throw publicationError("task-episode-directory-open", error);
  }
}

function assertDirectoryBinding(binding) {
  assertDirectoryChainIsSafe(binding.harnessHome, binding.dirPath);
  let descriptorStat;
  try {
    descriptorStat = fs.fstatSync(binding.fd);
  } catch (error) {
    throw publicationError("task-episode-directory-binding-unverifiable", error);
  }
  if (!descriptorStat.isDirectory() || (descriptorStat.mode & 0o777) !== 0o700 || !ownedByCurrentUser(descriptorStat)) {
    throw publicationError("task-episode-directory-mode");
  }
  const descriptorPath = descriptorRealPath(binding.fd, binding.verificationHooks, {
    kind: "directory",
    expectedPath: binding.dirPath,
  });
  if (!descriptorPath) throw publicationError("secure-binding-unavailable");
  if (path.resolve(descriptorPath) !== path.resolve(binding.dirPath)
    || !isInsideRoot(binding.projectDir, descriptorPath)) {
    throw publicationError("task-episode-directory-binding-mismatch");
  }
  const intended = fs.lstatSync(binding.dirPath);
  if (intended.isSymbolicLink() || !intended.isDirectory()
    || intended.dev !== descriptorStat.dev || intended.ino !== descriptorStat.ino) {
    throw publicationError("task-episode-directory-binding-mismatch");
  }
  if (descriptorStat.dev !== binding.descriptorStat.dev || descriptorStat.ino !== binding.descriptorStat.ino) {
    throw publicationError("task-episode-directory-binding-mismatch");
  }
}

function assertDirectoryChainIsSafe(rootDir, targetDir) {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteTarget = path.resolve(targetDir);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw publicationError("analysis-run-directory-escape");
  }
  let current = absoluteRoot;
  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      throw publicationError("analysis-run-directory-missing", error);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw publicationError("analysis-run-directory-unsafe");
  }
}

function securePathState(filePath, label, binding) {
  assertDirectoryBinding(binding);
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw publicationError(`${label}-artifact-unsafe`);
    if ((stat.mode & 0o777) !== 0o600 || !ownedByCurrentUser(stat)) throw publicationError(`${label}-artifact-mode`);
    return "present";
  } catch (error) {
    if (error?.code === "ENOENT") return "absent";
    throw error;
  }
}

function writeSecureExclusiveJson(filePath, value, label, binding) {
  const dirPath = path.dirname(filePath);
  const tmpPath = path.join(dirPath, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`);
  let tmpFd;
  let finalFd;
  let tmpIdentity;
  try {
    assertDirectoryBinding(binding);
    tmpFd = fs.openSync(tmpPath, "wx", 0o600);
    let tmpStat = fs.fstatSync(tmpFd);
    assertOpenedFileBinding({ fd: tmpFd, filePath: tmpPath, label: `${label}-temp`, binding, descriptorStat: tmpStat });
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (bytes.length > MAX_ARTIFACT_BYTES) throw publicationError(`${label}-artifact-oversized`);
    fs.writeFileSync(tmpFd, bytes);
    fs.fsyncSync(tmpFd);
    tmpStat = fs.fstatSync(tmpFd);
    if (tmpStat.size !== bytes.length || (tmpStat.mode & 0o777) !== 0o600) throw publicationError(`${label}-temp-mutation`);
    assertOpenedFileBinding({ fd: tmpFd, filePath: tmpPath, label: `${label}-temp`, binding, descriptorStat: tmpStat });
    tmpIdentity = { dev: tmpStat.dev, ino: tmpStat.ino };
    binding.verificationHooks?.afterTempWrite?.({ fd: tmpFd, filePath: tmpPath, label });
    const afterHook = fs.fstatSync(tmpFd);
    if (!sameFileSnapshot(tmpStat, afterHook)) throw publicationError(`${label}-temp-mutation`);
    assertOpenedFileBinding({ fd: tmpFd, filePath: tmpPath, label: `${label}-temp`, binding, descriptorStat: afterHook });

    assertDirectoryBinding(binding);
    try {
      fs.linkSync(tmpPath, filePath);
    } catch (error) {
      if (error?.code === "EEXIST") throw publicationError("artifact-collision", error);
      throw publicationError(`${label}-artifact-link`, error);
    }
    finalFd = openNoFollow(filePath, label);
    let finalStat = fs.fstatSync(finalFd);
    if (finalStat.dev !== tmpIdentity.dev || finalStat.ino !== tmpIdentity.ino) {
      throw publicationError(`${label}-artifact-inode-mismatch`);
    }
    assertOpenedFileBinding({ fd: finalFd, filePath, label, binding, descriptorStat: finalStat });
    binding.verificationHooks?.afterLink?.({ fd: finalFd, filePath, label });
    const afterLink = fs.fstatSync(finalFd);
    if (!sameFileSnapshot(finalStat, afterLink)) throw publicationError(`${label}-artifact-mutation`);
    assertOpenedFileBinding({ fd: finalFd, filePath, label, binding, descriptorStat: afterLink });
    assertDirectoryBinding(binding);
    fsyncDirectoryDescriptor(binding.fd);
  } catch (error) {
    if (error?.code === "TASK_EPISODE_PUBLICATION_FAILED") throw error;
    throw publicationError(`${label}-artifact-write`, error);
  } finally {
    if (finalFd !== undefined) {
      try { fs.closeSync(finalFd); } catch { /* preserve publication outcome */ }
    }
    if (tmpFd !== undefined) {
      try { fs.closeSync(tmpFd); } catch { /* preserve publication outcome */ }
    }
    cleanupBoundTemp(tmpPath, tmpIdentity, binding);
    fsyncDirectoryDescriptor(binding.fd);
  }
}

function assertExistingArtifact(filePath, expected, label, binding) {
  const actual = readSecureJson(filePath, label, binding);
  if (stableStringify(actual) !== stableStringify(expected)) throw publicationError(`${label}-artifact-collision-mismatch`);
}

function readSecureJson(filePath, label, binding) {
  let fd;
  try {
    assertDirectoryBinding(binding);
    binding.verificationHooks?.beforeArtifactOpen?.({ filePath, label });
    fd = openNoFollow(filePath, label);
    const before = fs.fstatSync(fd);
    assertOpenedFileBinding({ fd, filePath, label, binding, descriptorStat: before });
    if (before.size > MAX_ARTIFACT_BYTES) throw publicationError(`${label}-artifact-oversized`);
    binding.verificationHooks?.afterArtifactOpen?.({ fd, filePath, label });
    assertOpenedFileBinding({ fd, filePath, label, binding, descriptorStat: fs.fstatSync(fd) });
    const buffer = readBoundedDescriptor(fd, MAX_ARTIFACT_BYTES);
    binding.verificationHooks?.afterArtifactRead?.({ fd, filePath, label });
    const after = fs.fstatSync(fd);
    if (!sameFileSnapshot(before, after) || buffer.length !== before.size) {
      throw publicationError(`${label}-artifact-mutated-during-read`);
    }
    assertOpenedFileBinding({ fd, filePath, label, binding, descriptorStat: after });
    assertDirectoryBinding(binding);
    if (buffer.includes(0)) throw publicationError(`${label}-artifact-unreadable`);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return JSON.parse(text);
    } catch (error) {
      throw publicationError(`${label}-artifact-unreadable`, error);
    }
  } catch (error) {
    if (error?.code === "ENOENT") throw publicationError(`${label}-artifact-missing`, error);
    if (error?.code === "ELOOP") throw publicationError(`${label}-artifact-unsafe`, error);
    if (error?.code === "TASK_EPISODE_PUBLICATION_FAILED") throw error;
    throw publicationError(`${label}-artifact-unreadable`, error);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* preserve read outcome */ }
    }
  }
}

function assertOpenedFileBinding({ fd, filePath, label, binding, descriptorStat }) {
  if (!descriptorStat.isFile()) throw publicationError(`${label}-artifact-unsafe`);
  if ((descriptorStat.mode & 0o777) !== 0o600 || !ownedByCurrentUser(descriptorStat)) {
    throw publicationError(`${label}-artifact-mode`);
  }
  const descriptorPath = descriptorRealPath(fd, binding.verificationHooks, {
    kind: "file",
    label,
    expectedPath: filePath,
  });
  if (!descriptorPath) throw publicationError("secure-binding-unavailable");
  if (path.resolve(descriptorPath) !== path.resolve(filePath)
    || !isInsideRoot(binding.dirPath, descriptorPath)
    || !isInsideRoot(binding.projectDir, descriptorPath)) {
    throw publicationError(`${label}-artifact-binding-mismatch`);
  }
  let intended;
  let intendedRealPath;
  try {
    intended = fs.lstatSync(filePath);
    intendedRealPath = fs.realpathSync(filePath);
  } catch (error) {
    throw publicationError(`${label}-artifact-binding-unverifiable`, error);
  }
  if (intended.isSymbolicLink() || !intended.isFile()
    || intended.dev !== descriptorStat.dev || intended.ino !== descriptorStat.ino
    || path.resolve(intendedRealPath) !== path.resolve(descriptorPath)) {
    throw publicationError(`${label}-artifact-binding-mismatch`);
  }
  assertDirectoryBinding(binding);
}

function openNoFollow(filePath, label) {
  if (typeof fs.constants.O_NOFOLLOW !== "number") throw publicationError("secure-open-unavailable");
  try {
    return fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") throw publicationError(`${label}-artifact-missing`, error);
    if (error?.code === "ELOOP") throw publicationError(`${label}-artifact-unsafe`, error);
    throw error;
  }
}

function descriptorRealPath(fd, verificationHooks, context) {
  if (verificationHooks?.descriptorRealPath) return verificationHooks.descriptorRealPath({ fd, ...context });
  for (const base of ["/proc/self/fd", "/dev/fd"]) {
    try {
      const resolved = fs.realpathSync(path.join(base, String(fd)));
      if (path.isAbsolute(resolved)) return resolved;
    } catch {
      // Try the next platform-specific descriptor namespace.
    }
  }
  return undefined;
}

function readBoundedDescriptor(fd, maxBytes) {
  const output = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < output.length) {
    const bytesRead = fs.readSync(fd, output, offset, output.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > maxBytes) throw publicationError("artifact-size-limit");
  return output.subarray(0, offset);
}

function cleanupBoundTemp(tmpPath, identity, binding) {
  try {
    assertDirectoryBinding(binding);
    const stat = fs.lstatSync(tmpPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return;
    if (identity && (stat.dev !== identity.dev || stat.ino !== identity.ino)) return;
    fs.unlinkSync(tmpPath);
    assertDirectoryBinding(binding);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      // Fail closed on cleanup: never unlink an unverified replacement path.
    }
  }
}

function closeBinding(binding) {
  if (binding?.fd !== undefined) {
    try { fs.closeSync(binding.fd); } catch { /* best-effort close */ }
  }
}

function fsyncDirectoryDescriptor(fd) {
  try { fs.fsyncSync(fd); } catch { /* directory fsync is not portable */ }
}

function pathEntryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeRunId(value) {
  const runId = String(value ?? "");
  if (!RUN_ID_PATTERN.test(runId)) throw publicationError("invalid-run-id");
  return runId;
}

function normalizeProjectKey(value) {
  const projectKey = String(value ?? "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(projectKey) || projectKey === "." || projectKey === "..") {
    throw publicationError("invalid-project-key");
  }
  return projectKey;
}

function normalizeProjectRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw publicationError("invalid-project-root");
  }
  return path.resolve(value);
}

function publicationError(reason, cause) {
  const error = new Error(`Task episode artifact publication failed: ${reason}`, cause ? { cause } : undefined);
  error.name = "TaskEpisodePublicationError";
  error.code = "TASK_EPISODE_PUBLICATION_FAILED";
  error.reason = reason;
  return error;
}

function ownedByCurrentUser(stat) {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
