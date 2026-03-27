import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

// ── Agent Definition ──

export interface AgentDefinition {
  name: string;
  description: string;
  tools: string;
  model: string;
  thinking: string;
  max_turns: number;
  tmux: boolean; // spawn in tmux window for observability
  systemPrompt: string; // full .md content after frontmatter
}

// ── Parse YAML frontmatter from .md file ──

function parseFrontmatter(content: string): {
  metadata: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: content };
  }

  const metadata: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      metadata[key] = value;
    }
  }

  return { metadata, body: match[2] };
}

// ── Load single agent from .md file ──

export function loadAgent(filePath: string): AgentDefinition {
  const content = readFileSync(filePath, "utf-8");
  const { metadata, body } = parseFrontmatter(content);

  return {
    name: metadata.name || basename(filePath, ".md"),
    description: metadata.description || "",
    tools: metadata.tools || "read, grep, find, ls, bash",
    model: metadata.model || "claude-sonnet-4-5",
    thinking: metadata.thinking || "off",
    max_turns: parseInt(metadata.max_turns || "30", 10),
    tmux: metadata.tmux === "true",
    systemPrompt: body.trim(),
  };
}

// ── Discover all agents in directory ──

export function discoverAgents(agentsDir: string): Map<string, AgentDefinition> {
  const agents = new Map<string, AgentDefinition>();

  try {
    const files = readdirSync(agentsDir).filter((f) =>
      f.endsWith(".md")
    );

    for (const file of files) {
      try {
        const agent = loadAgent(join(agentsDir, file));
        agents.set(agent.name, agent);
      } catch {
        // Skip invalid agent files
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return agents;
}
