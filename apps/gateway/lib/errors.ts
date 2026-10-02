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

const CORS_HEADERS: Record<string, string> = {
  // RFC-004 C1 — idempotency-key must survive preflight on route-level
  // responses too (mirrors index.ts getCorsHeaders).
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-db-url, x-db-token, x-tutor-id, x-tenant-id, x-signature, x-timestamp, x-encrypt-response, x-request-id, x-nonce, x-batch-name, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SECURITY_HEADERS = getSecurityHeaders();

function mergeHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...SECURITY_HEADERS,
    ...CORS_HEADERS,
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
