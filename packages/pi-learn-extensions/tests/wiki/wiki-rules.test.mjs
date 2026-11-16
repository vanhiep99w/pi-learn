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
  renderPromptRuleScaffold,
} from "../../extensions/wiki/wiki-rules.js";

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

test("renderPromptRuleScaffold contains zero bytes for root, domain and nested service sections", () => {
  for (const section of ["wiki", "wiki/extensions", "wiki/modules/order"]) {
    assert.equal(renderPromptRuleScaffold(section), "", section);
  }
});

test("ensureWikiPromptRuleScaffolds creates zero-byte root and final section files only once", (t) => {
  const root = createWikiFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "wiki/modules/order/SPEC.md", "# Order\n");
  write(root, "wiki/assets/logo.md", "asset\n");
  write(root, "wiki/_tmp/scratch.md", "temporary\n");

  const first = ensureWikiPromptRuleScaffolds({ projectRoot: root });
  assert.deepEqual(first.created, [
    "wiki/_rules.md",
    "wiki/architecture/_rules.md",
    "wiki/extensions/_rules.md",
    "wiki/modules/order/_rules.md",
  ]);
  const before = first.created.map((file) => fs.statSync(path.join(root, file)));
  assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: root }).created, []);
  for (const [index, file] of first.created.entries()) {
    const absolute = path.join(root, file);
    const after = fs.statSync(absolute);
    assert.equal(after.size, 0, file);
    assert.deepEqual(fs.readFileSync(absolute), Buffer.alloc(0), file);
    assert.equal(after.ino, before[index].ino);
    assert.equal(after.mtimeMs, before[index].mtimeMs);
    const lint = lintWikiPromptRuleFile({ projectRoot: root, rulePath: file });
    assert.deepEqual(lint.errors, []);
    assert.deepEqual(lint.ruleIds, []);
    assert.deepEqual(lint.warnings.map((issue) => issue.code), ["empty_rule_file"]);
  }
  for (const section of ["assets", "_tmp", "modules"]) {
    assert.equal(fs.existsSync(path.join(root, "wiki", section, "_rules.md")), false);
  }
  const report = discoverWikiPromptRules({ projectRoot: root });
  assert.equal(report.valid, true);
  assert.deepEqual(report.files, first.created);
  assert.deepEqual(report.missingRuleSections, []);
});

test("scaffolding preserves existing rules, legacy placeholders and empty files byte-for-byte", (t) => {
  const root = createWikiFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const existing = {
    "wiki/_rules.md": Buffer.from(validRules("GLOBAL-KEEP-001")),
    "wiki/architecture/_rules.md": Buffer.from("# Architecture rules\n\nLoad these rules only before editing components governed by the `wiki/architecture/` domain.\n\nNo domain-specific rules have been added yet.\n"),
    "wiki/extensions/_rules.md": Buffer.alloc(0),
  };
  for (const [file, bytes] of Object.entries(existing)) write(root, file, bytes);
  const before = Object.keys(existing).map((file) => fs.statSync(path.join(root, file)));
  assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: root }).created, []);
  for (const [index, [file, bytes]] of Object.entries(existing).entries()) {
    assert.deepEqual(fs.readFileSync(path.join(root, file)), bytes);
    const after = fs.statSync(path.join(root, file));
    assert.equal(after.ino, before[index].ino);
    assert.equal(after.mtimeMs, before[index].mtimeMs);
  }
});

test("scaffolding uses exclusive creation and preserves a concurrent writer's content", (t) => {
  const root = createWikiFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "wiki/_rules.md");
  const original = fs.writeFileSync;
  const content = validRules("CONCURRENT-KEEP-001");
  let raced = false;
  t.mock.method(fs, "writeFileSync", (file, data, options) => {
    if (file === target && !raced) {
      raced = true;
      assert.equal(options.flag, "wx");
      original(file, content);
    }
    return original(file, data, options);
  });
  const result = ensureWikiPromptRuleScaffolds({ projectRoot: root });
  assert.equal(raced, true);
  assert.deepEqual(result.created, ["wiki/architecture/_rules.md", "wiki/extensions/_rules.md"]);
  assert.equal(fs.readFileSync(target, "utf8"), content);
});

test("scaffolding rejects a symlink Wiki root and never follows section directories", { skip: process.platform === "win32" }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-scaffold-safety-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-scaffold-outside-"));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  write(outside, "page.md", "# Outside\n");
  fs.symlinkSync(outside, path.join(root, "wiki"), "dir");
  assert.throws(() => ensureWikiPromptRuleScaffolds({ projectRoot: root }), (error) => error.code === "unsafe_policy_path");
  fs.unlinkSync(path.join(root, "wiki"));
  fs.mkdirSync(path.join(root, "wiki"));
  fs.symlinkSync(outside, path.join(root, "wiki/domain"), "dir");
  assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: root }).created, ["wiki/_rules.md"]);
  assert.equal(fs.existsSync(path.join(outside, "_rules.md")), false);
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
