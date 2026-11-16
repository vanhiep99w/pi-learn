import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import test from "node:test";

const STATUS = "__piChatGptUsageStatus";
const ROOT = "/virtual/chatgpt-lifecycle";
const ACCOUNT_FILE = `${ROOT}/.pi/agent/chatgpt-usage-accounts.json`;
const AUTH_FILE = `${ROOT}/.pi/agent/auth.json`;
const staleMessage = "This extension ctx is stale after session replacement or reload.";
let fixtureId = 0;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function account(id) {
  return {
    type: "oauth", access: `fixture-access-${id}`, refresh: `fixture-refresh-${id}`,
    expires: Date.now() + 3_600_000, accountId: id, username: `${id}@example.invalid`, addedAt: 1,
  };
}

// Entirely synthetic stores and network: never open user auth/settings/sessions.
async function fixture(t, { adapter = "runtime", accounts = [account("a"), account("b")], provider = "openai-codex" } = {}) {
  const files = new Map([
    [ACCOUNT_FILE, JSON.stringify({ activeAccountId: accounts[0]?.accountId, accounts })],
    [AUTH_FILE, JSON.stringify({ "openai-codex": accounts[0] })],
  ]);
  const credentials = new Map([["openai-codex", accounts[0]], ["chatgpt", accounts[0]]]);
  const missing = () => Object.assign(new Error("missing fixture file"), { code: "ENOENT" });
  const validPath = (file) => assert.ok(String(file).startsWith(`${ROOT}/`), `Unexpected filesystem access: ${file}`);
  t.mock.method(os, "homedir", () => ROOT);
  t.mock.method(fs, "readFile", async (file) => {
    validPath(file);
    if (!files.has(file)) throw missing();
    return files.get(file);
  });
  t.mock.method(fs, "writeFile", async (file, value) => { validPath(file); files.set(file, value); });
  t.mock.method(fs, "mkdir", async (file) => { validPath(file); });
  t.mock.method(fs, "chmod", async (file) => { validPath(file); });
  t.mock.method(fs, "open", async (file) => {
    validPath(file);
    return { writeFile: async () => {}, close: async () => {} };
  });
  t.mock.method(fs, "unlink", async (file) => { validPath(file); });
  const fetches = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    fetches.push({ url, options });
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    return { ok: true, json: async () => ({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 23 } } }) };
  });
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const { default: extension } = await import(`../../extensions/chatgpt-usage-status/index.ts?fixture=${++fixtureId}`);
  const notifications = [], mutations = [], widgets = new Map();
  const runtime = {
    credentials: {
      read: async (key) => credentials.get(key),
      modify: async (key, fn) => {
        const value = await fn(credentials.get(key));
        credentials.set(key, value);
        files.set(AUTH_FILE, JSON.stringify(Object.fromEntries(credentials)));
        mutations.push(["set", key]);
      },
      delete: async (key) => {
        credentials.delete(key);
        files.set(AUTH_FILE, JSON.stringify(Object.fromEntries(credentials)));
        mutations.push(["delete", key]);
      },
    },
    refresh: async (options) => { assert.equal(options.allowNetwork, false); },
    login: async () => {
      const value = account("c");
      credentials.set("openai-codex", value);
      files.set(AUTH_FILE, JSON.stringify(Object.fromEntries(credentials)));
      return value;
    },
  };
  const legacy = {
    get: runtime.credentials.read,
    set: async (key, value) => runtime.credentials.modify(key, async () => value),
    remove: runtime.credentials.delete,
    login: async () => { await runtime.login(); },
  };
  const instances = [];
  function spawn() {
    let stale = false;
    const staleAccesses = [], commands = new Map(), events = new Map();
    const ui = {
      theme: { fg: (_color, value) => value, bold: (value) => value },
      notify: (...args) => notifications.push(args),
      setStatus: () => {},
      setWidget: (key, value) => widgets.set(key, value),
      select: async (_title, choices) => choices[0],
      input: async () => "fixture-code",
    };
    const ctx = new Proxy({
      hasUI: true, ui, model: { provider },
      modelRegistry: adapter === "runtime" ? { runtime } : { authStorage: legacy },
    }, {
      get(target, key) {
        if (stale) { staleAccesses.push(key); throw new Error(staleMessage); }
        return target[key];
      },
    });
    extension({
      on: (name, fn) => events.set(name, fn),
      registerCommand: (name, options) => commands.set(name, options.handler),
      exec: async () => { if (stale) throw new Error(staleMessage); return { code: 0 }; },
    });
    const instance = {
      ctx, ui, commands, events, staleAccesses,
      start: () => events.get("session_start")({ reason: "startup" }, ctx),
      stop: async (reason = "reload") => {
        if (stale) return;
        await events.get("session_shutdown")({ reason }, ctx);
        stale = true;
      },
      run: (command) => commands.get(command)("", ctx),
    };
    instances.push(instance);
    return instance;
  }
  const current = spawn();
  t.after(async () => {
    for (const instance of instances) await instance.stop();
    delete globalThis[STATUS];
  });
  return {
    ...current, spawn, files, credentials, runtime, legacy, notifications, mutations, fetches, widgets,
    store: () => JSON.parse(files.get(ACCOUNT_FILE)),
  };
}

