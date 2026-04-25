# ⌨️ Pi Terminal Setup — Hướng Dẫn Cài Đặt Terminal

> Tham khảo từ [packages/coding-agent/docs/terminal-setup.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/terminal-setup.md)

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Kitty Keyboard Protocol](#2-kitty-keyboard-protocol)
- [3. Terminal-Specific Setup](#3-terminal-specific-setup)
  - [3.1 Kitty](#31-kitty)
  - [3.2 iTerm2](#32-iterm2)
  - [3.3 Ghostty](#33-ghostty)
  - [3.4 WezTerm](#34-wezterm)
  - [3.5 VS Code Terminal](#35-vs-code-terminal)
  - [3.6 Windows Terminal](#36-windows-terminal)
- [4. Shift+Enter Remapping](#4-shiftenter-remapping)
- [5. Limited Support Terminals](#5-limited-support-terminals)
- [6. Tổng Hợp](#6-tổng-hợp)

---

## 1. Tổng Quan

Pi sử dụng **Shift+Enter** để gửi multi-line input (xuống dòng mà không submit). Tính năng này phụ thuộc vào việc terminal hỗ trợ **Kitty keyboard protocol** — một giao thức mở rộng giúp terminal phân biệt được các tổ hợp phím phức tạp.

### Tại sao quan trọng?

| Phím | Mặc định (không protocol) | Với Kitty protocol |
|------|--------------------------|-------------------|
| Enter | Gửi message | Gửi message |
| Shift+Enter | Gửi message (giống Enter) | **Xuống dòng mới** |

Không có Kitty keyboard protocol, terminal không thể phân biệt Enter và Shift+Enter.

---

## 2. Kitty Keyboard Protocol

**Kitty keyboard protocol** là giao thức mở rộng keyboard input cho terminal emulators. Nó cho phép:

- Phân biệt key modifiers (Shift, Ctrl, Alt) chính xác
- Nhận diện key press vs key release
- Hỗ trợ Unicode input nâng cao

Pi yêu cầu terminal hỗ trợ protocol này để **Shift+Enter** hoạt động đúng.

---

## 3. Terminal-Specific Setup

### 3.1 Kitty

✅ **Hoạt động ngay** — không cần cấu hình gì thêm.

Kitty là terminal tạo ra protocol này, nên hỗ trợ native.

---

### 3.2 iTerm2

✅ **Hoạt động ngay** — iTerm2 hỗ trợ CSI u mode natively.

Đảm bảo bạn đang dùng phiên bản mới nhất.

---

### 3.3 Ghostty

Cần thêm config vào file `~/.config/ghostty/config`:

```
keybind = shift+enter=text:\x1b[13;2u
```

### Ghostty + tmux

Nếu dùng Ghostty với tmux, cần cấu hình thêm ở cả 2 phía:

**Ghostty config:**
```
keybind = shift+enter=text:\x1b[13;2u
```

**tmux config (`~/.tmux.conf`):**
```
set -s extended-keys on
set -as terminal-features 'xterm*:extkeys'
```

> ⚠️ Xem thêm [PI_TMUX_GUIDE.md](./PI_TMUX_GUIDE.md) để cấu hình tmux chi tiết.

---

### 3.4 WezTerm

Cần thêm Lua config vào `~/.wezterm.lua`:

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()

config.enable_csi_u_key_encoding = true

-- Hoặc map cụ thể Shift+Enter
config.keys = {
  {
    key = 'Enter',
    mods = 'SHIFT',
    action = wezterm.action.SendString '\x1b[13;2u',
  },
}

return config
```

---

### 3.5 VS Code Terminal

Thêm vào `keybindings.json` (Ctrl+Shift+P → "Open Keyboard Shortcuts (JSON)"):

```json
[
  {
    "key": "shift+enter",
    "command": "workbench.action.terminal.sendSequence",
    "args": { "text": "\u001b[13;2u" },
    "when": "terminalFocus"
  }
]
```

---

### 3.6 Windows Terminal

Thêm vào phần `actions` trong `settings.json` của Windows Terminal:

```json
{
  "actions": [
    {
      "command": {
        "action": "sendInput",
        "input": "\u001b[13;2u"
      },
      "keys": "shift+enter"
    }
  ]
}
```

---

## 4. Shift+Enter Remapping

### Xung đột phổ biến

Một số terminal hoặc tool có thể remap Shift+Enter cho mục đích khác. Các xung đột thường gặp:

| Tình huống | Xung đột |
|-----------|----------|
| **Ghostty + tmux** | tmux có thể chặn Shift+Enter trước khi Ghostty xử lý |
| **VS Code** | VS Code có thể bind Shift+Enter cho "Run Cell" trong notebooks |
| **IDE terminals** | IntelliJ/VS Code terminal có keybinding riêng |

### Cách khắc phục

1. Đảm bảo config terminal ưu tiên gửi CSI u sequence
2. Tắt conflicting keybindings trong IDE
3. Kiểm tra thứ tự xử lý: terminal → tmux → application

---

## 5. Limited Support Terminals

Các terminal sau **không hỗ trợ đầy đủ** Kitty keyboard protocol:

| Terminal | Tình trạng | Ghi chú |
|----------|-----------|---------|
| **xfce4-terminal** | ⚠️ Hạn chế | Không hỗ trợ Kitty protocol, Shift+Enter không phân biệt được |
| **Terminator** | ⚠️ Hạn chế | Tương tự xfce4-terminal |
| **IntelliJ IDEA terminal** | ⚠️ Hạn chế | Built-in terminal không hỗ trợ đầy đủ |
| **GNOME Terminal** | ⚠️ Hạn chế | VTE-based, chưa implement Kitty protocol |

### Workaround cho limited terminals

Pi vẫn hoạt động bình thường trên các terminal này — chỉ là **Shift+Enter sẽ không xuống dòng**. Bạn vẫn có thể:

- Paste multi-line text từ clipboard
- Dùng lệnh `/` commands bình thường
- Sử dụng tất cả các tính năng khác của Pi

---

## 6. Tổng Hợp

| Terminal | Hỗ trợ | Cần cấu hình? |
|----------|--------|---------------|
| Kitty | ✅ Full | Không |
| iTerm2 | ✅ Full | Không |
| Ghostty | ✅ Full | Có — keybind config |
| WezTerm | ✅ Full | Có — Lua config |
| VS Code | ✅ Full | Có — keybindings.json |
| Windows Terminal | ✅ Full | Có — actions JSON |
| xfce4-terminal | ⚠️ Hạn chế | N/A |
| Terminator | ⚠️ Hạn chế | N/A |
| IntelliJ IDEA | ⚠️ Hạn chế | N/A |
