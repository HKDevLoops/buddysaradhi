# BuddySaradhi Web — Codebase Gap Report

**Scope:** `apps/web` (read-only audit) vs the spec module (`Buddysaradhi_Planning`, `UI_Design_Master_Plan`) and the gateway contract (`apps/gateway/src/routes`).
**Date:** 2026-07-13
**Method:** Full read of `apps/web/src` (app, components, stores, server, lib, types), embedded BFF (`app/api/v1/[...slug]`), and the standalone gateway routes.

---

## Summary

| Category | Count | Notes |
|---|---|---|
| Screens — UI rendered & navigable | 5 / 5 | All five render and switch correctly via Zustand `shell-store`. |
| Screens — backed by REAL data | 0 / 5 | Every screen's reads come from **hardcoded demo fixtures**, not the DB. |
| Screens — "stubbed / placeholder" sections | 3 | Student Reports tab, Fees→Import tab, Settings→Import/Export. |
| Mock/hardcoded data sources | 9 | `fixtures.ts` + mock backup blob + JSON-file settings store. |
| Missing/dead server actions | 6 | Create-Student (501), ledger import commit, backup crypto, export, report generation, edit-student. |
| Hardcoded security bypasses | 3 | PIN `"1234"` reused for lock / void / delete. |
| Constitution violations (AGENTS 10 rules) | 3 | Rule 8 (mock backup), Rule 7 (orphaned sync_outbox), offline-first principle broken. |

**Headline finding:** The web app is a **working UI shell with a mocked data layer**. Reads are served by an *embedded* BFF (`app/api/v1/[...slug]/route.ts`) that returns deterministic demo fixtures for every endpoint. Writes are inconsistent: attendance/fee/payment actions write to the real Turso DB, but the reads never reflect them; `createStudent` posts to the embedded BFF which has **no POST handler (returns 501)**; settings are persisted to a **local JSON file**, not the DB. The fully-functional standalone gateway (`apps/gateway`) is **never used by the web app**.

---

## Missing or Stubbed Implementations

| Area | Screen/Engine | Expected (spec) | Actual (code) | file:line | Severity |
|---|---|---|---|---|---|
| Student CRUD | Students | Create student persists to DB via gateway | `createStudent` → `gatewayPost("/api/v1/students")` but embedded BFF has **no POST handler → 501 Not implemented** | `server/actions/students.ts:24-40`; `app/api/v1/[...slug]/route.ts:201-204` | **Critical** |
| Student edit | Students | Edit existing student | Store has `openEditSheet`/`closeEditSheet` but **no edit sheet component exists**; drawer has no edit entry point | `stores/students-store.ts:35,89-90`; no `edit-student-sheet.tsx` | High |
| Attendance persistence | Attendance | Marking writes to DB AND reflects on screen | Writes to real DB, but the *read* path returns fixtures → marked status never shows | `server/actions/attendance.ts:12-63` (write) vs `app/api/v1/[...slug]/fixtures.ts:152-176` (read) | **Critical** |
| Fee/payment persistence | Fees | Record payment / invoice / void persists & reflects | Writes to real DB, but ledger **read** returns fixtures → entries never appear | `server/actions/fees.ts:77-159`, `server/actions/payments.ts:20-56` vs `fixtures.ts:271-331` | **Critical** |
| Backup | Settings | AES-256-GCM + Argon2id real backup | **Fully mocked**: returns `[AES-256-GCM-BACKUP-BLOB-${Date.now()}]` placeholder; no crypto | `server/actions/settings.ts:8-30` (`mockEnvelope` line 16, `mockBlobUrl` line 23) | **Critical** |
| Restore / Import | Settings | Import `.bsb` backup | Buttons have **no `onClick`** (dead) | `components/settings/import-export-section.tsx:15-56` | High |
| Export | Settings | Export JSON/CSV of real data | Buttons have **no `onClick`** (dead) | `components/settings/import-export-section.tsx:15-34` | High |
| Ledger import | Fees→Import | CSV import commits to ledger | Preview only — "connect a fees import action to commit" (literal TODO), no server action | `components/fees/ledger-import.tsx:3-5,152-165` | High |
| Reports (student) | Students | Per-student progress/performance reports | "coming in a future phase" placeholder | `components/students/student-detail-drawer.tsx:395-410` | Medium |
| Reports (global) | Dashboard | "Generate Report" quick action | Routes to `/fees`, not a report | `components/buddysaradhi/dashboard-client.tsx:333` | Low |
| Change PIN | Settings→Security | Set/change app PIN | Button has **no `onClick`** (dead) | `components/settings/security-section.tsx:47-52` | Medium |
| Search engine | Cross-cutting | FTS5 student search wired to UI | `searchStudentsFts()` implemented but **never imported anywhere**; UI search filters fixtures only | `lib/search/searchStudentsFts.ts:8` (grep: 0 imports in app) | High |
| Sync engine | Cross-cutting | Process `sync_outbox` → Turso | `sync_outbox` rows are written but **never read/flushed**; `pendingSyncCount` hardcoded `0` | `components/buddysaradhi/glass-shell.tsx:34`; `server/actions/*` write outbox | **Critical** |
| Reminder engine | Cross-cutting | Due-fee / upcoming / missing-attendance reminders | No engine; only fixture feed items + settings toggles (which have no sender) | `components/settings/notifications-section.tsx:14-78` (toggles persist, nothing sends) | High |
| Notification engine | Cross-cutting | Real in-app notifications | Feed sourced from fixtures (`getActivityFeed`); no `notification` table writes from app | `app/api/v1/[...slug]/fixtures.ts:206-216` | Medium |
| Report engine | Cross-cutting | Dash/collection/attendance reports | Uses gateway-style queries against **fixtures**; no real aggregation | `server/queries/dashboard-*.ts`, `fixtures.ts:187-251` | Medium |

