import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ═══════════════════════════════════════════════════════════════════════════
//  Prompt With Model — Minimal Extension (học từ pi-prompt-template-model)
//
//  • Scan ~/.pi/agent/model-prompts/ và .pi/model-prompts/
//  • Mỗi .md file → 1 slash command
//  • Frontmatter: model, thinking, description, argument-hint
//  • Auto switch model → run → restore
//  • KHÔNG đụng folder ~/.pi/agent/prompts/ (tránh trùng với Pi core)
// ═══════════════════════════════════════════════════════════════════════════

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface PromptDef {
  name: string;
  description: string;
  argumentHint?: string;
  model?: string; // "provider/id" hoặc bare "id"
  thinking?: ThinkingLevel;
  body: string;
  source: "user" | "project";
}

const VALID_THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

interface RegistryLike {
  find(provider: string, id: string): Model<any> | undefined;
  getAll(): Model<any>[];
  getAvailable(): Model<any>[];
  hasConfiguredAuth?: (model: Model<any>) => boolean;
  getApiKeyAndHeaders?: (model: Model<any>) => Promise<{ ok: boolean; error?: string }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTurnStart(ctx: ExtensionCommandContext): Promise<void> {
  // sendUserMessage() schedules a turn asynchronously. If we call waitForIdle()
  // immediately, it can return while the session is still idle, then finally{}
  // restores the old model before the prompted turn actually starts.
  while (ctx.isIdle()) await sleep(10);
}

function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["'](.*)["']$/, "$1");
    if (key) fm[key] = val;
  }
  return { fm, body: match[2] };
}

