# Pi Quickstart — Bắt Đầu Nhanh

> Tóm tắt theo `packages/coding-agent/docs/quickstart.md` từ repo chính thức `earendil-works/pi`.

## 1. Cài Pi

Pi hiện được phát hành qua npm:

```bash
npm install -g @earendil-works/pi-coding-agent
```

Chạy trong thư mục project:

```bash
cd /path/to/project
pi
```

## 2. Gỡ Pi

Nếu cài bằng npm hoặc script cài curl:

```bash
npm uninstall -g @earendil-works/pi-coding-agent
```

Nếu cài bằng package manager khác thì gỡ bằng đúng package manager đó. Việc gỡ Pi không xóa:

- `~/.pi/agent/settings.json`
- `~/.pi/agent/auth.json`
- `~/.pi/agent/sessions/`
- các pi packages đã cài trong thư mục agent

## 3. Đăng Nhập

Pi hỗ trợ 2 kiểu chính:

### Subscription login

Trong Pi, chạy:

```txt
/login
```

Các provider subscription built-in hiện được docs chính thức nhắc đến:

- ChatGPT Plus/Pro (Codex)
- Claude Pro/Max
- GitHub Copilot

### API key

Ví dụ với Anthropic:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

Bạn cũng có thể dùng `/login` để nhập API key và lưu vào `~/.pi/agent/auth.json`.

## 4. Chạy Session Đầu Tiên

Sau khi mở Pi, thử một prompt đơn giản:

```txt
Summarize this repository and tell me how to run its checks.
```

Mặc định Pi cấp cho model 4 tool chính:

- `read`
- `write`
- `edit`
- `bash`

Ngoài ra còn có các tool read-only như `grep`, `find`, `ls` tùy cấu hình.

## 5. Dạy Pi Cách Làm Việc Trong Project

Tạo `AGENTS.md` để Pi biết convention của project:

```md
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

Pi sẽ nạp:

- `~/.pi/agent/AGENTS.md`
- `AGENTS.md` hoặc `CLAUDE.md` từ thư mục hiện tại và các thư mục cha

Sau khi sửa context files, chạy `/reload` hoặc restart Pi.

## 6. Những Việc Nên Thử Ngay

### Tham chiếu file

```bash
pi @README.md "Summarize this"
pi @src/app.ts @src/app.test.ts "Review these together"
```

Trong editor, gõ `@` để fuzzy-search file.

### Chạy lệnh shell

```txt
!npm run lint
```

- `!command` chạy lệnh và đưa output vào context
- `!!command` chạy lệnh nhưng không đưa output vào context

### Đổi model

- `/model`
- `Ctrl+L`
- `Shift+Tab` để đổi thinking level

### Mở lại session cũ

```bash
pi -c
pi -r
pi --session <path|id>
```

### Non-interactive mode

```bash
pi -p "Summarize this codebase"
cat README.md | pi -p "Summarize this text"
pi -p @screenshot.png "What's in this image?"
```

## 7. Bước Tiếp Theo

- [PI_USAGE_GUIDE.md](./PI_USAGE_GUIDE.md) để dùng Pi hằng ngày
- [PI_PROVIDERS_GUIDE.md](./PI_PROVIDERS_GUIDE.md) để cấu hình provider
- [PI_SETTINGS_GUIDE.md](./PI_SETTINGS_GUIDE.md) để chỉnh behavior
- [PI_PACKAGES_GUIDE.md](./PI_PACKAGES_GUIDE.md) để cài package chia sẻ
- [PI_KEYBINDINGS_GUIDE.md](./PI_KEYBINDINGS_GUIDE.md) nếu muốn remap phím
