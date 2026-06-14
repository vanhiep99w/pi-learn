import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageCwd = path.resolve(testDir, "..");
const cliPath = path.join(packageCwd, "src", "cli.js");

test("cli --help prints usage", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /harness sessions/);
});

test("cli --version prints package version", () => {
  const result = runCli(["--version"]);
  const pkg = JSON.parse(fs.readFileSync(path.join(packageCwd, "package.json"), "utf8"));

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);
});

test("cli project resolve emits JSON and logs command lifecycle", () => {
  const fixture = createCliFixture();
  const result = runCli([
    "project", "resolve",
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.projectRoot, fs.realpathSync(fixture.project));
  assert.match(output.projectKey, /^project-[a-f0-9]{6}$/);

  const events = readRuntimeLogEvents(fixture.harnessHome);
  assertEventSequenceIncludes(events, ["command_start", "config_loaded", "project_resolved", "command_end"]);
});

test("cli sessions emits project sessions JSON", () => {
  const fixture = createCliFixture();
  writeSession(path.join(fixture.sessionDir, "session.jsonl"), {
    id: "s1",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });

  const result = runCli([
    "sessions",
    "--project", fixture.project,
    "--session-dir", fixture.sessionDir,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 1);
  assert.equal(output.sessions[0].sessionId, "s1");

  const events = readRuntimeLogEvents(fixture.harnessHome);
  assertEventSequenceIncludes(events, [
    "command_start",
    "config_loaded",
    "project_resolved",
    "session_discovery_start",
    "session_discovered",
    "session_discovery_end",
    "command_end",
  ]);
});

test("cli scan writes cache files", () => {
  const fixture = createCliFixture();
  writeSession(path.join(fixture.sessionDir, "session.jsonl"), {
    id: "s1",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });

  const result = runCli([
    "scan",
    "--project", fixture.project,
    "--session-dir", fixture.sessionDir,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 1);
  assert.equal(fs.existsSync(path.join(output.results[0].outDir, "manifest.json")), true);
  assert.equal(fs.existsSync(path.join(output.results[0].outDir, "events.jsonl")), true);

  const events = readRuntimeLogEvents(fixture.harnessHome);
  assertEventSequenceIncludes(events, [
    "command_start",
    "session_discovery_start",
    "session_discovery_end",
    "parse_start",
    "parse_end",
    "normalize_start",
    "normalize_end",
    "cache_write_start",
    "cache_write_end",
    "command_end",
  ]);
});

test("cli inspect missing file exits cleanly and logs failure", () => {
  const fixture = createCliFixture();
  const result = runCli([
    "inspect",
    "/tmp/definitely-missing-harness-session.jsonl",
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Session file not found/);
  assert.doesNotMatch(result.stderr, /Error:/);

  const errorEvents = readLogEvents(fixture.harnessHome, "errors");
  assert.equal(errorEvents.some((event) => event.event === "command_failed"), true);
});

test("cli inspect emits JSON shape", () => {
  const fixture = createCliFixture();
  const sessionFile = path.join(fixture.sessionDir, "session.jsonl");
  writeSession(sessionFile, {
    id: "s1",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });

  const result = runCli([
    "inspect", sessionFile,
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.header.id, "s1");
  assert.equal(output.entryCount, 1);
  assert.deepEqual(output.tree.activePathEntryIds, ["m1"]);

  const events = readRuntimeLogEvents(fixture.harnessHome);
  assertEventSequenceIncludes(events, ["parse_start", "parse_end", "tree_built", "active_path_resolved", "command_end"]);
});

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: packageCwd,
    encoding: "utf8",
  });
}

function createCliFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-"));
  const project = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  const harnessHome = path.join(root, "harness-home");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  return { root, project, sessionDir, harnessHome };
}

function readRuntimeLogEvents(harnessHome) {
  return readLogEvents(harnessHome, "runtime");
}

function readLogEvents(harnessHome, stream) {
  const dir = path.join(harnessHome, "logs", stream);
  const files = fs.readdirSync(dir).sort();
  return files.flatMap((file) => fs
    .readFileSync(path.join(dir, file), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line)));
}

function assertEventSequenceIncludes(events, expected) {
  const names = events.map((event) => event.event);
  let cursor = 0;
  for (const name of names) {
    if (name === expected[cursor]) cursor++;
    if (cursor === expected.length) return;
  }
  assert.fail(`Expected event sequence ${expected.join(" -> ")} in ${names.join(" -> ")}`);
}

function writeSession(file, { id, cwd, timestamp }) {
  fs.writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp })}\n${JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: "hi" } })}\n`,
  );
}
