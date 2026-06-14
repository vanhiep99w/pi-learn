import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./atomic-write.js";
import { resolvePath } from "../utils/path.js";

export function resolveHarnessHome(config = {}) {
  return resolvePath(config.harnessHome ?? "~/.pi/harness");
}

export function ensureHarnessHome(config = {}) {
  const harnessHome = resolveHarnessHome(config);
  ensureDir(harnessHome);
  ensureDir(path.join(harnessHome, "projects"));
  return harnessHome;
}

export function checkWritableDirectory(dirPath) {
  ensureDir(dirPath);
  const probe = path.join(dirPath, `.write-test-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  return true;
}

export function projectCacheDir(harnessHome, projectKey) {
  return path.join(harnessHome, "projects", projectKey);
}
