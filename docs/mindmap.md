# Mind map — Buddysaradhi web architecture

A graph of the things that matter: files, the rules they implement, the state
that leaks, and the traps that have already cost time. Written by hand, not
generated — a map you cannot read is not a map.

Format: `A --> B` reads "A is connected to B"; `[kind]` tags the edge.

**State.** TABS-HARDEN-01 phases 0–3 are **committed** (`5974e6a`, 2026-10-07):
five SSR routes, true-LRU bounded caches, native-first swaps. The plan's §2 "the
blocker" (the `ssr: false` wrappers) is **closed** — fixed at the store, not the
component.

Phases 4–5 are **in flight and uncommitted**; §7 and §9 flag it. Do not read
this graph as describing `hooks/*`, `stores/*`, or `queries/search.ts` until
that work lands.

**Where the technology references live:** [`docs/stack/`](stack/README.md) — one
file per stack with the canonical doc URL, the version read from the real
`package.json`, and only the project-specific notes. §10 below points at them.

---

## 1. Shell → routes (SHIPPED 2026-10-07, commit `5974e6a`)

```
GlassShell --> Dashboard   [renders]
GlassShell --> Students    [renders]
GlassShell --> Attendance  [renders]
GlassShell --> Fees        [renders]
GlassShell --> Settings    [renders]
useScreenUrl --> shell-store   [reads+writes activeScreen + pushState]
shell-store --> GlassShell     [renders sidebar, topbar, bottom nav]
shell-store --> REQUEST_SCREEN_EVENT  [emits; shortcut handler listens]
PinSetupGate --> GlassShell     [gates; 08 BR-SEC-02]

nav[aria-label="Screens"]  [BOTH sidebar AND mobile bottom nav]
                           [every Playwright selector MUST anchor here]
```

**Now:** five real routes, each server-rendered; the store survives as the
client cache so switching between already-visited screens stays instant.

```
/dashboard  /students  /attendance  /fees  /settings   [SSR routes]
/           --> /dashboard                              [redirect]
```

What this bought, which a single-route app could not do: deep links, Back
between screens, per-screen `document.title`, and an honest
`aria-current="page"` (it said `true` for years because the items were **not**
pages).

**What it cost, stated plainly:** the old `?screen=` hook could REFUSE a Back
press while a typed ₹5,000 payment was open. The App Router owns `popstate` and
offers no veto, so that guard is gone. Mitigation: `GlassShell` closes the fee
sheets on unmount, so a sheet cannot leak across a navigation — but typed values
inside a sheet open at the moment Back was pressed are still lost silently.

> **Rule 4, resolved.** AGENTS.md §2 Rule 4 was amended 2026-10-07, BEFORE the
> code (§0.1). The rule protects the screen COUNT, not the routing. Five routes
> are still five screens; a sixth remains absolutely prohibited.

---

## 2. State that outlives a request (RESOLVED 2026-10-07)

```
lru.ts --> BoundedCache            [THE primitive: hard ceiling + true LRU
                                     via native Map delete+re-insert,
                                     + an onEvict hook for cascade/report]
db.ts        --> clientCache   [BoundedCache(64), no hook]
db.ts        --> prismaCache   [BoundedCache(64), hook DROPS the orphan proxy]
offline-queue --> memoryFallback [BoundedCache(8), hook SURFACES the eviction]
intent-key   --> lastEntropy    [audited FINE — proven per-process-safe]
xlsx-template --> CRC_TABLE     [NOT a cache — the 256-entry table for every byte]
```

**The brief's premise was half wrong, and the correction matters.** Phase 2
found the caches were *already bounded at 64* — but `lruSet` was **FIFO, not
LRU**, the two caches were keyed by **RAW vs NORMALISED url** (so one DB held
two entries), and evicting a client **orphaned its ORM proxy** — two live
handles per tenant while the map claimed to be bounded. A map that reports a
bound it does not enforce is worse than an unbounded one, because it is trusted.

Two verdicts were **FINE and left alone**: `intent-key`'s `lastEntropy`, and
`xlsx-template`'s `CRC_TABLE` (it is not a cache; it is the table covering every
possible byte). Each has a test.

```
gateway/lib/* --> tursoCache, failedAuthMap, ipRateLimitMap, nonceCache
                 [audited SAFE: synchronous get/set, no await between]
gateway/lib/schema.ts --> healedTenants [capped 10k]
```

