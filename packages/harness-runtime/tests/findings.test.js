import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EVIDENCE_STATES,
  EvidenceState,
  findings,
  normalizeEvidenceState,
  readFindings,
  writeFindings,
} from "../src/api.js";
import { findingsPaths } from "../src/findings/ledger.js";
import { dedupeFindings, findingIdentity, validateFinding, validateFindingSet } from "../src/findings/schema.js";

test("evidence state model exposes exactly the seven states and rejects inference aliases", () => {
  assert.deepEqual(EVIDENCE_STATES, [
    "Present",
    "Wired",
    "Exercised",
    "Outcome-supported",
    "Missing",
    "Unobserved",
    "Not-applicable",
  ]);
  for (const state of EVIDENCE_STATES) assert.equal(normalizeEvidenceState(state), state);
  assert.equal(EvidenceState.PRESENT, "Present");
  assert.throws(() => normalizeEvidenceState("present"), { code: "INVALID_EVIDENCE_STATE" });
  assert.throws(() => normalizeEvidenceState("Selected"), { code: "INVALID_EVIDENCE_STATE" });
});

test("finding schema validates stable ids, schema, status, confidence, and project-relative targets", () => {
  const finding = validFinding();
  assert.equal(validateFinding(finding).id, "F-0001");
  assert.throws(() => validateFinding({ ...finding, id: "F-1" }), { code: "INVALID_FINDING_ID" });
  assert.throws(() => validateFinding({ ...finding, schemaVersion: 2 }), { code: "INVALID_FINDING_SCHEMA" });
  assert.throws(() => validateFinding({ ...finding, status: "rejected" }), { code: "INVALID_FINDING_FIELD" });
  assert.throws(() => validateFinding({ ...finding, confidence: "certain" }), { code: "INVALID_FINDING_FIELD" });
  assert.throws(() => validateFinding({ ...finding, target: { kind: "workspace-member", packageRoute: "/private/project", ownerRoute: "." } }), { code: "INVALID_FINDING_TARGET" });
  assert.throws(() => validateFinding({ ...finding, target: { kind: "workspace-member", packageRoute: "../outside", ownerRoute: "." } }), { code: "INVALID_FINDING_TARGET" });
});

test("all finding evidence states remain caller-supplied and Missing is distinct from Unobserved", () => {
  const states = EVIDENCE_STATES.map((evidenceState, index) => validFinding({ id: `F-${String(index + 1).padStart(4, "0")}`, evidenceState }));
  const normalized = states.map((finding) => validateFinding(finding));
  assert.deepEqual(normalized.map((finding) => finding.evidenceState), EVIDENCE_STATES);
  assert.notEqual(normalized.find((finding) => finding.evidenceState === "Missing").evidenceState, "Unobserved");
  assert.equal(normalized.find((finding) => finding.evidenceState === "Unobserved").evidenceState, "Unobserved");
});

test("finding identity and dedupe are deterministic, while multiple proposals remain attached", () => {
  const first = validFinding({ proposalRefs: ["P-0002", "P-0001"] });
  const second = validFinding({ proposalRefs: ["P-0003"] });
  assert.equal(findingIdentity(first), findingIdentity({ ...first, proposalRefs: ["P-0001"] }));
  const deduped = dedupeFindings([first, second]);
  assert.equal(deduped.length, 1);
  assert.deepEqual(deduped[0].proposalRefs, ["P-0001", "P-0002", "P-0003"]);
});

test("missing storage is an honest empty reader result and does not inspect user-home/raw session paths", () => {
  const fixture = createFixture();
  const outside = path.join(fixture.root, "user-home");
  fs.mkdirSync(path.join(outside, ".pi", "agent", "sessions"), { recursive: true });
  fs.writeFileSync(path.join(outside, ".pi", "agent", "sessions", "raw.jsonl"), "PRIVATE_RAW_PROMPT\n");

  const output = readFindings(options(fixture));
  assert.equal(output.kind, "pi-harness.findings");
  assert.equal(output.status, "empty");
  assert.deepEqual(output.authority, { project: true, userHome: false });
  assert.deepEqual(output.findings, []);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_RAW_PROMPT|agent\/sessions|user-home/);
  assert.equal(fs.existsSync(fixture.harnessHome), false);
});

