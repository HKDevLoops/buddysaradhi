// Implements: docs/design/overhaul-plan.md §4.1 (front door) on web/07_Landing_Page.md
// §2.1 (force-static + 1h ISR) + product/02–05 copy, on the claims-audit pass
// (docs/design/marketing-claims-audit.md) that removed the last unsupported
// capability claim from this route.
// v3: restyled onto the generated tokens (material-modes.md §2). The stats
// strip still reads gateway facts only (R-17, no hardcoded numbers); the price
// claim that used to live here is gone because this surface no longer states
// prices (overhaul-plan.md §4.1: prices are set on the owner's replacement
// list, and /pricing owns the plan matrix).
// Route-reachability pass: the Attendance line now states the two-tap mechanism
// rather than a headcount and a duration, because no in-repo benchmark supports
// that pairing (audit row 9); the facts strip gained a visible heading so it is
// read as an assertion rather than decoration.
// Funnel pass: the decision panel's primary is now free self-serve sign-up and
// the access request is the quiet action beside it, because the request
// endpoint persists and delivers nothing (audit §4.1 option (b)). `dynamic` and
// `revalidate` below are unchanged — a smoke test asserts both.

import { ProductHero } from "@/components/product-3d/ProductHero";
import Link from "next/link";
import {
  APP_LOGIN_URL,
  APP_SIGNUP_URL,
  CONTRACTED_PLAN_CTA,
  FREE_SIGNUP_CTA,
  FREE_SIGNUP_NOTE,
} from "@/lib/access-request";

export const dynamic = "force-static";
export const revalidate = 3600;

interface MarketingStats {
  screens: number;
  engines: number;
  guarantees: string[];
  platforms: string[];
}

/** Gateway guarantee keys → the sentence a visitor reads. The keys are the
 *  contract (apps/gateway/routes/marketing.ts:16); this is presentation, and an
 *  unknown key still renders rather than disappearing (Rule 9). */
const GUARANTEE_LABEL: Readonly<Record<string, string>> = {
  "offline-first": "Offline first",
  "no-telemetry": "No telemetry, ever",
  "single-tenant-sqlite": "One tutor, one database",
  "append-only-ledger": "Append-only ledger",
};

