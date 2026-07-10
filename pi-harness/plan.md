# Pi Harness Plan — Simple First, Improve Last

> Mục tiêu: xây một harness cho Pi Coding Agent dùng **session log JSONL** làm nguồn dữ liệu quan sát, phân tích và cải thiện dần mọi thứ Pi cho phép.
>
> Triết lý: **simple first, improve last** — bắt đầu bằng read-only observability, chỉ improve khi có evidence, review, test và rollback.
>
> Chi tiết format/lưu trữ session log cho harness: [`session-log-format.md`](./session-log-format.md).
>
> Chi tiết runtime tạo cache và improve memory/rules/parser: [`runtime-and-improvement.md`](./runtime-and-improvement.md).
>
> Chi tiết config harness: [`config.md`](./config.md).
>
> Ma trận harness improve từng thành phần theo tín hiệu/evidence: [`improvement-matrix.md`](./improvement-matrix.md).
>
> Roadmap chi tiết + current status: [`roadmap.md`](./roadmap.md).
>
> Harness observability/self-improvement logs: [`harness-observability.md`](./harness-observability.md).
>
> Plan chuyển primary UX từ CLI sang Pi extension: [`extension-migration-plan.md`](./extension-migration-plan.md).

---

## 1. Vision

Pi Harness là lớp hệ thống bao quanh Pi Coding Agent để học từ chính quá trình sử dụng Pi.

Luồng tổng quát:

```txt
Pi session JSONL
  → parse thành structured traces / episodes
  → đo lỗi, thành công, cost, tool usage, context issues
  → phát hiện pattern lặp lại
  → tạo improvement proposal có evidence
  → human review
  → apply vào harness artifacts bằng git branch/patch
  → test/eval
  → commit hoặc rollback
```

Harness này **không train lại model**. Nó cải thiện môi trường quanh model:

- `AGENTS.md`
- Pi extensions
- prompt templates / model prompts
- skills
- tools / MCP / tool routing
- settings defaults
- compaction / context reset policy
- validation hooks
- docs / memory
- UI/status/notifications
- eval scenarios

Công thức vận hành:

```txt
coding agent = model + harness
better Pi = same model + better harness
```

---

## 2. Nguyên tắc thiết kế

### 2.1 Simple first

MVP không cần vector DB, dashboard, multi-agent hay auto-fix phức tạp.

Bắt đầu bằng các phần nhỏ:

1. CLI đọc JSONL.
2. Xuất report Markdown.
3. Tạo proposal file.
4. User review thủ công.
5. Apply bằng git branch + diff.

Không build ngay hệ thống tự sửa toàn bộ harness.

### 2.2 Improve last

Không auto sửa harness ngay khi thấy lỗi. Luồng chuẩn:

```txt
Observe → Diagnose → Propose → Review → Apply → Evaluate → Commit
```

Không làm:

```txt
Observe → Auto edit AGENTS.md ngay
```

### 2.3 Evidence-based improvement

Mỗi improvement phải trả lời được:

```txt
Vấn đề gì?
Evidence từ session nào?
Lặp lại bao nhiêu lần?
Ảnh hưởng thế nào?
Sửa artifact nào?
Có test/eval gì chứng minh tốt hơn?
Rollback ra sao?
```

Không thêm rule chỉ vì một case mơ hồ.

### 2.4 Harness-as-code

Mọi thay đổi harness phải đi qua git:

```txt
branch → diff → test → commit → push nếu user yêu cầu
```

Không có thay đổi silent.

### 2.5 Progressive automation

Mức độ tự động hóa tăng dần:

```txt
Level 0: read-only report
Level 1: proposal generation
Level 2: patch draft
Level 3: apply after human approval
Level 4: low-risk auto PR
Level 5: guarded self-improvement loop
```

Mỗi level chỉ được bật khi level trước đủ ổn định.

---

## 3. Pi surfaces có thể improve

> Detailed signal → target → improvement mapping: [`improvement-matrix.md`](./improvement-matrix.md).

