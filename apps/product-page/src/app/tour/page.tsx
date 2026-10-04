// Implements: 20_3D_Product_Page.md §12 (the `/tour` route: a long-scroll 3D
// narrative that walks the five screens in order).
//
// FM-13: the H1 below is server copy - it is in the static HTML with zero
// client JS, which `tests/ssr.test.ts` proves by reading the prerendered
// `tour.html`. The stage overlay (`TourExperience`) therefore uses H2s: one H1
// per document. The static stop list under the stage carries the same copy for
// no-JS, no-WebGL and search visitors; the closing panel holds this surface's
// one primary action (free self-serve sign-up, the only path that completes).

import Link from "next/link";
import { TourExperience } from "./_components/tour-experience";
import { TOUR_STOPS } from "./_components/tour-copy";
import {
  APP_SIGNUP_URL,
  CONTRACTED_PLAN_CTA,
  FREE_SIGNUP_CTA,
  FREE_SIGNUP_NOTE,
} from "@/lib/access-request";

export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata = {
  title: "Tour. BuddySaradhi.",
  description:
    "Walk the five screens in 3D: Dashboard, Students, Attendance, Fees, Settings. Five screens, seven engines, one ledger, zero servers to manage.",
};

export default function TourPage() {
  return (
    <>
      {/* Server H1: the proposition crawlers and screen readers meet first.
          The 3D canvas is aria-hidden decoration; this heading is the page. */}
      <div className="mx-auto w-full max-w-6xl px-6 pt-10">
        <p className="text-sm font-medium" style={{ color: "var(--accent-primary)" }}>
          A guided tour
        </p>
        <h1 className="font-display mt-2 max-w-[22ch] text-4xl leading-tight font-bold text-balance md:text-5xl">
          Walk the five screens in 3D.
        </h1>
        <p className="mt-4 max-w-[68ch] text-pretty text-[var(--text-secondary)]">
          Scroll through the tuition desk: the ledger thread ties Dashboard,
          Students, Attendance, Fees and Settings together. If your device
          cannot draw 3D, or data saver is on, a still image stands in and the
          stops below read the same.
        </p>
      </div>

      <TourExperience />

      {/* The same five stops as static copy: the no-JS, no-WebGL and search
          surface of this route. The stage above announces them live; this list
          states them permanently. */}
      <section aria-labelledby="tour-stops-heading" className="mx-auto w-full max-w-6xl px-6 py-16">
        <h2 id="tour-stops-heading" className="font-display text-3xl font-bold text-balance md:text-4xl">
          The five stops
        </h2>
        <ol className="mt-10 overflow-hidden rounded-panel border border-[var(--border-default)]">
          {TOUR_STOPS.map((s, i) => (
            <li
              key={s.id}
              id={`tour-stop-${s.id}`}
              className="row grid gap-1 px-5 py-5 md:grid-cols-[12rem_1fr] md:gap-6"
            >
              <div className="font-display text-lg font-semibold">
                {s.pin}
                <span className="mt-1 block text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                  {s.kicker}
                </span>
              </div>
              <div>
                <p className="font-semibold">{s.title}</p>
                <p className="mt-1 text-pretty text-[var(--text-secondary)]">{s.body}</p>
                {i === TOUR_STOPS.length - 1 && (
                  <span className="mt-2 block text-sm font-medium" style={{ color: "var(--accent-primary)" }}>
                    Stop 5 of 5
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="tour-access"
        aria-label="Getting access"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl px-6 pb-20"
      >
        <div className="panel grid gap-8 p-8 md:grid-cols-[1.2fr_1fr] md:p-10">
          <div>
            <h2 className="font-display text-3xl font-bold text-balance md:text-4xl">
              Free while our infrastructure stays free.
            </h2>
            <p className="mt-4 max-w-[60ch] text-pretty text-[var(--text-secondary)]">
              The free plan needs no contract and nobody to reply to, so you can
              be inside the app today. Nothing is charged on this site and no
              card is ever asked for.
            </p>
          </div>
          <div className="flex flex-col items-start justify-center gap-3 md:items-stretch">
            <a href={APP_SIGNUP_URL} className="btn btn-primary w-full text-base" rel="noopener">
              {FREE_SIGNUP_CTA}
            </a>
            <p className="mt-1 text-sm text-pretty text-[var(--text-muted)]">{FREE_SIGNUP_NOTE}</p>
            <div className="mt-2 flex flex-col items-start gap-2 md:items-stretch">
              <Link
                href="/request-access"
                className="action inline-flex min-h-[44px] items-center"
              >
                {CONTRACTED_PLAN_CTA}
              </Link>
              <Link href="/" className="action inline-flex min-h-[44px] items-center">
                Back to the product story
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
