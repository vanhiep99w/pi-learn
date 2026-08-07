# Harness runtime architecture

Harness is the repository's session-observability, self-improvement, and Wiki knowledge system. It reads Pi session logs, normalizes/redacts them into a private cache, generates reports and reflection prompts, writes proposals, supports approve/reject/apply/rollback lifecycle commands, runs deterministic eval scenarios, and exposes Harness Wiki from the same public extension entrypoint.

The primary UX is the Pi extension in `packages/pi-learn-extensions/extensions/harness/index.ts`. Core logic lives in the private runtime package `packages/harness-runtime/`.

## Package and command surface

`packages/harness-runtime/package.json` exports `src/api.js` and provides one test script:

```json
{
  "exports": { ".": "./src/api.js" },
  "scripts": { "test": "node --test" }
}
```

The harness extension imports the runtime API by resolving `../../../harness-runtime/src/api.js` and exposes observability/proposal commands plus `/harness-wiki-init`, `/harness-wiki-update`, and `/harness-wiki-ask`. The old `/wiki-*` commands and `/harness-wiki-status` are not registered. This matches the runtime README: the standalone CLI/bin is no longer the primary interface.

## Data flow

The main flow through `src/api.js` is:

1. **Create context** — `createHarnessContext()` loads config, resolves the current project, and creates a logger.
2. **Freeze an analysis run** — `analysisRun()` normalizes the selection bound, freezes `until` before one header/stat discovery pass, applies deterministic ordering, and records eligible/selected fingerprints plus immutable private context. The v1 kind is `pi-harness.analysis-run`, IDs begin with `run-`, and selection uses `latest-n` plus an integer limit. Positive fractional bounds are truncated; negative/non-finite bounds fail before context creation. Parseable header timestamps are canonical ISO values, while invalid/missing values become `null` and use mtime for eligibility.
3. **Validate the frozen selection** — every public API validates supplied run/context integrity before returning or consuming it, including `analysisRun()` and `sessions()`. Consumers recompute population counts/fingerprints, selected subset, session-directory containment/private refs, and public-run binding without rediscovery. Corrupt context fails closed; mutated or missing sessions are explicitly skipped and make the consumer lane `partial`.
4. **Parse session JSONL** — `parseSessionFile()` reads each unchanged selected JSONL file line by line, extracts the session header, keeps entries, and emits parser warnings for malformed/missing/duplicate structure.
5. **Guard and normalize** — before canonical persistence, `writeSessionCache()` verifies parsed header identity/timestamp and final size/mtime against the frozen snapshot. A mismatch cannot create or overwrite canonical cache. Matching parses proceed to tree building, normalization, metrics, and enriched warnings.
6. **Write private cache and receipt** — normalized session artifacts and independent atomic consumer receipts are written under the harness home, not into the source repo by default.
7. **Collect project evidence independently** — `projectEvidence()` performs a bounded filesystem-only pass over manifests, npm workspace/member routes, applicable project instructions, Git/index name-status metadata, CI workflow names, release/recovery documentation leads, and source/test ownership paths. `agentAssets()` is a separate project-only pass for the documented Agent Asset surfaces and reuses the secure applicable-instruction reader. Neither lane loads user-home/session evidence, executes project commands, or opens external CI, and neither writes a project artifact.
8. **Optionally build Task Episode candidates** — the explicit `taskEpisodes()` API consumes the frozen run through its own consumer, validates normalized event file order, uses active-path evidence only, creates one non-merged session-bounded candidate per user turn, links observed change/validation sets conservatively, and publishes canonical private plus derived reader artifacts. It is not invoked by reports, findings, proposals, automation, or extension UI.
9. **Review deterministic candidates before proposal** — R-0001 through R-0004 emit proposal-free `CandidateSignal` objects whose private evidence refs include the frozen session `sourceFingerprint` and normalized event ID when available. One reviewer filters by API mode, inventories bounded applicable project `AGENTS.md`/`wiki/**/_rules.md` ancestry, evaluates executable per-block coverage signatures and eligibility, then retains promoted/deferred/rejected decisions.
10. **Begin, write, and finalize one proposal attempt** — before proposal files are touched, the runtime exclusively persists a pending attempt receipt. It then writes/skips promoted proposals and atomically finalizes that same receipt. Begin failure prevents proposal writing; finalize failure leaves the pending receipt intact.
11. **Generate outputs** — report, reflection, reviewed proposal, eval, or automation functions consume normalized session results.

