import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beginCandidateReviewAttempt,
  candidateReviewReceiptPath,
  finalizeCandidateReviewAttempt,
} from "../src/storage/candidate-review-writer.js";

const SELECTED_FINGERPRINT = "a".repeat(64);
const SOURCE_FINGERPRINT = "b".repeat(64);

test("pending receipt retains bounded CandidateSignal audit and final proposal identity", () => {
  const fixture = createFixture();
  const review = createReview();
  const attempt = beginCandidateReviewAttempt({
    ...fixture,
    analysisRun: fixture.analysisRun,
    mode: "target:rules",
    review,
    now: new Date("2026-06-14T00:00:00.000Z"),
  });
  const pending = JSON.parse(fs.readFileSync(attempt.receiptPath, "utf8"));

  assert.equal(fs.statSync(attempt.receiptPath).mode & 0o777, 0o600);
  assert.equal(pending.attemptStatus, "pending-proposal-write");
  assert.equal(pending.candidates[0].count, 2);
  assert.deepEqual(pending.candidates[0].signal, { toolName: "edit", errorKind: "oldText_mismatch" });
  assert.equal(pending.candidates[0].requiredReview.includes("existing-coverage"), true);
  assert.equal(pending.candidates[0].evidenceRefs.length, 2);
  assert.equal(pending.candidates[0].evidenceRefs[0].sourceFingerprint, SOURCE_FINGERPRINT);
  assert.equal(JSON.stringify(pending).includes("excerpt"), false);
  assert.equal(JSON.stringify(pending).includes(fixture.root), false);

  const finalized = finalizeCandidateReviewAttempt({
    attempt,
    ...fixture,
    analysisRun: fixture.analysisRun,
    mode: "target:rules",
    review,
    writeResult: {
      written: [{ id: "P-0001", candidateId: review.candidates[0].id, fingerprint: "proposal-fp", status: "draft" }],
      skipped: [],
    },
    now: new Date("2026-06-14T00:00:01.000Z"),
  });
  const receipt = JSON.parse(fs.readFileSync(finalized.receiptPath, "utf8"));

  assert.equal(fs.statSync(finalized.receiptPath).mode & 0o777, 0o600);
  assert.equal(receipt.attemptStatus, "complete");
  assert.deepEqual(receipt.reviews[0].proposal, { id: "P-0001", fingerprint: "proposal-fp", status: "draft", writeStatus: "written" });
  assert.equal(fs.readdirSync(path.dirname(finalized.receiptPath)).some((name) => name.includes(".tmp-")), false);
});

test("same-run same-mode attempts are append-only and retain written then skipped status", () => {
  const fixture = createFixture();
  const review = createReview();
  const first = beginCandidateReviewAttempt({ ...fixture, analysisRun: fixture.analysisRun, mode: "rules", review });
  finalizeCandidateReviewAttempt({
    attempt: first,
    ...fixture,
    analysisRun: fixture.analysisRun,
    mode: "rules",
    review,
    writeResult: { written: [{ id: "P-0001", candidateId: review.candidates[0].id, fingerprint: "proposal-fp", status: "draft" }], skipped: [] },
  });
  const second = beginCandidateReviewAttempt({ ...fixture, analysisRun: fixture.analysisRun, mode: "rules", review });
  finalizeCandidateReviewAttempt({
    attempt: second,
    ...fixture,
    analysisRun: fixture.analysisRun,
    mode: "rules",
    review,
    writeResult: { written: [], skipped: [{ id: "P-0001", candidateId: review.candidates[0].id, fingerprint: "proposal-fp", status: "draft", reason: "duplicate_fingerprint" }] },
  });

  assert.notEqual(first.attemptId, second.attemptId);
  assert.equal(fs.existsSync(first.receiptPath), true);
  assert.equal(fs.existsSync(second.receiptPath), true);
  const firstReceipt = JSON.parse(fs.readFileSync(first.receiptPath, "utf8"));
  const secondReceipt = JSON.parse(fs.readFileSync(second.receiptPath, "utf8"));
  assert.equal(firstReceipt.reviews[0].proposal.writeStatus, "written");
  assert.equal(secondReceipt.reviews[0].proposal.writeStatus, "skipped");
  assert.equal(fs.readdirSync(path.dirname(first.receiptPath)).filter((name) => name.endsWith(".json")).length, 2);
});

test("finalize failure leaves the pending receipt durable", () => {
  const fixture = createFixture();
  const review = createReview();
  const attempt = beginCandidateReviewAttempt({ ...fixture, analysisRun: fixture.analysisRun, mode: "rules", review });
  const originalRename = fs.renameSync;
  fs.renameSync = () => {
    const error = new Error("simulated finalize rename failure");
    error.code = "EIO";
    throw error;
  };
  try {
    assert.throws(
      () => finalizeCandidateReviewAttempt({
        attempt,
        ...fixture,
        analysisRun: fixture.analysisRun,
        mode: "rules",
        review,
        writeResult: { written: [], skipped: [] },
      }),
      /simulated finalize rename failure/,
    );
  } finally {
    fs.renameSync = originalRename;
  }

  const pending = JSON.parse(fs.readFileSync(attempt.receiptPath, "utf8"));
  assert.equal(pending.attemptStatus, "pending-proposal-write");
  assert.equal(pending.attemptId, attempt.attemptId);
  assert.deepEqual(tempReceiptFiles(attempt.receiptPath), []);
});

