import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const STATUS_ID = "chatgpt-usage";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CACHE_MS = 60_000;
const REFRESH_SKEW_MS = 30_000;
const CHATGPT_PROVIDERS = new Set(["openai-codex", "chatgpt"]);
const GLOBAL_USAGE_KEY = "__piChatGptUsageStatus";

type AuthRecord = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  username?: string;
};

type JwtClaims = {
  chatgpt_account_id?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  nickname?: string;
  organizations?: Array<{ id?: string }>;
  "https://api.openai.com/profile"?: { email?: string; email_verified?: boolean };
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
};

type RawWindow = {
  used_percent?: number | null;
  limit_window_seconds?: number | null;
  reset_at?: number | null;
} | null;

type RawUsagePayload = {
  plan_type?: string | null;
  rate_limit?: {
    primary_window?: RawWindow | null;
    secondary_window?: RawWindow | null;
  } | null;
} | null;

type UsageWindow = {
  label: string;
  used: number;
  remaining: number;
  resetAt?: number;
};

type UsageSnapshot = {
  fetchedAt: number;
  plan: string;
  username?: string;
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
};

type UsageState =
  | { kind: "idle"; fetchedAt: number }
  | { kind: "disabled"; fetchedAt: number; message: string }
  | { kind: "error"; fetchedAt: number; message: string; snapshot?: UsageSnapshot }
  | { kind: "ready"; fetchedAt: number; snapshot: UsageSnapshot };

type GlobalUsageStatus = {
  username?: string;
  fiveHour?: Pick<UsageWindow, "label" | "used" | "remaining" | "resetAt">;
  weekly?: Pick<UsageWindow, "label" | "used" | "remaining" | "resetAt">;
  stale?: boolean;
  updatedAt: number;
};

type LoadedAuth = {
  auth: AuthRecord;
  source: "pi" | "opencode";
  providerKey: string;
};

type StoredChatGptAccount = AuthRecord & {
  accountId: string;
  label?: string;
  addedAt: number;
  lastUsedAt?: number;
};

type StoredAccountsFile = {
  activeAccountId?: string;
  accounts: StoredChatGptAccount[];
};

type AuthPromptCompat = {
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  signal?: AbortSignal;
  options?: ReadonlyArray<{ id: string; label: string; description?: string }>;
};

type AuthEventCompat =
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string }
  | { type: "info"; message: string; links?: ReadonlyArray<{ url: string; label?: string }> }
  | { type: "progress"; message: string };

// One lifetime per extension factory, never reactivated by a later session_start.
// Every async continuation checks this lifetime before touching its command ctx.
class UsageSession {
  readonly lifetime = new AbortController();
  usage = new AbortController();
  cache: UsageState = { kind: "idle", fetchedAt: 0 };
  pending: Promise<UsageState | undefined> | undefined;
  timer: ReturnType<typeof setInterval> | undefined;
  readonly widgetTimers = new Set<ReturnType<typeof setTimeout>>();
  activeIsChatGptProvider = false;

  check() {
    this.lifetime.signal.throwIfAborted();
  }

  // This catches cancellation while work settles, not between this promise's
  // resolution and its caller resuming. Callers must check() in that continuation
  // before accessing ctx, publishing usage, or starting another side effect.
  async wait<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } finally {
      this.check();
    }
  }

  async run(work: () => Promise<void>) {
    if (this.lifetime.signal.aborted) return;
    try {
      await work();
    } catch (error) {
      if (!this.lifetime.signal.aborted) throw error;
    }
  }

  resetUsage() {
    this.usage.abort();
    this.usage = new AbortController();
    this.cache = { kind: "idle", fetchedAt: 0 };
    this.pending = undefined;
  }
}

