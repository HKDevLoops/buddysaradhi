# DYNAMIC-PRODUCTPAGE — product page + admin console

**Date:** 2026-10-21
**Scope:** `apps/product-page` (the marketing site at `buddysaradhi-product.vercel.app`) and its
`/admin` operations console. Design, 3D pipeline, and the live security posture of the
least-tested surface in the product.
**Author:** front-end engineer subagent (graphics/animation speciality).
**Method:** live + local dynamic testing (nmap, nikto, ffuf, sqlmap, ZAP daemon+API, Metasploit
http modules, tshark, whatweb), headless-Chromium rendering, and a pixel-level contrast
measurement harness that is now committed to the repo.

---

## 1. Executive summary

**The marketing site is public, fast, and mostly sound. The `/admin` operations console behind
it is not deployed, and the one public write endpoint is dead in production.** Both are
configuration-shaped failures, not code-shaped ones, and both are invisible from the code
alone — which is why nothing caught them.

Three things dominated this session:

1. **The funnel is broken in production and the copy says it works.** `POST /api/access-request`
   answers **503 for every request** on the live deployment. The root cause is a one-word env
   mismatch (`SUPABASE_URL` vs the deployed `NEXT_PUBLIC_SUPABASE_URL`) that leaves the store
   half-configured, which the code correctly refuses. Meanwhile `/`, `/pricing` and
   `/request-access` still promise "an administrator reads every request in the operations
   console" — and the console itself answers **503 `ADMIN_AUTH_UNCONFIGURED`** because no
   `ADMIN_EMAILS` is set. A tutor's "ask for a contracted plan" request is accepted by a form
   and then dropped. **The two highest-severity findings are both P0 and both fixed in code
   (PP-01) or fixed by one deployment command (PP-02).**

2. **The 3D hero rendered as a near-black box.** The key and fill lights were coloured with
   `--surface-raised` and `--surface-inset` — *surface* tokens, which in this palette are 11%
   and 2% grey. A three.js light's colour **multiplies** its intensity, so the key light was
   emitting 11% of a white light. The tuition hallway, the desks, the five reveal screens and
   the glass ledger card — the whole narrative — were invisible. The accent point lights were
   cut off at `distance={6}` before the first row of desks. This was a *design* defect found
   by measurement, not by eyeballing, and fixing it (DESIGN-01/02) is the single biggest
   visual change in this session.

3. **The hero copy was unreadable over the live scene, and the Poster was a flat colour
   rectangle.** The copy panel is 34% opaque, so the headline was composited over 66% of
   whatever the scene was painting: measured at **2.38:1** at beat 2 and **1.00:1** where the
   headline slid under the 30%-opaque sticky header. The no-WebGL path served a **flat
   `--canvas` rectangle** where the spec requires "a static image / static PNG", across
   **500vh of frozen content** on `/` and **600vh** on `/tour`.

**What shipped:** a real generated poster (a still of the *actual scene*, rendered
code-first, reproducible to the same SHA-256 across builds), the no-WebGL path collapsed to one
viewport, the hero copy contrast fixed and **measured** (every pairing ≥ 4.5:1 against the
live scene at every beat), a reusable procedural-asset module, a path-scoped CSP (the console
now has a nonce policy with no `'unsafe-inline'`), a same-origin gate on the public write
endpoint, `robots.txt` + `sitemap.xml`, and honest delivery copy. **9 fixes, 9 verified-red
negative controls, 74 tests, design-system `verify` green (20 palettes, 0 findings), build
green, lint green, typecheck green.**

**Two things I could not fix from here and will not pretend to have fixed:** the deployment
still needs `ADMIN_EMAILS` / `ADMIN_SESSION_SECRET` / `ADMIN_SIGNIN_PASSPHRASE` (PP-02), and
the `access_requests` table must exist in the Supabase project (PP-01b). Both are one command
each for the owner; both are spelled out in §5.

---

## 2. Severity-ranked findings

