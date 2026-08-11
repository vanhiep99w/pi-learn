import { StringEnum, Type } from "@earendil-works/pi-ai";

export const IMAGE_USE_CASES = [
  "photorealistic-natural",
  "product-mockup",
  "ui-mockup",
  "infographic-diagram",
  "scientific-educational",
  "ads-marketing",
  "productivity-visual",
  "logo-brand",
  "illustration-story",
  "stylized-concept",
  "historical-scene",
  "text-localization",
  "identity-preserve",
  "precise-object-edit",
  "lighting-weather",
  "background-extraction",
  "style-transfer",
  "compositing",
  "sketch-to-render",
] as const;

export const imageGenSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1, description: "Image request. Required for generate and edit." }),
    mode: Type.Optional(StringEnum(["auto", "generate", "edit"] as const)),
    useCase: Type.Optional(StringEnum(IMAGE_USE_CASES)),
    images: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: Type.String({ minLength: 1, description: "Local image path, relative to the workspace unless absolute." }),
            role: StringEnum(["reference", "edit_target", "supporting"] as const),
          },
          { additionalProperties: false },
        ),
        { maxItems: 4 },
      ),
    ),
    maskPath: Type.Optional(Type.String({ minLength: 1 })),
    size: Type.Optional(Type.String({
      pattern: "^(auto|[1-9][0-9]{2,4}x[1-9][0-9]{2,4})$",
      description: "Requested size. Experimental subscription responses may return a different valid size; mismatches are saved with a warning.",
    })),
    quality: Type.Optional(StringEnum(["auto", "low", "medium", "high"] as const)),
    background: Type.Optional(StringEnum(["auto", "opaque", "transparent"] as const)),
    outputFormat: Type.Optional(StringEnum(["png", "webp", "jpeg"] as const)),
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
    backend: Type.Optional(StringEnum(["auto", "subscription", "api"] as const)),
    allowPaidFallback: Type.Optional(Type.Boolean()),
    outputPath: Type.Optional(Type.String({ minLength: 1 })),
    overwrite: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type ImageUseCase = (typeof IMAGE_USE_CASES)[number];
export type ImageMode = "auto" | "generate" | "edit";
export type ImageRole = "reference" | "edit_target" | "supporting";
export type ImageBackendPreference = "auto" | "subscription" | "api";
export type ImageOutputFormat = "png" | "webp" | "jpeg";

export type ImageGenInput = {
  prompt: string;
  mode?: ImageMode;
  useCase?: ImageUseCase;
  images?: Array<{ path: string; role: ImageRole }>;
  maskPath?: string;
  size?: string;
  quality?: "auto" | "low" | "medium" | "high";
  background?: "auto" | "opaque" | "transparent";
  outputFormat?: ImageOutputFormat;
  count?: number;
  backend?: ImageBackendPreference;
  allowPaidFallback?: boolean;
  outputPath?: string;
  overwrite?: boolean;
};
