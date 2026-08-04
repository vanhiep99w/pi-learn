import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveProject } from "../src/project/resolve-project.js";
import { discoverSessions, readSessionHeader } from "../src/session/discover-sessions.js";

test("readSessionHeader reads only session header", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-session-header-"));
  const file = path.join(tmp, "session.jsonl");
  fs.writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "s1", cwd: tmp, timestamp: "2026-06-14T00:00:00.000Z" })}\n${JSON.stringify({ type: "message", id: "m1" })}\n`,
  );

  const result = readSessionHeader(file);
  assert.equal(result.header.id, "s1");
  assert.equal(result.header.version, 3);
  assert.equal(result.warning, undefined);
});

test("discoverSessions filters sessions by project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-discover-"));
  const projectA = path.join(root, "project-a");
  const projectB = path.join(root, "project-b");
  const sessionDir = path.join(root, "sessions");
  fs.mkdirSync(path.join(projectA, ".git"), { recursive: true });
  fs.mkdirSync(path.join(projectB, ".git"), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, "--a--"), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, "--b--"), { recursive: true });

  writeSession(path.join(sessionDir, "--a--", "a.jsonl"), {
    id: "session-a",
    cwd: projectA,
    timestamp: "2026-06-14T01:00:00.000Z",
  });
  writeSession(path.join(sessionDir, "--b--", "b.jsonl"), {
    id: "session-b",
    cwd: projectB,
    timestamp: "2026-06-14T02:00:00.000Z",
  });

  const project = resolveProject(projectA);
  const result = discoverSessions({ sessionDir, maxSessionsPerScan: 50 }, project);

  assert.equal(result.scannedFiles, 2);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, "session-a");
  assert.equal(result.sessions[0].cwd, fs.realpathSync(projectA));
});

test("discoverSessions sorts newest first and respects maxSessions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-discover-sort-"));
  const project = path.join(root, "project");
  const sessionDir = path.join(root, "sessions", "--project--");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  writeSession(path.join(sessionDir, "old.jsonl"), {
    id: "old",
    cwd: project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });
  writeSession(path.join(sessionDir, "new.jsonl"), {
    id: "new",
    cwd: project,
    timestamp: "2026-06-14T02:00:00.000Z",
  });

  const result = discoverSessions(
    { sessionDir: path.dirname(sessionDir), maxSessionsPerScan: 1 },
    resolveProject(project),
  );

  assert.equal(result.eligibleCount, 2);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, "new");
});

test("discoverSessions applies frozen until and deterministic tie-breaks before selection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-discover-until-"));
  const project = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  writeSession(path.join(sessionDir, "first.jsonl"), {
    id: "z-session",
    cwd: project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });
  writeSession(path.join(sessionDir, "second.jsonl"), {
    id: "a-session",
    cwd: project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });
  writeSession(path.join(sessionDir, "future.jsonl"), {
    id: "future",
    cwd: project,
    timestamp: "2026-06-15T01:00:00.000Z",
  });

  const result = discoverSessions(
    { sessionDir, maxSessionsPerScan: 1 },
    resolveProject(project),
    { until: "2026-06-14T02:00:00.000Z" },
  );

  assert.equal(result.until, "2026-06-14T02:00:00.000Z");
  assert.equal(result.eligibleCount, 2);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, "a-session");
});

test("discoverSessions reports missing session directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-discover-missing-"));
  const project = path.join(root, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });

  const result = discoverSessions(
    { sessionDir: path.join(root, "missing-sessions"), maxSessionsPerScan: 10 },
    resolveProject(project),
  );

  assert.deepEqual(result.sessions, []);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, "session_dir_missing");
});

test("readSessionHeader reports malformed header JSON", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bad-header-"));
  const file = path.join(tmp, "bad.jsonl");
  fs.writeFileSync(file, "{bad json\n");

  const result = readSessionHeader(file);

  assert.equal(result.header, undefined);
  assert.equal(result.warning.code, "malformed_header_json");
});

test("readSessionHeader reports header_too_long instead of malformed JSON", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-long-header-"));
  const file = path.join(tmp, "long.jsonl");
  fs.writeFileSync(file, `{"type":"session","id":"${"x".repeat(70 * 1024)}"}`);

  const result = readSessionHeader(file);

  assert.equal(result.header, undefined);
  assert.equal(result.warning.code, "header_too_long");
});

test("discoverSessions warns and skips jsonl symlinks", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-symlink-session-"));
  const project = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const realFile = path.join(sessionDir, "real.jsonl");
  const linkFile = path.join(sessionDir, "linked.jsonl");
  writeSession(realFile, {
    id: "real",
    cwd: project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });
  fs.symlinkSync(realFile, linkFile);

  const result = discoverSessions({ sessionDir, maxSessionsPerScan: 10 }, resolveProject(project));

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, "real");
  assert.equal(result.warnings.some((warning) => warning.code === "symlink_skipped"), true);
});

function writeSession(file, { id, cwd, timestamp }) {
  fs.writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp })}\n${JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: "hi" } })}\n`,
  );
}
