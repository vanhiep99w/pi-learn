import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WikiReadModel } from "../../extensions/wiki/wiki-model.ts";
import { wikiHeadings } from "../../extensions/wiki/wiki-headings.js";
import { validateWikiInternalLinks } from "../../extensions/wiki/wiki-links.js";
import { discoverWikiPromptRules, ensureWikiPromptRuleScaffolds } from "../../extensions/wiki/wiki-rules.js";
import { resolveWikiRules } from "../../extensions/wiki/wiki-policy.js";
import { validateWikiReadOnly } from "../../extensions/wiki/wiki-validation.ts";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "wiki-routing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (relative, content) => {
    const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content); return target;
  };
  put("wiki/_rules.md", "# Root\nROOT_POLICY_SENTINEL\n");
  return { root, put, model: new WikiReadModel(root) };
}
const spec = (id, scopes, body = "# Contract\nbody\n") => `---\nid: ${id}\ntype: module-design\ntitle: ${id}\n${scopes === undefined ? "" : `source-paths: ${JSON.stringify(scopes)}\n`}---\n${body}`;
const code = (expected) => (error) => error.code === expected;

// Both consumers must use the same anchors, including collisions with explicit numeric suffixes.
test("sections and link validation share Unicode, duplicate and fence-aware heading anchors", (t) => {
  const f = fixture(t);
  const body = "# Tổng quan\r\nintro\r\n## Foo\r\none\r\n### Child\r\nchild\r\n```md\r\n## Fake\r\n```\r\n## Foo-1\r\nexplicit\r\n## Foo\r\ntwo\r\n# End\r\nend\r\n";
  f.put("wiki/a.md", "\ufeff---\r\nnotes: '# Not a heading'\r\n---\r\n" + body);
  f.put("wiki/nav.md", "[VN](a.md#tổng-quan) [duplicate](a.md#foo-2) [child](a.md#child)\n");
  const metadata = f.model.get({ path: "a.md" });
  assert.deepEqual(metadata.headings.map((heading) => heading.anchor), ["tổng-quan", "foo", "child", "foo-1", "foo-2", "end"]);
  assert.equal(metadata.section, undefined);
  assert.throws(() => f.model.get({ path: "a.md", heading: "Foo" }), code("ambiguous_heading"));
  assert.equal(f.model.get({ path: "a.md", heading: "Foo", occurrence: 2 }).section.content, "## Foo\r\ntwo\r\n");
  assert.equal(f.model.get({ path: "a.md", heading: "#foo-2" }).section.startLine, 15);
  const section = f.model.get({ path: "a.md", heading: "Foo", occurrence: 1 }).section;
  assert.equal(section.content, "## Foo\r\none\r\n### Child\r\nchild\r\n```md\r\n## Fake\r\n```\r\n");
  assert.equal(section.endLine, 12);
  assert.deepEqual(validateWikiInternalLinks({ projectRoot: f.root }).issues, []);
  assert.throws(() => f.model.get({ path: "a.md", heading: "Fake" }), code("heading_not_found"));
});

test("section selectors fail explicitly and never fall back to body or reserved resources", (t) => {
  const f = fixture(t); f.put("wiki/a.md", spec("a", undefined, "# Body\nBODY_SENTINEL\n"));
  for (const [selector, expected] of [
    [{ id: "a", heading: "missing" }, "heading_not_found"],
    [{ id: "a", occurrence: 1 }, "invalid_occurrence"],
    [{ id: "a", heading: "#body", occurrence: 1 }, "invalid_occurrence"],
    [{ id: "a", heading: "Body", occurrence: 0 }, "invalid_occurrence"],
    [{ id: "a", heading: "" }, "invalid_heading"],
    [{ id: "a", path: "a.md", heading: "Body" }, "invalid_selector"],
    [{ path: "_rules.md", heading: "Root" }, "reserved_path"],
    [{ path: "_domains.json", heading: "Root" }, "reserved_path"],
  ]) assert.throws(() => f.model.get(selector), code(expected));
  assert.equal(JSON.stringify(f.model.get({ id: "a" })).includes("BODY_SENTINEL"), false);
});

test("heading lists are bounded but explicit selection can reach later headings", (t) => {
  const f = fixture(t);
  f.put("wiki/a.md", Array.from({ length: 130 }, (_, i) => `## Heading ${i}\nbody ${i}\n`).join(""));
  const metadata = f.model.get({ path: "a.md" });
  assert.equal(metadata.headings.length, 100); assert.equal(metadata.headingsTruncated, true);
  assert.equal(f.model.get({ path: "a.md", heading: "#heading-129" }).section.content, "## Heading 129\nbody 129\n");
  assert.deepEqual(wikiHeadings("~~~\n# Fake\n~~~\n    # Indented code\n# Real\n").map((h) => h.title), ["Real"]);
});

