import { getTurso, type DB } from "./lib/db.ts";
import { ensureSelfRepairingSchema } from "./lib/schema.ts";
import { authenticateRequest, AuthError } from "./lib/auth.ts";
import { ok, json, fail, securityFail, isTursoAuthFailure, corsHeadersForOrigin } from "./lib/errors.ts";
import { logInfo, logError, logWarn } from "./lib/log.ts";
import {
  enforceIdempotencyPrecondition,
  idempotencyRoute,
} from "./lib/idempotency.ts";
import { execLocal } from "./graphql/executor.ts";
import {
  getCachedResponse,
  setCacheResponse,
  isCacheablePath,
  REFERENCE_TTL_MS,
} from "./lib/cache.ts";
import {
  runSecurityChecks,
  validatePath,
  validateRequestBody,
  validateNonce,
  validateTimestamp,
  getSecurityHeaders,
  generateRequestId,
  trackFailedAuth,
  clearFailedAuth,
} from "./lib/security.ts";

import { handleStudents } from "./routes/students.ts";
import { handleAttendance } from "./routes/attendance.ts";
import { handleLedger } from "./routes/ledger.ts";
import { handleSettings } from "./routes/settings.ts";
import { handleAnalytics } from "./routes/analytics.ts";
import { handleNotifications } from "./routes/notifications.ts";
import { handleSync } from "./routes/sync.ts";
import { handleSecurity } from "./routes/security.ts";
import { handleMarketingPublic } from "./routes/marketing.ts";

// CORS — the allowlist and the resolver live in lib/errors.ts, which is the ONE
// place an origin is decided (2026-10-04: this file had its own copy that
// substring-matched `ALLOWED_ORIGIN` and fell back to a hardcoded origin for
// unknown callers). `corsHeadersForOrigin` emits NO `Access-Control-Allow-Origin`
// and NO `Access-Control-Allow-Credentials` for an origin that is not allowlisted
// — fail closed. The web app is unaffected: it calls the gateway server-side (no
// `Origin` header at all, which needs no CORS header), and its browser-facing
// surface is same-origin.
function getCorsHeaders(req: Request): Record<string, string> {
  return corsHeadersForOrigin(req.headers.get("Origin"));
}

const SECURITY_HEADERS = getSecurityHeaders();

const ROUTE_HANDLERS = [
  handleStudents,
  handleAttendance,
  handleLedger,
  handleSettings,
  handleAnalytics,
  handleNotifications,
  handleSync,
  handleSecurity,
];

const MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function cacheKey(req: Request, path: string, tenantId: string): string | null {
  if (req.method !== "GET") return null;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  return `gw:${tenantId}:${path}:${qs}`;
}

