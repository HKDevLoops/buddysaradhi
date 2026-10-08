# packages/core — the ledger engine

- **Package:** `@buddysaradhi/core` v1.0.0
- **Docs for its dependencies:** [prisma.md](prisma.md) · [libsql.md](libsql.md) · [vitest.md](vitest.md)
- **Pinned deps:** `@libsql/client@^0.14.0`, `zod@^3.24.2`; dev: `@prisma/client@6.2.1`, `fast-check@^4.8.0` (resolves 4.9.0), `vitest@4.1.9` (**exact**), `@vitest/coverage-v8@^4.1.9`
- **Build:** `tsc` → `./dist` (CommonJS + `.d.ts`); subpath exports: `/fees`, `/feesFlow`, `/feesPrisma`
- **Tests:** 200 (`pnpm --filter @buddysaradhi/core exec vitest run`), `paseed` against real SQLite — never mocked

## Why this earns its own file

This is the package AGENTS.md calls **the spine**. It is also a §8 stop-and-ask surface: any change to `ledger_entries` grammar or to the posting logic needs **2 reviewers, including a ledger-crypto reviewer**.

## Project specifics

### One money flow, two I/O dialects (AGENTS.md §3.5)

The logic that decides what a tutor's books say lives **exactly once**, in `feesFlow.ts`. A second copy of it is a P0 defect, not a convenience.

| Layer | File | Owns |
|---|---|---|
| Money flow (the spec'd behaviour) | `src/feesFlow.ts` | audit-first ordering, per-invoice attribution, overpayment split, auto-invoice, the fail-closed attribution invariant |
| libSQL dialect | `src/fees.ts` | the same flow's statements |
| ORM dialect | `src/feesPrisma.ts` | the same flow's model calls |
| Ledger append | `src/ledger.ts` (`postLedgerEntry`), `src/ledgerSql.ts` (`postLedgerEntrySql`) | hash chain, balance sync, outbox |

`feesFlow.ts` declares a narrow `FeeTx` port (require student / require tenant secret / take invoice number / insert invoice / set invoice status / open invoices / credited for invoice / post entry / write audit / write settings outbox). **A dialect implements only those row-level operations and decides nothing about money.**

Dialects are typed **structurally** (`OrmTx`, `SqlExecutor`), never against the generated client — deliberately, so pinning one implementation cannot break the other two or drag `@prisma/client` into a package that only needs it for types.

### `feesDialectParity.test.ts` is THE gate

It runs both dialects over the same schema, **on a fresh real database per iteration**, and asserts identical invoices, numbers, status transitions, ledger rows, balances, tamper hashes, and outbox/audit rows.

**A behaviour change that lands in one dialect fails here, not in a tutor's books.** When you add a money rule, change `feesFlow.ts` and both dialects together. Never "just this one path" — two real P0s came from exactly that mistake: divergent hash construction (which would have marked every receipt ever written as tampered), and payments attributed against `invoices.total` instead of the correct per-invoice amount.

### The tamper hash is a two-sided contract

`computeInvoiceTamperHash` / `computeReceiptTamperHash` emit a specific four-field formula that `apps/web/src/lib/ledger/tamper-check.ts` **recomputes**. Changing one side without the other retroactively invalidates every existing receipt. It is a contract, not a choice.

### The ledger is append-only — three layers of defence

`ledgerEntry.update()` / `.delete()` / `.deleteMany()` are forbidden (AGENTS.md §2 Rule 1). A void is a **new row** carrying `reverses_entry_id`, written in the same `db.$transaction([...])` as the `audit_log` row with action `ledger_void`. Enforced by Prisma middleware, the SQLite triggers `trg_ledger_no_update` / `trg_ledger_no_delete`, and CI lint `principles/no-ledger-mutation.py`.

### Never mock the database in a ledger test (AGENTS.md §7.3)

A mocked DB tells you nothing about whether a trigger fires. Use a real file-backed SQLite database and run the real migrations.

**And a fixture must model the STRICTER legal shape.** A permissive fixture let `batches.tutor_id` pass CI and crash production. Worse: a fixture that *provisioned a fresh* DB made the parity gate report **192/192 green while the product could not take a payment at all**. `src/migration0002.test.ts` now builds the REAL legacy grammar and reproduces the repair — see [libsql.md](libsql.md) for the full story.

### `fast-check` is a devDependency with property tests

Used for property-based coverage of the money invariants (round-to-half-even on paise per BR-M-01 / EC-F-01, etc.). Its presence is not optional in the sense that AGENTS.md §8 flags a Ponytail-style "YAGNI on tests" collision as an escalation item, not a licence.

## Related

- [prisma.md](prisma.md) — the ORM dialect's underlying contract requirements.
- [packages-shared.md](packages-shared.md) — the schemas and fee arithmetic this package consumes.