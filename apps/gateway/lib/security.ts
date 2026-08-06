import { logWarn, logError } from "./log.ts";

const MAX_BODY_SIZE_BYTES = 1_048_576;
const MAX_URL_LENGTH = 2048;
const MAX_HEADER_VALUE_LENGTH = 4096;
const MAX_QUERY_PARAMS = 50;
const MAX_QUERY_VALUE_LENGTH = 1024;
const NONCE_EXPIRY_MS = 600_000;
const TIMESTAMP_SKEW_MS = 120_000;
const IP_RATE_LIMIT_MAX = 100;
const IP_RATE_LIMIT_WINDOW_MS = 60_000;
const PROGRESSIVE_PENALTY_BASE_MS = 30_000;

const SQL_INJECTION_PATTERNS = [
  /(\bUNION\s+(ALL\s+)?SELECT\b)/i,
  /(--|\/\*|\*\/|;\s*(DROP|DELETE|UPDATE|ALTER|TRUNCATE))/i,
  /(\b(OR|AND)\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i,
  /('|")\s*(OR|AND)\s*('|")/i,
  /CHAR\s*\(/i,
  /0x[0-9a-f]+/i,
  /\bxp_cmdshell\b/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<link[\s>]/i,
  /expression\s*\(/i,
  /url\s*\(/i,
  /<svg[\s>]/i,
  /<img[\s>]+[^>]+onerror/i,
  /<body[\s>]+[^>]+onload/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e/i,
  /%252e%252e/i,
  /\.\.%2f/i,
  /\.\.%5c/i,
  /%2e%2e%2f/i,
  /%2e%2e%5c/i,
];

const COMMAND_INJECTION_PATTERNS = [/[;&|`$]/, /\$\(/, /\$\{/, /\|\|/, /&&/, /\n|\r/];

const IP_RATE_LIMIT_MAX_ENTRIES = 10_000;
const NONCE_CACHE_MAX_ENTRIES = 10_000;
const FAILED_AUTH_MAX_ENTRIES = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanupAt = 0;

const ipRateLimitMap = new Map<string, { count: number; resetAt: number; penaltyUntil: number }>();
const nonceCache = new Map<string, number>();
const failedAuthMap = new Map<string, { count: number; lastFail: number }>();

// Evict expired entries periodically and enforce max size to prevent DoS.
function periodicSecurityCleanup(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  // Evict expired rate limit entries
  if (ipRateLimitMap.size > IP_RATE_LIMIT_MAX_ENTRIES / 2) {
    for (const [key, entry] of ipRateLimitMap) {
      if (now > entry.resetAt && now > entry.penaltyUntil) {
        ipRateLimitMap.delete(key);
      }
    }
  }
  // Enforce max size — drop oldest if still over limit
  if (ipRateLimitMap.size > IP_RATE_LIMIT_MAX_ENTRIES) {
    const iter = ipRateLimitMap.keys();
    for (let i = 0; i < IP_RATE_LIMIT_MAX_ENTRIES / 4; i++) {
      const next = iter.next();
      if (next.done) break;
      ipRateLimitMap.delete(next.value);
    }
  }

  // Evict expired nonces
  for (const [key, ts] of nonceCache) {
    if (now - ts > NONCE_EXPIRY_MS) {
      nonceCache.delete(key);
    }
  }
  if (nonceCache.size > NONCE_CACHE_MAX_ENTRIES) {
    const iter = nonceCache.keys();
    for (let i = 0; i < NONCE_CACHE_MAX_ENTRIES / 4; i++) {
      const next = iter.next();
      if (next.done) break;
      nonceCache.delete(next.value);
    }
  }

  // Evict expired failed auth entries (>15min old)
  for (const [key, entry] of failedAuthMap) {
    if (now - entry.lastFail > 900_000) {
      failedAuthMap.delete(key);
    }
  }
  if (failedAuthMap.size > FAILED_AUTH_MAX_ENTRIES) {
    const iter = failedAuthMap.keys();
    for (let i = 0; i < FAILED_AUTH_MAX_ENTRIES / 4; i++) {
      const next = iter.next();
      if (next.done) break;
      failedAuthMap.delete(next.value);
    }
  }
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function sanitizeString(input: string): string {
  let result = input;
  result = result.replace(/\0/g, "");
  // deno-lint-ignore no-control-regex
  result = result.replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  result = result.replace(/\u200b|\u200c|\u200d|\ufeff/g, "");
  return result;
}

function detectPatterns(input: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(input));
}

export interface SecurityCheckResult {
  allowed: boolean;
  status?: number;
  error?: string;
  clientIp?: string;
  tenantId?: string;
}

export function validateRequestSize(req: Request): SecurityCheckResult {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (isNaN(size) || size < 0) {
      return { allowed: false, status: 400, error: "invalid request" };
    }
    if (size > MAX_BODY_SIZE_BYTES) {
      return { allowed: false, status: 413, error: "payload too large" };
    }
  }
  return { allowed: true };
}

export function validateUrl(req: Request): SecurityCheckResult {
  const url = new URL(req.url);
  if (url.pathname.length > MAX_URL_LENGTH) {
    return { allowed: false, status: 414, error: "uri too long" };
  }
  const paramCount = [...url.searchParams.keys()].length;
  if (paramCount > MAX_QUERY_PARAMS) {
    return { allowed: false, status: 400, error: "too many parameters" };
  }
  for (const [key, value] of url.searchParams) {
    if (key.length > MAX_HEADER_VALUE_LENGTH || value.length > MAX_QUERY_VALUE_LENGTH) {
      return { allowed: false, status: 400, error: "parameter too long" };
    }
    if (
      detectPatterns(key, SQL_INJECTION_PATTERNS) ||
      detectPatterns(value, SQL_INJECTION_PATTERNS)
    ) {
      logWarn("security.sql_injection_attempt", { path: url.pathname, param: key });
      return { allowed: false, status: 400, error: "invalid request" };
    }
    if (detectPatterns(key, XSS_PATTERNS) || detectPatterns(value, XSS_PATTERNS)) {
      logWarn("security.xss_attempt", { path: url.pathname, param: key });
      return { allowed: false, status: 400, error: "invalid request" };
    }
    if (detectPatterns(value, PATH_TRAVERSAL_PATTERNS)) {
      logWarn("security.path_traversal_attempt", { path: url.pathname, param: key });
      return { allowed: false, status: 400, error: "invalid request" };
    }
  }
  return { allowed: true };
}

export function validateHeaders(req: Request): SecurityCheckResult {
  const dangerousHeaders = [
    "x-forwarded-host",
    "x-host",
    "x-real-ip",
    "x-remote-ip",
    "x-remote-addr",
    "x-cluster-client-ip",
    "forwarded-for",
    "forwarded",
  ];
  for (const header of dangerousHeaders) {
    if (req.headers.has(header)) {
      const clientIp = getClientIp(req);
      logWarn("security.header_injection", { header, clientIp });
      req.headers.delete(header);
    }
  }
  const contentType = req.headers.get("content-type");
  if (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") {
    if (!contentType) {
      return { allowed: false, status: 400, error: "content-type required" };
    }
    const allowedTypes = [
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ];
    const isAllowed = allowedTypes.some((t) => contentType.toLowerCase().includes(t));
    if (!isAllowed) {
      return { allowed: false, status: 415, error: "unsupported content type" };
    }
  }
  for (const [_key, value] of req.headers) {
    if (value && value.length > MAX_HEADER_VALUE_LENGTH) {
      return { allowed: false, status: 400, error: "header too long" };
    }
  }
  return { allowed: true };
}

export function validatePath(path: string): SecurityCheckResult {
  const normalized = path.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
  if (detectPatterns(normalized, PATH_TRAVERSAL_PATTERNS)) {
    logWarn("security.path_traversal", { path: normalized });
    return { allowed: false, status: 400, error: "invalid path" };
  }
  if (detectPatterns(normalized, COMMAND_INJECTION_PATTERNS)) {
    logWarn("security.command_injection", { path: normalized });
    return { allowed: false, status: 400, error: "invalid path" };
  }
  return { allowed: true };
}

export function validateRequestBody(body: string): SecurityCheckResult {
  if (!body) return { allowed: true };
  const sanitized = sanitizeString(body);
  if (sanitized.length > MAX_BODY_SIZE_BYTES) {
    return { allowed: false, status: 413, error: "payload too large" };
  }
  if (detectPatterns(sanitized, SQL_INJECTION_PATTERNS)) {
    logWarn("security.sql_injection_body");
    return { allowed: false, status: 400, error: "invalid request body" };
  }
  if (detectPatterns(sanitized, XSS_PATTERNS)) {
    logWarn("security.xss_body");
    return { allowed: false, status: 400, error: "invalid request body" };
  }
  return { allowed: true };
}

export function checkIpRateLimit(clientIp: string): SecurityCheckResult {
  const now = Date.now();
  const entry = ipRateLimitMap.get(clientIp);
  if (!entry || now > entry.resetAt) {
    ipRateLimitMap.set(clientIp, {
      count: 1,
      resetAt: now + IP_RATE_LIMIT_WINDOW_MS,
      penaltyUntil: 0,
    });
    return { allowed: true };
  }
  if (entry.penaltyUntil > 0 && now < entry.penaltyUntil) {
    const retryAfter = Math.ceil((entry.penaltyUntil - now) / 1000);
    logWarn("security.ip_rate_limited", { clientIp, retryAfter });
    return { allowed: false, status: 429, error: "too many requests" };
  }
  entry.count++;
  if (entry.count > IP_RATE_LIMIT_MAX) {
    const penaltyMs =
      PROGRESSIVE_PENALTY_BASE_MS * Math.pow(2, Math.min(entry.count - IP_RATE_LIMIT_MAX, 10));
    entry.penaltyUntil = now + penaltyMs;
    logWarn("security.ip_rate_exceeded", { clientIp, count: entry.count, penaltyMs });
    return { allowed: false, status: 429, error: "too many requests" };
  }
  return { allowed: true };
}

export function validateNonce(nonce: string, tenantId: string): SecurityCheckResult {
  if (!nonce) {
    return { allowed: false, status: 400, error: "nonce required" };
  }
  if (nonce.length < 16 || nonce.length > 128) {
    return { allowed: false, status: 400, error: "invalid nonce" };
  }
  const cacheKey = `${tenantId}:${nonce}`;
  const now = Date.now();
  const existing = nonceCache.get(cacheKey);
  if (existing && now - existing < NONCE_EXPIRY_MS) {
    logWarn("security.nonce_replay", { tenantId, nonce: nonce.substring(0, 8) + "..." });
    return { allowed: false, status: 409, error: "nonce already used" };
  }
  nonceCache.set(cacheKey, now);
  for (const [key, ts] of nonceCache) {
    if (now - ts > NONCE_EXPIRY_MS) {
      nonceCache.delete(key);
    }
  }
  return { allowed: true };
}

export function validateTimestamp(timestamp: string | null): SecurityCheckResult {
  if (!timestamp) {
    return { allowed: false, status: 400, error: "timestamp required" };
  }
  const tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum)) {
    return { allowed: false, status: 400, error: "invalid timestamp" };
  }
  const skew = Math.abs(Date.now() - tsNum);
  if (skew > TIMESTAMP_SKEW_MS) {
    logWarn("security.timestamp_skew", { skew, maxAllowed: TIMESTAMP_SKEW_MS });
    return { allowed: false, status: 401, error: "request expired" };
  }
  return { allowed: true };
}

export function trackFailedAuth(tenantId: string): { locked: boolean; attempts: number } {
  const now = Date.now();
  const entry = failedAuthMap.get(tenantId);
  if (!entry || now - entry.lastFail > 900_000) {
    failedAuthMap.set(tenantId, { count: 1, lastFail: now });
    return { locked: false, attempts: 1 };
  }
  entry.count++;
  entry.lastFail = now;
  if (entry.count >= 15) {
    logError("security.auth_lockout", { tenantId, attempts: entry.count });
    return { locked: true, attempts: entry.count };
  }
  return { locked: false, attempts: entry.count };
}

export function clearFailedAuth(tenantId: string): void {
  failedAuthMap.delete(tenantId);
}

export function getSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  };
}

export function runSecurityChecks(req: Request): SecurityCheckResult {
  periodicSecurityCleanup();

  const sizeCheck = validateRequestSize(req);
  if (!sizeCheck.allowed) return sizeCheck;

  const headerCheck = validateHeaders(req);
  if (!headerCheck.allowed) return headerCheck;

  const urlCheck = validateUrl(req);
  if (!urlCheck.allowed) return urlCheck;

  const clientIp = getClientIp(req);
  const ipCheck = checkIpRateLimit(clientIp);
  if (!ipCheck.allowed) return ipCheck;

  return { allowed: true, clientIp };
}

export function generateRequestId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}
