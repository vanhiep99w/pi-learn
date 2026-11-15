import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureWikiAgentBootstrap } from "../../extensions/wiki/wiki-bootstrap.ts";
import { createWikiAgentInstructions } from "../../extensions/wiki/wiki-prompt.ts";

const bootstrap = createWikiAgentInstructions();
async function fixture(t: test.TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), "pi-wiki-bootstrap-"));
  const root = path.join(base, "repo");
  await mkdir(root);
  t.after(() => rm(base, { recursive: true, force: true }));
  const file = (name: string) => path.join(root, name);
  const read = (name: string) => readFile(file(name), "utf8");
  return { base, root, file, read };
}

async function assertIdempotent(f: Awaited<ReturnType<typeof fixture>>) {
  const before = await Promise.all(["AGENTS.md", "CLAUDE.md"].map(async (name) => {
    try { return { name, content: await f.read(name), info: await stat(f.file(name)) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }));
  assert.deepEqual(await ensureWikiAgentBootstrap(f.root), []);
  for (const item of before) {
    if (!item) continue;
    assert.equal(await f.read(item.name), item.content);
    const after = await stat(f.file(item.name));
    assert.equal(after.ino, item.info.ino, "no replacement when already current");
    assert.equal(after.mtimeMs, item.info.mtimeMs, "no write when already current");
  }
}

test("missing agent files create only top-level AGENTS, never nested files", async (t) => {
  const f = await fixture(t);
  await mkdir(f.file("nested"));
  await writeFile(f.file("nested/CLAUDE.md"), "nested bytes\r\n");
  assert.deepEqual(await ensureWikiAgentBootstrap(f.root), ["AGENTS.md"]);
  assert.equal(await f.read("AGENTS.md"), bootstrap + "\n");
  await assert.rejects(f.read("CLAUDE.md"), { code: "ENOENT" });
  assert.equal(await f.read("nested/CLAUDE.md"), "nested bytes\r\n");
  await assertIdempotent(f);
});

for (const names of [["AGENTS.md"], ["CLAUDE.md"], ["AGENTS.md", "CLAUDE.md"]]) {
  test(`existing ${names.join(" and ")} are updated, missing counterpart is not created`, async (t) => {
    const f = await fixture(t);
    for (const name of names) await writeFile(f.file(name), `# ${name}\n\nKeep exact trailing spaces.  `);
    assert.deepEqual(await ensureWikiAgentBootstrap(f.root), names);
    for (const name of names) assert.equal(await f.read(name), `# ${name}\n\nKeep exact trailing spaces.  \n\n${bootstrap}\n`);
    assert.deepEqual((await readdir(f.root)).sort(), [...names].sort());
    await assertIdempotent(f);
  });
}

test("replace duplicate Wiki sections and their subsections, preserving all unrelated bytes", async (t) => {
  const f = await fixture(t);
  const prefix = "\ufeff# Agent guidance\r\n\r\nKeep tiếng Việt.  \r\n\r\n";
  const middle = "## Build\r\n\r\nKeep build.\t\r\n\r\n";
  const suffix = "# Independent\r\nKeep no final newline";
  await writeFile(f.file("AGENTS.md"), prefix + "## Project Wiki ###\r\nOld instructions\r\n### Detail\r\nOld detail\r\n\r\n" + middle + "## Project Wiki\r\nDuplicate\r\n\r\n" + suffix);
  await ensureWikiAgentBootstrap(f.root);
  const result = await f.read("AGENTS.md");
  assert.equal(result, prefix + bootstrap.replaceAll("\n", "\r\n") + "\r\n\r\n" + middle + "\r\n\r\n" + suffix);
  assert.equal(result.split("## Project Wiki").length - 1, 1);
  await assertIdempotent(f);
});

for (const [heading, level] of [["# Project Wiki", 1], ["### Project Wiki ###", 3], ["Project Wiki\n------------", 2], ["Project Wiki\n============", 1]] as const) {
  test(`heading boundary and idempotence: ${heading.replaceAll("\n", " / ")}`, async (t) => {
    const f = await fixture(t);
    const sibling = "#".repeat(level) + " Other\nUnrelated final bytes";
    await writeFile(f.file("AGENTS.md"), `${heading}\nStale\n\n${sibling}`);
    await ensureWikiAgentBootstrap(f.root);
    assert.equal(await f.read("AGENTS.md"), bootstrap.replace(/^## /u, "#".repeat(level) + " ") + "\n\n" + sibling);
    await assertIdempotent(f);
  });
}

test("fenced examples, comments, quoted and indented pseudo-headings remain untouched", async (t) => {
  const f = await fixture(t);
  const prefix = "# Guidance\n\n```markdown\n## Project Wiki\nExample\n```\n\n~~~~markdown\n## Project Wiki\n~~~\nStill fenced\n~~~~~\n\n<!--\n## Project Wiki\n-->\n\n> ## Project Wiki\n\n    ## Project Wiki\n\n";
  await writeFile(f.file("AGENTS.md"), prefix);
  await ensureWikiAgentBootstrap(f.root);
  assert.equal(await f.read("AGENTS.md"), prefix + bootstrap + "\n");
  await assertIdempotent(f);
});

test("headings inside a Wiki section's fence do not terminate that section", async (t) => {
  const f = await fixture(t);
  await writeFile(f.file("AGENTS.md"), "## Project Wiki\nOld\n```\n## Fake boundary\n```\n\n## Keep\nExact\n");
  await ensureWikiAgentBootstrap(f.root);
  assert.equal(await f.read("AGENTS.md"), bootstrap + "\n\n## Keep\nExact\n");
  await assertIdempotent(f);
});

for (const unsafe of ["directory", "symlink outside", "symlink inside", "dangling symlink", "fifo", "invalid UTF-8", "NUL", "unclosed fence", "unclosed comment"]) {
  test(`preflight refuses ${unsafe} without changing either target or outside files`, async (t) => {
    const f = await fixture(t);
    const original = "# Agent\nPreserve exact bytes\n";
    await writeFile(f.file("AGENTS.md"), original);
    const outside = path.join(f.base, "outside.md");
    await writeFile(outside, "Outside must never change\n");
    const target = f.file("CLAUDE.md");
    if (unsafe === "directory") await mkdir(target);
    else if (unsafe === "symlink outside") await symlink(outside, target);
    else if (unsafe === "symlink inside") await symlink(f.file("AGENTS.md"), target);
    else if (unsafe === "dangling symlink") await symlink(path.join(f.base, "missing"), target);
    else if (unsafe === "fifo") execFileSync("mkfifo", [target]);
    else await writeFile(target, unsafe === "invalid UTF-8" ? Buffer.from([0xff]) : unsafe === "NUL" ? "\0" : unsafe === "unclosed fence" ? "```\n## Project Wiki\n" : "<!--\n## Project Wiki\n");
    const before = await lstat(target);
    await assert.rejects(ensureWikiAgentBootstrap(f.root));
    assert.equal(await f.read("AGENTS.md"), original);
    assert.equal(await readFile(outside, "utf8"), "Outside must never change\n");
    assert.equal((await lstat(target)).ino, before.ino);
    assert.deepEqual((await readdir(f.root)).sort(), ["AGENTS.md", "CLAUDE.md"]);
  });
}

test("atomic replacement leaves an outside hard-link alias unchanged and retains target mode", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.base, "outside.md");
  await writeFile(outside, "# Existing\n", { mode: 0o640 });
  await link(outside, f.file("AGENTS.md"));
  await ensureWikiAgentBootstrap(f.root);
  assert.equal(await readFile(outside, "utf8"), "# Existing\n");
  assert.equal((await stat(f.file("AGENTS.md"))).mode & 0o777, 0o640);
  await assertIdempotent(f);
});
