# Requirements — Buddysaradhi

> **Spec authority is the corpus, not this file.** Every requirement below carries
> a `## Spec:` anchor naming a real section, `BR-*` rule or `EC-*` case in
> `AGENTS.md` / `00_`–`23_*.md`. A requirement with no anchor is orphan code
> (`AGENTS.md` §0.2) and is deleted rather than kept. When this file and the
> corpus disagree, the corpus wins and this file is corrected.

**Status:** initialised 2026-10-10 from a brownfield audit of the shipped repo.
Every Active item is a real, observed finding — not a hypothetical.

---

## v1 Requirements

### Secrets & Cryptography

- [ ] **SEC-KEY-01**: Split the key-reuse in the gateway so `PIN_PEPPER`,
      `DATA_ENCRYPTION_KEY` and `GATEWAY_SHARED_SECRET` are **distinct** values
      instead of one value serving all three.
      ## Spec: `10_Security.md` §15 · `09_Backup_and_Import_Export.md` §11 · BR-BAT-02 · `AGENTS.md` §2 Rule 8
      ## Observed: `apps/gateway/lib/crypto.ts:25` — `const DATA_KEY = readSecret("DATA_ENCRYPTION_KEY") || HMAC_SECRET`
      ## Gated: `AGENTS.md` §8 trigger #4 (crypto envelope) — needs 2 reviewers incl. the security owner. **Not unilaterally fixable.**
      ## Impact: compromise of any one secret silently compromises backup confidentiality and PIN verification together.

- [ ] **SEC-TOKEN-02**: Rotate the leaked Turso database credential.
      ## Spec: `23_Security_Harness_Plan.md` §5 (S4 secrets & supply chain) · `AGENTS.md` §2 Rule 9
      ## Observed: the token was committed at `scratch/test-turso-web.ts` in commit `55e7ede` and pushed to `origin/main`. The file is now untracked+deleted and `.gitignore` covers `scratch/`, **but the credential remains in git history**.
      ## Owner-action: rotation + history purge are separate gated operations. **Only the owner can rotate.**

### Access Control

- [ ] **SEC-ADMIN-03**: Resolve `GATEWAY_ADMIN_TOKEN` — read by **no** handler,
      while `apps/gateway/.env.example` claims the BFF forwards it and
      `routes/security.ts` gates account erase on PIN confirmation instead.
      ## Spec: `10_Security.md` · `23_Security_Harness_Plan.md` §3 (access control) · `AGENTS.md` §2 Rules 1/9
      ## Note: RFC 010 proposes retiring the edge endpoint. **RFC 010 is parked, not ratified** — resolve config-vs-behaviour drift first.

- [ ] **ISO-WEB-04**: Make tenant scoping explicit on the web data path.
      ## Spec: `11_Data_Model.md` §1 · `10_Security.md` §2 · `17_API_Gateway_System.md` §2.2 (no-hardcode) · OWASP Top 10 2025 A01
      ## Observed: `createLibsqlProxy(client)` takes no tenant, and ~60 hand-written call sites rely on the shared-DB fallback at `route.ts:283`. The **gateway** is correctly scoped (`buildTenantWhere` unconditional `tenant_id = ?`); the **web** path is not.
      ## Note: RFC 009 §3.1 proposes deleting the shared-DB fallback and failing closed with 503. **RFC 009 is parked, not ratified.**

### Supply Chain & CI

- [ ] **CI-SUPPLY-05**: Pin `coderabbitai/ai-pr-reviewer` to a commit SHA, and
      confirm whether `OPENAI_API_KEY` is a deliberate BYOK setup or a stray
      credential in third-party code's environment.
      ## Spec: `23_Security_Harness_Plan.md` §5.1 · `deployment/05_CI_CD_GitHub_Actions.md` §2
      ## Observed: `@latest` is a floating tag while every other third-party action in the repo pins by major (`@v2`, `@v4`, `@v8`). **The trigger itself was fixed** — `reviewer.yml` moved off `pull_request_target` to `pull_request` (shipped `257285f`); the tag and the key remain open.
      ## Deliberately not guessed: pinning needs the real digest. A fabricated SHA fails closed; a plausible-looking fake passes review.

- [ ] **SEC-CRED-06**: Remove default QA credentials from the E2E harness.
      ## Spec: `23_Security_Harness_Plan.md` §5.1 STEP 1 (gitleaks pre-commit) · `AGENTS.md` §2 Rule 9
      ## Observed: `apps/web/tests/e2e/harness.ts:55-56` defaults to a real credential pair, committed. Anyone with repo read access can sign in as the QA tenant.

### Specification Integrity

- [ ] **DOC-SPEC-07**: Resolve the **three duplicate spec phase numbers**.
      ## Spec: `AGENTS.md` §0 (spec is the contract), §0.3 (reading order), §17 (cross-reference index) · `22_Redundancy_Audit.md` (the dedup map)
      ## Observed: `21_Automation_Testing.md` (29 refs) vs `24_Redis_Caching_Layer.md` (8); `22_Redundancy_Audit.md` vs `25_Vector_Search_System.md`; `23_Security_Harness_Plan.md` vs `26_Complexity_Guarantees.md`. `AGENTS.md` §17 and §0.3 reference one of each, so the Redis/Vector/Complexity files look like unratified later additions. Any citation "see §23" is ambiguous.
      ## Notable: `22_Redundancy_Audit.md` does **not** list this collision in its own dedup map — the map meant to catch exactly this missed it.
      ## Gated: renumbering touches `AGENTS.md` and the whole corpus (>500 lines) — `AGENTS.md` §8 trigger #5/#6.

### Consistency & Correctness

