import fs from "node:fs";
import path from "node:path";
import { createProjectKey } from "./project-key.js";
import { realpathIfExists, resolvePath } from "../utils/path.js";

export function findGitRoot(startDir) {
  let current = path.resolve(startDir);

  try {
    const stat = fs.statSync(current);
    if (!stat.isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }

  while (true) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) return current;

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveProject(projectCwd = process.cwd()) {
  const cwd = realpathIfExists(resolvePath(projectCwd));
  const gitRoot = findGitRoot(cwd);
  const projectRoot = realpathIfExists(gitRoot ?? cwd);
  const projectKey = createProjectKey(projectRoot);

  return {
    cwd,
    gitRoot: gitRoot ? realpathIfExists(gitRoot) : undefined,
    projectRoot,
    projectKey,
    name: path.basename(projectRoot) || "root",
  };
}
