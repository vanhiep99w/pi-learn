# 🗜️ Pi — Compaction & Branch Summarization Deep Dive

> Tài liệu tìm hiểu chi tiết cơ chế **Compaction** (nén context) và **Branch Summarization** (tóm tắt nhánh) trong Pi Coding Agent.  
> Tổng hợp từ [official docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs) & source code analysis.

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Compaction — Nén Context](#2-compaction--nén-context)
  - [2.1 Khi Nào Trigger](#21-khi-nào-trigger)
  - [2.2 Cách Hoạt Động Chi Tiết](#22-cách-hoạt-động-chi-tiết)
  - [2.3 Cut Point — Quy Tắc Cắt](#23-cut-point--quy-tắc-cắt)
  - [2.4 Split Turn — Khi Một Turn Quá Lớn](#24-split-turn--khi-một-turn-quá-lớn)
  - [2.5 CompactionEntry Structure](#25-compactionentry-structure)
  - [2.6 Token Estimation](#26-token-estimation)
- [3. Branch Summarization — Tóm Tắt Nhánh](#3-branch-summarization--tóm-tắt-nhánh)
  - [3.1 Khi Nào Trigger](#31-khi-nào-trigger)
  - [3.2 Cách Hoạt Động Chi Tiết](#32-cách-hoạt-động-chi-tiết)
  - [3.3 BranchSummaryEntry Structure](#33-branchsummaryentry-structure)
  - [3.4 Cumulative File Tracking](#34-cumulative-file-tracking)
- [4. Summary Format — Định Dạng Tóm Tắt](#4-summary-format--định-dạng-tóm-tắt)
  - [4.1 Format Chung](#41-format-chung)
  - [4.2 Message Serialization](#42-message-serialization)
  - [4.3 Summarization Prompts](#43-summarization-prompts)
- [5. File Operation Tracking](#5-file-operation-tracking)
- [6. Custom Summarization qua Extensions](#6-custom-summarization-qua-extensions)
  - [6.1 session_before_compact](#61-session_before_compact)
  - [6.2 session_before_tree](#62-session_before_tree)
  - [6.3 session_tree (Post-event)](#63-session_tree-post-event)
- [7. Settings](#7-settings)
- [8. Source Code Map](#8-source-code-map)
- [9. So Sánh Compaction vs Branch Summarization](#9-so-sánh-compaction-vs-branch-summarization)
- [10. Best Practices & Tips](#10-best-practices--tips)
- [11. Ví Dụ Thực Tế](#11-ví-dụ-thực-tế)

---

## 1. Tổng Quan

LLM có **context window giới hạn** (ví dụ: 128k–200k tokens). Khi conversation dài quá, không thể gửi hết lên LLM. Pi giải quyết bằng 2 cơ chế:

| Cơ Chế | Trigger | Mục Đích |
|--------|---------|----------|
| **Compaction** | Context vượt ngưỡng, hoặc `/compact` | Nén messages cũ → giải phóng context |
| **Branch Summarization** | `/tree` navigation | Bảo toàn context khi chuyển nhánh |

Cả hai đều:
- Dùng **cùng structured summary format**
- **Track file operations cumulatively** (đọc/write/edit file nào)
- Có thể **customize qua Extensions** (hook events)
- Gọi **LLM để generate summary** (dùng `completeSimple()`)

---

## 2. Compaction — Nén Context

### 2.1 Khi Nào Trigger

**Auto-compaction** trigger khi:

```
contextTokens > contextWindow - reserveTokens
```

- `reserveTokens` mặc định: **16384** (dự phòng cho response của LLM)
- Kiểm tra sau mỗi assistant response (dựa trên `usage` data)

**Manual compaction**: `/compact [instructions]`

- `instructions` (tùy chọn): hướng dẫn tập trung summary vào gì
- Ví dụ: `/compact Focus on the database schema changes`

> **Hàm kiểm tra:** `shouldCompact(contextTokens, contextWindow, settings)` trong `compaction.ts`

### 2.2 Cách Hoạt Động Chi Tiết

Compaction gồm 5 bước:

```
Bước 1: Tìm cut point
   → Đi ngược từ message mới nhất, tính tokens
   → Giữ ~keepRecentTokens (mặc định 20k) gần nhất

Bước 2: Trích xuất messages
   → Từ compaction trước (hoặc đầu session) đến cut point

Bước 3: Generate summary
   → Gọi LLM summarize với structured format
   → Nếu có previous summary → dùng UPDATE_SUMMARIZATION_PROMPT (merge)
   → Nếu không → dùng SUMMARIZATION_PROMPT (tạo mới)

Bước 4: Append CompactionEntry
   → Lưu vào session file (JSONL)
   → Chứa summary + firstKeptEntryId + tokensBefore

Bước 5: Reload session
   → Session chỉ gửi LLM: [system] + [summary] + [kept messages]
```

#### Diagram trước/sau compaction:

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

Sau compaction (entry 10 được append):

  entry:  0     1     2     3      4     5     6      7      8     9     10
        ┌─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

LLM thấy:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

> **Quan trọng**: Messages cũ **không bị xóa** khỏi session file. Chỉ là LLM không nhìn thấy nữa. Bạn vẫn có thể dùng `/tree` để navigate lại lịch sử đầy đủ.

### 2.3 Cut Point — Quy Tắc Cắt

Cut point hợp lệ là index của các loại message sau:

| Message Type | Hợp Lệ? | Lý Do |
|-------------|----------|-------|
| **User** | ✅ | Bắt đầu turn mới |
| **Assistant** | ✅ | Có thể cắt giữa turn (split turn) |
| **BashExecution** | ✅ | User-initiated context |
| **Custom** (custom_message) | ✅ | Extension message |
| **BranchSummary** | ✅ | User-role message |
| **ToolResult** | ❌ | **PHẢI đi kèm tool call** |

> **Quy tắc vàng**: Không bao giờ cắt tại `toolResult` — nó phải gắn liền với `toolCall` trong assistant message.

**Thuật toán `findCutPoint()`:**

```typescript
// Pseudocode
1. Tìm tất cả valid cut points trong [startIndex, endIndex)
2. Walk backwards từ endIndex, accumulate token estimates
3. Khi accumulatedTokens >= keepRecentTokens → dừng
4. Tìm cut point gần nhất tại hoặc sau vị trí dừng
5. Scan ngược để include non-message entries (settings changes...)
6. Xác định: là split turn hay không?
```

### 2.4 Split Turn — Khi Một Turn Quá Lớn

Một "turn" bắt đầu từ user message và bao gồm mọi assistant response + tool calls cho đến user message kế tiếp.

Khi **một turn đơn lẻ vượt quá `keepRecentTokens`**, cut point rơi vào giữa turn tại một assistant message. Đây gọi là **"split turn"**:

```
Split turn (một turn khổng lồ vượt budget):

  entry:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
                ↑                                     ↑
         turnStartIndex = 1                  firstKeptEntryId = 7
                │                                     │
                └──── turnPrefixMessages (1-6) ───────┘
                                                      └── kept (7-8)

  isSplitTurn = true
  messagesToSummarize = []  (không có complete turns trước đó)
  turnPrefixMessages = [usr, ass, tool, ass, tool, tool]
```

Pi xử lý split turn bằng cách generate **2 summaries song song** rồi merge:

1. **History summary**: Context trước đó (nếu có) — dùng `SUMMARIZATION_PROMPT` hoặc `UPDATE_SUMMARIZATION_PROMPT`
2. **Turn prefix summary**: Phần đầu của split turn — dùng `TURN_PREFIX_SUMMARIZATION_PROMPT`

```
Merged summary = historySummary + "\n\n---\n\n**Turn Context (split turn):**\n\n" + turnPrefixSummary
```

### 2.5 CompactionEntry Structure

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;              // UUID
  parentId: string;        // UUID của entry trước
  timestamp: number;       // Unix timestamp
  summary: string;         // LLM-generated summary
  firstKeptEntryId: string; // ID entry đầu tiên được giữ lại
  tokensBefore: number;    // Tokens trước khi compact
  fromHook?: boolean;      // true nếu do extension cung cấp
  details?: T;             // Data bổ sung (default: CompactionDetails)
}

// Default compaction details:
interface CompactionDetails {
  readFiles: string[];     // Files đã đọc
  modifiedFiles: string[]; // Files đã sửa
}
```

Ví dụ trong session file (JSONL):

```json
{"type":"compaction","id":"f6g7h8i9","parentId":"e5f6g7h8","timestamp":"2024-12-03T14:10:00.000Z","summary":"User discussed X, Y, Z...","firstKeptEntryId":"c3d4e5f6","tokensBefore":50000}
```

### 2.6 Token Estimation

Pi dùng **heuristic chars/4** để ước lượng tokens (conservative — overestimate):

```typescript
function estimateTokens(message: AgentMessage): number {
  // Tính tổng characters rồi chia 4
  // - User message: text content
  // - Assistant: text + thinking + toolCall arguments
  // - ToolResult/Custom: text content
  // - Image: estimate 4800 chars (≈1200 tokens)
  // - BashExecution: command + output
  // - BranchSummary/CompactionSummary: summary text
  return Math.ceil(chars / 4);
}
```

**Context token estimation** (dùng cho `shouldCompact()`):

```typescript
function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  // 1. Tìm assistant message gần nhất có usage data
  // 2. Dùng usage.totalTokens làm base
  // 3. Estimate trailing messages (sau usage) bằng chars/4
  // 4. Total = usageTokens + trailingTokens
}
```

> **Tại sao dùng heuristic?** Vì counting tokens chính xác cần tokenizer riêng cho mỗi model. Chars/4 đủ tốt cho mục đích quyết định compaction.

---

## 3. Branch Summarization — Tóm Tắt Nhánh

### 3.1 Khi Nào Trigger

Khi dùng `/tree` navigate sang nhánh khác, Pi hiện **3 lựa chọn**:

| Lựa Chọn | Mô Tả |
|-----------|--------|
| **No summary** | Chuyển ngay, không tóm tắt |
| **Summarize** | Tóm tắt với prompt mặc định |
| **Summarize with custom prompt** | Mở editor nhập instructions riêng, append vào default prompt |

Setting `branchSummary.skipPrompt: true` → bỏ qua prompt này, luôn chuyển không tóm tắt.

### 3.2 Cách Hoạt Động Chi Tiết

```
Bước 1: Tìm common ancestor
   → Node sâu nhất mà cả old leaf và target đều chia sẻ

Bước 2: Thu thập entries
   → Walk từ old leaf ngược về common ancestor
   → KHÔNG dừng tại compaction boundaries (bao gồm cả chúng)

Bước 3: Prepare với token budget
   → Walk entries từ MỚI NHẤT → CŨ NHẤT
   → Thêm messages cho đến khi hết budget
   → Summary entries (compaction/branch_summary) được ưu tiên fit

Bước 4: Generate summary
   → Serialize conversation → text
   → Gọi LLM với BRANCH_SUMMARY_PROMPT
   → Prepend "The user explored a different conversation branch..."

Bước 5: Append BranchSummaryEntry
   → Lưu tại point navigation, chứa summary + fromId
```

#### Diagram:

```
Tree trước navigation:

         ┌─ B ─ C ─ D (old leaf, đang bỏ)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries cần summarize: B, C, D

Sau navigation + summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

Summarization dừng tại:
1. **Common ancestor** (luôn luôn)
2. **Compaction node** (nếu gặp trước) — compaction summary trở thành context

#### Ví dụ phức tạp hơn:

```
A → B → C → D → E → F  ← old leaf
        ↘ G → H        ← target

Common ancestor: B (không phải C!)
Abandoned path: C → D → E → F (được summarize)
```

### 3.3 BranchSummaryEntry Structure

```typescript
interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  id: string;              // UUID
  parentId: string;        // New leaf position
  timestamp: number;
  summary: string;         // LLM-generated summary
  fromId: string;          // Old leaf ID (nhánh bị bỏ)
  fromHook?: boolean;      // true nếu do extension cung cấp
  details?: T;             // Data bổ sung (default: BranchSummaryDetails)
}

// Default details:
interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

Ví dụ trong session file:

```json
{"type":"branch_summary","id":"g7h8i9j0","parentId":"a1b2c3d4","timestamp":"2024-12-03T14:15:00.000Z","fromId":"f6g7h8i9","summary":"Branch explored approach A..."}
```

### 3.4 Cumulative File Tracking

Cả compaction và branch summarization **track files cumulatively** (tích lũy). Khi generate summary, Pi trích xuất file operations từ:

1. **Tool calls** trong messages đang summarize
2. **Previous compaction/branch summary `details`** (nếu có, chỉ từ pi-generated — `fromHook !== true`)

```
Compaction 1: read=[a.ts, b.ts], modified=[c.ts]
    ↓
Compaction 2: cộng thêm → read=[a.ts, b.ts, d.ts], modified=[c.ts, e.ts]
    ↓
Branch summary: cộng tất cả → read=[...], modified=[...]
```

> Điều này đảm bảo **lịch sử file operations đầy đủ** được bảo toàn qua nhiều compactions hoặc nested branch summaries.

**Logic trong source code:**

```typescript
// compaction.ts - extractFileOperations()
// 1. Lấy details từ previous CompactionEntry
if (!prevCompaction.fromHook && prevCompaction.details) {
  const details = prevCompaction.details as CompactionDetails;
  for (const f of details.readFiles) fileOps.read.add(f);
  for (const f of details.modifiedFiles) fileOps.edited.add(f);
}
// 2. Extract từ tool calls trong messages
for (const msg of messages) {
  extractFileOpsFromMessage(msg, fileOps);
}
```

```typescript
// utils.ts - computeFileLists()
// modified = edited ∪ written
// readOnly = read - modified (chỉ đọc, không sửa)
```

---

## 4. Summary Format — Định Dạng Tóm Tắt

### 4.1 Format Chung

Cả compaction và branch summarization dùng **cùng structured format**:

```markdown
## Goal
[User đang cố gắng làm gì? Có thể nhiều items nếu session cover nhiều tasks.]

## Constraints & Preferences
- [Yêu cầu, ràng buộc, preferences user đề cập]
- [Hoặc "(none)" nếu không có]

## Progress
### Done
- [x] [Tasks/changes đã hoàn thành]

### In Progress
- [ ] [Công việc đang làm dở]

### Blocked
- [Issues cản trở tiến độ, nếu có]

## Key Decisions
- **[Quyết định]**: [Lý do ngắn gọn]

## Next Steps
1. [Thứ tự việc cần làm tiếp]

## Critical Context
- [Data, examples, hoặc references cần để tiếp tục]
- [Hoặc "(none)" nếu không áp dụng]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### 4.2 Message Serialization

Trước khi gửi cho LLM summarize, messages được **serialize thành text** qua `serializeConversation()`:

```
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool
```

**Tại sao serialize?** Để model không coi đó là conversation cần continue, mà chỉ là text cần summarize.

**Tool result truncation**: Giới hạn **2000 characters**. Phần vượt quá bị thay bằng:

```
[... 15000 more characters truncated]
```

> Tool results (đặc biệt `read` và `bash`) thường là phần lớn nhất trong context. Truncation giữ summarization request ở mức hợp lý.

### 4.3 Summarization Prompts

Pi dùng các prompt khác nhau tùy tình huống:

| Prompt | Khi Nào | Mô Tả |
|--------|---------|--------|
| **SUMMARIZATION_SYSTEM_PROMPT** | Luôn luôn | System prompt cho summarization model |
| **SUMMARIZATION_PROMPT** | Compaction lần đầu | Tạo summary mới |
| **UPDATE_SUMMARIZATION_PROMPT** | Compaction có previous summary | Merge summary mới vào cũ |
| **TURN_PREFIX_SUMMARIZATION_PROMPT** | Split turn | Summarize prefix của turn bị cắt |
| **BRANCH_SUMMARY_PROMPT** | Branch summarization | Tóm tắt nhánh bỏ đi |

#### System Prompt:

```
You are a context summarization assistant. Your task is to read a conversation 
between a user and an AI coding assistant, then produce a structured summary 
following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the 
conversation. ONLY output the structured summary.
```

#### Update Summarization (cho compaction liên tiếp):

```
RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it
```

#### Turn Prefix Summarization:

```
This is the PREFIX of a turn that was too large to keep. 
The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]
```

#### Branch Summary Preamble:

Summary được prepend:

```
The user explored a different conversation branch before returning here.
Summary of that exploration:

[actual summary content]
```

---

## 5. File Operation Tracking

### Data Structure

```typescript
interface FileOperations {
  read: Set<string>;    // Files đọc (read tool)
  written: Set<string>; // Files ghi mới (write tool)
  edited: Set<string>;  // Files chỉnh sửa (edit tool)
}
```

### Extraction từ Tool Calls

`extractFileOpsFromMessage()` scan assistant messages:

```typescript
// Chỉ xử lý toolCall blocks
for (const block of assistantMessage.content) {
  if (block.type !== "toolCall") continue;
  const path = block.arguments.path;
  switch (block.name) {
    case "read":  fileOps.read.add(path);    break;
    case "write": fileOps.written.add(path); break;
    case "edit":  fileOps.edited.add(path);  break;
  }
}
```

### Final Output

`computeFileLists()` tính:

```
modifiedFiles = edited ∪ written
readFiles = read - modifiedFiles  (loại bỏ files đã sửa)
```

> Nếu file vừa đọc vừa sửa → chỉ xuất hiện trong `modifiedFiles`.

### Format trong Summary

```xml
<read-files>
src/utils.ts
src/config.ts
</read-files>

<modified-files>
src/main.ts
src/handler.ts
</modified-files>
```

---

## 6. Custom Summarization qua Extensions

Extensions có thể intercept và customize cả compaction lẫn branch summarization.

### 6.1 session_before_compact

Fired **trước** auto-compaction hoặc `/compact`. Có thể **cancel** hoặc **cung cấp custom summary**.

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;

  // === preparation chứa tất cả data đã pre-calculate ===
  // preparation.messagesToSummarize   - messages sẽ bị summarize
  // preparation.turnPrefixMessages    - split turn prefix (nếu isSplitTurn)
  // preparation.previousSummary       - summary compaction trước
  // preparation.fileOps               - file operations đã extract
  // preparation.tokensBefore          - context tokens trước compaction
  // preparation.firstKeptEntryId      - nơi kept messages bắt đầu
  // preparation.settings              - compaction settings
  // preparation.isSplitTurn           - có phải split turn không

  // branchEntries - tất cả entries trên branch hiện tại
  // signal        - AbortSignal (truyền cho LLM calls)

  // === Tùy chọn 1: Cancel compaction ===
  return { cancel: true };

  // === Tùy chọn 2: Custom summary ===
  return {
    compaction: {
      summary: "Your custom summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: { /* custom data — any JSON-serializable */ },
    }
  };
});
```

#### Dùng model khác để summarize:

```typescript
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

pi.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;
  
  // Convert AgentMessage[] → Message[] → text
  const conversationText = serializeConversation(
    convertToLlm(preparation.messagesToSummarize)
  );

  // Gọi model riêng
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

### 6.2 session_before_tree

Fired **trước** `/tree` navigation. Luôn fire bất kể user có chọn summarize hay không.

```typescript
interface TreePreparation {
  targetId: string;                    // Nơi sẽ navigate đến
  oldLeafId: string | null;           // Vị trí hiện tại
  commonAncestorId: string | null;    // Ancestor chung
  entriesToSummarize: SessionEntry[]; // Entries sẽ bị summarize
  userWantsSummary: boolean;          // User có chọn summarize?
  customInstructions?: string;        // Custom instructions
  replaceInstructions?: boolean;      // Replace hay append
  label?: string;                     // Label cho entry
}

pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;

  // Cancel navigation:
  return { cancel: true };

  // Custom summary (chỉ dùng nếu userWantsSummary = true):
  if (preparation.userWantsSummary) {
    return {
      summary: {
        summary: "Your custom branch summary...",
        details: { /* custom data */ },
      }
    };
  }

  // Override instructions:
  return {
    customInstructions: "Focus on error handling decisions",
    replaceInstructions: false,
    label: "checkpoint-api-refactor",
  };
});
```

### 6.3 session_tree (Post-event)

Fired **sau** navigation hoàn tất. Chỉ để notification, không thể cancel.

```typescript
interface SessionTreeEvent {
  type: "session_tree";
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: BranchSummaryEntry;  // undefined nếu không summarize
  fromHook?: boolean;                  // true nếu summary từ extension
}

pi.on("session_tree", async (event, ctx) => {
  console.log(`Navigated from ${event.oldLeafId} to ${event.newLeafId}`);
  if (event.summaryEntry) {
    console.log(`Summary created: ${event.summaryEntry.id}`);
  }
});
```

---

## 7. Settings

### Compaction Settings

Trong `~/.pi/agent/settings.json` hoặc `<project>/.pi/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

| Setting | Type | Default | Mô Tả |
|---------|------|---------|--------|
| `compaction.enabled` | boolean | `true` | Bật auto-compaction |
| `compaction.reserveTokens` | number | `16384` | Tokens dự phòng cho LLM response |
| `compaction.keepRecentTokens` | number | `20000` | Tokens gần đây giữ lại (không summarize) |

> Tắt auto-compaction: `"enabled": false`. Vẫn có thể compact thủ công bằng `/compact`.

### Branch Summary Settings

```json
{
  "branchSummary": {
    "reserveTokens": 16384,
    "skipPrompt": false
  }
}
```

| Setting | Type | Default | Mô Tả |
|---------|------|---------|--------|
| `branchSummary.reserveTokens` | number | `16384` | Tokens dự phòng cho branch summarization |
| `branchSummary.skipPrompt` | boolean | `false` | Bỏ qua "Summarize branch?" prompt (mặc định: không summary) |

---

## 8. Source Code Map

| File | Chức Năng |
|------|-----------|
| [`compaction.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) | Auto-compaction logic: token estimation, cut point, summary generation |
| [`branch-summarization.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) | Branch summarization: entry collection, preparation, generation |
| [`utils.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/utils.ts) | Shared: file tracking, message serialization, system prompt |
| [`session-manager.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts) | Entry types (`CompactionEntry`, `BranchSummaryEntry`), tree navigation |
| [`extensions/types.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts) | Extension event types |

### Key Functions

| Function | File | Mô Tả |
|----------|------|--------|
| `shouldCompact()` | compaction.ts | Kiểm tra cần compact không |
| `estimateTokens()` | compaction.ts | Ước lượng tokens của message |
| `estimateContextTokens()` | compaction.ts | Ước lượng tổng context tokens |
| `findCutPoint()` | compaction.ts | Tìm điểm cắt tối ưu |
| `findTurnStartIndex()` | compaction.ts | Tìm user message bắt đầu turn |
| `prepareCompaction()` | compaction.ts | Chuẩn bị data cho compaction |
| `compact()` | compaction.ts | Thực hiện compaction (gọi LLM) |
| `generateSummary()` | compaction.ts | Gọi LLM generate summary |
| `collectEntriesForBranchSummary()` | branch-summarization.ts | Thu thập entries cần summarize |
| `prepareBranchEntries()` | branch-summarization.ts | Prepare với token budget |
| `generateBranchSummary()` | branch-summarization.ts | Gọi LLM generate branch summary |
| `serializeConversation()` | utils.ts | Serialize messages thành text |
| `extractFileOpsFromMessage()` | utils.ts | Extract file ops từ tool calls |
| `computeFileLists()` | utils.ts | Tính final read/modified files |
| `formatFileOperations()` | utils.ts | Format file ops thành XML tags |

---

## 9. So Sánh Compaction vs Branch Summarization

| Tiêu Chí | Compaction | Branch Summarization |
|-----------|-----------|---------------------|
| **Trigger** | Context quá dài / `/compact` | `/tree` navigation |
| **Mục đích** | Giải phóng context window | Bảo toàn context khi chuyển nhánh |
| **Messages bị summarize** | Cũ nhất → cut point | Từ old leaf → common ancestor |
| **Hướng walk** | Backward (mới → cũ) tìm cut | Backward (leaf → ancestor) |
| **Summary vị trí** | Append cuối branch | Append tại point navigation |
| **Entry type** | `CompactionEntry` | `BranchSummaryEntry` |
| **Message type (LLM context)** | `CompactionSummaryMessage` | `BranchSummaryMessage` |
| **Previous summary** | Sử dụng (iterative update) | Không có previous |
| **Split turn** | Có hỗ trợ | Không cần |
| **Token budget** | `keepRecentTokens` | `contextWindow - reserveTokens` |
| **File tracking** | Cumulative qua compactions | Cumulative qua branch summaries |
| **Custom hook** | `session_before_compact` | `session_before_tree` |
| **Có thể cancel** | ✅ | ✅ |
| **maxTokens cho LLM** | `0.8 × reserveTokens` | `2048` (fixed) |

---

## 10. Best Practices & Tips

### Khi nào nên dùng `/compact` thủ công?

- Conversation bắt đầu đi chệch hướng → compact với instructions tập trung
- Muốn "reset" context nhưng giữ lại progress
- Debug: muốn kiểm soát chính xác LLM thấy gì

```
/compact Focus on the TypeScript refactoring, ignore the earlier Python discussion
```

### Khi nào nên summarize khi chuyển branch?

- **Nên summarize**: Khi branch có nhiều work và bạn có thể quay lại
- **Không cần**: Khi branch chỉ là thử nghiệm nhanh, không có value

### Tối ưu settings

| Tình Huống | Gợi Ý |
|-----------|--------|
| Model context nhỏ (32k) | Giảm `keepRecentTokens` xuống 10k-15k |
| Muốn giữ nhiều history | Tăng `keepRecentTokens` lên 30k-40k |
| Compaction quá thường xuyên | Tăng `reserveTokens` |
| Không muốn auto-compact | `"enabled": false`, dùng `/compact` thủ công |
| Không muốn prompt summarize mỗi lần chuyển branch | `"branchSummary.skipPrompt": true` |

### Extension development

- Luôn check `event.preparation` trước khi generate custom summary
- Pass `signal` (AbortSignal) cho mọi LLM calls
- Return `{ cancel: true }` nếu muốn skip compaction
- Dùng `serializeConversation(convertToLlm(messages))` để chuyển messages → text
- Lưu custom data trong `details` field — JSON-serializable

---

## 11. Ví Dụ Thực Tế

### Flow Compaction Điển Hình

```
Bạn chat 50 messages với Pi, sửa nhiều files...

1. Pi gọi LLM → response có usage: { input: 95000, output: 2000, ... }
2. Pi tính: contextTokens = 97000
3. shouldCompact(97000, 128000, { reserveTokens: 16384 })
   → 97000 > 128000 - 16384 = 111616? → Chưa!

... chat thêm 20 messages ...

4. contextTokens = 115000
5. shouldCompact(115000, 128000, { reserveTokens: 16384 })  
   → 115000 > 111616? → ✅ Trigger!
6. findCutPoint() → giữ 20k tokens mới nhất
7. generateSummary() → LLM tóm tắt messages cũ
8. appendCompaction() → lưu summary
9. Session reload → LLM chỉ thấy: system + summary + 20k tokens mới
```

### Flow Branch Summarization Điển Hình

```
Bạn đang làm feature A...

[user: "Implement auth"]
  [assistant: "Done!"]
    [user: "Now add tests"]
      [assistant: "Tests added"]        ← current leaf

Nhấn Escape×2 mở /tree
Chọn navigate về "Implement auth"
Pi hỏi: "Summarize branch?"
Chọn "Summarize"

→ Pi summarize: "Now add tests" + "Tests added"
→ BranchSummaryEntry append
→ Navigate về branch mới
→ LLM thấy summary: "The user explored a different conversation branch..."
```

### Custom Compaction Extension

```typescript
// .pi/extensions/smart-compaction.ts
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

export default function(pi: HookAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, signal } = event;
    
    // Chỉ custom nếu có quá nhiều messages
    if (preparation.messagesToSummarize.length < 10) {
      return; // Let default compaction handle
    }

    // Dùng cheaper model cho summarization
    const text = serializeConversation(
      convertToLlm(preparation.messagesToSummarize)
    );
    
    const summary = await cheaperModel.complete(
      `Summarize this coding session concisely:\n${text}`
    );

    return {
      compaction: {
        summary,
        firstKeptEntryId: preparation.firstKeptEntryId,
        tokensBefore: preparation.tokensBefore,
        details: { model: "gpt-4o-mini", messageCount: preparation.messagesToSummarize.length },
      }
    };
  });
}
```

---

## Tham Khảo

- [Official compaction docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md)
- [Session docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md)
- [Tree navigation docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tree.md)
- [Settings docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)
- [Source: compaction.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts)
- [Source: branch-summarization.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts)
- [Source: utils.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/compaction/utils.ts)
