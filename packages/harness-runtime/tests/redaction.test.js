import test from "node:test";
import assert from "node:assert/strict";
import { redactString, redactValue, isSensitivePath } from "../src/safety/redaction.js";

test("redactString redacts common secret patterns", () => {
  const result = redactString("Authorization: Bearer abc.def.ghi and key sk-abcdefghijklmnopqrstuvwxyz");

  assert.equal(result.secretDetected, true);
  assert.match(result.value, /Authorization: Bearer <REDACTED_SECRET>/);
  assert.doesNotMatch(result.value, /sk-abcdefghijklmnopqrstuvwxyz/);
});

test("redactValue redacts sensitive keys but not totalTokens", () => {
  const result = redactValue({ token: "abc123", totalTokens: 42, nested: { api_key: "secret" } });

  assert.deepEqual(result.value, {
    token: "<REDACTED_SECRET>",
    totalTokens: 42,
    nested: { api_key: "<REDACTED_SECRET>" },
  });
  assert.equal(result.secretDetected, true);
});

test("isSensitivePath detects protected local paths", () => {
  assert.equal(isSensitivePath(".pi/logs/llm-payloads/abc.json"), true);
  assert.equal(isSensitivePath("src/index.ts"), false);
});
