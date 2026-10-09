import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Pi's jiti loader resolves the source's .js specifier to its TypeScript file.
// Mirror only that one mapping when loading the extension with native Node.
const commandsUrl = new URL("../../extensions/wiki/wiki-commands.ts", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === commandsUrl.href && specifier === "./wiki-prompt.js") {
      return nextResolve(new URL("../../extensions/wiki/wiki-prompt.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { registerWikiCommands } = await import(commandsUrl.href);
hooks.deregister();

async function fixture(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-wiki-command-"));
  await mkdir(path.join(cwd, "wiki"));
  await writeFile(path.join(cwd, "wiki/_rules.md"), "# Global rules\n\n## GLOBAL-TEST-001 — Fixture\n\nPreserve unrelated rules.\n");
  const commands = new Map();
  const events = new Map();
  const messages = [];
  const notices = [];
  const ctx = {
    cwd,
    hasUI: true,
    isIdle: () => true,
    ui: { notify: (message) => notices.push(message), setStatus: () => {} },
  };
  const pi = {
    registerCommand: (name, command) => commands.set(name, command.handler),
    on: (name, handler) => events.set(name, handler),
    sendUserMessage: (message) => messages.push(message),
  };
  registerWikiCommands(pi);
  const emit = (name, event = {}, context = ctx) => events.get(name)(event, context);
  const run = (command, args = "") => commands.get(command)(args, ctx);
  const tool = (toolName, input, context = ctx) => emit("tool_call", { toolName, input }, context);
  t.after(async () => {
    await emit("session_shutdown");
    await rm(cwd, { recursive: true, force: true });
  });
  return { cwd, ctx, pi, messages, notices, emit, run, tool };
}

async function assertRulesProtected(f) {
  for (const toolName of ["write", "edit"]) {
    for (const candidate of ["wiki/_rules.md", "wiki/domain/_rules.md", path.join(f.cwd, "wiki/_rules.md")]) {
      assert.equal((await f.tool(toolName, { path: candidate })).block, true);
    }
  }
  assert.equal((await f.tool("bash", { command: "echo policy >> wiki/_rules.md" })).block, true);
}

async function assertUpdateProtection(f) {
  for (const toolName of ["write", "edit"]) {
    for (const candidate of ["wiki/_rules.md", "wiki/domain/_rules.md", path.join(f.cwd, "wiki/_rules.md")]) {
      assert.equal(await f.tool(toolName, { path: candidate }), undefined);
    }
    for (const candidate of ["wiki/.last-update.json", "wiki/INSTRUCTIONS.md"]) {
      assert.equal((await f.tool(toolName, { path: candidate })).block, true);
    }
  }
  assert.equal(await f.tool("bash", { command: "echo policy >> wiki/_rules.md" }), undefined);
  for (const candidate of ["wiki/.last-update.json", "wiki/INSTRUCTIONS.md"]) {
    assert.equal((await f.tool("bash", { command: `echo protected > ${candidate}` })).block, true);
  }
  assert.equal(await f.tool("read", { path: "wiki/_rules.md" }), undefined);
  assert.equal(await f.tool("bash", { command: "cat wiki/_rules.md" }), undefined);
}

test("rules remain protected outside an active Wiki update", async (t) => {
  const f = await fixture(t);
  await assertRulesProtected(f);
  assert.equal((await f.tool("write", { path: "wiki/.last-update.json" })).block, true);
});

test("initialization cannot edit rules even with an explicit rule request", async (t) => {
  const f = await fixture(t);
  await f.run("wiki", "Update wiki/_rules.md");
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /Do not create, edit, move, or delete wiki\/\*\*\/_rules\.md/);
  await assertRulesProtected(f);
});

for (const request of [
  "khi viết code tôi ko muốn viết unitest nữa",
  "Trước khi bàn giao hãy kiểm tra các liên kết đã thay đổi",
  "Refresh extension docs",
  "Lần này đừng viết unit test",
  "",
]) {
  test(`update delegates rule decisions without keyword gating: ${request || "no args"}`, async (t) => {
    const f = await fixture(t);
    await f.run("wiki-update", request);
    assert.equal(f.messages.length, 1);
    assert.match(f.messages[0], /Agent-directed rule updates/);
    if (request) assert.ok(f.messages[0].endsWith(request));
    await assertUpdateProtection(f);
    // Permission is scoped to this repository, not a different session cwd.
    assert.equal((await f.tool("write", { path: "wiki/_rules.md" }, { ...f.ctx, cwd: path.join(f.cwd, "other") })).block, true);
  });
}

test("update can repair invalid rule lint without naming a rule file", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, "wiki/_rules.md"), "# Invalid fixture\n\n## DUP-001 — One\n\n## DUP-001 — Two\n");
  await f.run("wiki", "Refresh docs");
  assert.equal(f.messages.length, 0);
  assert.match(f.notices.at(-1), /cannot initialize while rule lint is invalid/);
  await assertRulesProtected(f);
  await f.run("wiki-update", "Sửa các lỗi kiểm tra hiện có");
  assert.equal(f.messages.length, 1);
  await assertUpdateProtection(f);
});

test("settlement revokes rule permission and preserves no-change metadata", async (t) => {
  const f = await fixture(t);
  await f.run("wiki-update", "Refresh docs");
  await assertUpdateProtection(f);
  await f.emit("agent_settled");
  await assertRulesProtected(f);
  await assert.rejects(readFile(path.join(f.cwd, "wiki/.last-update.json")), { code: "ENOENT" });
});

test("shutdown revokes rule permission", async (t) => {
  const f = await fixture(t);
  await f.run("wiki-update", "Refresh docs");
  await f.emit("session_shutdown");
  await assertRulesProtected(f);
});

test("failed message delivery clears the active update", async (t) => {
  const f = await fixture(t);
  f.pi.sendUserMessage = () => { throw new Error("fixture delivery failed"); };
  await f.run("wiki-update", "Refresh docs");
  assert.match(f.notices.at(-1), /fixture delivery failed/);
  await assertRulesProtected(f);
});

test("a busy command does not grant rule permission", async (t) => {
  const f = await fixture(t);
  f.ctx.isIdle = () => false;
  await f.run("wiki-update", "Refresh docs");
  assert.equal(f.messages.length, 0);
  assert.match(f.notices.at(-1), /Agent is busy/);
  await assertRulesProtected(f);
});
