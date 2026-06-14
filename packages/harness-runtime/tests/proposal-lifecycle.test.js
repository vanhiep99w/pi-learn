import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeDraftProposals, findDraftProposal } from "../src/proposals/proposal-writer.js";
import { approveProposal, applyProposal, parsePatchSection, parseTargetFiles, readProposalHistory, rejectProposal, rollbackProposal } from "../src/proposals/lifecycle.js";

test("approveProposal and rejectProposal update status and append history", () => {
  const fixture = createLifecycleFixture();
  const written = writeProposalWithPatch(fixture);

  const approved = approveProposal({ config: fixture.config, project: fixture.project, id: written.id });
  assert.equal(approved.proposal.status, "approved");

  const rejected = rejectProposal({ config: fixture.config, project: fixture.project, id: written.id });
  assert.equal(rejected.proposal.status, "rejected");

  const history = readProposalHistory({ config: fixture.config, project: fixture.project, id: written.id });
  assert.deepEqual(history.map((event) => event.event), ["proposal_approved", "proposal_rejected"]);
  assert.equal(findDraftProposal({ config: fixture.config, project: fixture.project, id: written.id }).status, "rejected");
});

test("parseTargetFiles and parsePatchSection read machine-applicable patch", () => {
  const markdown = `## Target files\n- AGENTS.md\n\n## Patch\n\`\`\`json\n[{"path":"AGENTS.md","oldText":"old","newText":"new"}]\n\`\`\`\n`;

  assert.deepEqual(parseTargetFiles(markdown), ["AGENTS.md"]);
  assert.deepEqual(parsePatchSection(markdown), [{ path: "AGENTS.md", oldText: "old", newText: "new" }]);
});

test("applyProposal requires approved status and machine patch", () => {
  const fixture = createLifecycleFixture();
  const written = writeProposalWithPatch(fixture);

  assert.throws(
    () => applyProposal({ config: fixture.config, project: fixture.project, id: written.id, skipTests: true }),
    /must be approved/,
  );
});

test("applyProposal applies only target files and rollback restores uncommitted patch", () => {
  const fixture = createLifecycleFixture();
  const written = writeProposalWithPatch(fixture);
  approveProposal({ config: fixture.config, project: fixture.project, id: written.id });

  const applied = applyProposal({ config: fixture.config, project: fixture.project, id: written.id, skipTests: true });
  assert.equal(applied.proposal.status, "applied");
  assert.equal(applied.branchName, `harness/${written.id}`);
  assert.deepEqual(applied.changedPaths, ["AGENTS.md"]);
  assert.match(fs.readFileSync(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"), /Use exact oldText/);

  const status = git(fixture.projectRoot, ["status", "--porcelain"]);
  assert.match(status.stdout, /AGENTS\.md/);

  const rolledBack = rollbackProposal({ config: fixture.config, project: fixture.project, id: written.id });
  assert.equal(rolledBack.proposal.status, "rolled_back");
  assert.doesNotMatch(fs.readFileSync(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"), /Use exact oldText/);

  const history = readProposalHistory({ config: fixture.config, project: fixture.project, id: written.id });
  assert.deepEqual(history.map((event) => event.event), ["proposal_approved", "proposal_applied", "proposal_rolled_back"]);
});

function createLifecycleFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-lifecycle-"));
  const projectRoot = path.join(root, "project");
  const harnessHome = path.join(root, "harness-home");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Notes\n\nExisting note.\n");
  git(projectRoot, ["init"]);
  git(projectRoot, ["config", "user.email", "test@example.com"]);
  git(projectRoot, ["config", "user.name", "Harness Test"]);
  git(projectRoot, ["add", "AGENTS.md"]);
  git(projectRoot, ["commit", "-m", "initial"]);

  return {
    root,
    projectRoot,
    config: { harnessHome },
    project: {
      cwd: projectRoot,
      projectRoot,
      gitRoot: projectRoot,
      projectKey: "project-test",
      name: "project",
    },
  };
}

function writeProposalWithPatch(fixture) {
  const result = writeDraftProposals({
    config: fixture.config,
    project: fixture.project,
    proposals: [{
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
      fingerprint: `fp-${Date.now()}-${Math.random()}`,
    }],
  });
  const proposal = result.written[0];
  fs.appendFileSync(proposal.filePath, `\n## Patch\n\`\`\`json\n${JSON.stringify([{ path: "AGENTS.md", oldText: "Existing note.", newText: "Existing note.\n- Use exact oldText before edit." }])}\n\`\`\`\n`);
  return proposal;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