function guaranteeSentence(key: string): string {
  const known = GUARANTEE_LABEL[key];
  if (known) return known;
  return key.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

async function getStats(): Promise<MarketingStats | null> {
  const base = process.env.MARKETING_STATS_URL ?? "https://api.buddysaradhi.app";
  try {
    const res = await fetch(`${base}/api/v1/marketing/stats`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const body = (await res.json()) as { success: boolean; data: MarketingStats };
    if (!body.success) return null;
    return body.data;
  } catch {
    return null;
  }
}

/** The facts that hold without asking a server. If the gateway is unreachable
 *  these are all we can state, and we say so rather than shipping a shorter
 *  strip that reads as a deliberate list (claims-audit row 1). */
const BASE_FACTS: readonly string[] = ["Built in India", "No telemetry, ever", "Offline first"];


const SCREENS = [
  {
    name: "Dashboard",
    line: "The month at a glance. Collected, due, and what is due today.",
  },
  {
    name: "Students",
    line: "Every student, every batch, one roster you can search without leaving the screen.",
  },
  {
    name: "Attendance",
    line: "One tap marks the batch present, the next tap locks the day, and the record is authoritative from then on.",
  },
  {
    name: "Fees",
    line: "Every fee recorded, every receipt numbered, nothing editable after the fact.",
  },
  {
    name: "Settings",
    line: "Backup, PIN, and your data under your control. The screen that keeps the other four honest.",
  },
] as const;

export default async function ProductPage() {
  const stats = await getStats();

  // Verified facts only, in a stable order, de-duplicated: the gateway repeats
  // two of our base facts in `guarantees`, and a strip that says "offline first"
  // twice reads as filler rather than as two sources agreeing.
  const facts: string[] = [...BASE_FACTS];
  if (stats) {
    const claimed = [
      `${stats.screens} screens`,
      `${stats.engines} engines`,
      ...stats.guarantees.map(guaranteeSentence),
    ];
    for (const claim of claimed) {
      const dup = facts.some((f) => f.toLowerCase() === claim.toLowerCase());
      if (!dup && !facts.includes(claim)) facts.push(claim);
    }
  }

  return (
    <>
      <ProductHero />

      <section aria-labelledby="facts-heading" className="px-6 py-5">
        {/* A visible heading, because an unlabelled list of facts reads as
            decoration rather than as something the page is asserting. */}
        <h2
          id="facts-heading"
          className="text-center text-sm font-semibold text-pretty"
          style={{ color: "var(--text-secondary)" }}
        >
          What we can back up
        </h2>
        <ul
          className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          {facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      {/* Degraded load is stated, never hidden. A strip that quietly renders three
          facts instead of nine reads as a deliberate list, and the visitor cannot
          tell that the counts were withheld (docs/design/marketing-claims-audit.md
          row 1). This only renders when the gateway did not answer. It also names
          the freshness boundary: `revalidate = 3600` means even a checked figure
          can be up to an hour old, and a visitor is entitled to know that. */}
      {stats === null && (
        <p className="mx-auto w-full max-w-[62ch] px-6 pb-6 text-center text-sm text-pretty text-[var(--text-muted)]">
          Every fact above holds on its own. The screen and engine counts and the architecture
          guarantees come from our live API rather than this page, and it did not answer — so we
          are not showing facts we cannot check. This page takes a fresh reading of that API at
          most once an hour, so a checked figure can still be an hour old.
        </p>
      )}

      <section id="screens" aria-label="Five screens" className="mx-auto w-full max-w-6xl px-6 py-16">
        <h2 className="font-display text-3xl font-bold text-balance md:text-4xl">
          Five screens. Nothing else to learn.
        </h2>
        <p className="mt-4 max-w-[68ch] text-pretty text-[var(--text-secondary)]">
          A tutor opens one screen to mark the day, one screen to take a fee, and one screen at
          month end to see what is still owed. There is no sixth screen to learn.
        </p>

        {/* A definition list, not four identical cards: the sequence is the
            claim, so the names are the structure. */}
        <dl className="mt-10 overflow-hidden rounded-panel border border-[var(--border-default)]">
          {SCREENS.map((s, i) => (
            <div
              key={s.name}
              className="row grid gap-1 px-5 py-5 md:grid-cols-[12rem_1fr] md:gap-6"
            >
              <dt className="font-display text-lg font-semibold">
                {s.name}
                {i === SCREENS.length - 1 && (
                  <span className="ml-3 text-sm font-medium" style={{ color: "var(--accent-primary)" }}>
                    Screen 5 of 5
                  </span>
                )}
              </dt>
              <dd className="text-pretty text-[var(--text-secondary)]">{s.line}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        id="access"
        aria-label="Getting access"
        // `tabIndex={-1}` so the hero's "Skip the story" anchor has somewhere to
        // put the keyboard when a browser moves focus to the fragment target. It
        // adds no tab stop, and `:focus-visible` does not match it, so no ring
        // appears for a pointer user.
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl px-6 pb-20"
      >
        <div className="panel grid gap-8 p-8 md:grid-cols-[1.2fr_1fr] md:p-10">
          <div>
            <h2 className="font-display text-3xl font-bold text-balance md:text-4xl">
              Free while our infrastructure stays free.
            </h2>
            <p className="mt-4 max-w-[60ch] text-pretty text-[var(--text-secondary)]">
              The free plan needs no contract and nobody to reply to, so you can be inside the app
              today. Running a coaching institute? Ask us for a contracted plan and the dashboard
              reports across your whole roster. Staff accounts are not in the build yet. Either way
              nothing is charged on this site and no card is ever asked for.
            </p>
          </div>
          <div className="flex flex-col items-start justify-center gap-3 md:items-stretch">
            {/* The primary action of this page, and the only one in the section.
                Free self-serve sign-up is the only path on this surface that
                completes immediately: `POST /api/access-request` validates,
                persists to the console store and returns a receipt, while mail
                delivery to a person is not connected
                (src/app/api/access-request/route.ts), so an access request is
                a genuine offer — it just is not the first thing to ask a
                visitor who has not decided
                (docs/design/marketing-claims-audit.md §4.1, option (b)). The
                words are shared with `/pricing`, `/platforms` and the hero so the
                same offer is never spelled two ways. */}
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
              <Link href="/pricing" className="action inline-flex min-h-[44px] items-center">
                See plans and billing periods
              </Link>
              <p className="text-sm text-[var(--text-muted)]">
                Already have access?{" "}
                <a href={APP_LOGIN_URL} className="action" rel="noopener">
                  Sign in to the app
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}