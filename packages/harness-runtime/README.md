# Harness Runtime

Runtime API for Pi session observability, bounded project evidence, caller-supplied findings, reports, proposals, reflection, controlled apply, and evals.

Primary UX is the Pi extension in:

```txt
packages/pi-learn-extensions/extensions/harness/index.ts
```

This package no longer exposes a standalone CLI/bin. The extension imports `src/api.js` directly so runtime logic stays centralized without spawning a child process or keeping a separate LLM API key.

## API modules

```js
import {
  analysisRun,
  projectEvidence,
  agentAssets,
  EVIDENCE_STATES,
  normalizeEvidenceState,
  writeFindings,
  readFindings,
  sessions,
  scan,
  taskEpisodes,
  report,
  reflect,
  importReflection,
  propose,
  proposals,
  approve,
  reject,
  apply,
  rollback,
  history,
  evalHarness,
  automationStatus,
  automate,
} from "@pi-learn/harness-runtime";
```

Most functions accept the same option shape:

```js
{
  project: "/path/to/project",
  sessionDir: "/path/to/pi/sessions",
  harnessHome: "/path/to/private/harness-home",
  maxSessionsPerScan: 5
}
```

`analysisRun(options)` freezes `until` before one discovery pass and returns a JSON-safe public run contract. Pass that same object as `analysisRun` to consumers when report and reflection must use exactly the same selected population:

```js
const run = analysisRun(options);
const reportOutput = await report({ ...options, analysisRun: run });
const reflectionOutput = await reflect({ ...options, analysisRun: run });
```

Legacy calls such as `report(options)` and `reflect(options)` remain supported; each creates a compatibility analysis run internally. The v1 public contract uses `kind: "pi-harness.analysis-run"`, a `run-` ID, `selection.strategy: "latest-n"`, `selection.limit`, a minimal route-only `workspaceTarget`, eligible/selected counts, and deterministic fingerprints. Git projects use `{ kind: "repo-root", route: ".", packageRoute: null, ownerRoute: "." }`; non-Git projects use the same routes with `kind: "standalone"`. No workspace-member topology is inferred.

`projectEvidence(options)` is a separate, synchronous, static Project Harness Evidence Lane. It reads only bounded project metadata and returns `kind: "pi-harness.project-evidence"` with project-relative routes. Its surfaces cover the root/member npm manifests and runtime pins, manifest script leads, applicable `AGENTS.md`/`wiki/**/_rules.md` inventory, filesystem-only Git/index name-status metadata, CI workflow names, release/recovery documentation leads, and source/test ownership paths. npm workspace patterns are expanded without running npm; a nested member can therefore bind this lane's `workspaceTarget` to `{ kind: "workspace-member", route, packageRoute, ownerRoute }`.

Each surface reports `available`, `partial`, or `unavailable`; missing Git and a missing root `package.json` remain explicit diagnostics rather than exceptions. Scripts never expose their shell bodies. Only a reviewed safe argv identity is projected, and unsafe scripts remain name-only leads. Git collection reads metadata/index files and never runs `git`, npm, tests, or any other project command. CI is presence-only and is never opened externally. The boundary is explicit: a script, CI file, release/recovery document, or route lead being present does not prove exercise, pass, acceptance, or agent use.

`agentAssets(options)` is an additive, synchronous, project-only Agent Asset Evidence Lane. It returns `kind: "pi-harness.agent-assets"` and inventories root/nested applicable instruction chains through the existing secure inventory, project `.pi/agent/model-prompts/*.md`, and explicitly declared project-local `skills`/`extensions` from the root `package.json` Pi manifest or `.pi/settings.json`. It reports only project-relative presence/configuration, per-surface `complete`/`partial`/`failed` status, bounded counts, and safe diagnostics. It does not inspect user-home assets, MCP or external package roots, raw sessions, auth, payload logs, `.env`, or private Harness evidence. Presence/configuration does not claim selection, reading, invocation, exercise, or outcome, and the lane is not wired into findings, reports, proposals, automation, or extension UI.