for (const command of ["chatgpt-delete", "chatgpt-logout"]) {
  for (const reason of ["reload", "new", "resume", "fork"]) {
    test(`${command}: shutdown (${reason}) while picker is open retires the command`, async (t) => {
      const f = await fixture(t);
      const entered = deferred(), answer = deferred();
      f.ui.select = async () => { entered.resolve(); return answer.promise; };
      const run = f.run(command);
      await entered.promise;
      await f.stop(reason);
      answer.resolve("Xoá tất cả accounts");
      await assert.doesNotReject(run);
      assert.deepEqual(f.staleAccesses, []);
      assert.deepEqual(f.mutations, []);
      assert.equal(f.store().accounts.length, 2);
    });
  }
}

for (const adapter of ["runtime", "legacy"]) {
  test(`${adapter}: delete all removes both provider credentials and clears usage`, async (t) => {
    const f = await fixture(t, { adapter });
    await f.start();
    assert.ok(globalThis[STATUS]);
    f.ui.select = async (_title, choices) => choices.includes("Có") ? "Có" : "Xoá tất cả accounts";
    await f.run("chatgpt-delete");
    assert.equal(f.store().accounts.length, 0);
    assert.equal(f.store().activeAccountId, undefined);
    assert.equal(f.credentials.size, 0);
    assert.equal(globalThis[STATUS], undefined);
    assert.match(f.notifications.at(-1)[0], /Đã xoá tất cả/);
  });

  test(`${adapter}: delete active activates remaining account, switch cycles, login persists`, async (t) => {
    const f = await fixture(t, { adapter });
    await f.start();
    await f.run("chatgpt-switch");
    assert.equal(f.credentials.get("openai-codex").accountId, "b");
    assert.equal(f.store().activeAccountId, "b");
    assert.equal(globalThis[STATUS].username, "b@example.invalid");
    f.ui.select = async (_title, choices) => choices.includes("Có") ? "Có" : choices[1];
    await f.run("chatgpt-delete");
    assert.deepEqual(f.store().accounts.map((a) => a.accountId), ["a"]);
    assert.equal(f.credentials.get("openai-codex").accountId, "a");
    await f.run("chatgpt-login");
    assert.equal(f.store().activeAccountId, "c");
    assert.equal(f.credentials.get("openai-codex").accountId, "c");
    assert.equal(globalThis[STATUS].username, "c@example.invalid");
  });
}

test("switch: shutdown during credential write does not access retired ctx", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), done = deferred();
  f.runtime.credentials.modify = async () => { entered.resolve(); await done.promise; };
  const run = f.run("chatgpt-switch");
  await entered.promise;
  await f.stop();
  done.resolve();
  await assert.doesNotReject(run);
  assert.deepEqual(f.staleAccesses, []);
});

test("login: shutdown cancels OAuth and skips retired catch/finally UI", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), done = deferred();
  let signal;
  f.runtime.login = async (_provider, _type, interaction) => {
    signal = interaction.signal;
    entered.resolve();
    await done.promise;
    throw new Error("fixture OAuth cancelled");
  };
  const run = f.run("chatgpt-login");
  await entered.promise;
  await f.stop();
  done.resolve();
  await assert.doesNotReject(run);
  assert.equal(signal.aborted, true);
  assert.deepEqual(f.staleAccesses, []);
  assert.equal(f.store().accounts.length, 2);
});

