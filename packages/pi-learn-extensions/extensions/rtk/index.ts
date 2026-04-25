import { Type } from "@sinclair/typebox";
import { createLocalBashOperations, isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const supportedTopLevelCommands = new Set([
  "ls",
  "tree",
  "find",
  "grep",
  "git",
  "gh",
  "jest",
  "vitest",
  "playwright",
  "pytest",
  "go",
  "cargo",
  "rake",
  "rspec",
  "tsc",
  "next",
  "prettier",
  "ruff",
  "golangci-lint",
  "rubocop",
  "pnpm",
  "pip",
  "bundle",
  "prisma",
  "aws",
  "docker",
  "kubectl",
  "json",
  "curl",
  "wget",
]);

const shellControlPattern = /[\n;&|<>`$(){}]/;

function getFirstWord(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/, 1)[0];
}

function shouldRewrite(command: string) {
  const trimmed = command.trim();
  if (!trimmed || trimmed.startsWith("rtk ")) return false;
  if (shellControlPattern.test(trimmed)) return false;

  const firstWord = getFirstWord(trimmed);
  return !!firstWord && supportedTopLevelCommands.has(firstWord);
}

function normalizeArgs(args: string[]) {
  return args.map((arg) => String(arg)).filter(Boolean);
}

export default function (pi: ExtensionAPI) {
  let autoRewrite = true;

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui?.setStatus?.("rtk", autoRewrite ? "rtk:auto" : "rtk:manual");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!autoRewrite) return;
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;
    if (typeof command !== "string" || !shouldRewrite(command)) return;

    event.input.command = `rtk ${command.trim()}`;
    ctx.ui?.notify?.(`RTK: ${command.trim()} → ${event.input.command}`, "info");
  });

  pi.on("user_bash", (event, ctx) => {
    if (!autoRewrite || !shouldRewrite(event.command)) return;

    const local = createLocalBashOperations();
    return {
      operations: {
        async exec(command, cwd, options) {
          const rewritten = `rtk ${command.trim()}`;
          ctx.ui?.notify?.(`RTK: ${command.trim()} → ${rewritten}`, "info");
          return local.exec(rewritten, cwd, options);
        },
      },
    };
  });

  pi.registerCommand("rtk-toggle", {
    description: "Toggle RTK auto-rewrite for bash tool calls: /rtk-toggle on|off|status",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (value === "on") autoRewrite = true;
      else if (value === "off") autoRewrite = false;
      else if (value && value !== "status") {
        ctx.ui?.notify?.("Usage: /rtk-toggle on|off|status", "warning");
        return;
      }

      ctx.ui?.setStatus?.("rtk", autoRewrite ? "rtk:auto" : "rtk:manual");
      ctx.ui?.notify?.(`RTK auto-rewrite: ${autoRewrite ? "on" : "off"}`, "info");
    },
  });

  pi.registerCommand("rtk-status", {
    description: "Show RTK version and token saving stats",
    handler: async (_args, ctx) => {
      const version = await pi.exec("rtk", ["--version"], { timeout: 5000 });
      const gain = await pi.exec("rtk", ["gain"], { timeout: 10000 });
      const text = [version.stdout || version.stderr, gain.stdout || gain.stderr].filter(Boolean).join("\n");
      ctx.ui?.notify?.(text || "rtk produced no output", version.code === 0 ? "info" : "warning");
    },
  });

  pi.registerTool({
    name: "rtk_run",
    label: "RTK Run",
    description: "Run a command through RTK to get token-optimized output. Provide args without the leading `rtk`, e.g. [\"git\", \"status\"].",
    promptSnippet: "Run token-optimized shell/dev commands via RTK.",
    promptGuidelines: [
      "Use rtk_run instead of bash for noisy supported commands such as git status, git diff, ls, find, grep, tests, builds, linters, docker, kubectl, and aws.",
      "Pass rtk_run args as an array without shell operators; use bash only when pipes, redirects, environment assignment, or compound shell syntax is required.",
    ],
    parameters: Type.Object({
      args: Type.Array(Type.String(), {
        minItems: 1,
        description: "Arguments passed to rtk, excluding the leading `rtk`. Example: [\"git\", \"status\"].",
      }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds. Defaults to 30000." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const args = normalizeArgs(params.args);
      onUpdate?.({ content: [{ type: "text", text: `Running: rtk ${args.join(" ")}` }] });

      const result = await pi.exec("rtk", args, {
        signal,
        timeout: params.timeout ?? 30000,
      });

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      return {
        content: [{ type: "text", text: output || `(exit ${result.code}, no output)` }],
        details: {
          command: ["rtk", ...args],
          exitCode: result.code,
          killed: result.killed,
        },
        isError: result.code !== 0,
      };
    },
  });

  pi.registerTool({
    name: "rtk_gain",
    label: "RTK Gain",
    description: "Show RTK token saving analytics using `rtk gain`.",
    promptSnippet: "Show RTK token saving analytics.",
    parameters: Type.Object({
      graph: Type.Optional(Type.Boolean({ description: "Show ASCII graph for recent days." })),
      history: Type.Optional(Type.Boolean({ description: "Show recent command history." })),
      daily: Type.Optional(Type.Boolean({ description: "Show day-by-day breakdown." })),
      all: Type.Optional(Type.Boolean({ description: "Show all projects." })),
      json: Type.Optional(Type.Boolean({ description: "Export as JSON." })),
    }),
    async execute(_toolCallId, params, signal) {
      const args = ["gain"];
      if (params.graph) args.push("--graph");
      if (params.history) args.push("--history");
      if (params.daily) args.push("--daily");
      if (params.all) args.push("--all");
      if (params.json) args.push("--format", "json");

      const result = await pi.exec("rtk", args, { signal, timeout: 10000 });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      return {
        content: [{ type: "text", text: output || `(exit ${result.code}, no output)` }],
        details: { command: ["rtk", ...args], exitCode: result.code, killed: result.killed },
        isError: result.code !== 0,
      };
    },
  });
}
