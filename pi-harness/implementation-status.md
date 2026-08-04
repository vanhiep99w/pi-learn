# Pi Harness implementation status

> **Canonical completed/remaining tracker.** Use this page for the current Better Harness slice status, publication state, evidence, risks, and next decision. The design contracts remain in the linked source-of-truth documents below.

**Snapshot:** `HEAD` and `origin/main` are `96167736f86aafe662d0ecc876fc7d337a581daa`. The working tree intentionally retains the unpublished Slice 3 implementation. This documentation-only update does not commit, push, stage, reset, or discard those changes.

## Status at a glance

| Slice / capability | Status | Commit / working tree | Evidence | Risks / limits | Next action |
|---|---|---|---|---|---|
| Slice 1 — Frozen Analysis Run | **Completed — published** | `cb40fa4616ab6a3bd0f3a5760d99a74fb08c0ce4` | Frozen analysis-run contract, shared population, fingerprints, and report/reflection binding were verified at publication. The focused/full runtime evidence is recorded in the publication history; no unsupported historical test count is repeated here. | Population freezing changes orchestration and must remain revision-bound. | Treat as the published foundation; preserve compatibility paths while later lanes build on it. |
| Slice 2 — Existing Coverage Before Proposal | **Completed — published** | `96167736f86aafe662d0ecc876fc7d337a581daa` | `138/138` runtime tests before Slice 3, plus protected-path and diff checks, as recorded by the verified pre-Slice-3 handoff. | This is a narrow project Rules/AGENTS coverage baseline, not full project evidence or full agent-asset evidence. | Keep the coverage-before-proposal gate and its `GLOBAL-EDIT-001` duplicate-prevention behavior. |
| Slice 2 baseline — project Rules/AGENTS coverage | **Done — narrow baseline** | Published as part of `9616773...` | Applicable project `AGENTS.md` and `wiki/**/_rules.md` inventory/content coverage is used before deterministic proposal promotion. | Full Project Harness Evidence Lane and full Agent Asset Evidence Lane remain distinct and incomplete. | Do not expand this row into a claim of full workspace topology or full asset coverage. |
| Slice 3 — Task Episode candidate lane | **Implemented — unpublished** | Working tree only; **no commit and no push**. The direct path audit classifies **12 pre-tracker dirty runtime/test/doc files**: runtime README, API, normalization, warnings, Task Episode builder, Task Episode writer, five tests, and the architecture wiki page. With the two tracker docs, the current total is 14 dirty paths. All existing Slice 3 changes must remain untouched. | Direct runtime suite: `184 passed, 0 failed`. Relevant JavaScript syntax checks, `git diff --check`, and the protected `_rules.md` audit were verified by the supervisor. | Candidates are user-turn candidates, **not semantic one-goal episodes**. Coverage remains session-bounded and conservative; lexical topology/scope correlation is residual. Private-first `private.json`/`reader.json` publication is recoverable but is not an atomic two-file transaction; a distinct residual same-user parent-directory swap race exists around pathname-based hard-link publication because portable Node lacks fully descriptor-relative link publication. Findings, report/TUI projection, automation, and extension UI are not wired to this lane. | Review the dirty implementation, then explicitly commit and push Slice 3 when approved; publication is not automatic. |

## What is actually implemented in Slice 3

The unpublished lane adds an opt-in `taskEpisodes()` API and private run artifacts for bounded Task Episode **candidates**. It includes:

- active-path, session-bounded user-turn candidates that never merge;
- conservative change linkage for matched successful `edit`/`write` activity;
- conservative validation linkage for allowlisted observed checks;
- explicit `harness-mark` success/failure closure candidates;
- `unobserved` session-end/delivery semantics rather than inferred success;
- separate private and reader-safe artifacts with deterministic aliases and reconciliation checks;
- warning/partial-coverage handling for malformed or ambiguous normalized evidence.

The current runtime README and architecture page document the exact privacy and integrity boundaries, including two separate publication limitations:

- Private-first `private.json`/`reader.json` publication is recoverable by exact replay after a private-only interruption, but it is not an atomic two-file transaction.
- A residual same-user parent-directory swap race exists around pathname-based hard-link publication because portable Node lacks fully descriptor-relative link publication.

Those limitations are tracked here rather than hidden behind a stronger semantic claim.

## Remaining work, in roadmap order

### Immediate — publish the current slice

1. Review the unpublished Slice 3 diff and its changed paths.
2. Run/confirm the required checks against the intended revision.
3. Commit Slice 3 only after review and explicit approval.
4. Push only after explicit approval. Neither commit nor push is automatic.

### Next implementation decision

Choose and sequence the next bounded capability before starting P1 Findings work:

- implement the bounded **Project Harness Evidence Lane** first (static, read-only project instructions, manifests/scripts, scoped change metadata, validation/delivery leads); and/or
- make an explicit sequencing decision about whether to proceed directly toward P1 Findings after Slice 3 publication.

Do **not** describe full workspace topology, a full Project Evidence Lane, or a full Agent Asset Evidence Lane as implemented. Slice 2's narrow project Rules/AGENTS coverage baseline is complete; those broader lanes are not.

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

- **Slice 1:** `cb40fa4616ab6a3bd0f3a5760d99a74fb08c0ce4` published the frozen analysis-run foundation, followed by the documented docs refresh at `547d041`. Exact historical focused/full test totals are intentionally not restated without a safe repository source.
- **Slice 2:** `96167736f86aafe662d0ecc876fc7d337a581daa` is published and was verified at `138/138` runtime tests before Slice 3, with protected-path and diff checks.

### Current unpublished slice

Supervisor-reported direct verification for the Slice 3 working tree:

```txt
npm --prefix packages/harness-runtime test  → 184 passed, 0 failed
node --check relevant JavaScript             → passed
git diff --check                            → passed
wiki/**/_rules.md diff                      → empty
extension/manifest/lockfile/plan changes    → none
```

This is evidence for the implementation and its focused tests, not evidence that Slice 3 has been published. The required publication decision remains open.

## Scope boundaries and non-goals

The tracker and current Slice 3 preserve these constraints:

- No raw sessions or private Harness evidence are stored in the repository.
- No `wiki/**/_rules.md` file is edited by this tracker task.
- No automatic commit or push.
- No Findings ledger, full workspace topology, or LLM semantic grouping in Slice 3.
- No claim that a user turn is a semantic one-goal Task Episode.
- No claim that project/agent-asset inventory proves use, outcome, or repair verification.
- No automatic inference that apply, a self-mark, or a passing check proves delivery acceptance or later improvement.

## Source-of-truth documents

- [Better Harness comparison and improvement plan](./better-harness-comparison-and-improvement-plan.md) — evidence lanes, slice definitions, P0–P3 backlog, and design contracts.
- [Roadmap](./roadmap.md) — phase sequencing and current-status pointer.
- [Plan](./plan.md) — overall Harness direction and safety model.
- [Harness runtime README](../packages/harness-runtime/README.md) — implemented API, private artifacts, and Slice 3 limitations.
- [Harness runtime architecture wiki](../wiki/architecture/harness-runtime.md) — package ownership, storage, privacy, and verification boundaries.

## How to update this tracker

After each slice, update this page with:

1. status and publication state;
2. commit (or explicit working-tree/unpublished state);
3. tests and other verification actually observed;
4. changed paths and protected-path audit;
5. risks, known semantic limits, and the next decision/action.

Keep raw sessions, private normalized evidence, private Harness artifacts, and secret-bearing output out of the repository. Documentation links may point to private-artifact contracts, but must not copy private evidence or absolute private storage paths.
