# Master Plan: Unified Gateway, Performance, and Instant UI ("Hot Reload")

> **Audience:** implementation-capable agents and code reviewers
> **Goal:** collapse two competing gateways into one canonical Supabase Edge Function backbone, fix the 5 user-visible bugs, enforce performance budgets, eliminate redundant code, and make the UI feel instant across the 5 screens.
> **Status:** ready for implementation

---

## 0. Decisions Locked From This Planning Session

1. **Runtime**: `supabase/functions/gateway` (Deno/TypeScript) is the **only** production API gateway backbone.
2. **Language**: TypeScript on Deno. No new language. No runtime swap.
3. **Protocol split**:
   - **GraphQL** (`/graphql`) — read-only aggregation only.
   - **REST** (`/api/v1/*`) — all mutations, all simple entity reads, all sync/outbox.
4. **Auth header**: `web -> API gateway -> backend resources` (Turso libSQL per-tenant DBs, Supabase Auth). One ingress path.
5. **Cloud function stays on Supabase free tier**.
6. **Redux not used**. State: TanStack Query (server cache) + Zustand (UI state) + `sessionStorage` persist (static config).
7. **"Hot reload"** = instant client-side updates and instant UI responses, not module HMR. Achieved by optimistic mutations + cache invalidation + persistent static cache.
8. **Financial integrity** preserved: `ledger_entries` is append-only; mistaken payments are voided via reversing rows.
9. **Student deletion** is destructive by user choice (cascades to non-financial ledgers only).
10. **Performance budgets** enforced at the gateway via structured logs and asserted by CI logs.

---

## 1. Target Directory Structure (Post-Remediation)

```
buddysaradhi/
├── apps/
│   ├── web/                       # Next.js 16 primary surface (kept)
│   └── gateway/                   # RETIRED as runtime. Becomes reference-only OR removed.
├── packages/
│   ├── core/                      # @buddysaradhi/core — 7 engines (ledger, sync, ...) (kept)
│   ├── shared/                    # Zod schemas, types, formatters (kept)
│   ├── ui/                        # Cross-platform glass primitives (kept)
│   └── db/                        # NEW: shared Prisma client + Prisma schema (replaces apps/gateway/prisma and root prisma) — optional follow-up, not blocking this PR
├── supabase/
│   └── functions/
│       ├── gateway/               # CANONICAL gateway backbone (Deno/TS)
│       │   ├── index.ts           # Single entry; routes /api/v1/* and /graphql
│       │   ├── lib/
│       │   │   ├── auth.ts        # JWT verify, tenant extraction
│       │   │   ├── db.ts          # libsql client + per-tenant cache
│       │   │   ├── schema.ts      # DDL idempotent CREATE TABLE IF NOT EXISTS
│       │   │   ├── log.ts         # Structured JSON logger (event, durationMs, tenantId, path)
│       │   │   ├── errors.ts      # Typed Result<T,E>, fail(msg, code, status)
│       │   │   └── cache.ts       # In-memory per-tenant cache (Map<string, {value, expiresAt}>)
│       │   ├── routes/
│       │   │   ├── students.ts    # GET / POST / PATCH / DELETE students
│       │   │   ├── attendance.ts  # GET / POST / POST lock, summary
│       │   │   ├── ledger.ts      # GET, POST payment, POST invoice, POST void
│       │   │   ├── settings.ts    # GET / PATCH
│       │   │   ├── analytics.ts   # GET /api/v1/analytics/dashboard
│       │   │   ├── notifications.ts
│       │   │   ├── sync.ts        # outbox GET / POST
│       │   │   └── security.ts    # erase, audit
│       │   └── graphql/
│       │       ├── schema.ts      # typeDefs
│       │       └── resolvers.ts   # read-only Query fields
│       └── provision-db/          # Kept (separate concern; provisions per-tenant Supabase row metadata)
├── tests/
│   ├── unit/
│   └── integration/
└── docs/
    └── superpowers/plans/         # Implementation plan + worklog
```

