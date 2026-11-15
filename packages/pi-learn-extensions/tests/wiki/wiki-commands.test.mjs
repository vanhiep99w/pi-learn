import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
    model: { provider: "fixture", id: "model" },
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

async function assertOrdinaryProtection(f) {
  for (const toolName of ["write", "edit"]) {
    for (const candidate of ["wiki/_rules.md", "wiki/modules/order/_rules.md", "AGENTS.md", "order/AGENTS.md", "wiki/INSTRUCTIONS.md"]) {
      assert.equal(await f.tool(toolName, { path: candidate }), undefined);
    }
    assert.equal((await f.tool(toolName, { path: "wiki/.last-update.json" })).block, true);
  }
  assert.equal(await f.tool("bash", { command: "echo policy >> wiki/modules/order/_rules.md" }), undefined);
  assert.equal((await f.tool("bash", { command: "echo data > wiki/.last-update.json" })).block, true);
}

test("ordinary turns allow rule writes without globally blocking legitimate AGENTS edits", async (t) => {
  await assertOrdinaryProtection(await fixture(t));
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
  await assertOrdinaryProtection(f);
  await f.run("wiki-update", "Sửa các lỗi kiểm tra hiện có");
  assert.equal(f.messages.length, 1);
  await assertUpdateProtection(f);
});

test("settlement restores ordinary brief access and preserves no-change metadata", async (t) => {
  const f = await fixture(t);
  await f.run("wiki-update", "Refresh docs");
  await assertUpdateProtection(f);
  await f.emit("agent_settled");
  await assertOrdinaryProtection(f);
  await assert.rejects(readFile(path.join(f.cwd, "wiki/.last-update.json")), { code: "ENOENT" });
});

test("shutdown clears active-run brief protection", async (t) => {
  const f = await fixture(t);
  await f.run("wiki-update", "Refresh docs");
  await f.emit("session_shutdown");
  await assertOrdinaryProtection(f);
});

test("failed message delivery clears the active update", async (t) => {
  const f = await fixture(t);
  f.pi.sendUserMessage = () => { throw new Error("fixture delivery failed"); };
  await f.run("wiki-update", "Refresh docs");
  assert.match(f.notices.at(-1), /fixture delivery failed/);
  await assertOrdinaryProtection(f);
});

test("a busy command leaves ordinary permissions and metadata protection intact", async (t) => {
  const f = await fixture(t);
  f.ctx.isIdle = () => false;
  await f.run("wiki-update", "Refresh docs");
  assert.equal(f.messages.length, 0);
  assert.match(f.notices.at(-1), /Agent is busy/);
  await assertOrdinaryProtection(f);
});

const metadataPath = (f) => path.join(f.cwd, "wiki/.last-update.json");
const spec = (id, fields = "") => `---\nid: ${id}\ntype: module-design\ntitle: ${id}\nstatus: draft\n${fields}---\n# Contract\n`;
const readMetadata = async (f) => JSON.parse(await readFile(metadataPath(f), "utf8"));
const writePrevious = async (f, extra = {}) => {
  const previous = { updatedAt: "2026-01-01T00:00:00.000Z", command: "update", model: "old/model", status: "complete", ...extra };
  await writeFile(metadataPath(f), JSON.stringify(previous) + "\n");
  return previous;
};
const git = (f, ...args) => execFileSync("git", args, { cwd: f.cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" } }).trim();
async function cleanRepository(f, files = {}) {
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(f.cwd, name), content);
  git(f, "init", "-q");
  git(f, "add", ".");
  git(f, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  return writePrevious(f, { gitHead: git(f, "rev-parse", "HEAD") });
}

for (const [name, files, code] of [
  ["dangling edge", { "a.md": spec("a", "depends-on: [missing]\n") }, "dangling_link"],
  ["duplicate ID", { "a.md": spec("dup"), "b.md": spec("dup") }, "duplicate_id"],
  ["parent cycle", { "a.md": spec("a", "parent: b\n"), "b.md": spec("b", "parent: a\n") }, "parent_cycle"],
  ["malformed YAML", { "a.md": "---\nid: [\n---\n" }, "invalid_frontmatter"],
  ["partial identity", { "a.md": "---\nid: a\n---\n" }, "invalid_identity"],
]) {
  test(`finalization rejects ${name} even when Wiki is unchanged`, async (t) => {
    const f = await fixture(t);
    for (const [file, content] of Object.entries(files)) await writeFile(path.join(f.cwd, "wiki", file), content);
    await writePrevious(f);
    await f.run("wiki-update", "Check existing Wiki");
    await f.emit("agent_settled");
    assert.equal((await readMetadata(f)).status, "interrupted");
    assert.match(f.notices.at(-1), /interrupted.*no Wiki changes/);
    assert.ok(f.notices.at(-1).includes(code));
    assert.doesNotMatch(f.notices.at(-1), /completed with no changes/);
    await assertOrdinaryProtection(f);
  });
}

test("init finalization also checks new graph nodes", async (t) => {
  const f = await fixture(t);
  await f.run("wiki");
  await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a", "implements: [missing]\n"));
  await f.emit("agent_settled");
  assert.equal((await readMetadata(f)).status, "interrupted");
  assert.match(f.notices.at(-1), /dangling_link/);
});

test("warnings allow structural completion without promoting draft or claiming review", async (t) => {
  const f = await fixture(t);
  await f.run("wiki-update", "Refresh contract");
  const file = path.join(f.cwd, "wiki/a.md");
  const content = "---\nid: a\ntype: custom-type\nstatus: draft\n---\n# Contract\n";
  await writeFile(file, content);
  await f.emit("agent_settled");
  assert.equal((await readMetadata(f)).status, "complete");
  assert.equal(await readFile(file, "utf8"), content);
  assert.match(f.notices.at(-1), /warnings/);
  assert.match(f.notices.at(-1), /not review approval/);
});

test("a repair clears interrupted status without requiring another document edit", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.cwd, "wiki/a.md");
  await writeFile(file, spec("a", "depends-on: [missing]\n"));
  await f.run("wiki-update", "Validate"); await f.emit("agent_settled");
  assert.equal((await readMetadata(f)).status, "interrupted");
  await writeFile(file, spec("a"));
  await f.run("wiki-update", "Confirm repair"); await f.emit("agent_settled");
  assert.equal((await readMetadata(f)).status, "complete");
  assert.match(f.notices.at(-1), /no changes; interrupted metadata cleared/);
});

