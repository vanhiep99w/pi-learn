import assert from "node:assert/strict";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync,
  rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  isWikiReadPath, MAX_WIKI_DOCUMENT_BYTES, WikiModelError, WikiReadModel,
} from "../../extensions/wiki/wiki-model.ts";
import { SpecIndex } from "../../extensions/wiki/vendor/thinkrail-spec-graph/core/index.ts";

function fixture(t: test.TestContext) {
  const project = mkdtempSync(path.join(tmpdir(), "pi-wiki-model-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  function put(relative: string, content: string | Buffer) {
    const absolute = path.join(project, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    return absolute;
  }
  mkdirSync(path.join(project, "wiki"));
  return { project, put, model: new WikiReadModel(project) };
}

function spec(id: string, fields = "", body = "# Contract\nUsage data contract.\n") {
  return `---\nid: ${id}\ntype: module-design\ntitle: ${id}\nstatus: draft\n${fields}---\n${body}`;
}

const errorCode = (code: string) => (error: unknown) => error instanceof WikiModelError && error.code === code;

test("read path policy excludes reserved/private/scratch/assets before reading", () => {
  for (const target of [
    "_rules.md", "domain/_rules.md", "INSTRUCTIONS.md", "domain/instructions.md",
    "_plan.md", ".last-update.json", ".hidden/SPEC.md", "_scratch/SPEC.md",
    "assets/SPEC.md", "Assets/SPEC.md", "node_modules/SPEC.md", "NODE_MODULES/SPEC.md",
    "dist/SPEC.md", "build/SPEC.md", "../outside.md", "/outside.md", "C:outside.md",
    "file:SPEC.md", "dir\\SPEC.md", "module/../_rules.md", "file.MD", "",
  ]) assert.equal(isWikiReadPath(target), false, target);
  assert.equal(isWikiReadPath("modules/usage/SPEC.md"), true);
  assert.equal(isWikiReadPath("operations/testing.md"), true);
  assert.equal(isWikiReadPath("modules/usage", true), true);
});

test("indexes only wiki/, keeps guides outside graph, and get does not return body", (t) => {
  const { model, put } = fixture(t);
  put("wiki/modules/usage.md", spec("usage", "", "# Body\nBODY_SENTINEL\n"));
  put("wiki/operations/testing.md", "# Tests\nGuide sentinel\n");
  for (const target of ["source/SPEC.md", "docs/SPEC.md", ".pi/SPEC.md"]) put(target, spec("outside"));
  // Invalid bytes would trigger diagnostics if any protected document were read.
  for (const target of ["wiki/_rules.md", "wiki/INSTRUCTIONS.md", "wiki/_plan.md", "wiki/assets/SPEC.md", "wiki/.scratch/SPEC.md", "wiki/a/_rules.md"]) put(target, Buffer.from([255]));
  const snapshot = model.read();
  assert.deepEqual(snapshot.documents.map((document) => document.path), ["wiki/modules/usage.md", "wiki/operations/testing.md"]);
  assert.deepEqual([...snapshot.graph.nodes.keys()], ["usage"]);
  assert.deepEqual(snapshot.diagnostics, []);
  const metadata = model.get({ id: "usage" });
  assert.equal(metadata.path, "wiki/modules/usage.md");
  assert.equal(metadata.frontmatter?.title, "usage");
  assert.equal(metadata.revision.length, 64);
  assert.equal(JSON.stringify(metadata).includes("BODY_SENTINEL"), false);
  assert.equal(model.get({ path: "operations/testing.md" }).kind, "guide");
  assert.deepEqual(model.search({ pattern: "sentinel", scope: "guides" }).matches.map((match) => match.path), ["wiki/operations/testing.md"]);
  assert.deepEqual(model.search({ pattern: "sentinel" }).matches.map((match) => match.path), ["wiki/modules/usage.md"]);
});

test("external add/edit/delete and non-spec transitions are visible without a watcher", (t) => {
  const { model, put } = fixture(t);
  const file = put("wiki/module.md", spec("old"));
  assert.equal(model.get({ id: "old" }).kind, "spec");
  writeFileSync(file, spec("new"));
  assert.equal(model.get({ id: "new" }).kind, "spec");
  assert.throws(() => model.get({ id: "old" }), errorCode("not_found"));
  put("wiki/added.md", spec("added"));
  assert.equal(model.read().graph.nodes.size, 2);
  writeFileSync(file, "# A normal guide\n");
  assert.equal(model.get({ path: "module.md" }).kind, "guide");
  rmSync(path.join(path.dirname(file), "added.md"));
  assert.equal(model.read().graph.nodes.size, 0);
});

test("same-size edit with restored mtime refreshes body and metadata", (t) => {
  const { model, put } = fixture(t);
  const original = spec("old");
  const file = put("wiki/module.md", original);
  const fixedTime = new Date("2026-01-01T00:00:00.000Z");
  utimesSync(file, fixedTime, fixedTime);
  const stat = statSync(file);
  const revision = model.get({ id: "old" }).revision;
  writeFileSync(file, spec("new"));
  utimesSync(file, stat.atime, stat.mtime);
  assert.equal(statSync(file).size, stat.size);
  assert.equal(statSync(file).mtimeMs, stat.mtimeMs);
  assert.equal(model.get({ id: "new" }).frontmatter?.title, "new");
  assert.notEqual(model.get({ id: "new" }).revision, revision);
});

test("search supports metadata filters and stable count/byte continuation", (t) => {
  const { model, put } = fixture(t);
  put("wiki/a.md", spec("a", "tags: [usage]\nparent: b\ndepends-on: [b]\n", "needle 1\nneedle 2\nneedle 3\n"));
  put("wiki/b.md", spec("b", "", "needle 4\n"));
  const first = model.search({ pattern: "needle", tag: "usage", parent: "b", dependsOn: "b", limit: 2 });
  assert.deepEqual(first.matches.map((match) => match.snippet), ["needle 1", "needle 2"]);
  assert.equal(first.truncated, true);
  assert.equal(first.nextOffset, 2);
  const second = model.search({ pattern: "needle", tag: "usage", offset: first.nextOffset });
  assert.deepEqual(second.matches.map((match) => match.snippet), ["needle 3"]);
  assert.equal(second.truncated, false);
  assert.equal(model.search({ pattern: "needle", type: "task-spec" }).matches.length, 0);
});

test("oversized search line is matched on original text but snippet remains byte-bounded", (t) => {
  const { model, put } = fixture(t);
  put("wiki/large.md", spec("large", "", `${"界".repeat(5000)}needle\nneedle next\n`));
  const first = model.search({ pattern: "needle$", regex: true, maxBytes: 1024 });
  assert.equal(first.matches.length, 1);
  assert.equal(first.matches[0]?.snippetTruncated, true);
  assert.ok(Buffer.byteLength(first.matches[0]!.snippet) <= 512);
  assert.equal(first.matches[0]!.snippet.includes("�"), false);
  const all = model.search({ pattern: "needle", maxBytes: 1024 });
  assert.equal(all.nextOffset, 1);
  assert.equal(model.search({ pattern: "needle", offset: all.nextOffset }).matches[0]?.snippet, "needle next");
});

test("BOM/CRLF parsing and anchored regex preserve source line numbers", (t) => {
  const { model, put } = fixture(t);
  put("wiki/module.md", "\ufeff" + spec("module", "", "needle\n").replaceAll("\n", "\r\n"));
  assert.equal(model.get({ id: "module" }).kind, "spec");
  assert.equal(model.search({ pattern: "^needle$", regex: true }).matches[0]?.line, 7);
  assert.equal(model.search({ pattern: "^---$", regex: true }).matches[0]?.line, 1);
});

test("malformed YAML and incomplete/wrong-shaped metadata produce diagnostics, not silent guides", (t) => {
  const { model, put } = fixture(t);
  const cases = [
    ["invalid.md", "---\nid: [\n---\n", "invalid_frontmatter"],
    ["unclosed.md", "---\nid: a\n", "unclosed_frontmatter"],
    ["partial.md", "---\nid: a\n---\n", "invalid_identity"],
    ["number.md", "---\nid: 12\ntype: module-design\n---\n", "invalid_identity"],
    ["array-id.md", "---\nid: [a]\ntype: module-design\n---\n", "invalid_identity"],
    ["map.md", "---\n- a\n---\n", "invalid_frontmatter"],
    ["duplicate-key.md", "---\nid: a\nid: b\ntype: module-design\n---\n", "invalid_frontmatter"],
    ["list.md", spec("list", "depends-on: [{target: other}]\n"), "invalid_list"],
    ["parent.md", spec("parent", "parent: [other]\n"), "invalid_scalar"],
  ] as const;
  for (const [name, content] of cases) put(`wiki/${name}`, content);
  const report = model.validate();
  assert.equal(report.valid, false);
  for (const [name, , code] of cases) assert.ok(report.diagnostics.some((diagnostic) => diagnostic.path === `wiki/${name}` && diagnostic.code === code), name);
  assert.equal(report.nodes, 0);
  assert.equal(model.search({ pattern: "id:", scope: "all" }).matches.length, 0);
  assert.throws(() => model.get({ path: "partial.md" }), errorCode("invalid_document"));
});

test("legacy read tolerance keeps unknown type/missing title and scalar lists as warnings", (t) => {
  const { model, put } = fixture(t);
  put("wiki/legacy.md", "---\nid: legacy\ntype: custom-design\ntags: usage\n---\nbody\n");
  const report = model.validate();
  assert.equal(report.valid, true);
  assert.deepEqual(report.diagnostics.map((diagnostic) => diagnostic.code).sort(), ["legacy_list_scalar", "missing_title", "unknown_type"]);
  assert.equal(model.get({ id: "legacy" }).frontmatter?.type, "custom-design");
  assert.equal(model.search({ pattern: "body", tag: "usage" }).matches.length, 1);
});

test("duplicates never choose a canonical winner, including lookup by path and graph neighbors", (t) => {
  const { model, put } = fixture(t);
  put("wiki/a.md", spec("dup"));
  put("wiki/b.md", spec("dup"));
  put("wiki/consumer.md", spec("consumer", "depends-on: [dup]\n"));
  const snapshot = model.read();
  assert.equal(snapshot.graph.nodes.has("dup"), false);
  assert.deepEqual(snapshot.graph.duplicateIds.get("dup"), ["wiki/a.md", "wiki/b.md"]);
  assert.throws(() => model.get({ id: "dup" }), errorCode("duplicate_id"));
  assert.throws(() => model.get({ path: "a.md" }), errorCode("duplicate_id"));
  assert.throws(() => model.slice({ root: "dup", direction: "subtree" }), errorCode("duplicate_id"));
  assert.deepEqual(model.slice({ root: "consumer", direction: "neighbors" }).missing, ["dup"]);
  assert.ok(snapshot.diagnostics.some((diagnostic) => diagnostic.code === "ambiguous_link_target"));
});

test("validation finds typed dangling edges and parent cycles, not dependency/reference cycles", (t) => {
  const { model, put } = fixture(t);
  put("wiki/a.md", spec("a", "parent: b\ndepends-on: [ghost]\nreferences: [b]\nimplements: [missing]\n"));
  put("wiki/b.md", spec("b", "parent: a\nreferences: [a]\n"));
  const report = model.validate();
  assert.equal(report.diagnostics.filter((diagnostic) => diagnostic.code === "parent_cycle").length, 2);
  assert.equal(report.diagnostics.filter((diagnostic) => diagnostic.code === "dangling_link").length, 2);
  put("wiki/a.md", spec("a", "depends-on: [b]\nreferences: [b]\n"));
  put("wiki/b.md", spec("b", "depends-on: [a]\nreferences: [a]\n"));
  assert.equal(model.validate().valid, true);
});

test("metadata includes producer/consumer reverse relations; slices never include prose", (t) => {
  const { model, put } = fixture(t);
  put("wiki/root.md", spec("root"));
  put("wiki/usage.md", spec("usage", "parent: root\n", "PRIVATE_BODY_SENTINEL\n"));
  put("wiki/aurora.md", spec("aurora", "parent: root\ndepends-on: [usage]\n"));
  assert.deepEqual(model.get({ id: "usage" }).links?.reverse["depends-on"], ["aurora"]);
  assert.deepEqual(model.slice({ root: "usage", direction: "neighbors" }).nodes.map((node) => node.id), ["usage", "aurora"]);
  assert.equal(model.slice({ root: "root", direction: "subtree", depth: 1 }).nodes.length, 3);
  assert.equal(JSON.stringify(model.slice({ root: "usage", direction: "ancestors" })).includes("PRIVATE_BODY_SENTINEL"), false);
});

test("graph output has node/edge caps and reports truncation", (t) => {
  const { model, put } = fixture(t);
  put("wiki/root.md", spec("root"));
  for (let index = 0; index < 105; index++) put(`wiki/m${index}.md`, spec(`m${index}`, "parent: root\n"));
  const slice = model.slice({ root: "root", direction: "subtree" });
  assert.equal(slice.nodes.length, 100);
  assert.equal(slice.truncated, true);
  const ids = new Set(slice.nodes.map((node) => node.id));
  assert.ok(slice.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to)));
});

