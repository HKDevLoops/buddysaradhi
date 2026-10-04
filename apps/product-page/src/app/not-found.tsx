// Implements: AGENTS.md §2 Rule 9 (a dead link is still a dead end the visitor
// has to get out of) on docs/design/overhaul-plan.md §4.1.
//
// Next.js 16 (docs/01-app/03-api-reference/03-file-conventions/not-found.md):
// since v13.3.0 the ROOT `app/not-found.tsx` is what serves unmatched URLs for
// the whole app, so one file covers every dead link — no per-route copies. It
// renders INSIDE the root layout, so `data-palette`, `data-material` and the
// generated font variables all apply and the canvas is the product's own dark
// palette rather than the built-in 404's OS colour scheme.
//
// `global-not-found.tsx` was considered and rejected: experimental
// (`experimental.globalNotFound`), it bypasses the layout and therefore cannot
// read the palette, and it buys nothing here because this app has a single root
// layout.

import { SiteNotFoundState } from "@/components/site-state";

export default function NotFound() {
  return <SiteNotFoundState />;
}