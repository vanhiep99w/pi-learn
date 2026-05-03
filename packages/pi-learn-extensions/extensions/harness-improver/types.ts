// Shared types cho harness-improver extension
// Lấy cảm hứng từ Harness Self-Improvement (Phase 7.2):
//   1. OBSERVE  → log mọi action (custom action log)
//   2. EVALUATE → analyzer tìm pattern xấu
//   3. ENCODE   → suggester đưa ra suggestions có cấu trúc
//   4. APPLY    → user chọn → applier ghi vào AGENTS.md/skills/extensions

export type ActionLogEntry = {
  ts: string;                  // ISO timestamp
  sessionId?: string;          // Pi session id (nếu lấy được)
  cwd: string;                 // working directory tại lúc log
  kind:
    | "tool_call"
    | "tool_result"
    | "tool_error"
    | "agent_start"
    | "agent_end"
    | "session_start"
    | "session_shutdown"
    | "user_input"
    | "extension_error";
  toolName?: string;
  toolCallId?: string;
  durationMs?: number;
  isError?: boolean;
  // Tóm tắt input/output (đã truncate) — không lưu raw để giữ log nhẹ
  inputSummary?: string;
  outputSummary?: string;
  errorMessage?: string;
  meta?: Record<string, any>;
};

export type ScanReport = {
  cwd: string;
  agentsMd: { path: string; bytes: number; sections: string[] } | null;
  skills: { dir: string; files: string[] };
  extensions: { dir: string; files: string[] };
  agents: { dir: string; files: string[] };
  themes: { dir: string; files: string[] };
  workflows: { dir: string; files: string[] };
  settings: { path: string; theme?: string } | null;
  notes: string[];
};

export type IssuePattern =
  | "repeated_tool_failure"
  | "long_running_tool"
  | "frequent_bash_for_search"
  | "unused_tool"
  | "missing_skill_for_recurring_task"
  | "ask_user_overuse"
  | "context_thrash"
  | "extension_error_recurrence"
  | "stale_agents_md"
  | "no_logs_yet";

export type Suggestion = {
  id: string;                            // ngắn, vd "S-001"
  priority: "high" | "medium" | "low";
  pattern: IssuePattern;
  target:
    | "AGENTS.md"
    | "skill"
    | "extension"
    | "agent"
    | "settings"
    | "new-skill"
    | "new-extension"
    | "new-doc";
  targetPath?: string;                   // file đề xuất sửa/tạo (relative cwd)
  title: string;                         // 1 dòng tóm tắt
  problem: string;                       // vấn đề là gì
  whenItHappens: string;                 // xảy ra khi nào (trigger)
  impact: string;                        // ảnh hưởng ra sao
  evidence: string[];                    // dẫn chứng từ log (đã trích)
  proposedFix: string;                   // mô tả hướng sửa
  patch?: {                              // (optional) nội dung cụ thể
    mode: "append" | "create" | "replace_section";
    section?: string;                    // tên section (cho replace_section)
    content: string;                     // markdown / text sẽ ghi
  };
};
