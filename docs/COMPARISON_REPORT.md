# 📊 Local Docs vs Official Pi Docs — Comparison Report

> Generated: 2026-04-09

---

## 1. Mapping Table: Local Doc → Official Doc

| # | Local Doc | Official Doc(s) | Coverage |
|---|-----------|-----------------|----------|
| 1 | `CLAUDE_CODE_TOOLS_GUIDE.md` | ❌ **None** — Claude Code source analysis, not Pi doc | N/A |
| 2 | `PI_COMPACTION_GUIDE.md` | `compaction.md` | ✅ Comprehensive |
| 3 | `PI_DYNAMIC_AGENTS.md` | ❌ **None** — Custom design doc for Aurora Teams | N/A |
| 4 | `PI_EXTENSIONS_GUIDE.md` | `extensions.md` + `custom-provider.md` | ✅ Comprehensive |
| 5 | `PI_HARNESS_GUIDE.md` | ❌ **None** — Custom harness design doc | N/A |
| 6 | `PI_PROMPT_TEMPLATES_GUIDE.md` | `prompt-templates.md` | ✅ Comprehensive |
| 7 | `PI_SESSIONS_GUIDE.md` | `session.md` + `tree.md` + `compaction.md` | ✅ Comprehensive |
| 8 | `PI_SKILLS_GUIDE.md` | `skills.md` | ✅ Comprehensive |
| 9 | `PI_THEMES_GUIDE.md` | `themes.md` | ✅ Comprehensive |
| 10 | `PI_TOOLS_GUIDE.md` | `extensions.md` (Custom Tools section) | ✅ Good |
| 11 | `PI_TUI_GUIDE.md` | `tui.md` + `keybindings.md` | ✅ Comprehensive |

---

## 2. Official Docs with NO Local Equivalent

| # | Official Doc | Topic | Priority |
|---|-------------|-------|----------|
| 1 | `custom-provider.md` | Custom LLM providers, OAuth, streaming APIs | 🔴 High |
| 2 | `development.md` | Contributing / developing Pi itself | 🟡 Medium |
| 3 | `json.md` | JSON output mode (`--mode json`) | 🟡 Medium |
| 4 | `keybindings.md` | Keyboard shortcuts customization | 🟡 Medium (partially in TUI guide) |
| 5 | `models.md` | Model configuration, custom models | 🔴 High |
| 6 | `packages.md` | Pi package system (npm/git sharing) | 🔴 High |
| 7 | `providers.md` | LLM provider configuration | 🔴 High |
| 8 | `rpc.md` | RPC mode for programmatic integration | 🟡 Medium |
| 9 | `sdk.md` | SDK for embedding Pi programmatically | 🔴 High |
| 10 | `settings.md` | Settings reference (all config options) | 🔴 High |
| 11 | `shell-aliases.md` | Shell aliases for Pi commands | 🟢 Low |
| 12 | `terminal-setup.md` | Terminal setup for optimal experience | 🟡 Medium |
| 13 | `termux.md` | Running Pi on Android/Termux | 🟢 Low |
| 14 | `tmux.md` | tmux configuration for Pi | 🟡 Medium |
| 15 | `windows.md` | Windows-specific setup | 🟢 Low |

**Summary:** 15 of 23 official docs have no local equivalent. Critical gaps: `sdk.md`, `models.md`, `providers.md`, `settings.md`, `packages.md`, `custom-provider.md`.

---

## 3. Detailed Accuracy Analysis per Local Doc

### 3.1 `CLAUDE_CODE_TOOLS_GUIDE.md`

