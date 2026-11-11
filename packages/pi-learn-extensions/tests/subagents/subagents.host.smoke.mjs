// Real Pi loader + provider loop, isolated stores and synthetic model responses only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const pi = process.env.PI_TEST_BIN ?? execFileSync(process.platform === "win32" ? "where" : "which", ["pi"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
const names = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-ai/providers/faux", "typebox/value"];
const peers = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `console.log(JSON.stringify(${JSON.stringify(names)}.map(name=>import.meta.resolve(name))))`], { cwd: path.dirname(realpathSync(pi)), encoding: "utf8" }));
const [sdk, ai, fauxModule] = await Promise.all(peers.slice(0, 3).map((url) => import(url)));
const { Check } = await import(peers[3]);
const extensionPath = process.env.PI_TEST_SUBAGENTS_EXTENSION ?? fileURLToPath(new URL("../../extensions/subagents/index.ts", import.meta.url));

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "pi-learn-subagents-host-"));
  const cwd = path.join(root, "project"), agentDir = path.join(root, "agent");
  mkdirSync(cwd); mkdirSync(agentDir); mkdirSync(path.join(cwd, "wiki"));
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Fixture\nPROJECT_GUIDANCE_SENTINEL: Respect local contracts.\n");
  writeFileSync(path.join(cwd, "wiki/_rules.md"), "# Fixture rules\n");
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let owned;
  t.after(async () => {
    try { if (owned) { await owned.abort(); await owned.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); } }
    finally { owned?.dispose(); if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); }
  });
  const faux = fauxModule.createFauxCore({ provider: "child-probe", api: "child-probe", models: [{ id: "test-model", reasoning: true, contextWindow: 100000, maxTokens: 4096 }], tokensPerSecond: 100000 });
  const runtime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const requests = [];
  runtime.registerProvider("child-probe", { api: faux.api, baseUrl: "http://faux.invalid", models: faux.models, streamSimple: (model, context, options) => { requests.push({ model, context, options }); return faux.streamSimple(model, context, options); } });
  await runtime.setRuntimeApiKey("child-probe", "RUNTIME_ONLY_SYNTHETIC_KEY");
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, packages: [] }, { projectTrusted: true });
  const discovered = await sdk.discoverAndLoadExtensions([path.dirname(extensionPath)], cwd, agentDir);
  assert.deepEqual(discovered.errors, []);
  assert.equal(discovered.extensions.length, 1, "vendor/helper modules must not be discovered as extra extensions");
  const resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, additionalExtensionPaths: [extensionPath], noSkills: true, noPromptTemplates: true, noThemes: true });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  assert.equal(resourceLoader.getExtensions().extensions.length, 1);
  const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, model: runtime.getModel("child-probe", "test-model"), thinkingLevel: "low", settingsManager, resourceLoader, sessionManager: sdk.SessionManager.inMemory(cwd) });
  owned = session;
  await session.bindExtensions({ mode: "print" });
  return { root, cwd, agentDir, faux, runtime, requests, session, resourceLoader };
}
const toolsOf = (context) => context.messages.filter((message) => message.role === "system").flatMap((message) => message.toolsAdded ?? []).map((tool) => tool.name);
const results = (session, name) => session.messages.filter((message) => message.role === "toolResult" && message.toolName === name);

test("real host delegates foreground with parent runtime auth, separate context and bounded tools", async (t) => {
  const f = await fixture(t);
  assert.ok(f.session.getActiveToolNames().includes("Agent"));
  f.faux.setResponses([
    () => fauxModule.fauxAssistantMessage(fauxModule.fauxToolCall("Agent", { subagent_type: "planner", task: "CHILD_TASK_SENTINEL: inspect only" }), { stopReason: "toolUse" }),
    (context) => {
      const body = JSON.stringify(context);
      assert.match(body, /CHILD_TASK_SENTINEL/);
      assert.match(body, /PROJECT_GUIDANCE_SENTINEL/);
      assert.ok(toolsOf(context).includes("read"));
      assert.equal(body.includes("PARENT_PRIVATE_CONTEXT_SENTINEL"), false);
      assert.equal(body.includes("RUNTIME_ONLY_SYNTHETIC_KEY"), false);
      assert.equal(toolsOf(context).includes("Agent"), false);
      assert.equal(toolsOf(context).includes("write"), false);
      assert.equal(toolsOf(context).includes("edit"), false);
      return fauxModule.fauxAssistantMessage("CHILD_REPORT_SENTINEL");
    },
    () => fauxModule.fauxAssistantMessage("Parent finished"),
  ]);
  await f.session.prompt("PARENT_PRIVATE_CONTEXT_SENTINEL: Delegate an independent plan.");
  const report = results(f.session, "Agent").at(-1);
  assert.equal(report.isError, false, JSON.stringify(report));
  assert.match(JSON.stringify(report.content), /CHILD_REPORT_SENTINEL/);
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[1].model.provider, "child-probe");
  assert.equal(f.requests[1].model.id, "test-model");
  assert.equal(f.requests[1].options.apiKey, "RUNTIME_ONLY_SYNTHETIC_KEY");
  const definitions = f.resourceLoader.getExtensions().extensions[0].tools;
  assert.equal(Check(definitions.get("Agent").definition.parameters, { subagent_type: "worker", task: "Work", surprise: true }), false);
});