test("lookup rejects escapes, Windows namespaces, reserved aliases and missing/invalid selectors", (t) => {
  const { model, put } = fixture(t);
  put("wiki/module.md", spec("module"));
  assert.equal(model.get({ path: "@module.md" }).kind, "spec");
  for (const target of ["../outside.md", "/outside.md", "C:outside.md", "file:SPEC.md", "_rules.md", "domain/INSTRUCTIONS.md", "INSTRUCTIONS.md", ".hidden.md"]) assert.throws(() => model.get({ path: target }), errorCode("reserved_path"), target);
  assert.throws(() => model.get({}), errorCode("invalid_selector"));
  assert.throws(() => model.get({ id: "module", path: "module.md" }), errorCode("invalid_selector"));
  assert.throws(() => model.get({ id: "missing" }), errorCode("not_found"));
});

test("symlinked roots, directories and leaves are not followed", (t) => {
  const { model, project, put } = fixture(t);
  const outside = put("outside/SPEC.md", spec("outside", "", "OUTSIDE_SENTINEL\n"));
  put("wiki/real.md", spec("real"));
  symlinkSync(outside, path.join(project, "wiki/alias.md"));
  symlinkSync(path.dirname(outside), path.join(project, "wiki/linked"), "dir");
  symlinkSync(path.join(project, "missing.md"), path.join(project, "wiki/dangling.md"));
  assert.deepEqual([...model.read().graph.nodes.keys()], ["real"]);
  assert.equal(model.search({ pattern: "OUTSIDE_SENTINEL", scope: "all" }).matches.length, 0);
  assert.throws(() => model.get({ path: "linked/SPEC.md" }), errorCode("unsafe_path"));
  renameSync(path.join(project, "wiki"), path.join(project, "wiki-old"));
  symlinkSync(path.join(project, "outside"), path.join(project, "wiki"), "dir");
  assert.equal(model.read().documents.length, 0);
  assert.equal(model.validate().diagnostics[0]?.code, "wiki_invalid");
});

