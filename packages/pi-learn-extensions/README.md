# Pi Learn Extensions Package

Đây là thư mục chứa extension/theme mà root repo expose cho Pi package.

Repo GitHub:

```txt
https://github.com/vanhiep99w/pi-learn
```

Install package từ root repo. Khuyến nghị dùng branch `main` để update bằng `pi update`:

```bash
pi install git:github.com/vanhiep99w/pi-learn@main
```

Test tạm:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@main
```

Nếu cần pin bản ổn định, dùng tag release như `@v1.0.1`.

Root `package.json` đã khai báo:

```json
{
  "pi": {
    "extensions": ["./packages/pi-learn-extensions/extensions"],
    "themes": ["./packages/pi-learn-extensions/themes"]
  }
}
```

Xem hướng dẫn chi tiết ở README root repo:

```txt
../../README.md
```

## Included

```txt
extensions/
├── web-tools/
├── chatgpt-usage-status/
├── fixed-input-layout/  # vendored compositor helpers for aurora-ui
└── aurora-ui.ts         # fixed input cluster + bordered editor

themes/
└── midnight-aurora.json
```