test("valid no-change run preserves previous complete metadata byte-for-byte", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a"));
  await writePrevious(f);
  const before = await readFile(metadataPath(f), "utf8");
  await f.run("wiki-update", "Check only"); await f.emit("agent_settled");
  assert.equal(await readFile(metadataPath(f), "utf8"), before);
});

for (const mode of ["settled abort", "assistant error", "shutdown"]) {
  test(`${mode} after edits cannot mark complete`, async (t) => {
    const f = await fixture(t);
    await f.run("wiki-update", "Refresh contract");
    await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a"));
    if (mode === "assistant error") await f.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] });
    if (mode === "shutdown") await f.emit("session_shutdown");
    else await f.emit("agent_settled", { aborted: mode === "settled abort" });
    assert.equal((await readMetadata(f)).status, "interrupted");
    await assertOrdinaryProtection(f);
  });
}

test("abort with no edits and valid graph preserves previous metadata", async (t) => {
  const f = await fixture(t);
  await writePrevious(f);
  const before = await readFile(metadataPath(f), "utf8");
  await f.run("wiki-update", "Check only"); await f.emit("agent_settled", { aborted: true });
  assert.equal(await readFile(metadataPath(f), "utf8"), before);
});

test("agent_end is not finalization; successful retry may complete", async (t) => {
  const f = await fixture(t);
  await f.run("wiki-update", "Refresh contract");
  await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a"));
  await f.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] });
  await assert.rejects(readMetadata(f), { code: "ENOENT" });
  await f.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  await f.emit("agent_settled", { aborted: false });
  assert.equal((await readMetadata(f)).status, "complete");
});

test("clean Git/legacy guides may no-op while metadata is untracked or modified", async (t) => {
  const f = await fixture(t);
  await cleanRepository(f, { "wiki/guide.md": "# Guide\n" });
  await f.run("wiki-update");
  assert.equal(f.messages.length, 0);
  assert.match(f.notices.at(-1), /skipping/);
  git(f, "add", "wiki/.last-update.json");
  git(f, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "metadata baseline");
  await writePrevious(f, { gitHead: git(f, "rev-parse", "HEAD") });
  await f.run("wiki-update");
  assert.equal(f.messages.length, 0, "leading Git status columns must survive trimming");
});

test("clean Git and complete legacy metadata cannot hide an invalid graph", async (t) => {
  const f = await fixture(t);
  await cleanRepository(f, { "wiki/a.md": spec("a", "depends-on: [ghost]\n") });
  await f.run("wiki-update");
  assert.equal(f.messages.length, 1);
  await f.emit("agent_settled");
  assert.equal((await readMetadata(f)).status, "interrupted");
});

