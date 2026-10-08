# Extensions and theme catalog

This page summarizes the public resources under `packages/pi-learn-extensions/`, their ownership, and focused verification.

## Wiki

Source: `packages/pi-learn-extensions/extensions/wiki/`

The Wiki extension uses the current Pi model and tools to create or update repository knowledge:

```txt
/wiki [extra instructions]
/wiki-update [extra instructions]
```

`index.ts` is the entrypoint. `wiki-commands.ts` owns command registration, Git context, snapshots, no-op detection, protected files, final validation, and metadata. `wiki-prompt.ts` owns the documentation/update contract and generated AGENTS/CLAUDE block. JavaScript helpers own rule lint/scaffolds and internal link validation.

Rule mutation is opt-in: `/wiki-update` allows `_rules.md` edits only when its message explicitly requests `_rules.md`, Wiki/prompt rules, or rule files. Other runs block those mutations. See [Wiki capability](wiki-extension.md).

Focused test:

```bash
npm --prefix packages/pi-learn-extensions run test:wiki
```

## ChatGPT usage status

Source: `packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts`

The extension shows ChatGPT Plus/Pro usage only when the active provider is `openai-codex` or `chatgpt`.

```txt
/chatgpt-login
/chatgpt-usage
/chatgpt-usage-refresh
/chatgpt-accounts
/chatgpt-switch
/chatgpt-delete
/chatgpt-logout
```

It listens to session/model/agent lifecycle events, caches usage briefly, and stores account/auth data in local Pi-related files rather than the repository.

When changing it:

- Do not inspect, log, or document live tokens.
- Keep provider gating strict.
- Preserve cleanup of timers, status, and widgets on shutdown.
- Verify login/account selection and usage rendering in a disposable local setup.

## Aurora UI

Source: `packages/pi-learn-extensions/extensions/aurora-ui.ts`

Aurora customizes interactive Pi with a startup banner, horizontal-only editor border, minimal footer, Vietnamese working messages, cwd/Git information, `/aurora-themes`, and `ctrl+shift+t`.

When changing it:

- Guard interactive operations with `ctx.hasUI`.
- Prefer theme tokens over raw ANSI colors.
- Dispose timers, compositor state, and callbacks during shutdown or replacement.
- Test in an interactive terminal after `/reload`; print/JSON modes must not fail because UI is absent.

## Midnight Aurora theme

Source: `packages/pi-learn-extensions/themes/midnight-aurora.json`

The `midnight-aurora` theme defines dark surfaces, aurora accent colors, state colors, and user panel mappings. Keep the public name stable unless settings examples and docs are intentionally migrated.

## External web search

Pi Learn does not package web-search tools. Users can install `pi-web-access` separately; do not document it as a bundled entrypoint.
