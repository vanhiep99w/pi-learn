import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, matchesKey, Key, visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── Schema ──

const MAX_HEADER_WIDTH = 12;

const ModeEnum = StringEnum(["input", "select", "multiselect", "confirm", "editor"], {
  description: '"input" (default), "select" (pick one), "multiselect" (pick many), "confirm" (yes/no), "editor" (multi-line)',
});

const OptionItem = Type.Object({
  label: Type.String({ description: "Display text (1-5 words). Put recommended option first with '(Recommended)' suffix." }),
  description: Type.Optional(Type.String({ description: "Explanation of trade-offs or implications" })),
  preview: Type.Optional(Type.String({ description: "Optional preview: code snippet, ASCII mockup, or config example shown when focused" })),
});

const QuestionItem = Type.Object({
  question: Type.String({ description: "Clear question ending with '?'" }),
  header: Type.Optional(Type.String({ description: `Short chip label, max ${MAX_HEADER_WIDTH} chars. E.g. "Auth", "Library", "Approach"` })),
  mode: Type.Optional(ModeEnum),
  options: Type.Optional(Type.Array(
    Type.Union([Type.String(), OptionItem]),
    { description: "Choices for select/multiselect. Can be strings or {label, description, preview} objects." },
  )),
  placeholder: Type.Optional(Type.String({ description: "Placeholder for input mode" })),
  prefill: Type.Optional(Type.String({ description: "Pre-filled content for editor mode" })),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple selections (shorthand for mode='multiselect')" })),
});

// ── Normalized types ──

type OptionObj = { label: string; description?: string; preview?: string };

type QItem = {
  question: string;
  header?: string;
  mode?: string;
  options?: OptionObj[];
  placeholder?: string;
  prefill?: string;
};

function normalizeOptions(raw?: any[]): OptionObj[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map(o => typeof o === "string" ? { label: o } : o);
}

function normalizeItem(raw: any): QItem {
  const mode = raw.multiSelect ? "multiselect" : (raw.mode || undefined);
  return {
    question: raw.question,
    header: raw.header,
    mode,
    options: normalizeOptions(raw.options),
    placeholder: raw.placeholder,
    prefill: raw.prefill,
  };
}

// ── Validation ──

function validateItems(items: QItem[]): string | null {
  const questions = items.map(q => q.question);
  if (questions.length !== new Set(questions).size) {
    return "Question texts must be unique.";
  }
  for (const item of items) {
    if (item.options) {
      const labels = item.options.map(o => o.label);
      if (labels.length !== new Set(labels).size) {
        return `Duplicate option labels in question "${item.question}".`;
      }
    }
    if (item.header && item.header.length > MAX_HEADER_WIDTH) {
      return `Header "${item.header}" exceeds max ${MAX_HEADER_WIDTH} chars.`;
    }
  }
  return null;
}

// ── "Other" option ──
const OTHER_LABEL = "Other…";

function getOptionsWithOther(opts: OptionObj[]): OptionObj[] {
  return [...opts, { label: OTHER_LABEL, description: "Type a custom answer" }];
}

