# 🔄 Agent Harness — Full Flow Diagram

> Luồng hoạt động từ khi user đưa yêu cầu → đến khi có kết quả cuối cùng.

---

## Tổng Quan — Full Pipeline

```text
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                      ║
║   USER: "Implement OAuth login for Google"                                           ║
║                                                                                      ║
╚═══════════════════════════════╤══════════════════════════════════════════════════════╝
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ① PI RUNTIME — Session Start                                                         │
│                                                                                       │
│   .pi/settings.json → load extensions:                                                │
│     ├── harness-state      → hook: session_start fires                                │
│     ├── harness-subagent   → registers: subagent tool                                 │
│     ├── harness-verify     → hook: tool_call, tool_result                             │
│     └── harness-quality    → registers: harness_quality tool                          │
│                                                                                       │
│   session_start hook:                                                                 │
│     $ bd prime --json                                                                 │
│     → inject task context vào LLM prompt:                                             │
│       "Ready: bd-a3f8.1 [P1] Login UI                                                │
│        Blocked: bd-a3f8.2 (by bd-a3f8.1)                                             │
│        Stats: 3 open, 1 in_progress, 12 closed"                                      │
│                                                                                       │
└───────────────────────────────┬───────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ② LLM (ORCHESTRATOR) — Nhận prompt + context                                         │
│                                                                                       │
│   System prompt chứa:                                                                 │
│     • AGENTS.md (~60 dòng bản đồ)                                                    │
│     • Available tools: read, bash, edit, write, subagent, harness_prime, harness_task  │
│     • Beads context từ session_start hook                                             │
│     • User message: "Implement OAuth login for Google"                                │
│                                                                                       │
│   LLM suy nghĩ:                                                                      │
│     "Task bd-a3f8.1 (Login UI) is ready.                                             │
│      Tôi sẽ dùng subagent chain: scout → planner → worker.                           │
│      TaskId = bd-a3f8.1"                                                              │
│                                                                                       │
│   LLM output (JSON):                                                                  │
│     {                                                                                 │
│       "type": "tool_use",                                                             │
│       "name": "subagent",                                                             │
│       "input": {                                                                      │
│         "taskId": "bd-a3f8.1",                                                        │
│         "chain": [                                                                    │
│           { "agent": "scout", "task": "Find auth code for OAuth" },                   │
│           { "agent": "planner", "task": "Plan OAuth implementation" },                │
│           { "agent": "worker", "task": "Execute plan" }                               │
│         ]                                                                             │
│       }                                                                               │
│     }                                                                                 │
│                                                                                       │
└───────────────────────────────┬───────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ③ PI RUNTIME — Parse tool_use, fire events                                            │
│                                                                                       │
│   3a. tool_call event fires (harness-verify hook):                                    │
│       → tool = "subagent" → not blocked → proceed                                    │
│                                                                                       │
│   3b. harness-subagent extension executes:                                            │
│       → Resolve taskId: $ bd show bd-a3f8.1 --json                                   │
│       → Task context = { title, description, deps, status }                          │
│                                                                                       │
└───────────────────────────────┬───────────────────────────────────────────────────────┘
                                │
          ┌─────────────────────┼────────────────────────┐
          │                     │                        │
          ▼                     ▼                        ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐
│ ④ SCOUT          │ │ ⑤ PLANNER        │ │ ⑥ WORKER                 │
│ (chain step 1)   │ │ (chain step 2)   │ │ (chain step 3)           │
│                  │ │                  │ │                          │
│ Sequential:      │ │ Sequential:      │ │ Sequential:              │
│ Runs FIRST       │ │ Runs SECOND      │ │ Runs LAST                │
│                  │ │                  │ │                          │
│ Output compressed│→│ Output compressed│→│ Full execution           │
│ → input for ⑤   │ │ → input for ⑥   │ │ → final result           │
└──────────────────┘ └──────────────────┘ └──────────────────────────┘
```

---

## Chi Tiết Từng Step

### ④ SCOUT — Trinh Sát (Chain Step 1)