Severity: **P0** = the product loses or lies to a customer; **P1** = a real attack surface or
a broken contract; **P2** = a hardening gap or a false statement; **P3** = a nit.

| ID | SEV | file:line | What | Proof (command → output) | Fix | Status |
|---|---|---|---|---|---|---|
| **PP-01** | **P0** | `apps/product-page/src/app/admin/_lib/access-requests.ts:326-337` (was `SUPABASE_URL` only) | **The live access-request endpoint answers 503 for every request.** The store read `process.env.SUPABASE_URL`; the deployment sets `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. URL missing + key present = the *half-configured* branch = `ACCESS_REQUEST_UNCONFIGURED` → 503. The contracted-plan funnel is dead in production while the marketing copy promises a recorded request. | `curl -s -X POST https://buddysaradhi-product.vercel.app/api/access-request -H 'Content-Type: application/json' --data '{…}'` → `503 {"ok":false,"errors":{"note":"This site could not record the request right now…"}}` — **30/30 attempts, every one 503**. Env proof: `bunx vercel env ls` → `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, **no `SUPABASE_URL`**. | Read `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`; log the *name* of a missing variable server-side. | **FIXED** (code) |
| **PP-02** | **P0** | deployment env (`ADMIN_EMAILS`, `ADMIN_SESSION_SECRET`, `ADMIN_SIGNIN_PASSPHRASE` absent) | **The entire operations console is unconfigured in production.** Every admin route, and the API route the console reads, answer 503. The console's own copy on the landing page is therefore false. | `GET https://buddysaradhi-product.vercel.app/api/admin/reminders/evaluate` → `503 {"ok":false,"error":"ADMIN_AUTH_UNCONFIGURED","recovery":"Set ADMIN_EMAILS to a comma separated list of admin addresses on this deployment."}`; `bunx vercel env ls` → no `ADMIN_*` key of any kind. | Set the three env vars on the deployment. The code already fails closed and already refuses to serve a half-configured console. | **OPEN — owner action** (needs the owner's real address + a passphrase I must not invent) |
| **PP-03** | **P1** | `apps/product-page/next.config.ts:29` (was `script-src 'self' 'unsafe-inline'` on `/:path*`) | **One CSP, `unsafe-inline` included, over a site that has an authed, cookie-bearing console and a public write endpoint.** The justification comment said "zero user input, zero reflection, no cookies and no auth" — a statement that became **false** when `/admin` was added, and a stale security justification is worse than none. | Live: `GET /` → `content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; …` — identical on `/admin/login`. Proof that the marketing pages *cannot* drop it: rebuilt with `script-src 'self'` and loaded in Chromium → **12 CSP violations, `canvas:false`, `beatsNav:false`** (Next 16 inlines the RSC flight payload, whose sha256 is per-payload). | **Split the policy by path**: `next.config.ts` keeps the static policy but its `source` is now `"/((?!admin).*)"`; `/admin/*` is served by a new `src/proxy.ts` with `script-src 'self' 'nonce-…' 'strict-dynamic'` and **no `'unsafe-inline'`**. | **FIXED** |
| **PP-04** | **P1** | `apps/product-page/src/app/api/access-request/route.ts` | **The public write endpoint had no Origin check — a CSRF sink.** Next.js's built-in Origin check covers **Server Actions only**; a route handler gets nothing. Any page on the internet could make a visitor's browser write a row into the ops inbox. | Local, pre-fix: `POST /api/access-request` with `Origin: https://evil.example` → **`201 {"ok":true,"receipt":{"reference":"AR-97461D92",…}}`**. Post-fix: the same request → **403**. | New `src/lib/request-origin.ts`: a host-relative same-origin gate (Origin, else Referer, else refuse), typed 403, one message whatever the caller sent. | **FIXED** |
| **PP-05** | **P2** | (no `robots.txt` existed) | **The console was crawlable at the URL layer.** `/admin` carried `robots: {index:false}` (measured: `<meta name="robots" content="noindex, nofollow">` — honoured), but there was **no `robots.txt` at all**, and a meta tag is a request to a crawler, not a rule. | Live: `GET /robots.txt` → **404**; `GET /sitemap.xml` → **404**. | New `src/app/robots.ts` (disallows `/admin`, `/admin/`, `/api/`) and `src/app/sitemap.ts` (the five public routes), both sharing one origin resolver (`src/lib/site-origin.ts`) with `metadataBase`. | **FIXED** |
| **PP-06** | **P2** | `apps/product-page/src/app/request-access/access-request-form.tsx` | **The submitted state promised an email the product does not send.** The heading read "Received. We will reply by email." while `REQUEST_DELIVERY_NOTE` and the endpoint's own `delivery: "console"` both said mail is not connected. A tutor who is promised an email and never gets one has been lied to by the first line they read. | Source read; the endpoint's own response carries `"delivery":"console"`. | Heading is now "Received. Your request is on file." and the body names where it went. | **FIXED** |
| **PP-07** | **P2** | `apps/product-page/src/app/api/access-request/route.ts` → `src/app/admin/_lib/access-requests.ts` | **The per-IP rate limit is per-instance and in-memory, so on a serverless deployment it multiplies by the instance count.** `RATE_MAX_PER_IP = 20` is not 20 per hour in production; it is 20 per hour *per warm lambda*. The per-email window is not spoofable, so the practical exposure is 20 × (instances) per hour from one address. | Code: `const ipHits = new Map<string, number[]>()` — module state. Live impact is masked today because the endpoint 503s (PP-01). | Not changed in code (a shared limiter is a gateway concern, per `docs/design/admin-console.md`); **the in-code comments now say plainly that the window is per-instance**, and the finding is recorded here for the owner. | **OPEN — documented** |
| **PP-08** | **P2** | `apps/product-page/src/app/api/access-request/route.ts` (`clientIp`) | **The rate-limit key trusts the first `x-forwarded-for` entry**, which a client can set. The key is a bucket name, never interpolated into SQL/HTML/URL, so this is a limiter-bypass and not an injection. | Source read; `x-forwarded-for: 1.2.3.4` is honoured verbatim. | Not changed — the per-email window is the unspoofable backstop and the endpoint is 503 in production anyway. | **OPEN — documented** |
| **PP-09** | **P3** | `apps/product-page/src/app/admin/_lib/log.ts:17-19` | **The console's structured logging is off unless `ADMIN_LOG=1`, and it is not set in production.** The 503 that killed the funnel was therefore invisible in the platform logs; I had to prove it from the deployment's env list. | `bunx vercel env ls` → no `ADMIN_LOG`; the live 503 body is the only signal. | The half-configured store now logs the *name* of the missing variable when logging is on. | **PARTLY FIXED** (the log line exists; the flag is a deployment choice) |
| **PP-10** | **P3** | `apps/product-page/public/nim/tour-poster.jpg`, `public/nim/beat-hook.jpg` | **Two committed, unreferenced AI-generated images** (`nim-generate.ps1` assets) — dead weight of the exact kind this session removed. `og-image.jpg` is used (Open Graph). | `grep -rn "tour-poster\|beat-hook" apps/product-page/src` → no hits. | Not deleted: they are the owner's generated assets and deleting files I did not create is not mine to decide. | **OPEN — reported** |
| **PP-11** | **P3** | environment | **The repository's `node_modules` had been mutated outside the lockfile** (`next` 16.4.2 in the tree against a lockfile pinning 16.2.12/16.3.3), which broke `next build` with `Cannot find module '…/next/dist/bin/next'`. | `bun run build` → `Error: Cannot find module 'Z:\…\node_modules\next\dist\bin\next'`; `node_modules/next/package.json` → `"version": "16.4.2"`. | `bun install --force --frozen-lockfile` restored the tree; **`bun.lock` was reverted** (`git checkout -- bun.lock`) so no dependency change is shipped. The tree now has `next` 16.3.8 while the lockfile pins 16.2.12 — a CI install will re-pin. | **FIXED (tree)** / lockfile untouched |

