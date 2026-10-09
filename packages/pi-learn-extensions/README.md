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

Theme đi kèm:

```txt
midnight-aurora
```

Bật trong settings:

```json
{
  "theme": "midnight-aurora"
}
```

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
