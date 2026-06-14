import fs from "node:fs";
import path from "node:path";

// Phase 3 cache writer will use these helpers for manifest/events/metrics/warnings.
export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function atomicWriteFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

export function atomicWriteJson(filePath, value) {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function atomicWriteJsonl(filePath, values) {
  const content = values.map((value) => JSON.stringify(value)).join("\n");
  atomicWriteFile(filePath, content ? `${content}\n` : "");
}
