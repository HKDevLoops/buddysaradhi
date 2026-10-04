// Implements: docs/design/overhaul-plan.md §4.1 (front door: an access REQUEST,
// never a checkout) + §4.2 (admin-managed subscriptions: plan, period, status).
// Single source of truth for the plan catalogue, shared by /pricing and
// /request-access, so the two routes can never disagree.
//
// Payments are NOT processed anywhere on this surface. An administrator
// contracts the subscription and provisions access by hand
// (docs/design/overhaul-plan.md §0, "Product-page role").
//
// HONESTY CONTRACT (docs/design/marketing-claims-audit.md). Every string in this
// file is copy a visitor reads, so every string here is a claim. A capability may
// only be named if some primary source in this repo builds it. The Institute plan
// therefore does NOT advertise staff accounts or multi-tutor administration: the
// `tutors` table exists (prisma/schema.prisma:67) but nothing creates a tutor but
// you (no `db.tutor.*` call anywhere in apps/web/src), the Team surface is a
// roadmap item behind a P2 amendment (15_Future_Roadmap.md:503), and paid
// multi-tutor tiers are gated behind a trigger that has not fired
// (product/01_Product_Positioning.md:70). Do not add one without the code.
//
// Validation is hand-rolled, typed, and dependency-free: `zod` is not
// resolvable from this app's node_modules and adding it would require a root
// lockfile change, which is outside this task's scope. The shape below is the
// `Result<T, E>` convention AGENTS.md §6.4 requires of every input boundary.

export const PLANS = ["free", "institute"] as const;
export type PlanId = (typeof PLANS)[number];

/* ------------------------------------------------------------------------- *
 * ORIGIN OWNERSHIP
 *
 * `APP_ORIGIN` is the ONE owner of the signed-in app's origin for this whole
 * app. `app/layout.tsx` used to hold a second, byte-identical literal for its
 * footer link, which means the sign-in link and the sign-up link could each be
 * "correct" while pointing at different hosts after a rename — and neither
 * build nor tsc fails on a wrong host, it just ships a dead link
 * (AGENTS.md §15 FM-06).
 *
 * Provenance, and it is not a guess: `https://buddysaradhi.vercel.app` is the
 * app's own committed default, declared in apps/web/src/proxy.ts:17
 * (`NEXT_PUBLIC_APP_URL`), allowlisted as an origin in the same file at :23,
 * and repeated in apps/web/src/app/api/v1/[...slug]/route.ts:323. The signed-in
 * app lives on its own deployment target, separate from this marketing surface
 * (AGENTS.md §2 Rule 11).
 * ------------------------------------------------------------------------- */
export const APP_ORIGIN = "https://buddysaradhi.vercel.app";
export const APP_LOGIN_URL = `${APP_ORIGIN}/login`;
export const APP_SIGNUP_URL = `${APP_ORIGIN}/signup`;

/* ------------------------------------------------------------------------- *
 * FUNNEL COPY
 *
 * One primary action per viewport, and one label for it everywhere
 * (clarify.md: keep the same noun and verb for the same concept throughout the
 * product). These strings are shared so `/`, `/pricing`, `/platforms`, the hero
 * panel and the request form cannot drift into five different promises.
 *
 * WHY SIGN-UP IS THE PRIMARY (docs/design/marketing-claims-audit.md §4.1,
 * option (b)). `POST /api/access-request` validates, persists the request to
 * the console store and returns a receipt; mail delivery to a person is not
 * connected (src/app/api/access-request/route.ts, src/app/admin/_lib/
 * access-requests.ts). Free self-serve sign-up is therefore the only path on
 * this surface that completes immediately, so it is the only action a
 * first-time visitor should be asked to take first. The contracted plan stays
 * available and stays honest about what it does.
 * ------------------------------------------------------------------------- */

/** Primary. A specific verb and an object, because the outcome is the point:
 *  the visitor leaves this site and ends up with a working tutor account. */
export const FREE_SIGNUP_CTA = "Create your free account";

/** The honest sentence beside the primary. A cross-origin link must say where it
 *  goes, and the two facts that decide the click (free, no card) are here rather
 *  than in a button that has no room for them. */
