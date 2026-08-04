import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_AGENT_ASSET_FILE_BYTES = 64 * 1024;
export const MAX_AGENT_ASSET_AGGREGATE_BYTES = 256 * 1024;
export const MAX_APPLICABLE_AGENT_ASSETS = 128;

const AUTHORITY = Object.freeze({ project: true, userHome: false });

export function inventoryProjectAgentAssets({ projectRoot, ownerRoutes = [], limits = {}, verificationHooks } = {}) {
  const configuredRoot = path.resolve(String(projectRoot ?? ""));
  const maxFileBytes = normalizeLimit(limits.maxFileBytes, MAX_AGENT_ASSET_FILE_BYTES);
  const maxAggregateBytes = normalizeLimit(limits.maxAggregateBytes, MAX_AGENT_ASSET_AGGREGATE_BYTES);
  const maxAssets = normalizeLimit(limits.maxAssets, MAX_APPLICABLE_AGENT_ASSETS);
  const diagnostics = [];
  let root;

  try {
    const rootStat = fs.lstatSync(configuredRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return failedLane("invalid-project-root", { maxFileBytes, maxAggregateBytes, maxAssets });
    }
    root = fs.realpathSync(configuredRoot);
  } catch {
    return failedLane("unreadable-project-root", { maxFileBytes, maxAggregateBytes, maxAssets });
  }

  const routeOwners = new Map();
  for (const rawOwnerRoute of ownerRoutes) {
    const ownerRoute = normalizeProjectRoute(rawOwnerRoute);
    if (!ownerRoute) {
      diagnostics.push({ code: "outside-authority", route: safeRoute(rawOwnerRoute) });
      continue;
    }
    for (const assetRoute of applicableAssetRoutes(ownerRoute)) {
      if (!routeOwners.has(assetRoute)) routeOwners.set(assetRoute, new Set());
      routeOwners.get(assetRoute).add(ownerRoute);
    }
  }

  const allRoutes = [...routeOwners].sort(([left], [right]) => left.localeCompare(right));
  const selectedRoutes = allRoutes.slice(0, maxAssets);
  if (allRoutes.length > maxAssets) diagnostics.push({ code: "asset-count-limit", omittedCount: allRoutes.length - maxAssets });

  const assets = [];
  let aggregateBytes = 0;
  for (const [route, appliesTo] of selectedRoutes) {
    const asset = inspectAsset({ root, route, maxFileBytes, maxAggregateBytes, aggregateBytes, verificationHooks });
    asset.appliesTo = [...appliesTo].sort();
    assets.push(asset);
    if (asset.state === "opened") aggregateBytes += asset.size;
    if (asset.state !== "opened" && asset.state !== "absent") diagnostics.push({ code: asset.state, route });
  }

  return {
    schemaVersion: 1,
    kind: "pi-harness.agent-assets",
    status: diagnostics.length ? "partial" : "complete",
    authority: { ...AUTHORITY },
    assets,
    diagnostics,
    limits: { maxFileBytes, maxAggregateBytes, maxAssets },
    totals: {
      applicableCount: allRoutes.length,
      inventoriedCount: assets.length,
      contentOpenedCount: assets.filter((asset) => asset.state === "opened").length,
      inventoryOnlyCount: assets.filter((asset) => asset.state !== "opened").length,
      openedBytes: aggregateBytes,
    },
  };
}

export function publicAgentAssetInventory(lane) {
  return {
    schemaVersion: lane.schemaVersion,
    kind: lane.kind,
    status: lane.status,
    authority: lane.authority,
    surfaces: (lane.assets ?? []).map((asset) => ({
      route: asset.route,
      type: asset.type,
      state: asset.state,
      size: asset.size,
      digest: asset.digest,
      sectionIds: (asset.blocks ?? []).map((block) => block.sectionId),
      appliesTo: asset.appliesTo,
    })),
    diagnostics: (lane.diagnostics ?? []).map((item) => ({ ...item })),
    totals: lane.totals,
  };
}

