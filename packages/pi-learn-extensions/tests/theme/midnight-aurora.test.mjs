import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const theme = JSON.parse(readFileSync(new URL("../../themes/midnight-aurora.json", import.meta.url), "utf8"));

// Static sRGB audit, not a guarantee for arbitrary terminal backgrounds or
// 256-color approximations. vars.bg is the intended dark terminal background.
function resolve(value) {
  const seen = new Set();
  while (Object.hasOwn(theme.vars, value)) {
    assert.ok(!seen.has(value), `Circular color variable: ${value}`);
    seen.add(value);
    value = theme.vars[value];
  }
  assert.match(value, /^#[0-9a-f]{6}$/i, `Unresolved color: ${value}`);
  return value;
}

function luminance(value) {
  const hex = resolve(value);
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const [dark, light] = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}

function readable(tokens, surfaces) {
  for (const token of tokens) {
    assert.ok(Object.hasOwn(theme.colors, token), `Missing token: ${token}`);
    for (const [surface, background] of surfaces) {
      const ratio = contrast(theme.colors[token], background);
      assert.ok(ratio >= 4.5, `${token} on ${surface}: ${ratio.toFixed(2)}:1 < 4.5:1`);
    }
  }
}

const terminal = [["intended terminal background", theme.vars.bg]];
const panels = ["userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"]
  .map((token) => [token, theme.colors[token]]);
const selection = [["selectedBg", theme.colors.selectedBg]];

test("theme declares dark appearance and all colors/variables resolve", () => {
  assert.equal(theme.name, "midnight-aurora");
  assert.equal(theme.appearance, "dark");
  for (const value of [...Object.values(theme.vars), ...Object.values(theme.colors), ...Object.values(theme.export)]) {
    resolve(value);
  }
});

test("interface text and status colors remain readable across panels and selection", () => {
  readable(["text", "accent", "success", "error", "warning", "muted", "dim"],
    [...terminal, ...panels, ...selection]);
});

test("message and tool text remain readable on their own panels", () => {
  readable(["userMessageText"], [panels[0]]);
  readable(["customMessageText", "customMessageLabel"], [panels[1]]);
  readable(["toolTitle", "toolOutput", "toolDiffAdded", "toolDiffRemoved", "toolDiffContext"],
    panels.slice(2));
  readable(["thinkingText"], terminal);
});

test("Markdown and syntax text remain readable on terminal, message and tool backgrounds", () => {
  const tokens = [
    "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdQuote", "mdListBullet",
    ...Object.keys(theme.colors).filter((token) => token.startsWith("syntax")),
  ];
  readable(tokens, [...terminal, ...panels]);
});

test("HTML export text remains readable on exported surfaces", () => {
  readable(["text", "accent", "success", "error", "warning", "muted", "dim"],
    Object.entries(theme.export));
});

test("secondary text hierarchy is retained on the intended terminal background", () => {
  assert.ok(luminance(theme.colors.dim) < luminance(theme.colors.muted));
  assert.ok(luminance(theme.colors.muted) < luminance(theme.colors.text));
});
