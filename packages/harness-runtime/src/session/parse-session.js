import fs from "node:fs";
import readline from "node:readline";

export async function parseSessionFile(sessionFile) {
  const warnings = [];
  const entries = [];
  let header;
  let lineNumber = 0;

  const stream = fs.createReadStream(sessionFile, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      lineNumber++;
      if (!line.trim()) continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        warnings.push(createParseWarning({
          code: "malformed_json",
          message: `Malformed JSON at line ${lineNumber}: ${error.message}`,
          sessionFile,
          lineNumber,
        }));
        continue;
      }

      if (lineNumber === 1 && parsed?.type === "session") {
        header = parsed;
        continue;
      }

      if (!header && parsed?.type === "session") {
        header = parsed;
        warnings.push(createParseWarning({
          code: "session_header_not_first",
          message: `Session header found after line 1 at line ${lineNumber}`,
          sessionFile,
          lineNumber,
        }));
        continue;
      }

      if (parsed?.type === "session") {
        warnings.push(createParseWarning({
          code: "duplicate_session_header",
          message: `Duplicate session header at line ${lineNumber}`,
          sessionFile,
          lineNumber,
        }));
        continue;
      }

      if (!parsed?.id) {
        warnings.push(createParseWarning({
          code: "missing_id",
          message: `Entry at line ${lineNumber} is missing id`,
          sessionFile,
          lineNumber,
        }));
      }

      entries.push({
        ...parsed,
        __lineNumber: lineNumber,
      });
    }
  } finally {
    rl.close();
  }

  if (!header) {
    warnings.push(createParseWarning({
      code: "missing_header",
      message: `Session file has no session header: ${sessionFile}`,
      sessionFile,
    }));
  }

  const stat = fs.statSync(sessionFile);

  return {
    sessionFile,
    header,
    entries,
    warnings,
    stats: {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mtime: stat.mtime.toISOString(),
      lineCount: lineNumber,
    },
  };
}

export function summarizeEntry(entry) {
  const base = {
    id: entry.id,
    parentId: entry.parentId ?? null,
    type: entry.type,
    timestamp: entry.timestamp,
    lineNumber: entry.__lineNumber,
  };

  if (entry.type === "message") {
    return {
      ...base,
      role: entry.message?.role,
      toolName: entry.message?.toolName,
      isError: entry.message?.isError,
      model: entry.message?.model,
      provider: entry.message?.provider,
      stopReason: entry.message?.stopReason,
      toolCalls: countToolCalls(entry.message),
    };
  }

  if (entry.type === "model_change") {
    return {
      ...base,
      provider: entry.provider,
      modelId: entry.modelId,
    };
  }

  if (entry.type === "thinking_level_change") {
    return {
      ...base,
      thinkingLevel: entry.thinkingLevel,
    };
  }

  if (entry.type === "compaction") {
    return {
      ...base,
      firstKeptEntryId: entry.firstKeptEntryId,
      tokensBefore: entry.tokensBefore,
    };
  }

  if (entry.type === "branch_summary") {
    return {
      ...base,
      fromId: entry.fromId,
    };
  }

  if (entry.type === "custom" || entry.type === "custom_message") {
    return {
      ...base,
      customType: entry.customType,
      display: entry.display,
    };
  }

  if (entry.type === "label") {
    return {
      ...base,
      targetId: entry.targetId,
      label: entry.label,
    };
  }

  if (entry.type === "session_info") {
    return {
      ...base,
      name: entry.name,
    };
  }

  return base;
}

function countToolCalls(message) {
  if (!message || !Array.isArray(message.content)) return 0;
  return message.content.filter((block) => block?.type === "toolCall").length;
}

export function createParseWarning({ code, message, sessionFile, lineNumber, entryId }) {
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
