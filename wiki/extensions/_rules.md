# Pi extension and theme rules

Apply these rules when editing:

- `packages/pi-learn-extensions/extensions/**`
- `packages/pi-learn-extensions/themes/**`
- `packages/pi-learn-extensions/package.json`
- Extension documentation under `wiki/extensions/`

## EXT-UI-001 — Guard interactive UI operations

Guard dialogs, editors, selectors, notifications, status updates, widgets, and other UI work with `ctx.hasUI` and optional UI access where appropriate. Provide a console/text fallback when a command should still produce output without a TUI.

## EXT-LIFECYCLE-001 — Clean up session-scoped state

Clear timers, listeners, compositor state, pending runs, and extension status during `session_shutdown` or replacement flows. Do not reuse captured session-bound contexts after replacement.

## EXT-WIKI-CMD-001 — Keep the Wiki command surface minimal

Public Wiki commands are exactly:

```txt
/wiki
/wiki-update
```

Do not register init, ask, status, compatibility aliases, or commands with the retired prefix. Keep source, tests, READMEs, and Wiki docs aligned.

## EXT-WIKI-RULE-001 — Require explicit rule-update opt-in

The extension may create deterministic empty scaffolds for missing rule sections. It may make substantive edits to `wiki/**/_rules.md` only when `/wiki-update` explicitly asks for `_rules.md`, Wiki rules, prompt rules, or rule files. Without that opt-in, block model-driven rule mutations. Always keep metadata and the active run's `wiki/INSTRUCTIONS.md` protected.

## EXT-PACKAGE-001 — Keep one Wiki entrypoint

Wiki source belongs under `packages/pi-learn-extensions/extensions/wiki/`, with `index.ts` as its only public entrypoint. Keep helper logic self-contained in that directory.
