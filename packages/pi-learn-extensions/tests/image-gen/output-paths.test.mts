import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inferOutputFormat, resolveOutputPaths } from "../../extensions/image-gen/storage/paths.ts";

const fixedDate = new Date("2026-06-01T01:02:03.000Z");

test("resolves @-prefixed project files and variant suffixes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-image-paths-"));
  try {
    const paths = await resolveOutputPaths({
      cwd,
      outputPath: "@assets/hero.png",
      outputFormat: "png",
      prompt: "Product hero",
      count: 2,
      now: fixedDate,
      id: "fixed",
    });
    assert.deepEqual(paths, [join(cwd, "assets/hero-1.png"), join(cwd, "assets/hero-2.png")]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("existing directory gets semantic non-colliding names", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-image-paths-"));
  const output = join(cwd, "assets");
  await mkdir(output);
  try {
    const [path] = await resolveOutputPaths({
      cwd,
      outputPath: "assets",
      outputFormat: "webp",
      prompt: "Cà phê product hero",
      count: 1,
      now: fixedDate,
      id: "fixed",
    });
    assert.equal(path, join(output, "ca-phe-product-hero-2026-06-01T01-02-03-000Z-fixed.webp"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects format conflicts and infers known extensions", async () => {
  assert.equal(inferOutputFormat("@assets/photo.jpg"), "jpeg");
  await assert.rejects(
    () => resolveOutputPaths({ cwd: "/tmp", outputPath: "asset.jpg", outputFormat: "png", prompt: "x", count: 1 }),
    /conflicts with outputFormat/,
  );
});
