import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BACKGROUND_TOKENS, contrast, generateAurora, resolveSource, toOklch,
} from "../../extensions/aurora/palette.ts";

const source = JSON.parse(readFileSync(new URL("../../themes/midnight-aurora.json", import.meta.url), "utf8"));
const originals = resolveSource(source);
const borders = new Set(["mdHr", "thinkingOff", "thinkingMinimal", "scrollbarTrack"]);

function audit(background) {
  const result = generateAurora(source, background);
  assert.equal(result.name, "midnight-aurora");
  assert.equal(result.background, background.toLowerCase());
  assert.deepEqual(Object.keys(result.colors).sort(), Object.keys(originals).sort());
  const surfaces = [background, ...Object.entries(result.colors)
    .filter(([token]) => BACKGROUND_TOKENS.has(token)).map(([, color]) => color)];
  for (const [token, color] of Object.entries(result.colors)) {
    assert.match(color, /^#[0-9a-f]{6}$/);
    const input = toOklch(originals[token]), output = toOklch(color);
    // Quantizing to eight-bit sRGB can add a tiny amount of chroma.
    assert.ok(output.c <= input.c + 0.004, `${token}: increased chroma on ${background}`);
    // At near-black/white endpoints, eight-bit rounding makes hue unstable.
    // Only compare hue where enough lightness/chroma survives to perceive it.
    if (input.c > 0.03 && output.c > 0.03 && output.l > 0.18 && output.l < 0.92) {
      const delta = Math.abs(input.h - output.h);
      assert.ok(Math.min(delta, 360 - delta) < 4, `${token}: changed hue on ${background}`);
    }
    if (BACKGROUND_TOKENS.has(token) || token.startsWith("border") || borders.has(token)) continue;
    for (const bg of surfaces) {
      assert.ok(contrast(color, bg) >= 4.5, `${token}: ${color} on ${bg} < 4.5:1 (terminal ${background})`);
    }
  }
  return result;
}

test("Aurora preserves its palette and readable text on dark, light and tinted terminals", () => {
  for (const background of [
    "#000000", "#0b1020", "#282828", "#303446", "#2e3440",
    "#ffffff", "#faf4ed", "#eff1f5", "#fdf6e3",
    "#183525", "#3c174f", "#16294f", "#fcdee9", "#eeffdd",
    "#757575", "#777777", "#797979", "#808080",
  ]) audit(background);
});

test("grayscale sweep covers contrast polarity changes and near-mid-gray surfaces", () => {
  for (let value = 0; value <= 255; value += 5) {
    audit("#" + value.toString(16).padStart(2, "0").repeat(3));
  }
});

test("light and dark outputs differ while the source document remains unchanged", () => {
  const before = JSON.stringify(source);
  const dark = generateAurora(source, "#0b1020");
  const light = generateAurora(source, "#ffffff");
  assert.equal(dark.appearance, "dark");
  assert.equal(light.appearance, "light");
  assert.notEqual(dark.colors.accent, light.colors.accent);
  assert.notEqual(dark.colors.toolErrorBg, light.colors.toolErrorBg);
  assert.notEqual(dark.colors.syntaxComment, light.colors.syntaxComment);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(generateAurora(source, "#ffffff"), light);
});

test("secondary text hierarchy is retained on ordinary dark/light backgrounds", () => {
  for (const background of ["#0b1020", "#ffffff"]) {
    const colors = generateAurora(source, background).colors;
    assert.ok(contrast(colors.dim, background) < contrast(colors.muted, background));
    assert.ok(contrast(colors.muted, background) < contrast(colors.text, background));
  }
});

test("bad background and circular or missing palette variables fail explicitly", () => {
  assert.throws(() => generateAurora(source, "transparent"), /sRGB hex/);
  assert.throws(() => resolveSource({ ...source, vars: { loop: "loop" }, colors: { text: "loop" } }), /Circular/);
  assert.throws(() => resolveSource({ ...source, colors: { text: "missing" } }), /sRGB hex/);
});
