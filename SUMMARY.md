# Anchored Summary — Gateway Ledger Production-Readiness

## Objective
Make the ledger production-grade in `apps/gateway`: dev-gate the seed, add empty-init
for real tutors, add a tamper-verify command, and add real per-tutor DB provisioning
via `provisionTutorDb`.

## Status: CORE TASK COMPLETE (seed + verify pass)
- `bun run prisma/seed.ts` → `[demo] seeded local-dev tenant: 3 students, 6 ledger entries, 3 invoices`
- `bun run scripts/verify-ledger.ts` (TENANT_ID=local-dev) → `PASSED: ledger integrity verified` exit 0

## Important Details
- AGENTS.md §2/§7: append-only (BR-LED-01), integer paise (BR-M-01), sync_outbox per
  mutation (BR-SYN-01), no silent failures/console.log in prod, AES-256-GCM backups.
- libsql interactive `$transaction` works.
- `@prisma/client` resolves from repo root + `apps/gateway/node_modules` (NOT core).
  `packages/core/src/ledger.ts` uses it only for types; scripts pass full client via
  relative import `../../packages/core/src/ledger.ts` (works at runtime).
- **Actual schema field names (gateway/prisma/schema.prisma):**
  - Setting: tenantId, instituteName, currencyCode, locale, timezone, invoicePrefix,
    receiptPrefix, tenantSecret, + notify fields are `notifyDueFee`, `notifyUpcomingDue`,
    `notifyMissingAttendance`, `notifyInactiveStudent` (NOT notifyOnDue/Payment/etc),
    createdAt required, updatedAt @updatedAt.
  - Student: `firstName`, `lastName`, `dupKey` (required, unique/tenant), `admissionDate`
    (required), `status`, `feeModel`, `baseFeePaise`, `balancePaise`. NO `name`/`rollNo`/
    `batchId`/`parentName`/`monthlyFeePaise`.
  - Batch: id, tenantId, name, subject, schedule, archivedAt, createdAt, updatedAt.
    NO grade/academicYear/isActive.
  - LedgerEntry: created via postLedgerEntry (prevHash, balanceAfterPaise, tamperHash,
    signedHash, batchId optional). hashChain via computeHash.
  - Invoice: `number`, `issueDate`, `dueDate`, `subtotal`, `discount`, `extraCharges`,
    `total`, `status`, `tamperHash`. NO invoiceNo/invoiceDate/lineItemsJson/paidPaise.
  - AppState: tenantId, schemaVersion, createdAt required.
- Hash mismatch: seed hashChain ≠ reconcileLedger computeHash → demo ledger MUST be
  re-posted via postLedgerEntry (done). verify re-derives via reconcileLedger.
- Gateway Prisma client at `src/prisma`; `provisionTutorDb.ts` uses
  `import type { PrismaClient } from "./prisma-client"`.
- `getPrismaClient(dbUrl, dbToken)` caches by `dbUrl::dbToken`.
- `.env` (apps/gateway): DATABASE_URL=file:prisma/dev.db, PORT=3001,
  GATEWAY_ADMIN_TOKEN=dev-only-change-me, ALLOWED_ORIGINS=http://localhost:3000.
  Bun auto-loads `.env` → all target prisma/dev.db.
- `prisma db push` created prisma/dev.db. A prior failed old-seed run left stale rows
  (student x3, studentEnrollment x3, batch x1) — clear order in seed deletes children
  (ledgerEntry, invoice, studentEnrollment, feeScheduleItem) BEFORE student/batch.
- Provision page polls `user.user_metadata?.db_url` (Supabase auth); uses createSupabaseBrowser().

## Files
- `apps/gateway/prisma/seed.ts` — `--init [tenantId]` (random tenantSecret + AppState
  upsert, empty) and `--demo` (idempotent clear + reseed via postLedgerEntry, dev-only
  gate, dev default). PROD: no-op unless flag. WORKS.
- `apps/gateway/scripts/verify-ledger.ts` — walks students, reconcileLedger, exit 1 on
  tamper. WORKS (exit 0).
- `apps/gateway/src/provisionTutorDb.ts` — `provisionTutorDb(dbUrl, dbToken)` →
  {tenantId, tenantSecret, dbUrl, dbToken, prisma}; upserts Setting + AppState; random
  tenantSecret (randomBytes(32).hex). minimal Setting fields (tenantId/tenantSecret/createdAt).
- `apps/gateway/src/index.ts` — dev-gated `POST /api/v1/dev/provision` (skipped when
  NODE_ENV=production) using provisionTutorDb, added before registerSettings(app).
- `apps/gateway/package.json` — scripts: `seed` (prisma/seed.ts), `provision`
  (prisma/seed.ts --init), `verify` (scripts/verify-ledger.ts).
- `packages/core/src/ledger.ts` — postLedgerEntry / reconcileLedger (unchanged; relied on).

## Work State
### Completed
- seed.ts (demo+init) ✅ runs
- verify-ledger.ts ✅ runs, PASSED
- provisionTutorDb.ts ✅ written
- index.ts dev provision route ✅ added
- package.json scripts ✅ added

### Deferred / Not Done
- Supabase Edge `provision-db` function not yet wired to call `provisionTutorDb` over
  HTTP (the actual per-tutor Turso creation lives in supabase/functions/provision-db;
  gateway route is the local analog). Not started.
- sync_outbox write: postLedgerEntry does NOT append sync_outbox (known gap per
  AGENTS §7; out of scope for this seed/verify task but should be flagged in review).
- Lint/typecheck not run (no `bun run lint` in gateway; LSP shows only pre-existing
  errors in unrelated files: payments-client.tsx, glass-shell.tsx, start-all.js,
  inspect2.mjs). My new files report no LSP errors.

## Next Move (optional)
1. Wire supabase/functions/provision-db to POST to gateway /api/v1/dev/provision (or
   replicate provisionTutorDb logic server-side) for real tutors.
2. Add sync_outbox append inside postLedgerEntry (BR-SYN-01) — flag as separate task.
3. Run `bun run lint` / typecheck in gateway before PR.
4. Update worklog.md per AGENTS §9.1.