Representative source files:

- `src/api.js` — public runtime API and orchestration
- `src/analysis/analysis-run.js` — frozen population contract, deterministic fingerprints, private context, and mutation validation
- `src/analysis/task-episodes.js` — candidate segmentation, chronology/scope linkage, closure, fingerprints, and reader derivation
- `src/storage/task-episodes-writer.js` — secure two-file run-bound Task Episode publication and replay validation
- `src/config/load-config.js` — default/global/project config merge
- `src/session/parse-session.js` — JSONL parser and entry summaries
- `src/session/tree.js` — conversation/session tree handling
- `src/normalize/events.js` and `src/normalize/content.js` — normalized event/content representation
- `src/storage/cache-writer.js` — writes manifest/events/metrics/warnings cache files
- `src/report/report.js` — Markdown report generation
- `src/reflection/reflection.js` — redacted reflection prompt and response-to-proposal conversion
- `src/proposals/*` — draft proposal writing and lifecycle
- `src/eval/eval-harness.js` — deterministic eval scenarios
- `src/analysis/rules.js` — built-in deterministic detectors that emit CandidateSignals
- `src/analysis/project-agent-assets.js` — project-only applicability, bounded secure asset reads, H2 extraction, and privacy-safe instruction inventory projection
- `src/analysis/agent-assets.js` — additive project-only Agent Asset Evidence collection for instructions, model prompts, declared skills/extensions, and safe project config declarations
- `src/analysis/project-evidence.js` — bounded static Project Harness Evidence Lane, npm workspace hints, Git/index metadata, delivery leads, and reader-safe projection
- `src/analysis/candidate-review.js` — detector-owned coverage signatures, eligibility decisions, and promoted proposal templates
- `src/storage/candidate-review-writer.js` — atomic run-bound candidate review receipts
- `src/analysis/wiki-prompt-rules.js` — `_rules.md` discovery, classification, scaffolding, and lint; it does not configure detectors or coverage signatures

## Storage model

Default config in `src/config/load-config.js` sets:

```txt
sessionDir: ~/.pi/agent/sessions
harnessHome: ~/.pi/harness
maxSessionsPerScan: 50
automation.enabled: false
riskPolicy.requireHumanApproval: true
riskPolicy.requireGitClean: true
```

Normalized outputs are stored below:

```txt
~/.pi/harness/projects/<project-key>/
├── analysis-runs/<run-id>/
│   ├── context.json
│   ├── consumers/<consumer>.json
│   ├── candidate-reviews/<mode>/<attempt-id>.json
│   └── task-episodes/
│       ├── private.json
│       └── reader.json
├── sessions/<session-id>/
│   ├── manifest.json
│   ├── events.jsonl
│   ├── metrics.json
│   └── warnings.jsonl
├── reports/latest.md
├── reflections/latest.md
├── proposals/draft/P-0001-*.md
└── evals/latest.md
```

Project-specific config may exist at `harness/config.json` under the project root, but this repository did not contain that file during inspection.

## Safety and redaction

Harness is designed to avoid raw-log exposure in normal workflows:

