# Aurora navigation — sidebar và `/tree-v2`

Hai tính năng thuộc **Aurora UI**, được đăng ký từ `../aurora-ui.ts`. Cài package chính là có, không cần nạp demo bằng `-e`. Thư mục helper này không có `index.ts` hay manifest riêng nên Pi không auto-load lần hai. `/tree` gốc không bị thay thế.

## Theme và bố cục

- Sidebar và cây phiên lấy nền từ `customMessageBg`, vùng chọn từ `selectedBg`; chữ dùng `text`, `accent`, `muted`, `thinkingText`, `toolTitle`, `error`, rail dùng `borderAccent` của **theme đang active**. Không giữ bảng màu RGB riêng và không tự đổi theme/settings.
- Theme được đọc lại khi render, hỗ trợ `system`, dark/light, `midnight-aurora`, màu indexed/256 và background mặc định terminal; đổi theme không phải đóng/mở sidebar.
- Sidebar rộng 33 cột, cao cả transcript/editor/footer; trái/phải, không overlay chat. Dưới 84 cột tự ẩn, có thể đóng bằng lệnh. Nút **≡** nằm ngay trên editor qua widget native, mặc định sidebar đóng. Fullscreen hỗ trợ mouse; regular không điều hướng mouse.

## Sidebar — chỉ cuộn transcript

```text
/sidebar
/sidebar on
/sidebar off
/sidebar left
/sidebar right
/sidebar goto 10
/sidebar bottom
/sidebar prev
/sidebar next
```

Click ≡ bật/tắt; click input cuộn tới đúng user message. Wheel trên sidebar cuộn list, không kéo main. Giữ editor focus, native selection/copy và nội dung messages. Không fork, chuyển leaf, gửi lại prompt hoặc chạy model/tool.

Chỉ lập chỉ mục các UserMessage component trong transcript đang hiển thị; không hiện assistant/tool hay messages đã bị compaction loại khỏi transcript. OSC 133 cũng có trên assistant nên không dùng marker này một mình để nhận dạng user.

## Cây phiên — `/tree-v2`

`/tree-v2` lấy snapshot thật trong bộ nhớ từ `getEntries()`/`getLeafId()`. `/tree-v2 sample` chỉ hiển thị fixture được ghi rõ, không bao giờ điều hướng session thật.

- User cũ chỉ hiện **`user: nội dung đã gửi`**, ẩn toàn bộ xử lý thuộc câu đó. Chỉ tự mở user cuối trên ancestry của leaf thật, không lấy user ghi mới nhất trên nhánh khác.
- Thu user không làm mất các câu hỏi tiếp theo hoặc nhánh user khác. Raw IDs/parent links giữ nguyên; lớp hiển thị nối qua những sự kiện đã ẩn. Không nhập user/assistant/tool thành một node.
- Assistant, thinking, tools… lùi thêm **2 cột** dưới mức cây tương ứng. Các fork và thinking member vẫn giữ mức lồng riêng.
- Assistant hiện **một dòng ngay trên header**: `assistant: đoạn trích…`; không có preview body riêng. Space/click mới đọc toàn văn.
- Thinking liên tiếp gom thành nhóm thu sẵn, không đi qua text/tool/fork/lỗi. Thinking của response `stopReason: error` tách riêng và mở body khi user sở hữu đang mở. Chỉ dùng text đã lưu, không khôi phục redacted/signature.
- Tool call/result giữ thành hai sự kiện riêng, **chỉ tiêu đề ngắn tên + file/lệnh**, không output/result body, trạng thái chi tiết, số lỗi, timestamp hoặc bung tools. Tool lỗi chỉ đổi màu.
- Câu hỏi dài mở đầy đủ khi user được bung; câu ngắn không in lặp lại bên dưới. Di chuyển lựa chọn không tự bung nội dung.
- `>`/nền chọn là selection; `● Hiện tại` là leaf thật (hoặc user/nhóm thinking chứa leaf đang thu).

### Phím và chuột

