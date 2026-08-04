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
7. **Generate outputs** — report, reflection, proposal, eval, or automation functions consume normalized session results.

Representative source files:

- `src/api.js` — public runtime API and orchestration
- `src/analysis/analysis-run.js` — frozen population contract, deterministic fingerprints, private context, and mutation validation
- `src/config/load-config.js` — default/global/project config merge
- `src/session/parse-session.js` — JSONL parser and entry summaries
- `src/session/tree.js` — conversation/session tree handling
- `src/normalize/events.js` and `src/normalize/content.js` — normalized event/content representation
- `src/storage/cache-writer.js` — writes manifest/events/metrics/warnings cache files
- `src/report/report.js` — Markdown report generation
- `src/reflection/reflection.js` — redacted reflection prompt and response-to-proposal conversion
- `src/proposals/*` — draft proposal writing and lifecycle
- `src/eval/eval-harness.js` — deterministic eval scenarios
- `src/analysis/rules.js` — built-in deterministic detector implementations/defaults
- `src/analysis/wiki-prompt-rules.js` — `_rules.md` discovery, classification, scaffolding, and lint; it does not configure detectors

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
│   └── consumers/<consumer>.json
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
- Consumer status is stored in per-consumer atomic receipts. Concurrent report and reflection consumers therefore retain separate audit records.
- Frozen session fingerprints cover provider, session id/private stable ref, header timestamp, file size/mtime, and project/workspace identity. The active session follows the same explicit-partial mutation policy as every selected session.
- Public authority records `rawSessionContent: false`, `userHomeAssets: false`, and `normalizedLookup: single-exact-ref`. The route-only `workspaceTarget` is `{ kind: "repo-root" | "standalone", route: ".", packageRoute: null, ownerRoute: "." }`; it contains no absolute paths and does not implement workspace-member topology.
- `src/safety/redaction.js` redacts common API keys/tokens, bearer headers, sensitive assignments, long opaque tokens, sensitive object keys, and sensitive paths such as `.env`, Pi auth stores, Pi sessions, and `.pi/logs/llm-payloads/`.
- `writeSessionCache()` records redaction-enabled metadata and writes normalized artifacts to harness home.
- The Pi extension tells `/harness-improve` to use only normalized evidence and to call `harness_import_llm_reflection` with JSON proposals instead of responding in prose.

Future changes should preserve these boundaries. Do not read raw session logs, auth files, or payload logs unless the user explicitly asks and the task requires it.

## Reports and reflection proposals

Important API functions in `src/api.js`:

- `analysisRun()` creates the public frozen-run contract. `report()` and `reflect()` accept that object through `options.analysisRun`; legacy calls create a compatibility run internally.
- `report()` consumes unchanged sessions from the frozen selection, writes cache, creates a Markdown project report, and writes `reports/latest.md`. Its JSON payload also includes the same frozen session list used by `/harness`, so the dashboard does not make a second session-discovery call.
- `reflect()` consumes unchanged sessions from the frozen selection and writes a redacted reflection prompt with evidence references.
- Both artifacts render a bounded run summary containing run ID, selected fingerprint, selected/accepted/skipped counts, consumer status, and explicit partial or observed-empty scope text.
- `importReflectionResponse()` converts a model response with `{ proposals: [...] }` into draft proposal Markdown files.
- `propose()` can run the deterministic rule engine or targeted improvement generation for `memory`, `rules`, `parser`, or `redaction`.
- `target=rules` now means reviewed Markdown prompt guidance in `wiki/**/_rules.md`; deterministic detector behavior/default changes target runtime analysis source and tests.

The Pi extension command `/harness-improve` bridges runtime and current Pi model by reading the generated reflection prompt and sending a follow-up user message that instructs the model to call `harness_import_llm_reflection`.

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
file-protection
smart-commit-basic
ts-extension-safety
wiki-prompt-rule-file-protection
wiki-prompt-rule-section-routing
wiki-prompt-rule-lazy-loading
harness-wiki-command-surface
```

The eval runner writes JSON and Markdown reports under the harness project's `evals/` directory. It checks redaction, parser resilience, rule generation, file protection, controlled apply, and TypeScript extension safety.

Automation is gated by config and disabled by default. Runtime and README evidence say automation can scan/report/draft/eval, but does not apply, commit, push, or bypass the normal normalized scan path. When any scan/report/propose stage is enabled, `automate()` freezes one run and passes it to every session-consuming stage. Top-level and per-action output expose the shared run ID and selected fingerprint for audit; eval/status stages do not consume the run.

## Change guidance

- For general Harness command wording or UI behavior, edit `packages/pi-learn-extensions/extensions/harness/index.ts`.
- For Harness Wiki behavior/prompt, edit `harness/wiki-commands.ts` and `harness/wiki-prompt.ts`; preserve lazy rule loading and reserved-file protection.
- For parsing, caching, reports, reflection, proposals, eval, or automation behavior, edit `packages/harness-runtime/src/**` and add/update tests in `packages/harness-runtime/tests/**`.
- Run harness runtime tests from `packages/harness-runtime/` with `npm test`.
- For security-sensitive changes, add/adjust tests around redaction, file protection, and proposal lifecycle.
- Review `pi-harness/` design docs when making larger architecture changes; they capture roadmap and session-format intent beyond the code.