export default function (pi: ExtensionAPI) {
  const session = new UsageSession();
  const whenActive = (work: (ctx: any) => Promise<void>) => async (_args: unknown, ctx: any) => {
    await session.run(async () => {
      if (!ctx.hasUI) return;
      await work(ctx);
    });
  };

  pi.on("session_start", whenActive(async (ctx) => {
    await session.wait(updateVisibility(session, ctx));
    session.check();
    if (session.timer) return;
    session.timer = setInterval(() => {
      if (session.activeIsChatGptProvider) void session.run(() => refreshGlobalUsage(session, false));
    }, CACHE_MS);
  }));

  pi.on("model_select", whenActive(async (ctx) => {
    await updateVisibility(session, ctx, true);
  }));

  pi.on("agent_end", whenActive(async (ctx) => {
    const isChatGpt = isChatGptProvider(ctx);
    session.activeIsChatGptProvider = isChatGpt;
    if (isChatGpt) await updateStatus(session, ctx, true, isChatGpt);
  }));

  pi.on("session_shutdown", async (_event, ctx) => {
    if (session.lifetime.signal.aborted) return;
    session.lifetime.abort();
    session.resetUsage();
    session.activeIsChatGptProvider = false;
    if (session.timer) clearInterval(session.timer);
    session.timer = undefined;
    for (const timeout of session.widgetTimers) clearTimeout(timeout);
    session.widgetTimers.clear();
    clearGlobalUsage();
    if (!ctx.hasUI) return;
    ctx.ui?.setStatus(STATUS_ID, undefined);
    ctx.ui?.setWidget(STATUS_ID, undefined);
  });

  pi.registerCommand("chatgpt-usage", {
    description: "Hiển thị ChatGPT Plus/Pro usage hiện tại",
    handler: whenActive(async (ctx) => {
      if (!isChatGptProvider(ctx)) {
        ctx.ui.notify("ChatGPT usage chỉ hiện khi model provider là openai-codex/chatgpt.", "info");
        return;
      }
      await showDetails(session, ctx, false);
    }),
  });

  pi.registerCommand("chatgpt-usage-refresh", {
    description: "Refresh ChatGPT Plus/Pro usage",
    handler: whenActive(async (ctx) => {
      if (!isChatGptProvider(ctx)) {
        ctx.ui.notify("Không refresh: provider hiện tại không phải ChatGPT subscription.", "info");
        return;
      }
      await showDetails(session, ctx, true);
    }),
  });

  pi.registerCommand("chatgpt-login", {
    description: "Login thêm một tài khoản ChatGPT Plus/Pro và lưu vào danh sách",
    handler: whenActive((ctx) => loginChatGptAccount(session, pi, ctx)),
  });

  pi.registerCommand("chatgpt-switch", {
    description: "Chuyển sang tài khoản ChatGPT tiếp theo đã lưu",
    handler: whenActive((ctx) => switchChatGptAccount(session, ctx)),
  });

  pi.registerCommand("chatgpt-accounts", {
    description: "Liệt kê các tài khoản ChatGPT đã lưu",
    handler: whenActive((ctx) => showChatGptAccounts(session, ctx)),
  });

  pi.registerCommand("chatgpt-delete", {
    description: "Xoá một hoặc tất cả tài khoản ChatGPT đã lưu",
    handler: whenActive((ctx) => deleteChatGptAccount(session, ctx)),
  });

  pi.registerCommand("chatgpt-logout", {
    description: "Alias của /chatgpt-delete",
    handler: whenActive((ctx) => deleteChatGptAccount(session, ctx)),
  });
}

async function updateVisibility(session: UsageSession, ctx: any, force = false) {
  const ui = ctx.ui;
  const isChatGpt = isChatGptProvider(ctx);
  session.activeIsChatGptProvider = isChatGpt;

  if (!isChatGpt) {
    clearGlobalUsage();
    ui?.setStatus(STATUS_ID, undefined);
    ui?.setWidget(STATUS_ID, undefined);
    return;
  }
  await session.wait(updateStatus(session, ctx, force, isChatGpt, ui));
  session.check();
}

async function updateStatus(session: UsageSession, ctx: any, force = false, isChatGpt = isChatGptProvider(ctx), ui = ctx.ui) {
  if (!isChatGpt) {
    clearGlobalUsage();
    ui?.setStatus(STATUS_ID, undefined);
    ui?.setWidget(STATUS_ID, undefined);
    return;
  }

  const usageSignal = session.usage.signal;
  const state = await session.wait(fetchUsage(session, force));
  session.check();
  if (!state || usageSignal.aborted) return;
  if (!session.activeIsChatGptProvider) {
    clearGlobalUsage();
    return;
  }
  applyUsageState(state);

  // Aurora UI reads the shared state and paints it on the lower input border.
  // Keep the normal footer clean (avoid duplicate status line below editor).
  ui?.setStatus(STATUS_ID, undefined);
  ui?.setWidget(STATUS_ID, undefined);
}

async function refreshGlobalUsage(session: UsageSession, force = false) {
  const usageSignal = session.usage.signal;
  const state = await session.wait(fetchUsage(session, force));
  session.check();
  if (state && !usageSignal.aborted && session.activeIsChatGptProvider) applyUsageState(state);
}

function applyUsageState(state: UsageState) {
  const snapshot = getSnapshot(state);
  if (snapshot) setGlobalUsage(snapshot, state.kind === "error");
  else clearGlobalUsage();
}

async function showDetails(session: UsageSession, ctx: any, force: boolean) {
  const ui = ctx.ui;
  const theme = ui.theme;
  ui.setWidget(STATUS_ID, [theme.fg("dim", "Đang lấy ChatGPT usage…")], { placement: "belowEditor" });
  const usageSignal = session.usage.signal;
  const state = await session.wait(fetchUsage(session, force));
  session.check();
  if (!state || usageSignal.aborted) return;
  applyUsageState(state);
  ui.setStatus(STATUS_ID, undefined);
  ui.setWidget(STATUS_ID, renderDetails(theme, state), { placement: "belowEditor" });
  hideWidgetLater(session, ui);
}

function hideWidgetLater(session: UsageSession, ui: any) {
  session.check();
  const timeout = setTimeout(() => {
    session.widgetTimers.delete(timeout);
    if (!session.lifetime.signal.aborted) ui.setWidget(STATUS_ID, undefined);
  }, 12_000);
  session.widgetTimers.add(timeout);
}

function isChatGptProvider(ctx: any) {
  try {
    const provider = ctx.model?.provider;
    return typeof provider === "string" && CHATGPT_PROVIDERS.has(provider);
  } catch {
    return false;
  }
}

