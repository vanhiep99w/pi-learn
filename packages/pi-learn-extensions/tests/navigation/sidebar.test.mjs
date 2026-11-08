// Real installed pi-tui + synthetic transcript. No user settings/auth/session logs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

const piBin = process.env.PI_TEST_BIN ?? execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const require = createRequire(realpathSync(piBin));
const tuiUrl = pathToFileURL(require.resolve("@earendil-works/pi-tui")).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@earendil-works/pi-tui") return { url: tuiUrl, shortCircuit: true };
    return next(specifier, context);
  },
});
const { default: sidebarDemo } = await import("../../extensions/aurora/sidebar.ts");
const { indexPrompts } = await import("../../extensions/aurora/navigation.ts");
const { paintSidebarBackground } = await import("../../extensions/aurora/surface.ts");
const { createVteOutputPadder, installVteWidthGuard } = await import("../../extensions/aurora/terminal-width.ts");
const { Container, CURSOR_MARKER, Input, ScrollView, Text, TuiAltScreen, TuiMainScreen, VStack, sliceByColumn, stripTerminalSequences, visibleWidth } = await import(tuiUrl);
hooks.deregister();
const plain = stripTerminalSequences;
const START = "\x1b]133;A\x07", END = "\x1b]133;B\x07\x1b]133;C\x07";

function fixture(t, mode = "fullscreen", count = 8) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const terminal = {
    columns: 110, rows: 24, kittyProtocolActive: false, output: "",
    start(onInput) { this.input = onInput; }, stop() { this.input = undefined; },
    write(s) { this.output += s; }, moveBy() {}, hideCursor() {}, showCursor() {},
    clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  const document = new Container();
  document.addChild(new Text("Fixture header", 0, 0));
  let toolHeight = 2;
  const tool = { invalidate() {}, render: () => Array(toolHeight).fill("tool output") };
  document.addChild(tool);
  const userNodes = new WeakSet();
  const add = (label) => {
    const text = new Text(label, 0, 0);
    const user = {
      text: label, messageId: undefined, rebuild() {}, setOutputPad() {},
      invalidate() { text.invalidate(); },
      render(width) { return [START, ...text.render(width), END]; },
    };
    userNodes.add(user);
    document.addChild(user);
    // Assistant replies also carry OSC133 markers in real Pi; never list them.
    const answer = new Text("Answer 漢字 🌙 ".repeat(150), 0, 0);
    document.addChild({
      invalidate() { answer.invalidate(); },
      render(width) { return [START, ...answer.render(width), END]; },
    });
  };
  for (let i = 1; i <= count; i++) add(`Prompt ${i}: hãy kiểm tra Unicode 漢字 🌙 và layout`);
  const editor = new Input();
  editor.setValue("hello 🌙");
  const dock = new Container();
  const widgetContainer = new Container();
  dock.addChild(widgetContainer);
  dock.addChild(editor);
  dock.addChild(new Text("existing footer", 0, 0));
  const originals = [document, dock];
  const transcript = new ScrollView(document, { primary: true, follow: "end", scrollbar: "always" });
  const originalLayout = new VStack([
    { component: transcript, basis: 0, grow: 1, minSize: 1 },
    { component: dock, basis: "auto", shrink: 0 },
  ]);
  let renderer;
  const copied = [];
  const started = new WeakSet();
  function makeRenderer(nextMode) {
    const next = nextMode === "fullscreen" ? new TuiAltScreen(terminal, undefined, undefined, {
      copySelection(text) { copied.push(text); return true; },
    }) : new TuiMainScreen(terminal);
    for (const child of renderer?.children ?? originals) next.addChild(child);
    if (nextMode === "fullscreen") next.setLayoutRoot(originalLayout);
    next.setFocus(editor);
    return next;
  }
  renderer = makeRenderer(mode);
  const tui = new Proxy({}, {
    get(_target, property) {
      const value = Reflect.get(renderer, property, renderer);
      return typeof value === "function" ? value.bind(renderer) : value;
    },
    set(_target, property, value) { return Reflect.set(renderer, property, value, renderer); },
    has(_target, property) { return property in renderer; },
    getPrototypeOf() { return Object.getPrototypeOf(renderer); },
  });
  const events = new Map(), commands = new Map(), widgets = new Map(), notifications = [];
  const ctx = {
    hasUI: true, mode: "tui",
    get sessionManager() { throw new Error("Navigator must not read sessions"); },
    ui: {
      theme: {
        fg: (token, value) => `\x1b[${token === "accent" ? 36 : 37}m${value}\x1b[0m`, bold: (value) => `\x1b[1m${value}\x1b[22m`,
        appearance: "dark", getBgAnsi: () => "\x1b[48;2;24;30;42m", getColorMode: () => "truecolor",
      },
      notify: (...args) => notifications.push(args),
      setWidget(key, factory) {
        if (factory) widgets.set(key, factory(tui, ctx.ui.theme));
        else widgets.delete(key);
        widgetContainer.clear();
        for (const widget of widgets.values()) widgetContainer.addChild(widget);
      },
    },
  };
  sidebarDemo({ on: (name, fn) => events.set(name, fn), registerCommand: (name, command) => commands.set(name, command) });
  events.get("session_start")({}, ctx);
  t.after(() => { events.get("session_shutdown")(); renderer.stop({ preserveScreen: true }); });
  return {
    ctx, tui, terminal, originals, originalLayout, transcript, editor, dock, events, widgets, notifications, document, add, copied,
    expandTool: (height) => { toolHeight = height; },
    command: (args = "") => commands.get("sidebar").handler(args, ctx),
    tick: () => t.mock.timers.tick(250),
    switchMode(next) { renderer.stop({ preserveScreen: true }); renderer = makeRenderer(next); },
    mouse(x, y, button = 0, release = false) { terminal.input(`\x1b[<${button};${x + 1};${y + 1}${release ? "m" : "M"}`); },
    frame() {
      terminal.output = "";
      if (!started.has(renderer)) { renderer.start(); started.add(renderer); }
      // Complete the frame, let the navigator inspect it, then paint its update.
      for (let i = 0; i < 3; i++) { renderer.renderNow(true); t.mock.timers.tick(250); }
      return renderer.mode === "fullscreen" ? renderer.getScreenLines() : renderer.render(terminal.columns).slice(-terminal.rows);
    },
    rows() {
      const width = transcript.getContentWidth(terminal.columns - (terminal.columns >= 84 ? 33 : 0));
      let row = 0;
      return document.children.flatMap((node) => {
        const result = userNodes.has(node) ? [row] : [];
        row += node.render(width).length;
        return result;
      });
    },
  };
}

