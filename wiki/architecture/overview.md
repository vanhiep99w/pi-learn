# Architecture overview

This page explains Pi Learn's package boundaries and runtime-loading model. Read it when changing manifests, extension entrypoints, theme exposure, or repository documentation ownership.

## Package boundaries

### Root package

The root `package.json` is the install target. Its Pi manifest exposes:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

Pi supplies the `@earendil-works/*` host packages declared as peers. The root has no application server, database, or frontend build pipeline.

### Public extension and theme package

`packages/pi-learn-extensions/` is the source of truth for executable package behavior. Its own manifest exposes `./extensions` and `./themes` and includes source, tests, themes, and its README in package files.

Current public entrypoints are:

- `extensions/wiki/index.ts`
- `extensions/chatgpt-usage-status/index.ts`
- `extensions/aurora-ui.ts`

The bundled theme is `themes/midnight-aurora.json`.

### Documentation areas

- `README.md` and `packages/pi-learn-extensions/README.md` describe installation and public commands.
- `docs/` contains Vietnamese Pi learning/reference material, indexed by `docs/README.md`.
- `PI_DOCUMENTATION.md` is a root-level long-form reference.
- `wiki/` is the repository-specific routing and change guide.
- `wiki/INSTRUCTIONS.md` is a user-owned brief consumed by `/wiki` and `/wiki-update`.

## Runtime loading model

Pi scans direct `.ts`/`.js` files and subdirectories containing `index.ts`/`index.js` from the manifest's extension directory.

- `wiki/index.ts` registers only `/wiki` and `/wiki-update` through `wiki-commands.ts`.
- `wiki/wiki-prompt.ts` builds the documentation task and compact AGENTS/CLAUDE bootstrap.
- `wiki/wiki-rules.js` owns rule path classification, scaffolding, and lint.
- `wiki/wiki-links.js` validates relative links and heading anchors.
- `chatgpt-usage-status/index.ts` manages provider-gated usage display and account commands.
- `aurora-ui.ts` owns editor/footer/status customization and theme selection.

Extension code runs in the Pi process with the user's OS permissions. UI work must remain guarded and session-scoped resources must be cleaned up.

## Reduced supported surface

The repository intentionally excludes previously bundled session-observability/proposal/eval/apply behavior, image generation, and model-aware prompt management. Their source packages, tests, commands, and design docs are removed. Reintroduction is a new product decision, not an implicit compatibility requirement.

## Source-of-truth table

| Change | Primary source |
|---|---|
| Package resource exposure | `package.json`, `packages/pi-learn-extensions/package.json` |
| Wiki command/lifecycle behavior | `packages/pi-learn-extensions/extensions/wiki/wiki-commands.ts` |
| Wiki generation/update instructions | `packages/pi-learn-extensions/extensions/wiki/wiki-prompt.ts` |
| Rule discovery and link validation | `packages/pi-learn-extensions/extensions/wiki/wiki-rules.js`, `wiki-links.js` |
| ChatGPT usage | `packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts` |
| Aurora TUI | `packages/pi-learn-extensions/extensions/aurora-ui.ts` |
| Theme tokens | `packages/pi-learn-extensions/themes/midnight-aurora.json` |
| Reviewed component guidance | `wiki/**/_rules.md` |
| User-facing package docs | root and package READMEs |

## Local-only boundary

`.pi/` contains local/development resources and may contain sensitive payload logs. It is not public package source. Public changes belong under `packages/pi-learn-extensions/` unless the user explicitly requests local-only behavior.
