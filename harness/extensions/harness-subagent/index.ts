import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents, type AgentDefinition } from "./agents";

// ── Types ──

interface SubagentResult {
  agent: string;
  summary: string;
  citations: string[];
  status: "success" | "error";
  error?: string;
  usage: {
    turns: number;
    model: string;
    cost: number;
    durationMs: number;
  };
}

interface ChainStep {
  agent: string;
  task: string;
}

// ── Helpers ──

function getAgentsDir(): string {
  // harness/extensions/harness-subagent/ → harness/agents/
  return path.join(path.dirname(path.dirname(__dirname)), "agents");
}

function getPiCommand(): { cmd: string; args: string[] } {
  const script = process.argv[1];
  if (script && fs.existsSync(script)) {
    return { cmd: process.execPath, args: [script] };
  }
  return { cmd: "pi", args: [] };
}

async function writeTmp(content: string, prefix: string): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `harness-${prefix}-`));
  const file = path.join(dir, "prompt.md");
  await fs.promises.writeFile(file, content, { encoding: "utf-8", mode: 0o600 });
  return file;
}

async function bdShow(
  pi: ExtensionAPI,
  taskId: string
): Promise<string> {
  try {
    const result = await pi.exec("bd", ["show", taskId], { timeout: 5000 });
    return result.stdout || "";
  } catch {
    return `(Could not load task ${taskId})`;
  }
}

function compressOutput(rawOutput: string, maxLines: number = 30): string {
  const lines = rawOutput.split("\n").filter((l) => l.trim());
  if (lines.length <= maxLines) return lines.join("\n");
  const head = lines.slice(0, Math.ceil(maxLines * 0.6));
  const tail = lines.slice(-Math.floor(maxLines * 0.4));
  return [...head, `\n... (${lines.length - maxLines} lines omitted) ...\n`, ...tail].join("\n");
}

function extractCitations(text: string): string[] {
  const pattern = /[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z]+(?::\d+(?:-\d+)?)?)[`'"]?/g;
  const citations: string[] = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const p = match[1];
    if (p.includes("/") && !p.startsWith("http") && !p.includes("node_modules")) {
      citations.push(p);
    }
  }
  return [...new Set(citations)].slice(0, 10);
}

// ── Tmux helpers ──

function isTmuxAvailable(): boolean {
  // Primary: check env var (set when shell is inside tmux)
  if (process.env.TMUX) return true;

  // Fallback: try tmux list-sessions synchronously
  try {
    const { execSync } = require("node:child_process");
    execSync("tmux list-sessions", { stdio: "ignore", timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for ${filePath}`);
}

// ── Run subagent in a visible tmux window ──