### Code Removed in This Plan
- `apps/gateway/src/routes/reports.ts` (overlapping with gateway analytics)
- `apps/gateway/src/routes/analytics.ts` (becomes part of canonical gateway)
- `apps/gateway/src/routes/attendance.ts` (becomes part of canonical gateway)
- `apps/gateway/src/routes/students.ts` (logic ported; runtime removed)
- `apps/gateway/src/routes/ledger.ts` (logic ported; runtime removed)
- `apps/gateway/src/routes/settings.ts` (logic ported; runtime removed)
- `supabase/functions/gateway-graphql/` (folded into `supabase/functions/gateway/graphql/`)
- `apps/web/src/server/app/api/v1/[...slug]/route.ts` — all REST branches that are now owned by gateway (keep only DB_NOT_PROVISIONED 503 detection helpers if needed)
- `apps/web/src/server/queries/dashboard.ts` (legacy)
- `apps/web/src/server/queries/dashboard-feed.ts` (legacy)
- `apps/web/src/server/queries/dashboard-heatmaps.ts` (legacy)
- Local fallback in `apps/web/src/app/api/v1/[...slug]/route.ts` that duplicates gateway logic

---

## 2. Performance Budgets (p95 Targets)

| Surface | p95 budget | p99 budget |
|---|---|---|
| Cached GET read (TanStack Query cache hit) | ≤ 30ms | ≤ 80ms |
| Warm uncached GET (gateway -> DB) | ≤ 80ms | ≤ 200ms |
| Cold GET (cache miss + DB analyze) | ≤ 150ms | ≤ 400ms |
| POST / PATCH / DELETE ack | ≤ 120ms | ≤ 300ms |
| Dashboard analytics summary | ≤ 100ms | ≤ 250ms |
| Student detail aggregate | ≤ 80ms | ≤ 200ms |
| Attendance roster read | ≤ 80ms | ≤ 200ms |
| Screen switch to usable data | ≤ 180ms | ≤ 400ms |

**Enforcement:**
- Gateway logs `{event, durationMs, path, method, tenantId, cacheHit}` for every request.
- Web BFF logs the same on every server action.
- CI fails if `p95` of any route exceeds its budget over a synthetic load profile (deferred to follow-up, but the log shape is required now).

---

## 3. Structured Logging Contract

Every gateway route handler emits **one** structured JSON log per request:

```json
{
  "ts": "2026-07-30T14:00:00.123Z",
  "level": "info" | "warn" | "error",
  "event": "gateway.request" | "auth.fail" | "cache.hit" | "cache.miss" | "db.query" | "mutation.success" | "mutation.failed" | "validation.fail",
  "tenantId": "uuid",
  "path": "/api/v1/students",
  "method": "GET" | "POST" | "PATCH" | "DELETE",
  "status": 200,
  "durationMs": 12,
  "cacheHit": true,
  "queryCount": 1,
  "errorCode": null,
  "message": "optional human readable"
}
```

Frontend (Next.js server actions, route handlers) emits matching shape with `event: "web.action"` / `event: "web.api"`.

**Logging rules:**
- Never use `console.log` in prod (already enforced by ESLint).
- Never throw away errors. Every error path logs at `error` level.
- Include `tenantId` for any tenant-scoped operation.
- Include `durationMs` for every request.
- Include `cacheHit` for any read.

---

## 4. Bug Fix Tasks (The 5 User-Visible Bugs)

### Task 1 — Attendance Tables Provisioning & Empty-State
Files: `supabase/functions/gateway/lib/schema.ts` (new), `supabase/functions/gateway/routes/attendance.ts`, `apps/web/src/server/actions/attendance.ts`

**Do:**
1. Add `lib/schema.ts` exporting `applySchema(db)`, which runs in `idempotent` mode and executes all `CREATE TABLE IF NOT EXISTS` statements from a single embedded SQL string.
2. On gateway boot or first request per tenant, call `await applySchema(db)` lazily. Track in a Set so it only runs once per tenant per cold start.
3. Verify the SQL includes `attendance_sessions`, `attendance_records`, `students`, `invoices`, `ledger_entries`, `receipts`, `notifications`, `audit_log`, `sync_outbox`, `settings`, `batches`, `student_enrollments`, `student_notes`, `student_documents`, `student_tags`, `tags`, `fee_schedule_items`, `fee_plans`, `reminders`, `backup_manifest`, `app_state`, `tutors`, `guardians`.
4. Update `fetchAttendanceSummaryAction` so an empty period returns `summaries: []`, `overall: { total_students: 0, overall_present: 0, ..., overall_percentage: 0 }` instead of throwing.
5. Update `AttendanceSummary` component to render a friendly "No attendance data for this period" empty state (already exists; verify copy).

