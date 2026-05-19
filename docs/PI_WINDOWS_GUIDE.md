# Pi Trên Windows — Setup Nhanh

> Tóm tắt theo `packages/coding-agent/docs/windows.md` từ repo chính thức `earendil-works/pi`.

## 1. Yêu Cầu Cốt Lõi

Pi cần có `bash` trên Windows.

Thứ tự Pi tìm shell:

1. custom path trong `~/.pi/agent/settings.json`
2. Git Bash tại `C:\\Program Files\\Git\\bin\\bash.exe`
3. `bash.exe` có trên `PATH` như Cygwin, MSYS2, hoặc WSL

Với đa số người dùng, cài [Git for Windows](https://git-scm.com/download/win) là đủ.

## 2. Chỉ Định Shell Path Thủ Công

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```

## 3. Lưu Ý Thực Tế

- Nếu bạn đã có WSL hoặc Cygwin thì vẫn dùng được, miễn `bash` truy cập ổn định
- Nếu Pi chạy được nhưng hotkeys liên quan `Shift+Enter` hoặc `Alt+Enter` không ổn, xem thêm [PI_TERMINAL_SETUP_GUIDE.md](./PI_TERMINAL_SETUP_GUIDE.md)
- Trên Windows Terminal, docs chính thức dùng `Ctrl+Enter` hoặc remap modified Enter keys để Pi phân biệt đúng

## 4. Khuyến Nghị

Stack ít đau đầu nhất thường là:

- Git for Windows
- Windows Terminal
- cấu hình modified Enter keys theo terminal docs

Nếu bạn làm việc nặng với shell/Linux tooling, WSL vẫn là lựa chọn thoải mái hơn.
