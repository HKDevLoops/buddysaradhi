// Implements: docs/design/overhaul-plan.md §4.1 (`/pricing`: plans × billing
// period, no checkout). Prices are deliberately not stated: this surface
// requests access, an administrator contracts the subscription and provisions
// access by hand, so any figure here would be an invented commercial claim.
// Every price cell is either the site's own published free-plan statement or a
// marked placeholder with an accessible label.

import Link from "next/link";
import {
  BILLING_PERIODS,
  BILLING_PERIOD_LABEL,
  NO_CHECKOUT_NOTE,
  PLAN_CATALOGUE,
  PREPAID_NOTE,
  PRICE_PLACEHOLDER_NOTE,
  type BillingPeriodId,
  type PlanDefinition,
} from "@/lib/access-request";

export const metadata = {
  title: "Pricing. BuddySaradhi.",
  description:
    "Plans and billing periods for BuddySaradhi. No card, no checkout. Request access and an administrator contracts the plan with you.",
};

/** A price we are not publishing, marked as such for screen readers too. */
function PriceOnRequest({ period }: { period: BillingPeriodId }) {
  return (
    <td className="px-4 py-4 align-top">
      <span aria-hidden="true" className="text-xl leading-none">
        &mdash;
      </span>
      <span className="sr-only">{`${BILLING_PERIOD_LABEL[period]} price on request`}</span>
      <span className="mt-1 block text-sm text-[var(--text-muted)]">Price on request</span>
    </td>
  );
}

function PriceCell({ plan, period }: { plan: PlanDefinition; period: BillingPeriodId }) {
  if (plan.pricing === "on-request") return <PriceOnRequest period={period} />;

  // The free plan has no prepaid period; the monthly column carries the site's
  // own published statement so the row is not mistaken for a paid plan.
  if (period === "monthly") {
    return (
      <td className="px-4 py-4 align-top">
        <span className="block font-semibold">No charge</span>
        <span className="mt-1 block text-sm text-[var(--text-muted)]">
          Free for everyone while our infrastructure stays free.
        </span>
      </td>
    );
  }
  return (
    <td className="px-4 py-4 align-top text-[var(--text-muted)]">
      Not applicable
      <span className="sr-only">{`, a ${BILLING_PERIOD_LABEL[period].toLowerCase()} period does not apply to the free plan`}</span>
    </td>
  );
}

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16">
      <header className="max-w-[68ch]">
        <h1 className="font-display text-3xl font-bold text-balance md:text-5xl">
          Plans and billing periods.
        </h1>
        <p className="mt-5 text-pretty text-lg text-[var(--text-secondary)]">
          BuddySaradhi is sold by contract, not by checkout. You tell us what you need, we agree a
          plan and a prepaid period, and an administrator provisions your account.
        </p>
      </header>

      <div
        role="region"
        aria-label="Plans and billing periods"
        tabIndex={0}
        className="mt-10 overflow-x-auto"
      >
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <caption className="sr-only">
            Each plan against each prepaid billing period, with what the plan covers.
          </caption>
          <thead>
            <tr className="border-b border-[var(--border-default)]">
              <th scope="col" className="px-4 py-3 font-display text-sm font-semibold">
                Plan
              </th>
              {BILLING_PERIODS.map((period) => (
                <th key={period} scope="col" className="px-4 py-3 font-display text-sm font-semibold">
                  {BILLING_PERIOD_LABEL[period]}
                </th>
              ))}
              <th scope="col" className="px-4 py-3 font-display text-sm font-semibold">
                What it covers
              </th>
            </tr>
          </thead>
          <tbody>
            {PLAN_CATALOGUE.map((plan) => (
              <tr key={plan.id} className="border-b border-[var(--border-default)] align-top">
                <th scope="row" className="px-4 py-4 font-semibold">
                  {plan.name}
                  <span className="mt-1 block text-sm font-normal text-[var(--text-secondary)]">
                    {plan.audience}
                  </span>
                </th>
                {BILLING_PERIODS.map((period) => (
                  <PriceCell key={period} plan={plan} period={period} />
                ))}
                <td className="px-4 py-4">
                  <span className="block text-[var(--text-secondary)]">{plan.summary}</span>
                  <ul className="mt-3 space-y-1 text-sm text-[var(--text-muted)]">
                    {plan.includes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-10 grid max-w-[68ch] gap-6">
        <div>
          <dt className="font-semibold">Why there is no price here</dt>
          <dd className="mt-1 text-[var(--text-secondary)]">{PRICE_PLACEHOLDER_NOTE}</dd>
        </div>
        <div>
          <dt className="font-semibold">How billing works</dt>
          <dd className="mt-1 text-[var(--text-secondary)]">{PREPAID_NOTE}</dd>
        </div>
        <div>
          <dt className="font-semibold">What happens after you ask</dt>
          <dd className="mt-1 text-[var(--text-secondary)]">{NO_CHECKOUT_NOTE}</dd>
        </div>
      </dl>

      <div className="panel mt-12 flex flex-col items-start gap-4 p-8 md:flex-row md:items-center md:justify-between">
        <p className="max-w-[46ch] text-pretty text-[var(--text-secondary)]">
          Tell us which plan and period you want. A person replies with the terms, then provisions
          your access.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/request-access" className="btn btn-primary">
            Request access
          </Link>
          <a
            href="https://buddysaradhi.vercel.app/signup"
            className="btn btn-secondary"
            rel="noopener"
          >
            Sign up for the free plan
          </a>
        </div>
      </div>
    </div>
  );
}