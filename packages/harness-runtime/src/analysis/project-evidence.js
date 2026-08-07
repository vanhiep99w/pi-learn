import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { inventoryProjectAgentAssets, publicAgentAssetInventory } from "./project-agent-assets.js";

export const PROJECT_EVIDENCE_LIMITS = Object.freeze({
  maxManifestBytes: 128 * 1024,
  maxInstructionFileBytes: 64 * 1024,
  maxInstructionAggregateBytes: 256 * 1024,
  maxInstructionAssets: 128,
  maxWorkspacePatterns: 32,
  maxWorkspaceMembers: 128,
  maxWorkspaceDirectories: 512,
  maxGitIndexBytes: 8 * 1024 * 1024,
  maxGitObjectBytes: 4 * 1024 * 1024,
  maxGitEntries: 256,
  maxGitScanEntries: 1024,
  maxCiWorkflows: 64,
  maxDocumentationLeads: 128,
  maxOwnershipLeads: 128,
  maxRuntimeManifests: 32,
});

const KIND = "pi-harness.project-evidence";
const AUTHORITY = Object.freeze({ project: true, userHome: false, projectCommands: false, externalNetwork: false });
const EVIDENCE_BOUNDARY = Object.freeze({
  collectionMode: "static-read-only",
  projectCommandsExecuted: false,
  scriptsExecuted: false,
  runtimeExecuted: false,
  externalCiOpened: false,
  externalNetworkAccessed: false,
  presenceDoesNotProve: ["exercise", "pass", "acceptance"],
});
const SAFE_COMMANDS = new Set(["bun", "deno", "eslint", "git", "jest", "mocha", "node", "npm", "npx", "pnpm", "prettier", "tsc", "vitest", "yarn"]);
const UNSAFE_ARGUMENTS = new Set(["-e", "--eval", "-r", "--require", "--exec", "--shell"]);
const VALIDATION_SCRIPT_ROLES = new Set(["test", "lint", "check", "typecheck", "verify", "validate", "build"]);
const DELIVERY_SCRIPT_ROLES = new Set(["release", "publish", "deploy", "pack"]);
const RUNTIME_MANIFESTS = [
  ["package-lock.json", "npm-lockfile"],
  ["npm-shrinkwrap.json", "npm-lockfile"],
  ["pnpm-lock.yaml", "pnpm-lockfile"],
  ["yarn.lock", "yarn-lockfile"],
  ["bun.lock", "bun-lockfile"],
  ["bun.lockb", "bun-lockfile"],
  [".nvmrc", "node-version-pin"],
  [".node-version", "node-version-pin"],
  ["tsconfig.json", "typescript-config"],
  ["jsconfig.json", "javascript-config"],
];
const CI_ROOT_FILES = [
  [".gitlab-ci.yml", "gitlab"],
  [".gitlab-ci.yaml", "gitlab"],
  [".travis.yml", "travis"],
  [".circleci/config.yml", "circleci"],
  [".buildkite/pipeline.yml", "buildkite"],
  [".azure-pipelines.yml", "azure-pipelines"],
  [".drone.yml", "drone"],
];
const KNOWN_DOCUMENT_ROUTES = [
  ["CHANGELOG.md", "release"],
  ["CHANGES.md", "release"],
  ["RELEASE.md", "release"],
  ["RELEASES.md", "release"],
  ["RELEASING.md", "release"],
  ["CONTRIBUTING.md", "delivery"],
  ["DEVELOPMENT.md", "delivery"],
  ["OPERATIONS.md", "recovery"],
  ["RUNBOOK.md", "recovery"],
  ["RECOVERY.md", "recovery"],
  ["DISASTER-RECOVERY.md", "recovery"],
  ["ROLLBACK.md", "recovery"],
  ["docs/release.md", "release"],
  ["docs/releases", "release"],
  ["docs/releasing.md", "release"],
  ["docs/operations.md", "recovery"],
  ["docs/runbook.md", "recovery"],
  ["docs/recovery.md", "recovery"],
  ["docs/rollback.md", "recovery"],
  ["wiki/operations", "recovery"],
];
const SOURCE_DIRECTORY_NAMES = ["src", "source", "lib", "app"];
const TEST_DIRECTORY_NAMES = ["test", "tests", "spec", "specs", "__tests__"];
const PRIVATE_ROUTE_PARTS = new Set([".env", ".pi", ".ssh", "auth", "credentials", "private", "secrets", "tokens"]);

export function collectProjectEvidence({ project, limits = {} } = {}) {
  const normalizedLimits = normalizeLimits(limits);
  const rootResult = resolveProjectRoot(project?.projectRoot);
  if (!rootResult.ok) return unavailableEvidence(rootResult.code, normalizedLimits);

  const root = rootResult.root;
  const diagnostics = [];
  const rootManifest = readPackageManifest(root, "package.json", normalizedLimits, diagnostics);
  const workspace = discoverWorkspaceMembers(root, rootManifest, normalizedLimits, diagnostics);
  const packageEntries = [
    rootManifest,
    ...workspace.members.map((member) => readPackageManifest(root, `${member.route}/package.json`, normalizedLimits, diagnostics)),
  ];
  const currentPackageRoute = nearestPackageRoute(root, project?.cwd, packageEntries);
  const workspaceTarget = resolveWorkspaceTarget({ project, root, workspaceMembers: workspace.members, currentPackageRoute });

  const ownership = collectOwnershipLeads({ root, packageEntries, workspaceTarget, limits: normalizedLimits, diagnostics });
  const instructionRoutes = new Set([
    workspaceTarget.ownerRoute === "." ? "package.json" : `${workspaceTarget.ownerRoute}/package.json`,
    ...ownership.leads.map((lead) => lead.route),
  ]);
  const instructions = collectInstructions(root, [...instructionRoutes], normalizedLimits);
  const scripts = collectScriptLeads(packageEntries);
  const validationRoutes = scripts.filter((script) => VALIDATION_SCRIPT_ROLES.has(script.role)).map(validationRoute);
  const deliveryRoutes = scripts.filter((script) => DELIVERY_SCRIPT_ROLES.has(script.role)).map(deliveryRoute);
  const manifests = collectManifestSurface({ rootManifest, packageEntries, workspace, root, limits: normalizedLimits, diagnostics });
  const changeScope = collectGitChangeScope({
    root,
    gitRootPresent: Boolean(project?.gitRoot),
    scopeRoute: workspaceTarget.ownerRoute,
    limits: normalizedLimits,
  });
  const ci = collectCiLeads(root, normalizedLimits);
  const releaseRecovery = collectDocumentationLeads(root, normalizedLimits);
  const inventory = collectKnownInventory(root, normalizedLimits, diagnostics);

  const surfaces = {
    instructions: instructions.status,
    manifests: manifests.status,
    git: changeScope.status,
    ci: ci.status,
    releaseRecovery: releaseRecovery.status,
    ownership: ownership.status,
  };
  const allSurfaceStatuses = Object.values(surfaces);
  const requiredSurfaceUnavailable = [surfaces.manifests, surfaces.git].some((surface) => surface !== "available");
  const status = requiredSurfaceUnavailable || allSurfaceStatuses.includes("partial") || diagnostics.length > 0
    ? "partial"
    : "available";
  const safeDiagnostics = [
    ...diagnostics,
    ...changeScope.diagnostics,
    ...ci.diagnostics,
    ...releaseRecovery.diagnostics,
    ...ownership.diagnostics,
    ...instructions.diagnostics,
    ...manifests.diagnostics,
    ...inventory.diagnostics,
  ].map(safeDiagnostic);

  const publicManifests = {
    status: manifests.status,
    package: publicPackageManifest(rootManifest),
    members: packageEntries.slice(1).map(publicPackageManifest),
    workspace: publicWorkspace(workspace),
    runtime: manifests.runtime,
    diagnostics: manifests.diagnostics.map(safeDiagnostic),
  };

  return {
    schemaVersion: 1,
    kind: KIND,
    status,
    authority: { ...AUTHORITY },
    workspaceTarget,
    surfaceStatus: surfaces,
    instructions: instructions.assets,
    instructionStatus: instructions.status,
    commands: scripts,
    validationRoutes,
    deliveryRoutes,
    manifests: publicManifests,
    // Additive singular alias keeps the root package contract easy to consume.
    manifest: publicManifests,
    changeScope: publicChangeScope(changeScope),
    git: publicChangeScope(changeScope),
    ci: publicCi(ci),
    releaseRecovery: publicDocumentation(releaseRecovery),
    ownership: publicOwnership(ownership),
    inventory: publicInventory(inventory),
    evidenceBoundary: { ...EVIDENCE_BOUNDARY, presenceDoesNotProve: [...EVIDENCE_BOUNDARY.presenceDoesNotProve] },
    diagnostics: safeDiagnostics,
    limits: normalizedLimits,
  };
}

