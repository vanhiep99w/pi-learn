import test from "node:test";
import assert from "node:assert/strict";
import { contentToText } from "../src/normalize/content.js";

test("contentToText omits thinking blocks while preserving final text and tool markers", () => {
  const text = contentToText([
    { type: "thinking", thinking: "private reasoning must not enter normalized evidence" },
    { type: "text", text: "Final answer" },
    { type: "toolCall", name: "read" },
  ]);

  assert.equal(text, "Final answer\n<toolCall read>");
  assert.doesNotMatch(text, /thinking/i);
  assert.doesNotMatch(text, /private reasoning/);
});