---

## Hardcoded / Mock Data

All reads below are served by the embedded BFF which returns static demo data regardless of DB state.

| Item | file:line | Detail |
|---|---|---|
| Student roster (14 hardcoded students) | `app/api/v1/[...slug]/fixtures.ts:66-81` | `RAW` array of fixed students; IDs/balances all static. |
| Student detail / list rows | `fixtures.ts:94-140` | Deterministic generated `Student` objects (same address/school for all). |
| Attendance for any date | `fixtures.ts:142-176` | Status derived from `hashStr(date:id)` — **not real records**; `session` is fabricated `sess-<date>`. |
| Dashboard KPIs | `fixtures.ts:187-204` | `collectedThisMonthMinor: 320000`, `dueForMonthMinor: 210000` etc. hardcoded constants. |
| Activity feed | `fixtures.ts:206-216` | 6 static fake events with fixed 2026-07 dates. |
| Due-today | `fixtures.ts:218-226` | Derived from static `RAW` balances. |
| Heatmaps (attendance + financial) | `fixtures.ts:228-251` | Random-but-deterministic `hashStr(d)` values; not from DB. |
| Ledger entries | `fixtures.ts:271-331` | 1–2 synthetic entries per student; `this_hash: null`. |
| Invoices | `fixtures.ts:333-350` | One synthetic invoice per student. |
| Ledger-fees list | `fixtures.ts:352-365` | Static list. |
| Default settings store | `app/api/v1/[...slug]/route.ts:37-68` | `DEFAULT_SETTINGS` hardcoded (institute name, seq numbers, flags). |
| Settings persistence target | `app/api/v1/[...slug]/route.ts:34-35,83-86` | Settings written to `.data/settings.json` (local file), **not the Turso/DB**. |
| Backup blob | `server/actions/settings.ts:16,23` | `mockEnvelope = "[AES-256-GCM-BACKUP-BLOB-...]"`; no real crypto. |
| Avatar / institute name in shell | `components/buddysaradhi/glass-shell.tsx:236` | `"RS"` hardcoded avatar initials. |

> Note: `apps/gateway/src/routes/*` implements **real** CRUD + ledger + reports against Prisma/Turso, but the web app does not call it — it calls the embedded fixture BFF. The gateway is effectively dead code for the web surface.

---

## Dead Links / Broken Flows

- **Add Student (primary CRUD path) → 501.** `createStudent` posts to `/api/v1/students`; the embedded BFF only handles `GET /students` (`route.ts:130-154`), so POST falls through to `501 Not implemented` (`route.ts:201-204`). The sheet shows the returned error. (`server/actions/students.ts:24-40`)
- **Mark attendance / record payment / create invoice → success toast but no visible change.** Writes hit the real DB; reads show fixtures. User perceives a no-op. (`attendance.ts:12-63`, `fees.ts:77-159` vs `fixtures.ts`)
- **Settings → Import/Export buttons** have no handlers (`import-export-section.tsx:15-56`).
- **Settings → Security → "Change PIN"** has no handler (`security-section.tsx:47-52`).
- **Fees → Import "Import N rows"** only sets `imported=true` preview state; commits nothing (`ledger-import.tsx:152-165`).
- **Dashboard "Generate Report"** quick action navigates to `/fees` (`dashboard-client.tsx:333`).
- **Student → Reports tab** is an explicit "future phase" stub (`student-detail-drawer.tsx:395-410`).
- Navigation itself is **correct**: all 5 `NAV_ITEMS` map to `ScreenId`s and switch via `shell-store` (`glass-shell.tsx:24-30,97-141`, `(app)/dashboard/page.tsx:16-20`). No broken routes — only the *content* behind them is mock or dead.

---

## Constitution Violations (AGENTS.md 10 rules)

