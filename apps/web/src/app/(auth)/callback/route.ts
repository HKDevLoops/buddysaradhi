import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { assertSafeRedirectPath } from '@/server/auth-errors';

export const runtime = "nodejs";

// Implements: web/03_Auth_and_Provisioning.md §7 (OAuth callback target);
// 10_Security.md §11 (no open redirect — `next` is same-origin validated).

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // `next` comes from the OAuth `redirectTo` chain — never trusted raw.
  const next = assertSafeRedirectPath(searchParams.get('next'), '/dashboard');

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (toSet) => {
            toSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return the user to an error page with some instructions
  return NextResponse.redirect(`${origin}/login?error=Invalid+magic+link`);
}