async function fetchUsage(session: UsageSession, force = false): Promise<UsageState | undefined> {
  if (session.pending) return session.pending;
  if (!force && session.cache.kind === "ready" && Date.now() - session.cache.fetchedAt < CACHE_MS) return session.cache;

  const signal = AbortSignal.any([session.lifetime.signal, session.usage.signal]);
  const request = readUsage(signal)
    .catch((error) => {
      if (signal.aborted) return undefined;
      const message = errorMessage(error);
      if (session.cache.kind === "ready") {
        return { kind: "error", fetchedAt: Date.now(), message, snapshot: session.cache.snapshot } satisfies UsageState;
      }
      return { kind: "error", fetchedAt: Date.now(), message } satisfies UsageState;
    })
    .then((state) => {
      // An adapter may finish even after abort. This also guards deduplicated callers.
      if (signal.aborted || !state) return undefined;
      session.cache = state;
      return state;
    })
    .finally(() => {
      if (session.pending === request) session.pending = undefined;
    });
  session.pending = request;
  return request;
}

async function readUsage(signal: AbortSignal): Promise<UsageState> {
  const loaded = await loadChatGptOauth();
  signal.throwIfAborted();
  if (!loaded) {
    return {
      kind: "disabled",
      fetchedAt: Date.now(),
      message: "Không tìm thấy OAuth token cho ChatGPT Plus/Pro. Hãy chạy /chatgpt-login hoặc /login openai-codex.",
    };
  }

  const headers = new Headers({ authorization: `Bearer ${loaded.auth.access}` });
  if (loaded.auth.accountId) headers.set("ChatGPT-Account-Id", loaded.auth.accountId);

  const response = await fetch(USAGE_URL, { method: "GET", headers, signal });
  signal.throwIfAborted();
  if (!response.ok) throw new Error(`usage request failed: ${response.status}`);

  const payload = (await response.json()) as RawUsagePayload;
  signal.throwIfAborted();
  const snapshot = normalizeUsage(payload);
  if (!snapshot) throw new Error("ChatGPT usage windows were not returned");

  return {
    kind: "ready",
    fetchedAt: snapshot.fetchedAt,
    snapshot: { ...snapshot, username: loaded.auth.username },
  };
}

async function loginChatGptAccount(session: UsageSession, pi: ExtensionAPI, ctx: any) {
  ctx.ui.notify("Đang mở trình duyệt để login ChatGPT. Nếu muốn thêm account khác, hãy chọn đúng account trong browser hoặc logout ChatGPT trước.", "info");

  const manualInputController = new AbortController();
  const abortLogin = () => manualInputController.abort();
  session.lifetime.signal.addEventListener("abort", abortLogin, { once: true });

  try {
    const credential = await session.wait(loginProviderOauth(session, pi, ctx, "openai-codex", manualInputController));
    session.check();
    const account = accountFromCredential(credential);
    if (!account) {
      ctx.ui.notify("Login xong nhưng không đọc được credential openai-codex.", "error");
      return;
    }

    await session.wait(upsertStoredAccount(account, true));
    session.check();
    session.resetUsage();
    await session.wait(updateStatus(session, ctx, true));
    session.check();
    ctx.ui.notify(`✓ Đã lưu và chuyển sang ChatGPT account: ${account.username || account.accountId}`, "info");
  } catch (error) {
    if (!session.lifetime.signal.aborted) ctx.ui.notify(`Login ChatGPT lỗi: ${errorMessage(error)}`, "error");
  } finally {
    session.lifetime.signal.removeEventListener("abort", abortLogin);
    manualInputController.abort();
    if (!session.lifetime.signal.aborted) ctx.ui?.setWidget(STATUS_ID, undefined);
  }
}

