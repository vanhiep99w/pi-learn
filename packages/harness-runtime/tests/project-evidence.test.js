import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectEvidence } from "../src/api.js";
import { collectProjectEvidence } from "../src/analysis/project-evidence.js";

test("standalone Node project returns bounded reader-safe manifest and route leads", () => {
  const fixture = createFixture({ git: false });
  write(fixture.root, "package.json", JSON.stringify({
    name: "standalone-fixture",
    version: "1.2.3",
    packageManager: "npm@10.0.0",
    engines: { node: ">=20" },
    scripts: {
      lint: "eslint src",
      release: "echo PRIVATE_SCRIPT_SECRET && npm publish",
      start: "node src/index.js",
      test: "node --test",
    },
    privateField: "DO_NOT_EXPOSE_THIS_MANIFEST_FIELD",
  }));
  write(fixture.root, "AGENTS.md", "# Bootstrap\n\n## SAFE — Safe guidance\nKeep changes bounded.\n");
  fs.mkdirSync(path.join(fixture.root, "src"));
  fs.mkdirSync(path.join(fixture.root, "tests"));
  write(fixture.root, ".github/workflows/ci.yml", "name: PRIVATE_CI_CONTENT\n");
  write(fixture.root, "package-lock.json", "{\"name\":\"standalone-fixture\"}\n");
  write(fixture.root, "docs/RELEASING.md", "release lead");

  const output = projectEvidence({ project: fixture.root });

  assert.equal(output.kind, "pi-harness.project-evidence");
  assert.equal(output.status, "partial");
  assert.equal(output.workspaceTarget.kind, "standalone");
  assert.equal(output.workspaceTarget.route, ".");
  assert.equal(output.surfaceStatus.git, "unavailable");
  assert.equal(output.changeScope.status, "unavailable");
  assert.equal(output.changeScope.entries.length, 0);
  assert.equal(output.manifests.status, "available");
  assert.equal(output.manifests.package.name, "standalone-fixture");
  assert.equal(output.manifests.package.version, "1.2.3");
  assert.equal(output.manifests.package.private, undefined);
  assert.deepEqual(output.manifests.package.scripts.map((script) => script.name), ["lint", "release", "start", "test"]);
  assert.deepEqual(output.validationRoutes.map((route) => route.script), ["lint", "test"]);
  assert.deepEqual(output.validationRoutes.find((route) => route.script === "test").argv, ["npm", "run", "test"]);
  assert.equal(output.deliveryRoutes[0].script, "release");
  assert.equal(output.deliveryRoutes[0].argv, null);
  assert.equal(output.instructions.some((asset) => asset.route === "AGENTS.md"), true);
  assert.equal(output.ownership.source.some((lead) => lead.route === "src"), true);
  assert.equal(output.ownership.tests.some((lead) => lead.route === "tests"), true);
  assert.equal(output.releaseRecovery.leads.some((lead) => lead.route === "docs/RELEASING.md"), true);
  assert.deepEqual(output.ci.workflows, [{ route: ".github/workflows/ci.yml", name: "ci.yml", provider: "github-actions" }]);
  assert.equal(output.manifests.runtime.some((manifest) => manifest.route === "package-lock.json"), true);
  assert.equal(output.evidenceBoundary.projectCommandsExecuted, false);
  assert.equal(output.evidenceBoundary.externalCiOpened, false);
  assert.deepEqual(output.evidenceBoundary.presenceDoesNotProve, ["exercise", "pass", "acceptance"]);

  const serialized = JSON.stringify(output);
  assert.doesNotMatch(serialized, /PRIVATE_SCRIPT_SECRET|DO_NOT_EXPOSE_THIS_MANIFEST_FIELD|PRIVATE_CI_CONTENT/);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(fixture.root)));
  assert.equal(output.commands.every((command) => !Object.hasOwn(command, "body")), true);
});

