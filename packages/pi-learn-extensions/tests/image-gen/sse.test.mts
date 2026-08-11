import assert from "node:assert/strict";
import test from "node:test";
import { parseCodexImageSse } from "../../extensions/image-gen/codex/sse.ts";

async function* chunks(values: Array<string | Uint8Array>) {
  for (const value of values) yield value;
}

test("parses image event across arbitrary chunk boundaries", async () => {
  const event = 'event: response.output_item.done\r\ndata: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"YWJj","revised_prompt":"clean"}}\r\n\r\n';
  const result = await parseCodexImageSse(chunks([event.slice(0, 17), event.slice(17, 71), event.slice(71)]));
  assert.deepEqual(result, { base64: "YWJj", revisedPrompt: "clean" });
});

test("supports multiline data and a final event without blank terminator", async () => {
  const event = [
    "event: response.output_item.done",
    'data: {"type":"response.output_item.done",',
    'data: "item":{"type":"image_generation_call","result":"data:image/png;base64,YWJj"}}',
  ].join("\n");
  const result = await parseCodexImageSse(chunks([event]));
  assert.equal(result.base64, "YWJj");
});

test("skips unrelated events before the image event in one chunk", async () => {
  const progress = 'data: {"type":"response.in_progress"}\n\n';
  const image = 'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"YWJj"}}\n\n';
  const result = await parseCodexImageSse(chunks([progress + image]));
  assert.equal(result.base64, "YWJj");
});

test("rejects malformed and oversized events without echoing image data", async () => {
  await assert.rejects(() => parseCodexImageSse(chunks(["data: {bad}\n\n"])), /malformed JSON/);
  await assert.rejects(
    () => parseCodexImageSse(chunks([`data: ${"x".repeat(64)}\n\n`]), { maxEventBytes: 32, maxTotalBytes: 1024 }),
    /event-size limit/,
  );
});

test("redacts token-like content from error events", async () => {
  const jwt = "eyJabc.eyJsecret.signature";
  const event = `data: ${JSON.stringify({ type: "response.failed", response: { error: { message: `failed Bearer ${jwt}` } } })}\n\n`;
  await assert.rejects(
    () => parseCodexImageSse(chunks([event])),
    (error: any) => {
      assert.doesNotMatch(error.message, /eyJsecret/);
      assert.match(error.message, /REDACTED/);
      return true;
    },
  );
});
