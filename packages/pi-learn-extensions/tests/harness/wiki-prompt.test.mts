import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createHarnessWikiAgentInstructions,
  createHarnessWikiTaskPrompt,
} from "../../extensions/harness/wiki-prompt.ts";

type Mode = Parameters<typeof createHarnessWikiTaskPrompt>[0];
const modes: Mode[] = ["init", "update", "chat"];
const documentationModes = ["init", "update"] as const;
const context = {
  lastUpdate: {
    updatedAt: "2026-01-01T00:00:00.000Z",
    command: "update" as const,
    gitHead: "PREVIOUS_HEAD_SENTINEL",
    model: "fixture/model",
  },
  gitSummary: "GIT_CONTEXT_SENTINEL",
  wikiBrief: "BRIEF_SENTINEL: focus on checkout contracts; exclude generated assets.",
};
const root = "/fixture/project with spaces";

function render(mode: Mode, request = "REQUEST_SENTINEL") {
  return createHarnessWikiTaskPrompt(mode, root, context, request);
}

for (const mode of modes) {
  test(`${mode}: includes the exact request and brief once without losing repository context`, () => {
    const request = '  REQUEST_SENTINEL: giải thích "retry"\nKeep API names unchanged.  ';
    const prompt = render(mode, request);
    assert.ok(prompt.includes(root));
    assert.ok(prompt.endsWith(request.trim()));
    assert.equal(prompt.split("REQUEST_SENTINEL").length - 1, 1);
    assert.equal(prompt.split("BRIEF_SENTINEL").length - 1, 1);
  });

  test(`${mode}: routes to selected sections and permits evidence-driven expansion`, () => {
    const prompt = render(mode);
    assert.match(prompt, /task -> system -> page\/heading/);
    assert.match(prompt, /Do not preload the entire wiki/);
    assert.match(prompt, /targeted grep/);
    assert.match(prompt, /small result limit/);
    assert.match(prompt, /#anchor is a navigation hint, not a read-tool range/);
    assert.match(prompt, /same or higher level/);
    assert.match(prompt, /read with offset and limit/);
    assert.match(prompt, /Continue a truncated section/);
    assert.match(prompt, /starting budget, not a hard cap/);
    assert.match(prompt, /Do not assume the initial selection covers all consumers/);
    assert.match(prompt, /Stop retrieval once the question or change is grounded/);
    assert.match(prompt, /Wiki is insufficient, appears stale or contradictory/);
  });

  test(`${mode}: keeps rule loading, reserved ownership, and privacy boundaries`, () => {
    const prompt = render(mode);
    for (const reserved of ["wiki/**/_rules.md", "wiki/INSTRUCTIONS.md", "wiki/.last-update.json"]) {
      assert.ok(prompt.includes(reserved), reserved);
    }
    assert.match(prompt, /Rule loading/);
    assert.match(prompt, /wiki\/_rules\.md/);
    assert.match(prompt, /applicable section/);
    assert.match(prompt, /compaction/);
    assert.match(prompt, /English/);
    assert.match(prompt, /secret values/);
    assert.match(prompt, /payload logs/);
    assert.match(prompt, /placeholders/);
    assert.match(prompt, /reviewed _rules\.md files and repository agent instructions retain their separate authority/);
  });
}

test("chat has a dedicated small instruction budget, without generation or Git scaffolding", () => {
  const minimalContext = { lastUpdate: null, gitSummary: "UNUSED_GIT", wikiBrief: null };
  const chat = createHarnessWikiTaskPrompt("chat", "/project", minimalContext, "Explain retries.");
  const init = createHarnessWikiTaskPrompt("init", "/project", minimalContext, "Explain retries.");
  // Budget the fixed prompt, not arbitrary user-owned brief/request content.
  assert.ok(chat.length < 4500, `chat prompt grew to ${chat.length} characters`);
  assert.ok(chat.length < init.length * 0.25, "chat must not reuse the full generation prompt");
  assert.doesNotMatch(chat, /UNUSED_GIT|Planning discipline|Git discipline|Root agent instruction files/);
  assert.doesNotMatch(chat, /Per-topic quality contract|Multi-system repositories|Coverage and navigation review/);
  assert.doesNotMatch(chat, /wiki\/_plan\.md|Last update metadata|Git change summary/);
  assert.match(chat, /Do not create or update documentation unless explicitly asked/);
  assert.match(chat, /Do not create a plan or review\/mutate the coverage backlog for an ordinary question/);
  assert.match(chat, /Wiki is absent or insufficient, disclose that/);
  assert.match(chat, /When asked what the Wiki says, stay within normal wiki\/ documentation unless it is insufficient/);
  assert.match(chat, /selective retrieval must not skip required rules/);
});

test("Git evidence is retained for documentation runs, not injected into question turns", () => {
  assert.ok(render("init").includes(context.gitSummary));
  assert.ok(render("update").includes(context.gitSummary));
  assert.ok(render("update").includes(context.lastUpdate.gitHead));
  assert.doesNotMatch(render("chat"), /GIT_CONTEXT_SENTINEL|PREVIOUS_HEAD_SENTINEL/);
});

for (const mode of documentationModes) {
  test(`${mode}: requires topic research and substantive coverage without page quotas`, () => {
    const prompt = render(mode);
    assert.match(prompt, /discovery -> plan -> topic research\/write -> coverage and navigation review/);
    assert.match(prompt, /Do not stop at directory names or one representative file/);
    assert.match(prompt, /end-to-end control and data flows through callers, callees, state owners/);
    assert.match(prompt, /Starting paths are research entrypoints, not boundaries/);
    assert.match(prompt, /Per-topic quality contract/);
    for (const concept of ["inputs, outputs", "state/persistence", "invariants", "failure/recovery", "configuration/defaults", "focused tests"]) {
      assert.ok(prompt.includes(concept), concept);
    }
    assert.match(prompt, /distinguish confirmed behavior from inference and unknowns/);
    assert.match(prompt, /Do not pad a page/);
    assert.match(prompt, /scope and when to read it/);
    assert.match(prompt, /stable, descriptive H2\/H3 headings/);
    assert.match(prompt, /not a fixed page or word budget/);
    assert.doesNotMatch(prompt, /at most 8 documentation pages|first-pass wiki|about 10 or fewer|soft diff budget/);
    assert.match(prompt, /not a deterministic guarantee of completeness/);
    assert.match(prompt, /not a durable runtime page queue/);
    assert.match(prompt, /Verify factual changes against current source\/tests/);
    assert.match(prompt, /not a substitute for generation evidence/);
  });

  test(`${mode}: plans real service/MFE boundaries, contracts, consumers, and failures`, () => {
    const prompt = render(mode);
    assert.match(prompt, /compact system map when needed/);
    assert.match(prompt, /Do not invent a service boundary for every folder or package/);
    assert.match(prompt, /single-system repositories do not need an artificial microservice taxonomy/);
    assert.match(prompt, /API\/event\/shared-type contracts in one canonical place/);
    assert.match(prompt, /runtime calls\/events from build\/shared-library dependencies and deployment coupling/);
    assert.match(prompt, /Mark unknown\/external consumers/);
    assert.match(prompt, /never imply an unverified consumer inventory is complete/);
    for (const concept of ["Module Federation", "import maps", "mount/unmount", "auth/session", "singleton/version", "remote-load failure/fallback", "asset caching", "rollback"]) {
      assert.ok(prompt.includes(concept), concept);
    }
    assert.match(prompt, /Omit mechanisms the repository does not use/);
    assert.match(prompt, /Do not instruct every task to load all services or remotes/);
    assert.match(prompt, /a local implementation\/UI change/);
    assert.match(prompt, /an API\/event\/shared-package change/);
    assert.match(prompt, /a cross-system failure/);
  });

  test(`${mode}: keeps routing light and detail canonical without weakening coverage`, () => {
    const prompt = render(mode);
    assert.match(prompt, /quickstart\.md a lightweight entrypoint/);
    assert.match(prompt, /canonical page#heading/);
    assert.match(prompt, /Put detailed symbol\/test\/validation guidance in the target sections/);
    assert.match(prompt, /repair inbound links after moves or renames/);
    assert.match(prompt, /not into an ever-growing quickstart/);
    assert.match(prompt, /it must not become an excuse to omit other systems/);
    assert.match(prompt, /specific reason such as unavailable evidence or an explicit scope constraint/);
    assert.match(prompt, /Do not defer supported important content just to satisfy a page budget/);
    assert.match(prompt, /delete wiki\/_plan\.md/);
    assert.ok(prompt.includes(createHarnessWikiAgentInstructions()));
  });
}

test("update supports explicit deepening while keeping ordinary updates scoped and non-churning", () => {
  const prompt = render("update", "Deepen checkout documentation without a source change.");
  assert.match(prompt, /explicit request to deepen documentation is valid scope even without a source change/);
  assert.match(prompt, /one-file contract change can require several pages/);
  assert.match(prompt, /ordinary updates are not a full regeneration/);
  assert.match(prompt, /Preserve accurate unaffected content and structure/);
  assert.match(prompt, /Do not make formatting-only edits/);
  assert.match(prompt, /During ordinary updates, restructure only the affected scope/);
  assert.match(prompt, /Refresh quickstart\/domain routes when ownership, page layout, headings/);
  assert.match(prompt, /only after coverage is complete/);
  assert.match(prompt, /no explicit documentation request/);
  assert.match(prompt, /Say that the wiki is already current/);
});

test("init finalizes routes against real pages instead of leaving a speculative outline", () => {
  const prompt = render("init");
  assert.match(prompt, /then finalize quickstart against the actual pages\/headings/);
  assert.match(prompt, /Do not leave speculative routes to unwritten pages/);
  assert.match(prompt, /During init, account for every substantial system/);
});

test("absent and whitespace-only briefs/requests retain the public prompt defaults", () => {
  for (const wikiBrief of [null, "", " \n\t "]) {
    for (const mode of modes) {
      const prompt = createHarnessWikiTaskPrompt(mode, "/project", { lastUpdate: null, gitSummary: "(none)", wikiBrief }, " \n ");
      assert.match(prompt, /Persistent Wiki brief: none found at wiki\/INSTRUCTIONS.md/);
      assert.doesNotMatch(prompt, /Additional user instruction:/);
      if (mode === "chat") assert.ok(prompt.endsWith("Start a wiki chat."));
      if (mode === "update") assert.match(prompt, /No previous Harness Wiki update metadata was found/);
    }
  }
});

test("the reusable bootstrap stays compact and matches both checked-in agent Wiki sections", () => {
  const bootstrap = createHarnessWikiAgentInstructions();
  assert.ok(bootstrap.length < 1500);
  assert.match(bootstrap, /task -> system -> page\/heading/);
  assert.match(bootstrap, /read\(offset, limit\)/);
  assert.match(bootstrap, /not every domain's rules/);
  assert.match(bootstrap, /approved Harness proposal and apply workflow/);
  assert.doesNotMatch(bootstrap, /Per-topic quality contract|Module Federation|coverage plan/);
  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    const content = readFileSync(new URL(`../../../../${filename}`, import.meta.url), "utf8");
    const marker = "## Harness Wiki\n";
    assert.equal(content.split(marker).length - 1, 1, `${filename} must not duplicate the Wiki block`);
    const block = content.slice(content.indexOf(marker)).split(/\n## /, 1)[0].trim();
    assert.equal(block, bootstrap, `${filename} must match the generated navigation contract`);
  }
});
