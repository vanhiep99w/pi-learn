# 🤖 Pi Custom Models — Hướng Dẫn Chi Tiết

> Tham khảo chính thức từ [packages/coding-agent/docs/models.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)  
> Thêm custom providers và models (Ollama, vLLM, LM Studio, proxies) qua file JSON đơn giản!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Minimal Example — Ollama](#2-minimal-example--ollama)
- [3. Full Example](#3-full-example)
- [4. Google AI Studio Example](#4-google-ai-studio-example)
- [5. Supported APIs](#5-supported-apis)
- [6. Provider Configuration](#6-provider-configuration)
  - [6.1 Các Trường Cấu Hình](#61-các-trường-cấu-hình)
  - [6.2 Value Resolution — Cách Phân Giải Giá Trị](#62-value-resolution--cách-phân-giải-giá-trị)
  - [6.3 Custom Headers](#63-custom-headers)
- [7. Model Configuration](#7-model-configuration)
- [8. Overriding Built-in Providers](#8-overriding-built-in-providers)
- [9. Per-model Overrides — modelOverrides](#9-per-model-overrides--modeloverrides)
- [10. OpenAI Compatibility — Trường `compat`](#10-openai-compatibility--trường-compat)
- [11. OpenRouter Routing Example](#11-openrouter-routing-example)
- [12. Vercel AI Gateway Example](#12-vercel-ai-gateway-example)

---

## 1. Tổng Quan

Pi cho phép bạn thêm **custom providers** và **custom models** thông qua file cấu hình:

```
~/.pi/agent/models.json
```

### Đặc điểm

- 🔌 **Hỗ trợ đa provider** — Ollama, vLLM, LM Studio, OpenRouter, Google AI Studio, proxies,...
- 🔄 **Hot reload** — sửa file → mở `/model` là thấy ngay, không cần restart
- 🔐 **Value resolution** — hỗ trợ env var, shell command, hoặc literal cho API keys
- 🧩 **Merge semantics** — thêm models vào provider có sẵn mà không mất models built-in
- ⚙️ **Compat flags** — xử lý các server OpenAI-compatible không đầy đủ

---

## 2. Minimal Example — Ollama

Với local models (Ollama, LM Studio, vLLM), chỉ cần `id` cho mỗi model:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

> **Lưu ý:** `apiKey` bắt buộc phải có nhưng Ollama bỏ qua nó — dùng giá trị bất kỳ.

### Xử lý server không tương thích đầy đủ

Một số server OpenAI-compatible không hiểu role `developer` hoặc `reasoning_effort`. Dùng `compat` để xử lý:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "gpt-oss:20b",
          "reasoning": true
        }
      ]
    }
  }
}
```

- `supportsDeveloperRole: false` → Pi gửi system prompt dưới dạng `system` message thay vì `developer`
- `supportsReasoningEffort: false` → không gửi tham số `reasoning_effort`

Có thể đặt `compat` ở **provider level** (áp dụng tất cả models) hoặc **model level** (override riêng model đó).

---

## 3. Full Example

Override mọi giá trị mặc định khi cần:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        {
          "id": "llama3.1:8b",
          "name": "Llama 3.1 8B (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

> File được reload mỗi lần mở `/model`. Sửa trong session, không cần restart.

---

## 4. Google AI Studio Example

Dùng API type `google-generative-ai` với `baseUrl` để thêm models từ Google AI Studio (ví dụ Gemma 4):

```json
{
  "providers": {
    "my-google": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "api": "google-generative-ai",
      "apiKey": "GEMINI_API_KEY",
      "models": [
        {
          "id": "gemma-4-31b-it",
          "name": "Gemma 4 31B",
          "input": ["text", "image"],
          "contextWindow": 262144,
          "reasoning": true
        }
      ]
    }
  }
}
```

> **Lưu ý:** `baseUrl` là bắt buộc khi thêm custom models cho API type `google-generative-ai`.

---

## 5. Supported APIs

| API | Mô tả |
|-----|--------|
| `openai-completions` | OpenAI Chat Completions — tương thích rộng nhất |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI |

Đặt `api` ở **provider level** (mặc định cho tất cả models) hoặc **model level** (override riêng).

---

## 6. Provider Configuration

### 6.1 Các Trường Cấu Hình

| Trường | Mô tả |
|--------|--------|
| `baseUrl` | URL endpoint của API |
| `api` | Loại API (xem bảng trên) |
| `apiKey` | API key (hỗ trợ value resolution — xem bên dưới) |
| `headers` | Custom headers (hỗ trợ value resolution) |
| `authHeader` | Đặt `true` để tự động thêm `Authorization: Bearer <apiKey>` |
| `models` | Mảng model configurations |
| `modelOverrides` | Override riêng cho từng built-in model trên provider này |

### 6.2 Value Resolution — Cách Phân Giải Giá Trị

Các trường `apiKey` và `headers` hỗ trợ 3 định dạng:

#### Shell Command — Bắt đầu bằng `!`

Chạy lệnh shell và dùng stdout:

```json
"apiKey": "!security find-generic-password -ws 'anthropic'"
"apiKey": "!op read 'op://vault/item/credential'"
```

#### Environment Variable — Tên biến môi trường

Dùng giá trị từ biến môi trường:

```json
"apiKey": "MY_API_KEY"
```

#### Literal Value — Giá trị trực tiếp

Dùng trực tiếp:

```json
"apiKey": "sk-..."
```

> **Lưu ý quan trọng:**
> - Shell commands được resolve tại **thời điểm request**, không phải lúc khởi động.
> - Pi **không** áp dụng TTL, cache, hay recovery logic cho shell commands.
> - Nếu command chậm, tốn kém, hoặc bị rate-limit, hãy **tự wrap** trong script riêng với caching phù hợp.
> - `/model` availability check dùng auth presence, **không** chạy shell commands.

### 6.3 Custom Headers

Dùng headers để truyền thêm thông tin cho proxy hoặc provider tùy chỉnh:

```json
{
  "providers": {
    "custom-proxy": {
      "baseUrl": "https://proxy.example.com/v1",
      "apiKey": "MY_API_KEY",
      "api": "anthropic-messages",
      "headers": {
        "x-portkey-api-key": "PORTKEY_API_KEY",
        "x-secret": "!op read 'op://vault/item/secret'"
      },
      "models": [...]
    }
  }
}
```

Mỗi giá trị header cũng hỗ trợ value resolution (`!command`, env var, hoặc literal).

---

## 7. Model Configuration

| Trường | Bắt buộc | Mặc định | Mô tả |
|--------|----------|----------|--------|
| `id` | ✅ | — | Model identifier (gửi tới API) |
| `name` | ❌ | `id` | Tên hiển thị. Dùng cho matching (`--model`) và hiển thị trong model details/status |
| `api` | ❌ | API của provider | Override API type riêng cho model này |
| `reasoning` | ❌ | `false` | Hỗ trợ extended thinking |
| `input` | ❌ | `["text"]` | Loại input: `["text"]` hoặc `["text", "image"]` |
| `contextWindow` | ❌ | `128000` | Kích thước context window (tokens) |
| `maxTokens` | ❌ | `16384` | Số tokens output tối đa |
| `cost` | ❌ | Tất cả 0 | Chi phí per million tokens: `{"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}` |
| `compat` | ❌ | `compat` của provider | Override OpenAI compatibility. Merge với provider-level `compat` khi cả hai đều set |

### Hành vi hiện tại

- `/model` và `--list-models` liệt kê theo model `id`
- Trường `name` dùng cho model matching và detail/status text

---

## 8. Overriding Built-in Providers

### Route qua Proxy

Chuyển hướng provider built-in qua proxy mà **không cần định nghĩa lại models**:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1"
    }
  }
}
```

Tất cả Anthropic models built-in vẫn khả dụng. OAuth hoặc API key auth tiếp tục hoạt động.

### Merge Custom Models vào Provider Built-in

Thêm `models` array để merge custom models:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1",
      "apiKey": "ANTHROPIC_API_KEY",
      "api": "anthropic-messages",
      "models": [...]
    }
  }
}
```

### Merge Semantics

| Tình huống | Hành vi |
|-----------|---------|
| Built-in models | Giữ nguyên |
| Custom model `id` mới | Thêm bên cạnh built-in models |
| Custom model `id` trùng built-in | **Thay thế** built-in model đó |

---

## 9. Per-model Overrides — modelOverrides

Dùng `modelOverrides` để tùy chỉnh **từng built-in model cụ thể** mà không cần thay thế toàn bộ model list:

```json
{
  "providers": {
    "openrouter": {
      "modelOverrides": {
        "anthropic/claude-sonnet-4": {
          "name": "Claude Sonnet 4 (Bedrock Route)",
          "compat": {
            "openRouterRouting": {
              "only": ["amazon-bedrock"]
            }
          }
        }
      }
    }
  }
}
```

### Các trường hỗ trợ trong modelOverrides

`name`, `reasoning`, `input`, `cost` (partial), `contextWindow`, `maxTokens`, `headers`, `compat`

### Hành vi

- Chỉ áp dụng cho built-in models của provider
- Model ID không tồn tại → bỏ qua
- Có thể kết hợp provider-level `baseUrl`/`headers` với `modelOverrides`
- Nếu `models` cũng được định nghĩa, custom models merge **sau** built-in overrides. Custom model trùng `id` sẽ thay thế built-in model đã override

---

## 10. OpenAI Compatibility — Trường `compat`

Dùng cho các providers tương thích OpenAI **không đầy đủ**:

- **Provider-level** `compat` → áp dụng mặc định cho tất cả models
- **Model-level** `compat` → override giá trị provider-level cho model đó

```json
{
  "providers": {
    "local-llm": {
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "compat": {
        "supportsUsageInStreaming": false,
        "maxTokensField": "max_tokens"
      },
      "models": [...]
    }
  }
}
```

### Bảng Tham Chiếu Compat Fields

| Trường | Mô tả |
|--------|--------|
| `supportsStore` | Provider hỗ trợ trường `store` |
| `supportsDeveloperRole` | Dùng role `developer` thay vì `system` |
| `supportsReasoningEffort` | Hỗ trợ tham số `reasoning_effort` |
| `reasoningEffortMap` | Map thinking levels của Pi sang giá trị `reasoning_effort` riêng của provider |
| `supportsUsageInStreaming` | Hỗ trợ `stream_options: { include_usage: true }` (mặc định: `true`) |
| `maxTokensField` | Dùng `max_completion_tokens` hoặc `max_tokens` |
| `requiresToolResultName` | Bao gồm `name` trong tool result messages |
| `requiresAssistantAfterToolResult` | Chèn assistant message trước user message sau tool results |
| `requiresThinkingAsText` | Chuyển thinking blocks thành plain text |
| `thinkingFormat` | Dùng `reasoning_effort`, `zai`, `qwen`, hoặc `qwen-chat-template` |
| `supportsStrictMode` | Bao gồm trường `strict` trong tool definitions |
| `openRouterRouting` | OpenRouter provider routing preferences (gửi nguyên dạng trong trường `provider` của API request) |
| `vercelGatewayRouting` | Vercel AI Gateway routing config (`only`, `order`) |

> **Ghi chú:** `qwen` dùng `enable_thinking` ở top-level. Dùng `qwen-chat-template` cho local Qwen-compatible servers cần `chat_template_kwargs.enable_thinking`.

---

## 11. OpenRouter Routing Example

Cấu hình đầy đủ với routing preferences cho OpenRouter:

```json
{
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "OPENROUTER_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "openrouter/anthropic/claude-3.5-sonnet",
          "name": "OpenRouter Claude 3.5 Sonnet",
          "compat": {
            "openRouterRouting": {
              "allow_fallbacks": true,
              "require_parameters": false,
              "data_collection": "deny",
              "zdr": true,
              "enforce_distillable_text": false,
              "order": ["anthropic", "amazon-bedrock", "google-vertex"],
              "only": ["anthropic", "amazon-bedrock"],
              "ignore": ["gmicloud", "friendli"],
              "quantizations": ["fp16", "bf16"],
              "sort": {
                "by": "price",
                "partition": "model"
              },
              "max_price": {
                "prompt": 10,
                "completion": 20
              },
              "preferred_min_throughput": {
                "p50": 100,
                "p90": 50
              },
              "preferred_max_latency": {
                "p50": 1,
                "p90": 3,
                "p99": 5
              }
            }
          }
        }
      ]
    }
  }
}
```

### Các tùy chọn routing chính

| Tùy chọn | Mô tả |
|----------|--------|
| `only` | Chỉ dùng các provider được chỉ định |
| `order` | Thứ tự ưu tiên provider |
| `ignore` | Loại trừ các provider |
| `allow_fallbacks` | Cho phép fallback nếu provider chính không khả dụng |
| `data_collection` | Chính sách thu thập dữ liệu (`"deny"`, `"allow"`) |
| `sort` | Sắp xếp theo `price` hoặc tiêu chí khác |
| `quantizations` | Chỉ dùng các quantization cụ thể (`fp16`, `bf16`,...) |

---

## 12. Vercel AI Gateway Example

Dùng Vercel AI Gateway để route requests qua nhiều providers:

```json
{
  "providers": {
    "vercel-ai-gateway": {
      "baseUrl": "https://ai-gateway.vercel.sh/v1",
      "apiKey": "AI_GATEWAY_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "moonshotai/kimi-k2.5",
          "name": "Kimi K2.5 (Fireworks via Vercel)",
          "reasoning": true,
          "input": ["text", "image"],
          "cost": { "input": 0.6, "output": 3, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 262144,
          "maxTokens": 262144,
          "compat": {
            "vercelGatewayRouting": {
              "only": ["fireworks", "novita"],
              "order": ["fireworks", "novita"]
            }
          }
        }
      ]
    }
  }
}
```

### Các trường `vercelGatewayRouting`

| Trường | Mô tả |
|--------|--------|
| `only` | Chỉ route qua các providers được chỉ định |
| `order` | Thứ tự ưu tiên khi route |
