# Roadmap — Buddysaradhi

> **Sequencing artifact.** The product and engineering specification is the corpus
> at the repo root (`AGENTS.md` + `00_`–`23_*.md`) and remains canonical. This file
> does not define behaviour — it sequences work *against* those documents, and every
> phase below links the spec files it is bound by. Where this roadmap and the corpus
> disagree, **the corpus wins** and this file is corrected.

**Generated:** 2026-10-10 · **Mode:** interactive · **Granularity:** fine
**Platform:** WEB is the only In-Flight platform (`AGENTS.md` §9.3) — no phase here
touches `apps/mobile`, `apps/desktop` or `apps/product-page`.

---

## Ordering rationale

Phase 1 is first not because it is the most severe finding, but because it is
**load-bearing for the other five**. Three specs — `21_Redis_Caching_Layer.md`,
`22_Vector_Search_System.md`, `23_Complexity_Guarantees.md` — cannot be planned
until their phase numbers stop colliding with ratified ones. Notably,
`22_Redundancy_Audit.md` — the document whose entire job is catching exactly this
class of duplication — does not list the collision in its own map.

Phase 3 and Phase 4 are **one-way doors** and are marked accordingly. Both require
human sign-off before implementation (`AGENTS.md` §8).

---

## Phase map

| # | Phase | Goal | Requirements | Spec files |
|---|-------|------|--------------|------------|
| 1 | Specification & documentation integrity | Spec numbers stop colliding; behaviour changes are documented where developers look | DOC-SPEC-07, OPS-DEVAUTH-11 | `AGENTS.md`, `22_Redundancy_Audit.md` |
| 2 | Supply chain & secret hygiene | Every CI action pinned; no committed credentials; leaked credential rotated | CI-SUPPLY-05, SEC-CRED-06, SEC-TOKEN-02 | `23_Security_Harness_Plan.md`, `deployment/05_CI_CD_GitHub_Actions.md` |
| 3 | Cryptographic key separation | PIN pepper, data key and HMAC secret become distinct values | SEC-KEY-01 | `10_Security.md`, `09_Backup_and_Import_Export.md`, `12_Business_Rules.md` |
| 4 | Access control & tenant isolation decisions | RFC 009 / RFC 010 ratified or rejected on the record | SEC-ADMIN-03, ISO-WEB-04 | `10_Security.md`, `11_Data_Model.md`, `17_API_Gateway_System.md`, `docs/rfc/009`, `docs/rfc/010` |
| 5 | Contract & visual consistency | One `paymentBreakdown` contract; one student mark across Fees | RPT-SHAPE-08, UI-AVATAR-09 | `04_Dashboard.md`, `13_UI_Guidelines.md` |
| 6 | Attendance analytics batching | Heatmap drops from 14 gateway calls to 1 | PERF-ATT-10 | `19_Concurrency_and_Testing.md`, `21_Automation_Testing.md`, `04_Dashboard.md` |

**Coverage:** 11/11 v1 requirements mapped. No requirement unmapped; no phase
without a requirement.

---

### Phase 1: Specification & documentation integrity

**Goal:** Stop the spec corpus from having two different files answering to the
same number, and put changed behaviour where a developer will actually find it.

