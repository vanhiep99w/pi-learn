import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSessionEvents } from "../src/normalize/events.js";
import { collectNormalizeWarnings } from "../src/session/warnings.js";

const PROJECT_ROOT = "/synthetic/project";

for (const [label, isError] of [
  ["missing", undefined],
  ["null", null],
  ["string", "false"],
  ["number", 0],
]) {
  test(`nonboolean tool result status remains ambiguous and warns: ${label}`, () => {
    const timestamp = "2026-08-04T00:00:00.000Z";
    const message = {
      role: "toolResult",
      toolCallId: "edit-1",
      toolName: "edit",
      content: "result",
    };
    if (label !== "missing") message.isError = isError;
    const entry = { type: "message", id: "result-1", parentId: null, timestamp, message, __lineNumber: 2 };
    const parsed = {
      entries: [entry],
      sessionFile: "/synthetic/session.jsonl",
      header: { id: "session-1", cwd: PROJECT_ROOT },
    };

    const warnings = collectNormalizeWarnings(parsed);
    const events = normalizeSessionEvents({
      parsed,
      tree: { activePathSet: new Set([entry.id]) },
      project: { projectKey: "project-synthetic" },
    });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, "nonboolean_tool_result_status");
    assert.equal(events[0].tool.isError, undefined);
    assert.equal(Object.hasOwn(events[0].tool, "isError"), false);
    assert.doesNotMatch(events[0].summary, /error/);
  });
}

test("actual boolean tool result statuses remain exact without ambiguity warnings", () => {
  for (const isError of [false, true]) {
    const entry = {
      type: "message",
      id: `result-${isError}`,
      parentId: null,
      timestamp: "2026-08-04T00:00:00.000Z",
      __lineNumber: 2,
      message: { role: "toolResult", toolCallId: "edit-1", toolName: "edit", isError, content: "result" },
    };
    const parsed = { entries: [entry], sessionFile: "/synthetic/session.jsonl", header: { id: "session-1", cwd: PROJECT_ROOT } };
    const [normalized] = normalizeSessionEvents({
      parsed,
      tree: { activePathSet: new Set([entry.id]) },
      project: { projectKey: "project-synthetic" },
    });
    assert.equal(collectNormalizeWarnings(parsed).length, 0);
    assert.equal(normalized.tool.isError, isError);
  }
});
