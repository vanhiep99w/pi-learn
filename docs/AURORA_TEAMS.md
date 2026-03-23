# Aurora Teams — Tài liệu kỹ thuật chi tiết

> Multi-agent orchestration cho Pi — tự build, không phụ thuộc tmux

---

## Mục lục

0. [Phân tích sâu 2 tool hiện có](#0-phan-tich-sau)
1. [Tổng quan](#1-tong-quan)
2. [Kiến trúc](#2-kien-truc)
3. [Data Models](#3-data-models)
4. [Team Bus — Giao tiếp agents](#4-team-bus)
5. [Task Board — Shared state](#5-task-board)
6. [Agent Runner — Spawn & Monitor](#6-agent-runner)
7. [Orchestrator](#7-orchestrator)
8. [Workflow Engine](#8-workflow-engine)
9. [Extension & UI](#9-extension-ui)
10. [Agent Definitions](#10-agent-definitions)
11. [File Structure](#11-file-structure)
12. [Roadmap](#12-roadmap)

---

## 0. Phân tích sâu 2 tool hiện có

### A. Official Subagent (`badlogic/pi-mono`)

#### Cơ chế kỹ thuật (từ source code)

```typescript
// Spawn mỗi agent là 1 pi process riêng:
pi --mode json -p --no-session
   --model {agent.model}
   --tools {agent.tools}
   --append-system-prompt {tmpFile}   // inject system prompt
   "Task: {task}"

// Parse streaming JSON events:
{ type: "message_end", message: {...} }      // Turn hoàn thành
{ type: "tool_result_end", message: {...} }  // Tool kết thúc
```

**3 modes thuần túy:**
- `single`: chạy 1 agent, 1 task
- `parallel`: `mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY=4)` — dùng concurrency queue thật sự
- `chain`: vòng lặp tuần tự, inject `{previous}` = `getFinalOutput(messages)` của step trước

**Agent file format (rất clean):**
```markdown
---
name: scout
description: Fast codebase recon...
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---
System prompt...
```

**Agent prompts được thiết kế rất tốt:**
- `scout.md`: Output có cấu trúc cố định (Files Retrieved, Key Code, Architecture, Start Here)
- `planner.md`: Explicit "KHÔNG được sửa file", output format chuẩn cho worker đọc
- `worker.md`: Output structured cho reviewer biết file nào thay đổi
- `reviewer.md`: Bash chỉ dùng read-only (`git diff`, `git log`), phân cấp Critical/Warnings/Suggestions

**Streaming real-time:**
- `onUpdate()` callback mỗi khi có `message_end` hay `tool_result_end`
- Parallel mode: shared `allResults[]` array, mỗi task update index riêng → `emitParallelUpdate()`
- UI render: collapsed (10 items) ↔ expanded (Ctrl+O full markdown)

**Usage tracking chi tiết:**
```
3 turns  ↑12k  ↓4k  R8k  W2k  $0.023  ctx:45k  claude-haiku-4-5
```

#### Điểm mạnh

| # | Điểm mạnh | Chi tiết |
|---|-----------|----------|
| 1 | **Tích hợp Pi sâu** | Dùng native API: `renderCall`, `renderResult`, `onUpdate` streaming |
| 2 | **UI phong phú** | Collapsed/expanded view, markdown rendering, usage stats per agent |
| 3 | **Concurrency thật sự** | `mapWithConcurrencyLimit` với configurable concurrency |
| 4 | **Security model rõ ràng** | `agentScope: user/project/both`, confirm dialog cho project agents |
| 5 | **Agent prompts chuẩn** | Output structured, handoff rõ ràng giữa agents |
| 6 | **Abort propagation** | Ctrl+C → SIGTERM → 5s timeout → SIGKILL cho tất cả subprocesses |
| 7 | **Nhẹ, không dep** | Chỉ dùng Node built-ins + Pi API |

#### Điểm yếu

| # | Điểm yếu | Impact |
|---|-----------|--------|
| 1 | **Không có retry** | Agent fail → workflow dừng, không cố lại |
| 2 | **Chain là one-way** | A → B → C, không thể B hỏi lại A |
| 3 | **Parallel không có dependency** | Tất cả parallel tasks chạy cùng lúc, không thể "parallel sau khi A xong" |
| 4 | **Không có shared state** | Agents không biết nhau đang làm gì |
| 5 | **Không có approval flow** | Worker execute ngay, không pause hỏi user |
| 6 | **Context explosion** | `{previous}` inject TOÀN BỘ output step trước vào task string |
| 7 | **Max 8 parallel, 4 concurrent** | Hard-coded constants |
| 8 | **Không persist** | Nếu main Pi crash → mất toàn bộ trạng thái |

---

### B. pi-teams (`burggraf/pi-teams`)

#### Cơ chế kỹ thuật

**Giao tiếp qua tmux/terminal multiplexer:**
- Mỗi agent = 1 Pi instance trong terminal pane riêng
- "Communication" thực ra là: main agent gửi text vào pane của teammate qua tmux API
- Agents không thật sự gửi message cho nhau — tất cả qua main agent relay

**Agent definition giống official, thêm `thinking` field:**
```markdown
---
name: builder
tools: read,write,edit,bash
model: claude-sonnet-4
thinking: medium
---
```

**Team templates qua `teams.yaml`:**
```yaml
full: [scout, planner, builder, reviewer, documenter]
plan-build: [planner, builder, reviewer]
```

**Smart model resolution:**
- Gõ `gemini-2.5-flash` → tự tìm provider tốt nhất (OAuth trước → API key sau)
- `google-gemini-cli/gemini-2.5-flash` ưu tiên hơn `google/gemini-2.5-flash`

**Save team as template:**
```
CREATE → USE → SAVE → REUSE
```
Tự động tạo agent files + cập nhật `teams.yaml`

**Auto cleanup:** Session folder cũ hơn 1h bị xóa khi shutdown.

#### Điểm mạnh

| # | Điểm mạnh | Chi tiết |
|---|-----------|----------|
| 1 | **Visible agents** | Mỗi agent hiện trong terminal pane riêng, thấy được real-time |
| 2 | **Cross-platform** | tmux, Zellij, iTerm2, WezTerm, Windows Terminal |
| 3 | **Plan approval** | Teammate submit plan → user approve trước khi execute |
| 4 | **Thinking level** | Per-agent thinking: off/minimal/low/medium/high |
| 5 | **Broadcast** | Gửi message tới tất cả teammates cùng lúc |
| 6 | **Quality gate hooks** | Shell script chạy sau khi task hoàn thành (test, lint) |
| 7 | **Template save/load** | Lưu runtime team thành template để dùng lại |
| 8 | **Smart model resolve** | Ưu tiên OAuth/subscription provider để tiết kiệm chi phí |
| 9 | **Cài 1 lệnh** | `pi install npm:pi-teams` |

#### Điểm yếu

| # | Điểm yếu | Impact |
|---|-----------|--------|
| 1 | **Phụ thuộc tmux/terminal** | Không chạy được trong môi trường không có terminal multiplexer |
| 2 | **Agents không thật sự communicate** | Mọi thứ qua main agent relay, không có direct messaging |
| 3 | **Không có dependency resolution** | Không có "chạy A sau khi B và C xong" tự động |
| 4 | **Không có retry/fault tolerance** | Agent fail → thủ công xử lý |
| 5 | **Không có shared task board** | Không có global state tất cả agents đều thấy |
| 6 | **Context bị giới hạn** | Thông tin giữa agents phải relay qua main agent (bottleneck) |
| 7 | **Khó debug** | Nhiều pane, khó track flow |
| 8 | **Single manager** | Main agent là single point of failure |

---

### C. Aurora Teams — Những gì cần improve

Dựa trên phân tích trên, đây là những điểm cụ thể cần làm tốt hơn:

#### Từ official subagent — giữ nguyên những điểm hay:

- **Agent prompt engineering chất lượng cao** — structured output, handoff guidelines rõ ràng
- **Usage tracking chi tiết** — turns, tokens, cost, context per agent
- **Streaming real-time** với `onUpdate` callback
- **Collapse/expand UI** (Ctrl+O) — rất tiện
- **Abort propagation** — SIGTERM → SIGKILL cascade
- **Security model** — agentScope: user/project/both

#### Từ pi-teams — lấy ý tưởng:

- **Thinking level per agent** — thiết thực, ảnh hưởng chất lượng và tốc độ
- **Quality gate hooks** — chạy test/lint tự động sau task
- **Template save/load** — rất tiện cho team workflow lặp lại
- **Smart model resolution** — tự chọn provider rẻ nhất
- **Plan approval** — essential cho production use

#### Aurora Teams improvements MỚI (cả 2 đều thiếu):

| # | Improvement | Tại sao quan trọng |
|---|-------------|--------------------|
| 1 | **Retry với exponential backoff** | Agent network error/timeout không nên dừng workflow |
| 2 | **Shared Task Board** | Agents tự biết cần làm gì, không cần orchestrator giao từng bước |
| 3 | **Dependency graph** | Task C chờ A và B xong — không hard-code chain |
| 4 | **File-based messaging (Team Bus)** | Agents ghi thẳng vào inbox nhau — không qua main agent |
| 5 | **Persist state** | Nếu crash → resume từ tasks.json |
| 6 | **Dynamic task creation** | Agent có thể tạo subtask mới trong lúc đang chạy |
| 7 | **Context compression** | Thay vì inject raw `{previous}`, compress thành summary |
| 8 | **No tmux required** | Chạy in-process trong Pi, không cần external tool |

#### Vấn đề context explosion cần giải quyết

Đây là vấn đề nghiêm trọng **cả 2 đều gặp** mà chưa ai giải quyết tốt:

```
Official subagent:
  chain step 1 output: 5000 tokens
  -> inject toàn bộ vào task string step 2
  -> scout output 3000 tokens + step 2 task
  -> inject toàn bộ vào task string step 3
  -> CONTEXT: 5000 + 3000 + task = có thể > 10k tokens waste

pi-teams:
  tương tự — relay qua main agent không compress
```

**Aurora Teams solution:** Intermediate compression agent:
```
Step 1 output (5000 tokens)
    |
    v
Compressor (haiku, 200 tokens output):  "Files changed: auth.ts:42-80, utils.ts:10-20"
    |
    v
Step 2 nhận compressed (200 tokens thay vì 5000)
```

---


---

## 1. Tổng quan

### Mục tiêu

Aurora Teams biến Pi thành một **hệ thống multi-agent phối hợp**, trong đó:

- Mỗi agent là một **Pi process độc lập** với context window riêng
- Agents **tương tác 2 chiều** với nhau qua Team Bus
- Tất cả agents chia sẻ **Task Board** — không cần tuần tự cứng nhắc
- Orchestrator **thông minh**: retry, reassign, dependency resolution tự động
- Không phụ thuộc tmux hay công cụ ngoài

### So sánh

| Tính năng | Official subagent | pi-teams | Aurora Teams |
|-----------|:-----------------:|:--------:|:------------:|
| Agents giao tiếp nhau | NO | NO | YES real-time |
| Shared task board | NO | NO | YES |
| Dependency resolution | NO | NO | YES |
| Fault tolerance / retry | NO | NO | YES |
| Dynamic routing | NO | NO | YES |
| Cần tmux | NO | YES | NO |
| Workflow templates | NO | YES | YES |
| Plan approval | NO | YES | YES |
| Thinking level per agent | NO | YES | YES |
| Streaming output | YES | YES | YES |

---

## 2. Kiến trúc

```
+------------------------------------------------------------------+
|                       ORCHESTRATOR                                |
|  - Spawns + monitors agents                                       |
|  - Routes tasks to agents                                         |
|  - Resolves dependencies                                          |
|  - Handles retries & reassignment                                 |
|  - Relays Team Bus messages                                       |
+----+-------------------------------+-----------------------------+
     |                               |
     | spawn                         | read/write shared files
     |                               |
+----v---------------------------------------------------------------+
|                    SHARED FILESYSTEM                               |
|                                                                    |
|  .pi/teams/{team}/                                                |
|    +-- tasks.json        <- Task Board (all agents read this)     |
|    +-- inbox/            <- Team Bus                               |
|    |   +-- scout.json                                              |
|    |   +-- planner.json                                            |
|    |   +-- worker.json                                             |
|    +-- log.jsonl         <- Audit log                             |
+----+--------------------------------------------------------------+
     | pi --mode json (subprocess)
     |
+----v--------------------------------------------------------------+
|  AGENTS (each is an isolated pi process)                          |
|                                                                   |
|  +------------------+  +------------------+  +----------------+  |
|  |     Scout        |  |     Planner      |  |     Worker     |  |
|  |  model: haiku    |  |  model: sonnet   |  |  model: sonnet |  |
|  |  tools: read,    |  |  tools: read,    |  |  tools: all    |  |
|  |  grep, find, ls  |  |  grep, find, ls  |  |                |  |
|  +------------------+  +------------------+  +----------------+  |
+-------------------------------------------------------------------+
```

### Luồng dữ liệu

```
User prompt
    |
    v
Orchestrator phan tich
    |
    +--- Tao tasks -> Task Board
    |
    +--- Spawn agents phu hop
    |
    |    Agent doc task -> lam viec
    |         |
    |         +-- Ghi progress vao task
    |         +-- Gui message qua Team Bus
    |         +-- Mark task done/failed
    |
    +--- Orchestrator nhan update -> resolve deps -> spawn them
    |
    +--- Tong hop ket qua -> tra ve user
```

---

## 3. Data Models

### Task

```typescript
interface Task {
  id: string;                        // "t-001"
  title: string;                     // "Kham pha auth code"
  description: string;               // Chi tiet task
  status: TaskStatus;
  agent?: string;                    // Agent duoc assign
  priority: "low" | "normal" | "high" | "urgent";
  depends_on?: string[];             // IDs cua tasks phai xong truoc
  created_at: number;                // Unix timestamp
  started_at?: number;
  completed_at?: number;
  result?: string;                   // Output cuoi cua agent
  error?: string;                    // Ly do fail neu co
  retry_count: number;               // So lan da retry
  max_retries: number;               // Mac dinh: 2
  require_approval?: boolean;        // Dung hoi user truoc khi execute
  approved?: boolean;                // Da duoc approve chua
  metadata?: Record<string, any>;    // Arbitrary data
}

type TaskStatus =
  | "pending"           // Cho deps
  | "ready"             // Deps xong, cho agent
  | "assigned"          // Da assign agent, chua bat dau
  | "in_progress"       // Dang chay
  | "done"              // Hoan thanh
  | "failed"            // Fail, da retry het
  | "blocked"           // Bi block (dep fail)
  | "waiting_approval"; // Cho user approve
```

### Message — Team Bus

```typescript
interface TeamMessage {
  id: string;
  from: string;          // Agent name hoac "orchestrator" | "user"
  to: string;            // Agent name hoac "orchestrator" | "broadcast"
  type: MessageType;
  content: string;
  task_id?: string;      // Task lien quan
  timestamp: number;
  read: boolean;
}

type MessageType =
  | "info"       // Thong bao thong thuong
  | "request"    // Yeu cau thong tin tu agent khac
  | "response"   // Tra loi request
  | "handoff"    // Chuyen giao task cho agent khac
  | "status"     // Update trang thai
  | "error"      // Bao loi
  | "question";  // Hoi user (approval, clarification)
```

### AgentConfig

```typescript
interface AgentConfig {
  name: string;
  description: string;
  model?: string;          // Mac dinh: dung model cua main Pi
  tools?: string[];        // Mac dinh: tat ca tools
  thinking?: ThinkingLevel;
  max_turns?: number;      // Gioi han turns, tranh loop vo han
  retry_on_fail?: number;  // So lan retry khi fail
  system_prompt: string;   // Noi dung file .md sau frontmatter
  source: "user" | "project";
  file_path: string;
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
```

### WorkflowTemplate

```typescript
interface WorkflowTemplate {
  name: string;
  description: string;
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;                  // "recon", "plan", "implement"
  agent: string;               // Ten agent
  task_template: string;       // Co the dung {goal}, {recon}, {plan}
  depends_on?: string[];       // IDs cua steps truoc
  output_key?: string;         // Key de steps sau reference
  require_approval?: boolean;  // Pause, hoi user truoc khi chay
  on_fail?: "stop" | "skip" | "retry"; // Mac dinh: retry
}
```

### TeamState

```typescript
interface TeamState {
  name: string;
  created_at: number;
  status: "active" | "paused" | "done" | "failed";
  agents: string[];
  tasks: Task[];
  workflow?: WorkflowTemplate;
  variables: Record<string, string>; // Output keys tu moi step
}
```

---

## 4. Team Bus

### Co che

Moi agent co file inbox rieng tai `.pi/teams/{team}/inbox/{agent}.json`.
Day la **mang cac message chua doc**.

```
Orchestrator / Agent A       Filesystem          Agent B
       |                                             |
       |-- write msg ---> inbox/agent-b.json ---> polling
       |                                             |
       |<-- write resp -- inbox/agent-a.json <-- write
```

### API

```typescript
class TeamBus {
  constructor(teamDir: string) {}

  async send(message: Omit<TeamMessage, "id" | "timestamp" | "read">): Promise<string>
  async readInbox(agentName: string): Promise<TeamMessage[]>
  async markRead(agentName: string, messageIds: string[]): Promise<void>
  async broadcast(from: string, content: string, type: MessageType): Promise<void>
  watch(agentName: string, callback: (msg: TeamMessage) => void): () => void
}
```

### Tool inject vao agents

```typescript
// Agent dung tool "team_message":

// Gui message
team_message({ action: "send", to: "planner", content: "Tim thay auth code tai src/auth/*.ts" })

// Doc inbox
team_message({ action: "read_inbox" })
// -> Tra ve danh sach messages chua doc

// Hoi user
team_message({ action: "ask_user", question: "Can approve truoc khi xoa file nay", task_id: "t-003" })
```

### Inject vao agent system prompt

```
## Team Context
Ban la mot thanh vien trong team. Dung tool `team_message` de:
- Gui tin cho dong doi: action="send", to="agent-name"
- Doc hop thu: action="read_inbox"
- Hoi user: action="ask_user"

Hop thu cua ban ({N} tin chua doc):
{INBOX_CONTENT}

Task board hien tai:
{TASK_BOARD_SUMMARY}
```

---

## 5. Task Board

### File `.pi/teams/{team}/tasks.json`

```json
{
  "team": "my-team",
  "updated_at": 1742608800,
  "tasks": [
    {
      "id": "t-001",
      "title": "Kham pha auth code",
      "status": "done",
      "agent": "scout",
      "result": "Auth code nam tai src/auth/, gom 3 files...",
      "depends_on": [],
      "retry_count": 0,
      "max_retries": 2
    },
    {
      "id": "t-002",
      "title": "Len ke hoach refactor",
      "status": "in_progress",
      "agent": "planner",
      "depends_on": ["t-001"],
      "retry_count": 0,
      "max_retries": 2
    },
    {
      "id": "t-003",
      "title": "Implement refactor",
      "status": "pending",
      "depends_on": ["t-002"],
      "require_approval": true,
      "retry_count": 0,
      "max_retries": 2
    }
  ]
}
```

### API

```typescript
class TaskBoard {
  constructor(teamDir: string) {}

  async createTask(task: Omit<Task, "id" | "created_at" | "retry_count">): Promise<Task>
  async updateTask(id: string, updates: Partial<Task>): Promise<Task>
  async getTask(id: string): Promise<Task | null>
  async getAllTasks(): Promise<Task[]>
  async setStatus(id: string, status: TaskStatus, extra?: Partial<Task>): Promise<void>
  async getReadyTasks(): Promise<Task[]>
  async getBlockedTasks(): Promise<Task[]>
  async resolveDependencies(): Promise<string[]>  // Returns newly unblocked IDs

  // Atomic claim (tranh race condition khi nhieu agents chay song song)
  async claimTask(taskId: string, agentName: string): Promise<boolean>
}
```

### Dependency resolution algorithm

```
Moi lan co task doi status -> done:
  1. Tim tat ca tasks co depends_on chua task vua done
  2. Voi moi task do: kiem tra TAT CA deps da done chua
  3. Neu du: set status = "ready"
  4. Orchestrator nhan event -> spawn agent cho task moi
```

---

## 6. Agent Runner

### Spawn `pi` subprocess

```typescript
class AgentRunner {
  async run(options: AgentRunOptions): Promise<AgentResult>
}

interface AgentRunOptions {
  agent: AgentConfig;
  task: Task;
  teamDir: string;
  cwd?: string;
  signal?: AbortSignal;
  inboxMessages?: TeamMessage[];
  taskBoardSummary?: string;
  previousOutputs?: Record<string, string>;
}
```

### Cach spawn

```typescript
const args = [
  "--mode", "json",    // Output JSON events de parse
  "-p",               // Non-interactive
  "--no-session",     // Khong luu session
];

if (agent.model)    args.push("--model", agent.model);
if (agent.tools)    args.push("--tools", agent.tools.join(","));
if (agent.thinking) args.push("--thinking", agent.thinking);

// Append system prompt mo rong (inbox + task board + team context)
args.push("--append-system-prompt", tmpSystemPromptFile);

// Task la user message
args.push(`Task: ${task.description}`);

const proc = spawn("pi", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
```

### Parse streaming output

```typescript
// Pi --mode json emit:
// { type: "message_end", message: {...} }     <- Turn hoan thanh
// { type: "tool_result_end", message: {...} } <- Tool xong

proc.stdout.on("data", (data) => {
  for (const line of data.toString().split("\n")) {
    const event = tryParseJSON(line);
    if (event?.type === "message_end") {
      // Cap nhat usage stats (tokens, cost, context)
      // Emit update cho orchestrator
      onUpdate(currentResult);
    }
  }
});
```

### Fault tolerance

```typescript
async function runWithRetry(options: AgentRunOptions): Promise<AgentResult> {
  let attempt = 0;
  const maxRetries = options.agent.retry_on_fail ?? 2;

  while (attempt <= maxRetries) {
    const result = await runner.run(options);
    if (result.success) return result;

    attempt++;
    if (attempt <= maxRetries) {
      await taskBoard.setStatus(task.id, "assigned", {
        error: `Retry ${attempt}/${maxRetries}: ${result.error}`
      });
      await sleep(1000 * attempt); // Exponential backoff
    }
  }

  await taskBoard.setStatus(task.id, "failed", { error: result.error });
  return result;
}
```

---

## 7. Orchestrator

### Vong lap chinh

```typescript
class Orchestrator {
  async run(goal: string, teamName: string, workflow?: string): Promise<void> {
    // 1. Tao task board tu goal hoac workflow template
    await this.initializeTasks(goal, workflow);

    // 2. Vong lap orchestration
    while (!this.isDone()) {

      // Lay cac tasks san sang va chua assign
      const readyTasks = await this.taskBoard.getReadyTasks();
      const unassigned = readyTasks.filter(t => !this.runningAgents.has(t.id));

      // Spawn agent cho moi task ready
      for (const task of unassigned) {
        const agent = this.selectAgent(task);
        if (agent) await this.assignAndSpawn(task, agent);
      }

      // Xu ly messages tu Team Bus
      await this.processInbox();

      // Resolve dependencies
      const newUnblocked = await this.taskBoard.resolveDependencies();
      if (newUnblocked.length > 0) {
        this.notify(`${newUnblocked.length} tasks moi san sang`);
      }

      // Kiem tra approval-required tasks
      await this.checkApprovals();

      await sleep(500);
    }
  }

  // Chon agent tot nhat cho task
  private selectAgent(task: Task): AgentConfig | null {
    // 1. task.agent chi dinh cu the -> dung do
    // 2. Khong -> chon agent idle phu hop nhat theo description
    // 3. Tat ca busy -> queue (thu lai vong sau)
  }
}
```

### Approval workflow

```typescript
async function checkApprovals() {
  const pending = await taskBoard.getTasksByStatus("waiting_approval");

  for (const task of pending) {
    const plan = task.metadata?.plan ?? task.description;

    // Hien confirm dialog trong Pi UI
    const approved = await ctx.ui.confirm(
      `Approve ke hoach cua ${task.agent}?`,
      `Task: ${task.title}\n\nKe hoach:\n${plan}`
    );

    await taskBoard.setStatus(task.id, approved ? "in_progress" : "failed", {
      approved,
      error: approved ? undefined : "User rejected plan"
    });
  }
}
```

---

## 8. Workflow Engine

### Template format (.md)

```markdown
---
name: implement
description: Scout -> Plan (approve) -> Worker -> Reviewer
---

steps:
  - id: recon
    agent: scout
    task: "Kham pha co de lien quan den: {goal}"
    output_key: recon_result

  - id: plan
    agent: planner
    task: |
      Len ke hoach chi tiet dua tren:
      Goal: {goal}
      Recon: {recon_result}
    output_key: plan_result
    depends_on: [recon]
    require_approval: true

  - id: implement
    agent: worker
    task: "Thuc thi ke hoach: {plan_result}"
    depends_on: [plan]
    on_fail: retry

  - id: review
    agent: reviewer
    task: "Review code vua viet, dua tren ke hoach: {plan_result}"
    depends_on: [implement]
```

### Variable substitution

```typescript
// Khi step "plan" xong, output_key = "plan_result"
// -> teamState.variables["plan_result"] = task.result

// Khi spawn step "implement":
const resolvedTask = step.task_template.replace(
  /\{(\w+)\}/g,
  (_, key) => teamState.variables[key] ?? `{${key} - chua co}`
);
```

### Built-in workflows

| Command | Flow |
|---------|------|
| `/implement {goal}` | scout -> planner (approve) -> worker -> reviewer |
| `/research {topic}` | scout x3 parallel -> reporter tong hop |
| `/review {target}` | scout -> reviewer -> (if fail) worker -> reviewer |
| `/audit {scope}` | security-scout || perf-scout || quality-scout -> reporter |

---

## 9. Extension & UI

### Commands

```
/team new {name}              Tao team moi
/team status                  Xem trang thai team hien tai
/team tasks                   Liet ke task board (overlay)
/team assign {task} {agent}   Assign task thu cong
/team broadcast {message}     Gui message cho tat ca agents
/team pause                   Pause tat ca agents
/team resume                  Resume
/team kill {agent}            Kill agent cu the
/team kill                    Shut down toan bo team

/implement {goal}             Chay workflow implement
/research {topic}             Chay workflow research
/review {target}              Chay workflow review
```

### Info panel integration (trong aurora-ui.ts)

```
=== Aurora ===================================

  [model] anthropic/claude-sonnet   [ctx] 8k/200k 4%   [think] medium

=== Team: my-team ============================

  tasks  v3  ~2  x0  |  scout ~  planner ~  worker o
```

### Task Board overlay (/team tasks)

```
+-- Task Board: my-team ---------------------------+
| v t-001  Kham pha auth code      scout    1.2s  |
| ~ t-002  Len ke hoach            planner   ...  |
| - t-003  Implement (cho approve) worker         |
| o t-004  Review ket qua          reviewer       |
+--------------------------------------------------+
  [a]pprove  [r]eject  [k]ill agent  [q]uit
```

---

## 10. Agent Definitions

### Format file .md

```markdown
---
name: scout
description: Kham pha codebase nhanh, collect context
model: claude-haiku-4-5
tools: read, grep, find, ls, bash
thinking: off
max_turns: 30
retry_on_fail: 2
---

# Scout Agent

Ban la mot agent trinh sat codebase nhanh va chinh xac.

## Nhiem vu
- Tim kiem file, code lien quan den task duoc giao
- Collect thong tin day du, chinh xac
- KHONG sua code, chi doc

## Output format
Tra ve markdown voi:
- Danh sach files lien quan (duong dan day du)
- Tom tat noi dung tung file
- Key insights cho task tiep theo

## Team communication
- Gui progress cho orchestrator moi khi tim thay thong tin quan trong
- Hoi planner neu can clarification ve scope
```

### Agents mac dinh

| File | Role | Model | Tools | Thinking |
|------|------|-------|-------|---------|
| `scout.md` | Trinh sat codebase | haiku | read, grep, find, ls | off |
| `planner.md` | Len ke hoach | sonnet | read, grep, find, ls | medium |
| `worker.md` | Thuc thi | sonnet | all | low |
| `reviewer.md` | Review code | sonnet | read, grep, find, bash | medium |
| `security.md` | Security audit | sonnet | read, grep, find, bash | high |
| `reporter.md` | Tong hop ket qua | haiku | read | off |

---

## 11. File Structure

```
.pi/
+-- agents/                        <- Agent definitions
|   +-- scout.md
|   +-- planner.md
|   +-- worker.md
|   +-- reviewer.md
|   +-- security.md
|   +-- reporter.md
|
+-- teams/                         <- Runtime state
|   +-- {team-name}/
|       +-- state.json             <- Team metadata + variables
|       +-- tasks.json             <- Task Board
|       +-- log.jsonl              <- Audit log (append-only)
|       +-- inbox/
|           +-- orchestrator.json
|           +-- scout.json
|           +-- planner.json
|           +-- worker.json
|
+-- workflows/                     <- Workflow templates
|   +-- implement.md
|   +-- research.md
|   +-- review.md
|   +-- audit.md
|
+-- extensions/
    +-- aurora-teams/
        +-- index.ts               <- Entry point, registers commands
        +-- orchestrator.ts        <- Core orchestration loop
        +-- task-board.ts          <- Task CRUD + dependency resolution
        +-- team-bus.ts            <- Messaging system
        +-- agent-runner.ts        <- Spawn + stream pi subprocess
        +-- workflow.ts            <- Template parsing + variable substitution
        +-- agents.ts              <- Agent discovery + config parsing
        +-- ui.ts                  <- Pi UI integration
```

---

## 12. Roadmap

### Phase 1 — MVP (Core)
**Muc tieu:** Chay duoc 1 agent, co task board

- [ ] `agent-runner.ts`: spawn `pi --mode json`, parse streaming, retry
- [ ] `task-board.ts`: CRUD tasks, status transitions, atomic file ops
- [ ] `agents.ts`: discover + parse agent .md files
- [ ] `index.ts`: extension entry, `/team new`, `/team status`
- [ ] Sample agents: `scout.md`, `worker.md`

**Deliverable:** Go `/team new my-team` -> `/implement "add auth"` -> agent chay, xem output

---

### Phase 2 — Communication
**Muc tieu:** Agents noi chuyen duoc voi nhau

- [ ] `team-bus.ts`: inbox/outbox, file-based messaging
- [ ] Tool `team_message` inject vao agent system prompt
- [ ] Orchestrator relay messages
- [ ] Broadcast support
- [ ] `/team broadcast {message}` command

**Deliverable:** Scout tu dong gui recon ket qua cho planner

---

### Phase 3 — Orchestration
**Muc tieu:** Workflow tu dong, fault tolerant

- [ ] `workflow.ts`: parse templates, variable substitution
- [ ] Dependency resolution algorithm
- [ ] Dynamic routing: idle agent claim task
- [ ] Approval workflow voi Pi UI overlay
- [ ] Built-in workflows: `/implement`, `/research`, `/review`

**Deliverable:** `/implement "them Redis caching"` -> tu chay toan bo scout->plan->approve->code->review

---

### Phase 4 — UX & Observability
**Muc tieu:** Giao dien dep, de theo doi

- [ ] Info panel integration: hien team status tren aurora-ui
- [ ] Task board overlay (`/team tasks`)
- [ ] Audit log viewer
- [ ] Parallel agent progress display
- [ ] `/team kill` voi graceful shutdown
- [ ] Template editor: `/team save-workflow`

**Deliverable:** UX hoan chinh, tuong duong pi-teams nhung khong can tmux

---

## Ghi chu ky thuat

### File locking — tranh race condition

```typescript
// Write-then-rename pattern (atomic tren Linux/macOS)
const tmpFile = `${filePath}.tmp.${process.pid}`;
await fs.writeFile(tmpFile, JSON.stringify(data, null, 2));
await fs.rename(tmpFile, filePath); // Atomic
```

### Pi subprocess — inject context

```typescript
const systemPromptExtra = `
## Team Context
Team: ${teamName}
Your role: ${agent.name}

Inbox (${messages.length} unread):
${formatMessages(messages)}

Task board:
${formatTaskBoard(tasks)}
`;

await fs.writeFile(tmpFile, systemPromptExtra);
args.push("--append-system-prompt", tmpFile);
// Cleanup sau khi agent spawn
```

### Max concurrency

Mac dinh **4 agents concurrent** de tranh rate limit LLM.
Configurable trong `state.json`:

```json
{ "max_concurrency": 4 }
```

### Graceful shutdown

Khi `/team kill`:
1. Gui SIGTERM cho tat ca agent processes
2. Cho 5 giay
3. Neu khong exit -> SIGKILL
4. Cleanup tmp files
5. Luu final state vao `state.json`
