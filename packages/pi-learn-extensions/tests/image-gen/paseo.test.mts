import assert from "node:assert/strict";
import test from "node:test";
import { appendPaseoMarkdownPreviews } from "../../extensions/image-gen/paseo.ts";

test("appends Paseo previews to the final assistant message", () => {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "Ảnh đã được tạo." }],
    provider: "openai-codex",
  };
  const preview = "![Generated image 1](./assets/dog.png)";
  const result = appendPaseoMarkdownPreviews(message, [preview]);

  assert.notEqual(result, message);
  assert.equal(result.provider, "openai-codex");
  assert.deepEqual(result.content.at(-1), { type: "text", text: `\n\n${preview}` });
});

test("does not duplicate previews already present in assistant text", () => {
  const preview = "![Generated image 1](./assets/dog.png)";
  const message = { role: "assistant", content: [{ type: "text", text: `Done\n\n${preview}` }] };
  assert.equal(appendPaseoMarkdownPreviews(message, [preview]), message);
});

test("does not modify non-assistant messages", () => {
  const message = { role: "toolResult", content: [{ type: "text", text: "Done" }] };
  assert.equal(appendPaseoMarkdownPreviews(message, ["![Image](./image.png)"]), message);
});
