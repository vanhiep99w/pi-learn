import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveProject } from "../src/project/resolve-project.js";
import {
  analysisRunConsumerReceiptPath,
  analysisRunContextPath,
  consumeAnalysisRun,
  createAnalysisRun,
  fingerprintSessionPopulation,
} from "../src/analysis/analysis-run.js";

test("analysis run freezes one bounded population and writes metadata-only private context", () => {
  const fixture = createFixture();
  writeSession(path.join(fixture.sessionDir, "selected.jsonl"), {
    id: "selected",
    cwd: fixture.project,
    timestamp: "2026-08-03T01:00:00.000Z",
    content: "PRIVATE_PROMPT_MUST_NOT_ENTER_CONTEXT",
  });
  writeSession(path.join(fixture.sessionDir, "after-until.jsonl"), {
    id: "future",
    cwd: fixture.project,
    timestamp: "2026-08-05T01:00:00.000Z",
  });
  const project = resolveProject(fixture.project);
  const config = baseConfig(fixture, 5);

  const run = createAnalysisRun({
    config,
    project,
    now: new Date("2026-08-04T00:00:00.000Z"),
    runId: "run-freeze",
  });

  assert.equal(run.schemaVersion, 1);
  assert.equal(run.kind, "pi-harness.analysis-run");
  assert.match(run.runId, /^run-/);
  assert.equal(run.provider, "pi");
  assert.equal(run.window.until, "2026-08-04T00:00:00.000Z");
  assert.equal(run.selection.strategy, "latest-n");
  assert.equal(run.selection.limit, 5);
  assert.equal(run.selection.eligibleCount, 1);
  assert.equal(run.selection.selectedCount, 1);
  assert.equal(run.sessions[0].sessionId, "selected");
  assert.deepEqual(run.workspaceTarget, {
    kind: "repo-root",
    route: ".",
    packageRoute: null,
    ownerRoute: ".",
  });
  assert.equal(run.authority.discoveryPasses, 1);
  assert.equal(run.authority.mutationPolicy, "explicit_partial");
  assert.equal(run.authority.rawSessionContent, false);
  assert.equal(run.authority.userHomeAssets, false);
  assert.equal(run.authority.normalizedLookup, "single-exact-ref");
  assert.equal(run.laneStatus.discovery, "complete");
  assert.doesNotThrow(() => JSON.stringify(run));

  const contextPath = analysisRunContextPath({ config, project, runId: run.runId });
  assert.equal(
    contextPath,
    path.join(fixture.harnessHome, "projects", project.projectKey, "analysis-runs", "run-freeze", "context.json"),
  );
  const contextText = fs.readFileSync(contextPath, "utf8");
  const context = JSON.parse(contextText);
  assert.equal(context.kind, "pi-harness.analysis-run-context");
  assert.equal(context.contextFingerprint, run.contextFingerprint);
  assert.equal(context.selection.selectedFingerprint, run.selection.selectedFingerprint);
  assert.equal(context.population.selected[0].privateStableRef, "selected.jsonl");
  assert.equal(Object.hasOwn(context, "consumers"), false);
  assert.doesNotMatch(contextText, /PRIVATE_PROMPT_MUST_NOT_ENTER_CONTEXT/);
});

test("analysis run canonicalizes offset and invalid header timestamps", async () => {
  const offsetFixture = createFixture();
  const offsetFile = path.join(offsetFixture.sessionDir, "offset.jsonl");
  writeSession(offsetFile, {
    id: "offset",
    cwd: offsetFixture.project,
    timestamp: "2026-08-03T08:00:00+07:00",
  });
  const offsetProject = resolveProject(offsetFixture.project);
  const offsetConfig = baseConfig(offsetFixture, 5);
  const offsetRun = createAnalysisRun({
    config: offsetConfig,
    project: offsetProject,
    now: new Date("2026-08-04T00:00:00.000Z"),
    runId: "run-offset-timestamp",
  });
  const offsetConsumed = await consumeAnalysisRun({ analysisRun: offsetRun, config: offsetConfig, project: offsetProject, consumer: "report" });
  const offsetContext = JSON.parse(fs.readFileSync(analysisRunContextPath({ config: offsetConfig, project: offsetProject, runId: offsetRun.runId }), "utf8"));
  assert.equal(offsetRun.sessions[0].timestamp, "2026-08-03T01:00:00.000Z");
  assert.equal(offsetContext.population.selected[0].headerTimestamp, "2026-08-03T01:00:00.000Z");
  assert.equal(offsetConsumed.results[0].manifest.startedAt, "2026-08-03T01:00:00.000Z");
  assert.equal(offsetConsumed.results[0].sourceFingerprint, offsetContext.population.selected[0].fingerprint);
  assert.equal(offsetConsumed.analysisRun.laneStatus.consumer, "complete");

  const invalidFixture = createFixture();
  const invalidFile = path.join(invalidFixture.sessionDir, "invalid.jsonl");
  writeSession(invalidFile, {
    id: "invalid",
    cwd: invalidFixture.project,
    timestamp: "not-a-timestamp",
  });
  const fallbackMtime = new Date("2026-08-03T02:00:00.000Z");
  fs.utimesSync(invalidFile, fallbackMtime, fallbackMtime);
  const invalidProject = resolveProject(invalidFixture.project);
  const invalidConfig = baseConfig(invalidFixture, 5);
  const invalidRun = createAnalysisRun({
    config: invalidConfig,
    project: invalidProject,
    now: new Date("2026-08-04T00:00:00.000Z"),
    runId: "run-invalid-timestamp",
  });
  const invalidConsumed = await consumeAnalysisRun({ analysisRun: invalidRun, config: invalidConfig, project: invalidProject, consumer: "report" });
  const invalidContext = JSON.parse(fs.readFileSync(analysisRunContextPath({ config: invalidConfig, project: invalidProject, runId: invalidRun.runId }), "utf8"));
  assert.equal(invalidRun.selection.selectedCount, 1);
  assert.equal(invalidRun.sessions[0].timestamp, null);
  assert.equal(invalidContext.population.selected[0].headerTimestamp, null);
  assert.equal(invalidConsumed.results[0].manifest.startedAt, null);
  assert.equal(invalidConsumed.analysisRun.laneStatus.consumer, "complete");
});

