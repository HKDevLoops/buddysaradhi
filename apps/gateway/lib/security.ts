import { logWarn, logError } from "./log.ts";

/** Env read with the same shape as `readSecret` in lib/crypto.ts: Deno first,
 *  empty string when unavailable (the vitest shim delegates `Deno.env.get` to
 *  `process.env`, so tests override per-test). Read PER CALL, never at module
 *  scope: an operator change (or a test) must take effect without a reboot,
 *  and module-level reads cannot be overridden per test. */
function readEnv(name: string): string {
  if (typeof Deno === "undefined") return "";
  try {
    return Deno.env.get(name) || "";
  } catch {
    return "";
  }
}

/**
 * F-05b — operator-declared trusted proxies (`TRUSTED_PROXY_CIDRS`).
 *
 * The gateway cannot know its own deployment topology: on Cloudflare/Supabase
 * Edge `cf-connecting-ip` is authoritative and `x-forwarded-for` is stripped
 * unconditionally, but a self-hosted gateway behind nginx sees only the
 * proxy's address as its peer and the client's address (if at all) inside
 * `x-forwarded-for` — a header the client also writes. Trusting it blindly
 * lets any caller rotate identities past the per-IP limiter; ignoring it
 * always collapses every client behind the proxy into one `"unknown"` bucket.
 * Neither default is right for every deployment, so the operator declares
 * theirs: a comma-separated list of exact IPs and/or IPv4 CIDRs
 * (e.g. `TRUSTED_PROXY_CIDRS=127.0.0.1/32,10.0.0.0/8`). Empty (the default)
 * preserves exactly today's behavior — zero regression for anyone who does
 * not opt in. Non-empty arms strict mode (see `getClientIp`).
 */
