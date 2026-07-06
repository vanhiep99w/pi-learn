import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReflection, reflectionResponseToProposals, selectReflectionEvidence, writeReflectionPrompt } from "../src/reflection/reflection.js";

test("selectReflectionEvidence uses normalized redacted events and truncates excerpts", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [{
      eventId: "evt1",
      entryId: "e1",
      kind: "tool_result",
      summary: "edit failed",
      excerpt: `oldText did not match sk-abcdefghijklmnopqrstuvwxyz ${"x".repeat(1000)}`,
      tool: { name: "edit", isError: true },
      activePath: true,
    }],
  });

  const evidence = selectReflectionEvidence({ sessionResults: [session], maxExcerptChars: 120 });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].reason, "tool_error:edit");
  assert.deepEqual(evidence[0].likelyTargets, ["agents", "rules", "eval"]);
  assert.match(evidence[0].targetGuidance, /Prefer agents/);
  assert.match(evidence[0].excerpt, /<REDACTED_SECRET>/);
  assert.doesNotMatch(evidence[0].excerpt, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.equal(evidence[0].excerpt.length <= 160, true);
});

test("selectReflectionEvidence caps one reason so safety evidence does not dominate", () => {
  const fixture = createFixture();
  const events = [];
  for (let index = 0; index < 20; index++) {
    events.push({
      eventId: `safe-${index}`,
      entryId: `safe-${index}`,
      kind: "tool_result",
      excerpt: `secret event ${index} sk-abcdefghijklmnopqrstuvwxyz`,
      tool: { name: "read", isError: false },
      safety: { redacted: true, sensitivePath: false, secretDetected: true },
      activePath: true,
    });
  }
  events.push({
    eventId: "edit-1",
    entryId: "edit-1",
    kind: "tool_result",
    excerpt: "oldText did not match",
    tool: { name: "edit", isError: true },
    activePath: true,
  });
  const session = writeCachedSession(fixture, { sessionId: "s1", events });

  const evidence = selectReflectionEvidence({ sessionResults: [session], maxEvents: 10 });

  assert.equal(evidence.some((item) => item.reason === "tool_error:edit"), true);
  assert.equal(evidence.filter((item) => item.reason === "safety_sensitive").length <= 3, true);
});

test("buildReflection renders safety rules, schema, metrics and evidence refs", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [{
      eventId: "evt1",
      entryId: "e1",
      kind: "user_message",
      summary: "user correction",
      excerpt: "sai rồi, sửa lại flow phase 8",
      activePath: true,
    }],
    metrics: { turns: 1, toolErrors: 0, safety: {} },
  });

  const reflection = buildReflection({ project: fixture.project, sessionResults: [session], generatedAt: new Date("2026-06-14T00:00:00.000Z") });

  assert.match(reflection.prompt, /Use only the normalized evidence/);
  assert.match(reflection.prompt, /Return JSON only/);
  assert.match(reflection.prompt, /targetFiles/);
  assert.match(reflection.prompt, /rollbackPlan/);
  assert.match(reflection.prompt, /`oldText` must be an exact unique substring/);
  assert.match(reflection.prompt, /## Target routing guide/);
  assert.match(reflection.prompt, /skill: repeated multi-step workflow/);
  assert.match(reflection.prompt, /likelyTargets/);
  assert.match(reflection.prompt, /"entryId": "e1"/);
  assert.equal(reflection.metrics.sessions, 1);
});

test("reflectionResponseToProposals validates required proposal shape", () => {
  const fixture = createFixture();
  const proposals = reflectionResponseToProposals({
    project: fixture.project,
    response: JSON.stringify({
      proposals: [{
        title: "Add parser fixture",
        target: "parser",
        targetFiles: ["packages/harness-runtime/tests/parse-tree.test.js"],
        risk: "medium",
        problem: "Parser warning repeated.",
        proposedChange: "Add fixture for the warning.",
        evidence: [{ sessionId: "s1", entryId: "e1", kind: "warning", reason: "parser_warning", excerpt: "unknown entry" }],
        testPlan: ["Run `npm --prefix packages/harness-runtime test`."],
        rollbackPlan: "Revert the fixture.",
        patch: [{ path: "packages/harness-runtime/tests/parse-tree.test.js", oldText: "old", newText: "new" }],
      }],
    }),
  });

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].ruleId, "LLM-REFLECT");
  assert.equal(proposals[0].evidence[0].entryId, "e1");
  assert.equal(proposals[0].evidence[0].kind, "warning");
  assert.equal(proposals[0].evidence[0].reason, "parser_warning");
  assert.deepEqual(proposals[0].patch, [{ path: "packages/harness-runtime/tests/parse-tree.test.js", oldText: "old", newText: "new" }]);
  assert.equal(Boolean(proposals[0].fingerprint), true);
});

test("reflectionResponseToProposals normalizes AGENTS-only target mismatches", () => {
  const fixture = createFixture();
  const proposals = reflectionResponseToProposals({
    project: fixture.project,
    response: JSON.stringify({
      proposals: [{
        title: "Add edit workflow note",
        target: "tool",
        targetFiles: ["AGENTS.md"],
        risk: "low",
        problem: "Edit failures repeated.",
        proposedChange: "Document exact-text edit retry workflow.",
        evidence: [{ sessionId: "s1", entryId: "e1", kind: "tool_result", reason: "tool_error:edit", excerpt: "oldText mismatch" }],
        testPlan: ["Review AGENTS.md."],
        rollbackPlan: "Remove the note.",
      }],
    }),
  });

  assert.equal(proposals[0].target, "agents");
});

test("writeReflectionPrompt writes latest and dated prompt under private harness home", () => {
  const fixture = createFixture();
  const paths = writeReflectionPrompt({
    config: fixture.config,
    project: fixture.project,
    prompt: "# prompt",
    now: new Date("2026-06-14T00:00:00.000Z"),
  });

  assert.equal(fs.existsSync(paths.latestPath), true);
  assert.equal(fs.existsSync(paths.datedPath), true);
  assert.match(paths.latestPath, /reflections\/latest\.md$/);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-reflection-"));
  return {
    root,
    config: { harnessHome: root },
    project: {
      cwd: root,
      projectRoot: root,
      gitRoot: root,
      projectKey: "project-test",
      name: "project",
    },
  };
}

function writeCachedSession(fixture, { sessionId, events, warnings = [], metrics = {} }) {
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
    rawRef: { sessionFile: "/tmp/session.jsonl", entryId: event.entryId },
    safety: { redacted: false, sensitivePath: false, secretDetected: false },
    ...event,
  })).join("\n") + (events.length ? "\n" : ""));
  fs.writeFileSync(warningsPath, warnings.map((warning) => JSON.stringify(warning)).join("\n") + (warnings.length ? "\n" : ""));
  return {
    sessionId,
    sessionFile: "/tmp/session.jsonl",
    eventCount: events.length,
    paths: { events: eventsPath, warnings: warningsPath },
    warnings,
    metrics,
  };
}