The additive P1 `writeFindings(options)`/`readFindings(options)` APIs are a caller-supplied, synchronous Findings ledger. `EVIDENCE_STATES` and `normalizeEvidenceState()` expose exactly `Present`, `Wired`, `Exercised`, `Outcome-supported`, `Missing`, `Unobserved`, and `Not-applicable`; the runtime never derives a state from inventory or session counts. A supplied finding uses schema version `1`, stable `F-####` identity, explicit lifecycle/status, target and acceptance fields, bounded evidence references, and optional multiple `P-####` proposal references. Findings are stored privately under the configured Harness project key at `findings/latest.json` and append-only `findings/history.jsonl` with owner-only modes and fail-closed validation. The reader projection contains no absolute paths, private locators, prompts, commands, or raw evidence. A proposal reference never changes a finding's state.

The current uncommitted P1 proposal-to-finding linkage candidate adds optional `finding_id` and `expected_finding_revision` proposal frontmatter. Bound proposals require a caller-supplied `F-####` finding and an exact current revision; approval and the final pre-apply boundary both fail closed with stable `PROPOSAL_FINDING_INVALID`, `PROPOSAL_FINDING_MISSING`, or `PROPOSAL_FINDING_REVISION_STALE` codes. Rejection does not mutate the finding, multiple proposal references remain possible, and legacy proposals without the fields remain readable and usable. Proposal summaries/history and proposal command responses are reader-safe and omit private paths, raw session references, and evidence content. This slice does not create findings, infer bindings, change finding state, or add reports, TUI, validation receipts, automation, or UI wiring.

The Project Evidence workspace-member hint is not the full workspace/owner-topology capability: `analysisRun()` keeps its compatible route-only target, and apply binding, sibling-owner rejection, and complete topology remain future work. `projectEvidence()` and `agentAssets()` are independent read-only lanes and create no findings.

`maxSessionsPerScan` is normalized once before discovery: non-negative finite values are truncated to an integer, while negative/non-finite values are rejected before context creation. Parseable session header timestamps are canonicalized to ISO; invalid/missing timestamps become `null` and eligibility falls back to file mtime. Authority explicitly denies raw session content and user-home assets and limits normalized lookup to `single-exact-ref`.

Metadata-only private context is stored under `~/.pi/harness/projects/<project-key>/analysis-runs/<run-id>/context.json`. It is immutable after creation and bound to the public run by `contextFingerprint`. Every public API validates a supplied run/context before returning or consuming it, including `analysisRun()` and `sessions()`. Consumers recompute context counts, fingerprints, selected-subset and path bindings before use. Each consumer writes an independent atomic receipt under `analysis-runs/<run-id>/consumers/<consumer>.json`, so concurrent consumers do not overwrite context or each other.

`taskEpisodes(options)` is an explicit, additive API. It accepts a supplied frozen run or creates a compatibility run, consumes it through the independent `task-episodes` consumer, and returns only the reader-safe candidate projection. Policy `task-episode-candidate-v1` is intentionally conservative: every active-path user message starts a separate session-bounded candidate, candidates never merge, and follow-up user turns can therefore over-split one semantic goal. Active-path branch summaries close an uncertainty boundary; compaction remains inside the current candidate without parsing summary prose. A user-only candidate with no later substantive active-path event is retained in private counts as a `zero-signal` discard, while assistant or tool activity retains read-only and failed-work candidates.

Only successful matched `edit`/`write` call-result pairs claim `observed-tool-success`. Validation is observed, never executed: v1 recognizes strict uncomplicated `npm test`, `npm --prefix <project-relative-route> test`, `node --test`, and `git diff --check` shapes and rejects shell composition, substitutions, environment prefixes, traversal, and truncated commands. Only a passing explicit non-root npm prefix that lexically contains every linked change route is `scope-correlated`; broad checks remain `unproven`. A later edit cannot inherit an earlier pass, and failure-edit-rerun chains retain explicit repair links. Valid active-path `harness-tag` custom entries with allowlisted `success|failure` close a candidate as explicit self-marked evidence; generic labels and marker reason/note/path metadata are not closure evidence. Session end remains `unobserved`, and delivery status is never inferred.