- The runtime README states that reflection prompts are built from normalized redacted cache excerpts, not raw JSONL.
- Analysis-run `context.json` stores identity/stat metadata and warnings only; it does not store raw prompt or message content. It is immutable after creation, has a self-fingerprint bound to the public run, and is never rewritten for consumer status.
- Consumer status is stored in per-consumer atomic receipts. Concurrent report, reflection, and opt-in Task Episode consumers therefore retain separate audit records.
- Normalized events carry additive 1-based `ordinal` values assigned after one entry expands into assistant/tool events. Existing event IDs are preserved. Load/JSON loss and malformed essential warnings make only that Task Episode session lane partial and suppress its candidates. Coverage-impacting parser/tree/normalizer warnings make the lane partial while structurally valid events may still yield candidates. Every essential event requires schema version 1, nonempty event/entry/kind, boolean active-path, exact ordinal order, and the expected session/project binding.
- Task Episode policy `task-episode-candidate-v1` does not claim one semantic user goal. Every active-path `user_message` starts a candidate, candidates never merge, and multi-turn follow-up can over-split. Branch summaries close uncertainty without parsing prose; compactions remain as refs/counts. User-only zero-signal candidates are discarded from the reader but remain reconciled in private counts; assistant and tool activity retain read-only/failure tasks. Session end is `unobserved`, never success.
- Change evidence requires an active-path `edit`/`write` assistant call matched chronologically to a non-error result. Failed/missing pairs never claim mutation. Validation observation recognizes only strict simple package-test, `node --test`, and `git diff --check` command shapes; shell expansion/control characters are rejected even when quoted, and raw commands are never artifacts. Only a passing non-root `npm --prefix <route> test` whose route lexically contains every preceding change target is scope-correlated; an explicit `.` at a nested cwd resolves to that nested route while root `.` remains broad/unproven. Unknown mutating tools—including `preview_export`—unclassified/truncated bash, duplicate call IDs across tool classes, missing results, and ambiguous/outside routes make coverage partial. A later relevant failure overrides prior support; recognized failures queue repair links for the next change only within the same candidate.
- Only safe normalized custom markers with `customType: "harness-tag"` and data tag `success|failure` close candidates. Marker reason, note, cwd, creation time, leaf ID, arbitrary custom data, generic labels, and branch/compaction prose are not consumed. Self-marked closure leaves delivery status `unobserved`.
- Task Episode `private.json` binds the frozen run, destination project key and private project root, accepted source fingerprints, normalized-event fingerprints/status/warning codes, all candidate/change/validation refs, command fingerprints, counts, derived reader fingerprint, and an artifact fingerprint. `reader.json` is derived with deterministic aliases and excludes excerpts/prompts, raw commands, absolute paths, stable session/event/entry IDs, private refs, and source/command fingerprints. Both use exclusive `0600` publication. Private publishes first; a valid private-only interruption is retryable, while orphan reader, collision mismatch, cross-project binding, unsafe path/mode, count reconciliation, or fingerprint failure fails closed. Reader loading always validates the private binding first, recomputes session/candidate/event totals from nested private sessions, and frozen `context.json` is not mutated. Reads and publications use no-follow descriptor-bound checks, fstat-before/after, inode/real-target/containment verification, safe-directory-chain revalidation, exclusive hard-link publication, and cleanup. The runtime fails closed when descriptor namespace verification is unavailable; portable Node does not provide fully descriptor-relative hard-link publication, so a same-user parent-directory swap between validation points remains a documented residual race rather than a transactional-security claim.
- Candidate-review attempts are append-only at the directory level: each same-run/mode invocation gets a collision-resistant, traversal-safe attempt ID. An exclusive `0600` pending receipt is durable before proposal writing and is finalized through a receipt-specific `0600`, fsynced atomic replace with temporary-file cleanup. Write/rename failure preserves the original pending receipt. The receipt binds to `runId` plus `selectedFingerprint`, retains bounded candidate counts/required-review data and structured `sourceFingerprint` evidence refs, stores decisions and project-relative asset digests/routes, and never rewrites frozen `context.json`. R-0001 signal audit contains only an allowlisted command class plus stable hash; other detector signals use finite allowlisted classifications. No excerpts, contents, raw command arguments, credentials, tokens, assignments, or raw paths enter the receipt.
- Agent-asset authority is `{ project: true, userHome: false }`. Applicable assets are only root/nested `AGENTS.md` and `wiki/**/_rules.md` ancestor chains for candidate owner routes; discovery never ascends above the real project root or visits siblings/descendants. File and directory symlinks are not followed.
- Asset opening is limited to regular files, 64 KiB per file, 256 KiB aggregate and 128 applicable assets. The runtime performs no-follow open, verifies the opened descriptor's real target, intended pathname/inode and project containment, reads bounded bytes through the fd, then repeats fstat and binding/containment checks. Static symlinks, intermediate-directory races, mutation, unreadable/oversized/invalid content, and count/aggregate limits make review partial. Strong verification currently depends on an OS descriptor namespace such as `/proc/self/fd` or `/dev/fd`; when unavailable or unverifiable, review fails closed.
- `AGENTS.md` content before the first H2—including H1-only or list-only files—is preserved as one opaque synthetic block and is never merged with later H2 sections. Wiki `_rules.md` preamble remains excluded. Only validated explicit rule IDs are public section IDs; all other headings/preambles use opaque digest IDs.
- Public candidate/review projections exclude asset contents, evidence excerpts, raw/session/cache absolute paths, user-home paths and source heading words. Project-relative asset routes and explicit/opaque section IDs are the only content locators exposed by this lane.
- Frozen session fingerprints cover provider, session id/private stable ref, header timestamp, file size/mtime, and project/workspace identity. The active session follows the same explicit-partial mutation policy as every selected session.
- Public authority records `rawSessionContent: false`, `userHomeAssets: false`, and `normalizedLookup: single-exact-ref`. The route-only `workspaceTarget` is `{ kind: "repo-root" | "standalone", route: ".", packageRoute: null, ownerRoute: "." }`; it contains no absolute paths and does not implement workspace-member topology.
- `projectEvidence()` is a separate project-only lane. It returns project-relative routes and bounded metadata for manifests, npm workspace/member detection, applicable instruction inventory, Git/index name-status data, CI presence/names, release/recovery leads, and source/test ownership leads. Its surface statuses distinguish `available`, `partial`, and `unavailable`; missing Git/manifest is not silently normalized away. It never executes project commands, opens external CI, reads user-home/session evidence, exposes unsafe script bodies, or treats presence as exercise/pass/acceptance.
- The Project Evidence lane's `workspace-member` target is an evidence-scope hint only. It does not replace the route-only analysis-run target or implement full workspace topology, owner binding, or sibling rejection.
- `agentAssets()` is the current additive Agent Asset Evidence candidate. It inventories project `AGENTS.md`/`wiki/**/_rules.md` ancestry through the existing secure reader, `.pi/agent/model-prompts/*.md`, and explicitly declared project-local `skills`/`extensions` from root `package.json` Pi declarations or `.pi/settings.json`. Its projection contains only project-relative presence/configuration, section IDs, per-surface `complete`/`partial`/`failed` status, bounded counts, and safe diagnostics. It does not inspect user-home assets, undocumented MCP/external package roots, raw sessions, auth, payload logs, `.env`, or private Harness evidence, and it makes no selection/use/exercise/outcome claim.
- `src/safety/redaction.js` redacts common API keys/tokens, bearer headers, sensitive assignments, long opaque tokens, sensitive object keys, and sensitive paths such as `.env`, Pi auth stores, Pi sessions, and `.pi/logs/llm-payloads/`.
- `writeSessionCache()` records redaction-enabled metadata and writes normalized artifacts to harness home.
- The Pi extension tells `/harness-improve` to use only normalized evidence and to call `harness_import_llm_reflection` with JSON proposals instead of responding in prose.

