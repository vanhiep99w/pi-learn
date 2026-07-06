export function computeSessionMetrics({ projectKey, sessionId, events, tree }) {
  const metrics = {
    schemaVersion: 1,
    projectKey,
    sessionId,
    turns: 0,
    assistantMessages: 0,
    userMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    toolErrors: 0,
    bashCommands: 0,
    bashFailures: 0,
    compactions: 0,
    branches: tree?.branchCount ?? 0,
    modelChanges: 0,
    thinkingChanges: 0,
    labels: {},
    models: {},
    topTools: {},
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      costTotal: 0,
    },
    safety: {
      sensitivePathEvents: 0,
      secretDetectedEvents: 0,
      redactedEvents: 0,
    },
  };

  for (const event of events) {
    if (!event.activePath) continue;

    if (event.kind === "user_message") metrics.userMessages++;
    else if (event.kind === "assistant_message") metrics.assistantMessages++;
    else if (event.kind === "assistant_tool_call") {
      metrics.toolCalls++;
      if (event.tool?.name === "bash") metrics.bashCommands++;
    } else if (event.kind === "tool_result") {
      metrics.toolResults++;
      if (event.tool?.isError) metrics.toolErrors++;
      if (event.tool?.name === "bash" && event.tool?.isError) metrics.bashFailures++;
    } else if (event.kind === "bash_execution") {
      metrics.bashCommands++;
      if (event.bash?.exitCode && event.bash.exitCode !== 0) metrics.bashFailures++;
    } else if (event.kind === "compaction") metrics.compactions++;
    else if (event.kind === "model_change") metrics.modelChanges++;
    else if (event.kind === "thinking_change") metrics.thinkingChanges++;
    else if (event.kind === "label" && event.label?.label) {
      increment(metrics.labels, event.label.label);
    }

    if (event.model?.model) increment(metrics.models, `${event.model.provider ?? "unknown"}/${event.model.model}`);
    if (event.kind === "assistant_tool_call" && event.tool?.name) increment(metrics.topTools, event.tool.name);
    addUsage(metrics.usage, event.usage);

    if (event.safety?.sensitivePath) metrics.safety.sensitivePathEvents++;
    if (event.safety?.secretDetected) metrics.safety.secretDetectedEvents++;
    if (event.safety?.redacted) metrics.safety.redactedEvents++;
  }

  metrics.turns = metrics.userMessages;
  return metrics;
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function addUsage(total, usage) {
  if (!usage) return;
  total.input += usage.input ?? 0;
  total.output += usage.output ?? 0;
  total.cacheRead += usage.cacheRead ?? 0;
  total.cacheWrite += usage.cacheWrite ?? 0;
  total.totalTokens += usage.totalTokens ?? 0;
  total.costTotal += usage.costTotal ?? 0;
}
