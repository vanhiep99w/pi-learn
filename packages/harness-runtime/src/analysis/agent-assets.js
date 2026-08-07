import fs from "node:fs";
import path from "node:path";
import {
  inspectProjectAsset,
  inspectProjectPath,
  inventoryProjectAgentAssets,
  normalizeProjectRoute,
  MAX_AGENT_ASSET_AGGREGATE_BYTES,
  MAX_AGENT_ASSET_FILE_BYTES,
  MAX_APPLICABLE_AGENT_ASSETS,
} from "./project-agent-assets.js";

export const AGENT_ASSET_LIMITS = Object.freeze({
  maxFileBytes: MAX_AGENT_ASSET_FILE_BYTES,
  maxAggregateBytes: MAX_AGENT_ASSET_AGGREGATE_BYTES,
  maxAssets: MAX_APPLICABLE_AGENT_ASSETS,
  maxPromptAssets: 64,
  maxDeclaredAssets: 128,
  maxDiscoveryDirectories: 512,
  maxDiscoveredNodes: 4096,
  maxManifestBytes: 128 * 1024,
});

const AUTHORITY = Object.freeze({ project: true, userHome: false });
const PROMPT_DIRECTORY = ".pi/agent/model-prompts";
const SUPPORTED_DECLARATION_KINDS = ["skills", "extensions"];
const EXTENSION_FILE_PATTERN = /\.(?:cjs|cts|js|mjs|mts|ts)$/i;
const PRIVATE_ROUTE_PREFIXES = [
  ".pi/logs",
  ".pi/harness",
  ".pi/agent/sessions",
  ".pi/agent/auth",
];
const PRIVATE_ROUTE_PARTS = new Set([".env", ".ssh", "auth", "credentials", "private", "secrets", "tokens"]);

export function collectAgentAssetEvidence({ project, limits = {}, ownerRoutes = [], verificationHooks } = {}) {
  const normalizedLimits = normalizeLimits(limits);
  const rootResult = resolveProjectRoot(project?.projectRoot);
  if (!rootResult.ok) return failedEvidence(rootResult.code, normalizedLimits);

  const root = rootResult.root;
  const diagnostics = [];
  const discovered = discoverInstructionOwners(root, normalizedLimits);
  diagnostics.push(...discovered.diagnostics);

  const instructionOwnerRoutes = new Set(["AGENTS.md", ...discovered.ownerRoutes]);
  for (const ownerRoute of ownerRoutes) instructionOwnerRoutes.add(ownerRoute);
  const instructionLane = inventoryProjectAgentAssets({
    projectRoot: root,
    ownerRoutes: [...instructionOwnerRoutes],
    limits: {
      maxFileBytes: normalizedLimits.maxFileBytes,
      maxAggregateBytes: normalizedLimits.maxAggregateBytes,
      maxAssets: normalizedLimits.maxAssets,
    },
    verificationHooks,
  });
  const instructionSurface = surfaceFromInstructionLane(instructionLane);
  diagnostics.push(...instructionLane.diagnostics.map((item) => ({ ...item, surface: "instructions" })));

  const contentBudget = { bytes: 0 };
  const prompts = collectModelPrompts({ root, limits: normalizedLimits, contentBudget, diagnostics, verificationHooks });
  const configuration = collectProjectConfiguration({ root, limits: normalizedLimits, contentBudget, diagnostics, verificationHooks });
  const skills = collectDeclaredSurface({
    root,
    kind: "skills",
    declarations: configuration.declarations.skills,
    limits: normalizedLimits,
    contentBudget,
    diagnostics,
    verificationHooks,
  });
  const extensions = collectDeclaredSurface({
    root,
    kind: "extensions",
    declarations: configuration.declarations.extensions,
    limits: normalizedLimits,
    contentBudget,
    diagnostics,
    verificationHooks,
  });

  const surfaces = {
    instructions: instructionSurface,
    prompts,
    skills,
    extensions,
    configuration: configuration.surface,
  };
  const surfaceValues = Object.values(surfaces);
  const status = surfaceValues.some((surface) => surface.status === "failed")
    ? "failed"
    : diagnostics.length || surfaceValues.some((surface) => surface.status === "partial")
      ? "partial"
      : "complete";
  const allAssets = surfaceValues.flatMap((surface) => surface.assets);

  return {
    schemaVersion: 1,
    kind: "pi-harness.agent-assets",
    status,
    authority: { ...AUTHORITY },
    evidenceBoundary: {
      collectionMode: "static-project-only",
      userHomeAssetsRead: false,
      rawSessionContentRead: false,
      privateHarnessEvidenceRead: false,
      projectCommandsExecuted: false,
      presenceDoesNotProve: ["selected", "read", "invoked", "exercised", "outcome-supported"],
      unsupportedSurfaces: ["user-home-assets", "MCP", "external-package-roots"],
    },
    surfaces,
    diagnostics: diagnostics.map(safeDiagnostic),
    limits: normalizedLimits,
    totals: {
      assetCount: allAssets.length,
      configuredCount: allAssets.filter((asset) => asset.configured).length,
      presentCount: allAssets.filter((asset) => asset.presence === "present").length,
      missingCount: allAssets.filter((asset) => asset.presence === "missing").length,
      failedCount: allAssets.filter((asset) => asset.state === "failed").length,
      contentOpenedCount: instructionLane.totals.contentOpenedCount + countOpened([prompts, skills, configuration.surface]),
      inventoryOnlyCount: allAssets.filter((asset) => asset.state !== "failed").length,
      contentBytesBounded: contentBudget.bytes + instructionLane.totals.openedBytes,
    },
  };
}

