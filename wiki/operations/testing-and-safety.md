# Testing and safety

This page defines focused checks and privacy boundaries for the reduced Pi Learn package.

## Automated tests

The root package has no root test script. Wiki behavior is tested from the extension package:

```bash
npm --prefix packages/pi-learn-extensions run test:wiki
```

The suite includes:

- prompt and command-surface contracts;
- conditional quickstart/rule-loading bootstrap alignment;
- explicit rule-update request detection;
- rule path classification, scaffolding, lint, and symlink safety;
- internal Wiki links, anchors, traversal rejection, and symlink rejection;
- validation of the checked-in Wiki.

Tests validate deterministic boundaries and prompt text, not whether every model-generated page is semantically complete.

## Manual Pi verification

After source changes:

1. Run focused automated tests.
2. Run `/reload` or restart Pi.
3. Exercise the affected surface.

### Wiki scenarios

| Scenario | Expected result |
|---|---|
| `/wiki` in a disposable repository | Creates a routed Wiki and compact Project Wiki bootstrap; does not edit rules beyond deterministic missing scaffolds. |
| `/wiki-update` with no changes | Skips when metadata, links, rules, Git head, and worktree allow a no-op. |
| `/wiki-update Refresh changed extension docs` | Updates affected docs only; `_rules.md` remains protected. |
| `/wiki-update Update wiki/**/_rules.md for new commands` | Enables rule edits, preserves unrelated rules, validates the final layout, and records metadata. |
| Invalid internal link | Reports source/line and records interrupted status after a changed run. |
| Invalid final rule layout | Reports lint details and records interrupted status. |
| Ordinary project question | Reads quickstart only when not already in context; does not require rules unless an edit begins. |

Also confirm only `/wiki` and `/wiki-update` are registered.

### ChatGPT usage and Aurora

- Verify usage status appears only for supported ChatGPT providers.
- Never use real credential contents as test fixtures.
- Verify Aurora startup/editor/footer/theme selection in a TUI and confirm non-TUI modes do not fail.
- Verify timers/status/compositor state are cleaned up after shutdown or reload.

## Security and privacy

Do not read or document live secrets, credentials, private keys, tokens, `.env` files, auth files, payload logs, or raw session logs. Sensitive examples include:

```txt
.env and .env.* live config
.pi/logs/llm-payloads/
.pi/agent/auth.json
.pi/agent/chatgpt-usage-accounts.json
~/.pi/agent/auth.json
~/.pi/agent/chatgpt-usage-accounts.json
~/.pi/agent/sessions/
*.pem, *.key, id_rsa, id_ed25519
```

Sample files such as `.env.example` are readable only when they contain placeholders rather than live values.

## Wiki path safety

Rule and link helpers enforce repository-root boundaries and reject unsafe symlink/path escapes. During an active Wiki run:

- metadata is always extension-owned;
- `wiki/INSTRUCTIONS.md` is protected;
- `_rules.md` is protected unless `/wiki-update` explicitly opted into rule changes.

The rule opt-in changes authorization for rule files only; it does not weaken secret handling, repository boundaries, or final validation.

## Git hygiene

Before completion:

```bash
git status --short --untracked-files=all
git diff -- <changed paths>
```

Do not auto-push. Do not commit auth stores, `.env`, payload/session logs, private keys, generated temporary `wiki/_plan.md`, or unrelated local changes.
