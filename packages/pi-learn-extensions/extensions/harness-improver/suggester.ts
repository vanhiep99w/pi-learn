// Suggester: từ analysis + scan → sinh suggestions có cấu trúc.
// Mỗi suggestion phải nêu RÕ: vấn đề · khi nào gặp · ảnh hưởng · hướng khắc phục.
// User sẽ đọc và chọn cái nào đáng improve.
import * as path from "node:path";
import type { Suggestion } from "./types";
import type { AnalysisResult } from "./analyzer";
import type { ScanReport } from "./scanner";

let counter = 0;
function nextId(): string {
  counter++;
  return `S-${String(counter).padStart(3, "0")}`;
}

function rel(p: string, cwd: string): string {
  return path.relative(cwd, p) || p;
}

export function generateSuggestions(scan: ScanReport, an: AnalysisResult): Suggestion[] {
  counter = 0;
  const out: Suggestion[] = [];
  const cwd = scan.cwd;

  // ── 0. Chưa có log → suggest enable + chạy task ─────────────────────────
  if (an.totalEvents === 0) {
    out.push({
      id: nextId(),
      priority: "high",
      pattern: "no_logs_yet",
      target: "AGENTS.md",
      title: "Chưa có log nào — chạy vài tác vụ thật để harness-improver có dữ liệu",
      problem: "Action log của extension đang rỗng nên không có cơ sở phân tích.",
      whenItHappens: "Mỗi lần gọi `harness_analyze` hoặc `harness_suggest` ngay sau khi cài extension.",
      impact: "Không thể đưa ra suggestion dựa trên hành vi thực tế của agent.",
      evidence: ["Không tìm thấy file `.pi/logs/harness/actions-*.jsonl`"],
      proposedFix:
        "Restart Pi để extension chạy → dùng Pi như bình thường vài session. Sau đó gọi lại `harness_analyze`. " +
        "Hoặc kiểm tra extension có được load không bằng `pi --list-extensions`.",
    });
    return out;
  }

  // ── 1. Repeated tool failures → AGENTS.md anti-patterns ────────────────
  for (const c of an.errorClusters.slice(0, 5)) {
    out.push({
      id: nextId(),
      priority: c.count >= 5 ? "high" : "medium",
      pattern: "repeated_tool_failure",
      target: "AGENTS.md",
      targetPath: scan.agentsMd ? rel(scan.agentsMd.path, cwd) : "AGENTS.md",
      title: `Encode anti-pattern cho lỗi lặp ở tool \`${c.toolName}\` (×${c.count})`,
      problem: `Tool \`${c.toolName}\` fail ${c.count} lần với cùng signature: \`${c.signature.slice(0, 140)}\`.`,
      whenItHappens: `Khi agent gọi \`${c.toolName}\` trong các tình huống tương tự — tái diễn nhiều lần thay vì học từ lần đầu.`,
      impact: "Mỗi failure tốn ≥1 turn, có thể đẩy agent vào loop. Ngoài ra làm context phình ra với error message không cần thiết.",
      evidence: [
        `Error mẫu: ${c.example.slice(0, 200)}`,
        `Số lần lặp: ${c.count}`,
      ],
      proposedFix:
        `Thêm vào AGENTS.md section "## Anti-patterns (Learned)" một mục:\n` +
        `- Khi dùng \`${c.toolName}\`, NẾU gặp \`${c.signature.slice(0, 80)}\` → KHÔNG retry y hệt; dừng lại và đổi cách tiếp cận.\n` +
        `Có thể bổ sung hook \`tool_call\` để cảnh báo trước khi gọi.`,
      patch: {
        mode: "append",
        section: "Anti-patterns (Learned)",
        content: `\n## Anti-patterns (Learned)\n\n- ❌ \`${c.toolName}\` thường fail với \`${c.signature.slice(0, 120)}\` (đã gặp ${c.count} lần). Trước khi gọi, kiểm tra điều kiện đầu vào hoặc đổi tool thay thế.\n`,
      },
    });
  }

  // ── 2. Bash dùng cho search → suggest grep/find/read tool ──────────────
  if (an.bashSearchGuesses.length) {
    const top = an.bashSearchGuesses.slice(0, 5);
    out.push({
      id: nextId(),
      priority: "medium",
      pattern: "frequent_bash_for_search",
      target: "AGENTS.md",
      targetPath: scan.agentsMd ? rel(scan.agentsMd.path, cwd) : "AGENTS.md",
      title: `Thêm guideline: dùng tool chuyên dụng thay vì \`bash\` cho ${top.length} pattern lặp`,
      problem: "Agent đang gọi `bash` cho các tác vụ mà tool chuyên dụng (grep/find/read/rg) làm tốt hơn.",
      whenItHappens: "Khi agent cần search file, đọc file ngắn, list directory — phản xạ là viết bash command.",
      impact: "Bash output không có structure → agent khó parse, tốn token. Tool chuyên dụng trả structured result + nhanh hơn.",
      evidence: top.map(b => `×${b.count}  ${b.command}  → ${b.suggestion}`),
      proposedFix:
        "Thêm section vào AGENTS.md liệt kê bash anti-patterns: " +
        top.map(b => `\`${b.command.slice(0, 50)}\` → ${b.suggestion}`).join("; ") + ". " +
        "Cân nhắc enable thêm tool `grep`, `find`, `ls` mặc định trong settings.",
      patch: {
        mode: "append",
        section: "Tool selection",
        content:
          `\n## Tool selection\n\n` +
          `Tránh dùng \`bash\` cho các tác vụ sau, hãy dùng tool chuyên dụng:\n` +
          top.map(b => `- \`${b.command.slice(0, 60)}\` → ${b.suggestion}`).join("\n") + "\n",
      },
    });
  }

  // ── 3. Slow tools → suggest cache / split / async ──────────────────────
  for (const s of an.slowTools.slice(0, 3)) {
    out.push({
      id: nextId(),
      priority: s.p95Ms >= 30000 ? "high" : "medium",
      pattern: "long_running_tool",
      target: "AGENTS.md",
      targetPath: scan.agentsMd ? rel(scan.agentsMd.path, cwd) : "AGENTS.md",
      title: `Tối ưu tool chậm: \`${s.toolName}\` p95=${s.p95Ms}ms`,
      problem: `Tool \`${s.toolName}\` thường mất ≥${s.p95Ms}ms (đo trên ${s.samples} mẫu).`,
      whenItHappens: "Trong mọi turn dùng tool này — accumulate latency làm agent chậm rõ rệt.",
      impact: "Agent block chờ tool, user phải đợi, model context anxiety tăng vì gần limit khi response về.",
      evidence: [`p95 ${s.p95Ms}ms qua ${s.samples} samples`],
      proposedFix:
        "Tuỳ tool: " +
        "(a) nếu là `bash`/script → split công việc thành nhiều bước nhỏ; " +
        "(b) nếu là web/network tool → thêm cache TTL trong extension; " +
        "(c) nếu là build/test → chạy nền + cho agent poll.",
    });
  }

  // ── 4. Recurring topics → suggest skill mới ────────────────────────────
  const top3 = an.recurringTopics.slice(0, 3);
  for (const r of top3) {
    const skillName = r.keyword.replace(/[^a-z0-9-]/g, "-").slice(0, 30);
    const skillPath = `.pi/skills/${skillName}.md`;
    out.push({
      id: nextId(),
      priority: r.count >= 6 ? "high" : "medium",
      pattern: "missing_skill_for_recurring_task",
      target: "new-skill",
      targetPath: skillPath,
      title: `Tạo skill cho chủ đề lặp lại: "${r.keyword}" (${r.count} lần)`,
      problem: `User hỏi/đề cập chủ đề "${r.keyword}" ${r.count} lần nhưng chưa có skill encode best practice cho nó.`,
      whenItHappens: `Mỗi lần user gõ prompt liên quan đến "${r.keyword}".`,
      impact: "Agent phải khám phá lại từ đầu mỗi lần → tốn token, dễ làm sai khác giữa các lần.",
      evidence: [
        `Tần suất: ${r.count}`,
        `Tools thường dùng cùng: ${r.toolsUsed.join(", ") || "n/a"}`,
      ],
      proposedFix:
        `Tạo file ${skillPath} (Markdown) đóng vai trò skill — gồm: trigger keywords, bước thực hiện chuẩn, ví dụ. ` +
        `Pi sẽ progressively disclose khi prompt match.`,
      patch: {
        mode: "create",
        content:
          `# ${r.keyword} skill\n\n` +
          `> Auto-generated draft từ harness-improver.\n` +
          `> Lý do: chủ đề "${r.keyword}" lặp ${r.count} lần.\n\n` +
          `## Khi nào dùng\n\nKhi prompt chứa: ${r.keyword}\n\n` +
          `## Quy trình chuẩn\n\n1. (TODO) Bước 1\n2. (TODO) Bước 2\n3. (TODO) Bước 3\n\n` +
          `## Tools thường dùng\n\n${r.toolsUsed.map(t => `- ${t}`).join("\n") || "- (n/a)"}\n\n` +
          `## Ví dụ\n\n(TODO)\n`,
      },
    });
  }

  // ── 5. Extension errors lặp lại ────────────────────────────────────────
  for (const x of an.extensionErrors.slice(0, 3)) {
    out.push({
      id: nextId(),
      priority: x.count >= 5 ? "high" : "medium",
      pattern: "extension_error_recurrence",
      target: "extension",
      title: `Sửa extension error lặp ×${x.count}: ${x.message.slice(0, 80)}`,
      problem: `Một extension liên tục throw lỗi "${x.message.slice(0, 200)}".`,
      whenItHappens: "Trong các session gần đây — log có ≥2 lần xuất hiện cùng signature.",
      impact: "Mỗi lần error có thể disable feature đó tạm thời, khiến agent thiếu tool/hook đáng tin cậy.",
      evidence: [`${x.count} lần xuất hiện trong action log`],
      proposedFix:
        "Mở `.pi/extensions/` của project, grep error message để tìm extension nào throw. " +
        "Cân nhắc bọc handler trong try/catch và dùng `ctx.ui?.notify` (optional chaining) như AGENTS.md đã chỉ định.",
    });
  }

  // ── 6. Tools đã đăng ký nhưng không được dùng ──────────────────────────
  // Heuristic đơn giản: nếu folder extension có nhưng tool name không xuất hiện trong byTool
  const knownToolNames = new Set(Object.keys(an.byTool));
  for (const ext of scan.extensions.files) {
    const guess = ext.replace(/\/$/, "").replace(/\.ts$/, "");
    if (!knownToolNames.has(guess) && an.totalEvents >= 20) {
      // Chỉ warn khi đã có đủ data
      out.push({
        id: nextId(),
        priority: "low",
        pattern: "unused_tool",
        target: "extension",
        targetPath: `.pi/extensions/${ext}`,
        title: `Extension \`${ext}\` chưa được dùng trong dataset`,
        problem: `Extension \`${ext}\` đã được cài nhưng không thấy tool nào của nó được gọi trong ${an.totalEvents} events.`,
        whenItHappens: "Quan sát qua nhiều session — không có evidence agent biết/cần tool này.",
        impact: "Mỗi tool description chiếm instruction budget. Tool không dùng = pure overhead.",
        evidence: [`Không có entry tool_call nào match \`${guess}\``],
        proposedFix:
          `Hoặc (a) bổ sung hint trong AGENTS.md để agent biết khi nào nên dùng; ` +
          `hoặc (b) gỡ extension nếu không còn cần (chỉnh \`.pi/settings.json\`).`,
      });
    }
  }

  // ── 7. Context thrash ──────────────────────────────────────────────────
  if (an.contextThrash.switches >= 5) {
    out.push({
      id: nextId(),
      priority: "low",
      pattern: "context_thrash",
      target: "settings",
      targetPath: ".pi/settings.json",
      title: `Phát hiện ${an.contextThrash.switches} session shutdown — context bị reset nhiều`,
      problem: "Số lần shutdown/restart cao, dấu hiệu user phải /new hoặc thoát giữa chừng nhiều.",
      whenItHappens: "Khi context window đầy hoặc khi agent đi sai hướng và user tạo session mới.",
      impact: "Mất accumulated context giữa các task → agent học lại từ đầu.",
      evidence: [`session_shutdown: ${an.contextThrash.switches}`, `session_start: ${an.contextThrash.restarts}`],
      proposedFix:
        "Cân nhắc bật auto-compaction trong `.pi/settings.json`, hoặc dùng `/compact` chủ động trước khi đầy. " +
        "Nếu nguyên nhân là agent đi sai hướng → cần củng cố AGENTS.md guidelines.",
    });
  }

  return out;
}

