# 📦 Pi Packages — Hướng Dẫn Chi Tiết

> Tham khảo từ [packages/coding-agent/docs/packages.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)  
> Pi có thể tự tạo packages — hãy nhờ nó đóng gói extensions, skills, themes cho bạn!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Install & Manage](#2-install--manage)
  - [2.1 Các Lệnh Cơ Bản](#21-các-lệnh-cơ-bản)
  - [2.2 Global vs Project Scope (`-l`)](#22-global-vs-project-scope--l)
  - [2.3 Dùng Thử Không Cài (`-e`)](#23-dùng-thử-không-cài--e)
- [3. Package Sources](#3-package-sources)
  - [3.1 npm](#31-npm)
  - [3.2 git](#32-git)
  - [3.3 Local Paths](#33-local-paths)
- [4. Tạo Pi Package](#4-tạo-pi-package)
  - [4.1 Pi Manifest trong package.json](#41-pi-manifest-trong-packagejson)
  - [4.2 Gallery Metadata](#42-gallery-metadata)
- [5. Package Structure](#5-package-structure)
- [6. Dependencies](#6-dependencies)
  - [6.1 Runtime Dependencies](#61-runtime-dependencies)
  - [6.2 peerDependencies — Packages Đi Kèm Pi](#62-peerdependencies--packages-đi-kèm-pi)
  - [6.3 bundledDependencies — Đóng Gói Package Khác](#63-bundleddependencies--đóng-gói-package-khác)
- [7. Package Filtering](#7-package-filtering)
- [8. Enable & Disable Resources](#8-enable--disable-resources)
- [9. Scope & Deduplication](#9-scope--deduplication)

---

## 1. Tổng Quan

**Pi packages** đóng gói extensions, skills, prompt templates, và themes thành một đơn vị có thể chia sẻ qua npm hoặc git. Một package khai báo tài nguyên trong `package.json` qua key `pi`, hoặc sử dụng các thư mục theo convention.

**⚠️ Bảo mật:** Pi packages chạy với **toàn quyền hệ thống**. Extensions thực thi code tùy ý, skills có thể hướng model thực hiện bất kỳ hành động nào kể cả chạy executables. **Luôn review source code trước khi cài package từ bên thứ ba.**

---

## 2. Install & Manage

### 2.1 Các Lệnh Cơ Bản

```bash
# Cài từ npm
pi install npm:@foo/bar@1.0.0

# Cài từ git
pi install git:github.com/user/repo@v1
pi install https://github.com/user/repo   # raw URL cũng được

# Cài từ local path
pi install /absolute/path/to/package
pi install ./relative/path/to/package

# Gỡ package
pi remove npm:@foo/bar

# Liệt kê packages đã cài
pi list

# Cập nhật tất cả packages (trừ pinned versions)
pi update
```

### 2.2 Global vs Project Scope (`-l`)

Mặc định, `install` và `remove` ghi vào **global settings** (`~/.pi/agent/settings.json`).

Dùng cờ `-l` để ghi vào **project settings** (`.pi/settings.json`):

```bash
pi install -l npm:@foo/bar       # cài vào project
pi remove -l npm:@foo/bar        # gỡ khỏi project
```

**Lợi ích project settings:**
- Chia sẻ với team qua git
- Pi tự động cài packages thiếu khi khởi động

### 2.3 Dùng Thử Không Cài (`-e`)

Dùng `--extension` hoặc `-e` để thử package mà không cài vĩnh viễn. Package được cài vào thư mục tạm, chỉ tồn tại trong phiên chạy hiện tại:

```bash
pi -e npm:@foo/bar
pi -e git:github.com/user/repo
```

---

## 3. Package Sources

Pi hỗ trợ 3 loại nguồn trong settings và lệnh `pi install`.

### 3.1 npm

```
npm:@scope/pkg@1.2.3
npm:pkg
```

| Đặc điểm | Mô tả |
|-----------|--------|
| **Versioned specs** | Bị pin, `pi update` sẽ bỏ qua |
| **Global install** | Dùng `npm install -g` |
| **Project install** | Lưu trong `.pi/npm/` |

**Tùy chỉnh npm command:** Nếu bạn dùng version manager như `mise` hoặc `asdf`, set `npmCommand` trong `settings.json`:

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

### 3.2 git

Pi hỗ trợ nhiều format URL cho git:

```bash
# Shorthand (cần prefix git:)
git:github.com/user/repo@v1

# SSH shorthand (cần prefix git:)
git:git@github.com:user/repo@v1

# Protocol URLs (không cần prefix)
https://github.com/user/repo@v1
ssh://git@github.com/user/repo@v1
```

| Đặc điểm | Mô tả |
|-----------|--------|
| **HTTPS & SSH** | Đều được hỗ trợ |
| **SSH keys** | Tự động sử dụng config từ `~/.ssh/config` |
| **Ref pinning** | Có ref → bị pin, `pi update` bỏ qua |
| **Clone location** | Global: `~/.pi/agent/git/<host>/<path>` — Project: `.pi/git/<host>/<path>` |
| **npm install** | Tự động chạy sau clone/pull nếu có `package.json` |

**Ví dụ SSH:**

```bash
# git@host:path shorthand (cần prefix git:)
pi install git:git@github.com:user/repo

# ssh:// protocol format
pi install ssh://git@github.com/user/repo

# Với version ref
pi install git:git@github.com:user/repo@v1.0.0
```

**Cho CI/non-interactive:** Set biến môi trường để tránh prompt:

```bash
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=5"
```

### 3.3 Local Paths

```
/absolute/path/to/package
./relative/path/to/package
```

- Được thêm vào settings mà **không copy**
- Relative paths được resolve dựa trên vị trí file settings chứa nó
- Nếu path trỏ tới **file** → load như một extension đơn lẻ
- Nếu path trỏ tới **directory** → load theo package rules

---

## 4. Tạo Pi Package

### 4.1 Pi Manifest trong package.json

Thêm key `pi` vào `package.json` và keyword `pi-package` để package có thể được tìm thấy:

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

- Paths tương đối so với package root
- Arrays hỗ trợ **glob patterns** và **`!exclusions`**

### 4.2 Gallery Metadata

[Package gallery](https://shittycodingagent.ai/packages) hiển thị các packages có keyword `pi-package`. Thêm `video` hoặc `image` để hiện preview:

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

| Field | Format | Mô tả |
|-------|--------|--------|
| `video` | MP4 | Tự phát khi hover (desktop). Click mở fullscreen player |
| `image` | PNG, JPEG, GIF, WebP | Hiển thị dạng static preview |

> Nếu cả hai được set, **video** được ưu tiên.

---

## 5. Package Structure

Nếu không có `pi` manifest trong `package.json`, Pi tự động tìm tài nguyên từ các **convention directories**:

| Thư mục | Hành vi |
|---------|---------|
| `extensions/` | Load các file `.ts` và `.js` |
| `skills/` | Tìm đệ quy các folder chứa `SKILL.md`, load file `.md` top-level như skills |
| `prompts/` | Load các file `.md` |
| `themes/` | Load các file `.json` |

**Cấu trúc ví dụ:**

```
my-package/
├── package.json          # keywords: ["pi-package"]
├── extensions/
│   ├── my-tool.ts
│   └── my-widget.ts
├── skills/
│   ├── review/
│   │   └── SKILL.md
│   └── debug/
│       └── SKILL.md
├── prompts/
│   └── code-review.md
└── themes/
    └── my-theme.json
```

---

## 6. Dependencies

### 6.1 Runtime Dependencies

Dependencies của bên thứ ba đặt trong `dependencies` của `package.json`. Khi Pi cài package từ npm hoặc git, nó chạy `npm install` nên các dependencies này được cài tự động.

Dependencies mà **không** đăng ký extensions, skills, prompt templates, hay themes cũng thuộc `dependencies`.

### 6.2 peerDependencies — Packages Đi Kèm Pi

Pi đã bundle sẵn một số core packages. Nếu bạn import bất kỳ package nào dưới đây, hãy khai báo trong `peerDependencies` với range `"*"` và **không bundle** chúng:

- `@mariozechner/pi-ai`
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-tui`
- `@sinclair/typebox`

```json
{
  "peerDependencies": {
    "@mariozechner/pi-agent-core": "*",
    "@sinclair/typebox": "*"
  }
}
```

### 6.3 bundledDependencies — Đóng Gói Package Khác

Các Pi packages khác phải được **bundle trong tarball** của bạn. Thêm chúng vào cả `dependencies` lẫn `bundledDependencies`, sau đó tham chiếu tài nguyên qua đường dẫn `node_modules/`:

```json
{
  "dependencies": {
    "shitty-extensions": "^1.0.1"
  },
  "bundledDependencies": ["shitty-extensions"],
  "pi": {
    "extensions": ["extensions", "node_modules/shitty-extensions/extensions"],
    "skills": ["skills", "node_modules/shitty-extensions/skills"]
  }
}
```

> Pi load packages với module roots riêng biệt — các bản cài riêng sẽ không xung đột hay chia sẻ modules.

---

## 7. Package Filtering

Dùng **object form** trong settings để lọc những gì package load:

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

### Quy tắc filter

| Cú pháp | Ý nghĩa |
|----------|----------|
| `"extensions/*.ts"` | Glob pattern — match các file tương ứng |
| `"!pattern"` | Loại trừ các file match pattern |
| `"+path"` | Force-include một exact path (tương đối so với package root) |
| `"-path"` | Force-exclude một exact path |
| `[]` (mảng rỗng) | Không load loại tài nguyên đó |
| *(bỏ qua key)* | Load tất cả loại tài nguyên đó |

> Filters **layer on top** của manifest — chúng chỉ thu hẹp phạm vi đã được cho phép, không thêm tài nguyên mới.

---

## 8. Enable & Disable Resources

Dùng `pi config` để bật/tắt extensions, skills, prompt templates, và themes từ các packages đã cài và thư mục local.

Hoạt động cho cả hai scope:
- **Global:** `~/.pi/agent`
- **Project:** `.pi/`

```bash
pi config    # mở interactive config
```

---

## 9. Scope & Deduplication

Packages có thể xuất hiện trong **cả global lẫn project settings**. Khi trùng, **project entry thắng**.

Danh tính package được xác định bởi:

| Source | Identity |
|--------|----------|
| **npm** | Package name |
| **git** | Repository URL (không tính ref) |
| **local** | Resolved absolute path |

**Ví dụ:** Nếu `npm:@foo/bar@1.0.0` có trong global settings và `npm:@foo/bar@2.0.0` có trong project settings → Pi sử dụng version `2.0.0` từ project.
