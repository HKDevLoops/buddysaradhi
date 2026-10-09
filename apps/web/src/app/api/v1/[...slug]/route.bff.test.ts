// Implements: AGENTS.md §2 Rule 9 (no silent failures, no raw upstream text to the
// caller), Rule 2 (fail-closed on anything outbound); 10_Security.md §8 (audit of
// auth/credential events — a driver string is a credential event); the RFC-003 G-ERR
// taxonomy (lib/app-errors.ts must keep dispatching on every code this BFF forwards).
//
// THE DEFECT. `unwrap()` used to echo `r.error` verbatim into the response body, and
// `r.error` is built in server/get-db.ts as `Gateway ${res.status}: ${await res.text()}`
// — the raw upstream body. Nothing leaked only because the gateway sanitises its own
// 5xx today; the BFF had no allowlist of forwardable codes, so any future gateway
// detail would have shipped to the browser unreviewed.
//
// WHAT IS ASSERTED HERE, in order of how much it is worth:
//   1. no raw driver/gateway string reaches the client (SQL, a Turso host, a token,
//      an IP, a stack frame);
//   2. every code the client dispatches on survives the hop — asserted through
//      `toAppErrorState`, the real mapper, so a rewritten sentence that quietly
//      re-points a screen's error state fails here;
//   3. the published status + `needs_provision` contract did not move while the
//      message was rewritten;
//   4. the raw text is still recorded server-side (Rule 9 is "no silent failures",
//      not "no log").

import { describe, it, expect, vi, beforeEach } from "vitest";

