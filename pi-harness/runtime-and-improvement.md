# Pi Harness Runtime & Self-Improvement Artifacts

> Bổ sung cho:
>
> - [`plan.md`](./plan.md)
> - [`session-log-format.md`](./session-log-format.md)
>
> Mục tiêu: làm rõ **ai tạo ra các file `manifest.json`, `events.jsonl`, `metrics.json`, `warnings.jsonl`**, vai trò của LLM, và cách **memory/rules/parser** được improve từ evidence.
>
> Ma trận chi tiết signal → target → improvement: [`improvement-matrix.md`](./improvement-matrix.md).
>
> Harness runtime/audit/error logs cho trace và self-improvement: [`harness-observability.md`](./harness-observability.md).

---

## 1. Quyết định chính

Các file normalized session output:

```txt
manifest.json
events.jsonl
metrics.json
warnings.jsonl
```

phải do **harness runtime deterministic** tạo ra, không phải LLM.

LLM chỉ được dùng sau đó cho các bước mềm hơn:

```txt
normalized events + metrics + warnings
  → reflect / diagnose / write proposal
```

Không dùng LLM để parse raw session JSONL thành dữ liệu nền, vì cần:

- deterministic
- repeatable
- dễ test
- rẻ
- nhanh
- không hallucinate
- giảm rủi ro leak raw log

---

## 2. Vai trò từng thành phần

| Thành phần | Vai trò |
|---|---|
| Pi | Ghi raw session JSONL tại `~/.pi/agent/sessions` |
| Harness runtime | Đọc raw JSONL read-only, normalize, redact, truncate, ghi cache, ghi runtime logs |
| Rule engine | Đọc normalized events/metrics/warnings, detect pattern deterministic |
| LLM | Optional: viết diagnosis/proposal từ selected excerpts đã redact |
| User | Review/approve/reject/apply proposal |
| Git | Audit trail cho mọi thay đổi harness/project artifacts |

Luồng tổng quát:

```txt
Pi raw JSONL
  → harness runtime
    → manifest.json
    → events.jsonl
    → metrics.json
    → warnings.jsonl
  → rule engine
  → proposals
  → human review
  → apply to memory/rules/prompts/skills/extensions/AGENTS.md
  → eval/test
  → commit or rollback
```

---

## 3. Runtime tạo 4 file session như thế nào

Command ví dụ:

```bash
harness scan --project /home/hieptran/Desktop/pi-learn
```

Hoặc từ Pi extension:

```txt
/harness-report
/harness-proposals
```

Runtime thực hiện:

```txt
1. Resolve projectKey
2. Find raw Pi session files của project
3. Read JSONL line by line
4. Parse session header
5. Build id → entry map
6. Build parent → children tree
7. Detect active leaf
8. Walk active path
9. Normalize entries thành events
10. Redact/truncate excerpts/output
11. Aggregate metrics
12. Record parser warnings
13. Write cache atomically
```

Output mỗi session:

```txt
~/.pi/harness/projects/<project-key>/sessions/<session-id>/
├── manifest.json
├── events.jsonl
├── metrics.json
└── warnings.jsonl
```

---

## 4. `manifest.json` do runtime tạo

`manifest.json` là metadata/cache state của một raw session.

Nó trả lời:

```txt
Session nào?
Thuộc project nào?
Raw file gốc nằm đâu?
CWD/git root là gì?
Raw file size/mtime là gì?
Đã parse lúc nào?
Active leaf/path là gì?
Có bao nhiêu entries/branches/warnings?
```

Không chứa full chat/tool output.

Runtime lấy dữ liệu từ:

- raw session header
- filesystem stat
- tree resolver
- project resolver

Pseudo code:

```ts
const raw = readJsonl(sessionFile);
const header = raw.find((entry) => entry.type === "session");
const stat = fs.statSync(sessionFile);

const entries = raw.filter((entry) => entry.id);
const entryMap = new Map(entries.map((entry) => [entry.id, entry]));

const activeLeafId = entries.at(-1)?.id;
const activePathEntryIds = walkParents(activeLeafId, entryMap);

const manifest = {
  schemaVersion: 1,
  projectKey,
  sessionId: header.id,
  sessionFile,
  cwd: header.cwd,
  gitRoot,
  piSessionVersion: header.version,
  parsedAt: new Date().toISOString(),
  rawSize: stat.size,
  rawMtimeMs: stat.mtimeMs,
  entryCount: entries.length,
  activeLeafId,
  activePathEntryIds,
  activePathCount: activePathEntryIds.length,
  branchCount: countBranches(entries),
  redactionEnabled: true,
  warningsCount,
};
```

