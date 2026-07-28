import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

const APP_COOKIES = new Set(["buddysaradhi_session"]);
const isSupabaseAuthCookie = (name: string) =>
  name.startsWith("sb-") || name.includes("auth-token") || name.includes("supabase");

export async function POST(req: NextRequest) {
  const accept = req.headers.get("accept") ?? "";
  const wantsJson = accept.includes("application/json");
  const redirectUrl = new URL("/login", req.url);
  const noStoreHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  };

  let cookiesCleared = 0;
  let didServerRevoke = false;

  try {
    const supabase = await createSupabaseServer();
    let accessToken: string | null = null;
    for (const cookie of req.cookies.getAll()) {
      if (isSupabaseAuthCookie(cookie.name)) {
        accessToken = cookie.value;
        break;
      }
    }
    if (accessToken) {
      try {
        const { data } = await supabase.auth.getUser(accessToken);
        if (data.user?.id) {
          await supabase.auth.signOut({ scope: "global" });
          didServerRevoke = true;
        }
      } catch (err) {
        log.error("auth_signout_supabase_failed", err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    log.error("auth_signout_bootstrap_failed", err instanceof Error ? err.message : String(err));
  }

  const response = wantsJson
    ? NextResponse.json(
        { success: true, signedOut: true, didServerRevoke },
        { headers: noStoreHeaders },
      )
    : NextResponse.redirect(redirectUrl, { status: 302, headers: noStoreHeaders });

  for (const cookie of req.cookies.getAll()) {
    if (isSupabaseAuthCookie(cookie.name) || APP_COOKIES.has(cookie.name)) {
      response.cookies.delete(cookie.name);
      cookiesCleared += 1;
    }
  }
  response.headers.set("x-buddysaradhi-cookies-cleared", String(cookiesCleared));
  return response;
}
