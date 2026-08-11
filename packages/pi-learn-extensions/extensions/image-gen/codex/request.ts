import type { CompiledImageRequest } from "../backends/types.ts";

export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_IMAGE_MODEL = "gpt-image-2";

export function buildCodexImageRequest(request: CompiledImageRequest, dispatcherModel: string): Record<string, unknown> {
  const imageTool: Record<string, unknown> = {
    type: "image_generation",
    model: CODEX_IMAGE_MODEL,
    moderation: "auto",
    output_format: request.outputFormat,
  };
  if (request.quality !== "auto") imageTool.quality = request.quality;
  if (request.size !== "auto") imageTool.size = request.size;

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: request.compiledPrompt },
    ...request.images.map((image) => ({
      type: "input_image",
      image_url: `data:${image.mimeType};base64,${image.data}`,
    })),
  ];

  return {
    model: dispatcherModel,
    store: false,
    stream: true,
    instructions: "Use image_generation to create exactly one image matching the request. Do not add unrequested content.",
    input: [{ role: "user", content }],
    tool_choice: "auto",
    tools: [imageTool],
  };
}