async function loginProviderOauth(
  session: UsageSession,
  pi: ExtensionAPI,
  ctx: any,
  provider: string,
  controller: AbortController,
): Promise<Partial<AuthRecord> | undefined> {
  const legacyStorage = ctx.modelRegistry?.authStorage;
  if (typeof legacyStorage?.login === "function") {
    await session.wait(legacyStorage.login(provider, {
      onAuth: (info: { url: string; instructions?: string }) => {
        if (!controller.signal.aborted) showAuthUrl(pi, ctx, info.url, info.instructions);
      },
      onDeviceCode: (info: { userCode: string; verificationUri: string }) => {
        if (!controller.signal.aborted) showDeviceCode(pi, ctx, info.userCode, info.verificationUri);
      },
      onPrompt: async (prompt: { message: string; placeholder?: string }) => {
        controller.signal.throwIfAborted();
        const value = await session.wait(ctx.ui.input(prompt.message, prompt.placeholder, { signal: controller.signal }));
        controller.signal.throwIfAborted();
        return value ?? "";
      },
      onManualCodeInput: async () => {
        controller.signal.throwIfAborted();
        const value = await session.wait(ctx.ui.input(
          "Paste redirect URL nếu browser callback không tự hoàn tất:",
          "http://localhost:1455/auth/callback?code=...&state=...",
          { signal: controller.signal },
        ));
        controller.signal.throwIfAborted();
        return value ?? "";
      },
      onSelect: async (prompt: { message: string; options: Array<{ id: string; label: string }> }) => {
        controller.signal.throwIfAborted();
        const labels = prompt.options.map((option) => option.label);
        const selected = await session.wait(ctx.ui.select(prompt.message, labels, { signal: controller.signal }));
        controller.signal.throwIfAborted();
        return prompt.options.find((option) => option.label === selected)?.id;
      },
      onProgress: (message: string) => {
        if (!controller.signal.aborted) ctx.ui.notify(message, "info");
      },
      signal: controller.signal,
    }));
    session.check();
    return readProviderCredential(ctx, provider);
  }

  const runtime = getModelRuntime(ctx);
  if (typeof runtime?.login !== "function") {
    throw new Error("Phiên bản Pi hiện tại không cung cấp API quản lý OAuth tương thích.");
  }

  return runtime.login(provider, "oauth", {
    signal: controller.signal,
    prompt: async (prompt: AuthPromptCompat) => {
      controller.signal.throwIfAborted();
      const signal = prompt.signal ? AbortSignal.any([prompt.signal, controller.signal]) : controller.signal;
      if (prompt.type === "select") {
        const options = prompt.options ?? [];
        const labels = options.map((option) => option.description
          ? `${option.label} — ${option.description}`
          : option.label);
        const selected = await session.wait(ctx.ui.select(prompt.message, labels, { signal }));
        signal.throwIfAborted();
        const index = selected === undefined ? -1 : labels.indexOf(selected);
        if (index < 0) throw new Error("Đã huỷ đăng nhập ChatGPT.");
        return options[index].id;
      }

      const value = await session.wait(ctx.ui.input(prompt.message, prompt.placeholder, { signal }));
      signal.throwIfAborted();
      if (value === undefined) throw new Error("Đã huỷ đăng nhập ChatGPT.");
      return value;
    },
    notify: (event: AuthEventCompat) => {
      if (controller.signal.aborted) return;
      if (event.type === "auth_url") {
        showAuthUrl(pi, ctx, event.url, event.instructions);
      } else if (event.type === "device_code") {
        showDeviceCode(pi, ctx, event.userCode, event.verificationUri);
      } else if (event.type === "progress") {
        ctx.ui.notify(event.message, "info");
      } else {
        const links = event.links?.map((link) => link.label ? `${link.label}: ${link.url}` : link.url) ?? [];
        ctx.ui.setWidget(STATUS_ID, [ctx.ui.theme.fg("muted", event.message), ...links], {
          placement: "belowEditor",
        });
      }
    },
  }) as Promise<Partial<AuthRecord>>;
}

function showAuthUrl(pi: ExtensionAPI, ctx: any, url: string, instructions?: string) {
  ctx.ui.setWidget(STATUS_ID, [
    ctx.ui.theme.fg("accent", "ChatGPT login"),
    ctx.ui.theme.fg("muted", instructions ?? "Mở URL sau để login:"),
    ctx.ui.theme.fg("dim", "Nếu Pi không tự bắt callback, paste full redirect URL/code ở prompt."),
    url,
  ], { placement: "belowEditor" });
  void pi.exec("xdg-open", [url], { timeout: 5_000 }).catch(() => undefined);
}

function showDeviceCode(pi: ExtensionAPI, ctx: any, userCode: string, verificationUri: string) {
  ctx.ui.setWidget(STATUS_ID, [
    ctx.ui.theme.fg("accent", "ChatGPT device login"),
    `${ctx.ui.theme.fg("muted", "Code:")} ${ctx.ui.theme.bold(userCode)}`,
    verificationUri,
  ], { placement: "belowEditor" });
  void pi.exec("xdg-open", [verificationUri], { timeout: 5_000 }).catch(() => undefined);
}

function getModelRuntime(ctx: any): any {
  // Pi 0.80.8+ keeps the mutable credential store on ModelRuntime while
  // extensions still receive the compatibility ModelRegistry facade.
  return ctx.modelRegistry?.runtime;
}

async function readProviderCredential(ctx: any, provider: string): Promise<Partial<AuthRecord> | undefined> {
  const legacyStorage = ctx.modelRegistry?.authStorage;
  if (typeof legacyStorage?.get === "function") {
    return legacyStorage.get(provider) as Partial<AuthRecord> | undefined;
  }

  const runtime = getModelRuntime(ctx);
  if (typeof runtime?.credentials?.read === "function") {
    return await runtime.credentials.read(provider) as Partial<AuthRecord> | undefined;
  }

  return (await readJson(piAuthPath()))[provider] as Partial<AuthRecord> | undefined;
}

async function writeProviderCredential(session: UsageSession, ctx: any, provider: string, credential: AuthRecord) {
  const legacyStorage = ctx.modelRegistry?.authStorage;
  if (typeof legacyStorage?.set === "function") {
    await session.wait(legacyStorage.set(provider, credential));
    session.check();
    return;
  }

  const runtime = getModelRuntime(ctx);
  if (typeof runtime?.credentials?.modify !== "function") {
    throw new Error("Phiên bản Pi hiện tại không cung cấp API đổi ChatGPT account tương thích.");
  }

  await session.wait(runtime.credentials.modify(provider, async () => credential));
  session.check();
  if (typeof runtime.refresh === "function") await session.wait(runtime.refresh({ allowNetwork: false }));
}

