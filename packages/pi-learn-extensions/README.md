# Pi Learn Extensions Package

Đây là package extension/theme mà root repo expose cho Pi Coding Agent.

Repo GitHub:

```txt
https://github.com/vanhiep99w/pi-learn
```

Cài từ root repo:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Test tạm không ghi settings:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Sau khi cài/update, restart Pi hoặc chạy:

```txt
/reload
```

Root `package.json` expose package này như sau:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

---

## Nên dùng command nào trước?

Nếu thấy quá nhiều command, dùng theo thứ tự này:

```txt
1. /harness-report          Xem report session gần đây của project.
2. /harness-improve         Nhờ model hiện tại tạo improvement proposals.
3. /harness-proposals       Mở modal review: xem chi tiết, approve hoặc reject.
4. /harness-approve          Mở modal với action approve được chọn sẵn.
5. /harness-apply P-0001     Apply proposal đã approve, nếu proposal có patch.
```

Các command còn lại chủ yếu để debug, kiểm tra, hoặc quản lý nâng cao.

---

## Included extensions/themes

```txt
extensions/
├── web-tools/                  # web_search, web_fetch, tool_search
├── harness/                    # observability, proposals, eval, Harness Wiki
├── chatgpt-usage-status/       # ChatGPT Plus/Pro usage status
├── fixed-input-layout/         # helper cho aurora-ui
├── prompt-with-model.ts        # prompt templates có model/thinking riêng
└── aurora-ui.ts                # custom TUI/editor/footer/status

themes/
└── midnight-aurora.json
```

---

## 1. Web tools

Extension `web-tools/` đăng ký các tool cho agent dùng khi cần search/fetch tài liệu.

| Tool | Tác dụng | Khi nào dùng |
|---|---|---|
| `web_search` | Search web, dùng Tavily nếu có `TAVILY_API_KEY`, fallback DuckDuckGo. Hỗ trợ batch `queries`. | Tìm docs/current info/tutorial. |
| `web_fetch` | Fetch URL, GitHub blob → raw, HTML → Markdown, hỗ trợ `max_length`, `start_index`, `raw`. | Đọc nội dung URL cụ thể. |
| `tool_search` | Liệt kê/tìm tools và slash commands trong Pi session. | Khi không nhớ command/tool nào đang có. |

Cấu hình Tavily optional:

```bash
export TAVILY_API_KEY="tvly-..."
```

---

## 2. Harness extension

Harness đọc Pi session logs đã redact/normalize để tạo report, proposals, eval và self-improvement workflow. Output mặc định nằm ngoài repo:

```txt
~/.pi/harness/projects/<project-key>/
├── sessions/<session-id>/       # manifest/events/metrics/warnings
├── reports/latest.md
├── reflections/latest.md
├── proposals/draft/P-0001-*.md
└── evals/latest.md
```

Mặc định các command dùng **5 session gần nhất**. Có thể truyền số khác, ví dụ:

```txt
/harness-status 10
/harness-report 10
/harness-improve 10
```

### Command chính khuyến nghị

| Command | Tác dụng | Ví dụ |
|---|---|---|
| `/harness-status [last]` | Trạng thái tổng hợp: session gần đây, warning summary, automation state. | `/harness-status` hoặc `/harness-status 10` |
| `/harness-report [last]` | Scan session gần đây, tạo và preview report Markdown. | `/harness-report` hoặc `/harness-report 10` |
| `/harness-improve [last]` | Gửi reflection prompt vào model hiện tại; model phải gọi tool import để tạo draft proposals. | Cách chính để tạo proposal bằng LLM. |
| `/harness-proposals` | Mở modal chọn proposal, xem tóm tắt/Markdown đầy đủ, approve hoặc reject. | Sau `/harness-improve`. |
| `/harness-approve [P-0001]` | Mở modal review với action approve được chọn sẵn; ID là tùy chọn trong TUI. | `/harness-approve` hoặc `/harness-approve P-0001` |
| `/harness-reject [P-0001]` | Mở modal review với action reject được chọn sẵn; ID là tùy chọn trong TUI. | `/harness-reject` hoặc `/harness-reject P-0001` |
| `/harness-apply P-0001` | Apply proposal đã approve nếu proposal có JSON Patch machine-readable. | `/harness-apply P-0001` |
| `/harness-eval [scenario\|P-0001]` | Chạy deterministic eval suite hoặc scenario/proposal cụ thể. | `/harness-eval`, `/harness-eval redaction-fixture` |
| `/harness-mark success\|failure\|note [text]` | Mark current session bằng success/failure hoặc ghi note riêng. | `/harness-mark success fixed Redis config` |

Ghi chú `/harness-improve`:

