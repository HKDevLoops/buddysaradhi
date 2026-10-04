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

import { NotFoundState } from "@/components/ui/screen-state";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl items-center justify-center p-6">
      <NotFoundState className="w-full" />
    </main>
  );
}