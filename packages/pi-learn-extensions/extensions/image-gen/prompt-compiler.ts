import { ImageGenInputError } from "./errors.ts";
import type { ImageGenInput, ImageRole, ImageUseCase } from "./schema.ts";

export type ResolvedIntent = "generate" | "generate-with-reference" | "edit";

export type CompiledPrompt = {
  userPrompt: string;
  compiledPrompt: string;
  mode: "generate" | "edit";
  intent: ResolvedIntent;
  useCase: ImageUseCase;
};

const EDIT_USE_CASES = new Set<ImageUseCase>([
  "text-localization",
  "identity-preserve",
  "precise-object-edit",
  "lighting-weather",
  "background-extraction",
  "style-transfer",
  "compositing",
  "sketch-to-render",
]);

export function resolveIntent(input: Pick<ImageGenInput, "mode" | "images" | "maskPath">): ResolvedIntent {
  const images = input.images ?? [];
  const targetCount = images.filter((image) => image.role === "edit_target").length;
  const mode = input.mode ?? "auto";

  if (mode === "generate" && targetCount > 0) {
    throw new ImageGenInputError("mode=generate conflicts with an edit_target image. Use mode=edit or remove the edit_target role.");
  }
  if (mode === "edit" && targetCount === 0) {
    throw new ImageGenInputError("mode=edit requires at least one image with role=edit_target.");
  }
  if (input.maskPath && targetCount !== 1) {
    throw new ImageGenInputError("maskPath requires exactly one edit_target image.");
  }

  if (targetCount > 0) return "edit";
  if (images.length > 0) return "generate-with-reference";
  return "generate";
}

export function compilePrompt(input: ImageGenInput): CompiledPrompt {
  const userPrompt = input.prompt.trim();
  if (!userPrompt) throw new ImageGenInputError("prompt must not be empty.");

  const intent = resolveIntent(input);
  const mode = intent === "edit" ? "edit" : "generate";
  const useCase = input.useCase ?? inferUseCase(userPrompt, intent);

  if (intent !== "edit" && EDIT_USE_CASES.has(useCase)) {
    throw new ImageGenInputError(`useCase=${useCase} is an edit taxonomy but the request has no edit_target.`);
  }

  const lines = [
    `Use case: ${useCase}`,
    `Asset type: ${assetType(useCase)}`,
    `Primary request: ${normalizeWhitespace(userPrompt)}`,
  ];

  const images = input.images ?? [];
  if (images.length > 0) {
    lines.push(`Input images: ${images.map((image, index) => `Image ${index + 1} (${roleDescription(image.role)})`).join("; ")}`);
  }

  const verbatim = extractQuotedText(userPrompt);
  if (verbatim.length > 0) {
    lines.push(`Text (verbatim): ${verbatim.map((text) => JSON.stringify(text)).join("; ")}`);
  }

  if (intent === "generate-with-reference") {
    lines.push("Constraints: Use each input only according to its stated role. Preserve requested reference traits without copying unrelated content.");
  } else if (intent === "edit") {
    lines.push("Constraints: Change only what the primary request explicitly asks to change. Keep all other subject identity, geometry, layout, composition, colors, text, and details unchanged.");
    lines.push("Edit invariant: Treat every unrequested difference as an error; preserve the edit target outside the requested change.");
  } else {
    lines.push("Constraints: Do not add unrequested characters, props, brands, slogans, logos, watermarks, or story elements.");
  }

  lines.push("Avoid: unintended text, watermark, signature, extra logo, and unrelated objects.");

  return { userPrompt, compiledPrompt: lines.join("\n"), mode, intent, useCase };
}

function inferUseCase(prompt: string, intent: ResolvedIntent): ImageUseCase {
  const text = prompt.toLowerCase();
  if (intent === "edit") {
    if (/translate|locali[sz]|dịch|việt hóa|text/.test(text)) return "text-localization";
    if (/identity|face|khuôn mặt|nhận diện|same person/.test(text)) return "identity-preserve";
    if (/light|weather|ánh sáng|thời tiết|rain|snow|sunset/.test(text)) return "lighting-weather";
    if (/background|nền|cutout|remove bg/.test(text)) return "background-extraction";
    if (/style|phong cách/.test(text)) return "style-transfer";
    if (/combine|composite|ghép|blend/.test(text)) return "compositing";
    if (/sketch|wireframe|phác thảo/.test(text)) return "sketch-to-render";
    return "precise-object-edit";
  }

  if (/product|packshot|mockup|sản phẩm/.test(text)) return "product-mockup";
  if (/\bui\b|interface|dashboard|app screen|giao diện/.test(text)) return "ui-mockup";
  if (/infographic|diagram|flowchart|sơ đồ/.test(text)) return "infographic-diagram";
  if (/scientific|educational|giáo dục|khoa học/.test(text)) return "scientific-educational";
  if (/ad\b|advert|campaign|marketing|quảng cáo/.test(text)) return "ads-marketing";
  if (/logo|brand|wordmark|thương hiệu/.test(text)) return "logo-brand";
  if (/illustration|storybook|truyện|minh họa/.test(text)) return "illustration-story";
  if (/historical|history|lịch sử|century/.test(text)) return "historical-scene";
  if (/concept art|stylized|3d render|phong cách/.test(text)) return "stylized-concept";
  return "photorealistic-natural";
}

function roleDescription(role: ImageRole): string {
  if (role === "edit_target") return "edit target; modify only as requested";
  if (role === "supporting") return "supporting/compositing input";
  return "visual reference";
}

function assetType(useCase: ImageUseCase): string {
  const labels: Partial<Record<ImageUseCase, string>> = {
    "product-mockup": "production-ready product visual",
    "ui-mockup": "interface mockup",
    "infographic-diagram": "readable information graphic",
    "logo-brand": "brand asset",
    "ads-marketing": "marketing creative",
    "productivity-visual": "productivity asset",
  };
  return labels[useCase] ?? "production-ready image asset";
}

function extractQuotedText(prompt: string): string[] {
  const result: string[] = [];
  const pattern = /["“”]([^"“”\n]{1,160})["“”]/g;
  for (const match of prompt.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
