# 📱 Pi trên Termux — Hướng Dẫn Cài Đặt

> Tham khảo từ [packages/coding-agent/docs/termux.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/termux.md)

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Prerequisites](#2-prerequisites)
- [3. Cài Đặt](#3-cài-đặt)
- [4. Clipboard Support](#4-clipboard-support)
- [5. AGENTS.md cho Termux](#5-agentsmd-cho-termux)
- [6. Limitations](#6-limitations)
- [7. Troubleshooting](#7-troubleshooting)

---

## 1. Tổng Quan

Pi có thể chạy trên **Android** thông qua [Termux](https://termux.dev/) — một terminal emulator mạnh mẽ cho Android. Điều này cho phép bạn sử dụng Pi coding agent trực tiếp trên điện thoại hoặc tablet.

---

## 2. Prerequisites

### Cài đặt Termux

> ⚠️ **KHÔNG cài Termux từ Google Play Store** — phiên bản trên Play Store đã lỗi thời và không được cập nhật.

| Nguồn | Khuyến nghị |
|-------|-------------|
| [GitHub Releases](https://github.com/termux/termux-app/releases) | ✅ Recommended |
| [F-Droid](https://f-droid.org/packages/com.termux/) | ✅ OK |
| Google Play Store | ❌ Không dùng |

### Cài đặt Termux:API

Để Pi hỗ trợ clipboard, cần cài thêm **Termux:API**:

1. Cài app **Termux:API** từ cùng nguồn (GitHub/F-Droid)
2. Cài package `termux-api` trong Termux:
   ```bash
   pkg install termux-api
   ```

---

## 3. Cài Đặt

```bash
# 1. Cập nhật packages
pkg update && pkg upgrade

# 2. Cài Node.js
pkg install nodejs

# 3. Cài Pi
npm install -g @anthropic-ai/pi

# 4. Thiết lập API key
export ANTHROPIC_API_KEY="your-key-here"

# 5. Chạy Pi
pi
```

### Persistent API key

Để không phải export key mỗi lần, thêm vào `~/.bashrc`:

```bash
echo 'export ANTHROPIC_API_KEY="your-key-here"' >> ~/.bashrc
```

---

## 4. Clipboard Support

Pi trên Termux hỗ trợ clipboard, nhưng **chỉ text** (không hỗ trợ image):

| Loại | Hỗ trợ |
|------|--------|
| Text copy/paste | ✅ Có (qua `termux-api`) |
| Image paste | ❌ Không |

### Yêu cầu

- App **Termux:API** đã cài
- Package `termux-api` đã cài trong Termux
- Permission "Display over other apps" đã cấp cho Termux:API

---

## 5. AGENTS.md cho Termux

Khi dùng Pi trên Termux, nên tạo `AGENTS.md` để agent hiểu context môi trường:

```markdown
# Environment

This project is being developed on Android using Termux.

## Important notes

- File system is case-sensitive
- Home directory is /data/data/com.termux/files/home
- Use `pkg` instead of `apt` for package management
- No systemd — services managed differently
- Limited RAM and CPU compared to desktop
- Screen size is small — keep output concise
- No GUI applications available
- Use `termux-open-url` to open URLs in browser
```

> 💡 Thêm file này vào root project để Pi điều chỉnh hành vi phù hợp — ví dụ: output ngắn gọn hơn, không suggest mở GUI apps.

---

## 6. Limitations

| Giới hạn | Mô tả |
|----------|--------|
| **RAM** | Android giới hạn RAM cho Termux — project lớn có thể gặp OOM |
| **CPU** | Slower than desktop — build times lâu hơn |
| **Storage** | Internal storage giới hạn — chú ý dung lượng `node_modules` |
| **No GUI** | Không có GUI — Pi TUI vẫn hoạt động vì là terminal-based |
| **Screen size** | Màn hình nhỏ — Pi output có thể khó đọc |
| **Background** | Android có thể kill Termux khi chạy background |
| **Image clipboard** | Không hỗ trợ paste image vào Pi |

### Khuyến nghị

- Dùng Termux cho **quick edits** và **code review**, không phải heavy development
- Cân nhắc dùng **Termux:Float** để chạy Pi song song với browser
- Lock Termux trong notification để tránh bị Android kill

---

## 7. Troubleshooting

### Node.js install lỗi

```bash
# Thử cài từ source
pkg install python make clang
npm install -g @anthropic-ai/pi --build-from-source
```

### Permission denied

```bash
# Cấp quyền storage
termux-setup-storage
```

### Clipboard không hoạt động

1. Kiểm tra Termux:API app đã cài chưa
2. Kiểm tra package: `pkg list-installed | grep termux-api`
3. Cấp permission "Display over other apps" cho Termux:API
4. Thử: `termux-clipboard-get` — nếu trả về text, clipboard hoạt động

### Pi chạy chậm

- Tắt background apps để free RAM
- Dùng model nhỏ hơn (Haiku thay vì Sonnet) cho tasks đơn giản
- Giảm context bằng cách dùng `.piignore` để exclude thư mục lớn
