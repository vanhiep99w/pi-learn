import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { parse } from "yaml";
import { applySetup, planSetup } from "../../scripts/setup-herdsman.mjs";

const names = ["scout", "researcher", "implementer", "reviewer", "validator", "generalist"];
const tools = ["web_enable", "web_search", "fetch_content", "get_search_content", "source_check"];
const script = fileURLToPath(new URL("../../scripts/setup-herdsman.mjs", import.meta.url));
const profileRoot = new URL("../../profiles/herdsman/", import.meta.url);
const aurora = fileURLToPath(new URL("../../extensions/aurora-ui.ts", import.meta.url));
const read = (file) => fs.readFileSync(file, "utf8");
const metadata = (text) => parse(text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/)[1]);

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "pi-learn-herdsman-")));
  const agentDir = path.join(root, "another user", "agent");
  const packagesDir = path.join(agentDir, "npm", "node_modules");
  const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const target = (relative) => path.join(agentDir, relative);
  for (const name of ["pi-herdsman", "pi-tool-display", "pi-web-access"]) put(path.join(packagesDir, name, "package.json"), JSON.stringify({ name, version: "0.47.1" }));
  for (const name of names) put(path.join(packagesDir, "pi-herdsman", "dist", "agents", name + ".md"), `---\nname: ${name}\n${name === "implementer" ? "agents: [scout]\n" : ""}tools: [read, codemode${name === "researcher" ? ", " + tools.join(", ") : ""}]\nextensions: [builtin:codemode]\nnoExtensions: true\n---\nBUNDLED_ROLE_SENTINEL\n`);
  put(path.join(packagesDir, "pi-tool-display", "index.ts"), "// fixture entry, never executed\n");
  put(path.join(packagesDir, "pi-web-access", "dist", "index.js"), "// fixture entry, never executed\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, agentDir, packagesDir, put, target, plan: () => planSetup({ agentDir }) };
}

function relocatedPackage(f, relativeRoot) {
  const root = path.join(f.root, relativeRoot, "packages", "pi-learn-extensions");
  const relocatedScript = f.put(path.join(root, "scripts/setup-herdsman.mjs"), read(script));
  fs.cpSync(fileURLToPath(profileRoot), path.join(root, "profiles/herdsman"), { recursive: true });
  const entry = f.put(path.join(root, "extensions/aurora-ui.ts"), "// fixture Aurora, never executed\n");
  // Copy the already-installed parser only; no install/network or host config access.
  const yamlRoot = path.dirname(createRequire(import.meta.url).resolve("yaml/package.json"));
  fs.cpSync(yamlRoot, path.join(root, "node_modules/yaml"), { recursive: true });
  return { script: relocatedScript, entry };
}

test("fresh setup creates eight files with machine-resolved additive overrides and no prompt copies", (t) => {
  const f = fixture(t);
  const setup = f.plan();
  assert.equal(setup.plan.length, 8);
  assert.equal(applySetup(setup).length, 8);
  assert.deepEqual(JSON.parse(read(f.target("pi-herdsman/config.json"))), { maxAgentDepth: 1 });
  for (const name of names) {
    const text = read(f.target(`agents/${name}.md`));
    const doc = metadata(text);
    assert.equal(doc.name, name);
    assert.deepEqual(doc.extensions, ["+" + path.join(f.packagesDir, "pi-tool-display/index.ts"), "+" + path.join(f.packagesDir, "pi-web-access/dist/index.js"), "+" + aurora]);
    if (name !== "researcher") assert.deepEqual(doc.tools, tools.map((tool) => "+" + tool));
    assert.equal(doc.model, undefined);
    assert.equal(doc.thinking, undefined);
    assert.equal(doc.agents, undefined);
    assert.equal(doc.noExtensions, undefined);
    assert.equal(text.includes("BUNDLED_ROLE_SENTINEL"), false);
    assert.equal(text.includes("/home/hieptran"), false);
  }
  const lead = read(f.target("coordinators/flexible-lead.md"));
  assert.equal(metadata(lead).bodyMode, "append");
  assert.match(lead, /pi-learn:local-source-delegation:start/);
  assert.match(lead, /Do not routinely attach whole local source files/);
  assert.equal(fs.existsSync(f.target("coordinators/orchestrator-lead.md")), false);
});