test("analysis run normalizes fractional selection limits and rejects invalid limits before context write", () => {
  const fixture = createFixture();
  writeSession(path.join(fixture.sessionDir, "new.jsonl"), {
    id: "new",
    cwd: fixture.project,
    timestamp: "2026-08-03T02:00:00.000Z",
  });
  writeSession(path.join(fixture.sessionDir, "old.jsonl"), {
    id: "old",
    cwd: fixture.project,
    timestamp: "2026-08-03T01:00:00.000Z",
  });
  const project = resolveProject(fixture.project);
  const fractional = createAnalysisRun({
    config: baseConfig(fixture, 1.9),
    project,
    now: new Date("2026-08-04T00:00:00.000Z"),
    runId: "run-fractional-limit",
  });
  assert.equal(fractional.selection.limit, 1);
  assert.equal(fractional.selection.maxSessions, 1);
  assert.equal(fractional.selection.selectedCount, 1);
  assert.equal(fractional.sessions[0].sessionId, "new");

  for (const [label, value] of [["infinite", Infinity], ["negative", -1]]) {
    const runId = `run-${label}-limit`;
    assert.throws(
      () => createAnalysisRun({
        config: baseConfig(fixture, value),
        project,
        now: new Date("2026-08-04T00:00:00.000Z"),
        runId,
      }),
      (error) => error.code === "INVALID_MAX_SESSIONS_PER_SCAN"
        && /finite non-negative/.test(error.message),
    );
    assert.equal(fs.existsSync(analysisRunContextPath({ config: baseConfig(fixture, value), project, runId })), false);
  }
});

test("workspace target uses standalone routing outside git", () => {
  const fixture = createFixture({ git: false });
  writeSession(path.join(fixture.sessionDir, "standalone.jsonl"), {
    id: "standalone",
    cwd: fixture.project,
    timestamp: "2026-08-03T01:00:00.000Z",
  });
  const project = resolveProject(fixture.project);
  const run = createAnalysisRun({
    config: baseConfig(fixture, 1),
    project,
    now: new Date("2026-08-04T00:00:00.000Z"),
    runId: "run-standalone",
  });
  assert.deepEqual(run.workspaceTarget, {
    kind: "standalone",
    route: ".",
    packageRoute: null,
    ownerRoute: ".",
  });
});