### The two cache classes — do not conflate them

| Class | Lives in | Bounded by | Eviction means |
|---|---|---|---|
| **Server process state** | module `Map`s in `db.ts`, `offline-queue.ts` | `BoundedCache.max` | a DB handle is dropped; must cascade or surface (Rule 9) |
| **Per-request render state** | `React.cache()` in `screen-data.tsx` | React, automatically | the response is done; nothing to do |
| **Browser server-state cache** | the browser `QueryClient` in `providers.tsx` | React tree lifetime, one per tab | `queryClient.clear()` on sign-out |
| **Browser view state** | 5 zustand `persist` stores | `sessionStorage` | tutor navigates away |

A module-scoped `QueryClient` belongs to none of these and is a **cross-tenant
leak** — one tutor's roster in another tutor's HTML.

---

## 3. Money — the spine. Touch almost nothing.

```
feesFlow.ts   [THE single source of money logic]
  --> fees.ts       [libsql dialect]
  --> feesPrisma.ts [ORM dialect]
feesDialectParity.test.ts  [THE gate: both dialects, real DB, byte-identical]
migration0002.test.ts      [builds the REAL legacy shape, not a fresh DB]
feesFlow.ts --> takeReceiptNumber  [BR-RC-01, never decremented]
feesFlow.ts --> insertReceipt      [07 9.6 step 4, same transaction]
tamper.ts --> computeInvoiceTamperHash, computeReceiptTamperHash
```

> Both dialects emit the SAME four-field tamper formula
> (`apps/web/src/lib/ledger/tamper-check.ts:22` recomputes it). A "better"
> formula here would mark every receipt ever written as tampered. It is a
> contract with the verifier, not a choice.

**Dialects are typed structurally** (`OrmTx`, `SqlExecutor`), never against the
generated Prisma client — deliberately, so pinning one implementation cannot
break the other two. Two real P0s came from forking the flow: divergent hash
construction, and payments attributed against `invoices.total`.

**The parity gate earned its keep by being narrow.** A fixture that *provisioned
a fresh* DB reported 192/192 green while the product could not take a payment at
all. `migration0002.test.ts` builds the legacy grammar and reproduces the repair.

---

## 4. Schema authorities — exactly two (§3.4)

```
migrations/0001_init.sql        [authority 1: web / Prisma]
apps/gateway/lib/schema.ts      [authority 2: gateway self-heal]
migrations/0002_canonical_invoices_receipts.sql  [forward-only repair]

0002 --> repairLegacyInvoicesAndReceipts  [gated on pragma_table_info probe]
0002 --> migration0002.test.ts           [legacy shape reproduced + repaired]
```

**These two must agree, and they must not be a third.** `apps/web` runtime code
may not execute DDL at all — a missing table is a loud typed error naming the
table and both authorities (Rule 9), never a silently self-created table and
never a fabricated empty result set. `scripts/principle-lints.ts` L6 (`no-raw-sql`,
P0) enforces it.

`CREATE TABLE IF NOT EXISTS` cannot drop or relax a column — that is why the
legacy `invoices.invoice_number NOT NULL` shape killed every payment
(`SQLITE_CONSTRAINT ... NOT NULL constraint failed: invoices.invoice_number`)
and only a table REBUILD could fix it. The failure was at least honest: the
transaction rolled back whole (Rule 7), so no half-written payment ever reached
a ledger.

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

