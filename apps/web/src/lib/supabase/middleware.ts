import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/logger";

// Sentinels that mean "not yet provisioned" — see lib/db.ts
const DUMMY_DB_SENTINELS = ["dummy-local-dev-url", "dummy"];
function isDummyDbUrl(url: string | undefined | null): boolean {
  if (process.env.TURSO_DATABASE_URL || process.env.NODE_ENV !== "production") {
    return false;
  }
  if (!url) return true;
  return DUMMY_DB_SENTINELS.some((s) => url.includes(s));
}

export async function updateSession(
  request: NextRequest,
  baseResponse: NextResponse
): Promise<NextResponse> {
  let supabaseResponse = baseResponse;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          
          supabaseResponse = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          
          toSet.forEach(({ name, value, options }) => {
            // Enforce exactly 30 days (2592000 seconds) auto-logout
            const customOptions = { ...options, maxAge: 2592000 };
            supabaseResponse.cookies.set(name, value, customOptions);
          });
          
          baseResponse.headers.forEach((value, key) => {
             if (key !== 'set-cookie') {
                 supabaseResponse.headers.set(key, value);
             }
          });
        },
      },
    }
  );

  let user: any = null;
  try {
    // THE FAST PATH IS OFFLINE (3.5).
    //
    // `getUser()` asks GoTrue to verify the session: a WAN call on EVERY
    // request the middleware sees, measured at 236-707 ms. `getClaims()`
    // verifies the JWT's SIGNATURE locally against the project's JWKS (cached
    // after the first fetch) and enforces `exp`; it never asks GoTrue. The
    // gateway made the same move (apps/gateway/lib/auth.ts, with the claim
    // policy it adds on top).
    //
    // The fallback is not optional: `getClaims()` is offline, so it cannot
    // REFRESH an expired access token, and only `getUser()` can. So the round
    // trip is paid where it must be paid - on the rare path where the local
    // verification cannot decide - and NOT on every request.
    let claims: any = null;
    try {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      if (!claimsError) claims = claimsData?.claims ?? null;
    } catch {
      // A JWKS fetch failure is NOT an authentication failure. Fall through to
      // the network path rather than logging the tutor out.
      claims = null;
    }
    if (claims) {
      user = claims;
    } else {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    }
  } catch (err) {
    log.warn("middleware_auth_get_user_failed", err instanceof Error ? err.message : String(err));
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.includes("auth-token") || cookie.name.startsWith("sb-")) {
        supabaseResponse.cookies.delete(cookie.name);
      }
    });
  }
  const url = request.nextUrl.clone();
  const pathname = url.pathname;
  
  // App Routes that require authentication
  const appRoutes = ['/dashboard', '/students', '/attendance', '/fees', '/settings'];
  const isAppRoute = appRoutes.some(route => pathname.startsWith(route));
  
  if (isAppRoute && !user) {
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  
  if (user) {
    if (isAppRoute) {
      // ── Single Active Session Enforcement ──────────────────────────────
      // Only enforce when BOTH sides have an active_session_id AND they
      // actively disagree. Never force-signout if the cookie is absent
      // (that means the user just logged in and the cookie hasn't been set yet).
      const deviceSessionCookie = request.cookies.get('buddysaradhi_session')?.value;

      // THE LIVE VALUE, not the token's snapshot.
      //
      // The enforcement compares this device's cookie with the LIVE
      // `active_session_id`, and a token's metadata is a SNAPSHOT: a session
      // opened on another device changes the live value without changing this
      // token. So the enforcement still asks GoTrue for the live value - on
      // the five screen routes, which is where the enforcement runs. The API
      // routes, which are the hot path the finding measured, are now decided
      // entirely offline.
      //
      // This is the ONE place the middleware still makes a network call, and
      // it is here deliberately: dropping it would trade a 236-707 ms page
      // navigation for a weaker single-session rule, which is not a trade
      // worth making silently.
      let activeSessionId = user.user_metadata?.active_session_id as string | undefined;
      if (deviceSessionCookie) {
        try {
          const { data: liveData } = await supabase.auth.getUser();
          const liveActive = liveData.user?.user_metadata?.active_session_id as
            | string
            | undefined;
          if (liveActive) activeSessionId = liveActive;
        } catch {
          // The live value is unavailable. The snapshot is used instead: it
          // cannot fire a FALSE kick, it can only miss one.
        }
      }

      try {
        if (deviceSessionCookie && activeSessionId && deviceSessionCookie !== activeSessionId) {
          // Stale session from a different device.
          await supabase.auth.signOut();
          supabaseResponse.cookies.delete('buddysaradhi_session');
          // Forward the cookie deletes into the redirect response.
          const redirectWithDeletes = NextResponse.redirect(url);
          for (const name of supabaseResponse.cookies.getAll().map((c) => c.name)) {
            const value = supabaseResponse.cookies.get(name)?.value ?? "";
            redirectWithDeletes.cookies.set(name, value);
          }
          return redirectWithDeletes;
        }

        if (!deviceSessionCookie) {
          // Stickiness: only mint a fresh active_session_id on the very first
          // login (no provisioned_at marker). Otherwise re-mint the cookie
          // without rotating the metadata id — rotating it kicks the user's
          // other device off.
          const isFirstEver = !user.user_metadata?.provisioned_at;
          if (activeSessionId) {
            supabaseResponse.cookies.set('buddysaradhi_session', activeSessionId, {
              maxAge: 2592000,
              httpOnly: true,
              path: '/',
            });
          } else if (isFirstEver) {
            const newSessionId = crypto.randomUUID();
            await supabase.auth.updateUser({ data: { active_session_id: newSessionId } });
            supabaseResponse.cookies.set('buddysaradhi_session', newSessionId, {
              maxAge: 2592000,
              httpOnly: true,
              path: '/',
            });
          }
        }
      } catch (e) {
        log.warn('middleware_single_session_enforcement_failed', e instanceof Error ? e.message : String(e));
      }

      // ── Provision Guard ─────────────────────────────────────────────────
      const dbUrl = user.user_metadata?.db_url as string | undefined;
      if (isDummyDbUrl(dbUrl)) {
        url.pathname = '/signup/provision';
        return NextResponse.redirect(url);
      }
    }
  }

  // Auth Routes: redirect authenticated users away from login/signup
  if ((pathname === '/login' || pathname === '/signup') && user) {
    const dbUrl = user.user_metadata?.db_url as string | undefined;
    if (isDummyDbUrl(dbUrl)) {
      url.pathname = '/signup/provision';
      return NextResponse.redirect(url);
    }
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

