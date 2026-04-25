# 🔑 Pi Providers — Hướng Dẫn Chi Tiết

> Tham khảo từ [packages/coding-agent/docs/providers.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md)  
> Pi hỗ trợ cả đăng nhập bằng subscription (OAuth) và API key cho nhiều nhà cung cấp LLM.

---

## Mục Lục

- [1. Subscriptions (OAuth)](#1-subscriptions-oauth)
  - [1.1 Đăng Nhập / Đăng Xuất](#11-đăng-nhập--đăng-xuất)
  - [1.2 GitHub Copilot](#12-github-copilot)
  - [1.3 Google Providers](#13-google-providers)
  - [1.4 OpenAI Codex](#14-openai-codex)
- [2. API Keys](#2-api-keys)
  - [2.1 Bảng Environment Variables](#21-bảng-environment-variables)
  - [2.2 Auth File (`auth.json`)](#22-auth-file-authjson)
  - [2.3 Key Resolution — 3 Định Dạng](#23-key-resolution--3-định-dạng)
- [3. Cloud Providers](#3-cloud-providers)
  - [3.1 Azure OpenAI](#31-azure-openai)
  - [3.2 Amazon Bedrock](#32-amazon-bedrock)
  - [3.3 Google Vertex AI](#33-google-vertex-ai)
- [4. Custom Providers](#4-custom-providers)
- [5. Resolution Order — Thứ Tự Ưu Tiên](#5-resolution-order--thứ-tự-ưu-tiên)

---

## 1. Subscriptions (OAuth)

Pi cho phép dùng subscription hiện có của bạn (Claude Pro, ChatGPT Plus, v.v.) thông qua OAuth — không cần API key riêng.

### 1.1 Đăng Nhập / Đăng Xuất

Trong interactive mode, dùng lệnh `/login` rồi chọn provider:

| Provider | Yêu cầu |
|----------|----------|
| **Claude Pro/Max** | Subscription Anthropic Claude Pro hoặc Max |
| **ChatGPT Plus/Pro** (Codex) | Subscription OpenAI ChatGPT Plus hoặc Pro |
| **GitHub Copilot** | GitHub Copilot subscription |
| **Google Gemini CLI** | Google account (miễn phí, có rate limit) |
| **Google Antigravity** | Google account (miễn phí, có rate limit) |

Dùng `/logout` để xóa credentials. Token được lưu tại `~/.pi/agent/auth.json` và tự động refresh khi hết hạn.

### 1.2 GitHub Copilot

- Nhấn Enter để dùng github.com, hoặc nhập domain GitHub Enterprise Server của bạn
- Nếu gặp lỗi **"model not supported"**: mở VS Code → Copilot Chat → model selector → chọn model → **"Enable"**

### 1.3 Google Providers

- **Gemini CLI**: Các model Gemini tiêu chuẩn thông qua Cloud Code Assist
- **Antigravity**: Sandbox với Gemini 3, Claude, và GPT-OSS models
- Cả hai đều **miễn phí** với bất kỳ Google account nào, có rate limit
- Nếu dùng **Cloud Code Assist trả phí**: set biến `GOOGLE_CLOUD_PROJECT`

### 1.4 OpenAI Codex

- Yêu cầu subscription ChatGPT Plus hoặc Pro
- Chỉ dùng cho mục đích cá nhân; cho production, dùng OpenAI Platform API

---

## 2. API Keys

### 2.1 Bảng Environment Variables

Set API key qua biến môi trường trước khi chạy Pi:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

Bảng đầy đủ các provider và biến môi trường tương ứng:

| Provider | Environment Variable | `auth.json` key |
|----------|----------------------|------------------|
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` |
| Azure OpenAI Responses | `AZURE_OPENAI_API_KEY` | `azure-openai-responses` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| Google Gemini | `GEMINI_API_KEY` | `google` |
| Mistral | `MISTRAL_API_KEY` | `mistral` |
| Groq | `GROQ_API_KEY` | `groq` |
| Cerebras | `CEREBRAS_API_KEY` | `cerebras` |
| xAI | `XAI_API_KEY` | `xai` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `vercel-ai-gateway` |
| ZAI | `ZAI_API_KEY` | `zai` |
| OpenCode Zen | `OPENCODE_API_KEY` | `opencode` |
| OpenCode Go | `OPENCODE_API_KEY` | `opencode-go` |
| Hugging Face | `HF_TOKEN` | `huggingface` |
| Kimi For Coding | `KIMI_API_KEY` | `kimi-coding` |
| MiniMax | `MINIMAX_API_KEY` | `minimax` |
| MiniMax (China) | `MINIMAX_CN_API_KEY` | `minimax-cn` |

> **Tham khảo source:** [`const envMap` trong `packages/ai/src/env-api-keys.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/env-api-keys.ts)

### 2.2 Auth File (`auth.json`)

Lưu credentials trong file `~/.pi/agent/auth.json`:

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "sk-..." },
  "google": { "type": "api_key", "key": "..." },
  "opencode": { "type": "api_key", "key": "..." },
  "opencode-go": { "type": "api_key", "key": "..." }
}
```

**Lưu ý quan trọng:**

- File được tạo với permission `0600` (chỉ user đọc/ghi)
- Credentials trong auth file **ưu tiên hơn** environment variables
- OAuth credentials cũng được lưu tại đây sau khi `/login`, và Pi tự quản lý

### 2.3 Key Resolution — 3 Định Dạng

Trường `key` trong auth.json hỗ trợ 3 định dạng:

#### Shell command — `"!command"`

Thực thi lệnh và dùng stdout làm key. Kết quả được cache trong suốt vòng đời process.

```json
{ "type": "api_key", "key": "!security find-generic-password -ws 'anthropic'" }
{ "type": "api_key", "key": "!op read 'op://vault/item/credential'" }
```

> **Tip:** Dùng cách này với **macOS Keychain** (`security`) hoặc **1Password CLI** (`op`) để tránh hard-code key.

#### Environment variable

Giá trị là tên biến môi trường — Pi sẽ đọc value từ biến đó.

```json
{ "type": "api_key", "key": "MY_ANTHROPIC_KEY" }
```

#### Literal value

Key được dùng trực tiếp — không khuyến khích cho production.

```json
{ "type": "api_key", "key": "sk-ant-..." }
```

---

## 3. Cloud Providers

### 3.1 Azure OpenAI

```bash
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_BASE_URL=https://your-resource.openai.azure.com
# hoặc dùng resource name thay vì base URL
export AZURE_OPENAI_RESOURCE_NAME=your-resource

# Tùy chọn
export AZURE_OPENAI_API_VERSION=2024-02-01
export AZURE_OPENAI_DEPLOYMENT_NAME_MAP=gpt-4=my-gpt4,gpt-4o=my-gpt4o
```

### 3.2 Amazon Bedrock

Có nhiều cách xác thực:

```bash
# Cách 1: AWS Profile
export AWS_PROFILE=your-profile

# Cách 2: IAM Keys
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...

# Cách 3: Bearer Token
export AWS_BEARER_TOKEN_BEDROCK=...

# Region (mặc định: us-east-1)
export AWS_REGION=us-west-2
```

Cũng hỗ trợ ECS task roles (`AWS_CONTAINER_CREDENTIALS_*`) và IRSA (`AWS_WEB_IDENTITY_TOKEN_FILE`).

**Sử dụng:**

```bash
pi --provider amazon-bedrock --model us.anthropic.claude-sonnet-4-20250514-v1:0
```

**Prompt caching** được bật tự động cho Claude models có ID chứa tên model nhận dạng được. Với application inference profiles (ARN không chứa tên model), set `AWS_BEDROCK_FORCE_CACHE=1`:

```bash
export AWS_BEDROCK_FORCE_CACHE=1
pi --provider amazon-bedrock --model arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123
```

**Kết nối qua proxy:**

```bash
# URL proxy Bedrock (biến chuẩn AWS SDK)
export AWS_ENDPOINT_URL_BEDROCK_RUNTIME=https://my.corp.proxy/bedrock

# Proxy không yêu cầu auth
export AWS_BEDROCK_SKIP_AUTH=1

# Proxy chỉ hỗ trợ HTTP/1.1
export AWS_BEDROCK_FORCE_HTTP1=1
```

### 3.3 Google Vertex AI

Dùng Application Default Credentials:

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project
export GOOGLE_CLOUD_LOCATION=us-central1
```

Hoặc set `GOOGLE_APPLICATION_CREDENTIALS` trỏ đến file service account key.

---

## 4. Custom Providers

### Qua `models.json`

Thêm Ollama, LM Studio, vLLM, hoặc bất kỳ provider nào nói API tương thích (OpenAI Completions, OpenAI Responses, Anthropic Messages, Google Generative AI).

→ Xem chi tiết: [models.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)

### Qua Extensions

Cho các provider cần custom API implementation hoặc OAuth flows, tạo extension.

→ Xem chi tiết: [custom-provider.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)  
→ Ví dụ: [custom-provider-gitlab-duo](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/)

---

## 5. Resolution Order — Thứ Tự Ưu Tiên

Khi Pi resolve credentials cho một provider, thứ tự ưu tiên từ cao đến thấp:

```
1. CLI flag        →  pi --api-key sk-ant-...
2. auth.json       →  ~/.pi/agent/auth.json (API key hoặc OAuth token)
3. Env variable    →  ANTHROPIC_API_KEY, OPENAI_API_KEY, v.v.
4. models.json     →  Custom provider keys từ file models.json
```

| Ưu tiên | Nguồn | Ghi chú |
|---------|-------|---------|
| 1 (cao nhất) | `--api-key` CLI flag | Override mọi thứ, dùng cho testing nhanh |
| 2 | `auth.json` | Persistent, hỗ trợ shell command & OAuth |
| 3 | Environment variable | Phổ biến nhất, dùng trong CI/CD |
| 4 (thấp nhất) | `models.json` | Cho custom/self-hosted providers |

> **Mẹo:** Dùng `auth.json` với shell command (`"!op read ..."`) là cách an toàn và tiện lợi nhất — key không nằm trong plaintext, tự động resolve, và ưu tiên cao hơn env var.
