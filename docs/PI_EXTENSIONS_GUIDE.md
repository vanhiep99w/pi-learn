# 🔌 Pi Extensions — Hướng Dẫn Chi Tiết Toàn Diện

> Tham khảo chính thức từ [github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)  
> Pi có thể tự tạo extensions — hãy nhờ nó build cho bạn!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Quick Start](#2-quick-start)
- [3. Vị Trí Đặt Extensions](#3-vị-trí-đặt-extensions)
- [4. Cấu Trúc Extension](#4-cấu-trúc-extension)
- [5. Imports Có Sẵn](#5-imports-có-sẵn)
- [6. Events — Hệ Thống Sự Kiện](#6-events--hệ-thống-sự-kiện)
  - [6.1 Lifecycle Tổng Quan](#61-lifecycle-tổng-quan)
  - [6.2 Session Events](#62-session-events)
  - [6.3 Agent Events](#63-agent-events)
  - [6.4 Tool Events](#64-tool-events)
  - [6.5 Model Events](#65-model-events)
  - [6.6 Input Events](#66-input-events)
  - [6.7 User Bash Events](#67-user-bash-events)
- [7. ExtensionContext (`ctx`)](#7-extensioncontext-ctx)
- [8. ExtensionCommandContext](#8-extensioncommandcontext)
- [9. ExtensionAPI Methods](#9-extensionapi-methods)
- [10. Custom Tools](#10-custom-tools)
  - [10.1 Định Nghĩa Tool](#101-định-nghĩa-tool)
  - [10.2 Override Built-in Tools](#102-override-built-in-tools)
  - [10.3 Remote Execution](#103-remote-execution)
  - [10.4 Output Truncation](#104-output-truncation)
  - [10.5 Multiple Tools & Shared State](#105-multiple-tools--shared-state)
  - [10.6 Custom Rendering](#106-custom-rendering)
- [11. Custom UI](#11-custom-ui)
  - [11.1 Dialogs](#111-dialogs)
  - [11.2 Widgets, Status, Footer](#112-widgets-status-footer)
  - [11.3 Custom Components](#113-custom-components)
  - [11.4 Overlays](#114-overlays)
  - [11.5 Custom Editor](#115-custom-editor)
  - [11.6 Message Rendering](#116-message-rendering)
- [12. Custom Providers](#12-custom-providers)
  - [12.1 Override Provider](#121-override-provider)
  - [12.2 Register New Provider](#122-register-new-provider)
  - [12.3 OAuth Support](#123-oauth-support)
  - [12.4 Custom Streaming API](#124-custom-streaming-api)
- [13. State Management](#13-state-management)
- [14. TUI Component System](#14-tui-component-system)
- [15. Error Handling & Mode Behavior](#15-error-handling--mode-behavior)
- [16. Danh Sách Examples](#16-danh-sách-examples)

---

## 1. Tổng Quan

**Extensions** là tính năng mạnh nhất của Pi. Đây là các TypeScript modules cho phép bạn mở rộng Pi theo bất kỳ cách nào bạn muốn.

### Khả năng chính

| Khả năng | API |
|----------|-----|
| **Custom tools** | `pi.registerTool()` — Đăng ký tool mới cho LLM gọi |
| **Event interception** | `pi.on()` — Block hoặc modify tool calls, inject context |
| **User interaction** | `ctx.ui.*` — Prompt users (select, confirm, input, notify) |
| **Custom UI components** | `ctx.ui.custom()` — Full TUI components với keyboard input |
| **Custom commands** | `pi.registerCommand()` — Đăng ký `/mycommand` |
| **Keyboard shortcuts** | `pi.registerShortcut()` — Đăng ký phím tắt |
| **CLI flags** | `pi.registerFlag()` — Thêm CLI flags |
| **Session persistence** | `pi.appendEntry()` — Lưu state qua restarts |
| **Custom rendering** | `renderCall()` / `renderResult()` — Tùy chỉnh hiển thị TUI |
| **Custom providers** | `pi.registerProvider()` — Thêm LLM providers |
| **Shell commands** | `pi.exec()` — Chạy lệnh shell |
| **Inter-extension comms** | `pi.events` — Giao tiếp giữa các extensions |
| **Tool management** | `pi.setActiveTools()` / `pi.getAllTools()` — Quản lý tools |
| **Model control** | `pi.setModel()` / `pi.setThinkingLevel()` — Điều khiển model |

### Use Cases Thực Tế

- **Permission gates** — Confirm trước `rm -rf`, `sudo`
- **Git checkpointing** — Stash mỗi turn, restore on branch
- **Path protection** — Block writes to `.env`, `node_modules/`
- **Custom compaction** — Summarize conversation theo cách riêng
- **Sub-agents** — Spawn pi instances via tmux
- **Plan mode** — Build your own plan mode
- **SSH/Remote execution** — Custom bash operations trên remote
- **MCP server integration** — Thêm MCP support
- **Custom editor** — Vim mode, emacs mode
- **Games** — Snake, Space Invaders, Doom trong lúc chờ! 🎮

---

## 2. Quick Start

Tạo file `~/.pi/agent/extensions/my-extension.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // 1. React to events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  // 2. Block dangerous commands
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // 3. Register a custom tool
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  // 4. Register a command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

**Test nhanh** (không cần cài vào thư mục cố định):

```bash
pi -e ./my-extension.ts
```

**Hot-reload:** Extensions đặt trong auto-discovered locations có thể reload bằng `/reload`.

---

## 3. Vị Trí Đặt Extensions

> ⚠️ **Security:** Extensions chạy với full system permissions. Chỉ cài từ nguồn tin cậy.

### Auto-discovered locations

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/*.ts` | Global (tất cả projects) |
| `~/.pi/agent/extensions/*/index.ts` | Global (subdirectory) |
| `.pi/extensions/*.ts` | Project-local |
| `.pi/extensions/*/index.ts` | Project-local (subdirectory) |

### Qua settings.json

```json
{
  "packages": [
    "npm:@foo/bar@1.0.0",
    "git:github.com/user/repo@v1"
  ],
  "extensions": [
    "/path/to/local/extension.ts",
    "/path/to/local/extension/dir"
  ]
}
```

### Qua CLI flag (dùng để test)

```bash
pi -e ./my-extension.ts
pi --extension ./path/to/extension.ts
```

---

## 4. Cấu Trúc Extension

### Style 1: Single file (đơn giản nhất)

```
~/.pi/agent/extensions/
└── my-extension.ts
```

### Style 2: Directory với index.ts (multi-file)

```
~/.pi/agent/extensions/
└── my-extension/
    ├── index.ts        # Entry point (exports default function)
    ├── tools.ts        # Helper module
    └── utils.ts        # Helper module
```

### Style 3: Package có npm dependencies

```
~/.pi/agent/extensions/
└── my-extension/
    ├── package.json    # Declares dependencies
    ├── package-lock.json
    ├── node_modules/   # Sau khi npm install
    └── src/
        └── index.ts
```

```json
// package.json
{
  "name": "my-extension",
  "dependencies": {
    "zod": "^3.0.0",
    "chalk": "^5.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Chạy `npm install` trong thư mục extension, imports từ `node_modules/` sẽ tự động resolve.

### Cấu trúc cơ bản

Extension export một **default function** nhận `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Subscribe to events
  pi.on("event_name", async (event, ctx) => {
    // ctx.ui cho user interaction
    const ok = await ctx.ui.confirm("Title", "Are you sure?");
    ctx.ui.notify("Done!", "success");
    ctx.ui.setStatus("my-ext", "Processing...");      // Footer status
    ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]); // Widget above editor
  });

  // Register tools, commands, shortcuts, flags
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("my-flag", { ... });
}
```

Extensions được load qua [jiti](https://github.com/unjs/jiti) nên TypeScript chạy **không cần compile**.

---

## 5. Imports Có Sẵn

| Package | Mục đích |
|---------|----------|
| `@mariozechner/pi-coding-agent` | Extension types (`ExtensionAPI`, `ExtensionContext`, events) |
| `@sinclair/typebox` | Schema definitions cho tool parameters |
| `@mariozechner/pi-ai` | AI utilities (`StringEnum` cho Google-compatible enums) |
| `@mariozechner/pi-tui` | TUI components cho custom rendering |

Node.js built-ins (`node:fs`, `node:path`, etc.) cũng có sẵn.

npm dependencies cũng hoạt động — thêm `package.json` bên cạnh extension, chạy `npm install`.

---

## 6. Events — Hệ Thống Sự Kiện

### 6.1 Lifecycle Tổng Quan

```
pi starts
  │
  ├─► session_start { reason: "startup" }
  └─► resources_discover { reason: "startup" }
      │
      ▼
user sends prompt ─────────────────────────────────────────┐
  │                                                        │
  ├─► (extension commands checked first, bypass if found)  │
  ├─► input (can intercept, transform, or handle)          │
  ├─► (skill/template expansion if not handled)            │
  ├─► before_agent_start (can inject message, modify system prompt)
  ├─► agent_start                                          │
  ├─► message_start / message_update / message_end         │
  │                                                        │
  │   ┌─── turn (lặp lại khi LLM gọi tools) ─────┐         │
  │   │                                          │         │
  │   ├─► turn_start                             │         │
  │   ├─► context (modify messages)              │         │
  │   ├─► before_provider_request                │         │
  │   │                                          │         │
  │   │   LLM responds, có thể gọi tools:        │         │
  │   │     ├─► tool_execution_start             │         │
  │   │     ├─► tool_call (can block)            │         │
  │   │     ├─► tool_execution_update            │         │
  │   │     ├─► tool_result (can modify)         │         │
  │   │     └─► tool_execution_end               │         │
  │   │                                          │         │
  │   └─► turn_end                               │         │
  │                                                        │
  └─► agent_end                                            │
                                                           │
user sends another prompt ◄────────────────────────────────┘

/new hoặc /resume
  ├─► session_before_switch (can cancel)
  ├─► session_shutdown
  ├─► session_start { reason: "new" | "resume", previousSessionFile? }
  └─► resources_discover { reason: "startup" }

/fork
  ├─► session_before_fork (can cancel)
  ├─► session_shutdown
  ├─► session_start { reason: "fork", previousSessionFile }
  └─► resources_discover { reason: "startup" }

/compact hoặc auto-compaction
  ├─► session_before_compact (can cancel hoặc customize)
  └─► session_compact

/tree navigation
  ├─► session_before_tree (can cancel hoặc customize)
  └─► session_tree

/model hoặc Ctrl+P
  └─► model_select

exit (Ctrl+C, Ctrl+D)
  └─► session_shutdown
```

### 6.2 Session Events

#### `resources_discover`

Fired sau `session_start` để extensions có thể contribute thêm skill, prompt, theme paths.

```typescript
pi.on("resources_discover", async (event, _ctx) => {
  // event.cwd - current working directory
  // event.reason - "startup" | "reload"
  return {
    skillPaths: ["/path/to/skills"],
    promptPaths: ["/path/to/prompts"],
    themePaths: ["/path/to/themes"],
  };
});
```

#### `session_start`

Fired khi session started, loaded, hoặc reloaded.

```typescript
pi.on("session_start", async (event, ctx) => {
  // event.reason - "startup" | "reload" | "new" | "resume" | "fork"
  // event.previousSessionFile - có khi "new", "resume", "fork"
  ctx.ui.notify(`Session: ${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`, "info");
});
```

#### `session_before_switch` / `session_switch`

Fired khi `/new` hoặc `/resume`.

```typescript
pi.on("session_before_switch", async (event, ctx) => {
  // event.reason - "new" hoặc "resume"
  // event.targetSessionFile - session đích (chỉ khi "resume")

  if (event.reason === "new") {
    const ok = await ctx.ui.confirm("Clear?", "Delete all messages?");
    if (!ok) return { cancel: true };
  }
});

// Sau switch thành công: session_shutdown → reload extensions → session_start { reason: "new" | "resume" }
// Cleanup trong session_shutdown, reestablish state trong session_start.
```

#### `session_before_fork` / `session_fork`

Fired khi `/fork`.

```typescript
pi.on("session_before_fork", async (event, ctx) => {
  // event.entryId - ID entry được fork
  return { cancel: true };  // Cancel fork
  // HOẶC
  return { skipConversationRestore: true };  // Fork nhưng không rewind messages
});

pi.on("session_fork", async (event, ctx) => {
  // event.previousSessionFile
});
```

#### `session_before_compact` / `session_compact`

Fired khi compaction. Có thể cancel hoặc cung cấp custom summary.

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;

  // Cancel:
  return { cancel: true };

  // Custom summary:
  return {
    compaction: {
      summary: "Your custom summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }
  };
});

pi.on("session_compact", async (event, ctx) => {
  // event.compactionEntry - compaction đã lưu
  // event.fromExtension - extension có cung cấp không
});
```

#### `session_before_tree` / `session_tree`

Fired khi `/tree` navigation.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  return { cancel: true };
  // HOẶC custom summary:
  return { summary: { summary: "...", details: {} } };
});

pi.on("session_tree", async (event, ctx) => {
  // event.newLeafId, oldLeafId, summaryEntry, fromExtension
});
```

#### `session_shutdown`

Fired khi thoát (Ctrl+C, Ctrl+D, SIGTERM).

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  // Cleanup, save state, etc.
});
```

### 6.3 Agent Events

#### `before_agent_start`

Fired sau khi user submit prompt, **trước agent loop**. Có thể inject message và/hoặc modify system prompt.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt - prompt text của user
  // event.images - attached images (nếu có)
  // event.systemPrompt - system prompt hiện tại

  return {
    // Inject persistent message (lưu trong session, gửi cho LLM)
    message: {
      customType: "my-extension",
      content: "Additional context for the LLM",
      display: true,
    },
    // Replace system prompt cho turn này (chained qua extensions)
    systemPrompt: event.systemPrompt + "\n\nExtra instructions...",
  };
});
```

#### `agent_start` / `agent_end`

Fired một lần cho mỗi user prompt.

```typescript
pi.on("agent_start", async (_event, ctx) => {});

pi.on("agent_end", async (event, ctx) => {
  // event.messages - messages từ prompt này
});
```

#### `turn_start` / `turn_end`

Fired cho mỗi turn (một LLM response + tool calls).

```typescript
pi.on("turn_start", async (event, ctx) => {
  // event.turnIndex, event.timestamp
});

pi.on("turn_end", async (event, ctx) => {
  // event.turnIndex, event.message, event.toolResults
});
```

#### `message_start` / `message_update` / `message_end`

Fired cho message lifecycle updates.

- `message_start` và `message_end` — fire cho user, assistant, toolResult messages
- `message_update` — fire cho assistant streaming updates

```typescript
pi.on("message_update", async (event, ctx) => {
  // event.message
  // event.assistantMessageEvent (token-by-token stream event)
});
```

#### `context`

Fired **trước mỗi LLM call**. Modify messages non-destructively.

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages - deep copy, an toàn để modify
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});
```

#### `before_provider_request`

Fired sau khi payload được build, **ngay trước** khi gửi request. Hữu ích cho debugging.

```typescript
pi.on("before_provider_request", (event, ctx) => {
  console.log(JSON.stringify(event.payload, null, 2));
  // Optional: replace payload
  // return { ...event.payload, temperature: 0 };
});
```

### 6.4 Tool Events

#### `tool_call` — **Có thể block**

Fired trước khi tool execute. Dùng `isToolCallEventType` để narrow type.

```typescript
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  // event.toolName - "bash", "read", "write", "edit", etc.
  // event.toolCallId
  // event.input - tool parameters (mutable — mutations affect execution)

  // Built-in tools: không cần type params
  if (isToolCallEventType("bash", event)) {
    // event.input là { command: string; timeout?: number }
    event.input.command = `source ~/.profile\n${event.input.command}`;

    if (event.input.command.includes("rm -rf")) {
      return { block: true, reason: "Dangerous command" };
    }
  }

  if (isToolCallEventType("read", event)) {
    // event.input là { path: string; offset?: number; limit?: number }
    console.log(`Reading: ${event.input.path}`);
  }
});
```

#### Typing custom tool input

```typescript
// Trong extension
export type MyToolInput = Static<typeof myToolSchema>;

// Trong handler
import type { MyToolInput } from "my-extension";

pi.on("tool_call", (event) => {
  if (isToolCallEventType<"my_tool", MyToolInput>("my_tool", event)) {
    event.input.action;  // typed!
  }
});
```

#### `tool_result` — **Có thể modify**

Fired sau khi tool execute. Handlers chain như middleware.

```typescript
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input
  // event.content, event.details, event.isError

  if (isBashToolResult(event)) {
    // event.details typed là BashToolDetails
  }

  // Dùng ctx.signal cho nested async work
  const response = await fetch("https://example.com/summarize", {
    method: "POST",
    body: JSON.stringify({ content: event.content }),
    signal: ctx.signal,
  });

  // Modify result (partial patches — fields bỏ qua giữ nguyên):
  return { content: [...], details: {...}, isError: false };
});
```

#### `tool_execution_start` / `tool_execution_update` / `tool_execution_end`

Trong parallel tool mode:
- `tool_execution_start` emit theo thứ tự assistant source trong preflight phase
- `tool_execution_update` có thể interleave giữa các tools
- `tool_execution_end` emit theo thứ tự assistant source, match final tool result message order

```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.args
});

pi.on("tool_execution_update", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.args, event.partialResult
});

pi.on("tool_execution_end", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.result, event.isError
});
```

### 6.5 Model Events

#### `model_select`

Fired khi model thay đổi qua `/model`, `Ctrl+P`, hoặc session restore.

```typescript
pi.on("model_select", async (event, ctx) => {
  // event.model - model mới
  // event.previousModel - model trước (undefined nếu lần đầu)
  // event.source - "set" | "cycle" | "restore"

  const prev = event.previousModel
    ? `${event.previousModel.provider}/${event.previousModel.id}`
    : "none";
  const next = `${event.model.provider}/${event.model.id}`;

  ctx.ui.notify(`Model: ${prev} → ${next} (${event.source})`, "info");
});
```

### 6.6 Input Events

#### `input`

Fired khi nhận user input, **sau** extension commands nhưng **trước** skill/template expansion.

**Thứ tự xử lý:**
1. Extension commands (`/cmd`) — nếu match, handler chạy, skip input event
2. `input` event — can intercept, transform, or handle
3. Skill commands (`/skill:name`) — expanded
4. Prompt templates (`/template`) — expanded
5. Agent processing (`before_agent_start`, etc.)

```typescript
pi.on("input", async (event, ctx) => {
  // event.text - raw input (trước skill/template expansion)
  // event.images - attached images
  // event.source - "interactive" | "rpc" | "extension"

  // Transform: viết lại input trước expansion
  if (event.text.startsWith("?quick "))
    return { action: "transform", text: `Respond briefly: ${event.text.slice(7)}` };

  // Handle: respond không cần LLM
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }

  return { action: "continue" };  // Default: pass through
});
```

**Kết quả:**
- `continue` — pass through (default)
- `transform` — modify text/images, tiếp tục expansion
- `handled` — skip agent hoàn toàn

### 6.7 User Bash Events

#### `user_bash`

Fired khi user dùng `!` hoặc `!!` commands. **Có thể intercept.**

```typescript
pi.on("user_bash", (event, ctx) => {
  // event.command - lệnh bash
  // event.excludeFromContext - true nếu !! prefix
  // event.cwd - working directory

  // Option 1: Custom operations (e.g., SSH)
  return { operations: remoteBashOps };

  // Option 2: Trả kết quả trực tiếp
  return { result: { output: "...", exitCode: 0, cancelled: false, truncated: false } };
});
```

---

## 7. ExtensionContext (`ctx`)

Tất cả handlers (trừ `session_directory`) đều nhận `ctx: ExtensionContext`.

### ctx.ui — User Interaction

```typescript
// Dialogs
await ctx.ui.select("Pick one:", ["A", "B", "C"]);
await ctx.ui.confirm("Title", "Are you sure?");
await ctx.ui.input("Name:", "placeholder");
await ctx.ui.editor("Edit:", "prefilled text");
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"

// Status & Widgets
ctx.ui.setStatus("key", "Processing...");
ctx.ui.setWidget("key", ["Line 1", "Line 2"]);
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setTitle("pi - my-project");
```

### ctx.hasUI

`false` trong print mode (`-p`) và JSON mode. `true` trong interactive và RPC mode.

### ctx.cwd

Current working directory.

### ctx.sessionManager

Read-only access to session state.

```typescript
ctx.sessionManager.getEntries()       // Tất cả entries
ctx.sessionManager.getBranch()        // Current branch
ctx.sessionManager.getLeafId()        // Current leaf entry ID
```

### ctx.modelRegistry / ctx.model

Access đến models và API keys.

### ctx.signal

Abort signal của agent turn hiện tại, hoặc `undefined` khi không có turn active. Dùng cho abort-aware nested work.

```typescript
pi.on("tool_result", async (event, ctx) => {
  const response = await fetch("https://example.com/api", {
    method: "POST",
    body: JSON.stringify(event),
    signal: ctx.signal,
  });
  const data = await response.json();
  return { details: data };
});
```

### ctx.isIdle() / ctx.abort() / ctx.hasPendingMessages()

Control flow helpers.

### ctx.shutdown()

Graceful shutdown. Deferred đến khi agent idle.

```typescript
pi.on("tool_call", (event, ctx) => {
  if (isFatal(event.input)) {
    ctx.shutdown();
  }
});
```

### ctx.getContextUsage()

Trả về context usage cho active model.

```typescript
const usage = ctx.getContextUsage();
if (usage && usage.tokens > 100_000) {
  // Context đang lớn, cân nhắc compact
}
```

### ctx.compact()

Trigger compaction không cần await.

```typescript
ctx.compact({
  customInstructions: "Focus on recent changes",
  onComplete: (result) => ctx.ui.notify("Compaction xong", "info"),
  onError: (error) => ctx.ui.notify(`Lỗi: ${error.message}`, "error"),
});
```

### ctx.getSystemPrompt()

Trả về system prompt hiện tại (bao gồm modifications từ `before_agent_start`).

---

## 8. ExtensionCommandContext

Command handlers nhận `ExtensionCommandContext` — extends `ExtensionContext` thêm session control methods.

> Chỉ dùng trong commands vì có thể deadlock nếu gọi từ event handlers.

### ctx.waitForIdle()

Chờ agent stream xong.

```typescript
pi.registerCommand("my-cmd", {
  handler: async (args, ctx) => {
    await ctx.waitForIdle();
    // Agent idle, safe để modify session
  },
});
```

### ctx.newSession(options?)

Tạo session mới.

```typescript
const result = await ctx.newSession({
  parentSession: ctx.sessionManager.getSessionFile(),
  setup: async (sm) => {
    sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Context from previous session..." }],
      timestamp: Date.now(),
    });
  },
});
```

### ctx.fork(entryId)

Fork từ entry cụ thể.

```typescript
const result = await ctx.fork("entry-id-123");
```

### ctx.navigateTree(targetId, options?)

Navigate trong session tree.

```typescript
const result = await ctx.navigateTree("entry-id-456", {
  summarize: true,
  customInstructions: "Focus on error handling changes",
  replaceInstructions: false,  // true = thay thế prompt mặc định hoàn toàn
  label: "review-checkpoint",
});
```

### ctx.switchSession(sessionPath)

Chuyển sang session file khác.

```typescript
const result = await ctx.switchSession("/path/to/session.jsonl");
if (result.cancelled) {
  // Extension đã cancel via session_before_switch
}
```

### ctx.reload()

Reload extensions, skills, prompts, themes (giống `/reload`).

```typescript
pi.registerCommand("reload-runtime", {
  handler: async (_args, ctx) => {
    await ctx.reload();
    return; // Treat reload as terminal
  },
});
```

> **Quan trọng:** Sau `await ctx.reload()`, code vẫn chạy từ pre-reload version. Đừng giả định old state còn valid.

---

## 9. ExtensionAPI Methods

### pi.on(event, handler)

Subscribe to events. Xem [Events](#6-events--hệ-thống-sự-kiện).

### pi.registerTool(definition)

Đăng ký tool cho LLM. Hoạt động cả trong extension load lẫn sau startup (session_start, command handlers, event handlers). Tools mới refresh ngay mà không cần `/reload`.

### pi.sendMessage(message, options?)

Inject custom message vào session.

```typescript
pi.sendMessage({
  customType: "my-extension",
  content: "Message text",
  display: true,
  details: { ... },
}, {
  deliverAs: "steer",     // "steer" | "followUp" | "nextTurn"
  triggerTurn: true,       // Trigger LLM response nếu agent idle
});
```

**Delivery modes:**
- `"steer"` (default) — Queued khi streaming. Delivered sau khi tool calls hiện tại xong, trước LLM call tiếp
- `"followUp"` — Chờ agent xong hết rồi mới gửi
- `"nextTurn"` — Queued cho prompt tiếp theo, không trigger gì

### pi.sendUserMessage(content, options?)

Gửi user message (hiện như user gõ). Luôn trigger turn.

```typescript
pi.sendUserMessage("What is 2+2?");

// Khi streaming — phải chỉ định delivery mode
pi.sendUserMessage("Focus on errors", { deliverAs: "steer" });
pi.sendUserMessage("Then summarize", { deliverAs: "followUp" });
```

### pi.appendEntry(customType, data?)

Persist extension state (KHÔNG tham gia LLM context).

```typescript
pi.appendEntry("my-state", { count: 42 });

// Restore on reload
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      // Reconstruct từ entry.data
    }
  }
});
```

### pi.setSessionName(name) / pi.getSessionName()

Set/get session display name.

### pi.setLabel(entryId, label)

Set/clear label trên entry (bookmarks cho `/tree`).

### pi.registerCommand(name, options)

```typescript
pi.registerCommand("stats", {
  description: "Show session statistics",
  handler: async (args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} entries`, "info");
  },
});
```

Với auto-completion:

```typescript
import type { AutocompleteItem } from "@mariozechner/pi-tui";

pi.registerCommand("deploy", {
  description: "Deploy to environment",
  getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
    const envs = ["dev", "staging", "prod"];
    return envs
      .filter(e => e.startsWith(prefix))
      .map(e => ({ value: e, label: e }));
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`Deploying: ${args}`, "info");
  },
});
```

### pi.getCommands()

Lấy danh sách slash commands (extensions, templates, skills).

```typescript
const commands = pi.getCommands();
const extCmds = commands.filter(c => c.source === "extension");
// Mỗi entry: { name, description?, source, sourceInfo: { path, source, scope, origin, baseDir? } }
```

### pi.registerMessageRenderer(customType, renderer)

Đăng ký custom TUI renderer cho messages. Xem [Message Rendering](#116-message-rendering).

### pi.registerShortcut(shortcut, options)

```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "Toggle plan mode",
  handler: async (ctx) => {
    ctx.ui.notify("Toggled!", "info");
  },
});
```

### pi.registerFlag(name, options)

```typescript
pi.registerFlag("plan", {
  description: "Start in plan mode",
  type: "boolean",
  default: false,
});

if (pi.getFlag("--plan")) {
  // Plan mode enabled
}
```

### pi.exec(command, args, options?)

Chạy shell command.

```typescript
const result = await pi.exec("git", ["status"], { signal, timeout: 5000 });
// result.stdout, result.stderr, result.code, result.killed
```

### pi.getActiveTools() / pi.getAllTools() / pi.setActiveTools(names)

```typescript
const active = pi.getActiveTools();
const all = pi.getAllTools();
// [{ name, description, parameters, sourceInfo: { path, source, scope, origin } }, ...]
const builtinTools = all.filter(t => t.sourceInfo.source === "builtin");
const extensionTools = all.filter(t => t.sourceInfo.source !== "builtin" && t.sourceInfo.source !== "sdk");
pi.setActiveTools(["read", "bash"]); // Switch to read-only
```

### pi.setModel(model)

```typescript
const model = ctx.modelRegistry.find("anthropic", "claude-sonnet-4-5");
if (model) {
  const success = await pi.setModel(model);
  if (!success) ctx.ui.notify("No API key", "error");
}
```

### pi.getThinkingLevel() / pi.setThinkingLevel(level)

```typescript
const current = pi.getThinkingLevel();  // "off"|"minimal"|"low"|"medium"|"high"|"xhigh"
pi.setThinkingLevel("high");
```

### pi.events

Event bus chia sẻ giữa extensions:

```typescript
pi.events.on("my:event", (data) => { ... });
pi.events.emit("my:event", { ... });
```

### pi.registerProvider(name, config) / pi.unregisterProvider(name)

Xem [Custom Providers](#12-custom-providers).

---

## 10. Custom Tools

### 10.1 Định Nghĩa Tool

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does (shown to LLM)",

  // Tùy chỉnh cách hiển thị trong system prompt
  promptSnippet: "List or add items in the project todo list",
  promptGuidelines: [
    "Use this tool for todo planning instead of direct file edits."
  ],

  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),  // Dùng StringEnum cho Google compatibility!
    text: Type.Optional(Type.String()),
  }),

  // Optional: Chạy trước schema validation, fold legacy fields
  prepareArguments(args) {
    if (!args || typeof args !== "object") return args;
    const input = args as { action?: string; oldAction?: string };
    if (typeof input.oldAction === "string" && input.action === undefined) {
      return { ...input, action: input.oldAction };
    }
    return args;
  },

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Check cancellation
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Cancelled" }] };
    }

    // Stream progress updates
    onUpdate?.({
      content: [{ type: "text", text: "Working..." }],
      details: { progress: 50 },
    });

    // Chạy command
    const result = await pi.exec("some-command", [], { signal });

    // Return result
    return {
      content: [{ type: "text", text: "Done" }],  // Gửi cho LLM
      details: { data: result },                   // Cho rendering & state
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

> **Quan trọng:** Dùng `StringEnum` từ `@mariozechner/pi-ai`, **không dùng** `Type.Union`/`Type.Literal` vì không hoạt động với Google API.

> **Signaling errors:** Throw error từ `execute` để đánh dấu tool failed (`isError: true`). Return value **không bao giờ** set error flag.

```typescript
async execute(toolCallId, params) {
  if (!isValid(params.input)) {
    throw new Error(`Invalid input: ${params.input}`);
  }
  return { content: [{ type: "text", text: "OK" }], details: {} };
}
```

> **Path normalization:** Một số models thêm `@` prefix vào path arguments. Built-in tools strip leading `@`. Custom tools nên normalize tương tự.

> **File mutation queue:** Nếu custom tool mutates files, dùng `withFileMutationQueue()` để nó tham gia cùng queue với built-in `edit`/`write`. Điều này quan trọng vì tool calls chạy parallel mặc định:

```typescript
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";

async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
  const absolutePath = resolve(ctx.cwd, params.path);

  return withFileMutationQueue(absolutePath, async () => {
    const current = await readFile(absolutePath, "utf8");
    const next = current.replace(params.oldText, params.newText);
    await writeFile(absolutePath, next, "utf8");
    return {
      content: [{ type: "text", text: `Updated ${params.path}` }],
      details: {},
    };
  });
}
```

### 10.2 Override Built-in Tools

Extensions có thể override tools mặc định (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) bằng cách đăng ký tool cùng tên.

```typescript
pi.registerTool({
  ...originalRead,
  name: "read",
  async execute(id, params, signal, onUpdate, ctx) {
    console.log(`Reading: ${params.path}`);
    return originalRead.execute(id, params, signal, onUpdate, ctx);
  },
});
```

Hoặc dùng `--no-tools` để bắt đầu không có built-in tools:

```bash
pi --no-tools -e ./my-extension.ts
```

> **Rendering:** Nếu override không cung cấp `renderCall`/`renderResult`, built-in renderer tự động dùng (syntax highlighting, diffs, etc.).

> **Lưu ý:** Implementation phải match **exact result shape** (bao gồm `details` type) vì UI và session logic phụ thuộc vào đó.

### 10.3 Remote Execution

Built-in tools hỗ trợ pluggable operations cho remote systems (SSH, containers):

```typescript
import { createReadTool, createBashTool, type ReadOperations } from "@mariozechner/pi-coding-agent";

// Tool với custom operations
const remoteRead = createReadTool(cwd, {
  operations: {
    readFile: (path) => sshExec(remote, `cat ${path}`),
    access: (path) => sshExec(remote, `test -r ${path}`).then(() => {}),
  }
});

// Dynamic: check flag tại execution time
pi.registerTool({
  ...remoteRead,
  async execute(id, params, signal, onUpdate, _ctx) {
    const ssh = getSshConfig();
    if (ssh) {
      const tool = createReadTool(cwd, { operations: createRemoteOps(ssh) });
      return tool.execute(id, params, signal, onUpdate);
    }
    return localRead.execute(id, params, signal, onUpdate);
  },
});
```

**Operations interfaces:** `ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`, `LsOperations`, `GrepOperations`, `FindOperations`

**Bash spawn hook** (modify command/cwd/env trước execution):

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: ({ command, cwd, env }) => ({
    command: `source ~/.profile\n${command}`,
    cwd: `/mnt/sandbox${cwd}`,
    env: { ...env, CI: "1" },
  }),
});
```

### 10.4 Output Truncation

Tools **PHẢI truncate output** để tránh context overflow. Giới hạn mặc định: **50KB** (~10k tokens) và **2000 lines**.

```typescript
import {
  truncateHead,      // Giữ N dòng/bytes đầu (search results, file reads)
  truncateTail,      // Giữ N dòng/bytes cuối (logs, command output)
  truncateLine,      // Truncate 1 dòng
  formatSize,        // "50KB", "1.5MB"
  DEFAULT_MAX_BYTES, // 50KB
  DEFAULT_MAX_LINES, // 2000
} from "@mariozechner/pi-coding-agent";

async execute(toolCallId, params, signal, onUpdate, ctx) {
  const output = await runCommand();

  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let result = truncation.content;

  if (truncation.truncated) {
    const tempFile = writeTempFile(output);
    result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
    result += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
    result += ` Full output saved to: ${tempFile}]`;
  }

  return { content: [{ type: "text", text: result }] };
}
```

### 10.5 Multiple Tools & Shared State

Một extension có thể đăng ký nhiều tools chia sẻ state:

```typescript
export default function (pi: ExtensionAPI) {
  let connection = null;

  pi.registerTool({ name: "db_connect", ... });
  pi.registerTool({ name: "db_query", ... });
  pi.registerTool({ name: "db_close", ... });

  pi.on("session_shutdown", async () => {
    connection?.close();
  });
}
```

### 10.6 Custom Rendering

#### renderCall — Hiển thị tool call

```typescript
import { Text } from "@mariozechner/pi-tui";

renderCall(args, theme, context) {
  const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  let content = theme.fg("toolTitle", theme.bold("my_tool "));
  content += theme.fg("muted", args.action);
  if (args.text) {
    content += " " + theme.fg("dim", `"${args.text}"`);
  }
  text.setText(content);
  return text;
}
```

#### renderResult — Hiển thị kết quả

```typescript
renderResult(result, { expanded, isPartial }, theme, context) {
  // Streaming
  if (isPartial) {
    return new Text(theme.fg("warning", "Processing..."), 0, 0);
  }

  // Error
  if (result.details?.error) {
    return new Text(theme.fg("error", `Error: ${result.details.error}`), 0, 0);
  }

  // Normal — hỗ trợ expanded view (Ctrl+O)
  let text = theme.fg("success", "✓ Done");
  if (expanded && result.details?.items) {
    for (const item of result.details.items) {
      text += "\n  " + theme.fg("dim", item);
    }
  }
  return new Text(text, 0, 0);
}
```

#### Keybinding hints

```typescript
import { keyHint } from "@mariozechner/pi-coding-agent";

renderResult(result, { expanded }, theme) {
  let text = theme.fg("success", "✓ Done");
  if (!expanded) {
    text += ` (${keyHint("app.tools.expand", "to expand")})`;
  }
  return new Text(text, 0, 0);
}
```

#### Best practices

- Dùng `Text` với padding `(0, 0)` — Box handles padding
- Dùng `\n` cho multi-line
- Handle `isPartial` cho streaming progress
- Support `expanded` cho detail on demand
- Giữ default view compact

---

## 11. Custom UI

### 11.1 Dialogs

```typescript
// Select
const choice = await ctx.ui.select("Pick one:", ["A", "B", "C"]);

// Confirm
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");

// Text input
const name = await ctx.ui.input("Name:", "placeholder");

// Multi-line editor
const text = await ctx.ui.editor("Edit:", "prefilled text");

// Notification (non-blocking)
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"
```

#### Timed Dialogs (auto-dismiss countdown)

```typescript
// Shows "Title (5s)" → "Title (4s)" → ... → auto-dismiss tại 0
const confirmed = await ctx.ui.confirm(
  "Timed Confirmation",
  "Auto-cancel in 5 seconds. Confirm?",
  { timeout: 5000 }
);
// timeout: select() → undefined, confirm() → false, input() → undefined
```

#### Manual Dismissal (AbortSignal)

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

const confirmed = await ctx.ui.confirm(
  "Timed",
  "Auto-cancel in 5s.",
  { signal: controller.signal }
);

clearTimeout(timeoutId);

if (confirmed) { /* User confirmed */ }
else if (controller.signal.aborted) { /* Timed out */ }
else { /* User cancelled */ }
```

### 11.2 Widgets, Status, Footer

```typescript
// Status trong footer (persist đến khi clear)
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined);  // Clear

// Working message (hiện khi streaming)
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setWorkingMessage();  // Restore default

// Widget above editor (default)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
// Widget below editor
ctx.ui.setWidget("my-widget", ["Line 1"], { placement: "belowEditor" });
// Widget với theme
ctx.ui.setWidget("my-widget", (_tui, theme) =>
  new Text(theme.fg("accent", "Custom"), 0, 0)
);
ctx.ui.setWidget("my-widget", undefined);  // Clear

// Custom footer (thay thế footer mặc định)
ctx.ui.setFooter((tui, theme, footerData) => ({
  render(width) {
    return [`${ctx.model?.id} (${footerData.getGitBranch() || "no git"})`];
  },
  invalidate() {},
  dispose: footerData.onBranchChange(() => tui.requestRender()),
}));
ctx.ui.setFooter(undefined);  // Restore default

// Terminal title
ctx.ui.setTitle("pi - my-project");

// Editor text
ctx.ui.setEditorText("Prefill text");
const current = ctx.ui.getEditorText();
ctx.ui.pasteToEditor("pasted content");

// Tool output expansion
ctx.ui.setToolsExpanded(true);
ctx.ui.setToolsExpanded(false);
```

### 11.3 Custom Components

Dùng `ctx.ui.custom()` — thay thế editor tạm thời với component cho đến khi `done()` được gọi:

```typescript
import { Text } from "@mariozechner/pi-tui";

const result = await ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
  const text = new Text("Press Enter to confirm, Escape to cancel", 1, 1);

  text.onKey = (key) => {
    if (key === "return") done(true);
    if (key === "escape") done(false);
    return true;
  };

  return text;
});

if (result) {
  // User pressed Enter
}
```

### 11.4 Overlays

Render component **trên top** nội dung hiện có (không clear screen):

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => new MyOverlayComponent({ onClose: done }),
  {
    overlay: true,
    overlayOptions: {
      anchor: "center",          // 9 vị trí: center, top-left, top-center, ...
      width: "50%",              // Hoặc số cụ thể
      minWidth: 40,
      maxHeight: "80%",
      margin: 2,                 // Hoặc { top, right, bottom, left }
      // Responsive: ẩn trên terminal hẹp
      visible: (w, h) => w >= 80,
    },
    onHandle: (handle) => {
      // handle.setHidden(true/false) - toggle visibility
    },
  }
);
```

> **Overlay lifecycle:** Components bị dispose khi đóng. Tạo instance mới mỗi lần show.

### 11.5 Custom Editor

Thay thế main input editor (vim mode, emacs mode, etc.):

```typescript
import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

class VimEditor extends CustomEditor {
  private mode: "normal" | "insert" = "insert";

  handleInput(data: string): void {
    if (matchesKey(data, "escape") && this.mode === "insert") {
      this.mode = "normal";
      return;
    }
    if (this.mode === "normal" && data === "i") {
      this.mode = "insert";
      return;
    }
    if (this.mode === "insert") {
      super.handleInput(data);
      return;
    }
    // Normal mode: vim navigation
    switch (data) {
      case "h": super.handleInput("\x1b[D"); return; // Left
      case "j": super.handleInput("\x1b[B"); return; // Down
      case "k": super.handleInput("\x1b[A"); return; // Up
      case "l": super.handleInput("\x1b[C"); return; // Right
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length > 0) {
      const label = this.mode === "normal" ? " NORMAL " : " INSERT ";
      const lastLine = lines[lines.length - 1]!;
      lines[lines.length - 1] = truncateToWidth(lastLine, width - label.length, "") + label;
    }
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((_tui, theme, keybindings) =>
      new VimEditor(theme, keybindings)
    );
  });
}
```

**Lưu ý:**
- Extend `CustomEditor` (KHÔNG phải `Editor`) để có app keybindings
- Call `super.handleInput(data)` cho keys không handle
- Pass `undefined` để restore default: `ctx.ui.setEditorComponent(undefined)`

### 11.6 Message Rendering

Đăng ký custom renderer cho messages với `customType`:

```typescript
import { Text } from "@mariozechner/pi-tui";

pi.registerMessageRenderer("my-extension", (message, options, theme) => {
  const { expanded } = options;
  let text = theme.fg("accent", `[${message.customType}] `);
  text += message.content;

  if (expanded && message.details) {
    text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
  }

  return new Text(text, 0, 0);
});

// Gửi message
pi.sendMessage({
  customType: "my-extension",  // Match registerMessageRenderer
  content: "Status update",
  display: true,
  details: { ... },
});
```

### Theme Colors Reference

```typescript
// Foreground
theme.fg("toolTitle", text)    // Tool names
theme.fg("accent", text)       // Highlights
theme.fg("success", text)      // Green
theme.fg("error", text)        // Red
theme.fg("warning", text)      // Yellow
theme.fg("muted", text)        // Secondary
theme.fg("dim", text)          // Tertiary

// Text styles
theme.bold(text)
theme.italic(text)
theme.strikethrough(text)

// Syntax highlighting
import { highlightCode, getLanguageFromPath } from "@mariozechner/pi-coding-agent";
const lang = getLanguageFromPath("/path/to/file.rs");  // "rust"
const highlighted = highlightCode(code, lang, theme);
```

---

## 12. Custom Providers

### 12.1 Override Provider

Redirect provider qua proxy:

```typescript
// Tất cả Anthropic requests đi qua proxy
pi.registerProvider("anthropic", {
  baseUrl: "https://proxy.example.com"
});

// Thêm custom headers
pi.registerProvider("openai", {
  headers: { "X-Custom-Header": "value" }
});

// Cả baseUrl lẫn headers
pi.registerProvider("google", {
  baseUrl: "https://ai-gateway.corp.com/google",
  headers: { "X-Corp-Auth": "CORP_AUTH_TOKEN" }  // env var hoặc literal
});
```

Khi chỉ có `baseUrl` và/hoặc `headers` (không `models`), tất cả models hiện có được giữ nguyên.

### 12.2 Register New Provider

```typescript
pi.registerProvider("my-llm", {
  baseUrl: "https://api.my-llm.com/v1",
  apiKey: "MY_LLM_API_KEY",         // env var name hoặc literal
  api: "openai-completions",        // API type
  models: [
    {
      id: "my-llm-large",
      name: "My LLM Large",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 16384,
    }
  ]
});
```

**Supported API types:**

| API | Dùng cho |
|-----|----------|
| `openai-completions` | OpenAI Chat Completions & compatibles (phổ biến nhất) |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Claude API |
| `google-generative-ai` | Google Generative AI |
| `mistral-conversations` | Mistral SDK |
| `bedrock-converse-stream` | Amazon Bedrock |
| `google-vertex` | Google Vertex AI |
| `azure-openai-responses` | Azure OpenAI |

**Compatibility options** (cho OpenAI-compatible providers):

```typescript
models: [{
  id: "custom-model",
  // ...
  compat: {
    supportsDeveloperRole: false,      // dùng "system" thay "developer"
    supportsReasoningEffort: true,
    maxTokensField: "max_tokens",      // thay vì "max_completion_tokens"
    requiresToolResultName: true,
    thinkingFormat: "qwen",            // enable_thinking: true
  }
}]
```

**Unregister provider:**

```typescript
pi.unregisterProvider("my-llm");
// Built-in models bị override sẽ được restore
```

### 12.3 OAuth Support

Thêm OAuth/SSO tích hợp với `/login`:

```typescript
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";

pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",

    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      // Option 1: Browser-based OAuth
      callbacks.onAuth({ url: "https://sso.corp.com/authorize?..." });

      // Option 2: Device code flow
      callbacks.onDeviceCode({
        userCode: "ABCD-1234",
        verificationUri: "https://sso.corp.com/device"
      });

      // Option 3: Prompt for token
      const code = await callbacks.onPrompt({ message: "Enter SSO code:" });

      const tokens = await exchangeCodeForTokens(code);

      return {
        refresh: tokens.refreshToken,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      const tokens = await refreshAccessToken(credentials.refresh);
      return {
        refresh: tokens.refreshToken ?? credentials.refresh,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    },

    // Optional: modify models theo subscription
    modifyModels(models, credentials) {
      const region = decodeRegionFromToken(credentials.access);
      return models.map(m => ({
        ...m,
        baseUrl: `https://${region}.ai.corp.com/v1`
      }));
    }
  }
});
```

### 12.4 Custom Streaming API

Cho providers không chuẩn, implement `streamSimple`:

```typescript
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  calculateCost,
  createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";

function streamMyProvider(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      stream.push({ type: "start", partial: output });

      // Make API request, process response...
      // Push content events: text_start/delta/end, toolcall_start/delta/end

      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

// Đăng ký
pi.registerProvider("my-provider", {
  baseUrl: "https://api.example.com",
  apiKey: "MY_API_KEY",
  api: "my-custom-api",
  models: [...],
  streamSimple: streamMyProvider
});
```

---

## 13. State Management

Extensions có state nên lưu trong tool result `details` để hỗ trợ branching:

```typescript
export default function (pi: ExtensionAPI) {
  let items: string[] = [];

  // Reconstruct state từ session
  pi.on("session_start", async (_event, ctx) => {
    items = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult") {
        if (entry.message.toolName === "my_tool") {
          items = entry.message.details?.items ?? [];
        }
      }
    }
  });

  pi.registerTool({
    name: "my_tool",
    // ...
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      items.push("new item");
      return {
        content: [{ type: "text", text: "Added" }],
        details: { items: [...items] },  // Lưu cho reconstruction
      };
    },
  });
}
```

---

## 14. TUI Component System

### Component Interface

```typescript
interface Component {
  render(width: number): string[];  // Mỗi line ≤ width
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

### Built-in Components

| Component | Import | Mô tả |
|-----------|--------|--------|
| `Text` | `@mariozechner/pi-tui` | Multi-line text, word wrapping |
| `Box` | `@mariozechner/pi-tui` | Container với padding & background |
| `Container` | `@mariozechner/pi-tui` | Nhóm components theo chiều dọc |
| `Spacer` | `@mariozechner/pi-tui` | Khoảng trống |
| `Markdown` | `@mariozechner/pi-tui` | Render markdown + syntax highlighting |
| `Image` | `@mariozechner/pi-tui` | Hiển thị ảnh (Kitty, iTerm2, Ghostty) |
| `SelectList` | `@mariozechner/pi-tui` | Chọn từ danh sách |
| `SettingsList` | `@mariozechner/pi-tui` | Toggle settings |
| `DynamicBorder` | `@mariozechner/pi-coding-agent` | Border với theme |
| `BorderedLoader` | `@mariozechner/pi-coding-agent` | Async operation + cancel |

### Keyboard Input

```typescript
import { matchesKey, Key } from "@mariozechner/pi-tui";

handleInput(data: string) {
  if (matchesKey(data, Key.up)) { /* ... */ }
  if (matchesKey(data, Key.enter)) { /* ... */ }
  if (matchesKey(data, Key.escape)) { /* ... */ }
  if (matchesKey(data, Key.ctrl("c"))) { /* ... */ }
}
```

### Utilities

```typescript
import { visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

visibleWidth(str)              // Display width (bỏ ANSI codes)
truncateToWidth(str, width)    // Truncate với ellipsis
wrapTextWithAnsi(str, width)   // Word wrap giữ ANSI
```

### Pattern: Selection Dialog (SelectList)

```typescript
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";

pi.registerCommand("pick", {
  handler: async (_args, ctx) => {
    const items: SelectItem[] = [
      { value: "opt1", label: "Option 1", description: "First option" },
      { value: "opt2", label: "Option 2", description: "Second option" },
    ];

    const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold("Pick")), 1, 0));

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      });
      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);

      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

      return {
        render: (w) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data) => { selectList.handleInput(data); tui.requestRender(); },
      };
    });

    if (result) ctx.ui.notify(`Selected: ${result}`, "info");
  },
});
```

### Pattern: Async with Cancel (BorderedLoader)

```typescript
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
  const loader = new BorderedLoader(tui, theme, "Fetching data...");
  loader.onAbort = () => done(null);

  fetchData(loader.signal)
    .then((data) => done(data))
    .catch(() => done(null));

  return loader;
});
```

### Theme Invalidation

Components dùng theme colors phải rebuild khi `invalidate()` được gọi:

```typescript
class GoodComponent extends Container {
  private message: string;
  private content: Text;

  constructor(message: string) {
    super();
    this.message = message;
    this.content = new Text("", 1, 0);
    this.addChild(this.content);
    this.updateDisplay();
  }

  private updateDisplay(): void {
    this.content.setText(theme.fg("accent", this.message));
  }

  override invalidate(): void {
    super.invalidate();
    this.updateDisplay();  // Rebuild with new theme
  }
}
```

---

## 15. Error Handling & Mode Behavior

### Error Handling

- Extension errors → logged, agent tiếp tục chạy
- `tool_call` errors → block tool (fail-safe)
- Tool `execute` errors → throw để signal lỗi, caught và reported cho LLM

### Mode Behavior

| Mode | UI Methods | Ghi chú |
|------|-----------|---------|
| **Interactive** | Full TUI | Hoạt động bình thường |
| **RPC** (`--mode rpc`) | JSON protocol | Host handles UI |
| **JSON** (`--mode json`) | No-op | Event stream ra stdout |
| **Print** (`-p`) | No-op | Extensions chạy nhưng không thể prompt |

Kiểm tra `ctx.hasUI` trước khi dùng UI methods trong non-interactive modes.

---

## 16. Danh Sách Examples

Tất cả examples tại [examples/extensions/](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions).

### Tools

| Example | Mô tả |
|---------|--------|
| `hello.ts` | Minimal tool registration |
| `todo.ts` | Stateful tool với custom rendering |
| `tools.ts` | Tool enable/disable UI |
| `dynamic-tools.ts` | Register/unregister tools at runtime |
| `tool-override.ts` | Override built-in tools |
| `truncated-tool.ts` | Output truncation |
| `question.ts` | Tool hỏi user |
| `questionnaire.ts` | Multi-step wizard |
| `qna.ts` | Async tool với cancel (BorderedLoader) |

### Events & Interception

| Example | Mô tả |
|---------|--------|
| `confirm-destructive.ts` | Confirm trước dangerous commands |
| `permission-gate.ts` | Block tools theo rules |
| `protected-paths.ts` | Block writes vào paths cụ thể |
| `dirty-repo-guard.ts` | Warn khi repo có uncommitted changes |
| `input-transform.ts` | Transform user input |
| `pirate.ts` | Modify system prompt (pirate mode!) |
| `system-prompt-header.ts` | Add custom header vào system prompt |

### Session & State

| Example | Mô tả |
|---------|--------|
| `git-checkpoint.ts` | Git stash mỗi turn |
| `auto-commit-on-exit.ts` | Auto commit khi thoát |
| `custom-compaction.ts` | Custom compaction logic |
| `summarize.ts` | Conversation summaries |
| `bookmark.ts` | Label entries trong session tree |
| `session-name.ts` | Auto-name sessions |

### UI & Commands

| Example | Mô tả |
|---------|--------|
| `commands.ts` | Multiple commands |
| `preset.ts` | SelectList dialog |
| `status-line.ts` | Persistent status indicator |
| `custom-footer.ts` | Custom footer |
| `custom-header.ts` | Custom startup header |
| `widget-placement.ts` | Widgets above/below editor |
| `modal-editor.ts` | Vim-like modal editing |
| `rainbow-editor.ts` | Custom editor styling |
| `message-renderer.ts` | Custom message rendering |
| `model-status.ts` | Model change tracking |
| `titlebar-spinner.ts` | Terminal title animation |

### Providers

| Example | Mô tả |
|---------|--------|
| `custom-provider-anthropic/` | Custom Anthropic proxy |
| `custom-provider-gitlab-duo/` | GitLab Duo integration |
| `custom-provider-qwen-cli/` | Qwen CLI provider |
| `provider-payload.ts` | Debug provider payloads |

### Advanced

| Example | Mô tả |
|---------|--------|
| `subagent/` | Sub-agent orchestration (planner, worker, reviewer, scout) |
| `plan-mode/` | Full plan mode implementation |
| `ssh.ts` | SSH remote execution |
| `sandbox/` | Sandboxed execution |
| `handoff.ts` | Session handoff |
| `send-user-message.ts` | Programmatic user messages |
| `reload-runtime.ts` | Runtime reload tool |
| `dynamic-resources/` | Dynamic skills/prompts |
| `interactive-shell.ts` | Interactive shell tool |
| `inline-bash.ts` | Inline bash execution |
| `bash-spawn-hook.ts` | Bash spawn hook |
| `file-trigger.ts` | File watcher triggers |
| `event-bus.ts` | Inter-extension communication |
| `minimal-mode.ts` | Minimal UI mode |
| `notify.ts` | Desktop notifications |

### Games 🎮

| Example | Mô tả |
|---------|--------|
| `snake.ts` | Snake game |
| `space-invaders.ts` | Space Invaders |
| `doom-overlay/` | DOOM (qua overlay!) |

---

## Tham Khảo

- **Extensions docs:** [extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- **Custom providers:** [custom-provider.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)
- **TUI components:** [tui.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tui.md)
- **Keybindings:** [keybindings.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md)
- **Examples:** [examples/extensions/](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- **Packages:** [packages.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
