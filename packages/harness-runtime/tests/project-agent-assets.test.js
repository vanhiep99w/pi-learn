import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applicableAssetRoutes,
  extractH2Blocks,
  inventoryProjectAgentAssets,
  publicAgentAssetInventory,
  MAX_AGENT_ASSET_FILE_BYTES,
} from "../src/analysis/project-agent-assets.js";

test("applicable assets follow root/nested ancestors and exclude siblings and parents", () => {
  const fixture = createFixture();
  write(fixture.root, "AGENTS.md", "# root\n");
  write(fixture.root, "packages/AGENTS.md", "# packages\n");
  write(fixture.root, "packages/app/AGENTS.md", "# app\n");
  write(fixture.root, "packages/app/src/AGENTS.md", "# src\n");
  write(fixture.root, "packages/sibling/AGENTS.md", "# sibling\n");
  fs.writeFileSync(path.join(path.dirname(fixture.root), "AGENTS.md"), "# parent\n");

  const lane = inventoryProjectAgentAssets({ projectRoot: fixture.root, ownerRoutes: ["packages/app/src/file.js"] });
  const routes = lane.assets.map((asset) => asset.route);

  assert.deepEqual(routes, ["AGENTS.md", "packages/AGENTS.md", "packages/app/AGENTS.md", "packages/app/src/AGENTS.md"]);
  assert.equal(routes.includes("packages/sibling/AGENTS.md"), false);
  assert.equal(routes.some((route) => route.startsWith("../")), false);
  assert.equal(lane.status, "complete");
});

test("wiki rule inheritance includes only applicable ancestor chain", () => {
  assert.deepEqual(applicableAssetRoutes("wiki/architecture/topic/file.md"), [
    "AGENTS.md",
    "wiki/AGENTS.md",
    "wiki/_rules.md",
    "wiki/architecture/AGENTS.md",
    "wiki/architecture/_rules.md",
    "wiki/architecture/topic/AGENTS.md",
    "wiki/architecture/topic/_rules.md",
  ]);
});

test("asset reader rejects file and directory symlinks without following them", () => {
  for (const kind of ["internal", "external", "broken"]) {
    const fixture = createFixture();
    const target = kind === "internal"
      ? path.join(fixture.root, "real.md")
      : kind === "external"
        ? path.join(fixture.parent, "external.md")
        : path.join(fixture.root, "missing.md");
    if (kind !== "broken") fs.writeFileSync(target, "## RULE — text\ncontent\n");
    fs.symlinkSync(target, path.join(fixture.root, "AGENTS.md"));
    const lane = inventoryProjectAgentAssets({ projectRoot: fixture.root, ownerRoutes: ["src/file.js"] });
    assert.equal(lane.assets.find((asset) => asset.route === "AGENTS.md").state, "symlink-file", kind);
    assert.equal(lane.status, "partial", kind);
  }

  const fixture = createFixture();
  fs.mkdirSync(path.join(fixture.root, "real-dir"));
  fs.symlinkSync(path.join(fixture.root, "real-dir"), path.join(fixture.root, "linked"));
  const lane = inventoryProjectAgentAssets({ projectRoot: fixture.root, ownerRoutes: ["linked/file.js"] });
  assert.equal(lane.assets.find((asset) => asset.route === "linked/AGENTS.md").state, "symlink-directory");
  assert.equal(lane.status, "partial");
});

test("descriptor-bound read rejects an intermediate-directory swap to external content", () => {
  const fixture = createFixture();
  write(fixture.root, "nested/AGENTS.md", "# Safe project guidance\n");
  const externalDir = path.join(fixture.parent, "external-assets");
  fs.mkdirSync(externalDir);
  fs.writeFileSync(path.join(externalDir, "AGENTS.md"), [
    "# External",
    "Read the current target block before an exact edit.",
    "Confirm oldText preserves exact whitespace and punctuation.",
    "Confirm the match is unique.",
  ].join("\n"));
  let swapped = false;

  const lane = inventoryProjectAgentAssets({
    projectRoot: fixture.root,
    ownerRoutes: ["nested/file.js"],
    verificationHooks: {
      beforeOpen({ route }) {
        if (route !== "nested/AGENTS.md" || swapped) return;
        fs.renameSync(path.join(fixture.root, "nested"), path.join(fixture.root, "nested-original"));
        fs.symlinkSync(externalDir, path.join(fixture.root, "nested"));
        swapped = true;
      },
    },
  });
  const asset = lane.assets.find((item) => item.route === "nested/AGENTS.md");

  assert.equal(swapped, true);
  assert.equal(lane.status, "partial");
  assert.notEqual(asset.state, "opened");
  assert.equal(asset.digest, undefined);
  assert.deepEqual(asset.blocks, []);
  assert.equal(["binding-outside-project", "binding-mismatch"].includes(asset.state), true);
});