function boxes(f) {
  const collect = (box) => [box, ...box.children.flatMap(collect)];
  return f.tui.currentLayout ? collect(f.tui.currentLayout.root) : [];
}
function sidebarBox(f) { return boxes(f).find((box) => box.scrollView && box.scrollView !== f.transcript); }
function assertClosed(f) {
  assert.equal(f.tui.layoutRoot === f.originalLayout, true, "closed layout is the untouched native root");
}

function point(lines, label, side = "right") {
  const width = Math.max(...lines.map(visibleWidth));
  const start = side === "right" ? width - 33 : 0;
  const y = lines.findIndex((line) => plain(sliceByColumn(line, start, 33)).includes(label));
  assert.notEqual(y, -1, `sidebar item visible: ${label}`);
  const text = plain(sliceByColumn(lines[y], start, 33));
  return { x: start + visibleWidth(text.slice(0, text.indexOf(label))), y };
}
function backgroundColumns(line) {
  const cells = [];
  let background = false, cursor = 0, start = 0;
  const paint = (chunk) => {
    const end = cursor + visibleWidth(chunk);
    for (; cursor < end; cursor++) cells[cursor] = background;
  };
  for (const match of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
    paint(plain(line.slice(start, match.index)));
    const codes = match[1] ? match[1].split(";").map(Number) : [0];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0 || code === 49) background = false;
      else if (code === 48 || code === 38) {
        if (code === 48) background = true;
        i += codes[i + 1] === 2 ? 4 : 2;
      }
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) background = true;
    }
    start = match.index + match[0].length;
  }
  paint(plain(line.slice(start)));
  return cells;
}

function click(f, p) { f.mouse(p.x, p.y); f.mouse(p.x, p.y, 0, true); }

function shown(f) {
  return (sidebarBox(f)?.scrollContentLines ?? []).map(plain).map((line) => line.trim()).filter((line) => /^(?:›\s*)?\d+\./.test(line));
}
function togglePoint(lines) {
  const y = lines.findIndex((line) => plain(line).includes("≡"));
  assert.notEqual(y, -1, "toggle visible");
  const line = plain(lines[y]);
  return { x: visibleWidth(line.slice(0, line.indexOf("≡"))), y };
}
function assertToggleAboveEditor(f, lines) {
  const p = togglePoint(lines);
  const dock = boxes(f).find((box) => box.component === f.dock).rect;
  assert.equal(p.x, dock.x + dock.width - 2, "button aligns to main input, not sidebar");
  const editorRow = lines.findIndex((line) => plain(sliceByColumn(line, dock.x, dock.width)).includes(f.editor.getValue()));
  assert.ok(p.y < editorRow, "button is above input");
  if (f.widgets.size === 1) assert.equal(p.y + 1, editorRow, "directly above input when no other widgets");
  return p;
}
function dragSelect(f, start, end) {
  f.mouse(start.x, start.y); f.mouse(end.x, end.y, 32); f.mouse(end.x, end.y, 0, true);
  return f.frame();
}

