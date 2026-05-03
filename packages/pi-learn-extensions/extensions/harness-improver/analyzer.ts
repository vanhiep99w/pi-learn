// Analyzer: đọc lại action log + Pi sessions, đo lường các metric đơn giản
// để suggester có dữ liệu sinh suggestion.
import * as fs from "node:fs";
import type { ActionLogEntry, IssuePattern } from "./types";
import { listLogFiles, piSessionsDir } from "./paths";

export type AnalysisResult = {
  totalEvents: number;
  fromFiles: string[];
  byTool: Record<string, ToolStats>;
  errorClusters: ErrorCluster[];
  slowTools: { toolName: string; p95Ms: number; samples: number }[];
  bashSearchGuesses: BashSearchGuess[];
  recurringTopics: RecurringTopic[];
  contextThrash: { switches: number; restarts: number };
  extensionErrors: { message: string; count: number }[];
  hints: { pattern: IssuePattern; detail: string }[];
};

export type ToolStats = {
  calls: number;
  errors: number;
  errorRate: number;
  avgDurationMs: number;
};

export type ErrorCluster = {
  toolName: string;
  signature: string;          // chuẩn hoá để gom error cùng loại
  count: number;
  example: string;            // 1 errorMessage gốc
};

export type BashSearchGuess = {
  command: string;
  count: number;
  suggestion: "use grep tool" | "use find tool" | "use rg" | "use read tool";
};

export type RecurringTopic = {
  keyword: string;
  count: number;
  toolsUsed: string[];
};

function readAllLogs(): { entries: ActionLogEntry[]; files: string[] } {
  const files = listLogFiles();
  const out: ActionLogEntry[] = [];
  for (const f of files) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      for (const line of txt.split("\n")) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch { /* skip bad line */ }
      }
    } catch { /* skip unreadable file */ }
  }
  return { entries: out, files };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// chuẩn hoá error message: bỏ số/path → thành signature gom được
function errorSignature(s: string): string {
  return s
    .replace(/\d+/g, "N")
    .replace(/\/[^\s]+/g, "/PATH")
    .replace(/0x[0-9a-fA-F]+/g, "0xN")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function classifyBashCommand(cmd: string): BashSearchGuess["suggestion"] | null {
  const c = cmd.toLowerCase();
  if (/\bgrep\s+-r\b/.test(c) || /\begrep\s+-r\b/.test(c)) return "use rg";
  if (/\bfind\s+\.\s+-name\b/.test(c)) return "use find tool";
  if (/^\s*cat\s+\S+$/.test(c)) return "use read tool";
  if (/^\s*head\s+\S+$/.test(c)) return "use read tool";
  if (/^\s*tail\s+\S+$/.test(c)) return "use read tool";
  if (/\bls\s+-l/.test(c)) return "use grep tool";  // ls thường để khám phá → ls/grep tool có thể tốt hơn
  return null;
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","should","could","may","might","must","shall","can",
  "this","that","these","those","i","you","he","she","it","we","they",
  "what","which","who","whom","whose","when","where","why","how",
  "tôi","bạn","của","và","hay","hoặc","là","có","cần","để","cho","từ","trong","trên",
  "muốn","làm","gì","như","thế","nào","sao","tại","vì","khi","đã","đang","sẽ","được",
]);

function tokenize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/\s+/)
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
}

