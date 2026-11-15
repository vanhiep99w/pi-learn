import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const packageRoot = new URL("../../", import.meta.url);
const repoRoot = new URL("../../", packageRoot);
const manifest = (root) => JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

test("both package manifests disable subagents auto-load while retaining other resources", () => {
  const extensionPackage = manifest(packageRoot);
  const repositoryPackage = manifest(repoRoot);
  const expected = [
    "extensions/wiki/index.ts",
    "extensions/chatgpt-usage-status/index.ts",
    "extensions/aurora-ui.ts",
  ];
  assert.deepEqual(extensionPackage.pi.extensions, expected.map((file) => "./" + file));
  assert.deepEqual(repositoryPackage.pi.extensions, expected.map((file) => "./packages/pi-learn-extensions/" + file));
  const resolveEntries = (root, paths) => paths.map((file) => {
    const entry = new URL(file, root);
    assert.equal(statSync(entry).isFile(), true, "only explicit files: no directory discovery");
    return entry.href;
  });
  assert.deepEqual(
    resolveEntries(repoRoot, repositoryPackage.pi.extensions),
    resolveEntries(packageRoot, extensionPackage.pi.extensions),
  );
  assert.deepEqual(repositoryPackage.pi.themes, ["./packages/pi-learn-extensions/themes"]);
  assert.deepEqual(extensionPackage.pi.themes, ["./themes"]);
  assert.equal(existsSync(new URL("extensions/subagents/index.ts", packageRoot)), true, "runtime remains available for explicit loading");
});