test("zone parser handles ANSI, BEL/ST, multiline, repeated and empty zones", () => {
  assert.deepEqual(indexPrompts(["header", START, "\x1b[31mhello\x1b[0m", "world", END, "answer", "\x1b]133;A\x1b\\same", "\x1b]133;B\x1b\\", START + "same", END, START, END]), [
    { row: 1, label: "hello world" }, { row: 6, label: "same" }, { row: 8, label: "same" }, { row: 10, label: "(Tin nhắn trống)" },
  ]);
});

for (const mode of ["regular", "fullscreen"]) {
  test(`${mode}: native layout, Unicode, cursor/editor/footer, resize and cleanup`, async (t) => {
    const f = fixture(t, mode); await f.command("on");
    let lines = f.frame();
    assert.deepEqual([...f.widgets.keys()], ["aurora-sidebar-toggle"]);
    assert.ok(lines.every((line) => visibleWidth(line) <= 110));
    assert.ok(lines.some((line) => plain(line).includes("existing footer")));
    assert.ok(f.tui.render(110).some((line) => line.includes(CURSOR_MARKER)));
    assert.ok(!f.terminal.output.includes(CURSOR_MARKER));
    if (mode === "fullscreen") {
      assert.equal(shown(f).length, 8);
      assert.equal(f.tui.currentLayout.primaryScrollView, f.transcript);
      assert.equal(boxes(f).find((box) => box.component === f.dock).rect.width, 77);
    } else assert.ok(lines.some((line) => plain(line).includes("Cần fullscreen")));
    f.terminal.columns = 60; lines = f.frame();
    assert.ok(lines.every((line) => visibleWidth(line) <= 60));
    assert.equal(shown(f).length, 0);
    f.terminal.columns = 110; f.frame();
    if (mode === "fullscreen") assert.equal(shown(f).length, 8);
    await f.command("off"); assert.deepEqual(f.tui.children, f.originals);
    if (mode === "fullscreen") assertClosed(f);
  });
}

for (const side of ["left", "right"]) {
  test(`${side}: single click jumps; press/drag/right click do not; editor keeps focus`, async (t) => {
    const f = fixture(t); await f.command(side);
    let lines = f.frame(); const p = point(lines, "2. Prompt 2", side), top = f.transcript.scrollTop;
    f.mouse(p.x, p.y); f.frame(); assert.equal(f.transcript.scrollTop, top);
    f.mouse(p.x, p.y, 0, true); lines = f.frame();
    assert.equal(f.transcript.scrollTop, f.rows()[1]);
    assert.equal(f.transcript.isFollowingEnd, false);
    const activeLine = sliceByColumn(lines[p.y], side === "right" ? 77 : 0, 33);
    assert.ok(plain(activeLine).trim().startsWith("2."));
    assert.ok(activeLine.includes("\x1b[36m"), "active row uses accent foreground");
    assert.ok(!activeLine.includes("\x1b[1m"), "active row is not bold");
    assert.doesNotMatch(plain(activeLine), /›/);
    const other = point(lines, "3. Prompt 3", side);
    assert.ok(sliceByColumn(lines[other.y], side === "right" ? 77 : 0, 33).includes("\x1b[37m"));
    assert.equal(f.tui.getFocusedComponent(), f.editor);
    f.terminal.input("x"); assert.equal(f.editor.getValue(), "xhello 🌙");
    const third = point(lines, "3. Prompt 3", side);
    dragSelect(f, third, { x: third.x + 1, y: third.y });
    assert.equal(f.transcript.scrollTop, f.rows()[1]);
    f.mouse(third.x, third.y, 2); f.mouse(third.x, third.y, 2, true);
    assert.equal(f.transcript.scrollTop, f.rows()[1]);
    await f.command("bottom"); f.frame(); assert.equal(f.transcript.isFollowingEnd, true);
  });
}

test("goto resolves current rows after wrap, resize, tool expansion and changing side", async (t) => {
  const f = fixture(t); await f.command("on"); f.frame();
  await f.command("goto 4"); f.frame(); const before = f.transcript.scrollTop;
  assert.equal(before, f.rows()[3]);
  f.terminal.columns = 90; f.frame(); await f.command("goto 4"); f.frame();
  assert.equal(f.transcript.scrollTop, f.rows()[3]); assert.notEqual(f.transcript.scrollTop, before);
  f.expandTool(40); f.frame(); await f.command("left"); f.frame();
  await f.command("goto 4"); f.frame(); assert.equal(f.transcript.scrollTop, f.rows()[3]);
});

