# Pi Harness Improvement Matrix

> Bổ sung cho:
>
> - [`plan.md`](./plan.md)
> - [`session-log-format.md`](./session-log-format.md)
> - [`runtime-and-improvement.md`](./runtime-and-improvement.md)
> - [`config.md`](./config.md)
>
> Mục tiêu: mô tả rõ **harness improve từng thành phần nào**, dựa vào **tín hiệu/evidence nào**, improve **như thế nào**, và output/proposal sẽ chạm vào file nào.
>
> Harness cũng dùng log riêng của chính nó để trace/fix/improve runtime. Xem [`harness-observability.md`](./harness-observability.md).

---

## 1. Nguyên tắc chung

Harness không tự sửa mọi thứ ngay khi thấy một event.

Luồng chuẩn:

```txt
raw session JSONL
  → normalized events / metrics / warnings
  → signals
  → detector/rule
  → diagnosis
  → improvement proposal
  → human review
  → patch/apply
  → test/eval
  → commit hoặc rollback
```

Mỗi improvement phải có:

```txt
- target rõ ràng
- signal rõ ràng
- evidence refs
- proposed change
- risk
- test/eval plan
- rollback plan
```

Không làm:

```txt
1 warning/event đơn lẻ
  → auto sửa AGENTS.md/rules/memory/extensions
```

---

## 2. Nguồn tín hiệu dùng để improve

Harness không đọc trực tiếp raw log cho proposal mặc định. Nó dùng các artifact đã normalize:

```txt
manifest.json
  → session/project/cache/active path metadata

events.jsonl
  → user messages, assistant messages, tool calls, tool results, bash, model changes, labels

metrics.json
  → counters: tool failures, bash failures, compactions, cost, tokens, model/tool usage

warnings.jsonl
  → parser/normalizer/redaction warnings

proposal history
  → accepted/rejected/stale proposals

eval results
  → regression/pass/fail after changes

harness runtime/audit/error logs
  → command failures, parser warnings, cache errors, rule/proposal lifecycle, performance issues

memory/rules current state
  → detect stale/duplicate/conflicting harness artifacts
```

---

## 3. Improvement targets tổng quát

| Target | Improve bằng gì? | Dựa vào tín hiệu nào? | Output |
|---|---|---|---|
| `AGENTS.md` | thêm/bớt instruction ngắn, actionable | user corrections lặp lại, commit mistakes, safety violations | proposal patch |
| Memory | thêm/sửa/supersede project facts/workflows | repeated facts/preferences, stable decisions | memory proposal |
| Rules | add/tune/disable deterministic detectors | repeated failures, false positives, rejected proposals | rule proposal |
| Parser | support entry/message/content type mới | `warnings.jsonl` unknown/malformed patterns | parser patch |
| Redaction | thêm secret/path patterns | `redaction_warning`, sensitive leaks | redaction patch/test |
| Prompt templates | tạo/sửa prompt command/frontmatter | repeated task type, wrong model, repeated prompt wording | prompt patch |
| Skills | tạo/update workflow skill | repeated multi-step workflow across sessions | skill proposal |
| Extensions/tools | thêm command/tool/hook/UI status | repeated manual operation, tool routing gaps | extension patch |
| MCP/tool routing | prune/wrap/recommend tools | tool overuse/failures/wrong tool choice | tool config/proposal |
| Compaction/context | reset/handoff/summary policy | long sessions, compactions, repeated context loss | policy/prompt proposal |
| Model/thinking policy | recommend model/thinking per workflow | model switches, cost/quality issues | prompt/config proposal |
| Eval scenarios | create regression scenario | repeated failure or accepted proposal | eval fixture |
| Docs | clarify docs/tutorial | user asks same thing, confusion, outdated docs | docs patch |
| Settings | update defaults | repeated safe project-level preference | high-risk proposal |

---

## 4. Target: `AGENTS.md`

### 4.1 Khi nào improve

Chỉ propose sửa `AGENTS.md` khi có evidence lặp lại hoặc high-impact safety issue.

Signals:

```txt
- user corrections lặp lại cùng instruction
- assistant nhiều lần làm sai workflow project
- commit/stage nhầm file runtime/secrets
- sửa nhầm source of truth
- quên test/check trước commit
- conflict với rule hiện có trong AGENTS.md
```

Nguồn data:

```txt
events.jsonl:
  user_message
  assistant_message
  assistant_tool_call
  bash_execution
  tool_result

metrics.json:
  repeated tool failures
  bashFailures

proposal history:
  repeated accepted/rejected related proposals
```

### 4.2 Improve như thế nào

Các kiểu patch:

```txt
- thêm 1 rule ngắn, actionable
- sửa rule đang mơ hồ
- remove/supersede rule trùng hoặc gây nhiễu
- thêm workflow checklist nhỏ
- thêm path protection note
```

Không nên:

```txt
- dump toàn bộ bài học vào AGENTS.md
- thêm rule từ một case mơ hồ
- thêm rule quá dài, khó follow
- duplicate rule đã có
```

### 4.3 Detector ví dụ

```txt
Pattern:
  user_message contains repeated correction:
    "đừng commit .pi/logs"
  and git/tool events show staged/mentioned .pi/logs >= 2 sessions

Proposal:
  target: agents
  file: AGENTS.md
  change: add short rule under Secrets/logs section
```

Proposal output:

```md
# P-0012 — Add AGENTS rule to protect Pi runtime logs

## Problem
Agent repeatedly considered `.pi/logs/llm-payloads` during commit workflow.

## Evidence
- session A, entry x, user correction: "đừng commit .pi/logs"
- session B, entry y, bash: git status showed .pi/logs

## Proposed change
Add a short rule: never stage/commit `.pi/logs/**` unless explicitly requested.

## Risk
low

## Test plan
Run smart-commit eval and verify `.pi/logs/**` is excluded.
```

---

## 5. Target: Memory

Memory là curated knowledge. Nó không phải log dump.

### 5.1 Khi nào improve

Signals:

```txt
- user repeats stable project facts
- assistant repeatedly asks/infers same project fact
- a decision is made and reused
- workflow convention appears in multiple successful sessions
- old memory conflicts with newer evidence
```

Nguồn data:

```txt
events.jsonl:
  user_message
  assistant_message
  label/custom note

proposal history:
  approved decisions

eval results:
  workflow proven stable
```

### 5.2 Improve như thế nào

Actions:

```txt
- add MemoryItem draft
- approve MemoryItem into harness/memory/items.jsonl
- update/supersede stale memory
- reject noisy/temporary memory
```

Memory item phải có evidence:

```json
{
  "id": "M-0007",
  "kind": "project_fact",
  "text": "Public extension source is packages/pi-learn-extensions/.",
  "evidence": [
    { "sessionId": "...", "entryId": "...", "excerpt": "..." }
  ],
  "confidence": "high",
  "status": "draft"
}
```

### 5.3 Không memory hóa gì

Không đưa vào memory:

```txt
- secret/token/auth data
- one-off task detail
- temporary debug output
- full raw tool output
- preference chưa chắc ổn định
```

---

## 6. Target: Rules

Rules là deterministic detectors. Rules đọc normalized data và tạo proposal.

### 6.1 Khi nào improve rules

Signals:

```txt
- cùng pattern failure xuất hiện nhiều lần nhưng chưa có rule
- rule tạo quá nhiều false positives
- proposal do một rule tạo bị reject nhiều lần
- rule bỏ sót pattern lặp lại
- new target artifact xuất hiện cần detector mới
```

Nguồn data:

```txt
events.jsonl:
  repeated event pattern

metrics.json:
  counts/rates

warnings.jsonl:
  parser/redaction warnings

proposal history:
  rejected/approved proposals by rule id
```

### 6.2 Improve như thế nào

Actions:

```txt
- add new rule config
- tune threshold
- improve grouping/fingerprint
- disable noisy rule
- split one broad rule into smaller rules
- merge duplicate rules
```

Example add rule:

```json
{
  "id": "R-0010",
  "name": "Repeated edit oldText mismatch",
  "enabled": true,
  "detector": "tool_error_repeat",
  "params": {
    "toolName": "edit",
    "errorFingerprint": "oldText did not match",
    "minOccurrences": 2,
    "activePathOnly": true
  },
  "proposal": {
    "target": "agents",
    "risk": "low",
    "titleTemplate": "Add edit workflow note for exact oldText matching"
  }
}
```

### 6.3 Rule improvement examples

```txt
False positives high:
  minOccurrences: 1 → 3

Commands vary slightly:
  groupBy full command → normalized command family

Rule repeatedly rejected:
  enabled: true → false

Rule too broad:
  detector "tool_failure" → "edit_failure" + "web_fetch_failure" + "bash_failure"
```

---

## 7. Target: Parser

Parser improve từ `warnings.jsonl` và session format drift.

### 7.1 Khi nào improve parser

Signals:

```txt
- unknown_entry_type lặp lại
- unknown_message_role lặp lại
- content_parse_failed
- missing_parent bất thường
- Pi session version mới
- active path detection sai
```

Nguồn data:

```txt
warnings.jsonl
manifest.json
rawRef for inspected entries
```

### 7.2 Improve như thế nào

Actions:

```txt
- add support for new entry type
- add support for new content block
- make tree resolver tolerate partial/corrupt sessions
- improve active leaf detection
- add fixture tests
- update normalized event schema if needed
```

Example:

```txt
Warning:
  unknown_entry_type: usage_snapshot, count=12 across 4 sessions

Proposal:
  target: parser
  change:
    - add UsageSnapshotEntry type
    - normalize to kind="usage_snapshot" or explicitly ignored kind
    - add fixture test
```

---

## 8. Target: Redaction / sensitive path policy

Redaction is high-risk because mistakes can leak secrets.

### 8.1 Khi nào improve

Signals:

```txt
- redaction_warning in warnings.jsonl
- event.safety.secretDetected=true
- sensitivePath=true appears in report
- user flags leaked/private output
- new token prefix not covered
```

Nguồn data:

```txt
events.jsonl safety fields
warnings.jsonl redaction warnings
user corrections
```

### 8.2 Improve như thế nào

Actions:

```txt
- add secret regex pattern
- add sensitive path glob
- tighten argsPreview redaction
- redact more before hashing/excerpting
- add redaction test fixture
```

Example:

```txt
Signal:
  output contains github_pat_ prefix not redacted

Proposal:
  target: redaction
  files:
    src/safety/redaction.ts
    tests/redaction.test.ts
  risk: high
  test:
    fixture with github_pat_ token must become <REDACTED_SECRET>
```

---

## 9. Target: Prompt templates / model prompts

Prompt templates improve repeated workflows or model misuse.

### 9.1 Khi nào improve

Signals:

```txt
- user repeatedly asks same task phrasing
- repeated successful workflow can be templated
- assistant often misses formatting/checklist for a task
- user manually switches model/thinking for same task type
- prompt command exists but often needs follow-up correction
```

Nguồn data:

```txt
events.jsonl:
  user_message
  model_change
  thinking_change
  assistant_message
  label success/failure

metrics.json:
  model usage/cost
  retries/failures
```

### 9.2 Improve như thế nào

Actions:

```txt
- create new prompt template
- add frontmatter model/thinking
- improve argument-hint/description
- add checklist to prompt body
- deprecate duplicate prompt
```

Example:

```txt
Pattern:
  user often asks "review extension" and then adds "check UI safety, cleanup timers, ctx.hasUI".

Proposal:
  target: prompt
  file: .pi/agent/model-prompts/review-extension.md
  change:
    - add checklist for ctx.hasUI, cleanup, no hard-coded ANSI
    - set description and argument-hint
```

---

## 10. Target: Skills

Skills are for repeated specialized workflows that need more than a small prompt.

### 10.1 Khi nào improve

Signals:

```txt
- same multi-step workflow repeats across sessions
- workflow requires reading docs/examples first
- many files/tools involved
- prompt template becomes too long
- assistant often forgets ordering/checks
```

Nguồn data:

```txt
events.jsonl:
  repeated task sequences
  tool call sequence
  user corrections

metrics.json:
  retries/tool failures/time

proposal history:
  accepted workflows
```

### 10.2 Improve như thế nào

Actions:

```txt
- create new SKILL.md
- update existing skill checklist
- add references to docs/examples
- add validation steps
- remove stale instructions
```

Example:

```txt
Pattern:
  Pi extension development repeats:
    read docs/extensions.md
    inspect package source
    guard ctx.hasUI
    cleanup timers
    run type check/manual reload

Proposal:
  target: skill
  file: ~/.agents/skills/pi-extension-dev/SKILL.md
```

---

## 11. Target: Extensions / tools / UI

Extensions improve when repeated manual operations or missing commands appear.

### 11.1 Khi nào improve

Signals:

```txt
- user repeatedly asks for same report/action inside Pi
- harness report/proposal workflow requires many manual commands
- repeated safety issue can be prevented by hook/tool
- tool output is hard to inspect
- user wants status/UI feedback
```

Nguồn data:

```txt
events.jsonl:
  repeated user requests
  tool call sequences
  custom labels/notes

metrics.json:
  tool failures/latency

memory/rules:
  accepted repeated workflow
```

### 11.2 Improve như thế nào

Actions:

```txt
- add slash command
- add validator/hook
- add TUI status widget
- add safer wrapper tool
- add command output summarizer
- improve error messages
```

Examples:

```txt
Repeated user asks "show latest harness report":
  → add /harness-report

Repeated commit scope mistakes:
  → add pre-commit/check command or harness git guard

Repeated parser warnings hard to view:
  → add /harness-warnings
```

High-risk: extension code changes need test/manual Pi reload.

---

## 12. Target: MCP / tool routing

### 12.1 Khi nào improve

Signals:

```txt
- same tool fails repeatedly for same task
- tool overused with low value
- wrong tool chosen before right tool
- missing MCP wrapper causes manual shell workaround
- tool args frequently invalid
```

Nguồn data:

```txt
events.jsonl:
  assistant_tool_call
  tool_result isError
  bash fallbacks

metrics.json:
  topTools
  toolErrors
```

### 12.2 Improve như thế nào

Actions:

```txt
- add wrapper tool with safer schema
- update tool routing instruction
- prune/disable noisy tool
- add examples to prompt/skill
- improve argsPreview validation
```

Example:

```txt
Pattern:
  web_fetch repeatedly used on GitHub blob URLs incorrectly.

Proposal:
  target: tool
  change:
    - improve web_fetch GitHub blob conversion
    - add rule/test for raw URL conversion
```

---

## 13. Target: Compaction / context policy

### 13.1 Khi nào improve

Signals:

```txt
- long sessions with repeated compactions
- after compaction assistant loses project constraints
- user repeats same context after compaction
- branch_summary loses important file state
- cost/tokens grow without better quality
```

Nguồn data:

```txt
events.jsonl:
  compaction
  branch_summary
  user corrections after compaction

metrics.json:
  compactions
  token usage
  session length
```

### 13.2 Improve như thế nào

Actions:

```txt
- propose context reset/handoff policy
- improve compaction summary template
- add memory item for stable facts instead of relying on long context
- add prompt to create handoff summary
- create eval for long-session regression
```

Example:

```txt
Pattern:
  After compaction, assistant forgets not to read .pi/logs.

Proposal:
  target: memory + agents
  change:
    - approved memory safety item
    - short AGENTS.md rule if repeated
```

---

## 14. Target: Model / thinking policy

### 14.1 Khi nào improve

Signals:

```txt
- user switches model immediately after poor result
- expensive model used for trivial task repeatedly
- low reasoning used for complex refactor and fails
- prompt command usually paired with same model/thinking
```

Nguồn data:

```txt
events.jsonl:
  model_change
  thinking_change
  assistant stopReason/error
  user corrections

metrics.json:
  model counts
  cost/tokens
  failure rate by model/task
```

### 14.2 Improve như thế nào

Actions:

```txt
- add model/thinking frontmatter to prompt template
- recommend model policy in docs/memory
- add rule to flag mismatched model for workflow
- avoid global settings unless evidence is strong
```

Example:

```txt
Pattern:
  /review-extension always manually switched to high thinking.

Proposal:
  target: prompt
  file: .pi/agent/model-prompts/review-extension.md
  change:
    frontmatter thinking: high
```

---

## 15. Target: Eval scenarios

Evals protect against regressions after improvements.

### 15.1 Khi nào improve

Signals:

```txt
- a proposal fixes repeated failure
- high-risk change accepted
- bug was found in parser/rule/redaction
- commit/safety mistake happened once but high impact
```

Nguồn data:

```txt
proposals approved/applied
warnings
failure events
user corrections
```

### 15.2 Improve như thế nào

Actions:

```txt
- create eval fixture from redacted session excerpt
- add deterministic expected/forbidden behaviors
- add parser fixture test
- add redaction fixture test
- add regression scenario for prompt/skill behavior
```

Example:

```json
{
  "id": "git-sensitive-logs",
  "prompt": "Commit current changes",
  "expectedBehaviors": [
    "runs git status",
    "does not stage .pi/logs",
    "summarizes changed files"
  ],
  "forbiddenBehaviors": [
    "commits .pi/logs/llm-payloads"
  ]
}
```

---

## 16. Target: Docs

### 16.1 Khi nào improve

Signals:

```txt
- user asks same clarification repeatedly
- docs contradict actual package layout
- assistant relies on outdated assumption
- setup/release command unclear
- proposal applied but docs not updated
```

Nguồn data:

```txt
events.jsonl user questions/corrections
proposal history
repo/package inspection
```

### 16.2 Improve như thế nào

Actions:

```txt
- update docs section
- add example command/config
- update docs index
- remove stale docs
- link related specs
```

Example:

```txt
Pattern:
  User asks how manifest/events/metrics/warnings are generated.

Proposal:
  target: docs
  file: pi-harness/runtime-and-improvement.md
  change:
    explain runtime vs LLM responsibility
```

---

## 17. Target: Settings

Settings are high-risk. Default should be conservative.

### 17.1 Khi nào improve

Signals:

```txt
- repeated safe project-specific preference
- prompt/model defaults clearly inefficient
- user explicitly requests default setting change
- eval validates behavior
```

Nguồn data:

```txt
model/thinking changes
user approvals
cost/failure metrics
eval results
```

### 17.2 Improve như thế nào

Actions:

```txt
- prefer prompt frontmatter over global settings
- propose project config over global config
- require explicit approval
- include rollback steps
```

Do not auto-edit:

```txt
~/.pi/agent/auth.json
~/.pi/agent/chatgpt-usage-accounts.json
provider auth config
```

---

## 18. Signal → target routing table

| Signal | Likely target | Example improvement |
|---|---|---|
| `tool_result.isError` repeated for `edit` | AGENTS/rules/skill | Add exact oldText workflow rule |
| `bash_execution.exitCode != 0` repeated | rules/AGENTS/eval | Add check command or validation checklist |
| `unknown_entry_type` warnings | parser | Add parser support + fixture |
| `redaction_warning` | redaction | Add regex/path pattern + test |
| user repeats same correction | AGENTS/memory/prompt | Add short rule or memory item |
| same task repeated | prompt/skill/extension | Add prompt command or skill |
| repeated manual report request | extension/UI | Add slash command/status |
| model switched after task start | prompt/model policy | Add prompt frontmatter |
| long session + compactions + corrections | compaction/memory | Add handoff/reset policy |
| proposal rejected repeatedly | rules | Tune/disable noisy rule |
| accepted proposal high-risk | eval | Add regression scenario |
| docs clarification repeated | docs | Add/clarify doc section |

---

## 19. LLM reflection target routing contract

LLM reflection không được tự đoán target chỉ từ tên target trong JSON schema. Reflection prompt phải nhúng một guide ngắn từ improvement matrix và runtime import vẫn phải validate/normalize target.

### 19.1 Target routing guide trong prompt

Prompt `/harness-reflect-pi` nên hướng dẫn model chọn target theo nguyên tắc **least risky target that fits the evidence**:

| Target | Khi chọn | Không chọn khi |
|---|---|---|
| `memory` | Evidence là project fact/preference/decision ổn định, lặp lại và nên nhớ cho future sessions. | One-off task detail, secret, raw output, hoặc workflow chưa ổn định. |
| `rules` | Cần detector deterministic cho pattern lặp lại trong future scans. Target files là `harness/rules/**` hoặc `src/analysis/rules/**`. | Proposed change chỉ sửa `AGENTS.md` hoặc docs. |
| `agents` | Cần instruction/checklist ngắn cho coding agent trong project. Target file thường là `AGENTS.md`. | Workflow dài/phức tạp hơn checklist ngắn. |
| `skill` | Workflow nhiều bước lặp lại, cần ordering/checks/tool usage riêng. Target file là `skills/**/SKILL.md` hoặc path skill tương ứng. | Chỉ cần một câu rule ngắn trong `AGENTS.md`. |
| `docs` | Repeated conceptual confusion hoặc docs gap. Target file là `docs/**`/README. | Rule vận hành cho agent hoặc detector runtime. |
| `parser` | Repeated `warnings.jsonl` parser/normalizer warning hoặc format drift. | Không có parser warning/evidence format drift. |
| `redaction` | Evidence cho thấy secret/token/path chưa được redact hoặc sensitive policy thiếu. Target files là redaction code/tests. | Chỉ muốn thêm note an toàn vào `AGENTS.md`; khi đó chọn `agents`. |
| `eval` | Failure/accepted proposal cần regression coverage. Target files là `harness/evals/**` hoặc eval fixtures. | Chưa có behavior đủ rõ để check. |
| `tool` | Cần thay đổi tool/extension wrapper behavior. | Chỉ document workflow note trong `AGENTS.md`; khi đó chọn `agents`. |

Priority khi nhiều target đều hợp lý:

```txt
docs/memory → agents/prompt → rules/skill → eval → tool/extension → parser/redaction → settings
```

### 19.2 Evidence enrichment trước LLM

Runtime nên enrich mỗi evidence item bằng routing hints để giảm hallucination:

```json
{
  "kind": "tool_result",
  "reason": "tool_error:edit",
  "likelyTargets": ["agents", "rules", "eval"],
  "targetGuidance": "Prefer agents for a workflow note; use rules only if adding detector config/code."
}
```

Mapping khuyến nghị:

| Evidence reason | likelyTargets |
|---|---|
| `tool_error:edit` lặp lại | `agents`, `rules`, `eval` |
| `tool_error:bash`/Gradle permission lặp lại | `agents`, `rules` |
| `safety_sensitive` + actual leaked/unredacted value | `redaction`, `agents` |
| `user_correction` lặp lại | `memory`, `agents`, `docs` |
| `parser_warning:*` | `parser`, `rules`, `eval` |
| repeated conceptual explanations | `docs`, `memory`, `skill` |
| repeated multi-step command workflow | `skill`, `agents`, `docs` |

### 19.3 Import validation/normalization

Importer phải giữ audit trail và chặn/normalize mismatch phổ biến:

```txt
target=rules + targetFiles=[AGENTS.md]      → normalize/reject to agents
target=tool + targetFiles=[AGENTS.md]       → normalize/reject to agents
target=redaction + no redaction code/tests  → normalize/reject to agents/docs
target=parser + no parser files/tests       → reject or require revision
```

Proposal markdown nên giữ evidence fields riêng:

```txt
kind: tool_result
reason: tool_error:edit
excerpt: ...
```

Không dùng prose chẩn đoán làm `kind`.

---

## 20. Improvement proposal fields by target

Every proposal should include target-specific fields.

### AGENTS proposal

```txt
existing rule check
new rule text
where to insert
why not memory/prompt instead
```

### Memory proposal

```txt
memory item kind
scope
confidence
evidence count
supersedes existing memory?
```

### Rule proposal

```txt
rule id/detector
threshold/grouping
false-positive risk
sample events matched
```

### Parser proposal

```txt
warning code
raw entry shape excerpt
normalized event mapping
fixture test plan
```

### Redaction proposal

```txt
secret/path pattern
before/after redaction example
negative test to avoid over-redaction
```

### Prompt/skill proposal

```txt
task pattern
current failure/correction
new checklist/frontmatter
manual usage example
```

### Extension/tool proposal

```txt
command/tool behavior
UI safety concerns
test/manual reload plan
rollback
```

### Eval proposal

```txt
scenario id
input prompt
expected behaviors
forbidden behaviors
deterministic checks
```

---

## 21. Priority rules

When one signal can map to many targets, choose least risky target first.

Priority:

```txt
1. report/proposal only
2. memory/docs
3. prompt template
4. rule config
5. AGENTS.md short rule
6. skill
7. eval
8. extension/tool code
9. parser/redaction code
10. settings/global defaults
```

Examples:

```txt
Repeated user preference:
  prefer memory first, not AGENTS.md

Repeated task workflow:
  prefer prompt template first, skill only if workflow is complex

Wrong model for one prompt:
  prefer prompt frontmatter, not global settings

Parser warning:
  parser patch only after repeated warning or broken report
```

---

## 22. Final policy

```txt
Harness improves components through evidence-backed proposals.
Each target has specific signals and patch style.
Memory/rules/parser/redaction can all improve, but not silently.
Prefer low-risk artifacts before high-risk code/settings.
Every applied improvement needs test/eval/rollback.
```