test("write/read persists private latest and append-only history with owner-only modes and revisions", () => {
  const fixture = createFixture();
  const first = writeFindings({ ...options(fixture), findings: [validFinding({ proposalRefs: ["P-0001"] })] });
  assert.equal(first.findings[0].revision, 0);
  assert.equal(first.write.status, "written");

  const second = writeFindings({ ...options(fixture), findings: [validFinding({ reason: "changed fact", proposalRefs: ["P-0002"] })] });
  assert.equal(second.findings[0].revision, 1);
  assert.deepEqual(second.findings[0].proposalRefs, ["P-0001", "P-0002"]);
  assert.equal(second.findings[0].status, "open");
  assert.equal(second.findings[0].evidenceState, "Unobserved");

  const paths = findingsPaths({ config: { harnessHome: fixture.harnessHome }, project: resolveProjectForFixture(fixture) });
  assert.equal(fs.statSync(paths.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(paths.latestPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.historyPath).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(paths.historyPath, "utf8").trim().split("\n").length, 2);
  assert.equal(readFindings(options(fixture)).findings[0].revision, 1);
  assert.equal(findings(options(fixture)).findings[0].id, "F-0001");

  fs.unlinkSync(paths.latestPath);
  assert.equal(readFindings(options(fixture)).status, "recovered");
  assert.equal(writeFindings({ ...options(fixture), findings: [validFinding({ reason: "changed fact", proposalRefs: ["P-0001", "P-0002"] })] }).write.status, "recovered");
  assert.equal(fs.existsSync(paths.latestPath), true);

  const unchanged = writeFindings({ ...options(fixture), findings: [validFinding({ reason: "changed fact", proposalRefs: ["P-0001"] })] });
  assert.equal(unchanged.write.status, "unchanged");
  assert.equal(fs.readFileSync(paths.historyPath, "utf8").trim().split("\n").length, 2);
});

test("reader-safe projection excludes absolute/private evidence paths and content", () => {
  const fixture = createFixture();
  const output = writeFindings({
    ...options(fixture),
    findings: [validFinding({
      reason: "Observed at /home/secret/project/.env rawRef=/home/secret/session.jsonl",
      evidenceRefs: [{ kind: "inspection", route: "packages/x", privateRef: "/home/secret/raw.jsonl", content: "PRIVATE_EVIDENCE" }],
    })],
  });
  const text = JSON.stringify(output);
  assert.doesNotMatch(text, /\/home\/secret|PRIVATE_EVIDENCE|raw\.jsonl|\.env/);
  assert.deepEqual(output.findings[0].evidenceRefs, [{ kind: "inspection", route: "packages/x" }]);
  assert.equal(output.findings[0].reason.includes("<absolute-path>"), true);
  assert.equal(Object.hasOwn(output, "paths"), false);
  assert.equal(Object.hasOwn(output, "project"), false);
});

test("malformed, tampered, symlinked, and oversized private storage fails closed", () => {
  const fixture = createFixture();
  writeFindings({ ...options(fixture), findings: [validFinding()] });
  const project = resolveProjectForFixture(fixture);
  const paths = findingsPaths({ config: { harnessHome: fixture.harnessHome }, project });

  fs.writeFileSync(paths.latestPath, "{malformed", { mode: 0o600 });
  assert.throws(() => readFindings(options(fixture)), { code: "FINDINGS_STORAGE_TAMPERED" });

  fs.unlinkSync(paths.latestPath);
  writeFindings({ ...options(fixture), findings: [validFinding({ reason: "repair" })] });
  fs.unlinkSync(paths.latestPath);
  fs.symlinkSync(paths.historyPath, paths.latestPath);
  assert.throws(() => readFindings(options(fixture)), { code: "FINDINGS_STORAGE_UNSAFE" });

  fs.unlinkSync(paths.latestPath);
  fs.writeFileSync(paths.latestPath, "x".repeat(4 * 1024 * 1024 + 1), { mode: 0o600 });
  assert.throws(() => readFindings(options(fixture)), { code: "FINDINGS_STORAGE_LIMIT" });
});

function validFinding(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "F-0001",
    title: "Specific observed consequence",
    status: "open",
    dimension: "change-validation",
    check: "relevant-verification",
    evidenceState: "Unobserved",
    confidence: "medium",
    impact: "The gap can leave a change without a comparable check.",
    reason: "The supplied evidence boundary does not claim exercise or outcome.",
    target: { kind: "workspace-member", packageRoute: "packages/harness-runtime", ownerRoute: "packages/harness-runtime" },
    evidenceRefs: [],
    expectedOutcome: "A bounded relevant verification is recorded.",
    acceptanceChecks: ["relevant-verification"],
    proposalRefs: [],
    ...overrides,
  };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-findings-"));
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  return { root, project, harnessHome: path.join(root, "harness") };
}

function options(fixture) {
  return { project: fixture.project, harnessHome: fixture.harnessHome };
}

function resolveProjectForFixture(fixture) {
  return { projectKey: JSON.parse(fs.readFileSync(path.join(fixture.harnessHome, "projects", fs.readdirSync(path.join(fixture.harnessHome, "projects"))[0], "findings", "latest.json"), "utf8")).projectKey };
}
