# Hướng Dẫn Tool System — Claude Code Source Code

> Phân tích source code từ `claude/src/tools/` — kiến trúc, danh sách tools, cách hoạt động, và patterns thiết kế.

---

## 1. Kiến Trúc Tổng Quan

### 1.1. Core Files

| File | Vai trò |
|------|---------|
| `src/Tool.ts` | Định nghĩa `Tool` interface, `ToolUseContext`, `buildTool()` factory |
| `src/tools.ts` | Registry — `getAllBaseTools()`, `getTools()`, `assembleToolPool()` |
| `src/tools/` | Thư mục chứa từng tool, mỗi tool 1 folder riêng |

### 1.2. Tool Interface (`Tool<Input, Output, Progress>`)

Mỗi tool implement interface `Tool` với các thành phần chính:

```
Tool {
  name: string                    // Tên unique (vd: "Bash", "Read", "Edit")
  description(): Promise<string>  // Mô tả cho LLM
  prompt?(): Promise<string>      // System prompt bổ sung
  inputSchema: ZodSchema          // Zod v4 schema cho input
  outputSchema: ZodSchema         // Zod v4 schema cho output

  // Lifecycle
  call(input, context): Promise<Output>   // Logic chính
  validateInput?(input): ValidationResult // Validate trước khi chạy
  checkPermissions(input, ctx): Promise<PermissionResult>

  // Metadata flags
  isEnabled(): boolean            // Tool có available không
  isReadOnly(input?): boolean     // Có modify filesystem không
  isConcurrencySafe(input?): boolean  // Có thể chạy song song không
  isDestructive(input?): boolean  // Có phá hủy data không

  // UI Rendering (React/Ink)
  renderToolUseMessage(input)             // Hiển thị khi tool được gọi
  renderToolResultMessage(output)         // Hiển thị kết quả
  renderToolUseProgressMessage?(progress) // Hiển thị progress
  renderToolUseErrorMessage?(error)       // Hiển thị lỗi
  renderToolUseRejectedMessage?(input)    // Hiển thị khi bị reject permission
}
```

### 1.3. `buildTool()` Factory

Mọi tool đều dùng `buildTool()` để tạo — function này **merge defaults** (fail-closed):

```typescript
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: () => false,   // Assume NOT safe
  isReadOnly: () => false,          // Assume writes
  isDestructive: () => false,
  checkPermissions: () => ({ behavior: 'allow', updatedInput: input }),
  toAutoClassifierInput: () => '',
  userFacingName: () => name,
}
```

### 1.4. Cấu Trúc Folder Mỗi Tool

Mỗi tool theo pattern nhất quán:

```
ToolName/
├── ToolName.ts (hoặc .tsx)  # Logic chính + buildTool()
├── prompt.ts                # Tool name constant + description/prompt text
├── constants.ts             # Constants (tool name, error messages)
├── types.ts                 # Zod schemas cho input/output
├── UI.tsx                   # React components render
└── utils.ts                 # Helper functions
```

---

## 2. Danh Sách Tools

### 2.1. 🔧 Core Tools (Luôn Available)

| Tool | File | Mô tả | Read-Only | Concurrent |
|------|------|--------|-----------|------------|
| **BashTool** | `BashTool.tsx` | Chạy shell commands, timeout configurable, sandbox support | ❌ | ❌ |
| **FileReadTool** | `FileReadTool.ts` | Đọc file (text, image, PDF, notebook), hỗ trợ range | ✅ | ✅ |
| **FileEditTool** | `FileEditTool.ts` | Sửa file bằng search-and-replace (old_str → new_str) | ❌ | ❌ |
| **FileWriteTool** | `FileWriteTool.ts` | Tạo file mới hoặc overwrite toàn bộ file | ❌ | ❌ |
| **GlobTool** | `GlobTool.ts` | Tìm file theo glob pattern (dùng fast-glob) | ✅ | ✅ |
| **GrepTool** | `GrepTool.ts` | Tìm text trong file bằng ripgrep (regex support) | ✅ | ✅ |

### 2.2. 🤖 Agent & Task Tools

| Tool | File | Mô tả |
|------|------|--------|
| **AgentTool** | `AgentTool.tsx` | Spawn sub-agent (Task tool) — chạy foreground/background, hỗ trợ worktree isolation, remote execution |
| **TaskCreateTool** | `TaskCreateTool.ts` | Tạo task trong task list (Todo v2 system) |
| **TaskGetTool** | `TaskGetTool.ts` | Lấy thông tin 1 task |
| **TaskUpdateTool** | `TaskUpdateTool.ts` | Cập nhật status/description task |
| **TaskListTool** | `TaskListTool.ts` | Liệt kê tất cả tasks |
| **TaskStopTool** | `TaskStopTool.ts` | Dừng task/agent đang chạy |
| **TaskOutputTool** | `TaskOutputTool.ts` | Đọc output từ background agent task |
| **TodoWriteTool** | `TodoWriteTool.ts` | Quản lý todo list trong session (legacy, thay bởi Task v2) |