- Chỉ dùng normalized evidence, không đọc raw session logs.
- Prompt có target routing guide để chọn đúng `memory`, `rules`, `agents`, `skill`, `docs`, `parser`, `redaction`, `eval`, `tool`.
- Tool `harness_import_llm_reflection` chỉ dành cho model gọi tự động sau command này; người dùng thường không cần gọi tay.

### Harness Wiki

Harness Wiki nằm trong cùng `harness/` entrypoint:

```txt
/harness-wiki-init [ghi chú]
/harness-wiki-update [ghi chú]
/harness-wiki-ask <câu hỏi>
/harness-wiki-status
```

- Không còn `/wiki-*` aliases hoặc `extensions/wiki/` entrypoint.
- Normal docs nằm trong `wiki/**/*.md`; reviewed prompt rules nằm trong `wiki/**/_rules.md`.
- Model lazy-load rules theo `AGENTS.md` → `wiki/quickstart.md` → root/section `_rules.md` bằng tool `read`.
- Extension không tự inject toàn bộ rules và không cần reload/cache watcher cho Markdown content.
- Wiki turns bị chặn sửa `_rules.md`; rule changes chỉ đi qua approved controlled apply.

Apply/automation policy:

- Không auto-push.
- `/harness-apply` yêu cầu proposal approved và chỉ apply file nằm trong target list của proposal.
- Với project không phải git repo, nên review kỹ vì rollback bằng git có thể không đầy đủ.
- Automation mặc định off. Nếu bật trong `harness/config.json`, vẫn chỉ draft/report/eval, không tự apply.

---

## 3. ChatGPT usage status

Hiển thị usage ChatGPT Plus/Pro khi dùng provider `openai-codex` hoặc `chatgpt`.

| Command | Tác dụng |
|---|---|
| `/chatgpt-login` | Login thêm account ChatGPT và lưu local. |
| `/chatgpt-usage` | Hiển thị usage hiện tại. |
| `/chatgpt-usage-refresh` | Refresh usage. |
| `/chatgpt-accounts` | Liệt kê account đã lưu. |
| `/chatgpt-switch` | Chuyển sang account tiếp theo. |
| `/chatgpt-delete` | Xoá một/tất cả account. |
| `/chatgpt-logout` | Alias của `/chatgpt-delete`. |

Credential lưu local, không commit:

```txt
~/.pi/agent/auth.json
~/.pi/agent/chatgpt-usage-accounts.json
```

---

## 4. Prompt with model

Extension `prompt-with-model.ts` tạo slash command từ Markdown prompt, hỗ trợ frontmatter `model` và `thinking` riêng.

Nơi scan prompt:

```txt
~/.pi/agent/model-prompts/*.md
.pi/agent/model-prompts/*.md
```

| Command | Tác dụng |
|---|---|
| `/prompt-create <ý tưởng>` | AI tạo prompt mới, mở preview/editor trước khi lưu. |
| `/prompt-edit` | Chọn và sửa prompt hiện có. |
| `/prompt-model` | Wizard đổi model/thinking của prompt. |
| `/prompt-model <prompt> <provider/model\|clear>` | Set/clear model cho prompt bằng command. |

Ví dụ frontmatter:

```md
---
description: "Review code và chỉ ra rủi ro chính"
argument-hint: "<file-or-scope>"
model: "anthropic/claude-sonnet-4-20250514"
thinking: "high"
---

Review phạm vi sau và trả lời có cấu trúc:

$@
```

Sau khi thêm/sửa prompt, chạy:

```txt
/reload
```

---

## 5. Aurora UI + fixed input layout

Extension `aurora-ui.ts` custom TUI:

- Startup banner.
- Editor border/fixed input cluster.
- Footer tối giản.
- Working messages tiếng Việt.
- Hiển thị cwd/git branch/git stats.
- Tích hợp status extension.

Command:

| Command | Tác dụng |
|---|---|
| `/aurora-themes` | Chọn theme nhanh. |

Theme đi kèm:

```txt
midnight-aurora
```

Bật theme trong settings:

```json
{
  "theme": "midnight-aurora"
}
```

---

## Update / remove

Xem package đã cài:

```bash
pi list
```

Update nếu đã cài theo `@main`:

```bash
pi update
```

Remove global:

```bash
pi remove git:github.com/vanhiep99w/pi-learn
```

Remove project-local:

```bash
pi remove -l git:github.com/vanhiep99w/pi-learn
```

Xem hướng dẫn chi tiết ở README root repo:

```txt
../../README.md
```


## Included

```txt
extensions/
├── web-tools/
├── chatgpt-usage-status/
├── harness/             # Pi Harness + Harness Wiki commands
├── fixed-input-layout/  # vendored compositor helpers for aurora-ui
├── prompt-with-model.ts # model-aware prompt template commands
└── aurora-ui.ts         # fixed input cluster + bordered editor

themes/
└── midnight-aurora.json
```
