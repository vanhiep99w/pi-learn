# Development operations

This page covers installation, package maintenance, documentation, and release workflows.

## Install and reload

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
pi install -l git:github.com/vanhiep99w/pi-learn@main
pi -e git:github.com/vanhiep99w/pi-learn@main
```

After extension or theme changes, restart Pi or run `/reload`.

## Package manifests and versions

Two manifests expose the same resources:

- root `package.json` points to `packages/pi-learn-extensions/extensions` and `themes`;
- `packages/pi-learn-extensions/package.json` points to its local `extensions` and `themes`.

Both currently use version `1.0.1`. Keep versions synchronized when intentionally cutting a package release. Keep host-provided Pi libraries in `peerDependencies`, not bundled runtime dependencies.

## Public source map

| Feature | Source |
|---|---|
| Wiki commands and lifecycle | `packages/pi-learn-extensions/extensions/wiki/wiki-commands.ts` |
| Wiki task/bootstrap prompt | `packages/pi-learn-extensions/extensions/wiki/wiki-prompt.ts` |
| Wiki rule/link helpers | `packages/pi-learn-extensions/extensions/wiki/wiki-rules.js`, `wiki-links.js` |
| ChatGPT usage | `packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts` |
| Aurora UI | `packages/pi-learn-extensions/extensions/aurora-ui.ts` |
| Theme | `packages/pi-learn-extensions/themes/midnight-aurora.json` |

Use TypeScript/ESM style consistent with nearby extension code. Keep UI work guarded, provide non-TUI fallback where the command should still report output, and clean up session state.

## Documentation workflow

Documentation layers are:

- root `README.md` — install and public capability overview;
- package README — extension/theme details;
- `docs/` — Vietnamese Pi learning/reference material;
- `PI_DOCUMENTATION.md` — long root reference;
- `wiki/` — repository-specific architecture/change routing.

When changing docs:

- update `docs/README.md` when indexed files are added or removed;
- keep README command names and package paths aligned with source;
- use the Wiki as synthesis/navigation rather than duplicating complete docs;
- keep quickstart lightweight and route detail to canonical pages;
- change `_rules.md` through an explicitly requested `/wiki-update` rule run.

## Release/update workflow

Users installed from `@main` can run `pi update`. Before a tag:

1. Run focused tests.
2. Confirm both package versions and manifests.
3. Confirm README commands and theme name match source.
4. Reload Pi and manually test changed commands/UI.
5. Inspect `git status` and diff for stale files or private data.
6. Tag/push only when explicitly requested.

## Local-only files

`.pi/` is development/local state, not public package source. Payload logs under `.pi/logs/llm-payloads/` may contain sensitive prompts or context and must not be read or committed without exact authorization.
