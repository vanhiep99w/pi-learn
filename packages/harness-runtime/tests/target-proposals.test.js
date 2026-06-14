import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateTargetedImprovements } from "../src/improve/target-proposals.js";
import { writeMemoryDrafts, readMemoryDrafts } from "../src/memory/memory-drafts.js";

test("generateTargetedImprovements target memory returns memory item and proposal", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [userMessage("u1", "harness runtime nằm ở packages/harness-runtime còn pi-harness là docs spec")],
  });

  const result = generateTargetedImprovements({ project: fixture.project, sessionResults: [session], target: "memory" });

  assert.equal(result.memoryItems.length, 1);
  assert.match(result.memoryItems[0].text, /packages\/harness-runtime/);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].target, "memory");
});

test("writeMemoryDrafts appends once and dedupes by fingerprint", () => {
  const fixture = createFixture();
  const item = {
    schemaVersion: 1,
    scope: "project",
    projectKey: fixture.project.projectKey,
    kind: "project_fact",
    text: "Harness runtime implementation lives in packages/harness-runtime.",
    evidence: [],
    confidence: "medium",
    fingerprint: "mem-fp-1",
  };

  const first = writeMemoryDrafts({ config: fixture.config, project: fixture.project, items: [item] });
  const second = writeMemoryDrafts({ config: fixture.config, project: fixture.project, items: [item] });
  const drafts = readMemoryDrafts({ config: fixture.config, project: fixture.project });

  assert.equal(first.written.length, 1);
  assert.equal(second.written.length, 0);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, "M-0001");
  assert.equal(fs.existsSync(first.draftPath), true);
});

test("generateTargetedImprovements target redaction flags sensitive events", () => {
  const fixture = createFixture();
  const session = writeCachedSession(fixture, {
    sessionId: "s1",
    events: [{
      eventId: "evt1",
      entryId: "e1",
      kind: "assistant_tool_call",
      summary: "tool call read",
      tool: { name: "read", argsPreview: { path: ".env" } },
      files: { read: [".env"] },
      safety: { redacted: false, sensitivePath: true, secretDetected: false },
    }],
  });

  const result = generateTargetedImprovements({ project: fixture.project, sessionResults: [session], target: "redaction" });

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].target, "redaction");
  assert.equal(result.proposals[0].risk, "high");
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-targets-"));
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
  return { sessionId, sessionFile: "/tmp/session.jsonl", paths: { events: eventsPath, warnings: warningsPath }, warnings };
}

function userMessage(entryId, excerpt) {
  return {
    eventId: `${entryId}_evt`,
    entryId,
    kind: "user_message",
    summary: "user message",
    excerpt,
  };
}
