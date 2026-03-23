# 🎨 Pi Themes — Hướng Dẫn Chi Tiết

> Tham khảo từ [packages/coding-agent/docs/themes.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/themes.md)  
> Pi có thể tự tạo themes — hãy nhờ nó build cho terminal setup của bạn!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Themes Mặc Định](#2-themes-mặc-định)
- [3. Chọn Theme](#3-chọn-theme)
- [4. Vị Trí Đặt Themes](#4-vị-trí-đặt-themes)
- [5. Tạo Custom Theme](#5-tạo-custom-theme)
  - [5.1 Quick Start](#51-quick-start)
  - [5.2 Theme Format](#52-theme-format)
  - [5.3 Variables (`vars`)](#53-variables-vars)
  - [5.4 JSON Schema](#54-json-schema)
- [6. Color Tokens — 51 Màu Bắt Buộc](#6-color-tokens--51-màu-bắt-buộc)
  - [6.1 Core UI (11 colors)](#61-core-ui-11-colors)
  - [6.2 Backgrounds & Content (11 colors)](#62-backgrounds--content-11-colors)
  - [6.3 Markdown (10 colors)](#63-markdown-10-colors)
  - [6.4 Tool Diffs (3 colors)](#64-tool-diffs-3-colors)
  - [6.5 Syntax Highlighting (9 colors)](#65-syntax-highlighting-9-colors)
  - [6.6 Thinking Level Borders (6 colors)](#66-thinking-level-borders-6-colors)
  - [6.7 Bash Mode (1 color)](#67-bash-mode-1-color)
  - [6.8 HTML Export (optional)](#68-html-export-optional)
- [7. Định Dạng Màu](#7-định-dạng-màu)
- [8. Built-in Themes Chi Tiết](#8-built-in-themes-chi-tiết)
  - [8.1 Dark Theme](#81-dark-theme)
  - [8.2 Light Theme](#82-light-theme)
- [9. Theme Recipes — Công Thức Tạo Theme](#9-theme-recipes--công-thức-tạo-theme)
  - [9.1 Nord-inspired](#91-nord-inspired)
  - [9.2 Gruvbox Dark](#92-gruvbox-dark)
  - [9.3 Tokyo Night](#93-tokyo-night)
  - [9.4 Catppuccin Mocha](#94-catppuccin-mocha)
  - [9.5 Solarized Dark](#95-solarized-dark)
- [10. Sử Dụng Theme Trong Extensions](#10-sử-dụng-theme-trong-extensions)
- [11. Hot Reload](#11-hot-reload)
- [12. Chia Sẻ Themes Qua Packages](#12-chia-sẻ-themes-qua-packages)
- [13. Terminal Compatibility](#13-terminal-compatibility)
- [14. Tips & Best Practices](#14-tips--best-practices)

---

## 1. Tổng Quan

**Themes** là các file JSON định nghĩa bảng màu cho toàn bộ TUI (Terminal UI) của Pi. Mọi thứ bạn nhìn thấy — từ text, borders, code highlighting, diffs, tools, markdown — đều được điều khiển bởi **51 color tokens**.

### Đặc điểm

- 📁 **JSON format** — dễ đọc, dễ sửa, có JSON Schema validation
- 🔄 **Hot reload** — sửa file theme → Pi áp dụng ngay lập tức
- 🎯 **Variables** — định nghĩa palette 1 lần, reference nhiều nơi
- 📦 **Shareable** — bundle trong Pi packages qua npm/git
- 🎨 **51 tokens** — kiểm soát hoàn toàn mọi thành phần UI

---

## 2. Themes Mặc Định

Pi ship với 2 themes built-in:

| Theme | Mô tả |
|-------|--------|
| `dark` | Nền tối, phù hợp terminal dark background |
| `light` | Nền sáng, phù hợp terminal light background |

Khi chạy lần đầu, Pi tự detect terminal background và chọn `dark` hoặc `light` phù hợp.

---

## 3. Chọn Theme

### Cách 1: Interactive — `/settings`

Trong Pi, gõ `/settings` → chọn theme từ danh sách.

### Cách 2: Settings file

**Global** (`~/.pi/agent/settings.json`):

```json
{
  "theme": "my-theme"
}
```

**Project** (`.pi/settings.json`):

```json
{
  "theme": "project-theme"
}
```

### Cách 3: CLI

```bash
pi --theme ./path/to/my-theme.json
```

---

## 4. Vị Trí Đặt Themes

| Location | Scope |
|----------|-------|
| Built-in | `dark`, `light` (luôn có sẵn) |
| `~/.pi/agent/themes/*.json` | Global — tất cả projects |
| `.pi/themes/*.json` | Project-local |
| Packages | `themes/` directories hoặc `pi.themes` trong `package.json` |
| Settings | `"themes"` array trong `settings.json` |
| CLI | `--theme <path>` (repeatable) |

**Disable discovery:**

```bash
pi --no-themes
```

---

## 5. Tạo Custom Theme

### 5.1 Quick Start

```bash
# 1. Tạo thư mục
mkdir -p ~/.pi/agent/themes

# 2. Tạo file theme
cat > ~/.pi/agent/themes/my-theme.json << 'EOF'
{
  "$schema": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
  "name": "my-theme",
  "vars": {
    "primary": "#00aaff",
    "secondary": "#808080"
  },
  "colors": {
    ... (51 tokens — xem bên dưới)
  }
}
EOF

# 3. Chọn theme
# Trong Pi: /settings → chọn "my-theme"
# Hoặc: pi --theme ~/.pi/agent/themes/my-theme.json
```

### 5.2 Theme Format

```json
{
  "$schema": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
  "name": "my-theme",
  "vars": {
    "blue": "#0066cc",
    "gray": 242
  },
  "colors": {
    "accent": "blue",
    "muted": "gray",
    "text": "",
    ... (tất cả 51 tokens)
  },
  "export": {
    "pageBg": "#18181e",
    "cardBg": "#1e1e24",
    "infoBg": "#3c3728"
  }
}
```

| Field | Required | Mô tả |
|-------|----------|--------|
| `$schema` | No | URL schema cho editor auto-completion |
| `name` | **Yes** | Tên theme, phải unique |
| `vars` | No | Biến màu tái sử dụng |
| `colors` | **Yes** | **Tất cả 51 tokens** — không có optional |
| `export` | No | Màu cho HTML export (`/export`) |

### 5.3 Variables (`vars`)

`vars` cho phép định nghĩa palette một lần, reference trong `colors`:

```json
{
  "vars": {
    "cyan": "#00d7ff",
    "blue": "#5f87ff",
    "green": "#b5bd68",
    "red": "#cc6666",
    "gray": "#808080",
    "dimGray": "#666666"
  },
  "colors": {
    "accent": "cyan",         // → #00d7ff
    "success": "green",       // → #b5bd68
    "error": "red",           // → #cc6666
    "muted": "gray",          // → #808080
    "syntaxKeyword": "blue",  // → #5f87ff
    "dim": "dimGray",         // → #666666
    ...
  }
}
```

**Lợi ích:**
- Đổi 1 biến → update tất cả nơi reference
- Dễ tạo color harmony nhất quán
- Giảm lặp lại hex codes

### 5.4 JSON Schema

Thêm `$schema` để editor (VS Code, etc.) cung cấp:
- ✅ Auto-completion cho tên tokens
- ✅ Validation — báo lỗi nếu thiếu token
- ✅ Hover descriptions

```json
{
  "$schema": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json"
}
```

---

## 6. Color Tokens — 51 Màu Bắt Buộc

Mỗi theme **phải định nghĩa đủ 51 tokens**. Không có token nào optional.

### 6.1 Core UI (11 colors)

| Token | Mục đích | Dark default | Light default |
|-------|---------|--------------|---------------|
| `accent` | Accent chính (logo, selected items, cursor) | `#8abeb7` (teal) | `#5a8080` (teal) |
| `border` | Borders thường | `#5f87ff` (blue) | `#547da7` (blue) |
| `borderAccent` | Borders nổi bật | `#00d7ff` (cyan) | `#5a8080` (teal) |
| `borderMuted` | Borders mờ (editor) | `#505050` | `#b0b0b0` |
| `success` | Trạng thái thành công | `#b5bd68` (green) | `#588458` (green) |
| `error` | Trạng thái lỗi | `#cc6666` (red) | `#aa5555` (red) |
| `warning` | Trạng thái cảnh báo | `#ffff00` (yellow) | `#9a7326` (yellow) |
| `muted` | Text phụ | `#808080` (gray) | `#6c6c6c` |
| `dim` | Text rất mờ | `#666666` | `#767676` |
| `text` | Text mặc định | `""` (terminal default) | `""` |
| `thinkingText` | Text trong thinking block | `#808080` | `#6c6c6c` |

### 6.2 Backgrounds & Content (11 colors)

| Token | Mục đích | Ghi chú |
|-------|---------|---------|
| `selectedBg` | Background dòng được chọn | Selection trong lists |
| `userMessageBg` | Background tin nhắn user | Khối message user |
| `userMessageText` | Text tin nhắn user | Thường `""` |
| `customMessageBg` | Background message extension | Messages từ `pi.sendMessage()` |
| `customMessageText` | Text message extension | Thường `""` |
| `customMessageLabel` | Label extension message | Tên customType |
| `toolPendingBg` | Background tool đang chạy | Khi tool executing |
| `toolSuccessBg` | Background tool thành công | Khi tool hoàn thành |
| `toolErrorBg` | Background tool lỗi | Khi tool throw error |
| `toolTitle` | Tên tool | Hiển thị trên tool box |
| `toolOutput` | Output text của tool | Nội dung bên trong tool box |

### 6.3 Markdown (10 colors)

| Token | Mục đích | Ví dụ |
|-------|---------|-------|
| `mdHeading` | Headings (`# Title`) | Tiêu đề markdown |
| `mdLink` | Link text (`[text](url)`) | Phần text |
| `mdLinkUrl` | Link URL | Phần URL |
| `mdCode` | Inline code (`` `code` ``) | Code trong dòng |
| `mdCodeBlock` | Code block content | Nội dung code block |
| `mdCodeBlockBorder` | Code block fences (```) | Viền code block |
| `mdQuote` | Blockquote text (`> text`) | Nội dung quote |
| `mdQuoteBorder` | Blockquote border | Đường viền bên trái |
| `mdHr` | Horizontal rule (`---`) | Đường ngăn cách |
| `mdListBullet` | List bullets/numbers | `-`, `*`, `1.` |

### 6.4 Tool Diffs (3 colors)

| Token | Mục đích |
|-------|---------|
| `toolDiffAdded` | Dòng được thêm (`+`) |
| `toolDiffRemoved` | Dòng bị xóa (`-`) |
| `toolDiffContext` | Dòng context (không đổi) |

### 6.5 Syntax Highlighting (9 colors)

| Token | Mục đích | Ví dụ |
|-------|---------|-------|
| `syntaxComment` | Comments | `// comment` |
| `syntaxKeyword` | Keywords | `const`, `if`, `return` |
| `syntaxFunction` | Function names | `myFunction()` |
| `syntaxVariable` | Variables | `myVar` |
| `syntaxString` | Strings | `"hello"` |
| `syntaxNumber` | Numbers | `42`, `3.14` |
| `syntaxType` | Types | `string`, `number`, `MyType` |
| `syntaxOperator` | Operators | `=`, `+`, `&&` |
| `syntaxPunctuation` | Punctuation | `{`, `}`, `;` |

### 6.6 Thinking Level Borders (6 colors)

Màu border editor thay đổi theo thinking level — tạo visual hierarchy từ mờ nhạt đến nổi bật:

| Token | Thinking Level | Visual |
|-------|---------------|--------|
| `thinkingOff` | Off | Mờ nhất |
| `thinkingMinimal` | Minimal | ↓ |
| `thinkingLow` | Low | ↓ |
| `thinkingMedium` | Medium | ↓ |
| `thinkingHigh` | High | ↓ |
| `thinkingXhigh` | Extra High | Nổi bật nhất |

### 6.7 Bash Mode (1 color)

| Token | Mục đích |
|-------|---------|
| `bashMode` | Màu border editor khi ở bash mode (gõ `!` prefix) |

### 6.8 HTML Export (optional)

Section `export` kiểm soát màu cho output `/export` HTML. Nếu bỏ qua, màu tự derive từ `userMessageBg`.

```json
{
  "export": {
    "pageBg": "#18181e",
    "cardBg": "#1e1e24",
    "infoBg": "#3c3728"
  }
}
```

| Token | Mục đích |
|-------|---------|
| `pageBg` | Background trang HTML |
| `cardBg` | Background card/container |
| `infoBg` | Background phần info (system prompt, notices) |

---

## 7. Định Dạng Màu

Pi hỗ trợ **4 định dạng** cho color values:

| Format | Ví dụ | Mô tả |
|--------|-------|--------|
| **Hex** | `"#ff0000"` | 6-digit hex RGB — phổ biến nhất |
| **256-color** | `39` | xterm 256-color palette index (0-255) |
| **Variable** | `"primary"` | Reference đến entry trong `vars` |
| **Default** | `""` | Dùng màu mặc định của terminal |

### Hex (#RRGGBB)

```json
{
  "accent": "#00aaff",
  "error": "#ff0000",
  "success": "#00ff00"
}
```

### 256-color index (0-255)

```json
{
  "muted": 242,
  "dim": 240,
  "border": 39
}
```

**Bảng 256-color palette:**

| Range | Mô tả |
|-------|--------|
| `0-15` | Basic ANSI colors (phụ thuộc terminal theme) |
| `16-231` | 6×6×6 RGB cube: `16 + 36×R + 6×G + B` (R,G,B = 0-5) |
| `232-255` | Grayscale ramp (đen → trắng) |

### Variable reference

```json
{
  "vars": {
    "primary": "#00aaff"
  },
  "colors": {
    "accent": "primary",         // → #00aaff
    "syntaxKeyword": "primary"   // → #00aaff
  }
}
```

### Empty string (terminal default)

```json
{
  "text": "",            // Dùng foreground mặc định
  "userMessageText": ""  // Dùng foreground mặc định
}
```

Phù hợp cho text chính — tôn trọng terminal settings của user.

---

## 8. Built-in Themes Chi Tiết

### 8.1 Dark Theme

Lấy cảm hứng từ VS Code dark, dùng palette mềm mại dễ nhìn.

```json
{
  "name": "dark",
  "vars": {
    "cyan": "#00d7ff",
    "blue": "#5f87ff",
    "green": "#b5bd68",
    "red": "#cc6666",
    "yellow": "#ffff00",
    "gray": "#808080",
    "dimGray": "#666666",
    "darkGray": "#505050",
    "accent": "#8abeb7"
  },
  "colors": {
    "accent": "accent",
    "border": "blue",
    "borderAccent": "cyan",
    "success": "green",
    "error": "red",
    "warning": "yellow",
    "muted": "gray",
    "dim": "dimGray",

    "userMessageBg": "#343541",
    "toolPendingBg": "#282832",
    "toolSuccessBg": "#283228",
    "toolErrorBg": "#3c2828",

    "syntaxComment": "#6A9955",
    "syntaxKeyword": "#569CD6",
    "syntaxFunction": "#DCDCAA",
    "syntaxVariable": "#9CDCFE",
    "syntaxString": "#CE9178",
    "syntaxNumber": "#B5CEA8",
    "syntaxType": "#4EC9B0"
  }
}
```

**Đặc điểm:** Nền tối (#343541), accent teal nhẹ (#8abeb7), syntax colors theo VS Code Dark+.

### 8.2 Light Theme

Dùng tone muted, dễ đọc trên nền sáng.

```json
{
  "name": "light",
  "vars": {
    "teal": "#5a8080",
    "blue": "#547da7",
    "green": "#588458",
    "red": "#aa5555",
    "yellow": "#9a7326"
  },
  "colors": {
    "accent": "teal",
    "border": "blue",
    "success": "green",
    "error": "red",
    "warning": "yellow",

    "userMessageBg": "#e8e8e8",
    "toolPendingBg": "#e8e8f0",
    "toolSuccessBg": "#e8f0e8",
    "toolErrorBg": "#f0e8e8",

    "syntaxComment": "#008000",
    "syntaxKeyword": "#0000FF",
    "syntaxFunction": "#795E26",
    "syntaxString": "#A31515",
    "syntaxType": "#267F99"
  }
}
```

**Đặc điểm:** Nền sáng (#e8e8e8), màu muted thấp contrast, syntax colors theo VS Code Light+.

---

## 9. Theme Recipes — Công Thức Tạo Theme

### 9.1 Nord-inspired

```json
{
  "$schema": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
  "name": "nord",
  "vars": {
    "nord0": "#2e3440",
    "nord1": "#3b4252",
    "nord3": "#4c566a",
    "nord4": "#d8dee9",
    "nord7": "#8fbcbb",
    "nord8": "#88c0d0",
    "nord9": "#81a1c1",
    "nord10": "#5e81ac",
    "nord11": "#bf616a",
    "nord12": "#d08770",
    "nord13": "#ebcb8b",
    "nord14": "#a3be8c",
    "nord15": "#b48ead"
  },
  "colors": {
    "accent": "nord8",
    "border": "nord9",
    "borderAccent": "nord8",
    "borderMuted": "nord3",
    "success": "nord14",
    "error": "nord11",
    "warning": "nord13",
    "muted": "nord3",
    "dim": "nord3",
    "text": "nord4",
    "thinkingText": "nord3",
    "selectedBg": "nord1",
    "userMessageBg": "nord1",
    "userMessageText": "",
    "customMessageBg": "nord1",
    "customMessageText": "",
    "customMessageLabel": "nord15",
    "toolPendingBg": "nord0",
    "toolSuccessBg": "#2e3a2e",
    "toolErrorBg": "#3a2e2e",
    "toolTitle": "nord8",
    "toolOutput": "nord3",
    "mdHeading": "nord13",
    "mdLink": "nord9",
    "mdLinkUrl": "nord3",
    "mdCode": "nord7",
    "mdCodeBlock": "nord14",
    "mdCodeBlockBorder": "nord3",
    "mdQuote": "nord3",
    "mdQuoteBorder": "nord3",
    "mdHr": "nord3",
    "mdListBullet": "nord8",
    "toolDiffAdded": "nord14",
    "toolDiffRemoved": "nord11",
    "toolDiffContext": "nord3",
    "syntaxComment": "nord3",
    "syntaxKeyword": "nord9",
    "syntaxFunction": "nord8",
    "syntaxVariable": "nord4",
    "syntaxString": "nord14",
    "syntaxNumber": "nord15",
    "syntaxType": "nord7",
    "syntaxOperator": "nord9",
    "syntaxPunctuation": "nord4",
    "thinkingOff": "nord3",
    "thinkingMinimal": "nord10",
    "thinkingLow": "nord9",
    "thinkingMedium": "nord8",
    "thinkingHigh": "nord15",
    "thinkingXhigh": "nord11",
    "bashMode": "nord14"
  }
}
```

### 9.2 Gruvbox Dark

```json
{
  "name": "gruvbox",
  "vars": {
    "bg": "#282828",
    "bg1": "#3c3836",
    "fg": "#ebdbb2",
    "gray": "#928374",
    "red": "#fb4934",
    "green": "#b8bb26",
    "yellow": "#fabd2f",
    "blue": "#83a598",
    "purple": "#d3869b",
    "aqua": "#8ec07c",
    "orange": "#fe8019"
  },
  "colors": {
    "accent": "aqua",
    "border": "blue",
    "borderAccent": "aqua",
    "borderMuted": "gray",
    "success": "green",
    "error": "red",
    "warning": "yellow",
    "muted": "gray",
    "dim": "gray",
    "text": "fg",
    "thinkingText": "gray",
    "selectedBg": "bg1",
    "userMessageBg": "bg1",
    "userMessageText": "",
    "customMessageBg": "bg1",
    "customMessageText": "",
    "customMessageLabel": "purple",
    "toolPendingBg": "bg",
    "toolSuccessBg": "#2a3228",
    "toolErrorBg": "#3c2828",
    "toolTitle": "aqua",
    "toolOutput": "gray",
    "mdHeading": "yellow",
    "mdLink": "blue",
    "mdLinkUrl": "gray",
    "mdCode": "orange",
    "mdCodeBlock": "green",
    "mdCodeBlockBorder": "gray",
    "mdQuote": "gray",
    "mdQuoteBorder": "gray",
    "mdHr": "gray",
    "mdListBullet": "aqua",
    "toolDiffAdded": "green",
    "toolDiffRemoved": "red",
    "toolDiffContext": "gray",
    "syntaxComment": "gray",
    "syntaxKeyword": "red",
    "syntaxFunction": "green",
    "syntaxVariable": "blue",
    "syntaxString": "green",
    "syntaxNumber": "purple",
    "syntaxType": "yellow",
    "syntaxOperator": "orange",
    "syntaxPunctuation": "fg",
    "thinkingOff": "gray",
    "thinkingMinimal": "blue",
    "thinkingLow": "aqua",
    "thinkingMedium": "green",
    "thinkingHigh": "yellow",
    "thinkingXhigh": "orange",
    "bashMode": "green"
  }
}
```

### 9.3 Tokyo Night

```json
{
  "name": "tokyo-night",
  "vars": {
    "bg": "#1a1b26",
    "bg1": "#24283b",
    "fg": "#c0caf5",
    "comment": "#565f89",
    "red": "#f7768e",
    "green": "#9ece6a",
    "yellow": "#e0af68",
    "blue": "#7aa2f7",
    "magenta": "#bb9af7",
    "cyan": "#7dcfff",
    "teal": "#73daca"
  },
  "colors": {
    "accent": "cyan",
    "border": "blue",
    "borderAccent": "cyan",
    "borderMuted": "comment",
    "success": "green",
    "error": "red",
    "warning": "yellow",
    "muted": "comment",
    "dim": "comment",
    "text": "fg",
    "thinkingText": "comment",
    "selectedBg": "bg1",
    "userMessageBg": "bg1",
    "userMessageText": "",
    "customMessageBg": "#1e2030",
    "customMessageText": "",
    "customMessageLabel": "magenta",
    "toolPendingBg": "bg",
    "toolSuccessBg": "#1a2b1a",
    "toolErrorBg": "#2b1a1a",
    "toolTitle": "cyan",
    "toolOutput": "comment",
    "mdHeading": "yellow",
    "mdLink": "blue",
    "mdLinkUrl": "comment",
    "mdCode": "teal",
    "mdCodeBlock": "green",
    "mdCodeBlockBorder": "comment",
    "mdQuote": "comment",
    "mdQuoteBorder": "comment",
    "mdHr": "comment",
    "mdListBullet": "cyan",
    "toolDiffAdded": "green",
    "toolDiffRemoved": "red",
    "toolDiffContext": "comment",
    "syntaxComment": "comment",
    "syntaxKeyword": "magenta",
    "syntaxFunction": "blue",
    "syntaxVariable": "fg",
    "syntaxString": "green",
    "syntaxNumber": "yellow",
    "syntaxType": "cyan",
    "syntaxOperator": "cyan",
    "syntaxPunctuation": "comment",
    "thinkingOff": "comment",
    "thinkingMinimal": "#6272a4",
    "thinkingLow": "blue",
    "thinkingMedium": "cyan",
    "thinkingHigh": "magenta",
    "thinkingXhigh": "red",
    "bashMode": "green"
  }
}
```

### 9.4 Catppuccin Mocha

```json
{
  "name": "catppuccin",
  "vars": {
    "base": "#1e1e2e",
    "surface0": "#313244",
    "overlay0": "#6c7086",
    "text": "#cdd6f4",
    "red": "#f38ba8",
    "green": "#a6e3a1",
    "yellow": "#f9e2af",
    "blue": "#89b4fa",
    "mauve": "#cba6f7",
    "teal": "#94e2d5",
    "peach": "#fab387",
    "lavender": "#b4befe"
  },
  "colors": {
    "accent": "lavender",
    "border": "blue",
    "borderAccent": "mauve",
    "borderMuted": "overlay0",
    "success": "green",
    "error": "red",
    "warning": "yellow",
    "muted": "overlay0",
    "dim": "overlay0",
    "text": "text",
    "thinkingText": "overlay0",
    "selectedBg": "surface0",
    "userMessageBg": "surface0",
    "userMessageText": "",
    "customMessageBg": "#2a2640",
    "customMessageText": "",
    "customMessageLabel": "mauve",
    "toolPendingBg": "base",
    "toolSuccessBg": "#1e2e1e",
    "toolErrorBg": "#2e1e2e",
    "toolTitle": "lavender",
    "toolOutput": "overlay0",
    "mdHeading": "yellow",
    "mdLink": "blue",
    "mdLinkUrl": "overlay0",
    "mdCode": "teal",
    "mdCodeBlock": "green",
    "mdCodeBlockBorder": "overlay0",
    "mdQuote": "overlay0",
    "mdQuoteBorder": "overlay0",
    "mdHr": "overlay0",
    "mdListBullet": "teal",
    "toolDiffAdded": "green",
    "toolDiffRemoved": "red",
    "toolDiffContext": "overlay0",
    "syntaxComment": "overlay0",
    "syntaxKeyword": "mauve",
    "syntaxFunction": "blue",
    "syntaxVariable": "text",
    "syntaxString": "green",
    "syntaxNumber": "peach",
    "syntaxType": "yellow",
    "syntaxOperator": "teal",
    "syntaxPunctuation": "overlay0",
    "thinkingOff": "overlay0",
    "thinkingMinimal": "blue",
    "thinkingLow": "lavender",
    "thinkingMedium": "teal",
    "thinkingHigh": "mauve",
    "thinkingXhigh": "red",
    "bashMode": "green"
  }
}
```

### 9.5 Solarized Dark

```json
{
  "name": "solarized",
  "vars": {
    "base03": "#002b36",
    "base02": "#073642",
    "base01": "#586e75",
    "base0": "#839496",
    "base1": "#93a1a1",
    "yellow": "#b58900",
    "orange": "#cb4b16",
    "red": "#dc322f",
    "magenta": "#d33682",
    "violet": "#6c71c4",
    "blue": "#268bd2",
    "cyan": "#2aa198",
    "green": "#859900"
  },
  "colors": {
    "accent": "cyan",
    "border": "blue",
    "borderAccent": "cyan",
    "borderMuted": "base01",
    "success": "green",
    "error": "red",
    "warning": "yellow",
    "muted": "base01",
    "dim": "base01",
    "text": "base0",
    "thinkingText": "base01",
    "selectedBg": "base02",
    "userMessageBg": "base02",
    "userMessageText": "",
    "customMessageBg": "base02",
    "customMessageText": "",
    "customMessageLabel": "violet",
    "toolPendingBg": "base03",
    "toolSuccessBg": "#003628",
    "toolErrorBg": "#360028",
    "toolTitle": "cyan",
    "toolOutput": "base01",
    "mdHeading": "yellow",
    "mdLink": "blue",
    "mdLinkUrl": "base01",
    "mdCode": "cyan",
    "mdCodeBlock": "green",
    "mdCodeBlockBorder": "base01",
    "mdQuote": "base01",
    "mdQuoteBorder": "base01",
    "mdHr": "base01",
    "mdListBullet": "cyan",
    "toolDiffAdded": "green",
    "toolDiffRemoved": "red",
    "toolDiffContext": "base01",
    "syntaxComment": "base01",
    "syntaxKeyword": "green",
    "syntaxFunction": "blue",
    "syntaxVariable": "base0",
    "syntaxString": "cyan",
    "syntaxNumber": "magenta",
    "syntaxType": "yellow",
    "syntaxOperator": "orange",
    "syntaxPunctuation": "base0",
    "thinkingOff": "base01",
    "thinkingMinimal": "base01",
    "thinkingLow": "blue",
    "thinkingMedium": "cyan",
    "thinkingHigh": "violet",
    "thinkingXhigh": "magenta",
    "bashMode": "green"
  }
}
```

---

## 10. Sử Dụng Theme Trong Extensions

Extensions truy cập theme qua `ctx.ui.theme` và callback parameters.

### Trong event handlers

```typescript
pi.on("session_start", async (_event, ctx) => {
  // Đọc theme hiện tại
  const theme = ctx.ui.theme;
  ctx.ui.notify(theme.fg("accent", "Extension loaded!"), "info");
});
```

### Trong tool rendering

```typescript
pi.registerTool({
  name: "my_tool",
  // ...
  renderCall(args, theme) {
    return new Text(theme.fg("toolTitle", theme.bold("my_tool ")), 0, 0);
  },
  renderResult(result, { expanded }, theme) {
    return new Text(theme.fg("success", "✓ Done"), 0, 0);
  },
});
```

### Trong custom components

```typescript
const result = await ctx.ui.custom<string | null>((tui, theme, kb, done) => {
  // theme được pass vào callback — luôn dùng theme này
  const text = theme.fg("accent", "Hello!");
  // ...
});
```

### Theme API trong extensions

```typescript
// Lấy tất cả themes
const themes = ctx.ui.getAllThemes();
// → [{ name: "dark", path: undefined }, { name: "light", path: undefined }, { name: "my-theme", path: "/..." }]

// Lấy theme theo tên (không switch)
const lightTheme = ctx.ui.getTheme("light");

// Switch theme theo tên
const result = ctx.ui.setTheme("my-theme");
if (!result.success) {
  ctx.ui.notify(`Failed: ${result.error}`, "error");
}

// Switch theme theo object
ctx.ui.setTheme(lightTheme!);

// Đọc theme hiện tại
ctx.ui.theme.fg("accent", "styled text");
```

### Auto-sync macOS dark/light mode

```typescript
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

async function isDarkMode(): Promise<boolean> {
  const { stdout } = await execAsync(
    "osascript -e 'tell application \"System Events\" to tell appearance preferences to return dark mode'"
  );
  return stdout.trim() === "true";
}

export default function (pi: ExtensionAPI) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  pi.on("session_start", async (_event, ctx) => {
    let currentTheme = (await isDarkMode()) ? "dark" : "light";
    ctx.ui.setTheme(currentTheme);

    intervalId = setInterval(async () => {
      const newTheme = (await isDarkMode()) ? "dark" : "light";
      if (newTheme !== currentTheme) {
        currentTheme = newTheme;
        ctx.ui.setTheme(currentTheme);
      }
    }, 2000);
  });

  pi.on("session_shutdown", () => {
    if (intervalId) clearInterval(intervalId);
  });
}
```

---

## 11. Hot Reload

Khi bạn sửa file theme **đang active**, Pi **tự động reload** và áp dụng ngay:

```
1. Bạn đang dùng theme "my-theme"
2. Mở ~/.pi/agent/themes/my-theme.json trong editor
3. Thay đổi "accent": "#ff0000"
4. Save file
5. → Pi detect thay đổi, reload theme, TUI cập nhật ngay lập tức
```

**Đặc điểm hot-reload:**
- Chỉ hoạt động với custom themes (file trên disk)
- Built-in themes (`dark`, `light`) không hot-reload (vì embedded trong code)
- Nếu JSON invalid → Pi giữ theme cũ, không crash

---

## 12. Chia Sẻ Themes Qua Packages

### Tạo package chứa themes

```
my-pi-themes/
├── package.json
└── themes/
    ├── nord.json
    ├── gruvbox.json
    └── tokyo-night.json
```

```json
// package.json
{
  "name": "my-pi-themes",
  "keywords": ["pi-package"],
  "pi": {
    "themes": ["./themes"]
  }
}
```

### Cài đặt

```bash
pi install npm:my-pi-themes
pi install git:github.com/user/my-pi-themes
```

Không có `pi` manifest → Pi auto-discover từ `themes/` directory.

### Package filtering

```json
{
  "packages": [
    {
      "source": "npm:mega-themes",
      "themes": ["themes/nord.json", "themes/gruvbox.json"],
      "extensions": [],
      "skills": [],
      "prompts": []
    }
  ]
}
```

---

## 13. Terminal Compatibility

Pi dùng **24-bit RGB colors** (truecolor). Hầu hết terminal hiện đại đều hỗ trợ:

| Terminal | Truecolor |
|----------|-----------|
| iTerm2 | ✅ |
| Kitty | ✅ |
| WezTerm | ✅ |
| Ghostty | ✅ |
| Windows Terminal | ✅ |
| VS Code Terminal | ✅ |
| Alacritty | ✅ |
| GNOME Terminal | ✅ (3.18+) |
| tmux | ✅ (cần cấu hình) |

### Kiểm tra truecolor support

```bash
echo $COLORTERM
# Kết quả: "truecolor" hoặc "24bit" → OK
```

### Terminal cũ (256-color)

Pi tự fallback sang nearest 256-color approximation nếu terminal không hỗ trợ truecolor.

### VS Code Terminal

Đặt setting để hiển thị đúng màu:

```json
{
  "terminal.integrated.minimumContrastRatio": 1
}
```

### tmux

Đảm bảo tmux hỗ trợ truecolor:

```bash
# ~/.tmux.conf
set -g default-terminal "tmux-256color"
set -ag terminal-overrides ",xterm-256color:RGB"
```

---

## 14. Tips & Best Practices

### Thiết kế theme tốt

| Tip | Chi tiết |
|-----|---------|
| **Dark terminal** | Dùng bright, saturated colors với contrast cao |
| **Light terminal** | Dùng darker, muted colors với contrast thấp hơn |
| **Color harmony** | Bắt đầu từ palette có sẵn (Nord, Gruvbox, etc.), định nghĩa trong `vars` |
| **Background colors** | Backgrounds nên subtle — chỉ khác nền terminal 1-2 shades |
| **Text readability** | Đảm bảo contrast ratio đủ cao giữa text và background |

### Testing

Kiểm tra theme với nhiều scenarios:

- ✅ User messages (background + text)
- ✅ Assistant messages (markdown, code blocks)
- ✅ Tool calls (pending, success, error states)
- ✅ Diffs (added, removed, context)
- ✅ Syntax highlighting (nhiều ngôn ngữ)
- ✅ Long wrapped text (ANSI codes survive wrap?)
- ✅ Thinking blocks (6 levels)
- ✅ Selection lists / dialogs
- ✅ HTML export (`/export`)

### Workflow tạo theme

```
1. Copy built-in dark.json hoặc light.json
2. Đổi "name" thành tên mới
3. Định nghĩa palette trong "vars" 
4. Thay đổi "colors" reference đến vars
5. Chọn theme: /settings
6. Sửa file → hot reload → xem kết quả ngay
7. Lặp lại 6 cho đến khi ưng ý
```

### Nhờ Pi tạo theme

```
pi "Create a Pi theme inspired by the Dracula color scheme. 
    Save it to ~/.pi/agent/themes/dracula.json"
```

Pi hiểu theme schema và có thể tự tạo file JSON đầy đủ 51 tokens!

---

## Tham Khảo

- **Docs chính thức:** [themes.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/themes.md)
- **Dark theme:** [dark.json](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/modes/interactive/theme/dark.json)
- **Light theme:** [light.json](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/modes/interactive/theme/light.json)
- **Schema:** [theme-schema.json](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json)
- **TUI docs:** [tui.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tui.md)
- **Mac theme sync:** [mac-system-theme.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/mac-system-theme.ts)
