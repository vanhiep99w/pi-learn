# 🛡️ Agent Harness — Hiểu Về Extension System

> Tổng hợp từ: `harness/docs/HARNESS_GUIDE.md`, `harness/docs/PI_FEATURES_INTEGRATION.md`, `harness/docs/AGENT_HARNESS_THEORY.md`

---

## Mục Lục

- [1. Agent Harness Là Gì](#1-agent-harness-là-gì)
- [2. Tại Sao Dùng Extension](#2-tại-sao-dùng-extension)
- [3. Kiến Trúc 4 Extensions](#3-kiến-trúc-4-extensions)
- [4. 4 Agents — Ai Làm Gì](#4-4-agents--ai-làm-gì)
- [5. Tool `subagent` — Trái Tim Của Harness](#5-tool-subagent--trái-tim-của-harness)
- [6. Event Hooks — Tự Động Hóa Lifecycle](#6-event-hooks--tự-động-hóa-lifecycle)
- [7. Commands vs Tools](#7-commands-vs-tools)
- [8. Prompt Templates — Workflow Triggers](#8-prompt-templates--workflow-triggers)
- [9. Skills Trong Harness](#9-skills-trong-harness)
- [10. Beads — Task Management](#10-beads--task-management)
- [11. Cấu Hình `.pi/settings.json`](#11-cấu-hình-pisettingsjson)
- [12. Luồng Hoạt Động Thực Tế](#12-luồng-hoạt-động-thực-tế)
- [13. Priority Build Order](#13-priority-build-order)

---

## 1. Agent Harness Là Gì

```
Coding Agent = AI Model(s) + Harness
```

**Harness** là infrastructure bao quanh AI model, quản lý mọi thứ **ngoại trừ** reasoning:

| Máy Tính | AI Tương Đương |
|----------|---------------|
| CPU | Model (sức mạnh reasoning) |
| RAM | Context Window |
| **Operating System** | **Agent Harness** |
| Application | Agent (logic cụ thể) |

### Tại sao LLM cần Harness?

LLM vốn **stateless** — mỗi session bắt đầu từ zero. Không có harness:

- Agent cố làm tất cả 1 lần → cạn context giữa chừng
- Session sau tuyên bố "xong" mà không verify thực tế
- Context đầy noise → model drift khỏi goal
- Tool calls hallucinate tham số không hợp lệ

Harness giải quyết: **state persistence**, **context engineering**, **verification loops**, **sub-agent isolation**.

---

## 2. Tại Sao Dùng Extension

Harness được implement **hoàn toàn qua Pi Extensions** — không phải core Pi code. Lý do:

| Ưu điểm | Giải thích |
|---------|-----------|
| **Modular** | Bật/tắt từng phần qua flag, không ảnh hưởng nhau |
| **Composable** | 4 extensions độc lập, chạy song song |
| **Portable** | Dùng được ở bất kỳ Pi project nào |
| **Upgradable** | Model mới → xóa bỏ harness cũ không ảnh hưởng Pi core |

Extension API dùng: `pi.registerTool()`, `pi.registerCommand()`, `pi.on()`, `pi.exec()`, `pi.registerFlag()`

---

## 3. Kiến Trúc 4 Extensions

```
harness/extensions/
├── harness-state/       ← Phase 1: Beads context + session hooks
├── harness-subagent/    ← Phase 2: Tool subagent (core orchestration)
├── harness-verify/      ← Phase 3: Back-pressure (typecheck, lint, test)
└── harness-quality/     ← Phase 5: Quality scoring + entropy management
```

### Mỗi Extension Làm Gì

#### `harness-state`

**Vai trò:** Memory & state management — biến Pi thành agent có trạng thái.

- Hook `session_start` → auto-inject Beads context (`bd prime`)
- Hook `session_shutdown` → auto-push `bd dolt push`
- Đăng ký tools: `harness_prime`, `harness_task`
- Đăng ký commands: `/tasks`, `/ready`, `/status`, `/claim`, `/close`
- Đăng ký flags: `--harness`, `--harness-verify`, `--harness-model`

#### `harness-subagent`

**Vai trò:** Orchestration — cho LLM điều phối sub-agents.

- Đăng ký tool `subagent` (core của toàn bộ hệ thống)
- Đăng ký commands: `/pipeline`, `/triage`
- Custom TUI rendering cho `subagent` tool calls

#### `harness-verify`

**Vai trò:** Quality gates — back-pressure sau mỗi edit.

- Hook `tool_call` → chặn writes vào protected paths (`.beads/`, `.env`, ...)
- Hook `tool_call` → confirm trước dangerous bash commands (`rm -rf`, `DROP TABLE`)
- Hook `tool_result` → auto-typecheck sau mỗi `edit`/`write` → append errors vào result

#### `harness-quality`

**Vai trò:** Entropy management — đo quality, phát hiện rot.

- Tool `harness_quality`: chạy typecheck + lint + test coverage → trả về score
- Định kỳ scan entropy (stale docs, dead code, oversized files)

---

## 4. 4 Agents — Ai Làm Gì

```
           ┌──────────────────────┐
           │     Orchestrator     │  ← LLM chính (Pi session), expensive model
           └────┬──────┬──────┬───┘
                │      │      │
        ┌───────▼┐  ┌──▼───┐  ┌▼────────┐
        │ Scout  │  │Planner│  │ Worker  │
        │(Haiku) │  │(Sonnet)│  │(Sonnet) │
        │read-only│  │read-only│  │full tools│
        └───┬────┘  └──┬────┘  └──┬──────┘
            │          │          │
        condensed  plan JSON   code+commit
        findings   output      +bd close
            │          │          │
             └──────────┴──────────┘
                        │
             ┌──────────▼──────────┐
             │      Reviewer       │  (Sonnet, read-only+bash)
             └─────────────────────┘
```

| Agent | Model | Tools | Quyền | Max Turns |
|-------|-------|-------|-------|-----------|
| **Scout** | Haiku | read, grep, find, ls, bash | Read-only | 40 |
| **Planner** | Sonnet | read, grep, find, ls | Read-only | 20 |
| **Worker** | Sonnet | read, bash, edit, write, grep, find, ls | Full | 60 |
| **Reviewer** | Sonnet | read, grep, find, ls, bash | Read-only + test | 30 |

### Quy tắc Worker (quan trọng nhất)

```
1. bd ready           → chọn task priority cao nhất
2. bd update --claim  → atomic claim (set assignee + in_progress)
3. Implement theo plan
4. typecheck + lint + test
5. git commit
6. bd close --reason "..."
7. EXIT — KHÔNG làm thêm task
```

> **Tại sao 1 task/session?** Context rot — performance giảm theo session length. "Corrections are cheap, waiting is expensive."

---

## 5. Tool `subagent` — Trái Tim Của Harness

LLM orchestrator gọi `subagent` để delegate work. Có 3 modes:

### Mode 1: Single agent

```typescript
subagent({
  agent: "scout",
  task: "Find all API endpoints related to auth",
  taskId: "bd-a3f8.1"
})
```

### Mode 2: Chain (sequential)

```typescript
subagent({
  taskId: "bd-a3f8.1",
  chain: [
    { agent: "scout",   task: "Explore auth codebase, collect context" },
    { agent: "planner", task: "Create implementation plan from scout findings" },
    { agent: "worker",  task: "Implement plan, claim task, commit, close" },
  ]
})
```

### Mode 3: Parallel

```typescript
subagent({
  tasks: [
    { agent: "scout", task: "Explore frontend auth code" },
    { agent: "scout", task: "Explore backend auth code" },
  ]
})
```

### Custom TUI Rendering

Tool call hiện: `🤖 subagent [bd-a3f8.1] scout → planner → worker`

Tool result hiện: `✓ worker completed (23 turns, $0.042)` + summary khi expand.

---

## 6. Event Hooks — Tự Động Hóa Lifecycle

Harness dùng `pi.on()` để inject behavior vào Pi lifecycle:

### `session_start` — Auto-inject context

```typescript
pi.on("session_start", async (_event, ctx) => {
  if (!pi.getFlag("harness")) return;
  const prime = await pi.exec("bd", ["prime"]);
  // LLM nhận được full task landscape ngay khi session bắt đầu
});
```

### `tool_call` — Permission gate

```typescript
pi.on("tool_call", async (event, ctx) => {
  // Block protected paths
  if (["write", "edit"].includes(event.toolName)) {
    const path = event.input.path;
    if ([".beads/", ".env", "package-lock.json"].some(p => path.includes(p))) {
      return { block: true, reason: `Protected path: ${path}` };
    }
  }

  // Confirm dangerous bash
  if (event.toolName === "bash") {
    if (/rm\s+-rf|DROP\s+TABLE/i.test(event.input.command)) {
      const ok = await ctx.ui?.confirm("⚠️ Dangerous!", `Allow?`);
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  }
});
```

### `tool_result` — Back-pressure verify

```typescript
pi.on("tool_result", async (event, ctx) => {
  if (!pi.getFlag("harness-verify")) return;
  if (["edit", "write"].includes(event.toolName)) {
    const tsc = await pi.exec("npx", ["tsc", "--noEmit"]);
    if (tsc.exitCode !== 0) {
      // MODIFY result — LLM thấy errors ngay, tự sửa
      return {
        content: [
          ...event.content,
          { type: "text", text: `\n⚠️ TypeScript errors:\n${tsc.stderr}` },
        ],
      };
    }
    // Success → swallow (không thêm noise)
  }
});
```

### `session_shutdown` — Auto-sync

```typescript
pi.on("session_shutdown", async () => {
  await pi.exec("bd", ["dolt", "push"]); // push Beads DB về remote
});
```

---

## 7. Commands vs Tools

| | Commands (`registerCommand`) | Tools (`registerTool`) |
|---|---|---|
| **Ai gọi** | User gõ `/name` | LLM tự gọi mỗi turn |
| **Khi nào** | Khi user muốn xem info | Khi LLM cần thực hiện action |
| **Ví dụ** | `/status` → dashboard | `subagent(...)` → run agent |

### Commands trong Harness

| Command | Mô Tả | bd Equivalent |
|---------|--------|--------------|
| `/tasks` | All open tasks | `bd list --status open` |
| `/ready` | Tasks no blockers | `bd ready` |
| `/status` | Dashboard: ready + blocked + stats | `bd prime` |
| `/claim <id>` | Claim task | `bd update <id> --claim` |
| `/close <id>` | Close task | `bd close <id>` |
| `/pipeline <id>` | Trigger scout→planner→worker | Inject prompt → LLM |
| `/triage <desc>` | Create epic + subtasks | Scout → bd create |
| `/quality` | Quality score | `harness_quality` tool |

### Tools trong Harness

| Tool | Mô Tả |
|------|--------|
| `subagent` | Delegate sang scout/planner/worker/reviewer |
| `harness_prime` | Get full Beads context (ready, blocked, stats) |
| `harness_task` | CRUD tasks (create/claim/close/show) — tránh LLM hallucinate bash flags |
| `harness_quality` | Typecheck + lint + test coverage → quality score |

---

## 8. Prompt Templates — Workflow Triggers

Nằm ở `harness/prompts/*.md`. User gõ `/implement Add OAuth` → Pi inject template + args vào LLM.

| Template | Trigger | Flow |
|----------|---------|------|
| `implement.md` | `/implement <task>` | scout → planner → worker |
| `review-fix.md` | `/review-fix <task>` | worker → reviewer → worker(fix) |
| `scout-plan.md` | `/scout-plan <task>` | scout → planner (không implement) |
| `triage.md` | `/triage <desc>` | scout → create epic + subtasks |
| `full-pipeline.md` | `/full-pipeline <task>` | scout → planner → worker → reviewer |
| `cleanup.md` | `/cleanup` | reviewer → scan entropy |

**Ví dụ `implement.md`:**

```markdown
---
description: Scout → Planner → Worker pipeline with Beads tracking
---
Implement: $@

1. Run harness_prime to get task landscape
2. Find matching task or create: harness_task(action="create", ...)
3. subagent chain với taskId:
   - scout: explore relevant code
   - planner: create step-by-step plan
   - worker: claim → implement → verify → commit → close
4. Verify all tests pass after worker completes
```

---

## 9. Skills Trong Harness

Skills giải quyết vấn đề **progressive disclosure** — không nhét tất cả vào AGENTS.md.

```
harness/skills/
├── harness-guide/SKILL.md     ← LLM load khi cần hiểu hệ thống
└── beads-workflow/SKILL.md    ← LLM load khi cần dùng bd CLI
```

> **Research:** Hầu hết agent instructions không được dùng → load on-demand tốt hơn nhét vào system prompt.

### `harness-guide` — Quick Reference

```yaml
---
name: harness-guide
description: How to use the Agent Harness system — agents, pipelines, Beads tasks
---
```

Nội dung: 4 agents, tools available, pipeline patterns, worker rule.

### `beads-workflow` — Beads CLI Reference

```yaml
---
name: beads-workflow
description: Beads (bd CLI) task tracking for AI agents — commands, dependencies, epics
---
```

Nội dung: core bd commands, NEVER use `bd edit`, dependency types.

---

## 10. Beads — Task Management

**Beads** (`bd` CLI) là hệ thống task management cho AI agents — Dolt DB (git-versioned SQL) với dependency graph.

### Lệnh cốt lõi

```bash
bd create "Title" -p 1 -t task          # Tạo task (priority 0-4)
bd create "Title" -t epic --parent <id>  # Tạo subtask
bd dep add <child> <parent>              # Thêm dependency
bd ready                                 # Tasks không có blocker
bd update <id> --claim                   # Claim (atomic: assignee + in_progress)
bd close <id> --reason "..."             # Complete task
bd show <id> --json                      # Task details
bd dep tree <id>                         # Dependency visualization
bd prime --json                          # Full agent context dump
bd stats                                 # Statistics
```

**KHÔNG dùng:** `bd edit` (interactive editor — thay bằng `bd update --flag`)

### So sánh: `bd` bash vs Beads MCP

| | `bd` via bash tool | Beads MCP Server |
|---|---|---|
| Token usage | ✅ Thấp hơn | Cao hơn |
| Latency | ✅ Nhanh hơn | Chậm hơn |
| Khi nào dùng | ✅ Terminal (Pi) | No-shell environments |

**Recommendation:** Dùng `bd` via bash (hoặc wrapped trong `harness_task` tool).

---

## 11. Cấu Hình `.pi/settings.json`

```json
{
  "theme": "midnight-aurora",
  "tools": ["read", "bash", "edit", "write"],
  "extensions": [
    "./harness/extensions/harness-state",
    "./harness/extensions/harness-subagent",
    "./harness/extensions/harness-verify",
    "./harness/extensions/harness-quality"
  ]
}
```

### CLI Flags

```bash
pi --harness                           # Enable (default)
pi --no-harness                        # Disable hoàn toàn
pi --harness-verify=false              # Bỏ auto-typecheck
pi --harness-model=claude-haiku-4-5    # Dùng model rẻ hơn cho agents
pi --harness-scout-model=claude-haiku-4-5  # Model riêng cho scout
```

---

## 12. Luồng Hoạt Động Thực Tế

### Ví dụ: User gõ `/implement Add OAuth login`

```
1. Pi inject template implement.md + args "Add OAuth login" vào LLM

2. LLM gọi harness_prime()
   → Nhận: 3 tasks ready, 2 blocked, recent closes

3. LLM gọi harness_task(action="create", title="Add OAuth login", type="feature")
   → bd create "Add OAuth login" -t feature
   → Nhận: task ID "bd-f2a1"

4. LLM gọi subagent(taskId="bd-f2a1", chain=[
     {agent: "scout",   task: "Find auth-related code, OAuth dependencies"},
     {agent: "planner", task: "Plan OAuth implementation from scout findings"},
     {agent: "worker",  task: "Implement, typecheck, commit, close bd-f2a1"},
   ])

5. Scout chạy (Haiku):
   - grep/find auth files
   - Đọc existing auth code
   - Output: condensed findings

6. Planner chạy (Sonnet, thinking: medium):
   - Nhận scout findings
   - Output: step-by-step plan JSON

7. Worker chạy (Sonnet, full tools):
   - harness_task(action="claim", taskId="bd-f2a1")
   - Implement từng bước
   - Mỗi edit → harness-verify hook chạy tsc ngay
   - git commit -m "feat: add OAuth login"
   - harness_task(action="close", taskId="bd-f2a1", reason="OAuth implemented")
   - EXIT

8. Orchestrator gọi subagent(agent="reviewer", taskId="bd-f2a1",
     task="Review OAuth implementation")

9. Reviewer output: structured pass/fail
   → Nếu FAIL → tạo subtask fix, loop lại
```

---

## 13. Priority Build Order

### 🔴 Phase 1 — Must (core)

| File | Nội Dung |
|------|---------|
| `harness/extensions/harness-state/index.ts` | session hooks + harness_prime + harness_task + /ready /status |
| `harness/extensions/harness-subagent/index.ts` | tool subagent + /pipeline |
| `harness/agents/scout.md` | Scout agent definition |
| `harness/agents/planner.md` | Planner agent definition |
| `harness/agents/worker.md` | Worker agent definition |
| `harness/agents/reviewer.md` | Reviewer agent definition |

### 🟡 Phase 2 — Should

| File | Nội Dung |
|------|---------|
| `harness/extensions/harness-verify/index.ts` | tool_call gate + tool_result typecheck |
| `harness/prompts/*.md` | 6+ workflow templates |
| `.pi/settings.json` | Extension paths + config |

### 🟢 Phase 3 — Nice

| File | Nội Dung |
|------|---------|
| `harness/extensions/harness-quality/index.ts` | Quality scoring + entropy |
| `harness/skills/harness-guide/SKILL.md` | Progressive disclosure |
| `harness/skills/beads-workflow/SKILL.md` | Beads CLI reference |
| Custom TUI rendering | renderCall/renderResult cho subagent |

---

## Tham Khảo

| Tài Liệu | Nội Dung |
|----------|---------|
| [HARNESS_GUIDE.md](../harness/docs/HARNESS_GUIDE.md) | Hướng dẫn sử dụng |
| [AGENT_HARNESS_THEORY.md](../harness/docs/AGENT_HARNESS_THEORY.md) | Lý thuyết nền tảng |
| [PI_FEATURES_INTEGRATION.md](../harness/docs/PI_FEATURES_INTEGRATION.md) | Map Pi features → harness (code examples) |
| [PI_EXTENSIONS_GUIDE.md](PI_EXTENSIONS_GUIDE.md) | Extension API reference |
| [PI_SKILLS_GUIDE.md](PI_SKILLS_GUIDE.md) | Skills system |
| [PI_TOOLS_GUIDE.md](PI_TOOLS_GUIDE.md) | Custom tools API |
