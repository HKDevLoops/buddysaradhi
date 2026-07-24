// apps/web/src/app/api/auth/signout/route.ts
// Implements: 10_Security.md §3 — Sign-out cleanup.
//
// POST /api/auth/signout
//   * Walk every cookie, delete every `sb-*` auth row + `buddysaradhi_session`
//     device pin (no brittle 0..10 PKCE guess).
//   * Try to revoke the user's refresh token via Supabase admin.
//   * JSON or 302-redirect to /login.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { log } from "@/lib/logger";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APP_COOKIES = new Set(["buddysaradhi_session"]);

function isSupabaseAuthCookie(name: string): boolean {
  if (!name.startsWith("sb-")) return false;
  return name.endsWith("-auth-token") || name.includes("-auth-token-code-verifier-");
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const accept = req.headers.get("accept") ?? "";
  const wantsJson = accept.includes("application/json");
  const url = new URL("/login", req.url);

  let accessToken: string | null = null;
  for (const cookie of req.cookies.getAll()) {
    if (isSupabaseAuthCookie(cookie.name)) {
      accessToken = cookie.value;
      break;
    }
  }

  if (SUPABASE_URL && SUPABASE_SERVICE_KEY && accessToken) {
    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await admin.auth.admin.signOut(accessToken, "global");
      if (error) {
        log.warn(
          "auth_signout_admin_partial",
          "Supabase admin rejected refresh-token revocation; cookies cleared",
          { errorMessage: error.message },
        );
      }
    } catch (err) {
      log.error("auth_signout_admin_failed", err instanceof Error ? err.message : String(err));
    }
  }

  const body = wantsJson
    ? NextResponse.json({ success: true, signedOut: true }, { headers: noStoreHeaders() })
    : NextResponse.redirect(url, { status: 302, headers: noStoreHeaders() });

  for (const cookie of req.cookies.getAll()) {
    if (isSupabaseAuthCookie(cookie.name) || APP_COOKIES.has(cookie.name)) {
      body.cookies.delete(cookie.name);
    }
  }
  return body;
}

export const POST = handle;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
