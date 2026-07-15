import crypto from "node:crypto";
import { countLines, truncateString } from "../safety/truncation.js";
import { redactString } from "../safety/redaction.js";

export function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") parts.push(block.text ?? "");
    else if (block.type === "thinking") continue;
    else if (block.type === "image") parts.push(`<image ${block.mimeType ?? "unknown"}>`);
    else if (block.type === "toolCall") parts.push(`<toolCall ${block.name ?? "unknown"}>`);
    else parts.push(`<${block.type ?? "unknown"}>`);
  }
  return parts.filter(Boolean).join("\n");
}

export function makeExcerpt(text, maxChars = 1000) {
  const original = typeof text === "string" ? text : String(text ?? "");
  const redacted = redactString(original);
  const truncated = truncateString(redacted.value, maxChars);
  return {
    excerpt: truncated.value,
    stats: {
      chars: original.length,
      lines: countLines(original),
      truncated: truncated.truncated,
      hash: `sha256:${crypto.createHash("sha256").update(original).digest("hex")}`,
    },
    safety: {
      redacted: redacted.redacted,
      secretDetected: redacted.secretDetected,
    },
  };
}

export function toolCallsFromAssistantMessage(message) {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content.filter((block) => block?.type === "toolCall");
}
