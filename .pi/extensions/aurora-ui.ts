import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

// ═══════════════════════════════════════════════════════════════════════════════
//  Aurora UI Extension — Bordered Input + Custom Footer
//  • Startup banner (tự ẩn sau 5s)
//  • Bordered editor: rounded border bao quanh ô input
//    - Top border: context usage (left) + model/thinking/session (right)
//    - Bottom border: cwd + git branch
//  • Minimal footer: chỉ hiển thị extension statuses
//  • Custom working messages cho tool execution
//  • /aurora-themes, Ctrl+Shift+T
// ═══════════════════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  let gitBranch: string | null = null;

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  SESSION START                                               ║
  // ╚══════════════════════════════════════════════════════════════╝
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // ── Startup Banner ──────────────────────────────────────────
    showBanner(ctx);
    setTimeout(() => ctx.ui.setWidget("aurora-banner", undefined), 5000);

    // ── Bordered Editor ─────────────────────────────────────────
    // CustomEditor constructor: (tui, theme, keybindings, options?)
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new BorderedEditor(tui, theme, keybindings, pi, ctx, () => gitBranch)
    );

    // ── Minimal Footer (chỉ extension statuses) ────────────────
    ctx.ui.setFooter((tui, theme, footerData) => ({
      dispose: footerData.onBranchChange(() => {
        gitBranch = footerData.getGitBranch();
        tui.requestRender();
      }),
      invalidate() {},
      render(_w: number): string[] {
        // Cập nhật git branch mỗi lần render
        gitBranch = footerData.getGitBranch();

        // Chỉ hiển thị extension statuses (từ aurora-teams, etc.)
        const parts: string[] = [];
        for (const [, v] of footerData.getExtensionStatuses()) parts.push(v);
        return parts.length > 0 ? [parts.join("  ")] : [];
      },
    }));
  });

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  EVENTS                                                      ║
  // ╚══════════════════════════════════════════════════════════════╝

  pi.on("agent_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setWorkingMessage("◈  suy nghĩ…");
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (!ctx.hasUI) return;
    const labels: Record<string, string> = {
      bash: "⟩  chạy lệnh…",
      read: "◎  đọc file…",
      write: "◉  ghi file…",
      edit: "⊙  sửa file…",
      grep: "⊹  tìm kiếm…",
      find: "⊿  duyệt thư mục…",
      ls: "≡  liệt kê…",
    };
    ctx.ui.setWorkingMessage(labels[event.toolName] ?? `◌  ${event.toolName}…`);
  });

  pi.on("model_select", async (event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.notify(
      `⬡ ${event.model.provider}/${event.model.id}`,
      "info"
    );
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!ctx.hasUI || !event.isError) return;
    ctx.ui.notify(`✗ ${event.toolName} thất bại`, "error");
  });

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  COMMANDS & SHORTCUTS                                        ║
  // ╚══════════════════════════════════════════════════════════════╝

  pi.registerCommand("aurora-themes", {
    description: "Chọn theme nhanh",
    handler: async (_args, ctx) => {
      const names = ctx.ui.getAllThemes().map((t: any) => t.name);
      const chosen = await ctx.ui.select("🎨  Chọn theme:", names);
      if (!chosen) return;
      const r = ctx.ui.setTheme(chosen);
      ctx.ui.notify(r.success ? `✓ Theme: ${chosen}` : `✗ ${r.error}`, r.success ? "info" : "error");
    },
  });

  pi.registerShortcut("ctrl+shift+t", {
    description: "Chọn theme nhanh",
    handler: async (_key, ctx) => {
      const names = ctx.ui.getAllThemes().map((t: any) => t.name);
      const chosen = await ctx.ui.select("🎨  Chọn theme:", names);
      if (!chosen) return;
      const r = ctx.ui.setTheme(chosen);
      if (r.success) ctx.ui.notify(`✓ ${chosen}`, "info");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BorderedEditor — Input box với rounded border
//
//  Layout:
//  ╭─ 7% of 300k ──────────────────── sonnet─◑ medium─my-session ─╮
//  │ > type your prompt here_                                       │
//  ╰───────────────────────────────── ~/Desktop/project (main) ─────╯
// ═══════════════════════════════════════════════════════════════════════════════

class BorderedEditor extends CustomEditor {
  private piRef: ExtensionAPI;
  private ctxRef: any;
  private getBranch: () => string | null;

  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    pi: ExtensionAPI,
    ctx: any,
    getBranch: () => string | null,
  ) {
    // CustomEditor constructor: (tui, theme, keybindings, options?)
    super(tui, theme, keybindings);
    this.piRef = pi;
    this.ctxRef = ctx;
    this.getBranch = getBranch;
  }

  render(width: number): string[] {
    const t = this.ctxRef.ui.theme;
    // Inner width = width - 4 (for "│ " on left + " │" on right)
    const inner = Math.max(1, width - 4);

    // Get editor content with reduced width
    const allLines = super.render(inner);

    // super.render() returns: [topBorder, ...contentLines, bottomBorder, ...autocompleteLines]
    // We need to strip the Editor's own top/bottom borders (─────) and keep
    // only the content lines + autocomplete lines.
    // Top border = first line (always a ─── line)
    // Bottom border = find the second ─── line after content
    let topBorderIdx = 0; // always index 0
    let bottomBorderIdx = -1;

    // Find the bottom border: scan from index 1 for the next full-width ─── line
    for (let i = 1; i < allLines.length; i++) {
      const stripped = allLines[i].replace(/\x1b\[[^m]*m/g, ""); // strip ANSI
      if (/^[─↓ ]+$/.test(stripped) && stripped.includes("─")) {
        bottomBorderIdx = i;
        break;
      }
    }

    // Content lines = between top and bottom border
    const contentLines = bottomBorderIdx > 0
      ? allLines.slice(topBorderIdx + 1, bottomBorderIdx)
      : allLines.slice(topBorderIdx + 1);

    // Autocomplete lines = after bottom border (if any)
    const autocompleteLines = bottomBorderIdx > 0
      ? allLines.slice(bottomBorderIdx + 1)
      : [];

    const result: string[] = [];

    // ── Top border with badges ──
    result.push(this.topBorder(width, t));

    // ── Content lines with side borders ──
    for (const line of contentLines) {
      const vw = visibleWidth(line);
      const pad = " ".repeat(Math.max(0, inner - vw));
      result.push(
        t.fg("borderAccent", "│") + " " + line + pad + " " + t.fg("borderAccent", "│")
      );
    }

    // ── Bottom border with cwd ──
    result.push(this.bottomBorder(width, t));

    // ── Autocomplete dropdown (rendered after bottom border) ──
    for (const line of autocompleteLines) {
      result.push(line);
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  //  Top border: ╭─ context ──────── model─thinking─session ─╮
  // ─────────────────────────────────────────────────────────────
  private topBorder(w: number, t: any): string {
    const bc = "borderAccent";

    // Fallback for very narrow terminals
    if (w < 20) return t.fg(bc, "╭" + "─".repeat(Math.max(0, w - 2)) + "╮");

    // ── Left badge: context usage ──
    const usage = this.ctxRef.getContextUsage();
    let lRaw = "";
    let lStyled = "";
    if (usage) {
      const pct = Math.round((usage.tokens / usage.contextWindow) * 100);
      const totalK = Math.round(usage.contextWindow / 1000);
      const c = pct > 80 ? "error" : pct > 55 ? "warning" : "success";
      lRaw = `${pct}% of ${totalK}k`;
      lStyled = t.fg(c, lRaw);
    }

    // ── Right badges: model ─ thinking ─ session ──
    const rParts: { raw: string; styled: string }[] = [];

    const m = this.ctxRef.model;
    if (m) {
      const name = shortModel(m.id);
      rParts.push({ raw: name, styled: t.fg("accent", name) });
    }

    const lv = this.piRef.getThinkingLevel();
    if (lv && lv !== "off") {
      const dots: Record<string, string> = {
        minimal: "◌", low: "◔", medium: "◑", high: "◕", xhigh: "●",
      };
      const colors: Record<string, string> = {
        minimal: "dim", low: "muted", medium: "border", high: "accent", xhigh: "error",
      };
      const badge = `${dots[lv] ?? "?"} ${lv}`;
      rParts.push({ raw: badge, styled: t.fg(colors[lv] ?? "muted", badge) });
    }

    const sessionName = this.ctxRef.sessionManager?.getSessionName?.();
    if (sessionName) {
      rParts.push({ raw: sessionName, styled: t.fg("accent", sessionName) });
    }

    // Join right badges with ─ separator (embedded in border)
    const rRaw = rParts.map(p => p.raw).join("─");
    const rStyled = rParts.map(p => p.styled).join(t.fg(bc, "─"));
    const lW = lRaw.length;
    const rW = rRaw.length;

    // Layout: ╭─ left ───...─── right ─╮
    // Width:  3 + lW + 1 + filler + 1 + rW + 3 = w
    if (lW > 0 && rW > 0) {
      const fill = Math.max(1, w - 8 - lW - rW);
      return (
        t.fg(bc, "╭─ ") + lStyled + " " +
        t.fg(bc, "─".repeat(fill)) + " " +
        rStyled + t.fg(bc, " ─╮")
      );
    }
    if (lW > 0) {
      const fill = Math.max(1, w - 5 - lW);
      return t.fg(bc, "╭─ ") + lStyled + t.fg(bc, " " + "─".repeat(fill) + "╮");
    }
    if (rW > 0) {
      const fill = Math.max(1, w - 5 - rW);
      return t.fg(bc, "╭" + "─".repeat(fill) + " ") + rStyled + t.fg(bc, " ─╮");
    }
    return t.fg(bc, "╭" + "─".repeat(w - 2) + "╮");
  }

  // ─────────────────────────────────────────────────────────────
  //  Bottom border: ╰───────── ~/path/to/project (main) ────╯
  // ─────────────────────────────────────────────────────────────
  private bottomBorder(w: number, t: any): string {
    const bc = "borderAccent";

    if (w < 20) return t.fg(bc, "╰" + "─".repeat(Math.max(0, w - 2)) + "╯");

    // Build cwd + git branch text
    const cwd = this.ctxRef.cwd.replace(/\/home\/[^/]+/, "~");
    const branch = this.getBranch();
    const cwdRaw = branch ? `${cwd} (${branch})` : cwd;
    const cwdStyled = branch
      ? t.fg("muted", cwd + " ") + t.fg("dim", "(") + t.fg("accent", branch) + t.fg("dim", ")")
      : t.fg("muted", cwd);
    const cwdW = cwdRaw.length;

    // Layout: ╰───...─── cwdText ─╯
    // Width:  1 + filler + 1 + cwdW + 3 = w
    const fill = Math.max(1, w - 5 - cwdW);
    return (
      t.fg(bc, "╰" + "─".repeat(fill) + " ") +
      cwdStyled +
      t.fg(bc, " ─╯")
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function showBanner(ctx: any) {
  const t = ctx.ui.theme;
  const time = new Date().toLocaleString("vi-VN", {
    weekday: "short", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const w = 44;
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  const lines = [
    t.fg("borderAccent", "╭" + "─".repeat(w) + "╮"),
    t.fg("borderAccent", "│") + "  " + t.fg("accent", t.bold(" ◈  Pi Coding Agent")) + " ".repeat(w - 21) + t.fg("borderAccent", "│"),
    t.fg("borderAccent", "│") + "  " + t.fg("text", pad("  " + time, w - 2)) + t.fg("borderAccent", "│"),
    t.fg("borderAccent", "│") + "  " + t.fg("muted", pad("  midnight-aurora theme", w - 2)) + t.fg("borderAccent", "│"),
    t.fg("borderAccent", "╰" + "─".repeat(w) + "╯"),
  ];
  ctx.ui.setWidget("aurora-banner", lines);
}

function shortModel(id: string): string {
  if (id.includes("sonnet")) return "sonnet";
  if (id.includes("haiku")) return "haiku";
  if (id.includes("opus")) return "opus";
  if (id.includes("gpt-4o-mini")) return "4o-mini";
  if (id.includes("gpt-4o")) return "4o";
  if (id.includes("gpt-4")) return "gpt4";
  if (id.includes("gemini-2.5-pro")) return "gem-pro";
  if (id.includes("gemini-2.5-flash")) return "gem-flash";
  if (id.includes("gemini")) return "gemini";
  if (id.includes("deepseek")) return "deepseek";
  return id.length > 15 ? id.slice(0, 12) + "…" : id;
}
