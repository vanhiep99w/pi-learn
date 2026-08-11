# Thiết kế Pi Image Gen Extension — Codex parity core

> Trạng thái: **Đang triển khai** — Phase 0 và phần lõi Phase 1/2 đã có runtime experimental
>
> Vị trí: `packages/pi-learn-extensions/extensions/image-gen/`
>
> Tool công khai: `image_gen`
>
> Backend hiện có: ChatGPT/Codex subscription OAuth
>
> Fallback public OpenAI Images API: thiết kế đã chốt, runtime chưa triển khai

### Tiến độ implementation hiện tại

Đã có: public schema, prompt compiler + edit invariants, backend contract, JWT account claim, request builder, bounded SSE parser, subscription generate/reference-conditioned edit, variants nhỏ có bounded concurrency, input/output inspection, non-overwrite workspace-relative paths, dimension-mismatch warning/preservation, metadata sidecar, inline tool-result image, direct-command preview widget, `/image-gen doctor`, unit tests và mocked subscription tests.

Chưa có: live smoke validation, public API fallback, mask, chroma-key/native transparency, JSONL batch manifest, skill resource và A/B quality suite. Runtime hiện fail sớm cho capability chưa hỗ trợ; không thể phát sinh paid API fallback.

## 1. Tóm tắt quyết định

Extension mới sẽ port **trải nghiệm và workflow** của Codex Image Generation sang Pi, thay vì chỉ sao chép một lệnh gọi API. Mục tiêu là đạt chất lượng tương đương ở bốn lớp:

1. **Model/backend tương đương** — ưu tiên native `image_generation` với `gpt-image-2` qua Codex Responses backend.
2. **Prompt compiler tương đương** — phân loại intent, chuẩn hóa prompt, giữ invariants khi edit, không tự ý thêm nội dung.
3. **Input/output tương đương** — hỗ trợ generate, reference/edit, batch, transparency, lưu asset đúng workspace và trả ảnh inline cho model kiểm tra.
4. **Validation tương đương** — kiểm tra file, MIME, kích thước, alpha, đường dẫn, metadata và thực hiện vòng lặp đánh giá chất lượng.

Các lựa chọn đã chốt:

| Hạng mục | Quyết định |
|---|---|
| Repository | Tích hợp vào `pi-learn` |
| Phạm vi v1 | Codex parity core, chưa làm browser studio |
| Tool name | `image_gen` để tương thích skill Codex |
| Backend | Subscription mặc định + public API fallback tùy chọn |
| Auth subscription | Dùng credential `openai-codex` do Pi quản lý |
| Public API billing | Không được fallback âm thầm; cần opt-in rõ ràng |

## 2. “Tương đương chất lượng” nghĩa là gì?

Không thể yêu cầu hai lần tạo ảnh cho ra pixel giống nhau vì image generation có tính ngẫu nhiên. Trong tài liệu này, “tương đương chất lượng” nghĩa là extension không làm giảm có hệ thống các tiêu chí sau so với Codex built-in `image_gen` khi dùng cùng model, prompt, quality và size:

- Đúng chủ thể và yêu cầu chính.
- Đúng composition/framing.
- Đúng style và intended use.
- Giữ reference identity/layout ở mức backend cho phép.
- Tuân thủ edit invariants: chỉ đổi phần được yêu cầu.
- Text trong ảnh đúng hơn hoặc tương đương.
- Không tự thêm logo, watermark, nhân vật hoặc props ngoài yêu cầu.
- File đầu ra hợp lệ, đúng format, size và alpha semantics.
- Asset dùng trong project được lưu trong workspace, không chỉ nằm trong thư mục global.

Chất lượng phụ thuộc vào cả model lẫn orchestration. Chỉ gọi `gpt-image-2` là chưa đủ; prompt shaping, input roles, output policy và validation phải được triển khai đồng bộ.

## 3. Baseline tham chiếu

### 3.1 Codex Image Generation

Baseline chính là skill cài tại:

```txt
~/.codex/skills/.system/imagegen/
├── SKILL.md
├── references/
│   ├── cli.md
│   ├── image-api.md
│   ├── prompting.md
│   └── sample-prompts.md
└── scripts/
    ├── image_gen.py
    └── remove_chroma_key.py
```

Các đặc tính cần giữ:

- Built-in-first: subscription path là mặc định.
- Phân biệt `generate` và `edit`.
- Phân biệt edit target, reference image và supporting/compositing input.
- Prompt augmentation theo mức độ cụ thể của yêu cầu.
- Lặp lại invariants trong edit.
- Không downgrade model/backend âm thầm.
- Không overwrite asset nếu người dùng chưa yêu cầu.
- Project-bound asset phải nằm trong workspace.
- Transparency có workflow riêng và phải validate alpha.
- Batch với prompt riêng cho từng distinct asset.

