# 🔧 Pi — Tools Deep Dive

> Tài liệu chi tiết về hệ thống **Tools** trong Pi Coding Agent.
> Tổng hợp từ [official docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs), source code & extension examples.

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Tool vs Slash Command — Phân Biệt Rõ](#2-tool-vs-slash-command--phân-biệt-rõ)
- [3. Built-in Tools](#3-built-in-tools)
  - [3.1 read](#31-read)
  - [3.2 bash](#32-bash)
  - [3.3 edit](#33-edit)
  - [3.4 write](#34-write)
  - [3.5 grep](#35-grep)
  - [3.6 find](#36-find)
  - [3.7 ls](#37-ls)
- [4. Tool Lifecycle — Từ LLM Call Đến Kết Quả](#4-tool-lifecycle--từ-llm-call-đến-kết-quả)
- [5. Custom Tools — Viết Tool Riêng](#5-custom-tools--viết-tool-riêng)
  - [5.1 Tool Definition Interface](#51-tool-definition-interface)
  - [5.2 Ví Dụ Cơ Bản](#52-ví-dụ-cơ-bản)
  - [5.3 Streaming Progress](#53-streaming-progress)
  - [5.4 Error Handling](#54-error-handling)
  - [5.5 Output Truncation](#55-output-truncation)
  - [5.6 File Mutation Queue](#56-file-mutation-queue)
  - [5.7 Multiple Tools Shared State](#57-multiple-tools-shared-state)
  - [5.8 State Persistence](#58-state-persistence)
- [6. Override Built-in Tools](#6-override-built-in-tools)
- [7. Remote Execution](#7-remote-execution)
- [8. Custom Rendering](#8-custom-rendering)
  - [8.1 renderCall](#81-rendercall)
  - [8.2 renderResult](#82-renderresult)
- [9. Tool Management API](#9-tool-management-api)
- [10. Tool Events — Hooks](#10-tool-events--hooks)
  - [10.1 tool_call](#101-tool_call)
  - [10.2 tool_result](#102-tool_result)
  - [10.3 tool_execution_start/update/end](#103-tool_execution_startupdateend)
- [11. System Prompt Integration](#11-system-prompt-integration)
- [12. CLI Options](#12-cli-options)
- [13. Ví Dụ Extensions Hay](#13-ví-dụ-extensions-hay)

---

## 1. Tổng Quan

**Tools** là thứ mà LLM **tự gọi** mỗi turn để tương tác với hệ thống. Đây là cơ chế cốt lõi cho phép Pi agent thực sự *làm việc* — đọc file, chạy lệnh, sửa code.

```text
User: "Fix the bug in auth.ts"
        │
        ▼
LLM nhận prompt → suy nghĩ → quyết định gọi tools:
  1. read(path="src/auth.ts")              ← đọc file
  2. bash(command="npm test -- auth")      ← chạy test
  3. edit(path="src/auth.ts", ...)         ← sửa bug
  4. bash(command="npm test -- auth")      ← verify fix
        │
        ▼
LLM: "Done! Fixed the null check in validateToken()"
```

### Đặc điểm chính

| Đặc Điểm | Mô Tả |
|----------|--------|
| **LLM-triggered** | LLM tự quyết định gọi tool nào, khi nào |
| **Parallel execution** | Nhiều tool calls chạy đồng thời (mặc định) |
| **Extensible** | Thêm custom tools qua extensions (`registerTool`) |
| **Interceptable** | Event hooks cho phép block/modify tool calls |
| **Overridable** | Có thể ghi đè built-in tools |
| **Pluggable ops** | Backend operations có thể thay thế (local → SSH, container...) |

---

## 2. Tool vs Slash Command — Phân Biệt Rõ

| | Tool | Slash Command |
|---|------|--------------|
| **Ai trigger** | LLM tự gọi | User gõ `/` |
| **Khi nào chạy** | Mỗi turn, tự động | Khi user chủ động |
| **Đăng ký qua** | `pi.registerTool()` | `pi.registerCommand()` |
| **Trong system prompt** | ✅ Có (LLM biết tools nào available) | ❌ Không |
| **Ví dụ** | `read()`, `bash()`, `edit()` | `/model`, `/tree`, `/deploy` |
| **Return value** | `content` + `details` cho LLM | Không return cho LLM |

> **Quan trọng**: Một extension có thể đăng ký **cả tool lẫn command**. Extension là container, tool và command là hai thứ khác nhau bên trong.

---

## 3. Built-in Tools

Pi ship với **7 built-in tools**. Mặc định chỉ bật 4: `read`, `bash`, `edit`, `write`.

| Tool | Mặc Định | Mô Tả |
|------|----------|--------|
| **read** | ✅ On | Đọc file (text + images) |
| **bash** | ✅ On | Chạy shell commands |
| **edit** | ✅ On | Sửa file (exact string replacement) |
| **write** | ✅ On | Tạo/ghi đè file |
| **grep** | ❌ Off | Tìm kiếm nội dung file (regex) |
| **find** | ❌ Off | Tìm file theo glob pattern |
| **ls** | ❌ Off | Liệt kê thư mục |

> `grep`, `find`, `ls` off mặc định vì LLM có thể làm tương tự bằng `bash`. Bật chúng cho read-only sub-agents hoặc sandbox environments.

### 3.1 read

Đọc nội dung file. Hỗ trợ text và images (jpg, png, gif, webp).

**Parameters:**

```typescript
{
  path: string;    // Đường dẫn file (tương đối hoặc tuyệt đối)
  offset?: number; // Dòng bắt đầu (1-indexed)
  limit?: number;  // Số dòng tối đa
}
```

**Hành vi:**

- Output thêm **line numbers** (1-indexed)
- Tự truncate: **2000 dòng** hoặc **50KB** (whichever hit first)
- Nếu truncated → thông báo `[Use offset=N to continue]`
- Binary files → phát hiện và báo lỗi
- Images → resize tự động, gửi base64 cho LLM
- Normalize `@` prefix (một số model thêm `@` trước path)

**System prompt guideline:**

> *"Use read to examine files instead of cat or sed."*

**Ví dụ LLM gọi:**

```text
read(path="src/auth.ts")
read(path="src/auth.ts", offset=100, limit=50)  ← đọc dòng 100-149
read(path="screenshot.png")                     ← gửi image cho LLM
```

### 3.2 bash

Chạy shell commands trong working directory.

**Parameters:**

```typescript
{
  command: string;   // Lệnh shell
  timeout?: number;  // Timeout (ms), mặc định 120000 (2 phút)
}
```

**Hành vi:**

- Stream combined **stdout + stderr**
- Truncate output: **2000 dòng** hoặc **50KB** (giữ phần cuối — `truncateTail`)
- Nếu truncated → lưu full output vào temp file, thông báo path
- Process tree cleanup on abort (Ctrl+C)
- Shell config: dùng `$SHELL` hoặc `/bin/bash`
- Tự strip ANSI codes khỏi output gửi cho LLM
- Detect interactive commands (vim, nano) → cảnh báo

**System prompt guidelines:**

> - *"Always use flags for non-interactive execution"*
> - *"NEVER use read tool to read command output — use bash"*
> - *"NEVER start long-running processes using bash (servers, watchers...)"*

**Timeout handling:**

```text
bash(command="npm test", timeout=60000)
→ Nếu chạy quá 60s → kill process → return error
```

### 3.3 edit

Sửa file bằng **exact string replacement**.

**Parameters:**

```typescript
{
  path: string;      // File cần sửa
  oldString: string; // String cần thay thế (exact match)
  newString: string; // String thay thế
  replaceAll?: boolean; // true = thay tất cả occurrences
}
```

**Hành vi:**

- `oldString` **phải tồn tại exactly** trong file
- Nếu `oldString` xuất hiện nhiều hơn 1 lần mà không có `replaceAll` → **fail**
- Nếu `oldString` không tồn tại → **fail** với error message
- Preserves: file encoding, line endings (CRLF/LF)
- Returns: **diff** cho verification
- Participates in **file mutation queue** (tránh race condition khi parallel)

**System prompt guidelines:**

> - *"NEVER use find-and-replace as a substitute for understanding code"*
> - *"When making multiple edits, order them so later edits don't affect earlier matches"*

### 3.4 write

Tạo hoặc ghi đè file.

**Parameters:**

```typescript
{
  path: string;     // Đường dẫn file
  content: string;  // Nội dung
}
```

**Hành vi:**

- **Tự tạo parent directories** (`mkdir -p`)
- **Ghi đè** nếu file đã tồn tại (không cảnh báo)
- Returns: confirmation + file size
- Participates in **file mutation queue**

**System prompt guidelines:**

> - *"Use write for new files, edit for existing files"*
> - *"NEVER write a file without reading it first unless creating a new file"*

### 3.5 grep

Tìm kiếm nội dung file bằng regex.

**Parameters:**

```typescript
{
  pattern: string;        // Regex pattern
  path?: string;          // Directory hoặc file (mặc định: cwd)
  glob?: string;          // File filter (VD: "*.ts")
  caseInsensitive?: boolean;
  literal?: boolean;      // Treat pattern as literal string
  contextBefore?: number; // Lines before match
  contextAfter?: number;  // Lines after match
  limit?: number;         // Max results
}
```

### 3.6 find

Tìm file theo glob pattern.

**Parameters:**

```typescript
{
  pattern: string;   // Glob pattern (VD: "*.ts", "**/test_*")
  searchRoot?: string; // Thư mục gốc (mặc định: cwd)
}
```

### 3.7 ls

Liệt kê thư mục.

**Parameters:**

```typescript
{
  path?: string;    // Thư mục (mặc định: cwd)
  limit?: number;   // Giới hạn kết quả
}
```

---

## 4. Tool Lifecycle — Từ LLM Call Đến Kết Quả

```text
LLM response chứa tool calls
        │
        ▼
   ┌─ tool_execution_start (event)
   │
   ├─ tool_call (event) ←── Extension có thể BLOCK ở đây
   │   │
   │   ├─ Blocked? → Return error cho LLM
   │   │
   │   └─ OK? → Execute tool
   │       │
   │       ├─ tool_execution_update (event, streaming)
   │       │
   │       └─ Return result
   │
   ├─ tool_result (event) ←── Extension có thể MODIFY result
   │
   └─ tool_execution_end (event)
        │
        ▼
   Result gửi cho LLM → LLM quyết định tiếp
```

### Parallel vs Sequential

Mặc định, tool calls trong **cùng một assistant message** chạy **song song**:

```text
LLM gọi 3 tools cùng lúc:
  ┌─ read("a.ts")     ─────────────────────────► done
  ├─ read("b.ts")     ──────────► done
  └─ bash("npm test") ──────────────────────────────────► done

Nhưng tool_call events fire TUẦN TỰ (preflight):
  tool_call("read", "a.ts") → OK
  tool_call("read", "b.ts") → OK
  tool_call("bash", "npm test") → OK
  → Rồi mới execute song song
```

### File Mutation Queue

`edit` và `write` dùng **per-file queue** để tránh race condition:

```text
LLM gọi cùng lúc:
  edit("foo.ts", old="a", new="b")
  edit("foo.ts", old="c", new="d")

Không có queue:
  Cả hai đọc foo.ts gốc → apply → write lần cuối thắng → MẤT THAY ĐỔI!

Có queue:
  Edit 1 đọc → sửa → write → Edit 2 đọc (file đã updated) → sửa → write → OK!
```

---

## 5. Custom Tools — Viết Tool Riêng

### 5.1 Tool Definition Interface

```typescript
interface ToolDefinition<TParams, TDetails> {
  name: string;              // Tool name (LLM gọi bằng tên này)
  label: string;             // Display name trong TUI
  description: string;       // Mô tả cho LLM (quan trọng!)
  parameters: TObject;       // JSON Schema (dùng TypeBox)

  // System prompt integration (tùy chọn)
  promptSnippet?: string;    // One-liner trong "Available tools"
  promptGuidelines?: string[]; // Guidelines khi tool active

  // Core
  execute(
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: (partial: ToolResult) => void,
    ctx?: ExtensionContext,
  ): Promise<ToolResult<TDetails>>;

  // Custom rendering (tùy chọn)
  renderCall?(args, theme, context): Component;
  renderResult?(result, options, theme, context): Component;
}

interface ToolResult<TDetails = unknown> {
  content: ContentBlock[];     // Gửi cho LLM
  details?: TDetails;          // Cho rendering & state (KHÔNG gửi cho LLM)
  isError?: boolean;           // Tự set bởi Pi khi throw error
}
```

### 5.2 Ví Dụ Cơ Bản

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Manage a project todo list. Use action 'list' or 'add'.",
    promptSnippet: "List or add items in the project todo list",
    promptGuidelines: [
      "Use this tool for task tracking instead of writing todo files directly."
    ],
    parameters: Type.Object({
      action: StringEnum(["list", "add"] as const),
      text: Type.Optional(Type.String({ description: "Item to add" })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (params.action === "list") {
        return {
          content: [{ type: "text", text: "1. Fix auth\n2. Add tests" }],
          details: { items: ["Fix auth", "Add tests"] },
        };
      }

      return {
        content: [{ type: "text", text: `Added: ${params.text}` }],
        details: { added: params.text },
      };
    },
  });
}
```

> ⚠️ **Quan trọng**: Dùng `StringEnum` từ `@mariozechner/pi-ai` cho enum parameters. `Type.Union`/`Type.Literal` không tương thích với Google's API.

### 5.3 Streaming Progress

Tool có thể stream updates trong khi đang execute:

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  onUpdate?.({
    content: [{ type: "text", text: "Step 1: Fetching data..." }],
    details: { progress: 25 },
  });

  const data = await fetchData();

  onUpdate?.({
    content: [{ type: "text", text: "Step 2: Processing..." }],
    details: { progress: 75 },
  });

  const result = process(data);

  return {
    content: [{ type: "text", text: `Done: ${result}` }],
    details: { progress: 100, result },
  };
}
```

### 5.4 Error Handling

**Throw error** để signal failure. Đừng return `isError: true` — Pi tự set khi catch exception:

```typescript
async execute(toolCallId, params) {
  // ✅ Correct: throw để signal error
  if (!isValid(params.input)) {
    throw new Error(`Invalid input: ${params.input}`);
  }

  // ❌ Wrong: return isError không có tác dụng
  // return { content: [...], isError: true }; // Pi bỏ qua

  return {
    content: [{ type: "text", text: "OK" }],
    details: {},
  };
}
```

**Abort handling:**

```typescript
async execute(toolCallId, params, signal) {
  if (signal?.aborted) {
    return { content: [{ type: "text", text: "Cancelled" }] };
  }

  // Truyền signal cho async operations
  const result = await pi.exec("long-command", [], { signal });
  return { content: [{ type: "text", text: result.stdout }] };
}
```

### 5.5 Output Truncation

Tools **PHẢI truncate output** để tránh context overflow. Pi cung cấp utilities:

```typescript
import {
  truncateHead,       // Giữ phần ĐẦU (cho file reads, search results)
  truncateTail,       // Giữ phần CUỐI (cho logs, command output)
  truncateLine,       // Truncate single line
  formatSize,         // "50KB", "1.5MB"
  DEFAULT_MAX_BYTES,  // 50KB (50 * 1024)
  DEFAULT_MAX_LINES,  // 2000
} from "@mariozechner/pi-coding-agent";

async execute(toolCallId, params, signal, onUpdate, ctx) {
  const output = await runCommand();

  const truncation = truncateTail(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let result = truncation.content;

  if (truncation.truncated) {
    const tempFile = writeTempFile(output);
    result += `\n\n[Output truncated: ${truncation.outputLines}`;
    result += ` of ${truncation.totalLines} lines`;
    result += ` (${formatSize(truncation.outputBytes)}`;
    result += ` of ${formatSize(truncation.totalBytes)}).`;
    result += ` Full output: ${tempFile}]`;
  }

  return {
    content: [{ type: "text", text: result }],
    details: { truncation }, // Cho rendering
  };
}
```

| Hàm | Dùng khi |
|-----|---------|
| `truncateHead` | Phần đầu quan trọng (file reads, search) |
| `truncateTail` | Phần cuối quan trọng (logs, command output) |
| `truncateLine` | Single line quá dài |

### 5.6 File Mutation Queue

Nếu custom tool **sửa file**, dùng `withFileMutationQueue()`:

```typescript
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async execute(toolCallId, params, signal, onUpdate, ctx) {
  const absolutePath = resolve(ctx.cwd, params.path);

  // Queue TOÀN BỘ read-modify-write cycle
  return withFileMutationQueue(absolutePath, async () => {
    const current = await readFile(absolutePath, "utf8");
    const updated = current.replace(params.oldText, params.newText);
    await writeFile(absolutePath, updated, "utf8");

    return {
      content: [{ type: "text", text: `Updated ${params.path}` }],
      details: {},
    };
  });
}
```

> **Tại sao cần?** Tool calls chạy song song. Không có queue → 2 edits cùng file → read cùng version cũ → write cuối cùng thắng → mất thay đổi.

### 5.7 Multiple Tools Shared State

Một extension có thể register nhiều tools dùng chung state:

```typescript
export default function (pi: ExtensionAPI) {
  let connection: DBConnection | null = null;

  pi.registerTool({
    name: "db_connect",
    description: "Connect to database",
    parameters: Type.Object({ url: Type.String() }),
    async execute(id, params) {
      connection = await connect(params.url);
      return { content: [{ type: "text", text: "Connected" }] };
    },
  });

  pi.registerTool({
    name: "db_query",
    description: "Run SQL query",
    parameters: Type.Object({ sql: Type.String() }),
    async execute(id, params) {
      if (!connection) throw new Error("Not connected");
      const rows = await connection.query(params.sql);
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  });

  pi.registerTool({
    name: "db_close",
    description: "Close database connection",
    parameters: Type.Object({}),
    async execute() {
      await connection?.close();
      connection = null;
      return { content: [{ type: "text", text: "Disconnected" }] };
    },
  });

  // Cleanup on session end
  pi.on("session_shutdown", async () => {
    await connection?.close();
  });
}
```

### 5.8 State Persistence

Lưu state trong `details` field → reconstruct từ session entries:

```typescript
export default function (pi: ExtensionAPI) {
  let items: string[] = [];

  // Reconstruct state khi load session
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
    async execute(toolCallId, params) {
      items.push(params.text);
      return {
        content: [{ type: "text", text: "Added" }],
        details: { items: [...items] },  // Lưu cho reconstruction
      };
    },
  });
}
```

> **Tại sao dùng `details`?** Vì `details` được lưu trong session file (JSONL) nhưng **KHÔNG gửi cho LLM** → không tốn context tokens.

---

## 6. Override Built-in Tools

Extension có thể **ghi đè** built-in tools bằng cách register cùng tên:

```typescript
import { createReadTool } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const originalRead = createReadTool(process.cwd());

  pi.registerTool({
    ...originalRead,
    name: "read",  // Cùng tên → override
    async execute(id, params, signal, onUpdate, ctx) {
      // Logging
      console.log(`📖 Reading: ${params.path}`);

      // Access control
      if (params.path.includes(".env")) {
        throw new Error("Access denied: .env files are protected");
      }

      // Delegate cho original
      return originalRead.execute(id, params, signal, onUpdate);
    },
  });
}
```

**Quy tắc override:**

| Aspect | Hành vi |
|--------|---------|
| **Rendering** | `renderCall`/`renderResult` independent — bỏ slot nào thì built-in renderer slot đó được dùng |
| **Prompt metadata** | `promptSnippet`/`promptGuidelines` **KHÔNG** kế thừa — phải define lại |
| **Result shape** | **PHẢI match exact** `details` type — UI/session logic phụ thuộc |
| **Warning** | Interactive mode hiện warning khi tool bị override |

```bash
# Override read tool
pi -e ./tool-override.ts

# Hoặc: bỏ hết built-in, chỉ dùng extension tools
pi --no-tools -e ./my-extension.ts
```

---

## 7. Remote Execution

Built-in tools hỗ trợ **pluggable operations** để delegate sang remote systems:

```typescript
import {
  createReadTool,
  createBashTool,
  type ReadOperations,
  type BashOperations,
} from "@mariozechner/pi-coding-agent";

// SSH remote read
const remoteRead = createReadTool(remoteCwd, {
  operations: {
    readFile: (path) => sshExec(remote, `cat ${path}`),
    access: (path) => sshExec(remote, `test -r ${path}`).then(() => {}),
  }
});

// Bash với spawn hook (adjust command/cwd/env)
const sandboxBash = createBashTool(cwd, {
  spawnHook: ({ command, cwd, env }) => ({
    command: `source ~/.profile\n${command}`,
    cwd: `/mnt/sandbox${cwd}`,
    env: { ...env, CI: "1" },
  }),
});
```

**Operations interfaces:**

| Interface | Tool |
|-----------|------|
| `ReadOperations` | read |
| `WriteOperations` | write |
| `EditOperations` | edit |
| `BashOperations` | bash |
| `LsOperations` | ls |
| `GrepOperations` | grep |
| `FindOperations` | find |

**Ví dụ SSH pattern:**

```typescript
pi.registerTool({
  ...remoteRead,
  async execute(id, params, signal, onUpdate) {
    const ssh = getSshConfig();
    if (ssh) {
      const tool = createReadTool(cwd, {
        operations: createRemoteOps(ssh)
      });
      return tool.execute(id, params, signal, onUpdate);
    }
    // Fallback local
    return localRead.execute(id, params, signal, onUpdate);
  },
});
```

---

## 8. Custom Rendering

Tools có thể customize cách hiển thị trong TUI.

### 8.1 renderCall

Render header/title khi tool được gọi:

```typescript
import { Text } from "@mariozechner/pi-tui";

renderCall(args, theme, context) {
  const text = (context.lastComponent as Text | undefined)
    ?? new Text("", 0, 0);

  let content = theme.fg("toolTitle", theme.bold("my_tool "));
  content += theme.fg("muted", args.action);
  if (args.text) {
    content += " " + theme.fg("dim", `"${args.text}"`);
  }
  text.setText(content);
  return text;
}
```

### 8.2 renderResult

Render output/result:

```typescript
renderResult(result, { expanded, isPartial }, theme, context) {
  if (isPartial) {
    return new Text(theme.fg("warning", "Processing..."), 0, 0);
  }

  let text = theme.fg("success", "✓ Done");

  // Expanded view: show details
  if (expanded && result.details?.items) {
    for (const item of result.details.items) {
      text += "\n  " + theme.fg("dim", item);
    }
  }

  return new Text(text, 0, 0);
}
```

**Context object:**

| Property | Mô Tả |
|----------|--------|
| `context.args` | Tool call arguments |
| `context.state` | Shared state giữa renderCall và renderResult |
| `context.lastComponent` | Component trước đó (để reuse) |
| `context.invalidate()` | Request rerender |
| `context.expanded` | User đã expand chưa |
| `context.isPartial` | Đang streaming |
| `context.isError` | Tool failed |
| `context.showImages` | Terminal hỗ trợ inline images |

**Best practices:**

- Padding `(0, 0)` — Box wrapper xử lý padding
- Handle `isPartial` cho streaming progress
- Support `expanded` cho detail on demand
- Reuse `context.lastComponent` thay vì tạo mới
- Dùng `context.state` cho shared data giữa call/result slots

---

## 9. Tool Management API

Extensions có thể quản lý tools at runtime:

```typescript
// Lấy danh sách
const active = pi.getActiveTools();   // Tools đang bật
const all = pi.getAllTools();         // Tất cả (bật + tắt)

// Filter theo source
const builtins = all.filter(t => t.sourceInfo.source === "builtin");
const extensions = all.filter(t =>
  t.sourceInfo.source !== "builtin" && t.sourceInfo.source !== "sdk"
);

// Enable/disable tools at runtime
pi.setActiveTools(["read", "bash"]);           // Read-only mode
pi.setActiveTools(["read", "bash", "my_tool"]); // Add custom tool
```

**Dynamic tool registration** (sau startup):

```typescript
pi.registerTool({...}); // Có thể gọi bất kì lúc nào!
// - Trong session_start handler
// - Trong command handler
// - Trong event handler
// Tools xuất hiện ngay không cần /reload
```

---

## 10. Tool Events — Hooks

### 10.1 tool_call

Fired **trước** tool execute. Có thể **BLOCK**.

```typescript
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input

  // Type-safe checking cho built-in tools
  if (isToolCallEventType("bash", event)) {
    // event.input typed: { command: string; timeout?: number }
    if (event.input.command.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("⚠️ Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  }

  if (isToolCallEventType("write", event)) {
    // event.input typed: { path: string; content: string }
    if (event.input.path.endsWith(".env")) {
      return { block: true, reason: "Cannot write to .env" };
    }
  }
});
```

**Typing custom tool input:**

```typescript
// Export type từ extension
export type MyToolInput = Static<typeof myToolSchema>;

// Dùng trong tool_call handler
pi.on("tool_call", (event) => {
  if (isToolCallEventType<"my_tool", MyToolInput>("my_tool", event)) {
    event.input.action; // typed!
  }
});
```

### 10.2 tool_result

Fired **sau** tool execute. Có thể **MODIFY result**.

```typescript
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input
  // event.content, event.details, event.isError

  if (isBashToolResult(event)) {
    // event.details typed as BashToolDetails
  }

  // Modify result (partial patch — omitted fields unchanged)
  return {
    content: [...event.content, { type: "text", text: "\n[Reviewed ✓]" }],
  };
});
```

**Handler chaining:** Handlers chạy theo extension load order. Mỗi handler thấy result sau khi handler trước modify.

### 10.3 tool_execution_start/update/end

Events cho lifecycle tracking (không thể modify):

```text
tool_execution_start → tool đang bắt đầu chạy
tool_execution_update → streaming progress
tool_execution_end → tool xong
```

---

## 11. System Prompt Integration

Pi inject tool info vào system prompt 2 cách:

### Available tools section:

```text
Available tools:
- read: Read file contents
- bash: Run shell command
- edit: Edit files
- write: Create/overwrite files
- my_tool: List or add items in the project todo list  ← promptSnippet
```

### Guidelines section:

```text
Guidelines:
- Use read to examine files instead of cat or sed.
- Use this tool for todo planning instead                ← promptGuidelines
  of direct file edits when the user asks for a task list.
```

**Custom tool không có `promptSnippet`** → không xuất hiện trong "Available tools" nhưng vẫn callable.

---

## 12. CLI Options

```bash
# Bật tools cụ thể
pi --tools read,bash,edit,write,grep,find,ls

# Tắt tất cả built-in tools
pi --no-tools

# Chỉ dùng extension tools
pi --no-tools -e ./my-extension.ts

# Load extension khi startup
pi -e ./my-extension.ts
```

**Settings:**

```json
{
  "tools": ["read", "bash", "edit", "write"]
}
```

---

## 13. Ví Dụ Extensions Hay

| File | Mô Tả | Key APIs |
|------|--------|----------|
| `hello.ts` | Tool tối giản | `registerTool` |
| `question.ts` | Tool với user interaction | `registerTool`, `ui.select` |
| `todo.ts` | Stateful tool với persistence | `registerTool`, `appendEntry`, session events |
| `dynamic-tools.ts` | Register tools sau startup | `registerTool`, `session_start` |
| `truncated-tool.ts` | Output truncation | `registerTool`, `truncateHead` |
| `tool-override.ts` | Override built-in read | `registerTool` (same name) |
| `permission-gate.ts` | Block dangerous commands | `on("tool_call")`, `ui.confirm` |
| `protected-paths.ts` | Block writes to paths | `on("tool_call")` |
| `ssh.ts` | SSH remote execution | `registerFlag`, `on("user_bash")` |
| `interactive-shell.ts` | Persistent shell session | `on("user_bash")` |
| `bash-spawn-hook.ts` | Adjust bash command/cwd/env | `createBashTool`, `spawnHook` |
| `subagent/` | Spawn sub-agents | `registerTool`, `exec` |
| `sandbox/` | Sandboxed tool execution | Tool operations |

Source code: [`examples/extensions/`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)

---

## Tham Khảo

- [Extensions docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) — Custom Tools section
- [Source: read.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/read.ts)
- [Source: bash.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/bash.ts)
- [Source: edit.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/edit.ts)
- [Source: write.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/write.ts)
- [Source: grep.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/grep.ts)
- [Source: find.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/find.ts)
- [Source: ls.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/ls.ts)
- [Extension examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
