// Implements: docs/design/overhaul-plan.md §4.1 (`/request-access`). This is an
// ACCESS REQUEST, not a checkout: the product is sold manually and an
// administrator provisions access after contracting the plan
// (docs/design/overhaul-plan.md §0 and §4.2). The endpoint it posts to is the
// stub at src/app/api/access-request/route.ts.
// Claims-audit pass (docs/design/marketing-claims-audit.md rows 5–6): this page
// no longer promises a delivery the build does not make, and it always leaves
// the visitor with a path that works today.
// Funnel pass: this route is now reached by the words "Ask for a contracted
// plan", so the page says those words, and the free sign-up it recommends is the
// same control with the same label as every other primary on the front door.

import { AccessRequestForm } from "./access-request-form";
import {
  APP_SIGNUP_URL,
  CONTRACTED_PLAN_CTA,
  FREE_SIGNUP_CTA,
  FREE_SIGNUP_NOTE,
  FREE_PLAN_NOTE,
  NO_CHECKOUT_NOTE,
  PRICE_PLACEHOLDER_NOTE,
  REQUEST_DELIVERY_NOTE,
} from "@/lib/access-request";

export const metadata = {
  // The tab title says the same words as the heading and as the link that leads
  // here, so the three never contradict each other.
  title: "Ask for a contracted plan. BuddySaradhi.",
  description:
    "Ask for a contracted BuddySaradhi plan. Tell us the plan and prepaid period you want, an administrator contracts it with you and provisions your account. Nothing is charged on this page, and the free plan is one click away.",
};

export default function RequestAccessPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1fr_1.1fr]">
      <div>
        {/* The heading matches the words the rest of the front door uses to get
            here (`CONTRACTED_PLAN_CTA`), so a visitor who followed "Ask for a
            contracted plan" arrives on the page that says so. It used to say
            "Request access", which is the same promise in different words — the
            exact inconsistency clarify.md warns about. */}
        <h1 className="font-display text-3xl font-bold text-balance md:text-5xl">
          {CONTRACTED_PLAN_CTA}.
        </h1>
        <p className="mt-5 max-w-[56ch] text-pretty text-lg text-[var(--text-secondary)]">
          No checkout, no card, and no clock on your free access. Tell us which plan and which
          prepaid period you want, and an administrator contracts it with you, then provisions
          your account.
        </p>
        <dl className="mt-8 space-y-4 text-sm">
          <div>
            <dt className="font-semibold">What happens when you send this</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">{REQUEST_DELIVERY_NOTE}</dd>
            <dd className="mt-2">
              {/* Quiet, not a second primary. This page's primary is the form's
                  own submit; a visitor who arrived here on purpose is not
                  choosing between two buttons, they are choosing between
                  finishing the form and leaving. Both words and both
                  destinations are the shared ones, so the escape hatch reads as
                  the same offer as everywhere else. */}
              <a href={APP_SIGNUP_URL} className="action inline-flex min-h-[44px] items-center" rel="noopener">
                {FREE_SIGNUP_CTA}
              </a>
              <p className="field-hint mt-1">{FREE_SIGNUP_NOTE}</p>
            </dd>
          </div>
          <div>
            <dt className="font-semibold">What happens after you are contacted</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">
              An administrator agrees the terms by email, takes payment out of band, and
              provisions your database and entitlements. We do not hold card details here.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">About the price</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">{PRICE_PLACEHOLDER_NOTE}</dd>
          </div>
          <div>
            <dt className="font-semibold">About payment and the free plan</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">{NO_CHECKOUT_NOTE}</dd>
            <dd className="mt-1 text-[var(--text-secondary)]">{FREE_PLAN_NOTE}</dd>
          </div>
        </dl>
      </div>

      <AccessRequestForm />
    </div>
  );
}