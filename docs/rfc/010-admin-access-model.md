# RFC 010 — Admin Access Model: Metadata Only, Books Stay Tutor-Only

**Status:** Draft — Awaiting Principle Amendment (AGENTS.md §2 Rule 4 / §8)
**Author:** build (space-bunny)
**Created:** 2026-10-09
**Spec Owners:** Orchestrator, Security Owner, DPO
**Related Specs:** `01_Product_Principles.md` (P1, P10, AP-10), `10_Security.md` §3/§15/§17/§18, `11_Data_Model.md`, `13_UI_Guidelines.md` §8 (Settings → Diagnostics), DPDP Act 2025

---

## 1. Problem Statement

The product has **no admin role today.** There is no `role` column, no admin console in the web app, and no cross-tenant query surface. That is a clean position and it is worth stating plainly before adding anything.

Two facts make the question live:

1. **The owner directive (2026-10-09)** asks for "guard rails and total isolations to user to user database. as only admin has access to it."
2. **A real gap already exists** that an admin role would otherwise be the wrong fix for: `POST /api/v1/security/erase` on the edge is gated on a tutor's PIN **existing**, never its value.

### 1.1 The concrete hole, stated precisely

`apps/gateway/routes/security.ts:52-157`. The route is genuinely well-defended on every other axis:

| Gate | Line | Status |
|---|---|---|
| `tutorId !== tenantId` → 400 | `:65-67` | correct |
| per-tenant 5/15-minute rate limit | `:74` | correct |
| literal `ERASE` confirmation | `:68` | correct |
| refuses when no PIN exists | `:91-98` | correct |
| `erase_initiated` audit row written *before* destruction, uncaught so a failure aborts the wipe | `:112` | correct |

The gap is in the last gate. The edge **cannot verify an argon2id hash** — verification requires the expensive KDF, and doing it per request at the edge would be a denial-of-service surface against the tutor's own security control. So the edge checks *"a PIN is configured"* and stops.

The consequence: **a stolen session against any PIN-having tenant can wipe that tenant's entire books** with no PIN, no ladder, no failed-attempt audit. The comment at `:41-51` declares this gap itself. It is an honest self-declaration, not an oversight — but it is a hole.

**This is the finding to fix first, and it does not require an admin role at all.**

---

## 2. Decision (owner, 2026-10-09)

> **Metadata-only admin. Books stay tutor-only.**

An administrator may read **operational metadata** and **audit trails**. An administrator may **never** read a tutor's financial records — ledger entries, invoices, receipts, balances, fee plans — nor student PII.

### 2.1 What "metadata" means, precisely

| Reachable by admin | **Never** reachable by admin |
|---|---|
| `tenant_id`, signup timestamp, account status | `ledger_entries` (any column) |
| Plan / billing state | `invoices`, `receipts`, `balances_paise` |
| Last-seen timestamp, app version, platform | `students` names, phones, emails, guardians |
| **Counted** aggregates only — row counts per table | `fee_plans`, `fee_schedule_items` amounts |
| `audit_log` (actions, actors, timestamps) | Any `.buddysaradhi` backup contents |
| Rate-limit / lockout state | `settings.pin_hash`, `tenant_secret` |

The rule of thumb: **an admin may learn that a tutor exists and that their books are internally consistent. An admin may not learn what is in the books.**

`audit_log` is reachable because it is the accountability surface — an admin who cannot read it cannot be audited, and DPDP 2025 §8(5) requires demonstrable, tamper-evident processing records. Note that audit rows already carry `metadata` payloads; those must be scrubbed of PII before admin exposure (see §4.3).

---

## 3. Why not full access

An admin who can read the ledger is reading a tutor's **clients'** personal data. That expands the breach blast radius from "one tutor's device" to "the operator plus every tutor", and it creates a standing obligation under DPDP 2025 that this product is not currently structured to meet — data-subject request handling, purpose limitation, and retention all become multi-party.

The operational need that motivates full access — *"is this tutor's account broken?"* — is **already served** by counted aggregates and `audit_log`. The tutor's own words about their books are available through support, with their consent, per-incident.

---

## 4. Proposed Change

### 4.1 First, and separately: close the erase gap (no admin role needed)

Ranked by exploitability, this is the highest-value item in this RFC and it is **independent of §2**.

