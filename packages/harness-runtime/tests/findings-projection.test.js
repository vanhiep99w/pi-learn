import test from "node:test";
import assert from "node:assert/strict";
import { createFindingsProjection } from "../src/findings/projection.js";
import { generateProjectReport } from "../src/report/report.js";

test("empty Findings projection is explicit, reader-safe, and does not imply a score", () => {
  const projection = createFindingsProjection(ledger([]));

  assert.equal(projection.kind, "pi-harness.findings-projection");
  assert.deepEqual(projection.boundary, {
    canonical: false,
    source: "private-findings-ledger",
    readerSafe: true,
    scores: false,
    inference: false,
  });
  assert.deepEqual(projection.counts, {
    total: 0,
    active: 0,
    completed: 0,
    displayed: 0,
    omitted: 0,
    byStatus: { open: 0, repairing: 0, verified: 0, partial: 0, blocked: 0, closed: 0 },
    byEvidenceState: {
      Present: 0,
      Wired: 0,
      Exercised: 0,
      "Outcome-supported": 0,
      Missing: 0,
      Unobserved: 0,
      "Not-applicable": 0,
    },
  });
  assert.match(projection.markdown, /Zero findings is valid/);
  assert.match(projection.markdown, /does not imply a passing score or successful outcome/);
});

test("Findings Markdown shows required reader fields and orders active records before completed records", () => {
  const completed = validFinding({
    id: "F-0001",
    title: "Completed repair",
    status: "verified",
    evidenceState: "Outcome-supported",
    confidence: "high",
    proposalRefs: ["P-0001"],
  });
  const active = validFinding({
    id: "F-0002",
    title: "Missing verification",
    status: "open",
    evidenceState: "Missing",
    confidence: "medium",
    proposalRefs: ["P-0002", "P-0003"],
  });
  const projection = createFindingsProjection(ledger([completed, active], {
    status: "recovered",
    ledgerRevision: 3,
    diagnostics: ["latest_stale_recovered_from_history"],
  }));

  assert.equal(projection.counts.active, 1);
  assert.equal(projection.counts.completed, 1);
  assert.equal(projection.counts.byEvidenceState.Missing, 1);
  assert.ok(projection.markdown.indexOf("F-0002") < projection.markdown.indexOf("F-0001"));
  assert.match(projection.markdown, /Repair status.*`open`/);
  assert.match(projection.markdown, /Evidence.*`Missing`/);
  assert.match(projection.markdown, /Confidence.*`medium`/);
  assert.match(projection.markdown, /Impact:/);
  assert.match(projection.markdown, /Expected outcome:/);
  assert.match(projection.markdown, /Smallest owner.*`packages\/harness-runtime`/);
  assert.match(projection.markdown, /Acceptance checks.*`npm-test`/);
  assert.match(projection.markdown, /Linked proposals.*`P-0002`.*`P-0003`/);
  assert.match(projection.markdown, /latest_stale_recovered_from_history/);
  assert.doesNotMatch(projection.markdown, /score:\s*\d|maturity score/i);
});

test("Findings projection re-applies reader redaction and bounds Markdown presentation", () => {
  const findings = Array.from({ length: 65 }, (_, index) => validFinding({
    id: `F-${String(index + 1).padStart(4, "0")}`,
    title: `Finding ${index + 1}`,
    reason: index === 0
      ? "Observed at /home/private/project/.env rawRef=/home/private/session.jsonl"
      : `Bounded reason ${index + 1}`,
    evidenceRefs: index === 0
      ? [{ kind: "inspection", route: "packages/harness-runtime", privateRef: "/home/private/raw.jsonl", content: "PRIVATE_EVIDENCE" }]
      : [],
  }));
  const projection = createFindingsProjection(ledger(findings));
  const text = JSON.stringify(projection);

  assert.equal(projection.counts.displayed, 64);
  assert.equal(projection.counts.omitted, 1);
  assert.match(projection.markdown, /Showing 64\/65 findings/);
  assert.doesNotMatch(text, /\/home\/private|PRIVATE_EVIDENCE|session\.jsonl|raw\.jsonl|\.env/);
  assert.match(projection.markdown, /<absolute-path>|private-locator/);
});

test("project report embeds the exact Findings Markdown projection and removes the stale phase gate", () => {
  const projection = createFindingsProjection(ledger([validFinding()]));
  const report = generateProjectReport({
    project: { projectKey: "fixture", projectRoot: "/private/fixture" },
    results: [],
    findingsProjection: projection,
    generatedAt: new Date("2026-01-02T00:00:00.000Z"),
  });

  assert.match(report, /Findings ledger: complete at revision 1/);
  assert.ok(report.includes(projection.markdown.trimEnd()));
  assert.match(report, /Report Evidence Boundary/);
  assert.doesNotMatch(report, /Next Phase Gate|Phase 5 rules\/proposals should start/);
});

test("Findings projection rejects non-reader ledgers and count mismatches", () => {
  assert.throws(() => createFindingsProjection({}), { code: "FINDINGS_PROJECTION_INVALID" });
  assert.throws(() => createFindingsProjection({ ...ledger([validFinding()]), counts: { total: 0 } }), {
    code: "FINDINGS_PROJECTION_INVALID",
  });
});

function ledger(findings, overrides = {}) {
  return {
    kind: "pi-harness.findings",
    schemaVersion: 1,
    status: findings.length ? "complete" : "empty",
    authority: { project: true, userHome: false },
    ledgerRevision: findings.length ? 1 : 0,
    counts: { total: findings.length },
    findings,
    diagnostics: [],
    ...overrides,
  };
}

function validFinding(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "F-0001",
    revision: 0,
    title: "Specific observed consequence",
    status: "open",
    dimension: "change-validation",
    check: "relevant-verification",
    evidenceState: "Unobserved",
    confidence: "medium",
    impact: "The gap can leave a change without a comparable check.",
    reason: "The supplied evidence boundary does not claim exercise or outcome.",
    target: {
      kind: "workspace-member",
      packageRoute: "packages/harness-runtime",
      ownerRoute: "packages/harness-runtime",
    },
    evidenceRefs: [],
    expectedOutcome: "A bounded relevant verification is recorded.",
    acceptanceChecks: ["npm-test"],
    proposalRefs: [],
    ...overrides,
  };
}