export function applicableAssetRoutes(ownerRoute) {
  const normalized = normalizeProjectRoute(ownerRoute);
  if (!normalized) return [];
  const ownerDir = ownerDirectory(normalized);
  const routes = new Set();

  for (const directory of ancestorDirectories(ownerDir)) routes.add(directory ? `${directory}/AGENTS.md` : "AGENTS.md");

  if (normalized === "wiki" || normalized.startsWith("wiki/")) {
    const wikiOwnerDir = ownerDir === "wiki" || ownerDir.startsWith("wiki/") ? ownerDir : "wiki";
    for (const directory of ancestorDirectories(wikiOwnerDir)) {
      if (directory === "wiki" || directory.startsWith("wiki/")) routes.add(`${directory}/_rules.md`);
    }
  }

  return [...routes].sort();
}

export function extractH2Blocks(markdown, { includePreamble = false } = {}) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const blocks = [];
  const preamble = [];
  let current;

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) blocks.push(finalizeBlock(current));
      current = { heading: match[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) blocks.push(finalizeBlock(current));
  if (includePreamble && preamble.join("\n").trim()) blocks.unshift(finalizeSyntheticBlock(preamble.join("\n")));
  return blocks;
}

function inspectAsset({ root, route, maxFileBytes, maxAggregateBytes, aggregateBytes, verificationHooks }) {
  const type = route.endsWith("AGENTS.md") ? "agents" : "wiki-rules";
  const absolutePath = path.join(root, ...route.split("/"));
  const base = { route, type, state: "absent", size: undefined, digest: undefined, blocks: [] };
  const pathState = inspectPathWithoutSymlinks(root, route);
  if (pathState === "absent") return base;
  if (pathState !== "regular-file") return { ...base, state: pathState };
  if (typeof fs.constants.O_NOFOLLOW !== "number") return { ...base, state: "secure-open-unavailable" };

  let fd;
  try {
    verificationHooks?.beforeOpen?.({ route, absolutePath });
    fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ELOOP") return { ...base, state: "symlink-file" };
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { ...base, state: "mutated-before-open" };
    return { ...base, state: "unreadable" };
  }

  try {
    let before;
    try {
      before = fs.fstatSync(fd);
    } catch {
      return { ...base, state: "binding-unverifiable" };
    }
    if (!before.isFile()) return { ...base, state: "not-regular-file" };

    const initialBinding = verifyOpenedBinding({ fd, root, route, absolutePath, descriptorStat: before });
    if (!initialBinding.ok) return { ...base, state: initialBinding.state, size: before.size };
    if (before.size > maxFileBytes) return { ...base, state: "oversized", size: before.size };
    if (aggregateBytes + before.size > maxAggregateBytes) return { ...base, state: "aggregate-limit", size: before.size };

    try {
      verificationHooks?.afterOpen?.({ route, absolutePath, fd });
    } catch {
      return { ...base, state: "verification-hook-failed", size: before.size };
    }

    let buffer;
    try {
      buffer = readBoundedDescriptor(fd, maxFileBytes);
    } catch {
      return { ...base, state: "unreadable", size: before.size };
    }
    if (buffer.length > maxFileBytes) return { ...base, state: "oversized", size: buffer.length };

    let after;
    try {
      after = fs.fstatSync(fd);
    } catch {
      return { ...base, state: "binding-unverifiable", size: buffer.length };
    }
    if (!sameFileSnapshot(before, after) || buffer.length !== before.size) {
      return { ...base, state: "mutated-during-read", size: after.size };
    }
    const finalBinding = verifyOpenedBinding({ fd, root, route, absolutePath, descriptorStat: after });
    if (!finalBinding.ok) return { ...base, state: finalBinding.state, size: buffer.length };
    if (buffer.includes(0)) return { ...base, state: "nul-byte", size: buffer.length };

    let markdown;
    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return { ...base, state: "invalid-utf8", size: buffer.length };
    }

    return {
      ...base,
      state: "opened",
      size: buffer.length,
      digest: sha256(buffer),
      blocks: extractH2Blocks(markdown, { includePreamble: type === "agents" }),
    };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // Best-effort close after every opened-descriptor outcome.
    }
  }
}

