# Pi Learn Extensions

Repo Pi package: `https://github.com/vanhiep99w/pi-learn`

Dùng để cài nhanh các extension/theme mình hay dùng cho Pi Coding Agent.

## Có gì trong package này?

- `web-tools` — `web_search`, `web_fetch`, `tool_search`.
- `chatgpt-usage-status` — xem usage ChatGPT Plus/Pro qua OAuth `openai-codex`.
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

