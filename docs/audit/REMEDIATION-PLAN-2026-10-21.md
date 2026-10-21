# REMEDIATION PLAN — 2026-10-21 (post-audit)

**Basis:** `docs/audit/AUDIT-2026-10-21.md` (static audit, 3 P0 / 15 P1 / 24 P2 / 10 P3) plus four
dynamic audits (`DYNAMIC-WEB.md`, `DYNAMIC-GATEWAY.md`, `DYNAMIC-MONEY.md`, `DYNAMIC-PERFORMANCE.md`,
`DYNAMIC-PRODUCTPAGE.md`, `DYNAMIC-SUPPLYCHAIN.md`) and the Kali-toolchain testing run
(nmap / nikto / sqlmap / ffuf / Metasploit / tshark / sslscan / whatweb / ZAP against the live
deployment and a local `sqld`-backed gateway rig).
**Rule:** phases are ordered by blast radius. A phase is DONE only when its gates are green and its
negative controls are verified.

---

## Status legend

`FIXED` = landed with a verified-red negative control · `OPEN` = not started · `DECIDE` = needs an
owner decision before code

---

## Phase 0 — Stabilise the tree (IN PROGRESS)

Nothing else can be trusted until this is done.

| # | Item | Status |
|---|---|---|
| 0.0 | **⛔ OWNER ACTION** — see the ESCALATION section at the top of `AUDIT-2026-10-21.md`: (a) the public anon key can READ/UPDATE/DELETE Supabase tables because RLS is not enabled, (b) the live `service_role` key was committed to a public repo and needs ROTATION, (c) `next@16.2.12` had three live CRITICAL RCE advisories — pinned to 16.3.8, needs a DEPLOY | **OWNER** |
| 0.1 | **Z: disk full** — `ENOSPC` corrupted `node_modules` (empty package dirs shadowing complete root copies), which broke `bun install`, the dev server and the per-package test runners | FIXED — freed 3.3 GB (stale `supabase/` mirror, `Z:\.pnpm-store` cache, build artefacts), removed the empty husks, `bun install` repaired |
| 0.2 | `bun run lint` red — 3 × L7 (`apps/product-page/scripts/*.mjs`) + 1 × L10 (`apps/desktop/package.json`) | OPEN |
| 0.3 | `bun run typecheck` green across 7 workspaces | FIXED |
| 0.4 | Landing the four agents' in-flight edits (109 files) as reviewable commits | FIXED - the RFC-005 gateway WIP landed as `c76e0fa` (the vendored money flow, the freshness generator, the sequence fix, the tests moved to the spec's model) |
| 0.5 | Killing the stale local servers the agents left running (`:3010` prod build shadowed the real build and produced a **false** CSP reading) | FIXED |

**Gate:** `bun run lint` exit 0 · `bun run typecheck` exit 0 · `bunx vitest run` (root) exit 0.

---

## Phase 1 — P0 correctness: the money engine

The ledger decides what a tutor's books say. Nothing ships until these are green.

