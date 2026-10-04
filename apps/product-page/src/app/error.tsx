"use client";

// Implements: AGENTS.md §2 Rule 9 (no silent failures — a front door that 500s
// onto Next's built-in error page is a dead end on the one surface every
// prospect reaches first) + docs/design/overhaul-plan.md §4.1.
//
// Next.js 16 shape (docs/01-app/03-api-reference/03-file-conventions/error.md):
// an error boundary is a Client Component, and since v16.2 it receives
// `unstable_retry` rather than `reset` — `reset` only clears the boundary state
// without re-fetching, and a transient build failure wants the re-fetch. The
// same doc notes `error.message` is a generic string in production with the real
// detail in `error.digest`, which is why `SiteErrorState` shows the digest and
// never the message.
//
// No logging happens here on purpose: `console.*` is forbidden (AGENTS.md §2
// Rule 9) and this app's only logger is the admin-console one, gated behind
// `ADMIN_LOG` and scoped to operator events. Next already reports the throw to
// the platform's logs; the digest is the visitor's half of that pairing.
//
// This file is a route-level boundary, so it does NOT cover the root layout. A
// failure in `layout.tsx` still reaches Next's built-in global error page —
// see docs/design/marketing-claims-audit.md §4.

import { SiteErrorState } from "@/components/site-state";

export default function ProductPageError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <SiteErrorState onRetry={unstable_retry} digest={error.digest} />;
}