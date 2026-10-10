# Pi Learn

Pi Learn là package cho Pi Coding Agent, tập trung vào Wiki repository, giao diện Aurora và tài liệu học Pi bằng tiếng Việt.

## Thành phần

```txt
packages/pi-learn-extensions/
├── extensions/
│   ├── wiki/                    # /wiki và /wiki-update
│   ├── chatgpt-usage-status/    # trạng thái usage ChatGPT
│   └── aurora-ui.ts             # editor/footer/status tùy biến
└── themes/
    └── midnight-aurora.json

docs/                            # tài liệu Pi tiếng Việt
wiki/                            # Wiki của chính repository này
```

Package không còn runtime quan sát session, proposal/eval/apply, công cụ tạo ảnh hoặc công cụ prompt theo model.

## Cài đặt

Cài toàn cục từ GitHub:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Cài riêng cho project hiện tại:

```bash
pi install -l git:github.com/vanhiep99w/pi-learn@main
```

Chạy thử mà không ghi settings:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Sau khi cài hoặc cập nhật extension/theme, restart Pi hoặc chạy:

```txt
/reload
```

## Wiki repository

Wiki dùng model, provider và filesystem tools hiện tại của Pi:

```txt
/wiki [ghi chú thêm]
/wiki-update [ghi chú thêm]
```

- `/wiki` khởi tạo tài liệu dưới `wiki/`.
- `/wiki-update` cập nhật tài liệu theo source hiện tại và yêu cầu cụ thể; prompt không chứa Git status, lịch sử commit hoặc diff.
- Trong `/wiki-update`, agent tự phân biệt facts, chính sách lâu dài và chỉ thị một lần, rồi chọn trang Wiki hoặc `_rules.md` thuộc domain phù hợp. Không cần nêu tên file hay từ khóa đặc biệt, ví dụ:

  ```txt
  /wiki-update Khi viết code tôi không muốn tự thêm unit test nữa
  ```

  Chỉ thị một lần không được lưu thành rule; yêu cầu mơ hồ thì agent hỏi lại. Ngoài lượt `/wiki-update`, rule vẫn được bảo vệ.

- Không có command hỏi Wiki riêng. Với câu hỏi về project, agent đọc `wiki/quickstart.md` một lần khi context hiện tại chưa có; câu hỏi không liên quan project thì không cần đọc.
- Rule chỉ được load ngay trước khi agent cần sửa component/domain mà rule đó quản lý. Read-only question không bắt buộc load rule.
- `wiki/INSTRUCTIONS.md` là brief tùy chọn để định hướng scope, ưu tiên và ngôn ngữ.
- Extension tự kiểm tra internal Markdown links, rule layout và cập nhật `wiki/.last-update.json` sau khi run kết thúc.

Chi tiết: [`wiki/extensions/wiki-extension.md`](wiki/extensions/wiki-extension.md).

## ChatGPT usage status

Extension hiển thị usage khi provider hiện tại là `openai-codex` hoặc `chatgpt`.

```txt
/chatgpt-login
/chatgpt-usage
/chatgpt-usage-refresh
/chatgpt-accounts
/chatgpt-switch
/chatgpt-delete
/chatgpt-logout
```

Credential được lưu local bởi Pi/extension, không nằm trong repository.

## Aurora UI và theme

Aurora UI cung cấp startup banner, editor/footer/status tùy biến, thông tin cwd/git và command:

```txt
/aurora-themes
```

Aurora không tự chọn theme thay bạn. Có hai hướng trong `/settings → Theme`:

- **`midnight-aurora`**: giữ palette tím/xanh Aurora, tự sinh độ sáng chữ/panel theo nền terminal trong TUI. Không cần chuyển sang `system`.
- **`system`**: dùng bảng màu terminal và bộ sinh theme có sẵn của Pi; Aurora không can thiệp.

Chọn Midnight Aurora trong settings:

```json
{
  "theme": "midnight-aurora"
}
```

Sau `/reload`, khi dùng `midnight-aurora`, editor có nhãn **`auto:dark`** hoặc **`auto:light`**. Theme giữ tên cũ, không đổi nền terminal hoặc ghi palette sinh ra vào file.

```txt
/aurora-adapt status   # xem nền đã đọc, appearance và trạng thái
/aurora-adapt off      # trở lại palette tối cố định
/aurora-adapt auto     # bật lại và đọc lại nền terminal
```

Chế độ tự thích nghi bật mặc định mỗi session/reload, kiểm nền mỗi 3 giây khi Aurora được chọn. Terminal không trả màu nền thì giữ nền đã đọc hoặc dùng màu dự đoán của Pi và ngừng query lặp; dùng `auto` để thử lại. Contrast tests kiểm màu sRGB; transparency/wallpaper và terminal 256 màu có thể làm kết quả khác. HTML export vẫn dùng theme JSON cố định. Chi tiết ở [package README](packages/pi-learn-extensions/README.md#aurora-ui).

## Web search

Pi Learn không đóng gói web tools. Nếu cần `web_search`, cài riêng:

```bash
pi install git:github.com/nicobailon/pi-web-access
```

## Tài liệu

- [`docs/README.md`](docs/README.md) — mục lục tài liệu Pi tiếng Việt.
- [`PI_DOCUMENTATION.md`](PI_DOCUMENTATION.md) — tài liệu tổng hợp ở root.
- [`wiki/quickstart.md`](wiki/quickstart.md) — bản đồ thay đổi cho repository này.
- [`packages/pi-learn-extensions/README.md`](packages/pi-learn-extensions/README.md) — package extension/theme.

## Kiểm thử và bảo trì

Chạy toàn bộ tests (Wiki, Aurora UI và theme):

```bash
npm --prefix packages/pi-learn-extensions test
```

Chạy riêng bằng `run test:wiki`, `run test:aurora` hoặc `run test:theme`. Tests Aurora dùng host giả lập; contrast tests kiểm màu sRGB đã khai báo, không thay kiểm tra trực quan trong terminal.

Sau thay đổi extension/theme:

1. Chạy test mục tiêu.
2. Chạy `/reload`.
3. Kiểm tra command hoặc UI liên quan.
4. Xem `git status` và diff; không commit auth, `.env`, payload log hoặc session log.

## Update / remove

```bash
pi list
pi update
pi remove git:github.com/vanhiep99w/pi-learn
pi remove -l git:github.com/vanhiep99w/pi-learn
```