### 2.1 Verified correct (not findings — things that were checked and are right)

* **The admin gate holds.** Unauthenticated navigation to `/admin`, `/admin/subscriptions`,
  `/admin/entitlements`, `/admin/requests`, `/admin/exports`, `/admin/reminders`, `/admin/audit`
  all land on `/admin/login` and **leak no console data** — the raw HTML stream contains no
  `ops@buddysaradhi.app`, no `t-0007`, no `storageQuotaMb`.
* **Server Actions are CSRF-protected by the framework.** A cross-origin POST with
  `Next-Action` is refused: *"`x-forwarded-host` header with value `127.0.0.1:3003` does not
  match `origin` header with value `evil.example` from a forwarded Server Actions request.
  Aborting the action."* (Next 16 checks `x-forwarded-host` against `Origin`.)
* **No stored XSS.** There is **no `dangerouslySetInnerHTML`, no `innerHTML`, no `eval` and no
  `new Function`** anywhere in `apps/product-page/src`. Reflected payloads are escaped by
  React: `?email=<script>alert(1)</script>` renders as `value="&lt;script&gt;alert(1)&lt;/script&gt;"`.
* **The 3D pipeline has no user-controlled loader.** `grep` for `useGLTF|useTexture|TextureLoader|
  loadAsync|useLoader` → **zero hits**. The scene is 100% procedural and seeded, so there is no
  loader SSRF and no path traversal into the asset pipeline. `fetch` appears in exactly three
  places: the gateway stats read, the Supabase REST sink, and the access-request form.
