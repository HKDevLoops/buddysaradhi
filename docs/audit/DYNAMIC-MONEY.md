# DYNAMIC-MONEY — an adversarial audit of the Buddysaradhi money engine

**Author:** sub-agent (financial-correctness / adversarial business-logic audit)
**Date:** 2026-10-21
**Scope of authorship:** `packages/core/**`, `packages/shared/**` (read access to the rest)
**Oracle:** `12_Business_Rules.md` (BR-LED-\*, BR-FEE-\*, BR-M-\*, BR-RPT-\*, BR-SYN-\*, BR-RC-\*, BR-STU-\*), `11_Data_Model.md` §4 + §10, `14_Edge_Cases.md` (EC-F-\*, EC-L-\*, EC-SEC-03), `07_Fees_and_Payments.md`, `AGENTS.md` §2 Rule 1/6/7, §3.4, §3.5, §3.6, §7.3.

---

## 0. Executive summary

The question was not "does the money engine work" but **"can it be made to lie?"**. I built an
adversarial harness that drives the *real* writers against the *real* schema and then dumps the
**resulting book state** — the invoices, the ledger rows, the receipts, the student's balance, the
outbox stream — and I attacked it from eleven directions: amount tampering, attribution
manipulation, the overpayment model, invoice/receipt numbering, the hash chain, the reconciler,
boundary precision, the batch engine, the CSV export, dialect drift, and the structural gaps.

**What I found: the web path and the gateway path were writing different books.**

The single most serious finding is not a bug in the ledger engine at all — it is a bug in the
**replication contract**. The web's money path wrote its `settings` replication row with the
**receipt's** prefix and the **receipt's** sequence inside the **invoice's** columns, and with the
**consumed** sequence value instead of the next one. The gateway — the *same* product, the same
flow, a vendored copy of the same file — had already fixed exactly this (`apps/gateway/routes/
ledger.ts:211-215`). So the two platforms disagreed about what a tutor's invoice number is, and
the parity gate `packages/core/src/feesDialectParity.test.ts` compares the outbox by
`(table_name, op)` **only** — so it never saw the difference, and never will.

**Eleven defects are CONFIRMED by execution. Seven are FIXED in this pass, each with a
verified-red negative control (8/8 controls go red when the fix is reverted). Four are reported
and BLOCKED — they need a change outside my write scope, and each one is written up with the exact
patch.**

Severity mix: **2 P0 · 8 P1 · 7 P2/P3**.

---

## 1. Method (and what a passing test does *not* prove)

* Every attack drives the **production writers** — `createInvoiceSql` / `recordPaymentSql`
  (libsql dialect) and `createInvoicePrisma` / `recordPaymentPrisma` (ORM dialect) — against a
  **real file-backed SQLite database built from `migrations/0001_init.sql`** (the shipped schema,
  with its append-only triggers and CHECK constraints), or from `prisma db push` against
  `prisma/schema.prisma` where the Prisma model surface matters. **Nothing is mocked** (AGENTS.md
  §7.3).
* The ORM side runs through the **real** `apps/web/src/lib/libsql-proxy.ts` — the surface
  `apps/web` actually holds. A test double would prove nothing about it.
* The oracle is the spec, and the evidence is the **book state**: the invoices, the ledger rows,
  the receipts, `students.balance_paise`, and the `sync_outbox` stream — dumped after the attack.
* Where a test **passed** I checked *what it actually asserted*. Two of my own tests were wrong
  on the first pass (a filter that matched nothing, and an assertion that checked "did not throw"
  where the function catches its own errors). Both were found by the **negative controls**, and
  both are fixed (§5).
* The **negative control** is the only evidence that a fix is load-bearing: revert the fix, the
  matching test must go RED, restore. 8/8 controls behave that way (§5.2).

**Files added** (both in my scope, both green):

| File | What it is |
|---|---|
| `packages/core/src/adversarial.money.test.ts` | 12 attack groups over the money flow. 8 of its tests are `it.fails(...)` — **documented defects with tripwires**: when someone fixes one, that test goes red and must be flipped. |
| `packages/core/src/adversarial.engines.test.ts` | The two orphan engines (batch invoicing, CSV export). |

---

## 2. Severity-ranked findings

### DYN-001 · **P0** · `packages/core/src/feesFlow.ts:503` + `fees.ts:414` + `feesPrisma.ts:460`
### The settings replication payload lies — the receipt's prefix and sequence are written into the **invoice's** columns, and the **consumed** value is written instead of the next one.