```text
harness-subagent extension:
  Load harness/agents/scout.md → parse frontmatter
          │
          ▼
  Spawn child process:
    $ pi --mode json \
         --model claude-haiku-4-5 \
         --tools read,grep,find,ls,bash \
         --thinking off \
         --max-turns 40 \
         --no-session
          │
          ▼
  Pipe vào stdin:
    "Task: bd-a3f8.1 — Login UI [P1]
     Description: Design and implement login UI with OAuth
     Parent: bd-a3f8 (Auth System)
     
     Find auth code for OAuth implementation"
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SCOUT LLM (Haiku) — isolated context window                        │
│                                                                     │
│   Turn 1: grep("oauth|auth|login", "src/")                        │
│           → found: src/auth/, src/components/Login.tsx              │
│                                                                     │
│   Turn 2: read("src/auth/index.ts")                                │
│           → AuthService class, validateToken(), login()             │
│                                                                     │
│   Turn 3: read("src/auth/types.ts")                                │
│           → AuthProvider, UserSession, TokenPayload interfaces      │
│                                                                     │
│   Turn 4: find("*.config.*", "src/")                               │
│           → src/config/auth.config.ts                               │
│                                                                     │
│   Turn 5: read("src/config/auth.config.ts", offset=1, limit=30)   │
│           → AUTH_PROVIDERS, OAUTH_SCOPES config                     │
│                                                                     │
│   Turn 6: Final response:                                           │
│     "### Task Context                                               │
│      bd-a3f8.1: Login UI [P1] — OAuth implementation               │
│                                                                     │
│      ### Files Khám Phá                                             │
│      - src/auth/index.ts:15-80 — AuthService class                 │
│      - src/auth/types.ts:1-45 — Auth interfaces                    │
│      - src/config/auth.config.ts:1-30 — OAuth config               │
│      - src/components/Login.tsx:1-60 — Current login UI             │
│                                                                     │
│      ### Code Quan Trọng                                            │
│      interface AuthProvider { name: string; clientId: string; }     │
│      class AuthService { async login(provider: AuthProvider) {...} }│
│                                                                     │
│      ### Kiến Trúc                                                  │
│      Auth flow: Login.tsx → AuthService.login() → config lookup     │
│                                                                     │
│      ### Rủi Ro                                                     │
│      - AuthService.login() chưa handle OAuth callback flow          │
│      - Thiếu refresh token management"                              │
│                                                                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
                        ┌─────────────────┐
                        │ COMPRESS RESULT  │
                        │                 │
                        │ SubagentResult: │
                        │  agent: "scout" │
                        │  summary: 5 dòng│
                        │  citations: [4] │
                        │  turns: 6       │
                        │  cost: $0.008   │
                        └────────┬────────┘
                                 │
                                 ▼ (compressed output → planner input)
```

### ⑤ PLANNER — Lập Kế Hoạch (Chain Step 2)

```text
  Spawn: pi --mode json --model claude-sonnet-4-5 --tools read,grep,find,ls
          │
          ▼
  Pipe vào stdin:
    "Task: bd-a3f8.1 — Login UI [P1]
     
     Scout findings:
       [compressed scout summary + citations]
     
     Create implementation plan for OAuth"
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PLANNER LLM (Sonnet) — isolated context window                     │
│                                                                     │
│   Turn 1: read("src/auth/index.ts", offset=15, limit=65)          │
│           → Đọc thêm AuthService để hiểu cấu trúc                 │
│                                                                     │
│   Turn 2: read("package.json")                                     │
│           → Check existing OAuth libraries                          │
│                                                                     │
│   Turn 3: Final plan:                                               │
│     "### Mục Tiêu                                                   │
│      Add Google OAuth login flow to AuthService                     │
│                                                                     │
│      ### Kế Hoạch Thực Hiện                                        │
│      1. Install: npm install google-auth-library                    │
│      2. Add GoogleOAuth provider in src/config/auth.config.ts       │
│      3. Add handleOAuthCallback() to AuthService                    │
│      4. Create src/auth/google-oauth.ts — OAuth flow logic          │
│      5. Update Login.tsx — add Google login button                   │
│      6. Add src/auth/__tests__/google-oauth.test.ts                 │
│                                                                     │
│      ### Files Cần Sửa                                              │
│      - src/config/auth.config.ts — add Google provider config       │
│      - src/auth/index.ts — add handleOAuthCallback method           │
│      - src/components/Login.tsx — add Google button                  │
│                                                                     │
│      ### Files Mới                                                  │
│      - src/auth/google-oauth.ts — OAuth flow                        │
│      - src/auth/__tests__/google-oauth.test.ts                      │
│                                                                     │
│      ### Test Plan                                                  │
│      - Unit test: mock Google API, verify token exchange             │
│      - Integration: verify callback URL handling                    │
│                                                                     │
│      ### Rủi Ro                                                     │
│      - Callback URL config cần match Google Console setup"           │
│                                                                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
                        ┌─────────────────┐
                        │ COMPRESS RESULT  │
                        │  agent: "planner"│
                        │  summary: 8 dòng │
                        │  turns: 3        │
                        │  cost: $0.025    │
                        └────────┬────────┘
                                 │
                                 ▼ (compressed plan → worker input)
```

