# Marketing claims audit — the front door

> Implements: `docs/design/overhaul-plan.md` §4.1 (`apps/product-page/**`) on the
> Persuade surface. Research pass by the Persuade-Surface Engineer, 2026-10-03.
>
> **The rule this file exists to enforce:** a claim ships only if a primary
> source in this repository makes it true. If the source contradicts the copy, the
> source wins and the copy changes. No competitor's marketing, no plausible
> inference, no "the owner probably meant".
>
> **Citation convention.** The `source` column is always a file this audit did
> not edit — a spec, the schema, a gateway route — so the line is stable. Where a
> claim was removed, `was:` names the location in my own files by symbol; those
> line numbers will drift and are deliberately not quoted as evidence.

## Scope

Audited: `apps/product-page/src/app/page.tsx`,
`src/components/product-3d/ProductHero.tsx`, `src/app/request-access/**`,
`src/app/pricing/page.tsx`, `src/app/platforms/page.tsx`,
`src/lib/access-request.ts`.

Second pass (route-reachability, 2026-10-04) by the Front-Door Engineer:
`src/app/layout.tsx`, `src/components/product-3d/Poster.tsx`, and the three files
it added (`src/app/error.tsx`, `src/app/not-found.tsx`,
`src/components/site-nav.tsx`, `src/components/site-state.tsx`). Rows 9, 1, 39
and 40 belong to that pass.

Third pass (funnel + operator surface + accessibility, 2026-10-04) by the
Front-Door Engineer, on the files it owned: `src/app/{page,layout,loading}.tsx`,
`src/app/globals.css`, `src/app/admin/error.tsx` (new),
`src/components/product-3d/ProductHero.tsx`, `src/app/{pricing,platforms}/**`,
`src/app/request-access/**`, `src/lib/access-request.ts`. Rows 41–52 belong to
that pass, together with the resolution of §4.1 option (b) and the closings
recorded in §2 finding 5 and §4 items 5, 6 and 8.

Not audited (out of ownership): `src/app/admin/**` other than the new
`app/admin/error.tsx` — an operator surface with no visitor-facing claims. The
earlier note that the root error boundary reached `/admin` is now closed: the
console has its own boundary. `src/app/layout.tsx` footer claims were
spot-checked in the first pass and are consistent with this audit's verdict on
the same strings.

---

## 1. Findings