export function analyze(): AnalysisResult {
  const { entries, files } = readAllLogs();

  const byTool: Record<string, { calls: number; errors: number; durations: number[] }> = {};
  const errBuckets = new Map<string, { count: number; example: string; toolName: string }>();
  const bashCmdGuesses = new Map<string, { count: number; suggestion: BashSearchGuess["suggestion"] }>();
  const topicCounter = new Map<string, { count: number; tools: Set<string> }>();
  const extErrCounter = new Map<string, number>();

  let switches = 0;
  let restarts = 0;

  for (const e of entries) {
    if (e.kind === "session_start")    restarts++;
    if (e.kind === "session_shutdown") switches++;
    if (e.kind === "extension_error" && e.errorMessage) {
      const sig = errorSignature(e.errorMessage);
      extErrCounter.set(sig, (extErrCounter.get(sig) ?? 0) + 1);
    }
    if (e.toolName) {
      const t = byTool[e.toolName] ??= { calls: 0, errors: 0, durations: [] };
      if (e.kind === "tool_call") t.calls++;
      if (e.kind === "tool_error") t.errors++;
      if (typeof e.durationMs === "number") t.durations.push(e.durationMs);
    }
    if (e.kind === "tool_error" && e.toolName && e.errorMessage) {
      const sig = errorSignature(e.errorMessage);
      const key = `${e.toolName}::${sig}`;
      const cur = errBuckets.get(key);
      if (cur) cur.count++;
      else errBuckets.set(key, { count: 1, example: e.errorMessage, toolName: e.toolName });
    }
    if (e.kind === "tool_call" && e.toolName === "bash" && typeof e.inputSummary === "string") {
      // try parse the json-stringified input or fall back to substring
      let cmd = e.inputSummary;
      try {
        const parsed = JSON.parse(e.inputSummary);
        if (parsed && typeof parsed.command === "string") cmd = parsed.command;
      } catch { /* leave as-is */ }
      const guess = classifyBashCommand(cmd);
      if (guess) {
        const key = cmd.slice(0, 80);
        const cur = bashCmdGuesses.get(key);
        if (cur) cur.count++;
        else bashCmdGuesses.set(key, { count: 1, suggestion: guess });
      }
    }
    if (e.kind === "user_input" && e.inputSummary) {
      const tokens = tokenize(e.inputSummary);
      const seen = new Set<string>();
      for (const t of tokens) {
        if (seen.has(t)) continue;
        seen.add(t);
        const cur = topicCounter.get(t) ?? { count: 0, tools: new Set() };
        cur.count++;
        topicCounter.set(t, cur);
      }
    }
  }

  // join topics with tool usage following the same input
  // (cheap heuristic: tools called within next 5 events)
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].kind !== "user_input" || !entries[i].inputSummary) continue;
    const tokens = new Set(tokenize(entries[i].inputSummary!));
    for (let j = i + 1; j < Math.min(entries.length, i + 6); j++) {
      const tn = entries[j].toolName;
      if (!tn) continue;
      for (const t of tokens) {
        const cur = topicCounter.get(t);
        if (cur) cur.tools.add(tn);
      }
    }
  }

  const byToolStats: Record<string, ToolStats> = {};
  const slow: { toolName: string; p95Ms: number; samples: number }[] = [];
  for (const [name, t] of Object.entries(byTool)) {
    const avg = t.durations.length ? Math.round(t.durations.reduce((a, b) => a + b, 0) / t.durations.length) : 0;
    byToolStats[name] = {
      calls: t.calls,
      errors: t.errors,
      errorRate: t.calls ? +(t.errors / t.calls).toFixed(2) : 0,
      avgDurationMs: avg,
    };
    if (t.durations.length >= 3) {
      const p95 = percentile(t.durations, 95);
      if (p95 >= 5000) slow.push({ toolName: name, p95Ms: p95, samples: t.durations.length });
    }
  }
  slow.sort((a, b) => b.p95Ms - a.p95Ms);

  const errorClusters: ErrorCluster[] = [...errBuckets.entries()]
    .map(([key, v]) => ({
      toolName: v.toolName,
      signature: key.split("::").slice(1).join("::"),
      count: v.count,
      example: v.example,
    }))
    .filter(c => c.count >= 2)
    .sort((a, b) => b.count - a.count);

  const bashGuesses: BashSearchGuess[] = [...bashCmdGuesses.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([cmd, v]) => ({ command: cmd, count: v.count, suggestion: v.suggestion }))
    .sort((a, b) => b.count - a.count);

  const recurring: RecurringTopic[] = [...topicCounter.entries()]
    .filter(([, v]) => v.count >= 3)
    .map(([k, v]) => ({ keyword: k, count: v.count, toolsUsed: [...v.tools] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const extErrors = [...extErrCounter.entries()]
    .filter(([, c]) => c >= 2)
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count);

  const hints: { pattern: IssuePattern; detail: string }[] = [];
  if (entries.length === 0) hints.push({ pattern: "no_logs_yet", detail: "Chưa có action log — cần chạy Pi vài lần để thu thập data." });
  for (const c of errorClusters) hints.push({ pattern: "repeated_tool_failure", detail: `${c.toolName} fail ${c.count} lần với pattern: ${c.signature}` });
  for (const s of slow) hints.push({ pattern: "long_running_tool", detail: `${s.toolName} p95=${s.p95Ms}ms (n=${s.samples})` });
  for (const b of bashGuesses) hints.push({ pattern: "frequent_bash_for_search", detail: `bash "${b.command}" lặp ${b.count} lần — ${b.suggestion}` });
  for (const r of recurring) hints.push({ pattern: "missing_skill_for_recurring_task", detail: `chủ đề "${r.keyword}" lặp ${r.count} lần (tools: ${r.toolsUsed.join(", ") || "n/a"})` });
  for (const x of extErrors) hints.push({ pattern: "extension_error_recurrence", detail: `extension error "${x.message}" xuất hiện ${x.count} lần` });
  if (switches >= 5) hints.push({ pattern: "context_thrash", detail: `${switches} session shutdown / ${restarts} session start — nhiều switch ngắn` });

  // Tools "không dùng" — check vs scan extensions list (caller sẽ join sau)
  return {
    totalEvents: entries.length,
    fromFiles: files,
    byTool: byToolStats,
    errorClusters,
    slowTools: slow,
    bashSearchGuesses: bashGuesses,
    recurringTopics: recurring,
    contextThrash: { switches, restarts },
    extensionErrors: extErrors,
    hints,
  };
}

export function summarizeAnalysis(a: AnalysisResult): string {
  const lines: string[] = [];
  lines.push(`# Analysis Summary — ${a.totalEvents} events from ${a.fromFiles.length} log files`);
  lines.push("");

  lines.push("## Tools usage");
  const tools = Object.entries(a.byTool).sort((x, y) => y[1].calls - x[1].calls);
  if (tools.length === 0) lines.push("- (không có tool call nào)");
  for (const [name, s] of tools) {
    lines.push(`- **${name}** — ${s.calls} calls · ${s.errors} errors (${(s.errorRate * 100).toFixed(0)}%) · avg ${s.avgDurationMs}ms`);
  }

  if (a.errorClusters.length) {
    lines.push("");
    lines.push("## Repeated errors");
    for (const c of a.errorClusters.slice(0, 5)) {
      lines.push(`- **${c.toolName}** ×${c.count}: \`${c.signature.slice(0, 120)}\``);
    }
  }
  if (a.slowTools.length) {
    lines.push("");
    lines.push("## Slow tools (p95 ≥ 5s)");
    for (const s of a.slowTools.slice(0, 5)) {
      lines.push(`- **${s.toolName}** — p95 ${s.p95Ms}ms (n=${s.samples})`);
    }
  }
  if (a.bashSearchGuesses.length) {
    lines.push("");
    lines.push("## Bash patterns có thể dùng tool tốt hơn");
    for (const b of a.bashSearchGuesses.slice(0, 5)) {
      lines.push(`- ×${b.count} \`${b.command}\` → **${b.suggestion}**`);
    }
  }
  if (a.recurringTopics.length) {
    lines.push("");
    lines.push("## Chủ đề lặp lại (candidate cho skill mới)");
    for (const r of a.recurringTopics.slice(0, 8)) {
      lines.push(`- **${r.keyword}** ×${r.count} (tools: ${r.toolsUsed.join(", ") || "n/a"})`);
    }
  }
  if (a.extensionErrors.length) {
    lines.push("");
    lines.push("## Extension errors");
    for (const x of a.extensionErrors) {
      lines.push(`- ×${x.count}: ${x.message}`);
    }
  }
  if (a.contextThrash.switches >= 5) {
    lines.push("");
    lines.push(`## Context thrash: ${a.contextThrash.switches} shutdowns / ${a.contextThrash.restarts} starts`);
  }
  // Pi sessions (chỉ count để tham khảo)
  const sessDir = piSessionsDir();
  if (sessDir) {
    try {
      const n = fs.readdirSync(sessDir).filter(f => f.endsWith(".jsonl")).length;
      lines.push("");
      lines.push(`> Pi sessions phát hiện được: ${n} file tại \`${sessDir}\``);
    } catch { /* ignore */ }
  }
  return lines.join("\n");
}
