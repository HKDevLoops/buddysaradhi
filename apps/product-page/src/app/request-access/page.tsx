// Implements: docs/design/overhaul-plan.md §4.1 (`/request-access`). This is an
// ACCESS REQUEST, not a checkout: the product is sold manually and an
// administrator provisions access after contracting the plan
// (docs/design/overhaul-plan.md §0 and §4.2). The endpoint it posts to is the
// stub at src/app/api/access-request/route.ts; delivery to an administrator is
// follow-up work.

import { AccessRequestForm } from "./access-request-form";
import { NO_CHECKOUT_NOTE, PRICE_PLACEHOLDER_NOTE } from "@/lib/access-request";

export const metadata = {
  title: "Request access. BuddySaradhi.",
  description:
    "Request BuddySaradhi access. Tell us the plan and prepaid period you want, an administrator contracts it with you and provisions your account. Nothing is charged on this page.",
};

export default function RequestAccessPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <h1 className="font-display text-3xl font-bold text-balance md:text-5xl">
          Request access.
        </h1>
        <p className="mt-5 max-w-[56ch] text-pretty text-lg text-[var(--text-secondary)]">
          No checkout, no card, no trial clock. Tell us which plan and which prepaid period you
          want, and an administrator contracts it with you, then provisions your account.
        </p>
        <dl className="mt-8 space-y-4 text-sm">
          <div>
            <dt className="font-semibold">What happens next</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">
              An administrator replies by email to agree the terms, takes payment out of band, and
              provisions your database and entitlements. We do not hold card details here.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">About the price</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">{PRICE_PLACEHOLDER_NOTE}</dd>
          </div>
          <div>
            <dt className="font-semibold">About payment</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">{NO_CHECKOUT_NOTE}</dd>
          </div>
        </dl>
      </div>

      <AccessRequestForm />
    </div>
  );
}