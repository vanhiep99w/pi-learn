# Pi Harness Session Log Format — Normalized, Redacted, Project-Scoped

> Chi tiết hóa phần **Pi session JSONL** trong [`plan.md`](./plan.md).
>
> Quyết định chính: **không format/sửa raw Pi JSONL**. Harness tạo một lớp dữ liệu trung gian riêng: normalized events, metrics, manifest, reports và proposals.
>
> Runtime tạo cache và flow improve memory/rules/parser được mô tả ở [`runtime-and-improvement.md`](./runtime-and-improvement.md).

---

## 1. Kết luận thiết kế

Raw session JSONL của Pi là source of truth để Pi resume/debug/replay. Harness không được sửa file này.

Luồng đúng:

```txt
Pi raw session JSONL
  → harness read-only parser
  → tree resolver / active path resolver
  → redaction
  → normalization
  → project-scoped private cache
  → metrics/report/proposal/eval
```

Không làm:

```txt
Pi raw JSONL
  → rewrite/pretty-format file gốc
```

Không làm mặc định:

```txt
Raw JSONL full content
  → đưa toàn bộ vào report/proposal/LLM prompt
```

Làm mặc định:

```txt
Raw JSONL full content
  → facts + excerpts + hashes + rawRef
```

Full assistant text và full tool output **vẫn cần cho forensic/debug**, nhưng chỉ lazy-load theo `sessionFile + entryId` khi inspect sâu.

---

## 2. Lưu ở đâu

### 2.1 Raw Pi sessions

Giữ nguyên tại:

