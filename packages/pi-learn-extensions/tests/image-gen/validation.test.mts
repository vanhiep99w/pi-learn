import assert from "node:assert/strict";
import test from "node:test";
import { validateGeneratedImage } from "../../extensions/image-gen/image/validate.ts";

const landscapePng = {
  mimeType: "image/png" as const,
  width: 1536,
  height: 1024,
  hasAlpha: false,
  bytes: 1024,
};

test("subscription validation keeps valid images when private backend ignores requested size", () => {
  const result = validateGeneratedImage(landscapePng, "png", "1024x1024", "opaque", false);
  assert.equal(result.dimensionsMatch, false);
  assert.match(result.warnings[0], /1536x1024, requested 1024x1024/);
  assert.match(result.warnings[0], /valid image was saved/);
});

test("strict backends still reject dimension mismatches", () => {
  assert.throws(
    () => validateGeneratedImage(landscapePng, "png", "1024x1024", "opaque", true),
    /1536x1024, requested 1024x1024/,
  );
});

test("format and transparency validation remain strict", () => {
  assert.throws(
    () => validateGeneratedImage(landscapePng, "jpeg", "auto", "opaque", false),
    /expected image\/jpeg/,
  );
  assert.throws(
    () => validateGeneratedImage(landscapePng, "png", "auto", "transparent", false),
    /no alpha channel/,
  );
});
