# Pi Learn Extensions Package

Package extension/theme mà root repository expose cho Pi Coding Agent.

## Cài và reload

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
# hoặc test tạm
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Sau khi cài/update, restart Pi hoặc chạy `/reload`.

## Nội dung package

```txt
extensions/
├── wiki/                    # /wiki và /wiki-update
├── chatgpt-usage-status/    # ChatGPT Plus/Pro usage
└── aurora-ui.ts             # custom TUI/editor/footer/status

themes/
└── midnight-aurora.json
```

## Wiki

```txt
/wiki [ghi chú]
/wiki-update [ghi chú]
```

- `/wiki` tạo Wiki ban đầu dưới `wiki/`.
- `/wiki-update` dùng source hiện tại để cập nhật có chọn lọc. Cả hai command không đưa Git status, commit hoặc diff vào prompt; Git chỉ dùng nội bộ cho no-op detection và metadata.
- Trong `/wiki-update`, agent tự phân loại yêu cầu và chọn `wiki/**/_rules.md` thuộc domain phù hợp cho chính sách lâu dài; không cần tên file hay từ khóa đặc biệt. Facts thuộc normal Wiki, chỉ thị một lần không được lưu; khi mơ hồ thì hỏi lại. Rule vẫn được bảo vệ ngoài lượt update.
- Không có command hỏi Wiki riêng. Agent dùng block `Project Wiki` trong `AGENTS.md`/`CLAUDE.md`: chỉ đọc `wiki/quickstart.md` cho câu hỏi về project khi context chưa có, và chỉ đọc rule áp dụng ngay trước khi sửa component liên quan.
- `wiki/INSTRUCTIONS.md` là brief do người dùng quản lý. `wiki/.last-update.json` do extension quản lý.
- Sau mỗi run, extension kiểm tra link nội bộ và rule layout trước khi đánh dấu hoàn tất.

Test:

```bash
npm --prefix packages/pi-learn-extensions run test:wiki
```

## ChatGPT usage status

```txt
/chatgpt-login
/chatgpt-usage
/chatgpt-usage-refresh
/chatgpt-accounts
/chatgpt-switch
/chatgpt-delete
/chatgpt-logout
```

Extension chỉ hiện status cho provider `openai-codex` hoặc `chatgpt`. Auth/account data được lưu local, không commit vào repository.

## Aurora UI

Aurora UI cung cấp startup banner, editor chỉ có viền ngang, footer tối giản, working message tiếng Việt, cwd/git status và theme picker:

```txt
/aurora-themes
```

Aurora dùng semantic tokens của theme đang active, không tự chọn theme hoặc sửa settings. Banner đọc tên/màu theme ở mỗi lần render; picker và shortcut có `hasUI` guard. Host Pi có thể lưu lựa chọn theme từ picker.

- **`midnight-aurora`**: giữ palette Aurora, sinh màu thích nghi với nền terminal trong TUI. Chọn trong settings:

```json
{
  "theme": "midnight-aurora"
}
```

- **`system`**: dùng màu terminal và bộ sinh màu của Pi, không bị Aurora adaptive thay thế.

### Aurora tự thích nghi

```txt
/aurora-adapt status
/aurora-adapt off
/aurora-adapt auto
```

Khi chọn `midnight-aurora`, chế độ auto bật mặc định trong mỗi session/reload, áp dụng một `Theme` trong bộ nhớ với tên vẫn là `midnight-aurora`. Editor/banner có nhãn `auto:dark` hoặc `auto:light`. `off` phục hồi JSON tối cố định; `auto` bật lại và yêu cầu đọc nền mới. Không ghi cấu hình cá nhân, palette hoặc file theme. Dùng tên theme đơn `midnight-aurora`, không kết hợp với cặp theme light/dark của Pi vì chế độ in-memory có controller riêng.

Engine dưới `extensions/aurora/` lấy hue/chroma từ theme JSON đi kèm (không lấy bảng ANSI terminal), giải panel trước rồi chữ trên nền terminal và tất cả panel/vùng chọn. Dùng OKLCH, tìm độ sáng theo WCAG và giảm chroma để nằm trong sRGB; chroma không vượt màu gốc ngoài sai số lượng tử nhỏ. Đây là triển khai đơn giản lấy cảm hứng từ bài System Theme, không phải bản sao thuật toán đa thức/OKHSL của Pi.

Nền được đọc qua API `TUI.queryTerminalColors`, tối đa 100 ms mỗi query; kiểm tra mỗi 3 giây chỉ khi Aurora đang active. Nếu không có reply, giữ nền đã biết hoặc màu mặc định/dự đoán của Pi, ngừng query lặp và vẫn nhận reply đến muộn. `auto` thử lại query. Request và reply sau khi tắt/đổi theme/shutdown bị kiểm tra ownership; timers được dọn trên session shutdown/footer dispose. Không thay callback theme toàn cục hoặc cờ thông báo sáng/tối của terminal.

Giới hạn: bộ sinh màu chỉ chạy trong TUI với Pi có các API màu/Theme hiện tại; không đổi nền terminal. Contrast audit bảo đảm các cặp sRGB được test, không bao gồm wallpaper/transparency hoặc xấp xỉ 256 màu. Với nền gần xám trung tính, chữ có thể phải gần đen/trắng và giảm màu để đạt 4.5:1. HTML export và chế độ ngoài TUI vẫn dùng JSON tối cố định (nền dự kiến `#0b1020`). Nếu không truy vấn được nền, dùng default/guess của Pi; lỗi khởi tạo thì báo và giữ theme đang có. Cần Pi có các API màu hiện tại; chưa có compatibility matrix cho host cũ.

Kiểm thử:

```bash
npm --prefix packages/pi-learn-extensions test
npm --prefix packages/pi-learn-extensions run test:aurora
npm --prefix packages/pi-learn-extensions run test:theme
```

Aurora tests dùng host giả lập, kiểm banner/theme change/width/cleanup, headless picker, adapter polling và controller reply đến muộn/ownership/off/auto. Theme tests kiểm static JSON và bộ sinh màu trên nền tối/sáng/có tint/dải xám, WCAG ≥4.5:1 cho chữ, hue/chroma và phân cấp chữ phụ.

Sau `/reload`, chọn `midnight-aurora`, chạy `status`, đổi nền terminal sáng/tối và chờ khoảng 3 giây; kiểm editor/panel/diff/comment. Thử `off`/`auto`, đổi sang `system`, terminal hẹp và fullscreen/regular. Kiểm tra trực quan vẫn cần thiết.

## Package manifest

Root package expose resources này:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

Pi load file extension trực tiếp và thư mục có `index.ts`; vì vậy `wiki/index.ts` là entrypoint duy nhất cho Wiki.
