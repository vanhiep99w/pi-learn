import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Run the extension without installing Pi peers or accessing user settings.
// These small host doubles do not replace manual checks against Pi's real TUI.
const host = `
export class CustomEditor {
  constructor(tui) { this.tui = tui; }
  render() { return ["────", "input", "────"]; }
}
`;
const tui = `
const strip = (s) => s.replace(/\\x1b\\[[0-9;]*m/g, "");
const columns = (c) => /[\\u3400-\\u9fff]|\\p{Extended_Pictographic}/u.test(c) ? 2 : 1;
export const visibleWidth = (s) => [...strip(s)].reduce((n, c) => n + columns(c), 0);
export function truncateToWidth(s, width) {
  if (visibleWidth(s) <= width) return s;
  if (width <= 0) return "";
  let result = "", used = 0;
  for (const c of s) {
    if (used + columns(c) > width - 1) break;
    result += c; used += columns(c);
  }
  return result + "…";
}
`;
const modules = new Map([
  ["@earendil-works/pi-coding-agent", host],
  ["@earendil-works/pi-tui", tui],
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (modules.has(specifier)) {
      return { url: "data:text/javascript," + encodeURIComponent(modules.get(specifier)), shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { default: aurora } = await import("../../extensions/aurora-ui.ts");
const { visibleWidth } = await import("@earendil-works/pi-tui");
hooks.deregister();

function makeTheme(name, color = 36) {
  return {
    name,
    fg: (_token, text) => `\x1b[${color}m${text}\x1b[0m`,
    bold: (text) => text,
  };
}

function fixture(t, initialTheme = makeTheme("system")) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const events = new Map(), commands = new Map(), shortcuts = new Map();
  const widgets = new Map(), themeChanges = [], notifications = [];
  const ui = {
    theme: initialTheme,
    setWidget: (key, value) => widgets.set(key, value),
    setEditorComponent: (factory) => { ui.editor = factory; },
    setFooter: (factory) => { ui.footer = factory; },
    getAllThemes: () => ["system", "midnight-aurora", "light"].map((name) => ({ name })),
    select: async () => undefined,
    setTheme: (name) => {
      themeChanges.push(name);
      ui.theme = makeTheme(name);
      return { success: true };
    },
    notify: (...args) => notifications.push(args),
  };
  const ctx = { hasUI: true, ui, cwd: "/fixture/project", getContextUsage: () => null };
  const pi = {
    on: (name, handler) => events.set(name, handler),
    registerCommand: (name, options) => commands.set(name, options.handler),
    registerShortcut: (name, options) => shortcuts.set(name, options.handler),
    exec: async () => ({ code: 1, stdout: "" }),
    getThinkingLevel: () => "off",
  };
  aurora(pi);
  t.after(async () => { await events.get("session_shutdown")({}, ctx); });
  return { ctx, ui, events, commands, shortcuts, widgets, themeChanges, notifications };
}

test("startup preserves the selected theme and banner follows live theme changes", async (t) => {
  const f = fixture(t);
  await f.events.get("session_start")({}, f.ctx);
  const banner = f.widgets.get("aurora-banner")();
  const first = banner.render(80).join("\n");
  assert.match(first, /Theme: system/);
  assert.doesNotMatch(first, /midnight-aurora/);
  f.ui.theme = makeTheme("light", 33);
  banner.invalidate();
  const second = banner.render(80).join("\n");
  assert.match(second, /Theme: light/);
  assert.ok(second.includes("\x1b[33m"));
  assert.ok(!second.includes("\x1b[36m"));
  assert.deepEqual(f.themeChanges, []);
});

test("banner clips long Unicode theme names and fits narrow widths", async (t) => {
  const f = fixture(t, makeTheme("主题🌙".repeat(20)));
  await f.events.get("session_start")({}, f.ctx);
  const banner = f.widgets.get("aurora-banner")();
  for (const width of [0, 1, 2, 3, 10, 20, 46, 80]) {
    for (const line of banner.render(width)) {
      assert.ok(visibleWidth(line) <= width, `Banner overflow at width ${width}`);
    }
  }
  f.ui.theme = undefined;
  assert.match(banner.render(80).join("\n"), /Theme: unknown/);
});

test("banner expires after five seconds and is cleared on shutdown", async (t) => {
  const f = fixture(t);
  await f.events.get("session_start")({}, f.ctx);
  t.mock.timers.tick(4999);
  assert.equal(typeof f.widgets.get("aurora-banner"), "function");
  t.mock.timers.tick(1);
  assert.equal(f.widgets.get("aurora-banner"), undefined);
  await f.events.get("session_start")({}, f.ctx);
  await f.events.get("session_shutdown")({}, f.ctx);
  assert.equal(f.widgets.get("aurora-banner"), undefined);
  t.mock.timers.tick(10000);
});

test("headless session and theme picker do not access UI", async (t) => {
  const f = fixture(t);
  const ctx = { hasUI: false, get ui() { throw new Error("UI must not be read"); } };
  const output = t.mock.method(console, "log", () => {});
  await f.events.get("session_start")({}, ctx);
  await f.commands.get("aurora-themes")("", ctx);
  await f.shortcuts.get("ctrl+shift+t")("", ctx);
  assert.equal(output.mock.callCount(), 1);
  assert.match(output.mock.calls[0].arguments[0], /system/);
  assert.deepEqual(f.themeChanges, []);
});

for (const shortcut of [false, true]) {
  test(`${shortcut ? "shortcut" : "command"}: system selection is explicit and cancel preserves theme`, async (t) => {
    const f = fixture(t, makeTheme("midnight-aurora"));
    const handler = shortcut ? f.shortcuts.get("ctrl+shift+t") : f.commands.get("aurora-themes");
    await handler("", f.ctx);
    assert.deepEqual(f.themeChanges, []);
    f.ui.select = async (_title, names) => {
      assert.ok(names.includes("system"));
      return "system";
    };
    await handler("", f.ctx);
    assert.deepEqual(f.themeChanges, ["system"]);
    assert.match(f.notifications[0][0], /system/);
  });
}

test("editor borders use live theme tokens without replacing input", async (t) => {
  const f = fixture(t);
  await f.events.get("session_start")({}, f.ctx);
  const editor = f.ui.editor({ mode: "regular" }, f.ui.theme, {});
  assert.ok(editor.render(80).includes("input"));
  f.ui.theme = makeTheme("light", 33);
  const lines = editor.render(80);
  assert.ok(lines[0].includes("\x1b[33m"));
  assert.ok(!lines[0].includes("\x1b[36m"));
  assert.ok(lines.includes("input"));
});
