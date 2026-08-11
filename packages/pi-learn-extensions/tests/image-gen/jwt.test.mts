import assert from "node:assert/strict";
import test from "node:test";
import { getChatGptAccountId } from "../../extensions/image-gen/codex/jwt.ts";

function fakeJwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("extracts namespaced ChatGPT account claim", () => {
  const token = fakeJwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" },
  });
  assert.equal(getChatGptAccountId(token), "acct-123");
});

test("rejects malformed tokens and missing account claims", () => {
  assert.throws(() => getChatGptAccountId("not-a-jwt"), /valid JWT/);
  assert.throws(() => getChatGptAccountId(fakeJwt({ sub: "user" })), /does not contain/);
});