test("dry-run does not create target directories or files", (t) => {
  const f = fixture(t);
  assert.equal(applySetup(f.plan(), { dryRun: true }).length, 8);
  for (const dir of ["agents", "coordinators", "pi-herdsman"]) assert.equal(fs.existsSync(f.target(dir)), false);
});

test("second setup is byte-idempotent and leaves mtimes unchanged", (t) => {
  const f = fixture(t);
  applySetup(f.plan());
  const second = f.plan();
  const states = second.plan.map((item) => [item.path, read(item.path), fs.statSync(item.path).mtimeMs]);
  assert.deepEqual(applySetup(second), []);
  for (const [file, text, mtime] of states) { assert.equal(read(file), text); assert.equal(fs.statSync(file).mtimeMs, mtime); }
});

test("merges depth while preserving unrelated settings and never touches Pi settings/auth", (t) => {
  const f = fixture(t);
  const config = f.put(f.target("pi-herdsman/config.json"), '{ "maxAgentDepth": 3, "spawnPlacement": "tab", "contextRetirement": false }\n');
  const untouched = [f.put(f.target("settings.json"), "SETTINGS_FIXTURE_SENTINEL"), f.put(f.target("auth.json"), "SYNTHETIC_AUTH_FIXTURE_SENTINEL")];
  applySetup(f.plan());
  assert.deepEqual(JSON.parse(read(config)), { maxAgentDepth: 1, spawnPlacement: "tab", contextRetirement: false });
  for (const file of untouched) assert.match(read(file), /FIXTURE_SENTINEL$/);
});

test("preserves comments, model/thinking, custom tools and prompt body including CRLF", (t) => {
  const f = fixture(t);
  const body = "\r\nCustom prompt bytes.\r\nDo not change.\r\n";
  f.put(f.target("agents/scout.md"), "---\r\nname: scout\r\n# custom comment\r\nmodel: example/my-model\r\nthinking: high\r\ntools: [read, my_custom_tool]\r\nextensions: [builtin:codemode]\r\n---\r\n" + body);
  applySetup(f.plan());
  const text = read(f.target("agents/scout.md"));
  assert.ok(text.endsWith(body)); assert.match(text, /# custom comment/);
  const doc = metadata(text);
  assert.equal(doc.model, "example/my-model"); assert.equal(doc.thinking, "high");
  assert.deepEqual(doc.tools, ["read", "my_custom_tool", ...tools.map((tool) => "+" + tool)]);
  assert.ok(doc.extensions.includes("builtin:codemode"));
  assert.deepEqual(applySetup(f.plan()), []);
});

test("lead managed block preserves custom body and is not duplicated", (t) => {
  const f = fixture(t);
  const lead = f.put(f.target("coordinators/flexible-lead.md"), "---\nname: flexible-lead\nbodyMode: replace\nagents: [scout]\n---\n\nCustom lead policy.\n");
  applySetup(f.plan());
  let text = read(lead);
  assert.match(text, /Custom lead policy/); assert.equal(metadata(text).bodyMode, "replace"); assert.deepEqual(metadata(text).agents, ["scout"]);
  text = text.replace("Do not routinely attach whole local source files", "Outdated managed wording");
  fs.writeFileSync(lead, text + "\nAnother custom policy.\n");
  applySetup(f.plan());
  const after = read(lead);
  assert.match(after, /Do not routinely attach whole local source files/);
  assert.match(after, /Another custom policy/);
  assert.equal(after.split("<!-- pi-learn:local-source-delegation:start -->").length, 2);
});

test("adopts the prior exact unmarked personal prompt without duplicating it", (t) => {
  const f = fixture(t);
  f.put(f.target("coordinators/flexible-lead.md"), "---\nname: flexible-lead\nbodyMode: append\n---\n\n" + read(new URL("flexible-lead.md", profileRoot)));
  applySetup(f.plan());
  assert.equal(read(f.target("coordinators/flexible-lead.md")).split("## Local-source delegation").length, 2);
});

test("known invalid last target fails before writing any earlier file", (t) => {
  const f = fixture(t);
  f.put(f.target("coordinators/flexible-lead.md"), "not frontmatter");
  assert.throws(() => f.plan(), /frontmatter/);
  assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
  assert.equal(fs.existsSync(f.target("agents")), false);
});

test("invalid JSON, legacy fields and wrong definition names are rejected without migration", (t) => {
  const f = fixture(t);
  const file = f.put(f.target("pi-herdsman/config.json"), "[]");
  assert.throws(() => f.plan(), /JSON object/);
  fs.unlinkSync(file);
  const scout = f.put(f.target("agents/scout.md"), "---\nname: scout\nmax_turns: 20\n---\n");
  assert.throws(() => f.plan(), /Unsupported legacy field/);
  fs.writeFileSync(scout, "---\nname: not-scout\n---\n");
  assert.throws(() => f.plan(), /Definition name/);
  assert.equal(fs.existsSync(file), false);
});

test("respects explicit deny policies instead of widening them silently", (t) => {
  const f = fixture(t);
  const scout = f.target("agents/scout.md");
  for (const policy of ["tools: []", "tools: [-web_search]", "excludeTools: ['web_*']", "noTools: true"]) {
    f.put(scout, `---\nname: scout\n${policy}\n---\n`);
    assert.throws(() => f.plan(), /Refusing|conflicts/);
    assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
  }
});

test("symlink files, dangling links, hardlinks, and symlink parent directories fail preflight", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t);
  const outside = f.put(path.join(f.root, "outside.md"), "OUTSIDE_SENTINEL");
  const lead = f.target("coordinators/flexible-lead.md");
  fs.mkdirSync(path.dirname(lead), { recursive: true });
  for (const target of [outside, path.join(f.root, "missing.md")]) {
    fs.symlinkSync(target, lead);
    assert.throws(() => f.plan(), /Unsafe file/);
    fs.unlinkSync(lead);
  }
  fs.linkSync(outside, lead); assert.throws(() => f.plan(), /Unsafe/); fs.unlinkSync(lead);
  fs.rmdirSync(path.dirname(lead));
  fs.symlinkSync(f.root, path.dirname(lead)); assert.throws(() => f.plan(), /Unsafe directory/);
  assert.equal(read(outside), "OUTSIDE_SENTINEL");
  assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
});

