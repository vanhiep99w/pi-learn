# Pi Harness Roadmap

> Bổ sung và thay thế roadmap tổng quát trong [`plan.md`](./plan.md).
>
> Mục tiêu: mô tả **current status**, thứ tự triển khai thực tế, deliverables, Definition of Done, dependencies, và tiêu chí không được nhảy phase.

---

## 1. Current status — 2026-07-10

Trạng thái hiện tại của `pi-harness` trong repo này:

```txt
Status: Phase 8-11 Harness MVP plus Phase 12 Harness Wiki consolidation and Markdown prompt-rule plane implemented
Runtime implementation: packages/harness-runtime
CLI: removed; runtime is API-only and consumed by Pi extension
Pi extension: primary UX implemented under packages/pi-learn-extensions/extensions/harness/
Parser: implemented for full JSONL parse, tree, active path
Normalized cache: implemented for manifest/events/metrics/warnings
Report: implemented Markdown latest + dated report from normalized cache
Inspect: implemented `inspect --entry <id> --full` with redaction by default
Harness logging: implemented minimal runtime/self_improvement/error-capable JSONL logger
Rules engine: implemented MVP detectors for repeated bash failures, repeated tool errors, sensitive path access and parser warnings
Proposal writer: implemented private draft Markdown proposals with evidence refs, dedupe fingerprints, test and rollback plans
Memory drafts: implemented private `memory/draft.jsonl` writer for reviewed memory candidates
Targeted improvements: implemented `propose --target memory|rules|parser|redaction`; target=rules routes reviewed guidance to `wiki/**/_rules.md`, while detector changes target runtime code/tests
Pi wrapper: single public Harness entrypoint implements observability/proposal commands plus `/harness-wiki-init|update|ask|status`; legacy `/wiki-*` commands are removed
Prompt-rule plane: `AGENTS.md` → `wiki/quickstart.md` → root/section `_rules.md`; lazy model reads, no automatic full-rule injection or watcher/cache
Apply loop: controlled MVP implemented with approval, proposal history, target allowlist, git branch, transactional patch apply/rollback and post-apply prompt-rule lint
Eval loop: deterministic MVP implemented with private JSON/Markdown reports, including prompt-rule protection/routing/loading and command-surface scenarios
Gated automation: opt-in MVP implemented for scan/report/draft proposals/eval only; no apply/push
Reflection hardening: redaction strengthened for env/yaml/long opaque tokens; evidence selection caps one reason so safety evidence does not dominate; proposal import preserves evidence kind/reason and normalizes AGENTS-only target mismatches
Reflection target routing implemented: prompt includes explicit target routing guide, selected evidence includes likelyTargets/targetGuidance, and import preserves evidence kind/reason plus normalizes common AGENTS-only target mismatches
```

Docs/spec đã có:

```txt
pi-harness/
├── plan.md                         # plan tổng thể
├── session-log-format.md           # raw JSONL → normalized cache spec
├── runtime-and-improvement.md      # runtime tạo cache + memory/rules/parser improve
├── config.md                       # config spec
├── improvement-matrix.md           # signal → target → improvement mapping
├── harness-observability.md        # harness runtime/audit/error logs for self-improvement
├── extension-migration-plan.md     # plan chuyển primary UX từ CLI sang Pi extension
├── harness-wiki-integration-plan.md # Harness Wiki + domain-local prompt-rule design
└── roadmap.md                      # file này
```

Các quyết định đã chốt:

```txt
Raw Pi JSONL:
  ~/.pi/agent/sessions
  read-only, không rewrite, không commit

Harness private cache:
  ~/.pi/harness/projects/<project-key>/sessions/<session-id>/
  manifest.json / events.jsonl / metrics.json / warnings.jsonl

Scope phân tích:
  project → session → active path

Runtime:
  deterministic TypeScript/Node/Bun code tạo cache
  không dùng LLM để parse raw session

LLM:
  chỉ optional sau normalized data, để reflect/propose
  phải có target routing guide; không để model tự đoán target từ schema

Improve:
  evidence → proposal → review → apply → eval/test → commit/rollback

Package location:
  packages/harness-runtime

Package name:
  @pi-learn/harness-runtime

Runtime API:
  packages/harness-runtime/src/api.js

Primary commands:
  Pi slash commands in packages/pi-learn-extensions/extensions/harness/index.ts

Harness Wiki:
  packages/pi-learn-extensions/extensions/harness/wiki-commands.ts
  packages/pi-learn-extensions/extensions/harness/wiki-prompt.ts

Reviewed prompt rules:
  wiki/_rules.md
  wiki/<section>/_rules.md
  model lazy-loads via AGENTS/quickstart; deterministic detectors remain runtime code
```

