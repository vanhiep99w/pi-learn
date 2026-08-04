import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reviewCandidateSignals, publicCandidateReview } from "../src/analysis/candidate-review.js";
import { runRuleEngine } from "../src/analysis/rules.js";
import { writeDraftProposals } from "../src/proposals/proposal-writer.js";

const EXACT_EDIT_RULE = [
  "# Rules",
  "",
  "## GLOBAL-EDIT-001 — Inspect before exact-text edits",
  "",
  "Read the current target block immediately before applying an exact-text edit.",
  "Confirm oldText exactly matches current whitespace and punctuation.",
  "Confirm the match is unique.",
  "",
].join("\n");

test("current GLOBAL-EDIT-001 defers R-0002 with existing coverage and no proposal", () => {
  const fixture = createFixture();
  write(fixture, "wiki/_rules.md", EXACT_EDIT_RULE);
  const candidate = editCandidate(fixture);

  const review = reviewCandidateSignals({ project: fixture.project, candidates: [candidate] });
  const decision = review.decisions[0];

  assert.equal(decision.state, "deferred");
  assert.equal(decision.reasonCode, "existing-coverage");
  assert.equal(decision.observedUse, "unobserved");
  assert.deepEqual(decision.coverage, { state: "covered", matches: [{ route: "wiki/_rules.md", sectionId: "GLOBAL-EDIT-001" }] });
  assert.equal(review.proposals.length, 0);
});

test("equivalent exact-edit coverage under a different ID also defers", () => {
  const fixture = createFixture();
  write(fixture, "wiki/_rules.md", EXACT_EDIT_RULE.replace("GLOBAL-EDIT-001", "TEAM-WORKFLOW-999"));

  const decision = reviewCandidateSignals({ project: fixture.project, candidates: [editCandidate(fixture)] }).decisions[0];

  assert.equal(decision.state, "deferred");
  assert.equal(decision.reasonCode, "existing-coverage");
  assert.equal(decision.coverage.matches[0].sectionId, "TEAM-WORKFLOW-999");
});

test("equivalent coverage in an applicable AGENTS.md also defers", () => {
  const fixture = createFixture();
  write(fixture, "AGENTS.md", EXACT_EDIT_RULE.replace("GLOBAL-EDIT-001", "AGENT-EDIT-777"));

  const decision = reviewCandidateSignals({ project: fixture.project, candidates: [editCandidate(fixture)] }).decisions[0];

  assert.equal(decision.state, "deferred");
  assert.equal(decision.reasonCode, "existing-coverage");
  assert.deepEqual(decision.coverage.matches, [{ route: "AGENTS.md", sectionId: "AGENT-EDIT-777" }]);
});

test("unsectioned AGENTS H1, bullets, and preamble coverage all defer duplicate repair", () => {
  const fixtures = [
    [
      "# Exact edit workflow",
      "Read the current target block before an exact edit.",
      "Confirm oldText preserves exact whitespace and punctuation.",
      "Confirm the match is unique.",
    ].join("\n"),
    [
      "- For an exact edit, read the current target block first.",
      "- Keep oldText exact, including whitespace and punctuation.",
      "- Require the match to be unique.",
    ].join("\n"),
    [
      "# Project instructions",
      "Read the current target block before an exact edit.",
      "Confirm oldText preserves exact whitespace and punctuation.",
      "Confirm the match is unique.",
      "## TESTING-001 — Unrelated testing",
      "Run tests.",
    ].join("\n"),
  ];

  for (const content of fixtures) {
    const fixture = createFixture();
    write(fixture, "AGENTS.md", content);
    const decision = reviewCandidateSignals({ project: fixture.project, candidates: [editCandidate(fixture)] }).decisions[0];
    assert.equal(decision.state, "deferred");
    assert.equal(decision.reasonCode, "existing-coverage");
    assert.equal(decision.coverage.state, "covered");
    assert.match(decision.coverage.matches[0].sectionId, /^section-[a-f0-9]{16}$/);
  }
});

