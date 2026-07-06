import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, atomicWriteJsonl } from "../src/storage/atomic-write.js";

test("atomicWriteJson writes formatted JSON", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-atomic-json-"));
  const file = path.join(tmp, "nested", "data.json");

  atomicWriteJson(file, { ok: true, count: 2 });

  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ok: true, count: 2 });
});

test("atomicWriteJsonl writes newline-delimited JSON", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-atomic-jsonl-"));
  const file = path.join(tmp, "events.jsonl");

  atomicWriteJsonl(file, [{ id: 1 }, { id: 2 }]);

  assert.equal(fs.readFileSync(file, "utf8"), '{"id":1}\n{"id":2}\n');
});
