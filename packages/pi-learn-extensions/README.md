# Pi Learn Extensions Package

Đây là thư mục chứa extension/theme mà root repo expose cho Pi package.

Repo GitHub:

```txt
https://github.com/vanhiep99w/pi-learn
```

Install package từ root repo:

```bash
pi install git:github.com/vanhiep99w/pi-learn@v1.0.0
```

Test tạm:

```bash
pi -e git:github.com/vanhiep99w/pi-learn@v1.0.0
```

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
├── ask-user/
├── web-tools/
├── chatgpt-usage-status/
└── aurora-ui.ts

themes/
└── midnight-aurora.json
```
