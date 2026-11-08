import { visibleWidth } from "@earendil-works/pi-tui";

type OutputTerminal = { write(data: string): void };

/** VTE 0.84 paints U+2630 in one cell, whereas Pi 1.5 measures two.
 * Pad only printable output, AFTER layout/width calculations. The native model,
 * selection/copy, links, session data and ANSI control payloads remain unchanged.
 * Stateful parsing also protects control strings split across write() calls.
 */
export function createVteOutputPadder() {
  let state: "text" | "escape" | "csi" | "osc" | "string" | "oscEnd" | "stringEnd" = "text";
  return (data: string): string => {
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      switch (state) {
        case "text":
          if (char === "\x1b") state = "escape";
          else if (char === "\x9b") state = "csi";
          else if (char === "\x9d") state = "osc";
          else if (char === "☰") {
            parts.push(data.slice(start, i + 1), " ");
            start = i + 1;
          }
          break;
        case "escape":
          if (char === "[") state = "csi";
          else if (char === "]") state = "osc";
          else if (["P", "_", "^", "X"].includes(char)) state = "string";
          else state = char === "\x1b" ? "escape" : "text";
          break;
        case "csi":
          if (char >= "@" && char <= "~") state = "text";
          break;
        case "osc":
          if (char === "\x07" || char === "\x9c") state = "text";
          else if (char === "\x1b") state = "oscEnd";
          break;
        case "string":
          if (char === "\x9c") state = "text";
          else if (char === "\x1b") state = "stringEnd";
          break;
        case "oscEnd":
        case "stringEnd":
          if (char === "\\") state = "text";
          else if (char !== "\x1b") state = state === "oscEnd" ? "osc" : "string";
          break;
      }
    }
    return parts.length ? parts.join("") + data.slice(start) : data;
  };
}

/** Session-local, reversible output shim; never patch files or other terminals. */
export function installVteWidthGuard(terminal: OutputTerminal, vteVersion = process.env.VTE_VERSION): () => void {
  if (!/^84\d{2}$/.test(vteVersion ?? "") || visibleWidth("☰") !== 2) return () => {};
  const original = terminal.write;
  const pad = createVteOutputPadder();
  let active = true;
  const wrapped = (data: string) => original.call(terminal, active ? pad(data) : data);
  terminal.write = wrapped;
  return () => {
    active = false;
    if (terminal.write === wrapped) terminal.write = original;
  };
}
