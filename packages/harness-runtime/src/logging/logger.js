import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../storage/atomic-write.js";
import { redactValue } from "../safety/redaction.js";

export function createLogger({ config, command, project } = {}) {
  const enabled = config?.logging?.enabled !== false;
  const runId = `run_${crypto.randomUUID()}`;
  const logDir = config?.logging?.logDir ?? path.join(config?.harnessHome ?? ".", "logs");
  let counter = 0;

  function log(level, event, message, data = {}) {
    if (!enabled) return;
    const stream = streamForLevel(level, event);
    const logEvent = redactValue({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      level,
      stream,
      event,
      runId,
      eventId: `evt_${String(++counter).padStart(6, "0")}`,
      command,
      component: data.component ?? "cli",
      projectKey: data.projectKey ?? project?.projectKey,
      sessionId: data.sessionId,
      sessionFile: data.sessionFile,
      entryId: data.entryId,
      ruleId: data.ruleId,
      proposalId: data.proposalId,
      evalId: data.evalId,
      message,
      data: data.data,
      safety: {
        redacted: false,
        containsRawContent: Boolean(data.containsRawContent),
        containsSecret: false,
      },
    }).value;

    logEvent.safety.redacted = true;
    appendLog(logDir, stream, logEvent);

    if (config?.logging?.console) {
      console.error(`[${level}] ${event}: ${message}`);
    }
  }

  return {
    runId,
    debug: (event, message, data) => log("debug", event, message, data),
    info: (event, message, data) => log("info", event, message, data),
    warn: (event, message, data) => log("warn", event, message, data),
    error: (event, message, data) => log("error", event, message, data),
    audit: (event, message, data) => log("audit", event, message, data),
  };
}

function appendLog(logDir, stream, event) {
  const day = event.timestamp.slice(0, 10);
  const file = path.join(logDir, folderForStream(stream), `${day}.jsonl`);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
}

function streamForLevel(level, event) {
  if (level === "audit") return "audit";
  if (level === "error") return "error";
  if (/warning|proposal|rule|redaction|parser/.test(event)) return "self_improvement";
  return "runtime";
}

function folderForStream(stream) {
  if (stream === "error") return "errors";
  if (stream === "self_improvement") return "self-improvement";
  return stream;
}
