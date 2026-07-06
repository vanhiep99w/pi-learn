import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEvalHarness, renderEvalMarkdown, writeEvalReport } from "../src/eval/eval-harness.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");

test("runEvalHarness runs one deterministic scenario and writes reports", async () => {
  const fixture = createFixture();
  const report = await runEvalHarness({
    config: fixture.config,
    project: fixture.project,
    scenario: "redaction-fixture",
  });

  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.results[0].scenario, "redaction-fixture");
  assert.equal(fs.existsSync(report.paths.latestJsonPath), true);
  assert.equal(fs.existsSync(report.paths.latestMarkdownPath), true);
});

test("runEvalHarness full suite passes at least three MVP scenarios", async () => {
  const fixture = createFixture();
  const report = await runEvalHarness({ config: fixture.config, project: fixture.project });

  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.passed >= 3, true);
  assert.equal(report.results.some((result) => result.scenario === "parser-unknown-entry"), true);
  assert.equal(report.results.some((result) => result.scenario === "file-protection"), true);
  assert.equal(report.results.some((result) => result.scenario === "smart-commit-basic"), true);
});

test("renderEvalMarkdown renders summary and checkboxes", () => {
  const markdown = renderEvalMarkdown({
    schemaVersion: 1,
    generatedAt: "2026-06-14T00:00:00.000Z",
    projectKey: "project-test",
    summary: { passed: 1, failed: 0, skipped: 0 },
    results: [{ scenario: "redaction-fixture", status: "pass", message: "ok", checks: [{ name: "secret redacted", ok: true }] }],
  });

  assert.match(markdown, /# Pi Harness Eval/);
  assert.match(markdown, /Passed: 1/);
  assert.match(markdown, /\[x\] secret redacted/);
});

test("writeEvalReport writes JSON and Markdown artifacts", () => {
  const fixture = createFixture();
  const paths = writeEvalReport({
    config: fixture.config,
    project: fixture.project,
    now: new Date("2026-06-14T00:00:00.000Z"),
    report: {
      schemaVersion: 1,
      generatedAt: "2026-06-14T00:00:00.000Z",
      projectKey: fixture.project.projectKey,
      summary: { passed: 1, failed: 0, skipped: 0 },
      results: [],
    },
  });

  assert.equal(fs.existsSync(paths.latestJsonPath), true);
  assert.equal(fs.existsSync(paths.datedMarkdownPath), true);
  assert.match(paths.latestJsonPath, /evals\/latest\.json$/);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-eval-test-"));
  const projectRoot = repoRoot;
  return {
    root,
    config: { harnessHome: root },
    project: {
      cwd: projectRoot,
      projectRoot,
      gitRoot: projectRoot,
      projectKey: "project-test",
      name: "project",
    },
  };
}