### ⑥ WORKER — Thực Thi (Chain Step 3)

```text
  Spawn: pi --mode json --model claude-sonnet-4-5 --tools read,bash,edit,write,...
          │
          ▼
  Pipe vào stdin:
    "Task: bd-a3f8.1 — Login UI [P1]
     
     Plan:
       [compressed planner output — 6 steps]
     
     Execute the plan. Remember:
     1. bd update bd-a3f8.1 --claim
     2. Implement all steps
     3. Verify (typecheck, lint, test)
     4. git commit
     5. bd close bd-a3f8.1"
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ WORKER LLM (Sonnet) — isolated context window                      │
│                                                                     │
│   Turn 1: bash("bd update bd-a3f8.1 --claim")                     │
│           → ✓ Claimed task                                          │
│                                                                     │
│   Turn 2: bash("npm install google-auth-library")                  │
│           → ✓ Installed                                             │
│                                                                     │
│   Turn 3: edit("src/config/auth.config.ts", ...)                   │
│           tool_result hook → tsc --noEmit → ✓ clean                │
│           → ✓ Added Google provider config                          │
│                                                                     │
│   Turn 4: write("src/auth/google-oauth.ts", content)               │
│           tool_result hook → tsc --noEmit → ✓ clean                │
│           → ✓ Created OAuth flow module                             │
│                                                                     │
│   Turn 5: edit("src/auth/index.ts", ...)                           │
│           tool_result hook → tsc --noEmit                           │
│           → ⚠️ ERROR: Property 'callback' missing in type          │
│           ┌─────────────────────────────────────────┐               │
│           │   BACK-PRESSURE LOOP                    │               │
│           │                                         │               │
│           │   Turn 6: edit("src/auth/index.ts", fix)│               │
│           │           → tsc --noEmit → ✓ clean      │               │
│           └─────────────────────────────────────────┘               │
│                                                                     │
│   Turn 7: edit("src/components/Login.tsx", ...)                    │
│           → ✓ Added Google login button                             │
│                                                                     │
│   Turn 8: write("src/auth/__tests__/google-oauth.test.ts", ...)    │
│           → ✓ Created tests                                         │
│                                                                     │
│   Turn 9: bash("npm test -- --related src/auth/google-oauth.ts")   │
│           → ✓ 5/5 tests pass (output swallowed — success silent)   │
│                                                                     │
│   Turn 10: bash("git add . && git commit -m 'feat: add Google OAuth│
│             login flow (bd-a3f8.1)'")                               │
│           → ✓ Committed                                             │
│                                                                     │
│   Turn 11: bash("bd close bd-a3f8.1 --reason 'Implemented Google   │
│             OAuth login with callback handling and tests'")         │
│           → ✓ Task closed                                           │
│                                                                     │
│   Final: "Implemented Google OAuth login. 6 files modified/created. │
│           All tests pass. Committed and task closed."               │
│                                                                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
                        ┌─────────────────┐
                        │ COMPRESS RESULT  │
                        │  agent: "worker" │
                        │  summary: 5 dòng │
                        │  turns: 11       │
                        │  cost: $0.085    │
                        └────────┬────────┘
                                 │
                                 ▼
```

### Trở Về Orchestrator

