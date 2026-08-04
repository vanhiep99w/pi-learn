import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTaskEpisodeArtifacts, classifyValidationCommand } from "../src/analysis/task-episodes.js";
import { normalizeSessionEvents } from "../src/normalize/events.js";

const SOURCE_A = "a".repeat(64);
const SOURCE_B = "b".repeat(64);
const PROJECT_ROOT = path.resolve("/synthetic/project");
const PROJECT_KEY = "project-synthetic";
const SESSION_ID = "private-session-secret";

function event(kind, extra = {}) {
  return { kind, activePath: true, ...extra };
}

function ordered(events) {
  return events.map((item, index) => ({
    schemaVersion: 1,
    eventId: item.eventId ?? `event-${index + 1}`,
    entryId: item.entryId ?? `entry-${index + 1}`,
    ordinal: item.ordinal ?? index + 1,
    sessionId: SESSION_ID,
    projectKey: PROJECT_KEY,
    cwd: PROJECT_ROOT,
    ...item,
  }));
}

function run({ selected = 1, accepted = selected, skipped = selected - accepted, status } = {}) {
  return {
    runId: "run-task-episodes-fixture",
    contextFingerprint: "c".repeat(64),
    project: { projectKey: PROJECT_KEY, projectRoot: PROJECT_ROOT },
    selection: { selectedCount: selected, selectedFingerprint: "d".repeat(64) },
    laneStatus: { consumer: status ?? (skipped ? "partial" : selected ? "complete" : "observed_empty") },
    consumption: {
      acceptedCount: accepted,
      skippedCount: skipped,
      status: status ?? (skipped ? "partial" : selected ? "complete" : "observed_empty"),
    },
  };
}

function build(events, { sourceFingerprint = SOURCE_A, analysisRun = run(), warnings = [] } = {}) {
  return buildTaskEpisodeArtifacts({
    analysisRun,
    projectRoot: PROJECT_ROOT,
    sessionResults: analysisRun.consumption.acceptedCount
      ? [{ sessionId: SESSION_ID, sourceFingerprint, events: ordered(events), warnings }]
      : [],
  });
}

function toolCall(name, callId, argsPreview) {
  return event("assistant_tool_call", { tool: { name, callId, argsPreview } });
}

function toolResult(name, callId, isError = false) {
  return event("tool_result", { tool: { name, callId, isError } });
}

function bash(command, exitCode, extra = {}) {
  return event("bash_execution", { bash: { command, exitCode, ...extra } });
}

test("normalization assigns expansion-order ordinals and allowlists only safe Harness marker data", () => {
  const timestamp = "2026-08-04T00:00:00.000Z";
  const entries = [
    { type: "message", id: "u1", parentId: null, timestamp, message: { role: "user", content: "SECRET_USER_PROMPT" } },
    { type: "message", id: "a1", parentId: "u1", timestamp, message: { role: "assistant", content: [
      { type: "text", text: "done" },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.js" } },
      { type: "toolCall", id: "call-2", name: "read", arguments: { path: "b.js" } },
    ] } },
    { type: "custom", id: "mark", parentId: "a1", timestamp, customType: "harness-tag", data: {
      tag: "success",
      reason: "SECRET_REASON",
      cwd: "/SECRET/ABSOLUTE/PATH",
      leafId: "SECRET_LEAF",
      note: "SECRET_NOTE",
      createdAt: "SECRET_TIME",
    } },
  ];
  const parsed = { entries, sessionFile: "/synthetic/session.jsonl", header: { id: "s", cwd: PROJECT_ROOT } };
  const normalized = normalizeSessionEvents({
    parsed,
    tree: { activePathSet: new Set(entries.map((item) => item.id)) },
    project: { projectKey: "project-key" },
  });

  assert.deepEqual(normalized.map((item) => item.ordinal), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalized.map((item) => item.eventId), [
    "u1_000001", "a1_000002", "a1_000002_tool_1", "a1_000002_tool_2", "mark_000003",
  ]);
  assert.deepEqual(normalized.at(-1).harnessMarker, { tag: "success" });
  const markerText = JSON.stringify(normalized.at(-1));
  for (const secret of ["SECRET_REASON", "SECRET_LEAF", "SECRET_NOTE", "SECRET_TIME", "/SECRET/ABSOLUTE/PATH"]) {
    assert.doesNotMatch(markerText, new RegExp(secret.replaceAll("/", "\\/")));
  }

  const invalid = normalizeSessionEvents({
    parsed: { ...parsed, entries: [{ ...entries[2], data: { tag: "note", reason: "SECRET_REASON" } }] },
    tree: { activePathSet: new Set(["mark"]) },
    project: { projectKey: "project-key" },
  });
  assert.equal(invalid[0].harnessMarker, undefined);
  assert.doesNotMatch(JSON.stringify(invalid[0]), /SECRET_REASON/);
});