Phase 0 đã tạo:

```txt
packages/harness-runtime/
├── package.json
├── README.md
├── src/
│   ├── api.js
│   ├── config/load-config.js
│   ├── project/project-key.js
│   ├── project/resolve-project.js
│   ├── storage/atomic-write.js
│   ├── storage/harness-home.js
│   └── utils/path.js
└── tests/
    ├── config.test.js
    └── project-key.test.js
```

Phase 1 đã tạo:

```txt
packages/harness-runtime/src/session/discover-sessions.js
packages/harness-runtime/tests/discover-sessions.test.js
```

Phase 2 đã tạo:

```txt
packages/harness-runtime/src/session/parse-session.js
packages/harness-runtime/src/session/tree.js
packages/harness-runtime/tests/parse-tree.test.js
```

Phase 3 đã tạo:

```txt
packages/harness-runtime/src/logging/logger.js
packages/harness-runtime/src/safety/redaction.js
packages/harness-runtime/src/safety/truncation.js
packages/harness-runtime/src/normalize/content.js
packages/harness-runtime/src/normalize/events.js
packages/harness-runtime/src/metrics/session-metrics.js
packages/harness-runtime/src/storage/cache-writer.js
```

Việc còn thiếu sau Phase 8/9 MVP:

```txt
- extend proposal history with richer review notes if needed
- add more target detectors for user corrections, .pi/logs staging, long sessions/compaction
- add more redaction fixtures if needed
- decide whether to add npm workspace wiring at root
- optionally implement show-cache command if still useful
```

Deferred/explicitly reserved until Phase 3+:

```txt
- Harness observability logs spec exists in `harness-observability.md`; minimal runtime logging is implemented, richer audit/apply/eval logs come later.
- `--redact` is backed by minimal redaction for cache/log outputs; `--no-redact` is reserved and does not disable cache/log redaction yet.
- `--active-path-only` / `--all-branches` are config-only until scan/report branch mode exists.
- Active leaf heuristic remains: last valid non-duplicate entry with id; confirm against Pi SessionManager behavior later.
- Discovery currently scans all JSONL headers before slicing --last; optimize with mtime pre-sort later if needed.
```

Khuyến nghị hiện tại:

```txt
Dùng Pi Harness extension làm primary UX.
Giữ runtime deterministic/testable và private evidence ngoài repository.
Dùng `wiki/**/_rules.md` cho reviewed prompt guidance, không cho detector config.
```

---

## 2. Roadmap update so với plan cũ

Plan cũ đúng hướng nhưng cần update thứ tự thực tế:

### Nên làm sớm hơn

```txt
- projectKey resolver
- private cache layout ~/.pi/harness
- manifest/events/metrics/warnings writer
- inspect full raw entry by rawRef
- warnings pipeline
- config precedence
```

### Nên làm muộn hơn

```txt
- Pi extension slash commands
- LLM reflection
- controlled apply
- auto-improvement
- dashboard/vector DB/background daemon
```

### Lý do

Nếu chưa có normalized cache ổn định thì:

```txt
- rules không có data sạch để chạy
- LLM reflection dễ leak raw logs
- proposals thiếu evidence refs
- extension chỉ là UI wrapper chưa có core đáng tin
```

Roadmap mới ưu tiên:

```txt
1. Spec lock
2. Runtime skeleton
3. Read-only parser/cache
4. Report/inspect
5. Rules/proposals
6. Pi extension wrapper
7. LLM reflection
8. Apply/eval
9. Gated automation
```

---

## 3. Phase -1 — Spec lock and decisions

### Mục tiêu

Chốt docs/spec đủ để bắt đầu code mà không đổi hướng liên tục.

### Deliverables

```txt
pi-harness/plan.md
pi-harness/session-log-format.md
pi-harness/runtime-and-improvement.md
pi-harness/config.md
pi-harness/improvement-matrix.md
pi-harness/roadmap.md
```

### Tasks

