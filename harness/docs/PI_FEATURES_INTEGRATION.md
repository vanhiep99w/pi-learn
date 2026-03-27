# 🔌 Pi Features × Agent Harness — Full Integration Map

> Map tất cả capabilities của Pi vào hệ thống Agent Harness.
> Mục tiêu: tận dụng tối đa Pi, không reinvent the wheel.

---

## Mục Lục

- [1. Extensions — Core Infrastructure](#1-extensions--core-infrastructure)
- [2. Tools — LLM Tự Gọi](#2-tools--llm-tự-gọi)
- [3. Commands — User Slash Commands](#3-commands--user-slash-commands)
- [4. Hooks/Events — Lifecycle Tự Động](#4-hooksevents--lifecycle-tự-động)
- [5. Prompt Templates — Workflow Triggers](#5-prompt-templates--workflow-triggers)
- [6. Skills — Progressive Disclosure](#6-skills--progressive-disclosure)
- [7. Sub-agents — Agent Definitions](#7-sub-agents--agent-definitions)
- [8. Custom TUI Rendering](#8-custom-tui-rendering)
- [9. Flags — CLI Options](#9-flags--cli-options)
- [10. Settings — Configuration](#10-settings--configuration)
- [11. Beads MCP Server](#11-beads-mcp-server)
- [12. External Integrations](#12-external-integrations)
- [Priority Matrix](#priority-matrix)

---

## Tổng Quan — 12 Pi Capabilities

| # | Pi Feature | Dùng Trong Harness | Priority |
|---|-----------|-------------------|----------|
| 1 | **Extensions** | 4 harness extensions core | 🔴 Must |
| 2 | **Tools** (`registerTool`) | `subagent`, `harness_prime`, `harness_task`, `harness_quality` | 🔴 Must |
| 3 | **Commands** (`registerCommand`) | `/tasks`, `/ready`, `/claim`, `/close`, `/status`, `/tree`... | 🟡 Should |
| 4 | **Hooks/Events** (`pi.on`) | `session_start`, `tool_call`, `tool_result`, `session_shutdown` | 🔴 Must |
| 5 | **Prompt Templates** | `/implement`, `/triage`, `/review-fix`, `/scout-plan`... | 🟡 Should |
| 6 | **Skills** (`SKILL.md`) | harness-guide, beads-workflow — LLM auto-discovers | 🟢 Nice |
| 7 | **Sub-agents** | scout, planner, worker, reviewer (+proofreader) | 🔴 Must |
| 8 | **Custom TUI** (`renderCall`/`renderResult`) | Subagent progress, task dashboard | 🟢 Nice |
| 9 | **Flags** (`registerFlag`) | `--harness`, `--harness-verify`, `--harness-model` | 🟢 Nice |
| 10 | **Settings** (`.pi/settings.json`) | Extension paths, agent config | 🟡 Should |
| 11 | **Beads MCP Server** | Alternative to bash calls cho `bd` | 🟢 Optional |
| 12 | **External Tools** | GitNexus, Beads Village | 🟢 Nice |

---

## 1. Extensions — Core Infrastructure

> 📖 Ref: [PI_EXTENSIONS_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/docs/PI_EXTENSIONS_GUIDE.md) — Cách viết extensions
> 📖 Ref: [PI_TOOLS_GUIDE.md §5](file:///home/hieptran/Desktop/pi-learn/docs/PI_TOOLS_GUIDE.md) — Custom Tools API

4 extensions tạo nên harness:

```text
harness/extensions/
├── harness-state/       ← Beads context injection + session hooks
├── harness-subagent/    ← Subagent tool (core orchestration)
├── harness-verify/      ← Back-pressure hooks (typecheck, lint, test)
└── harness-quality/     ← Quality scoring + entropy management
```

**Có thể thêm:**

| Extension | Lý Do |
|-----------|-------|
| `harness-dashboard/` | Custom TUI component hiện task status |
| `harness-notify/` | Notification khi pipeline hoàn thành |

**Key API dùng:** `pi.registerTool()`, `pi.registerCommand()`, `pi.on()`, `pi.exec()`

---

## 2. Tools (`registerTool`) — LLM Tự Gọi

> 📖 Ref: [PI_TOOLS_GUIDE.md §5.1](file:///home/hieptran/Desktop/pi-learn/docs/PI_TOOLS_GUIDE.md) — Tool Definition Interface
> 📖 Ref: [PI_TOOLS_GUIDE.md §11](file:///home/hieptran/Desktop/pi-learn/docs/PI_TOOLS_GUIDE.md) — System Prompt Integration
> 📖 Ref: [PI_DOCUMENTATION.md §6.7](file:///home/hieptran/Desktop/pi-learn/PI_DOCUMENTATION.md) — Slash Commands vs Tools

**Sự khác biệt quan trọng:** Tools do **LLM tự gọi** mỗi turn. Commands do **user gõ `/`**. Extension đăng ký cả hai.

### Tool: `subagent`

Core tool — LLM gọi để orchestrate agents.

```typescript
pi.registerTool({
  name: "subagent",
  label: "Subagent",
  description: "Delegate tasks to specialized subagents (scout, planner, worker, reviewer)",
  promptSnippet: "Delegate work to specialized agents for code exploration, planning, implementation, and review",
  promptGuidelines: [
    "Use subagent for tasks requiring focused context (exploration, implementation, review)",
    "Always provide taskId when working on a Beads task",
    "Chain mode: scout → planner → worker for new features",
    "Single mode: one agent for focused tasks",
  ],
  parameters: Type.Object({
    taskId: Type.Optional(Type.String({ description: "Beads task ID (e.g. bd-a3f8.1)" })),
    agent: Type.Optional(Type.String({ description: "Agent name for single mode" })),
    task: Type.Optional(Type.String({ description: "Task description" })),
    chain: Type.Optional(Type.Array(Type.Object({
      agent: Type.String(),
      task: Type.String(),
    }))),
    tasks: Type.Optional(Type.Array(Type.Object({
      taskId: Type.Optional(Type.String()),
      agent: Type.String(),
      task: Type.String(),
    }))),
  }),
  // ...execute, renderCall, renderResult
});
```

### Tool: `harness_prime`

> 📖 Ref: [Beads QUICKSTART](https://github.com/steveyegge/beads/blob/main/docs/QUICKSTART.md) — `bd prime` command

`bd prime` = Beads built-in command cho agents. Một call = toàn bộ context cần thiết.

```typescript
pi.registerTool({
  name: "harness_prime",
  description: "Get current task context: ready tasks, blocked, stats, recent closes",
  promptSnippet: "Get Beads task context (ready work, blocked issues, stats)",
  promptGuidelines: [
    "Call harness_prime at start of session to understand task landscape",
    "Use this instead of running multiple bd commands",
  ],
  parameters: Type.Object({
    filter: Type.Optional(StringEnum(["ready", "blocked", "all", "stats"])),
  }),
  async execute(id, params) {
    const result = await pi.exec("bd", ["prime", "--json"]);
    return {
      content: [{ type: "text", text: result.stdout }],
      details: JSON.parse(result.stdout),
    };
  },
});
```

### Tool: `harness_task`

CRUD operations cho Beads tasks. Structured parameters tránh LLM hallucinate bash flags.

```typescript
pi.registerTool({
  name: "harness_task",
  description: "Create, claim, close, or show Beads tasks",
  promptSnippet: "Manage Beads tasks (create, claim, close, show, add dependencies)",
  promptGuidelines: [
    "Use 'claim' before starting work on a task",
    "Use 'close' with a reason after completing implementation",
    "Use 'create' with --parent for subtasks under an epic",
    "NEVER use bd edit (interactive) — use harness_task update actions",
  ],
  parameters: Type.Object({
    action: StringEnum(["create", "claim", "close", "show", "dep_add", "ready", "blocked"]),
    taskId: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    priority: Type.Optional(Type.Number({ minimum: 0, maximum: 4 })),
    type: Type.Optional(StringEnum(["task", "bug", "feature", "epic"])),
    reason: Type.Optional(Type.String()),
    parent: Type.Optional(Type.String()),
    blockedBy: Type.Optional(Type.String()),
    label: Type.Optional(Type.String()),
  }),
  async execute(id, params) {
    const args: string[] = [];
    switch (params.action) {
      case "create":
        args.push("create", params.title!);
        if (params.priority != null) args.push("-p", String(params.priority));
        if (params.type) args.push("-t", params.type);
        if (params.parent) args.push("--parent", params.parent);
        if (params.label) args.push("-l", params.label);
        break;
      case "claim":
        args.push("update", params.taskId!, "--claim");
        break;
      case "close":
        args.push("close", params.taskId!, "--reason", params.reason ?? "Completed");
        break;
      case "show":
        args.push("show", params.taskId!, "--json");
        break;
      case "dep_add":
        args.push("dep", "add", params.taskId!, params.blockedBy!);
        break;
      case "ready":
        args.push("ready", "--json");
        break;
      case "blocked":
        args.push("blocked", "--json");
        break;
    }
    const result = await pi.exec("bd", args);
    return {
      content: [{ type: "text", text: result.stdout || result.stderr }],
      details: { action: params.action, exitCode: result.exitCode },
    };
  },
});
```

### Tool: `harness_quality`

> 📖 Ref: [PI_TOOLS_GUIDE.md §5.5](file:///home/hieptran/Desktop/pi-learn/docs/PI_TOOLS_GUIDE.md) — Output Truncation

```typescript
pi.registerTool({
  name: "harness_quality",
  description: "Run quality scan: typecheck, lint, test coverage, file size audit",
  promptSnippet: "Check code quality metrics (typecheck, lint, coverage)",
  promptGuidelines: [
    "Run after implementation to verify quality before closing task",
    "Report score to user",
  ],
  parameters: Type.Object({}),
  async execute(id, params, signal) {
    const tsc = await pi.exec("npx", ["tsc", "--noEmit"], { signal });
    const lint = await pi.exec("npx", ["biome", "check", "."], { signal });
    // ... aggregate into QualityReport
  },
});
```

---

## 3. Commands (`registerCommand`) — User Gõ `/`

> 📖 Ref: [PI_DOCUMENTATION.md §6.6](file:///home/hieptran/Desktop/pi-learn/PI_DOCUMENTATION.md) — Slash Command Resolution
> 📖 Ref: [PI_DOCUMENTATION.md §6.7](file:///home/hieptran/Desktop/pi-learn/PI_DOCUMENTATION.md) — Slash Commands vs Tools

Commands là cho **user**. User gõ `/ready` → thấy tasks ngay. Không cần LLM.

| Command | Mô Tả | bd Command |
|---------|--------|-----------|
| `/tasks` | All open tasks | `bd list --status open` |
| `/ready` | Ready tasks (no blockers) | `bd ready` |
| `/claim <id>` | Claim task | `bd update <id> --claim` |
| `/close <id>` | Close task | `bd close <id>` |
| `/status` | Dashboard: ready + blocked + stats | `bd prime` |
| `/tree <id>` | Dependency tree | `bd dep tree <id>` |
| `/pipeline <id>` | Trigger full chain cho task | Inject prompt → LLM orchestrate |
| `/triage <desc>` | Create epic + subtasks | Scout → bd create |
| `/cleanup` | Entropy scan + fix | Reviewer → worker |
| `/quality` | Quality score | harness_quality tool |

```typescript
// Ví dụ: /ready
pi.registerCommand("ready", {
  description: "Show ready tasks from Beads",
  async handler(args, ctx) {
    const result = await pi.exec("bd", ["ready"]);
    ctx.ui?.notify(result.stdout, "info");
  },
});

// Ví dụ: /status — aggregated dashboard
pi.registerCommand("status", {
  description: "Harness dashboard: tasks, quality, progress",
  async handler(args, ctx) {
    const [ready, blocked, stats] = await Promise.all([
      pi.exec("bd", ["ready"]),
      pi.exec("bd", ["blocked"]),
      pi.exec("bd", ["stats"]),
    ]);
    ctx.ui?.notify(
      `## 📊 Harness Status\n### Ready\n${ready.stdout}\n### Blocked\n${blocked.stdout}\n### Stats\n${stats.stdout}`,
      "info"
    );
  },
});

// Ví dụ: /pipeline <id> — inject prompt cho LLM
pi.registerCommand("pipeline", {
  description: "Run full pipeline (scout→planner→worker→reviewer) for task",
  async handler(args, ctx) {
    const taskId = args.trim();
    if (!taskId) {
      ctx.ui?.notify("Usage: /pipeline <task-id>", "error");
      return;
    }
    ctx.sendMessage(
      `Run full pipeline for task ${taskId}: scout → planner → worker → reviewer. ` +
      `Use subagent chain with taskId="${taskId}".`
    );
  },
});
```

---

## 4. Hooks/Events (`pi.on`) — Lifecycle Tự Động

> 📖 Ref: [PI_TOOLS_GUIDE.md §10](file:///home/hieptran/Desktop/pi-learn/docs/PI_TOOLS_GUIDE.md) — Tool Events — Hooks
> 📖 Ref: [PI_EXTENSIONS_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/docs/PI_EXTENSIONS_GUIDE.md) — Event hooks

### `session_start` — Auto-inject Beads context

Mỗi khi bắt đầu Pi session, tự động chạy `bd prime` và inject.

```typescript
pi.on("session_start", async (_event, ctx) => {
  if (!pi.getFlag("harness")) return;
  try {
    const prime = await pi.exec("bd", ["prime"]);
    // Inject as system context (LLM thấy, user không thấy)
    // Option: appendEntry hoặc inject qua tool result
  } catch {
    // Beads chưa init → skip
  }
});
```

### `tool_call` — Permission gates

Chặn writes tới protected paths **trước khi tool execute**.

```typescript
pi.on("tool_call", async (event, ctx) => {
  // Protected paths
  if (["write", "edit"].includes(event.toolName)) {
    const path = event.input.path;
    if ([".beads/", ".env", "package-lock.json"].some(p => path.includes(p))) {
      return { block: true, reason: `Protected path: ${path}` };
    }
  }

  // Dangerous bash commands
  if (event.toolName === "bash") {
    const cmd = event.input.command;
    if (/rm\s+-rf|DROP\s+TABLE|format\s+/i.test(cmd)) {
      const ok = await ctx.ui?.confirm("⚠️ Dangerous!", `Allow: ${cmd}?`);
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  }
});
```

### `tool_result` — Back-pressure verification

Sau mỗi file edit → auto-typecheck. Thêm errors vào result nếu thất bại.

```typescript
pi.on("tool_result", async (event, ctx) => {
  if (!pi.getFlag("harness-verify")) return;

  if (["edit", "write"].includes(event.toolName)) {
    const tsc = await pi.exec("npx", ["tsc", "--noEmit"]);
    if (tsc.exitCode !== 0) {
      // MODIFY result: append errors cho LLM thấy
      return {
        content: [
          ...event.content,
          { type: "text", text: `\n⚠️ TypeScript errors:\n${tsc.stderr}` },
        ],
      };
    }
    // Success → swallow (return nothing = no modification)
  }
});
```

### `session_shutdown` — Auto-sync

```typescript
pi.on("session_shutdown", async () => {
  try {
    await pi.exec("bd", ["dolt", "push"]);
  } catch { /* no remote → skip */ }
});
```

---

## 5. Prompt Templates — Workflow Triggers

> 📖 Ref: [PI_DOCUMENTATION.md §6.6](file:///home/hieptran/Desktop/pi-learn/PI_DOCUMENTATION.md) — Prompt Templates trong registry
> 📖 Ref: [PI_PROMPT_TEMPLATES_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/docs/PI_PROMPT_TEMPLATES_GUIDE.md)

Prompt templates = `harness/prompts/*.md`. User gõ `/implement Add OAuth` → Pi inject template content + args vào LLM.

| Template | Path | Trigger |
|----------|------|---------|
| Implement | `harness/prompts/implement.md` | `/implement <task>` |
| Review Fix | `harness/prompts/review-fix.md` | `/review-fix <task>` |
| Scout Plan | `harness/prompts/scout-plan.md` | `/scout-plan <task>` |
| Triage | `harness/prompts/triage.md` | `/triage <desc>` |
| Full Pipeline | `harness/prompts/full-pipeline.md` | `/full-pipeline <task>` |
| Cleanup | `harness/prompts/cleanup.md` | `/cleanup` |
| Delegate | `harness/prompts/delegate.md` | `/delegate <id> <agent>` |
| Breakdown | `harness/prompts/breakdown.md` | `/breakdown <desc>` |

**Ví dụ `implement.md`:**

```markdown
---
description: Scout → Planner → Worker pipeline with Beads tracking
---
Implement: $@

1. Run `bd ready --json` to find matching task (or create one with harness_task)
2. Use subagent chain with taskId:
   - scout: explore codebase for relevant code
   - planner: create implementation plan from scout findings
   - worker: bd claim → implement → verify → bd close → git commit
3. After worker completes, verify all tests pass
```

**Ví dụ `triage.md`:**

```markdown
---
description: Break a large task into Beads epic + subtasks with dependencies
---
Triage and decompose: $@

1. Use subagent scout to explore codebase and understand scope
2. Create Beads epic: harness_task(action="create", title="<title>", type="epic")
3. Break into subtasks: harness_task(action="create", parent="<epic-id>", ...)
4. Add dependencies: harness_task(action="dep_add", ...)
5. Show result: bash("bd dep tree <epic-id>")
6. Do NOT implement anything — output plan for human review
```

---

## 6. Skills (`SKILL.md`) — Progressive Disclosure

> 📖 Ref: [PI_SKILLS_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/docs/PI_SKILLS_GUIDE.md)
> 📖 Ref: [Agent Harness Theory §4.3](file:///home/hieptran/Desktop/pi-learn/harness/docs/AGENT_HARNESS_THEORY.md) — Skills cho Progressive Disclosure

Skills = module kiến thức **chỉ load khi LLM cần**. Không bloat system prompt.

### Skill: `harness-guide`

**File**: `harness/skills/harness-guide/SKILL.md`

```yaml
---
name: harness-guide
description: How to use the Agent Harness system — agents, pipelines, Beads tasks
---

## Agent Harness Quick Reference

### 4 Agents
- scout (Haiku, read-only) — explore codebase, collect context
- planner (Sonnet, read-only) — create implementation plan
- worker (Sonnet, full tools) — implement, verify, commit
- reviewer (Sonnet, read-only+bash) — code review, structured pass/fail

### Tools
- subagent(taskId, agent, task) — delegate to agent
- harness_prime() — get Beads context (ready, blocked, stats)
- harness_task(action, ...) — create/claim/close tasks
- harness_quality() — quality scan

### Pipeline Patterns
- /implement: scout → planner → worker
- /review-fix: worker → reviewer → worker(fix)
- /triage: scout → create epic + subtasks

### Worker Rule
1 task per session: bd ready → claim → implement → verify → commit → bd close → exit
```

### Skill: `beads-workflow`

**File**: `harness/skills/beads-workflow/SKILL.md`

```yaml
---
name: beads-workflow
description: Beads (bd CLI) task tracking for AI agents — commands, dependencies, epics
---

## Beads Quick Reference

### Core Commands
- bd create "Title" -p 1 -t task — Create task
- bd create "Title" -t epic --parent <id> — Create subtask
- bd dep add <child> <parent> — Add dependency
- bd ready — Show tasks with no blockers
- bd update <id> --claim — Claim task (atomic)
- bd close <id> --reason "..." — Complete task
- bd show <id> --json — Task details
- bd dep tree <id> — Dependency visualization
- bd prime --json — Full agent context dump
- bd stats — Statistics

### NEVER use
- bd edit (opens interactive editor — use bd update with flags)

### Dependency Types (blocking)
- blocks (default), parent-child, conditional-blocks, waits-for

### Dependency Types (non-blocking)
- related, tracks, discovered-from, caused-by, validates, supersedes
```

> **Tại sao Skills thay vì nhét vào AGENTS.md?** ETH Zurich research: hầu hết agent instructions không có ích → ít hơn tốt hơn. Skills load on-demand khi LLM cần → **progressive disclosure**.

---

## 7. Sub-agents — Agent Definitions

> 📖 Ref: [PI_DOCUMENTATION.md §6.7](file:///home/hieptran/Desktop/pi-learn/PI_DOCUMENTATION.md) — Sub-agent Architecture
> 📖 Ref: [HARNESS_GUIDE.md §3](file:///home/hieptran/Desktop/pi-learn/harness/docs/HARNESS_GUIDE.md) — 4 Agents

Đã planned: `scout.md`, `planner.md`, `worker.md`, `reviewer.md`.

**Suggestion thêm:**

### `proofreader.md`

```yaml
---
name: proofreader
description: Review docs, comments, commit messages cho quality
tools: read, grep, find, ls
model: claude-haiku-4-5
thinking: off
max_turns: 20
---
```

Dùng cho `/cleanup` — check doc freshness, broken links, stale comments.

### `researcher.md`

```yaml
---
name: researcher
description: Deep research — trace cross-service flows, collect evidence
tools: read, grep, find, ls, bash
model: claude-sonnet-4-5
thinking: high
max_turns: 50
---
```

Cho complex debugging hoặc architecture research khi scout không đủ deep.

---

## 8. Custom TUI Rendering

> 📖 Ref: [PI_TOOLS_GUIDE.md §8](file:///home/hieptran/Desktop/pi-learn/docs/PI_TOOLS_GUIDE.md) — Custom Rendering
> 📖 Ref: [PI_TUI_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/docs/PI_TUI_GUIDE.md) — TUI Components

### Subagent `renderCall` — Header khi tool được gọi

```typescript
renderCall(args, theme, context) {
  const text = (context.lastComponent as Text) ?? new Text("", 0, 0);
  let content = theme.fg("toolTitle", theme.bold("🤖 subagent "));

  if (args.taskId) {
    content += theme.fg("accent", `[${args.taskId}] `);
  }
  if (args.chain) {
    content += theme.fg("dim", args.chain.map(s => s.agent).join(" → "));
  } else if (args.agent) {
    content += theme.fg("muted", args.agent);
  }

  text.setText(content);
  return text;
}
```

Hiện: `🤖 subagent [bd-a3f8.1] scout → planner → worker`

### Subagent `renderResult` — Output khi xong

```typescript
renderResult(result, { expanded, isPartial }, theme, context) {
  if (isPartial) {
    const p = result.details?.progress;
    return new Text(
      theme.fg("warning", `⏳ ${p?.currentAgent}: ${p?.status}`), 0, 0
    );
  }

  const r = result.details;
  let text = theme.fg("success", `✓ ${r.agent} completed`);
  text += theme.fg("dim", ` (${r.usage.turns} turns, $${r.usage.cost.toFixed(3)})`);

  if (expanded) {
    text += "\n" + theme.fg("muted", r.summary);
    for (const cite of r.citations ?? []) {
      text += "\n  " + theme.fg("dim", `📎 ${cite}`);
    }
  }
  return new Text(text, 0, 0);
}
```

### `/status` command — Dashboard rendering

```text
📊 Harness Status
─────────────────
Ready:   3 tasks  │  ▓▓▓░░░░░  38%
Blocked: 5 tasks  │  ▓▓▓▓▓░░░  62%
Closed:  12 total │

Top ready:
  [P0] bd-a3f8.1: Fix auth bug
  [P1] bd-c7d2:   Add user settings
  [P2] bd-e9f1.3: Update docs

Quality: 78/100 (lint: 3 issues, tsc: clean)
```

---

## 9. Flags (`registerFlag`)

> 📖 Ref: [PI_EXTENSIONS_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/docs/PI_EXTENSIONS_GUIDE.md) — registerFlag API

```typescript
pi.registerFlag("harness", {
  type: "boolean",
  default: true,
  description: "Enable Agent Harness system",
});

pi.registerFlag("harness-verify", {
  type: "boolean",
  default: true,
  description: "Auto-verify (typecheck, lint) after edits",
});

pi.registerFlag("harness-model", {
  type: "string",
  default: "claude-sonnet-4-5",
  description: "Default model for worker/planner agents",
});

pi.registerFlag("harness-scout-model", {
  type: "string",
  default: "claude-haiku-4-5",
  description: "Model for scout agent (cheap, fast)",
});
```

**CLI usage:**

```bash
pi --harness                           # Enable (default)
pi --no-harness                        # Disable harness system
pi --harness-verify=false              # Skip auto-verify
pi --harness-model=claude-haiku-4-5    # Cheaper model for all agents
```

---

## 10. Settings (`.pi/settings.json`)

> 📖 Ref: [PI_DOCUMENTATION.md](file:///home/hieptran/Desktop/pi-learn/PI_DOCUMENTATION.md) — Settings

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

---

## 11. Beads MCP Server

> 📖 Ref: [Beads MCP — PyPI](https://pypi.org/project/beads-mcp/)
> 📖 Ref: [Beads MCP — GitHub](https://github.com/steveyegge/beads/tree/main/mcp-server)

Beads cung cấp MCP server (`beads-mcp`) cho environments không có shell access.

### So sánh

| | `bd` via `bash` tool | Beads MCP Server |
|---|---------------------|-----------------|
| **Cần gì** | `bd` CLI installed | `beads-mcp` + MCP config |
| **Token usage** | ✅ Thấp hơn | Cao hơn (MCP protocol overhead) |
| **Latency** | ✅ Nhanh hơn | Chậm hơn |
| **Setup** | `npm install -g @beads/bd` | `pip install beads-mcp` + config |
| **Khi nào dùng** | ✅ Terminal (Pi) | No-shell environments |

### Recommendation

**Dùng `bd` via `bash` tool** (hoặc wrapped trong `harness_task` tool). Pi đã có shell access, MCP overhead không cần thiết.

Nếu muốn MCP:

```json
{
  "mcpServers": {
    "beads": {
      "command": "beads-mcp",
      "args": ["--db-path", ".beads/dolt"]
    }
  }
}
```

---

## 12. External Integrations

### GitNexus (đã có trong project)

> 📖 Ref: [AGENTS.md — GitNexus section](file:///home/hieptran/Desktop/pi-learn/AGENTS.md)

Kết hợp GitNexus + Harness:

| Agent | GitNexus Tool | Dùng Khi |
|-------|--------------|----------|
| **Scout** | `gitnexus_query` | Tìm code by concept (thay grep) |
| **Worker** | `gitnexus_impact` | Blast radius trước khi edit |
| **Reviewer** | `gitnexus_detect_changes` | Verify scope sau implementation |

### Beads Village (multi-agent coordination)

Nếu scale lên nhiều agents chạy đồng thời trên nhiều machines:

```bash
pip install beads-village
```

Central MCP server cho multi-agent workflow coordination — file locking, agent mail, task delegation.

---

## Priority Matrix

### 🔴 Phase 1 — Must (build ngay)

| Feature | Pi Type | File |
|---------|---------|------|
| `harness-state` extension | Extension | `harness/extensions/harness-state/index.ts` |
| `harness-subagent` extension | Extension + Tool | `harness/extensions/harness-subagent/index.ts` |
| `session_start` hook | Event | Trong harness-state |
| `tool_call` gate | Event | Trong harness-verify |
| 4 agent definitions | Sub-agents | `harness/agents/*.md` |
| `subagent` tool | registerTool | Trong harness-subagent |

### 🟡 Phase 2 — Should (sau core chạy)

| Feature | Pi Type | File |
|---------|---------|------|
| `/tasks`, `/ready`, `/status` | registerCommand | Trong harness-state |
| `/pipeline`, `/triage` | registerCommand | Trong harness-subagent |
| Prompt templates (6+) | Prompt Templates | `harness/prompts/*.md` |
| `tool_result` verify hook | Event | Trong harness-verify |
| `harness_prime` tool | registerTool | Trong harness-state |
| `harness_task` tool | registerTool | Trong harness-state |
| Settings config | Settings | `.pi/settings.json` |

### 🟢 Phase 3 — Nice (polish)

| Feature | Pi Type | File |
|---------|---------|------|
| Custom TUI rendering | renderCall/renderResult | Trong harness-subagent |
| Skills (2+) | SKILL.md | `harness/skills/*/SKILL.md` |
| Flags (3+) | registerFlag | Trong harness-state |
| `harness_quality` tool | registerTool | Trong harness-quality |
| Notify extension | Extension | `harness/extensions/harness-notify/` |
| proofreader agent | Sub-agent | `harness/agents/proofreader.md` |
| researcher agent | Sub-agent | `harness/agents/researcher.md` |

---

## Tham Khảo

| Tài Liệu | Nội Dung |
|----------|---------|
| [HARNESS_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/harness/docs/HARNESS_GUIDE.md) | Hướng dẫn sử dụng harness |
| [AGENT_HARNESS_THEORY.md](file:///home/hieptran/Desktop/pi-learn/harness/docs/AGENT_HARNESS_THEORY.md) | Lý thuyết nền tảng Agent Harness |
| [PI_TOOLS_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/docs/PI_TOOLS_GUIDE.md) | Tool system trong Pi |
| [PI_EXTENSIONS_GUIDE.md](file:///home/hieptran/Desktop/pi-learn/docs/PI_EXTENSIONS_GUIDE.md) | Extension API |
| [PI_DOCUMENTATION.md](file:///home/hieptran/Desktop/pi-learn/PI_DOCUMENTATION.md) | Pi documentation tổng hợp |
| [Beads GitHub](https://github.com/steveyegge/beads) | Beads issue tracker |
| [Beads Quickstart](https://github.com/steveyegge/beads/blob/main/docs/QUICKSTART.md) | Beads getting started |
| [Beads Dependencies](https://github.com/steveyegge/beads/blob/main/docs/DEPENDENCIES.md) | Dependencies & Gates |
| [Beads MCP](https://pypi.org/project/beads-mcp/) | MCP server cho Beads |
