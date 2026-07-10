# Global Harness rules

These reviewed prompt rules apply to every repository task.

Before modifying files:

1. Read `wiki/quickstart.md`.
2. Read this file.
3. Identify every source/documentation domain touched by the task.
4. Read each applicable section `_rules.md` before editing.
5. Re-read applicable rules when the task scope changes or after compaction.

If two applicable rules conflict, stop and report the conflict instead of choosing one silently.

Relevant section rules:

- Harness runtime and design: `wiki/architecture/_rules.md`
- Pi extensions and themes: `wiki/extensions/_rules.md`
- Tests, docs, releases and repository operations: `wiki/operations/_rules.md`

## GLOBAL-EDIT-001 — Inspect before exact-text edits

Read the current target block immediately before applying an exact-text edit.

Requirements:

- Confirm `oldText` exactly matches current whitespace and punctuation.
- Confirm the match is unique.
- Combine adjacent changes into one edit block.
- Inspect the resulting diff before considering the change complete.

## GLOBAL-RULE-001 — Protect reviewed prompt rules

Do not create, edit, move, or delete `wiki/**/_rules.md` during a normal coding or Harness Wiki documentation turn.

Prompt-rule changes must go through normalized evidence, a Harness proposal, user approval, controlled apply, lint, and relevant tests/evals. Deterministic empty scaffolds created by Harness Wiki are the only bootstrap exception.

## GLOBAL-SECRET-001 — Keep private evidence out of the repository

Do not read, commit, quote, or share secret-bearing files, Pi auth stores, `.env` files, `.pi/logs/llm-payloads/**`, raw session logs, or private Harness evidence unless the user explicitly authorizes that exact access.

Committed prompt rules may reference an approved proposal ID, but must not contain private evidence excerpts or absolute private storage paths.
