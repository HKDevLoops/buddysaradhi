// Implements: docs/design/overhaul-plan.md §4.1 (front door: an access REQUEST,
// never a checkout) + §4.2 (admin-managed subscriptions: plan, period, status).
// Single source of truth for the plan catalogue, shared by /pricing and
// /request-access, so the two routes can never disagree.
//
// Payments are NOT processed anywhere on this surface. An administrator
// contracts the subscription and provisions access by hand
// (docs/design/overhaul-plan.md §0, "Product-page role").
//
// Validation is hand-rolled, typed, and dependency-free: `zod` is not
// resolvable from this app's node_modules and adding it would require a root
// lockfile change, which is outside this task's scope. The shape below is the
// `Result<T, E>` convention AGENTS.md §6.4 requires of every input boundary.

export const PLANS = ["free", "institute"] as const;
export type PlanId = (typeof PLANS)[number];

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
    audience: "A coaching institute with staff to account for.",
    summary:
      "Contracted with you directly, so the plan can cover multi-tutor administration and institute-wide reporting.",
    includes: [
      "Everything in Free",
      "Multi-tutor administration and institute-wide reporting",
      "Provisioned storage quota and data export on request",
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
  "There is no checkout on this site. Request access, we contract the plan, then an administrator provisions your account.";

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

/** What the stub endpoint returns on acceptance. `delivery` names the pipe the
 *  request actually went down, so the UI never implies a delivery that has not
 *  been built (AGENTS.md Rule 9: no silent failures). */
export interface AccessRequestReceipt {
  readonly reference: string;
  readonly receivedAt: string;
  readonly delivery: "stub";
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