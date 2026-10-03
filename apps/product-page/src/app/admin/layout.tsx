// Implements: docs/design/overhaul-plan.md §4.2 — the /admin root.
// Owns three things and nothing else: the token import, the palette and
// material attributes the token file needs, and the fact that this tree must
// never be indexed.
//
// It deliberately does NOT render the guard. The guard lives in
// `(console)/layout.tsx` so that `/admin/login` can be reached without a
// session, and so an unauthenticated visitor gets one honest answer rather than
// a redirect loop.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals-admin.css";

/** Every console route reads a cookie, so nothing here is cacheable. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operations console",
  description: "Buddysaradhi operations console. Internal use only.",
  // An ops console has no business in a search index or a shared link preview.
  robots: { index: false, follow: false, nocache: true },
};

// `--surface-overlay`, `--surface-nav` and `--surface-sheet` only resolve when a
// `data-material` value sits on the same element as `data-palette`, so both are
// set here. The console is pinned to an opaque material (material-modes.md §2.4
// keeps tables, rows and forms opaque); a palette switcher lands with W6.
const ADMIN_PALETTE = "inked";
const ADMIN_MATERIAL = "minimal";

export default function AdminRootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="adm-root" data-palette={ADMIN_PALETTE} data-material={ADMIN_MATERIAL}>
      {children}
    </div>
  );
}