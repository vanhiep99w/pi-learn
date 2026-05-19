# Pi Session Format — Cấu Trúc File Session

> Tóm tắt theo `packages/coding-agent/docs/session-format.md` từ repo chính thức `earendil-works/pi`.

## 1. Session Được Lưu Ở Đâu

Pi lưu session dưới dạng JSONL:

```txt
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

Mỗi dòng là một JSON object có field `type`.

## 2. Tư Duy Quan Trọng: Một File Nhưng Là Cả Tree

Pi không chỉ append tuyến tính. Session entries liên kết nhau bằng:

- `id`
- `parentId`

Điều này cho phép:

- branching ngay trong cùng một file
- `/tree` để nhảy tới node cũ
- branch summarization

## 3. Version History

Theo docs hiện tại:

- v1: linear sequence cũ
- v2: tree structure với `id` / `parentId`
- v3: đổi vai trò `hookMessage` thành `custom`

Pi sẽ auto-migrate session cũ lên version mới khi load.

## 4. Các Message Type Quan Trọng

### Base messages

- `user`
- `assistant`
- `toolResult`

### Extended messages

- `bashExecution`
- `custom`
- `branchSummary`
- `compactionSummary`

## 5. Content Blocks Thường Gặp

- `text`
- `image`
- `thinking`
- `toolCall`

Đây là lý do khi parse session bạn không nên assume `content` luôn là string đơn giản.

## 6. Xóa Session

Có 2 cách:

- xóa file `.jsonl` trong `~/.pi/agent/sessions/`
- xóa từ UI `/resume` bằng `Ctrl+D`

Nếu hệ thống có `trash`, Pi có thể dùng thay vì xóa vĩnh viễn.

## 7. Khi Nào Cần Hiểu File Format

- viết extension đọc lịch sử session
- build tool export/import riêng
- debug branching/compaction
- phân tích usage hoặc tool traces

## 8. Xem Thêm

- [PI_SESSIONS_GUIDE.md](./PI_SESSIONS_GUIDE.md)
- [PI_COMPACTION_GUIDE.md](./PI_COMPACTION_GUIDE.md)
- [PI_JSON_MODE_GUIDE.md](./PI_JSON_MODE_GUIDE.md)
- [PI_RPC_GUIDE.md](./PI_RPC_GUIDE.md)
