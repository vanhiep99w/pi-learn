/**
 * index.ts — Aurora Teams Extension entry point
 * Registers /team commands và integrates với Pi UI
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverAgents, formatAgentList } from "./agents.js";
import { Orchestrator } from "./orchestrator.js";

// ── File logger helper ───────────────────────────────────────────
function makeFileLogger(teamDir: string, teamName: string) {
  const logFile = path.join(teamDir, "aurora.log");
  return (msg: string) => {
    try {
      fs.mkdirSync(teamDir, { recursive: true });
      fs.appendFileSync(logFile, msg + "\n", "utf-8");
    } catch { /* ignore write errors */ }
  };
}

// Map of active teams: teamName → Orchestrator
const teams = new Map<string, Orchestrator>();
const logs = new Map<string, string[]>();   // teamName → log lines

function getTeamDir(cwd: string, teamName: string): string {
  let cur = cwd;
  while (true) {
    const piDir = path.join(cur, ".pi");
    if (fs.existsSync(piDir)) return path.join(piDir, "teams", teamName);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(cwd, ".pi", "teams", teamName);
}

async function runImplementWorkflow(
  goal: string,
  pi: any,
  ctx: any
): Promise<string> {
  const name = `impl-${Date.now().toString(36)}`;
  const teamDir = getTeamDir(ctx.cwd, name);
  fs.mkdirSync(teamDir, { recursive: true });
  logs.set(name, []);
  const logToFile = makeFileLogger(teamDir, name);

  const orch = new Orchestrator({
    name, teamDir, cwd: ctx.cwd, agentScope: "both",
    onLog: (msg) => {
      const teamLogs = logs.get(name) ?? [];
      teamLogs.push(msg);
      if (teamLogs.length > 200) teamLogs.splice(0, 100);
      logs.set(name, teamLogs);
      logToFile(msg);  // Ghi ra file
    },
    approveTask: async (task) => {
      if (!ctx.ui?.confirm) return true;
      return ctx.ui.confirm(
        `Approve kế hoạch của ${task.agent ?? "agent"}?`,
        `Task: ${task.title}\n\n${task.description.slice(0, 400)}`
      );
    },
  });

  await orch.init();
  teams.set(name, orch);

  const scoutTask = await orch.addTask({
    title: "Khám phá codebase",
    description: `Khám phá toàn diện codebase liên quan đến: ${goal}\nThu thập context để planner lên kế hoạch.`,
    agent: "scout",
    priority: "high",
  });

  const planTask = await orch.addTask({
    title: "Lên kế hoạch",
    description: `Lên kế hoạch implementation chi tiết cho: ${goal}\nXem task board để lấy kết quả từ scout.`,
    agent: "planner",
    depends_on: [scoutTask.id],
    require_approval: true,
    priority: "high",
  });

  await orch.addTask({
    title: "Implement",
    description: `Thực thi kế hoạch: ${goal}\nXem task board để lấy plan từ planner.`,
    agent: "worker",
    depends_on: [planTask.id],
    priority: "high",
  });

  // Start orchestration loop
  orch.run().catch(() => {});

  return `🚀 Team **${name}** started\nWorkflow: scout → planner (sẽ xin approve) → worker\n\nDùng **/team tasks ${name}** để theo dõi tiến trình.`;
}

export default function (pi: any) {

  // ── /team ────────────────────────────────────────────────────────
  pi.registerCommand("team", {
    description: "Aurora Teams — multi-agent orchestration",

    handler: async (args: string, ctx: any) => {
      const parts = args.trim().split(/\s+/);
      const [sub, ...rest] = parts;

      switch (sub) {

        // /team new <name>
        case "new": {
          const name = rest[0];
          if (!name) {
            ctx.ui.notify("Usage: /team new <name>", "error");
            return;
          }
          if (teams.has(name)) {
            ctx.ui.notify(`Team "${name}" already exists`, "error");
            return;
          }

          const teamDir = getTeamDir(ctx.cwd, name);
          fs.mkdirSync(teamDir, { recursive: true });
          logs.set(name, []);

          const orch = new Orchestrator({
            name, teamDir, cwd: ctx.cwd, agentScope: "both",
            onLog: (msg) => {
              const teamLogs = logs.get(name) ?? [];
              teamLogs.push(msg);
              if (teamLogs.length > 200) teamLogs.splice(0, 100);
              logs.set(name, teamLogs);
            },
            approveTask: async (task) => {
              if (!ctx.ui?.confirm) return true;
              return ctx.ui.confirm(
                `Approve kế hoạch?`,
                `Task: ${task.title}\n\n${task.description.slice(0, 400)}`
              );
            },
          });

          await orch.init();
          teams.set(name, orch);
          orch.run().catch(() => {});

          const { agents } = discoverAgents(ctx.cwd, "both");
          ctx.ui.notify(
            `✓ Team "${name}" created — ${agents.length} agents: ${agents.map((a: any) => a.name).join(", ")}`,
            "info"
          );
          return;
        }

        // /team status
        case "status":
        case "s": {
          if (teams.size === 0) {
            ctx.ui.notify("Không có team nào. Dùng: /team new <name>", "info");
            return;
          }
          const lines: string[] = [];
          for (const [name, orch] of teams) {
            const st = await orch.getStatus();
            lines.push(`Team "${name}": ${st.taskSummary}${st.running > 0 ? ` | ${st.agents.join(", ")}` : " | idle"}`);
          }
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }

        // /team tasks [name]
        case "tasks":
        case "t": {
          const name = rest[0] ?? [...teams.keys()][0];
          if (!name) { ctx.ui.notify("Không có team nào", "info"); return; }
          const orch = teams.get(name);
          if (!orch) { ctx.ui.notify(`Team "${name}" không tồn tại`, "error"); return; }
          const table = await orch.getBoard().formatTable();
          ctx.ui.notify(`Task Board [${name}]:\n${table}`, "info");
          return;
        }

        // /team task <name> [agent:]<title> [| <description>]
        case "task": {
          const name = rest[0];
          if (!name) { ctx.ui.notify("Usage: /team task <teamName> <title>", "error"); return; }
          const orch = teams.get(name);
          if (!orch) { ctx.ui.notify(`Team "${name}" không tồn tại`, "error"); return; }

          const remaining = rest.slice(1).join(" ");
          const pipeIdx = remaining.indexOf("|");
          let titleRaw = pipeIdx >= 0 ? remaining.slice(0, pipeIdx).trim() : remaining.trim();
          const description = pipeIdx >= 0 ? remaining.slice(pipeIdx + 1).trim() : remaining.trim();

          let agentName: string | undefined;
          const colonIdx = titleRaw.indexOf(":");
          if (colonIdx > 0 && colonIdx < 20) {
            agentName = titleRaw.slice(0, colonIdx).trim();
            titleRaw = titleRaw.slice(colonIdx + 1).trim();
          }

          const task = await orch.addTask({
            title: titleRaw,
            description: description || titleRaw,
            agent: agentName,
            priority: "normal",
          });

          ctx.ui.notify(`✓ Task [${task.id}]: ${task.title}${agentName ? ` → ${agentName}` : ""}`, "info");
          return;
        }

        // /team broadcast <name> <message>
        case "broadcast":
        case "bc": {
          const [name, ...msgParts] = rest;
          if (!name || !msgParts.length) { ctx.ui.notify("Usage: /team broadcast <name> <msg>", "error"); return; }
          const orch = teams.get(name);
          if (!orch) { ctx.ui.notify(`Team "${name}" không tồn tại`, "error"); return; }
          await orch.broadcast(msgParts.join(" "));
          ctx.ui.notify(`📢 Broadcast tới team "${name}"`, "info");
          return;
        }

        // /team logs [name]
        case "logs":
        case "log": {
          const name = rest[0] ?? [...teams.keys()][0];
          if (!name) { ctx.ui.notify("Không có team nào", "info"); return; }
          const teamLogs = logs.get(name) ?? [];
          const recent = teamLogs.slice(-20).join("\n") || "(no logs)";
          ctx.ui.notify(`Logs [${name}]:\n${recent}`, "info");
          return;
        }

        // /team kill [name]
        case "kill": {
          const name = rest[0];
          if (!name) {
            for (const [n, orch] of teams) { orch.stop(); teams.delete(n); logs.delete(n); }
            ctx.ui.notify("Tất cả teams đã dừng", "info");
            return;
          }
          const orch = teams.get(name);
          if (!orch) { ctx.ui.notify(`Team "${name}" không tồn tại`, "error"); return; }
          orch.stop();
          teams.delete(name);
          logs.delete(name);
          ctx.ui.notify(`Team "${name}" đã dừng`, "info");
          return;
        }

        // /team agents
        case "agents":
        case "a": {
          const { agents } = discoverAgents(ctx.cwd, "both");
          const msg = agents.length === 0
            ? "Không có agents. Tạo .pi/agents/{name}.md"
            : `Agents (${agents.length}):\n${formatAgentList(agents)}`;
          ctx.ui.notify(msg, "info");
          return;
        }

        // /team implement <goal>
        case "implement":
        case "impl": {
          const goal = rest.join(" ");
          if (!goal) { ctx.ui.notify("Usage: /team implement <goal>", "error"); return; }
          const msg = await runImplementWorkflow(goal, pi, ctx);
          ctx.ui.notify(msg, "info");
          return;
        }

        // /team help (default)
        default: {
          const help = [
            "Aurora Teams — Commands:",
            "  /team new <name>             Tạo team",
            "  /team status                 Xem tất cả teams",
            "  /team tasks [name]           Task board",
            "  /team task <name> <title>    Thêm task",
            "  /team broadcast <name> <msg> Broadcast",
            "  /team logs [name]            Xem logs",
            "  /team kill [name]            Dừng team",
            "  /team agents                 Liệt kê agents",
            "  /team implement <goal>       Scout→Plan→Worker",
          ].join("\n");
          ctx.ui.notify(help, "info");
          return;
        }
      }
    },
  });

  // ── /implement shortcut ──────────────────────────────────────────
  pi.registerCommand("implement", {
    description: "Aurora Teams: scout → plan (approve) → worker",
    handler: async (args: string, ctx: any) => {
      const goal = args.trim();
      if (!goal) { ctx.ui.notify("Usage: /implement <goal>", "error"); return; }
      const msg = await runImplementWorkflow(goal, pi, ctx);
      ctx.ui.notify(msg, "info");
    },
  });

  // ── /agents shortcut ─────────────────────────────────────────────
  pi.registerCommand("agents", {
    description: "Liệt kê Aurora Teams agents có sẵn",
    handler: async (args: string, ctx: any) => {
      const { agents } = discoverAgents(ctx.cwd, "both");
      const msg = agents.length === 0
        ? "Không có agents. Tạo .pi/agents/{name}.md hoặc ~/.pi/agent/agents/{name}.md"
        : `Aurora Agents (${agents.length}):\n${formatAgentList(agents)}`;
      ctx.ui.notify(msg, "info");
    },
  });
}