Future changes should preserve these boundaries. Do not read raw session logs, auth files, or payload logs unless the user explicitly asks and the task requires it.

## Reports and reflection proposals

Important API functions in `src/api.js`:

- `analysisRun()` creates the public frozen-run contract. `report()`, `reflect()`, and `taskEpisodes()` accept that object through `options.analysisRun`; legacy calls create a compatibility run internally.
- `projectEvidence()` and `agentAssets()` are additive synchronous APIs for independent static project-only evidence lanes. They have no findings, report, proposal, automation, or extension-UI wiring and do not write a private or repository artifact.
- `taskEpisodes()` is itself the opt-in switch: it consumes with independent consumer name `task-episodes`, persists the two run artifacts, and returns only the reader projection with bounded run/count binding. It has no config feature-gate semantics and is not wired into current report/proposal/automation/extension behavior.
- `report()` consumes unchanged sessions from the frozen selection, writes cache, creates a Markdown project report, and writes `reports/latest.md`. Its JSON payload also includes the same frozen session list used by `/harness`, so the dashboard does not make a second session-discovery call.
- `reflect()` consumes unchanged sessions from the frozen selection and writes a redacted reflection prompt with evidence references.
- Both artifacts render a bounded run summary containing run ID, selected fingerprint, selected/accepted/skipped counts, consumer status, and explicit partial or observed-empty scope text.
- `importReflectionResponse()` converts a model response with `{ proposals: [...] }` into draft proposal Markdown files.
- `propose({ rules: true })` reviews all R-0001 through R-0004 CandidateSignals. `target=rules` selects R-0001/R-0002, `target=parser` selects R-0004, and `target=redaction` selects R-0003 through the same detector/reviewer/promoter path; the former duplicate targeted producers are removed.
- Deterministic proposal results keep `written`/`skipped`, define `candidates` as the CandidateSignal count, and add promoted/deferred/rejected counts plus privacy-safe `candidateSignals`, `decisions`, and agent-asset summaries. Promoted proposal frontmatter adds candidate ID, detector ID, and review fingerprint without changing legacy proposal sections/lifecycle. Review fingerprints bind inspected asset digests; proposal fingerprints separately bind stable candidate/repair identity and therefore remain stable across unrelated non-covering asset edits.
- Exact-edit coverage requires oldText/exact-edit, inspect-current-block, exact whitespace/punctuation, and unique-match concepts in one applicable block, independent of rule ID. Applicable Wiki content uses H2 blocks; applicable AGENTS preamble is its own opaque block. Scattered concepts do not match; deterministic near-matches are ambiguous and defer. Existing `GLOBAL-EDIT-001` therefore defers R-0002 as `existing-coverage` with `observedUse: "unobserved"` and writes no duplicate proposal.
- R-0003 remains a review lead and defers without an observed authorization/exposure consequence. R-0004 can promote only mapped warning codes with distinct structured evidence refs, a concrete deterministic consequence, existing project-relative package owners, bounded repair, validation route, and project authority.
- `target=rules` still means reviewed Markdown guidance in `wiki/**/_rules.md`; detector defaults and coverage signatures remain executable runtime code and never come from parsing prompt prose.

