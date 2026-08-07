import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson, atomicWriteJsonl } from "../storage/atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "../storage/harness-home.js";
import {
  FINDING_SCHEMA_VERSION,
  dedupeFindings,
  normalizeFinding,
  publicFinding,
  stableStringify,
  validateFindingSet,
} from "./schema.js";

const LEDGER_SCHEMA_VERSION = 1;
const MAX_HISTORY_RECORDS = 1024;
const MAX_LATEST_BYTES = 4 * 1024 * 1024;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const PROJECT_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export function findingsPaths({ config = {}, project } = {}) {
  const projectKey = normalizeProjectKey(project?.projectKey);
  const harnessHome = resolveHarnessHome(config);
  const projectDir = projectCacheDir(harnessHome, projectKey);
  const dir = path.join(projectDir, "findings");
  return {
    harnessHome,
    projectDir,
    dir,
    latestPath: path.join(dir, "latest.json"),
    historyPath: path.join(dir, "history.jsonl"),
  };
}

export function writeFindingsLedger({ config = {}, project, findings, now = new Date() } = {}) {
  const supplied = validateFindingSet(findings);
  const paths = findingsPaths({ config, project });
  preparePrivateDirectories(paths);
  const current = readPrivateLedger(paths);

  const existingById = new Map(current.findings.map((finding) => [finding.id, finding]));
  let changed = false;
  for (const incoming of supplied) {
    const previous = existingById.get(incoming.id);
    if (incoming.revision !== undefined && previous && incoming.revision !== previous.revision) {
      throw ledgerError("FINDINGS_REVISION_CONFLICT", `Finding ${incoming.id} revision is stale`);
    }
    if (incoming.revision !== undefined && !previous && incoming.revision !== 0) {
      throw ledgerError("FINDINGS_REVISION_CONFLICT", `New finding ${incoming.id} must start at revision 0`);
    }

    const proposalRefs = [...new Set([...(previous?.proposalRefs ?? []), ...incoming.proposalRefs])].sort();
    const candidate = {
      ...incoming,
      proposalRefs,
      revision: previous?.revision ?? 0,
    };
    const next = previous && stableStringify(stripRevision(previous)) === stableStringify(stripRevision(candidate))
      ? previous
      : { ...candidate, revision: previous ? previous.revision + 1 : 0 };
    if (!previous || stableStringify(next) !== stableStringify(previous)) changed = true;
    existingById.set(incoming.id, next);
  }

  const nextFindings = [...existingById.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (!changed) {
    if (!current.recovered) return publicLedger(current, { writeStatus: "unchanged" });
    writePrivateJson(paths.latestPath, makeLatestRecord({
      project,
      ledgerRevision: current.ledgerRevision,
      updatedAt: toIso(now),
      findings: current.findings,
    }));
    return publicLedger({ ...current, recovered: false, diagnostics: [] }, { writeStatus: "recovered" });
  }

  const ledgerRevision = current.ledgerRevision + 1;
  const recordedAt = toIso(now);
  const historyRecord = makeHistoryRecord({ project, ledgerRevision, recordedAt, findings: nextFindings });
  const latestRecord = makeLatestRecord({ project, ledgerRevision, updatedAt: recordedAt, findings: nextFindings });
  const nextHistory = [...current.history, historyRecord];
  assertHistoryBounds(nextHistory);

  // History is published first so an interruption can recover the latest
  // complete snapshot from the append-only log on the next read.
  writePrivateJsonl(paths.historyPath, nextHistory);
  try {
    writePrivateJson(paths.latestPath, latestRecord);
  } catch (error) {
    throw ledgerError("FINDINGS_PUBLICATION_INCOMPLETE", "Findings history was durable but latest publication failed", error);
  }

  return publicLedger({
    ledgerRevision,
    findings: nextFindings,
    history: nextHistory,
    recovered: false,
    diagnostics: [],
  }, { writeStatus: "written" });
}

function assertHistoryBounds(history) {
  if (history.length > MAX_HISTORY_RECORDS) {
    throw ledgerError("FINDINGS_HISTORY_LIMIT", "Findings history exceeds the bounded record limit");
  }
  const content = `${history.map((record) => JSON.stringify(record)).join("\n")}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_HISTORY_BYTES) {
    throw ledgerError("FINDINGS_HISTORY_LIMIT", "Findings history exceeds the bounded byte limit");
  }
}

export function readFindingsLedger({ config = {}, project } = {}) {
  const paths = findingsPaths({ config, project });
  const state = readPrivateLedger(paths);
  return publicLedger(state);
}

function readPrivateLedger(paths) {
  const canRead = existingPrivateDirectory(paths);
  if (!canRead) {
    return { ledgerRevision: 0, findings: [], history: [], recovered: false, diagnostics: [] };
  }

  const latest = readPrivateJson(paths.latestPath, "latest", MAX_LATEST_BYTES);
  const history = readPrivateJsonl(paths.historyPath, "history", MAX_HISTORY_BYTES);
  if (latest === undefined && history === undefined) {
    return { ledgerRevision: 0, findings: [], history: [], recovered: false, diagnostics: [] };
  }
  if (history === undefined || history.length === 0) {
    throw ledgerError("FINDINGS_STORAGE_INCOMPLETE", "Findings latest/history pair is incomplete");
  }

  const validatedHistory = history.map((record) => validateHistoryRecord(record, paths.projectDir));
  validateHistorySequence(validatedHistory);
  const last = validatedHistory[validatedHistory.length - 1];
  let recovered = false;
  const diagnostics = [];
  let selected = latest === undefined ? undefined : validateLatestRecord(latest, paths.projectDir);

  if (!selected || selected.ledgerRevision < last.ledgerRevision) {
    selected = last;
    recovered = true;
    diagnostics.push(latest === undefined ? "latest_missing_recovered_from_history" : "latest_stale_recovered_from_history");
  } else if (selected.ledgerRevision > last.ledgerRevision) {
    throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Findings latest is ahead of history");
  } else if (!sameSnapshot(selected, last)) {
    throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Findings latest does not match history");
  }

  return {
    ledgerRevision: selected.ledgerRevision,
    findings: selected.findings,
    history: validatedHistory,
    recovered,
    diagnostics,
  };
}

function makeLatestRecord({ project, ledgerRevision, updatedAt, findings }) {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    projectKey: normalizeProjectKey(project?.projectKey),
    ledgerRevision,
    updatedAt,
    findings,
  };
}

function makeHistoryRecord({ project, ledgerRevision, recordedAt, findings }) {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    projectKey: normalizeProjectKey(project?.projectKey),
    ledgerRevision,
    recordedAt,
    findings,
  };
}

function validateLatestRecord(value, projectDir) {
  validateEnvelopeKeys(value, ["schemaVersion", "projectKey", "ledgerRevision", "updatedAt", "findings"]);
  validateLedgerEnvelope(value, projectDir);
  if (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt))) throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Invalid latest timestamp");
  return { ledgerRevision: value.ledgerRevision, findings: validateStoredFindings(value.findings), recordedAt: value.updatedAt };
}

function validateHistoryRecord(value, projectDir) {
  validateEnvelopeKeys(value, ["schemaVersion", "projectKey", "ledgerRevision", "recordedAt", "findings"]);
  validateLedgerEnvelope(value, projectDir);
  if (typeof value.recordedAt !== "string" || Number.isNaN(Date.parse(value.recordedAt))) throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Invalid history timestamp");
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    projectKey: value.projectKey,
    ledgerRevision: value.ledgerRevision,
    findings: validateStoredFindings(value.findings),
    recordedAt: value.recordedAt,
  };
}

function validateLedgerEnvelope(value, projectDir) {
  if (!isPlainObject(value) || value.schemaVersion !== LEDGER_SCHEMA_VERSION || value.projectKey !== path.basename(projectDir)) {
    throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Findings storage envelope is invalid");
  }
  if (!Number.isSafeInteger(value.ledgerRevision) || value.ledgerRevision < 1) throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Invalid findings ledger revision");
  if (!Array.isArray(value.findings)) throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Stored findings must be an array");
}

function validateStoredFindings(value) {
  if (value.length > 256) throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Stored finding count exceeds the bounded limit");
  const findings = value.map((item) => {
    try {
      return normalizeFinding(item, { requireRevision: true });
    } catch (error) {
      throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Stored finding is invalid", error);
    }
  });
  const deduped = dedupeFindings(findings);
  if (deduped.length !== findings.length) throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Stored findings contain duplicates");
  return deduped;
}

function validateHistorySequence(history) {
  if (history.length > MAX_HISTORY_RECORDS) throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Findings history exceeds the bounded limit");
  for (let index = 0; index < history.length; index += 1) {
    if (history[index].ledgerRevision !== index + 1) throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Findings history revision sequence is invalid");
  }
}

function sameSnapshot(left, right) {
  return left.ledgerRevision === right.ledgerRevision
    && stableStringify(left.findings) === stableStringify(right.findings);
}

function publicLedger(state, { writeStatus } = {}) {
  const findings = state.findings.map(publicFinding);
  return {
    kind: "pi-harness.findings",
    schemaVersion: FINDING_SCHEMA_VERSION,
    status: state.ledgerRevision === 0 ? "empty" : state.recovered ? "recovered" : "complete",
    authority: { project: true, userHome: false },
    ledgerRevision: state.ledgerRevision,
    counts: { total: findings.length },
    findings,
    diagnostics: [...(state.diagnostics ?? [])],
    ...(writeStatus ? { write: { status: writeStatus, ledgerRevision: state.ledgerRevision } } : {}),
  };
}

function preparePrivateDirectories(paths) {
  createPrivateDirectory(paths.harnessHome);
  createPrivateDirectory(path.join(paths.harnessHome, "projects"));
  createPrivateDirectory(paths.projectDir);
  createPrivateDirectory(paths.dir);
}

function existingPrivateDirectory(paths) {
  const parentDirectories = [paths.harnessHome, path.join(paths.harnessHome, "projects"), paths.projectDir];
  const findingsState = lstatOrMissing(paths.dir);
  if (findingsState === undefined) {
    for (const directory of parentDirectories) {
      const state = lstatOrMissing(directory);
      if (state === undefined) return false;
      assertPrivateDirectory(directory, state, { requireMode: false });
    }
    return false;
  }
  for (const directory of parentDirectories) {
    const state = lstatOrMissing(directory);
    if (state === undefined) return false;
    assertPrivateDirectory(directory, state);
  }
  assertPrivateDirectory(paths.dir, findingsState);
  return true;
}

function createPrivateDirectory(directory) {
  const state = lstatOrMissing(directory);
  if (state === undefined) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const finalState = lstatOrMissing(directory);
  if (!finalState) throw ledgerError("FINDINGS_STORAGE_UNAVAILABLE", "Findings directory could not be created");
  assertPrivateDirectory(directory, finalState, { repairMode: true });
}

function assertPrivateDirectory(directory, stat, { repairMode = false, requireMode = true } = {}) {
  if (stat.isSymbolicLink() || !stat.isDirectory() || !ownedByCurrentUser(stat)) {
    throw ledgerError("FINDINGS_STORAGE_UNSAFE", "Findings storage directory is unsafe");
  }
  if (requireMode && (stat.mode & 0o777) !== 0o700) {
    if (!repairMode) throw ledgerError("FINDINGS_STORAGE_MODE", "Findings storage directory is not owner-only");
    fs.chmodSync(directory, 0o700);
    const repaired = fs.lstatSync(directory);
    if ((repaired.mode & 0o777) !== 0o700) throw ledgerError("FINDINGS_STORAGE_MODE", "Findings storage directory is not owner-only");
  }
}

function writePrivateJson(filePath, value) {
  assertWritableFilePath(filePath);
  atomicWriteJson(filePath, value);
  setPrivateFileMode(filePath);
}

function writePrivateJsonl(filePath, values) {
  assertWritableFilePath(filePath);
  atomicWriteJsonl(filePath, values);
  setPrivateFileMode(filePath);
}

function assertWritableFilePath(filePath) {
  const stat = lstatOrMissing(filePath);
  if (stat && (stat.isSymbolicLink() || !stat.isFile() || !ownedByCurrentUser(stat) || (stat.mode & 0o777) !== 0o600)) {
    throw ledgerError("FINDINGS_STORAGE_UNSAFE", "Findings storage file is unsafe");
  }
}

function setPrivateFileMode(filePath) {
  fs.chmodSync(filePath, 0o600);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || !ownedByCurrentUser(stat) || (stat.mode & 0o777) !== 0o600) {
    throw ledgerError("FINDINGS_STORAGE_MODE", "Findings storage file is not owner-only");
  }
}

function readPrivateJson(filePath, label, maxBytes) {
  const buffer = readPrivateFile(filePath, label, maxBytes);
  if (buffer === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch (error) {
    throw ledgerError("FINDINGS_STORAGE_TAMPERED", `Invalid findings ${label} JSON`, error);
  }
}

function readPrivateJsonl(filePath, label, maxBytes) {
  const buffer = readPrivateFile(filePath, label, maxBytes);
  if (buffer === undefined) return undefined;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw ledgerError("FINDINGS_STORAGE_TAMPERED", `Invalid findings ${label} encoding`, error);
  }
  if (!text.trim()) throw ledgerError("FINDINGS_STORAGE_TAMPERED", `Empty findings ${label} history`);
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0)) throw ledgerError("FINDINGS_STORAGE_TAMPERED", `Blank findings ${label} record`);
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw ledgerError("FINDINGS_STORAGE_TAMPERED", `Invalid findings ${label} record`, error);
    }
  });
}

function readPrivateFile(filePath, label, maxBytes) {
  const stat = lstatOrMissing(filePath);
  if (!stat) return undefined;
  if (stat.isSymbolicLink() || !stat.isFile() || !ownedByCurrentUser(stat) || (stat.mode & 0o777) !== 0o600) {
    throw ledgerError("FINDINGS_STORAGE_UNSAFE", `Findings ${label} file is unsafe`);
  }
  if (stat.size > maxBytes) throw ledgerError("FINDINGS_STORAGE_LIMIT", `Findings ${label} file exceeds the bounded limit`);
  if (typeof fs.constants.O_NOFOLLOW !== "number") throw ledgerError("FINDINGS_STORAGE_UNAVAILABLE", "No-follow file reads are unavailable");
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size > maxBytes || (before.mode & 0o777) !== 0o600 || !ownedByCurrentUser(before)) {
      throw ledgerError("FINDINGS_STORAGE_TAMPERED", `Findings ${label} file changed during open`);
    }
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) offset += fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
    const after = fs.fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || (after.mode & 0o777) !== 0o600) {
      throw ledgerError("FINDINGS_STORAGE_TAMPERED", `Findings ${label} file changed during read`);
    }
    if (buffer.includes(0)) throw ledgerError("FINDINGS_STORAGE_TAMPERED", `Findings ${label} file contains NUL bytes`);
    return buffer;
  } catch (error) {
    if (error?.code === "ELOOP") throw ledgerError("FINDINGS_STORAGE_UNSAFE", `Findings ${label} file is a symlink`, error);
    if (error?.code?.startsWith?.("FINDINGS_")) throw error;
    throw ledgerError("FINDINGS_STORAGE_UNREADABLE", `Findings ${label} file could not be read`, error);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* preserve the original error */ }
    }
  }
}

function normalizeProjectKey(projectKey) {
  if (typeof projectKey !== "string" || !projectKey || projectKey === "." || projectKey === ".." || !PROJECT_KEY_PATTERN.test(projectKey)) {
    throw ledgerError("FINDINGS_PROJECT_KEY_INVALID", "Project key is invalid");
  }
  return projectKey;
}

function stripRevision(finding) {
  const { revision: _revision, ...withoutRevision } = finding;
  return withoutRevision;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw ledgerError("FINDINGS_TIMESTAMP_INVALID", "Finding timestamp is invalid");
  return date.toISOString();
}

function lstatOrMissing(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw ledgerError("FINDINGS_STORAGE_UNAVAILABLE", "Findings storage could not be inspected", error);
  }
}

function ownedByCurrentUser(stat) {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateEnvelopeKeys(value, keys) {
  if (!isPlainObject(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw ledgerError("FINDINGS_STORAGE_TAMPERED", "Findings storage envelope fields are invalid");
  }
}

function ledgerError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}