test("a changed target after planning aborts before any write", (t) => {
  const f = fixture(t);
  const setup = f.plan();
  f.put(f.target("agents/generalist.md"), "CONCURRENT_EDITOR_SENTINEL");
  assert.throws(() => applySetup(setup), /changed during setup/);
  assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
});

test("missing dependency fails with installation guidance and no writes", (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.packagesDir, "pi-tool-display"), { recursive: true });
  assert.throws(() => f.plan(), /pi install npm:pi-tool-display/);
  assert.equal(fs.existsSync(f.target("agents")), false);
});

test("explicit package location and CLI dry-run support paths with spaces", (t) => {
  const f = fixture(t);
  const agentDir = path.join(f.root, "different config");
  const setup = planSetup({ agentDir, packagesDir: f.packagesDir });
  assert.equal(applySetup(setup, { dryRun: true }).length, 8);
  assert.equal(fs.existsSync(agentDir), false);
  const result = spawnSync(process.execPath, [script, "--agent-dir", agentDir, "--packages-dir", f.packagesDir, "--dry-run"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Planned 8 file/);
  assert.equal(fs.existsSync(agentDir), false);
  const bad = spawnSync(process.execPath, [script, "--unknown"], { encoding: "utf8" });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /Unknown argument/);
});

test("profile/scripts are distributed but are not registered as Pi resources", () => {
  const sub = JSON.parse(read(new URL("../../package.json", import.meta.url)));
  const root = JSON.parse(read(new URL("../../../../package.json", import.meta.url)));
  assert.ok(sub.files.includes("scripts")); assert.ok(sub.files.includes("profiles"));
  assert.equal(root.scripts["setup:herdsman"], "node packages/pi-learn-extensions/scripts/setup-herdsman.mjs");
  for (const manifest of [root, sub]) assert.equal(JSON.stringify(manifest.pi).includes("profiles"), false);
});

test("comma-separated and whitespace-padded tool denials cannot be re-enabled", (t) => {
  const f = fixture(t);
  for (const policy of [
    'tools: ["-web_search, -fetch_content"]',
    'tools: [" -web_search "]',
    'excludeTools: ["edit, web_search"]',
    'excludeTools: [" edit, web_* "]',
    'tools: [" , "]',
  ]) {
    f.put(f.target("agents/scout.md"), `---\nname: scout\n${policy}\n---\n`);
    assert.throws(() => f.plan(), /conflicts|Refusing/);
    assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
  }
});

