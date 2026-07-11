import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverWikiPromptRules,
  ensureWikiPromptRuleScaffolds,
  isWikiDocumentationPath,
  isWikiInstructionsPath,
  isWikiMetadataPath,
  isWikiRulePath,
  isWikiTemporaryPath,
  lintWikiPromptRuleFile,
  relativeProjectPath,
} from "../src/analysis/wiki-prompt-rules.js";

test("Wiki path classification keeps prompt rules separate from documentation", () => {
  assert.equal(isWikiRulePath("wiki/_rules.md"), true);
  assert.equal(isWikiRulePath("wiki/extensions/_rules.md"), true);
  assert.equal(isWikiRulePath("wiki/extensions/guide.md"), false);
  assert.equal(isWikiMetadataPath("wiki/.last-update.json"), true);
  assert.equal(isWikiInstructionsPath("wiki/INSTRUCTIONS.md"), true);
  assert.equal(isWikiInstructionsPath("wiki/architecture/INSTRUCTIONS.md"), false);
  assert.equal(isWikiTemporaryPath("wiki/_plan.md"), true);
  assert.equal(isWikiTemporaryPath("wiki/_rules.md"), false);
  assert.equal(isWikiTemporaryPath("wiki/.last-update.json"), false);
  assert.equal(isWikiDocumentationPath("wiki/quickstart.md"), true);
  assert.equal(isWikiDocumentationPath("wiki/extensions/guide.md"), true);
  assert.equal(isWikiDocumentationPath("wiki/extensions/_rules.md"), false);
  assert.equal(isWikiDocumentationPath("wiki/INSTRUCTIONS.md"), false);
  assert.equal(isWikiDocumentationPath("wiki/.last-update.json"), false);
  assert.equal(isWikiDocumentationPath("wiki/_plan.md"), false);
});

test("relativeProjectPath rejects paths outside the project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-paths-"));
  assert.equal(relativeProjectPath(root, "wiki/_rules.md"), "wiki/_rules.md");
  assert.equal(relativeProjectPath(root, path.join(root, "wiki", "_rules.md")), "wiki/_rules.md");
  assert.equal(relativeProjectPath(root, "../outside.md"), undefined);
});

test("discoverWikiPromptRules finds root and final section files in stable order", () => {
  const root = createWikiFixture();
  write(root, "wiki/_rules.md", validRules("GLOBAL-EDIT-001"));
  write(root, "wiki/architecture/_rules.md", validRules("ARCH-PARSER-001"));
  write(root, "wiki/extensions/_rules.md", validRules("EXT-UI-001"));
  write(root, "wiki/INSTRUCTIONS.md", "# Wiki brief\n");
  write(root, "wiki/assets/logo.md", "asset notes\n");
  write(root, "wiki/_tmp/scratch.md", "temporary\n");

  const report = discoverWikiPromptRules({ projectRoot: root });

  assert.equal(report.valid, true);
  assert.deepEqual(report.files, [
    "wiki/_rules.md",
    "wiki/architecture/_rules.md",
    "wiki/extensions/_rules.md",
  ]);
  assert.deepEqual(report.sections, ["wiki", "wiki/architecture", "wiki/extensions"]);
  assert.deepEqual(report.missingRuleSections, []);
  assert.deepEqual(report.ruleIds.map((item) => item.id), ["GLOBAL-EDIT-001", "ARCH-PARSER-001", "EXT-UI-001"]);
});

test("discoverWikiPromptRules reports missing section rules", () => {
  const root = createWikiFixture();
  write(root, "wiki/_rules.md", validRules("GLOBAL-EDIT-001"));

  const report = discoverWikiPromptRules({ projectRoot: root });

  assert.equal(report.valid, false);
  assert.deepEqual(report.missingRuleSections, ["wiki/architecture", "wiki/extensions"]);
  assert.equal(report.errors.some((item) => item.code === "section_rule_missing"), true);
});

test("lintWikiPromptRuleFile rejects duplicate IDs and invalid proposal origins", () => {
  const root = createWikiFixture();
  write(root, "wiki/_rules.md", [
    "# Global rules",
    "",
    "## GLOBAL-EDIT-001 — First",
    "",
    "Do the first thing.",
    "",
    "## GLOBAL-EDIT-001 — Duplicate",
    "",
    "Do the duplicate thing.",
    "",
    "Origin proposal: not-a-proposal",
    "",
  ].join("\n"));

  const lint = lintWikiPromptRuleFile({ projectRoot: root, rulePath: "wiki/_rules.md" });

  assert.equal(lint.errors.some((item) => item.code === "duplicate_rule_id"), true);
  assert.equal(lint.errors.some((item) => item.code === "invalid_origin_proposal"), true);
});

test("discoverWikiPromptRules warns when a rule ID appears in sibling sections", () => {
  const root = createWikiFixture();
  write(root, "wiki/_rules.md", "# Global rules\n");
  write(root, "wiki/architecture/_rules.md", validRules("SHARED-RULE-001"));
  write(root, "wiki/extensions/_rules.md", validRules("SHARED-RULE-001"));

  const report = discoverWikiPromptRules({ projectRoot: root });

  assert.equal(report.valid, true);
  assert.equal(report.warnings.some((item) => item.code === "duplicate_project_rule_id"), true);
});

test("ensureWikiPromptRuleScaffolds creates root and final section scaffolds only once", () => {
  const root = createWikiFixture();

  const first = ensureWikiPromptRuleScaffolds({ projectRoot: root });
  const second = ensureWikiPromptRuleScaffolds({ projectRoot: root });

  assert.deepEqual(first.created, [
    "wiki/_rules.md",
    "wiki/architecture/_rules.md",
    "wiki/extensions/_rules.md",
  ]);
  assert.deepEqual(second.created, []);
  assert.equal(fs.existsSync(path.join(root, "wiki", "assets", "_rules.md")), false);
  assert.match(fs.readFileSync(path.join(root, "wiki", "_rules.md"), "utf8"), /No reviewed global rules/);
});

test("lintWikiPromptRuleFile rejects a symlink that escapes project root", { skip: process.platform === "win32" }, () => {
  const root = createWikiFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-outside-"));
  const outsideFile = path.join(outside, "rules.md");
  fs.writeFileSync(outsideFile, validRules("OUTSIDE-RULE-001"));
  fs.symlinkSync(outsideFile, path.join(root, "wiki", "_rules.md"));

  const lint = lintWikiPromptRuleFile({ projectRoot: root, rulePath: "wiki/_rules.md" });

  assert.equal(lint.errors.some((item) => item.code === "symlink_escape"), true);
});

function createWikiFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-prompt-rules-"));
  write(root, "wiki/quickstart.md", "# Quickstart\n");
  write(root, "wiki/architecture/overview.md", "# Architecture\n");
  write(root, "wiki/extensions/catalog.md", "# Extensions\n");
  return root;
}

function validRules(id) {
  return [
    "# Rules",
    "",
    `## ${id} — Example rule`,
    "",
    "Follow this reviewed prompt instruction.",
    "",
    "Origin proposal: `P-0001`",
    "",
  ].join("\n");
}

function write(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}
