import type { Theme } from "@earendil-works/pi-coding-agent";

/** Use the active theme's panel surface, including terminal-default backgrounds.
 * Preserve foreground/styles and restore the panel after inline resets.
 */
export function paintSidebarBackground(line: string, theme: Pick<Theme, "getBgAnsi">): string {
  const bg = theme.getBgAnsi("customMessageBg");
  const body = line.replace(/\x1b\[([0-9;]*)m/g, (_sequence, values: string) => {
    const codes = values ? values.split(";").map(Number) : [0];
    const kept: number[] = [];
    let reset = false;
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 38 || code === 48) {
        const length = codes[i + 1] === 2 ? 5 : codes[i + 1] === 5 ? 3 : 1;
        if (code === 38) kept.push(...codes.slice(i, i + length));
        i += length - 1;
      } else if (code !== 49 && !(code >= 40 && code <= 47) && !(code >= 100 && code <= 107)) {
        kept.push(code);
        if (code === 0) reset = true;
      }
    }
    return (kept.length ? `\x1b[${kept.join(";")}m` : "") + (reset ? bg : "");
  });
  return bg + body + "\x1b[49m";
}
