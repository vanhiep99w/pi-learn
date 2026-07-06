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

test("redactString redacts sensitive env/yaml assignments with prefixed keys", () => {
  const result = redactString([
    "DBP_CORE_API_KEY=abc123secret",
    "REDIS_PASSWORD: c2F2dnljb20yMDIzIQ==",
    "normal_value=keep-me",
  ].join("\n"));

  assert.equal(result.secretDetected, true);
  assert.match(result.value, /DBP_CORE_API_KEY=<REDACTED_SECRET>/);
  assert.match(result.value, /REDIS_PASSWORD: <REDACTED_SECRET>/);
  assert.match(result.value, /normal_value=keep-me/);
  assert.doesNotMatch(result.value, /abc123secret/);
  assert.doesNotMatch(result.value, /c2F2dnljb20yMDIzIQ==/);
});

test("redactString redacts long opaque token-like values before reflection", () => {
  const leaked = "WhfyqQ9a9e1eKSsvJbcquKHQoOUvDOU8CDkop8pFfChAqAUAFWyf2y0O_LbQCZVpBdosvtQeCXZ-Gv9QKwobH8nv3x7vjbTeJ4bd9BovvbaXK47A568DRzZT6OJDSt1Eioe9AeMK5owxrs4UviYZdXcw4kIvOkiayL-alPSZWLAar5b-R8b2OIz-d3YjraPjj7lS_RvD4Mc";
  const result = redactString(`DBP_API_KEY=\n${leaked}`);

  assert.equal(result.secretDetected, true);
  assert.match(result.value, /<REDACTED_SECRET>/);
  assert.doesNotMatch(result.value, new RegExp(leaked.slice(0, 40)));
});

test("isSensitivePath detects protected local paths", () => {
  assert.equal(isSensitivePath(".pi/logs/llm-payloads/abc.json"), true);
  assert.equal(isSensitivePath("src/index.ts"), false);
});
