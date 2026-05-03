// Applier: ghi suggestion đã chọn vào file thực tế.
// Quy tắc:
//   - LUÔN confirm trước khi ghi (nếu có UI).
//   - LUÔN backup file cũ vào `.pi/logs/harness/backups/` (nếu file đã tồn tại).
//   - KHÔNG tự git commit (để lại cho user — tránh action không revert được).
//   - User có thể truyền `notes` (string) để refine patch — note sẽ được prepend
//     vào content như block `> Note from user: ...` để giữ vết.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Suggestion } from "./types";
import { workspaceRoot, ensureReportsDir, reportsDir } from "./paths";

export type ApplyResult = {
  id: string;
  status: "applied" | "skipped" | "error" | "no-patch";
  file?: string;
  detail?: string;
};

function backup(absPath: string): string | undefined {
  if (!fs.existsSync(absPath)) return undefined;
  ensureReportsDir();
  const backupDir = path.join(reportsDir(), "..", "backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `${path.basename(absPath)}.${ts}.bak`);
  fs.copyFileSync(absPath, dest);
  return dest;
}

function withNote(content: string, note?: string): string {
  if (!note || !note.trim()) return content;
  const noteBlock =
    `\n> 📝 Note (user): ${note.trim().split("\n").join("\n> ")}\n`;
  return noteBlock + content;
}

export function applyOne(s: Suggestion, note?: string): ApplyResult {
  if (!s.patch) {
    const detail = note
      ? `Suggestion chưa có patch tự động. Note user: "${note.slice(0, 120)}". Fix tay theo "proposedFix".`
      : "Suggestion chưa có patch tự động — fix tay theo hướng dẫn `proposedFix`.";
    return { id: s.id, status: "no-patch", detail };
  }
  if (!s.targetPath) {
    return { id: s.id, status: "error", detail: "Thiếu targetPath." };
  }
  const abs = path.isAbsolute(s.targetPath) ? s.targetPath : path.join(workspaceRoot(), s.targetPath);
  const content = withNote(s.patch.content, note);
  try {
    if (s.patch.mode === "create") {
      if (fs.existsSync(abs)) {
        return { id: s.id, status: "skipped", file: abs, detail: "File đã tồn tại — bỏ qua để tránh ghi đè." };
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
      return { id: s.id, status: "applied", file: abs, detail: note ? "Đã tạo file mới (kèm note)." : "Đã tạo file mới." };
    }
    if (s.patch.mode === "append") {
      const before = backup(abs);
      const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
      // Tránh duplicate khi patch đã append rồi (idempotent best-effort)
      if (s.patch.section && existing.includes(`## ${s.patch.section}`)) {
        return { id: s.id, status: "skipped", file: abs, detail: `Section "${s.patch.section}" đã có — bỏ qua append để tránh trùng.` };
      }
      const sep = existing.endsWith("\n") || existing === "" ? "" : "\n";
      fs.writeFileSync(abs, existing + sep + content, "utf8");
      return { id: s.id, status: "applied", file: abs, detail: before ? `Đã append (backup: ${before}).` : "Đã append." };
    }
    if (s.patch.mode === "replace_section") {
      if (!fs.existsSync(abs)) {
        return { id: s.id, status: "error", file: abs, detail: "File không tồn tại để replace." };
      }
      const before = backup(abs);
      const existing = fs.readFileSync(abs, "utf8");
      const section = s.patch.section ?? "";
      const re = new RegExp(`(^|\\n)##\\s+${section.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[\\s\\S]*?(?=\\n##\\s+|$)`, "m");
      const replaced = existing.match(re)
        ? existing.replace(re, "\n" + content)
        : existing + "\n" + content;
      fs.writeFileSync(abs, replaced, "utf8");
      return { id: s.id, status: "applied", file: abs, detail: `Đã replace section (backup: ${before}).` };
    }
    return { id: s.id, status: "error", detail: `Mode không hỗ trợ: ${(s.patch as any).mode}` };
  } catch (e: any) {
    return { id: s.id, status: "error", detail: String(e?.message ?? e) };
  }
}

export function formatApplyResults(results: ApplyResult[]): string {
  if (results.length === 0) return "Không có gì để áp dụng.";
  const lines: string[] = [];
  lines.push(`# Apply results (${results.length})`);
  for (const r of results) {
    const icon = r.status === "applied" ? "✅" : r.status === "skipped" ? "↷" : r.status === "no-patch" ? "✋" : "❌";
    lines.push(`- ${icon} **${r.id}** — ${r.status}${r.file ? ` · ${r.file}` : ""}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  lines.push("");
  lines.push("> Backup ở `.pi/logs/harness/backups/`. Nhớ `git diff` trước khi commit.");
  return lines.join("\n");
}
