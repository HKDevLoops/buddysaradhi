# libSQL / Turso

- **Docs:** https://docs.turso.tech/libsql (what libSQL is) · https://docs.turso.tech/sdk/ts/quickstart (TypeScript) · https://docs.turso.tech/sdk/ts/reference (TS reference) · https://docs.turso.tech/sdk/ts/orm/prisma (Prisma adapter)
- **Pinned:** `@libsql/client@^0.17.4` → **0.17.4** in `apps/web`; `^0.14.0` in `packages/core`; `npm:@libsql/client@^0.14.0` in `apps/gateway/deno.json`. The lockfile also carries `0.8.1` transitively.

> Turso now ships three client packages and its docs lead with the newer ones. **This repo uses `@libsql/client`** — the classic remote client — with the Prisma driver adapter. Do not substitute `@tursodatabase/serverless` or `@tursodatabase/database` without reading [prisma.md](prisma.md); the ORM wiring differs.

## Project specifics

### `CREATE TABLE IF NOT EXISTS` cannot drop, relax, or rename a column — a repair needs a table REBUILD

This is the single most expensive lesson in this repo's history, and it is SQLite grammar, not a bug.

Pre-`0002` tenant databases carried `invoices.invoice_number` / `period_start` / `period_end` / `subtotal_paise` / `total_paise` as **`NOT NULL` with no default**, and `receipts.receipt_no NOT NULL` with no `number` and no `ledger_entry_id`. The canonical writers in `packages/core` write the current grammar, so every payment failed:

```
Not saved. SQLITE_CONSTRAINT: SQLite error: NOT NULL constraint failed:
invoices.invoice_number. Nothing was written.
```

The gateway's self-heal (`apps/gateway/lib/schema.ts`) is `CREATE TABLE IF NOT EXISTS` throughout, so it **could never repair those columns** — it sees the table exists and skips it. Fixing it required the standard SQLite rebuild procedure in `migrations/0002_canonical_invoices_receipts.sql`: new table → copy → drop → rename → recreate indexes. Rows are preserved **including their `id` values**, so every `ledger_entries.invoice_id` and `receipts.ledger_entry_id` reference keeps pointing at the same row.

The failure was at least honest — the transaction rolled back whole (AGENTS.md §2 Rule 7), so no half-written payment ever reached the ledger. But the feature was simply unavailable.

**The rule that follows:** if a migration needs to *change* an existing column rather than add a table, it is a rebuild, and it must be gated on a `pragma_table_info` probe so it never runs against a database already on the canonical shape.

### The tenant DB URL comes from Supabase `user_metadata`, NOT `TURSO_DATABASE_URL`

There is one tenant DB per tutor (AGENTS.md §1.2 — single-tenant SQLite, `tenant_id` is defence-in-depth, not the partitioning key). The URL and token are stored on the Supabase user's `user_metadata` as `db_url` / `db_token` by the `/api/v1/provision` route, and read from there on every request:

- `apps/web/src/lib/db.ts` (cache key + credential resolution)
- `apps/web/src/server/get-db.ts` (`user.user_metadata as Record<string, unknown>`)
- `apps/web/src/lib/turso/client.ts` — the file's own comment says it: *"they use db_url + db_token from user_metadata, NOT env vars."*
- `apps/web/src/lib/supabase/middleware.ts` (session refresh path)

**A hardcoded env-var fallback is a P0 bug here** (AGENTS.md §10 AP-12). It was one: `db.ts` carried a literal Windows `file:Z:/Projects/...` path and a `dummy-token` as the fallback, which meant the "not provisioned" guard never fired in tests — 4 test failures traced to a local-dev convenience that had leaked into production code. `db.ts` now throws `DB_NOT_PROVISIONED` when the credentials are absent.

`apps/web/src/lib/db.ts` also uses a `DB_NOT_PROVISIONED`-style sentinel written into `user_metadata` to mark "a real DB has not been provisioned yet", so that case is distinguishable from "the user record is broken".

### The web DB client is a bounded LRU with a cascading eviction hook — not a `Map`

Phase 2 of TABS-HARDEN-01 found the caches were already bounded at 64, but with three real defects:

1. `lruSet` was **FIFO, not LRU** — the tenants serving live traffic were not the ones surviving.
2. The two caches were keyed by **RAW vs NORMALISED url**, so one database could hold two entries.
3. Evicting a client **orphaned its ORM proxy** — two live handles per tenant while the map claimed to be bounded.

`apps/web/src/lib/lru.ts` now provides a shared `BoundedCache` that fixes all three: true LRU via native `Map` delete+re-insert, one keyspace, and an `onEvict` hook so eviction cascades to the proxy. `lib/offline-queue.ts` uses the same class (bounded at 8 tenants) **and surfaces every eviction by name** (AGENTS.md §2 Rule 9 — bounded state must report its own bound, never grow silently).

Two module-level `Map`s were audited and **left alone**, deliberately: `intent-key`'s `lastEntropy` is proven per-process-safe, and `xlsx-template`'s `CRC_TABLE` is not a cache at all — it is the 256-entry table covering every possible byte.

### Never mock the DB in a ledger test (AGENTS.md §7.3)

Use a real file-backed SQLite database. A mocked DB tells you nothing about whether a trigger fires.

**And a fixture must model the STRICTER legal shape.** A test fixture built from the *permissive* schema let `batches.tutor_id` pass CI and then crash production. Relatedly, a fixture that *provisioned a fresh* DB made the parity gate report **192/192 green while the product could not take a payment at all** — `packages/core/src/migration0002.test.ts` now builds the REAL legacy shape and reproduces the repair. Recorded in `docs/mindmap.md` §6.

## The schema authorities — exactly TWO (AGENTS.md §3.4)

1. `migrations/` + Prisma (`0001_init.sql`, `0002_canonical_invoices_receipts.sql`)
2. `apps/gateway/lib/schema.ts` `ensureSelfRepairingSchema` — the single audited self-heal for gateway-managed tenant DBs

**These two must agree.** `apps/web` runtime code may not execute DDL at all: no `CREATE TABLE` in `libsql-proxy.ts`, in any query, server action, or API route. A missing table is a **loud typed error naming the table and both authorities** (Rule 9) — never a silently self-created table and never a fabricated empty result set.

SQL text may exist only in those two audited places, plus SQLite admin commands with no ORM equivalent (`PRAGMA key`, `PRAGMA wal_checkpoint(TRUNCATE)`, `PRAGMA foreign_keys=ON`) confined to `lib/db/admin.ts`. `scripts/principle-lints.ts` L6 (`no-raw-sql`, P0) enforces this — a tripped build fails with no override without a spec citation, a security reviewer, and an expiry.

## Related

- [prisma.md](prisma.md) — the ORM shim that must honour `orderBy`, `select`, atomic `increment`, and roll back on throw.
- [deno.md](deno.md) — the gateway's second schema authority.