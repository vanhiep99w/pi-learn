import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ImageGenOutputError, redactSensitiveText } from "../errors.ts";

export type ImageValidationMetadata = {
  mime: boolean;
  dimensions: boolean;
  alpha: "present" | "missing" | "not-requested";
  width: number;
  height: number;
  bytes: number;
};

export type ImageMetadata = {
  schemaVersion: 1;
  createdAt: string;
  userPrompt: string;
  compiledPrompt: string;
  revisedPrompt?: string;
  mode: "generate" | "edit";
  intent: "generate" | "generate-with-reference" | "edit";
  useCase: string;
  backend: "subscription" | "api";
  responseModel: string;
  imageModel: string;
  strategy: string;
  size: string;
  quality: string;
  background: string;
  outputFormat: string;
  savedPath: string;
  referencePaths: string[];
  validation: ImageValidationMetadata;
  fallbackUsed: boolean;
};

export async function saveImageWithMetadata(
  savedPath: string,
  data: Uint8Array,
  metadata: ImageMetadata,
  overwrite: boolean,
): Promise<string> {
  const metadataPath = `${savedPath}.json`;

  return withFileMutationQueue(savedPath, async () => {
    await mkdir(dirname(savedPath), { recursive: true });
    const nonce = `${process.pid}-${crypto.randomUUID()}`;
    const imageTemp = `${savedPath}.${nonce}.tmp`;
    const metadataTemp = `${metadataPath}.${nonce}.tmp`;
    const imageBackup = `${savedPath}.${nonce}.bak`;
    const metadataBackup = `${metadataPath}.${nonce}.bak`;
    const backups: Array<[string, string]> = [];
    const installed: string[] = [];

    try {
      if (!overwrite && ((await exists(savedPath)) || (await exists(metadataPath)))) {
        throw new ImageGenOutputError(`Refusing to overwrite existing image or metadata: ${savedPath}. Set overwrite=true to replace it.`);
      }

      await writeFile(imageTemp, data, { mode: 0o644 });
      await writeFile(metadataTemp, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });

      if (overwrite && (await exists(savedPath))) {
        await rename(savedPath, imageBackup);
        backups.push([imageBackup, savedPath]);
      }
      if (overwrite && (await exists(metadataPath))) {
        await rename(metadataPath, metadataBackup);
        backups.push([metadataBackup, metadataPath]);
      }

      await rename(imageTemp, savedPath);
      installed.push(savedPath);
      await rename(metadataTemp, metadataPath);
      installed.push(metadataPath);

      await Promise.all(backups.map(([backup]) => unlink(backup).catch(() => undefined)));
      return metadataPath;
    } catch (error) {
      for (const path of installed.reverse()) await unlink(path).catch(() => undefined);
      for (const [backup, original] of backups.reverse()) await rename(backup, original).catch(() => undefined);
      if (error instanceof ImageGenOutputError) throw error;
      throw new ImageGenOutputError(`Failed to save generated image: ${redactSensitiveText(error)}`, { cause: error });
    } finally {
      await Promise.all([
        unlink(imageTemp).catch(() => undefined),
        unlink(metadataTemp).catch(() => undefined),
      ]);
    }
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