test("committed schema defect cannot no-op even when Git considers Wiki-only changes ignorable", async (t) => {
  const f = await fixture(t);
  await cleanRepository(f, { "wiki/a.md": spec("a") });
  await writeFile(path.join(f.cwd, "wiki/a.md"), "---\nid: [\n---\n");
  git(f, "add", "wiki/a.md");
  git(f, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Wiki-only defect");
  await f.run("wiki-update");
  assert.equal(f.messages.length, 1);
});

test("explicit request bypasses no-op but interrupted metadata also forces a run", async (t) => {
  const f = await fixture(t);
  await cleanRepository(f, { "wiki/a.md": spec("a") });
  await f.run("wiki-update", "Check specifically"); assert.equal(f.messages.length, 1);
  await f.emit("agent_settled");
  await writePrevious(f, { gitHead: git(f, "rev-parse", "HEAD"), status: "interrupted" });
  await f.run("wiki-update"); assert.equal(f.messages.length, 2);
});

test("stale domain files are absent from snapshots and cannot interrupt finalization", async (t) => {
  const f = await fixture(t);
  await writePrevious(f);
  const previous = await readFile(metadataPath(f), "utf8");
  await f.run("wiki-update", "Check existing docs");
  await writeFile(path.join(f.cwd, "wiki/_domains.json"), "INVALID_CONFIG_SENTINEL");
  await f.emit("agent_settled");
  assert.equal(await readFile(metadataPath(f), "utf8"), previous);
  assert.doesNotMatch(f.notices.at(-1), /validation failed/i);
  await f.run("wiki", "Check docs with stale file");
  assert.equal(f.messages.length, 2);
});

test("stale domain files do not block clean Git no-op", async (t) => {
  const f = await fixture(t);
  await cleanRepository(f, { "wiki/_domains.json": "INVALID_CONFIG_SENTINEL" });
  await f.run("wiki-update");
  assert.equal(f.messages.length, 0);
  assert.match(f.notices.at(-1), /No meaningful repository changes.*skipping/i);
});

test("graph I/O errors cannot silently become complete or no-op", async (t) => {
  const f = await fixture(t);
  await cleanRepository(f, { "wiki/a.md": Buffer.from([255]) });
  await f.run("wiki-update");
  assert.equal(f.messages.length, 1);
  await f.emit("agent_settled");
  assert.equal((await readMetadata(f)).status, "interrupted");
  assert.match(f.notices.at(-1), /invalid_utf8/);
});

const readBootstrap = (f, name = "AGENTS.md") => readFile(path.join(f.cwd, name), "utf8");
const assertNoBootstrap = (f) => Promise.all(["AGENTS.md", "CLAUDE.md"].map((name) => assert.rejects(readBootstrap(f, name), { code: "ENOENT" })));

test("successful init writes bootstrap at settlement, not agent_end, before completing metadata", async (t) => {
  const f = await fixture(t);
  await f.run("wiki");
  await assertNoBootstrap(f);
  assert.doesNotMatch(f.messages[0], /Bootstrap setup|## Project Wiki|```markdown/);
  await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a"));
  await f.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  await assertNoBootstrap(f);
  await assert.rejects(readMetadata(f), { code: "ENOENT" });
  await f.emit("agent_settled");
  assert.match(await readBootstrap(f), /^## Project Wiki\n/);
  assert.equal((await readMetadata(f)).status, "complete");
  assert.match(f.notices.at(-1), /Wiki init completed/);
});

test("valid no-change init bootstraps both existing files without changing complete metadata", async (t) => {
  const f = await fixture(t);
  await writePrevious(f);
  const before = await readFile(metadataPath(f), "utf8");
  for (const name of ["AGENTS.md", "CLAUDE.md"]) await writeFile(path.join(f.cwd, name), `# ${name}\n\n## Project Wiki\nOld\n\n## Keep\nExact\n`);
  await f.run("wiki");
  await f.emit("agent_settled");
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const content = await readBootstrap(f, name);
    assert.ok(content.startsWith(`# ${name}\n\n## Project Wiki\n`));
    assert.match(content, /Selective Wiki reading:/);
    assert.ok(content.endsWith("\n\n## Keep\nExact\n"));
  }
  assert.equal(await readFile(metadataPath(f), "utf8"), before);
  assert.match(f.notices.at(-1), /completed with no changes/);
});

for (const failure of ["links", "rules", "graph"]) {
  test(`init ${failure} validation failure never bootstraps`, async (t) => {
    const f = await fixture(t);
    await f.run("wiki");
    if (failure === "links") await writeFile(path.join(f.cwd, "wiki/a.md"), "# A\n\n[Missing](missing.md)\n");
    if (failure === "rules") await writeFile(path.join(f.cwd, "wiki/_rules.md"), "# Rules\n\n## DUP-001 — One\n\n## DUP-001 — Two\n");
    if (failure === "graph") await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a", "depends-on: [missing]\n"));
    await f.emit("agent_settled");
    await assertNoBootstrap(f);
    assert.equal((await readMetadata(f)).status, "interrupted");
    assert.doesNotMatch(f.notices.at(-1), /completed/);
  });
}

for (const failure of ["settled abort", "assistant aborted", "assistant error", "shutdown", "session replacement"]) {
  test(`init ${failure} never bootstraps`, async (t) => {
    const f = await fixture(t);
    await f.run("wiki");
    await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a"));
    if (failure === "assistant error" || failure === "assistant aborted") await f.emit("agent_end", { messages: [{ role: "assistant", stopReason: failure === "assistant error" ? "error" : "aborted" }] });
    if (failure === "shutdown" || failure === "session replacement") await f.emit("session_shutdown");
    if (failure === "session replacement") await f.emit("session_start");
    await f.emit("agent_settled", { aborted: failure === "settled abort" });
    await assertNoBootstrap(f);
    assert.equal((await readMetadata(f)).status, "interrupted");
  });
}

test("failed init attempt followed by successful retry bootstraps only at final settlement", async (t) => {
  const f = await fixture(t);
  await f.run("wiki");
  await f.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] });
  await assertNoBootstrap(f);
  await f.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  await f.emit("agent_settled", { aborted: false });
  assert.match(await readBootstrap(f), /## Project Wiki/);
});

