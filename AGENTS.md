# AGENTS.md — Pi Learn Project

## Harness Wiki

This repository has documentation under `wiki/`.

Before modifying repository files:

1. Read `wiki/quickstart.md`.
2. Follow its “Rule loading” instructions.
3. Read `wiki/_rules.md`.
4. Read every section `_rules.md` applicable to the target files.
5. Re-read applicable rules when the task scope changes or after compaction.

Do not modify `wiki/**/_rules.md` outside the approved Harness proposal and apply workflow.


## Tổng quan hiện tại

`pi-learn` là repo học tập + package phân phối cho Pi Coding Agent. Repo hiện tập trung vào:

- Tài liệu Pi bằng tiếng Việt trong `docs/`.
- Bộ extension/theme dùng được qua Pi package Git/GitHub.
- Tùy biến TUI, web tools, prompt templates và usage status.

Repo GitHub/package được ghi trong README: `https://github.com/vanhiep99w/pi-learn`.

## Cấu trúc dự án thực tế

```text
pi-learn/
├── AGENTS.md
├── README.md                         # Hướng dẫn cài package, update, release
├── PI_DOCUMENTATION.md                # Tài liệu tổng hợp dài về Pi
├── package.json                       # Root Pi package manifest
├── package-lock.json / bun.lock
├── .codex/config.toml                 # MCP config local cho Codex
├── .pi/
│   ├── extensions/
│   │   └── log-llm-payload.ts         # Extension local/dev-only log payload LLM
│   └── logs/llm-payloads/             # Log payload local; coi là nhạy cảm
├── docs/                              # Tài liệu Pi tiếng Việt, có docs/README.md làm index
├── pi-harness/                        # Harness specs/roadmap/integration plan
├── wiki/                              # Repo docs + reviewed section `_rules.md`
└── packages/
    ├── harness-runtime/               # Deterministic session/proposal/eval runtime
    └── pi-learn-extensions/
        ├── package.json               # Package con expose extensions/themes
        ├── README.md
        ├── extensions/
        │   ├── harness/               # Harness + Harness Wiki entrypoint
        │   ├── web-tools/
        │   ├── chatgpt-usage-status/
        │   ├── fixed-input-layout/
        │   ├── aurora-ui.ts
        │   └── prompt-with-model.ts
        └── themes/
            └── midnight-aurora.json
```

Lưu ý: các mục cũ như `.pi/agents`, `.pi/teams`, `scripts/`, `landing-page/`, `aurora-teams` hiện không có trong tree hiện tại. Không giả định chúng tồn tại khi làm việc.

## Pi package manifest

Root `package.json` là manifest chính để Pi load package:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

`packages/pi-learn-extensions/package.json` cũng expose:

```json
{
  "pi": {
    "extensions": ["./extensions"],
    "themes": ["./themes"]
  }
}
```

Các dependency/runtime chính:

- ESM TypeScript (`"type": "module"`).
- `@sinclair/typebox` cho schema tool parameters.
- Pi peer deps và public extension imports hiện dùng namespace `@earendil-works/*`.
- Không migrate namespace Pi package hàng loạt nếu chưa kiểm tra version Pi đang chạy và compatibility của extension liên quan.

## Extensions trong package

### `harness/`

Một public entrypoint cho Harness observability/proposals/evals và Harness Wiki.

Harness Wiki commands:

```text
/harness-wiki-init
/harness-wiki-update
/harness-wiki-ask
/harness-wiki-status
```

Reviewed prompt rules nằm trong `wiki/**/_rules.md`. Model lazy-load theo `AGENTS.md` → `wiki/quickstart.md` → root/section rules; extension không auto-inject toàn bộ rules. Normal Wiki turns không được sửa `_rules.md`.

### `web-tools/`

Đăng ký 3 tools:

| Tool | Mô tả |
| --- | --- |
| `web_search` | Search web; dùng Tavily nếu có `TAVILY_API_KEY`, fallback DuckDuckGo. Hỗ trợ batch `queries` tối đa 5. |
| `web_fetch` | Fetch URL, đổi GitHub blob → raw, HTTP → HTTPS, HTML → Markdown, hỗ trợ `max_length`, `start_index`, `raw`. |
| `tool_search` | Liệt kê/tìm tools và slash commands hiện có trong session Pi. |

Chi tiết kỹ thuật:

- `TAVILY_API_KEY` có thể chứa nhiều key, phân tách bằng dấu phẩy.
- Cache search/fetch TTL 15 phút, giới hạn cache khoảng 50 entries.
- Rate limit web-tools: khoảng 15 requests/phút.

### `chatgpt-usage-status/`

Hiển thị usage ChatGPT Plus/Pro khi provider là `openai-codex` hoặc `chatgpt`.

Slash commands:

- `/chatgpt-login`
- `/chatgpt-usage`
- `/chatgpt-usage-refresh`
- `/chatgpt-accounts`
- `/chatgpt-switch`
- `/chatgpt-delete`
- `/chatgpt-logout`

Credential/account data là local, không commit:

```text
~/.pi/agent/auth.json
~/.pi/agent/chatgpt-usage-accounts.json
```

### `aurora-ui.ts`

Tùy biến interactive TUI:

- Startup banner.
- Bordered custom editor.
- Fixed input cluster qua `fixed-input-layout/`.
- Footer tối giản chỉ hiển thị extension statuses.
- Working messages tiếng Việt cho agent/tool execution.
- Hiển thị cwd, git branch, git working tree stats.
- Slash command `/aurora-themes` và keybinding liên quan trong code.