| Thao tác | Kết quả |
|---|---|
| `↑↓`, `Home/End` | Chọn mục, không đổi leaf |
| **Enter** | Chọn vị trí thật như `/tree`, kể cả trong search |
| **Space/click** | Bung/thu user, nhóm thinking hoặc body riêng |
| `←→` | Thu/mở nhánh/nhóm, về cha/tới con |
| `Backspace` | Đóng xử lý user hoặc body/nhóm |
| `/` | Tìm cả text/tiêu đề trong xử lý đang thu, tạm mở đường tới kết quả |
| `Esc` trong search | Rời ô tìm; sau đó Space/click nếu chỉ muốn đọc |
| `/`, `Ctrl+U`, `Esc` | Xóa lọc khi đang ở ô tìm |
| `PgUp/PgDn`, wheel | Cuộn không đổi lựa chọn |
| `Ctrl+Home/End` | Cuộn đầu/cuối |
| `Esc` ngoài search | Đóng cây, không chuyển leaf |

Trong `sample`, Enter cũng chỉ bung/đọc như Space và không có hộp điều hướng.

### Chuyển nhánh thật

Enter đóng overlay rồi dùng **`ctx.navigateTree(entryId, options)`**, để Pi xử lý lifecycle/events, branch, editor restore và dựng lại transcript. Chọn user/custom message chuyển về trước entry, đưa text vào editor nếu đang trống; assistant/tool/metadata tiếp tục sau entry đó. Không tự gửi prompt hoặc tạo session file mới. Mọi block của cùng assistant message điều hướng tới cùng entry thật, không dừng giữa block. Nhóm thinking trỏ tới entry của member cuối.

Có lựa chọn **Không tóm tắt / Tóm tắt / Tóm tắt với hướng dẫn riêng**. Mặc định không tóm tắt, không gọi model; tóm tắt chủ động có thể gọi model và ghi branch summary theo Pi. Esc quay về đúng lựa chọn trong cây mà không đổi nhánh. Không đọc private settings nên vẫn hỏi dù `/tree` gốc được cấu hình bỏ hộp hỏi. Chọn leaf hiện tại là no-op.

Chỉ sau khi xác nhận mới abort response đang chạy rồi đợi idle. Nếu compaction/navigation khác còn chặn, API báo lỗi, không ép đổi leaf; extension hooks có thể hủy điều hướng. Việc xem/thu/bung không ghi lịch sử, mở auth/settings/raw session logs hoặc xuất chat ra file/log.

## Compatibility và lifecycle

Sidebar dùng private `layoutRoot`, `currentLayout`, shape UserMessage và layout fullscreen của Pi **1.5.0**; nâng Pi có thể cần cập nhật adapter. Không sửa core/global. Guard UI/headless/RPC; dọn widget, polling, compositor, selection anchor và output shim khi shutdown/reload/session replacement. Footer/editor Aurora vẫn thuộc cột chat gốc.

Giữ snapshot list hợp lệ gần nhất qua frame reflow/streaming, nhưng không jump bằng geometry cũ. Poll 250ms chỉ repaint nếu list/active/geometry thay đổi. VTE **0.84.x** có output shim đảo ngược được cho `☰` khi Pi đo 2 cột nhưng VTE vẽ 1; chỉ output, không sửa messages/copy/control payloads. Đóng sidebar gỡ shim và khôi phục scrollbar. Chưa benchmark session cực dài hay bảo đảm loại hết nhấp nháy trên mọi terminal.

## Kiểm thử

```sh
npm --prefix packages/pi-learn-extensions run test:aurora
npm --prefix packages/pi-learn-extensions run test:navigation
npm --prefix packages/pi-learn-extensions run test:navigation:pty
```

`test:navigation` cần Node hỗ trợ TS/registerHooks và Pi đã cài (`PI_TEST_BIN` có thể trỏ tới executable). PTY thêm Python `pexpect`; dùng HOME và session fixture tạm offline, không đọc session thật. Bao phủ màu theme live/256/default, resize, mouse/copy, streaming, gỡ layout, raw tree, nhóm thinking, default leaf, Enter user/assistant thật, summary cancel, Space đọc riêng, reload và messages không đổi.

Source: `sidebar.ts`, `layout.ts`, `navigation.ts`, `surface.ts`, `terminal-width.ts`; cây: `tree-command.ts`, `tree-events.ts`, `tree-view.ts`, `tree-tools.ts`. `tree-sample.ts` chỉ cung cấp fixture tường minh. HTML concepts/exporter cũ vẫn là artifact local dưới `.pi/demos/`, không nằm trong public runtime.
