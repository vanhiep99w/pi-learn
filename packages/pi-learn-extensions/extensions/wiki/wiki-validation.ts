import { lstatSync } from "node:fs";
import path from "node:path";
import { validateWikiInternalLinks } from "./wiki-links.js";
import { discoverWikiPromptRules } from "./wiki-rules.js";
import {
  isWikiReadPath, isWikiRuleValidationPath, readWikiDocument, readWikiRuleForValidation,
  WikiModelError, type WikiDiagnostic, type WikiReadModel,
} from "./wiki-model.ts";

export const WIKI_VALIDATION_SCOPES = ["graph", "links", "rules", "all"] as const;
export type WikiValidationScope = (typeof WIKI_VALIDATION_SCOPES)[number];
type Group = Exclude<WikiValidationScope, "all">;
export type ScopedWikiDiagnostic = WikiDiagnostic & { scope: Group };
interface RuleIssue { path: string; code: string; message: string }

/** Explicit rule lint is separate from normal content lookup; it never returns rule text. */
export function validateWikiReadOnly(model: WikiReadModel, scope: WikiValidationScope = "graph") {
  if (!(WIKI_VALIDATION_SCOPES as readonly string[]).includes(scope)) {
    throw new WikiModelError("invalid_scope", "Unknown Wiki validation scope.");
  }
  const groups: Partial<Record<Group, { valid: boolean; filesScanned?: number; nodes?: number; linksChecked?: number }>> = {};
  const diagnostics: ScopedWikiDiagnostic[] = [];
  const relative = (absolute: string) => path.relative(model.projectRoot, absolute).split(path.sep).join("/");
  const includeDocument = (repositoryPath: string, directory: boolean) => repositoryPath.startsWith("wiki/")
    && isWikiReadPath(repositoryPath.slice(5).replace(/\/$/u, ""), directory);
  const includeTarget = (repositoryPath: string, directory: boolean, hasAnchor: boolean) => {
    if (includeDocument(repositoryPath, directory)) return true;
    if (directory && !hasAnchor && (repositoryPath === "wiki" || repositoryPath === "wiki/")) return true;
    if (!repositoryPath.startsWith("wiki/") || hasAnchor) return false;
    const relativePath = repositoryPath.slice(5).replace(/\/$/u, "");
    // Existing navigation may link reserved resources without requesting their contents.
    if (!directory && (isWikiRuleValidationPath(relativePath) || relativePath === "INSTRUCTIONS.md" || relativePath === ".last-update.json")) return true;
    if (!directory && /\.md$/iu.test(relativePath)) return false;
    // Asset/file links without anchors need existence checks only, never content reads.
    const checked = relativePath.split("/").map((segment) => segment.toLowerCase() === "assets" ? "wiki-assets" : segment).join("/");
    return isWikiReadPath(directory ? checked : `${checked}.md`, directory);
  };
  const failedRead = (group: Group, absolute: string, error: unknown) => {
    diagnostics.push({
      scope: group, path: relative(absolute), severity: "error",
      code: error instanceof WikiModelError ? error.code : "read_failed",
      message: "Cannot safely read this Wiki file for validation.",
    });
  };
  for (const group of (scope === "all" ? ["graph", "links", "rules"] : [scope]) as Group[]) {
    const start = diagnostics.length;
    try {
      const root = lstatSync(model.wikiRoot);
      if (!root.isDirectory() || root.isSymbolicLink()) throw new WikiModelError("wiki_invalid", "wiki/ must be a real directory.");
      if (group === "graph") {
        const report = model.validate();
        diagnostics.push(...report.diagnostics.map((diagnostic) => ({ ...diagnostic, scope: group })));
        groups.graph = { valid: report.valid, filesScanned: report.filesScanned, nodes: report.nodes };
      } else if (group === "links") {
        const report = validateWikiInternalLinks({
          projectRoot: model.projectRoot,
          includePath: includeDocument,
          includeTarget,
          readContent: (absolute: string) => {
            try { return readWikiDocument(model.wikiRoot, absolute); }
            catch (error) { failedRead(group, absolute, error); return ""; }
          },
        });
        diagnostics.push(...report.issues.map((issue: { sourcePath: string; line: number; message: string }) => ({
          scope: group, path: issue.sourcePath, code: "invalid_link", severity: "error" as const,
          message: `Line ${issue.line}: ${issue.message}`,
        })));
        groups.links = { valid: false, filesScanned: report.filesScanned, linksChecked: report.linksChecked };
      } else {
        const report: { files: string[]; errors: RuleIssue[]; warnings: RuleIssue[] } = discoverWikiPromptRules({
          projectRoot: model.projectRoot,
          includePath: (repositoryPath: string, directory: boolean) => includeDocument(repositoryPath, directory)
            || (!directory && repositoryPath.startsWith("wiki/") && isWikiRuleValidationPath(repositoryPath.slice(5))),
          readRuleFile: (absolute: string) => {
            try { return readWikiRuleForValidation(model.wikiRoot, absolute); }
            catch (error) { failedRead(group, absolute, error); return Buffer.alloc(0); }
          },
        });
        for (const severity of ["error", "warning"] as const) {
          for (const issue of severity === "error" ? report.errors : report.warnings) diagnostics.push({
            scope: group, path: issue.path, code: issue.code, severity,
            // Legacy lint messages may quote a rule line. Expose codes, never policy/brief contents.
            message: `Rule validation: ${issue.code.replace(/_/gu, " ")}.`,
          });
        }
        groups.rules = { valid: false, filesScanned: report.files.length };
      }
      groups[group]!.valid = !diagnostics.slice(start).some((diagnostic) => diagnostic.severity === "error");
    } catch (error) {
      diagnostics.push({
        scope: group, path: "wiki", severity: "error",
        code: error instanceof WikiModelError ? error.code : "validation_failed",
        message: "Cannot complete this validation group; wiki/ may be missing or inaccessible.",
      });
      groups[group] = { valid: false };
    }
  }
  return { scope, valid: Object.values(groups).every((group) => group.valid), groups, diagnostics };
}
