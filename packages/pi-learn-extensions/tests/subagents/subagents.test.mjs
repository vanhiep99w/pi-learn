import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const rootUrl = new URL("../../extensions/", import.meta.url);
const sdk = `
export const CONFIG_DIR_NAME = '.pi';
export const getAgentDir = () => process.env.PI_TEST_AGENT_DIR;
export const SettingsManager = { inMemory: (settings, options) => ({ settings, options }) };
export const ModelRuntime = { create: async (options) => ({ options, providers: [], registerNativeProvider(provider) { this.providers.push(provider); } }) };
export const createAgentSession = () => { throw new Error('Unit tests must not create SDK sessions'); };
export class DefaultResourceLoader {}
export const SessionManager = {};
export const buildSessionContext = () => { throw new Error('No transcript replay in host adapter tests'); };
`;
const typebox = `export const Type = {
 String: (x={})=>({type:'string',...x}), Boolean: (x={})=>({type:'boolean',...x}), Integer: (x={})=>({type:'integer',...x}),
 Array: (items,x={})=>({type:'array',items,...x}), Optional:x=>x, Unsafe:x=>x,
 Object: (properties,x={})=>({type:'object',properties,...x})
};`;
const hooks = registerHooks({ resolve(name, ctx, next) {
  if (name === "@earendil-works/pi-coding-agent") return { url: "data:text/javascript," + encodeURIComponent(sdk), shortCircuit: true };
  if (name === "@earendil-works/pi-ai") return { url: "data:text/javascript,export class InMemoryCredentialStore {}", shortCircuit: true };
  if (name === "typebox") return { url: "data:text/javascript," + encodeURIComponent(typebox), shortCircuit: true };
  if (name.startsWith(".") && ctx.parentURL?.startsWith(new URL("subagents/vendor/", rootUrl).href) && !path.extname(name)) return next(new URL(name + ".ts", ctx.parentURL).href, ctx);
  return next(name, ctx);
} });
const { createPiLearnSubagents, childSafety, MAX_CHILDREN, MAX_TASK_CHARS } = await import(new URL("subagents/adapter.ts", rootUrl));
const { discoverDefinitions, readDefinitionFile } = await import(new URL("subagents/definitions.ts", rootUrl));
hooks.deregister();
const outcome = (id, task, status = "completed", text = "child report") => ({ status, finalText: text, details: { childSessionId: id, task, status, usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1, contextTokens: 3 }, durationMs: 1 } });

function fixture(t, options = {}) {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), "pi-learn-subagents-unit-"));
  const agentDir = path.join(cwd, "personal"); fs.mkdirSync(agentDir);
  const previous = process.env.PI_TEST_AGENT_DIR; process.env.PI_TEST_AGENT_DIR = agentDir;
  const tools = new Map(), handlers = new Map(), commands = new Map(), children = new Map();
  const messages = [], births = [], runs = [], aborted = [];
  const active = new Set(options.active ?? ["read", "bash", "write", "edit", "ls", "grep", "find", "Agent", "get_subagent_result", "wiki_get"]);
  const model = { provider: "fake", id: "fake", api: "fake", name: "Fake" };
  let trusted = true, idle = true, gated = false, counter = 0;
  const registry = { getAvailable: () => [model], find: (provider, id) => provider === model.provider && id === model.id ? model : undefined, stream: () => {}, streamSimple: () => {} };
  const ctx = { cwd, mode: "print", hasUI: false, model, modelRegistry: registry, thinkingLevel: "low", scopedModels: [],
    isProjectTrusted: () => trusted, isIdle: () => idle,
    sessionManager: { getSessionId: () => "parent" },
    get ui() { throw new Error("Headless paths must never access UI"); },
  };
  const service = {
    async createChild(spec) {
      births.push(spec); const id = `child-${++counter}`; let snapshot, finish;
      const child = {
        sessionId: id, record: { sessionId: id, parentSessionId: spec.parent, info: spec.info },
        get snapshot() { return snapshot; },
        runQueued(task, runOptions) {
          runs.push({ task, ...runOptions }); snapshot = { ...outcome(id, task, "queued"), collected: false };
          runOptions.onUpdate?.(snapshot.details);
          return new Promise((resolve) => {
            finish = (status = "completed", text = options.report ?? "child report") => {
              snapshot = { ...outcome(id, task, status, text), collected: false };
              if (status === "aborted") snapshot.details.abortReason = "user";
              runOptions.onUpdate?.(snapshot.details); resolve(snapshot);
            };
            if (!gated) queueMicrotask(() => finish());
          });
        },
        collectResult() { if (snapshot && snapshot.status !== "queued") snapshot.collected = true; return snapshot; },
        async abort(reason) { aborted.push({ id, reason }); finish?.("aborted"); },
        async dispose() { await child.abort("dispose"); children.delete(id); },
        finish: (...args) => finish?.(...args),
      };
      children.set(id, child); return child;
    },
    childrenOf: (id) => [...children.values()].filter((child) => child.record.parentSessionId === id),
    findChild: (id) => children.get(id),
    async disposeChildrenOf(id) { for (const child of service.childrenOf(id)) await child.dispose(); },
  };
  let bindings;
  const pi = {
    registerTool: (tool) => tools.set(tool.name, tool), registerCommand: (name, command) => commands.set(name, command),
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    getActiveTools: () => [...active], setActiveTools: (names) => { active.clear(); names.forEach((name) => active.add(name)); },
    sendMessage: (message, delivery) => messages.push({ message, delivery }),
  };
  createPiLearnSubagents({ serviceFactory: (value) => { bindings = value; return service; } })(pi);
  const emit = async (name, event = {}, context = ctx) => { for (const handler of handlers.get(name) ?? []) await handler(event, context); };
  const call = (name, params, context = ctx, signal, onUpdate) => tools.get(name).execute("unit-call", params, signal, onUpdate, context);
  const put = (relative, body) => { const file = path.join(cwd, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); return file; };
  t.after(async () => { await emit("session_shutdown", { reason: "quit" }); if (previous === undefined) delete process.env.PI_TEST_AGENT_DIR; else process.env.PI_TEST_AGENT_DIR = previous; fs.rmSync(cwd, { recursive: true, force: true }); });
  return { cwd, agentDir, ctx, pi, tools, commands, children, messages, births, runs, aborted, active, call, emit, put,
    get bindings() { return bindings; }, trust(value) { trusted = value; }, idle(value) { idle = value; }, gate(value) { gated = value; } };
}
const input = (subagent_type = "worker", task = "Complete a small task", rest = {}) => ({ subagent_type, task, ...rest });
const definition = (name, fields = "") => `---\nname: ${name}\ndescription: Fixture agent\n${fields}---\nComplete the task.\n`;

