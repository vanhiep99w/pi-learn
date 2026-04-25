# 🛠️ Pi Development — Hướng Dẫn Phát Triển

> Tham khảo từ [packages/coding-agent/docs/development.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/development.md)

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Setup — Cài Đặt Môi Trường](#2-setup--cài-đặt-môi-trường)
- [3. Run From Source](#3-run-from-source)
- [4. Forking & Rebranding](#4-forking--rebranding)
- [5. Path Resolution](#5-path-resolution)
- [6. Debug Command](#6-debug-command)
- [7. Testing](#7-testing)
- [8. Project Structure](#8-project-structure)
- [9. Tips & Best Practices](#9-tips--best-practices)

---

## 1. Tổng Quan

Hướng dẫn này dành cho ai muốn **contribute** hoặc **fork** Pi — bao gồm setup môi trường dev, build, test, và cách hoạt động của project structure.

---

## 2. Setup — Cài Đặt Môi Trường

### Yêu cầu

- **Node.js** >= 18
- **Git**
- Hệ điều hành: Linux, macOS, hoặc Windows (WSL recommended)

### Các bước

```bash
# 1. Clone repo
git clone https://github.com/badlogic/pi-mono.git
cd pi-mono

# 2. Install dependencies
npm install

# 3. Build toàn bộ packages
npm run build
```

> ⚠️ **Lưu ý:** Pi là monorepo — `npm install` ở root sẽ install cho tất cả packages.

---

## 3. Run From Source

Sau khi build xong, dùng script `pi-test.sh` để chạy Pi từ source:

```bash
./pi-test.sh
```

Script này tương đương việc chạy Pi binary, nhưng sử dụng code từ local build thay vì installed version.

### So sánh

| Cách chạy | Mô tả |
|-----------|--------|
| `pi` | Chạy từ installed binary (npm global) |
| `./pi-test.sh` | Chạy từ local source — dùng khi dev |

---

## 4. Forking & Rebranding

Nếu muốn tạo bản fork với tên riêng (ví dụ: `my-agent`), Pi hỗ trợ rebranding qua `piConfig` trong `package.json`:

```json
{
  "piConfig": {
    "name": "my-agent",
    "description": "My custom coding agent",
    "configDir": ".my-agent"
  }
}
```

### `piConfig` fields

| Field | Mô tả |
|-------|--------|
| `name` | Tên hiển thị của agent |
| `description` | Mô tả ngắn |
| `configDir` | Thư mục config (mặc định `.pi`) |

Khi thay đổi `piConfig`, agent sẽ:
- Dùng thư mục config khác (ví dụ: `~/.my-agent/` thay vì `~/.pi/`)
- Hiển thị tên mới trong TUI
- Tách biệt hoàn toàn settings, sessions, extensions với Pi gốc

---

## 5. Path Resolution

### Quy tắc quan trọng

> 🚫 **KHÔNG BAO GIỜ dùng `__dirname`** trong source code.

Pi sử dụng path resolution qua `src/config.ts`. Lý do:

- Khi build, cấu trúc thư mục thay đổi
- `__dirname` trả về path của compiled file, không phải source
- `config.ts` cung cấp các hàm resolve path chính xác cho mọi trường hợp

### Cách đúng

```typescript
// ✅ Đúng — dùng config helpers
import { getConfigDir, getDataDir } from "./config.ts";

const configPath = getConfigDir();
```

```typescript
// ❌ Sai — không dùng __dirname
const configPath = path.join(__dirname, "../config");
```

---

## 6. Debug Command

Khi gặp vấn đề, dùng lệnh `/debug` trong Pi:

```
> /debug
```

### Cách hoạt động

1. Pi thu thập thông tin debug (environment, config, versions, v.v.)
2. Ghi ra file `pi-debug.log` tại thư mục hiện tại
3. File này chứa chi tiết giúp diagnose vấn đề

### Nội dung `pi-debug.log`

- Phiên bản Pi
- Node.js version
- OS information
- Loaded extensions
- Current settings
- Provider configuration
- Error logs (nếu có)

> 💡 Khi report bug, đính kèm file `pi-debug.log` sẽ giúp maintainers xử lý nhanh hơn.

---

## 7. Testing

### Chạy toàn bộ test suite

```bash
# Dùng script
./test.sh

# Hoặc dùng npm
npm test
```

### Chi tiết

| Lệnh | Mô tả |
|-------|--------|
| `./test.sh` | Chạy tất cả tests across packages |
| `npm test` | Tương tự, qua npm script |
| `npm test -w packages/ai` | Chạy test cho package cụ thể |

---

## 8. Project Structure

Pi là monorepo gồm nhiều packages:

```
pi-mono/
├── packages/
│   ├── ai/             # Core AI — providers, models, streaming
│   ├── agent/          # Agent logic — tools, sessions, compaction
│   ├── tui/            # Terminal UI — Ink-based components
│   └── coding-agent/   # Main entry — CLI, config, extensions
├── pi-test.sh          # Run from source
├── test.sh             # Run all tests
└── package.json        # Root monorepo config (piConfig here)
```

### Mô tả packages

| Package | Vai trò | Dependencies |
|---------|---------|--------------|
| `ai` | Xử lý giao tiếp với LLM providers (Anthropic, OpenAI, v.v.) | Standalone |
| `agent` | Logic agent — tool execution, session management, compaction | Depends on `ai` |
| `tui` | Giao diện terminal — TUI components, themes, rendering | Depends on `agent` |
| `coding-agent` | Entry point — CLI parsing, config, extension loading | Depends on all above |

### Dependency flow

```
ai → agent → tui → coding-agent
```

Mỗi package có thể build và test độc lập, nhưng `coding-agent` cần tất cả packages khác.

---

## 9. Tips & Best Practices

1. **Build trước khi test** — Luôn `npm run build` sau khi sửa code
2. **Dùng `pi-test.sh`** — Không install global khi đang dev
3. **Path resolution** — Luôn dùng `config.ts`, không `__dirname`
4. **Monorepo awareness** — Sửa `ai` package có thể ảnh hưởng tất cả packages phía trên
5. **Debug log** — Dùng `/debug` khi gặp vấn đề khó reproduce
