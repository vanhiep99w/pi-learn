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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **pi-learn** (1345 symbols, 1432 relationships, 10 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/pi-learn/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/pi-learn/context` | Codebase overview, check index freshness |
| `gitnexus://repo/pi-learn/clusters` | All functional areas |
| `gitnexus://repo/pi-learn/processes` | All execution flows |
| `gitnexus://repo/pi-learn/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
