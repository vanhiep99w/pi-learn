// Wiki path/bash mutation checks; these guards are not an OS sandbox or an intent classifier.
import { relativeProjectPath, isWikiRulePath, isWikiMetadataPath, isWikiInstructionsPath } from "./wiki-rules.js";
import { safePolicyTarget } from "./wiki-policy.js";

export type ProtectionOptions = { protectRules: boolean; protectWikiBrief: boolean };

export function isProtectedWikiMutationPath(cwd: string, value: unknown, options: ProtectionOptions): boolean {
  if (typeof value !== "string") return false;
  const relative = relativeProjectPath(cwd, value);
  const ruleLike = isWikiRulePath(relative) || /(?:^|\/)wiki\/(?:.*\/)?_rules\.md$/u.test(value.replace(/\\/gu, "/"));
  if (ruleLike) {
    if (options.protectRules || relative === undefined || value.includes("\\") || value.split("/").includes("..")) return true;
    try { safePolicyTarget(cwd, relative, true); }
    catch { return true; }
  }
  return relative !== undefined && (isWikiMetadataPath(relative)
    || (options.protectWikiBrief && isWikiInstructionsPath(relative)));
}

export function commandMutatesProtectedWikiPath(cwd: string, command: string, options: ProtectionOptions): boolean {
  const normalized = command.replace(/\\/g, "/");
  if (!/(?:>>?|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\btee\b|\bsed\s+-[^\n]*i|\bperl\s+-[^\n]*i)/i.test(normalized)) return false;
  const mentionsRules = /wiki\/(?:[^\s'";&|>]+\/)*_rules\.md\b/.test(normalized);
  const mentionsMetadata = /wiki\/\.last-update\.json\b/.test(normalized);
  const mentionsWikiBrief = options.protectWikiBrief && /wiki\/INSTRUCTIONS\.md\b/.test(normalized);
  if (mentionsMetadata || mentionsWikiBrief || (mentionsRules && options.protectRules)) return true;
  // Check explicit shell path operands too; scripts, substitutions and arbitrary tools are not sandboxed.
  const tokens = command.match(/"[^"]*"|'[^']*'|[^\s'";&|><]+/gu) ?? [];
  return tokens.some((token) => isProtectedWikiMutationPath(cwd, token.replace(/^['"]|['"]$/gu, ""), options));
}
