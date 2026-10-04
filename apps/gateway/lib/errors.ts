// Implements: 17_API_Gateway_System.md §8 (typed error contract) +
// RFC-003 G-ERR (AUTH_REQUIRED, DB_NOT_PROVISIONED, CREDENTIALS_EXPIRED,
// NEEDS_PROVISION, VALIDATION, CONFLICT, UPSTREAM mapped to UI states) +
// 10_Security.md §8 (no PII / secret echo in errors) + AGENTS.md Rule 9.
//
// Web-compat note (apps/web/src/lib/app-errors.ts `extractServerCode`,
// `[...slug]/route.ts:21`): the web parses a leading `CODE: rest` prefix, so
// every typed failure below emits `error: "CODE: human detail"` and
// `sanitizeError` preserves that prefix verbatim (a `credential|token|key`
// redaction must never eat the code itself).
import { encryptResponse } from "./crypto.ts";
import { getSecurityHeaders } from "./security.ts";
import type { ZodError } from "zod";

// ── CORS: the one allowlist, the one resolver ──────────────────────────────────
// 10_Security.md §8 (no origin is trusted implicitly) + AGENTS.md §2 Rule 10.
//
// Why this lives here and not only in index.ts: `Access-Control-Allow-Origin` is
// the one CORS header that DEPENDS ON THE REQUEST. Everything else
// (Allow-Headers/Methods/Max-Age) is request-independent, so it can live in the
// static `CORS_HEADERS` below. The origin cannot — which is precisely why the
// static constant does not carry it. An origin resolved in two places is an
// origin resolved inconsistently, and index.ts's copy was doing it wrongly.
//
// Three properties this resolver guarantees, each a real finding on 2026-10-04:
//
//  1. NO WILDCARD. `*` is never emitted. Combined with a bearer token in a
//     header it would let any site drive the API; combined with
//     `Access-Control-Allow-Credentials: true` the browser rejects the response
//     outright (an invalid pairing that fails *closed* but confusingly).
//  2. EXACT MATCH ONLY. The previous resolver used
//     `Deno.env.get("ALLOWED_ORIGIN").includes(origin)` — a SUBSTRING test. With
//     `ALLOWED_ORIGIN=https://buddysaradhi.app`, the origin
//     `https://buddysaradhi.app.evil.com` contains that string and was granted
//     credentialed CORS. `""` also matched, since `"x".includes("")` is true.
//  3. FAIL CLOSED. An origin that is absent or not allowlisted gets NO
//     `Access-Control-Allow-Origin` and NO `Access-Control-Allow-Credentials`,
//     rather than the previous hardcoded `https://buddysaradhi.app` fallback
//     (which asserted an allowlist membership that was never checked).
//     Server-to-server callers (the web app's server actions, curl, the mobile
//     SDK) send no `Origin` and need no CORS header at all, so failing closed
//     breaks nothing that legitimately exists.
const CORS_HEADERS: Record<string, string> = {
  // RFC-004 C1 — idempotency-key must survive preflight on route-level
  // responses too (mirrors index.ts getCorsHeaders).
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-db-url, x-db-token, x-tutor-id, x-tenant-id, x-signature, x-timestamp, x-encrypt-response, x-request-id, x-nonce, x-batch-name, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Origins that are the product itself. Allowed in every environment. */
const PRODUCTION_CORS_ORIGINS = [
  "https://buddysaradhi.app",
  "https://www.buddysaradhi.app",
  "https://buddysaradhi.vercel.app",
  "https://buddysaradhi.store",
  "https://buddysaradhi-product.vercel.app",
] as const;

/** Loopback only. Matches `apps/web/src/proxy.ts:22-29`, which allowlists
 *  `localhost:3000`/`3001` + `tauri://localhost` for the desktop shell. Admitted
 *  ONLY when not deployed, so a production gateway can never be driven from a
 *  developer's machine. `tauri://localhost` is kept: the Tauri webview sends
 *  this origin, and AGENTS.md §2 Rule 11 keeps desktop on the same contract. */
const DEVELOPMENT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "tauri://localhost",
] as const;

