# AGENTS.md — Pi Learn Project

## Tổng Quan

Đây là project học tập và thực nghiệm Pi Coding Agent — một terminal coding agent mã nguồn mở của Mario Zechner. Project tập trung vào việc xây dựng extensions, custom agents, Aurora Teams, themes, và tài liệu hướng dẫn bằng tiếng Việt.

## Cấu Trúc Dự Án

```
pi-learn/
├── .pi/                          # Pi project config
│   ├── settings.json             # Theme: midnight-aurora
│   ├── agents/                   # Custom sub-agents (Aurora Teams)
│   │   ├── scout.md              # Trinh sát codebase (haiku, read-only)
│   │   ├── planner.md            # Lập kế hoạch implementation (sonnet, read-only)
│   │   ├── worker.md             # Thực thi code (sonnet, full tools)
│   │   └── reviewer.md           # Code review (sonnet, read-only)
│   ├── extensions/
│   │   ├── web-tools/            # 🌐 Web search, fetch, librarian
│   │   ├── aurora-teams/         # 🤖 Multi-agent orchestration
│   │   ├── aurora-ui.ts          # 🎨 Aurora Teams TUI monitor
│   │   └── titlebar-spinner.ts   # 🔄 Braille spinner trên terminal title
│   ├── teams/                    # Aurora team definitions
│   ├── themes/
│   │   └── midnight-aurora.json  # Custom dark theme
│   └── workflows/                # Automation workflows
├── docs/                         # 📚 Tài liệu Pi bằng tiếng Việt
│   ├── PI_EXTENSIONS_GUIDE.md
│   ├── PI_TUI_GUIDE.md
│   ├── PI_THEMES_GUIDE.md
│   ├── PI_SKILLS_GUIDE.md
│   ├── PI_SESSIONS_GUIDE.md
│   ├── PI_PROMPT_TEMPLATES_GUIDE.md
│   └── AURORA_TEAMS.md
├── scripts/                      # Utility scripts
│   ├── watch-team.sh             # Monitor Aurora team execution
│   └── aurora-monitor            # TUI monitor binary
└── landing-page/                 # Landing page project
```

## Extensions

### web-tools (`@pi-learn/web-tools`)
Extension cung cấp khả năng truy cập web cho Pi agent. Gồm 3 tools:

| Tool | Mô tả |
|------|--------|
| `web_search` | Tìm kiếm web qua Tavily API |
| `web_fetch` | Fetch và parse nội dung từ URL |
| `tool_search` | Tìm NPM packages phù hợp |

**Lưu ý khi sửa web-tools:**
- File chính: `index.ts` (đăng ký tools)
- Mỗi tool một file riêng: `web-search.ts`, `web-fetch.ts`, `tool-search.ts`
- Utils dùng chung: `utils.ts` (cache, rate limit), `parsers.ts` (HTML parsing)
- Cần `TAVILY_API_KEY` env var cho web_search

- Dùng `ctx.ui?.` (optional chaining) tránh crash khi `ui` chưa init

### aurora-teams
Extension multi-agent orchestration. Cho phép định nghĩa team gồm nhiều sub-agents (scout → planner → worker → reviewer) phối hợp hoàn thành task.

### titlebar-spinner
Extension nhẹ — hiện braille spinner animation (`⠋⠙⠹…`) trên terminal title khi agent đang xử lý.

## Custom Agents (Sub-agents)

Dành cho Aurora Teams, 4 agent chuyên biệt:

| Agent | Model | Vai trò | Tools |
|-------|-------|---------|-------|
| `scout` | claude-haiku-4-5 | Trinh sát codebase, thu thập context | read, grep, find, ls, bash |
| `planner` | claude-sonnet-4-5 | Lập kế hoạch chi tiết, KHÔNG sửa code | read, grep, find, ls |
| `worker` | claude-sonnet-4-5 | Thực thi implementation plan | full tools |
| `reviewer` | claude-sonnet-4-5 | Review code quality, security | read, grep, find, ls, bash |

## Theme

**midnight-aurora** — Dark theme với bảng màu aurora borealis:
- Background: `#111827` (deep navy)
- Accent: sky blue (`#5dc8f5`)
- Border: blue/cyan gradient
- Success: lime, Error: red, Warning: yellow

## Quy Tắc Khi Làm Việc

1. **Ngôn ngữ:** Comments và docs có thể bằng tiếng Việt. Code identifiers bằng tiếng Anh.
2. **Extensions:** Luôn dùng optional chaining (`ctx.ui?.`) cho UI methods để tránh crash khi context chưa ready.
3. **Testing:** Restart pi sau khi sửa extension (`ctrl+c` rồi chạy lại `pi`).
4. **Docs:** Tài liệu Pi bằng tiếng Việt nằm trong `docs/` — tham khảo trước khi hỏi.
5. **Theme:** Project dùng theme `midnight-aurora` — dùng theme colors chứ không hard-code ANSI.
6. **Terminal:** User dùng XFCE4 Terminal (không hỗ trợ inline image). Các feature cần image protocol sẽ không hoạt động.