test("success and failure markers are authoritative self-marked closure while delivery remains unobserved", () => {
  for (const [tag, closure] of [["success", "closed"], ["failure", "failed"]]) {
    const { privateArtifact, readerArtifact } = build([
      event("user_message", { excerpt: "SECRET_PROMPT" }),
      event("assistant_message", { excerpt: "work" }),
      event("custom", { harnessMarker: { tag }, reason: "SECRET_REASON", cwd: "/SECRET/CWD", leafId: "SECRET_LEAF", note: "SECRET_NOTE" }),
    ]);
    const candidate = privateArtifact.sessions[0].candidates[0];
    assert.equal(candidate.closure.status, closure);
    assert.equal(candidate.closure.outcomeEvidence, "explicit-self-mark");
    assert.equal(candidate.closure.deliveryStatus, "unobserved");
    assert.equal(candidate.closure.evidenceRefs[0].kind, "custom");
    assert.equal(readerArtifact.episodes[0].closure.status, closure);
    const readerText = JSON.stringify(readerArtifact);
    assert.doesNotMatch(readerText, /SECRET_REASON|SECRET_CWD|SECRET_LEAF|SECRET_NOTE/);
  }
});

test("each user message creates a separate session-bounded candidate and follow-up turns are never merged", () => {
  const { privateArtifact, readerArtifact } = build([
    event("user_message"),
    event("assistant_message"),
    event("user_message"),
    toolCall("read", "read-1", { path: "README.md" }),
  ]);

  const candidates = privateArtifact.sessions[0].candidates;
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].id, candidates[1].id);
  assert.equal(candidates[0].closure.boundary, "next-user-message");
  assert.equal(candidates[1].closure.boundary, "session-end");
  assert.equal(readerArtifact.episodes.length, 2);
  assert.equal(readerArtifact.continuation, "session-bounded");
});

test("a pass cannot point forward and a later edit remains unobserved", () => {
  const { readerArtifact } = build([
    event("user_message"),
    toolCall("write", "write-1", { path: "packages/app/src/a.js" }),
    toolResult("write", "write-1"),
    bash("npm --prefix packages/app test", 0),
    toolCall("edit", "edit-2", { path: "packages/app/src/b.js" }),
    toolResult("edit", "edit-2"),
  ]);
  const episode = readerArtifact.episodes[0];
  assert.equal(episode.changeSets.length, 2);
  assert.equal(episode.changeSets[0].validationState, "supported");
  assert.equal(episode.changeSets[1].validationState, "unobserved");
  assert.deepEqual(episode.changeSets[1].repairOfValidationSetIds, []);
  assert.deepEqual(episode.validationSets[0].supportsChangeSetIds, [episode.changeSets[0].id]);
  assert.notEqual(episode.validationSets[0].evaluatesChangeSetId, episode.changeSets[1].id);
});

test("failed or missing edit results are diagnostic only and never claim mutation", () => {
  const { privateArtifact, readerArtifact } = build([
    event("user_message"),
    toolCall("edit", "failed-edit", { path: "packages/app/src/a.js" }),
    toolResult("edit", "failed-edit", true),
    toolCall("write", "missing-write", { path: "packages/app/src/b.js" }),
  ]);
  const candidate = privateArtifact.sessions[0].candidates[0];
  assert.equal(candidate.changeSets.length, 0);
  assert.equal(candidate.diagnostics.failedChangeResults, 1);
  assert.equal(candidate.diagnostics.missingChangeResults, 1);
  assert.equal(readerArtifact.episodes[0].changeSets.length, 0);
  assert.equal(readerArtifact.episodes[0].observation.coverage, "partial");
  assert.deepEqual(readerArtifact.episodes[0].observation.reasons, ["change-result-missing"]);
});