/** Deployment is a positive signal, never the absence of one. The previous
 *  check treated a missing `SUPABASE_URL` as "local" and skipped the secret
 *  validation entirely — the fail-open direction (lib/crypto.ts shares this). */
function isDeployed(): boolean {
  if (typeof Deno === "undefined") return false;
  return Boolean(Deno.env.get("DENO_DEPLOYMENT_ID")) ||
    Deno.env.get("DENO_ENV") === "production";
}

let originCache: { key: string; set: Set<string> } | null = null;

/** The resolved allowlist for this process. Env overrides are SPLIT on commas
 *  and whitespace and matched with `Set.has` — never with `String.includes`. */
export function allowedCorsOrigins(): ReadonlySet<string> {
  const read = (name: string): string =>
    typeof Deno === "undefined" ? "" : Deno.env.get(name) || "";
  // `??` is wrong here: an unset variable reads as `""` (never `undefined`), and
  // `"" ?? x` is `""`. The singular spelling must fall through to the plural.
  const env = read("ALLOWED_ORIGINS") || read("ALLOWED_ORIGIN");
  const key = `${isDeployed() ? "prod" : "dev"}|${env}`;
  if (originCache && originCache.key === key) return originCache.set;

  const set = new Set<string>(PRODUCTION_CORS_ORIGINS);
  if (!isDeployed()) for (const o of DEVELOPMENT_CORS_ORIGINS) set.add(o);
  if (env) {
    for (const raw of env.split(/[,\s]+/)) {
      const trimmed = raw.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  originCache = { key, set };
  return set;
}

/** Full CORS header set for a request's `Origin` header value (may be `null`).
 *
 *  Returns the request-independent `CORS_HEADERS` plus, ONLY for an allowlisted
 *  origin, the origin echo + `Vary: Origin` + `Access-Control-Allow-Credentials`.
 *  `Vary: Origin` is mandatory: without it a shared cache can hand one origin's
 *  credentialed response to another. */
export function corsHeadersForOrigin(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...CORS_HEADERS, Vary: "Origin" };
  if (!origin) return headers;
  if (!allowedCorsOrigins().has(origin)) return headers;
  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Credentials"] = "true";
  return headers;
}

/** Test seam: forget the memoised allowlist after a `Deno.env` change. */
export function resetCorsOriginCache(): void {
  originCache = null;
}

const SECURITY_HEADERS = getSecurityHeaders();

function mergeHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...SECURITY_HEADERS,
    ...CORS_HEADERS,
    // `Access-Control-Allow-Origin` is deliberately NOT set here: it is
    // request-dependent (see `corsHeadersForOrigin`). index.ts's
    // `addSecurityHeaders` is the single writer of it, on every response it
    // returns. A module that answered responses without a request in hand
    // cannot resolve an origin, and guessing one is the wildcard bug this
    // comment replaced.
    Vary: "Origin",
    ...extra,
  };
}

const ERROR_MESSAGES: Record<number, string> = {
  400: "bad request",
  401: "unauthorized",
  403: "forbidden",
  404: "not found",
  405: "method not allowed",
  408: "request timeout",
  409: "conflict",
  413: "payload too large",
  414: "uri too long",
  415: "unsupported media type",
  422: "unprocessable entity",
  429: "too many requests",
  500: "internal server error",
  502: "bad gateway",
  503: "service unavailable",
};

