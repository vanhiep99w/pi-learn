# 📖 Pi Coding Agent — Tài Liệu Tổng Hợp Chi Tiết

> Tổng hợp từ [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)  
> Website: [pi.dev](https://pi.dev) | [shittycodingagent.ai](https://shittycodingagent.ai)  
> License: MIT | Tác giả: Mario Zechner

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Kiến Trúc Monorepo](#2-kiến-trúc-monorepo)
- [3. Cài Đặt & Quick Start](#3-cài-đặt--quick-start)
- [4. Bốn Chế Độ Hoạt Động](#4-bốn-chế-độ-hoạt-động)
- [5. Providers & Models](#5-providers--models)
- [6. Interactive Mode](#6-interactive-mode)
- [7. Sessions](#7-sessions)
- [8. Compaction & Branch Summarization](#8-compaction--branch-summarization)
- [9. Settings](#9-settings)
- [10. Context Files](#10-context-files)
- [11. Customization](#11-customization)
  - [11.1 Prompt Templates](#111-prompt-templates)
  - [11.2 Skills](#112-skills)
  - [11.3 Extensions](#113-extensions--tính-năng-mạnh-nhất)
  - [11.4 Themes](#114-themes)
  - [11.5 Pi Packages](#115-pi-packages)
- [12. SDK](#12-sdk)
- [13. RPC Mode](#13-rpc-mode)
- [14. TUI Component System](#14-tui-component-system)
- [15. CLI Reference](#15-cli-reference)
- [16. Triết Lý Thiết Kế](#16-triết-lý-thiết-kế)

---

## 1. Tổng Quan

**Pi** là một **terminal coding agent** tối giản nhưng cực kỳ mạnh mẽ và có khả năng mở rộng cao. Triết lý cốt lõi:

> **"Adapt pi to your workflows, not the other way around"**  
> Bạn chỉnh Pi cho phù hợp với workflow của mình, không phải ngược lại.

Pi ship với powerful defaults nhưng cố tình bỏ qua các features như sub-agents, plan mode, permission popups. Thay vào đó, bạn có thể tự build hoặc cài third-party packages.

### Đặc điểm nổi bật

- 🔧 **Extensible hoàn toàn** — Extensions (TypeScript), Skills, Prompt Templates, Themes
- 🌐 **18+ LLM providers** — Anthropic, OpenAI, Google, Mistral, Groq, xAI, Bedrock, Ollama...
- 🌳 **Session branching** — Tree structure, navigate và branch tại chỗ
- 📦 **Package system** — Chia sẻ qua npm/git
- 🔌 **SDK & RPC** — Nhúng vào app hoặc tích hợp cross-language
- 🎨 **Custom TUI** — Full component system, overlays, custom editor
- 🆓 **Open source MIT**

### Tools mặc định

Pi cung cấp cho LLM **4 tools cơ bản**:

| Tool | Mô tả |
|------|--------|
| `read` | Đọc file |
| `write` | Ghi file |
| `edit` | Chỉnh sửa file |
| `bash` | Chạy lệnh shell |

Các tools bổ sung có thể bật: `grep`, `find`, `ls`.

---

## 2. Kiến Trúc Monorepo

```text
pi-mono/
├── packages/
│   ├── ai/            → @mariozechner/pi-ai (Unified multi-provider LLM API)
│   ├── agent/         → @mariozechner/pi-agent-core (Agent runtime)
│   ├── coding-agent/  → @mariozechner/pi-coding-agent (CLI coding agent chính)
│   ├── mom/           → @mariozechner/pi-mom (Slack bot)
│   ├── tui/           → @mariozechner/pi-tui (Terminal UI library)
│   ├── web-ui/        → @mariozechner/pi-web-ui (Web components)
│   └── pods/          → @mariozechner/pi-pods (vLLM deployment CLI)
├── scripts/
├── AGENTS.md
├── CONTRIBUTING.md
└── package.json
```

| Package | Mô tả |
|---------|--------|
| **pi-ai** | API LLM thống nhất cho nhiều provider (OpenAI, Anthropic, Google...) |
| **pi-agent-core** | Runtime agent với tool calling & state management |
| **pi-coding-agent** | CLI coding agent chính — package người dùng cài |
| **pi-mom** | Slack bot delegate messages tới pi coding agent |
| **pi-tui** | Thư viện Terminal UI với differential rendering |
| **pi-web-ui** | Web components cho AI chat interfaces |
| **pi-pods** | CLI quản lý vLLM deployments trên GPU pods |

### Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, type check
./test.sh            # Run tests
./pi-test.sh         # Run pi from sources
```

---

## 3. Cài Đặt & Quick Start

### Cài đặt

```bash
npm install -g @mariozechner/pi-coding-agent
```

### Xác thực

**Cách 1: API Key**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

**Cách 2: Subscription (OAuth)**

```bash
pi
/login  # Chọn provider (Claude Pro, ChatGPT Plus, Copilot, Gemini...)
```

### Sử dụng cơ bản

```bash
# Interactive mode
pi
pi "List all .ts files in src/"

# Print mode (non-interactive)
pi -p "Summarize this codebase"

# Chọn model
pi --provider openai --model gpt-4o "Help me refactor"
pi --model openai/gpt-4o "Help me refactor"

# High thinking
pi --thinking high "Solve this complex problem"

# Read-only mode
pi --tools read,grep,find,ls -p "Review the code"
```

### Platform notes

- **Windows**: [docs/windows.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/windows.md)
- **Termux (Android)**: [docs/termux.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/termux.md)
- **tmux**: [docs/tmux.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tmux.md)
- **Terminal setup**: [docs/terminal-setup.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/terminal-setup.md)

---

## 4. Bốn Chế Độ Hoạt Động

| Mode | Flag | Mô tả |
|------|------|--------|
| **Interactive** | (mặc định) | TUI đầy đủ, gõ lệnh trực tiếp |
| **Print** | `-p` | In response rồi thoát |
| **JSON** | `--mode json` | Xuất tất cả events dạng JSON lines |
| **RPC** | `--mode rpc` | JSON protocol qua stdin/stdout |

Ngoài ra còn có **SDK mode** để nhúng vào app Node.js/TypeScript.

---

## 5. Providers & Models

### 5.1 Subscriptions (qua `/login`)

| Provider | Yêu cầu |
|----------|----------|
| Anthropic Claude Pro/Max | Claude subscription |
| OpenAI ChatGPT Plus/Pro (Codex) | ChatGPT subscription |
| GitHub Copilot | Copilot subscription |
| Google Gemini CLI | Google account (miễn phí) |
| Google Antigravity | Google account (miễn phí) |

### 5.2 API Keys

| Provider | Environment Variable |
|----------|---------------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Cerebras | `CEREBRAS_API_KEY` |
| xAI | `XAI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` |
| ZAI | `ZAI_API_KEY` |
| OpenCode Zen/Go | `OPENCODE_API_KEY` |
| Hugging Face | `HF_TOKEN` |
| Kimi For Coding | `KIMI_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |

#### Auth File (`~/.pi/agent/auth.json`)

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "sk-..." }
}
```

Key hỗ trợ 3 format:

- **Shell command**: `"!security find-generic-password -ws 'anthropic'"`
- **Env variable**: `"MY_API_KEY"`
- **Literal**: `"sk-ant-..."`

### 5.3 Cloud Providers

#### Amazon Bedrock

```bash
export AWS_PROFILE=your-profile
# hoặc
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-west-2

pi --provider amazon-bedrock --model us.anthropic.claude-sonnet-4-20250514-v1:0
```

#### Google Vertex AI

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project
export GOOGLE_CLOUD_LOCATION=us-central1
```

### 5.4 Custom Models (`~/.pi/agent/models.json`)

Thêm Ollama, vLLM, LM Studio hoặc bất kỳ provider tương thích:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

**Full model config:**

```json
{
  "id": "llama3.1:8b",
  "name": "Llama 3.1 8B (Local)",
  "reasoning": false,
  "input": ["text"],
  "contextWindow": 128000,
  "maxTokens": 32000,
  "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
}
```

**Supported APIs:**

| API | Mô tả |
|-----|--------|
| `openai-completions` | OpenAI Chat Completions (phổ biến nhất) |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI |

**Override built-in provider (proxy):**

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1"
    }
  }
}
```

File reload mỗi khi mở `/model`, không cần restart.

### 5.5 Key Resolution Order

1. CLI `--api-key` flag
2. `auth.json` entry
3. Environment variable
4. Custom provider keys từ `models.json`

---

## 6. Interactive Mode

### 6.1 Giao Diện

```text
┌─────────────────────────────────────────────┐
│ Startup header (shortcuts, AGENTS.md, etc.) │
├─────────────────────────────────────────────┤
│                                             │
│  Messages area                              │
│  (user, assistant, tool calls, results)     │
│                                             │
├─────────────────────────────────────────────┤
│ Editor (input area)                         │
├─────────────────────────────────────────────┤
│ Footer (cwd, session, tokens, cost, model)  │
└─────────────────────────────────────────────┘
```

### 6.2 Editor Features

| Feature | Cách dùng |
|---------|-----------|
| File reference | Gõ `@` để fuzzy-search project files |
| Path completion | Tab |
| Multi-line | Shift+Enter (Ctrl+Enter trên Windows Terminal) |
| Images | Ctrl+V paste (Alt+V trên Windows), hoặc kéo thả |
| Bash commands | `!command` → chạy & gửi output cho LLM |
| Bash (silent) | `!!command` → chạy mà không gửi cho LLM |

### 6.3 Commands

| Command | Mô tả |
|---------|--------|
| `/login`, `/logout` | OAuth authentication |
| `/model` | Chuyển model |
| `/settings` | Thinking level, theme, message delivery |
| `/resume` | Chọn từ sessions trước |
| `/new` | Session mới |
| `/name <name>` | Đặt tên session |
| `/tree` | Navigate session tree |
| `/fork` | Tạo session mới từ branch hiện tại |
| `/compact [prompt]` | Nén context thủ công |
| `/copy` | Copy message cuối vào clipboard |
| `/export [file]` | Export session ra HTML |
| `/share` | Upload GitHub gist |
| `/reload` | Reload extensions, skills, prompts |
| `/hotkeys` | Hiện tất cả keyboard shortcuts |
| `/quit` | Thoát |

### 6.4 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Ctrl+C | Xóa editor |
| Ctrl+C × 2 | Thoát |
| Escape | Cancel/abort |
| Escape × 2 | Mở `/tree` |
| Ctrl+L | Mở model selector |
| Ctrl+P / Shift+Ctrl+P | Cycle models |
| Shift+Tab | Cycle thinking level |
| Ctrl+O | Thu gọn/mở rộng tool output |
| Ctrl+T | Thu gọn/mở rộng thinking blocks |

### 6.5 Message Queue

Gửi messages **trong khi agent đang chạy**:

| Key | Loại | Hành vi |
|-----|------|---------|
| Enter | **Steering** | Chèn sau tool hiện tại, bỏ qua tools còn lại |
| Alt+Enter | **Follow-up** | Chờ agent xong hết rồi mới gửi |
| Escape | Abort | Khôi phục queued messages vào editor |
| Alt+Up | Lấy lại | Đưa queued messages về editor |

### 6.6 Slash Command Resolution — `/` Trigger Gì?

Khi gõ `/` trong editor, Pi hiện **autocomplete gộp từ 4 nguồn**:

| # | Loại | Ví Dụ | Nguồn |
|---|------|-------|-------|
| 1 | **Built-in commands** | `/model`, `/settings`, `/tree`, `/compact`, `/new`, `/resume` | Hard-coded trong interactive mode |
| 2 | **Extension commands** | `/stats`, `/deploy`, `/hello` | `pi.registerCommand()` từ extensions |
| 3 | **Prompt templates** | `/review`, `/component` | File `.md` trong `prompts/` folders |
| 4 | **Skill commands** | `/skill:brave-search`, `/skill:pdf-tools` | File `SKILL.md` trong `skills/` folders |

#### Cách Pi phân biệt

Pi dùng **command registry thống nhất** với field `source`:

```typescript
{
  name: string;          // Tên command (VD: "review", "skill:brave-search")
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo: {
    path: string;        // Đường dẫn file gốc
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
  };
}
```

> Built-in commands (`/model`, `/settings`...) **không nằm trong registry** — chúng xử lý riêng trong InteractiveMode nên extension/prompt **không thể ghi đè**.

#### Quy tắc phân biệt

| Quy Tắc | Mô Tả |
|---------|--------|
| **Skill dùng prefix `skill:`** | `/skill:name` — không bao giờ trùng extension hay prompt |
| **Prompt dùng filename** | `review.md` → `/review` |
| **Extension trùng tên → suffix số** | 2 extension cùng register `/review` → `/review:1` và `/review:2` |
| **Thứ tự autocomplete** | Extensions → Prompts → Skills |

#### Flow resolve khi gõ `/name`

```text
User gõ "/" trong editor
        │
        ▼
┌───────────────────────────┐
│  Autocomplete dropdown    │
│  gộp 4 nguồn:            │
│   • Built-in commands     │
│   • Extension commands    │
│   • Prompt templates      │
│   • Skill commands        │
└───────────┬───────────────┘
            │
      User chọn/gõ
            │
            ▼
   ┌─ Built-in? ──► Handler riêng (chỉ interactive mode)
   │
   ├─ Extension? ──► handler(args, ctx) chạy logic
   │
   ├─ Prompt? ──► Expand .md content vào editor
   │                (hỗ trợ $1, $@, ${@:N} arguments)
   │
   └─ Skill? ──► Load SKILL.md + args → gửi cho LLM
```

### 6.7 Slash Commands vs Tools — Ai Trigger Gì?

> ⚠️ **Dễ nhầm lẫn**: Slash commands (`/`) và Tools là **hai hệ thống hoàn toàn khác nhau**.

**Slash commands** = User gõ `/` trong editor → chạy logic  
**Tools** = LLM tự gọi mỗi turn → `read()`, `write()`, `bash()`...

```text
╔══════════════════════════════════════════╗
║  USER gõ trong editor                    ║
║                                          ║
║  "/"  → Slash commands (4 nguồn)         ║
║  text → Gửi prompt cho LLM              ║
╠══════════════════════════════════════════╣
║  LLM tự quyết định                      ║
║                                          ║
║  Tools → read(), write(), bash()...      ║
║          + custom tools từ extensions    ║
║  Skills → LLM tự read() SKILL.md        ║
╚══════════════════════════════════════════╝
```

#### Bảng so sánh

| Khái niệm | Ai trigger | Cần `/`? | Ví dụ |
|-----------|-----------|---------|-------|
| **Tool** (built-in + custom) | **LLM** tự gọi | ❌ | `read("src/main.ts")`, `bash("npm test")` |
| **Slash Command** (built-in) | **User** gõ | ✅ | `/model`, `/tree`, `/compact` |
| **Slash Command** (extension) | **User** gõ | ✅ | `/deploy`, `/stats` |
| **Prompt Template** | **User** gõ | ✅ | `/review`, `/component Button` |
| **Skill** | **Cả hai** | ⚠️ Tùy | User: `/skill:name` hoặc LLM tự `read()` |
| **Event Hook** | **Tự động** lifecycle | ❌ | `session_start`, `tool_call` |

#### Extension là container cho cả hai

Một extension có thể đăng ký **cả tools lẫn commands**:

```typescript
export default function (pi: ExtensionAPI) {
  // Tool → LLM tự gọi, KHÔNG cần "/"
  pi.registerTool({
    name: "subagent",
    execute(id, params) { ... }
  });

  // Command → User gõ "/deploy", CẦN "/"
  pi.registerCommand("deploy", {
    handler(args, ctx) { ... }
  });

  // Event hook → Tự fire theo lifecycle
  pi.on("tool_call", (event) => { ... });
}
```

#### Skills — Cầu nối cả hai thế giới

Skills đặc biệt vì hoạt động ở **cả hai hệ thống**:

1. **Như slash command**: User gõ `/skill:brave-search` → load SKILL.md làm prompt
2. **Như tool target**: LLM tự nhận ra cần skill (từ descriptions trong system prompt) → gọi `read()` để load SKILL.md → follow instructions

```text
Startup: Pi inject skill descriptions vào system prompt:
  <skills>
    <skill name="brave-search">Web search via Brave API...</skill>
  </skills>

Khi chạy:
  User: "Search the web for Pi docs"
  LLM nhận ra match "brave-search" → tự gọi read("skills/brave-search/SKILL.md")
  LLM đọc → follow instructions → gọi tools theo hướng dẫn
```

---

## 7. Sessions

### 7.1 Cấu Trúc File

Sessions lưu dạng **JSONL** (JSON Lines) với **cấu trúc cây**:

```text
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

Mỗi entry có `id` và `parentId` → cho phép **in-place branching**.

### 7.2 Session Version History

| Version | Thay đổi |
|---------|----------|
| v1 | Linear entry sequence (legacy) |
| v2 | Tree structure với `id`/`parentId` |
| v3 | Renamed `hookMessage` → `custom` |

Sessions tự động migrate lên v3 khi load.

### 7.3 Quản Lý Sessions

```bash
pi -c                  # Tiếp tục session gần nhất
pi -r                  # Duyệt và chọn session
pi --no-session        # Ephemeral mode (không lưu)
pi --session <path>    # Dùng session cụ thể
```

### 7.4 Branching

#### `/tree` — Navigate In-Place

```text
├─ user: "Hello..."
│  └─ assistant: "Of course..."
│     ├─ user: "Try approach A..."
│     │  └─ assistant: "For approach A..."
│     │     └─ user: "That worked..."  ← active
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

- Search, fold/unfold branches
- Filter modes: default → no-tools → user-only → labeled-only → all
- Label entries làm bookmarks

#### `/fork` — Tạo Session File Mới

Chọn một điểm, copy history tới đó vào file mới, đặt message vào editor.

| Feature | `/fork` | `/tree` |
|---------|---------|---------|
| View | Flat list user messages | Full tree |
| Action | Tạo **file mới** | Đổi leaf **cùng file** |
| Summary | Không bao giờ | Tùy chọn |

### 7.5 Entry Types

| Type | Mô tả |
|------|--------|
| `session` | Header (metadata, version) |
| `message` | User/Assistant/ToolResult/BashExecution/Custom messages |
| `model_change` | Đổi model |
| `thinking_level_change` | Đổi thinking level |
| `compaction` | Summary khi nén context |
| `branch_summary` | Summary khi chuyển branch |
| `custom` | Extension state (không trong LLM context) |
| `custom_message` | Extension message (trong LLM context) |
| `label` | Bookmark/marker |
| `session_info` | Metadata (tên session) |

### 7.6 Message Types

```typescript
type AgentMessage =
  | UserMessage           // Tin nhắn người dùng
  | AssistantMessage      // Phản hồi LLM (text, thinking, tool calls)
  | ToolResultMessage     // Kết quả tool
  | BashExecutionMessage  // Kết quả lệnh bash (!command)
  | CustomMessage         // Extension message
  | BranchSummaryMessage  // Summary khi chuyển branch
  | CompactionSummaryMessage; // Summary khi nén
```

### 7.7 SessionManager API

```typescript
// Tạo session
SessionManager.create(cwd)           // Mới
SessionManager.open(path)            // Mở file
SessionManager.continueRecent(cwd)   // Tiếp tục gần nhất
SessionManager.inMemory()            // Không lưu file
SessionManager.forkFrom(source, cwd) // Fork từ session khác

// Append entries
sm.appendMessage(message)
sm.appendCompaction(summary, firstKeptEntryId, tokensBefore)
sm.appendCustomEntry(customType, data)
sm.appendCustomMessageEntry(customType, content, display)

// Tree navigation
sm.getLeafId()              // Vị trí hiện tại
sm.getTree()                // Full tree
sm.getBranch(fromId?)       // Walk từ entry về root
sm.branch(entryId)          // Di chuyển leaf
sm.branchWithSummary(id, summary) // Branch + summary

// Context
sm.buildSessionContext()    // Lấy messages cho LLM
```

---

## 8. Compaction & Branch Summarization

### 8.1 Compaction — Nén Context

LLM có context window giới hạn. Khi conversation quá dài, Pi **tự động nén** (summarize) messages cũ.

#### Khi nào trigger

```text
contextTokens > contextWindow - reserveTokens (mặc định 16384)
```

Hoặc thủ công: `/compact [instructions]`

#### Cách hoạt động

```text
Trước compaction:
  [hdr] [usr] [ass] [tool] [usr] [ass] [tool] [tool] [ass] [tool]
         └────summarize────┘ └──────────kept──────────────┘

Sau compaction:
  LLM thấy: [system] [summary] [usr] [ass] [tool] [tool] [ass] [tool]
```

1. **Tìm cut point**: Đi ngược từ message mới nhất, giữ ~20k tokens gần nhất
2. **Trích xuất**: Messages từ compaction trước đến cut point
3. **Generate summary**: Gọi LLM summarize
4. **Append entry**: Lưu `CompactionEntry`
5. **Reload**: Session dùng summary + messages từ cut point

#### Settings

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

### 8.2 Branch Summarization

Khi dùng `/tree` chuyển branch, Pi có thể tạo summary cho branch bạn rời đi:

```text
Trước navigation:
     ┌─ B ─ C ─ D (old leaf)
A ───┤
     └─ E ─ F (target)

Summarize: B, C, D
```

3 lựa chọn:

1. **No summary** — Chuyển ngay
2. **Summarize** — Summary mặc định
3. **Custom prompt** — Summary với hướng dẫn riêng

### 8.3 Summary Format

```markdown
## Goal
[Mục tiêu]

## Constraints & Preferences
- [Yêu cầu]

## Progress
### Done
- [x] [Hoàn thành]
### In Progress
- [ ] [Đang làm]

## Key Decisions
- **[Quyết định]**: [Lý do]

## Next Steps
1. [Bước tiếp]

<read-files>
path/to/file.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### 8.4 Custom Compaction qua Extensions

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  // Cancel
  return { cancel: true };

  // Custom summary
  return {
    compaction: {
      summary: "Your summary...",
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
    }
  };
});
```

---

## 9. Settings

### 9.1 Locations

| File                        | Scope                     |
|-----------------------------|--------------------------|
| `~/.pi/agent/settings.json` | Global (tất cả projects) |
| `.pi/settings.json`         | Project (override global) |

Hoặc dùng `/settings` trong interactive mode.

### 9.2 Tất Cả Settings

#### Model & Thinking

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `defaultProvider` | string | - | Provider mặc định |
| `defaultModel` | string | - | Model ID mặc định |
| `defaultThinkingLevel` | string | - | `off/minimal/low/medium/high/xhigh` |
| `hideThinkingBlock` | boolean | false | Ẩn thinking blocks |
| `thinkingBudgets` | object | - | Token budgets cho mỗi level |

#### UI & Display

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `theme` | string | `"dark"` | Theme (`dark`, `light`, custom) |
| `quietStartup` | boolean | false | Ẩn startup header |
| `doubleEscapeAction` | string | `"tree"` | Double-escape: `tree/fork/none` |

#### Compaction

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `compaction.enabled` | boolean | true | Bật auto-compaction |
| `compaction.reserveTokens` | number | 16384 | Tokens dành cho LLM response |
| `compaction.keepRecentTokens` | number | 20000 | Tokens gần đây giữ lại |

#### Retry

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `retry.enabled` | boolean | true | Bật auto retry |
| `retry.maxRetries` | number | 3 | Số lần retry tối đa |
| `retry.baseDelayMs` | number | 2000 | Base delay (2s, 4s, 8s) |
| `retry.maxDelayMs` | number | 60000 | Max delay trước khi fail |

#### Message Delivery

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `steeringMode` | string | `"one-at-a-time"` | Steering: `all` hoặc `one-at-a-time` |
| `followUpMode` | string | `"one-at-a-time"` | Follow-up: `all` hoặc `one-at-a-time` |
| `transport` | string | `"sse"` | `sse/websocket/auto` |

#### Resources

| Setting | Type | Mô tả |
|---------|------|--------|
| `packages` | array | npm/git packages |
| `extensions` | string[] | Extension paths |
| `skills` | string[] | Skill paths |
| `prompts` | string[] | Prompt template paths |
| `themes` | string[] | Theme paths |
| `enableSkillCommands` | boolean | Đăng ký skills thành `/skill:name` |

### 9.3 Ví Dụ

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "retry": { "enabled": true, "maxRetries": 3 },
  "enabledModels": ["claude-*", "gpt-4o"],
  "packages": ["pi-skills"]
}
```

---

## 10. Context Files

Pi tự động load `AGENTS.md` (hoặc `CLAUDE.md`) từ:

1. `~/.pi/agent/AGENTS.md` (global)
2. Parent directories (walking up từ cwd)
3. Current directory

Dùng để đặt project instructions, conventions, common commands.

### System Prompt

| File | Hành vi |
|------|---------|
| `.pi/SYSTEM.md` | Thay thế system prompt mặc định (project) |
| `~/.pi/agent/SYSTEM.md` | Thay thế system prompt mặc định (global) |
| `APPEND_SYSTEM.md` | Append vào system prompt |

---

## 11. Customization

### 11.1 Prompt Templates

Markdown snippets tái sử dụng. Gõ `/name` để expand.

**Locations:**

- `~/.pi/agent/prompts/*.md` (global)
- `.pi/prompts/*.md` (project)
- Pi packages

**Ví dụ:** `~/.pi/agent/prompts/review.md`

```markdown
---
description: Review staged git changes
---
Review the staged changes (`git diff --cached`). Focus on:
- Bugs and logic errors
- Security issues
- Error handling gaps
```

Dùng: `/review`

**Arguments:**

```markdown
---
description: Create a component
---
Create a React component named $1 with features: $@
```

Dùng: `/component Button "onClick handler" "disabled support"`

Hỗ trợ: `$1`, `$2`, `$@`, `${@:N}`, `${@:N:L}`

---

### 11.2 Skills

On-demand capability packages theo chuẩn [Agent Skills](https://agentskills.io).

**Locations:**

- `~/.pi/agent/skills/` (global)
- `~/.agents/skills/` (global)
- `.pi/skills/` (project)
- `.agents/skills/` (project, up to git root)

**Cấu trúc:**

```text
brave-search/
├── SKILL.md           # Required
├── search.js
└── content.js
```

**SKILL.md:**

````markdown
---
name: brave-search
description: Web search via Brave Search API. Use for searching docs, facts, or web content.
---

# Brave Search

## Setup
```bash
cd /path/to/brave-search && npm install
```

## Search
```bash
./search.js "query"
./search.js "query" --content
```
````

**Cách hoạt động:**

1. Startup: Pi scan skills, trích names & descriptions
2. System prompt: Liệt kê available skills dạng XML
3. Khi cần: Agent dùng `read` để load full SKILL.md
4. Hoặc user gõ `/skill:name`

**Frontmatter:**

| Field | Required | Mô tả |
|-------|----------|--------|
| `name` | Yes | Max 64 chars, lowercase, hyphens |
| `description` | Yes | Max 1024 chars, mô tả khi nào dùng |
| `license` | No | License |
| `compatibility` | No | Yêu cầu môi trường |
| `disable-model-invocation` | No | Ẩn khỏi system prompt |

**Skill repositories:**

- [Anthropic Skills](https://github.com/anthropics/skills)
- [Pi Skills](https://github.com/badlogic/pi-skills)

---

### 11.3 Extensions — **Tính Năng Mạnh Nhất**

TypeScript modules mở rộng Pi. Load qua [jiti](https://github.com/unjs/jiti) nên TypeScript chạy không cần compile.

**Locations:**

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/*.ts` | Global |
| `~/.pi/agent/extensions/*/index.ts` | Global (subdirectory) |
| `.pi/extensions/*.ts` | Project |
| `.pi/extensions/*/index.ts` | Project (subdirectory) |

#### Quick Start

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // React to events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  // Block dangerous commands
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Custom tool
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

  // Custom command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

Test: `pi -e ./my-extension.ts`

#### Event Lifecycle

```text
pi starts
  └─► session_start

user sends prompt
  ├─► input (can intercept/transform)
  ├─► before_agent_start (inject message, modify system prompt)
  ├─► agent_start
  │
  │   ┌─── turn (repeats while LLM calls tools) ───┐
  │   ├─► turn_start                                │
  │   ├─► context (modify messages)                 │
  │   ├─► before_provider_request                   │
  │   │     ├─► tool_call (can block)               │
  │   │     ├─► tool_execution_start                │
  │   │     ├─► tool_execution_update               │
  │   │     ├─► tool_execution_end                  │
  │   │     └─► tool_result (can modify)            │
  │   └─► turn_end                                  │
  │
  └─► agent_end

/new or /resume → session_before_switch → session_switch
/fork → session_before_fork → session_fork
/compact → session_before_compact → session_compact
/tree → session_before_tree → session_tree
exit → session_shutdown
```

#### Capabilities

| Khả năng | API |
|----------|-----|
| Custom tools | `pi.registerTool()` |
| Custom commands | `pi.registerCommand()` |
| Keyboard shortcuts | `pi.registerShortcut()` |
| CLI flags | `pi.registerFlag()` |
| Event subscription | `pi.on(event, handler)` |
| Inject messages | `pi.sendMessage()` / `pi.sendUserMessage()` |
| Session state | `pi.appendEntry()` |
| Manage tools | `pi.setActiveTools()` / `pi.getAllTools()` |
| Model control | `pi.setModel()` / `pi.setThinkingLevel()` |
| Custom providers | `pi.registerProvider()` |
| Shell commands | `pi.exec()` |
| Inter-extension comms | `pi.events` |
| Custom rendering | `renderCall()` / `renderResult()` |

#### ExtensionContext (`ctx`)

| Property | Mô tả |
|----------|--------|
| `ctx.ui` | UI methods (notify, confirm, select, input, custom) |
| `ctx.hasUI` | false trong print/JSON mode |
| `ctx.cwd` | Working directory |
| `ctx.sessionManager` | Read-only session access |
| `ctx.model` | Current model |
| `ctx.isIdle()` | Agent idle? |
| `ctx.abort()` | Abort agent |
| `ctx.compact()` | Trigger compaction |
| `ctx.getContextUsage()` | Token usage |
| `ctx.shutdown()` | Graceful shutdown |

#### Use Cases Thực Tế

- **Permission gates** — Confirm trước `rm -rf`, `sudo`
- **Git checkpointing** — Stash mỗi turn, restore on branch
- **Path protection** — Block writes to `.env`, `node_modules/`
- **Custom compaction** — Summarize conversation theo cách riêng
- **Sub-agents** — Spawn pi instances via tmux
- **Plan mode** — Build your own
- **SSH/Remote execution** — Custom bash operations
- **MCP server integration** — Extension thêm MCP support
- **Custom editor** — Vim mode, emacs mode
- **Games** — Snake, Doom while waiting! 🎮

#### Overriding Built-in Tools

```typescript
// Override read tool with logging
pi.registerTool({
  ...originalRead,
  name: "read",
  async execute(id, params, signal, onUpdate, ctx) {
    console.log(`Reading: ${params.path}`);
    return originalRead.execute(id, params, signal, onUpdate, ctx);
  },
});
```

#### Custom Provider qua Extension

```typescript
pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",
    async login(callbacks) {
      callbacks.onAuth({ url: "https://sso.corp.com/..." });
      const code = await callbacks.onPrompt({ message: "Enter code:" });
      return { refresh: code, access: code, expires: Date.now() + 3600000 };
    },
    async refreshToken(credentials) { return credentials; },
    getApiKey(credentials) { return credentials.access; },
  }
});
```

---

### 11.4 Themes

Built-in: `dark`, `light`. Themes **hot-reload** — sửa file là Pi áp dụng ngay.

Đặt tại: `~/.pi/agent/themes/`, `.pi/themes/`, hoặc Pi packages.

**Theme colors:**

| Category | Colors |
|----------|--------|
| General | `text`, `accent`, `muted`, `dim` |
| Status | `success`, `error`, `warning` |
| Tools | `toolTitle`, `toolOutput` |
| Diffs | `toolDiffAdded`, `toolDiffRemoved` |
| Markdown | `mdHeading`, `mdLink`, `mdCode` |
| Syntax | `syntaxKeyword`, `syntaxFunction`, `syntaxString` |
| Thinking | `thinkingOff` → `thinkingXhigh` |

---

### 11.5 Pi Packages

Bundle & share extensions, skills, prompts, themes qua npm hoặc git.

#### Cài đặt

```bash
pi install npm:@foo/pi-tools
pi install npm:@foo/pi-tools@1.2.3      # pinned version
pi install git:github.com/user/repo
pi install git:github.com/user/repo@v1  # tag/commit
pi install https://github.com/user/repo
pi remove npm:@foo/pi-tools
pi list
pi update                               # bỏ qua pinned packages
pi config                               # enable/disable resources
```

`-l` flag cho project-local installs.

#### Tạo Package

Thêm `pi` key vào `package.json`:

```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Không có manifest → Pi auto-discover từ conventional directories.

#### Package Filtering

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"]
    }
  ]
}
```

> ⚠️ **Security**: Pi packages chạy với full system access. Review source code trước khi cài third-party packages.

---

## 12. SDK

Nhúng Pi vào ứng dụng Node.js/TypeScript.

### Quick Start

```typescript
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

session.subscribe((event) => {
  if (event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

### AgentSession API

```typescript
interface AgentSession {
  // Prompting
  prompt(text: string, options?): Promise<void>;
  steer(text: string): Promise<void>;    // Interrupt
  followUp(text: string): Promise<void>; // Wait then send

  // Events
  subscribe(listener): () => void;

  // Model
  setModel(model): Promise<void>;
  setThinkingLevel(level): void;
  cycleModel(): Promise<ModelCycleResult>;

  // Session
  newSession(): Promise<boolean>;
  switchSession(path): Promise<boolean>;
  fork(entryId): Promise<{ selectedText; cancelled }>;
  navigateTree(targetId, options?): Promise<{ editorText?; cancelled }>;

  // Control
  compact(instructions?): Promise<CompactionResult>;
  abort(): Promise<void>;
  dispose(): void;

  // State
  agent: Agent;
  model: Model;
  isStreaming: boolean;
  messages: AgentMessage[];
}
```

### Options

```typescript
const { session } = await createAgentSession({
  // Directories
  cwd: process.cwd(),
  agentDir: "~/.pi/agent",

  // Model
  model: getModel("anthropic", "claude-opus-4-5"),
  thinkingLevel: "medium",

  // Tools
  tools: [readTool, bashTool],
  customTools: [myTool],

  // Session
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.create(),

  // Resources
  resourceLoader: new DefaultResourceLoader({ ... }),

  // Auth
  authStorage: AuthStorage.create(),
  modelRegistry: new ModelRegistry(authStorage),
});
```

### Run Modes

```typescript
// Interactive TUI
const mode = new InteractiveMode(session, { initialMessage: "Hello" });
await mode.run();

// Print mode
await runPrintMode(session, { mode: "text", initialMessage: "Hello" });

// RPC mode
await runRpcMode(session);
```

---

## 13. RPC Mode

Cho tích hợp cross-language qua JSON protocol trên stdin/stdout.

```bash
pi --mode rpc --no-session
```

### Commands

| Command | Mô tả |
|---------|--------|
| `prompt` | Gửi prompt |
| `steer` | Steering message (interrupt) |
| `follow_up` | Follow-up message (wait) |
| `abort` | Abort agent |
| `get_state` | Lấy state hiện tại |
| `get_messages` | Lấy tất cả messages |
| `set_model` | Đổi model |
| `cycle_model` | Cycle models |
| `set_thinking_level` | Đổi thinking level |
| `compact` | Nén context |
| `bash` | Chạy shell command |
| `new_session` | Session mới |
| `switch_session` | Chuyển session |
| `fork` | Fork session |
| `get_commands` | Lấy danh sách commands |
| `export_html` | Export HTML |

### Events (stdout)

| Event | Mô tả |
|-------|--------|
| `agent_start/end` | Agent lifecycle |
| `turn_start/end` | Turn lifecycle |
| `message_start/update/end` | Message streaming |
| `tool_execution_start/update/end` | Tool execution |
| `auto_compaction_start/end` | Auto compaction |
| `auto_retry_start/end` | Auto retry |

### Python Client Example

```python
import subprocess, json

proc = subprocess.Popen(
    ["pi", "--mode", "rpc", "--no-session"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
)

proc.stdin.write(json.dumps({"type": "prompt", "message": "Hello!"}) + "\n")
proc.stdin.flush()

for line in proc.stdout:
    event = json.loads(line)
    if event.get("type") == "message_update":
        delta = event.get("assistantMessageEvent", {})
        if delta.get("type") == "text_delta":
            print(delta["delta"], end="", flush=True)
    if event.get("type") == "agent_end":
        break
```

### Extension UI Protocol (RPC)

Extensions dùng `ctx.ui.select()`, `ctx.ui.confirm()` → trong RPC mode, chuyển thành JSON request/response:

**Dialog methods** (cần response): `select`, `confirm`, `input`, `editor`  
**Fire-and-forget** (không cần response): `notify`, `setStatus`, `setWidget`, `setTitle`

---

## 14. TUI Component System

### Built-in Components

| Component | Mô tả |
|-----------|--------|
| `Text` | Multi-line text, word wrapping |
| `Box` | Container với padding & background |
| `Container` | Nhóm components theo chiều dọc |
| `Spacer` | Khoảng trống |
| `Markdown` | Render markdown + syntax highlighting |
| `Image` | Hiển thị ảnh (Kitty, iTerm2, Ghostty, WezTerm) |
| `SelectList` | Chọn từ danh sách |
| `SettingsList` | Toggle settings |
| `BorderedLoader` | Async operation + cancel |

### Component Interface

```typescript
interface Component {
  render(width: number): string[];  // Mỗi line ≤ width
  handleInput?(data: string): void;
  invalidate(): void;
}
```

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

### UI Patterns

1. **Selection Dialog** — `SelectList` + `DynamicBorder`
2. **Async with Cancel** — `BorderedLoader`
3. **Settings Toggles** — `SettingsList`
4. **Status Indicator** — `ctx.ui.setStatus(key, text)`
5. **Widgets** — `ctx.ui.setWidget(key, lines, { placement })`
6. **Custom Footer** — `ctx.ui.setFooter(factory)`
7. **Custom Editor** — Extend `CustomEditor` class

### Overlays

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => new MyDialog({ onClose: done }),
  {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: "50%",
      maxHeight: "80%",
      margin: 2,
    },
  }
);
```

---

## 15. CLI Reference

```bash
pi [options] [@files...] [messages...]
```

### Package Commands

```bash
pi install <source> [-l]    # Cài package, -l cho project-local
pi remove <source> [-l]     # Gỡ package
pi update [source]          # Cập nhật (bỏ pinned)
pi list                     # Liệt kê packages
pi config                   # Enable/disable resources
```

### Model Options

| Option | Mô tả |
|--------|--------|
| `--provider <name>` | Provider |
| `--model <pattern>` | Model (hỗ trợ `provider/id` và `:<thinking>`) |
| `--api-key <key>` | API key |
| `--thinking <level>` | `off/minimal/low/medium/high/xhigh` |
| `--models <patterns>` | Patterns cho Ctrl+P cycling |
| `--list-models [search]` | Liệt kê models |

### Session Options

| Option | Mô tả |
|--------|--------|
| `-c`, `--continue` | Tiếp tục session gần nhất |
| `-r`, `--resume` | Duyệt và chọn session |
| `--session <path>` | Session cụ thể |
| `--no-session` | Ephemeral mode |

### Tool Options

| Option | Mô tả |
|--------|--------|
| `--tools <list>` | Bật tools cụ thể (mặc định: `read,bash,edit,write`) |
| `--no-tools` | Tắt tất cả built-in tools |

Available tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

### Resource Options

| Option | Mô tả |
|--------|--------|
| `-e`, `--extension <source>` | Load extension |
| `--no-extensions` | Tắt extension discovery |
| `--skill <path>` | Load skill |
| `--no-skills` | Tắt skill discovery |
| `--prompt-template <path>` | Load prompt template |
| `--theme <path>` | Load theme |

### File Arguments

```bash
pi @prompt.md "Answer this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

### Environment Variables

| Variable | Mô tả |
|----------|--------|
| `PI_CODING_AGENT_DIR` | Override config directory |
| `PI_SKIP_VERSION_CHECK` | Bỏ version check |
| `PI_CACHE_RETENTION` | `long` cho extended cache |
| `VISUAL`, `EDITOR` | External editor cho Ctrl+G |

---

## 16. Triết Lý Thiết Kế

Pi **aggressively extensible** nên không cần dictate workflow. Core tối giản, bạn tự shape Pi.

| Không có | Tại sao | Giải pháp |
|----------|---------|-----------|
| **MCP** | CLI tools + Skills đủ | Extension nếu cần |
| **Sub-agents** | Nhiều cách làm | tmux hoặc extension |
| **Permission popups** | Chạy trong container | Extension cho confirmation |
| **Plan mode** | Viết plans ra file | Extension |
| **Built-in to-dos** | Confuse models | TODO.md file |
| **Background bash** | Dùng tmux | Full observability |

> *"Pi is aggressively extensible so it doesn't have to dictate your workflow."*

---

## Tham Khảo

- **Repository**: [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- **Docs**: [packages/coding-agent/docs/](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs)
- **Examples**: [packages/coding-agent/examples/](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples)
- **Discord**: [discord.com/invite/3cU7Bz4UPx](https://discord.com/invite/3cU7Bz4UPx)
- **npm**: [@mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
- **Blog post**: [mariozechner.at/posts/2025-11-30-pi-coding-agent/](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- **Agent Skills standard**: [agentskills.io](https://agentskills.io)
- **Pi Skills repo**: [github.com/badlogic/pi-skills](https://github.com/badlogic/pi-skills)
- **Pi Packages gallery**: [shittycodingagent.ai/packages](https://shittycodingagent.ai/packages)
- **OpenClaw SDK integration**: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