| # | Claim | Verdict | Source that makes it true | Change |
|---|---|---|---|---|
| 1 | The facts strip renders 9 facts, or silently 3 | **UNSUPPORTED — behaviour removed** | `apps/gateway/routes/marketing.ts:29-32` is the only source of the screen/engine counts and guarantees; `page.tsx` `getStats` returns `null` on any failure | `BASE_FACTS` now holds the 3 facts that need no server; gateway facts are additive, de-duplicated and readable ("One tutor, one database", not "single tenant sqlite"). When `stats === null` a muted line **states** that the counts and guarantees come from the live API, that it did not answer, and that unchecked facts are not shown — and, since the second pass, that `revalidate = 3600` bounds how fresh even a checked figure can be. A shorter strip is never silent. The strip also carries a visible heading, **What we can back up** (`page.tsx`, the `<h2 id="facts-heading">`): an unlabelled list of facts reads as decoration, so the section is named and the list no longer needs its own `aria-label`. |
| 2 | "Built in India" | SUPPORTED | `product/01_Product_Positioning.md:398` — committed footer copy, verbatim | kept. Not restated as "only for India" (`product/01_Product_Positioning.md:385`). |
| 3 | "No telemetry, ever" | SUPPORTED | `AGENTS.md:196` (Rule 3, AP-10); `apps/gateway/routes/marketing.ts:16`; `product/01_Product_Positioning.md:324` | kept. Also stops duplicating the gateway's `no-telemetry` guarantee in the same list. |
| 4 | "Offline first" | SUPPORTED | `apps/gateway/routes/marketing.ts:16`; `AGENTS.md` §1.2 (P5) | kept. |
| 5 | "5 screens" | SUPPORTED | `apps/gateway/routes/marketing.ts:13`; `01_Product_Principles.md:408` (P2); `AGENTS.md:131` | kept, still sourced from the API (R-17: no hardcoded counts). |
| 6 | "7 engines" | SUPPORTED | `apps/gateway/routes/marketing.ts:14`; `AGENTS.md:131` (seven engines enumerated) | kept. |
| 7 | Gateway guarantee `single-tenant-sqlite` | SUPPORTED | `AGENTS.md:127` — "Every tutor gets their own libSQL/Turso DB" | rendered as **"One tutor, one database"** — the same fact, said in the visitor's language. |
| 8 | Gateway guarantee `append-only-ledger` | SUPPORTED | `AGENTS.md:163` (Rule 1); `12_Business_Rules.md:131` (BR-LED-01) | rendered as **"Append-only ledger"**. |
| 9 | "Thirty eight students marked in thirty seconds" | **UNSUPPORTED — removed, twice over** | No in-repo benchmark supports *any* seconds-figure paired with a headcount. The spec's headline 30s is about the day's ritual (`06_Attendance.md:3`, `:21`), but its own worked example contradicts reading it as a batch: `:39` ends "Total time: 3 minutes for 32 students", and `:53` sizes a batch at 36. The fast path is `:50` (P3 two-tap rule) — one tap "Mark all Present", the next tap "Lock" | The first pass swapped 20s for the spec's 30s. The second pass found that substitution was still a number with no source, so the landing page states the **mechanism** instead: "One tap marks the batch present, the next tap locks the day, and the record is authoritative from then on" (`page.tsx`, `SCREENS` Attendance row). Sources: `06_Attendance.md:39` (the one-tap "Mark all Present"), `:50` (P3), `:11` ("a per-day lock that makes the record authoritative"). **Residual, outside this pass's ownership:** `ProductHero.tsx:48` still reads "Thirty eight students marked in thirty seconds", and `:41` uses "Thirty eight students" as scene-setting. Owner item §4.5. |
| 10 | "an institute plan, with **staff accounts** and institute-wide reporting" (`page.tsx` access panel, `was:119`) | **UNSUPPORTED — removed** | `prisma/schema.prisma:67` defines `tutors`, but there is **no `db.tutor.*` call anywhere in `apps/web/src`** — nothing creates a second tutor; the Team surface is a roadmap item behind a P2 amendment (`15_Future_Roadmap.md:503`); `01_Product_Principles.md:350` defers multi-tutor to v2; `product/01_Product_Positioning.md:70` states multi-tutor is "not yet available" pre-trigger | Removed. Replaced with what the build does have plus the honest gap (row 11–12). |
| 11 | "the dashboard reports across your whole roster" | SUPPORTED | `apps/gateway/routes/analytics.ts:5-6` — `createPrismaOrm(db, tenantId)`, tenant-scoped with no per-tutor filter, so every KPI aggregates the whole roster | kept, worded as *one tutor's roster* rather than "institute-wide", which implied cross-tutor. |
| 12 | "Staff accounts are not in the build yet." | SUPPORTED (negative claim, same sources as row 10) | as row 10 | Stated on the landing page and in `PLAN_CATALOGUE`, so a buyer comparing plans is not left to discover it after contracting. |
| 13 | Institute plan: "A coaching institute with staff to account for" / "Multi-tutor administration and institute-wide reporting" (`access-request.ts` `PLAN_CATALOGUE`, `was:49-55`) | **UNSUPPORTED — removed** | as row 10 — same false capability, in the catalogue that feeds **both** `/pricing` and `/request-access` | `audience` → an institute that wants term/storage/export agreed up front. `summary` → the prepaid period, storage quota and export terms written down first. `includes` → "Everything in Free, with no feature gate", "A stated storage quota and data export on request", "Staff accounts, not built yet". Fixing the catalogue fixed `/pricing` too. |
| 14 | Free plan: "Five screens and all seven engines" | SUPPORTED | `apps/gateway/routes/marketing.ts:13-14`; `AGENTS.md:131` | kept. |
| 15 | Free plan: "Your own encrypted database, offline first" | SUPPORTED | `AGENTS.md:277` (Rule 8, AES-256-GCM + Argon2id); `AGENTS.md:127` | kept. |
| 16 | Free plan: "Ledger and backups, no feature gate" | SUPPORTED | `12_Business_Rules.md:306` (BR-PRC-03 — no paywall in v1); `AGENTS.md:163` | kept. |
| 17 | "Free while our infrastructure stays free" | SUPPORTED | `apps/gateway/routes/marketing.ts:15`; `12_Business_Rules.md:304-305` (BR-PRC-01/02 grandfather clause); `product/06_FAQ.md:270` | kept on the landing page, hero beat 4 and the free-plan cell on `/pricing`. |
| 18 | "nothing is charged on this site and no card is ever asked for" | SUPPORTED | `docs/design/admin-console.md` §1 ("no card field, no charge, no payment provider anywhere"); `docs/design/entitlements-contract.md` §0 | kept. `/pricing` still publishes **no price figure** (row 24). |
| 19 | "An administrator will reply to {email} … then provision your access" in the submitted state (`access-request-form.tsx`, `was:98-105`) | **UNSUPPORTED — contradicted by the endpoint** | `src/app/api/access-request/route.ts:9-15` declares itself a stub and `:41` returns `delivery: "stub"`; `docs/design/entitlements-contract.md:8-10` — "Status: specified, not implemented" | Panel rewritten. The heading is now **"Recorded here, not yet sent to us."** and it states that nothing was charged and nothing was delivered, because the email step is not connected. It echoes what *was* recorded (reference, plan, period, address) instead of promising a reply. |
| 20 | "Delivery is the next piece of work" (`was:107-112`) | **UNSUPPORTED for a visitor** — internal build status | as row 19 | Removed. Engineering status is not a visitor's next step; the honest statement replaced it. |
| 21 | "no trial clock" (`request-access/page.tsx`, `was:25`) | **UNSUPPORTED — contradicted** | `docs/design/admin-console.md` §4 declares `Status: trialing \| active \| past-due \| cancelled` — a trialing state exists in the domain model | Changed to the claim that is true about the **tutor**: **"no clock on your free access"** (`FREE_PLAN_NOTE`). |
| 22 | "your free access does not lower" | SUPPORTED | `12_Business_Rules.md:305` (BR-PRC-02 grandfather); `product/06_FAQ.md:270` | kept, as the replacement for row 21. |
| 23 | "Five screens. Seven engines. One ledger. Zero servers to manage." (hero H1) | SUPPORTED | `AGENTS.md:120` — the elevator pitch, verbatim | kept. **SSR check:** this H1 is rendered by the client `ScatterTitle` with an `sr-only` reading; the landing page's own `<h2>` and the page copy remain server-rendered. Unchanged by this pass. |
| 24 | "Every fee recorded, every receipt numbered, nothing editable after the fact." | SUPPORTED | `AGENTS.md:163` (Rule 1); `01_Product_Principles.md:143` and `12_Business_Rules.md:131` (BR-RC-01 monotonic, never reused) | kept. |
| 25 | "We contract the plan, then an administrator provisions your account." (hero + `/pricing`) | SUPPORTED as the **contract**; not as today's delivery | `docs/design/admin-console.md` §1; `docs/design/entitlements-contract.md` §2 | Kept where it describes the commercial model, which is real. The `/request-access` page additionally carries `REQUEST_DELIVERY_NOTE`, and the submitted panel states the delivery gap. |
| 26 | `/platforms` web: "Every screen, every engine, the ledger and backups … writes land locally first" | SUPPORTED | `AGENTS.md:131`, `AGENTS.md:127`; `09_Backup_and_Import_Export.md` | kept. |
| 27 | `/platforms` Android: "The same five screens and the same ledger" | **UNSUPPORTED for a scaffold — reworded** | `AGENTS.md` §3.1 — "Mobile and desktop are scaffolded in v1.x … LOCKED until WEB-PROD-GATE"; §9.3 | Now: "In development on the same **design system and the same data model** … **None of those screens are finished.** No build is published yet." |
| 28 | `/platforms` macOS: "with your data in a local encrypted database" | **UNSUPPORTED for a scaffold — softened** | `AGENTS.md` §3.1; §9.3 — SQLCipher is specified (`AGENTS.md` §3.1 per-app stack) but not built | Now: "The **plan** is a desktop window over this same web app. No build is published yet." |
| 29 | "/platforms": "say so in your access request. It goes to the same person who provisions your account." | **UNSUPPORTED — delivery** | as row 19 | CTA now leads with the thing that runs (**Sign up for the free plan**, the only shipped client) and offers "Request a contracted plan" as a quiet text link. The line claims a process preference, not a delivery. |
| 30 | "See the journey" scrolls to the last beat | **not predictable** — removed | `ProductHero.tsx` `was:200-206` called `scrollToBeat(BEATS.length - 1)` — a 400vh jump behind an uninformative label | Removed from the action row. The hero panel now has **one** primary action ("Request access"); the pin nav at the bottom of the stage already navigates beats, and beat 0's body already says "Scroll to walk through it". |
| 31 | Two equal-weight CTAs in the first viewport | **rejected** | as row 30 — a visitor who has not decided cannot act, and the secondary costs nothing to skip later | `ProductHero` action row reduced to one primary. Same rule applied where it was free to do so: `/pricing` and `/platforms` demote their second CTA to the existing `.action` text-link class, and `/pricing` "Sign up for the free plan" no longer competes with "Request access" for equal weight. |
| 32 | "Sign up yourself and start today" (`page.tsx` access panel, `was:118`) | **dead affordance — no control** | `apps/web/src/app/(auth)/signup` exists; origin per `apps/product-page/src/app/layout.tsx:43` | "Sign up yourself" is now a real link. |
| 33 | "Already have access? Sign in to the app." (`page.tsx`, `was:131`) | **dead affordance — no control** | `apps/web/src/app/(auth)/login` exists | Now a real link. The origin is exported once (`APP_ORIGIN` / `APP_LOGIN_URL` / `APP_SIGNUP_URL` in `access-request.ts`) so `/`, `/pricing` and `/platforms` cannot drift into three spellings. |
| 34 | A network failure reported against the optional `note` box | **misattributed — fixed** | `access-request-form.tsx` `was:87` set `errors.note` from a `catch`, blaming a field the tutor never had to fill | `transportError` is a separate channel from `AccessRequestErrors`. Transport failure says "Your request did not reach this site. Nothing was sent and nothing was charged. Your answers are still here" and attributes itself to no input. Validation failure still counts and attributes. Both live in one `role="alert"` region with different sentences. |
| 35 | No price is published on `/pricing` | VERIFIED | `access-request.ts` types pricing as `"free-policy" \| "on-request"`; `pricing/page.tsx` `PriceOnRequest` / `PriceCell` render only "No charge", "Not applicable", or "Price on request", each with an accessible label | unchanged. No figure was added. |
| 36 | No testimonials, logos, user counts, ratings or "trusted by" | VERIFIED absent | `apps/gateway/routes/marketing.ts:1-5` states the policy: "No ratings, no tutor counts, no claims without a source — those fields do not exist until a real source does" | unchanged. The audit found none in the owned files. |
| 37 | Post-submit dead end: only "Back to plans" | **resolved** | as row 19 — with delivery unbuilt there is genuinely no record to wait on | Three ways forward from the submitted panel: **Start on the free plan** (primary, works today), **Fix the email and send again** (the correction path for a typo — honest precisely because nothing is queued, so there is nothing to cancel), and Back to plans. |
| 38 | Stated expectation after submitting | SUPPORTED | `apps/web/src/app/(auth)/signup`; `12_Business_Rules.md:305` | The expectation is stated as what is true: nothing charged, nothing delivered yet, and the free plan is available now. No invented turnaround time, because no queue exists to measure. |
| 39 | The no-WebGL fallback asserted "₹0 owed. 0 students." and "1 ledger. 5 screens." | **UNSUPPORTED — fabricated data, removed** | Neither line had a source: they are illustrative dashboard values, and this repository has no tutor whose books read zero. `20_3D_Product_Page.md` §2 requires the Poster to be a **static fallback**, not a demo — and it was shown to exactly the wrong visitor, the budget-phone / Save-Data reader this product is for. | `Poster.tsx` is now the canvas-coloured backdrop and nothing else. The proposition is already on screen once, in the DOM overlay panel (`ProductHero.tsx:191-213`), which carries the audited H1 (row 23) and the primary CTA. Deleting the Poster's own panel also removed a duplicate: on the poster path `ready` never becomes true, so `ProductHero.tsx:165` and `:182` rendered the Poster **twice**, stacked, underneath that overlay. |
| 40 | Canonical, Open Graph and every relative absolute URL resolved against `https://product-page-one-nu.vercel.app` | **UNSUPPORTED origin — corrected** | `metadataBase` was a Vercel **preview deployment** slug, so production shipped canonicals and share images pointing at a preview. A wrong `metadataBase` fails no build, which is why it survived. | `app/layout.tsx` resolves `NEXT_PUBLIC_SITE_URL`, falling back to `https://buddysaradhi.app` — the same apex `apps/web/src/app/layout.tsx:43` declares and that `apps/product-page/next.config.ts:33` corroborates by allowlisting `https://api.buddysaradhi.app`. A malformed value throws at build naming the variable rather than degrading to a guess (AGENTS.md §15 FM-06, §2 Rule 9). |
| 41 | The hero's primary action was **"Request access"** | **DEAD END — replaced** | `src/app/api/access-request/route.ts:9-15` declares itself a stub and `:41` returns `delivery: "stub"`; the only path that completes is `apps/web/src/app/(auth)/signup` | The hero panel's single primary is now **Create your free account** → `APP_SIGNUP_URL`. The request survives as the quiet text action beside it, labelled **Ask for a contracted plan** (→ `/request-access`), where `REQUEST_DELIVERY_NOTE` still states plainly that delivery is not connected. §4.1 option (b) implemented; option (a) stays open for the owner. |
| 42 | `/pricing` and `/platforms` led with "Request access" / offered sign-up as the quiet link | **inverted funnel — corrected** | as row 41. `/pricing` is the page a visitor reaches *because* they are already comparing plans, so making "wait for a person" the default cost the most there | Both closing panels now carry `Create your free account` as `btn-primary`, with the contracted-plan request as the quiet `.action` beside it. The words are exported constants (`FREE_SIGNUP_CTA`, `CONTRACTED_PLAN_CTA`, `FREE_SIGNUP_NOTE` in `src/lib/access-request.ts`) so `/`, `/pricing`, `/platforms`, the hero, the `/request-access` lede and the post-submit panel cannot drift into five spellings of one offer (clarify.md: same noun and verb for the same concept). |
| 43 | The sticky header carried `btn-primary` "Request access" | **a permanent dead end in the most persistent slot** | as row 41; the header renders on every route, including every error and 404 page | Demoted to a quiet `.action` link to the *same* primary (`Create your free account`). The surface now has exactly one `btn-primary` per viewport — the decision panel on `/`, `/pricing` and `/platforms`, the form on `/request-access` — so the sticky bar is a shortcut, not a second offer. A sticky duplicate is worse than an in-page one because it never leaves. |
| 44 | Hero beat 1: "Thirty eight students, and no single place they all live." | **UNSUPPORTED count — removed** | as row 9. No in-repo source produces a student headcount; `06_Attendance.md:53` sizes one *batch* at 36, which is a different claim about a different object | Now: "Every student somewhere, and no single place they all live." An unsourced number is the same defect class as the thirty-second benchmark, and it did not survive only because it was small. This closes §4 item 5. |
| 45 | `APP_ORIGIN` was a literal in two files (`app/layout.tsx:90` and `lib/access-request.ts:32`, pre-pass) | **drift risk — one owner** | The value is not a guess: `apps/web/src/proxy.ts:17` (`NEXT_PUBLIC_APP_URL`), allowlisted as an origin at `apps/web/src/proxy.ts:23`, and repeated at `apps/web/src/app/api/v1/[...slug]/route.ts:323` | `src/lib/access-request.ts` is the single owner, with that provenance in the comment above the constant. `app/layout.tsx` imports `APP_LOGIN_URL` / `APP_SIGNUP_URL` and holds no literal. Neither `tsc` nor the build fails on a wrong host (AGENTS.md §15 FM-06), which is exactly why a duplicate survived. |
| 46 | No skip link anywhere on the front door | **WCAG 2.4.1 — added** | The cost was measurable here: the landing route opens with a 500vh pinned story section, so the distance from the document top to the decision content is a full screen of scroll plus whatever a keyboard visitor reads in the chrome | `app/layout.tsx` gains a skip link as the first child of `<body>` (so it is the first tab stop), off-screen until `:focus`, then a 44px target on the opaque overlay surface, targeting `#main`. Matches the approach `apps/web/src/app/layout.tsx:137` took in the same pass; that file was read, not edited. |
| 47 | `/#screens` (primary nav) scrolled its heading **under** the sticky header | **broken target — corrected** | The header is `.mat-nav` with `min-h-16` (`app/layout.tsx:141`) and `position: sticky` (`globals.css` `.mat-nav`); nothing in the cascade reserved space for it | `scroll-padding-top: 4.75rem` on the scroll container in `globals.css`, plus `:target { scroll-margin-top }` as a belt. The container form is the robust one: it covers every in-page anchor from any source — the nav, the hero's way past the story, a typed `#hash`, a link inside a component no CSS rule knows about — where per-target `scroll-margin` only fixes the targets someone remembered to annotate. |
| 48 | The hero re-keyed its `<h1>` per beat and announced nothing | **silent — fixed** | `ProductHero.tsx` `ScatterTitle` re-keys on every beat; the per-character spans are `aria-hidden` and the `sr-only` copy is inside a node the listener never re-reads | One polite, atomic live region in the stage announces `Story step N of 5. <pin>.` on every beat change, and separately announces the canvas state: probing, data saver, no WebGL, loading, reduced motion, lite scene, ready. Each sentence is standalone because a listener hears it once with no context. `sr-only`, never `display:none` — a hidden live region is not announced. |
| 49 | The 500vh story had **no way past it** | **conversion control missing — added** | `20_3D_Product_Page.md` pins the stage for five beats; the earlier pass removed the "See the journey" button as unpredictable (row 30) and nothing replaced it | A real `href="#access"` link at the bottom of the stage: **Skip the story and go to the free plan**. An anchor, not a `window.scrollTo` button, so it needs no JavaScript, is keyboard-reachable as a link, honours `prefers-reduced-motion` (globals.css collapses `scroll-behavior`), and lands clear of the header via row 47. It is always rendered — *not* inside the `!showPoster`-gated pin row — because the poster path (no WebGL, or Save-Data) is the path a budget phone takes, and that is the one with no pins to press. `#access` carries `tabIndex={-1}` so the fragment has somewhere to put focus. |
| 50 | No `app/loading.tsx` | **added** | Bundled docs, `next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`: a Server Component, no parameters, auto-wrapped in a Suspense boundary around this segment's `page.js` / `not-found.js` / nested layouts, and the fallback is prefetched so it usually never shows | Honest about the real operation: one heading, one sentence, no skeleton shaped like content, no invented progress or duration (craft-floor.md refuses both). `role="status"`, not `alert` — a wait is not a failure. Copy is deliberately surface-neutral because a root `loading.tsx` also covers `/admin/**`. |
| 51 | The **root** `app/error.tsx` wrapped `/admin` | **wrong vocabulary for an operator — fixed** | `app/admin/layout.tsx` is a nested layout (a `.adm-root` `<div>`, not a second `<html>`), so the root boundary catches console throws; `docs/design/admin-console.md` §2 — an admin can control infrastructure but can never read a customer's data; §3 — the console fails closed on an unconfigured secret | New `src/app/admin/error.tsx`: a Client Component (the one Next requires) taking `unstable_retry`, rendering the console's own `.adm-*` vocabulary with a labelled `role="alert"`, `adm-standalone` to span the grid, a Retry and a Sign in again, the digest, and the two env vars an operator should check. It imports nothing from the marketing surface, surfaces no tenant data, and does not log (`console.*` is forbidden; the console's logger is `ADMIN_LOG`-gated). Closes §2 finding 5. |
| 52 | Focus ring was invisible on the surface's own primary button | **non-text contrast — fixed** | `globals.css` drew a 2px `var(--border-focus)` ring; `packages/design-system/tokens.css:21` resolves that to `#009494` in the `inked` palette, and `.btn-primary` paints `--accent-primary` right next to it | `:focus-visible` keeps the ring and adds a 5px `var(--canvas)` halo, so the ring separates from an accent fill, an accent text link or the open canvas alike. No focusable element in this stylesheet carries a box-shadow, so nothing loses an elevation; the `forced-colors` fallback already suppresses the halo and keeps the outline. |

---

## 1b. Rows that are not claims, but were defects of the same kind

These are recorded here rather than as findings rows because no marketing copy
was at fault; each was a copy or control that pointed somewhere a visitor could
not follow, and the same rule (a primary source must make it true) applies.

1. **Two names for one destination.** The nav and footer said "Request access"
   while the hero said "Request access" and `/request-access` promised
   "Request access"; the request page's `<h1>` was "Request access." and the
   words used to reach it are now "Ask for a contracted plan". The page heading
   was changed to match the words that lead to it, so link text and destination
   say the same thing.
2. **`NO_CHECKOUT_NOTE` led with the slow path.** It read "There is no checkout
   on this site. Request access, we contract the plan…", which made the request
   the only route a reader could see. Now: "There is no checkout on this site
   and no card is ever asked for. A contracted plan is agreed with you
   directly…" — the commercial model is unchanged, the funnel is not implied.
3. **The post-submit primary was a fourth spelling.** The submitted panel's
   button read "Start on the free plan" while the rest of the site would say
   "Create your free account". It now uses the shared constant; the panel's own
   honest sentences about the unbuilt delivery step are untouched (row 19).
4. **`/pricing`'s third definition-list term** was "What happens after you ask",
   a question that only made sense if asking was the main event. It is now "What
   happens if you ask for a contracted plan".


## 2. Negative findings worth recording

1. **The front door's primary action was a stub.** `POST /api/access-request`
   validates and returns a receipt; nothing is persisted and nothing is
   delivered. The third pass made free self-serve sign-up the primary on `/`,
   `/pricing` and `/platforms` and demoted the request to the quiet action
   (rows 41–43), which removes the dead end from the funnel — but it does not
   remove the endpoint. **The honest fix is still to connect it** (mail, or an
   `access_request` table per `entitlements-contract.md` §2). **Owner decision,
   see §4.1; option (a) remains open.**
2. **`tutors` is a schema table with no code.** `prisma/schema.prisma:67` models
   it and `11_Data_Model.md:144` documents it, but no application path writes to
   it. A table that exists without a feature is exactly how a marketing claim
   grows a life of its own — this audit removed three copy surfaces that were
   reading the schema instead of the build.
3. **`app/globals.css` already ships an `.action` class** for quiet text actions
   (`globals.css:192`, "Quiet actions are text, not buttons"). The primary/secondary
   fixes use the class that was already there rather than inventing a variant.
4. **The primary nav was unreachable below 768px.** Not a claim, so it is recorded
   here rather than as a row: `app/layout.tsx` rendered all three nav links with
   `hidden text-sm md:inline`, so on a phone — this product's primary audience —
   Pricing, Platforms and Screens had no route from the header, and the footer
   carries two of the three a full scroll away. Now `components/site-nav.tsx`
   renders a disclosure below `md` from the **same** `NAV_LINKS` array as the
   desktop row, so the two widths cannot drift and one array entry reaches both.
5. **`app/error.tsx` also covers `/admin`. — RESOLVED in the third pass.**
   `app/admin/layout.tsx` is a nested layout (a `<div>` carrying the palette
   attributes, not a second `<html>`), so the root boundary used to wrap the
   operations console too and an admin failure rendered marketing recovery copy
   with a link back to the plans. `src/app/admin/error.tsx` now sits inside the
   admin segment and speaks the console's own vocabulary (row 51).
6. **ESLint and the Impeccable detector are both blind on this surface.** Re-run
   on this pass: `eslint` over seven `.tsx` files in this app returned "File
   ignored because no matching configuration was supplied" for every one — the
   flat config declares no `files` matcher (AGENTS.md §15 FM-17). `tsc --noEmit`
   is the only gate that actually reads these files.

## 3. Gate

```
cd apps/product-page; ..\..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
→ tsc exit=0
```

Re-run after the route-reachability pass, across the seven files it touched
(`app/layout.tsx`, `app/page.tsx`, `app/error.tsx`, `app/not-found.tsx`,
`components/site-nav.tsx`, `components/site-state.tsx`,
`components/product-3d/Poster.tsx`): zero errors.

Re-run after the funnel / operator / accessibility pass, across the twelve files
it touched or added (`app/layout.tsx`, `app/page.tsx`, `app/loading.tsx`,
`app/globals.css`, `app/admin/error.tsx`, `app/pricing/page.tsx`,
`app/platforms/page.tsx`, `app/request-access/page.tsx`,
`app/request-access/access-request-form.tsx`,
`components/product-3d/ProductHero.tsx`, `lib/access-request.ts`): zero errors.
This is the only gate that reads these files — see §2 finding 6.

`export const dynamic = "force-static"` and `export const revalidate = 3600`
survive unchanged on the landing route, and `cacheComponents` is **not** enabled
in `apps/product-page/next.config.ts`, so both options remain valid under the
Next.js 16 caching model (route-segment-config docs, v16.0.0 history note).

The Impeccable detector returns `[]` for these targets. On a non-`.html` target
every rule routes through the regex engine, so an empty result is expected and is
**not** evidence of a clean pass — see the known coverage limit on
`detect.mjs`. The manual craft-floor pass was done by reading each state. ESLint
is not a second opinion here either: see §2 finding 6.

The two new dead-end surfaces follow the bundled Next 16 shape —
`app/error.tsx` is a Client Component taking `unstable_retry` (v16.2.0 renamed
it from `reset`, which only clears the boundary without re-fetching), and the root
`app/not-found.tsx` is what serves unmatched URLs app-wide (v13.3.0), so one file
covers every dead link and it renders inside the root layout with the product's
own palette rather than the built-in 404's OS colour scheme. The third pass added
the two surfaces that were still missing from the same set — `app/loading.tsx`
(a Server Component, no parameters, auto-wrapped in Suspense around `page.js` and
`not-found.js` but not the layout or the error boundary) and
`app/admin/error.tsx` (a Client Component, for the reason `error.tsx` is one).

## 4. For the owner

1. **Connect `/api/access-request`, or accept the new funnel.**
   The third pass implemented **option (b)**: free self-serve sign-up is the
   primary action on `/`, `/pricing` and `/platforms`, and "Ask for a contracted
   plan" is the quiet action beside it. That is a design decision this pass was
   authorised to take; the commercial one is still yours, and **option (a) —
   build the `access_request` table + mail per `entitlements-contract.md` §2,
   then restore a single primary CTA on `/` — remains open.** Until one of the two
   happens, the honest cost is a form that records a reference and a person
   waiting. If (a) ships, `access-request-form.tsx` `sentCopy` will fail `tsc`
   until the `delivery` union is widened and the new branch is written
   (item 4 below); that is deliberate.
2. **Plan ids and prices.** `entitlements-contract.md` §7 lists `free | solo |
   batch | institute` as placeholders. `/pricing` publishes no figure by
   instruction. It needs the real list.
3. **The Institute plan needs a reason to exist.** With staff accounts out of the
   copy, it currently differs from Free by a prepaid term and a storage quota —
   which `12_Business_Rules.md:306` (BR-PRC-03) says must not be a feature gate
   anyway. That is a thin tier.
4. **Rebuild `sentCopy` when delivery lands.**
   `access-request-form.tsx` `sentCopy` throws on any `delivery` value other than
   `"stub"`, so `tsc` will fail the build until the real branch is written. That
   is deliberate: the submitted state cannot be shipped with a missing sentence.
5. ~~**`ProductHero.tsx` still carries the thirty-second claim**~~ — **CLOSED.**
   Both the benchmark and the "Thirty eight students" scene-setting count are
   gone (rows 9 and 44). The file was in the third pass's ownership.
6. ~~**The hero's pin nav is inert without WebGL**~~ — **CLOSED.** The pins are
   now gated on `!showPoster` and the way past the story is rendered on both
   paths (row 49). The pins themselves are unchanged, and they still compute
   their targets from `offsetTop + offsetHeight * index / 5`; the gate, not the
   arithmetic, is what makes them honest.
7. **`next` version drift.** `apps/product-page/package.json:19` pins
   `"next": "16.3.3"`; the installed tree resolves 16.2.12. `error.tsx` and the
   new `admin/error.tsx` use `unstable_retry`, present since 16.2.0 per the
   bundled version history, so both are correct either way — but the pin and the
   install disagree, and `pnpm install` was out of scope here.
8. **~~No `loading.tsx`~~ — CLOSED; `no global-error.tsx` — still open.**
   `app/loading.tsx` exists (row 50). `global-error.tsx` is still absent by
   design: it would cover a throw in the **root** layout, and `resolveSiteOrigin`
   is exactly such a throw — deliberately, per row 40. The build should fail on a
   bad `NEXT_PUBLIC_SITE_URL`; a global error page is the belt to that braces,
   not the braces. Say the word if you want the belt.
9. **The story is still 500vh on the poster path.** With no WebGL, or with
   Save-Data on, the beats never advance, so the pinned stage holds one panel
   for 500vh — now with a visible way past it (row 49) instead of no exit, but
   still four screens of the same panel. Collapsing the section to `100vh` on
   that path would remove the dead scroll outright, and the third pass did not do
   it because it changes committed 3D behaviour (`20_3D_Product_Page.md`) and no
   brief asked for it. One line, your call.
10. **`app/loading.tsx` also covers `/admin`.** The copy is deliberately neutral
    for that reason and `/admin` is `force-dynamic` and quick, so in practice it
    shows for the marketing routes only. If the console ever grows a slow
    segment, give it its own `app/admin/loading.tsx` in the console's
    vocabulary rather than letting the marketing wait state appear inside it.