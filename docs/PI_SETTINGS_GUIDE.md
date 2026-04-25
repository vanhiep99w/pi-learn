# ⚙️ Pi Settings — Hướng Dẫn Chi Tiết

> Tham khảo từ [packages/coding-agent/docs/settings.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)  
> Gõ `/settings` trong Pi để chỉnh nhanh các tuỳ chọn phổ biến!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Vị Trí File Settings](#2-vị-trí-file-settings)
- [3. Model & Thinking](#3-model--thinking)
  - [3.1 Các Setting Cơ Bản](#31-các-setting-cơ-bản)
  - [3.2 thinkingBudgets](#32-thinkingbudgets)
- [4. UI & Display](#4-ui--display)
- [5. Compaction](#5-compaction)
- [6. Branch Summary](#6-branch-summary)
- [7. Retry](#7-retry)
- [8. Message Delivery](#8-message-delivery)
- [9. Terminal & Images](#9-terminal--images)
- [10. Shell](#10-shell)
- [11. Sessions](#11-sessions)
- [12. Model Cycling](#12-model-cycling)
- [13. Markdown](#13-markdown)
- [14. Resources](#14-resources)
  - [14.1 Đường Dẫn & Glob](#141-đường-dẫn--glob)
  - [14.2 packages](#142-packages)
- [15. Full Example](#15-full-example)
- [16. Project Overrides — Merge Semantics](#16-project-overrides--merge-semantics)

---

## 1. Tổng Quan

Pi sử dụng **JSON settings files** để cấu hình toàn bộ hành vi — từ model, theme, compaction, retry, cho đến shell và resources. Settings ở cấp project sẽ **override** settings global, với nested objects được **merge** (không phải replace).

### Đặc điểm chính

| Đặc điểm | Mô tả |
|-----------|--------|
| 📁 **JSON format** | Dễ đọc, dễ sửa tay hoặc qua `/settings` |
| 🔀 **2 cấp** | Global (mọi project) + Project (thư mục hiện tại) |
| 🧩 **Deep merge** | Project settings merge vào global — chỉ override field cần thay đổi |
| ⚡ **Hiệu lực ngay** | Hầu hết settings áp dụng khi restart Pi |

---

## 2. Vị Trí File Settings

| File | Scope | Mô tả |
|------|-------|--------|
| `~/.pi/agent/settings.json` | **Global** | Áp dụng cho tất cả projects |
| `.pi/settings.json` | **Project** | Chỉ áp dụng trong thư mục hiện tại |

### Cách chỉnh settings

**Cách 1: Interactive** — Gõ `/settings` trong Pi để chọn từ menu.

**Cách 2: Sửa file trực tiếp** — Mở file JSON bằng editor bất kỳ:

```bash
# Global settings
nano ~/.pi/agent/settings.json

# Project settings
nano .pi/settings.json
```

> 💡 **Lưu ý:** Đường dẫn trong `~/.pi/agent/settings.json` resolve relative tới `~/.pi/agent`. Đường dẫn trong `.pi/settings.json` resolve relative tới `.pi`. Hỗ trợ absolute paths và `~`.

---

## 3. Model & Thinking

Cấu hình provider, model, và mức thinking mặc định.

### 3.1 Các Setting Cơ Bản

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `defaultProvider` | string | - | Provider mặc định (vd: `"anthropic"`, `"openai"`) |
| `defaultModel` | string | - | Model ID mặc định |
| `defaultThinkingLevel` | string | - | Mức thinking: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` |
| `hideThinkingBlock` | boolean | `false` | Ẩn thinking blocks trong output |
| `thinkingBudgets` | object | - | Token budget tuỳ chỉnh cho từng thinking level |

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "hideThinkingBlock": false
}
```

### 3.2 thinkingBudgets

Tuỳ chỉnh số token dành cho thinking ở mỗi mức:

```json
{
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  }
}
```

> 💡 **Giải thích các level:**
> - `off` — Tắt thinking hoàn toàn
> - `minimal` — Suy nghĩ rất ngắn, tiết kiệm token
> - `low` — Suy nghĩ cơ bản
> - `medium` — Cân bằng giữa chất lượng và chi phí
> - `high` — Suy nghĩ sâu, phù hợp task phức tạp
> - `xhigh` — Maximum thinking, dùng cho task rất khó

---

## 4. UI & Display

Cấu hình giao diện TUI của Pi.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `theme` | string | `"dark"` | Tên theme: `"dark"`, `"light"`, hoặc custom theme |
| `quietStartup` | boolean | `false` | Ẩn header khi khởi động |
| `collapseChangelog` | boolean | `false` | Hiện changelog ngắn gọn sau khi cập nhật |
| `doubleEscapeAction` | string | `"tree"` | Hành động khi nhấn Esc 2 lần: `"tree"`, `"fork"`, hoặc `"none"` |
| `treeFilterMode` | string | `"default"` | Bộ lọc mặc định cho `/tree` |
| `editorPaddingX` | number | `0` | Padding ngang cho input editor (0–3) |
| `autocompleteMaxVisible` | number | `5` | Số item tối đa hiện trong autocomplete dropdown (3–20) |
| `showHardwareCursor` | boolean | `false` | Hiện terminal cursor phần cứng |

### treeFilterMode — Các giá trị

| Giá trị | Mô tả |
|---------|--------|
| `"default"` | Hiện mặc định (user + assistant messages, ẩn tool details) |
| `"no-tools"` | Ẩn hoàn toàn tool calls |
| `"user-only"` | Chỉ hiện user messages |
| `"labeled-only"` | Chỉ hiện messages có label |
| `"all"` | Hiện tất cả (kể cả tool calls chi tiết) |

### doubleEscapeAction — Giải thích

| Giá trị | Hành vi |
|---------|---------|
| `"tree"` | Mở `/tree` view để navigate branches |
| `"fork"` | Tạo fork mới tại vị trí hiện tại |
| `"none"` | Không làm gì |

```json
{
  "theme": "midnight-aurora",
  "quietStartup": true,
  "doubleEscapeAction": "tree",
  "editorPaddingX": 1,
  "autocompleteMaxVisible": 8,
  "showHardwareCursor": false
}
```

---

## 5. Compaction

Cấu hình auto-compaction — tự động nén context khi conversation quá dài.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `compaction.enabled` | boolean | `true` | Bật/tắt auto-compaction |
| `compaction.reserveTokens` | number | `16384` | Token dành cho LLM response khi compaction |
| `compaction.keepRecentTokens` | number | `20000` | Token gần đây giữ nguyên (không summarize) |

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

> 💡 **Cách hoạt động:** Khi tổng token vượt context window, Pi tự động summarize phần cũ, chỉ giữ `keepRecentTokens` token gần nhất nguyên vẹn. `reserveTokens` là phần dành cho LLM trả lời trong quá trình summarize.

---

## 6. Branch Summary

Cấu hình việc summarize branches khi navigate trong `/tree`.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `branchSummary.reserveTokens` | number | `16384` | Token dành cho branch summarization |
| `branchSummary.skipPrompt` | boolean | `false` | Bỏ qua prompt "Summarize branch?" khi navigate `/tree` (mặc định không summarize) |

```json
{
  "branchSummary": {
    "reserveTokens": 16384,
    "skipPrompt": false
  }
}
```

> 💡 Khi `skipPrompt: true`, Pi sẽ không hỏi "Summarize branch?" mà mặc định **không** summarize. Hữu ích khi bạn muốn navigate nhanh giữa các branches.

---

## 7. Retry

Cấu hình auto-retry khi gặp lỗi tạm thời (transient errors) từ provider.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `retry.enabled` | boolean | `true` | Bật/tắt automatic retry |
| `retry.maxRetries` | number | `3` | Số lần retry tối đa |
| `retry.baseDelayMs` | number | `2000` | Delay cơ sở cho exponential backoff (2s → 4s → 8s) |
| `retry.maxDelayMs` | number | `60000` | Delay tối đa chấp nhận từ server trước khi fail (60s) |

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "maxDelayMs": 60000
  }
}
```

> ⚠️ **maxDelayMs:** Khi provider yêu cầu retry delay dài hơn `maxDelayMs` (vd: Google trả về "quota will reset after 5h"), request sẽ **fail ngay lập tức** với error message rõ ràng thay vì chờ im lặng. Đặt `0` để tắt giới hạn này.

---

## 8. Message Delivery

Cấu hình cách Pi gửi messages đến LLM.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `steeringMode` | string | `"one-at-a-time"` | Cách gửi steering messages: `"all"` hoặc `"one-at-a-time"` |
| `followUpMode` | string | `"one-at-a-time"` | Cách gửi follow-up messages: `"all"` hoặc `"one-at-a-time"` |
| `transport` | string | `"sse"` | Transport ưu tiên: `"sse"`, `"websocket"`, hoặc `"auto"` |

### Giải thích mode

| Mode | Mô tả |
|------|--------|
| `"all"` | Gửi tất cả messages cùng lúc trong 1 request |
| `"one-at-a-time"` | Gửi từng message một, chờ response trước khi gửi tiếp |

### Transport

| Transport | Mô tả |
|-----------|--------|
| `"sse"` | Server-Sent Events — mặc định, tương thích rộng |
| `"websocket"` | WebSocket — latency thấp hơn nếu provider hỗ trợ |
| `"auto"` | Tự chọn transport tốt nhất |

```json
{
  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time",
  "transport": "sse"
}
```

---

## 9. Terminal & Images

Cấu hình hiển thị terminal và xử lý ảnh.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `terminal.showImages` | boolean | `true` | Hiện ảnh trong terminal (nếu terminal hỗ trợ) |
| `terminal.clearOnShrink` | boolean | `false` | Xoá dòng trống khi content thu nhỏ (có thể gây flicker) |
| `images.autoResize` | boolean | `true` | Tự resize ảnh về tối đa 2000×2000 |
| `images.blockImages` | boolean | `false` | Chặn toàn bộ ảnh — không gửi đến LLM |

```json
{
  "terminal": {
    "showImages": true,
    "clearOnShrink": false
  },
  "images": {
    "autoResize": true,
    "blockImages": false
  }
}
```

> ⚠️ **XFCE4 Terminal** không hỗ trợ inline image protocols (Sixel, iTerm2, Kitty). Nếu dùng XFCE4, đặt `terminal.showImages: false` để tránh output lỗi.

---

## 10. Shell

Cấu hình shell và lệnh npm cho Pi.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `shellPath` | string | - | Đường dẫn shell tuỳ chỉnh (vd: cho Cygwin trên Windows) |
| `shellCommandPrefix` | string | - | Prefix cho mọi bash command (vd: `"shopt -s expand_aliases"`) |
| `npmCommand` | string[] | - | Argv cho npm operations (vd: dùng `mise` hoặc `nvm`) |

### npmCommand

Dùng khi bạn cần chạy npm qua version manager hoặc wrapper:

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

`npmCommand` được sử dụng cho **tất cả** npm operations: `npm root -g`, install, uninstall, và `npm install` trong git packages. Viết dưới dạng argv — chính xác như cách process được launch.

### shellCommandPrefix

Hữu ích khi cần setup shell environment trước mỗi command:

```json
{
  "shellPath": "/bin/zsh",
  "shellCommandPrefix": "source ~/.zshrc && shopt -s expand_aliases"
}
```

---

## 11. Sessions

Cấu hình nơi lưu trữ session files.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `sessionDir` | string | - | Thư mục lưu session files. Hỗ trợ absolute hoặc relative paths |

```json
{
  "sessionDir": ".pi/sessions"
}
```

> 💡 **Thứ tự ưu tiên:** CLI flag `--session-dir` > `sessionDir` trong settings.json. Nếu cả hai đều không set, Pi dùng vị trí mặc định.

---

## 12. Model Cycling

Cấu hình danh sách models cho phím tắt **Ctrl+P** cycling.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `enabledModels` | string[] | - | Danh sách model patterns cho cycling (cùng format với CLI flag `--models`) |

```json
{
  "enabledModels": ["claude-*", "gpt-4o", "gemini-2*"]
}
```

> 💡 Hỗ trợ **glob patterns** — `claude-*` sẽ match tất cả models bắt đầu bằng `claude-`. Nhấn **Ctrl+P** trong Pi để cycle qua các models đã cấu hình.

---

## 13. Markdown

Cấu hình rendering markdown trong output.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `markdown.codeBlockIndent` | string | `"  "` | Indentation cho code blocks (mặc định 2 spaces) |

```json
{
  "markdown": {
    "codeBlockIndent": "  "
  }
}
```

---

## 14. Resources

Cấu hình nơi load extensions, skills, prompts, themes từ đâu.

| Setting | Type | Default | Mô tả |
|---------|------|---------|--------|
| `packages` | array | `[]` | npm/git packages để load resources |
| `extensions` | string[] | `[]` | Đường dẫn local extension files hoặc directories |
| `skills` | string[] | `[]` | Đường dẫn local skill files hoặc directories |
| `prompts` | string[] | `[]` | Đường dẫn local prompt template files hoặc directories |
| `themes` | string[] | `[]` | Đường dẫn local theme files hoặc directories |
| `enableSkillCommands` | boolean | `true` | Đăng ký skills thành commands `/skill:name` |

### 14.1 Đường Dẫn & Glob

Arrays hỗ trợ **glob patterns** và **exclusions**:

```json
{
  "extensions": [
    "extensions/*.ts",
    "!extensions/deprecated-*.ts"
  ],
  "skills": [
    "skills/",
    "+skills/special.md",
    "-skills/draft.md"
  ]
}
```

| Prefix | Mô tả |
|--------|--------|
| (không có) | Include theo glob pattern |
| `!pattern` | Exclude theo glob pattern |
| `+path` | Force-include đường dẫn chính xác |
| `-path` | Force-exclude đường dẫn chính xác |

### 14.2 packages

**String form** — load tất cả resources từ package:

```json
{
  "packages": ["pi-skills", "@org/my-extension"]
}
```

**Object form** — chọn lọc resources cần load:

```json
{
  "packages": [
    {
      "source": "pi-skills",
      "skills": ["brave-search", "transcribe"],
      "extensions": []
    }
  ]
}
```

> 📦 Xem thêm chi tiết về package management trong [packages.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md).

---

## 15. Full Example

File settings hoàn chỉnh minh hoạ tất cả categories:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "hideThinkingBlock": false,
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  },

  "theme": "midnight-aurora",
  "quietStartup": true,
  "collapseChangelog": false,
  "doubleEscapeAction": "tree",
  "treeFilterMode": "default",
  "editorPaddingX": 1,
  "autocompleteMaxVisible": 8,
  "showHardwareCursor": false,

  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },

  "branchSummary": {
    "reserveTokens": 16384,
    "skipPrompt": false
  },

  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "maxDelayMs": 60000
  },

  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time",
  "transport": "sse",

  "terminal": {
    "showImages": false,
    "clearOnShrink": false
  },
  "images": {
    "autoResize": true,
    "blockImages": false
  },

  "shellPath": "/bin/bash",
  "shellCommandPrefix": "",
  "npmCommand": ["npm"],

  "sessionDir": ".pi/sessions",

  "enabledModels": ["claude-*", "gpt-4o", "gemini-2*"],

  "markdown": {
    "codeBlockIndent": "  "
  },

  "packages": ["pi-skills"],
  "extensions": ["extensions/*.ts"],
  "skills": ["skills/"],
  "prompts": ["prompts/"],
  "themes": ["themes/"],
  "enableSkillCommands": true
}
```

---

## 16. Project Overrides — Merge Semantics

Project settings (`.pi/settings.json`) **override** global settings (`~/.pi/agent/settings.json`). Nested objects được **deep merge** — chỉ field bạn khai báo mới bị override, phần còn lại giữ nguyên.

### Ví dụ merge

**Global** (`~/.pi/agent/settings.json`):

```json
{
  "theme": "dark",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384
  }
}
```

**Project** (`.pi/settings.json`):

```json
{
  "compaction": {
    "reserveTokens": 8192
  }
}
```

**Kết quả sau merge:**

```json
{
  "theme": "dark",
  "compaction": {
    "enabled": true,
    "reserveTokens": 8192
  }
}
```

### Quy tắc merge

| Loại giá trị | Hành vi |
|--------------|---------|
| **Scalar** (string, number, boolean) | Project **replace** global |
| **Object** (nested) | **Deep merge** — chỉ override field khai báo |
| **Array** | Project **replace** global (không concat) |

### Use case phổ biến

| Mục đích | Global | Project |
|----------|--------|---------|
| Dùng model khác cho project cụ thể | `"defaultModel": "claude-sonnet-4-..."` | `"defaultModel": "gpt-4o"` |
| Tắt compaction cho project nhỏ | `compaction.enabled: true` | `compaction.enabled: false` |
| Theme riêng cho project | `"theme": "dark"` | `"theme": "midnight-aurora"` |
| Extensions chỉ cho project này | `"extensions": []` | `"extensions": ["extensions/my-tool.ts"]` |
| Giảm retry cho API nhanh | `retry.maxRetries: 3` | `retry.maxRetries: 1` |

---

> 📖 **Tham khảo thêm:**
> - [PI_THEMES_GUIDE.md](./PI_THEMES_GUIDE.md) — Chi tiết về themes
> - [PI_SESSIONS_GUIDE.md](./PI_SESSIONS_GUIDE.md) — Sessions, branching, compaction
> - [PI_EXTENSIONS_GUIDE.md](./PI_EXTENSIONS_GUIDE.md) — Viết extensions
> - [PI_SKILLS_GUIDE.md](./PI_SKILLS_GUIDE.md) — Skills và prompt templates