test("duplicate inputs and new messages update without pulling a historical viewport to end", async (t) => {
  const f = fixture(t, "fullscreen", 0); f.add("repeat input"); f.add("repeat input");
  await f.command("on"); f.frame(); await f.command("goto 2"); f.frame();
  assert.equal(f.transcript.scrollTop, f.rows()[1]); const top = f.transcript.scrollTop;
  f.add("New input arrives"); f.events.get("message_start")({}, f.ctx); f.frame();
  assert.equal(shown(f).length, 3); assert.equal(f.transcript.scrollTop, top);
  await f.command("bottom"); f.frame(); f.add("More streaming text"); f.frame();
  assert.equal(shown(f).length, 4); assert.equal(f.transcript.isFollowingEnd, true);
});

test("wheel scrolls only the list; prev/next and goto remain keyboard-only alternatives", async (t) => {
  const f = fixture(t, "fullscreen", 60); await f.command("on");
  let lines = f.frame(); assert.ok(point(lines, "60. Prompt 60"));
  const top = f.transcript.scrollTop, p = point(lines, "60. Prompt 60");
  f.mouse(p.x, p.y, 64); f.frame();
  assert.equal(f.transcript.scrollTop, top); assert.ok(!shown(f).some((line) => line.includes("60. Prompt 60")));
  await f.command("prev"); f.frame(); await f.command("prev"); lines = f.frame();
  assert.ok(point(lines, "1. Prompt 1:"));
  await f.command("next"); lines = f.frame();
  const n = sidebarBox(f).rect.height + 1; assert.ok(point(lines, `${n}. Prompt ${n}:`));
  await f.command("goto 1"); lines = f.frame();
  assert.equal(f.transcript.scrollTop, f.rows()[0]); assert.ok(point(lines, "1. Prompt 1:"));
});

test("branch replacement removes old rows and rejects stale clicks", async (t) => {
  const f = fixture(t); await f.command("on"); const p = point(f.frame(), "2. Prompt 2");
  f.mouse(p.x, p.y); f.document.clear(); f.add("A different branch"); f.events.get("session_tree")({}, f.ctx);
  f.frame(); f.mouse(p.x, p.y, 0, true); f.frame();
  assert.equal(shown(f).length, 1); assert.ok(shown(f)[0].includes("A different branch"));
  await f.command("goto 2"); assert.match(f.notifications.at(-1)[0], /Không tìm thấy/);
  await f.command("goto 1"); f.frame(); assert.equal(f.transcript.scrollTop, f.rows()[0]);
});

test("empty, narrow and small viewports plus invalid keyboard input fail safely", async (t) => {
  const f = fixture(t, "fullscreen", 0); await f.command("goto 1"); assert.match(f.notifications.at(-1)[0], /Bật \/sidebar/);
  await f.command("on"); assert.ok(f.frame().some((line) => plain(line).includes("Chưa có prompt")));
  for (const arg of ["goto 0", "goto -1", "goto nope"]) await f.command(arg);
  assert.match(f.notifications.at(-1)[0], /Dùng \/sidebar/);
  f.add("First prompt"); let lines = f.frame(); const p = point(lines, "1. First prompt");
  f.terminal.columns = 60; f.frame(); f.mouse(p.x, p.y); f.mouse(p.x, p.y, 0, true);
  assert.equal(f.transcript.isFollowingEnd, true);
  f.terminal.columns = 110; f.terminal.rows = 8; lines = f.frame();
  assert.ok(lines.every((line) => visibleWidth(line) <= 110));
  assert.equal(shown(f).length, 1, "without chrome, short lists also fit small viewports");
});

test("active renderer replacements reattach without nested wrappers; regular cannot jump", async (t) => {
  const f = fixture(t, "regular"); await f.command("on"); f.frame();
  await f.command("goto 1"); assert.match(f.notifications.at(-1)[0], /fullscreen/);
  for (const mode of ["fullscreen", "regular", "fullscreen"]) {
    f.switchMode(mode); f.tick(); f.frame();
    if (mode === "fullscreen") assert.equal(shown(f).length, 8);
  }
  await f.command("goto 3"); f.frame(); assert.equal(f.transcript.scrollTop, f.rows()[2]);
  await f.command("off"); assertClosed(f);
});

test("non-TUI and unsupported layout guards preserve roots", async (t) => {
  const f = fixture(t); f.ctx.mode = "rpc"; await f.command("on"); assert.deepEqual(f.tui.children, f.originals);
  f.ctx.mode = "tui"; f.tui.setLayoutRoot(undefined); await f.command("on");
  assert.match(f.notifications.at(-1)[0], /không tương thích/);
  assert.deepEqual([...f.widgets.keys()], ["aurora-sidebar-toggle"]); assert.equal(f.tui.layoutRoot, undefined);
});