function sanitizeError(error: string, status: number): string {
  if (status >= 500) {
    return ERROR_MESSAGES[status] || "internal server error";
  }
  // RFC-003 G-ERR: the leading `CODE: ` prefix is the web UI's dispatch key
  // (apps/web/src/lib/app-errors.ts). Redact only the human detail — a
  // `credential|token|key` pattern must never eat the code itself (e.g. the
  // `credential` alternative matches inside `CREDENTIALS_EXPIRED:`).
  const prefixMatch = error.match(/^([A-Z][A-Z0-9_]{2,}:\s*)/);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  const detail = prefix ? error.slice(prefix.length) : error;
  const sanitizedDetail = detail
    .replace(
      /(?:x-db-url|x-db-token|authorization|supabase|turso|libsql):?[^\s,]*/gi,
      "[REDACTED]",
    )
    // Bearer tokens ride AFTER a space (`Authorization: Bearer <token>`), so
    // the `key:`-anchored pattern below cannot see them — strip the credential
    // while keeping the scheme word (10_Security.md §8, anti-tamper parity).
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/g, "Bearer [REDACTED]")
    .replace(
      /(?:password|secret|token|key|credential):?\s*[^\s,]*/gi,
      "[REDACTED]",
    )
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]")
    .replace(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
      "[ID]",
    );
  if ((prefix + sanitizedDetail).length > 200) {
    return ERROR_MESSAGES[status] || "bad request";
  }
  return prefix + sanitizedDetail;
}

// RFC-003 G-AUTH: a Turso/libSQL rejection of the tenant DB credential must
// surface as typed 401 CREDENTIALS_EXPIRED (naming re-provision), never 500.
// Matches transport HTTP 401/403 and libSQL auth-failure message shapes;
// everything else falls through to the generic 500 path (Rule 9).
export function isTursoAuthFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/Turso pipeline HTTP 40[13]\b/.test(message)) return true;
  return /invalid (auth token|token|api key)|unauthorized|token (expired|rejected|invalid)|authentication (failed|required)|jwt expired/i.test(
    message,
  );
}

export function json(
  data: unknown,
  status = 200,
  encrypt = false,
): Response | Promise<Response> {
  const body = JSON.stringify(data);
  if (encrypt) {
    return encryptResponse(body).then((enc) =>
      new Response(JSON.stringify({ encrypted: true, data: enc }), {
        status,
        headers: mergeHeaders({ "Content-Type": "application/json" }),
      })
    );
  }
  return new Response(body, {
    status,
    headers: mergeHeaders({ "Content-Type": "application/json" }),
  });
}

export function ok(
  data: unknown,
  status = 200,
  encrypt = false,
): Response | Promise<Response> {
  return json({ success: true, data }, status, encrypt);
}

export function okCached(body: string, cacheControl: string): Response {
  return new Response(body, {
    status: 200,
    headers: mergeHeaders({
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
    }),
  });
}

export function fail(error: string, status = 400): Response {
  const sanitized = sanitizeError(error, status);
  return json({ success: false, error: sanitized }, status) as Response;
}

// AGENTS.md §6.1 — Zod for all input validation; a failed parse returns the
// typed 400 VALIDATION code (RFC-003 G-ERR) with the field detail in `details`
// instead of letting the handler proceed with garbage input (Rule 9 — no
// silent failures). `details` is additive: readers of `error` keep working.
export function failZod(error: ZodError): Response {
  const issue = error.issues[0];
  const path = issue && issue.path.length > 0 ? issue.path.join(".") : "body";
  const details = issue ? `${path}: ${issue.message}` : "invalid request body";
  const body = JSON.stringify({ success: false, error: "VALIDATION", details });
  return new Response(body, {
    status: 400,
    headers: mergeHeaders({ "Content-Type": "application/json" }),
  });
}

// RFC-004 C1/C4 — non-Zod contract rejections (missing/invalid
// Idempotency-Key, malformed base_updated_at) use the exact failZod shape:
// `error` is the bare dispatch code the web switches on (RFC-003 G-ERR) and
// the human detail rides in `details`. Never echoes the offending value
// (10_Security.md §8 — the key itself is secret-adjacent).
export function failValidation(details: string): Response {
  const body = JSON.stringify({ success: false, error: "VALIDATION", details });
  return new Response(body, {
    status: 400,
    headers: mergeHeaders({ "Content-Type": "application/json" }),
  });
}

export function securityFail(status: number, requestId?: string): Response {
  const message = ERROR_MESSAGES[status] || "bad request";
  return json({
    success: false,
    error: message,
    ...(requestId ? { requestId } : {}),
  }, status) as Response;
}
