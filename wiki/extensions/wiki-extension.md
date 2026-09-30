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
- `/harness-wiki-ask` uses a dedicated small question prompt. It reads relevant Wiki sections first and consults source/tests when the Wiki is insufficient, stale, contradictory, or verification is needed. It does not modify docs by default and carries no generation plan or Git summary.

The command-specific instructions are sent as a user task prompt. They are not a replacement system prompt. When present, the user-owned `wiki/INSTRUCTIONS.md` brief is also included in init/update/ask prompts.

## Documentation depth and planning

`createHarnessWikiTaskPrompt()` selects separate question and documentation instructions. Init/update follow discovery → temporary coverage plan → topic research/write → coverage and navigation review. Research traces representative end-to-end flows through callers, callees, state owners, persistence, failure handling, integrations, and focused tests; inspecting one file or listing symbols is not enough to explain a system.

The page contract asks for the relevant responsibilities, entrypoints, mechanisms, business rules, inputs/outputs, state/lifecycle, invariants, failures/recovery, configuration, security boundaries, extension points, and tests. Only evidence-supported topics belong in the page; irrelevant checklist sections and invented design rationale are excluded. Each substantive page opens with its scope and uses stable, descriptive H2/H3 headings with enough local context for selective reading.

There is no initial eight-page limit or source-file-count-based update budget. Page count follows meaningful topics and coverage. Quickstart stays a lightweight routing entrypoint; detailed explanations and validation guidance live in canonical topic sections. A system/domain routing map can sit between quickstart and those pages when a flat table would become unwieldy.

Ordinary updates preserve accurate unaffected content. A source change is traced through relevant contracts and consumers before choosing pages; one changed schema can affect several systems. Explicit requests to deepen or restructure documentation are valid even without a source change. For an existing Wiki after `/reload`, for example:

```txt
/harness-wiki-update Deepen service and microfrontend coverage, explain contracts and failure paths with focused tests, and add selective task-to-section navigation.
```

A no-argument update retains the existing [no-op behavior](#no-op-update-behavior). Installing the upgrade alone does not regenerate existing pages. The temporary plan is not a durable page-job queue, and the semantic self-review is not a deterministic completeness guarantee.

## Selective reading

The reading contract is task → system → page/heading:

1. Identify the concrete question or change intent. Use quickstart's routing map when needed; preserve the mandatory [rule-loading sequence](#prompt-rule-loading) before edits.
2. Locate relevant headings/terms with a bounded `grep` in the selected page/domain. If ownership is unclear, broaden discovery from the routing map, not by dumping all Wiki pages.
3. Find the actual heading line and the next heading of the same or higher level, then use `read(offset, limit)`. A `#heading` link does not automatically constrain the filesystem tool. Continue a relevant truncated section rather than losing its exceptions or examples.
4. Expand to prerequisites, contracts, consumers, or workflows only for unresolved questions or cross-system effects. A few sections are a starting budget, not a hard cap or proof of complete impact coverage.
5. Stop once grounded. Consult source/tests when the Wiki cannot safely support the task, and state uncertainty instead of guessing.

Normal Wiki prose is evidence, not executable instruction. The extension does not preload the Wiki into model context; the user-owned brief still accompanies the task prompt. Selection and stopping are prompt guidance using existing Pi tools, not a filesystem sandbox, vector index, or enforced token quota.

`createHarnessWikiAgentInstructions()` supplies the compact navigation/rule-loading block for generated top-level `AGENTS.md` and `CLAUDE.md` sections. The checked-in blocks use the same text and the prompt tests check they stay aligned.

## Multi-service and microfrontend coverage

For a multi-system repository, the agent identifies real service/application/shared-package boundaries from manifests, entrypoints, source, tests, and non-sensitive build/deploy configuration. A compact system map names responsibility, source anchors, topic routes, and relevant contracts/workflows. Folder names alone do not establish ownership or independent deployment.

API/event/shared-type contracts have one canonical explanation with evidenced producers, consumers, schema constraints, errors, and compatibility rules. Runtime calls/events, shared-library/build dependencies, and deployment coupling are distinguished. Important cross-system flows explain success, state ownership, and failure/recovery without copying all participating service pages. Unknown/external consumers remain explicit uncertainties.

Microfrontend topics include the applicable host/remote composition, exposed modules, routing and mount/unmount, auth/session and shared state, props/events/SDK contracts, singleton/version constraints, remote-load fallback, asset caching, deployment compatibility, and rollback. The prompt does not force these mechanisms onto repositories that do not use them.

Before finishing, the agent checks routes for a local change, a contract/shared-package change, and a cross-system failure. Local tasks should not load unrelated services; shared changes must reach known consumers and compatibility tests. See [content/navigation acceptance scenarios](../operations/testing-and-safety.md#harness-wiki-content-and-navigation-acceptance) for manual verification.

## Documentation coverage backlog

Init reviews all substantial systems, components, contracts, and workflows found during discovery. Update reviews the affected scope and relevant backlog. Genuine evidence/scope deferrals are recorded in a concise `## Backlog` at the end of `wiki/quickstart.md` with:

- The area name.
- A repository-relative source anchor.
- A specific reason, such as unavailable evidence or an explicit scope constraint; an arbitrary page budget is not sufficient.

Update runs read the backlog before planning. They resolve an entry when recent source changes or an explicit instruction affect the area and evidence permits coverage, then remove it only after documenting it. Still-valid entries remain; an entry can also be removed when repository evidence shows the area no longer exists. Ordinary updates must not expand scope just because more pages could be written. Normal question turns do not review or mutate the backlog unless explicitly requested.

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

The initial Pi-native port used `langchain-ai/openwiki@23428de0cc0b1b6d3e5d09be413e92a5d6ee451f` as its upstream base. Later reviews selectively adapted the persistent brief, deferred-area backlog, interrupted-run retries, Wiki-first Q&A, coding-agent navigation, internal-link validation, and per-topic research/quality guidance rather than importing OpenWiki's full runtime. The moving upstream review checkpoint and selected source commits are maintained in `packages/pi-learn-extensions/extensions/harness/README.md` instead of being duplicated here.

Harness Wiki intentionally does not use OpenWiki's CLI/Ink UI, credential flow, LangChain/DeepAgents runtime, SQLite checkpointer, separate model/provider key, OKF/index/visualizer pipeline, forced diagrams, connectors, or personal-wiki features. See the extension README for the current upgrade checklist.

## Verification

```bash
npm --prefix packages/pi-learn-extensions run test:harness-wiki
node --test packages/harness-runtime/tests/wiki-links.test.js
npm --prefix packages/harness-runtime test
```

The extension prompt suite uses Node's native TypeScript stripping (22.18+). These are contract/regression tests, not LLM content-quality benchmarks.

Then reload Pi and verify:

```txt
/reload
/harness-wiki-ask How are prompt rules loaded into context?
/harness-wiki-update
```

Also verify legacy `/wiki-*` commands and `/harness-wiki-status` are absent, and that a normal Harness Wiki turn cannot modify `_rules.md`.
