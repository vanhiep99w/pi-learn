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
import { readPolicyDomainConfig, resolveWikiPolicyDomains } from "../../extensions/wiki/wiki-policy.js";
import { validateWikiReadOnly } from "../../extensions/wiki/wiki-validation.ts";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "wiki-routing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (relative, content) => {
    const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content); return target;
  };
  put("wiki/_rules.md", "# Root\nROOT_POLICY_SENTINEL\n");
  const config = (domains) => put("wiki/_domains.json", JSON.stringify({ version: 1, domains }));
  return { root, put, config, model: new WikiReadModel(root) };
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

test("configured policy discovery/scaffolding follows declared domains, not documentation folders", (t) => {
  const f = fixture(t);
  f.put("wiki/modules/one/SPEC.md", spec("one")); f.put("wiki/modules/two/SPEC.md", spec("two"));
  const old = f.put("wiki/legacy/_rules.md", "# Preserve legacy policies\nLEGACY_SENTINEL\n");
  f.config([{ id: "backend", rule: "wiki/policies/backend/_rules.md", paths: ["src/"] }]);
  const missing = discoverWikiPromptRules({ projectRoot: f.root });
  assert.equal(missing.mode, "domains");
  assert.deepEqual(missing.missingRuleSections, ["wiki/policies/backend"]);
  const result = ensureWikiPromptRuleScaffolds({ projectRoot: f.root });
  assert.deepEqual(result.created, ["wiki/policies/backend/_rules.md"]);
  assert.equal(fs.existsSync(path.join(f.root, "wiki/modules/one/_rules.md")), false);
  assert.equal(fs.existsSync(path.join(f.root, "wiki/modules/two/_rules.md")), false);
  assert.equal(fs.readFileSync(old, "utf8"), "# Preserve legacy policies\nLEGACY_SENTINEL\n");
  assert.equal(discoverWikiPromptRules({ projectRoot: f.root }).valid, true);
  assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: f.root }).created, []);
});

test("policy routing unions matches with root/ancestors, ANDs task and paths, and reads no rule bodies", (t) => {
  const f = fixture(t);
  f.put("wiki/policies/_rules.md", "ANCESTOR_POLICY_SENTINEL");
  f.put("wiki/policies/backend/_rules.md", "BACKEND_POLICY_SENTINEL");
  f.put("wiki/operations/_rules.md", "OPS_POLICY_SENTINEL");
  f.config([
    { id: "backend", rule: "wiki/policies/backend/_rules.md", paths: ["src/"], tasks: ["code", "tests"] },
    { id: "docs", rule: "wiki/operations/_rules.md", tasks: ["docs"] },
  ]);
  const opened = [], original = fs.openSync;
  t.mock.method(fs, "openSync", (file, ...rest) => { opened.push(String(file)); return original(file, ...rest); });
  const result = resolveWikiPolicyDomains(f.root, { paths: ["src/a.ts", "other/a.ts"], task: "code" });
  assert.deepEqual(result.rulePaths, ["wiki/_rules.md", "wiki/policies/_rules.md", "wiki/policies/backend/_rules.md"]);
  assert.deepEqual(result.unmatchedPaths, ["other/a.ts"]);
  assert.equal(JSON.stringify(result).includes("POLICY_SENTINEL"), false);
  assert.deepEqual(opened.map((p) => path.basename(p)), ["_domains.json"]);
  assert.deepEqual(resolveWikiPolicyDomains(f.root, { paths: ["src/a.ts"], task: "docs" }).rulePaths, ["wiki/_rules.md", "wiki/operations/_rules.md"]);
  assert.equal(resolveWikiPolicyDomains(f.root, { paths: ["srcx/a.ts"], task: "code" }).matches.length, 0);
});

test("policy config is opt-in, fresh each call, and legacy routing reports only a minimum", (t) => {
  const f = fixture(t); f.put("wiki/legacy/page.md", "# Page\n");
  let result = resolveWikiPolicyDomains(f.root, { paths: ["src/file.ts"], task: "code" });
  assert.equal(result.mode, "legacy"); assert.match(result.note, /not the complete/);
  assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: f.root }).created, ["wiki/legacy/_rules.md"]);
  const config = f.config([]);
  assert.equal(resolveWikiPolicyDomains(f.root, { paths: [], task: "code" }).mode, "domains");
  fs.rmSync(config);
  assert.equal(resolveWikiPolicyDomains(f.root, { paths: [], task: "code" }).mode, "legacy");
});