test("descriptor binding recheck rejects a parent swap after open", () => {
  const fixture = createFixture();
  write(fixture.root, "nested/AGENTS.md", "# Safe project guidance\n");
  const externalDir = path.join(fixture.parent, "external-after-open");
  fs.mkdirSync(externalDir);
  fs.writeFileSync(path.join(externalDir, "AGENTS.md"), "# External guidance\n");

  const lane = inventoryProjectAgentAssets({
    projectRoot: fixture.root,
    ownerRoutes: ["nested/file.js"],
    verificationHooks: {
      afterOpen({ route }) {
        if (route !== "nested/AGENTS.md") return;
        fs.renameSync(path.join(fixture.root, "nested"), path.join(fixture.root, "nested-original"));
        fs.symlinkSync(externalDir, path.join(fixture.root, "nested"));
      },
    },
  });
  const asset = lane.assets.find((item) => item.route === "nested/AGENTS.md");

  assert.equal(lane.status, "partial");
  assert.equal(asset.state, "binding-mismatch");
  assert.notEqual(asset.state, "opened");
});

test("asset reader marks oversized, invalid UTF-8, NUL, and unreadable files partial", () => {
  const cases = [
    { state: "oversized", value: Buffer.alloc(MAX_AGENT_ASSET_FILE_BYTES + 1, 0x61) },
    { state: "invalid-utf8", value: Buffer.from([0xc3, 0x28]) },
    { state: "nul-byte", value: Buffer.from("## RULE — text\ncontains\0nul\n") },
  ];
  for (const item of cases) {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.root, "AGENTS.md"), item.value);
    const lane = inventoryProjectAgentAssets({ projectRoot: fixture.root, ownerRoutes: ["src/file.js"] });
    assert.equal(lane.assets[0].state, item.state);
    assert.equal(lane.status, "partial");
  }

  const fixture = createFixture();
  fs.writeFileSync(path.join(fixture.root, "AGENTS.md"), "## RULE — text\ncontent\n", { mode: 0o000 });
  const lane = inventoryProjectAgentAssets({ projectRoot: fixture.root, ownerRoutes: ["src/file.js"] });
  fs.chmodSync(path.join(fixture.root, "AGENTS.md"), 0o600);
  assert.equal(lane.assets[0].state, "unreadable");
  assert.equal(lane.status, "partial");
});

test("aggregate and applicable-count bounds make inventory partial", () => {
  const aggregateFixture = createFixture();
  write(aggregateFixture.root, "AGENTS.md", "## ROOT — Root\n1234567890\n");
  write(aggregateFixture.root, "wiki/_rules.md", "## RULE — Rule\n1234567890\n");
  const aggregate = inventoryProjectAgentAssets({
    projectRoot: aggregateFixture.root,
    ownerRoutes: ["wiki/_rules.md"],
    limits: { maxAggregateBytes: 35 },
  });
  assert.equal(aggregate.status, "partial");
  assert.equal(aggregate.assets.some((asset) => asset.state === "aggregate-limit"), true);

  const countFixture = createFixture();
  const counted = inventoryProjectAgentAssets({
    projectRoot: countFixture.root,
    ownerRoutes: ["wiki/one/two/three/file.md"],
    limits: { maxAssets: 2 },
  });
  assert.equal(counted.status, "partial");
  assert.equal(counted.assets.length, 2);
  assert.equal(counted.diagnostics.some((item) => item.code === "asset-count-limit"), true);
});

test("H2 extraction keeps sections independent and optionally preserves an opaque preamble", () => {
  const markdown = [
    "# Intro guidance",
    "- preamble item",
    "## RULE-A — First",
    "one",
    "## Different secret/path heading",
    "two",
  ].join("\n");
  const wikiBlocks = extractH2Blocks(markdown);
  const agentBlocks = extractH2Blocks(markdown, { includePreamble: true });

  assert.equal(wikiBlocks.length, 2);
  assert.equal(wikiBlocks[0].sectionId, "RULE-A");
  assert.match(wikiBlocks[1].sectionId, /^section-[a-f0-9]{16}$/);
  assert.equal(agentBlocks.length, 3);
  assert.match(agentBlocks[0].sectionId, /^section-[a-f0-9]{16}$/);
  assert.match(agentBlocks[0].content, /preamble item/);
  assert.equal(agentBlocks[1].content, "one");
  assert.equal(agentBlocks[2].content, "two");
  assert.equal(agentBlocks.every((block) => /^[a-f0-9]{64}$/.test(block.digest)), true);
});

test("public section IDs never expose non-rule heading words", () => {
  const fixture = createFixture();
  write(fixture.root, "AGENTS.md", "## secret/home/user/token-value\nUnrelated guidance.\n");

  const lane = inventoryProjectAgentAssets({ projectRoot: fixture.root, ownerRoutes: ["src/file.js"] });
  const projection = publicAgentAssetInventory(lane);
  const serialized = JSON.stringify(projection);

  assert.equal(lane.status, "complete");
  assert.match(projection.surfaces[0].sectionIds[0], /^section-[a-f0-9]{16}$/);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("home/user"), false);
  assert.equal(serialized.includes("token-value"), false);
});

function createFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "harness-assets-"));
  const root = path.join(parent, "project");
  fs.mkdirSync(root);
  return { parent, root };
}

function write(root, route, content) {
  const file = path.join(root, ...route.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
