"use client";

// Implements: AGENTS.md §2 Rule 9 (no silent failures, no dead ends) + Rule 10 —
// 10_Security.md §9, 13_UI_Guidelines.md §8.7.
//
// Last-resort boundary for failures thrown by the ROOT LAYOUT itself, which the
// `(app)/error.tsx` boundary cannot catch: per Next.js 16
// (docs/01-app/03-api-reference/03-file-conventions/error.md#global-error),
// `global-error.js` REPLACES the root layout, so it must define its own
// `<html>`/`<body>`, import its own global styles, and set its own theme —
// the built-in 500 page follows the OS colour scheme and would flash white into
// a dark-default product.
//
// Consequence of that replacement, handled here: the root layout's font CSS
// variables do not exist on this document, so typography falls back to a system
// stack rather than rendering unstyled.
//
// No `metadata` export — error boundaries are Client Components, so React's
// `<title>` is used instead (documented limitation).

import { useEffect } from "react";
import { toAppErrorState } from "@/lib/app-errors";
import { log } from "@/lib/logger";
import { ErrorState } from "@/components/ui/screen-state";
import "./globals.css";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const state = toAppErrorState(error);

  useEffect(() => {
    log.error(
      "root_boundary_failed",
      "The root layout itself threw; the global boundary caught it.",
      { code: state.code, digest: error.digest ?? null },
    );
  }, [error.digest, state.code]);

  return (
    <html lang="en-IN" data-palette="inked" data-theme="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          fontFamily: "var(--font-body, system-ui, -apple-system, sans-serif)",
          background: "var(--canvas, #0f0c29)",
          color: "var(--text-primary, #e6e6e6)",
        }}
      >
        <title>BuddySaradhi — something went wrong</title>
        <main
          style={{
            display: "flex",
            minHeight: "100dvh",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
          }}
        >
          <ErrorState
            state={state}
            onRetry={unstable_retry}
            retryLabel="Reload the app"
            dataStatus="Nothing was changed. Your saved students, attendance, fees and settings are untouched."
          />
        </main>
      </body>
    </html>
  );
}