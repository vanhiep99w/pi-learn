import path from "node:path";
import { contentToText, makeExcerpt, toolCallsFromAssistantMessage } from "./content.js";
import { redactValue, isSensitivePath } from "../safety/redaction.js";
import { extractErrorLines, headTail } from "../safety/truncation.js";

export function normalizeSessionEvents({ parsed, tree, project }) {
  const events = [];
  let eventIndex = 0;

  for (const entry of parsed.entries) {
    if (!entry.id) continue;
    const activePath = tree.activePathSet.has(entry.id);
    const base = makeBaseEvent({ parsed, project, entry, activePath, eventIndex: ++eventIndex });

    switch (entry.type) {
      case "message":
        events.push(...normalizeMessage(base, entry));
        break;
      case "model_change":
        events.push({
          ...base,
          kind: "model_change",
          summary: `model changed to ${entry.provider ?? "unknown"}/${entry.modelId ?? "unknown"}`,
          model: { provider: entry.provider, model: entry.modelId },
        });
        break;
      case "thinking_level_change":
        events.push({
          ...base,
          kind: "thinking_change",
          summary: `thinking changed to ${entry.thinkingLevel ?? "unknown"}`,
          model: { thinkingLevel: entry.thinkingLevel },
        });
        break;
      case "compaction":
        events.push({
          ...base,
          kind: "compaction",
          summary: "context compaction",
          contentStats: { chars: String(entry.summary ?? "").length },
        });
        break;
      case "branch_summary":
        events.push({
          ...base,
          kind: "branch_summary",
          summary: "branch summary",
          contentStats: { chars: String(entry.summary ?? "").length },
        });
        break;
      case "custom": {
        const harnessMarker = normalizeHarnessMarker(entry);
        events.push({
          ...base,
          kind: "custom",
          summary: harnessMarker ? "harness marker" : `custom entry ${entry.customType ?? "unknown"}`,
          harnessMarker,
        });
        break;
      }
      case "custom_message":
        events.push(withExcerpt({ ...base, kind: "custom_message", summary: `custom message ${entry.customType ?? "unknown"}` }, entry.content, 1000));
        break;
      case "label":
        events.push({ ...base, kind: "label", summary: `label ${entry.label ?? "cleared"}`, label: { targetId: entry.targetId, label: entry.label } });
        break;
      case "session_info":
        events.push({ ...base, kind: "session_info", summary: `session info ${entry.name ?? ""}`.trim(), sessionInfo: { name: entry.name } });
        break;
      default:
        events.push({ ...base, kind: "unknown", summary: `unknown entry type: ${entry.type}` });
    }
  }

  // Ordinals are assigned only after one source entry has expanded into its
  // final event sequence. Event IDs remain unchanged for cache compatibility.
  return events.map((event, index) => finalizeEvent({ ...event, ordinal: index + 1 }));
}

function normalizeHarnessMarker(entry) {
  if (entry.customType !== "harness-tag") return undefined;
  const tag = entry.data?.tag;
  if (tag !== "success" && tag !== "failure") return undefined;
  return { tag };
}