test("matched assistant bash results produce chronological validation without exposing commands", () => {
  const { readerArtifact } = build([
    event("user_message"),
    toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-1"),
    toolCall("bash", "bash-1", { command: "npm --prefix packages/app test" }),
    toolResult("bash", "bash-1"),
  ]);
  const episode = readerArtifact.episodes[0];
  assert.equal(episode.validationSets[0].status, "pass");
  assert.equal(episode.validationSets[0].relevance.status, "scope-correlated");
  assert.equal(episode.changeSets[0].validationState, "supported");
  assert.doesNotMatch(JSON.stringify(readerArtifact), /npm --prefix/);
});

test("failure then edit then scoped rerun pass retains the repair chain", () => {
  const { readerArtifact } = build([
    event("user_message"),
    toolCall("write", "write-1", { path: "packages/app/src/a.js" }),
    toolResult("write", "write-1"),
    bash("npm --prefix packages/app test", 1),
    toolCall("edit", "edit-2", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-2"),
    bash("npm --prefix packages/app test", 0),
  ]);
  const episode = readerArtifact.episodes[0];
  assert.equal(episode.validationSets[0].status, "fail");
  assert.equal(episode.changeSets[0].validationState, "observed-failure");
  assert.deepEqual(episode.changeSets[1].repairOfValidationSetIds, [episode.validationSets[0].id]);
  assert.equal(episode.validationSets[1].status, "pass");
  assert.equal(episode.validationSets[1].relevance.status, "scope-correlated");
  assert.deepEqual(episode.validationSets[1].supportsChangeSetIds, [episode.changeSets[1].id]);
});

test("broad validation is unproven while explicit npm prefix scope is correlated", () => {
  const broad = build([
    event("user_message"),
    toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-1"),
    bash("npm test", 0),
  ]).readerArtifact.episodes[0];
  assert.equal(broad.validationSets[0].relevance.status, "unproven");
  assert.equal(broad.changeSets[0].validationState, "unobserved");

  const scoped = build([
    event("user_message"),
    toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-1"),
    bash("npm --prefix packages/app test", 0),
  ]).readerArtifact.episodes[0];
  assert.equal(scoped.validationSets[0].relevance.status, "scope-correlated");
  assert.equal(scoped.changeSets[0].validationState, "supported");

  const noChange = build([
    event("user_message"),
    bash("npm --prefix packages/app test", 0),
  ]).readerArtifact.episodes[0];
  assert.equal(noChange.validationSets[0].relevance.basis, "no-prior-change");
  assert.equal(noChange.validationSets[0].evaluatesChangeSetId, null);
});

test("classifier rejects shell composition, substitutions, env prefixes, traversal and truncation", () => {
  assert.equal(classifyValidationCommand("node --test").checkClass, "node-test");
  assert.equal(classifyValidationCommand("git diff --check").checkClass, "git-diff-check");
  assert.equal(classifyValidationCommand("npm --prefix packages/app test").scopeRoute, "packages/app");
  for (const command of [
    "npm test && echo done",
    "npm test | tee out",
    "npm test; echo done",
    "npm test > out",
    "npm test $(echo x)",
    "FOO=bar npm test",
    "npm --prefix ../outside test",
  ]) assert.equal(classifyValidationCommand(command), null);
  assert.equal(classifyValidationCommand("npm test", { truncated: true }), null);
});

test("compaction continues a candidate and branch summary is a hard uncertainty boundary", () => {
  const { readerArtifact } = build([
    event("user_message"),
    event("assistant_message"),
    event("compaction", { excerpt: "SECRET_COMPACTION_PROSE" }),
    toolCall("read", "read-1", { path: "README.md" }),
    event("branch_summary", { excerpt: "SECRET_BRANCH_PROSE" }),
    event("assistant_message", { excerpt: "ignored after boundary" }),
  ]);
  const episode = readerArtifact.episodes[0];
  assert.equal(episode.compaction.count, 1);
  assert.deepEqual(episode.compaction.ordinals, [3]);
  assert.equal(episode.closure.boundary, "branch-summary");
  assert.equal(episode.closure.status, "unobserved");
  assert.doesNotMatch(JSON.stringify(readerArtifact), /SECRET_COMPACTION_PROSE|SECRET_BRANCH_PROSE/);
});

test("inactive branch markers are omitted and session end never implies success", () => {
  const events = ordered([
    event("user_message"),
    event("assistant_message"),
    event("custom", { activePath: false, harnessMarker: { tag: "success" } }),
  ]);
  const { privateArtifact, readerArtifact } = buildTaskEpisodeArtifacts({
    analysisRun: run(),
    projectRoot: PROJECT_ROOT,
    sessionResults: [{ sessionId: SESSION_ID, sourceFingerprint: SOURCE_A, events }],
  });
  assert.equal(privateArtifact.counts.offPathEventsOmitted, 1);
  assert.equal(readerArtifact.episodes[0].closure.status, "unobserved");
  assert.equal(readerArtifact.episodes[0].closure.boundary, "session-end");
});

test("user-only candidates are discarded zero-signal while assistant and read-only tasks are retained", () => {
  const { privateArtifact, readerArtifact } = build([
    event("user_message"),
    event("user_message"),
    event("assistant_message"),
    event("user_message"),
    toolCall("read", "read-1", { path: "README.md" }),
  ]);
  assert.equal(privateArtifact.counts.candidates, 3);
  assert.equal(privateArtifact.counts.retained, 2);
  assert.equal(privateArtifact.counts.discarded, 1);
  assert.equal(privateArtifact.counts.candidates, privateArtifact.counts.retained + privateArtifact.counts.discarded);
  assert.equal(readerArtifact.episodes.length, privateArtifact.counts.retained);
  assert.equal(privateArtifact.sessions[0].candidates[0].retention.reason, "zero-signal");
});

test("outside-project change routes are omitted and make route and observation coverage partial", () => {
  const { readerArtifact } = build([
    event("user_message"),
    toolCall("write", "outside-write", { path: "/outside/project/SECRET.js" }),
    toolResult("write", "outside-write"),
  ]);
  const episode = readerArtifact.episodes[0];
  assert.deepEqual(episode.changeSets[0].targetRoutes, []);
  assert.equal(episode.changeSets[0].routeBinding.status, "partial");
  assert.deepEqual(episode.observation.reasons, ["target-route-ambiguous"]);
  assert.doesNotMatch(JSON.stringify(readerArtifact), /outside\/project/);
});

test("unknown mutating tools and unclassified or truncated bash make observation coverage partial", () => {
  const { readerArtifact } = build([
    event("user_message"),
    toolCall("apply_patch", "unknown-1", { path: "src/a.js" }),
    bash("npm test && echo unsafe", 0),
    bash("npm test", 0, { truncated: true }),
  ]);
  assert.equal(readerArtifact.episodes[0].observation.coverage, "partial");
  assert.deepEqual(readerArtifact.episodes[0].observation.reasons, [
    "bash-unclassified-or-complex",
    "unknown-potentially-mutating-tool",
  ]);
});

test("selected mutation is partial and zero selected is observed-empty", () => {
  const partialRun = run({ selected: 1, accepted: 0, skipped: 1, status: "partial" });
  const partial = buildTaskEpisodeArtifacts({ analysisRun: partialRun, projectRoot: PROJECT_ROOT, sessionResults: [] });
  assert.equal(partial.readerArtifact.status, "partial");
  assert.equal(partial.readerArtifact.counts.skippedSessions, 1);
  assert.equal(partial.readerArtifact.episodes.length, 0);

  const emptyRun = run({ selected: 0, accepted: 0, skipped: 0, status: "observed_empty" });
  const empty = buildTaskEpisodeArtifacts({ analysisRun: emptyRun, projectRoot: PROJECT_ROOT, sessionResults: [] });
  assert.equal(empty.readerArtifact.status, "observed-empty");
  assert.equal(empty.readerArtifact.counts.candidates, 0);
});

test("duplicate or malformed ordinal and event IDs fail closed per session", () => {
  const malformedCases = [
    ordered([event("user_message"), event("assistant_message", { ordinal: 1 })]),
    ordered([event("user_message", { eventId: "duplicate" }), event("assistant_message", { eventId: "duplicate" })]),
    ordered([event("user_message", { eventId: "" }), event("assistant_message")]),
  ];
  for (const events of malformedCases) {
    const { privateArtifact, readerArtifact } = buildTaskEpisodeArtifacts({
      analysisRun: run(),
      projectRoot: PROJECT_ROOT,
      sessionResults: [{ sessionId: SESSION_ID, sourceFingerprint: SOURCE_A, events }],
    });
    assert.equal(privateArtifact.status, "partial");
    assert.equal(privateArtifact.sessions[0].normalizedEvents.status, "partial");
    assert.equal(privateArtifact.sessions[0].candidates.length, 0);
    assert.equal(readerArtifact.episodes.length, 0);
  }
});

test("normalized evidence load loss and essential warnings suppress only the affected session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-episode-evidence-"));
  const malformedPath = path.join(root, "events.jsonl");
  fs.writeFileSync(malformedPath, "{not-json}\n");

  const malformedCache = buildTaskEpisodeArtifacts({
    analysisRun: run(),
    projectRoot: PROJECT_ROOT,
    sessionResults: [{
      sessionId: SESSION_ID,
      sourceFingerprint: SOURCE_A,
      paths: { events: malformedPath },
      warnings: [],
    }],
  });
  assert.equal(malformedCache.privateArtifact.status, "partial");
  assert.deepEqual(malformedCache.privateArtifact.sessions[0].normalizedEvents.warningCodes, ["normalized-events-unreadable"]);
  assert.equal(malformedCache.privateArtifact.sessions[0].candidateCount, 0);

  const malformedRaw = build([
    event("user_message"),
    event("assistant_message"),
  ], { warnings: [{ code: "malformed_json" }] });
  assert.equal(malformedRaw.privateArtifact.status, "partial");
  assert.equal(malformedRaw.readerArtifact.episodes.length, 0);

  const coverageWarning = build([
    event("user_message"),
    event("assistant_message"),
  ], { warnings: [{ code: "unknown_entry_type" }] });
  assert.equal(coverageWarning.privateArtifact.status, "partial");
  assert.equal(coverageWarning.readerArtifact.episodes.length, 1);

  const emptyPath = path.join(root, "empty-events.jsonl");
  fs.writeFileSync(emptyPath, "");
  const genuineEmpty = buildTaskEpisodeArtifacts({
    analysisRun: run(),
    projectRoot: PROJECT_ROOT,
    sessionResults: [{
      sessionId: SESSION_ID,
      sourceFingerprint: SOURCE_A,
      paths: { events: emptyPath },
      warnings: [],
    }],
  });
  assert.equal(genuineEmpty.privateArtifact.status, "complete");
  assert.equal(genuineEmpty.privateArtifact.sessions[0].normalizedEvents.eventCount, 0);
  assert.equal(genuineEmpty.readerArtifact.counts.candidates, 0);
});

