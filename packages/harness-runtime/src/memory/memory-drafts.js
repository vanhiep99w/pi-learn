import fs from "node:fs";
import path from "node:path";
import { atomicWriteJsonl, ensureDir } from "../storage/atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "../storage/harness-home.js";

export function writeMemoryDrafts({ config, project, items }) {
  const memoryDir = path.join(projectCacheDir(resolveHarnessHome(config), project.projectKey), "memory");
  ensureDir(memoryDir);

  const draftPath = path.join(memoryDir, "draft.jsonl");
  const existing = readMemoryDrafts({ config, project });
  const seen = new Set(existing.map((item) => item.fingerprint ?? item.id).filter(Boolean));
  const written = [];
  let nextNumber = nextMemoryNumber(existing);

  for (const item of items ?? []) {
    const key = item.fingerprint ?? item.text;
    if (seen.has(key)) continue;
    const finalItem = {
      ...item,
      id: item.id ?? `M-${String(nextNumber++).padStart(4, "0")}`,
      status: item.status ?? "draft",
      createdAt: item.createdAt ?? new Date().toISOString(),
      updatedAt: item.updatedAt ?? new Date().toISOString(),
    };
    existing.push(finalItem);
    written.push(finalItem);
    seen.add(key);
  }

  atomicWriteJsonl(draftPath, existing);
  return { memoryDir, draftPath, written };
}

export function readMemoryDrafts({ config, project }) {
  const draftPath = path.join(projectCacheDir(resolveHarnessHome(config), project.projectKey), "memory", "draft.jsonl");
  if (!fs.existsSync(draftPath)) return [];
  return fs.readFileSync(draftPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function nextMemoryNumber(items) {
  return items.reduce((max, item) => {
    const match = item.id?.match(/^M-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}