test("fully inspected absent coverage promotes R-0002 with audit binding", () => {
  const fixture = createFixture();
  write(fixture, "AGENTS.md", "# Project notes\n\n## Testing\nRun focused tests.\n");
  write(fixture, "wiki/_rules.md", "# Rules\n\n## SAFETY-001 — Keep secrets private\nDo not expose secrets.\n");
  const candidate = editCandidate(fixture);

  const review = reviewCandidateSignals({ project: fixture.project, candidates: [candidate] });
  const decision = review.decisions[0];
  const proposal = review.proposals[0];

  assert.equal(decision.state, "promoted");
  assert.equal(decision.coverage.state, "not-covered");
  assert.equal(proposal.candidateId, candidate.id);
  assert.equal(proposal.detectorId, "R-0002");
  assert.equal(proposal.reviewFingerprint, decision.reviewFingerprint);
  assert.deepEqual(proposal.targetFiles, ["wiki/_rules.md"]);
  assert.equal(proposal.evidence.length, 2);
});

test("proposal identity ignores unrelated non-covering asset content changes", () => {
  const fixture = createFixture();
  const candidate = editCandidate(fixture);
  write(fixture, "AGENTS.md", "# Notes\n\n## TESTING-001 — Tests\nRun focused tests.\n");
  const firstReview = reviewCandidateSignals({ project: fixture.project, candidates: [candidate] });
  const firstWrite = writeDraftProposals({ config: { harnessHome: path.join(fixture.root, ".harness-home") }, project: fixture.project, proposals: firstReview.proposals });

  write(fixture, "AGENTS.md", "# Notes changed\n\n## TESTING-001 — Tests\nRun focused and full tests.\n");
  const secondReview = reviewCandidateSignals({ project: fixture.project, candidates: [candidate] });
  const secondWrite = writeDraftProposals({ config: { harnessHome: path.join(fixture.root, ".harness-home") }, project: fixture.project, proposals: secondReview.proposals });

  assert.notEqual(firstReview.decisions[0].reviewFingerprint, secondReview.decisions[0].reviewFingerprint);
  assert.equal(firstReview.proposals[0].fingerprint, secondReview.proposals[0].fingerprint);
  assert.equal(firstWrite.written.length, 1);
  assert.equal(secondWrite.written.length, 0);
  assert.equal(secondWrite.skipped[0].reason, "duplicate_fingerprint");
});

test("counts-only evidence and unreadable applicable owner defer", () => {
  const incompleteFixture = createFixture();
  const incomplete = { ...editCandidate(incompleteFixture), count: 3 };
  const incompleteDecision = reviewCandidateSignals({ project: incompleteFixture.project, candidates: [incomplete] }).decisions[0];
  assert.equal(incompleteDecision.state, "deferred");
  assert.equal(incompleteDecision.reasonCode, "no-observed-consequence");
  assert.equal(incompleteDecision.diagnostics[0].code, "incomplete-evidence-refs");

  const unreadableFixture = createFixture();
  write(unreadableFixture, "wiki/_rules.md", "# Rules\n", { mode: 0o000 });
  const unreadableDecision = reviewCandidateSignals({ project: unreadableFixture.project, candidates: [editCandidate(unreadableFixture)] }).decisions[0];
  fs.chmodSync(path.join(unreadableFixture.root, "wiki", "_rules.md"), 0o600);
  assert.equal(unreadableDecision.state, "deferred");
  assert.equal(unreadableDecision.reasonCode, "unobserved-owner");
  assert.equal(unreadableDecision.coverage.state, "partial");
});