- [x] Tách docs vào folder `pi-harness/`.
- [x] Bỏ prefix `pi-harness-` khỏi tên docs.
- [x] Chốt raw JSONL read-only.
- [x] Chốt private cache `~/.pi/harness`.
- [x] Chốt 4 output files: `manifest/events/metrics/warnings`.
- [x] Chốt runtime deterministic, không LLM cho parser.
- [x] Chốt memory/rules/parser improve qua proposal.
- [x] Chốt config spec.
- [x] Chốt improvement matrix.
- [x] Quyết định package location đầu tiên: `packages/harness-runtime`.
- [x] Quyết định package name: `@pi-learn/harness-runtime`.
- [x] Quyết định CLI command name: `harness`.

### Definition of Done

- Các docs link qua lại đúng.
- Không còn mâu thuẫn về nơi lưu raw/cache/artifacts.
- User chọn được implementation location.

### Recommended decision

```txt
Implement core runtime trong folder/package riêng trước.
Sau khi ổn mới expose Pi extension trong packages/pi-learn-extensions.
```

---

## 4. Phase 0 — Runtime skeleton

### Mục tiêu

Tạo runtime CLI tối thiểu, chưa parse sâu.

### Deliverables

Nếu làm trong repo này:

```txt
packages/harness-runtime/
├── package.json
├── src/
│   ├── cli.ts
│   ├── project/
│   │   ├── resolve-project.ts
│   │   └── project-key.ts
│   ├── storage/
│   │   ├── harness-home.ts
│   │   └── atomic-write.ts
│   └── config/
│       └── load-config.ts
└── tests/
```

Hoặc nếu làm project riêng:

```txt
harness-runtime/
├── package.json
├── src/
└── tests/
```

### Commands

```bash
harness --help
harness doctor
harness config print
harness project resolve --project /home/hieptran/Desktop/pi-learn
```

### Tasks

- [x] Create package skeleton.
- [x] Add CLI entrypoint.
- [x] Implement config loading:
  ```txt
  CLI flags > project config > global config > built-in defaults
  ```
- [x] Implement `~` expansion and realpath.
- [x] Implement project resolver:
  ```txt
  cwd → git root if any → projectKey
  ```
- [x] Implement harness home resolver:
  ```txt
  ~/.pi/harness
  ```
- [x] Implement atomic JSON/JSONL writes.
- [x] Add minimal tests.

### Definition of Done

```txt
harness doctor
```

prints:

```txt
- resolved config
- sessionDir exists?
- harnessHome writable?
- project cwd/git root/projectKey
```

No raw session content is read yet.

Current verification:

```bash
npm --prefix packages/harness-runtime test
node packages/harness-runtime/src/cli.js doctor --project . --json
node packages/harness-runtime/src/cli.js config print --project .
node packages/harness-runtime/src/cli.js project resolve --project . --json
```

---

## 5. Phase 1 — Read-only session discovery

### Mục tiêu

List được raw Pi sessions theo project, chưa normalize full.

### Commands

```bash
harness sessions --project /home/hieptran/Desktop/pi-learn
harness sessions --project . --last 10
```

### Tasks

- [x] Read `sessionDir`.
- [x] Locate candidate `.jsonl` files.
- [x] Parse only session header safely.
- [x] Filter by `cwd`/git root/project.
- [x] Sort by timestamp/mtime.
- [x] Print session list.
- [x] Skip malformed files with warnings.

### Output

No normalized cache required yet, but command should show:

```txt
sessionId
sessionFile
cwd
version
startedAt/mtime
size
```

### Definition of Done

```bash
harness sessions --project . --last 5
```

shows recent Pi sessions for the current project without reading full content.

Current verification:

```bash
npm --prefix packages/harness-runtime test
node packages/harness-runtime/src/cli.js sessions --project . --last 3 --json
```

---

## 6. Phase 2 — Full parser + tree resolver

### Mục tiêu

Parse raw session JSONL full file, build tree, compute active path.

### Commands

```bash
harness inspect <session.jsonl>
harness inspect <session.jsonl> --tree
harness inspect <session.jsonl> --active-path
```

### Tasks

- [x] Read JSONL line by line.
- [x] Handle malformed lines.
- [x] Parse header.
- [x] Collect entries with `id`/`parentId`.
- [x] Build `id → entry` map.
- [x] Build `parent → children` map.
- [x] Detect active leaf.
- [x] Walk active path.
- [x] Count branches.
- [x] Emit parse warnings.

### Definition of Done

For one real session:

```txt
- header parsed
- entry count correct
- activeLeafId found
- activePathEntryIds produced
- branch count produced
- unknown entries do not crash parser
```

