# Pi Harness implementation status

> **Canonical completed/remaining tracker.** Use this page for the current Better Harness slice status, publication state, evidence, risks, and next decision. The design contracts remain in the linked source-of-truth documents below.

**Snapshot:** Slice 3 was published in `35cf1c1976a75467583ad4557ba0287325981441`, Project Evidence was published at `a8e7701289819395875be693d37105971d7c6f29`, and the Agent Asset Evidence Lane was published at `f67cea8`. The bounded Evidence State + Findings slice below is the current uncommitted working-tree candidate based on `f67cea8`.

## Status at a glance

| Slice / capability | Status | Commit / working tree | Evidence | Risks / limits | Next action |
|---|---|---|---|---|---|
| Slice 1 — Frozen Analysis Run | **Completed — published** | `cb40fa4616ab6a3bd0f3a5760d99a74fb08c0ce4` | Frozen analysis-run contract, shared population, fingerprints, and report/reflection binding were verified at publication. | Population freezing changes orchestration and must remain revision-bound. | Preserve compatibility paths while later lanes build on it. |
| Slice 2 — Existing Coverage Before Proposal | **Completed — published** | `96167736f86aafe662d0ecc876fc7d337a581daa` | The narrow project Rules/AGENTS coverage gate, protected-path checks, and duplicate-prevention behavior were verified at publication. | This is not full project evidence, full workspace topology, or full Agent Asset evidence. | Keep the coverage-before-proposal gate and its `GLOBAL-EDIT-001` behavior. |
| Slice 2 baseline — project Rules/AGENTS coverage | **Done — narrow baseline** | Published as part of `9616773...` | Applicable project `AGENTS.md` and `wiki/**/_rules.md` ancestor inventory/content coverage is used before deterministic proposal promotion. | Do not expand this row into a claim of full workspace or asset coverage. | Keep it as the existing instruction-coverage baseline. |
| Slice 3 — Task Episode candidate lane | **Completed — published** | `35cf1c1976a75467583ad4557ba0287325981441` | Active-path, session-bounded candidate segmentation, conservative change/validation linkage, explicit marks, reader-safe artifacts, and partial-coverage handling were published. | Candidates are not semantic one-goal episodes; session-end delivery remains unobserved. Findings, report/TUI projection, automation, and extension UI are not wired to this lane. | Treat Slice 3 as the published session-evidence foundation. |
| Project Harness Evidence Lane | **Implemented — published** | `a8e7701289819395875be693d37105971d7c6f29` | `projectEvidence(options)` and bounded fixtures cover manifests/npm workspaces, scoped instructions, filesystem-only Git name/status metadata, CI names, release/recovery leads, ownership leads, and explicit partial/unavailable diagnostics. | Static presence is not execution, pass, acceptance, agent use, or finding evidence. Gitfile/external metadata and unsupported/unsafe paths remain partial; Git status is bounded metadata-based. | Preserve this independent published lane while the next asset/topology decision is reviewed. |
| Full workspace/owner topology | **Incomplete** | Existing `analysisRun()` target remains route-only | Project Evidence can identify an npm workspace member for evidence scoping, but no complete owner graph, apply binding, or sibling-owner rejection exists. | Do not claim full topology from the member hint. | Scope separately only if evidence justifies it. |
| Agent Asset Evidence Lane | **Completed — published** | `f67cea8` | `agentAssets(options)` returns a reader-safe `pi-harness.agent-assets` projection for applicable instructions, project model prompts, and explicitly declared project-local skills/extensions/config. Focused fixtures cover discovery, ancestry, scope separation, malformed/oversized/symlinked assets, bounded declarations, and empty surfaces. | Presence/configuration only; no user-home/MCP/external package roots, raw/private evidence, content projection, or selection/use/exercise/outcome claim. Full workspace/owner topology and broader asset types remain out of scope. | Preserve this independent project-only lane. |
| P1 — Evidence State + Findings ledger | **Implemented — current uncommitted candidate** | Based on `f67cea8`; local working tree, no commit/push | Exact seven-state constants/normalization, schema-1 `F-####` validation, deterministic dedupe, revisioned latest/history persistence, owner-only private storage, fail-closed tamper handling, and reader-safe projection are covered by focused findings fixtures. | Caller-supplied only: no detector inference, score, session/asset reads, proposal linkage, report/TUI, validation receipts, automation, or UI. Proposal refs do not promote finding state. | Review this bounded P1 candidate before any linkage or projection slice. |