Khi sửa TUI:

- Luôn guard `ctx.hasUI` trước thao tác UI lớn.
- Dùng `ctx.ui?.` hoặc try/catch ở cleanup để tránh crash khi session thay đổi.
- Cleanup timer/compositor trong `dispose` hoặc `session_shutdown`.

### `prompt-with-model.ts`

Extension prompt template nâng cao:

- Scan prompt Markdown ở:
  - `~/.pi/agent/model-prompts/`
  - `.pi/agent/model-prompts/`
- Mỗi file `.md` tạo một slash command theo tên file.
- Frontmatter hỗ trợ: `model`, `thinking`, `description`, `argument-hint`.
- Có thể auto switch model → chạy prompt → restore model/thinking.
- Không dùng folder core `prompts/` để tránh trùng cơ chế prompt template mặc định của Pi.
- Wizard commands: `/prompt-create`, `/prompt-edit`.

### `.pi/extensions/log-llm-payload.ts`

Extension local/dev-only ghi payload trước request provider vào:

```text
.pi/logs/llm-payloads/*.json
```

Các file này có thể chứa prompt, context, path, metadata nhạy cảm. Không đọc/commit/chia sẻ trừ khi user yêu cầu rõ.

## Theme

Theme hiện tại: `midnight-aurora` tại `packages/pi-learn-extensions/themes/midnight-aurora.json`.

Màu chính hiện tại:

- Background: `#0b1020`
- Surface: `#121a2f`
- Accent: `auroraCyan` / `#3fbfba`
- Border: `userPanelBorder` / `#5d7cff`
- Success: `auroraGreen`
- Warning: `gold`
- Error: `coral`

Khi sửa UI/theme:

- Ưu tiên dùng token màu từ theme (`theme.fg(...)`, tên color trong JSON).
- Không hard-code ANSI escape nếu có API theme/TUI phù hợp.

## Docs

`docs/README.md` là index chính cho tài liệu tiếng Việt. Bộ docs hiện ghi chú cập nhật theo Pi docs chính thức `earendil-works/pi` ngày `2026-05-19`.

Nhóm docs quan trọng:

- Bắt đầu/sử dụng: `PI_QUICKSTART_GUIDE.md`, `PI_USAGE_GUIDE.md`, `PI_KEYBINDINGS_GUIDE.md`.
- Cấu hình/models: `PI_PROVIDERS_GUIDE.md`, `PI_MODELS_GUIDE.md`, `PI_SETTINGS_GUIDE.md`.
- Mở rộng Pi: `PI_EXTENSIONS_GUIDE.md`, `PI_SKILLS_GUIDE.md`, `PI_PROMPT_TEMPLATES_GUIDE.md`, `PI_THEMES_GUIDE.md`, `PI_PACKAGES_GUIDE.md`, `PI_TUI_GUIDE.md`, `PI_TOOLS_GUIDE.md`.
- Sessions/context: `PI_SESSIONS_GUIDE.md`, `PI_SESSION_FORMAT_GUIDE.md`, `PI_COMPACTION_GUIDE.md`.
- Integration: `PI_SDK_GUIDE.md`, `PI_RPC_GUIDE.md`, `PI_JSON_MODE_GUIDE.md`.
- Platform: Windows/Termux/tmux/terminal/shell aliases.

Khi thêm/sửa docs:

- Viết tiếng Việt rõ ràng, có ví dụ command/config thực tế.
- Cập nhật `docs/README.md` nếu thêm file mới.
- Không để docs mâu thuẫn với README/package manifest hiện tại.

## Workflow cài đặt, test, update

Cài package từ GitHub:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Test tạm không ghi settings:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Sau khi sửa extension/theme, restart Pi hoặc chạy trong Pi:

```text
/reload
```

Update package đã cài theo `@main`:

```bash
pi update
```

Release ổn định nếu cần:

```bash
git tag v1.0.2
git push origin v1.0.2
```

Repo hiện chưa có script test/build trong `package.json`. Khi cần kiểm tra code TypeScript, ưu tiên chạy Pi thực tế hoặc thêm script kiểm tra có chủ đích thay vì giả định có sẵn `npm test`.

## Quy tắc làm việc trong repo

1. **Ngôn ngữ:** docs/comments có thể dùng tiếng Việt; code identifiers dùng tiếng Anh.
2. **Source of truth:** extension/theme public nằm trong `packages/pi-learn-extensions/`. `.pi/extensions/` hiện chỉ có extension local/dev-only.
3. **UI safety:** luôn dùng `ctx.hasUI` và/hoặc `ctx.ui?.` cho UI operations; cleanup timers/listeners/compositor.
4. **Secrets/logs:** không commit token, auth files, `.pi/logs/llm-payloads/*.json`, hoặc nội dung payload nhạy cảm.
5. **Web tools:** `TAVILY_API_KEY` là optional; code phải fallback được sang DuckDuckGo.
6. **Terminal:** user dùng XFCE4 Terminal; không dựa vào inline image protocol.
7. **Package versions:** nếu bump version, giữ root `package.json` và `packages/pi-learn-extensions/package.json` đồng bộ khi phù hợp.
8. **Imports:** giữ style import hiện có theo từng extension; không migrate namespace Pi package nếu chưa kiểm tra compatibility.
9. **Docs trước khi sửa Pi API:** nếu đụng extension/theme/TUI/package behavior, đọc docs liên quan trong `docs/` và/hoặc docs Pi chính thức cài local trước khi thay đổi lớn.
