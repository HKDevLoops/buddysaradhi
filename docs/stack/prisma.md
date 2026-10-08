# Prisma 6

- **Docs:** https://www.prisma.io/docs/orm/overview/introduction/what-is-prisma · generator config: https://www.prisma.io/docs/orm/prisma-schema/overview/generators · SQLite provider: https://www.prisma.io/docs/orm/overview/databases/sqlite · Turso driver adapter: https://docs.turso.tech/sdk/ts/orm/prisma
- **Pinned:** `prisma@6.2.1` (root devDependency), `@prisma/client@6.2.1`, `@prisma/adapter-libsql@6.2.1` — **all exact pins, no caret**
- **Schema:** `prisma/schema.prisma` — the single source of truth for every model
- **Generated on:** root `postinstall` (`prisma generate`) and root `build`

## Project specifics

### Prisma is the schema of record; the runtime is mostly the shim, not the client

`@prisma/client` has ~20 direct import sites, all in `packages/core/src` (the money engines, typed structurally against narrow ports so `@prisma/client` is a *type* dependency). `apps/web` does **not** use the generated client directly: `apps/web/src/lib/db.ts` returns a `LibsqlProxy` from `apps/web/src/lib/libsql-proxy.ts`, an ORM shim over `@libsql/client`.

`serverExternalPackages: ["@prisma/client"]` in `next.config.ts` keeps it out of the server bundle.

### `libsql-proxy.ts` is a CONTRACT, not a convenience

It is tested like one — `apps/web/src/lib/libsql-proxy.transactions.test.ts` runs against a **real file-backed libSQL DB**, because a shim that looks like Prisma while quietly dropping a guarantee is worse than raw SQL. Four properties it must honour, each earned by a bug:

- **`$transaction` opens ONE libSQL write transaction** around a callback and rolls back on any throw.
- **The Prisma-shaped ARRAY form throws.** Its entries are already-started promises that auto-committed before the call, so it can never be atomic. **Never write `db.$transaction([...])`** — use the callback form and put the primary write *inside* it (AGENTS.md §2 Rule 7).
- **`orderBy` and `select` are honoured** in `findFirst`/`findUnique`/`findMany`. A chain-tip read without `orderBy` returned an arbitrary row, which produced a **wrong running balance** before it was caught.
- **Atomic `{ increment }` / `{ decrement }`** so a sequence is consumed *in the database* (BR-LED-03), never read-modify-written in JS.
- **`updateMany().count` exists** so a caller can prove the row existed inside the transaction. An `update` that matched nothing must not look like a success.
- **Anything the shim cannot honour throws.** It never silently ignores an argument and never reports an operation as stronger than it is (Rule 9).

### ORM-only at runtime, CI-enforced (P0)

Allowed: `findMany`, `findUnique(OrThrow)`, `findFirst`, `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`, `count`, `aggregate`, `groupBy`, `$transaction`, `include`, `select`.

Forbidden and auto-blocked by `scripts/principle-lints.ts` L6 `no-raw-sql`: `$queryRaw`, `$executeRaw` (+ `Unsafe`), `client.execute` with a SQL string, backtick SQL template literals, `PRAGMA`, `sqlite_*` in request paths. A PR tripping L6 removes the SQL — it does not grow the allowlist.

### The ledger is append-only, everywhere

`ledgerEntry.update()` / `.delete()` / `.deleteMany()` are forbidden in **every** dialect (AGENTS.md §2 Rule 1). Voids are new rows carrying `reverses_entry_id`. Defended in depth: Prisma middleware rejects the calls, **and** the SQLite triggers `trg_ledger_no_update` / `trg_ledger_no_delete` abort any UPDATE/DELETE on `ledger_entries`. CI lint `principles/no-ledger-mutation.py` scans for it too.

This is a §8 stop-and-ask trigger (2 reviewers, including a ledger-crypto reviewer).

### One money flow, two I/O dialects — and the parity gate is the point

AGENTS.md §3.5. The logic that decides what a tutor's books say lives **exactly once**, in `packages/core/src/feesFlow.ts`. `fees.ts` is the libSQL dialect; `feesPrisma.ts` is the ORM dialect. A dialect implements row-level operations and **decides nothing** about money.

`packages/core/src/feesDialectParity.test.ts` runs both over the same schema on a fresh real DB per iteration and asserts identical invoices, numbers, status transitions, ledger rows, balances, tamper hashes, and outbox/audit rows. **A behaviour change that lands in one dialect only fails here instead of in a tutor's books.** Two real defects came from forking the flow: divergent hash construction, and payments attributed against `invoices.total`.

### The tamper-hash formula is a contract with its verifier

`apps/web/src/lib/ledger/tamper-check.ts` **recomputes** the same four-field formula the writers emit. A "better" formula in one place would mark every receipt ever written as tampered. If you change the formula, you change both sides in the same commit or you break verification retroactively.

## Related

- [libsql.md](libsql.md) — the shim, the two schema authorities, and the tenant-credential rule.
- [packages-core.md](packages-core.md) — the ledger engine and the parity gate in full.