test("press survives reflow but does not jump to a replaced component with identical text", async (t) => {
  const f = fixture(t); await f.command("on"); let p = point(f.frame(), "2. Prompt 2");
  f.mouse(p.x, p.y); f.expandTool(50); f.frame(); f.mouse(p.x, p.y, 0, true); f.frame();
  assert.equal(f.transcript.scrollTop, f.rows()[1]); f.tui.resetTextSelection();
  p = point(f.frame(), "2. Prompt 2"); f.mouse(p.x, p.y); f.document.clear();
  f.add("Prompt 1: hãy kiểm tra Unicode 漢字 🌙 và layout"); f.add("Prompt 2: hãy kiểm tra Unicode 漢字 🌙 và layout");
  f.frame(); const before = f.transcript.scrollTop; f.mouse(p.x, p.y, 0, true); f.frame();
  assert.equal(f.transcript.scrollTop, before);
  f.tui.resetTextSelection(); click(f, point(f.frame(), "2. Prompt 2")); f.frame();
  assert.equal(f.transcript.scrollTop, f.rows()[1]);
});

test("jump at document end suppresses follow until bottom is requested", async (t) => {
  const f = fixture(t, "fullscreen", 0); f.add("Only prompt"); f.document.children.pop();
  await f.command("on"); f.frame(); await f.command("goto 1"); f.frame();
  assert.equal(f.transcript.isFollowingEnd, false);
  f.document.addChild(new Text("New streaming answer\n".repeat(100), 0, 0)); f.frame();
  assert.equal(f.transcript.scrollTop, 0); await f.command("bottom"); f.frame(); assert.equal(f.transcript.isFollowingEnd, true);
});

for (const side of ["left", "right"]) {
  test(`${side}: above-input toggle opens/closes/reopens and preserves editor focus`, async (t) => {
    const f = fixture(t); let lines = f.frame(); const open = assertToggleAboveEditor(f, lines);
    assert.equal(open.x, 108); assert.equal(plain(lines[open.y]).trim(), "≡");
    f.mouse(open.x, open.y); f.frame(); assertClosed(f);
    f.mouse(open.x, open.y, 0, true); lines = f.frame(); assert.equal(shown(f).length, 8);
    assertToggleAboveEditor(f, lines); await f.command(side); lines = f.frame();
    click(f, assertToggleAboveEditor(f, lines)); lines = f.frame(); assertClosed(f); assert.equal(shown(f).length, 0);
    click(f, assertToggleAboveEditor(f, lines)); lines = f.frame(); assert.ok(point(lines, "2. Prompt 2", side));
    assertToggleAboveEditor(f, lines); assert.equal(f.tui.getFocusedComponent(), f.editor);
    f.terminal.input("x"); assert.equal(f.editor.getValue(), "xhello 🌙"); await f.command("off"); assertClosed(f);
  });
}

test("toggle ignores drag/right click, warns on narrow open and can close a hidden panel", async (t) => {
  const f = fixture(t); const p = togglePoint(f.frame());
  f.mouse(p.x, p.y, 2); f.mouse(p.x, p.y, 2, true); f.frame(); assertClosed(f);
  dragSelect(f, p, { x: p.x + 1, y: p.y }); assertClosed(f);
  f.terminal.columns = 60; click(f, togglePoint(f.frame())); f.frame(); assert.match(f.notifications.at(-1)[0], /84 cột/); assertClosed(f);
  f.terminal.columns = 110; click(f, togglePoint(f.frame())); f.frame();
  f.terminal.columns = 60; click(f, togglePoint(f.frame())); f.frame(); assertClosed(f);
});

test("shutdown removes only this widget and next session recreates one toggle", async (t) => {
  const f = fixture(t); f.ctx.ui.setWidget("other", () => new Text("other widget", 0, 0));
  for (let i = 0; i < 2; i++) {
    click(f, togglePoint(f.frame())); f.frame(); f.events.get("session_shutdown")(); f.tick();
    assert.ok(!f.frame().some((line) => plain(line).includes("≡")));
    assert.deepEqual([...f.widgets.keys()], ["other"]);
    f.events.get("session_start")({}, f.ctx); assert.equal(f.widgets.size, 2);
    assert.equal((f.frame().map(plain).join("\n").match(/≡/g) ?? []).length, 1);
  }
});

for (const side of ["left", "right"]) {
  test(`${side}: copy stays in originating pane and selectable input rows still click normally`, async (t) => {
    const f = fixture(t); await f.command(side); let lines = f.frame();
    const first = point(lines, "1. Prompt 1", side), second = point(lines, "2. Prompt 2", side), top = f.transcript.scrollTop;
    dragSelect(f, first, { x: second.x + 12, y: second.y });
    const owner = f.tui.selectionAnchor.scrollView; assert.ok(owner); assert.notEqual(owner, f.transcript);
    assert.match(f.copied.at(-1), /Prompt 1/); assert.match(f.copied.at(-1), /Prompt 2/);
    assert.doesNotMatch(f.copied.at(-1), /Answer|│/); assert.equal(f.transcript.scrollTop, top);
    f.tui.resetTextSelection(); lines = f.frame();
    dragSelect(f, point(lines, "1. Prompt 1", side), { x: side === "right" ? 2 : 108, y: 4 });
    assert.equal(f.tui.selectionAnchor.scrollView, owner); assert.doesNotMatch(f.copied.at(-1), /Answer|│/);
    f.tui.resetTextSelection(); f.frame();
    dragSelect(f, { x: side === "right" ? 2 : 35, y: 1 }, { x: first.x + 4, y: 4 });
    assert.equal(f.tui.selectionAnchor.scrollView, f.transcript); assert.match(f.copied.at(-1), /Answer/);
    assert.doesNotMatch(f.copied.at(-1), /Prompt 1|Prompt 2/);
    f.tui.resetTextSelection(); lines = f.frame(); click(f, point(lines, "2. Prompt 2", side)); f.frame();
    assert.equal(f.transcript.scrollTop, f.rows()[1]); assert.equal(f.tui.getFocusedComponent(), f.editor);
  });
}

