import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ImageGenInputError } from "../errors.ts";
import type { ImageOutputFormat } from "../schema.ts";

export type OutputPathOptions = {
  cwd: string;
  outputPath?: string;
  outputFormat: ImageOutputFormat;
  prompt: string;
  count: number;
  now?: Date;
  id?: string;
};

export async function resolveOutputPaths(options: OutputPathOptions): Promise<string[]> {
  const extension = extensionForFormat(options.outputFormat);
  const now = options.now ?? new Date();
  const id = options.id ?? crypto.randomUUID().slice(0, 8);
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const semanticName = `${slugify(options.prompt)}-${timestamp}-${id}`;

  if (!options.outputPath) {
    return variants(resolve(options.cwd), semanticName, extension, options.count);
  }

  const cleaned = stripLeadingAt(options.outputPath.trim());
  if (!cleaned) throw new ImageGenInputError("outputPath must not be empty.");
  const expanded = cleaned === "~" || cleaned.startsWith(`~${sep}`)
    ? join(homedir(), cleaned.slice(2))
    : cleaned;
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(options.cwd, expanded);
  const existingDirectory = await isDirectory(absolute);
  const directoryHint = cleaned.endsWith("/") || cleaned.endsWith("\\");

  if (existingDirectory || directoryHint) return variants(absolute, semanticName, extension, options.count);

  const outputExtension = extname(absolute).toLowerCase();
  if (!outputExtension) {
    throw new ImageGenInputError("outputPath must be an existing directory, end with a path separator, or include .png, .webp, .jpg, or .jpeg.");
  }
  const pathFormat = formatForExtension(outputExtension);
  if (!pathFormat) throw new ImageGenInputError(`Unsupported outputPath extension: ${outputExtension}.`);
  if (pathFormat !== options.outputFormat) {
    throw new ImageGenInputError(`outputPath extension ${outputExtension} conflicts with outputFormat=${options.outputFormat}.`);
  }

  if (options.count === 1) return [absolute];
  const stem = absolute.slice(0, -outputExtension.length);
  return Array.from({ length: options.count }, (_, index) => `${stem}-${index + 1}${outputExtension}`);
}

export function inferOutputFormat(outputPath: string | undefined): ImageOutputFormat | undefined {
  if (!outputPath) return;
  const extension = extname(stripLeadingAt(outputPath.trim())).toLowerCase();
  return formatForExtension(extension);
}

export function resolveMetadataPath(cwd: string, savedPath: string, batchId: string, index: number): string {
  const canonicalCwd = resolve(cwd);
  const projectName = slugify(basename(canonicalCwd) || "project");
  const projectHash = createHash("sha256").update(canonicalCwd).digest("hex").slice(0, 12);
  const imageName = slugify(basename(savedPath));
  const generationId = batchId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16) || "generation";
  return join(
    homedir(),
    ".pi",
    "agent",
    "image-gen",
    "metadata",
    `${projectName}-${projectHash}`,
    `${imageName}-${generationId}-${index + 1}.json`,
  );
}

export function workspaceMarkdownImage(cwd: string, savedPath: string, index: number): string | undefined {
  const workspacePath = relative(resolve(cwd), resolve(savedPath));
  if (!workspacePath || isAbsolute(workspacePath) || workspacePath === ".." || workspacePath.startsWith(`..${sep}`)) {
    return;
  }
  const markdownPath = workspacePath
    .split(sep)
    .map(encodeMarkdownPathSegment)
    .join("/");
  return `![Generated image ${index + 1}](./${markdownPath})`;
}

export function stripLeadingAt(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function encodeMarkdownPathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function variants(directory: string, name: string, extension: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    join(directory, `${name}${count > 1 ? `-${index + 1}` : ""}${extension}`));
}

function extensionForFormat(format: ImageOutputFormat): string {
  if (format === "jpeg") return ".jpeg";
  return `.${format}`;
}

function formatForExtension(extension: string): ImageOutputFormat | undefined {
  if (extension === ".png") return "png";
  if (extension === ".webp") return "webp";
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
}

function slugify(prompt: string): string {
  const slug = prompt
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "image";
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
