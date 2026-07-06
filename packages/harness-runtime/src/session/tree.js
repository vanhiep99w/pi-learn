import { createParseWarning, summarizeEntry } from "./parse-session.js";

export function buildSessionTree(entries, sessionFile) {
  const warnings = [];
  const entryMap = new Map();
  const childrenByParent = new Map();
  const duplicateIds = [];
  const duplicateEntrySet = new Set();

  for (const entry of entries) {
    if (!entry.id) continue;
    if (entryMap.has(entry.id)) {
      duplicateIds.push(entry.id);
      duplicateEntrySet.add(entry);
      warnings.push(createParseWarning({
        code: "duplicate_id",
        message: `Duplicate entry id: ${entry.id}`,
        sessionFile,
        lineNumber: entry.__lineNumber,
        entryId: entry.id,
      }));
      continue;
    }
    entryMap.set(entry.id, entry);
  }

  for (const entry of entries) {
    if (!entry.id || duplicateEntrySet.has(entry)) continue;
    const parentId = entry.parentId ?? null;
    if (parentId !== null && !entryMap.has(parentId)) {
      warnings.push(createParseWarning({
        code: "missing_parent",
        message: `Entry ${entry.id} references missing parent ${parentId}`,
        sessionFile,
        lineNumber: entry.__lineNumber,
        entryId: entry.id,
      }));
    }
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(entry.id);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => {
      const aLine = entryMap.get(a)?.__lineNumber ?? 0;
      const bLine = entryMap.get(b)?.__lineNumber ?? 0;
      return aLine - bLine;
    });
  }

  const activeLeafId = findActiveLeafId(entries, duplicateEntrySet);
  const activePathEntryIds = activeLeafId ? walkParents(activeLeafId, entryMap, warnings, sessionFile) : [];
  const activePathSet = new Set(activePathEntryIds);
  const branchPoints = [];

  for (const [parentId, children] of childrenByParent.entries()) {
    if (children.length > 1) {
      branchPoints.push({
        parentId,
        children,
        activeChildren: children.filter((childId) => activePathSet.has(childId)),
      });
    }
  }

  return {
    entryMap,
    childrenByParent,
    activeLeafId,
    activePathEntryIds,
    activePathSet,
    branchPoints,
    branchCount: branchPoints.length,
    duplicateIds,
    warnings,
  };
}

export function findActiveLeafId(entries, duplicateEntrySet = new Set()) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.id && !duplicateEntrySet.has(entries[i])) return entries[i].id;
  }
  return undefined;
}

export function walkParents(leafId, entryMap, warnings = [], sessionFile) {
  const reversed = [];
  const seen = new Set();
  let currentId = leafId;

  while (currentId) {
    if (seen.has(currentId)) {
      warnings.push(createParseWarning({
        code: "parent_cycle",
        message: `Cycle detected while walking parents at ${currentId}`,
        sessionFile,
        entryId: currentId,
      }));
      break;
    }
    seen.add(currentId);

    const entry = entryMap.get(currentId);
    if (!entry) {
      warnings.push(createParseWarning({
        code: "missing_parent",
        message: `Missing entry while walking active path: ${currentId}`,
        sessionFile,
        entryId: currentId,
      }));
      break;
    }

    reversed.push(currentId);
    currentId = entry.parentId ?? null;
  }

  return reversed.reverse();
}

export function summarizeTree(tree, entries) {
  const byId = new Map(entries.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  return {
    activeLeafId: tree.activeLeafId,
    activePathEntryIds: tree.activePathEntryIds,
    branchCount: tree.branchCount,
    branchPoints: tree.branchPoints,
    entryCount: tree.entryMap.size,
    rawEntryIdCount: byId.size,
    roots: tree.childrenByParent.get(null) ?? [],
  };
}

export function renderTreeText(tree) {
  const lines = [];
  const rootIds = tree.childrenByParent.get(null) ?? [];

  for (let i = 0; i < rootIds.length; i++) {
    renderNode(rootIds[i], "", i === rootIds.length - 1);
  }

  return lines.join("\n");

  function renderNode(entryId, prefix, isLast) {
    const entry = tree.entryMap.get(entryId);
    if (!entry) return;

    const marker = tree.activePathSet.has(entryId) ? "*" : " ";
    const connector = prefix ? (isLast ? "└─" : "├─") : "";
    lines.push(`${prefix}${connector}${marker} ${formatEntryLabel(entry)}`);

    const children = tree.childrenByParent.get(entryId) ?? [];
    const childPrefix = prefix + (prefix ? (isLast ? "  " : "│ ") : "  ");
    for (let i = 0; i < children.length; i++) {
      renderNode(children[i], childPrefix, i === children.length - 1);
    }
  }
}

export function formatEntryLabel(entry) {
  const summary = summarizeEntry(entry);
  const bits = [summary.id, summary.type];
  if (summary.role) bits.push(summary.role);
  if (summary.toolName) bits.push(summary.toolName);
  if (summary.toolCalls) bits.push(`toolCalls=${summary.toolCalls}`);
  if (summary.label) bits.push(`label=${summary.label}`);
  if (summary.name) bits.push(`name=${summary.name}`);
  return bits.filter(Boolean).join(" ");
}
