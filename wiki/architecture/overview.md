# Architecture overview

Pi Learn has two main roles:

1. It is a **Pi package** that exposes extensions and a theme to Pi Coding Agent.
2. It is a **learning/documentation repository** for Pi usage and extension development, especially in Vietnamese.

The root package is not a conventional application server or web app. There is no database schema, HTTP routing layer, or frontend build pipeline in the inspected source. The runtime behavior is driven by Pi loading extension entrypoints from package manifests.

## Package boundaries

### Root package

`package.json` is the package Pi users install from Git/GitHub. Its `pi` block points Pi to the public extension and theme directories:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

It is ESM (`"type": "module"`) and declares optional Pi peer dependencies in the current `@earendil-works/*` namespace plus `@sinclair/typebox` as a dependency. Source references: `package.json`, extension imports such as `packages/pi-learn-extensions/extensions/web-tools/index.ts`.

### Public extension/theme package

`packages/pi-learn-extensions/package.json` mirrors the Pi manifest at package level:

```json
{
  "pi": {
    "extensions": ["./extensions"],
    "themes": ["./themes"]
  },
  "files": ["extensions", "themes", "README.md"]
}
```

This package is the source of truth for public Pi extensions and themes. The README describes user-facing commands and installation examples. Source references: `packages/pi-learn-extensions/package.json`, `packages/pi-learn-extensions/README.md`.

### Harness runtime package

`packages/harness-runtime/` is a private Node ESM package exported as `@pi-learn/harness-runtime` from `src/api.js`. The Pi harness extension delegates to this runtime instead of maintaining a separate CLI process. Source references: `packages/harness-runtime/package.json`, `packages/harness-runtime/README.md`, `packages/pi-learn-extensions/extensions/harness/index.ts`.

### Documentation areas

- `docs/` contains Vietnamese Pi documentation, indexed by `docs/README.md`.
- `PI_DOCUMENTATION.md` is a long root-level Pi document.
- `pi-harness/` contains harness-specific design, roadmap, and session-format notes.
- `wiki/` contains this synthesized, change-oriented repository wiki.

## Runtime loading model

Pi loads extension entrypoints from the directories listed in the manifest. Each extension exports a default function accepting the Pi extension API and then registers tools, slash commands, event handlers, UI customizations, or shortcuts.

Representative patterns:

- `web-tools/index.ts` imports and calls `registerWebSearch`, `registerWebFetch`, and `registerToolSearch`, then shows a startup notification.
- `harness/index.ts` registers one tool (`harness_import_llm_reflection`) plus many `/harness-*` commands that call the runtime API.
- `wiki/index.ts` registers `/wiki-init`, `/wiki-update`, `/wiki-ask`, and `/wiki-status`, sends prompt text into the current Pi session, then writes metadata after `agent_end` if wiki content changed.
- `aurora-ui.ts` registers event handlers, a custom editor/footer, working messages, `/aurora-themes`, and `ctrl+shift+t`.

## Source-of-truth rules

When changing behavior, use these boundaries:

| Change type | Primary files |
|---|---|
| Public extension behavior | `packages/pi-learn-extensions/extensions/**` |
| Public theme tokens | `packages/pi-learn-extensions/themes/midnight-aurora.json` |
| Harness core logic | `packages/harness-runtime/src/**` |
| Harness Pi command surface | `packages/pi-learn-extensions/extensions/harness/index.ts` |
| Wiki/OpenWiki command behavior | `packages/pi-learn-extensions/extensions/wiki/index.ts` and `prompt.ts` |
| Vietnamese Pi reference docs | `docs/**` and `docs/README.md` |
| User install/package docs | `README.md`, `packages/pi-learn-extensions/README.md` |

`.pi/extensions/log-llm-payload.ts` is local/dev-only and writes payload logs under `.pi/logs/llm-payloads/`. Those logs can contain sensitive prompt/context data and are not part of the public package contract.

## Git history context

Recent history shows two major streams:

- The OpenWiki-derived extension was added as a Pi-native implementation and then renamed from `openwiki` commands/paths to `wiki` commands/paths. Evidence: recent commits `d61a063 Add Pi-native OpenWiki extension` and `204d927 Rename OpenWiki extension commands to wiki`, plus the files now located under `packages/pi-learn-extensions/extensions/wiki/`.
- The harness moved from a CLI-style runtime toward an extension-driven runtime API with proposal lifecycle, reflection, eval, and automation. Evidence: recent commits listed for `packages/harness-runtime/src/api.js`, `packages/pi-learn-extensions/extensions/harness/index.ts`, and `packages/harness-runtime/README.md`.

Do not overfit future documentation to commit hashes; prefer current source unless a historical rename or migration explains current design.

## Known documentation caveat

`AGENTS.md` contains one stale-looking line claiming current Pi peer dependencies use `@mariozechner/*`. Current package manifests and inspected extension imports use `@earendil-works/*`. Prefer the current source/manifests when changing imports, and update stale docs only when the user asks or when you are already editing the relevant documentation.