export function resolveWorkspaceTarget({ project, root, workspaceMembers = [], currentPackageRoute } = {}) {
  const projectRoot = normalizeAbsoluteDirectory(root);
  const currentRoute = projectRoot && project?.cwd
    ? projectRelativeRoute(projectRoot, project.cwd)
    : undefined;
  const member = [...workspaceMembers]
    .filter((candidate) => candidate?.route && isRouteInScope(currentRoute, candidate.route))
    .sort((left, right) => right.route.length - left.route.length)[0];

  if (!project?.gitRoot) return { kind: "standalone", route: ".", packageRoute: null, ownerRoute: "." };
  if (member) return { kind: "workspace-member", route: member.route, packageRoute: member.route, ownerRoute: member.route };
  if (currentRoute && currentRoute !== ".") {
    const route = currentPackageRoute && isRouteInScope(currentRoute, currentPackageRoute) ? currentPackageRoute : currentRoute;
    return { kind: "repo-subtree", route, packageRoute: currentPackageRoute ?? null, ownerRoute: route };
  }
  return { kind: "repo-root", route: ".", packageRoute: null, ownerRoute: "." };
}

function normalizeLimits(limits) {
  const output = {};
  for (const [key, fallback] of Object.entries(PROJECT_EVIDENCE_LIMITS)) {
    const value = limits?.[key];
    if (value === undefined) output[key] = fallback;
    else {
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 0) throw new RangeError(`Project evidence limit ${key} must be a non-negative integer`);
      output[key] = Math.min(numeric, fallback);
    }
  }
  return output;
}

function resolveProjectRoot(projectRoot) {
  if (typeof projectRoot !== "string" || !projectRoot) return { ok: false, code: "project-root-missing" };
  let stat;
  try {
    stat = fs.lstatSync(projectRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { ok: false, code: "invalid-project-root" };
    const root = fs.realpathSync(projectRoot);
    if (!isAbsoluteDirectory(root)) return { ok: false, code: "project-root-unverifiable" };
    return { ok: true, root };
  } catch {
    return { ok: false, code: "unreadable-project-root" };
  }
}

function unavailableEvidence(code, limits) {
  const diagnostics = [{ code, severity: "error" }];
  return {
    schemaVersion: 1,
    kind: KIND,
    status: "unavailable",
    authority: { ...AUTHORITY },
    workspaceTarget: { kind: "standalone", route: ".", packageRoute: null, ownerRoute: "." },
    surfaceStatus: { instructions: "unavailable", manifests: "unavailable", git: "unavailable", ci: "unavailable", releaseRecovery: "unavailable", ownership: "unavailable" },
    instructions: [],
    instructionStatus: "unavailable",
    commands: [],
    validationRoutes: [],
    deliveryRoutes: [],
    manifests: { status: "unavailable", package: null, members: [], workspace: { status: "unavailable", patterns: [], members: [] }, runtime: [], diagnostics: [] },
    manifest: { status: "unavailable", package: null, members: [], workspace: { status: "unavailable", patterns: [], members: [] }, runtime: [], diagnostics: [] },
    changeScope: { status: "unavailable", scopeRoute: ".", entries: [], truncated: false, diagnostics: [] },
    git: { status: "unavailable", scopeRoute: ".", entries: [], truncated: false, diagnostics: [] },
    ci: { status: "unavailable", present: false, workflows: [], diagnostics: [] },
    releaseRecovery: { status: "unavailable", leads: [], diagnostics: [] },
    ownership: { status: "unavailable", source: [], tests: [], leads: [], diagnostics: [] },
    inventory: { status: "unavailable", files: [], diagnostics: [] },
    evidenceBoundary: { ...EVIDENCE_BOUNDARY, presenceDoesNotProve: [...EVIDENCE_BOUNDARY.presenceDoesNotProve] },
    diagnostics,
    limits,
  };
}

function readPackageManifest(root, route, limits, diagnostics) {
  const result = readBoundedBuffer(root, route, limits.maxManifestBytes);
  if (result.status === "unavailable") {
    if (route === "package.json") diagnostics.push({ code: "missing-package-manifest", surface: "manifests", route });
    return { route, status: "unavailable", data: undefined, scripts: [], diagnostics: result.diagnostics };
  }
  if (result.status !== "available") {
    diagnostics.push({ code: result.code ?? "manifest-unavailable", surface: "manifests", route });
    return { route, status: "partial", data: undefined, scripts: [], diagnostics: result.diagnostics };
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.buffer));
  } catch {
    diagnostics.push({ code: "invalid-package-manifest", surface: "manifests", route });
    return { route, status: "partial", data: undefined, scripts: [], diagnostics: [{ code: "invalid-package-manifest", route }] };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    diagnostics.push({ code: "invalid-package-manifest-shape", surface: "manifests", route });
    return { route, status: "partial", data: undefined, scripts: [], diagnostics: [{ code: "invalid-package-manifest-shape", route }] };
  }
  const scripts = readScripts(data.scripts, route);
  return { route, status: "available", data, scripts, diagnostics: [] };
}