test("npm workspace member detection binds target and scoped validation leads", () => {
  const fixture = createFixture({ git: true });
  write(fixture.root, "package.json", JSON.stringify({
    name: "workspace-root",
    private: true,
    workspaces: ["packages/*"],
    scripts: { test: "npm test" },
  }));
  write(fixture.root, "packages/app/package.json", JSON.stringify({ name: "app", scripts: { test: "node --test", lint: "eslint src" } }));
  write(fixture.root, "packages/other/package.json", JSON.stringify({ name: "other", scripts: { test: "node --test" } }));
  fs.mkdirSync(path.join(fixture.root, "packages/app/src"), { recursive: true });
  fs.mkdirSync(path.join(fixture.root, "packages/app/tests"), { recursive: true });
  write(fixture.root, "packages/AGENTS.md", "# package guidance\n");
  write(fixture.root, "packages/app/AGENTS.md", "# app guidance\n");
  const output = collectProjectEvidence({ project: fixtureProject(path.join(fixture.root, "packages/app"), true) });

  assert.deepEqual(output.workspaceTarget, {
    kind: "workspace-member",
    route: "packages/app",
    packageRoute: "packages/app",
    ownerRoute: "packages/app",
  });
  assert.deepEqual(output.manifests.workspace.members, [{ route: "packages/app" }, { route: "packages/other" }]);
  assert.equal(output.manifests.members[0].name, "app");
  assert.equal(output.validationRoutes.some((route) => route.scopeRoute === "packages/app" && route.script === "test"), true);
  assert.equal(output.validationRoutes.some((route) => route.scopeRoute === "."), true);
  const instructionRoutes = output.instructions.map((asset) => asset.route);
  assert.deepEqual(instructionRoutes, [
    "AGENTS.md",
    "packages/AGENTS.md",
    "packages/app/AGENTS.md",
    "packages/app/src/AGENTS.md",
    "packages/app/tests/AGENTS.md",
  ]);
  assert.equal(instructionRoutes.includes("packages/other/AGENTS.md"), false);
  assert.equal(output.ownership.source.some((lead) => lead.route === "packages/app/src"), true);
  assert.equal(output.ownership.tests.some((lead) => lead.route === "packages/app/tests"), true);
});

test("missing Git and missing package manifest are explicit partial surfaces", () => {
  const noGit = createFixture({ git: false });
  write(noGit.root, "package.json", JSON.stringify({ name: "no-git" }));
  const noGitOutput = collectProjectEvidence({ project: fixtureProject(noGit.root, false) });
  assert.equal(noGitOutput.status, "partial");
  assert.equal(noGitOutput.surfaceStatus.git, "unavailable");
  assert.equal(noGitOutput.diagnostics.some((item) => item.code === "git-metadata-missing"), true);

  const noManifest = createFixture({ git: true });
  const noManifestOutput = collectProjectEvidence({ project: fixtureProject(noManifest.root, true) });
  assert.equal(noManifestOutput.status, "partial");
  assert.equal(noManifestOutput.surfaceStatus.manifests, "unavailable");
  assert.equal(noManifestOutput.manifests.package.status, "unavailable");
  assert.equal(noManifestOutput.diagnostics.some((item) => item.code === "missing-package-manifest"), true);
  assert.equal(noManifestOutput.diagnostics.some((item) => item.code === "git-index-unavailable"), true);
});

test("workspace inheritance rejects traversal and symlinked package manifests", () => {
  const fixture = createFixture({ git: false });
  const outside = path.join(fixture.parent, "outside-package.json");
  fs.writeFileSync(outside, JSON.stringify({ name: "outside" }));
  write(fixture.root, "package.json", JSON.stringify({ workspaces: ["../*", "packages/*"] }));
  fs.mkdirSync(path.join(fixture.root, "packages/app"), { recursive: true });
  fs.symlinkSync(outside, path.join(fixture.root, "packages/app/package.json"));

  const output = collectProjectEvidence({ project: fixtureProject(fixture.root, false) });

  assert.equal(output.manifests.workspace.members.length, 0);
  assert.equal(output.diagnostics.some((item) => item.code === "unsafe-workspace-pattern"), true);
  assert.equal(output.diagnostics.some((item) => item.code === "symlink-file"), true);
  assert.doesNotMatch(JSON.stringify(output), /outside-package|outside/);
});

