# Operations, documentation, and release rules

Apply these rules when editing README files, AGENTS.md, CLAUDE.md, `docs/**`, `wiki/operations/**`, manifests, lockfiles, tests, CI, or release workflows.

## OPS-DOCS-001 — Keep documentation contracts consistent

When command names, package paths, ownership, or runtime behavior changes, update canonical README/Wiki references. Write Vietnamese user-facing project documentation clearly and update `docs/README.md` when adding or removing indexed files.

## OPS-WIKI-001 — Keep Wiki metadata accurate

Wiki snapshots include normal `wiki/**/*.md` pages and `wiki/**/_rules.md`, but exclude `wiki/INSTRUCTIONS.md`, `wiki/_plan.md`, hidden/temp files, and `wiki/.last-update.json`. The extension, not the documentation agent, owns `.last-update.json` finalization.

## OPS-AGENT-001 — Keep agent bootstrap conditional and compact

Top-level AGENTS.md and CLAUDE.md must tell agents to read `wiki/quickstart.md` once only for project-related requests, and to load applicable `_rules.md` files only before editing governed components. Do not require rules for read-only questions or unrelated work.

## OPS-TEST-001 — Use the focused verification loop

For Wiki changes, run `npm --prefix packages/pi-learn-extensions run test:wiki`. For extension/theme changes, run focused checks, then restart Pi or use `/reload` and manually verify the affected command or UI.

## OPS-GIT-001 — Inspect the diff and protect private artifacts

Before completion, inspect `git status` and the relevant diff. Do not commit auth data, `.env`, `.pi/logs/llm-payloads/**`, raw session logs, or private keys. Do not auto-push. Keep root and extension package versions synchronized when intentionally bumping a release.
