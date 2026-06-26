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
2. /harness-reflect-pi      Nhờ model hiện tại tạo improvement proposals.
3. /harness-proposals       Xem proposal đã tạo.
4. /harness-approve P-0001  Approve proposal muốn apply.
5. /harness-apply P-0001    Apply proposal đã approve, nếu proposal có patch.
```

Các command còn lại chủ yếu để debug, kiểm tra, hoặc quản lý nâng cao.

---

## Included extensions/themes

```txt
extensions/
├── web-tools/                  # web_search, web_fetch, tool_search
├── harness/                    # session mining, report, proposals, eval, automation
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
/harness-report 10
/harness-reflect-pi 10
/harness-propose rules 10
```

### Nhóm read-only/report

| Command | Tác dụng | Ví dụ |
|---|---|---|
| `/harness-report [last]` | Scan session gần đây, tạo và preview report Markdown. | `/harness-report` hoặc `/harness-report 10` |
| `/harness-last [last]` | Liệt kê session gần đây của project hiện tại. | `/harness-last 5` |
| `/harness-warnings [last]` | Scan và hiển thị parser/normalizer warnings. | `/harness-warnings` |

### Nhóm reflection/proposal

| Command | Tác dụng | Khi nào dùng |
|---|---|---|
| `/harness-reflect [last]` | Chỉ build + preview prompt reflection đã redact, chưa gọi model tạo proposal. | Muốn kiểm tra prompt/evidence trước. |
| `/harness-reflect-pi [last]` | Gửi reflection prompt vào model hiện tại; model phải gọi tool import để tạo draft proposals. | Cách chính để tạo proposal bằng LLM. |
| `/harness-propose [rules\|memory\|rule-config\|parser\|redaction] [last]` | Tạo proposal deterministic/targeted không cần LLM. | Khi muốn rule-based proposals. |
| `/harness-proposals` | List + preview draft proposals. | Sau `/harness-reflect-pi` hoặc `/harness-propose`. |

Ghi chú `/harness-reflect-pi`:

- Chỉ dùng normalized evidence, không đọc raw session logs.
- Prompt có target routing guide để chọn đúng `memory`, `rules`, `agents`, `skill`, `docs`, `parser`, `redaction`, `eval`, `tool`.
- Tool `harness_import_llm_reflection` chỉ dành cho model gọi tự động sau command này; người dùng thường không cần gọi tay.

### Nhóm lifecycle/apply

| Command | Tác dụng | Ví dụ |
|---|---|---|
| `/harness-approve P-0001` | Đánh dấu proposal là approved. | `/harness-approve P-0001` |
| `/harness-reject P-0001` | Reject proposal. | `/harness-reject P-0001` |
| `/harness-apply P-0001` | Apply proposal đã approve nếu proposal có JSON Patch machine-readable. | `/harness-apply P-0001` |
| `/harness-history [P-0001]` | Xem lịch sử approve/reject/apply/rollback. | `/harness-history` |

Apply policy:

- Không auto-push.
- Yêu cầu proposal approved.
- Chỉ apply file nằm trong target list của proposal.
- Với project không phải git repo, nên review kỹ vì rollback bằng git có thể không đầy đủ.

### Nhóm eval/automation

| Command | Tác dụng | Ví dụ |
|---|---|---|
| `/harness-eval [scenario\|P-0001]` | Chạy deterministic eval suite hoặc scenario/proposal cụ thể. | `/harness-eval`, `/harness-eval redaction-fixture` |
| `/harness-automation-status` | Xem automation config có enabled/allowed không. | `/harness-automation-status` |
| `/harness-automate` | Chạy automation có gate: scan/report/draft/eval only; không apply/push. | `/harness-automate` |

Automation mặc định off. Nếu bật trong `harness/config.json`, vẫn chỉ draft/report/eval, không tự apply.

### Nhóm note/tag

| Command | Tác dụng | Ví dụ |
|---|---|---|
| `/harness-note <text>` | Append private note vào Pi session hiện tại. | `/harness-note cần nhớ workflow Redis` |
| `/harness-tag success\|failure [reason]` | Tag session leaf để làm evidence outcome. | `/harness-tag success fixed redis config` |

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
