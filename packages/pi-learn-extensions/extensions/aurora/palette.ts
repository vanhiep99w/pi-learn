// Adaptive Aurora color engine. No terminal I/O or Pi state lives here.
// Uses OKLCH to preserve source hue/chroma and WCAG luminance constraints.
export type AuroraSource = {
  name: string;
  vars: Record<string, string>;
  colors: Record<string, string>;
};

export const BACKGROUND_TOKENS = new Set([
  "selectedBg", "searchMatchBg", "userMessageBg", "customMessageBg",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg",
]);

export type GeneratedAurora = {
  name: string;
  appearance: "dark" | "light";
  background: string;
  colors: Record<string, string>;
};

type Oklch = { l: number; c: number; h: number };
type Rgb = [number, number, number];
const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));

function channels(hex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected sRGB hex color: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
}
const linear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gamma = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(first: string, second: string): number {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function toOklch(hex: string): Oklch {
  const [r, g, b] = channels(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return {
    l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    c: Math.hypot(a, bb),
    h: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360,
  };
}

function toLinearRgb(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * ll - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * ll + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * ll - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function colorAtLightness(source: Oklch, l: number): string {
  // Anchored falloff: never increase source chroma, even when moving toward
  // the middle. Near black/white use only a hint of the original color.
  const bell = (x: number) => Math.sqrt(Math.max(0, x * (1 - x)));
  const falloff = Math.min(1, bell(l) / Math.max(0.0001, bell(source.l)));
  let c = source.c * falloff;
  const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-7 && v <= 1 + 1e-7);
  if (!inGamut(toLinearRgb(l, c, source.h))) {
    let low = 0, high = c;
    for (let i = 0; i < 24; i++) {
      const middle = (low + high) / 2;
      if (inGamut(toLinearRgb(l, middle, source.h))) low = middle;
      else high = middle;
    }
    c = low;
  }
  const encode = (chroma: number) => "#" + toLinearRgb(l, chroma, source.h)
    .map((v) => Math.round(clamp(gamma(clamp(v))) * 255).toString(16).padStart(2, "0"))
    .join("");
  let hex = encode(c);
  // At low RGB values a one-channel rounding step can increase chroma
  // noticeably. Cap the actual eight-bit output too, not just the target.
  for (let i = 0; i < 16 && toOklch(hex).c > source.c + 0.0005; i++) {
    c *= 0.75;
    hex = encode(c);
  }
  return toOklch(hex).c <= source.c + 0.0005 ? hex : encode(0);
}

function colorAtLuminance(source: string, target: number): string {
  const color = toOklch(source);
  let low = 0, high = 1;
  for (let i = 0; i < 36; i++) {
    const l = (low + high) / 2;
    if (luminance(colorAtLightness(color, l)) < target) low = l;
    else high = l;
  }
  const first = colorAtLightness(color, low), second = colorAtLightness(color, high);
  return Math.abs(luminance(first) - target) < Math.abs(luminance(second) - target) ? first : second;
}

export function resolveSource(source: AuroraSource): Record<string, string> {
  return Object.fromEntries(Object.entries(source.colors).map(([token, initial]) => {
    let value = initial;
    const seen = new Set<string>();
    while (Object.hasOwn(source.vars, value)) {
      if (seen.has(value)) throw new Error(`Circular Aurora color variable: ${value}`);
      seen.add(value);
      value = source.vars[value];
    }
    channels(value);
    return [token, value];
  }));
}

function surface(source: string, background: string, ratio: number, dark: boolean): string {
  const y = luminance(background);
  // Near mid-gray, moving a panel toward the text can make 4.5:1 impossible.
  // Move it away instead, keeping all surfaces on the same contrast polarity.
  const preferred = dark ? (y + 0.05) * ratio - 0.05 : (y + 0.05) / ratio - 0.05;
  const target = dark
    ? preferred <= 0.16 ? preferred : (y + 0.05) / ratio - 0.05
    : preferred >= 0.20 ? preferred : (y + 0.05) * ratio - 0.05;
  return colorAtLuminance(source, clamp(target));
}

function readable(source: string, backgrounds: string[], requested: number, dark: boolean): string {
  const surfaces = backgrounds.map(luminance);
  const strictest = dark ? Math.max(...surfaces) : Math.min(...surfaces);
  const maximum = dark ? 1.05 / (strictest + 0.05) : (strictest + 0.05) / 0.05;
  const ratio = Math.min(requested, maximum - 0.015);
  const target = dark ? ratio * (strictest + 0.05) - 0.05 : (strictest + 0.05) / ratio - 0.05;
  const result = colorAtLuminance(source, clamp(target));
  // Verify the quantized sRGB output, not just the continuous OKLCH target.
  // At very unusual near-mid-gray backgrounds, a neutral endpoint is safer.
  if (requested >= 4.5 && backgrounds.some((bg) => contrast(result, bg) < 4.5)) {
    return dark ? "#ffffff" : "#000000";
  }
  return result;
}

export function generateAurora(source: AuroraSource, background: string): GeneratedAurora {
  channels(background);
  const originals = resolveSource(source);
  // Choose the side with more available WCAG contrast, including mid-gray.
  const dark = contrast("#ffffff", background) >= contrast("#000000", background);
  const colors: Record<string, string> = {};
  for (const [token, original] of Object.entries(originals)) {
    if (BACKGROUND_TOKENS.has(token)) {
      const ratio = token === "selectedBg" || token === "searchMatchBg" ? 1.3
        : token === "userMessageBg" ? 1.2 : 1.15;
      colors[token] = surface(original, background, ratio, dark);
    }
  }
  const surfaces = [background, ...Object.values(colors)];
  const cache = new Map<string, string>();
  for (const [token, original] of Object.entries(originals)) {
    if (BACKGROUND_TOKENS.has(token)) continue;
    const border = token.startsWith("border") || ["mdHr", "thinkingOff", "thinkingMinimal", "scrollbarTrack"].includes(token);
    const primary = ["text", "toolOutput", "userMessageText", "customMessageText", "mdCodeBlock", "syntaxVariable"].includes(token);
    const ratio = border ? 3.1 : primary ? 7 : token === "dim" || token === "syntaxComment" ? 4.65 : token === "muted" ? 5.3 : 4.85;
    const key = `${original}:${ratio}`;
    if (!cache.has(key)) cache.set(key, readable(original, surfaces, ratio, dark));
    colors[token] = cache.get(key)!;
  }
  return { name: source.name, appearance: dark ? "dark" : "light", background: background.toLowerCase(), colors };
}
