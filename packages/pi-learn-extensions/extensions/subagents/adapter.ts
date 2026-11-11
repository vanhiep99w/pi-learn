import path from "node:path";
import { realpathSync } from "node:fs";
import {
  getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext,
  type ExtensionFactory, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { commandMutatesProtectedWikiPath, isProtectedWikiMutationPath } from "../wiki/wiki-protection.ts";
import { registerWikiReadTools } from "../wiki/wiki-tools.ts";
import { CHILD_BUILTIN_TOOLS, discoverDefinitions, WIKI_READ_TOOLS } from "./definitions.ts";
import { availableModels, createParentRuntime } from "./model-bridge.ts";
import {
  createDelegationService, type CreateChildSpec, type DelegationBindings, type DelegationService,
} from "./vendor/thinkrail/pi-delegation/index.ts";
import { createSubagentsExtension, type AgentDefinition } from "./vendor/thinkrail/pi-subagents/index.ts";

export const MAX_CHILDREN = 32;
export const MAX_TASK_CHARS = 32_000;
export const DEFAULT_MAX_TURNS = 24;
const MAX_REPORT_BYTES = 32 * 1024;
const MAX_EXPLICIT_TURNS = 64;
const SCOPE = "pi-learn-subagents";
const RESERVED = new Set(["Agent", "get_subagent_result", "cancel_subagent", "subagent", "codemode", "tool_search", "read_mcp_resource", "list_mcp_resources"]);

type Options = { serviceFactory?: (bindings: DelegationBindings) => DelegationService };
function bounded(text: string, bytes = MAX_REPORT_BYTES): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  return new TextDecoder().decode(Buffer.from(text).subarray(0, bytes - 100)).replace(/\ufffd$/u, "") + "\n[Subagent report truncated; no full transcript is injected.]";
}
function detailsOf(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const details = value as Record<string, unknown>;
  return { ...details, ...(typeof details.task === "string" ? { task: bounded(details.task, 1024) } : {}) };
}
function resultOf<T extends { content: unknown[]; details?: unknown }>(result: T): T {
  return { ...result, content: result.content.map((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? { ...part, text: bounded(part.text) } : part), details: detailsOf(result.details) };
}

/** Curated child extensions only. The parent run's Wiki mutation authority is never delegated. */
export const childSafety: ExtensionFactory = (pi) => {
  pi.on("tool_call", (event, ctx) => {
    const input = event.input as { path?: unknown; command?: unknown };
    const protection = { protectRules: true, protectWikiBrief: true };
    if (RESERVED.has(event.toolName) || event.toolName.startsWith("mcp__")) return { block: true, reason: "Nested delegation, MCP and tool-discovery bridges are disabled in child sessions." };
    if (((event.toolName === "write" || event.toolName === "edit") && isProtectedWikiMutationPath(ctx.cwd, input.path, protection))
      || (event.toolName === "bash" && commandMutatesProtectedWikiPath(String(input.command ?? ""), protection))) {
      return { block: true, reason: "Delegated children cannot mutate Wiki policies, domain config, brief or metadata. Ask the parent to handle it." };
    }
  });
};

export function createPiLearnSubagents(options: Options = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    let live = false;
    let id: string | undefined;
    let cwd: string | undefined;
    let current: ExtensionContext | undefined;
    let preparing = 0;
    let definitions: AgentDefinition[] = [];
    const runtimes = new Map<string, ReturnType<typeof createParentRuntime>>();
    const bind = (ctx: ExtensionContext) => {
      if (!live || id !== ctx.sessionManager.getSessionId() || cwd !== realpathSync(ctx.cwd)) throw new Error("Subagents require the same active parent session and cwd; reload Pi if the session changed.");
      current = ctx;
    };
    pi.on("session_start", (_event, ctx) => {
      if (id !== undefined && id !== ctx.sessionManager.getSessionId()) throw new Error("Subagent extension cannot be rebound to a different parent");
      id = ctx.sessionManager.getSessionId(); cwd = realpathSync(ctx.cwd); current = ctx; live = true;
    });
    pi.on("before_agent_start", (_event, ctx) => { bind(ctx); });
    const raw = (options.serviceFactory ?? createDelegationService)({
      delegationRoot: path.join(getAgentDir(), "delegation"), scope: SCOPE, maxConcurrentPerParent: 4,
      resolveParent: (parentId) => live && parentId === id && current ? current : undefined,
      buildChildSettings: (_childCwd, projectTrusted) => SettingsManager.inMemory({
        packages: [], extensions: [], skills: [],
      }, { projectTrusted }),
      childBaseExtensionFactories: [childSafety], childExtensionFactories: [registerWikiReadTools],
    });
    // Capture an opaque runtime bridge for each birth; do not use upstream's file-backed auth fallback.
    const rawCreate = raw.createChild.bind(raw);
    const service: DelegationService = {
      ...raw,
      async createChild(spec: CreateChildSpec) {
        const ctx = current;
        if (!ctx || !id || spec.parent !== id) throw new Error("Unknown delegating parent");
        bind(ctx);
        if (raw.childrenOf(id).length + preparing >= MAX_CHILDREN) throw new Error(`This parent already owns ${MAX_CHILDREN} child sessions; finish this session before starting more.`);
        preparing++;
        try {
          const names = new Set(pi.getActiveTools());
          const requested = spec.session?.tools ?? ["read", "bash", "edit", "write", ...WIKI_READ_TOOLS];
          const offered = new Set([...CHILD_BUILTIN_TOOLS, ...(spec.session?.extensions === true ? WIKI_READ_TOOLS : [])]);
          const tools = [...new Set(requested)].filter((name) => names.has(name) && offered.has(name) && !RESERVED.has(name) && !name.startsWith("mcp__"));
          const chosen = spec.session?.model ? ctx.modelRegistry.find(spec.session.model.provider, spec.session.model.id) : ctx.model;
          if (!chosen || chosen.api === "pi-virtual") throw new Error("Subagents require an available physical chat model; virtual-model routing is not supported. Choose a physical model with Agent.model.");
          const key = JSON.stringify([chosen.provider, chosen.id, availableModels(ctx).map((m) => `${m.provider}/${m.id}`)]);
          let runtime = runtimes.get(key);
          if (!runtime) { runtime = createParentRuntime(ctx, () => live && id === ctx.sessionManager.getSessionId()); runtimes.set(key, runtime); }
          const modelRuntime = await runtime;
          bind(ctx);
          // Recheck a shrinking parent allowlist after async runtime preparation.
          const allowed = new Set(pi.getActiveTools());
          current = Object.create(ctx, { modelRuntime: { value: modelRuntime } });
          const child = await rawCreate({ ...spec, session: { ...spec.session, tools: tools.filter((name) => allowed.has(name)) } });
          return new Proxy(child, { get(target, prop, receiver) {
            if (prop === "runQueued") return (task: string, runOptions: Parameters<typeof child.runQueued>[1] = {}) => {
              if (!live) throw new Error("Delegating session ended before the child could run");
              return target.runQueued(task, { ...runOptions, maxTurns: Math.min(runOptions.maxTurns ?? DEFAULT_MAX_TURNS, MAX_EXPLICIT_TURNS) });
            };
            return Reflect.get(target, prop, receiver);
          } });
        } finally { preparing--; }
      },
    };
    const registerTool = (tool: ToolDefinition) => {
      const execute = tool.execute;
      const wrapped: ToolDefinition = {
        ...tool, exposure: "model-only", parameters: { ...tool.parameters, additionalProperties: false },
        promptSnippet: tool.name === "Agent" ? "Delegate a self-contained task to scout/planner/worker/reviewer; foreground or background, shared cwd/worktree." : "Get one owned subagent's status or bounded final report; do not poll.",
        namespace: { name: "pi-learn-subagents", description: "ThinkRail subagents with parent-limited tools and isolated conversation context, not isolated filesystems." },
        async execute(callId, params, signal, onUpdate, ctx) {
          bind(ctx);
          if (signal?.aborted) throw new Error("Subagent call cancelled before dispatch");
          const input = params as Record<string, unknown>;
          if (tool.name === "Agent") {
            if (typeof input.task !== "string" || !input.task.trim() || input.task.length > MAX_TASK_CHARS) throw new Error(`Agent.task must be nonempty and at most ${MAX_TASK_CHARS} characters.`);
            const selected = definitions.find((definition) => definition.name === input.subagent_type);
            if (selected?.source === "project" && !ctx.isProjectTrusted()) throw new Error("Project trust was revoked; project-local agents cannot run.");
          }
          let updating = true;
          const registry = new Proxy(ctx.modelRegistry, { get(target, prop) {
            if (prop === "getAvailable") return () => availableModels(ctx);
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
          } });
          try {
            return resultOf(await execute(callId, params, signal, (partial) => {
              if (updating && live) onUpdate?.(resultOf(partial));
            }, Object.create(ctx, { modelRegistry: { value: registry } })));
          } catch (error) {
            throw new Error(bounded(error instanceof Error ? error.message : "Subagent call failed", 8192));
          } finally { updating = false; }
        },
      };
      pi.registerTool(wrapped);
    };
    const wrappedPi = new Proxy(pi, { get(target, prop) {
      if (prop === "registerTool") return registerTool;
      if (prop === "sendMessage") return (message: Parameters<ExtensionAPI["sendMessage"]>[0], sendOptions: Parameters<ExtensionAPI["sendMessage"]>[1]) => {
        if (!live) return;
        const content = typeof message.content === "string" ? bounded(message.content) : message.content;
        return target.sendMessage({ ...message, content, details: detailsOf(message.details) }, sendOptions);
      };
      return Reflect.get(target, prop, target);
    } });
    createSubagentsExtension({
      service, scope: SCOPE,
      isEnabled: () => live,
      discoverAgents: (ctx) => { bind(ctx); definitions = discoverDefinitions(ctx); return definitions; },
    })(wrappedPi);
    pi.on("agent_settled", async (event) => {
      if (event.aborted && id) await Promise.allSettled(raw.childrenOf(id).map((child) => child.abort("user")));
    });
    pi.on("session_shutdown", async () => {
      live = false; current = undefined;
      try { if (id) await raw.disposeChildrenOf(id); }
      finally { runtimes.clear(); definitions = []; }
    });
    pi.registerCommand("subagents", {
      description: "Show owned subagents, or /subagents stop <session-id|all>",
      async handler(args, ctx) {
        bind(ctx);
        const [action, childId, extra] = args.trim().split(/\s+/);
        let text: string;
        if (action === "stop" && childId && !extra) {
          const children = raw.childrenOf(id!).filter((child) => childId === "all" || child.sessionId === childId);
          if (!children.length) text = "No matching child owned by this session.";
          else { await Promise.allSettled(children.map((child) => child.abort("user"))); text = `Stop requested for ${children.length} owned subagent(s).`; }
        } else if (action) text = "Usage: /subagents or /subagents stop <session-id|all>";
        else text = raw.childrenOf(id!).map((child) => `${child.sessionId} ${child.record.info.roleName ?? "agent"}: ${child.snapshot?.status ?? "created"}`).join("\n") || "No subagents owned by this session.";
        if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(text, "info"); else console.log(text);
      },
    });
  };
}