### 2.3. 🌐 Web Tools

| Tool | File | Mô tả |
|------|------|--------|
| **WebSearchTool** | `WebSearchTool.ts` | Tìm kiếm web qua Anthropic's web_search API (beta) |
| **WebFetchTool** | `WebFetchTool.ts` | Fetch URL → convert HTML thành Markdown → apply prompt |

### 2.4. 🧠 Intelligence Tools

| Tool | File | Mô tả |
|------|------|--------|
| **SkillTool** | `SkillTool.ts` | Load và chạy skills (CLAUDE.md commands, plugin skills, MCP prompts). Có thể fork sub-agent với model override |
| **ToolSearchTool** | `ToolSearchTool.ts` | Tìm tool phù hợp khi có quá nhiều tools (deferred loading) |
| **LSPTool** | `LSPTool.ts` | Language Server Protocol — go-to-definition, find-references, hover, document-symbols, call-hierarchy |

### 2.5. 🔌 MCP Tools

| Tool | File | Mô tả |
|------|------|--------|
| **MCPTool** | `MCPTool.ts` | Wrapper generic cho bất kỳ MCP tool nào (dynamic) |
| **ListMcpResourcesTool** | `ListMcpResourcesTool.ts` | Liệt kê MCP resources available |
| **ReadMcpResourceTool** | `ReadMcpResourceTool.ts` | Đọc 1 MCP resource |

### 2.6. 📋 Mode & Flow Control Tools

| Tool | File | Mô tả |
|------|------|--------|
| **EnterPlanModeTool** | `EnterPlanModeTool.ts` | Chuyển sang plan mode (chỉ đọc, thiết kế trước khi code) |
| **ExitPlanModeV2Tool** | `ExitPlanModeTool/` | Thoát plan mode, quay về execution |
| **EnterWorktreeTool** | `EnterWorktreeTool.ts` | Tạo git worktree isolated cho session |
| **ExitWorktreeTool** | `ExitWorktreeTool.ts` | Thoát worktree, merge changes |
| **BriefTool** | `BriefTool.ts` | Gửi message cho user với attachments (proactive notifications) |
| **AskUserQuestionTool** | `AskUserQuestionTool/` | Hỏi user 1 câu hỏi (interactive) |

### 2.7. 👥 Multi-Agent / Swarm Tools

| Tool | File | Mô tả |
|------|------|--------|
| **TeamCreateTool** | `TeamCreateTool.ts` | Tạo team mới (agent swarms) |
| **TeamDeleteTool** | `TeamDeleteTool.ts` | Xóa team |
| **SendMessageTool** | `SendMessageTool.ts` | Gửi message giữa agents trong team (mailbox system) |

### 2.8. 📓 Specialized Tools

| Tool | File | Mô tả |
|------|------|--------|
| **NotebookEditTool** | `NotebookEditTool.ts` | Sửa Jupyter Notebook (.ipynb) — insert/edit/delete cells |
| **PowerShellTool** | `PowerShellTool.tsx` | Chạy PowerShell commands (Windows) |
| **ConfigTool** | `ConfigTool.ts` | Quản lý Claude Code config (ant-only) |

### 2.9. 🔒 Feature-Gated Tools (Conditional)

Các tool chỉ available khi feature flag bật:

| Tool | Feature Gate | Mô tả |
|------|-------------|--------|
| **SleepTool** | `PROACTIVE` / `KAIROS` | Agent tự sleep rồi wake up |
| **CronCreate/Delete/ListTool** | `AGENT_TRIGGERS` | Schedule cron jobs |
| **RemoteTriggerTool** | `AGENT_TRIGGERS_REMOTE` | Remote trigger agent |
| **REPLTool** | ant-only | VM-based REPL wrapping Bash/Read/Edit |
| **WebBrowserTool** | `WEB_BROWSER_TOOL` | Browser automation |
| **SnipTool** | `HISTORY_SNIP` | Snip history context |
| **WorkflowTool** | `WORKFLOW_SCRIPTS` | Run workflow scripts |

---

## 3. Permission System

### 3.1. Permission Flow

```
User gọi tool
  → validateInput()        // Schema validation
  → checkPermissions()     // Tool-specific permission check
  → Permission Context     // Global deny/allow rules
  → User prompt (nếu cần)  // Interactive approval
  → call()                 // Execute
```

### 3.2. PermissionResult Types

```typescript
type PermissionResult =
  | { behavior: 'allow', updatedInput }     // Cho phép
  | { behavior: 'deny', message }           // Từ chối
  | { behavior: 'ask', message, options }   // Hỏi user
```

### 3.3. Tool Filtering

