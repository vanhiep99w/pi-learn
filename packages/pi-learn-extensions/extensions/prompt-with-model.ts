import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { complete, type Model, type UserMessage } from "@mariozechner/pi-ai";
import { BorderedLoader, type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ═══════════════════════════════════════════════════════════════════════════
//  Prompt With Model
//
//  • Scan ~/.pi/agent/model-prompts/ và .pi/agent/model-prompts/
//  • Mỗi .md file → 1 slash command
//  • Frontmatter: model, thinking, description, argument-hint
//  • Auto switch model → run → restore
//  • /prompt-create: nhập ý tưởng một lần → LLM gen file hoàn chỉnh → preview/edit → lưu
//  • /prompt-model: đổi model/thinking của prompt đã có
// ═══════════════════════════════════════════════════════════════════════════

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface PromptDef {
  name: string;
  description: string;
  argumentHint?: string;
  model?: string;
  thinking?: ThinkingLevel;
  body: string;
  source: "user" | "project";
  filePath: string;
  priority: number;
}

interface GeneratedPromptSpec {
  name: string;
  description: string;
  argumentHint?: string;
  model?: string;
  thinking?: ThinkingLevel;
  body: string;
}

interface RegistryLike {
  find(provider: string, id: string): Model<any> | undefined;
  getAll(): Model<any>[];
  getAvailable(): Model<any>[];
  hasConfiguredAuth?: (model: Model<any>) => boolean;
  getApiKeyAndHeaders?: (model: Model<any>) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>;
}

const VALID_THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const TURN_START_TIMEOUT_MS = 5000;
const RESERVED_COMMANDS = new Set([
  "aurora-themes",
  "chatgpt-accounts",
  "chatgpt-delete",
  "chatgpt-login",
  "chatgpt-logout",
  "chatgpt-switch",
  "chatgpt-usage",
  "chatgpt-usage-refresh",
  "clear",
  "exit",
  "help",
  "model",
  "prompt-create",
  "prompt-edit",
  "prompt-model",
  "reload",
  "rtk-status",
  "rtk-toggle",
  "settings",
  "tools",
]);

const PROMPT_SPEC_SYSTEM = `Bạn là chuyên gia thiết kế prompt template cho coding agent Pi.
Từ yêu cầu của user, hãy tạo MỘT prompt template hoàn chỉnh.
Chỉ trả về JSON object hợp lệ, không markdown fence, không giải thích.
Schema:
{
  "name": "slash-command-name-kebab-case",
  "description": "mô tả ngắn tiếng Việt",
  "argumentHint": "<input> hoặc [optional]",
  "model": "provider/id hoặc chuỗi rỗng",
  "thinking": "off|minimal|low|medium|high|xhigh hoặc chuỗi rỗng",
  "body": "markdown prompt body"
}
Quy tắc:
- name chỉ dùng a-z, A-Z, 0-9, dấu gạch ngang hoặc gạch dưới; không dùng command hệ thống.
- description ngắn, rõ khi nào dùng.
- Chọn model từ danh sách available nếu user có nhu cầu rõ; nếu không chắc, dùng current model được cung cấp.
- Chọn thinking phù hợp: tác vụ đơn giản dùng minimal/low, review/debug/kiến trúc dùng medium/high.
- body phải production-grade bằng tiếng Việt, rõ vai trò, nhiệm vụ, quy trình, quy tắc đầu ra.
- body phải dùng placeholder $@ đúng 1 lần cho input của user.
- Có thể dùng $1, $2, $ARGUMENTS, \${@:2}, \${1:-default} nếu hữu ích, nhưng vẫn phải có $@ đúng 1 lần.
- Nếu là prompt dịch thuật: tự phát hiện ngôn ngữ nguồn, bảo toàn markdown/code/path/tên riêng khi cần, output chỉ bản dịch.`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTurnStart(ctx: ExtensionCommandContext, timeoutMs = TURN_START_TIMEOUT_MS): Promise<boolean> {
  const startedAt = Date.now();
  while (ctx.isIdle()) {
    if (Date.now() - startedAt > timeoutMs) return false;
    await sleep(10);
  }
  return true;
}

function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["'](.*)["']$/, "$1");
    if (key) fm[key] = val;
  }
  return { fm, body: match[2] };
}

