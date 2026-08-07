# Pi Harness implementation status

> **Canonical completed/remaining tracker.** Use this page for the current Better Harness slice status, publication state, evidence, risks, and next decision. The design contracts remain in the linked source-of-truth documents below.

**Snapshot:** The reviewed candidate is based on `6baa3fcbabd880bb1b854d5440332312615d4a4c`. Slice 3 was already published in `35cf1c1976a75467583ad4557ba0287325981441`. The Project Harness Evidence Lane is a local candidate and has not been pushed.

## Status at a glance

| Slice / capability | Status | Commit / working tree | Evidence | Risks / limits | Next action |
|---|---|---|---|---|---|
| Slice 1 — Frozen Analysis Run | **Completed — published** | `cb40fa4616ab6a3bd0f3a5760d99a74fb08c0ce4` | Frozen analysis-run contract, shared population, fingerprints, and report/reflection binding were verified at publication. | Population freezing changes orchestration and must remain revision-bound. | Preserve compatibility paths while later lanes build on it. |
| Slice 2 — Existing Coverage Before Proposal | **Completed — published** | `96167736f86aafe662d0ecc876fc7d337a581daa` | The narrow project Rules/AGENTS coverage gate, protected-path checks, and duplicate-prevention behavior were verified at publication. | This is not full project evidence, full workspace topology, or full Agent Asset evidence. | Keep the coverage-before-proposal gate and its `GLOBAL-EDIT-001` behavior. |
| Slice 2 baseline — project Rules/AGENTS coverage | **Done — narrow baseline** | Published as part of `9616773...` | Applicable project `AGENTS.md` and `wiki/**/_rules.md` ancestor inventory/content coverage is used before deterministic proposal promotion. | Do not expand this row into a claim of full workspace or asset coverage. | Keep it as the existing instruction-coverage baseline. |
| Slice 3 — Task Episode candidate lane | **Completed — published** | `35cf1c1976a75467583ad4557ba0287325981441` | Active-path, session-bounded candidate segmentation, conservative change/validation linkage, explicit marks, reader-safe artifacts, and partial-coverage handling were published. | Candidates are not semantic one-goal episodes; session-end delivery remains unobserved. Findings, report/TUI projection, automation, and extension UI are not wired to this lane. | Treat Slice 3 as the published session-evidence foundation. |
| Project Harness Evidence Lane | **Implemented — local candidate** | Based on `6baa3fcbabd880bb1b854d5440332312615d4a4c`; local only, no push | `projectEvidence(options)` and bounded fixtures cover manifests/npm workspaces, scoped instructions, filesystem-only Git name/status metadata, CI names, release/recovery leads, ownership leads, and explicit partial/unavailable diagnostics. | Static presence is not execution, pass, acceptance, agent use, or finding evidence. Gitfile/external metadata and unsupported/unsafe paths remain partial; Git status is bounded metadata-based. | Review and publish this bounded lane, then make the next topology/Agent Asset versus P1 sequencing decision. |
| Full workspace/owner topology | **Incomplete** | Existing `analysisRun()` target remains route-only | Project Evidence can identify an npm workspace member for evidence scoping, but no complete owner graph, apply binding, or sibling-owner rejection exists. | Do not claim full topology from the member hint. | Scope separately only if evidence justifies it. |
| Full Agent Asset Evidence Lane | **Incomplete** | Existing safe project-agent-assets inventory is reused where applicable | The current inventory safely reads bounded applicable project assets for instruction coverage; it is not the full rules/skills/prompts/extensions/tools/hooks lane. | No user-home asset reads; no full asset topology or use/outcome claim. | Keep separate from Project Evidence and sequence conservatively. |

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

## Remaining work, in roadmap order

### Next implementation decision

Review and publish the bounded Project Harness Evidence Lane first. After that review, choose one narrowly scoped follow-up:

1. strengthen workspace/owner topology and apply binding; or
2. complete the separate Agent Asset Evidence baseline; or
3. proceed to P1 evidence states and Findings only after confirming the required topology/asset boundaries are sufficient.

This decision must not be made by treating static Project Evidence presence as a defect, execution result, acceptance result, or finding.

### P1 — Findings and verified repair

Implement, in the roadmap order:

1. Evidence states: `Present`, `Wired`, `Exercised`, `Outcome-supported`, `Missing`, `Unobserved`, and `Not-applicable`.
2. A Findings ledger with stable finding identity and evidence/owner/acceptance fields.
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

### Current Project Evidence candidate

The candidate verification record includes:

```txt
node --test packages/harness-runtime/tests/project-evidence.test.js
npm --prefix packages/harness-runtime test
node --check on changed JavaScript
git diff --check
git status --short
git diff HEAD -- 'wiki/**/_rules.md'  → empty
```

The candidate contains only runtime/tests/docs needed for this lane. No private/raw session evidence, user-home assets, findings ledger, automation wiring, Pi TUI/extension UI, or protected prompt-rule changes are part of it.

## Scope boundaries and non-goals

- No raw sessions, normalized private evidence, auth data, `.env`, payload logs, or private Harness artifacts are stored in the repository.
- No `wiki/**/_rules.md` file is edited by this tracker task.
- No automatic commit, push, merge, force-push, deploy, or apply is implied.
- Project Evidence is static mechanism inventory, not a test runner, CI client, acceptance checker, findings ledger, or defect/age/hotspot classifier.
- No full workspace topology, full Agent Asset lane, LLM semantic grouping, or semantic one-goal Task Episode claim is made.
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