**Spec files:**
- `AGENTS.md` §0 (spec is the contract), §0.3 (mandatory reading order), §17 (cross-reference index), §8 (stop-and-ask triggers #5, #6)
- `22_Redundancy_Audit.md` — the dedup map, which must learn to see its own blind spot
- `apps/gateway/.env.example` — the documented home for `ALLOW_DEV_AUTH`

**Requirements:** DOC-SPEC-07, OPS-DEVAUTH-11

**Depends on:** nothing — this is the root.

**Why first:** `21_Redis_Caching_Layer.md`, `22_Vector_Search_System.md` and
`23_Complexity_Guarantees.md` are all unratified later additions that collide with
ratified ones (`21_Automation_Testing.md` 29 refs, `22_Redundancy_Audit.md`,
`23_Security_Harness_Plan.md`). Until the numbers are settled, no citation "see §23"
resolves, and the three deferred specs cannot enter a roadmap without deepening the
collision.

**Success Criteria:**
1. Every file in the corpus has a unique number, and `AGENTS.md` §17's
   cross-reference index lists each one exactly once.
2. Every `BR-*`, `EC-*`, `Rule N` and `§` citation across the corpus resolves to
   exactly one file — verified by a grep-based uniqueness check added to CI.
3. `22_Redundancy_Audit.md` contains a dedup row for the collision class itself, so
   the map catches the next instance rather than only this one.
4. A developer running the documented local setup sees `ALLOW_DEV_AUTH` explained
   before they hit an auth error.

**Gate:** `AGENTS.md` §8 trigger #6 — any change to `AGENTS.md` requires 2 reviewers
plus orchestrator sign-off. **Do not execute unilaterally.**

**Reversibility:** ⚠️ one-way for the numbering (renumbering invalidates existing
citations until they are all updated in the same commit).

---

### Phase 2: Supply chain & secret hygiene

**Goal:** No unpinned third-party action runs in CI with access to a secret; no
usable credential is committed; the leaked production credential is rotated.

**Spec files:**
- `23_Security_Harness_Plan.md` §5 (S4 — Secrets & Supply Chain), §5.1 (the CI gate order, STEP 1 gitleaks pre-commit)
- `deployment/05_CI_CD_GitHub_Actions.md` §2 (reviewer agent)
- `10_Security.md` §17 (no telemetry / no exfiltration surfaces)
- `AGENTS.md` §2 Rule 9 (no silent failures)

**Requirements:** CI-SUPPLY-05, SEC-CRED-06, SEC-TOKEN-02

**Depends on:** nothing (Phase 1 independent).

**State:** partially shipped — `reviewer.yml` already moved off
`pull_request_target` to `pull_request` in commit `257285f`. Remaining: the floating
`@latest` tag, the questionable `OPENAI_API_KEY`, the harness credentials, and the
rotation itself.

**Success Criteria:**
1. `coderabbitai/ai-pr-reviewer` is pinned to a commit SHA, and no workflow uses a
   floating `@latest`/unpinned third-party action while holding a secret.
2. `OPENAI_API_KEY` is either confirmed as a deliberate BYOK setup and documented as
   such, or deleted from the action environment.
3. `apps/web/tests/e2e/harness.ts` has no default credential; the suite fails with a
   legible message when `E2E_EMAIL`/`E2E_PASSWORD` are unset.
4. The Turso credential from commit `55e7ede` is rotated at the provider, and the
   rotation is recorded in `worklog.md`.
5. `gitleaks detect --staged` passes on a synthetic fixture containing the harness's
   old credential pattern — proving the gate would have caught it.

**Reversibility:** ✅ reversible. Pinning is safe; rotation is a one-way provider
action but carries no code risk.

---

### Phase 3: Cryptographic key separation

**Goal:** `PIN_PEPPER`, `DATA_ENCRYPTION_KEY` and `GATEWAY_SHARED_SECRET` become
three distinct values instead of one value serving all three.

**Spec files:**
- `10_Security.md` §15 — backups fail closed; the envelope
- `09_Backup_and_Import_Export.md` §11 — AES-256-GCM + Argon2id round-trip
- `12_Business_Rules.md` BR-BAT-02
- `AGENTS.md` §2 Rule 8, §8 trigger #4

**Requirements:** SEC-KEY-01

**Observed:** `apps/gateway/lib/crypto.ts:25` —
`const DATA_KEY = readSecret("DATA_ENCRYPTION_KEY") || HMAC_SECRET`. Compromise of
any one of the three silently compromises backup confidentiality *and* PIN
verification together.

**Why it is its own phase:** this is the most security-severe item in the backlog and
the only one where a bad change **destroys every existing backup**. Key derivation is
not reversible — splitting the values invalidates any artefact encrypted under the
old combined key unless a migration path is designed first.

**Success Criteria:**
1. Three distinct environment variables, each validated independently at startup;
   a missing one fails closed with a message naming which.
2. The Argon2id + AES-256-GCM round-trip test in `09_Backup_and_Import_Export.md`
   §11 passes for a backup written under the new separation.
3. A documented migration path exists for artefacts encrypted under the old combined
   key, **or** an explicit, ratified decision that no such artefacts exist in
   production.
4. No secret value is logged, echoed, or included in any error path.

**Gate:** `AGENTS.md` §8 trigger #4 — changing the crypto envelope requires 2
reviewers including the security owner. **Do not execute unilaterally.**

**Reversibility:** ⚠️ **one-way door.** Bumping key derivation without a migration
makes existing backups undecryptable.

---

### Phase 4: Access control & tenant isolation decisions

**Goal:** Decide, on the record, whether to ratify RFC 009 and RFC 010 — and close
the config-vs-behaviour drift where `GATEWAY_ADMIN_TOKEN` is documented but read by
no handler.

**Spec files:**
- `10_Security.md` §2 (single-tenant isolation), §7 (RLS defence-in-depth)
- `11_Data_Model.md` §1 — the database *is* the tenant
- `17_API_Gateway_System.md` §2.2 — the no-hardcode rule
- `AGENTS.md` §2 Rules 1 & 9, §8 trigger #1
- `docs/rfc/009-tenant-isolation-invariant.md`, `docs/rfc/010-admin-access-model.md`
- OWASP Top 10 2025 **A01 Broken Access Control** (the #1 risk; `23_Security_Harness_Plan.md` §3)

**Requirements:** SEC-ADMIN-03, ISO-WEB-04

**Observed:**
- `GATEWAY_ADMIN_TOKEN` is read by **no** handler, while `apps/gateway/.env.example`
  claims the BFF forwards it and `routes/security.ts` gates account erase on PIN
  confirmation instead.
- `createLibsqlProxy(client)` takes no tenant and ~60 call sites rely on the
  shared-DB fallback at `route.ts:283`. The **gateway** is correctly scoped
  (`buildTenantWhere` unconditional `tenant_id = ?`); the **web** path is not.

**Why it is a decision phase, not an implementation phase:** both RFCs change the
data model or the admin access model. RFC 009 §3.1 proposes deleting the shared-DB
fallback and failing closed with 503; RFC 010 proposes retiring the edge endpoint.
Both are **written but deliberately not ratified**, so implementing either one now
would be acting on an unratified proposal.

**Success Criteria:**
1. RFC 009 and RFC 010 are each explicitly ratified or rejected, with the decision
   and its rationale recorded in `worklog.md`.
2. `GATEWAY_ADMIN_TOKEN` is either enforced by a handler or removed from
   `.env.example` and the code — no third state where it is documented but inert.
3. `route.ts:283` either no longer falls back to a shared database, or carries a
   test proving the fallback cannot serve another tenant's rows.
4. Every web query path that reads tenant data is demonstrably scoped, with the
   check enforced by CI rather than by review discipline.

**Gate:** `AGENTS.md` §8 trigger #1 (ledger/data-model touching) and #4 (auth).

**Reversibility:** ⚠️ **one-way door.** Deleting the shared-DB fallback strands any
tenant still provisioned that way; changing the admin model invalidates existing
sessions and credentials.

---

### Phase 5: Contract & visual consistency

**Goal:** One `paymentBreakdown` contract across services, and one student mark
across every Fees tab.

**Spec files:**
- `04_Dashboard.md` §10.1 (payment breakdown), §6.2 (period-independent cards)
- `13_UI_Guidelines.md` §10 (accessibility), §5.2/§5.5 (glass tiers)
- `12_Business_Rules.md` BR-CALC-* (fee calculation vocabulary)
- `AGENTS.md` §0.2 (no orphan code), §2 Rule 10

**Requirements:** RPT-SHAPE-08, UI-AVATAR-09

**Observed:**
- The gateway now returns a **3-key** disjoint partition; `apps/services/report-svc/src/index.ts:96`
  still computes a **4-key** shape. Internally consistent, different contract.
- `ledger-table.tsx:402` still draws a single-initial gradient while the other two
  Fees tabs render the shared `<Avatar>` — the same person looks different on one tab.

**Success Criteria:**
1. A single shared type describes `paymentBreakdown`, and both the gateway and
   `report-svc` are checked against it — so a future divergence fails CI rather than
   surfacing as a wrong number on a dashboard.
2. Every Fees tab renders the student mark from the same component; the local
   `initials`/`studentAccent` helpers remain deleted (`AGENTS.md` §0.2).
3. axe reports zero serious or critical WCAG AA violations on all five screens and on
   every Fees tab open.

**Reversibility:** ✅ reversible. Note `apps/services` sits outside the WEB
In-Flight boundary (`AGENTS.md` §9.3) — cross-boundary work needs an RFC.

---

### Phase 6: Attendance analytics batching

**Goal:** The dashboard heatmap issues one gateway call instead of fourteen.

**Spec files:**
- `19_Concurrency_and_Testing.md` — read bounding and concurrency budgets
- `21_Automation_Testing.md` — the P-01..P-10 product E2E flows
- `04_Dashboard.md` §6.2 (the card this feeds)
- `AGENTS.md` §2 Rule 9 (no silent failure), §3.4 (ORM-only)

**Requirements:** PERF-ATT-10

**Observed:** the heatmap issues **14** gateway calls; one
`GET /api/v1/attendance?from=&to=` would make it 1. Each day also triggers an
unbounded full-roster read at `routes/attendance.ts:105`.

**Constraint carried forward from PERF-GATEWAY-06:** bound by **filter, never `take`**.
Capping a money population silently under-reports `overdueMinor`, which is worse
than the latency it saves.

**Success Criteria:**
1. The heatmap issues exactly 1 gateway call; the count is asserted in a test, not
   assumed.
2. The per-day unbounded roster read at `routes/attendance.ts:105` is bounded by the
   student population the measure is defined over.
3. Every money figure on the affected cards is byte-identical before and after —
   proven by a parity test, not by inspection.
4. The dashboard's p95 load time improves measurably against the recorded baseline.

**Reversibility:** ✅ reversible.

---

## Out of Scope

- **A sixth screen** — `AGENTS.md` §2 Rule 4; requires a ratified amendment.
- **Mobile / desktop** — locked behind `WEB-PROD-GATE` (`AGENTS.md` §9.3,
  `16_Platform_Delivery_Sequence.md`).
- **Vector search, Redis caching, complexity guarantees** — specified but unratified
  and number-colliding; blocked behind Phase 1.
- **Telemetry of any kind** — `AGENTS.md` §2 Rule 3, `10_Security.md` §17.

---

## Coverage check

| Requirement | Phase | Spec files bound |
|---|---|---|
| DOC-SPEC-07 | 1 | `AGENTS.md`, `22_Redundancy_Audit.md` |
| OPS-DEVAUTH-11 | 1 | `apps/gateway/.env.example`, `AGENTS.md` §9 |
| CI-SUPPLY-05 | 2 | `23_Security_Harness_Plan.md` §5.1, `deployment/05_CI_CD_GitHub_Actions.md` |
| SEC-CRED-06 | 2 | `23_Security_Harness_Plan.md` §5.1 STEP 1 |
| SEC-TOKEN-02 | 2 | `23_Security_Harness_Plan.md` §5 |
| SEC-KEY-01 | 3 | `10_Security.md` §15, `09_Backup_and_Import_Export.md` §11, BR-BAT-02 |
| SEC-ADMIN-03 | 4 | `10_Security.md`, RFC 010 |
| ISO-WEB-04 | 4 | `11_Data_Model.md` §1, `17_API_Gateway_System.md` §2.2, RFC 009 |
| RPT-SHAPE-08 | 5 | `04_Dashboard.md` §10.1, BR-CALC-* |
| UI-AVATAR-09 | 5 | `13_UI_Guidelines.md` §10, `AGENTS.md` §0.2 |
| PERF-ATT-10 | 6 | `19_Concurrency_and_Testing.md`, `21_Automation_Testing.md` |

**11/11 mapped · 0 unmapped · 0 phases without a requirement** ✓

---
*Generated 2026-10-10 from `.planning/REQUIREMENTS.md` · every spec path verified to exist at generation time*