test("registers only upstream tool names and one scoped control command, with no workflow router", async (t) => {
  const f = fixture(t); await f.emit("session_start");
  assert.deepEqual([...f.tools.keys()], ["Agent", "get_subagent_result"]);
  assert.deepEqual([...f.commands.keys()], ["subagents"]);
  assert.equal(f.tools.get("Agent").parameters.additionalProperties, false);
  assert.equal(f.tools.get("Agent").exposure, "model-only");
  assert.match(f.tools.get("Agent").description, /scout/); assert.match(f.tools.get("Agent").description, /reviewer/);
});

test("reuses upstream discovery/precedence and ignores untrusted or unsafe project definitions", (t) => {
  const f = fixture(t);
  f.put("personal/agents/personal.md", definition("personal"));
  f.put(".pi/agents/project.md", definition("project"));
  f.put(".agents/agents/another.md", definition("another"));
  f.trust(false);
  assert.deepEqual(discoverDefinitions(f.ctx).map((d) => d.name), ["scout", "planner", "worker", "reviewer", "personal"]);
  f.trust(true); assert.ok(discoverDefinitions(f.ctx).some((d) => d.name === "project"));
  f.put("personal/agents/scout.md", definition("scout"));
  assert.equal(discoverDefinitions(f.ctx).find((d) => d.name === "scout").source, "builtin");
  assert.ok(discoverDefinitions(f.ctx).find((d) => d.name === "planner").tools.includes("wiki_get"));
  assert.equal(discoverDefinitions(f.ctx).find((d) => d.name === "planner").tools.includes("spec_get"), false);
});

test("definition reader is bounded, UTF-8 strict and rejects aliases before contents", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t);
  const file = f.put("safe.md", definition("safe"));
  assert.match(readDefinitionFile(file), /name: safe/);
  const alias = path.join(f.cwd, "alias.md"); fs.symlinkSync(file, alias);
  assert.throws(() => readDefinitionFile(alias));
  fs.linkSync(file, path.join(f.cwd, "hard.md")); assert.throws(() => readDefinitionFile(file));
  assert.throws(() => readDefinitionFile(f.put("oversized.md", "x".repeat(65537))));
  assert.throws(() => readDefinitionFile(f.put("bytes.md", Buffer.from([255]))));
});

test("child tools are a parent subset and only curated Wiki extensions are offered", async (t) => {
  const f = fixture(t, { active: ["Agent", "get_subagent_result", "read", "wiki_get", "mcp__server_tool", "tool_search"] });
  await f.emit("session_start"); await f.call("Agent", input());
  assert.deepEqual(f.births[0].session.tools, ["read", "wiki_get"]);
  assert.ok(f.births[0].session.excludeTools.includes("Agent"));
  assert.equal(f.bindings.resolveParent("parent").cwd, f.cwd);
  assert.deepEqual(f.bindings.buildChildSettings(f.cwd, false).options, { projectTrusted: false });
  assert.equal(f.runs[0].maxTurns, 24);
  assert.equal(f.bindings.maxConcurrentPerParent, 4);
});

test("parent/project scope, cancellation and malformed tasks fail before child creation", async (t) => {
  const f = fixture(t); await f.emit("session_start");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.call("Agent", input(), f.ctx, controller.signal), /cancelled/);
  await assert.rejects(f.call("Agent", input("worker", " ")), /nonempty/);
  await assert.rejects(f.call("Agent", input("worker", "x".repeat(MAX_TASK_CHARS + 1))), /at most/);
  await assert.rejects(f.call("Agent", input(), Object.create(f.ctx, { sessionManager: { value: { getSessionId: () => "foreign" } } })), /active parent/);
  assert.equal(f.births.length, 0);
});

