export type AssistantMessageLike = {
  role: string;
  content: unknown;
};

export function appendPaseoMarkdownPreviews<T extends AssistantMessageLike>(
  message: T,
  previews: string[],
): T {
  if (message.role !== "assistant" || previews.length === 0 || !Array.isArray(message.content)) return message;

  const existingText = message.content
    .filter((item): item is { type: "text"; text: string } => {
      if (!item || typeof item !== "object") return false;
      const content = item as { type?: unknown; text?: unknown };
      return content.type === "text" && typeof content.text === "string";
    })
    .map((item) => item.text)
    .join("\n");
  const missing = [...new Set(previews)].filter((preview) => !existingText.includes(preview));
  if (missing.length === 0) return message;

  return {
    ...message,
    content: [
      ...message.content,
      { type: "text", text: `\n\n${missing.join("\n")}` },
    ],
  };
}