## What is implemented in the Project Harness Evidence Lane

The lane is an additive, synchronous runtime API. It returns `kind: "pi-harness.project-evidence"` and a reader-safe projection with:

- bounded root/member `package.json` metadata, runtime manifest/pin presence, npm workspace patterns, and member routes;
- manifest script leads plus reviewed argv-safe identities for simple validation/delivery routes; unsafe shell bodies remain opaque;
- scoped applicable `AGENTS.md`/`wiki/**/_rules.md` surfaces through the existing project-only safe asset inventory;
- filesystem-only Git/index name-status metadata scoped to the selected workspace target;
- CI workflow presence/names without opening CI externally;
- release/recovery documentation leads and source/test ownership paths;
- overall and per-surface `available`, `partial`, or `unavailable` states, including missing Git and missing package manifest;
- an explicit static boundary stating that no project commands/scripts/network/CI were executed or opened and that presence does not prove exercise, pass, or acceptance.

The collector reads no user-home configuration, raw/private session evidence, or external CI. It does not create findings, proposals, reports, automation actions, or extension UI. Routes are project-relative and bounded; traversal, symlink escapes, sensitive paths, arbitrary manifest fields, command output, and unsafe script bodies are omitted or downgraded to diagnostics.

## What is implemented in the published Agent Asset Evidence Lane

The candidate is an additive, synchronous `agentAssets(options)` API. It returns `kind: "pi-harness.agent-assets"` with:

- the existing descriptor-bound applicable `AGENTS.md`/`wiki/**/_rules.md` instruction inventory, including opaque section IDs and ancestor applicability;
- project-only `.pi/agent/model-prompts/*.md` presence;
- explicitly declared project-local `skills` and `extensions` from the root `package.json` Pi manifest or `.pi/settings.json`;
- safe project configuration presence, per-surface `complete`/`partial`/`failed` status, bounded counts, and project-relative diagnostics;
- authority `{ project: true, userHome: false }` plus an explicit presence/configuration-only boundary.

The candidate never reads user-home assets, undocumented MCP or external package roots, raw sessions, auth, payload logs, `.env`, or private Harness evidence. It does not expose asset content or absolute paths and is not wired to findings, reports, proposals, automation, or Pi UI.

## Remaining work, in roadmap order

### Next implementation decision

Review the current bounded P1 Evidence State + Findings candidate next. Keep workspace/owner topology, proposal linkage, and verified repair as separate follow-up decisions. Static project/agent asset presence remains inventory evidence and is never promoted into a finding automatically.

### P1 — Findings and verified repair

The current candidate implements items 1–2 only:

1. Evidence states: `Present`, `Wired`, `Exercised`, `Outcome-supported`, `Missing`, `Unobserved`, and `Not-applicable`.
2. A caller-supplied Findings ledger with stable finding identity and evidence/owner/acceptance fields.

Remaining P1 work is deliberately separate:

3. Proposal-to-finding linkage, including revision binding and legacy proposal compatibility.
4. Findings-backed Markdown and Pi TUI projections.
5. Structured validation receipts from reviewed/allowlisted validation routes.
6. Explicit applied-versus-verified state, including partial/blocked outcomes.
7. Stale revision/workspace protection.
8. Independent post-fix review where useful, without turning it into a new finding or a later-outcome claim.

### P2 — Longitudinal learning

- Intervention ledger bound to the finding and applied revision.
- Comparable follow-up Task Episodes/windows.
- Conservative improved/unchanged/regressed or insufficient-evidence decisions with guardrails.

### P3 — Optional, evidence-led extensions