* **No `unsafe-eval` is needed.** The policy has never contained it, and three.js/R3F do not
  need it — the page hydrates and the scene renders under the shipped policy.
* **Injection surface is clean.** Control characters are rejected in the access-request fields
  (`{"name":"Line\r\nInjected: yes"}` → 422 "contains characters we cannot read").
  `sqlmap --level=3 --risk=2` on the JSON body: *"heuristic (basic) test shows that (custom) POST
  parameter 'JSON name' might not be injectable"* and an **empty results CSV** — no injectable
  parameter. On `/admin/requests?q=probe` sqlmap's first heuristic said `q` *"appears to be 'AND
  boolean-based blind' injectable"* and then **failed to confirm it**: *"GET parameter 'q' does not
  seem to be injectable… all tested parameters do not appear to be injectable."* That is a
  false positive on a page whose content changes per request; `q` is a substring filter over an
  in-memory array, and **this app has no SQL at all** — the store is PostgREST with
  parameterised filters.
* **Path traversal is closed.** `/../package.json`, `/%2e%2e/package.json`,
  `/_next/../package.json`, `/api/..%2f..%2fpackage.json` → all 404.
* **Method handling is closed.** `GET/PUT/DELETE/PATCH /api/access-request` → 405; `OPTIONS` →
  204 with `Allow: OPTIONS, POST`.
* **Session cookie hygiene.** `httpOnly`, `SameSite=Lax`, `Secure` in production, and
  **`path: "/admin"`** — it is not sent to the marketing routes.
* **TLS / transport.** Live: `strict-transport-security: max-age=63072000; includeSubDomains;
  preload`, `x-content-type-options: nosniff`, `x-frame-options: DENY`,
  `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy:
  geolocation=(), microphone=(), camera=(), interest-cohort=()`. `nikto` reported no
  server-side vulnerability, no backup files, no `.git` exposure, no directory listing.
* **No telemetry, no new origin.** `connect-src 'self' https://api.buddysaradhi.app` is the
  whole outbound list on both policies. No analytics SDK is present.
* **`robots: {index:false}` is honoured** — the live console pages emit
  `<meta name="robots" content="noindex, nofollow">`.
* **The rate limiter on the sign-in path works** (5 failures → 15-minute lock, per
  `assertSignInAllowed`), and the passphrase comparison is constant-time
  (`timingSafeEqual` over SHA-256 digests).