function surfaceFromInstructionLane(lane) {
  return createSurface("instructions", (lane.assets ?? []).map((asset) => ({
    ...asset,
    configured: false,
    sectionIds: (asset.blocks ?? []).map((block) => block.sectionId),
  })), lane.diagnostics ?? []);
}

function collectModelPrompts({ root, limits, contentBudget, diagnostics, verificationHooks }) {
  const assets = [];
  const directoryState = inspectProjectPath(root, PROMPT_DIRECTORY);
  if (directoryState === "absent") return createSurface("prompts", assets, []);
  if (directoryState !== "directory") {
    diagnostics.push({ code: directoryState, surface: "prompts", route: PROMPT_DIRECTORY });
    assets.push({ route: PROMPT_DIRECTORY, type: "model-prompts", state: directoryState, configured: false });
    return createSurface("prompts", assets, [directoryState]);
  }

  let entries;
  try {
    entries = fs.readdirSync(path.join(root, ...PROMPT_DIRECTORY.split("/")), { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    const code = "directory-unreadable";
    diagnostics.push({ code, surface: "prompts", route: PROMPT_DIRECTORY });
    return createSurface("prompts", assets, [code]);
  }

  const promptEntries = entries.filter((entry) => entry.name.endsWith(".md"));
  if (promptEntries.length > limits.maxPromptAssets) {
    diagnostics.push({ code: "asset-count-limit", surface: "prompts", route: PROMPT_DIRECTORY, omittedCount: promptEntries.length - limits.maxPromptAssets });
  }
  for (const entry of promptEntries.slice(0, limits.maxPromptAssets)) {
    const route = `${PROMPT_DIRECTORY}/${entry.name}`;
    const inspected = inspectProjectAsset({
      projectRoot: root,
      route,
      type: "model-prompt",
      limits: { maxFileBytes: limits.maxFileBytes, maxAggregateBytes: limits.maxAggregateBytes },
      aggregateBytes: contentBudget.bytes,
      verificationHooks,
    });
    if (inspected.state === "opened") contentBudget.bytes += inspected.size;
    if (inspected.state !== "opened") diagnostics.push({ code: inspected.state, surface: "prompts", route });
    assets.push({ ...inspected, configured: false });
  }
  return createSurface("prompts", assets, assets.filter((asset) => asset.state !== "opened" && asset.state !== "absent").map((asset) => asset.state));
}

function collectProjectConfiguration({ root, limits, contentBudget, diagnostics, verificationHooks }) {
  const assets = [];
  const declarations = { skills: [], extensions: [] };
  const files = ["package.json", ".pi/settings.json"];
  const configs = [];

  for (const route of files) {
    const inspected = inspectProjectAsset({
      projectRoot: root,
      route,
      type: "project-config",
      limits: { maxFileBytes: limits.maxManifestBytes, maxAggregateBytes: limits.maxAggregateBytes },
      aggregateBytes: contentBudget.bytes,
      verificationHooks,
    });
    if (inspected.state === "opened") contentBudget.bytes += inspected.size;
    const configured = inspected.state !== "absent";
    assets.push({ ...inspected, configured });
    if (inspected.state !== "opened" && inspected.state !== "absent") {
      diagnostics.push({ code: inspected.state, surface: "configuration", route });
      continue;
    }
    if (inspected.state === "absent") continue;
    let data;
    try {
      data = JSON.parse(inspected.text);
    } catch {
      diagnostics.push({ code: "malformed-config", surface: "configuration", route });
      continue;
    }
    configs.push({ route, data });
  }

  for (const config of configs) {
    if (config.route === "package.json") {
      collectDeclaredArrays(config.data?.pi, config.route, ".", declarations, diagnostics, limits.maxDeclaredAssets);
    } else {
      collectDeclaredArrays(config.data, config.route, ".", declarations, diagnostics, limits.maxDeclaredAssets);
    }
  }

  return {
    surface: createSurface("configuration", assets, assets.filter((asset) => asset.state !== "opened" && asset.state !== "absent").map((asset) => asset.state)),
    declarations,
  };
}

function collectDeclaredArrays(value, declaredBy, baseRoute, declarations, diagnostics, maxEntries) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({ code: "invalid-declaration-object", surface: "configuration", route: declaredBy });
    return;
  }
  for (const kind of SUPPORTED_DECLARATION_KINDS) {
    if (value[kind] === undefined) continue;
    if (!Array.isArray(value[kind])) {
      diagnostics.push({ code: "invalid-declaration-list", surface: "configuration", route: declaredBy });
      continue;
    }
    for (const entry of value[kind]) {
      const currentCount = declarations.skills.length + declarations.extensions.length;
      if (currentCount >= maxEntries) {
        diagnostics.push({ code: "declaration-count-limit", surface: "configuration", route: declaredBy });
        return;
      }
      if (typeof entry !== "string") {
        diagnostics.push({ code: "invalid-declaration-entry", surface: "configuration", route: declaredBy });
        continue;
      }
      declarations[kind].push({ value: entry, declaredBy, baseRoute });
    }
  }
}