async function switchChatGptAccount(session: UsageSession, ctx: any) {
  await session.wait(importCurrentAuthIntoAccounts(session, ctx));
  session.check();

  const store = await session.wait(loadAccountsStore());
  session.check();
  if (store.accounts.length === 0) {
    ctx.ui.notify("Chưa có account nào. Dùng /chatgpt-login để thêm account.", "info");
    return;
  }
  if (store.accounts.length === 1) {
    ctx.ui.notify(`Chỉ có 1 account: ${accountDisplayName(store.accounts[0])}. Dùng /chatgpt-login để thêm account khác.`, "info");
    return;
  }

  const current = accountFromCredential(await session.wait(readProviderCredential(ctx, "openai-codex")));
  session.check();
  const currentId = current?.accountId || store.activeAccountId;
  const currentIndex = Math.max(0, store.accounts.findIndex((account) => account.accountId === currentId));
  const next = store.accounts[(currentIndex + 1) % store.accounts.length];

  await session.wait(activateStoredAccount(session, ctx, next));
  session.check();
  ctx.ui.notify(`↻ ChatGPT account: ${accountDisplayName(next)} (${currentIndex + 2 > store.accounts.length ? 1 : currentIndex + 2}/${store.accounts.length})`, "info");
}

async function showChatGptAccounts(session: UsageSession, ctx: any) {
  await session.wait(importCurrentAuthIntoAccounts(session, ctx));
  session.check();
  const store = await session.wait(loadAccountsStore());
  session.check();
  const active = accountFromCredential(await session.wait(readProviderCredential(ctx, "openai-codex")));
  session.check();
  const activeId = active?.accountId || store.activeAccountId;

  if (store.accounts.length === 0) {
    ctx.ui.notify("Chưa có account nào. Dùng /chatgpt-login để thêm account.", "info");
    return;
  }

  const lines = [ctx.ui.theme.fg("accent", ctx.ui.theme.bold("ChatGPT accounts"))];
  store.accounts.forEach((account, index) => {
    const marker = account.accountId === activeId ? "●" : "○";
    lines.push(`${ctx.ui.theme.fg(account.accountId === activeId ? "success" : "muted", marker)} ${index + 1}. ${accountDisplayName(account)}`);
  });
  lines.push(ctx.ui.theme.fg("dim", "Dùng /chatgpt-switch để chuyển account, /chatgpt-delete để xoá account."));
  const ui = ctx.ui;
  ui.setWidget(STATUS_ID, lines, { placement: "belowEditor" });
  hideWidgetLater(session, ui);
}

async function deleteChatGptAccount(session: UsageSession, ctx: any) {
  await session.wait(importCurrentAuthIntoAccounts(session, ctx));
  session.check();
  const store = await session.wait(loadAccountsStore());
  session.check();
  const active = accountFromCredential(await session.wait(readProviderCredential(ctx, "openai-codex")));
  session.check();
  const activeId = active?.accountId || store.activeAccountId;

  if (store.accounts.length === 0) {
    ctx.ui.notify("Chưa có account nào để xoá.", "info");
    return;
  }

  const allChoice = "Xoá tất cả accounts";
  const choices = [
    ...store.accounts.map((account, index) => {
      const marker = account.accountId === activeId ? "●" : "○";
      return `${marker} ${index + 1}. ${accountDisplayName(account)}`;
    }),
    allChoice,
  ];

  const chosen = await session.wait(ctx.ui.select("Chọn ChatGPT account cần xoá:", choices, { signal: session.lifetime.signal }));
  session.check();
  if (!chosen) return;

  const confirm = await session.wait(ctx.ui.select(
    chosen === allChoice ? "Xác nhận xoá tất cả ChatGPT accounts đã lưu?" : `Xác nhận xoá ${chosen}?`,
    ["Không", "Có"],
    { signal: session.lifetime.signal },
  ));
  session.check();
  if (confirm !== "Có") return;

  if (chosen === allChoice) {
    await session.wait(clearStoredAccounts());
    session.check();
    await session.wait(removeProviderCredential(session, ctx, "openai-codex"));
    session.check();
    await session.wait(removeProviderCredential(session, ctx, "chatgpt"));
    session.check();
    session.resetUsage();
    clearGlobalUsage();
    ctx.ui?.setStatus(STATUS_ID, undefined);
    ctx.ui?.setWidget(STATUS_ID, undefined);
    ctx.ui.notify("✓ Đã xoá tất cả ChatGPT accounts đã lưu.", "info");
    return;
  }

  const selectedIndex = choices.indexOf(chosen);
  const selected = store.accounts[selectedIndex];
  if (!selected) return;

  const deletedWasActive = selected.accountId === activeId;
  const remaining = await session.wait(removeStoredAccount(selected.accountId));
  session.check();

  if (deletedWasActive) {
    const next = remaining.accounts[0];
    if (next) {
      await session.wait(activateStoredAccount(session, ctx, next));
      session.check();
      ctx.ui.notify(`✓ Đã xoá ${accountDisplayName(selected)}. Active account mới: ${accountDisplayName(next)}.`, "info");
    } else {
      await session.wait(removeProviderCredential(session, ctx, "openai-codex"));
      session.check();
      await session.wait(removeProviderCredential(session, ctx, "chatgpt"));
      session.check();
      session.resetUsage();
      clearGlobalUsage();
      ctx.ui.notify(`✓ Đã xoá ${accountDisplayName(selected)}. Không còn ChatGPT account nào đã lưu.`, "info");
    }
  } else {
    session.resetUsage();
    ctx.ui.notify(`✓ Đã xoá ${accountDisplayName(selected)}.`, "info");
  }
}

