# Audit Plan: Spec-vs-Implementation Compliance

## Goal
Audit the current `apps/web`, `apps/gateway`, and `supabase/functions` implementations against the root-level markdown specifications (00-23 + AGENTS.md) and project `docs/` to identify gaps between stated intent and actual behavior. The previous SaaS remediation plan addressed 10 specific issues; this audit widens the lens to every spec-mandated behavior.

## Scope
- Root specs: `00_Vision.md` through `23_Security_Harness_Plan.md`, `AGENTS.md`
- Project docs: `docs/rfc/*`, `docs/superpowers/specs/*`, `docs/superpowers/plans/*`
- Code: `apps/web/src`, `apps/gateway/src`, `supabase/functions/*/index.ts`
- Schema: `prisma/schema.prisma`, `supabase/functions/*/migrations/*`

## Audit Methodology
1. Read each spec section that defines a behavior (not stylistic narrative)
2. Locate the code that implements that behavior
3. Mark each spec clause as: ✅ Implemented, ⚠️ Partially Implemented, ❌ Missing, or 🔍 Needs Deep Verification
4. Group findings by domain (auth, ledger, dashboard, students, fees, attendance, settings, gateway, supabase, tests)

## Key Specs to Audit (priority order)

### P0 — Core Doctrine (AGENTS.md §2 + 01_Product_Principles.md)
- [ ] **Rule 1**: Ledger append-only enforcement — Prisma middleware + SQLite trigger `trg_ledger_no_update`
- [ ] **Rule 2**: No outbound network calls (CSP allowlist, no-fetch-in-client lint)
- [ ] **Rule 3**: No telemetry SDKs (dependency lint, CSP beacons)
- [ ] **Rule 4**: Five screens only — `apps/web/src/app` route count, no 6th top-level route
- [ ] **Rule 5**: No indigo/blue primary accents (palette check)
- [ ] **Rule 6**: Integer paise money — never float, `formatINR(paise)` everywhere
- [ ] **Rule 7**: Every mutation writes `sync_outbox` (audit)
- [ ] **Rule 8**: AES-256-GCM + Argon2id backups
- [ ] **Rule 9**: No silent failures (no-empty-catch, no-console)
- [ ] **Rule 10**: WCAG 2.1 AA, 44×44px touch, `prefers-reduced-motion`
- [ ] **P2 Five Screens**: Confirm only `/`, `/login`, `/signup`, `/callback`, `/forgot-password`, `/reset-password`, `/dashboard` exist under `(app)`
- [ ] **P4 Ledger Immutable**: Confirm reversal/void flow exists in `apps/web/src/lib/ledger` or actions

### P0 — Ledger Engine (02_Core_Logic.md, 07_Fees_and_Payments.md, 12_Business_Rules.md)
- [ ] `postLedgerEntry(db, entry)` implemented in `packages/core` or `apps/web/src/lib/ledger`
- [ ] `voidEntry` appends reversing row, never mutates (P4)
- [ ] Receipts: monotonic `next_receipt_seq`, never reused (BR-RC-01)
- [ ] Invoice/receipt numbers: monotonic, gap-tolerant, never recycled
- [ ] Tamper-evident hash on receipts (BR-FEE-05)
- [ ] Money in paise everywhere (no `number` for amounts, no `+`/`-`/`*` on money)

### P0 — Dashboard (04_Dashboard.md)
- [ ] "Due Today" widget (KPIs)
- [ ] Quick actions ≤2-tap from any screen (P3)
- [ ] No stubbed KPIs (`dueForMonthMinor: 0` bug from spec)
- [ ] Consolidated dashboard data contract (single call, not 5 waterfalls)

### P0 — Students (05_Students.md)
- [ ] List, search, filter, sort, paginate
- [ ] Detail drawer with all identity, fees, attendance, ledger
- [ ] Student deletion is destructive by user choice (BR-STU-01?)
- [ ] Master list density: 6 columns default, rest in drawer (P8)