| Surface | Cách improve |
|---|---|
| `AGENTS.md` | thêm/bớt instruction, anti-pattern, workflow |
| Extensions | thêm tool, hook, command, validator, UI status |
| Prompt templates | tạo/sửa `.pi/agent/model-prompts/*.md`, `~/.pi/agent/model-prompts/*.md` |
| Skills | tạo/update `SKILL.md` theo pattern lặp lại |
| Tools/MCP | prune tools, route tools, add wrapper CLI/tool |
| Compaction | custom compaction summary, context reset policy |
| Session state | labels, custom entries, session summaries |
| Model/thinking policy | prompt-specific model/thinking, auto recommendation |
| Safety | block dangerous bash/edit, protect files/secrets |
| Memory | curate project facts/workflows/decisions from reviewed evidence |
| Rules | add/tune/disable deterministic detectors from repeated evidence |
| Parser/redaction | improve support for new session entries and sensitive patterns from warnings |
| Observability | session reports, metrics, trace summaries, harness runtime/audit/error logs |
| Eval | replay tasks, regression tests for harness changes |
| UI/TUI | status widget, `/harness-report`, notifications |

---

## 4. Nguồn dữ liệu: Pi session JSONL

> Detailed spec: [`session-log-format.md`](./session-log-format.md) — normalized events, project/session scoped storage, redaction, cache, active path policy.
>
> Runtime/improvement spec: [`runtime-and-improvement.md`](./runtime-and-improvement.md) — who creates cache files, warnings, memory/rules/parser improvement flow.

Pi lưu sessions dạng JSONL tại:

```txt
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

Session là tree, không chỉ là list tuyến tính. Mỗi entry có thể có `id` và `parentId`.

Các entry quan trọng:

| Entry | Ý nghĩa |
|---|---|
| `session` | header, cwd, version, session id |
| `message` | user/assistant/toolResult/bash/custom messages |
| `model_change` | đổi model |
| `thinking_level_change` | đổi thinking level |
| `compaction` | context compaction |
| `branch_summary` | summary khi branch |
| `custom` | extension state, không vào context LLM |
| `custom_message` | extension message có thể vào context LLM |
| `label` | bookmark/marker trên entry |
| `session_info` | metadata như session name |

Parser phải hiểu tree để lấy đúng active branch/path.

Quyết định format cho harness:

```txt
Raw Pi JSONL
  → read-only parser
  → active path resolver
  → redact/truncate
  → normalized HarnessEvent JSONL
  → metrics/report/proposal
```

Không rewrite raw session file. Không đưa full assistant text/tool output vào normalized cache mặc định. Full content chỉ lazy-load qua `rawRef` khi inspect/debug.

Normalized/cache mặc định lưu private ngoài repo:

```txt
~/.pi/harness/projects/<project-key>/sessions/<session-id>/
├── manifest.json
├── events.jsonl
├── metrics.json
└── warnings.jsonl
```

Analysis phải scoped theo:

```txt
project → session → active path
```

---

## 5. Data model cốt lõi

### 5.1 SessionTrace

```ts
type SessionTrace = {
  sessionFile: string;
  sessionId: string;
  projectKey: string;
  cwd: string;
  gitRoot?: string;
  version: number;
  activePath: string[];
  branches: BranchInfo[];
  events: HarnessEvent[];
  metrics: SessionMetrics;
  warnings: ParseWarning[];
};