for (const command of ["chatgpt-delete", "chatgpt-logout"]) {
  test(`${command}: shutdown during confirmation does not delete`, async (t) => {
    const f = await fixture(t);
    const entered = deferred(), done = deferred();
    let calls = 0;
    f.ui.select = async () => {
      if (calls++ === 0) return "Xoá tất cả accounts";
      entered.resolve();
      return done.promise;
    };
    const run = f.run(command);
    await entered.promise;
    await f.stop();
    done.resolve("Có");
    await run;
    assert.deepEqual(f.staleAccesses, []);
    assert.deepEqual(f.mutations, []);
    assert.equal(f.store().accounts.length, 2);
  });
}

for (const adapter of ["runtime", "legacy"]) {
  test(`${adapter}: shutdown during provider removal skips next ctx-bound deletion`, async (t) => {
    const f = await fixture(t, { adapter });
    f.ui.select = async (_title, choices) => choices.includes("Có") ? "Có" : "Xoá tất cả accounts";
    const entered = deferred(), done = deferred();
    const remove = async (key) => { f.mutations.push(["started", key]); entered.resolve(); await done.promise; };
    f.runtime.credentials.delete = remove;
    f.legacy.remove = remove;
    const run = f.run("chatgpt-delete");
    await entered.promise;
    await f.stop();
    done.resolve();
    await run;
    assert.deepEqual(f.staleAccesses, []);
    assert.deepEqual(f.mutations, [["started", "openai-codex"]]);
  });
}

for (const choose of ["inactive", "last", "cancel-picker", "cancel-confirm"]) {
  test(`delete ${choose} retains credential/account semantics`, async (t) => {
    const f = await fixture(t, { accounts: choose === "last" ? [account("a")] : undefined });
    await f.start();
    f.ui.select = async (_title, choices) => {
      if (choices.includes("Có")) return choose === "cancel-confirm" ? "Không" : "Có";
      if (choose === "cancel-picker") return undefined;
      return choose === "inactive" ? choices[1] : choices[0];
    };
    await f.run("chatgpt-logout");
    if (choose === "last") {
      assert.equal(f.credentials.size, 0);
      assert.equal(f.store().accounts.length, 0);
      assert.equal(globalThis[STATUS], undefined);
    } else {
      assert.equal(f.credentials.get("openai-codex").accountId, "a");
      assert.equal(f.store().accounts.length, choose === "inactive" ? 1 : 2);
      assert.deepEqual(f.mutations, []);
    }
  });
}

for (const command of ["chatgpt-delete", "chatgpt-switch", "chatgpt-login"]) {
  test(`${command}: headless handlers never access UI or credentials`, async (t) => {
    const f = await fixture(t);
    const ctx = { hasUI: false, get ui() { throw new Error("headless UI access"); }, get modelRegistry() { throw new Error("headless credential access"); } };
    await f.commands.get(command)("", ctx);
    await f.events.get("session_shutdown")({ reason: "reload" }, ctx);
    assert.deepEqual(f.notifications, []);
    assert.deepEqual(f.mutations, []);
  });
}

test("replacement instance remains usable and retired commands cannot reactivate", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), done = deferred();
  f.ui.select = async () => { entered.resolve(); return done.promise; };
  const oldRun = f.run("chatgpt-delete");
  await entered.promise;
  await f.stop();
  const next = f.spawn();
  await next.start();
  await next.run("chatgpt-switch");
  assert.equal(globalThis[STATUS].username, "b@example.invalid");
  done.resolve("Xoá tất cả accounts");
  await oldRun;
  await f.run("chatgpt-login");
  assert.deepEqual(f.staleAccesses, []);
  assert.equal(f.store().activeAccountId, "b");
  assert.equal(globalThis[STATUS].username, "b@example.invalid");
});

test("late usage response after shutdown cannot overwrite replacement usage or widgets", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), response = deferred();
  let first = true, oldSignal;
  globalThis.fetch = async (_url, options) => {
    if (first) { first = false; oldSignal = options.signal; entered.resolve(); return response.promise; }
    return { ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 42 } } }) };
  };
  const oldStart = f.start();
  await entered.promise;
  await f.stop();
  assert.equal(oldSignal.aborted, true);
  const next = f.spawn();
  await next.start();
  assert.equal(globalThis[STATUS].fiveHour.used, 42);
  response.resolve({ ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 99 } } }) });
  await oldStart;
  assert.equal(globalThis[STATUS].fiveHour.used, 42);
  assert.deepEqual(f.staleAccesses, []);
  await next.run("chatgpt-accounts");
  const nextWidget = f.widgets.get("chatgpt-usage");
  t.mock.timers.tick(12_000);
  assert.equal(f.widgets.get("chatgpt-usage"), undefined);
  assert.ok(nextWidget);
});