No LLM.

Current verification:

```bash
npm --prefix packages/harness-runtime test
node packages/harness-runtime/src/cli.js inspect <session.jsonl> --active-path
node packages/harness-runtime/src/cli.js inspect <session.jsonl> --tree --json
```

---

## 7. Phase 3 — Normalize cache writer

### Mục tiêu

Tạo 4 output files mỗi session:

```txt
manifest.json
events.jsonl
metrics.json
warnings.jsonl
```

### Commands

```bash
harness scan --project /home/hieptran/Desktop/pi-learn --last 5
harness scan --project . --last 5
```

### Tasks

- [x] Normalize user messages.
- [x] Normalize assistant messages.
- [x] Extract assistant `toolCall` blocks into `assistant_tool_call` events.
- [x] Normalize tool results.
- [x] Normalize bash executions where present and count bash tool calls.
- [x] Normalize model/thinking changes.
- [x] Normalize compaction/branch summary.
- [x] Normalize labels/session info/custom/custom_message.
- [x] Implement minimal harness runtime/audit/error logging.
- [x] Implement redaction before writing cache.
- [x] Implement truncation/head/tail/error lines.
- [x] Add `rawRef` to every event.
- [x] Compute metrics from events.
- [x] Write all files atomically.

### Output

```txt
~/.pi/harness/projects/<project-key>/sessions/<session-id>/
├── manifest.json
├── events.jsonl
├── metrics.json
└── warnings.jsonl
```

### Definition of Done

```bash
harness scan --project . --last 3
```

creates valid cache for 3 sessions.

Validation:

```txt
- manifest has sessionId/projectKey/activePathEntryIds
- events are redacted/truncated
- metrics count tool/bash/model usage
- warnings written if parser sees unknowns
- raw sessions unchanged
```

Current verification:

```bash
npm --prefix packages/harness-runtime test
node packages/harness-runtime/src/cli.js scan --project . --last 1 --harness-home /tmp/harness-test --json
```

---

## 8. Phase 4 — Report + inspect full by rawRef

### Mục tiêu

Tạo report đọc được và inspect full entry khi cần.

### Commands

```bash
harness report --project . --last 5
harness inspect <session.jsonl> --entry <entry-id>
harness inspect <session.jsonl> --entry <entry-id> --full
harness show-cache --project . --session <session-id>
```

### Tasks

- [x] Generate Markdown report from cached metrics/events.
- [x] Report summary:
  ```txt
  sessions scanned
  turns/messages
  top tools
  tool failures
  bash failures
  models/cost/tokens
  compactions/branches
  warnings
  safety findings
  ```
- [x] Implement `inspect --entry` from rawRef.
- [x] Redact by default even for `--full`.
- [x] Keep `--no-redact` reserved; cache/log/full inspect output remains redacted for safety.
- [x] Write `reports/latest.md`.

### Output

```txt
~/.pi/harness/projects/<project-key>/reports/latest.md
```

### Definition of Done

```bash
harness report --project . --last 5
```

produces a useful Markdown report without copying full raw logs.

---

## 9. Phase 5 — Rule engine + deterministic proposals

### Mục tiêu

Detect clear patterns without LLM and create proposal Markdown.

### Current entrypoints

```txt
Runtime API: propose({ rules: true }) or propose({ target: "rules" })
Pi UX: /harness-improve → /harness-proposals
```

### Initial rules

Implemented MVP rules:

```txt
- repeated bash failure
- repeated edit/tool error pattern, including edit oldText mismatch
- sensitive path access
- parser/normalizer warning pattern
```

Still planned rules:

```txt
- redaction warning repeated
- user correction repeated
- .pi/logs staged/mentioned in commit workflow
- long session + compaction + correction after compaction
```

### Tasks

- [x] Implement rule engine.
- [x] Remove the legacy project JSON rule-config loader; keep detector defaults in runtime code and route reviewed prompt guidance to `wiki/**/_rules.md`.
- [x] Implement evidence refs.
- [x] Implement proposal writer.
- [x] Implement dedupe by fingerprint.
- [x] Add risk classification.
- [x] Add target routing using improvement matrix.

### Output

Private draft proposals:

```txt
~/.pi/harness/projects/<project-key>/proposals/draft/P-0001.md
```

### Definition of Done

Rule engine can generate at least 2 deterministic proposals from cached sessions, with evidence refs and rollback/test plan.