Codex built-in tool là implementation nội bộ, không có source trong skill. Vì vậy dự án chỉ port interface/workflow quan sát được, không tuyên bố sao chép implementation nội bộ.

### 3.2 `Jon-Vii/pi-imagegen`

Repo này chứng minh Pi có thể dùng subscription auth mà không cần `OPENAI_API_KEY`:

```txt
Pi modelRegistry
  → openai-codex OAuth access token
  → POST https://chatgpt.com/backend-api/codex/responses
  → tools: [{ type: "image_generation", model: "gpt-image-2" }]
  → SSE image_generation_call
  → base64 image
```

Các ý tưởng có thể học:

- Lấy token qua model registry thay vì đọc auth file.
- Decode JWT để lấy `chatgpt_account_id`.
- Parse SSE `response.output_item.done`.
- Trả cả text và image content từ Pi tool.
- Lưu JSON metadata sidecar.

Những phần không nên copy nguyên trạng:

- Một file TypeScript lớn chứa cả backend, persistence và browser UI.
- Hard-code dispatcher model mà không có capability negotiation.
- Studio token chỉ xuất hiện trong URL nhưng không được validate ở server route.
- Batch tuần tự không có queue/concurrency policy rõ ràng.
- Không có prompt compiler đầy đủ như Codex skill.

## 4. Mục tiêu và ngoài phạm vi

### 4.1 Mục tiêu v1

- Đăng ký Pi tool `image_gen` để agent tự gọi.
- Đăng ký command namespace `/image-gen` cho thao tác trực tiếp và diagnostics.
- Generate ảnh mới từ text.
- Generate/edit dựa trên một hoặc nhiều local reference images.
- Hỗ trợ batch nhỏ với giới hạn concurrency.
- Dùng `openai-codex` OAuth mặc định.
- Có public Images API fallback được người dùng opt-in.
- Có prompt compiler port từ nguyên tắc của Codex skill.
- Lưu ảnh, metadata và trả ảnh inline.
- Hỗ trợ output project-bound và preview-only.
- Hỗ trợ transparent output qua strategy được validate.
- Có unit test, mocked integration test và live eval opt-in.

### 4.2 Ngoài phạm vi v1

- Browser studio/gallery.
- Sketch canvas.
- Exact pixel reproduction của Codex.
- Train hoặc fine-tune image model.
- Tự quản lý OAuth refresh token ngoài Pi.
- Đọc trực tiếp `~/.pi/agent/auth.json` hoặc `~/.codex/auth.json`.
- Reverse-engineer implementation nội bộ của Codex built-in tool.
- Bypass subscription limits, moderation hoặc provider policy.

## 5. Kiến trúc đề xuất

```txt
packages/pi-learn-extensions/
├── extensions/
│   └── image-gen/
│       ├── index.ts                 # Pi entrypoint: tool, commands, lifecycle
│       ├── schema.ts                # TypeBox schemas + public types
│       ├── prompt-compiler.ts       # intent, taxonomy, augmentation, invariants
│       ├── orchestrator.ts          # backend selection, batch, retry, validation
│       ├── backends/
│       │   ├── types.ts             # ImageBackend contract
│       │   ├── codex-subscription.ts
│       │   └── openai-images.ts
│       ├── codex/
│       │   ├── jwt.ts               # decode claim, không log token
│       │   ├── request.ts           # Responses request builder
│       │   └── sse.ts               # bounded SSE parser
│       ├── image/
│       │   ├── inspect.ts           # format, dimensions, alpha checks
│       │   ├── chroma-key.ts        # local alpha extraction
│       │   └── mime.ts
│       ├── storage/
│       │   ├── paths.ts             # output path policy
│       │   └── metadata.ts          # sidecars/index
│       ├── config.ts
│       └── errors.ts
├── skills/
│   └── image-gen/
│       ├── SKILL.md                 # workflow hướng dẫn agent
│       └── references/
│           ├── prompting.md
│           └── transparency.md
└── tests/
    └── image-gen/
        ├── prompt-compiler.test.ts
        ├── backend-selection.test.ts
        ├── sse.test.ts
        ├── output-paths.test.ts
        ├── transparency.test.ts
        └── fixtures/
```

Ghi chú package:

- Extension public phải nằm dưới `packages/pi-learn-extensions/`, không đặt trong `.pi/extensions/`.
- Root `package.json` đã expose toàn bộ extension directory, nên không cần thêm entrypoint riêng nếu sử dụng discovery theo thư mục.
- Nếu thêm `skills/`, cả root manifest và package-level manifest phải expose skill path.
- Source mới dùng namespace `@earendil-works/*` và `typebox` theo docs Pi hiện tại.

