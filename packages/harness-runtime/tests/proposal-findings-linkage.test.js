import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { approve, history as apiHistory, proposals as apiProposals } from "../src/api.js";
import { writeFindingsLedger, readFindingsLedger } from "../src/findings/ledger.js";
import { resolveProject } from "../src/project/resolve-project.js";
import { approveProposal, applyProposal, readProposalHistory, rejectProposal } from "../src/proposals/lifecycle.js";
import { renderProposalMarkdown, readDraftProposals, writeDraftProposals } from "../src/proposals/proposal-writer.js";

test("bound proposal finding frontmatter renders and reads with its expected revision", () => {
  const fixture = createFixture();
  const result = writeDraftProposals({
    config: fixture.config,
    project: fixture.project,
    proposals: [baseProposal({ findingId: "F-0001", expectedFindingRevision: 0 })],
  });
  const markdown = fs.readFileSync(result.written[0].filePath, "utf8");
  const read = readDraftProposals({ config: fixture.config, project: fixture.project })[0];

  assert.match(markdown, /finding_id: F-0001/);
  assert.match(markdown, /expected_finding_revision: 0/);
  assert.equal(read.findingId, "F-0001");
  assert.equal(read.expectedFindingRevision, 0);
});

test("legacy proposals without finding linkage remain readable and applicable", () => {
  const fixture = createFixture();
  const proposal = writeProposalWithPatch(fixture);

  const read = readDraftProposals({ config: fixture.config, project: fixture.project })[0];
  assert.equal(Object.hasOwn(read, "findingId"), false);
  assert.equal(Object.hasOwn(read, "expectedFindingRevision"), false);

  const approved = approveProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  const applied = applyProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  assert.equal(approved.proposal.status, "approved");
  assert.equal(applied.proposal.status, "applied");
});

test("valid bound proposal can be approved and applied without changing finding state", () => {
  const fixture = createFixture();
  writeFindingsLedger({ config: fixture.config, project: fixture.project, findings: [validFinding()] });
  const proposal = writeProposalWithPatch(fixture, { findingId: "F-0001", expectedFindingRevision: 0 });

  const approved = approveProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  const applied = applyProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  const finding = readFindingsLedger({ config: fixture.config, project: fixture.project }).findings[0];

  assert.equal(approved.proposal.status, "approved");
  assert.equal(applied.proposal.status, "applied");
  assert.equal(finding.revision, 0);
  assert.equal(finding.status, "open");
  assert.equal(finding.evidenceState, "Missing");
});

test("missing finding fails closed at approval with a stable error code", () => {
  const fixture = createFixture();
  const proposal = writeProposalWithPatch(fixture, { findingId: "F-0001", expectedFindingRevision: 0 });

  assert.throws(
    () => approveProposal({ config: fixture.config, project: fixture.project, id: proposal.id }),
    { code: "PROPOSAL_FINDING_MISSING" },
  );
});

test("stale finding revision fails at approval with a stable error code", () => {
  const fixture = createFixture();
  writeFindingsLedger({ config: fixture.config, project: fixture.project, findings: [validFinding()] });
  const proposal = writeProposalWithPatch(fixture, { findingId: "F-0001", expectedFindingRevision: 0 });
  writeFindingsLedger({ config: fixture.config, project: fixture.project, findings: [validFinding({ reason: "changed after draft" })] });

  assert.throws(
    () => approveProposal({ config: fixture.config, project: fixture.project, id: proposal.id }),
    { code: "PROPOSAL_FINDING_REVISION_STALE" },
  );
});

