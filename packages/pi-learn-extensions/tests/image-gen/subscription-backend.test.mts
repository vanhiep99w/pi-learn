import assert from "node:assert/strict";
import test from "node:test";
import { CodexSubscriptionBackend } from "../../extensions/image-gen/backends/codex-subscription.ts";
import type { CompiledImageRequest } from "../../extensions/image-gen/backends/types.ts";

const request: CompiledImageRequest = {
  userPrompt: "hero",
  compiledPrompt: "Primary request: hero",
  mode: "generate",
  intent: "generate-with-reference",
  useCase: "product-mockup",
  images: [{ path: "/tmp/ref.png", role: "reference", mimeType: "image/png", data: "YWJj" }],
  size: "1024x1024",
  quality: "high",
  background: "opaque",
  outputFormat: "png",
};

test("subscription backend sends bounded Codex request and parses image output", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    const event = `data: ${JSON.stringify({
      type: "response.output_item.done",
      item: { type: "image_generation_call", result: "aW1hZ2U=", revised_prompt: "hero revised" },
    })}\n\n`;
    return new Response(event, { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  const backend = new CodexSubscriptionBackend({
    token: "oauth-secret",
    accountId: "acct-1",
    dispatcherModel: "gpt-codex",
    fetchImpl,
    maxAttempts: 1,
  });
  const [result] = await backend.generate(request);

  assert.equal(capturedUrl, "https://chatgpt.com/backend-api/codex/responses");
  assert.equal(new Headers(capturedInit?.headers).get("authorization"), "Bearer oauth-secret");
  assert.equal(new Headers(capturedInit?.headers).get("chatgpt-account-id"), "acct-1");
  assert.equal(capturedInit?.redirect, "error");
  const payload = JSON.parse(String(capturedInit?.body));
  assert.equal(payload.model, "gpt-codex");
  assert.equal(payload.tools[0].model, "gpt-image-2");
  assert.equal(payload.input[0].content[1].image_url, "data:image/png;base64,YWJj");
  assert.equal(result.base64, "aW1hZ2U=");
  assert.equal(result.revisedPrompt, "hero revised");
  assert.equal(result.strategy, "reference-conditioned-generation");
});

test("subscription backend redacts credentials from HTTP errors", async () => {
  const backend = new CodexSubscriptionBackend({
    token: "oauth-secret",
    accountId: "acct-1",
    dispatcherModel: "gpt-codex",
    maxAttempts: 1,
    fetchImpl: async () => new Response("failed Authorization: sk-secretsecretsecret", { status: 401 }),
  });

  await assert.rejects(
    () => backend.generate(request),
    (error: any) => {
      assert.doesNotMatch(error.message, /secretsecret/);
      assert.match(error.message, /REDACTED/);
      return true;
    },
  );
});
