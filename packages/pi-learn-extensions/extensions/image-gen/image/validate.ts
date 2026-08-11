import { ImageGenValidationError } from "../errors.ts";
import type { ImageOutputFormat } from "../schema.ts";
import type { InspectedImage } from "./inspect.ts";

export type GeneratedImageValidationResult = {
  dimensionsMatch: boolean;
  warnings: string[];
};

export function validateGeneratedImage(
  inspected: InspectedImage,
  outputFormat: ImageOutputFormat,
  requestedSize: string,
  background: "auto" | "opaque" | "transparent",
  strictDimensions: boolean,
): GeneratedImageValidationResult {
  const expectedMime = outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
  if (inspected.mimeType !== expectedMime) {
    throw new ImageGenValidationError(`Backend returned ${inspected.mimeType}, expected ${expectedMime}.`);
  }

  let dimensionsMatch = true;
  const warnings: string[] = [];
  if (requestedSize !== "auto") {
    const [width, height] = requestedSize.split("x").map(Number);
    dimensionsMatch = inspected.width === width && inspected.height === height;
    if (!dimensionsMatch) {
      const message = `Backend returned ${inspected.width}x${inspected.height}, requested ${requestedSize}.`;
      if (strictDimensions) throw new ImageGenValidationError(message);
      warnings.push(`${message} The experimental subscription backend may ignore the requested size; the valid image was saved using its actual dimensions.`);
    }
  }

  if (background === "transparent" && !inspected.hasAlpha) {
    throw new ImageGenValidationError("Transparent output was requested, but the generated image has no alpha channel.");
  }

  return { dimensionsMatch, warnings };
}
