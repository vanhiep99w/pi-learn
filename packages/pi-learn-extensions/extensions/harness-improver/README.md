# 🪞 harness-improver

> Pi extension lấy cảm hứng từ **Harness Self-Improvement (Phase 7.2)** —
> log mọi action của Pi → 1 lệnh là sinh suggestion → user multiselect + comment refine → apply.

## Vòng lặp self-improvement (1 phát)

```diagram
╭─────────────╮       ╭──────────────────╮      ╭──────────────────╮
│  OBSERVE    │ ────▶ │  /harness        │ ───▶ │ user pick + note │
│  (logger    │       │  scan + analyze  │      │  refine          │
│   nền)      │       │  + suggest       │      │                  │
╰─────────────╯       ╰──────────────────╯      ╰─────────┬────────╯
                                                          │
                                                          ▼
                                                ╭──────────────────╮
                                                │  apply (backup,  │
                                                │  no auto-commit) │
                                                ╰──────────────────╯
```

## Dùng như nào

### Cách nhanh — slash command

Trong Pi gõ:

```
/harness
```

→ chạy ngay (scan + analyze + suggest), mở editor cho bạn đọc danh sách suggestion → bạn gõ id (csv) → optional note refine → confirm → apply.

```
1. /harness
2. (đọc suggestions trong editor, Esc để đóng)
3. Pick ids: S-001, S-003
4. Note S-001? (Enter = skip)  → "thêm cảnh báo về retry"
5. Note S-003? (Enter = skip)  → 
6. Confirm? Yes
7. ✅ 2 applied · 0 skipped · 0 errors
```

### Qua chat (AI tự gọi tool)

```
"đề xuất cải thiện harness"           → AI gọi harness_suggest
"apply S-001 và S-003, S-001 thêm note: 'cảnh báo retry'"
                                      → AI gọi harness_apply ids=[…] notes={…}
```

## 2 tool đăng ký

| Tool | Mục đích | Tham số |
|---|---|---|
| `harness_suggest` | One-stop: scan + analyze + sinh suggestion. Cache lại. | `minPriority?: "low"\|"medium"\|"high"` |
| `harness_apply` | Apply suggestion theo id, optional note refine. Backup tự động. | `ids: string[]`, `notes?: { [id]: string }`, `skipConfirm?: bool` |

## 2 slash command

| Command | Mục đích |
|---|---|
| `/harness` | Full interactive flow: suggest → pick → note → apply |
| `/harness-logs` | Xem nhanh các log file đã ghi |

## Logging (background)

Mỗi event của Pi được append vào:

```
.pi/logs/harness/actions-YYYY-MM-DD.jsonl
```

Events được log: `tool_call`, `tool_result`, `tool_error`, `agent_start/end`, `session_start/shutdown`, `user_input`. Mỗi entry có `ts`, `cwd`, `kind`, `toolName`, `inputSummary` (truncate 600 char), `outputSummary`, `errorMessage`, `durationMs`.

Folders extension dùng:

```
.pi/logs/harness/
├── actions-2026-04-30.jsonl       ← raw event log
├── reports/                       ← snapshot mỗi lần suggest
│   └── suggestions-…-Z.md
└── backups/                       ← file gốc trước khi apply
    └── AGENTS.md.…-Z.bak
```

## Format suggestion

Mỗi suggestion có đủ field cho user quyết định:

- **Priority** — high / medium / low
- **Vấn đề** — what's wrong
- **Khi nào gặp** — when it triggers
- **Ảnh hưởng** — impact on agent
- **Bằng chứng** — evidence từ log (đã trích)
- **Hướng khắc phục** — proposed fix (mô tả)
- **Patch** _(optional)_ — markdown/text sẽ ghi vào file

## Patterns được phát hiện

- `repeated_tool_failure` — tool fail lặp cùng signature
- `frequent_bash_for_search` — `bash` dùng cho việc grep/find/read tool làm tốt hơn
- `long_running_tool` — p95 ≥ 5s
- `missing_skill_for_recurring_task` — chủ đề user lặp ≥3 lần chưa có skill
- `extension_error_recurrence` — extension throw cùng error nhiều lần
- `unused_tool` — extension cài nhưng không gọi
- `context_thrash` — nhiều session shutdown/restart
- `no_logs_yet` — chưa có data, hướng dẫn enable

## Note refine

Khi bạn thêm note cho suggestion (qua slash command hoặc tham số `notes` của tool), note sẽ được **prepend** vào content như block:

```markdown
> 📝 Note (user): cảnh báo retry — chỉ áp dụng khi count ≥ 3
```

Giúp giữ vết refine ngay trong file đích, dễ trace sau này.

## Lưu ý

- KHÔNG tự `git commit` — backup tại chỗ + để user review.
- Idempotent best-effort: section đã tồn tại → skip append để không trùng.
- File đã tồn tại với mode `create` → skip để tránh ghi đè.
