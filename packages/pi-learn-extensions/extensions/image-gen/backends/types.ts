import type { ImageOutputFormat, ImageRole, ImageUseCase } from "../schema.ts";

export type ImageBackendCapabilities = {
  models: string[];
  generate: boolean;
  edit: boolean;
  multipleReferences: boolean;
  masks: boolean;
  sizes: string[];
  qualities: Array<"auto" | "low" | "medium" | "high">;
  transparentOutput: boolean;
  maxBatchCount: number;
  maxInputImages: number;
};

export type LoadedInputImage = {
  path: string;
  role: ImageRole;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
};

export type CompiledImageRequest = {
  userPrompt: string;
  compiledPrompt: string;
  mode: "generate" | "edit";
  intent: "generate" | "generate-with-reference" | "edit";
  useCase: ImageUseCase;
  images: LoadedInputImage[];
  maskPath?: string;
  size: string;
  quality: "auto" | "low" | "medium" | "high";
  background: "auto" | "opaque" | "transparent";
  outputFormat: ImageOutputFormat;
};

export type ImageBackendResult = {
  base64: string;
  mimeType?: string;
  revisedPrompt?: string;
  responseModel: string;
  imageModel: string;
  strategy: "native-generate" | "reference-conditioned-generation" | "native-edit";
};

export interface ImageBackend {
  readonly id: "subscription" | "api";
  capabilities(): ImageBackendCapabilities;
  generate(request: CompiledImageRequest, signal?: AbortSignal): Promise<ImageBackendResult[]>;
  edit(request: CompiledImageRequest, signal?: AbortSignal): Promise<ImageBackendResult[]>;
}