test("coverage precision keeps sections independent and defers ambiguous near-match", () => {
  const scatteredFixture = createFixture();
  write(scatteredFixture, "wiki/_rules.md", [
    "# Rules",
    "## ONE — oldText edit",
    "Use oldText for an edit.",
    "## TWO — Inspect",
    "Read the current target block.",
    "## THREE — Exact",
    "Preserve whitespace and punctuation.",
    "## FOUR — Unique",
    "The match is unique.",
    "## GLOBAL-EDIT-001 — Identifier only",
    "No workflow content here.",
  ].join("\n"));
  const scattered = reviewCandidateSignals({ project: scatteredFixture.project, candidates: [editCandidate(scatteredFixture)] }).decisions[0];
  assert.equal(scattered.coverage.state, "not-covered");
  assert.equal(scattered.state, "promoted");

  const ambiguousFixture = createFixture();
  write(ambiguousFixture, "wiki/_rules.md", [
    "# Rules",
    "## ALT-EDIT-001 — Exact edit workflow",
    "Inspect the current target block before an exact edit.",
    "Keep oldText whitespace and punctuation exact.",
    "",
  ].join("\n"));
  const ambiguous = reviewCandidateSignals({ project: ambiguousFixture.project, candidates: [editCandidate(ambiguousFixture)] }).decisions[0];
  assert.equal(ambiguous.coverage.state, "ambiguous");
  assert.equal(ambiguous.state, "deferred");
  assert.equal(ambiguous.reasonCode, "existing-coverage");
  assert.equal(ambiguous.diagnostics[0].code, "ambiguous-semantic-coverage");
});

test("bash promotion uses a high-precision prerequisite/retry coverage signature", () => {
  const coveredFixture = createFixture();
  write(coveredFixture, "wiki/operations/_rules.md", [
    "# Operations",
    "## OPS-BASH-777 — Command retries",
    "Check command prerequisites and required setup.",
    "Inspect failure output before retrying the bash command.",
    "",
  ].join("\n"));
  const covered = reviewCandidateSignals({ project: coveredFixture.project, candidates: [bashCandidate(coveredFixture)] }).decisions[0];
  assert.equal(covered.coverage.state, "covered");
  assert.equal(covered.reasonCode, "existing-coverage");

  const absentFixture = createFixture();
  const promoted = reviewCandidateSignals({ project: absentFixture.project, candidates: [bashCandidate(absentFixture)] });
  assert.equal(promoted.decisions[0].state, "promoted");
  assert.deepEqual(promoted.proposals[0].targetFiles, ["wiki/operations/_rules.md"]);
});

test("unsupported generic tool-error lead is retained as rejected", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    fileKey: "generic-tool-error",
    events: [
      toolError("g1", "read", "not found"),
      toolError("g2", "read", "ENOENT"),
    ],
  });
  const candidate = runRuleEngine({ project: fixture.project, sessionResults: [session] }).find((item) => item.detectorId === "R-0002");

  const review = reviewCandidateSignals({ project: fixture.project, candidates: [candidate] });

  assert.equal(review.decisions[0].state, "rejected");
  assert.equal(review.decisions[0].reasonCode, "not-applicable");
  assert.equal(review.proposals.length, 0);
});

test("R-0003 defers one sensitive flag without inferred consequence", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    events: [{
      entryId: "s1",
      eventId: "s1-event",
      kind: "assistant_tool_call",
      tool: { name: "read" },
      safety: { sensitivePath: true, secretDetected: false },
    }],
  });
  const candidate = runRuleEngine({ project: fixture.project, sessionResults: [session] }).find((item) => item.detectorId === "R-0003");

  const review = reviewCandidateSignals({ project: fixture.project, candidates: [candidate] });

  assert.equal(review.decisions[0].state, "deferred");
  assert.equal(review.decisions[0].reasonCode, "no-observed-consequence");
  assert.equal(review.decisions[0].coverage.state, "not-applicable");
  assert.equal(review.proposals.length, 0);
});

test("R-0004 promotes only with distinct warning refs and real package owners", () => {
  const fixture = createFixture();
  for (const route of [
    "packages/harness-runtime/src/session/warnings.js",
    "packages/harness-runtime/src/normalize/events.js",
    "packages/harness-runtime/tests/parse-tree.test.js",
  ]) write(fixture, route, "// owner\n");
  const candidate = parserCandidate(fixture, "unknown_entry_type");

  const promoted = reviewCandidateSignals({ project: fixture.project, candidates: [candidate] });

  assert.equal(promoted.decisions[0].state, "promoted");
  assert.equal(promoted.decisions[0].coverage.state, "not-applicable");
  assert.match(promoted.proposals[0].problem, /downstream evidence/);
  assert.deepEqual(promoted.proposals[0].targetFiles, [
    "packages/harness-runtime/src/session/warnings.js",
    "packages/harness-runtime/src/normalize/events.js",
    "packages/harness-runtime/tests/parse-tree.test.js",
  ]);

  const missingOwnerFixture = createFixture();
  const deferred = reviewCandidateSignals({ project: missingOwnerFixture.project, candidates: [parserCandidate(missingOwnerFixture, "unknown_entry_type")] });
  assert.equal(deferred.decisions[0].state, "deferred");
  assert.equal(deferred.decisions[0].reasonCode, "unobserved-owner");
  assert.equal(deferred.proposals.length, 0);
});

