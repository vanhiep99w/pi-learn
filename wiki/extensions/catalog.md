# Extensions and theme catalog

Public Pi extension and theme source lives under `packages/pi-learn-extensions/`. The root package and package-level manifest both expose this directory to Pi. This page summarizes what each extension does, where to change it, and what to verify.

## Image Gen (experimental)

Source: `packages/pi-learn-extensions/extensions/image-gen/`; tests: `packages/pi-learn-extensions/tests/image-gen/`

The initial implementation registers tool `image_gen` and command namespace `/image-gen`. It resolves OAuth only through `ctx.modelRegistry.getProviderAuth("openai-codex")`, calls the experimental ChatGPT Codex Responses image tool, validates PNG/JPEG/WebP output, saves images non-destructively through Pi's file mutation queue, writes redacted metadata sidecars, and returns generated images inline.

Implemented command surface:

```txt
/image-gen doctor
/image-gen generate <prompt>
```

Current scope includes subscription generate, explicit reference roles, reference-conditioned edit, and small variant batches with bounded concurrency. The agent is instructed to inspect existing project image conventions and pass a suitable project-relative `outputPath`; without one, output falls back to the current workspace root (`ctx.cwd`). Public API billing fallback, masks, transparency/chroma-key processing, and JSONL batch commands are deliberately unavailable; capability checks fail before generation and no paid fallback can occur in this build.

Change guidance:

- Preserve provider credential resolution through Pi; do not read auth files or log requests containing data URLs.
- Keep credential-bearing fetches pinned to `https://chatgpt.com` with redirects disabled.
- Keep non-overwrite behavior, sidecar redaction, input/output size limits, and backend capability checks deterministic.
- Run `npm --prefix packages/pi-learn-extensions run test:image-gen`, load the entrypoint, then use `/reload` for interactive verification.

## Web tools

Source: `packages/pi-learn-extensions/extensions/web-tools/`

Registered tools:

- `web_search` — searches the web, using Tavily when `TAVILY_API_KEY` is configured and DuckDuckGo otherwise.
- `web_fetch` — fetches URL content, normalizes HTTP to HTTPS, converts GitHub blob URLs to raw content, follows permitted redirects, converts HTML to Markdown unless `raw` is set, and supports pagination by `start_index`/`max_length`.
- `tool_search` — lists/searches tools and slash commands available in the current Pi session.

Implementation notes from source:

- `index.ts` registers the three tools and displays which engine is active on session start.
- `web-search.ts` supports either `query` or batched `queries`, limits batch size to 5, caps results at 10, caches results, and has rendering for single and batch calls.
- `web-fetch.ts` validates and normalizes URLs, uses `curl` via `pi.exec`, limits fetch size/time, avoids automatic cross-host redirects, and caches full fetched content.
- `utils.ts` contains cache, rate-limit, key, URL, and formatting helpers; `parsers.ts` contains result and HTML parsing helpers.

Change guidance:

- Keep `TAVILY_API_KEY` optional and preserve DuckDuckGo fallback.
- Do not log or document actual API keys.
- Preserve safe URL/redirect behavior when extending fetch support.
- If adding tool parameters, update the TypeBox schema and tool descriptions together.

## Harness extension

Source: `packages/pi-learn-extensions/extensions/harness/index.ts`; runtime: `packages/harness-runtime/`

The Harness extension is the single public entrypoint for session observability, improvement workflows, and Harness Wiki repository knowledge. `/harness [last]` combines status and the generated Markdown report in one scrollable dashboard modal. Core parsing/report/proposal behavior is delegated to the runtime API; Wiki orchestration lives in `harness/wiki-commands.ts` and `harness/wiki-prompt.ts`.

Recommended commands include:

```txt
/harness [last]
/harness-improve [last]
/harness-proposals
/harness-apply P-0001
/harness-eval [scenario|P-0001]
/harness-mark success|failure|note [text]

/harness-wiki-init [extra instructions]
/harness-wiki-update [extra instructions]
/harness-wiki-ask <question>
```

In TUI mode, `/harness-proposals` is the only proposal-review workflow. Selecting a proposal opens its details and the approve, reject, or approve-and-apply actions immediately; there is no separate detail action. The detail pane has a fixed viewport: use `↑/↓` for incremental scrolling, `PgUp`/`PgDn` or `Ctrl+U/D` for larger jumps, and `←/→` to change actions. Actions remain visible inside the modal. A proposal with a JSON Patch exposes `Approve & Apply`; an already approved proposal exposes `Apply`. Approve, reject, and apply remain runtime operations invoked by the modal or `/harness-apply`, not separate approve/reject slash commands. Print/JSON mode only prints the proposal list.