**The `Implements:` header is not decoration** (AGENTS.md §0.2). Every exported
module names the spec section it implements, and code that maps to nothing gets
deleted. Two deletions this round prove the rule bites: the `ssr: false`
wrappers documented a blocker that no longer existed, and `calendar.tsx` existed
only to wrap a native `<input type="date">`.

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
| Unbounded module `Map` | 1.9 GB `deno-lsp` cache, 113k files, ungitignored | `.gitignore` + `BoundedCache` |
| A bounded map that reports a bound it does not enforce | TWO live DB handles per tenant while the map claimed 64 | `BoundedCache`: true LRU, one keyspace, evict cascades to the proxy |
| `persist` + `sessionStorage` without `skipHydration` | Structural hydration mismatch on **every load** — a §16 release blocker | `skipHydration: true` + `rehydrate()` in an effect |
| `ssr: false` as the fix for a mismatch | Treated the symptom, and is illegal in a Server Component | fix the store, delete the wrapper (§0.2) |
| `getSettings` resolving `AUTH_REQUIRED` as a SUCCESS | One flaky background refetch unmounted the nav rail and content pane under the pointer | monotonic `hasRealSettings` latch |
| `var(--accent-cyan)` — a token no palette defines | Every focus ring resolved to an invalid colour → **no focus ring at all** (WCAG 2.4.7), and nothing looked broken | only reference tokens the design system emits |
| `page.getByRole(... 'Fees')` | TWO matches (sidebar + bottom nav) → strict-mode violation | anchor to `nav[aria-label="Screens"]` |
| The two timing specs run beside a `next build` | 546/548 on the gateway suite for no reason; 29/29 clean serially | read them serially; do not loosen a threshold |

---

## 7. The gates (run after every phase)

```
tsc --noEmit                       [the TS gate; eslint ignores .tsx per FM-17]
pnpm run lint:principles           [7 lints; was 697s before the cache fix, now 5s]
pnpm --filter web exec vitest run  [712 web tests as of 5974e6a]
pnpm --filter @buddysaradhi/core exec vitest run   [200]
pnpm exec vitest run apps/gateway  [548; 546 green + 2 TIMING assertions]
pnpm --filter web build            [catches use-server violations tsc cannot]
playwright (5 tab specs)           [catches what no gate sees]
```

**Two of these are load-bearing in a way the green checkmark hides:**

- `tsc --noEmit` is the *only* TypeScript gate. `typescript-eslint` was removed
  because it is broken on TS 7, so ESLint no longer parses `.ts`/`.tsx` at all
  (FM-17). "Lint clean" is not a type result.
- `next build` is the only gate that sees a `"use server"` export violation. It
  is a BUILD-time error: `tsc` and every test stay green and then **every screen
  500s**.

**The 2 gateway failures are not a regression.** They are `low-latency.test.ts`
/ `performance.test.ts` asserting wall-clock budgets while a build competes for
CPU. They pass 29/29 read serially. See `docs/stack/vitest.md`.

**Known open, recorded not hidden:** `zz-tmp-settings-audit.spec.ts` was 9/13
against `5974e6a`. The app defect it chased is fixed and the page probes clean;
the residual was the spec, not the app — the QA tenant had accumulated 14
invoices and 32 ledger rows across every audit run, against hardcoded 2 and 3.
The uncommitted phase-5 lane is **re-basing the spec** (relative `rowsBefore`
counts, self-repairing residue, `en-IN`-parsed counters). **Do not loosen an
assertion to make it pass** — re-base it against the state the app actually
produces.

---

## 8. Native-first verdicts (Phase 3 — SHIPPED)

```
lodash.debounce      [0 sites]   --> REMOVED (exact native replacement)
idb-keyval           [0 sites]   --> REMOVED; all 3 stores already use sessionStorage
clsx                 [1 site]    --> REMOVED; cn() rebuilt natively after auditing
                                  all 39 call sites for the array/object forms
react-day-picker     [1 site]    --> REMOVED; the one call site was a plain
                                  single-date field, which is what <input type="date">
                                  IS. calendar.tsx deleted (0.2)
class-variance-authority [1 site] --> KEEP, earns its keep for buttonVariants
date-fns             [7 sites]   --> KEEP, money/date precision (Rule 6)
zod                  [many]      --> KEEP, mandated 6.1
```

The rule is **precision, not purity**: a hand-rolled `addMonths` is *less*
precise than `date-fns`, so it stays. That is the owner's own criterion, applied.
**When you swap a dependency, write the precision verdict next to it** — a vibe
is not a justification.

### The CSS half of the same phase

```
globals.css: --accent-cyan     [REMOVED — exists in NONE of the 20 palettes,
                                  so every focus ring using it resolved to an
                                  invalid colour and had NO RING AT ALL (WCAG 2.4.7)]
globals.css: duplicate neumo   [REMOVED — the first copy rendered nothing]
```

A token that the design system does not emit **fails silently**, not loudly.
Never reference a token by name on the assumption it exists.

---

## 9. Lane boundaries (who owns what)

Three lanes shared `5974e6a` with **hard, non-overlapping file ownership**. The
boundaries are recorded because the next multi-lane change will want them.

