// harness-improver — Pi extension self-improvement loop
// Lấy cảm hứng từ Harness Self-Improvement (Phase 7.2):
//   1. OBSERVE  — log mọi action vào .pi/logs/harness/actions-YYYY-MM-DD.jsonl
//   2. EVALUATE+SUGGEST — `harness_suggest` (hoặc /harness) gộp scan + analyze + suggest
//   3. APPLY    — user multiselect id (+ optional note) → ghi vào file (có backup)

import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

import { logToolCall, logToolResult, logSimple, appendLog } from "./logger";
import { scanWorkspace, formatScanReport } from "./scanner";
import { analyze, summarizeAnalysis } from "./analyzer";
import { generateSuggestions, formatSuggestions } from "./suggester";
import { applyOne, formatApplyResults } from "./applier";
import type { ApplyResult } from "./applier";
import type { Suggestion } from "./types";
import { ensureReportsDir, reportsDir, listLogFiles } from "./paths";

// In-memory cache: lưu suggestions của lần `harness_suggest` / `/harness` gần nhất
// để `harness_apply` có thể lookup theo id.
let lastSuggestions: Suggestion[] = [];

// ─────────────────────────────────────────────────────────────────────
// Helper: chạy full pipeline scan + analyze + suggest, cache lại.
// ─────────────────────────────────────────────────────────────────────
function runImprovementPipeline(opts?: { saveReport?: boolean }) {
  const scan = scanWorkspace();
  const an = analyze();
  const suggs = generateSuggestions(scan, an);
  // Sort: high → medium → low
  const order = { low: 0, medium: 1, high: 2 } as const;
  suggs.sort((x, y) => order[y.priority] - order[x.priority]);
  lastSuggestions = suggs;

  const text =
    formatScanReport(scan) +
    "\n\n---\n\n" +
    summarizeAnalysis(an) +
    "\n\n---\n\n" +
    formatSuggestions(suggs);

  if (opts?.saveReport !== false) {
    try {
      ensureReportsDir();
      const out = path.join(reportsDir(), `suggestions-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
      fs.writeFileSync(out, text, "utf8");
    } catch { /* không fail vì report */ }
  }

  return { scan, analysis: an, suggestions: suggs, text };
}

export default function (pi: ExtensionAPI) {
  // ─────────────────────────────────────────────────────────────────────
  // 1. EVENT HOOKS — log toàn bộ hành vi của Pi
  // ─────────────────────────────────────────────────────────────────────

  pi.on("session_start", (event: any) => {
    logSimple("session_start", { reason: event?.reason });
    pi.ctx?.ui?.notify("🪞 Harness Improver — gõ /harness để improve", 2000);
  });
  pi.on("session_shutdown", () => logSimple("session_shutdown"));
  pi.on("agent_start",      () => logSimple("agent_start"));
  pi.on("agent_end",        (event: any) => logSimple("agent_end", { reason: event?.reason }));

  pi.on("input", (event: any) => {
    const text = event?.input ?? event?.text ?? "";
    if (typeof text === "string" && text.trim()) {
      appendLog({ kind: "user_input", inputSummary: text.slice(0, 600) });
    }
  });

  pi.on("tool_call", (event: any) => {
    try {
      logToolCall(event.toolName, event.toolCallId, event.input);
    } catch (e: any) {
      appendLog({ kind: "extension_error", errorMessage: `tool_call hook: ${e?.message ?? e}` });
    }
  });

  pi.on("tool_result", (event: any) => {
    try {
      const errMsg = event.isError
        ? (event.content?.[0]?.text ?? event.error ?? "(error)")
        : undefined;
      logToolResult(
        event.toolName,
        event.toolCallId,
        event.input,
        event.content,
        !!event.isError,
        errMsg,
      );
    } catch (e: any) {
      appendLog({ kind: "extension_error", errorMessage: `tool_result hook: ${e?.message ?? e}` });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. TOOL: harness_suggest — ONE-STOP cho AI
  //    Gộp scan + analyze + suggest → cache, trả ra report đầy đủ.
  // ─────────────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "harness_suggest",
    label: "Harness Suggest",
    description:
      "One-stop tool cho self-improvement loop: tự scan harness components + analyze action log + sinh suggestions có cấu trúc " +
      "(vấn đề · khi nào gặp · ảnh hưởng · bằng chứng · hướng khắc phục · patch). " +
      "Cache suggestions để `harness_apply` lookup theo id. KHÔNG ghi file — chỉ đọc + đề xuất.",
    promptSnippet: "Use `harness_suggest` to scan + analyze + propose harness improvements in one call.",
    parameters: Type.Object({
      minPriority: Type.Optional(Type.String({ description: '"low" (default) | "medium" | "high"' })),
    }),
    async execute(_id: any, params: any) {
      const order = { low: 0, medium: 1, high: 2 } as const;
      const min = (params?.minPriority ?? "low") as keyof typeof order;
      const { suggestions, text } = runImprovementPipeline();
      const filtered = suggestions.filter(s => order[s.priority] >= order[min]);
      lastSuggestions = filtered;
      // Re-render text với suggestions đã filter
      const finalText = filtered.length === suggestions.length
        ? text
        : text.split("\n\n---\n\n").slice(0, 2).join("\n\n---\n\n") + "\n\n---\n\n" + formatSuggestions(filtered);
      return {
        content: [{ type: "text", text: finalText }],
        details: { kind: "suggestions", count: filtered.length, ids: filtered.map(s => s.id) },
      };
    },
    renderCall(_args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold("🪞 harness_suggest")), 0, 0);
    },
    renderResult(result: any, _ctx: any, theme: any) {
      const d = result.details;
      return new Text(theme.fg("success", "✓ ") + theme.fg("dim", `${d?.count ?? 0} suggestions`), 0, 0);
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. TOOL: harness_apply — apply theo id, optional notes per id để refine
  // ─────────────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "harness_apply",
    label: "Harness Apply",
    description:
      "Áp dụng các suggestion từ lần `harness_suggest` / `/harness` gần nhất. " +
      "Truyền `ids: string[]` (ví dụ ['S-001','S-003']). " +
      "Có thể truyền `notes: { [id]: string }` để prepend note của user vào patch (giúp giữ vết refine). " +
      "Có confirm dialog nếu UI khả dụng. Backup tự động vào .pi/logs/harness/backups/.",
    promptSnippet: "Use `harness_apply` with explicit suggestion ids only after the user picked them.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { description: "Mảng id suggestion (ví dụ ['S-001'])" }),
      notes: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Note theo id, ví dụ {'S-001':'thêm cảnh báo về retry'}" })),
      skipConfirm: Type.Optional(Type.Boolean({ description: "Bỏ qua confirm dialog (mặc định false)" })),
    }),
    async execute(_id: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const ids: string[] = params?.ids ?? [];
      const notes: Record<string, string> = params?.notes ?? {};
      if (!ids.length) {
        return { content: [{ type: "text", text: "⚠️ Cần truyền `ids` (mảng id suggestion)." }] };
      }
      if (lastSuggestions.length === 0) {
        return { content: [{ type: "text", text: "⚠️ Chưa có suggestion cache. Gọi `harness_suggest` (hoặc /harness) trước." }] };
      }
      const picked = lastSuggestions.filter(s => ids.includes(s.id));
      if (picked.length === 0) {
        return { content: [{ type: "text", text: `⚠️ Không tìm thấy id nào khớp. Available: ${lastSuggestions.map(s => s.id).join(", ")}` }] };
      }

      if (!params?.skipConfirm && ctx?.hasUI && ctx?.ui?.confirm) {
        const summary = picked.map(s => `${s.id} → ${s.targetPath ?? s.target}${notes[s.id] ? ` (📝 ${notes[s.id].slice(0, 40)})` : ""}`).join("\n");
        const ok = await ctx.ui.confirm("Harness Apply", `Áp dụng ${picked.length} suggestion?\n\n${summary}`);
        if (!ok) return { content: [{ type: "text", text: "User đã huỷ." }], details: { kind: "apply", cancelled: true } };
      }

      const results: ApplyResult[] = picked.map(s => applyOne(s, notes[s.id]));
      return {
        content: [{ type: "text", text: formatApplyResults(results) }],
        details: {
          kind: "apply",
          applied: results.filter(r => r.status === "applied").length,
          skipped: results.filter(r => r.status === "skipped").length,
          errors:  results.filter(r => r.status === "error").length,
        },
      };
    },
    renderCall(args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold(`🛠 harness_apply `)) + theme.fg("dim", (args?.ids ?? []).join(",")), 0, 0);
    },
    renderResult(result: any, _ctx: any, theme: any) {
      const d = result.details;
      if (!d) return new Text("", 0, 0);
      return new Text(
        theme.fg("success", `✓ ${d.applied ?? 0} applied`) + theme.fg("dim", ` · ${d.skipped ?? 0} skip · ${d.errors ?? 0} err`),
        0, 0,
      );
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. SLASH COMMAND: /harness
  //    Flow: scan+analyze+suggest → mở editor xem → user gõ id (csv) → optional note per id → apply
  // ─────────────────────────────────────────────────────────────────────
  pi.registerCommand?.("harness", {
    description: "Scan + analyze + suggest. User chọn id để improve, optional thêm note refine.",
    async handler(_args: any, ctx: any) {
      if (!ctx?.hasUI) {
        ctx?.ui?.notify?.("UI không khả dụng — dùng tool `harness_suggest` qua chat.", 2500);
        return;
      }

      // 1. Run pipeline
      ctx.ui.setStatus?.("harness-improver", "🪞 scanning + analyzing + generating…");
      const { suggestions, text } = runImprovementPipeline();
      ctx.ui.setStatus?.("harness-improver", "");

      if (suggestions.length === 0) {
        await ctx.ui.editor?.("Harness Improver — không có suggestion", text);
        return;
      }

      // 2. Show full report (read-only) — user đọc
      await ctx.ui.editor?.("Harness Improver — đọc xong nhấn Esc/Ctrl+J", text);

      // 3. User chọn id (csv) — empty = skip
      const idList = suggestions.map(s => `${s.id} [${s.priority}] ${s.title.slice(0, 60)}`).join("\n");
      const placeholder = `vd: ${suggestions.slice(0, 2).map(s => s.id).join(",")}  (Enter rỗng để bỏ qua)`;
      const picked = await ctx.ui.input?.(
        `Pick suggestion ids để apply (csv).\n${idList}\n\n→`,
        placeholder,
      );
      if (!picked || !picked.trim()) {
        ctx.ui.notify?.("Đã huỷ — không apply gì.", 2000);
        return;
      }
      const ids = picked.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      const valid = suggestions.filter(s => ids.includes(s.id));
      if (valid.length === 0) {
        ctx.ui.notify?.(`Không khớp id nào. Available: ${suggestions.map(s => s.id).join(", ")}`, 4000);
        return;
      }

      // 4. Per-id optional note
      const notes: Record<string, string> = {};
      for (const s of valid) {
        const note = await ctx.ui.input?.(
          `📝 Note để refine ${s.id} (${s.title.slice(0, 50)}). Enter rỗng = không note.`,
          "",
        );
        if (note && note.trim()) notes[s.id] = note.trim();
      }

      // 5. Confirm
      const summary = valid
        .map(s => `${s.id} → ${s.targetPath ?? s.target}${notes[s.id] ? ` (📝 ${notes[s.id].slice(0, 40)})` : ""}`)
        .join("\n");
      const ok = await ctx.ui.confirm?.("Harness Apply", `Áp dụng ${valid.length} suggestion?\n\n${summary}`);
      if (!ok) {
        ctx.ui.notify?.("Đã huỷ.", 2000);
        return;
      }

      // 6. Apply
      const results = valid.map(s => applyOne(s, notes[s.id]));
      await ctx.ui.editor?.("Harness Apply — kết quả", formatApplyResults(results));
      ctx.ui.notify?.(
        `${results.filter(r => r.status === "applied").length} applied · ` +
        `${results.filter(r => r.status === "skipped").length} skipped · ` +
        `${results.filter(r => r.status === "error").length} errors`,
        4000,
      );
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. SLASH COMMAND: /harness-logs — xem nhanh log files
  // ─────────────────────────────────────────────────────────────────────
  pi.registerCommand?.("harness-logs", {
    description: "Liệt kê file log của harness-improver (.pi/logs/harness/)",
    async handler(_args: any, ctx: any) {
      const files = listLogFiles();
      const msg = files.length
        ? `Có ${files.length} log file:\n` + files.map(f => `  ${f}`).join("\n")
        : "Chưa có log nào — dùng Pi vài session trước đã.";
      ctx?.ui?.notify?.(msg, 4000);
      ctx?.ui?.editor?.("Harness logs", msg);
    },
  });
}
