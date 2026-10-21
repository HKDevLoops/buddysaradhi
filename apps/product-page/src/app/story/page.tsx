// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §2 (the fifty beats) and §8
// (all fifty beats exist as static, readable HTML), and 20_3D_Product_Page.md
// §12 (the `/story` expansion).
//
// THE PAGE IS THE STORY. The H1 below is server copy - it is in the static
// HTML with zero client JavaScript, which is what `tests/ssr.test.ts` proves
// for the other routes (FM-13). The stage above it is decoration: the canvas
// is aria-hidden, and every caption in the story is ALSO written out below as
// an ordinary list. A visitor with no WebGL, no JavaScript, or a screen
// reader has read the same fifty beats.

import Link from "next/link";
import { StoryExperience } from "@/components/story/story-experience";
import { ACT_TITLES, STORY_BEATS } from "@/components/story/beats";
import type { BeatAct } from "@/components/story/beats";
import {
  APP_SIGNUP_URL,
  CONTRACTED_PLAN_CTA,
  FREE_SIGNUP_CTA,
  FREE_SIGNUP_NOTE,
} from "@/lib/access-request";

export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata = {
  title: "The story. BuddySaradhi.",
  description:
    "One evening in a tutor's life, going wrong and then going right: fifty beats across five acts, and the five screens that answer it.",
};

const ACTS: readonly BeatAct[] = [1, 2, 3, 4, 5];

export default function StoryPage() {
  return (
    <>
      {/* Server H1: the proposition crawlers and screen readers meet first.
          The 3D canvas is aria-hidden decoration; this heading is the page. */}
      <div className="mx-auto w-full max-w-6xl px-6 pt-10">
        <p className="text-sm font-medium" style={{ color: "var(--accent-primary)" }}>
          One evening, twice
        </p>
        <h1 className="font-display mt-2 max-w-[24ch] text-4xl leading-tight font-bold text-balance md:text-5xl">
          The same evening, going wrong. And going right.
        </h1>
        <p className="mt-4 max-w-[68ch] text-pretty text-[var(--text-secondary)]">
          A tutor looking for a class, a corridor of noise, and then the one thing that makes the
          second evening different: a ledger that only ever appends. Fifty beats, five acts, five
          screens. If your device cannot draw 3D, or data saver is on, the whole story is written
          out below.
        </p>
      </div>

      <StoryExperience />

      {/* The same fifty beats as static copy: the no-JS, no-WebGL and search
          surface of this route. The stage above announces them live; this list
          states them permanently. */}
      <section
        id="story-acts"
        aria-labelledby="story-acts-heading"
        className="mx-auto w-full max-w-6xl px-6 py-16"
      >
        <h2
          id="story-acts-heading"
          className="font-display text-3xl font-bold text-balance md:text-4xl"
        >
          The whole story, in words
        </h2>
        {ACTS.map((act) => (
          <div key={act} className="mt-12">
            <h3 className="font-display text-xl font-semibold">
              {`Act ${act}. ${ACT_TITLES[act]}`}
            </h3>
            <ol className="rounded-panel mt-6 overflow-hidden border border-[var(--border-default)]">
              {STORY_BEATS.filter((beat) => beat.act === act).map((beat, index) => (
                <li
                  key={beat.id}
                  id={`story-beat-${beat.id}`}
                  className="row grid gap-1 px-5 py-5 md:grid-cols-[8rem_1fr] md:gap-6"
                >
                  <div className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                    {`Beat ${index + 1}`}
                  </div>
                  <div>
                    <p className="font-semibold">{beat.caption.title}</p>
                    <p className="mt-1 text-pretty text-[var(--text-secondary)]">
                      {beat.caption.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      <section
        id="story-access"
        aria-label="Getting access"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl px-6 pb-20"
      >
        <div className="panel grid gap-8 p-8 md:grid-cols-[1.2fr_1fr] md:p-10">
          <div>
            <h2 className="font-display text-3xl font-bold text-balance md:text-4xl">
              Built for one room at a time.
            </h2>
            <p className="mt-4 max-w-[60ch] text-pretty text-[var(--text-secondary)]">
              One tutor, one room, five screens and one ledger. The free plan needs no contract and
              nobody to reply to, so you can be inside the app today. Nothing is charged on this
              site and no card is ever asked for.
            </p>
          </div>
          <div className="flex flex-col items-start justify-center gap-3 md:items-stretch">
            <a href={APP_SIGNUP_URL} className="btn btn-primary w-full text-base" rel="noopener">
              {FREE_SIGNUP_CTA}
            </a>
            <p className="mt-1 text-sm text-pretty text-[var(--text-muted)]">{FREE_SIGNUP_NOTE}</p>
            <div className="mt-2 flex flex-col items-start gap-2 md:items-stretch">
              <Link href="/request-access" className="action inline-flex min-h-[44px] items-center">
                {CONTRACTED_PLAN_CTA}
              </Link>
              <Link href="/" className="action inline-flex min-h-[44px] items-center">
                Back to the front door
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
