import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../src/logging/logger.js";

test("createLogger writes redacted JSONL log event", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-logger-"));
  const logger = createLogger({
    config: { logging: { enabled: true, logDir: tmp } },
    command: "test",
    project: { projectKey: "project-123" },
  });

  logger.info("command_start", "started sk-abcdefghijklmnopqrstuvwxyz", {
    component: "cli",
    data: { token: "secret" },
  });

  const runtimeDir = path.join(tmp, "runtime");
  const files = fs.readdirSync(runtimeDir);
  assert.equal(files.length, 1);
  const line = fs.readFileSync(path.join(runtimeDir, files[0]), "utf8").trim();
  const event = JSON.parse(line);

  assert.equal(event.runId, logger.runId);
  assert.equal(event.projectKey, "project-123");
  assert.doesNotMatch(line, /sk-abcdefghijklmnopqrstuvwxyz|secret/);
  assert.match(line, /<REDACTED_SECRET>/);
});