test("invalid opt-in config fails closed without creating legacy scaffolds or leaking its contents", (t) => {
  const f = fixture(t); f.put("wiki/deep/page.md", "# Page\n");
  for (const content of ["SECRET_CONFIG_SENTINEL", JSON.stringify({ version: 2, domains: [] }), JSON.stringify({ version: 1, domains: [{ id: "bad", rule: "../outside/_rules.md", paths: ["src/"] }] }), "x".repeat(65537), Buffer.from([255])]) {
    f.put("wiki/_domains.json", content);
    assert.throws(() => readPolicyDomainConfig(f.root));
    assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: f.root }).created, []);
    const report = discoverWikiPromptRules({ projectRoot: f.root });
    assert.equal(report.valid, false); assert.equal(report.mode, "invalid");
    assert.equal(JSON.stringify(report).includes("SECRET_CONFIG_SENTINEL"), false);
    assert.equal(fs.existsSync(path.join(f.root, "wiki/deep/_rules.md")), false);
    const validation = validateWikiReadOnly(f.model, "all");
    assert.equal(validation.groups.graph.valid, true); assert.equal(validation.groups.rules.valid, false);
  }
});

test("policy config validates domains/selectors and routing queries", (t) => {
  const f = fixture(t);
  for (const domains of [
    [{ id: "bad", rule: "wiki/_rules.md", paths: ["src/"] }],
    [{ id: "bad", rule: "wiki/domain/_rules.md" }],
    [{ id: "bad", rule: "wiki/assets/_rules.md", tasks: ["code"] }],
    [{ id: "bad", rule: "wiki/domain/_rules.md", paths: ["src/**"] }],
    [{ id: "bad", rule: "wiki/domain/_rules.md", tasks: ["code", "code"] }],
    [{ id: "bad", rule: "wiki/domain/_rules.md", tasks: ["code"], unknown: true }],
    [{ id: "dup", rule: "wiki/a/_rules.md", tasks: ["code"] }, { id: "dup", rule: "wiki/b/_rules.md", tasks: ["docs"] }],
  ]) { f.config(domains); assert.throws(() => readPolicyDomainConfig(f.root), code("invalid_policy_config")); }
  f.config([{ id: "missing", rule: "wiki/missing/_rules.md", paths: ["src/"] }]);
  assert.throws(() => resolveWikiPolicyDomains(f.root, { paths: ["src/a"], task: "code" }), code("policy_rule_missing"));
  for (const query of [{ paths: ["../escape"], task: "code" }, { paths: [], task: "" }, { paths: ["src/", "src/"], task: "code" }]) assert.throws(() => resolveWikiPolicyDomains(f.root, query), code("invalid_policy_query"));
});

test("legacy scaffolding preserves existing project-local rule aliases without a config", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t);
  const target = f.put("local-rule.md", "# Existing rules\n");
  fs.rmSync(path.join(f.root, "wiki/_rules.md"));
  fs.symlinkSync(target, path.join(f.root, "wiki/_rules.md"));
  f.put("wiki/topic/page.md", "# Page\n");
  const result = ensureWikiPromptRuleScaffolds({ projectRoot: f.root });
  assert.equal(result.mode, "legacy");
  assert.deepEqual(result.created, ["wiki/topic/_rules.md"]);
  assert.equal(discoverWikiPromptRules({ projectRoot: f.root }).valid, true);
  assert.equal(fs.readlinkSync(path.join(f.root, "wiki/_rules.md")), target);
});

test("policy config and scaffold targets refuse symlink roots/components/files", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t);
  const outside = f.put("outside/config.json", '{"version":1,"domains":[]}');
  fs.symlinkSync(outside, path.join(f.root, "wiki/_domains.json"));
  assert.throws(() => readPolicyDomainConfig(f.root), code("unsafe_policy_path"));
  assert.deepEqual(ensureWikiPromptRuleScaffolds({ projectRoot: f.root }).created, []);
  fs.rmSync(path.join(f.root, "wiki/_domains.json"));
  f.config([{ id: "bad", rule: "wiki/alias/_rules.md", paths: ["src/"] }]);
  fs.symlinkSync(path.join(f.root, "outside"), path.join(f.root, "wiki/alias"), "dir");
  assert.equal(ensureWikiPromptRuleScaffolds({ projectRoot: f.root }).mode, "invalid");
  assert.equal(discoverWikiPromptRules({ projectRoot: f.root }).valid, false);
  assert.equal(fs.existsSync(path.join(f.root, "outside/_rules.md")), false);
});
