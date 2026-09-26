// Implements: web/07_Landing_Page.md §2.1 (force-static + 1h ISR) + product/02–05.
// v2: stats-driven proof strip (gateway facts only, R-17), 4 cards + Settings
// strip (R-14 variation), no em dashes (R-02), no hardcoded numbers.

import { ProductHero } from "@/components/product-3d/ProductHero";

export const dynamic = "force-static";
export const revalidate = 3600;

interface MarketingStats {
  screens: number;
  engines: number;
  pricing: { inrPaisePerMonth: number; note: string };
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

const SCREEN_CARDS = [
  {
    name: "Dashboard",
    line: "The month at a glance. Collected, due, and today.",
    accent: "#00FF9D",
  },
  { name: "Students", line: "Every student, every batch, one roster.", accent: "#00F0FF" },
  { name: "Attendance", line: "Thirty eight present in twenty seconds.", accent: "#FFB300" },
  { name: "Fees", line: "Every fee recorded, every receipt numbered.", accent: "#00FF9D" },
];

export default async function ProductPage() {
  const stats = await getStats();
  const strip: string[] = ["Built in India", "No telemetry, ever", "Offline first"];
  if (stats) {
    strip.push(`${stats.screens} screens`, `${stats.engines} engines`);
    for (const g of stats.guarantees) strip.push(g.replace(/-/g, " "));
  }

  return (
    <>
      <ProductHero />

      <ul
        aria-label="Product facts"
        className="glass-faint flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 py-4 text-sm"
        style={{ color: "rgba(255,255,255,0.7)" }}
      >
        {strip.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <section id="screens" aria-label="Five screens" className="px-6 py-16 md:px-12">
        <h2
          className="text-3xl font-bold md:text-4xl"
          style={{ color: "rgba(255,255,255,0.95)", fontFamily: "var(--font-heading)" }}
        >
          Five screens. Nothing else to learn.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {SCREEN_CARDS.map((s) => (
            <article key={s.name} className="glass rounded-2xl p-5">
              <div
                aria-hidden="true"
                className="mb-3 h-1 w-10 rounded"
                style={{ background: s.accent }}
              />
              <h3 className="text-lg font-semibold" style={{ color: "rgba(255,255,255,0.95)" }}>
                {s.name}
              </h3>
              <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
                {s.line}
              </p>
            </article>
          ))}
        </div>
        <article
          aria-label="Settings"
          className="glass mt-4 flex flex-col gap-2 rounded-2xl p-5 md:flex-row md:items-center md:justify-between"
        >
          <div className="flex items-center gap-4">
            <div
              aria-hidden="true"
              className="h-10 w-1 rounded"
              style={{ background: "#B388FF" }}
            />
            <div>
              <h3 className="text-lg font-semibold" style={{ color: "rgba(255,255,255,0.95)" }}>
                Settings
              </h3>
              <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
                Backup, PIN, and your data under your control. The screen that keeps the other four
                honest.
              </p>
            </div>
          </div>
          <p className="shrink-0 text-sm font-semibold" style={{ color: "#B388FF" }}>
            Screen 5 of 5
          </p>
        </article>
      </section>

      <section id="pricing" aria-label="Pricing" className="px-6 py-16 md:px-12">
        <div className="glass mx-auto max-w-2xl rounded-2xl p-8 text-center">
          <h2
            className="text-3xl font-bold"
            style={{ color: "rgba(255,255,255,0.95)", fontFamily: "var(--font-heading)" }}
          >
            {stats
              ? `₹${stats.pricing.inrPaisePerMonth / 100}/mo. Free for everyone.`
              : "Free for everyone."}
          </h2>
          <p className="mt-3" style={{ color: "rgba(255,255,255,0.7)" }}>
            {stats ? stats.pricing.note : "Free while our infra stays free"}. No card, no trial
            clock, no lock-in.
          </p>
          <a
            href="https://buddysaradhi.vercel.app/signup"
            className="mt-6 inline-flex min-h-[44px] items-center rounded-xl px-8 py-4 text-base font-semibold"
            style={{ background: "#00FF9D", color: "#0a0a1a" }}
          >
            Start free. No card needed.
          </a>
        </div>
      </section>
    </>
  );
}
