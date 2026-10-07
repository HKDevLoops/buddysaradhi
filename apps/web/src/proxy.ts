import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

type Platform = 'macos' | 'windows' | 'android' | 'ios' | 'linux' | 'web';

function detectPlatform(ua: string): Platform {
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return 'macos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'web';
}

// Configurable Production Base URLs
const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://buddysaradhi.vercel.app';
const STORE_BASE_URL = process.env.NEXT_PUBLIC_STORE_URL || 'https://buddysaradhi-product.vercel.app';

// Allowed CORS Origins — explicit list only, no wildcard *.vercel.app
// Ref: 10_Security.md §6 (CORS-1), 23_Security_Harness_Plan.md §7
const ALLOWED_ORIGIN_PATTERNS = [
  'https://buddysaradhi.vercel.app',
  'https://buddysaradhi.app',
  'https://app.buddysaradhi.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'tauri://localhost'
];

if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach(o => {
    const trimmed = o.trim();
    if (trimmed && !ALLOWED_ORIGIN_PATTERNS.includes(trimmed)) {
      ALLOWED_ORIGIN_PATTERNS.push(trimmed);
    }
  });
}

function getCorsHeaders(origin: string | null) {
  const isAllowed = origin && ALLOWED_ORIGIN_PATTERNS.includes(origin);
  const allowOrigin = isAllowed ? origin : APP_BASE_URL;

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tutor-Id, X-Requested-With, Accept, Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

export default function proxy(req: NextRequest) {
  const url = req.nextUrl.clone();
  const hostname = req.headers.get('host') || '';
  const pathname = url.pathname;
  const origin = req.headers.get('origin');
  const ua = req.headers.get('user-agent') ?? '';
  const detectedPlatform = detectPlatform(ua);

  // Desktop/Mobile Installer download redirects (Runs globally for local/production parity)
  if (pathname === '/download') {
    const blobBase = process.env.BLOB_PUBLIC_BASE_URL || 'https://public.blob.vercel-storage.com';
    const platformParam = url.searchParams.get('platform');
    const targetPlatform = platformParam || detectedPlatform;

    if (targetPlatform === 'windows') {
      return NextResponse.redirect(`${blobBase}/desktop/windows/buddysaradhi-setup.msi`);
    }
    if (targetPlatform === 'macos') {
      return NextResponse.redirect(`${blobBase}/desktop/macos/buddysaradhi.dmg`);
    }
    if (targetPlatform === 'android') {
      return NextResponse.redirect(`${blobBase}/mobile/android/buddysaradhi.apk`);
    }
    if (targetPlatform === 'ios') {
      return NextResponse.redirect('https://apps.apple.com/app/buddysaradhi');
    }
  }

  // -------------------------------------------------------------------------------------
  // 0. PKCE / Magic Link Code Interceptor
  // -------------------------------------------------------------------------------------
  // If Supabase redirects to the default Site URL instead of the requested emailRedirectTo,
  // we catch the ?code= parameter here and bounce them to the official callback endpoint.
  if (url.searchParams.has('code') && !pathname.startsWith('/callback') && !pathname.startsWith('/api/')) {
    const codeUrl = new URL('/callback', req.url);
    codeUrl.searchParams.set('code', url.searchParams.get('code')!);
    // Preserve redirect-back intent across the PKCE bounce (workstream A gap:
    // dropping ?next= breaks OAuth redirect-back to the pre-login screen).
    const next = url.searchParams.get('next');
    if (next) codeUrl.searchParams.set('next', next);
    return NextResponse.redirect(codeUrl);
  }

  // -------------------------------------------------------------------------------------
  // 1. CORS Preflight & Header Handling for API Routes
  // -------------------------------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    const corsHeaders = getCorsHeaders(origin);

    // OPTIONS preflight response
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const res = NextResponse.next();
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.headers.set(key, value);
    });
    res.headers.set('x-detected-platform', detectedPlatform);
    return res;
  }

  // -------------------------------------------------------------------------------------
  // 2. Domain & Routing Interception (Tutor Portal Web App Only)
  // -------------------------------------------------------------------------------------
  // Redirect root path directly to /login.
  //
  // VERIFIED AGAINST THE FIVE SSR ROUTES (2026-10-07, TABS-HARDEN-01 Phase 1). Two
  // questions were open when `/dashboard` became five routes and both answer
  // "no change needed", recorded here because the next person WILL re-ask them:
  //
  //   1. DOES THIS MATCHER REACH THE NEW ROUTES? Yes — `config.matcher` below is
  //      every path except static assets, and this function returns `updateSession`
  //      for all of them.
  //   2. IS THE AUTH GATE STILL CORRECT FOR THEM? Yes, and it was already correct:
  //      `lib/supabase/middleware.ts:70` lists EXACTLY
  //      `/dashboard, /students, /attendance, /fees, /settings` as the app routes
  //      that require a session and redirect to `/login` when there is none. That
  //      list was written for a future that had not arrived; promoting the five
  //      screens to routes is what made it true. `SCREENS` in
  //      `stores/shell-store.ts` and that `appRoutes` array must agree — change
  //      one, change the other.
  //
  // `/` → `/login` (not `/dashboard`) is deliberate: `/` cannot know whether the
  // visitor has a session, and `updateSession` is the only thing that does. A
  // signed-in tutor who types `buddysaradhi.app` is bounced `/` → `/login` →
  // `/dashboard` (middleware.ts:137-145), which is one extra hop on a cold entry
  // and zero extra logic here. Redirecting `/` straight to `/dashboard` would
  // show an unauthenticated tutor a rendered app frame before middleware decided.
  if (pathname === '/') {
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect any legacy landing requests to the official product store domain
  if (pathname === '/landing') {
    return NextResponse.redirect(new URL('/', STORE_BASE_URL));
  }

  const isHtmlPage = !pathname.startsWith('/api/') && 
                     !pathname.startsWith('/_next/') && 
                     !pathname.includes('.');

  let res: NextResponse;
  let nonce = '';

  if (isHtmlPage) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    nonce = btoa(String.fromCharCode(...array));
    req.headers.set('x-nonce', nonce);
    res = NextResponse.next({
      request: {
        headers: req.headers,
      },
    });
  } else {
    res = NextResponse.next();
  }

  res.headers.set('x-detected-platform', detectedPlatform);

  if (isHtmlPage && nonce) {
    // CSP: nonce-based in dev; strict-dynamic without unsafe-eval in prod.
    // 'unsafe-eval' is explicitly excluded to prevent XSS via eval().
    // Ref: 10_Security.md §6 (XSS-1), 23_Security_Harness_Plan.md §7
    const devConnect = process.env.NODE_ENV !== 'production'
      ? ' ws://localhost:3000 ws://127.0.0.1:3000 ws://localhost:3010 ws://localhost:3100'
      : '';
    const scriptCsp = process.env.NODE_ENV !== 'production'
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
    res.headers.set('Content-Security-Policy', [
      `default-src 'self'`,
      scriptCsp,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' https://fonts.gstatic.com`,
      `img-src 'self' data: blob: https://*.supabase.co`,
      `connect-src 'self' https://*.supabase.co https://*.turso.io https://*.turso.ai https://api.buddysaradhi.app${devConnect}`,
      `frame-ancestors 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `upgrade-insecure-requests`,
    ].join('; '));
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  }

  // A/B Testing Cookies
  const setCookieIfMissing = (name: string, variants: string[]) => {
    let variant = req.cookies.get(name)?.value;
    if (!variant || !variants.includes(variant)) {
      variant = variants[Math.floor(Math.random() * variants.length)];
      res.cookies.set(name, variant, {
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });
    }
  };

  setCookieIfMissing('buddysaradhi_ab_hero', ['a', 'b', 'c']);
  setCookieIfMissing('buddysaradhi_ab_pricing_order', ['monthly_first', 'yearly_first']);
  setCookieIfMissing('buddysaradhi_ab_roi_default', ['small_batch', 'large_batch']);
  setCookieIfMissing('buddysaradhi_ab_download_order', ['android_first', 'ios_first']);

  return updateSession(req, res);
}

export const config = {
  // Match all request paths except static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
