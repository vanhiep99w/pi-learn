# Wiki capability

This page describes command behavior, selective reading, explicit rule updates, metadata, and verification for `packages/pi-learn-extensions/extensions/wiki/`.

## Commands and run lifecycle

```txt
/wiki [extra instructions]
/wiki-update [extra instructions]
```

- `/wiki` initializes documentation from repository source, tests, and existing docs.
- `/wiki-update` performs a surgical maintenance update from current source, existing Wiki content, and its explicit message.
- Neither command injects working-tree status, commit history, diffs, or metadata Git fields into its prompt. Git remains internal to no-op detection and metadata bookkeeping.
- There is no ask/status/init alias. Ordinary project questions use the top-level `Project Wiki` agent instructions.

Both commands require an idle agent. They create missing deterministic rule scaffolds, capture a Wiki snapshot, send a task through the current Pi provider/model/tools, and finalize after `agent_settled`. Shutdown marks a changed in-flight run interrupted so the next update retries.

## Source ownership

| File | Responsibility |
|---|---|
| `wiki/index.ts` | Public extension entrypoint |
| `wiki/wiki-commands.ts` | Commands, lifecycle, protection, snapshots, no-op detection, metadata |
| `wiki/wiki-prompt.ts` | Task prompt, rule opt-in detector, AGENTS/CLAUDE bootstrap |
| `wiki/wiki-rules.js` | Rule path classification, section discovery, scaffold creation, lint |
| `wiki/wiki-links.js` | Relative Markdown file/anchor validation |

All paths above are under `packages/pi-learn-extensions/extensions/`.

## Conditional project reading

The generated top-level AGENTS/CLAUDE block has two independent conditions:

1. When a request is about the repository, read `wiki/quickstart.md` only if it is not already present in current context. Do not read it for unrelated requests.
2. Before editing a component, read only root/domain `_rules.md` files that govern that component. Read-only questions do not require rule loading.

Quickstart routes task intent to a page/heading and to applicable rules. The model should use bounded `grep` and ranged reads, expand only across relevant contracts/consumers/workflows, and stop once grounded. This is prompt guidance, not an enforced context sandbox.

## Explicit rule-update mode

Rule changes are allowed only through an explicitly opted-in `/wiki-update` message. `isExplicitRuleUpdateRequest()` recognizes direct references such as:

- `_rules.md` or `_rules`
- `Wiki rules` or `prompt rules`
- `rule file(s)`
- equivalent supported Vietnamese wording

Example:

```txt
/wiki-update Cập nhật wiki/**/_rules.md để phản ánh command surface mới
```

When opt-in is absent, write/edit and common shell mutation attempts against `_rules.md` are blocked. When present, the task prompt requires surgical rule edits, preservation of unrelated rules, unique stable rule IDs, and a valid root/final-section layout. No proposal or approval subsystem is involved.

`wiki/.last-update.json` remains extension-owned in every mode. The active run's `wiki/INSTRUCTIONS.md` also remains protected.

## Agent bootstrap maintenance

Init and update ensure top-level `AGENTS.md` and `CLAUDE.md`, when present, contain one compact `## Project Wiki` section. If neither exists, init/update may create `AGENTS.md` containing only that section.

The block must not copy detailed Wiki content. Its job is only to express conditional quickstart loading, component-scoped rule loading, and source verification when documentation is insufficient.

## Documentation workflow

Documentation modes follow:

```txt
discovery -> temporary wiki/_plan.md -> topic research/write -> coverage/navigation review
```

The prompt asks the agent to:

- map manifests, public entrypoints, existing docs, systems, schemas, tests, and operations;
- trace representative control/data flow, state, persistence, consumers, failures, and recovery;
- keep one canonical explanation per concept or contract;
- preserve accurate unaffected content during updates;
- avoid page quotas, formatting-only churn, and speculative architecture;
- remove `wiki/_plan.md` before completion;
- verify changed internal links and heading anchors.

`wiki/INSTRUCTIONS.md` supplies optional user-owned scope, priorities, language, exclusions, and audience. It cannot override privacy or protected metadata boundaries.

## Snapshot and metadata

The Wiki snapshot includes:

- normal `wiki/**/*.md` documentation;
- `wiki/**/_rules.md`.

It excludes:

- `wiki/INSTRUCTIONS.md`;
- `wiki/_plan.md` and hidden/temp paths;
- `wiki/.last-update.json`.

After settlement, the extension creates any newly needed scaffolds, validates internal documentation links and the rule layout, then writes metadata:

- `complete` when changed content is valid and the agent did not abort;
- `interrupted` when links/rules are invalid or an aborted run changed Wiki content;
- unchanged metadata for a successful no-op, except a valid retry may clear an earlier interrupted state.

A rule-only update therefore participates in snapshot and metadata finalization just like a documentation update.

## Link and rule validation

Internal link validation scans normal Wiki documentation, ignoring images and external URLs. Relative links must remain inside `wiki/`; target files must exist and cannot be symlinks; heading anchors use GitHub-like slugging with duplicate suffixes.

Rule validation requires:

- a real `wiki/` directory;
- root `wiki/_rules.md`;
- one `_rules.md` in each final Wiki section;
- bounded UTF-8 files without NUL bytes;
- valid, non-duplicated rule IDs inside each file;
- no path or symlink escape.

An explicitly requested rule repair can start with invalid rules so it can fix them, but finalization remains interrupted until the complete layout validates.

## No-op behavior

A no-argument `/wiki-update` runs when metadata is missing/interrupted, links or rules are invalid, the worktree has meaningful changes, source/configuration changed, or changed paths cannot be determined safely.

It may skip when the previous run is complete, links/rules validate, the worktree is clean apart from metadata, and commits since the recorded head contain only already-accounted Wiki documentation/metadata changes.

An explicit message always bypasses the no-op shortcut because it defines new requested scope.

## Verification

```bash
npm --prefix packages/pi-learn-extensions run test:wiki
```

The suite covers prompt contracts, explicit rule opt-in detection, AGENTS/CLAUDE alignment, rule discovery/lint, path safety, and internal links.

After source changes, run `/reload`, then verify:

```txt
/wiki-update
/wiki-update Update wiki/**/_rules.md for the changed component policy
```

Confirm that `/wiki`, `/wiki-update` are present, retired aliases are absent, a normal update cannot edit rules, an explicit rule update can edit them, and invalid links/rules produce interrupted metadata.