- **Preferred:** move account erase off the edge entirely. Route it exclusively through `apps/web/src/server/actions/settings.ts` `deleteAccountAction`, which already verifies the PIN in-process with argon2id and `verifyPinWithLadder`. The edge endpoint is retired.
- **Fallback if an edge path must survive:** a server-side PIN *proof* — an HMAC over the PIN keyed by `GATEWAY_SHARED_SECRET`, produced by the web app and presented to the edge. This is weaker (a replayable bearer token rather than a password check) and needs its own review.

**Recommendation: retire the edge endpoint.** It exists because the web path could not verify argon2id at the time; that constraint no longer applies.

### 4.2 The admin role itself

- **No `role` column on the tenant.** An admin is an **operator**, not a tutor with extra rights. Operator identity lives outside the tenant database entirely — Supabase Auth, a separate admin project or a reserved claim — so there is no per-tenant row that could grant or escalate it.
- **Admin read paths are separate builders**, physically unable to reach the forbidden tables. Not "a flag on the existing ORM" — a distinct, allowlisted statement set. `apps/gateway/lib/sql.ts` already has the pattern to copy: a frozen table allowlist plus `ColumnRefSchema` identifier auditing.
- **Every admin read writes an `audit_log` row naming the admin principal, the tenant read, and the justification.** Admin access is *more* logged than tutor access, not less.
- **The admin sees nothing by default.** A list of tenants with counts. Drilling into a tenant is an explicit, audited act.

### 4.3 PII scrubbing is a precondition

`audit_log.metadata` currently carries JSON payloads written by the actions. Before any admin surface exists, `metadata` must be run through a scrubber that strips the fields the credential audit found leaking (`instituteEmail` at `settings.ts:845` is one live example). **Exposing `audit_log` to admins before this exists would widen a known leak.**

---

## 5. Where the Admin Surface Lives

`13_UI_Guidelines.md` §8 **Settings → Diagnostics** is inside the five-screen rule (AGENTS.md §2 Rule 4), and a sixth admin screen is prohibited. Two options:

| Option | Shape |
|---|---|
| **A (recommended)** | No admin UI in the web app. The admin surface is an operator tool outside `apps/web`, so P2 is not engaged at all. |
| **B** | A Diagnostics section that renders only when the operator is authenticated, inside the existing Settings screen. Requires a P2 amendment. |

Option A avoids spending a principle amendment on a screen. Choose B only if the owner wants the operator surface inside the product.

---

## 6. Test Gate

1. **The erase hole is closed and proven.** A test asserts an edge-originated erase without a valid PIN proof destroys **nothing**, and that the web path still refuses a wrong PIN (existing `settings-account-erase.test.ts` covers the web half).
2. **Admin reachability matrix.** A test enumerates every table and asserts the admin statement set **cannot** be constructed against `ledger_entries`, `invoices`, `receipts`, `fee_plans`, `students`, `guardians` — a compile- or shape-level assertion, not a hand-written allowlist test that can drift.
3. **Admin reads are audited.** Every admin read produces an `audit_log` row; a test asserts the row exists and names the principal.
4. **`audit_log.metadata` is PII-free** before any admin surface ships.
5. No-regression: full suites, `lint:principles` 7/7, `tsc --noEmit` 0, `next build` green.

---

## 7. Spec Sections Amended on Ratification

| Section | Change |
|---|---|
| `01_Product_Principles.md` | a new principle constraining operator reach (P16 or an amendment to P10 sovereign privacy) |
| `10_Security.md` | new §19 "Operator access"; the erase cascade's auth gate restated |
| `11_Data_Model.md` | admin principals are **not** tenant data; the opt-out table from RFC 009 gains `admin_users` |
| `13_UI_Guidelines.md` §8 | Diagnostics gains the operator section **if** option B is chosen |

---

## 8. Recommendation

1. **Close the erase hole first** (§4.1). It is exploitable today with a stolen session, it needs no new role, and it is a deletion rather than a build.
2. **Scrub `audit_log.metadata`** (§4.3) before anything else touches admin reads.
3. **Then decide whether an admin role is needed at all.** Option A plus counted aggregates plus `audit_log` may already cover the operational need — in which case the cheapest outcome is that §2 ratifies a *constraint* ("no operator may read books") rather than authorising a role.

---

## 9. Open Questions for the Owner

1. Is there a **concrete operational need** for a cross-tenant surface today, or is this pre-emptive? If pre-emptive, ratifying the prohibition without building the role is a valid and cheaper outcome.
2. Should the admin surface be **option A** (outside `apps/web`, no P2 amendment) or **option B** (inside Settings)?
3. Does **§4.1 preferred** (retire the edge erase endpoint) have any deployment dependency I have not seen?