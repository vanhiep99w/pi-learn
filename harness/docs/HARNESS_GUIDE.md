# 🛡️ Agent Harness — Hướng Dẫn Sử Dụng

> Tài liệu cho hệ thống Agent Harness trên Pi — multi-agent team orchestration theo mô hình Agent Harness.
> Task management qua **[Beads](https://github.com/steveyegge/beads)** (`bd` CLI).
>
> Reference: [agent-harness-comprehensive.md](file:///home/hieptran/Desktop/pi-learn/docs/agent-harness-comprehensive.md)

---

## Mục Lục

- [1. Agent Harness Là Gì](#1-agent-harness-là-gì)
- [2. Kiến Trúc Tổng Quan](#2-kiến-trúc-tổng-quan)
- [3. 4 Agents — Ai Làm Gì](#3-4-agents--ai-làm-gì)
- [4. Task Management — Beads](#4-task-management--beads)
- [5. Subagent Tool — Cách LLM Orchestrate](#5-subagent-tool--cách-llm-orchestrate)
- [6. Execution Modes](#6-execution-modes)
- [7. Episode Compression — Context Firewall](#7-episode-compression--context-firewall)
- [8. Verification & Back-Pressure](#8-verification--back-pressure)
- [9. Workflow Templates](#9-workflow-templates)
- [10. Entropy Management & Quality](#10-entropy-management--quality)
- [11. Cấu Trúc Thư Mục](#11-cấu-trúc-thư-mục)
- [12. 10 Nguyên Tắc Thiết Kế](#12-10-nguyên-tắc-thiết-kế)
- [13. Troubleshooting](#13-troubleshooting)

---

## 1. Agent Harness Là Gì

**Agent Harness** là infrastructure bao quanh AI model, quản lý mọi thứ **ngoại trừ** reasoning:

```text
Coding Agent = AI Model(s) + Harness
```

| Thành Phần Máy Tính | Tương Đương AI |
|---------------------|---------------|
| CPU | Model (sức mạnh reasoning) |
| RAM | Context Window (bộ nhớ tạm) |
| **Operating System** | **Agent Harness** (quản lý context, tools, state) |
| Application | Agent (logic cụ thể) |

### Tại sao cần Harness?

LLM vốn **stateless** — mỗi session bắt đầu từ zero. Không có harness:

- Agent cố làm tất cả 1 lần → cạn context giữa chừng
- Session sau tuyên bố "xong" mà không verify thực tế
- Context đầy noise → model drift khỏi goal
- Tool calls hallucinate tham số không hợp lệ

Harness giải quyết bằng: **state persistence**, **context engineering**, **verification loops**, và **sub-agent isolation**.

---

## 2. Kiến Trúc Tổng Quan

```text
┌─────────────────────────────────────────────────────────────┐
│                     AGENT HARNESS                           │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  1. Context Engineering                               │  │
│  │     • AGENTS.md tối giản (~60 dòng, bản đồ)          │  │
│  │     • Progressive disclosure (chỉ load khi cần)       │  │
│  │     • Sub-agents = context firewalls                  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  2. Memory & State — powered by Beads (bd)            │  │
│  │     • Dolt DB: dependency-aware task graph             │  │
│  │     • bd ready → pick next work                       │  │
│  │     • Hierarchical issues (epic → task → subtask)     │  │
│  │     • Git history = long-term memory                  │  │
│  │     • Episode compression (condensed handoffs)        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  3. Tool Integration                                  │  │
│  │     • Built-in: read, bash, edit, write               │  │
│  │     • Custom: subagent (registerTool)                 │  │
│  │     • Chains: scout → planner → worker → reviewer     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  4. Verification & Guardrails                         │  │
│  │     • Auto typecheck + lint sau mỗi edit              │  │
│  │     • Test runner (swallow success, surface fail)     │  │
│  │     • Permission gates (protected paths)              │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│                    ┌──────────┐                              │
│                    │   LLM    │                              │
│                    └──────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

### Bốn extensions tạo nên harness:

| Extension | Vai Trò | Phase |
|-----------|---------|-------|
| `harness-state` | Beads context injection + session hooks | 1 |
| `harness-subagent` | Tool `subagent` cho LLM orchestrate agents | 2 |
| `harness-verify` | Back-pressure hooks (typecheck, lint, test) | 3 |
| `harness-quality` | Quality scoring + entropy management | 5 |

---

## 3. 4 Agents — Ai Làm Gì

### Agent Model

```text
                    ┌──────────┐
                    │  Human   │
                    │  Prompt  │
                    └────┬─────┘
                         │
              ┌──────────▼──────────┐
              │    Orchestrator     │   ← LLM chính (Pi session)
              │  (expensive model)  │
              └──┬──────┬──────┬───┘
                 │      │      │
         ┌───────▼┐  ┌──▼───┐  ┌▼────────┐
         │ Scout  │  │Planner│  │ Worker  │
         │(Haiku) │  │(Sonnet)│  │(Sonnet) │
         │read-only│  │read-only│  │full tools│
         └───┬────┘  └──┬────┘  └──┬──────┘
             │          │          │
         condensed  plan JSON   code + commit
         findings   output      + bd close
             │          │          │
              └──────────┴──────────┘
                         │
              ┌──────────▼──────────┐
              │    Reviewer         │
              │    (Sonnet)         │
              │    read-only        │
              └─────────────────────┘
```

### Chi tiết từng agent:

#### Scout — Trinh sát nhanh

| Property | Value |
|----------|-------|
| **Model** | `claude-haiku-4-5` |
| **Tools** | read, grep, find, ls, bash |
| **Thinking** | off |
| **Max turns** | 40 |
| **Quyền** | Read-only — KHÔNG sửa file |

**Nhiệm vụ:**
1. Chạy `bd ready --json` để biết tasks sẵn sàng
2. Chạy `bd show <id>` để xem chi tiết task
3. Dùng `grep`/`find` để locate files liên quan
4. Đọc phần key (không cần toàn bộ file)
5. Trace dependencies quan trọng

**Output format:**

```text
### Task Context
bd-a3f8.1: "Design login UI" [P1] — ready, no blockers

### Files Khám Phá
- `path/to/file.ts:10-50` — mô tả

### Code Quan Trọng
(paste code thực — types, interfaces, functions)

### Kiến Trúc
Cách các thành phần kết nối (2-3 câu).

### Rủi Ro
Điểm dễ gây lỗi.
```

> **Tại sao Haiku?** Scout chỉ đọc và tóm tắt — không cần reasoning mạnh. Haiku nhanh + rẻ.

#### Planner — Lập kế hoạch

| Property | Value |
|----------|-------|
| **Model** | `claude-sonnet-4-5` |
| **Tools** | read, grep, find, ls |
| **Thinking** | medium |
| **Max turns** | 20 |
| **Quyền** | Read-only — TUYỆT ĐỐI KHÔNG sửa file |

**Nhiệm vụ:**
1. Xem `bd show <task-id>` để hiểu requirements
2. Nhận scout findings + user requirements
3. Tạo implementation plan cụ thể từng bước

**Output format:**

```text
### Mục Tiêu
Một câu tóm tắt.

### Kế Hoạch Thực Hiện
1. Bước one — file, function, thay đổi gì
2. Bước two — ...

### Files Cần Sửa
- `path/to/file.ts` — thay đổi gì, tại sao

### Files Mới (nếu có)
- `path/to/new.ts` — mục đích

### Test Plan
Verify implementation đúng bằng cách nào.

### Rủi Ro
Điểm dễ sai.
```

> **Quan trọng**: Worker sẽ thực thi plan nguyên văn. Hãy cụ thể tối đa.

#### Worker — Thực thi

| Property | Value |
|----------|-------|
| **Model** | `claude-sonnet-4-5` |
| **Tools** | read, bash, edit, write, grep, find, ls |
| **Thinking** | medium |
| **Max turns** | 60 |
| **Quyền** | Full — đọc, sửa, tạo file, chạy commands |

**Quy tắc vàng:**

1. `bd ready` → chọn task priority cao nhất
2. `bd update <id> --claim` → claim task (atomic: set assignee + in_progress)
3. Implement theo plan
4. Verify: typecheck, lint, test
5. `git add . && git commit -m "feat: ..."`
6. `bd close <id> --reason "Implemented ..."` 
7. Thoát sạch — **KHÔNG làm thêm task khác**

> **Tại sao 1 task/session?** Context rot — performance giảm dần theo session length. Commit thường xuyên = state recovery dễ dàng. "Corrections are cheap, waiting is expensive."

#### Reviewer — Code review

| Property | Value |
|----------|-------|
| **Model** | `claude-sonnet-4-5` |
| **Tools** | read, grep, find, ls, bash |
| **Thinking** | medium |
| **Max turns** | 30 |
| **Quyền** | Read-only + chạy tests |

**Nhiệm vụ:**
1. `bd show <id>` → xem task requirements
2. Verify implementation against plan
3. Chạy tests, check types
4. Output structured pass/fail
5. Nếu có issues → `bd create "Fix: ..." -p 1 --parent <id>` tạo subtask

**Output format:**

```text
### Review Summary
X/Y items passed.

### Results
- [✅ PASS] Step 1: Add OAuth types — đúng, types correct
- [❌ FAIL] Step 2: Implement login flow — thiếu error handling
  → Fix: Thêm try/catch tại `src/auth.ts:45`
  → Created: bd-a3f8.1.1 "Fix: error handling in login flow"

### Recommendation
CHANGES REQUESTED — fix 1 issue rồi re-review.
```

---

## 4. Task Management — Beads

### Beads Là Gì?

**[Beads](https://github.com/steveyegge/beads)** (`bd`) là distributed graph issue tracker được thiết kế cho AI agents. Powered by [Dolt](https://github.com/dolthub/dolt) (version-controlled SQL database).

```text
Beads = Structured Memory cho Coding Agents
       = Dependency-aware task graph
       = Thay thế messy markdown plans
```

### Tại Sao Beads Thay Vì Custom JSON?

| Custom JSON state file | Beads (`bd` CLI) |
|------------------------|-----------------|
| Flat list of tasks | **Dependency graph** — blocking, ready detection |
| Custom code parse/validate | CLI agent gọi trực tiếp qua `bash` |
| No hierarchy | **Hierarchical IDs**: `bd-a3f8` → `bd-a3f8.1` |
| Merge conflicts | **Hash-based IDs** — zero conflict multi-agent |
| Manual state management | **Auto-ready**: `bd ready` chỉ hiện unblocked tasks |
| No compaction | **Semantic memory decay** — tóm tắt tasks cũ |
| Single machine | **Team sync** via Dolt remotes |

### Setup

```bash
# Install beads CLI
npm install -g @beads/bd

# Init trong project (stealth = không commit .beads/ vào git)
cd pi-learn
bd init --stealth
```

### Core Commands (Agent Reference)

#### Tạo Tasks

```bash
# Task đơn
bd create "Implement OAuth login" -p 1 -t task

# Epic với subtasks
bd create "Auth System" -t epic -p 1                    # → bd-a3f8
bd create "Login UI" -p 1 --parent bd-a3f8               # → bd-a3f8.1
bd create "Backend validation" -p 1 --parent bd-a3f8     # → bd-a3f8.2
bd create "Integration tests" -p 1 --parent bd-a3f8      # → bd-a3f8.3

# With labels
bd create "Fix auth bug" -p 0 -t bug -l "backend,urgent"
```

#### Dependencies

```bash
# bd-a3f8.2 blocked by bd-a3f8.1
bd dep add bd-a3f8.2 bd-a3f8.1

# View dependency tree
bd dep tree bd-a3f8
```

Output:
```text
🌲 Dependency tree for bd-a3f8:

→ bd-a3f8: Auth System [epic] [P1] (open)
  → bd-a3f8.1: Login UI [P1] (open)
  → bd-a3f8.2: Backend validation [P1] (open) ← blocked by .1
  → bd-a3f8.3: Integration tests [P1] (open)
```

**Dependency types:**

| Type | Blocking? | Dùng khi |
|------|-----------|---------|
| `blocks` (default) | ✅ Yes | Task ordering |
| `parent-child` | ✅ Yes | Epic hierarchies |
| `related` | ❌ No | Informational link |
| `caused-by` | ❌ No | Root cause link |
| `validates` | ❌ No | Test/verification link |
| `supersedes` | ❌ No | Replaces another issue |

#### Find Ready Work

```bash
# Tasks với no open blockers
bd ready

# Filtered
bd ready --priority 1
bd ready --label backend
bd ready --unassigned
```

Output:
```text
📋 Ready work (1 issues with no blockers):

1. [P1] bd-a3f8.1: Login UI
```

Chỉ `bd-a3f8.1` ready vì `.2` blocked by `.1`!

#### Work the Queue (Worker Flow)

```bash
# Claim task (atomic: set assignee + in_progress)
bd update bd-a3f8.1 --claim

# ... implement ...

# Complete
bd close bd-a3f8.1 --reason "Login UI implemented with OAuth flow"

# Check what just unblocked
bd ready
# → bd-a3f8.2 now ready! 🎉
```

#### Track Progress

```bash
# All open issues
bd list --status open

# Blocked issues
bd blocked

# Statistics
bd stats

# Show task details + audit trail
bd show bd-a3f8.1
```

### Compaction — Memory Decay

Beads hỗ trợ **semantic compaction** cho closed tasks cũ — giảm DB size + context:

```bash
# View stats
bd admin compact --stats

# Preview candidates (closed > 30 days)
bd admin compact --analyze --json

# Apply compaction
bd admin compact --apply --id bd-42 --summary summary.txt
```

> Compaction giữ summary, bỏ chi tiết — giống episodic memory. Tasks cũ fade nhưng essence còn.

### Agent Notes

- **KHÔNG** dùng `bd edit` — nó mở interactive editor. Dùng `bd update` với flags.
- Dùng `--json` flag cho machine-readable output.
- Hash-based IDs (`bd-a1b2`) prevent merge collisions khi multiple agents work concurrently.

---

## 5. Subagent Tool — Cách LLM Orchestrate

### Cơ chế core

LLM chính (trong Pi session) gọi tool `subagent`:

```text
User: "Implement OAuth login"
         │
         ▼
LLM (Orchestrator):
  1. Gọi bd ready → thấy bd-a3f8.1 ready
  2. Dùng chain scout → planner → worker
         │
         ▼
Tool call: subagent({
  taskId: "bd-a3f8.1",
  chain: [
    { agent: "scout", task: "Explore code for bd-a3f8.1" },
    { agent: "planner", task: "Plan implementation" },
    { agent: "worker", task: "Execute plan" }
  ]
})
         │
         ▼
Pi runtime (harness-subagent extension):
  1. Resolve taskId → chạy bd show bd-a3f8.1 → inject context
  2. Load scout.md → parse frontmatter
  3. Spawn: pi --mode json --model claude-haiku-4-5
       --tools read,grep,find,ls,bash --no-session
  4. Pipe task + task context → stdin
  5. Stream output → TUI (real-time)
  6. Compress result → condensed summary
  7. Pipe summary → planner stdin
  8. ... repeat for worker ...
  9. Worker auto: bd update bd-a3f8.1 --claim → implement → bd close
  10. Return final result cho Orchestrator LLM
```

### Spawn flow chi tiết

```text
harness-subagent extension nhận tool call:
         │
         ▼
   Load agent definition
   (harness/agents/scout.md)
         │
         ▼
   Parse YAML frontmatter:
     name: scout
     model: claude-haiku-4-5
     tools: read, grep, find, ls, bash
     thinking: off
     max_turns: 40
         │
         ▼
   Spawn child process:
     $ pi --mode json \
          --model claude-haiku-4-5 \
          --tools read,grep,find,ls,bash \
          --thinking off \
          --max-turns 40 \
          --no-session \
          --system-prompt <scout.md content>
         │
         ▼
   stdin ← task prompt
   stdout → JSON events (streaming)
         │
         ▼
   Parse events:
     - tool_call → hiện trong TUI
     - text_delta → stream text
     - message_complete → done
         │
         ▼
   Compress result → SubagentResult
   Return cho parent LLM
```

> **Quan trọng**: Mỗi subagent là **process riêng biệt** với **context window riêng**. Noise bị isolate. Chỉ essence trả về parent.

---

## 6. Execution Modes

Mọi execution mode đều nhận `taskId` — Beads task ID để agents biết đang làm task nào.

Extension tự động resolve `taskId`:
1. Chạy `bd show <taskId> --json` → lấy title, description, dependencies
2. Inject task context vào prompt của mỗi subagent
3. Worker tự `bd update <taskId> --claim` và `bd close <taskId>` khi xong

### Single

1 agent, 1 task Beads:

```typescript
subagent({
  taskId: "bd-a3f8.1",
  agent: "scout",
  task: "Explore codebase for this task"
})

// Agent nhận context:
// "Task bd-a3f8.1: Login UI [P1]
//  Parent: bd-a3f8 (Auth System)
//  Description: Design and implement login UI...
//  Dependencies: none (ready)"
```

### Chain (Sequential)

Output N → input N+1, tất cả cùng `taskId`:

```typescript
subagent({
  taskId: "bd-a3f8.1",
  chain: [
    { agent: "scout",   task: "Find relevant code" },
    { agent: "planner", task: "Create implementation plan" },
    { agent: "worker",  task: "Execute the plan" }
  ]
})

// Flow:
// Mỗi agent nhận task context từ bd show bd-a3f8.1
// scout output (compressed) → planner input
// planner output (compressed) → worker input
// worker auto: bd update bd-a3f8.1 --claim → implement → bd close
```

Nếu bất kỳ step nào fail → chain dừng, báo step nào failed.

### Parallel

Nhiều agents chạy đồng thời, mỗi cái cho 1 task khác nhau (max 4 concurrent):

```typescript
// Ví dụ: scout nhiều subtasks cùng lúc
subagent({
  tasks: [
    { taskId: "bd-a3f8.1", agent: "scout", task: "Explore Login UI code" },
    { taskId: "bd-a3f8.2", agent: "scout", task: "Explore Backend validation" },
    { taskId: "bd-a3f8.3", agent: "scout", task: "Explore Integration tests" }
  ]
})
```

TUI hiện:
```text
⏳ scout [bd-a3f8.1]: Login UI             (running)
✓  scout [bd-a3f8.2]: Backend validation   (done — 12 turns, $0.02)
⏳ scout [bd-a3f8.3]: Integration tests    (running)

Status: 1/3 done, 2 running
```

### Không có taskId (ad-hoc)

Cho tasks không liên quan Beads (exploration, Q&A):

```typescript
subagent({
  agent: "scout",
  task: "How is error handling structured in this project?"
})
// Không có taskId → không inject bd context, không auto-claim/close
```

---

## 7. Episode Compression — Context Firewall

### Vấn đề: Context Rot

Nghiên cứu cho thấy tất cả LLM **degrade** khi context tăng. Đặc biệt khi context chứa nhiều noise (tool calls trung gian, debug output, ...).

### Giải pháp: Sub-agent = Context Firewall

```text
Không có compression:
  Parent LLM context:
    [user prompt] + [scout: 40 tool calls, 15k tokens]
    + [planner: 20 tool calls, 10k tokens]
    + [worker: 60 tool calls, 30k tokens]
    = 55k+ tokens noise → CONTEXT ROT

Với compression:
  Parent LLM context:
    [user prompt]
    + [scout summary: 500 tokens]
    + [planner summary: 800 tokens]
    + [worker summary: 300 tokens]
    = ~2k tokens essential info → CLEAN CONTEXT
```

### SubagentResult Format

Mỗi subagent trả về dạng compressed:

```typescript
interface SubagentResult {
  agent: string;            // "scout"
  summary: string;          // 5-10 dòng max — essence only
  citations: string[];      // ["src/auth.ts:42-60", "src/db.ts:10-30"]
  artifacts?: object;       // Structured data (plan steps, review results)
  status: "success" | "error";
  usage: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    model: string;
  };
}
```

**Nguyên tắc:** Noise bị isolate trong subagent. Chỉ summary + citations trả về. Parent có thể follow citations bằng `read()` nếu cần chi tiết.

### Liên hệ với Beads Compaction

Beads compaction + episode compression cùng giải quyết 1 vấn đề:

| Beads Compaction | Episode Compression |
|-----------------|-------------------|
| Closed tasks cũ → summary | Subagent output → summary |
| Giảm DB size | Giảm context window |
| `bd admin compact` | Subagent return format |
| **Persistent** (disk) | **Ephemeral** (per-session) |

---

## 8. Verification & Back-Pressure

### Flow

```text
Worker gọi edit("src/auth.ts", ...)
         │
         ▼
harness-verify hook fires:
  ┌─ Tier 1: tsc --noEmit ─────────────► errors? → surface
  ├─ Tier 2: biome check . ─────────────► errors? → surface
  └─ Tier 3: npm test --related ────────► fails? → surface
         │
    Tất cả pass?
         │
    YES: Im lặng hoàn toàn ← KHÔNG surface gì
    NO:  CHỈ surface failures → Worker tự fix → loop
```

### Verification Tiers

| Tier | Tool | Speed | Khi Nào |
|------|------|-------|---------|
| 1 — Static | `tsc --noEmit` | ~2s | Mỗi edit |
| 2 — Lint | `biome check .` | ~1s | Mỗi edit |
| 3 — Test | `npm test --related` | ~10s | Sau file thay đổi |
| 4 — E2E | Custom script | ~30s+ | Trước `bd close` |

### Back-Pressure Rule

> ⚠️ **CRITICAL**: Swallow ALL success output. Surface ONLY failures.

**Tại sao?** 4000 dòng passing tests tràn ngập context window → agent hallucinate. Đây là bài học đắt giá từ OpenAI Codex team.

```text
❌ BAD:
  $ npm test
  PASS src/auth.test.ts (15 tests)
  PASS src/db.test.ts (22 tests)
  ... 4000 dòng nữa ...
  → Tràn context → Agent confused

✅ GOOD:
  npm test → all passed ✓
  (0 bytes trong context)
```

### Permission Gates

Protected paths không cho agents edit:

```typescript
const PROTECTED = [
  ".env",                    // secrets
  "package-lock.json",       // auto-generated
  ".beads/",                 // Beads database
];
```

---

## 9. Workflow Templates

Dùng slash commands gọi predefined pipelines:

### `/implement <task>`

```text
Pipeline: scout → planner → worker

1. bd ready → find matching task (hoặc tạo mới)
2. Scout explore codebase, tìm relevant code
3. Planner tạo implementation plan
4. Worker: bd claim → implement → verify → bd close → git commit
```

### `/review-fix <task>`

```text
Pipeline: worker → reviewer → worker(fix)

1. Worker implement thay đổi
2. Reviewer check, list issues
3. Nếu issues → reviewer tạo bd subtasks cho mỗi issue
4. Worker fix issues
5. Loop cho đến khi reviewer approve
```

### `/scout-plan <task>`

```text
Pipeline: scout → planner (KHÔNG code)

1. Scout explore relevant code
2. Planner tạo detailed plan
3. Output plan cho human review
→ Không thay đổi code nào
```

### `/triage <task>`

```text
Pipeline: scout → epic + subtask creation

1. Scout explores codebase to understand scope
2. Tạo Beads epic: bd create "<title>" -t epic
3. Break into subtasks: bd create "<step>" --parent <epic-id>
4. Add dependencies: bd dep add <child> <parent>
5. Output: bd dep tree <epic-id>
→ Ready cho /implement pipeline
```

### `/full-pipeline <task>`

```text
Pipeline: scout → planner → worker → reviewer → worker(fix)

Full cycle — từ khám phá đến implementation + review.
```

### `/cleanup`

```text
Pipeline: reviewer(scan) → worker(fix)

1. Reviewer scan codebase, list violations
2. Tạo bd tasks cho mỗi violation
3. Worker fix top-N violations
4. Commit mỗi fix riêng
5. bd close mỗi fix task
```

---

## 10. Entropy Management & Quality

### Vấn đề

AI agents nhân bản patterns đã có — kể cả patterns xấu. Theo thời gian, drift là không thể tránh.

### Quality Score

Tool `harness_quality` chạy scan:

```json
{
  "typescript": 0,
  "lint": 3,
  "testCoverage": 85,
  "avgFileSize": 180,
  "docFreshness": 2,
  "score": 78
}
```

### Golden Principles

| Principle | Check | Severity |
|-----------|-------|----------|
| File < 300 lines | `wc -l` | warning |
| No `any` types | `tsc --strict` | high |
| Lint clean | `biome check` | high |
| Tests pass | `npm test` | critical |
| Exported functions need JSDoc | reviewer check | low |

### Entropy Tracking qua Beads

```bash
# Tạo cleanup tasks trong Beads
bd create "Quality audit Q1" -t epic -l "entropy"
bd create "Fix lint violations" --parent <epic-id> -l "cleanup"
bd create "Reduce file sizes" --parent <epic-id> -l "cleanup"

# Track progress
bd dep tree <epic-id>
bd stats
```

### Cleanup Cycle

```text
Định kỳ chạy /cleanup:
  → Reviewer scan → list violations + severity
  → Tạo bd tasks cho violations
  → Sort by severity (critical → low)
  → Worker fix top-N tasks
  → bd close mỗi fix
  → Compact old closed tasks: bd admin compact

"Technical debt như khoản vay lãi suất cao
 — trả liên tục từng chút tốt hơn tích lũy."
```

---

## 11. Cấu Trúc Thư Mục

```text
harness/
├── AGENTS.md                          ← Bản đồ ~60 dòng
├── agents/
│   ├── scout.md                       ← Recon + bd ready context
│   ├── planner.md                     ← Plan, read bd show <id>
│   ├── worker.md                      ← bd claim → implement → bd close
│   └── reviewer.md                    ← Review + bd create subtask fixes
├── extensions/
│   ├── harness-state/
│   │   └── index.ts                   ← Beads context injection
│   ├── harness-subagent/
│   │   ├── index.ts                   ← Subagent tool
│   │   └── agents.ts                  ← Agent discovery
│   ├── harness-verify/
│   │   └── index.ts                   ← Back-pressure hooks
│   └── harness-quality/
│       └── index.ts                   ← Quality scoring
├── prompts/
│   ├── implement.md                   ← scout → planner → worker
│   ├── review-fix.md                  ← worker → reviewer → worker
│   ├── scout-plan.md                  ← scout → planner
│   ├── triage.md                      ← Break task → epic + subtasks
│   ├── full-pipeline.md               ← Full cycle
│   └── cleanup.md                     ← Entropy cleanup
└── docs/
    └── HARNESS_GUIDE.md               ← File này

.beads/                                ← Beads database (Dolt)
└── dolt/                              ← Version-controlled SQL DB
```

---

## 12. 10 Nguyên Tắc Thiết Kế

| # | Nguyên Tắc | Áp Dụng |
|---|-----------|---------|
| 1 | **Harness nhẹ, modular** | Mỗi concern = 1 extension, Beads = external tool |
| 2 | **Context là tài nguyên quý** | Sub-agents isolate noise, compress episodes |
| 3 | **Agent không thấy = không tồn tại** | Tasks trong Beads, docs trong docs/ |
| 4 | **Failures → tìm capability thiếu** | Verification auto-surface errors |
| 5 | **Corrections cheap, waiting expensive** | Worker commit thường xuyên + bd close |
| 6 | **Human taste → encode into tooling** | Golden principles → reviewer + linter |
| 7 | **Verification context-efficient** | Swallow success, surface failures only |
| 8 | **Start simple, iterate reactively** | Phase 1-2 trước, extend khi cần |
| 9 | **Build to delete** | Mỗi extension replaceable |
| 10 | **One task per session** | Worker: bd ready → claim → do → close → exit |

---

## 13. Troubleshooting

### Agent không thấy tasks

**Triệu chứng**: Agent bắt đầu từ zero, không biết task nào available.

**Nguyên nhân**: Beads chưa init, hoặc `harness-state` extension chưa inject context.

**Fix**:
```bash
bd doctor           # Check Beads config
bd list             # Verify tasks exist
bd ready            # Verify ready detection
```

### Worker làm quá nhiều trong 1 session

**Triệu chứng**: Worker cố implement 5 features cùng lúc → context rot → quality giảm.

**Fix**: Worker instructions enforce "1 task per session". Nếu vẫn xảy ra → giảm `max_turns` hoặc thêm hook kiểm tra claim count.

### bd ready trả về empty

**Triệu chứng**: Tasks tồn tại nhưng `bd ready` không hiện.

**Nguyên nhân**: Tất cả tasks bị blocked bởi dependencies chưa close.

**Fix**:
```bash
bd blocked          # Xem gì đang block gì
bd dep tree <id>    # Visualize dependency chain
bd dep cycles       # Check circular dependencies
```

### Context overflow trong chain dài

**Triệu chứng**: Full pipeline (5 agents) tràn parent context.

**Fix**: Kiểm tra episode compression — mỗi step chỉ trả 500-800 tokens summary.

### Verification loop vô hạn

**Triệu chứng**: Worker fix lỗi → tạo lỗi mới → loop.

**Fix**: Giới hạn retry count (3 max). Sau 3 retries → escalate cho human.

### Beads database corrupted

**Fix**:
```bash
bd doctor           # Diagnostic
bd migrate --inspect --json  # Check migration
bd admin cleanup --force     # Nuclear option (xóa closed issues)
```

---

## Tham Khảo

- [Beads — GitHub](https://github.com/steveyegge/beads) — Task tracker cho AI agents
- [Beads Quickstart](https://github.com/steveyegge/beads/blob/main/docs/QUICKSTART.md)
- [Beads Dependencies & Gates](https://github.com/steveyegge/beads/blob/main/docs/DEPENDENCIES.md)
- [Agent Harness — Tổng hợp toàn diện](file:///home/hieptran/Desktop/pi-learn/docs/agent-harness-comprehensive.md)
- [Pi Tools Guide](file:///home/hieptran/Desktop/pi-learn/docs/PI_TOOLS_GUIDE.md)
- [Pi Extensions Guide](file:///home/hieptran/Desktop/pi-learn/docs/PI_EXTENSIONS_GUIDE.md)
