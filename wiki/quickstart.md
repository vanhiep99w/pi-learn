# Pi Learn quickstart

Pi Learn is a Pi Coding Agent package and learning repository. It publishes a set of Pi extensions, one theme, and Vietnamese Pi reference documentation. The package is installed from the repository root and Pi discovers the public extension/theme entrypoints through the root `package.json` `pi` manifest.

## What this repository contains

- **Pi package manifest** in `package.json`, exposing `./packages/pi-learn-extensions/extensions` and `./packages/pi-learn-extensions/themes`.
- **Public extension/theme package** in `packages/pi-learn-extensions/`, with its own `package.json`, README, extension sources, and `midnight-aurora` theme.
- **Harness runtime package** in `packages/harness-runtime/`, a private Node runtime used by the Pi harness extension for session reports, proposals, evals, and gated automation.
- **Vietnamese Pi docs** in `docs/`, indexed by `docs/README.md`.
- **Harness design notes** in `pi-harness/`, useful when changing the harness runtime or extension.
- **Persistent Wiki brief** in [`wiki/INSTRUCTIONS.md`](INSTRUCTIONS.md), containing user-owned documentation scope, priorities, language, and exclusions for Harness Wiki runs.
- **Local/dev-only Pi files** under `.pi/`; do not treat these as public package source. In particular, payload logs may contain sensitive prompts or context and should not be read unless explicitly requested.

Source references: `README.md`, `package.json`, `packages/pi-learn-extensions/package.json`, `packages/harness-runtime/package.json`, `docs/README.md`, `AGENTS.md`.

## Rule loading

Harness prompt rules are reviewed Markdown instructions stored beside each Wiki domain. They are not automatically injected into every Pi request.

Before modifying repository files:

1. Read [`wiki/_rules.md`](_rules.md) for global rules.
2. Determine every source/documentation domain touched by the task.
3. Read the corresponding section `_rules.md` files before editing.
4. If the task spans multiple domains, read all applicable rule files.
5. Re-read applicable rules when task scope changes or after compaction.

| Domain | Prompt-rule file |
|---|---|
| Global repository behavior | [`wiki/_rules.md`](_rules.md) |
| Harness runtime and architecture | [`wiki/architecture/_rules.md`](architecture/_rules.md) |
| Pi extensions and themes | [`wiki/extensions/_rules.md`](extensions/_rules.md) |
| Tests, docs, releases and operations | [`wiki/operations/_rules.md`](operations/_rules.md) |

Prompt rules enter model context when the model reads these files. Normal coding and Harness Wiki documentation turns must not modify `_rules.md`; changes go through the Harness proposal, approval, and controlled-apply lifecycle. Critical file protection remains deterministic runtime/extension behavior rather than relying only on prompt compliance.

`wiki/INSTRUCTIONS.md` is separate from reviewed prompt rules: users may edit this optional brief directly to steer documentation scope and priorities, while `_rules.md` and deterministic safety controls continue to take precedence.

## Install and run

Install the package from GitHub for all projects:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Install only for the current project:

```bash
pi install -l git:github.com/vanhiep99w/pi-learn@main
```

Try the package temporarily without writing settings:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@main
```

After installing or changing extension/theme code, restart Pi or run:

```txt
/reload
```

Enable the included theme by setting `theme` to `midnight-aurora` in Pi settings. See `README.md` and `packages/pi-learn-extensions/README.md` for full examples.

## Main user-facing capabilities

| Area | What it does | Start here |
|---|---|---|
| Image Gen (experimental) | Adds `image_gen` for subscription-backed image generation/reference edits with validated workspace output; paid fallback and transparency remain unavailable. | [Extensions catalog](extensions/catalog.md#image-gen-experimental) |
| Optional web search | Provided separately by [pi-web-access](https://github.com/nicobailon/pi-web-access); it is not part of Pi Learn. | [Extensions catalog](extensions/catalog.md#web-search-external) |
| ChatGPT usage | Shows ChatGPT Plus/Pro usage when the active provider is `openai-codex` or `chatgpt`. | [Extensions catalog](extensions/catalog.md#chatgpt-usage-status) |
| Prompt templates | Creates slash commands from Markdown prompts with optional model/thinking frontmatter. | [Extensions catalog](extensions/catalog.md#prompt-with-model) |
| Aurora UI/theme | Custom TUI editor/footer/status behavior plus the `midnight-aurora` theme. | [Extensions catalog](extensions/catalog.md#aurora-ui) |
| Harness Wiki | Pi-native `/harness-wiki-*` commands that generate/update `wiki/` documentation and use reviewed domain-local prompt rules. | [Harness Wiki capability](extensions/wiki-extension.md) |
| Harness | Mines normalized Pi session logs to create reports, reflection proposals, controlled prompt-rule updates, evals, and gated automation. | [Harness runtime](architecture/harness-runtime.md) |
| Vietnamese Pi docs | Learning/reference material for Pi itself. | `docs/README.md` |

## Important slash commands

Use the relevant [extension catalog section](extensions/catalog.md) or [Harness Wiki commands](extensions/wiki-extension.md#commands) rather than loading every command description. Root `README.md` and `packages/pi-learn-extensions/README.md` contain full usage examples; extension sources remain the source of truth for exact behavior.

## How the repo is organized

```text
pi-learn/
├── package.json                         # root Pi package manifest
├── README.md                            # install and feature overview
├── docs/                                # Vietnamese Pi documentation
├── packages/
│   ├── pi-learn-extensions/             # public extension/theme package
│   │   ├── extensions/                  # Pi extension entrypoints
│   │   └── themes/midnight-aurora.json  # bundled theme
│   └── harness-runtime/                 # private Node runtime for harness commands
├── pi-harness/                          # harness design/roadmap docs
└── wiki/                                # Harness Wiki docs + reviewed `_rules.md`
```

See [Architecture overview](architecture/overview.md) for package boundaries and source-of-truth rules.

## Task routing

Choose the owning area and section below, not every linked page. Locate headings with bounded `grep`, then use `read(offset, limit)` for the needed sections; `#heading` links do not automatically constrain a filesystem read. Expand only for unresolved questions or relevant cross-area effects, and stop once grounded. Before edits, follow [Rule loading](#rule-loading) independently of this reading budget.

