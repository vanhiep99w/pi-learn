import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── Path resolution ──
// harness/extensions/harness-state/index.ts → harness/scripts/init.sh
const EXTENSION_DIR = new URL(".", import.meta.url).pathname;
const HARNESS_ROOT = new URL("../../", import.meta.url).pathname;
const INIT_SCRIPT = new URL("../../scripts/init.sh", import.meta.url).pathname;

// ── Helpers ──

async function bdExec(
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await pi.exec("bd", args, { signal, timeout: 10000 });
    return { stdout: result.stdout || "", stderr: result.stderr || "", code: result.code ?? 0 };
  } catch (e: any) {
    return { stdout: "", stderr: e.message || "bd command failed", code: 1 };
  }
}

function StringEnum(values: string[]) {
  return Type.String({ enum: values });
}

// ── Extension Entry Point ──

export default function (pi: ExtensionAPI) {

  // ═══════════════════════════════════════════════════════
  // 1. SESSION HOOKS — Auto-inject Beads context
  // ═══════════════════════════════════════════════════════

  pi.on("session_start", async () => {
    try {
      // bd prime = single command designed for agents
      // Returns: ready tasks, blocked, recent closes, stats
      const prime = await bdExec(pi, ["prime"]);

      if (prime.code === 0 && prime.stdout.trim()) {
        const stats = await bdExec(pi, ["stats"]);

        const contextLines = [
          "## 🎯 Beads Task Context",
          "",
          prime.stdout.trim(),
        ];

        if (stats.code === 0 && stats.stdout.trim()) {
          contextLines.push("", "### Stats", stats.stdout.trim());
        }

        // Notify user in TUI
        const readyMatch = prime.stdout.match(/(\d+)\s+ready/i);
        const readyCount = readyMatch ? readyMatch[1] : "?";
        pi.ctx?.ui?.notify(
          `🛡️ Harness: ${readyCount} tasks ready | bd prime injected`,
          3000
        );
      } else {
        pi.ctx?.ui?.notify(
          "🛡️ Harness: No Beads DB found (run 'bd init' to start)",
          3000
        );
      }
    } catch {
      // Beads not installed or not initialized — silent
      pi.ctx?.ui?.notify("🛡️ Harness: bd not available", 2000);
    }
  });

  // ═══════════════════════════════════════════════════════
  // 2. TOOL: harness_prime — Full context dump
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "harness_prime",
    label: "Harness Prime",
    description:
      "Get current Beads task context: ready work, blocked issues, stats, recent closes. " +
      "Use at the start of each session to understand the task landscape.",
    promptSnippet:
      "Use `harness_prime` to get Beads task context (ready tasks, blocked, stats).",
    promptGuidelines: [
      "Call harness_prime at start of session to understand current task state.",
      "Use this instead of running multiple bd commands manually.",
      "The output includes: ready tasks, blocked issues, recent closes, and stats.",
    ],
    parameters: Type.Object({
      filter: Type.Optional(
        Type.String({
          description:
            'Filter: "ready" (default), "blocked", "all", "stats"',
        })
      ),
    }),

    async execute(
      _toolCallId: any,
      params: { filter?: string },
      signal: any
    ) {
      const filter = params.filter || "ready";
      let result;

      switch (filter) {
        case "ready":
          result = await bdExec(pi, ["ready"], signal);
          break;
        case "blocked":
          result = await bdExec(pi, ["blocked"], signal);
          break;
        case "stats":
          result = await bdExec(pi, ["stats"], signal);
          break;
        case "all":
        default:
          result = await bdExec(pi, ["prime"], signal);
          break;
      }

      if (result.code !== 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Beads error: ${result.stderr || "bd command failed"}`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: result.stdout || "No data" }],
        details: { filter, exitCode: result.code },
      };
    },

    renderCall(args: any, theme: any) {
      const filter = args.filter || "all";
      let text = theme.fg("toolTitle", theme.bold("🎯 harness_prime "));
      text += theme.fg("dim", `(${filter})`);
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const lines = (result.content?.[0]?.text || "").split("\n");
      const count = lines.filter((l: string) => l.trim()).length;
      let text = theme.fg("success", `✓ ${count} lines`);
      if (expanded) {
        text += "\n" + theme.fg("muted", lines.slice(0, 15).join("\n"));
        if (lines.length > 15) {
          text += "\n" + theme.fg("dim", `... +${lines.length - 15} more`);
        }
      }
      return new Text(text, 0, 0);
    },
  });

  // ═══════════════════════════════════════════════════════
  // 3. TOOL: harness_task — CRUD operations
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "harness_task",
    label: "Harness Task",
    description:
      "Create, claim, close, or show Beads tasks. " +
      "Structured alternative to running bd commands via bash.",
    promptSnippet:
      "Use `harness_task` to manage Beads tasks (create, claim, close, show, dependencies).",
    promptGuidelines: [
      "Use 'claim' before starting work on a task (atomic: sets assignee + in_progress).",
      "Use 'close' with a reason after completing implementation.",
      "Use 'create' with parent for subtasks under an epic.",
      "NEVER use 'bd edit' (interactive editor). Use harness_task instead.",
    ],
    parameters: Type.Object({
      action: Type.String({
        description:
          'Action: "create", "claim", "close", "show", "dep_add", "ready", "blocked", "tree"',
      }),
      taskId: Type.Optional(
        Type.String({ description: "Beads task ID (e.g. bd-a3f8.1)" })
      ),
      title: Type.Optional(
        Type.String({ description: "Task title (for create)" })
      ),
      priority: Type.Optional(
        Type.Number({ description: "Priority 0-4 (0=highest)" })
      ),
      type: Type.Optional(
        Type.String({ description: 'Issue type: "task", "bug", "feature", "epic"' })
      ),
      reason: Type.Optional(
        Type.String({ description: "Reason for closing" })
      ),
      parent: Type.Optional(
        Type.String({ description: "Parent task ID for subtasks" })
      ),
      blockedBy: Type.Optional(
        Type.String({ description: "Task ID that blocks this task" })
      ),
      label: Type.Optional(
        Type.String({ description: 'Labels (comma-separated, e.g. "backend,urgent")' })
      ),
    }),

    async execute(
      _toolCallId: any,
      params: {
        action: string;
        taskId?: string;
        title?: string;
        priority?: number;
        type?: string;
        reason?: string;
        parent?: string;
        blockedBy?: string;
        label?: string;
      },
      signal: any
    ) {
      const args: string[] = [];

      switch (params.action) {
        case "create": {
          if (!params.title) {
            return {
              content: [{ type: "text" as const, text: "Error: title required for create" }],
            };
          }
          args.push("create", params.title);
          if (params.priority != null) args.push("-p", String(params.priority));
          if (params.type) args.push("-t", params.type);
          if (params.parent) args.push("--parent", params.parent);
          if (params.label) args.push("-l", params.label);
          break;
        }
        case "claim": {
          if (!params.taskId) {
            return {
              content: [{ type: "text" as const, text: "Error: taskId required for claim" }],
            };
          }
          args.push("update", params.taskId, "--claim");
          break;
        }
        case "close": {
          if (!params.taskId) {
            return {
              content: [{ type: "text" as const, text: "Error: taskId required for close" }],
            };
          }
          args.push("close", params.taskId);
          if (params.reason) args.push("--reason", params.reason);
          break;
        }
        case "show": {
          if (!params.taskId) {
            return {
              content: [{ type: "text" as const, text: "Error: taskId required for show" }],
            };
          }
          args.push("show", params.taskId);
          break;
        }
        case "dep_add": {
          if (!params.taskId || !params.blockedBy) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: taskId and blockedBy required for dep_add",
                },
              ],
            };
          }
          args.push("dep", "add", params.taskId, params.blockedBy);
          break;
        }
        case "ready":
          args.push("ready");
          break;
        case "blocked":
          args.push("blocked");
          break;
        case "tree": {
          if (!params.taskId) {
            return {
              content: [{ type: "text" as const, text: "Error: taskId required for tree" }],
            };
          }
          args.push("dep", "tree", params.taskId);
          break;
        }
        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown action: ${params.action}. Use: create, claim, close, show, dep_add, ready, blocked, tree`,
              },
            ],
          };
      }

      const result = await bdExec(pi, args, signal);

      return {
        content: [
          {
            type: "text" as const,
            text: result.code === 0
              ? result.stdout || `✓ ${params.action} completed`
              : `Error: ${result.stderr || result.stdout}`,
          },
        ],
        details: { action: params.action, exitCode: result.code },
      };
    },

    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("📋 harness_task "));
      text += theme.fg("accent", args.action || "?");
      if (args.taskId) {
        text += theme.fg("dim", ` ${args.taskId}`);
      }
      if (args.title) {
        text += theme.fg("muted", ` "${args.title}"`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const action = result.details?.action || "?";
      const ok = result.details?.exitCode === 0;
      const icon = ok ? "✓" : "✗";
      const color = ok ? "success" : "error";
      return new Text(
        theme.fg(color, `${icon} ${action} completed`),
        0,
        0
      );
    },
  });

  // ═══════════════════════════════════════════════════════
  // 4. COMMANDS — User slash commands
  // ═══════════════════════════════════════════════════════

  pi.registerCommand("tasks", {
    description: "Show all open Beads tasks",
    async handler(_args: string, _ctx: any) {
      const result = await bdExec(pi, ["list", "--status", "open"]);
      pi.ctx?.ui?.notify(result.stdout || "No open tasks", 5000);
    },
  });

  pi.registerCommand("ready", {
    description: "Show ready tasks (no blockers)",
    async handler(_args: string, _ctx: any) {
      const result = await bdExec(pi, ["ready"]);
      pi.ctx?.ui?.notify(result.stdout || "No ready tasks", 5000);
    },
  });

  pi.registerCommand("status", {
    description: "Harness dashboard: ready + blocked + stats",
    async handler(_args: string, _ctx: any) {
      const [ready, blocked, stats] = await Promise.all([
        bdExec(pi, ["ready"]),
        bdExec(pi, ["blocked"]),
        bdExec(pi, ["stats"]),
      ]);
      const output = [
        "## 📊 Harness Status",
        "",
        "### Ready",
        ready.stdout || "None",
        "",
        "### Blocked",
        blocked.stdout || "None",
        "",
        "### Stats",
        stats.stdout || "N/A",
      ].join("\n");
      pi.ctx?.ui?.notify(output, 8000);
    },
  });

  pi.registerCommand("dep-tree", {
    description: "Show Beads dependency tree for a task: /dep-tree <task-id>",
    async handler(args: string, _ctx: any) {
      const taskId = args.trim();
      if (!taskId) {
        pi.ctx?.ui?.notify("Usage: /dep-tree <task-id>", 3000);
        return;
      }
      const result = await bdExec(pi, ["dep", "tree", taskId]);
      pi.ctx?.ui?.notify(result.stdout || result.stderr, 5000);
    },
  });

  // ═══════════════════════════════════════════════════════
  // 5. TOOL: harness_init — Setup/verify harness system
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "harness_init",
    label: "Harness Init",
    description:
      "Initialize or verify the Agent Harness system. " +
      "Installs Beads (bd), creates database, registers extensions, and creates sample tasks.",
    promptSnippet:
      "Use `harness_init` to setup the Agent Harness system (Beads + extensions).",
    promptGuidelines: [
      "Call harness_init when the user asks to setup or initialize the harness.",
      "Also useful for verifying the harness installation is correct.",
      "This runs the init.sh script which handles everything automatically.",
    ],
    parameters: Type.Object({}),

    async execute(
      _toolCallId: any,
      _params: any,
      signal: any,
      onUpdate: any
    ) {
      // Get user's project directory (not the extension dir)
      const projectDir = (pi as any).ctx?.cwd || process.cwd();

      onUpdate?.({
        content: [
          { type: "text" as const, text: `🛡️ Running harness init in ${projectDir}...` },
        ],
      });

      try {
        const result = await pi.exec(
          "bash",
          [INIT_SCRIPT, projectDir],
          { signal, timeout: 60000 }
        );

        const output = result.stdout || "";
        const stderr = result.stderr || "";
        const exitCode = result.code ?? 1;

        // Strip ANSI color codes for clean LLM output
        const cleanOutput = (output + "\n" + stderr)
          .replace(/\x1b\[[0-9;]*m/g, "")
          .trim();

        if (exitCode === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `## ✅ Harness Init Complete\n\n${cleanOutput}`,
              },
            ],
            details: { exitCode, status: "success" },
          };
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: `## ⚠️ Harness Init — Issues Found\n\nExit code: ${exitCode}\n\n${cleanOutput}`,
              },
            ],
            details: { exitCode, status: "partial" },
          };
        }
      } catch (e: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `## ✗ Harness Init Failed\n\nError: ${e.message}\n\nTry running manually:\n\`\`\`bash\n./harness/scripts/init.sh\n\`\`\``,
            },
          ],
          details: { exitCode: 1, status: "error", error: e.message },
        };
      }
    },

    renderCall(_args: any, theme: any) {
      return new Text(
        theme.fg("toolTitle", theme.bold("🛡️ harness_init")),
        0,
        0
      );
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const status = result.details?.status || "?";
      const icon = status === "success" ? "✓" : status === "partial" ? "⚠" : "✗";
      const color = status === "success" ? "success" : status === "partial" ? "warning" : "error";

      let text = theme.fg(color, `${icon} harness_init: ${status}`);

      if (expanded) {
        const content = result.content?.[0]?.text || "";
        const lines = content.split("\n").slice(0, 20);
        text += "\n" + theme.fg("muted", lines.join("\n"));
      }

      return new Text(text, 0, 0);
    },
  });

  // /harness-init — user slash command
  pi.registerCommand("harness-init", {
    description: "Initialize/verify the Agent Harness system (Beads + extensions)",
    async handler(_args: string, _ctx: any) {
      // Tell LLM to call the harness_init tool (which has correct absolute path)
      pi.sendUserMessage(
        "Initialize the Agent Harness system. " +
        "Use the `harness_init` tool to run the setup script. " +
        "Show me the full output of each step."
      );
    },
  });
}