---

## 3. The design and asset work

### 3.1 What shipped

| # | What | How | Where |
|---|---|---|---|
| **D1** | **A real generated poster.** The no-WebGL path and the first-frame veil now show a still of the *actual scene* at beat 0, instead of a flat `--canvas` rectangle. | `scripts/generate-poster.mjs`: launches headless Chromium (ANGLE/D3D11 hardware first, SwiftShader fallback), loads the built site with `prefers-reduced-motion: reduce` (which freezes every animation, so the frame is deterministic), waits for the veil to lift, removes the DOM overlay, and screenshots **the canvas element only**. The PNG is quantised with `sharp` to fit the 20_3D §3 budget. | `apps/product-page/public/scene/hero-poster.png` — 1600×900, **125,831 bytes** (budget 204,800) |
| **D2** | **The no-WebGL path is one viewport.** The stage was always `500vh` (`/`) / `600vh` (`/tour`) — five screens of frozen content with the same copy pinned in place. Now `100dvh` on the poster path, the runway on the canvas path, from **one** pure function. | `src/lib/stage-mode.ts` `storyHeightCss()` + `resolveStageMode()`; both stages read it. | `ProductHero.tsx`, `tour-experience.tsx` |
| **D3** | **The hero copy contrast fixed and measured.** The copy panel is now opaque; the top reserve is the header's real height, so the headline can no longer slide under the sticky bar. | `.mat-copy { background: var(--surface-overlay-solid) }` (the token the design system already ships for "a surface over unknown content"), `md:pt-12` → `md:pt-[5.5rem]`. | `globals.css`, `ProductHero.tsx`, `tour-experience.tsx` |
| **D4** | **A reusable procedural-asset module.** Seeded PRNG, value noise, fBm, an SVG `feTurbulence` grain tile, vignette and aurora geometry. Deterministic, token-driven, zero network, zero image bytes. | `src/lib/procedural.ts`; used by the Poster for its grain and vignette. | `src/lib/procedural.ts` |
| **D5** | **The 3D scene actually lights up** (DESIGN-01/02) — see §3.2. | `AccentLights.tsx`, `LedgerCard.tsx`, `World.tsx`, `ProductScene.tsx` |  |

**D2, measured** (headless Chromium, `getContext` stubbed to return `null` for every WebGL
context so the device genuinely takes the poster path; viewport 1440×900):

| | before | after |
|---|---|---|
| `/` stage height, no WebGL | 4500 px (500vh) | **900 px (100dvh)** |
| `/tour` stage height, no WebGL | 5400 px (600vh) | **900 px (100dvh)** |
| `/` document height, no WebGL | 5993 px | **2393 px** |
| `<canvas>` elements, no WebGL | 1 (mounted anyway) | **0** |
| beat pins, no WebGL | rendered (they scrolled into nothing) | **not rendered** — a control whose target cannot exist is removed, not disabled |
| `/` stage height, with WebGL | 4500 px | 4500 px (unchanged) |

The poster image itself is confirmed loaded and decoded on that path
(`posterComplete: true`, `src="/_next/image?url=%2Fscene%2Fhero-poster.png&w=3840&q=75"`), and a
side-by-side screenshot of the poster path and the canvas path shows **the same picture** — the
still and the live scene are one image.

### 3.2 The scene: what was actually wrong (DESIGN-01, DESIGN-02)

The audit brief said the hero's copy composites to 1.8–2.6:1 against the animated scene. It did
not mention that **the scene itself was effectively black**. Three separate causes, all found by
rendering and looking at pixels:

1. **The lights were coloured with surface tokens.** `directionalLight color={tokens.raised}`
   (`#1C1D20` = 11% grey) and `color={tokens.inset}` (`#060709` = 2% grey). A three.js light's
   colour **multiplies** its intensity, so the key light emitted ~11% of a white light and the
   fill ~2%. The desks, the alley floor and the five reveal screens were black boxes on a black
   floor. **Fix:** the rig now uses the palette's *light-valued* roles — `--text-primary` (key),
   `--text-muted` (fill), `--text-secondary` (ambient) — plus a cool rim. No new colour, no
   hex literal: the palette's own roles, used for what they are.
