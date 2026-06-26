# Pi Learn Extensions

Repo Pi package: `https://github.com/vanhiep99w/pi-learn`

Dùng để cài nhanh các extension/theme mình hay dùng cho Pi Coding Agent.

## Có gì trong package này?

- `web-tools` — `web_search`, `web_fetch`, `tool_search`.
- `chatgpt-usage-status` — xem usage ChatGPT Plus/Pro qua OAuth `openai-codex`.
- `prompt-with-model` — prompt templates nâng cao: tạo prompt bằng AI, gắn model/thinking riêng cho từng slash command, preview trước khi lưu.
- `harness` — đọc Pi session logs đã redact/normalize để tạo report, reflection proposals, eval và gated automation.
- `aurora-ui` — custom input border + ChatGPT usage badge.
- `midnight-aurora` — theme dark custom.

Pi load package qua root `package.json`:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

## Cài đặt

### Cài package này

Khuyến nghị cài theo branch `main` để máy khác update bằng `pi update`, không phải đổi tag version thủ công.

Cài global cho mọi project:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Cài vào project hiện tại (`.pi/settings.json`):

```bash
pi install -l git:github.com/vanhiep99w/pi-learn@main
```

Test tạm không ghi settings:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Nếu cần bản ổn định cố định, có thể pin tag release, ví dụ `@v1.0.1`.

### Cài full bộ extension hay dùng

Danh sách thêm ngoài package này:

- `npm:@juicesharp/rpiv-ask-user-question` — tool `ask_user_question` để agent hỏi clarification có cấu trúc.
- `git:github.com/edxeth/pi-gpt-config` — config/GPT helpers. Local cache: `/home/hieptran/.pi/agent/git/github.com/edxeth/pi-gpt-config`

`pi install` nhận **một source mỗi lần**, nên khi cài nhiều package hãy chạy lần lượt hoặc dùng loop.

Global:

```bash
for pkg in \
  git:github.com/vanhiep99w/pi-learn@main \
  npm:@juicesharp/rpiv-ask-user-question \
  git:github.com/edxeth/pi-gpt-config \
  npm:pi-tool-display \
  npm:pi-mcp-adapter \
  npm:pi-markdown-preview \
  npm:pi-mermaid \
  npm:pi-image-preview
do
  pi install "$pkg"
done
```

Project-local:

```bash
for pkg in \
  git:github.com/vanhiep99w/pi-learn@main \
  npm:@juicesharp/rpiv-ask-user-question \
  git:github.com/edxeth/pi-gpt-config \
  npm:pi-tool-display \
  npm:pi-mcp-adapter \
  npm:pi-markdown-preview \
  npm:pi-mermaid \
  npm:pi-image-preview
do
  pi install -l "$pkg"
done
```

Sau khi cài, restart Pi hoặc chạy:

```txt
/reload
```

## Bật theme

Thêm vào `~/.pi/agent/settings.json` hoặc `.pi/settings.json`:

```json
{
  "theme": "midnight-aurora"
}
```

Nếu project settings đã có package:

```json
{
  "theme": "midnight-aurora",
  "packages": [
    "git:github.com/vanhiep99w/pi-learn@main"
  ]
}
```

## Cấu hình tùy chọn

### Tavily cho `web_search`

Không bắt buộc. Nếu có key, search tốt hơn:

```bash
export TAVILY_API_KEY="tvly-..."
```

Thêm lâu dài vào `~/.bashrc` hoặc `~/.zshrc` nếu cần.

### ChatGPT usage

Mỗi máy cần login riêng:

```txt
/chatgpt-login
```

Hoặc:

```txt
/login openai-codex
```

Nếu browser login xong mà Pi hỏi code/URL, paste full redirect URL:

```txt
http://localhost:1455/auth/callback?code=...&state=...
```

Commands:

```txt
/chatgpt-login
/chatgpt-usage
/chatgpt-usage-refresh
/chatgpt-accounts
/chatgpt-switch
/chatgpt-delete    # xoá một/tất cả account đã lưu
/chatgpt-logout    # alias của /chatgpt-delete
```

Credential lưu local, không commit:

```txt
~/.pi/agent/auth.json
~/.pi/agent/chatgpt-usage-accounts.json
```

### Model prompt templates

Extension `prompt-with-model` cho phép tạo slash command từ file Markdown nhưng có thêm frontmatter `model` và `thinking` riêng cho từng prompt.

Nơi scan prompt:

```txt
~/.pi/agent/model-prompts/*.md      # global
.pi/agent/model-prompts/*.md        # project-local
```

Lệnh chính:

```txt
/prompt-create <ý tưởng prompt>      # AI tự viết prompt, cho preview/edit trước khi lưu
/prompt-edit                         # sửa prompt hiện có
/prompt-model                        # chọn prompt rồi đổi model/thinking
/prompt-model <prompt> <provider/model|clear>
```

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

Ghi chú:

- `/prompt-create` chỉ cần bạn nhập ý tưởng; AI sẽ sinh `name`, `description`, `argument-hint`, `model`, `thinking` và nội dung prompt.
- Trước khi lưu, Pi mở editor preview để bạn sửa trực tiếp.
- Khi chạy prompt có `model`, extension sẽ thông báo nổi bật `🤖 MODEL SWITCH`, đổi model tạm thời, chạy prompt, rồi restore model ban đầu.
- Autocomplete của slash command hiển thị `🤖 current` hoặc `🤖 provider/model`, và `🧠 <thinking>` nếu có.
- Sau khi thêm/sửa prompt hoặc đổi model, chạy `/reload` để cập nhật danh sách/mô tả slash command.

