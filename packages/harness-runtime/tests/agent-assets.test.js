import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentAssets } from "../src/api.js";

test("agentAssets discovers project instruction, prompt, skill, extension, and config surfaces", () => {
  const fixture = createFixture();
  write(fixture.root, "package.json", JSON.stringify({
    name: "asset-fixture",
    private: true,
    pi: {
      skills: ["./skills"],
      extensions: ["./extensions/*.ts"],
    },
    privateField: "PRIVATE_MANIFEST_CONTENT",
  }));
  write(fixture.root, ".pi/settings.json", JSON.stringify({
    skills: ["./.pi/skills"],
    extensions: ["./.pi/extensions/*.js"],
  }));
  write(fixture.root, "AGENTS.md", "# Bootstrap\n\n## SAFE — project guidance\nKeep scope bounded.\n");
  write(fixture.root, "src/AGENTS.md", "## NESTED — nested guidance\nKeep ownership local.\n");
  write(fixture.root, "wiki/_rules.md", "## WIKI-ROOT — root rule\nRead the applicable chain.\n");
  write(fixture.root, "wiki/architecture/_rules.md", "## WIKI-ARCH — architecture rule\nUse the runtime boundary.\n");
  write(fixture.root, ".pi/agent/model-prompts/review.md", "---\ndescription: review\n---\nReview the project.\n");
  write(fixture.root, "skills/review/SKILL.md", "# Review skill\n\nBounded review workflow.\n");
  write(fixture.root, ".pi/skills/local/SKILL.md", "# Local skill\n\nProject-only workflow.\n");
  write(fixture.root, "extensions/project.ts", "export default function project() {}\n");
  write(fixture.root, ".pi/extensions/local.js", "export default function local() {}\n");

  const output = agentAssets({ project: fixture.root });

  assert.equal(output.kind, "pi-harness.agent-assets");
  assert.equal(output.authority.project, true);
  assert.equal(output.authority.userHome, false);
  assert.equal(output.status, "complete");
  assert.equal(output.surfaces.instructions.status, "complete");
  assert.equal(output.surfaces.prompts.assets.some((asset) => asset.route === ".pi/agent/model-prompts/review.md" && asset.state === "present"), true);
  assert.equal(output.surfaces.skills.assets.some((asset) => asset.route === "skills/review/SKILL.md" && asset.configured), true);
  assert.equal(output.surfaces.skills.assets.some((asset) => asset.route === ".pi/skills/local/SKILL.md" && asset.configured), true);
  assert.equal(output.surfaces.extensions.assets.some((asset) => asset.route === "extensions/project.ts" && asset.state === "present"), true);
  assert.equal(output.surfaces.extensions.assets.some((asset) => asset.route === ".pi/extensions/local.js" && asset.state === "present"), true);
  assert.equal(output.surfaces.configuration.assets.some((asset) => asset.route === "package.json" && asset.state === "present"), true);
  assert.equal(output.surfaces.configuration.assets.some((asset) => asset.route === ".pi/settings.json" && asset.state === "present"), true);
  assert.equal(output.surfaces.instructions.assets.some((asset) => asset.route === "wiki/_rules.md" && asset.sectionIds.includes("WIKI-ROOT")), true);
  assert.equal(output.surfaces.instructions.assets.some((asset) => asset.route === "wiki/architecture/_rules.md" && asset.sectionIds.includes("WIKI-ARCH")), true);
  assert.deepEqual(output.evidenceBoundary.presenceDoesNotProve, ["selected", "read", "invoked", "exercised", "outcome-supported"]);
});

test("agentAssets keeps user-home and private project paths outside authority", () => {
  const fixture = createFixture();
  const userHome = path.join(fixture.parent, "user-home");
  write(userHome, ".pi/agent/model-prompts/global.md", "USER_HOME_PROMPT_CONTENT");
  write(fixture.root, ".pi/agent/model-prompts/project.md", "PROJECT_PROMPT_CONTENT");
  write(fixture.root, ".pi/settings.json", JSON.stringify({ skills: ["../user-home/skills", "~/.pi/agent/skills"] }));
  write(fixture.root, ".env", "PRIVATE_ENV_CONTENT");

  const output = agentAssets({ project: fixture.root });
  const serialized = JSON.stringify(output);

  assert.equal(output.surfaces.prompts.assets.some((asset) => asset.route === ".pi/agent/model-prompts/project.md"), true);
  assert.equal(output.surfaces.prompts.assets.some((asset) => asset.route.includes("global.md")), false);
  assert.equal(output.evidenceBoundary.userHomeAssetsRead, false);
  assert.match(serialized, /outside-authority/);
  assert.doesNotMatch(serialized, /USER_HOME_PROMPT_CONTENT|PRIVATE_ENV_CONTENT|harness-agent-assets-.*user-home/);
  assert.equal(output.surfaces.skills.assets.length, 0);
});

