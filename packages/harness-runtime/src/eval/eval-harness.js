import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseSessionFile } from "../session/parse-session.js";
import { collectNormalizeWarnings } from "../session/warnings.js";
import { redactString, redactValue, isSensitivePath } from "../safety/redaction.js";
import { runRuleEngine } from "../analysis/rules.js";
import { discoverWikiPromptRules } from "../analysis/wiki-prompt-rules.js";
import { approveProposal, applyProposal } from "../proposals/lifecycle.js";
import { findDraftProposal, writeDraftProposals } from "../proposals/proposal-writer.js";
import { atomicWriteFile, atomicWriteJson, ensureDir } from "../storage/atomic-write.js";
import { projectCacheDir, resolveHarnessHome } from "../storage/harness-home.js";

export const BUILT_IN_SCENARIOS = [
  "redaction-fixture",
  "parser-unknown-entry",
  "edit-oldText-workflow",
  "file-protection",
  "smart-commit-basic",
  "ts-extension-safety",
  "wiki-prompt-rule-file-protection",
  "wiki-prompt-rule-section-routing",
  "wiki-prompt-rule-lazy-loading",
  "harness-wiki-command-surface",
];

export async function runEvalHarness({ config, project, scenario, proposalId } = {}) {
  const scenarioNames = scenario ? [scenario] : BUILT_IN_SCENARIOS;
  for (const name of scenarioNames) {
    if (!BUILT_IN_SCENARIOS.includes(name)) throw cliLikeError(`Unknown eval scenario: ${name}`);
  }

  const startedAt = new Date();
  const results = [];
  for (const name of scenarioNames) results.push(await runScenario(name, { config, project }));
  if (proposalId) results.unshift(runProposalQuality({ config, project, proposalId }));

  const summary = summarizeResults(results);
  const report = {
    schemaVersion: 1,
    generatedAt: startedAt.toISOString(),
    projectKey: project.projectKey,
    proposalId,
    scenarios: scenarioNames,
    summary,
    results,
  };
  const paths = writeEvalReport({ config, project, report, now: startedAt });
  return { ...report, paths };
}

export function writeEvalReport({ config, project, report, now = new Date() }) {
  const evalDir = path.join(projectCacheDir(resolveHarnessHome(config), project.projectKey), "evals");
  ensureDir(evalDir);
  const latestJsonPath = path.join(evalDir, "latest.json");
  const latestMarkdownPath = path.join(evalDir, "latest.md");
  const datedJsonPath = path.join(evalDir, `${now.toISOString().slice(0, 10)}-eval.json`);
  const datedMarkdownPath = path.join(evalDir, `${now.toISOString().slice(0, 10)}-eval.md`);
  atomicWriteJson(latestJsonPath, report);
  atomicWriteJson(datedJsonPath, report);
  const markdown = renderEvalMarkdown(report);
  atomicWriteFile(latestMarkdownPath, markdown);
  atomicWriteFile(datedMarkdownPath, markdown);
  return { evalDir, latestJsonPath, latestMarkdownPath, datedJsonPath, datedMarkdownPath };
}