function sanitizePromptName(name: string): string {
  return name
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isValidPromptName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name) && name !== "." && name !== "..";
}

function normalizeThinking(value?: string): ThinkingLevel | undefined {
  return value && VALID_THINKING.includes(value as ThinkingLevel) ? value as ThinkingLevel : undefined;
}

function loadPromptsFromDir(dir: string, source: "user" | "project", priority: number): PromptDef[] {
  if (!existsSync(dir)) return [];
  const out: PromptDef[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(dir, entry);
    if (!statSync(filePath).isFile()) continue;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { fm, body } = parseFrontmatter(raw);
      const name = basename(entry, ".md");
      if (!isValidPromptName(name) || RESERVED_COMMANDS.has(name)) continue;
      out.push({
        name,
        description: fm.description || `Run /${name}`,
        argumentHint: fm["argument-hint"],
        model: fm.model,
        thinking: normalizeThinking(fm.thinking),
        body,
        source,
        filePath,
        priority,
      });
    } catch {
      // skip malformed file
    }
  }
  return out;
}

function splitModelSpecs(spec: string): string[] {
  return spec.split(",").map((s) => s.trim()).filter(Boolean);
}

function modelMatchesSpec(model: Model<any>, spec: string): boolean {
  const slashIdx = spec.indexOf("/");
  if (slashIdx !== -1) {
    return model.provider === spec.slice(0, slashIdx) && model.id === spec.slice(slashIdx + 1);
  }
  return model.id === spec;
}

function getCandidates(spec: string, registry: RegistryLike): Model<any>[] {
  const slashIdx = spec.indexOf("/");
  if (slashIdx !== -1) {
    const provider = spec.slice(0, slashIdx);
    const id = spec.slice(slashIdx + 1);
    if (!provider || !id) return [];
    const model = registry.find(provider, id);
    return model ? [model] : [];
  }
  const all = registry.getAll().filter((m) => m.id === spec);
  const available = registry.getAvailable().filter((m) => m.id === spec);
  const availableKeys = new Set(available.map((m) => `${m.provider}/${m.id}`));
  return [...available, ...all.filter((m) => !availableKeys.has(`${m.provider}/${m.id}`))];
}

async function hasUsableAuth(model: Model<any>, registry: RegistryLike): Promise<boolean> {
  if (registry.getAvailable().some((m) => sameModel(m, model))) return true;
  if (registry.hasConfiguredAuth?.(model)) return true;
  const auth = await registry.getApiKeyAndHeaders?.(model);
  return auth?.ok === true;
}

async function resolveModel(spec: string, current: Model<any> | undefined, registry: RegistryLike): Promise<{ model: Model<any>; alreadyActive: boolean } | undefined> {
  const specs = splitModelSpecs(spec);
  if (current && specs.some((s) => modelMatchesSpec(current, s))) return { model: current, alreadyActive: true };
  for (const item of specs) {
    for (const candidate of getCandidates(item, registry)) {
      if (await hasUsableAuth(candidate, registry)) return { model: candidate, alreadyActive: false };
    }
  }
  return undefined;
}

function sameModel(a: Model<any> | undefined, b: Model<any> | undefined): boolean {
  if (!a || !b) return a === b;
  return a.provider === b.provider && a.id === b.id;
}

