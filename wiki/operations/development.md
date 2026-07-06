# Development operations

This page summarizes the practical workflows for installing, changing, documenting, and releasing this repository.

## Install/test the Pi package

From the root README, the recommended install source is the GitHub repository on `main`:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Project-local install:

```bash
pi install -l git:github.com/vanhiep99w/pi-learn@main
```

Temporary test without writing settings:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@main
```

After changing extension or theme code, restart Pi or run:

```txt
/reload
```

Source references: `README.md`, `packages/pi-learn-extensions/README.md`, `AGENTS.md`.

## Package manifests and versioning

There are two package manifests that matter for Pi package distribution:

- `package.json` at the repository root
- `packages/pi-learn-extensions/package.json`

Both currently expose extensions and themes to Pi. Both also carry version `1.0.1` during this inspection. If bumping versions for a release, keep these versions synchronized when the package-level behavior changes.

The harness runtime has its own private package manifest at `packages/harness-runtime/package.json` with version `0.0.1`. Do not assume it is published independently; the harness extension resolves it from the repository package layout.

## Release/update workflow

The README documents two common distribution flows:

- Users installed from `@main` can update with:

  ```bash
  pi update
  ```

- Stable releases can be tagged in git, for example:

  ```bash
  git tag v1.0.2
  git push origin v1.0.2
  ```

Before tagging, verify the README examples, package versions, extension commands, and theme name still match source.

## Documentation workflow

This repository has several documentation layers:

- `README.md` — user-facing package overview and install guide.
- `packages/pi-learn-extensions/README.md` — detailed extension/theme command reference.
- `packages/harness-runtime/README.md` — harness runtime API and safety summary.
- `docs/` — Vietnamese Pi docs, indexed by `docs/README.md`.
- `pi-harness/` — harness design and roadmap material.
- `wiki/` — synthesized repository wiki for humans and future agents.

When adding or changing docs:

- Write Vietnamese for `docs/` unless the surrounding file uses another language.
- Update `docs/README.md` if adding a new `docs/*.md` page.
- Avoid duplicating whole existing docs in the wiki; link to them and summarize the repository-specific implications.
- Keep generated wiki pages concise and source-referenced.

The wiki extension itself is documented in [Wiki extension](../extensions/wiki-extension.md).

## Working with extension code

General rules:

- Use TypeScript/ESM style consistent with nearby extension files.
- Keep Pi imports in the current `@earendil-works/*` namespace unless you have verified compatibility with a different Pi version.
- Register tools with accurate descriptions, prompt snippets/guidelines, and TypeBox parameter schemas.
- Register commands with concise descriptions and robust UI/no-UI behavior.
- Guard UI-heavy work with `ctx.hasUI` and use optional chaining or try/catch for transient UI cleanup.
- Clean up timers, compositor state, and listeners on `session_shutdown` or component disposal.

Where to change common features:

| Feature | Files |
|---|---|
| Web search/fetch/tool discovery | `packages/pi-learn-extensions/extensions/web-tools/**` |
| ChatGPT usage UI and account commands | `packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts` |
| Prompt commands/model switching | `packages/pi-learn-extensions/extensions/prompt-with-model.ts` |
| Aurora TUI/editor/footer | `packages/pi-learn-extensions/extensions/aurora-ui.ts`, `fixed-input-layout/**` |
| Wiki commands and prompt rules | `packages/pi-learn-extensions/extensions/wiki/**` |
| Harness command surface | `packages/pi-learn-extensions/extensions/harness/index.ts` |
| Harness core behavior | `packages/harness-runtime/src/**` |

## Local-only files

`.pi/extensions/log-llm-payload.ts` is documented by `AGENTS.md` as a local/dev-only extension that writes request payloads under `.pi/logs/llm-payloads/`. Those logs may contain sensitive prompts, context, file paths, or metadata.

Do not read, commit, or summarize payload logs unless the user explicitly asks and the task requires it. Public package behavior should normally be implemented under `packages/pi-learn-extensions/`, not under `.pi/extensions/`.
