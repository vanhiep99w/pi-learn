// Shared by the Wiki owner and delegated children; these guards are not an OS sandbox.
import { relativeProjectPath, isWikiPolicyPath, isWikiMetadataPath, isWikiInstructionsPath } from "./wiki-rules.js";

export type ProtectionOptions = { protectRules: boolean; protectWikiBrief: boolean };

export function isProtectedWikiMutationPath(cwd: string, value: unknown, options: ProtectionOptions): boolean {
  if (typeof value !== "string") return false;
  const relative = relativeProjectPath(cwd, value);
  return relative !== undefined && (
    (options.protectRules && isWikiPolicyPath(relative))
    || isWikiMetadataPath(relative)
    || (options.protectWikiBrief && isWikiInstructionsPath(relative))
  );
}

export function commandMutatesProtectedWikiPath(command: string, options: ProtectionOptions): boolean {
  const normalized = command.replace(/\\/g, "/");
  const mentionsRules = options.protectRules && (/wiki\/(?:[^\s'";&|>]+\/)*_rules\.md\b/.test(normalized) || /wiki\/_domains\.json\b/i.test(normalized));
  const mentionsMetadata = /wiki\/\.last-update\.json\b/.test(normalized);
  const mentionsWikiBrief = options.protectWikiBrief && /wiki\/INSTRUCTIONS\.md\b/.test(normalized);
  if (!mentionsRules && !mentionsMetadata && !mentionsWikiBrief) return false;
  return /(?:>>?|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\btee\b|\bsed\s+-[^\n]*i|\bperl\s+-[^\n]*i)/i.test(normalized);
}
