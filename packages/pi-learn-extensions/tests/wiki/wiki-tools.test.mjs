import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Node unit tests do not require installing Pi/TypeBox peers or reading user settings.
// Actual TypeBox + Pi loader are checked separately in an isolated host smoke test.
const typebox = `
const optional = Symbol('optional');
export const Type = {
  String: (options = {}) => ({ type: 'string', ...options }),
  Boolean: (options = {}) => ({ type: 'boolean', ...options }),
  Integer: (options = {}) => ({ type: 'integer', ...options }),
  Array: (items, options = {}) => ({ type: 'array', items, ...options }),
  Unsafe: (schema) => schema,
  Optional: (schema) => ({ ...schema, [optional]: true }),
  Object: (properties, options = {}) => ({ type: 'object', properties,
    required: Object.keys(properties).filter((key) => !properties[key][optional]), ...options }),
};`;
const entry = new URL("../../extensions/wiki/index.ts", import.meta.url);
const commands = new URL("../../extensions/wiki/wiki-commands.ts", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "typebox") return { url: "data:text/javascript," + encodeURIComponent(typebox), shortCircuit: true };
  if (specifier === "@earendil-works/pi-coding-agent") return { url: "data:text/javascript," + encodeURIComponent('export const withFileMutationQueue = async (_path, operation) => operation();'), shortCircuit: true };
  if ((context.parentURL === entry.href && specifier === "./wiki-commands.js") || (context.parentURL === commands.href && specifier === "./wiki-prompt.js")) {
    return next(new URL(specifier.replace(/\.js$/u, ".ts"), context.parentURL).href, context);
  }
  return next(specifier, context);
} });
const { default: wikiExtension } = await import(entry.href);
const { registerWikiReadTools, wikiReadResult, MAX_WIKI_TOOL_OUTPUT_BYTES } = await import("../../extensions/wiki/wiki-tools.ts");
const { WikiReadModel } = await import("../../extensions/wiki/wiki-model.ts");
hooks.deregister();

function fixture(t, options = {}) {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), "pi-wiki-tools-"));
  function put(relative, content) {
    const absolute = path.join(cwd, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    return absolute;
  }
  put("wiki/_rules.md", "# Fixture rules\n\n## TEST-RULE-001 — Fixture\n\nRULE_BODY_SENTINEL\n");
  const tools = new Map(), registeredCommands = new Map(), handlers = new Map();
  const pi = {
    registerTool(tool) { assert.equal(tools.has(tool.name), false); tools.set(tool.name, tool); },
    registerCommand(name, command) { registeredCommands.set(name, command); },
    on(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    sendUserMessage() { if (!options.allowPrompt) throw new Error("Read tools must not start agent turns"); },
  };
  const ctx = { cwd, hasUI: false, isIdle: () => true,
    get ui() { throw new Error("Read tools must not touch UI"); },
  };
  const emit = async (name, event = {}, context = ctx) => {
    const results = [];
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context));
    return results;
  };
  if (options.createModel) registerWikiReadTools(pi, options.createModel);
  else wikiExtension(pi);
  const call = (name, params = {}, context = ctx, signal = undefined) => tools.get(name).execute("fixture", params, signal, undefined, context);
  t.after(async () => { await emit("session_shutdown"); fs.rmSync(cwd, { recursive: true, force: true }); });
  return { cwd, put, ctx, pi, emit, call, tools, commands: registeredCommands };
}
function spec(id, fields = "", body = "# Body\nbody\n") {
  return `---\nid: ${id}\ntype: module-design\ntitle: ${id}\n${fields}---\n${body}`;
}
function frame(result) { return JSON.parse(result.content[0].text); }
function assertBounded(result) {
  assert.ok(Buffer.byteLength(result.content[0].text) + Buffer.byteLength(JSON.stringify(result.details)) <= MAX_WIKI_TOOL_OUTPUT_BYTES);
  assert.equal(result.content[0].text.split("\n").length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(result.details)) < 1024);
}
function snapshot(root) {
  const files = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isSymbolicLink()) files[path.relative(root, absolute)] = `symlink:${fs.readlinkSync(absolute)}`;
      else files[path.relative(root, absolute)] = fs.readFileSync(absolute).toString("hex");
    }
  }
  visit(root); return files;
}