---

## 5. `events.jsonl` do runtime tạo

`events.jsonl` là timeline normalized đã redact/truncate.

Mỗi dòng là một event nhỏ:

```txt
user_message
assistant_message
assistant_tool_call
tool_result
bash_execution
model_change
thinking_change
compaction
branch_summary
custom
custom_message
label
session_info
unknown
```

Runtime convert raw Pi entries sang events.

Ví dụ raw `message.role = "toolResult"`:

```json
{
  "type": "message",
  "id": "abc",
  "parentId": "def",
  "message": {
    "role": "toolResult",
    "toolName": "edit",
    "isError": true,
    "content": [{ "type": "text", "text": "oldText did not match..." }]
  }
}
```

Normalize thành:

```json
{
  "schemaVersion": 1,
  "kind": "tool_result",
  "entryId": "abc",
  "parentId": "def",
  "activePath": true,
  "tool": {
    "name": "edit",
    "isError": true
  },
  "excerpt": "oldText did not match...",
  "contentStats": {
    "chars": 24,
    "truncated": false,
    "hash": "sha256:..."
  },
  "rawRef": {
    "sessionFile": ".../session.jsonl",
    "entryId": "abc"
  }
}
```

Pseudo code:

```ts
for (const entry of entries) {
  const activePath = activePathSet.has(entry.id);

  switch (entry.type) {
    case "message":
      events.push(...normalizeMessage(entry, activePath));
      break;
    case "model_change":
      events.push(normalizeModelChange(entry, activePath));
      break;
    case "thinking_level_change":
      events.push(normalizeThinkingChange(entry, activePath));
      break;
    case "compaction":
      events.push(normalizeCompaction(entry, activePath));
      break;
    case "branch_summary":
      events.push(normalizeBranchSummary(entry, activePath));
      break;
    case "label":
      events.push(normalizeLabel(entry, activePath));
      break;
    case "session_info":
      events.push(normalizeSessionInfo(entry, activePath));
      break;
    case "custom":
      events.push(normalizeCustom(entry, activePath));
      break;
    case "custom_message":
      events.push(normalizeCustomMessage(entry, activePath));
      break;
    default:
      events.push(normalizeUnknown(entry, activePath));
      warnings.push(warnUnknownEntryType(entry));
  }
}

const safeEvents = events.map((event) => truncate(redact(event)));
writeJsonlAtomic(eventsPath, safeEvents);
```

### 5.1 Assistant tool calls

Raw assistant messages can contain `toolCall` content blocks. Harness should emit separate `assistant_tool_call` events for analytics.

Raw assistant content:

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "I'll inspect the file." },
    {
      "type": "toolCall",
      "id": "call_123",
      "name": "read",
      "arguments": { "path": "plan.md" }
    }
  ]
}
```

Harness emits:

```txt
assistant_message
assistant_tool_call
```

This makes metrics simple:

```txt
topTools.read += 1
toolCalls += 1
files.read includes plan.md
```

---

## 6. `metrics.json` do runtime tạo

`metrics.json` là aggregate deterministic từ events.

Runtime có thể tính trong lúc normalize hoặc đọc lại `events.jsonl`.

Pseudo code:

```ts
const metrics = createEmptyMetrics(projectKey, sessionId);

for (const event of events) {
  if (!event.activePath) continue;

  switch (event.kind) {
    case "user_message":
      metrics.userMessages++;
      break;
    case "assistant_message":
      metrics.assistantMessages++;
      addUsage(metrics, event.usage);
      addModel(metrics, event.model);
      break;
    case "assistant_tool_call":
      metrics.toolCalls++;
      addTool(metrics, event.tool?.name);
      break;
    case "tool_result":
      metrics.toolResults++;
      if (event.tool?.isError) metrics.toolErrors++;
      break;
    case "bash_execution":
      metrics.bashCommands++;
      if (event.bash?.exitCode && event.bash.exitCode !== 0) {
        metrics.bashFailures++;
      }
      break;
    case "compaction":
      metrics.compactions++;
      break;
    case "branch_summary":
      metrics.branches++;
      break;
    case "model_change":
      metrics.modelChanges++;
      break;
    case "thinking_change":
      metrics.thinkingChanges++;
      break;
  }

  if (event.safety?.sensitivePath) metrics.safety.sensitivePathEvents++;
  if (event.safety?.secretDetected) metrics.safety.secretDetectedEvents++;
  if (event.safety?.redacted) metrics.safety.redactedEvents++;
}