test("real host enforces child Wiki guards without inheriting parent mutation authority", async (t) => {
  const f = await fixture(t);
  f.faux.setResponses([
    () => fauxModule.fauxAssistantMessage(fauxModule.fauxToolCall("Agent", { subagent_type: "worker", task: "Try a protected Wiki write, then report the denial" }), { stopReason: "toolUse" }),
    () => fauxModule.fauxAssistantMessage(fauxModule.fauxToolCall("write", { path: "wiki/_rules.md", content: "BAD_POLICY_SENTINEL" }), { stopReason: "toolUse" }),
    (context) => {
      assert.match(JSON.stringify(context.messages.at(-1)), /cannot mutate Wiki/);
      return fauxModule.fauxAssistantMessage("Protected write denied");
    },
    () => fauxModule.fauxAssistantMessage("Parent done"),
  ]);
  await f.session.prompt("Run a worker safety probe");
  assert.equal(results(f.session, "Agent").at(-1).isError, false);
});

test("real host delivers one background report and can collect its owned result", async (t) => {
  const f = await fixture(t);
  let started, release;
  const running = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  f.faux.setResponses([
    () => fauxModule.fauxAssistantMessage(fauxModule.fauxToolCall("Agent", { subagent_type: "planner", task: "Background probe", run_in_background: true }), { stopReason: "toolUse" }),
    async (context) => {
      if (JSON.stringify(context).includes("You are a planner")) { started(); await gate; return fauxModule.fauxAssistantMessage("BACKGROUND_REPORT_SENTINEL"); }
      return fauxModule.fauxAssistantMessage("Parent can do other work");
    },
    async (context) => {
      if (JSON.stringify(context).includes("You are a planner")) { started(); await gate; return fauxModule.fauxAssistantMessage("BACKGROUND_REPORT_SENTINEL"); }
      return fauxModule.fauxAssistantMessage("Parent can do other work");
    },
    () => fauxModule.fauxAssistantMessage("Background report received"),
  ]);
  await f.session.prompt("Delegate in background");
  const created = results(f.session, "Agent").at(-1);
  assert.equal(created.isError, false, JSON.stringify(created));
  await Promise.race([running, new Promise((_, reject) => setTimeout(() => reject(new Error("Child did not start")), 5000))]);
  const childId = created.content[0].text.split(": ").at(-1);
  assert.ok(childId);
  release();
  const deadline = Date.now() + 5000;
  while (!f.session.messages.some((message) => message.role === "custom" && message.customType === "subagent-completion")) {
    assert.ok(Date.now() < deadline, "background completion must be delivered");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await f.session.waitForIdle();
  const messages = f.session.messages.filter((message) => message.role === "custom" && message.customType === "subagent-completion");
  assert.equal(messages.length, 1);
  assert.match(JSON.stringify(messages), /BACKGROUND_REPORT_SENTINEL/);
  f.faux.setResponses([
    () => fauxModule.fauxAssistantMessage(fauxModule.fauxToolCall("get_subagent_result", { session_id: childId }), { stopReason: "toolUse" }),
    () => fauxModule.fauxAssistantMessage("Collected"),
  ]);
  await f.session.prompt("Re-read the completed report");
  assert.match(JSON.stringify(results(f.session, "get_subagent_result").at(-1).content), /BACKGROUND_REPORT_SENTINEL/);
});
