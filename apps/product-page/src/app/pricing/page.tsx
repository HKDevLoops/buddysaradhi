// Implements: docs/design/overhaul-plan.md §4.1 (`/pricing`: plans × billing
// period, no checkout). Prices are deliberately not stated: this surface
// requests access, an administrator contracts the subscription and provisions
// access by hand, so any figure here would be an invented commercial claim.
// Every price cell is either the site's own published free-plan statement or a
// marked placeholder with an accessible label.
// Funnel pass: the closing panel's primary is free self-serve sign-up, with the
// contracted-plan request as the quiet action beside it
// (docs/design/marketing-claims-audit.md §4.1). This is the page a visitor
// reaches *because* they are already comparing plans, so it is the page where
// "ask a person" used to win by default — and it is the page where it costs the
// most.

import Link from "next/link";
import {
  APP_SIGNUP_URL,
  BILLING_PERIODS,
  BILLING_PERIOD_LABEL,
  CONTRACTED_PLAN_CTA,
  FREE_SIGNUP_CTA,
  FREE_SIGNUP_NOTE,
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
    "Plans and billing periods for BuddySaradhi. Create your free account and start on the web app, or ask for a contracted plan and an administrator agrees the terms with you. No card, no checkout.",
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
          <dt className="font-semibold">What happens if you ask for a contracted plan</dt>
          <dd className="mt-1 text-[var(--text-secondary)]">{NO_CHECKOUT_NOTE}</dd>
        </div>
      </dl>

      <div className="panel mt-12 flex flex-col items-start gap-4 p-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-[46ch]">
          <p className="text-pretty text-[var(--text-secondary)]">
            The free plan needs no contract, no request and no reply, so it is the only thing on
            this page you can finish in one click. If you want the term, the storage quota and the
            export terms written down first, ask for a contracted plan and an administrator agrees
            them with you.
          </p>
        </div>
        {/* One primary, and it is the thing that actually completes. Free
            self-serve sign-up is the only path on this surface that works end to
            end (the access-request endpoint persists to the console store; mail
            delivery is not connected), so asking a visitor who came to compare
            plans to wait for a person would be asking for the slower thing
            first (docs/design/marketing-claims-audit.md §4.1, option (b)). Same
            words as `/`, `/platforms` and the hero. */}
        <div className="flex w-full flex-col items-start gap-2 md:w-auto md:items-stretch">
          <a href={APP_SIGNUP_URL} className="btn btn-primary text-base" rel="noopener">
            {FREE_SIGNUP_CTA}
          </a>
          <p className="text-sm text-pretty text-[var(--text-muted)]">{FREE_SIGNUP_NOTE}</p>
          <Link href="/request-access" className="action inline-flex min-h-[44px] items-center">
            {CONTRACTED_PLAN_CTA}
          </Link>
        </div>
      </div>
    </div>
  );
}