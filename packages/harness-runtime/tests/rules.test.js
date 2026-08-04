import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRuleEngine, loadRuleConfig } from "../src/analysis/rules.js";

const PROPOSAL_FIELDS = ["title", "targetFiles", "proposedChange", "testPlan", "rollbackPlan", "problem", "risk", "fingerprint"];

test("runRuleEngine emits proposal-free CandidateSignal for repeated edit mismatch", () => {
  const fixture = createFixture();
  const events = [
    toolResult("e1", { toolName: "edit", isError: true, excerpt: "oldText must match a unique region" }),
    toolResult("e2", { toolName: "edit", isError: true, excerpt: "oldText did not match" }),
  ];
  const session = writeCachedSession(fixture, { sessionId: "s1", events });

  const candidate = runRuleEngine({ project: fixture.project, sessionResults: [session] }).find((item) => item.detectorId === "R-0002");

  assert.equal(candidate.schemaVersion, 1);
  assert.match(candidate.id, /^candidate-[a-f0-9]{24}$/);
  assert.equal(candidate.kind, "repeated-tool-error");
  assert.equal(candidate.status, "lead");
  assert.deepEqual(candidate.scope.authority, { project: true, userHome: false });
  assert.deepEqual(candidate.scope.ownerRoutes, ["wiki/_rules.md"]);
  assert.deepEqual(candidate.signal, { toolName: "edit", errorKind: "oldText_mismatch" });
  assert.equal(candidate.count, 2);
  assert.deepEqual(candidate.evidenceRefs.map((ref) => ref.entryId), ["e1", "e2"]);
  assert.equal(candidate.requiredReview.includes("existing-coverage"), true);
  for (const field of PROPOSAL_FIELDS) assert.equal(Object.hasOwn(candidate, field), false, field);
});

test("CandidateSignal ID and evidence ordering are stable across input reorder", () => {
  const fixture = createFixture();
  const first = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [
      toolResult("e2", { toolName: "edit", isError: true, excerpt: "oldText did not match" }),
      toolResult("e1", { toolName: "edit", isError: true, excerpt: "oldText must match a unique region" }),
    ],
  });
  const second = writeCachedSession(fixture, {
    sessionId: "s1-reordered",
    fileKey: "s1-reordered",
    sourceFingerprint: first.sourceFingerprint,
    events: [],
  });
  // Use the same evidence identities in a separately ordered cache file.
  fs.writeFileSync(second.paths.events, fs.readFileSync(first.paths.events, "utf8").trim().split("\n").reverse().join("\n") + "\n");

  const left = runRuleEngine({ project: fixture.project, sessionResults: [first] }).find((item) => item.detectorId === "R-0002");
  const right = runRuleEngine({ project: fixture.project, sessionResults: [second] }).find((item) => item.detectorId === "R-0002");

  assert.equal(left.id, right.id);
  assert.deepEqual(left.evidenceRefs, right.evidenceRefs);
});

test("same session and entry IDs from distinct frozen sources produce distinct candidates", () => {
  const fixture = createFixture();
  const events = [
    toolResult("e1", { toolName: "edit", isError: true, excerpt: "oldText did not match" }),
    toolResult("e2", { toolName: "edit", isError: true, excerpt: "oldText must match a unique region" }),
  ];
  const first = writeCachedSession(fixture, { sessionId: "same", fileKey: "source-a", sourceFingerprint: fingerprint("source-a"), events });
  const second = writeCachedSession(fixture, { sessionId: "same", fileKey: "source-b", sourceFingerprint: fingerprint("source-b"), events });

  const firstCandidate = runRuleEngine({ project: fixture.project, sessionResults: [first] }).find((item) => item.detectorId === "R-0002");
  const secondCandidate = runRuleEngine({ project: fixture.project, sessionResults: [second] }).find((item) => item.detectorId === "R-0002");

  assert.notEqual(firstCandidate.id, secondCandidate.id);
  assert.notEqual(firstCandidate.evidenceRefs[0].sourceFingerprint, secondCandidate.evidenceRefs[0].sourceFingerprint);
  assert.equal(firstCandidate.evidenceRefs[0].eventId, "e1_evt");
});

