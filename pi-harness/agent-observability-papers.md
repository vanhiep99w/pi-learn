# Agent Observability Research — Papers & Resources

> Research notes về observability/evaluation/harness engineering cho AI agent, dùng làm input để improve Pi Harness.
>
> Mục đích: đối chiếu các approach trong literature với các file harness hiện có (`harness-observability.md`, `session-log-format.md`, `runtime-and-improvement.md`, `improvement-matrix.md`) và tìm gap để cải thiện.
>
> Ngày tổng hợp: 2026-07-16. Một số arXiv ID năm 2026 còn mới — verify link trước khi cite vào tài liệu chính thức.

---

## Trạng thái harness hiện tại

Harness đã có các thành phần observability sau (xem [`harness-observability.md`](./harness-observability.md), [`session-log-format.md`](./session-log-format.md)):

- 4 log streams: `runtime`, `audit`, `error`, `self_improvement`.
- Correlation IDs: `runId`, `traceId`, `parentEventId`, `eventId`, `sessionId`, `entryId`, `ruleId`, `proposalId`, `evalId`.
- Redaction + truncation + sensitive-path detection.
- Normalized events (`events.jsonl`), metrics (`metrics.json`), manifest, `warnings.jsonl`.
- `rawRef` để lazy-load full content khi inspect.
- Rule engine → proposal lifecycle → controlled apply → eval.
- Reflection bằng LLM với evidence đã redact.

Paper dưới đây giúp **mở rộng/chuẩn hóa**, không phải xây từ đầu.

---

## 1. Tracing & observability schema

Liên quan trực tiếp [`harness-observability.md`](./harness-observability.md). Harness đang dùng schema riêng (`HarnessLogEvent`). Nhóm này cho biết nên align với standard nào để có tooling sẵn.