test("normalized tool additions preserve original array entries without duplicates", (t) => {
  const f = fixture(t);
  f.put(f.target("agents/scout.md"), '---\nname: scout\ntools: ["read, web_search", " fetch_content "]\n---\n');
  applySetup(f.plan());
  const doc = metadata(read(f.target("agents/scout.md")));
  assert.deepEqual(doc.tools, ["read, web_search", " fetch_content ", "+web_enable", "+get_search_content", "+source_check"]);
  assert.deepEqual(applySetup(f.plan()), []);
});

test("merge-bearing definitions fail before direct AST edits can bypass effective policies", (t) => {
  const f = fixture(t);
  for (const policy of ["tools: []", "noTools: true", "excludeTools: ['web_*']"]) {
    f.put(f.target("agents/scout.md"), `---\nname: scout\n!!merge <<: {${policy}}\n---\n`);
    assert.throws(() => f.plan(), /YAML merge keys/);
    assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
  }
});

test("file URL directories work via flags and PI_CODING_AGENT_DIR without writes in the caller cwd", (t) => {
  const f = fixture(t);
  const url = pathToFileURL(f.agentDir).href;
  const setup = planSetup({ agentDir: url, packagesDir: pathToFileURL(f.packagesDir).href });
  assert.equal(setup.agentDir, f.agentDir);
  assert.equal(applySetup(setup, { dryRun: true }).length, 8);
  const result = spawnSync(process.execPath, [script, "--dry-run"], {
    cwd: f.root, env: { ...process.env, PI_CODING_AGENT_DIR: url }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(f.agentDir));
  assert.equal(fs.existsSync(path.join(f.root, "file:")), false);
  assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
});

test("UTF-8 BOM is preserved in an existing definition", (t) => {
  const f = fixture(t);
  f.put(f.target("agents/scout.md"), "\uFEFF---\nname: scout\n---\n\nCUSTOM_BODY\n");
  applySetup(f.plan());
  const text = read(f.target("agents/scout.md"));
  assert.ok(text.startsWith("\uFEFF---"));
  assert.ok(text.endsWith("\n\nCUSTOM_BODY\n"));
  assert.deepEqual(applySetup(f.plan()), []);
});

test("explicit extension removals conflicting with the profile are not silently undone", (t) => {
  const f = fixture(t);
  const entry = path.join(f.packagesDir, "pi-tool-display/index.ts");
  f.put(f.target("agents/scout.md"), `---\nname: scout\nextensions: [${JSON.stringify("-" + entry)}]\n---\n`);
  assert.throws(() => f.plan(), /extensions removal conflicts/);
  assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
});

test("Aurora removal on the last agent fails before any writes", (t) => {
  const f = fixture(t);
  const file = f.put(f.target("agents/generalist.md"), `---\nname: generalist\nextensions: [${JSON.stringify("-" + aurora)}]\n---\n`);
  const before = read(file);
  assert.throws(() => f.plan(), /extensions removal conflicts/);
  assert.equal(read(file), before);
  assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
  assert.equal(fs.existsSync(f.target("agents/scout.md")), false);
});

test("existing six-agent overlays gain only Aurora while keeping noExtensions and custom resources", (t) => {
  const f = fixture(t);
  const existing = ["+" + path.join(f.packagesDir, "pi-tool-display/index.ts"), "+" + path.join(f.packagesDir, "pi-web-access/dist/index.js"), "+/custom/extension.ts"];
  for (const name of names) {
    f.put(f.target(`agents/${name}.md`), `---\nname: ${name}\nnoExtensions: true\nextensions: ${JSON.stringify(existing)}\ntools: ${JSON.stringify(tools.map((tool) => "+" + tool))}\nskills: ["+/custom/SKILL.md"]\n---\nCUSTOM_BODY\n`);
  }
  applySetup(f.plan());
  for (const name of names) {
    const text = read(f.target(`agents/${name}.md`));
    const doc = metadata(text);
    assert.deepEqual(doc.extensions, [...existing, "+" + aurora]);
    assert.equal(doc.noExtensions, true);
    assert.deepEqual(doc.tools, tools.map((tool) => "+" + tool));
    assert.deepEqual(doc.skills, ["+/custom/SKILL.md"]);
    assert.ok(text.endsWith("CUSTOM_BODY\n"));
  }
  assert.deepEqual(applySetup(f.plan()), []);
});

test("relocated checkout and Git package use their own Aurora, independent of cwd and npm lookup", (t) => {
  for (const layout of ["source checkout", "agent/git/github.com/example/pi-learn"]) {
    const f = fixture(t);
    const local = relocatedPackage(f, layout);
    // Neither npm package is the resource owner, even if a misleading copy exists.
    for (const name of ["pi-learn", "pi-learn-extensions"]) {
      f.put(path.join(f.packagesDir, name, "package.json"), JSON.stringify({ name }));
      f.put(path.join(f.packagesDir, name, "extensions/aurora-ui.ts"), "// wrong copy\n");
    }
    const agentDir = path.join(f.root, "isolated output");
    const args = [local.script, "--agent-dir", pathToFileURL(agentDir).href, "--packages-dir", f.packagesDir];
    const run = (...extra) => spawnSync(process.execPath, [...args, ...extra], { cwd: f.root, encoding: "utf8" });
    const dry = run("--dry-run");
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Planned 8 file/);
    assert.equal(fs.existsSync(agentDir), false);
    const applied = run();
    assert.equal(applied.status, 0, applied.stderr);
    for (const name of names) {
      const doc = metadata(read(path.join(agentDir, "agents", `${name}.md`)));
      assert.deepEqual(doc.extensions, ["+" + path.join(f.packagesDir, "pi-tool-display/index.ts"), "+" + path.join(f.packagesDir, "pi-web-access/dist/index.js"), "+" + local.entry]);
      assert.ok(path.isAbsolute(doc.extensions[2].slice(1)));
    }
    const again = run();
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /no writes/);
  }
});

