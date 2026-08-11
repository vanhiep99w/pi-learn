import { ImageGenValidationError } from "../errors.ts";

export type InspectedImage = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  hasAlpha: boolean;
  bytes: number;
};

export function inspectImage(data: Uint8Array): InspectedImage {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (isPng(buffer)) return inspectPng(buffer);
  if (isJpeg(buffer)) return inspectJpeg(buffer);
  if (isWebp(buffer)) return inspectWebp(buffer);
  throw new ImageGenValidationError("Unsupported or malformed image. Supported formats are PNG, JPEG, and WebP.");
}

export function decodeImageBase64(value: string, maxBytes = 25 * 1024 * 1024): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new ImageGenValidationError("Image backend returned invalid base64 data.");
  }
  const data = Buffer.from(normalized, "base64");
  if (data.length === 0) throw new ImageGenValidationError("Image backend returned an empty image.");
  if (data.length > maxBytes) throw new ImageGenValidationError(`Generated image exceeds the ${maxBytes}-byte output limit.`);
  return data;
}

function isPng(data: Buffer): boolean {
  return data.length >= 26 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function inspectPng(data: Buffer): InspectedImage {
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data[25];
  let hasTransparencyChunk = false;
  let hasImageData = false;
  let hasEnd = false;
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) break;
    const type = data.toString("ascii", offset + 4, offset + 8);
    if (type === "tRNS") hasTransparencyChunk = true;
    if (type === "IDAT") hasImageData = true;
    offset += 12 + length;
    if (type === "IEND") {
      hasEnd = true;
      break;
    }
  }
  if (!hasImageData || !hasEnd) throw new ImageGenValidationError("Malformed PNG: required IDAT/IEND chunks were not found.");
  validateDimensions(width, height);
  return {
    mimeType: "image/png",
    width,
    height,
    hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
    bytes: data.length,
  };
}

function isJpeg(data: Buffer): boolean {
  return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8;
}

function inspectJpeg(data: Buffer): InspectedImage {
  if (data.lastIndexOf(Buffer.from([0xff, 0xd9])) < 0) {
    throw new ImageGenValidationError("Malformed JPEG: end-of-image marker was not found.");
  }
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if (isStartOfFrame(marker) && length >= 7) {
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      validateDimensions(width, height);
      return { mimeType: "image/jpeg", width, height, hasAlpha: false, bytes: data.length };
    }
    offset += length;
  }
  throw new ImageGenValidationError("Malformed JPEG: dimensions were not found.");
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function isWebp(data: Buffer): boolean {
  return data.length >= 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
}

function inspectWebp(data: Buffer): InspectedImage {
  const chunk = data.toString("ascii", 12, 16);
  let width = 0;
  let height = 0;
  let hasAlpha = false;

  if (chunk === "VP8X" && data.length >= 30) {
    hasAlpha = Boolean(data[20] & 0x10);
    width = 1 + readUInt24LE(data, 24);
    height = 1 + readUInt24LE(data, 27);
  } else if (chunk === "VP8 " && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    width = data.readUInt16LE(26) & 0x3fff;
    height = data.readUInt16LE(28) & 0x3fff;
  } else if (chunk === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
    const b0 = data[21];
    const b1 = data[22];
    const b2 = data[23];
    const b3 = data[24];
    width = 1 + b0 + ((b1 & 0x3f) << 8);
    height = 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10);
    hasAlpha = true;
  } else {
    throw new ImageGenValidationError("Malformed or unsupported WebP image header.");
  }

  validateDimensions(width, height);
  return { mimeType: "image/webp", width, height, hasAlpha, bytes: data.length };
}

function readUInt24LE(data: Buffer, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 20_000 || height > 20_000) {
    throw new ImageGenValidationError(`Unsafe or invalid image dimensions: ${width}x${height}.`);
  }
}