test("closing clears the selected viewport anchor", async (t) => {
  const f = fixture(t); await f.command("on"); const lines = f.frame();
  dragSelect(f, point(lines, "1. Prompt 1"), point(lines, "2. Prompt 2")); assert.ok(f.tui.hasActiveSelection());
  await f.command("off"); f.frame(); assert.equal(f.tui.hasActiveSelection(), false);
  assert.equal(f.tui.selectionAnchor, undefined); assert.equal(f.tui.currentLayout.primaryScrollView, f.transcript);
});

test("full-height list remains independent of a growing main input dock", async (t) => {
  const f = fixture(t, "fullscreen", 60); await f.command("on");
  let lines = f.frame(); const original = assertToggleAboveEditor(f, lines);
  f.ctx.ui.setWidget("extra", () => new Text("one\ntwo\nthree\nfour", 0, 0)); lines = f.frame();
  assert.ok(assertToggleAboveEditor(f, lines).y < original.y, "button follows a taller dock");
  assert.equal(sidebarBox(f).rect.height, 24); assert.equal(sidebarBox(f).rect.y, 0); assert.equal(shown(f).length, 24);
  assert.equal(boxes(f).find((box) => box.component === f.dock).rect.width, 77);
  assert.ok(shown(f).at(-1).includes("60. Prompt 60"));
  await f.command("off"); lines = f.frame(); assertToggleAboveEditor(f, lines);
  f.ctx.ui.setWidget("extra", undefined); await f.command("left"); lines = f.frame(); assertToggleAboveEditor(f, lines);
});

test("theme panel background covers the whole sidebar, never the input toggle; native scrollbar restores", async (t) => {
  const f = fixture(t); f.transcript.setScrollbar("auto"); f.frame();
  for (const side of ["right", "left"]) {
    await f.command(side); const lines = f.frame(), start = side === "right" ? 77 : 0;
    assert.equal(f.transcript.scrollbar, "hidden"); assert.equal(f.transcript.isScrollbarVisible, false);
    for (const line of lines) {
      assert.doesNotMatch(plain(line), /│/);
      const cells = backgroundColumns(line).slice(start, start + 33);
      assert.equal(cells.length, 33); assert.ok(cells.every(Boolean));
    }
    const p = assertToggleAboveEditor(f, lines);
    assert.equal(backgroundColumns(lines[p.y])[p.x], false, "button uses terminal default background");
    await f.command("off"); f.frame(); assert.equal(f.transcript.scrollbar, "auto");
  }
  await f.command("on"); f.frame(); f.events.get("session_shutdown")();
  assert.equal(f.transcript.scrollbar, "auto"); assert.equal(f.tui.layoutRoot === f.originalLayout, true);
});

test("closed native widget survives renderer changes without opening a list", async (t) => {
  const f = fixture(t);
  for (const mode of ["regular", "fullscreen", "regular", "fullscreen"]) {
    f.switchMode(mode); f.tick(); const lines = f.frame(); assert.equal(shown(f).length, 0);
    assert.equal((lines.map(plain).join("\n").match(/≡/g) ?? []).length, 1);
    if (mode === "fullscreen") assertToggleAboveEditor(f, lines);
  }
  click(f, togglePoint(f.frame())); f.frame(); assert.equal(shown(f).length, 8);
});

test("theme surface preserves foreground, restores inline resets and respects indexed/default backgrounds", () => {
  const samples = ["\x1b[48;2;2;3;4mA\x1b[0m B\x1b[49m C", "\x1b[1;48;5;235;38;2;42;100;47mX\x1b[22m 漢字 🌙"];
  for (const bg of ["\x1b[48;2;12;24;36m", "\x1b[48;5;254m", "\x1b[49m"]) {
    const theme = { getBgAnsi(token) { assert.equal(token,"customMessageBg");return bg; } };
    for (const line of samples) {
      const painted = paintSidebarBackground(line,theme);
      assert.equal(plain(painted), plain(line)); assert.equal(visibleWidth(painted), visibleWidth(line));
      assert(painted.startsWith(bg));
      if(bg!=="\x1b[49m")assert.ok(backgroundColumns(painted).every(Boolean));
      else assert(!painted.includes("\x1b[48;"),"terminal default must not be replaced by a guessed RGB background");
    }
    assert.ok(paintSidebarBackground(samples[1],theme).includes("\x1b[1;38;2;42;100;47m"));
  }
  assert.equal(visibleWidth("≡"), 1);
});