The old `/wiki-*` commands and separate `extensions/wiki/` entrypoint are removed. Harness Wiki uses reviewed `wiki/**/_rules.md` prompt rules that the model loads lazily through `AGENTS.md` and `wiki/quickstart.md`.

It also registers the `harness_import_llm_reflection` tool, which is intended for model use after `/harness-improve` queues a reflection prompt. The tool imports JSON proposals into private harness drafts.

See [Harness runtime](../architecture/harness-runtime.md) for the data flow/safety model and [Harness Wiki capability](wiki-extension.md) for documentation, prompt-rule loading, metadata, and no-op behavior.

## ChatGPT usage status

Source: `packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts`

This extension shows ChatGPT Plus/Pro usage when the active provider is `openai-codex` or `chatgpt`.

User commands:

```txt
/chatgpt-login
/chatgpt-usage
/chatgpt-usage-refresh
/chatgpt-accounts
/chatgpt-switch
/chatgpt-delete
/chatgpt-logout
```

Implementation notes from source:

- It listens to `session_start`, `model_select`, `agent_end`, and `session_shutdown`.
- It calls ChatGPT backend usage and OAuth token endpoints.
- It caches usage state for about 60 seconds and keeps a global usage snapshot for UI display.
- It stores account/auth data in local Pi/OpenAI-related files, not in this repository.

Change guidance:

- Never document or read live tokens from local auth/account files.
- Keep provider gating strict so the status is hidden for unrelated providers.
- Preserve shutdown cleanup of timers and UI status/widgets.

## Prompt with model

Source: `packages/pi-learn-extensions/extensions/prompt-with-model.ts`

This extension creates slash commands from Markdown prompt files. It scans:

```txt
~/.pi/agent/model-prompts/*.md
.pi/agent/model-prompts/*.md
```

Supported frontmatter includes:

```yaml
description: "..."
argument-hint: "<input>"
model: "provider/model-id"
thinking: "off|minimal|low|medium|high|xhigh"
```

Important behavior from source:

- Each valid `.md` prompt becomes a slash command named after the file.
- Reserved command names are blocked to avoid collisions with built-in/package commands.
- Prompt commands can temporarily switch model/thinking, run the prompt, and restore the previous state.
- `/prompt-create` uses the current/selected Pi model to generate a reusable prompt spec, then lets the user preview/edit before saving.
- `/prompt-edit` and `/prompt-model` provide management workflows for existing prompts.

Change guidance:

- Keep prompt body placeholder handling conservative; generated prompts should include runtime input via `$@` exactly as expected by the extension.
- Be careful with model registry/auth checks; the extension supports both exact `provider/id` and model-id-only specs.
- Avoid using Pi's core `prompts/` folder for this extension; it intentionally uses `model-prompts/`.

## Aurora UI

Sources:

- `packages/pi-learn-extensions/extensions/aurora-ui.ts`

Aurora customizes the interactive Pi TUI:

- startup banner
- bordered custom editor
- minimal footer showing extension statuses
- Vietnamese working messages for agent/tool activity
- cwd, git branch, and git working-tree stats in the editor border
- `/aurora-themes` command and `ctrl+shift+t` shortcut

Source-level safety patterns to preserve:

- `session_start` returns early when `!ctx.hasUI`.
- Timers, terminal compositor state, and session cleanup callbacks are disposed on footer disposal/session shutdown.
- UI operations are wrapped or guarded because session replacement can make UI references transient.

Change guidance:

- Prefer theme tokens (`theme.fg(...)` and token names) over raw ANSI escape sequences.
- Test in an interactive terminal after changes; fixed input rendering depends on terminal behavior.
- Keep cleanup best-effort and resilient to stale UI contexts.

## Theme: midnight-aurora

Source: `packages/pi-learn-extensions/themes/midnight-aurora.json`

The bundled theme defines the `midnight-aurora` palette and Pi theme color mappings. Important tokens include:

- dark backgrounds: `bg`, `surface`, `surface2`
- accent colors: `auroraCyan`, `auroraSky`, `auroraViolet`, `auroraMint`
- state colors: `auroraGreen`, `gold`, `coral`
- user panel colors: `userPanelBg`, `userPanelText`, `userPanelBorder`

Change guidance:

- Keep `name` stable unless intentionally renaming the theme and updating docs/settings examples.
- If Aurora UI references a semantic color like `accent`, `success`, `warning`, or `dim`, update the theme mapping rather than hard-coding colors in UI code.
