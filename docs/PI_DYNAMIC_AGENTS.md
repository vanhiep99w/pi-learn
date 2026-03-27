# 🤖 Dynamic Agent Registry — Thiết Kế & Hướng Dẫn

> Mở rộng từ 4 agents cố định → registry động: orchestrator chủ động chọn đúng agent cho từng task, mỗi agent có skills riêng và load on-demand.

---

## Mục Lục

- [1. Vấn Đề Hiện Tại](#1-vấn-đề-hiện-tại)
- [2. Kiến Trúc Mới](#2-kiến-trúc-mới)
- [3. Agent Frontmatter Schema](#3-agent-frontmatter-schema)
- [4. Agent Registry — Cách Hoạt Động](#4-agent-registry--cách-hoạt-động)
- [5. Orchestrator Selection — Chọn Agent Thông Minh](#5-orchestrator-selection--chọn-agent-thông-minh)
- [6. Agent-Scoped Skills](#6-agent-scoped-skills)
- [7. Thêm Agent Mới](#7-thêm-agent-mới)
- [8. Ví Dụ Agents Chuyên Biệt](#8-ví-dụ-agents-chuyên-biệt)
- [9. Luồng Hoạt Động End-to-End](#9-luồng-hoạt-động-end-to-end)
- [10. Implementation Plan](#10-implementation-plan)

---

## 1. Vấn Đề Hiện Tại

4 agents cố định (scout → planner → worker → reviewer) không đủ khi:

| Tình huống | Vấn đề |
|-----------|--------|
| Task cần migrate database | Worker không biết Prisma patterns |
| Task cần phân tích data | Không có data analyst agent |
| Task cần viết docs | Worker cố gắng nhưng không chuyên |
| Task cần debug infra | Không có agent biết Docker/K8s |

**Giải pháp:** Dynamic agent registry — orchestrator thấy tất cả agents + tags → tự chọn đúng người.

---

## 2. Kiến Trúc Mới

```
harness/agents/
├── scout.md             ← Generalist: codebase exploration
├── planner.md           ← Generalist: implementation planning
├── worker.md            ← Generalist: full-stack implementation
├── reviewer.md          ← Generalist: code review
│
├── db-migrator.md       ← Specialist: database migrations
├── data-analyst.md      ← Specialist: data analysis & reports
├── doc-writer.md        ← Specialist: documentation
├── infra-agent.md       ← Specialist: Docker, CI/CD, infra
├── security-auditor.md  ← Specialist: security review
└── <your-agent>.md      ← Thêm bất kỳ lúc nào
```

```
harness/skills/
├── <skill-name>/
│   └── SKILL.md
│
# Skills được tag cho agent — agent nào dùng skill nào
# Mỗi agent.md khai báo: skills: [skill-a, skill-b]
```

### Flow mới

```
User: /implement "Migrate users table to Postgres"
           │
           ▼
    Orchestrator đọc agent registry
    → Thấy: scout, planner, worker, db-migrator, ...
    → Task có từ khóa "migrate", "database"
    → Chọn: scout → db-migrator (thay vì worker thường)
           │
           ▼
    db-migrator nhận task
    → Thấy skills của mình: [prisma-workflow, sql-patterns, db-testing]
    → Load prisma-workflow SKILL.md (progressive disclosure)
    → Thực thi với đúng workflow
```

---

## 3. Agent Frontmatter Schema

### Schema đầy đủ

```yaml
---
# Bắt buộc
name: agent-name
description: >
  Mô tả chi tiết — khi nào dùng agent này, chuyên về gì.
  Orchestrator dùng description này để chọn agent.

# Tools & Model
tools: read, bash, edit, write, grep, find, ls
model: claude-sonnet-4-5          # hoặc claude-haiku-4-5
thinking: off | low | medium | high
max_turns: 60

# Phân loại (orchestrator dùng để filter)
type: generalist | specialist      # generalist = luôn available, specialist = chọn khi phù hợp
tags: [database, migration, prisma] # domain tags

# Skills của agent này (load on-demand)
skills:
  - prisma-workflow     # SKILL.md trong harness/skills/prisma-workflow/
  - sql-patterns
  - db-testing

# Constraints (optional)
tmux: true              # Cần tmux session
readonly: false         # true = KHÔNG được sửa file
requires:               # Prerequisites
  - tool: npx prisma
  - env: DATABASE_URL
---
```

### Quy tắc `description`

Description là **thứ orchestrator đọc để chọn agent**. Viết như mô tả capabilities:

```yaml
# Tốt ✅
description: >
  Specialist cho database operations — Prisma migrations, SQL queries, schema design.
  Dùng khi task liên quan: migrate, schema change, database, SQL, Prisma, seed data.

# Không tốt ❌
description: Database agent
```

---

## 4. Agent Registry — Cách Hoạt Động

### Discovery

Extension `harness-subagent` scan tất cả `.md` files trong `harness/agents/`:

```typescript
// harness-subagent/agent-registry.ts

export interface AgentMeta {
  name: string;
  description: string;
  type: "generalist" | "specialist";
  tags: string[];
  skills: string[];
  filePath: string;
}

export async function discoverAgents(agentsDir: string): Promise<AgentMeta[]> {
  const files = await glob(`${agentsDir}/*.md`);
  return files.map(f => {
    const { data } = matter(readFileSync(f, "utf-8"));
    return {
      name: data.name,
      description: data.description,
      type: data.type ?? "generalist",
      tags: data.tags ?? [],
      skills: data.skills ?? [],
      filePath: f,
    };
  });
}
```

### Inject vào Orchestrator

Khi `session_start`, registry được inject vào system prompt:

```xml
<available_agents>
  <agent>
    <name>scout</name>
    <type>generalist</type>
    <tags>exploration, codebase, context</tags>
    <description>Trinh sát codebase + task context, handoff cho agent khác</description>
  </agent>
  <agent>
    <name>db-migrator</name>
    <type>specialist</type>
    <tags>database, migration, prisma, sql</tags>
    <description>Specialist cho database operations — Prisma migrations, SQL queries...</description>
  </agent>
  ...
</available_agents>
```

**Lưu ý:** Chỉ inject `name` + `type` + `tags` + `description` (~100 tokens/agent). Full instructions chỉ load khi agent được spawn.

---

## 5. Orchestrator Selection — Chọn Agent Thông Minh

### Tool `subagent` — Cập nhật

Thêm `auto` mode và `tags` filter:

```typescript
parameters: Type.Object({
  taskId: Type.Optional(Type.String()),

  // Mode 1: Explicit — chỉ định agent cụ thể (như cũ)
  agent: Type.Optional(Type.String()),
  task: Type.Optional(Type.String()),

  // Mode 2: Auto — orchestrator tự chọn
  auto: Type.Optional(Type.Boolean()),

  // Mode 3: Tags — filter theo domain
  tags: Type.Optional(Type.Array(Type.String())),

  // Chain (sequential)
  chain: Type.Optional(Type.Array(Type.Object({
    agent: Type.String(),          // Tên cụ thể HOẶC "auto"
    task: Type.String(),
    tags: Type.Optional(Type.Array(Type.String())),
  }))),
})
```

### Selection Logic

Khi `auto: true` hoặc agent không được chỉ định:

```typescript
function selectAgent(task: string, registry: AgentMeta[]): AgentMeta {
  // 1. Nếu có tags filter → chỉ xem xét agents với matching tags
  // 2. Tìm specialist có tags match với task keywords
  // 3. Fallback về generalist phù hợp nhất (worker)

  // Trong practice: LLM đọc <available_agents> và tự chọn
  // Selection xảy ra trong LLM reasoning, không phải code
}
```

**Thực tế:** LLM orchestrator **đọc registry** và **tự quyết** — không cần hardcode selection logic. Đây là sức mạnh của approach này.

### Ví dụ LLM Selection

```
Task: "Migrate users table to add timezone column"

Orchestrator thấy agents:
- worker (generalist, tags: implementation)
- db-migrator (specialist, tags: database, migration, prisma)

→ Chọn: scout → db-migrator (không cần planner vì db-migrator đã có workflow)
```

```
Task: "Add OAuth login flow"

Orchestrator thấy agents:
- security-auditor (specialist, tags: security, auth, oauth)
- worker (generalist)

→ Chọn: scout → planner → worker → security-auditor (review security)
```

---

## 6. Agent-Scoped Skills

### Cách hoạt động

Mỗi agent có `skills` list trong frontmatter. Khi agent được spawn, nó nhận `<available_skills>` của riêng mình — không phải tất cả skills trong project.

```
Spawn db-migrator
    │
    ▼
harness-subagent inject:
┌──────────────────────────────────────┐
│ <available_skills>                   │
│   <skill>                            │
│     <name>prisma-workflow</name>     │
│     <description>Prisma migration... │
│     <location>harness/skills/...</>  │
│   </skill>                           │
│   <skill>                            │
│     <name>sql-patterns</name>        │
│     ...                              │
│   </skill>                           │
│ </available_skills>                  │
└──────────────────────────────────────┘
         ↓ Progressive disclosure

db-migrator nhận ra cần Prisma workflow
→ Dùng read tool load harness/skills/prisma-workflow/SKILL.md
→ Follow instructions trong skill
```

### Inject Skills vào Agent System Prompt

```typescript
// harness-subagent extension

async function buildAgentSystemPrompt(agentMeta: AgentMeta): Promise<string> {
  const skillLines: string[] = [];

  for (const skillName of agentMeta.skills) {
    const skillPath = findSkill(skillName);
    if (!skillPath) continue;

    const { data } = matter(readFileSync(skillPath, "utf-8"));
    skillLines.push(`
    <skill>
      <name>${skillName}</name>
      <description>${data.description}</description>
      <location>${skillPath}</location>
    </skill>`);
  }

  const skillsXml = skillLines.length > 0
    ? `<available_skills>\n${skillLines.join("\n")}\n</available_skills>`
    : "";

  const agentContent = readFileSync(agentMeta.filePath, "utf-8");
  // Frontmatter đã parse, chỉ lấy body (instructions)
  const { content: instructions } = matter(agentContent);

  return `${instructions}\n\n${skillsXml}`;
}
```

### Cấu Trúc Skills Directory

```
harness/skills/
├── prisma-workflow/
│   ├── SKILL.md          ← Instructions + workflow
│   └── scripts/
│       └── migrate.sh
├── sql-patterns/
│   └── SKILL.md
├── db-testing/
│   └── SKILL.md
├── docker-workflow/
│   └── SKILL.md
├── security-checklist/
│   └── SKILL.md
└── data-viz/
    ├── SKILL.md
    └── scripts/
        └── plot.py
```

---

## 7. Thêm Agent Mới

Chỉ cần tạo file `.md` trong `harness/agents/`. **Không cần sửa code.**

### Bước 1 — Tạo agent file

```bash
# Tạo file
touch harness/agents/my-specialist.md
```

### Bước 2 — Viết frontmatter + instructions

```yaml
---
name: my-specialist
description: >
  Chuyên gia về X — dùng khi task liên quan đến A, B, C.
  Ví dụ tasks phù hợp: "deploy to K8s", "write Terraform", "optimize Docker build".
type: specialist
tags: [X, A, B, C]
tools: read, bash, grep, find, ls
model: claude-sonnet-4-5
thinking: medium
max_turns: 40
skills:
  - skill-a
  - skill-b
---

Bạn là specialist agent cho X.

## Nguyên tắc
...

## Workflow
...

## Output format
...
```

### Bước 3 — Tạo skills (nếu cần)

```bash
mkdir -p harness/skills/skill-a
cat > harness/skills/skill-a/SKILL.md << 'EOF'
---
name: skill-a
description: Hướng dẫn làm X với tool Y
---

## Setup
...

## Workflow
...
EOF
```

### Bước 4 — Restart Pi

```bash
pi  # Registry auto-discover khi restart
```

Agent mới xuất hiện trong `<available_agents>` của orchestrator ngay lập tức.

---

## 8. Ví Dụ Agents Chuyên Biệt

### `db-migrator.md`

```yaml
---
name: db-migrator
description: >
  Specialist cho database operations: Prisma migrations, SQL schema changes,
  data transforms, seed scripts. Dùng khi task có: migrate, schema, database,
  Prisma, SQL, seed, index, foreign key.
type: specialist
tags: [database, migration, prisma, sql, schema]
tools: read, bash, edit, write, grep, find, ls
model: claude-sonnet-4-5
thinking: medium
max_turns: 50
skills:
  - prisma-workflow
  - sql-patterns
  - db-testing
requires:
  - env: DATABASE_URL
---

Bạn là database migration specialist.

## Workflow chuẩn
1. Đọc schema hiện tại (`prisma/schema.prisma`)
2. Load skill `prisma-workflow` để follow đúng migration steps
3. Tạo migration file (`npx prisma migrate dev --name <desc>`)
4. Verify với `npx prisma validate`
5. Chạy seed nếu cần
6. Test với `npx prisma db pull` để confirm

## KHÔNG LÀM
- Sửa trực tiếp DB schema mà không qua migration
- Chạy `prisma migrate reset` (xóa data)
- Push migration chưa tested
```

### `security-auditor.md`

```yaml
---
name: security-auditor
description: >
  Security review specialist: OWASP vulnerabilities, auth flows, injection attacks,
  secrets exposure, dependency CVEs. Dùng sau worker khi task liên quan đến:
  auth, login, JWT, OAuth, API keys, user input, file upload.
type: specialist
tags: [security, auth, oauth, review, vulnerability]
tools: read, grep, find, ls, bash
model: claude-sonnet-4-5
thinking: high
max_turns: 30
readonly: true
skills:
  - owasp-checklist
  - security-patterns
---

Bạn là security auditor. CHỈ ĐỌC — không sửa code.

## Security Checklist
Load skill `owasp-checklist` ngay khi bắt đầu.

## Output
Structured report: severity HIGH/MEDIUM/LOW + CWE reference + fix suggestion.
```

### `doc-writer.md`

```yaml
---
name: doc-writer
description: >
  Technical documentation specialist: README, API docs, inline comments,
  changelog, ADRs. Dùng khi task: viết docs, update README, tạo API reference,
  document architecture decision.
type: specialist
tags: [documentation, readme, api-docs, writing]
tools: read, edit, write, grep, find, ls
model: claude-sonnet-4-5
thinking: low
max_turns: 30
skills:
  - docs-style-guide
  - markdown-patterns
---
```

### `data-analyst.md`

```yaml
---
name: data-analyst
description: >
  Data analysis specialist: SQL queries, Python pandas, data visualization,
  report generation, metrics. Dùng khi task: analyze data, generate report,
  query database, create chart, compute metrics.
type: specialist
tags: [data, analysis, sql, python, report, metrics]
tools: read, bash, write, grep, find, ls
model: claude-sonnet-4-5
thinking: medium
max_turns: 40
skills:
  - pandas-workflow
  - sql-analytics
  - data-viz
---
```

---

## 9. Luồng Hoạt Động End-to-End

### Ví dụ: Task database migration

```
User: /implement "Add timezone column to users table"

1. Orchestrator đọc <available_agents>:
   - scout (generalist, explore)
   - db-migrator (specialist, tags: database, migration)
   - worker (generalist, implementation)
   - reviewer (generalist, code review)

2. Orchestrator reasoning:
   "Task liên quan đến 'column', 'users table' → database operation
    → db-migrator phù hợp hơn worker thông thường"

3. subagent(chain: [
     { agent: "scout",       task: "Find Prisma schema, existing migrations" },
     { agent: "db-migrator", task: "Add timezone column, create migration, test" },
     { agent: "reviewer",    task: "Verify migration correct, no data loss risk" }
   ], taskId: "bd-f2a1")

4. Scout chạy (Haiku):
   → grep "model User" prisma/schema.prisma
   → ls prisma/migrations/
   → Output: schema content + existing migrations list

5. db-migrator chạy:
   → Nhận <available_skills>: [prisma-workflow, sql-patterns, db-testing]
   → Nhận thấy cần prisma-workflow
   → read("harness/skills/prisma-workflow/SKILL.md")
   → Follow workflow: tạo migration → validate → test
   → bd close "bd-f2a1"

6. Reviewer chạy:
   → Verify migration file đúng syntax
   → Check không có breaking changes
   → APPROVED
```

### Ví dụ: Task multi-domain

```
User: /implement "Add user authentication with OAuth + security audit"

Orchestrator chọn:
  scout → planner → worker → security-auditor

Lý do:
- scout: map codebase
- planner: OAuth implementation plan
- worker: implement flow
- security-auditor: audit auth code (specialist) thay vì reviewer thường
```

---

## 10. Implementation Plan

### Phase 1 — Cập nhật Agent Frontmatter

Thêm `tags` và `skills` vào 4 agents hiện tại:

- [ ] `scout.md` — thêm `tags: [exploration, codebase, context]`, `skills: []`
- [ ] `planner.md` — thêm `tags: [planning, architecture]`, `skills: []`
- [ ] `worker.md` — thêm `tags: [implementation, fullstack]`, `skills: []`
- [ ] `reviewer.md` — thêm `tags: [review, quality, testing]`, `skills: []`

### Phase 2 — Agent Registry trong Extension

File: `harness/extensions/harness-subagent/agent-registry.ts`

- [ ] `discoverAgents(dir)` — scan + parse frontmatter
- [ ] `buildAgentsXml(agents)` — tạo XML cho system prompt
- [ ] Inject vào `session_start` hook
- [ ] Cập nhật `subagent` tool để accept `auto` mode + `tags` filter

### Phase 3 — Agent-Scoped Skills

- [ ] `findSkill(name)` — locate skill SKILL.md
- [ ] `buildAgentSystemPrompt(agentMeta)` — inject skills XML vào agent prompt
- [ ] Cập nhật `subagent` execute() để build đúng system prompt khi spawn agent

### Phase 4 — Specialist Agents

Tạo agents + skills theo nhu cầu:

- [ ] `harness/agents/db-migrator.md` + skills: `prisma-workflow`, `sql-patterns`
- [ ] `harness/agents/security-auditor.md` + skills: `owasp-checklist`
- [ ] `harness/agents/doc-writer.md` + skills: `docs-style-guide`

---

## Tham Khảo

| Tài Liệu | Liên Quan |
|----------|----------|
| [PI_HARNESS_GUIDE.md](PI_HARNESS_GUIDE.md) | Harness tổng quan |
| [PI_SKILLS_GUIDE.md](PI_SKILLS_GUIDE.md) | Skills system + runtime registration |
| [PI_EXTENSIONS_GUIDE.md](PI_EXTENSIONS_GUIDE.md) | Extension API |
| [harness/agents/](../harness/agents/) | Agent definitions |
| [harness/skills/](../harness/skills/) | Skills directory |
