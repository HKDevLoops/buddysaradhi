export const runtime = "nodejs";
// apps/web/src/app/api/v1/[...slug]/route.ts
// Thin gateway pass-through. The canonical gateway is supabase/functions/gateway.
// This BFF only handles: /releases/latest, /auth/signout, /provision.
// All other /api/v1/* requests are forwarded to the gateway.

import { NextRequest, NextResponse } from "next/server";
import {
  gatewayGet,
  gatewayPost,
  gatewayPatch,
  gatewayDelete,
} from "@/server/get-db";
import { log } from "@/lib/logger";
import type { StudentFilters } from "@/types/students";

type GatewayResult<T> = { success: true; data: T } | { success: false; error: string };

/**
 * The two halves of a gateway refusal, decided SEPARATELY on purpose.
 *
 * `status` is a published contract — web/04_API_Routes.md §9 Error Code Catalogue,
 * asserted by tests/e2e/settings-auth.spec.ts (GET /api/v1/students answers only
 * 200/401/503) and read by hooks/use-auto-provision.ts (a 503 carrying
 * `needs_provision` triggers /api/provision). It is reproduced here branch-for-branch
 * from the chain this replaced, unchanged, so hardening the message cannot move a
 * status.
 *
 * `error` is the TEXT, and text is what leaks. `msg` is what server/get-db.ts's
 * gatewayGet/gatewayPatch/gatewayPost/gatewayDelete build out of a non-2xx response —
 * `Gateway ${res.status}: ${await res.text()}`, the raw upstream body, verbatim.
 * Nothing leaks today only because the gateway happens to sanitise its own 5xx
 * (apps/gateway/lib/errors.ts `sanitizeError`); a 4xx that slips through, or any future
 * gateway that stops sanitising, is forwarded to the browser with zero review. There
 * was no allowlist here at all: whatever the gateway said, we said. Hence CLIENT_FACING
 * below — a fixed string per recognised shape, and a canned per-status sentence for
 * everything else.
 *
 * Full get-db.ts throw audit behind the status chain, by symbol (line numbers there
 * move every week): `getGatewayHeaders` AUTH_REQUIRED → 401; `getAuthenticatedDb` /
 * `getGatewayHeaders` DB_NOT_PROVISIONED → 503 + needs_provision; the four
 * `Gateway NNN:` throws → NNN; and CRITICAL: GATEWAY_SHARED_SECRET missing
 * (`resolveSharedSecret`) plus "Web Crypto API" (`signHmacSha256`) are server
 * misconfigurations and correctly stay 500.
 */
function resolveGatewayFailure(msg: string): { status: number; needsProvision: boolean } {
  if (msg.startsWith("DB_NOT_PROVISIONED")) return { status: 503, needsProvision: true };
  // Auth/session failures are 401, never the default 500.
  // Spec: web/04_API_Routes.md §9 — UNAUTHENTICATED → 401 ("No Supabase session;
  // client should redirect to /login") + §4.1 GET /api/students codes;
  // web/03_Auth_and_Provisioning.md (session required on protected routes).
  if (msg.startsWith("AUTH_REQUIRED") || msg.startsWith("UNAUTHENTICATED")) return { status: 401, needsProvision: false };
  if (msg.startsWith("SECURITY_VIOLATION")) return { status: 401, needsProvision: false };
  if (msg.startsWith("Free tier limit")) return { status: 403, needsProvision: false };
  if (msg.startsWith("Not found")) return { status: 404, needsProvision: false };
  if (msg.startsWith("Student not found")) return { status: 404, needsProvision: false };
  if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) return { status: 502, needsProvision: false };
  // Workstream A gap: gateway-relayed credential/provision states arrive as
  // "Gateway 401: CREDENTIALS_EXPIRED: ..." / "Gateway 401: DB_NOT_PROVISIONED".
  // The regex below would keep the 401; expired credentials stay 401 (typed,
  // UI routes to re-provision), but an unprovisioned DB must surface 503 +
  // needs_provision like the direct branch above (web/04 §9 catalogue).
  if (msg.includes("CREDENTIALS_EXPIRED")) return { status: 401, needsProvision: false };
  if (msg.includes("DB_NOT_PROVISIONED") || msg.includes("NEEDS_PROVISION")) return { status: 503, needsProvision: true };
  const m = /^Gateway (\d{3}):/.exec(msg);
  if (m) return { status: Number(m[1]) || 500, needsProvision: false };
  return { status: 500, needsProvision: false };
}

