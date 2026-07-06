import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createProjectKey, sanitizeProjectName } from "../src/project/project-key.js";

test("sanitizeProjectName keeps safe lowercase names", () => {
  assert.equal(sanitizeProjectName("Pi Learn"), "pi-learn");
  assert.equal(sanitizeProjectName("  My_Project.1  "), "my_project.1");
});

test("createProjectKey includes basename and stable short hash", () => {
  const projectRoot = path.resolve("/tmp/pi-learn");
  const keyA = createProjectKey(projectRoot);
  const keyB = createProjectKey(projectRoot);

  assert.equal(keyA, keyB);
  assert.match(keyA, /^pi-learn-[a-f0-9]{6}$/);
});