export function renderEvalMarkdown(report) {
  const lines = [];
  lines.push(`# Pi Harness Eval — ${report.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Project: \`${report.projectKey}\``);
  if (report.proposalId) lines.push(`- Proposal: \`${report.proposalId}\``);
  lines.push(`- Passed: ${report.summary.passed}`);
  lines.push(`- Failed: ${report.summary.failed}`);
  lines.push(`- Skipped: ${report.summary.skipped}`);
  lines.push("");
  lines.push("## Results");
  lines.push("| Scenario | Status | Checks | Message |");
  lines.push("|---|---|---:|---|");
  for (const result of report.results) {
    lines.push(`| ${escapeCell(result.scenario)} | ${result.status} | ${result.checks.length} | ${escapeCell(result.message ?? "")} |`);
  }
  lines.push("");
  for (const result of report.results) {
    lines.push(`### ${result.scenario}`);
    lines.push("");
    for (const check of result.checks) lines.push(`- [${check.ok ? "x" : " "}] ${check.name}${check.message ? ` — ${check.message}` : ""}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function runScenario(name, context) {
  try {
    switch (name) {
      case "redaction-fixture":
        return scenarioResult(name, redactionFixtureChecks());
      case "parser-unknown-entry":
        return scenarioResult(name, await parserUnknownEntryChecks());
      case "edit-oldText-workflow":
        return scenarioResult(name, editOldTextWorkflowChecks(context));
      case "file-protection":
        return scenarioResult(name, fileProtectionChecks());
      case "smart-commit-basic":
        return scenarioResult(name, smartCommitBasicChecks());
      case "ts-extension-safety":
        return scenarioResult(name, tsExtensionSafetyChecks(context));
      case "wiki-prompt-rule-file-protection":
        return scenarioResult(name, wikiPromptRuleFileProtectionChecks(context));
      case "wiki-prompt-rule-section-routing":
        return scenarioResult(name, wikiPromptRuleSectionRoutingChecks(context));
      case "wiki-prompt-rule-lazy-loading":
        return scenarioResult(name, wikiPromptRuleLazyLoadingChecks(context));
      case "harness-wiki-command-surface":
        return scenarioResult(name, harnessWikiCommandSurfaceChecks(context));
      default:
        throw cliLikeError(`Unknown eval scenario: ${name}`);
    }
  } catch (error) {
    return {
      scenario: name,
      status: "fail",
      message: error.message,
      checks: [{ name: "scenario threw", ok: false, message: error.message }],
    };
  }
}

function redactionFixtureChecks() {
  const secret = redactString("token sk-abcdefghijklmnopqrstuvwxyz");
  const object = redactValue({ nested: { apiKey: "abc123" }, safe: { totalTokens: 123 } });
  return [
    check("OpenAI-like key is redacted", secret.value.includes("<REDACTED_SECRET>") && !secret.value.includes("sk-abcdefghijklmnopqrstuvwxyz")),
    check("sensitive object key is redacted", object.value.nested.apiKey === "<REDACTED_SECRET>"),
    check("usage key totalTokens is not redacted", object.value.safe.totalTokens === 123),
    check(".env path is sensitive", isSensitivePath(".env")),
    check("Pi auth path is sensitive", isSensitivePath(".pi/agent/auth.json")),
  ];
}

async function parserUnknownEntryChecks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-eval-parser-"));
  const filePath = path.join(root, "session.jsonl");
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: "session", version: 3, id: "s-parser", cwd: root, timestamp: "2026-06-14T00:00:00.000Z" }),
    JSON.stringify({ type: "future_entry", id: "e1", parentId: null, timestamp: "2026-06-14T00:00:01.000Z" }),
  ].join("\n") + "\n");
  const parsed = await parseSessionFile(filePath);
  const warnings = collectNormalizeWarnings(parsed);
  return [
    check("session header parsed", parsed.header?.id === "s-parser"),
    check("unknown entry warning emitted", warnings.some((warning) => warning.code === "unknown_entry_type" && warning.entryId === "e1")),
    check("parser kept unknown entry for evidence", parsed.entries.some((entry) => entry.id === "e1")),
  ];
}

function editOldTextWorkflowChecks() {
  const fixture = createProjectFixture("harness-eval-edit-");
  const session = writeCachedSession(fixture, {
    sessionId: "s-edit",
    events: [
      toolResultEvent("e1", "edit", "oldText must match a unique region of the original file"),
      toolResultEvent("e2", "edit", "oldText did not match"),
    ],
  });
  const proposals = runRuleEngine({ project: fixture.project, sessionResults: [session] });
  const proposal = proposals.find((item) => item.ruleId === "R-0002");
  return [
    check("R-0002 proposal generated", Boolean(proposal)),
    check("proposal targets global Markdown prompt rules", proposal?.target === "rules" && proposal?.targetFiles?.includes("wiki/_rules.md")),
    check("proposal includes evidence refs", (proposal?.evidence?.length ?? 0) >= 2),
  ];
}

function fileProtectionChecks() {
  const fixture = createGitProjectFixture("harness-eval-protect-");
  fs.writeFileSync(path.join(fixture.projectRoot, ".env"), "SECRET=old\n");
  git(fixture.projectRoot, ["add", ".env"]);
  git(fixture.projectRoot, ["commit", "-m", "add env"]);

  const proposal = writeProposalWithPatch(fixture, {
    title: "Unsafe env patch",
    targetFiles: ["AGENTS.md"],
    patch: [{ path: ".env", oldText: "SECRET=old", newText: "SECRET=new" }],
  });
  approveProposal({ config: fixture.config, project: fixture.project, id: proposal.id });

  let blocked = false;
  let message = "";
  try {
    applyProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  } catch (error) {
    blocked = /not listed in proposal target files|target/i.test(error.message);
    message = error.message;
  }

  return [
    check("unsafe patch is blocked", blocked, message),
    check("protected file unchanged", fs.readFileSync(path.join(fixture.projectRoot, ".env"), "utf8") === "SECRET=old\n"),
  ];
}

function smartCommitBasicChecks() {
  const fixture = createGitProjectFixture("harness-eval-apply-");
  const proposal = writeProposalWithPatch(fixture, {
    title: "Safe AGENTS patch",
    targetFiles: ["AGENTS.md"],
    patch: [{ path: "AGENTS.md", oldText: "Existing note.", newText: "Existing note.\n- Validate harness eval before automation." }],
  });
  approveProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  const applied = applyProposal({ config: fixture.config, project: fixture.project, id: proposal.id });
  const branch = git(fixture.projectRoot, ["branch", "--show-current"]).stdout.trim();
  const content = fs.readFileSync(path.join(fixture.projectRoot, "AGENTS.md"), "utf8");
  return [
    check("apply moved to harness proposal branch", branch === `harness/${proposal.id}`, branch),
    check("only target file changed", applied.changedPaths.length === 1 && applied.changedPaths[0] === "AGENTS.md"),
    check("patch content applied", content.includes("Validate harness eval before automation")),
  ];
}

function tsExtensionSafetyChecks({ project }) {
  const extensionPath = path.join(project.projectRoot, "packages", "pi-learn-extensions", "extensions", "harness", "index.ts");
  const exists = fs.existsSync(extensionPath);
  const source = exists ? fs.readFileSync(extensionPath, "utf8") : "";
  return [
    check("harness extension exists", exists, extensionPath),
    check("extension delegates to runtime API", source.includes("runHarness") && source.includes("RUNTIME_API")),
    check("extension exposes Harness improvement review", source.includes('registerCommand("harness-improve"') && source.includes("pi.sendUserMessage")),
    check("extension does not expose removed reflection alias", !source.includes('registerCommand("harness-reflect-pi"')),
    check("UI operations are guarded", source.includes("ctx.hasUI") && source.includes("ctx.ui?.")),
  ];
}

function wikiPromptRuleFileProtectionChecks({ project }) {
  const commandSource = readProjectFile(project, "packages/pi-learn-extensions/extensions/harness/wiki-commands.ts");
  const promptSource = readProjectFile(project, "packages/pi-learn-extensions/extensions/harness/wiki-prompt.ts");
  const lifecycleSource = readProjectFile(project, "packages/harness-runtime/src/proposals/lifecycle.js");
  return [
    check("Wiki tool calls have a deterministic mutation gate", /pi\.on\("tool_call"/.test(commandSource) && commandSource.includes("isProtectedWikiMutationPath")),
    check("Wiki prompt forbids normal prompt-rule edits", promptSource.includes("Do not create, edit, move, or delete any") && promptSource.includes("_rules.md")),
    check("controlled apply validates changed prompt rules", lifecycleSource.includes("validateChangedPromptRules") && lifecycleSource.includes("restoreOriginalFiles")),
  ];
}

function wikiPromptRuleSectionRoutingChecks({ project }) {
  const fixture = createProjectFixture("harness-eval-wiki-routing-");
  const session = writeCachedSession(fixture, {
    sessionId: "s-wiki-routing",
    events: [
      toolResultEvent("e1", "edit", "oldText must match a unique region"),
      toolResultEvent("e2", "edit", "oldText did not match"),
      bashExecutionEvent("b1", "npm test", 1),
      bashExecutionEvent("b2", "npm test", 1),
    ],
  });
  const proposals = runRuleEngine({ project: fixture.project, sessionResults: [session] });
  const editProposal = proposals.find((item) => item.ruleId === "R-0002");
  const bashProposal = proposals.find((item) => item.ruleId === "R-0001");
  const ruleReport = discoverWikiPromptRules({ projectRoot: project.projectRoot });
  return [
    check("edit workflow routes to global prompt rules", editProposal?.targetFiles?.includes("wiki/_rules.md")),
    check("bash workflow routes to operations prompt rules", bashProposal?.targetFiles?.includes("wiki/operations/_rules.md")),
    check("repository prompt-rule sections are valid", ruleReport.valid, ruleReport.errors.map((item) => item.message).join("; ")),
  ];
}

function wikiPromptRuleLazyLoadingChecks({ project }) {
  const agents = readProjectFile(project, "AGENTS.md");
  const quickstart = readProjectFile(project, "wiki/quickstart.md");
  const promptSource = readProjectFile(project, "packages/pi-learn-extensions/extensions/harness/wiki-prompt.ts");
  const commandSource = readProjectFile(project, "packages/pi-learn-extensions/extensions/harness/wiki-commands.ts");
  return [
    check("AGENTS bootstraps quickstart and root rules", agents.includes("wiki/quickstart.md") && agents.includes("wiki/_rules.md")),
    check("quickstart maps all prompt-rule sections", ["wiki/_rules.md", "architecture/_rules.md", "extensions/_rules.md", "operations/_rules.md"].every((item) => quickstart.includes(item))),
    check("Harness Wiki task prompt tells the model to read rules", promptSource.includes("Prompt-rule loading discipline") && promptSource.includes("read tool results")),
    check("Wiki module does not automatically inject rules", !commandSource.includes("before_agent_start") && !commandSource.includes('pi.on("context"')),
  ];
}

function harnessWikiCommandSurfaceChecks({ project }) {
  const source = readProjectFile(project, "packages/pi-learn-extensions/extensions/harness/wiki-commands.ts");
  const oldWikiEntrypoint = path.join(project.projectRoot, "packages", "pi-learn-extensions", "extensions", "wiki", "index.ts");
  const expected = ["harness-wiki-init", "harness-wiki-update", "harness-wiki-ask", "harness-wiki-status"];
  return [
    check("all Harness Wiki commands are registered", expected.every((command) => source.includes(`registerCommand(\"${command}\"`))),
    check("legacy Wiki commands are not registered", !/registerCommand\("wiki-(?:init|update|ask|status)"/.test(source)),
    check("legacy Wiki extension entrypoint is removed", !fs.existsSync(oldWikiEntrypoint), oldWikiEntrypoint),
  ];
}

function readProjectFile(project, relativePath) {
  const filePath = path.join(project.projectRoot, ...relativePath.split("/"));
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function runProposalQuality({ config, project, proposalId }) {
  const proposal = findDraftProposal({ config, project, id: proposalId });
  if (!proposal) {
    return { scenario: "proposal-quality", status: "fail", message: `Proposal not found: ${proposalId}`, checks: [check("proposal exists", false)] };
  }
  const markdown = fs.readFileSync(proposal.filePath, "utf8");
  const checks = [
    check("proposal exists", true),
    check("status is reviewable", ["draft", "approved", "applied", "rejected", "rolled_back"].includes(proposal.status)),
    check("has target", Boolean(proposal.target)),
    check("has risk", ["low", "medium", "high"].includes(proposal.risk)),
    check("has evidence refs", Number(proposal.evidenceCount ?? 0) > 0 || /## Evidence[\s\S]*entry:/m.test(markdown)),
    check("has target files", /## Target files[\s\S]*-\s+\S+/m.test(markdown) && !/## Target files[\s\S]*- TBD/m.test(markdown)),
    check("has test plan", /## Test plan[\s\S]*-\s+\S+/m.test(markdown) && !/## Test plan[\s\S]*- TBD/m.test(markdown)),
    check("has rollback", /## Rollback\s+\S+/m.test(markdown)),
  ];
  if (proposal.risk === "high") {
    checks.push(check("high-risk proposal mentions eval/test", /eval|test|fixture|npm|node --test/i.test(markdown)));
  }
  return scenarioResult("proposal-quality", checks);
}

function scenarioResult(scenario, checks) {
  const failed = checks.filter((item) => !item.ok);
  return {
    scenario,
    status: failed.length ? "fail" : "pass",
    message: failed.length ? `${failed.length} check(s) failed` : "ok",
    checks,
  };
}

function summarizeResults(results) {
  return {
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    skipped: results.filter((result) => result.status === "skip").length,
  };
}

function check(name, ok, message) {
  return { name, ok: Boolean(ok), message };
}

function createProjectFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  return {
    root,
    config: { harnessHome: path.join(root, "harness-home") },
    project: { cwd: projectRoot, projectRoot, gitRoot: projectRoot, projectKey: "project-test", name: "project" },
  };
}

function createGitProjectFixture(prefix) {
  const fixture = createProjectFixture(prefix);
  const { projectRoot } = fixture.project;
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Notes\n\nExisting note.\n");
  git(projectRoot, ["init"]);
  git(projectRoot, ["config", "user.email", "eval@example.com"]);
  git(projectRoot, ["config", "user.name", "Harness Eval"]);
  git(projectRoot, ["add", "AGENTS.md"]);
  git(projectRoot, ["commit", "-m", "initial"]);
  return { ...fixture, projectRoot };
}

function writeCachedSession(fixture, { sessionId, events, warnings = [] }) {
  const dir = path.join(fixture.root, "cache", sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, "events.jsonl");
  const warningsPath = path.join(dir, "warnings.jsonl");
  fs.writeFileSync(eventsPath, events.map((event) => JSON.stringify({
    schemaVersion: 1,
    projectKey: fixture.project.projectKey,
    sessionId,
    sessionFile: "/tmp/session.jsonl",
    parentId: null,
    timestamp: "2026-06-14T00:00:00.000Z",
    cwd: fixture.project.cwd,
    activePath: true,
    rawRef: { sessionFile: "/tmp/session.jsonl", entryId: event.entryId },
    safety: { redacted: false, sensitivePath: false, secretDetected: false },
    ...event,
  })).join("\n") + (events.length ? "\n" : ""));
  fs.writeFileSync(warningsPath, warnings.map((warning) => JSON.stringify(warning)).join("\n") + (warnings.length ? "\n" : ""));
  return { sessionId, sessionFile: "/tmp/session.jsonl", paths: { events: eventsPath, warnings: warningsPath }, warnings };
}

function toolResultEvent(entryId, toolName, excerpt) {
  return {
    eventId: `${entryId}_evt`,
    entryId,
    kind: "tool_result",
    summary: `${toolName} result error`,
    excerpt,
    tool: { name: toolName, isError: true },
  };
}

function bashExecutionEvent(entryId, command, exitCode) {
  return {
    eventId: `${entryId}_evt`,
    entryId,
    kind: "bash_execution",
    summary: `${command} exit ${exitCode}`,
    excerpt: `${command} failed`,
    bash: { command, exitCode },
  };
}

function writeProposalWithPatch(fixture, { title, targetFiles, patch }) {
  const result = writeDraftProposals({
    config: fixture.config,
    project: fixture.project,
    proposals: [{
      ruleId: "EVAL",
      title,
      target: "agents",
      targetFiles,
      risk: "low",
      problem: "Eval fixture proposal.",
      proposedChange: "Apply fixture patch.",
      testPlan: ["Manual eval fixture verification."],
      rollbackPlan: "Revert fixture patch.",
      evidence: [{ sessionId: "eval", entryId: "e1", kind: "fixture", excerpt: "eval fixture" }],
      fingerprint: `${title}-${Date.now()}-${Math.random()}`,
    }],
  });
  const proposal = result.written[0];
  fs.appendFileSync(proposal.filePath, `\n## Patch\n\`\`\`json\n${JSON.stringify(patch)}\n\`\`\`\n`);
  return proposal;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result;
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 240);
}

function cliLikeError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}