writeJsonAtomic(metricsPath, metrics);
```

No LLM required.

---

## 7. `warnings.jsonl` do runtime tạo

`warnings.jsonl` là health log của parser/normalizer.

Nó không phải conversation memory. Nó ghi lại các vấn đề khi đọc raw session.

Ví dụ warning cases:

```txt
malformed_json
missing_header
missing_id
missing_parent
unknown_entry_type
unknown_message_role
content_parse_failed
redaction_warning
```

Example:

```json
{
  "schemaVersion": 1,
  "sessionId": "abc",
  "projectKey": "pi-learn-7b91c2",
  "lineNumber": 88,
  "entryId": "d4e5f6g7",
  "code": "unknown_entry_type",
  "message": "Unknown entry type: usage_snapshot",
  "timestamp": "2026-06-14T12:00:00.000Z"
}
```

Purpose:

```txt
warnings.jsonl
  → parser/harness health signal
  → evidence for parser/rule/redaction improvement proposals
```

Examples:

```txt
unknown_entry_type repeated
  → propose adding parser support for new Pi entry type

redaction_warning repeated
  → propose improving redaction patterns

missing_parent repeated
  → propose improving tree resolver or warning severity
```

---

## 8. Memory, prompt rules, and detectors are improvement targets, not per-session outputs

`manifest.json`, `events.jsonl`, `metrics.json`, `warnings.jsonl` are per-session runtime outputs.

Memory, reviewed prompt rules, and deterministic detector code are different **Harness artifacts** that can be improved from evidence.

```txt
Per-session outputs:
  ~/.pi/harness/projects/<project-key>/sessions/<session-id>/...

Improvement artifacts:
  harness/memory/
  wiki/_rules.md
  wiki/<section>/_rules.md
  packages/harness-runtime/src/analysis/
  AGENTS.md
  skills/
  prompt templates
  extensions
```

Do not auto-update memory, prompt rules, or detector behavior from a single session.

Correct flow:

```txt
normalized data
  → repeated pattern
  → proposal with evidence
  → human review
  → apply patch
  → eval/test
  → commit
```

Wrong flow:

```txt
one session event
  → silently append memory/rule
```

---

## 9. Memory improvement

Memory is curated knowledge that helps future harness/agent behavior.

Examples:

```txt
Public extension source is under packages/pi-learn-extensions/.
.pi/extensions/log-llm-payload.ts is local/dev-only.
Do not read .pi/logs/llm-payloads unless explicitly requested.
Docs are Vietnamese and docs/README.md is the index.
```

### 9.1 Memory storage

Private draft memory:

```txt
~/.pi/harness/projects/<project-key>/memory/
├── draft.jsonl
└── rejected.jsonl
```

Reviewed project memory in repo:

```txt
harness/memory/
├── project-facts.md
├── workflows.md
├── decisions.md
└── items.jsonl
```

Only reviewed/redacted memory should be committed.

### 9.2 Memory item schema

```ts
type MemoryItem = {
  schemaVersion: 1;
  id: string;
  scope: "global" | "project" | "repo" | "workflow";
  projectKey?: string;
  kind:
    | "project_fact"
    | "workflow"
    | "decision"
    | "preference"
    | "safety_rule"
    | "tooling_note";
  text: string;
  evidence: EvidenceRef[];
  confidence: "low" | "medium" | "high";
  status: "draft" | "approved" | "rejected" | "superseded";
  createdAt: string;
  updatedAt: string;
  supersedes?: string[];
};
```

Example:

```json
{
  "schemaVersion": 1,
  "id": "M-0001",
  "scope": "project",
  "projectKey": "pi-learn-7b91c2",
  "kind": "project_fact",
  "text": "Public Pi extension source is under packages/pi-learn-extensions/.",
  "evidence": [
    {
      "sessionFile": "/home/hieptran/.pi/agent/sessions/.../session.jsonl",
      "entryId": "d4e5f6g7",
      "kind": "user_message",
      "excerpt": "Source of truth: extension/theme public nằm trong packages/pi-learn-extensions/"
    }
  ],
  "confidence": "high",
  "status": "approved",
  "createdAt": "2026-06-14T12:00:00.000Z",
  "updatedAt": "2026-06-14T12:00:00.000Z"
}
```

### 9.3 When to propose memory improvement

Good candidates:

- user repeats the same instruction across sessions
- project-specific fact appears repeatedly and is not documented
- workflow rule is stable and useful
- safety preference prevents real mistakes
- existing memory is contradicted by newer evidence

Bad candidates:

- one-off instruction
- uncertain observation
- secret/private content
- full raw output
- temporary debugging context

---

## 10. Prompt-rule and detector improvement

Harness now separates **reviewed prompt guidance** from **deterministic detector behavior**.

### 10.1 Reviewed prompt rules

Project prompt guidance lives in one Markdown file for root and each final Wiki section:

```txt
wiki/_rules.md
wiki/architecture/_rules.md
wiki/extensions/_rules.md
wiki/operations/_rules.md
```

Prompt rules are natural-language instructions/checklists for coding agents. They are loaded lazily:

```txt
AGENTS.md bootstrap
  → wiki/quickstart.md
  → wiki/_rules.md
  → applicable section/_rules.md
  → read-tool results enter model context