function trustedProxies(): string[] {
  const raw = readEnv("TRUSTED_PROXY_CIDRS");
  if (!raw.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    if (entry.includes("/")) {
      const [base, bits] = entry.split("/");
      if (ipv4ToInt(base) === null || !/^\d{1,2}$/.test(bits) || Number(bits) > 32) {
        logWarn("security.trusted_proxy_invalid", { entry });
        continue;
      }
    }
    out.push(entry);
  }
  return out;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/** Exact match (covers IPv6 literals, which have no CIDR support here) or
 *  IPv4 CIDR containment. Invalid entries never match — fail closed. */
function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.indexOf("/");
  if (slash < 0) return cidr === ip;
  const base = ipv4ToInt(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  const addr = ipv4ToInt(ip);
  if (base === null || addr === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (base & mask) === (addr & mask);
}

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
  // F-33: `/CHAR\s*\(/i` removed — it rejected legitimate tutor notes containing
  // the substring "char (" (e.g. an activity note "Main char (Aarav) needs a
  // costume"). A bare function-name substring with no quote/terminator context
  // is not a reliable injection signal; the surviving UNION/OR/quote patterns
  // still catch genuine injection.
  // F-33: `/0x[0-9a-f]+/i` removed — it rejected legitimate hexadecimal text
  // such as a computing tutor's note "Revise 0xFF hex conversions" or a fee
  // reference code like "0x1A3F". Hex-looking tokens appear in ordinary notes;
  // the surviving patterns still catch genuine injection.
  /\bxp_cmdshell\b/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  // F-33: `/on\w+\s*=/i` removed — it rejected ordinary prose that names a day
  // or item before "=" (e.g. "Monday = holiday, class moved" matches via
  // "onday =", "Stationery = issued" via "onery ="). Event-handler XSS without
  // a "<" tag context is still caught by the surviving tag-specific patterns.
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<link[\s>]/i,
  /expression\s*\(/i,
  // F-33: `/url\s*\(/i` removed — it rejected legitimate notes containing
  // "url (" (e.g. "share the receipt url (drive link) with the parent") and a
  // computing tutor's CSS "background: url(...)". The surviving `javascript:`
  // and tag patterns still catch genuine XSS vectors.
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

/**
 * Resolve the client IP for rate limiting and audit.
 *
 * Precedence is deliberate and ordered by trust:
 * 1. `cf-connecting-ip` — written by the edge, unspoofable there. Unchanged.
 * 2. Strict mode (`TRUSTED_PROXY_CIDRS` non-empty) with a `peer` transport
 *    address: if the peer is a declared proxy, the client is the LAST
 *    `x-forwarded-for` entry — the one OUR proxy appended (anything left of
 *    it is caller-supplied noise). If the peer is NOT declared, the
 *    connection is direct and any `x-forwarded-for` is attacker noise, so
 *    the peer itself is the client.
 * 3. Legacy default (no peer, or strict mode off): exactly today's chain —
 *    first XFF entry, then `x-real-ip`, then `"unknown"`. Byte-for-byte the
 *    old behavior for every deployment that does not opt in.
 *
 * `peer` is the transport peer (`info.remoteAddr.hostname` from
 * `Deno.serve`), NOT a header — that is the whole point: headers are claims,
 * the peer is a fact. Callers that cannot observe the peer (unit tests, the
 * legacy path) omit it and get the legacy chain.
 */
export function getClientIp(req: Request, peer?: string, trusted?: string[]): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();
  const list = trusted ?? trustedProxies();
  if (peer !== undefined && list.length > 0) {
    if (list.some((c) => cidrContains(c, peer))) {
      const xff = req.headers.get("x-forwarded-for");
      if (xff) {
        const parts = xff
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (parts.length > 0) return parts[parts.length - 1];
      }
      return peer;
    }
    return peer;
  }
  return (
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

export function validateHeaders(req: Request, peer?: string): SecurityCheckResult {
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
  // `x-forwarded-for` is handled separately and conditionally below. It was
  // missing from `dangerousHeaders` entirely, which made this file inconsistent
  // with itself: eight spoofable IP headers were stripped before `getClientIp`
  // could read them, and the ninth — the one `getClientIp` reads SECOND — was
  // passed through untouched. On Cloudflare/Supabase Edge `cf-connecting-ip` is
  // written by the edge and cannot be spoofed, so the request never reached the
  // XFF branch; the hole only opened on a self-hosted deployment (`env.ts`
  // treats `DENO_ENV=production` without `DENO_DEPLOYMENT_ID` as deployed, and
  // self-hosting is a supported mode). There `getClientIp` takes
  // `x-forwarded-for.split(",")[0]`, and an attacker sending
  // `X-Forwarded-For: <random>` per request gets a fresh limiter bucket every
  // time — the per-IP 100/min ceiling became unreachable.
  //
  // Stripped when `cf-connecting-ip` is present, i.e. when the edge already
  // supplied a trustworthy address that takes precedence and the header is
  // pure client-supplied noise. F-05b closes the remaining case with an
  // operator knob instead of a guess: in strict mode (`TRUSTED_PROXY_CIDRS`
  // non-empty) with a known peer, an `x-forwarded-for` on a DIRECT connection
  // (peer not declared) is known attacker noise — strip it so nothing
  // downstream can misread it. On a declared-proxy connection the header is
  // KEPT, because `getClientIp` reads the proxy-appended (last) entry from
  // it. Default (strict mode off, or no peer observed): deliberately NOT
  // stripped — removing it would collapse every client of a proxy-only
  // deployment into a single `"unknown"` bucket, converting a fail-open
  // control into a fail-closed outage.
  const strictList = peer !== undefined ? trustedProxies() : [];
  const strictUntrusted =
    peer !== undefined && strictList.length > 0 && !strictList.some((c) => cidrContains(c, peer));
  if (
    req.headers.has("x-forwarded-for") &&
    (req.headers.has("cf-connecting-ip") || strictUntrusted)
  ) {
    logWarn("security.header_injection", {
      header: "x-forwarded-for",
      clientIp: getClientIp(req, peer),
    });
    req.headers.delete("x-forwarded-for");
  }
  for (const header of dangerousHeaders) {
    if (req.headers.has(header)) {
      const clientIp = getClientIp(req, peer);
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
  // No eviction sweep here. This used to iterate the WHOLE nonceCache — capped
  // at NONCE_CACHE_MAX_ENTRIES (10,000) — on every attendance mark and every
  // payment, making the hot mutation path O(cache size) for pure memory hygiene.
  //
  // `periodicSecurityCleanup` already does exactly this work, and does it in the
  // right place: it runs at the top of `runSecurityChecks` (every request),
  // evicts nonces older than NONCE_EXPIRY_MS, and enforces the max size. It is
  // interval-gated (CLEANUP_INTERVAL_MS) precisely so that per-request work
  // stays constant.
  //
  // Removing the sweep does NOT weaken the replay defence, and this is why: the
  // check above reads `nonceCache.get(cacheKey)` and compares the age against
  // NONCE_EXPIRY_MS itself. An entry the sweep had removed and an entry the
  // sweep left behind are indistinguishable to the replay test — an entry older
  // than NONCE_EXPIRY_MS is already outside the replay window and would be
  // accepted (and overwritten) either way. The cache is a replay WINDOW, not the
  // authority on what has been used; the window length is.
  nonceCache.set(cacheKey, now);
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

/**
 * F-13: whether an auth-stage failure feeds the consecutive-failure lockout.
 *
 * Only CREDENTIAL failures count (`UNAUTHENTICATED`, `AUTH_REQUIRED` — the
 * codes `authenticateRequest` throws when the caller's credential is missing
 * or wrong). A server-side misconfiguration (`INTERNAL`) or an already
 * throttled client (`RATE_LIMITED`) is not a guess, so neither may push a key
 * toward lockout — otherwise one bad deploy (or one throttled NAT) would
 * convert every subsequent request into a 429 masking the real cause.
 */
export function isCredentialFailure(code: string): boolean {
  return code === "UNAUTHENTICATED" || code === "AUTH_REQUIRED";
}

/**
 * F-13: the key is a PRE-IDENTITY stable identity — the caller passes the
 * per-IP client key `runSecurityChecks` resolved (the same identity
 * `checkIpRateLimit` uses), NOT a verified tenant. On the failure path no
 * tenant has been established yet (authentication threw), so keying by
 * anything derived from the credential would hand the attacker their own
 * bucket rotation. Consecutive failures accumulate per key; a success clears
 * the key (10_Security.md §3.5 cumulative-count-resets-on-success,
 * server-side analogue). Threshold: 15 consecutive failures.
 */
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
    // 10_Security.md §17 headers: JSON API serves no HTML, so the policy is
    // deny-by-default (`default-src 'none'`) plus `frame-ancestors 'none'`
    // (mirrors `X-Frame-Options: DENY`). No `unsafe-inline`/`unsafe-eval`.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
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

export function runSecurityChecks(req: Request, peer?: string): SecurityCheckResult {
  periodicSecurityCleanup();

  const sizeCheck = validateRequestSize(req);
  if (!sizeCheck.allowed) return sizeCheck;

  const headerCheck = validateHeaders(req, peer);
  if (!headerCheck.allowed) return headerCheck;

  const urlCheck = validateUrl(req);
  if (!urlCheck.allowed) return urlCheck;

  const clientIp = getClientIp(req, peer);
  const ipCheck = checkIpRateLimit(clientIp);
  if (!ipCheck.allowed) return ipCheck;

  return { allowed: true, clientIp };
}

export function generateRequestId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}
