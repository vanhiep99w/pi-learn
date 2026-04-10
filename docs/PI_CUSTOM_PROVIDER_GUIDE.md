# 🔗 Pi Custom Providers — Hướng Dẫn Chi Tiết

> Tham khảo chính thức từ [custom-provider.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)  
> Pi có thể tự tạo custom providers — hãy nhờ nó build cho bạn!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Quick Reference](#2-quick-reference)
- [3. Override Existing Provider](#3-override-existing-provider)
- [4. Register New Provider](#4-register-new-provider)
  - [4.1 API Types](#41-api-types)
  - [4.2 OpenAI Compatibility (`compat`)](#42-openai-compatibility-compat)
  - [4.3 Auth Header](#43-auth-header)
- [5. Unregister Provider](#5-unregister-provider)
- [6. OAuth Support](#6-oauth-support)
  - [6.1 Full OAuth Example](#61-full-oauth-example)
  - [6.2 OAuthLoginCallbacks](#62-oauthlogincallbacks)
  - [6.3 OAuthCredentials](#63-oauthcredentials)
- [7. Custom Streaming API](#7-custom-streaming-api)
  - [7.1 Stream Pattern](#71-stream-pattern)
  - [7.2 Event Types](#72-event-types)
  - [7.3 Content Blocks](#73-content-blocks)
  - [7.4 Tool Calls](#74-tool-calls)
  - [7.5 Usage và Cost](#75-usage-và-cost)
  - [7.6 Đăng Ký Stream Function](#76-đăng-ký-stream-function)
- [8. Testing](#8-testing)
- [9. Config Reference — `ProviderConfig`](#9-config-reference--providerconfig)
- [10. Model Definition Reference — `ProviderModelConfig`](#10-model-definition-reference--providermodelconfig)
- [11. Extension Mẫu](#11-extension-mẫu)

---

## 1. Tổng Quan

Extensions có thể đăng ký custom model providers qua `pi.registerProvider()`. Tính năng này cho phép:

| Khả năng | Mô tả |
|----------|-------|
| **Proxies** | Route requests qua corporate proxy hoặc API gateway |
| **Custom endpoints** | Dùng self-hosted hoặc private model deployments |
| **OAuth/SSO** | Thêm authentication flows cho enterprise providers |
| **Custom APIs** | Implement streaming cho non-standard LLM APIs |

---

## 2. Quick Reference

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Override baseUrl cho provider có sẵn
  pi.registerProvider("anthropic", {
    baseUrl: "https://proxy.example.com"
  });

  // Đăng ký provider mới với models
  pi.registerProvider("my-provider", {
    baseUrl: "https://api.example.com",
    apiKey: "MY_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "my-model",
        name: "My Model",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      }
    ]
  });
}
```

---

## 3. Override Existing Provider

Use case đơn giản nhất: redirect provider có sẵn qua proxy.

```typescript
// Tất cả Anthropic requests đi qua proxy
pi.registerProvider("anthropic", {
  baseUrl: "https://proxy.example.com"
});

// Thêm custom headers cho OpenAI requests
pi.registerProvider("openai", {
  headers: {
    "X-Custom-Header": "value"
  }
});

// Cả baseUrl lẫn headers
pi.registerProvider("google", {
  baseUrl: "https://ai-gateway.corp.com/google",
  headers: {
    "X-Corp-Auth": "CORP_AUTH_TOKEN"  // env var hoặc literal
  }
});
```

> **Lưu ý:** Khi chỉ có `baseUrl` và/hoặc `headers` (không có `models`), tất cả models hiện có của provider đó được **giữ nguyên** với endpoint mới.

---

## 4. Register New Provider

Để thêm provider hoàn toàn mới, cần chỉ định `models` cùng các config bắt buộc:

```typescript
pi.registerProvider("my-llm", {
  baseUrl: "https://api.my-llm.com/v1",
  apiKey: "MY_LLM_API_KEY",         // tên env var hoặc giá trị literal
  api: "openai-completions",        // API type cho streaming
  models: [
    {
      id: "my-llm-large",
      name: "My LLM Large",
      reasoning: true,              // hỗ trợ extended thinking
      input: ["text", "image"],
      cost: {
        input: 3.0,                 // $/triệu tokens
        output: 15.0,
        cacheRead: 0.3,
        cacheWrite: 3.75
      },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});
```

> **Quan trọng:** Khi có `models`, nó **thay thế toàn bộ** models hiện có của provider đó.

### 4.1 API Types

Field `api` quyết định streaming implementation nào được dùng:

| API | Dùng cho |
|-----|----------|
| `anthropic-messages` | Anthropic Claude API và compatibles |
| `openai-completions` | OpenAI Chat Completions API và compatibles |
| `openai-responses` | OpenAI Responses API |
| `azure-openai-responses` | Azure OpenAI Responses API |
| `openai-codex-responses` | OpenAI Codex Responses API |
| `mistral-conversations` | Mistral SDK Conversations/Chat streaming |
| `google-generative-ai` | Google Generative AI API |
| `google-gemini-cli` | Google Cloud Code Assist API |
| `google-vertex` | Google Vertex AI API |
| `bedrock-converse-stream` | Amazon Bedrock Converse API |

Hầu hết OpenAI-compatible providers dùng `openai-completions`. Dùng `compat` để xử lý quirks (xem mục 4.2).

> **Migration note:** Mistral đã chuyển từ `openai-completions` sang `mistral-conversations`.
> Dùng `mistral-conversations` cho native Mistral models.
> Nếu cố ý route Mistral-compatible endpoints qua `openai-completions`, hãy set `compat` flags tương ứng.

### 4.2 OpenAI Compatibility (`compat`)

Cho providers OpenAI-compatible nhưng có khác biệt nhỏ:

```typescript
models: [{
  id: "custom-model",
  // ...
  compat: {
    supportsDeveloperRole: false,      // dùng "system" thay vì "developer"
    supportsReasoningEffort: true,
    reasoningEffortMap: {              // map pi-ai levels → provider values
      minimal: "default",
      low: "default",
      medium: "default",
      high: "default",
      xhigh: "default"
    },
    maxTokensField: "max_tokens",      // thay vì "max_completion_tokens"
    requiresToolResultName: true,      // tool results cần field name
    thinkingFormat: "qwen"             // top-level enable_thinking: true
  }
}]
```

**Giải thích các compat flags:**

| Flag | Mặc định | Mô tả |
|------|----------|-------|
| `supportsDeveloperRole` | `true` | `false` → dùng role `"system"` thay `"developer"` |
| `supportsReasoningEffort` | `false` | `true` → gửi reasoning effort level cho model |
| `reasoningEffortMap` | — | Map pi-ai levels (`minimal`→`xhigh`) sang giá trị của provider |
| `supportsStore` | — | Hỗ trợ `store` parameter |
| `supportsUsageInStreaming` | — | Trả usage data trong stream chunks |
| `maxTokensField` | `"max_completion_tokens"` | Field name cho max output tokens |
| `requiresToolResultName` | `false` | Tool result messages cần kèm `name` |
| `requiresAssistantAfterToolResult` | `false` | Cần assistant message sau tool result |
| `requiresThinkingAsText` | `false` | Thinking content gửi dạng text |
| `thinkingFormat` | — | Format thinking: `"openai"`, `"zai"`, `"qwen"`, `"qwen-chat-template"` |

> **`qwen` vs `qwen-chat-template`:**  
> - `qwen` — cho DashScope-style, top-level `enable_thinking: true`  
> - `qwen-chat-template` — cho local Qwen-compatible servers đọc `chat_template_kwargs.enable_thinking`

### 4.3 Auth Header

Nếu provider cần `Authorization: Bearer <key>` nhưng không dùng standard API, set `authHeader: true`:

```typescript
pi.registerProvider("custom-api", {
  baseUrl: "https://api.example.com",
  apiKey: "MY_API_KEY",
  authHeader: true,         // thêm Authorization: Bearer header
  api: "openai-completions",
  models: [...]
});
```

---

## 5. Unregister Provider

Dùng `pi.unregisterProvider(name)` để xóa provider đã đăng ký:

```typescript
// Đăng ký
pi.registerProvider("my-llm", {
  baseUrl: "https://api.my-llm.com/v1",
  apiKey: "MY_LLM_API_KEY",
  api: "openai-completions",
  models: [
    {
      id: "my-llm-large",
      name: "My LLM Large",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});

// Xóa provider
pi.unregisterProvider("my-llm");
```

**Unregister sẽ xóa:**
- Dynamic models của provider
- API key fallback
- OAuth provider registration
- Custom stream handler registrations

> **Restore:** Nếu provider built-in bị override, unregister sẽ **khôi phục** behavior gốc.  
> **Hot-reload:** Calls sau initial load phase được áp dụng ngay lập tức, không cần `/reload`.

---

## 6. OAuth Support

Thêm OAuth/SSO authentication tích hợp với lệnh `/login`.

### 6.1 Full OAuth Example

```typescript
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";

pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",

    // Bước 1: Login — xác thực người dùng
    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      // Option 1: Browser-based OAuth
      callbacks.onAuth({ url: "https://sso.corp.com/authorize?..." });

      // Option 2: Device code flow
      callbacks.onDeviceCode({
        userCode: "ABCD-1234",
        verificationUri: "https://sso.corp.com/device"
      });

      // Option 3: Prompt nhập token/code
      const code = await callbacks.onPrompt({ message: "Enter SSO code:" });

      // Exchange code lấy tokens (implementation của bạn)
      const tokens = await exchangeCodeForTokens(code);

      return {
        refresh: tokens.refreshToken,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    // Bước 2: Refresh — gia hạn token hết hạn
    async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      const tokens = await refreshAccessToken(credentials.refresh);
      return {
        refresh: tokens.refreshToken ?? credentials.refresh,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    // Bước 3: Lấy API key từ credentials
    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    },

    // Optional: Modify models theo subscription/region
    modifyModels(models, credentials) {
      const region = decodeRegionFromToken(credentials.access);
      return models.map(m => ({
        ...m,
        baseUrl: `https://${region}.ai.corp.com/v1`
      }));
    }
  }
});
```

Sau khi đăng ký, user xác thực bằng lệnh `/login corporate-ai`.

### 6.2 OAuthLoginCallbacks

Object `callbacks` cung cấp 3 cách xác thực:

```typescript
interface OAuthLoginCallbacks {
  // Mở URL trong browser (cho OAuth redirects)
  onAuth(params: { url: string }): void;

  // Hiện device code (cho device authorization flow)
  onDeviceCode(params: { userCode: string; verificationUri: string }): void;

  // Prompt user nhập input (cho manual token entry)
  onPrompt(params: { message: string }): Promise<string>;
}
```

| Method | Khi nào dùng |
|--------|-------------|
| `onAuth` | OAuth redirect flow — mở browser tới authorization URL |
| `onDeviceCode` | Device flow — user nhập code trên trang web khác |
| `onPrompt` | Manual — user paste token/code vào terminal |

### 6.3 OAuthCredentials

Credentials được lưu persistent trong `~/.pi/agent/auth.json`:

```typescript
interface OAuthCredentials {
  refresh: string;   // Refresh token (cho refreshToken())
  access: string;    // Access token (trả về bởi getApiKey())
  expires: number;   // Thời điểm hết hạn (milliseconds since epoch)
}
```

---

## 7. Custom Streaming API

Cho providers có API không chuẩn, implement `streamSimple`.

**Tham khảo implementations có sẵn trước khi viết:**

| File | API |
|------|-----|
| [anthropic.ts](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/providers/anthropic.ts) | Anthropic Messages API |
| [openai-completions.ts](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/providers/openai-completions.ts) | OpenAI Chat Completions |
| [openai-responses.ts](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/providers/openai-responses.ts) | OpenAI Responses API |
| [mistral.ts](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/providers/mistral.ts) | Mistral Conversations API |
| [google.ts](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/providers/google.ts) | Google Generative AI |
| [amazon-bedrock.ts](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/providers/amazon-bedrock.ts) | AWS Bedrock |

### 7.1 Stream Pattern

Tất cả providers tuân theo cùng một pattern:

```typescript
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  calculateCost,
  createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";

function streamMyProvider(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    // Khởi tạo output message
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      // 1. Push start event
      stream.push({ type: "start", partial: output });

      // 2. Gọi API, xử lý response...
      //    Push content events khi data đến...

      // 3. Push done event
      stream.push({
        type: "done",
        reason: output.stopReason as "stop" | "length" | "toolUse",
        message: output
      });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
```

### 7.2 Event Types

Push events qua `stream.push()` theo thứ tự:

**1. Start event:**

```
{ type: "start", partial: output }
```

**2. Content events** (lặp lại, track `contentIndex` cho mỗi block):

| Event | Mô tả |
|-------|-------|
| `text_start` | Text block bắt đầu |
| `text_delta` | Chunk text mới |
| `text_end` | Text block kết thúc |
| `thinking_start` | Thinking bắt đầu |
| `thinking_delta` | Chunk thinking mới |
| `thinking_end` | Thinking kết thúc |
| `toolcall_start` | Tool call bắt đầu |
| `toolcall_delta` | Chunk JSON arguments |
| `toolcall_end` | Tool call kết thúc |

**3. End event:**

```
{ type: "done", reason, message }    // thành công
{ type: "error", reason, error }     // lỗi
```

> **`partial` field:** Mỗi event chứa `partial` là trạng thái hiện tại của `AssistantMessage`. Cập nhật `output.content` khi nhận data, rồi truyền `output` vào `partial`.

### 7.3 Content Blocks

Thêm content blocks vào `output.content` khi data đến:

```typescript
// Tạo text block
output.content.push({ type: "text", text: "" });
stream.push({
  type: "text_start",
  contentIndex: output.content.length - 1,
  partial: output
});

// Khi nhận text mới
const block = output.content[contentIndex];
if (block.type === "text") {
  block.text += delta;
  stream.push({ type: "text_delta", contentIndex, delta, partial: output });
}

// Khi block hoàn thành
stream.push({
  type: "text_end",
  contentIndex,
  content: block.text,
  partial: output
});
```

### 7.4 Tool Calls

Tool calls cần tích lũy JSON rồi parse:

```typescript
// Bắt đầu tool call
output.content.push({
  type: "toolCall",
  id: toolCallId,
  name: toolName,
  arguments: {}
});
stream.push({
  type: "toolcall_start",
  contentIndex: output.content.length - 1,
  partial: output
});

// Tích lũy JSON arguments
let partialJson = "";
partialJson += jsonDelta;
try {
  block.arguments = JSON.parse(partialJson);
} catch {}
stream.push({
  type: "toolcall_delta",
  contentIndex,
  delta: jsonDelta,
  partial: output
});

// Hoàn thành tool call
stream.push({
  type: "toolcall_end",
  contentIndex,
  toolCall: { type: "toolCall", id, name, arguments: block.arguments },
  partial: output
});
```

### 7.5 Usage và Cost

Cập nhật usage từ API response và tính cost:

```typescript
output.usage.input = response.usage.input_tokens;
output.usage.output = response.usage.output_tokens;
output.usage.cacheRead = response.usage.cache_read_tokens ?? 0;
output.usage.cacheWrite = response.usage.cache_write_tokens ?? 0;
output.usage.totalTokens = output.usage.input + output.usage.output +
                           output.usage.cacheRead + output.usage.cacheWrite;

// Tính chi phí dựa trên model pricing
calculateCost(model, output.usage);
```

### 7.6 Đăng Ký Stream Function

```typescript
pi.registerProvider("my-provider", {
  baseUrl: "https://api.example.com",
  apiKey: "MY_API_KEY",
  api: "my-custom-api",
  models: [...],
  streamSimple: streamMyProvider
});
```

---

## 8. Testing

Test provider bằng cùng test suites dùng cho built-in providers. Copy và adapt từ [`packages/ai/test/`](https://github.com/badlogic/pi-mono/tree/main/packages/ai/test):

| Test File | Mục đích |
|-----------|----------|
| `stream.test.ts` | Streaming cơ bản, text output |
| `tokens.test.ts` | Token counting và usage |
| `abort.test.ts` | AbortSignal handling |
| `empty.test.ts` | Empty/minimal responses |
| `context-overflow.test.ts` | Context window limits |
| `image-limits.test.ts` | Image input handling |
| `unicode-surrogate.test.ts` | Unicode edge cases |
| `tool-call-without-result.test.ts` | Tool call edge cases |
| `image-tool-result.test.ts` | Images trong tool results |
| `total-tokens.test.ts` | Total token calculation |
| `cross-provider-handoff.test.ts` | Context handoff giữa providers |

Chạy tests với provider/model pairs để verify compatibility.

---

## 9. Config Reference — `ProviderConfig`

```typescript
interface ProviderConfig {
  /** URL endpoint API. Bắt buộc khi định nghĩa models. */
  baseUrl?: string;

  /** API key hoặc tên env var. Bắt buộc khi có models (trừ khi dùng oauth). */
  apiKey?: string;

  /** API type cho streaming. Bắt buộc ở provider hoặc model level khi có models. */
  api?: Api;

  /** Custom streaming implementation cho non-standard APIs. */
  streamSimple?: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;

  /** Custom headers kèm theo requests. Values có thể là tên env var. */
  headers?: Record<string, string>;

  /** Nếu true, thêm Authorization: Bearer header với resolved API key. */
  authHeader?: boolean;

  /** Models cần đăng ký. Nếu có, thay thế toàn bộ models hiện có. */
  models?: ProviderModelConfig[];

  /** OAuth provider cho /login support. */
  oauth?: {
    name: string;
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
    refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
    getApiKey(credentials: OAuthCredentials): string;
    modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[];
  };
}
```

---

## 10. Model Definition Reference — `ProviderModelConfig`

```typescript
interface ProviderModelConfig {
  /** Model ID (vd: "claude-sonnet-4-20250514"). */
  id: string;

  /** Tên hiển thị (vd: "Claude 4 Sonnet"). */
  name: string;

  /** Override API type cho model cụ thể. */
  api?: Api;

  /** Model có hỗ trợ extended thinking không. */
  reasoning: boolean;

  /** Loại input hỗ trợ. */
  input: ("text" | "image")[];

  /** Chi phí trên triệu tokens (cho usage tracking). */
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };

  /** Kích thước context window tối đa (tokens). */
  contextWindow: number;

  /** Số output tokens tối đa. */
  maxTokens: number;

  /** Custom headers riêng cho model này. */
  headers?: Record<string, string>;

  /** OpenAI compatibility settings cho openai-completions API. */
  compat?: {
    supportsStore?: boolean;
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    reasoningEffortMap?: Partial<Record<
      "minimal" | "low" | "medium" | "high" | "xhigh", string
    >>;
    supportsUsageInStreaming?: boolean;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    requiresToolResultName?: boolean;
    requiresAssistantAfterToolResult?: boolean;
    requiresThinkingAsText?: boolean;
    thinkingFormat?: "openai" | "zai" | "qwen" | "qwen-chat-template";
  };
}
```

---

## 11. Extension Mẫu

Tham khảo các provider examples hoàn chỉnh:

| Extension | Mô tả |
|-----------|-------|
| [`custom-provider-anthropic/`](https://github.com/badlogic/pi-mono/tree/main/examples/extensions/custom-provider-anthropic) | Custom Anthropic proxy |
| [`custom-provider-gitlab-duo/`](https://github.com/badlogic/pi-mono/tree/main/examples/extensions/custom-provider-gitlab-duo) | GitLab Duo integration |
| [`custom-provider-qwen-cli/`](https://github.com/badlogic/pi-mono/tree/main/examples/extensions/custom-provider-qwen-cli) | Qwen CLI provider |

---

> **Xem thêm:**  
> - [PI_EXTENSIONS_GUIDE.md](./PI_EXTENSIONS_GUIDE.md) — Hướng dẫn extensions toàn diện  
> - [Custom provider (official)](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md) — Tài liệu gốc
