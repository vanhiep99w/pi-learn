import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, realpathSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const pi = process.env.PI_TEST_BIN ?? execFileSync(process.platform === "win32" ? "where" : "which", ["pi"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
const sdk = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", 'console.log(JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent")))'], { cwd: path.dirname(realpathSync(pi)), encoding: "utf8" }));
const modules = path.resolve(path.dirname(fileURLToPath(sdk)), "../../..");
const source = fileURLToPath(new URL("../../extensions/subagents/vendor/thinkrail/", import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "pi-learn-subagents-upstream-"));
try {
  cpSync(source, path.join(root, "vendor"), { recursive: true });
  mkdirSync(path.join(root, "node_modules"));
  mkdirSync(path.join(root, "isolated-agent"));
  const link = (from, name) => symlinkSync(from, path.join(root, "node_modules", name), process.platform === "win32" ? "junction" : "dir");
  link(path.join(modules, "@earendil-works"), "@earendil-works");
  link(path.join(modules, "typebox"), "typebox");
  writeFileSync(path.join(root, "vendor/pi-delegation/package.json"), JSON.stringify({ name: "pi-delegation", type: "module", exports: "./index.ts" }));
  link(path.join(root, "vendor/pi-delegation"), "pi-delegation");
  const result = spawnSync("bun", ["test", "./vendor/pi-subagents/src", "./vendor/pi-delegation/src"], { cwd: root, stdio: "inherit", env: { ...process.env, PI_CODING_AGENT_DIR: path.join(root, "isolated-agent"), PI_OFFLINE: "1" } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(root, { recursive: true, force: true }); }
