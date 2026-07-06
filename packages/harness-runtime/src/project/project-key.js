import crypto from "node:crypto";
import path from "node:path";

export function createProjectKey(projectRoot) {
  const normalized = path.resolve(projectRoot);
  const baseName = path.basename(normalized) || "root";
  const hash = crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 6);
  return `${sanitizeProjectName(baseName)}-${hash}`;
}

export function sanitizeProjectName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}
