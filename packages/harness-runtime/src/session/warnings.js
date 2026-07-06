const KNOWN_ENTRY_TYPES = new Set([
  "message",
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
]);

const KNOWN_MESSAGE_ROLES = new Set([
  "user",
  "assistant",
  "toolResult",
  "bashExecution",
]);

export function collectNormalizeWarnings(parsed) {
  const warnings = [];

  for (const entry of parsed.entries ?? []) {
    if (!entry?.id) continue;

    if (!KNOWN_ENTRY_TYPES.has(entry.type)) {
      warnings.push(createSessionWarning({
        code: "unknown_entry_type",
        message: `Unknown entry type: ${entry.type ?? "missing"}`,
        sessionFile: parsed.sessionFile,
        lineNumber: entry.__lineNumber,
        entryId: entry.id,
      }));
      continue;
    }

    if (entry.type === "message") {
      const role = entry.message?.role;
      if (!KNOWN_MESSAGE_ROLES.has(role)) {
        warnings.push(createSessionWarning({
          code: "unknown_message_role",
          message: `Unknown message role: ${role ?? "missing"}`,
          sessionFile: parsed.sessionFile,
          lineNumber: entry.__lineNumber,
          entryId: entry.id,
        }));
      }
    }
  }

  return warnings;
}

export function enrichWarnings(warnings, { parsed, project } = {}) {
  return (warnings ?? []).map((warning) => ({
    schemaVersion: 1,
    sessionId: warning.sessionId ?? parsed?.header?.id,
    projectKey: warning.projectKey ?? project?.projectKey,
    lineNumber: warning.lineNumber,
    entryId: warning.entryId,
    code: warning.code,
    message: warning.message,
    sessionFile: warning.sessionFile ?? parsed?.sessionFile,
    timestamp: warning.timestamp ?? new Date().toISOString(),
  }));
}

function createSessionWarning({ code, message, sessionFile, lineNumber, entryId }) {
  return {
    schemaVersion: 1,
    code,
    message,
    sessionFile,
    lineNumber,
    entryId,
    timestamp: new Date().toISOString(),
  };
}