```text
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ⑦ PI RUNTIME — tool_result event fires                                                │
│                                                                                       │
│   harness-subagent extension returns SubagentResult to Pi runtime:                    │
│     {                                                                                 │
│       content: [{                                                                     │
│         type: "text",                                                                 │
│         text: "Chain completed (3 steps):\n                                           │
│           1. scout: Found auth code in 4 files\n                                      │
│           2. planner: 6-step plan created\n                                           │
│           3. worker: Implemented, tested, committed, task closed"                     │
│       }],                                                                             │
│       details: {                                                                      │
│         chain: [scoutResult, plannerResult, workerResult],                            │
│         totalCost: 0.118,                                                             │
│         taskId: "bd-a3f8.1",                                                          │
│         taskStatus: "closed"                                                          │
│       }                                                                               │
│     }                                                                                 │
│                                                                                       │
│   TUI hiện:                                                                           │
│     🤖 subagent [bd-a3f8.1] scout → planner → worker                                │
│     ✓ Chain completed (3 steps, 20 turns, $0.118)                                    │
│       📎 src/auth/google-oauth.ts (new)                                               │
│       📎 src/config/auth.config.ts (modified)                                         │
│       📎 src/auth/index.ts (modified)                                                 │
│                                                                                       │
└───────────────────────────────┬───────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ⑧ LLM (ORCHESTRATOR) — Nhận chain result                                             │
│                                                                                       │
│   Context bây giờ chỉ chứa:                                                          │
│     [user prompt: ~20 tokens]                                                         │
│     [beads context: ~200 tokens]                                                      │
│     [chain result summary: ~300 tokens]   ← compressed, không phải 55k+ noise       │
│     = ~520 tokens total → CLEAN CONTEXT                                               │
│                                                                                       │
│   LLM response:                                                                       │
│     "Done! Implemented Google OAuth login:                                            │
│      • Created OAuth flow module (src/auth/google-oauth.ts)                           │
│      • Added Google provider config                                                   │
│      • Updated Login component with Google button                                     │
│      • 5 tests passing                                                                │
│      • Committed: feat: add Google OAuth login flow                                   │
│      • Task bd-a3f8.1 closed ✓                                                       │
│                                                                                       │
│      bd-a3f8.2 (Backend validation) is now unblocked and ready."                     │
│                                                                                       │
└───────────────────────────────┬───────────────────────────────────────────────────────┘
                                │
                                ▼
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                      ║
║   USER sees:                                                                         ║
║     ✓ Implementation complete                                                        ║
║     ✓ Tests pass                                                                     ║
║     ✓ Committed to git                                                               ║
║     ✓ Beads task closed                                                              ║
║     ✓ Next task unblocked                                                            ║
║                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

---

## Back-Pressure Loop — Chi Tiết

```text
Worker: edit("src/auth/index.ts", oldString, newString)
         │
         ▼
Pi Runtime: execute edit tool
         │
         ▼
tool_result event fires
         │
         ▼
harness-verify hook:
  ┌──────────────────────────────────────────────────────────┐
  │  $ tsc --noEmit                                          │
  │                                                          │
  │  EXIT CODE 0? ──YES──→ Return NOTHING (swallow success) │
  │       │                                                  │
  │      NO                                                  │
  │       │                                                  │
  │       ▼                                                  │
  │  Append errors to tool_result:                           │
  │    return {                                              │
  │      content: [                                          │
  │        ...originalContent,                               │
  │        { type: "text", text:                             │
  │          "⚠️ TypeScript errors:\n" +                     │
  │          "src/auth/index.ts:42 - Property 'callback'\n"+ │
  │          "  missing in type 'AuthService'"               │
  │        }                                                 │
  │      ]                                                   │
  │    };                                                    │
  └──────────────────────────────┬───────────────────────────┘
                                 │
                                 ▼
         Worker LLM sees error in tool result
                                 │
                                 ▼
         Worker decides: edit("src/auth/index.ts", fix...)
                                 │
                                 ▼
         tool_result → tsc --noEmit → ✓ clean now
                                 │
                                 ▼
         Continue to next step...
```

---

## Context Window Comparison

```text
WITHOUT Harness (one big session):

┌────────────────────────────────────────────────────────────────────┐
│ LLM Context Window                                                 │
│                                                                    │
│  [system prompt]                                    ~2,000 tokens  │
│  [user: "implement OAuth"]                             ~20 tokens  │
│  [assistant: "let me explore..."]                     ~100 tokens  │
│  [tool: grep → 500 lines output]                    ~5,000 tokens  │
│  [tool: read auth.ts]                               ~3,000 tokens  │
│  [tool: read types.ts]                              ~2,000 tokens  │
│  [tool: read config.ts]                             ~1,500 tokens  │
│  [assistant: "now let me plan..."]                    ~800 tokens  │
│  [assistant: "implementing..."]                       ~500 tokens  │
│  [tool: edit auth.ts]                               ~1,000 tokens  │
│  [tool: edit → tsc error output]                    ~2,000 tokens  │
│  [tool: edit fix]                                     ~800 tokens  │
│  [tool: write google-oauth.ts]                      ~2,500 tokens  │
│  [tool: edit Login.tsx]                             ~1,500 tokens  │
│  [tool: write tests]                                ~3,000 tokens  │
│  [tool: npm test → 4000 lines output!!!]           ~15,000 tokens  │ ← BLOAT
│  [tool: git commit]                                   ~200 tokens  │
│  ... CONTEXT ROT ZONE ...                                          │
│                                                                    │
│  Total: ~37,920 tokens ← model performance DEGRADING              │
└────────────────────────────────────────────────────────────────────┘