const { gatewayGet, gatewayPost, gatewayPatch, gatewayDelete, logError, logInfo } = vi.hoisted(() => ({
  gatewayGet: vi.fn(),
  gatewayPost: vi.fn(),
  gatewayPatch: vi.fn(),
  gatewayDelete: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/server/get-db", () => ({ gatewayGet, gatewayPost, gatewayPatch, gatewayDelete }));

vi.mock("@/lib/logger", () => ({
  log: {
    error: logError,
    warn: vi.fn(),
    info: logInfo,
    debug: vi.fn(),
    audit: vi.fn(),
  },
  auditAction: vi.fn(),
}));

import { NextRequest } from "next/server";
import { toAppErrorState } from "@/lib/app-errors";
import { GET, POST, OPTIONS } from "./route";

type Envelope = { success: boolean; error: string; needs_provision?: boolean };

function ctx(...slug: string[]) {
  return { params: Promise.resolve({ slug }) };
}

/** Next's `RequestInit`, not the DOM one — they are structurally incompatible
 *  (DOM allows `signal: AbortSignal | null`, Next's does not). */
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function req(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1${path}`, init);
}

async function call(
  method: "GET" | "POST",
  path: string,
  gatewayError: string
): Promise<{ status: number; body: Envelope }> {
  const failure = { success: false as const, error: gatewayError };
  if (method === "GET") gatewayGet.mockResolvedValueOnce(failure);
  else gatewayPost.mockResolvedValueOnce(failure);
  const res =
    method === "GET"
      ? await GET(req(path), ctx(...path.split("/").filter(Boolean)))
      : await POST(req(path, { method: "POST", body: "{}" }), ctx(...path.split("/").filter(Boolean)));
  return { status: res.status, body: (await res.json()) as Envelope };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BFF error sanitisation — route.ts unwrap()", () => {
  // What the upstream can actually say. Each row is a real shape from the codebase:
  // get-db.ts throws the bare typed codes (:84/:200/:227) and wraps every non-2xx
  // gateway response as `Gateway NNN: <body>` (:471/:503/:535/:566); the gateway
  // emits bare-code JSON for Zod refusals (`failZod`) and `CODE: detail`
  // for its AuthError (lib/auth.ts).
  const RAW_CASES = [
    {
      name: "get-db typed auth failure",
      raw: "AUTH_REQUIRED: No session — mock tokens not permitted in production.",
      status: 401,
      code: "AUTH_REQUIRED",
    },
    {
name: "gateway-relayed UNAUTHENTICATED",
    raw: 'Gateway 401: {"success":false,"error":"UNAUTHENTICATED: signature verification failed"}',
    status: 401,
    // Was `UNKNOWN`. UNAUTHENTICATED was absent from APP_ERROR_CODES, so a 401
    // classified to UNKNOWN and told a tutor with an expired session to CONTACT
    // SUPPORT instead of logging in again (web/04 §9). GW-TAXONOMY-08 added the
    // code with AUTH_REQUIRED's affordance.
    code: "UNAUTHENTICATED",
    },
    {
name: "gateway signature/anti-tamper refusal",
    raw: "Gateway 401: SECURITY_VIOLATION: signature mismatch",
    status: 401,
    // Same class as UNAUTHENTICATED: a 401 the taxonomy could not name. SECURITY_VIOLATION
    // is the gateway's anti-tamper refusal and is not in APP_ERROR_CODES either.
    code: "UNKNOWN",
    },
    {
      name: "direct DB_NOT_PROVISIONED throw",
      raw: "DB_NOT_PROVISIONED: User database is not yet provisioned.",
      status: 503,
      code: "DB_NOT_PROVISIONED",
      needsProvision: true,
    },
    {
      name: "gateway-relayed DB_NOT_PROVISIONED (wrapped)",
      raw: 'Gateway 503: {"success":false,"error":"DB_NOT_PROVISIONED"}',
      status: 503,
      code: "DB_NOT_PROVISIONED",
      needsProvision: true,
    },
    {
      name: "gateway-relayed NEEDS_PROVISION",
      raw: 'Gateway 503: {"success":false,"error":"NEEDS_PROVISION"}',
      status: 503,
      code: "NEEDS_PROVISION",
      needsProvision: true,
    },
    {
      name: "gateway-relayed expired credentials (wrapped)",
      raw: 'Gateway 401: {"success":false,"error":"CREDENTIALS_EXPIRED: Turso pipeline HTTP 401"}',
      status: 401,
      code: "CREDENTIALS_EXPIRED",
    },
    {
      name: "gateway Zod 400 with field details in JSON",
      raw: 'Gateway 400: {"success":false,"error":"VALIDATION","details":[{"path":"name","message":"Required"}]}',
      status: 400,
      code: "VALIDATION",
    },
    {
      name: "gateway locked-session conflict",
      raw: "Gateway 409: CONFLICT: session is locked; unlock it to edit",
      status: 409,
      code: "CONFLICT",
    },
    {
      name: "gateway NOT_FOUND code",
      raw: 'Gateway 404: {"success":false,"error":"NOT_FOUND"}',
      status: 404,
      code: "NOT_FOUND",
    },
    {
      name: "gateway NOT_FOUND sentence",
      raw: "Gateway 404: Not found",
      status: 404,
      code: "NOT_FOUND",
    },
    {
      name: "single-row miss (own literal)",
      raw: "Student not found",
      status: 404,
      code: "NOT_FOUND",
    },
    {
      name: "credential preflight refusal",
      raw: "UPSTREAM: Credential probe timed out or the database is unreachable.",
      status: 500,
      code: "UPSTREAM",
    },
    {
      name: "transport failure",
      raw: "fetch failed",
      status: 502,
      code: "UPSTREAM",
    },
    {
      name: "free tier refusal",
      raw: "Free tier limit reached.",
      status: 403,
      code: "UNKNOWN",
    },
  ] as const;

  it.each(RAW_CASES)(
    "$name → status $status and the client still dispatches $code",
    async ({ raw, status, code }) => {
      const out = await call("GET", "/attendance", raw);
      expect(out.status).toBe(status);
      expect(out.body.success).toBe(false);
      expect(toAppErrorState(out.body.error).code).toBe(code);
    },
  );

  it("keeps needs_provision only on the provisioning refusals", async () => {
    const provisioned = await call("GET", "/attendance", "Gateway 401: AUTH_REQUIRED: nope");
    expect(provisioned.body.needs_provision).toBeUndefined();

    const unprovisioned = await call("GET", "/attendance", "DB_NOT_PROVISIONED: nope");
    expect(unprovisioned.status).toBe(503);
    expect(unprovisioned.body.needs_provision).toBe(true);
  });

  // The one that matters most. Every marker here is something this repo's own code
  // puts inside an error string: a libSQL/Turso driver error, an unredacted gateway
  // body, a Next.js digest, or a credentialed hostname.
  const LEAKY_RAW = [
    "Gateway 500: SQLITE_ERROR: no such table: students (SQLITE_CANTOPEN)",
    "Gateway 500: libsql://buddysaradhi-acme-xyz.aws-ap-south-1.turso.io rejected the token",
    "Gateway 400: {\"db_token\":\"eyJhbGciOiJIUzI1NiJ9.payload.sig\",\"x-db-url\":\"libsql://x\"}",
    "Gateway 403: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def",
    "Gateway 500: select * from students where tenant_id = 'uuid' — no such column",
    "Gateway 500: at Object.postEntry (/srv/src/server/get-db.ts:471:15)",
    "Gateway 500: connection refused to 10.4.2.9:5432",
    "Turso pipeline HTTP 401: invalid auth token eyJraWQiOiJr",
    "SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: students.dup_key",
    "PROPFIND /api/v1/students 500: EACCES: permission denied, open '/data/tenant.db'",
  ];

  it.each(LEAKY_RAW)("never forwards the raw upstream text (%#)", async (raw) => {
    const out = await call("GET", "/attendance", raw);
    const wire = JSON.stringify(out.body);

    // 1. the raw text itself
    expect(wire).not.toContain(raw);
    // 2. the distinctive fragments of it
    for (const marker of [
      "SQLITE",
      "libsql",
      "turso",
      "turso.io",
      "SELECT",
      "select *",
      "UNIQUE constraint",
      "Bearer",
      "eyJ",
      "10.4.2.9",
      "get-db.ts",
      "EACCES",
      "/data/tenant.db",
      "token",
    ]) {
      expect(wire.toLowerCase()).not.toContain(marker.toLowerCase());
    }
    // 3. and it still says something a client can dispatch on
    expect(out.body.error.length).toBeGreaterThan(0);
    expect(out.status).toBeGreaterThanOrEqual(400);
  });

  it("records the raw text server-side (Rule 9 is 'no silent failures', not 'no log')", async () => {
    const raw = "Gateway 500: SQLITE_ERROR: no such table: students";
    const out = await call("GET", "/attendance", raw);

    // 5xx → the audit-grade channel; routine 4xx refusals stay on `info` so a
    // driver's SQL never lands in the tenant's audit_log table.
    expect(logError).toHaveBeenCalledWith("gateway_refusal_collapsed", raw, { status: 500 });
    expect(logInfo).not.toHaveBeenCalled();

    logError.mockClear();
    await call("GET", "/attendance", "Gateway 401: AUTH_REQUIRED: nope");
    expect(logInfo).toHaveBeenCalledWith("gateway_refusal_collapsed", "Gateway 401: AUTH_REQUIRED: nope", {
      status: 401,
    });
    expect(logError).not.toHaveBeenCalled();

    // The client saw only the canned string in both cases.
    expect(out.body.error).toBe("internal server error");
  });

  it("never leaks the upstream body on a POST route either", async () => {
    const out = await call("POST", "/ledger/void", "Gateway 409: SQLITE_CONSTRAINT: FOREIGN KEY constraint failed");
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("conflict");
    expect(JSON.stringify(out.body)).not.toContain("FOREIGN KEY");
  });

  it("unrecognised gateway bodies collapse to the gateway's own canned sentence", async () => {
    for (const [raw, status, expected] of [
      ["Gateway 400: {\"success\":false,\"error\":\"whatever the gateway felt like\"}", 400, "bad request"],
      ["Gateway 409: {\"success\":false,\"error\":\"brand new refusal\"}", 409, "conflict"],
      ["Gateway 429: slow down", 429, "too many requests"],
      ["Gateway 500: opaque upstream fault", 500, "internal server error"],
      ["Gateway 502: opaque upstream fault", 502, "bad gateway"],
      ["Gateway 503: opaque upstream fault", 503, "service unavailable"],
      ["CRITICAL: GATEWAY_SHARED_SECRET must be set in production", 500, "internal server error"],
      ["Web Crypto API (crypto.subtle) is not available.", 500, "internal server error"],
    ] as const) {
      const out = await call("GET", "/attendance", raw);
      expect(out.status, raw).toBe(status);
      expect(out.body.error, raw).toBe(expected);
    }
  });
});

describe("CORS on the route OPTIONS handler — route.ts", () => {
  function options(origin: string | null) {
    return OPTIONS(req("/students", { method: "OPTIONS", headers: origin ? { origin } : {} }));
  }

  it("emits no origin and no credentials for an unlisted origin", async () => {
    const res = await options("https://evil.example");
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    // Mandatory, and the reason a fail-closed resolver is safe behind a cache.
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("emits no origin for a missing Origin header", async () => {
    const res = await options(null);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("echoes a listed origin with credentials", async () => {
    const res = await options("https://buddysaradhi.app");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://buddysaradhi.app");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("does not accept a look-alike origin", async () => {
    for (const origin of [
      "https://buddysaradhi.app.evil.example",
      "https://evil.example/https://buddysaradhi.app",
      "http://buddysaradhi.app",
      "https://BUDDYSARADHI.APP",
      "null",
    ]) {
      const res = await options(origin);
      expect(res.headers.get("Access-Control-Allow-Origin"), origin).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Credentials"), origin).toBeNull();
    }
  });

  it("does not put gateway credential headers in the preflight allowlist", async () => {
    const res = await options("https://buddysaradhi.app");
    const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
    for (const header of ["x-db-url", "x-db-token", "x-signature", "x-tutor-id", "x-timestamp"]) {
      expect(allowed).not.toContain(header);
    }
  });

  // Two resolvers answer preflights for the same URLs — this one, and the middleware
  // (src/proxy.ts) whose `config.matcher` covers `/api/v1/*` and therefore returns 204
  // FIRST for a real browser preflight. If they disagree, one of them is theatre, and
  // the failing one is whichever nobody is looking at.
  it("agrees with the middleware resolver on every origin (no drift)", async () => {
    const { default: proxy } = await import("@/proxy");
    for (const origin of [
      "https://buddysaradhi.app",
      "https://buddysaradhi.vercel.app",
      "http://localhost:3000",
      "tauri://localhost",
      "https://evil.example",
      "https://buddysaradhi.app.evil.example",
      "null",
    ]) {
      const viaMiddleware = await proxy(
        new NextRequest("http://localhost:3000/api/v1/students", {
          method: "OPTIONS",
          headers: { origin },
        }),
      );
      const viaRoute = await options(origin);
      expect(viaMiddleware.status, origin).toBe(204);
      expect(
        viaMiddleware.headers.get("Access-Control-Allow-Origin"),
        `origin ${origin}`,
      ).toBe(viaRoute.headers.get("Access-Control-Allow-Origin"));
      expect(
        viaMiddleware.headers.get("Access-Control-Allow-Credentials"),
        `origin ${origin}`,
      ).toBe(viaRoute.headers.get("Access-Control-Allow-Credentials"));
    }
  }, 30_000);
});