async function runSubagentInTmux(
  pi: ExtensionAPI,
  agent: AgentDefinition,
  taskPrompt: string,
  taskContext: string,
  onUpdate?: (update: any) => void
): Promise<SubagentResult> {
  const startTime = Date.now();
  const uid = `${agent.name}-${Date.now().toString(36)}`;
  const logFile = path.join(os.tmpdir(), `harness-${uid}.jsonl`);
  const exitFile = path.join(os.tmpdir(), `harness-${uid}.exit`);
  const scriptFile = path.join(os.tmpdir(), `harness-${uid}.sh`);
  const windowName = `${agent.name}`;

  const systemContent = [
    agent.systemPrompt,
    "",
    taskContext ? `## Beads Task Context\n${taskContext}` : "",
  ].filter(Boolean).join("\n");

  let tmpFile: string | null = null;
  let tmpDir: string | null = null;

  try {
    tmpFile = await writeTmp(systemContent, agent.name);
    tmpDir = path.dirname(tmpFile);

    const { cmd, args: baseArgs } = getPiCommand();

    // Single JSON process — tee to logFile + pipe through inline formatter
    const piArgs = [
      ...baseArgs,
      "--mode", "json",
      "-p",
      "--no-session",
      "--model", agent.model,
      "--tools", agent.tools.replace(/\s/g, ""),
      "--thinking", agent.thinking,
      "--max-turns", String(agent.max_turns),
      "--append-system-prompt", tmpFile,
      taskPrompt,
    ];

    const escapedArgs = piArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    const escapedCmd = `'${cmd.replace(/'/g, "'\\''")}'`;

    // Inline Node.js formatter: parse JSON events → human-readable output
    const formatterScript = `
node -e "
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const RESET = '\\x1b[0m', DIM = '\\x1b[2m', CYAN = '\\x1b[36m', GREEN = '\\x1b[32m',
      YELLOW = '\\x1b[33m', MAGENTA = '\\x1b[35m', BOLD = '\\x1b[1m', RED = '\\x1b[31m';
let turn = 0;
rl.on('line', line => {
  if (!line.trim()) return;
  let e; try { e = JSON.parse(line); } catch { return; }
  if (e.type === 'tool_execution_start') {
    const name = e.toolName || '?';
    const inp = e.args || {};
    const preview = name === 'bash' ? (inp.command||'').slice(0,80)
      : name === 'read' ? (inp.file_path||inp.path||'')
      : name === 'write' || name === 'edit' ? (inp.file_path||inp.path||'')
      : name === 'grep' ? '\"' + (inp.pattern||'') + '\"'
      : JSON.stringify(inp).slice(0,60);
    console.log(CYAN + '  → ' + BOLD + name + RESET + DIM + ' ' + preview + RESET);
  } else if (e.type === 'tool_execution_end') {
    const ok = !e.isError;
    console.log(ok ? GREEN + '  ← ✓' + RESET : RED + '  ← ✗ ' + (e.error||'') + RESET);
  } else if (e.type === 'message_end' && e.message?.role === 'assistant') {
    turn++;
    const cost = e.message.usage?.cost?.total;
    const costStr = cost ? ' \$' + cost.toFixed(4) : '';
    console.log(YELLOW + '\\n[turn ' + turn + costStr + ']' + RESET);
    for (const p of e.message.content || []) {
      if (p.type === 'text' && p.text) {
        console.log(p.text.trim());
      } else if (p.type === 'thinking' && p.thinking) {
        console.log(DIM + MAGENTA + '💭 ' + p.thinking.slice(0,200).replace(/\\n/g,' ') + '...' + RESET);
      }
    }
  }
});
"`;

    // Wrapper script: run pi JSON → tee to logFile → format for display
    const scriptContent = [
      "#!/usr/bin/env bash",
      `echo -e "\\x1b[1m\\x1b[36m🤖 ${agent.name} (${agent.model})\\x1b[0m"`,
      `echo -e "\\x1b[2mTask: ${taskPrompt.slice(0, 80).replace(/'/g, "'")}...\\x1b[0m"`,
      `echo ""`,
      `${escapedCmd} ${escapedArgs} 2>&1 | tee '${logFile}' | ${formatterScript}`,
      `echo \${PIPESTATUS[0]} > '${exitFile}'`,
      `echo ""`,
      `echo -e "\\x1b[1m\\x1b[32m═══ ${agent.name} finished — press any key to close ═══\\x1b[0m"`,
      `read -n 1`,
    ].join("\n");

    await fs.promises.writeFile(scriptFile, scriptContent, { mode: 0o755 });

    // Spawn tmux split pane (vertical = left|right, detached so Pi keeps focus)
    await new Promise<void>((resolve) => {
      const tmux = spawn(
        "tmux",
        ["split-window", "-h", "-d", `bash '${scriptFile}'`],
        { stdio: "ignore" }
      );
      tmux.on("close", () => resolve());
      tmux.on("error", () => resolve());
    });

    onUpdate?.({
      content: [{
        type: "text" as const,
        text: `🖥️  ${agent.name}: spawned in tmux split pane (right side)`,
      }],
    });

    // Poll for exit sentinel (max 10 min)
    await waitForFile(exitFile, 600000);

    const exitCodeStr = (await fs.promises.readFile(exitFile, "utf-8")).trim();
    const exitCode = parseInt(exitCodeStr, 10) || 0;

    // Parse JSON events from log file (same logic as stream version)
    const usage = { turns: 0, cost: 0 };
    let finalOutput = "";
    let model = agent.model;

    const logContent = await fs.promises.readFile(logFile, "utf-8").catch(() => "");
    for (const line of logContent.split("\n")) {
      if (!line.trim()) continue;
      let evt: any;
      try { evt = JSON.parse(line); } catch { continue; }

      if (evt.type === "message_end" && evt.message?.role === "assistant") {
        usage.turns++;
        const u = evt.message.usage;
        if (u) usage.cost += u.cost?.total || 0;
        if (evt.message.model) model = evt.message.model;
        for (const part of evt.message.content ?? []) {
          if (part.type === "text") finalOutput = part.text;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const summary = compressOutput(finalOutput);
    const citations = extractCitations(finalOutput);

    onUpdate?.({
      content: [{
        type: "text" as const,
        text: `✓ ${agent.name}: Done (${usage.turns}t, ${Math.round(durationMs / 1000)}s, $${usage.cost.toFixed(4)})`,
      }],
    });

    return {
      agent: agent.name,
      summary,
      citations,
      status: exitCode === 0 ? "success" : "error",
      error: exitCode !== 0 ? `Exit code ${exitCode}` : undefined,
      usage: { turns: usage.turns, model, cost: usage.cost, durationMs },
    };
  } catch (e: any) {
    const durationMs = Date.now() - startTime;
    onUpdate?.({
      content: [{ type: "text" as const, text: `✗ ${agent.name}: Failed — ${e.message}` }],
    });
    return {
      agent: agent.name, summary: "", citations: [],
      status: "error", error: e.message || "Unknown error",
      usage: { turns: 0, model: agent.model, cost: 0, durationMs },
    };
  } finally {
    // Cleanup temp files (keep log briefly for debugging)
    try { if (tmpFile) fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { if (tmpDir) fs.rmdirSync(tmpDir); } catch { /* ignore */ }
    try { fs.unlinkSync(scriptFile); } catch { /* ignore */ }
    try { fs.unlinkSync(exitFile); } catch { /* ignore */ }
    setTimeout(() => {
      try { fs.unlinkSync(logFile); } catch { /* ignore */ }
    }, 60000); // keep log 1 min for debugging
  }
}

// ── Run single subagent via child process ──

async function runSubagent(
  pi: ExtensionAPI,
  agent: AgentDefinition,
  taskPrompt: string,
  taskContext: string,
  onUpdate?: (update: any) => void
): Promise<SubagentResult> {
  const startTime = Date.now();

  onUpdate?.({
    content: [
      { type: "text" as const, text: `⏳ ${agent.name}: Starting (${agent.model})...` },
    ],
  });

  // Build system prompt injection (agent personality + task context)
  const systemContent = [
    agent.systemPrompt,
    "",
    taskContext ? `## Beads Task Context\n${taskContext}` : "",
  ].filter(Boolean).join("\n");

  let tmpFile: string | null = null;
  let tmpDir: string | null = null;

  try {
    // Write system prompt to temp file
    tmpFile = await writeTmp(systemContent, agent.name);
    tmpDir = path.dirname(tmpFile);

    // Build pi args
    const { cmd, args: baseArgs } = getPiCommand();
    const args = [
      ...baseArgs,
      "--mode", "json",
      "-p",                              // pipe mode
      "--no-session",
      "--model", agent.model,
      "--tools", agent.tools.replace(/\s/g, ""),
      "--thinking", agent.thinking,
      "--max-turns", String(agent.max_turns),
      "--append-system-prompt", tmpFile,
      taskPrompt,                        // user message as positional arg
    ];

    // Usage accumulator
    const usage = { turns: 0, cost: 0, input: 0, output: 0 };
    let finalOutput = "";
    let model = agent.model;

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(cmd, args, {
        cwd: process.cwd(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";
      let stderr = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let evt: any;
        try { evt = JSON.parse(line); } catch { return; }

        // Tool calls — show in TUI
        if (evt.type === "tool_execution_start") {
          const name = evt.toolName ?? "?";
          const input = evt.args ?? {};
          const preview = name === "read" ? (input.file_path || input.path || "")
            : name === "bash" ? String(input.command || "").slice(0, 60)
            : name === "grep" ? `"${input.pattern || input.query || ""}"` : "";
          onUpdate?.({
            content: [
              { type: "text" as const, text: `  ${agent.name}: ${name} ${preview}` },
            ],
          });
        }

        // Message end — track usage + final output
        if (evt.type === "message_end" && evt.message) {
          const msg = evt.message;
          if (msg.role === "assistant") {
            usage.turns++;
            const u = msg.usage;
            if (u) {
              usage.input += u.input || 0;
              usage.output += u.output || 0;
              usage.cost += u.cost?.total || 0;
            }
            if (msg.model) model = msg.model;
            for (const part of msg.content ?? []) {
              if (part.type === "text") finalOutput = part.text;
            }
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
    });

    const durationMs = Date.now() - startTime;
    const summary = compressOutput(finalOutput);
    const citations = extractCitations(finalOutput);

    onUpdate?.({
      content: [
        {
          type: "text" as const,
          text: `✓ ${agent.name}: Done (${usage.turns}t, ${Math.round(durationMs / 1000)}s, $${usage.cost.toFixed(4)})`,
        },
      ],
    });

    return {
      agent: agent.name,
      summary,
      citations,
      status: exitCode === 0 ? "success" : "error",
      error: exitCode !== 0 ? `Exit code ${exitCode}` : undefined,
      usage: { turns: usage.turns, model, cost: usage.cost, durationMs },
    };
  } catch (e: any) {
    const durationMs = Date.now() - startTime;
    onUpdate?.({
      content: [
        { type: "text" as const, text: `✗ ${agent.name}: Failed — ${e.message}` },
      ],
    });
    return {
      agent: agent.name, summary: "", citations: [],
      status: "error", error: e.message || "Unknown error",
      usage: { turns: 0, model: agent.model, cost: 0, durationMs },
    };
  } finally {
    // Cleanup temp files
    try { if (tmpFile) fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { if (tmpDir) fs.rmdirSync(tmpDir); } catch { /* ignore */ }
  }
}

// ── Extension Entry Point ──

export default function (pi: ExtensionAPI) {
  // Discover agents on load
  const agentsDir = getAgentsDir();
  const agents = discoverAgents(agentsDir);

  // Startup notification
  pi.on("session_start", () => {
    const names = [...agents.keys()].join(", ");
    const tmuxStatus = isTmuxAvailable() ? "tmux ✓" : "tmux ✗";
    const workerAgent = agents.get("worker");
    const workerMode = workerAgent?.tmux && isTmuxAvailable() ? "worker→tmux" : "worker→hidden";
    pi.ctx?.ui?.notify(
      `🤖 Harness: ${agents.size} agents (${names}) | ${tmuxStatus} | ${workerMode}`,
      4000
    );
  });

  // ═══════════════════════════════════════════════════════
  // TOOL: subagent — Core orchestration
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate tasks to specialized subagents. Modes: " +
      "single (one agent), chain (sequential pipeline), parallel (concurrent). " +
      "Each subagent runs in an isolated context window — noise is contained, only essence returns.",
    promptSnippet:
      "Use `subagent` to delegate focused tasks to specialized agents (scout, planner, worker, reviewer).",
    promptGuidelines: [
      "Always provide taskId when working on a Beads task.",
      "Chain mode (scout → planner → worker) for implementing features.",
      "Single mode for focused tasks (exploration, review).",
      "Parallel mode for multiple independent scout tasks.",
      `Available agents: ${[...agents.keys()].join(", ")}.`,
    ],
    parameters: Type.Object({
      taskId: Type.Optional(
        Type.String({ description: "Beads task ID (e.g. bd-a3f8.1). Optional for ad-hoc tasks." })
      ),
      // Single mode
      agent: Type.Optional(
        Type.String({ description: "Agent name for single mode (e.g. scout, planner, worker, reviewer)" })
      ),
      task: Type.Optional(
        Type.String({ description: "Task description for the agent" })
      ),
      // Chain mode
      chain: Type.Optional(
        Type.Array(
          Type.Object({
            agent: Type.String({ description: "Agent name" }),
            task: Type.String({ description: "Task for this step" }),
          }),
          { description: "Sequential chain: output of step N → input of step N+1" }
        )
      ),
      // Parallel mode
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            taskId: Type.Optional(Type.String({ description: "Beads task ID" })),
            agent: Type.String({ description: "Agent name" }),
            task: Type.String({ description: "Task description" }),
          }),
          { description: "Parallel tasks (max 4 concurrent)" }
        )
      ),
    }),

    async execute(
      _toolCallId: any,
      params: {
        taskId?: string;
        agent?: string;
        task?: string;
        chain?: ChainStep[];
        tasks?: Array<{ taskId?: string; agent: string; task: string }>;
      },
      signal: any,
      onUpdate: any
    ) {
      // Resolve task context from Beads
      let taskContext = "";
      if (params.taskId) {
        taskContext = await bdShow(pi, params.taskId);
      }

      // ── CHAIN MODE ──
      if (params.chain && params.chain.length > 0) {
        const results: SubagentResult[] = [];
        let previousOutput = "";

        for (let i = 0; i < params.chain.length; i++) {
          const step = params.chain[i];
          const agentDef = agents.get(step.agent);

          if (!agentDef) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Agent "${step.agent}" not found. Available: ${[...agents.keys()].join(", ")}`,
                },
              ],
            };
          }

          // Build prompt: task + previous agent output
          let stepPrompt = step.task;
          if (previousOutput) {
            stepPrompt = `## Previous Agent Output\n${previousOutput}\n\n## Your Task\n${step.task}`;
          }

          onUpdate?.({
            content: [
              {
                type: "text" as const,
                text: `🔗 Chain step ${i + 1}/${params.chain.length}: ${step.agent}`,
              },
            ],
          });

          const runFn = agentDef.tmux && isTmuxAvailable() ? runSubagentInTmux : runSubagent;
          const result = await runFn(
            pi,
            agentDef,
            stepPrompt,
            taskContext,
            onUpdate
          );

          results.push(result);

          // If step failed → abort chain
          if (result.status === "error") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Chain aborted at step ${i + 1} (${step.agent}): ${result.error}\n\n` +
                    `Completed ${i}/${params.chain.length} steps.`,
                },
              ],
              details: { mode: "chain", results, abortedAt: i },
            };
          }

          // Compressed output → input for next step
          previousOutput = result.summary;
        }

        // All steps completed
        const totalDuration = results.reduce((sum, r) => sum + r.usage.durationMs, 0);
        const summaryLines = results.map(
          (r, i) =>
            `${i + 1}. **${r.agent}**: ${r.summary.split("\n")[0] || "completed"}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text:
                `## Chain Completed (${results.length} steps, ${Math.round(totalDuration / 1000)}s)\n\n` +
                summaryLines.join("\n") +
                "\n\n### Final Output\n" +
                (results[results.length - 1]?.summary || "No output"),
            },
          ],
          details: {
            mode: "chain",
            taskId: params.taskId,
            results,
            totalDurationMs: totalDuration,
          },
        };
      }

      // ── PARALLEL MODE ──
      if (params.tasks && params.tasks.length > 0) {
        const maxConcurrent = 4;
        const taskItems = params.tasks.slice(0, maxConcurrent);

        onUpdate?.({
          content: [
            {
              type: "text" as const,
              text: `🔀 Parallel: ${taskItems.length} tasks starting...`,
            },
          ],
        });

        const promises = taskItems.map(async (item) => {
          const agentDef = agents.get(item.agent);
          if (!agentDef) {
            return {
              agent: item.agent,
              summary: "",
              citations: [],
              status: "error" as const,
              error: `Agent "${item.agent}" not found`,
              usage: { turns: 0, model: "?", durationMs: 0 },
            };
          }

          const itemContext = item.taskId
            ? await bdShow(pi, item.taskId)
            : taskContext;

          return runSubagent(pi, agentDef, item.task, itemContext, onUpdate);
        });

        const results = await Promise.all(promises);
        const totalDuration = results.reduce((sum, r) => sum + r.usage.durationMs, 0);
        const successCount = results.filter((r) => r.status === "success").length;

        const summaryLines = results.map(
          (r, i) =>
            `${i + 1}. **${r.agent}** [${r.status}]: ${r.summary.split("\n")[0] || r.error || "?"}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text:
                `## Parallel Completed (${successCount}/${results.length} success, ${Math.round(totalDuration / 1000)}s)\n\n` +
                summaryLines.join("\n"),
            },
          ],
          details: { mode: "parallel", results, totalDurationMs: totalDuration },
        };
      }

      // ── SINGLE MODE ──
      if (params.agent) {
        const agentDef = agents.get(params.agent);
        if (!agentDef) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Agent "${params.agent}" not found. Available: ${[...agents.keys()].join(", ")}`,
              },
            ],
          };
        }

        const runFn = agentDef.tmux && isTmuxAvailable() ? runSubagentInTmux : runSubagent;
        const result = await runFn(
          pi,
          agentDef,
          params.task || "Explore codebase",
          taskContext,
          onUpdate
        );

        return {
          content: [
            {
              type: "text" as const,
              text:
                `## ${result.agent} [${result.status}]\n\n` +
                result.summary +
                (result.citations.length > 0
                  ? "\n\n### Citations\n" +
                    result.citations.map((c) => `- \`${c}\``).join("\n")
                  : ""),
            },
          ],
          details: { mode: "single", taskId: params.taskId, ...result },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              "Error: Specify one of: agent (single), chain (sequential), tasks (parallel).\n" +
              `Available agents: ${[...agents.keys()].join(", ")}`,
          },
        ],
      };
    },

    // ── TUI Rendering ──

    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("🤖 subagent "));

      if (args.taskId) {
        text += theme.fg("accent", `[${args.taskId}] `);
      }

      if (args.chain) {
        const agents = args.chain.map((s: any) => s.agent).join(" → ");
        text += theme.fg("dim", agents);
      } else if (args.tasks) {
        text += theme.fg("dim", `${args.tasks.length} parallel`);
      } else if (args.agent) {
        text += theme.fg("muted", args.agent);
        if (args.task) {
          const short = args.task.length > 40 ? args.task.slice(0, 40) + "…" : args.task;
          text += theme.fg("dim", ` "${short}"`);
        }
      }

      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = result.details;

      if (!details) {
        return new Text(
          theme.fg("dim", result.content?.[0]?.text || "?"),
          0,
          0
        );
      }

      const mode = details.mode || "?";
      const duration = details.totalDurationMs || details.durationMs || 0;
      const durationStr = `${Math.round(duration / 1000)}s`;

      if (mode === "chain") {
        const steps = details.results?.length || 0;
        const aborted = details.abortedAt != null;
        const icon = aborted ? "⚠" : "✓";
        const color = aborted ? "warning" : "success";

        let text = theme.fg(color, `${icon} chain ${steps} steps (${durationStr})`);

        if (expanded && details.results) {
          for (const r of details.results) {
            const stepIcon = r.status === "success" ? "✓" : "✗";
            text += `\n  ${stepIcon} ${r.agent} (${r.usage.model}, ${Math.round(r.usage.durationMs / 1000)}s)`;
          }
        }

        return new Text(text, 0, 0);
      }

      if (mode === "parallel") {
        const total = details.results?.length || 0;
        const success = details.results?.filter((r: any) => r.status === "success").length || 0;
        let text = theme.fg("success", `✓ parallel ${success}/${total} (${durationStr})`);
        return new Text(text, 0, 0);
      }

      // Single mode
      const icon = details.status === "success" ? "✓" : "✗";
      const color = details.status === "success" ? "success" : "error";
      let text = theme.fg(color, `${icon} ${details.agent || "?"} (${durationStr})`);

      if (expanded && details.citations?.length > 0) {
        for (const cite of details.citations.slice(0, 5)) {
          text += "\n  " + theme.fg("dim", `📎 ${cite}`);
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // ── Pipeline Commands ──

  pi.registerCommand("pipeline", {
    description: "Run full pipeline (scout→planner→worker) for a Beads task: /pipeline <task-id>",
    async handler(args: string, ctx: any) {
      const taskId = args.trim();
      if (!taskId) {
        pi.ctx?.ui?.notify("Usage: /pipeline <task-id>", 3000);
        return;
      }
      // Inject as message → LLM will call subagent tool
      ctx?.sendMessage?.(
        `Run implementation pipeline for task ${taskId}.\n\n` +
        `Use subagent chain:\n` +
        `1. scout: Explore codebase for ${taskId}\n` +
        `2. planner: Create implementation plan\n` +
        `3. worker: Execute the plan\n\n` +
        `taskId: "${taskId}"`
      );
    },
  });

  pi.registerCommand("triage", {
    description: "Break task into Beads epic + subtasks: /triage <description>",
    async handler(args: string, ctx: any) {
      const desc = args.trim();
      if (!desc) {
        pi.ctx?.ui?.notify("Usage: /triage <task description>", 3000);
        return;
      }
      ctx?.sendMessage?.(
        `Triage and decompose: "${desc}"\n\n` +
        `1. Use subagent scout to explore codebase and understand scope\n` +
        `2. Create Beads epic: harness_task(action="create", title="...", type="epic")\n` +
        `3. Break into subtasks with harness_task(action="create", parent=<epic-id>)\n` +
        `4. Add dependencies with harness_task(action="dep_add")\n` +
        `5. Show result with harness_task(action="tree")\n` +
        `6. Do NOT implement — output plan for review.`
      );
    },
  });
}
