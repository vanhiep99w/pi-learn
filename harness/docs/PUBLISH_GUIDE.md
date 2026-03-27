# 📦 Publish Agent Harness — Hướng Dẫn

> Cách đóng gói và chia sẻ harness extensions dưới dạng **Pi Package**.

---

## Tổng Quan — 3 Cách Publish

| Cách | Command Install | Khi Nào Dùng |
|------|----------------|-------------|
| **npm** | `pi install npm:@pi/agent-harness` | Public package, versioned |
| **git** | `pi install git:github.com/user/agent-harness` | Open source, team dùng |
| **Local** | `pi install ./harness` | Dev/test trên máy local |

---

## 1. Chuẩn Bị Package Structure

Pi auto-discovers từ convention directories:

```text
harness/                     ← Package root
├── package.json             ← Pi manifest + npm metadata
├── extensions/              ← Pi auto-loads *.ts từ đây
│   ├── harness-state/
│   │   ├── index.ts
│   │   └── package.json
│   ├── harness-subagent/
│   │   ├── index.ts
│   │   ├── agents.ts
│   │   └── package.json
│   └── harness-verify/
│       ├── index.ts
│       └── package.json
├── skills/                  ← Pi auto-loads SKILL.md folders
│   └── harness-guide/
│       └── SKILL.md
├── prompts/                 ← Pi auto-loads *.md
│   ├── implement.md
│   ├── triage.md
│   ├── review-fix.md
│   ├── scout-plan.md
│   ├── full-pipeline.md
│   └── cleanup.md
├── agents/                  ← Agent definitions (custom)
│   ├── scout.md
│   ├── planner.md
│   ├── worker.md
│   └── reviewer.md
├── scripts/
│   └── init.sh
└── docs/
    └── ...
```

---

## 2. Package.json — Pi Manifest

```json
{
  "name": "@pi/agent-harness",
  "version": "1.0.0",
  "description": "Multi-agent harness with Beads task tracking for Pi",
  "keywords": ["pi-package"],
  "author": "hieptran",
  "license": "MIT",
  "type": "module",

  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "image": "https://example.com/harness-screenshot.png"
  },

  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

### Giải thích:

| Field | Ý Nghĩa |
|-------|---------|
| `"keywords": ["pi-package"]` | **Bắt buộc** — Pi gallery discovery |
| `"pi"` | Manifest chỉ Pi biết load gì |
| `"pi.extensions"` | Paths tới extension directories |
| `"pi.skills"` | Paths tới skill directories |
| `"pi.prompts"` | Paths tới prompt templates |
| `"pi.image"` | Preview image cho gallery |
| `"pi.video"` | Preview video (MP4, autoplay on hover) |
| `"peerDependencies"` | Pi core packages — **KHÔNG bundle**, dùng `"*"` |

---

## 3. Publish via npm

### Bước 1: Tạo npm account

```bash
npm login
```

### Bước 2: Setup package.json tại `harness/`

```bash
cd harness/
# Verify package.json có "keywords": ["pi-package"]
cat package.json
```

### Bước 3: Publish

```bash
npm publish --access public
```

> Nếu dùng scoped name (`@pi/agent-harness`), cần `--access public` cho public package.

### Bước 4: User install

```bash
# Install globally
pi install npm:@pi/agent-harness

# Install cho project
pi install -l npm:@pi/agent-harness

# Try without installing
pi -e npm:@pi/agent-harness
```

### Bước 5: Update

```bash
# Bump version
npm version patch  # 1.0.0 → 1.0.1
npm publish --access public

# Users update
pi update
```

---

## 4. Publish via Git

### Bước 1: Push to GitHub

```bash
cd harness/
git init
git add .
git commit -m "Initial harness package"
git remote add origin git@github.com:vanhiep99w/agent-harness.git
git push -u origin main
git tag v1.0.0
git push --tags
```

### Bước 2: User install

```bash
# HTTPS
pi install git:github.com/vanhiep99w/agent-harness@v1.0.0

# SSH
pi install git:git@github.com:vanhiep99w/agent-harness@v1.0.0

# Raw URL
pi install https://github.com/vanhiep99w/agent-harness
```

### Bước 3: Versioning

```bash
# Pin version → skip pi update
pi install git:github.com/vanhiep99w/agent-harness@v1.0.0

# Latest → pi update sẽ pull mới
pi install git:github.com/vanhiep99w/agent-harness
```

---

## 5. Local Path (Dev/Test)

```bash
# Relative path (từ project root)
pi install ./harness

# Absolute path
pi install /home/hieptran/Desktop/pi-learn/harness

# Project settings
pi install -l ./harness
```

Settings sẽ thêm:

```json
{
  "packages": ["./harness"]
}
```

---

## 6. File Structure Restructure

Hiện tại extensions nằm trong `harness/extensions/harness-*/`. Để Pi auto-discover đúng khi dùng package, cần đảm bảo `package.json` ở root có `"pi"` manifest đúng.

### Option A: Dùng `pi` manifest (explicit)

```json
{
  "pi": {
    "extensions": [
      "./extensions/harness-state",
      "./extensions/harness-subagent",
      "./extensions/harness-verify"
    ],
    "prompts": ["./prompts"],
    "skills": ["./skills"]
  }
}
```

### Option B: Convention directories (auto-discover)

Pi tự detect:
- `extensions/` → load `*/index.ts` và `*.ts`
- `skills/` → load `*/SKILL.md`
- `prompts/` → load `*.md`

Current structure đã đúng convention → Option B works out of box.

---

## 7. Package Filtering (cho users)

Users có thể chọn load gì:

```json
{
  "packages": [
    {
      "source": "npm:@pi/agent-harness",
      "extensions": ["extensions/harness-state", "extensions/harness-subagent"],
      "prompts": ["prompts/implement.md", "prompts/triage.md"],
      "skills": []
    }
  ]
}
```

---

## 8. Pi Gallery

Package có keyword `pi-package` sẽ xuất hiện tại:

**[shittycodingagent.ai/packages](https://shittycodingagent.ai/packages)**

Thêm preview:

```json
{
  "pi": {
    "video": "https://example.com/harness-demo.mp4",
    "image": "https://example.com/harness-screenshot.png"
  }
}
```

---

## Quick Reference

```bash
# ── Publish ──
npm publish --access public          # npm
git push && git tag v1.0.0           # git

# ── Install ──
pi install npm:@pi/agent-harness    # npm
pi install git:github.com/user/repo  # git
pi install ./harness                 # local

# ── Manage ──
pi list                              # show installed
pi update                            # update all
pi remove npm:@pi/agent-harness     # remove

# ── Test ──
pi -e npm:@pi/agent-harness         # try without install
pi -e ./harness                      # test local
```