test("every essential normalized event field and session/project binding fails closed when malformed", () => {
  const valid = ordered([event("user_message"), event("assistant_message")]);
  const malformed = [
    valid.map((item, index) => index ? item : { ...item, schemaVersion: 2 }),
    valid.map((item, index) => index ? item : { ...item, entryId: "" }),
    valid.map((item, index) => index ? item : { ...item, kind: "" }),
    valid.map((item, index) => index ? item : { ...item, activePath: null }),
    valid.map((item, index) => index ? item : { ...item, sessionId: "wrong-session" }),
    valid.map((item, index) => index ? item : { ...item, projectKey: "wrong-project" }),
    valid.map((item, index) => index ? item : { ...item, ordinal: 3 }),
  ];
  for (const events of malformed) {
    const built = buildTaskEpisodeArtifacts({
      analysisRun: run(),
      projectRoot: PROJECT_ROOT,
      sessionResults: [{ sessionId: SESSION_ID, sourceFingerprint: SOURCE_A, events }],
    });
    assert.equal(built.privateArtifact.status, "partial");
    assert.equal(built.readerArtifact.episodes.length, 0);
  }
});

test("raw normalization preserves ambiguous tool result status and builder claims neither change nor pass", () => {
  for (const [label, isError] of [["missing", undefined], ["null", null], ["string", "false"], ["number", 0]]) {
    const timestamp = "2026-08-04T00:00:00.000Z";
    const resultMessage = { role: "toolResult", toolCallId: "edit-1", toolName: "edit", content: "result" };
    if (label !== "missing") resultMessage.isError = isError;
    const entries = [
      { type: "message", id: "u1", parentId: null, timestamp, message: { role: "user", content: "task" } },
      { type: "message", id: "a1", parentId: "u1", timestamp, message: { role: "assistant", content: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/a.js" } }] } },
      { type: "message", id: "r1", parentId: "a1", timestamp, message: resultMessage },
    ];
    const events = normalizeSessionEvents({
      parsed: { entries, sessionFile: "/synthetic/session.jsonl", header: { id: SESSION_ID, cwd: PROJECT_ROOT } },
      tree: { activePathSet: new Set(entries.map((entry) => entry.id)) },
      project: { projectKey: PROJECT_KEY },
    });
    const built = buildTaskEpisodeArtifacts({
      analysisRun: run(),
      projectRoot: PROJECT_ROOT,
      sessionResults: [{
        sessionId: SESSION_ID,
        sourceFingerprint: SOURCE_A,
        events,
        warnings: [{ code: "nonboolean_tool_result_status" }],
      }],
    });
    const candidate = built.privateArtifact.sessions[0].candidates[0];
    assert.equal(events.at(-1).tool.isError, undefined, label);
    assert.equal(candidate.changeSets.length, 0, label);
    assert.equal(candidate.validationSets.length, 0, label);
    assert.deepEqual(candidate.observation.reasons, ["change-result-status-ambiguous"], label);
    assert.equal(built.readerArtifact.status, "partial", label);
  }
});

test("relative targets and npm prefixes resolve from absolute contained event cwd", () => {
  const nested = path.join(PROJECT_ROOT, "packages/app");
  const nestedEpisode = build([
    event("user_message"),
    event("assistant_tool_call", { cwd: nested, tool: { name: "edit", callId: "edit-1", argsPreview: { path: "src/a.js" } } }),
    toolResult("edit", "edit-1"),
    event("bash_execution", { cwd: nested, bash: { command: "npm --prefix . test", exitCode: 0 } }),
  ]).readerArtifact.episodes[0];
  assert.deepEqual(nestedEpisode.changeSets[0].targetRoutes, ["packages/app/src/a.js"]);
  assert.equal(nestedEpisode.validationSets[0].scopeRoute, "packages/app");
  assert.equal(nestedEpisode.validationSets[0].relevance.status, "scope-correlated");
  assert.equal(nestedEpisode.changeSets[0].validationState, "supported");

  const rootEpisode = build([
    event("user_message"),
    toolCall("edit", "edit-1", { path: "src/a.js" }),
    toolResult("edit", "edit-1"),
    bash("npm --prefix . test", 0),
  ]).readerArtifact.episodes[0];
  assert.deepEqual(rootEpisode.changeSets[0].targetRoutes, ["src/a.js"]);
  assert.equal(rootEpisode.validationSets[0].scopeRoute, ".");
  assert.equal(rootEpisode.validationSets[0].relevance.status, "unproven");

  for (const cwd of ["relative/cwd", path.resolve("/outside/project")]) {
    const outside = build([
      event("user_message"),
      event("assistant_tool_call", { cwd, tool: { name: "edit", callId: "edit-1", argsPreview: { path: "src/a.js" } } }),
      toolResult("edit", "edit-1"),
      event("bash_execution", { cwd, bash: { command: "npm --prefix . test", exitCode: 0 } }),
    ]).readerArtifact.episodes[0];
    assert.deepEqual(outside.changeSets[0].targetRoutes, []);
    assert.equal(outside.observation.coverage, "partial");
    assert.equal(outside.validationSets.length, 0);
  }
});

test("baseline validation failures queue repair links until pass or candidate boundary", () => {
  const baseline = build([
    event("user_message"),
    bash("npm --prefix packages/app test", 1),
    toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-1"),
    bash("npm --prefix packages/app test", 0),
  ]).readerArtifact.episodes[0];
  assert.deepEqual(baseline.changeSets[0].repairOfValidationSetIds, [baseline.validationSets[0].id]);

  const repeated = build([
    event("user_message"),
    bash("npm --prefix packages/app test", 1),
    bash("npm --prefix packages/app test", 1),
    toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-1"),
    bash("npm --prefix packages/app test", 0),
  ]).readerArtifact.episodes[0];
  assert.deepEqual(repeated.changeSets[0].repairOfValidationSetIds, repeated.validationSets.slice(0, 2).map((item) => item.id));

  const cleared = build([
    event("user_message"),
    bash("npm --prefix packages/app test", 1),
    bash("npm --prefix packages/app test", 0),
    toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-1"),
  ]).readerArtifact.episodes[0];
  assert.deepEqual(cleared.changeSets[0].repairOfValidationSetIds, []);

  for (const boundary of [
    [event("user_message"), event("user_message")],
    [event("branch_summary"), event("user_message")],
    [event("custom", { harnessMarker: { tag: "failure" } }), event("user_message")],
  ]) {
    const episodes = build([
      event("user_message"),
      bash("npm --prefix packages/app test", 1),
      ...boundary,
      toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
      toolResult("edit", "edit-1"),
    ]).readerArtifact.episodes;
    assert.deepEqual(episodes.at(-1).changeSets[0].repairOfValidationSetIds, []);
  }
});

test("one call-id registry rejects duplicates across every tool class and result order", () => {
  const cases = [
    [toolCall("edit", "dup", { path: "src/a.js" }), toolCall("edit", "dup", { path: "src/b.js" }), toolResult("edit", "dup")],
    [toolCall("edit", "dup", { path: "src/a.js" }), toolCall("bash", "dup", { command: "npm test" }), toolResult("edit", "dup"), toolResult("bash", "dup")],
    [toolCall("bash", "dup", { command: "npm test" }), toolCall("read", "dup", { path: "README.md" }), toolResult("bash", "dup")],
    [toolResult("edit", "dup"), toolCall("edit", "dup", { path: "src/a.js" }), toolCall("read", "dup", { path: "README.md" }), toolResult("edit", "dup")],
  ];
  for (const events of cases) {
    const episode = build([event("user_message"), ...events]).readerArtifact.episodes[0];
    assert.equal(episode.changeSets.length, 0);
    assert.equal(episode.validationSets.length, 0);
    assert.equal(episode.observation.reasons.includes("tool-call-id-duplicate"), true);
  }

  const repeatedResult = build([
    event("user_message"),
    toolCall("edit", "edit-1", { path: "src/a.js" }),
    toolResult("edit", "edit-1"),
    toolResult("edit", "edit-1"),
  ]).privateArtifact.sessions[0].candidates[0];
  assert.equal(repeatedResult.changeSets.length, 1);
  assert.equal(repeatedResult.diagnostics.unmatchedToolResults, 1);
});

test("latest relevant validation result controls support state", () => {
  const passThenFail = build([
    event("user_message"),
    toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-1"),
    bash("npm --prefix packages/app test", 0),
    bash("npm --prefix packages/app test", 1),
  ]).readerArtifact.episodes[0];
  assert.equal(passThenFail.changeSets[0].validationState, "observed-failure");

  const failThenPass = build([
    event("user_message"),
    toolCall("edit", "edit-1", { path: "packages/app/src/a.js" }),
    toolResult("edit", "edit-1"),
    bash("npm --prefix packages/app test", 1),
    bash("npm --prefix packages/app test", 0),
  ]).readerArtifact.episodes[0];
  assert.equal(failThenPass.changeSets[0].validationState, "supported");
});

test("preview_export is potentially mutating while known finite read tools remain read-only", () => {
  const preview = build([event("user_message"), toolCall("preview_export", "preview-1", { format: "pdf" })]).readerArtifact.episodes[0];
  assert.deepEqual(preview.observation.reasons, ["unknown-potentially-mutating-tool"]);
  const unknown = build([event("user_message"), toolCall("future_tool", "future-1", {})]).readerArtifact.episodes[0];
  assert.deepEqual(unknown.observation.reasons, ["unknown-potentially-mutating-tool"]);
  const readOnly = build([event("user_message"), toolCall("read", "read-1", { path: "README.md" })]).readerArtifact.episodes[0];
  assert.equal(readOnly.observation.coverage, "complete");
});

test("classifier rejects expansion metacharacters and controls even when quoted", () => {
  for (const token of ["$HOME", "~", "*", "?", "[a]", "{a,b}", "\u0000", "\u0001", "\u007f"]) {
    for (const command of [`node --test ${token}`, `node --test '${token}'`, `node --test \"${token}\"`]) {
      assert.equal(classifyValidationCommand(command), null, JSON.stringify(command));
    }
  }
});

test("builder rejects consumption/result count mismatches", () => {
  assert.throws(
    () => buildTaskEpisodeArtifacts({ analysisRun: run({ selected: 1, accepted: 1 }), projectRoot: PROJECT_ROOT, sessionResults: [] }),
    /consumption counts do not reconcile/,
  );
});

test("candidate IDs and fingerprints are deterministic and bind the source fingerprint", () => {
  const events = [event("user_message"), event("assistant_message")];
  const first = build(events, { sourceFingerprint: SOURCE_A });
  const replay = build(events, { sourceFingerprint: SOURCE_A });
  const rebound = build(events, { sourceFingerprint: SOURCE_B });
  assert.deepEqual(first, replay);
  assert.notEqual(first.privateArtifact.artifactFingerprint, rebound.privateArtifact.artifactFingerprint);
  assert.notEqual(first.privateArtifact.sessions[0].candidates[0].id, rebound.privateArtifact.sessions[0].candidates[0].id);
  assert.equal(first.privateArtifact.readerProjectionFingerprint.length, 64);
  assert.equal(first.privateArtifact.artifactFingerprint.length, 64);
});

test("reader projection excludes prompts, commands, absolute paths and all private locator fields", () => {
  const absoluteTarget = path.join(PROJECT_ROOT, "packages/app/src/SECRET_FILE.js");
  const { privateArtifact, readerArtifact } = build([
    event("user_message", { excerpt: "SECRET_PROMPT" }),
    toolCall("write", "SECRET_CALL_ID", { path: absoluteTarget, content: "SECRET_WRITE_CONTENT" }),
    toolResult("write", "SECRET_CALL_ID"),
    bash("npm --prefix packages/app test", 0),
    event("custom", { harnessMarker: { tag: "success" }, reason: "SECRET_MARK_REASON" }),
  ]);
  const readerText = JSON.stringify(readerArtifact);
  assert.match(readerText, /packages\/app\/src\/SECRET_FILE\.js/);
  for (const secret of [
    "SECRET_PROMPT",
    "SECRET_CALL_ID",
    "SECRET_WRITE_CONTENT",
    "SECRET_MARK_REASON",
    PROJECT_ROOT,
    SOURCE_A,
    "private-session-secret",
    "npm --prefix packages/app test",
  ]) assert.equal(readerText.includes(secret), false, secret);
  for (const privateField of ["sourceFingerprint", "commandFingerprint", "selectedFingerprint", "contextFingerprint", "eventId", "entryId", "sessionId", "excerpt", "evidenceRefs"]) {
    assert.equal(readerText.includes(`\"${privateField}\"`), false, privateField);
  }
  assert.equal(privateArtifact.sessions[0].sourceFingerprint, SOURCE_A);
  assert.equal(privateArtifact.sessions[0].candidates[0].validationSets[0].commandFingerprint.length, 64);
  assert.equal(readerArtifact.counts.candidates, readerArtifact.counts.retained + readerArtifact.counts.discarded);
  assert.equal(readerArtifact.episodes.length, readerArtifact.counts.retained);
});
