import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { CodexSubscriptionBackend } from "./backends/codex-subscription.ts";
import type { CompiledImageRequest, ImageBackend, ImageBackendResult, LoadedInputImage } from "./backends/types.ts";
import { getChatGptAccountId } from "./codex/jwt.ts";
import {
  ImageGenAuthError,
  ImageGenCapabilityError,
  ImageGenInputError,
  ImageGenOutputError,
  ImageGenValidationError,
  redactSensitiveText,
} from "./errors.ts";
import { decodeImageBase64, inspectImage } from "./image/inspect.ts";
import { compilePrompt } from "./prompt-compiler.ts";
import type { ImageGenInput, ImageOutputFormat } from "./schema.ts";
import { saveImageWithMetadata, type ImageMetadata, type ImageValidationMetadata } from "./storage/metadata.ts";
import { inferOutputFormat, resolveOutputPaths, stripLeadingAt } from "./storage/paths.ts";

const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;
const SUBSCRIPTION_CONCURRENCY = 2;

export type ImageGenDetails = {
  backend: "subscription" | "api";
  responseModel: string;
  imageModel: string;
  prompt: string;
  compiledPrompt: string;
  revisedPrompt: Array<string | undefined>;
  savedPaths: string[];
  metadataPaths: string[];
  validation: ImageValidationMetadata[];
  batchId: string;
  fallbackUsed: boolean;
  strategy: string[];
  experimental: boolean;
};

export type ImageGenExecutionResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  details: ImageGenDetails;
};

export async function runImageGen(
  input: ImageGenInput,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
  onProgress?: (message: string) => void,
): Promise<ImageGenExecutionResult> {
  signal?.throwIfAborted();
  const compiled = compilePrompt(input);
  const count = input.count ?? 1;
  const outputFormat = input.outputFormat ?? inferOutputFormat(input.outputPath) ?? "png";
  const size = input.size ?? "auto";
  const quality = input.quality ?? "high";
  const background = input.background ?? "auto";

  const images = await loadInputImages(input, ctx.cwd);
  const { backend, fallbackUsed } = await selectBackend(input, ctx, images.length > 0);
  validateCapabilities(backend, { input, images, size, quality, background });

  const outputPaths = await resolveOutputPaths({
    cwd: ctx.cwd,
    outputPath: input.outputPath,
    outputFormat,
    prompt: compiled.userPrompt,
    count,
  });
  await assertNoUnexpectedOverwrite(outputPaths, input.overwrite === true);

  const request: CompiledImageRequest = {
    ...compiled,
    images,
    maskPath: input.maskPath,
    size,
    quality,
    background,
    outputFormat,
  };

  const batchId = crypto.randomUUID();
  let completed = 0;
  const generated = await mapConcurrent(
    Array.from({ length: count }, (_, index) => index),
    backend.id === "subscription" ? SUBSCRIPTION_CONCURRENCY : 3,
    async () => {
      signal?.throwIfAborted();
      const results = request.mode === "edit"
        ? await backend.edit(request, signal)
        : await backend.generate(request, signal);
      const result = results[0];
      if (!result) throw new ImageGenValidationError("Image backend returned no image result.");
      completed++;
      onProgress?.(`Generated ${completed}/${count}; validating and saving…`);
      return result;
    },
  );

  const validations: ImageValidationMetadata[] = [];
  const metadataPaths: string[] = [];
  const inlineImages: Array<{ type: "image"; data: string; mimeType: string }> = [];

  for (let index = 0; index < generated.length; index++) {
    signal?.throwIfAborted();
    const result = generated[index];
    const bytes = decodeImageBase64(result.base64);
    const inspected = inspectImage(bytes);
    validateGeneratedImage(inspected, outputFormat, size, background);
    const validation: ImageValidationMetadata = {
      mime: true,
      dimensions: true,
      alpha: background === "transparent" ? (inspected.hasAlpha ? "present" : "missing") : "not-requested",
      width: inspected.width,
      height: inspected.height,
      bytes: inspected.bytes,
    };
    validations.push(validation);

    const metadata: ImageMetadata = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      userPrompt: compiled.userPrompt,
      compiledPrompt: compiled.compiledPrompt,
      revisedPrompt: result.revisedPrompt,
      mode: compiled.mode,
      intent: compiled.intent,
      useCase: compiled.useCase,
      backend: backend.id,
      responseModel: result.responseModel,
      imageModel: result.imageModel,
      strategy: result.strategy,
      size,
      quality,
      background,
      outputFormat,
      savedPath: outputPaths[index],
      referencePaths: images.map((image) => image.path),
      validation,
      fallbackUsed,
    };
    metadataPaths.push(await saveImageWithMetadata(outputPaths[index], bytes, metadata, input.overwrite === true));
    inlineImages.push({ type: "image", data: result.base64, mimeType: inspected.mimeType });
  }

  const savedText = outputPaths.map((path) => `- ${path}`).join("\n");
  return {
    content: [
      { type: "text", text: `Generated ${outputPaths.length} image(s) with the experimental ${backend.id} backend.\nSaved to:\n${savedText}` },
      ...inlineImages,
    ],
    details: {
      backend: backend.id,
      responseModel: generated[0].responseModel,
      imageModel: generated[0].imageModel,
      prompt: compiled.userPrompt,
      compiledPrompt: compiled.compiledPrompt,
      revisedPrompt: generated.map((result) => result.revisedPrompt),
      savedPaths: outputPaths,
      metadataPaths,
      validation: validations,
      batchId,
      fallbackUsed,
      strategy: generated.map((result) => result.strategy),
      experimental: true,
    },
  };
}