test("account switch does not deduplicate against old account's pending usage", async (t) => {
  const f = await fixture(t);
  await f.start();
  const entered = deferred(), response = deferred();
  let oldSignal;
  globalThis.fetch = async (_url, options) => {
    if (options.headers.get("ChatGPT-Account-Id") === "a") {
      oldSignal = options.signal; entered.resolve(); return response.promise;
    }
    return { ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 42 } } }) };
  };
  const pending = f.run("chatgpt-usage-refresh");
  await entered.promise;
  const deduplicated = f.run("chatgpt-usage-refresh");
  await f.run("chatgpt-switch");
  assert.equal(oldSignal.aborted, true);
  assert.equal(globalThis[STATUS].username, "b@example.invalid");
  response.resolve({ ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 99 } } }) });
  await Promise.all([pending, deduplicated]);
  assert.equal(globalThis[STATUS].username, "b@example.invalid");
  assert.equal(globalThis[STATUS].fiveHour.used, 42);
});

test("delete all invalidates in-flight usage so it cannot republish a removed account", async (t) => {
  const f = await fixture(t);
  await f.start();
  const entered = deferred(), response = deferred();
  globalThis.fetch = async () => { entered.resolve(); return response.promise; };
  const pending = f.run("chatgpt-usage-refresh");
  await entered.promise;
  f.ui.select = async (_title, choices) => choices.includes("Có") ? "Có" : "Xoá tất cả accounts";
  await f.run("chatgpt-delete");
  response.resolve({ ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 99 } } }) });
  await pending;
  assert.equal(globalThis[STATUS], undefined);
  assert.equal(f.store().accounts.length, 0);
});

test("usage ready cache, force refresh and stale-on-error behavior is retained", async (t) => {
  const f = await fixture(t);
  await f.start();
  const count = f.fetches.length;
  await f.run("chatgpt-usage");
  assert.equal(f.fetches.length, count);
  await f.run("chatgpt-usage-refresh");
  assert.equal(f.fetches.length, count + 1);
  globalThis.fetch = async () => { throw new Error("fixture network failure"); };
  await f.run("chatgpt-usage-refresh");
  assert.equal(globalThis[STATUS].stale, true);
  assert.equal(globalThis[STATUS].fiveHour.used, 23);
  await f.run("chatgpt-usage-refresh");
  assert.equal(globalThis[STATUS], undefined);
});

for (const adapter of ["runtime", "legacy"]) {
  test(`${adapter}: late OAuth callbacks are cancelled without stale ctx or pi access`, async (t) => {
    const f = await fixture(t, { adapter });
    const entered = deferred(), done = deferred();
    let callbacks;
    const login = async (...args) => {
      callbacks = adapter === "runtime" ? args[2] : args[1];
      entered.resolve();
      await done.promise;
      return account("c");
    };
    f.runtime.login = login;
    f.legacy.login = login;
    const run = f.run("chatgpt-login");
    await entered.promise;
    await f.stop();
    assert.equal(callbacks.signal.aborted, true);
    if (adapter === "runtime") {
      for (const event of [
        { type: "auth_url", url: "https://example.invalid/oauth" },
        { type: "device_code", userCode: "fixture", verificationUri: "https://example.invalid/device" },
        { type: "progress", message: "fixture progress" },
        { type: "info", message: "fixture info" },
      ]) callbacks.notify(event);
      await assert.rejects(callbacks.prompt({ type: "text", message: "fixture" }), { name: "AbortError" });
    } else {
      callbacks.onAuth({ url: "https://example.invalid/oauth" });
      callbacks.onDeviceCode({ userCode: "fixture", verificationUri: "https://example.invalid/device" });
      callbacks.onProgress("fixture");
      await assert.rejects(callbacks.onPrompt({ message: "fixture" }), { name: "AbortError" });
      await assert.rejects(callbacks.onManualCodeInput(), { name: "AbortError" });
      await assert.rejects(callbacks.onSelect({ message: "fixture", options: [] }), { name: "AbortError" });
    }
    done.resolve();
    await run;
    assert.equal(f.store().accounts.length, 2);
    assert.deepEqual(f.staleAccesses, []);
    assert.equal(f.notifications.length, 1, "only the pre-login notification is emitted");
  });
}

