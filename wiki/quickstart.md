# Pi Learn quickstart

Pi Learn is a Pi Coding Agent package and Vietnamese learning repository. It publishes a repository Wiki extension, ChatGPT usage status, Aurora UI, and the `midnight-aurora` theme.

## When to read this page

- For a request about this repository, read this page once when it is not already available in the current context.
- Do not reload it when it is already available.
- Do not read it for unrelated requests.
- Use the routes below to open only the relevant page/heading; do not preload the whole Wiki.

## Project map

```text
pi-learn/
├── package.json
├── README.md
├── docs/                                # Vietnamese Pi reference docs
├── packages/pi-learn-extensions/
│   ├── extensions/
│   │   ├── wiki/                        # /wiki and /wiki-update
│   │   ├── chatgpt-usage-status/
│   │   └── aurora-ui.ts
│   └── themes/midnight-aurora.json
└── wiki/                                # repository knowledge + scoped rules
```

The retired session-analysis/proposal runtime, image-generation extension, and model-prompt tool are not part of the package.

## Rule loading

Load rules only when editing the component or documentation domain they govern. Read the root rule file plus only the applicable domain files immediately before the edit; do not load rules for read-only questions.

| Edit target | Rules to load |
|---|---|
| Any governed repository edit | [`wiki/_rules.md`](_rules.md) |
| Manifests, package boundaries, architecture docs | [`wiki/architecture/_rules.md`](architecture/_rules.md) |
| Extension/theme source or extension docs | [`wiki/extensions/_rules.md`](extensions/_rules.md) |
| README, AGENTS/CLAUDE, docs, tests, lockfiles, release/operations | [`wiki/operations/_rules.md`](operations/_rules.md) |

If the edit scope expands, load the newly applicable file. Re-read a rule only after compaction removes it from context or its governed scope changes.

`/wiki-update` may change `_rules.md` only when its command message explicitly requests rule updates. Ordinary Wiki runs keep rule files protected.

## Commands

```txt
/wiki [extra instructions]
/wiki-update [extra instructions]
```

- `/wiki` initializes repository documentation.
- `/wiki-update` performs a scoped maintenance update from source, Git, existing Wiki content, and the user request.
- There is no Wiki question command. Ordinary project questions follow the conditional reading guidance above.

See [Wiki capability](extensions/wiki-extension.md#commands-and-run-lifecycle).

## Task routing

Use bounded `grep` to locate the target heading, then `read(offset, limit)` for that section. A `#heading` link does not automatically constrain a filesystem read. Expand only for unresolved dependencies, contracts, consumers, or workflows.

| Change intent | Start here | Expand when |
|---|---|---|
| Package manifests or public entrypoints | [Architecture — package boundaries](architecture/overview.md#package-boundaries) | Registration/resource discovery also changes. |
| Wiki commands, prompts, rules, snapshots, links | [Wiki capability](extensions/wiki-extension.md) | Package wiring or operational checks change. |
| ChatGPT usage status | [Catalog — ChatGPT usage](extensions/catalog.md#chatgpt-usage-status) | Auth storage or Aurora status integration changes. |
| Aurora UI or theme | [Catalog — Aurora UI](extensions/catalog.md#aurora-ui) | Lifecycle cleanup, terminal behavior, or theme tokens change. |
| Install, docs, release, or versions | [Development operations](operations/development.md) | Manifest/package boundaries change. |
| Tests or privacy/safety | [Testing and safety](operations/testing-and-safety.md) | The owning extension contract needs source verification. |

## Change guidance

1. Public extension/theme source belongs under `packages/pi-learn-extensions/`; `.pi/` remains local/dev-only unless explicitly requested.
2. Never read live auth, `.env`, private keys, payload logs, or raw session logs without exact authorization.
3. Guard UI behavior with `ctx.hasUI` and clean up session state on shutdown/replacement.
4. After extension/theme changes, run focused tests and `/reload` before interactive verification.
5. Use current source/tests when this Wiki is stale, incomplete, or contradictory.

## Wiki sections

- [Architecture overview](architecture/overview.md)
- [Extensions and theme catalog](extensions/catalog.md)
- [Wiki capability](extensions/wiki-extension.md)
- [Development operations](operations/development.md)
- [Testing and safety](operations/testing-and-safety.md)
