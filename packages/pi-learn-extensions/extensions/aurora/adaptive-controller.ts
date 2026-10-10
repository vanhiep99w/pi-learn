import { generateAurora, type AuroraSource, type GeneratedAurora } from "./palette.ts";

export type AdaptiveTheme = {
  name?: string;
  auroraAdaptive?: { background: string; appearance: string; reported: boolean };
};

export type AdaptivePorts = {
  source: AuroraSource;
  active: () => AdaptiveTheme;
  fallbackBackground: () => string;
  queryBackground?: (onLate: (background: string) => void) => Promise<string | undefined>;
  apply: (generated: GeneratedAurora, reported: boolean) => AdaptiveTheme | undefined;
  restore: () => void;
};

const validBackground = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

// Session-scoped coordinator. It neither writes settings nor owns terminal
// notification flags/global theme callbacks. Async replies are ownership-checked.
export function createAdaptiveController(ports: AdaptivePorts) {
  let disposed = false;
  let enabled = true;
  let querying = false;
  let querySupported = true;
  let queryEpoch = 0;
  let background: string | undefined;
  let applied: AdaptiveTheme | undefined;
  let lastKey: string | undefined;
  let lastError: string | undefined;

  const selected = () => !disposed && ports.active().name === ports.source.name;

  function update() {
    if (!enabled || !selected()) return;
    try {
      const bg = background ?? ports.fallbackBackground();
      if (!validBackground(bg)) return;
      const key = `${bg.toLowerCase()}:${background !== undefined}`;
      if (key === lastKey && applied === ports.active()) return;
      const next = ports.apply(generateAurora(ports.source, bg), background !== undefined);
      if (next) {
        applied = next;
        lastKey = key;
        lastError = undefined;
      } else {
        lastError = "Pi không áp dụng được theme sinh ra";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  async function refresh(forceQuery = false) {
    if (!enabled || !selected()) return;
    update();
    if (querying || !ports.queryBackground || (!querySupported && !forceQuery)) return;
    querying = true;
    const epoch = ++queryEpoch;
    // A theme selected after the request is a new owner. A late response must
    // not replace it, even if it has the same name as the old Aurora instance.
    const owner = ports.active();
    const accept = (bg: string) => {
      if (epoch !== queryEpoch || !enabled || !selected() || ports.active() !== owner && ports.active() !== applied) return;
      if (validBackground(bg)) {
        background = bg.toLowerCase();
        querySupported = true;
        update();
      }
    };
    try {
      const result = await ports.queryBackground(accept);
      if (epoch !== queryEpoch || disposed) return;
      if (validBackground(result)) accept(result);
      else querySupported = false; // no endless OSC requests to unsupported terminals
    } catch (error) {
      if (!disposed && epoch === queryEpoch) {
        querySupported = false;
        lastError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (epoch === queryEpoch) querying = false;
    }
  }

  return {
    refresh,
    async enable() {
      if (disposed) return;
      enabled = true;
      querySupported = true;
      await refresh(true);
    },
    disable() {
      enabled = false;
      queryEpoch++;
      querying = false;
      if (!disposed && selected() && ports.active() === applied) ports.restore();
      applied = undefined;
      lastKey = undefined;
    },
    status() {
      const active = selected();
      const state = !enabled ? "tắt" : !active ? "chờ chọn midnight-aurora" : "bật";
      const meta = active ? ports.active().auroraAdaptive : undefined;
      return `Aurora adaptive: ${state}${meta ? ` · nền ${meta.background} · ${meta.appearance} · ${meta.reported ? "terminal" : "nền dự đoán"}` : ""}${lastError ? ` · ${lastError}` : ""}`;
    },
    dispose() {
      disposed = true;
      queryEpoch++;
      querying = false;
      applied = undefined;
    },
  };
}

export type AdaptiveController = ReturnType<typeof createAdaptiveController>;