function collectDeclaredSurface({ root, kind, declarations, limits, contentBudget, diagnostics, verificationHooks }) {
  const assets = [];
  const localDiagnostics = [];
  const seen = new Map();
  let declarationCount = 0;

  for (const declaration of declarations) {
    declarationCount += 1;
    if (declarationCount > limits.maxDeclaredAssets) {
      localDiagnostics.push({ code: "declaration-count-limit", surface: kind });
      break;
    }
    const route = normalizeDeclaredRoute(declaration.value, declaration.declaredBy, kind, localDiagnostics);
    if (!route) continue;
    const targets = expandDeclaredTargets(root, route, kind, limits, localDiagnostics);
    if (!targets.length) targets.push({ route, pathState: "absent" });

    for (const target of targets) {
      if (assets.length >= limits.maxDeclaredAssets) {
        localDiagnostics.push({ code: "asset-count-limit", surface: kind, omittedCount: targets.length - assets.length });
        break;
      }
      const targetKey = `${kind}:${target.route}`;
      if (seen.has(targetKey)) {
        seen.get(targetKey).declaredBy = earliestRoute(seen.get(targetKey).declaredBy, declaration.declaredBy);
        continue;
      }
      const record = inspectDeclaredTarget({
        root,
        kind,
        target,
        declaredBy: declaration.declaredBy,
        limits,
        contentBudget,
        localDiagnostics,
        verificationHooks,
      });
      seen.set(targetKey, record);
      assets.push(record);
    }
  }

  diagnostics.push(...localDiagnostics);
  return createSurface(kind, assets, localDiagnostics);
}