- [ ] **RPT-SHAPE-08**: Reconcile the `paymentBreakdown` contract across services.
      ## Spec: `04_Dashboard.md` §10.1 · `12_Business_Rules.md` BR-CALC-*
      ## Observed: the gateway now returns a **3-key** disjoint partition; `apps/services/report-svc/src/index.ts:96` still computes a **4-key** shape (`noDues` as a derived remainder). Internally consistent but a different contract. Outside the WEB In-Flight boundary (`AGENTS.md` §9.3) — needs an RFC if any consumer treats them as the same type.

- [ ] **UI-AVATAR-09**: Give the student mark one design across the Fees tabs.
      ## Spec: `13_UI_Guidelines.md` §10 · `AGENTS.md` §2 Rule 10 · `AGENTS.md` §0.2 (no orphan code)
      ## Observed: `fees-client.tsx` and `payments-client.tsx` were fixed to render the shared `<Avatar>`; **`ledger-table.tsx:402` still draws a single-initial gradient**, so the same person looks different on the Ledger tab. It passes axe — this is *consistency*, not a defect — so unifying it is a visual change, not a bug fix.

### Performance

- [ ] **PERF-ATT-10**: Batch the attendance heatmap's gateway traffic.
      ## Spec: `19_Concurrency_and_Testing.md` · `21_Automation_Testing.md` · `04_Dashboard.md` §6.2
      ## Observed: the heatmap issues **14 gateway calls**; a single `GET /api/v1/attendance?from=&to=` would make it 1. Each day also triggers an unbounded full-roster read at `routes/attendance.ts:105`.
      ## Constraint: bound by **filter, never `take`** — capping a money population silently under-reports `overdueMinor`.

### Operational

- [ ] **OPS-DEVAUTH-11**: Document that local dev now requires an explicit opt-in.
      ## Spec: `apps/gateway/.env.example` · `AGENTS.md` §9 Rule 9 (no silent failure)
      ## Observed: dev auth is now **opt-in** (`ALLOW_DEV_AUTH=true`) on both the gateway and web. This is intentional and mutation-checked — forgetting the flag must fail safe, not open a caller-trusting path — but it is a breaking change for local setup that is not yet called out anywhere a developer would look.

---

## Out of Scope

- **A sixth screen** — requires a ratified principle amendment. `AGENTS.md` §2 Rule 4. This is a *product* constraint, not a scheduling one.
- **Mobile and desktop implementation** — both locked behind the signed `WEB-PROD-GATE`. Exactly one platform is In-Flight at a time. `AGENTS.md` §9.3, `16_Platform_Delivery_Sequence.md`.
- **Any telemetry or analytics** — `AGENTS.md` §2 Rule 3, `10_Security.md` §17 (TELE-1).
- **Implementing RFC 009 / RFC 010** — both written, **parked, not ratified**. They describe real problems (ISO-WEB-04, SEC-ADMIN-03); ratifying them is an owner decision that changes the data model and the admin access model respectively.
- **Weakening a test to make CI green** — `AGENTS.md` §9.1 (lint before every commit), and the standing instruction that budgets may be raised honestly but assertions may not be weakened or skipped.

---

## Deferred (v2)

- **Vector search** — specified in `25_Vector_Search_System.md`; unratified, number-colliding, no phase.
- **Redis caching layer** — specified in `24_Redis_Caching_Layer.md`; unratified, number-colliding, no phase.
- **Complexity guarantees** — specified in `26_Complexity_Guarantees.md`; unratified, number-colliding, no phase.

All three are blocked behind **DOC-SPEC-07**: their phase numbers must be settled before they can be planned, which is exactly why that requirement is first.

---

## Traceability

Populated by `/gsd-plan-phase`. Format: requirement → phase → verification evidence.

| Requirement | Phase | Spec anchor | Status |
|---|---|---|---|
| SEC-KEY-01 | — | `10_Security.md` §15 | Open — owner-gated |
| SEC-TOKEN-02 | — | `23_Security_Harness_Plan.md` §5 | Open — owner-action |
| SEC-ADMIN-03 | — | `10_Security.md` | Open — needs RFC 010 decision |
| ISO-WEB-04 | — | `11_Data_Model.md` §1 | Open — needs RFC 009 decision |
| CI-SUPPLY-05 | — | `23_Security_Harness_Plan.md` §5.1 | Open — needs real SHA |
| SEC-CRED-06 | — | `23_Security_Harness_Plan.md` §5.1 | Open |
| DOC-SPEC-07 | — | `AGENTS.md` §0/§17 | Open — §8 gated |
| RPT-SHAPE-08 | — | `04_Dashboard.md` §10.1 | Open — cross-boundary |
| UI-AVATAR-09 | — | `13_UI_Guidelines.md` §10 | Open — visual change |
| PERF-ATT-10 | — | `19_Concurrency_and_Testing.md` | Open |
| OPS-DEVAUTH-11 | — | `apps/gateway/.env.example` | Open |

### Shipped during initialisation (for reference)

Not requirements — recorded so the roadmap does not re-litigate closed work.

| Shipped | Commit | Requirement satisfied |
|---|---|---|
| Auth bypass + cross-tenant isolation closed | `2eb97a2` | `10_Security.md` §3, §9 |
| Payment breakdown made true; WCAG AA contrast fixed | `745bb80` | `04_Dashboard.md` §10.1, `13_UI_Guidelines.md` §10 |
| PR reviewer off `pull_request_target` | `257285f` | `23_Security_Harness_Plan.md` §5 |

---
*Last updated: 2026-10-10 — initialised from brownfield audit, all anchors verified against the corpus*
