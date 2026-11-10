// Optional: real installed Pi loader/TypeBox, isolated fixture cwd + agentDir.
// Never constructs an LLM/provider/session or reads user settings, credentials or session logs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const piBin = process.env.PI_TEST_BIN ?? execFileSync(process.platform === "win32" ? "where" : "which", ["pi"], { encoding: "utf8" }).trim().split(/\r?\n/u)[0];
// Resolve import-only SDK exports with ESM conditions at the installed CLI, not CJS require.resolve.
const [sdkUrl, valueUrl] = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
  'console.log(JSON.stringify(["@earendil-works/pi-coding-agent", "typebox/value"].map(name => import.meta.resolve(name))))',
], { cwd: path.dirname(realpathSync(piBin)), encoding: "utf8" }));
const sdk = await import(sdkUrl);
const { Check } = await import(valueUrl);
const extensionPath = process.env.PI_TEST_WIKI_EXTENSION ?? fileURLToPath(new URL("../../extensions/wiki/index.ts", import.meta.url));

test("real Pi loader/TypeBox handle one Wiki entrypoint and headless factory replacement", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-wiki-host-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project"), agentDir = path.join(root, "isolated-agent");
  mkdirSync(path.join(cwd, "wiki"), { recursive: true }); mkdirSync(agentDir);
  writeFileSync(path.join(cwd, "wiki/guide.md"), "# Guide\nneedle\n");
  writeFileSync(path.join(cwd, "wiki/_rules.md"), "# Fixture\n");
  writeFileSync(path.join(cwd, "wiki/tagged.md"), "---\nid: tagged\ntype: module-design\ntitle: Tagged\ncustom: !unresolved WARNING_SOURCE_SENTINEL\n---\nbody\n");
  const prompts = [], notifications = [];
  const load = async () => {
    const loaded = await sdk.discoverAndLoadExtensions([path.dirname(extensionPath)], cwd, agentDir);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1, "helpers/vendor must not be discovered as extra extensions");
    loaded.runtime.sendUserMessage = (content) => prompts.push(content);
    return loaded.extensions[0];
  };
  const extension = await load();
  const warnings = [];
  t.mock.method(process, "emitWarning", (...args) => warnings.push(args));
  t.mock.method(console, "log", (message) => notifications.push(message));
  const names = ["wiki_search", "wiki_get", "wiki_locate", "wiki_rules", "wiki_graph", "wiki_validate"];
  assert.deepEqual([...extension.tools.keys()], [...names, "wiki_spec_create", "wiki_spec_update"]);
  assert.deepEqual([...extension.commands.keys()], ["wiki", "wiki-update"]);
  const ctx = { cwd, mode: "print", hasUI: false, isIdle: () => true, model: { provider: "fixture", id: "model" },
    get ui() { throw new Error("Headless tools must not access UI"); },
  };
  const emit = async (owner, name) => {
    for (const handler of owner.handlers.get(name) ?? []) await handler({ reason: "reload" }, ctx);
  };
  const invoke = async (owner, name, params) => {
    const definition = owner.tools.get(name).definition;
    assert.equal(Check(definition.parameters, params), true);
    return definition.execute("smoke", params, undefined, undefined, ctx);
  };
  for (const name of names) assert.equal(extension.tools.get(name).definition.annotations.readOnlyHint, true);
  assert.equal(Check(extension.tools.get("wiki_get").definition.parameters, { id: "x", heading: "Body" }), true);
  assert.equal(Check(extension.tools.get("wiki_get").definition.parameters, { id: "x", occurrence: 0 }), false);
  assert.equal(Check(extension.tools.get("wiki_graph").definition.parameters, { root: "x", direction: "neighbors", depth: 5 }), false);
  assert.equal(Check(extension.tools.get("wiki_search").definition.parameters, { pattern: "x", scope: "invalid" }), false);
  await emit(extension, "session_start");
  const search = await invoke(extension, "wiki_search", { pattern: "needle" });
  assert.equal(JSON.parse(search.content[0].text).data.matches.length, 1);
  assert.equal(JSON.parse((await invoke(extension, "wiki_get", { path: "guide.md" })).content[0].text).data.kind, "guide");
  assert.equal(JSON.parse((await invoke(extension, "wiki_graph", { root: "tagged", direction: "neighbors" })).content[0].text).data.nodes.length, 1);
  const validation = JSON.parse((await invoke(extension, "wiki_validate", { scope: "all" })).content[0].text).data;
  assert.equal(validation.valid, true);
  assert.ok(validation.diagnostics.some((issue) => issue.code === "frontmatter_warning"));
  assert.equal(JSON.stringify(validation).includes("WARNING_SOURCE_SENTINEL"), false);
  const contract = path.join(cwd, "wiki/contract.md");
  writeFileSync(contract, "---\nid: contract\ntype: module-design\ntitle: Contract\ndepends-on: [missing]\n---\nbody\n");
  await extension.commands.get("wiki-update").handler("Check this contract", ctx);
  assert.match(prompts.at(-1), /wiki_graph: small depth/);
  await emit(extension, "agent_settled");
  const metadata = () => JSON.parse(readFileSync(path.join(cwd, "wiki/.last-update.json"), "utf8"));
  assert.equal(metadata().status, "interrupted");
  assert.match(notifications.at(-1), /dangling_link/);
  writeFileSync(contract, "---\nid: contract\ntype: module-design\ntitle: Contract\n---\nbody\n");
  await extension.commands.get("wiki-update").handler("Confirm repaired contract", ctx);
  await emit(extension, "agent_settled");
  assert.equal(metadata().status, "complete");
  assert.match(notifications.at(-1), /interrupted metadata cleared/);
  const createParams = { path: "new.md", id: "new", type: "module-design", title: "New", sourcePaths: ["src/new/"] };
  assert.equal((await invoke(extension, "wiki_spec_create", createParams)).details.errorCode, "write_not_authorized");
  assert.equal(Check(extension.tools.get("wiki_spec_create").definition.parameters, { ...createParams, status: "active" }), false);
  await extension.commands.get("wiki-update").handler("Add uncovered module", ctx);
  const created = await invoke(extension, "wiki_spec_create", createParams);
  assert.equal(created.isError, undefined);
  const specMetadata = JSON.parse((await invoke(extension, "wiki_get", { id: "new" })).content[0].text).data;
  const updated = await invoke(extension, "wiki_spec_update", { id: "new", expectedRevision: specMetadata.revision, set: { title: "Updated" }, addList: { tags: ["smoke"] } });
  assert.equal(updated.isError, undefined);
  const currentSpec = JSON.parse((await invoke(extension, "wiki_get", { id: "new" })).content[0].text).data;
  assert.equal(currentSpec.frontmatter.title, "Updated");
  assert.equal(JSON.parse((await invoke(extension, "wiki_locate", { sourcePath: "src/new/file.ts" })).content[0].text).data.matches[0].id, "new");
  assert.equal(JSON.parse((await invoke(extension, "wiki_get", { id: "new", heading: "Boundary" })).content[0].text).data.section.anchor, "boundary");
  assert.equal(JSON.parse((await invoke(extension, "wiki_rules", { paths: ["src/new/file.ts"], task: "code" })).content[0].text).data.mode, "legacy");
  mkdirSync(path.join(cwd, "wiki/policies"));
  writeFileSync(path.join(cwd, "wiki/policies/_rules.md"), "# Fixture policy\nPOLICY_BODY_SENTINEL\n");
  writeFileSync(path.join(cwd, "wiki/_domains.json"), JSON.stringify({ version: 1, domains: [{ id: "new", rule: "wiki/policies/_rules.md", paths: ["src/new/"], tasks: ["code"] }] }));
  const routed = await invoke(extension, "wiki_rules", { paths: ["src/new/file.ts"], task: "code" });
  assert.deepEqual(JSON.parse(routed.content[0].text).data.rulePaths, ["wiki/_rules.md", "wiki/policies/_rules.md"]);
  assert.equal(JSON.stringify(routed).includes("POLICY_BODY_SENTINEL"), false);
  let release, admitted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { admitted = resolve; });
  const target = path.join(cwd, currentSpec.path);
  const builtinLikeEdit = sdk.withFileMutationQueue(target, async () => {
    admitted(); await gate;
    writeFileSync(target, readFileSync(target, "utf8") + "External queued edit\n");
  });
  await started;
  const staleUpdate = invoke(extension, "wiki_spec_update", { id: "new", expectedRevision: currentSpec.revision, set: { title: "Must not overwrite" } });
  release(); await builtinLikeEdit;
  assert.equal((await staleUpdate).details.errorCode, "stale_revision");
  assert.ok(readFileSync(target, "utf8").endsWith("External queued edit\n"));
  await emit(extension, "agent_settled");
  assert.equal(metadata().status, "complete");
  await emit(extension, "session_shutdown");
  assert.equal((await invoke(extension, "wiki_search", { pattern: "needle" })).details.errorCode, "session_inactive");
  const replacement = await load();
  await emit(replacement, "session_start");
  assert.equal(JSON.parse((await invoke(replacement, "wiki_search", { pattern: "needle" })).content[0].text).data.matches.length, 1);
  assert.equal((await invoke(extension, "wiki_search", { pattern: "needle" })).details.errorCode, "session_inactive");
  await emit(replacement, "session_shutdown");
  assert.deepEqual(warnings, []);
});