function inspectDeclaredTarget({ root, kind, target, declaredBy, limits, contentBudget, localDiagnostics, verificationHooks }) {
  const pathState = target.pathState ?? inspectProjectPath(root, target.route);
  if (kind !== "skills" || !isSkillFile(target.route) || pathState === "directory" || pathState === "absent") {
    if (pathState !== "regular-file" && pathState !== "directory" && pathState !== "absent") {
      localDiagnostics.push({ code: pathState, surface: kind, route: target.route });
    }
    return { route: target.route, type: `project-${kind.slice(0, -1)}`, state: pathState, configured: true, declaredBy };
  }

  const inspected = inspectProjectAsset({
    projectRoot: root,
    route: target.route,
    type: "project-skill",
    limits: { maxFileBytes: limits.maxFileBytes, maxAggregateBytes: limits.maxAggregateBytes },
    aggregateBytes: contentBudget.bytes,
    verificationHooks,
  });
  if (inspected.state === "opened") contentBudget.bytes += inspected.size;
  if (inspected.state !== "opened" && inspected.state !== "absent") localDiagnostics.push({ code: inspected.state, surface: kind, route: target.route });
  return { ...inspected, configured: true, declaredBy };
}

function expandDeclaredTargets(root, route, kind, limits, diagnostics) {
  if (!hasGlob(route)) {
    const pathState = inspectProjectPath(root, route);
    if (pathState === "directory") {
      return [
        { route, pathState },
        ...findDeclaredChildren(root, route, kind, limits, diagnostics),
      ];
    }
    return [{ route, pathState }];
  }

  const nodes = walkProjectTree(root, { maxDirectories: limits.maxDiscoveryDirectories, maxNodes: limits.maxDiscoveredNodes, skipPi: false });
  diagnostics.push(...nodes.diagnostics.map((item) => ({ ...item, surface: kind })));
  const matcher = globToRegExp(route);
  const matches = nodes.nodes.filter((node) => matcher.test(node.route));
  const targets = [];
  for (const node of matches) {
    targets.push({ route: node.route, pathState: node.kind === "directory" ? "directory" : node.kind === "symlink" ? "symlink-file" : "regular-file" });
    if (node.kind === "directory") targets.push(...findDeclaredChildren(root, node.route, kind, limits, diagnostics));
  }
  return targets;
}

function findDeclaredChildren(root, baseRoute, kind, limits, diagnostics) {
  const nodes = walkProjectTree(root, { maxDirectories: limits.maxDiscoveryDirectories, maxNodes: limits.maxDiscoveredNodes, skipPi: false });
  diagnostics.push(...nodes.diagnostics.map((item) => ({ ...item, surface: kind })));
  return nodes.nodes
    .filter((node) => node.route.startsWith(`${baseRoute}/`))
    .filter((node) => kind === "skills" ? isSkillFile(node.route) : isExtensionFile(node.route))
    .map((node) => ({ route: node.route, pathState: node.kind === "symlink" ? "symlink-file" : node.kind === "directory" ? "directory" : "regular-file" }));
}

function discoverInstructionOwners(root, limits) {
  const result = walkProjectTree(root, { maxDirectories: limits.maxDiscoveryDirectories, maxNodes: limits.maxDiscoveredNodes, skipPi: true });
  const ownerRoutes = new Set();
  for (const node of result.nodes) {
    const base = path.posix.basename(node.route);
    if (base === "AGENTS.md" || (node.route.startsWith("wiki/") && base === "_rules.md")) ownerRoutes.add(node.route);
  }
  return { ownerRoutes: [...ownerRoutes], diagnostics: result.diagnostics };
}