### P0 — Fees (07_Fees_and_Payments.md)
- [ ] Full-month fee generation, no proration (P6 decision)
- [ ] Fee periods / invoices expected charges (postpaid default)
- [ ] Payments received with receipt generation
- [ ] Reversing/voided receipts remain visible
- [ ] Per-student expected amount by month + balances
- [ ] Monthly statistics in student page

### P0 — Attendance (06_Attendance.md)
- [ ] Daily session marking (primary action)
- [ ] Preset summaries (current month, last month, 3m, 6m, full year)
- [ ] Session lock (default 48h, configurable)
- [ ] Late/absent/excused/leave statuses
- [ ] No heatmap-heavy presentation (replaced with simple summaries)

### P0 — Settings (08_Settings.md)
- [ ] 8 palettes with light/dark variants
- [ ] Defaults pre-populated: INR, en-IN, postpaid monthly, INV-, RCP-, 48h lock, 5min lock timeout
- [ ] No "configuration wizard"
- [ ] Dark is default

### P0 — Security (10_Security.md)
- [ ] PIN-gated mutations (void, unlock, backdated, bulk delete, export)
- [ ] Rate limit + replay protection on gateway
- [ ] CSP allowlist enforced
- [ ] No telemetry/analytics
- [ ] Single active session enforcement
- [ ] Sign-out revokes Supabase session + clears cookies

### P0 — Gateway & Supabase Functions (17_API_Gateway_System.md, 18_Microservice_Architecture.md, 19_Concurrency_and_Testing.md)
- [ ] All web routes have a gateway counterpart (parity)
- [ ] `/api/v1/analytics/dashboard` exists
- [ ] `/api/v1/reports/dashboard/*` deprecated but kept as compat alias
- [ ] Supabase gateway-graphql + gateway + provision-db deployed
- [ ] Web BFF forwards auth headers (no Supabase keys in browser)

### P0 — Tests (21_Automation_Testing.md, 19_Concurrency_and_Testing.md)
- [ ] Unit tests ≥70% on `packages/core` and `packages/shared`
- [ ] Integration tests with in-memory SQLite
- [ ] E2E happy-path flows (golden-path)
- [ ] A11y: axe-core passes all 5 screens
- [ ] Concurrent ledger mutations test
- [ ] Performance budget: FCP <1.2s mid-tier Android

## Tools to Use
- `Grep` for ledger mutation patterns, money types, screen routes, telemetry deps
- `Read` for spec sections and code
- `Bash` to run `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:a11y`
- `Grep` for `console.log`, `as any`, `db.ledgerEntry.update`, `db.ledgerEntry.delete`

## Open Decisions to Resolve with User

| # | Question | Recommended |
|---|----------|-------------|
| 1 | Audit depth: surface scan vs exhaustive per-spec walk? | Surface scan of every P0 spec clause + deep check on ledger, money, auth, and gateway |
| 2 | Should the plan include fixing every gap, or just identifying them? | Identify gaps first, then a separate "fix" plan after user reviews |
| 3 | Do we re-run tests after the previous commit to confirm no regressions? | Yes — npm run test:unit + test:integration + test:a11y |
| 4 | Do we verify Supabase function deploys (gateway, gateway-graphql, provision-db) actually work end-to-end? | Yes — hit each function via curl with auth headers |

## Deliverables
1. Compliance matrix in `.kilo/plans/1785144372302-spec-implementation-audit-matrix.md`
2. Categorized gap list: P0 (must-fix), P1 (should-fix), P2 (defer)
3. Verification commands and results
4. Concrete recommendation for next plan (fix vs ship)

## Out of Scope
- Writing fixes (this is an audit plan)
- Performance profiling beyond the spec budgets
- New feature design

## Validation
After writing the plan file, ask the user one question about audit depth before exiting.
