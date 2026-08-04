import path from "node:path";
import { parseSessionFile } from "../session/parse-session.js";
import { canonicalSessionTimestamp } from "../session/discover-sessions.js";
import { buildSessionTree } from "../session/tree.js";
import { normalizeSessionEvents } from "../normalize/events.js";
import { computeSessionMetrics } from "../metrics/session-metrics.js";
import { collectNormalizeWarnings, enrichWarnings } from "../session/warnings.js";
import { atomicWriteJson, atomicWriteJsonl, ensureDir } from "./atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "./harness-home.js";

export async function writeSessionCache({ sessionFile, config, project, logger, expectedSnapshot }) {
  logger?.info("parse_start", "Parsing session JSONL", {
    component: "parser",
    projectKey: project.projectKey,
    sessionFile,
  });

  const parsed = await parseSessionFile(sessionFile);
  validateExpectedSnapshot(parsed, expectedSnapshot);
  const tree = buildSessionTree(parsed.entries, sessionFile);
  const warnings = enrichWarnings([
    ...parsed.warnings,
    ...tree.warnings,
    ...collectNormalizeWarnings(parsed),
  ], { parsed, project });

  logger?.info("parse_end", "Parsed session JSONL", {
    component: "parser",
    projectKey: project.projectKey,
    sessionId: parsed.header?.id,
    sessionFile,
    data: {
      entries: parsed.entries.length,
      warnings: warnings.length,
      activePathCount: tree.activePathEntryIds.length,
      branchCount: tree.branchCount,
    },
  });

  for (const warning of warnings) {
    logger?.warn("parse_warning", warning.message, {
      component: "parser",
      projectKey: project.projectKey,
      sessionId: parsed.header?.id,
      sessionFile,
      entryId: warning.entryId,
      data: { code: warning.code, lineNumber: warning.lineNumber },
    });
  }

  logger?.info("normalize_start", "Normalizing session events", {
    component: "normalizer",
    projectKey: project.projectKey,
    sessionId: parsed.header?.id,
    sessionFile,
  });

  const events = normalizeSessionEvents({ parsed, tree, project });
  const metrics = computeSessionMetrics({ projectKey: project.projectKey, sessionId: parsed.header?.id, events, tree });
  const manifest = createManifest({ parsed, tree, warnings, config, project });

  logger?.info("normalize_end", "Normalized session events", {
    component: "normalizer",
    projectKey: project.projectKey,
    sessionId: parsed.header?.id,
    sessionFile,
    data: { eventCount: events.length, redactedEvents: metrics.safety.redactedEvents },
  });

  const outDir = sessionCacheDir(config, project.projectKey, parsed.header?.id, sessionFile);
  ensureDir(outDir);

  const paths = {
    manifest: path.join(outDir, "manifest.json"),
    events: path.join(outDir, "events.jsonl"),
    metrics: path.join(outDir, "metrics.json"),
    warnings: path.join(outDir, "warnings.jsonl"),
  };

  logger?.info("cache_write_start", "Writing normalized session cache", {
    component: "cache",
    projectKey: project.projectKey,
    sessionId: parsed.header?.id,
    sessionFile,
    data: { outDir },
  });

  atomicWriteJson(paths.manifest, manifest);
  atomicWriteJsonl(paths.events, events);
  atomicWriteJson(paths.metrics, metrics);
  atomicWriteJsonl(paths.warnings, warnings);

  logger?.info("cache_write_end", "Wrote normalized session cache", {
    component: "cache",
    projectKey: project.projectKey,
    sessionId: parsed.header?.id,
    sessionFile,
    data: { outDir, eventCount: events.length, warningCount: warnings.length },
  });

  return {
    sessionId: parsed.header?.id,
    sessionFile,
    outDir,
    paths,
    manifest,
    metrics,
    warnings,
    eventCount: events.length,
  };
}

function validateExpectedSnapshot(parsed, expectedSnapshot) {
  if (!expectedSnapshot) return;
  const matches = path.resolve(parsed.sessionFile) === path.resolve(expectedSnapshot.sessionFile)
    && (parsed.header?.id ?? null) === (expectedSnapshot.sessionId ?? null)
    && canonicalSessionTimestamp(parsed.header?.timestamp) === expectedSnapshot.headerTimestamp
    && parsed.stats.size === expectedSnapshot.size
    && parsed.stats.mtimeMs === expectedSnapshot.mtimeMs;
  if (matches) return;

  const error = new Error("Frozen session snapshot mismatch during cache build");
  error.name = "FrozenSessionMismatchError";
  error.code = "FROZEN_SESSION_MISMATCH";
  throw error;
}

function createManifest({ parsed, tree, warnings, config, project }) {
  return {
    schemaVersion: 1,
    projectKey: project.projectKey,
    sessionId: parsed.header?.id,
    sessionFile: parsed.sessionFile,
    cwd: parsed.header?.cwd,
    gitRoot: project.gitRoot,
    piSessionVersion: parsed.header?.version ?? 1,
    parsedAt: new Date().toISOString(),
    startedAt: canonicalSessionTimestamp(parsed.header?.timestamp),
    lastEntryAt: parsed.entries.at(-1)?.timestamp,
    rawSize: parsed.stats.size,
    rawMtimeMs: parsed.stats.mtimeMs,
    entryCount: parsed.entries.length,
    activeLeafId: tree.activeLeafId,
    activePathEntryIds: tree.activePathEntryIds,
    activePathCount: tree.activePathEntryIds.length,
    branchCount: tree.branchCount,
    redactionEnabled: true,
    warningsCount: warnings.length,
  };
}

function sessionCacheDir(config, projectKey, sessionId, sessionFile) {
  const harnessHome = resolveHarnessHome(config);
  const safeSessionId = sanitizePathPart(sessionId ?? path.basename(sessionFile, ".jsonl"));
  return path.join(projectCacheDir(harnessHome, projectKey), "sessions", safeSessionId);
}

function sanitizePathPart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 160) || "unknown-session";
}