export function formatSuggestions(suggs: Suggestion[]): string {
  if (suggs.length === 0) return "Không có suggestion nào — harness của bạn đang ổn 🎉";
  const lines: string[] = [];
  lines.push(`# ${suggs.length} suggestions`);
  lines.push("");
  for (const s of suggs) {
    lines.push(`## ${s.id} · [${s.priority.toUpperCase()}] ${s.title}`);
    lines.push(`- **Target:** ${s.target}${s.targetPath ? ` → \`${s.targetPath}\`` : ""}`);
    lines.push(`- **Vấn đề:** ${s.problem}`);
    lines.push(`- **Khi nào gặp:** ${s.whenItHappens}`);
    lines.push(`- **Ảnh hưởng:** ${s.impact}`);
    lines.push(`- **Bằng chứng:**`);
    for (const e of s.evidence) lines.push(`  - ${e}`);
    lines.push(`- **Hướng khắc phục:** ${s.proposedFix}`);
    if (s.patch) {
      lines.push(`- **Patch (${s.patch.mode}${s.patch.section ? ` · ${s.patch.section}` : ""}):**`);
      lines.push("  ```");
      for (const l of s.patch.content.split("\n").slice(0, 12)) lines.push(`  ${l}`);
      if (s.patch.content.split("\n").length > 12) lines.push("  …(truncated)");
      lines.push("  ```");
    }
    lines.push("");
  }
  lines.push(`> Dùng \`harness_apply\` với mảng id để áp dụng. Ví dụ: \`harness_apply ids=["${suggs[0].id}"]\``);
  return lines.join("\n");
}
