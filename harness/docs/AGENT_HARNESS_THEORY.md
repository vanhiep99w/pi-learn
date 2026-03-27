# Agent Harness — Tổng hợp toàn diện

> Tổng hợp từ: Anthropic Engineering, OpenAI Codex Team, Philipp Schmid, Martin Fowler (Böckeler), HumanLayer, Firecrawl, Random Labs (Slate), Alex Zhang & Omar Khattab (RLM)
> Cập nhật: 2026-03-24

---

## Mục lục

1. [Định nghĩa và bức tranh tổng thể](#1-định-nghĩa-và-bức-tranh-tổng-thể)
2. [Tại sao Agent Harness quan trọng](#2-tại-sao-agent-harness-quan-trọng)
3. [Kiến trúc cốt lõi](#3-kiến-trúc-cốt-lõi)
4. [Các thành phần cấu hình](#4-các-thành-phần-cấu-hình)
5. [Context Engineering](#5-context-engineering)
6. [Memory & State Management](#6-memory--state-management)
7. [Verification & Guardrails](#7-verification--guardrails)
8. [Kiến trúc kiến thức trong Repository](#8-kiến-trúc-kiến-thức-trong-repository)
9. [Entropy Management](#9-entropy-management)
10. [Architecture Patterns](#10-architecture-patterns)
10a. [Advanced Architecture: RLM & Slate](#10a-advanced-architecture-rlm--slate)
11. [Vai trò mới của kỹ sư](#11-vai-trò-mới-của-kỹ-sư)
12. [Những gì không hoạt động](#12-những-gì-không-hoạt-động)
13. [Những gì hoạt động tốt](#13-những-gì-hoạt-động-tốt)
14. [Thách thức và rủi ro](#14-thách-thức-và-rủi-ro)
15. [Tầm nhìn tương lai](#15-tầm-nhìn-tương-lai)
16. [Tổng hợp nguyên tắc cốt lõi](#16-tổng-hợp-nguyên-tắc-cốt-lõi)

---

## 1. Định nghĩa và bức tranh tổng thể

### Định nghĩa

**Agent Harness** là software infrastructure bao quanh một AI model, quản lý mọi thứ ngoại trừ bản thân quá trình reasoning của model — bao gồm tool execution, memory storage, state persistence, context engineering, và error recovery.

```
Coding Agent = AI Model(s) + Harness
```

### Analogia với máy tính

| Thành phần máy tính | Tương đương AI |
|---|---|
| CPU | Model (sức mạnh xử lý) |
| RAM | Context Window (bộ nhớ tạm thời) |
| **Operating System** | **Agent Harness** (quản lý context, boot sequence, drivers) |
| Application | Agent (logic cụ thể của use case) |

### Harness vs. Framework vs. Orchestrator

| Khái niệm | Vai trò |
|---|---|
| **Framework** | Libraries & abstractions để build agents (LangChain, CrewAI...) |
| **Harness** | Runtime system thực thi agent với tools, memory, state |
| **Orchestrator** | Control flow — quyết định khi nào/cách nào invoke model |

Framework cung cấp **components**; Harness **lắp ráp** chúng thành hệ thống chạy thực tế với defaults và integrations.

---

## 2. Tại sao Agent Harness quan trọng

### Vấn đề gốc rễ: LLM là stateless

LLM vốn không có trạng thái — mỗi session mới bắt đầu mà không có bộ nhớ về những gì đã xảy ra trước. Điều này gây ra các lỗi điển hình trong tác vụ dài hạn:

- Agent cố hoàn thành mọi thứ trong một lần → cạn kiệt context giữa chừng
- Session sau tuyên bố "hoàn thành" mà không verify kết quả thực tế
- Context window đầy lịch sử không liên quan → model mất khỏi goal ban đầu
- Tool calls hallucinate tham số không hợp lệ
- Network failures xóa sạch in-memory progress

### Capability Convergence

Khi các AI model ngày càng hội tụ về năng lực (các model top ngày càng giống nhau), yếu tố tạo ra sự khác biệt **không còn** là model mạnh hay yếu nữa — mà là **quality của infrastructure**.

### Bằng chứng thực nghiệm

- **OpenAI Codex Team:** 3 kỹ sư, ~1,500 PRs, ~1 triệu dòng code trong 5 tháng = 3.5 PR/người/ngày, không một dòng code viết tay
- **ICML 2025 gaming study:** Cùng model, cùng prompt — có harness vs. không có harness → win rate cải thiện nhất quán trên tất cả games
- **Anthropic:** Ước tính nhanh hơn **10 lần** so với viết tay khi sử dụng harness đúng cách
- **Claude Opus:** Xếp #33 trong native Claude Code harness nhưng xếp **#5** trong alternative harness — cùng một model

### The Bitter Lesson (Bài học đắt giá)

Trích từ nguyên lý Rich Sutton: *các phương pháp tính toán tổng quát luôn thắng logic được hand-code*. Bằng chứng:
- Manus refactor harness **5 lần** trong 6 tháng
- LangChain redesign agent architecture **3 lần/năm**
- Vercel xóa **80% agent tools** → hiệu quả tăng lên

**Kết luận:** Harness phải nhẹ và modular — thiết kế sẵn để xóa bỏ khi model mới thay thế logic cũ.

---

## 3. Kiến trúc cốt lõi

### 4 lớp chính

```
┌─────────────────────────────────────────┐
│           AGENT HARNESS                 │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │     Context Engineering         │    │
│  │  (what goes into each prompt)   │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │     Memory & State Mgmt         │    │
│  │  (working / session / long-term)│    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │     Tool Integration Layer      │    │
│  │  (file ops, code exec, web...)  │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │     Verification & Guardrails   │    │
│  │  (tests, linters, human-in-loop)│    │
│  └─────────────────────────────────┘    │
│                                         │
│              ▼ wraps ▼                  │
│         ┌──────────┐                   │
│         │  LLM     │                   │
│         └──────────┘                   │
└─────────────────────────────────────────┘
```

---

## 4. Các thành phần cấu hình

### 4.1 CLAUDE.md / AGENTS.md

File markdown được inject vào system prompt ở cấp repository — là điểm entry đầu tiên của agent.

**Khuyến nghị:**
- Giữ dưới **60–100 dòng**
- Là **bản đồ (table of contents)**, không phải bách khoa toàn thư
- Dùng **progressive disclosure** — thông tin hiện ra khi cần, không dump hết một lúc
- **Không** đưa codebase overview vào — agent tự khám phá được
- **Không** auto-generate (thường vô dụng)
- Con trỏ tới nguồn sâu hơn, không chứa nội dung trực tiếp

**Thất bại của "one big AGENTS.md":**
- Chiếm hết context, đẩy code và docs thực sự ra ngoài
- Khi tất cả đều "quan trọng" → không gì quan trọng cả
- Mục nhanh chóng → agent không biết rule nào còn đúng
- Khó verify mechanically (coverage, freshness, ownership)

Nghiên cứu ETH Zurich xác nhận: hầu hết agent files không có ích → **ít instruction thường tốt hơn nhiều**.

### 4.2 MCP Servers (cho Tools)

Extend tools cho agent, inject vào context dưới dạng tool descriptions.

**Nguyên tắc:**
- **Không bao giờ** kết nối MCP server không tin tưởng → nguy cơ prompt injection
- Quá nhiều tools → bloat context window → agent hoạt động kém hiệu quả
- Ưu tiên **CLIs đã có trong training data** thay vì MCP server dư thừa
- Tool descriptions phải chứa **remediation instructions** khi error xảy ra

**Ví dụ thực tế:** HumanLayer thay Linear MCP bằng một CLI wrapper nhẹ có example usages → hiệu quả hơn nhiều.

### 4.3 Skills (cho Progressive Disclosure)

Module kiến thức tái sử dụng, chỉ load khi thực sự cần.

**Lợi ích:**
- Kích hoạt khi relevant → tiết kiệm "instruction budget"
- Bundle cả markdown files lẫn executables
- Không cài sẵn những gì không cần thiết

**Cảnh báo bảo mật:** Một số skill registries đã phát tán malicious code — verify trước khi install.

### 4.4 Sub-Agents (cho Context Control)

Lever **mạnh nhất** cho tác vụ phức tạp.

**Không dùng** sub-agent theo vai trò ("frontend engineer").
**Nên dùng** cho công việc cụ thể, nặng context:
- Research và phân tích pattern trong codebase
- Tracing thông tin qua nhiều services
- Exploration code rộng

**Sub-agent = "Context Firewall":**
- Noise trung gian bị cô lập trong sub-agent
- Chỉ kết quả đã được **condensed** trả về parent thread
- Ngăn **context rot** — model performance giảm mạnh khi context dài với semantic relevance thấp (Chroma research)

**Best practice trả về kết quả:**
- Response cực kỳ ngắn gọn
- Kèm source citations dạng `filepath:line` để parent investigate nếu cần

**Cost optimization:**
- Sub-agent tasks → dùng model rẻ (Sonnet/Haiku)
- Orchestration → dùng model mạnh (Opus)

### 4.5 Hooks (cho Control Flow)

Scripts kích hoạt theo event trong lifecycle của agent.

**Use cases phổ biến:**
- Notification khi hoàn thành (âm thanh, Slack message)
- Approval logic — từ chối tool calls nguy hiểm
- Build/typecheck verification trước khi dừng
- Integration automation

**Ví dụ hook thực tế:**
```bash
#!/bin/bash
# Chạy sau mỗi code change
# Im lặng nếu thành công, chỉ surface errors

result=$(biome check . 2>&1)
if [ $? -ne 0 ]; then
  echo "$result"
  exit 2  # Exit code 2 = báo harness re-engage agent
fi

result=$(tsc --noEmit 2>&1)
if [ $? -ne 0 ]; then
  echo "$result"
  exit 2
fi

exit 0  # Thành công, tiếp tục
```

### 4.6 Back-Pressure Mechanisms (Verification tự động)

Hệ thống cho phép agent tự validate công việc trước khi khai báo hoàn thành:

- Typechecks và builds
- Unit/integration tests
- Code coverage reporting
- UI testing (Puppeteer, Chrome DevTools)

**Bài học đắt giá về context efficiency:**
4,000 dòng passing test output **tràn ngập context window** → agent hallucinate.
**Giải pháp:** Swallow output thành công, chỉ surface failures.

---

## 5. Context Engineering

Context engineering là khoa học quản lý **những gì được đưa vào prompt** của mỗi lần gọi model — đây là thách thức lớn nhất trong việc làm agent hiệu quả với tác vụ phức tạp.

### Các nguyên tắc cốt lõi

**Progressive disclosure:**
- Agent bắt đầu với entry point nhỏ, ổn định
- Được chỉ dạy **nơi tìm kiếm tiếp theo**, không bị overwhelm từ đầu
- Thông tin được reveal theo nhu cầu thực tế của task

**Lost-in-the-middle problem:**
- Nghiên cứu cho thấy LLM performance giảm khi nội dung quan trọng nằm ở **giữa** prompt
- Đặt instructions quan trọng ở đầu hoặc cuối context

**Context compaction:**
- Tóm tắt lịch sử cũ thay vì giữ nguyên
- Chỉ retrieve documents liên quan đến bước hiện tại
- Không dump toàn bộ history vào mỗi lần gọi

**Context rot — nguy cơ thầm lặng:**
- Context tích lũy noise theo thời gian
- Model performance giảm dần theo session length
- Sub-agents là giải pháp: isolate noise, return only essence

### Nguyên tắc "What Codex can't see doesn't exist"

> Thứ gì agent không thấy trong context = không tồn tại với nó.

- Google Docs, Slack discussions, kiến thức trong đầu người → vô hình với agent
- Mọi quyết định quan trọng phải được **encode vào repository**
- Architectural decisions trong chat threads cũng phải được committed vào docs/

---

## 6. Memory & State Management

### Ba tầng bộ nhớ

| Tầng | Mô tả | Ví dụ |
|---|---|---|
| **Working context** | Prompt hiện tại của session | Task description, current code |
| **Session state** | Durable logs cho task đang chạy | `claude-progress.txt`, git log |
| **Long-term memory** | Kiến thức xuyên suốt nhiều tasks | `docs/`, design decisions, plans |

### State persistence qua sessions

Vấn đề: mỗi session mới không có memory. Giải pháp:

**Init Agent + Executor Pattern (Anthropic):**
1. **Init Agent** thiết lập môi trường một lần:
   - Tạo `init.sh` để khởi động server
   - Viết `claude-progress.txt` ghi trạng thái ban đầu
   - Khởi tạo git repository với structure rõ ràng

2. **Executor Agent** mỗi session:
   - Đọc progress file và git log để định hướng
   - Chạy verification cơ bản để xác nhận trạng thái
   - Chọn task ưu tiên cao nhất chưa hoàn thành
   - Thực hiện **một task duy nhất**
   - Commit với message mô tả rõ ràng
   - Thoát sạch

**Git history là bộ nhớ đáng tin cậy:**
- Commit thường xuyên với messages có ý nghĩa
- Git log là nguồn sự thật về những gì đã làm
- Mỗi session bắt đầu bằng `git log` để định hướng

### Format lưu trữ state

**JSON tốt hơn Markdown** cho feature tracking:
- Model ít có khả năng vô tình corrupt cấu trúc JSON
- Dễ parse và validate mechanically
- Dễ dùng trong CI jobs

```json
{
  "features": [
    {
      "id": "auth-login",
      "status": "completed",
      "tested": true,
      "commit": "abc123"
    },
    {
      "id": "user-dashboard",
      "status": "in_progress",
      "tested": false,
      "commit": null
    }
  ]
}
```

---

## 7. Verification & Guardrails

### Tại sao verification quan trọng

Không có verification, agent có xu hướng:
- Tuyên bố "hoàn thành" quá sớm khi thực ra chưa xong
- Đánh dấu feature pass khi chưa test thực tế
- Tạo ra code chạy được nhưng không đúng behavior

### Các lớp verification

**Lớp 1 — Static analysis (nhanh nhất):**
- Custom linters (deterministic, không phải LLM)
- Type checking (TypeScript, mypy...)
- Format checking
- Architectural dependency validation

**Lớp 2 — Dynamic testing:**
- Unit tests
- Integration tests
- Code coverage reporting

**Lớp 3 — End-to-end validation:**
- Browser automation (Puppeteer, Chrome DevTools Protocol)
- UI screenshot + comparison
- Real user journey simulation

**Lớp 4 — Observability:**
- Logs (LogQL)
- Metrics (PromQL)
- Traces (TraceQL)
- Cho phép prompts như: *"đảm bảo service startup < 800ms"* hay *"không span nào trong 4 user journey quan trọng vượt 2 giây"*

### Kỹ thuật back-pressure

```
Agent thực hiện thay đổi
        ↓
Hook chạy verification
        ↓
   Thành công? ──YES──→ Im lặng, tiếp tục
        ↓ NO
   Surface chỉ failures
        ↓
   Agent re-engages, fix lỗi
        ↓
   Lặp lại đến khi clean
```

### Linters như remediation injector

Error messages của custom linter phải được viết để **inject remediation instructions vào agent context**:

```
❌ Bad:  "Dependency violation in auth module"
✅ Good: "Dependency violation: auth/service.ts imports from ui/ layer.
          Fix: Move shared logic to auth/types.ts or create a Provider.
          See docs/ARCHITECTURE.md#dependency-rules for full diagram."
```

### Worktree isolation

Mỗi task chạy trên **git worktree riêng biệt**:
- App boot độc lập per worktree
- Observability stack ephemeral per worktree
- Không ảnh hưởng lẫn nhau
- Torn down sau khi task hoàn thành

---

## 8. Kiến trúc kiến thức trong Repository

### Cấu trúc docs/ được khuyến nghị

```
AGENTS.md               ← Bản đồ, ~60-100 dòng
ARCHITECTURE.md         ← Top-level map of domains
docs/
├── design-docs/
│   ├── index.md
│   ├── core-beliefs.md   ← Operating principles
│   └── ...
├── exec-plans/
│   ├── active/           ← Plans đang thực hiện
│   ├── completed/        ← Plans đã xong
│   └── tech-debt-tracker.md
├── generated/
│   └── db-schema.md      ← Auto-generated, always fresh
├── product-specs/
│   ├── index.md
│   └── ...
├── references/
│   ├── library-name-llms.txt   ← External lib docs
│   └── ...
├── DESIGN.md
├── FRONTEND.md
├── PLANS.md
├── PRODUCT_SENSE.md
├── QUALITY_SCORE.md    ← Grades each domain, tracks gaps
├── RELIABILITY.md
└── SECURITY.md
```

### Plans như first-class artifacts

**Lightweight plans** cho thay đổi nhỏ.
**Execution plans** cho công việc phức tạp:
- Progress log
- Decision log với lý do
- Check vào repository
- Versioned và co-located với code

Active plans, completed plans, và known tech debt — tất cả versioned cùng chỗ. Agent không cần dựa vào external context.

### Mechanical enforcement của knowledge base

CI jobs phải validate:
- Documentation up-to-date với code thực tế
- Cross-links hợp lệ (không broken links)
- Cấu trúc đúng format
- Freshness (không quá cũ)

**Doc-gardening agent** chạy định kỳ:
- Quét doc lỗi thời không reflect code thực
- Mở fix-up PRs tự động
- Cập nhật quality scores

---

## 9. Entropy Management

### Vấn đề

Agent nhân bản patterns đã có trong repository — kể cả patterns xấu. Theo thời gian, **drift là không thể tránh**.

Ban đầu OpenAI team tốn **mỗi thứ Sáu (20% tuần)** dọn "AI slop" → không scale.

### Giải pháp: Garbage Collection liên tục

**Golden Principles** được encode vào repository:
- Prefer shared utility packages thay vì hand-rolled helpers để centralize invariants
- Validate boundaries hoặc dùng typed SDKs, không probe data "YOLO-style"
- Structured logging bắt buộc
- File size limits
- Naming conventions cho schemas và types

**Background cleanup agents** chạy định kỳ:
- Quét deviations khỏi golden principles
- Cập nhật quality grades
- Mở targeted refactoring PRs
- Hầu hết có thể review < 1 phút và automerge

**Triết lý:** Technical debt như khoản vay lãi suất cao — trả liên tục từng chút tốt hơn là để tích lũy rồi xử lý đau đớn một lần.

### Merge philosophy trong môi trường high throughput

Khi agent throughput vượt xa human attention:
- Minimal blocking merge gates
- PRs ngắn, short-lived
- Test flakes → fix bằng follow-up run, không block vô thời hạn
- **"Corrections are cheap, waiting is expensive"**

---

## 10. Architecture Patterns

### Pattern 1: Single-Agent Supervisor

```
Human Prompt
    ↓
Agent (with tools + memory + verification)
    ↓
Pull Request
```

**Phù hợp:** Tác vụ bounded, scope rõ ràng (customer support, simple features).

### Pattern 2: Initializer-Executor Split *(Anthropic)*

```
[One time]
Human → Init Agent → Sets up: init.sh, progress.txt, git repo

[Each session]
Human → Executor Agent
    → Reads: progress.txt + git log
    → Validates: current state
    → Selects: highest priority incomplete task
    → Does: ONE task
    → Tests + commits
    → Exits cleanly
```

Project state = shared memory across sessions.

### Pattern 3: Multi-Agent Coordination

```
Human Prompt
    ↓
Orchestrator (expensive model - Opus)
    ↙        ↘
Research    Writer    Reviewer
Agent       Agent     Agent
(Haiku)    (Sonnet)  (Sonnet)
    ↘        ↙
   Harness manages handoffs
   Each agent gets relevant context only
        ↓
   Final output
```

Harness đảm bảo mỗi agent nhận context liên quan, không nhận lịch sử dư thừa.

### Pattern 4: Review Loop (Ralph Wiggum Loop)

```
Agent writes code
    ↓
Agent self-reviews locally
    ↓
Agent requests specialist agent reviews
    ↓
Agent responds to feedback
    ↓
Loop until all agent reviewers satisfied
    ↓
Human review (optional)
    ↓
Merge
```

### Layered Domain Architecture (OpenAI)

Mỗi business domain có layers cố định:

```
Types → Config → Repo → Service → Runtime → UI
                              ↑
                         Providers
                  (auth, telemetry, feature flags)
```

Rules:
- Dependency chỉ đi "forward", không đảo ngược
- Cross-cutting concerns vào qua **một** interface duy nhất: Providers
- Enforce bằng custom linters + structural tests

---

## 10a. Advanced Architecture: RLM & Slate

> *Nguồn: Alex Zhang & Omar Khattab — "Recursive Language Models"; Random Labs — "Slate: Moving Beyond ReAct and RLM"*

Phần này đi sâu vào **lý thuyết kiến trúc** đằng sau các pattern đã nêu ở trên — và đề xuất các primitive mới giải quyết đồng thời nhiều vấn đề mà các approach trước chỉ giải quyết được từng phần.

---

### Strategy vs. Tactics — Nền tảng lý thuyết

Lấy cảm hứng từ AlphaZero/AlphaGo, có thể phân biệt rõ hai loại reasoning:

| | Tactics | Strategy |
|---|---|---|
| Định nghĩa | Hành động cụ thể, local, học được | Planning mở, dựa trên knowledge tổng thể |
| Ví dụ SW | Chạy bash command, viết test | Thiết kế schema backward-compatible |
| AlphaZero | Policy network (move selection) | Value network (positional judgment) |

**Quan trọng:** Trong AlphaZero, tactical concepts (material value) xuất hiện **trước** (16k–32k steps), strategic concepts (king safety, mobility) xuất hiện **sau** (32k–128k+). Chúng emerge tách biệt, ở các layers khác nhau của network.

**Knowledge Overhang:** Model có kiến thức tiềm ẩn rộng hơn những gì nó có thể truy cập khi thực thi trực tiếp. Tricks như "think step by step", planning files, hay chain-of-thought mở ra phần overhang đó.

```
                start
         [Tactically Accessible]
    [        Knowledge Overhang          ]
    [    Edge of Model Knowledge         ]

Planning/CoT/Scaffolding → mở rộng vùng accessible
```

> *Lưu ý: Hầu hết rules trong AGENTS.md là **tactical** — ví dụ "Never run db commands".*

---

### Vấn đề Working Memory & "Dumb Zone"

```
┌──────────────────────────┬──────────────┐
│      Working Memory      │  Dumb Zone   │
│  (attention đầy đủ)      │  (degrade)   │
└──────────────────────────┴──────────────┘
                           ↑
                  attention bắt đầu giảm
```

Tất cả 4 frontier models (Claude Sonnet 4, GPT-4.1, Qwen3-32B, Gemini 2.5 Flash) đều **degrade non-uniformly** khi context tăng — ngay cả trên các tasks đơn giản (Chroma Research, 2025).

---

### Recursive Language Models (RLM)

**Ý tưởng cốt lõi:** Thay vì nhét toàn bộ context vào một lần gọi model, để model tự decompose và recursively tương tác với context qua môi trường Python REPL.

```
Root LM nhận query (không thấy full context)
    ↓
Tương tác với context qua REPL:
  peek(2000)        → sample đầu để hiểu cấu trúc
  grep(pattern)     → filter bằng regex/keyword
  partition(chunks) → chia nhỏ rồi map recursively
  summarize(subset) → extract summary từng phần
    ↓
Recursive sub-calls xử lý từng chunk (depth=1)
    ↓
Root LM tổng hợp → FINAL(answer)
```

**Nguyên tắc phân biệt RLM với agents thông thường:**
- **Context-centric** (không phải problem-centric): decomposition dựa trên cấu trúc context, không phải task structure do human định nghĩa
- Decomposition do **model tự quyết định**, không bị hard-code
- Trajectories có thể optimize bằng RL

**Emergent strategies** — model tự học mà không được dạy:
| Strategy | Mô tả |
|---|---|
| **Peeking** | Sample đầu context để hiểu cấu trúc trước khi đi sâu |
| **Grepping** | Dùng regex filter để thu hẹp search space |
| **Partition + Map** | Chunk → recursive calls cho từng chunk |
| **Summarization** | Extract summary từng subset cho parent-level decisions |

**Kết quả thực nghiệm:**
- Tại 132K tokens: RLM(GPT-4o-mini) vượt GPT-4o **+34 điểm (114%)** với chi phí tương đương
- Tại 263K tokens: vượt **+15 điểm (49%)**, trong khi GPT-4o-mini thuần degrade nghiêm trọng
- BrowseComp-Plus: RLM đạt **perfect ở 1,000 documents** — các baselines sụp đổ từ 100 docs trở lên

**Hạn chế của RLM:**
- Phải commit toàn bộ script/plan trước — chỉ biết kết quả ở cuối (blind N-step execution)
- Thiếu intermediate feedback khi environment đang thay đổi
- Overdecomposition khi depth không bị giới hạn

---

### So sánh các Agent Architectures

| Aspect | ReAct | Markdown Plan | Task Trees | RLM | Devin/Manus | Claude Code | **Slate** |
|---|---|---|---|---|---|---|---|
| Planning | Implicit | File | Explicit | REPL | Planning agent | Plan mode | Implicit |
| Decomposition | None | None | Direct tree | REPL functions | Task based | Subagent | **Implicit** |
| Synchronization | Single thread | Single thread | Gated steps | REPL return | Reduce & return | Message passing | **Episodes** |
| Intermediate feedback | Per step | Per step | On task fail | On execution | After compress | Message passing | **Per episode** |
| Context isolation | N/A | N/A | Per subtask | Per subcall | Subagent | Subagent | **Per thread** |
| Context compaction | N/A | N/A | Task based | REPL Slicing | Subagent compress | Compaction | **Episode compress** |
| Parallel execution | N/A | N/A | N/A | In REPL | Altera only | Native | **Native** |
| Expressivity | High | High | **Low** | High | Medium | Medium | **High** |
| Adaptability | Yes | Yes* | **No** | Yes | Yes | Limited | **Yes** |

*Yes nếu plan được cập nhật theo

---

### Slate — Thread Weaving & Episodes

Slate giải quyết đồng thời 5 vấn đề: compaction, strategic coherence, expressivity, task decomposition, và synchronization — bằng **một primitive duy nhất: thread**.

#### Thread ≠ Subagent

| | Subagent thông thường | Thread (Slate) |
|---|---|---|
| Scope | Persistent, có role định sẵn | Thực hiện **một action** duy nhất |
| Communication | Message passing (isolated) | Episode (compressed state) chia sẻ trực tiếp |
| Context | Isolated hoàn toàn | Shared/composable |
| Lifecycle | Background, long-running | Execute → pause → trả quyền về orchestrator |
| Feedback | Chỉ ở cuối | Per-step trong thread |

```
Subagents:                    Threads (Slate):
                              ┌──────────────────────────┐
orch ──msg──► sub-A           │   shared/composable ctx  │
orch ◄──msg── sub-A           │                          │
                              │  orch ──ctx──► T1        │
(isolated contexts)           │  orch ◄─ep─── T1         │
                              │  T1 episode ──► T2 input │
                              └──────────────────────────┘
```

#### Episode — Episodic Memory thực sự

- Tập hợp các bước thread thực hiện để hoàn thành action = **một episode**
- Episode là **compressed representation**: chỉ giữ kết quả quan trọng, bỏ full tactical trace
- Compaction **tự nhiên** vì có built-in completion boundary
- Episode của thread trước là **input** cho thread sau → composability

#### Thread Weaving

```
Orchestrator
    ↓ dispatch (parallel)
   T1  T2  T3  T4
    ↓   ↓   ↓   ↓
  ep1 ep2 ep3 ep4    ← episodes trả về
       ↓
  T1+T2 ep → input T5
  T2+T3 ep → input T6
       ↓
  Orchestrator tổng hợp, update strategy nếu cần
```

- Orchestrator **không commit plan tĩnh** từ đầu
- Buộc phải externalize work trong units có thể compress
- Synchronization thường xuyên → cập nhật strategy khi gặp thông tin mới
- Threads là LLM-driven, không phải static scripts → có thể react với unexpected state

#### OS Analogy

Ánh xạ trực tiếp với Karpathy's LLM OS:

| OS Component | Slate Component |
|---|---|
| Kernel | Orchestrator (main thread LLM) |
| Process | Thread |
| Process return value | Episode |
| RAM | Context window (scarce, actively managed) |
| Peripherals | Filesystem, terminal, browser, APIs |

> Thay vì để RAM đầy đến crash, mỗi thread return là cơ hội tự nhiên để quyết định **giữ gì, compress gì, bỏ gì**.

#### Tại sao không nên vội chuyển sang multi-agent teams

> *"We think single-threaded agents have not been solved fully. As an industry, we do not need to move on to teams just yet."*

Planner + Implementer + Reviewer architecture:
- Có thể **sort of work** nhưng chậm, clunky, và có nhiều inertia
- Hệ quả của việc có execution pattern quá strict
- Có thể improve benchmark scores nhưng không improve trải nghiệm thực tế

---

### Kết nối giữa RLM và Slate

RLM giải quyết context rot bằng cách cho model tự decompose qua REPL — nhưng còn **blind N-step execution**: phải commit script trước, chỉ biết kết quả ở cuối.

Slate giữ nguyên expressivity của RLM nhưng giải quyết điểm yếu này:
- Threads là LLM-driven (không phải static scripts) → **per-step reactivity** như ReAct
- Episode boundary là compaction tự nhiên → giải quyết context rot
- Composability của episodes → transfer information đúng qua context boundaries

**Tóm gọn:** RLM cung cấp lý thuyết nền; Slate là implementation vượt qua giới hạn của RLM.

---

## 11. Vai trò mới của kỹ sư

### Từ "viết code" sang "design environments"

| Trước đây | Trong agent-first world |
|---|---|
| Viết code trực tiếp | Thiết kế môi trường và scaffolding |
| Debug bằng tay | Xác định capability còn thiếu |
| Review pull requests | Xây dựng feedback loops |
| Refactor code | Encode "taste" vào tooling |
| Maintain documentation | Làm documentation verifiable mechanically |

### Nguyên tắc làm việc

**Depth-first approach:**
- Break down goals lớn → building blocks nhỏ hơn
- Prompt agent tạo từng block
- Dùng blocks đó để unlock tasks phức tạp hơn

**Khi thất bại, hỏi:**
> "Capability gì đang thiếu? Tool, guardrail, hay documentation nào cần thêm?"

**Không bao giờ:** "Thử lại mạnh hơn" hay prompt lại cùng một cách.

### Human taste → System rules

Mọi preference của human kỹ sư phải được **encode vào tooling**:
- Review comments → documentation updates
- Refactoring PRs → golden principles
- User-facing bugs → new verification steps

Khi documentation không đủ → promote rule lên thành code enforcement.

### Mức độ tự chủ ngày càng cao

Với harness đủ hoàn thiện, một prompt đơn có thể trigger:
1. Validate trạng thái codebase hiện tại
2. Reproduce reported bug
3. Record video demo lỗi
4. Implement fix
5. Validate fix bằng cách drive app
6. Record video demo resolution
7. Mở pull request
8. Respond to agent + human feedback
9. Detect và remediate build failures
10. Escalate human chỉ khi cần judgment
11. Tự merge

---

## 12. Những gì không hoạt động

| Approach | Tại sao thất bại |
|---|---|
| One big AGENTS.md | Crowded out context, stale nhanh, không verifiable |
| Thiết kế "ideal config" trước khi gặp failure | Thiếu ground truth thực tế |
| Cài hàng chục skills "phòng hờ" | Bloat context, confused agent |
| Chạy full test suite sau mỗi action | 4000 dòng output tràn context → hallucinate |
| Micro-optimize tool access | Over-engineering sớm |
| "Thử lại mạnh hơn" khi agent fail | Không giải quyết gốc rễ |
| Dọn AI slop thủ công hàng tuần | Không scale |
| Để knowledge trong Slack/Google Docs | Vô hình với agent |
| Role-based sub-agents | Không isolate context đúng cách |

---

## 13. Những gì hoạt động tốt

| Approach | Tại sao hiệu quả |
|---|---|
| Start simple, thêm config phản ứng với failure | Ground truth từ thực tế |
| Một task mỗi lần, commit thường xuyên | State recovery dễ dàng |
| Linter error messages với remediation instructions | Context trực tiếp cho agent |
| Sub-agents như context firewalls | Isolate noise, return essence |
| JSON cho state tracking | Khó corrupt hơn Markdown |
| Swallow success output, surface only failures | Tiết kiệm context |
| Background cleanup agents | Scale entropy management |
| Mechanical enforcement (CI jobs) | Không dựa vào human memory |
| Worktree isolation per task | Parallel work, no interference |
| Cheap models cho sub-tasks | Cost efficiency |

---

## 14. Thách thức và rủi ro

### The Application Maintenance Divide

Retrofit harnesses vào **legacy codebase** có thể **quá tốn kém** do entropy và thiếu chuẩn hóa. Tương tự bật static analysis alerts trên codebase cũ → ngập trong hàng ngàn warnings không thể xử lý. Các tổ chức không đầu tư sớm vào harnesses có thể bị bỏ lại.

### Context Durability Problem

"Durability" — model tuân thủ instruction tốt đến đâu **sau 50+ tool calls liên tiếp**? Đây là metric thực sự quan trọng hơn leaderboard scores. Model có thể xuất sắc trên benchmark nhưng drift/hallucinate sau hàng chục tool calls.

### Tech Stack Convergence

Khi development chuyển từ "gõ code" sang "steering agent", tổ chức gravitating về phía:
- Ít tech stacks hơn, chuẩn hóa cao
- Ưu tiên "AI-friendliness" thay vì developer preference
- Công nghệ "boring" và stable thắng thế (dễ model hóa hơn)

### Model Overfitting

Model bị post-train theo harness gốc của nó. Điều này không có nghĩa tránh customize — mà có nghĩa: **tailoring harness cho use case cụ thể luôn cải thiện performance**.

### Security Risks

- MCP servers có thể chứa prompt injection
- Skill registries có thể phát tán malicious code
- Agent với quyền truy cập rộng có thể thực hiện destructive actions

---

## 15. Tầm nhìn tương lai

### Harness như "Golden Path" Templates

Harnesses có thể trở thành **service templates tiêu chuẩn** — kết hợp custom linters, structural tests, và context providers. Tuy nhiên thách thức fork và synchronization sẽ xuất hiện như service templates ngày nay.

### Training ↔ Inference Convergence

Sự hội tụ giữa training và inference environments:
- Harness xác định chính xác khi nào model bắt đầu drift
- Dữ liệu đó feed ngược vào training
- Failures trở thành training data
- Vòng lặp tự cải thiện liên tục

### Harness as Competitive Moat

Lợi thế cạnh tranh không còn đến từ prompts hay model choice, mà từ **captured agent trajectories** — dữ liệu hành vi agent tích lũy theo thời gian. Mỗi failure là một điểm dữ liệu quý giá.

### Những câu hỏi còn mở

- Kiến trúc coherence evolve thế nào qua nhiều **năm** trong hệ thống fully agent-generated?
- Human judgment thêm leverage nhiều nhất ở đâu trong quá trình đó?
- Hệ thống sẽ thay đổi thế nào khi models tiếp tục mạnh hơn?

---

## 16. Tổng hợp nguyên tắc cốt lõi

### Nguyên tắc thiết kế Harness

1. **Harness phải nhẹ và modular** — thiết kế để xóa bỏ, không phải để tích lũy
2. **Context là tài nguyên quý** — mọi thứ trong context phải earn its place
3. **Thứ agent không thấy không tồn tại** — encode mọi thứ vào repository
4. **Failures là signals, không phải excuses** — mỗi failure → tìm capability thiếu
5. **Enforce boundaries centrally, allow autonomy locally** — constraints = speed
6. **Corrections are cheap, waiting is expensive** — throughput > perfection
7. **Human taste phải được encode, không phải nói miệng** — nếu không trong code, nó không được enforce
8. **Verification phải context-efficient** — swallow success, surface failures only
9. **Start simple, iterate reactively** — không over-engineer trước khi biết vấn đề thực
10. **Build to delete** — mọi component phải sẵn sàng được thay thế

### The Discipline Shift

> *"Building software still demands discipline, but the discipline shows up more in the scaffolding rather than the code."*

Thách thức thực sự không phải là viết code, mà là **thiết kế environments, feedback loops, và control systems** để agent làm việc đáng tin cậy ở quy mô lớn và thời gian dài.

---

## Nguồn tham khảo

1. Anthropic Engineering — *Effective Harnesses for Long-Running Agents*
2. OpenAI / Ryan Lopopolo — *Harness Engineering: Leveraging Codex in an Agent-First World*
3. Philipp Schmid — *Agent Harness 2026*
4. Martin Fowler / Birgitta Böckeler — *Harness Engineering (Exploring Gen AI)*
5. HumanLayer / Kyle — *Skill Issue: Harness Engineering for Coding Agents*
6. Firecrawl — *What is an Agent Harness*
7. Alex Zhang & Omar Khattab — *Recursive Language Models* (2025)
8. Random Labs Team — *Slate: Moving Beyond ReAct and RLM* (2026)