async function activateStoredAccount(session: UsageSession, ctx: any, account: StoredChatGptAccount) {
  const fresh = await session.wait(ensureFreshStoredAccount(account));
  session.check();
  await session.wait(writeProviderCredential(session, ctx, "openai-codex", {
    type: "oauth",
    access: fresh.access,
    refresh: fresh.refresh,
    expires: fresh.expires,
    accountId: fresh.accountId,
    username: fresh.username,
  }));
  session.check();

  await session.wait(markActiveAccount(fresh.accountId));
  session.check();
  session.resetUsage();
  await session.wait(updateStatus(session, ctx, true));
  session.check();
}

async function loadChatGptOauth(): Promise<LoadedAuth | undefined> {
  const piStore = await readJson(piAuthPath());
  const piRaw = piStore["openai-codex"];
  const piAuth = normalizeAuth(piRaw, "openai-codex");
  if (piAuth) return ensureFreshAuth(piAuth, "pi", "openai-codex", piAuthPath());

  const chatGptRaw = piStore["chatgpt"];
  const chatGptAuth = normalizeAuth(chatGptRaw, "chatgpt");
  if (chatGptAuth) return ensureFreshAuth(chatGptAuth, "pi", "chatgpt", piAuthPath());

  // Fallback hữu ích nếu user đã login ChatGPT trong OpenCode plugin trước đó.
  const openCodeStore = await readJson(openCodeAuthPath());
  const openCodeAuth = normalizeAuth(openCodeStore.openai, "openai");
  if (openCodeAuth) return ensureFreshAuth(openCodeAuth, "opencode", "openai", openCodeAuthPath());

  return undefined;
}

function normalizeAuth(raw: unknown, providerKey: string): LoadedAuth | undefined {
  if (!raw || typeof raw !== "object") return;
  const value = raw as Partial<AuthRecord> & { type?: string };
  if (value.type !== "oauth" || !value.access || !value.refresh) return;

  return {
    source: providerKey === "openai" ? "opencode" : "pi",
    providerKey,
    auth: {
      type: "oauth",
      access: value.access,
      refresh: value.refresh,
      expires: typeof value.expires === "number" ? value.expires : 0,
      accountId: value.accountId || extractAccountId(value.access),
      username: value.username || extractUsername(value.access),
    },
  };
}

async function ensureFreshAuth(
  loaded: LoadedAuth,
  source: LoadedAuth["source"],
  providerKey: string,
  storePath: string,
): Promise<LoadedAuth> {
  loaded.source = source;
  loaded.providerKey = providerKey;

  if (loaded.auth.expires > Date.now() + REFRESH_SKEW_MS) return loaded;

  const refreshed = await refreshAccessToken(loaded.auth.refresh);
  const next: AuthRecord = {
    type: "oauth",
    access: refreshed.access,
    refresh: refreshed.refresh,
    expires: refreshed.expires,
    accountId: refreshed.accountId || loaded.auth.accountId,
    username: extractUsername(refreshed.access) || loaded.auth.username,
  };

  await mergeJsonLocked(storePath, { [providerKey]: { ...next } });

  if (providerKey !== "openai" && next.accountId) {
    await upsertStoredAccount(toStoredAccount(next), false);
  }

  return { source, providerKey, auth: next };
}

function accountFromCredential(credential: Partial<AuthRecord> | undefined): StoredChatGptAccount | undefined {
  if (!credential || credential.type !== "oauth" || !credential.access || !credential.refresh) return;
  const accountId = credential.accountId || extractAccountId(credential.access);
  if (!accountId) return;
  return toStoredAccount({
    type: "oauth",
    access: credential.access,
    refresh: credential.refresh,
    expires: typeof credential.expires === "number" ? credential.expires : 0,
    accountId,
    username: credential.username || extractUsername(credential.access),
  });
}

