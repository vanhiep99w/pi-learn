# Harness Wiki capability

Harness Wiki is the repository-knowledge capability of the single public Harness extension. It preserves the useful Pi-native OpenWiki workflow while sharing command ownership, safety, proposals, and status with Harness.

Sources:

```txt
packages/pi-learn-extensions/extensions/harness/index.ts
packages/pi-learn-extensions/extensions/harness/wiki-commands.ts
packages/pi-learn-extensions/extensions/harness/wiki-prompt.ts
packages/pi-learn-extensions/extensions/harness/README.md
packages/harness-runtime/src/analysis/wiki-prompt-rules.js
packages/harness-runtime/src/analysis/wiki-links.js
```

## Commands

```txt
/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
```

The old `/wiki-*` commands and `/harness-wiki-status` are intentionally absent; there are no deprecated or hidden aliases.

## Known reviewed-rule mismatch

Current source, READMEs, git history, and the `harness-wiki-command-surface` eval agree that `/harness-wiki-status` was intentionally removed. However, reviewed rule `EXT-CMD-001` in `wiki/extensions/_rules.md` still lists that command as required. This Wiki run cannot repair the rule because `_rules.md` changes must use the Harness proposal, approval, and controlled-apply workflow.

Before changing the Harness Wiki command surface, treat this as an unresolved policy/source mismatch: do not silently re-add or further remove commands. First create and review a proposal that reconciles `EXT-CMD-001` with the intended public contract, then keep source, tests/evals, READMEs, and Wiki docs aligned.

## Command behavior

- `/harness-wiki-init` creates missing deterministic prompt-rule scaffolds, then starts an initial documentation run with the current Pi model/tools.
- `/harness-wiki-update` inspects existing docs, metadata, git history, worktree changes, and internal Wiki links. Without extra instructions it skips only when the previous run is complete and the repository and links are already accounted for.
- `/harness-wiki-ask` reads `wiki/` first and consults source only when the Wiki is insufficient or stale, or when the user requests source verification. It does not modify docs by default.

The command-specific instructions are sent as a user task prompt. They are not a replacement system prompt. When present, the user-owned `wiki/INSTRUCTIONS.md` brief is also included in init/update/ask prompts.

## Documentation coverage backlog

Init and update runs perform a coverage self-check so a substantial repository area is not silently lost because of the initial page budget. An area discovered but not documented is recorded in a concise `## Backlog` section at the end of `wiki/quickstart.md` with:

- The area name.
- A repository-relative source anchor.
- A one-line reason for deferral.

Update runs read the backlog before planning. They resolve an entry when recent source changes or the user's explicit instruction affect that area, then remove the entry after documenting it. Still-valid entries remain in place; an entry may also be removed when repository evidence confirms the area no longer exists. Spare page budget alone does not justify broadening an otherwise surgical update. Normal `/harness-wiki-ask` turns do not review or mutate the backlog unless the user explicitly requests a documentation change.

## Persistent Wiki brief

`wiki/INSTRUCTIONS.md` is optional user-owned control metadata for documentation scope, priorities, language, exclusions, and intended audience. Harness reads at most 64 KiB from a regular non-symlink file and includes the content in init/update/ask prompts.

Normal Harness Wiki runs cannot modify this file. Users may edit it directly or in a regular Pi turn. It is excluded from generated-documentation snapshots, but a worktree or committed change to the brief remains meaningful for `/harness-wiki-update` no-op detection. Reviewed `wiki/**/_rules.md` instructions and deterministic privacy/protection/apply controls take precedence over the brief.

## Prompt-rule loading

Reviewed prompt rules use one Markdown file for root and each final Wiki section:

```txt
wiki/_rules.md
wiki/architecture/_rules.md
wiki/extensions/_rules.md
wiki/operations/_rules.md
```

Loading is lazy:

```txt
Pi auto-loads AGENTS.md
  → model reads wiki/quickstart.md
  → model reads wiki/_rules.md
  → model identifies target domains
  → model reads applicable section/_rules.md
  → rule text enters context as read-tool results
```

The extension does not use `before_agent_start`, `context`, or provider-payload rewriting to inject all rules. It does not maintain a rule-content watcher or mtime/hash cache. A later `read` sees current file content, so editing Markdown rules does not require `/reload`; changing extension code does.

This is best-effort prompt discipline. File protection, approval, target allowlists, path safety, redaction, and rollback remain deterministic code behavior.

## Ownership and file protection