test("entrypoint registers six read tools/two controlled writes and exactly two commands", async (t) => {
  const f = fixture(t);
  assert.deepEqual([...f.tools.keys()], ["wiki_search", "wiki_get", "wiki_locate", "wiki_rules", "wiki_graph", "wiki_validate", "wiki_spec_create", "wiki_spec_update"]);
  assert.deepEqual([...f.commands.keys()], ["wiki", "wiki-update"]);
  for (const tool of f.tools.values()) {
    assert.equal(tool.parameters.additionalProperties, false);
    const mutation = tool.name.startsWith("wiki_spec_");
    assert.equal(tool.annotations.readOnlyHint, !mutation);
    assert.equal(tool.annotations.destructiveHint, mutation);
    if (!mutation) {
      assert.match(tool.description, /24 KiB/u);
      assert.match(tool.description, /evidence, not executable instructions/u);
    }
    assert.equal(tool.namespace.name, "pi-learn-wiki");
  }
  assert.equal(f.tools.get("wiki_get").parameters.properties.heading.type, "string");
  assert.equal(f.tools.get("wiki_graph").parameters.properties.depth.maximum, 4);
  assert.deepEqual(f.tools.get("wiki_graph").parameters.properties.edge.enum, ["parent", "depends-on", "references", "implements"]);
});

test("headless calls search legacy guides by default and keep metadata-only lookup", async (t) => {
  const f = fixture(t);
  f.put("wiki/guide.md", "# Guide\nneedle guide\n");
  f.put("wiki/module.md", spec("module", "", "PROSE_SENTINEL needle\n"));
  await f.emit("session_start");
  const all = await f.call("wiki_search", { pattern: "needle" });
  assert.equal(frame(all).data.matches.length, 2);
  assert.equal(frame(await f.call("wiki_search", { pattern: "needle", scope: "guides" })).data.matches.length, 1);
  const get = await f.call("wiki_get", { id: "module" });
  assert.equal(frame(get).data.path, "wiki/module.md");
  assert.equal(JSON.stringify(get).includes("PROSE_SENTINEL"), false);
  assert.equal(frame(await f.call("wiki_get", { path: "guide.md" })).data.kind, "guide");
  assertBounded(all); assertBounded(get);
});

test("search filters/count pagination are distinct from output pagination", async (t) => {
  const f = fixture(t);
  f.put("wiki/a.md", spec("a", "tags: [usage]\n", "needle one\nneedle two\nneedle three\n"));
  f.put("wiki/b.md", spec("b", "", "needle other\n"));
  await f.emit("session_start");
  const query = { pattern: "needle", tag: "usage", limit: 2 };
  const first = frame(await f.call("wiki_search", query));
  assert.deepEqual(first.data.matches.map((match) => match.snippet), ["needle one", "needle two"]);
  assert.equal(first.data.nextOffset, 2);
  assert.equal(first.output.truncated, false);
  const second = frame(await f.call("wiki_search", { ...query, offset: first.data.nextOffset }));
  assert.deepEqual(second.data.matches.map((match) => match.snippet), ["needle three"]);
});

test("graph returns forward/reverse neighbors without frontmatter or prose dumps", async (t) => {
  const f = fixture(t);
  f.put("wiki/usage.md", spec("usage", "notes: FRONTMATTER_SENTINEL\n", "PROSE_SENTINEL\n"));
  f.put("wiki/aurora.md", spec("aurora", "depends-on: [usage]\n"));
  await f.emit("session_start");
  const graph = await f.call("wiki_graph", { root: "usage", direction: "neighbors" });
  assert.deepEqual(frame(graph).data.nodes.map((node) => node.id), ["usage", "aurora"]);
  assert.deepEqual(frame(graph).data.edges, [{ from: "aurora", to: "usage", kind: "depends-on" }]);
  assert.equal(JSON.stringify(graph).includes("SENTINEL"), false);
  const metadata = frame(await f.call("wiki_get", { id: "usage" })).data;
  assert.deepEqual(metadata.links.reverse["depends-on"], ["aurora"]);
});