| # | Finding | Status |
|---|---|---|
| 1.1 | **P0** A voided payment never unwinds the invoice's credited amount — the predicate was `void_of_id IS NULL` **on the row itself**, true of a voided ORIGINAL. All three dialects shared the flaw, so the parity gate could not see it. Void + invoice-status revert | FIXED (`e80c729`) |
| 1.2 | **P0** The plaintext PIN was written to a durable `sync_outbox` row (BR-SEC-07 [CRITICAL]). New principle-lint L9 makes it a machine gate | FIXED (`b973ffe`) |
| 1.3 | **P0** The secure-erase cascade aborted on the append-only trigger — the erase **never happened** | FIXED (`d57036b`) |
| 1.4 | **P0** The settings replication payload wrote the **receipt's** prefix+sequence into the **invoice's** columns, and the consumed value instead of the next — a replica re-issues a live number | FIXED (DYNAMIC-MONEY) |
| 1.5 | **P0** `generateBatchInvoices` posted **no `FEE_CHARGED` row** — a parallel money implementation | FIXED (DYNAMIC-MONEY) |
| 1.6 | **P0** The Dashboard's collected figure counted voided payments and never subtracted refunds (BR-CALC-10), and the two copies of BR-CALC-10 disagreed | FIXED (`e80c729`) |
| 1.7 | **P1** A taken invoice number aborted the **whole** payment (BR-FEE-09 demands a retry) | FIXED (DYNAMIC-MONEY) |
| 1.8 | **P1** The ORM ledger dialect accepted a zero-amount row and an unknown type the libsql dialect refused — same input, two books | FIXED (DYNAMIC-MONEY) |
| 1.9 | **P1** `assertPositivePaise` used `Number.isInteger` — 10¹⁹ passes it and SQLite stores it as a REAL (BR-M-01 [CRITICAL]) | FIXED (DYNAMIC-MONEY) |
| 1.10 | **P1** The two dialects emitted different replication payloads and queued them in a different ORDER — a replica's state depended on which platform wrote last | FIXED (DYNAMIC-MONEY) |
| 1.11 | **P1** `reconcileLedger` could not run on the web's handle (array `orderBy` → `ORDER BY "0"`) — the web's money was never verifiable | FIXED (DYNAMIC-MONEY) |
| 1.12 | **P1 (mine)** `voidOfId: { in: creditIds }` is unbounded — SQLite's ceiling is 32,766 variables, so the dashboard 500s on a long-lived institute. **Introduced by my own fix; must be chunked.** | OPEN |
| 1.13 | **P1** `reconcileLedger` has **zero production call sites** — a corrupted ledger is undetectable | OPEN — needs an invocable surface (gateway route / Diagnostics panel) |
| 1.14 | **P1** No BR-LED-09 guard in `voidEntry` — voiding a paid charge leaves the balance at −₹4,500; and no `receipts.voided_at` write, no invoice-status revert | OPEN |
| 1.15 | **P1** The chain ORDER is not total — three writers, three tie-breaks → false "chain broken" alarms | DECIDE |
| 1.16 | **P2** The spec's `trg_ledger_hash` is byte-incompatible with the app's hash AND installed nowhere — implementing §10.2 literally bricks every write | DECIDE (amend the spec or change the hash) |
| 1.17 | **P2** BR-FEE-01 vs BR-M-05 contradict on rounding; the Conflicts Matrix has no row | DECIDE |
| 1.18 | **P1** An overpayment auto-invoiced the surplus - a synthetic bill for money the tutor was holding in cash (BR-FEE-15, EC-F-02). The books netted to zero, which is why the tests were green. The surplus is now ONE `[ADVANCE]` PAYMENT_RECEIVED with no invoice, and the receipts partition the payment (the settled part's receipt, plus the advance's OWN receipt number) | FIXED (`6caf3e9`) - the auto-apply half (the advance consumed by the next charge) is OPEN: it needs the gateway's `FeeTx` adapter |
| 1.19 | **P1** `migrations/0001_init.sql` has NO `students.balance_paise` and NO `students.base_fee_paise` - a tenant DB created from the canonical DDL cannot record a balance or a fee. The code writes both, the gateway's self-heal has them, and the adversarial suite patches the column in by hand - so the shipped migration is not the schema the money engine runs on | FIXED (`08b875b`) - forward-only `migrations/0004_student_money_columns.sql` ADDs both as `INTEGER NOT NULL DEFAULT 0` (never `0001` was edited) + `migrations/0004_student_money_columns.test.ts` (7 tests, asserts the defect before the repair). NOTE: the change was swept into a concurrent lane's commit by a repo-wide `git add -A`; the content is verified in the tree. The hand-patch in `packages/core/src/adversarial.money.test.ts:59-67` is now REDUNDANT but was NOT edited (the money lane owns that file) |
| 1.20 | **P2** The web consumes core's BUILT `dist/`, not its source - a stale build silently serves the old money behaviour. The web fees suite caught it here; nothing enforces the rebuild | OPEN - build core before the web suite, or alias the package to its source |
| 1.21 | **P1** The gateway's `fee-strictness.test.ts` and `idempotency-cas.test.ts` count TWO ledger rows per payment - the auto-invoice row model the spec forbids. They contradict the same suite's G8 test, which demands the balance go NEGATIVE for an overpayment (impossible under the auto-invoice model, which is why G8 was already red) | FIXED (`c76e0fa`) - the RFC-005 WIP landed with the vendor copy regenerated, and the counts moved to the spec's model. G8 now passes: the balance goes negative for an overpayment |

**Gate:** `packages/core` 254 passed + 8 expected-fail · `packages/shared` 321 green · the parity gate
covers a **void** scenario and compares outbox **payloads** byte-for-byte.

---

## Phase 2 — The gateway trust boundary