/**
 * The ONLY strings this BFF will put on the wire for a failure, and every one of
 * them is a literal written here.
 *
 * Each entry keeps the code the browser dispatches on (lib/app-errors.ts
 * `extractServerCode`, which switches on a leading `CODE:` prefix and falls back to
 * text heuristics) and DROPS the detail. `route.bff.test.ts` asserts, per row, that
 * `toAppErrorState(forwarded).code` still equals the code the raw text resolved to
 * before — so this table cannot quietly break a screen's error state.
 *
 * Rows are matched by SUBSTRING because the gateway's text arrives wrapped
 * ("Gateway 401: CREDENTIALS_EXPIRED: …"), and its 400s arrive as JSON
 * (`{"success":false,"error":"VALIDATION","details":[…]}` — gateway `failZod`). Order
 * matters: the first match wins.
 */
const CLIENT_FACING: ReadonlyArray<readonly [RegExp, string]> = [
  [/AUTH_REQUIRED/, "AUTH_REQUIRED: No session — sign in again."],
  // No "unauthorized"/"session" wording here on purpose: those words are what the UI's
  // heuristic keys on, and folding them in would silently re-point this 401 at the
  // re-login state. Parity with the passthrough is the contract until app-errors.ts
  // grows UNAUTHENTICATED as a real code (that file is not ours to change).
  [/UNAUTHENTICATED/, "UNAUTHENTICATED: Not signed in."],
  [/SECURITY_VIOLATION/, "SECURITY_VIOLATION: Request refused by security policy."],
  [/DB_NOT_PROVISIONED/, "DB_NOT_PROVISIONED: User database is not yet provisioned."],
  [/NEEDS_PROVISION/, "NEEDS_PROVISION: Database setup is required before continuing."],
  [/CREDENTIALS_EXPIRED/, "CREDENTIALS_EXPIRED: Database credentials expired or rejected."],
  [/VALIDATION/, "VALIDATION: Something in the request was invalid — check the details and try again."],
  [/CONFLICT/, "CONFLICT: This record changed elsewhere — refresh and try again."],
  [/NOT_FOUND/, "NOT_FOUND: Not found."],
  [/UPSTREAM/, "UPSTREAM: Could not reach the database — check your connection and retry."],
  [/Free tier limit/, "Free tier limit reached."],
  // "Student not found" / "Not found" are our own literals, so they stay readable;
  // both still trip the mapper's `not found` → NOT_FOUND heuristic.
  [/Student not found/, "Student not found."],
  [/Not found/, "Not found."],
];

/** Canned sentence per status for anything CLIENT_FACING does not recognise — the
 *  same table the gateway collapses its own 5xx to (apps/gateway/lib/errors.ts `ERROR_MESSAGES`),
 *  so an unmapped refusal reads identically whichever hop noticed it. */
