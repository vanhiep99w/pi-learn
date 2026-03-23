// ═══════════════════════════════════════════════════════════════
//  Shared utilities: key management, caching, rate limiting, URL helpers
// ═══════════════════════════════════════════════════════════════

// ── Tavily Multi-Key Rotation ──
const exhaustedKeys = new Set<string>();
const tempFailKeys = new Map<string, number>();
const TEMP_FAIL_COOLDOWN = 60_000;

export function getTavilyKeys(): string[] {
  const raw = process.env.TAVILY_API_KEY || "";
  return raw
    .split(",")
    .map((k: string) => k.trim())
    .filter((k: string) => k.length > 0);
}

export function isKeyExhausted(key: string): boolean {
  if (exhaustedKeys.has(key)) return true;
  const tempFail = tempFailKeys.get(key);
  if (tempFail && Date.now() - tempFail < TEMP_FAIL_COOLDOWN) return true;
  tempFailKeys.delete(key);
  return false;
}

export function markKeyExhausted(key: string, permanent: boolean) {
  if (permanent) {
    exhaustedKeys.add(key);
  } else {
    tempFailKeys.set(key, Date.now());
  }
}

// ── Search & Fetch Cache ──
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const searchCache = new Map<string, CacheEntry<any>>();
const fetchCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = 5 * 60_000; // 5 minutes

export function getCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  data: T
) {
  // Evict oldest if cache grows too large
  if (cache.size > 50) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, timestamp: Date.now() });
}

export { searchCache, fetchCache };

// ── Rate Limiter ──
const requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 15;

export async function rateLimit(): Promise<void> {
  const now = Date.now();
  // Remove timestamps older than 1 minute
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60_000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    const waitMs = 60_000 - (now - requestTimestamps[0]);
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 1000)));
  }
  requestTimestamps.push(Date.now());
}

// ── URL Helpers ──

/**
 * Convert GitHub blob URLs to raw URLs for direct content access
 * github.com/user/repo/blob/branch/path → raw.githubusercontent.com/user/repo/branch/path
 */
export function normalizeUrl(url: string): string {
  // HTTP → HTTPS
  if (url.startsWith("http://")) {
    url = url.replace(/^http:\/\//i, "https://");
  }

  // GitHub blob → raw
  const ghMatch = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/
  );
  if (ghMatch) {
    url = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`;
  }

  return url;
}

/**
 * Detect if content is likely binary/PDF
 */
export function isBinaryContent(content: string): boolean {
  // Check for PDF header
  if (content.trimStart().startsWith("%PDF")) return true;
  // Check for high ratio of non-printable characters
  const nonPrintable = content
    .slice(0, 500)
    .split("")
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code < 32 && code !== 10 && code !== 13 && code !== 9;
    }).length;
  return nonPrintable > 50;
}

// ── Formatting ──

export function formatChars(n: number): string {
  if (n < 1000) return `${n} chars`;
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K chars`;
  return `${(n / 1000000).toFixed(1)}M chars`;
}

export function currentYear(): number {
  return new Date().getFullYear();
}
