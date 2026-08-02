import { getTurso, type DB } from "./lib/db.ts";
import { applySchema } from "./lib/schema.ts";
import { authenticateRequest, AuthError } from "./lib/auth.ts";
import { ok, json, securityFail } from "./lib/errors.ts";
import { logInfo, logError, logWarn } from "./lib/log.ts";
import { execLocal } from "./graphql/executor.ts";
import { getCachedResponse, setCacheResponse } from "./lib/cache.ts";
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

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin":
    Deno.env.get("ALLOWED_ORIGIN") || Deno.env.get("ALLOWED_ORIGINS") || "https://buddysaradhi.app",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-db-url, x-db-token, x-tutor-id, x-signature, x-timestamp, x-encrypt-response, x-request-id, x-nonce",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Credentials": "true",
};

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

function addSecurityHeaders(resp: Response, requestId: string): Response {
  const headers = new Headers(resp.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
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
        ...CORS,
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
  path = path.replace(/^\/functions\/v1\/gateway/, "");
  path = path.replace(/^\/gateway/, "");
  if (!path.startsWith("/")) path = "/" + path;
  const method = req.method;
  const logCtx: Record<string, unknown> = { path, method, requestId };

  try {
    if (path === "/health") {
      const dt = performance.now() - t0;
      const resp = ok({ ok: true });
      if (resp instanceof Response) {
        resp.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
        return addSecurityHeaders(resp, requestId);
      }
      return addSecurityHeaders(resp as Response, requestId);
    }

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /", {
        status: 200,
        headers: mergeHeaders({ "Content-Type": "text/plain" }),
      });
    }

    const pathCheck = validatePath(path);
    if (!pathCheck.allowed) {
      logWarn("security.invalid_path", { ...logCtx, path });
      return addSecurityHeaders(securityFail(pathCheck.status!, requestId), requestId);
    }

    const dbUrl =
      req.headers.get("x-db-url") ||
      req.headers.get("X-Db-Url") ||
      Deno.env.get("DATABASE_URL") ||
      "";
    const dbToken =
      req.headers.get("x-db-token") ||
      req.headers.get("X-Db-Token") ||
      Deno.env.get("TURSO_TOKEN") ||
      "";
    if (!dbUrl) return addSecurityHeaders(securityFail(400, requestId), requestId);

    const { tenantId } = await authenticateRequest(req);
    logCtx.tenantId = tenantId;

    const authCheck = trackFailedAuth(tenantId);
    if (authCheck.locked) {
      return addSecurityHeaders(securityFail(429, requestId), requestId);
    }
    clearFailedAuth(tenantId);

    if (MUTATION_METHODS.has(method)) {
      const nonce = req.headers.get("x-nonce") || req.headers.get("X-Nonce");
      const timestamp = req.headers.get("x-timestamp") || req.headers.get("X-Timestamp");
      const nonceCheck = validateNonce(nonce || "", tenantId);
      if (!nonceCheck.allowed) {
        logWarn("security.nonce_violation", { ...logCtx, tenantId });
        return addSecurityHeaders(securityFail(nonceCheck.status!, requestId), requestId);
      }
      const tsCheck = validateTimestamp(timestamp);
      if (!tsCheck.allowed) {
        logWarn("security.timestamp_violation", { ...logCtx, tenantId });
        return addSecurityHeaders(securityFail(tsCheck.status!, requestId), requestId);
      }
    }

    if (method === "GET" && path !== "/health") {
      const cKey = cacheKey(req, path, tenantId);
      if (cKey) {
        const cached = getCachedResponse(cKey);
        if (cached) {
          const dt = performance.now() - t0;
          cached.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
          cached.headers.set("X-Cache-Key", cKey);
          cached.headers.set("X-Request-Id", requestId);
          return addSecurityHeaders(cached, requestId);
        }
      }
    }

    const db: DB = getTurso(dbUrl, dbToken);
    await applySchema(db, `${dbUrl}::${dbToken}`);

    if (path === "/graphql" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const bodyStr = JSON.stringify(body);
      const bodyCheck = validateRequestBody(bodyStr);
      if (!bodyCheck.allowed) {
        logWarn("security.invalid_body", { ...logCtx, tenantId });
        return addSecurityHeaders(securityFail(bodyCheck.status!, requestId), requestId);
      }
      const result = await execLocal(body.query ?? "", body.variables ?? {}, { db, tenantId });
      const dt = performance.now() - t0;
      logInfo("gateway.request", { ...logCtx, status: 200, durationMs: dt });
      const resp = json(result);
      if (resp instanceof Response) resp.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
      return addSecurityHeaders(resp as Response, requestId);
    }

    if (MUTATION_METHODS.has(method)) {
      try {
        const clonedReq = req.clone();
        const bodyText = await clonedReq.text();
        if (bodyText) {
          const bodyCheck = validateRequestBody(bodyText);
          if (!bodyCheck.allowed) {
            logWarn("security.mutation_body_violation", { ...logCtx, tenantId, method });
            return addSecurityHeaders(securityFail(bodyCheck.status!, requestId), requestId);
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

        if (method === "GET" && res.status === 200) {
          const cKey = cacheKey(req, path, tenantId);
          if (cKey) {
            const body = await res.text();
            setCacheResponse(
              cKey,
              body,
              res.status,
              res.headers.get("Content-Type") || "application/json",
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
            return addSecurityHeaders(cachedResp, requestId);
          }
        }

        res.headers.set("X-Response-Time", `${dt.toFixed(2)}ms`);
        return addSecurityHeaders(res, requestId);
      }
    }

    const dt = performance.now() - t0;
    logInfo("gateway.request", { ...logCtx, status: 404, durationMs: dt });
    return addSecurityHeaders(securityFail(404, requestId), requestId);
  } catch (err) {
    const dt = performance.now() - t0;
    const status = err instanceof AuthError ? err.status : 500;
    logError("gateway.error", {
      ...logCtx,
      status,
      durationMs: dt,
      errorCode: err instanceof AuthError ? "auth_fail" : "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
    return addSecurityHeaders(securityFail(status, requestId), requestId);
  }
});

function mergeHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...SECURITY_HEADERS,
    ...CORS,
    ...extra,
  };
}
