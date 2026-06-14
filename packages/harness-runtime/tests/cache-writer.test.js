import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveProject } from "../src/project/resolve-project.js";
import { writeSessionCache } from "../src/storage/cache-writer.js";

test("writeSessionCache writes manifest events metrics and warnings", async () => {
  const fixture = createFixture();
  const sessionFile = path.join(fixture.sessionDir, "session.jsonl");
  writeSession(sessionFile, fixture.project);

  const project = resolveProject(fixture.project);
  const config = {
    harnessHome: fixture.harnessHome,
    redact: true,
    logging: { enabled: false },
  };

  const result = await writeSessionCache({ sessionFile, config, project });

  assert.equal(fs.existsSync(result.paths.manifest), true);
  assert.equal(fs.existsSync(result.paths.events), true);
  assert.equal(fs.existsSync(result.paths.metrics), true);
  assert.equal(fs.existsSync(result.paths.warnings), true);

  const manifest = JSON.parse(fs.readFileSync(result.paths.manifest, "utf8"));
  const metrics = JSON.parse(fs.readFileSync(result.paths.metrics, "utf8"));
  const events = fs.readFileSync(result.paths.events, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(manifest.sessionId, "s1");
  assert.equal(manifest.activePathCount, 3);
  assert.equal(metrics.userMessages, 1);
  assert.equal(metrics.assistantMessages, 1);
  assert.equal(metrics.toolCalls, 1);
  assert.equal(metrics.toolResults, 1);
  assert.equal(metrics.topTools.read, 1);
  assert.equal(events.some((event) => event.kind === "assistant_tool_call"), true);
  assert.equal(events.every((event) => event.rawRef?.sessionFile === sessionFile), true);
});

test("writeSessionCache redacts event excerpts", async () => {
  const fixture = createFixture();
  const sessionFile = path.join(fixture.sessionDir, "secret-session.jsonl");
  writeSession(sessionFile, fixture.project, "token sk-abcdefghijklmnopqrstuvwxyz");

  const project = resolveProject(fixture.project);
  const result = await writeSessionCache({
    sessionFile,
    config: { harnessHome: fixture.harnessHome, redact: true, logging: { enabled: false } },
    project,
  });

  const eventsText = fs.readFileSync(result.paths.events, "utf8");
  assert.doesNotMatch(eventsText, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.match(eventsText, /<REDACTED_SECRET>/);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cache-writer-"));
  const project = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  const harnessHome = path.join(root, "harness-home");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  return { root, project, sessionDir, harnessHome };
}

function writeSession(file, project, userContent = "hi") {
  const timestamp = "2026-06-14T01:00:00.000Z";
  const lines = [
    { type: "session", version: 3, id: "s1", cwd: fs.realpathSync(project), timestamp },
    { type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: userContent } },
    { type: "message", id: "m2", parentId: "m1", timestamp, message: { role: "assistant", provider: "test", model: "model", content: [{ type: "text", text: "reading" }, { type: "toolCall", id: "call1", name: "read", arguments: { path: "README.md" } }], usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, cost: { total: 0.01 } } } },
    { type: "message", id: "m3", parentId: "m2", timestamp, message: { role: "toolResult", toolCallId: "call1", toolName: "read", isError: false, content: [{ type: "text", text: "ok" }] } },
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}
