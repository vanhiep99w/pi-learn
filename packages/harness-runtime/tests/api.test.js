import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  VERSION,
  analysisRun,
  projectResolve,
  sessions,
  scan,
  taskEpisodes,
  report,
  reflect,
  importReflection,
  importReflectionResponse,
  propose,
  proposals,
  showProposal,
  approve,
  reject,
  history,
  evalHarness,
  automationStatus,
  automate,
  inspect,
} from "../src/api.js";
import { analysisRunConsumerReceiptPath, analysisRunContextPath } from "../src/analysis/analysis-run.js";
import { candidateReviewReceiptPath } from "../src/storage/candidate-review-writer.js";
import { taskEpisodeArtifactPaths } from "../src/storage/task-episodes-writer.js";

const packageCwd = path.resolve(new URL("..", import.meta.url).pathname);

test("api exposes package version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(packageCwd, "package.json"), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("api projectResolve emits project shape and logs lifecycle", () => {
  const fixture = createFixture();
  const output = projectResolve(baseOptions(fixture));

  assert.equal(output.projectRoot, fs.realpathSync(fixture.project));
  assert.match(output.projectKey, /^project-[a-f0-9]{6}$/);
  assertEventSequenceIncludes(readRuntimeLogEvents(fixture.harnessHome), ["command_start", "config_loaded", "project_resolved", "command_end"]);
});

test("api sessions lists project sessions", () => {
  const fixture = createFixture();
  writeSession(path.join(fixture.sessionDir, "session.jsonl"), { id: "s1", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });

  const output = sessions(baseOptions(fixture));

  assert.equal(output.count, 1);
  assert.equal(output.sessions[0].sessionId, "s1");
});

