import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deepMerge, loadConfig } from "../src/config/load-config.js";

test("deepMerge merges nested config objects", () => {
  const result = deepMerge(
    { targets: { agents: true, settings: false }, riskPolicy: { requireGitClean: true } },
    { targets: { settings: true }, riskPolicy: { lowRiskAutoPatch: false } },
  );

  assert.deepEqual(result, {
    targets: { agents: true, settings: true },
    riskPolicy: { requireGitClean: true, lowRiskAutoPatch: false },
  });
});

test("loadConfig applies CLI project and project config", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-config-test-"));
  fs.mkdirSync(path.join(tmp, ".git"));
  fs.mkdirSync(path.join(tmp, "harness"));
  fs.writeFileSync(
    path.join(tmp, "harness", "config.json"),
    JSON.stringify({ maxSessionsPerScan: 7, targets: { settings: true } }),
  );

  const { config, project, sources } = loadConfig({
    project: tmp,
    globalConfig: path.join(tmp, "missing-global.json"),
    harnessHome: path.join(tmp, ".harness-home"),
  });

  assert.equal(project.projectRoot, fs.realpathSync(tmp));
  assert.equal(config.maxSessionsPerScan, 7);
  assert.equal(config.targets.settings, true);
  assert.equal(sources.projectConfigFound, true);
  assert.equal(config.harnessHome, path.join(tmp, ".harness-home"));
});