test("list uses every row and draws no headings, buttons, counts or footer hints", async (t) => {
  const f = fixture(t, "fullscreen", 60); await f.command("on"); f.frame();
  const content = sidebarBox(f).scrollContentLines.map(plain);
  assert.equal(shown(f).length, sidebarBox(f).rect.height);
  assert.ok(content[0].includes("37. Prompt 37")); assert.ok(content.at(-1).includes("60. Prompt 60"));
  for (const line of content) assert.doesNotMatch(line, /YOUR MESSAGES|Về cuối chat|Trước|Sau|prompts ·|wheel|sidebar goto/);
});


test("toggle follows the input through resize on both sides, open and closed", async (t) => {
  const f = fixture(t);
  for (const side of ["right", "left"]) {
    await f.command(side);
    for (const [rows, columns] of [[30, 90], [18, 110], [24, 110]]) {
      Object.assign(f.terminal, { rows, columns });
      let lines = f.frame(); assertToggleAboveEditor(f, lines);
      assert.equal(sidebarBox(f).rect.y, 0); assert.equal(sidebarBox(f).rect.height, rows);
      click(f, togglePoint(lines)); lines = f.frame(); assertClosed(f); assertToggleAboveEditor(f, lines);
      click(f, togglePoint(lines)); f.frame(); assert.equal(shown(f).length, 8);
    }
  }
});

// VTE 0.84 counts U+2630 as one cell while installed Pi measures two.
const vteWidth = (line) => visibleWidth(line) - (plain(line).match(/☰/g)?.length ?? 0);

test("VTE padder prevents the chat glyph from shifting the adjacent sidebar row", () => {
  const main = "chat ☰" + " ".repeat(77 - visibleWidth("chat ☰"));
  const row = main + "   9. Prompt 9";
  assert.equal(vteWidth(main), 76, "unfixed sidebar starts one cell too early");
  const output = createVteOutputPadder()(row);
  assert.equal(vteWidth(output.slice(0, output.indexOf("9. Prompt"))), 80);
  assert.equal(output.replace("☰ ", "☰"), row, "only output padding changes");
});

test("VTE padder protects ANSI styles, OSC hyperlinks/title/clipboard, DCS and split controls", () => {
  const pad = createVteOutputPadder();
  assert.equal(pad("\x1b[31m☰\x1b[0m"), "\x1b[31m☰ \x1b[0m");
  const url = "\x1b]8;;https://example.test/☰\x1b\\";
  assert.equal(pad(url + "☰\x1b]8;;\x1b\\"), url + "☰ \x1b]8;;\x1b\\");
  for (const value of ["\x1b]0;☰\x07", "\x1b]52;c;☰\x07", "\x1bP☰\x1b\\", "\x1b_G☰\x1b\\"]) assert.equal(pad(value), value);
  assert.equal(pad("\x1b]8;;https://☰"), "\x1b]8;;https://☰");
  assert.equal(pad("/☰\x1b"), "/☰\x1b");
  assert.equal(pad("\\☰"), "\\☰ ");
});

test("output guard is VTE-0.84-only, restores write and deactivates under an external wrapper", () => {
  const writes = [], terminal = { write(data) { writes.push(data); } }, original = terminal.write;
  for (const version of ["", "8200", "8500", "invalid"]) {
    installVteWidthGuard(terminal, version)(); assert.equal(terminal.write, original);
  }
  const restore = installVteWidthGuard(terminal, "8400");
  terminal.write("☰"); assert.equal(writes.at(-1), "☰ "); restore();
  assert.equal(terminal.write, original); terminal.write("☰"); assert.equal(writes.at(-1), "☰");
  const stop = installVteWidthGuard(terminal, "8400"), captured = terminal.write;
  const external = (data) => captured(data); terminal.write = external;
  stop(); assert.equal(terminal.write, external); terminal.write("☰"); assert.equal(writes.at(-1), "☰");
});

