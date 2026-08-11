import assert from "node:assert/strict";
import test from "node:test";
import { decodeImageBase64, inspectImage } from "../../extensions/image-gen/image/inspect.ts";

function pngHeader(width: number, height: number, colorType: number): Buffer {
  const data = Buffer.alloc(57);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data[24] = 8;
  data[25] = colorType;
  data.writeUInt32BE(0, 33);
  data.write("IDAT", 37, "ascii");
  data.writeUInt32BE(0, 45);
  data.write("IEND", 49, "ascii");
  return data;
}

test("inspects PNG dimensions and alpha semantics", () => {
  assert.deepEqual(inspectImage(pngHeader(1024, 768, 6)), {
    mimeType: "image/png",
    width: 1024,
    height: 768,
    hasAlpha: true,
    bytes: 57,
  });
  assert.equal(inspectImage(pngHeader(10, 20, 2)).hasAlpha, false);
});

test("base64 decoder rejects junk and bounded oversized output", () => {
  assert.throws(() => decodeImageBase64("%%%"), /invalid base64/);
  const encoded = Buffer.alloc(20).toString("base64");
  assert.throws(() => decodeImageBase64(encoded, 10), /10-byte output limit/);
});