function discoverWorkspaceMembers(root, rootManifest, limits, diagnostics) {
  if (rootManifest.status !== "available") return { status: "unavailable", patterns: [], members: [], diagnostics: [] };
  const diagnosticsBefore = diagnostics.length;
  const parsed = workspacePatterns(rootManifest.data?.workspaces, limits.maxWorkspacePatterns);
  if (parsed.status === "unavailable") return { status: "unavailable", patterns: [], members: [], diagnostics: [] };
  if (parsed.invalidCount > 0) diagnostics.push({ code: "unsafe-workspace-pattern", surface: "manifests", omittedCount: parsed.invalidCount });

  const excluded = parsed.excludes;
  const directories = collectDirectories(root, limits.maxWorkspaceDirectories);
  const candidates = [];
  for (const directory of directories.routes) {
    if (directory === ".") continue;
    if (!matchesWorkspacePatterns(directory, parsed.includes) || excluded.some((pattern) => globMatches(directory, pattern))) continue;
    const manifestRoute = `${directory}/package.json`;
    const state = inspectPathWithoutSymlinks(root, manifestRoute);
    if (state === "regular-file") candidates.push({ route: directory });
    else if (state !== "absent") diagnostics.push({ code: state, surface: "manifests", route: manifestRoute });
  }
  if (directories.truncated) diagnostics.push({ code: "workspace-directory-limit", surface: "manifests" });
  const unique = [...new Map(candidates.map((candidate) => [candidate.route, candidate])).values()]
    .sort((left, right) => left.route.localeCompare(right.route));
  const members = unique.slice(0, limits.maxWorkspaceMembers);
  if (unique.length > members.length) diagnostics.push({ code: "workspace-member-limit", surface: "manifests", omittedCount: unique.length - members.length });
  return {
    status: diagnostics.length > diagnosticsBefore ? "partial" : "available",
    patterns: parsed.includes,
    excludes: parsed.excludes,
    members,
    diagnostics: [],
  };
}

function workspacePatterns(value, limit) {
  const raw = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray(value.packages) ? value.packages : undefined;
  if (!raw) return { status: "unavailable", includes: [], excludes: [], invalidCount: 0 };
  const includes = [];
  const excludes = [];
  let invalidCount = 0;
  for (const item of raw.slice(0, limit)) {
    const stringValue = typeof item === "string" ? item : "";
    const excluded = stringValue.trim().startsWith("!");
    const route = normalizeGlobRoute(excluded ? stringValue.trim().slice(1) : stringValue);
    if (!route) {
      invalidCount++;
      continue;
    }
    (excluded ? excludes : includes).push(route);
  }
  if (raw.length > limit) invalidCount += raw.length - limit;
  return { status: includes.length ? "available" : "unavailable", includes, excludes, invalidCount };
}

function collectDirectories(root, maxDirectories) {
  const routes = ["."];
  const queue = [{ route: ".", absolute: root }];
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    let names;
    try {
      names = fs.readdirSync(current.absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      continue;
    }
    for (const entry of names) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".pi" || entry.name === ".paseo") continue;
      if (entry.name.startsWith(".")) continue;
      const route = current.route === "." ? entry.name : `${current.route}/${entry.name}`;
      if (!normalizeProjectRoute(route)) continue;
      if (!entry.isDirectory()) continue;
      const state = inspectPathWithoutSymlinks(root, route);
      if (state !== "directory") continue;
      if (routes.length >= maxDirectories) {
        truncated = true;
        continue;
      }
      routes.push(route);
      queue.push({ route, absolute: path.join(root, ...route.split("/")) });
    }
  }
  return { routes, truncated };
}

function nearestPackageRoute(root, cwd, packageEntries) {
  const currentRoute = projectRelativeRoute(root, cwd);
  if (!currentRoute) return undefined;
  return packageEntries
    .filter((entry) => entry.status === "available" && isRouteInScope(currentRoute, packageRouteFromManifest(entry.route)))
    .map((entry) => packageRouteFromManifest(entry.route))
    .sort((left, right) => right.length - left.length)[0];
}

function packageRouteFromManifest(route) {
  const normalized = normalizeProjectRoute(route);
  if (!normalized || !normalized.endsWith("/package.json") && normalized !== "package.json") return undefined;
  const directory = path.posix.dirname(normalized);
  return directory === "." ? "." : directory;
}

function collectManifestSurface({ rootManifest, packageEntries, workspace, root, limits, diagnostics }) {
  const diagnosticsBefore = diagnostics.length;
  const runtime = [];
  for (const [route, kind] of RUNTIME_MANIFESTS.slice(0, limits.maxRuntimeManifests)) {
    const state = inspectPathWithoutSymlinks(root, route);
    if (state === "regular-file") runtime.push({ route, kind, present: true });
    else if (state !== "absent") diagnostics.push({ code: state, surface: "manifests", route });
  }
  if (RUNTIME_MANIFESTS.length > limits.maxRuntimeManifests) diagnostics.push({ code: "runtime-manifest-limit", surface: "manifests" });
  const statuses = [rootManifest.status, workspace.status, ...packageEntries.slice(1).map((entry) => entry.status)];
  const status = diagnostics.length > diagnosticsBefore || statuses.includes("partial") ? "partial" : rootManifest.status === "available" ? "available" : "unavailable";
  return { status, runtime, diagnostics: [] };
}

function publicPackageManifest(entry) {
  if (!entry || entry.status === "unavailable") return entry?.route ? { route: entry.route, status: "unavailable" } : null;
  const data = entry.data ?? {};
  return {
    route: entry.route,
    status: entry.status,
    name: safePackageName(data.name),
    version: safeVersion(data.version),
    private: typeof data.private === "boolean" ? data.private : undefined,
    packageManager: safePackageManager(data.packageManager),
    nodeEngine: safeVersion(data.engines?.node),
    sourceRoutes: manifestSourceRoutes(data, entry.route),
    scripts: entry.scripts.map((script) => {
      const scopeRoute = packageRouteFromManifest(script.manifestRoute);
      const reviewed = script.reviewedArgv;
      return {
        name: script.name,
        role: script.role,
        scopeRoute,
        argv: reviewed ? reviewedScriptArgv({ ...script, scopeRoute }) : null,
        policy: reviewed ? "reviewed-argv" : "name-only",
        executed: false,
      };
    }),
  };
}

function publicWorkspace(workspace) {
  return {
    status: workspace.status,
    patterns: workspace.patterns ?? [],
    excludes: workspace.excludes ?? [],
    members: (workspace.members ?? []).map((member) => ({ route: member.route })),
  };
}

