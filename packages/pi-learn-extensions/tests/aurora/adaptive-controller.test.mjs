import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAdaptiveController } from "../../extensions/aurora/adaptive-controller.ts";

const source = JSON.parse(readFileSync(new URL("../../themes/midnight-aurora.json", import.meta.url), "utf8"));
function fixture() {
  const original = { name: "midnight-aurora" };
  let active = original, background = "#0b1020";
  const applied = [], queries = [], restores = [];
  let query = async () => background;
  const controller = createAdaptiveController({
    source,
    active: () => active,
    fallbackBackground: () => "#0b1020",
    queryBackground: (onLate) => { queries.push(onLate); return query(); },
    apply: (generated, reported) => {
      const next = { ...generated, auroraAdaptive: { background: generated.background, appearance: generated.appearance, reported } };
      applied.push(next);
      active = next;
      return next;
    },
    restore: () => { restores.push(true); active = original; },
  });
  return {
    controller, original, applied, queries, restores,
    get active() { return active; },
    set active(value) { active = value; },
    set background(value) { background = value; },
    set query(value) { query = value; },
  };
}

test("adapts dark to light without changing the public theme name", async () => {
  const f = fixture();
  await f.controller.refresh();
  assert.equal(f.active.name, "midnight-aurora");
  assert.equal(f.active.appearance, "dark");
  assert.match(f.controller.status(), /terminal/);
  const count = f.applied.length;
  await f.controller.refresh();
  assert.equal(f.applied.length, count, "unchanged background must not rebuild the theme");
  f.background = "#ffffff";
  await f.controller.refresh();
  assert.equal(f.active.appearance, "light");
  assert.match(f.controller.status(), /#ffffff/);
});

test("does not query or replace system or other selected themes", async () => {
  const f = fixture();
  f.active = { name: "system" };
  await f.controller.refresh();
  assert.equal(f.queries.length, 0);
  assert.equal(f.applied.length, 0);
  f.active = f.original;
  await f.controller.refresh();
  f.active = { name: "light" };
  const count = f.applied.length;
  f.controller.disable();
  assert.equal(f.restores.length, 0);
  assert.equal(f.applied.length, count);
});

test("off restores the static palette and auto reenables adaptation", async () => {
  const f = fixture();
  await f.controller.refresh();
  f.controller.disable();
  assert.equal(f.active, f.original);
  assert.equal(f.restores.length, 1);
  assert.match(f.controller.status(), /tắt/);
  await f.controller.refresh();
  assert.equal(f.active, f.original);
  await f.controller.enable();
  assert.ok(f.active.auroraAdaptive);
});

test("missing replies keep a fallback and stop repeated unsupported terminal queries", async () => {
  const f = fixture();
  f.query = async () => undefined;
  await f.controller.refresh();
  assert.match(f.controller.status(), /nền dự đoán/);
  await f.controller.refresh();
  assert.equal(f.queries.length, 1);
  f.background = "#ffffff";
  f.query = async () => "#ffffff";
  await f.controller.enable();
  assert.equal(f.queries.length, 2);
  assert.equal(f.active.appearance, "light");
});

test("a valid late reply can replace the fallback after the query timeout", async () => {
  const f = fixture();
  f.query = async () => undefined;
  await f.controller.refresh();
  f.queries[0]("#ffffff");
  assert.equal(f.active.appearance, "light");
  assert.match(f.controller.status(), /terminal/);
});

test("late replies cannot replace a newly selected theme, even the same name", async () => {
  const f = fixture();
  let complete;
  f.query = () => new Promise((resolve) => { complete = resolve; });
  const pending = f.controller.refresh();
  const chosen = { name: "midnight-aurora" };
  f.active = chosen;
  complete("#ffffff");
  await pending;
  f.queries[0]("#ffffff");
  assert.equal(f.active, chosen);
});

test("disposal blocks in-flight and late replies and never accesses stale contexts", async () => {
  const f = fixture();
  let complete;
  f.query = () => new Promise((resolve) => { complete = resolve; });
  const pending = f.controller.refresh();
  f.controller.dispose();
  const count = f.applied.length;
  complete("#ffffff");
  await pending;
  f.queries[0]("#ffffff");
  await f.controller.enable();
  assert.equal(f.applied.length, count);
});

test("disabled controller rejects replies from an earlier query", async () => {
  const f = fixture();
  let complete;
  f.query = () => new Promise((resolve) => { complete = resolve; });
  const pending = f.controller.refresh();
  f.controller.disable();
  complete("#ffffff");
  await pending;
  f.queries[0]("#ffffff");
  assert.equal(f.active, f.original);
});

test("query rejection preserves usable colors and reports the failure", async () => {
  const f = fixture();
  f.query = async () => { throw new Error("terminal unavailable"); };
  await f.controller.refresh();
  assert.ok(f.active.auroraAdaptive);
  assert.match(f.controller.status(), /terminal unavailable/);
  await f.controller.refresh();
  assert.equal(f.queries.length, 1);
});