function parseArgs(args: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let escaped = false;
  let tokenStarted = false;

  for (const ch of args) {
    if (escaped) {
      current += ch;
      escaped = false;
      tokenStarted = true;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      tokenStarted = true;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (tokenStarted) {
        out.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    current += ch;
    tokenStarted = true;
  }

  if (escaped) current += "\\";
  if (tokenStarted) out.push(current);
  return out;
}

function substituteArgs(body: string, rawArgs: string): string {
  const args = parseArgs(rawArgs);
  const allArgs = args.join(" ");
  return body
    .replace(/\$\{(\d+):-([^}]*)\}/g, (_m, index: string, fallback: string) => args[Number(index) - 1] || fallback)
    .replace(/\$\{@:(\d+):(\d+)\}/g, (_m, start: string, length: string) => args.slice(Number(start) - 1, Number(start) - 1 + Number(length)).join(" "))
    .replace(/\$\{@:(\d+)\}/g, (_m, start: string) => args.slice(Number(start) - 1).join(" "))
    .replace(/\$(\d+)/g, (_m, index: string) => args[Number(index) - 1] ?? "")
    .replace(/\$ARGUMENTS/g, allArgs)
    .replace(/\$@/g, allArgs);
}

function stripMarkdownFence(text: string): string {
  return text.trim()
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonObject(text: string): any | undefined {
  const stripped = stripMarkdownFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return undefined;
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function buildPromptFile(p: {
  description: string;
  argumentHint?: string;
  model?: string;
  thinking?: ThinkingLevel;
  body: string;
}): string {
  const lines = ["---"];
  lines.push(`description: ${p.description}`);
  if (p.argumentHint) lines.push(`argument-hint: "${p.argumentHint.replace(/"/g, "\\\"")}"`);
  if (p.model) lines.push(`model: ${p.model}`);
  if (p.thinking) lines.push(`thinking: ${p.thinking}`);
  lines.push("---", "", p.body.trim(), "");
  return lines.join("\n");
}

function parsePromptFileContent(content: string, fallbackName: string): GeneratedPromptSpec {
  const { fm, body } = parseFrontmatter(content);
  return {
    name: sanitizePromptName(fallbackName),
    description: fm.description || `Run /${fallbackName}`,
    argumentHint: fm["argument-hint"],
    model: fm.model,
    thinking: normalizeThinking(fm.thinking),
    body,
  };
}

function promptDirs(): Array<{ dir: string; source: "user" | "project"; priority: number }> {
  return [
    { dir: join(homedir(), ".pi", "agent", "model-prompts"), source: "user", priority: 10 },
    { dir: join(process.cwd(), ".pi", "model-prompts"), source: "project", priority: 20 },
    { dir: join(process.cwd(), ".pi", "agent", "model-prompts"), source: "project", priority: 30 },
  ];
}

function dirForScope(scope: "user" | "project"): string {
  return scope === "user"
    ? join(homedir(), ".pi", "agent", "model-prompts")
    : join(process.cwd(), ".pi", "agent", "model-prompts");
}

function loadAllPrompts(): PromptDef[] {
  return promptDirs().flatMap(({ dir, source, priority }) => loadPromptsFromDir(dir, source, priority));
}

function selectablePrompts(): PromptDef[] {
  const map = new Map<string, PromptDef>();
  for (const p of loadAllPrompts()) {
    const existing = map.get(p.name);
    if (!existing || p.priority > existing.priority) map.set(p.name, p);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function availableModelSpecs(ctx: ExtensionCommandContext): string[] {
  const available = ctx.modelRegistry.getAvailable();
  const all = available.length > 0 ? available : ctx.modelRegistry.getAll();
  return all.map((m) => `${m.provider}/${m.id}`).sort();
}

async function aiGeneratePromptSpec(ctx: ExtensionCommandContext, requestText: string): Promise<GeneratedPromptSpec | undefined> {
  if (!ctx.model) {
    ctx.ui?.notify("Không có model active để AI generate prompt.", "warning");
    return undefined;
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) {
    ctx.ui?.notify(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error, "warning");
    return undefined;
  }

  const currentModel = `${ctx.model.provider}/${ctx.model.id}`;
  const request = [
    `Yêu cầu user:\n${requestText}`,
    `Current model: ${currentModel}`,
    `Available models:\n${availableModelSpecs(ctx).slice(0, 80).join("\n")}`,
    `Reserved command names không được dùng: ${[...RESERVED_COMMANDS].join(", ")}`,
    "Hãy tự quyết định name, description, argumentHint, model, thinking và body.",
  ].join("\n\n");

  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: request }],
    timestamp: Date.now(),
  };

  const run = async (signal?: AbortSignal) => {
    const response = await complete(
      ctx.model!,
      { systemPrompt: PROMPT_SPEC_SYSTEM, messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers, signal, maxTokens: 3200 },
    );
    if (response.stopReason === "aborted") return undefined;
    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const raw = extractJsonObject(text);
    if (!raw) return undefined;

    const name = sanitizePromptName(String(raw.name || "prompt"));
    return {
      name: name && !RESERVED_COMMANDS.has(name) ? name : `prompt-${Date.now().toString(36)}`,
      description: String(raw.description || "Generated prompt"),
      argumentHint: raw.argumentHint ? String(raw.argumentHint) : undefined,
      model: raw.model ? String(raw.model) : currentModel,
      thinking: normalizeThinking(String(raw.thinking || "")) || "medium",
      body: String(raw.body || `Input: $@`),
    } satisfies GeneratedPromptSpec;
  };

  if (!ctx.hasUI || !ctx.ui) return run();

  return await ctx.ui.custom<GeneratedPromptSpec | undefined>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, `AI đang tạo prompt bằng ${ctx.model!.id}...`);
    loader.onAbort = () => done(undefined);
    run(loader.signal).then(done).catch((e) => {
      ctx.ui?.notify(`AI generate lỗi: ${e instanceof Error ? e.message : String(e)}`, "warning");
      done(undefined);
    });
    return loader;
  });
}

