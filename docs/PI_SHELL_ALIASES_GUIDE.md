# 🐚 Pi Shell Aliases — Hướng Dẫn Sử Dụng

> Tham khảo từ [packages/coding-agent/docs/shell-aliases.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/shell-aliases.md)

---

## Mục Lục

- [1. Vấn Đề](#1-vấn-đề)
- [2. Giải Pháp](#2-giải-pháp)
- [3. Cấu Hình](#3-cấu-hình)
- [4. Ví Dụ Thực Tế](#4-ví-dụ-thực-tế)
- [5. Lưu Ý](#5-lưu-ý)

---

## 1. Vấn Đề

Khi Pi chạy lệnh bash, nó sử dụng **bash non-interactive mode**. Điều này có nghĩa:

- **Shell aliases không được expand** — aliases chỉ hoạt động ở interactive mode
- Nếu bạn có alias `ll="ls -la"` trong `~/.bashrc`, Pi sẽ **không nhận diện** `ll`
- Tương tự cho các aliases khác như `la`, `gs`, `gp`, v.v.

### Tại sao non-interactive?

Pi chạy bash ở non-interactive mode vì lý do bảo mật và hiệu năng — interactive shell load nhiều config files có thể gây side effects không mong muốn.

---

## 2. Giải Pháp

Pi cung cấp setting `shellCommandPrefix` — một prefix string được thêm vào **trước mỗi lệnh bash** mà Pi thực thi.

Bằng cách set prefix thành `shopt -s expand_aliases && source ~/.bashrc &&`, Pi sẽ:

1. Bật alias expansion (`shopt -s expand_aliases`)
2. Load aliases từ `~/.bashrc` (hoặc file config khác)
3. Chạy lệnh thực tế

---

## 3. Cấu Hình

Thêm `shellCommandPrefix` vào `settings.json`:

### Vị trí file

| Scope | Path |
|-------|------|
| Global | `~/.pi/settings.json` |
| Project | `.pi/settings.json` |

### Config

```json
{
  "shellCommandPrefix": "shopt -s expand_aliases && source ~/.bashrc && "
}
```

> ⚠️ **Quan trọng:** Có dấu cách và `&&` ở cuối prefix — để tách biệt với lệnh thực tế.

### Cách hoạt động

Khi Pi chạy lệnh `ll`, thực tế nó sẽ execute:

```bash
shopt -s expand_aliases && source ~/.bashrc && ll
```

---

## 4. Ví Dụ Thực Tế

### Bash aliases

```json
{
  "shellCommandPrefix": "shopt -s expand_aliases && source ~/.bashrc && "
}
```

### Zsh aliases

Nếu bạn dùng Zsh và muốn Pi load aliases từ `~/.zshrc`:

```json
{
  "shellCommandPrefix": "source ~/.zshrc && "
}
```

### File aliases riêng

Nếu bạn tách aliases vào file riêng (ví dụ `~/.bash_aliases`):

```json
{
  "shellCommandPrefix": "shopt -s expand_aliases && source ~/.bash_aliases && "
}
```

---

## 5. Lưu Ý

1. **Performance** — Mỗi lệnh bash đều phải source file config → có thể chậm hơn một chút nếu file `.bashrc` lớn hoặc chạy nhiều lệnh khởi tạo
2. **Side effects** — Nếu `.bashrc` chạy lệnh có side effects (ví dụ: print welcome message, clear screen), chúng sẽ chạy mỗi khi Pi execute bash
3. **Scope** — Setting này áp dụng cho **tất cả** lệnh bash của Pi, không chỉ một lệnh cụ thể
4. **Không ảnh hưởng user** — Prefix chỉ áp dụng khi Pi chạy bash, không ảnh hưởng terminal session của bạn
