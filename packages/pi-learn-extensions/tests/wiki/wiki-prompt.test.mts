import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createWikiAgentInstructions,
  createWikiTaskPrompt,
} from "../../extensions/wiki/wiki-prompt.ts";

type Mode = Parameters<typeof createWikiTaskPrompt>[0];
const modes: Mode[] = ["init", "update"];
const context = {
  lastUpdate: {
    updatedAt: "2026-01-01T00:00:00.000Z",
    command: "update" as const,
    gitHead: "PREVIOUS_HEAD_SENTINEL",
    model: "fixture/model",
  },
  gitSummary: "GIT_CONTEXT_SENTINEL",
  wikiBrief: "BRIEF_SENTINEL: focus on checkout contracts.",
};
const root = "/fixture/project with spaces";

function render(mode: Mode, request = "REQUEST_SENTINEL") {
  return createWikiTaskPrompt(mode, root, context, request);
}

for (const mode of modes) {
  test(`${mode}: includes repository context and exact request with mode-scoped brief`, () => {
    const request = '  REQUEST_SENTINEL: giải thích "retry"\nKeep API names unchanged.  ';
    const prompt = render(mode, request);
    assert.ok(prompt.includes(root));
    assert.ok(prompt.endsWith(request.trim()));
    assert.equal(prompt.split("REQUEST_SENTINEL").length - 1, 1);
    assert.equal(prompt.split("BRIEF_SENTINEL").length - 1, mode === "init" ? 1 : 0);
  });

  test(`${mode}: keeps selective reading and evidence boundaries`, () => {
    const prompt = render(mode);
    assert.match(prompt, /preload the entire wiki/);
    assert.match(prompt, /targeted grep/);
    assert.match(prompt, /Stop once the task is grounded/);
    if (mode === "init") {
      assert.match(prompt, /task -> system -> page\/heading/);
      assert.match(prompt, /#anchor is a navigation hint/);
    } else {
      assert.match(prompt, /quickstart\.md only if routing is needed/);
      assert.match(prompt, /Load applicable _rules\.md files immediately before edits/);
      assert.match(prompt, /Read wiki\/INSTRUCTIONS\.md only when needed/);
      assert.match(prompt, /Do not create, edit, move, or delete wiki\/INSTRUCTIONS\.md or wiki\/\.last-update\.json/);
    }
    assert.match(prompt, /source, tests, manifests/);
    assert.match(prompt, /Never read secrets/);
  });

  test(`${mode}: preserves planning, depth, and navigation quality`, () => {
    const prompt = render(mode);
    if (mode === "init") {
      assert.match(prompt, /discovery -> plan -> topic research\/write -> coverage\/navigation review/);
      assert.match(prompt, /control and data flows through callers, state owners, persistence/);
      assert.match(prompt, /Do not stop at directory names/);
      assert.match(prompt, /Choose page count from real repository complexity/);
      assert.match(prompt, /one canonical explanation per concept or contract/);
      assert.match(prompt, /confirmed behavior from inference and unknowns/);
      assert.match(prompt, /important systems, schemas, configuration, tests/);
      assert.match(prompt, /verify all added or changed internal Wiki links/);
    } else {
      assert.match(prompt, /Let the user's request define the update scope/);
      assert.match(prompt, /No full discovery or mandatory plan file is needed/);
      assert.match(prompt, /do not edit files and report the no-op/);
      assert.match(prompt, /Preserve accurate unaffected content/);
      assert.match(prompt, /Verify added or changed internal Wiki links/);
      assert.match(prompt, /Edit top-level AGENTS\.md or CLAUDE\.md only when explicitly requested/);
      assert.doesNotMatch(prompt, /Agent bootstrap:|Documentation contract:|Research and writing:|```markdown|Build a repository inventory|discovery -> plan/);
      assert.ok(prompt.length < render("init").length * 0.6);
    }
  });
}

test("init and update omit command reference while keeping the public command surface", () => {
  for (const mode of modes) {
    const prompt = render(mode);
    assert.doesNotMatch(prompt, /Command reference:|\/wiki \[message\]|\/wiki-update \[message\]|There is no Wiki question command/);
    assert.doesNotMatch(prompt, /\/wiki-ask|\/wiki-init/i);
  }

  const source = readFileSync(new URL("../../extensions/wiki/wiki-commands.ts", import.meta.url), "utf8");
  const commands = [...source.matchAll(/registerCommand\("([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(commands, ["wiki", "wiki-update"]);
});

test("update delegates intent classification and rule ownership to the agent without keywords", () => {
  for (const request of [
    "khi viết code tôi ko muốn viết unitest nữa",
    "Trước khi bàn giao hãy kiểm tra các liên kết đã thay đổi",
    "Update wiki/**/_rules.md for the new command names.",
    "Refresh extension docs.",
    "Lần này đừng viết unit test",
  ]) {
    const prompt = render("update", request);
    assert.match(prompt, /Agent-directed rule updates/);
    assert.match(prompt, /Permission does not depend on keywords or a named file/);
    assert.match(prompt, /Classify the user's intent and choose the owning rule file yourself/);
    assert.match(prompt, /do not ask the user to supply a rule filename/);
    assert.match(prompt, /Select the narrowest owning domain/);
    assert.match(prompt, /root _rules\.md only for repository-wide policies/);
    assert.match(prompt, /Do not invent policies or change them for a documentation-only request/);
    assert.match(prompt, /Lasting instructions.*owning _rules\.md/);
    assert.match(prompt, /A one-off instruction/);
    assert.match(prompt, /do not persist it in either rules or documentation/);
    assert.match(prompt, /ask before editing/);
    assert.match(prompt, /Ask about the policy or its scope, not permission keywords or filenames/);
    assert.match(prompt, /does not mean "do not run existing tests"/);
    assert.match(prompt, /do not require a proposal or approval workflow/i);
    assert.match(prompt, /For a rule-only request, inspect the target rules and relevant component evidence/);
    assert.match(prompt, /Do not rewrite documentation or bootstrap files unless the request requires it/);
    assert.doesNotMatch(prompt, /Do not create, edit, move, or delete wiki\/\*\*\/_rules\.md/);
  }
});

test("init never permits rule updates even when the request names rules", () => {
  const prompt = render("init", "Update wiki/_rules.md");
  assert.match(prompt, /Do not create, edit, move, or delete wiki\/\*\*\/_rules\.md/);
  assert.match(prompt, /only during an active \/wiki-update run/);
  assert.doesNotMatch(prompt, /Agent-directed rule updates/);
});

test("both commands omit Git context and metadata Git fields", () => {
  // Legacy/internal context fields must not leak into generated task prompts.
  for (const mode of modes) {
    const prompt = render(mode);
    assert.doesNotMatch(prompt, /GIT_CONTEXT_SENTINEL|PREVIOUS_HEAD_SENTINEL|gitHead/);
    assert.doesNotMatch(prompt, /Working tree status|Current HEAD|Recent commits|Diff summary|Git context|Git change summary|Git discipline/i);
    assert.doesNotMatch(prompt, /git status|git diff|inspect commits/i);
  }
  const source = readFileSync(new URL("../../extensions/wiki/wiki-commands.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createGitSummary|gitSummary|Working tree status/);
});

test("update retains non-Git metadata and handles absent metadata", () => {
  const prompt = render("update");
  assert.ok(prompt.includes(context.lastUpdate.updatedAt));
  assert.ok(prompt.includes(context.lastUpdate.model));
  const withoutMetadata = createWikiTaskPrompt("update", root, { lastUpdate: null, wikiBrief: null });
  assert.match(withoutMetadata, /No previous Wiki update metadata was found/);
});

test("the reusable bootstrap is compact and matches checked-in agent files", () => {
  const bootstrap = createWikiAgentInstructions();
  assert.ok(bootstrap.length < 2000);
  assert.match(bootstrap, /Selective Wiki reading:/);
  assert.match(bootstrap, /Do not preload the entire wiki/);
  const prompt = render("init");
  assert.equal(prompt.split("Selective Wiki reading:").length - 1, 1);
  assert.ok(prompt.includes("```markdown\n" + bootstrap + "\n```"));
  assert.doesNotMatch(render("update"), /Selective Wiki reading:|## Project Wiki/);
  assert.match(bootstrap, /read `wiki\/quickstart\.md` if it has not already been read/);
  assert.match(bootstrap, /For unrelated requests, do not read it/);
  assert.match(bootstrap, /Before editing a project component/);
  assert.match(bootstrap, /Do not load rules for read-only questions or unrelated domains/);
  assert.doesNotMatch(bootstrap, /proposal|approval/i);

  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    const content = readFileSync(new URL(`../../../../${filename}`, import.meta.url), "utf8");
    const marker = "## Project Wiki\n";
    assert.equal(content.split(marker).length - 1, 1, `${filename} must contain one Project Wiki block`);
    const block = content.slice(content.indexOf(marker)).split(/\n## /, 1)[0].trim();
    assert.equal(block, bootstrap, `${filename} must match the generated bootstrap`);
  }
});