async function pickModel(ctx: ExtensionCommandContext, allowClear = true): Promise<string | undefined> {
  const all = ctx.modelRegistry.getAll();
  const grouped = new Map<string, string[]>();
  for (const m of all) {
    if (!grouped.has(m.provider)) grouped.set(m.provider, []);
    grouped.get(m.provider)!.push(m.id);
  }

  const providers = [
    ...(allowClear ? ["(clear — dùng model hiện tại khi chạy)"] : []),
    ...Array.from(grouped.keys()).sort(),
  ];
  const provider = await ctx.ui?.select("📡 Chọn provider:", providers);
  if (!provider) return undefined;
  if (provider.startsWith("(clear")) return "";

  const ids = (grouped.get(provider) ?? []).sort();
  const id = await ctx.ui?.select(`🤖 Chọn model (${provider}):`, ids);
  if (!id) return undefined;
  return `${provider}/${id}`;
}

async function runCreateWizard(args: string | undefined, ctx: ExtensionCommandContext) {
  if (!ctx.hasUI || !ctx.ui) {
    console.error("/prompt-create requires an interactive Pi UI session.");
    return;
  }

  const initialRequest = args?.trim() || await ctx.ui.editor(
    "🪄 Mô tả prompt bạn muốn tạo. Pi sẽ tự gen tên, model, thinking, body:",
    "Ví dụ: tạo prompt review code TypeScript thật kỹ, output tiếng Việt, có severity và checklist.",
  );
  if (!initialRequest?.trim()) return;

  const spec = await aiGeneratePromptSpec(ctx, initialRequest.trim());
  if (!spec) return;

  const safeName = sanitizePromptName(spec.name);
  if (!safeName || RESERVED_COMMANDS.has(safeName)) {
    ctx.ui.notify("AI tạo tên prompt không hợp lệ/trùng command. Hãy sửa lại trong lần chạy sau.", "warning");
    return;
  }

  const preview = buildPromptFile(spec);
  const edited = await ctx.ui.editor(
    `👀 Preview trước khi tạo /${safeName}. Sửa trực tiếp nội dung nếu muốn:`,
    preview,
  );
  if (!edited?.trim()) {
    ctx.ui.notify("Hủy — nội dung trống", "warning");
    return;
  }

  const finalSpec = parsePromptFileContent(edited, safeName);
  const finalName = sanitizePromptName(finalSpec.name || safeName) || safeName;
  if (RESERVED_COMMANDS.has(finalName)) {
    ctx.ui.notify("Tên prompt sau khi sửa bị trùng command hệ thống/extension.", "warning");
    return;
  }

  const filePath = join(dirForScope("project"), `${finalName}.md`);
  mkdirSync(dirForScope("project"), { recursive: true });
  if (existsSync(filePath)) {
    const overwrite = await ctx.ui.confirm("⚠️  File đã tồn tại", `Ghi đè ${filePath}?`);
    if (!overwrite) return;
  }

  writeFileSync(filePath, buildPromptFile(finalSpec), "utf-8");
  ctx.ui.notify(`✅ Đã tạo /${finalName} → ${filePath}. Chạy /reload để load command mới.`, "info");
}

