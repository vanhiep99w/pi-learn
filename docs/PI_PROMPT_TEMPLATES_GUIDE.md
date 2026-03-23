# 📝 Pi Prompt Templates — Hướng Dẫn Chi Tiết

> Tham khảo từ [packages/coding-agent/docs/prompt-templates.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)  
> Pi có thể tự tạo prompt templates — hãy nhờ nó build cho workflow của bạn!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Cách Hoạt Động](#2-cách-hoạt-động)
- [3. Vị Trí Đặt Templates](#3-vị-trí-đặt-templates)
- [4. Format — Cấu Trúc File Template](#4-format--cấu-trúc-file-template)
- [5. Frontmatter](#5-frontmatter)
- [6. Cách Sử Dụng](#6-cách-sử-dụng)
- [7. Arguments — Hệ Thống Tham Số](#7-arguments--hệ-thống-tham-số)
  - [7.1 Positional Arguments](#71-positional-arguments)
  - [7.2 All Arguments](#72-all-arguments)
  - [7.3 Slicing](#73-slicing)
  - [7.4 Bash-style Quoting](#74-bash-style-quoting)
  - [7.5 Bảng Tổng Hợp](#75-bảng-tổng-hợp)
- [8. Ví Dụ Thực Tế](#8-ví-dụ-thực-tế)
  - [8.1 Code Review](#81-code-review)
  - [8.2 Tạo Component](#82-tạo-component)
  - [8.3 API Endpoint](#83-api-endpoint)
  - [8.4 Git Workflow](#84-git-workflow)
  - [8.5 Documentation](#85-documentation)
  - [8.6 Testing](#86-testing)
  - [8.7 Refactoring](#87-refactoring)
  - [8.8 Debug](#88-debug)
- [9. So Sánh: Templates vs Skills vs Extensions](#9-so-sánh-templates-vs-skills-vs-extensions)
- [10. Tích Hợp Với Hệ Thống Pi](#10-tích-hợp-với-hệ-thống-pi)
  - [10.1 Packages](#101-packages)
  - [10.2 Settings](#102-settings)
  - [10.3 Extensions](#103-extensions)
- [11. Loading Rules & Discovery](#11-loading-rules--discovery)
- [12. Tips & Best Practices](#12-tips--best-practices)

---

## 1. Tổng Quan

**Prompt Templates** là các Markdown snippets có thể tái sử dụng. Thay vì gõ lại những prompt dài lặp đi lặp lại, bạn lưu chúng thành file `.md` và gọi bằng `/tên` ngay trong editor.

### Ý tưởng cốt lõi

```
File:    ~/.pi/agent/prompts/review.md
Gọi:    /review
Kết quả: Nội dung file review.md được expand thành prompt gửi cho LLM
```

### Tại sao cần Prompt Templates?

| Vấn đề | Giải pháp |
|--------|-----------|
| Gõ lại prompt dài mỗi lần | Lưu 1 lần, gọi `/name` |
| Prompt không nhất quán giữa các lần | Template chuẩn hóa nội dung |
| Khó chia sẻ prompt hay cho team | Đặt trong `.pi/prompts/` hoặc package |
| Prompt cần linh hoạt theo ngữ cảnh | Arguments: `$1`, `$@`, slicing |

---

## 2. Cách Hoạt Động

```
User gõ: /review
    │
    ▼
Pi tìm template "review" trong danh sách loaded templates
    │
    ▼
Tìm thấy file: ~/.pi/agent/prompts/review.md
    │
    ▼
Parse frontmatter (description, etc.)
    │
    ▼
Lấy body content (phần sau ---)
    │
    ▼
Thay thế arguments ($1, $@, ${@:N}, etc.)
    │
    ▼
Content được gửi cho LLM như một user prompt bình thường
```

**Thứ tự xử lý input trong Pi:**

1. Extension commands (`/cmd`) → nếu match, xử lý ngay
2. `input` event → extensions có thể intercept/transform
3. **Prompt templates** (`/name`) → expand thành content ← **đây**
4. Skill commands (`/skill:name`) → load SKILL.md
5. Agent processing → gửi cho LLM

---

## 3. Vị Trí Đặt Templates

Pi load templates từ nhiều nguồn, theo thứ tự ưu tiên:

### Auto-discovered

| Location | Scope | Ví dụ |
|----------|-------|-------|
| `~/.pi/agent/prompts/*.md` | **Global** — tất cả projects | `~/.pi/agent/prompts/review.md` |
| `.pi/prompts/*.md` | **Project** — chỉ project hiện tại | `./my-project/.pi/prompts/api.md` |

### Qua cấu hình

| Cách | Ví dụ |
|------|-------|
| **Packages** | `prompts/` directories hoặc `pi.prompts` trong `package.json` |
| **Settings** | `"prompts"` array trong `settings.json` (files hoặc directories) |
| **CLI** | `--prompt-template <path>` (repeatable) |

### Ví dụ cấu trúc thư mục

```
~/.pi/agent/
└── prompts/
    ├── review.md          → /review
    ├── component.md       → /component
    ├── debug.md           → /debug
    └── commit.md          → /commit

my-project/
└── .pi/
    └── prompts/
        ├── api-route.md   → /api-route
        ├── test.md        → /test
        └── deploy.md      → /deploy
```

### Disable discovery

```bash
pi --no-prompt-templates    # Tắt toàn bộ auto-discovery
```

---

## 4. Format — Cấu Trúc File Template

Mỗi template là một file Markdown (`.md`) với **optional YAML frontmatter**:

```markdown
---
description: Mô tả ngắn gọn template này làm gì
---
Nội dung prompt ở đây.
Đây là phần được expand khi gọi /tên.

Hỗ trợ **Markdown** đầy đủ.
```

### Quy tắc

| Yếu tố | Quy tắc |
|---------|---------|
| **Tên file** | Trở thành tên command. `review.md` → `/review` |
| **Frontmatter** | Optional. Nằm giữa hai dòng `---` |
| **Description** | Từ frontmatter. Nếu không có → dùng dòng đầu tiên (max 60 chars) |
| **Body** | Phần sau frontmatter → nội dung được expand |
| **Encoding** | UTF-8 |

### Template tối giản (không frontmatter)

```markdown
Review the staged changes (`git diff --cached`). Focus on bugs and security issues.
```

Khi không có frontmatter, dòng đầu tiên (truncated 60 chars) được dùng làm description hiển thị trong autocomplete.

---

## 5. Frontmatter

| Field | Required | Mô tả |
|-------|----------|--------|
| `description` | No | Mô tả ngắn, hiển thị trong autocomplete khi gõ `/` |

```yaml
---
description: Review staged git changes for bugs and security issues
---
```

Nếu `description` bị bỏ trống, Pi lấy **dòng non-empty đầu tiên** của body, truncate ở 60 ký tự.

> **Lưu ý:** Hiện tại `description` là field duy nhất được Pi xử lý. Các fields khác bị bỏ qua nhưng không gây lỗi.

---

## 6. Cách Sử Dụng

### Gọi template

Gõ `/` trong editor của Pi, autocomplete sẽ hiển thị danh sách templates với descriptions:

```
/review                              # Expand review.md
/component Button                    # Expand với 1 argument
/component Button "click handler"    # Expand với 2 arguments
/test UserService "unit test"        # Expand với arguments
```

### Autocomplete

Khi bạn gõ `/`, Pi hiển thị:

```
/review          Review staged git changes (user)
/component       Create a React component (user)
/api-route       Create REST API endpoint (project)
/test            Generate test cases (project)
```

- `(user)` = global template từ `~/.pi/agent/prompts/`
- `(project)` = project template từ `.pi/prompts/`
- `(path:name)` = template từ explicit path

---

## 7. Arguments — Hệ Thống Tham Số

Templates hỗ trợ **positional arguments** và **slicing** theo bash-style.

### 7.1 Positional Arguments

`$1`, `$2`, `$3`, ... — tham chiếu đến argument theo vị trí (1-indexed).

**Template:** `create-file.md`
```markdown
---
description: Create a new file
---
Create a file named $1 with the following content type: $2
```

**Gọi:**
```
/create-file utils.ts typescript
```

**Expand thành:**
```
Create a file named utils.ts with the following content type: typescript
```

> Nếu argument không tồn tại (ví dụ `$3` nhưng chỉ truyền 2 args), nó được thay bằng chuỗi rỗng `""`.

### 7.2 All Arguments

`$@` hoặc `$ARGUMENTS` — tất cả arguments nối lại bằng dấu cách.

**Template:** `component.md`
```markdown
---
description: Create a React component
---
Create a React component named $1 with features: $@
```

**Gọi:**
```
/component Button "onClick handler" "disabled support" "loading state"
```

**Expand thành:**
```
Create a React component named Button with features: onClick handler disabled support loading state
```

> `$ARGUMENTS` là syntax mới tương thích với Claude Code, Codex, OpenCode. `$@` vẫn hoạt động bình thường.

### 7.3 Slicing

`${@:N}` và `${@:N:L}` — lấy một phần arguments (bash-style slicing).

| Syntax | Ý nghĩa |
|--------|---------|
| `${@:N}` | Tất cả args từ vị trí thứ N trở đi (1-indexed) |
| `${@:N:L}` | L args bắt đầu từ vị trí N |

**Template:** `api-route.md`
```markdown
---
description: Create a REST API endpoint
---
Create a $2 endpoint at /api/$1 with requirements: ${@:3}
```

**Gọi:**
```
/api-route products POST "validation" "pagination" "auth"
```

**Expand thành:**
```
Create a POST endpoint at /api/products with requirements: validation pagination auth
```

**Ví dụ với `${@:N:L}`:**

```markdown
First two features: ${@:1:2}
Remaining features: ${@:3}
```

Với args `a b c d e`:
```
First two features: a b
Remaining features: c d e
```

### 7.4 Bash-style Quoting

Argument parsing tuân theo bash-style quoting:

```bash
# Dấu ngoặc kép — giữ nguyên spaces
/template "hello world" 'another phrase' simple-arg
# → args: ["hello world", "another phrase", "simple-arg"]

# Không quote — split bằng spaces/tabs
/template arg1 arg2 arg3
# → args: ["arg1", "arg2", "arg3"]

# Mix
/template Button "onClick handler" disabled
# → args: ["Button", "onClick handler", "disabled"]
```

### 7.5 Bảng Tổng Hợp

| Pattern | Ý nghĩa | Ví dụ (args: `a b c d`) |
|---------|---------|--------------------------|
| `$1` | Argument thứ 1 | `a` |
| `$2` | Argument thứ 2 | `b` |
| `$5` | Argument thứ 5 (không tồn tại) | `""` (rỗng) |
| `$@` | Tất cả args | `a b c d` |
| `$ARGUMENTS` | Tất cả args (alias) | `a b c d` |
| `${@:2}` | Args từ vị trí 2 | `b c d` |
| `${@:3}` | Args từ vị trí 3 | `c d` |
| `${@:1:2}` | 2 args từ vị trí 1 | `a b` |
| `${@:2:1}` | 1 arg từ vị trí 2 | `b` |

### Thứ tự xử lý substitution

1. `$1`, `$2`, ... (positional) — **xử lý trước** để tránh re-substitution
2. `${@:N}`, `${@:N:L}` (slicing) — xử lý trước `$@`
3. `$ARGUMENTS` — thay thế tất cả
4. `$@` — thay thế tất cả

> **Bảo mật:** Argument values chứa patterns như `$1`, `$@`, hay `$ARGUMENTS` **KHÔNG** bị recursive substitution. Chỉ template string gốc được xử lý.

---

## 8. Ví Dụ Thực Tế

### 8.1 Code Review

**File:** `~/.pi/agent/prompts/review.md`

```markdown
---
description: Review staged git changes for bugs, security, and style
---
Review the staged changes (`git diff --cached`). Focus on:

- Bugs and logic errors
- Security vulnerabilities
- Error handling gaps
- Performance issues
- Code style and readability

Provide specific line references and concrete suggestions for each issue found.
```

**Sử dụng:** `/review`

### 8.2 Tạo Component

**File:** `~/.pi/agent/prompts/component.md`

```markdown
---
description: Create a React component with specified features
---
Create a React component named `$1` with the following features:
$@

Requirements:
- Use TypeScript
- Follow existing component patterns in the codebase
- Include proper prop types
- Add basic error handling
- Write unit tests
```

**Sử dụng:** `/component UserCard "avatar display" "name truncation" "role badge"`

### 8.3 API Endpoint

**File:** `.pi/prompts/api-route.md`

```markdown
---
description: Create a REST API endpoint with validation
---
Create a $2 endpoint at `/api/$1`.

Requirements: ${@:3}

Follow the existing patterns in `src/routes/` for:
- Request validation (use Zod schemas)
- Error handling middleware
- Response format
- Authentication/authorization
```

**Sử dụng:** `/api-route products POST "input validation" "pagination" "auth required"`

### 8.4 Git Workflow

**File:** `~/.pi/agent/prompts/commit.md`

```markdown
---
description: Generate a conventional commit message for staged changes
---
Look at the staged changes (`git diff --cached`) and generate a conventional commit message.

Format: `<type>(<scope>): <description>`

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore

Rules:
- Description should be concise (max 72 chars)
- Use imperative mood ("add" not "added")
- Don't end with period
- Include body if changes are significant
```

**Sử dụng:** `/commit`

### 8.5 Documentation

**File:** `~/.pi/agent/prompts/doc.md`

```markdown
---
description: Generate documentation for a file or function
---
Generate comprehensive documentation for `$1`.

Include:
- Overview/purpose
- Parameters and return values (if applicable)
- Usage examples
- Edge cases and limitations

Style: ${@:2}
```

**Sử dụng:**
```
/doc src/auth/jwt.ts "JSDoc format" "include code examples"
```

### 8.6 Testing

**File:** `~/.pi/agent/prompts/test.md`

```markdown
---
description: Generate test cases for a module or function
---
Write $2 tests for `$1`.

Cover:
- Happy path scenarios
- Edge cases and boundary values
- Error handling
- ${@:3}

Follow the existing test patterns and conventions in the project.
Use the same testing framework already in use.
```

**Sử dụng:**
```
/test UserService "unit" "concurrent access" "invalid input"
```

### 8.7 Refactoring

**File:** `~/.pi/agent/prompts/refactor.md`

```markdown
---
description: Refactor code with specific focus
---
Refactor `$1` with focus on: ${@:2}

Guidelines:
- Keep the same external API/behavior
- Improve readability and maintainability
- Add comments only where logic is non-obvious
- Run existing tests to verify no regressions
```

**Sử dụng:**
```
/refactor src/utils/parser.ts "reduce complexity" "extract helpers" "add types"
```

### 8.8 Debug

**File:** `~/.pi/agent/prompts/debug.md`

```markdown
---
description: Systematic debugging of an issue
---
Debug the following issue: $@

Steps:
1. Read the relevant source files
2. Identify potential root causes
3. Add targeted logging or inspection
4. Propose a fix with explanation
5. Verify the fix doesn't introduce regressions

Show your reasoning at each step.
```

**Sử dụng:**
```
/debug "UserService.getById returns null for valid IDs after migration"
```

---

## 9. So Sánh: Templates vs Skills vs Extensions

| Đặc điểm | Prompt Templates | Skills | Extensions |
|-----------|-----------------|--------|------------|
| **Là gì** | Markdown text snippets | Markdown capability packages | TypeScript modules |
| **Mục đích** | Tái sử dụng prompt | Workflow + scripts phức tạp | Mở rộng Pi toàn diện |
| **Kích hoạt** | User gõ `/name` | Agent tự load hoặc `/skill:name` | Auto-load khi startup |
| **Arguments** | `$1`, `$@`, slicing | Không | N/A |
| **Có script?** | Không | Có (bash, js, etc.) | Có (TypeScript) |
| **Trong context LLM?** | Expand thành user message | Load vào context khi cần | Không trực tiếp |
| **Độ phức tạp** | ⭐ Thấp | ⭐⭐ Trung bình | ⭐⭐⭐ Cao |
| **File** | `*.md` trong `prompts/` | `SKILL.md` trong `skills/` | `*.ts` trong `extensions/` |

### Khi nào dùng gì?

| Tình huống | Dùng |
|------------|------|
| Prompt lặp đi lặp lại đơn giản | **Prompt Template** |
| Cần scripts, setup steps, reference docs | **Skill** |
| Cần tools, events, UI, providers | **Extension** |
| Chia sẻ prompt cho team | **Prompt Template** (trong `.pi/prompts/`) |
| Workflow phức tạp nhiều bước | **Skill** |
| Tùy chỉnh behavior của Pi | **Extension** |

---

## 10. Tích Hợp Với Hệ Thống Pi

### 10.1 Packages

Prompt templates có thể bundle trong Pi packages để chia sẻ qua npm/git:

```json
{
  "name": "my-pi-prompts",
  "keywords": ["pi-package"],
  "pi": {
    "prompts": ["./prompts"]
  }
}
```

```
my-pi-prompts/
├── package.json
└── prompts/
    ├── review.md
    ├── component.md
    └── test.md
```

**Cài đặt:**

```bash
pi install npm:my-pi-prompts
pi install git:github.com/user/my-pi-prompts
```

Không có `pi` manifest → Pi auto-discover từ `prompts/` directory.

### 10.2 Settings

Thêm template paths qua `settings.json`:

**Global** (`~/.pi/agent/settings.json`):

```json
{
  "prompts": [
    "/path/to/extra/prompts",
    "/path/to/specific/template.md"
  ]
}
```

**Project** (`.pi/settings.json`):

```json
{
  "prompts": [
    "../shared-prompts",
    "./custom-prompts/deploy.md"
  ]
}
```

Paths có thể là **thư mục** (scan `*.md`) hoặc **file cụ thể** (`.md`).

### 10.3 Extensions

Extensions có thể tương tác với prompt templates qua events:

```typescript
// Intercept template expansion trong input event
pi.on("input", async (event, ctx) => {
  // event.text chứa raw input (trước template expansion)
  // Template expansion xảy ra SAU input event

  if (event.text.startsWith("/review")) {
    // Có thể transform trước khi template expand
    return { action: "transform", text: event.text + " --strict" };
  }

  return { action: "continue" };
});
```

Extensions cũng có thể **đăng ký commands** trùng tên template — command ưu tiên hơn:

```typescript
// Extension command "/review" sẽ override template "review.md"
pi.registerCommand("review", {
  description: "Enhanced review with custom logic",
  handler: async (args, ctx) => {
    // Custom logic thay vì template expansion
  },
});
```

**Thứ tự ưu tiên:**
1. Extension commands → **cao nhất**
2. Prompt templates
3. Skill commands (`/skill:name`)

### Dùng templates từ các coding agents khác

Pi có thể load skills/prompts từ Claude Code, OpenAI Codex:

```json
{
  "skills": ["~/.claude/skills"],
  "prompts": ["~/.claude/prompts"]
}
```

---

## 11. Loading Rules & Discovery

### Quy tắc scan

- Template discovery trong `prompts/` là **non-recursive** (chỉ scan file `.md` ở cấp thư mục, không đệ quy vào subdirectories)
- Nếu muốn templates trong subdirectories, thêm chúng qua `prompts` settings hoặc package manifest
- Symlinks được hỗ trợ (resolve trước khi đọc)
- File không phải `.md` bị bỏ qua

### Thứ tự load

```
1. Global:  ~/.pi/agent/prompts/*.md     → source: "user"
2. Project: .pi/prompts/*.md             → source: "project"
3. Packages: pi.prompts từ package.json  → source theo package
4. Settings: "prompts" array             → source: "path"
5. CLI: --prompt-template <path>         → source: "path"
```

### Xử lý trùng tên

Khi nhiều templates có cùng tên (ví dụ global `review.md` và project `review.md`), **tất cả đều load** nhưng autocomplete hiển thị source label (`(user)`, `(project)`, `(path:name)`) để phân biệt.

### Source labels

| Label | Nguồn |
|-------|-------|
| `(user)` | Global: `~/.pi/agent/prompts/` |
| `(project)` | Project: `.pi/prompts/` |
| `(path:name)` | Explicit path từ settings/CLI |

---

## 12. Tips & Best Practices

### Naming

- Dùng tên ngắn, dễ nhớ: `review`, `test`, `doc`, `commit`
- Dùng hyphens cho multi-word: `api-route`, `code-review`, `quick-fix`
- Tránh xung đột với Pi commands built-in: `/model`, `/settings`, `/tree`, etc.
- Tránh xung đột với extension commands đã đăng ký

### Description

- Luôn viết `description` trong frontmatter — giúp autocomplete hữu ích hơn
- Mô tả **khi nào dùng**, không chỉ nó làm gì
- Ngắn gọn, < 80 chars

```yaml
# Tốt
description: Review staged git changes for bugs and security issues

# Kém
description: A template for doing reviews
```

### Content

- Cụ thể và actionable — LLM hoạt động tốt hơn với instructions rõ ràng
- Đề cập files/paths liên quan nếu project-specific
- Dùng Markdown formatting (lists, code blocks, headings) cho clarity
- Kết thúc bằng kỳ vọng output nếu cần

### Arguments

- Dùng `$1` cho argument quan trọng nhất
- Dùng `$@` hoặc `${@:2}` cho phần linh hoạt/optional
- Document arguments trong description hoặc đầu template:

```markdown
---
description: Create component ($1=name, rest=features)
---
Create a component named `$1` with features: ${@:2}
```

### Tổ chức

```
# Global — dùng cho mọi project
~/.pi/agent/prompts/
├── review.md       # Code review chung
├── commit.md       # Commit message
├── explain.md      # Giải thích code
└── debug.md        # Debug systematic

# Project — chỉ project này
.pi/prompts/
├── api-route.md    # Tạo API route (project-specific patterns)
├── migration.md    # DB migration
└── deploy.md       # Deploy checklist
```

### Team sharing

Đặt `.pi/prompts/` vào git để cả team dùng chung:

```bash
# .gitignore — KHÔNG ignore .pi/prompts/
.pi/sessions/       # Ignore sessions
# .pi/prompts/      # KHÔNG ignore — share với team
```

### Test templates

```bash
# Test nhanh một template
pi --prompt-template ./my-template.md

# Dùng print mode để test expansion
pi -p "/my-template arg1 arg2"
```

---

## Tham Khảo

- **Docs chính thức:** [prompt-templates.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)
- **Source code:** [prompt-templates.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/prompt-templates.ts)
- **Skills docs:** [skills.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- **Packages docs:** [packages.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- **Settings docs:** [settings.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)