```

Harness does not auto-inject every rule, watch/cache rule content, or parse Markdown into detector parameters.

Example:

```md
## GLOBAL-EDIT-001 — Inspect before exact-text edits

Read the current target block before applying an exact-text edit.

Requirements:

- Confirm oldText is exact and unique.
- Combine adjacent changes.
- Inspect the resulting diff.

Origin proposal: `P-0012`
```

Normal coding/Documentation turns cannot modify `_rules.md`. Changes require:

```txt
normalized evidence
  → proposal
  → human approval
  → controlled Markdown patch
  → prompt-rule lint/eval
  → commit or rollback
```

### 10.2 Deterministic detectors

Detector implementations/defaults remain executable runtime code:

```txt
packages/harness-runtime/src/analysis/rules.js
packages/harness-runtime/src/improve/target-proposals.js
packages/harness-runtime/src/reflection/reflection.js
packages/harness-runtime/tests/**
```

Examples:

```txt
Repeated bash failure
Sensitive path access
Edit tool failure pattern
Parser warning pattern
```

Thresholds such as `minOccurrences`, grouping, fingerprints, and enable/disable behavior are not encoded as prose in `_rules.md`. A change to deterministic detection targets runtime source/tests. If future project-level detector tuning is needed, it requires a separate schemaed config feature outside Wiki prompt rules.

### 10.3 Proposal routing

`target=rules` means reviewed prompt guidance:

```txt
cross-cutting workflow     → wiki/_rules.md
runtime architecture      → wiki/architecture/_rules.md
Pi extension behavior     → wiki/extensions/_rules.md
release/test operations   → wiki/operations/_rules.md
```

Executable changes route separately:

```txt
detector threshold/grouping/algorithm
  → packages/harness-runtime/src/analysis/**
  → relevant tests/evals
```

Do not create or read `harness/rules/*.json` as a steady-state rule source.

---

## 11. Parser/redaction improvement from warnings

`warnings.jsonl` can directly drive parser and redaction proposals.

Examples:

### Unknown entry type

Evidence:

```json
{ "code": "unknown_entry_type", "message": "Unknown entry type: usage_snapshot" }
```

Proposal:

```txt
P-0007 — Add parser support for usage_snapshot entry
```

Target:

```txt
src/parser/session-jsonl.ts
src/normalize/events.ts
tests/session-jsonl.test.ts
```

### Redaction warning

Evidence:

```txt
Potential token pattern found but not matched by current redactor.
```

Proposal:

```txt
P-0008 — Add redaction pattern for new token prefix
```

Target:

```txt
src/safety/redaction.ts
tests/redaction.test.ts
```

### Missing parent

Evidence:

```json
{ "code": "missing_parent", "entryId": "abc", "message": "Parent def not found" }
```

Proposal options:

```txt
- improve tree resolver tolerance
- mark session as partial/corrupt
- lower severity if file was still being written
```

---

## 12. Proposal flow for memory/rules/parser

All improvements go through proposals.

```txt
1. Scan sessions
2. Normalize cache
3. Run deterministic rules
4. Detect repeated pattern
5. Generate proposal Markdown
6. Attach evidence refs
7. User reviews proposal
8. Apply on git branch
9. Run test/eval
10. Commit or rollback
```

Proposal targets include:

```txt
memory
rule
parser
redaction
agents
skill
prompt
extension
eval
docs
settings
```

Example proposal:

```md
# P-0007 — Add parser support for usage_snapshot entry

## Problem
Harness parser repeatedly reports unknown entry type `usage_snapshot`.

## Evidence
- project: pi-learn-7b91c2
- session: abc
- entry: d4e5f6g7
- warning: unknown_entry_type
- excerpt: Unknown entry type: usage_snapshot

## Proposed change
Add a normalized event kind or explicit ignore policy for `usage_snapshot`.

## Target files
- src/parser/session-jsonl.ts
- src/normalize/events.ts
- tests/session-jsonl.test.ts

## Risk
low

## Test plan
- Add fixture with usage_snapshot entry
- Run parser test
- Run harness scan on sample session

## Rollback
Revert proposal commit.
```

---

## 13. LLM role after runtime outputs

LLM can help with:

```txt
- summarizing selected evidence excerpts
- grouping vague user corrections
- drafting proposal text
- suggesting target artifact
- explaining tradeoffs
```

LLM should not:

```txt
- parse raw JSONL as source of truth
- receive full raw sessions by default
- update memory/rules silently
- decide final approval
- apply patches without user approval
```

LLM input should be:

```txt
metrics summary
selected events
warnings summary
evidence refs
redacted excerpts
target routing guide
optional likelyTargets/targetGuidance per evidence item
```

Not:

```txt
entire raw JSONL
full bash output
full assistant history
secrets/auth files
```

### 13.1 LLM target routing is explicit

Reflection prompt phải dạy model cách chọn target. Không nên chỉ đưa schema:

```json
{ "target": "memory|rules|parser|redaction|docs|eval|agents|tool" }
```

vì model sẽ đoán và có thể tạo mismatch như:

```txt
target=rules nhưng targetFiles=AGENTS.md
target=tool nhưng targetFiles=AGENTS.md
target=redaction nhưng chỉ thêm security note vào AGENTS.md
```

Prompt phải include routing guide rút gọn từ `improvement-matrix.md`:

```txt
memory    -> stable facts/preferences/decisions
rules     -> deterministic detector/config/code
agents    -> short AGENTS.md instruction/checklist
skill     -> repeated multi-step workflow
docs      -> repeated confusion/docs gap
parser    -> parser warning/session format drift
redaction -> redaction policy/code/tests
eval      -> regression scenario/tooling fixture
tool      -> tool/extension wrapper behavior
```

Runtime nên enrich evidence trước LLM:

```json
{
  "kind": "tool_result",
  "reason": "tool_error:edit",
  "likelyTargets": ["agents", "rules", "eval"],
  "targetGuidance": "Prefer agents for a workflow note; use rules only if adding detector config/code."
}
```

Importer vẫn là guard cuối cùng:

```txt
- normalize/reject target ↔ targetFiles mismatch
- preserve evidence kind/reason/excerpt separately
- require target files, risk, test plan and rollback
```

---

## 14. MVP boundaries

### Required in MVP

```txt
- Runtime creates manifest/events/metrics/warnings
- Rule engine reads normalized events
- Warnings are recorded, not ignored
- Proposals include evidence refs
- Memory/rules only updated after review
```

### Not required in MVP

```txt
- background daemon
- incremental append parser
- vector DB
- auto-apply rules
- auto-commit memory
- LLM judge for every event
```

---

## 15. Recommended implementation modules

```txt
src/
├── cli.ts
├── project/
│   ├── resolve-project.ts
│   └── project-key.ts
├── parser/
│   ├── session-jsonl.ts
│   ├── tree.ts
│   └── warnings.ts
├── normalize/
│   ├── events.ts
│   ├── messages.ts
│   └── content.ts
├── metrics/
│   └── session-metrics.ts
├── safety/
│   ├── redaction.ts
│   ├── sensitive-paths.ts
│   └── truncation.ts
├── storage/
│   ├── harness-home.ts
│   ├── cache-writer.ts
│   └── atomic-write.ts
├── analysis/
│   ├── rule-engine.ts
│   └── rules/
├── memory/
│   ├── memory-item.ts
│   └── memory-proposals.ts
└── proposals/
    ├── proposal.ts
    └── proposal-writer.ts
```

---

## 16. Final policy

```txt
Runtime creates session cache.
LLM does not create source-of-truth cache.
Warnings improve parser/redaction/rules.
Memory improves only through reviewed proposals.
Rules improve only through reviewed proposals.
All applied improvements go through git branch/diff/test/commit.
```
