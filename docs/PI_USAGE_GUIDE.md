# Pi Usage — Cách Dùng Hằng Ngày

> Tóm tắt theo `packages/coding-agent/docs/usage.md` từ repo chính thức `earendil-works/pi`.

## 1. Interactive Mode

Pi có 4 vùng chính trong TUI:

- header: shortcuts, context files, skills, extensions
- messages: hội thoại, tool calls, errors, custom UI
- editor: nơi nhập prompt
- footer: cwd, session, token, cost, model

Editor có thể tạm thời bị thay thế bởi UI như `/settings` hoặc custom extension UI.

## 2. Các Tính Năng Editor

| Tính năng | Cách dùng |
|----------|-----------|
| Reference file | gõ `@` |
| Path completion | `Tab` |
| Multi-line | `Shift+Enter` |
| Image paste | `Ctrl+V`, Windows thường là `Alt+V` |
| Shell command | `!command` |
| Hidden shell command | `!!command` |
| External editor | `Ctrl+G` |

## 3. Slash Commands Quan Trọng

| Command | Ý nghĩa |
|---------|--------|
| `/login`, `/logout` | quản lý credentials |
| `/model` | chọn model |
| `/scoped-models` | bật/tắt danh sách model dùng cho cycle |
| `/settings` | đổi theme, thinking, delivery mode |
| `/resume` | mở session cũ |
| `/new` | tạo session mới |
| `/name <name>` | đặt tên session |
| `/session` | xem thông tin session hiện tại |
| `/tree` | nhảy tới một điểm bất kỳ trong session tree |
| `/fork` | tạo session mới từ user message cũ |
| `/clone` | clone nhánh hiện tại sang session mới |
| `/compact [prompt]` | compact context thủ công |
| `/copy` | copy câu trả lời cuối |
| `/export [file]` | export HTML |
| `/share` | share qua private gist |
| `/reload` | reload resources và context files |
| `/hotkeys` | xem hotkeys |
| `/quit` | thoát |

## 4. Message Queue

Pi cho phép gửi thêm message khi agent còn đang chạy:

- `Enter`: queue steering message
- `Alt+Enter`: queue follow-up message
- `Escape`: abort và trả queued messages về editor
- `Alt+Up`: kéo queued message trở lại editor

Các mode này được điều khiển bởi `steeringMode` và `followUpMode` trong settings.

## 5. Sessions

Pi tự lưu session tại:

```txt
~/.pi/agent/sessions/
```

Một số lệnh CLI hữu ích:

```bash
pi -c
pi -r
pi --no-session
pi --session <path|id>
pi --fork <path|id>
```

Trong UI, các lệnh đáng nhớ nhất là `/session`, `/tree`, `/fork`, `/clone`, `/compact`.

## 6. Context Files

Pi load `AGENTS.md` hoặc `CLAUDE.md` từ:

- `~/.pi/agent/AGENTS.md`
- các thư mục cha
- thư mục hiện tại

Tắt behavior này bằng:

```bash
pi --no-context-files
```

## 7. System Prompt Files

Thay hoàn toàn system prompt:

- `.pi/SYSTEM.md`
- `~/.pi/agent/SYSTEM.md`

Append vào prompt mặc định:

- `.pi/APPEND_SYSTEM.md`
- `~/.pi/agent/APPEND_SYSTEM.md`

## 8. Package Commands

```bash
pi install <source> [-l]
pi remove <source> [-l]
pi update [source|self|pi]
pi list
pi config
```

`-l` nghĩa là project-local thay vì global.

## 9. Các Mode Chính

| Flag | Ý nghĩa |
|------|--------|
| mặc định | interactive |
| `-p`, `--print` | in câu trả lời rồi thoát |
| `--mode json` | JSON event stream |
| `--mode rpc` | RPC qua stdin/stdout |
| `--export <in> [out]` | export session ra HTML |

## 10. Một Số Option Quan Trọng

### Model

- `--provider <name>`
- `--model <pattern>`
- `--thinking <level>`
- `--models <patterns>`
- `--list-models [search]`

### Session

- `--session <path|id>`
- `--fork <path|id>`
- `--session-dir <dir>`
- `--no-session`

### Tools

- `--tools <list>`
- `--no-builtin-tools`
- `--no-tools`

### Resources

- `-e`, `--extension <source>`
- `--skill <path>`
- `--prompt-template <path>`
- `--theme <path>`
- `--no-context-files`

## 11. Ví Dụ Nhanh

```bash
pi "List all .ts files in src/"
pi -p "Summarize this codebase"
cat README.md | pi -p "Summarize this text"
pi --tools read,grep,find,ls -p "Review the code"
pi --provider openai --model gpt-4o "Help me refactor"
```

## 12. Khi Nào Dùng JSON, RPC, SDK

- `--mode json`: khi bạn chỉ cần stream events có cấu trúc
- `--mode rpc`: khi cần điều khiển Pi như một subprocess
- SDK: khi bạn viết app Node.js muốn embed Pi trực tiếp