Deterministic proposal modes now use one review gate. `propose({ rules: true })` reviews R-0001 through R-0004; `target: "rules"` selects R-0001/R-0002, `target: "parser"` selects R-0004, and `target: "redaction"` selects R-0003. Detectors emit proposal-free `CandidateSignal` objects first. Real consumed evidence refs are bound to the frozen session `sourceFingerprint` and normalized event ID when available. The reviewer inventories only applicable project `AGENTS.md` and `wiki/**/_rules.md` ancestor chains, opens bounded regular files, checks detector-owned per-block coverage signatures, and retains promoted/deferred/rejected decisions before any proposal is written. `AGENTS.md` pre-H2 or H1/list-only guidance is one opaque synthetic block; Wiki rule coverage remains H2-only. `candidates` is the CandidateSignal count for these modes; additive output includes `promoted`, `deferred`, `rejected`, privacy-safe `candidateSignals`, `decisions`, and project-relative agent-asset summaries.

Every proposal attempt first creates an exclusive `pending-proposal-write` receipt at `analysis-runs/<run-id>/candidate-reviews/<mode>/<attempt-id>.json`; proposal writing does not start if this begin step fails. Begin and final receipt files use mode `0600`. Finalization uses a receipt-specific fsynced atomic replace, cleans temporary files on failure, and atomically records written/skipped proposal identity in the same attempt file. Repeated same-run/mode attempts retain separate collision-resistant files, and a finalization failure leaves the original pending receipt as durable incomplete-attempt evidence. Private receipts retain bounded CandidateSignal counts, required-review fields and structured evidence refs without excerpts or raw paths. Signal audit is detector-specific: R-0001 stores only an allowlisted command class plus stable hash, while R-0002/R-0003/R-0004 store finite allowlisted classifications. Frozen `context.json` is never mutated.

Task Episode artifacts are private run artifacts:

```txt
analysis-runs/<run-id>/task-episodes/private.json
analysis-runs/<run-id>/task-episodes/reader.json
```

Both files are exclusive `0600` publications. The canonical private artifact binds frozen run/session source fingerprints, normalized-event fingerprints, event/entry refs, deterministic candidate/change/validation IDs, command fingerprints, counts, the analysis-run project key and private project root, and the derived reader fingerprint. The reader uses only deterministic `E-001`/`C-001`/`V-001` aliases, ordinals, project-relative lexical routes, allowlisted check classes/status, closure, coverage, and reconciled counts. It excludes prompts/excerpts, raw commands, absolute paths, session/event/entry IDs, private refs, and source/command fingerprints. Publication writes private first and reader second; exact replay completes an interrupted private-only publication, while mismatch, orphan reader, unsafe path/mode, cross-project binding, or reconciliation failure fails closed. `context.json` is never changed. Reads and publications use no-follow descriptor-bound checks, fstat-before/after, regular-file/owner-only mode checks, descriptor real-target/inode/containment checks, safe-directory-chain revalidation, exclusive hard-link publication, and temporary-file cleanup. Platforms without the required descriptor namespace fail closed; because portable Node APIs do not provide fully descriptor-relative hard-link publication, a same-user parent-directory swap between validation points remains a residual race and is not claimed to be transactional.

Findings and proposal linkage are not wired into detectors, reports, TUI, validation receipts, automation, the extension UI, or a config feature gate. A proposal binding is checked only when an explicitly bound proposal is approved or applied.

## Pi extension commands

```txt
/harness [last]
/harness-improve [last]
/harness-proposals
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note <text>

/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
```