test("select 10/11: row 9 keeps its column even when the same chat row contains ☰; copy stays original", async (t) => {
  const env = process.env.VTE_VERSION; process.env.VTE_VERSION = "8400";
  t.after(() => { if (env === undefined) delete process.env.VTE_VERSION; else process.env.VTE_VERSION = env; });
  const f = fixture(t, "fullscreen", 20), originalWrite = f.terminal.write;
  f.document.children[21].render = () => [START, ...Array(4).fill("before"), "chat ☰ same row", ...Array(60).fill("answer"), END];
  await f.command("on"); f.frame(); await f.command("goto 10"); const lines = f.frame();
  assert.ok(plain(lines[8]).includes("chat ☰ same row")); assert.ok(plain(lines[8]).includes("9. Prompt 9"));
  const row = [...f.terminal.output.matchAll(/\x1b\[9;1H\x1b\[2K([\s\S]*?)(?=\x1b\[\d+;\d+H)/g)].at(-1)?.[1];
  assert.ok(row, "real renderer wrote row 9");
  assert.equal(vteWidth(row.slice(0, row.indexOf("9. Prompt 9"))), 80);
  dragSelect(f, { x: 0, y: 8 }, { x: 20, y: 8 });
  assert.match(f.copied.at(-1), /chat ☰ same row/); assert.doesNotMatch(f.copied.at(-1), /☰  same/);
  f.tui.resetTextSelection(); await f.command("goto 11"); f.frame();
  assert.equal(shown(f).length, 20); await f.command("off"); f.frame();
  assert.equal(f.terminal.write, originalWrite);
});

for (const side of ["right", "left"]) {
  for (const count of [0, 18, 60]) {
    test(`${side}, ${count} prompts: every streaming frame preserves list, colors and empty state`, async (t) => {
      const f = fixture(t, "fullscreen", count); await f.command(side); f.frame();
      let response = f.document.children.at(-1);
      if (!count) {
        response = { invalidate() {}, render() { return []; } };
        f.document.addChild(response); f.frame();
      }
      let lines = 50;
      response.render = () => [START, ...Array(lines).fill("streaming response"), END];
      const stable = [...sidebarBox(f).scrollContentLines];
      const root = f.tui.layoutRoot;
      const expectedCount = Math.min(count, f.terminal.rows);
      for (let i = 0; i < 12; i++) {
        lines += 1;
        f.tui.renderNow(); // FIRST streaming frame, not a settled triple redraw.
        assert.equal(shown(f).length, expectedCount, `prompts remain on frame ${i}`);
        assert.deepEqual(sidebarBox(f).scrollContentLines, stable, "no transient blanking or color changes");
        f.tick(); f.tui.renderNow();
        assert.deepEqual(sidebarBox(f).scrollContentLines, stable, "same content after poll");
        assert.equal(f.tui.layoutRoot, root, "streaming never remounts the sidebar");
      }
    });
  }
}

test("follow-scroll geometry updates do not schedule redundant sidebar repaints", async (t) => {
  const f = fixture(t); await f.command("on"); f.frame();
  const response = f.document.children.at(-1);
  let lines = 100;
  response.render = () => [START, ...Array(lines).fill("growing response"), END];
  f.frame();
  const requestRender = f.tui.requestRender;
  let requests = 0;
  f.tui.requestRender = (...args) => { requests += 1; requestRender(...args); };
  const top = f.transcript.scrollTop;
  for (let i = 0; i < 8; i++) {
    lines += 2; f.tui.renderNow();
    const beforePoll = requests;
    f.tick();
    assert.equal(requests, beforePoll, "scrollTop-only changes need no sidebar repaint");
  }
  assert.ok(f.transcript.scrollTop > top, "response actually moved the following viewport");
});

test("retaining a transient snapshot still accepts committed empty/new branch and clicks fresh rows", async (t) => {
  const f = fixture(t, "fullscreen", 18); await f.command("on"); f.frame();
  f.document.clear();
  f.events.get("session_tree")({}, f.ctx);
  let lines = f.frame(); assert.equal(shown(f).length, 0);
  assert.ok(lines.some((line) => plain(line).includes("Chưa có prompt")));
  f.add("A new branch input"); f.events.get("message_start")({}, f.ctx);
  lines = f.frame(); assert.equal(shown(f).length, 1);
  click(f, point(lines, "1. A new branch input")); f.frame();
  assert.equal(f.transcript.scrollTop, f.rows()[0]);
});

test("an already-open sidebar repaints with the current theme without remounting or changing text",async(t)=>{
  const f=fixture(t);await f.command("on");f.frame();const root=f.tui.layoutRoot;
  const before=sidebarBox(f).scrollContentLines.map(plain);
  f.ctx.ui.theme={...f.ctx.ui.theme,getBgAnsi:token=>{assert.equal(token,"customMessageBg");return "\x1b[48;5;254m";}};
  const lines=f.frame();assert.equal(f.tui.layoutRoot,root);
  assert.deepEqual(sidebarBox(f).scrollContentLines.map(plain),before);
  assert(lines.some(line=>line.includes("\x1b[48;5;254m")));
  f.ctx.ui.theme={...f.ctx.ui.theme,getBgAnsi:()=>"\x1b[49m"};
  f.frame();assert(sidebarBox(f).scrollContentLines.every(line=>!line.includes("\x1b[48;")));
});
