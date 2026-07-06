# Harness Observability & Self-Improvement Logs

> Bổ sung cho:
>
> - [`plan.md`](./plan.md)
> - [`runtime-and-improvement.md`](./runtime-and-improvement.md)
> - [`improvement-matrix.md`](./improvement-matrix.md)
> - [`roadmap.md`](./roadmap.md)
>
> Mục tiêu: harness không chỉ đọc Pi session logs, mà còn phải log chính hoạt động của harness để **trace, debug, audit, fix và self-improve**.

---

## 1. Vì sao harness cần log riêng

Pi session JSONL trả lời:

```txt
Agent/user/tool đã làm gì trong Pi session?
```

Nhưng nó không trả lời đủ:

```txt
Harness đã parse file nào?
Config nào được load?
Session nào bị skip?
Rule nào match?
Vì sao proposal được tạo?
Redaction có chạy không?
Cache write có thành công không?
Apply patch fail ở bước nào?
Eval nào fail?
```

Vì vậy cần thêm **Harness Observability Logs**.

Luồng:

```txt
Pi raw session JSONL
  → harness runtime
    → harness logs/audit/events
    → normalized cache
    → reports/proposals
    → self-improvement of harness
```

---

## 2. Nguyên tắc logging

### 2.1 Log đủ để trace, không dump raw secrets

Log phải đủ để reconstruct runtime flow:

```txt
command start/end
config sources
projectKey
session file refs
parse warnings
cache writes
rule matches
proposal lifecycle
apply/eval results
errors with stack in debug logs
```

Nhưng không log mặc định:

```txt
full assistant text
full tool output
raw bash output
secrets/tokens/auth headers
raw .env values
.pi/logs/llm-payloads content
```

### 2.2 Mọi log event có correlation IDs

Mỗi command run có:

```txt
runId
traceId
command
projectKey
```

Khi liên quan đến session/proposal/rule/eval thì thêm:

```txt
sessionId
entryId
ruleId
proposalId
evalId
```

### 2.3 Log phải machine-readable trước

Format chính là JSONL.

Human-readable report có thể generate sau.

---

## 3. Nơi lưu logs

Mặc định lưu private ngoài repo:

```txt
~/.pi/harness/logs/
├── runtime/
│   └── 2026-06-14.jsonl
├── audit/
│   └── 2026-06-14.jsonl
├── errors/
│   └── 2026-06-14.jsonl
└── projects/
    └── <project-key>/
        ├── runtime/2026-06-14.jsonl
        ├── proposals/2026-06-14.jsonl
        └── evals/2026-06-14.jsonl
```

Không commit logs này.

Nếu cần artifact reviewed, export riêng:

```txt
harness/reports/harness-health-2026-06-14.md
```

---

## 4. Log streams

### 4.1 Runtime log

Dùng để debug runtime behavior.

Examples:

```txt
command_start
config_loaded
project_resolved
session_discovery_start
session_discovered
session_skipped
parse_start
parse_end
cache_write_start
cache_write_end
report_generated
command_end
```

### 4.2 Audit log

Dùng để trace actions có tác động hoặc có ý nghĩa governance.

Examples:

```txt
proposal_created
proposal_approved
proposal_rejected
proposal_applied
branch_created
patch_applied
test_started
test_finished
commit_created
rollback_started
```

Audit log phải bền hơn runtime debug log.

### 4.3 Error log

Dùng để fix harness bugs.

Examples:

```txt
uncaught_error
parse_error
cache_write_error
rule_engine_error
redaction_error
apply_error
eval_error
```

Error log có thể chứa stack trace, nhưng vẫn phải redact message/context.

### 4.4 Self-improvement signal log

Dùng làm input cho harness improve chính nó.

Examples:

```txt
rule_false_positive
rule_rejected_repeatedly
parser_warning_repeated
redaction_warning_repeated
slow_command
cache_corruption_detected
proposal_duplicate_detected
```

---

## 5. Event schema