---

## 10. Phase 6 — Memory/rules/parser improvement proposals

### Mục tiêu

Dùng evidence để propose improve chính harness artifacts.

### Proposal targets

```txt
memory
rules
parser
redaction
docs
eval
```

### Commands

```bash
harness propose --project . --target memory
harness propose --project . --target rules
harness propose --project . --target parser
harness propose --project . --target redaction
```

### Tasks

- [x] Generate MemoryItem drafts.
- [x] Generate reviewed prompt-rule proposals and route detector implementation changes to runtime source/tests.
- [x] Generate parser warning proposals.
- [x] Generate redaction warning proposals.
- [x] Track proposal source rule/signal in proposal metadata.

Deferred to Phase 9 controlled apply/proposal lifecycle:

```txt
- Track accepted/rejected proposal history.
```

### Definition of Done

Status: done for MVP.

Harness can say:

```txt
This warning pattern should improve parser.
This repeated correction should become memory or AGENTS rule.
This noisy prompt guidance should be rewritten/removed, or the deterministic detector should be tuned in runtime code.
```

without applying automatically.

---

## 11. Phase 7 — Pi extension wrapper

> Detailed migration plan: [`extension-migration-plan.md`](./extension-migration-plan.md).

### Mục tiêu

Chuyển primary UX sang Pi slash commands; standalone CLI/bin đã được loại bỏ và extension import runtime API trực tiếp.

Không implement business logic riêng trong extension. Extension gọi core runtime.

### Commands

```txt
/harness-status [last]
/harness-report [last]
/harness-improve [last]
/harness-proposals
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note [text]
/harness-wiki-init|update|ask|status
```

### Tasks

- [x] Add extension source under package if integrating into `pi-learn`.
- [x] Register slash commands.
- [x] Guard UI calls with `ctx.hasUI` / `ctx.ui?.`.
- [x] `/harness-report` calls runtime report.
- [x] `/harness-status` consolidates sessions, warnings, and automation state.
- [x] `/harness-improve` uses the current Pi model and normalized evidence.
- [x] `/harness-proposals` lists draft proposals.
- [x] `/harness-mark` records note/success/failure session entries.
- [x] `/harness-wiki-*` provides repository documentation and prompt-rule status from the same entrypoint.

### Definition of Done

Inside Pi:

```txt
/harness-report
```

shows latest report path/summary and does not slow startup significantly.

---

## 12. Phase 8 — LLM-assisted reflection

### Mục tiêu

Use LLM only after normalized cache exists and redaction is proven.

### Commands

```bash
harness reflect --project . --last 5
harness propose --project . --llm
```

Pi:

```txt
/harness-reflect
/harness-propose
```

### Tasks

- [x] Select excerpts from events, not raw session full text.
- [x] Include evidence refs.
- [x] Enforce max excerpt chars.
- [x] Enforce redaction.
- [x] Prompt LLM to avoid weak proposals.
- [x] Preserve evidence refs and require structured evidence fields.
- [x] Normalize common target mismatch on import when `AGENTS.md`-only proposal is labeled `rules`/`tool`/`redaction`.
- [x] Cap one evidence reason during selection so `safety_sensitive` does not dominate all prompt slots.
- [x] Strengthen redaction for env/yaml secret assignments and long opaque token-like values before reflection.
- [x] Add explicit target routing guide to reflection prompt (`memory`, `rules`, `agents`, `skill`, `docs`, `parser`, `redaction`, `eval`, `tool`).
- [x] Enrich selected evidence with `likelyTargets` and `targetGuidance` before sending to LLM.
- [x] Save reflection prompt under private harness home.
- [x] Pi extension path using the current Pi session model via `/harness-improve` + `harness_import_llm_reflection` tool.
- [x] Runtime stays API-key free; no separate LLM provider credentials in harness runtime.
- [x] Import LLM JSON response as draft proposals.
- [x] Validate imported proposals include evidence refs, target files, risk, test plan and rollback.
- [x] Never apply automatically.

### Output

```txt
~/.pi/harness/projects/<project-key>/reflections/latest.md
~/.pi/harness/projects/<project-key>/reflections/YYYY-MM-DD-reflection-prompt.md
~/.pi/harness/projects/<project-key>/proposals/draft/P-0001-*.md
```

### Definition of Done

Status: done for MVP.

LLM-assisted proposal import requires:

