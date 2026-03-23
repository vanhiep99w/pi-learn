# Aurora Teams — Luồng Hoạt Động Chi Tiết

## Tổng quan: Ai làm gì?

```
User Pi session (main process)
    │
    ├─ [Extension] index.ts        ← Nhận lệnh, điều phối
    ├─ [Orchestrator] orchestrator.ts  ← Vòng lặp chính, phân task
    ├─ [Task Board] task-board.ts  ← Shared state (tasks.json)
    ├─ [Team Bus] team-bus.ts      ← Tin nhắn giữa agents (inbox/*.json)
    └─ [Agent Runner] agent-runner.ts
            │
            ├─ spawn: pi --mode json  ← subprocess agent 1
            ├─ spawn: pi --mode json  ← subprocess agent 2
            └─ spawn: pi --mode json  ← subprocess agent 3
```

---

## Luồng 1: `/team implement "Thêm unit tests"`

### Bước 1 — User gõ lệnh

```
User: /team implement "Thêm unit tests"
         │
         ▼
index.ts: handler("implement Thêm unit tests", ctx)
```

**index.ts** làm gì:
1. Tạo tên team ngẫu nhiên: `impl-mn1750l9`
2. Tạo thư mục: `.pi/teams/impl-mn1750l9/`
3. Khởi tạo `Orchestrator` + gọi `orch.init()`
4. Tạo 3 tasks trên Task Board với dependency chain:

```
Task A: "Khám phá codebase"  [scout]   status=ready
Task B: "Lên kế hoạch"       [planner] status=pending  depends_on=[A]
Task C: "Implement"          [worker]  status=pending  depends_on=[B]
```

5. Gọi `orch.run()` — fire-and-forget (không block Pi)
6. Trả về message cho user ngay lập tức

---

### Bước 2 — Orchestration Loop (chạy mỗi 800ms)

```
orchestrator.ts: run()
    │
    └─ while (!stopped):
           │
           ├─ tick()  ←── chạy mỗi 800ms
           │     │
           │     ├─ 1. resolveDependencies()
           │     │       Đọc tasks.json
           │     │       Task B: deps=[A] → A chưa done → B vẫn pending
           │     │       Task C: deps=[B] → B chưa done → C vẫn pending
           │     │
           │     ├─ 2. getPendingApproval()
           │     │       Tìm tasks status=waiting_approval
           │     │       Hỏi user qua ctx.ui.confirm()
           │     │
           │     └─ 3. getReadyTasks() → [Task A]
           │             selectAgent(Task A) → scout agent config
           │             spawnAgent(Task A, scout)  ←── không await!
           │
           └─ sleep(800ms) → lặp lại
```

---

### Bước 3 — Spawn Agent (Task A: scout)

```
orchestrator.ts: spawnAgent(taskA, scoutConfig)
    │
    ├─ Ghi vào running map: { taskId: A, agent: "scout" }
    │
    └─ async IIFE (chạy song song với vòng loop):
            │
            ├─ board.updateTask(A, { status: "in_progress" })
            │       → ghi tasks.json  [ATOMIC WRITE]
            │
            ├─ bus.readInbox("scout")
            │       → đọc .pi/teams/impl-xxx/inbox/scout.json
            │       → (lần đầu: rỗng)
            │
            ├─ board.getSummary()
            │       → "○2 pending  ⏳1 running"
            │
            └─ runAgentWithRetry({ agent: scoutConfig, task: A, ... })
```

---

### Bước 4 — Chạy Pi subprocess (agent-runner.ts)

```
agent-runner.ts: runAgentWithRetry()
    │
    ├─ Lần 1 (attempt=0):
    │       runAgent({ agent, task, inbox, taskSummary })
    │           │
    │           ├─ Build system prompt injection:
    │           │   ## Thông Tin Team
    │           │   Vai trò: scout — Fast recon...
    │           │   Task: Khám phá codebase
    │           │   Trạng thái: ○2 pending  ⏳1 running
    │           │   [từ file .pi/agents/scout.md]
    │           │
    │           ├─ Ghi vào tmp file: /tmp/aurora-scout-xxx/prompt.md
    │           │
    │           └─ spawn():
    │               pi --mode json -p --no-session
    │                  --model claude-haiku-4-5
    │                  --tools read,grep,find,ls,bash
    │                  --thinking off
    │                  --append-system-prompt /tmp/aurora-scout-xxx/prompt.md
    │                  "Khám phá toàn diện codebase..."
    │
    ├─ Parse stdout dạng JSON streaming:
    │   { type: "message_end", message: { role: "assistant", ... } }
    │   { type: "tool_result_end", ... }
    │       → mỗi event: accumulate usage stats + gọi onUpdate()
    │
    └─ Nếu fail → exponential backoff (1s, 2s, 4s) → retry tối đa N lần
```

---

### Bước 5 — Scout xong, unlock Task B

```
[Scout subprocess kết thúc]
    │
agent-runner.ts trả về:
    {
      success: true,
      output: "## Files Khám Phá\n- src/auth.ts...",
      usage: { turns: 3, input: 12000, cost: 0.002 },
      model: "claude-haiku-4-5"
    }
    │
orchestrator.ts:
    ├─ board.setStatus(A, "done", { result: output })
    │       → ghi tasks.json  [ATOMIC WRITE]
    │       Task A: status=done ✓
    │
    ├─ bus.send({ from:"scout", to:"orchestrator", type:"status" })
    │       → ghi .pi/teams/.../inbox/orchestrator.json
    │
    └─ running.delete(A)

[800ms sau, tick() chạy lại]:
    │
    resolveDependencies():
        Task B: deps=[A] → A.status=done ✓ → B.status = "ready" 🔓
        Task C: deps=[B] → B.status=ready (chưa done) → C vẫn pending
    │
    getReadyTasks() → [Task B]
    spawnAgent(Task B, planner)  ← spawn planner subprocess
```