## 6. Public tool contract

Tool name phải là:

```txt
image_gen
```

Schema dự kiến:

```ts
type ImageGenInput = {
  prompt: string;
  mode?: "auto" | "generate" | "edit";
  useCase?: ImageUseCase;
  images?: Array<{
    path: string;
    role: "reference" | "edit_target" | "supporting";
  }>;
  maskPath?: string;
  size?: "auto" | `${number}x${number}`;
  quality?: "auto" | "low" | "medium" | "high";
  background?: "auto" | "opaque" | "transparent";
  outputFormat?: "png" | "webp" | "jpeg";
  count?: number;
  backend?: "auto" | "subscription" | "api";
  allowPaidFallback?: boolean;
  outputPath?: string;
  overwrite?: boolean;
};
```

### 6.1 Nguyên tắc schema

- `prompt` luôn bắt buộc, kể cả edit.
- `mode=auto` suy luận `edit` khi có `edit_target`, ngược lại là `generate`.
- Mỗi image phải có role rõ ràng; không đoán mọi ảnh là edit target.
- `maskPath` chỉ hợp lệ khi có đúng một `edit_target` và backend hỗ trợ mask.
- `count` mặc định 1, giới hạn nhỏ ở tool schema; batch lớn dùng command/config riêng.
- `backend=auto` không đồng nghĩa được phép dùng API billing.
- `outputPath` resolve tương đối theo `ctx.cwd`; bỏ prefix `@` nếu model truyền vào.
- `overwrite=false` mặc định.

### 6.2 Tool result

Tool trả cả text và ảnh:

```ts
{
  content: [
    { type: "text", text: "Saved to: ..." },
    { type: "image", data: base64, mimeType: "image/png" }
  ],
  details: {
    backend,
    responseModel,
    imageModel,
    prompt,
    compiledPrompt,
    revisedPrompt,
    savedPaths,
    metadataPaths,
    validation,
    batchId,
    fallbackUsed
  }
}
```

Ảnh inline cho phép model ở turn kế tiếp kiểm tra semantic quality. `details` không chứa OAuth token, API key, authorization header hoặc raw data URL của reference images.

## 7. Prompt compiler

### 7.1 Intent resolution

```txt
Có edit_target → edit
Chỉ có reference/supporting → generate-with-reference
Không có image → generate
```

Nếu input mâu thuẫn, fail sớm thay vì đoán. Ví dụ:

- Hai `edit_target` nhưng chỉ một mask.
- `mode=generate` cùng `edit_target`.
- `maskPath` nhưng không có edit target.

### 7.2 Taxonomy

Generate:

- `photorealistic-natural`
- `product-mockup`
- `ui-mockup`
- `infographic-diagram`
- `scientific-educational`
- `ads-marketing`
- `productivity-visual`
- `logo-brand`
- `illustration-story`
- `stylized-concept`
- `historical-scene`

Edit:

- `text-localization`
- `identity-preserve`
- `precise-object-edit`
- `lighting-weather`
- `background-extraction`
- `style-transfer`
- `compositing`
- `sketch-to-render`

### 7.3 Prompt structure

Compiler tạo spec ngắn, không phải essay:

```txt
Use case: <slug>
Asset type: <intended use>
Primary request: <normalized user prompt>
Input images: <Image 1 role; Image 2 role>
Scene/backdrop: <nếu cần>
Subject: <nếu cần>
Style/medium: <nếu cần>
Composition/framing: <nếu cần>
Lighting/mood: <nếu cần>
Text (verbatim): "<exact text>"
Constraints: <must keep/must avoid>
Avoid: <negative constraints>
```

### 7.4 Specificity policy

- Prompt đã chi tiết: chỉ normalize và cấu trúc lại.
- Prompt chung chung: được thêm composition, intended use và polish cues nếu giúp rõ yêu cầu.
- Không tự thêm character, prop, brand, slogan, palette hoặc story beat ngoài yêu cầu.
- Edit luôn nhắc lại: `change only X; keep Y unchanged`.
- Text phải được quote verbatim; từ khó có thể spell từng ký tự.

### 7.5 Prompt ownership

Metadata phải lưu cả:

- `userPrompt`: nguyên văn yêu cầu.
- `compiledPrompt`: prompt gửi backend.
- `revisedPrompt`: nếu backend trả về.

Điều này giúp debug chất lượng mà không cần log request chứa auth hoặc base64 references.

## 8. Backend abstraction

```ts
interface ImageBackend {
  id: "subscription" | "api";
  capabilities(): ImageBackendCapabilities;
  generate(request: CompiledImageRequest, signal?: AbortSignal): Promise<ImageResult[]>;
  edit(request: CompiledImageRequest, signal?: AbortSignal): Promise<ImageResult[]>;
}
```