function collectScriptLeads(packageEntries) {
  return packageEntries.flatMap((entry) => entry.scripts ?? []).map((script) => ({
    scopeRoute: packageRouteFromManifest(script.manifestRoute),
    manifestRoute: script.manifestRoute,
    name: script.name,
    role: script.role,
    argv: script.reviewedArgv ? reviewedScriptArgv(script) : null,
    policy: script.reviewedArgv ? "reviewed-argv" : "name-only",
    executed: false,
  })).sort((left, right) => `${left.scopeRoute}:${left.name}`.localeCompare(`${right.scopeRoute}:${right.name}`));
}

function validationRoute(script) {
  const reviewed = script.policy === "reviewed-argv";
  return {
    kind: "manifest-script",
    scopeRoute: script.scopeRoute,
    manifestRoute: script.manifestRoute,
    script: script.name,
    role: script.role,
    argv: reviewed ? script.argv : null,
    policy: reviewed ? "reviewed-argv" : "name-only",
    leadStatus: "unverified",
    executionObserved: false,
  };
}

function deliveryRoute(script) {
  const reviewed = script.policy === "reviewed-argv";
  return {
    kind: "manifest-script",
    scopeRoute: script.scopeRoute,
    manifestRoute: script.manifestRoute,
    script: script.name,
    role: script.role,
    argv: reviewed ? script.argv : null,
    policy: reviewed ? "reviewed-argv" : "name-only",
    leadStatus: "unverified",
    executionObserved: false,
  };
}

function reviewedScriptArgv(script) {
  const scopeRoute = script.scopeRoute ?? ".";
  return scopeRoute === "."
    ? ["npm", "run", script.name]
    : ["npm", "--prefix", scopeRoute, "run", script.name];
}

function readScripts(value, manifestRoute) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).sort().slice(0, 64).filter((name) => safeScriptName(name)).map((name) => ({
    name,
    manifestRoute,
    role: scriptRole(name),
    reviewedArgv: isReviewedScriptBody(value[name]),
  }));
}

function scriptRole(name) {
  const lower = name.toLowerCase();
  const base = lower.replace(/^(pre|post)/, "");
  if (/^(test|tests)(:|$)/.test(base)) return "test";
  if (/^lint(:|$)/.test(base)) return "lint";
  if (/^(check|checks)(:|$)/.test(base)) return "check";
  if (/^(typecheck|type-check)(:|$)/.test(base)) return "typecheck";
  if (/^(verify|validate)(:|$)/.test(base)) return base.startsWith("verify") ? "verify" : "validate";
  if (/^build(:|$)/.test(base)) return "build";
  if (/^(release|version)(:|$)/.test(base)) return "release";
  if (/^(publish|pack)(:|$)/.test(base)) return base.startsWith("pack") ? "pack" : "publish";
  if (/^(deploy|ship)(:|$)/.test(base)) return "deploy";
  if (/^(setup|prepare|install)(:|$)/.test(base)) return "setup";
  if (/^(start|dev|serve)(:|$)/.test(base)) return "start";
  return "other";
}