function toStoredAccount(auth: AuthRecord): StoredChatGptAccount {
  const accountId = auth.accountId || extractAccountId(auth.access) || "unknown";
  return {
    ...auth,
    accountId,
    username: auth.username || extractUsername(auth.access),
    addedAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

async function importCurrentAuthIntoAccounts(session: UsageSession, ctx: any) {
  const current = accountFromCredential(await session.wait(readProviderCredential(ctx, "openai-codex")));
  session.check();
  if (current) await session.wait(upsertStoredAccount(current, true));
}

async function upsertStoredAccount(account: StoredChatGptAccount, makeActive: boolean) {
  await updateAccountsStoreLocked((store) => {
    const index = store.accounts.findIndex((item) => item.accountId === account.accountId);
    const previous = index >= 0 ? store.accounts[index] : undefined;
    const next: StoredChatGptAccount = {
      ...previous,
      ...account,
      addedAt: previous?.addedAt ?? account.addedAt ?? Date.now(),
      lastUsedAt: makeActive ? Date.now() : previous?.lastUsedAt,
    };

    if (index >= 0) store.accounts[index] = next;
    else store.accounts.push(next);
    if (makeActive) store.activeAccountId = next.accountId;
  });
}

async function markActiveAccount(accountId: string) {
  await updateAccountsStoreLocked((store) => {
    store.activeAccountId = accountId;
    const account = store.accounts.find((item) => item.accountId === accountId);
    if (account) account.lastUsedAt = Date.now();
  });
}

async function removeStoredAccount(accountId: string): Promise<StoredAccountsFile> {
  let nextStore: StoredAccountsFile = { accounts: [] };
  await updateAccountsStoreLocked((store) => {
    store.accounts = store.accounts.filter((item) => item.accountId !== accountId);
    if (store.activeAccountId === accountId) store.activeAccountId = store.accounts[0]?.accountId;
    nextStore = {
      activeAccountId: store.activeAccountId,
      accounts: [...store.accounts],
    };
  });
  return nextStore;
}

async function clearStoredAccounts() {
  await updateAccountsStoreLocked((store) => {
    store.activeAccountId = undefined;
    store.accounts = [];
  });
}

async function removeProviderCredential(session: UsageSession, ctx: any, provider: string) {
  const legacyStorage = ctx.modelRegistry?.authStorage;
  if (legacyStorage) {
    if (typeof legacyStorage.remove === "function") await session.wait(legacyStorage.remove(provider));
    else if (typeof legacyStorage.logout === "function") await session.wait(legacyStorage.logout(provider));
    return;
  }

  const runtime = getModelRuntime(ctx);
  if (typeof runtime?.credentials?.delete !== "function") return;
  await session.wait(runtime.credentials.delete(provider));
  session.check();
  if (typeof runtime.refresh === "function") await session.wait(runtime.refresh({ allowNetwork: false }));
}

async function ensureFreshStoredAccount(account: StoredChatGptAccount): Promise<StoredChatGptAccount> {
  if (account.expires > Date.now() + REFRESH_SKEW_MS) return account;

  const refreshed = await refreshAccessToken(account.refresh);
  const next: StoredChatGptAccount = {
    ...account,
    access: refreshed.access,
    refresh: refreshed.refresh,
    expires: refreshed.expires,
    accountId: refreshed.accountId || account.accountId,
    username: extractUsername(refreshed.access) || account.username,
    lastUsedAt: Date.now(),
  };
  await upsertStoredAccount(next, true);
  return next;
}

async function loadAccountsStore(): Promise<StoredAccountsFile> {
  const raw = await readJson(accountsPath());
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  return {
    activeAccountId: typeof raw.activeAccountId === "string" ? raw.activeAccountId : undefined,
    accounts: accounts
      .map((item) => accountFromStoredValue(item))
      .filter((item): item is StoredChatGptAccount => Boolean(item)),
  };
}

function accountFromStoredValue(value: unknown): StoredChatGptAccount | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Partial<StoredChatGptAccount>;
  if (item.type !== "oauth" || !item.access || !item.refresh || !item.accountId) return;
  return {
    type: "oauth",
    access: item.access,
    refresh: item.refresh,
    expires: typeof item.expires === "number" ? item.expires : 0,
    accountId: item.accountId,
    username: item.username || extractUsername(item.access),
    label: item.label,
    addedAt: typeof item.addedAt === "number" ? item.addedAt : Date.now(),
    lastUsedAt: typeof item.lastUsedAt === "number" ? item.lastUsedAt : undefined,
  };
}

async function updateAccountsStoreLocked(mutator: (store: StoredAccountsFile) => void) {
  const file = accountsPath();
  await withFileLock(file, async () => {
    const raw = await readJson(file);
    const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
    const store: StoredAccountsFile = {
      activeAccountId: typeof raw.activeAccountId === "string" ? raw.activeAccountId : undefined,
      accounts: accounts
        .map((item) => accountFromStoredValue(item))
        .filter((item): item is StoredChatGptAccount => Boolean(item)),
    };
    mutator(store);
    await fs.writeFile(file, JSON.stringify(store, null, 2), { mode: 0o600 });
    await fs.chmod(file, 0o600).catch(() => undefined);
  });
}

function accountDisplayName(account: StoredChatGptAccount) {
  return account.label || account.username || account.accountId;
}

async function refreshAccessToken(refreshToken: string): Promise<Omit<AuthRecord, "type" | "username">> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`token refresh failed: ${response.status}${text ? ` ${text}` : ""}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error("token refresh response missing access_token/refresh_token/expires_in");
  }

  const accountId = extractAccountId(json.access_token);
  if (!accountId) throw new Error("failed to extract ChatGPT account id from refreshed token");

  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function mergeJsonLocked(file: string, patch: Record<string, unknown>) {
  await withFileLock(file, async () => {
    const current = await readJson(file);
    await fs.writeFile(file, JSON.stringify({ ...current, ...patch }, null, 2), { mode: 0o600 });
    await fs.chmod(file, 0o600).catch(() => undefined);
  });
}

async function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      break;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await removeStaleLock(lockPath, 30_000);
      await sleep(50);
    }
  }

  if (!handle) throw new Error(`Timed out acquiring lock: ${lockPath}`);

  try {
    return await fn();
  } finally {
    await handle.close().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

async function removeStaleLock(lockPath: string, staleMs: number) {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) await fs.unlink(lockPath);
  } catch {
    // Lock disappeared or cannot be inspected; retry loop will handle it.
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function piAuthPath() {
  return path.join(os.homedir(), ".pi", "agent", "auth.json");
}

function accountsPath() {
  return path.join(os.homedir(), ".pi", "agent", "chatgpt-usage-accounts.json");
}

function openCodeAuthPath() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "auth.json");
}

function parseJwtClaims(token: string | undefined): JwtClaims | undefined {
  if (!token) return;
  const parts = token.split(".");
  if (parts.length !== 3) return;

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as JwtClaims;
  } catch {
    return;
  }
}

function extractAccountId(token: string | undefined) {
  const claims = parseJwtClaims(token);
  return (
    claims?.chatgpt_account_id ||
    claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims?.organizations?.[0]?.id
  );
}

function extractUsername(token: string | undefined) {
  const claims = parseJwtClaims(token);
  return (
    claims?.preferred_username ||
    claims?.email ||
    claims?.["https://api.openai.com/profile"]?.email ||
    claims?.name ||
    claims?.nickname
  );
}

function normalizeUsage(payload: RawUsagePayload): UsageSnapshot | undefined {
  const rateLimit = payload?.rate_limit;
  const fiveHour = normalizeWindow(rateLimit?.primary_window ?? undefined, "5h");
  const weekly = normalizeWindow(rateLimit?.secondary_window ?? undefined, "weekly");
  if (!fiveHour && !weekly) return;

  return {
    fetchedAt: Date.now(),
    plan: formatPlanLabel(payload?.plan_type),
    fiveHour,
    weekly,
  };
}

function normalizeWindow(window: RawWindow | undefined, fallback: string): UsageWindow | undefined {
  if (!window || typeof window !== "object") return;
  const used = typeof window.used_percent === "number" ? clampPercent(window.used_percent) : undefined;
  if (used === undefined) return;

  const seconds = typeof window.limit_window_seconds === "number" ? window.limit_window_seconds : undefined;
  const resetAt = typeof window.reset_at === "number" ? window.reset_at : undefined;

  return {
    label: formatWindowLabel(seconds, fallback),
    used,
    remaining: clampPercent(100 - used),
    resetAt,
  };
}

function getSnapshot(state: UsageState): UsageSnapshot | undefined {
  return "snapshot" in state ? state.snapshot : undefined;
}

function setGlobalUsage(snapshot: UsageSnapshot, stale = false) {
  (globalThis as any)[GLOBAL_USAGE_KEY] = {
    username: snapshot.username,
    fiveHour: snapshot.fiveHour,
    weekly: snapshot.weekly,
    stale,
    updatedAt: snapshot.fetchedAt,
  } satisfies GlobalUsageStatus;
}

function clearGlobalUsage() {
  delete (globalThis as any)[GLOBAL_USAGE_KEY];
}

function renderDetails(t: any, state: UsageState): string[] {
  const border = t.fg("borderAccent", "─".repeat(44));
  const lines = [border, t.fg("accent", t.bold("ChatGPT Plus/Pro usage"))];

  if (state.kind === "disabled") {
    lines.push(t.fg("muted", state.message));
    lines.push(border);
    return lines;
  }

  const snapshot = getSnapshot(state);
  if (state.kind === "error" && !snapshot) {
    lines.push(t.fg("error", state.message));
    lines.push(border);
    return lines;
  }


  if (!snapshot) {
    lines.push(t.fg("muted", "Loading…"));
    lines.push(border);
    return lines;
  }

  lines.push(`${t.fg("muted", "Plan:")} ${snapshot.plan}`);
  if (snapshot.username) lines.push(`${t.fg("muted", "User:")} ${snapshot.username}`);
  if (snapshot.fiveHour) lines.push(...formatWindowDetails(t, snapshot.fiveHour));
  if (snapshot.weekly) lines.push(...formatWindowDetails(t, snapshot.weekly));
  lines.push(`${t.fg("muted", "Updated:")} ${formatTimestamp(snapshot.fetchedAt)}`);
  if (state.kind === "error") lines.push(t.fg("warning", `Đang hiện cache. Refresh lỗi: ${state.message}`));
  lines.push(border);
  return lines;
}

function formatWindowDetails(t: any, window: UsageWindow) {
  return [
    `${t.fg("muted", `${window.label} usage:`)} ${window.used}% used (${window.remaining}% left)`,
    `${t.fg("muted", `${window.label} reset:`)} ${formatReset(window.resetAt, true)}`,
  ];
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatWindowLabel(seconds: number | undefined, fallback: string) {
  if (!seconds || seconds <= 0) return fallback;
  if (seconds === 5 * 60 * 60) return "5h";
  if (seconds === 7 * 24 * 60 * 60) return "weekly";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatPlanLabel(value: string | null | undefined) {
  if (!value) return "ChatGPT";
  if (value === "prolite") return "Pro Lite";
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compactUsername(value: string | undefined, max = 14) {
  if (!value) return;
  const base = value.includes("@") ? value.split("@")[0] : value.trim().split(/\s+/)[0];
  if (!base) return;
  if (base.length <= max) return base;
  return `${base.slice(0, max - 1)}…`;
}

function formatReset(resetAt: number | undefined, verbose = false) {
  if (!resetAt) return verbose ? "unknown" : "?";
  const delta = resetAt * 1000 - Date.now();
  if (delta <= 0) return verbose ? "soon" : "soon";
  return verbose ? `in ${formatDuration(delta)}` : formatDuration(delta);
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h${minutes}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d${restHours}h` : `${days}d`;
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