2. **The accent lights died before the first desk.** `distance={6}` is a hard cutoff in
   three.js and the desks sit at z = −4…−18. **Fix:** `distance={16}` / `14`, intensities raised.
3. **The glass card was black because it transmitted black.** `transmission={1}` shows what is
   behind the card, and what was behind it was the black alley floor fading into black fog
   (`fog 8..18`). The product the whole page is about was invisible. **Fix:** `fog 16..46`;
   `attenuationColor={tokens.accent}` + `attenuationDistance` (the physically correct way to
   tint a transmissive material — the card now glows the palette's teal through its thickness);
   the material `color` moved off the near-black `--surface-row` onto the palette's lightest
   surface role; and a **lit scrim** standing up the hallway gives the glass something with
   structure to refract.

   The spec's §7.1 recipe is preserved (`transmission={1}`), and the spec's own comment on the
   `color` prop — *"so it's not invisible glass"* — is now actually true.

### 3.3 The contrast numbers, before and after

Measured with `apps/product-page/scripts/measure-hero-contrast.mjs` (committed). The method is
**not** a model: the page is painted twice — once as the visitor sees it, once with every text
run set to `color: transparent` — and the contrast is computed at the pixels the **glyphs**
actually occupy, in the browser's own compositor. So the panel's 34% alpha, its `backdrop-filter`
blur, its fresnel gradient, the button fills and the live WebGL frame are all in the number.

**Before** (`--surface-overlay` = `rgba(28 29 32 / 0.34)`, viewport 1440×900, 5 beats):

| Beat | Element | Worst backdrop | Ratio |
|---|---|---|---|
| 1 | body note (`--text-muted`) | rgb(38,40,43) | **3.95:1** ✗ |
| 2 | **H1** (`--text-primary`) | rgb(124,128,130) | **2.38:1** ✗ |
| 4 | accent link (`--accent-primary`) | rgb(76,78,81) | **3.55:1** ✗ |

Plus the headline's *first line* was rendered **underneath** the sticky header, whose own
surface is only 30% opaque — the same failure seen from a second direction.

**After** (opaque `--surface-overlay-solid` = `rgb(28 29 32)`, top reserve = the header height):

```
--- beat 1 (scroll 0%) ---   panel background rgb(28, 29, 32) (alpha 1)
PASS  5.59:1  p  "Beat 4. Reveal."
PASS  8.32:1  h1 "Five screens. Zero servers."
PASS  7.01:1  p  "Dashboard, Students, Attendance, Fees, Settings."
PASS  8.40:1  a  "Create your free account"
PASS  4.51:1  p  "Takes you to the BuddySaradhi app…"
PASS  7.16:1  a  "Ask for a contracted plan"
--- beat 2 (scroll 20%) ---  panel y=165  header bottom=66   (the panel starts BELOW the header)
PASS  8.55:1  h1 …   PASS 10.04:1  p …   PASS 8.40:1  a …   PASS 10.04:1  p …   PASS 7.16:1  a …
--- beat 3 (scroll 40%) ---  PASS 7.38:1  h1 …   PASS 5.22:1  p …   PASS 8.40:1  a …   PASS 10.04:1 …   PASS 7.16:1 …
--- beat 4 (scroll 60%) ---  PASS 6.34:1  p …   PASS 7.07:1  a …
--- beat 5 (scroll 80%) ---
PASS: every measured pairing meets 4.5:1 against the LIVE scene.
```

The same harness also reports the layout, which is how the "panel starts 95px INSIDE the header
band" defect was found and then closed (`panel y` is now always > `header bottom`).

**The marginal case worth naming:** the `--text-muted` note lands at **4.51:1** — above 4.5 but
by 0.01. That is the design system's own `overlayLegibility` contract (text roles are *solved*
against the solid twin), not an accident, and it is why the panel had to become opaque rather
than merely darker.

