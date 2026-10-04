// Implements: docs/design/overhaul-plan.md §4.2 — the /admin operations console domain.
//
// Owner-supplied rules encoded here, authoritative for this console:
//   1. Every subscription is prepaid and contracted manually by an admin.
//   2. There is NO payment processing anywhere in this product. No card input,
//      no gateway, no charge, no invoice, no revenue figure. Amounts are not
//      modelled at all, which is why no money type appears in this file.
//   3. Admin controls backend infrastructure only. Admin never reads, renders,
//      logs or exports a tenant's business data. A tenant row is metadata.
//   4. Non-payment lifecycle: gentle reminders, then exactly one hard reminder,
//      then access removed and the account shifted to the free version, then the
//      user's data is zipped and mailed with a temporary download window.
//   5. Periods: monthly, quarterly, annual.
//
// Rules honoured: AGENTS.md §2 Rule 1 (this console has no ledger or tenant
// database accessor of any kind), Rule 2 (no outbound call anywhere), Rule 9
// (every failure typed), Rule 10 (WCAG AA, 44px targets, reduced motion).
// Copy rule R-02 from src/app/layout.tsx: no em dashes on this surface.

/** Admin actions recorded in `audit_log`. Closed union so a typo cannot ship. */
export type AdminAuditAction =
  | "admin.sign_in"
  | "admin.sign_in_denied"
  | "admin.sign_out"
  | "admin.access_request.received"
  | "admin.access_request.view"
  | "admin.access_request.state_set"
  | "admin.subscriptions.view"
  | "admin.subscription.update"
  | "admin.entitlements.view"
  | "admin.entitlement.flag_set"
  | "admin.entitlement.grant_set"
  | "admin.entitlement.downgrade"
  | "admin.exports.view"
  | "admin.export.request"
  | "admin.export.advance"
  | "admin.export.revoke"
  | "admin.reminders.view"
  | "admin.reminder.evaluated"
  | "admin.reminder.advance"
  | "admin.audit.view";

/** Reference kinds an audit row can point at. */
export type AdminRefType = "admin_session" | "access_request" | "subscription" | "entitlement" | "export_request" | "reminder" | "audit_log";

/** Plan catalogue. Prepaid only; `free` is the downgraded destination. */
export type PlanId = "free" | "solo" | "batch" | "institute";

export const PLAN_IDS: readonly PlanId[] = ["free", "solo", "batch", "institute"];

export const PLAN_LABEL: Readonly<Record<PlanId, string>> = {
  free: "Free",
  solo: "Solo tutor",
  batch: "Coaching batch",
  institute: "Institute",
};

/** Contracting term. All prepaid: no period is ever billed on a cycle. */
export type BillingPeriod = "monthly" | "quarterly" | "annual";

export const BILLING_PERIODS: readonly BillingPeriod[] = ["monthly", "quarterly", "annual"];

export const PERIOD_LABEL: Readonly<Record<BillingPeriod, string>> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** Nominal term length in days, used for the "expires soon" ordering only. */
export const PERIOD_TERM_DAYS: Readonly<Record<BillingPeriod, number>> = {
  monthly: 30,
  quarterly: 91,
  annual: 365,
};

export type SubscriptionStatus = "trialing" | "active" | "past-due" | "cancelled";

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past-due", "cancelled"];

export const SUBSCRIPTION_STATUS_LABEL: Readonly<Record<SubscriptionStatus, string>> = {
  trialing: "Trialing",
  active: "Active",
  "past-due": "Past due",
  cancelled: "Cancelled",
};

/** Product capability the plan grants access to. */
export type FeatureFlag = "web-app" | "android-app" | "ios-app" | "macos-app" | "windows-app" | "priority-support";

export const FEATURE_FLAGS: readonly FeatureFlag[] = [
  "web-app",
  "android-app",
  "ios-app",
  "macos-app",
  "windows-app",
  "priority-support",
];

export const FEATURE_FLAG_LABEL: Readonly<Record<FeatureFlag, string>> = {
  "web-app": "Web app",
  "android-app": "Android app",
  "ios-app": "iOS app",
  "macos-app": "macOS app",
  "windows-app": "Windows app",
  "priority-support": "Priority support",
};

/** Backend infrastructure grants. These are the only things admin can switch. */
export type BooleanGrant = "dbProvisioned" | "exportAllowed" | "backgroundJobsEnabled";

export const BOOLEAN_GRANTS: readonly BooleanGrant[] = ["dbProvisioned", "exportAllowed", "backgroundJobsEnabled"];

export const BOOLEAN_GRANT_LABEL: Readonly<Record<BooleanGrant, string>> = {
  dbProvisioned: "Database provisioned",
  exportAllowed: "Export allowed",
  backgroundJobsEnabled: "Background jobs",
};

export type NumericGrant = "storageQuotaMb" | "apiRateLimitPerMin";

export const NUMERIC_GRANTS: readonly NumericGrant[] = ["storageQuotaMb", "apiRateLimitPerMin"];

