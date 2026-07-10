import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRuleEngine, loadRuleConfig } from "../src/analysis/rules.js";

test("runRuleEngine detects repeated edit oldText mismatch", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [
      toolResult("e1", { toolName: "edit", isError: true, excerpt: "oldText must match a unique region" }),
      toolResult("e2", { toolName: "edit", isError: true, excerpt: "oldText did not match" }),
    ],
  });

  const proposals = runRuleEngine({ project: fixture.project, sessionResults: [session] });
  const proposal = proposals.find((item) => item.ruleId === "R-0002");

  assert.equal(proposal?.title, "Add edit workflow note for exact oldText matching");
  assert.equal(proposal.target, "rules");
  assert.deepEqual(proposal.targetFiles, ["wiki/_rules.md"]);
  assert.equal(proposal.evidence.length, 2);
  assert.equal(Boolean(proposal.fingerprint), true);
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
  const proposals = runRuleEngine({ project: fixture.project, sessionResults: [session], ruleConfig: rules });

  assert.equal(rules.get("R-0002").params.minOccurrences, 2);
  assert.equal(proposals.some((item) => item.ruleId === "R-0002"), true);
});

test("runRuleEngine detects parser warnings", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [],
    warnings: [{
      schemaVersion: 1,
      projectKey: fixture.project.projectKey,
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      entryId: "w1",
      code: "unknown_entry_type",
      message: "Unknown entry type: usage_snapshot",
      timestamp: "2026-06-14T00:00:00.000Z",
    }],
  });

  const proposals = runRuleEngine({ project: fixture.project, sessionResults: [session] });
  const proposal = proposals.find((item) => item.ruleId === "R-0004");

  assert.match(proposal?.title ?? "", /unknown_entry_type/);
  assert.equal(proposal.evidence[0].entryId, "w1");
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rules-"));
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  return {
    root,
    project: {
      cwd: projectRoot,
      projectRoot,
      gitRoot: projectRoot,
      projectKey: "project-test",
      name: "project",
    },
  };
}

function writeCachedSession(fixture, { sessionId, events, warnings = [] }) {
  const dir = path.join(fixture.root, "cache", sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, "events.jsonl");
  const warningsPath = path.join(dir, "warnings.jsonl");
  fs.writeFileSync(eventsPath, events.map((event) => JSON.stringify({
    schemaVersion: 1,
    projectKey: fixture.project.projectKey,
    sessionId,
    sessionFile: "/tmp/session.jsonl",
    parentId: null,
    timestamp: "2026-06-14T00:00:00.000Z",
    cwd: fixture.project.cwd,
    activePath: true,
    rawRef: { sessionFile: "/tmp/session.jsonl", entryId: event.entryId },
    safety: { redacted: false, sensitivePath: false, secretDetected: false },
    ...event,
  })).join("\n") + (events.length ? "\n" : ""));
  fs.writeFileSync(warningsPath, warnings.map((warning) => JSON.stringify(warning)).join("\n") + (warnings.length ? "\n" : ""));

  return {
    sessionId,
    sessionFile: "/tmp/session.jsonl",
    paths: { events: eventsPath, warnings: warningsPath },
    warnings,
  };
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