test("runRuleEngine rejects direct fixtures without a deterministic source binding", () => {
  assert.throws(
    () => runRuleEngine({ sessionResults: [{ paths: {} }] }),
    (error) => error.code === "MISSING_SOURCE_FINGERPRINT",
  );
});

test("runRuleEngine ignores legacy project JSON rule config", () => {
  const fixture = createFixture();
  fs.mkdirSync(path.join(fixture.project.projectRoot, "harness", "rules"), { recursive: true });
  fs.writeFileSync(path.join(fixture.project.projectRoot, "harness", "rules", "edit.json"), JSON.stringify({
    id: "R-0002",
    params: { minOccurrences: 3 },
  }));
  const session = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [
      toolResult("e1", { toolName: "edit", isError: true, excerpt: "oldText must match a unique region" }),
      toolResult("e2", { toolName: "edit", isError: true, excerpt: "oldText did not match" }),
    ],
  });

  const rules = loadRuleConfig({ project: fixture.project });
  const candidates = runRuleEngine({ project: fixture.project, sessionResults: [session], ruleConfig: rules });

  assert.equal(rules.get("R-0002").params.minOccurrences, 2);
  assert.equal(candidates.some((item) => item.detectorId === "R-0002"), true);
});

test("runRuleEngine emits parser and sensitive-evidence candidates with refs", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [{
      ...toolResult("sensitive", { toolName: "read", isError: false, excerpt: "sensitive path" }),
      safety: { sensitivePath: true, secretDetected: false },
    }],
    warnings: [{
      schemaVersion: 1,
      projectKey: fixture.project.projectKey,
      sessionId: "s1",
      entryId: "w1",
      code: "unknown_entry_type",
      message: "Unknown entry type: usage_snapshot",
      timestamp: "2026-06-14T00:00:00.000Z",
    }],
  });

  const candidates = runRuleEngine({ project: fixture.project, sessionResults: [session] });
  const parser = candidates.find((item) => item.detectorId === "R-0004");
  const redaction = candidates.find((item) => item.detectorId === "R-0003");

  assert.deepEqual(parser.signal, { warningCode: "unknown_entry_type" });
  assert.equal(parser.evidenceRefs[0].entryId, "w1");
  assert.deepEqual(redaction.signal.flagKinds, ["sensitive-path"]);
  assert.equal(redaction.evidenceRefs[0].entryId, "sensitive");
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rules-"));
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  return {
    root,
    project: { cwd: projectRoot, projectRoot, gitRoot: projectRoot, projectKey: "project-test", name: "project" },
  };
}

function writeCachedSession(fixture, { sessionId, events, warnings = [], fileKey = sessionId, sourceFingerprint = fingerprint(sessionId) }) {
  const dir = path.join(fixture.root, "cache", fileKey);
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, "events.jsonl");
  const warningsPath = path.join(dir, "warnings.jsonl");
  fs.writeFileSync(eventsPath, events.map((event) => JSON.stringify({
    schemaVersion: 1,
    projectKey: fixture.project.projectKey,
    sessionId,
    parentId: null,
    timestamp: "2026-06-14T00:00:00.000Z",
    cwd: fixture.project.cwd,
    activePath: true,
    safety: { redacted: false, sensitivePath: false, secretDetected: false },
    ...event,
  })).join("\n") + (events.length ? "\n" : ""));
  fs.writeFileSync(warningsPath, warnings.map((warning) => JSON.stringify(warning)).join("\n") + (warnings.length ? "\n" : ""));
  return { sessionId, sourceFingerprint, paths: { events: eventsPath, warnings: warningsPath }, warnings };
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function toolResult(entryId, { toolName, isError, excerpt }) {
  return {
    eventId: `${entryId}_evt`,
    entryId,
    kind: "tool_result",
    summary: `${toolName} result${isError ? " error" : ""}`,
    excerpt,
    tool: { name: toolName, isError },
  };
}
