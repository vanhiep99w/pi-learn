import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WikiModelError, WikiReadModel } from "../../extensions/wiki/wiki-model.ts";
import { WikiSpecWriter, type FileMutationQueue } from "../../extensions/wiki/wiki-spec-writer.ts";

function fixture(t: test.TestContext, queue: FileMutationQueue = async (_path, operation) => operation()) {
  const root = mkdtempSync(path.join(tmpdir(), "wiki-spec-writer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "wiki"));
  const writer = new WikiSpecWriter({ queue });
  const model = new WikiReadModel(root);
  const check = () => {};
  const create = (id: string, fields = {}) => writer.create(root, { path: `${id}.md`, id, type: "module-design", title: id, ...fields }, check);
  const update = (id: string, edit = {}) => writer.update(root, { id, expectedRevision: model.get({ id }).revision, ...edit }, check);
  const put = (relative: string, content: string) => {
    const file = path.join(root, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); return file;
  };
  return { root, writer, model, check, create, update, put };
}
const code = (expected: string) => (error: unknown) => error instanceof WikiModelError && error.code === expected;

test("new spec uses upstream scaffold/serialization, draft status and lookup-visible canonical path", async (t) => {
  const f = fixture(t);
  const receipt = await f.create("usage", { path: "modules/usage/SPEC.md", tags: ["account,usage"] });
  assert.equal(receipt.path, "wiki/modules/usage/SPEC.md");
  assert.equal(receipt.scaffoldOnly, true);
  assert.equal(receipt.status, "draft");
  const text = readFileSync(path.join(f.root, receipt.path), "utf8");
  assert.match(text, /## Responsibility\n\n## Boundary/);
  assert.deepEqual(f.model.get({ id: "usage" }).frontmatter?.tags, ["account,usage"]);
  assert.equal(f.model.get({ id: "usage" }).revision, receipt.revision);
});

test("new targets must exist and uniqueness/paths cannot overwrite existing guides", async (t) => {
  const f = fixture(t);
  f.put("wiki/guide.md", "# Keep legacy guide\n");
  await assert.rejects(f.create("guide"), code("already_exists"));
  assert.equal(readFileSync(path.join(f.root, "wiki/guide.md"), "utf8"), "# Keep legacy guide\n");
  await assert.rejects(f.create("child", { parent: "missing" }), code("graph_invalid"));
  await f.create("parent"); await f.create("child", { parent: "parent", dependsOn: ["parent"] });
  await assert.rejects(f.create("parent", { path: "another.md" }), code("duplicate_id"));
  assert.deepEqual(f.model.get({ id: "parent" }).links?.reverse.parent, ["child"]);
});

for (const candidate of ["_rules.md", "INSTRUCTIONS.md", ".last-update.json", "assets/SPEC.md", "_scratch/SPEC.md", "../source.md", "/tmp/outside.md", "C:outside.md", "domain/_rules.md", "domain/instructions.md"]) {
  test(`create rejects protected/non-indexable path: ${candidate}`, async (t) => {
    const f = fixture(t);
    await assert.rejects(f.create("a", { path: candidate }), code("reserved_path"));
    assert.equal(f.model.read().documents.length, 0);
  });
}

test("authoring is stricter than legacy read tolerance", async (t) => {
  const f = fixture(t);
  for (const fields of [{ id: " " }, { title: "" }, { type: "task-spec" }, { type: "unknown" }, { tags: [""] }, { tags: ["bad\nvalue"] }, { parent: " " }, { dependsOn: "scalar" }]) {
    await assert.rejects(f.create("a", fields), code("invalid_authoring"));
  }
  assert.equal(f.model.read().documents.length, 0);
});

test("update preserves BOM, CRLF, comments, unknown nested metadata and every prose byte", async (t) => {
  const f = fixture(t);
  const body = "# Body\ntext\r\nunchanged bytes 🪶\n";
  const original = "\ufeff---\r\nid: a # stable\r\ntype: module-design\r\ntitle: Old\r\nstatus: active\r\nowner:\r\n  team: infra\r\n# Keep rationale\r\ntags: [x]\r\n---\r\n" + body;
  const file = f.put("wiki/a.md", original);
  const receipt = await f.update("a", { set: { title: "New" }, addList: { tags: ["y", "y"] } });
  assert.equal(receipt.changed, true);
  const after = readFileSync(file, "utf8");
  assert.ok(after.startsWith("\ufeff---\r\n"));
  assert.ok(after.endsWith(body));
  assert.match(after, /# stable/); assert.match(after, /# Keep rationale/); assert.match(after, /team: infra/);
  assert.equal(f.model.get({ id: "a" }).frontmatter?.status, "active", "unchanged active status is not downgraded");
  assert.deepEqual(f.model.get({ id: "a" }).frontmatter?.tags, ["x", "y"]);
  const unchanged = await f.update("a", { set: { title: "New" } });
  assert.equal(unchanged.changed, false);
  assert.equal(readFileSync(file, "utf8"), after);
});

test("update rejects stale revisions, ID changes, list misuse and review promotion", async (t) => {
  const f = fixture(t); await f.create("a");
  const file = path.join(f.root, "wiki/a.md");
  const before = readFileSync(file, "utf8");
  const old = f.model.get({ id: "a" }).revision;
  f.put("wiki/a.md", before + "External edit\n");
  await assert.rejects(f.update("a", { expectedRevision: old, set: { title: "Lost update" } }), code("stale_revision"));
  for (const [edit, error] of [
    [{ set: { id: "b" } }, "invalid_edit"], [{ set: { tags: "x" } }, "invalid_edit"],
    [{ remove: ["title"] }, "invalid_edit"], [{ remove: ["type"] }, "invalid_edit"],
    [{ set: { status: "active" } }, "review_required"], [{ set: { status: "done" } }, "review_required"],
    [{ addList: { unknown: ["x"] } }, "invalid_edit"],
  ] as const) await assert.rejects(f.update("a", edit), code(error));
  assert.equal(readFileSync(file, "utf8"), before + "External edit\n");
});

test("metadata writes reject dangling edges/cycles but may repair existing dangling links", async (t) => {
  const f = fixture(t); await f.create("a"); await f.create("b", { parent: "a" });
  await assert.rejects(f.update("a", { set: { parent: "b" } }), code("graph_invalid"));
  await assert.rejects(f.update("a", { addList: { "depends-on": ["ghost"] } }), code("graph_invalid"));
  f.put("wiki/a.md", "---\nid: a\ntype: module-design\ntitle: a\ndepends-on: [ghost]\n---\nbody\n");
  await f.update("a", { removeList: { "depends-on": ["ghost"] } });
  assert.equal(f.model.validate().valid, true);
  f.put("wiki/a.md", "---\nid: a\ntype: module-design\ntitle: a\ndepends-on: [new]\n---\nbody\n");
  await f.create("new");
  assert.equal(f.model.validate().valid, true);
});

test("symlinked parents/root and hardlinked update targets are refused", async (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.root, "outside"));
  symlinkSync(path.join(f.root, "outside"), path.join(f.root, "wiki/alias"), "dir");
  await assert.rejects(f.create("a", { path: "alias/a.md" }), code("unsafe_path"));
  await f.create("a");
  const file = path.join(f.root, "wiki/a.md");
  const before = readFileSync(file, "utf8");
  linkSync(file, path.join(f.root, "outside/linked.md"));
  await assert.rejects(f.update("a", { set: { title: "Unsafe" } }), code("unsafe_path"));
  assert.equal(readFileSync(file, "utf8"), before);
  rmSync(path.join(f.root, "wiki"), { recursive: true });
  symlinkSync(path.join(f.root, "outside"), path.join(f.root, "wiki"), "dir");
  await assert.rejects(f.create("x"), code("unsafe_path"));
});

test("source mapping authoring preserves prose, comments and CRLF", async (t) => {
  const f = fixture(t);
  await f.create("mapped", { sourcePaths: ["src/payments/"] });
  assert.equal(f.model.locate("src/payments/refund.ts").matches[0].id, "mapped");
  const body = "# Body\r\nkeep every byte 🪶\n";
  const file = f.put("wiki/mapped.md", "\ufeff---\r\nid: mapped # stable\r\ntype: module-design\r\ntitle: Mapped\r\n# Preserve source rationale\r\nsource-paths: [src/payments/]\r\nowner:\r\n  team: backend\r\n---\r\n" + body);
  await f.update("mapped", { addList: { "source-paths": ["src/shared/"] }, removeList: { "source-paths": ["src/payments/"] } });
  const after = readFileSync(file, "utf8");
  assert.ok(after.startsWith("\ufeff---\r\n")); assert.ok(after.endsWith(body));
  assert.match(after, /# stable/); assert.match(after, /# Preserve source rationale/); assert.match(after, /team: backend/);
  assert.deepEqual(f.model.get({ id: "mapped" }).frontmatter?.["source-paths"], ["src/shared/"]);
  assert.equal(f.model.locate("src/payments/refund.ts").matches.length, 0);
  assert.equal(f.model.locate("src/shared/file.ts").matches.length, 1);
  await f.update("mapped", { remove: ["source-paths"] });
  assert.equal(f.model.get({ id: "mapped" }).frontmatter?.["source-paths"], undefined);
});

test("source mapping authoring rejects malformed scopes without writing", async (t) => {
  const f = fixture(t);
  for (const sourcePaths of [["../escape"], ["src/**"], ["src/", "src/"], ["C:file"]]) {
    await assert.rejects(f.create("bad", { sourcePaths }), code("invalid_authoring"));
  }
  await f.create("good", { sourcePaths: ["src/"] });
  const file = path.join(f.root, "wiki/good.md"), before = readFileSync(file, "utf8");
  await assert.rejects(f.update("good", { addList: { "source-paths": ["../escape"] } }), code("invalid_authoring"));
  assert.equal(readFileSync(file, "utf8"), before);
});

test("simultaneous creates across different files cannot introduce duplicate IDs", async (t) => {
  const f = fixture(t);
  const outcomes = await Promise.allSettled([f.create("a", { path: "one.md" }), f.create("a", { path: "two.md" })]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(f.model.read().graph.nodes.size, 1);
});

test("queued writes recheck run authorization and cancellation before mutation", async (t) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const f = fixture(t, async (_path, operation) => { await waiting; return operation(); });
  let authorized = true;
  const check = () => { if (!authorized) throw new WikiModelError("write_not_authorized", "Run ended"); };
  const work = f.writer.create(f.root, { path: "a.md", id: "a", type: "module-design", title: "a" }, check);
  authorized = false; release();
  await assert.rejects(work, code("write_not_authorized"));
  assert.equal(f.model.read().documents.length, 0);
  authorized = true;
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(f.writer.create(f.root, { path: "a.md", id: "a", type: "module-design", title: "a" }, check, aborted.signal), code("cancelled"));
});

test("queued update rereads the real file after built-in/editor changes", async (t) => {
  const ordinary = fixture(t); await ordinary.create("a");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const writer = new WikiSpecWriter({ queue: async (_path, operation) => { await waiting; return operation(); } });
  const expectedRevision = ordinary.model.get({ id: "a" }).revision;
  const work = writer.update(ordinary.root, { id: "a", expectedRevision, set: { title: "stale" } }, () => {});
  const file = path.join(ordinary.root, "wiki/a.md");
  writeFileSync(file, readFileSync(file, "utf8") + "Editor changes\n");
  release(); await assert.rejects(work, code("stale_revision"));
  assert.ok(readFileSync(file, "utf8").endsWith("Editor changes\n"));
});