| Lane | Owned | Gate it had to pass |
|---|---|---|
| **SPEC** | `AGENTS.md` (§2 Rule 4, §3.1, §3.3, §15 FM-03) | owner review of the amendment — landed BEFORE any code (§0.1) |
| **SSR / ROUTES** | `app/(app)/*/page.tsx`, `screen-data.tsx`, `query-defaults.ts`, `providers.tsx`, `glass-shell.tsx`, `use-screen-url.ts`, `proxy.ts` | `next build` green with all five routes; Playwright SSR 4/4 in a real browser |
| **CACHES / NATIVE** | `lib/db.ts`, `lib/lru.ts`, `lib/offline-queue.ts`, `lib/intent-key.ts`, `lib/utils.ts`, `lib/xlsx-template.ts`, `globals.css`, `settings-client.tsx`, `attendance-client.tsx` | `tsc 0`, principle-lints 7/7, web 712/712, core 200/200 |
| **HOOKS / STORES** (phase 5, in flight) | the 5 `hooks/*` and the 5 `stores/*` | every hook/store states a contract; `tsc 0` |
| **DOCS** | `docs/stack/*`, `docs/mindmap.md` | every URL resolves; every version matches a real `package.json` |
| **REGRESSION-BISECT** | read-only; it chased a hang that looked like a render loop and was **measured as not one** (0 body mutations over 45s) | the discriminator: every failing test WRITES settings, every passing one is read-only |

**The lanes were not independent.** Two boundaries had to be crossed by
*agreement*, not by edit rights, and both are recorded in the code:

- `settings-store.ts` + `attendance-store.ts` (`skipHydration`) had to land
  before the SSR lane could drop the two `ssr: false` wrappers.
- The `settings-client.tsx` `hasRealSettings` latch was found by bisecting a
  hang nobody could explain, and it lives in the caches lane's file.

**A lane boundary is a file list, not a subject.** The stores lane could not
have fixed the hydration mismatch alone — the fix is two lines in a store and a
deleted wrapper in a page the SSR lane owned. Splitting by *subject* rather than
by *file* would have produced two correct half-patches and a broken app.

---

## 10. Stack references — `docs/stack/*`

The graph points at them. One file per technology, each with the canonical doc
URL, the version **read from the real `package.json`**, and only the
project-specific notes.

```
docs/stack/README.md          [the index + the rules for adding to the dir]
  --> next.md                 [16.2.12; "use server" async-only is a BUILD error]
  --> react.md                [19.2.4 web / 19.2.7 root; React.cache = per-request]
  --> typescript.md           [^7.0.2; typescript-eslint REMOVED, tsc is the gate]
  --> tailwindcss.md          [^4 -> 4.3.2; --accent-cyan had NO focus ring]
  --> zustand.md              [^5.0.14; skipHydration or mismatch every load]
  --> tanstack-react-query.md [^5.101.1 -> 5.101.2; module client = tenant leak]
  --> zod.md                  [3.24.2 exact in 3 places incl. deno.json]
  --> react-hook-form.md      [^7.80.0 -> 7.81.0; subpath needs moduleResolution]
  --> vitest.md               [^4.1.10; timing specs fail under a concurrent build]
  --> playwright.md           [^1.61.1 -> 1.61.1; nav renders TWICE]
  --> libsql.md               [@libsql/client ^0.17.4; CREATE TABLE IF NOT EXISTS]
  --> deno.md                 [2.9.7; exactly TWO schema authorities]
  --> prisma.md               [6.2.1 exact; libsql-proxy is a CONTRACT]
  --> supabase.md             [@supabase/ssr ^0.12.0; proxy.ts, not middleware.ts]
  --> eslint-prettier.md      [eslint ^10 root / ^9 web; eslint does NOT lint .tsx]
  --> ui-primitives.md        [Radix + Base UI + shadcn + lucide + date-fns]
  --> packages-shared.md      [@buddysaradhi/shared; builds BEFORE core]
  --> packages-core.md        [@buddysaradhi/core; the parity gate is THE gate]
```

Rule for that directory: **every URL must resolve** (a dead link in a reference
document is worse than no document), **never invent a version**, and **every note
must be traceable to a real file in this tree** — otherwise it is folklore and
belongs in a comment, not here.