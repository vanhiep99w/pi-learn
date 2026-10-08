# Global Wiki rules

These prompt rules apply only when editing repository components they govern. Read `wiki/quickstart.md` first only when the current request is about this project and quickstart is not already present in context. Do not load rules for read-only questions or unrelated work.

If applicable rules conflict, stop and report the conflict instead of choosing silently.

Relevant domain rules:

- Package boundaries and architecture: `wiki/architecture/_rules.md`
- Pi extensions and themes: `wiki/extensions/_rules.md`
- Tests, docs, releases, and repository operations: `wiki/operations/_rules.md`

## GLOBAL-EDIT-001 — Inspect before exact-text edits

Read the current target block immediately before an exact-text edit. Confirm the match is unique, combine adjacent changes, and inspect the resulting diff.

## GLOBAL-RULE-001 — Change rules only through explicit Wiki update

The Wiki extension may create deterministic empty `_rules.md` scaffolds for missing final sections. Substantive creation, edits, moves, or deletion of `wiki/**/_rules.md` are allowed only when `/wiki-update` explicitly requests rule changes. Preserve unrelated rules and validate the final root/section rule layout.

Outside scaffolding and that explicitly opted-in mode, treat `_rules.md` as protected.

## GLOBAL-SECRET-001 — Keep private data out of the repository

Do not read, commit, quote, or share secret-bearing files, Pi auth stores, `.env` files, `.pi/logs/llm-payloads/**`, raw session logs, private keys, or token-bearing files unless the user explicitly authorizes that exact access.