**Do NOT:**
- Use raw `client.execute("SELECT...")` in components without checking row count.

**Verify:**
- New tenant DB: `attendance_records` and `attendance_sessions` exist after first request.
- Empty tenant: summary returns empty array, no SQL error.

---

### Task 2 — Student Delete via Gateway
Files: `supabase/functions/gateway/routes/students.ts`, `apps/web/src/server/actions/students.ts`, `apps/web/src/components/students/student-detail-drawer.tsx`

**Do:**
1. Add `app.delete("/api/v1/students/:id", ...)` in gateway route.
2. Inside gateway handler:
   - Begin transaction.
   - Delete in order: `student_enrollments`, `attendance_records`, `attendance_sessions`, `student_notes`, `student_documents`, `student_tags`, `student_documents`, `student`, all filtered by `tenant_id = ? AND student_id = ?`.
   - **Never** delete from `ledger_entries` or `receipts` (financial history is preserved).
   - Insert `audit_log` row with `action='student.delete'`.
   - Insert `sync_outbox` row with `op='delete', table='students'`.
   - Commit.
3. Update `apps/web/src/server/actions/students.ts` `deleteStudentAction` to call `gatewayDelete<{ ok: boolean }>('/api/v1/students/:id'.replace(':id', id))` (or `gatewayDelete('/api/v1/students/${id}')`).
4. In `student-detail-drawer.tsx`:
   - Use `useMutation` with `onMutate` to optimistically close the drawer and remove the student from the cache.
   - `onSuccess`: invalidate `["students"]`, `["dashboard"]`, `["student", id]`.
   - `onError`: re-open drawer with toast.

**Verify:**
- Delete a student row -> 200 from gateway, student removed from UI list, drawer closes instantly.

---

### Task 3 — Dashboard KPIs Live Data
Files: `supabase/functions/gateway/routes/analytics.ts`, `apps/web/src/server/actions/dashboard.ts`, `apps/web/src/components/buddysaradhi/dashboard-client.tsx`

**Do:**
1. Ensure `GET /api/v1/analytics/dashboard` returns:
   - `kpis.totalStudents` — count of active students.
   - `kpis.studentsWithDues` — count where `balance_paise > 0`.
   - `kpis.collectedThisMonthMinor` — sum of `credit_paise` for `ledger_entries.type='PAYMENT_RECEIVED'` with `occurred_on >= first-of-month`.
   - `kpis.dueTillDateMinor` — sum of positive `balance_paise`.
   - `kpis.dueForMonthMinor` — sum of `invoices.total` where `status IN ('unpaid','partial','overdue')` AND `due_date >= first-of-month`.
   - `kpis.overdueMinor` — `max(0, dueTillDateMinor - collectedThisMonthMinor)`.
   - `kpis.paymentBreakdown` — `paid`, `partial`, `unpaid`, `noDues` from invoice status counts.
   - `activity[]` — top 20 items (notifications + payment entries), sorted by timestamp desc.
   - `dueToday[]` — invoices with `due_date <= today` and status not paid.
2. Remove `apps/web/src/server/queries/dashboard*.ts` and any imports of them.
3. Update `dashboard-client.tsx` to consume `fetchDashboardSummaryAction` only.
4. Delete the now-unused `apps/gateway/src/routes/reports.ts` and `analytics.ts`.

**Verify:**
- KPIs reflect real-time sums (not zero).
- Due today list shows students with overdue invoices.

---

### Task 4 — Student Detail Renders All Fields
Files: `supabase/functions/gateway/routes/students.ts`, `apps/web/src/components/students/student-detail-drawer.tsx`

