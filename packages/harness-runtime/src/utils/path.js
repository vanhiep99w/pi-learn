import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(input) {
  if (!input || typeof input !== "string") return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function resolvePath(input, base = process.cwd()) {
  const expanded = expandHome(input);
  if (!expanded) return expanded;
  return path.resolve(base, expanded);
}

export function realpathIfExists(input) {
  try {
    return fs.realpathSync(input);
  } catch {
    return path.resolve(input);
  }
}

export function pathExists(input) {
  try {
    fs.accessSync(input);
    return true;
  } catch {
    return false;
  }
}

export function isDirectory(input) {
  try {
    return fs.statSync(input).isDirectory();
  } catch {
    return false;
  }
}