| Rule | Status | Evidence |
|---|---|---|
| **Rule 8 — Backup = AES-256-GCM + Argon2id** | **Violated** | `createBackupAction` returns a fake `[AES-256-GCM-BACKUP-BLOB-…]` string; no envelope, no KDF, no restore path. `server/actions/settings.ts:8-30`. |
| **Rule 7 — Every mutation writes `sync_outbox`** | **Partial violation** | Outbox rows *are* written (`attendance.ts:51-55`, `fees.ts:68-72`, `payments.ts:45-48`) but **no processor/flusher exists** — rows accumulate forever; `pendingSyncCount` is hardcoded `0` (`glass-shell.tsx:34`). Orphaned writes = silent non-sync. |
| **Offline-first / sovereign (P5, Rule 2/7)** | **Broken** | Reads are 100% fixture-driven; the app shows demo data, not the tutor's own DB. Mutations that do write to DB are invisible. The product's core promise ("your local DB first") is not realized in the web build. |
| **Rule 1 — Ledger append-only** | OK (code path) | `fees.ts`/`payments.ts`/`attendance.ts` use INSERT-only + reversing VOID rows; hash chain present (weak `computeSimpleHash`, but append-only honored). |
| **Rule 5 — No indigo/blue accents** | OK | No `indigo`/`blue-*`/`#4F46E5` in `globals.css` (grep: 0 matches); design uses bioluminescent CSS vars. |
| **Rule 6 — Integer paise** | OK (with caveat) | Money stored as integer paise in fixtures/actions; `formatINR` used. Caveat: `add-student-sheet.tsx:96` does `baseFee * 100` as JS `number` (safe for INR magnitudes but not `bigint` per spec). |
| **Rule 10 — A11y ≥44px** | Mostly OK | Nav/buttons use `min-h-[44px]`/`56px`. Minor: some `<select>`/toggle targets at 36–44px. |
| **Sticky footer** | OK | Present and `mt-auto` in `glass-shell.tsx:247-269`. |
| **Hardcoded PIN `"1234"`** (security, not a numbered rule but core principle) | **Violation** | Same dev PIN bypasses lock/void/delete: `attendance.ts:67`, `fees.ts:97`, `settings.ts:34`. No per-user PIN, no hashing. |

---

## Top 10 Priorities to reach MVP-complete

1. **Wire reads to the real DB (kill the fixture BFF).** Replace `gatewayGet` targets in `server/queries/*` and `server/actions/dashboard.ts` so all screens read live Turso data. This alone fixes the "everything is fake" perception. (Critical)
2. **Fix `createStudent`.** Point it at the real DB (mirror `attendance.ts`/`fees.ts` `getAuthenticatedDb` INSERT) or add a `POST /api/v1/students` handler to the embedded BFF that writes DB — currently 501s. (Critical)
3. **Implement the Sync engine.** Add an outbox processor (worker/cron or client interval) that flushes `sync_outbox` → Turso and updates `pendingSyncCount`. Today every mutation is orphaned. (Critical)
4. **Real backup/restore (Rule 8).** Replace the mock blob in `createBackupAction` with actual AES-256-GCM + Argon2id envelope and a matching restore action; remove the `.data/settings.json` shortcut. (Critical)
5. **Persist settings to the DB, not a JSON file.** `updateSettingAction`/`getSettings` currently round-trip to `.data/settings.json` via the embedded BFF. Route to the real `settings` table. (High)
6. **Wire the Search engine.** `searchStudentsFts` exists but is unused; connect the Students search box (and global ⌘K) to it instead of client-filtering fixtures. (High)
7. **Complete Fees import + global/student Reports.** Add the ledger-import commit action and a real report view (the "future phase" tab). (High)
8. **Build the Reminder/Notification engines.** Toggles persist but nothing sends; there is no `notification` emitter or due-fee/attendance reminder job. (High)
9. **Remove hardcoded PIN `"1234"`.** Implement real per-user PIN (hashed, stored in `settings`) gating lock/void/delete; reuse for "Change PIN". (Medium)
10. **Add Edit-Student flow + dead-button cleanup.** Implement `edit-student-sheet`, wire "Change PIN", and give Import/Export real handlers. (Medium)

---

### Appendix — architecture mismatch (root cause)

- **Reads:** `server/queries/*` → `gatewayGet` (`server/get-db.ts:123-147`) → `fetch` same-origin `/api/v1/*` → **embedded BFF returns `fixtures.ts`**.
- **Writes:** attendance/fee/payment/deleteStudent → `getAuthenticatedDb()` → real Turso; `createStudent` → `gatewayPost` → embedded BFF (501); settings → `gatewayPatch` → embedded BFF → JSON file.
- **Standalone gateway (`apps/gateway`):** full real implementation, but **not imported by the web app** — entire CRUD/ledger/reports there is unreachable from `apps/web`.

The single highest-leverage fix is unifying the web on one real data source (the DB-backed gateway) and deleting the fixture BFF; until then the app is a demo, not a product.