async function runEditWizard(ctx: ExtensionCommandContext) {
  if (!ctx.hasUI || !ctx.ui) {
    console.error("/prompt-edit requires an interactive Pi UI session.");
    return;
  }

  const all = selectablePrompts();
  if (all.length === 0) {
    ctx.ui.notify("Chưa có prompt nào. Dùng /prompt-create để tạo.", "warning");
    return;
  }

  const items = all.map((p) => `${p.name} (${p.source})${p.model ? ` [${p.model}]` : ""} — ${p.description}`);
  const chosen = await ctx.ui.select("✏️  Chọn prompt cần sửa:", items);
  if (!chosen) return;
  const target = all[items.indexOf(chosen)];
  const current = readFileSync(target.filePath, "utf-8");
  const updated = await ctx.ui.editor(`📝 Sửa ${target.filePath}:`, current);
  if (!updated || updated === current) {
    ctx.ui.notify("Không thay đổi.", "info");
    return;
  }
  writeFileSync(target.filePath, updated, "utf-8");
  ctx.ui.notify(`✅ Đã update ${target.name}. Chạy /reload để load lại.`, "info");
}

function updateFrontmatter(content: string, updates: { model?: string; thinking?: ThinkingLevel | "" }): string {
  const { fm, body } = parseFrontmatter(content);
  if (updates.model !== undefined) {
    if (updates.model === "") delete fm.model;
    else fm.model = updates.model;
  }
  if (updates.thinking !== undefined) {
    if (updates.thinking === "") delete fm.thinking;
    else fm.thinking = updates.thinking;
  }
  return buildPromptFile({
    description: fm.description || "Updated prompt",
    argumentHint: fm["argument-hint"],
    model: fm.model,
    thinking: normalizeThinking(fm.thinking),
    body,
  });
}

async function runPromptModel(args: string | undefined, ctx: ExtensionCommandContext) {
  if (!ctx.hasUI || !ctx.ui) {
    console.error("/prompt-model requires an interactive Pi UI session.");
    return;
  }

  const all = selectablePrompts();
  if (all.length === 0) {
    ctx.ui.notify("Chưa có prompt nào.", "warning");
    return;
  }

  const parts = parseArgs(args ?? "");
  let target: PromptDef | undefined;
  let chosenModel: string | undefined;
  if (parts.length >= 2) {
    target = all.find((p) => p.name === parts[0]);
    chosenModel = parts[1] === "none" || parts[1] === "clear" ? "" : parts[1];
  }

  if (!target) {
    const items = all.map((p) => `${p.name} (${p.source})${p.model ? ` [${p.model}]` : " [current]"} — ${p.description}`);
    const chosen = await ctx.ui.select("🤖 Chọn prompt cần đổi model:", items);
    if (!chosen) return;
    target = all[items.indexOf(chosen)];
  }

  if (chosenModel === undefined) {
    chosenModel = await pickModel(ctx, true);
    if (chosenModel === undefined) return;
  }

  const thinkingChoice = await ctx.ui.select("🧠 Thinking level:", ["(giữ nguyên)", "(clear)", ...VALID_THINKING]);
  const thinking = thinkingChoice === "(giữ nguyên)"
    ? undefined
    : thinkingChoice === "(clear)"
      ? ""
      : thinkingChoice as ThinkingLevel;

  const current = readFileSync(target.filePath, "utf-8");
  const updated = updateFrontmatter(current, { model: chosenModel, thinking });
  writeFileSync(target.filePath, updated, "utf-8");
  ctx.ui.notify(`✅ Đã đổi model cho /${target.name}. Chạy /reload để áp dụng mô tả command mới.`, "info");
}

