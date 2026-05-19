# Pi Keybindings — Phím Tắt và Tùy Biến

> Tóm tắt theo `packages/coding-agent/docs/keybindings.md` từ repo chính thức `earendil-works/pi`.

## 1. File Cấu Hình

Tất cả keyboard shortcuts có thể custom qua:

```txt
~/.pi/agent/keybindings.json
```

Sau khi sửa file, chạy:

```txt
/reload
```

## 2. Format Của Một Key

Pi dùng format:

```txt
modifier+key
```

Ví dụ:

- `ctrl+p`
- `shift+enter`
- `alt+backspace`
- `ctrl+shift+o`

## 3. Nhóm Actions Quan Trọng

### Editor

- `tui.editor.cursorUp`
- `tui.editor.cursorDown`
- `tui.editor.cursorLeft`
- `tui.editor.cursorRight`
- `tui.editor.deleteWordBackward`
- `tui.editor.deleteToLineEnd`
- `tui.editor.undo`

### Input

- `tui.input.newLine`
- `tui.input.submit`
- `tui.input.tab`

### App-level

- `app.interrupt`
- `app.clear`
- `app.exit`
- `app.editor.external`
- `app.clipboard.pasteImage`

### Models và thinking

- `app.model.select`
- `app.model.cycleForward`
- `app.model.cycleBackward`
- `app.thinking.cycle`
- `app.thinking.toggle`

### Sessions

- `app.session.new`
- `app.session.tree`
- `app.session.fork`
- `app.session.resume`

### Tree navigation

- `app.tree.foldOrUp`
- `app.tree.unfoldOrDown`
- `app.tree.editLabel`
- `app.tree.filter.default`
- `app.tree.filter.noTools`
- `app.tree.filter.userOnly`
- `app.tree.filter.labeledOnly`
- `app.tree.filter.all`

## 4. Mặc Định Đáng Nhớ

| Action | Default |
|--------|---------|
| submit | `enter` |
| newline | `shift+enter` |
| open model selector | `ctrl+l` |
| cycle model | `ctrl+p` |
| cycle thinking | `shift+tab` |
| expand/collapse tool output | `ctrl+o` |
| queue follow-up | `alt+enter` |
| dequeue message | `alt+up` |
| external editor | `ctrl+g` |

## 5. Ví Dụ Cấu Hình

```json
{
  "tui.editor.cursorUp": ["up", "ctrl+p"],
  "tui.editor.cursorDown": ["down", "ctrl+n"],
  "tui.input.newLine": ["shift+enter", "ctrl+j"]
}
```

Mỗi action có thể nhận:

- một string
- hoặc một mảng string

## 6. Lưu Ý

- Pi dùng namespaced IDs như `tui.editor.cursorUp`, không còn kiểu cũ như `cursorUp`.
- Các config cũ sẽ được migrate tự động khi startup.
- Native Windows không support `Ctrl+Z` kiểu Unix job control như Linux/macOS.
- Nếu terminal không phân biệt được modified Enter keys, hãy xem thêm [PI_TERMINAL_SETUP_GUIDE.md](./PI_TERMINAL_SETUP_GUIDE.md) và [PI_TMUX_GUIDE.md](./PI_TMUX_GUIDE.md).