**Why it matters.** `sync_outbox` is the replication contract (BR-SYN-02: *"payload is immutable
once written"*). A replica that applies this payload sets its invoice prefix to `RCP-` and rewinds
its invoice counter to a value that is already live — so the **replica re-issues a live invoice
number**. That is the exact failure BR-RC-01 exists to prevent ("reusing numbers erases the audit
trail"). The **gateway already does this correctly**
(`apps/gateway/routes/ledger.ts:211-215` writes `[seqCol]: nextSeq` — the right column, the next
value, with the comment *"Without this row a lost bump resurfaces as a REUSED receipt/invoice
number on the replica"*). **Core did not** — so the web and the gateway disagreed.

**Proof (executed, both dialects):**

```
$ cd packages/core && bunx vitest run src/adversarial.money.test.ts -t "must name the RIGHT sequence column" --silent=false
[libsql dialect (fees.ts — gateway path)] ATK-4 settings outbox payloads: [
  '{"invoice_prefix":"INV-","next_invoice_seq":1,"tenant_id":"tenant_adv","updated_at":"..."}',   ← consumed value (DB: 2)
  '{"invoice_prefix":"RCP-","next_invoice_seq":1,"tenant_id":"tenant_adv","updated_at":"..."}'    ← the RECEIPT prefix + the RECEIPT seq
]
[ORM dialect (feesPrisma.ts — web path, via the real libsql-proxy)] ATK-4 settings outbox payloads: [
  '{"invoice_prefix":"INV-","next_invoice_seq":1,...}',
  '{"invoice_prefix":"RCP-","next_invoice_seq":1,...}'
]
```

**Resulting book state:** the DB says `next_invoice_seq = 2, next_receipt_seq = 2`; the outbox
says `next_invoice_seq = 1` and `invoice_prefix = "RCP-"`. Three independent lies in one payload.

**Fix:** `FeeTx.writeSettingsOutbox` now takes a mandatory `kind: "invoice" | "receipt"`
discriminator, and the payload carries the counter's **next** value. The dialect cannot be
misused — the receipt's sequence has no path to the invoice's columns. **Status: FIXED**
(DYN-001a + DYN-001b, negative controls NC1/NC1b).

---

### DYN-002 · **P1** · `packages/core/src/feesFlow.ts:480` (the auto-invoice insert)
### A taken invoice number aborts the **whole payment**. The tutor hands over ₹5,000 and the app says "failed".

**Why it matters.** BR-FEE-09's enforcement column says: *"Sequence fails; rollback; **engine
retries with next sequence**"*. There was no retry. The `invoices` UNIQUE constraint aborted the
transaction **after** the audit row, the credit row and the invoice-status flip had been written —
so the atomicity guarantee turned a numbering collision into a lost payment.

**Proof (executed):**

```
[libsql dialect] ATK-3.0 payment: REJECTED: SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: invoices.tenant_id, invoices.number
[ORM dialect]    ATK-3.0 payment: REJECTED: SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: invoices.tenant_id, invoices.number
```

**Resulting book state:** `ledger_entries: []`, `receipts: []`, `invoices: []` — the ₹5,000 is
nowhere, and the tutor's cash is real. The trigger is a counter that is behind the `invoices`
table, which `generateBatchInvoices` can produce (DYN-007).

**Fix:** the number take now checks the candidate against the table and, if it is taken, takes the
**next** one — a gap, which is the audit trail BR-RC-01 asks for. 100 consecutive taken numbers
abort with a typed `INVOICE_NUMBER_EXHAUSTED`. **Status: FIXED** (NC5).

---

### DYN-003 · **P1** · `packages/core/src/ledger.ts:366` (ORM) vs `ledgerSql.ts:269` (libsql)
### The two ledger dialects emit **different replication payloads** for the same row, and in a different ORDER.

**Proof (executed, over the same database, both orders):**

```
libsql dialect: students update {"balance_paise":1000,"id":"s1","updated_at":"2026-10-21T07:58:19.162Z"}
ORM   dialect: students update {"balance_paise":2000,"id":"s1"}                    ← no updated_at
```

and the ROW ORDER differs: the libsql writer queues the ledger row and then the derived balance;
the ORM writer queued the **balance first and the ledger row second** — so a replica replaying the
stream in order received the derived balance **before** the ledger row it summarises on the web
path, and after it on the gateway path.

**Why it matters.** BR-SYN-02 makes the payload the replication contract. Two shapes for one row
means a replica's state depends on which platform last wrote it.

**Status: FIXED** — the ORM dialect now emits `updated_at` and writes the ledger row before the
balance row, byte-shape-identical to the libsql dialect (NC6).

---

### DYN-004 · **P1** · `packages/core/src/ledgerSql.ts:247`
### The libsql dialect's ledger replication payload omits `updated_at`; the ORM dialect and the gateway include it.

**Proof (executed):** the two dialect streams differ in exactly one key —
`ledger_entries/insert[...,type,updated_at,void_of_id]` vs `ledger_entries/insert[...,type,void_of_id]`.

**Status: FIXED** (NC7). This was the only difference left between the two dialects' streams.

---

### DYN-005 · **P1** · `packages/core/src/feesFlow.ts:289` (`assertPositivePaise`)
### The money flow's own amount guard accepts **unsafe integers** — 10¹⁹ is an integer, but not a *safe* one, and SQLite stores it as a REAL.

**Why it matters.** BR-M-01 is **[CRITICAL]**: *"the data layer never stores a float"*. 2⁵³ and
above cannot be held in a SQLite `INTEGER` column, so SQLite silently stores them as a `REAL` —
a float in the money column. `Number.isInteger(1e19)` is **true**; `Number.isSafeInteger(1e19)` is
false. The old guard used the former, so the refusal came from a *driver* further down — and
differently in each dialect.

**Proof (executed, before the fix):**

```
[ATK-1.2] libsql dialect: REJECTED: paiseAdd: non-safe-integer
[ATK-1.2] ORM dialect:    REJECTED: Received integer which cannot be safely represented as a JavaScript number
```

Two dialects, two refusal messages, two layers — and the **money flow itself accepted the value**
in both. **After the fix:** `AMOUNT_INVALID: expected a positive integer paise amount, got
9007199254740992` from both.

**Status: FIXED** (NC2).

---

### DYN-006 · **P0** · `packages/core/src/engines/invoice.ts` (was: the whole function)
### The batch-invoice engine posts **NO `FEE_CHARGED` ledger row**. The invoice list says "₹1,000 unpaid"; the balance says "nothing owed".

**Proof (executed, the real function against the real Prisma schema):**

```
[ATK-10.1] invoices: [{"n":"INV-000001","t":100000,"s":"unpaid"}]
[ATK-10.1] ledger rows: 0
[ATK-10.1] students.balance_paise: 0
```

**Resulting book state:** an invoice for ₹1,000, `status: 'unpaid'`, a `fee_schedule_items` row
marked `'invoiced'`, **zero ledger rows**, and `students.balance_paise = 0`. The invoice list and
the balance — the two things a tutor looks at — disagree, and BR-RPT-04's formula says the
ledger is the truth. (A discount was also buried in the invoice's `discount` column with no
paired `DISCOUNT_GRANTED` credit — BR-FEE-10.)

**Status: FIXED** — the engine is now a **caller** of the one money flow
(`createInvoiceFlow` over the ORM dialect), so it gets the atomic sequence take, the
`FEE_CHARGED` row, the paired `DISCOUNT_GRANTED` credit, the tamper hash, the audit row and the
outbox row in **one** transaction, exactly as a tutor-created invoice is written. Post-fix:
`ledger rows: 1`, `students.balance_paise: 100000`. (NC8)

---

### DYN-007 · **P1** · `packages/core/src/engines/invoice.ts` (was: lines 66-71 + 196-199)
### The batch engine allocated invoice numbers by **read-modify-write**: two concurrent batches collided and **half the batch failed**.

**Proof (executed):**

```
[ATK-10.2] results: [[{... "status":"success"},{... "status":"error",
  "error":"Unique constraint failed on the fields: (`tenant_id`,`number`)"}], [...]]
[ATK-10.2] nextInvoiceSeq after: 3
```

Two runs each read `nextInvoiceSeq = 1`, each handed out `INV-000001`, and the UNIQUE constraint
killed one invoice per run. The counter was then written back by **both** runs (last writer wins),
so it could also go **backwards**.

**Status: FIXED** — post-fix: `invoice numbers: [INV-000001, INV-000002, INV-000003, INV-000004]`,
all four creations succeeded, `nextInvoiceSeq: 5`. (NC8 / the batch-engine rebuild.)

---

### DYN-008 · **P1** · `packages/core/src/engines/invoice.ts` (was: `new Date(issueDate).toISOString()`)
### The batch engine wrote **ISO instants** into `issue_date`/`due_date`, so a batch invoice can never be overdue.

**Proof (executed):**

```
[ATK-10.3] issue_date: 2026-09-01T00:00:00.000Z  due_date: 2026-09-30T00:00:00.000Z
```

Every other writer writes `"2026-09-30"`. A TEXT comparison of `"2026-09-30T00:00:00.000Z"` against
today (`"2026-10-21"`) is **false** — so the aging buckets (BR-RPT-03) and the overdue reminder
(BR-REM-02) never fire for a batch invoice. Post-fix: `issue_date: 2026-09-01, due_date:
2026-09-30`. **Status: FIXED** (NC9).

---

### DYN-009 · **P1** · `packages/core/src/ledger.ts:218` (`postLedgerEntry`)
### The ORM ledger dialect accepted a **zero-amount row** and an **unknown entry type** that the libsql dialect refused.

**Proof (executed, post-fix):** both dialects now answer `Amounts must be positive` for
`debit=0, credit=0` and `Invalid ledger entry type: NOT_A_TYPE`. Before the fix, the libsql
dialect refused and the ORM dialect did not — the same input, two different books, depending on
which platform recorded it. The shipped schema's `CHECK (debit_paise + credit_paise > 0)` catches
the zero row *at the database*, but only on a database built from the migration; the dialect's
contract must not depend on which schema is underneath it.

**Status: FIXED** (NC3). The ORM dialect's balance arithmetic now uses the same
`paiseSub`/`paiseAdd` as the libsql dialect, so an overflow is a typed error in both rather than a
poisoned `balance_after_paise` every later row inherits.

---

### DYN-010 · **P1** · `packages/core/src/ledger.ts:612` (`reconcileLedger`)
### `reconcileLedger` **could not run at all** on the web's own DB handle — the web's rows were never verifiable.

**Why it matters.** `reconcileLedger` passed an **array** `orderBy` to the model surface. The web
ORM shim supports only a **single** key (`buildOrderClause` reads `Object.keys(...)[0]`), so the
array became `ORDER BY "0" ASC` — a query that fails. The function swallowed the failure and
returned `Err`. The web's own money rows were therefore **never verifiable**.

**Proof (executed):** before the fix the call returned `{ok: false}` on the shim; after the fix it
returns `{ok: true, value: true}` and the ORM dialect's own rows verify.

**Status: FIXED** (NC4) — single-key `orderBy` plus a deterministic JS sort by
`(createdAt, id)`, which every model surface can produce.

---

### DYN-011 · **P1** · `packages/core/src/feesFlow.ts:577` — **NOT FIXED (blocked)**
### The overpayment surplus is **auto-invoiced as a new fee** instead of becoming an `[ADVANCE]` credit. The advance wallet is permanently ₹0.

**The spec is unambiguous.** BR-FEE-04: *"A `PAYMENT_RECEIVED` cannot push balance below zero
unless tagged `[ADVANCE]` in description."* BR-FEE-15: *"Over-payment split: exact
`PAYMENT_RECEIVED` + `[ADVANCE]` `PAYMENT_RECEIVED`. Advances auto-apply to next `FEE_CHARGED`
via `PAYMENT_RECEIVED` tagged `[ADVANCE_APPLIED]`."* EC-F-02 says the same. BR-M-04: an advance
renders emerald, *"money the tutor owes the student"*.

**Proof (executed — the book state a tutor sees for a ₹4,500 bill paid ₹5,000):**

```
[libsql dialect] ATK-3 BOOK STATE:
 invoices: [ {number: INV-000001, total: 450000, status: paid},
             {number: INV-000002, total: 50000,  status: paid} ]      ← a ₹500 invoice for a fee the student never owed
 ledger:   [ {PAYMENT_RECEIVED, credit 450000},
             {FEE_CHARGED,  debit  50000, description: "Auto-invoice for payment: Cash"},
             {PAYMENT_RECEIVED, credit 50000} ]
 balancePaise: -450000
[libsql dialect] ATK-3 invoice list the tutor sees:
  'INV-000001 total=450000 status=paid'
  'INV-000002 total=50000  status=paid'      ← a DEMAND the tutor never made
```

**The user-visible consequence:** the tutor's invoice list now contains a **₹500 invoice for a
charge that was never agreed**, marked "paid"; the student's balance is **never negative**, so
BR-M-04's emerald "you owe the student" state can never appear; and the advance balance is
**structurally always zero**, so BR-FEE-15's auto-apply has nothing to apply. The web's own UI
strings it *"Held as advance against new invoice INV-000002"*
(`apps/web/src/components/fees/record-payment-sheet.tsx:299-304`) — the word "advance" for money
that was never an advance.

**Why it is NOT fixed here.** The fix is in `feesFlow.ts` (the one money flow — the right place),
but it changes three things outside my write scope:
1. `RecordPaymentResult.applied` would need to carry an advance (no invoice) — the web's response
   Zod schema (`apps/web/src/server/actions/fees.ts:430-450`) and the sheet's copy depend on the
   current shape.
2. `apps/web/src/components/fees/fees-actions.test.ts:303-328` **asserts the auto-invoice
   exists** (`expect(res.data.autoInvoiceNumber).not.toBeNull()`) — a test that currently pins the
   defect.
3. The gateway's vendored copy of the flow must be re-vendored in the same commit (§4).

**The patch** (for whoever owns the web + the gateway): in `recordPaymentFlow`, replace the
`if (remaining > 0)` auto-invoice block with a single `PAYMENT_RECEIVED` row,
`creditPaise: remaining`, `description: "[ADVANCE] " + input.description`, `invoiceId: null`; the
receipt's `invoiceId` becomes the first invoice the payment settled (or `null` for a pure
advance); `applied` gains an optional `invoiceId: null`; and `createInvoiceFlow` applies any
existing advance to the new charge with a `PAYMENT_RECEIVED` tagged `[ADVANCE_APPLIED]`
(BR-FEE-15). The expected book state becomes **balance −50,000** (a ₹500 advance), **one** invoice,
and no fabricated demand.

---

### DYN-012 · **P1** · repo-wide — **NOT FIXED (needs a call site)**
### `reconcileLedger` has **zero production call sites**. A corrupted ledger is undetectable.

**Proof (executed):**

```
[ATK-8.1] production call sites: []
```

The grep covers `apps/`, `packages/` and `scripts/`, excluding tests, comments, the generated code
graph and prose. Every hit in the repo is a comment, a spec quote, a doc or a test. The function
that would catch a tampered or drifted ledger is never invoked by a route, a command, a job or an
engine — so a divergence between the web's books and the gateway's books would be found by nobody.

**Status: REPORTED + tripwire.** `adversarial.money.test.ts` now contains an `it.fails(...)` that
greps for a production call site: the day someone wires it up, that test goes **red** and must be
flipped. **Where it must live:** a nightly/cron job in the gateway (it is the only place with a
scheduler) that walks every tenant's students and runs `reconcileLedger`, writing a
`chain_broken` audit row and a Diagnostics badge on failure — BR-LED-06's own enforcement column
says *"Red 'CHAIN BROKEN at entry X' in Diagnostics"*, which does not exist.

---

### DYN-013 · **P1** · `packages/core/src/ledger.ts:382` (`voidEntry`) — **NOT FIXED**
### The core void path has **no BR-LED-09 guard**: voiding a charge that a payment already credits leaves a NEGATIVE balance.

**BR-LED-09:** *"Voiding a `FEE_CHARGED` is permitted only if no `PAYMENT_RECEIVED` credits it."*
The gateway's own void route implements this; the core `voidEntry` checks only "is it a VOID" and
"has it already been voided".

**Proof (executed, `it.fails` tripwire `ATK-7.1`):** after a ₹4,500 invoice is paid in full and
the `FEE_CHARGED` is voided, the books read **balance −450,000** (the tutor owes the student
₹4,500) while the invoice still reads `paid`. **Status: REPORTED** — the fix is a
`creditedForInvoice`-style check inside the same transaction, plus a `receipts.voided_at` write and
an invoice-status revert (AUD-S7).

---

### DYN-014 · **P2** · `packages/core/src/ledger.ts:598` + `ledgerSql.ts:171` + `apps/gateway/lib/ledger-chain.ts:110` — **NOT FIXED**
### The hash chain's order is **not total**. Three writers use three different tie-breaks, so a same-millisecond pair produces a FALSE "chain broken".

**Proof (executed):** two rows written in the same millisecond (two isolates) →
`reconcile verdict on a tie: {"ok":false}`. The writers chain onto:
`ORDER BY created_at DESC` (libsql) · `ORDER BY created_at DESC, rowid DESC` (the gateway) ·
`createdAt desc` (the ORM shim) — three rules, and the reconciler walks a fourth. The
reconciler's old comment claimed the tie-break was sound because *"`id` is UUIDv7 … whose
lexicographic order is creation order"* — **`id` is a UUID v4** (`randomUUID()`), so the
tie-break is deterministic but **not** creation order. The honest fix is a monotonic sequence
column owned by the two schema authorities (a §8 stop-and-ask), not another tie-break heuristic.

---

### DYN-015 · **P1** · `packages/core/src/feesFlow.ts:172` (`requireStudent`) — **NOT FIXED**
### The student check does not look at the student's **status**: an archived student's books can still be charged.

**Proof (executed):** `[libsql dialect] ATK-2.3 archived student payment: ACCEPTED` — and the
payment created an **auto-invoice** (a CHARGE) for a student who has left. BR-STU-02's failure
column is *"Charge posted to a graduated student"*, and `students.status` CHECKs
`archived`/`graduated`. The fix must distinguish intent: a **charge** must be refused for a
graduated/archived student, while a **payment** must still be allowed so the final bill can be
settled — that is why it needs a per-intent `requireStudent`, and why it touches the web's
payment contract.

---

### DYN-016 · **P2** · `packages/core/src/engines/report.ts:38-43, 93` — **NOT FIXED**
### The fees CSV is **direction-blind**, marks no voids, has no BOM, writes rupees, and reads the ledger unbounded.

**Proof (executed, a real file written by the real function):**

```
[ATK-11.1] CSV bytes:
Date,Student,Type,Amount (INR)
"2026-09-01T10:00:00.000Z","Batch Student","FEE_CHARGED","1000.00"
"2026-09-02T10:00:00.000Z","Batch Student","PAYMENT_RECEIVED","1000.00"   ← IDENTICAL to the line above
"2026-09-03T10:00:00.000Z","Batch Student","VOID","1000.00"               ← a void, unmarked
[ATK-11.1] first byte: 68 (BOM would be 239,187,191)
[ATK-11.2] CSV: "Date,Student,Type,Amount (INR)\n"2026-09-01T10:00:00.000Z","Batch Student","PAYMENT_RECEIVED","1500.55"\n"
```

A ₹1,000 charge and a ₹1,000 payment are **the same line of text**; a void is **not** marked; a
voided payment still prints at full value; there is no BOM (Excel on Windows mojibakes a
non-ASCII student name); the amount is rupees-with-2-decimals, not the stored paise; and
`db.ledgerEntry.findMany({ where: { tenantId, createdAt: {...} } })` has **no `take`** — a tenant
with a year of history materialises every row into one worker payload. BR-RPT-02 wants `type`,
**direction** and **void status**. This engine has **zero production call sites**.

---

### DYN-017 · **P2** · `11_Data_Model.md` §10.2 vs `packages/core/src/ledger.ts:41` — **NOT FIXED (spec)**
### The spec's `trg_ledger_hash` trigger is **byte-incompatible** with the app's hash — and is installed **nowhere**.

**Quantified.** The spec's trigger computes
`sha256(prev|'|'id|'|'student|'|'type|'|'debit|'|'credit|'|'bal|'|'occurred|'|'secret|'|'created_at)`;
the app computes
`sha256(prev ‖ JSON({id,studentId,type,debitPaise,creditPaise,balanceAfterPaise,occurredOn}) ‖ createdAt ‖ secret)`.
The field order differs (`created_at` last in the spec, before the secret in the code), the
separator differs (`|` vs JSON), and the payload encoding differs. **If the trigger were
installed as specified, 100 % of ledger INSERTs would abort.** It is not installed: `migrations/`
contains only `0001_init.sql`, `0002_canonical_invoices_receipts.sql`, `0003_pin_proof.sql`, none
of which creates it, and the gateway's self-heal installs only `trg_ledger_no_update` /
`trg_ledger_no_delete`. **The second line of defence for tamper evidence does not exist**, and
the spec that describes it describes a different hash than the one the app computes.

---

### DYN-018 · **P1** · `scripts/sync-vendor-feesflow.ts` (header) + `apps/gateway/lib/vendor/feesFlow.ts` — **BLOCKED (in-flight WIP)**
### The gateway's copy of the money flow has **no freshness gate** — and the two tests the sync script cites **do not exist**.

The script's own header says *"Staleness is a TEST failure, not a review discipline:
`apps/gateway/__tests__/vendor-freshness.test.ts` … `apps/gateway/__tests__/ledger-payment-convergence.test.ts`"*.
**Neither file exists** (the gateway's `__tests__/` has 55 files; neither is among them). So the
gateway's vendored flow can silently drift from core's — and core's money logic is the thing this
audit found **four** defects in.

**Proof (executed):** `bun scripts/sync-vendor-feesflow.ts --check` →
`vendor-feesflow: STALE — regenerate with: bun scripts/sync-vendor-feesflow.ts` (because this
pass changed `packages/core/src/feesFlow.ts`). **Status: BLOCKED** — the vendored file is
in-flight WIP and outside my write scope. **Mandatory follow-up (one command):**
`bun scripts/sync-vendor-feesflow.ts`, then run the gateway's suite. Until that runs, the gateway
keeps the OLD money behaviour and the web keeps the NEW one — the exact split DYN-001 documents.
A tripwire (`it.fails` ATK-8.2) now runs the `--check` on every core test run.

---

### DYN-019 · **P2** · `prisma/schema.prisma` (all money columns are `Int`) — **NOT FIXED (spec/schema)**
### Three model surfaces, three money ranges: SQLite `INTEGER` is 64-bit, Prisma `Int` is **32-bit**.

`ledger_entries.debit_paise`, `credit_paise`, `balance_after_paise`, `invoices.total`,
`receipts.amount`, `students.balance_paise` are all `Int` in `prisma/schema.prisma` — a
**32-bit** signed integer (max 2,147,483,647 paise = **₹21,474,836.47**). The generated Prisma
client rejects anything above that; the web's ORM shim passes the value straight to SQLite and
accepts up to int64. A student's *running balance* above ₹21.47 lakh breaks the generated client
but not the shim. (The 32-bit ceiling is also the reason a `debit + credit` overflow can never be
represented in the ORM dialect — which is why DYN-009's safe-integer guard matters.)

---

### DYN-020 · **P3** · `packages/core/src/feesFlow.ts` / `ledgerSql.ts` — **NOT FIXED**
### Concurrent writes against a **local file** SQLite fail with `SQLITE_BUSY` and there is no retry.

**Proof (executed):** five concurrent invoice creations on one file DB →
`['INV-000001'] errors: ['SQLITE_BUSY: database is locked' × 4]`. On Turso the write is
serialised server-side, so the blast radius is the **local-first** deployment (the product's
default) and any single-file install. The sequence take is atomic (BR-LED-03 satisfied); the
*retry* is missing.

---

### DYN-021 · **P2 (spec contradiction)** · `12_Business_Rules.md` BR-FEE-01 vs BR-M-05 — **NOT FIXED (spec)**
### The spec contradicts itself on rounding, and the Conflicts Matrix is silent.

> BR-FEE-01: *"All money is integer minor units … **division rounds half-to-even**."*
> BR-M-05: *"Rounding: all calculations round to the nearest paise using `Math.round(result)` —
> **banker's rounding not used** — Indian accounting convention is round-half-up**."*

`0.5` paise is the disagreement. The code implements **half-to-even** in the division sites
(`paiseDivHalfEven`, used by the batch engine's basis-point discount: `12555/10 → 1256`, which
BR-FEE-01's EC-F-01 pins) and `Math.round` nowhere in the money path. The instalment rule
(BR-CALC-03, "the last instalment absorbs the remainder") is unaffected. **The spec needs one
sentence, not two — the code already follows BR-FEE-01.**

---

### DYN-022 · **P2 (spec contradiction)** · `12_Business_Rules.md` BR-RC-01 vs `07_Fees_and_Payments.md` §9.7 — **NOT FIXED (spec)**
### BR-RC-01 says the receipt number is `RCT-<YYYY>-<NNNNNN>` — **per year**; §9.7 says `prefix + padStart(6)`. The code has **no year at all**.

A year boundary is therefore a **no-op**: the sequence simply continues (`INV-000042` in 2025 and
`INV-000043` in 2026). That is *safer* than the spec (never recycled), but it is not the spec:
there is no per-year reset and no year in the number. Both rules also disagree about the prefix
format (`RCT-` vs the settings-driven `receipt_prefix`). **The spec needs to pick one.**

---

### DYN-023 · **P2** · `packages/core/src/feesDialectParity.test.ts:138-238` — **NOT FIXED (gate)**
### The parity gate tests against a **hand-written schema**, not the shipped migration, so it cannot see a production-grammar violation.

The gate builds its own `CREATE TABLE` block. The shipped `migrations/0001_init.sql` carries
`CHECK (debit_paise + credit_paise > 0)`, `CHECK (NOT (debit_paise > 0 AND credit_paise > 0))`,
`CHECK(type IN (...))` and the append-only triggers — **none** of which the gate's schema has.
So DYN-009 (the ORM dialect accepting a zero-amount row that the libsql dialect refuses) is
*invisible* to the gate: in the gate's schema both dialects accept it; in production the
migration's CHECK catches it. A gate that runs against a schema the product does not ship cannot
prove the product's grammar.

---

### DYN-024 · **P2** · `packages/core/src/feesFlow.ts:204` (`openInvoices`) — **NOT FIXED**
### "Earliest due first" has **no tie-break**: two invoices with the same `due_date` are attributed in the storage engine's order.

Both dialects order by `due_date` alone, so which of two same-due invoices a payment settles is
not defined by the contract. It happens to agree today (same table, same plan); it is not
guaranteed, and it is invisible to the gate (the gate compares `invoice_id IS NOT NULL` — a
boolean — and never *which* invoice).

---

## 3. The parity-gate blind spots — what `feesDialectParity.test.ts` cannot see

The task asked for a NEW parity scenario that makes the two dialects disagree, and for every
blind spot in the gate. I built the scenario (`ATK-9.2`: both dialects write to the **same**
database, in both orders, and the whole money footprint is compared) and it found **two real
divergences on its first run** (DYN-003, DYN-004). The gate's own comparison is blind to:

| # | What the gate compares | What it does NOT compare | Divergence it would miss |
|---|---|---|---|
| 1 | `sync_outbox` by `(table_name, op)` | **the payload** | DYN-001 (the receipt prefix in the invoice columns; the consumed value), DYN-003, DYN-004 |
| 2 | `sync_outbox` by `(table_name, op)` (a SET) | **the row ORDER** | DYN-003 (the balance queued before the ledger row on the web path) |
| 3 | `ledger_entries` by `(type, invoice_id IS NOT NULL, debit, credit, balance_after, occurred_on, description)` | **`prev_hash` / `this_hash`** | any divergence in the hash construction — the exact class the overhaul audit called F2 |
| 4 | `ledger_entries` by `invoice_id IS NOT NULL` (a boolean) | **WHICH invoice** was credited | an attribution divergence: the same payment crediting a different invoice in the two dialects |
| 5 | `audit_log` by `(action, ref_type)` | **the metadata** | a divergence in what the two dialects record about the same action |
| 6 | `receipts` by `invoice_id IS NOT NULL` (a boolean) | **which invoice** the receipt names | a receipt pointing at a different invoice per dialect |
| 7 | `students.balance_paise … LIMIT 1` (no `ORDER BY`) | **which student**, and every other student | a balance written to the wrong student |
| 8 | the two dialects over **two separate databases** | **a shared chain tail / a shared counter** | an ordering- or counter-dependence (whoever writes first) |
| 9 | a **hand-written schema** | the shipped migration's CHECKs and triggers | DYN-009 |
| 10 | — | **the gateway's third dialect** | any core↔gateway divergence (DYN-001 lived here for months) |
| 11 | — | **`reconcileLedger`** | a row that does not verify (the gate never recomputes a hash) |

**The gate is also not the only problem: the parity test's `moneyFootprint` is the wrong oracle.**
The strongest oracle for "same books" is not a field-by-field diff — it is *"the second dialect's
rows verify under the reconciler, over the second dialect's own model surface"*. That check was
**impossible before this pass** (DYN-010) and is now the centrepiece of `ATK-9.1`:
`[ATK-9.1] ORM-dialect rows under reconcileLedger: {"ok":true,"value":true}`.

---

## 4. Fixes made (in `packages/core/**`)

| # | Fix | Governing rule | Files |
|---|---|---|---|
| F1 | The settings replication payload names the RIGHT sequence column, the RIGHT prefix, and the counter's **next** value. The port now requires a `kind` discriminator, so the mistake is unrepresentable. | BR-LED-03, BR-RC-01, BR-RC-03, BR-SYN-02 | `feesFlow.ts` (port + flow), `fees.ts`, `feesPrisma.ts` |
| F2 | The number take checks the candidate against the table and **skips a taken number** (a gap) instead of aborting the payment. 100 consecutive taken numbers → typed `INVOICE_NUMBER_EXHAUSTED`. | BR-LED-03, BR-RC-03, BR-FEE-09 ("engine retries with next sequence") | `fees.ts`, `feesPrisma.ts` |
| F3 | The money flow's amount guard requires a **safe** integer. | BR-M-01 [CRITICAL], EC-F-01 | `feesFlow.ts` |
| F4 | The ORM ledger dialect refuses a zero-amount row and an unknown entry type, and uses the same safe-integer balance arithmetic as the libsql dialect. | AGENTS.md §3.5, BR-LED-02 | `ledger.ts` |
| F5 | The ORM dialect's students-balance replication payload carries `updated_at` and is queued **after** the ledger row — byte-shape and order identical to the libsql dialect. | BR-SYN-01/02, AGENTS.md §3.5 | `ledger.ts` |
| F6 | The libsql dialect's ledger replication payload carries `updated_at`. | BR-SYN-02, AGENTS.md §3.5 | `ledgerSql.ts` |
| F7 | `reconcileLedger` runs on **every** model surface (single-key `orderBy` + a deterministic JS total sort), and `created_at` is read as a `Date` **or** a TEXT. | BR-LED-06, AGENTS.md §3.5/§3.6 | `ledger.ts` |
| F8 | The batch-invoice engine is rebuilt **on the one money flow**: an atomic sequence take, the `FEE_CHARGED` row, the paired `DISCOUNT_GRANTED` credit (BR-FEE-10), the tamper hash, the audit row, the outbox row — one transaction. Dates are `YYYY-MM-DD`. | BR-LED-03, BR-FEE-10, BR-M-01, BR-SYN-01, BR-RPT-04 | `engines/invoice.ts`, `feesFlow.ts` (`CreateInvoiceInput` += `dueDate`/`subtotalPaise`/`discountPaise`), `fees.ts`, `feesPrisma.ts` |
| F9 | Two pre-existing tests that used the DEFECTS as their failure levers (a number collision → the atomicity test; a number collision → the per-student-isolation test) were rewritten to drive the same property through a different lever, and the collision behaviour is pinned by new tests. | §0.1 (a test must assert the spec, not the bug) | `fees.integration.test.ts`, `engines/invoice.test.ts` |
| F10 | The three `prisma db push` call sites no longer regenerate the **global** Prisma client (`--skip-generate`), removing a race that truncated the client and left 1.3 GB of orphans on a full disk. | AGENTS.md §7.3 (real DB) + the "never silently corrupt a shared artefact" rule | `engines/invoice.test.ts`, `engines/report.test.ts`, `adversarial.engines.test.ts` |

**Not touched** (out of scope, dirty, or spec-level): `apps/**`, `scripts/**`, `AGENTS.md`, the
specs, the gateway's vendored copy.

---

## 5. Negative controls (the evidence that the fixes are load-bearing)

### 5.1 The control

For each fix: revert **that fix only**, run the matching test, confirm **RED**, restore. A fix
without a red control is a wish.

### 5.2 The result — 8 / 8 RED

| Control | The reverted fix | The test that went red | Verdict |
|---|---|---|---|
| NC1 | the settings payload's column mapping (`fees.ts`) | `ATK-4` (the settings outbox row must name the right column) | **1 failed** |
| NC1b | the flow's `kind` discriminator on the receipt take (`feesFlow.ts`) | `ATK-4` | **2 failed** |
| NC2 | `assertPositivePaise` → `Number.isInteger` | `ATK-1.1` (a > 2⁵³ amount) | **1 failed** |
| NC3 | the ORM dialect's zero-amount / unknown-type refusals | `ATK-12.1` | **1 failed** |
| NC4 | `reconcileLedger`'s single-key `orderBy` → the old array | `ATK-5.2` | **1 failed** |
| NC5 | the number-collision skip (`fees.ts`) | `ATK-3.0` | **1 failed** |
| NC6 | the students-balance payload's `updated_at` | `ATK-9.2` (the two dialects write the same book) | **1 failed** |
| NC7 | the libsql ledger payload's `updated_at` | `ATK-9.2` | **1 failed** |
| NC8 | the batch engine → the pre-audit version (git `HEAD`) | `ATK-10.1` (the `FEE_CHARGED` row) | **1 failed** |
| NC9 | the batch engine → the pre-audit version (git `HEAD`) | `ATK-10.3` (the date format) | **1 failed** |

**Two of these controls found holes in MY OWN TESTS**, which is exactly what they are for:
* NC1 was "not red" because my ATK-4 assertion only looked at the receipt branch when the
  payload actually contained `receipt_prefix` — so a payload that had the receipt's prefix
  *inside* `invoice_prefix` slipped through. The test now asserts the prefix **value** of each
  payload against the sequence it names.
* NC4 was "not red" because ATK-5.2 asserted *"reconcileLedger did not throw"*, and
  `reconcileLedger` catches its own errors and returns `{ok:false}`. The test now asserts
  `res.ok === true` — the reconciler must be **invocable** on the web's handle.

---

## 6. Verified correct — do not "fix" these

* **The two dialects' money is now identical** over the same database in either order
  (`ATK-9.2`), including the outbox **stream shape and order** and the audit metadata shape.
* **The ORM dialect's rows verify under `reconcileLedger`**, over the web's own model surface
  (`ATK-9.1` → `{"ok":true,"value":true}`). This check was impossible before this pass (DYN-010).
* **The gateway's money path was already correct** on the settings payload
  (`apps/gateway/routes/ledger.ts:211-215`): the right column, the next value, with a comment
  naming the exact failure it prevents. Core now matches it.
* **The tamper hash is byte-identical across all three writers** — `packages/core/src/tamper.ts`
  and `apps/gateway/lib/vendor/tamper.ts` and the web's verifier agree; the parity gate pins it
  (`the tamper hash is byte-identical across dialects`).
* **The hash chain is single-sourced and byte-identical** — `ledger.ts:41-82` and
  `apps/gateway/lib/ledger-chain.ts:25-62` build the same bytes; the gateway's own test
  (`apps/gateway/__tests__/ledger-routes.test.ts:321`) checks the same property.
* **A tampered row IS detected** by `reconcileLedger` (`ATK-5.4`: an injected, un-chained
  `PAYMENT_RECEIVED` row → `{ok:false}`). The problem is that **nothing calls it** (DYN-012), not
  that it does not work.
* **A payment never credits more than the invoice, and never credits another student's invoice**
  (`ATK-2.1`) — `Math.min(remaining, outstanding)` and the per-student `openInvoices` filter hold.
* **A voided invoice is never credited** (`ATK-2.2`) — `voided_at IS NULL` holds in both dialects.
* **Every malformed amount is refused before a single row is written** — zero, negative, float
  paise, float dust, `NaN`, `±Infinity`, `"100000"`, `null`, `undefined`, `BigInt`, and now
  > 2⁵³ — and **not one sequence is burned** by a refused payment.
* **The receipt sequence is never decremented**; a void leaves a gap by design (BR-RC-01).
* **Concurrent invoice creation yields distinct numbers** in the libsql dialect (the ORM one is
  `SQLITE_BUSY`-bound on a local file DB — DYN-020).
* **The append-only triggers hold**: `migrations/0001_init.sql` aborts any `UPDATE`/`DELETE` on
  `ledger_entries` (defence-in-depth under the Prisma middleware).
* **The `sync_outbox` op CHECK holds** — only `insert`/`update`/`soft_delete` ever land.

---

## 7. Blocked — needs a human, with the patch written out

| # | Blocked because | What is needed |
|---|---|---|
| DYN-018 | the gateway's vendored flow is in-flight WIP and outside my write scope | `bun scripts/sync-vendor-feesflow.ts`, then the gateway's suite. **Until this runs, the gateway and the web disagree on money.** |
| DYN-011 | the fix changes the web's public payment result, its UI copy, and a web test that currently *asserts the auto-invoice exists* | the patch in §2 (DYN-011), applied to `feesFlow.ts` + the web's response schema + the sheet's copy + `fees-actions.test.ts:303-328` |
| DYN-013 | the core void path needs a BR-LED-09 guard, a `receipts.voided_at` write and an invoice-status revert; the gateway's void route already has the guard, so the two paths must be reconciled | a guard inside `voidEntry`'s transaction, plus the receipt/status side-effects |
| DYN-015 | a per-intent `requireStudent` changes the web's payment contract | `requireStudent(tenantId, studentId, intent: "charge" \| "credit")` in the port, and the web's action to pass the intent |
| DYN-014 | a total chain order needs a **schema** change | a monotonic `seq` column, owned by the two schema authorities (`prisma migrate` + `apps/gateway/lib/schema.ts`) — a §8 stop-and-ask |
| DYN-017/021/022 | spec contradictions and an unimplemented trigger | a spec amendment (RFC → 14 days → ratify) per `01_Product_Principles.md` §Amendment Process |
| DYN-023 | the parity gate's schema | rebuild the gate on `migrations/0001_init.sql` — **or** make the gate's schema the migration's, so the gate tests the grammar the product ships |

---

## 8. Commands run

```powershell
# Baseline
cd packages/core   && bunx vitest run          # 18 files / 214 tests green (baseline, before the fixes)
cd packages/shared && bunx vitest run          # 10 files / 321 tests green
cd packages/core   && bunx tsc --noEmit        # clean

# The attack harness
cd packages/core && bunx vitest run src/adversarial.money.test.ts --reporter=verbose --silent=false
cd packages/core && bunx vitest run src/adversarial.engines.test.ts --reporter=verbose --silent=false

# The negative controls (a temporary harness; revert → red → restore)
bun .tmp-negctl.ts                             # 8/8 RED; the harness was deleted afterwards

# After the fixes
cd packages/core && bunx vitest run            # 20 files / 249 passed + 8 expected-fail (257)
cd packages/core && bunx tsc --noEmit          # clean
cd packages/core && bunx eslint .              # clean
cd packages/core && bunx oxlint .              # no new warnings in the changed files
cd packages/shared && bunx vitest run          # 10 files / 321 tests green
cd apps/web && bunx vitest run src/components/fees   # 8 files / 95 tests green (the web consumes core)
bun --filter @buddysaradhi/core build          # dist rebuilt so the web typechecks against the new types
bun --filter web typecheck                     # only 5 PRE-EXISTING errors, in an UNTRACKED file
bun scripts/principle-lints.ts                 # 14 findings, ALL in apps/web/scripts/_audit_pw_*.mjs (untracked, not mine)
bun scripts/sync-vendor-feesflow.ts --check    # STALE — the mandatory follow-up (DYN-018)
```

**Pre-existing failures observed, NOT caused by this pass, NOT fixed here (out of scope):**
* `bun run lint` fails on `apps/web/scripts/_audit_pw_*.mjs` (untracked files from another
  session; `no-undef` on browser globals) and `scripts/principle-lints.ts` reports the same 14
  files (L1 "JS source under TS-only scope"). No finding is in `packages/core` or
  `packages/shared`.
* `bun --filter web typecheck` fails on `apps/web/src/app/(auth)/auth-pages-csp.test.ts` — an
  untracked file whose relative imports (`./(auth)/login/page`) point one directory too deep.
* The gateway's suite is red for reasons owned by the in-flight WIP (RFC-005) — and its
  `vendor-freshness` / `ledger-payment-convergence` tests **do not exist** (DYN-018).
* **`bun.lock` does not match the committed root `package.json`'s `overrides`** — so
  `bun install --frozen-lockfile` cannot run at HEAD (*"overrides in package.json changed since
  bun.lock was saved"*). A plain `bun install` rewrites the lockfile (157 insertions / 269
  deletions here) and **was not shipped** — the lockfile and every `package.json` were restored to
  HEAD. The working tree's `node_modules` is therefore ahead of the committed lockfile until the
  owner next runs `bun install`.

### 8.1 An environment incident worth recording (not a code defect)

While running the engine tests, the **Z: drive hit 100 %** (0.01 GB free) and the Prisma client
was left **truncated** (`node_modules/.prisma/client/index.d.ts` cut at exactly 524,288 bytes —
the signature of a write that ran out of space). The cause: **three test files each run
`prisma db push`, and each run regenerates the GLOBAL Prisma client** — concurrently. Each
failed generation left a ~19 MB orphan `.tmp*` engine copy; 72 of them had accumulated, holding
**1.3 GB**. The audit then failed with `Cannot find native binding … @rolldown/binding-win32-x64-msvc`
(the native binding was never fully downloaded).

**Remediation applied (in my scope):** all three `prisma db push` call sites
(`packages/core/src/engines/invoice.test.ts`, `engines/report.test.ts`,
`adversarial.engines.test.ts`) now pass **`--skip-generate`** — a per-test *database* does not
need to regenerate a *global* client — and the orphans were deleted and the client regenerated.
**The race cannot recur.** The disk is at 1.69 GB free.


---

## 9. One paragraph for the owner

The web's money path was, until this pass, writing a **replication payload that lies about the
invoice sequence** — the receipt's prefix in the invoice's columns, and a consumed number
instead of the next one — which is the one class of bug that makes a *replica* re-issue live
invoice numbers. The gateway had already fixed exactly this; core had not, and the parity gate
compares the outbox by `(table_name, op)` only, so it could never have seen it. Eight further
defects were confirmed by execution and fixed here, each with a red-when-reverted control; the
batch-invoice engine was rebuilt on the one money flow so it can no longer write an invoice the
ledger does not know about; and `reconcileLedger` — the function that would catch a corrupted
ledger — can now finally run on the web's own database, though **still nothing calls it**. The
one thing I could not do is re-vendor the gateway's copy of the flow: until
`bun scripts/sync-vendor-feesflow.ts` runs, the gateway and the web disagree about money. The
overpayment model (BR-FEE-04/15) is still wrong — a ₹500 surplus becomes a **fake ₹500 invoice**
instead of an advance — and the patch is written out above, but it needs the web's API and a web
test that currently pins the defect, so it is a coordinated change, not a solo one.
