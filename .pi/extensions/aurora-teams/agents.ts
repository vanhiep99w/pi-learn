/**
 * agents.ts — Agent discovery & config parsing
 * Đọc .md files từ .pi/agents/ và parse YAML frontmatter
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type AgentScope = "user" | "project" | "both";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  thinking?: ThinkingLevel;
  max_turns?: number;
  retry_on_fail?: number;
  system_prompt: string;
  source: "user" | "project";
  file_path: string;
}

// ── Frontmatter parser ────────────────────────────────────────────
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (key) meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

// ── Load agents từ 1 directory ────────────────────────────────────
function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  if (!fs.existsSync(dir)) return [];

  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }

  const agents: AgentConfig[] = [];

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try { content = fs.readFileSync(filePath, "utf-8"); }
    catch { continue; }

    const { meta, body } = parseFrontmatter(content);
    if (!meta.name || !meta.description) continue;

    const tools = meta.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);

    agents.push({
      name: meta.name,
      description: meta.description,
      model: meta.model,
      tools: tools && tools.length > 0 ? tools : undefined,
      thinking: meta.thinking as ThinkingLevel | undefined,
      max_turns: meta.max_turns ? parseInt(meta.max_turns) : undefined,
      retry_on_fail: meta.retry_on_fail ? parseInt(meta.retry_on_fail) : 2,
      system_prompt: body,
      source,
      file_path: filePath,
    });
  }

  return agents;
}

// ── Find .pi/agents/ directory từ cwd upwards ─────────────────────
function findProjectAgentsDir(cwd: string): string | null {
  let current = cwd;
  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch { /* continue */ }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// ── Main discovery function ───────────────────────────────────────
export function discoverAgents(cwd: string, scope: AgentScope = "both"): {
  agents: AgentConfig[];
  projectDir: string | null;
} {
  const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
  const projectDir = findProjectAgentsDir(cwd);

  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents = (scope === "user" || !projectDir)
    ? []
    : loadAgentsFromDir(projectDir, "project");

  // Project agents override user agents with same name
  const map = new Map<string, AgentConfig>();
  for (const a of userAgents) map.set(a.name, a);
  for (const a of projectAgents) map.set(a.name, a);

  return { agents: Array.from(map.values()), projectDir };
}

export function formatAgentList(agents: AgentConfig[]): string {
  if (agents.length === 0) return "(none)";
  return agents.map(a => `${a.name} [${a.source}]: ${a.description}`).join("\n");
}
