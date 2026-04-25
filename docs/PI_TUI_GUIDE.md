# 🖥️ Pi Custom TUI — Hướng Dẫn Chi Tiết

> Tham khảo từ [packages/coding-agent/docs/tui.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tui.md) và [keybindings.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md)  
> Source: [`@mariozechner/pi-tui`](https://github.com/badlogic/pi-mono/tree/main/packages/tui)  
> Pi có thể tự tạo TUI components — hãy nhờ nó build cho use case của bạn!

---

## Mục Lục

- [1. Tổng Quan](#1-tổng-quan)
- [2. Component Interface](#2-component-interface)
- [3. Built-in Components](#3-built-in-components)
- [4. Keyboard Input](#4-keyboard-input)
- [5. Line Width & Utilities](#5-line-width--utilities)
- [6. Sử Dụng Components Trong Extensions](#6-sử-dụng-components-trong-extensions)
- [7. Overlays](#7-overlays)
- [8. Tạo Custom Components](#8-tạo-custom-components)
- [9. Theming](#9-theming)
- [10. Invalidation & Theme Changes](#10-invalidation--theme-changes)
- [11. Focusable Interface (IME Support)](#11-focusable-interface-ime-support)
- [12. Common Patterns — Copy-Paste](#12-common-patterns--copy-paste)
  - [Pattern 1: Selection Dialog (SelectList)](#pattern-1-selection-dialog-selectlist)
  - [Pattern 2: Async with Cancel (BorderedLoader)](#pattern-2-async-with-cancel-borderedloader)
  - [Pattern 3: Settings/Toggles (SettingsList)](#pattern-3-settingstoggles-settingslist)
  - [Pattern 4: Persistent Status](#pattern-4-persistent-status)
  - [Pattern 5: Widgets Above/Below Editor](#pattern-5-widgets-abovebelow-editor)
  - [Pattern 6: Custom Footer](#pattern-6-custom-footer)
  - [Pattern 7: Custom Editor (Vim mode)](#pattern-7-custom-editor-vim-mode)
- [13. Custom Tool Rendering](#13-custom-tool-rendering)
- [14. Message Rendering](#14-message-rendering)
- [15. Keybindings](#15-keybindings)
- [16. Performance & Caching](#16-performance--caching)
- [17. Debug Logging](#17-debug-logging)
- [18. Key Rules](#18-key-rules)
- [19. Examples Reference](#19-examples-reference)

---

## 1. Tổng Quan

Pi cung cấp **full component system** để extensions và custom tools render interactive TUI (Terminal UI). Bạn có thể:

- 🎯 **Dialogs** — Selection lists, confirmations, text input
- 📊 **Widgets** — Persistent content above/below editor
- 🎨 **Custom rendering** — Tùy chỉnh cách tools/messages hiển thị
- 🖼️ **Overlays** — Floating modals trên nội dung hiện có
- ⌨️ **Custom editors** — Vim mode, emacs mode
- 🎮 **Games** — Snake, Space Invaders, DOOM!

### Packages

| Package | Import | Mục đích |
|---------|--------|----------|
| `@mariozechner/pi-tui` | Components, keys, utilities | Core TUI library |
| `@mariozechner/pi-coding-agent` | Extension types, helpers | Extension integration |

---

## 2. Component Interface

Tất cả components implement interface này:

```typescript
interface Component {
  render(width: number): string[];     // Return mảng strings (1 string = 1 dòng)
  handleInput?(data: string): void;    // Nhận keyboard input khi có focus
  wantsKeyRelease?: boolean;           // Nhận key release events (Kitty protocol)
  invalidate(): void;                  // Clear cached render state
}
```

| Method | Quy tắc |
|--------|---------|
| `render(width)` | Mỗi dòng **PHẢI ≤ width**. Dùng `truncateToWidth()` |
| `handleInput(data)` | Optional. Dùng `matchesKey()` để detect phím |
| `invalidate()` | Clear caches. TUI gọi khi theme thay đổi |

**Quan trọng:** Styles (ANSI codes) **không** carry qua dòng. TUI append SGR reset cuối mỗi dòng. Dùng `wrapTextWithAnsi()` nếu cần word wrap có ANSI.

---

## 3. Built-in Components

Import từ `@mariozechner/pi-tui`:

```typescript
import { Text, Box, Container, Spacer, Markdown, Image, SelectList, SettingsList } from "@mariozechner/pi-tui";
```

Import từ `@mariozechner/pi-coding-agent`:

```typescript
import { DynamicBorder, BorderedLoader } from "@mariozechner/pi-coding-agent";
```

### Text

Multi-line text với word wrapping.

```typescript
const text = new Text(
  "Hello World",      // content
  1,                  // paddingX (default: 1)
  1,                  // paddingY (default: 1)
  (s) => bgGray(s)    // optional background function
);
text.setText("Updated content");
```

### Box

Container với padding và background color.

```typescript
const box = new Box(
  1,                  // paddingX
  1,                  // paddingY
  (s) => bgGray(s)    // background function
);
box.addChild(new Text("Content", 0, 0));
box.setBgFn((s) => bgBlue(s));
```

### Container

Nhóm child components theo chiều dọc.

```typescript
const container = new Container();
container.addChild(component1);
container.addChild(component2);
container.removeChild(component1);
container.clear();  // Remove all children
```

### Spacer

Khoảng trống.

```typescript
const spacer = new Spacer(2);  // 2 dòng trống
```

### Markdown

Render markdown với syntax highlighting.

```typescript
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";

const md = new Markdown(
  "# Title\n\nSome **bold** text",
  1,                          // paddingX
  1,                          // paddingY
  getMarkdownTheme()          // MarkdownTheme
);
md.setText("Updated markdown");
```

### Image

Hiển thị ảnh (Kitty, iTerm2, Ghostty, WezTerm).

```typescript
const image = new Image(
  base64Data,         // base64-encoded image
  "image/png",        // MIME type
  theme,              // ImageTheme
  { maxWidthCells: 80, maxHeightCells: 24 }
);
```

### SelectList

Danh sách chọn với fuzzy search.

```typescript
import { type SelectItem, SelectList } from "@mariozechner/pi-tui";

const items: SelectItem[] = [
  { value: "opt1", label: "Option 1", description: "First option" },
  { value: "opt2", label: "Option 2" },
];

const selectList = new SelectList(items, 10, {  // max 10 visible rows
  selectedPrefix: (t) => theme.fg("accent", t),
  selectedText: (t) => theme.fg("accent", t),
  description: (t) => theme.fg("muted", t),
  scrollInfo: (t) => theme.fg("dim", t),
  noMatch: (t) => theme.fg("warning", t),
});

selectList.onSelect = (item) => { /* selected */ };
selectList.onCancel = () => { /* cancelled */ };
```

### SettingsList

Toggle settings.

```typescript
import { type SettingItem, SettingsList } from "@mariozechner/pi-tui";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";

const items: SettingItem[] = [
  { id: "verbose", label: "Verbose mode", currentValue: "off", values: ["on", "off"] },
];

const settings = new SettingsList(
  items, 15, getSettingsListTheme(),
  (id, newValue) => { /* changed */ },
  () => { /* closed */ },
  { enableSearch: true },
);
```

### DynamicBorder

Border đường ngang với theme color.

```typescript
import { DynamicBorder } from "@mariozechner/pi-coding-agent";

new DynamicBorder((s: string) => theme.fg("accent", s))
// ⚠️ Luôn type parameter: (s: string) => ..., không phải (s) => ...
```

### BorderedLoader

Async operation với spinner và cancel.

```typescript
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

const loader = new BorderedLoader(tui, theme, "Loading...");
loader.onAbort = () => { /* user pressed Escape */ };
// loader.signal — AbortSignal, pass cho async operations
```

---

## 4. Keyboard Input

Dùng `matchesKey()` từ `@mariozechner/pi-tui`:

```typescript
import { matchesKey, Key } from "@mariozechner/pi-tui";

handleInput(data: string) {
  if (matchesKey(data, Key.up)) { /* ↑ */ }
  if (matchesKey(data, Key.down)) { /* ↓ */ }
  if (matchesKey(data, Key.enter)) { /* Enter */ }
  if (matchesKey(data, Key.escape)) { /* Escape */ }
  if (matchesKey(data, Key.ctrl("c"))) { /* Ctrl+C */ }
  if (matchesKey(data, Key.shift("tab"))) { /* Shift+Tab */ }
  if (matchesKey(data, Key.alt("left"))) { /* Alt+← */ }
  if (matchesKey(data, Key.ctrlShift("p"))) { /* Ctrl+Shift+P */ }
}
```

### Key identifiers

| Category | Keys |
|----------|------|
| **Basic** | `Key.enter`, `Key.escape`, `Key.tab`, `Key.space`, `Key.backspace`, `Key.delete`, `Key.home`, `Key.end` |
| **Arrow** | `Key.up`, `Key.down`, `Key.left`, `Key.right` |
| **Modifiers** | `Key.ctrl("c")`, `Key.shift("tab")`, `Key.alt("left")`, `Key.ctrlShift("p")` |
| **String format** | `"enter"`, `"ctrl+c"`, `"shift+tab"`, `"ctrl+shift+p"` |

---

## 5. Line Width & Utilities

**Quy tắc quan trọng:** Mỗi dòng từ `render()` **PHẢI ≤ width**.

```typescript
import { visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
```

| Utility | Mô tả |
|---------|--------|
| `visibleWidth(str)` | Display width (bỏ qua ANSI codes, tính đúng CJK/emoji) |
| `truncateToWidth(str, width, ellipsis?)` | Truncate với optional ellipsis (`"..."` mặc định) |
| `wrapTextWithAnsi(str, width)` | Word wrap giữ nguyên ANSI codes |

```typescript
render(width: number): string[] {
  return [truncateToWidth(this.text, width)];
}
```

---

## 6. Sử Dụng Components Trong Extensions

### `ctx.ui.custom()` — Full replacement

Thay thế editor tạm thời cho đến khi `done()` được gọi:

```typescript
const result = await ctx.ui.custom<string | null>((tui, theme, keybindings, done) => {
  // tui — TUI instance (requestRender, screen dimensions)
  // theme — Current theme
  // keybindings — App keybinding manager
  // done(value) — Đóng component, trả về value

  return {
    render(width: number): string[] { return ["Hello!"]; },
    handleInput(data: string) {
      if (matchesKey(data, Key.enter)) done("confirmed");
      if (matchesKey(data, Key.escape)) done(null);
    },
    invalidate() {},
  };
});
```

### UI dialog methods

```typescript
// Selection
const choice = await ctx.ui.select("Pick:", ["A", "B", "C"]);

// Confirmation
const ok = await ctx.ui.confirm("Title", "Are you sure?");

// Text input
const name = await ctx.ui.input("Name:", "placeholder");

// Multi-line editor
const text = await ctx.ui.editor("Edit:", "prefilled");

// Notification (non-blocking)
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"
```

### Timed dialogs

```typescript
// Auto-dismiss sau 5 giây
const confirmed = await ctx.ui.confirm("Title", "Auto-cancel in 5s", { timeout: 5000 });
// timeout: select() → undefined, confirm() → false, input() → undefined
```

---

## 7. Overlays

Render component **trên top** nội dung hiện có, không clear screen:

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => new MyDialog({ onClose: done }),
  { overlay: true }
);
```

### Overlay options đầy đủ

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, kb, done) => new SidePanel({ onClose: done }),
  {
    overlay: true,
    overlayOptions: {
      // Size
      width: "50%",              // Hoặc số cụ thể
      minWidth: 40,
      maxHeight: "80%",

      // Position (9 anchors)
      anchor: "right-center",    // center, top-left, top-center, top-right,
                                 // left-center, right-center,
                                 // bottom-left, bottom-center, bottom-right
      offsetX: -2,
      offsetY: 0,

      // Hoặc absolute/percentage positioning
      row: "25%",
      col: 10,

      // Margins
      margin: 2,                 // Hoặc { top, right, bottom, left }

      // Responsive
      visible: (termWidth, termHeight) => termWidth >= 80,
    },
    onHandle: (handle) => {
      // handle.setHidden(true/false)
      // handle.hide() — permanently remove
    },
  }
);
```

### Overlay lifecycle

Components bị dispose khi đóng — **tạo instance mới** mỗi lần show:

```typescript
// ❌ Sai — stale reference
let menu: MenuComponent;
await ctx.ui.custom((_, __, ___, done) => {
  menu = new MenuComponent(done);
  return menu;
}, { overlay: true });

// ✅ Đúng — factory function
const showMenu = () => ctx.ui.custom(
  (_, __, ___, done) => new MenuComponent(done),
  { overlay: true }
);
await showMenu();  // Mỗi lần gọi tạo instance mới
```

---

## 8. Tạo Custom Components

### Ví dụ: Interactive selector

```typescript
import { matchesKey, Key, truncateToWidth } from "@mariozechner/pi-tui";

class MySelector {
  private items: string[];
  private selected = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];

  public onSelect?: (item: string) => void;
  public onCancel?: () => void;

  constructor(items: string[]) {
    this.items = items;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) && this.selected > 0) {
      this.selected--;
      this.invalidate();
    } else if (matchesKey(data, Key.down) && this.selected < this.items.length - 1) {
      this.selected++;
      this.invalidate();
    } else if (matchesKey(data, Key.enter)) {
      this.onSelect?.(this.items[this.selected]);
    } else if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    this.cachedLines = this.items.map((item, i) => {
      const prefix = i === this.selected ? "> " : "  ";
      return truncateToWidth(prefix + item, width);
    });
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
```

### Dùng trong extension

```typescript
pi.registerCommand("pick", {
  handler: async (args, ctx) => {
    const items = ["Option A", "Option B", "Option C"];
    const selector = new MySelector(items);

    let handle: { close: () => void; requestRender: () => void };

    await new Promise<void>((resolve) => {
      selector.onSelect = (item) => {
        ctx.ui.notify(`Selected: ${item}`, "info");
        handle.close();
        resolve();
      };
      selector.onCancel = () => { handle.close(); resolve(); };
      handle = ctx.ui.custom(selector);
    });
  },
});
```

---

## 9. Theming

### Trong renderCall/renderResult

```typescript
renderResult(result, options, theme) {
  return new Text(theme.fg("success", "Done!"), 0, 0);
}
```

### Trong custom components

```typescript
const result = await ctx.ui.custom<string | null>((tui, theme, kb, done) => {
  // Luôn dùng theme từ callback — KHÔNG import trực tiếp
  const styledText = theme.fg("accent", "Hello!");
  // ...
});
```

### Foreground colors (`theme.fg(color, text)`)

| Category | Colors |
|----------|--------|
| General | `text`, `accent`, `muted`, `dim` |
| Status | `success`, `error`, `warning` |
| Borders | `border`, `borderAccent`, `borderMuted` |
| Messages | `userMessageText`, `customMessageText`, `customMessageLabel` |
| Tools | `toolTitle`, `toolOutput` |
| Diffs | `toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext` |
| Markdown | `mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet` |
| Syntax | `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation` |
| Thinking | `thinkingOff` → `thinkingXhigh` |
| Modes | `bashMode` |

### Background colors (`theme.bg(color, text)`)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`

### Text styles

```typescript
theme.bold(text)
theme.italic(text)
theme.strikethrough(text)
```

### Syntax highlighting

```typescript
import { highlightCode, getLanguageFromPath } from "@mariozechner/pi-coding-agent";

const lang = getLanguageFromPath("/path/to/file.rs");  // "rust"
const highlighted = highlightCode(code, lang, theme);
```

---

## 10. Invalidation & Theme Changes

Khi theme thay đổi, TUI gọi `invalidate()` trên tất cả components.

### Vấn đề

Nếu component **pre-bake** theme colors vào strings rồi cache, cached strings chứa ANSI codes từ theme cũ:

```typescript
// ❌ Sai — theme colors không update khi đổi theme
class BadComponent extends Container {
  constructor(message: string, theme: Theme) {
    super();
    // Pre-baked — sẽ giữ màu cũ mãi mãi
    this.addChild(new Text(theme.fg("accent", message), 1, 0));
  }
}
```

### Giải pháp: Rebuild on Invalidate

```typescript
// ✅ Đúng — rebuild content khi invalidate
class GoodComponent extends Container {
  private message: string;
  private content: Text;

  constructor(message: string) {
    super();
    this.message = message;
    this.content = new Text("", 1, 0);
    this.addChild(this.content);
    this.updateDisplay();
  }

  private updateDisplay(): void {
    this.content.setText(theme.fg("accent", this.message));
  }

  override invalidate(): void {
    super.invalidate();     // Clear child caches
    this.updateDisplay();   // Rebuild với theme mới
  }
}
```

### Khi nào cần pattern này

| Cần | Không cần |
|-----|-----------|
| Pre-bake `theme.fg()` / `theme.bg()` vào strings | Dùng theme callbacks `(text) => theme.fg(...)` |
| `highlightCode()` → cache kết quả | Simple containers không themed content |
| Build child trees với embedded theme colors | Stateless render (tính toán lại mỗi `render()`) |

---

## 11. Focusable Interface (IME Support)

Components hiển thị text cursor và cần IME (CJK input methods) implement `Focusable`:

```typescript
import { CURSOR_MARKER, type Component, type Focusable } from "@mariozechner/pi-tui";

class MyInput implements Component, Focusable {
  focused: boolean = false;  // TUI set khi focus thay đổi

  render(width: number): string[] {
    const marker = this.focused ? CURSOR_MARKER : "";
    return [`> ${beforeCursor}${marker}\x1b[7m${atCursor}\x1b[27m${afterCursor}`];
  }
}
```

### Container with embedded Input

Container chứa `Input` phải propagate focus:

```typescript
class SearchDialog extends Container implements Focusable {
  private searchInput: Input;

  private _focused = false;
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;  // Propagate!
  }

  constructor() {
    super();
    this.searchInput = new Input();
    this.addChild(this.searchInput);
  }
}
```

Không propagate → IME candidate window hiện sai vị trí.

---

## 12. Common Patterns — Copy-Paste

> **Copy patterns này thay vì build from scratch.** `SelectList`, `SettingsList`, `BorderedLoader` cover 90% use cases.

### Pattern 1: Selection Dialog (SelectList)

```typescript
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";

pi.registerCommand("pick", {
  handler: async (_args, ctx) => {
    const items: SelectItem[] = [
      { value: "opt1", label: "Option 1", description: "First option" },
      { value: "opt2", label: "Option 2", description: "Second option" },
    ];

    const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold("Pick an Option")), 1, 0));

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      });
      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);

      container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

      return {
        render: (w) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data) => { selectList.handleInput(data); tui.requestRender(); },
      };
    });

    if (result) ctx.ui.notify(`Selected: ${result}`, "info");
  },
});
```

### Pattern 2: Async with Cancel (BorderedLoader)

```typescript
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

pi.registerCommand("fetch", {
  handler: async (_args, ctx) => {
    const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(tui, theme, "Fetching data...");
      loader.onAbort = () => done(null);

      fetchData(loader.signal)
        .then((data) => done(data))
        .catch(() => done(null));

      return loader;
    });

    if (result === null) ctx.ui.notify("Cancelled", "info");
    else ctx.ui.setEditorText(result);
  },
});
```

### Pattern 3: Settings/Toggles (SettingsList)

```typescript
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";

pi.registerCommand("settings", {
  handler: async (_args, ctx) => {
    const items: SettingItem[] = [
      { id: "verbose", label: "Verbose mode", currentValue: "off", values: ["on", "off"] },
      { id: "color", label: "Color output", currentValue: "on", values: ["on", "off"] },
    ];

    await ctx.ui.custom((_tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold("Settings")), 1, 1));

      const settingsList = new SettingsList(
        items, Math.min(items.length + 2, 15), getSettingsListTheme(),
        (id, newValue) => ctx.ui.notify(`${id} = ${newValue}`, "info"),
        () => done(undefined),
        { enableSearch: true },
      );
      container.addChild(settingsList);

      return {
        render: (w) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data) => settingsList.handleInput?.(data),
      };
    });
  },
});
```

### Pattern 4: Persistent Status

```typescript
// Set (hiện trong footer)
ctx.ui.setStatus("my-ext", ctx.ui.theme.fg("accent", "● active"));

// Clear
ctx.ui.setStatus("my-ext", undefined);
```

### Pattern 5: Widgets Above/Below Editor

```typescript
// String array (above editor mặc định)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);

// Below editor
ctx.ui.setWidget("my-widget", ["Line 1"], { placement: "belowEditor" });

// Với theme
ctx.ui.setWidget("my-widget", (_tui, theme) => {
  const lines = items.map(item =>
    item.done
      ? theme.fg("success", "✓ ") + theme.fg("muted", item.text)
      : theme.fg("dim", "○ ") + item.text
  );
  return { render: () => lines, invalidate: () => {} };
});

// Clear
ctx.ui.setWidget("my-widget", undefined);
```

### Pattern 5b: Working Message

Hiển thị status message khi extension đang xử lý (hiện bên dưới spinner):

```typescript
// Set working message
ctx.ui.setWorkingMessage("Đang tìm kiếm...");

// Clear khi xong
ctx.ui.setWorkingMessage(undefined);
```

### Pattern 6: Custom Footer

```typescript
ctx.ui.setFooter((tui, theme, footerData) => ({
  invalidate() {},
  render(width: number): string[] {
    // footerData.getGitBranch(): string | null
    // footerData.getExtensionStatuses(): ReadonlyMap<string, string>
    return [`${ctx.model?.id} (${footerData.getGitBranch() || "no git"})`];
  },
  dispose: footerData.onBranchChange(() => tui.requestRender()),
}));

ctx.ui.setFooter(undefined);  // Restore default
```

### Pattern 7: Custom Editor (Vim mode)

```typescript
import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

class VimEditor extends CustomEditor {
  private mode: "normal" | "insert" = "insert";

  handleInput(data: string): void {
    if (matchesKey(data, "escape") && this.mode === "insert") {
      this.mode = "normal";
      return;
    }
    if (this.mode === "insert") { super.handleInput(data); return; }

    switch (data) {
      case "i": this.mode = "insert"; return;
      case "h": super.handleInput("\x1b[D"); return;
      case "j": super.handleInput("\x1b[B"); return;
      case "k": super.handleInput("\x1b[A"); return;
      case "l": super.handleInput("\x1b[C"); return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length > 0) {
      const label = this.mode === "normal" ? " NORMAL " : " INSERT ";
      const lastLine = lines[lines.length - 1]!;
      lines[lines.length - 1] = truncateToWidth(lastLine, width - label.length, "") + label;
    }
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((_tui, theme, keybindings) =>
      new VimEditor(theme, keybindings)
    );
  });
}
```

**Key points:**
- Extend `CustomEditor` (KHÔNG `Editor`) → có app keybindings
- `super.handleInput(data)` cho keys không handle
- `ctx.ui.setEditorComponent(undefined)` → restore default

---

## 13. Custom Tool Rendering

Tools có thể tùy chỉnh cách hiển thị trong TUI:

### renderCall — Hiển thị tool call

```typescript
import { Text } from "@mariozechner/pi-tui";

pi.registerTool({
  name: "my_tool",
  // ...
  renderCall(args, theme) {
    let text = theme.fg("toolTitle", theme.bold("my_tool "));
    text += theme.fg("muted", args.action);
    if (args.text) text += " " + theme.fg("dim", `"${args.text}"`);
    return new Text(text, 0, 0);  // 0,0 padding — Box handles it
  },
});
```

### renderResult — Hiển thị kết quả

```typescript
renderResult(result, { expanded, isPartial }, theme) {
  // Streaming
  if (isPartial) return new Text(theme.fg("warning", "Processing..."), 0, 0);

  // Error
  if (result.details?.error) return new Text(theme.fg("error", `Error: ${result.details.error}`), 0, 0);

  // Normal — hỗ trợ expanded view (Ctrl+O)
  let text = theme.fg("success", "✓ Done");
  if (expanded && result.details?.items) {
    for (const item of result.details.items) {
      text += "\n  " + theme.fg("dim", item);
    }
  }
  return new Text(text, 0, 0);
}
```

### Keybinding hints

```typescript
import { keyHint } from "@mariozechner/pi-coding-agent";

renderResult(result, { expanded }, theme) {
  let text = theme.fg("success", "✓ Done");
  if (!expanded) text += ` (${keyHint("expandTools", "to expand")})`;
  return new Text(text, 0, 0);
}
```

### Fallback

Không có `renderCall` / `renderResult` → Pi hiện tool name / raw text content.

---

## 14. Message Rendering

Đăng ký custom renderer cho extension messages:

```typescript
import { Text } from "@mariozechner/pi-tui";

pi.registerMessageRenderer("my-extension", (message, options, theme) => {
  const { expanded } = options;
  let text = theme.fg("accent", `[${message.customType}] `) + message.content;

  if (expanded && message.details) {
    text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
  }

  return new Text(text, 0, 0);
});

// Gửi message
pi.sendMessage({
  customType: "my-extension",  // Khớp registerMessageRenderer
  content: "Status update",
  display: true,
  details: { ... },
});
```

---

## 15. Keybindings

> Config file dùng namespaced keybinding IDs (e.g., `tui.editor.cursorUp`, `app.tools.expand`). Configs cũ với IDs không namespace (e.g., `cursorUp`) được auto-migrate khi startup.
>
> Sau khi sửa `keybindings.json`, chạy `/reload` để apply mà không cần restart.

### Customization

Tạo `~/.pi/agent/keybindings.json`:

```json
{
  "tui.editor.cursorUp": ["up", "ctrl+p"],
  "tui.editor.cursorDown": ["down", "ctrl+n"],
  "tui.editor.deleteWordBackward": ["ctrl+w", "alt+backspace"]
}
```

### Tất cả actions

**Cursor Movement:**

| Keybinding ID | Default | Mô tả |
|--------|---------|--------|
| `tui.editor.cursorUp` | `up` | Di chuyển lên |
| `tui.editor.cursorDown` | `down` | Di chuyển xuống |
| `tui.editor.cursorLeft` | `left`, `ctrl+b` | Di chuyển trái |
| `tui.editor.cursorRight` | `right`, `ctrl+f` | Di chuyển phải |
| `tui.editor.cursorWordLeft` | `alt+left`, `ctrl+left`, `alt+b` | Nhảy word trái |
| `tui.editor.cursorWordRight` | `alt+right`, `ctrl+right`, `alt+f` | Nhảy word phải |
| `tui.editor.cursorLineStart` | `home`, `ctrl+a` | Đầu dòng |
| `tui.editor.cursorLineEnd` | `end`, `ctrl+e` | Cuối dòng |
| `tui.editor.jumpForward` | `ctrl+]` | Nhảy tới ký tự |
| `tui.editor.jumpBackward` | `ctrl+alt+]` | Nhảy lùi ký tự |
| `tui.editor.pageUp` | `pageUp` | Cuộn lên trang |
| `tui.editor.pageDown` | `pageDown` | Cuộn xuống trang |

**Deletion:**

| Keybinding ID | Default | Mô tả |
|--------|---------|--------|
| `tui.editor.deleteCharBackward` | `backspace` | Xóa char trước |
| `tui.editor.deleteCharForward` | `delete`, `ctrl+d` | Xóa char sau |
| `tui.editor.deleteWordBackward` | `ctrl+w`, `alt+backspace` | Xóa word trước |
| `tui.editor.deleteWordForward` | `alt+d`, `alt+delete` | Xóa word sau |
| `tui.editor.deleteToLineStart` | `ctrl+u` | Xóa đến đầu dòng |
| `tui.editor.deleteToLineEnd` | `ctrl+k` | Xóa đến cuối dòng |

**Application:**

| Keybinding ID | Default | Mô tả |
|--------|---------|--------|
| `tui.input.submit` | `enter` | Gửi input |
| `tui.input.newLine` | `shift+enter` | Dòng mới |
| `app.interrupt` | `escape` | Cancel/abort |
| `app.clear` | `ctrl+c` | Clear editor |
| `app.exit` | `ctrl+d` | Thoát |
| `app.suspend` | `ctrl+z` | Tạm dừng (background) |
| `app.editor.external` | `ctrl+g` | Mở external editor |
| `app.clipboard.pasteImage` | `ctrl+v` | Paste ảnh từ clipboard |

**Models:**

| Keybinding ID | Default | Mô tả |
|--------|---------|--------|
| `app.model.select` | `ctrl+l` | Chọn model |
| `app.model.cycleForward` | `ctrl+p` | Cycle model tiếp |
| `app.model.cycleBackward` | `shift+ctrl+p` | Cycle model trước |
| `app.thinking.cycle` | `shift+tab` | Cycle thinking level |
| `app.thinking.toggle` | `ctrl+t` | Thu gọn/mở rộng thinking blocks |

**Display:**

| Keybinding ID | Default | Mô tả |
|--------|---------|--------|
| `app.tools.expand` | `ctrl+o` | Thu gọn/mở rộng tool output |
| `app.message.followUp` | `alt+enter` | Queue follow-up message |
| `app.message.dequeue` | `alt+up` | Khôi phục queued messages vào editor |

**Kill Ring:**

| Keybinding ID | Default | Mô tả |
|--------|---------|--------|
| `tui.editor.yank` | `ctrl+y` | Paste text vừa xóa |
| `tui.editor.yankPop` | `alt+y` | Cycle qua text đã xóa sau yank |
| `tui.editor.undo` | `ctrl+-` | Undo thay đổi cuối |

**Sessions:**

| Keybinding ID | Default | Mô tả |
|--------|---------|--------|
| `app.session.new` | *(none)* | Session mới (`/new`) |
| `app.session.tree` | *(none)* | Mở tree navigator (`/tree`) |
| `app.session.fork` | *(none)* | Fork session (`/fork`) |
| `app.session.resume` | *(none)* | Mở session picker (`/resume`) |
| `app.session.togglePath` | `ctrl+p` | Toggle path display |
| `app.session.toggleSort` | `ctrl+s` | Toggle sort mode |
| `app.session.rename` | `ctrl+r` | Đổi tên session |
| `app.session.delete` | `ctrl+d` | Xóa session |

**Tree Navigation:**

| Keybinding ID | Default | Mô tả |
|--------|---------|--------|
| `app.tree.foldOrUp` | `ctrl+left`, `alt+left` | Fold branch hoặc nhảy lên segment trước |
| `app.tree.unfoldOrDown` | `ctrl+right`, `alt+right` | Unfold branch hoặc nhảy xuống segment sau |
| `app.tree.editLabel` | `shift+l` | Sửa label trên node |
| `app.tree.toggleLabelTimestamp` | `shift+t` | Toggle timestamp trên labels |

### Emacs config

```json
{
  "tui.editor.cursorUp": ["up", "ctrl+p"],
  "tui.editor.cursorDown": ["down", "ctrl+n"],
  "tui.editor.cursorLeft": ["left", "ctrl+b"],
  "tui.editor.cursorRight": ["right", "ctrl+f"],
  "tui.editor.deleteCharForward": ["delete", "ctrl+d"],
  "tui.editor.deleteCharBackward": ["backspace", "ctrl+h"],
  "tui.input.newLine": ["shift+enter", "ctrl+j"]
}
```

### Vim config

```json
{
  "tui.editor.cursorUp": ["up", "alt+k"],
  "tui.editor.cursorDown": ["down", "alt+j"],
  "tui.editor.cursorLeft": ["left", "alt+h"],
  "tui.editor.cursorRight": ["right", "alt+l"],
  "tui.editor.cursorWordLeft": ["alt+left", "alt+b"],
  "tui.editor.cursorWordRight": ["alt+right", "alt+w"]
}
```

---

## 16. Performance & Caching

Cache rendered output để tránh tính toán lại:

```typescript
class CachedComponent {
  private cachedWidth?: number;
  private cachedLines?: string[];

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;  // Cache hit
    }
    // ... compute lines ...
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
```

**Workflow:**
1. State thay đổi → gọi `this.invalidate()`
2. Sau đó gọi `tui.requestRender()` → trigger re-render
3. `render()` sẽ tính toán lại vì cache bị clear

---

## 17. Debug Logging

Capture raw ANSI stream:

```bash
PI_TUI_WRITE_LOG=/tmp/tui-ansi.log pi "Hello"
```

---

## 18. Key Rules

1. **Luôn dùng theme từ callback** — `ctx.ui.custom((tui, theme, ...) => ...)`, KHÔNG import trực tiếp
2. **Luôn type DynamicBorder color param** — `(s: string) => theme.fg(...)`, không phải `(s) => ...`
3. **Gọi `tui.requestRender()` sau state changes** — trong `handleInput`
4. **Return object 3 methods** — `{ render, invalidate, handleInput }`
5. **Dùng built-in components** — `SelectList`, `SettingsList`, `BorderedLoader` cover 90% cases
6. **Mỗi dòng render ≤ width** — dùng `truncateToWidth()`
7. **Text padding (0, 0)** — Box handles padding, đừng double-pad

---

## 19. Examples Reference

| Example | Mô tả | Key APIs |
|---------|--------|----------|
| [preset.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/preset.ts) | SelectList + DynamicBorder | `ctx.ui.custom`, `SelectList` |
| [qna.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/qna.ts) | BorderedLoader cho LLM calls | `BorderedLoader` |
| [tools.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/tools.ts) | SettingsList enable/disable | `SettingsList` |
| [plan-mode/](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/plan-mode/) | setStatus + setWidget | `setStatus`, `setWidget` |
| [custom-footer.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/custom-footer.ts) | setFooter with stats | `setFooter` |
| [modal-editor.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/modal-editor.ts) | Vim-like editing | `CustomEditor` |
| [rainbow-editor.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/rainbow-editor.ts) | Custom editor styling | `setEditorComponent` |
| [todo.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/todo.ts) | renderCall + renderResult | Tool rendering |
| [snake.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/snake.ts) | Full game + keyboard + loop | Custom component |
| [space-invaders.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/space-invaders.ts) | Game | Custom component |
| [doom-overlay/](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/doom-overlay/) | DOOM qua overlay | Overlay |
| [overlay-qa-tests.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/overlay-qa-tests.ts) | Overlay anchors, margins | `overlayOptions` |
| [widget-placement.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/widget-placement.ts) | Widget positioning | `setWidget` |
| [message-renderer.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/message-renderer.ts) | Custom messages | `registerMessageRenderer` |
| [status-line.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/status-line.ts) | Footer status | `setStatus` |
| [timed-confirm.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/timed-confirm.ts) | Timed dialogs | `timeout`, `AbortSignal` |

---

## Tham Khảo

- **TUI docs:** [tui.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tui.md)
- **Keybindings docs:** [keybindings.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md)
- **Extensions docs:** [extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- **Themes docs:** [themes.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/themes.md)
- **TUI source:** [packages/tui](https://github.com/badlogic/pi-mono/tree/main/packages/tui)
- **Examples:** [examples/extensions/](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