function addSecurityHeaders(req: Request, resp: Response, requestId: string): Response {
  const headers = new Headers(resp.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(getCorsHeaders(req))) {
    headers.set(key, value);
  }
  headers.set("X-Request-Id", requestId);
  headers.delete("Server");
  headers.delete("X-Powered-By");
  headers.delete("X-AspNet-Version");
  headers.delete("X-AspNetMvc-Version");
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

Deno.serve(async (req: Request) => {
  const requestId = generateRequestId();

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...getCorsHeaders(req),
        ...SECURITY_HEADERS,
        "X-Request-Id": requestId,
      },
    });
  }

  const secCheck = runSecurityChecks(req);
  if (!secCheck.allowed) {
    logWarn("security.blocked", {
      requestId,
      status: secCheck.status,
      error: secCheck.error,
      clientIp: secCheck.clientIp,
    });
    return securityFail(secCheck.status!, requestId);
  }

  const t0 = performance.now();
  const url = new URL(req.url);
  let path = url.pathname;
  path = path.replace(/^\/functions\/v1\/gateway-graphql/, "/graphql");
  path = path.replace(/^\/functions\/v1\/gateway/, "");
  path = path.replace(/^\/gateway-graphql/, "/graphql");
  path = path.replace(/^\/gateway/, "");
  if (!path.startsWith("/")) path = "/" + path;
  const method = req.method;
  const logCtx: Record<string, unknown> = { path, method, requestId };

  try {
    if (path === "/health") {
      const dt = performance.now() - t0;
      const resp = await ok({ ok: true });
      resp.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
      return addSecurityHeaders(req, resp, requestId);
    }

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /", {
        status: 200,
        headers: mergeHeaders(req, { "Content-Type": "text/plain" }),
      });
    }

    // Public marketing facts: no auth, no DB (20_3D §1.1.3, R-17).
    // Branches before validatePath/db/auth like /health.
    if (path === "/api/v1/marketing/stats") {
      const marketing = handleMarketingPublic(path, method, logCtx);
      if (marketing) {
        const dt = performance.now() - t0;
        marketing.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
        return addSecurityHeaders(req, marketing, requestId);
      }
    }

    const pathCheck = validatePath(path);
    if (!pathCheck.allowed) {
      logWarn("security.invalid_path", { ...logCtx, path });
      return addSecurityHeaders(req, securityFail(pathCheck.status!, requestId), requestId);
    }

    const dbUrl =
      req.headers.get("x-db-url") ||
      req.headers.get("X-Db-Url") ||
      Deno.env.get("TURSO_DATABASE_URL") ||
      "";
    const dbToken =
      req.headers.get("x-db-token") ||
      req.headers.get("X-Db-Token") ||
      Deno.env.get("TURSO_AUTH_TOKEN") ||
      Deno.env.get("TURSO_TOKEN") ||
      "";
    if (!dbUrl || !dbToken) return addSecurityHeaders(req, fail("DB_NOT_PROVISIONED: tenant database not provisioned", 401), requestId);

    const { tenantId } = await authenticateRequest(req);
    logCtx.tenantId = tenantId;

    const authCheck = trackFailedAuth(tenantId);
    if (authCheck.locked) {
      return addSecurityHeaders(req, securityFail(429, requestId), requestId);
    }
    clearFailedAuth(tenantId);

    if (MUTATION_METHODS.has(method)) {
      const nonce = req.headers.get("x-nonce") || req.headers.get("X-Nonce");
      const timestamp = req.headers.get("x-timestamp") || req.headers.get("X-Timestamp");
      const nonceCheck = validateNonce(nonce || "", tenantId);
      if (!nonceCheck.allowed) {
        logWarn("security.nonce_violation", { ...logCtx, tenantId });
        return addSecurityHeaders(req, securityFail(nonceCheck.status!, requestId), requestId);
      }
      const tsCheck = validateTimestamp(timestamp);
      if (!tsCheck.allowed) {
        logWarn("security.timestamp_violation", { ...logCtx, tenantId });
        return addSecurityHeaders(req, securityFail(tsCheck.status!, requestId), requestId);
      }
    }

    // RFC-003 G-DB: edge-cache is reference-rows-only (lib/cache.ts
    // `isCacheablePath`). Money views (ledger / invoices / analytics) always
    // read through — a stale balance on Supabase Free would still cost a tutor
    // real money, while a cached settings row only saves invocations.
    if (method === "GET" && path !== "/health" && isCacheablePath(path)) {
      const cKey = cacheKey(req, path, tenantId);
      if (cKey) {
        const cached = getCachedResponse(cKey);
        if (cached) {
          const dt = performance.now() - t0;
          cached.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
          cached.headers.set("X-Cache-Key", cKey);
          cached.headers.set("X-Request-Id", requestId);
          return addSecurityHeaders(req, cached, requestId);
        }
      }
    }

    const db: DB = getTurso(dbUrl, dbToken);
    await ensureSelfRepairingSchema(db, tenantId, dbUrl, dbToken);

    // RFC-004 C1 (17_API_Gateway_System.md §3 stage 4→5 — contract validation
    // before SERVICE dispatch): every mutating REST route requires an
    // Idempotency-Key (fail-closed 400) and replays stored bytes on duplicate.
    // Runs AFTER the schema heal so `idempotency_keys` exists. Reads never
    // need keys. POST /graphql is exempt: the executor serves read-only
    // queries (no mutation operations exist in graphql/) — it cannot mint an
    // effect worth deduplicating.
    if (MUTATION_METHODS.has(method) && path !== "/graphql") {
      const idemPre = await enforceIdempotencyPrecondition(
        req,
        db,
        tenantId,
        idempotencyRoute(method, path),
      );
      if (idemPre) {
        const dt = performance.now() - t0;
        logInfo("gateway.request", {
          ...logCtx,
          status: idemPre.status,
          durationMs: dt,
          idempotent: true,
        });
        idemPre.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
        return addSecurityHeaders(req, idemPre, requestId);
      }
    }

    if (path === "/graphql" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const bodyStr = JSON.stringify(body);
      const bodyCheck = validateRequestBody(bodyStr);
      if (!bodyCheck.allowed) {
        logWarn("security.invalid_body", { ...logCtx, tenantId });
        return addSecurityHeaders(req, securityFail(bodyCheck.status!, requestId), requestId);
      }
      const result = await execLocal(body.query ?? "", body.variables ?? {}, { db, tenantId });
      const dt = performance.now() - t0;
      logInfo("gateway.request", { ...logCtx, status: 200, durationMs: dt });
      const resp = json(result);
      if (resp instanceof Response) resp.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
      return addSecurityHeaders(req, resp as Response, requestId);
    }

    if (MUTATION_METHODS.has(method)) {
      try {
        const clonedReq = req.clone();
        const bodyText = await clonedReq.text();
        if (bodyText) {
          const bodyCheck = validateRequestBody(bodyText);
          if (!bodyCheck.allowed) {
            logWarn("security.mutation_body_violation", { ...logCtx, tenantId, method });
            return addSecurityHeaders(req, securityFail(bodyCheck.status!, requestId), requestId);
          }
        }
      } catch {
        // Body already consumed or not readable — skip body validation for this edge case
      }
    }

    for (const handler of ROUTE_HANDLERS) {
      const res = await handler(req, db, tenantId, path, method, url, logCtx);
      if (res) {
        const dt = performance.now() - t0;
        logInfo("gateway.request", { ...logCtx, status: res.status, durationMs: dt });

        if (method === "GET" && res.status === 200 && isCacheablePath(path)) {
          const cKey = cacheKey(req, path, tenantId);
          if (cKey) {
            const body = await res.text();
            setCacheResponse(
              cKey,
              body,
              res.status,
              res.headers.get("Content-Type") || "application/json",
              REFERENCE_TTL_MS,
            );
            const cachedResp = new Response(body, {
              status: res.status,
              headers: {
                ...Object.fromEntries(res.headers),
                "X-Response-Time": `${dt.toFixed(2)}ms`,
                "X-Cache": "MISS",
                "X-Request-Id": requestId,
              },
            });
            return addSecurityHeaders(req, cachedResp, requestId);
          }
        }

        res.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
        return addSecurityHeaders(req, res, requestId);
      }
    }

    const dt = performance.now() - t0;
    logInfo("gateway.request", { ...logCtx, status: 404, durationMs: dt });
    return addSecurityHeaders(req, securityFail(404, requestId), requestId);
  } catch (err) {
    const dt = performance.now() - t0;
    // F-1 audit: typed `{ success: false, error: CODE }` with the matching
    // status — never a 500 for a credential problem (RFC-003 G-AUTH).
    if (err instanceof AuthError) {
      logError("gateway.error", {
        ...logCtx,
        status: err.status,
        durationMs: dt,
        errorCode: err.code,
        message: err instanceof Error ? err.message : String(err),
      });
      return addSecurityHeaders(req, fail(err.message, err.status), requestId);
    }
    // Expired/invalid tenant DB token (Turso rejects the credential):
    // CREDENTIALS_EXPIRED names re-provision instead of masking as 500
    // (RFC-003 trigger incident — the "Could not load student" chain).
    if (isTursoAuthFailure(err)) {
      logWarn("gateway.credentials_expired", { ...logCtx, durationMs: dt });
      return addSecurityHeaders(
        req,
        fail(
          "CREDENTIALS_EXPIRED: tenant database credential rejected; re-provision required",
          401,
        ),
        requestId,
      );
    }
    const status = 500;
    logError("gateway.error", {
      ...logCtx,
      status,
      durationMs: dt,
      errorCode: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
    // Rule 9: never leak internal error details (stacks, SQL, DSNs) to the
    // client. Server-side log above already has the full message; the client
    // gets the generic typed 500 (10_Security.md §8).
    const body = JSON.stringify({ success: false, error: "INTERNAL: internal server error", requestId });
    return addSecurityHeaders(
      req,
      new Response(body, { status, headers: { "Content-Type": "application/json" } }),
      requestId,
    );
  }
});

function mergeHeaders(req: Request, extra?: Record<string, string>): Record<string, string> {
  return {
    ...SECURITY_HEADERS,
    ...getCorsHeaders(req),
    ...extra,
  };
}
