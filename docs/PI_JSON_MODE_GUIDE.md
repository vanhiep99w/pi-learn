# Pi JSON Mode — Event Stream Có Cấu Trúc

> Tóm tắt theo `packages/coding-agent/docs/json.md` từ repo chính thức `earendil-works/pi`.

## 1. Dùng Khi Nào

JSON mode phù hợp khi bạn muốn:

- parse output của Pi bằng script
- build UI nhẹ bên ngoài Pi
- log đầy đủ lifecycle của agent

## 2. Cách Chạy

```bash
pi --mode json "Your prompt"
```

Pi sẽ ghi ra stdout theo định dạng JSON Lines.

## 3. Dòng Đầu Tiên

Dòng đầu là session header, ví dụ:

```json
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path"}
```

## 4. Các Event Quan Trọng

### Agent lifecycle

- `agent_start`
- `agent_end`

### Turn lifecycle

- `turn_start`
- `turn_end`

### Message lifecycle

- `message_start`
- `message_update`
- `message_end`

### Tool execution

- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`

### Queue / compaction / retry

- `queue_update`
- `compaction_start`
- `compaction_end`
- `auto_retry_start`
- `auto_retry_end`

## 5. Cách Hiểu `message_update`

Trong streaming, Pi sẽ đẩy delta qua `assistantMessageEvent`, ví dụ text đang được model generate dần. Đây là event bạn thường dùng nếu muốn render live output.

## 6. Ví Dụ Lọc Event

Chỉ lấy message cuối:

```bash
pi --mode json "List files" 2>/dev/null | jq -c 'select(.type == "message_end")'
```

Lấy các tool calls:

```bash
pi --mode json "Review repo" 2>/dev/null | jq -c 'select(.type == "tool_execution_start")'
```

## 7. Khi Nào Nên Dùng RPC Thay Vì JSON

- Dùng `--mode json` khi chỉ cần stream sự kiện một chiều
- Dùng `--mode rpc` khi cần gửi nhiều command vào Pi trong cùng một process

Xem thêm [PI_RPC_GUIDE.md](./PI_RPC_GUIDE.md).
