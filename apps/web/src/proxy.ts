import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { rateLimitApiRequest } from './server/rate-limit';

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

/**
 * Fail-closed CORS resolution — same decision the gateway makes in
 * apps/gateway/lib/errors.ts `corsHeadersForOrigin` and the OPTIONS handler in
 * app/api/v1/[...slug]/route.ts.
 *
 * It used to fall back to `APP_BASE_URL` for anything unrecognised, so an
 * `Origin: https://evil.example` was answered with
 * `Access-Control-Allow-Origin: https://buddysaradhi.vercel.app` AND
 * `Access-Control-Allow-Credentials: true`. A browser correctly refuses that
 * pair (the header value must equal the caller's origin), so nothing leaked — but
 * "the browser saves us" is exactly how a fail-open default gets load-bearing:
 * the header is now a lie the app tells itself, any future consumer that reads it
 * without re-checking the origin is credentialed, and the resolver contradicts
 * the one layer down. No origin → no echo, and no credentials. GUESSING an
 * allowed value is the wildcard bug this replaced.
 *
 * `Vary: Origin` is mandatory and not optional polish: without it a shared cache
 * can hand one origin's credentialed response to another.
 *
 * The method/header/max-age trio is origin-independent and stays for every
 * origin — they grant nothing on their own.
 */
/**
 * Fingerprinting discipline — black-box probe B6; 10_Security.md §6.
 *
 * `x-detected-platform` names the caller's OS family (`windows`, `ios`, …)
 * on EVERY response. That is a per-request fingerprint with no production
 * consumer — nothing server-side branches on it, and no client reads it —
 * so production responses must not carry it. Dev keeps it (local
 * platform-specific debugging, e.g. the `/download` detector), which is why
 * the gate is `NODE_ENV !== "production"` and not a deletion.
 *
 * `x-matched-path` is NEVER ours: no emitter exists in this repo and the Next
 * server never sets it on a response (it only reads the request header of the
 * same name in minimal mode) — the live value (`X-Matched-Path: /login`,
 * `/api/v1/[...slug]`) is added by the Vercel edge downstream of this
 * middleware, where no repo code can remove it (PLATFORM-CONSTRAINED, verified
 * live 2026-10-12). The `delete` below is still load-bearing as a contract:
 * it guarantees OUR layer never emits the header, which is what the unit
 * test pins. If the edge value ever needs to go, that is an owner → Vercel
 * conversation, not a code change here.
 */
function stripFingerprintHeaders(res: NextResponse): void {
  res.headers.delete('x-matched-path');
}

function setPlatformHeader(res: NextResponse, platform: Platform): void {
  if (process.env.NODE_ENV !== 'production') {
    res.headers.set('x-detected-platform', platform);
  } else {
    res.headers.delete('x-detected-platform');
  }
}

/**
 * Best-effort client IP for the edge rate limiter (web/04_API_Routes.md §2).
 * First entry of `x-forwarded-for`, else `x-real-ip`, else `"unknown"`.
 * Deliberately NOT Zod-parsed: the value is an opaque rate-bucket key, never
 * interpolated into SQL, HTML, or a URL, so there is no injection boundary —
 * only a Map key. (AGENTS.md §6.1: Zod at boundaries that parse.)
 */
function clientIpFromRequest(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown';
}

/**
 * The CSP for the contentless `/` → `/login` redirect.
 *
 * Source: `next.config.ts` static policy, MINUS `'unsafe-inline'` from
 * `script-src`, everything else byte-identical. The static policy is the
 * safety net for API/static responses (which carry no scripts either, but
 * share one header); the middleware HTML branch serves the stricter
 * nonce/`strict-dynamic` policy to real pages. A redirect renders NO content,
 * so authorising any inline script on it is pure attack surface — the probe
 * correctly flagged `script-src 'self' 'unsafe-inline'` here as weaker than
 * `/login`'s nonce policy. Keep in sync with `next.config.ts` if its
 * directives change (minus `unsafe-inline` in `script-src`, always).
 * Ref: 10_Security.md §6 (XSS-1), 23_Security_Harness_Plan.md §7.
 */