function loadPromptsFromDir(dir: string, source: "user" | "project"): PromptDef[] {
  if (!existsSync(dir)) return [];
  const out: PromptDef[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const path = join(dir, entry);
    if (!statSync(path).isFile()) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      const { fm, body } = parseFrontmatter(raw);
      const name = basename(entry, ".md");
      const thinking = fm.thinking && VALID_THINKING.includes(fm.thinking as ThinkingLevel)
        ? (fm.thinking as ThinkingLevel)
        : undefined;
      out.push({
        name,
        description: fm.description || `Run /${name}`,
        argumentHint: fm["argument-hint"],
        model: fm.model,
        thinking,
        body,
        source,
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

  // Bare ID — return every provider with this ID, authenticated providers first.
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

async function resolveModel(
  spec: string,
  current: Model<any> | undefined,
  registry: RegistryLike,
): Promise<{ model: Model<any>; alreadyActive: boolean } | undefined> {
  const specs = splitModelSpecs(spec);

  if (current && specs.some((s) => modelMatchesSpec(current, s))) {
    return { model: current, alreadyActive: true };
  }

  for (const item of specs) {
    for (const candidate of getCandidates(item, registry)) {
      if (await hasUsableAuth(candidate, registry)) {
        return { model: candidate, alreadyActive: false };
      }
    }
  }
  return undefined;
}

function substituteArgs(body: string, args: string): string {
  return body.replace(/\$@/g, args);
}

function sameModel(a: Model<any> | undefined, b: Model<any> | undefined): boolean {
  if (!a || !b) return a === b;
  return a.provider === b.provider && a.id === b.id;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Wizard helpers — tạo / sửa prompt qua dialog
// ═══════════════════════════════════════════════════════════════════════════

function buildPromptFile(p: {
  description: string;
  argumentHint?: string;
  model?: string;
  thinking?: ThinkingLevel;
  body: string;
}): string {
  const lines = ["---"];
  lines.push(`description: ${p.description}`);
  if (p.argumentHint) lines.push(`argument-hint: "${p.argumentHint}"`);
  if (p.model) lines.push(`model: ${p.model}`);
  if (p.thinking) lines.push(`thinking: ${p.thinking}`);
  lines.push("---", "", p.body.trim(), "");
  return lines.join("\n");
}

const DEFAULT_BODY_TEMPLATE = `Bạn là một trợ lý...

Mục tiêu:
- ...

Input: $@
`;

async function pickModel(
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  const all = ctx.modelRegistry.getAll();
  const grouped = new Map<string, string[]>();
  for (const m of all) {
    if (!grouped.has(m.provider)) grouped.set(m.provider, []);
    grouped.get(m.provider)!.push(m.id);
  }

  const providers = ["(skip — dùng model hiện tại)", ...Array.from(grouped.keys()).sort()];
  const provider = await ctx.ui?.select("📡 Chọn provider:", providers);
  if (!provider || provider.startsWith("(skip")) return undefined;

  const ids = grouped.get(provider) ?? [];
  const id = await ctx.ui?.select(`🤖 Chọn model (${provider}):`, ids);
  if (!id) return undefined;
  return `${provider}/${id}`;
}

async function pickThinking(ctx: ExtensionCommandContext): Promise<ThinkingLevel | undefined> {
  const choice = await ctx.ui?.select("🧠 Thinking level:", ["(skip)", ...VALID_THINKING]);
  if (!choice || choice === "(skip)") return undefined;
  return choice as ThinkingLevel;
}

async function pickScope(ctx: ExtensionCommandContext): Promise<"user" | "project" | undefined> {
  const choice = await ctx.ui?.select("📁 Scope:", [
    "user — global (~/.pi/agent/model-prompts/)",
    "project — workspace này (.pi/agent/model-prompts/)",
  ]);
  if (!choice) return undefined;
  return choice.startsWith("user") ? "user" : "project";
}

function dirForScope(scope: "user" | "project"): string {
  return scope === "user"
    ? join(homedir(), ".pi", "agent", "model-prompts")
    : join(process.cwd(), ".pi", "agent", "model-prompts");
}

function promptDirs(): Array<{ dir: string; source: "user" | "project" }> {
  return [
    { dir: join(homedir(), ".pi", "agent", "model-prompts"), source: "user" },
    { dir: join(process.cwd(), ".pi", "agent", "model-prompts"), source: "project" },
    { dir: join(process.cwd(), ".pi", "model-prompts"), source: "project" }, // legacy path
  ];
}

async function runCreateWizard(ctx: ExtensionCommandContext) {
  const name = await ctx.ui?.input("✏️  Tên prompt (sẽ thành /tên):", "ví dụ: dich, review, debug");
  if (!name?.trim()) return;
  const safeName = name.trim().replace(/\s+/g, "-").replace(/\.md$/, "");

  const description = await ctx.ui?.input("📝 Mô tả ngắn (mục đích):", "VD: Dịch nhanh Anh↔Việt");
  if (!description?.trim()) return;

  const argumentHint = await ctx.ui?.input("🔤 Argument hint (Enter để bỏ):", "<text> hoặc [optional]");
  const model = await pickModel(ctx);
  const thinking = await pickThinking(ctx);
  const scope = await pickScope(ctx);
  if (!scope) return;

  const body = await ctx.ui?.editor(
    "📄 Nội dung prompt (dùng $@ để chèn user input):",
    DEFAULT_BODY_TEMPLATE,
  );
  if (!body?.trim()) {
    ctx.ui?.notify("Hủy — nội dung trống", "warning");
    return;
  }

  const dir = dirForScope(scope);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${safeName}.md`);

  if (existsSync(filePath)) {
    const overwrite = await ctx.ui?.confirm("⚠️  File đã tồn tại", `Ghi đè ${filePath}?`);
    if (!overwrite) return;
  }

  const content = buildPromptFile({
    description: description.trim(),
    argumentHint: argumentHint?.trim() || undefined,
    model,
    thinking,
    body,
  });

  writeFileSync(filePath, content, "utf-8");
  ctx.ui?.notify(`✅ Đã tạo /${safeName} → ${filePath}. Restart Pi để load.`, "info");
}

async function runEditWizard(ctx: ExtensionCommandContext) {
  const all = promptDirs().flatMap(({ dir, source }) => loadPromptsFromDir(dir, source));
  if (all.length === 0) {
    ctx.ui?.notify("Chưa có prompt nào. Dùng /prompt-create để tạo.", "warning");
    return;
  }

  const items = all.map((p) => `${p.name} (${p.source})${p.model ? ` [${p.model}]` : ""} — ${p.description}`);
  const chosen = await ctx.ui?.select("✏️  Chọn prompt cần sửa:", items);
  if (!chosen) return;
  const idx = items.indexOf(chosen);
  const target = all[idx];

  const dir = dirForScope(target.source);
  const filePath = join(dir, `${target.name}.md`);
  const current = readFileSync(filePath, "utf-8");

  const updated = await ctx.ui?.editor(`📝 Sửa ${filePath}:`, current);
  if (!updated || updated === current) {
    ctx.ui?.notify("Không thay đổi.", "info");
    return;
  }
  writeFileSync(filePath, updated, "utf-8");
  ctx.ui?.notify(`✅ Đã update ${target.name}. Restart Pi để load.`, "info");
}

export default function promptWithModelExtension(pi: ExtensionAPI) {
  const all = promptDirs().flatMap(({ dir, source }) => loadPromptsFromDir(dir, source));

  // Project ưu tiên hơn user (đè theo name)
  const map = new Map<string, PromptDef>();
  for (const p of all) {
    if (!map.has(p.name) || p.source === "project") map.set(p.name, p);
  }

  // Wizard commands
  pi.registerCommand("prompt-create", {
    description: "🪄 Tạo prompt template mới (chọn model, scope, body)",
    handler: async (_args, ctx) => {
      try {
        await runCreateWizard(ctx);
      } catch (e) {
        ctx.ui?.notify(`Lỗi: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  pi.registerCommand("prompt-edit", {
    description: "✏️  Sửa prompt template hiện có",
    handler: async (_args, ctx) => {
      try {
        await runEditWizard(ctx);
      } catch (e) {
        ctx.ui?.notify(`Lỗi: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  for (const prompt of map.values()) {
    const tag = prompt.model ? ` [${prompt.model}]` : "";
    const desc = `${prompt.description}${tag} (${prompt.source})`;

    pi.registerCommand(prompt.name, {
      description: desc,
      handler: async (args, ctx) => {
        const original = ctx.model;
        const originalThinking = pi.getThinkingLevel();
        let runtimeModel = original;
        let switched = false;

        try {
          // 1. Resolve & switch model
          if (prompt.model) {
            const selected = await resolveModel(prompt.model, runtimeModel, ctx.modelRegistry);
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
              runtimeModel = selected.model;
              switched = true;
              ctx.ui?.notify(`Switched to ${selected.model.provider}/${selected.model.id}`, "info");
            }
          }

          // 2. Set thinking level
          if (prompt.thinking) pi.setThinkingLevel(prompt.thinking);

          // 3. Substitute $@ và send message
          const content = substituteArgs(prompt.body, args ?? "").trim();
          if (!content) {
            ctx.ui?.notify(`Prompt /${prompt.name} rendered to empty content.`, "warning");
            return;
          }
          pi.sendUserMessage(content);
          await waitForTurnStart(ctx);
          await ctx.waitForIdle();
        } finally {
          // 4. Restore session state
          if (prompt.thinking && originalThinking !== pi.getThinkingLevel()) {
            pi.setThinkingLevel(originalThinking);
          }
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
