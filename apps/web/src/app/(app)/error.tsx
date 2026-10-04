"use client";

// Implements: AGENTS.md §2 Rule 9 (no silent failures — every failure gets a real
// recovery path and an honest statement of the tutor's data state) + Rule 10 —
// 04_Dashboard.md §3, 13_UI_Guidelines.md §8.8.
//
// The highest useful error boundary for the app group. Per Next.js 16
// (docs/01-app/03-api-reference/03-file-conventions/error.md) `error.js` wraps
// `loading.js`, `not-found.js` and `page.js` but NOT the `layout.js` in the same
// segment — so `GlassShell` and the nav survive a failed dashboard render. The
// tutor keeps their place and gets a Retry instead of Next.js's production 500.
//
// Two Next-16 specifics, verified against the bundled docs, not training data:
//   1. The recovery prop is `unstable_retry()` (added v16.2.0). `reset()` still
//      exists but only re-renders the children WITHOUT re-fetching — wrong for a
//      failed data load, so `unstable_retry` is the correct call here.
//   2. In production the forwarded `error.message` is generic and only `digest`
//      carries server correlation, so there is nothing safe to render either way.
//      We pass the error to `toAppErrorState`, which classifies without echoing.

import { useEffect } from "react";
import { toAppErrorState } from "@/lib/app-errors";
import { log } from "@/lib/logger";
import { ErrorState } from "@/components/ui/screen-state";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const state = toAppErrorState(error);

  useEffect(() => {
    // The digest is the only server-side correlation handle; the message itself
    // is never logged here because on the server it may carry SQL text.
    log.error(
      "route_boundary_failed",
      "A route segment render threw and the app-group boundary caught it.",
      { code: state.code, digest: error.digest ?? null },
    );
  }, [error.digest, state.code]);

  return (
    <div className="flex flex-col p-4 md:p-6">
      <ErrorState
        state={state}
        onRetry={unstable_retry}
        retryLabel="Reload dashboard"
        dataStatus="Nothing was changed. Your students, attendance and fees are exactly as you left them."
      />
    </div>
  );
}