/** Test seam: the exact CSP the `/` redirect must carry (see above). */
export const REDIRECT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.turso.io https://*.turso.io https://*.turso.ai https://api.buddysaradhi.app",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tutor-Id, X-Requested-With, Accept, Origin',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (!origin || !ALLOWED_ORIGIN_PATTERNS.includes(origin)) return headers;
  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
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

    // This OPTIONS branch is what actually answers a preflight for `/api/v1/*`:
    // `config.matcher` below covers every path except static assets, so middleware
    // returns 204 here and the route's own OPTIONS export is never reached for
    // those routes. It stays (a matcher change would make it live again) and it
    // must keep agreeing with getCorsHeaders — the same allow-or-refuse decision,
    // or one of the two is theatre.
    if (req.method === 'OPTIONS') {
      const preflight = new NextResponse(null, {
        status: 204,
        headers: corsHeaders,
      });
      // Preflights are exempt from the edge rate limiter below: browsers
      // cache them for 86400s (`Access-Control-Max-Age`), a 429 here would
      // read as a CORS failure rather than a throttle, and a recon flood of
      // OPTIONS buys nothing without the GET/POST behind it.
      stripFingerprintHeaders(preflight);
      setPlatformHeader(preflight, detectedPlatform);
      return preflight;
    }

    // Edge rate limit for the versioned API — web/04_API_Routes.md §2
    // (token bucket per IP: 60/min reads, 10/min writes) + §9 RATE_LIMITED
    // (429). This is RECON friction, not capacity control: the BFF's known
    // callers (provision POST once per signup, releases/latest update checks,
    // occasional gateway pass-through) sit orders of magnitude below either
    // cap, so a legitimate client can never trip it — only a storm does.
    // On Vercel the bucket is per-instance and approximate (spec §2 says so
    // explicitly); DDoS stays with the edge firewall. `Retry-After` + the
    // `RateLimit-*` trio are emitted so a throttled caller backs off instead
    // of retrying blind (lib/retry-invoke.ts already honours Retry-After).
    if (pathname.startsWith('/api/v1/')) {
      const kind = req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
      const decision = rateLimitApiRequest(clientIpFromRequest(req), kind);
      const rateHeaders: Record<string, string> = {
        'RateLimit-Limit': String(decision.limit),
        'RateLimit-Remaining': String(decision.remaining),
        'RateLimit-Reset': String(decision.resetAfterSeconds),
      };
      if (!decision.allowed) {
        return new NextResponse(
          JSON.stringify({
            success: false,
            error: `RATE_LIMITED: Too many requests — retry in ${decision.retryAfterSeconds}s.`,
            code: 'RATE_LIMITED',
            retryAfter: decision.retryAfterSeconds,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(decision.retryAfterSeconds),
              ...corsHeaders,
              ...rateHeaders,
            },
          },
        );
      }
      const res = NextResponse.next();
      Object.entries(corsHeaders).forEach(([key, value]) => {
        res.headers.set(key, value);
      });
      Object.entries(rateHeaders).forEach(([key, value]) => {
        res.headers.set(key, value);
      });
      stripFingerprintHeaders(res);
      setPlatformHeader(res, detectedPlatform);
      return res;
    }

    const res = NextResponse.next();
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.headers.set(key, value);
    });
    stripFingerprintHeaders(res);
    setPlatformHeader(res, detectedPlatform);
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
    const redirect = NextResponse.redirect(url);
    // Tightened CSP for a response that renders nothing (REDIRECT_CSP above):
    // without this the static `next.config.ts` safety-net policy applies and
    // the redirect advertises `script-src 'unsafe-inline'` — weaker than the
    // nonce policy of the `/login` page it points at.
    redirect.headers.set('Content-Security-Policy', REDIRECT_CSP);
    stripFingerprintHeaders(redirect);
    setPlatformHeader(redirect, detectedPlatform);
    return redirect;
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

  stripFingerprintHeaders(res);
  setPlatformHeader(res, detectedPlatform);

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
    // No `Cross-Origin-Embedder-Policy: require-corp` — intentionally off
    // (see next.config.ts): it would break Supabase/Turso/Fonts embeds until
    // every embed is verified CORP-clean. Owner follow-up, not a code gap.
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