test("public review projection omits signals, evidence refs, contents, and absolute paths", () => {
  const fixture = createFixture();
  const review = reviewCandidateSignals({ project: fixture.project, candidates: [editCandidate(fixture)] });
  const projection = publicCandidateReview(review);
  const serialized = JSON.stringify(projection);

  assert.equal(projection.candidates, 1);
  assert.equal(projection.promoted, 1);
  assert.equal(Object.hasOwn(projection.candidateSignals[0], "signal"), false);
  assert.equal(Object.hasOwn(projection.candidateSignals[0], "evidenceRefs"), false);
  assert.equal(serialized.includes(fixture.root), false);
  assert.equal(serialized.includes("oldText did not match"), false);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-candidate-review-"));
  return {
    root,
    project: { cwd: root, projectRoot: root, gitRoot: root, projectKey: "project-test", name: "project" },
  };
}

function editCandidate(fixture) {
  const session = writeCachedSession(fixture, {
    events: [
      toolError("e1", "edit", "oldText did not match"),
      toolError("e2", "edit", "oldText must match a unique region"),
    ],
  });
  return runRuleEngine({ project: fixture.project, sessionResults: [session] }).find((item) => item.detectorId === "R-0002");
}

function bashCandidate(fixture) {
  const session = writeCachedSession(fixture, {
    fileKey: "bash",
    events: [bashFailure("b1"), bashFailure("b2")],
  });
  return runRuleEngine({ project: fixture.project, sessionResults: [session] }).find((item) => item.detectorId === "R-0001");
}

function parserCandidate(fixture, code) {
  const session = writeCachedSession(fixture, {
    fileKey: `parser-${code}`,
    events: [],
    warnings: [{ sessionId: "session", entryId: "w1", code, message: code, timestamp: "2026-06-14T00:00:00.000Z" }],
  });
  return runRuleEngine({ project: fixture.project, sessionResults: [session] }).find((item) => item.detectorId === "R-0004");
}

function writeCachedSession(fixture, { events, warnings = [], fileKey = "session", sourceFingerprint = fingerprint(fileKey) }) {
  const dir = path.join(fixture.root, ".cache-fixtures", fileKey);
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, "events.jsonl");
  const warningsPath = path.join(dir, "warnings.jsonl");
  fs.writeFileSync(eventsPath, events.map((event) => JSON.stringify({
    schemaVersion: 1,
    projectKey: fixture.project.projectKey,
    sessionId: "session",
    activePath: true,
    timestamp: "2026-06-14T00:00:00.000Z",
    safety: { sensitivePath: false, secretDetected: false },
    ...event,
  })).join("\n") + (events.length ? "\n" : ""));
  fs.writeFileSync(warningsPath, warnings.map((warning) => JSON.stringify(warning)).join("\n") + (warnings.length ? "\n" : ""));
  return { sessionId: "session", sourceFingerprint, paths: { events: eventsPath, warnings: warningsPath }, warnings };
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function toolError(entryId, toolName, excerpt) {
  return { eventId: `${entryId}-event`, entryId, kind: "tool_result", summary: `${toolName} failed`, excerpt, tool: { name: toolName, isError: true } };
}

function bashFailure(entryId) {
  return { eventId: `${entryId}-event`, entryId, kind: "bash_execution", summary: "npm test failed", bash: { command: "npm test", exitCode: 1 } };
}

function write(fixture, route, content, options) {
  const file = path.join(fixture.root, ...route.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, options);
}
