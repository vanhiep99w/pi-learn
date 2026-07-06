const SECRET_PATTERNS = [
  { name: "openai_key", regex: /sk-[A-Za-z0-9_-]{12,}/g },
  { name: "github_pat", regex: /github_pat_[A-Za-z0-9_]{12,}/g },
  { name: "github_ghp", regex: /ghp_[A-Za-z0-9_]{12,}/g },
  { name: "tavily_key", regex: /tvly-[A-Za-z0-9_-]{8,}/gi },
  { name: "authorization_bearer", regex: /(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replacement: "$1<REDACTED_SECRET>" },
  { name: "env_secret_assignment", regex: /((?:API|TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s]+/gi, replacement: "$1<REDACTED_SECRET>" },
  { name: "sensitive_env_assignment", regex: /([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*\s*=\s*)[^\s]*/gi, replacement: "$1<REDACTED_SECRET>" },
  { name: "sensitive_yaml_assignment", regex: /([A-Z0-9_.-]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_.-]*\s*:\s*)[^\s#]+/gi, replacement: "$1<REDACTED_SECRET>" },
  { name: "long_opaque_token", regex: /\b(?=[A-Za-z0-9_-]{80,}\b)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, replacement: "<REDACTED_SECRET>" },
];

const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/,
  /\.pem$/,
  /\.key$/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_ed25519$/,
  /\.pi\/logs\/llm-payloads\//,
  /\.pi\/agent\/auth\.json$/,
  /\.pi\/agent\/chatgpt-usage-accounts\.json$/,
  /\.pi\/agent\/sessions\//,
];

export function redactString(input) {
  if (typeof input !== "string") return { value: input, redacted: false, secretDetected: false };

  let value = input;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    const before = value;
    value = value.replace(pattern.regex, pattern.replacement ?? "<REDACTED_SECRET>");
    if (value !== before) redacted = true;
  }

  return {
    value,
    redacted,
    secretDetected: redacted,
  };
}

export function redactValue(value, depth = 0) {
  if (depth > 8) return { value: "<REDACTED_DEPTH_LIMIT>", redacted: true, secretDetected: false };

  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return { value, redacted: false, secretDetected: false };

  if (Array.isArray(value)) {
    let redacted = false;
    let secretDetected = false;
    const next = value.map((item) => {
      const result = redactValue(item, depth + 1);
      redacted ||= result.redacted;
      secretDetected ||= result.secretDetected;
      return result.value;
    });
    return { value: next, redacted, secretDetected };
  }

  let redacted = false;
  let secretDetected = false;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      next[key] = "<REDACTED_SECRET>";
      redacted = true;
      secretDetected = true;
      continue;
    }
    const result = redactValue(item, depth + 1);
    redacted ||= result.redacted;
    secretDetected ||= result.secretDetected;
    next[key] = result.value;
  }
  return { value: next, redacted, secretDetected };
}

export function isSensitivePath(value) {
  if (typeof value !== "string") return false;
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(value));
}

function isSensitiveKey(key) {
  return /(^|[_-])(token|secret|password|authorization|api[_-]?key|cookie)([_-]|$)/i.test(key);
}