test("installed Pi runner invalidation: delete and alias retire without the real stale-context error", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { realpathSync } = await import("node:fs");
  const path = await import("node:path");
  let hostUrl;
  try {
    const piBin = process.env.PI_TEST_BIN ?? execFileSync(process.platform === "win32" ? "where" : "which", ["pi"], { encoding: "utf8" }).trim().split(/\r?\n/u)[0];
    hostUrl = execFileSync(process.execPath, ["--input-type=module", "-e", 'console.log(import.meta.resolve("@earendil-works/pi-coding-agent"))'], {
      cwd: path.dirname(realpathSync(piBin)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (process.env.PI_TEST_BIN) throw error;
    t.skip("Pi package not resolvable from CLI; set PI_TEST_BIN to its real JavaScript CLI entrypoint");
    return;
  }
  // Like navigation tests, this checks the installed host implementation, not a compatibility matrix.
  const { ExtensionRunner } = await import(new URL("./core/extensions/runner.js", hostUrl));
  const f = await fixture(t);
  for (const command of ["chatgpt-delete", "chatgpt-logout"]) {
    // Sweep the extra promise jobs introduced by the real runner's UI wrapper.
    for (const boundary of [null, ...Array.from({ length: 12 }, (_, index) => index + 1)]) {
      const instance = f.spawn();
      const entered = deferred(), done = deferred();
      const staleReads = [], lateDialogs = [];
      let stopping, ctx;
      const runner = new ExtensionRunner([], { invalidate() {} }, ROOT, {}, { runtime: f.runtime });
      const stop = () => {
        stopping = instance.events.get("session_shutdown")({ reason: "reload" }, ctx);
        runner.invalidate();
      };
      const scheduleStop = (remaining) => {
        if (remaining === 0) stop();
        else queueMicrotask(() => scheduleStop(remaining - 1));
      };
      instance.ui.select = () => {
        if (stopping) lateDialogs.push("select");
        entered.resolve();
        if (boundary === null) return done.promise;
        scheduleStop(boundary);
        return Promise.resolve("Xoá tất cả accounts");
      };
      runner.setUIContext(instance.ui, "tui");
      const realCtx = runner.createCommandContext();
      ctx = new Proxy(realCtx, {
        get(target, key) {
          try { return Reflect.get(target, key); }
          catch (error) { staleReads.push(key); throw error; }
        },
      });
      const run = instance.commands.get(command)("", ctx);
      await entered.promise;
      if (boundary === null) {
        stop();
        done.resolve("Xoá tất cả accounts");
      }
      await assert.doesNotReject(run);
      await stopping;
      assert.throws(() => realCtx.ui, /This extension ctx is stale after session replacement or reload/);
      assert.deepEqual(staleReads, [], `${command}, microtask boundary ${boundary}`);
      assert.deepEqual(lateDialogs, []);
      assert.deepEqual(f.mutations, []);
      assert.equal(f.store().accounts.length, 2);
    }
  }
});

test("shutdown cancels old widget timers without clearing replacement widgets", async (t) => {
  const f = await fixture(t);
  await f.start();
  await f.run("chatgpt-accounts");
  assert.ok(f.widgets.get("chatgpt-usage"));
  await f.stop();
  t.mock.timers.tick(1_000);
  const next = f.spawn();
  await next.start();
  await next.run("chatgpt-accounts");
  const widget = f.widgets.get("chatgpt-usage");
  t.mock.timers.tick(11_000);
  assert.equal(f.widgets.get("chatgpt-usage"), widget);
  t.mock.timers.tick(1_000);
  assert.equal(f.widgets.get("chatgpt-usage"), undefined);
  await next.stop();
  const count = f.fetches.length;
  t.mock.timers.tick(120_000);
  assert.equal(f.fetches.length, count);
});

test("active-session failures are not mistaken for shutdown cancellation", async (t) => {
  const f = await fixture(t);
  f.ui.select = async () => { throw new Error("fixture dialog error"); };
  await assert.rejects(f.run("chatgpt-delete"), /fixture dialog error/);
  f.runtime.login = async () => { throw new Error("fixture login error"); };
  await f.run("chatgpt-login");
  assert.match(f.notifications.at(-1)[0], /Login ChatGPT lỗi: fixture login error/);
  assert.deepEqual(f.mutations, []);
});

test("microtask shutdown between wait and session_start continuation cannot install an interval", async (t) => {
  const f = await fixture(t, { provider: "fixture-non-chatgpt" });
  const setInterval = globalThis.setInterval, clearInterval = globalThis.clearInterval;
  const created = [], cleared = [], live = new Set();
  t.mock.method(globalThis, "setInterval", (...args) => {
    const handle = setInterval(...args);
    created.push(handle);
    live.add(handle);
    return handle;
  });
  t.mock.method(globalThis, "clearInterval", (handle) => {
    cleared.push(handle);
    live.delete(handle);
    clearInterval(handle);
  });
  const start = f.start();
  let stopped;
  queueMicrotask(() => { stopped = f.stop(); });
  await start;
  await stopped;
  assert.equal(live.size, 0, `${created.length} interval(s) installed, ${cleared.length} cleared`);
  assert.equal(created.length, 0, "retired continuation must not start a timer at all");
  assert.deepEqual(f.staleAccesses, []);
});

for (const command of ["chatgpt-delete", "chatgpt-logout"]) {
  test(`${command}: resolved picker cannot open confirmation after microtask shutdown`, async (t) => {
    const f = await fixture(t);
    const entered = deferred();
    let stopped, retired = false;
    const lateUI = [];
    f.ui.select = () => {
      if (retired) lateUI.push("select");
      // wait() resumes between these two microtasks; the command resumes after stop().
      queueMicrotask(() => queueMicrotask(() => {
        stopped = f.stop();
        retired = true;
        entered.resolve();
      }));
      return Promise.resolve("Xoá tất cả accounts");
    };
    const run = f.run(command);
    await entered.promise;
    await run;
    await stopped;
    assert.deepEqual(lateUI, []);
    assert.deepEqual(f.staleAccesses, []);
    assert.deepEqual(f.mutations, []);
  });
}

test("switch: resolved credential write cannot refresh or mark active after microtask shutdown", async (t) => {
  const f = await fixture(t);
  let stopped;
  const refreshes = [];
  f.runtime.refresh = async () => { refreshes.push("refresh"); };
  f.runtime.credentials.modify = () => {
    queueMicrotask(() => queueMicrotask(() => { stopped = f.stop(); }));
    return Promise.resolve();
  };
  await f.run("chatgpt-switch");
  await stopped;
  assert.deepEqual(refreshes, []);
  assert.equal(f.store().activeAccountId, "a");
  assert.deepEqual(f.staleAccesses, []);
});

test("delete: resolved confirmation cannot start account deletion after microtask shutdown", async (t) => {
  const f = await fixture(t);
  let calls = 0, stopped;
  f.ui.select = () => {
    if (calls++ === 0) return Promise.resolve("Xoá tất cả accounts");
    queueMicrotask(() => queueMicrotask(() => { stopped = f.stop(); }));
    return Promise.resolve("Có");
  };
  await f.run("chatgpt-delete");
  await stopped;
  assert.equal(f.store().accounts.length, 2);
  assert.deepEqual(f.mutations, []);
  assert.deepEqual(f.staleAccesses, []);
});

test("legacy login: resolved OAuth cannot read credentials after microtask shutdown", async (t) => {
  const f = await fixture(t, { adapter: "legacy" });
  let retired = false, stopped;
  const lateReads = [];
  f.legacy.get = async () => {
    if (retired) lateReads.push("credential read");
    return account("c");
  };
  f.legacy.login = () => {
    queueMicrotask(() => queueMicrotask(() => { stopped = f.stop(); retired = true; }));
    return Promise.resolve();
  };
  await f.run("chatgpt-login");
  await stopped;
  assert.deepEqual(lateReads, []);
  assert.deepEqual(f.staleAccesses, []);
  assert.equal(f.store().accounts.length, 2);
  assert.equal(f.notifications.length, 1);
});

test("cached usage cannot publish, touch captured UI, or install a widget timer after microtask shutdown", async (t) => {
  const f = await fixture(t);
  await f.start();
  let retired = false, stopped;
  const lateUI = [], timers = [];
  const setWidget = f.ui.setWidget, setTimeout = globalThis.setTimeout;
  f.ui.setWidget = (...args) => {
    if (retired) lateUI.push(args);
    return setWidget(...args);
  };
  t.mock.method(globalThis, "setTimeout", (...args) => {
    if (retired) timers.push(args);
    return setTimeout(...args);
  });
  const run = f.run("chatgpt-usage");
  const replacementUsage = { username: "replacement@example.invalid" };
  queueMicrotask(() => {
    stopped = f.stop();
    retired = true;
    globalThis[STATUS] = replacementUsage;
  });
  await run;
  await stopped;
  assert.equal(globalThis[STATUS], replacementUsage);
  assert.deepEqual(lateUI, []);
  assert.deepEqual(timers, []);
  assert.deepEqual(f.staleAccesses, []);
});