Capabilities cần biểu diễn:

- Supported models.
- Generate/edit.
- Multiple reference images.
- Mask support.
- Size constraints.
- Quality values.
- Transparent output.
- Input fidelity.
- Maximum batch count.

Orchestrator phải validate theo backend đã chọn, không dùng một schema capability giả định cho mọi backend.

## 9. Subscription backend

### 9.1 Auth resolution

Dùng API chính thức của Pi runtime:

```ts
const resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
const token = resolved?.auth.apiKey;
```

Yêu cầu:

- Không đọc auth JSON trực tiếp.
- Không persist token trong config, metadata hoặc logs.
- Để Pi chịu trách nhiệm OAuth refresh và credential locking.
- Nếu auth thiếu, báo chạy `/login` và chọn ChatGPT Plus/Pro (Codex).

### 9.2 Account ID

Codex backend cần `chatgpt-account-id`. Extension decode JWT payload trong memory và đọc:

```txt
https://api.openai.com/auth.chatgpt_account_id
```

JWT decode chỉ để đọc claim, không phải verify authorization. Backend vẫn xác thực token.

### 9.3 Request

Endpoint:

```txt
POST https://chatgpt.com/backend-api/codex/responses
```

Payload lõi:

```json
{
  "model": "<dispatcher-model>",
  "store": false,
  "stream": true,
  "instructions": "Use image_generation to create exactly the requested image.",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "<compiled prompt>" },
        { "type": "input_image", "image_url": "data:image/png;base64,..." }
      ]
    }
  ],
  "tool_choice": "auto",
  "tools": [
    {
      "type": "image_generation",
      "model": "gpt-image-2",
      "quality": "high",
      "size": "1536x1024",
      "output_format": "png",
      "moderation": "auto"
    }
  ]
}
```

Quan sát runtime: private subscription endpoint đôi khi bỏ qua `size` trong image tool và trả một kích thước hợp lệ khác, ví dụ request `1024x1024` nhưng nhận `1536x1024`. Vì ảnh đã được tạo và hợp lệ, subscription path không discard asset: lưu theo kích thước thực tế, đặt `validation.dimensions=false`, ghi warning trong sidecar/tool result. MIME và alpha validation vẫn strict. Agent dùng `size=auto` khi người dùng/layout không bắt buộc kích thước cụ thể. Public API backend sau này vẫn có thể giữ strict dimension validation.

Dispatcher model selection:

1. Nếu active model thuộc `openai-codex` và capability phù hợp, dùng active model.
2. Nếu không, dùng model mặc định từ config đã được kiểm thử.
3. Không hard-code model không còn trong catalog mà không có fallback negotiation.
4. Diagnostic command phải hiển thị model được chọn nhưng không hiển thị auth.

### 9.4 Headers

Tối thiểu:

```http
Authorization: Bearer <OAuth access token>
chatgpt-account-id: <account id>
Accept: text/event-stream
Content-Type: application/json
OpenAI-Beta: responses=experimental
```

Security constraints:

- Không follow redirect sang host khác khi có authorization header.
- Chỉ gửi token tới allowlist `https://chatgpt.com`.
- Error message phải redact authorization, token-like strings và data URLs.

### 9.5 SSE parser

Parser phải:

- Hỗ trợ `\n\n` và `\r\n\r\n`.
- Hỗ trợ nhiều dòng `data:`.
- Xử lý final buffer khi stream đóng.
- Dừng khi gặp `response.output_item.done` với `image_generation_call`.
- Nhận `result` base64 và `revised_prompt` nếu có.
- Xử lý `error`, `response.failed`, abort và malformed event.
- Có giới hạn event size và total response size để tránh memory exhaustion.
- Không đưa base64 image vào error/log.

Subscription backend là integration với private/internal endpoint. Nó phải được đánh dấu `experimental` trong docs và diagnostics.

## 10. Public Images API fallback

### 10.1 Khi nào dùng

Fallback chỉ được dùng khi một trong các điều kiện sau đúng:

- Người dùng chọn `backend="api"`.
- Người dùng bật `allowPaidFallback=true` cho lần gọi hiện tại.
- Config global/project bật rõ `allowPaidFallback`.

Không fallback âm thầm từ subscription sang API vì public API có billing riêng.

### 10.2 Auth

Ưu tiên Pi auth resolution:

```ts
const resolved = await ctx.modelRegistry.getProviderAuth("openai");
const apiKey = resolved?.auth.apiKey;
```

Không yêu cầu người dùng paste key vào chat. Nếu thiếu, hướng dẫn `/login openai` hoặc cấu hình `OPENAI_API_KEY` trước khi khởi động Pi.