test("finalize write failure preserves 0600 pending receipt and removes temp", () => {
  const fixture = createFixture();
  const review = createReview();
  const attempt = beginCandidateReviewAttempt({ ...fixture, analysisRun: fixture.analysisRun, mode: "rules", review });
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = () => {
    const error = new Error("simulated finalize write failure");
    error.code = "EIO";
    throw error;
  };
  try {
    assert.throws(
      () => finalizeCandidateReviewAttempt({
        attempt,
        ...fixture,
        analysisRun: fixture.analysisRun,
        mode: "rules",
        review,
        writeResult: { written: [], skipped: [] },
      }),
      /simulated finalize write failure/,
    );
  } finally {
    fs.writeFileSync = originalWrite;
  }

  assert.equal(fs.statSync(attempt.receiptPath).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(attempt.receiptPath, "utf8")).attemptStatus, "pending-proposal-write");
  assert.deepEqual(tempReceiptFiles(attempt.receiptPath), []);
});

test("R-0001 receipt signal stores only safe class and hash", () => {
  const unsafeCommands = [
    "/opt/private/fixture-bin/tool --version",
    "curl --credential=fixture-secret",
    "curl https://fixture-user:fixture-url-secret@example.com/path",
    "curl sk-abcdefghijklmnopqrstuvwxyz0123456789",
    "API_TOKEN=fixture-assignment-secret npm test",
  ];
  const forbidden = [
    "/opt/private/fixture-bin/tool",
    "fixture-secret",
    "fixture-user:fixture-url-secret",
    "sk-abcdefghijklmnopqrstuvwxyz0123456789",
    "API_TOKEN",
    "fixture-assignment-secret",
  ];

  for (const commandFamily of unsafeCommands) {
    const fixture = createFixture();
    const review = createBashReview(commandFamily);
    const attempt = beginCandidateReviewAttempt({ ...fixture, analysisRun: fixture.analysisRun, mode: "rules", review });
    const serialized = fs.readFileSync(attempt.receiptPath, "utf8");
    const signal = JSON.parse(serialized).candidates[0].signal;

    assert.deepEqual(Object.keys(signal).sort(), ["commandClass", "commandFingerprint"]);
    assert.match(signal.commandFingerprint, /^[a-f0-9]{64}$/);
    for (const value of forbidden) assert.equal(serialized.includes(value), false, value);
  }
});

test("attempt paths reject traversal and explicit collisions", () => {
  const fixture = createFixture();
  const review = createReview();
  assert.throws(
    () => candidateReviewReceiptPath({ ...fixture, runId: fixture.analysisRun.runId, mode: "rules", attemptId: "../../escape" }),
    /Invalid candidate review attempt id/,
  );

  const attemptId = "attempt-20260614000000000-fixed-collision";
  beginCandidateReviewAttempt({ ...fixture, analysisRun: fixture.analysisRun, mode: "rules", review, attemptId });
  assert.throws(
    () => beginCandidateReviewAttempt({ ...fixture, analysisRun: fixture.analysisRun, mode: "rules", review, attemptId }),
    (error) => error.code === "EEXIST",
  );
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-review-receipt-"));
  return {
    root,
    config: { harnessHome: path.join(root, "home") },
    project: { projectKey: "project-test" },
    analysisRun: { runId: "run-receipt-test", selection: { selectedFingerprint: SELECTED_FINGERPRINT } },
  };
}

function tempReceiptFiles(receiptPath) {
  return fs.readdirSync(path.dirname(receiptPath)).filter((name) => name.includes(".tmp-"));
}

function createBashReview(commandFamily) {
  const review = createReview();
  review.candidates[0] = {
    ...review.candidates[0],
    detectorId: "R-0001",
    kind: "repeated-bash-failure",
    signal: { commandFamily },
  };
  review.decisions[0] = { ...review.decisions[0], detectorId: "R-0001" };
  return review;
}

function createReview() {
  const candidateId = "candidate-1234567890abcdef12345678";
  const evidenceRefs = ["e1", "e2"].map((entryId) => ({
    sourceFingerprint: SOURCE_FINGERPRINT,
    sessionId: "s1",
    entryId,
    eventId: `${entryId}-event`,
    kind: "tool_result",
    timestamp: "2026-06-14T00:00:00.000Z",
  }));
  return {
    candidates: [{
      schemaVersion: 1,
      id: candidateId,
      detectorId: "R-0002",
      kind: "repeated-tool-error",
      status: "lead",
      scope: { authority: { project: true, userHome: false }, ownerRoutes: ["wiki/_rules.md"] },
      signal: { toolName: "edit", errorKind: "oldText_mismatch" },
      count: 2,
      evidenceRefs,
      likelyDimensions: ["controlled-execution"],
      requiredReview: ["existing-coverage", "task-consequence", "smallest-owner", "validation-route"],
    }],
    assetLane: {
      status: "complete",
      assets: [{ route: "wiki/_rules.md", type: "wiki-rules", state: "opened", digest: "digest-1", blocks: [{ sectionId: "GLOBAL-EDIT-001" }] }],
      diagnostics: [],
    },
    decisions: [{
      candidateId,
      detectorId: "R-0002",
      state: "promoted",
      observedUse: "unobserved",
      reviewFingerprint: "review-fp",
      coverage: { state: "not-covered", matches: [] },
      ownerRoutes: ["wiki/_rules.md"],
      validationRoute: "npm test",
      diagnostics: [],
    }],
  };
}
