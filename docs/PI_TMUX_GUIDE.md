# Pi Với tmux — Setup Để Phím Không Bị Mất Modifier

> Tóm tắt theo `packages/coding-agent/docs/tmux.md` từ repo chính thức `earendil-works/pi`.

## 1. Vấn Đề

tmux mặc định thường làm mất thông tin modifier của một số phím, đặc biệt là:

- `Shift+Enter`
- `Ctrl+Enter`
- `Alt+Enter`

Kết quả là Pi không phân biệt được newline, submit, và follow-up queue như mong muốn.

## 2. Cấu Hình Khuyến Nghị

Thêm vào `~/.tmux.conf`:

```tmux
set -g extended-keys on
set -g extended-keys-format csi-u
```

Sau đó restart hẳn tmux:

```bash
tmux kill-server
tmux
```

## 3. Vì Sao `csi-u` Quan Trọng

Pi hỗ trợ nhiều format, nhưng docs chính thức khuyến nghị `csi-u` vì ổn định hơn.

Không có `extended-keys`, nhiều modified Enter keys sẽ bị collapse về cùng một tín hiệu như Enter thường.

## 4. Những Gì Cấu Hình Này Sửa Được

| Phím | Không có extkeys | Với `csi-u` |
|------|------------------|-------------|
| Enter | giống Enter | giống Enter |
| Shift+Enter | bị nhập nhằng | phân biệt được |
| Ctrl+Enter | bị nhập nhằng | phân biệt được |
| Alt+Enter | bị nhập nhằng | phân biệt được |

## 5. Yêu Cầu

- tmux 3.2 trở lên
- terminal phía ngoài hỗ trợ extended keys tốt

Các terminal hợp với Pi + tmux hơn là:

- Ghostty
- Kitty
- iTerm2
- WezTerm
- Windows Terminal

## 6. Kết Hợp Với Docs Terminal

Nếu bạn vẫn thấy `Shift+Enter` không đúng sau khi chỉnh tmux, kiểm tra thêm terminal emulator bên ngoài trong [PI_TERMINAL_SETUP_GUIDE.md](./PI_TERMINAL_SETUP_GUIDE.md).