export const NUMERIC_GRANT_LABEL: Readonly<Record<NumericGrant, string>> = {
  storageQuotaMb: "Storage quota (MB)",
  apiRateLimitPerMin: "API rate limit (per minute)",
};

export const NUMERIC_GRANT_BOUNDS: Readonly<Record<NumericGrant, { readonly min: number; readonly max: number }>> = {
  storageQuotaMb: { min: 100, max: 1_048_576 },
  apiRateLimitPerMin: { min: 60, max: 60_000 },
};

/** Lifecycle stage of the zip-and-mail flow. */
export type ExportRequestState = "queued" | "packaging" | "mailed" | "downloaded" | "expired";

export const EXPORT_REQUEST_STATES: readonly ExportRequestState[] = ["queued", "packaging", "mailed", "downloaded", "expired"];

export const EXPORT_STATE_LABEL: Readonly<Record<ExportRequestState, string>> = {
  queued: "Queued",
  packaging: "Packaging",
  mailed: "Mailed, link live",
  downloaded: "Downloaded",
  expired: "Link expired",
};

/** Reminder ladder. `hard-sent` can only be reached once, then the tenant downgrades. */
export type ReminderStage = "none" | "gentle-sent" | "hard-sent" | "downgraded";

export const REMINDER_STAGES: readonly ReminderStage[] = ["none", "gentle-sent", "hard-sent", "downgraded"];

export const REMINDER_STAGE_LABEL: Readonly<Record<ReminderStage, string>> = {
  none: "Not started",
  "gentle-sent": "Gentle sent",
  "hard-sent": "Hard sent",
  downgraded: "Downgraded to free",
};

/** One step of the ladder, as offered to an admin. */
export type ReminderAdvance = "gentle" | "hard" | "downgrade";

export const REMINDER_ADVANCE_LABEL: Readonly<Record<ReminderAdvance, string>> = {
  gentle: "Send gentle reminder",
  hard: "Send the one hard reminder",
  downgrade: "Downgrade to free",
};

/** Notice codes a redirect may carry, so a confirmation says what happened. */
export type AdminNoticeCode =
  | "access-request-advanced"
  | "subscription-updated"
  | "entitlement-flag-set"
  | "entitlement-grant-set"
  | "entitlement-downgraded"
  | "export-requested"
  | "export-advanced"
  | "export-revoked"
  | "reminder-advanced";

/** Codes a rejected admin request may carry. Rendered as a typed error, never swallowed. */
export type AdminErrorCode =
  | "not_allowed"
  | "bad_credentials"
  | "rate_limited"
  | "unconfigured"
  | "invalid_input"
  | "not_found"
  | "conflict";

export const ADMIN_ERROR_TEXT: Readonly<Record<AdminErrorCode, { readonly title: string; readonly recovery: string }>> = {
  not_allowed: {
    title: "That identity is not on the admin allowlist.",
    recovery: "Ask the project owner to add the address to ADMIN_EMAILS, then sign in again.",
  },
  bad_credentials: {
    title: "The passphrase does not match.",
    recovery: "Check the passphrase configured in ADMIN_SIGNIN_PASSPHRASE.",
  },
  rate_limited: {
    title: "Too many failed sign-in attempts.",
    recovery: "Wait for the lock to clear before trying again.",
  },
  unconfigured: {
    title: "The admin console is not configured on this deployment.",
    recovery: "ADMIN_EMAILS, ADMIN_SESSION_SECRET and ADMIN_SIGNIN_PASSPHRASE must all be set before the console can serve a request.",
  },
  invalid_input: {
    title: "One of the values was rejected.",
    recovery: "Nothing was written. Correct the field and submit again.",
  },
  not_found: {
    title: "That record no longer exists.",
    recovery: "Reload the list and pick the row again.",
  },
  conflict: {
    title: "That change would break the lifecycle rules.",
    recovery: "The stage or state you asked for is not reachable from where this record is now.",
  },
};

export const ADMIN_NOTICE_TEXT: Readonly<Record<AdminNoticeCode, string>> = {
  "access-request-advanced": "Access request updated. The row and the actor are recorded in the audit log.",
  "subscription-updated": "Subscription updated. The row and the actor are recorded in the audit log.",
  "entitlement-flag-set": "Feature flag updated. The row and the actor are recorded in the audit log.",
  "entitlement-grant-set": "Infrastructure grant updated. The row and the actor are recorded in the audit log.",
  "entitlement-downgraded": "Account downgraded to free and an export was queued. Every write is recorded in the audit log.",
  "export-requested": "Export request queued. The engine fills the size and digest once the archive is packed.",
  "export-advanced": "Export state advanced. The row and the actor are recorded in the audit log.",
  "export-revoked": "Download link revoked. The record keeps its metadata for the audit trail.",
  "reminder-advanced": "Reminder step recorded. Enforcement is the entitlement engine's job, not the console's.",
};