- Scores and calibration.
- Multi-agent specialist review.
- HTML/shareable report projection.
- Additional hosts/providers.
- Retention cleanup, only after an auditable retention contract exists.

## Evidence and verification record

### Published slices

- **Slice 1:** `cb40fa4616ab6a3bd0f3a5760d99a74fb08c0ce4` published the frozen analysis-run foundation, followed by the documented docs refresh at `547d041`.
- **Slice 2:** `96167736f86aafe662d0ecc876fc7d337a581daa` published the existing-coverage gate and narrow project Rules/AGENTS baseline.
- **Slice 3:** `35cf1c1976a75467583ad4557ba0287325981441` published the Task Episode candidate lane. No unsupported historical test total is asserted here.

### Published Agent Asset Evidence lane

The candidate verification record includes:

```txt
node --test packages/harness-runtime/tests/agent-assets.test.js
npm --prefix packages/harness-runtime test
node --check on changed JavaScript
git diff --check
git status --short
git diff HEAD -- 'wiki/**/_rules.md'  → empty
```

The published lane contains only runtime/tests/docs needed for that project-only capability. No protected prompt-rule changes are part of it.

### Current P1 Evidence State + Findings candidate

The current local slice adds `EVIDENCE_STATES`, `normalizeEvidenceState()`, `writeFindings()`, and `readFindings()` from `packages/harness-runtime/src/api.js`. The canonical owner is `packages/harness-runtime/src/findings/`. Private schema-1 records are keyed by stable `F-####` identity, retain explicit evidence state/status/confidence/target/acceptance fields, merge multiple proposal references without changing state, and increment per-finding revisions for changed records. `findings/latest.json` and append-only `findings/history.jsonl` are private owner-only artifacts under the configured Harness project key; public results are bounded reader projections without paths, private locators, raw evidence, prompts, or commands.

The candidate verification record includes:

```txt
node --test packages/harness-runtime/tests/findings.test.js
npm --prefix packages/harness-runtime test
node --check on changed JavaScript
git diff --check
git diff HEAD -- 'wiki/**/_rules.md'  → empty
```

It deliberately contains no detector/finding generation, proposal linkage, report/TUI projection, validation receipt, automation, extension UI, session read, user-home asset read, or private evidence import.

## Scope boundaries and non-goals

- No raw sessions, normalized private evidence, auth data, `.env`, payload logs, or private Harness artifacts are stored in the repository.
- No `wiki/**/_rules.md` file is edited by this tracker task.
- No automatic commit, push, merge, force-push, deploy, or apply is implied.
- Project and Agent Asset Evidence remain static mechanism inventories, not test runners, CI clients, acceptance checkers, or automatic finding generators. The new Findings API stores only caller-supplied records and does not infer findings from either lane or session counts.
- No full workspace topology, broader undocumented asset lane, LLM semantic grouping, or semantic one-goal Task Episode claim is made.
- Static script/CI/documentation/ownership presence does not prove agent read/use, exercise, pass, acceptance, repair verification, or later improvement.

## Source-of-truth documents

- [Better Harness comparison and improvement plan](./better-harness-comparison-and-improvement-plan.md) — evidence lanes, slice definitions, P0–P3 backlog, and design contracts.
- [Roadmap](./roadmap.md) — phase sequencing and current-status pointer.
- [Plan](./plan.md) — overall Harness direction and safety model.
- [Harness runtime README](../packages/harness-runtime/README.md) — implemented API and privacy boundaries.
- [Harness runtime architecture wiki](../wiki/architecture/harness-runtime.md) — package ownership, storage, privacy, and verification boundaries.

## How to update this tracker

After each slice, update this page with:

1. status and publication state;
2. commit (or explicit local candidate state);
3. tests and other verification actually observed;
4. changed paths and protected-path audit;
5. risks, known semantic limits, and the next decision/action.

Keep raw sessions, private normalized evidence, private Harness artifacts, and secret-bearing output out of the repository. Documentation links may point to private-artifact contracts, but must not copy private evidence or absolute private storage paths.
