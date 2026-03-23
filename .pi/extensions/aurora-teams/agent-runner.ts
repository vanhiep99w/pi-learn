/**
 * agent-runner.ts — Spawn & monitor pi subprocess
 * Học từ official subagent: streaming JSON, usage tracking, abort propagation
 * Improve: retry với exponential backoff, context injection, thinking level
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfig } from "./agents.js";
import type { Task } from "./task-board.js";
import type { TeamMessage } from "./team-bus.js";

export interface UsageStats {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  context_tokens: number;
  turns: number;
}

export interface AgentResult {
  success: boolean;
  output: string;        // Final output text
  usage: UsageStats;
  model?: string;
  stop_reason?: string;
  error?: string;
  exit_code: number;
  duration_ms: number;
}

export type OnUpdate = (partial: { output: string; usage: UsageStats }) => void;
export type OnStep = (step: string) => void;  // Real-time hành động của agent

// Format tool call thành 1 dòng log có emoji
function formatToolCall(toolName: string, input: any): string {
  const icons: Record<string, string> = {
    read: "📖", write: "✏️",  edit: "🔧",
    bash: "🖥️",  grep: "🔍", find: "🔎",
    ls:   "📂",  glob: "📂", search: "🔍",
  };
  const icon = icons[toolName] ?? "⚙️";
  switch (toolName) {
    case "read":  return `${icon} read  ${input?.file_path ?? input?.path ?? ""}`;
    case "write": return `${icon} write ${input?.file_path ?? ""}`;
    case "edit":  return `${icon} edit  ${input?.file_path ?? ""}:${input?.start_line ?? "?"}-${input?.end_line ?? "?"}`;
    case "bash":  return `${icon} bash  ${String(input?.command ?? "").slice(0, 100).replace(/\n/g, " ; ")}`;
    case "grep":  return `${icon} grep  "${input?.pattern ?? input?.query ?? ""}" in ${input?.path ?? "."}`;
    case "find":  return `${icon} find  ${input?.path ?? "."} ${input?.pattern ? `"${input.pattern}"` : ""}`;
    case "ls":    return `${icon} ls    ${input?.path ?? "."}`;
    default:      return `${icon} ${toolName}  ${JSON.stringify(input ?? {}).slice(0, 100)}`;
  }
}

// ── Find pi binary ─────────────────────────────────────────────────
function getPiCommand(): { cmd: string; args: string[] } {
  const script = process.argv[1];
  if (script && fs.existsSync(script)) {
    return { cmd: process.execPath, args: [script] };
  }
  return { cmd: "pi", args: [] };
}

// ── Build system prompt injection ─────────────────────────────────
async function buildContextPrompt(
  agent: AgentConfig,
  task: Task,
  inbox: TeamMessage[],
  taskSummary: string,
  previousOutputs?: Record<string, string>
): Promise<string> {
  const lines: string[] = [
    `## Thông Tin Team`,
    ``,
    `**Vai trò của bạn:** ${agent.name} — ${agent.description}`,
    ``,
    `**Task của bạn:**`,
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    ``,
    `**Trạng thái Team:**`,
    taskSummary,
    ``,
  ];

  if (inbox.length > 0) {
    lines.push(`**Tin nhắn mới (${inbox.length}):**`);
    for (const msg of inbox) {
      lines.push(`- [${msg.from}] ${msg.content}`);
    }
    lines.push("");
  }

  if (previousOutputs && Object.keys(previousOutputs).length > 0) {
    lines.push(`**Kết quả từ bước trước:**`);
    for (const [key, val] of Object.entries(previousOutputs)) {
      const preview = val.length > 500 ? val.slice(0, 500) + "\n...(truncated)" : val;
      lines.push(`\n### ${key}:\n${preview}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Write temp file ────────────────────────────────────────────────
async function writeTmp(content: string, prefix: string): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `aurora-${prefix}-`));
  const file = path.join(dir, "prompt.md");
  await fs.promises.writeFile(file, content, { encoding: "utf-8", mode: 0o600 });
  return file;
}

// ── Core run function ──────────────────────────────────────────────
export async function runAgent(options: {
  agent: AgentConfig;
  task: Task;
  inbox?: TeamMessage[];
  taskSummary?: string;
  previousOutputs?: Record<string, string>;
  cwd?: string;
  signal?: AbortSignal;
  onUpdate?: OnUpdate;
  onStep?: OnStep;   // ← MỚI: fire-and-forget, không block agent
}): Promise<AgentResult> {
  const { agent, task, inbox = [], taskSummary = "", previousOutputs,
          cwd, signal, onUpdate, onStep } = options;
  const startTime = Date.now();

  // Build args
  const { cmd, args: baseArgs } = getPiCommand();
  const args = [...baseArgs, "--mode", "json", "-p", "--no-session"];

  if (agent.model) args.push("--model", agent.model);
  if (agent.tools?.length) args.push("--tools", agent.tools.join(","));
  if (agent.thinking) args.push("--thinking", agent.thinking);
  if (agent.max_turns) args.push("--max-turns", String(agent.max_turns));

  // Inject team context
  let tmpFile: string | null = null;
  let tmpDir: string | null = null;
  try {
    const contextPrompt = await buildContextPrompt(agent, task, inbox, taskSummary, previousOutputs);
    const extraPrompt = `${agent.system_prompt}\n\n${contextPrompt}`;
    tmpFile = await writeTmp(extraPrompt, agent.name);
    tmpDir = path.dirname(tmpFile);
    args.push("--append-system-prompt", tmpFile);
  } catch {
    // Continue without context injection
  }

  // Task as user message
  args.push(`${task.description}`);

  // Usage accumulator
  const usage: UsageStats = { input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0, context_tokens: 0, turns: 0 };
  let finalOutput = "";
  let model: string | undefined;
  let stopReason: string | undefined;
  let errorMessage: string | undefined;
  let stderr = "";

  const exitCode = await new Promise<number>((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: cwd ?? process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    let wasAborted = false;

    // Parse streaming JSON events từ subprocess
    // Chạy trong PARENT process — không ảnh hưởng gì đến subprocess agent
    const processLine = (line: string) => {
      if (!line.trim()) return;
      let evt: any;
      try { evt = JSON.parse(line); } catch { return; }

      // ── Tool bắt đầu: Pi emit "tool_execution_start" ──────────
      if (evt.type === "tool_execution_start") {
        const name = evt.toolName ?? "?";
        const input = evt.args ?? {};
        onStep?.(formatToolCall(name, input));
      }

      // ── Tool kết quả: Pi emit "tool_execution_end" ─────────────
      if (evt.type === "tool_execution_end") {
        const result = evt.result;
        let preview = "";
        if (result?.content) {
          const c = result.content;
          preview = typeof c === "string" ? c : (Array.isArray(c) ? (c[0]?.text ?? "") : "");
        }
        preview = preview.slice(0, 100).replace(/\n/g, " ");
        if (preview) onStep?.(`   ↳ ${preview}${preview.length >= 100 ? "..." : ""}`);
        if (evt.isError) onStep?.(`   ⚠ tool error: ${evt.toolName}`);
        onUpdate?.({ output: finalOutput, usage: { ...usage } });
      }

      // ── Agent đang suy nghĩ/viết: text streaming ──────────────
      if (evt.type === "message_update" && evt.assistantMessageEvent) {
        const ae = evt.assistantMessageEvent;
        // Log khi bắt đầu viết text mới (không log mỗi delta để tránh spam)
        if (ae.type === "text_start") {
          onStep?.(`💭 thinking...`);
        }
      }

      // ── Turn kết thúc: chứa full message + tool results ────────
      if (evt.type === "turn_end" && evt.message) {
        const msg = evt.message;
        // Log text preview của assistant
        for (const part of msg.content ?? []) {
          if (part.type === "text" && part.text) {
            // Lấy dòng đầu tiên có nội dung
            const lines = part.text.split("\n").filter((l: string) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
            const preview = (lines[0] ?? "").slice(0, 120);
            if (preview) onStep?.(`💬 ${preview}${preview.length >= 120 ? "..." : ""}`);
          }
        }
      }

      // ── Message end: cập nhật usage + final output ─────────────
      if (evt.type === "message_end" && evt.message) {
        const msg = evt.message;
        if (msg.role === "assistant") {
          usage.turns++;
          const u = msg.usage;
          if (u) {
            usage.input  += u.input  || 0;
            usage.output += u.output || 0;
            usage.cache_read  += u.cacheRead  || 0;
            usage.cache_write += u.cacheWrite || 0;
            usage.cost        += u.cost?.total || 0;
            usage.context_tokens = u.totalTokens || 0;
          }
          if (!model && msg.model) model = msg.model;
          if (msg.stopReason)    stopReason    = msg.stopReason;
          if (msg.errorMessage) errorMessage  = msg.errorMessage;
          for (const part of msg.content ?? []) {
            if (part.type === "text") finalOutput = part.text;
          }
          onUpdate?.({ output: finalOutput, usage: { ...usage } });
        }
      }
    };


    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      resolve(code ?? 0);
    });

    proc.on("error", () => resolve(1));

    // Abort support
    if (signal) {
      const kill = () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
      };
      if (signal.aborted) kill();
      else signal.addEventListener("abort", kill, { once: true });
    }
  });

  // Cleanup tmp
  try { if (tmpFile) fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  try { if (tmpDir) fs.rmdirSync(tmpDir); } catch { /* ignore */ }

  const isError = exitCode !== 0 || stopReason === "error" || stopReason === "aborted";

  return {
    success: !isError,
    output: finalOutput || "(no output)",
    usage,
    model,
    stop_reason: stopReason,
    error: isError ? (errorMessage || stderr || "Agent failed") : undefined,
    exit_code: exitCode,
    duration_ms: Date.now() - startTime,
  };
}

