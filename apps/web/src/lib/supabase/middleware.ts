import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
      // Single Active Session Enforcement (Only verified on actual app dashboard/content pages)
      const activeSessionId = user.user_metadata?.active_session_id;
      const deviceSessionCookie = request.cookies.get('buddysaradhi_session')?.value;

      try {
        if (!deviceSessionCookie) {
          if (activeSessionId) {
            // Sync cookie to match the existing server session ID
            supabaseResponse.cookies.set('buddysaradhi_session', activeSessionId, { maxAge: 2592000, httpOnly: true, path: '/' });
          } else {
            // First time login ever - generate and save a new session ID
            const newSessionId = crypto.randomUUID();
            await supabase.auth.updateUser({ data: { active_session_id: newSessionId } });
            supabaseResponse.cookies.set('buddysaradhi_session', newSessionId, { maxAge: 2592000, httpOnly: true, path: '/' });
          }
        } else if (activeSessionId && deviceSessionCookie !== activeSessionId) {
          // This device has an OLD cookie, but another device logged in and overwrote activeSessionId.
          // Forcibly log out the old session.
          await supabase.auth.signOut();
          supabaseResponse.cookies.delete('buddysaradhi_session');
          url.pathname = '/login';
          return NextResponse.redirect(url);
        }
      } catch (e) {
        // Rule 9 compliance: log warning but fail-open so the user is not locked out of their app
        console.warn("Single session enforcement warning:", e);
      }

      const dbUrl = user.user_metadata?.db_url;
      if (!dbUrl) {
        url.pathname = '/signup/provision';
        return NextResponse.redirect(url);
      }
    }
  }

  // Auth Routes that redirect if already logged in (e.g. they just successfully entered password on /login)
  if ((pathname === '/login' || pathname === '/signup') && user) {
      // Initialize/Reset the session ID upon active login
      const newSessionId = crypto.randomUUID();
      try {
        await supabase.auth.updateUser({ data: { active_session_id: newSessionId } });
        supabaseResponse.cookies.set('buddysaradhi_session', newSessionId, { maxAge: 2592000, httpOnly: true, path: '/' });
      } catch (e) {
        console.warn("Failed to set active session ID on login:", e);
      }

      const dbUrl = user.user_metadata?.db_url;
      if (!dbUrl) {
          url.pathname = '/signup/provision';
          return NextResponse.redirect(url);
      }
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

