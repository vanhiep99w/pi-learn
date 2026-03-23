# 🌳 Pi Sessions & Branching — Hướng Dẫn Chi Tiết

> Tham khảo từ [session.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md), [tree.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tree.md), [compaction.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md)

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Session File Format](#2-session-file-format)
  - [2.1 File Location](#21-file-location)
  - [2.2 JSONL Format](#22-jsonl-format)
  - [2.3 Tree Structure (`id` / `parentId`)](#23-tree-structure-id--parentid)
  - [2.4 Session Version History](#24-session-version-history)
- [3. Entry Types](#3-entry-types)
- [4. Message Types](#4-message-types)
- [5. Quản Lý Sessions](#5-quản-lý-sessions)
- [6. Session Branching — `/tree`](#6-session-branching--tree)
  - [6.1 Tree UI](#61-tree-ui)
  - [6.2 Controls](#62-controls)
  - [6.3 Selection Behavior](#63-selection-behavior)
  - [6.4 Branch Summarization](#64-branch-summarization)
- [7. Fork — `/fork`](#7-fork--fork)
- [8. So Sánh `/tree` vs `/fork`](#8-so-sánh-tree-vs-fork)
- [9. Compaction — Nén Context](#9-compaction--nén-context)
  - [9.1 Khi Nào Trigger](#91-khi-nào-trigger)
  - [9.2 Cách Hoạt Động](#92-cách-hoạt-động)
  - [9.3 Split Turns](#93-split-turns)
  - [9.4 Settings](#94-settings)
- [10. Summary Format](#10-summary-format)
- [11. Context Building](#11-context-building)
- [12. SessionManager API](#12-sessionmanager-api)
- [13. Extension Events](#13-extension-events)
- [14. Custom Summarization](#14-custom-summarization)
- [15. Parsing Sessions](#15-parsing-sessions)
- [16. Tips & Best Practices](#16-tips--best-practices)

---

## 1. Tổng Quan

Hệ thống session của Pi có 3 đặc điểm nổi bật so với các coding agents khác:

| Đặc điểm | Mô tả |
|-----------|--------|
| **🌳 Tree structure** | Conversation là cây, không phải danh sách — cho phép branch/navigate tại chỗ |
| **📦 JSONL persistence** | Mỗi session là file `.jsonl` — dễ đọc, parse, backup |
| **🗜️ Auto-compaction** | Tự nén context khi quá dài — giữ conversation chạy liên tục |

### Mô hình mental

```
Conversation thông thường (linear):
  msg1 → msg2 → msg3 → msg4 → msg5

Pi session (tree):
  msg1 → msg2 → msg3 → msg4 → msg5  ← current
                   ↘ msg4b → msg5b   ← branch khác
                        ↘ msg5c      ← branch khác nữa
```

Bạn có thể **quay lại bất kỳ điểm nào**, thử approach khác, mà **không mất** conversation cũ.

---

## 2. Session File Format

### 2.1 File Location

```
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

Ví dụ:
```
~/.pi/agent/sessions/--home-user-my-project--/1701612000000_a1b2c3d4.jsonl
```

`<path>` là working directory với `/` thay bằng `-`.

**Xóa session:** Xóa file `.jsonl` trực tiếp, hoặc trong `/resume` nhấn `Ctrl+D` để xóa interactively.

### 2.2 JSONL Format

Mỗi dòng là một JSON object với field `type`:

```jsonl
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project"}
{"type":"message","id":"a1b2c3d4","parentId":null,"timestamp":"...","message":{"role":"user","content":"Hello"}}
{"type":"message","id":"b2c3d4e5","parentId":"a1b2c3d4","timestamp":"...","message":{"role":"assistant","content":[...]}}
{"type":"message","id":"c3d4e5f6","parentId":"b2c3d4e5","timestamp":"...","message":{"role":"toolResult",...}}
```

### 2.3 Tree Structure (`id` / `parentId`)

Mỗi entry (trừ header) có:

- `id` — 8-char hex ID duy nhất
- `parentId` — ID của entry cha (`null` cho entry đầu tiên)

```
Entry đầu: parentId = null
     │
     ▼
[user "Hello"] ─── [assistant "Hi!"] ─── [user "Try A"] ─── [assistant "Result A"]
   id: a1b2          id: b2c3              id: c3d4           id: d4e5
   parent: null       parent: a1b2          parent: b2c3        parent: c3d4
                                              │
                                              └── [user "Try B"] ─── [assistant "Result B"]
                                                   id: e5f6           id: f6g7
                                                   parent: b2c3        parent: e5f6
```

**Leaf** = vị trí hiện tại trong cây (entry cuối cùng trên branch active).

### 2.4 Session Version History

| Version | Thay đổi |
|---------|----------|
| v1 | Linear sequence (legacy) |
| v2 | Tree structure với `id`/`parentId` |
| v3 | Renamed `hookMessage` → `custom` |

Sessions tự động migrate lên v3 khi load.

---

## 3. Entry Types

| Type | Mô tả | Trong LLM context? |
|------|--------|-------------------|
| `session` | Header file (metadata, version) | Không |
| `message` | User/Assistant/ToolResult/Bash/Custom messages | **Có** |
| `model_change` | Đổi model giữa session | Không |
| `thinking_level_change` | Đổi thinking level | Không |
| `compaction` | Summary khi nén context | **Có** (summary) |
| `branch_summary` | Summary khi chuyển branch | **Có** (summary) |
| `custom` | Extension state (persist) | **Không** |
| `custom_message` | Extension message | **Có** (nếu display=true) |
| `label` | Bookmark/marker trên entry | Không |
| `session_info` | Metadata (tên session) | Không |

### Chi tiết từng entry

**SessionHeader** — dòng đầu tiên, không có `id`/`parentId`:

```json
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path","parentSession":"/path/to/parent.jsonl"}
```

**CompactionEntry:**

```json
{"type":"compaction","id":"f6g7","parentId":"e5f6","timestamp":"...","summary":"User discussed X...","firstKeptEntryId":"c3d4","tokensBefore":50000}
```

**BranchSummaryEntry:**

```json
{"type":"branch_summary","id":"g7h8","parentId":"a1b2","timestamp":"...","fromId":"f6g7","summary":"Branch explored approach A..."}
```

**CustomEntry** (extension state, KHÔNG trong context):

```json
{"type":"custom","id":"h8i9","parentId":"g7h8","timestamp":"...","customType":"my-extension","data":{"count":42}}
```

**LabelEntry:**

```json
{"type":"label","id":"j0k1","parentId":"i9j0","timestamp":"...","targetId":"a1b2","label":"checkpoint-1"}
```

---

## 4. Message Types

### AgentMessage Union

```typescript
type AgentMessage =
  | UserMessage              // Tin nhắn user
  | AssistantMessage         // Phản hồi LLM
  | ToolResultMessage        // Kết quả tool
  | BashExecutionMessage     // ! hoặc !! commands
  | CustomMessage            // Extension messages
  | BranchSummaryMessage     // Summary khi chuyển branch
  | CompactionSummaryMessage // Summary khi nén
```

### Content Blocks

```typescript
// Text
{ type: "text", text: "Hello" }

// Image
{ type: "image", data: "base64...", mimeType: "image/png" }

// Thinking (assistant only)
{ type: "thinking", thinking: "Let me consider..." }

// Tool call (assistant only)
{ type: "toolCall", id: "call_123", name: "bash", arguments: { command: "ls" } }
```

### UserMessage

```typescript
{ role: "user", content: "Hello" | [{type:"text",text:"..."}], timestamp: 1701612000 }
```

### AssistantMessage

```typescript
{
  role: "assistant",
  content: [TextContent | ThinkingContent | ToolCall],
  provider: "anthropic", model: "claude-sonnet-4-5",
  usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 1500,
           cost: { input: 0.003, output: 0.015, total: 0.018, ... } },
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted",
  timestamp: 1701612001
}
```

### ToolResultMessage

```typescript
{
  role: "toolResult", toolCallId: "call_123", toolName: "bash",
  content: [{type:"text",text:"output"}], details: {...}, isError: false, timestamp: ...
}
```

### BashExecutionMessage (! commands)

```typescript
{
  role: "bashExecution", command: "ls -la", output: "...",
  exitCode: 0, cancelled: false, truncated: false,
  excludeFromContext: true,  // true cho !! prefix
  timestamp: ...
}
```

---

## 5. Quản Lý Sessions

### CLI

```bash
pi                     # Session mới (hoặc tiếp tục nếu có)
pi -c                  # Tiếp tục session gần nhất
pi -r                  # Duyệt và chọn session từ danh sách
pi --session <path>    # Dùng session file cụ thể
pi --no-session        # Ephemeral mode (không lưu file)
```

### Commands trong Pi

| Command | Mô tả |
|---------|--------|
| `/new` | Tạo session mới |
| `/resume` | Duyệt và chọn session trước |
| `/name <name>` | Đặt tên session (hiện trong `/resume`) |
| `/tree` | Navigate session tree |
| `/fork` | Fork session thành file mới |
| `/compact [prompt]` | Nén context thủ công |
| `/export [file]` | Export HTML |
| `/share` | Upload GitHub gist |

### Xóa sessions

```bash
# Xóa file trực tiếp
rm ~/.pi/agent/sessions/--path--/timestamp_uuid.jsonl

# Hoặc interactive: trong /resume → chọn session → Ctrl+D → confirm
```

Pi dùng `trash` CLI nếu available để tránh xóa vĩnh viễn.

---

## 6. Session Branching — `/tree`

### 6.1 Tree UI

`/tree` hiển thị **full tree** của session, cho phép navigate đến bất kỳ điểm nào:

```
├─ user: "Hello, can you help..."
│  └─ assistant: "Of course! I can..."
│     ├─ user: "Let's try approach A..."
│     │  └─ assistant: "For approach A..."
│     │     └─ [compaction: 12k tokens]
│     │        └─ user: "That worked..."  ← active
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

**Hiển thị:**
- Chiều cao: nửa terminal
- `← active` đánh dấu leaf hiện tại
- `[label-name]` hiện inline
- `⊟` / `⊞` cho foldable/folded branches
- `•` đánh dấu active path
- Children sort theo timestamp (cũ nhất trước)

### 6.2 Controls

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate (depth-first order) |
| `←` / `→` | Page up/down |
| `Ctrl+←` / `Alt+←` | Fold node / jump lên branch trước |
| `Ctrl+→` / `Alt+→` | Unfold node / jump xuống branch tiếp |
| `Enter` | Select node |
| `Escape` / `Ctrl+C` | Cancel |
| `Ctrl+U` | Toggle: chỉ user messages |
| `Ctrl+O` | Toggle: show all (custom/label entries) |

### 6.3 Selection Behavior

#### Chọn User Message hoặc Custom Message

1. Leaf set về **parent** của node được chọn
2. Message text đặt vào **editor** để re-submit
3. User sửa và submit → tạo **branch mới**

```
Trước:
  A → B → C → D ← active

Chọn C (user message):
  A → B ← leaf set về B (parent của C)
       ├─ C → D     ← branch cũ
       └─ [editor: nội dung C, chờ user sửa và submit]
```

#### Chọn Non-User Message (assistant, compaction, etc.)

1. Leaf set về **node được chọn**
2. Editor trống
3. User tiếp tục từ điểm đó

#### Chọn Root User Message (message đầu tiên)

1. Leaf reset về `null` (conversation trống)
2. Message text đặt vào editor
3. User bắt đầu lại từ đầu

### 6.4 Branch Summarization

Khi chuyển branch, Pi hỏi 3 lựa chọn:

1. **No summary** — Chuyển ngay, không summarize
2. **Summarize** — Generate summary với default prompt
3. **Summarize with custom prompt** — Mở editor nhập hướng dẫn riêng

#### Cái gì được summarize?

Path từ old leaf về common ancestor:

```
Trước navigation:

         ┌─ B ─ C ─ D ─ E ─ F  ← old leaf
    A ───┤
         └─ G ─ H              ← target

Common ancestor: A
Summarized: B, C, D, E, F (path bị abandon)
```

Summarization dừng tại:
1. Common ancestor (luôn luôn)
2. Compaction node (nếu gặp trước)

#### Summary được lưu ở đâu?

Lưu dưới dạng `BranchSummaryEntry`:

```json
{
  "type": "branch_summary",
  "parentId": "new-leaf-id",
  "fromId": "old-leaf-id",
  "summary": "Branch explored approach A, implemented feature X..."
}
```

---

## 7. Fork — `/fork`

`/fork` tạo **session file mới** từ một điểm trong history:

1. Hiện danh sách flat user messages
2. User chọn một điểm
3. Copy history đến điểm đó vào file `.jsonl` mới
4. Message text đặt vào editor

```
Session gốc: A → B → C → D → E
Fork tại C:

Session mới: A → B → [editor: nội dung C]
Session gốc: vẫn nguyên A → B → C → D → E
```

---

## 8. So Sánh `/tree` vs `/fork`

| Feature | `/tree` | `/fork` |
|---------|---------|---------|
| **View** | Full tree structure | Flat list user messages |
| **Action** | Đổi leaf trong **cùng file** | Tạo **file mới** |
| **Summary** | Optional (user chọn) | Không bao giờ |
| **Session file** | Giữ nguyên | File mới |
| **History cũ** | Giữ trong cây | Giữ trong file gốc |
| **Events** | `session_before_tree` / `session_tree` | `session_before_fork` / `session_fork` |
| **Khi nào dùng** | Thử approach khác, quay lại | Tách branch thành workspace riêng |

---

## 9. Compaction — Nén Context

### 9.1 Khi Nào Trigger

**Auto-compaction:**

```
contextTokens > contextWindow - reserveTokens (default: 16384)
```

**Manual:** `/compact [instructions]` — optional instructions focus summary.

### 9.2 Cách Hoạt Động

```
Trước compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

Sau compaction (entry mới append):

  LLM thấy:
  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   từ compaction     messages từ firstKeptEntryId
```

**Các bước:**

1. **Tìm cut point** — đi ngược từ message mới nhất, tích lũy tokens đến `keepRecentTokens` (default 20k)
2. **Trích messages** — từ compaction trước (hoặc đầu) đến cut point
3. **Generate summary** — gọi LLM summarize
4. **Append entry** — lưu `CompactionEntry` với summary + `firstKeptEntryId`
5. **Reload** — session dùng summary + messages từ `firstKeptEntryId`

**Cut point rules** — chỉ cắt tại:
- User messages
- Assistant messages
- BashExecution messages
- Custom messages

**Không bao giờ cắt** tại tool results (phải đi kèm tool call).

### 9.3 Split Turns

Khi **một turn duy nhất** vượt `keepRecentTokens` (ví dụ: user hỏi → assistant gọi 50 tools):

```
Split turn: turn quá lớn

  entry:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
                ↑                                     ↑
         turnStartIndex = 1                  firstKeptEntryId = 7
                │                                     │
                └──── turnPrefixMessages (1-6) ───────┘
```

Pi generate **2 summaries rồi merge**:
1. **History summary** — context trước đó
2. **Turn prefix summary** — phần đầu của turn bị split

### 9.4 Settings

```json
// ~/.pi/agent/settings.json hoặc .pi/settings.json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

| Setting | Default | Mô tả |
|---------|---------|--------|
| `enabled` | `true` | Bật auto-compaction |
| `reserveTokens` | `16384` | Tokens dành cho LLM response |
| `keepRecentTokens` | `20000` | Tokens gần đây giữ lại (không summarize) |

Tắt auto: `"enabled": false`. Vẫn compact được thủ công với `/compact`.

---

## 10. Summary Format

Cả compaction lẫn branch summarization dùng **cùng format**:

```markdown
## Goal
[Mục tiêu user đang cố đạt]

## Constraints & Preferences
- [Yêu cầu user đề cập]

## Progress
### Done
- [x] [Tasks đã hoàn thành]
### In Progress
- [ ] [Đang làm]
### Blocked
- [Vấn đề, nếu có]

## Key Decisions
- **[Quyết định]**: [Lý do]

## Next Steps
1. [Bước tiếp theo]

## Critical Context
- [Data cần thiết để tiếp tục]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### Cumulative File Tracking

File operations **tích lũy** qua nhiều compactions/summaries:
- Extract từ tool calls trong messages được summarize
- Merge với file ops từ compaction/summary trước đó
- Kết quả: full history files đã đọc/sửa

---

## 11. Context Building

`buildSessionContext()` walk từ leaf về root, tạo message list cho LLM:

```
1. Thu thập entries trên path (leaf → root)
2. Trích model + thinking level settings
3. Nếu có CompactionEntry trên path:
   → Emit summary trước
   → Messages từ firstKeptEntryId đến compaction
   → Messages sau compaction
4. Convert BranchSummaryEntry → BranchSummaryMessage
5. Convert CustomMessageEntry → CustomMessage
```

**LLM nhận được:**

```
[system prompt] [compaction summary?] [branch summary?] [messages...] [custom messages?]
```

---

## 12. SessionManager API

### Static Creation

```typescript
SessionManager.create(cwd)              // Session mới
SessionManager.open(path)               // Mở file session
SessionManager.continueRecent(cwd)      // Tiếp tục gần nhất
SessionManager.inMemory(cwd?)           // Không lưu file
SessionManager.forkFrom(source, cwd)    // Fork từ session khác
```

### Static Listing

```typescript
SessionManager.list(cwd)               // Sessions cho directory
SessionManager.listAll()                // Tất cả sessions
```

### Append (trả về entry ID)

```typescript
sm.appendMessage(message)                                    // Thêm message
sm.appendCompaction(summary, firstKeptEntryId, tokensBefore) // Compaction
sm.appendCustomEntry(customType, data?)                      // Extension state
sm.appendCustomMessageEntry(customType, content, display)    // Extension message
sm.appendModelChange(provider, modelId)                      // Đổi model
sm.appendThinkingLevelChange(level)                          // Đổi thinking
sm.appendLabelChange(targetId, label)                        // Label
sm.appendSessionInfo(name)                                   // Tên session
```

### Tree Navigation

```typescript
sm.getLeafId()                          // Vị trí hiện tại
sm.getLeafEntry()                       // Entry tại leaf
sm.getEntry(id)                         // Entry theo ID
sm.getBranch(fromId?)                   // Walk từ entry về root
sm.getTree()                            // Full tree
sm.getChildren(parentId)                // Children trực tiếp
sm.getLabel(id)                         // Label của entry
sm.branch(entryId)                      // Di chuyển leaf
sm.resetLeaf()                          // Reset leaf về null
sm.branchWithSummary(id, summary)       // Branch + summary
```

### Context & Info

```typescript
sm.buildSessionContext()                // Messages + model + thinking cho LLM
sm.getEntries()                         // Tất cả entries (trừ header)
sm.getHeader()                          // Session metadata
sm.getSessionName()                     // Display name
sm.getCwd()                             // Working directory
sm.getSessionFile()                     // File path
sm.isPersisted()                        // Có lưu file không
```

### Session Management

```typescript
sm.newSession(options?)                 // Session mới
sm.setSessionFile(path)                 // Switch file
sm.createBranchedSession(leafId)        // Extract branch → file mới
```

---

## 13. Extension Events

### Session lifecycle

```typescript
// Session start/shutdown
pi.on("session_start", async (_event, ctx) => { ... });
pi.on("session_shutdown", async (_event, ctx) => { ... });

// New/resume session
pi.on("session_before_switch", async (event, ctx) => {
  // event.reason: "new" | "resume"
  return { cancel: true };  // Cancel nếu cần
});
pi.on("session_switch", async (event, ctx) => { ... });
```

### Tree navigation

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;
  // preparation.targetId, oldLeafId, commonAncestorId
  // preparation.entriesToSummarize, userWantsSummary

  return { cancel: true };  // Cancel navigation
  // HOẶC custom summary:
  return { summary: { summary: "...", details: {} } };
});

pi.on("session_tree", async (event, ctx) => {
  // event.newLeafId, oldLeafId, summaryEntry, fromHook
});
```

### Fork

```typescript
pi.on("session_before_fork", async (event, ctx) => {
  return { cancel: true };
  return { skipConversationRestore: true };
});
pi.on("session_fork", async (event, ctx) => { ... });
```

### Compaction

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;

  return { cancel: true };
  // HOẶC custom summary:
  return {
    compaction: {
      summary: "...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }
  };
});
pi.on("session_compact", async (event, ctx) => { ... });
```

---

## 14. Custom Summarization

### Custom compaction via extension

```typescript
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

pi.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;

  // Convert messages → text
  const conversationText = serializeConversation(
    convertToLlm(preparation.messagesToSummarize)
  );
  // Output format:
  // [User]: message text
  // [Assistant thinking]: thinking content
  // [Assistant]: response text
  // [Assistant tool calls]: read(path="..."); bash(command="...")
  // [Tool result]: output text

  // Gửi cho model khác summarize
  const summary = await myModel.summarize(conversationText);

  return {
    compaction: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }
  };
});
```

### Custom tree summarizer

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  if (!event.preparation.userWantsSummary) return;
  if (event.preparation.entriesToSummarize.length === 0) return;

  const summary = await myCustomSummarizer(event.preparation.entriesToSummarize);
  return { summary: { summary, details: { custom: true } } };
});
```

---

## 15. Parsing Sessions

### Đọc file JSONL

```typescript
import { readFileSync } from "fs";

const lines = readFileSync("session.jsonl", "utf8").trim().split("\n");

for (const line of lines) {
  const entry = JSON.parse(line);

  switch (entry.type) {
    case "session":
      console.log(`Session v${entry.version}: ${entry.id}`);
      break;
    case "message":
      console.log(`[${entry.id}] ${entry.message.role}: ${JSON.stringify(entry.message.content)}`);
      break;
    case "compaction":
      console.log(`[${entry.id}] Compaction: ${entry.tokensBefore} tokens`);
      break;
    case "branch_summary":
      console.log(`[${entry.id}] Branch from ${entry.fromId}`);
      break;
    case "custom":
      console.log(`[${entry.id}] Custom (${entry.customType})`);
      break;
    case "label":
      console.log(`[${entry.id}] Label "${entry.label}" on ${entry.targetId}`);
      break;
    case "model_change":
      console.log(`[${entry.id}] Model: ${entry.provider}/${entry.modelId}`);
      break;
  }
}
```

### Reconstruct branch

```typescript
// Từ extension
pi.on("session_start", async (_event, ctx) => {
  const branch = ctx.sessionManager.getBranch(); // Walk leaf → root
  for (const entry of branch) {
    if (entry.type === "message") {
      console.log(`${entry.message.role}: ...`);
    }
  }
});
```

---

## 16. Tips & Best Practices

### Session branching

- Dùng `/tree` khi muốn **thử approach khác** mà giữ history cũ
- Dùng `/fork` khi muốn **tách workspace riêng** từ một điểm
- **Summarize** khi chuyển branch nếu branch cũ có context quan trọng
- **Labels** (`pi.setLabel()`) để đánh dấu checkpoints quan trọng

### Compaction

- Để auto-compaction bật (`enabled: true`) — Pi xử lý tốt
- Tăng `keepRecentTokens` nếu task cần nhiều context gần đây
- `/compact` thủ công khi muốn focus summary (truyền instructions)
- Custom compaction via extension nếu cần summarize theo cách riêng

### Session management

- `/name` đặt tên cho sessions dễ tìm lại trong `/resume`
- Dùng `--no-session` cho one-off tasks không cần lưu
- `-c` để tiếp tục session gần nhất nhanh chóng
- Xóa sessions cũ định kỳ để tiết kiệm disk

### Extension state

- Lưu state trong `details` của tool results → hỗ trợ branching tự nhiên
- Dùng `pi.appendEntry()` cho state persist không cần trong LLM context
- Reconstruct state từ `session_start` event bằng cách scan entries

---

## Tham Khảo

- **Session docs:** [session.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md)
- **Tree docs:** [tree.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tree.md)
- **Compaction docs:** [compaction.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md)
- **Source — SessionManager:** [session-manager.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts)
- **Source — Compaction:** [compaction.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts)
- **Source — Branch summarization:** [branch-summarization.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts)
- **Example — Custom compaction:** [custom-compaction.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/custom-compaction.ts)
- **Example — Git checkpoint:** [git-checkpoint.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/git-checkpoint.ts)