function walkProjectTree(root, { maxDirectories, maxNodes, skipPi }) {
  const nodes = [];
  const diagnostics = [];
  let directoryCount = 0;
  let nodeLimitReported = false;

  function addNode(node) {
    if (nodes.length >= maxNodes) {
      if (!nodeLimitReported) {
        diagnostics.push({ code: "node-count-limit", route: node.route });
        nodeLimitReported = true;
      }
      return false;
    }
    nodes.push(node);
    return true;
  }

  function visit(route) {
    if (directoryCount >= maxDirectories) {
      diagnostics.push({ code: "directory-count-limit", route: route || "." });
      return;
    }
    directoryCount += 1;
    const absolute = route ? path.join(root, ...route.split("/")) : root;
    if (route) {
      let stat;
      try {
        stat = fs.lstatSync(absolute);
      } catch {
        diagnostics.push({ code: "path-unreadable", route });
        return;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        diagnostics.push({ code: stat.isSymbolicLink() ? "symlink-directory" : "not-directory", route });
        return;
      }
    }
    let entries;
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      diagnostics.push({ code: "directory-unreadable", route: route || "." });
      return;
    }
    for (const entry of entries) {
      const childRoute = route ? `${route}/${entry.name}` : entry.name;
      if (isProtectedRoute(childRoute) || (skipPi && childRoute === ".pi") || (skipPi && childRoute.startsWith(".pi/"))) continue;
      let childStat;
      try {
        childStat = fs.lstatSync(path.join(root, ...childRoute.split("/")));
      } catch {
        diagnostics.push({ code: "path-unreadable", route: childRoute });
        continue;
      }
      if (childStat.isSymbolicLink()) {
        if (!addNode({ route: childRoute, kind: "symlink" })) break;
      } else if (childStat.isDirectory()) {
        if (!addNode({ route: childRoute, kind: "directory" })) break;
        visit(childRoute);
      } else {
        if (!addNode({ route: childRoute, kind: "file" })) break;
      }
    }
  }

  visit("");
  return { nodes, diagnostics };
}

function createSurface(name, records, diagnostics = []) {
  const assets = records.map(publicAsset);
  const failed = assets.some((asset) => asset.state === "failed") || diagnostics.length > 0;
  return {
    status: failed ? "partial" : "complete",
    assets,
    counts: {
      configured: assets.filter((asset) => asset.configured).length,
      present: assets.filter((asset) => asset.presence === "present").length,
      missing: assets.filter((asset) => asset.presence === "missing").length,
      failed: assets.filter((asset) => asset.state === "failed").length,
    },
    name,
  };
}

function publicAsset(asset) {
  const state = asset.state === "opened" || asset.state === "regular-file" || asset.state === "directory"
    ? "present"
    : asset.state === "absent"
      ? "missing"
      : "failed";
  const output = {
    route: safeRoute(asset.route),
    type: asset.type,
    state,
    presence: state === "present" ? "present" : state === "missing" ? "missing" : "unknown",
    configured: Boolean(asset.configured),
  };
  if (asset.declaredBy) output.declaredBy = safeRoute(asset.declaredBy);
  if (asset.appliesTo) output.appliesTo = asset.appliesTo.map(safeRoute).filter(Boolean);
  if (asset.sectionIds?.length) output.sectionIds = asset.sectionIds.filter((id) => typeof id === "string");
  if (state === "failed") output.reason = safeCode(asset.state);
  return output;
}

function countOpened(surfaces) {
  return surfaces.reduce((total, surface) => total + surface.assets.filter((asset) => asset.state === "present" && asset.type !== "project-extension").length, 0);
}

