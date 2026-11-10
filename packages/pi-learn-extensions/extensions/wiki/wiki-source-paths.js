// Wiki-specific routing metadata; upstream Spec Graph retains unknown frontmatter fields.
// These literal scopes never open source files and never grant read/write permission.
export const WIKI_SOURCE_PATHS_FIELD = "source-paths";
export const MAX_SOURCE_PATHS = 200;

export function isLiteralSourcePath(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 1024
      || /[\\:\u0000-\u001f\u007f*?{}\[\]]/u.test(value) || value.startsWith("/")) return false;
  const parts = (value.endsWith("/") ? value.slice(0, -1) : value).split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

export function validSourcePaths(value) {
  return Array.isArray(value) && value.length <= MAX_SOURCE_PATHS
    && value.every(isLiteralSourcePath) && new Set(value).size === value.length;
}

export function matchesSourcePath(scope, sourcePath) {
  return scope.endsWith("/") ? sourcePath.startsWith(scope) : scope === sourcePath;
}
