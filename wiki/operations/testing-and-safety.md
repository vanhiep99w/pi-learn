# Testing and safety

This repository has a mixed verification story: extension code is usually verified in Pi itself, while the harness runtime has a Node test suite. Use targeted checks instead of assuming a root build/test script exists.

## Test commands

The root `package.json` does not define a root `test` script. The harness runtime package does:

```bash
cd packages/harness-runtime
npm test
```

This runs `node --test` over `packages/harness-runtime/tests/*.test.js`.

Representative test files include:

- `analysis-run.test.js`
- `api.test.js`
- `config.test.js`
- `discover-sessions.test.js`
- `parse-tree.test.js`
- `redaction.test.js`
- `proposal-lifecycle.test.js`
- `proposal-writer.test.js`
- `reflection.test.js`
- `rules.test.js`
- `eval-harness.test.js`
- `wiki-links.test.js`
- `wiki-prompt-rules.test.js`

For the new frozen-run and Wiki-link boundaries, a narrow root-level check is:

```bash
node --test packages/harness-runtime/tests/analysis-run.test.js packages/harness-runtime/tests/wiki-links.test.js
```

Use the full package suite before integrating a cross-cutting Harness runtime or Wiki orchestration change.

Harness Wiki prompt changes have a separate extension-level suite. From the repository root with Node native TypeScript stripping (22.18+):

```bash
npm --prefix packages/pi-learn-extensions run test:harness-wiki
```

`packages/pi-learn-extensions/tests/harness/wiki-prompt.test.mts` renders init/update/chat prompts and checks selective reading, topic depth, service/MFE boundaries, explicit deepening, safety, and the shared agent bootstrap. It also budgets the fixed question prompt without counting arbitrary user brief/request content. These tests verify instructions and regressions, not whether an LLM follows them or writes accurate, complete prose.

Source references: `packages/harness-runtime/package.json`, `packages/harness-runtime/tests/`, `packages/pi-learn-extensions/package.json`, `packages/pi-learn-extensions/tests/harness/wiki-prompt.test.mts`.

## Harness eval scenarios

The runtime also has deterministic eval scenarios exposed through `/harness-eval` and implemented in `packages/harness-runtime/src/eval/eval-harness.js`:

```txt
redaction-fixture
parser-unknown-entry
edit-oldText-workflow
file-protection
smart-commit-basic
ts-extension-safety
wiki-prompt-rule-file-protection
wiki-prompt-rule-section-routing
wiki-prompt-rule-lazy-loading
harness-wiki-command-surface
```

These scenarios validate safety and workflow behaviors that are easy to regress: secret redaction, parser resilience, prompt-rule routing/loading/protection, file target protection, controlled apply, and the merged command surface.

When changing harness logic, run both Node tests and the relevant `/harness-eval` scenario from Pi if possible.

## Manual Pi verification

For extension/theme changes, normal verification is interactive:

1. Make the code change.
2. Run any targeted static/test check available for the changed area.
3. Restart Pi or run `/reload`.
4. Exercise the specific command/tool/UI path.

Examples:

- External web search: if `pi-web-access` is installed, verify its `web_search` tool; it is not shipped by Pi Learn.
- Prompt templates: create or edit a small test prompt under `.pi/agent/model-prompts/`, `/reload`, then run the generated command.
- Aurora UI: verify startup banner, editor border, footer/status rendering, theme switching, and terminal cleanup after session shutdown.
- Harness Wiki: run `/harness-wiki-ask`, a no-op `/harness-wiki-update`, and a small forced update when changing Wiki behavior. Confirm `/wiki-*` and `/harness-wiki-status` are absent and Wiki turns cannot edit `_rules.md`.
- Harness: run `/harness`, exercise dashboard scrolling/Markdown rendering, and run targeted `/harness-eval` after runtime changes.

## Harness Wiki content and navigation acceptance

Use disposable checkouts with the same source revision, model, instructions, and comparable generation budget when comparing Harness with OpenWiki. Reload the changed extension before exercising it. Cover a small single-system repo, a multi-service repo, and a shell/remote microfrontend repo; do not assume a passing prompt suite establishes output parity.

