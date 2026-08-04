import fs from "node:fs";
import path from "node:path";
import { resolveProject } from "../project/resolve-project.js";

export function discoverSessions(config, project, options = {}) {
  const sessionDir = config.sessionDir;
  const maxSessions = options.maxSessions ?? config.maxSessionsPerScan ?? 50;
  const until = normalizeUntil(options.until);
  const warnings = [];

  if (!fs.existsSync(sessionDir)) {
    return {
      sessions: [],
      eligibleSessions: [],
      eligibleCount: 0,
      warnings: [warning("session_dir_missing", `Session directory does not exist: ${sessionDir}`)],
      scannedFiles: 0,
      until: until.iso,
    };
  }

  const files = listJsonlFiles(sessionDir, warnings);
  const eligibleSessions = [];

  for (const file of files) {
    const parsed = readSessionHeader(file);
    if (parsed.warning) warnings.push(parsed.warning);
    if (!parsed.header) continue;

    const session = sessionInfoFromHeader(file, parsed.header, warnings);
    if (!session) continue;

    if (project && !sessionMatchesProject(session, project)) continue;
    const sessionTime = session.headerTimestampMs ?? session.mtimeMs ?? 0;
    if (sessionTime > until.ms) continue;
    eligibleSessions.push(session);
  }

  eligibleSessions.sort(compareSessions);

  return {
    sessions: eligibleSessions.slice(0, maxSessions),
    eligibleSessions,
    eligibleCount: eligibleSessions.length,
    warnings,
    scannedFiles: files.length,
    until: until.iso,
  };
}

export function listJsonlFiles(rootDir, warnings = []) {
  const results = [];
  walk(rootDir);
  return results;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      warnings.push(warning("read_dir_failed", `Cannot read directory ${dir}: ${error.message}`));
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isSymbolicLink() && entry.name.endsWith(".jsonl")) {
        warnings.push(warning("symlink_skipped", `Skipping session symlink for safety: ${fullPath}`, fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }
}

export function readSessionHeader(sessionFile) {
  let firstLineResult;
  try {
    firstLineResult = readFirstLine(sessionFile);
  } catch (error) {
    return {
      header: undefined,
      warning: warning("read_file_failed", `Cannot read session file ${sessionFile}: ${error.message}`, sessionFile),
    };
  }

  if (firstLineResult.truncated) {
    return {
      header: undefined,
      warning: warning("header_too_long", `Session header exceeds ${firstLineResult.maxBytes} bytes: ${sessionFile}`, sessionFile),
    };
  }

  const firstLine = firstLineResult.line;

  if (!firstLine) {
    return {
      header: undefined,
      warning: warning("empty_file", `Session file is empty: ${sessionFile}`, sessionFile),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(firstLine);
  } catch (error) {
    return {
      header: undefined,
      warning: warning("malformed_header_json", `Malformed session header in ${sessionFile}: ${error.message}`, sessionFile),
    };
  }

  if (parsed?.type !== "session") {
    return {
      header: undefined,
      warning: warning("missing_session_header", `First JSONL entry is not a session header: ${sessionFile}`, sessionFile),
    };
  }

  return { header: parsed };
}

export function readFirstLine(filePath, maxBytes = 64 * 1024) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const newlineIndex = text.indexOf("\n");
    return {
      line: newlineIndex >= 0 ? text.slice(0, newlineIndex) : text,
      truncated: bytesRead === maxBytes && newlineIndex < 0,
      maxBytes,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function sessionInfoFromHeader(sessionFile, header, warnings) {
  let stat;
  try {
    stat = fs.statSync(sessionFile);
  } catch (error) {
    warnings.push(warning("stat_failed", `Cannot stat session file ${sessionFile}: ${error.message}`, sessionFile));
    return undefined;
  }

  const cwd = header.cwd;
  let project;
  try {
    project = cwd ? resolveProject(cwd) : undefined;
  } catch (error) {
    warnings.push(warning("resolve_project_failed", `Cannot resolve cwd for ${sessionFile}: ${error.message}`, sessionFile));
  }

  const timestamp = canonicalSessionTimestamp(header.timestamp);
  const headerTimestampMs = timestamp ? Date.parse(timestamp) : undefined;

  return {
    sessionId: header.id,
    sessionFile,
    cwd,
    gitRoot: project?.gitRoot,
    projectRoot: project?.projectRoot ?? cwd,
    projectKey: project?.projectKey,
    piSessionVersion: header.version ?? 1,
    timestamp,
    headerTimestampMs,
    parentSession: header.parentSession,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    mtime: stat.mtime.toISOString(),
  };
}

function sessionMatchesProject(session, project) {
  if (!session.cwd) return false;
  if (session.projectRoot && path.resolve(session.projectRoot) === path.resolve(project.projectRoot)) return true;
  if (session.gitRoot && project.gitRoot && path.resolve(session.gitRoot) === path.resolve(project.gitRoot)) return true;
  return path.resolve(session.cwd).startsWith(`${path.resolve(project.projectRoot)}${path.sep}`)
    || path.resolve(session.cwd) === path.resolve(project.projectRoot);
}

export function canonicalSessionTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function compareSessions(a, b) {
  const aTime = a.headerTimestampMs ?? a.mtimeMs ?? 0;
  const bTime = b.headerTimestampMs ?? b.mtimeMs ?? 0;
  return bTime - aTime
    || compareText(a.sessionId, b.sessionId)
    || compareText(a.sessionFile, b.sessionFile);
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeUntil(value) {
  if (value === undefined) {
    const now = new Date();
    return { ms: now.getTime(), iso: now.toISOString() };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid session discovery until value: ${value}`);
  return { ms: date.getTime(), iso: date.toISOString() };
}

function warning(code, message, sessionFile) {
  return {
    schemaVersion: 1,
    code,
    message,
    sessionFile,
    timestamp: new Date().toISOString(),
  };
}
