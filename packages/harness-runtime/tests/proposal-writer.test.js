import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeDraftProposals, readDraftProposals, findDraftProposal, renderProposalMarkdown } from "../src/proposals/proposal-writer.js";

test("writeDraftProposals writes markdown and dedupes by fingerprint", () => {
  const fixture = createFixture();
  const proposal = createProposal({ fingerprint: "fp-1" });

  const first = writeDraftProposals({ config: fixture.config, project: fixture.project, proposals: [proposal] });
  assert.equal(first.written.length, 1);
  assert.equal(first.skipped.length, 0);
  assert.equal(fs.existsSync(first.written[0].filePath), true);

  const second = writeDraftProposals({ config: fixture.config, project: fixture.project, proposals: [proposal] });
  assert.equal(second.written.length, 0);
  assert.equal(second.skipped.length, 1);

  const drafts = readDraftProposals({ config: fixture.config, project: fixture.project });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, "P-0001");
  assert.equal(drafts[0].fingerprint, "fp-1");

  const found = findDraftProposal({ config: fixture.config, project: fixture.project, id: "P-0001" });
  assert.equal(found?.title, proposal.title);
});

test("renderProposalMarkdown includes required evidence/test/rollback sections", () => {
  const markdown = renderProposalMarkdown({ id: "P-9999", status: "draft", ...createProposal({ fingerprint: "fp-2" }) });

  assert.match(markdown, /^---\n/);
  assert.match(markdown, /# P-9999 — Test proposal/);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /entry: e1/);
  assert.match(markdown, /## Test plan/);
  assert.match(markdown, /## Rollback/);
});

test("candidate metadata is additive and remains readable after write", () => {
  const fixture = createFixture();
  const proposal = {
    ...createProposal({ fingerprint: "fp-candidate" }),
    candidateId: "candidate-1234567890abcdef12345678",
    detectorId: "R-0002",
    reviewFingerprint: "review-fingerprint-1",
  };

  const result = writeDraftProposals({ config: fixture.config, project: fixture.project, proposals: [proposal] });
  const markdown = fs.readFileSync(result.written[0].filePath, "utf8");
  const read = readDraftProposals({ config: fixture.config, project: fixture.project })[0];

  assert.match(markdown, /candidate_id: candidate-1234567890abcdef12345678/);
  assert.match(markdown, /detector_id: R-0002/);
  assert.match(markdown, /review_fingerprint: review-fingerprint-1/);
  assert.equal(read.candidateId, proposal.candidateId);
  assert.equal(read.detectorId, proposal.detectorId);
  assert.equal(read.reviewFingerprint, proposal.reviewFingerprint);
  assert.match(markdown, /## Proposed change/);
});

test("renderProposalMarkdown includes machine-applicable patch section when provided", () => {
  const markdown = renderProposalMarkdown({
    id: "P-9998",
    status: "draft",
    ...createProposal({ fingerprint: "fp-3" }),
    patch: [{ path: "AGENTS.md", oldText: "before", newText: "after" }],
  });

  assert.match(markdown, /## Patch/);
  assert.match(markdown, /```json/);
  assert.match(markdown, /"path": "AGENTS.md"/);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-proposals-"));
  return {
    config: { harnessHome: root },
    project: { projectKey: "project-test" },
  };
}

function createProposal({ fingerprint }) {
  return {
    ruleId: "R-test",
    title: "Test proposal",
    target: "agents",
    targetFiles: ["AGENTS.md"],
    risk: "low",
    problem: "Problem text",
    proposedChange: "Proposed change text",
    testPlan: ["Run tests"],
    rollbackPlan: "Revert change",
    evidence: [{
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      entryId: "e1",
      timestamp: "2026-06-14T00:00:00.000Z",
      kind: "tool_result",
      excerpt: "oldText did not match",
    }],
    fingerprint,
  };
}
