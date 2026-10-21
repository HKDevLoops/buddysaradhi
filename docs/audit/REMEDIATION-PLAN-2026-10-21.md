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
| 0.4 | Landing the four agents' in-flight edits (109 files) as reviewable commits | OPEN |
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

**Gate:** `packages/core` 249 passed + 8 expected-fail · `packages/shared` 321 green · the parity gate
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
| 2.7 | **P2** The schema heal swallows its own failure and the request proceeds against an unhealed DB | OPEN |
| 2.8 | **P2** `GATEWAY_ADMIN_TOKEN` is documented as the erase route's second factor and is read by **no** handler | OPEN |
| 2.9 | **P2** `PIN_PEPPER` defaults to the request-signing HMAC key - a fleet-wide impersonation key that is also an offline PIN-cracking key | OPEN |
| 2.10 | **P2** The gateway is a **public** Supabase Edge Function that dials a caller-supplied `X-Db-Url` - loopback, `169.254.169.254`, RFC1918 - and a dead host **hangs** the request | **FIXED** - `lib/db-url-policy.ts`, enforced before anything is dialed. **GW-02** |
| 2.11 | **P2** The gateway's ledger outbox payloads for the invoice and void paths are minimal - a replica cannot rebuild the row | OPEN (in-flight file) |
| 2.12 | **P3** `checkRateLimit` never increments on the reject path - the backoff cannot escalate | OPEN |
| 2.13 | **P0** A captured signed payment replayed onto a **second isolate** charged twice - two `PAYMENT_RECEIVED` rows of 4242 paise from one capture | **FIXED** - the nonce is now claimed durably in the tenant's own DB (`lib/replay.ts`). **GW-01** |
| 2.14 | **P1** "Securely erase all tutor data" left the **idempotency store** behind - every row holds a stored mutation's response body (receipt number, balance) | **FIXED** - wiped in the same cascade transaction. **GW-03** |
| 2.15 | **P2** A GraphQL tenant-mismatch refusal was reported as **500 INTERNAL** - a client error as a server fault | **FIXED** -> typed 403. **GW-05** |
| 2.16 | **P2** The edge cache key `gw:<tenant>:<path>:<qs>` omits the **database identity**, so a request naming another DB is served the previous DB's cached rows | REPORTED. **GW-06** |
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
| 3.2 | **P0** The dashboard analytics query reads whole tables into JS — p50 467 ms. Per-leg: open invoices 483 KB/60 ms → 140 KB/**25 ms**; students → **3.2 ms**; the all-time period leg 1895 KB/**284 ms** → `SUM()` = 21 B/**3.6 ms** (78×). **78 % of the cost is JS materialisation, not SQL** | OPEN |
| 3.3 | **P0** The dashboard calls the most expensive gateway route **twice** per render (2 × 214–1184 ms) — one call is not memoised | OPEN |
| 3.4 | **P1** A cold-isolate schema heal is **7 sequential Turso round trips** (~1.7 s at 240 ms RTT) — 6 separate `sqlite_master` probes | OPEN |
| 3.5 | **P1** The web middleware makes a Supabase Auth **WAN call per authenticated request** (236–707 ms). The gateway already migrated to `getClaims()`; the web proxy did not | OPEN |
| 3.6 | **P1** The 3D hero runs at **1.95 FPS** on a software GPU after 398 KB gzip of three.js/R3F/gsap; FCP 1292 ms | OPEN |
| 3.7 | **P1** The perf-budget **gates measure the machine**: the same test produced 12.4 ms, 6.3 ms and 8.4 ms against a 2 ms budget, and 164 ms against 100 ms. They fail on a loaded machine and would miss a real 10× regression on a quiet one | OPEN — hermetic lane + ratio budgets |
| 3.8 | **P2** The three vitest configs disagree on timeouts (root 30 s/60 s, gateway 10 s/60 s, integration 10 s/no hookTimeout), so one tree had two verdicts | FIXED (gateway `hookTimeout` aligned) |

**Gate:** a perf report with before/after numbers per row; the perf gate passes on a loaded machine
AND on an idle one.

---

## Phase 4 — UI, a11y and design

| # | Finding | Status |
|---|---|---|
| 4.1 | **P1** The hero copy panel composites to **1.8–2.6 : 1** against the animated scene (34 %-opaque over an accent-bright WebGL backdrop); the token system's contrast guarantee does not cover it | OPEN (product-page lane) |
| 4.2 | **P1** The no-WebGL path is **500 vh** (600 vh on `/tour`) of frozen content | OPEN (product-page lane) |
| 4.3 | **P1** The "Poster" fallback is a flat colour rectangle, not a poster — the spec requires a static image | OPEN (product-page lane) |
| 4.4 | **P2** The `pro-*` consistency contract does not exist anywhere in the codebase | DECIDE — implement it, or amend §20/§21 to describe what ships |
| 4.5 | **P2** `packages/ui` is written against the **retired** palette and is imported by nobody | DECIDE (with AUD-028) |
| 4.6 | **P2** The Dashboard KPI strip is 7 cards in a 3/6-column grid — one card stranded at every breakpoint | OPEN |
| 4.7 | **P2** The KPI card's only boundary is a 1 px accent tint at **1.38 : 1** (the system ships `--border-strong` at 3.01 : 1) | OPEN |
| 4.8 | **P2** Colour literals in the web token layer, including pure black and pure white; `.badge-count` measures **3.73 : 1** | OPEN |
| 4.9 | **P2** Every `.glass*` surface paints an opaque background and pays for a 24–28 px blur that cannot be seen | OPEN |
| 4.10 | **P2** A control that is both glass and neumorphic; `.neumo-raised` is `border-radius: var(--radius-full)` (pill-everything) | OPEN |
| 4.11 | **P2** The web app ships **none** of `forced-colors`, `prefers-contrast: more`, `prefers-reduced-transparency` — the marketing site ships all three | OPEN |
| 4.12 | **P2** The route-level loading boundary hard-codes the **dashboard** skeleton for all five screens | OPEN |
| 4.13 | **P3** Icon/ARIA hygiene slips | OPEN |

---

## Phase 5 — Supply chain, CI gates and repo hygiene

| # | Finding | Status |
|---|---|---|
| 5.1 | **P1** A real `.env` (`DATABASE_URL`, `GATEWAY_SHARED_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) sat in an untracked **and unignored** stale `supabase/` mirror — one `git add -A` from committing production secrets | FIXED (mirror gitignored; rotate the values) |
| 5.2 | **P1** The gateway's `lint`/`typecheck` scripts were `echo` stubs — 60+ files of edge backend never checked by CI | FIXED (`812d5b3`) |
| 5.3 | **P1** The typecheck chain covered 3 of 10 workspaces | FIXED (`812d5b3`) |
| 5.4 | **P1** AGENTS.md §5.3's spec-ref CI gate does not exist | OPEN |
| 5.5 | **P1** §5.4's reviewer counts have no CODEOWNERS enforcement | OPEN |
| 5.6 | **P1** The accessibility gate **skips silently** without CI credentials | OPEN |
| 5.7 | **P1** OSV-Scanner / license-checker / SBOM are advisory where the harness spec demands a hard gate | OPEN |
| 5.8 | **P2** An unpinned Semgrep image, an unverified downloaded binary, an `@latest` package executed in CI | OPEN |
| 5.9 | **P2** The gateway's vendored flow has **no freshness gate** — the two tests its header cites do not exist | OPEN |
| 5.10 | **P2** 1,546 lines of dead microservices carrying a Rule-1 landmine (`DROP TRIGGER` + `DELETE FROM ledger_entries`) | OPEN |
| 5.11 | **P2** `packages/security` / `packages/ui` / 5 orphan root scripts — dead code | OPEN |
| 5.12 | **P2** Two divergent migration lineages, both named `0001_init.sql` | OPEN |
| 5.13 | **P2** `no-orphaned-task` lint + `webDevReview` cron do not exist | OPEN |
| 5.14 | **P2** L7 (3 `.mjs` build scripts) + L10 (a floating dependency in `apps/desktop/package.json`) | OPEN |
| 5.15 | **P3** `worklog.md`'s platform-state block is dated 2026-08-21 and contains literal placeholders | OPEN |

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