The Pi extension command `/harness-improve` bridges runtime and current Pi model by reading the generated reflection prompt and sending a follow-up user message that instructs the model to call `harness_import_llm_reflection`. LLM reflection/import, `target=memory`, and automation eval-fixture drafts remain outside this deterministic semantic gate; writer fingerprints only deduplicate identical fingerprints and do not solve semantic duplication on those residual paths.

## Proposal lifecycle and controlled apply

`src/proposals/lifecycle.js` implements proposal status transitions and controlled patch apply:

- `approveProposal()` and `rejectProposal()` update proposal frontmatter and append history.
- `applyProposal()` requires approved status, parses target files and a JSON `## Patch` section, requires a clean git worktree unless allowed, checks out/creates branch `harness/<proposal-id>`, applies text patches only to listed target files, and optionally commits.
- Apply snapshots original target content transactionally. If prompt-rule lint fails after a `_rules.md` patch, original content is restored and apply fails before commit.
- `rollbackProposal()` reverts an applied commit when present or checks out the recorded changed paths if the apply was uncommitted.
- Proposal history is written as JSONL under the private harness project cache.

This lifecycle is intentionally conservative. Keep target-file enforcement, git checks, and history writing intact when changing apply behavior.

## Eval and automation

`src/eval/eval-harness.js` defines built-in deterministic scenarios:

```txt
redaction-fixture
parser-unknown-entry
edit-oldText-workflow
existing-coverage-before-proposal
file-protection
smart-commit-basic
ts-extension-safety
wiki-prompt-rule-file-protection
wiki-prompt-rule-section-routing
wiki-prompt-rule-lazy-loading
harness-wiki-command-surface
```

The eval runner writes JSON and Markdown reports under the harness project's `evals/` directory. It checks redaction, parser resilience, rule generation, file protection, controlled apply, and TypeScript extension safety.

Automation is gated by config and disabled by default. Runtime and README evidence say automation can scan/report/draft/eval, but does not apply, commit, push, or bypass the normal normalized scan path. When any scan/report/propose stage is enabled, `automate()` freezes one run and passes it to every session-consuming stage. Top-level and per-action output expose the shared run ID and selected fingerprint for audit; deterministic proposal actions additionally expose promoted/deferred/rejected counts. Eval/status stages do not consume the run.

## Change guidance

- For general Harness command wording or UI behavior, edit `packages/pi-learn-extensions/extensions/harness/index.ts`.
- For Harness Wiki behavior/prompt, edit `harness/wiki-commands.ts` and `harness/wiki-prompt.ts`; preserve lazy rule loading and reserved-file protection.
- For parsing, caching, project evidence, reports, reflection, proposals, eval, or automation behavior, edit `packages/harness-runtime/src/**` and add/update tests in `packages/harness-runtime/tests/**`.
- Run harness runtime tests from `packages/harness-runtime/` with `npm test`.
- For security-sensitive changes, add/adjust tests around redaction, file protection, and proposal lifecycle.
- Review `pi-harness/` design docs when making larger architecture changes; they capture roadmap and session-format intent beyond the code.