export function selectDispatcherModel(ctx: ExtensionContext, needsImageInput: boolean): string {
  const active = ctx.model as any;
  if (isCompatibleDispatcher(active, needsImageInput)) return active.id;

  const candidates = (ctx.modelRegistry.getAvailable() as any[])
    .filter((model) => isCompatibleDispatcher(model, needsImageInput));
  if (candidates.length === 0) {
    const qualifier = needsImageInput ? " with image input capability" : "";
    throw new ImageGenCapabilityError(`No available openai-codex dispatcher model${qualifier} was found. Refresh the model catalog or select an openai-codex model.`, "subscription");
  }
  return candidates[0].id;
}

async function selectBackend(
  input: ImageGenInput,
  ctx: ExtensionContext,
  needsImageInput: boolean,
): Promise<{ backend: ImageBackend; fallbackUsed: boolean }> {
  const preference = input.backend ?? "auto";
  if (preference === "api") {
    throw new ImageGenCapabilityError("The public OpenAI Images API backend is not implemented in this initial phase. No paid API call was made.", "api");
  }

  let resolved: Awaited<ReturnType<typeof ctx.modelRegistry.getProviderAuth>>;
  try {
    resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
  } catch (error) {
    throw new ImageGenAuthError(`Cannot resolve openai-codex OAuth: ${redactSensitiveText(error)}`, "subscription", { cause: error });
  }
  const token = resolved?.auth.apiKey;
  if (!token) {
    if (preference === "auto" && input.allowPaidFallback) {
      throw new ImageGenCapabilityError("Subscription auth is unavailable and paid fallback was allowed, but the public API backend is not implemented yet. No paid API call was made.", "api");
    }
    throw new ImageGenAuthError("No openai-codex OAuth credential is available. Run /login and select ChatGPT Plus/Pro (Codex). Paid API fallback was not used.", "subscription");
  }

  const dispatcherModel = selectDispatcherModel(ctx, needsImageInput);
  return {
    backend: new CodexSubscriptionBackend({
      token,
      accountId: getChatGptAccountId(token),
      dispatcherModel,
    }),
    fallbackUsed: false,
  };
}