test("tampered private context fails closed before consumption", async () => {
  const fixture = createFixture();
  const sessionFile = path.join(fixture.sessionDir, "selected.jsonl");
  writeSession(sessionFile, {
    id: "selected",
    cwd: fixture.project,
    timestamp: "2026-08-03T01:00:00.000Z",
  });
  const project = resolveProject(fixture.project);
  const config = baseConfig(fixture, 5);
  const run = createAnalysisRun({
    config,
    project,
    now: new Date("2026-08-04T00:00:00.000Z"),
    runId: "run-tampered",
  });
  const contextPath = analysisRunContextPath({ config, project, runId: run.runId });
  const context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  context.population.selected[0].size += 1;
  fs.writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`);

  await assert.rejects(
    consumeAnalysisRun({ analysisRun: run, config, project, consumer: "report" }),
    (error) => error.code === "ANALYSIS_RUN_CONTEXT_INTEGRITY"
      && /context integrity check failed/.test(error.message),
  );
  assert.equal(fs.existsSync(analysisRunConsumerReceiptPath({ config, project, runId: run.runId, consumer: "report" })), false);
});

test("population fingerprints are deterministic regardless traversal order", () => {
  const fixture = createFixture();
  const project = resolveProject(fixture.project);
  const config = baseConfig(fixture, 2);
  const sessions = [
    sessionMetadata(fixture, "b", "b.jsonl", "2026-08-03T01:00:00.000Z", 20, 200),
    sessionMetadata(fixture, "a", "a.jsonl", "2026-08-03T01:00:00.000Z", 10, 100),
  ];

  const first = fingerprintSessionPopulation({ sessions, config, project });
  const reversed = fingerprintSessionPopulation({ sessions: [...sessions].reverse(), config, project });

  assert.equal(first, reversed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("zero eligible sessions is observed empty and malformed headers remain warnings", async () => {
  const fixture = createFixture();
  fs.writeFileSync(path.join(fixture.sessionDir, "bad.jsonl"), "{bad json\n");
  const project = resolveProject(fixture.project);
  const config = baseConfig(fixture, 5);

  const run = createAnalysisRun({
    config,
    project,
    now: new Date("2026-08-04T00:00:00.000Z"),
    runId: "run-empty",
  });
  const consumed = await consumeAnalysisRun({ analysisRun: run, config, project, consumer: "report" });

  assert.equal(run.selection.eligibleCount, 0);
  assert.equal(run.selection.selectedCount, 0);
  assert.equal(run.laneStatus.discovery, "observed_empty");
  assert.equal(run.warnings.some((warning) => warning.code === "malformed_header_json"), true);
  assert.equal(consumed.analysisRun.laneStatus.consumer, "observed_empty");
  assert.equal(consumed.results.length, 0);
  assert.doesNotThrow(() => JSON.stringify(consumed.analysisRun));
});

test("mutated selected session is explicitly skipped without rediscovery", async () => {
  const fixture = createFixture();
  const sessionFile = path.join(fixture.sessionDir, "active.jsonl");
  writeSession(sessionFile, {
    id: "active",
    cwd: fixture.project,
    timestamp: "2026-08-03T01:00:00.000Z",
  });
  const project = resolveProject(fixture.project);
  const config = baseConfig(fixture, 5);
  const run = createAnalysisRun({
    config,
    project,
    now: new Date("2026-08-04T00:00:00.000Z"),
    runId: "run-mutation",
  });
  const frozenFingerprint = run.selection.selectedFingerprint;
  const contextPath = analysisRunContextPath({ config, project, runId: run.runId });
  const contextBefore = fs.readFileSync(contextPath, "utf8");

  fs.appendFileSync(sessionFile, `${JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-08-03T01:01:00.000Z", message: { role: "assistant", content: "changed" } })}\n`);
  const consumed = await consumeAnalysisRun({ analysisRun: run, config, project, consumer: "report" });

  assert.equal(consumed.results.length, 0);
  assert.equal(consumed.analysisRun.selection.selectedFingerprint, frozenFingerprint);
  assert.equal(consumed.analysisRun.laneStatus.consumer, "partial");
  assert.equal(consumed.analysisRun.consumption.skippedCount, 1);
  assert.equal(consumed.analysisRun.consumption.sessions[0].reason, "selected_session_mutated");
  assert.equal(consumed.warnings[0].code, "selected_session_mutated");
  assert.equal(fs.readFileSync(contextPath, "utf8"), contextBefore);
  assert.equal(fs.existsSync(analysisRunConsumerReceiptPath({ config, project, runId: run.runId, consumer: "report" })), true);
});

function createFixture({ git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-analysis-run-"));
  const project = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  const harnessHome = path.join(root, "harness-home");
  fs.mkdirSync(project, { recursive: true });
  if (git) fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  return { root, project, sessionDir, harnessHome };
}

function baseConfig(fixture, maxSessionsPerScan) {
  return {
    sessionDir: fixture.sessionDir,
    harnessHome: fixture.harnessHome,
    maxSessionsPerScan,
    redact: true,
    logging: { enabled: false },
  };
}

function writeSession(file, { id, cwd, timestamp, content = "hi" }) {
  const lines = [
    { type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp },
    { type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content } },
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

function sessionMetadata(fixture, sessionId, fileName, timestamp, size, mtimeMs) {
  return {
    sessionId,
    sessionFile: path.join(fixture.sessionDir, fileName),
    cwd: fs.realpathSync(fixture.project),
    projectRoot: fs.realpathSync(fixture.project),
    projectKey: resolveProject(fixture.project).projectKey,
    timestamp,
    headerTimestampMs: Date.parse(timestamp),
    size,
    mtimeMs,
  };
}