function normalizeMessage(base, entry) {
  const message = entry.message ?? {};
  const role = message.role;

  if (role === "user") return [withExcerpt({ ...base, kind: "user_message", summary: "user message" }, message.content, 1000)];

  if (role === "assistant") {
    const assistantEvent = withExcerpt({
      ...base,
      kind: "assistant_message",
      summary: "assistant message",
      model: {
        provider: message.provider,
        model: message.model,
        stopReason: message.stopReason,
      },
      usage: normalizeUsage(message.usage),
    }, message.content, 1500);

    const toolEvents = toolCallsFromAssistantMessage(message).map((toolCall, index) => {
      const redactedArgs = redactValue(toolCall.arguments ?? {});
      return finalizeEvent({
        ...base,
        eventId: `${base.eventId}_tool_${index + 1}`,
        kind: "assistant_tool_call",
        summary: `tool call ${toolCall.name ?? "unknown"}`,
        tool: {
          name: toolCall.name,
          callId: toolCall.id,
          argsPreview: limitArgsPreview(redactedArgs.value),
        },
        files: extractFilesFromToolCall(toolCall),
        safety: {
          ...base.safety,
          redacted: base.safety.redacted || redactedArgs.redacted,
          secretDetected: base.safety.secretDetected || redactedArgs.secretDetected,
          sensitivePath: hasSensitiveToolPath(toolCall),
        },
      });
    });

    return [assistantEvent, ...toolEvents];
  }

  if (role === "toolResult") {
    const isError = typeof message.isError === "boolean" ? message.isError : undefined;
    return [withExcerpt({
      ...base,
      kind: "tool_result",
      summary: `${message.toolName ?? "tool"} result${isError === true ? " error" : ""}`,
      tool: {
        name: message.toolName,
        callId: message.toolCallId,
        ...(typeof isError === "boolean" ? { isError } : {}),
      },
    }, message.content, 2000)];
  }

  if (role === "bashExecution") {
    const output = message.output ?? "";
    const outputPreview = headTail(output, 1000, 3000);
    return [finalizeEvent({
      ...base,
      kind: "bash_execution",
      summary: `bash ${message.exitCode === 0 ? "succeeded" : "failed"}`,
      bash: {
        command: message.command,
        exitCode: message.exitCode,
        cancelled: Boolean(message.cancelled),
        truncated: Boolean(message.truncated || outputPreview.truncated),
        errorLines: extractErrorLines(output),
        outputHead: outputPreview.head,
        outputTail: outputPreview.tail,
        fullOutputPath: message.fullOutputPath,
      },
      contentStats: {
        chars: output.length,
        lines: output ? output.split(/\r?\n/).length : 0,
        truncated: Boolean(message.truncated || outputPreview.truncated),
      },
    })];
  }

  return [withExcerpt({ ...base, kind: "unknown", summary: `unknown message role: ${role ?? "missing"}` }, message.content, 1000)];
}

function makeBaseEvent({ parsed, project, entry, activePath, eventIndex }) {
  return {
    schemaVersion: 1,
    eventId: `${entry.id}_${String(eventIndex).padStart(6, "0")}`,
    sessionId: parsed.header?.id,
    projectKey: project.projectKey,
    sessionFile: parsed.sessionFile,
    entryId: entry.id,
    parentId: entry.parentId ?? null,
    timestamp: entry.timestamp,
    cwd: parsed.header?.cwd,
    activePath,
    safety: {
      redacted: false,
      sensitivePath: false,
      secretDetected: false,
    },
    rawRef: {
      sessionFile: parsed.sessionFile,
      entryId: entry.id,
    },
  };
}

function withExcerpt(event, content, maxChars) {
  const text = contentToText(content);
  const excerpt = makeExcerpt(text, maxChars);
  return finalizeEvent({
    ...event,
    excerpt: excerpt.excerpt,
    contentStats: excerpt.stats,
    safety: {
      ...event.safety,
      redacted: event.safety.redacted || excerpt.safety.redacted,
      secretDetected: event.safety.secretDetected || excerpt.safety.secretDetected,
    },
  });
}

function finalizeEvent(event) {
  const redacted = redactValue(event);
  const value = redacted.value;
  value.safety = {
    redacted: Boolean(value.safety?.redacted || redacted.redacted),
    sensitivePath: Boolean(value.safety?.sensitivePath),
    secretDetected: Boolean(value.safety?.secretDetected || redacted.secretDetected),
  };
  return value;
}

function normalizeUsage(usage) {
  if (!usage) return undefined;
  return {
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    costTotal: usage.cost?.total ?? usage.costTotal ?? 0,
  };
}

function extractFilesFromToolCall(toolCall) {
  const paths = [];
  collectPathLikeValues(toolCall.arguments, paths);
  const unique = [...new Set(paths)].slice(0, 50);
  if (!unique.length) return undefined;

  const result = { mentioned: unique };
  if (["read", "web_fetch"].includes(toolCall.name)) result.read = unique;
  if (["write", "edit"].includes(toolCall.name)) result.written = unique;
  return result;
}

function collectPathLikeValues(value, output) {
  if (typeof value === "string") {
    if (looksLikePath(value)) output.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectPathLikeValues(item, output);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/path|file|dir|glob/i.test(key) && typeof item === "string") output.push(item);
    else collectPathLikeValues(item, output);
  }
}

function looksLikePath(value) {
  return value.includes("/") || value.startsWith(".") || path.extname(value) !== "";
}

function hasSensitiveToolPath(toolCall) {
  const paths = [];
  collectPathLikeValues(toolCall.arguments, paths);
  return paths.some(isSensitivePath);
}

function limitArgsPreview(value) {
  const text = JSON.stringify(value);
  if (text.length <= 1000) return value;
  return { preview: `${text.slice(0, 1000)}...<truncated>` };
}
