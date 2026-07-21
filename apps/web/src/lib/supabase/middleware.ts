import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Sentinels that mean "not yet provisioned" — see lib/db.ts
const DUMMY_DB_SENTINELS = ["dummy-local-dev-url", "dummy", "file:"];
function isDummyDbUrl(url: string | undefined | null): boolean {
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
            request,
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

  const { data: { user } } = await supabase.auth.getUser();
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
      const activeSessionId = user.user_metadata?.active_session_id as string | undefined;
      const deviceSessionCookie = request.cookies.get('buddysaradhi_session')?.value;

      try {
        if (deviceSessionCookie && activeSessionId && deviceSessionCookie !== activeSessionId) {
          // Both sides have a session ID and they disagree — this device was
          // superseded by another login. Force-signout the stale session.
          await supabase.auth.signOut();
          supabaseResponse.cookies.delete('buddysaradhi_session');
          url.pathname = '/login';
          return NextResponse.redirect(url);
        }

        if (!deviceSessionCookie) {
          // Cookie absent — first request after login (or cleared on logout).
          // Mint/sync the cookie from metadata if we have one, or create a fresh one.
          if (activeSessionId) {
            supabaseResponse.cookies.set('buddysaradhi_session', activeSessionId, {
              maxAge: 2592000,
              httpOnly: true,
              path: '/',
            });
          } else {
            // Truly first login ever — generate and persist a new session ID.
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
        // Rule 9: log warning but fail-open so the user is not locked out
        console.warn('Single session enforcement warning:', e);
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