test("validation defaults to graph; explicit rules lint never returns rule or brief text", async (t) => {
  const f = fixture(t);
  f.put("wiki/guide.md", "# Guide\ntext\n");
  f.put("wiki/INSTRUCTIONS.md", "BRIEF_BODY_SENTINEL");
  f.put("wiki/_rules.md", "# Fixture\nOrigin proposal: RULE_BODY_SENTINEL\n");
  await f.emit("session_start");
  const opened = [];
  const original = fs.openSync;
  const mock = t.mock.method(fs, "openSync", (file, ...args) => { opened.push(String(file)); return original(file, ...args); });
  syncBuiltinESMExports();
  try {
    const graph = frame(await f.call("wiki_validate"));
    assert.deepEqual(Object.keys(graph.data.groups), ["graph"]);
    assert.equal(graph.data.valid, true);
    assert.equal(opened.some((file) => file.endsWith("_rules.md")), false);
    opened.length = 0;
    const rules = await f.call("wiki_validate", { scope: "rules" });
    assert.equal(frame(rules).data.valid, false);
    assert.ok(frame(rules).data.diagnostics.some((issue) => issue.scope === "rules" && issue.code === "invalid_origin_proposal"));
    assert.equal(opened.some((file) => file.endsWith("_rules.md")), true);
    assert.equal(opened.some((file) => file.endsWith("INSTRUCTIONS.md")), false);
    assert.equal(opened.some((file) => file.endsWith("guide.md")), false);
    assert.equal(JSON.stringify(rules).includes("BODY_SENTINEL"), false);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

test("all validation groups report independently and never create missing scaffolds", async (t) => {
  const f = fixture(t);
  f.put("wiki/domain/SPEC.md", "---\nid: partial\n---\n[missing](no-file.md)\n");
  fs.rmSync(path.join(f.cwd, "wiki/_rules.md"));
  const before = snapshot(f.cwd);
  await f.emit("session_start");
  const result = await f.call("wiki_validate", { scope: "all" });
  const data = frame(result).data;
  assert.equal(result.isError, undefined, "findings are report data, not execution failures");
  assert.deepEqual(Object.keys(data.groups), ["graph", "links", "rules"]);
  for (const group of ["graph", "links", "rules"]) assert.equal(data.groups[group].valid, false);
  assert.deepEqual(new Set(data.diagnostics.map((issue) => issue.scope)), new Set(["graph", "links", "rules"]));
  assert.deepEqual(snapshot(f.cwd), before);
});

test("links validation reuses Unicode/duplicate anchor semantics but excludes protected targets", async (t) => {
  const f = fixture(t);
  f.put("wiki/a.md", "# Tổng quan\n# Tổng quan\n[ok](#tổng-quan-1)\n[bad](INSTRUCTIONS.md#brief)\n[download](assets/manual.txt)\n[assets](assets/)\n[root](/)\n[rules](_rules.md)\n[brief](INSTRUCTIONS.md)\n");
  f.put("wiki/INSTRUCTIONS.md", "# brief\nBRIEF_SENTINEL");
  f.put("wiki/assets/manual.txt", "ASSET_BODY_SENTINEL");
  f.put("wiki/assets/ignored.md", "[bad](no-file.md)\n");
  await f.emit("session_start");
  const report = frame(await f.call("wiki_validate", { scope: "links" })).data;
  assert.equal(report.groups.links.filesScanned, 1);
  assert.equal(report.diagnostics.length, 1);
  assert.match(report.diagnostics[0].message, /reserved or excluded/u);
  assert.equal(JSON.stringify(report).includes("BRIEF_SENTINEL"), false);
  assert.equal(JSON.stringify(report).includes("ASSET_BODY_SENTINEL"), false);
});

test("rule symlinks cannot read an out-of-Wiki file even when legacy lint permits project-local targets", async (t) => {
  const f = fixture(t);
  const outside = f.put("outside.md", "# Fixture\nOrigin proposal: OUTSIDE_BODY_SENTINEL\n");
  fs.rmSync(path.join(f.cwd, "wiki/_rules.md"));
  fs.symlinkSync(outside, path.join(f.cwd, "wiki/_rules.md"));
  await f.emit("session_start");
  const opened = [];
  const original = fs.openSync;
  const mock = t.mock.method(fs, "openSync", (file, ...args) => { opened.push(String(file)); return original(file, ...args); });
  syncBuiltinESMExports();
  try {
    const result = await f.call("wiki_validate", { scope: "rules" });
    assert.equal(frame(result).data.valid, false);
    assert.ok(frame(result).data.diagnostics.some((issue) => issue.code === "unsafe_path"));
    assert.deepEqual(opened, []);
    assert.equal(JSON.stringify(result).includes("OUTSIDE_BODY_SENTINEL"), false);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

test("tool errors are bounded, actionable, and do not echo OS paths or raw parser errors", async (t) => {
  const f = fixture(t);
  f.put("wiki/a.md", spec("dup")); f.put("wiki/b.md", spec("dup"));
  await f.emit("session_start");
  const cases = [
    ["wiki_get", {}, "invalid_selector"],
    ["wiki_get", { path: "../outside.md" }, "reserved_path"],
    ["wiki_get", { path: "_rules.md" }, "reserved_path"],
    ["wiki_get", { id: "dup" }, "duplicate_id"],
    ["wiki_graph", { root: "dup", direction: "neighbors" }, "duplicate_id"],
    ["wiki_search", { pattern: "[", regex: true }, "invalid_regex"],
    ["wiki_graph", { root: "missing", direction: "subtree" }, "not_found"],
  ];
  for (const [tool, params, code] of cases) {
    const result = await f.call(tool, params);
    assert.equal(result.isError, true); assert.equal(result.details.errorCode, code); assertBounded(result);
  }
  const result = await f.call("wiki_search", { pattern: "" }, { cwd: path.join(f.cwd, "NONEXISTENT_PATH_SENTINEL"), hasUI: false });
  assert.equal(result.details.errorCode, "wiki_read_failed");
  assert.equal(JSON.stringify(result).includes("NONEXISTENT_PATH_SENTINEL"), false);
  assert.equal(JSON.stringify(result).includes(f.cwd), false);
});

test("JSON output pagination is lossless, Unicode-safe and bounds both content and details", () => {
  const data = { frontmatter: { notes: "界😀\\\"\n".repeat(16000) }, diagnostics: Array.from({ length: 150 }, (_, index) => ({ path: `wiki/${index}.md`, message: "diagnostic" })) };
  const fragments = [];
  let paging = {};
  do {
    const result = wikiReadResult(data, paging);
    assertBounded(result);
    const page = frame(result);
    assert.equal(page.format, "json-fragment");
    fragments.push(page.fragment);
    assert.equal(JSON.stringify(result.details).includes("frontmatter"), false);
    paging = page.output.continuation;
  } while (paging);
  assert.deepEqual(JSON.parse(fragments.join("")), data);
});

test("large metadata tools page without dumping prose or creating full-output files", async (t) => {
  const f = fixture(t);
  f.put("wiki/large.md", spec("large", `notes: ${"界😀".repeat(18000)}\n`, "PROSE_SENTINEL\n"));
  await f.emit("session_start");
  const before = snapshot(f.cwd);
  let paging = {}, fragments = [];
  do {
    const result = await f.call("wiki_get", { id: "large", ...paging });
    assertBounded(result);
    const page = frame(result);
    fragments.push(page.fragment);
    paging = page.output.continuation;
  } while (paging);
  const metadata = JSON.parse(fragments.join(""));
  assert.equal(metadata.frontmatter.notes, "界😀".repeat(18000));
  assert.equal(JSON.stringify(metadata).includes("PROSE_SENTINEL"), false);
  assert.deepEqual(snapshot(f.cwd), before);
});

test("output continuation requires a matching revision and cannot skip Unicode boundaries", async (t) => {
  const f = fixture(t);
  f.put("wiki/large.md", spec("large", `notes: ${"x".repeat(40000)}\n`));
  await f.emit("session_start");
  const first = frame(await f.call("wiki_get", { id: "large" }));
  const continuation = first.output.continuation;
  assert.equal((await f.call("wiki_get", { id: "large", outputOffset: continuation.outputOffset })).details.errorCode, "revision_required");
  f.put("wiki/large.md", spec("large", `notes: ${"y".repeat(40000)}\n`));
  assert.equal((await f.call("wiki_get", { id: "large", ...continuation })).details.errorCode, "stale_output");
  const data = { text: "😀".repeat(10000) };
  const initial = wikiReadResult(data);
  const serialized = JSON.stringify(data);
  const split = serialized.indexOf("😀") + 1;
  assert.throws(() => wikiReadResult(data, { outputOffset: split, expectedRevision: initial.details.revision }), /Unicode/u);
});

test("session/cwd lifetimes clear instance-owned caches and inactive/aborted tools do no reads", async (t) => {
  const roots = [];
  const f = fixture(t, { createModel: (root) => { roots.push(root); return new WikiReadModel(root); } });
  f.put("wiki/a.md", spec("a"));
  assert.equal((await f.call("wiki_get", { id: "a" })).details.errorCode, "session_inactive");
  const cancelled = new AbortController(); cancelled.abort();
  await f.emit("session_start");
  assert.equal((await f.call("wiki_get", { id: "a" }, f.ctx, cancelled.signal)).details.errorCode, "cancelled");
  assert.equal(roots.length, 0);
  await f.call("wiki_get", { id: "a" }); await f.call("wiki_get", { id: "a" });
  assert.equal(roots.length, 1);
  f.put("other/wiki/b.md", spec("b"));
  const other = { cwd: path.join(f.cwd, "other"), hasUI: false };
  assert.equal(frame(await f.call("wiki_get", { id: "b" }, other)).data.path, "wiki/b.md");
  assert.equal(roots.length, 2);
  await f.emit("session_shutdown");
  assert.equal((await f.call("wiki_get", { id: "a" })).details.errorCode, "session_inactive");
  await f.emit("session_start", { reason: "reload" });
  await f.call("wiki_get", { id: "a" }); assert.equal(roots.length, 3);
});

test("read tools do not grant rule/metadata write permissions or add commands", async (t) => {
  const f = fixture(t);
  f.put("wiki/guide.md", "# Guide\ntext\n");
  await f.emit("session_start");
  const before = snapshot(f.cwd);
  for (const [name, params] of [["wiki_search", { pattern: "Guide" }], ["wiki_get", { path: "guide.md" }], ["wiki_validate", { scope: "all" }]]) await f.call(name, params);
  for (const target of ["wiki/_rules.md", "wiki/.last-update.json"]) {
    const results = await f.emit("tool_call", { toolName: "write", input: { path: target } });
    assert.ok(results.some((result) => result?.block === true));
  }
  assert.deepEqual(snapshot(f.cwd), before);
  assert.deepEqual([...f.commands.keys()], ["wiki", "wiki-update"]);
});

test("missing or symlinked Wiki roots fail every validation group without following outside files", async (t) => {
  const f = fixture(t);
  f.put("outside/SPEC.md", spec("outside", "", "OUTSIDE_SENTINEL\n"));
  await f.emit("session_start");
  fs.rmSync(path.join(f.cwd, "wiki"), { recursive: true });
  const missing = frame(await f.call("wiki_validate", { scope: "all" })).data;
  assert.equal(missing.valid, false);
  assert.equal(missing.diagnostics.length, 3);
  assert.equal(fs.existsSync(path.join(f.cwd, "wiki")), false);
  fs.symlinkSync(path.join(f.cwd, "outside"), path.join(f.cwd, "wiki"), "dir");
  const linked = frame(await f.call("wiki_validate", { scope: "all" })).data;
  assert.equal(linked.valid, false);
  assert.equal(linked.diagnostics.length, 3);
  assert.ok(linked.diagnostics.every((issue) => issue.code === "wiki_invalid"));
  const search = await f.call("wiki_search", { pattern: "OUTSIDE_SENTINEL" });
  assert.equal(frame(search).data.matches.length, 0);
  assert.equal(JSON.stringify(search).includes("OUTSIDE_SENTINEL"), false);
});

test("rule read failures are scoped diagnostics and do not suppress other rule findings", async (t) => {
  const f = fixture(t);
  f.put("wiki/domain/guide.md", "# Guide\n");
  f.put("wiki/domain/_rules.md", Buffer.from([255]));
  f.put("wiki/_rules.md", "# Fixture\nOrigin proposal: RAW_POLICY_SENTINEL\n");
  await f.emit("session_start");
  const result = await f.call("wiki_validate", { scope: "rules" });
  const data = frame(result).data;
  assert.equal(data.valid, false);
  assert.ok(data.diagnostics.some((issue) => issue.path === "wiki/domain/_rules.md" && issue.code === "invalid_utf8"));
  assert.ok(data.diagnostics.some((issue) => issue.path === "wiki/_rules.md" && issue.code === "invalid_origin_proposal"));
  assert.equal(JSON.stringify(result).includes("RAW_POLICY_SENTINEL"), false);
});

test("YAML warnings become sanitized diagnostics without emitting source excerpts", async (t) => {
  const f = fixture(t);
  f.put("wiki/tagged.md", spec("tagged", "custom: !unresolved WARNING_SOURCE_SENTINEL\n"));
  const warnings = [];
  t.mock.method(process, "emitWarning", (...args) => warnings.push(args));
  await f.emit("session_start");
  const result = await f.call("wiki_validate");
  assert.equal(frame(result).data.valid, true);
  assert.ok(frame(result).data.diagnostics.some((issue) => issue.code === "frontmatter_warning" && issue.severity === "warning"));
  assert.equal(JSON.stringify(result).includes("WARNING_SOURCE_SENTINEL"), false);
  assert.deepEqual(warnings, []);
});

test("metadata tools are authorized only inside the same active run and cwd, and revoked on settle", async (t) => {
  const f = fixture(t, { allowPrompt: true });
  t.mock.method(console, "log", () => {});
  await f.emit("session_start");
  const input = { path: "new.md", id: "new", type: "module-design", title: "New" };
  assert.equal((await f.call("wiki_spec_create", input)).details.errorCode, "write_not_authorized");
  await f.commands.get("wiki-update").handler("Document a new module", f.ctx);
  assert.equal((await f.call("wiki_spec_create", input, { cwd: f.cwd + "/other" })).details.errorCode, "write_not_authorized");
  assert.equal(frame(await f.call("wiki_spec_create", input)).data.status, "draft");
  const original = frame(await f.call("wiki_get", { id: "new" })).data;
  const update = await f.call("wiki_spec_update", { id: "new", expectedRevision: original.revision, set: { title: "Changed" } });
  assert.equal(frame(update).data.changed, true);
  assert.equal(frame(await f.call("wiki_get", { id: "new" })).data.frontmatter.title, "Changed");
  await f.emit("agent_settled");
  assert.equal((await f.call("wiki_spec_create", { ...input, path: "other.md", id: "other" })).details.errorCode, "write_not_authorized");
  const metadata = JSON.parse(fs.readFileSync(path.join(f.cwd, "wiki/.last-update.json"), "utf8"));
  assert.equal(metadata.status, "complete");
});

test("new authoring tools never convert legacy guides or write reserved resources in an active run", async (t) => {
  const f = fixture(t, { allowPrompt: true });
  t.mock.method(console, "log", () => {});
  f.put("wiki/guide.md", "# Preserve guide\n");
  const before = fs.readFileSync(path.join(f.cwd, "wiki/_rules.md"), "utf8");
  await f.emit("session_start");
  await f.commands.get("wiki").handler("New documentation", f.ctx);
  for (const target of ["_rules.md", "INSTRUCTIONS.md", ".last-update.json", "../outside.md"]) {
    assert.equal((await f.call("wiki_spec_create", { path: target, id: "bad", type: "module-design", title: "Bad" })).details.errorCode, "reserved_path");
  }
  assert.equal((await f.call("wiki_spec_create", { path: "guide.md", id: "guide", type: "module-design", title: "Guide" })).details.errorCode, "already_exists");
  assert.equal(fs.readFileSync(path.join(f.cwd, "wiki/guide.md"), "utf8"), "# Preserve guide\n");
  assert.equal(fs.readFileSync(path.join(f.cwd, "wiki/_rules.md"), "utf8"), before);
});

test("large explicit sections page losslessly and reject stale continuations", async (t) => {
  const f = fixture(t);
  const body = "## Target\r\n" + 'verbatim 🪶" '.repeat(5000) + "\r\n### Child\r\nchild\r\n";
  f.put("wiki/large.md", spec("large", "", body + "## Other\r\nOTHER_BODY_SENTINEL\r\n"));
  await f.emit("session_start");
  const query = { id: "large", heading: "Target" };
  let result = await f.call("wiki_get", query), part = frame(result), serialized = "";
  assert.equal(part.format, "json-fragment");
  const oldCursor = part.output.continuation;
  for (let pages = 0; ; pages++) {
    assertBounded(result); assert.ok(pages < 100);
    serialized += part.fragment;
    if (!part.output.continuation) break;
    result = await f.call("wiki_get", { ...query, ...part.output.continuation }); part = frame(result);
  }
  assert.equal(JSON.parse(serialized).section.content, body);
  assert.equal(serialized.includes("OTHER_BODY_SENTINEL"), false);
  f.put("wiki/large.md", spec("large", "", body + "edited\n"));
  assert.equal((await f.call("wiki_get", { ...query, ...oldCursor })).details.errorCode, "stale_output");
});

test("routing tools use declarations only and policy config stays reserved", async (t) => {
  const f = fixture(t);
  f.put("wiki/mapped.md", spec("mapped", 'source-paths: ["src/"]\n'));
  f.put("wiki/_domains.json", JSON.stringify({ version: 1, domains: [{ id: "code", rule: "wiki/code/_rules.md", paths: ["src/"] }] }));
  f.put("wiki/code/_rules.md", "# Rules\nPOLICY_CONTENT_SENTINEL\n");
  await f.emit("session_start");
  assert.equal(frame(await f.call("wiki_locate", { sourcePath: "src/file.ts" })).data.matches[0].id, "mapped");
  const rules = await f.call("wiki_rules", { paths: ["src/file.ts"], task: "code" });
  assert.deepEqual(frame(rules).data.rulePaths, ["wiki/_rules.md", "wiki/code/_rules.md"]);
  assert.equal(JSON.stringify(rules).includes("POLICY_CONTENT_SENTINEL"), false); assertBounded(rules);
  assert.equal((await f.call("wiki_get", { path: "_domains.json" })).details.errorCode, "reserved_path");
  assert.equal(frame(await f.call("wiki_search", { pattern: "POLICY_CONTENT_SENTINEL" })).data.matches.length, 0);
  f.put("wiki/_domains.json", "INVALID_CONFIG_BODY_SENTINEL");
  const invalid = await f.call("wiki_rules", { paths: [], task: "code" });
  assert.equal(invalid.details.errorCode, "invalid_policy_config");
  assert.equal(JSON.stringify(invalid).includes("INVALID_CONFIG_BODY_SENTINEL"), false);
});

test("one extension instance cannot borrow another instance's active run, even at the same cwd", async (t) => {
  const first = fixture(t, { allowPrompt: true });
  const second = fixture(t, { allowPrompt: true });
  t.mock.method(console, "log", () => {});
  await first.emit("session_start"); await second.emit("session_start");
  await first.commands.get("wiki-update").handler("New docs", first.ctx);
  const input = { path: "new.md", id: "new", type: "module-design", title: "New" };
  assert.equal((await second.call("wiki_spec_create", input, first.ctx)).details.errorCode, "write_not_authorized");
  assert.equal(frame(await first.call("wiki_spec_create", input)).data.id, "new");
  await first.emit("session_shutdown");
  assert.equal((await first.call("wiki_spec_create", input)).details.errorCode, "session_inactive");
});