---

### Bước 6 — Planner + Approval Flow

```
[Planner subprocess chạy]
    │
    ├─ Planner nhận context injection:
    │   - System prompt từ .pi/agents/planner.md
    │   - Task summary: ✓1 done ⏳1 running ○1 pending
    │   - (inbox: rỗng lần đầu)
    │
    ├─ Planner output: kế hoạch implementation chi tiết
    │
    └─ Kết quả trả về orchestrator

orchestrator.ts:
    ├─ task B có require_approval=true
    │
    ├─ board.setStatus(B, "waiting_approval", { result: output })
    │       ← thay vì "done" ngay
    │
    └─ [tick() tiếp theo]:
            getPendingApproval() → [Task B]
            └─ ctx.ui.confirm("Approve kế hoạch?", plan_preview)
                    │
                    User bấm Y/N
                    │
                    ├─ Y: board.setStatus(B, "done")
                    │       → Task C unlock → spawn worker
                    │
                    └─ N: board.setStatus(B, "failed")
                            → Task C: status=blocked (dep failed)
```

---

### Bước 7 — Worker thực thi

```
[Worker subprocess chạy]
    │
    ├─ Worker nhận context injection:
    │   - System prompt từ .pi/agents/worker.md
    │   - Task summary: ✓2 done ⏳1 running
    │   - Kết quả từ planner (result của Task B)
    │
    ├─ Worker viết code, chạy test...
    │
    └─ Worker output: danh sách files đã thay đổi

orchestrator.ts:
    └─ board.setStatus(C, "done", { result: output })
            → ALL TASKS DONE ✓
```

---

## Luồng 2: File System Layout khi chạy

```
.pi/teams/impl-mn1750l9/
├── tasks.json              ← Task Board (atomic writes)
│   {
│     "team": "impl-mn1750l9",
│     "updated_at": 1742606400000,
│     "tasks": [
│       {
│         "id": "t-mn1750lb-1",
│         "title": "Khám phá codebase",
│         "status": "done",
│         "agent": "scout",
│         "depends_on": [],
│         "result": "## Files Khám Phá\n...",
│         "started_at": 1742606400000,
│         "completed_at": 1742606460000
│       },
│       ...
│     ]
│   }
│
├── aurora.log              ← Logs của orchestrator
│   [10:30:12] Aurora Teams ready — 4 agents
│   [10:30:13] ▸ scout → "Khám phá codebase"
│   [10:31:01] ✓ scout done [$0.002]
│   [10:31:01] ▸ planner → "Lên kế hoạch"
│
└── inbox/
    ├── scout.json          ← Inbox của scout agent
    ├── planner.json        ← Inbox của planner agent
    ├── worker.json         ← Inbox của worker agent
    └── orchestrator.json   ← Inbox của orchestrator (nhận status updates)
```

---

## Luồng 3: Atomic Write — Tránh Race Condition

**Vấn đề:** Nhiều agents ghi vào `tasks.json` cùng lúc → corrupt data

**Giải pháp write-then-rename:**
```
writeAtomic("tasks.json", data):
    1. Ghi vào: tasks.json.tmp.42225.1742606400000.7  ← unique name
    2. Khi xong: rename tmp → tasks.json  ← atomic trên Linux
                                            (không thể thấy file nửa chừng)
```

**Tại sao unique suffix:**
```
tasks.json.tmp.{PID}.{timestamp}.{sequence}
                42225   1742606400    7

Nếu 2 writes xảy ra đồng thời:
  Write 1: .tmp.42225.1742606400.7   → rename OK
  Write 2: .tmp.42225.1742606400.8   → rename OK  ← khác tên, không đụng nhau
```

---

## Luồng 4: Retry với Exponential Backoff

```
runAgentWithRetry({ agent, task, maxRetries=2 }):

Attempt 0: runAgent() → fail (network timeout)
    │
    wait 1s (2^0 * 1000ms)
    │
Attempt 1: runAgent() → fail (model overloaded)
    │
    wait 2s (2^1 * 1000ms)
    │
Attempt 2: runAgent() → success ✓

Nếu attempt 2 vẫn fail:
    → return { success: false, error: "Failed after 3 attempts" }
    → orchestrator: board.setStatus(task, "failed")
    → tasks phụ thuộc: status = "blocked"
```

---

## Tóm tắt: Điểm khác biệt của Aurora Teams

| Vấn đề | Official subagent | pi-teams | Aurora Teams |
|--------|------------------|----------|--------------|
| Agent communication | Không có | Relay qua main | Direct inbox files |
| Shared state | Không có | Không có | tasks.json |
| Dependency | Chain cứng | Không có | resolveDependencies() |
| Retry | Không có | Không có | Exponential backoff |
| Approval | Không có | Có (tmux) | ctx.ui.confirm() |
| Context | Raw inject | Relay | Compressed + structured |
| Terminal dep | Không | tmux/zellij | Không cần |
| Persist qua crash | Không | Không | tasks.json trên disk |