export const FREE_SIGNUP_NOTE =
  "Takes you to the BuddySaradhi app to create your account. Free while our infrastructure stays free, and no card is asked for.";

/** Secondary. Names what the visitor gets, not the page it opens. */
export const CONTRACTED_PLAN_CTA = "Ask for a contracted plan";

export const BILLING_PERIODS = ["monthly", "quarterly", "annual"] as const;
export type BillingPeriodId = (typeof BILLING_PERIODS)[number];

export interface PlanDefinition {
  readonly id: PlanId;
  readonly name: string;
  readonly audience: string;
  readonly summary: string;
  readonly includes: readonly string[];
  /** "free-policy" is the site's own published statement; "on-request" is a
   *  deliberately unpriced cell pending the owner's replacement list. */
  readonly pricing: "free-policy" | "on-request";
}

export const PLAN_CATALOGUE: readonly PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    audience: "One tutor, one institute, self-serve.",
    summary:
      "Free for everyone while our infrastructure stays free. Sign up yourself and start on the web app.",
    includes: [
      "Five screens and all seven engines",
      "Your own encrypted database, offline first",
      "Ledger and backups, no feature gate",
    ],
    pricing: "free-policy",
  },
  {
    id: "institute",
    name: "Institute",
    audience: "An institute that wants the term, the storage and the export terms agreed up front.",
    summary:
      "Contracted with you directly, so the prepaid period, the storage quota and the export terms can be written down before you start rather than argued about later.",
    includes: [
      "Everything in Free, with no feature gate",
      "A stated storage quota and data export on request",
      "Staff accounts, not built yet",
    ],
    pricing: "on-request",
  },
] as const;

export const BILLING_PERIOD_LABEL: Readonly<Record<BillingPeriodId, string>> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

export const PREPAID_NOTE =
  "Every paid period is prepaid. We agree the period with you, take payment out of band, and provision access once it is in place.";

export const PRICE_PLACEHOLDER_NOTE =
  "Paid plan prices are not published here. We confirm them when we contract a plan with you. Nothing is charged on this site.";

export const NO_CHECKOUT_NOTE =
  "There is no checkout on this site and no card is ever asked for. A contracted plan is agreed with you directly, and an administrator provisions your account.";

/**
 * What is true about delivery today, in the words the request page uses.
 *
 * The pipeline a request will travel (entitlements-contract.md §2) is
 * persisted: the endpoint in `src/app/api/access-request/route.ts` validates
 * the request, stores it in the console store
 * (`src/app/admin/_lib/access-requests.ts`) and returns a receipt, and an
 * administrator reads it in the console. What is NOT connected is mail
 * delivery to a person, so the surface may promise the *record* and must not
 * promise the *email* (AGENTS.md Rule 9). This string is the honest statement,
 * and it names the path that works right now so the reader is never left
 * without an action.
 */
export const REQUEST_DELIVERY_NOTE =
  "We record your request with a reference and an administrator reads it in the operations console. Delivering it to a person by email is not connected yet, so until it is, the free plan is the way in today.";

/** The free plan never expires or downgrades, so nothing runs out under the tutor. */
export const FREE_PLAN_NOTE =
  "No checkout, no card, and no clock on your free access. Free stays free, and your access does not lower.";

export interface AccessRequestInput {
  readonly name: string;
  readonly email: string;
  readonly instituteName: string;
  readonly plan: PlanId;
  readonly billingPeriod: BillingPeriodId | null;
  readonly note: string;
}

export type AccessRequestField = keyof AccessRequestInput;

export type AccessRequestErrors = Partial<Record<AccessRequestField, string>>;

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

const MAX_NAME = 80;
const MAX_INSTITUTE = 120;
const MAX_EMAIL = 254;
const MAX_NOTE = 1000;