### 10.3 Endpoints

```txt
POST https://api.openai.com/v1/images/generations
POST https://api.openai.com/v1/images/edits
```

V1 có thể dùng fetch trực tiếp để tránh dependency SDK. Backend phải hỗ trợ:

- `gpt-image-2` mặc định.
- `gpt-image-1.5` cho true native transparency nếu được người dùng chọn/xác nhận.
- Flexible size validation cho `gpt-image-2`.
- Mask và multiple image edit khi endpoint/model hỗ trợ.
- Retry có giới hạn cho 429/5xx/network timeout.

## 11. Backend selection policy

```txt
backend=subscription
  → chỉ subscription; lỗi thì trả lỗi có hướng dẫn

backend=api
  → chỉ public API; cần openai API credential

backend=auto
  → thử subscription nếu có capability và auth
  → nếu subscription lỗi transient: retry có giới hạn
  → nếu vẫn lỗi: chỉ dùng API khi allowPaidFallback=true
  → nếu không được phép: trả lỗi và đề nghị opt-in
```

Không fallback khi:

- Request bị moderation từ chối.
- Input/schema không hợp lệ.
- Người dùng yêu cầu capability mà backend khác cũng không hỗ trợ.
- Abort signal được kích hoạt.

Metadata phải ghi `fallbackUsed` và lý do không chứa secret.

## 12. Generate, reference và edit semantics

### 12.1 Generate mới

- Không input images.
- Compiler tạo prompt theo use case.
- Distinct assets phải là distinct requests/prompts.
- `count` chỉ tạo variants của cùng prompt.

### 12.2 Reference generation

- Mỗi file được validate tồn tại, readable, MIME hợp lệ và dưới giới hạn size.
- Thứ tự images được giữ ổn định.
- Prompt liệt kê `Image 1`, `Image 2` và role tương ứng.
- Không hứa exact identity nếu model/backend không cung cấp guarantee.

### 12.3 Edit

- Phải có ít nhất một `edit_target`.
- Invariants được compiler lặp lại ở cuối prompt.
- Lưu non-destructive mặc định.
- Mask chỉ áp dụng cho backend/model hỗ trợ và target đầu tiên.
- Nếu backend subscription chỉ hỗ trợ reference-conditioned generation, metadata phải ghi strategy đó; không mô tả là pixel-precise inpainting.

## 13. Transparency strategy

### 13.1 Mặc định

Để bám Codex workflow, transparent request đi theo thứ tự:

1. Với subject đơn giản, generate trên chroma-key phẳng.
2. Chọn key color không xuất hiện trong subject.
3. Remove key locally.
4. Validate alpha channel, transparent corners, subject coverage và color fringe.
5. Retry local extraction một lần với edge contraction nếu cần.

Prompt chroma-key bắt buộc cấm:

- Shadow và reflection.
- Gradient/texture trên background.
- Floor plane.
- Key color trong subject.
- Watermark và text ngoài yêu cầu.

### 13.2 Local processing

Đề xuất dùng `sharp` cho decode/raw pixel/encode thay vì phụ thuộc Python runtime. Algorithm:

- Sample border để xác định key color.
- Tính color distance cho từng pixel.
- Hai threshold: fully transparent và fully opaque.
- Interpolate alpha trong vùng soft matte.
- Despill key color ở antialiased edges.
- Optional edge contract một pixel.
- Encode PNG/WebP với alpha.

Nếu dùng hoặc chuyển thể code từ Codex `remove_chroma_key.py`, phải tuân thủ Apache-2.0, giữ attribution và thêm third-party notice. Phương án ưu tiên là viết implementation TypeScript độc lập dựa trên thuật toán chung và test bằng fixtures tự tạo.

### 13.3 True native transparency

Dùng public API `gpt-image-1.5` chỉ khi:

- Subject có hair, fur, feathers, smoke, glass, liquid, translucent/reflective material hoặc soft shadow; hoặc
- Chroma-key validation thất bại; hoặc
- Người dùng yêu cầu true/native transparency.

Vì đây có thể chuyển sang paid API fallback và model khác, cần opt-in rõ ràng.

## 14. Output policy

### 14.1 Mặc định theo workspace

Nếu không truyền `outputPath`, ảnh được lưu ngay tại workspace root hiện tại:

```txt
<ctx.cwd>/<semantic-name>-<timestamp>-<image-id>.<ext>
```

Agent phải inspect cấu trúc project trước khi gọi tool. Nếu tìm thấy convention/folder ảnh phù hợp như `public/images`, `assets/images`, `src/assets` hoặc folder tương đương, agent nên truyền `outputPath` project-relative theo convention đó. Nếu không có folder phù hợp và người dùng không chỉ định, fallback là `ctx.cwd`.

