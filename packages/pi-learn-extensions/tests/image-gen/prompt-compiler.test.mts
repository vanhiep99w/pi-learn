import assert from "node:assert/strict";
import test from "node:test";
import { compilePrompt, resolveIntent } from "../../extensions/image-gen/prompt-compiler.ts";

 test("intent inference distinguishes generate, reference, and edit", () => {
  assert.equal(resolveIntent({}), "generate");
  assert.equal(resolveIntent({ images: [{ path: "ref.png", role: "reference" }] }), "generate-with-reference");
  assert.equal(resolveIntent({ images: [{ path: "target.png", role: "edit_target" }] }), "edit");
});

test("conflicting mode and mask inputs fail early", () => {
  assert.throws(
    () => resolveIntent({ mode: "generate", images: [{ path: "target.png", role: "edit_target" }] }),
    /conflicts with an edit_target/,
  );
  assert.throws(() => resolveIntent({ mode: "edit" }), /requires at least one/);
  assert.throws(
    () => resolveIntent({ maskPath: "mask.png", images: [{ path: "ref.png", role: "reference" }] }),
    /exactly one edit_target/,
  );
});

test("edit compiler preserves role ordering and repeats invariants", () => {
  const result = compilePrompt({
    prompt: "Replace only the mug with a blue mug; keep the person unchanged",
    images: [
      { path: "target.png", role: "edit_target" },
      { path: "mug.png", role: "supporting" },
    ],
  });

  assert.equal(result.mode, "edit");
  assert.match(result.compiledPrompt, /Image 1 \(edit target; modify only as requested\); Image 2 \(supporting\/compositing input\)/);
  assert.match(result.compiledPrompt, /Change only what the primary request explicitly asks/);
  assert.match(result.compiledPrompt, /Treat every unrequested difference as an error/);
});

test("quoted text is carried verbatim without inventing slogans", () => {
  const result = compilePrompt({ prompt: 'Create a clean poster reading "HELLO 2026"' });
  assert.match(result.compiledPrompt, /Text \(verbatim\): "HELLO 2026"/);
  assert.doesNotMatch(result.compiledPrompt, /slogan:/i);
});