| Change intent | Owning area and starting section | When to expand |
|---|---|---|
| Package boundaries, manifests, or public entrypoints | [Package boundaries](architecture/overview.md#package-boundaries) | Runtime loading and consumers when registration/exports change. |
| A public tool, command, UI, or theme | The relevant heading in the [extensions catalog](extensions/catalog.md), selected using the capability table above | Shared host behavior, package wiring, or affected consumers only. |
| Session selection, parsing, cache, or reports | [Harness data flow](architecture/harness-runtime.md#data-flow) | Storage, safety, and report sections for changed data/evidence contracts. |
| Proposal approval, apply, or rollback | [Proposal lifecycle](architecture/harness-runtime.md#proposal-lifecycle-and-controlled-apply) | Evidence binding and safety boundaries when affected. |
| Eval or automation | [Eval and automation](architecture/harness-runtime.md#eval-and-automation) | The runtime stage being evaluated or scheduled. |
| Wiki generation depth or service/MFE coverage | [Documentation depth and planning](extensions/wiki-extension.md#documentation-depth-and-planning) | Multi-system coverage and content/navigation acceptance scenarios. |
| Wiki question prompts or agent context usage | [Selective reading](extensions/wiki-extension.md#selective-reading) | Prompt-rule loading and agent bootstrap guidance. |
| Wiki links, snapshots, or completion metadata | [Snapshot and metadata](extensions/wiki-extension.md#snapshot-and-metadata) | No-op behavior and link tests. |
| Install, docs, versioning, or release | The relevant heading in [development operations](operations/development.md) | Package boundaries and only the checks affected by the change. |

Target sections contain the source symbols and ownership details. Use [test commands](operations/testing-and-safety.md#test-commands) and the nearest component tests for validation, not a blanket read of all operational docs.

## Change-oriented guidance for future agents

1. **Start with the relevant route and sections.** This repo already has substantial docs; the wiki is a map and explanation layer, not a reason to preload every page or skip source verification when needed.
2. **Public extension/theme changes belong in `packages/pi-learn-extensions/`.** Do not make public package changes under `.pi/extensions/` unless the user specifically asks for local-only behavior.
3. **Treat logs and auth as sensitive.** Do not read `.pi/logs/llm-payloads/`, `.env`, Pi auth JSON, ChatGPT account stores, private keys, or token-bearing files.
4. **Guard UI work.** TUI extensions should check `ctx.hasUI`, use `ctx.ui?.` when appropriate, and clean up timers/compositors/listeners on shutdown.
5. **Prefer runtime tests for harness changes.** The root package has no root `test` script, but `packages/harness-runtime/package.json` defines `npm test` as `node --test`.
6. **Reload Pi after extension/theme changes.** The normal verification loop is source edit → targeted static/test check → restart Pi or `/reload` → run the relevant slash command.
7. **Resolve the current Wiki command-rule mismatch before changing that surface.** Source and evals intentionally omit `/harness-wiki-status`, while reviewed rule `EXT-CMD-001` still lists it; see [Harness Wiki capability](extensions/wiki-extension.md#known-reviewed-rule-mismatch).

## Wiki sections

- [Architecture overview](architecture/overview.md) — package layout, manifests, and source-of-truth boundaries.
- [Extensions catalog](extensions/catalog.md) — public extensions, theme, commands, and modification notes.
- [Harness Wiki capability](extensions/wiki-extension.md) — `/harness-wiki-*` behavior, prompt-rule loading, metadata, no-op logic, and upstream OpenWiki differences.
- [Harness runtime](architecture/harness-runtime.md) — session mining, reports, proposals, eval, automation, and safety model.
- [Development operations](operations/development.md) — install/update/release/docs workflows.
- [Testing and safety](operations/testing-and-safety.md) — checks to run and privacy/security constraints.