test("missing/replaced wiki root cannot serve stale cached data and recovery needs no new instance", (t) => {
  const { model, project, put } = fixture(t);
  put("wiki/module.md", spec("old"));
  assert.equal(model.read().graph.nodes.size, 1);
  rmSync(path.join(project, "wiki"), { recursive: true });
  assert.equal(model.validate().valid, false);
  assert.equal(model.read().graph.nodes.size, 0);
  put("wiki/module.md", spec("new"));
  assert.deepEqual([...model.read().graph.nodes.keys()], ["new"]);
});

test("oversize, NUL and invalid UTF-8 failures are visible and never return content", (t) => {
  const { model, put } = fixture(t);
  put("wiki/oversize.md", "x".repeat(MAX_WIKI_DOCUMENT_BYTES + 1));
  put("wiki/nul.md", Buffer.from("hello\0world"));
  put("wiki/invalid.md", Buffer.from([255]));
  const report = model.validate();
  assert.deepEqual(report.diagnostics.map((diagnostic) => diagnostic.code).sort(), ["document_too_large", "invalid_utf8", "nul_byte"]);
  assert.equal(report.filesScanned, 0);
  assert.equal(report.valid, false);
  assert.equal(model.search({ pattern: "hello", scope: "all" }).matches.length, 0);
});

