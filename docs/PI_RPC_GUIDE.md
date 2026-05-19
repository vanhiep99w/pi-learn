# Pi RPC Mode — Điều Khiển Pi Qua JSONL

> Tóm tắt theo `packages/coding-agent/docs/rpc.md` từ repo chính thức `earendil-works/pi`.

## 1. Dùng Khi Nào

RPC mode phù hợp khi bạn muốn:

- nhúng Pi vào IDE hoặc app riêng
- điều khiển Pi như một subprocess sống lâu
- gửi nhiều prompt và đọc event stream theo giao thức có request/response

Nếu bạn đang viết app Node.js, docs chính thức khuyên cân nhắc SDK trước vì đơn giản hơn RPC subprocess.

## 2. Cách Chạy

```bash
pi --mode rpc
```

Một số option hay dùng:

- `--provider <name>`
- `--model <pattern>`
- `--no-session`
- `--session-dir <path>`

## 3. Framing

RPC mode dùng JSON Lines nghiêm ngặt:

- mỗi record là 1 JSON object
- delimiter là LF `\n`
- có thể strip `\r` nếu client gửi `\r\n`

Ý chính: client nên đọc theo từng dòng JSONL, không nên dùng parser tách dòng mơ hồ.

## 4. Hai Loại Output

### Response

Trả lời cho một command vừa gửi:

```json
{"id":"req-1","type":"response","command":"prompt","success":true}
```

### Event

Event stream như khi chạy JSON mode:

- `message_update`
- `tool_execution_start`
- `tool_execution_end`
- `turn_end`
- ...

## 5. Commands Quan Trọng

### Prompting

- `prompt`
- `steer`
- `follow_up`
- `abort`

Ví dụ:

```json
{"id":"req-1","type":"prompt","message":"Hello, world!"}
```

Khi agent đang stream, nếu muốn thêm message bạn phải chỉ rõ:

- `streamingBehavior: "steer"`
- hoặc `streamingBehavior: "followUp"`

### State

- `get_state`
- `get_messages`

### Session

- `new_session`

### Model

- `set_model`

Docs gốc còn mô tả thêm các command runtime/state khác; với đa số integration, 4 nhóm trên là quan trọng nhất để bắt đầu.

## 6. Hành Vi Khi Đang Streaming

- `prompt` thường bị từ chối nếu agent đang stream mà không có `streamingBehavior`
- `steer` chen vào sau turn hiện tại
- `follow_up` đợi agent xử lý xong toàn bộ rồi mới đến lượt

Đây là khác biệt quan trọng nhất khi viết client.

## 7. Gợi Ý Tích Hợp

- Nếu chỉ cần batch một prompt rồi parse event stream: dùng JSON mode
- Nếu cần session lâu dài với nhiều command: dùng RPC
- Nếu app của bạn là Node.js/TypeScript: dùng SDK thường dễ hơn

Xem thêm [PI_SDK_GUIDE.md](./PI_SDK_GUIDE.md) và [PI_JSON_MODE_GUIDE.md](./PI_JSON_MODE_GUIDE.md).
