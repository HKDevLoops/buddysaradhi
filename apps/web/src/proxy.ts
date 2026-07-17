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

// Allowed CORS Origins
const ALLOWED_ORIGIN_PATTERNS = [
  'https://buddysaradhi.vercel.app',
  'https://buddysaradhi-store.vercel.app',
  'https://storebuddysaradhi.vercel.app',
  'https://buddysaradhi-product.vercel.app',
  'https://buddysaradhi-product-page.vercel.app',
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
  const isAllowed = origin && (ALLOWED_ORIGIN_PATTERNS.includes(origin) || origin.endsWith('.vercel.app'));
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
  // Redirect root path directly to /login
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
    const devConnect = process.env.NODE_ENV !== 'production' ? ' ws://localhost:3000 ws://127.0.0.1:3000 ws://localhost:3010 ws://localhost:3100' : '';
    const devScript = process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : '';
    res.headers.set('Content-Security-Policy', `
      default-src 'self';
      script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devScript};
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: https://*.supabase.co;
      connect-src 'self' https://*.supabase.co https://*.turso.ai https://api.buddysaradhi.app${devConnect};
      frame-ancestors 'none';
      base-uri 'self';
      form-action 'self';
    `.replace(/\s+/g, ' ').trim());
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