## Pi Harness commands

Harness giúp xem lại các Pi sessions gần đây của project và tạo proposal cải thiện có evidence. Output private mặc định nằm ở:

```txt
~/.pi/harness/projects/<project-key>/
```

Mặc định các lệnh dùng **5 session gần nhất**; có thể truyền số khác như `/harness-report 10`.

### Workflow khuyến nghị

```txt
/harness-report          # xem report session gần đây
/harness-reflect-pi      # dùng model hiện tại tạo draft improvement proposals
/harness-proposals       # xem proposal đã tạo
/harness-approve P-0001  # approve proposal muốn apply
/harness-apply P-0001    # apply nếu proposal có patch machine-readable
```

### Danh sách command chính

| Command | Tác dụng |
|---|---|
| `/harness-report [last]` | Scan session gần đây và preview report Markdown. |
| `/harness-last [last]` | Liệt kê session gần đây của project. |
| `/harness-warnings [last]` | Xem parser/normalizer warnings. |
| `/harness-reflect [last]` | Build + preview reflection prompt đã redact, chưa gọi LLM tạo proposal. |
| `/harness-reflect-pi [last]` | Gửi prompt vào model hiện tại; model gọi `harness_import_llm_reflection` để tạo draft proposals. |
| `/harness-propose [rules\|memory\|rule-config\|parser\|redaction] [last]` | Tạo proposal deterministic/targeted không cần LLM. |
| `/harness-proposals` | List + preview draft proposals. |
| `/harness-approve P-0001` | Approve proposal. |
| `/harness-reject P-0001` | Reject proposal. |
| `/harness-apply P-0001` | Apply proposal đã approve nếu có JSON Patch. Không auto-push. |
| `/harness-history [P-0001]` | Xem lifecycle history. |
| `/harness-eval [scenario\|P-0001]` | Chạy deterministic eval suite/scenario/proposal check. |
| `/harness-automation-status` | Xem automation config có enabled/allowed không. |
| `/harness-automate` | Chạy gated automation: scan/report/draft/eval only, không apply/push. |
| `/harness-note <text>` | Ghi private note vào current session. |
| `/harness-tag success\|failure [reason]` | Tag outcome cho current session leaf. |

Ghi chú:

- `/harness-reflect-pi` chỉ dùng normalized evidence, không đọc raw session logs.
- Reflection prompt có target routing guide để model chọn đúng `memory`, `rules`, `agents`, `skill`, `docs`, `parser`, `redaction`, `eval`, `tool`.
- `harness_import_llm_reflection` là tool nội bộ cho model gọi sau `/harness-reflect-pi`; người dùng thường không cần gọi tay.
- Nếu project root không phải git repo, review kỹ trước khi apply vì rollback bằng git có thể không đầy đủ.

Chi tiết đầy đủ về các extension/command nằm ở:

```txt
packages/pi-learn-extensions/README.md
```

## Update / remove

Xem package đã cài:

```bash
pi list
```

Nếu đã cài theo `@main`, update bằng:

```bash
pi update
```

Sau đó restart Pi hoặc chạy:

```txt
/reload
```

Nếu máy đang dùng tag cũ như `@v1.0.0` hoặc `@v1.0.1`, chuyển sang `main` một lần:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Project-local:

```bash
pi install -l git:github.com/vanhiep99w/pi-learn@main
```

Remove global:

```bash
pi remove git:github.com/vanhiep99w/pi-learn
```

Remove project-local:

```bash
pi remove -l git:github.com/vanhiep99w/pi-learn
```

## Maintain repo

Source test trong project:

```txt
.pi/extensions/
.pi/themes/
```

Source package public:

```txt
packages/pi-learn-extensions/extensions/
packages/pi-learn-extensions/themes/
```

Khi sửa extension trong `.pi/extensions`, sync sang package trước khi release:

```bash
rm -rf packages/pi-learn-extensions/extensions packages/pi-learn-extensions/themes
mkdir -p packages/pi-learn-extensions/extensions packages/pi-learn-extensions/themes

cp -r .pi/extensions/web-tools packages/pi-learn-extensions/extensions/
cp -r .pi/extensions/chatgpt-usage-status packages/pi-learn-extensions/extensions/
cp .pi/extensions/prompt-with-model.ts packages/pi-learn-extensions/extensions/
cp .pi/extensions/aurora-ui.ts packages/pi-learn-extensions/extensions/
cp .pi/themes/midnight-aurora.json packages/pi-learn-extensions/themes/
```

Publish thay đổi lên `main`:

```bash
git add .
git commit -m "Update extensions"
git push origin main
```

Người dùng đã cài `@main` update bằng:

```bash
pi update
```

Nếu muốn phát hành bản ổn định cố định, tạo tag release:

```bash
git tag v1.0.2
git push origin v1.0.2
```

Người dùng muốn pin bản ổn định có thể cài:

```bash
pi install git:github.com/vanhiep99w/pi-learn@v1.0.2
```

