import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import test from "node:test";
import {
  inferOutputFormat,
  resolveMetadataPath,
  resolveOutputPaths,
  workspaceMarkdownImage,
} from "../../extensions/image-gen/storage/paths.ts";

const fixedDate = new Date("2026-06-01T01:02:03.000Z");

test("defaults to the current workspace root", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-image-paths-"));
  try {
    const [path] = await resolveOutputPaths({
      cwd,
      outputFormat: "png",
      prompt: "Product hero",
      count: 1,
      now: fixedDate,
      id: "fixed",
    });
    assert.equal(path, join(cwd, "product-hero-2026-06-01T01-02-03-000Z-fixed.png"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

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

test("stores metadata in the global Pi image-gen directory", () => {
  const metadataPath = resolveMetadataPath(
    "/workspace/demo-project",
    "/workspace/demo-project/assets/hero.png",
    "batch-123",
    0,
  );
  const metadataRoot = join(homedir(), ".pi", "agent", "image-gen", "metadata");
  assert.ok(metadataPath.startsWith(`${metadataRoot}${sep}`));
  assert.match(relative(metadataRoot, metadataPath).split(sep).join("/"), /demo-project-[a-f0-9]{12}\/hero-png-batch-123-1\.json$/);
  assert.notEqual(metadataPath, "/workspace/demo-project/assets/hero.png.json");
});

test("formats workspace images as Paseo-compatible Markdown", () => {
  assert.equal(
    workspaceMarkdownImage("/workspace/demo", "/workspace/demo/assets/dog image (final).png", 0),
    "![Generated image 1](./assets/dog%20image%20%28final%29.png)",
  );
  assert.equal(workspaceMarkdownImage("/workspace/demo", "/workspace/outside.png", 0), undefined);
});

test("rejects format conflicts and infers known extensions", async () => {
  assert.equal(inferOutputFormat("@assets/photo.jpg"), "jpeg");
  await assert.rejects(
    () => resolveOutputPaths({ cwd: "/tmp", outputPath: "asset.jpg", outputFormat: "png", prompt: "x", count: 1 }),
    /conflicts with outputFormat/,
  );
});