WITH Harness (sub-agent isolation):

┌────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR Context Window                                        │
│                                                                    │
│  [system prompt + beads context]                    ~2,200 tokens  │
│  [user: "implement OAuth"]                             ~20 tokens  │
│  [tool_use: subagent chain]                            ~80 tokens  │
│  [tool_result: compressed chain result]               ~300 tokens  │
│  [assistant: "Done! Here's what was done..."]         ~200 tokens  │
│                                                                    │
│  Total: ~2,800 tokens ← CLEAN, model at peak performance          │
└────────────────────────────────────────────────────────────────────┘

│ Scout window:  ~8,000 tokens (isolated, discarded after)           │
│ Planner window: ~5,000 tokens (isolated, discarded after)          │
│ Worker window: ~15,000 tokens (isolated, discarded after)          │
│                                                                    │
│ Noise trapped in sub-agents. Only essence returns.                 │
```

---

## Beads State Changes During Flow

```text
BEFORE:

  bd-a3f8:   Auth System [epic] [P1]     ── open
  bd-a3f8.1: Login UI [P1]               ── open, READY ✓
  bd-a3f8.2: Backend validation [P1]     ── open, blocked by .1
  bd-a3f8.3: Integration tests [P1]      ── open, blocked by .2

DURING (worker claims):

  bd-a3f8.1: Login UI [P1]               ── in_progress, assigned: worker

AFTER (worker closes):

  bd-a3f8.1: Login UI [P1]               ── CLOSED ✓
  bd-a3f8.2: Backend validation [P1]     ── open, READY ✓ (unblocked!)
  bd-a3f8.3: Integration tests [P1]      ── open, blocked by .2

Next session: worker picks bd-a3f8.2 → repeat cycle
```

---

## Timing & Cost Breakdown (Ước Tính)

```text
Step               Agent     Model      Turns   Time      Cost
─────────────────────────────────────────────────────────────────
① Session start    —         —          —       ~1s       $0.000
② Orchestrator     —         Opus/Main  1       ~3s       $0.010
③ Event handling   —         —          —       ~0.5s     $0.000
④ Scout            Haiku     Haiku      6       ~15s      $0.008
  └ compress       —         —          —       ~0.1s     $0.000
⑤ Planner          Sonnet    Sonnet     3       ~20s      $0.025
  └ compress       —         —          —       ~0.1s     $0.000
⑥ Worker           Sonnet    Sonnet     11      ~90s      $0.085
  └ back-pressure  —         —          2       ~5s       $0.000
  └ git commit     —         —          —       ~2s       $0.000
  └ bd close       —         —          —       ~1s       $0.000
⑦ Result return    —         —          —       ~0.1s     $0.000
⑧ Final response   —         Opus/Main  1       ~3s       $0.005
─────────────────────────────────────────────────────────────────
TOTAL                                   22      ~140s     $0.133
```

---

## Compact Flow Summary

```text
User request
    │
    ▼
Pi session_start → bd prime inject
    │
    ▼
Orchestrator LLM → decides chain + taskId
    │
    ▼
subagent tool execute:
    │
    ├─④ Scout (Haiku) ──compress──→ findings
    │                                  │
    ├─⑤ Planner (Sonnet) ←───────────┘
    │        │──compress──→ plan
    │                         │
    └─⑥ Worker (Sonnet) ←───┘
              │
              ├── bd claim
              ├── implement (edit, write)
              │     └── back-pressure: tsc → lint
              │           └── fix loop if errors
              ├── test (swallow success)
              ├── git commit
              └── bd close
                    │
                    ▼
              Compressed result → Orchestrator
                    │
                    ▼
              Orchestrator final response → User
                    │
                    ▼
              ✅ Done. Next task unblocked.
```