**Do:**
1. Update `GET /api/v1/students/:id` to return all 17 fields:
   - `id`, `code`, `first_name`, `last_name`, `dob`, `gender`, `phone`, `email`, `school`, `grade`, `board`, `address`, `admission_date`, `status`, `fee_model`, `base_fee_paise`, `balance_paise`, `notes`, `created_at`, `updated_at`.
2. In drawer, render **all** fields in Overview tab: phone, email, school, board, grade, admission date, fee model, base fee, address, DOB, gender, notes.
3. Surface attendance summary under Overview sub-section (compact 5-period stat row).

**Verify:**
- Open student detail — every field displayable; missing fields show "—" not blank.

---

### Task 5 — "Hot Reload" (Instant UI)
Files: `apps/web/src/app/providers.tsx`, `apps/web/src/stores/*`, `apps/web/src/components/**/*.tsx`

**Do:**
1. Verify `QueryClient` in `providers.tsx` has:
   - `staleTime: 30_000`
   - `gcTime: 5 * 60_000`
   - `refetchOnWindowFocus: true`
   - `retry: 1`
   - Add `refetchOnReconnect: true`.
2. Persist static stores in `sessionStorage`:
   - `useSettingsStore` — exclude `dirtySections` and `pendingNav` (ephemeral).
   - `useAttendanceStore` — persist `selectedDateIso`, `selectedBatch`, `searchQuery`.
   - `useFeesStore` — persist `mode`, `searchQuery`.
   - `useDashboardStore` — persist `periodFilter` only.
3. Wire every mutation with optimistic update:
   - `deleteStudentAction` — close drawer + remove row from `["students"]` cache.
   - `recordPayment` — append new payment to `["student", id, "invoices"]` and `["student", id, "ledger"]`.
   - `markAttendance` — update `["attendance", date, batch]` immediately.
4. Add `useUIState` Zustand slice for shared drawer open/close state.
5. Replace `useEffect` + raw fetch in `dashboard-client.tsx`, `attendance-client.tsx`, `fees-client.tsx`, `student-master-list.tsx` with `useQuery`.

**Verify:**
- Toggle sample DevTools "offline" — cached screens still render.
- Mutate student / payment / attendance — UI updates before network completes.

---

## 5. Repository Cleanup & Directory Unification

### 5.1 Retire `apps/gateway` Runtime
- Files to delete: `apps/gateway/src/db.ts`, `apps/gateway/src/prisma-client.ts`, `apps/gateway/src/libsql-proxy.ts`, `apps/gateway/src/index.ts`, `apps/gateway/src/dev.ts`, `apps/gateway/src/provisionTutorDb.ts`, `apps/gateway/src/cache.ts`, `apps/gateway/src/lib/db/admin.ts`, `apps/gateway/src/lib/respond.ts`, `apps/gateway/src/lib/logger.ts`, `apps/gateway/src/lib/heatmap.ts`, `apps/gateway/src/lib/security/secureErase.ts`, `apps/gateway/src/routes/*`, `apps/gateway/prisma/*`, `apps/gateway/scripts/*`, `apps/gateway/scratch_tx.ts`, `apps/gateway/verify-erase.ts`, `apps/gateway/vercel.json`.
- Remove `apps/gateway` from `pnpm-workspace.yaml` and `package.json` workspaces.
- Remove `package.json` from `apps/gateway/`.

**Decision point:** if `packages/core` still imports from `apps/gateway/src/db.ts`, port the `getPrismaClient` to `packages/db/src/db.ts` first (this is the `%5B2026-07-14-shared-db-package.md%5D(/docs/rfc/2026-07-14-shared-db-package.md)` RFC content). If no `packages/core` import, skip and delete directly.

### 5.2 Retire `supabase/functions/gateway-graphql/`
- Move schema and resolvers into `supabase/functions/gateway/graphql/`.
- Expose at `/graphql` route in `gateway/index.ts`.