- **Maps to:** No official Pi doc — this is an analysis of **Claude Code** (Anthropic's agent) source code
- **Accuracy:** N/A — it's a separate project analysis, not a Pi doc translation
- **Note:** Useful as comparative reference but not a Pi doc. Section 7 "So Sánh Với Pi Agent" compares Claude Code vs Pi correctly

### 3.2 `PI_COMPACTION_GUIDE.md` → `compaction.md`

- **Accuracy:** ✅ **High** — Core concepts match official docs well
- **Content gaps:**
  - ❌ Missing: Official doc mentions that on repeated compactions, the summarized span starts at the previous compaction's `firstKeptEntryId`, not the compaction entry itself. Local doc doesn't explain this nuance.
  - ❌ Missing: Official doc notes Pi "recalculates `tokensBefore` from the rebuilt session context" before writing the new CompactionEntry.
  - ❌ Missing: Tool results truncation to 2000 characters during serialization (mentioned in official doc's Summary Format section).
  - ❌ Missing: The 3 summarization options for branch navigation (no summary, summarize, summarize with custom prompt) — official tree.md details this.
- **Outdated info:**
  - ⚠️ `branchSummary.skipPrompt` setting — the official doc doesn't mention this setting. The official tree.md shows 3 interactive options instead.
- **Extra content (local only):** Very detailed token estimation section (§2.6), source code map (§8), extension hook examples (§6) — valuable additions beyond official docs.

### 3.3 `PI_DYNAMIC_AGENTS.md`

- **Maps to:** No official doc — this is a **custom design document** for extending the Aurora Teams agent registry
- **Accuracy:** N/A — original design work, not a Pi docs translation
- **Note:** Design spec for a feature that doesn't exist in Pi core. References internal concepts like "harness", "bd CLI", "Aurora Teams".

### 3.4 `PI_EXTENSIONS_GUIDE.md` → `extensions.md`

- **Accuracy:** ✅ **High** — Comprehensive and well-structured
- **Content gaps (missing from local):**
  - ❌ Missing: `resources_discover` event (new event for contributing skill/prompt/theme paths)
  - ❌ Missing: `before_provider_request` event (inspect/modify provider payloads)
  - ❌ Missing: `model_select` event
  - ❌ Missing: `message_start` / `message_update` / `message_end` events
  - ❌ Missing: `ctx.signal` — agent abort signal for nested async work
  - ❌ Missing: `ctx.shutdown()` — graceful shutdown API
  - ❌ Missing: `ctx.getContextUsage()` — context usage tracking
  - ❌ Missing: `ctx.compact()` — programmatic compaction trigger
  - ❌ Missing: `ctx.getSystemPrompt()` — access current system prompt
  - ❌ Missing: `pi.sendUserMessage()` — inject user messages
  - ❌ Missing: `pi.getSessionName()` / `pi.setSessionName()` 
  - ❌ Missing: `pi.setLabel()` — bookmark entries
  - ❌ Missing: `pi.getCommands()` — list available commands
  - ❌ Missing: `pi.unregisterProvider()` — remove providers
  - ❌ Missing: `ctx.reload()` in ExtensionCommandContext
  - ❌ Missing: `ctx.switchSession()`, `ctx.navigateTree()`, `ctx.fork()` in ExtensionCommandContext
  - ❌ Missing: `withFileMutationQueue()` — file mutation queue for custom tools
  - ❌ Missing: `prepareArguments()` — argument compatibility shim for tools
  - ❌ Missing: `promptSnippet` / `promptGuidelines` for tools
  - ❌ Missing: `defineTool()` helper
  - ❌ Missing: Timed dialogs with countdown (`timeout` option)
  - ❌ Missing: `setWorkingMessage()` — set working message during streaming
  - ❌ Missing: `pasteToEditor()` — paste content to editor
  - ❌ Missing: Overlay mode for `ctx.ui.custom()` with `overlayOptions`
  - ❌ Missing: `setHeader()` — custom startup header
  - ❌ Missing: `setFooter()` footerData API (`getGitBranch`, `getExtensionStatuses`, `onBranchChange`)
  - ❌ Missing: Command argument auto-completion (`getArgumentCompletions`)
  - ❌ Missing: Several new examples (e.g., `trigger-compact.ts`, `shutdown-command.ts`, `timed-confirm.ts`, `bookmark.ts`, `session-name.ts`, etc.)
- **Outdated info:**
  - ⚠️ Keybindings section uses old un-namespaced IDs (`cursorUp`, `expandTools`). Official now uses namespaced IDs (`tui.editor.cursorUp`, `app.tools.expand`)
  - ⚠️ `session_tree` event uses `fromExtension` in official (not `fromHook`)
  - ⚠️ `pi.registerShortcut` example — official now uses more specific shortcut format
- **Extra content (valuable local additions):** Custom Providers section (§12) with OAuth support — this corresponds to `custom-provider.md` official doc. Input Events section (§6.6). Model Events (§6.5). Comprehensive TUI component catalog (§14). Very detailed with ~2080 lines vs official's ~1000+ lines.

### 3.5 `PI_HARNESS_GUIDE.md`

- **Maps to:** No official doc — custom design for a multi-agent "harness" system using Pi extensions
- **Accuracy:** N/A — original design work
- **Note:** Describes a Beads-based task management + multi-agent orchestration layer built on top of Pi extensions. Not an official Pi feature.

### 3.6 `PI_PROMPT_TEMPLATES_GUIDE.md` → `prompt-templates.md`

- **Accuracy:** ✅ **Very High** — Matches official docs closely
- **Content gaps:**
  - Minor: Official doc is much shorter (concise reference). Local doc expands significantly with many practical examples (§8), comparison table (§9), and package integration details (§10) — these are accurate elaborations.
- **Outdated info:** None found
- **Extra content (valuable):** 8 practical template examples, comparison with Skills and Extensions, detailed loading rules. All accurate.

### 3.7 `PI_SESSIONS_GUIDE.md` → `session.md` + `tree.md`

- **Accuracy:** ✅ **High** — Core session/tree concepts well covered
- **Content gaps:**
  - ❌ Missing: `CustomMessageEntry` as a distinct entry type (official has it)
  - ❌ Missing: Official `session.md` has detailed `SessionManager` static methods (`list`, `listAll`, `forkFrom`, `continueRecent`)
  - ❌ Missing: `session_before_fork` event's `entryId` field
  - ❌ Missing: Tree navigation options: `replaceInstructions`, `label` parameter
  - ❌ Missing: Tree UI fold/unfold with `Ctrl+←`/`Ctrl+→` or `Alt+←`/`Alt+→`
  - ❌ Missing: `Shift+L` to set labels, `Shift+T` to toggle label timestamps in tree
  - ❌ Missing: `Ctrl+U` toggle user-only, `Ctrl+O` toggle all entries in tree
  - ❌ Missing: Tree selection behavior when selecting root user message (leaf reset to null)
- **Outdated info:**
  - ⚠️ Session deletion: official now mentions `trash` CLI and `Ctrl+D` in `/resume`. Local only mentions file deletion.
  - ⚠️ Tree controls are incomplete compared to official `tree.md`

### 3.8 `PI_SKILLS_GUIDE.md` → `skills.md`

- **Accuracy:** ✅ **Very High** — Comprehensive and accurate
- **Content gaps:**
  - ❌ Missing: Official notes "root `.md` files are discovered as individual skills" in `~/.pi/agent/skills/` and `.pi/skills/` (not just SKILL.md in directories)
  - ❌ Missing: `~/.agents/skills/` and `.agents/skills/` root `.md` files are ignored (official clarifies this)
  - ❌ Missing: `disable-model-invocation` frontmatter field
  - ❌ Missing: `allowed-tools` frontmatter field (experimental)
  - ❌ Missing: `enableSkillCommands` settings toggle
- **Outdated info:** None significant
- **Extra content (valuable):** Dynamic skill registration via extensions (§12), detailed examples including custom skills (§10), Anthropic & Pi skill repositories (§15). All accurate.

### 3.9 `PI_THEMES_GUIDE.md` → `themes.md`

- **Accuracy:** ✅ **Very High** — Most accurate of all local docs
- **Content gaps:**
  - Very minor: Official doc includes inline example with all 51 tokens filled in; local doc references them but splits into sections
- **Outdated info:** None found
- **Extra content (valuable):** Theme recipes for Nord, Gruvbox, Tokyo Night, Catppuccin, Solarized (§9). Extension API for themes (§10). macOS dark/light auto-sync. Terminal compatibility table. Very comprehensive at ~1150 lines.

### 3.10 `PI_TOOLS_GUIDE.md` → `extensions.md` (Custom Tools section)

- **Accuracy:** ✅ **Good** — Built-in tool descriptions are accurate
- **Content gaps:**
  - ❌ Missing: `withFileMutationQueue()` for file-mutating custom tools
  - ❌ Missing: `prepareArguments()` for argument compatibility
  - ❌ Missing: `promptSnippet` / `promptGuidelines` for system prompt integration
  - ❌ Missing: `defineTool()` helper function
  - ❌ Missing: `StringEnum` requirement for Google API compatibility
  - ❌ Missing: Error signaling via throw (not return value)
  - ❌ Missing: Built-in renderer inheritance for tool overrides
  - ❌ Missing: `tool_execution_start/update/end` details about parallel tool ordering
- **Outdated info:**
  - ⚠️ `isToolCallEventType` — local doc uses older type param style. Official shows built-in tools need no type params.
  - ⚠️ `keyHint` function — local uses `"expandTools"`, should be `"app.tools.expand"` (namespaced)

### 3.11 `PI_TUI_GUIDE.md` → `tui.md` + `keybindings.md`

- **Accuracy:** ✅ **High** — Component system well documented
- **Content gaps:**
  - ❌ Missing: `Focusable` interface for IME support (CJK input methods)
  - ❌ Missing: `CURSOR_MARKER` for hardware cursor positioning
  - ❌ Missing: Container components with embedded inputs (IME propagation)
  - ❌ Missing: Overlay `overlayOptions` (anchor, width/height %, responsive visibility)
  - ❌ Missing: `setWorkingMessage()` pattern
  - ❌ Missing: `setFooter` with `footerData` API
  - ❌ Missing: Full namespaced keybinding IDs (uses old `cursorUp` style instead of `tui.editor.cursorUp`)
  - ❌ Missing: Several new keybinding IDs: `app.suspend`, `app.clipboard.pasteImage`, `app.session.*`, `app.tree.*`, `tui.editor.jumpForward/Backward`, `tui.editor.yank/yankPop/undo`, `app.message.dequeue`
- **Outdated info:**
  - ⚠️ Keybindings section (§15) uses old un-namespaced action names. Official now uses `tui.editor.cursorUp`, `app.tools.expand`, etc.
  - ⚠️ Missing new keybinding categories: Kill Ring, Sessions, Tree Navigation

---

## 4. Summary

### Overall Assessment

| Metric | Value |
|--------|-------|
| **Local docs** | 11 files |
| **Corresponding to official docs** | 8 of 11 (3 are custom/project-specific) |
| **Official docs covered** | 8 of 23 (35%) |
| **Official docs missing locally** | 15 of 23 (65%) |
| **Accuracy of existing docs** | Generally HIGH — core concepts are correct |
| **Most outdated area** | Keybinding IDs (un-namespaced → namespaced migration) |
| **Biggest content gap** | Extensions guide missing ~20+ new API methods/events |

### Top Priority Updates Needed

1. **PI_EXTENSIONS_GUIDE.md** — Needs significant update for ~20+ new APIs (events, context methods, tool features, UI features)
2. **PI_TUI_GUIDE.md** — Needs Focusable/IME support, overlay options, namespaced keybindings
3. **PI_SESSIONS_GUIDE.md** — Needs tree navigation updates (fold/unfold, labels, new controls)
4. **PI_TOOLS_GUIDE.md** — Needs file mutation queue, prepareArguments, promptSnippet/Guidelines

### Top Priority New Docs Needed

1. `PI_SDK_GUIDE.md` — SDK for programmatic Pi usage
2. `PI_MODELS_GUIDE.md` — Model configuration
3. `PI_PROVIDERS_GUIDE.md` — LLM provider setup
4. `PI_SETTINGS_GUIDE.md` — Complete settings reference
5. `PI_PACKAGES_GUIDE.md` — Package system for sharing extensions/skills/themes
6. `PI_CUSTOM_PROVIDER_GUIDE.md` — Custom provider implementation

### Docs That Are Fine (Low Priority)

- `PI_COMPACTION_GUIDE.md` — Very detailed, minor gaps only
- `PI_PROMPT_TEMPLATES_GUIDE.md` — Excellent, exceeds official doc
- `PI_THEMES_GUIDE.md` — Excellent, exceeds official doc
- `PI_SKILLS_GUIDE.md` — Very good, minor gaps only
