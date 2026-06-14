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

test("cli report writes latest Markdown report", () => {
  const fixture = createCliFixture();
  writeSession(path.join(fixture.sessionDir, "session.jsonl"), {
    id: "s1",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });

  const result = runCli([
    "report",
    "--project", fixture.project,
    "--session-dir", fixture.sessionDir,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 1);
  assert.equal(fs.existsSync(output.report.latestPath), true);
  const report = fs.readFileSync(output.report.latestPath, "utf8");
  assert.match(report, /# Pi Harness Report/);
  assert.match(report, /Sessions scanned: 1/);

  const events = readRuntimeLogEvents(fixture.harnessHome);
  assertEventSequenceIncludes(events, ["report_generate_start", "report_generated", "command_end"]);
});

test("cli reflect writes redacted LLM reflection prompt", () => {
  const fixture = createCliFixture();
  const sessionFile = path.join(fixture.sessionDir, "error-session.jsonl");
  writeErrorSession(sessionFile, {
    id: "s-reflect",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });

  const result = runCli([
    "reflect",
    "--project", fixture.project,
    "--session-dir", fixture.sessionDir,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "reflect");
  assert.equal(output.evidenceCount >= 1, true);
  assert.equal(fs.existsSync(output.reflection.latestPath), true);
  const prompt = fs.readFileSync(output.reflection.latestPath, "utf8");
  assert.match(prompt, /Pi Harness LLM Reflection Prompt/);
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /oldText/);
});

test("cli reflect import writes LLM draft proposals", () => {
  const fixture = createCliFixture();
  const responsePath = path.join(fixture.root, "llm-response.json");
  fs.writeFileSync(responsePath, JSON.stringify({
    proposals: [{
      title: "Add eval fixture",
      target: "eval",
      targetFiles: ["harness/evals/"],
      risk: "low",
      problem: "Repeated evidence suggests an eval fixture.",
      proposedChange: "Add a deterministic eval fixture.",
      evidence: [{ sessionId: "s1", entryId: "e1", reason: "tool_error" }],
      testPlan: ["Run `npm --prefix packages/harness-runtime test`."],
      rollbackPlan: "Remove the fixture.",
    }],
  }));

  const result = runCli([
    "reflect",
    "--import", responsePath,
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "reflect_import");
  assert.equal(output.written.length, 1);
  assert.equal(output.written[0].ruleId, "LLM-REFLECT");
});

test("cli propose writes deterministic draft proposals and dedupes", () => {
  const fixture = createCliFixture();
  const sessionFile = path.join(fixture.sessionDir, "error-session.jsonl");
  writeErrorSession(sessionFile, {
    id: "s-propose",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });

  const first = runCli([
    "propose",
    "--rules",
    "--project", fixture.project,
    "--session-dir", fixture.sessionDir,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(first.status, 0);
  const firstOutput = JSON.parse(first.stdout);
  assert.equal(firstOutput.written.length >= 1, true);
  assert.equal(fs.existsSync(firstOutput.written[0].filePath), true);

  const second = runCli([
    "propose",
    "--rules",
    "--project", fixture.project,
    "--session-dir", fixture.sessionDir,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);
  assert.equal(second.status, 0);
  const secondOutput = JSON.parse(second.stdout);
  assert.equal(secondOutput.written.length, 0);
  assert.equal(secondOutput.skipped.length >= 1, true);

  const list = runCli([
    "proposals",
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);
  assert.equal(list.status, 0);
  const listOutput = JSON.parse(list.stdout);
  assert.equal(listOutput.count >= 1, true);

  const show = runCli([
    "show", listOutput.proposals[0].id,
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
  ]);
  assert.equal(show.status, 0);
  assert.match(show.stdout, /## Evidence/);
});

test("cli approve reject and history track proposal lifecycle", () => {
  const fixture = createCliFixture();
  const sessionFile = path.join(fixture.sessionDir, "error-session.jsonl");
  writeErrorSession(sessionFile, {
    id: "s-lifecycle",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
  });

  const proposed = runCli([
    "propose",
    "--rules",
    "--project", fixture.project,
    "--session-dir", fixture.sessionDir,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);
  assert.equal(proposed.status, 0);
  const proposalId = JSON.parse(proposed.stdout).written[0].id;

  const approved = runCli([
    "approve", proposalId,
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);
  assert.equal(approved.status, 0);
  assert.equal(JSON.parse(approved.stdout).proposal.status, "approved");

  const rejected = runCli([
    "reject", proposalId,
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);
  assert.equal(rejected.status, 0);
  assert.equal(JSON.parse(rejected.stdout).proposal.status, "rejected");

  const history = runCli([
    "history", proposalId,
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);
  assert.equal(history.status, 0);
  assert.deepEqual(JSON.parse(history.stdout).history.map((event) => event.event), ["proposal_approved", "proposal_rejected"]);
});

test("cli propose target memory writes memory draft and proposal", () => {
  const fixture = createCliFixture();
  writeSession(path.join(fixture.sessionDir, "memory-session.jsonl"), {
    id: "s-memory",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
    userContent: "harness runtime nằm ở packages/harness-runtime còn pi-harness là docs spec",
  });

  const result = runCli([
    "propose",
    "--target", "memory",
    "--project", fixture.project,
    "--session-dir", fixture.sessionDir,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "target:memory");
  assert.equal(output.memory.written.length >= 1, true);
  assert.equal(fs.existsSync(output.memory.draftPath), true);
  assert.equal(output.written.length >= 1, true);
  const memoryText = fs.readFileSync(output.memory.draftPath, "utf8");
  assert.match(memoryText, /packages\/harness-runtime/);
});

test("cli inspect entry prints redacted full raw entry", () => {
  const fixture = createCliFixture();
  const sessionFile = path.join(fixture.sessionDir, "session.jsonl");
  writeSession(sessionFile, {
    id: "s1",
    cwd: fixture.project,
    timestamp: "2026-06-14T01:00:00.000Z",
    userContent: "token sk-abcdefghijklmnopqrstuvwxyz",
  });

  const result = runCli([
    "inspect", sessionFile,
    "--entry", "m1",
    "--full",
    "--project", fixture.project,
    "--harness-home", fixture.harnessHome,
    "--json",
  ]);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.entryId, "m1");
  assert.equal(output.entry.id, "m1");
  assert.match(output.excerpt, /<REDACTED_SECRET>/);
  assert.doesNotMatch(result.stdout, /sk-abcdefghijklmnopqrstuvwxyz/);
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

function writeSession(file, { id, cwd, timestamp, userContent = "hi" }) {
  fs.writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp })}\n${JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: userContent } })}\n`,
  );
}

function writeErrorSession(file, { id, cwd, timestamp }) {
  const lines = [
    { type: "session", version: 3, id, cwd: fs.realpathSync(cwd), timestamp },
    { type: "message", id: "m1", parentId: null, timestamp, message: { role: "user", content: "fix file" } },
    { type: "message", id: "m2", parentId: "m1", timestamp, message: { role: "assistant", provider: "test", model: "model", content: [{ type: "toolCall", id: "edit1", name: "edit", arguments: { path: "src/a.js", oldText: "x", newText: "y" } }] } },
    { type: "message", id: "m3", parentId: "m2", timestamp, message: { role: "toolResult", toolCallId: "edit1", toolName: "edit", isError: true, content: [{ type: "text", text: "oldText must match a unique region of the original file" }] } },
    { type: "message", id: "m4", parentId: "m3", timestamp, message: { role: "assistant", provider: "test", model: "model", content: [{ type: "toolCall", id: "edit2", name: "edit", arguments: { path: "src/a.js", oldText: "x", newText: "y" } }] } },
    { type: "message", id: "m5", parentId: "m4", timestamp, message: { role: "toolResult", toolCallId: "edit2", toolName: "edit", isError: true, content: [{ type: "text", text: "oldText did not match" }] } },
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}
