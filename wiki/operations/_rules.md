# Operations, documentation, and release rules

Apply these reviewed prompt rules when working with:

- `README.md`
- `AGENTS.md`
- `docs/**`
- `wiki/operations/**`
- root/package manifests and lockfiles
- release, test, CI, and repository workflow files

## OPS-DOCS-001 — Keep documentation contracts consistent

When command names, package paths, ownership, or runtime behavior changes, update the canonical README/wiki/spec references that describe that contract.

Write Vietnamese user-facing project documentation clearly and update `docs/README.md` when adding files under `docs/`.

## OPS-WIKI-001 — Keep documentation metadata accurate

Harness Wiki documentation snapshots include normal `wiki/**/*.md` pages but exclude `wiki/**/_rules.md`, `wiki/_plan.md`, hidden/temp files, and `wiki/.last-update.json`.

A prompt-rule-only change may trigger documentation review, but must not update `.last-update.json` unless normal Wiki documentation changed.

## OPS-TEST-001 — Use the repository verification loop

For Harness runtime changes, run `npm --prefix packages/harness-runtime test`.

For extension changes, run targeted static/tests where available, then restart Pi or run `/reload` and manually verify the affected command surface.

## OPS-GIT-001 — Inspect the diff and protect private artifacts

Before completion, inspect `git status` and the relevant diff. Do not commit auth data, `.env`, `.pi/logs/llm-payloads/**`, raw session logs, or private Harness outputs.

Do not auto-push. Keep root and extension package versions synchronized when intentionally bumping a release version.
