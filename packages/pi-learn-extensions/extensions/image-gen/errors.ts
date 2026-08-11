const REDACTIONS: Array<[RegExp, string]> = [
  [/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]"],
  [/\b(?:sk|sess)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]"],
  [/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi, "data:image/[REDACTED]"],
  [/(authorization\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]"],
];

export function redactSensitiveText(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value);
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text;
}

export class ImageGenError extends Error {
  constructor(
    message: string,
    readonly category: string,
    readonly backend?: "subscription" | "api",
    readonly step?: string,
    options?: ErrorOptions,
  ) {
    super(redactSensitiveText(message), options);
    this.name = new.target.name;
  }
}

export class ImageGenAuthError extends ImageGenError {
  constructor(message: string, backend?: "subscription" | "api", options?: ErrorOptions) {
    super(message, "auth", backend, "auth", options);
  }
}

export class ImageGenCapabilityError extends ImageGenError {
  constructor(message: string, backend?: "subscription" | "api", options?: ErrorOptions) {
    super(message, "capability", backend, "capability-validation", options);
  }
}

export class ImageGenInputError extends ImageGenError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "input", undefined, "input-validation", options);
  }
}

export class ImageGenModerationError extends ImageGenError {
  constructor(message: string, backend?: "subscription" | "api", options?: ErrorOptions) {
    super(message, "moderation", backend, "generation", options);
  }
}

export class ImageGenRateLimitError extends ImageGenError {
  constructor(message: string, backend?: "subscription" | "api", options?: ErrorOptions) {
    super(message, "rate-limit", backend, "generation", options);
  }
}

export class ImageGenBackendError extends ImageGenError {
  constructor(message: string, backend?: "subscription" | "api", step = "generation", options?: ErrorOptions) {
    super(message, "backend", backend, step, options);
  }
}

export class ImageGenOutputError extends ImageGenError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "output", undefined, "save", options);
  }
}

export class ImageGenValidationError extends ImageGenError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "validation", undefined, "image-validation", options);
  }
}