test("source lookup returns every declared owner ranked by literal specificity, not a winner", (t) => {
  const f = fixture(t);
  f.put("wiki/broad.md", spec("broad", ["src/"]));
  f.put("wiki/payments.md", spec("payments", ["src/payments/"]));
  f.put("wiki/refund.md", spec("refund", ["src/payments/refund.ts"]));
  f.put("wiki/shared.md", spec("shared", ["src/payments/refund.ts"]));
  f.put("wiki/guide.md", "# Legacy guide\nSource scope: src/other/\n");
  const result = f.model.locate("src/payments/refund.ts");
  assert.deepEqual(result.matches.map((m) => m.id), ["refund", "shared", "payments", "broad"]);
  assert.equal(result.multipleOwners, true);
  assert.equal(f.model.locate("src/payments-extra/file.ts").matches.length, 1);
  assert.equal(f.model.locate("src/payments/refund.tsx").matches.length, 2);
  assert.equal(f.model.locate("other/file.ts").matches.length, 0);
  assert.equal(result.truncated, false);
});

test("source lookup never opens source, config or rules and immediately sees changed declarations", (t) => {
  const f = fixture(t);
  const file = f.put("wiki/a.md", spec("a", ["src/old.ts"]));
  f.put("src/old.ts", "SOURCE_SENTINEL"); f.put("wiki/_domains.json", "INVALID_CONFIG_SENTINEL");
  const opened = [];
  const original = fs.openSync;
  t.mock.method(fs, "openSync", (file, ...rest) => { opened.push(String(file)); return original(file, ...rest); });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(f.model.locate("src/old.ts").matches.length, 1);
  const stat = fs.statSync(file);
  fs.writeFileSync(file, spec("a", ["src/new.ts"])); fs.utimesSync(file, stat.atime, stat.mtime);
  assert.equal(f.model.locate("src/old.ts").matches.length, 0);
  assert.equal(f.model.locate("src/new.ts").matches.length, 1);
  assert.equal(opened.some((file) => /(?:src\/|_domains|_rules)/u.test(file)), false);
});

test("malformed source mapping is a schema error, never coerced into an owner", (t) => {
  const f = fixture(t);
  for (const scopes of ["src/", ["../escape"], ["/absolute"], ["src/**"], ["src/", "src/"], [1], ["src\\file"], ["./src/"], ["src//file"], [" src/"]]) {
    f.put("wiki/a.md", spec("a", scopes));
    assert.equal(f.model.validate().diagnostics.some((d) => d.code === "invalid_source_paths"), true);
    assert.equal(f.model.locate("src/file.ts").matches.length, 0);
  }
  for (const value of ["../file", "/file", "C:file", "src/**/*.ts", "src/../file", "src\\file", ""]) assert.throws(() => f.model.locate(value), code("invalid_source_path"));
});

test("duplicate matching spec IDs cannot be presented as canonical source owners", (t) => {
  const f = fixture(t); f.put("wiki/a.md", spec("a", ["src/"])); f.put("wiki/b.md", spec("a", ["src/"]));
  assert.throws(() => f.model.locate("src/file"), code("duplicate_id"));
});

test("unconfigured service files and directories select exact module rules plus existing parents", (t) => {
  const f = fixture(t);
  f.put("order/src/Foo.java", "SOURCE_SENTINEL");
  f.put("wiki/modules/_rules.md", "PARENT_POLICY_SENTINEL");
  f.put("wiki/modules/order/_rules.md", "ORDER_POLICY_SENTINEL");
  for (const source of ["order/src/Foo.java", "order/", "order", "order/src/", "order/src/New.java"]) {
    const result = resolveWikiRules(f.root, { paths: [source], task: "code" });
    assert.deepEqual(result.rulePaths, ["wiki/_rules.md", "wiki/modules/_rules.md", "wiki/modules/order/_rules.md"]);
    assert.equal(result.mode, "convention"); assert.equal("configPath" in result, false);
    assert.deepEqual(result.matches, [{ service: "order", rule: "wiki/modules/order/_rules.md", exists: true }]);
    assert.deepEqual(result.unmatchedPaths, []);
    assert.equal(JSON.stringify(result).includes("SENTINEL"), false);
  }
});