function verifyOpenedBinding({ fd, root, route, absolutePath, descriptorStat }) {
  const descriptorPath = descriptorRealPath(fd);
  if (!descriptorPath) return { ok: false, state: "secure-binding-unavailable" };
  if (!isInsideRoot(root, descriptorPath)) return { ok: false, state: "binding-outside-project" };
  if (path.resolve(descriptorPath) !== path.resolve(absolutePath)) return { ok: false, state: "binding-mismatch" };
  if (inspectPathWithoutSymlinks(root, route) !== "regular-file") return { ok: false, state: "binding-mismatch" };

  try {
    const intendedRealPath = fs.realpathSync(absolutePath);
    const intendedStat = fs.lstatSync(absolutePath);
    if (path.resolve(intendedRealPath) !== path.resolve(descriptorPath)
      || intendedStat.isSymbolicLink()
      || !intendedStat.isFile()
      || intendedStat.dev !== descriptorStat.dev
      || intendedStat.ino !== descriptorStat.ino) {
      return { ok: false, state: "binding-mismatch" };
    }
  } catch {
    return { ok: false, state: "binding-unverifiable" };
  }
  return { ok: true };
}

function descriptorRealPath(fd) {
  for (const base of ["/proc/self/fd", "/dev/fd"]) {
    try {
      const resolved = fs.realpathSync(path.join(base, String(fd)));
      if (path.isAbsolute(resolved)) return resolved;
    } catch {
      // Try the next platform-specific descriptor namespace.
    }
  }
  return undefined;
}

function readBoundedDescriptor(fd, maxBytes) {
  const output = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < output.length) {
    const bytesRead = fs.readSync(fd, output, offset, output.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return output.subarray(0, offset);
}

function inspectPathWithoutSymlinks(root, route) {
  let current = root;
  const segments = route.split("/");
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return "absent";
      return "unreadable";
    }
    if (stat.isSymbolicLink()) return index === segments.length - 1 ? "symlink-file" : "symlink-directory";
    if (index < segments.length - 1 && !stat.isDirectory()) return "not-regular-file";
    if (index === segments.length - 1) return stat.isFile() ? "regular-file" : "not-regular-file";
  }
  return "absent";
}

function applicableFailureLane(code, limits) {
  return {
    schemaVersion: 1,
    kind: "pi-harness.agent-assets",
    status: "failed",
    authority: { ...AUTHORITY },
    assets: [],
    diagnostics: [{ code }],
    limits,
    totals: { applicableCount: 0, inventoriedCount: 0, contentOpenedCount: 0, inventoryOnlyCount: 0, openedBytes: 0 },
  };
}

function failedLane(code, limits) {
  return applicableFailureLane(code, limits);
}

function ownerDirectory(route) {
  if (route.endsWith("/AGENTS.md") || route.endsWith("/_rules.md") || path.posix.extname(route)) return path.posix.dirname(route) === "." ? "" : path.posix.dirname(route);
  return route;
}

function ancestorDirectories(directory) {
  if (!directory) return [""];
  const parts = directory.split("/");
  return ["", ...parts.map((_, index) => parts.slice(0, index + 1).join("/"))];
}

function normalizeProjectRoute(value) {
  const raw = String(value ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw || raw.startsWith("/") || raw.includes("\0")) return undefined;
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

function safeRoute(value) {
  const normalized = normalizeProjectRoute(value);
  return normalized ?? "<outside-project>";
}

function finalizeBlock(block) {
  const content = block.lines.join("\n").trim();
  const digest = sha256(`${block.heading}\n${content}`);
  return { sectionId: sectionIdFromHeading(block.heading, digest), heading: block.heading, content, digest };
}

function finalizeSyntheticBlock(content) {
  const normalized = String(content).trim();
  const digest = sha256(normalized);
  return { sectionId: `section-${digest.slice(0, 16)}`, heading: "", content: normalized, digest };
}

function sectionIdFromHeading(heading, digest) {
  const explicit = /^([A-Z][A-Z0-9-]{2,63})(?:\s+(?:—|-)\s+|$)/.exec(heading)?.[1];
  return explicit ?? `section-${digest.slice(0, 16)}`;
}

function sameFileSnapshot(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizeLimit(value, fallback) {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) throw new RangeError("Agent asset limits must be non-negative integers");
  return numeric;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