test("read and listing failures evict old data instead of returning a stale cache", (t) => {
  const { model, project, put } = fixture(t);
  const file = put("wiki/locked/module.md", spec("module"));
  assert.equal(model.read().graph.nodes.size, 1);
  chmodSync(file, 0o000);
  let denied = false;
  try { readFileSync(file); } catch { denied = true; }
  if (!denied) { chmodSync(file, 0o600); t.skip("Host user bypasses filesystem permissions"); return; }
  try {
    assert.equal(model.read().graph.nodes.size, 0);
    assert.ok(model.validate().diagnostics.some((diagnostic) => diagnostic.code === "read_failed"));
  } finally { chmodSync(file, 0o600); }
  const directory = path.join(project, "wiki/locked");
  chmodSync(directory, 0o000);
  try {
    assert.equal(model.read().graph.nodes.size, 0);
    assert.ok(model.validate().diagnostics.some((diagnostic) => diagnostic.code === "list_failed"));
  } finally { chmodSync(directory, 0o700); }
  assert.equal(model.read().graph.nodes.size, 1);
});

test("independent roots and caller mutations do not contaminate later reads", (t) => {
  const first = fixture(t);
  const second = fixture(t);
  first.put("wiki/module.md", spec("first"));
  second.put("wiki/module.md", spec("second"));
  const snapshot = first.model.read();
  snapshot.graph.nodes.clear();
  snapshot.documents[0]!.frontmatter!.id = "tampered";
  assert.deepEqual([...first.model.read().graph.nodes.keys()], ["first"]);
  assert.deepEqual([...second.model.read().graph.nodes.keys()], ["second"]);
});