`/harness [last]` is the single interactive observability command in TUI mode: it combines the frozen session list and generated Markdown report from one report/analysis-run payload in one scrollable dashboard modal. Automation status is fetched separately because it does not discover sessions. `/harness-proposals` is the single interactive review command in TUI mode: it opens the proposal picker and provides detail, approve, reject, and approve-and-apply actions with confirmation. Proposals with a JSON Patch expose `Approve & Apply`; already approved proposals expose `Apply`. Approve/reject/apply remain runtime operations used internally or by the dedicated apply command. In print and JSON modes, `/harness-proposals` only prints the proposal list.

Harness Wiki is registered from the same public `harness/index.ts` entrypoint. The legacy `/wiki-*` commands and `extensions/wiki/` entrypoint are removed.

## Prompt rules

Reviewed project guidance lives in Markdown:

```txt
wiki/_rules.md
wiki/<section>/_rules.md
```

Pi loads the bootstrap instruction from `AGENTS.md`; the model then reads `wiki/quickstart.md`, root rules, and applicable section rules. Harness does not parse these prompts as detector config or inject every rule automatically.

Deterministic detectors/defaults remain in `src/analysis/rules.js`. Coverage signatures and promotion templates remain executable in `src/analysis/candidate-review.js`; prompt-rule prose is never parsed into detector or reviewer parameters. `src/analysis/wiki-prompt-rules.js` only discovers, scaffolds, classifies, and lints reserved prompt-rule files for status/protection/controlled apply.

## Safety

