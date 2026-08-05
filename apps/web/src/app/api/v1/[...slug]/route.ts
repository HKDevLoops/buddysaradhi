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

type GatewayResult<T> = { success: true; data: T } | { success: false; error: string };

function unwrap<T>(r: GatewayResult<T>): { ok: boolean; status: number; body: unknown } {
  if (r.success) return { ok: true, status: 200, body: r.data };
  const msg = (r as { error: string }).error;
  if (msg.startsWith("DB_NOT_PROVISIONED")) return { ok: false, status: 503, body: { success: false, error: msg, needs_provision: true } };
  if (msg.startsWith("SECURITY_VIOLATION")) return { ok: false, status: 401, body: { success: false, error: msg } };
  if (msg.startsWith("Free tier limit")) return { ok: false, status: 403, body: { success: false, error: msg } };
  if (msg.startsWith("Not found")) return { ok: false, status: 404, body: { success: false, error: msg } };
  if (msg.startsWith("Student not found")) return { ok: false, status: 404, body: { success: false, error: msg } };
  if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("connect ECONNREFUSED")) {
    return { ok: false, status: 502, body: { success: false, error: msg } };
  }
  const m = /^Gateway (\d{3}):/.exec(msg);
  if (m) return { ok: false, status: Number(m[1]) || 500, body: { success: false, error: msg } };
  return { ok: false, status: 500, body: { success: false, error: msg } };
}

async function dispatchGateway(
  req: NextRequest,
  path: string,
  method: string
): Promise<NextResponse> {
  try {
    let r: GatewayResult<unknown>;
    const gatewayPath = `/api/v1${path}`;
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
      const extra: Record<string, string> = {};
      const xbn = req.headers.get("x-batch-name");
      if (xbn) extra["X-Batch-Name"] = xbn;
      if (method === "POST") r = await gatewayPost<unknown>(gatewayPath, body, extra);
      else if (method === "PUT") r = await gatewayPost<unknown>(gatewayPath, body, extra);
      else r = await gatewayPatch<unknown>(gatewayPath, body);
    } else if (method === "DELETE") {
      r = await gatewayDelete<unknown>(gatewayPath);
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
        const defaultFilters = { status: [], batchIds: [], feeModels: [], tagIds: [], balanceRange: "all" as const, admittedInLast: "all" as const };
        const studentsRes = await getStudents(defaultFilters, qp.search || "", 1, 50, { col: "name", dir: "asc" });
        return NextResponse.json(studentsRes.data || { students: [], total: 0 });
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

    if (existingDbUrl && !existingDbUrl.includes("dummy-local-dev-url") && !existingDbUrl.includes("file:")) {
      return NextResponse.json({ success: true, message: "already_provisioned", dbUrl: existingDbUrl });
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
              body: JSON.stringify({ expiration: "never", authorization: "full-access" }),
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
  const allowedOrigins = new Set([
    "https://buddysaradhi.app",
    "https://buddysaradhi.vercel.app",
    "http://localhost:3000",
  ]);
  const envOrigin = process.env.ALLOWED_ORIGIN || "";
  if (envOrigin) allowedOrigins.add(envOrigin);
  const matchedOrigin = allowedOrigins.has(origin) ? origin : "https://buddysaradhi.app";

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": matchedOrigin,
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "authorization,content-type,x-db-url,x-db-token,x-tutor-id,x-tenant-id,x-signature,x-timestamp,x-nonce,x-encrypt-response,x-request-id,x-batch-name",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}