export default function promptWithModelExtension(pi: ExtensionAPI) {
  const map = new Map<string, PromptDef>();
  for (const p of loadAllPrompts()) {
    const existing = map.get(p.name);
    if (!existing || p.priority > existing.priority) map.set(p.name, p);
  }

  pi.registerCommand("prompt-create", {
    description: "🪄 Tạo model prompt từ 1 yêu cầu, AI tự gen toàn bộ rồi cho preview",
    handler: async (args, ctx) => {
      try {
        await runCreateWizard(args, ctx);
      } catch (e) {
        ctx.ui?.notify(`Lỗi: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  pi.registerCommand("prompt-edit", {
    description: "✏️  Sửa file model prompt hiện có",
    handler: async (_args, ctx) => {
      try {
        await runEditWizard(ctx);
      } catch (e) {
        ctx.ui?.notify(`Lỗi: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  pi.registerCommand("prompt-model", {
    description: "🤖 Đổi model/thinking của model prompt. Usage: /prompt-model <prompt> <provider/model|clear>",
    handler: async (args, ctx) => {
      try {
        await runPromptModel(args, ctx);
      } catch (e) {
        ctx.ui?.notify(`Lỗi: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  for (const prompt of map.values()) {
    const hint = prompt.argumentHint ? ` ${prompt.argumentHint}` : "";
    const tag = prompt.model ? ` [${prompt.model}]` : "";
    const desc = `${hint}${hint ? " — " : ""}${prompt.description}${tag} (${prompt.source})`;

    pi.registerCommand(prompt.name, {
      description: desc,
      handler: async (args, ctx) => {
        const original = ctx.model;
        const originalThinking = pi.getThinkingLevel();
        let switched = false;

        try {
          if (prompt.model) {
            const selected = await resolveModel(prompt.model, original, ctx.modelRegistry);
            if (!selected) {
              ctx.ui?.notify(`No available/authenticated model from: ${prompt.model}`, "error");
              return;
            }
            if (!selected.alreadyActive) {
              const ok = await pi.setModel(selected.model);
              if (!ok) {
                ctx.ui?.notify(`Failed to switch to ${selected.model.provider}/${selected.model.id}. Check API key/auth for provider.`, "error");
                return;
              }
              switched = true;
              ctx.ui?.notify(`Switched to ${selected.model.provider}/${selected.model.id}`, "info");
            }
          }

          if (prompt.thinking) pi.setThinkingLevel(prompt.thinking);

          const content = substituteArgs(prompt.body, args ?? "").trim();
          if (!content) {
            ctx.ui?.notify(`Prompt /${prompt.name} rendered to empty content.`, "warning");
            return;
          }
          pi.sendUserMessage(content);
          const started = await waitForTurnStart(ctx);
          if (!started) {
            ctx.ui?.notify("Prompt đã gửi nhưng turn không bắt đầu trong timeout; restore model/thinking.", "warning");
            return;
          }
          await ctx.waitForIdle();
        } finally {
          if (prompt.thinking && originalThinking !== pi.getThinkingLevel()) pi.setThinkingLevel(originalThinking);
          if (switched && original) {
            const ok = await pi.setModel(original);
            if (ok) ctx.ui?.notify(`Restored to ${original.provider}/${original.id}`, "info");
            else ctx.ui?.notify(`Failed to restore ${original.provider}/${original.id}`, "error");
          }
        }
      },
    });
  }
}