```txt
- has evidence refs
- preserves evidence kind/reason/excerpt separately
- has target files
- target matches target files or is normalized/rejected
- has risk
- has test plan
- has rollback
- does not include secrets/raw full logs
```

Remaining Phase 8 hardening:

```txt
- Stricter rejection for parser/redaction/tool targets that lack matching code/test target files
- Live-test proposal quality on more projects after target routing prompt change
```

---

## 13. Phase 9 — Controlled apply

### Mục tiêu

Apply approved proposals safely.

Status: done for MVP.

### Commands

```bash
harness approve P-0001
harness apply P-0001
harness reject P-0001
harness rollback P-0001
```

Pi:

```txt
/harness-proposals       # review + approve/reject/approve&apply trong modal
/harness-apply P-0001
```

### Apply flow

```txt
1. Check proposal status approved.
2. Check git clean or require explicit `--allow-dirty` override.
3. Create branch harness/P-0001.
4. Apply patch to target files only.
5. Show diff.
6. Commit only if `--commit` is passed.
7. Never push unless user explicitly asks.
```

### Tasks

- [x] Add proposal lifecycle commands: `approve`, `reject`, `history`.
- [x] Append accepted/rejected/applied/rolled_back events to private `proposals/history.jsonl`.
- [x] Require approved status before apply.
- [x] Require git repository and clean worktree by default.
- [x] Create/use branch `harness/P-0001` before applying.
- [x] Apply only machine-readable `## Patch` JSON entries.
- [x] Enforce proposal target file allowlist and project-root containment.
- [x] Do not execute `## Test plan` commands during apply; test plans remain review/eval guidance only.
- [x] Support optional `--commit` with proposal id in commit message.
- [x] Support rollback for uncommitted applies and committed applies.
- [x] Add Pi review/apply wrappers: `/harness-proposals` owns approve/reject/approve&apply UI; `/harness-apply` remains the advanced apply command.

### Definition of Done

- [x] Apply cannot touch files outside proposal target list.
- [x] Apply does not run proposal test commands implicitly.
- [x] Rollback command documented.
- [x] Commit references proposal id and evidence.

---

## 14. Phase 10 — Eval harness

### Mục tiêu

Validate improvements and prevent regression.

### Commands

```bash
harness eval
harness eval P-0001
harness eval --scenario smart-commit-basic
```

### Tasks

- [x] Define eval schema.
- [x] Create deterministic fixture scenarios.
- [x] Add deterministic checks first.
- [x] Defer LLM judge until deterministic evals are insufficient.
- [x] Compare before/after for apply safety fixtures.
- [x] Require proposal-quality checks for proposal-specific evals, including high-risk eval/test evidence.
- [x] Write private eval JSON/Markdown reports.
- [x] Add Pi wrapper command `/harness-eval`.

### Initial scenarios

```txt
smart-commit-basic
file-protection
redaction-fixture
parser-unknown-entry
edit-oldText-workflow
ts-extension-safety
```

### Output

```txt
~/.pi/harness/projects/<project-key>/evals/latest.json
~/.pi/harness/projects/<project-key>/evals/latest.md
~/.pi/harness/projects/<project-key>/evals/YYYY-MM-DD-eval.json
~/.pi/harness/projects/<project-key>/evals/YYYY-MM-DD-eval.md
```

### Definition of Done

Status: done for MVP.

At least 3 scenarios run and report pass/fail. Current MVP scenarios:

```txt
redaction-fixture
parser-unknown-entry
edit-oldText-workflow
file-protection
smart-commit-basic
ts-extension-safety
```

---

## 15. Phase 11 — Gated automation

### Mục tiêu

Low-risk automation only after manual pipeline is stable.

Status: done for MVP.

### Allowed automation initially

```txt
- scan recent sessions
- regenerate reports
- draft proposals
- dedupe proposals
- create eval fixture draft
```

### Not allowed by default

```txt
- auto-apply AGENTS.md changes
- auto-edit extensions
- auto-edit settings/auth/provider config
- auto-push
- auto-read sensitive logs
```

### Tasks

- [x] Add runtime automation status API.
- [x] Add gated automation API.
- [x] Add opt-in config under `automation.enabled`.
- [x] Allow only scan/report/proposal drafts/eval/eval fixture drafts.
- [x] Block unsafe policy combinations: `autoApply`, `autoPush`, `lowRiskAutoPatch`, or disabled human approval.
- [x] Add Pi commands `/harness-automation-status` and `/harness-automate`.
- [x] Add UI confirmation before manual automation run.
- [x] Add unit tests for disabled and enabled automation paths.

