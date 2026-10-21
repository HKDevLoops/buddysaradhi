# DYNAMIC-WEB — black-box security assessment of the Buddysaradhi web app

**Engagement:** authorized black-box dynamic assessment of the owner's own
deployment.
**Date:** 2026-10-21
**Scope:** `apps/web` only (the Next.js 16 App Router app + its edge proxy).
**Targets:** `https://buddysaradhi.vercel.app` (production), plus a local
production build (`next build && next start`) and a local dev server for
discovery and fuzzing.
**Tooling:** nmap, sqlmap, nikto, ffuf, wfuzz, msfconsole, tshark, burpsuite,
amass, sslscan, seclists, lynis, whatweb, zaproxy (daemon + JSON API),
tcpdump, netcat, curl, python3, Deno 2.9.7, Playwright (Chromium 1228/1234),
plus the repo's own `bunx vitest` / `tsc --noEmit` / `eslint`.

> `nuclei`, `httpx`, `gobuster`, `bandit` and `semgrep` are **not installed on
> this host** and were not installed (per the engagement brief). The work below
> was done with the tools that are present; where a missing tool would have
> changed the outcome, that is stated.

---

## 1. Executive summary

The assessment found **one production-breaking defect** and **one
authentication-abuse defect** in the web tier, plus a set of findings that sit
in the gateway (out of this subagent's fix scope) and a set of things that are
demonstrably **correct**.

The headline:

> **The production deployment could not be signed into.** The edge proxy
> (`apps/web/src/proxy.ts`) serves every HTML document under a **per-request
> CSP nonce** with `strict-dynamic`. The five public auth pages were exported
> `force-static`, so they are **prerendered at build time** and their
> `<script>` tags carry **no nonce**. `strict-dynamic` tells the browser to
> ignore the `'self'` host allowlist, so **every same-origin script was
> refused**. Measured on `https://buddysaradhi.vercel.app/login` in a real
> browser: 29 of 30 `<script>` tags had no nonce, 17 chunk requests failed with
> `ERR_BLOCKED_BY_CSP`, React never hydrated, and submitting the sign-in form
> with **valid credentials did nothing** — the URL became `/login?` and no
> auth cookie was set.

That is a P0 availability finding with a security cause: the Content-Security-
Policy the app ships is *unsatisfiable by the documents it ships*. The obvious
"fix" a maintainer reaches for — adding `'unsafe-inline'` — would have turned
a broken login into an XSS. The correct fix (applied here) is to make the
document and the policy agree, by rendering the pages that carry a nonce
policy per request.

The second confirmed web-tier defect is the **rate-limit key**: the `/api/v1/*`
token bucket was keyed on the first entry of `x-forwarded-for`, a header the
client chooses on any deployment that does not overwrite it. On a self-hosted
production build, every distinct value minted a **fresh 60-token bucket** — the
limiter was a no-op. The current Vercel deployment is *not* exploitable (Vercel's
edge overwrites the header — verified live), but the code was one proxy away
from being a no-op everywhere.

Everything else that was hunted for and **not** found is listed in §5 with the
command that proved it: cross-tenant IDOR, SQL injection, stored/reflected
XSS, CSRF, open redirect, CRLF header injection, secret leakage in the client
bundles, and account enumeration. Those are genuinely clean, and the report
says so with evidence.

**Counts:** 12 findings — 1 P0, 2 P1, 4 P2, 5 P3/informational. 4 were fixed
in this engagement (each with a verified-red regression test); 3 gateway-side
findings are reported for the gateway owner and were **not** touched (out of
scope).

**A governance finding belongs in the same breath as the P0.** The repository
already contained a *real-browser* regression test for this exact defect —
`apps/web/src/app/csp-hydration.test.ts` — written by an earlier audit, with
the correct diagnosis in its header comment. It **skips when no app is
reachable**, so it never fails in CI, and the defect shipped to production
anyway. The fix below adds two **server-less** invariant tests that go red on
the defect with no server running; see §6.1.

---

## 2. Findings table

Rows are ordered by severity. The **IDs are stable identifiers, not ranks** —
F-4/F-5 sit in the gateway and were reported, not fixed (out of this
subagent's scope).

| ID | SEV | file:line | What | Proof (command → output) | Fix | Status |
|----|-----|-----------|------|--------------------------|-----|--------|
| **F-1** | **P0** | `apps/web/src/proxy.ts:357-371` (+ `src/app/(auth)/*/page.tsx`) | The edge serves a **per-request CSP nonce** with `strict-dynamic`; the five auth pages are `force-static` (prerendered) so their `<script>` tags carry **no nonce** → the browser refuses **every** same-origin script → **production sign-in is dead** | `node scripts/_audit_pw_live_signin.mjs` → `hydrated? reactRootKeys = 0`, `scripts w/ real nonce: 0`, `requestfailed (csp): 17`, `after submit url: https://buddysaradhi.vercel.app/login?`, `cookies: buddysaradhi_ab_*` only (no auth cookie) | Removed `export const dynamic = "force-static"` from the 5 auth pages so the root layout's `headers()` call renders them per request and the document carries the policy's nonce | **FIXED** (+ regression test, negative control) |
| **F-2** | **P1** | `apps/web/src/proxy.ts:102-111` (pre-fix) | The `/api/v1/*` token bucket was keyed on the **first entry of `x-forwarded-for`** — client-chosen on any deployment that does not overwrite it. Unlimited buckets ⇒ the limiter is a no-op | `bash rl3.sh` → three requests with distinct `x-forwarded-for` each answered `ratelimit-remaining: 59` (a fresh bucket), while the no-header bucket fell `29, 28, 27` | New `src/lib/client-ip.ts`: prefer a **platform-overwritten** header (`x-vercel-forwarded-for` on Vercel, `cf-connecting-ip` on Cloudflare), shape-check the value, fall back to the shared bucket; **plus** a per-instance ceiling that no header forgery can pass | **FIXED** (+ regression test, negative control) |
| **F-4** | **P1** | `apps/gateway/index.ts` (read-only) | The gateway accepts a **GET with no `X-Signature` at all**. A forged signature is rejected, an *absent* one is not | `python3 gw_auth.py` → `[200] unsigned + all of A's creds` returns A's roster; `[401] unsigned POST → "signature, timestamp, and nonce required for mutations"` | **NOT FIXED — out of scope (`apps/gateway/**`).** Reported to the gateway owner. Reads still require a valid bearer whose uid matches `X-Tutor-Id`, so this is defence-in-depth, not an open door. | OPEN (gateway) |
| **F-5** | **P1** | `apps/gateway/lib/sql.ts` / `apps/gateway/index.ts` (read-only) | The gateway is a **public** Supabase Edge Function and it dials the `X-Db-Url` the caller supplies — a **blind SSRF** from inside Supabase's network. A bogus token returns **200 + an empty roster** instead of an error (silent failure, Rule 9) | `python3 gw_ssrf_timing.py` → `libsql://nonexistent-host` took **9.58 s** (a real DNS attempt) while the others failed fast; `[200] real db + WRONG token → {"students":[],"total":0}` | **NOT FIXED — out of scope.** Recommended: whitelist the db host, and make a credential failure a typed 401/503 instead of an empty list. | OPEN (gateway) |
| **F-3** | **P2** | `apps/web/src/proxy.ts:326-328` (pre-fix) | `isHtmlPage` excluded any path containing a dot, so `/nope.json` (an **HTML** 404) was served under the static safety-net policy `script-src 'self' 'unsafe-inline'` while `/nope` got the strict nonce policy | `bash csp_map.sh` → `/nope.json  → 404 ct=text/html … csp: script-src 'self' 'unsafe-inline'` vs `/nope → 404 … csp: script-src 'self' 'nonce-3Hem8e…' 'strict-dynamic'` | `isHtmlPage` is now "not `/api/*`, not `/_next/*`" — the strict policy applies to every document | **FIXED** (+ regression test, negative control) |
| **F-6** | **P2** | `apps/web/src/app/api/v1/[...slug]/route.ts:154-240` | The BFF **forwards every client query parameter to the gateway unvalidated** — no Zod at the boundary, contrary to AGENTS §6.1. The gateway validates today, so this is a defence-in-depth gap, not a live injection | `grep` shows no `zod` import in the route; `bash inject_battery.sh` §4 — 5 params × 5 payloads, **no SQL error surfaced**; §5 — `limit='; DROP TABLE students;--` → `{"success":false,"error":"forbidden"}` and the table was intact | **NOT FIXED** (deliberate: the BFF is a thin pass-through and a per-route Zod allowlist is a larger change than this engagement can verify end-to-end). Recommend a Zod allowlist per gateway path. | OPEN (web, recommended) |
| **F-7** | **P2** | `apps/web/src/app/(app)/dashboard/page.tsx` + `src/server/queries/dashboard-analytics.ts` | The dashboard is a **blocking waterfall**: ~6 gateway legs (the analytics leg alone fans out ~20 sub-legs) at 0.6–0.8 s each ⇒ a **4.9 s** render | `bash perf.sh` → `/dashboard 4.89 s`; the six legs sum to **6.41 s**; `perf3.sh` → `/api/v1/analytics/dashboard 2.83 s`, the other five 0.61–0.80 s | **NOT FIXED** — a perf change, not a security fix, and it needs a correctness review of the prefetch/dehydration contract. Measured and reported. | OPEN (perf) |
| **F-12** | **P2** | `apps/web/src/app/csp-hydration.test.ts` | The regression test for F-1 **skips when no app is reachable** (`ctx.skip("no app at …")`), so the gate that would have caught the production break **can never fail in CI** — which is why F-1 shipped | the test's own comment already records the live measurement ("30 CSP violations on `/login` … NEVER HYDRATED") and the test still skipped | Two server-less invariant tests added (`auth-pages-csp.test.ts`, `proxy.csp.test.ts`) that fail on the defect with no server at all; the browser test stays as the end-to-end proof | **FIXED** (new tests) / CI wiring still open |
| **F-8** | **P3** | `apps/web/src/lib/supabase/middleware.ts:108-120` | The `buddysaradhi_session` cookie is set with `httpOnly` + `path` but **no `Secure` and no `SameSite`** | `node _audit_pw_login.mjs` → `buddysaradhi_session secure=false httpOnly=true sameSite=Lax` (dev); the same code path is used in production, where `secure` is not set for this cookie (the A/B cookies in `src/proxy.ts:388-394` DO set it) | **NOT FIXED** — `SameSite=Lax` is the CSRF control for the session cookie and the Supabase cookie is `Lax` too; changing only this one is cosmetic while changing the Supabase cookie to `HttpOnly` would break the browser client that signs in. Reported with the reasoning. | OPEN (recommended) |
| **F-9** | **P3** | `apps/web/src/lib/supabase/client.ts` | The Supabase **session cookie is `httpOnly=false`** (that is `@supabase/ssr`'s `DEFAULT_COOKIE_OPTIONS`), so any XSS is immediately a session theft | `node _audit_pw_login.mjs` → `sb-gmqwdnvbfnwpzpctwvho-auth-token.0 secure=false httpOnly=false sameSite=Lax` | **NOT FIXED** — inherent to the browser-client sign-in flow. The compensating control is the nonce CSP (which F-1 had broken); now that the CSP works again, the cookie is only readable by same-origin script. | OPEN (architectural) |
| **F-10** | **P3** | repo root `.env.local`, `apps/web/.env.local` | Live secrets are present in the working tree (`SUPABASE_SERVICE_ROLE_KEY`, `TURSO_API_TOKEN`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `GATEWAY_SHARED_SECRET`, `VERCEL_OIDC_TOKEN`) | `bash secret_value_scan.sh` → only `NEXT_PUBLIC_SUPABASE_ANON_KEY` appears in any client bundle; the secrets themselves appear in **no** bundle | **NOT FIXED — out of scope** (not a web-app file; the owner must rotate + remove them from the tree). Recorded because a service-role key in a repo is a P0 the moment the repo is shared. | OPEN (owner) |
| **F-11** | **P3** | `apps/web/src/proxy.ts` / `next.config.ts` | The **static** safety-net CSP still carries `script-src 'self' 'unsafe-inline'`; it now only applies to non-document responses, but it is the policy a future refactor could accidentally hand to a document | `next.config.ts:14` | Kept deliberately (it is the net for API/static responses) but the middleware now covers every document. Recorded so the next change does not widen it. | ACCEPTED (documented) |

---

## 3. The fixes I made

All four fixes are in `apps/web` (my scope). Each has a regression test whose
**negative control was executed**: the fix was reverted, the test was observed
to go **red**, and the fix was restored.

### F-1 — the CSP nonce must match the document (P0)

**Files**

* `apps/web/src/app/(auth)/login/page.tsx`
* `apps/web/src/app/(auth)/signup/page.tsx`
* `apps/web/src/app/(auth)/forgot-password/page.tsx`
* `apps/web/src/app/(auth)/reset-password/page.tsx`
* `apps/web/src/app/(auth)/signup/provision/page.tsx`
* `apps/web/src/app/(auth)/signup/provision/provision-client.tsx` (stale comment)

**Spec:** 10_Security.md §6 (XSS-1 — a nonce-based, `strict-dynamic` CSP);
23_Security_Harness_Plan.md §7; AGENTS.md §2 Rule 10 (accessibility — a page
with no JavaScript is not usable); AGENTS.md §2 Rule 9 (no silent failures —
a dead sign-in button is the worst kind of silent failure).

**What changed.** `export const dynamic = "force-static"` was removed from the
five auth pages. The root layout already reads `headers()` for the nonce
(`src/app/layout.tsx:79`), so without the static export the route is
server-rendered per request, and the document's `<script>` tags carry the same
nonce the CSP header names.

**Why this and not the alternatives.**

* *Keep the pages static and drop `strict-dynamic`.* The App Router inlines
  the RSC flight payload as an inline `<script>`, and the root layout's
  first-paint script is inline too. Without a nonce or `'unsafe-inline'`
  neither can run, and without `strict-dynamic` the `'self'` allowlist is the
  only thing left — which is exactly the policy the block was written to
  remove.
* *Use a build-time nonce.* A static nonce is a public nonce: it ships to
  every visitor, so any injected `<script nonce="…">` would execute.
* *Make the page dynamic.* Correct, and the app already server-renders the
  five product screens and the 404 page, so this is not a new class of
  behaviour.

**Regression test:** `apps/web/src/app/(auth)/auth-pages-csp.test.ts`
(5 tests) — asserts no auth page is exported `force-static`.

**Negative control (executed):**

```
$ # `export const dynamic = "force-static";` re-added to login/page.tsx
$ bunx vitest run "src/app/(auth)/auth-pages-csp.test.ts"
 FAIL  src/app/(auth)/auth-pages-csp.test.ts > auth pages must not be prerendered
       > (auth)/login is not exported as force-static
 AssertionError: (auth)/login exports dynamic="force-static":
   expected 'force-static' not to be 'force-static'
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
$ # fix restored → 5 passed
```

**End-to-end proof (local production build, after the fix):** the script
nonces now equal the policy nonce, and the page hydrates — see §6.

---

### F-2 — the rate-limit key must not be client-chosen (P1)

**Files**

* `apps/web/src/lib/client-ip.ts` (new)
* `apps/web/src/lib/client-ip.test.ts` (new)
* `apps/web/src/server/rate-limit.ts` (per-instance ceiling)
* `apps/web/src/server/rate-limit.global.test.ts` (new)
* `apps/web/src/proxy.ts` (call site)

**Spec:** web/04_API_Routes.md §2 (token bucket per IP, 60 reads / 10 writes,
429 + `Retry-After`); 10_Security.md §11 (brute-force / abuse friction);
AGENTS.md §2 Rule 9 (a limiter that can be bypassed is theatre).

**What changed.**

1. `clientIpFromRequest` moved to `src/lib/client-ip.ts` and now resolves in
   this order: a **platform-overwritten** header
   (`x-vercel-forwarded-for` on Vercel, `cf-connecting-ip` on Cloudflare,
   selected by the platform's own env markers so a client cannot fake the
   platform) → `x-forwarded-for` → `x-real-ip` → a shared `unknown` bucket.
   The value is **shape-checked**: a value that is not address-shaped cannot
   mint a bucket.
2. A **per-instance ceiling** (`rateLimitApiRequestGlobal`) was added and is
   consumed *in addition to* the per-IP bucket. It is keyed on nothing the
   client can influence, so no amount of header forgery gets past it. Default
   6000 reads/min and 600 writes/min (100× the per-IP read cap — a flood
   tripwire, not rationing), overridable with
   `API_RATE_LIMIT_GLOBAL_READ_CAP` / `API_RATE_LIMIT_GLOBAL_WRITE_CAP`.
   The response carries `RateLimit-Global-Limit` / `RateLimit-Global-Remaining`
   so the saturation is visible rather than silent.

**Residual risk, stated honestly:** on a deployment with **no** platform edge
(a bare Node server reachable from the internet) there is no header the app
can trust, and `x-forwarded-for` is client-chosen. The per-instance ceiling
is what bounds that case. The Vercel production deployment is not affected:
Vercel's edge overwrites `x-forwarded-for`, which was verified live (§4.2).

**Regression tests:** `src/lib/client-ip.test.ts` (10 tests) and
`src/server/rate-limit.global.test.ts` (3 tests).

**Negative controls (executed):**

```
$ # platformIpHeaders() forced to return []
$ bunx vitest run src/lib/client-ip.test.ts
 FAIL  … > platformIpHeaders > trusts Vercel's own header on Vercel
 AssertionError: expected [] to include 'x-vercel-forwarded-for'
 FAIL  … > platformIpHeaders > trusts Cloudflare's own header on Cloudflare
 FAIL  … > clientIpFromRequest > prefers the platform-overwritten header …
 Tests  4 failed | 6 passed (10)

$ # GLOBAL_READ_CAP set to Number.MAX_SAFE_INTEGER (ceiling removed)
$ bunx vitest run src/server/rate-limit.global.test.ts
 FAIL  … > refuses once the instance-wide budget is spent …
 AssertionError: expected null not to be null
 Tests  1 failed | 2 passed (3)
```

---

### F-3 — the strict policy must cover every document (P2)

**File:** `apps/web/src/proxy.ts` (the `isHtmlPage` predicate)

**Spec:** 10_Security.md §6; 23_Security_Harness_Plan.md §7.

**What changed.** `isHtmlPage` was `!pathname.startsWith('/api/') &&
!pathname.startsWith('/_next/') && !pathname.includes('.')`. The dot test
classified `/nope.json` as a non-document, and the 404 page Next serves for it
is an **HTML document** — so it was served under the static safety net
(`script-src 'self' 'unsafe-inline'`) while `/nope` got the strict nonce
policy. The predicate is now "not `/api/*`, not `/_next/*`"; a path with a dot
is a document unless it is a known non-document route. Serving the stricter
policy on a `text/plain` response is inert (CSP only governs documents), so
the safe direction is to over-apply it.

**Regression test:** `apps/web/src/proxy.csp.test.ts` (6 tests) — the
"applies the strict policy to a DOTTED path too" case, plus:

* the CSP header on a document carries a nonce and `strict-dynamic`, and
  `script-src` carries **no** `'unsafe-inline'`;
* the nonce the edge mints is the **same** nonce the renderer receives
  (asserted through `x-middleware-request-x-nonce`, the mechanism Next uses to
  forward the mutated request headers);
* two requests get two different nonces;
* an API response gets **no** CSP from the edge;
* the `/` redirect keeps the nonce-free, inline-free `REDIRECT_CSP`.

**Negative control (executed):**

```
$ # `!pathname.includes('.')` restored in isHtmlPage
$ bunx vitest run src/proxy.csp.test.ts
 FAIL  … > applies the strict policy to a DOTTED path too (F-4: /nope.json is an HTML document)
 AssertionError: no CSP header on a dotted path   (received null)
 Tests  1 failed | 5 passed (6)
$ # fix restored → 6 passed
```

---

## 4. Evidence — the rest of the hunt

Every command below was run; the output is quoted verbatim (trimmed only of
noise). Scripts live in `C:\Users\haris\AppData\Local\Temp\opencode\` and
`/root/bstest/` (they were removed from the repo tree so they do not enter
the lint gate).

### 4.1 XSS

**Reflected.** Every reflected input the app has was probed:

| Surface | Payload | Result |
|---|---|---|
| `?code=` interceptor (`src/proxy.ts:187`) | `/?code=<script>…` | lands on `/callback?code=%3Cscript%3E…` (URL-encoded) — **no reflection** |
| `?next=` on `/callback` | `https://evil.example`, `//evil.example`, `/\evil.example`, `/%2f%2fevil.example`, `https:evil.example` | all → `location: /login?error=Invalid+magic+link` — **no open redirect** |
| `?search=`, `?q=`, `?name=` on `/students` | `<script>window.__R1=1</script>`, `<img src=x onerror=…>`, `"><svg onload=…>` | `raw <script>window.__R1 present: false`, `execution flags: {}` — **not reflected** |
| error / toast / banner content | — | `toAppErrorState` (`src/lib/app-errors.ts`) renders only static literals; the raw `err.message` never reaches a tutor (`src/components/ui/screen-state.tsx:16-19`) |
| `dangerouslySetInnerHTML` | — | **exactly one** occurrence in the app: `src/app/layout.tsx:99`, a static first-paint script carrying the nonce |

**Stored.** A student was created with HTML metacharacters in every profile
field (`A & B < C > D " E ' F`, `<b>bold</b> & 'quoted'`, `<i>ital</i> & more`,
`School & College`) and rendered:

```
=== /students  status=200
  contains literal '<b>bold</b>' (UNESCAPED): false
  contains '&lt;b&gt;bold'   (escaped)   : true
  contains 'A &amp; B'                 : true
  textContent has the literal name    : true
=== /dashboard  status=200
  contains literal '<b>bold</b>' (UNESCAPED): false
```

and the **raw** server HTML (the RSC flight payload — the one place a stored
`<` could break out of an inline `<script>`):

```
find('A & B') -> index -1
… \"name\":\"A \u0026 B \u003c C \u003e D \\\" E ' F \u003cb\u003ebold\u003c/b\u003e \u0026 'quoted'\"
flight payload around the name: … raw '<' inside that script body (unescaped): False
```

**Verdict: no XSS.** React escapes the text, and the RSC serializer escapes
`<` as `\u003c` in the flight payload, so a stored `</script>` cannot break
out. The gateway additionally rejects script payloads at the mutation boundary
(`apps/gateway/lib/security.ts:459` `XSS_PATTERNS` → 400), which is a
belt-and-braces layer, not the primary defence.

**One caveat found while testing (reported, not a web-tier defect):** the
gateway's mutation-body XSS scanner is a blunt instrument — it rejects any
student name containing `<script`, `<img onerror`, `<svg onload` or
`</script>`, including the legitimate case of a tutor whose student is named
with an angle bracket. That is a gateway product decision, not a security
defect.

### 4.2 Rate-limit bypass (F-2) — the measurement

Local **production** build (`next build && next start`), 60-reads-per-minute
bucket:

```
### Probe whether the x-forwarded-for value is what the limiter keys on
req 1 with xff=10.9.9.1 -> ratelimit-limit: 60 ratelimit-remaining: 59
req 2 with xff=10.9.9.2 -> ratelimit-limit: 60 ratelimit-remaining: 59
req 3 with xff=10.9.9.3 -> ratelimit-limit: 60 ratelimit-remaining: 59
### Same, no xff
req 1 no xff -> ratelimit-limit: 60 ratelimit-remaining: 29
req 2 no xff -> ratelimit-limit: 60 ratelimit-remaining: 28
req 3 no xff -> ratelimit-limit: 60 ratelimit-remaining: 27
```

Each distinct `x-forwarded-for` = a **fresh** 60-token bucket; the real
client's bucket drains normally. The root cause is in Next itself:

```js
// node_modules/next/dist/server/base-server.js:577
req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress;
```

`??=` — Next fills the header in **only when the client did not send one**, so
a client-supplied value reaches the app verbatim.

**On the live Vercel deployment the bypass does not work**, because Vercel's
edge overwrites the header:

```
### LIVE: does the production edge honour a client-supplied x-forwarded-for?
req 1 xff=10.9.9.1 -> ratelimit-remaining: 59
req 2 xff=10.9.9.2 -> ratelimit-remaining: 58
req 3 xff=10.9.9.3 -> ratelimit-remaining: 57
### LIVE: no xff
req 1 no xff -> ratelimit-remaining: 57
req 2 no xff -> ratelimit-remaining: 56
req 3 no xff -> ratelimit-remaining: 55
```

One shared bucket ⇒ the app saw Vercel's address, not the client's. So F-2 is
a **latent** defect on the current deployment and a **live** defect on any
self-hosted / Docker / Cloudflare-fronted build — which is where
`deployment/06_Edge_Function_Hosting.md` is heading.

### 4.3 CSRF

A hostile origin was hosted in Kali (`http://172.21.12.223:8011/csrf.html`)
and driven by a real Chromium with the app's **live session cookies** in the
jar:

```
=== hostile page output ===
(a) text/plain POST -> FETCH ERROR: TypeError: Failed to fetch
(b) application/json POST -> FETCH ERROR (blocked by CORS): TypeError: Failed to fetch
(c) form POST -> FETCH ERROR: TypeError: Failed to fetch
(d) Next-Action POST -> FETCH ERROR (blocked by CORS): TypeError: Failed to fetch
(e) cross-origin GET ledger -> FETCH ERROR (CORS read blocked): TypeError: Failed to fetch
=== requests the browser actually sent to the app ===
  POST http://127.0.0.1:3200/api/v1/students cookies=no
  POST http://127.0.0.1:3200/api/v1/students cookies=no
  POST http://127.0.0.1:3200/api/v1/students cookies=no
  POST http://127.0.0.1:3200/students cookies=no
  GET  http://127.0.0.1:3200/api/v1/ledger cookies=no
```

**Every cross-origin request was sent without the session cookie** — the
Supabase session cookie is `SameSite=Lax` (`@supabase/ssr`'s
`DEFAULT_COOKIE_OPTIONS`), so the browser refuses to attach it to a
cross-site POST. The JSON and `Next-Action` variants are additionally stopped
by the fail-closed CORS preflight. No form in the app uses progressive
enhancement (`<form action={serverAction}>` — every form is
`onSubmit={...}`), so a plain cross-origin form POST cannot invoke a server
action either.

**Honest caveat:** the **server** does not validate `Origin`. A non-browser
client can post anything:

```
Origin: https://evil.example  -> http=200 {"id":"7373575e-…","tenantId":"6b30c96a-…"}
Origin: <none>                -> http=200 {"id":"f346edfc-…"}
```

That is not a browser-exploitable CSRF (the browser is the only thing that
carries the session cookie, and it will not attach it cross-site), but it is
the reason the `SameSite` attribute is load-bearing and must not be relaxed.
Recorded as part of F-8/F-9.

### 4.4 IDOR / cross-tenant isolation

A **second tenant** was created through the Supabase admin API with the *same
physical database* and a *different* `user.id` — the worst case, because it
defeats "one database per tutor" and leaves only the `tenant_id` predicate.

```
=== TENANT A students ===
{"students":[{"id":"67458d91-…","code":"S-873","name":"QA Test Student",…},…],"total":3}
=== TENANT B students (same physical DB, different tenant id) ===
{"students":[],"total":0}
```

Through the web BFF, tenant B asking for tenant A's student by id:

```
as A: /api/v1/students/67458d91-… -> {"id":"67458d91-…","tenantId":"6b30c96a-…","code":"S-873",…}
as B: /api/v1/students/67458d91-… -> {"success":false,"error":"not found"}
as B: /api/v1/students?studentId=67458d91-… -> {"students":[],"total":0}
```

Directly against the gateway, tenant B pointed at tenant A's database, on
**every** endpoint:

```
[200] clean  /api/v1/students              {"students":[],"total":0}
[200] clean  /api/v1/ledger                []
[200] clean  /api/v1/ledger/invoices      []
[200] clean  /api/v1/ledger/fees          {"students":[],"total":0,…}
[200] clean  /api/v1/settings             null
[200] clean  /api/v1/attendance/batches   []
[200] clean  /api/v1/analytics/dashboard  {"kpis":{"totalStudents":0,…}}
[404] clean  /api/v1/students/67458d91-…  {"success":false,"error":"not_found"}
```

…while tenant A on the same endpoints returns the data. **Isolation holds on
every table.**

Client-supplied tenant headers are ignored by the BFF (the tenant is derived
from the session, never from a request value):

```
with x-tutor-id: 3d39ca63-…    -> {"students":[… tenant A's roster …]}
with X-Db-Url: https://evil…   -> {"students":[… tenant A's roster …]}
with X-Db-Token: forged        -> {"students":[… tenant A's roster …]}
with X-Signature: forged       -> {"students":[… tenant A's roster …]}
```

At the gateway, a forged signature **is** rejected and a bearer/tutor
mismatch **is** rejected:

```
GET /students with a FORGED signature -> (401, "UNAUTHENTICATED: signature verification failed")
GET /students signed for TENANT B but carrying A's bearer -> (401, "UNAUTHENTICATED: tenant mismatch")
```

### 4.5 Injection

**SQL.** 12 parameters × error-based and time-based payloads, through the
BFF with a live session:

```
search          212 ms      studentId       201 ms      periodStart     237 ms
limit           234 ms      sortCol         223 ms      sortDir         259 ms
page            261 ms      offset          226 ms      status          223 ms
batchId         207 ms      feeModel        201 ms      tagId           172 ms
```

No SQL error surfaced for any payload
(`' OR '1'='1`, `'; DROP TABLE students;--`, `' UNION SELECT sql FROM
sqlite_master--`, `1; WAITFOR DELAY '0:0:5'--`,
`1 AND (SELECT 1 FROM (SELECT SLEEP(5)))--`); the blind time-based payload
added no latency. A `DROP TABLE` payload was rejected outright
(`{"success":false,"error":"forbidden"}`) and the table was intact afterwards.

**CRLF / header injection.** The two client headers the BFF forwards
(`x-batch-name`, `idempotency-key`) were sent with `%0d%0a` payloads; no
`X-Injected` header appeared in the response. (Both are re-emitted through
`fetch`, whose Headers API rejects CR/LF outright.)

**Path traversal.** No user-controlled path reaches a filesystem: the only
file-ish input is the `/download?platform=` redirect parameter, and it is
compared against a fixed allowlist before being interpolated into a blob URL.

**SSTI / command injection.** No template engine and no shell invocation
exists in the web tier; the only `child_process` usage in the repo is in
build/seed scripts, not in a request path.

### 4.6 SSRF

* **Web tier:** the only server-side fetches with a request-influenced URL
  are `api.turso.tech` in the provision route (the URL is built from
  `TURSO_ORGANISATION_SLUG`, an env var — not request-controlled) and the
  gateway base URL (env). The access-request form lives on the **product
  page**, which is outside this scope.
* **Gateway tier:** F-5. The gateway dials the `X-Db-Url` the caller
  supplies:

```
=== timing: does a bogus X-Db-Url cost a real network attempt? ===
  [200]   2.39s  real db (baseline)
  [200]   2.77s  https://example.com/
  [200]   2.38s  http://169.254.169.254/
  [200]   2.28s  http://127.0.0.1:5432/
  [200]   9.58s  libsql://nonexistent-host        <-- a real DNS attempt
```

The response body is not reflected (the query result is empty), so this is a
**blind** SSRF — an outbound request to an attacker-chosen host from inside
Supabase's network — not a data-exfiltration primitive.

### 4.7 Secret / PII leakage in the client bundle

21 chunks were harvested from every route and grepped for the **actual live
values** out of `apps/web/.env.local` (printed as key names only, never
values):

```
scanning 21 chunk files for live secret VALUES
  LEAKED: NEXT_PUBLIC_SUPABASE_ANON_KEY  (value len 208)
      in: __next_static_chunks_1ffti899nk1yx.js
  LEAKED: EXPO_PUBLIC_SUPABASE_ANON_KEY  (value len 208)
  LEAKED: VITE_SUPABASE_ANON_KEY  (value len 208)
```

Only the **anon** key (a `NEXT_PUBLIC_*` value, by design — RLS is the
protection). `SUPABASE_SERVICE_ROLE_KEY`, `TURSO_API_TOKEN`,
`TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `GATEWAY_SHARED_SECRET` and
`VERCEL_OIDC_TOKEN` appear in **no** client bundle. No `.map` source maps
were served (`for every harvested chunk: EXPOSED: …` — none), and no `.env`,
`.git/config`, `next.config.js` or similar was reachable.

### 4.8 Security headers

Live `https://buddysaradhi.vercel.app/login`:

```
content-security-policy: default-src 'self'; script-src 'self' 'nonce-seBzAb9gsxZI7Z8DOWizMw==' 'strict-dynamic'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co https://*.turso.io https://*.turso.ai https://api.buddysaradhi.app; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: geolocation=(), microphone=(), camera=()
referrer-policy: strict-origin-when-cross-origin
set-cookie: buddysaradhi_ab_hero=c; Path=/; …; Secure; HttpOnly; SameSite=lax
```

`frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`,
`object-src` absent (defaults to `default-src 'self'`), COOP/CORP present,
no `X-Powered-By` (the middleware deletes it; `next.config.ts:43`
`poweredByHeader: false`). The live policy was **already** nonce-based and
`strict-dynamic` — F-1 was not a missing policy, it was a policy the document
could not satisfy.

**No CSP bypass was found.** The one avenue that could have worked — a
client-supplied `Content-Security-Policy` **request** header — is closed:
Next copies the middleware's response headers over the request headers
(`resolve-routes.js`: `req.headers[key] = value`), so the app's own policy
always wins:

```
### 2) request WITH a client-supplied Content-Security-Policy request header (nonce-MYCLIENTNONCE)
nonce-xkij5OEkGX6meS/UI3TpQQ==     <-- the middleware's nonce, not the client's
```

### 4.9 Performance (measured, not guessed)

Local production build, 5 runs each:

```
/login                       3.66s / 0.21s / 0.11s / 0.16s / 0.08s
/students                    2.03s / 0.86s / 1.31s / 1.03s / 1.24s   (87 772 B)
/dashboard                   5.41s / 4.99s / 4.98s / 5.07s / 4.71s   (64 136 B)
/api/v1/students             1.01s / 1.34s / 0.75s / 0.80s / 0.76s
/api/v1/releases/latest      0.020s × 5                            (883 B)
```

The dashboard's 4.9 s is a **waterfall**, not a timeout (the Supabase auth
read is 0.29 s; the six gateway legs sum to 6.41 s). Cold vs warm: the first
request to a route is 2–3× slower than the warm ones.

* JS weight for `/login`: **17 chunks, 1 101 139 B (1 075 KiB)** uncompressed.
* HTML weight: `/students` 87 772 B, `/fees` 81 569 B, `/attendance` 67 931 B,
  `/settings` 62 648 B, `/dashboard` 64 136 B — the RSC payload is inlined
  in the HTML, so every route ships its data twice (once as markup, once in
  the flight payload).
* Concurrency: 5 parallel `/api/v1/students` → 0.79 s, 2.46 s, 2.47 s, 2.48 s,
  2.64 s — a single instance degrades 3× under a 5-request burst.
* No unbounded query was found on a public route: `/api/v1/releases/latest`
  is a static manifest (0.02 s, 883 B).

### 4.10 Auth / session

* `assertSafeRedirectPath` (`src/server/auth-errors.ts:103`) rejected every
  off-origin payload tried (§4.1).
* The `?code=` interceptor URL-encodes the code and the `next` value before
  redirecting; the callback re-validates `next`.
* A forged `Host` header does **not** produce an open redirect — Next pins
  the origin: `Host: evil.example → location: http://localhost:3200/login?error=Invalid+magic+link`.
* Password reset does not enumerate: `requestPasswordResetAction` returns
  `{success:true}` for both an existing and a non-existing address (and
  swallows the upstream error into the same shape).

---

## 5. Verified correct — do not touch

Each of these was actively probed; a false "verified correct" is worse than a
false positive, so the command is given.

| Area | Verdict | How it was proved |
|---|---|---|
| Cross-tenant isolation (IDOR) | **Correct** | Tenant B (different `user.id`, same physical DB) gets an empty result on all 8 gateway endpoints; `not found` for A's student by id; `tenant mismatch` at the gateway when the bearer and `X-Tutor-Id` disagree |
| Client-supplied tenant/db headers | **Ignored** | `x-tutor-id`, `X-Db-Url`, `X-Db-Token`, `X-Signature`, `X-Nonce` forged → the BFF still returns the session's own tenant's data |
| SQL injection | **Not found** | 12 params × error-based + time-based payloads, no SQL error, no timing delta; a `DROP TABLE` payload was rejected with `forbidden` and the table survived |
| CRLF / header injection | **Not found** | `%0d%0a` in `x-batch-name` and `idempotency-key` produced no injected header |
| Stored XSS | **Not found** | HTML metacharacters in every student profile field are escaped in the DOM (`&lt;b&gt;bold`) and escaped in the RSC flight payload (`\u003c`), so no `</script>` breakout |
| Reflected XSS | **Not found** | `?code=`, `?next=`, `?search=`, `?q=`, `?name=` — no payload reaches the DOM; only one `dangerouslySetInnerHTML` in the app and it is a static nonce-carrying script |
| CSRF | **Not exploitable from a browser** | A real cross-origin page with the live session cookies in the jar: every request went out `cookies=no` (`SameSite=Lax`), and the JSON/`Next-Action` variants were stopped by the fail-closed preflight |
| Open redirect | **Not found** | `?next=` payloads and a forged `Host` both land on the same-origin fallback |
| Secret leakage in bundles | **Clean** | 21 chunks grepped for the live values: only the `NEXT_PUBLIC_*` anon key; no service-role key, no Turso/blob/gateway secret, no source map, no reachable `.env` |
| Account enumeration (reset) | **Correct** | `{success:true}` for both an existing and a non-existing address |
| CORS | **Fail-closed** | No `Access-Control-Allow-Origin` for a hostile origin; the `*` on `/login` etc. is Vercel's static-asset layer (already baselined) |
| Gateway mutations | **Signed** | Unsigned `POST` → 401 `signature, timestamp, and nonce required for mutations`; forged signature → 401 `signature verification failed` |
| SQL/i18n/etc. at the BFF | **Gateway-validated** | The BFF forwards query params unvalidated (F-6) but the gateway's Zod schemas rejected the malformed ones |
| TLS, HSTS, `X-Powered-By` | **Correct** | Already baselined; `poweredByHeader: false` and the middleware both keep it off |

---

## 6. Before / after (the P0, end to end)

Local **production** build, real Chromium.

**Before the fix** (build at commit `87f8b02`):

```
hydrated? reactRootKeys = 0
script tags: 30
scripts with a real nonce: 0
requestfailed count: 17
first errors:
  Loading the script 'http://127.0.0.1:3200/_next/static/chunks/2ncrqnbr-dyr7.js' violates the following Content Security Policy directive: "script-src 'self' 'nonce-dOnk/aJb8LqxP1yRkUx0yw==' 'strict-dy
after submit url: http://127.0.0.1:3200/login?
```

The same on the **live** deployment:

```
url: https://buddysaradhi.vercel.app/login
hydrated? reactRootKeys = 0
scripts w/ real nonce: 0
requestfailed (csp): 17
after submit url: https://buddysaradhi.vercel.app/login?
body: Skip to main content Welcome Back Sign in to your tuition OS Continue with Google OR Email Password Forgot password? Sign In …
cookies: buddysaradhi_ab_hero, buddysaradhi_ab_pricing_order, buddysaradhi_ab_roi_default, buddysaradhi_ab_download_order
```

No auth cookie ⇒ **the production app cannot be signed into.**

**After the fix** (local production build, rebuilt with the change):

```
# server HTML: the document's nonce IS the policy's nonce
=== /login
  header nonce : zimo9L3u/IsawLm3c06QVg==
  html nonces  : ['zimo9L3u/IsawLm3c06QVg==']
  MATCH        : True
  scripts total: 19 with nonce: 19      <-- was 30 scripts, 1 with an EMPTY nonce
```

```
# real Chromium against the same build
url: http://127.0.0.1:3200/login
CSP violations: 0 []
hydrated: {"next":"object","flight":"object","reactManaged":true,"bodyChildren":8}
script tags: 19
submit button present: 1
after submit url: http://127.0.0.1:3200/dashboard      <-- was /login?  (nothing happened)
cookies: buddysaradhi_ab_hero, …, sb-gmqwdnvbfnwpzpctwvho-auth-token.0,
         sb-gmqwdnvbfnwpzpctwvho-auth-token.1, buddysaradhi_session
body: Skip to main content T My Tuition Dashboard g 1 Students g 2 Attendance g 3 Fees & Payments g 4 Settings g 5 Sync …
```

The auth round trip in the same run:

```
RESP 200 https://gmqwdnvbfnwpzpctwvho.supabase.co/auth/v1/token?grant_type=password
   token response keys: access_token,token_type,expires_in,expires_at,refresh_token,user,weak_password
RESP 200 http://127.0.0.1:3200/dashboard
```

The build manifest agrees — the auth pages are no longer prerendered:

```
$ jq '.routes | keys' .next/prerender-manifest.json
[ "/_global-error", "/favicon.ico", "/robots.txt", "/sitemap.xml" ]
```

(Before the fix `/login`, `/signup`, `/forgot-password`, `/reset-password` and
`/signup/provision` were in that list.)

The repository's own real-browser proof, run against the same build:

```
$ CSP_PROBE_BASE_URL=http://127.0.0.1:3200 bunx vitest run src/app/csp-hydration.test.ts
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

It asserts every server script tag carries the enforced nonce, that the browser
reports **no** CSP violation, and that `window.next`, `window.__next_f` and
React's `__reactFiber$` marker are all present. It fails on the pre-fix build.

### 6.1 A governance finding that matters more than the fix

**The repository already contained this diagnosis and this regression test —
and the defect shipped to production anyway.**

`apps/web/src/app/csp-hydration.test.ts` (present in the working tree,
uncommitted, from an earlier `DYNAMIC-PERFORMANCE` audit) says, in its own
header comment:

> THE DEFECT. `apps/web/src/proxy.ts` set the Content-Security-Policy on the
> RESPONSE only. Next 16 reads the nonce from the REQUEST's CSP header while
> it renders … so Next stamped no nonce on its chunk tags — and because CSP3
> makes `'self'` IGNORED once `'strict-dynamic'` is present, the browser
> blocked every one of them.
>
> MEASURED (live, before the fix): 30 CSP violations on `/login`,
> `window.next === undefined`, `__next_f === undefined`, ZERO React fibers.
> The page downloaded ~150-230 KB gzip of JS and NEVER HYDRATED — the app was
> completely non-interactive in production.

Two things follow:

1. **That test is the right test** — a real-browser proof that every server
   script tag carries the enforced nonce, that the browser reports no
   violation, and that React actually claimed the container. **It passes now,
   with the fix applied** (`CSP_PROBE_BASE_URL=http://127.0.0.1:3200 bunx
   vitest run src/app/csp-hydration.test.ts` → `Test Files 1 passed (1)`), and
   it fails on the pre-fix build.
2. **It can never fail in CI**, because it *skips* when no app is reachable:

   ```ts
   const BASE = process.env.CSP_PROBE_BASE_URL ?? "http://127.0.0.1:3000";
   if (!reachable) { ctx.skip(`no app at ${BASE} — set CSP_PROBE_BASE_URL to run this`); return; }
   ```

   So the exact regression that shipped was invisible to the gate. **A
   regression test that skips in CI is not a gate.** Either the test must
   start a server (or target a preview deployment) in CI, or the invariant it
   protects must also be asserted by a test that needs no server — which is
   exactly what the new `auth-pages-csp.test.ts` and `proxy.csp.test.ts` are:
   they assert the *invariant* (no page the edge serves under a nonce policy
   may be prerendered; the nonce the edge mints is the nonce the renderer
   gets) with no server at all, and they go red if anyone re-adds
   `force-static` or the dot heuristic.

**One correction to the earlier diagnosis, for the record.** The earlier
comment blames "the CSP on the RESPONSE only". That is not the mechanism: Next
copies the middleware's **response** headers onto the downstream **request**
(`node_modules/next/dist/server/lib/router-utils/resolve-routes.js`:
`req.headers[key] = value` for every middleware response header), so the
response-only CSP *does* reach the renderer — which is why the dynamically
rendered 404 page carried matching nonces and worked. The real mechanism is
**prerendering**: a prerendered page is never rendered during the request, so
no nonce can be stamped on it. That distinction is the difference between the
two fixes above.

### 6.2 Concurrent changes during the engagement

While this assessment was running, **another session in the same working tree
made changes that are not mine**:

* `bun install --force --frozen-lockfile` upgraded
  `apps/web/package.json` (`next 16.2.12 → 16.3.8`,
  `vitest ^4.1.10 → ^4.1.12`) and briefly deleted the
  `@rolldown/binding-win32-x64-msvc` native binary, so vitest could not start
  a worker until it was restored from the npm tarball of the exact pinned
  version (`1.2.14`).
* `apps/web/src/server/get-db.ts` was edited (comment trimming).
* The Kali WSL distro's user database stopped resolving
  (`getpwuid(1000) failed`) part-way through, so the last probes were run from
  Windows instead of Kali.
* Two commits by that session swept up parts of this engagement's diff:
  `20fbcf2` ("docs(agents): a readable-code rule, and the comment trim that
  follows it") took `apps/web/src/proxy.ts`, and `d59a285` ("fix(ci,
  product-page): …") took `apps/web/src/lib/client-ip.ts`,
  `apps/web/src/proxy.csp.test.ts` and
  `apps/web/src/app/(auth)/auth-pages-csp.test.ts`.
  This subagent ran no `git add` / `git commit` / `git push` — the fix was
  left in the working tree, as instructed, and another session committed it
  while this assessment was running. Everything is on disk and verified in
  the state described here.

The verification in §6 was run against **Next 16.3.8**. None of those changes
is part of this engagement's diff, and none of them is in §7.

---

## 7. Files changed

```
apps/web/src/app/(auth)/login/page.tsx                       (F-1)
apps/web/src/app/(auth)/signup/page.tsx                      (F-1)
apps/web/src/app/(auth)/forgot-password/page.tsx             (F-1)
apps/web/src/app/(auth)/reset-password/page.tsx              (F-1)
apps/web/src/app/(auth)/signup/provision/page.tsx            (F-1)
apps/web/src/app/(auth)/signup/provision/provision-client.tsx (F-1, comment)
apps/web/src/app/(auth)/auth-pages-csp.test.ts               (F-1, NEW)
apps/web/src/lib/client-ip.ts                                (F-2, NEW)
apps/web/src/lib/client-ip.test.ts                           (F-2, NEW)
apps/web/src/server/rate-limit.ts                            (F-2)
apps/web/src/server/rate-limit.global.test.ts                (F-2, NEW)
apps/web/src/proxy.ts                                        (F-2, F-3)
apps/web/src/proxy.csp.test.ts                               (F-3, NEW)
docs/audit/DYNAMIC-WEB.md                                    (this report)
```

Not mine, but in the same tree during the engagement (see §6.2):
`apps/web/package.json` (a concurrent `bun install` upgrade) and
`apps/web/src/server/get-db.ts` (a concurrent comment edit). Both are
**excluded** from the diff above.

No dependency was added, no network origin was added, no telemetry was added,
no screen was added, no money handling was touched, no raw SQL was introduced,
and no `any` was introduced. `apps/gateway/**`, `packages/**`,
`apps/product-page/**`, `.github/**`, `AGENTS.md` and the already-dirty gateway
files were not touched. Nothing was committed, staged or pushed.

---

## 8. Exact commands

**Local production build (the target used for the authenticated tests)**

```bash
# from apps/web
bunx next build
bunx next start -p 3200
# reached from Kali at the Windows host:
curl -s -o /dev/null -w "%{http_code} %{time_total}\n" http://172.21.0.1:3200/login
```

**Live recon**

```bash
curl -s -D- -o /dev/null -A "Mozilla/5.0 …Chrome/120…" https://buddysaradhi.vercel.app/login
curl -s -D- --max-time 40 https://buddysaradhi.vercel.app/api/v1/releases/latest
```

**CSP / nonce**

```bash
bash csp_nonce.sh  https://buddysaradhi.vercel.app /login
bash csp_map.sh    http://172.21.0.1:3200
bash csp_raw.sh    https://buddysaradhi.vercel.app /login
bash nonce_match.sh http://172.21.0.1:3200
bash flight_escape.sh http://172.21.0.1:3200
node _audit_pw_live_csp.mjs
node _audit_pw_live_login.mjs
node _audit_pw_live_signin.mjs
node _audit_pw_prodlogin.mjs
```

**Rate limit**

```bash
bash rl.sh  http://172.21.0.1:3100
bash rl2.sh http://172.21.0.1:3100
bash rl3.sh http://172.21.0.1:3100
bash rl_live.sh
bash rl_live2.sh https://buddysaradhi.vercel.app 100
```

**Injection / IDOR / CSRF**

```bash
bash inject_battery.sh http://172.21.0.1:3200
bash csrf_openredir.sh http://172.21.0.1:3200
python3 /root/bstest/gw_auth.py
python3 /root/bstest/gw_cross_ssrf.py
python3 /root/bstest/gw_ssrf_timing.py
python3 /root/bstest/gw.py students|nosig|badsig|tenant
node _audit_pw_csrf.mjs       # hostile origin at http://172.21.12.223:8011/csrf.html
node _audit_pw_xss.mjs
```

**Bundle scan**

```bash
bash bundle_scan.sh  http://172.21.0.1:3200
bash bundle_scan2.sh http://172.21.0.1:3200
bash secret_value_scan.sh
```

**Performance**

```bash
bash perf.sh  http://172.21.0.1:3200
bash perf2.sh http://172.21.0.1:3200
bash perf3.sh http://172.21.0.1:3200
```

**Fixes — tests, negative controls, gates**

```bash
cd apps/web
bunx vitest run src/proxy.csp.test.ts
bunx vitest run src/proxy.ratelimit.test.ts
bunx vitest run src/proxy.cors.test.ts
bunx vitest run src/lib/client-ip.test.ts
bunx vitest run src/server/rate-limit.global.test.ts
bunx vitest run "src/app/(auth)/auth-pages-csp.test.ts"
bunx tsc --noEmit                 # exit 0
bun --filter web lint             # exit 0
bun run lint:oxlint               # pre-existing failures only (repo-root .tmp-hunt*.ts, not mine)
```

---

## 9. Recommended next steps (not done here)

1. **Deploy the F-1 fix and re-run the live sign-in check** — the production
   login is dead until this ships. It is the single highest-value action in
   this report.
2. **Gateway owner:** sign GETs as well as mutations (F-4); whitelist the
   `X-Db-Url` host and make a bad credential a typed error rather than an
   empty roster (F-5).
3. **Rotate and remove the live secrets from the working tree** (F-10) — a
   service-role key and a Turso token are on disk in two `.env.local` files.
4. **BFF Zod allowlist** for the forwarded query parameters (F-6).
5. **Dashboard waterfall** (F-7): parallelise the six gateway legs; target
   < 2 s.
6. **Cookie hardening** (F-8/F-9): `Secure` on `buddysaradhi_session`; a
   decision on moving sign-in to a server action so the Supabase session
   cookie can be `HttpOnly`.
