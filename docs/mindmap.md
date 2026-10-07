# Mind map — Buddysaradhi web architecture

A graph of the things that matter: files, the rules they implement, the state
that leaks, and the traps that have already cost time. Written by hand, not
generated — a map you cannot read is not a map.

Format: `A --> B` reads "A is connected to B"; `[kind]` tags the edge.

---

## 1. Shell → routes (the shape being changed)

```
GlassShell --> Dashboard   [renders]
GlassShell --> Students    [renders]
GlassShell --> Attendance  [renders]
GlassShell --> Fees        [renders]
GlassShell --> Settings    [renders]
useScreenUrl --> shell-store   [reads+writes activeScreen]
shell-store --> GlassShell     [renders sidebar, topbar, bottom nav]
shell-store --> REQUEST_SCREEN_EVENT  [emits; shortcut handler listens]
PinSetupGate --> GlassShell     [gates; 08 BR-SEC-02]
```

**Today:** one route `/`, five screens swapped client-side.
**Target (Phase 1):** five routes, each server-rendered, store kept as cache.

```
/dashboard  /students  /attendance  /fees  /settings   [new SSR routes]
/           --> /dashboard                              [redirect]
```

> **Rule 4 collision.** AGENTS.md says only `/` is a user-facing route. The
> amendment lands in Phase 0, before any code. Five screens stay five screens.

---

## 2. State that outlives a request (the leak class)

```
db.ts        --> clientCache   [module Map, UNBOUNDED]
db.ts        --> prismaCache   [module Map, UNBOUNDED, typed any]
offline-queue --> memoryFallback [module Map, UNBOUNDED per tenant]
intent-key   --> lastEntropy    [module let, cross-request]
xlsx-template --> CRC_TABLE     [module let, idempotent memo, benign]
```

In a long-lived server process each of these grows forever. Same class as the
1.9 GB `deno-lsp` cache found in `apps/gateway/.cache`. Fix: bounded LRU +
a test that asserts the bound.

```
gateway/lib/* --> tursoCache, failedAuthMap, ipRateLimitMap, nonceCache
                 [audited SAFE: synchronous get/set, no await between]
gateway/lib/schema.ts --> healedTenants [capped 10k]
```

---

## 3. Money — the spine. Touch almost nothing.

```
feesFlow.ts   [THE single source of money logic]
  --> fees.ts       [libsql dialect]
  --> feesPrisma.ts [ORM dialect]
feesDialectParity.test.ts  [THE gate: both dialects, real DB, byte-identical]
feesFlow.ts --> takeReceiptNumber  [BR-RC-01, never decremented]
feesFlow.ts --> insertReceipt      [07 9.6 step 4, same transaction]
tamper.ts --> computeInvoiceTamperHash, computeReceiptTamperHash
```

> Both dialects emit the SAME four-field tamper formula
> (`apps/web/src/lib/ledger/tamper-check.ts:22` recomputes it). A "better"
> formula here would mark every receipt ever written as tampered. It is a
> contract with the verifier, not a choice.

---

## 4. Schema authorities — exactly two (§3.4)

```
migrations/0001_init.sql        [authority 1: web / Prisma]
apps/gateway/lib/schema.ts      [authority 2: gateway self-heal]
migrations/0002_canonical_invoices_receipts.sql  [forward-only repair]

0002 --> repairLegacyInvoicesAndReceipts  [gated on pragma_table_info probe]
0002 --> migration0002.test.ts           [legacy shape reproduced + repaired]
```

`CREATE TABLE IF NOT EXISTS` cannot drop or relax a column — that is why the
legacy `invoices.invoice_number NOT NULL` shape killed every payment and only a
table rebuild could fix it.

---

## 5. Spec → code (what each screen implements)

```
08_Settings.md      --> settings-store, components/settings/*, BR-SEC-02 PIN gate
04_Dashboard.md     --> dashboard-client, dashboard-drill, 19.4 drill+filters
05_Students.md      --> students-store, components/students/*, BR-STU-02/04
06_Attendance.md    --> attendance-store, 10.6 unlock ladder, 10.7 bulk
07_Fees_and_Payments.md --> fees-store, ledger-table, 9.6 receipt, BR-RC-01
09_Backup...md      --> import/export-section, xlsx-template, 15.4 >100 rows PIN
10_Security.md      --> crypto.ts, proxy.ts CSP, PIN ladder
AGENTS.md           --> the 11 Rules; 1 ledger, 6 paise, 7 outbox, 9 no-silence, 10 a11y
```

---

## 6. Traps already paid for (do not re-enter)

| Trap | What it cost | Guard now |
|---|---|---|
| Sync export from a `"use server"` file | Build failed; then 500 on **every** screen while `tsc` + 621 tests were green | gate constants live in isomorphic modules |
| Re-export (`export { X }`) of a constant | Same 500, missed by a scanner that only matched `export const` | constants live in `attendance-window.ts` / `settings-gates.ts` |
| Test fixture with the PERMISSIVE schema | `batches.tutor_id` passed CI, crashed production | fixture models the stricter legal shape |
| Fixture-provisioned fresh DB in the parity gate | 192/192 green while the product could not take a payment | `migration0002.test.ts` builds the REAL legacy shape |
| `harness.captureErrors` `settled` never assigned | The whole 4xx/5xx gate was dead; every lane claimed "zero errors" | `markSettled()` |
| Hardcoded amount in a spec | "Save disabled" was the app correctly refusing an OVERPAYMENT (BR-M-04) | spec prices from the live balance |
| `.first()` on DOM order | Voided an already-voided receipt; app correctly refused (BR-LED-05) | selector must name the payment |
| Unbounded module `Map` | 1.9 GB `deno-lsp` cache, 113k files, ungitignored | `.gitignore` + bounded caches (Phase 2) |

---

## 7. The gates (run after every phase)

```
tsc --noEmit                       [the TS gate; eslint ignores .tsx per FM-17]
pnpm run lint:principles           [7 lints; was 697s before the cache fix, now 5s]
pnpm --filter web exec vitest run  [670 web tests]
pnpm --filter @buddysaradhi/core exec vitest run   [200]
pnpm exec vitest run apps/gateway  [548]
pnpm --filter web build            [catches use-server violations tsc cannot]
playwright (5 tab specs)           [catches what no gate sees]
```

---

## 8. Native-first verdicts (Phase 3)

```
lodash.debounce      [0 sites]   --> REMOVE, exact native replacement in plan 3
idb-keyval           [0 sites]   --> REMOVE if unused
clsx                 [1 site]    --> REMOVE, filter(Boolean).join(" ")
class-variance-authority [1 site] --> KEEP, earns its keep
react-day-picker     [1 site]    --> CANDIDATE, <input type="date"> is a platform primitive
date-fns             [7 sites]   --> KEEP, money/date precision (Rule 6)
zod                  [many]      --> KEEP, mandated 6.1
```

The rule is precision, not purity: a hand-rolled `addMonths` is *less* precise
than `date-fns`, so it stays. That is the owner's own criterion, applied.