test("finding revision is checked again before apply after approval", () => {
  const fixture = createFixture();
  writeFindingsLedger({ config: fixture.config, project: fixture.project, findings: [validFinding()] });
  const proposal = writeProposalWithPatch(fixture, { findingId: "F-0001", expectedFindingRevision: 0 });
  approveProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  writeFindingsLedger({ config: fixture.config, project: fixture.project, findings: [validFinding({ reason: "changed after approval" })] });

  assert.throws(
    () => applyProposal({ config: fixture.config, project: fixture.project, id: proposal.id }),
    { code: "PROPOSAL_FINDING_REVISION_STALE" },
  );
  assert.equal(fs.readFileSync(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"), "# Notes\n\nExisting note.\n");
});

test("rejecting a stale bound proposal does not mutate its finding", () => {
  const fixture = createFixture();
  writeFindingsLedger({ config: fixture.config, project: fixture.project, findings: [validFinding()] });
  const proposal = writeProposalWithPatch(fixture, { findingId: "F-0001", expectedFindingRevision: 0 });
  writeFindingsLedger({ config: fixture.config, project: fixture.project, findings: [validFinding({ reason: "changed before rejection" })] });
  const before = readFindingsLedger({ config: fixture.config, project: fixture.project }).findings[0];

  const rejected = rejectProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  const after = readFindingsLedger({ config: fixture.config, project: fixture.project }).findings[0];
  assert.equal(rejected.proposal.status, "rejected");
  assert.deepEqual(after, before);
});

test("public proposal summaries and history omit private paths and evidence content", () => {
  const fixture = createFixture();
  const proposal = writeDraftProposals({
    config: fixture.config,
    project: fixture.project,
    proposals: [baseProposal({
      evidence: [{ sessionFile: "/tmp/private-session.jsonl", excerpt: "PRIVATE_EVIDENCE_CONTENT", sessionId: "private-session" }],
    })],
  }).written[0];
  const list = apiProposals({ project: fixture.projectRoot, harnessHome: fixture.harnessHome });
  approve({ project: fixture.projectRoot, harnessHome: fixture.harnessHome, id: proposal.id });
  const lifecycleHistory = apiHistory({ project: fixture.projectRoot, harnessHome: fixture.harnessHome, id: proposal.id });
  const text = JSON.stringify({ list, lifecycleHistory });

  assert.doesNotMatch(text, /private-session|PRIVATE_EVIDENCE_CONTENT|private-session\.jsonl|filePath|\/tmp\//);
  assert.equal(Object.hasOwn(list.proposals[0], "filePath"), false);
  assert.equal(Object.hasOwn(lifecycleHistory.history[0], "filePath"), false);
});

test("invalid binding shape is rejected with a stable error code", () => {
  assert.throws(
    () => renderProposalMarkdown(baseProposal({ findingId: "F-0001" })),
    { code: "PROPOSAL_FINDING_INVALID" },
  );
  assert.throws(
    () => renderProposalMarkdown(baseProposal({ findingId: "not-a-finding", expectedFindingRevision: 0 })),
    { code: "PROPOSAL_FINDING_INVALID" },
  );
  assert.throws(
    () => renderProposalMarkdown(baseProposal({ findingId: "F-0001", expectedFindingRevision: -1 })),
    { code: "PROPOSAL_FINDING_INVALID" },
  );
});

function writeProposalWithPatch(fixture, binding = {}) {
  const proposal = writeDraftProposals({
    config: fixture.config,
    project: fixture.project,
    proposals: [baseProposal(binding)],
  }).written[0];
  fs.appendFileSync(proposal.filePath, `\n## Patch\n\`\`\`json\n${JSON.stringify([{ path: "AGENTS.md", oldText: "Existing note.", newText: "Existing note.\n- Use exact oldText before edit." }])}\n\`\`\`\n`);
  return proposal;
}

function baseProposal(overrides = {}) {
  return {
    ruleId: "R-test",
    title: "Patch AGENTS note",
    target: "agents",
    targetFiles: ["AGENTS.md"],
    risk: "low",
    problem: "Need edit guidance.",
    proposedChange: "Add edit guidance.",
    testPlan: [],
    rollbackPlan: "Rollback git checkout.",
    evidence: [],
    fingerprint: `linkage-${Math.random()}`,
    ...overrides,
  };
}

function validFinding(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "F-0001",
    title: "Specific observed consequence",
    status: "open",
    dimension: "change-validation",
    check: "relevant-verification",
    evidenceState: "Missing",
    confidence: "medium",
    impact: "The gap can leave a change without a comparable check.",
    reason: "The supplied evidence boundary confirms the required mechanism is absent.",
    target: { kind: "repo-root", packageRoute: ".", ownerRoute: "." },
    evidenceRefs: [],
    expectedOutcome: "A bounded relevant verification is recorded.",
    acceptanceChecks: ["relevant-verification"],
    proposalRefs: [],
    ...overrides,
  };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-proposal-findings-"));
  const projectRoot = path.join(root, "project");
  const harnessHome = path.join(root, "harness-home");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Notes\n\nExisting note.\n");
  git(projectRoot, ["init"]);
  git(projectRoot, ["config", "user.email", "test@example.com"]);
  git(projectRoot, ["config", "user.name", "Harness Test"]);
  git(projectRoot, ["add", "."]);
  git(projectRoot, ["commit", "-m", "initial"]);
  return {
    root,
    projectRoot,
    harnessHome,
    config: { harnessHome },
    project: resolveProject(projectRoot),
  };
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
