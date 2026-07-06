import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSessionFile } from "../src/session/parse-session.js";
import { buildSessionTree, renderTreeText } from "../src/session/tree.js";

test("parseSessionFile parses header and entries with warnings", async () => {
  const file = createFixture([
    { type: "session", version: 3, id: "s1", cwd: "/tmp/project", timestamp: "2026-06-14T00:00:00.000Z" },
    { type: "message", id: "a1", parentId: null, timestamp: "2026-06-14T00:00:01.000Z", message: { role: "user", content: "hi" } },
    "{bad json",
    { type: "message", parentId: "a1", timestamp: "2026-06-14T00:00:02.000Z", message: { role: "assistant", content: [] } },
  ]);

  const parsed = await parseSessionFile(file);
  assert.equal(parsed.header.id, "s1");
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.warnings.length, 2);
  assert.equal(parsed.warnings[0].code, "malformed_json");
  assert.equal(parsed.warnings[1].code, "missing_id");
  assert.equal(parsed.stats.lineCount, 4);
});

test("buildSessionTree computes active path and branch points", async () => {
  const file = createFixture([
    { type: "session", version: 3, id: "s1", cwd: "/tmp/project", timestamp: "2026-06-14T00:00:00.000Z" },
    { type: "message", id: "a1", parentId: null, timestamp: "2026-06-14T00:00:01.000Z", message: { role: "user", content: "root" } },
    { type: "message", id: "b1", parentId: "a1", timestamp: "2026-06-14T00:00:02.000Z", message: { role: "assistant", content: [] } },
    { type: "message", id: "c1", parentId: "a1", timestamp: "2026-06-14T00:00:03.000Z", message: { role: "user", content: "branch" } },
    { type: "message", id: "d1", parentId: "c1", timestamp: "2026-06-14T00:00:04.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }] } },
  ]);

  const parsed = await parseSessionFile(file);
  const tree = buildSessionTree(parsed.entries, file);

  assert.equal(tree.activeLeafId, "d1");
  assert.deepEqual(tree.activePathEntryIds, ["a1", "c1", "d1"]);
  assert.equal(tree.branchCount, 1);
  assert.deepEqual(tree.branchPoints[0].children, ["b1", "c1"]);

  const rendered = renderTreeText(tree);
  assert.match(rendered, /\* a1 message user/);
  assert.match(rendered, /├─  b1 message assistant/);
  assert.match(rendered, /└─\* c1 message user/);
  assert.match(rendered, /└─\* d1 message assistant toolCalls=1/);
});

test("buildSessionTree ignores duplicate entries in children and active leaf", async () => {
  const file = createFixture([
    { type: "session", version: 3, id: "s1", cwd: "/tmp/project", timestamp: "2026-06-14T00:00:00.000Z" },
    { type: "message", id: "a1", parentId: null, timestamp: "2026-06-14T00:00:01.000Z", message: { role: "user", content: "root" } },
    { type: "message", id: "b1", parentId: "a1", timestamp: "2026-06-14T00:00:02.000Z", message: { role: "assistant", content: [] } },
    { type: "message", id: "b1", parentId: "a1", timestamp: "2026-06-14T00:00:03.000Z", message: { role: "user", content: "duplicate" } },
  ]);

  const parsed = await parseSessionFile(file);
  const tree = buildSessionTree(parsed.entries, file);

  assert.equal(tree.duplicateIds.length, 1);
  assert.deepEqual(tree.childrenByParent.get("a1"), ["b1"]);
  assert.equal(tree.activeLeafId, "b1");
  assert.deepEqual(tree.activePathEntryIds, ["a1", "b1"]);
});

test("buildSessionTree warns on missing parent and keeps reachable leaf path", async () => {
  const file = createFixture([
    { type: "session", version: 3, id: "s1", cwd: "/tmp/project", timestamp: "2026-06-14T00:00:00.000Z" },
    { type: "message", id: "orphan", parentId: "missing", timestamp: "2026-06-14T00:00:01.000Z", message: { role: "user", content: "orphan" } },
  ]);

  const parsed = await parseSessionFile(file);
  const tree = buildSessionTree(parsed.entries, file);

  assert.equal(tree.activeLeafId, "orphan");
  assert.deepEqual(tree.activePathEntryIds, ["orphan"]);
  assert.equal(tree.warnings.filter((warning) => warning.code === "missing_parent").length, 2);
});

test("buildSessionTree detects parent cycles while walking active path", async () => {
  const file = createFixture([
    { type: "session", version: 3, id: "s1", cwd: "/tmp/project", timestamp: "2026-06-14T00:00:00.000Z" },
    { type: "message", id: "a1", parentId: "c1", timestamp: "2026-06-14T00:00:01.000Z", message: { role: "user", content: "a" } },
    { type: "message", id: "b1", parentId: "a1", timestamp: "2026-06-14T00:00:02.000Z", message: { role: "assistant", content: [] } },
    { type: "message", id: "c1", parentId: "b1", timestamp: "2026-06-14T00:00:03.000Z", message: { role: "user", content: "c" } },
  ]);

  const parsed = await parseSessionFile(file);
  const tree = buildSessionTree(parsed.entries, file);

  assert.equal(tree.activeLeafId, "c1");
  assert.deepEqual(tree.activePathEntryIds, ["a1", "b1", "c1"]);
  assert.equal(tree.warnings.some((warning) => warning.code === "parent_cycle"), true);
});

function createFixture(lines) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-parse-tree-"));
  const file = path.join(tmp, "session.jsonl");
  fs.writeFileSync(
    file,
    lines.map((line) => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n",
  );
  return file;
}