### 3.4 Why the poster and the live scene are the same picture

A fixed 16:9 still and a viewport that is not 16:9 are a mismatch: `object-fit: cover` crops the
poster, and if the camera keeps its 55° field of view the canvas shows a *different* slice, so
lifting the veil is a visible zoom. `resolveCoverFov()` (unit-tested) narrows the camera by
exactly the factor `cover` crops by, and `CoverCamera` applies it in a **layout effect** so the
very first drawn frame is already framed like the poster.

### 3.5 Reproducibility

The poster is **byte-reproducible**: two generations, hours apart, across two Next builds,
produced the same file —

```
sha256: 054f6152d34d9884d5242b3b3681d34714b6d6cea8e4940054c0fc4343139d33
```

— because the scene's randomness is seeded (`ParticleField`, `World` both use fixed-seed LCGs)
and the capture runs with `prefers-reduced-motion: reduce`, which freezes every animated
channel. The generator prints the SHA-256 so drift is visible in a diff. The scene is
**fully procedural**: no GLB, no HDRI, no texture fetch, no CDN asset, no stock image. The
`/nim/*.jpg` assets in the repo are AI-generated images from a different pipeline and are
**not** used by the hero (only `og-image.jpg` is referenced, for Open Graph).

---

## 4. Fixes, with their negative controls

Every fix was reverted, the guarding test was run, the test was confirmed **RED**, and the fix
was restored. The runner is committed: `node scripts/negative-controls.mjs`.

```
RED    PP-01  the access-request store reads NEXT_PUBLIC_SUPABASE_URL     Tests 1 failed | 12 passed
RED    PP-03  the static CSP does not cover /admin                        Tests 1 failed | 12 passed
RED    PP-03  the console's script-src has no 'unsafe-inline'             Tests 1 failed | 12 passed
RED    PP-04  the access-request route is same-origin gated               Tests 1 failed | 12 passed
RED    PP-05  robots.txt disallows the console                            Tests 1 failed | 12 passed
RED    PP-06  the submitted state does not promise an email               Tests 1 failed | 12 passed
RED    B2     the poster path is ONE viewport                             Tests 1 failed | 5 passed
RED    B3     the live camera frames like the poster                      Tests 2 failed | 22 passed
RED    B4     the grain tile is reproducible                               Tests 1 failed | 13 passed
PASS: every negative control went red and was restored.
```

New tests: `tests/stage-mode.test.ts`, `tests/request-origin.test.ts`, `tests/poster.test.ts`,
`tests/http-surface.test.ts`, `tests/procedural.test.ts`, plus `resolveCoverFov` cases in
`tests/scene-tiers.test.ts`. **74 tests, 6 files, all green.**

Two of the negative controls were **strengthened during the session** after they failed to go
red: the CSRF control had to remove the whole guard (not just its `if`), and the guard test had
to assert the *ordering* (`if (!verdict.allowed) return refuseCrossOrigin()` between the verdict
and the store) rather than the presence of a symbol.

---

## 5. What the owner has to do (I could not, and will not, do these)

1. **PP-02 — configure the console.** The deployment has no admin identity, so `/admin` and the
   console's API are 503 in production:
   ```bash
   cd apps/product-page
   bunx vercel env add ADMIN_EMAILS production        # comma separated; your real address
   bunx vercel env add ADMIN_SESSION_SECRET production # >= 32 chars of random material
   bunx vercel env add ADMIN_SIGNIN_PASSPHRASE production # >= 12 chars
   ```
   Until that is done, the landing page's "an administrator reads every request" is false, and
   I recommend that sentence come out of the copy until the console is configured.
2. **PP-01b — create the `access_requests` table** in the Supabase project the deployment
   points at. `src/app/admin/_lib/access-requests.ts` deliberately never runs DDL; the table
   is created out of band by the provisioning migration. I could not verify the table's
   existence because the Vercel CLI's `env pull` returns redacted placeholders for encrypted
   values, so I had no key to read with. If the table is missing, the endpoint will answer
   **503** (not 201) once PP-01's env fix lands, and that is the correct fail-closed behaviour.
