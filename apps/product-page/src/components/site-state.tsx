// Implements: AGENTS.md §2 Rule 9 (a front door that fails must still be
// recoverable — Next's built-in error page is a dead end, and this is the front
// door) + Rule 10 (accessible dead ends) on docs/design/overhaul-plan.md §4.1.
//
// Product-page-local by construction: `apps/web` has its own, richer
// `src/components/ui/screen-state.tsx`, but importing across apps is not a thing
// either build does, and this app's vocabulary, tokens and actions differ.
//
// Invariants the callers rely on:
//   1. `error.message` NEVER reaches a visitor. In production Next replaces it
//      with a generic string plus `digest` (docs/.../file-conventions/error.md
//      "Good to know"), so there is nothing to interpolate and nothing to leak.
//   2. Each surface pairs an icon AND a heading with the tone colour, so the
//      meaning does not depend on colour (AGENTS.md §2 Rule 10).
//   3. Every action is a route that exists in this app. No invented support
//      address, no mailto, no dead link.
//   4. Elevation is the `.panel` 1px contour alone — never a border under a wide
//      soft shadow (craft-floor.md).

import type { ReactNode } from "react";
import Link from "next/link";

function WarningGlyph() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 3.5 2.8 16h14.4L10 3.5Z" />
      <path d="M10 8.5v3.5" />
      <path d="M10 14.2h.01" />
    </svg>
  );
}

function CompassGlyph() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10" cy="10" r="7" />
      <path d="m12.6 7.4-1.5 3.7-3.7 1.5 1.5-3.7 3.7-1.5Z" />
    </svg>
  );
}

/** Shared shell for the two dead-end surfaces: one border, one radius, one
 *  rhythm, one place the heading level is decided. */
function StateFrame({
  glyph,
  tone,
  title,
  children,
}: {
  glyph: ReactNode;
  tone: "danger" | "neutral";
  title: string;
  children: ReactNode;
}) {
  const toneColor = tone === "danger" ? "var(--danger)" : "var(--accent-primary)";
  return (
    <section className="mx-auto w-full max-w-2xl px-6 py-20">
      <div role="alert" className="panel flex flex-col items-start gap-4 p-6 md:p-8">
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-lg"
          style={{
            background: `color-mix(in srgb, ${toneColor} 14%, transparent)`,
            color: toneColor,
          }}
        >
          {glyph}
        </span>
        <div className="flex flex-col gap-2">
          {/* Both dead ends are page-level surfaces: they replace the whole
              segment, so neither has another h1 above it. */}
          <h1 className="font-display text-2xl font-bold text-balance md:text-3xl">
            {title}
          </h1>
          {children}
        </div>
      </div>
    </section>
  );
}

interface SiteErrorStateProps {
  /** Re-runs the failed work. Next 16.2 renamed this from `reset` and it now
   *  re-fetches before re-rendering, which is what a transient failure needs. */
  onRetry: () => void;
  /** The only handle that matches the server-side log. Shown, never invented. */
  digest?: string | undefined;
}

export function SiteErrorState({ onRetry, digest }: SiteErrorStateProps) {
  return (
    <StateFrame glyph={<WarningGlyph />} tone="danger" title="This page did not load.">
      <p className="max-w-[62ch] text-pretty text-[var(--text-secondary)]">
        Something failed on our side while building this page. Nothing you did caused it, and
        nothing was changed or charged. You can try again; if it does not work, the reference
        below is what we match on our logs.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onRetry} className="btn btn-primary text-sm">
          Try again
        </button>
        <Link href="/" className="btn btn-secondary text-sm">
          Back to the product story
        </Link>
      </div>
      {digest ? (
        <p className="text-sm text-[var(--text-muted)]">
          Reference: <span className="break-all">{digest}</span>
        </p>
      ) : null}
    </StateFrame>
  );
}

export function SiteNotFoundState() {
  return (
    <StateFrame
      glyph={<CompassGlyph />}
      tone="neutral"
      title="That page does not exist."
    >
      <p className="max-w-[62ch] text-pretty text-[var(--text-secondary)]">
        The link may be out of date, or the address may have a typo. Nothing was changed or
        charged.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link href="/" className="btn btn-primary text-sm">
          Back to the product story
        </Link>
        <Link href="/pricing" className="btn btn-secondary text-sm">
          See plans
        </Link>
      </div>
    </StateFrame>
  );
}