- Session discovery reads only the first JSONL line/header for listing.
- Analysis runs freeze `until`, sort with deterministic tie-breaks, and fingerprint eligible and selected session metadata. If a selected file changes before consumption (including the active session being appended), that session is explicitly skipped and the consumer lane is `partial`; the runtime never silently rediscovers a replacement population.
- Private analysis-run context contains session identity/stat metadata and warnings, not raw prompt/content. Corrupt/tampered context fails closed with `ANALYSIS_RUN_CONTEXT_INTEGRITY`.
- Normalized events have additive 1-based file-order `ordinal` values assigned after assistant/tool expansion; existing event IDs are unchanged. Load/JSON loss and malformed essential warnings make only that Task Episode session lane partial and suppress its candidates. Coverage-impacting parser/tree/normalizer warnings make the lane partial while structurally valid events may still yield candidates. Every essential event requires schema version 1, nonempty event/entry/kind, boolean active-path, exact ordinal order, and the expected session/project binding.
- Task Episodes inspect active-path normalized evidence only. Off-path events are omitted and counted; nonboolean tool-result status remains ambiguous (never success), unknown potentially mutating tools—including `preview_export`—missing change results, duplicate call IDs across all tool classes, and unclassified/truncated bash evidence make candidate observation coverage partial rather than claiming mutation or validation. Relative tool routes and npm prefixes resolve from an absolute contained event cwd; outside or ambiguous cwd/path evidence is partial. Validation fails conservatively when a later relevant check fails, and failure-before-edit repair links are retained only within the same candidate.
- Project agent-asset authority is fixed to `{ project: true, userHome: false }`. Applicable `AGENTS.md`/`_rules.md` files must be regular non-symlinks; each file is limited to 64 KiB, one review to 256 KiB and 128 applicable assets, with fatal UTF-8 decoding, NUL rejection, stable ordering, and descriptor-bound mutation checks. The reader requires no-follow open plus an OS descriptor namespace that can verify the opened real target, intended pathname/inode, and project containment before and after bounded fd reads. Static symlinks and intermediate-directory swaps fail partial. Platforms without strong descriptor binding verification fail closed rather than falling back to pathname reads.
- `agentAssets()` keeps the same project-only authority and no-follow instruction reader. Its additional model-prompt and declared skill/config reads use the same bounded descriptor checks; extension declarations are presence-only. File, aggregate, directory/node, and declaration counts are bounded. Unsafe/traversing declarations, malformed JSON/UTF-8/NUL content, oversized assets, symlinks, and unreadable or mutated files become safe partial diagnostics without exposing content or absolute paths.
- `projectEvidence()` is project-only and read-only: it does not load user-home assets or session evidence, execute project commands, open external CI, or write a project artifact. Manifest bodies and script shell text are never projected; Git changes are bounded name/status metadata, CI and delivery documentation are presence leads, and each missing/partial surface is diagnostic rather than a defect judgment. Its returned routes are project-relative and sensitive paths are omitted.
- Public candidate/review projections contain counts, IDs, project-relative routes and section IDs only—never asset contents, evidence excerpts, raw/session/cache paths, user-home paths, or non-rule heading words. Non-explicit headings use opaque digest-based section IDs.
- Frozen consumers pass the expected header identity/timestamp and final size/mtime into `writeSessionCache()`. A mismatch throws `FROZEN_SESSION_MISMATCH` before canonical cache persistence, preserving any existing cache.
- Report Markdown and reflection prompts include a bounded run summary: run ID, selected fingerprint, selected/accepted/skipped counts, consumer status, and an explicit partial/observed-empty notice.
- `inspect` parses a single explicit session file and returns metadata/tree, not full message content unless explicitly requested and redacted.
- `scan` writes normalized cache files under `~/.pi/harness/projects/<project-key>/sessions/<session-id>/`.
- Harness runtime logs are written under `~/.pi/harness/logs/` by default.
- Does not modify raw Pi session files.
- `reflect` builds LLM prompts only from normalized redacted cache excerpts, never raw session JSONL.
- Successful tool results are compact in reflection prompts: output bodies are omitted while status, timing when derivable, output size, and a `normalizedRef` locator are retained. Failed tool results keep a bounded redacted excerpt.
- A reflection model may use an available file-reading tool to inspect exactly one referenced line in normalized `events.jsonl` when compact evidence is insufficient. It must verify the referenced `eventId` and must never follow `sessionFile`, `rawRef`, or paths under `~/.pi/agent/sessions/`.
- Assistant thinking blocks are omitted from normalized message excerpts; final assistant text and thinking-level change metadata remain available.
- Runtime does not keep a separate LLM API key; `/harness-improve` uses the current Pi session model.
- LLM reflection responses can be imported as draft proposals only if they include evidence refs, target files, risk, test plan and rollback plan. LLM reflection/import, `target: "memory"`, and automation-created eval-fixture drafts remain outside the Slice 2 semantic coverage gate; proposal fingerprints do not claim to prevent semantic duplicates on those residual paths. Inside the deterministic gate, review fingerprints include inspected asset bindings while proposal fingerprints represent stable candidate/repair identity, so unrelated non-covering asset edits do not bypass draft deduplication.
- Proposal approve/reject/history only updates private proposal files under `~/.pi/harness`.
- `apply` requires an approved proposal plus a machine-applicable `## Patch` JSON block, checks git, creates `harness/P-0001`, and only edits files listed in the proposal target list.
- Changes to `wiki/**/_rules.md` are linted after apply; invalid changes are restored before apply fails.
- Normal Pi tool turns block write/edit and common shell mutations of `_rules.md` and `.last-update.json`; approved controlled apply writes through runtime code.
- `rollback` restores uncommitted apply changes for the recorded changed paths, or reverts the recorded commit when `--commit` was used.
- `eval` runs deterministic regression scenarios, including `existing-coverage-before-proposal`, and writes JSON/Markdown reports under `~/.pi/harness/projects/<project-key>/evals/`.
- `automate` is gated by `harness/config.json` and can only scan/report/draft proposals/eval; it never applies, commits, pushes, or reads raw logs beyond the normal normalized scan path. Enabled scan/report/propose stages share one frozen analysis run, and automation output records each stage's run ID, selected fingerprint, and deterministic candidate promotion/defer/reject counts for audit.
- Creates/checks private harness home at `~/.pi/harness`.
- Project config is read from `<projectRoot>/harness/config.json` when present.
