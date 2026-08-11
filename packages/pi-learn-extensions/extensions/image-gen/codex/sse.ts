import { ImageGenBackendError, ImageGenModerationError, redactSensitiveText } from "../errors.ts";

export type CodexImageEventResult = {
  base64: string;
  revisedPrompt?: string;
};

export type SseLimits = {
  maxEventBytes?: number;
  maxTotalBytes?: number;
};

const DEFAULT_MAX_EVENT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export async function parseCodexImageSse(
  chunks: AsyncIterable<Uint8Array | string>,
  limits: SseLimits = {},
): Promise<CodexImageEventResult> {
  const maxEventBytes = limits.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const decoder = new TextDecoder();
  let buffer = "";
  let searchFrom = 0;
  let totalBytes = 0;

  for await (const chunk of chunks) {
    const byteLength = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
    totalBytes += byteLength;
    if (totalBytes > maxTotalBytes) {
      throw new ImageGenBackendError("Codex image stream exceeded the safe response-size limit.", "subscription", "stream-parse");
    }

    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    while (true) {
      const separator = findEventSeparator(buffer, searchFrom);
      if (!separator) {
        if (buffer.length > maxEventBytes) {
          throw new ImageGenBackendError("A Codex SSE event exceeded the safe event-size limit.", "subscription", "stream-parse");
        }
        searchFrom = Math.max(0, buffer.length - 3);
        break;
      }

      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator.length);
      searchFrom = 0;
      const result = parseEventBlock(block, maxEventBytes);
      if (result) return result;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const result = parseEventBlock(buffer, maxEventBytes);
    if (result) return result;
  }
  throw new ImageGenBackendError("Codex image stream ended without an image_generation result.", "subscription", "stream-parse");
}

export async function* responseBodyChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function findEventSeparator(buffer: string, start: number): { index: number; length: number } | undefined {
  const lf = buffer.indexOf("\n\n", start);
  const crlf = buffer.indexOf("\r\n\r\n", start);
  if (lf < 0 && crlf < 0) return;
  if (crlf >= 0 && (lf < 0 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseEventBlock(block: string, maxEventBytes: number): CodexImageEventResult | undefined {
  if (!block.trim()) return;
  if (Buffer.byteLength(block) > maxEventBytes) {
    throw new ImageGenBackendError("A Codex SSE event exceeded the safe event-size limit.", "subscription", "stream-parse");
  }

  let eventName: string | undefined;
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon < 0 ? rawLine : rawLine.slice(0, colon);
    let value = colon < 0 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return;

  let payload: any;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    throw new ImageGenBackendError("Received malformed JSON in the Codex image stream.", "subscription", "stream-parse", { cause: error });
  }

  const type = typeof payload?.type === "string" ? payload.type : eventName;
  if (type === "error" || type === "response.failed") {
    const message = payload?.error?.message ?? payload?.response?.error?.message ?? payload?.message ?? "Codex image request failed.";
    const redacted = redactSensitiveText(message);
    if (/moderation|safety|policy|content filter/i.test(redacted)) {
      throw new ImageGenModerationError(redacted, "subscription");
    }
    throw new ImageGenBackendError(redacted, "subscription", "generation");
  }

  if (type === "response.output_item.done") {
    return imageFromItem(payload.item ?? payload.output_item);
  }

  if (type === "response.completed") {
    const output = payload?.response?.output;
    if (Array.isArray(output)) {
      for (const item of output) {
        const result = imageFromItem(item);
        if (result) return result;
      }
    }
  }
}

function imageFromItem(item: any): CodexImageEventResult | undefined {
  if (!item || item.type !== "image_generation_call" || typeof item.result !== "string" || !item.result) return;
  return {
    base64: normalizeBase64(item.result),
    revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
  };
}

function normalizeBase64(value: string): string {
  const comma = value.indexOf(",");
  if (value.startsWith("data:image/") && comma >= 0) return value.slice(comma + 1);
  return value;
}
