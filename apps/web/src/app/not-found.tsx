// Implements: AGENTS.md §2 Rule 9 (a dead end must still be recoverable) —
// 13_UI_Guidelines.md §8.19, 08_Settings.md §2 (Help/empty-state copy standard).
//
// Per Next.js 16 (docs/01-app/03-api-reference/03-file-conventions/not-found.md):
// the ROOT `app/not-found.tsx` is what handles unmatched URLs for the whole
// application, so one file covers every dead link — no per-group copies needed.
// It renders inside the root layout, so `data-theme`, `data-palette` and the
// generated font variables all apply and the dark canvas is inherited correctly
// (the built-in 404 follows the OS colour scheme instead, which would be a
// visible flash for a dark-default product).
//
// `global-not-found.tsx` was considered and rejected: it is experimental
// (`experimental.globalNotFound`), it bypasses the layout entirely and therefore
// cannot read the app theme, and it is unnecessary here because this app has a
// single root layout.
//
// Per-route `<title>` (black-box probe B1): `not-found.tsx` cannot export
// `metadata` — Next's metadata resolver only reads `layout` and `page`
// modules — so the title is a React 19 `<title>` element, which Next hoists
// into `<head>`. Without it the 404 served the root layout's title like every
// other title-less route.
//
// Auth-aware CTA (black-box probe B9 + web/03_Auth_and_Provisioning.md §1):
// the session is read server-side and the CTA follows it — signed-out tutors
// get "Back to Login" (a `/dashboard` link would just bounce them through the
// middleware auth gate), signed-in tutors get "Go to Dashboard". Any failure
// reading the session resolves to signed-OUT (fail-closed): a login page never
// bounces, a dashboard might. The `catch` deliberately does NOT log — a 404
// for a signed-out visitor is routine (dead link, scan probe), and logging it
// would hand every bot a log-flood vector.

import { NotFoundState } from "@/components/ui/screen-state";
import { createSupabaseServer } from "@/lib/supabase/server";

async function isSignedIn(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.getUser();
    return data.user !== null;
  } catch {
    return false;
  }
}

export default async function NotFound() {
  const signedIn = await isSignedIn();
  return (
    <>
      <title>Page not found · BuddySaradhi</title>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl items-center justify-center p-6">
        <NotFoundState className="w-full" signedIn={signedIn} />
      </main>
    </>
  );
}