function isReviewedScriptBody(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  if (/[;&|<>$`\\'"()[\]{}\n\r]/.test(value)) return false;
  const argv = value.trim().split(/\s+/).filter(Boolean);
  if (!argv.length || !SAFE_COMMANDS.has(path.posix.basename(argv[0]))) return false;
  return argv.every((token) => token.length <= 80
    && !token.includes("=")
    && !token.startsWith("/")
    && !token.startsWith("..")
    && !UNSAFE_ARGUMENTS.has(token)
    && /^[A-Za-z0-9_@%+:.,/?-]+$/.test(token));
}

function safeScriptName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 64 && /^[A-Za-z0-9_@%+:./-]+$/.test(name);
}

function manifestSourceRoutes(data, manifestRoute) {
  const output = [];
  for (const field of ["main", "module", "types"]) {
    const route = safeManifestRoute(data?.[field], packageRouteFromManifest(manifestRoute));
    if (route) output.push({ field, route });
  }
  return output;
}

function safeManifestRoute(value, packageRoute) {
  if (typeof value !== "string" || value.length > 160) return undefined;
  const route = normalizeProjectRoute(packageRoute === "." ? value : `${packageRoute}/${value}`);
  if (!route || isSensitiveRoute(route)) return undefined;
  return route;
}

function collectOwnershipLeads({ root, packageEntries, workspaceTarget, limits, diagnostics }) {
  const diagnosticsBefore = diagnostics.length;
  const leads = [];
  const source = [];
  const tests = [];
  for (const entry of packageEntries) {
    if (entry.status !== "available") continue;
    const packageRoute = packageRouteFromManifest(entry.route);
    for (const name of SOURCE_DIRECTORY_NAMES) {
      const route = packageRoute === "." ? name : `${packageRoute}/${name}`;
      if (inspectPathWithoutSymlinks(root, route) === "directory") {
        const lead = { kind: "source", route, ownerRoute: packageRoute, basis: "directory", present: true };
        source.push(lead);
        leads.push(lead);
      }
    }
    for (const name of TEST_DIRECTORY_NAMES) {
      const route = packageRoute === "." ? name : `${packageRoute}/${name}`;
      if (inspectPathWithoutSymlinks(root, route) === "directory") {
        const lead = { kind: "test", route, ownerRoute: packageRoute, basis: "directory", present: true };
        tests.push(lead);
        leads.push(lead);
      }
    }
    for (const sourceRoute of manifestSourceRoutes(entry.data, entry.route)) {
      const lead = { kind: "source", route: sourceRoute.route, ownerRoute: packageRoute, basis: `manifest:${sourceRoute.field}`, present: inspectPathWithoutSymlinks(root, sourceRoute.route) === "regular-file" };
      source.push(lead);
      leads.push(lead);
    }
  }
  leads.sort((left, right) => `${left.kind}:${left.route}`.localeCompare(`${right.kind}:${right.route}`));
  const bounded = leads.slice(0, limits.maxOwnershipLeads);
  if (leads.length > bounded.length) diagnostics.push({ code: "ownership-lead-limit", surface: "ownership", omittedCount: leads.length - bounded.length });
  const status = diagnostics.length > diagnosticsBefore ? "partial" : bounded.length ? "available" : packageEntries.some((entry) => entry.status === "partial") ? "partial" : "unavailable";
  return { status, source: source.slice(0, limits.maxOwnershipLeads), tests: tests.slice(0, limits.maxOwnershipLeads), leads: bounded, diagnostics: [] };
}

function publicOwnership(ownership) {
  return {
    status: ownership.status,
    source: ownership.source,
    tests: ownership.tests,
    leads: ownership.leads,
    diagnostics: ownership.diagnostics.map(safeDiagnostic),
  };
}

function collectInstructions(root, ownerRoutes, limits) {
  const lane = inventoryProjectAgentAssets({
    projectRoot: root,
    ownerRoutes,
    limits: {
      maxFileBytes: limits.maxInstructionFileBytes,
      maxAggregateBytes: limits.maxInstructionAggregateBytes,
      maxAssets: limits.maxInstructionAssets,
    },
  });
  const projection = publicAgentAssetInventory(lane);
  const status = lane.status === "complete" ? "available" : lane.status === "partial" ? "partial" : "unavailable";
  return {
    status,
    assets: projection.surfaces,
    diagnostics: projection.diagnostics.map(safeDiagnostic),
  };
}

function collectCiLeads(root, limits) {
  const workflows = [];
  const diagnostics = [];
  for (const [route, provider] of CI_ROOT_FILES) {
    const state = inspectPathWithoutSymlinks(root, route);
    if (state === "regular-file") workflows.push({ route, name: path.posix.basename(route), provider });
    else if (state !== "absent") diagnostics.push({ code: state, surface: "ci", route });
  }
  const workflowsDir = inspectPathWithoutSymlinks(root, ".github/workflows");
  if (workflowsDir === "directory") {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      diagnostics.push({ code: "ci-directory-unreadable", surface: "ci", route: ".github/workflows" });
    }
    for (const entry of entries) {
      if (!/\.(?:ya?ml)$/i.test(entry.name)) continue;
      const route = `.github/workflows/${entry.name}`;
      const state = inspectPathWithoutSymlinks(root, route);
      if (state === "regular-file") workflows.push({ route, name: entry.name, provider: "github-actions" });
      else if (state !== "absent") diagnostics.push({ code: state, surface: "ci", route });
    }
  } else if (workflowsDir !== "absent") {
    diagnostics.push({ code: workflowsDir, surface: "ci", route: ".github/workflows" });
  }
  const unique = [...new Map(workflows.map((workflow) => [workflow.route, workflow])).values()].sort((left, right) => left.route.localeCompare(right.route));
  const bounded = unique.slice(0, limits.maxCiWorkflows);
  if (unique.length > bounded.length) diagnostics.push({ code: "ci-workflow-limit", surface: "ci", omittedCount: unique.length - bounded.length });
  return {
    status: diagnostics.length ? "partial" : bounded.length ? "available" : "unavailable",
    present: bounded.length > 0,
    workflows: bounded,
    diagnostics,
  };
}

function publicCi(ci) {
  return { status: ci.status, present: ci.present, workflows: ci.workflows, diagnostics: ci.diagnostics.map(safeDiagnostic) };
}

function collectDocumentationLeads(root, limits) {
  const leads = [];
  const diagnostics = [];
  for (const [route, role] of KNOWN_DOCUMENT_ROUTES) {
    const state = inspectPathWithoutSymlinks(root, route);
    if (state === "regular-file" || state === "directory") leads.push({ kind: "documentation", role, route, present: true });
    else if (state !== "absent") diagnostics.push({ code: state, surface: "releaseRecovery", route });
  }
  for (const route of boundedDocumentationRoutes(root, limits.maxDocumentationLeads)) {
    const role = /release|releas|change/i.test(path.posix.basename(route)) ? "release" : "recovery";
    leads.push({ kind: "documentation", role, route, present: true });
  }
  const unique = [...new Map(leads.map((lead) => [lead.route, lead])).values()].sort((left, right) => left.route.localeCompare(right.route));
  const bounded = unique.slice(0, limits.maxDocumentationLeads);
  if (unique.length > bounded.length) diagnostics.push({ code: "documentation-lead-limit", surface: "releaseRecovery", omittedCount: unique.length - bounded.length });
  return { status: diagnostics.length ? "partial" : bounded.length ? "available" : "unavailable", leads: bounded, diagnostics };
}

function boundedDocumentationRoutes(root, limit) {
  const roots = ["docs"];
  const routes = [];
  for (const base of roots) {
    if (inspectPathWithoutSymlinks(root, base) !== "directory") continue;
    const queue = [{ route: base, absolute: path.join(root, base), depth: 0 }];
    while (queue.length && routes.length < limit) {
      const current = queue.shift();
      let entries;
      try {
        entries = fs.readdirSync(current.absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
      } catch {
        continue;
      }
      for (const entry of entries) {
        const route = `${current.route}/${entry.name}`;
        if (!normalizeProjectRoute(route) || entry.name.startsWith(".")) continue;
        const state = inspectPathWithoutSymlinks(root, route);
        if (entry.isDirectory() && current.depth < 2 && state === "directory") queue.push({ route, absolute: path.join(root, ...route.split("/")), depth: current.depth + 1 });
        if (state === "regular-file" && /(?:release|releas|recover|rollback|runbook|operation|deploy|disaster|change)/i.test(entry.name)) routes.push(route);
        if (routes.length >= limit) break;
      }
    }
  }
  return routes;
}

function publicDocumentation(documentation) {
  return { status: documentation.status, leads: documentation.leads, diagnostics: documentation.diagnostics.map(safeDiagnostic) };
}

function collectKnownInventory(root, limits, diagnostics) {
  const files = [];
  for (const [route, kind] of RUNTIME_MANIFESTS.slice(0, limits.maxRuntimeManifests)) {
    if (inspectPathWithoutSymlinks(root, route) === "regular-file") files.push({ route, kind });
  }
  for (const [route, kind] of CI_ROOT_FILES) {
    if (inspectPathWithoutSymlinks(root, route) === "regular-file") files.push({ route, kind: `ci:${kind}` });
  }
  for (const [route, role] of KNOWN_DOCUMENT_ROUTES) {
    if (inspectPathWithoutSymlinks(root, route) === "regular-file" || inspectPathWithoutSymlinks(root, route) === "directory") files.push({ route, kind: `documentation:${role}` });
  }
  const unique = [...new Map(files.map((file) => [file.route, file])).values()].sort((left, right) => left.route.localeCompare(right.route));
  return { status: diagnostics.length ? "partial" : "available", files: unique, diagnostics: [] };
}

function publicInventory(inventory) {
  return { status: inventory.status, files: inventory.files, diagnostics: inventory.diagnostics.map(safeDiagnostic) };
}

function collectGitChangeScope({ root, gitRootPresent, scopeRoute, limits }) {
  const unavailable = { status: "unavailable", scopeRoute: normalizeScopeRoute(scopeRoute), entries: [], truncated: false, diagnostics: [{ code: "git-metadata-missing", surface: "git" }] };
  if (!gitRootPresent) return unavailable;
  const gitState = inspectGitDirectory(root);
  if (gitState.status !== "available") return { ...unavailable, status: "partial", diagnostics: gitState.diagnostics };

  const diagnostics = [...gitState.diagnostics];
  const indexResult = readGitIndex(gitState.gitDir, root, limits);
  if (indexResult.status !== "available") return { status: "partial", scopeRoute: normalizeScopeRoute(scopeRoute), entries: [], truncated: false, diagnostics: [...diagnostics, ...indexResult.diagnostics] };
  const headResult = readHeadTree(gitState.gitDir, limits);
  diagnostics.push(...headResult.diagnostics);
  const indexEntries = indexResult.entries;
  const indexByRoute = new Map(indexEntries.map((entry) => [entry.route, entry]));
  const headByRoute = headResult.tree;
  const changes = [];
  const orderedRoutes = [...new Set([
    ...indexEntries.map((entry) => entry.route),
    ...headByRoute.keys(),
  ])].sort();
  for (const route of orderedRoutes) {
    if (!isRouteInScope(route, normalizeScopeRoute(scopeRoute))) continue;
    const indexEntry = indexByRoute.get(route);
    const headOid = headByRoute.get(route);
    const indexStatus = !indexEntry ? "deleted" : !headOid ? "added" : headOid !== indexEntry.oid ? "modified" : undefined;
    const worktree = indexEntry ? inspectWorktreeEntry(root, indexEntry) : { status: undefined };
    if (worktree.diagnostic) diagnostics.push({ ...worktree.diagnostic, surface: "git" });
    const status = indexStatus || worktree.status;
    if (!status) continue;
    changes.push({
      route,
      status: status === "unsafe" ? "unsafe" : status,
      staged: Boolean(indexStatus),
      worktree: Boolean(worktree.status),
      indexStatus: indexStatus ?? null,
      worktreeStatus: worktree.status ?? null,
      stage: indexEntry?.stage ?? 0,
    });
  }
  const untracked = collectUntrackedFiles(root, indexByRoute, scopeRoute, limits.maxGitScanEntries, diagnostics);
  changes.push(...untracked.map((route) => ({ route, status: "untracked", staged: false, worktree: true, indexStatus: null, worktreeStatus: "untracked", stage: 0 })));
  const unique = [...new Map(changes.map((change) => [change.route, change])).values()].sort((left, right) => left.route.localeCompare(right.route));
  const bounded = unique.slice(0, limits.maxGitEntries);
  const truncated = unique.length > bounded.length;
  if (truncated) diagnostics.push({ code: "git-entry-limit", surface: "git", omittedCount: unique.length - bounded.length });
  return {
    status: diagnostics.length ? "partial" : "available",
    scopeRoute: normalizeScopeRoute(scopeRoute),
    entries: bounded,
    truncated,
    diagnostics,
  };
}

function inspectGitDirectory(root) {
  const gitPath = path.join(root, ".git");
  let stat;
  try {
    stat = fs.lstatSync(gitPath);
  } catch (error) {
    return { status: error?.code === "ENOENT" ? "unavailable" : "partial", diagnostics: [{ code: error?.code === "ENOENT" ? "git-metadata-missing" : "git-metadata-unreadable", surface: "git" }] };
  }
  if (stat.isSymbolicLink()) return { status: "partial", diagnostics: [{ code: "git-metadata-symlink", surface: "git", route: ".git" }] };
  if (stat.isDirectory()) return { status: "available", gitDir: fs.realpathSync(gitPath), diagnostics: [] };
  if (stat.isFile()) return { status: "partial", diagnostics: [{ code: "git-worktree-metadata-external", surface: "git", route: ".git" }] };
  return { status: "partial", diagnostics: [{ code: "git-metadata-unreadable", surface: "git", route: ".git" }] };
}

function readGitIndex(gitDir, root, limits) {
  const result = readBoundedBuffer(gitDir, "index", limits.maxGitIndexBytes, { allowNul: true });
  if (result.status !== "available") return { status: "partial", entries: [], diagnostics: [{ code: result.code === "missing-file" ? "git-index-unavailable" : result.code ?? "git-index-unavailable", surface: "git" }] };
  const buffer = result.buffer;
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "DIRC") return { status: "partial", entries: [], diagnostics: [{ code: "git-index-invalid", surface: "git" }] };
  const version = buffer.readUInt32BE(4);
  if (![2, 3].includes(version)) return { status: "partial", entries: [], diagnostics: [{ code: "git-index-version-unsupported", surface: "git" }] };
  const count = buffer.readUInt32BE(8);
  if (count > limits.maxGitScanEntries) return { status: "partial", entries: [], diagnostics: [{ code: "git-index-entry-limit", surface: "git", omittedCount: count - limits.maxGitScanEntries }] };
  const entries = [];
  let offset = 12;
  for (let index = 0; index < count; index++) {
    if (offset + 62 > buffer.length) return { status: "partial", entries: [], diagnostics: [{ code: "git-index-truncated", surface: "git" }] };
    const ctimeSec = buffer.readUInt32BE(offset);
    const ctimeNano = buffer.readUInt32BE(offset + 4);
    const mtimeSec = buffer.readUInt32BE(offset + 8);
    const mtimeNano = buffer.readUInt32BE(offset + 12);
    const size = buffer.readUInt32BE(offset + 36);
    const oid = buffer.subarray(offset + 40, offset + 60).toString("hex");
    const flags = buffer.readUInt16BE(offset + 60);
    const entryOffset = offset;
    offset += 62;
    const nul = buffer.indexOf(0, offset);
    if (nul < 0) return { status: "partial", entries: [], diagnostics: [{ code: "git-index-path-truncated", surface: "git" }] };
    let name;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(offset, nul));
    } catch {
      return { status: "partial", entries: [], diagnostics: [{ code: "git-index-path-invalid", surface: "git" }] };
    }
    const route = normalizeProjectRoute(name);
    if (!route || route === "." || isSensitiveRoute(route)) {
      offset = alignEntry(nul + 1, entryOffset);
      continue;
    }
    entries.push({ route, oid, stage: (flags >> 12) & 3, ctimeSec, ctimeNano, mtimeSec, mtimeNano, size, entryOffset });
    offset = alignEntry(nul + 1, entryOffset);
  }
  return { status: "available", entries, diagnostics: [] };
}

function readHeadTree(gitDir, limits) {
  const head = readGitText(gitDir, "HEAD", 4096);
  if (head.status !== "available") return { tree: new Map(), diagnostics: [{ code: "git-head-unavailable", surface: "git" }] };
  const value = head.text.trim();
  let oid;
  if (/^[a-f0-9]{40}$/.test(value)) oid = value;
  else if (value.startsWith("ref: ")) {
    const ref = normalizeGitRoute(value.slice(5).trim());
    if (!ref) return { tree: new Map(), diagnostics: [{ code: "git-head-ref-invalid", surface: "git" }] };
    const refResult = readGitText(gitDir, ref, 4096);
    if (refResult.status !== "available" || !/^[a-f0-9]{40}$/.test(refResult.text.trim())) return { tree: new Map(), diagnostics: [{ code: "git-head-ref-unavailable", surface: "git" }] };
    oid = refResult.text.trim();
  } else return { tree: new Map(), diagnostics: [{ code: "git-head-invalid", surface: "git" }] };
  const commit = readGitObject(gitDir, oid, limits.maxGitObjectBytes);
  if (commit.status !== "available" || commit.type !== "commit") return { tree: new Map(), diagnostics: [{ code: "git-head-object-unavailable", surface: "git" }] };
  const treeLine = commit.body.toString("utf8").split("\n").find((line) => line.startsWith("tree "));
  const treeOid = treeLine?.slice(5).trim();
  if (!/^[a-f0-9]{40}$/.test(treeOid ?? "")) return { tree: new Map(), diagnostics: [{ code: "git-tree-unavailable", surface: "git" }] };
  const tree = new Map();
  const result = walkGitTree(gitDir, treeOid, "", tree, limits, 0);
  return { tree, diagnostics: result.ok ? [] : [{ code: result.code ?? "git-tree-unavailable", surface: "git" }] };
}

function walkGitTree(gitDir, oid, prefix, output, limits, depth) {
  if (depth > 32 || output.size >= limits.maxGitScanEntries) return { ok: false, code: "git-tree-limit" };
  const object = readGitObject(gitDir, oid, limits.maxGitObjectBytes);
  if (object.status !== "available" || object.type !== "tree") return { ok: false, code: "git-tree-object-unavailable" };
  const data = object.body;
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) return { ok: false, code: "git-tree-invalid" };
    const nul = data.indexOf(0, space + 1);
    if (nul < 0 || nul + 21 > data.length) return { ok: false, code: "git-tree-invalid" };
    const mode = data.toString("ascii", offset, space);
    let name;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(space + 1, nul));
    } catch {
      return { ok: false, code: "git-tree-path-invalid" };
    }
    const route = normalizeProjectRoute(prefix ? `${prefix}/${name}` : name);
    if (!route || isSensitiveRoute(route)) {
      offset = nul + 21;
      continue;
    }
    const childOid = data.subarray(nul + 1, nul + 21).toString("hex");
    if (mode === "40000" || mode === "040000") {
      const nested = walkGitTree(gitDir, childOid, route, output, limits, depth + 1);
      if (!nested.ok) return nested;
    } else {
      output.set(route, childOid);
    }
    offset = nul + 21;
  }
  return { ok: true };
}

function readGitObject(gitDir, oid, maxBytes) {
  if (!/^[a-f0-9]{40}$/.test(oid)) return { status: "partial" };
  const route = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  const compressed = readBoundedBuffer(gitDir, route, maxBytes, { allowNul: true });
  if (compressed.status !== "available") return { status: "partial" };
  let data;
  try {
    data = zlib.inflateSync(compressed.buffer, { maxOutputLength: maxBytes + 1 });
  } catch {
    return { status: "partial" };
  }
  const nul = data.indexOf(0);
  if (nul < 0) return { status: "partial" };
  const header = data.toString("ascii", 0, nul).split(" ");
  if (header.length !== 2 || !["commit", "tree", "blob"].includes(header[0])) return { status: "partial" };
  const declaredSize = Number(header[1]);
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > maxBytes) return { status: "partial" };
  const body = data.subarray(nul + 1);
  if (body.length !== declaredSize) return { status: "partial" };
  return { status: "available", type: header[0], body };
}

function inspectWorktreeEntry(root, entry) {
  const state = inspectPathWithoutSymlinks(root, entry.route);
  if (state === "absent") return { status: "deleted" };
  if (state !== "regular-file") return { status: "unsafe", diagnostic: { code: state, route: entry.route } };
  try {
    const stat = fs.statSync(path.join(root, ...entry.route.split("/")));
    const changed = stat.size !== entry.size
      || Math.floor(stat.mtimeMs / 1000) !== entry.mtimeSec
      || Math.floor(stat.ctimeMs / 1000) !== entry.ctimeSec;
    return changed ? { status: "modified" } : { status: undefined };
  } catch {
    return { status: "unreadable", diagnostic: { code: "git-worktree-unreadable", route: entry.route } };
  }
}

function collectUntrackedFiles(root, indexByRoute, scopeRoute, maxEntries, diagnostics) {
  const queue = [{ route: ".", absolute: root, depth: 0 }];
  const output = [];
  let visited = 0;
  while (queue.length && visited < maxEntries) {
    const current = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(current.absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".pi" || entry.name === ".paseo") continue;
      const route = current.route === "." ? entry.name : `${current.route}/${entry.name}`;
      const normalizedScope = normalizeScopeRoute(scopeRoute);
      const inScope = isRouteInScope(route, normalizedScope) || isRouteInScope(normalizedScope, route);
      if (!normalizeProjectRoute(route) || !inScope) continue;
      const state = inspectPathWithoutSymlinks(root, route);
      if (state === "symlink-file" || state === "symlink-directory") {
        diagnostics.push({ code: state, surface: "git", route });
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth < 12 && state === "directory") queue.push({ route, absolute: path.join(root, ...route.split("/")), depth: current.depth + 1 });
        continue;
      }
      if (state !== "regular-file") continue;
      visited++;
      if (isSensitiveRoute(route)) {
        diagnostics.push({ code: "sensitive-route-omitted", surface: "git" });
        continue;
      }
      if (!indexByRoute.has(route)) output.push(route);
      if (visited >= maxEntries) break;
    }
  }
  if (visited >= maxEntries && queue.length) diagnostics.push({ code: "git-scan-limit", surface: "git" });
  return output;
}

function publicChangeScope(scope) {
  return {
    status: scope.status,
    scopeRoute: scope.scopeRoute,
    entries: scope.entries,
    truncated: scope.truncated,
    diagnostics: scope.diagnostics.map(safeDiagnostic),
  };
}

function readGitText(gitDir, route, maxBytes) {
  const result = readBoundedBuffer(gitDir, route, maxBytes);
  if (result.status !== "available") return { status: result.status };
  try {
    return { status: "available", text: new TextDecoder("utf-8", { fatal: true }).decode(result.buffer) };
  } catch {
    return { status: "partial" };
  }
}

function readBoundedBuffer(root, route, maxBytes, { allowNul = false } = {}) {
  const normalized = normalizeProjectRoute(route);
  if (!normalized) return { status: "partial", code: "unsafe-path", diagnostics: [{ code: "unsafe-path", route: safeRoute(route) }] };
  const pathState = inspectPathWithoutSymlinks(root, normalized);
  if (pathState === "absent") return { status: "unavailable", code: "missing-file", diagnostics: [] };
  if (pathState !== "regular-file") return { status: "partial", code: pathState, diagnostics: [{ code: pathState, route: normalized }] };
  if (typeof fs.constants.O_NOFOLLOW !== "number") return { status: "partial", code: "secure-open-unavailable", diagnostics: [{ code: "secure-open-unavailable", route: normalized }] };
  const absolutePath = path.join(root, ...normalized.split("/"));
  let fd;
  try {
    fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    return { status: "partial", code: error?.code === "ELOOP" ? "symlink-file" : "unreadable", diagnostics: [{ code: error?.code === "ELOOP" ? "symlink-file" : "unreadable", route: normalized }] };
  }
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) return { status: "partial", code: "not-regular-file", diagnostics: [{ code: "not-regular-file", route: normalized }] };
    const descriptorPath = descriptorRealPath(fd);
    if (!descriptorPath || !isInsideRoot(root, descriptorPath) || path.resolve(descriptorPath) !== path.resolve(absolutePath)) return { status: "partial", code: "binding-mismatch", diagnostics: [{ code: "binding-mismatch", route: normalized }] };
    if (before.size > maxBytes) return { status: "partial", code: "oversized", diagnostics: [{ code: "oversized", route: normalized }] };
    const buffer = readDescriptor(fd, maxBytes);
    const after = fs.fstatSync(fd);
    if (!sameFileSnapshot(before, after) || buffer.length !== before.size) return { status: "partial", code: "mutated-during-read", diagnostics: [{ code: "mutated-during-read", route: normalized }] };
    if (!allowNul && buffer.includes(0)) return { status: "partial", code: "nul-byte", diagnostics: [{ code: "nul-byte", route: normalized }] };
    return { status: "available", buffer };
  } catch {
    return { status: "partial", code: "unreadable", diagnostics: [{ code: "unreadable", route: normalized }] };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // Best-effort close after bounded descriptor reads.
    }
  }
}

function readDescriptor(fd, maxBytes) {
  const buffer = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  return buffer.subarray(0, offset);
}

function descriptorRealPath(fd) {
  for (const base of ["/proc/self/fd", "/dev/fd"]) {
    try {
      const resolved = fs.realpathSync(path.join(base, String(fd)));
      if (path.isAbsolute(resolved)) return resolved;
    } catch {
      // Try the next descriptor namespace.
    }
  }
  return undefined;
}

function inspectPathWithoutSymlinks(root, route) {
  const normalized = normalizeProjectRoute(route);
  if (!normalized) return "outside-authority";
  let current = root;
  const segments = normalized === "." ? [] : normalized.split("/");
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
    if (index < segments.length - 1 && !stat.isDirectory()) return "not-directory";
    if (index === segments.length - 1) return stat.isDirectory() ? "directory" : stat.isFile() ? "regular-file" : "not-regular-file";
  }
  return "directory";
}

function projectRelativeRoute(root, target) {
  if (typeof target !== "string") return undefined;
  const relative = path.relative(root, path.resolve(target));
  if (!relative || relative === "") return ".";
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return undefined;
  return normalizeProjectRoute(relative.replaceAll(path.sep, "/"));
}

function normalizeProjectRoute(value) {
  const raw = String(value ?? "").trim().replace(/^\.\//, "");
  if (!raw || raw === ".") return raw === "." ? "." : undefined;
  if (raw.startsWith("/") || raw.includes("\0") || raw.includes("\\")) return undefined;
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

function normalizeGlobRoute(value) {
  const raw = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!raw || raw.startsWith("/") || raw.includes("\0") || raw.split("/").some((segment) => segment === "..")) return undefined;
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

function normalizeGitRoute(value) {
  const route = String(value ?? "").trim().replaceAll("\\", "/");
  if (!route || route.startsWith("/") || route.includes("\0") || route.split("/").some((part) => part === "..")) return undefined;
  return path.posix.normalize(route);
}

function normalizeScopeRoute(route) {
  return normalizeProjectRoute(route) ?? ".";
}

function safeRoute(value) {
  return normalizeProjectRoute(value) ?? "<outside-project>";
}

function isRouteInScope(route, scope) {
  const normalizedRoute = normalizeProjectRoute(route);
  const normalizedScope = normalizeScopeRoute(scope);
  if (!normalizedRoute) return false;
  return normalizedScope === "." || normalizedRoute === normalizedScope || normalizedRoute.startsWith(`${normalizedScope}/`);
}

function matchesWorkspacePatterns(route, patterns) {
  return patterns.some((pattern) => globMatches(route, pattern));
}

function globMatches(route, pattern) {
  const routeParts = route.split("/");
  const patternParts = pattern.split("/");
  return matchGlobParts(routeParts, patternParts, 0, 0);
}

function matchGlobParts(route, pattern, routeIndex, patternIndex) {
  if (patternIndex === pattern.length) return routeIndex === route.length;
  const part = pattern[patternIndex];
  if (part === "**") return matchGlobParts(route, pattern, routeIndex, patternIndex + 1)
    || routeIndex < route.length && matchGlobParts(route, pattern, routeIndex + 1, patternIndex);
  if (routeIndex >= route.length) return false;
  if (!segmentMatches(route[routeIndex], part)) return false;
  return matchGlobParts(route, pattern, routeIndex + 1, patternIndex + 1);
}

function segmentMatches(value, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${escaped}$`).test(value);
}

function sameFileSnapshot(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function alignEight(offset) {
  return (offset + 7) & ~7;
}

function alignEntry(offset, entryStart) {
  return entryStart + alignEight(offset - entryStart);
}

function isAbsoluteDirectory(value) {
  try {
    return path.isAbsolute(value) && fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function normalizeAbsoluteDirectory(value) {
  return typeof value === "string" && path.isAbsolute(value) ? value : undefined;
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isSensitiveRoute(route) {
  const parts = String(route).split("/").map((part) => part.toLowerCase());
  return parts.some((part) => PRIVATE_ROUTE_PARTS.has(part)
    || part.endsWith(".pem")
    || part.endsWith(".key")
    || part.endsWith(".p12")
    || part === ".env"
    || part.startsWith(".env."));
}

function safeText(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 160 || /[\0\r\n]/.test(value)) return undefined;
  return value;
}

function safePackageManager(value) {
  const text = safeText(value);
  return text && /^[A-Za-z0-9@._:+/-]+$/.test(text) ? text : undefined;
}

function safePackageName(value) {
  const text = safeText(value);
  return text && /^@?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(text) ? text : undefined;
}

function safeVersion(value) {
  const text = safeText(value);
  return text && !text.startsWith("/") && !text.includes("..") && /^[A-Za-z0-9.*<>=^~|&/ +,-]+$/.test(text) ? text : undefined;
}

function safeDiagnostic(diagnostic) {
  const output = { code: safeText(diagnostic?.code) ?? "diagnostic", surface: safeText(diagnostic?.surface) };
  if (diagnostic?.route) output.route = safeRoute(diagnostic.route);
  if (Number.isInteger(diagnostic?.omittedCount) && diagnostic.omittedCount > 0) output.omittedCount = diagnostic.omittedCount;
  if (diagnostic?.severity) output.severity = safeText(diagnostic.severity);
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== undefined));
}
