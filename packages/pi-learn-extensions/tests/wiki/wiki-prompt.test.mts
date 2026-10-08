import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createWikiAgentInstructions,
  createWikiTaskPrompt,
  isExplicitRuleUpdateRequest,
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

function render(mode: Mode, request = "REQUEST_SENTINEL", allowRuleUpdates = false) {
  return createWikiTaskPrompt(mode, root, context, request, allowRuleUpdates);
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
    for (const allowRuleUpdates of [false, true]) {
      const prompt = render(mode, "REQUEST_SENTINEL", allowRuleUpdates);
      assert.doesNotMatch(prompt, /Command reference:|\/wiki \[message\]|\/wiki-update \[message\]|There is no Wiki question command/);
      assert.doesNotMatch(prompt, /\/wiki-ask|\/wiki-init/i);
    }
  }

  const source = readFileSync(new URL("../../extensions/wiki/wiki-commands.ts", import.meta.url), "utf8");
  const commands = [...source.matchAll(/registerCommand\("([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(commands, ["wiki", "wiki-update"]);
});

test("rule updates are disabled unless the update request explicitly opts in", () => {
  const normal = render("update", "Refresh extension docs.", false);
  const optedIn = render("update", "Update wiki/**/_rules.md for the new command names.", true);

  assert.match(normal, /Do not create, edit, move, or delete wiki\/\*\*\/_rules\.md/);
  assert.match(normal, /only by \/wiki-update when its command request explicitly asks/);
  assert.match(optedIn, /Explicit rule-update mode/);
  assert.match(optedIn, /do not require a proposal or approval workflow/i);
  assert.match(optedIn, /For a rule-only request, inspect the target rules and relevant component evidence/);
  assert.match(optedIn, /Do not rewrite documentation or bootstrap files unless the request requires it/);
  assert.doesNotMatch(normal, /For a rule-only request/);
  assert.doesNotMatch(render("init", "Update wiki rules", true), /Explicit rule-update mode/);
  assert.doesNotMatch(optedIn, /Do not create, edit, move, or delete wiki\/\*\*\/_rules\.md/);
  const policy = "khi viết code tôi ko muốn viết unitest nữa";
  const policyPrompt = render("update", policy, isExplicitRuleUpdateRequest(policy));
  assert.match(policyPrompt, /Explicit rule-update mode/);
  assert.match(policyPrompt, /Lasting instructions.*owning _rules\.md/);
  assert.match(policyPrompt, /do not put it in normal Wiki pages as a workaround/);
  assert.match(policyPrompt, /A one-off instruction/);
  assert.match(policyPrompt, /ask before editing/);
  assert.match(policyPrompt, /does not mean "do not run existing tests"/);
});

test("explicit rule request detection is narrow and supports English and Vietnamese", () => {
  for (const request of [
    "Update wiki/_rules.md",
    "Update _rule file",
    "Refresh prompt rules for extensions",
    "Update the rule files",
    "Cập nhật rule cho wiki",
    "Cập nhật quy tắc wiki",
    "khi viết code tôi ko muốn viết unitest nữa",
    "Khi viết code tôi không muốn viết unit test nữa",
    "Từ nay tôi muốn agent chỉ viết unit test khi được yêu cầu",
    "Từ nay bạn không được tự push code",
    "Mỗi khi sửa code agent phải chạy test có sẵn",
    "From now on do not write unit tests unless I ask",
    "When editing code, always run existing tests",
  ]) {
    assert.equal(isExplicitRuleUpdateRequest(request), true, request);
  }
  for (const request of [
    "", "Update documentation", "Explain business rules", "Refresh quickstart",
    "Lần này đừng viết unit test",
    "Từ nay tôi không muốn viết unit test, nhưng chỉ cho task này",
    "For this task, do not write unit tests",
    "Khi viết code có thể chạy unit test bằng npm test",
    "Mô tả quy trình khi viết code agent phải chạy test",
    "Document that developers always run unit tests",
    "Từ nay hệ thống không cho phép người dùng push thông báo",
    "Tôi không muốn viết unit test",
  ]) {
    assert.equal(isExplicitRuleUpdateRequest(request), false, request);
  }
});

test("both commands omit Git context and metadata Git fields in every rule mode", () => {
  // Legacy/internal context fields must not leak into generated task prompts.
  for (const mode of modes) {
    for (const allowRuleUpdates of [false, true]) {
      const prompt = render(mode, "REQUEST_SENTINEL", allowRuleUpdates);
      assert.doesNotMatch(prompt, /GIT_CONTEXT_SENTINEL|PREVIOUS_HEAD_SENTINEL|gitHead/);
      assert.doesNotMatch(prompt, /Working tree status|Current HEAD|Recent commits|Diff summary|Git context|Git change summary|Git discipline/i);
      assert.doesNotMatch(prompt, /git status|git diff|inspect commits/i);
    }
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