```typescript
// Deny rules filter tools TRƯỚC KHI model thấy chúng
filterToolsByDenyRules(tools, permissionContext)

// Simple mode: chỉ Bash + Read + Edit
if (CLAUDE_CODE_SIMPLE) → [BashTool, FileReadTool, FileEditTool]

// REPL mode: ẩn primitive tools, chỉ show REPLTool
if (REPL_MODE) → filter out REPL_ONLY_TOOLS
```

---

## 4. Tool Registration Flow

```
tools.ts::getAllBaseTools()
  ├── Core tools (always included)
  ├── Feature-gated tools (conditional require)
  ├── Environment-gated tools (process.env checks)
  └── Lazy-loaded tools (circular dependency breaking)

↓

tools.ts::getTools(permissionContext)
  ├── filterToolsByDenyRules()
  ├── REPL mode filtering
  └── isEnabled() check

↓

tools.ts::assembleToolPool(permissionContext, mcpTools)
  ├── Built-in tools (sorted, prefix)
  ├── MCP tools (sorted, suffix)
  └── Deduplicate by name (built-in wins)
```

---

## 5. Patterns & Best Practices Từ Source Code

### 5.1. Lazy Schema Pattern

Tất cả tools dùng `lazySchema()` để tránh evaluate Zod schema tại module load time:

```typescript
const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('...'),
    content: z.string().describe('...'),
  })
)
```

### 5.2. Tool File Organization

Mỗi tool tách biệt **logic** (`ToolName.ts`) và **UI** (`UI.tsx`):
- Logic: `call()`, `checkPermissions()`, `validateInput()`
- UI: `renderToolUseMessage()`, `renderToolResultMessage()`, etc.

### 5.3. Fail-Closed Defaults

`buildTool()` mặc định **an toàn nhất**:
- `isConcurrencySafe = false` → Không chạy song song
- `isReadOnly = false` → Assume tool ghi file
- `checkPermissions = allow` → Delegate cho permission system

### 5.4. Feature Gating Pattern

Dùng `bun:bundle` feature flags + conditional `require()` để **dead code elimination**:

```typescript
import { feature } from 'bun:bundle'

const SleepTool = feature('PROACTIVE')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null
```

### 5.5. Tool Use Context

`ToolUseContext` cung cấp runtime context cho tool:

| Field | Mô tả |
|-------|--------|
| `options.tools` | Tất cả tools available |
| `options.mcpClients` | MCP server connections |
| `abortController` | Abort signal cho cancellation |
| `readFileState` | File state cache (LRU) |
| `getAppState()` | Global app state |
| `messages` | Conversation history |
| `agentId?` | ID nếu đang trong sub-agent |
| `permissionContext` | Permission rules |

---

## 6. Sơ Đồ Kiến Trúc

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code Agent                     │
│                                                          │
│  ┌─────────┐    ┌──────────┐    ┌─────────────────────┐ │
│  │ tools.ts │───▶│ Tool.ts  │───▶│ Permission System   │ │
│  │ Registry │    │ Interface│    │ (deny/allow/ask)     │ │
│  └────┬─────┘    └──────────┘    └─────────────────────┘ │
│       │                                                   │
│       ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │               Built-in Tools                         │ │
│  │                                                       │ │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ │ │
│  │  │  Bash   │ │ FileRead │ │FileEdit │ │FileWrite │ │ │
│  │  └─────────┘ └──────────┘ └─────────┘ └──────────┘ │ │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ │ │
│  │  │  Glob   │ │  Grep    │ │  Agent  │ │  Skill   │ │ │
│  │  └─────────┘ └──────────┘ └─────────┘ └──────────┘ │ │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ │ │
│  │  │WebSearch│ │ WebFetch │ │  Brief  │ │   LSP    │ │ │
│  │  └─────────┘ └──────────┘ └─────────┘ └──────────┘ │ │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐              │ │
│  │  │Notebook │ │ PlanMode │ │Worktree │  + 20 more   │ │
│  │  └─────────┘ └──────────┘ └─────────┘              │ │
│  └─────────────────────────────────────────────────────┘ │
│       │                                                   │
│       ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                MCP Tools (Dynamic)                    │ │
│  │  MCPTool wrapper + ListMcpResources + ReadMcpResource│ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 7. So Sánh Với Pi Agent

| Khía cạnh | Claude Code | Pi Agent |
|-----------|-------------|----------|
| Tool definition | `buildTool()` + Zod schema | Extension `registerTool()` |
| Permission | Built-in multi-layer (deny/allow/ask) | Đơn giản hơn |
| UI rendering | React/Ink components | TUI text output |
| Multi-agent | AgentTool + TeamCreate + SendMessage | Aurora Teams extension |
| Feature gating | `bun:bundle` feature flags | Không có |
| MCP support | Native (MCPTool wrapper) | Không có (tự build) |
| Schema validation | Zod v4 (`strictObject`) | Tùy extension |

---

*Tài liệu được tạo từ phân tích source code `claude/src/tools/` — Claude Code.*