### 5.3 Remove legacy Web BFF
- Files to delete: `apps/web/src/server/queries/dashboard.ts`, `apps/web/src/server/queries/dashboard-feed.ts`, `apps/web/src/server/queries/dashboard-heatmaps.ts`, `apps/web/src/server/queries/get-db.ts` (if it's only used by those), `apps/web/src/lib/api-client.ts` (if unused).
- Replace local fallback logic in `apps/web/src/app/api/v1/[...slug]/route.ts` with single catch-all that forwards to `gatewayBase()` and returns the gateway response. No local fallback for production paths.

### 5.4 Consolidation of Ledger Engine
- `apps/gateway/src/routes/ledger.ts` logic ported to `supabase/functions/gateway/routes/ledger.ts`.
- `packages/core/src/ledger.ts` is the canonical ledger ops module (already used by tests).
- `supabase/functions/gateway/routes/ledger.ts` calls into `packages/core` for ledger mutations, with the appropriate Prisma client.

---

## 6. Code Structure in `supabase/functions/gateway/index.ts`

Pseudo-structure for the new entrypoint:

```typescript
// 1. Imports: lib/, routes/, graphql, schema
// 2. Bootstrap: Deno.serve(async (req) => { ... })
// 3. Pipeline:
//    a. CORS preflight (OPTIONS) -> 204
//    b. Auth -> tenantId from JWT sub (one helper)
//    c. Path parser -> { path, method }
//    d. Logger wrapper -> log.start()
//    e. Apply schema lazily (first request per tenant)
//    f. Route dispatch:
//       - if path === '/graphql' && method === 'POST'   -> graphql handler
//       - if path.startsWith('/api/v1/')                  -> REST handler (registered routes)
//    g. Default 404 with structured error
//    h. Always log end with durationMs
```

---

## 7. Code Structure in `apps/web/src/server/actions/`

Drop duplicate wrappers. Each server action is **one** call to the gateway with a typed response:

```typescript
// Example
export async function fetchDashboardSummaryAction() {
  return gatewayGet<DashboardSummary>('/api/v1/analytics/dashboard');
}
```

No fallback DB logic in web actions. Health/readiness actions may keep a local echo for dev only.

---

## 8. Shared Schema Generation

`supabase/functions/gateway/lib/schema.ts` includes the DDL for all tables. Replace the duplicated DDL in:
- `migrations/0001_init.sql` (keep as canonical, but gateway no longer executes it directly)
- `supabase/migrations/0001_init.sql` (used by Supabase Postgres for `provision-db`)
- `apps/mobile/src/lib/db/migrations/0001_init.sql`
- `apps/desktop/src-tauri/migrations/V0001__init.sql`

**Decision:** gateway uses libsql against Turso (not Supabase Postgres). The schema gateway executes is the same SQL as `migrations/0001_init.sql`, just trimmed to libsql syntax (no `gen_random_uuid()`, `now()`, etc.; use `crypto.randomUUID()` and ISO date strings).

---

## 9. Indexes (P95 Enforcement)

Add these indexes (in `lib/schema.ts`):

```sql
CREATE INDEX IF NOT EXISTS idx_students_tenant_status ON students(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_students_tenant_archived ON students(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_type_occurred ON ledger_entries(tenant_id, type, occurred_on);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_student ON ledger_entries(tenant_id, student_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status_due ON invoices(tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant ON attendance_records(tenant_id, session_id, student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_tenant_date ON attendance_sessions(tenant_id, session_date);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_tenant_status ON sync_outbox(tenant_id, status, created_at);
```

---

## 10. Validation Plan (Executed After Each Task)

```bash
# Type-check
bun run typecheck

# Lint
bun run lint

# Unit tests
bun run test:unit

# Integration tests (in-memory sqlite)
bun run test:integration

# A11y
bun run test:a11y

# Manual smoke: deploy supabase functions + hit each endpoint
supabase functions deploy gateway --project-ref gmqwdnvbfnwpzpctwvho --no-verify-jwt
curl -H "Authorization: Bearer <jwt>" -H "X-Db-Url: ..." https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway/api/v1/analytics/dashboard
curl -X DELETE -H "Authorization: Bearer <jwt>" -H "X-Db-Url: ..." https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway/api/v1/students/<id>
```

After manual smoke:
- p95 latency logged < 100ms for dashboard.
- Student delete returns 200 and removes cascading rows.
- Attendance summary returns 0-state when empty.

---

## 11. Execution Order (For Implementation Agents)

1. **Setup**: write `supabase/functions/gateway/lib/schema.ts` and `log.ts`.
2. **Port routes**: copy logic from `apps/gateway/src/routes/*` into `supabase/functions/gateway/routes/*`. Keep `oid` and `ok` helpers.
3. **Add DELETE student**: Task 2 above.
4. **Remove analytics duplication**: Task 3 above.
5. **Wire web mutations**: update `apps/web/src/server/actions/students.ts` to call gateway.
6. **Update drawer**: optimistic delete + full field display.
7. **Wire query hooks**: across all 5 screens.
8. **Add sessionStorage persistence**: settings + attendance + fees + dashboard stores.
9. **Delete legacy code**: `apps/gateway`, `supabase/functions/gateway-graphql`, `apps/web/src/server/queries/dashboard*`.
10. **Lint, typecheck, tests, deploy**: validation plan.

---

## 12. Open Questions (None Critical)

- **Future**: should home dashboard use GraphQL `query { dashboardSummary }` instead of REST? Recommendation: defer to v1.x once GraphQL is exercised end-to-end. Current REST `/api/v1/analytics/dashboard` is simpler and faster to ship.
- **Future**: persistent TanStack Query cache via `localStorage` after login (PersistedQueryClient) to survive refresh. Defer to v1.x.

---

## 13. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| DDL on every cold start slow | Med | Idempotent CREATE TABLE IF NOT EXISTS; track per-tenant in `Set`; run only first time per process |
| Optimistic mutation reverted on server error | Med | Always `onError` rollback; show toast |
| GraphQL schema drift vs REST | Low | Single source of truth: REST routes; GraphQL resolvers call typed REST handlers internally |
| `apps/gateway` removal breaks `packages/core` | Med | Check `packages/core/src/ledger.ts` imports first; port to `packages/db` before deletion |
| `sessionStorage` persists stale data | Low | Versioned keys (`sets.v1`); reset on logout |

---

## 14. Acceptance Criteria — "Done" Definition

- [ ] All 5 user-visible bugs fixed.
- [ ] Gateway runtime is exactly `supabase/functions/gateway`. No other process running.
- [ ] `bun run typecheck` and `bun run lint` pass.
- [ ] All tests pass (unit, integration, a11y).
- [ ] Structured JSON log emitted for every gateway request with `durationMs`, `tenantId`, `path`, `status`, `cacheHit`.
- [ ] Mutations feel instant (< 50ms perceived) on a fast connection.
- [ ] Cached screen switches render in < 30ms.
- [ ] `apps/gateway` folder removed; `supabase/functions/gateway-graphql` removed.
- [ ] No duplicate DDL sources for libsql.
- [ ] `AGENTS.md` non-negotiables 1-10 all upheld (no float money, no telemetry, no silent failures, no `console.log` in prod, append-only ledger, etc.).

---

## 15. Files to Read Before Editing

For each implementation agent, in order:

1. `AGENTS.md` — operating manual; non-negotiable rules.
2. `02_Core_Logic.md` — engine contracts.
3. `12_Business_Rules.md` — `BR-*` rules.
4. `17_API_Gateway_System.md` — gateway architecture.
5. The current plan file (this).
6. `apps/web/src/server/get-db.ts` and `apps/web/src/server/actions/*` — to see current server-action pattern.
7. `supabase/functions/gateway/index.ts` — to see current gateway wiring.
8. `packages/core/src/ledger.ts` — to see canonical ledger code.

---

## 16. Code Indexing / "Second Brain" Reminders

If the implementation agent needs deeper context, read:
- `docs/rfc/2026-07-14-shared-db-package.md` — DB package consolidation.
- `docs/superpowers/plans/*` — historical implementation plans.
- `worklog.md` — past session summaries.
- `packages/core/src/ledger.ts` — the financial spine.

---

*End of plan. Ready for implementation.*