| Scenario | Content evidence to inspect | Expected retrieval behavior |
|---|---|---|
| Initialize a small repo | Mechanisms, important failures, source anchors, and focused tests; no artificial service taxonomy or quota-driven padding | Quickstart routes to the few real topics without repeating their bodies. |
| Change a service-local behavior or MFE style | Owning entrypoint, local state/behavior, relevant dependencies and tests | Read owning sections and applicable rules; unrelated services/remotes are not preloaded. |
| Change an API/event schema or shared package | Producer, known consumers, compatibility constraints, failure behavior and contract tests | Expand across affected boundaries even when only one source file changed; unknown consumers are identified, not guessed away. |
| Diagnose remote loading or auth propagation | Evidenced host/remote lifecycle, shared state, fallback and deployment/version constraints | Read the relevant workflow/contract and participant sections, not every frontend page. |
| Explicitly deepen unchanged documentation | Existing accurate prose preserved; material gaps filled with source/tests | The request can schedule work without source changes; no unrelated formatting churn. |
| Ask what the Wiki says | Answer cites the selected page/heading, preserves qualifiers, and discloses missing/stale evidence | Use bounded grep and section reads; continue a truncated relevant section, then stop once grounded. Ordinary questions do not create plans or edit files. |

Review generated text against source/tests, not page count or word count. Evaluate coverage, factual accuracy, mechanism/failure depth, and route usefulness separately from how much context was read. Observe only the test run's tool activity with appropriate authorization; do not mine private payload/session logs for this check. Record unresolved evidence gaps and distinguish a content defect from an unnecessary-read defect.

The [Wiki capability](../extensions/wiki-extension.md#selective-reading) describes the prompt contract. Semantic completeness and selective stopping remain model behavior, while existing link checks validate only their documented structural boundary.

## Security and privacy rules

Do not read or document live secrets, credentials, private keys, tokens, `.env` files, auth files, or payload logs. Specific sensitive locations called out by source/docs include:

```txt
.env and .env.* live config
.pi/logs/llm-payloads/
.pi/agent/auth.json
.pi/agent/chatgpt-usage-accounts.json
~/.pi/agent/auth.json
~/.pi/agent/chatgpt-usage-accounts.json
~/.pi/agent/sessions/ raw session logs
private keys such as *.pem, *.key, id_rsa, id_ed25519
```

`.env.example` or other sample config can be read only when it contains placeholders rather than live values.

Source references: `AGENTS.md`, `packages/harness-runtime/src/safety/redaction.js`, `packages/harness-runtime/README.md`.

## Redaction model

`packages/harness-runtime/src/safety/redaction.js` redacts:

- OpenAI-like keys (`sk-...`)
- GitHub PAT/token patterns
- Tavily keys (`tvly-...`)
- bearer authorization headers
- secret/token/password/key assignments
- sensitive YAML assignments
- long opaque tokens
- object keys matching token/secret/password/authorization/api-key/cookie patterns

It also marks sensitive paths, including `.env`, private key files, Pi auth/account files, Pi session logs, and local LLM payload logs.

When expanding harness evidence collection, update redaction tests first or in the same change.

## Controlled apply safety

Harness proposal apply is intentionally conservative. `packages/harness-runtime/src/proposals/lifecycle.js` requires:

- proposal status `approved`
- a machine-applicable JSON `## Patch` section
- patch paths listed in the proposal target files
- a git repository
- a clean worktree unless `allowDirty` is explicitly allowed
- a proposal branch named `harness/<proposal-id>`
- proposal history entries for lifecycle changes

Rollback either reverts the recorded commit or checks out recorded changed paths, while refusing rollback if unrelated files are dirty.

Tests and eval scenarios cover this behavior (`proposal-lifecycle.test.js`, `file-protection`, `smart-commit-basic`). Preserve these guarantees unless a user explicitly requests a different safety policy.

## Git hygiene

Before finalizing changes, use:

```bash
git status --short --untracked-files=all
git diff -- <paths-you-changed>
```

Do not commit generated private harness outputs, payload logs, auth stores, or `node_modules/`. The current `.gitignore` ignores `.pi/teams` and `node_modules/`, but sensitive generated paths may still need care in local workflows.