test("service convention unions batches without content reads, writes or ownership guesses", (t) => {
  const f = fixture(t);
  for (const service of ["order", "billing"]) {
    f.put(`${service}/src/file`, "SOURCE_SENTINEL");
    f.put(`wiki/modules/${service}/_rules.md`, "POLICY_SENTINEL");
  }
  f.put("wiki/modules/_rules.md", "PARENT_POLICY_SENTINEL");
  f.put("wiki/modules/wiki/_rules.md", "NOT_A_SOURCE_SCOPE");
  f.put("wiki/modules/missing/_rules.md", "NO_SOURCE_DIRECTORY");
  f.put("wiki/modules/root-file/_rules.md", "NOT_A_DIRECTORY");
  f.put("root-file", "source file");

  const unmatched = ["unknown/file", "order-extra/file", "Order/file", "src/order/file", "wiki/modules/order/SPEC.md", "wiki/modules/order/", "missing/", "root-file"];
  for (const method of ["openSync", "readFileSync", "writeFileSync", "mkdirSync"]) {
    t.mock.method(fs, method, () => { throw new Error(`Resolver must not call ${method}`); });
  }
  const result = resolveWikiRules(f.root, { paths: ["order/", "order/src/file", "billing", ...unmatched], task: "tests" });
  assert.deepEqual(result.rulePaths, ["wiki/_rules.md", "wiki/modules/_rules.md", "wiki/modules/billing/_rules.md", "wiki/modules/order/_rules.md"]);
  assert.deepEqual(result.matches.map((m) => m.service), ["order", "billing"]);
  assert.deepEqual(result.unmatchedPaths, unmatched);
  assert.equal(JSON.stringify(result).includes("SENTINEL"), false);
  for (const paths of [[], unmatched]) {
    const legacy = resolveWikiRules(f.root, { paths, task: "docs" });
    assert.equal(legacy.mode, "legacy"); assert.deepEqual(legacy.rulePaths, ["wiki/_rules.md"]);
    assert.deepEqual(legacy.unmatchedPaths, paths); assert.match(legacy.note, /consult quickstart/u);
  }
});

test("service convention suggests absent rules and sees rule changes without scaffolding", (t) => {
  const f = fixture(t); f.put("order/src/file", "source");
  const query = { paths: ["order/"], task: "code" };
  assert.deepEqual(resolveWikiRules(f.root, query).rulePaths, ["wiki/_rules.md"]);
  assert.equal(fs.existsSync(path.join(f.root, "wiki/modules")), false);
  const rule = f.put("wiki/modules/order/_rules.md", "# Policy\n");
  assert.deepEqual(resolveWikiRules(f.root, query).rulePaths, ["wiki/_rules.md", "wiki/modules/order/_rules.md"]);
  fs.rmSync(rule);
  assert.equal(resolveWikiRules(f.root, query).mode, "convention");
  assert.deepEqual(resolveWikiRules(f.root, query).suggestedRulePaths, ["wiki/modules/order/_rules.md"]);
});

test("service convention rejects unsafe query paths before filesystem routing", (t) => {
  const f = fixture(t); f.put("order/src/file", "source"); f.put("wiki/modules/order/_rules.md", "# Policy\n");
  for (const source of ["../order/file", "/order/file", "order/../file", "order/./file", "order//file", "order\\file", "C:order/file", "order/*", "order/\u0000file"]) {
    assert.throws(() => resolveWikiRules(f.root, { paths: [source], task: "code" }), code("invalid_policy_query"));
  }
});

test("service convention refuses source and policy symlink components or files", { skip: process.platform === "win32" }, (t) => {
  const outside = fixture(t); outside.put("src/file", "OUTSIDE_SOURCE_SENTINEL"); outside.put("_rules.md", "OUTSIDE_POLICY_SENTINEL");
  for (const relative of ["order", "order/src", "order/src/file", "wiki", "wiki/modules", "wiki/modules/order", "wiki/modules/order/_rules.md", "wiki/modules/_rules.md"]) {
    const f = fixture(t); f.put("order/src/file", "source"); f.put("wiki/modules/order/_rules.md", "policy");
    const target = path.join(f.root, relative);
    const isFile = relative.endsWith("file") || relative.endsWith(".md");
    fs.rmSync(target, { recursive: true, force: true });
    fs.symlinkSync(path.join(outside.root, isFile ? "_rules.md" : ""), target, isFile ? "file" : "dir");
    assert.throws(() => resolveWikiRules(f.root, { paths: ["order/src/file"], task: "code" }), code("unsafe_policy_path"), relative);
  }
});

