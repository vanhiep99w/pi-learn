# Pi extension and theme rules

Apply these reviewed prompt rules when working with:

- `packages/pi-learn-extensions/extensions/**`
- `packages/pi-learn-extensions/themes/**`
- `packages/pi-learn-extensions/package.json`
- Extension documentation under `wiki/extensions/`

## EXT-UI-001 — Guard interactive UI operations

Guard dialogs, editors, selectors, notifications, status updates, widgets, and other UI work with `ctx.hasUI` and optional UI access where appropriate.

Provide a console/text fallback in print or JSON mode when the command should still produce output.

## EXT-LIFECYCLE-001 — Clean up session-scoped state

Clear timers, listeners, compositor state, pending runs, and extension status during `session_shutdown` or replacement flows.

Do not reuse captured session-bound `ctx`, `pi`, UI, or `SessionManager` objects after a session replacement.

## EXT-CMD-001 — Use the Harness Wiki namespace

Public Harness Wiki commands must be:

```txt
/harness-wiki-init
/harness-wiki-update
/harness-wiki-ask
/harness-wiki-status
```

Do not register `/wiki-*` compatibility aliases. Keep command help, startup text, README examples, tests, and autocomplete expectations aligned.

## EXT-PACKAGE-001 — Keep one public Harness entrypoint

Harness Wiki is a module of `packages/pi-learn-extensions/extensions/harness/index.ts`, not a second public Pi extension entrypoint.

Public package source belongs under `packages/pi-learn-extensions/`; `.pi/extensions/` remains local/dev-only unless explicitly requested otherwise.