```ts
type HarnessLogEvent = {
  schemaVersion: 1;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error" | "audit";
  stream: "runtime" | "audit" | "error" | "self_improvement";
  event: string;

  runId: string;
  traceId?: string;
  parentEventId?: string;
  eventId: string;

  command?: string;
  phase?: string;
  component:
    | "cli"
    | "config"
    | "project"
    | "session_discovery"
    | "parser"
    | "tree"
    | "normalizer"
    | "redaction"
    | "cache"
    | "report"
    | "rule_engine"
    | "proposal"
    | "apply"
    | "eval"
    | "extension";

  projectKey?: string;
  sessionId?: string;
  sessionFile?: string;
  entryId?: string;
  ruleId?: string;
  proposalId?: string;
  evalId?: string;

  message: string;
  data?: Record<string, unknown>;

  safety: {
    redacted: boolean;
    containsRawContent: boolean;
    containsSecret: boolean;
  };
};
```

---

## 6. Event examples

### 6.1 Command start

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-06-14T10:00:00.000Z",
  "level": "info",
  "stream": "runtime",
  "event": "command_start",
  "runId": "run_01",
  "eventId": "evt_01",
  "command": "sessions",
  "component": "cli",
  "projectKey": "pi-learn-4cf153",
  "message": "Command started",
  "data": {
    "argv": ["sessions", "--project", ".", "--last", "5"]
  },
  "safety": {
    "redacted": true,
    "containsRawContent": false,
    "containsSecret": false
  }
}
```

### 6.2 Session discovered

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-06-14T10:00:01.000Z",
  "level": "info",
  "stream": "runtime",
  "event": "session_discovered",
  "runId": "run_01",
  "eventId": "evt_02",
  "command": "sessions",
  "component": "session_discovery",
  "projectKey": "pi-learn-4cf153",
  "sessionId": "019ec3f6-f83e-...",
  "sessionFile": "/home/hieptran/.pi/agent/sessions/.../session.jsonl",
  "message": "Session header matched project",
  "data": {
    "piSessionVersion": 3,
    "size": 666643,
    "mtimeMs": 1781407276782
  },
  "safety": {
    "redacted": true,
    "containsRawContent": false,
    "containsSecret": false
  }
}
```

### 6.3 Parser warning

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-06-14T10:00:02.000Z",
  "level": "warn",
  "stream": "self_improvement",
  "event": "parser_warning_emitted",
  "runId": "run_01",
  "eventId": "evt_03",
  "component": "parser",
  "projectKey": "pi-learn-4cf153",
  "sessionId": "019ec3f6-f83e-...",
  "entryId": "abc12345",
  "message": "Unknown entry type encountered",
  "data": {
    "warningCode": "unknown_entry_type",
    "entryType": "usage_snapshot"
  },
  "safety": {
    "redacted": true,
    "containsRawContent": false,
    "containsSecret": false
  }
}
```

### 6.4 Proposal created

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-06-14T10:05:00.000Z",
  "level": "audit",
  "stream": "audit",
  "event": "proposal_created",
  "runId": "run_02",
  "eventId": "evt_10",
  "component": "proposal",
  "projectKey": "pi-learn-4cf153",
  "ruleId": "R-0001",
  "proposalId": "P-0007",
  "message": "Proposal created from repeated parser warning",
  "data": {
    "target": "parser",
    "risk": "medium",
    "evidenceCount": 4
  },
  "safety": {
    "redacted": true,
    "containsRawContent": false,
    "containsSecret": false
  }
}
```

---

## 7. What to log by component

### 7.1 CLI

Log:

```txt
command_start
command_end
command_failed
arguments_normalized
```

Do not log:

```txt
raw full file content
raw env vars
```

### 7.2 Config

Log:

```txt
config_loaded
config_source_missing
config_parse_failed
config_policy_violation
```

Data:

```txt
globalConfigFound
projectConfigFound
effective redaction setting
autoApply/autoPush values
```

Do not log full config if it may contain private paths/secrets. Prefer selected safe fields.

### 7.3 Session discovery

Log:

```txt
session_discovery_start
session_discovery_end
session_discovered
session_skipped
session_header_warning
```

Data:

```txt
scannedFiles
matchedCount
warningCount
sessionId
sessionFile
cwd/projectKey
```

### 7.4 Parser/tree

Log:

```txt
parse_start
parse_end
parse_warning
tree_built
active_path_resolved
branch_counted
```

Data:

```txt
entryCount
activeLeafId
activePathCount
branchCount
warningCount
```

