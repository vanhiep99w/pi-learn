import {
  Container, HStack, ScrollView, isViewportTUI, truncateToWidth, visibleWidth,
  type Component, type TUI,
} from "@earendil-works/pi-tui";
import type { LayoutFrame } from "./navigation.ts";
import { installVteWidthGuard } from "./terminal-width.ts";

export type Side = "left" | "right";
export type InternalTUI = TUI & {
  layoutRoot?: Component;
  currentLayout?: LayoutFrame;
  setLayoutRoot?(root: Component): void;
  resetTextSelection?(): void;
};
export type Mount = { isCurrent(): boolean; dispose(): void; sidebarHeight?(): number };
export const WIDTH = 33;
export const MIN_COLUMNS = 84;

export function fit(line: string, width: number): string {
  const clipped = truncateToWidth(line, width);
  return clipped + "\x1b[0m" + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Private layout adapter for Pi 1.5. Original transcript/editor/footer stay intact. */
export function mountLayout(
  tui: InternalTUI, panel: Component,
  side: Side, open: boolean,
): Mount {
  if (isViewportTUI(tui)) {
    const original = tui.layoutRoot;
    const parts = (original as (Component & { children?: Component[] }) | undefined)?.children;
    const transcript = parts?.[0] as ScrollView | undefined;
    if (!original || parts?.length !== 2 || !transcript?.primary || typeof transcript.scrollTo !== "function") {
      throw new Error("Pi fullscreen layoutRoot/transcript không tương thích với Aurora sidebar.");
    }
    // The native above-editor widget owns the toggle; no extra toolbar row.
    let root: Component = original;
    let sidebarViewport: ScrollView | undefined;
    const previousScrollbar = transcript.scrollbar;
    if (open) {
      // Keep the shared pane edge clean: suppress the transient native scrollbar
      // while open, without changing persisted settings.
      transcript.setScrollbar("hidden");
      sidebarViewport = new ScrollView(panel, {
        primary: false, follow: "none", overscroll: "contain", scrollbar: "hidden",
      });
      const sidebar = {
        component: sidebarViewport,
        basis: WIDTH, grow: 0, shrink: 0, minSize: WIDTH,
        visible: ({ width }: { width: number }) => width >= MIN_COLUMNS,
      };
      const chat = { component: original, basis: 0, grow: 1, shrink: 1, minSize: 1 };
      root = new HStack(side === "right" ? [chat, sidebar] : [sidebar, chat]);
    }
    const restoreWidth = open ? installVteWidthGuard(tui.terminal) : () => {};
    tui.setLayoutRoot(root);
    return {
      isCurrent: () => tui.mode === "fullscreen" && tui.layoutRoot === root,
      sidebarHeight: () => sidebarViewport?.viewportHeight ?? 0,
      dispose() {
        restoreWidth();
        // Restore the captured ScrollView even if the stable reference now points
        // at a replacement renderer. Preserve an explicit external style change.
        if (open && transcript.scrollbar === "hidden") transcript.setScrollbar(previousScrollbar);
        if (tui.layoutRoot === root) {
          tui.resetTextSelection?.();
          tui.setLayoutRoot!(original);
        }
      },
    };
  }

  const roots = tui.children;
  if (!open) return { isCurrent: () => tui.mode === "regular" && tui.children === roots, dispose() {} };
  const chat = new Container();
  chat.children = roots.splice(0);
  const split: Component & { children: Component[] } = {
    children: [chat, panel],
    invalidate() { chat.invalidate(); panel.invalidate(); },
    render(width) {
      if (width < MIN_COLUMNS) return chat.render(width);
      const chatWidth = width - WIDTH;
      const lines = chat.render(chatWidth);
      const panelLines = panel.render(WIDTH);
      const top = Math.max(0, lines.length - tui.terminal.rows);
      return lines.map((line, row) => {
        const aside = fit(panelLines[row - top] ?? "", WIDTH);
        const main = fit(line, chatWidth);
        return side === "right" ? main + aside : aside + main;
      });
    },
  };
  roots.push(split);
  const unwrap = (children: Component[]) => {
    const index = children.indexOf(split);
    if (index !== -1) children.splice(index, 1, ...chat.children);
  };
  return {
    isCurrent: () => tui.mode === "regular" && tui.children.includes(split),
    dispose() { unwrap(roots); if (tui.children !== roots) unwrap(tui.children); },
  };
}
