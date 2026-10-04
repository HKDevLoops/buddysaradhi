# Entitlements contract — the engine behind the admin console

> Implements: `docs/design/overhaul-plan.md` §4.2 + §4.1. Owner directive
> 2026-10-02. UI: `apps/product-page/src/app/admin/**` (see
> [`admin-console.md`](./admin-console.md)). This file specifies the **engine**.
>
> **Status: partially implemented in the product-page console.** The
> access-request store (persistence, per-IP + per-email rate limiting,
> no-enumeration response, audit), the reminder dry-run evaluation, the export
> metadata transitions, and the downgrade flag-flip + audit are built
> (`apps/product-page/src/app/admin/_lib/`). Mail sending, scheduled execution,
> and artefact bytes remain specified-only, and the §8#1 security review still
> owns those before they ship.

---

## 0. Why this exists

The product page is the front door: a tutor requests access, an admin contracts a
plan manually, and access is granted. Payments are not processed. That makes the
*entitlement* the load-bearing object, not a payment record — and it makes the
non-payment lifecycle (reminders → downgrade → data return) the part of the system
most likely to be got wrong, because it touches a user's own data at exactly the
moment they are unhappy.

## 1. Actors and trust boundaries

| Actor | Can | Cannot |
|---|---|---|
| Visitor | Submit an access request | See any tenant, plan or price |
| Tutor (signed in) | Read their own subscription state and export window | Change their own plan or entitlement |
| Admin | Read metadata, write entitlements, advance reminder + export state | Read a tenant's business data |
| Engine (background) | Produce an export artefact, send mail, enforce expiry | Read tenant content into any operator-visible surface |

## 2. The access-request → access pipeline

```
POST /api/access-request          (product page: validated, rate-limited,
                                   persisted to the console store; mail
                                   delivery to a person not connected)
        │  rate-limited per IP + per email, audited
        ▼
access_request (state: new → contacted → contracted | declined)
        │  admin contracts a plan in the console
        ▼
subscription (status: trialing)  +  entitlements (all flags false)
        │  provisioner creates the tenant database
        ▼
entitlements.dbProvisioned = true      ← the web app's DB_NOT_PROVISIONED /
                                         NEEDS_PROVISION states resolve here
```

**Rule:** the web app must never learn a plan it was not granted. It reads
`settings.plan`, which is server-managed and in the client write-denylist.

## 3. The non-payment lifecycle (the owner-specified ladder)

```
                 expiry passes
  active ─────────────────────────────► past-due
                                          │
                        ┌─────────────────┴─────────────────┐
                        │ stage: none                       │ stage: gentle-sent
                        ▼                                   ▼
                 gentle reminder                        hard reminder (EXACTLY ONE)
                 stage = gentle-sent                    stage = hard-sent
                        │                                   │
                        └─────────────────┬─────────────────┘
                                          ▼
                             downgrade to free (stage = downgraded)
                                          │
                    ┌─────────────────────┴──────────────────────┐
                    ▼                                            ▼
        revoke dbProvisioned /                        queue export request
        exportAllowed / jobs                           (zip + mail + expiry)
                    └─────────────────────┬──────────────────────┘
                                          ▼
                        export_request: queued → packaging → mailed → expired
```

### Invariants

1. **The ladder is forward-only and one step at a time.** `gentle → hard` is legal;
   `hard → gentle` is not. Re-running a tick must be a no-op (the stage is the
   idempotency key).
2. **Exactly one hard reminder per subscription term.** A new prepaid period resets
   the stage to `none`; it does not continue the old ladder.
3. **The downgrade is atomic** with the entitlement revocation and the export
   request. A tutor must never be downgraded-but-still-provisioned, or
   provisioned-but-without-their-data.
4. **The export window is temporary and visible.** The tutor sees their remaining
   download time in the app. The link is signed, single-tenant, and expires.
5. **No operator sees tenant content** at any step, including inside a failure.
   Errors reference the export id, never the row.

## 4. What "zipped and mailed" must mean precisely

- The artefact is the tenant's own encrypted backup in the `.buddysaradhi`
  envelope (AES-256-GCM, Argon2id — `09_Backup_and_Import_Export.md` §11,
  `10_Security.md` §15). It is the same artefact `09_Backup…` produces; the
  engine does not invent a second export format.
- It is produced by a background job outside any request path, with a bounded
  lifetime. If packaging fails, the failure is audited with the export id and no
  content.
- The engine records: filename, byte size, SHA-256, created-at, expires-at,
  state. That record is all the console renders.
- Delivery is a signed link with a hard expiry. When it expires the artefact is
  deleted. There is no re-send without a new, audited request.

## 5. Scheduling

| Job | Cadence | Idempotency key |
|---|---|---|
| Reminder tick | daily | `(tenant_id, period_start, stage)` |
| Expiry enforcement | daily | `(tenant_id, expires_at)` |
| Export packaging | on request, queued | `export_request.id` |
| Export expiry sweep | hourly | `export_request.id` |

All four are safe to run twice. None of them takes a tenant lock that a user
session could deadlock against; the entitlement write is a single-row CAS on
`expires_at`.

## 6. Security requirements (for the §8#1 review)

1. Every state transition is an `audit_log` row with the acting identity — the
   engine's service identity for scheduled work, never `system`-with-no-actor.
2. The admin session HMAC secret is separate from every other secret in the repo;
   rotating it must not require a redeploy of the app tier.
3. Access requests are rate limited per IP and per email, and the response never
   reveals whether an email is already known (no enumeration).
4. Entitlement writes are CAS-guarded so a concurrent admin edit and a scheduled
   downgrade cannot silently overwrite each other; the loser re-reads and retries
   or reports a conflict.
5. Export links are single-tenant, time-limited, and invalidated on downgrade
   completion.

## 7. Open decisions for the owner

1. **Plan ids and names** (`free` / `solo` / `batch` / `institute`) are
   placeholders. Real names and prices are needed before `/pricing` ships.
2. **The free tier's limits** — `storageQuotaMb` and `apiRateLimitPerMin` bounds
   are placeholders in `types.ts`.
3. **Grace period** between the hard reminder and the downgrade. The ladder in the
   console is explicit admin action; a scheduled version needs a decided delay.
4. **Whether a downgraded tutor's database is retained or deleted**, and for how
   long. The spec currently says returned to the tutor, not deleted — which is the
   DPDP-friendly reading, but it is a storage cost the owner should accept
   knowingly.
5. **Who may be an admin** — the `ADMIN_EMAILS` allowlist is the whole model
   today. If more than one admin is needed, per-admin attribution already exists in
   the audit log, so this is a matter of process rather than schema.