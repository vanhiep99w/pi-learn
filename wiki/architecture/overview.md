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
- `harness/index.ts` is the single public Harness entrypoint. It registers `harness_import_llm_reflection`, observability/proposal commands, and the Harness Wiki module.
- `harness/wiki-commands.ts` registers `/harness-wiki-*`, sends concise task prompts into the current Pi session, protects reserved rule/metadata files, and finalizes scaffolds/metadata after `agent_settled`.
- `harness/wiki-prompt.ts` defines documentation-task discipline but does not inject all prompt rules. Pi auto-loads the `AGENTS.md` bootstrap and the model reads root/section `_rules.md` files lazily.
- `aurora-ui.ts` registers event handlers, a custom editor/footer, working messages, `/aurora-themes`, and `ctrl+shift+t`.

## Source-of-truth rules

When changing behavior, use these boundaries:

| Change type | Primary files |
|---|---|
| Public extension behavior | `packages/pi-learn-extensions/extensions/**` |
| Public theme tokens | `packages/pi-learn-extensions/themes/midnight-aurora.json` |
| Harness core logic | `packages/harness-runtime/src/**` |
| Harness Pi command surface | `packages/pi-learn-extensions/extensions/harness/index.ts` |
| Harness Wiki orchestration/prompt | `packages/pi-learn-extensions/extensions/harness/wiki-commands.ts`, `wiki-prompt.ts` |
| Reviewed project prompt guidance | `wiki/_rules.md`, `wiki/<section>/_rules.md` |
| Prompt-rule discovery/lint | `packages/harness-runtime/src/analysis/wiki-prompt-rules.js` |
| Vietnamese Pi reference docs | `docs/**` and `docs/README.md` |
| User install/package docs | `README.md`, `packages/pi-learn-extensions/README.md` |

`.pi/extensions/log-llm-payload.ts` is local/dev-only and writes payload logs under `.pi/logs/llm-payloads/`. Those logs can contain sensitive prompt/context data and are not part of the public package contract.

## Git history context

Recent history shows two major streams:

- The OpenWiki-derived workflow started as a separate Pi-native Wiki extension, then became the Harness Wiki capability with `/harness-wiki-*` commands and no compatibility aliases.
- Harness now combines extension-driven observability/proposal/eval behavior with Wiki knowledge. Reviewed project guidance uses domain-local `_rules.md`; deterministic detectors/defaults remain runtime code.

Do not overfit future documentation to commit hashes; prefer current source unless a historical rename or migration explains current design.

## Import compatibility note

Current package manifests and inspected public extension imports use `@earendil-works/*`. Keep the import style used by each extension and verify the installed Pi version before any namespace-wide migration.