The edge is the single chokepoint every platform transits.

| # | Finding | Status |
|---|---|---|
| # | Finding | Status |
|---|---|---|
| 2.1 | **P1** `cf-connecting-ip` was read BEFORE the peer check, so the caller chose its own rate-limit **and** auth-lockout bucket - the strict-mode design was short-circuited | FIXED (`6b85290`) |
| 2.2 | **P1** `resolveTursoUrl`/`resolveToken` silently substituted a **different database and credential** than the HMAC signed | PARTLY FIXED - `lib/db-url-policy.ts` now refuses any non-public destination, judged on the **parsed** host (userinfo tricks cannot mislead it); the *substitution* semantics remain and `lib/sql.ts` is in-flight. **GW-07** |
| 2.3 | **P1** The request signature does not bind the HTTP **method, path, body, or `Idempotency-Key`** | REPORTED - **deliberately not changed**: the signed material is a published wire value (`apps/web/src/server/get-db.ts:270`), so re-binding it breaks every deployed web client. An RFC, not a unilateral edit. 2.13 removes the exploitability it created. |
| 2.4 | **P1** A GET with **no `X-Signature` at all** is accepted - a forged signature is rejected, an absent one is not | REPORTED |
| 2.5 | **P1** The void route has **no PIN** at the edge - the ledger's only correction path is unauthenticated (BR-SEC-04 [CRITICAL]) | OPEN - `routes/ledger.ts` is in-flight |
| 2.6 | **P1** The rate limiter and the 15-attempt lockout are **per-isolate maps**, so the documented ceilings **do not bind** - measured live: 400 concurrent `GET /health` -> **400x200, 0x429**; 40 bad-bearer requests -> **40x401, 0x429** | REPORTED - a shared store is a new dependency AND a new outbound origin (both forbidden here), so the control is now documented as **not existing** in `.env.example`, with the measurement. **GW-04** |
| 2.7 | **P2** The schema heal swallows its own failure and the request proceeds against an unhealed DB | FIXED - the heal now REFUSES the request with a typed `SCHEMA_HEAL_FAILED`, and a failed heal is not cached, so the next request retries it. The cleanup chain's own rejection is caught too: it was raising an unhandled rejection in the isolate |
| 2.8 | **P2** `GATEWAY_ADMIN_TOKEN` is documented as the erase route's second factor and is read by **no** handler | OPEN |
| 2.9 | **P2** `PIN_PEPPER` defaults to the request-signing HMAC key - a fleet-wide impersonation key that is also an offline PIN-cracking key | FIXED - `STRICT_KEY_SEPARATION` now makes the coupled pepper fatal (the same treatment `DATA_ENCRYPTION_KEY` already got). The precedence itself is unchanged on purpose: the web computes the proof from `PIN_PEPPER \|\| GATEWAY_SHARED_SECRET` and the edge verifies it, so a different precedence would make every proof mismatch |
| 2.10 | **P2** The gateway is a **public** Supabase Edge Function that dials a caller-supplied `X-Db-Url` - loopback, `169.254.169.254`, RFC1918 - and a dead host **hangs** the request | **FIXED** - `lib/db-url-policy.ts`, enforced before anything is dialed. **GW-02** |
| 2.11 | **P2** The gateway's ledger outbox payloads for the invoice and void paths are minimal - a replica cannot rebuild the row | OPEN (in-flight file) |
| 2.12 | **P3** `checkRateLimit` never increments on the reject path - the backoff cannot escalate | FIXED - the counter advances on the reject path too, so the penalty that follows an expired one is computed from a larger count and the backoff escalates with continued abuse |
| 2.13 | **P0** A captured signed payment replayed onto a **second isolate** charged twice - two `PAYMENT_RECEIVED` rows of 4242 paise from one capture | **FIXED** - the nonce is now claimed durably in the tenant's own DB (`lib/replay.ts`). **GW-01** |
| 2.14 | **P1** "Securely erase all tutor data" left the **idempotency store** behind - every row holds a stored mutation's response body (receipt number, balance) | **FIXED** - wiped in the same cascade transaction. **GW-03** |
| 2.15 | **P2** A GraphQL tenant-mismatch refusal was reported as **500 INTERNAL** - a client error as a server fault | **FIXED** -> typed 403. **GW-05** |
| 2.16 | **P2** The edge cache key `gw:<tenant>:<path>:<qs>` omits the **database identity**, so a request naming another DB is served the previous DB's cached rows | FIXED - the key now carries the database's 64-bit digest. The database is a CALLER-SUPPLIED header, so one database's tutor roster could appear in another's response. **GW-06** |
| 2.17 | **P3** The SQL/XSS blocklist is bypassable (`<svg/onload=...>` stored verbatim). It is defence-in-depth, not the injection control - every value is `?`-bound | REPORTED. **GW-08** |
| 2.18 | **P3** No connect timeout on the tenant-database dial - a dead host holds the request open | REPORTED. **GW-10** |

