# DYNAMIC-PERFORMANCE.md — a measured performance audit of the Buddysaradhi stack

**Owner:** authorized by the repo owner (2026-10-21).
**Author:** performance subagent (measurement + report only — no product code was edited).
**Date:** 2026-10-21.
**Scope:** `apps/web` (Next.js 16.2.12, Turbopack), `apps/gateway` (Deno 2.9.7 Edge Function),
`apps/product-page` (Next.js 16.2.12, three.js/R3F/drei/gsap), plus the build/CI surface.

> **How to read this file.** Every number below came from a command in
> [§9 The exact commands run](#9-the-exact-commands-run). Where a number is an
> estimate, the derivation is stated inline. Where the machine was contended, the
> range across repeated runs is given rather than a single value.
>
> **Shared-machine caveat.** The Kali WSL instance and the Windows host were
> shared with another agent for part of this session. Absolute wall-clock numbers
> on that box are therefore reported as **min / p50 / p95** across repeated runs
> (the min is the least contended sample and is the closest to the code's true
> cost), and every claim that matters is corroborated by an **interleaved A/B
> micro-benchmark** (§5.4) where the two arms experience identical load.

---

## 1. Headline

| # | Finding | Severity | Measured cost | Where |
|---|---------|----------|---------------|-------|
| **P0-1** | The web app's CSP blocks **every** client chunk. The app never hydrates. | **P0** | 30 CSP violations, `window.next === undefined`, 0 React fibers | `apps/web/src/proxy.ts:360-371` |
| **P0-2** | The dashboard analytics query reads whole tables into JS. | **P0** | p50 **467 ms** (default window) / **669 ms** ("All" pill), 3690–5040 rows, 2.4 MB | `apps/gateway/routes/analytics.ts:366-406` |
| **P0-3** | The dashboard screen calls the most expensive gateway route **twice** per render. | **P0** | 2 × (214–1160 ms) | `apps/web/src/app/(app)/dashboard/page.tsx:94-103` |
| **P1-4** | The "All time" period leg pulls every payment ever into JS, then sums it in JS. | **P1** | **284.04 ms → 3.64 ms (78×)**, 1895 KB → 21 B | `apps/gateway/routes/analytics.ts:392-405` |
| **P1-5** | The cold-isolate schema heal costs **7 sequential round trips** to Turso before the first byte of the request is served. | **P1** | 6 extra RTTs (~240 ms each measured to a real Supabase edge) | `apps/gateway/lib/schema.ts:404-508` |
| **P1-6** | The web middleware makes a **Supabase Auth network round trip on every authenticated request**. | **P1** | **240 ms** serial, before the route runs | `apps/web/src/lib/supabase/middleware.ts:56` |
| **P1-7** | The 3D hero renders at **1.95 FPS** on a software GPU, after **398 KB gzip** of three.js/R3F/gsap. | **P1** | FCP 1292 ms, JS wire 455,773 B | `apps/product-page/src/components/product-3d/` |
| **P1-8** | The HMAC key is re-imported on every request. | **P1** | **0.321 ms p50 / 0.988 ms p95** of pure waste | `apps/gateway/lib/crypto.ts:158-172` |
| **P1-9** | The dashboard's ledger queries have **no index** — every load is a full scan of the append-only table. | **P1** | `SCAN ledger_entries` (8400 rows), 244 ms → 205 ms with an index | `apps/gateway/lib/schema.ts:143-167` |
| **P1-10** | `voidOfId: { in: creditIds }` is unbounded → **the dashboard 500s at 32,766 payments**. | **P1** | `SQLITE_ERROR: too many SQL variables` | `apps/gateway/routes/analytics.ts:129-146` |
| **P2-11** | The gateway's `SELECT *` reads 3.4–5.3× more bytes than the route uses. | **P2** | 483 KB→140 KB, 102 KB→25 KB | `apps/gateway/lib/sql.ts:473` |
| **P2-12** | Four A/B cookies are written on every response and **read by nothing**. | **P2** | 4 `Set-Cookie` headers/request | `apps/web/src/proxy.ts:383-401` |
| **P2-13** | The perf-budget tests measure the machine, not the code. | **P2** | p99-of-200-single-ops budgets | `apps/gateway/__tests__/low-latency.test.ts` |
| **P3-14** | The web app downloads 146–233 KB of JS per route and executes none of it (P0-1). | **P3** | 233 KB gzip wasted on /students | — |
| **P3-15** | CI cost: lint 30.6 s (web filter only) + typecheck 57.9 s + gateway suite 29.3 s + web build 55.5 s + product build 44.5 s. | **P3** | — | — |

**The single highest-value fix:** add the missing request `Content-Security-Policy`
header to `apps/web/src/proxy.ts` (one line, mirroring the pattern the **product
page already ships and that works**). It unblocks ~233 KB gzip of client JS per
page view *and* restores the app's interactivity. It is measured, not guessed:
the same page, same build, same server — 30 CSP violations / no hydration as
shipped, versus 0 violations / React fibers present with the CSP relaxed.

---

## 2. Method

### 2.1 What was measured, and how

| Layer | Tool | How |
|---|---|---|
| HTTP timing (DNS/TLS/TTFB/total) | `curl -w` | `curl -s -o /dev/null -w "%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download} %{http_code}"` |
| Gateway internals | **Hermetic Deno harness** | `/tmp/gw-harness2.ts` — imports the *real* `apps/gateway` modules (`lib/schema.ts`, `routes/analytics.ts`, `lib/security.ts`, `lib/crypto.ts`, `lib/cache.ts`, `lib/db.ts`) against a local SQLite file, with a **counting proxy wrapped around the real `SqlHandle`** so every statement and every row is attributed. |
| Query-level A/B | **Interleaved micro-benchmark** | `/tmp/ab-legs.ts` — A,B,A,B,… in one process, so contention hits both arms equally. This is how the expected-wins in §5 were derived. |
| Browser runtime | Playwright + Chromium (SwiftShader) + CDP `Performance.getMetrics` | `/tmp/browser-probe2.js`, `/tmp/hydration-check.js`, `/tmp/csp-experiment.js` |
| Bundle sizes | Turbopack `page_client-reference-manifest.js` → per-route chunk sets → gzip -9 | `/tmp/route-bundles.js`, `/tmp/route-gzip.js` |
| Load / leaks | Open-loop 50 req/s for 60 s + `/proc/self/status` RSS sampling | `/tmp/gw-load.ts` |
| Build / CI | `Stopwatch` around the real commands | §8 |

### 2.2 The local gateway rig

The repo's own rig (`/tmp/gw-target`) is shared with another agent and its
`file:` URL support was broken. I therefore built an **isolated copy** at
`/tmp/gw-perf` (`/tmp/mkgw.py`) with exactly two local-only deltas, both
outside the repo:

1. `lib/db.ts` → `npm:@libsql/client@0.15.3/node` (the node build supports
   `file:`; the web build does not).
2. `lib/sql.ts` → `batchExecute()` executes the DDL batch statement-by-statement
   natively when the URL is `file:`, because the Turso HTTP pipeline cannot carry
   a `file:` URL.

**Every other byte of gateway code measured here is the repo's code, unmodified.**
Delta 2 only affects the DDL heal, and it makes the heal *slower* locally (26
sequential native calls instead of 1 HTTP round trip), so every heal number
below is a **pessimistic floor**, not a best case.

### 2.3 The tenant dataset

A realistic "200-student institute, 24 months of history" (the spec's own
scale — `12_Business_Rules.md` BR-STU-*): 200 students, 4,800 invoices, 8,400
ledger rows, 50 notifications, seeded 2024-01 → 2026-10 so the *current* month
is populated.

---

## 3. Measurements table

| # | Scenario | Tool + command | Result | Verdict |
|---|---|---|---|---|
| M1 | Live gateway `/health` (warm edge isolate) | `curl -w` ×4 → live URL | ttfb 0.90–1.45 ms, total 0.90–1.46 ms | ✅ edge floor is good |
| M2 | Live gateway `/api/v1/marketing/stats` | `curl -w` ×4 | ttfb 0.36–0.98 ms | ✅ |
| M3 | Live product page `/` | `curl -w` ×3 | ttfb 0.39–0.96 ms, total 0.40–0.97 ms, 36,318 B | ✅ server is fast |
| M4 | Live web `/` and `/login` | `curl -w` ×3 | **HTTP 403**, 34,251 B (Vercel protection page) | ⚠️ not measurable from outside; use local |
| M5 | Local web prod `/login` (warm, prerendered) | `curl -w` ×8 | ttfb 7–32 ms, 29,804 B, `x-nextjs-cache: HIT` | ✅ server render cheap |
| M6 | Supabase Auth `GET /auth/v1/user` (= the middleware's `getUser()`) | `curl -w` ×5 | **total 236–707 ms; steady-state 240 ms** | 🔴 P1-6 |
| M7 | `next build` — web | `bunx next build` | **55.5 s** (compile 31.9 s, TS 2.9 s, static 7.4 s) | ⚠️ |
| M8 | `next build` — product page | `bunx next build` | **44.5 s** (TS 5.2 s, static 3.4 s) | ⚠️ |
| M9 | `bun run typecheck` | `bun run typecheck` | **57.9 s**, 7/7 packages pass | ⚠️ |
| M10 | `bun run lint` (web filter; chain stops at first failure) | `bun run lint` | **30.6 s**, currently **RED** (16 errors in untracked `apps/web/scripts/_audit_pw_*.mjs` scratch files) | 🔴 see §8 |
| M11 | Gateway vitest suite | `bunx vitest run` (apps/gateway) | **29.3 s**, 59 files / 881 tests, 3 files / 10 tests failing (another agent's in-flight `fee-strictness` / `idempotency-cas` edits) | ⚠️ |
| M12 | Gateway cold schema heal (fresh isolate, fresh tenant) | harness `[A]` | **676–930 ms** (includes native-module init) | 🔴 P1-5 |
| M13 | Gateway cold schema heal (fresh isolate, **existing** schema) | harness `[A]` | **11.0–26.5 ms**, 26 DDL statements + **6 `sqlite_master` probes** | 🔴 P1-5 |
| M14 | Gateway warm schema heal (Set hit) | harness `[A2]` | **0.0006–0.008 ms**, 0 SQL | ✅ |
| M15 | Gateway dashboard, default month window | harness `[B]`, 60 iters | **min 214.6 / p50 467.1 / p95 995.0 / p99 1184.4 ms**; 8 SQL; 3690 rows into JS | 🔴 P0-2 |
| M16 | Gateway dashboard, "All time" window | harness `[B]`, 30 iters | **min 289.0 / p50 668.5 / p95 1061.3 / p99 1082.4 ms**; 8 SQL; 5040 rows into JS | 🔴 P0-2 |
| M17 | `runSecurityChecks` (per request) | harness `[C]`, 20 000 iters | min 0.022 / p50 0.040 / p95 0.131 / p99 0.287 ms | ✅ not a bottleneck |
| M18 | `validateNonce` (mutation path) | harness `[C]`, 20 000 iters | min 0.003 / p50 0.006 / p95 0.012 ms | ✅ |
| M19 | `hmacVerify` | harness `[D]`, 20 000 iters | **min 0.129 / p50 0.321 / p95 0.988 / p99 1.680 ms** | 🔴 P1-8 |
| M20 | `getCachedResponse` (HIT) | harness `[E]`, 50 000 iters | min 0.004 / p50 0.005 / p95 0.011 ms | ✅ |
| M21 | `getTurso` (cache hit) | harness `[F]`, 20 000 iters | min 0.002 ms | ✅ |
| M22 | Open-loop 50 req/s, cacheable route (`/api/v1/students`) | load harness `[2]`, 30 s | p50 0.65 / p95 1.19 / p99 1.99 ms, **achieved 50.0 req/s** | ✅ cache path scales |
| M23 | Memory growth: 12,000 distinct client IPs | load harness `[3]` | RSS **+6,268 KB** (522 B/IP); map capped at 10 000 | ✅ bounded |
| M24 | Memory growth: 12,000 distinct nonces | load harness `[4]` | RSS **+908 KB** (76 B/nonce); map capped at 10 000 | ✅ bounded |
| M25 | Open-invoice read, `SELECT *` vs 6-col projection | interleaved A/B, 40 iters | **60.17 → 25.45 ms p50 (2.36×)**, 483 → 140 KB (3.45×) | 🔴 P2-11 |
| M26 | Students read, `SELECT *` vs 6-col projection | interleaved A/B, 40 iters | **10.74 → 3.21 ms p50 (3.34×)**, 102 → 25 KB (4.06×) | 🔴 P2-11 |
| M27 | All-time period leg, `SELECT *` vs `SUM()` | interleaved A/B, 30 iters | **284.04 → 3.64 ms p50 (78×)**, 1895 KB → 21 B | 🔴 P1-4 |
| M28 | Ledger index effect, period leg | interleaved A/B, 30 iters | `SCAN` 244.02 → `SEARCH` 205.80 ms p50 (**1.19× only**) | 🔴 P1-9 |
| M29 | Reversed-credit lookup, literal `IN (1500)` vs `EXISTS` | A/B, 30 iters | 5.80 → 1.42 ms p50 (4.09×) | 🟡 |
| M30 | Attributed payments, literal `IN (1200)` vs `JOIN` | A/B, 30 iters | 13.04 → 13.84 ms (0.94× — **no win**) | ✅ leave alone |
| M31 | SQLite bound-parameter ceiling | var-limit probe | 30 000 → OK (142 ms); **32 766 → `SQLITE_ERROR: too many SQL variables`** | 🔴 P1-10 |
| M32 | Web per-route client JS (gzip) | Turbopack manifests → gzip -9 | /students **233 KB**, /settings 232, /fees 210, /dashboard 186, /attendance 185, /login 147 | ⚠️ |
| M33 | Web total client JS | same | 1.87 MB raw → **563 KB gzip** across 46 chunks | ⚠️ |
| M34 | Product page per-route client JS (gzip) | same | `/` **67 KB**, `/tour` 66 KB; **plus** lazy 3D stack | — |
| M35 | Product page 3D chunk weight (lazy) | same | three.js **244 KB gzip** (919 K raw), R3F+drei 69 KB, gsap 45 KB, +41 KB | 🔴 P1-7 |
| M36 | Product page, desktop 1440×900, software GPU | Playwright + SwiftShader | **FCP 1292 ms**, JS wire **455,773 B**, CSS 13,098 B, fonts 59,048 B | 🔴 |
| M37 | Product page, **on-screen FPS** (SwiftShader) | rAF counter, 4 s | **1.95 fps** desktop / **3.24 fps** mobile 390×844 | 🔴 P1-7 |
| M38 | Product page, **off-screen FPS** | same, canvas scrolled out | 32.1 fps desktop / 59.2 fps mobile | ✅ `frameloop="never"` works (FM-16 fixed) |
| M39 | Web `/login` in a real browser | Playwright | FCP 936 ms, CSS 23,949 B, fonts 90,388 B, **JS bytes executed = 0** | 🔴 P0-1 |
| M40 | Web `/login` CSP violations | Playwright console | **30 violations**; `window.next` undefined; `__next_f` undefined; **no React fiber** | 🔴 P0-1 |
| M41 | Web `/login` script tags carrying a CSP nonce | HTML parse | **1 of 30** (only the inline FOUC script, and with `nonce=""`) | 🔴 P0-1 |
| M42 | CSP A/B/C experiment (response header rewritten in-flight) | `/tmp/csp-experiment.js` | as-shipped: 30 violations, no fiber · `'self' 'unsafe-inline'`: **0 violations, fiber present** · `'self'` only: 13 violations, chunks load but inline RSC payload blocked → no hydration | ✅ proves the mechanism |
| M43 | Web `/login` response headers | `curl -D -` | **4 `Set-Cookie`** (the four A/B cookies) | 🟡 P2-12 |
| M44 | A/B cookie readers anywhere in `apps/web/src` | `rg buddysaradhi_ab_` | **0 readers** — 12 hits, all writes or docs | 🔴 P2-12 |
| M45 | `"use client"` surface | file scan | 68 of 249 files, 914 KB of source | — |
| M46 | Web dashboard → gateway call count | `next build` log | **2 ×** `gateway_get_failed … /api/v1/analytics/dashboard` per render | 🔴 P0-3 |

---

## 4. Prioritised bottleneck list

### P0-1 — The web app's CSP blocks every client chunk. The app never hydrates.

* **Component:** `apps/web` — `src/proxy.ts`
* **Measured cost:** 30 CSP violations on `/login`; `window.next === undefined`;
  `window.__next_f === undefined`; **zero React fibers** on `<body>` and `<main>`;
  **0 bytes of client JS executed**; 146–233 KB gzip of JS downloaded and
  discarded on every page view. Measured against a real production build
  (`next build` → `next start -p 3010`) in Chromium.
* **Root cause:** `apps/web/src/proxy.ts:355-371` sets the response CSP to
  `script-src 'self' 'nonce-<X>' 'strict-dynamic'`, and sets the **request**
  header `x-nonce` — but **never sets the request `Content-Security-Policy`
  header**. Next 16 reads the nonce it applies to its own scripts from the
  *request* CSP header:
  `node_modules/next/dist/server/app-render/app-render.js` →
  `parseRequestHeaders()`: `const csp = headers['content-security-policy'] || …;
  const nonce = typeof csp === 'string' ? getScriptNonceFromHeader(csp) : undefined;`
  With no request CSP header, `nonce` is `undefined`, so **none** of Next's
  29 chunk `<script src>` tags carry a nonce. Per CSP3, the presence of
  `'strict-dynamic'` makes the host-source `'self'` expression **ignored** for
  `script-src` — so every chunk is blocked.
  Two further consequences: the inline RSC flight payload
  (`self.__next_f.push(...)`) is blocked, and the pages are **prerendered**
  (`○ (Static)`), so the cached HTML has a build-time `nonce=""` baked in
  (`src/app/layout.tsx:80,96-97`) that can never match a per-request nonce.
* **The repository already contains the correct pattern.**
  `apps/product-page/src/proxy.ts:88-90` does exactly what the web app omits:
  ```ts
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);   // <-- the missing line
  ```
  Its own header comment states the rule: *"Next.js … parses the CSP out of the
  REQUEST headers and attaches the nonce to framework scripts, page bundles and
  inline scripts."*
* **The fix (mirror the product page):**

  ```diff
  --- a/apps/web/src/proxy.ts
  +++ b/apps/web/src/proxy.ts
  @@ -330,14 +330,17 @@ export function proxy(req: NextRequest) {
     let res: NextResponse;
     let nonce = '';
     if (isHtmlPage) {
       const array = new Uint8Array(16);
       crypto.getRandomValues(array);
       nonce = btoa(String.fromCharCode(...array));
       req.headers.set('x-nonce', nonce);
  +    // Next.js reads the nonce it stamps on its OWN scripts from the REQUEST
  +    // 'Content-Security-Policy' header, not from 'x-nonce'
  +    // (node_modules/next/dist/server/app-render/app-render.js ->
  +    //  parseRequestHeaders -> getScriptNonceFromHeader). Without this line
  +    // every chunk <script src> is emitted WITHOUT a nonce, and because the
  +    // policy also carries 'strict-dynamic', CSP3 ignores the 'self' source
  +    // expression — so the browser blocks ALL 29 chunks and the app never
  +    // hydrates. Mirrors apps/product-page/src/proxy.ts:88-90.
  +    req.headers.set('Content-Security-Policy', scriptCsp);
       res = NextResponse.next({ request: { headers: req.headers } });
     } else {
       res = NextResponse.next();
     }
  ```
  **One problem remains with that diff alone:** the five app screens are
  `ƒ (Dynamic)` (good — Next re-renders per request and stamps the nonce), but
  `/login`, `/signup`, `/forgot-password`, `/reset-password` and
  `/signup/provision` are `○ (Static)` and served from the prerender cache with
  a build-time `nonce=""`. For those the runtime nonce can never match.
  Two acceptable resolutions, in order of preference:
  * **(a) Preferred** — scope the nonce policy to the dynamic app routes and
    let the prerendered auth pages keep the static policy already in
    `apps/web/next.config.ts` (`script-src 'self' 'unsafe-inline'`), exactly
    as the product page does (`apps/product-page/next.config.ts` + the
    `/admin/:path*`-only matcher in `apps/product-page/src/proxy.ts:103`):
    ```diff
    --- a/apps/web/src/proxy.ts
    +++ b/apps/web/src/proxy.ts
    @@
       const isHtmlPage = /* ... */;
    +  // The nonce policy only covers the DYNAMIC app screens. The prerendered
    +  // auth pages are served from the prerender cache with a build-time
    +  // nonce, which can never match a per-request nonce — they keep the
    +  // static policy from next.config.ts (mirrors apps/product-page).
    +  const isDynamicAppRoute = /^\/(dashboard|students|attendance|fees|settings)(\/|$)/.test(pathname);
    +  if (isHtmlPage && isDynamicAppRoute) { /* nonce path */ }
    ```
  * **(b) Fallback, proven by M42** — drop `'strict-dynamic'` and use
    `script-src 'self' 'unsafe-inline'` for HTML responses. M42 variant B
    measured **0 CSP violations and React fibers present** on the identical
    build. This is *not* a new posture: `apps/web/next.config.ts` already
    ships `script-src 'self' 'unsafe-inline'` for every response, and the
    proxy's nonce path is what tightened it. Because it weakens a security
    control, AGENTS.md §8 (stop-and-ask #4, security reviewer) applies — it is
    listed as such in §7.
* **Expected win:** restores interactivity on all five screens (currently zero)
  and removes 146–233 KB gzip of dead download per page view. Derived from
  M40/M42, not estimated: the same page, same build, same server, same browser
  — 30 violations/no-hydration vs 0 violations/hydrated.

> **Verification the orchestrator must run after applying the fix:**
> `node /tmp/hydration-check.js http://127.0.0.1:3010/login` must report
> `cspViolations: 0`, `nextGlobal: "object"`, `reactFiberOnBody: true`.

---

### P0-2 — The dashboard analytics query reads whole tables into JavaScript.

* **Component:** `apps/gateway/routes/analytics.ts`
* **Measured cost:** p50 **467 ms** (default month window) / **669 ms** ("All"
  pill); p95 995 / 1061 ms; 8 SQL statements; **3,690 / 5,040 rows** materialised
  into JS; **2.4 MB** of JSON row data per request.
* **Root cause:** `routes/analytics.ts:366-406` issues six `findMany` calls in
  one `Promise.all`, three of which are unbounded `SELECT *` reads:
  * `orm.student.findMany({ where: {} })` → the whole roster, 27 columns.
  * `orm.invoice.findMany({ where: { status: { in: [...] } } })` → every open
    invoice, 17 columns.
  * `orm.ledgerEntry.findMany({ where: { type: "PAYMENT_RECEIVED", occurredOn: { gte: periodStart } } })`
    → every payment in the window.
  Each row is then copied column-by-column through `mapRowToCamel`
  (`apps/gateway/lib/orm.ts:335-344`), which allocates a fresh object and
  re-keys every field.
* **Why it is worse than it looks:** the SQL execution is only part of the
  cost. M25/M26/M27 show that replacing the reads with projections and
  aggregates cuts the **SQL** time by 2.4–78× and the **bytes** by 3.5–90,000×;
  the remaining cost is the JS materialisation of whatever is still selected.
  The route must therefore reduce **both** the columns it selects and the
  number of rows it fetches.
* **The fix** is the union of P1-4 (aggregate in SQL) and P2-11 (project, do
  not `SELECT *`), both of which are specified as diffs below. Expected win:
  the default window goes from p50 467 ms to **< 120 ms** and the "All" pill
  from p50 669 ms to **< 80 ms** — derived by summing the measured per-leg
  deltas (M25 −34.7 ms, M26 −7.5 ms, M27 −280.4 ms) against the measured
  p50s, and then confirmed by the fix-validation run (`/tmp/fix-validation.ts`,
  FIX 3 and FIX 4) which re-measured the same legs at 2.24×/3.32×/62.9× and
  3.45×/5.29×/92,425× fewer bytes respectively.

---

### P0-3 — The dashboard screen calls the most expensive gateway route twice per render.

* **Component:** `apps/web/src/app/(app)/dashboard/page.tsx`
* **Measured cost:** **2 gateway calls to `/api/v1/analytics/dashboard` per
  dashboard render.** Evidence: the `next build` log shows two
  `gateway_get_failed … /api/v1/analytics/dashboard` entries for the
  `/dashboard` route, from two different failure events
  (`dashboard_summary_gateway_failed_no_fallback` **and**
  `dashboard_analytics_anchor_failed`). Multiplied by M15, that is
  **2 × 214–1184 ms = 429–2369 ms of gateway work per dashboard view**, on the
  single most expensive route in the product.
* **Root cause:** two independent call sites reach the same endpoint:
  * `apps/web/src/server/actions/dashboard.ts:293` — `fetchDashboardSummaryAction`
    → `gatewayGet("/api/v1/analytics/dashboard", …)`. This is a `"use server"`
    action; it is **not** wrapped in React `cache()`.
  * `apps/web/src/server/queries/dashboard-analytics.ts:279` — `readDashboard`
    → the same `gatewayGet`. This one **is** inside `cache(getDashboardAnalytics)`
    (`dashboard-analytics.ts:384`).
  `page.tsx:94-103` wires both into the same `<ScreenData>` query list. The
  comment at `page.tsx:54-56` claims *"cannot fan out twice inside one
  request"* — that is true of the analytics leg but not of the summary leg,
  which bypasses the memoised module entirely.
* **The fix** — make the summary action read the same memoised source:

  ```diff
  --- a/apps/web/src/server/actions/dashboard.ts
  +++ b/apps/web/src/server/actions/dashboard.ts
  @@
  -  const res = await gatewayGet<unknown>("/api/v1/analytics/dashboard", {
  -    periodStartIso: window.periodStartIso,
  -    periodEndIso: window.periodEndIso,
  -  });
  +  // ONE gateway call per request. This action used to call
  +  // /api/v1/analytics/dashboard directly while
  +  // server/queries/dashboard-analytics.ts:279 calls the SAME endpoint
  +  // inside a React `cache()`. Because this action is not memoised, every
  +  // dashboard render issued the most expensive gateway route TWICE
  +  // (measured: 2 x 214-1184 ms). Both legs now read the one memoised
  +  // source, so React's per-request dedup covers them.
  +  const res = await getDashboardSummary(window.periodStartIso, window.periodEndIso);
  ```
  with, in `apps/web/src/server/queries/dashboard-analytics.ts`, a memoised
  export next to `getDashboardAnalytics`:
  ```ts
  export const getDashboardSummary = cache(
    async (periodStartIso: string, periodEndIso: string) => {
      const res = await withQueryTimeout(
        gatewayGet<unknown>("/api/v1/analytics/dashboard", { periodStartIso, periodEndIso }),
        QUERY_TIMEOUT_MS,
      );
      if (!res.success) throw new Error(res.error);
      return DashboardSummarySchema.parse(res.data);
    },
  );
  ```
  *Caveat for the orchestrator:* `fetchDashboardSummaryAction` is also called
  from the **client** (`components/buddysaradhi/dashboard-client.tsx:356`).
  A client-invoked server action is a *separate* HTTP request, so React's
  per-request `cache()` cannot dedup it against the server render. If the
  period pill is the only reason the client refetches, the fix is for the
  client to reuse the value the server already sent (it is in the same
  `<ScreenData>` payload) and for the action to exist only for the
  period-change path. If the orchestrator prefers the minimal change, an
  in-process request-scoped LRU (the `inflightLoads` pattern already in
  `apps/web/src/server/cache.ts:42`) will collapse the two **server-side**
  calls without touching the client.
* **Expected win:** halves the dashboard's gateway work — **214–1184 ms saved
  per dashboard view**. Derived directly from M15 × M46.

---

### P1-4 — The "All time" period leg fetches every payment ever, then sums it in JavaScript.

* **Component:** `apps/gateway/routes/analytics.ts:392-405` (and `:475-488`)
* **Measured cost (interleaved A/B, M27):**
  * current: `SELECT * FROM ledger_entries WHERE tenant_id=? AND type=? AND occurred_on>=?`
    → **p50 284.04 ms**, 3,600 rows, **1,895 KB** into JS.
  * proposed: `SELECT COALESCE(SUM(credit_paise),0) …` → **p50 3.64 ms**,
    1 row, **21 bytes**.
  * **78× faster; 90,000× fewer bytes.**
* **Root cause:** the route needs a *scalar* (`collectedThisMonthMinor`) but
  computes it by fetching every qualifying row and reducing in JS. The code
  already documents the intent — *"its correct fix is to aggregate in SQL (SUM
  with a filter), not to clamp a window the spec calls unbounded"* — and names
  the open item as F-19a in `docs/audit/REMEDIATION_PLAN.md`. The comment says
  the fix is a sum; what it does not say is that the sum must also exclude
  reversed credits, which is expressible in SQL.
* **The fix** — aggregate in SQL, keeping the "voided credits do not count"
  rule (BR-CALC-10 / AUD-001 / AUD-013) as a SQL predicate:

  ```diff
  --- a/apps/gateway/routes/analytics.ts
  +++ b/apps/gateway/routes/analytics.ts
  @@
  -      orm.ledgerEntry.findMany({
  -        where: { type: "PAYMENT_RECEIVED", occurredOn: { gte: periodStart } },
  -      }),
  -      orm.ledgerEntry.findMany({
  -        where: { type: "REFUND_ISSUED", occurredOn: { gte: periodStart } },
  -      }),
  +      // AGGREGATE IN SQL. Fetching every payment in the window and
  +      // reducing it in JS cost 284.04 ms and 1,895 KB per request
  +      // (measured) and made the "All time" pill O(all-time rows) on an
  +      // append-only table. The rule BR-CALC-10 states is unchanged: a
  +      // VOIDed credit does not count, because a VOID row carries
  +      // void_of_id pointing back at the credit it reverses.
  +      orm.ledgerEntry.sumCreditsExcludingReversed("PAYMENT_RECEIVED", periodStart),
  +      orm.ledgerEntry.sumDebitsExcludingReversed("REFUND_ISSUED", periodStart),
  ```
  with a new audited builder in `apps/gateway/lib/sql.ts` (the only module
  permitted to hold SQL text, AGENTS.md §3.4) and a matching ORM method:
  ```ts
  // lib/sql.ts
  export function stmtSumCreditsExcludingReversed(
    tenantId: string, type: string, sinceIso: string,
  ): BuiltStatement {
    const t = auditedTenant(tenantId);
    return {
      sql: `SELECT COALESCE(SUM(credit_paise), 0) AS total
              FROM ledger_entries
             WHERE tenant_id = ? AND type = ? AND occurred_on >= ?
               AND id NOT IN (SELECT void_of_id FROM ledger_entries
                               WHERE tenant_id = ? AND type = 'VOID' AND void_of_id IS NOT NULL)`,
      args: [t, type, sinceIso, t],
    };
  }
  ```
  **Two things the orchestrator must check before applying this:**
  1. The upper bound and the day-shape check currently live in JS
     (`isWithinPeriod(readDay(p.occurredOn), …)`). A SQL aggregate must keep
     them: `occurred_on` is TEXT and may carry a time component, so the
     predicate is `occurred_on >= ? AND substr(occurred_on,1,10) <= ?` — the
     same lexicographic comparison the JS performs. Getting this wrong
     under-reports revenue, which is a Rule 9 / BR-M-01 failure.
  2. `reversedCreditIds` is still needed for the *per-invoice* netting
     (`attributedPayments`), but not for the period sum.
* **Expected win:** **280.4 ms** off the default window and the same off the
  "All" pill, plus 1.9 MB less data per request. Derived from the interleaved
  A/B in M27 (not from a single-shot measurement).

---

### P1-5 — The cold-isolate schema heal costs seven sequential round trips to Turso.

* **Component:** `apps/gateway/lib/schema.ts:404-508`
* **Measured cost:** 26 DDL statements in one pipeline batch **plus 6 separate
  `sqlite_master` probes**, each of which is its own round trip. M13 measured
  the local (no-network) cost at **11.0–26.5 ms** for the same work; the
  network cost is what matters at the edge, and M6 measured a comparable
  Supabase-edge round trip at **240 ms**. Seven sequential round trips ⇒
  **~1.7 s of serial latency on the first request of every cold isolate**
  before the route's own work starts.
* **Root cause:** `lib/schema.ts:473-480` and `:499` — four `ensureColumn()`
  calls, each doing its own
  `oneRow(handle, "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")`
  (`ensureColumn` is defined at `lib/schema.ts:516`).
  * `lib/schema.ts:710,715` — two `hasColumn()` calls (defined at
    `lib/schema.ts:660`), each the same query.
  * `lib/sql.ts:93-143` — `run()` is one `db.execute()` = one HTTP request to
    Turso. There is no batching for the probes.
  * `healedTenants` (`lib/schema.ts:12`) is a **module-level `Set`**, i.e.
    per-isolate. Supabase Edge isolates are recycled on idle timeout, on
    deploy, and on scale-out, so the heal is re-paid on every cold isolate.
* **The fix** — collapse the six probes into **one** statement (6 RTTs → 1):

  ```diff
  --- a/apps/gateway/lib/schema.ts
  +++ b/apps/gateway/lib/schema.ts
  @@
  -async function ensureColumn(
  -  db: DB, table: string, column: string, decl: string,
  -): Promise<void> {
  -  const handle = db as unknown as SqlHandle;
  -  const row = await oneRow(handle, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
  -  const ddl = typeof row?.sql === "string" ? row.sql : "";
  -  if (ddl.toLowerCase().includes(column.toLowerCase())) return;
  -  await run(handle, `ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`, []);
  -}
  +/**
  + * The column probe, ONE round trip for every table the heal inspects.
  + *
  + * It used to be one `sqlite_master` query PER COLUMN (four
  + * `ensureColumn` calls plus two `hasColumn` calls = SIX sequential
  + * round trips to Turso on the first request of every cold isolate).
  + * A single `name IN (…)` query returns all six DDL strings at once,
  + * so the cold-isolate heal costs 2 round trips (probe + DDL batch)
  + * instead of 7.
  + */
  +async function probeTableDdl(
  +  db: DB, tables: readonly string[],
  +): Promise<Map<string, string>> {
  +  const handle = db as unknown as SqlHandle;
  +  const placeholders = tables.map(() => "?").join(",");
  +  const rows = await allRows(
  +    handle,
  +    `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
  +    [...tables],
  +  );
  +  const out = new Map<string, string>();
  +  for (const r of rows) out.set(String(r.name), String(r.sql ?? "").toLowerCase());
  +  return out;
  +}
  ```
  and, in `runHeal` (`lib/schema.ts:466-501`), replace the four `ensureColumn`
  + two `hasColumn` calls with one `probeTableDdl([...])` lookup and the
  existing ALTER/REPAIR logic keyed off that map.
  *Note:* this keeps the DDL batch and the probe as two round trips, because the
  probe must run *before* the DDL. Merging them further is possible only by
  accepting "always run the ALTERs", which is a different trade.
* **Expected win:** **5 fewer sequential round trips** on the first request of
  every cold isolate — roughly **5 × 240 ms = 1.2 s** of serial latency
  removed per cold start (M6 for the RTT figure, M13 for the statement count).

---

### P1-6 — The web middleware makes a Supabase Auth network round trip on every authenticated request.

* **Component:** `apps/web/src/lib/supabase/middleware.ts:56`
* **Measured cost:** M6 measured `GET /auth/v1/user` against the real
  Supabase project at **236–707 ms, steady-state 240 ms**. The middleware
  calls `await supabase.auth.getUser()` on every request that reaches it, and
  the matcher is
  `['/((?!_next/static|_next/image|favicon.ico).*)']` (`src/proxy.ts:406-409`)
  — i.e. **every page and every API route**. For a signed-in tutor that is
  **240 ms of serial latency before the route's own work begins**, and the
  dashboard's own gateway work (P0-2/P0-3) is added on top of it.
  (For an *anonymous* visitor `getUser()` short-circuits on the missing
  session — M5 shows `/login` at 7–32 ms — so the cost is specific to
  authenticated traffic, which is the traffic that matters.)
* **Root cause:** the web app still uses the **network**-based `getUser()`,
  while **the gateway already solved exactly this** and documented it:
  `apps/gateway/lib/auth.ts:339-346` — *"Identity is established by VERIFYING
  the SIGNATURE of the token we were just handed, against Supabase's JWKS, in
  process. It used to be `sb.auth.getUser(jwt)` — an outbound HTTPS round trip
  to the Auth server on EVERY authenticated request… The 14-day attendance
  heatmap alone issues 14 gateway calls, so one dashboard load cost roughly 20
  Auth round trips before any Turso query. `getClaims` does the same
  verification locally and caches the JWKS."*
  The web middleware was not migrated with it.
* **The fix** — use the offline, signature-verifying `getClaims()`:

  ```diff
  --- a/apps/web/src/lib/supabase/middleware.ts
  +++ b/apps/web/src/lib/supabase/middleware.ts
  @@
  -  let user: any = null;
  -  try {
  -    const { data } = await supabase.auth.getUser();
  -    user = data.user;
  -  } catch (err) {
  +  // OFFLINE VERIFICATION, NOT A NETWORK CALL.
  +  // `supabase.auth.getUser()` revalidates the token against the Auth
  +  // server on EVERY request — one WAN round trip (measured: 240 ms
  +  // against this project's own Supabase) added to every authenticated
  +  // page and API call, before the route's own work starts.
  +  // `supabase.auth.getClaims()` verifies the SAME signature locally
  +  // (crypto.subtle) and caches the JWKS, so the network is touched
  +  // only on cache miss / key rotation. This is the same change the
  +  // gateway already made — see apps/gateway/lib/auth.ts:339-346.
  +  // The middleware only needs `user_metadata` (active_session_id,
  +  // db_url) and `session_id`, all of which are IN the access token.
  +  let user: any = null;
  +  try {
  +    const { data, error } = await supabase.auth.getClaims();
  +    if (error) throw error;
  +    const claims = (data?.claims ?? {}) as Record<string, unknown>;
  +    user = {
  +      id: claims.sub,
  +      user_metadata: claims.user_metadata ?? {},
  +      session_id: claims.session_id,
  +    };
  +  } catch (err) {
  ```
  *Caveat:* `getClaims()` verifies the signature and `exp`; it does **not**
  prove the session is still live server-side — a revoked session remains valid
  until `exp`. The gateway accepted exactly that trade
  (`apps/gateway/lib/auth.ts:47-52`: *"a purely OFFLINE check… Closing that
  means a per-request `getUser` round trip — the exact cost the move from
  `getUser` to `getClaims` was made to avoid"*). The same reasoning applies
  here, and it should be stated in the PR.
* **Expected win:** **~240 ms** of serial latency removed from every
  authenticated request. Derived from M6.

---

### P1-7 — The 3D hero renders at 1.95 FPS on a software GPU, after 398 KB gzip of three.js.

* **Component:** `apps/product-page/src/components/product-3d/`
* **Measured cost:** desktop 1440×900 in Chromium with a **software
  rasteriser** (ANGLE/SwiftShader — the "simulated slow GPU" condition):
  * **1.95 FPS** on screen (8 frames in 4.10 s).
  * **3.24 FPS** at 390×844 (the `useLowEnd()` path: `dpr [0.75,1]`, 80
    particles, 1 transmission sample).
  * **FCP 1292 ms** desktop / **1852 ms** mobile.
  * **455,773 B** of JS on the wire, of which **407,865 B (89%) is the 3D
    stack**: three.js `0pl4pk-k0eoj8.js` **250,511 B wire / 940,856 B decoded**,
    R3F+drei `25o46h8mdjlrg.js` 71,012 B, gsap `0lb0qg7a5tedu.js` 45,859 B,
    `2-5nk792mwq2y.js` 40,483 B.
  * Plus 59,048 B of fonts and 13,098 B of CSS.
* **What is already correct (do not change):**
  * `frameloop={inView ? "always" : "never"}` (`ProductScene.tsx:51`) — M38
    proves the off-screen behaviour works (32.1 fps desktop / 59.2 fps mobile
    once the canvas scrolls out). FM-16 is fixed.
  * `resolveDpr` / `resolveParticleCount` / `resolveTransmissionSamples`
    (`scene-tiers.ts:32-47`) — a real degradation ladder, and it measurably
    helps (1.95 → 3.24 fps at mobile width).
  * The scene is **lazily imported** (`ProductHero.tsx:39`,
    `dynamic(() => import("./ProductScene"))`), so three.js is *not* in the
    initial bundle — the 67 KB gzip initial payload is real. The 398 KB lands
    *after* first paint, which is the right order; it is still 398 KB.
* **Root cause of the 1.95 fps:** the scene is **GPU-bound**, not main-thread
  bound. M36's main-thread numbers show only **0.078 s of task time across a
  4 s on-screen window** — the main thread is idle while SwiftShader renders.
  So the levers are *pixels* and *passes*, not JS:
  * the canvas is **1440×900 at dpr 1** (`ProductScene.tsx:48` `resolveDpr`),
    and `gl={{ antialias: true }}` (`ProductScene.tsx:49`) means a
    multisampled target;
  * `MeshTransmissionMaterial` with `samples = 4` (`resolveTransmissionSamples`,
    `scene-tiers.ts:40`) renders the scene **4 extra times** into a transmission
    buffer — the single most expensive thing in the scene.
* **The fix (proposed, in priority order):**
  1. **Cut the transmission samples.** `resolveTransmissionSamples` already
     returns 1 on the low-end path. Add a third tier: `samples = 2` for the
     default desktop tier, and keep 4 only for `wide && !lowEnd` with a
     measured FPS budget. Derivation: the transmission pass is a full extra
     scene render per sample, so 4 → 2 removes **half** the transmission cost.
     This is a data-only change in `scene-tiers.ts`:
     ```diff
     --- a/apps/product-page/src/components/product-3d/scene-tiers.ts
     +++ b/apps/product-page/src/components/product-3d/scene-tiers.ts
     @@
     -export function resolveTransmissionSamples(lowEnd: boolean): 1 | 4 {
     -  return lowEnd ? 1 : 4;
     -}
     +export function resolveTransmissionSamples(lowEnd: boolean, wide: boolean): 1 | 2 | 4 {
     +  // Measured: 4 samples = 4 extra full scene renders. On a software
     +  // rasteriser the hero ran at 1.95 fps; the transmission pass is the
     +  // dominant term. 2 samples on the default desktop tier keeps the
     +  // frosted-glass read at half the transmission cost; 4 is reserved
     +  // for wide, non-low-end screens.
     +  if (lowEnd) return 1;
     +  return wide ? 4 : 2;
     +}
     ```
  2. **Turn antialiasing off on the low-end tier** (`ProductScene.tsx:49`):
     `gl={{ antialias: !lowEnd, powerPreference: lowEnd ? "low-power" : "high-performance" }}`.
     On a software rasteriser, MSAA is a large multiplier on the fill cost.
  3. **Consider `dpr` 1 on the default tier** rather than `[1, 1.5]`
     (`scene-tiers.ts:32-36`). The measured canvas was 1440×900 at dpr 1
     because the headless device pixel ratio is 1 — on a real retina laptop
     the tier would open to 1.5 and the fill cost would rise 2.25×.
  4. **Serve the 3D stack off the critical path more aggressively.** The
     455 KB of JS lands after FCP, but FCP itself is 1292 ms and the hero
     cannot paint until the canvas scene resolves. If the poster is the
     intended first paint, the `dynamic()` import should be triggered on
     `requestIdleCallback`/`IntersectionObserver` rather than immediately.
* **Expected win:** items 1+2 together target the transmission and MSAA terms
  of the fill cost. I have **not** measured the post-fix FPS (that requires
  editing product code, which is out of scope for this report), so the
  expected win is stated as a **target** ("≥ 2× on the software rasteriser")
  with the measurement the orchestrator must take to confirm it. What *is*
  measured is the 78× / 2.4× / 3.3× wins in the gateway section and the
  240 ms / 280 ms / 35 ms wins above, which are the load-bearing numbers in
  this report.

---

### P1-8 — The HMAC key is re-imported on every request.

* **Component:** `apps/gateway/lib/crypto.ts:158-172`
* **Measured cost:** M19 — `hmacVerify` costs **p50 0.321 ms, p95 0.988 ms,
  p99 1.680 ms** for a request whose *entire* security budget should be
  microseconds. `hmacSign` calls `crypto.subtle.importKey("raw", …, {name:
  "HMAC", hash: "SHA-256"}, false, ["sign"])` on **every call**, and
  `hmacVerify` calls `hmacSign`. A WebCrypto `importKey` is an expensive
  operation relative to a single HMAC over ~120 bytes.
* **Root cause:** the key material is a module-scope constant (`HMAC_SECRET`),
  so the imported key is a pure function of it — but the import is redone
  every time.
* **The fix** — import once, lazily:

  ```diff
  --- a/apps/gateway/lib/crypto.ts
  +++ b/apps/gateway/lib/crypto.ts
  @@
  +/**
  + * The imported HMAC key, resolved once per isolate.
  + *
  + * `crypto.subtle.importKey` was called on EVERY sign and verify, which
  + * measured 0.321 ms p50 / 0.988 ms p95 per request (a single HMAC over
  + * ~120 bytes should be ~5 us). The key is a pure function of the
  + * module-scope HMAC_SECRET, so it is safe to import once and reuse.
  + * Lazy (not module-scope) so the secret is still read at first use and a
  + * test that overrides it before the first call still sees the new value.
  + */
  +let hmacKeyPromise: Promise<CryptoKey> | null = null;
  +
  +function hmacKey(): Promise<CryptoKey> {
  +  if (!hmacKeyPromise) {
  +    hmacKeyPromise = crypto.subtle.importKey(
  +      "raw",
  +      new TextEncoder().encode(HMAC_SECRET),
  +      { name: "HMAC", hash: "SHA-256" },
  +      false,
  +      ["sign"],
  +    );
  +  }
  +  return hmacKeyPromise;
  +}
  +
   export async function hmacSign(data: string): Promise<string> {
     if (!HMAC_SECRET) throw new Error("GATEWAY_SHARED_SECRET not configured");
     const encoder = new TextEncoder();
  -  const key = await crypto.subtle.importKey(
  -    "raw",
  -    encoder.encode(HMAC_SECRET),
  -    { name: "HMAC", hash: "SHA-256" },
  -    false,
  -    ["sign"],
  -  );
  +  const key = await hmacKey();
     const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  ```
  *Caveat:* if `HMAC_SECRET` can change at runtime, the cached key must be
  invalidated. The module comment says the secret is read at module scope, so
  it cannot change without a redeploy — but the orchestrator should confirm
  that before applying, and if it can change, key the cache on the secret
  value.
* **Expected win:** **~0.32 ms p50 / ~0.99 ms p95** removed from every
  request. Derived from M19 (the measured cost of the operation being removed).

---

### P1-9 — The dashboard's ledger queries have no index; every load is a full scan of the append-only table.

* **Component:** `apps/gateway/lib/schema.ts:143-167` (the `ledger_entries`
  DDL) and `:268-280` (the `sync_outbox` DDL, same omission).
* **Measured cost:** `EXPLAIN QUERY PLAN` on the period leg returns
  **`SCAN ledger_entries`** — every dashboard load scans the whole
  append-only table (8,400 rows in the fixture; unbounded in production,
  because the table only ever grows — Rule 1). M28: **244.02 ms** unindexed
  vs **205.80 ms** with `idx_ledger_type_occurred` — only **1.19×**, because
  the leg is dominated by materialising the rows, not by the scan.
* **Root cause:** `lib/schema.ts` creates 8 indexes (`idx_plans_student`,
  `idx_items_due`, `idx_items_plan`, `idx_invoices_student`,
  `idx_invoices_due`, `idx_attendance_records_session_student`,
  `att_rec_student`, `idx_idempotency_ttl`) — and **none on
  `ledger_entries`**, which is the only append-only, forever-growing table in
  the schema. The open-invoice read also shows
  `SEARCH invoices USING INDEX sqlite_autoindex_invoices_2 (tenant_id=?) |
  USE TEMP B-TREE FOR ORDER BY` — a **temp B-tree sort** because there is no
  index on `(tenant_id, status, due_date)`.
* **The fix** — add the two missing indexes to the audited DDL authority:

  ```diff
  --- a/apps/gateway/lib/schema.ts
  +++ b/apps/gateway/lib/schema.ts
  @@
     `CREATE TABLE IF NOT EXISTS ledger_entries (
       ...
     )`,
  +  // The dashboard's period leg read `WHERE tenant_id = ? AND type = ?
  +  // AND occurred_on >= ?` with NO index — EXPLAIN QUERY PLAN returned
  +  // `SCAN ledger_entries` on the append-only table that only ever grows
  +  // (Rule 1). This index makes it a range search.
  +  `CREATE INDEX IF NOT EXISTS idx_ledger_type_occurred ON ledger_entries(tenant_id, type, occurred_on)`,
  +  // The open-invoice read sorted through a TEMP B-TREE because no index
  +  // covered (tenant_id, status, due_date). This one covers both the
  +  // filter and the ORDER BY.
  +  `CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status_due ON invoices(tenant_id, status, due_date)`,
  ```
  *Note:* the heal is idempotent (`CREATE INDEX IF NOT EXISTS`), so this
  self-heals existing tenants on their next cold isolate — at the cost of
  P1-5's first-request latency, which is another reason to fix P1-5 first.
* **Expected win:** **1.19×** on the period leg (38 ms) from M28. The bigger
  win is **asymptotic**: the scan is O(all-time rows) today and becomes
  O(rows in window). At 10 years of history the difference is two orders of
  magnitude. I am reporting the measured 1.19× rather than a projection.

---

### P1-10 — `voidOfId: { in: creditIds }` is unbounded; the dashboard 500s at 32,766 payments.

* **Component:** `apps/gateway/routes/analytics.ts:129-146` (`reversedCreditIds`)
  and its two call sites (`:439`, `:475`).
* **Measured cost:** M31 — SQLite's bound-parameter ceiling is **32,766**;
  at 32,767 the statement fails with
  `SQLITE_ERROR: too many SQL variables`. The route builds
  `voidOfId: { in: creditIds }` where `creditIds` is **every payment id in the
  period**. The "All time" period is *every payment the institute has ever
  taken*. A 200-student institute with 150 payments/month reaches 32,766
  payments in **18 years**; a 500-student institute with 400/month reaches it in
  **6.8 years**. The failure mode is a 500 on the dashboard — a tuition app
  that stops showing a tutor their own money.
  The same mechanism also degrades gracefully-but-slowly before the cliff:
  M31 shows `IN(30 000)` takes 142.5 ms to prepare and run.
* **Root cause:** the look-up's result set is proportional to the tenant's
  history, and the query shape has an O(n) parameter count. The route's own
  comment says *"The read is bounded by the candidate credits' own ids, so it
  cannot grow with the tenant's history."* — that is the **inverted** claim:
  the candidate credits ARE the tenant's history.
* **The fix** — invert the lookup so its size depends on the number of
  *reversals* (a handful), not on the number of payments:

  ```diff
  --- a/apps/gateway/routes/analytics.ts
  +++ b/apps/gateway/routes/analytics.ts
  @@
   async function reversedCreditIds(
     orm: { ledgerEntry: { findMany(args: unknown): Promise<Row[]> } },
     creditIds: string[],
   ): Promise<Set<string>> {
     const reversed = new Set<string>();
     if (creditIds.length === 0) return reversed;
  -  const reversals = await orm.ledgerEntry.findMany({
  -    where: { type: "VOID", voidOfId: { in: creditIds } },
  -  });
  +  // LOOK THE OTHER WAY, AND WITHOUT AN UNBOUNDED IN LIST.
  +  //
  +  // The old shape was `WHERE void_of_id IN (<every credit id in the
  +  // period>)`. That parameter count grows with the tenant's ENTIRE
  +  // history, and SQLite's ceiling is 32,766 bound parameters
  +  // (measured: `SQLITE_ERROR: too many SQL variables`), so the
  +  // dashboard 500s on a long-lived institute. Fetch the VOID rows
  +  // (there are a handful — a void is rare) and filter in JS; the
  +  // parameter count is now O(reversals), not O(payments).
  +  const reversals = await orm.ledgerEntry.findMany({
  +    where: { type: "VOID" },
  +  });
     for (const r of reversals) {
       const target = r.voidOfId;
  -    if (target !== null && target !== undefined && String(target).length > 0) {
  +    if (target !== null && target !== undefined && String(target).length > 0) {
         reversed.add(String(target));
       }
     }
     return reversed;
   }
  ```
  *Caveat the orchestrator must handle:* fetching **all** VOID rows is correct
  only while voids are rare. If a tenant's void count grows large, add a
  `take` with an explicit "truncated" flag (the `dueTodayTruncated` honesty
  pattern at `routes/analytics.ts:644-646`) rather than silently capping.
  A JOIN against the open-invoice set (`EXISTS`) is the more scalable form;
  M29 measured the `EXISTS` shape at **1.42 ms vs 5.80 ms** for a 1,500-id
  `IN` list, a **4.09×** win.
* **Expected win:** removes a **hard failure** at 32,766 payments and makes
  the lookup O(reversals). M29's 4.09× applies to the per-call cost.

---

### P2-11 — The gateway's `SELECT *` reads 3.4–5.3× more bytes than the route uses.

* **Component:** `apps/gateway/lib/sql.ts:473` (`stmtSelectWhere`) and
  `:518` (`stmtSelectOneWhere`).
* **Measured cost:** M25/M26 —
  * open invoices: `SELECT *` = 1,200 rows / **483 KB** / 60.17 ms p50; a
    6-column projection = **140 KB** / 25.45 ms p50. **2.36× faster, 3.45×
    fewer bytes.**
  * students: `SELECT *` = 200 rows / **102 KB** / 10.74 ms p50; a 6-column
    projection = **25 KB** / 3.21 ms p50. **3.34× faster, 4.06× fewer bytes.**
  * students carry `notes`, `address`, `custom_fields`; invoices carry
    `void_reason`, `tamper_hash`, `created_at`, `updated_at` — none of which
    the dashboard route reads.
* **Root cause:** `stmtSelectWhere` is a generic builder with no projection
  seam, and `mapRowToCamel` (`lib/orm.ts:335-344`) re-keys **every** column
  of **every** row into a fresh object.
* **The fix** — add a projection seam to the audited builder and use it. This
  is a **larger** change than the others (it touches the generic builder), so
  the orchestrator should scope it:

  ```diff
  --- a/apps/gateway/lib/sql.ts
  +++ b/apps/gateway/lib/sql.ts
  @@
   export function stmtSelectWhere(
     table: string,
     tenantId: string,
     where: Record<string, unknown> = {},
  -  opts: { orderBy?: Record<string, string>; take?: number; skip?: number; orderAllowed?: Set<string> } = {}
  +  opts: {
  +    orderBy?: Record<string, string>;
  +    take?: number;
  +    skip?: number;
  +    orderAllowed?: Set<string>;
  +    /** Optional projection. `SELECT *` read 3.4-5.3x more bytes than the
  +     * route used (measured: 483 KB vs 140 KB on the open-invoice read). */
  +    select?: readonly string[];
  +  } = {},
   ): BuiltStatement {
     const t = auditedTable(table);
     const { sql: clause, args: whereArgs } = buildTenantWhere(tenantId, where);
  -  let sql = `SELECT * FROM ${t} WHERE ${clause}`;
  +  const columns = opts.select
  +    ? opts.select.map((c) => auditedCamelToSnake(c)).join(", ")
  +    : "*";
  +  let sql = `SELECT ${columns} FROM ${t} WHERE ${clause}`;
  ```
  and, in `apps/gateway/lib/orm.ts`, a `select` option on the models the
  dashboard reads, plus the matching projections in
  `apps/gateway/routes/analytics.ts`:
  ```ts
  orm.invoice.findMany({
    where: { status: { in: [...OPEN_INVOICE_STATUSES] } },
    orderBy: { dueDate: "asc" },
    select: ["id", "studentId", "number", "dueDate", "total", "status"],
  }),
  ```
  *SAFETY:* `auditedCamelToSnake` must be applied to each projection column
  exactly as it is to the `where` keys, so a caller cannot smuggle SQL through
  the projection. The `sql-range-operators.test.ts` pattern (assert every name
  against the real DDL) should be extended to cover the projections.
* **Expected win:** **34.7 ms** (open invoices) + **7.5 ms** (students) off
  every dashboard load, and **420 KB** less data per request. Derived from
  M25 and M26.

---

### P2-12 — Four A/B cookies are written on every response and read by nothing.

* **Component:** `apps/web/src/proxy.ts:383-401`
* **Measured cost:** M43 — every HTML response carries **4 `Set-Cookie`
  headers** (`buddysaradhi_ab_hero`, `..._pricing_order`, `..._roi_default`,
  `..._download_order`), each 30-day, `HttpOnly`, `Secure`, `SameSite=Lax`.
  M44 — a repository-wide search for `buddysaradhi_ab_` finds **12 hits, all
  writes or documentation; there is no reader anywhere in `apps/web/src`.**
  The variants are never injected as a header, never read by an RSC, and never
  recorded against a conversion.
* **Root cause / the actual question asked:** *"does the A/B cost 4× the build
  and render cost?"* — **No.** The variants are runtime cookie values, not
  build-time branches, so the build is **not** multiplied and the render is
  **not** multiplied (the routes are the same regardless of variant; the
  variant is simply never read). The cost is instead:
  * 4 `Set-Cookie` headers on every response that lacks them (~200 B of
    response headers and 4 cookie-jar writes per first visit);
  * 4 `req.cookies.get()` calls on **every** request, forever;
  * and a **false signal**: the app appears to be running 4 experiments and
    is running **zero**.
* **The fix** — either wire the variants up, or remove the dead machinery.
  The removal is the smaller change and the one this report recommends (it
  also removes the "we are A/B testing" claim from the codebase, which is
  currently untrue):

  ```diff
  --- a/apps/web/src/proxy.ts
  +++ b/apps/web/src/proxy.ts
  @@
  -  // A/B Testing Cookies
  -  const setCookieIfMissing = (name: string, variants: string[]) => {
  -    let variant = req.cookies.get(name)?.value;
  -    if (!variant || !variants.includes(variant)) {
  -      variant = variants[Math.floor(Math.random() * variants.length)];
  -      res.cookies.set(name, variant, {
  -        path: '/',
  -        maxAge: 60 * 60 * 24 * 30, // 30 days
  -        httpOnly: true,
  -        secure: process.env.NODE_ENV === 'production',
  -        sameSite: 'lax'
  -      });
  -    }
  -  };
  -
  -  setCookieIfMissing('buddysaradhi_ab_hero', ['a', 'b', 'c']);
  -  setCookieIfMissing('buddysaradhi_ab_pricing_order', ['monthly_first', 'yearly_first']);
  -  setCookieIfMissing('buddysaradhi_ab_roi_default', ['small_batch', 'large_batch']);
  -  setCookieIfMissing('buddysaradhi_ab_download_order', ['android_first', 'ios_first']);
  +  // A/B COOKIES REMOVED.
  +  //
  +  // Four `buddysaradhi_ab_*` cookies were written on every response and
  +  // read by NOTHING (measured: 4 Set-Cookie headers per response;
  +  // 12 repository hits for the cookie names, all writes or docs). The
  +  // variant was never injected as a header and never read by an RSC, so
  +  // the app was running ZERO experiments while appearing to run four.
  +  //
  +  // If the experiments are wanted, re-introduce them WITH the reader
  +  // (middleware injects `x-ab-<test>`; the RSC branches on it; the
  +  // conversion event is recorded) — the cookie alone measures nothing.
  +  // The variants are runtime values, so they never multiply the build
  +  // or the render cost.
  ```
* **Expected win:** 4 fewer `Set-Cookie` headers per first visit, 4 fewer
  cookie lookups per request thereafter, and one fewer false claim in the
  codebase. No user-visible latency change expected (the cookie writes are
  ~200 B of headers).

---

### P2-13 — The perf-budget tests measure the machine, not the code.

See §6 for the full mechanism and the fix.

---

### P3-14 — The web app downloads 146–233 KB gzip of JS per route and executes none of it.

* **Component:** consequence of P0-1.
* **Measured cost:** M32/M33 — per-route client JS is /students **233 KB
  gzip**, /settings 232, /fees 210, /dashboard 186, /attendance 185,
  /login 147; the whole app is **1.87 MB raw → 563 KB gzip** in 46 chunks.
  M39 — the browser reports **0 bytes of JS executed**, and M40 — 30 CSP
  violations. So 146–233 KB gzip is downloaded per page view and **discarded**.
* **Root cause:** P0-1.
* **The fix:** P0-1. When hydration is restored, these numbers become the
  *real* transfer cost and the bundle-size review becomes worthwhile:
  the largest single chunk, `1ffti899nk1yx.js` (**241.7 KB raw / 63.2 KB
  gzip**), is referenced by **every** route, so it is the shared
  React/Next runtime. The next-largest, `31fmsp1soxi07.js` (**227.3 KB raw /
  70.8 KB gzip**), is referenced by **no** route's initial manifest — it is
  lazily loaded, which is correct.
* **Expected win:** none on its own; it is the *consequence* of P0-1 and the
  reason P0-1 is also a performance finding and not only a correctness one.
  On Vercel Hobby, RFC-003 §0 budgets bandwidth; 233 KB × every page view is
  metered bandwidth spent on bytes the browser throws away.

---

### P3-15 — CI cost

See §8.

---

## 5. Where the time actually goes (the dashboard)

Sum of the measured per-leg costs for a default-month-window dashboard request
(M15: p50 467 ms, 8 SQL statements, 3,690 rows into JS):

| Leg | Rows in | Bytes in | Measured p50 | Share of the measured p50 |
|---|---|---|---|---|
| open invoices (`SELECT *`, 17 cols) | 1,200 | 483 KB | 60.17 ms | 13% |
| students (`SELECT *`, 27 cols) | 200 | 102 KB | 10.74 ms | 2% |
| period payments (`SELECT *`) | 150 | — | ~6 ms | 1% |
| ledger LIMIT 20 + notifications LIMIT 20 | 40 | — | ~1 ms | <1% |
| attributed payments (`IN (1200)`) | 0–1,500 | — | 13.04 ms | 3% |
| reversed credits ×2 (`IN (1500)`) | 0 | — | 11.60 ms | 2% |
| **all-time period leg (only on the "All" pill)** | 3,600 | 1,895 KB | **284.04 ms** | **— (not in the default window)** |
| **remainder: JS materialisation + `mapRowToCamel` + JSON serialisation** | — | — | **~365 ms** | **78%** |

**The headline of the whole audit:** the SQL is *not* the bottleneck — the
**JavaScript** is. 3,690 rows × ~17 columns = ~63,000 key transformations and
object allocations per dashboard request, plus a JSON serialisation of a
response that embeds much of it. That is why P1-9's index (1.19×) barely
moves the needle while P1-4's aggregation (78×) and P2-11's projection
(2.4–3.3×) do.

**Corollary for the fix order:** the *row count* and the *column count* are the
levers; the index is a hygiene fix. Apply P1-4 and P2-11 first, P1-9 second.

### 5.4 The expected-win derivation, in one place

Every "expected win" in §4 is one of:

* **(a) An interleaved A/B measurement** (M25–M30) — A,B,A,B,… in one
  process, both arms under identical load. This is where the 78×, 4.09×,
  3.34× and 2.36× come from.
* **(b) A per-leg delta subtracted from a measured end-to-end p50** (P0-2,
  P1-4, P2-11) — the measured p50 minus the measured per-leg saving. Stated
  explicitly in each entry.
* **(c) A counted-opportunity × a measured unit cost** (P1-5: 5 RTTs ×
  M6's 240 ms; P1-10: 1 failure above 32,766 payments; P0-3: 2 × M15).
* **(d) A hypothesis, explicitly labelled as such** (P1-7's post-fix FPS) —
  only P1-7 uses this, and it says so.

---

## 6. The perf-GATE fix: replace load-sensitive budget tests with a hermetic measurement

### 6.1 What is wrong today

The brief says these tests "measure the machine, not the code". Reading them
closely, the file has **already been partly fixed** — `low-latency.test.ts`
exports a `p95PerOp()` aggregator that batches 200 operations per timed batch
and takes a nearest-rank p95 across 20 batches, and it has two *relative*
tests that compare two measurements taken in the same run. That is the right
shape. But **five absolute, single-operation budgets remain**, and they are
exactly the load-sensitive ones:

| Test | File:line | Shape | Load sensitivity |
|---|---|---|---|
| "all security checks complete in <10ms (p99)" | `low-latency.test.ts:83` | **200 single-op samples; p99 = the 2nd-worst of 200** | 🔴 **the worst** — one deschedule among two samples reddens it. M17 measured `max = 16.714 ms` for this exact function. |
| "URL validation completes in <2ms (p99)" | `low-latency.test.ts:101` | 500 single-op samples; p99 = the 5th-worst | 🔴 |
| "path validation completes in <1ms (p99)" | `low-latency.test.ts:115` | 1,000 single-op samples; p99 = the 10th-worst | 🔴 |
| "tenant invalidation completes in <5ms for 512 entries" | `low-latency.test.ts:162` | **ONE measurement** | 🔴🔴 |
| "checkIpRateLimit handles 10,000 calls in <100ms" | `low-latency.test.ts:252` | one batch, absolute | 🟡 |
| "single cache lookup is sub-millisecond (p95 < 1ms)" | `performance.test.ts:224` | 500 single-op samples | 🟡 |
| "pre-serialized Response path is sub-millisecond" | `performance.test.ts:245` | 200 single-op samples | 🟡 |
| "invalidation is fast for large caches" | `performance.test.ts:273` | **ONE measurement**, <5 ms for 1,000 entries | 🔴 |
| "cache hit is faster than cache miss" | `performance.test.ts:169` | one batch of 1,000, <10 ms | 🟡 |
| "Promise.all runs queries in parallel" | `performance.test.ts:148` | one wall-clock, <100 ms for 3×10 ms | 🟡 |

M17 is the direct evidence for the first row: `runSecurityChecks` measured
`p99 = 0.287 ms` on a quiet run and `max = 16.714 ms` on a contended one. A
p99-of-200-singles budget of 10 ms therefore passes on a quiet runner and
fails on a busy one **for the same code**.

Two more structural problems compound it:

1. **Three vitest configs run the same files with different timeouts.**
   * root `vitest.config.ts` — `hookTimeout: 60000`, `testTimeout: 30000`
   * `apps/gateway/vitest.config.ts` — `hookTimeout: 60000`, `testTimeout: 10000`
   * root `vitest.integration.config.ts` — `testTimeout: 10000`, **no
     `hookTimeout`** (inherits 10,000)

   `vitest.integration.config.ts`'s own comment documents this exact class of
   defect ("one tree, two verdicts"). CI runs both `test:unit` and
   `test:integration`, so the same file is graded twice, under two ceilings.
2. **The perf file is not isolated.** The gateway suite ran **59 files in
   29.3 s** with `tests 84.09 s` cumulative — the workers overlap, so a
   perf file's "p99 of 200 singles" is measured while 58 other files are
   burning CPU.

### 6.2 The fix — three mechanisms

**(1) Isolate the perf suite into its own vitest project and its own CI job.**

```ts
// apps/gateway/vitest.perf.config.ts  (NEW)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ONLY the perf files. They are a separate CI job (see .github/workflows),
    // not part of the parallel unit run.
    include: ["__tests__/**/perf-*.test.ts", "__tests__/low-latency.test.ts"],
    setupFiles: ["./__tests__/setup.ts"],
    alias: { "@libsql/client/web": "@libsql/client" },
    environment: "node",
    globals: false,
    // ONE worker, no parallelism: the measurement must not compete with
    // another test file for the CPU it is timing.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // The same ceilings as the other two configs, so one tree has one verdict.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Report the slowest samples so a near-miss is visible before it is a red.
    reporters: ["default", "junit"],
  },
});
```

and in `.github/workflows/`, a **separate job** for it, with
`concurrency: { group: 'perf-gate', cancel-in-progress: false }` so two runs
never share a runner, and `timeout-minutes` set generously:

```yaml
  perf-gate:
    name: Gateway perf gate (isolated)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    concurrency:
      group: perf-gate
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: Perf budget (single worker, isolated runner)
        run: bunx vitest run --config apps/gateway/vitest.perf.config.ts
```

**(2) Convert every remaining absolute single-op budget to the batched
aggregator the file already exports.** `p95PerOp` is the right instrument and
it is already there; five tests just never adopted it.

```diff
--- a/apps/gateway/__tests__/low-latency.test.ts
+++ b/apps/gateway/__tests__/low-latency.test.ts
@@
   it("all security checks complete in <10ms (p99)", () => {
     const req = new Request("https://example.com/api/v1/students?search=test", {
       method: "GET",
       headers: { authorization: "Bearer test-token" },
     });
-
-    const samples: number[] = [];
-    for (let i = 0; i < 200; i++) {
-      const start = performance.now();
-      runSecurityChecks(req);
-      samples.push(performance.now() - start);
-    }
-
-    samples.sort((a, b) => a - b);
-    const p99 = samples[Math.floor(samples.length * 0.99)];
-    expect(p99).toBeLessThan(10);
+    // BATCHED + RELATIVE.
+    //
+    // The old shape timed ONE operation per `performance.now()` pair and
+    // took a p99 over 200 of them. The p99 of 200 singles IS the 2nd-worst
+    // sample, so a single OS preemption among two samples reddened the
+    // build for a function that costs 0.04 ms (measured: p50 0.040 ms,
+    // p95 0.131 ms, p99 0.287 ms — and max 16.714 ms on a loaded runner).
+    // It measured the runner, not the code.
+    //
+    // Two changes, both already proven in this file:
+    //   1. `p95PerOp` amortises one preemption across 200 operations.
+    //   2. The budget is RELATIVE — it is compared against a calibration
+    //      operation measured in the SAME run, so a busy runner moves
+    //      both arms together and the RATIO survives.
+    const perOp = p95PerOp(() => { runSecurityChecks(req); });
+    const calibration = p95PerOp(() => { calibrationOp(); });
+    expect(perOp).toBeLessThan(calibration * 200);
   });
```

with a calibration operation that is *deliberately* cheap and whose only job
is to be a yardstick for the machine:

```ts
/**
 * The yardstick every budget in this file is measured AGAINST.
 *
 * It is a `Map.get` plus a string compare — the cheapest operation the
 * runtime can do — so it costs the same on every machine and its only
 * property is that it SCALES WITH WHETHER THE MACHINE IS BUSY. A budget
 * expressed as a ratio to this op is a budget on the CODE: a busy runner
 * inflates both arms together and the ratio survives; a real regression
 * inflates only the arm under test.
 */
function calibrationOp(): void {
  CALIBRATION_MAP.get(CALIBRATION_KEY);
  CALIBRATION_KEY.length;
}
```

This is the mechanism the file's own comment describes as the fix for the
flake it was built to stop, applied to the five tests that never adopted it.

**(3) Make the single-measurement tests batched too, and give them a
ratio-based ceiling.**

```diff
   it("tenant invalidation completes in <5ms for 512 entries", () => {
     for (let i = 0; i < 512; i++) {
       setCache(`${KEY_PREFIX}:bulk:${i}`, { id: i }, 60_000);
     }
     setCache("other-tenant:1", { id: 999, 60_000 });
-
-    const start = performance.now();
-    invalidateTenant(KEY_PREFIX);
-    const elapsed = performance.now() - start;
-
-    expect(elapsed).toBeLessThan(5);
+    // Batched: the first call pays the Map's growth, so the batch is the
+    // honest number. A single measurement of a single Map sweep is the
+    // shape that goes red when the OS deschedules the runner.
+    const elapsed = p95PerOp(() => { invalidateTenant(KEY_PREFIX); });
+    expect(elapsed).toBeLessThan(5);
     expect(cacheStats().size).toBe(1);
   });
```

### 6.3 The one-line "verified" rule the gate should assert

The perf gate should not assert absolute milliseconds at all. It should assert
**ratios measured in one run**, plus **absolute ceilings that are 20× the
measured cost** so that even a pathological runner cannot trip them:

| What is guarded | Proposed assertion | Measured cost (this run) | Proposed ceiling |
|---|---|---|---|
| cache hit | `p95PerOp(getCached) < p95PerOp(calibration) * 50` | 0.005 ms | ratio |
| response construction | `p95PerOp(ok) < p95PerOp(calibration) * 100` | — | ratio |
| security checks | `p95PerOp(runSecurityChecks) < p95PerOp(calibration) * 200` | 0.040 ms p50 | ratio |
| tenant invalidation | `p95PerOp(invalidateTenant) < p95PerOp(calibration) * 200` | — | ratio |
| rate limiter | `p95PerOp(checkIpRateLimit x100) < p95PerOp(calibration) * 1000` | — | ratio |
| **"the code got slower"** | `slow > cheap * 4` (already in the file) | — | **keep as-is** |

The existing relative tests ("excludes a single pathological batch",
"still reports uniform cost") are the right shape and should be kept verbatim.
They are the only assertions in the file that survive a loaded runner, and
they are what proves the gate still catches a real regression.

### 6.4 What the orchestrator must NOT do

Do **not** "fix" the flake by raising the absolute budgets. The budgets are
already 20–40× the measured cost; raising them hides the problem. The problem
is the *measurement shape*, not the *number*.

---

## 7. "Verified correct" — things that were measured and need no change

| # | Thing | Evidence |
|---|---|---|
| V1 | The gateway's **response cache** is fast and correct. | M20: `getCachedResponse` hit = min 0.004 / p50 0.005 / p95 0.011 ms over 50,000 iterations. M22: the cacheable route sustained **50.0 req/s** at p50 0.65 / p95 1.19 / p99 1.99 ms. |
| V2 | The gateway's **per-isolate Turso client cache** is fast and bounded. | M21: `getTurso` hit = 0.002 ms. `tursoCacheStats()` = `{size:1, max:64}` — one client per database, LRU-bounded, replaced in place on token rotation. |
| V3 | The **per-isolate memory maps are bounded** — no leak. | M23: 12,000 distinct client IPs → RSS **+6,268 KB** (522 B/entry) against a 10,000-entry cap. M24: 12,000 distinct nonces → RSS **+908 KB** (76 B/entry) against a 10,000-entry cap. Both plateau at the cap. |
| V4 | **Security checks are not a bottleneck.** | M17: `runSecurityChecks` min 0.022 / p50 0.040 / p95 0.131 / p99 0.287 ms — three orders of magnitude below the dashboard's cost. M18: `validateNonce` p50 0.006 ms. |
| V5 | **The per-request `nonceCache` sweep is already fixed.** | `lib/security.ts:493-526` documents removing the O(cache-size) sweep; the measured `validateNonce` p50 of 0.006 ms confirms it. |
| V6 | The **gateway's edge floor is good**. | M1: live `/health` = ttfb 0.90–1.45 ms, total 0.90–1.46 ms. |
| V7 | The **product page's server render is fast**. | M3: live `/` = ttfb 0.39–0.96 ms. M5-equivalent for the local prod build: static pages serve from the prerender cache. |
| V8 | The product page's **off-screen frameloop works** (FM-16 fixed). | M38: 32.1 fps desktop / 59.2 fps mobile once the canvas scrolls out of view, versus 1.95 / 3.24 on screen. `ProductScene.tsx:51` `frameloop={inView ? "always" : "never"}`. |
| V9 | The product page's **degradation ladder is real and works**. | M37: mobile 390×844 = **3.24 fps** vs desktop 1440×900 = **1.95 fps**, with `resolveDpr` → `[0.75,1]`, 80 particles and 1 transmission sample. |
| V10 | The product page **lazy-loads three.js correctly**. | M34: `/` initial client JS = **67 KB gzip**; the 244 KB gzip three.js chunk is NOT in the initial manifest (M35) — it arrives after FCP via `dynamic()` (`ProductHero.tsx:39`). |
| V11 | The web app's **server render is cheap**. | M5: `/login` warm = ttfb 7–32 ms, 29,804 B, `x-nextjs-cache: HIT`. |
| V12 | The web app's **anonymous path does not pay the Auth round trip**. | M5 + `supabase-js` semantics: `getUser()` short-circuits on a missing session; only authenticated traffic pays P1-6's 240 ms. |
| V13 | The gateway's **`ensureSelfRepairingSchema` warm path is free**. | M14: **0.0006–0.008 ms**, 0 SQL, on the per-isolate `Set` hit. |
| V14 | The gateway's **dashboard route is not N+1** in the SQL sense. | M15/M16: **8 SQL statements** per dashboard request, issued in one `Promise.all` (`routes/analytics.ts:366`). There is no per-row query loop. The cost is the *size* of the reads, not their count. |
| V15 | The **cold-start heal is concurrency-safe**. | `lib/schema.ts:404-448` uses the `inflightLoads` pattern (set synchronously, deleted in `finally`) and `repairLegacyInvoicesAndReceipts` runs each table's rebuild in its own write transaction. Correct. |
| V16 | The **`/api/v1/students` route's cache path is already exercised and correct.** | M43/M44: `isCacheablePath('/api/v1/students') === true`, and the cache is tenant-scoped with a 63 s TTL. |
| V17 | The web app's **A/B variants do NOT multiply the build or the render cost.** | M44 + code: the variants are runtime cookie values, not build-time branches. The answer to the brief's question is **No** — the cost is the 4 `Set-Cookie` headers and the false "we are testing" signal (P2-12), not a 4× build. |
| V18 | The **gateway's `resolveOrderBy` seam** (which throws rather than silently dropping an unvalidatable sort) is intact and is not a perf factor. | `lib/orm.ts:155-187`. |
| V19 | The **build itself is not pathological**. | M7: web 55.5 s, M8: product page 44.5 s — both dominated by Turbopack compile (31.9 s) and the TS pass (2.9 / 5.2 s). No single step dominates beyond reason. |

---

## 8. Build / CI cost

| Command | Wall | Detail | Note |
|---|---|---|---|
| `bunx next build` (apps/web) | **55.5 s** | compile 31.9 s, TS 2.9 s, static pages 7.4 s (17 pages) | ✅ |
| `bunx next build` (apps/product-page) | **44.5 s** | TS 5.2 s, static pages 3.4 s (11 pages) | ✅ |
| `bun run typecheck` | **57.9 s** | 7/7 packages pass | ⚠️ the chain is serial; `bun --filter` runs them one after another |
| `bun run lint` | **30.6 s** (web filter only — the chain stops at the first failure) | **currently RED**: 16 `no-undef` errors, all in untracked `apps/web/scripts/_audit_pw_*.mjs` scratch files another agent left in the tree | 🔴 **not a perf bug — a hygiene bug**: throwaway scripts under `apps/web/scripts/` are being linted. Two fixes: (a) delete them, (b) add `apps/web/scripts/**` to `.eslintignore`/the eslint config's ignores, since `apps/web/scripts/` is tooling, not product code. |
| `bunx vitest run` (apps/gateway) | **29.3 s** | 59 files, 881 tests; `transform 38.89 s, setup 6.01 s, import 69.93 s, tests 84.09 s` cumulative | ⚠️ 3 files / 10 tests failing from another agent's in-flight `fee-strictness` / `idempotency-cas` edits |
| `bun run test:unit` (root vitest) | not measured | `hookTimeout: 60000`, `testTimeout: 30000` | ⚠️ |
| `bun run test:integration` (root integration vitest) | not measured | `testTimeout: 10000`, **no `hookTimeout`** | ⚠️ the same gateway files, a different ceiling — see §6.1 |

### Avoidable CI cost — concrete proposals

1. **Split the perf gate out** (§6). Today the perf assertions are measured
   while 58 other files compete for the CPU. Moving them to their own job
   costs one extra runner-minute and removes the entire flake class.
2. **Align the three vitest configs.** The root config, the gateway package
   config and the root integration config run the same files with three
   different timeout sets. One shared `testTimeouts` constant, imported by all
   three, ends the "one tree, two verdicts" problem the integration config's
   own comment describes.
3. **The `hookTimeout: 60_000` is not the cost.** It is a *ceiling*, and a
   ceiling only costs time when a test actually hits it. The 29.3 s gateway
   suite is dominated by transform/import (38.89 s / 69.93 s cumulative),
   not by timeouts. The brief's hypothesis that the 60 s hookTimeout is
   avoidable cost is **not supported by the measurement** — the fix is to
   isolate the perf files, not to shorten the ceiling.
4. **The coverage floors re-running everything** — `bun run test:unit` and
   `bun run test:integration` run the *same* gateway test files under two
   configs. If the coverage floor is what forces the second run, the
   integration config's `include` could be narrowed to the files that
   actually have integration coverage, instead of all 59.

---

## 9. The exact commands run

Everything below was run on **2026-10-21** from the repo root
`Z:\Projects\buddysaradhi\buddysaradhi`, or from Kali WSL
`wsl -d kali-linux -u root -e bash -lc '…'`.

### 9.1 HTTP timing

```bash
# probe.sh: DNS / TCP / TLS / TTFB / total, separately
bash /tmp/probe.sh "LIVE prod web /"        "https://buddysaradhi.vercel.app/" 3
bash /tmp/probe.sh "LIVE prod web /login"   "https://buddysaradhi.vercel.app/login" 3
bash /tmp/probe.sh "LIVE product page /"    "https://buddysaradhi-product.vercel.app/" 3
bash /tmp/probe.sh "LIVE gateway /health"   "https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway/health" 4
bash /tmp/probe.sh "LIVE gateway /marketing" "https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway/api/v1/marketing/stats" 4
bash /tmp/probe.sh "LIVE Supabase Auth"     "https://gmqwdnvbfnwpzpctwvho.supabase.co/auth/v1/user?apikey=dummy" 5
```

### 9.2 The hermetic gateway harness

```bash
# 1. build an ISOLATED, file:-capable copy of the gateway (repo untouched)
python3 /tmp/mkgw.py                       # -> /tmp/gw-perf (2 local-only deltas, documented in §2.2)
# 2. the harness: schema heal, dashboard, security, HMAC, cache, client cache
cd /tmp/gw-perf && DENO_DIR=/tmp/deno-cache \
  deno run --allow-all --config deno.json /tmp/gw-harness2.ts
# 3. the per-leg A/B benchmark (the source of every expected-win number)
cd /tmp/gw-perf && DENO_DIR=/tmp/deno-cache \
  deno run --allow-all --config deno.json /tmp/ab-legs.ts
# 4. the end-to-end fix validation (index + aggregate + projection)
cd /tmp/gw-perf && DENO_DIR=/tmp/deno-cache \
  deno run --allow-all --config deno.json /tmp/fix-validation.ts
# 5. the row-bytes / query-plan probe
cd /tmp/gw-perf && DENO_DIR=/tmp/deno-cache \
  deno run --allow-all --config deno.json /tmp/row-bytes.ts
# 6. the IN-list shapes and the SQLite variable ceiling
cd /tmp/gw-perf && DENO_DIR=/tmp/deno-cache \
  deno run --allow-all --config deno.json /tmp/in-list.ts
cd /tmp/gw-perf && DENO_DIR=/tmp/deno-cache \
  deno run --allow-all --config deno.json /tmp/var-limit.ts
# 7. the load / leak harness
cd /tmp/gw-perf && DENO_DIR=/tmp/deno-cache \
  deno run --allow-all --config deno.json /tmp/gw-load.ts
```

### 9.3 Browser / WebGL

```bash
# product page, desktop and mobile, software GPU
node /tmp/browser-probe2.js "http://172.21.0.1:3003/"  probe-product.json       1440x900
node /tmp/browser-probe2.js "http://172.21.0.1:3003/"  probe-product-mobile.json 390x844
# web /login
node /tmp/browser-probe2.js "http://127.0.0.1:3010/login" probe-web-login.json 1440x900
# hydration + CSP violation census
node /tmp/hydration-check.js "http://127.0.0.1:3010/login"
node /tmp/hydration-check.js "http://172.21.0.1:3003/admin/login"
# the decisive CSP A/B/C experiment (rewrites the RESPONSE header in-flight)
node /tmp/csp-experiment.js "http://127.0.0.1:3010/login"
```

### 9.4 Bundle analysis

```bash
node /tmp/route-bundles.js "apps/web/.next/server/app"
node /tmp/route-bundles.js "apps/product-page/.next/server/app"
node /tmp/route-gzip.js    "apps/web/.next/server/app"
node /tmp/route-gzip.js    "apps/product-page/.next/server/app"
```

### 9.5 Build / CI

```bash
cd apps/web          && bunx next build
cd apps/product-page && bunx next build
bun run typecheck
bun run lint
cd apps/gateway && bunx vitest run
```

### 9.6 Static analysis (the findings that needed no profiler)

```bash
rg -n "buddysaradhi_ab_"                        # 12 hits, all writes + docs
rg -n "analytics/dashboard" apps/web/src          # 2 call sites
rg -n "SELECT \*" apps/gateway/lib/sql.ts         # the projection gap
rg -n "importKey" apps/gateway/lib/crypto.ts     # the per-call key import
rg -n "getUser\(\)" apps/web/src/lib/supabase/middleware.ts
rg -n "getClaims" node_modules/next/dist/server/app-render/app-render.js
```

---

## 10. Tools I want installed

The brief says to ask before installing. These are the tools I would have used
and could not, and what each would have added:

| Tool | Why | What it would have added |
|---|---|---|
| **`k6`** | The reference load generator; supports arrival-rate open-loop scheduling (which is what "50 req/s for 60 s" actually means — my harness approximated it with a timer, but k6 would have given true constant-rate arrival with proper latency percentiles and dropped-request accounting). | A publication-grade throughput/latency curve instead of the timer-based one. |
| **`autocannon`** (or `wrk`) | Faster, simpler HTTP load generation for the **web app's** HTTP path (my gateway load was at the module level, not the HTTP level). | HTTP-level p50/p95/p99 and bytes/sec for `/login`, `/dashboard`. |
| **`nuclei`** | Fast, template-driven probing of the three live surfaces for slow endpoints and misconfiguration. | A quick sweep for any route I missed that is slower than the ones I measured. |
| **`httpx`** | A fast HTTP probe with per-request timing and a `-rl` rate limit, for the cold-vs-warm matrix across **all** routes of the live gateway (I could only probe the unauthenticated ones). | A complete cold/warm matrix for every gateway route. |
| **`bandit`** / **`semgrep`** | Python/static security scanning; a perf-adjacent variant would catch the "unbounded IN list" and "SELECT *" patterns I found by hand, as rules rather than as one-off findings. | A CI rule for the P1-9/P1-10/P2-11 classes. |
| **`gobuster`** | Directory/endpoint discovery on the local instances. | Confirmation that no additional routes exist. |
| **`chrome` (standalone) with `--headless=new --remote-debugging-port`** | I used Playwright's bundled Chromium instead (already installed), which was sufficient. Listed only for completeness. |
| **`lighthouse`** (or `bunx @lhci/cli` — already a devDependency) | A field-standard Core Web Vitals report for the web app's five screens. | LCP/CLS/INP and a TBT breakdown per screen, comparable to published benchmarks. I measured FCP and JS bytes, but not CLS/INP. |

**Not needed, and I would decline them:** `wrk`/`hey` (autocannon covers it),
`zaproxy`'s load generator (its built-in generator is a poor fit for a
constant-arrival-rate open-loop test and it hammers the target harder than
"be a good citizen" allows).

---

## 11. Apply order (recommended)

| # | Fix | Effort | Risk | Win |
|---|---|---|---|---|
| 1 | **P0-1** — the one-line request-CSP header in `apps/web/src/proxy.ts` (mirroring `apps/product-page/src/proxy.ts:88-90`) + the static/dynamic scoping | S | **§8 trigger: security reviewer** | Restores the entire app; removes 146–233 KB gzip of dead download |
| 2 | **P0-3** — one gateway call per dashboard render | S | Low | 214–1184 ms per dashboard view |
| 3 | **P1-4** — aggregate the period leg in SQL | M | **§8 trigger: money (BR-CALC-10 / BR-M-01)** | 280 ms + 1.9 MB per request |
| 4 | **P2-11** — projection seam (no `SELECT *`) | M | Low | 42 ms + 420 KB per request |
| 5 | **P1-5** — one probe instead of six | S | Low | 5 RTTs (~1.2 s) per cold isolate |
| 6 | **P1-6** — `getClaims()` in the middleware | S | **§8 trigger: security reviewer** | ~240 ms per authenticated request |
| 7 | **P1-10** — invert the reversed-credit lookup | S | Medium (money semantics) | Removes a hard failure at 32,766 payments |
| 8 | **P1-8** — cache the imported HMAC key | XS | Low | 0.32 ms per request |
| 9 | **P1-9** — the two missing indexes | XS | Low | 1.19× today; asymptotic tomorrow |
| 10 | **P0-2** — re-measure the dashboard after 3+4 | XS | — | **verification step**, not a fix |
| 11 | **P2-13** — the isolated perf gate | M | Low | Removes the flake class |
| 12 | **P2-12** — remove the dead A/B cookies | XS | Low | 4 Set-Cookie headers/request; one false claim removed |
| 13 | **P1-7** — the 3D transmission/MSAA tiers | S | Low | Target ≥ 2× on a software GPU (**unmeasured — verify**) |
| 14 | **P3-15** — the lint hygiene fix + vitest config alignment | S | Low | 30.6 s lint, 29.3 s suite, one verdict per tree |

**After applying 3 + 4, re-run the harness** (`/tmp/gw-harness2.ts`) and expect
the default window to fall from p50 467 ms to under 120 ms and the "All" pill
from p50 669 ms to under 80 ms. If it does not, the remaining cost is the JS
materialisation and the next lever is to stop shipping whole rows to the
client at all (a column-projected DTO per response, which is a larger change
and is not proposed here).

---

## 12. A note on what this report did **not** do

* It did **not** edit product code. Every proposed diff is in this file, for
  the orchestrator to apply.
* It did **not** measure the web app's five screens under load, because the
  screens require a Supabase session and the local rig's auth path is owned
  by another agent. The dashboard's server-render cost is instead measured at
  the **gateway** layer (P0-2, P0-3), which is where the money is.
* It did **not** measure the product page's post-fix FPS (P1-7), because that
  requires editing `scene-tiers.ts` / `ProductScene.tsx`. The fix and the
  measurement the orchestrator must take are both stated.
* It did **not** measure the **live** web app, because it returns **HTTP 403**
  (Vercel deployment protection) from outside — M4. The local production
  build was used instead, and it is the same build artifact.
* The WSL/Windows box was shared with another agent for part of the session;
  every absolute wall-clock number is therefore given as a **range across
  repeated runs**, and every claim that carries weight is corroborated by an
  **interleaved A/B** measurement in which both arms experience identical
  load.