test("dirty Git metadata is scoped to the selected workspace member without running project commands", () => {
  const fixture = createGitFixture();
  const memberFile = path.join(fixture.root, "packages/app/src/owned.js");
  const siblingFile = path.join(fixture.root, "packages/other/src/owned.js");
  fs.writeFileSync(memberFile, "changed-member-content-with-different-size\n");
  fs.writeFileSync(siblingFile, "changed-sibling-content-with-different-size\n");

  const output = projectEvidence({ project: path.join(fixture.root, "packages/app") });
  const entries = output.changeScope.entries;

  assert.equal(output.workspaceTarget.kind, "workspace-member");
  assert.equal(output.changeScope.scopeRoute, "packages/app");
  assert.equal(entries.some((entry) => entry.route === "packages/app/src/owned.js" && entry.status === "modified"), true);
  assert.equal(entries.some((entry) => entry.route === "packages/other/src/owned.js"), false);
  assert.equal(output.evidenceBoundary.projectCommandsExecuted, false);
  assert.equal(output.evidenceBoundary.scriptsExecuted, false);
  assert.equal(entries.every((entry) => !path.isAbsolute(entry.route) && !entry.route.includes("..")), true);
});

test("bounded project evidence returns unavailable for an invalid root without leaking its path", () => {
  const missingRoot = path.join(os.tmpdir(), "does-not-exist-harness-project");
  const project = fixtureProject(missingRoot, false);
  const output = collectProjectEvidence({ project, limits: { maxGitEntries: 1 } });

  assert.equal(output.status, "unavailable");
  assert.equal(output.diagnostics.some((item) => item.code === "unreadable-project-root"), true);
  assert.doesNotMatch(JSON.stringify(output), /does-not-exist-harness-project/);
});

function createFixture({ git }) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "harness-project-evidence-"));
  const root = path.join(parent, "project");
  fs.mkdirSync(root, { recursive: true });
  if (git) fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  return { parent, root };
}

function createGitFixture() {
  const fixture = createFixture({ git: false });
  write(fixture.root, "package.json", JSON.stringify({ private: true, workspaces: ["packages/*"] }));
  write(fixture.root, "packages/app/package.json", JSON.stringify({ name: "app", scripts: { test: "node --test" } }));
  write(fixture.root, "packages/other/package.json", JSON.stringify({ name: "other", scripts: { test: "node --test" } }));
  write(fixture.root, "packages/app/src/owned.js", "original-member-content\n");
  write(fixture.root, "packages/other/src/owned.js", "original-sibling-content\n");
  execFileSync("git", ["init", "-q"], { cwd: fixture.root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: fixture.root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Harness Fixture"], { cwd: fixture.root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: fixture.root, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "initial fixture"], { cwd: fixture.root, stdio: "ignore" });
  return fixture;
}

function fixtureProject(cwd, hasGit) {
  const absoluteCwd = path.resolve(cwd);
  const rootCandidate = !fs.existsSync(absoluteCwd)
    ? absoluteCwd
    : path.dirname(absoluteCwd) === absoluteCwd ? absoluteCwd : findFixtureRoot(absoluteCwd);
  const root = fs.existsSync(rootCandidate) ? fs.realpathSync(rootCandidate) : rootCandidate;
  return {
    cwd: fs.existsSync(absoluteCwd) ? fs.realpathSync(absoluteCwd) : absoluteCwd,
    projectRoot: root,
    gitRoot: hasGit ? root : undefined,
  };
}

function findFixtureRoot(cwd) {
  let current = cwd;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json")) && (fs.existsSync(path.join(current, ".git")) || current.endsWith("/project"))) return current;
    current = path.dirname(current);
  }
  return cwd;
}

function write(root, route, content) {
  const file = path.join(root, ...route.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
