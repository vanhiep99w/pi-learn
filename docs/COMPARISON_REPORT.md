# Pi Docs Sync Report

> Cập nhật ngày 2026-05-19 dựa trên bộ docs chính thức hiện tại của Pi tại `earendil-works/pi`.

## Mục tiêu đợt sync này

- đồng bộ `docs/` với cấu trúc docs Pi mới nhất
- thêm các chủ đề local còn thiếu
- sửa toàn bộ tham chiếu từ repo cũ sang repo chính thức mới

## Các doc mới đã thêm

- `PI_QUICKSTART_GUIDE.md`
- `PI_USAGE_GUIDE.md`
- `PI_KEYBINDINGS_GUIDE.md`
- `PI_JSON_MODE_GUIDE.md`
- `PI_RPC_GUIDE.md`
- `PI_SDK_GUIDE.md`
- `PI_WINDOWS_GUIDE.md`
- `PI_TMUX_GUIDE.md`
- `PI_SESSION_FORMAT_GUIDE.md`
- `README.md`

## Các doc cũ đã được làm sạch link nguồn

Nhóm file deep dive hiện có đã được cập nhật để không còn trỏ sang namespace cũ `badlogic/pi-mono`, mà dùng repo chính thức mới `earendil-works/pi`.

Những file chính đã được đồng bộ nguồn tham chiếu:

- `PI_EXTENSIONS_GUIDE.md`
- `PI_TUI_GUIDE.md`
- `PI_TOOLS_GUIDE.md`
- `PI_SESSIONS_GUIDE.md`
- `PI_COMPACTION_GUIDE.md`
- `PI_SETTINGS_GUIDE.md`
- `PI_THEMES_GUIDE.md`
- `PI_SKILLS_GUIDE.md`
- `PI_PROMPT_TEMPLATES_GUIDE.md`
- `PI_MODELS_GUIDE.md`
- `PI_PROVIDERS_GUIDE.md`
- `PI_CUSTOM_PROVIDER_GUIDE.md`
- `PI_PACKAGES_GUIDE.md`
- `PI_DEVELOPMENT_GUIDE.md`
- `PI_TERMUX_GUIDE.md`
- `PI_TERMINAL_SETUP_GUIDE.md`
- `PI_SHELL_ALIASES_GUIDE.md`

## Ghi chú về cấu trúc docs chính thức hiện tại

So với bộ local trước đó, upstream hiện nhấn mạnh rõ hơn các mảng sau:

- `quickstart`
- `usage`
- `keybindings`
- `json`
- `rpc`
- `sdk`
- `windows`
- `tmux`
- `session-format`

Ngoài ra phần session navigation hiện được tổ chức quanh `sessions.md` và `session-format.md`, thay vì tách rời như bộ docs cũ.

## Cách dùng bộ docs local sau sync

- Bắt đầu từ [README.md](./README.md) nếu muốn xem toàn bộ map chủ đề.
- Dùng các file mới thêm nếu cần bám nhanh theo docs chính thức.
- Dùng các deep dive cũ nếu cần giải thích sâu hơn hoặc ví dụ thực chiến hơn docs gốc.

## Những file không phải mirror chính thức

Các file dưới đây là tài liệu mở rộng riêng của project, không phải doc chính thức của Pi:

- `CLAUDE_CODE_TOOLS_GUIDE.md`
- `PI_DYNAMIC_AGENTS.md`
- `PI_HARNESS_GUIDE.md`

Điều này là có chủ đích: chúng giữ giá trị học tập và thiết kế riêng cho repo này.
