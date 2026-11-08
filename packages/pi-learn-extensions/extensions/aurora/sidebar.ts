/** Aurora prompt sidebar: viewport navigation only, no session mutations. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, MouseRegion, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { transcriptSnapshot, type LayoutFrame, type MountedPrompt } from "./navigation.ts";
import { fit, mountLayout, MIN_COLUMNS, type InternalTUI, type Mount, type Side } from "./layout.ts";
import { paintSidebarBackground } from "./surface.ts";

const TOGGLE_ICON = "≡";

export default function registerSidebar(pi: ExtensionAPI, options: { widgetKey?: string } = {}) {
  const widgetKey = options.widgetKey ?? "aurora-sidebar-toggle";
  let tui: InternalTUI | undefined;
  let ctx: ExtensionContext | undefined;
  let toggleContext: ExtensionContext | undefined;
  let toggleTui: InternalTUI | undefined;
  let mount: Mount | undefined;
  let mountedKey = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  let side: Side = "right";
  let lastFrame: LayoutFrame | undefined;
  let snapshot: ReturnType<typeof transcriptSnapshot>;
  let snapshotReady = false;
  let prompts: MountedPrompt[] = [];
  let signature = "";
  let selected: number | undefined;
  let selectedTop: number | undefined;
  let offset = 0;
  let followListEnd = true;
  type Hit = { start: number; end: number; source: Component };
  const hits = new Map<number, Hit>();
  let pressed: Component | undefined;
  const panelHeight = () => mount?.sidebarHeight?.() || Math.max(1, toggleTui?.terminal.rows ?? 1);
  const capacity = () => Math.max(0, panelHeight());
  const activePrompt = () => {
    if (selected !== undefined) return selected;
    if (!snapshot) return undefined;
    return snapshot.scroll.isFollowingEnd ? prompts.length - 1
      : prompts.findLastIndex((p) => p.row <= snapshot!.scroll.scrollTop + 1);
  };

  // One geometry pass per completed frame, not per sidebar item. Message rendering
  // reuses Pi component caches. The short polling loop catches new
  // inputs, tool expansion, resize, compaction, /tree, and renderer replacement.
  const sync = () => {
    if (!tui || tui.mode !== "fullscreen") {
      snapshot = undefined;
      snapshotReady = false;
      prompts = [];
      lastFrame = undefined;
      return false;
    }
    const frame = tui.currentLayout;
    if (!frame || frame.width !== tui.terminal.columns || frame.height !== tui.terminal.rows) {
      snapshotReady = false;
      lastFrame = undefined;
      return false;
    }
    if (frame === lastFrame) return false;
    lastFrame = frame;
    const next = transcriptSnapshot(frame);
    // Streaming can grow the document BEFORE currentLayout is committed. An
    // inconsistent geometry pass is not an empty transcript: retain the last
    // good list/highlight, but do not navigate with those stale row positions.
    if (!next) { snapshotReady = false; return false; }
    snapshotReady = true;
    const nextPrompts = next.prompts;
    if (selected !== undefined && prompts[selected]?.source !== nextPrompts[selected]?.source) {
      selected = undefined;
      selectedTop = undefined;
    }
    const identityChanged = prompts.length !== nextPrompts.length || prompts.some((p, i) => p.source !== nextPrompts[i]?.source);
    snapshot = next;
    prompts = nextPrompts;
    if (selectedTop !== undefined && snapshot?.scroll.scrollTop !== selectedTop) {
      selected = undefined;
      selectedTop = undefined;
    }
    // Geometry is refreshed above; only visible list changes need another paint.
    // Following a growing answer moves scrollTop without changing this sidebar.
    const nextSignature = JSON.stringify([frame.width, frame.height, prompts.map(({ label }) => label), activePrompt()]);
    const changed = identityChanged || signature !== nextSignature;
    signature = nextSignature;
    return changed;
  };

  const stop = () => {
    mount?.dispose();
    mount = undefined;
    mountedKey = "";
    tui?.invalidate();
    tui?.requestRender(true);
    tui = undefined;
    ctx = undefined;
    lastFrame = undefined;
    snapshot = undefined;
    snapshotReady = false;
    prompts = [];
    signature = "";
    selected = undefined;
    selectedTop = undefined;
    offset = 0;
    followListEnd = true;
    hits.clear();
    pressed = undefined;
  };

  const movePage = (delta: number) => {
    followListEnd = false;
    offset = Math.max(0, Math.min(Math.max(0, prompts.length - capacity()), offset + delta));
    tui?.requestRender();
  };

  const jump = (index: number, source?: Component) => {
    // Complete pending reflow before resolving rows. Click targets retain the
    // actual UserMessage component, not a stale ordinal or a truncated label.
    tui?.renderNow();
    sync();
    if (source) index = prompts.findIndex((prompt) => prompt.source === source);
    const prompt = prompts[index];
    if (!snapshotReady || !snapshot || !prompt) return false;
    selected = index;
    snapshot.scroll.scrollTo(prompt.row, { disableFollow: true });
    selectedTop = snapshot.scroll.scrollTop;
    followListEnd = false;
    const size = capacity();
    if (index < offset) offset = index;
    else if (index >= offset + size) offset = Math.max(0, index - size + 1);
    tui?.requestRender();
    return true;
  };

  const bottom = () => {
    sync();
    if (!snapshotReady || !snapshot) return;
    selected = undefined;
    selectedTop = undefined;
    followListEnd = true;
    snapshot.scroll.scrollToEnd();
    tui?.requestRender();
  };

  const panel = new MouseRegion({
    invalidate() {},
    render(width) {
      if (!ctx || !tui) return [];
      sync();
      hits.clear();
      const height = Math.max(1, panelHeight());
      const bodyWidth = width - 2;
      const theme = ctx.ui.theme;
      const content = Array<string>(height).fill("");
      const bodyStart = 1;
      if (tui.mode !== "fullscreen") {
        content[0] = theme.fg("warning", "Cần fullscreen để điều hướng");
        if (height > 1) content[1] = theme.fg("dim", "Đổi TUI mode trong /settings");
      } else {
        const size = capacity();
        if (followListEnd) offset = Math.max(0, prompts.length - size);
        offset = Math.max(0, Math.min(offset, Math.max(0, prompts.length - size)));
        const active = activePrompt();
        if (snapshot && !prompts.length) content[0] = theme.fg("dim", "Chưa có prompt trong chat.");
        for (let i = offset; i < Math.min(prompts.length, offset + size); i++) {
          const row = i - offset;
          const text = truncateToWidth(`  ${i + 1}. ${prompts[i].label}`, bodyWidth, "…");
          content[row] = theme.fg(i === active ? "accent" : "text", text);
          hits.set(row, { start: bodyStart, end: bodyStart + bodyWidth, source: prompts[i].source });
        }
      }
      return content.map((line) => " " + fit(line, bodyWidth) + " ");
    },
  }, (event) => {
    if (!tui || tui.mode !== "fullscreen" || tui.terminal.columns < MIN_COLUMNS || tui.terminal.rows < 10) return;
    if (event.x < 0 || event.x >= event.width || event.y < 0 || event.y >= event.height) return;
    if (event.type === "wheel") {
      sync();
      movePage(Math.sign(event.wheelDelta ?? 0) * 3);
      return { handled: true };
    }
    if (event.button !== "left" || !["press", "release", "click"].includes(event.type)) return;
    const target = hits.get(event.y);
    const hit = target && event.x >= target.start && event.x < target.end ? target : undefined;
    if (event.type === "press") {
      pressed = hit?.source;
      return; // Preserve native drag selection on every input row.
    }
    if (event.type !== "click" || !hit || !pressed) return;
    const source = pressed;
    pressed = undefined;
    jump(-1, source);
    return { handled: true };
  });

  const sidebarSurface = (child: Component) => {
    const box = new Box(0, 0, (line) => toggleContext ? paintSidebarBackground(line, toggleContext.ui.theme) : line);
    box.addChild(child);
    return box;
  };
  const panelSurface = sidebarSurface(panel);

  const ensureMounted = () => {
    const host = toggleTui;
    if (!host || !toggleContext) return;
    const key = `${host.mode}:${!!tui}:${side}`;
    if (mount?.isCurrent() && mountedKey === key) return;
    mount?.dispose();
    mount = mountLayout(host, panelSurface, side, !!tui);
    mountedKey = key;
    lastFrame = undefined;
    host.invalidate();
    host.requestRender(true);
  };

  const handleCommand = (args: string, context: ExtensionContext) => {
    if (!context.hasUI || context.mode !== "tui") {
      if (context.hasUI) context.ui.notify("Sidebar chỉ chạy trong TUI.", "warning");
      else console.log("Sidebar chỉ chạy trong TUI.");
      return;
    }
    if (!toggleContext || !timer) setupToggle(context);
    const action = args.trim().toLowerCase();
    const go = /^goto\s+([1-9]\d*)$/.exec(action);
    if (!["", "on", "off", "left", "right", "bottom", "prev", "next"].includes(action) && !go) {
      context.ui.notify("Dùng /sidebar [on|off|left|right|goto N|bottom|prev|next]", "warning");
      return;
    }
    if (go || ["bottom", "prev", "next"].includes(action)) {
      if (!tui || tui.mode !== "fullscreen") {
        context.ui.notify("Bật /sidebar trong fullscreen trước khi điều hướng.", "warning");
        return;
      }
      ctx = context;
      sync();
      if (go) {
        if (!jump(Number(go[1]) - 1)) context.ui.notify("Không tìm thấy prompt này trong transcript đang hiển thị.", "warning");
      } else if (action === "bottom") bottom();
      else movePage((action === "prev" ? -1 : 1) * capacity());
      return;
    }
    if (action === "off" || (action === "" && tui)) {
      stop();
      try { ensureMounted(); } catch (error) { context.ui.notify(String(error), "error"); }
      return;
    }
    const nextSide = action === "left" || action === "right" ? action : side;
    if (tui) {
      ctx = context;
      if (side !== nextSide) { mount?.dispose(); mount = undefined; side = nextSide; }
      ensureMounted();
      return;
    }
    stop();
    side = nextSide;
    ctx = context;
    try {
      if (!toggleTui) throw new Error("Pi không cung cấp TUI cho widget factory.");
      tui = toggleTui;
      ensureMounted();
    } catch (error) {
      stop();
      if (timer) clearInterval(timer);
      timer = undefined;
      context.ui.notify(String(error), "error");
    }
  };

  pi.registerCommand("sidebar", {
    description: "Prompt navigator: /sidebar [on|off|left|right|goto N|bottom|prev|next]",
    getArgumentCompletions(prefix) {
      return ["on", "off", "left", "right", "goto ", "bottom", "prev", "next"]
        .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
    },
    handler: handleCommand,
  });

  const makeToggle = () => {
    let bounds: { start: number; end: number; width: number } | undefined;
    let armed = false;
    return new MouseRegion({
      invalidate() { bounds = undefined; },
      render(width) {
        bounds = undefined;
        if (!toggleContext || !toggleTui) return [];
        const theme = toggleContext.ui.theme;
        const length = visibleWidth(TOGGLE_ICON);
        const start = Math.max(0, width - length - 1);
        if (toggleTui.mode === "fullscreen" && length + 1 <= width) {
          bounds = { start: Math.max(0, start - 1), end: Math.min(width, start + length + 1), width };
        }
        const active = !!tui && toggleTui.mode === "fullscreen";
        return [" ".repeat(start) + theme.fg(active ? "accent" : "muted", active ? theme.bold(TOGGLE_ICON) : TOGGLE_ICON)];
      },
    }, (event) => {
      if (!toggleContext || toggleTui?.mode !== "fullscreen") return;
      if (event.button !== "left") return;
      const inside = !!bounds && event.y === 0 && event.width === bounds.width && event.x >= bounds.start && event.x < bounds.end;
      if (event.type === "press") armed = inside;
      if (event.type === "drag") armed = false;
      if (event.type === "click" && inside && armed) {
        armed = false;
        if (!tui && (toggleTui.terminal.columns < MIN_COLUMNS || toggleTui.terminal.rows < 10)) {
          toggleContext.ui.notify("Cần terminal ít nhất 84 cột × 10 dòng để mở mục lục.", "warning");
        } else handleCommand("", toggleContext);
        toggleTui.requestRender();
      }
      // The toggle widget is not a text selection surface, even in blank space.
      return { handled: true, render: event.type === "click" };
    });
  };
  const setupToggle = (context: ExtensionContext) => {
    if (!context.hasUI || context.mode !== "tui") return;
    toggleContext = context;
    // Native placement keeps the button directly above the editor, following
    // multiline input, status/pending widgets and resize without a screen offset.
    context.ui.setWidget(widgetKey, (host) => {
      toggleTui = host as InternalTUI;
      return makeToggle();
    }, { placement: "aboveEditor" });
    try {
      ensureMounted();
      if (!timer) {
        timer = setInterval(() => {
          try {
            ensureMounted();
            if (tui && sync()) toggleTui?.requestRender();
          } catch (error) {
            const current = toggleContext;
            stop();
            if (timer) clearInterval(timer);
            timer = undefined;
            if (current?.hasUI) current.ui.notify(String(error), "error");
          }
        }, 250);
        timer.unref?.();
      }
    } catch (error) { context.ui.notify(String(error), "error"); }
  };

  const refresh = (context: ExtensionContext) => {
    if (toggleContext) toggleContext = context;
    if (!tui) return;
    ctx = context;
    tui.requestRender();
  };
  pi.on("session_start", (_event, context) => setupToggle(context));
  pi.on("message_start", (_event, context) => refresh(context));
  pi.on("agent_settled", (_event, context) => refresh(context));
  pi.on("session_tree", (_event, context) => refresh(context));
  pi.on("session_compact", (_event, context) => refresh(context));
  pi.on("session_shutdown", () => {
    stop();
    if (timer) clearInterval(timer);
    timer = undefined;
    if (toggleContext?.hasUI && toggleContext.mode === "tui") toggleContext.ui.setWidget(widgetKey, undefined);
    toggleContext = undefined;
    toggleTui = undefined;
  });
}
