# Admin Console — model, security, and the backend contract

> Implements: `docs/design/overhaul-plan.md` §4.2. Owner directive 2026-10-02.
> Code: `apps/product-page/src/app/admin/**`.
> Status: UI + auth + audit scaffolding shipped. The entitlement ENGINE (scheduled
> reminders, zip packaging, mail delivery, downgrade enforcement) is specified in
> [`entitlements-contract.md`](./entitlements-contract.md) and is NOT implemented.

---

## 1. What the console is for

This product has **no payment processing**. Every subscription is prepaid and
contracted manually: a tutor requests access on `/request-access`, an admin
contracts a plan, and access is granted. The console is where that contract is
recorded and where access is controlled. It is an operations tool, not a
commerce UI — there is no card field, no charge, no payment provider anywhere.

## 2. The one hard boundary

> **An admin can control infrastructure. An admin cannot read a customer's data.**

The console renders metadata only: tenant id, plan, status, period, dates,
contact email, entitlement flags, export metadata. It never reads, renders, logs
or exports a tenant's business rows, and there is no code path from an admin
screen to tenant content. Export requests expose **filename, byte size, SHA-256,
expiry and state** — never the artefact.

This is a DPDP-2025 posture as much as a product one: the customer holds their
own data, and an operator who can silently read a tutor's student roster is a
different and much larger product than the one being sold.

## 3. Auth model

| Property | Decision |
|---|---|
| Identity | `ADMIN_EMAILS` env allowlist, comma-separated |
| Session | HMAC-signed cookie: identity + issued-at + expiry, `httpOnly`, `secure`, `SameSite=Lax` |
| Verification | Stateless — HMAC over the payload with `ADMIN_SESSION_SECRET`; no session store, no DB read |
| Expiry | `ADMIN_SESSION_TTL_HOURS` (default 8h), absolute — no sliding window |
| Fail-closed | No `ADMIN_EMAILS` or no `ADMIN_SESSION_SECRET` ⇒ every admin route returns 503 with a typed error. Never a bypass, never a dev fallback |
| Audit | Sign-in, sign-out, every list read and every mutation write an `audit_log` row |

There is no client-side gate. The console is server components behind the guard,
and it ships **zero client JavaScript** — every control is a real link, a real form
or a real input, so the whole thing is keyboard-operable by construction.

## 4. Domain model

```
PlanId          free | solo | batch | institute         (ids are placeholders)
BillingPeriod   monthly (30d) | quarterly (90d) | annual (365d)
Status          trialing | active | past-due | cancelled
FeatureFlag     web-app | android-app | ios-app | macos-app | windows-app | priority-support
BooleanGrant    dbProvisioned | exportAllowed | backgroundJobsEnabled
NumericGrant    storageQuotaMb | apiRateLimitPerMin        (bounded, see types.ts)
ExportRequest   queued → packaging → mailed → downloaded → expired
ReminderStage   none → gentle-sent → hard-sent → downgraded   (forward only, one step)
```

The reminder ladder is the non-payment lifecycle the owner specified: gentle
reminder, then **exactly one** hard reminder, then access removed and the account
shifted to the free version, with the tutor's data zipped and mailed to them with
a temporary download window. The ladder only moves forward and one step at a
time; `isAdvanceLegal` in `_lib/reminders.ts` is the gate.

## 5. Backend contract this console expects

The repositories in `_lib/` are an interface with a seeded in-memory
implementation. A real entitlement service replaces the implementation, not the UI.

```ts
interface SubscriptionRepository {
  list(filter: { status?: SubscriptionStatus[]; plan?: PlanId[]; expiringWithinDays?: number }): Promise<Subscription[]>;
  get(tenantId: string): Promise<Subscription | null>;
  create(input: NewSubscription): Promise<Subscription>;
  update(tenantId: string, patch: SubscriptionPatch): Promise<Subscription>;   // audited
}

interface EntitlementRepository {
  read(tenantId: string): Promise<Entitlements>;
  write(tenantId: string, patch: EntitlementPatch): Promise<Entitlements>;      // audited
}

interface ExportRepository {
  list(): Promise<ExportRequest[]>;
  request(tenantId: string, requestedBy: string): Promise<ExportRequest>;      // audited
  advance(id: string, state: ExportRequestState): Promise<ExportRequest>;       // audited
}

interface ReminderRepository {
  due(nowIso: string): Promise<ReminderRow[]>;
  advance(tenantId: string, to: ReminderAdvance, nowIso: string): Promise<ReminderRow>; // audited
}
```

### Fields the backend must own

```ts
type Subscription = {
  tenantId: string;              // the tutor
  plan: PlanId;
  period: BillingPeriod | null;  // null only for free
  status: SubscriptionStatus;
  startsAt: string;              // ISO-8601
  expiresAt: string;             // ISO-8601, prepaid boundary
  contactEmail: string;
  reminderStage: ReminderStage;
  notes: string;                 // admin-visible only, never returned to the app
};

type Entitlements = {
  features: Record<FeatureFlag, boolean>;
  grants: Record<BooleanGrant, boolean>;
  limits: Record<NumericGrant, number>;
};
```

### Invariants the backend must enforce (and the UI cannot)

1. `expiresAt` is derived from `startsAt` + `period` and is never hand-editable.
   All plans are prepaid, so there is no proration path.
2. A downgrade to `free` revokes `dbProvisioned`, `exportAllowed` and
   `backgroundJobsEnabled` in the SAME transaction that writes the new status, and
   it queues an export request. All three, or none (Rule 7 discipline applied to
   entitlements).
3. The export artefact is produced by a background job with a hard expiry, is
   never written inside the console's request path, and is delivered by a signed,
   time-limited link. The console records only the metadata.
4. Reminder sends are idempotent per stage — re-running the job must not send a
   second gentle reminder. The stage field is the idempotency key.
5. Every mutation carries the acting admin identity from the session, never from
   the request body.

## 6. What this pass does NOT include

- No payment processing (by design — manual contracting).
- No scheduled reminder execution, zip packaging, mail delivery or downgrade
  enforcement: those are the engine in
  [`entitlements-contract.md`](./entitlements-contract.md).
- The `/api/access-request` endpoint behind `/request-access` is a validating stub;
  delivery to an administrator is part of the same contract.
- Prices and plan names are placeholders the owner must set.