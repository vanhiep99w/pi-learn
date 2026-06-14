import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { expandHome, resolvePath } from "../src/utils/path.js";

test("expandHome expands tilde paths", () => {
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("~/x"), path.join(os.homedir(), "x"));
  assert.equal(expandHome("/tmp/x"), "/tmp/x");
});

test("resolvePath resolves relative paths against base", () => {
  assert.equal(resolvePath("child", "/tmp/base"), "/tmp/base/child");
});