// ── Tool registration ──

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user clarifying questions when you need more information. " +
      "Supports 5 modes: input (single line), select (pick one), multiselect (pick multiple), confirm (yes/no), editor (multi-line). " +
      "Options can have descriptions and previews for richer choices. " +
      "An 'Other…' option is automatically added to select/multiselect for free-text fallback. " +
      "Pass a single question via `question`, or batch multiple via `questions` array.",
    promptSnippet:
      "Use `ask_user` to ask clarifying questions. Use `questions` array for batch multi-type questions.",
    promptGuidelines: [
      "Use mode 'input' for open-ended single-line questions (default).",
      "Use mode 'select' when offering specific choices (pick one) — provide `options`.",
      "Use mode 'multiselect' when user can pick multiple options — provide `options`.",
      "Use mode 'confirm' for yes/no questions.",
      "Use mode 'editor' when you expect multi-line response.",
      "Use `questions` array to batch multiple questions in one call, saving roundtrips.",
      "Do NOT use for rhetorical questions or to confirm actions you can just do.",
      "Options can be strings OR objects with {label, description, preview}. Use objects when choices need context.",
      "If you recommend a specific option, make it the FIRST option and add '(Recommended)' at the end of the label.",
      "Use `header` for a short chip label (max 12 chars) like 'Auth', 'Library', 'Approach'.",
      "Use `preview` on options to show code snippets, ASCII mockups, or config examples the user can compare.",
      "An 'Other…' option is automatically added — do NOT include your own. Users can always provide custom text.",
      "Users can add notes (annotations) to their answers for additional context.",
    ],
    parameters: Type.Object({
      question: Type.Optional(Type.String({ description: "A single question (use this OR questions)" })),
      questions: Type.Optional(Type.Array(QuestionItem, { description: "Multiple questions. Max 10." })),
      mode: Type.Optional(ModeEnum),
      options: Type.Optional(Type.Array(
        Type.Union([Type.String(), OptionItem]),
        { description: "Choices (single question only)" },
      )),
      placeholder: Type.Optional(Type.String({ description: "Placeholder (input mode)" })),
      prefill: Type.Optional(Type.String({ description: "Pre-fill (editor mode)" })),
      header: Type.Optional(Type.String({ description: `Short chip label, max ${MAX_HEADER_WIDTH} chars` })),
    }),

    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      if (!ctx?.hasUI) {
        return { content: [{ type: "text", text: "⚠️ No UI available." }] };
      }

      const { question, questions, mode, options, placeholder, prefill, header } = params;

      let items: QItem[];
      if (questions && Array.isArray(questions) && questions.length > 0) {
        items = questions.slice(0, 10).map(normalizeItem);
      } else if (question) {
        items = [normalizeItem({ question, header, mode, options, placeholder, prefill })];
      } else {
        return { content: [{ type: "text", text: "⚠️ Provide `question` or `questions`." }] };
      }

      // ── Validation ──
      const validationError = validateItems(items);
      if (validationError) {
        return { content: [{ type: "text", text: `⚠️ ${validationError}` }] };
      }

      // Single question with simple mode (not multiselect, no preview, no description) → built-in UI
      const singleSimple = items.length === 1
        && (items[0].mode || "input") !== "multiselect"
        && !items[0].options?.some(o => o.description || o.preview);
      if (singleSimple) {
        return askOneBuiltIn(ctx, items[0]);
      }

      // Multi-question OR rich options → custom AskForm
      const result = await ctx.ui.custom<AskFormResult>(
        (tui: any, theme: any, _kb: any, done: any) =>
          new AskForm(tui, theme, items, done),
      );

      if (!result || result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled." }],
          details: { batch: items.length > 1, count: items.length, cancelled: true, answers: [] },
        };
      }

      // Build output
      const answerDetails = items.map((q, i) => {
        const entry: any = {
          question: q.question,
          mode: q.mode || "input",
          answer: result.answers[i] ?? "(skipped)",
        };
        if (q.header) entry.header = q.header;
        if (result.annotations[i]) entry.notes = result.annotations[i];
        return entry;
      });

      if (items.length === 1) {
        const a = answerDetails[0];
        let text = a.answer;
        if (a.notes) text += `\n\n_User notes: ${a.notes}_`;
        return {
          content: [{ type: "text", text: text || "(empty)" }],
          details: { mode: a.mode, question: a.question, answer: a.answer, notes: a.notes, header: a.header },
        };
      }

      let output = `## User Answers (${items.length} questions)\n\n`;
      for (let i = 0; i < answerDetails.length; i++) {
        const a = answerDetails[i];
        const tag = a.header ? `[${a.header}] ` : "";
        output += `**Q${i + 1}** ${tag}(${a.mode}): ${a.question}\n`;
        output += `**A${i + 1}:** ${a.answer}\n`;
        if (a.notes) output += `_Notes: ${a.notes}_\n`;
        output += "\n";
      }

      return {
        content: [{ type: "text", text: output }],
        details: { batch: true, count: items.length, answers: answerDetails },
      };
    },

    renderCall(args: any, theme: any) {
      if (args.questions && args.questions.length > 1) {
        return new Text(theme.fg("toolTitle", theme.bold("✎ ask_user ")) + theme.fg("dim", `${args.questions.length} questions`), 0, 0);
      }
      const ic: Record<string, string> = { input: "✎", select: "☰", multiselect: "☑", confirm: "?", editor: "📝" };
      const m = args.mode || args.questions?.[0]?.mode || "input";
      const h = args.header || args.questions?.[0]?.header;
      const q = args.question || args.questions?.[0]?.question || "";
      let text = theme.fg("toolTitle", theme.bold(`${ic[m] ?? "✎"} ask_user `));
      if (h) text += theme.fg("accent", `[${h}] `);
      text += theme.fg("dim", `"${q}"`);
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const d = result.details as any;
      if (d?.batch) {
        if (d.cancelled) return new Text(theme.fg("warning", "✗ Cancelled"), 0, 0);
        let t = theme.fg("success", `✓ ${d.count} answers`);
        if (expanded && d.answers) {
          for (const a of d.answers) {
            const tag = a.header ? theme.fg("accent", `[${a.header}] `) : "";
            t += "\n  " + tag + theme.fg("dim", a.question);
            t += "\n    " + theme.fg("accent", a.answer);
            if (a.notes) t += "\n    " + theme.fg("dim", `📝 ${a.notes}`);
          }
        }
        return new Text(t, 0, 0);
      }
      if (!d) return new Text(theme.fg("dim", result.content?.[0]?.text || ""), 0, 0);
      let t = theme.fg("success", "✓ ");
      if (d.header) t += theme.fg("accent", `[${d.header}] `);
      t += theme.fg("dim", `(${d.mode}) `);
      if (expanded) {
        t += theme.fg("accent", d.answer);
        if (d.notes) t += "\n    " + theme.fg("dim", `📝 ${d.notes}`);
      }
      return new Text(t, 0, 0);
    },
  });

  pi.on("session_start", () => {
    pi.ctx?.ui?.notify("✎ Ask User v2 ready (options, previews, annotations)", 2000);
  });
}

