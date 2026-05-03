// Scanner: liệt kê các "harness components" hiện có của project.
// Mục đích: cho user/agent biết đang có gì để cải thiện.
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScanReport } from "./types";
import { piDir, workspaceRoot } from "./paths";

function listFilesShallow(dir: string, exts?: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (!exts || exts.some(e => entry.name.endsWith(e))) {
        out.push(entry.name);
      }
    } else if (entry.isDirectory()) {
      // Treat directory-style extensions as one entry (e.g. web-tools/)
      out.push(entry.name + "/");
    }
  }
  return out.sort();
}

function readAgentsMd(): { path: string; bytes: number; sections: string[] } | null {
  const candidates = ["AGENTS.md", "CLAUDE.md", "AGENT.md"];
  for (const name of candidates) {
    const p = path.join(workspaceRoot(), name);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      const sections = content
        .split("\n")
        .filter(l => /^#{1,3}\s+/.test(l))
        .map(l => l.replace(/^#{1,3}\s+/, "").trim());
      return { path: p, bytes: Buffer.byteLength(content, "utf8"), sections };
    }
  }
  return null;
}

function readSettings(): { path: string; theme?: string } | null {
  const p = path.join(piDir(), "settings.json");
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return { path: p, theme: raw.theme };
  } catch {
    return { path: p };
  }
}

export function scanWorkspace(): ScanReport {
  const root = workspaceRoot();
  const piRoot = piDir();

  const skillsDir = path.join(piRoot, "skills");
  const extDir    = path.join(piRoot, "extensions");
  const agentsDir = path.join(piRoot, "agents");
  const themesDir = path.join(piRoot, "themes");
  const wfDir     = path.join(piRoot, "workflows");

  const notes: string[] = [];
  if (!fs.existsSync(piRoot))     notes.push("Không tìm thấy thư mục `.pi/` — workspace có thể chưa init Pi.");
  if (!fs.existsSync(skillsDir))  notes.push("Chưa có `.pi/skills/` — cân nhắc thêm skill cho task lặp lại.");
  if (!fs.existsSync(extDir))     notes.push("Chưa có `.pi/extensions/` — chỉ dùng tools mặc định.");
  if (!fs.existsSync(agentsDir))  notes.push("Chưa có `.pi/agents/` — chưa có sub-agents (Aurora Teams).");

  return {
    cwd: root,
    agentsMd: readAgentsMd(),
    skills:     { dir: skillsDir, files: listFilesShallow(skillsDir, [".md"]) },
    extensions: { dir: extDir,    files: listFilesShallow(extDir) },
    agents:     { dir: agentsDir, files: listFilesShallow(agentsDir, [".md"]) },
    themes:     { dir: themesDir, files: listFilesShallow(themesDir, [".json"]) },
    workflows:  { dir: wfDir,     files: listFilesShallow(wfDir) },
    settings: readSettings(),
    notes,
  };
}

export function formatScanReport(r: ScanReport): string {
  const lines: string[] = [];
  lines.push(`# Harness Scan — ${r.cwd}`);
  lines.push("");
  lines.push("## Instruction file");
  if (r.agentsMd) {
    lines.push(`- ${path.relative(r.cwd, r.agentsMd.path)} — ${r.agentsMd.bytes} bytes, ${r.agentsMd.sections.length} sections`);
    if (r.agentsMd.sections.length > 0) {
      lines.push(`  Sections: ${r.agentsMd.sections.slice(0, 8).join(" · ")}${r.agentsMd.sections.length > 8 ? " …" : ""}`);
    }
  } else {
    lines.push("- (không có AGENTS.md / CLAUDE.md)");
  }

  lines.push("");
  lines.push(`## Skills (${r.skills.files.length})`);
  lines.push(r.skills.files.length ? r.skills.files.map(f => `- ${f}`).join("\n") : "- (trống)");

  lines.push("");
  lines.push(`## Extensions (${r.extensions.files.length})`);
  lines.push(r.extensions.files.length ? r.extensions.files.map(f => `- ${f}`).join("\n") : "- (trống)");

  lines.push("");
  lines.push(`## Sub-agents (${r.agents.files.length})`);
  lines.push(r.agents.files.length ? r.agents.files.map(f => `- ${f}`).join("\n") : "- (trống)");

  lines.push("");
  lines.push(`## Themes (${r.themes.files.length})`);
  lines.push(r.themes.files.length ? r.themes.files.map(f => `- ${f}`).join("\n") : "- (trống)");

  lines.push("");
  lines.push(`## Workflows (${r.workflows.files.length})`);
  lines.push(r.workflows.files.length ? r.workflows.files.map(f => `- ${f}`).join("\n") : "- (trống)");

  lines.push("");
  lines.push("## Settings");
  if (r.settings) {
    lines.push(`- ${path.relative(r.cwd, r.settings.path)}${r.settings.theme ? ` (theme: ${r.settings.theme})` : ""}`);
  } else {
    lines.push("- (chưa có .pi/settings.json)");
  }

  if (r.notes.length) {
    lines.push("");
    lines.push("## Ghi chú");
    for (const n of r.notes) lines.push(`- ⚠️ ${n}`);
  }

  return lines.join("\n");
}