### Definition of Done

Automation is opt-in in config:

```json
{
  "autoApply": false,
  "autoPush": false,
  "automation": {
    "enabled": true,
    "maxSessions": 5,
    "scan": true,
    "report": true,
    "proposeRules": true,
    "proposeTargets": ["memory", "parser", "redaction"],
    "eval": true,
    "createEvalFixtureDraft": true
  },
  "riskPolicy": {
    "lowRiskAutoPatch": false,
    "requireHumanApproval": true
  }
}
```

No silent changes. MVP automation never apply/commit/push.

---

## 16. Phase gates

Do not enter next phase unless gate passes.

| From → To | Gate |
|---|---|
| Spec → Runtime | package location and CLI name decided |
| Runtime → Discovery | `harness doctor` works |
| Discovery → Parser | sessions listed by project correctly |
| Parser → Normalize | active path/tree works on real sessions |
| Normalize → Report | 4 cache files valid for real sessions |
| Report → Rules | report useful without raw full logs |
| Rules → Extension | core runtime usable from CLI |
| Extension → LLM | redaction/truncation tested |
| LLM → Apply | proposals have evidence/test/rollback |
| Apply → Eval | apply flow branch/diff/test safe |
| Eval → Automation | evals catch at least known regressions |

---

## 17. Current next actions

Immediate recommended next steps:

```txt
1. Live-test `/harness-improve` on `prasac` and verify targets match target files.
2. Live-test `/harness-automation-status` and `/harness-automate` inside Pi after `/reload`.
3. Decide whether Phase 12 should be dashboard/status UI or richer automation scheduling.
4. Keep automation opt-in and proposal-first; do not add silent auto-apply or auto-push.
```

Current implementation choice:

```txt
Location: packages/harness-runtime
Package: @pi-learn/harness-runtime
Runtime API: packages/harness-runtime/src/api.js
Extension: primary UX, imports runtime API directly
```

Reason:

```txt
- keeps docs/spec in pi-harness/
- keeps runtime separate from public Pi extension package
- parser/cache is now stable enough for extension-first UX
- keeps runtime testable outside Pi through unit tests without a CLI/bin
```

---

## 18. Risk register

| Risk | Mitigation |
|---|---|
| Raw session leaks secrets | redact before cache/report/LLM; no raw commit |
| Parser misreads tree | active path tests with real sessions |
| Cache contains too much content | truncation + rawRef lazy full inspect |
| Rules create noise | min evidence count + dedupe + rejection history |
| Memory becomes junk | review/approval required |
| AGENTS.md bloats | prefer memory/prompt/rule first |
| Extension slows Pi startup | extension calls runtime on-demand only |
| LLM hallucinates proposals | evidence refs + target routing guide required; import validates/normalizes target mismatch; no apply automatically |
| Apply damages worktree | git clean check + target file allowlist + branch |
| Automation surprises user | opt-in only; autoPush false |

---

## 19. MVP target definition

The first meaningful MVP is not auto-improvement.

MVP is:

```bash
harness scan --project /home/hieptran/Desktop/pi-learn --last 5
harness report --project /home/hieptran/Desktop/pi-learn --last 5
harness inspect <session.jsonl> --entry <entry-id> --full
```

and produces:

```txt
~/.pi/harness/projects/<project-key>/sessions/<session-id>/manifest.json
~/.pi/harness/projects/<project-key>/sessions/<session-id>/events.jsonl
~/.pi/harness/projects/<project-key>/sessions/<session-id>/metrics.json
~/.pi/harness/projects/<project-key>/sessions/<session-id>/warnings.jsonl
~/.pi/harness/projects/<project-key>/reports/latest.md
```

MVP must guarantee:

```txt
- raw sessions unchanged
- no LLM required
- redaction enabled
- active path respected
- project scoped
- unknown entries do not crash parser
```

---

## 20. Summary

Updated roadmap:

```txt
Current: Phase 8 LLM reflection MVP + Phase 9 controlled apply MVP + Phase 10 eval harness MVP + Phase 11 gated automation MVP implemented
Next: live Pi UI verification and decide Phase 12
Then: broader auto-improvement only after eval gates
Finally: no silent auto-apply/auto-push
```

Most important sequencing rule:

```txt
Do not build improve/apply/LLM before normalized cache is correct.
```
