# 🧠 Pi Skills — Hướng Dẫn Chi Tiết

> Tham khảo từ [packages/coding-agent/docs/skills.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)  
> Chuẩn mở: [Agent Skills Specification](https://agentskills.io/specification)  
> Pi có thể tự tạo skills — hãy nhờ nó build cho use case của bạn!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Cách Hoạt Động — Progressive Disclosure](#2-cách-hoạt-động--progressive-disclosure)
- [3. Vị Trí Đặt Skills](#3-vị-trí-đặt-skills)
- [4. Cấu Trúc Skill](#4-cấu-trúc-skill)
  - [4.1 Directory Layout](#41-directory-layout)
  - [4.2 SKILL.md Format](#42-skillmd-format)
  - [4.3 Optional Directories](#43-optional-directories)
- [5. Frontmatter — Metadata Bắt Buộc](#5-frontmatter--metadata-bắt-buộc)
  - [5.1 `name` field](#51-name-field)
  - [5.2 `description` field](#52-description-field)
  - [5.3 Optional fields](#53-optional-fields)
- [6. Body Content — Viết Instructions](#6-body-content--viết-instructions)
- [7. Sử Dụng Skills](#7-sử-dụng-skills)
  - [7.1 Agent tự load](#71-agent-tự-load)
  - [7.2 Skill commands (`/skill:name`)](#72-skill-commands-skillname)
  - [7.3 Trong system prompt](#73-trong-system-prompt)
- [8. Discovery Rules](#8-discovery-rules)
- [9. Validation](#9-validation)
- [10. Ví Dụ Thực Tế](#10-ví-dụ-thực-tế)
  - [10.1 Brave Search — Web search API](#101-brave-search--web-search-api)
  - [10.2 Browser Tools — Chrome automation](#102-browser-tools--chrome-automation)
  - [10.3 YouTube Transcript](#103-youtube-transcript)
  - [10.4 Custom: Database Migration](#104-custom-database-migration)
  - [10.5 Custom: API Testing](#105-custom-api-testing)
  - [10.6 Custom: Docker Deploy](#106-custom-docker-deploy)
- [11. So Sánh: Skills vs Prompt Templates vs Extensions](#11-so-sánh-skills-vs-prompt-templates-vs-extensions)
- [12. Tích Hợp Với Extensions](#12-tích-hợp-với-extensions)
- [13. Chia Sẻ Qua Packages](#13-chia-sẻ-qua-packages)
- [14. Skills Từ Các Agent Khác](#14-skills-từ-các-agent-khác)
- [15. Skill Repositories](#15-skill-repositories)
- [16. Tips & Best Practices](#16-tips--best-practices)

---

## 1. Tổng Quan

**Skills** là các capability packages mà agent load **on-demand**. Mỗi skill cung cấp:

- 📋 **Workflow instructions** — Hướng dẫn từng bước
- 🛠️ **Helper scripts** — Bash, JavaScript, Python scripts
- 📖 **Reference docs** — Tài liệu chi tiết load khi cần
- 📦 **Assets** — Templates, schemas, data files

Pi implement [Agent Skills standard](https://agentskills.io/specification) — chuẩn mở, cross-agent, do Anthropic khởi xướng.

### Tại sao cần Skills?

| Vấn đề | Giải pháp |
|--------|-----------|
| LLM không biết cách dùng tool/API cụ thể | Skill cung cấp instructions chi tiết |
| Workflow phức tạp cần nhiều bước | Skill document step-by-step |
| Cần scripts hỗ trợ | Skill bundle scripts kèm theo |
| Context window có hạn | Progressive disclosure — chỉ load khi cần |
| Muốn chia sẻ capabilities | Skill là self-contained, portable |

---

## 2. Cách Hoạt Động — Progressive Disclosure

Skills dùng mô hình **"mô tả trước, load sau"** để tiết kiệm context:

```
Startup (luôn trong context):
┌──────────────────────────────────────┐
│ <available_skills>                   │
│   <skill>                            │
│     <name>brave-search</name>        │  ← ~100 tokens/skill
│     <description>Web search...</>    │
│     <location>/path/to/SKILL.md</>   │
│   </skill>                           │
│   ...                                │
│ </available_skills>                  │
└──────────────────────────────────────┘
         ↓ Chỉ name + description

Khi task match (agent quyết định load):
┌──────────────────────────────────────┐
│ Agent dùng `read` tool               │
│ → Load toàn bộ SKILL.md             │  ← < 5000 tokens (khuyến nghị)
│ → Đọc instructions, setup, usage     │
└──────────────────────────────────────┘
         ↓ Full instructions

Khi cần chi tiết hơn:
┌──────────────────────────────────────┐
│ Agent đọc thêm files:               │
│ → references/api-reference.md        │  ← Load on-demand
│ → scripts/process.sh                 │
│ → assets/template.json               │
└──────────────────────────────────────┘
```

**Flow cụ thể:**

1. **Startup:** Pi scan tất cả skill locations, trích `name` + `description`
2. **System prompt:** Liệt kê available skills dạng XML
3. **Task match:** Agent nhận ra task phù hợp với skill → dùng `read` tool load full SKILL.md
4. **Execute:** Agent theo instructions, chạy scripts qua `bash`, đọc references khi cần

> **Lưu ý:** Models không phải lúc nào cũng tự load skills. Dùng prompting hoặc `/skill:name` để force load.

---

## 3. Vị Trí Đặt Skills

> ⚠️ **Security:** Skills có thể chỉ thị model thực hiện bất kỳ hành động nào và có thể chứa executable code. Review nội dung trước khi dùng.

### Auto-discovered locations

| Location | Scope |
|----------|-------|
| `~/.pi/agent/skills/` | **Global** — tất cả projects |
| `~/.agents/skills/` | **Global** — chuẩn cross-agent |
| `.pi/skills/` | **Project** — chỉ project hiện tại |
| `.agents/skills/` | **Project** — chuẩn cross-agent (scan từ cwd lên đến git root) |

### Qua cấu hình

| Cách | Ví dụ |
|------|-------|
| **Packages** | `skills/` directories hoặc `pi.skills` trong `package.json` |
| **Settings** | `"skills"` array trong `settings.json` |
| **CLI** | `--skill <path>` (repeatable, **additive** — vẫn load khi dùng `--no-skills`) |

### Ví dụ cấu trúc

```
~/.pi/agent/skills/
├── brave-search/
│   ├── SKILL.md
│   ├── search.js
│   └── content.js
├── browser-tools/
│   ├── SKILL.md
│   └── ...scripts
└── my-custom-skill/
    ├── SKILL.md
    └── scripts/
        └── run.sh

my-project/
├── .pi/skills/
│   ├── deploy/
│   │   ├── SKILL.md
│   │   └── scripts/deploy.sh
│   └── db-migration/
│       ├── SKILL.md
│       └── scripts/migrate.sh
└── .agents/skills/      ← Cross-agent skills
    └── code-review/
        └── SKILL.md
```

### Disable discovery

```bash
pi --no-skills                     # Tắt auto-discovery
pi --no-skills --skill ./my-skill  # Tắt discovery nhưng vẫn load explicit path
```

---

## 4. Cấu Trúc Skill

### 4.1 Directory Layout

Mỗi skill là **một thư mục** chứa `SKILL.md`. Phần còn lại hoàn toàn tự do:

```
my-skill/
├── SKILL.md              # Bắt buộc: frontmatter + instructions
├── scripts/              # Optional: executable code
│   ├── process.sh
│   └── analyze.py
├── references/           # Optional: docs chi tiết load on-demand
│   ├── api-reference.md
│   └── troubleshooting.md
├── assets/               # Optional: templates, resources
│   ├── template.json
│   └── schema.yaml
├── package.json          # Optional: nếu cần npm dependencies
└── README.md             # Optional: docs cho con người
```

### 4.2 SKILL.md Format

~~~markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific about triggers.
---

# My Skill

## Setup

Run once before first use:
```bash
cd {baseDir}
npm install
```

## Usage

```bash
{baseDir}/scripts/process.sh <input>
```

## When to Use

- Scenario A
- Scenario B
~~~

**Quy tắc:**
- `SKILL.md` phải đặt **trong thư mục con** (không phải root `skills/`)
- Tên thư mục **phải match** field `name` trong frontmatter
- Dùng **relative paths** từ skill directory (hoặc `{baseDir}` placeholder)

### 4.3 Optional Directories

#### `scripts/`

Chứa executable code mà agent chạy qua `bash` tool.

```
scripts/
├── search.js      # Node.js script
├── process.sh     # Bash script
└── analyze.py     # Python script
```

**Best practices cho scripts:**
- Self-contained hoặc document dependencies rõ ràng
- Error messages hữu ích
- Handle edge cases
- Hỗ trợ: Python, Bash, JavaScript (tùy môi trường)

#### `references/`

Docs chi tiết mà agent đọc **khi cần**:

```
references/
├── REFERENCE.md           # Technical reference
├── api-reference.md       # API docs
├── troubleshooting.md     # Common issues
└── examples.md            # Usage examples
```

**Giữ files nhỏ và focused** — agent load on-demand, files nhỏ = ít context hơn.

#### `assets/`

Static resources:

```
assets/
├── template.json          # Document templates
├── config-schema.yaml     # Configuration schemas
└── sample-data.csv        # Sample data
```

---

## 5. Frontmatter — Metadata Bắt Buộc

### 5.1 `name` field

| Quy tắc | Chi tiết |
|---------|---------|
| **Required** | Yes |
| **Max length** | 64 characters |
| **Allowed chars** | Lowercase `a-z`, digits `0-9`, hyphens `-` |
| **No leading/trailing** | Không bắt đầu/kết thúc bằng `-` |
| **No consecutive** | Không có `--` |
| **Match directory** | Phải khớp tên thư mục cha |

**Valid:**

```yaml
name: pdf-processing
name: data-analysis
name: code-review
name: brave-search
```

**Invalid:**

```yaml
name: PDF-Processing      # ❌ Uppercase
name: -pdf                 # ❌ Bắt đầu bằng hyphen
name: pdf--processing      # ❌ Consecutive hyphens
name: my_skill             # ❌ Underscore
name: a-very-very-very-long-skill-name-that-exceeds-sixty-four-characters-limit  # ❌ > 64 chars
```

### 5.2 `description` field

| Quy tắc | Chi tiết |
|---------|---------|
| **Required** | Yes — **skill không có description sẽ KHÔNG được load** |
| **Max length** | 1024 characters |
| **Nội dung** | Mô tả skill làm gì + khi nào nên dùng |

**Description quyết định khi nào agent load skill.** Viết cụ thể!

**Tốt:**

```yaml
description: >
  Extracts text and tables from PDF files, fills PDF forms, and merges
  multiple PDFs. Use when working with PDF documents or when the user
  mentions PDFs, forms, or document extraction.
```

```yaml
description: >
  Web search and content extraction via Brave Search API. Use for searching
  documentation, facts, or any web content. Lightweight, no browser required.
```

```yaml
description: >
  Interactive browser automation via Chrome DevTools Protocol. Use when you
  need to interact with web pages, test frontends, or when user interaction
  with a visible browser is required.
```

**Kém:**

```yaml
description: Helps with PDFs.           # ❌ Quá chung
description: A useful tool.             # ❌ Không mô tả gì
description: Search stuff.              # ❌ Không nói khi nào dùng
```

### 5.3 Optional fields

| Field | Mô tả | Ví dụ |
|-------|--------|-------|
| `license` | License name hoặc reference đến file | `Apache-2.0` |
| `compatibility` | Yêu cầu môi trường (max 500 chars) | `Requires Python 3.14+ and uv` |
| `metadata` | Arbitrary key-value mapping | `author: example-org` |
| `allowed-tools` | Pre-approved tools (experimental) | `Bash(git:*) Read` |
| `disable-model-invocation` | Ẩn khỏi system prompt | `true` |

**Ví dụ đầy đủ:**

```yaml
---
name: pdf-processing
description: >
  Extract PDF text, fill forms, merge files. Use when handling PDFs.
license: Apache-2.0
compatibility: Requires Python 3.10+ and poppler-utils
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(python:*) Read
---
```

#### `disable-model-invocation`

Khi `true`, skill bị **ẩn khỏi system prompt** — agent không tự động load được. User phải dùng `/skill:name` manually.

```yaml
---
name: dangerous-ops
description: Dangerous system operations. Manual invocation only.
disable-model-invocation: true
---
```

---

## 6. Body Content — Viết Instructions

Phần Markdown sau frontmatter chứa instructions cho agent. Không có format bắt buộc — viết gì giúp agent hoàn thành task hiệu quả nhất.

### Cấu trúc khuyến nghị

~~~markdown
---
name: my-skill
description: ...
---

# Skill Name

Tóm tắt ngắn về skill.

## Setup

Hướng dẫn cài đặt (chạy 1 lần):
```bash
cd {baseDir}
npm install
```

## Usage

Cách sử dụng chính:
```bash
{baseDir}/scripts/main.sh <input>
```

### Options
- `--flag1` - Mô tả
- `--flag2` - Mô tả

## Output Format

Mô tả output format.

## When to Use

- Scenario cụ thể 1
- Scenario cụ thể 2

## Common Issues

- Lỗi X → Giải pháp Y
~~~

### File references — Relative paths

Dùng relative paths từ skill directory:

```markdown
See [the reference guide](references/REFERENCE.md) for details.
Run: `scripts/extract.py input.pdf`
```

Hoặc dùng `{baseDir}` placeholder (Pi resolve tự động):

~~~markdown
```bash
{baseDir}/scripts/search.js "query"
{baseDir}/content.js https://example.com
```
~~~

### Sizing guidelines

| Phần | Tokens khuyến nghị |
|------|-------------------|
| Frontmatter (name + description) | ~100 tokens |
| SKILL.md body | < 5000 tokens (~500 lines) |
| Reference files | Load on-demand, giữ nhỏ |

> **Giữ SKILL.md dưới 500 lines.** Di chuyển reference material chi tiết sang files riêng trong `references/`.

---

## 7. Sử Dụng Skills

### 7.1 Agent tự load

Khi user đưa task phù hợp, agent **tự động nhận ra** và dùng `read` tool load SKILL.md:

```
User: "Search the web for React 19 release notes"
Agent: (nhận ra brave-search skill match)
       → read /path/to/brave-search/SKILL.md
       → bash: /path/to/brave-search/search.js "React 19 release notes" --content
```

> Models không phải lúc nào cũng tự load. Nếu cần force, dùng `/skill:name` hoặc prompting.

### 7.2 Skill commands (`/skill:name`)

Gõ trực tiếp trong editor:

```
/skill:brave-search                    # Load và execute skill
/skill:brave-search "React 19 docs"   # Load với arguments
/skill:pdf-tools extract              # Load với arguments
```

Arguments sau command được append vào skill content dưới dạng `User: <args>`.

**Bật/tắt skill commands:**

```json
// settings.json
{
  "enableSkillCommands": true
}
```

Hoặc toggle qua `/settings` trong interactive mode.

### 7.3 Trong system prompt

Pi format skills thành XML trong system prompt:

```xml
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.

<available_skills>
  <skill>
    <name>brave-search</name>
    <description>Web search and content extraction via Brave Search API...</description>
    <location>/home/user/.pi/agent/skills/brave-search/SKILL.md</location>
  </skill>
  <skill>
    <name>browser-tools</name>
    <description>Interactive browser automation via Chrome DevTools Protocol...</description>
    <location>/home/user/.pi/agent/skills/browser-tools/SKILL.md</location>
  </skill>
</available_skills>
```

Skills với `disable-model-invocation: true` bị **loại khỏi** danh sách này.

---

## 8. Discovery Rules

### Cách Pi scan skills

```
skills/
├── web-search.md           ← ✅ Direct .md file ở root → loaded
├── brave-search/
│   └── SKILL.md            ← ✅ Recursive SKILL.md → loaded
├── browser-tools/
│   └── SKILL.md            ← ✅ Recursive SKILL.md → loaded
├── nested/
│   └── deep/
│       └── SKILL.md        ← ✅ Recursive SKILL.md → loaded
├── data/
│   └── helpers.md          ← ❌ .md nhưng KHÔNG ở root, KHÔNG tên SKILL.md → bỏ qua
├── .hidden-skill/
│   └── SKILL.md            ← ❌ Thư mục bắt đầu bằng . → bỏ qua
└── node_modules/
    └── some-skill/
        └── SKILL.md        ← ❌ node_modules → bỏ qua
```

**Quy tắc:**
1. **Direct `.md` files** ở root của skills directory → loaded
2. **`SKILL.md` files** trong subdirectories → loaded (đệ quy)
3. Bỏ qua: thư mục bắt đầu `.`, `node_modules`
4. Respects `.gitignore`, `.ignore`, `.fdignore`
5. Symlinks được follow

### Thứ tự load & deduplication

```
1. Global:  ~/.pi/agent/skills/      → source: "user"
2. Global:  ~/.agents/skills/        → source: "user"  
3. Project: .pi/skills/              → source: "project"
4. Project: .agents/skills/ (lên đến git root)
5. Packages: pi.skills từ package.json
6. Settings: "skills" array
7. CLI: --skill <path>
```

**Name collisions:** Nếu nhiều skills cùng tên, **skill đầu tiên** được giữ, những cái sau bị warning.

---

## 9. Validation

Pi validate skills theo Agent Skills standard. Hầu hết issues tạo **warnings** nhưng vẫn load skill:

| Issue | Severity |
|-------|----------|
| Name không match thư mục cha | ⚠️ Warning — vẫn load |
| Name > 64 chars | ⚠️ Warning — vẫn load |
| Name chứa invalid chars | ⚠️ Warning — vẫn load |
| Name bắt đầu/kết thúc bằng hyphen | ⚠️ Warning — vẫn load |
| Name chứa consecutive hyphens | ⚠️ Warning — vẫn load |
| Description > 1024 chars | ⚠️ Warning — vẫn load |
| **Description missing/empty** | ❌ **KHÔNG load** |
| Unknown frontmatter fields | Bỏ qua (không lỗi) |
| Name collision (trùng tên) | ⚠️ Warning — giữ cái đầu |

> **Chỉ có 1 trường hợp skill không được load:** `description` bị thiếu hoặc rỗng.

---

## 10. Ví Dụ Thực Tế

### 10.1 Brave Search — Web search API

```
brave-search/
├── SKILL.md
├── search.js
├── content.js
├── package.json
└── package-lock.json
```

**SKILL.md:**

~~~markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content. Lightweight, no browser required.
---

# Brave Search

Web search and content extraction using the official Brave Search API.

## Setup

1. Create account at https://api-dashboard.search.brave.com/register
2. Create "Free AI" subscription
3. Create API key
4. Add to shell profile:
   ```bash
   export BRAVE_API_KEY="your-api-key-here"
   ```
5. Install dependencies:
   ```bash
   cd {baseDir} && npm install
   ```

## Search

```bash
{baseDir}/search.js "query"                # Basic search (5 results)
{baseDir}/search.js "query" -n 10          # More results (max 20)
{baseDir}/search.js "query" --content      # Include page content
{baseDir}/search.js "query" --freshness pw # Past week only
```

### Options

- `-n <num>` - Number of results (default: 5, max: 20)
- `--content` - Fetch and include page content as markdown
- `--country <code>` - Two-letter country code (default: US)
- `--freshness <period>` - `pd` (day), `pw` (week), `pm` (month), `py` (year)

## Extract Page Content

```bash
{baseDir}/content.js https://example.com/article
```

## When to Use

- Searching for documentation or API references
- Looking up facts or current information
- Fetching content from specific URLs
~~~

### 10.2 Browser Tools — Chrome automation

```
browser-tools/
├── SKILL.md
├── browser-start.js
├── browser-nav.js
├── browser-eval.js
├── browser-screenshot.js
├── browser-pick.js
├── browser-cookies.js
├── browser-content.js
├── package.json
└── package-lock.json
```

**SKILL.md (tóm tắt):**

~~~markdown
---
name: browser-tools
description: Interactive browser automation via Chrome DevTools Protocol. Use when you need to interact with web pages, test frontends, or when user interaction with a visible browser is required.
---

# Browser Tools

## Setup
```bash
cd {baseDir} && npm install
```

## Start Chrome
```bash
{baseDir}/browser-start.js              # Fresh profile
{baseDir}/browser-start.js --profile    # With user cookies
```

## Navigate
```bash
{baseDir}/browser-nav.js https://example.com
```

## Evaluate JavaScript
```bash
{baseDir}/browser-eval.js 'document.title'
```

## Screenshot
```bash
{baseDir}/browser-screenshot.js
```

## Pick Elements (interactive)
```bash
{baseDir}/browser-pick.js "Click the submit button"
```
~~~

### 10.3 YouTube Transcript

```
youtube-transcript/
├── SKILL.md
├── transcript.js
└── package.json
```

**SKILL.md:**

~~~markdown
---
name: youtube-transcript
description: Fetch transcripts from YouTube videos for summarization and analysis.
---

# YouTube Transcript

## Setup
```bash
cd {baseDir} && npm install
```

## Usage
```bash
{baseDir}/transcript.js <video-id-or-url>
```

Accepts: `EBw7gsDPAYQ`, `https://www.youtube.com/watch?v=...`, `https://youtu.be/...`

## Notes
- Requires video to have captions/transcripts available
- Works with auto-generated and manual transcripts
~~~

### 10.4 Custom: Database Migration

```
db-migration/
├── SKILL.md
├── scripts/
│   ├── create-migration.sh
│   ├── run-migration.sh
│   └── rollback.sh
└── references/
    └── naming-conventions.md
```

**SKILL.md:**

~~~markdown
---
name: db-migration
description: Create and manage database migrations using Prisma. Use when user wants to modify database schema, create migrations, or handle database changes.
---

# Database Migration

## Create Migration

```bash
{baseDir}/scripts/create-migration.sh "migration_name"
```

This will:
1. Generate migration SQL from schema changes
2. Apply to development database
3. Update Prisma client

## Run Pending Migrations

```bash
{baseDir}/scripts/run-migration.sh
```

## Rollback

```bash
{baseDir}/scripts/rollback.sh [steps]
```

## Naming Convention

See [naming conventions](references/naming-conventions.md) for migration naming rules.

## When to Use

- Adding/removing database tables or columns
- Changing column types or constraints
- Creating indexes
- User mentions "migration", "schema change", "database update"
~~~

### 10.5 Custom: API Testing

```
api-testing/
├── SKILL.md
└── scripts/
    ├── test-endpoint.sh
    └── load-test.sh
```

**SKILL.md:**

~~~markdown
---
name: api-testing
description: Test REST API endpoints with curl and generate load tests. Use when user wants to test APIs, check endpoints, or perform load testing.
---

# API Testing

## Test Single Endpoint

```bash
{baseDir}/scripts/test-endpoint.sh <method> <url> [body]
```

Examples:
```bash
{baseDir}/scripts/test-endpoint.sh GET http://localhost:3000/api/users
{baseDir}/scripts/test-endpoint.sh POST http://localhost:3000/api/users '{"name":"Alice"}'
```

## Load Test

```bash
{baseDir}/scripts/load-test.sh <url> <requests> <concurrency>
```

Example:
```bash
{baseDir}/scripts/load-test.sh http://localhost:3000/api/health 1000 50
```
~~~

### 10.6 Custom: Docker Deploy

```
docker-deploy/
├── SKILL.md
├── scripts/
│   ├── build.sh
│   ├── deploy.sh
│   └── rollback.sh
└── assets/
    └── docker-compose.template.yml
```

**SKILL.md:**

~~~markdown
---
name: docker-deploy
description: Build Docker images and deploy to staging/production. Use when user wants to deploy, build containers, or manage Docker environments.
compatibility: Requires docker and docker-compose
---

# Docker Deploy

## Build

```bash
{baseDir}/scripts/build.sh <tag>
```

## Deploy

```bash
{baseDir}/scripts/deploy.sh <environment> <tag>
```

Environments: `staging`, `production`

## Rollback

```bash
{baseDir}/scripts/rollback.sh <environment> [steps]
```

## Docker Compose Template

See [template](assets/docker-compose.template.yml) for the base configuration.
~~~

---

## 11. So Sánh: Skills vs Prompt Templates vs Extensions

| Đặc điểm | Skills | Prompt Templates | Extensions |
|-----------|--------|-----------------|------------|
| **Là gì** | Capability packages | Text snippets | TypeScript modules |
| **File chính** | `SKILL.md` | `*.md` | `*.ts` |
| **Khi nào load** | On-demand (agent/user quyết định) | Ngay khi gõ `/name` | Startup |
| **Có scripts** | ✅ Bash, JS, Python | ❌ | ✅ TypeScript |
| **Có references** | ✅ Docs on-demand | ❌ | ❌ |
| **Arguments** | Qua `/skill:name args` | `$1`, `$@`, slicing | N/A |
| **Progressive disclosure** | ✅ Description → SKILL.md → refs | ❌ Full expand ngay | ❌ |
| **Custom tools** | ❌ Dùng built-in tools | ❌ | ✅ `registerTool()` |
| **Custom UI** | ❌ | ❌ | ✅ TUI components |
| **Events** | ❌ | ❌ | ✅ Full lifecycle |
| **Độ phức tạp** | ⭐⭐ | ⭐ | ⭐⭐⭐ |
| **Chuẩn mở** | ✅ agentskills.io | ❌ Pi-specific | ❌ Pi-specific |

### Khi nào dùng gì?

```
Prompt đơn giản lặp lại        → Prompt Template
Workflow + scripts + docs       → Skill
Custom tools/UI/events/providers → Extension
```

---

## 12. Tích Hợp Với Extensions

Extensions có thể tương tác với skills qua events:

```typescript
// Intercept trước khi skill expand
pi.on("input", async (event, ctx) => {
  if (event.text.startsWith("/skill:")) {
    // Transform, block, hoặc let pass through
  }
  return { action: "continue" };
});

// Dynamic resources (skills qua extension)
pi.on("resources_discover", async (event, ctx) => {
  // Extension có thể provide dynamic skills
});
```

Extensions cũng có thể load dynamic skills thông qua `dynamic-resources` pattern — xem [examples/extensions/dynamic-resources/](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/dynamic-resources).

---

## 12.1 Đăng Ký Skill Lúc Runtime

Pi **không có** `pi.registerSkill()` API trực tiếp. Skills được discover từ filesystem locations khi startup. Tuy nhiên có hai cách để thêm skill động lúc runtime:

### Cách 1 — `resources_discover` event (cách chính thức)

Viết extension, hook vào event `resources_discover` để inject skills động:

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", async (event, ctx) => {
    // Trả về danh sách skills động tại đây
    // Xem pattern đầy đủ: examples/extensions/dynamic-resources/
  });
}
```

### Cách 2 — `registerTool()` (nếu chỉ cần thêm capability)

Nếu mục tiêu là thêm **capability cho LLM gọi** (không cần SKILL.md + scripts), dùng `pi.registerTool()` — hoạt động bất kỳ lúc nào, kể cả trong event handlers, không cần `/reload`:

```typescript
export default function (pi: ExtensionAPI) {
  // Có thể gọi ngay khi load, hoặc trong bất kỳ event handler nào
  pi.registerTool({
    name: "my_tool",
    description: "...",
    parameters: Type.Object({ ... }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return { content: [{ type: "text", text: "..." }], details: {} };
    },
  });
}
```

Xem example: `examples/extensions/dynamic-tools.ts` — Register/unregister tools at runtime.

### So sánh hai cách

| | `resources_discover` | `registerTool()` |
|---|---|---|
| Kết quả | Skill SKILL.md-style (instructions + scripts) | Tool LLM gọi trực tiếp |
| Độ phức tạp | Cao hơn | Đơn giản |
| Hot-reload | Qua event | Ngay lập tức, không cần reload |
| Example | `dynamic-resources/` | `dynamic-tools.ts` |

> **Rule of thumb:** Cần workflow instructions + scripts → dùng `resources_discover`. Chỉ cần thêm function cho LLM gọi → dùng `registerTool()`.

---

## 13. Chia Sẻ Qua Packages

### Tạo package chứa skills

```
my-pi-skills/
├── package.json
└── skills/
    ├── web-search/
    │   ├── SKILL.md
    │   └── search.js
    └── pdf-tools/
        ├── SKILL.md
        └── scripts/
            └── extract.py
```

```json
{
  "name": "my-pi-skills",
  "keywords": ["pi-package"],
  "pi": {
    "skills": ["./skills"]
  }
}
```

### Cài đặt

```bash
pi install npm:my-pi-skills
pi install git:github.com/user/my-pi-skills
```

Không có `pi` manifest → Pi auto-discover từ `skills/` directory.

### Package filtering

```json
{
  "packages": [
    {
      "source": "npm:mega-skills",
      "skills": ["skills/web-search"],
      "extensions": [],
      "prompts": []
    }
  ]
}
```

---

## 14. Skills Từ Các Agent Khác

Pi tương thích với skills từ Claude Code, OpenAI Codex nhờ chuẩn Agent Skills chung.

### Load Claude Code skills

**Global:**

```json
// ~/.pi/agent/settings.json
{
  "skills": ["~/.claude/skills"]
}
```

**Project:**

```json
// .pi/settings.json
{
  "skills": ["../.claude/skills"]
}
```

### Load Codex skills

```json
{
  "skills": ["~/.codex/skills"]
}
```

### Cross-agent locations

Thư mục `~/.agents/skills/` và `.agents/skills/` được Pi (và các agents khác) tự động scan — đây là convention chuẩn cross-agent.

---

## 15. Skill Repositories

### Pi Skills (Official)

**Repo:** [github.com/badlogic/pi-skills](https://github.com/badlogic/pi-skills)

| Skill | Mô tả |
|-------|--------|
| `brave-search` | Web search via Brave API |
| `browser-tools` | Chrome DevTools automation |
| `youtube-transcript` | YouTube transcript extraction |
| `transcribe` | Audio/video transcription |
| `vscode` | VS Code integration |
| `gccli` | Google Calendar CLI |
| `gdcli` | Google Drive CLI |
| `gmcli` | Gmail CLI |

**Cài đặt:**

```bash
pi install git:github.com/badlogic/pi-skills
```

### Anthropic Skills (Official)

**Repo:** [github.com/anthropics/skills](https://github.com/anthropics/skills)

| Skill | Mô tả |
|-------|--------|
| `pdf` | PDF text extraction, form filling, merging |
| `docx` | Word document processing |
| `xlsx` | Excel spreadsheet processing |
| `pptx` | PowerPoint processing |
| `frontend-design` | Frontend UI design |
| `web-artifacts-builder` | Web artifact creation |
| `webapp-testing` | Web app testing |
| `mcp-builder` | MCP server builder |
| `skill-creator` | Skill creation helper |
| `claude-api` | Claude API integration |
| `canvas-design` | Canvas design |
| `algorithmic-art` | Algorithmic art generation |
| `brand-guidelines` | Brand guidelines creation |
| `slack-gif-creator` | Slack GIF creation |
| `theme-factory` | Theme creation |
| `internal-comms` | Internal communications |
| `doc-coauthoring` | Document co-authoring |

**Cài đặt:**

```bash
pi install git:github.com/anthropics/skills
```

---

## 16. Tips & Best Practices

### Naming

- Tên ngắn, mô tả: `brave-search`, `db-migration`, `api-testing`
- Dùng hyphens: `pdf-processing` (không phải `pdf_processing`)
- Tên thư mục **phải match** `name` trong frontmatter

### Description — Quan trọng nhất

Description quyết định agent có load skill hay không. Viết cụ thể:

```yaml
# ✅ Tốt — cụ thể, nói rõ khi nào dùng
description: >
  Extract text and tables from PDF files, fill PDF forms, and merge
  multiple PDFs. Use when working with PDF documents.

# ❌ Kém — quá chung
description: PDF utilities.
```

**Checklist cho description:**
- ✅ Mô tả cụ thể skill làm gì
- ✅ Nói rõ khi nào nên dùng
- ✅ Bao gồm keywords mà user có thể dùng
- ✅ < 1024 characters

### SKILL.md Content

- **Cấu trúc rõ ràng:** Setup → Usage → Options → When to Use
- **Dưới 500 lines** — di chuyển chi tiết sang `references/`
- **Relative paths** — dùng `{baseDir}/scripts/...` cho portability
- **Ví dụ cụ thể** — agent hoạt động tốt hơn với examples
- **Setup section** — document rõ dependencies và one-time setup

### Scripts

- **Self-contained** hoặc document dependencies rõ ràng
- **Helpful error messages** — agent đọc stderr để debug
- **Handle edge cases** — input rỗng, file không tồn tại
- **Exit codes** — 0 = success, non-zero = error

### Testing

```bash
# Test skill load
pi --skill ./my-skill "Use my-skill to do X"

# Force load
/skill:my-skill

# Check discovery
pi --list-skills  # (nếu available)
```

### Tổ chức

```
# Global — capabilities dùng mọi nơi
~/.pi/agent/skills/
├── brave-search/     # Web search
├── browser-tools/    # Browser automation
└── transcribe/       # Audio transcription

# Project — workflows riêng project
.pi/skills/
├── db-migration/     # Database migrations
├── deploy/           # Deployment
└── e2e-test/         # E2E testing

# Cross-agent — share với Claude Code, Codex
.agents/skills/
└── code-review/      # Code review workflow
```

### Security

- ⚠️ Review SKILL.md và scripts trước khi dùng third-party skills
- ⚠️ Skills có thể chỉ thị agent chạy bất kỳ lệnh nào
- ⚠️ Scripts có full system access
- 💡 Dùng `disable-model-invocation: true` cho skills nguy hiểm

---

## Tham Khảo

- **Docs chính thức:** [skills.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- **Source code:** [skills.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/skills.ts)
- **Agent Skills spec:** [agentskills.io/specification](https://agentskills.io/specification)
- **Pi Skills repo:** [github.com/badlogic/pi-skills](https://github.com/badlogic/pi-skills)
- **Anthropic Skills repo:** [github.com/anthropics/skills](https://github.com/anthropics/skills)
- **Packages docs:** [packages.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- **Progressive disclosure:** [agentskills.io](https://agentskills.io)
