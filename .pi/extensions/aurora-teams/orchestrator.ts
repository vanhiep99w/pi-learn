/**
 * orchestrator.ts — Core orchestration loop
 * Manage team lifecycle: spawn agents, resolve deps, handle approvals
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverAgents, type AgentConfig, type AgentScope } from "./agents.js";
import { TaskBoard, type Task, type TaskStatus } from "./task-board.js";
import { TeamBus } from "./team-bus.js";
import { runAgentWithRetry, formatUsage } from "./agent-runner.js";

const MAX_CONCURRENCY = 4;
const LOOP_INTERVAL_MS = 800;

export interface TeamOptions {
  name: string;
  teamDir: string;
  cwd: string;
  agentScope?: AgentScope;
  maxConcurrency?: number;
  onLog?: (msg: string) => void;
  onUpdate?: () => void;        // Trigger UI refresh
  approveTask?: (task: Task) => Promise<boolean>;
}

interface RunningAgent {
  taskId: string;
  agentName: string;
  abortController: AbortController;
  startTime: number;
}

export class Orchestrator {
  private options: TeamOptions;
  private board: TaskBoard;
  private bus: TeamBus;
  private agents: Map<string, AgentConfig> = new Map();
  private running: Map<string, RunningAgent> = new Map(); // taskId -> ...
  private stopped = false;
  private abortController = new AbortController();

  constructor(options: TeamOptions) {
    this.options = options;
    this.board = new TaskBoard(options.teamDir, options.name);
    this.bus = new TeamBus(options.teamDir);
  }

  // ── Initialize ──────────────────────────────────────────────────
  async init(): Promise<void> {
    const { agents } = discoverAgents(this.options.cwd, this.options.agentScope ?? "both");
    for (const a of agents) this.agents.set(a.name, a);
    this.log(`Aurora Teams ready — ${this.agents.size} agents available`);
    fs.mkdirSync(this.options.teamDir, { recursive: true });
  }

  // ── Main orchestration loop ──────────────────────────────────────
  async run(): Promise<void> {
    this.stopped = false;

    while (!this.stopped) {
      try {
        await this.processControlFile(); // check external commands
        await this.tick();
      } catch (err) {
        this.log(`Orchestrator error: ${err}`);
      }
      await sleep(LOOP_INTERVAL_MS);
    }
  }

  // ── Control file: external process gửi lệnh qua file ───────────
  // TUI/script ghi JSON vào {teamDir}/control.json
  // Orchestrator đọc, xử lý, rồi xóa
  private async processControlFile(): Promise<void> {
    const controlPath = path.join(this.options.teamDir, "control.json");
    try {
      const data = fs.readFileSync(controlPath, "utf-8");
      fs.unlinkSync(controlPath); // xóa ngay để không xử lý lại
      const cmd = JSON.parse(data);

      switch (cmd.action) {
        case "stop":
          this.log("⛔ Received STOP command");
          this.stop();
          break;

        case "kill":
          if (cmd.taskId) {
            this.killAgent(cmd.taskId);
          } else {
            // Kill all running
            for (const taskId of this.running.keys()) {
              this.killAgent(taskId);
            }
            this.log("⛔ Killed all running agents");
          }
          break;

        case "message":
          if (cmd.content) {
            await this.broadcast(cmd.content);
          }
          break;

        case "approve":
          if (cmd.taskId) {
            await this.board.setStatus(cmd.taskId, "in_progress", { approved: true });
            this.log(`✅ Approved task ${cmd.taskId}`);
          }
          break;

        case "reject":
          if (cmd.taskId) {
            await this.board.setStatus(cmd.taskId, "failed", {
              approved: false, error: "User rejected via control"
            });
            this.log(`❌ Rejected task ${cmd.taskId}`);
          }
          break;

        default:
          this.log(`⚠ Unknown control action: ${cmd.action}`);
      }
    } catch {
      // No control file or parse error — normal, do nothing
    }
  }

  private async tick(): Promise<void> {
    const maxConcurrency = this.options.maxConcurrency ?? MAX_CONCURRENCY;

    // 1. Resolve dependencies (unlock waiting tasks)
    const unlocked = await this.board.resolveDependencies();
    if (unlocked.length > 0) {
      this.log(`Unlocked ${unlocked.length} task(s)`);
      this.options.onUpdate?.();
    }

    // 2. Check approval-required tasks
    const pendingApproval = await this.board.getPendingApproval();
    for (const task of pendingApproval) {
      if (this.options.approveTask) {
        const approved = await this.options.approveTask(task);
        await this.board.setStatus(task.id, approved ? "in_progress" : "failed", {
          approved,
          error: approved ? undefined : "User rejected",
        });
        this.log(`Task ${task.id} ${approved ? "approved" : "rejected"} by user`);
        this.options.onUpdate?.();
      }
    }

    // 3. Spawn agents for ready tasks
    if (this.running.size >= maxConcurrency) return;

    const readyTasks = await this.board.getReadyTasks();
    const slots = maxConcurrency - this.running.size;

    for (const task of readyTasks.slice(0, slots)) {
      if (this.running.has(task.id)) continue;

      const agent = this.selectAgent(task);
      if (!agent) {
        this.log(`No agent available for task: ${task.title}`);
        continue;
      }

      this.spawnAgent(task, agent);
    }
  }

  // ── Select best agent for task ───────────────────────────────────
  private selectAgent(task: Task): AgentConfig | null {
    // 1. Explicitly assigned agent
    if (task.agent && this.agents.has(task.agent)) {
      return this.agents.get(task.agent)!;
    }

    // 2. Find idle agent not running any task
    const busyAgents = new Set(Array.from(this.running.values()).map(r => r.agentName));
    for (const [name, agent] of this.agents) {
      if (!busyAgents.has(name)) return agent;
    }

    // 3. All busy — allow using any (concurrency will limit)
    return this.agents.values().next().value ?? null;
  }

  // ── Spawn agent for task ─────────────────────────────────────────
  private spawnAgent(task: Task, agent: AgentConfig): void {
    const abort = new AbortController();
    this.running.set(task.id, {
      taskId: task.id,
      agentName: agent.name,
      abortController: abort,
      startTime: Date.now(),
    });
    this.options.onUpdate?.();

    // Toàn bộ logic trong async IIFE để await đúng cách
    (async () => {
      try {
        this.log(`▸ ${agent.name} → "${task.title}" [${task.id}]`);

        // 1 write duy nhất: claim + set in_progress (tránh race condition)
        await this.board.updateTask(task.id, {
          status: "in_progress",
          agent: agent.name,
          started_at: Date.now(),
        });

        // Get team context for injection
        const inbox = await this.bus.readInbox(agent.name);
        const taskSummary = await this.board.getSummary();

        const result = await runAgentWithRetry({
          agent,
          task,
          inbox,
          taskSummary,
          cwd: this.options.cwd,
          signal: abort.signal,
          onUpdate: () => { this.options.onUpdate?.(); },
          // onStep: fire-and-forget, chạy ở parent process — KHÔNG block agent subprocess
          onStep: (step: string) => {
            this.log(`  ${agent.name}: ${step}`);
          },
          onRetry: (attempt, max, error) => {
            this.log(`⟳ ${agent.name} retry ${attempt}/${max}: ${error}`);
          },
        });

        if (result.success) {
          await this.board.setStatus(task.id, "done", { result: result.output });
          this.log(`✓ ${agent.name} done — ${task.title} [${formatUsage(result.usage, result.model)}]`);
          await this.bus.send({
            from: agent.name, to: "orchestrator",
            type: "status", content: `Task "${task.title}" completed`,
            task_id: task.id,
          });
        } else {
          await this.board.setStatus(task.id, "failed", { error: result.error });
          this.log(`✗ ${agent.name} failed — ${task.title}: ${result.error}`);
        }
      } catch (err: any) {
        if (!abort.signal.aborted) {
          await this.board.setStatus(task.id, "failed", { error: String(err) }).catch(() => {});
          this.log(`✗ ${agent.name} error: ${err}`);
        }
      } finally {
        this.running.delete(task.id);
        this.options.onUpdate?.();
      }
    })();
  }

  // ── Public control API ───────────────────────────────────────────
  async addTask(input: Parameters<TaskBoard["createTask"]>[0]): Promise<Task> {
    const task = await this.board.createTask(input);
    this.options.onUpdate?.();
    return task;
  }

  async broadcast(message: string): Promise<void> {
    await this.bus.broadcast("orchestrator", message);
    this.log(`📢 Broadcast: ${message}`);
  }

  stop(): void {
    this.stopped = true;
    for (const r of this.running.values()) {
      r.abortController.abort();
    }
    this.bus.stopAll();
    this.log("Team stopped");
  }

  killAgent(taskId: string): boolean {
    const r = this.running.get(taskId);
    if (!r) return false;
    r.abortController.abort();
    this.log(`Killed agent for task ${taskId}`);
    return true;
  }

  // ── Status ──────────────────────────────────────────────────────
  async getStatus(): Promise<{
    running: number;
    agents: string[];
    taskSummary: string;
  }> {
    return {
      running: this.running.size,
      agents: Array.from(this.running.values()).map(r => `${r.agentName}[${r.taskId}]`),
      taskSummary: await this.board.getSummary(),
    };
  }

  getBoard(): TaskBoard { return this.board; }
  getBus(): TeamBus { return this.bus; }
  getAgents(): AgentConfig[] { return Array.from(this.agents.values()); }
  isRunning(): boolean { return !this.stopped && this.running.size > 0; }

  private log(msg: string): void {
    const time = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    this.options.onLog?.(`[${time}] ${msg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
