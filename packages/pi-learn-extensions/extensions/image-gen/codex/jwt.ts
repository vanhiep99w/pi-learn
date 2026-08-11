import { ImageGenAuthError } from "../errors.ts";

type CodexJwtClaims = {
  chatgpt_account_id?: string;
  organizations?: Array<{ id?: string }>;
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
};

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new ImageGenAuthError("The openai-codex OAuth credential is not a valid JWT.", "subscription");
  }

  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid payload");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ImageGenAuthError("Cannot decode the openai-codex OAuth JWT payload.", "subscription", { cause: error });
  }
}

export function getChatGptAccountId(token: string): string {
  const claims = decodeJwtPayload(token) as CodexJwtClaims;
  const accountId =
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.chatgpt_account_id ??
    claims.organizations?.[0]?.id;

  if (!accountId) {
    throw new ImageGenAuthError("The openai-codex OAuth credential does not contain a ChatGPT account id. Run /login and select ChatGPT Plus/Pro (Codex) again.", "subscription");
  }
  return accountId;
}