test("project agent dispatch is denied if trust was revoked after registration", async (t) => {
  const f = fixture(t); f.put(".pi/agents/author.md", definition("author"));
  await f.emit("session_start"); f.trust(false);
  await assert.rejects(f.call("Agent", input("author")), /trust was revoked/);
  assert.equal(f.births.length, 0);
});

test("background work returns immediately, suppresses late updates and delivers once", async (t) => {
  const f = fixture(t); f.gate(true); await f.emit("session_start"); const updates = [];
  const started = await f.call("Agent", input("planner", "Background", { run_in_background: true }), f.ctx, undefined, (value) => updates.push(value));
  assert.match(started.content[0].text, /Started/);
  const before = updates.length; f.children.values().next().value.finish();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(updates.length, before); assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].delivery.triggerTurn, true);
  const result = await f.call("get_subagent_result", { session_id: "child-1" });
  assert.match(result.content[0].text, /child report/);
  await f.emit("agent_settled", {}); await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.messages.length, 1);
});

test("parent abort and shutdown stop owned children and invalidate old tool closures", async (t) => {
  const f = fixture(t); f.gate(true); await f.emit("session_start");
  await f.call("Agent", input("planner", "Background", { run_in_background: true }));
  await f.emit("agent_settled", { aborted: true }); assert.equal(f.aborted[0].reason, "user");
  const old = f.tools.get("Agent");
  await f.emit("session_shutdown", { reason: "reload" });
  assert.equal(f.children.size, 0); assert.equal(f.bindings.resolveParent("parent"), undefined);
  await assert.rejects(old.execute("late", input(), undefined, undefined, f.ctx), /active parent/);
});

test("only owned results can be pulled and only owned work can be stopped", async (t) => {
  const f = fixture(t); await f.emit("session_start");
  await assert.rejects(f.call("get_subagent_result", { session_id: "foreign" }), /Unknown subagent/);
  const logs = []; t.mock.method(console, "log", (message) => logs.push(message));
  await f.commands.get("subagents").handler("stop foreign", f.ctx);
  assert.equal(f.aborted.length, 0); assert.match(logs[0], /No matching/);
});

test("bounded reports never hide a full report in details and custom turn limits are clamped", async (t) => {
  const f = fixture(t, { report: "🪶".repeat(50000) });
  f.put("personal/agents/capped.md", definition("capped", "max_turns: 100000\n"));
  await f.emit("session_start");
  const result = await f.call("Agent", input("capped"));
  assert.ok(Buffer.byteLength(result.content[0].text) <= 32768);
  assert.match(result.content[0].text, /truncated/);
  assert.equal(f.runs[0].maxTurns, 64);
});

test("child retention is bounded even when old finished results are retained", async (t) => {
  const f = fixture(t); await f.emit("session_start");
  for (let index = 0; index < MAX_CHILDREN; index++) await f.call("Agent", input());
  await assert.rejects(f.call("Agent", input()), /already owns/);
  assert.equal(f.births.length, MAX_CHILDREN);
});

test("child safety reuses Wiki protections and disables recursion/tool-discovery bridges", async (t) => {
  const f = fixture(t); const handlers = [];
  childSafety({ on: (_name, handler) => handlers.push(handler) });
  const call = (toolName, input) => handlers[0]({ toolName, input }, f.ctx);
  for (const file of ["wiki/_rules.md", "wiki/.last-update.json", "wiki/INSTRUCTIONS.md", "wiki/_domains.json"]) assert.equal(call("write", { path: file }).block, true);
  assert.equal(call("Agent", {}).block, true); assert.equal(call("mcp__server_tool", {}).block, true); assert.equal(call("tool_search", {}).block, true);
  assert.equal(call("write", { path: "src/worker.ts" }), undefined);
});

test("vendored sources carry provenance and upstream tests stay byte-identical", () => {
  const root = fileURLToPath(new URL("subagents/vendor/thinkrail/", rootUrl));
  const origin = JSON.parse(fs.readFileSync(path.join(root, "ORIGIN.json"), "utf8"));
  assert.equal(origin.commit, "883affb98416fddd2d8c4f7f18fba92cc435cb4b");
  assert.deepEqual(origin.patchedFiles, ["pi-subagents/src/extension.ts", "pi-subagents/src/mapping.ts", "pi-subagents/src/definitions.ts", "pi-delegation/src/service.ts"]);
  assert.ok(fs.readFileSync(path.join(root, "pi-learn.patch"), "utf8").includes("discoverAgents"));
  assert.match(fs.readFileSync(path.join(root, "LICENSE"), "utf8"), /Apache License/);
  for (const [file, expected] of Object.entries(origin.originalSha256)) {
    if (origin.patchedFiles.includes(file)) continue;
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"), expected, file);
  }
});
