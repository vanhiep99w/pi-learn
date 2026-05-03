// Custom action logger.
// Ghi đè/ghi thêm các sự kiện quan trọng của Pi vào JSONL để analyzer đọc lại sau.
// Mục tiêu: nhẹ, append-only, không block agent.
import * as fs from "node:fs";
import type { ActionLogEntry } from "./types";
import { ensureLogDir, todayLogFile, workspaceRoot } from "./paths";

const MAX_FIELD = 600;       // truncate input/output để log không phình to
const inflight = new Map<string, number>();   // toolCallId → start ts

function clip(s: any): string {
  try {
    const str = typeof s === "string" ? s : JSON.stringify(s);
    if (!str) return "";
    return str.length > MAX_FIELD ? str.slice(0, MAX_FIELD) + "…" : str;
  } catch {
    return "[unserializable]";
  }
}

export function appendLog(entry: Omit<ActionLogEntry, "ts" | "cwd">) {
  try {
    ensureLogDir();
    const full: ActionLogEntry = {
      ts: new Date().toISOString(),
      cwd: workspaceRoot(),
      ...entry,
    };
    fs.appendFileSync(todayLogFile(), JSON.stringify(full) + "\n", "utf8");
  } catch {
    // Không bao giờ throw từ logger — agent phải chạy được dù log fail
  }
}

export function markToolStart(toolCallId: string) {
  inflight.set(toolCallId, Date.now());
}

export function markToolEnd(toolCallId: string): number | undefined {
  const start = inflight.get(toolCallId);
  if (!start) return undefined;
  inflight.delete(toolCallId);
  return Date.now() - start;
}

export function logToolCall(toolName: string, toolCallId: string, input: any) {
  markToolStart(toolCallId);
  appendLog({
    kind: "tool_call",
    toolName,
    toolCallId,
    inputSummary: clip(input),
  });
}

export function logToolResult(
  toolName: string,
  toolCallId: string,
  input: any,
  output: any,
  isError: boolean,
  errorMessage?: string,
) {
  const durationMs = markToolEnd(toolCallId);
  appendLog({
    kind: isError ? "tool_error" : "tool_result",
    toolName,
    toolCallId,
    inputSummary: clip(input),
    outputSummary: clip(output),
    isError,
    errorMessage: errorMessage ? clip(errorMessage) : undefined,
    durationMs,
  });
}

export function logSimple(
  kind: ActionLogEntry["kind"],
  meta?: Record<string, any>,
) {
  appendLog({ kind, meta });
}