test("missing package-local Aurora fails preflight without falling back to npm or writing targets", (t) => {
  const f = fixture(t);
  const local = relocatedPackage(f, "Git package");
  fs.unlinkSync(local.entry);
  f.put(path.join(f.packagesDir, "pi-learn-extensions/extensions/aurora-ui.ts"), "// wrong copy\n");
  const result = spawnSync(process.execPath, [local.script, "--agent-dir", f.agentDir, "--packages-dir", f.packagesDir], { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing extension entry:/);
  assert.ok(result.stderr.includes(local.entry));
  assert.equal(fs.existsSync(f.target("agents")), false);
  assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
});

test("resolved YAML aliases cannot bypass noTools or tool exclusions", (t) => {
  const f = fixture(t);
  for (const policy of [
    'noBuiltinTools: &disabled true\nnoTools: *disabled',
    'tools: &denied ["-web_search"]\nexcludeTools: *denied',
    'tools: &denied ["web_search"]\nexcludeTools: *denied',
  ]) {
    f.put(f.target("agents/scout.md"), `---\nname: scout\n${policy}\n---\n`);
    assert.throws(() => f.plan(), /Refusing|conflicts/);
    assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
  }
});

test("excludeTools positive modifiers are composed before detecting web conflicts", (t) => {
  const f = fixture(t);
  for (const policy of [
    '["+web_search"]',
    '["+web_*"]',
    '["edit", "+web_*"]',
    '["+web_search,fetch_content"]',
  ]) {
    f.put(f.target("agents/scout.md"), `---\nname: scout\nexcludeTools: ${policy}\n---\n`);
    assert.throws(() => f.plan(), /excludeTools conflicts/);
    assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
  }
});

test("excludeTools modifier-only overlays retain inherited denials", (t) => {
  const f = fixture(t);
  const base = path.join(f.packagesDir, "pi-herdsman/dist/agents/scout.md");
  fs.writeFileSync(base, read(base).replace("tools:", "excludeTools: ['web_*']\ntools:"));
  f.put(f.target("agents/scout.md"), '---\nname: scout\nexcludeTools: ["+edit", "-write"]\n---\n');
  assert.throws(() => f.plan(), /excludeTools conflicts/);
  assert.equal(fs.existsSync(f.target("pi-herdsman/config.json")), false);
});

test("excludeTools explicit clearing, replacement and ordered removals use effective policy", (t) => {
  const f = fixture(t);
  const base = path.join(f.packagesDir, "pi-herdsman/dist/agents/scout.md");
  fs.writeFileSync(base, read(base).replace("tools:", "excludeTools: ['web_*']\ntools:"));
  for (const policy of ['[]', '["-web_*"]', '["edit", "+bash"]', '["-web_*", "+web_search", "-web_search"]']) {
    f.put(f.target("agents/scout.md"), `---\nname: scout\nexcludeTools: ${policy}\n---\n`);
    assert.equal(applySetup(f.plan(), { dryRun: true }).length, 8);
  }
});