test("agentAssets reports applicable instruction ancestry and safe malformed assets", () => {
  const fixture = createFixture();
  const outside = path.join(fixture.parent, "outside.md");
  fs.writeFileSync(outside, "outside content\n");
  write(fixture.root, "AGENTS.md", "## ROOT-RULE — root\nroot content\n");
  write(fixture.root, "packages/app/AGENTS.md", "## APP-RULE — app\napp content\n");
  write(fixture.root, "wiki/architecture/topic/_rules.md", "## TOPIC-RULE — topic\ntopic content\n");
  write(fixture.root, ".pi/settings.json", JSON.stringify({
    skills: ["./skills/oversized", "./skills/invalid"],
    extensions: ["./linked-extensions", "../outside-extensions/*.ts"],
  }));
  write(fixture.root, "skills/oversized/SKILL.md", Buffer.alloc(64 * 1024 + 1, 0x61));
  write(fixture.root, "skills/invalid/SKILL.md", Buffer.from([0xc3, 0x28]));
  fs.symlinkSync(outside, path.join(fixture.root, ".pi/agent/model-prompts", "linked.md"));
  fs.mkdirSync(path.join(fixture.root, "real-extensions"));
  fs.symlinkSync(path.join(fixture.root, "real-extensions"), path.join(fixture.root, "linked-extensions"));

  const output = agentAssets({ project: fixture.root });
  const instructionRoutes = output.surfaces.instructions.assets.map((asset) => asset.route);
  const serialized = JSON.stringify(output);

  assert.equal(output.status, "partial");
  assert.deepEqual(instructionRoutes.filter((route) => route.includes("AGENTS.md")), ["AGENTS.md", "packages/AGENTS.md", "packages/app/AGENTS.md", "wiki/AGENTS.md", "wiki/architecture/AGENTS.md", "wiki/architecture/topic/AGENTS.md"]);
  assert.equal(output.surfaces.instructions.assets.some((asset) => asset.route === "wiki/_rules.md" && asset.state === "missing"), true);
  assert.equal(output.surfaces.instructions.assets.some((asset) => asset.route === "wiki/architecture/_rules.md" && asset.state === "missing"), true);
  assert.equal(output.surfaces.instructions.assets.some((asset) => asset.route === "wiki/architecture/topic/_rules.md" && asset.sectionIds.includes("TOPIC-RULE")), true);
  assert.equal(output.surfaces.prompts.assets.find((asset) => asset.route.endsWith("linked.md")).state, "failed");
  assert.equal(output.surfaces.skills.assets.some((asset) => asset.route.endsWith("SKILL.md") && asset.state === "failed"), true);
  assert.equal(output.surfaces.extensions.assets.some((asset) => asset.route === "linked-extensions" && asset.state === "failed"), true);
  assert.doesNotMatch(serialized, /outside content|outside-extensions|outside\.md/);
});

test("agentAssets returns a bounded empty projection for missing surfaces", () => {
  const fixture = createFixture();
  const output = agentAssets({ project: fixture.root });

  assert.equal(output.status, "complete");
  for (const surface of Object.values(output.surfaces)) {
    assert.equal(surface.status, "complete");
  }
  assert.equal(output.surfaces.prompts.assets.length, 0);
  assert.equal(output.surfaces.skills.assets.length, 0);
  assert.equal(output.surfaces.extensions.assets.length, 0);
  assert.equal(output.surfaces.configuration.assets.every((asset) => asset.state === "missing"), true);
  assert.equal(output.totals.missingCount >= 3, true);
});

function createFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "harness-agent-assets-"));
  const root = path.join(parent, "project");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, ".pi/agent/model-prompts"), { recursive: true });
  return { parent, root };
}

function write(root, route, content) {
  const file = path.join(root, ...route.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
