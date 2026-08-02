import { encryptResponse } from "./crypto.ts";
import { getSecurityHeaders } from "./security.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://buddysaradhi.app",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-db-url, x-db-token, x-tutor-id, x-signature, x-timestamp, x-encrypt-response, x-request-id, x-nonce",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Credentials": "true",
};

const SECURITY_HEADERS = getSecurityHeaders();

function mergeHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...SECURITY_HEADERS,
    ...CORS,
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
  const sanitized = error
    .replace(/(?:x-db-url|x-db-token|authorization|supabase|turso|libsql):?[^\s,]*/gi, "[REDACTED]")
    .replace(/(?:password|secret|token|key|credential):?\s*[^\s,]*/gi, "[REDACTED]")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]")
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "[ID]");
  if (sanitized.length > 200) {
    return ERROR_MESSAGES[status] || "bad request";
  }
  return sanitized;
}

export function json(data: unknown, status = 200, encrypt = false): Response | Promise<Response> {
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

export function ok(data: unknown, status = 200, encrypt = false): Response | Promise<Response> {
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

export function securityFail(status: number, requestId?: string): Response {
  const message = ERROR_MESSAGES[status] || "bad request";
  return json({ success: false, error: message, ...(requestId ? { requestId } : {}) }, status) as Response;
}