/** Control characters are never legitimate in a name; they break logs and mail. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function isPlanId(value: string): value is PlanId {
  return (PLANS as readonly string[]).includes(value);
}

function isBillingPeriodId(value: string): value is BillingPeriodId {
  return (BILLING_PERIODS as readonly string[]).includes(value);
}

function checkText(
  raw: string,
  field: "name" | "instituteName",
  label: string,
  max: number,
  errors: AccessRequestErrors,
): string {
  const value = raw.trim();
  if (value.length === 0) {
    errors[field] = `${label} is required.`;
    return "";
  }
  if (CONTROL_CHARS.test(value)) {
    errors[field] = `${label} contains characters we cannot read.`;
    return value;
  }
  if (value.length < 2) {
    errors[field] = `${label} needs at least 2 characters.`;
    return value;
  }
  if (value.length > max) {
    errors[field] = `${label} is longer than ${max} characters.`;
  }
  return value;
}

/**
 * Validates an untrusted access request. Unknown keys are dropped rather than
 * rejected: the caller decides what a request contains, and silently ignoring
 * the rest is safer than spreading a body into state.
 */
export function validateAccessRequest(raw: unknown): Result<AccessRequestInput, AccessRequestErrors> {
  const errors: AccessRequestErrors = {};

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: { note: "Send the request as a JSON object." } };
  }
  const body: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  const name = checkText(typeof body.name === "string" ? body.name : "", "name", "Your name", MAX_NAME, errors);
  const instituteName = checkText(
    typeof body.instituteName === "string" ? body.instituteName : "",
    "instituteName",
    "Institute name",
    MAX_INSTITUTE,
    errors,
  );

  const email = (typeof body.email === "string" ? body.email : "").trim();
  if (email.length === 0) {
    errors.email = "Email is required, it is how we reply.";
  } else if (email.length > MAX_EMAIL) {
    errors.email = `Email is longer than ${MAX_EMAIL} characters.`;
  } else if (CONTROL_CHARS.test(email) || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    errors.email = "Enter an email address we can reply to.";
  }

  const planRaw = typeof body.plan === "string" ? body.plan : "";
  if (!isPlanId(planRaw)) {
    errors.plan = "Choose a plan.";
  }

  const periodRaw = typeof body.billingPeriod === "string" ? body.billingPeriod : "";
  let billingPeriod: BillingPeriodId | null = null;
  if (periodRaw.length > 0) {
    if (!isBillingPeriodId(periodRaw)) {
      errors.billingPeriod = "Choose a billing period.";
    } else {
      billingPeriod = periodRaw;
    }
  }
  // A billing period only means something on a contracted plan.
  if (isPlanId(planRaw) && planRaw !== "free" && billingPeriod === null) {
    errors.billingPeriod = "Choose how often you want to pay for.";
  }
  if (planRaw === "free") {
    billingPeriod = null;
  }

  let note = "";
  if (typeof body.note === "string") {
    note = body.note.trim();
    if (note.length > MAX_NOTE) {
      errors.note = `Note is longer than ${MAX_NOTE} characters.`;
    }
  } else if (body.note !== undefined) {
    errors.note = "Note must be text.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, error: errors };
  }
  return {
    ok: true,
    value: { name, email, instituteName, plan: planRaw as PlanId, billingPeriod, note },
  };
}

/** What the console-backed endpoint returns on acceptance. `delivery` names the
 *  pipe the request actually went down, so the UI never implies a delivery that
 *  has not been built (AGENTS.md Rule 9: no silent failures). `console` means:
 *  validated, persisted to the access-request store, readable by the owner in
 *  the console; mail delivery to a person is still not connected. */
export interface AccessRequestReceipt {
  readonly reference: string;
  readonly receivedAt: string;
  readonly delivery: "console";
}

export type AccessRequestResponse =
  | { readonly ok: true; readonly receipt: AccessRequestReceipt }
  | { readonly ok: false; readonly errors: AccessRequestErrors };

export function planDefinition(id: PlanId): PlanDefinition {
  const found = PLAN_CATALOGUE.find((p) => p.id === id);
  // SAFETY: PLAN_CATALOGUE is a const tuple covering exactly the PlanId union,
  // so the lookup cannot miss. Throw rather than return a fabricated plan.
  if (!found) throw new Error(`PLAN_CATALOGUE is missing plan "${id}"`);
  return found;
}