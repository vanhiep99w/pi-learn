# Pi Docs Index

> Cập nhật theo bộ docs chính thức mới nhất của Pi tại `earendil-works/pi` vào ngày 2026-05-19.

Thư mục này là bản hướng dẫn tiếng Việt cho các chủ đề quan trọng của Pi Coding Agent. Mục tiêu là:

- bám sát cấu trúc docs chính thức hiện tại
- thêm giải thích ngắn gọn, dễ tra cứu
- giữ lại các deep dive riêng của project khi hữu ích

## Nhóm docs chính thức hiện tại

### Bắt đầu và sử dụng hằng ngày

- [PI_QUICKSTART_GUIDE.md](./PI_QUICKSTART_GUIDE.md) - cài đặt, đăng nhập, chạy session đầu tiên
- [PI_USAGE_GUIDE.md](./PI_USAGE_GUIDE.md) - interactive mode, slash commands, session flow, CLI
- [PI_KEYBINDINGS_GUIDE.md](./PI_KEYBINDINGS_GUIDE.md) - phím tắt mặc định và custom keybindings

### Cấu hình và models

- [PI_PROVIDERS_GUIDE.md](./PI_PROVIDERS_GUIDE.md)
- [PI_MODELS_GUIDE.md](./PI_MODELS_GUIDE.md)
- [PI_SETTINGS_GUIDE.md](./PI_SETTINGS_GUIDE.md)
- [PI_CUSTOM_PROVIDER_GUIDE.md](./PI_CUSTOM_PROVIDER_GUIDE.md)

### Mở rộng Pi

- [PI_EXTENSIONS_GUIDE.md](./PI_EXTENSIONS_GUIDE.md)
- [PI_SKILLS_GUIDE.md](./PI_SKILLS_GUIDE.md)
- [PI_PROMPT_TEMPLATES_GUIDE.md](./PI_PROMPT_TEMPLATES_GUIDE.md)
- [PI_THEMES_GUIDE.md](./PI_THEMES_GUIDE.md)
- [PI_PACKAGES_GUIDE.md](./PI_PACKAGES_GUIDE.md)
- [PI_TUI_GUIDE.md](./PI_TUI_GUIDE.md)
- [PI_TOOLS_GUIDE.md](./PI_TOOLS_GUIDE.md)

### Sessions và context management

- [PI_SESSIONS_GUIDE.md](./PI_SESSIONS_GUIDE.md)
- [PI_SESSION_FORMAT_GUIDE.md](./PI_SESSION_FORMAT_GUIDE.md)
- [PI_COMPACTION_GUIDE.md](./PI_COMPACTION_GUIDE.md)

### Programmatic / machine integration

- [PI_SDK_GUIDE.md](./PI_SDK_GUIDE.md)
- [PI_RPC_GUIDE.md](./PI_RPC_GUIDE.md)
- [PI_JSON_MODE_GUIDE.md](./PI_JSON_MODE_GUIDE.md)

### Platform setup

- [PI_WINDOWS_GUIDE.md](./PI_WINDOWS_GUIDE.md)
- [PI_TERMUX_GUIDE.md](./PI_TERMUX_GUIDE.md)
- [PI_TMUX_GUIDE.md](./PI_TMUX_GUIDE.md)
- [PI_TERMINAL_SETUP_GUIDE.md](./PI_TERMINAL_SETUP_GUIDE.md)
- [PI_SHELL_ALIASES_GUIDE.md](./PI_SHELL_ALIASES_GUIDE.md)

### Development

- [PI_DEVELOPMENT_GUIDE.md](./PI_DEVELOPMENT_GUIDE.md)

## Deep dive riêng của repo này

Các file dưới đây không phải bản mirror trực tiếp từ docs chính thức, nhưng vẫn hữu ích cho việc học hoặc mở rộng Pi:

- [CLAUDE_CODE_TOOLS_GUIDE.md](./CLAUDE_CODE_TOOLS_GUIDE.md)
- [PI_DYNAMIC_AGENTS.md](./PI_DYNAMIC_AGENTS.md)
- [PI_HARNESS_GUIDE.md](./PI_HARNESS_GUIDE.md)

## Ghi chú sync

- Repo nguồn chính thức hiện dùng namespace `earendil-works/pi`.
- Bộ docs chính thức hiện có thêm các chủ đề mà trước đây local docs chưa có: `quickstart`, `usage`, `keybindings`, `json`, `rpc`, `sdk`, `windows`, `tmux`, `session-format`.
- Một số doc local vẫn là bản mở rộng giải thích sâu hơn tài liệu gốc, nên không cần giống 1:1 từng câu chữ.