### 7.5 Normalizer/cache

Log:

```txt
normalize_start
normalize_end
cache_write_start
cache_write_end
cache_write_failed
cache_stale
cache_hit
```

Data:

```txt
manifestPath
eventsPath
metricsPath
warningsPath
eventCount
redactedEventCount
```

### 7.6 Rule engine

Log:

```txt
rule_engine_start
rule_engine_end
rule_matched
rule_skipped
rule_error
proposal_candidate_created
```

Data:

```txt
ruleId
matchCount
evidenceCount
proposalFingerprint
```

### 7.7 Proposals/apply/eval

Log:

```txt
proposal_created
proposal_deduped
proposal_status_changed
apply_started
branch_created
patch_applied
test_started
test_finished
commit_created
rollback_started
eval_started
eval_finished
```

Data:

```txt
proposalId
status
target
risk
targetFiles
testExitCode
evalPass
```

---

## 8. Harness self-improvement from logs

Harness logs become input to improve harness itself.

Examples:

| Log signal | Improve target | Example fix |
|---|---|---|
| `parse_warning` repeated | parser | Add support for new entry type |
| `redaction_warning` repeated | redaction | Add new secret regex |
| `cache_write_failed` repeated | storage | Improve atomic write/error handling |
| `rule_error` repeated | rule engine | Fix detector bug |
| `proposal_deduped` high count | proposal dedupe | Improve fingerprinting |
| `rule_matched` then proposal rejected often | rules | Tune threshold or disable rule |
| `command_failed` common for same command | CLI UX | Improve validation/error message |
| `slow_command` repeated | performance | Add caching/pre-sort/index |
| `eval_failed` after patch | apply/eval | Add rollback guard |

Self-improvement flow:

```txt
harness logs
  → harness health report
  → improvement proposal
  → review
  → patch harness runtime/rules/docs
  → tests/evals
```

---

## 9. Config additions

Add to config later:

```json
{
  "logging": {
    "enabled": true,
    "level": "info",
    "logDir": "~/.pi/harness/logs",
    "runtime": true,
    "audit": true,
    "errors": true,
    "selfImprovement": true,
    "console": false,
    "redact": true,
    "includeStack": true,
    "retentionDays": 30,
    "maxFileSizeMb": 20
  }
}
```

MVP defaults:

```txt
logging.enabled=true
logging.level=info
logging.console=false unless --verbose
logging.redact=true
logging.audit=true
logging.errors=true
```

---

## 10. CLI additions

Future commands:

```bash
harness logs --project . --last 100
harness logs --run <runId>
harness health --project .
harness self-check --project .
harness doctor --verbose
```

Flags:

```txt
--verbose       print runtime logs to stderr
--quiet         suppress non-error console output
--log-level     debug|info|warn|error
--no-log-file   disable file logging for a run
```

---

## 11. Retention and privacy

Default retention:

```txt
runtime logs: 30 days
error logs: 60 days
audit logs: 180 days or until manually pruned
```

Privacy policy:

```txt
- logs are private under ~/.pi/harness/logs
- no raw session content by default
- no secrets by default
- all excerpts must pass redaction
- export requires explicit command
```

Log cleanup command:

```bash
harness logs prune --older-than 30d
```

---

## 12. MVP implementation recommendation

Do not wait until Phase 9. Add minimal logging in Phase 3 before cache writer.

Minimum logging module:

```txt
src/logging/
├── logger.js
├── event.js
└── redact-log-event.js
```

Minimum events:

```txt
command_start
command_end
command_failed
config_loaded
project_resolved
session_discovery_start
session_discovery_end
parse_start
parse_end
parse_warning
```

Then Phase 3 adds:

```txt
normalize_start/end
cache_write_start/end
```

Phase 5 adds:

```txt
rule_matched
proposal_created
proposal_deduped
```

Phase 9 adds:

```txt
apply_started
patch_applied
test_finished
commit_created
rollback_started
```

---

## 13. Final policy

```txt
Harness must be observable like any production system.
Pi session logs explain agent behavior.
Harness logs explain harness behavior.
Self-improvement uses both, but never silently mutates harness artifacts.
All harness logs are private, redacted, structured, and correlated by runId/projectKey/sessionId/proposalId.
```