test("session start, idle settlement and shutdown never bootstrap without an active init", async (t) => {
  const f = await fixture(t);
  await f.emit("session_start");
  await f.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  await f.emit("agent_settled");
  await f.emit("session_shutdown");
  await assertNoBootstrap(f);
  assert.deepEqual(f.notices, []);
});

test("successful update never creates or repairs bootstrap files", async (t) => {
  const f = await fixture(t);
  await f.run("wiki-update", "Refresh docs");
  await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a"));
  await f.emit("agent_settled");
  await assertNoBootstrap(f);
  assert.equal((await readMetadata(f)).status, "complete");
  const existing = "## Project Wiki\nStale but user-owned during updates\n";
  await writeFile(path.join(f.cwd, "AGENTS.md"), existing);
  await f.run("wiki-update", "Refresh docs");
  await f.emit("agent_settled");
  assert.equal(await readBootstrap(f), existing);
});

test("bootstrap failure preserves both files and metadata, never announces init completion", async (t) => {
  const f = await fixture(t);
  await writePrevious(f, { status: "interrupted" });
  const before = await readFile(metadataPath(f), "utf8");
  const original = "# Preserve agent bytes\n";
  await writeFile(path.join(f.cwd, "AGENTS.md"), original);
  await symlink(path.join(f.cwd, "AGENTS.md"), path.join(f.cwd, "CLAUDE.md"));
  await f.run("wiki");
  await writeFile(path.join(f.cwd, "wiki/a.md"), spec("a"));
  await f.emit("agent_settled");
  assert.equal(await readBootstrap(f), original);
  assert.equal(await readFile(metadataPath(f), "utf8"), before);
  assert.match(f.notices.at(-1), /Wiki finalization failed:.*CLAUDE\.md.*regular file/);
  assert.doesNotMatch(f.notices.join("\n"), /Wiki init completed/);
  const count = f.notices.length;
  await f.emit("agent_settled");
  assert.equal(f.notices.length, count, "failed finalization still clears the active run");
});


test("ordinary chat allows canonical rule creation without a Wiki command", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.tool("write", { path: "wiki/modules/order/_rules.md", content: "# Order rules\n" }), undefined);
  assert.equal((await f.tool("write", { path: "wiki/.last-update.json" })).block, true);
});


test("normal rule writes reject escapes and symlink parents/files while preserving same-cwd checks", async (t) => {
  const f = await fixture(t);
  const outside = await fixture(t);
  await mkdir(path.join(f.cwd, "wiki/modules"));
  await symlink(outside.cwd, path.join(f.cwd, "wiki/modules/order"), "dir");
  const unsafe = ["wiki/modules/order/_rules.md", "wiki/../wiki/_rules.md", "../wiki/_rules.md", path.join(outside.cwd, "wiki/_rules.md")];
  for (const toolName of ["write", "edit"]) for (const candidate of unsafe) {
    assert.equal((await f.tool(toolName, { path: candidate })).block, true, candidate);
  }
  assert.equal((await f.tool("bash", { command: "echo policy > wiki/modules/order/_rules.md" })).block, true);
  await symlink(path.join(outside.cwd, "wiki/_rules.md"), path.join(f.cwd, "wiki/modules/_rules.md"));
  assert.equal((await f.tool("write", { path: "wiki/modules/_rules.md" })).block, true);
  await f.run("wiki-update", "Check docs");
  assert.equal((await f.tool("write", { path: "wiki/_rules.md" }, { ...f.ctx, cwd: outside.cwd })).block, true);
});
