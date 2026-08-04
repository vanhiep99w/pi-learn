import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  formatWikiLinkIssues,
  validateWikiInternalLinks,
} from "../src/analysis/wiki-links.js";

test("validateWikiInternalLinks accepts files, wiki-root links, anchors, unicode, and duplicates", () => {
  const root = createWikiFixture();
  write(root, "wiki/quickstart.md", [
    "# Quickstart",
    "",
    "## Repeat",
    "## Repeat",
    "",
    "See [overview](architecture/overview.md#kiến-trúc),",
    "[root link](/architecture/overview.md),",
    "[same heading](#repeat-1), and [rules](_rules.md).",
    "External [site](https://example.com) and ![image](missing.png).",
  ].join("\n"));
  write(root, "wiki/architecture/overview.md", "# Overview\n\n## Kiến trúc\n");
  write(root, "wiki/_rules.md", "# Rules\n");

  const report = validateWikiInternalLinks({ projectRoot: root });

  assert.equal(report.filesScanned, 2);
  assert.equal(report.linksChecked, 5);
  assert.deepEqual(report.issues, []);
});

test("validateWikiInternalLinks reports missing files, anchors, traversal, and malformed encoding", () => {
  const root = createWikiFixture();
  write(root, "wiki/quickstart.md", [
    "# Quickstart",
    "",
    "[missing](missing.md)",
    "[bad anchor](architecture/overview.md#missing)",
    "[escape](../README.md)",
    "[encoding](bad%ZZ.md)",
  ].join("\n"));
  write(root, "wiki/architecture/overview.md", "# Overview\n");
  write(root, "README.md", "# Outside\n");

  const report = validateWikiInternalLinks({ projectRoot: root });

  assert.equal(report.issues.length, 4);
  assert.match(report.issues[0].message, /does not exist/);
  assert.match(report.issues[1].message, /heading anchor/);
  assert.match(report.issues[2].message, /outside the wiki root/);
  assert.match(report.issues[3].message, /percent encoding/);
  assert.match(formatWikiLinkIssues(report), /wiki\/quickstart\.md:3/);
});

test("validateWikiInternalLinks skips reserved sources and rejects symlink targets", {
  skip: process.platform === "win32",
}, () => {
  const root = createWikiFixture();
  write(root, "wiki/quickstart.md", "See [outside](linked.md).\n");
  write(root, "wiki/INSTRUCTIONS.md", "Broken [ignored](missing.md).\n");
  write(root, "outside.md", "# Outside\n");
  fs.symlinkSync(path.join(root, "outside.md"), path.join(root, "wiki", "linked.md"));

  const report = validateWikiInternalLinks({ projectRoot: root });

  assert.equal(report.filesScanned, 1);
  assert.equal(report.issues.length, 1);
  assert.match(report.issues[0].message, /symbolic link/);
});

test("validateWikiInternalLinks rejects a symlinked wiki root", {
  skip: process.platform === "win32",
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-links-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-links-outside-"));
  fs.symlinkSync(outside, path.join(root, "wiki"));

  assert.throws(
    () => validateWikiInternalLinks({ projectRoot: root }),
    /must not be a symbolic link/,
  );
});

test("validateWikiInternalLinks returns an empty report when wiki is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-links-missing-"));
  assert.deepEqual(validateWikiInternalLinks({ projectRoot: root }), {
    filesScanned: 0,
    linksChecked: 0,
    issues: [],
  });
});

function createWikiFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-links-"));
  fs.mkdirSync(path.join(root, "wiki"), { recursive: true });
  return root;
}

function write(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}
