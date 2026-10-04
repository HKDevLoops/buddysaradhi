# RFC-005: Unified Payment Dialect (Gateway Route vs Shared Flow)

**Status:** Draft — owner picks. No code changed.
**Date:** 2026-10-04

## 1. Problem

Two payment implementations diverge on what "record a payment" means:

- `apps/gateway/routes/ledger.ts:378-513` — POST `/api/v1/ledger/payment`
  writes a single unattributed `PAYMENT_RECEIVED` row, accepts no `invoiceId`,
  returns a receipt without `tamperHash`/`invoiceId`, and models overpayment
  as a negative-balance advance.
- `packages/core/src/feesFlow.ts:265-428` — `recordPaymentFlow` requires
  per-invoice attribution (F9), recomputes invoice status, auto-invoices the
  remainder, and enforces the `creditedPaise === amount` fail-closed invariant.

Consequences: invoiceless gateway rows cannot satisfy the attribution
invariant; receipts from the two paths carry different fields; cross-device
parity (AGENTS.md §3.5) is currently an open RFC, not a licence to fork.

Related gaps: (a) receipt ownership — core `FeeTx` port has no receipt op, so
the gateway mints receipts outside the flow; (b) outbox shape differs between
paths; (c) idempotency-key × receipt-sequence interplay is unspecified (retry
with same key: same sequence or new?); (d) existing invoiceless rows need a
backfill policy.

## 2. Governing spec / principles

- AGENTS.md §3.5 (one money flow, two dialects); §2 Rule 1 (append-only
  ledger), Rule 6 (integer paise), Rule 7 (outbox in same tx).
- `12_Business_Rules.md` §3 (ledger posting, BR-LED-*, BR-FEE-*, BR-RC-01
  monotonic receipt sequence); `11_Data_Model.md` (ledger grammar).
- `01_Product_Principles.md` P4 (immutable ledger), P5 (offline-first).

## 3. Paths

### Path A — Migrate gateway route onto `recordPaymentFlow` + add receipt op to `FeeTx`

Gateway handler becomes a thin adapter: parse/validate → call shared flow
with a SQL `FeeTx` implementation → return flow-produced receipt (with
`tamperHash`, `invoiceId`s). Add `takeReceiptNumber`/`insertReceipt` to the
`FeeTx` port so both dialects mint receipts identically; outbox shape unified.
**Pros:** single money decision point; parity gate meaningful. **Cons:** larger
change; receipt-sequence atomicity must be re-proven inside the flow tx.

### Path B — Keep gateway advance model, add explicit attribution-mode flag + backfill

Keep negative-balance advance as a named mode (`attribution: advance |
per-invoice`); per-invoice callers pass `invoiceId`; a backfill job attributes
historic invoiceless rows to (possibly auto-created) invoices via reversing
entries only. **Pros:** smaller, no port change. **Cons:** two money semantics
persist; parity gate must encode both; flag sprawl risk.

### Path C — Defer (document divergence, no code)

Record the divergence, forbid new callers on the gateway path, revisit after
WEB-PROD-GATE. **Pros:** zero risk now. **Cons:** divergence compounds; every
new payment feature pays the tax twice.

**RECOMMENDED PATH (RECOMMENDATION ONLY — owner picks): Path A.** It is the
only path that satisfies §3.5's "logic lives exactly once."

## 4. Test plan

- `feesDialectParity.test.ts` extended: gateway-adapted flow vs ORM flow on
  same fixture (partial, exact, overpayment) → identical invoices, ledger rows,
  balances, hashes, outbox/audit rows.
- Idempotency test: same key retried → exactly one receipt sequence consumed.
- Backfill (B only): invoiceless fixture → attributed, net-zero preserved.

## 5. Rollback

Docs-only: delete this file. If implemented later: revert to pre-migration
route handler (tag pinned); already-attributed rows stand (append-only, never
rewritten); backfill rows voided via reversing entries.

## 6. Reviewers (stop-and-ask §8 #1)

2 reviewers incl. ledger-crypto owner. Touches posting logic → §8 #1 gate.
