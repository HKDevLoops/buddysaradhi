// Implements: docs/design/overhaul-plan.md §4.1 (front door) on web/07_Landing_Page.md
// §2.1 (force-static + 1h ISR) + product/02–05 copy.
// v3: restyled onto the generated tokens (material-modes.md §2). The stats
// strip still reads gateway facts only (R-17, no hardcoded numbers); the price
// claim that used to live here is gone because this surface no longer states
// prices (overhaul-plan.md §4.1: prices are set on the owner's replacement
// list, and /pricing owns the plan matrix).

import { ProductHero } from "@/components/product-3d/ProductHero";
import Link from "next/link";

export const dynamic = "force-static";
export const revalidate = 3600;

interface MarketingStats {
  screens: number;
  engines: number;
  guarantees: string[];
  platforms: string[];
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
    line: "Thirty eight present in twenty seconds, not thirty eight paper registers.",
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
  const facts: string[] = ["Built in India", "No telemetry, ever", "Offline first"];
  if (stats) {
    facts.push(`${stats.screens} screens`, `${stats.engines} engines`);
    for (const g of stats.guarantees) facts.push(g.replace(/-/g, " "));
  }

  return (
    <>
      <ProductHero />

      <ul
        aria-label="Product facts"
        className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 py-5 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

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

      <section id="access" aria-label="Getting access" className="mx-auto w-full max-w-6xl px-6 pb-20">
        <div className="panel grid gap-8 p-8 md:grid-cols-[1.2fr_1fr] md:p-10">
          <div>
            <h2 className="font-display text-3xl font-bold text-balance md:text-4xl">
              Free while our infrastructure stays free.
            </h2>
            <p className="mt-4 max-w-[60ch] text-pretty text-[var(--text-secondary)]">
              Sign up yourself and start today. If you need an institute plan, with staff accounts
              and institute-wide reporting, we contract it with you directly. Either way nothing is
              charged on this site and no card is ever asked for.
            </p>
          </div>
          <div className="flex flex-col items-start justify-center gap-3 md:items-stretch">
            <Link href="/request-access" className="btn btn-primary w-full text-base">
              Request access
            </Link>
            <Link href="/pricing" className="btn btn-secondary w-full text-base">
              See plans and billing periods
            </Link>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Already have access? Sign in to the app.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}