```txt
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

Policy:

- read-only
- không rewrite
- không commit
- không copy full vào repo
- luôn coi là có thể chứa secrets

### 2.2 Harness private cache

Normalized data mặc định lưu ngoài repo:

```txt
~/.pi/harness/
```

Layout đề xuất:

```txt
~/.pi/harness/
├── index.json
├── projects/
│   └── <project-key>/
│       ├── project.json
│       ├── sessions/
│       │   └── <session-id>/
│       │       ├── manifest.json
│       │       ├── events.jsonl
│       │       ├── metrics.json
│       │       └── warnings.jsonl
│       ├── reports/
│       │   ├── latest.md
│       │   └── 2026-06-14.md
│       └── proposals/
│           ├── draft/
│           └── rejected/
└── cache/
```

Ví dụ:

```txt
~/.pi/harness/projects/pi-learn-7b91c2/
├── project.json
├── sessions/
│   └── 3f6b2d1e-.../
│       ├── manifest.json
│       ├── events.jsonl
│       ├── metrics.json
│       └── warnings.jsonl
└── reports/latest.md
```

### 2.3 Project artifacts trong repo

Chỉ lưu trong repo những artifact đã được review/redact và có giá trị lâu dài:

```txt
harness/
├── config.json
├── rules/
├── evals/
├── memory/
└── proposals-reviewed/
```

Không commit mặc định:

```txt
harness/traces/
harness/cache/
harness/reports/latest.md
harness/reports/*.generated.md
*.events.jsonl
raw session *.jsonl
```

Gợi ý `.gitignore` nếu sau này tạo `harness/` trong repo:

```gitignore
harness/traces/
harness/cache/
harness/reports/latest.md
harness/reports/*.generated.md
*.events.jsonl
*.metrics.json
```

---

## 3. Có cần care từng project/session không?

Có. Harness phải group theo **project → session → branch/active path**.

Lý do:

- mỗi project có `AGENTS.md`, tools, settings, prompt, skills khác nhau
- proposal phải apply vào đúng repo
- lỗi lặp lại trong project A không nên sửa policy của project B
- Pi session là tree, nếu không xử lý branch sẽ đếm sai metric

### 3.1 Project identity

Mỗi session có header chứa `cwd`:

```json
{"type":"session","version":3,"id":"...","cwd":"/home/hieptran/Desktop/pi-learn"}
```

Harness map:

```txt
session.cwd
  → realpath(cwd)
  → git root nếu có
  → projectKey
```

`projectKey` nên là:

```txt
basename(gitRoot || cwd) + "-" + shortHash(realpath(gitRoot || cwd))
```

Ví dụ:

```txt
pi-learn-7b91c2
```

Không chỉ dùng basename vì nhiều repo có thể cùng tên.

### 3.2 Session identity

Mỗi session giữ riêng:

```txt
sessionId
sessionFile
cwd
gitRoot/projectRoot
startedAt
lastUpdatedAt
entryCount
activePathEntryIds
models used
tool failures
compactions
branches
outcome nếu có tag/label
```

Evidence luôn trỏ về:

```txt
projectKey + sessionId + sessionFile + entryId
```

### 3.3 Branch / active path

Pi session là tree qua `id` / `parentId`.

Mặc định report/proposal chỉ dùng:

```txt
active path only
```

Inactive branches chỉ dùng khi user yêu cầu:

```bash
harness inspect <session.jsonl> --all-branches
```

Nếu không phân biệt active path, harness có thể:

- tính cả lỗi ở branch đã bỏ
- tạo proposal từ hướng làm không được chọn
- đếm tool calls/compactions sai

---

## 4. Format khi nào

### 4.1 MVP: on-demand

Ban đầu chỉ format khi user gọi command:

```bash
harness scan --project /home/hieptran/Desktop/pi-learn
harness report --project /home/hieptran/Desktop/pi-learn --last 5
harness inspect ~/.pi/agent/sessions/.../session.jsonl
harness propose --rules
```

Trong Pi extension:

```txt
/harness-report
/harness-last
/harness-proposals
```

Các command này gọi formatter nếu cache stale/missing.

### 4.2 Không format khi nào

Không format mỗi lần Pi append một dòng JSONL trong MVP.

Lý do:

- dễ va chạm với writer của Pi
- tăng IO không cần thiết
- semantic turn có thể chưa hoàn chỉnh
- phức tạp cache/incremental parser sớm

### 4.3 Sau MVP: incremental cache

Sau khi parser ổn, dùng `mtime`/`size`/`hash` để skip session chưa đổi.

Manifest cache fields:

```json
{
  "rawSize": 582033,
  "rawMtimeMs": 1781431200000,
  "rawHash": "sha256:optional",
  "formattedAt": "2026-06-14T12:00:00.000Z"
}
```

Policy:

```txt
raw unchanged → reuse cached events/metrics
raw changed   → reparse full file trước, incremental sau
```

Incremental append parser chỉ làm sau khi full reparse đủ tin cậy.

---

## 5. Output files

Mỗi session sau khi normalize tạo:

```txt
~/.pi/harness/projects/<project-key>/sessions/<session-id>/
├── manifest.json
├── events.jsonl
├── metrics.json
└── warnings.jsonl
```

### 5.1 `manifest.json`

Mục tiêu: metadata, cache validity, source refs, active path.

```ts
type SessionManifest = {
  schemaVersion: 1;
  projectKey: string;
  sessionId: string;
  sessionFile: string;
  cwd: string;
  gitRoot?: string;
  piSessionVersion: number;
  parsedAt: string;
  startedAt?: string;
  lastEntryAt?: string;
  rawSize: number;
  rawMtimeMs: number;
  rawHash?: string;
  entryCount: number;
  activeLeafId?: string;
  activePathEntryIds: string[];
  activePathCount: number;
  branchCount: number;
  redactionEnabled: boolean;
  warningsCount: number;
};
```

Example:

```json
{
  "schemaVersion": 1,
  "projectKey": "pi-learn-7b91c2",
  "sessionId": "3f6b2d1e-...",
  "sessionFile": "/home/hieptran/.pi/agent/sessions/--home-hieptran-Desktop-pi-learn--/2026-06-14_3f6b.jsonl",
  "cwd": "/home/hieptran/Desktop/pi-learn",
  "gitRoot": "/home/hieptran/Desktop/pi-learn",
  "piSessionVersion": 3,
  "parsedAt": "2026-06-14T12:00:00.000Z",
  "rawSize": 582033,
  "rawMtimeMs": 1781431200000,
  "entryCount": 120,
  "activeLeafId": "z9y8x7w6",
  "activePathEntryIds": ["a1b2c3d4", "b2c3d4e5", "z9y8x7w6"],
  "activePathCount": 88,
  "branchCount": 3,
  "redactionEnabled": true,
  "warningsCount": 0
}
```

### 5.2 `events.jsonl`

Mục tiêu: facts nhỏ, đã redact/truncate, dùng cho rules/report/proposals.

Mỗi dòng là một `HarnessEvent`.

```ts
type HarnessEvent = {
  schemaVersion: 1;
  eventId: string;
  sessionId: string;
  projectKey: string;
  sessionFile: string;
  entryId: string;
  parentId: string | null;
  timestamp: string;
  cwd: string;

  kind:
    | "user_message"
    | "assistant_message"
    | "assistant_tool_call"
    | "tool_result"
    | "bash_execution"
    | "model_change"
    | "thinking_change"
    | "compaction"
    | "branch_summary"
    | "custom"
    | "custom_message"
    | "label"
    | "session_info"
    | "unknown";

  activePath: boolean;
  branchDepth?: number;

  summary?: string;
  excerpt?: string;
  contentStats?: {
    chars?: number;
    lines?: number;
    truncated?: boolean;
    hash?: string;
  };

  model?: {
    provider?: string;
    model?: string;
    thinkingLevel?: string;
    stopReason?: string;
  };

  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    costTotal?: number;
  };

  tool?: {
    name?: string;
    callId?: string;
    argsPreview?: Record<string, unknown>;
    isError?: boolean;
  };

  bash?: {
    command?: string;
    exitCode?: number;
    cancelled?: boolean;
    truncated?: boolean;
    errorLines?: string[];
    outputHead?: string;
    outputTail?: string;
    fullOutputPath?: string;
  };

  files?: {
    read?: string[];
    written?: string[];
    mentioned?: string[];
  };

  safety?: {
    redacted: boolean;
    sensitivePath: boolean;
    secretDetected: boolean;
  };

  rawRef: {
    sessionFile: string;
    entryId: string;
  };
};
```

### 5.3 `metrics.json`

Mục tiêu: aggregate deterministic metrics.

```ts
type SessionMetrics = {
  schemaVersion: 1;
  projectKey: string;
  sessionId: string;
  turns: number;
  assistantMessages: number;
  userMessages: number;
  toolCalls: number;
  toolResults: number;
  toolErrors: number;
  bashCommands: number;
  bashFailures: number;
  compactions: number;
  branches: number;
  modelChanges: number;
  thinkingChanges: number;
  labels: Record<string, number>;
  models: Record<string, number>;
  topTools: Record<string, number>;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    costTotal: number;
  };
  safety: {
    sensitivePathEvents: number;
    secretDetectedEvents: number;
    redactedEvents: number;
  };
};
```

Example:

```json
{
  "schemaVersion": 1,
  "projectKey": "pi-learn-7b91c2",
  "sessionId": "3f6b2d1e-...",
  "turns": 24,
  "assistantMessages": 24,
  "userMessages": 25,
  "toolCalls": 36,
  "toolResults": 36,
  "toolErrors": 4,
  "bashCommands": 12,
  "bashFailures": 2,
  "compactions": 1,
  "branches": 2,
  "modelChanges": 1,
  "thinkingChanges": 0,
  "labels": { "success": 1 },
  "models": { "openai/gpt-5-codex": 18 },
  "topTools": { "read": 12, "bash": 10, "edit": 5 },
  "usage": {
    "input": 120000,
    "output": 18000,
    "cacheRead": 50000,
    "cacheWrite": 10000,
    "totalTokens": 198000,
    "costTotal": 2.41
  },
  "safety": {
    "sensitivePathEvents": 0,
    "secretDetectedEvents": 1,
    "redactedEvents": 1
  }
}
```

### 5.4 `warnings.jsonl`

Mục tiêu: parser không crash khi gặp data lạ.

`warnings.jsonl` cũng là health signal để improve parser/redaction/rules. Chi tiết flow improve nằm trong [`runtime-and-improvement.md`](./runtime-and-improvement.md).

```ts
type ParseWarning = {
  schemaVersion: 1;
  sessionId: string;
  projectKey: string;
  lineNumber?: number;
  entryId?: string;
  code:
    | "malformed_json"
    | "missing_header"
    | "missing_id"
    | "missing_parent"
    | "unknown_entry_type"
    | "unknown_message_role"
    | "content_parse_failed"
    | "redaction_warning";
  message: string;
  timestamp: string;
};
```

---

## 6. Event examples

### 6.1 User message

```json
{
  "schemaVersion": 1,
  "eventId": "evt_000001",
  "sessionId": "3f6b2d1e-...",
  "projectKey": "pi-learn-7b91c2",
  "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
  "entryId": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-06-14T10:00:00.000Z",
  "cwd": "/home/hieptran/Desktop/pi-learn",
  "kind": "user_message",
  "activePath": true,
  "summary": "User asks how to format Pi session JSONL for harness",
  "excerpt": "thế nên làm gì để format jsonl session log cho harness",
  "contentStats": {
    "chars": 57,
    "lines": 1,
    "truncated": false,
    "hash": "sha256:..."
  },
  "safety": {
    "redacted": false,
    "sensitivePath": false,
    "secretDetected": false
  },
  "rawRef": {
    "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
    "entryId": "a1b2c3d4"
  }
}
```

### 6.2 Assistant message

```json
{
  "schemaVersion": 1,
  "eventId": "evt_000002",
  "sessionId": "3f6b2d1e-...",
  "projectKey": "pi-learn-7b91c2",
  "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
  "entryId": "b2c3d4e5",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-06-14T10:00:08.000Z",
  "cwd": "/home/hieptran/Desktop/pi-learn",
  "kind": "assistant_message",
  "activePath": true,
  "summary": "Assistant recommends normalized project-scoped harness events",
  "excerpt": "Nên làm theo hướng: không format lại raw Pi JSONL...",
  "contentStats": {
    "chars": 6420,
    "lines": 144,
    "truncated": true,
    "hash": "sha256:..."
  },
  "model": {
    "provider": "openai",
    "model": "gpt-5-codex",
    "stopReason": "stop"
  },
  "usage": {
    "input": 12000,
    "output": 1800,
    "totalTokens": 13800,
    "costTotal": 0.12
  },
  "safety": {
    "redacted": false,
    "sensitivePath": false,
    "secretDetected": false
  },
  "rawRef": {
    "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
    "entryId": "b2c3d4e5"
  }
}
```

### 6.3 Assistant tool call

Tool calls nằm trong assistant content block. Harness nên emit event riêng để dễ thống kê.

```json
{
  "schemaVersion": 1,
  "eventId": "evt_000003",
  "sessionId": "3f6b2d1e-...",
  "projectKey": "pi-learn-7b91c2",
  "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
  "entryId": "b2c3d4e5",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-06-14T10:00:08.000Z",
  "cwd": "/home/hieptran/Desktop/pi-learn",
  "kind": "assistant_tool_call",
  "activePath": true,
  "tool": {
    "name": "read",
    "callId": "call_123",
    "argsPreview": {
      "path": "plan.md",
      "limit": 2000
    }
  },
  "files": {
    "read": ["plan.md"],
    "mentioned": ["plan.md"]
  },
  "safety": {
    "redacted": false,
    "sensitivePath": false,
    "secretDetected": false
  },
  "rawRef": {
    "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
    "entryId": "b2c3d4e5"
  }
}
```

### 6.4 Tool result error

```json
{
  "schemaVersion": 1,
  "eventId": "evt_000004",
  "sessionId": "3f6b2d1e-...",
  "projectKey": "pi-learn-7b91c2",
  "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
  "entryId": "c3d4e5f6",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-06-14T10:00:10.000Z",
  "cwd": "/home/hieptran/Desktop/pi-learn",
  "kind": "tool_result",
  "activePath": true,
  "summary": "edit tool failed because oldText did not match",
  "excerpt": "oldText must match a unique region of the original file",
  "contentStats": {
    "chars": 840,
    "lines": 12,
    "truncated": false,
    "hash": "sha256:..."
  },
  "tool": {
    "name": "edit",
    "callId": "call_456",
    "isError": true
  },
  "safety": {
    "redacted": false,
    "sensitivePath": false,
    "secretDetected": false
  },
  "rawRef": {
    "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
    "entryId": "c3d4e5f6"
  }
}
```

### 6.5 Bash execution failure

```json
{
  "schemaVersion": 1,
  "eventId": "evt_000005",
  "sessionId": "3f6b2d1e-...",
  "projectKey": "pi-learn-7b91c2",
  "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
  "entryId": "d4e5f6g7",
  "parentId": "c3d4e5f6",
  "timestamp": "2026-06-14T10:05:00.000Z",
  "cwd": "/home/hieptran/Desktop/pi-learn",
  "kind": "bash_execution",
  "activePath": true,
  "summary": "npm test failed",
  "bash": {
    "command": "npm test",
    "exitCode": 1,
    "cancelled": false,
    "truncated": true,
    "errorLines": [
      "TypeError: Cannot read properties of undefined",
      "FAIL src/parser/session-jsonl.test.ts"
    ],
    "outputHead": "> npm test\n...",
    "outputTail": "FAIL src/parser/session-jsonl.test.ts\n..."
  },
  "contentStats": {
    "chars": 14820,
    "lines": 312,
    "truncated": true,
    "hash": "sha256:..."
  },
  "safety": {
    "redacted": true,
    "sensitivePath": false,
    "secretDetected": false
  },
  "rawRef": {
    "sessionFile": "/home/hieptran/.pi/agent/sessions/.../2026-06-14_3f6b.jsonl",
    "entryId": "d4e5f6g7"
  }
}
```

---

## 7. Redaction and truncation policy

### 7.1 Redact trước khi ghi harness cache

Redact ở mọi output không phải raw:

```txt
API keys: sk-..., tvly-..., ghp_..., github_pat_...
Authorization headers
OAuth codes/tokens
.env values
cookies/session tokens
private SSH keys
base64 image/data blobs
```

Ví dụ:

```txt
Original: export OPENAI_API_KEY=sk-abc123
Redacted: export OPENAI_API_KEY=<REDACTED_SECRET>
```

### 7.2 Sensitive path detection

Flag `sensitivePath = true` nếu path match:

```txt
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519
~/.pi/agent/auth.json
~/.pi/agent/chatgpt-usage-accounts.json
.pi/logs/llm-payloads/
```

Không tự đọc thêm nội dung sensitive path để enrich evidence.

### 7.3 Truncation defaults

Khuyến nghị mặc định:

```txt
message excerpt: 1,000 chars
assistant excerpt: 1,500 chars
tool result excerpt: 2,000 chars
bash outputHead: 1,000 chars
bash outputTail: 3,000 chars
errorLines: max 50 lines
argsPreview string value: max 300 chars
```

Luôn lưu:

```txt
chars
lines
truncated
hash
rawRef
```

Như vậy không mất khả năng inspect full.

---

## 8. Full content access

Full assistant text/tool output không được copy vào normalized event mặc định.

Khi cần forensic/debug:

```bash
harness inspect <session.jsonl> --entry <entry-id> --full
harness show-evidence P-0001 --full
harness export-evidence P-0001 --redacted
```

Rules:

- `--full` chỉ đọc local raw JSONL
- mặc định vẫn redact khi in ra terminal/report
- muốn raw thật sự phải có flag rõ ràng, ví dụ `--no-redact`, và nên cảnh báo

---

## 9. Parser pipeline chi tiết

MVP parser steps:

```txt
1. Resolve project from cwd/project argument
2. List candidate raw session files
3. Read each JSONL line by line
4. Parse JSON safely
5. Detect header entry type=session
6. Collect entries with id/parentId
7. Build id → entry map
8. Build parent → children map
9. Detect active leaf
10. Walk active path leaf → root → reverse
11. Normalize entries to HarnessEvent
12. Split assistant toolCall blocks into assistant_tool_call events
13. Redact strings/args/output
14. Truncate excerpts/output previews
15. Extract file paths from tool args/bash command/output where safe
16. Aggregate metrics
17. Write manifest/events/metrics/warnings atomically
18. Generate report/proposal from normalized cache
```

### 9.1 Active leaf detection

MVP:

```txt
active leaf = last parsed entry with id
```

Then:

```txt
active path = walk parentId until null
```

Nếu future Pi exposes exact current leaf differently, add compatibility field later.

### 9.2 Unknown entries

Parser không crash khi gặp unknown entry type.

Normalize thành:

```json
{
  "kind": "unknown",
  "summary": "Unknown entry type: <type>",
  "rawRef": { "sessionFile": "...", "entryId": "..." }
}
```

Ghi thêm vào `warnings.jsonl`.

### 9.3 Atomic writes

Ghi output theo temp file rồi rename:

```txt
events.jsonl.tmp → events.jsonl
metrics.json.tmp → metrics.json
manifest.json.tmp → manifest.json
```

Tránh cache hỏng nếu process bị kill giữa chừng.

---

## 10. Report/proposal dùng dữ liệu nào

### 10.1 Report

Report dùng:

```txt
manifest.json
metrics.json
events.jsonl activePath=true
```

Không đọc raw full trừ khi user inspect.

### 10.2 Rule proposals

Rule engine dùng normalized events.

Ví dụ:

```txt
bash_execution exitCode != 0 repeated
  → proposal add validation/check command
```

Evidence trong proposal:

```md
- project: pi-learn-7b91c2
- session: 3f6b2d1e-...
- entry: d4e5f6g7
- kind: bash_execution
- excerpt: FAIL src/parser/session-jsonl.test.ts ...
```

### 10.3 LLM reflection

LLM chỉ nhận:

```txt
session summaries
metrics
selected redacted excerpts
evidence refs
evidence kind/reason
target routing guide
optional likelyTargets/targetGuidance
```

Không nhận raw full session mặc định.

Prompt reflection phải giúp model route target thay vì tự đoán từ schema. Ví dụ:

```txt
tool_error:edit repeated
  → likelyTargets: agents, rules, eval
  → agents nếu chỉ thêm AGENTS.md workflow note
  → rules nếu thêm detector config/code
```

Importer phải giữ evidence structure:

```txt
kind: tool_result
reason: tool_error:edit
excerpt: ...
```

và normalize/reject target mismatch như `target=rules` nhưng chỉ sửa `AGENTS.md`.

---

## 11. CLI behavior

### 11.1 Scan project

```bash
harness scan --project /home/hieptran/Desktop/pi-learn
```

Behavior:

```txt
- resolve projectKey
- list sessions matching project cwd/gitRoot
- normalize stale sessions
- update ~/.pi/harness/index.json
```

### 11.2 Report project

```bash
harness report --project /home/hieptran/Desktop/pi-learn --last 5
```

Behavior:

```txt
- ensure sessions normalized
- read metrics/events
- write ~/.pi/harness/projects/<project-key>/reports/latest.md
- optionally print path/summary
```

### 11.3 Inspect full entry

```bash
harness inspect <session.jsonl> --entry d4e5f6g7 --full
```

Behavior:

```txt
- read raw local JSONL
- find entryId
- redact by default
- print full content for that entry only
```

### 11.4 Propose by rules

```bash
harness propose --project /home/hieptran/Desktop/pi-learn --rules
```

Behavior:

```txt
- use normalized cache
- generate draft proposals in private cache
- do not apply
```

---

## 12. Runtime, memory, rules, parser improvement

Các file `manifest.json`, `events.jsonl`, `metrics.json`, `warnings.jsonl` do **harness runtime deterministic** tạo ra, không phải LLM.

Memory/rules/parser/redaction có thể improve từ evidence, nhưng phải đi qua proposal + review + git workflow. Chi tiết xem [`runtime-and-improvement.md`](./runtime-and-improvement.md).

---

## 13. Changes to original plan data model

In `plan.md`, avoid making `entries: SessionEntry[]` the main working dataset.

Prefer:

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
```

Raw entries are accessed through:

```ts
type RawRef = {
  sessionFile: string;
  entryId: string;
};
```

This prevents accidental raw log copying while preserving evidence traceability.

---

## 14. MVP implementation checklist

### Phase A — Storage/config

- [ ] Create `~/.pi/harness` if missing
- [ ] Create `index.json`
- [ ] Resolve `projectKey`
- [ ] Write `project.json`

### Phase B — Parser

- [ ] Read JSONL safely line by line
- [ ] Parse session header
- [ ] Build entry map
- [ ] Build tree
- [ ] Detect active leaf
- [ ] Compute active path
- [ ] Handle unknown entries
- [ ] Write warnings

### Phase C — Normalize

- [ ] Normalize user messages
- [ ] Normalize assistant messages
- [ ] Extract assistant tool calls as events
- [ ] Normalize tool results
- [ ] Normalize bash executions
- [ ] Normalize model/thinking changes
- [ ] Normalize compaction/branch summary
- [ ] Normalize labels/session info/custom entries

### Phase D — Safety

- [ ] Redact secret patterns
- [ ] Detect sensitive paths
- [ ] Truncate long content
- [ ] Store hash/stats/rawRef

### Phase E — Metrics/report

- [ ] Aggregate session metrics
- [ ] Generate report from normalized cache
- [ ] Support `--last N`
- [ ] Support active-path-only default

### Phase F — Inspect

- [ ] `harness inspect <session> --entry <id>`
- [ ] `--full` lazy-load raw entry
- [ ] Redact by default

---

## 15. Final policy

```txt
Raw JSONL:
  ~/.pi/agent/sessions
  read-only source of truth

Normalized cache:
  ~/.pi/harness/projects/<project-key>/sessions/<session-id>
  private, redacted, compact, not committed

Reports/proposals:
  private by default
  commit only after review/redaction

Analysis scope:
  project-scoped first
  session-scoped evidence
  active path by default
  all branches only on request

Full content:
  not stored in normalized events
  lazy-loaded from rawRef for inspect/debug
```