test("invalid query inputs return actionable errors without changing files", (t) => {
  const { model, put } = fixture(t);
  const file = put("wiki/module.md", spec("module"));
  const before = readFileSync(file);
  assert.throws(() => model.search({ pattern: "[", regex: true }), errorCode("invalid_regex"));
  for (const limit of [0, -1, 201, NaN, Infinity, 0.5]) assert.throws(() => model.search({ pattern: "", limit }), errorCode("invalid_limit"));
  for (const depth of [-1, 5, NaN, Infinity, 0.5]) assert.throws(() => model.slice({ root: "module", direction: "subtree", depth }), errorCode("invalid_depth"));
  assert.throws(() => model.search({ pattern: "", offset: -1 }), /offset/u);
  assert.throws(() => model.search({ pattern: "", maxBytes: 1 }), errorCode("invalid_budget"));
  assert.throws(() => model.slice({ root: "missing", direction: "subtree" }), errorCode("not_found"));
  assert.deepEqual(readFileSync(file), before);
});

test("vendor index hooks opt in without breaking original graph memoization", (t) => {
  const { project, put } = fixture(t);
  put("wiki/module.md", spec("module"));
  put("wiki/guide.md", "# Guide\n");
  const errors: string[] = [];
  const index = new SpecIndex(path.join(project, "wiki"), { retainNonSpecs: true, verifyContent: true, onError: (_path, operation) => errors.push(operation) });
  assert.equal(index.documentEntries().length, 2);
  const graph = index.graph();
  assert.equal(index.graph(), graph);
  assert.equal(index.documentEntries().find((record) => record.rel === "guide.md")?.content, "# Guide\n");
  assert.deepEqual(errors, []);
});

test("vendor provenance pins original files and explicitly lists locally patched leaves", () => {
  const vendor = new URL("../../extensions/wiki/vendor/thinkrail-spec-graph/", import.meta.url);
  const origin = JSON.parse(readFileSync(new URL("ORIGIN.json", vendor), "utf8"));
  assert.equal(origin.commit, "519286befe0f15cc2dd270e251ecd8cdb9d0a01c");
  assert.deepEqual(origin.patchedFiles, ["core/index.ts", "core/store.ts", "core/parse.ts"]);
  const patched = new Set(origin.patchedFiles);
  for (const [relative, hash] of Object.entries(origin.originalSha256)) {
    if (patched.has(relative)) continue;
    assert.equal(createHash("sha256").update(readFileSync(new URL(relative, vendor))).digest("hex"), hash, relative);
  }
  assert.equal(existsSync(new URL("package.json", vendor)), false, "vendor must not advertise a separate extension entrypoint");
});