| Tài liệu | Org / Year | Liên quan với harness |
|---|---|---|
| [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | CNCF, 2024–25 | Attribute chuẩn cho LLM spans (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`). Có thể thêm alias cho các field này trong `HarnessLogEvent` để export OTel-compatible sau này. |
| [OpenLLMetry](https://github.com/traceloop/openllmetry) | Traceloop, ~7.3k★ | Reference implementation của GenAI semconv. Auto-instrument OpenAI/Anthropic/LangChain thành spans. Hữu ích khi muốn emit OTel spans thay vì chỉ JSONL. |
| [OpenInference](https://github.com/Arize-ai/openinference) (spec tại `spec/semantic_conventions.md`) | Arize, ~1.1k★ | Spec OTel cho AI/agent với span types: `chain`, `tool`, `retriever`, `llm`. Map trực tiếp sang `component` enum của harness (`parser`/`proposal`/`eval`…). |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | Arize, ~10.6k★ | Backend observability + evaluation open-source, chạy local để inspect spans/traces. |
| [LangSmith](https://docs.smith.langchain.com/) | LangChain | Pattern "run tree" — mỗi step là artifact eval. Cùng hướng với `events.jsonl` + `metrics.json`. |

**Đề xuất áp dụng:** Thêm một exporter module (phase sau) convert `HarnessLogEvent` → OTel span với OpenInference attributes. Giữ JSONL làm primary (theo quyết định ở `harness-observability.md`), OTel là optional export.

---

## 2. Evaluation frameworks

Liên quan `packages/harness-runtime/src/eval/eval-harness.js`, [`improvement-matrix.md`](./improvement-matrix.md).

| Paper | Venue / Year | Liên quan với harness |
|---|---|---|
| [AgentBench: Evaluating LLMs as Agents](https://arxiv.org/abs/2308.03688) | ICLR 2024 | Định nghĩa contract giữa environment-harness và task-success metrics. Hữu ích cho việc chuẩn hóa `eval`. |
| [AgentBoard: Analytical Evaluation of Multi-turn LLM Agents](https://arxiv.org/abs/2401.13178) | 2024 | **Quan trọng:** lập luận rằng chỉ đo "final success rate" giấu đi dynamics. Cung cấp per-step progress reward — đúng hướng cho `eval` + `reflection`. |
| [SWE-bench: Can LM Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770) | ICLR 2024 | Pipeline "deterministic checkout → agent run → test exec → grade" — chính là flow `apply_started → test_finished → eval_finished`. |
| [SWE-bench Verified](https://www.swebench.com/) | 2024 | Subset đã human-validate. Ground-truth set để đánh giá proposal đúng/sai. |
| [A Survey on LLM-as-a-Judge](https://arxiv.org/abs/2411.15594) | 2024 | Kỹ thuật + biases của LLM judge. Liên quan trực tiếp `reflection/reflection.js` — khi dùng LLM route proposal, cần biết các bẫy (position/verbosity bias). |
| [Judging LLM-as-a-Judge (MT-Bench)](https://arxiv.org/abs/2306.05685) | NeurIPS 2023 | Paper nền cho judge methodology (pairwise + single-answer judging). |
| [Let's Verify Step by Step](https://arxiv.org/abs/2305.20050) | OpenAI, ICLR 2024 | Process-reward model chấm từng bước. Cơ sở cho intermediate-step (trajectory) eval. |

**Đề xuất áp dụng:** `eval-harness.js` hiện có thể chỉ đo final outcome. Thêm **per-step progress metric** theo kiểu AgentBoard (ví dụ % task subgoal đạt) để phát hiện proposal "đúng kết quả, sai quá trình".

---

## 3. Determinism & reproducibility / replay

Liên quan `session-log-format.md`, `packages/harness-runtime/src/storage/cache-writer.js`.

| Paper | Year | Liên quan với harness |
|---|---|---|
| [Causal Agent Replay: Counterfactual Attribution for LLM-Agent Failures](https://arxiv.org/abs/2606.08275) | 2026 | Mô hình agent run là "editable recording" + counterfactual để tìm step gây fail. **Rất phù hợp** với `rawRef` + `inspect --entry` — harness đã có rawRef, có thể build replay/what-if lên trên. |
| [SWE-Gym](https://arxiv.org/abs/2412.21139) | 2024 | Môi trường train+eval tái sử dụng được. Liên quan nếu muốn thu thập session logs làm training data. |
| [What Twelve LLM Agent Benchmark Papers Disclose (open scoring schema)](https://arxiv.org/abs/2605.21404) | 2026 | Liệt kê các field reproducibility (harness version, sampling params, subset) cần log mỗi run. **Đối chiếu `manifest.json`** — có thể thiếu vài field (model sampling params, harness version). |

---

## 4. Agent harness engineering

Nhóm nói đúng về "harness" — nên đọc đầu tiên vì cùng ngôn ngữ với codebase này.

| Paper | Year | Liên quan với harness |
|---|---|---|
| [SWE-agent: Agent-Computer Interfaces Enable Automated SE](https://arxiv.org/abs/2405.15793) | NeurIPS 2024 | Chứng minh **interface design** giữa agent và computer (tức harness) quyết định performance hơn model. Paper nền cho việc đầu tư vào harness. |
| [OpenHands (OpenDevin)](https://arxiv.org/abs/2407.16741) | 2024 | Event-stream runtime + sandboxed exec + protocol. So sánh kiến trúc với `events.jsonl` của harness. |
| [AutoHarness: Automatically Synthesizing a Code Harness](https://arxiv.org/abs/2603.03329) | Google DeepMind, 2026 | Chứng minh auto-synthesize harness giảm đáng kể action bị cấm. **Đọc đầu tiên** — cùng đề tài. |
| [Code as Agent Harness](https://arxiv.org/abs/2605.18747) | 2026 | Framing code làm substrate cho agent reasoning/verification. Conceptual cho harness code-based. |
| [From Prompts to Contracts: Harness Engineering for Auditable Enterprise LLM Agents](https://arxiv.org/abs/2607.08028) | 2026 | Treat harness requirements thành auditable contracts (governance/approval). **Map trực tiếp sang `audit` log stream + `proposals/lifecycle.js`.** |
| [CoALA: Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427) | TMLR 2024 | Taxonomy agent architecture (perception/action/memory/policy). Giúp đặt harness components vào "bản đồ". |
| [AutoGen: Multi-Agent Conversation](https://arxiv.org/abs/2308.08155) | COLM 2024 | Framework multi-agent conversation có controllable roles. |
| [OpenAgents](https://arxiv.org/abs/2310.10634) | 2023 | Platform agent (data/plugin/web) với monitoring baked in. |

---

## 5. Telemetry, failure modes & tool-call safety

Liên quan `packages/harness-runtime/src/safety/redaction.js`, `src/session/warnings.js`.

| Paper | Venue / Year | Liên quan với harness |
|---|---|---|
| [ToolEmu: Risks of LM Agents with an LM-Emulated Sandbox](https://arxiv.org/abs/2309.15817) | 2023 | Emulate tool exec để surface hallucinated/mis-specified tool call trước khi chạy thật. Liên quan `toolErrors`/`bashFailures` trong metrics. |
| [AgentDojo: Prompt Injection Attacks & Defenses](https://arxiv.org/abs/2406.13352) | NeurIPS 2024 | Eval tool-use agent chống untrusted output. Task-level + robustness (utility & security) metrics. |
| [Tool Forge: Validation-Carrying Toolchain](https://arxiv.org/abs/2605.28000) | 2026 | Mỗi tool là "validation-carrying capsule". Cho ý tưởng thêm validation metadata vào `tool` field của `HarnessEvent`. |
| [OSWorld](https://arxiv.org/abs/2404.07972) | NeurIPS 2024 | Mô hình sandbox isolation + deterministic observation capture. |
| [WebArena](https://arxiv.org/abs/2307.13854) | 2023 | Environment-as-eval-harness, deterministic task success. |

---

## Ưu tiên đọc (gợi ý cho harness này)

Dựa trên đối chiếu với `harness-observability.md` + `session-log-format.md` hiện có:

1. **AutoHarness (2603.03329)** + **From Prompts to Contracts (2607.08028)** — cùng chủ đề, validate hướng đi của harness.
2. **AgentBoard (2401.13178)** — thêm per-step eval; `eval-harness.js` hiện có thể chỉ đo outcome.
3. **OpenTelemetry GenAI semconv** + **OpenInference spec** — nếu muốn export trace sang Phoenix/LangSmith/Datadog sau này, align attribute name ngay từ đầu sẽ rẻ hơn.
4. **Causal Agent Replay (2606.08275)** — harness đã có `rawRef` + `inspect --entry`, đây là bước tiếp theo tự nhiên: replay + what-if.
5. **LLM-as-a-Judge Survey (2411.15594)** — trước khi dựa nhiều hơn vào `reflection/reflection.js`.

---

## Gap phân tích so với harness hiện tại

Đối chiếu literature với các file thiết kế hiện tại, các gap tiềm năng:

| Gap | Paper gợi ý | Vị trí áp dụng trong runtime |
|---|---|---|
| `eval-harness.js` có thể chỉ đo final outcome, thiếu per-step progress | AgentBoard, Let's Verify Step by Step | `src/eval/`, thêm progress metric vào `metrics.json` |
| Không có OTel/standard trace export | OTel GenAI semconv, OpenInference | Exporter module mới, alias attribute trong `HarnessLogEvent` |
| Chưa có replay/what-if debugging | Causal Agent Replay | Build trên `rawRef` + `inspect` |
| `manifest.json` có thể thiếu harness version + sampling params | Open scoring schema paper | `src/session/parse-session.js`, thêm field vào `SessionManifest` |
| Tool-call validation chủ yếu post-hoc (đếm `toolErrors`) | ToolEmu, Tool Forge | `src/safety/`, thêm pre-exec validation signal |
| Audit log có nhưng chưa framed thành "contracts" | From Prompts to Contracts | `src/proposals/lifecycle.js`, document approval contract |

---

## Ghi chú phương pháp

- Các arXiv ID trong tài liệu này được tổng hợp từ search trực tiếp arXiv abstract pages. ID năm 2026 còn mới, nên verify lại link trước khi cite vào tài liệu chính thức hoặc `_rules.md`.
- Tài liệu này là research note (design note), không phải reviewed prompt rule. Không thay thế `_rules.md`. Nếu muốn formal hóa bất kỳ gap nào, đi qua proposal workflow của harness.
