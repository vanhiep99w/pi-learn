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
- `wiki-prompt-rules.test.js`

Source references: `packages/harness-runtime/package.json`, `packages/harness-runtime/tests/`.

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

- Web tools: call `web_search`, then `web_fetch` on a result; test DuckDuckGo fallback when Tavily is not configured if relevant.
- Prompt templates: create or edit a small test prompt under `.pi/agent/model-prompts/`, `/reload`, then run the generated command.
- Aurora UI: verify startup banner, editor border, footer/status rendering, theme switching, and terminal cleanup after session shutdown.
- Harness Wiki: run `/harness-wiki-status`, `/harness-wiki-ask`, a no-op `/harness-wiki-update`, and a small forced update when changing Wiki behavior. Confirm `/wiki-*` commands are absent and Wiki turns cannot edit `_rules.md`.
- Harness: run `/harness-status`, `/harness-report`, and targeted `/harness-eval` after runtime changes.

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