// ── Built-in UI for simple single questions ──

async function askOneBuiltIn(ctx: any, item: QItem) {
  const { question, mode = "input", options, placeholder, prefill } = item;
  let answer: string | boolean | undefined;
  switch (mode) {
    case "select":
      if (!options?.length) return { content: [{ type: "text", text: "⚠️ select requires options." }], details: { mode, question, answer: "(error)" } };
      answer = await ctx.ui.select(question, getOptionsWithOther(options).map(o => o.label));
      break;
    case "confirm":
      answer = await ctx.ui.confirm("ask_user", question);
      break;
    case "editor":
      answer = await ctx.ui.editor(question, prefill ?? "");
      break;
    default:
      answer = await ctx.ui.input(question, placeholder ?? "");
      break;
  }
  if (answer === undefined || answer === null) {
    return { content: [{ type: "text", text: "User dismissed." }], details: { mode, question, answer: "(dismissed)" } };
  }
  let text = typeof answer === "boolean" ? (answer ? "Yes" : "No") : answer;
  // If "Other…" selected via built-in, prompt for custom text
  if (text === OTHER_LABEL) {
    const custom = await ctx.ui.input("Enter your custom answer:", "");
    text = custom || "(empty)";
  }
  return { content: [{ type: "text", text }], details: { mode, question, answer: text, header: item.header } };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AskForm — inline component with descriptions, previews, "Other", annotations
//
//  ╭─ ☰ Ask User ─[Library]──────────── ◄ 1/3 ► ──╮
//  │ Which library should we use?                    │
//  │ ❯ Lodash (Recommended)                          │
//  │   Mature, widely used utility library            │
//  │   Day.js                                         │
//  │   Lightweight date library (2KB)                 │
//  │   Other…                                         │
//  │   Type a custom answer                           │
//  │─────────────────── preview ─────────────────────│
//  │ import _ from 'lodash';                          │
//  │─────────────────── 📝 notes ────────────────────│
//  │ > ▎                                              │
//  ╰───────── ↑↓ choose  Tab notes  Enter submit ────╯
// ═══════════════════════════════════════════════════════════════════════════════

type AskFormResult = { cancelled: boolean; answers: string[]; annotations: (string | undefined)[] };

class AskForm {
  private tui: any;
  private t: any;
  private items: QItem[];
  private done: (v: AskFormResult) => void;

  private idx = 0;
  // Per-question state
  private textAnswers: string[];
  private selectCursors: number[];
  private multiSelected: boolean[][];
  // "Other" text input per question
  private otherTexts: string[];
  // Annotations (notes) per question
  private annotations: string[];
  // Focus: "options" | "other" | "notes"
  private focus: ("options" | "other" | "notes")[];

  constructor(tui: any, theme: any, items: QItem[], done: any) {
    this.tui = tui;
    this.t = theme;
    this.items = items;
    this.done = done;

    this.textAnswers = items.map(q => q.prefill ?? "");
    this.selectCursors = items.map(() => 0);
    this.multiSelected = items.map(q => (q.options ?? []).map(() => false));
    this.otherTexts = items.map(() => "");
    this.annotations = items.map(() => "");
    this.focus = items.map(() => "options");
  }

  invalidate() {}

  render(width: number): string[] {
    const t = this.t;
    const item = this.items[this.idx];
    const mode = item.mode || "input";
    const W = Math.max(40, width);
    const inner = W - 4;
    const lines: string[] = [];
    const icons: Record<string, string> = { input: "✎", select: "☰", multiselect: "☑", confirm: "?", editor: "📝" };
    const bc = "borderAccent";

    // ── Top border with title + header chip + step ──
    const icon = icons[mode] ?? "✎";
    let titleText = ` ${icon} Ask User `;
    if (item.header) {
      titleText += `[${item.header.slice(0, MAX_HEADER_WIDTH)}] `;
    }
    const total = this.items.length;
    const hasPrev = this.idx > 0;
    const hasNext = this.idx < total - 1;
    const stepText = (hasPrev ? "◄ " : "  ") + `${this.idx + 1}/${total}` + (hasNext ? " ►" : "  ");
    const titleW = visibleWidth(titleText);
    const stepW = visibleWidth(stepText);
    const topFill = Math.max(1, W - titleW - stepW - 4);
    lines.push(
      t.fg(bc, "╭─") + t.fg("accent", t.bold(titleText)) +
      t.fg(bc, "─") + t.fg("dim", stepText) +
      t.fg(bc, "─".repeat(topFill) + "╮")
    );

    // ── Question text ──
    const qText = truncateToWidth(item.question, inner);
    const qPad = " ".repeat(Math.max(0, inner - visibleWidth(qText)));
    lines.push(t.fg(bc, "│ ") + t.fg("text", t.bold(qText)) + qPad + t.fg(bc, " │"));

    // ── Answer area ──
    const answerLines = this.renderAnswer(inner, item, mode);
    for (const al of answerLines) {
      const alW = visibleWidth(al);
      const alPad = " ".repeat(Math.max(0, inner - alW));
      lines.push(t.fg(bc, "│ ") + al + alPad + t.fg(bc, " │"));
    }

    // ── Preview area (select/multiselect only) ──
    if ((mode === "select" || mode === "multiselect") && item.options) {
      const allOpts = getOptionsWithOther(item.options);
      const cursor = this.selectCursors[this.idx];
      const currentOpt = allOpts[cursor];
      if (currentOpt?.preview) {
        // Preview separator
        const prevLabel = " preview ";
        const prevFill = Math.max(1, inner - visibleWidth(prevLabel));
        const half = Math.floor(prevFill / 2);
        lines.push(t.fg(bc, "│ ") + t.fg("dim", "─".repeat(half) + prevLabel + "─".repeat(prevFill - half)) + t.fg(bc, " │"));
        // Preview lines (max 6)
        const prevLines = currentOpt.preview.split("\n").slice(0, 6);
        for (const pl of prevLines) {
          const trimmed = truncateToWidth(pl, inner);
          const pad = " ".repeat(Math.max(0, inner - visibleWidth(trimmed)));
          lines.push(t.fg(bc, "│ ") + t.fg("dim", trimmed) + pad + t.fg(bc, " │"));
        }
      }
    }

    // ── "Other" text input area ──
    if ((mode === "select" || mode === "multiselect") && this.isOnOther()) {
      const otherLabel = " custom answer ";
      const otherFill = Math.max(1, inner - visibleWidth(otherLabel));
      const h = Math.floor(otherFill / 2);
      lines.push(t.fg(bc, "│ ") + t.fg("dim", "─".repeat(h) + otherLabel + "─".repeat(otherFill - h)) + t.fg(bc, " │"));
      const otherVal = this.otherTexts[this.idx];
      const isFocused = this.focus[this.idx] === "other";
      const cursor = isFocused ? t.fg("accent", "▎") : "";
      const otherLine = t.fg("dim", "> ") + t.fg("text", truncateToWidth(otherVal, inner - 4)) + cursor;
      const olW = visibleWidth(otherLine);
      const olPad = " ".repeat(Math.max(0, inner - olW));
      lines.push(t.fg(bc, "│ ") + otherLine + olPad + t.fg(bc, " │"));
    }

    // ── Annotations (notes) area ──
    const notesFocused = this.focus[this.idx] === "notes";
    if (notesFocused || this.annotations[this.idx].length > 0) {
      const notesLabel = " 📝 notes ";
      const notesFill = Math.max(1, inner - visibleWidth(notesLabel));
      const nh = Math.floor(notesFill / 2);
      lines.push(t.fg(bc, "│ ") + t.fg("dim", "─".repeat(nh) + notesLabel + "─".repeat(notesFill - nh)) + t.fg(bc, " │"));
      const noteVal = this.annotations[this.idx];
      const nc = notesFocused ? t.fg("accent", "▎") : "";
      const noteLine = t.fg("dim", "> ") + t.fg("text", truncateToWidth(noteVal, inner - 4)) + nc;
      const nlW = visibleWidth(noteLine);
      const nlPad = " ".repeat(Math.max(0, inner - nlW));
      lines.push(t.fg(bc, "│ ") + noteLine + nlPad + t.fg(bc, " │"));
    }

    // ── Bottom border with help ──
    const isLast = this.idx === total - 1;
    const helpParts: string[] = [];
    if (mode === "select" || mode === "multiselect") helpParts.push("↑↓ choose");
    if (mode === "multiselect") helpParts.push("Space toggle");
    if (mode === "confirm") helpParts.push("↑↓ toggle");
    if (total > 1) helpParts.push("←→ question");
    helpParts.push("Tab notes");
    if (mode === "editor") {
      helpParts.push(isLast ? "Ctrl+J submit" : "Ctrl+J next");
    } else {
      helpParts.push(isLast ? "Enter submit" : "Enter next");
    }
    helpParts.push("Esc cancel");
    const helpText = " " + helpParts.join("  ") + " ";
    const helpW = visibleWidth(helpText);
    const botFill = Math.max(1, W - helpW - 3);
    lines.push(
      t.fg(bc, "╰" + "─".repeat(botFill)) +
      t.fg("dim", helpText) +
      t.fg(bc, "╯")
    );

    return lines.map(l => truncateToWidth(l, W));
  }

  handleInput(data: string) {
    const item = this.items[this.idx];
    const mode = item.mode || "input";
    const currentFocus = this.focus[this.idx];

    // ── Escape → cancel ──
    if (matchesKey(data, Key.escape)) {
      this.done({ cancelled: true, answers: [], annotations: [] });
      return;
    }

    // ── Tab → cycle focus: options → other (if on Other) → notes → options ──
    if (matchesKey(data, Key.tab)) {
      if (currentFocus === "options") {
        if (this.isOnOther()) {
          this.focus[this.idx] = "other";
        } else {
          this.focus[this.idx] = "notes";
        }
      } else if (currentFocus === "other") {
        this.focus[this.idx] = "notes";
      } else {
        this.focus[this.idx] = "options";
      }
      this.tui.requestRender();
      return;
    }

    // ── ←→ navigate questions (always, unless typing in other/notes) ──
    if (currentFocus === "options") {
      if (matchesKey(data, Key.left)) {
        if (this.idx > 0) { this.idx--; this.tui.requestRender(); }
        return;
      }
      if (matchesKey(data, Key.right)) {
        if (this.idx < this.items.length - 1) { this.idx++; this.tui.requestRender(); }
        return;
      }
    }

    // ── Ctrl+J → next/submit (works in all modes) ──
    if (matchesKey(data, Key.ctrl("j"))) {
      if (this.idx < this.items.length - 1) {
        this.idx++;
        this.focus[this.idx] = "options";
        this.tui.requestRender();
      } else {
        this.submit();
      }
      return;
    }

    // ── Text input for "other" or "notes" focus ──
    if (currentFocus === "other" || currentFocus === "notes") {
      const arr = currentFocus === "other" ? this.otherTexts : this.annotations;
      if (matchesKey(data, Key.enter)) {
        // Enter in other/notes → next question or submit
        if (this.idx < this.items.length - 1) {
          this.idx++;
          this.focus[this.idx] = "options";
        } else {
          this.submit();
          return;
        }
        this.tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.backspace)) {
        if (arr[this.idx].length > 0) {
          arr[this.idx] = arr[this.idx].slice(0, -1);
          this.tui.requestRender();
        }
        return;
      }
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        arr[this.idx] += data;
        this.tui.requestRender();
      }
      return;
    }

    // ── Enter → next/submit (non-editor) or newline (editor) ──
    if (matchesKey(data, Key.enter)) {
      if (mode === "editor") {
        this.textAnswers[this.idx] += "\n";
        this.tui.requestRender();
        return;
      }
      if (this.idx < this.items.length - 1) {
        this.idx++;
        this.focus[this.idx] = "options";
      } else {
        this.submit();
        return;
      }
      this.tui.requestRender();
      return;
    }

    // ── Mode-specific (options focus) ──
    if (mode === "select") {
      const allOpts = getOptionsWithOther(item.options ?? []);
      if (matchesKey(data, Key.up) && this.selectCursors[this.idx] > 0) {
        this.selectCursors[this.idx]--;
        this.tui.requestRender();
      } else if (matchesKey(data, Key.down) && this.selectCursors[this.idx] < allOpts.length - 1) {
        this.selectCursors[this.idx]++;
        this.tui.requestRender();
      }
      return;
    }

    if (mode === "multiselect") {
      const allOpts = getOptionsWithOther(item.options ?? []);
      if (matchesKey(data, Key.up) && this.selectCursors[this.idx] > 0) {
        this.selectCursors[this.idx]--;
        this.tui.requestRender();
      } else if (matchesKey(data, Key.down) && this.selectCursors[this.idx] < allOpts.length - 1) {
        this.selectCursors[this.idx]++;
        this.tui.requestRender();
      } else if (matchesKey(data, Key.space)) {
        const ci = this.selectCursors[this.idx];
        // Ensure multiSelected array covers "Other" option
        while (this.multiSelected[this.idx].length < allOpts.length) {
          this.multiSelected[this.idx].push(false);
        }
        this.multiSelected[this.idx][ci] = !this.multiSelected[this.idx][ci];
        this.tui.requestRender();
      }
      return;
    }

    if (mode === "confirm") {
      if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
        this.textAnswers[this.idx] = this.textAnswers[this.idx] === "Yes" ? "No" : "Yes";
        this.tui.requestRender();
      }
      return;
    }

    // ── input / editor: typing ──
    if (matchesKey(data, Key.backspace)) {
      if (this.textAnswers[this.idx].length > 0) {
        this.textAnswers[this.idx] = this.textAnswers[this.idx].slice(0, -1);
        this.tui.requestRender();
      }
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.textAnswers[this.idx] += data;
      this.tui.requestRender();
    }
  }

  private isOnOther(): boolean {
    const item = this.items[this.idx];
    const mode = item.mode || "input";
    if (mode !== "select" && mode !== "multiselect") return false;
    const allOpts = getOptionsWithOther(item.options ?? []);
    return this.selectCursors[this.idx] === allOpts.length - 1;
  }

  private submit() {
    this.done({
      cancelled: false,
      answers: this.collectAnswers(),
      annotations: this.annotations.map(a => a.trim() || undefined),
    });
  }

  private collectAnswers(): string[] {
    return this.items.map((q, i) => {
      const mode = q.mode || "input";
      if (mode === "select") {
        const allOpts = getOptionsWithOther(q.options ?? []);
        const selected = allOpts[this.selectCursors[i]];
        if (selected?.label === OTHER_LABEL) {
          return this.otherTexts[i] || "(empty)";
        }
        return selected?.label ?? "";
      }
      if (mode === "multiselect") {
        const allOpts = getOptionsWithOther(q.options ?? []);
        const selected = allOpts.filter((_, j) => this.multiSelected[i]?.[j]);
        const labels = selected.map(o =>
          o.label === OTHER_LABEL ? (this.otherTexts[i] || "(empty)") : o.label
        );
        return labels.join(", ") || "(none)";
      }
      if (mode === "confirm") {
        return this.textAnswers[i] || "Yes";
      }
      return this.textAnswers[i];
    });
  }

  private renderAnswer(W: number, item: QItem, mode: string): string[] {
    const t = this.t;
    const lines: string[] = [];
    const isFocusOptions = this.focus[this.idx] === "options";

    if (mode === "select") {
      const allOpts = getOptionsWithOther(item.options ?? []);
      const cursor = this.selectCursors[this.idx];
      for (let i = 0; i < allOpts.length; i++) {
        const isCur = i === cursor;
        const opt = allOpts[i];
        const marker = isCur && isFocusOptions ? t.fg("accent", "❯ ") : "  ";
        const label = truncateToWidth(opt.label, W - 3);
        lines.push(truncateToWidth(marker + (isCur ? t.fg("text", label) : t.fg("dim", label)), W));
        // Show description below label
        if (opt.description) {
          const desc = truncateToWidth(opt.description, W - 5);
          lines.push(truncateToWidth("    " + t.fg("dim", desc), W));
        }
      }
      return lines;
    }

    if (mode === "multiselect") {
      const allOpts = getOptionsWithOther(item.options ?? []);
      const cursor = this.selectCursors[this.idx];
      // Ensure multiSelected covers "Other"
      while (this.multiSelected[this.idx].length < allOpts.length) {
        this.multiSelected[this.idx].push(false);
      }
      const checks = this.multiSelected[this.idx];
      for (let i = 0; i < allOpts.length; i++) {
        const isCur = i === cursor;
        const isChecked = checks[i];
        const opt = allOpts[i];
        const pointer = isCur && isFocusOptions ? t.fg("accent", "❯ ") : "  ";
        const box = isChecked ? t.fg("success", "☑ ") : t.fg("dim", "☐ ");
        const label = truncateToWidth(opt.label, W - 5);
        lines.push(truncateToWidth(pointer + box + (isCur ? t.fg("text", label) : t.fg("dim", label)), W));
        if (opt.description) {
          const desc = truncateToWidth(opt.description, W - 7);
          lines.push(truncateToWidth("      " + t.fg("dim", desc), W));
        }
      }
      return lines;
    }

    if (mode === "confirm") {
      if (!this.textAnswers[this.idx]) this.textAnswers[this.idx] = "Yes";
      const isYes = this.textAnswers[this.idx] === "Yes";
      lines.push(truncateToWidth(
        isYes ? t.fg("accent", "❯ ") + t.fg("accent", "● Yes") : "  " + t.fg("dim", "○ Yes"), W
      ));
      lines.push(truncateToWidth(
        !isYes ? t.fg("accent", "❯ ") + t.fg("accent", "● No") : "  " + t.fg("dim", "○ No"), W
      ));
      return lines;
    }

    if (mode === "editor") {
      const val = this.textAnswers[this.idx];
      const textLines = val.split("\n").slice(-4);
      if (textLines.length === 0 || (textLines.length === 1 && textLines[0] === "")) {
        lines.push(t.fg("dim", "> ") + t.fg("accent", "▎"));
      } else {
        for (const tl of textLines) {
          lines.push(t.fg("dim", "> ") + t.fg("text", truncateToWidth(tl, W - 4)));
        }
        lines[lines.length - 1] += t.fg("accent", "▎");
      }
      return lines;
    }

    // input
    const val = this.textAnswers[this.idx];
    if (val.length === 0 && item.placeholder) {
      lines.push(t.fg("dim", "> " + truncateToWidth(item.placeholder, W - 4)) + t.fg("accent", "▎"));
    } else {
      lines.push(t.fg("dim", "> ") + t.fg("text", truncateToWidth(val, W - 4)) + t.fg("accent", "▎"));
    }
    return lines;
  }
}