test("recognized service with missing policy directories suggests a target without reads or writes", (t) => {
  const f = fixture(t); f.put("order/src/Foo.java", "SOURCE_SENTINEL");
  const result = resolveWikiRules(f.root, { paths: ["order/"], task: "docs" });
  assert.equal(result.mode, "convention");
  assert.deepEqual(result.rulePaths, ["wiki/_rules.md"]);
  assert.deepEqual(result.suggestedRulePaths, ["wiki/modules/order/_rules.md"]);
  assert.deepEqual(result.matches, [{ service: "order", rule: "wiki/modules/order/_rules.md", exists: false }]);
  assert.deepEqual(result.unmatchedPaths, []);
  assert.equal(fs.existsSync(path.join(f.root, "wiki/modules")), false);
});


test("only exact top-level names route; missing targets are not aliased to another service", (t) => {
  const f = fixture(t);
  for (const service of ["order", "order-extra", "Order", "src"]) f.put(`${service}/file`, "source");
  f.put("wiki/modules/order/_rules.md", "# Rules\n");
  const result = resolveWikiRules(f.root, { paths: ["order-extra/", "Order/", "src/order/file"], task: "code" });
  assert.deepEqual(result.suggestedRulePaths, ["wiki/modules/Order/_rules.md", "wiki/modules/order-extra/_rules.md", "wiki/modules/src/_rules.md"].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(result.rulePaths, ["wiki/_rules.md"]);
  assert.deepEqual(result.unmatchedPaths, []);
});

test("suggested target becomes an existing rule on the next lookup, with additive ancestors", (t) => {
  const f = fixture(t); f.put("order/src/file", "source"); f.put("wiki/modules/_rules.md", "PARENT_SENTINEL");
  const query = { paths: ["order/src/file"], task: "code" };
  let result = resolveWikiRules(f.root, query);
  assert.deepEqual(result.rulePaths, ["wiki/_rules.md", "wiki/modules/_rules.md"]);
  assert.deepEqual(result.suggestedRulePaths, ["wiki/modules/order/_rules.md"]);
  f.put(result.suggestedRulePaths[0], "LEAF_SENTINEL");
  result = resolveWikiRules(f.root, query);
  assert.deepEqual(result.rulePaths, ["wiki/_rules.md", "wiki/modules/_rules.md", "wiki/modules/order/_rules.md"]);
  assert.deepEqual(result.suggestedRulePaths, []); assert.equal(result.matches[0].exists, true);
  assert.equal(JSON.stringify(result).includes("SENTINEL"), false);
});

test("missing Wiki/root still yields a service target and no nonexistent read paths", (t) => {
  const f = fixture(t); f.put("order/file", "source"); fs.rmSync(path.join(f.root, "wiki"), { recursive: true });
  const result = resolveWikiRules(f.root, { paths: ["order/"], task: "docs" });
  assert.equal(result.mode, "convention"); assert.deepEqual(result.rulePaths, []);
  assert.deepEqual(result.suggestedRulePaths, ["wiki/modules/order/_rules.md"]);
  assert.equal(fs.existsSync(path.join(f.root, "wiki")), false);
});

test("stale domain files never influence routing, discovery, scaffolding or rule validation", (t) => {
  const f = fixture(t); f.put("order/file", "source"); f.put("wiki/guide/page.md", "# Page\n");
  const query = { paths: ["order/"], task: "code" };
  const expected = resolveWikiRules(f.root, query);
  for (const content of ["INVALID_CONFIG_SENTINEL", Buffer.from([255]), "x".repeat(70000), JSON.stringify({ version: 1, domains: [{ id: "wrong", rule: "wiki/wrong/_rules.md", paths: ["order/"] }] })]) {
    f.put("wiki/_domains.json", content);
    assert.deepEqual(resolveWikiRules(f.root, query), expected);
    assert.deepEqual(discoverWikiPromptRules({ projectRoot: f.root }).missingRuleSections, ["wiki/guide"]);
  }
  assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: f.root }).created, ["wiki/guide/_rules.md"]);
  assert.equal(discoverWikiPromptRules({ projectRoot: f.root }).valid, true);
  assert.equal(validateWikiReadOnly(f.model, "all").valid, true);
  assert.equal(fs.existsSync(path.join(f.root, "wiki/wrong")), false);
  fs.rmSync(path.join(f.root, "wiki/_domains.json"));
  fs.symlinkSync(path.join(f.root, "outside-missing"), path.join(f.root, "wiki/_domains.json"));
  assert.deepEqual(resolveWikiRules(f.root, query), expected);
  assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: f.root }).created, []);
  assert.equal(validateWikiReadOnly(f.model, "all").valid, true);
});
