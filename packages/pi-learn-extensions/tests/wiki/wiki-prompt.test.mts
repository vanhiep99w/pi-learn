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
    }
    assert.match(prompt, /Do not create, edit, move, or delete wiki\/INSTRUCTIONS\.md or wiki\/\.last-update\.json/);
    assert.match(prompt, /source, tests, manifests/);
    assert.match(prompt, /Never read secrets/);
  });

  test(`${mode}: preserves planning, depth, and navigation quality`, () => {
    const prompt = render(mode);
    if (mode === "init") {
      assert.match(prompt, /Plan in context/);
      assert.match(prompt, /Create wiki\/_plan\.md only if needed and absent/);
      assert.match(prompt, /remove only your temporary plan/);
      assert.match(prompt, /control and data flows through callers, state owners, persistence/);
      assert.match(prompt, /Do not infer architecture from directory names alone/);
      assert.match(prompt, /not page\/line quotas/);
      assert.match(prompt, /one canonical explanation per concept or contract/);
      assert.match(prompt, /confirmed behavior from inference and unknowns/);
      assert.match(prompt, /Verify added or changed internal Wiki links and anchors/);
    } else {
      assert.match(prompt, /Let the user's request define the update scope/);
      assert.match(prompt, /No full discovery or mandatory plan file is needed/);
      assert.match(prompt, /do not edit files and report the no-op/);
      assert.match(prompt, /Preserve accurate unaffected content/);
      assert.match(prompt, /Verify added or changed internal Wiki links/);
      assert.match(prompt, /Edit top-level AGENTS\.md or CLAUDE\.md only when explicitly requested/);
      assert.doesNotMatch(prompt, /Bootstrap setup:|Documentation contract:|Research and writing:|```markdown|Build a repository inventory|discovery -> plan/);
      // Init is now lean too; comparing update to a bloated init rewards padding.
      assert.ok(prompt.length < 5000, "focused update instructions stay compact for this fixture");
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

for (const mode of modes) {
  test(`${mode}: separates task instructions from metadata-tool mechanics`, () => {
    const prompt = render(mode);
    assert.doesNotMatch(prompt, /Spec authoring \(|data\.revision|output\.revision|queue waits|active Wiki run\/cwd|Built-in normal-page editing permissions|No delete\/rename tool|current Pi provider/);
    assert.match(prompt, /[Uu]se spec tools for metadata/);
    assert.doesNotMatch(prompt, /wiki_spec_delete|(?<!wiki_)spec_create|(?<!wiki_)spec_update/);
    if (mode === "init") {
      assert.doesNotMatch(prompt, /Wiki lookup \(|wiki_search:|wiki_get:|wiki_graph:|match\/output continuation/);
      assert.match(prompt, /no migration, conversion, split, move or deletion to adopt Spec Graph/);
    } else {
      assert.equal(prompt.split("Wiki lookup (").length - 1, 1);
      assert.match(prompt, /if available; otherwise targeted grep\/read/);
      assert.match(prompt, /wiki_search: scope specs for contracts, guides for operations, all for legacy pages/);
      assert.match(prompt, /No matches does not prove no contract exists/);
      assert.match(prompt, /wiki_get: exactly one id or Wiki-relative path; metadata by default, heading for one verbatim section/);
      assert.match(prompt, /wiki_locate: declared source -> spec owners/);
      assert.match(prompt, /wiki_rules: applicable paths before edits/);
      assert.match(prompt, /wiki_graph: small depth/);
      assert.match(prompt, /not every ancestor\/dependency/);
      assert.match(prompt, /Edges may be incomplete; confirm source\/tests/);
      assert.match(prompt, /restart stale output, never combine revisions/);
      assert.match(prompt, /wiki_validate: graph\/schema by default/);
      assert.match(prompt, /do not migrate, move, split, convert or delete them to adopt Spec Graph/);
    }
  });
}

test("update preserves durable task knowledge without persisting history or deleting user plans", () => {
  const prompt = render("update");
  assert.match(prompt, /verified behavior, confirmed rationale and lasting constraints, not checklist\/history/);
  assert.match(prompt, /Label assumptions; no auto-promotion or deleting user-owned plans/);
  assert.match(prompt, /preserve stable id, check reverse consumers/);
  assert.match(prompt, /no invented edges or silent source\/spec conflict resolution/);
  assert.match(prompt, /Remove only a temporary wiki\/_plan\.md created by this run/);
  assert.match(prompt, /preserve pre-existing\/user-owned plans/);
});

test("init keeps validation and review boundaries without narrating runtime finalization", () => {
  const prompt = render("init");
  assert.match(prompt, /New or inferred specs stay draft until user review/);
  assert.match(prompt, /run schema\/graph validation/);
  assert.match(prompt, /Structural checks do not establish semantic correctness/);
  const finish = prompt.slice(prompt.indexOf("\nFinish:"), prompt.indexOf("Bootstrap setup ("));
  assert.match(finish, /Report files, checks, corrections and gaps/);
  assert.match(finish, /distinguish confirmed findings, inferences and items needing user review/);
  assert.doesNotMatch(prompt, /extension also validates|after the agent settles|finalizes it|current Pi provider/);
});

test("new Wiki generator uses real boundaries, draft metadata and concise evidence-based specs", () => {
  const prompt = render("init");
  assert.match(prompt, /not every folder\/file/);
  assert.match(prompt, /stable id\/type\/title metadata/);
  assert.match(prompt, /wiki\/modules\//);
  assert.match(prompt, /Create target nodes first; never invent dependencies/);
  assert.match(prompt, /Preserve verified existing pages and owners in place/);
  assert.match(prompt, /Lead with responsibility, boundary, consumer contracts and confirmed rationale/);
  assert.match(prompt, /observed behavior, reviewed constraints and inline unconfirmed assumptions/);
  assert.match(prompt, /Confirmed limits belong in owning specs; TODOs\/missing tests alone are not proof/);
  assert.match(prompt, /omit code inventories, task history and empty\/TBD sections/);
  assert.match(prompt, /Keep existing paths when they already own the knowledge/);
  assert.doesNotMatch(prompt, /For NEW Wikis|genuinely undocumented modules|source-owner lookup|Do not copy this repository's package names|Build a repository inventory|during updates/);
  // Measure generated task instructions, not the supplied user brief or bootstrap artifact.
  const task = prompt.split("\n\n---\n\n")[0]!;
  assert.ok(task.length < 4200, "generation task stays focused with limitations and review handoff, excluding user brief and bootstrap");
  assert.equal(task.split("New or inferred specs stay draft").length - 1, 1);
  assert.equal(task.split("wiki/_plan.md").length - 1, 1);
});

test("init surveys agent guidance first and forms a working model before writing", () => {
  const prompt = render("init");
  const research = prompt.slice(prompt.indexOf("Research:"), prompt.indexOf("\nWrite:"));
  assert.match(research, /agent files \(AGENTS\.md\/CLAUDE\.md\) -> docs \(README\/ADRs\/Wiki\) -> manifests\/layout -> code, tests and operational scripts/);
  assert.match(research, /Reuse guidance already in context/);
  assert.match(research, /Before writing, build a brief working model in context, not a file/);
  assert.match(research, /purpose, domain, stack, modules \(responsibilities\/dependencies\), invariants \(enforced boundaries\), decisions \(choices\/missing why\)/);
  assert.match(research, /failure paths to confirm that model/);
  assert.match(research, /Ask only about material gaps the files cannot answer: intent, rationale or limitations/);
  assert.doesNotMatch(render("update"), /Survey in order:|build a brief working model/);
});

test("absent or blank init brief adds no empty section or absence announcement", () => {
  const renderBrief = (wikiBrief: string | null) => createWikiTaskPrompt("init", root, { lastUpdate: null, wikiBrief });
  const missing = renderBrief(null);
  assert.equal(renderBrief(""), missing);
  assert.equal(renderBrief("  \n  "), missing);
  assert.doesNotMatch(missing, /Persistent Wiki brief|none found|---\n\n---/);
  const supplied = renderBrief("  BRIEF_SENTINEL  ");
  assert.equal(supplied.split("BRIEF_SENTINEL").length - 1, 1);
  assert.match(supplied, /Persistent Wiki brief from wiki\/INSTRUCTIONS\.md/);
});

test("bootstrap remains a separate init setup step with its original ownership limits", () => {
  const init = render("init");
  assert.ok(init.indexOf("Bootstrap setup (") > init.indexOf("Finish:"));
  assert.equal(init.split("Bootstrap setup (").length - 1, 1);
  assert.match(init, /if neither exists, create AGENTS\.md/);
  assert.match(init, /Preserve unrelated content and do not edit nested agent instruction files/);
  assert.doesNotMatch(render("update"), /Bootstrap setup \(|```markdown/);
});