function resolveProjectRoot(projectRoot) {
  const configuredRoot = path.resolve(String(projectRoot ?? ""));
  try {
    const stat = fs.lstatSync(configuredRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { ok: false, code: "invalid-project-root" };
    return { ok: true, root: fs.realpathSync(configuredRoot) };
  } catch {
    return { ok: false, code: "unreadable-project-root" };
  }
}

function failedEvidence(code, limits) {
  const surfaces = Object.fromEntries(["instructions", "prompts", "skills", "extensions", "configuration"].map((name) => [name, { name, status: "failed", assets: [], counts: { configured: 0, present: 0, missing: 0, failed: 0 } }]));
  return {
    schemaVersion: 1,
    kind: "pi-harness.agent-assets",
    status: "failed",
    authority: { ...AUTHORITY },
    evidenceBoundary: {
      collectionMode: "static-project-only",
      userHomeAssetsRead: false,
      rawSessionContentRead: false,
      privateHarnessEvidenceRead: false,
      projectCommandsExecuted: false,
      presenceDoesNotProve: ["selected", "read", "invoked", "exercised", "outcome-supported"],
      unsupportedSurfaces: ["user-home-assets", "MCP", "external-package-roots"],
    },
    surfaces,
    diagnostics: [{ code: safeCode(code) }],
    limits,
    totals: { assetCount: 0, configuredCount: 0, presentCount: 0, missingCount: 0, failedCount: 0, contentOpenedCount: 0, inventoryOnlyCount: 0, contentBytesBounded: 0 },
  };
}

function normalizeDeclaredRoute(value, declaredBy, surface, diagnostics) {
  let raw = String(value ?? "").trim();
  if (raw.startsWith("!")) return undefined;
  if (raw.startsWith("+")) raw = raw.slice(1);
  if (!raw || raw.startsWith("~") || raw.startsWith("/") || raw.includes("\0") || raw.split(/[\\/]/).includes("..")) {
    diagnostics.push({ code: "outside-authority", surface, route: "<outside-project>", declaredBy: safeRoute(declaredBy) });
    return undefined;
  }
  const route = normalizeProjectRoute(raw);
  if (!route || isProtectedRoute(route)) {
    diagnostics.push({ code: isProtectedRoute(route) ? "private-route-rejected" : "outside-authority", surface, route: "<outside-project>", declaredBy: safeRoute(declaredBy) });
    return undefined;
  }
  return route;
}

function isProtectedRoute(route) {
  const normalized = String(route ?? "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".git" || part === "node_modules" || part.startsWith(".env.") || PRIVATE_ROUTE_PARTS.has(part))) return true;
  return PRIVATE_ROUTE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function hasGlob(route) {
  return /[*?]/.test(route);
}

function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function isSkillFile(route) {
  return path.posix.basename(route).toLowerCase() === "skill.md" || route.toLowerCase().endsWith(".md");
}

function isExtensionFile(route) {
  return EXTENSION_FILE_PATTERN.test(route);
}

function earliestRoute(left, right) {
  return String(left).localeCompare(String(right)) <= 0 ? left : right;
}

function normalizeLimits(limits) {
  return {
    maxFileBytes: normalizeLimit(limits.maxFileBytes, AGENT_ASSET_LIMITS.maxFileBytes),
    maxAggregateBytes: normalizeLimit(limits.maxAggregateBytes, AGENT_ASSET_LIMITS.maxAggregateBytes),
    maxAssets: normalizeLimit(limits.maxAssets, AGENT_ASSET_LIMITS.maxAssets),
    maxPromptAssets: normalizeLimit(limits.maxPromptAssets, AGENT_ASSET_LIMITS.maxPromptAssets),
    maxDeclaredAssets: normalizeLimit(limits.maxDeclaredAssets, AGENT_ASSET_LIMITS.maxDeclaredAssets),
    maxDiscoveryDirectories: normalizeLimit(limits.maxDiscoveryDirectories, AGENT_ASSET_LIMITS.maxDiscoveryDirectories),
    maxDiscoveredNodes: normalizeLimit(limits.maxDiscoveredNodes, AGENT_ASSET_LIMITS.maxDiscoveredNodes),
    maxManifestBytes: normalizeLimit(limits.maxManifestBytes, AGENT_ASSET_LIMITS.maxManifestBytes),
  };
}

function normalizeLimit(value, fallback) {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) throw new RangeError("Agent asset limits must be non-negative integers");
  return numeric;
}

function safeRoute(value) {
  const normalized = normalizeProjectRoute(value);
  return normalized ?? "<outside-project>";
}

function safeCode(value) {
  return String(value ?? "diagnostic").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "diagnostic";
}

function safeDiagnostic(item) {
  const output = { code: safeCode(item.code) };
  if (item.surface) output.surface = safeCode(item.surface);
  if (item.route !== undefined) output.route = safeRoute(item.route);
  if (item.omittedCount !== undefined && Number.isInteger(item.omittedCount) && item.omittedCount >= 0) output.omittedCount = item.omittedCount;
  return output;
}
