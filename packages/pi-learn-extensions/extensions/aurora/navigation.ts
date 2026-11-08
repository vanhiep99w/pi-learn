import { Container, stripTerminalSequences, truncateToWidth, type Component, type ScrollView } from "@earendil-works/pi-tui";

export type Prompt = { row: number; label: string };
export type MountedPrompt = Prompt & { source: Component };
export type LayoutBox = {
  scrollView?: ScrollView;
  scrollContentLines?: readonly string[];
  rect: { width: number };
  children: LayoutBox[];
};
export type LayoutFrame = {
  root: LayoutBox;
  primaryScrollView?: ScrollView;
  width: number;
  height: number;
};

const ZONE_PREFIX = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;
const START = /\x1b\]133;A(?:\x07|\x1b\\)/;
const END = /\x1b\]133;[BC](?:\x07|\x1b\\)/;

/** Parse native OSC 133 zones. Pi marks BOTH user and assistant messages:
 * transcriptSnapshot must filter these by the mounted UserMessage components.
 */
export function indexPrompts(lines: readonly string[]): Prompt[] {
  const prompts: Prompt[] = [];
  let current: Prompt | undefined;
  for (let row = 0; row < lines.length; row++) {
    const prefix = lines[row].match(ZONE_PREFIX)?.[0] ?? "";
    const starts = START.test(prefix);
    if (starts) {
      current = { row, label: "" };
      prompts.push(current);
    }
    if (!current) continue;
    const text = stripTerminalSequences(lines[row]).replace(/\s+/gu, " ").trim();
    if (text && current.label.length < 160) {
      current.label = truncateToWidth([current.label, text].filter(Boolean).join(" "), 160, "…");
    }
    if (END.test(prefix)) current = undefined;
  }
  return prompts.map((prompt) => ({ ...prompt, label: prompt.label || "(Tin nhắn trống)" }));
}

export function transcriptSnapshot(frame: LayoutFrame) {
  const scroll = frame.primaryScrollView;
  if (!scroll || typeof scroll.scrollTo !== "function") return undefined;
  const find = (box: LayoutBox): LayoutBox | undefined => {
    if (box.scrollView === scroll) return box;
    for (const child of box.children) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  const box = find(frame.root);
  if (!box?.scrollContentLines) return undefined;
  const document = scroll.children[0];
  if (!document) return undefined;
  const width = scroll.getContentWidth(box.rect.width);
  const userRows: { row: number; source: Component }[] = [];
  const walk = (node: Component, row: number): number => {
    const candidate = node as Component & { text?: unknown; messageId?: unknown; rebuild?: unknown; setOutputPad?: unknown; children?: Component[] };
    // Private UserMessageComponent shape; avoid constructor names (bundled builds
    // can rename classes). AssistantMessageComponent has no text/rebuild pair.
    const isUser = typeof candidate.text === "string" && "messageId" in candidate &&
      typeof candidate.rebuild === "function" && typeof candidate.setOutputPad === "function";
    if (isUser) {
      userRows.push({ row, source: node });
      return node.render(width).length;
    }
    // Plain Containers are vertical sums. Treat other components (including
    // assistant/thinking/tool blocks) as opaque, counting their actual height.
    if (node.render === Container.prototype.render && Array.isArray(candidate.children)) {
      let height = 0;
      for (const child of candidate.children) height += walk(child, row + height);
      return height;
    }
    return node.render(width).length;
  };
  const height = walk(document, 0);
  if (height !== box.scrollContentLines.length) return undefined;
  const zones = new Map(indexPrompts(box.scrollContentLines).map((prompt) => [prompt.row, prompt]));
  const prompts: MountedPrompt[] = userRows.flatMap(({ row, source }) => zones.has(row) ? [{ ...zones.get(row)!, source }] : []);
  return { scroll, prompts };
}