**Verified correct (do not touch):** CVE-2025-29927 (Next.js middleware auth bypass) is **not**
exploitable — Metasploit's `auxiliary/scanner/http/nextjs_middleware_auth_bypass` reports *"gated
(HTTP 307 → /login); not bypassed"*. The 1 MB body limit is enforced identically for chunked and
content-length bodies (413 either way) — finding AUD-043 is **withdrawn** as a false positive.

**Gate:** the local rig (real `sqld`, unmodified gateway) passes the full Kali suite with every finding
either fixed or written up.

---

## Phase 3 — Performance

| # | Finding | Status |
|---|---|---|
| 3.1 | **P0** The web app's CSP blocked every client chunk — **the app never hydrated in production** (29/30 tags un-nonced, React dead, sign-in did nothing). Root cause: `export const dynamic = "force-static"` on the (auth) pages | FIXED (agent) + request-CSP mechanism + a real-browser regression test |
| 3.2 | **P0** The dashboard analytics query reads whole tables into JS - p50 467 ms. Per-leg: open invoices 483 KB/60 ms -> 140 KB/**25 ms**; students -> **3.2 ms**; the all-time period leg 1895 KB/**284 ms** -> `SUM()` = 21 B/**3.6 ms** (78x). **78 % of the cost is JS materialisation, not SQL** | OPEN - **designed, not landed** (the gateway lane). The reads are in `apps/gateway/routes/analytics.ts` (L374-414: six `findMany` in one `Promise.all` - the whole roster at L375, the unbounded open-invoice read at L386, the period-payment leg at L400, the refund leg at L411) plus the attributed-payments read at L438. The web app has NO dashboard query of its own - every number reaches it through the gateway - so the aggregation has to move into the gateway's AUDITED builders (`apps/gateway/lib/sql.ts`), never into raw SQL in the web (principle-lint L6, AGENTS.md 3.4). **THE THREE HAZARDS, so the next executor does not re-derive them:** (1) the JS window has THREE parts - the day-shape validity check (`readDay` returns null unless the first 10 chars match the YYYY-MM-DD pattern), and INCLUSIVE bounds on the TRIMMED day; the builder's range clause works on the RAW column, so a bound of `occurred_on <= periodEnd` would wrongly exclude a payment at `periodEndT10:00Z`. Either add a `substr(occurred_on,1,10)` expression form to the audited builder, or bound with `periodEnd + 'T23:59:59.999999Z'` - which is correct for both a bare date and a timestamp, because a shorter prefix sorts first - and add the pattern check, or a malformed `occurred_on` is INCLUDED by SQL and EXCLUDED by JS. (2) 'voided entries excluded' needs the REVERSAL graph, not the row's own `void_of_id`: the SQL must exclude a row whose id appears as some OTHER row's `void_of_id` (`id NOT IN (SELECT void_of_id FROM ledger_entries WHERE void_of_id IS NOT NULL)`) - the AUD-001 shape, and a subquery over the same tenant. (3) the two legs must be ONE transaction-consistent pair: the credit sum and the refund sum, so a payment and its refund cannot be counted on either side of a concurrent write. **GATE:** a test that computes the same figure BOTH ways over one fixture with the hard cases - a payment after `periodEnd`, a payment with a time component on the last day, a reversed payment, a refund, a malformed `occurred_on` - and asserts they agree paise for paise. A money figure is not worth a 78x win if the test is not in place first || 3.3 | **P0** The dashboard calls the most expensive gateway route **twice** per render (2 × 214–1184 ms) — one call is not memoised | FIXED (`0ff531e`) — the summary action and the analytics anchor now share one React `cache()`-memoised read of `/api/v1/analytics/dashboard` and ask it for the **same** window (the default dashboard period, which the anchor's only consumed field — `paymentBreakdown` — does not depend on). Measured on `next build`: **4 → 1** raw gateway calls to the route per dashboard render |
| 3.4 | **P1** A cold-isolate schema heal is **7 sequential Turso round trips** (~1.7 s at 240 ms RTT) — 6 separate `sqlite_master` probes | OPEN |
| 3.5 | **P1** The web middleware makes a Supabase Auth **WAN call per authenticated request** (236–707 ms). The gateway already migrated to `getClaims()`; the web proxy did not | OPEN |
| 3.6 | **P1** The 3D hero runs at **1.95 FPS** on a software GPU after 398 KB gzip of three.js/R3F/gsap; FCP 1292 ms | FIXED (`b3151d1`) - measured with a new reproducible harness (`apps/product-page/scripts/measure-hero-fps.ts`, headless Chromium on the pinned SwiftShader rasteriser, production build): the hero's frame cost fell **620 ms -> 321 ms** (1.6 -> 3.1 fps, 1.9x) and the **initial** JS fell **229.4 -> 186.7 KB gzip** (-42.7 KB, -18.6%). Four changes, each A/B'd pixel-for-pixel: the contact shadow is rendered **once** instead of five times per frame (mean difference 0.000/255), the adaptive DPR is wired to a signal that moves (`<AdaptiveDpr/>` was a no-op - nothing ever calls `performance.regress()`), the ladder can now **see the GPU** (only a discrete GPU gets the 4-sample transmission card), and **GSAP is imported dynamically**. The 3D stack itself is still 245 KB gzip against 20_3D §3's 180 KB budget - three.js 0.182 alone is ~165 KB gzip, so that budget needs a spec amendment (reported by the harness, not enforced) |
| 3.7 | **P1** The perf-budget **gates measure the machine**: the same test produced 12.4 ms, 6.3 ms and 8.4 ms against a 2 ms budget, and 164 ms against 100 ms. They fail on a loaded machine and would miss a real 10× regression on a quiet one | FIXED (`b2e4261`) - the gateway's gates are expressed in UNITS OF A MEMORY-BOUND STICK measured in the same run, interleaved ABBA, with the fastest batch as the estimator (`apps/gateway/__tests__/perf-stick.ts`); the spread between runs fell from 10× to 1.2×-2.3×. The budgets are now **recalibrated to 2× the worst observed ratio**, so a 3× regression trips them (verified red: a 3×-slower candidate measured 4.93 stick units against a budget of 4 → red; restored → green), the last two absolute budgets are gone (the 100 ms Promise.all ceiling is now a comparison against a single delay in the same run), and the perf suites have **their own serial lane** (`apps/gateway/vitest.perf.config.ts`, one worker, excluded from the root/integration/gateway configs so a measurement is never taken while 58 other files burn the CPU). The CI job that should run that lane is a `.github/**` change (supply-chain lane) |
 The perf lane now has its own CI job (`.github/workflows/test.yml`), so the gates are not merely runnable by hand || 3.8 | **P2** The three vitest configs disagree on timeouts (root 30 s/60 s, gateway 10 s/60 s, integration 10 s/no hookTimeout), so one tree had two verdicts | FIXED (gateway `hookTimeout` aligned) |

**Gate:** a perf report with before/after numbers per row; the perf gate passes on a loaded machine
AND on an idle one.

---

## Phase 4 — UI, a11y and design

| # | Finding | Status |
|---|---|---|
| 4.0 | **P2** `13_UI_Guidelines.md` 20 mandated a `pro-*` "Professional Polish Layer" of ~18 utilities that were NEVER BUILT - the consistency contract pointed at classes that did not exist, so nothing could enforce it. The app ships the 5 glass tiers, the 6 neumorphic controls and the 8 component recipes | FIXED (`58a7be0`) - 20 now describes what ships, and principle-lint L13 makes it a machine gate |
| 4.1 | **P1** The hero copy panel composites to **1.8–2.6 : 1** against the animated scene (34 %-opaque over an accent-bright WebGL backdrop); the token system's contrast guarantee does not cover it | OPEN (product-page lane) |
| 4.2 | **P1** The no-WebGL path is **500 vh** (600 vh on `/tour`) of frozen content | OPEN (product-page lane) |
| 4.3 | **P1** The "Poster" fallback is a flat colour rectangle, not a poster — the spec requires a static image | OPEN (product-page lane) |
| 4.4 | **P2** The `pro-*` consistency contract does not exist anywhere in the codebase | DECIDE — implement it, or amend §20/§21 to describe what ships |
| 4.5 | **P2** `packages/ui` is written against the **retired** palette and is imported by nobody | DECIDE (with AUD-028) |
| 4.6 | **P2** The Dashboard KPI strip is 7 cards in a 3/6-column grid — one card stranded at every breakpoint | FIXED (`08123b7`) — seven divides by none of 1/2/3/6, so the last card now carries `col-span-full` (`grid-column: 1 / -1`, every breakpoint) and the six above it tile evenly; the column counts are unchanged (§6.3) |
| 4.7 | **P2** The KPI card's only boundary is a 1 px accent tint at **1.38 : 1** (the system ships `--border-strong` at 3.01 : 1) | FIXED (`08123b7`) — the perimeter is `var(--border-strong)` (**3.006 : 1**) and the semantic signal is §5.4's 2 px accent left-bar in the FULL accent (**4.50–4.52 : 1**) plus the inset glow; no literal colour, no 25 % tint |
| 4.8 | **P2** Colour literals in the web token layer, including pure black and pure white; `.badge-count` measures **3.73 : 1** | FIXED (`ec59758`) - every colour-bearing declaration is a token role now; `.badge-count` paints `--text-inverse`, measured **5.31 : 1** on `--danger` (worst of the 20 palettes; `#FFFFFF` was **3.71 : 1**) |
| 4.9 | **P2** Every `.glass*` surface paints an opaque background and pays for a 24–28 px blur that cannot be seen | FIXED (`ec59758`) - the three tiers are translucent at the §5.2 contract (0.02 / 0.05 / 0.08), so the blur is observable; the composite is re-measured against the palette's solved surface stack on every change |
| 4.10 | **P2** A control that is both glass and neumorphic; `.neumo-raised` is `border-radius: var(--radius-full)` (pill-everything) | FIXED (`ec59758`) - `.neumo-raised` takes the §6.1 control radius (12px) with its dual shadow paired to it, and `.btn-glass` carries no glass material: the pressed shadow belongs to the §6.3 recipe |
| 4.11 | **P2** The web app ships **none** of `forced-colors`, `prefers-contrast: more`, `prefers-reduced-transparency` — the marketing site ships all three | FIXED (`ec59758`) - all three now ship at the surface level, plus the `@supports (backdrop-filter)` fallback; the design system already emitted the token-level half of two of them |
| 4.12 | **P2** The route-level loading boundary hard-codes the **dashboard** skeleton for all five screens | FIXED (`f6f0394`) - each of the five routes owns a boundary whose shape and label are the ones its own client component renders while it waits; the group-level file is deleted |
| 4.13 | **P3** Icon/ARIA hygiene slips | FIXED (`ec59758`) - the avatar's WCAG 1.4.11 comment now states the exemption correctly (a decorative element is exempt from the 3 : 1 floor, not held to it); the two remaining slips are outside this lane and are reported, not fixed |

---

## Phase 5 — Supply chain, CI gates and repo hygiene

| # | Finding | Status |
|---|---|---|
| 5.1 | **P1** A real `.env` (`DATABASE_URL`, `GATEWAY_SHARED_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) sat in an untracked **and unignored** stale `supabase/` mirror — one `git add -A` from committing production secrets | FIXED (mirror gitignored; rotate the values) |
| 5.2 | **P1** The gateway's `lint`/`typecheck` scripts were `echo` stubs — 60+ files of edge backend never checked by CI | FIXED (`812d5b3`) |
| 5.3 | **P1** The typecheck chain covered 3 of 10 workspaces | FIXED (`812d5b3`) |
| 5.4 | **P1** AGENTS.md §5.3's spec-ref CI gate does not exist | FIXED (`83aecfc`) - `scripts/spec-ref-gate.ts` + 13 tests; a `spec_ref` job in `lint.yml` blocks a PR whose description has no `## Spec ref` block or cites a spec that does not exist |
| 5.5 | **P1** §5.4's reviewer counts have no CODEOWNERS enforcement | FIXED (`83aecfc`) - `.github/CODEOWNERS` maps the ledger engine, the trust boundary, the crypto envelope, the constitution and the gates to owners; branch protection (2 approvals) is still an OWNER action - the file says who, not how many |
| 5.6 | **P1** The accessibility gate **skips silently** without CI credentials | FIXED (`788dba3`) - `scripts/a11y-gate.ts` runs axe-core against the LOCAL server with NO credentials and NEVER skips (an unreachable server or an unrendered route FAILS); wired into `test.yml` + `web-prod-gate.yml` as a blocking step |
| 5.7 | **P1** OSV-Scanner / license-checker / SBOM are advisory where the harness spec demands a hard gate | OPEN |
| 5.8 | **P2** An unpinned Semgrep image, an unverified downloaded binary, an `@latest` package executed in CI | OPEN |
| 5.9 | **P2** The gateway's vendored flow has **no freshness gate** — the two tests its header cites do not exist | OPEN |
| 5.10 | **P2** 1,546 lines of dead microservices carrying a Rule-1 landmine (`DROP TRIGGER` + `DELETE FROM ledger_entries`) | FIXED (`da8711f`) - `apps/services/**` (34 files) DELETED with the landmine at `auth-svc/src/index.ts:131-143`; the `L1_ALLOW` entry that allowlisted it is gone, the workspace glob, the `oxlint` override and the two ignore files are updated. NOTE: swept into a concurrent lane's commit by a repo-wide `git add -A`; content verified. The zero-external-reference proof is in the lane report |
| 5.11 | **P2** `packages/security` / `packages/ui` / 5 orphan root scripts - dead code | PARTIAL (`da8711f`) - `packages/security` (14 files) and the 5 orphan root scripts (`extract_schema.py`, `init_db.py`, `refactor.ts`, `scaffold.ts`, `diagnose.ts`) DELETED after a repo-wide importer search found none. `packages/ui` is KEPT: `apps/desktop/package.json:14` declares `"@buddysaradhi/ui": "workspace:*"`, and `apps/desktop/**` is LOCKED until the DESKTOP gate (AGENTS.md §9.3) - removing the dependency needs that unlock |
| 5.12 | **P2** Two divergent migration lineages, both named `0001_init.sql` | FIXED (`08b875b`) - the ROOT `migrations/` is the live lineage (`apps/web/scripts/seed.ts:16`, `packages/core/src/migration0002.test.ts:29`, `apps/gateway/__tests__/invoices-ddl-parity.test.ts:34` all read it); the dead `apps/gateway/migrations/` copy (3 files) DELETED and the gateway README corrected |
| 5.13 | **P2** `no-orphaned-task` lint + `webDevReview` cron do not exist | FIXED (`1aec62e`) - `scripts/no-orphaned-task.ts` + 13 tests (one negative control per rule) and `.github/workflows/webdev-review.yml` (the `*/15` cron + the lint on every PR) |
| 5.14 | **P2** L7 (3 `.mjs` build scripts) + L10 (a floating dependency in `apps/desktop/package.json`) | OPEN |
| 5.15 | **P3** `worklog.md`'s platform-state block is dated 2026-08-21 and contains literal placeholders | FIXED (`08b875b`) - the block now states the REAL position with the evidence for each line (W1 PARTIAL, W2 PARTIAL, W3 PENDING - `git tag -l` is empty, W4 PARTIAL, W5 PENDING - no Lighthouse config, W6 PARTIAL, W7 PENDING); the placeholders (`W1? W2? …`) are gone. NOTE: swept into a concurrent lane's commit by a repo-wide `git add -A`; content verified |

---

## Phase 6 — Verification and release

1. Full gate: `bun run lint` · `bun run typecheck` · root `vitest run` · gateway suite · `deno check` ·
   `next build` (web + product-page).
2. Re-run the Kali suite against the local rig: nmap, nikto, sqlmap, ffuf, ZAP, Metasploit, tshark.
3. Deploy, then re-probe the live deployment for the items that were live-only (the CSP nonce on
   `/login`, the CORS shape, the erased-cascade completion, the chunked-body limit).
4. Update `docs/audit/AUDIT-2026-10-21.md` §0.0 and this plan with the final state.

---

## Ownership map (one owner per file — no shared-module overlap)

| Lane | Owns |
|---|---|
| gateway trust boundary | `apps/gateway/lib/**`, `apps/gateway/routes/**` (minus the in-flight `ledger.ts`/`sql.ts`) |
| money engine | `packages/core/**`, `packages/shared/**` |
| web app | `apps/web/src/**`, `apps/web/next.config.ts` |
| product page + design | `apps/product-page/**`, `packages/design-system/**`, `packages/ui/**` |
| supply chain / CI | `.github/**`, `scripts/**`, root manifests, `docs/**` |
