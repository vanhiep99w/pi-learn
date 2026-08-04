# Pi Harness — Better Harness Comparison and Improvement Plan

> Tài liệu này ghi lại các bài học có thể áp dụng từ
> [QoderAI/better-harness](https://github.com/QoderAI/better-harness) vào Pi Harness,
> đồng thời chuyển chúng thành một kế hoạch triển khai cụ thể, có ranh giới,
> acceptance criteria, test plan và rollback plan.
>
> Đây là tài liệu định hướng. Nó không thay thế source code, [`roadmap.md`](./roadmap.md),
> [`improvement-matrix.md`](./improvement-matrix.md), hoặc các quyết định safety hiện có.

---

## 1. Mục tiêu

Pi Harness hiện đã có một nền tảng mạnh cho Pi-specific observability và
self-improvement:

```txt
Pi raw session JSONL
  → deterministic parse/tree/normalize/redact
  → private session cache
  → metrics/warnings/report
  → deterministic detector hoặc LLM reflection
  → evidence-backed proposal
  → human approval
  → controlled patch apply trên branch
  → eval hoặc rollback
```

Better Harness bổ sung một cách nhìn rộng hơn:

```txt
frozen scope + bounded evidence
  → Session Evidence
  → Project Harness Evidence
  → Agent Asset Evidence
  → Task Episode review
  → evidence state + finding
  → scoped repair
  → repair verification
  → later comparable outcome
```

Mục tiêu của kế hoạch này là giữ nguyên các thế mạnh Pi-native hiện tại, nhưng
bổ sung các phần còn thiếu để Pi Harness có thể trả lời đáng tin cậy hơn:

1. Agent đã làm gì trong một task cụ thể?
2. Project có mechanism nào hỗ trợ task đó?
3. Agent đã được cấu hình bằng Rules, Skills, prompts và tools nào?
4. Mechanism chỉ tồn tại, hay đã được route, sử dụng và tạo ra kết quả?
5. Một detector signal có thật sự là vấn đề cần sửa không?
6. Proposal đã được apply, nhưng repair có được verify không?
7. Repair được verify trong hiện tại, nhưng task sau có thực sự tốt hơn không?

---

## 2. Research snapshot và phạm vi so sánh

### 2.1 Better Harness snapshot

Phân tích tham chiếu Better Harness dựa trên:

```txt
Repository: https://github.com/QoderAI/better-harness
Version: 0.4.0
Commit: 6b6d0b2628246166b1e015a0f5826ab0a4258ae6
Commit date: 2026-08-03
```

Các owner chính đã kiểm tra:

```txt
skills/better-harness/SKILL.md
models/agent-work-loop.md
scripts/harness-analysis/evidence-bundle/**
scripts/session-analysis/**
scripts/core-change-watch/**
scripts/coding-agent-practices/**
scripts/harness-analysis/render-report.mjs
docs/adapters/README.md
templates/reporting/**
```

Verification tại snapshot:

```bash
npm ci
npm test
```

Kết quả quan sát: `1148` tests pass.

### 2.2 Pi Harness snapshot

Phân tích Pi Harness dựa trên source hiện tại tại:

```txt
Commit: 25794cef393921a7169f6704ff9d4c9e0c4b44a2
Commit date: 2026-07-17
```

Các owner chính:

```txt
packages/harness-runtime/src/api.js
packages/harness-runtime/src/session/**
packages/harness-runtime/src/normalize/**
packages/harness-runtime/src/analysis/**
packages/harness-runtime/src/reflection/**
packages/harness-runtime/src/proposals/**
packages/harness-runtime/src/eval/**
packages/pi-learn-extensions/extensions/harness/**
pi-harness/**
wiki/**/_rules.md
```

Verification:

```bash
npm --prefix packages/harness-runtime test
```

Kết quả tại thời điểm so sánh: `83` tests pass.

### 2.3 Giới hạn của tài liệu

- Không đọc raw Pi session logs hoặc private Harness evidence.
- Không đánh giá chất lượng proposal thực tế từ dữ liệu riêng của người dùng.
- Không yêu cầu Pi Harness trở thành multi-host product.
- Không copy nguyên kiến trúc, schema hoặc scoring của Better Harness.
- Các chi tiết Better Harness phải được revalidate trước khi dùng làm dependency
  hoặc compatibility contract vì upstream có thể thay đổi.

---

## 3. Kết luận cấp cao

Hai hệ thống đang tối ưu hai lớp khác nhau.

### Pi Harness hiện tại mạnh ở

```txt
- Pi session tree parsing
- active-path normalization
- private redacted cache
- deterministic metrics and warnings
- deterministic proposal detectors
- current-session LLM reflection without a separate API key
- proposal approval/rejection/history
- exact target allowlist
- clean-worktree and branch-based apply
- transactional patch restore
- prompt-rule lint after apply
- deterministic eval scenarios
- Pi-native TUI workflow
```

### Better Harness mạnh ở

```txt
- frozen evidence context
- independent evidence domains
- Task Episode as the review unit
- project and agent-asset evidence
- mechanism state: Present/Wired/Exercised/Outcome-supported
- explicit Missing versus Unobserved
- candidate-to-finding quality gates
- smallest-owner repair routing
- structured finding identity
- revision-bound repair recording
- post-fix repair review
- longitudinal outcome validation
- monorepo/workspace topology binding
```

### Hướng tích hợp được khuyến nghị

Không rewrite Pi Harness. Giữ pipeline hiện tại và mở rộng theo hướng:

```txt
current normalized session cache
  + frozen analysis run
  + Task Episode builder
  + project evidence lane
  + agent-asset evidence lane
  + candidate review
  + findings ledger
  + validation receipts
  + intervention/outcome ledger
```

---

## 4. So sánh kiến trúc chi tiết

| Concern | Pi Harness hiện tại | Better Harness | Hướng Pi Harness nên áp dụng |
|---|---|---|---|
| Host boundary | Pi-specific | Multi-host adapters | Giữ Pi-specific; chỉ thiết kế provider field để schema không bị khóa cứng |
| Session input | Pi JSONL tree | Host-specific local session sources | Giữ parser hiện tại |
| Cache | Private normalized cache | Mostly bounded envelopes generated per run | Giữ cache, thêm frozen run envelope phía trên |
| Review unit | Session và active path | Task Episode | Implement Task Episode v1 |
| Project evidence | Ít, chủ yếu project root/config | Static project, Git, tests, instructions, delivery | Thêm project evidence lane tối thiểu |
| Agent assets | Chưa có baseline tổng hợp | Rules, Skills, MCP, Hooks, Plugins, Memory | Thêm Pi agent-asset baseline |
| Detector output | Detector có thể tạo proposal trực tiếp | Detector tạo lead/candidate | Tách CandidateSignal khỏi Proposal |
| Evidence state | Metrics/counts/warnings | Present/Wired/Exercised/Outcome-supported | Thêm state; chưa thêm score |
| Finding identity | Proposal là đơn vị chính | Finding tách khỏi repair | Thêm Finding ledger, proposal tham chiếu finding |
| Apply | Approved proposal → patch | Finding-bound repair | Giữ apply, thêm finding/revision binding |
| Validation | Test plan không tự chạy; eval tách rời | Repair phải có validation trước khi record | Thêm allowlisted validation receipt |
| Effectiveness | Proposal history/eval | Later comparable Task Episode | Thêm intervention ledger |
| Topology | Git-root project resolver | Repo/member/subtree topology | Thêm structured workspace target |
| Report | Private Markdown metrics report | Findings-backed HTML/Canvas/Markdown | Trước mắt thêm findings JSON + Pi TUI projection |
| Privacy | Private cache, redaction, rawRef boundaries | Strict specialist and reader boundaries | Giữ current privacy, tách diagnostic/shareable projections |

---

## 5. Nguyên tắc thiết kế cần chốt trước khi implement

### 5.1 Evidence trước, judgment sau

```txt
collector output ≠ finding
count ≠ consequence
asset presence ≠ asset use
apply success ≠ repair verified
repair verified ≠ later improvement
```

### 5.2 Deterministic runtime vẫn là source of truth cho facts

Runtime deterministic tiếp tục sở hữu:

```txt
- raw JSONL parsing
- session tree and active path
- normalization
- redaction and truncation
- event/metrics/warnings cache
- project and asset inventory
- fingerprints and bindings
- schema validation
- proposal lifecycle state
- patch application and rollback
- validation receipts
```

LLM chỉ sở hữu:

```txt
- semantic grouping/review của bounded candidates
- consequence interpretation
- confidence explanation
- finding wording
- repair proposal drafting
- optional independent post-fix judgment
```

### 5.3 Không parse prompt rules thành detector config

Giữ nguyên `ARCH-DETECTOR-001`:

```txt
wiki/**/_rules.md       → model guidance
runtime analysis code   → detector implementation/defaults/thresholds
```

### 5.4 Private evidence là mặc định

Các artifact mới mặc định nằm dưới:

```txt
~/.pi/harness/projects/<project-key>/
```

Không commit:

```txt
- raw sessions
- normalized events
- private evidence bundle
- private findings containing local locators
- validation output with secrets
- intervention evidence excerpts
```

### 5.5 Không thêm score trong MVP

MVP dùng evidence state và confidence. Score 0–100 chỉ được cân nhắc khi:

- Task Episode extraction ổn định;
- state resolution đã được test;
- report được dùng trên nhiều project;
- có longitudinal outcome data;
- có calibration contract rõ ràng.

---

## 6. Target architecture

```txt
Pi raw JSONL
  │
  ▼
Existing session pipeline
  parse → tree → normalize → redact → private cache
  │
  ├─────────────────────────────────────────────────────┐
  │                                                     │
  ▼                                                     ▼
Frozen Analysis Run                               Diagnostics
  context + session population                     inspect/report/debug
  │
  ├── Session Evidence Lane
  │     └── Task Episode candidates
  │
  ├── Project Harness Lane
  │     └── instructions/startup/tests/git/delivery
  │
  └── Agent Asset Lane
        └── rules/skills/prompts/extensions/tools/hooks
  │
  ▼
Candidate Review
  deterministic eligibility + optional LLM semantic review
  │
  ▼
Findings Ledger
  evidence state + impact + owner + acceptance checks
  │
  ▼
Proposal Lifecycle
  draft → approve/reject → apply → rollback
  │
  ▼
Validation Receipt
  applied → verified/partial/blocked
  │
  ▼
Intervention Ledger
  baseline → later comparable episodes → improved/unchanged/regressed
```

### 6.1 Giữ nguyên package boundaries

```txt
packages/harness-runtime/
  → facts, schemas, storage, analysis, lifecycle, eval

packages/pi-learn-extensions/extensions/harness/
  → Pi commands, TUI, current-session model bridge

pi-harness/
  → architecture/spec/roadmap docs

wiki/**/_rules.md
  → reviewed model guidance only
```

---

## 7. Improvement 1 — Frozen Analysis Run

### 7.1 Vấn đề hiện tại

`/harness` gọi song song nhiều runtime operation. `sessions()` và `report()` tự
session-discover riêng; `/harness-improve` lại scan một lần khác. Nếu session
đang được ghi hoặc filesystem thay đổi, report, dashboard và reflection có thể
không dùng cùng population.

### 7.2 Mục tiêu

Mọi consumer trong một Harness run dùng chung:

- project identity;
- workspace target;
- session time window;
- eligible population;
- selected population;
- provider;
- authority;
- evidence depth;
- immutable fingerprints.

### 7.3 Proposed private contract

```json
{
  "schemaVersion": 1,
  "kind": "pi-harness.analysis-run",
  "runId": "run-...",
  "createdAt": "2026-08-04T00:00:00.000Z",
  "provider": "pi",
  "project": {
    "projectKey": "...",
    "projectRoot": "<private>",
    "gitRoot": "<private>"
  },
  "workspaceTarget": {
    "kind": "repo-root",
    "route": ".",
    "packageRoute": null,
    "ownerRoute": "."
  },
  "window": {
    "since": "...",
    "until": "..."
  },
  "selection": {
    "strategy": "latest-n",
    "limit": 5,
    "eligibleCount": 12,
    "selectedCount": 5,
    "eligibleFingerprint": "...",
    "selectedFingerprint": "..."
  },
  "authority": {
    "rawSessionContent": false,
    "userHomeAssets": false,
    "normalizedLookup": "single-exact-ref"
  },
  "laneStatus": {}
}
```

### 7.4 Session identity fingerprint

Không cần hash raw full session. Dùng metadata ổn định:

```txt
provider
session id hoặc private stable ref
header timestamp
file size
mtime
workspace identity
```

Fingerprint chỉ dùng private binding; reader output không expose stable ID.

### 7.5 Source owners dự kiến

```txt
packages/harness-runtime/src/analysis/analysis-run.js
packages/harness-runtime/src/session/discover-sessions.js
packages/harness-runtime/src/api.js
packages/harness-runtime/tests/analysis-run.test.js
```

Tên file là đề xuất; implementation phải theo architecture hiện tại và tránh
catch-all module.

### 7.6 Acceptance criteria

- Một run chỉ discover session population một lần.
- Report, reflection và findings nhận cùng selected fingerprint.
- Nếu selected session thay đổi trước consumer stage, run fail/partial thay vì
  silently dùng population mới.
- `until` được freeze trước khi đọc population.
- Active current session được xử lý bằng policy rõ ràng: exclude, frozen
  metadata snapshot, hoặc partial; không suy diễn recency.
- JSON output parser-safe.

### 7.7 Test plan

- Unit test same population shared by report/reflection.
- Test session file mtime/size changes after freeze.
- Test zero eligible sessions.
- Test malformed session header remains an explicit warning.
- Test selected fingerprint deterministic across traversal order.

### 7.8 Rollback

Giữ API cũ hoạt động qua compatibility path. Nếu frozen run gây regression,
report/reflection tạm quay về existing discovery nhưng không xóa schema hoặc
private run files cho đến khi migration decision được ghi lại.

---

## 8. Improvement 2 — Workspace and owner topology

### 8.1 Vấn đề hiện tại

`resolveProject()` quy toàn bộ cwd trong một Git repository về Git root. Trong
monorepo, package member A và B có thể dùng chung `projectKey`, trong khi owner
thực tế và validation route khác nhau.

Một số detector target hiện dùng generic paths như:

```txt
src/safety/redaction.js
tests/redaction.test.js
src/session/parse-session.js
```

Trong repo này owner thực nằm dưới:

```txt
packages/harness-runtime/src/**
packages/harness-runtime/tests/**
```

### 8.2 Mục tiêu

Mỗi finding/proposal có target có cấu trúc:

```json
{
  "kind": "repo-root|workspace-member|repo-subtree|standalone",
  "route": "packages/harness-runtime",
  "packageRoute": "packages/harness-runtime",
  "ownerRoute": "packages/harness-runtime"
}
```

### 8.3 Discovery tối thiểu

Inspect bounded manifests:

```txt
package.json workspaces
pnpm-workspace.yaml
Cargo.toml workspace
Go workspace/module files
```

Pi Learn MVP chỉ cần npm workspace/package detection nếu scope muốn giữ nhỏ.

### 8.4 Apply binding

Trước apply:

1. Resolve topology lại.
2. So sánh finding/proposal target với current topology.
3. Reject sibling owner hoặc path escape.
4. Resolve target files từ Git root + owner route.
5. Giữ exact allowlist và symlink checks hiện tại.

### 8.5 Acceptance criteria

- Package member session không bị tự động coi là repo-root task.
- Proposal target path là Git-root-relative POSIX path.
- Target member phải tồn tại trong frozen topology.
- Apply không widen từ member sang sibling.
- Ancestor-owned Rules chỉ được chọn khi rule scope thực sự áp dụng cho member.

### 8.6 Test plan

- npm monorepo fixture với hai packages.
- nested cwd resolves đúng package member.
- reject sibling owner.
- allow root `AGENTS.md` khi member inherits root rule.
- symlink/path traversal regression tests.

### 8.7 Rollback

Nếu topology incomplete, giữ current Git-root project behavior ở diagnostic
mode nhưng không cho structured finding-bound apply.

---

## 9. Improvement 3 — Task Episode v1

### 9.1 Vấn đề hiện tại

Runtime đã hiểu session tree và active path, nhưng report/detectors chủ yếu
aggregate theo session. Một Pi session có thể chứa nhiều user goals; gộp cả
session thành một unit dễ nối nhầm failure, edit, validation và success.

`pi-harness/plan.md` đã mô tả `HarnessEpisode`, nhưng implementation hiện chưa
có episode builder production tương ứng.

### 9.2 Review unit

Một Task Episode là:

```txt
one user goal
+ one target/scope
+ change set(s)
+ validation set(s)
+ one closure/acceptance boundary
```

### 9.3 Candidate boundary signals

Bắt đầu episode từ:

- user message có task intent;
- lifecycle command/prompt;
- explicit Harness custom entry;
- continuation marker sau compaction/branch khi cùng task.

Đóng episode từ:

- `/harness-mark success`;
- `/harness-mark failure`;
- explicit user acceptance/rejection candidate;
- final validation followed by stable task boundary;
- session end với state `unobserved`, không tự coi là success.

### 9.4 Proposed contract

```json
{
  "schemaVersion": 1,
  "kind": "pi-harness.task-episode",
  "id": "episode-private-ref",
  "taskFamily": "optional-normalized-family",
  "goalSummary": "redacted semantic summary",
  "sessionCount": 1,
  "continuation": "session-bounded|cross-session|unknown",
  "startBoundary": "user-message|explicit-marker|inferred",
  "changeSets": [],
  "validationSets": [],
  "permissionEvents": [],
  "closure": {
    "status": "closed|failed|open|unobserved",
    "source": "harness-mark|user-acceptance|inferred|none"
  },
  "evidenceRefs": []
}
```

### 9.5 Change set

Một change set chỉ chứa reader-safe/project-relative facts:

```json
{
  "id": "change-1",
  "ordinalStart": 10,
  "ordinalEnd": 18,
  "targetRoutes": ["packages/harness-runtime/src/report/report.js"],
  "eventCount": 3,
  "evidenceRefs": []
}
```

### 9.6 Validation set

```json
{
  "id": "validation-1",
  "checkIdentity": "npm-test:harness-runtime",
  "status": "pass|fail|unknown",
  "ordinal": 22,
  "targetRoutes": ["packages/harness-runtime"],
  "evidenceRefs": []
}
```

Không coi một broad check là relevant chỉ vì exit code `0`; relevance cần được
review theo changed target và project-owned command.

### 9.7 Tận dụng `/harness-mark`

`/harness-mark` nên trở thành explicit episode evidence:

```txt
success → closure candidate, không tự chứng minh delivery acceptance
failure → failed closure candidate
note    → bounded annotation, không mặc định là evidence fact
```

### 9.8 Acceptance criteria

- Hai user goals khác nhau trong cùng session tạo hai episode candidates.
- Validation trước final edit không đóng episode sau edit.
- Failure → edit → pass được giữ như repair chain candidate.
- Session end không tự thành success.
- Episode reader projection không expose raw prompt hoặc stable session ID.
- Cross-session continuation chỉ được nối bằng evidence, không chỉ cùng cwd.

### 9.9 Test plan

Fixtures:

```txt
single-task success
single-task failure
multiple tasks in one session
edit after passing check
failure-edit-rerun-pass
compaction continuation
branch to unrelated task
explicit harness-mark closure
zero-signal session
```

### 9.10 Rollback

Keep existing session metrics/report available. Episode-based findings remain
feature-gated until fixtures and live Pi verification pass.

---

## 10. Improvement 4 — Session Evidence Lane

### 10.1 Mục tiêu

Project session cache hiện tại trở thành input cho một compact, privacy-safe
lane thay vì đưa toàn bộ cached events vào semantic review.

### 10.2 Lane output

```json
{
  "kind": "pi-harness.session-evidence",
  "status": "available|partial|unavailable",
  "scope": {
    "eligibleSessions": 5,
    "selectedSessions": 5,
    "taskEpisodes": 3
  },
  "populationBinding": {},
  "selectionBinding": {},
  "candidates": [],
  "omitted": {
    "rawPrompts": true,
    "thinking": true,
    "successfulToolBodies": true
  }
}
```

### 10.3 Privacy rules

- Successful tool result body tiếp tục bị omit.
- Failed result chỉ giữ bounded redacted excerpt.
- Thinking content không được đưa vào semantic review.
- `normalizedRef` chỉ cho phép exact single-line lookup theo policy hiện tại.
- Specialist/finding review không nhận rawRef hoặc raw session path.

### 10.4 Acceptance criteria

- Lane có explicit `partial` khi episode extraction hoặc selected session bị
  thiếu coverage.
- Zero session là observed empty population, không phải automatic failure.
- Không suy diễn agent behavior từ project files trong lane này.

---

## 11. Improvement 5 — Project Harness Evidence Lane

### 11.1 Vấn đề hiện tại

Current report nói nhiều về session metrics nhưng chưa có bounded project
mechanism baseline. Vì vậy detector khó biết một failure là do thiếu mechanism,
mechanism stale, mechanism không được route, hay user task không sử dụng nó.

### 11.2 MVP evidence surfaces

```txt
- AGENTS.md and applicable instruction routes
- package/runtime manifests
- lockfiles/runtime pins
- setup/start/test/lint scripts
- current git diff name/status
- CI workflow presence and names
- release/recovery documentation leads
- source/test ownership paths
```

### 11.3 Static evidence boundary

Collector phải ghi rõ:

```txt
script exists          ≠ script passed
CI file exists         ≠ CI accepted current revision
rollback docs exist    ≠ recovery route was exercised
AGENTS.md exists       ≠ agent read applicable instruction
```

### 11.4 Proposed lane

```json
{
  "kind": "pi-harness.project-evidence",
  "status": "available|partial|unavailable",
  "workspaceTarget": {},
  "instructions": [],
  "commands": [],
  "validationRoutes": [],
  "deliveryRoutes": [],
  "changeScope": {},
  "evidenceBoundary": {
    "runtimeExecuted": false,
    "externalCiOpened": false
  }
}
```

### 11.5 MVP implementation scope

Không cần copy Better Harness `core-change-watch` đầy đủ. Bắt đầu bằng:

1. Git-aware file inventory bounded.
2. Manifest scripts.
3. scoped instructions.
4. current diff metadata.
5. test/CI/recovery leads.

### 11.6 Acceptance criteria

- Collector read-only.
- Missing Git/manifest được biểu diễn rõ.
- Không chạy project commands trong evidence collection mặc định.
- Không tạo finding trực tiếp.
- Không gọi file age hoặc hotspot là defect.

### 11.7 Test plan

- standalone Node project.
- npm monorepo member.
- project không có Git.
- missing package manifest.
- instruction inheritance.
- dirty worktree with scoped diff.

---

## 12. Improvement 6 — Agent Asset Evidence Lane

### 12.1 Mục tiêu

Biết agent có mechanism nào trước khi đề xuất tạo mới hoặc sửa duplicate.

### 12.2 Pi asset surfaces

Project scope:

```txt
AGENTS.md
wiki/**/_rules.md
.pi/agent/model-prompts/*.md
shared/project skills
project Pi extensions if declared
project MCP/tool configuration when explicitly supported
```

User scope, chỉ khi authorized:

```txt
~/.pi/agent/model-prompts/*.md
~/.pi/agent/skills or configured skill roots
settings-declared Pi packages/extensions
user/global AGENTS context
```

### 12.3 Asset states

Inventory chỉ chứng minh:

```txt
configured/present
```

Session activity mới có thể chứng minh:

```txt
selected/read/invoked/exercised
```

Later comparable result mới có thể chứng minh:

```txt
useful/outcome-supported
```

### 12.4 Duplicate coverage prevention

Trước proposal `rules|agents|skill|docs`:

1. Inventory candidate owner.
2. Open bounded matching content.
3. Check exact/semantic coverage.
4. Check scope/inheritance.
5. Check observed routing/use nếu session evidence có.
6. Chọn `reuse`, `fix routing`, `extend`, hoặc `create`.

### 12.5 Concrete regression case

Current detector `R-0002` có thể đề xuất exact-text edit rule sau repeated
`oldText` mismatch, trong khi `wiki/_rules.md` đã có `GLOBAL-EDIT-001`.

Expected future behavior:

```txt
signal: repeated edit oldText mismatch
asset coverage: GLOBAL-EDIT-001 already present
session use: rule not observed as loaded
candidate: instruction routing/lazy-loading gap
not: create duplicate global rule
```

Nếu rule đã được đọc nhưng failure vẫn xảy ra:

```txt
candidate: rule clarity/tool workflow gap
review required before proposing a change
```

### 12.6 Proposed lane

```json
{
  "kind": "pi-harness.agent-assets",
  "status": "complete|partial|failed",
  "authority": {
    "project": true,
    "userHome": false
  },
  "surfaces": [],
  "coverageRows": [],
  "integrityCandidates": [],
  "diagnostics": {
    "contentOpenedCount": 0,
    "inventoryOnlyCount": 0
  }
}
```

### 12.7 Acceptance criteria

- Counts không tự tạo finding/proposal.
- Project và user-home scope không bị trộn.
- Existing applicable rule được phát hiện trước create proposal.
- Inventory path không được đưa vào reader report nếu private.
- Asset presence không được gọi là observed use.

---

## 13. Improvement 7 — Candidate signals thay cho direct proposals

### 13.1 Vấn đề hiện tại

`runRuleEngine()` có thể đi trực tiếp từ repeated signal tới proposal. Cách này
đơn giản nhưng dễ false-positive và duplicate owner.

### 13.2 New separation

```txt
Detector
  → CandidateSignal

Coverage and consequence review
  → FindingCandidate

Finding reconciliation
  → Finding

Repair authoring
  → Proposal
```

### 13.3 CandidateSignal contract

```json
{
  "schemaVersion": 1,
  "id": "candidate-...",
  "detectorId": "R-0002",
  "kind": "repeated-tool-error",
  "status": "lead",
  "scope": {},
  "count": 2,
  "evidenceRefs": [],
  "likelyDimensions": ["controlled-execution"],
  "requiredReview": [
    "existing-coverage",
    "task-consequence",
    "smallest-owner",
    "validation-route"
  ]
}
```

### 13.4 Candidate eligibility

Một candidate chỉ được promote khi có:

- inspected evidence;
- consequence cụ thể;
- applicable owner;
- bounded repair;
- validation route;
- authority phù hợp.

Không promote chỉ vì:

```txt
- count high
- file old
- asset absent
- one sensitive-path flag
- parser source unavailable
- score low
- command failed once
```

### 13.5 Sensitive path case

Current `R-0003` dùng threshold `1`. Future flow phải review:

- access có được user authorize không;
- action chỉ đọc metadata hay content;
- redaction có fail không;
- secret có bị exposed không;
- safe denial có hoạt động không;
- persistent effect có tồn tại không.

Một authorized, redacted, read-only access có thể không phải finding.

### 13.6 Acceptance criteria

- Existing rule engine tests được chuyển sang assert candidate generation trước.
- Proposal generation tests phải include coverage/consequence review fixture.
- Detector ID và evidence refs được giữ xuyên suốt audit chain.
- Rejected/deferred candidate có reason code.

---

## 14. Improvement 8 — Evidence states

### 14.1 State model

MVP dùng:

```txt
Present
Wired
Exercised
Outcome-supported
Missing
Unobserved
Not-applicable
```

### 14.2 Definitions

| State | Ý nghĩa trong Pi Harness |
|---|---|
| `Present` | Mechanism/contract đã được inspect và tồn tại |
| `Wired` | Applicable task/trigger có route tới mechanism |
| `Exercised` | Một Task Episode hoặc bounded inspection đã dùng mechanism và giữ result |
| `Outcome-supported` | Later comparable episode/window hỗ trợ effect claim |
| `Missing` | Inspected applicable evidence xác nhận required mechanism/result không tồn tại |
| `Unobserved` | Observation boundary không đủ để quyết định |
| `Not-applicable` | Inspected task/project evidence chứng minh check không áp dụng |

### 14.3 Critical distinctions

```txt
No session evidence      → Unobserved, không phải Missing
Rule file exists         → Present, không phải Exercised
Test command exists      → Present
Task maps to test        → Wired
Task ran relevant test   → Exercised
Later task improved      → Outcome-supported
```

### 14.4 Không thêm score trong phase này

Report hiển thị state, confidence và boundary. Nếu sau này thêm score, score:

- không được tạo finding;
- không được derive từ finding count;
- phải có evidence ceiling;
- phải giữ Missing khác Unobserved;
- phải calibrated qua fixtures và real reports.

---

## 15. Improvement 9 — Findings ledger tách khỏi proposals

### 15.1 Vấn đề hiện tại

Proposal hiện đồng thời đại diện cho problem, diagnosis, target, patch và
lifecycle. Khi proposal bị reject hoặc thay thế, không có một stable finding
identity để theo dõi vấn đề và outcome.

### 15.2 Finding contract

```json
{
  "schemaVersion": 1,
  "id": "F-0001",
  "title": "Specific observed consequence",
  "status": "open|repairing|verified|partial|blocked|closed",
  "dimension": "change-validation",
  "check": "relevant-verification",
  "evidenceState": "Missing",
  "confidence": "low|medium|high",
  "impact": "Why the gap matters",
  "reason": "Fact, inference and uncertainty",
  "target": {
    "kind": "workspace-member",
    "packageRoute": "packages/harness-runtime",
    "ownerRoute": "packages/harness-runtime"
  },
  "evidenceRefs": [],
  "expectedOutcome": "What fixed looks like",
  "acceptanceChecks": [],
  "proposalRefs": []
}
```

### 15.3 Proposal contract extension

```json
{
  "id": "P-0001",
  "findingId": "F-0001",
  "expectedFindingRevision": 0
}
```

Legacy proposals không có `findingId` vẫn readable và dùng current workflow.

### 15.4 Findings storage

Private canonical state:

```txt
~/.pi/harness/projects/<project-key>/findings/latest.json
~/.pi/harness/projects/<project-key>/findings/history.jsonl
```

Reader projection có thể nằm trong report Markdown/TUI nhưng không phải source
of truth.

### 15.5 Finding quality gates

Mỗi finding phải qua:

1. Evidence eligibility.
2. Concrete reader value.
3. Fact consistency.
4. Existing asset coverage.
5. Privacy review.
6. Smallest owner.
7. Executable/observable acceptance check.
8. Deduplication by cause + owner + repair route.

### 15.6 Acceptance criteria

- Một finding có thể có nhiều proposals.
- Proposal reject không xóa finding.
- Fix thủ công có thể record vào finding mà không tạo fake proposal.
- Finding severity/state không đổi chỉ vì proposal được apply.
- Reader report không expose private evidence locators.

---

## 16. Improvement 10 — Evaluation dimensions cho Pi Harness

### 16.1 Khuyến nghị taxonomy

Không copy scoring ngay. Dùng năm dimension như navigation:

```txt
1. Task Understanding
2. Controlled Execution
3. Change Validation
4. Safe Delivery and Apply
5. Learning Capture
```

### 16.2 Suggested checks

#### Task Understanding

```txt
intent-and-acceptance
relevant-context
scope-boundary
```

#### Controlled Execution

```txt
reproducible-start
supported-operation
permission-boundary
```

#### Change Validation

```txt
relevant-check
failure-diagnosis
post-repair-revalidation
```

#### Safe Delivery and Apply

```txt
human-approval
revision-bound-acceptance
rollback-recovery
```

#### Learning Capture

```txt
repeat-opportunity-detection
smallest-durable-owner
later-outcome-validation
```

### 16.3 Pi-specific interpretation

- `Safe Delivery and Apply` phải bao gồm proposal approval, Git branch, target
  allowlist, prompt-rule lint và rollback.
- `Learning Capture` phải phân biệt current proposal/eval với later user task
  outcome.
- `/harness-mark` là closure evidence candidate, không phải delivery proof mặc định.

### 16.4 Acceptance criteria

- Mỗi finding có đúng một primary check.
- Một finding có thể ảnh hưởng adjacent dimensions nhưng owner không bị mơ hồ.
- Không buộc mỗi dimension phải có finding.
- Không tạo filler để report đủ số lượng.

---

## 17. Improvement 11 — Validation receipts

### 17.1 Vấn đề hiện tại

Controlled apply hiện an toàn nhưng:

```txt
proposal applied ≠ behavior verified
```

`## Test plan` là prose và apply cố tình không execute arbitrary commands. Đây là
safety decision đúng và phải giữ.

### 17.2 Mục tiêu

Ghi lại validation thực tế bằng structured receipt, không tự chạy command do LLM
bịa ra.

### 17.3 Validation route discovery

Allowed routes phải đến từ:

- project manifest command;
- Harness built-in eval scenario;
- explicit user-provided argv;
- reviewed project rule/owner contract;
- hardcoded safe runtime validation registry.

Không execute shell string từ proposal Markdown.

### 17.4 Receipt contract

```json
{
  "schemaVersion": 1,
  "kind": "pi-harness.validation-receipt",
  "findingId": "F-0001",
  "proposalId": "P-0001",
  "findingRevision": 1,
  "workspaceFingerprint": "...",
  "revision": "git-sha-or-worktree-fingerprint",
  "checks": [
    {
      "id": "harness-runtime-tests",
      "argv": ["npm", "test"],
      "cwdRoute": "packages/harness-runtime",
      "exitCode": 0,
      "status": "pass",
      "outputPolicy": "summary-only"
    }
  ],
  "status": "verified|partial|blocked",
  "recordedAt": "..."
}
```

### 17.5 Command UX options

Có thể bổ sung:

```txt
/harness-eval P-0001
/harness-verify P-0001
```

Khuyến nghị tái sử dụng `/harness-eval P-0001` trước, sau đó thêm `/harness-verify`
chỉ khi eval và target-owned validation cần tách UX.

### 17.6 Receipt privacy

- Store full output only under private Harness home nếu cần.
- Finding chỉ giữ command identity, exit status, timestamp và private receipt ref.
- Redact output trước persistence.
- Không ghi environment variables hoặc secrets.

### 17.7 Acceptance criteria

- Apply không tự đổi finding thành verified.
- Receipt phải bind exact finding/proposal revision.
- Stale workspace revision bị reject hoặc marked partial.
- Failed check giữ status blocked/partial.
- Validation route phải là argv array, không shell string.

### 17.8 Test plan

- pass receipt.
- failed receipt.
- stale finding revision.
- changed target after apply.
- unknown validation route.
- output redaction.
- receipt replay/deduplication.

---

## 18. Improvement 12 — Post-fix independent review

### 18.1 Mục tiêu

Sau target-owned validation, optional independent review chỉ quyết định repair
state:

```txt
verified
partial
blocked
```

Reviewer không được:

- rescan toàn project;
- tạo finding mới;
- thay đổi severity;
- thay đổi evaluation state ngoài finding;
- sửa file;
- claim later effectiveness.

### 18.2 Inputs

```txt
locked pre-fix finding
actual changed paths
actual diff summary
validation receipt
refreshed bounded asset integrity result
```

### 18.3 Fallback

Nếu independent model review không khả dụng:

- giữ deterministic validation receipt;
- repair state là `pending-review` hoặc policy-defined verified-without-review;
- không synthesize fake model judgment.

### 18.4 Acceptance criteria

- Post-fix review không đọc raw sessions.
- Review kết quả có evidence refs.
- Same-window repair state không thay đổi longitudinal outcome.

---

## 19. Improvement 13 — Intervention and longitudinal outcome ledger

### 19.1 Vấn đề hiện tại

Proposal history và eval cho biết thay đổi đã được draft/apply/test, nhưng chưa
trả lời task tương đương sau đó có tốt hơn không.

### 19.2 Ledger contract

```json
{
  "schemaVersion": 1,
  "findingId": "F-0001",
  "proposalId": "P-0001",
  "baseline": {
    "window": {},
    "taskFamily": "edit-workflow",
    "episodeCount": 4,
    "metric": {
      "name": "oldText-mismatch-per-episode",
      "value": 0.75
    },
    "guardrails": []
  },
  "intervention": {
    "status": "verified",
    "appliedAt": "...",
    "revision": "..."
  },
  "followUp": {
    "status": "pending|complete|incomparable",
    "selectionRule": "next-3-comparable-episodes",
    "episodeCount": 0
  },
  "decision": "pending|improved|unchanged|regressed|insufficient-evidence",
  "stopOrRevert": "..."
}
```

### 19.3 Comparability requirements

Hai windows chỉ comparable khi giữ được:

- normalized task family;
- tương tự scope/risk;
- cùng provider/tool behavior boundary;
- selection rule rõ;
- không đổi measurement definition giữa hai windows.

### 19.4 Guardrails

Không gọi improved nếu primary metric tốt hơn nhưng:

- safety violations tăng;
- validation bị bỏ qua;
- task scope nhỏ hơn đáng kể;
- model/tool changed làm comparison không còn hợp lệ;
- user corrections tăng.

### 19.5 Tận dụng current artifacts

```txt
proposal history     → intervention timing
validation receipt   → intervention verified state
/harness-mark        → episode outcome candidate
eval results         → same-window regression evidence
Task Episodes        → later comparable behavior
```

### 19.6 Acceptance criteria

- Same-window eval không được gọi là later improvement.
- Pending follow-up không xóa completed historical result.
- Regression yêu cầu stop/revert decision.
- Incomparable windows giữ `insufficient-evidence`, không ép kết luận.

---

## 20. Improvement 14 — Report contract và Pi TUI projection

### 20.1 Mục tiêu

Giữ Pi-native TUI, nhưng tách source data khỏi Markdown presentation.

### 20.2 Canonical private artifacts

```txt
analysis-runs/<run-id>/context.json
analysis-runs/<run-id>/evidence-bundle.json
analysis-runs/<run-id>/findings.json
analysis-runs/<run-id>/report.md
findings/latest.json
```

Không bắt buộc HTML/Canvas trong MVP.

### 20.3 Report sections

```txt
1. Scope and evidence boundary
2. Task Episode coverage
3. Five evaluation dimensions with states, not scores
4. Prioritized findings
5. Agent asset coverage
6. Applied/verified repair progress
7. Longitudinal interventions
8. Diagnostics and omitted evidence
```

### 20.4 Findings row

Mỗi row hiển thị:

- title;
- impact;
- evidence state;
- confidence;
- expected outcome;
- smallest owner;
- acceptance checks;
- linked proposal/repair state.

### 20.5 Private versus shareable projection

Private TUI report có thể dùng local diagnostic aliases. Nếu sau này export:

- remove absolute paths;
- remove stable session IDs;
- remove raw commands/prompts;
- use project-relative paths;
- use anonymous episode aliases;
- validate projection trước write.

### 20.6 Current report cleanup

Khi report contract mới được triển khai, remove hoặc cập nhật stale text trong
`src/report/report.js`, đặc biệt `Next Phase Gate` vẫn nói Phase 5 chưa bắt đầu
trong khi rule/proposal phases đã implemented.

### 20.7 Acceptance criteria

- TUI render chỉ project canonical data, không re-analyze.
- Markdown và TUI findings parity.
- Private diagnostics được đánh dấu rõ.
- Zero findings hợp lệ khi evidence không hỗ trợ finding.
- Missing evidence được hiển thị, không biến thành score/failure.

---

## 21. Improvement 15 — Repair callback and revision binding

### 21.1 Mục tiêu

Một action từ finding phải bind đúng:

```txt
workspace
findings ledger
finding id
finding revision
proposal id if any
```

### 21.2 Contract

```json
{
  "contract": "pi-harness.finding-repair/v1",
  "projectKey": "...",
  "findingsPath": "<private exact path>",
  "findingId": "F-0001",
  "expectedRevision": 0
}
```

### 21.3 Validation

- Exact file path exists under private Harness home.
- Finding exists exactly once.
- Revision matches.
- Current workspace topology matches finding target.
- Proposal target remains within owner authority.
- No search for “latest similar finding” as fallback.

### 21.4 Acceptance criteria

- Stale callback fails closed.
- Callback không tự authorize user-home/global writes.
- Manual direct fix vẫn tồn tại như workflow riêng, không giả thành finding repair.

---

## 22. Improvement 16 — Stronger host/session population binding

Pi-only vẫn cần binding chặt:

```txt
session population
→ selected sessions
→ admitted Task Episodes
→ reader counts
```

### Required diagnostics

```json
{
  "eligibleSessions": 5,
  "selectedSessions": 5,
  "candidateEpisodes": 4,
  "retainedEpisodes": 3,
  "discardedZeroSignalEpisodes": 1,
  "selectionPolicy": "latest-n-v1",
  "episodePolicy": "task-episode-v1"
}
```

Nếu report count không khớp binding, fail report generation thay vì silently
continue.

---

## 23. Improvement 17 — Learning opportunity coverage ladder

Trước khi đề xuất Skill, rule, prompt hoặc extension mới:

```txt
1. observed working coverage
2. built-in Pi capability
3. configured project capability
4. configured user capability if authorized
5. extend existing owner
6. create new owner
7. needs more evidence
```

### Example

Repeated multi-step extension review không tự động dẫn tới new Skill nếu:

- existing `AGENTS.md` + docs đã cover;
- prompt template đã có;
- workflow chỉ xuất hiện một lần;
- task family không comparable;
- current friction không rõ.

### Acceptance criteria

- Skill creation cần ít nhất hai comparable episodes hoặc explicit user request.
- Existing owner được ưu tiên trước create.
- User-home asset không được inspect nếu chưa authorize.
- Suggested owner selection có evidence refs.

---

## 24. Improvement 18 — Candidate defer/reject reasons

Để tránh mất dấu detector noise, lưu reason codes:

```txt
exact-duplicate
existing-coverage
no-observed-consequence
insufficient-task-boundary
unobserved-owner
no-validation-route
outside-authority
private-evidence-only
not-comparable
not-applicable
```

Các reason này giúp:

- tune detector false positives;
- giải thích vì sao count cao nhưng không có proposal;
- đánh giá LLM reviewer consistency;
- cải thiện target routing mà không expose private evidence.

---

## 25. Improvement 19 — Security and privacy hardening cho artifacts mới

### 25.1 Redaction before persistence

Mọi artifact mới phải đi qua current redaction/truncation policy:

```txt
analysis run
Task Episode
finding
validation receipt
intervention ledger
reader report
```

### 25.2 Path policy

Private artifacts có thể giữ exact local path khi cần binding. Reader projections:

- chỉ project-relative route;
- không user-home paths;
- không raw session path;
- không normalized cache absolute path.

### 25.3 Command policy

Validation receipt không ghi:

- environment values;
- auth args;
- secret-bearing output;
- full successful tool output.

### 25.4 Retention

Thêm config future-facing:

```json
{
  "retention": {
    "analysisRuns": 20,
    "validationReceipts": 100,
    "interventionHistoryDays": 365
  }
}
```

Không implement deletion automation trước khi có audit và dry-run.

---

## 26. Improvement 20 — API and command evolution

### 26.1 Runtime APIs đề xuất

```js
createAnalysisRun(options)
collectEvidenceBundle(run)
buildTaskEpisodes(run)
reviewCandidates(run)
writeFindings(run)
recordValidationReceipt(options)
recordRepairReview(options)
evaluateInterventions(options)
```

Tên cuối cùng có thể khác; API phải giữ capability ownership rõ.

### 26.2 Pi commands đề xuất

Giữ UX chính:

```txt
/harness
/harness-improve
/harness-proposals
/harness-apply
/harness-eval
/harness-mark
```

Có thể mở rộng dần:

```txt
/harness-verify P-0001
/harness-findings
```

Không thêm command nếu cùng workflow có thể tích hợp rõ vào `/harness` hoặc
`/harness-proposals`.

### 26.3 Backward compatibility

- Existing report remains available until findings report reaches parity.
- Legacy proposals without finding ID remain reviewable/applicable.
- Existing private cache schema remains readable.
- Schema migration must be explicit and tested.

---

## 27. Detailed implementation phases

### Phase A — Evidence run foundation

#### Deliverables

```txt
frozen analysis context
session population binding
selected population fingerprint
private analysis-run storage
shared run usage by report/reflection
```

#### Dependencies

Existing session discovery/cache pipeline.

#### DoD

- one run, one population;
- deterministic fingerprints;
- zero-session and partial states;
- report/reflection consistency tests.

#### Risk

Medium: changes orchestration and can expose timing races.

---

### Phase B — Workspace topology

#### Deliverables

```txt
workspace target resolver
repo/member/subtree/standalone contract
owner route binding
monorepo fixtures
```

#### Dependencies

Phase A context contract.

#### DoD

- Pi Learn package member resolves correctly;
- structured target paths are Git-root-relative;
- sibling/path escape rejected.

#### Risk

Medium-high because apply ownership changes.

---

### Phase C — Task Episode v1

#### Deliverables

```txt
episode candidate builder
episode schema
closure integration with /harness-mark
change/validation linking
fixtures
```

#### Dependencies

Phase A population binding.

#### DoD

- multiple tasks separated;
- relevant validation ordering retained;
- explicit unknown closure;
- reader-safe projection.

#### Risk

High semantic risk; feature-gate findings that depend on episodes.

---

### Phase D — Project and Agent Asset lanes

#### Deliverables

```txt
project evidence collector
agent asset baseline
coverage inspection
three-lane evidence bundle
```

#### Dependencies

Phases A and B.

#### DoD

- static mechanism boundaries explicit;
- existing rule coverage detected;
- no user-home reads without authority;
- lane statuses complete/partial/unavailable.

#### Risk

Medium; main risk is over-claiming from inventory.

---

### Phase E — Candidate review and findings

#### Deliverables

```txt
CandidateSignal schema
defer/reject reasons
evidence states
finding quality gates
findings ledger
proposal findingId linkage
```

#### Dependencies

Phases C and D.

#### DoD

- counts no longer directly create proposals;
- duplicate global rule case prevented;
- Missing versus Unobserved tested;
- legacy proposal compatibility.

#### Risk

High because proposal volume/behavior changes.

---

### Phase F — Findings-backed report

#### Deliverables

```txt
findings.json
Markdown projection
Pi TUI projection
private/shareable boundary
```

#### Dependencies

Phase E.

#### DoD

- Markdown/TUI parity;
- no private locators in reader projection;
- no score required;
- stale current report phase text removed.

#### Risk

Low-medium if old report remains available during migration.

---

### Phase G — Validation receipts and repair state

#### Deliverables

```txt
validation registry
receipt schema
proposal/finding revision binding
verified/partial/blocked state
optional independent repair review
```

#### Dependencies

Existing controlled apply + Phase E.

#### DoD

- apply does not imply verified;
- stale revisions rejected;
- argv-array execution only;
- redacted output persistence;
- rollback remains transactional.

#### Risk

High due command execution; start with built-in eval and npm test registry only.

---

### Phase H — Longitudinal intervention ledger

#### Deliverables

```txt
baseline contract
follow-up selection rule
comparability check
improved/unchanged/regressed decision
stop/revert handling
```

#### Dependencies

Task Episodes + verified repair receipts.

#### DoD

- same-window tests never count as later outcome;
- at least one synthetic before/after fixture;
- pending/incomparable states handled honestly.

#### Risk

High interpretation risk; keep conclusions conservative.

---

## 28. Recommended source ownership map

| Capability | Suggested owner |
|---|---|
| Frozen run/context | `packages/harness-runtime/src/analysis/` |
| Workspace topology | new narrow owner under `src/project/` or `src/workspace/` |
| Task Episodes | new narrow owner under `src/analysis/` or `src/session/` |
| Project evidence | new `src/project-evidence/`-style capability owner |
| Agent asset baseline | new `src/agent-assets/`-style capability owner |
| Candidate review | `src/analysis/` |
| Findings schema/storage | new `src/findings/` |
| Validation receipts | `src/eval/` or new `src/validation/`; choose one canonical owner |
| Intervention ledger | new `src/interventions/` or `src/analysis/` with explicit contract |
| TUI projection | `packages/pi-learn-extensions/extensions/harness/` |
| Private storage | existing `src/storage/` |
| Proposal linkage | existing `src/proposals/` |

Không tạo generic `core/`, `common/` hoặc service locator chỉ để chứa logic mới.

---

## 29. Existing code issues exposed by the comparison

Các mục dưới đây không phải toàn bộ audit, nhưng nên được xử lý trong migration
phù hợp.

### 29.1 Generic detector target paths

`rules.js` đang tạo một số target path không khớp layout package thực của repo.
Topology/owner binding phải sửa theo project-relative owner thực, không hardcode
một layout giả định.

### 29.2 Duplicate existing guidance

Repeated edit error detector có thể đề xuất rule đã tồn tại. Asset coverage
inspection phải chạy trước proposal promotion.

### 29.3 Single sensitive event promotion

Sensitive path threshold `1` nên tạo high-priority review lead, không trực tiếp
coi là confirmed redaction/policy defect.

### 29.4 Stale report phase copy

Current report vẫn có `Next Phase Gate` nói rule/proposal phase nên bắt đầu sau,
trong khi phase đó đã implemented. Report contract mới phải lấy current state từ
canonical owner hoặc bỏ phase copy khỏi runtime report.

### 29.5 Multiple discovery passes

Dashboard/report/reflection có thể dùng session population khác nhau. Phase A
phải sửa bằng shared frozen run.

### 29.6 Project key too broad for monorepo

Current Git-root-based key là hợp lý cho cache grouping nhưng chưa đủ cho finding
owner. Giữ project key và thêm workspace target; không nhất thiết đổi cache root
ngay.

---

## 30. What not to copy from Better Harness

### 30.1 Không copy complexity toàn bộ

Better Harness có phạm vi multi-host và report renderer lớn. Pi Harness không cần
mang toàn bộ adapter/rendering architecture vào repo.

### 30.2 Không thêm score sớm

State + evidence + confidence đủ cho MVP. Score có thể tạo precision giả.

### 30.3 Không bắt buộc ba LLM subagents

Pi Harness có thể bắt đầu với ba deterministic lanes và một current-session LLM
review. Independent subagents chỉ thêm khi có evidence rằng contamination là vấn
đề thực tế.

### 30.4 Không thêm HTML/Canvas trước findings quality

Pi TUI là primary UX. Dữ liệu đúng quan trọng hơn visual artifact mới.

### 30.5 Không generalize multi-host khi chưa có product need

Provider field trong schema là đủ. Không thêm adapters ngoài Pi chỉ vì upstream
có chúng.

### 30.6 Không biến findings thành maturity score

Harness review phải task-bounded, không phán xét toàn bộ repository chỉ từ vài
session gần nhất.

---

## 31. Test strategy

### 31.1 Unit tests

```txt
analysis context freeze
population fingerprints
workspace target resolution
Task Episode boundaries
change-validation linking
asset coverage
candidate eligibility
evidence state resolution
finding schema/lifecycle
validation receipt binding
intervention comparability
privacy projections
```

### 31.2 Integration fixtures

```txt
single repo
npm monorepo
multiple tasks in one session
active session mutation during run
existing rule + repeated failure
missing rule + repeated failure
authorized sensitive path access
unredacted secret regression
apply pass + validation fail
apply pass + validation pass
later task improved
later task regressed
incomparable later task
```

### 31.3 Existing required suite

Mọi runtime change:

```bash
npm --prefix packages/harness-runtime test
```

### 31.4 Pi manual verification

Sau extension/TUI change:

```txt
/reload
/harness
/harness-improve
/harness-proposals
/harness-eval
```

Với command mới nếu có:

```txt
/harness-findings
/harness-verify P-0001
```

### 31.5 Privacy tests

Assert reader artifacts không chứa:

```txt
~/.pi/agent/sessions
~/.pi/harness absolute path
raw prompt
stable raw session id
secret fixture value
environment assignment value
```

---

## 32. Migration strategy

### 32.1 Additive first

- Existing cache remains source.
- Frozen run and episodes are additive artifacts.
- Existing report stays available.
- Existing proposals remain valid.

### 32.2 Dual projection

Trong migration window:

```txt
legacy report
findings-backed report preview
```

So sánh output trên fixtures và một số manually authorized live runs trước khi
thay primary dashboard.

### 32.3 No silent schema rewrite

Nếu findings/proposals/cache schema đổi:

- version field bắt buộc;
- migration function có tests;
- historical private artifacts vẫn readable hoặc có explicit unsupported error;
- không mutate raw session files.

### 32.4 Feature gates

Có thể dùng config:

```json
{
  "features": {
    "analysisRuns": true,
    "taskEpisodes": false,
    "findings": false,
    "validationReceipts": false,
    "longitudinalEvaluation": false
  }
}
```

Config chỉ điều khiển feature activation, không chứa natural-language detector
parameters.

---

## 33. Metrics để đánh giá chính Harness improvement

Không dùng report score làm KPI. Theo dõi:

### Evidence quality

```txt
population binding conflicts
episode retention rate
unobserved versus missing rate
private projection validation failures
```

### Proposal quality

```txt
proposal acceptance rate
rejected due duplicate coverage
rejected due wrong owner
rejected due no consequence
manual-only proposal rate
```

### Repair quality

```txt
applied proposals with validation receipt
verified/partial/blocked ratio
rollback rate
stale revision rejection count
```

### Longitudinal quality

```txt
interventions with comparable follow-up
improved/unchanged/regressed ratio
incomparable follow-up rate
guardrail regressions
```

Các metric chỉ dùng để inspect Harness process; không tự động tối ưu threshold
hoặc auto-apply changes.

---

## 34. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Episode grouping sai | Nối nhầm task/failure/validation | Deterministic candidates, explicit unknown, fixtures, feature gate |
| Inventory bị coi là use | False confidence | Evidence states and lane isolation |
| Detector noise vẫn thành findings | Proposal spam | Candidate quality gates and defer reasons |
| Validation chạy command nguy hiểm | Workspace damage | Reviewed argv registry, no shell strings, confirmation |
| Monorepo target mismatch | Edit sai package | Frozen topology and owner binding |
| Reader report leak private refs | Privacy incident | Separate private/source and reader projections, validation |
| Score tạo precision giả | Misleading decisions | No score in MVP |
| Longitudinal comparison sai | False improvement claim | Comparability contract and guardrails |
| Migration phá proposal lifecycle | Loss of trust | Additive schema, legacy compatibility, transactional apply tests |
| Architecture phình nhanh | Maintenance burden | Phase gates, narrow owners, no multi-host/rendering expansion |

---

## 35. Prioritized backlog

### P0 — Nền tảng cần làm trước

1. Frozen analysis run và shared session population.
2. Workspace target/owner route tối thiểu.
3. Task Episode v1.
4. Project evidence lane.
5. Agent asset baseline.
6. CandidateSignal tách khỏi direct proposal.
7. Existing coverage check trước proposal.

### P1 — Findings và verified repair

1. Evidence states.
2. Findings ledger.
3. Proposal → finding linkage.
4. Findings-backed Markdown/TUI report.
5. Validation receipt.
6. Applied versus verified state.
7. Stale revision protection.

### P2 — Learning loop dài hạn

1. Intervention ledger.
2. Comparable follow-up selection.
3. Improved/unchanged/regressed decision.
4. Guardrail metrics.
5. Optional independent post-fix review.

### P3 — Chỉ làm khi evidence cho thấy cần

1. Scores/calibration.
2. Independent multi-agent specialists.
3. Shareable HTML report.
4. Additional providers/hosts.
5. Automated retention cleanup.

---

## 36. Recommended first three implementation slices

### Slice 1 — One run, one population

```txt
analysis-run contract
shared session discovery
fingerprints
report/reflection binding
```

Expected value: loại bỏ evidence drift mà chưa thay semantic model.

### Slice 2 — Existing coverage before proposal

```txt
project Rules/AGENTS asset inventory
open applicable content
CandidateSignal output
prevent duplicate GLOBAL-EDIT-001 proposal
```

Expected value: giảm proposal noise ngay, scope nhỏ hơn Task Episode rollout đầy đủ.

### Slice 3 — Task Episode and validation linkage

```txt
episode candidates
/harness-mark closure
change/validation sets
Unobserved closure
```

Expected value: tạo nền tảng cho findings và longitudinal evaluation.

---

## 37. Overall Definition of Done

Kế hoạch được xem là hoàn thành khi Pi Harness có thể:

1. Freeze một analysis run với exact session population.
2. Xây Task Episodes mà không gộp unrelated goals.
3. Thu thập riêng Session, Project và Agent Asset evidence.
4. Phân biệt mechanism Present/Wired/Exercised/Outcome-supported.
5. Giữ Missing khác Unobserved.
6. Chuyển detectors thành review leads trước khi tạo finding/proposal.
7. Không đề xuất duplicate owner khi applicable coverage đã tồn tại.
8. Tạo stable finding identity tách khỏi proposal identity.
9. Bind apply vào exact owner, finding revision và proposal target.
10. Ghi validation receipt mà không execute arbitrary LLM shell text.
11. Phân biệt applied, verified và later improved.
12. Đánh giá later comparable Task Episodes với guardrails.
13. Giữ raw/private evidence ngoài repository và ngoài reader projection.
14. Giữ controlled apply transactional và rollback-safe.
15. Duy trì toàn bộ Harness runtime test suite và focused fixtures cho capability mới.

---

## 38. Final recommendation

Pi Harness không cần trở thành bản sao Better Harness. Target phù hợp là:

```txt
Pi-native session observability and safe self-improvement
+ Better Harness-style evidence discipline
+ Task Episode review
+ mechanism/use/outcome separation
+ verified repair
+ longitudinal learning
```

Thứ tự quan trọng nhất:

```txt
freeze evidence
→ build Task Episodes
→ inspect project/assets
→ review candidates
→ create findings
→ draft/apply proposals
→ verify repair
→ wait for comparable later outcomes
```

Không đảo thứ tự bằng cách thêm score, visual report hoặc auto-fix trước khi
evidence binding và Task Episode contract ổn định.