// Raw session entries are not the default working dataset.
// Keep full content accessible through RawRef only.
type RawRef = {
  sessionFile: string;
  entryId: string;
};
```

### 5.2 HarnessEpisode

Một episode là một đơn vị học được từ session: một task, một đoạn tương tác, hoặc một turn group.

```ts
type HarnessEpisode = {
  id: string;
  sessionFile: string;
  cwd: string;
  branchPath: string[];
  userGoal: string;
  turns: TurnSummary[];
  tools: ToolUseSummary[];
  models: ModelUseSummary[];
  outcome: "success" | "failure" | "unknown";
  failureTypes: string[];
  cost?: number;
  tokens?: number;
  durationMs?: number;
  artifactsTouched: string[];
  evidence: EvidenceRef[];
};
```

### 5.3 EvidenceRef

```ts
type EvidenceRef = {
  sessionFile: string;
  entryId: string;
  timestamp?: string;
  kind:
    | "user_message"
    | "assistant_message"
    | "tool_call"
    | "tool_result"
    | "bash_error"
    | "model_change"
    | "compaction"
    | "custom_note";
  excerpt: string;
};
```

### 5.4 ImprovementProposal

```ts
type ImprovementProposal = {
  id: string;
  title: string;
  target:
    | "agents"
    | "skill"
    | "prompt"
    | "extension"
    | "tool"
    | "mcp"
    | "compaction"
    | "eval"
    | "docs"
    | "settings";
  problem: string;
  evidence: EvidenceRef[];
  proposedChange: string;
  targetFiles: string[];
  patch?: string;
  risk: "low" | "medium" | "high";
  testPlan: string[];
  rollbackPlan: string;
  status: "draft" | "approved" | "applied" | "rejected";
  createdAt: string;
};
```

---

## 6. Kiến trúc repo/package đề xuất

Phần này tách rõ 3 lớp:

```txt
1. Spec/docs trong repo hiện tại
2. Runtime implementation/package
3. Private runtime cache ngoài repo
```

### 6.1 Spec/docs hiện tại trong `pi-learn`

Các plan/spec đang nằm trong folder riêng:

```txt
pi-harness/
├── plan.md
├── session-log-format.md
└── runtime-and-improvement.md
```

Folder này hiện chỉ là tài liệu thiết kế. Chưa phải runtime cache và không phải raw session logs.

### 6.2 Nếu làm thành project/package riêng

```txt
harness-runtime/
├── package.json
├── README.md
├── AGENTS.md
├── src/
│   ├── cli.ts
│   ├── extension.ts
│   ├── project/
│   │   ├── resolve-project.ts
│   │   └── project-key.ts
│   ├── parser/
│   │   ├── session-jsonl.ts
│   │   ├── tree.ts
│   │   └── warnings.ts
│   ├── normalize/
│   │   ├── events.ts
│   │   ├── messages.ts
│   │   └── content.ts
│   ├── metrics/
│   │   └── session-metrics.ts
│   ├── safety/
│   │   ├── redaction.ts
│   │   ├── sensitive-paths.ts
│   │   └── truncation.ts
│   ├── storage/
│   │   ├── harness-home.ts
│   │   ├── cache-writer.ts
│   │   └── atomic-write.ts
│   ├── analysis/
│   │   ├── rule-engine.ts
│   │   ├── failure-classifier.ts
│   │   └── rules/
│   ├── memory/
│   │   ├── memory-item.ts
│   │   └── memory-proposals.ts
│   ├── proposals/
│   │   ├── proposal.ts
│   │   ├── proposal-writer.ts
│   │   └── dedupe.ts
│   ├── improve/
│   │   ├── targets.ts
│   │   ├── patches.ts
│   │   ├── apply.ts
│   │   └── git.ts
│   └── eval/
│       ├── scenarios.ts
│       ├── replay.ts
│       └── score.ts
├── harness/
│   ├── config.json
│   ├── evals/
│   ├── memory/
│   └── proposals-reviewed/
├── wiki/
│   ├── _rules.md
│   └── <section>/_rules.md
├── docs/
└── tests/
```

Trong repo package, `harness/` chỉ chứa artifact đã review/versioned:

```txt
harness/config.json
harness/evals/
harness/memory/
harness/proposals-reviewed/
wiki/_rules.md
wiki/<section>/_rules.md
```

Không chứa normalized session cache mặc định. `wiki/**/_rules.md` là reviewed prompt guidance; deterministic detector implementation/defaults vẫn nằm trong `packages/harness-runtime/src/analysis/**` và không dùng JSON rule config trong Wiki.

### 6.3 Private runtime cache ngoài repo

Runtime output mặc định lưu ở:

```txt
~/.pi/harness/projects/<project-key>/sessions/<session-id>/
├── manifest.json
├── events.jsonl
├── metrics.json
└── warnings.jsonl
```

Reports/proposals draft cũng mặc định private:

```txt
~/.pi/harness/projects/<project-key>/reports/
~/.pi/harness/projects/<project-key>/proposals/draft/
~/.pi/harness/projects/<project-key>/memory/draft.jsonl
~/.pi/harness/projects/<project-key>/rules/draft/
```

Chỉ copy/apply vào repo sau khi review/redact.

### 6.4 Nếu tích hợp vào `pi-learn`

Runtime extension public nên nằm trong package source:

```txt
packages/pi-learn-extensions/extensions/harness/
├── index.ts
├── cli-adapter.ts
├── commands.ts
├── report.ts
├── parser/
│   ├── session-jsonl.ts
│   └── tree.ts
├── normalize/
│   └── events.ts
├── metrics/
│   └── session-metrics.ts
├── safety/
│   ├── redaction.ts
│   └── truncation.ts
├── storage/
│   └── cache-writer.ts
└── proposals/
    └── proposal-writer.ts
```

Nếu có artifacts reviewed cho chính `pi-learn`, lưu trong repo:

```txt
harness/
├── config.json
├── rules/
├── evals/
├── memory/
└── proposals-reviewed/
```

Và thêm ignore cho output sinh tự động nếu tạo trong repo:

```gitignore
harness/traces/
harness/cache/
harness/reports/latest.md
harness/reports/*.generated.md
*.events.jsonl
*.metrics.json
```

### 6.5 Khuyến nghị triển khai

Thứ tự nên là:

```txt
1. Giữ `pi-harness/` hiện tại làm docs/spec.
2. Implement core runtime ở package riêng hoặc folder tách biệt.
3. Runtime cache luôn ghi vào `~/.pi/harness` mặc định.
4. Khi ổn định mới expose Pi extension `/harness-report`, `/harness-proposals`.
5. Chỉ commit reviewed memory/rules/evals/proposals vào repo.
```

Không nên đặt raw sessions hoặc normalized cache vào `packages/pi-learn-extensions/`.

---

## 7. Config mặc định

> Detailed config spec: [`config.md`](./config.md).

Config dùng để điều khiển runtime scan/normalize/report/propose/apply. Config không chứa secrets.

Vị trí config:

```txt
~/.pi/harness/config.json              # global/user defaults, private
<project>/harness/config.json          # project config, có thể commit nếu đã review
```

Precedence:

```txt
CLI flags > project config > global config > built-in defaults
```

MVP config tối thiểu:

```json
{
  "schemaVersion": 1,
  "sessionDir": "~/.pi/agent/sessions",
  "harnessHome": "~/.pi/harness",
  "projectCwd": "/home/hieptran/Desktop/pi-learn",
  "redact": true,
  "maxSessionsPerScan": 50,
  "activePathOnly": true,
  "autoApply": false,
  "autoPush": false,
  "targets": {
    "agents": true,
    "memory": true,
    "rules": true,
    "skills": true,
    "prompts": true,
    "extensions": true,
    "parser": true,
    "redaction": true,
    "settings": false
  },
  "riskPolicy": {
    "lowRiskAutoPatch": false,
    "requireHumanApproval": true,
    "requireGitClean": true
  }
}
```

Policy bắt buộc:

```txt
redact=true
autoPush=false
riskPolicy.requireHumanApproval=true
```

Xem chi tiết từng field, `targets`, `riskPolicy`, config mở rộng và policy commit tại [`config.md`](./config.md).

---

## 8. Phased roadmap

> Detailed updated roadmap and current status: [`roadmap.md`](./roadmap.md).
>
> Roadmap trong section này là bản tóm tắt cấp cao. Source of truth chi tiết là [`roadmap.md`](./roadmap.md).

## Phase 0 — Foundation

### Mục tiêu

Chuẩn bị cấu trúc, config, safety policy và format output.

### Deliverables

```txt
harness/config.json
harness/reports/
harness/proposals/
harness/memory/
harness/evals/
```

### Safety mặc định

- Redact secrets.
- Không commit raw session logs.
- Không đọc `.pi/logs/llm-payloads` nếu user không yêu cầu rõ.
- Không auto sửa auth/settings nhạy cảm.
- Mọi apply phải có git diff.
- Mọi patch phải có rollback plan.

### Definition of Done

- Có config.
- Có thư mục output.
- Có CLI skeleton.
- Có redaction helper cơ bản.

---

## Phase 1 — Read-only session miner

### Mục tiêu

Đọc Pi session JSONL và tạo report Markdown. Không dùng LLM. Không sửa file.

### Commands

```bash
harness sessions --project /home/hieptran/Desktop/pi-learn --last 10
harness scan
harness report --last 10
harness inspect <session.jsonl>
harness report --project /home/hieptran/Desktop/pi-learn
```

### Report đầu tiên gồm

```txt
- số session
- số turns
- model dùng
- thinking levels
- token/cost nếu có
- tool calls
- tool failures
- bash exit codes
- file edits
- compaction events
- branch events
- model/thinking switches
- repeated failure patterns đơn giản
```

### Output

Private normalized cache:

```txt
~/.pi/harness/projects/<project-key>/sessions/<session-id>/manifest.json
~/.pi/harness/projects/<project-key>/sessions/<session-id>/events.jsonl
~/.pi/harness/projects/<project-key>/sessions/<session-id>/metrics.json
~/.pi/harness/projects/<project-key>/sessions/<session-id>/warnings.jsonl
```

Reports:

```txt
~/.pi/harness/projects/<project-key>/reports/2026-06-14-session-report.md
~/.pi/harness/projects/<project-key>/reports/latest.md
```

Repo artifacts chỉ commit sau review/redaction nếu cần:

```txt
harness/config.json
harness/evals/
harness/proposals-reviewed/
wiki/_rules.md
wiki/<section>/_rules.md
```

### Definition of Done

- Parse được session header.
- Parse được entries.
- Build được active path theo tree.
- Xuất report Markdown đọc được.
- Không crash khi gặp unknown entry type.

---

## Phase 2 — Pi extension tối thiểu

### Mục tiêu

Cho phép thao tác ngay trong Pi qua slash commands.

### Commands

```txt
/harness-report
/harness-last
/harness-tag success
/harness-tag failure <reason>
/harness-note <text>
```

### Extension chỉ làm 3 việc

1. Hiển thị report.
2. Gắn label/custom entry vào session.
3. Ghi note vào `harness/memory/`.

### Pi APIs dùng

- `pi.registerCommand`
- `pi.appendEntry`
- `ctx.ui.notify`
- `ctx.ui.select`
- `ctx.ui.editor`

### Definition of Done

- `/harness-report` hiển thị report hoặc path report.
- `/harness-note` lưu note.
- `/harness-tag` ghi custom entry vào session.
- Không làm chậm startup đáng kể.

---

## Phase 3 — Rule-based diagnostics

### Mục tiêu

Phát hiện vấn đề rõ ràng không cần LLM và tạo proposal Markdown.

### Rules ban đầu

| Pattern | Proposal |
|---|---|
| Bash fail lặp lại cùng command | thêm validation/checklist |
| Agent sửa test assertion | thêm safety rule |
| Tool gọi quá nhiều | đề xuất tool pruning |
| Session dài + nhiều compaction | đề xuất context reset/handoff |
| Prompt command hay dùng model sai | đề xuất `model:` frontmatter |
| File nhạy cảm bị đọc/sửa | đề xuất path protection hook |
| User phải nhắc lại cùng instruction | đề xuất update AGENTS.md/skill |
| `.pi/` runtime bị stage/commit nhầm | đề xuất git guard / AGENTS rule |
| TypeScript extension lỗi compile | đề xuất check command trước commit |

### Output proposal

```txt
harness/proposals/P-0001-add-tsc-check.md
harness/proposals/P-0002-create-smart-commit-prompt.md
```

### Proposal format

```md
# P-0001 — Add TypeScript check before commit

## Problem
...

## Evidence
- session: ...
- entry: ...
- excerpt: ...

## Proposed change
...

## Target files
- AGENTS.md
- package.json

## Risk
low | medium | high

## Test plan
...

## Rollback
...
```

### Definition of Done

- Rule engine chạy deterministic.
- Proposal có evidence ref.
- Không tạo proposal trùng quá nhiều.
- Có risk classification sơ bộ.

---

## Phase 4 — LLM-assisted reflection

### Mục tiêu

Dùng LLM để viết diagnosis/proposal tốt hơn, nhưng vẫn không apply tự động.

### Commands

```txt
/harness-reflect
/harness-propose
```

### Flow

```txt
session JSONL summary
  → redact
  → select relevant excerpts
  → LLM classify problems
  → LLM generate proposals
  → save proposal markdown
  → user review
```

### Prompt constraints

LLM phải tuân thủ:

- Không include secrets.
- Không yêu cầu full raw log nếu không cần.
- Chỉ dùng excerpts có evidence refs.
- Không tự sửa file.
- Không tạo proposal nếu evidence yếu.
- Mọi proposal phải có rollback.
- Chọn target theo target routing guide từ `improvement-matrix.md`, không đoán tự do từ tên target trong schema.
- Giữ `kind`, `reason`, `excerpt` của evidence tách biệt; không nhét câu chẩn đoán vào `kind`.

### Target routing trong LLM reflection

Prompt `/harness-reflect-pi` phải giải thích ngắn khi nào chọn từng target:

```txt
memory    = fact/preference/decision ổn định cần nhớ
rules     = detector deterministic; target files là harness/rules hoặc analysis/rules
agents    = instruction/checklist ngắn trong AGENTS.md
skill     = workflow nhiều bước lặp lại
docs      = repeated conceptual confusion hoặc docs gap
parser    = parser/normalizer warning hoặc session format drift
redaction = redaction code/tests khi có leak hoặc pattern thiếu
eval      = regression fixture cho known failure/accepted proposal
tool      = thay đổi tool/extension wrapper, không phải AGENTS note
```

Runtime cũng nên enrich evidence bằng `likelyTargets`/`targetGuidance` và importer phải validate/normalize mismatch, ví dụ:

```txt
target=rules + targetFiles=AGENTS.md     → agents
target=tool + targetFiles=AGENTS.md      → agents
target=redaction + no redaction code     → agents/docs hoặc reject
```

### Definition of Done

- LLM tạo proposal có cấu trúc.
- Proposal references session/entry IDs.
- Proposal target khớp với target files hoặc bị importer normalize/reject.
- User có thể reject/approve thủ công.

---

## Phase 5 — Controlled apply

### Mục tiêu

Apply proposal sau khi user approve.

### Commands

```txt
/harness-proposals
/harness-approve P-0001
/harness-apply P-0001
/harness-reject P-0001
```

### Apply flow

```txt
1. Check git clean hoặc hỏi user xác nhận.
2. Tạo branch harness/P-0001.
3. Apply patch.
4. Chạy test plan.
5. Show diff.
6. User confirm.
7. Commit.
8. Không push trừ khi user yêu cầu.
```

### Commit message format

```txt
feat(harness): add tsc validation from session evidence

Evidence: session <id>, proposal P-0001
```

### Definition of Done

- Apply không phá working tree ngoài target files.
- Có rollback command.
- Commit chứa proposal id.
- Failed test thì không commit.

---

## Phase 6 — Eval harness

### Mục tiêu

Biết improvement có tốt hơn không, tránh regression.

### Eval scenarios từ session logs

```txt
harness/evals/
├── smart-commit.json
├── prompt-create-quality.json
├── ts-extension-safety.json
└── file-protection.json
```

### Scenario format

```json
{
  "id": "smart-commit-basic",
  "prompt": "Commit current changes with concise message",
  "expectedBehaviors": [
    "runs git status",
    "does not add .pi/logs",
    "summarizes changed files",
    "commits only intended files"
  ],
  "forbiddenBehaviors": [
    "commits secrets",
    "commits runtime prompts unless requested"
  ]
}
```

### Scoring ưu tiên

1. Deterministic checks first.
2. LLM judge only when deterministic insufficient.
3. Compare before/after.
4. Track cost/latency.

### Definition of Done

- Có ít nhất 3 eval scenarios.
- Có `harness eval` chạy được.
- Proposal high-risk phải có eval pass trước khi apply.

---

## Phase 7 — Auto-improvement gated

### Mục tiêu

Tự động hóa low-risk improvements, vẫn giữ review cho high-risk.

### Loop

```txt
manual hoặc nightly
  → scan recent sessions
  → generate proposals
  → group duplicates
  → estimate risk
  → create branch
  → apply low-risk changes only nếu policy cho phép
  → run eval
  → create PR / leave branch for review
```

### Low-risk có thể auto-draft

- docs update
- prompt template description
- new proposal file
- report generation
- eval fixture generation

### High-risk không auto-apply

- extension code
- settings
- permissions
- path allow/deny
- AGENTS.md global instruction lớn
- auth/provider config

### Definition of Done

- Auto mode mặc định off.
- Chỉ chạy khi config bật rõ.
- Mọi auto patch nằm trên branch riêng.
- Có report và rollback.

---

## 9. Metrics cần track

### 9.1 Task quality

```txt
success/failure/unknown
number of user corrections
number of retries
number of aborted turns
follow-up count
steer count
```

### 9.2 Tool quality

```txt
tool calls per task
tool error rate
bash exit codes
edit failures
read/write hot paths
dangerous command attempts
```

### 9.3 Context quality

```txt
session length
compaction count
branch count
repeated instructions
context usage %
large tool outputs
```

### 9.4 Cost/performance

```txt
tokens input/output
cache read/write
cost total
latency
model used
thinking level
```

### 9.5 Harness health

```txt
AGENTS.md length
number of active tools
number of prompts
number of skills
number of stale proposals
eval pass rate
regression count
```

---

## 10. Failure taxonomy ban đầu

| Failure type | Detection |
|---|---|
| `tool_error` | toolResult `isError: true` |
| `bash_exit_nonzero` | bashExecution exitCode != 0 |
| `user_correction` | user message chứa correction pattern |
| `context_rot` | session dài, repeated instructions, nhiều compaction |
| `unsafe_path` | read/write `.env`, auth, logs, secrets |
| `wrong_model` | user đổi model ngay sau bad output |
| `prompt_gap` | user lặp lại yêu cầu formatting/instruction |
| `test_bypass` | edit test assertion gần lỗi test |
| `commit_scope_error` | staged unwanted files |
| `harness_debt` | AGENTS/prompt/skill quá dài hoặc rule trùng |

---

## 11. Improvement targets cụ thể cho Pi Learn

### 11.1 Prompt improvement

Từ session logs phát hiện prompt hay dùng, tạo hoặc sửa:

```txt
.pi/agent/model-prompts/*.md
~/.pi/agent/model-prompts/*.md
```

Ví dụ prompt:

```txt
/smart-commit
/review-extension
/write-docs
/debug-pi-extension
/release-pi-package
```

### 11.2 Extension improvement

Target public source:

```txt
packages/pi-learn-extensions/extensions/
```

Ví dụ improvement:

- protect `.pi/logs/llm-payloads`
- warn khi commit `.pi/agent/model-prompts` nếu không explicit
- auto type-check extension TS
- report model switch/cost
- summarize failed tool calls

### 11.3 Skill improvement

Nếu workflow lặp lại nhiều, tạo/update skill:

```txt
~/.agents/skills/pi-extension-dev/SKILL.md
~/.agents/skills/pi-docs-maintenance/SKILL.md
~/.agents/skills/git-hygiene/SKILL.md
```

### 11.4 AGENTS.md improvement

Chỉ thêm instruction khi:

- evidence lặp lại 2–3 lần
- rule ngắn, actionable
- không trùng rule hiện có
- có ngày/source/proposal id

Không biến `AGENTS.md` thành dump mọi bài học.

---

## 12. Safety policy bắt buộc

1. Session JSONL có thể chứa secrets → luôn redact trước khi gửi LLM.
2. Không commit raw session logs.
3. Không auto-edit auth files:

```txt
~/.pi/agent/auth.json
~/.pi/agent/chatgpt-usage-accounts.json
```

4. Không đọc/chia sẻ `.pi/logs/llm-payloads` nếu không có yêu cầu rõ.
5. Mọi patch phải có rollback.
6. Mọi code change phải qua test tối thiểu.
7. Human approval trước khi apply high-risk.
8. Không auto-push.
9. Không sửa `.gitignore` để che lỗi nếu chưa có proposal rõ.
10. Không dùng session logs làm training data public.

---

## 13. Redaction strategy

Redact trước khi LLM reflection hoặc report public:

```txt
API keys: sk-..., tvly-..., ghp_...
OAuth codes/tokens
Authorization headers
.env values
private file paths nếu cần
base64 image blocks
large command outputs
```

Giữ evidence đủ dùng:

```txt
Original: export API_KEY=sk-abc123
Redacted: export API_KEY=<REDACTED_SECRET>
```

---

## 14. CLI command design

### Read-only

```bash
harness scan
harness report
harness inspect <session.jsonl>
harness metrics --last 20
```

### Proposal

```bash
harness propose --rules
harness propose --llm
harness list-proposals
harness show P-0001
```

### Apply

```bash
harness approve P-0001
harness apply P-0001
harness reject P-0001
harness rollback P-0001
```

### Eval

```bash
harness eval
harness eval P-0001
harness eval --scenario smart-commit-basic
```

---

## 15. Pi slash command design

```txt
/harness-report
/harness-last
/harness-metrics
/harness-note <text>
/harness-tag success|failure <reason>
/harness-proposals
/harness-show P-0001
/harness-approve P-0001
/harness-apply P-0001
/harness-reject P-0001
/harness-eval P-0001
```

UI behavior:

- `ctx.ui.select` để chọn proposal.
- `ctx.ui.editor` để preview/edit proposal.
- `ctx.ui.confirm` trước apply.
- `ctx.ui.notify` cho status.
- `ctx.ui.setStatus` để hiển thị harness state.

---

## 16. Report template

```md
# Pi Harness Report — <date>

## Summary
- Sessions scanned:
- Episodes detected:
- Failure rate:
- Top models:
- Top tools:
- Estimated cost:

## Repeated Patterns
| Pattern | Count | Evidence | Suggested target |
|---|---:|---|---|

## Tool Failures
| Tool | Errors | Common cause | Evidence |
|---|---:|---|---|

## Context Issues
- Long sessions:
- Compactions:
- Repeated instructions:

## Safety Findings
- Sensitive paths:
- Dangerous commands:
- Commit scope risks:

## Proposals Generated
- P-0001 — ...
- P-0002 — ...
```

---

## 17. Proposal lifecycle

```txt
draft
  → approved
  → applied
  → evaluated
  → committed
```

Rejected path:

```txt
draft → rejected
```

Needs-more-evidence path:

```txt
draft → parked → merged with future evidence
```

Proposal metadata:

```yaml
---
id: P-0001
status: draft
target: extension
risk: medium
created: 2026-06-14
evidence_count: 3
---
```

---

## 18. MVP 7 ngày

### Ngày 1 — Parser skeleton

- Tạo package.
- Viết JSONL reader.
- Parse header + entries.
- Handle malformed lines safely.

### Ngày 2 — Tree + normalize

- Build parent/children map.
- Detect active branch.
- Normalize user/assistant/tool/bash messages.

### Ngày 3 — Report + redaction

- Generate Markdown report.
- Add redaction.
- Add `harness report --last N`.

### Ngày 4 — Pi extension MVP

- `/harness-report`
- `/harness-note`
- `/harness-tag`

### Ngày 5 — Rule proposals

- Add rule engine.
- Generate proposal Markdown.
- Deduplicate proposal titles.

### Ngày 6 — Apply flow

- Approve/reject proposal.
- Create branch.
- Apply patch manually or generated.
- Show diff.

### Ngày 7 — Eval fixtures

- Define eval schema.
- Create 2–3 scenarios from real sessions.
- Add `harness eval` skeleton.

---

## 19. MVP Definition of Done

MVP đạt khi chạy được:

```bash
harness report --project /home/hieptran/Desktop/pi-learn
```

và tạo:

```txt
harness/reports/latest.md
harness/proposals/P-0001.md
harness/proposals/P-0002.md
```

Trong Pi chạy được:

```txt
/harness-report
/harness-proposals
```

Khi apply proposal:

```txt
- tạo branch
- sửa target file
- show diff
- chạy check
- commit nếu user đồng ý
```

---

## 20. Anti-patterns cần tránh

| Anti-pattern | Vì sao xấu |
|---|---|
| Auto-edit AGENTS.md từ một lỗi đơn lẻ | tạo harness debt |
| Log everything into prompt | context pollution, privacy risk |
| Dùng LLM judge cho mọi thứ | tốn tiền, nondeterministic |
| Không git branch khi apply | khó rollback |
| Add rule nhưng không remove rule cũ | instruction bloat |
| Treat session summary as ground truth | mất detail, sai diagnosis |
| Commit raw JSONL logs | leak secrets |
| Auto-push harness changes | nguy hiểm |

---

## 21. Long-term architecture

Khi MVP ổn, có thể tiến tới 4-layer architecture:

```txt
Layer 1: Trace Store
  raw JSONL refs, redacted excerpts, metrics

Layer 2: Analysis Engine
  rule detectors, LLM reflection, pattern clustering

Layer 3: Improvement Engine
  proposals, patches, git workflow, evals

Layer 4: Pi Runtime Integration
  extension commands, status UI, hooks, custom messages
```

---

## 22. Hướng đi đúng nhất

Thứ tự triển khai nên là:

```txt
1. Session parser
2. Report
3. Manual labels/notes
4. Rule proposals
5. LLM proposals
6. Human-reviewed patches
7. Eval
8. Auto-improve low-risk only
```

Đây là cách giữ đúng triết lý:

```txt
simple first
  → đọc log, hiểu chuyện gì xảy ra

improve last
  → chỉ sửa harness khi có evidence + review + eval
```

---

## 23. Next actions

Immediate next steps:

1. Tạo repo/package skeleton cho `harness-runtime`.
2. Implement `session-jsonl.ts` parser.
3. Implement `report.ts` Markdown generator.
4. Chạy thử trên 3 session gần nhất của `pi-learn`.
5. Tạo proposal đầu tiên từ rule deterministic, không dùng LLM.

Command mục tiêu đầu tiên:

```bash
harness report --project /home/hieptran/Desktop/pi-learn --last 5
```