Command `/image-gen generate` chạy trực tiếp, không có agent chọn folder, nên cũng fallback về `ctx.cwd`.

### 14.2 Output path được chỉ định

Nếu `outputPath` được cung cấp:

- Resolve theo `ctx.cwd`.
- Tạo parent directory khi hợp lệ.
- Không overwrite nếu `overwrite !== true`.
- Nếu path là directory, tạo semantic/versioned filename.
- Dùng `withFileMutationQueue()` cho toàn bộ mutation window.

### 14.3 Metadata

Mỗi ảnh có sidecar:

```json
{
  "schemaVersion": 1,
  "createdAt": "...",
  "userPrompt": "...",
  "compiledPrompt": "...",
  "revisedPrompt": "...",
  "mode": "generate",
  "useCase": "product-mockup",
  "backend": "subscription",
  "responseModel": "...",
  "imageModel": "gpt-image-2",
  "size": "1536x1024",
  "quality": "high",
  "background": "opaque",
  "outputFormat": "png",
  "savedPath": "...",
  "referencePaths": ["..."],
  "validation": {
    "mime": true,
    "dimensions": false,
    "alpha": "not-requested"
  },
  "warnings": ["Image 1: Backend returned 1536x1024, requested 1024x1024; saved using actual dimensions."]
}
```

Không lưu:

- OAuth token/API key.
- Authorization headers.
- Full JWT claims.
- Base64 images.
- Raw response headers có thể chứa sensitive identifiers.

## 15. Batch và concurrency

V1 hỗ trợ hai kiểu:

- `count > 1`: variants của một prompt.
- Command batch: nhiều prompt/jobs riêng biệt.

Policy:

- Subscription concurrency mặc định 2, configurable 1–3.
- API concurrency mặc định 3, configurable 1–5.
- Batch maximum mặc định 20 jobs ở command layer.
- Mỗi job có AbortSignal liên kết với batch controller.
- Retry riêng từng job; không regenerate job đã thành công.
- Kết quả batch ghi manifest và danh sách failures.
- Không dùng `Promise.all` không giới hạn.

## 16. Commands và diagnostics

Namespace dự kiến:

```txt
/image-gen generate <prompt>
/image-gen hide
/image-gen batch <jsonl-path>
/image-gen info [latest|path]
/image-gen list [count]
/image-gen doctor
/image-gen config
```

`/image-gen doctor` chỉ hiển thị thông tin không nhạy cảm:

- Extension version.
- Subscription auth available: yes/no.
- Public API auth available: yes/no.
- Selected dispatcher/image model.
- Backend capability matrix.
- Output directory writable: yes/no.
- Local image processor available: yes/no.

UI rules:

- Tool result render ảnh inline khi `showImages` bật.
- `/image-gen generate` trong TUI đặt preview widget phía trên editor; `/image-gen hide` đóng preview.
- Terminal phải hỗ trợ inline image (Kitty/Ghostty/WezTerm/Warp); nếu không, `Image` component hiện fallback placeholder/path.
- Guard dialog/notify/widget bằng `ctx.hasUI` và TUI-only image widget bằng `ctx.mode === "tui"`.
- Print/JSON mode phải có text result thay vì silent return.
- Clear preview widget trong `session_shutdown`; V1 không khởi động server, timer hoặc watcher nền.
- Nếu sau này thêm resource dài hạn, cleanup trong `session_shutdown`.

## 17. Config

Global config dự kiến:

```txt
~/.pi/agent/image-gen/config.json
```

Project config dự kiến:

```txt
.pi/image-gen.json
```

Chỉ đọc project config khi `ctx.isProjectTrusted()` trả true.

Ví dụ:

```json
{
  "defaultBackend": "auto",
  "allowPaidFallback": false,
  "defaultQuality": "high",
  "defaultFormat": "png",
  "subscriptionConcurrency": 2,
  "apiConcurrency": 3,
  "defaultOutputDirectory": ".",
  "dispatcherModel": "auto"
}
```

Config không chứa credentials.

Resolution order:

```txt
tool arguments
  > project config
  > global config
  > built-in defaults
```

## 18. Error model và retry

Các error class dự kiến:

- `ImageGenAuthError`
- `ImageGenCapabilityError`
- `ImageGenInputError`
- `ImageGenModerationError`
- `ImageGenRateLimitError`
- `ImageGenBackendError`
- `ImageGenOutputError`
- `ImageGenValidationError`

Retry:

- Retry 429, selected 5xx và transient network failure.
- Tôn trọng `Retry-After` nếu có.
- Exponential backoff có jitter.
- Mặc định tối đa 3 attempts.
- Không retry input, moderation, auth 401/403 hoặc local validation lỗi do config.
- Abort dừng ngay và không fallback.

