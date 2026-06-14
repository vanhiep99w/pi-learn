export function truncateString(input, maxChars = 1000) {
  if (typeof input !== "string") return { value: input, truncated: false };
  if (input.length <= maxChars) return { value: input, truncated: false };
  if (maxChars <= 20) return { value: input.slice(0, maxChars), truncated: true };

  const marker = `\n... <truncated ${input.length - maxChars} chars> ...\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(remaining / 2);
  const tail = Math.floor(remaining / 2);
  return {
    value: `${input.slice(0, head)}${marker}${input.slice(input.length - tail)}`,
    truncated: true,
  };
}

export function headTail(input, headChars = 1000, tailChars = 3000) {
  if (typeof input !== "string") return { head: undefined, tail: undefined, truncated: false };
  const max = headChars + tailChars;
  if (input.length <= max) return { head: input, tail: undefined, truncated: false };
  return {
    head: input.slice(0, headChars),
    tail: input.slice(input.length - tailChars),
    truncated: true,
  };
}

export function countLines(input) {
  if (!input) return 0;
  return String(input).split(/\r?\n/).length;
}

export function extractErrorLines(input, maxLines = 50) {
  if (typeof input !== "string") return [];
  const patterns = /error|failed|failure|exception|traceback|typeerror|referenceerror|syntaxerror|enoent|eacces|fail\b/i;
  return input
    .split(/\r?\n/)
    .filter((line) => patterns.test(line))
    .slice(-maxLines);
}