// ── Run with retry ─────────────────────────────────────────────────
export async function runAgentWithRetry(options: {
  agent: AgentConfig;
  task: Task;
  inbox?: TeamMessage[];
  taskSummary?: string;
  previousOutputs?: Record<string, string>;
  cwd?: string;
  signal?: AbortSignal;
  onUpdate?: OnUpdate;
  onStep?: OnStep;   // ← pass-through tới runAgent
  onRetry?: (attempt: number, maxRetries: number, error: string) => void;
}): Promise<AgentResult> {
  const maxRetries = options.agent.retry_on_fail ?? 2;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      options.onRetry?.(attempt, maxRetries, lastError);
      // Exponential backoff: 1s, 2s, 4s...
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }

    const result = await runAgent(options);
    if (result.success) return result;

    lastError = result.error ?? "Unknown error";
  }

  return {
    success: false,
    output: "(no output)",
    usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0, context_tokens: 0, turns: 0 },
    error: `Failed after ${maxRetries + 1} attempts: ${lastError}`,
    exit_code: 1,
    duration_ms: 0,
  };
}

// ── Format usage stats ─────────────────────────────────────────────
export function formatUsage(usage: UsageStats, model?: string): string {
  const fmt = (n: number) => n < 1000 ? String(n) : n < 10000 ? `${(n/1000).toFixed(1)}k` : `${Math.round(n/1000)}k`;
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns}t`);
  if (usage.input) parts.push(`↑${fmt(usage.input)}`);
  if (usage.output) parts.push(`↓${fmt(usage.output)}`);
  if (usage.cache_read) parts.push(`R${fmt(usage.cache_read)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model.split("/").pop() ?? model);
  return parts.join(" ");
}
