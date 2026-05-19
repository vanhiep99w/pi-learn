# Pi SDK — Nhúng Pi Vào Ứng Dụng Node.js

> Tóm tắt theo `packages/coding-agent/docs/sdk.md` từ repo chính thức `earendil-works/pi`.

## 1. SDK Dùng Để Làm Gì

SDK cho phép gọi Pi trực tiếp từ code Node.js thay vì spawn subprocess. Các use case phổ biến:

- custom UI web/desktop/mobile
- pipeline tự động có agent reasoning
- công cụ nội bộ cần sub-agents hoặc tool integration
- test hành vi agent bằng code

## 2. Cài Đặt

```bash
npm install @earendil-works/pi-coding-agent
```

Không cần package SDK riêng. SDK nằm ngay trong package chính.

## 3. Quick Start

```ts
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

## 4. Hai Khái Niệm Quan Trọng

### `AgentSession`

Dùng khi bạn chỉ cần một session đang hoạt động:

- `prompt()`
- `steer()`
- `followUp()`
- `subscribe()`
- `setModel()`
- `compact()`
- `abort()`

### `AgentSessionRuntime`

Dùng khi app của bạn cần thay thế session hiện tại:

- `newSession()`
- `switchSession()`
- `fork()`
- `importFromJsonl()`

Điểm cần nhớ: sau khi runtime thay session, bạn phải subscribe lại vào `runtime.session`.

## 5. Khi Nào Dùng SDK Thay Vì RPC

Ưu tiên SDK nếu:

- app viết bằng Node.js/TypeScript
- bạn muốn access trực tiếp object model
- bạn không muốn tự quản lý subprocess và JSONL protocol

Ưu tiên RPC nếu:

- app không chạy trong Node.js
- bạn cần giao thức process-independent

## 6. Prompting Khi Đang Streaming

`prompt()` có thể nhận:

- `streamingBehavior: "steer"`
- `streamingBehavior: "followUp"`
- `images`
- `expandPromptTemplates`

Đây là lớp API tương đương logic queue message trong interactive mode.

## 7. Gợi Ý Thực Tế

- Bắt đầu với `createAgentSession()` nếu bạn chỉ build prototype
- Chuyển sang runtime API khi cần quản lý nhiều session hoặc session replacement
- Dùng `SessionManager.inMemory()` cho test hoặc tool tạm thời
- Dùng resource loader mặc định nếu chưa có nhu cầu custom discovery