Error trả về model phải có:

- Backend đã thử.
- Bước thất bại.
- Hướng xử lý cụ thể.
- Không chứa token, key, data URL hoặc raw HTML response dài.

## 19. Security và privacy

### 19.1 Trust boundaries

- Extension chạy full user permissions.
- Subscription backend nhận OAuth access token trong memory.
- Public backend nhận API key trong memory.
- Reference images có thể chứa dữ liệu riêng tư và được gửi tới selected backend.

### 19.2 Bắt buộc

- Không đọc auth files trực tiếp.
- Không log request body khi có base64 input images.
- Không log complete response body khi backend lỗi.
- Host allowlist cho request có credentials.
- Redirect cross-host bị tắt.
- Giới hạn số lượng và kích thước input images.
- Canonicalize output path và dùng mutation queue.
- Không overwrite mặc định.
- Không load project config ở untrusted project.
- Metadata và diagnostics không chứa secrets.
- Thêm tests cho redaction của token-like errors.

### 19.3 Private endpoint warning

Subscription backend dùng endpoint nội bộ của ChatGPT/Codex, không phải public OpenAI Images API. Điều này mang ba rủi ro:

- Backend/schema có thể thay đổi không báo trước.
- Model/tool IDs có thể thay đổi.
- Compatibility không được đảm bảo như public API.

Do đó backend phải nằm sau abstraction, có diagnostics và không trộn logic với tool/UI.

## 20. Testing strategy

### 20.1 Unit tests

Không cần auth/network:

- Intent inference.
- Prompt augmentation và specificity policy.
- Edit invariants.
- Image role ordering.
- Capability validation.
- Backend selection và paid fallback gate.
- JWT malformed/missing claim handling bằng fake tokens.
- SSE chunk boundaries, CRLF, multiline data, malformed events, error events.
- Output path normalization, leading `@`, overwrite policy.
- Metadata redaction.
- Chroma-key alpha, matte và despill bằng fixture tự tạo.

### 20.2 Mocked integration tests

- Mock subscription SSE success/failure/rate limit.
- Mock public generation và edit responses.
- Retry và `Retry-After`.
- Abort giữa stream.
- Batch partial success.
- File mutation và sidecar consistency.
- Inline Pi image result shape.

Fixtures không chứa live token hoặc ảnh riêng tư.

### 20.3 Live smoke tests

Chỉ chạy thủ công/opt-in:

```txt
PI_IMAGE_GEN_LIVE_SUBSCRIPTION=1
PI_IMAGE_GEN_LIVE_API=1
```

Không chạy live generation mặc định trong CI vì có quota/cost.

Smoke matrix:

1. Square draft.
2. Landscape final.
3. Exact text poster.
4. Product reference.
5. Background-only edit.
6. Two-image compositing.
7. Simple transparent cutout.
8. Complex transparency fallback.
9. Batch partial cancellation.
10. Project output non-overwrite.

## 21. Quality evaluation plan

### 21.1 A/B protocol

Với mỗi golden prompt:

1. Chạy Codex built-in `image_gen` ba lần.
2. Chạy Pi `image_gen` ba lần.
3. Giữ cùng size, quality, format và reference inputs.
4. Ẩn nguồn ảnh khi chấm.
5. Human reviewer và vision-capable judge chấm độc lập.

Rubric 1–5:

- Prompt adherence.
- Composition.
- Style/medium.
- Text accuracy.
- Reference fidelity.
- Edit invariant preservation.
- Artifact cleanliness.
- Intended-use readiness.

### 21.2 Acceptance threshold

V1 đạt parity khi:

- Mean score của Pi không thấp hơn Codex quá `0.3/5` trên toàn suite.
- Không category nào thấp hơn quá `0.5/5`.
- Technical validation pass rate ít nhất 95%.
- Không có secret trong logs/metadata.
- Project output policy pass 100% deterministic tests.
- Edit invariant failure không cao hơn baseline có ý nghĩa qua sample đã chọn.

Nếu model/backend stochastic variance quá lớn, tăng sample size trước khi kết luận regression.

### 21.3 Golden prompt groups

- Photorealistic natural scene.
- Product hero có negative space.
- Poster có exact text.
- UI mockup.
- Infographic labels.
- Identity/reference preservation.
- Precise object replacement.
- Lighting/weather-only edit.
- Compositing hai ảnh.
- Sketch-to-render.
- Simple opaque transparent cutout.
- Hair/glass complex transparency.

Golden inputs phải là assets được phép commit hoặc generated fixtures; không dùng ảnh cá nhân/private.

## 22. Observability

Metadata/log events cần đủ để debug nhưng không chứa secrets:

```txt
request_started
backend_selected
request_attempt
stream_connected
image_received
postprocess_started
validation_completed
file_saved
request_failed
```

Mỗi event có:

- Correlation ID.
- Backend.
- Model.
- Duration.
- Retry count.
- Output byte size.
- Error category đã redact.

Không emit prompt đầy đủ mặc định vào console. Prompt chỉ nằm trong local sidecar khi người dùng tạo ảnh và có thể tắt bằng config sau này.

## 23. Licensing và provenance

- `pi-learn` dùng MIT.
- Codex imagegen skill cài local có `LICENSE.txt` Apache-2.0.
- `Jon-Vii/pi-imagegen` package khai báo MIT.

Implementation nên được viết mới dựa trên behavior/contracts đã nghiên cứu. Nếu copy/chuyển thể source hoặc text đáng kể:

- Giữ copyright/license notice tương ứng.
- Thêm `THIRD_PARTY_NOTICES.md`.
- Đánh dấu file đã được thay đổi nếu Apache-2.0 yêu cầu.
- Không copy implementation nội bộ không được phát hành của Codex.

## 24. Rollout plan

### Phase 0 — Contracts và fixtures

- Chốt schema/tool result.
- Tạo backend contract.
- Tạo golden prompt rubric và non-secret fixtures.
- Viết SSE/output-path tests trước.

### Phase 1 — Subscription generate

- Auth resolution qua Pi.
- JWT account ID.
- Request builder và SSE parser.
- Generate một ảnh.
- Save + inline result + metadata.

### Phase 2 — Prompt parity và references

- Prompt compiler/taxonomy.
- Multi-reference roles.
- Edit semantics và invariants.
- Skill resource `image-gen`.

### Phase 3 — Batch và transparency

- Bounded concurrency.
- Batch manifest.
- Chroma-key processor và alpha validation.

### Phase 4 — Public API fallback

- Explicit paid fallback gate.
- Generate/edit/mask.
- Native transparency với model phù hợp.

### Phase 5 — Quality eval và hardening

- A/B golden suite.
- Retry/redaction/security tests.
- Docs, package manifests và manual `/reload` verification.

Browser studio chỉ được xem xét sau khi parity core ổn định.

## 25. Definition of done cho v1

- [ ] Tool `image_gen` được model gọi tự nhiên.
- [ ] Subscription backend hoạt động với `/login openai-codex`.
- [ ] Không cần `OPENAI_API_KEY` cho default path.
- [ ] Paid API fallback không bao giờ xảy ra nếu chưa opt-in.
- [ ] Generate/reference/edit core hoạt động.
- [ ] Prompt compiler giữ specificity và invariants.
- [ ] Batch có concurrency bound, cancel và partial result.
- [ ] Transparency strategy có alpha validation.
- [ ] Asset project-bound được lưu trong workspace.
- [ ] Non-overwrite là mặc định.
- [ ] Tool trả inline image và metadata path.
- [ ] Unit/mocked integration tests pass.
- [ ] Live smoke tests subscription pass thủ công.
- [ ] Quality A/B đạt acceptance threshold.
- [ ] Không log hoặc persist credentials.
- [ ] README/package docs và manifests phản ánh đúng extension thực tế.
- [ ] `/reload` và print/JSON mode được kiểm tra.

## 26. Các quyết định cần xác nhận trong lúc triển khai

Các lựa chọn lớn đã chốt. Những chi tiết sau nên được quyết định bằng tests/capability probing thay vì đoán:

1. Dispatcher model mặc định nào đang ổn định trên catalog `openai-codex`.
2. Subscription backend có thực sự hỗ trợ native `background=transparent` với `gpt-image-2` hay phải luôn chroma-key.
3. Số reference images tối đa thực tế của private backend.
4. Size nào private backend chấp nhận ngoài ba kích thước phổ biến.
5. `sharp` có được chấp nhận như runtime dependency bắt buộc hay local transparency sẽ là optional capability.
6. Test runner cho TypeScript extension tests: Node + strip types, `tsx`, hoặc Bun.

Mọi capability chưa được kiểm chứng phải fail rõ ràng hoặc được đánh dấu experimental; không nên quảng cáo như guarantee.

## 27. Tài liệu nguồn

- Pi extensions: <https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md>
- Pi packages: <https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md>
- Pi providers/auth: <https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/providers.md>
- Codex imagegen skill cài local: `~/.codex/skills/.system/imagegen/SKILL.md`
- Codex imagegen references/scripts cài local: `~/.codex/skills/.system/imagegen/`
- Pi imagegen reference implementation: <https://github.com/Jon-Vii/pi-imagegen>
- Target package: `packages/pi-learn-extensions/`