const STATUS_FALLBACK: Readonly<Record<number, string>> = {
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

function clientFacingError(msg: string, status: number): string {
  for (const [pattern, text] of CLIENT_FACING) {
    if (pattern.test(msg)) return text;
  }
  return STATUS_FALLBACK[status] ?? "internal server error";
}

function unwrap<T>(r: GatewayResult<T>): { ok: boolean; status: number; body: unknown } {
  if (r.success) return { ok: true, status: 200, body: r.data };
  const raw = (r as { error: string }).error;
  const { status, needsProvision } = resolveGatewayFailure(raw);
  // The raw text is exactly what an engineer needs to debug this and exactly what
  // must never reach a browser, so it is logged here and nowhere else (Rule 9,
  // 10_Security.md §8). 5xx goes to the `error` channel (audit-grade); routine 4xx
  // refusals go to `info`, which is Vercel-logs-only — so a driver string that
  // carries SQL or a Turso host never lands in the tenant's audit_log table.
  if (status >= 500) log.error("gateway_refusal_collapsed", raw, { status });
  else log.info("gateway_refusal_collapsed", raw, { status });
  const body: { success: false; error: string; needs_provision?: boolean } = {
    success: false,
    error: clientFacingError(raw, status),
  };
  if (needsProvision) body.needs_provision = true;
  return { ok: false, status, body };
}

async function dispatchGateway(
  req: NextRequest,
  path: string,
  method: string
): Promise<NextResponse> {
  try {
    let r: GatewayResult<unknown>;
    const gatewayPath = `/api/v1${path}`;
    // RFC-004 C1: forward client intent headers to the gateway on every
    // mutating method (void POST today, PATCH/DELETE tomorrow).
    const extra: Record<string, string> = {};
    const xbn = req.headers.get("x-batch-name");
    if (xbn) extra["X-Batch-Name"] = xbn;
    const ikey = req.headers.get("idempotency-key");
    if (ikey) extra["Idempotency-Key"] = ikey;
    if (method === "GET") {
      const qp = Object.fromEntries(req.nextUrl.searchParams.entries());
      r = await gatewayGet<unknown>(gatewayPath, qp as Record<string, string>);
    } else if (method === "POST" || method === "PUT" || method === "PATCH") {
      let body: unknown = {};
      try {
        body = await req.clone().json().catch(() => ({}));
      } catch {
        body = {};
      }
      if (method === "POST") r = await gatewayPost<unknown>(gatewayPath, body, extra);
      else if (method === "PUT") r = await gatewayPost<unknown>(gatewayPath, body, extra);
      else r = await gatewayPatch<unknown>(gatewayPath, body, extra);
    } else if (method === "DELETE") {
      r = await gatewayDelete<unknown>(gatewayPath, extra);
    } else {
      return NextResponse.json(
        { success: false, error: "Method not allowed" },
        { status: 405 }
      );
    }

    const u = unwrap(r);
    if (!u.ok && u.status === 502 && path === "/students" && method === "GET") {
      try {
        const { getStudents } = await import("@/server/queries/students");
        const qp = Object.fromEntries(req.nextUrl.searchParams.entries());
        // `satisfies StudentFilters` replaces two `as const` clenches with one checked
        // constraint. Before it the object was never verified: only the two
        // `as const` narrowed the union-valued fields enough to be assignable, so
        // a misspelled FILTER KEY would have compiled and been passed to
        // `getStudents` as-is. The key set and the two enums are now checked.
        // The four arrays are NOT meaningfully checked — an empty `[]` infers
        // `never[]`, which satisfies any element type — so they are listed here
        // for shape, not safety.
        const defaultFilters = {
          status: [],
          batchIds: [],
          feeModels: [],
          tagIds: [],
          balanceRange: "all",
          admittedInLast: "all",
        } satisfies StudentFilters;
        const studentsRes = await getStudents(defaultFilters, qp.search || "", 1, 50, { col: "name", dir: "asc" });
        // `getStudents` RESOLVES with a typed error rather than throwing, so the
        // `catch` above never fires for a gateway outage. The old
        // `studentsRes.data || { students: [], total: 0 }` therefore answered
        // **200 with an empty roster**, and the tutor saw "No students found"
        // next to an Add-Student CTA — a plausible wrong answer that invites
        // re-creating a roster that still exists. A degraded read is reported as
        // degraded, never as emptiness.
        if (!studentsRes.success) {
          log.error("gateway_fallback_unavailable", String(studentsRes.error));
          return NextResponse.json(
            { success: false, error: "UPSTREAM: students unavailable" },
            { status: 503 },
          );
        }
        return NextResponse.json(studentsRes.data);
      } catch (fbErr) {
        log.error("gateway_fallback_failed", fbErr instanceof Error ? fbErr.message : String(fbErr));
      }
    }
    return NextResponse.json(u.body, { status: u.status });
  } catch (err) {
    log.error("gateway_proxy_failed", err instanceof Error ? err.message : String(err), { path, method });
    return NextResponse.json(
      { success: false, error: "GATEWAY_UNREACHABLE" },
      { status: 502 }
    );
  }
}

type RouteCtx = { params: Promise<{ slug: string[] }> };

async function getSlug(_req: NextRequest, ctx: RouteCtx): Promise<string[]> {
  try {
    const p = await ctx?.params;
    if (p?.slug && Array.isArray(p.slug)) return p.slug;
  } catch {}
  return [];
}

async function dispatch(req: NextRequest, slug: string[]): Promise<NextResponse> {
  const path = "/" + slug.join("/");
  const method = req.method;

  // --- Releases (static, no gateway) ---
  if (path === "/releases/latest" && method === "GET") {
    const manifest = {
      version: "1.4.0",
      releasedAt: "2025-06-27T10:00:00Z",
      changelogUrl: "/changelog/1.4.0",
      platforms: {
        macos: {
          url: "https://public.blob.vercel-storage.com/buddysaradhi/desktop/macos/Buddysaradhi-1.4.0-universal.dmg",
          size: 14212456,
          sha256: "a3f5e8b9c1d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
          minOs: "11.0"
        },
        windows: {
          url: "https://public.blob.vercel-storage.com/buddysaradhi/desktop/windows/Buddysaradhi-Setup-1.4.0-x64.msi",
          size: 11800000,
          sha256: "b4f6e9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
          minOs: "10.0.19041"
        },
        android: {
          url: "https://public.blob.vercel-storage.com/buddysaradhi/mobile/android/Buddysaradhi-1.4.0-universal.apk",
          size: 28000000,
          sha256: "c5f7e0d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
          minSdk: "26"
        },
        ios: {
          url: null,
          testFlightUrl: "https://testflight.apple.com/join/abc123XY",
          minIos: "16.0"
        }
      }
    };
    return NextResponse.json(manifest, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  }

  // --- Auth Signout (deprecated stub) ---
  if (path === "/auth/signout") {
    return NextResponse.json(
      { success: false, error: "AUTH_SIGNOUT_DEPRECATED", message: "Use the signOut server action instead." },
      { status: 410 }
    );
  }

  // --- Provision ---
  if (path === "/provision" && method === "POST") {
    const TURSO_API_TOKEN = process.env.TURSO_API_TOKEN;
    const TURSO_ORGANISATION_SLUG = process.env.TURSO_ORGANISATION_SLUG || process.env.TURSO_ORGANISATION_NAME;
    const TURSO_SHARED_URL = process.env.TURSO_DATABASE_URL;
    const TURSO_SHARED_TOKEN = process.env.TURSO_AUTH_TOKEN;
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { createClient } = await import("@supabase/supabase-js");
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await adminSupabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 });
    }

    const user = userData.user;
    const existingDbUrl = user.user_metadata?.db_url as string | undefined;

    // The Turso hostname is infrastructure detail, not client state. It used to be
    // echoed here, which handed the browser the exact host a leaked db_token
    // targets (see the credential audit). The caller already reads `db_url` from
    // the Supabase session's user_metadata, which is the only place it should
    // come from, so nothing downstream needs it restated here.
    if (existingDbUrl && !existingDbUrl.includes("dummy-local-dev-url") && !existingDbUrl.includes("file:")) {
      return NextResponse.json({ success: true, message: "already_provisioned" });
    }

    let dbUrl: string | null = null;
    let dbToken: string | null = null;
    let provisionMethod = "turso";

    if (TURSO_API_TOKEN && TURSO_ORGANISATION_SLUG) {
      const dbName = `buddysaradhi-${user.id.slice(0, 16)}`;
      try {
        const createRes = await fetch(
          `https://api.turso.tech/v1/organizations/${TURSO_ORGANISATION_SLUG}/databases`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${TURSO_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: dbName, group: "buddysaradhi" }),
          }
        );

        if (createRes.ok || createRes.status === 422) {
          let dbHostname: string | null = null;
          if (createRes.ok) {
            const createData = await createRes.json() as Record<string, unknown>;
            const db = createData.database as Record<string, unknown> | undefined;
            dbHostname = (db?.Hostname as string) ?? null;
          }
          const tokenRes = await fetch(
            `https://api.turso.tech/v1/organizations/${TURSO_ORGANISATION_SLUG}/databases/${dbName}/auth/tokens`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${TURSO_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ expiration: "1y" }),
            }
          );
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json() as Record<string, unknown>;
            if (tokenData.jwt) {
              const hostname = dbHostname ?? `${dbName}-${TURSO_ORGANISATION_SLUG}.aws-ap-south-1.turso.io`;
              dbUrl = `libsql://${hostname}`;
              dbToken = tokenData.jwt as string;
            }
          }
        }
      } catch (err) {
        log.error("turso_api_error", err instanceof Error ? err.message : String(err));
      }
    }

    if (!dbUrl || !dbToken) {
      if (TURSO_SHARED_URL && TURSO_SHARED_TOKEN) {
        dbUrl = TURSO_SHARED_URL;
        dbToken = TURSO_SHARED_TOKEN;
        provisionMethod = "shared";
      }
    }

    if (!dbUrl || !dbToken) {
      return NextResponse.json({ success: false, error: "Unable to provision database." }, { status: 503 });
    }

    const { error: updateErr } = await adminSupabase.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        db_url: dbUrl,
        db_token: dbToken,
        provisioned_at: new Date().toISOString(),
        provision_method: provisionMethod,
      },
    });

    if (updateErr) {
      return NextResponse.json({ success: false, error: "Failed to store database credentials." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "provisioned", method: provisionMethod });
  }

  // --- All other routes: forward to gateway ---
  return dispatchGateway(req, path, method);
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const slug = await getSlug(req, ctx);
  return dispatch(req, slug);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const slug = await getSlug(req, ctx);
  return dispatch(req, slug);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const slug = await getSlug(req, ctx);
  return dispatch(req, slug);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const slug = await getSlug(req, ctx);
  return dispatch(req, slug);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const slug = await getSlug(req, ctx);
  return dispatch(req, slug);
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("Origin") || "";
  // The static list is the SAME set src/proxy.ts carries, entry for entry. It used
  // to be a strict subset — no `tauri://localhost`, no `app.` subdomain, no :3001 —
  // which meant the two resolvers answered the same preflight differently depending
  // on which one got there first. route.bff.test.ts pins them together; do not add an
  // origin on one side only.
  const allowedOrigins = new Set([
    "https://buddysaradhi.vercel.app",
    "https://buddysaradhi.app",
    "https://app.buddysaradhi.app",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "tauri://localhost",
  ]);
  // Both spellings, comma/space separated — the same `ALLOWED_ORIGINS ||
  // ALLOWED_ORIGIN` + `/[,\s]+/` split the gateway does (apps/gateway/lib/errors.ts `allowedCorsOrigins`)
  // and the same pair src/proxy.ts reads. Three resolvers that each understand one
  // spelling is how "it works in dev, not on Vercel" happens.
  const envList = `${process.env.ALLOWED_ORIGINS || ""} ${process.env.ALLOWED_ORIGIN || ""}`;
  for (const raw of envList.split(/[,\s]+/)) {
    const trimmed = raw.trim();
    if (trimmed) allowedOrigins.add(trimmed);
  }
  // Fail closed for an unlisted origin: emit NO Access-Control-Allow-Origin and no
  // Allow-Credentials at all, matching apps/gateway/lib/errors.ts `corsHeadersForOrigin`. It used
  // to echo the canonical origin to every caller, which browsers correctly reject
  // (so no credential leaked) but which contradicts the resolver one layer down and
  // will drift further.
  //
  // The `x-db-*` / `x-tutor-id` / `x-signature` headers are also dropped from the
  // allowlist. This is a same-origin BFF: a browser never needs to send them
  // itself — only a non-browser caller would, which is exactly the audience that
  // should not be handing out a CORS preflight.
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type,x-encrypt-response,x-request-id,x-batch-name",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    Vary: "Origin",
  };
  if (allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return new NextResponse(null, { status: 204, headers });
}