3. **PP-07/PP-08 — the rate limiter is per-instance.** On a serverless deployment the "20 per
   hour per IP" window is 20 per hour *per warm instance*. Move it to the edge (the gateway
   already has a rate limiter, `apps/web/src/proxy.ts` → `rateLimitApiRequest`) when the
   entitlement backend lands.
4. **Deploy the fixes.** Everything in this document is in the working tree, not in production.
   The live site still serves the old build; `/robots.txt` and `/sitemap.xml` are still 404
   there, and the CSP is still the old single policy.

---

## 6. Commands run

**Live (authorised)**
```bash
curl -sI https://buddysaradhi-product.vercel.app/{,admin/login,admin/subscriptions,robots.txt,sitemap.xml,api/admin/reminders/evaluate,api/access-request,.env,next.config.js}
curl -s -X POST https://buddysaradhi-product.vercel.app/api/access-request -H 'Content-Type: application/json' --data '{…}'   # x30
nmap -Pn -sV -p 443 --script=http-headers,http-title,http-methods,http-server-header,http-robots.txt,http-security-headers,http-enum,http-config-backup,http-passwd,http-vhosts,http-trace,http-sitemap-generator buddysaradhi-product.vercel.app
nikto -h https://buddysaradhi-product.vercel.app -C all -timeout 10
whatweb -a 3 https://buddysaradhi-product.vercel.app/
ffuf -w /usr/share/seclists/Discovery/Web-Content/common.txt -u https://buddysaradhi-product.vercel.app/FUZZ -mc all -fc 404
```

**Local instance (the shipping build, `next start` on :3003)**
```bash
sqlmap -u http://172.21.0.1:3003/api/access-request --method=POST --data='{…}' --level=5 --risk=3 --batch --technique=BEUSTQ
zap.sh -daemon … ; /JSON/ascan/action/scan?url=… ; /JSON/core/view/alerts/
msfconsole -q -x "use auxiliary/scanner/http/{headers,methods,robots_txt,sitemap,crossdomain,ssl-certificate}; run"
tshark -i any -f "tcp port 3003" -Y "http.request" -T fields -e http.request.full_uri
```

**Repository / gates**
```bash
bun --filter product-page build          # green
bun --filter product-page lint           # green (0 errors, 0 warnings)
bun --filter product-page typecheck      # green
bun --filter @buddysaradhi/design-system verify   # 20 palettes, 0 error(s), 0 warning(s)
bunx vitest run tests/                   # 74 passed
node scripts/negative-controls.mjs       # 9/9 red
node scripts/generate-poster.mjs         # sha256 054f6152…
node scripts/measure-hero-contrast.mjs   # PASS: every pairing >= 4.5:1
```

---

## 7. Things this audit did not do

* **It did not test the `/story` route** — it lives in a different repository
  (`HKDevLoops/buddysaradhi-product`) and was out of scope by instruction.
* **It did not run a GPU-level fuzz of the R3F scene.** The 3D pipeline is fully procedural and
  takes no user-controlled URL, so the interesting surface is the DOM around it, which was
  covered.
* **It did not verify the Supabase `access_requests` table exists** (see §5.2) — the deployment's
  encrypted env values are not readable through the Vercel CLI in this environment.
* **It did not deploy.** Everything here is in the working tree.
* **It did not use `nuclei`, `httpx`, `gobuster`, `bandit` or `semgrep`** — they are not
  installed on this box and the brief says not to install them. **The owner should know these
  are missing from the toolbox**: `nuclei` in particular would have found PP-05 (missing
  `robots.txt`), PP-02 (unconfigured admin) and PP-03 (`unsafe-inline` in `script-src`) in
  seconds, and `semgrep` would have found the `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
  mismatch (PP-01) at the point of the typo. Every one of the four was found by hand here.