| Path | Owner |
|---|---|
| Normal `wiki/**/*.md` pages | Harness Wiki documentation workflow |
| `wiki/INSTRUCTIONS.md` | User-owned persistent Wiki brief |
| `wiki/**/_rules.md` | Harness proposal → approval → controlled apply |
| `wiki/.last-update.json` | Harness Wiki metadata finalizer |
| `wiki/_plan.md` | Temporary documentation run; removed before completion |

The Harness extension blocks built-in write/edit and common shell mutation attempts against `_rules.md` and `.last-update.json` in normal Pi tool turns. Approved `/harness-apply` writes through the controlled runtime lifecycle rather than model tool calls.

Missing `_rules.md` files are a narrow bootstrap exception: the extension may create deterministic prompt-empty scaffolds for root/final sections. It does not invent policy or proposal origins.

## Snapshot and metadata

The documentation snapshot hashes only normal Wiki Markdown. It excludes:

```txt
wiki/INSTRUCTIONS.md
wiki/**/_rules.md
wiki/.last-update.json
wiki/_plan.md
hidden/temp files
```

After `agent_settled`:

1. Harness creates any missing final-section scaffolds and recomputes the normal documentation snapshot.
2. `validateWikiInternalLinks()` scans normal Wiki pages for relative Markdown file links and heading anchors. External URLs and images are ignored; checked links may target reserved Wiki Markdown such as `_rules.md`, but may not escape the Wiki root or resolve through symlink targets.
3. A changed, valid, non-aborted run writes `.last-update.json` with `status: "complete"`. Invalid internal links, or an aborted/failed agent run that changed docs, write `status: "interrupted"`; session shutdown does the same when an active documentation run changed docs.
4. A later successful no-change retry can clear stale interrupted status. Scaffold-only or prompt-rule-only changes still do not create a fake documentation update.

Link failures are reported with source path and line so they can be repaired on the retry. A prompt-rule or `wiki/INSTRUCTIONS.md` Git change remains meaningful for no-op detection because normal docs may need to reflect updated workflow, policy, scope, or priorities.

## Rule validation and controlled apply

`packages/harness-runtime/src/analysis/wiki-prompt-rules.js` provides lightweight Markdown/path lint:

- Reserved basename `_rules.md`.
- Root/final-section completeness.
- Project-root and symlink safety.
- UTF-8/NUL/64 KiB checks.
- Stable rule-heading IDs and duplicate detection.
- Proposal-origin syntax checks.

It does not parse natural language into detector parameters or build an effective runtime detector registry. Status always reports lint errors; init/update/ask fail closed after deterministic scaffold creation if the prompt-rule layout remains invalid.

Approved prompt-rule proposals patch exact Markdown blocks. Controlled apply validates the complete prompt-rule layout afterward and restores original content if validation fails.

## No-op update behavior

`/harness-wiki-update` runs when:

- No previous update Git head exists, or the previous status is `interrupted`.
- Internal Wiki links are invalid.
- The worktree has meaningful changes other than metadata.
- Prompt rules changed.
- Source/config paths changed.
- Git changed but changed paths cannot be determined safely.

It may skip when links are valid, the previous run is complete, all committed changes since that update are normal Wiki documentation/metadata, and the worktree is otherwise clean.

## OpenWiki provenance

The initial Pi-native port used `langchain-ai/openwiki@23428de0cc0b1b6d3e5d09be413e92a5d6ee451f` as its upstream base. Later reviews selectively adapted the persistent brief, deferred-area backlog, interrupted-run retries, Wiki-first Q&A, coding-agent navigation guidance, and internal-link validation rather than importing OpenWiki's full runtime. The moving upstream review checkpoint and selected source commits are maintained in `packages/pi-learn-extensions/extensions/harness/README.md` instead of being duplicated here.

Harness Wiki intentionally does not use OpenWiki's CLI/Ink UI, credential flow, LangChain/DeepAgents runtime, SQLite checkpointer, separate model/provider key, OKF/index/visualizer pipeline, forced diagrams, connectors, or personal-wiki features. See the extension README for the current upgrade checklist.

## Verification

```bash
node --test packages/harness-runtime/tests/wiki-links.test.js
npm --prefix packages/harness-runtime test
```

Then reload Pi and verify:

```txt
/reload
/harness-wiki-ask How are prompt rules loaded into context?
/harness-wiki-update
```

Also verify legacy `/wiki-*` commands and `/harness-wiki-status` are absent, and that a normal Harness Wiki turn cannot modify `_rules.md`.
