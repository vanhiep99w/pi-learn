import {
  ImageGenAuthError,
  ImageGenBackendError,
  ImageGenRateLimitError,
  redactSensitiveText,
} from "../errors.ts";
import { buildCodexImageRequest, CODEX_IMAGE_MODEL, CODEX_RESPONSES_URL } from "../codex/request.ts";
import { parseCodexImageSse, responseBodyChunks } from "../codex/sse.ts";
import type { CompiledImageRequest, ImageBackend, ImageBackendCapabilities, ImageBackendResult } from "./types.ts";

type SubscriptionOptions = {
  token: string;
  accountId: string;
  dispatcherModel: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
};

export class CodexSubscriptionBackend implements ImageBackend {
  readonly id = "subscription" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SubscriptionOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  capabilities(): ImageBackendCapabilities {
    return {
      models: [CODEX_IMAGE_MODEL],
      generate: true,
      edit: true,
      multipleReferences: true,
      masks: false,
      sizes: ["auto", "1024x1024", "1536x1024", "1024x1536"],
      qualities: ["auto", "low", "medium", "high"],
      transparentOutput: false,
      maxBatchCount: 1,
      maxInputImages: 4,
    };
  }

  async generate(request: CompiledImageRequest, signal?: AbortSignal): Promise<ImageBackendResult[]> {
    const strategy = request.images.length > 0 ? "reference-conditioned-generation" : "native-generate";
    return [await this.executeRequest(request, strategy, signal)];
  }

  async edit(request: CompiledImageRequest, signal?: AbortSignal): Promise<ImageBackendResult[]> {
    return [await this.executeRequest(request, "reference-conditioned-generation", signal)];
  }

  private async executeRequest(
    request: CompiledImageRequest,
    strategy: ImageBackendResult["strategy"],
    signal?: AbortSignal,
  ): Promise<ImageBackendResult> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      signal?.throwIfAborted();
      try {
        return await this.executeAttempt(request, strategy, signal);
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === maxAttempts) throw error;
        await abortableDelay(retryDelayMs(error, attempt), signal);
      }
    }

    throw new ImageGenBackendError(`Codex image request failed: ${redactSensitiveText(lastError)}`, "subscription");
  }

  private async executeAttempt(
    request: CompiledImageRequest,
    strategy: ImageBackendResult["strategy"],
    signal?: AbortSignal,
  ): Promise<ImageBackendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(CODEX_RESPONSES_URL, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "chatgpt-account-id": this.options.accountId,
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          "OpenAI-Beta": "responses=experimental",
        },
        body: JSON.stringify(buildCodexImageRequest(request, this.options.dispatcherModel)),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ImageGenBackendError(`Cannot connect to the Codex image backend: ${redactSensitiveText(error)}`, "subscription", "connect", { cause: error });
    }

    if (!response.ok) {
      const message = await safeHttpError(response);
      if (response.status === 401 || response.status === 403) {
        throw new ImageGenAuthError(`Codex subscription authorization failed (${response.status}). Run /login and select ChatGPT Plus/Pro (Codex). ${message}`, "subscription");
      }
      if (response.status === 429) {
        const error = new ImageGenRateLimitError(`Codex subscription is rate limited. ${message}`, "subscription");
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        if (retryAfter !== undefined) (error as ImageGenRateLimitError & { retryAfterMs?: number }).retryAfterMs = retryAfter;
        throw error;
      }
      const transient = response.status === 408 || response.status >= 500;
      throw new ImageGenBackendError(
        `Codex image backend returned HTTP ${response.status}. ${message}`,
        "subscription",
        transient ? "http-transient" : "http-client",
      );
    }
    if (!response.body) {
      throw new ImageGenBackendError("Codex image backend returned an empty response stream.", "subscription", "stream");
    }

    const result = await parseCodexImageSse(responseBodyChunks(response.body));
    return {
      ...result,
      mimeType: `image/${request.outputFormat}`,
      responseModel: this.options.dispatcherModel,
      imageModel: CODEX_IMAGE_MODEL,
      strategy,
    };
  }
}

async function safeHttpError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "";
    return redactSensitiveText(text.slice(0, 2_000));
  } catch {
    return "";
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ImageGenRateLimitError) return true;
  return error instanceof ImageGenBackendError && (error.step === "connect" || error.step === "http-transient");
}

function retryDelayMs(error: unknown, attempt: number): number {
  const retryAfter = (error as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
  if (typeof retryAfter === "number") return retryAfter;
  const base = Math.min(4_000, 400 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 200);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, Math.min(timestamp - Date.now(), 30_000));
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