async function loadInputImages(input: ImageGenInput, cwd: string): Promise<LoadedInputImage[]> {
  const images = input.images ?? [];
  const loaded: LoadedInputImage[] = [];
  for (const image of images) {
    const cleaned = stripLeadingAt(image.path);
    const absolute = isAbsolute(cleaned) ? resolve(cleaned) : resolve(cwd, cleaned);
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      throw new ImageGenInputError(`Cannot read input image: ${image.path}`, { cause: error });
    }
    if (!info.isFile()) throw new ImageGenInputError(`Input image is not a file: ${image.path}`);
    if (info.size > MAX_INPUT_IMAGE_BYTES) throw new ImageGenInputError(`Input image exceeds the 10 MB limit: ${image.path}`);
    const data = await readFile(absolute);
    const inspected = inspectImage(data);
    loaded.push({ path: absolute, role: image.role, mimeType: inspected.mimeType, data: data.toString("base64") });
  }
  return loaded;
}

function validateCapabilities(
  backend: ImageBackend,
  request: {
    input: ImageGenInput;
    images: LoadedInputImage[];
    size: string;
    quality: "auto" | "low" | "medium" | "high";
    background: "auto" | "opaque" | "transparent";
  },
): void {
  const capabilities = backend.capabilities();
  if (!capabilities.sizes.includes(request.size)) {
    throw new ImageGenCapabilityError(`The ${backend.id} backend has not been verified for size=${request.size}. Supported sizes: ${capabilities.sizes.join(", ")}.`, backend.id);
  }
  if (!capabilities.qualities.includes(request.quality)) {
    throw new ImageGenCapabilityError(`The ${backend.id} backend does not support quality=${request.quality}.`, backend.id);
  }
  if (request.images.length > capabilities.maxInputImages) {
    throw new ImageGenCapabilityError(`The ${backend.id} backend supports at most ${capabilities.maxInputImages} input images.`, backend.id);
  }
  if (request.input.maskPath && !capabilities.masks) {
    throw new ImageGenCapabilityError(`The ${backend.id} backend does not support native masks in this phase.`, backend.id);
  }
  if (request.background === "transparent" && !capabilities.transparentOutput) {
    throw new ImageGenCapabilityError(`Transparent output is not implemented for the ${backend.id} backend yet; no image was generated.`, backend.id);
  }
}

function validateGeneratedImage(
  inspected: ReturnType<typeof inspectImage>,
  outputFormat: ImageOutputFormat,
  size: string,
  background: "auto" | "opaque" | "transparent",
): void {
  const expectedMime = outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
  if (inspected.mimeType !== expectedMime) {
    throw new ImageGenValidationError(`Backend returned ${inspected.mimeType}, expected ${expectedMime}.`);
  }
  if (size !== "auto") {
    const [width, height] = size.split("x").map(Number);
    if (inspected.width !== width || inspected.height !== height) {
      throw new ImageGenValidationError(`Backend returned ${inspected.width}x${inspected.height}, expected ${size}.`);
    }
  }
  if (background === "transparent" && !inspected.hasAlpha) {
    throw new ImageGenValidationError("Transparent output was requested, but the generated image has no alpha channel.");
  }
}

function isCompatibleDispatcher(model: any, needsImageInput: boolean): boolean {
  if (!model || model.provider !== "openai-codex" || typeof model.id !== "string") return false;
  if (needsImageInput && (!Array.isArray(model.input) || !model.input.includes("image"))) return false;
  return model.api === "openai-codex-responses" || model.api === "openai-responses" || model.api === undefined;
}

async function assertNoUnexpectedOverwrite(paths: string[], overwrite: boolean): Promise<void> {
  if (overwrite) return;
  for (const path of paths) {
    if ((await exists(path)) || (await exists(`${path}.json`))) {
      throw new ImageGenOutputError(`Refusing to overwrite existing output: ${path}. Set overwrite=true or choose another outputPath.`);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  });
  await Promise.all(runners);
  return results;
}