test("api sessions and analysisRun reject forged or stale supplied runs", () => {
  const fixture = createFixture();
  const options = baseOptions(fixture);
  writeSession(path.join(fixture.sessionDir, "session.jsonl"), { id: "s1", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const run = analysisRun(options);
  const forged = { ...run, sessions: [] };

  assert.throws(
    () => sessions({ ...options, analysisRun: forged }),
    (error) => error.code === "ANALYSIS_RUN_CONTEXT_INTEGRITY"
      && error.reason === "public_session_count",
  );

  const project = projectResolve(options);
  fs.unlinkSync(analysisRunContextPath({ config: options, project, runId: run.runId }));
  assert.throws(
    () => analysisRun({ ...options, analysisRun: run }),
    (error) => error.code === "ANALYSIS_RUN_CONTEXT_INTEGRITY"
      && error.reason === "context_unreadable",
  );
});

test("api scan writes cache files", async () => {
  const fixture = createFixture();
  writeSession(path.join(fixture.sessionDir, "session.jsonl"), { id: "s1", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });

  const output = await scan(baseOptions(fixture));

  assert.equal(output.count, 1);
  assert.equal(fs.existsSync(path.join(output.results[0].outDir, "manifest.json")), true);
  assert.equal(fs.existsSync(path.join(output.results[0].outDir, "events.jsonl")), true);
});

test("api taskEpisodes consumes an independent frozen lane and returns only the bound reader projection", async () => {
  const fixture = createFixture();
  const options = baseOptions(fixture);
  writeEpisodeSession(path.join(fixture.sessionDir, "episode.jsonl"), {
    id: "private-session-id",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });
  const run = analysisRun(options);
  const project = projectResolve(options);
  const contextPath = analysisRunContextPath({ config: options, project, runId: run.runId });
  const contextBefore = fs.readFileSync(contextPath, "utf8");

  const output = await taskEpisodes({ ...options, analysisRun: run });
  const replay = await taskEpisodes({ ...options, analysisRun: run });
  const paths = taskEpisodeArtifactPaths({ config: options, project, runId: run.runId });
  const receiptPath = analysisRunConsumerReceiptPath({ config: options, project, runId: run.runId, consumer: "task-episodes" });

  assert.equal(output.kind, "pi-harness.task-episode-candidate-reader");
  assert.equal(output.policy, "task-episode-candidate-v1");
  assert.equal(output.status, "complete");
  assert.equal(output.runBinding.runId, run.runId);
  assert.equal(output.runBinding.selectedCount, 1);
  assert.equal(output.counts.candidates, 1);
  assert.equal(output.counts.retained, 1);
  assert.equal(output.episodes[0].closure.status, "closed");
  assert.equal(output.episodes[0].closure.deliveryStatus, "unobserved");
  assert.deepEqual(replay, output);
  assert.equal(fs.statSync(paths.privatePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.readerPath).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(receiptPath, "utf8")).consumer, "task-episodes");
  assert.equal(fs.readFileSync(contextPath, "utf8"), contextBefore);
  const outputText = JSON.stringify(output);
  assert.doesNotMatch(outputText, /private-session-id|SECRET_MARK_REASON|sourceFingerprint|commandFingerprint|eventId|entryId|sessionId/);
  assert.equal(Object.hasOwn(output, "privateArtifact"), false);
  assert.equal(Object.hasOwn(output, "paths"), false);
});

test("api taskEpisodes preserves malformed raw evidence as partial and keeps genuine empty evidence honest", async () => {
  const malformedFixture = createFixture();
  const malformedPath = path.join(malformedFixture.sessionDir, "malformed.jsonl");
  fs.writeFileSync(malformedPath, [
    JSON.stringify({ type: "session", version: 3, id: "malformed", cwd: fs.realpathSync(malformedFixture.project), timestamp: "2026-06-14T01:00:00.000Z" }),
    JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-06-14T01:00:00.000Z", message: { role: "user", content: "synthetic" } }),
    "{malformed-json",
    JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-06-14T01:00:00.000Z", message: { role: "assistant", content: "work" } }),
  ].join("\n") + "\n");
  const malformed = await taskEpisodes(baseOptions(malformedFixture));
  assert.equal(malformed.status, "partial");
  assert.equal(malformed.counts.selectedSessions, 1);
  assert.equal(malformed.counts.acceptedSessions, 1);
  assert.equal(malformed.counts.candidates, 0);
  assert.equal(malformed.episodes.length, 0);

  const emptyFixture = createFixture();
  fs.writeFileSync(path.join(emptyFixture.sessionDir, "empty.jsonl"), `${JSON.stringify({
    type: "session",
    version: 3,
    id: "empty",
    cwd: fs.realpathSync(emptyFixture.project),
    timestamp: "2026-06-14T01:00:00.000Z",
  })}\n`);
  const empty = await taskEpisodes(baseOptions(emptyFixture));
  assert.equal(empty.status, "complete");
  assert.equal(empty.counts.selectedSessions, 1);
  assert.equal(empty.counts.acceptedSessions, 1);
  assert.equal(empty.counts.candidates, 0);
  assert.deepEqual(empty.episodes, []);
});

test("api report writes latest Markdown report", async () => {
  const fixture = createFixture();
  writeSession(path.join(fixture.sessionDir, "session.jsonl"), { id: "s1", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });

  const output = await report(baseOptions(fixture));

  assert.equal(output.count, 1);
  assert.equal(fs.existsSync(output.report.latestPath), true);
  const markdown = fs.readFileSync(output.report.latestPath, "utf8");
  assert.match(markdown, /# Pi Harness Report/);
  assert.match(markdown, new RegExp(output.analysisRun.runId));
  assert.match(markdown, new RegExp(output.analysisRun.selection.selectedFingerprint));
  assert.match(markdown, /Frozen scope: selected 1, accepted 1, skipped 0/);
  assert.equal(output.sessions[0].sessionId, "s1");
  assert.equal(output.analysisRun.selection.selectedFingerprint.length, 64);
  assert.doesNotThrow(() => JSON.stringify(output));
});

test("api report and reflect consume the same supplied frozen run", async () => {
  const fixture = createFixture();
  writeErrorSession(path.join(fixture.sessionDir, "shared.jsonl"), { id: "s-shared", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const options = baseOptions(fixture);
  const run = analysisRun(options);
  const project = projectResolve(options);
  const contextPath = analysisRunContextPath({ config: options, project, runId: run.runId });
  const contextBefore = fs.readFileSync(contextPath, "utf8");

  const [reportOutput, reflectOutput] = await Promise.all([
    report({ ...options, analysisRun: run }),
    reflect({ ...options, analysisRun: run }),
  ]);

  assert.equal(reportOutput.analysisRun.runId, run.runId);
  assert.equal(reflectOutput.analysisRun.runId, run.runId);
  assert.equal(reportOutput.analysisRun.selection.selectedFingerprint, run.selection.selectedFingerprint);
  assert.equal(reflectOutput.analysisRun.selection.selectedFingerprint, run.selection.selectedFingerprint);
  assert.equal(reportOutput.analysisRun.laneStatus.consumer, "complete");
  assert.equal(reflectOutput.analysisRun.laneStatus.consumer, "complete");
  assert.equal(fs.readFileSync(contextPath, "utf8"), contextBefore);
  const reportReceiptPath = analysisRunConsumerReceiptPath({ config: options, project, runId: run.runId, consumer: "report" });
  const reflectReceiptPath = analysisRunConsumerReceiptPath({ config: options, project, runId: run.runId, consumer: "reflect" });
  assert.equal(fs.existsSync(reportReceiptPath), true);
  assert.equal(fs.existsSync(reflectReceiptPath), true);
  assert.equal(JSON.parse(fs.readFileSync(reportReceiptPath, "utf8")).selectedFingerprint, run.selection.selectedFingerprint);
  assert.equal(JSON.parse(fs.readFileSync(reflectReceiptPath, "utf8")).selectedFingerprint, run.selection.selectedFingerprint);
  assert.doesNotThrow(() => JSON.stringify({ reportOutput, reflectOutput }));
});

test("partial and observed-empty scope are explicit in report and reflection artifacts", async () => {
  const partialFixture = createFixture();
  const partialOptions = baseOptions(partialFixture);
  const sessionFile = path.join(partialFixture.sessionDir, "active.jsonl");
  writeSession(sessionFile, { id: "active", cwd: partialFixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const partialRun = analysisRun(partialOptions);
  fs.appendFileSync(sessionFile, `${JSON.stringify({ type: "message", id: "late", parentId: "m1", timestamp: "2026-06-14T01:01:00.000Z", message: { role: "assistant", content: "late" } })}\n`);

  const partialReport = await report({ ...partialOptions, analysisRun: partialRun });
  const partialReflection = await reflect({ ...partialOptions, analysisRun: partialRun });
  assert.match(fs.readFileSync(partialReport.report.latestPath, "utf8"), /Scope warning: PARTIAL/);
  assert.match(fs.readFileSync(partialReflection.reflection.latestPath, "utf8"), /WARNING: PARTIAL frozen scope/);
  assert.match(fs.readFileSync(partialReflection.reflection.latestPath, "utf8"), /"selectedCount": 1/);
  assert.match(fs.readFileSync(partialReflection.reflection.latestPath, "utf8"), /"acceptedCount": 0/);

  const emptyFixture = createFixture();
  const emptyOptions = baseOptions(emptyFixture);
  const emptyRun = analysisRun(emptyOptions);
  const emptyReport = await report({ ...emptyOptions, analysisRun: emptyRun });
  const emptyReflection = await reflect({ ...emptyOptions, analysisRun: emptyRun });
  assert.match(fs.readFileSync(emptyReport.report.latestPath, "utf8"), /Scope observation: OBSERVED EMPTY/);
  assert.match(fs.readFileSync(emptyReflection.reflection.latestPath, "utf8"), /OBSERVED EMPTY: the frozen run selected zero eligible sessions/);
});

test("api reflect writes redacted LLM reflection prompt", async () => {
  const fixture = createFixture();
  writeErrorSession(path.join(fixture.sessionDir, "error-session.jsonl"), { id: "s-reflect", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });

  const output = await reflect(baseOptions(fixture));

  assert.equal(output.mode, "reflect");
  assert.equal(output.evidenceCount >= 1, true);
  assert.equal(fs.existsSync(output.reflection.latestPath), true);
  assert.match(fs.readFileSync(output.reflection.latestPath, "utf8"), /Return JSON only/);
});

test("api importReflectionResponse writes LLM draft proposals without temp file", () => {
  const fixture = createFixture();

  const output = importReflectionResponse({
    ...baseOptions(fixture),
    response: JSON.stringify({ proposals: [reflectionProposal()] }),
  });

  assert.equal(output.mode, "reflect_import");
  assert.equal(output.written.length, 1);
  assert.equal(output.written[0].ruleId, "LLM-REFLECT");
});

test("api importReflection writes LLM draft proposals", () => {
  const fixture = createFixture();
  const responsePath = path.join(fixture.root, "llm-response.json");
  fs.writeFileSync(responsePath, JSON.stringify({ proposals: [reflectionProposal()] }));

  const output = importReflection({ ...baseOptions(fixture), importFile: responsePath });

  assert.equal(output.mode, "reflect_import");
  assert.equal(output.written.length, 1);
  assert.equal(output.written[0].ruleId, "LLM-REFLECT");
});

test("api propose writes deterministic draft proposals and dedupes", async () => {
  const fixture = createFixture();
  writeErrorSession(path.join(fixture.sessionDir, "error-session.jsonl"), { id: "s-propose", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });

  const first = await propose({ ...baseOptions(fixture), rules: true });
  assert.equal(first.candidates, 1);
  assert.equal(first.promoted, 1);
  assert.equal(first.deferred, 0);
  assert.equal(first.rejected, 0);
  assert.equal(first.written.length, 1);
  assert.equal(first.candidateSignals[0].detectorId, "R-0002");
  assert.equal(first.decisions[0].candidateId, first.candidateSignals[0].id);
  assert.equal(first.written[0].candidateId, first.candidateSignals[0].id);

  const second = await propose({ ...baseOptions(fixture), rules: true });
  assert.equal(second.written.length, 0);
  assert.equal(second.skipped.length >= 1, true);

  const list = proposals(baseOptions(fixture));
  assert.equal(list.count >= 1, true);
  const shown = showProposal({ ...baseOptions(fixture), id: list.proposals[0].id });
  assert.match(fs.readFileSync(shown.filePath, "utf8"), /## Evidence/);
});

test("rules:true and target:rules share R1/R2 candidates and decisions", async () => {
  const fixture = createFixture();
  writeErrorSession(path.join(fixture.sessionDir, "error-session.jsonl"), { id: "s-shared-rules", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const options = baseOptions(fixture);
  const run = analysisRun(options);

  const allRules = await propose({ ...options, analysisRun: run, rules: true });
  const targeted = await propose({ ...options, analysisRun: run, target: "rules" });
  const repeated = await propose({ ...options, analysisRun: run, rules: true });

  assert.deepEqual(allRules.candidateSignals, targeted.candidateSignals);
  assert.deepEqual(allRules.decisions, targeted.decisions);
  assert.equal(allRules.written.length, 1);
  assert.equal(targeted.written.length, 0);
  assert.equal(targeted.skipped.length, 1);
  assert.equal(targeted.skipped[0].id, allRules.written[0].id);
  assert.equal(repeated.written.length, 0);
  assert.equal(repeated.skipped[0].id, allRules.written[0].id);
  const project = projectResolve(options);
  const receiptPath = candidateReviewReceiptPath({ config: options, project, runId: run.runId, mode: "target:rules", attemptId: targeted.reviewReceipt.attemptId });
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.deepEqual(receipt.reviews[0].proposal, {
    id: allRules.written[0].id,
    fingerprint: allRules.written[0].fingerprint,
    status: "draft",
    writeStatus: "skipped",
    reason: "duplicate_fingerprint",
  });
  const firstRulesReceipt = candidateReviewReceiptPath({ config: options, project, runId: run.runId, mode: "rules", attemptId: allRules.reviewReceipt.attemptId });
  const repeatedRulesReceipt = candidateReviewReceiptPath({ config: options, project, runId: run.runId, mode: "rules", attemptId: repeated.reviewReceipt.attemptId });
  assert.notEqual(firstRulesReceipt, repeatedRulesReceipt);
  assert.equal(JSON.parse(fs.readFileSync(firstRulesReceipt, "utf8")).reviews[0].proposal.writeStatus, "written");
  assert.equal(JSON.parse(fs.readFileSync(repeatedRulesReceipt, "utf8")).reviews[0].proposal.writeStatus, "skipped");
});

test("existing GLOBAL-EDIT-001 coverage defers before API proposal write and retains receipt", async () => {
  const fixture = createFixture();
  fs.mkdirSync(path.join(fixture.project, "wiki"), { recursive: true });
  fs.writeFileSync(path.join(fixture.project, "wiki", "_rules.md"), [
    "# Rules",
    "## GLOBAL-EDIT-001 — Inspect before exact-text edits",
    "Read the current target block before applying an exact-text edit.",
    "Confirm oldText exactly matches current whitespace and punctuation.",
    "Confirm the match is unique.",
  ].join("\n"));
  writeErrorSession(path.join(fixture.sessionDir, "error-session.jsonl"), { id: "s-covered", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const options = baseOptions(fixture);
  const run = analysisRun(options);
  const project = projectResolve(options);
  const contextPath = analysisRunContextPath({ config: options, project, runId: run.runId });
  const contextBefore = fs.readFileSync(contextPath, "utf8");

  const output = await propose({ ...options, analysisRun: run, rules: true });
  const receiptPath = candidateReviewReceiptPath({ config: options, project, runId: run.runId, mode: "rules", attemptId: output.reviewReceipt.attemptId });
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));

  assert.equal(output.candidates, 1);
  assert.equal(output.promoted, 0);
  assert.equal(output.deferred, 1);
  assert.equal(output.written.length, 0);
  assert.equal(output.decisions[0].reasonCode, "existing-coverage");
  assert.equal(output.decisions[0].observedUse, "unobserved");
  assert.equal(fs.readFileSync(contextPath, "utf8"), contextBefore);
  assert.equal(receipt.runId, run.runId);
  assert.equal(receipt.selectedFingerprint, run.selection.selectedFingerprint);
  assert.equal(receipt.attemptStatus, "complete");
  assert.equal(receipt.candidates[0].count, 2);
  assert.equal(receipt.candidates[0].evidenceRefs.length, 2);
  assert.match(receipt.candidates[0].evidenceRefs[0].sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(receipt.candidates[0].evidenceRefsTruncated, false);
  assert.equal(receipt.reviews[0].state, "deferred");
  assert.equal(receipt.reviews[0].proposal, undefined);
  assert.equal(JSON.stringify({ signals: output.candidateSignals, decisions: output.decisions, assets: output.agentAssets }).includes(fixture.root), false);
});

test("candidate receipt begin failure prevents proposal writing and preserves context", async () => {
  const fixture = createFixture();
  writeErrorSession(path.join(fixture.sessionDir, "error-session.jsonl"), { id: "s-begin-failure", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const options = baseOptions(fixture);
  const run = analysisRun(options);
  const project = projectResolve(options);
  const contextPath = analysisRunContextPath({ config: options, project, runId: run.runId });
  const contextBefore = fs.readFileSync(contextPath, "utf8");
  fs.writeFileSync(path.join(path.dirname(contextPath), "candidate-reviews"), "block directory creation");

  await assert.rejects(() => propose({ ...options, analysisRun: run, rules: true }));

  assert.equal(proposals(options).count, 0);
  assert.equal(fs.readFileSync(contextPath, "utf8"), contextBefore);
});

test("target parser promotes R4 through review while target redaction defers R3", async () => {
  const parserFixture = createFixture();
  for (const route of [
    "packages/harness-runtime/src/session/warnings.js",
    "packages/harness-runtime/src/normalize/events.js",
    "packages/harness-runtime/tests/parse-tree.test.js",
  ]) {
    const file = path.join(parserFixture.project, ...route.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "// owner\n");
  }
  writeUnknownEntrySession(path.join(parserFixture.sessionDir, "parser.jsonl"), { id: "s-parser-target", cwd: parserFixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const parser = await propose({ ...baseOptions(parserFixture), target: "parser" });
  assert.equal(parser.candidates, 1);
  assert.equal(parser.promoted, 1);
  assert.equal(parser.written[0].detectorId, "R-0004");

  const redactionFixture = createFixture();
  writeSensitiveSession(path.join(redactionFixture.sessionDir, "sensitive.jsonl"), { id: "s-redaction-target", cwd: redactionFixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const redaction = await propose({ ...baseOptions(redactionFixture), target: "redaction" });
  assert.equal(redaction.candidates, 1);
  assert.equal(redaction.promoted, 0);
  assert.equal(redaction.deferred, 1);
  assert.equal(redaction.decisions[0].reasonCode, "no-observed-consequence");
  assert.equal(redaction.written.length, 0);
});

test("api approve reject and history track proposal lifecycle", async () => {
  const fixture = createFixture();
  writeErrorSession(path.join(fixture.sessionDir, "error-session.jsonl"), { id: "s-lifecycle", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  const proposed = await propose({ ...baseOptions(fixture), rules: true });
  const id = proposed.written[0].id;

  assert.equal(approve({ ...baseOptions(fixture), id }).proposal.status, "approved");
  assert.equal(reject({ ...baseOptions(fixture), id }).proposal.status, "rejected");
  assert.deepEqual(history({ ...baseOptions(fixture), id }).history.map((event) => event.event), ["proposal_approved", "proposal_rejected"]);
});

test("api propose target memory writes memory draft and proposal", async () => {
  const fixture = createFixture();
  writeSession(path.join(fixture.sessionDir, "memory-session.jsonl"), {
    id: "s-memory",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
    userContent: "harness runtime nằm ở packages/harness-runtime còn pi-harness là docs spec",
  });

  const output = await propose({ ...baseOptions(fixture), target: "memory" });

  assert.equal(output.mode, "target:memory");
  assert.equal(output.memory.written.length >= 1, true);
  assert.equal(fs.existsSync(output.memory.draftPath), true);
});

test("api automation status is disabled by default", () => {
  const fixture = createFixture();
  const output = automationStatus(baseOptions(fixture));

  assert.equal(output.status.enabled, false);
  assert.equal(output.status.allowed, false);
  assert.equal(output.status.reason, "automation_disabled");
});

test("api automate runs only gated draft actions when enabled", async () => {
  const fixture = createFixture();
  writeSession(path.join(fixture.sessionDir, "session.jsonl"), { id: "s-auto", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z" });
  fs.mkdirSync(path.join(fixture.project, "harness"), { recursive: true });
  fs.writeFileSync(path.join(fixture.project, "harness", "config.json"), JSON.stringify({
    automation: {
      enabled: true,
      maxSessions: 1,
      scan: true,
      report: true,
      proposeRules: true,
      proposeTargets: [],
      eval: false,
      createEvalFixtureDraft: true,
    },
  }));

  const output = await automate(baseOptions(fixture));

  assert.equal(output.status, "done");
  assert.deepEqual(output.actions.map((action) => action.name), ["scan", "report", "propose:rules", "draft:eval-fixture"]);
  const sessionActions = output.actions.filter((action) => action.analysisRun);
  assert.equal(sessionActions.length, 3);
  assert.equal(new Set(sessionActions.map((action) => action.analysisRun.runId)).size, 1);
  assert.equal(new Set(sessionActions.map((action) => action.analysisRun.selectedFingerprint)).size, 1);
  assert.equal(sessionActions[0].analysisRun.runId, output.analysisRun.runId);
  assert.equal(sessionActions[0].analysisRun.selectedFingerprint, output.analysisRun.selectedFingerprint);
  const proposeAction = output.actions.find((action) => action.name === "propose:rules");
  assert.equal(Number.isInteger(proposeAction.promoted), true);
  assert.equal(Number.isInteger(proposeAction.deferred), true);
  assert.equal(Number.isInteger(proposeAction.rejected), true);
  assert.equal(output.actions.some((action) => action.name === "apply"), false);
  assert.doesNotThrow(() => JSON.stringify(output));
});

test("api eval runs deterministic scenarios and writes report", async () => {
  const fixture = createFixture();
  const output = await evalHarness({ ...baseOptions(fixture), scenario: "redaction-fixture" });

  assert.equal(output.summary.failed, 0);
  assert.equal(output.results[0].scenario, "redaction-fixture");
  assert.equal(fs.existsSync(output.paths.latestJsonPath), true);
});

test("api inspect entry prints redacted full raw entry", async () => {
  const fixture = createFixture();
  const sessionFile = path.join(fixture.sessionDir, "session.jsonl");
  writeSession(sessionFile, { id: "s1", cwd: fixture.project, timestamp: "2026-06-14T01:00:00.000Z", userContent: "token sk-abcdefghijklmnopqrstuvwxyz" });

  const output = await inspect({ ...baseOptions(fixture), sessionFile, entry: "m1", full: true });

  assert.equal(output.entryId, "m1");
  assert.match(output.excerpt, /<REDACTED_SECRET>/);
  assert.doesNotMatch(JSON.stringify(output), /sk-abcdefghijklmnopqrstuvwxyz/);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-api-"));
  const project = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  const harnessHome = path.join(root, "harness-home");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  return { root, project, sessionDir, harnessHome };
}

function baseOptions(fixture) {
  return { project: fixture.project, sessionDir: fixture.sessionDir, harnessHome: fixture.harnessHome };
}

function readRuntimeLogEvents(harnessHome) {
  const dir = path.join(harnessHome, "logs", "runtime");
  const files = fs.readdirSync(dir).sort();
  return files.flatMap((file) => fs.readFileSync(path.join(dir, file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

function assertEventSequenceIncludes(events, expected) {
  const names = events.map((event) => event.event);
  let cursor = 0;
  for (const name of names) {
    if (name === expected[cursor]) cursor++;
    if (cursor === expected.length) return;
  }
  assert.fail(`Expected event sequence ${expected.join(" -> ")} in ${names.join(" -> ")}`);
}

function writeSession(file, { id, cwd, timestamp, userContent = "hi" }) {
  fs.writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp })}\n${JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: userContent } })}\n`);
}

function writeEpisodeSession(file, { id, cwd, timestamp }) {
  const lines = [
    { type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp },
    { type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: "private task prompt" } },
    { type: "message", id: "m2", parentId: "m1", timestamp, message: { role: "assistant", provider: "test", model: "model", content: "done" } },
    { type: "custom", id: "m3", parentId: "m2", timestamp, customType: "harness-tag", data: { tag: "success", reason: "SECRET_MARK_REASON", cwd: "/private/cwd", leafId: "private-leaf", createdAt: timestamp } },
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

function writeErrorSession(file, { id, cwd, timestamp }) {
  const lines = [
    { type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp },
    { type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: "fix file" } },
    { type: "message", id: "m2", parentId: "m1", timestamp, message: { role: "assistant", provider: "test", model: "model", content: [{ type: "toolCall", id: "edit1", name: "edit", arguments: { path: "src/a.js", oldText: "x", newText: "y" } }] } },
    { type: "message", id: "m3", parentId: "m2", timestamp, message: { role: "toolResult", toolCallId: "edit1", toolName: "edit", isError: true, content: [{ type: "text", text: "oldText must match a unique region of the original file" }] } },
    { type: "message", id: "m4", parentId: "m3", timestamp, message: { role: "assistant", provider: "test", model: "model", content: [{ type: "toolCall", id: "edit2", name: "edit", arguments: { path: "src/a.js", oldText: "x", newText: "y" } }] } },
    { type: "message", id: "m5", parentId: "m4", timestamp, message: { role: "toolResult", toolCallId: "edit2", toolName: "edit", isError: true, content: [{ type: "text", text: "oldText did not match" }] } },
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

function writeUnknownEntrySession(file, { id, cwd, timestamp }) {
  const lines = [
    { type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp },
    { type: "future_entry", id: "unknown-1", parentId: null, timestamp },
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

function writeSensitiveSession(file, { id, cwd, timestamp }) {
  const lines = [
    { type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp },
    { type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: "inspect config" } },
    { type: "message", id: "m2", parentId: "m1", timestamp, message: { role: "assistant", provider: "test", model: "model", content: [{ type: "toolCall", id: "read1", name: "read", arguments: { path: ".env" } }] } },
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

function reflectionProposal() {
  return {
    title: "Add eval fixture",
    target: "eval",
    targetFiles: ["harness/evals/"],
    risk: "low",
    problem: "Repeated evidence suggests an eval fixture.",
    proposedChange: "Add a deterministic eval fixture.",
    evidence: [{ sessionId: "s1", entryId: "e1", reason: "tool_error" }],
    testPlan: ["Run `npm --prefix packages/harness-runtime test`."],
    rollbackPlan: "Remove the fixture.",
  };
}
