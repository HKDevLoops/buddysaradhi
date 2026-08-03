# 01 — Architecture (Next.js 16 App Router)

> The structural spec for the Buddysaradhi web surface. Every file path, every route group, every RSC/Client boundary, every `next.config.ts` knob, and every bundle-budget number in this document is the contract the implementation must meet. When in doubt, the spec wins (top-level `AGENTS.md` §0).

---

## 1. Why Next.js 16

Buddysaradhi web is built on **Next.js 16** with the **App Router**. The choice is not arbitrary — five framework features load-bear the architecture, and each maps to a Buddysaradhi principle.

### 1.1 React Server Components (RSC)

Server Components let us read the per-user Turso DB on the server, render the full HTML for `/dashboard` or `/students/[id]`, and ship zero DB driver code to the browser. This is the single largest lever on the bundle budget (§9). The cosmic canvas, glass panels, and accent tokens are all CSS — they cost nothing on the wire. The data behind a KPI card is fetched on the server, not in a `useEffect` waterfall.

RSC also enforces the **no-telemetry** rule structurally (top-level `AGENTS.md` Rule 3): a Server Component cannot import `mixpanel` or `posthog` and accidentally bundle them into the client. Anything that runs in the browser is opt-in via the `"use client"` directive, which makes the audit surface small.

### 1.2 Server Actions

Mutations (`recordPayment`, `markAttendance`, `voidReceipt`, `createBackup`) are Server Actions — `'use server'` functions invoked over an RPC POST. The browser never sees the Supabase service-role key, the Turso platform token, or the encryption key. The mutation contract is the function signature plus a Zod schema; the client calls `startTransition(() => action(parsed))` and gets a typed `Result<T, E>` back.

Server Actions are the **only** legitimate way for a Client island to mutate state. Direct `fetch('/api/...')` from a Client Component is a lint error (`no-fetch-in-client`, top-level `AGENTS.md` §6.4, FM-05). The `/api/*` route handlers exist for non-React callers (Tauri updater, EAS webhook) and for the existing `/api/spec` reader — they are not the primary mutation path.

### 1.3 Turbopack

`next dev --turbopack` is the dev bundler. Cold start < 1s on the sandbox; HMR < 100ms for component-only edits. The sandbox `package.json` `dev` script pipes through `tee dev.log` so the worklog scan (top-level `AGENTS.md` §16 step 5) can grep for `Error|Warning|Hydration|Suspense|did not match`.

### 1.4 Partial Prerendering (PPR)

Marketing pages (`/`, `/login`, `/signup`, `/download`) are statically prerendered at build time with a `Suspense` boundary around the per-user bits (the "Logged in as" pill in the topbar). The shell of the page ships from the Vercel Edge cache; only the dynamic fragment streams in. PPR is enabled via `experimental.ppr: true` in `next.config.ts` (§7).

### 1.5 App Router Route Groups

Route groups `(marketing)`, `(app)`, `(auth)` let us apply different layouts (and different middleware branches) without polluting the URL. `/` is in `(marketing)`, `/dashboard` is in `(app)`, `/login` is in `(auth)`. The 5-screen rule (P2) is enforced at the route-group level: only `(app)` may host user-facing app routes, and only the 5 named routes may live there.

---

## 2. Project Layout

```
src/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx                  # Landing (current /src/app/page.tsx)
│   │   ├── layout.tsx                # Marketing shell (no sidebar)
│   │   └── download/page.tsx         # /download (public)
│   ├── (auth)/
│   │   ├── login/page.tsx            # Supabase email + OTP
│   │   ├── signup/page.tsx
│   │   ├── verify/page.tsx           # OTP confirmation
│   │   ├── layout.tsx                # Centered glass card
│   │   └── callback/route.ts         # OAuth redirect target
│   ├── (app)/
│   │   ├── dashboard/page.tsx        # RSC — fetches KPIs
│   │   ├── students/
│   │   │   ├── page.tsx              # RSC — paginated list
│   │   │   └── [id]/page.tsx         # RSC — detail drawer
│   │   ├── attendance/page.tsx       # RSC — date picker + batch grid
│   │   ├── fees/page.tsx             # RSC — paid/unpaid/partial matrix
│   │   ├── settings/page.tsx         # RSC — tabbed settings
│   │   └── layout.tsx                # GlassShell — sidebar + topbar + footer
│   ├── api/
│   │   ├── spec/route.ts             # Existing — allowlist reader
│   │   ├── provision/route.ts        # POST — Turso DB provisioning
│   │   ├── students/route.ts         # GET (list), POST (create)
│   │   ├── students/[id]/route.ts    # PATCH (update)
│   │   ├── ledger/route.ts           # GET (list, immutable)
│   │   ├── ledger/record-payment/route.ts  # POST (append-only, BR-LED-06)
│   │   ├── ledger/void/route.ts      # POST (compensating entry, BR-LED-07)
│   │   ├── attendance/mark/route.ts  # POST (BR-ATT-*)
│   │   ├── reports/[type]/route.ts   # GET — CSV/PDF
│   │   ├── backup/create/route.ts    # POST — encrypted .buddysaradhi
│   │   └── backup/restore/route.ts   # POST — passphrase verify + restore
│   ├── layout.tsx                    # Root layout (fonts, Toaster)
│   └── globals.css                   # Tailwind 4 @theme + glass utilities
├── components/
│   ├── ui/                           # shadcn/ui primitives (already vendored)
│   └── buddysaradhi/                      # Buddysaradhi-specific composites
│       ├── data.ts                   # ACCENT_MAP, SPECS, SCREENS, ENGINES
│       ├── primitives.tsx            # useMounted, SectionTag, NeumoToggle, CountUp
│       ├── glass-shell.tsx           # Sidebar + topbar + footer (web shell)
│       ├── dashboard-prototype.tsx   # Existing demo
│       ├── students-prototype.tsx    # Existing demo
│       ├── attendance-prototype.tsx  # Existing demo
│       ├── fees-ledger-prototype.tsx # Existing demo
│       ├── settings-prototype.tsx    # Existing demo
│       ├── backup-prototype.tsx      # Existing demo
│       ├── spec-reader.tsx           # Existing
│       ├── command-palette.tsx       # ⌘K palette
│       └── ...
├── hooks/
│   ├── use-toast.ts                  # Existing
│   ├── use-mobile.ts                 # Existing
│   ├── use-mounted.ts                # Re-export from primitives
│   ├── use-turso-client.ts           # Per-user libSQL client (client-side)
│   └── use-sync-poll.ts              # 30-second libSQL HTTP polling
├── lib/
│   ├── utils.ts                      # cn(), formatINR(), formatINRFromPaise()
│   ├── db.ts                         # Existing Prisma client (sandbox dev DB)
│   ├── supabase/
│   │   ├── server.ts                 # createServerClient via cookies()
│   │   ├── client.ts                 # createBrowserClient
│   │   └── middleware.ts             # refresh session, refresh scope JWT
│   ├── turso/
│   │   ├── server.ts                 # server-side libSQL client from JWT
│   │   └── client.ts                 # client-side libSQL HTTP client from JWT
│   └── crypto/
│       ├── backup.ts                 # AES-256-GCM + Argon2id envelope
│       └── paise.ts                  # integer-paise arithmetic (paiseAdd, paiseMul)
├── server/
│   ├── schemas/                      # Zod schemas (single source of truth)
│   │   ├── student.ts
│   │   ├── ledger.ts
│   │   ├── attendance.ts
│   │   ├── backup.ts
│   │   └── provision.ts
│   ├── actions/                      # 'use server' functions
│   │   ├── students.ts
│   │   ├── ledger.ts
│   │   ├── attendance.ts
│   │   └── backup.ts
│   ├── queries/                      # RSC data fetchers (server-only)
│   │   ├── dashboard.ts
│   │   ├── students.ts
│   │   └── fees.ts
│   ├── rate-limit.ts                 # Token-bucket per IP
│   └── provision.ts                  # Turso platform API call
├── stores/                           # Zustand stores (client UI state)
│   ├── dashboard.ts
│   ├── students.ts
│   ├── attendance.ts
│   ├── fees.ts
│   └── settings.ts
└── middleware.ts                     # Supabase session refresh + locale
```

Cross-references: the file map in top-level `AGENTS.md` §3 uses `apps/web/...`; this sandbox uses `src/...` because it is a single-app monorepo. The layout above is the sandbox translation; the production layout (post-v1.x) moves everything under `apps/web/src/`.

---

## 3. Route Groups in Detail

### 3.0 Route-Group Tree (URL → Component → Glass/Neumo)

```
src/app/
│
├── (marketing)/                         ← NO auth, PPR, no GlassShell
│   ├── layout.tsx                       MarketingLayout (RSC)
│   │                                    ↑ glass-faint footer (sticky, §5.5 §13)
│   │                                    ↑ marketing nav = transparent + ghost CTAs
│   ├── page.tsx                         /  (the commercial landing)
│   ├── pricing/page.tsx                 /pricing
│   ├── faq/page.tsx                     /faq
│   ├── download/page.tsx                /download  (public)
│   ├── changelog/[version]/page.tsx     /changelog/1.4.0
│   ├── opengraph-image.tsx              /opengraph-image  (Edge runtime, build-time)
│   ├── sitemap.ts / robots.ts           metadata routes
│   └── (sections)/                      private folder — loading/error/not-found
│       ↑ surfaces in here:
│         • hero card          = .glass            over cosmic gradient  (§5.5)
│         • feature card       = .glass + accent L-border (emerald/cyan)  (§5.4)
│         • pricing card       = .glass; featured = .glass-strong + emerald glow
│         • download card      = .glass                                                (§5.5)
│         • FAQ accordion row  = .glass-faint band                                    (§8.4)
│         • CTA buttons         = .neumo-raised; primary + emerald glow               (§6.6 §8.2)
│         • search bar (FAQ)    = .neumo-inset                                         (§6.6 §8.10)
│
├── (auth)/                              ← NO auth required (or session-only)
│   ├── layout.tsx                       AuthLayout (RSC)
│   │                                    ↑ single centered .glass-strong card
│   │                                      + backdrop bg-black/60 + blur-sm     (§5.5 §8.7)
│   ├── login/page.tsx                   /login
│   ├── signup/page.tsx                  /signup
│   ├── verify/page.tsx                  /verify  (OTP input)
│   ├── signup/provision/page.tsx        /signup/provision  (spinner)
│   └── callback/route.ts                /callback  (OAuth code exchange)
│       ↑ controls in here:
│         • OTP input wells    = .neumo-inset                                          (§6.6 §8.9)
│         • submit buttons     = .neumo-raised; primary + emerald glow                (§6.6 §8.2)
│         • Google OAuth btn   = .neumo-raised (no glow; transparent bg)
│
├── (app)/                               ← auth + provisioned required
│   ├── layout.tsx                       GlassShell (Client island — sidebar state)
│   │                                    ↑ sidebar = .glass-strong sticky            (§5.5)
│   │                                    ↑ topbar  = .glass-strong sticky             (§5.5)
│   │                                    ↑ footer  = .glass-faint sticky              (§5.5 §13)
│   ├── dashboard/page.tsx               /dashboard  (RSC — KPIs + feed + heatmap)
│   ├── students/
│   │   ├── page.tsx                     /students   (RSC — paginated list)
│   │   └── [id]/page.tsx                /students/[id]  (RSC — detail drawer)
│   ├── attendance/page.tsx              /attendance  (RSC — batch grid)
│   ├── fees/page.tsx                    /fees        (RSC — paid/unpaid matrix)
│   └── settings/page.tsx                /settings    (RSC — tabbed)
│       ↑ surfaces in here:
│         • KPI card           = .glass + accent L-border (emerald/amber/flare)        (§5.4 §8.1)
│         • list/table row     = .glass-faint band                                     (§5.5 §8.4)
│         • drawer / sheet     = .glass-strong                                          (§5.5 §8.7)
│         • modal              = .glass-strong + backdrop                              (§5.5 §8.7)
│         • toast              = .glass-strong + 4px accent bar                        (§5.5 §8.8)
│       ↑ controls in here:
│         • primary buttons    = .neumo-raised                                         (§6.6 §8.2)
│         • search bar (topbar)= .neumo-inset                                           (§6.6 §8.10)
│         • input fields       = .neumo-inset                                           (§6.6 §8.9)
│         • toggle (PIN/lock)  = .neumo-inset + raised knob                            (§6.4 §8.16)
│         • segmented control  = .neumo-inset well + .neumo-raised pill                (§6.6 §8.5)
│         • stepper (page-size)= .neumo-inset well + .neumo-raised ± buttons           (§6.6 §8.18)
│
├── api/                                 ← server-only; no glass / neumo
│   ├── spec/route.ts                    GET (existing allowlist reader)
│   ├── provision/route.ts               POST (Turso DB provisioning)
│   ├── students/route.ts                GET (list), POST (create)
│   ├── students/[id]/route.ts           PATCH (update)
│   ├── ledger/route.ts                  GET (list, immutable)
│   ├── ledger/record-payment/route.ts   POST (append-only, BR-LED-06)
│   ├── ledger/void/route.ts             POST (compensating entry, BR-LED-07)
│   ├── attendance/mark/route.ts         POST (BR-ATT-*)
│   ├── reports/[type]/route.ts          GET (CSV/PDF)
│   ├── backup/create/route.ts           POST (encrypted .buddysaradhi)
│   ├── backup/restore/route.ts          POST (passphrase verify + restore)
│   ├── releases/latest/route.ts         GET (Vercel Blob manifest merge)
│   ├── sync/pull/route.ts               POST (30-second poll delta)
│   ├── cron/rotate-tokens/route.ts      GET (CRON_SECRET gated)
│   ├── cron/alerts-check/route.ts       GET (CRON_SECRET gated)
│   └── cron/post-deploy-smoke/route.ts  GET (production-only)
│
├── layout.tsx                           RootLayout (fonts, Toaster, Providers)
└── globals.css                          Tailwind 4 @theme + .glass / .neumo-* utilities
```

The tree is the single source of truth for "what renders where". Every leaf carries its glass tier (per `13_UI_Guidelines.md` §5.5) or its neumorphic recipe (per §6.6). A leaf that carries neither is server-only (`/api/*`) — it has no UI surface. The three route groups never share a layout; the GlassShell lives only under `(app)`, the centered glass card lives only under `(auth)`, and the marketing shell lives only under `(marketing)`.

### 3.1 `(marketing)` — public, prerendered, no shell

- **Pages:** `/`, `/pricing`, `/faq`, `/download`, `/changelog`, `/changelog/[version]`, `/demo/{screen}` (read-only prototype surface). The full route tree is in `07_Landing_Page.md §2`.
- **Layout:** `marketing/layout.tsx` — minimal: `<header>` with logo + "Sign in" pill, `<main>{children}</main>`, `<footer>` (sticky per top-level `AGENTS.md` §6.3). The footer is shared across every marketing route.
- **Rendering:** Static prerender with PPR. The "Sign in / Open app" pill is a `<Suspense>` boundary reading the Supabase session. The Download Hub's live version number is a second `<Suspense>` hole fed by an ISR-cached fetch to `/api/releases/latest` (`07_Landing_Page.md §2.1`, `§6`).
- **Bundle:** ≤ 90 KB JS first load. No TanStack Query, no Zustand, no libSQL, no Recharts. Just Framer Motion (tree-shaken) + Radix primitives + `fuse.js` (FAQ search) + `qrcode.react` (lazy). The landing-page bundle target is tighter still — ≤ 80 KB — because the marketing surface ships none of the app-surface libraries (`07_Landing_Page.md §3`, `§9.6`).
- **Content source:** The marketing copy (hero headline, FAQ items, pricing tiers, download-card descriptions) is authored in the `product/` directory — `product/02_Hero_and_Above_the_Fold.md`, `product/04_Download_Hub.md`, `product/05_Pricing_and_Plans.md`, `product/06_FAQ.md`. A pre-build codegen step (`scripts/sync-product-content.ts`) emits typed modules in `src/content/marketing/*.ts` that the RSC imports. The runtime has zero knowledge of `product/`. See `07_Landing_Page.md §3.2` for the data flow.

### 3.2 `(auth)` — centered glass card, no sidebar

- **Pages:** `/login`, `/signup`, `/verify`, `/callback`.
- **Layout:** `auth/layout.tsx` — single centered `glass-strong` card on the cosmic canvas. Aurora blobs at 3% opacity.
- **Rendering:** Server Components for the form shells; Client islands for the OTP input (`input-otp` already vendored) and the submit button.
- **No auth required:** If a logged-in user lands here, redirect to `/dashboard`.

### 3.3 `(app)` — the 5 screens, behind GlassShell + auth

- **Pages:** `/dashboard`, `/students`, `/students/[id]`, `/attendance`, `/fees`, `/settings`.
- **Layout:** `app/layout.tsx` — the `GlassShell` (top-level `02_Core_Logic.md` §1): sidebar with 5 entries + Sync + ⌘K, topbar with tenant name + global search + avatar, content pane, sticky footer.
- **Rendering:** Each route is an RSC that fetches its initial data server-side (e.g. `dashboard/page.tsx` calls `getDashboardKPIs(tenantId)` from `src/server/queries/dashboard.ts`). Client islands render the interactive bits (charts, toggles, drawers).
- **Auth required:** Middleware redirects unauthenticated users to `/login`. Authenticated but unprovisioned (no `user_metadata.db_url`) redirect to `/signup/provision` (a sub-route of `(auth)` that runs the 7-step provisioning flow — see `03_Auth_and_Provisioning.md` §4).

### 3.4 The 5-Screen Rule on Web

The 5 screens map to 5 routes inside `(app)`. A 6th top-level route here is a **stop-and-ask trigger** (top-level `AGENTS.md` §8 trigger #3, P2). Sub-routes (e.g. `/students/[id]`) are not new screens — they render inside the same sidebar context and do not add a sidebar entry.

```
┌────────────────────────────────────────────────────────────────┐
│  GlassShell (app/layout.tsx)                                    │
│  ┌──────────┬──────────────────────────────────────────────┐   │
│  │ Sidebar  │  Topbar: Tenant · Search · ⌘K · Avatar        │   │
│  │ ◉ Dash   │ ──────────────────────────────────────────────│   │
│  │ ◉ Stud   │                                                 │   │
│  │ ◉ Attd   │   <Outlet/>  ← one of 5 screens renders here  │   │
│  │ ◉ Fees   │                                                 │   │
│  │ ◉ Sett   │   /dashboard  /students  /attendance          │   │
│  │ ─────    │   /fees       /settings                        │   │
│  │ ⚙ Sync   │                                                 │   │
│  │ ⚡ ⌘K    │ ──────────────────────────────────────────────│   │
│  │          │  Footer: Status · Version · © Buddysaradhi          │   │
│  └──────────┴──────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

Cross-references: full shell diagram in top-level `02_Core_Logic.md` §1; footer stickiness in `13_UI_Guidelines.md` §13; the commercial landing page implementation in `07_Landing_Page.md` (route tree, RSC composition, JSON-LD, Lighthouse budget); the marketing copy source in `product/04_Download_Hub.md` (the WHAT to `07_Landing_Page.md`'s HOW).

---

## 4. Server Components vs Client Islands — Per Surface

The rendering-mode contract for every route group. The marketing surface (§4.1) and auth surface (§4.2) are small enough to inline; the `(app)` surface (§4.3) gets the full per-route table.

### 4.1 The Marketing Landing Page — `07_Landing_Page.md`

The landing page is a single RSC at `src/app/(marketing)/page.tsx` that composes seven commercial sections (Hero, Features, Download Hub, Pricing, FAQ, CTA, Testimonials) and is the LCP-critical surface for every first-time visitor. The full implementation contract — route tree, RSC vs Client island per component, the manifest-fetch data flow, JSON-LD payloads, OG image generator, Lighthouse ≥95 target — is in `07_Landing_Page.md`. The marketing copy is authored in the parallel `product/` directory (`product/02_Hero_and_Above_the_Fold.md`, `product/04_Download_Hub.md`, `product/06_FAQ.md`, etc.); a pre-build codegen step bridges the two so the runtime has zero knowledge of `product/`. The two directories form a WHAT↔HOW pair: `product/` owns the words, `07_Landing_Page.md` owns the rendering.

| Route / Component | Rendering | Why |
|---|---|---|
| `(marketing)/page.tsx` | RSC + PPR | Static prerender; one Suspense for the auth pill, one for the live version number. |
| `(marketing)/pricing/page.tsx` | RSC + PPR | Standalone deep-linkable pricing page; same composition root. |
| `(marketing)/faq/page.tsx` | RSC + PPR | Standalone FAQ with anchor links; FAQ JSON-LD included. |
| `(marketing)/download/page.tsx` | RSC + ISR (revalidate 300 s) | Sister to the in-landing Download Hub; same manifest, different layout. |
| `(marketing)/changelog/[version]/page.tsx` | RSC + SSG | Per-version changelog; generates one HTML file per published version. |
| `(marketing)/opengraph-image.tsx` | Edge runtime, build-time | Dynamic OG image via `ImageResponse`; cached, not per-request. |
| `(marketing)/sitemap.ts` / `robots.ts` | RSC | Metadata routes; sitemap enumerates `/`, `/pricing`, `/faq`, `/download`, `/changelog/*`. |

### 4.2 `(auth)` Routes — RSC shell + Client islands for OTP

The `(auth)` group renders the login, signup, verify, and callback routes as Server Component shells with small Client islands for the OTP input (`input-otp` is browser-only) and the submit button. See `03_Auth_and_Provisioning.md §2` for the SSR cookie strategy and `07_Landing_Page.md §8.3` for the post-landing signup funnel that lands visitors here from the Hero CTA.

### 4.3 Server Components vs Client Islands — `(app)` Surface

The `(app)` surface is where the 5 screens live. The table below lists every component on the app surface and its rendering mode. The marketing and auth routes are covered in §4.1 and §4.2 above.

| Route / Component | Rendering | Why |
|---|---|---|
| `(app)/dashboard/page.tsx` | **RSC** | KPI fetch + initial render server-side; client islands for CountUp + Recharts. |
| `(app)/students/page.tsx` | **RSC** | Paginated list server-rendered; client island for the search input + drawer. |
| `(app)/students/[id]/page.tsx` | **RSC** | Detail drawer server-rendered; client island for the edit form. |
| `(app)/attendance/page.tsx` | **RSC** | Today's batch grid server-rendered; client island for the toggle press + lock. |
| `(app)/fees/page.tsx` | **RSC** | Paid/unpaid/partial matrix server-rendered; client island for the receipt form + void flow. |
| `(app)/settings/page.tsx` | **RSC** | Tabbed settings; client island per tab for instant-apply inputs. |
| `components/buddysaradhi/glass-shell.tsx` | **Client** (`"use client"`) | Sidebar state, ⌘K, sync drawer, route-aware active item. |
| `components/buddysaradhi/command-palette.tsx` | **Client** | `cmdk` needs DOM focus management. |
| `components/buddysaradhi/primitives.tsx` (NeumoToggle, CountUp) | **Client** | Framer Motion + `prefers-reduced-motion`. |
| `components/buddysaradhi/spec-reader.tsx` | **Client** | Reads from `/api/spec` on demand. |
| `components/ui/*` | **Client** (most) | Radix primitives; some (`tooltip`) are RSC-compatible. |
| `src/server/queries/*` | **Server-only** | RSC data fetchers; never imported into a Client Component. |
| `src/server/actions/*` | **Server-only** (`"use server"`) | Invoked via RPC; never imported into a Client Component. |

The rule: a component is a **Client island** iff it uses `useState`, `useEffect`, browser APIs, Framer Motion, `cmdk`, or a TanStack Query hook. Everything else is a Server Component. The `"use client"` directive at the top of a file marks the boundary; it does not force the file to be browser-only, but it does mark the lowest client-only entry point. The marketing surface has its own per-component table in `07_Landing_Page.md §3.1` (every Hero, Features, Download, Pricing, FAQ, CTA, Testimonials, and Footer component).

#### 4.3.1 RSC vs Client Island — Composition Diagram

```
                          RootLayout (RSC — src/app/layout.tsx)
                          ┌──────────────────────────────────────┐
                          │  <html> <body className="cosmic bg"> │  ← raw gradient (§2.2)
                          │  <Providers> ← Client island wrapper │     NOT glass; the canvas
                          │  <Toaster/>  ← Client island         │
                          └─────────────────┬────────────────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼                             ▼                             ▼
   ╔═══════════════════════╗   ╔═══════════════════════╗   ╔═══════════════════════╗
   ║ (marketing)/layout    ║   ║ (auth)/layout          ║   ║ (app)/layout          ║
   ║ RSC                   ║   ║ RSC                    ║   ║ RSC + 1 Client island ║
   ║                       ║   ║                        ║   ║ (GlassShell)          ║
   ║ • MarketingNav        ║   ║ • AuthCard             ║   ║                       ║
   ║   = .glass-faint band ║   ║   = .glass-strong      ║   ║ • Sidebar             ║
   ║   (Client island —   ║   ║     centered +         ║   ║   = .glass-strong     ║
   ║    scroll-spy)        ║   ║     bg-black/60        ║   ║     sticky (§5.5)     ║
   ║ • Footer              ║   ║     backdrop (§5.5 §8.7)║  ║ • Topbar              ║
   ║   = .glass-faint      ║   ║                        ║   ║   = .glass-strong     ║
   ║     sticky (§13)      ║   ║ Inputs/OTP/Submit      ║   ║     sticky (§5.5)     ║
   ╚═════════╤═════════════╝   ║ = .neumo-inset /      ║   ║ • Footer              ║
             │                 ║   .neumo-raised       ║   ║   = .glass-faint      ║
             ▼                 ║   (§6.6 §8.2 §8.9)    ║   ║     sticky (§13)      ║
   ╔═══════════════════════╗   ╚═══════════════════════╝   ╚═════════╤═════════════╝
   ║ (marketing)/page      ║                                        │
   ║ RSC + 5 Client islands║                                        ▼
   ║                       ║                             ╔═══════════════════════╗
   ║ Hero RSC              ║                             ║ (app)/{screen}/page   ║
   ║  ├─ HeroCopy RSC      ║                             ║ RSC + N Client islands║
   ║  ├─ HeroPlatformBadge ║                             ║                       ║
   ║  │   Client (UA)      ║                             ║ • KPI cards RSC       ║
   ║  ├─ HeroVisual RSC    ║                             ║   = .glass + L-border ║
   ║  └─ CTA buttons       ║                             ║     (§5.4 §8.1)       ║
   ║      .neumo-raised    ║                             ║ • List rows RSC       ║
   ║      (§6.6 §8.2)      ║                             ║   = .glass-faint band ║
   ║                       ║                             ║     (§5.5 §8.4)       ║
   ║ FeaturesShowcase RSC  ║                             ║ • Drawer island       ║
   ║  ├─ FeatureCard RSC   ║                             ║   = .glass-strong     ║
   ║  │   = .glass + accent║                             ║     (§5.5 §8.7)       ║
   ║  │     L-border (§5.4)║                             ║ • Toggle/stepper      ║
   ║  └─ MotionSection     ║                             ║   = .neumo-inset +    ║
   ║      Client (whileInV)║                             ║     .neumo-raised     ║
   ║                       ║                             ║     (§6.6 §8.16/8.18) ║
   ║ DownloadHub RSC       ║                             ║ • Search bar          ║
   ║  ├─ DownloadCard RSC  ║                             ║   = .neumo-inset      ║
   ║  │   = .glass (§5.5)  ║                             ║     (§6.6 §8.10)      ║
   ║  ├─ PlatformDetector  ║                             ║                       ║
   ║  │   Client (UA glow) ║                             ║ • Recharts island     ║
   ║  ├─ QRCodeCard Client ║                             ║   = .glass card       ║
   ║  │   (qrcode.react)   ║                             ║     (no glass-on-glass║
   ║  └─ InstallAccordion  ║                             ║      — §5.3)          ║
   ║      Client (Radix)   ║                             ╚═══════════════════════╝
   ║                       ║
   ║ PricingSection RSC    ║
   ║  └─ PricingCard RSC   ║
   ║      = .glass;        ║
   ║        featured =     ║
   ║        .glass-strong  ║
   ║        + emerald glow ║
   ║        (§5.4 §5.5)    ║
   ║                       ║
   ║ FAQSection RSC        ║
   ║  ├─ FAQSearch Client  ║     ← .neumo-inset well (§6.6 §8.10)
   ║  ├─ FAQAccordion Cli. ║     ← rows = .glass-faint band (§5.5 §8.4)
   ║  └─ FAQJsonLd RSC     ║
   ║                       ║
   ║ FinalCTA RSC          ║
   ║  └─ CTAButton RSC     ║     ← .neumo-raised (§6.6 §8.2)
   ║                       ║
   ║ TestimonialGrid RSC   ║
   ║  └─ TestimonialCard   ║     ← .glass-faint (recedes — §5.5 §8.4)
   ║      RSC              ║
   ╚═══════════════════════╝
```

The diagram is the contract. Every component is tagged **RSC** or **Client island** and every surface or control carries its glass tier (§5.5) or neumorphic recipe (§6.6). The RSC layer ships zero JS; the Client islands are the only JS that crosses the wire. The glass tiers stack vertically (marketing → auth → app), each isolated in its route group's layout; the neumorphic controls are leaf-level inside RSCs (the `CTAButton` RSC renders a `.neumo-raised` button — the control is neumorphic, the surrounding card is glass, the two never mix per §6.6's single rule).

---

## 5. The 5 Visible Screens — Routes & Specs

| # | Screen | Route | RSC data fetch | Client islands | Engines touched | Spec |
|---|---|---|---|---|---|---|
| 1 | Dashboard | `/dashboard` | `getDashboardKPIs()` + `getActivityFeed()` | KPI `CountUp`, heatmap `Recharts`, quick-action buttons | Ledger, Reminder, Report, Notification | `04_Dashboard.md` |
| 2 | Students | `/students`, `/students/[id]` | `getStudents(cursor)` + `getStudent(id)` | Search input, detail drawer, edit form | Ledger, Search, Reminder, Security | `05_Students.md` |
| 3 | Attendance | `/attendance` | `getAttendanceSessions(date)` + `getBatchGrid(batchId,date)` | Toggle press, lock button, PIN override sheet | Security, Sync, Report | `06_Attendance.md` |
| 4 | Fees & Payments | `/fees` | `getFeesMatrix()` + `getStudentLedger(id)` | Receipt form, void prompt, PDF preview | Ledger, Report, Notification, Security | `07_Fees_and_Payments.md` |
| 5 | Settings | `/settings` | `getSettings()` + `getAuditLog()` | PIN setup, biometric enroll, backup passphrase, restore flow | Security, Sync, Backup | `08_Settings.md` |

All 5 routes share the `GlassShell` layout from `(app)/layout.tsx`. The sidebar's active entry is computed from `usePathname()` (Client Component inside the shell) — server-rendered nav with client-side active-state hydration.

Cross-references: per-screen state machines in top-level `02_Core_Logic.md` §3; per-screen spec deep-dives in `04`–`08`.

---

## 6. Middleware — `src/middleware.ts`

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { NextIntlMiddleware } from "next-intl";

const intl = NextIntlMiddleware({
  locales: ["en-IN", "hi-IN"],
  defaultLocale: "en-IN",
  localePrefix: "as-needed",
});

export async function middleware(req: NextRequest) {
  // 1. Locale negotiation first (next-intl)
  const intlRes = intl(req);
  if (intlRes) return intlRes;

  // 2. Skip auth for public paths
  const { pathname } = req.nextUrl;
  const PUBLIC = ["/", "/login", "/signup", "/verify", "/callback", "/download"];
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // 3. Refresh Supabase session (cookies)
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (c) => c.forEach((cookie) => res.cookies.set(cookie)),
      },
    }
  );
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // 4. Provisioning gate: if no db_url in user_metadata, send to /signup/provision
  const dbUrl = session.user.user_metadata?.db_url;
  if (!dbUrl && !pathname.startsWith("/signup/provision")) {
    const url = req.nextUrl.clone();
    url.pathname = "/signup/provision";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
```

The matcher excludes static assets and `/api/*` (those routes handle their own auth). The middleware runs on the Edge runtime (default). It refreshes the Supabase JWT cookie on every request, eliminating the "stale session → 401 → refetch loop" failure mode.

Cross-references: Supabase SSR pattern in `03_Auth_and_Provisioning.md` §3; locale strategy in `13_UI_Guidelines.md` §11.

---

## 7. `next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for Vercel + Bun build pipeline.
  // The sandbox `build` script copies .next/static + public into standalone.
  output: "standalone",

  // Dev-only: allow the in-sandbox preview origin to fetch _next assets.
  allowedDevOrigins: ["*.space-z.ai"],

  reactStrictMode: false, // sandbox concession; prod target: true

  // Sandbox concession: type errors do not block build. Prod target: true.
  typescript: { ignoreBuildErrors: true },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "z-cdn.chatglm.cn" }, // sandbox logo
      { protocol: "https", hostname: "public.blob.vercel-storage.com" },
    ],
  },

  experimental: {
    ppr: true,                  // Partial Prerendering for marketing pages
    serverActions: {
      allowedOrigins: ["buddysaradhi.vercel.app", "buddysaradhi.app", "localhost:3000"],
    },
    // Turbopack is the default dev bundler in Next 16; this just stabilises it.
    turp: { resolveAlias: { /* reserved for future overrides */ } },
  },

  // CSP + security headers (also set in vercel.json for static assets).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "connect-src 'self' https://*.supabase.co https://*.turso.io https://public.blob.vercel-storage.com",
              "img-src 'self' data: https:",
              "font-src 'self' https://fonts.gstatic.com",
              "style-src 'self' 'unsafe-inline'", // Tailwind needs inline
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next dev
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

The CSP `connect-src` allowlist is the structural enforcement of top-level `AGENTS.md` Rule 2 — the browser will refuse any `fetch()` to an origin not in the list. Adding a new origin here is a **stop-and-ask trigger** (top-level `AGENTS.md` §8 #2).

Cross-references: full CSP discussion in top-level `10_Security.md` §17; PPR in Next docs.

---

## 8. Server Components vs Server Actions vs API Routes — When to Use Which

| Need | Use | Why |
|---|---|---|
| Fetch data for initial render | **RSC** (`async function Page()`) | Zero client JS; HTML streams. |
| Mutate data from a React form / button | **Server Action** (`'use server'`) | RPC over POST; types are end-to-end; no fetch URL to hardcode (FM-06). |
| Serve a file (e.g. spec markdown, manifest JSON) | **API Route** (`/api/spec`) | Non-React callers (Tauri updater) need a stable URL. |
| Receive a webhook (EAS, Supabase auth webhook) | **API Route** | No React involved. |
| Generate a CSV/PDF report | **API Route** returning a `Response` with `Content-Disposition: attachment` | Streaming; not a JSON RPC. |

The existing `/api/spec` route (in `src/app/api/spec/route.ts`) is the **template** for file-serving API routes: it uses a `Set<string>` allowlist, `path.basename` to defeat traversal, and `Cache-Control: no-store` to keep dev edits live. Every new file-serving route in `04_API_Routes.md` follows this pattern.

---

## 9. Bundle Budget

The single hard number: **≤ 180 KB JS (gzipped) on first load of `/dashboard`.**

| Chunk | Budget | Notes |
|---|---|---|
| React + React-DOM | ~45 KB | Framework floor. |
| Next.js runtime (App Router) | ~40 KB | Includes RSC protocol, router, head. |
| Framer Motion | ~25 KB | Tree-shaken to only the variants we import. |
| Radix primitives (used on `/dashboard`) | ~15 KB | Tooltip + Dialog + Dropdown. |
| Recharts | ~30 KB | Tree-shaken; only Line + Bar + Tooltip. |
| TanStack Query | ~12 KB | Only if a Client island uses it (Dashboard KPI refresh). |
| Zustand | ~3 KB | Tiny. |
| `src/components/buddysaradhi/*` (glass-shell, dashboard) | ~10 KB | Our code. |
| **Total** | **~180 KB** | At budget. |

Anything that pushes over 180 KB requires a justification in the PR and a code-review flag. The lint rule `bundle-budget-guard` (configured in `eslint.config.js`) fails CI if the `/dashboard` first-load JS exceeds 180 KB. Numbers are measured via `@next/bundle-analyzer` against the production build, not the dev build.

The marketing landing `/` has a tighter budget: **≤ 90 KB JS first load** (no TanStack, no Zustand, no Recharts — Framer Motion is the only motion library).

### 9.1 Bundle Budget — Visualised Bar Chart

```
First-load JS budget (gzipped, KB) — /dashboard ≤ 180 KB, / ≤ 90 KB

  0    20    40    60    80   100   120   140   160   180   200
  │     │     │     │     │     │     │     │     │     │     │
  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
                                                                  ↑ ceiling
                                                                    180 KB
                                                                    (/dashboard)

  ████████████                                            45 KB   React + React-DOM
  ███████████                                             40 KB   Next.js runtime (App Router)
  ████████                                                25 KB   Framer Motion (tree-shaken)
  █████                                                   15 KB   Radix primitives (Tooltip/Dialog/Dropdown)
  █████████                                               30 KB   Recharts (tree-shaken)
  ████                                                    12 KB   TanStack Query (Client island only)
  █                                                        3 KB   Zustand
  ████                                                    10 KB   src/components/buddysaradhi/* (glass-shell, dashboard)
  ──────────────────────────────────────────────────────
  ████████████████████████████████████████████████████   ~180 KB   TOTAL /dashboard first load
  ↑ at budget — any new dep requires a PR justification
  ↑ enforced by `bundle-budget-guard` lint rule in CI

  /  (marketing landing) — same axis, tighter ceiling:
  0    20    40    60    80   100
  │     │     │     │     │     │
  ├─────┼─────┼─────┼─────┼─────┤
                                  ↑ ceiling 90 KB
                                    (marketing)
  ████████████                45 KB   React + React-DOM
  ███████████                 40 KB   Next.js runtime (App Router, PPR path)
  ███                          3 KB   Framer Motion (only the variants used)
  ██                           2 KB   @vercel/analytics + @vercel/speed-insights SDKs
  ──────────────────────────────
  █████████████████████       ~90 KB   TOTAL / first load
  ↑ ceiling enforced separately — no TanStack, no Zustand, no Recharts
  ↑ /api/releases/latest manifest fetch is server-side (RSC); zero client bytes
```

The two bar charts are the budget contract in visual form. The `/dashboard` ceiling (180 KB) is the **app surface** budget; the `/` ceiling (90 KB) is the **marketing surface** budget. The marketing budget is tighter by exactly the four libraries it omits (TanStack 12 KB + Zustand 3 KB + Recharts 30 KB + the extra Framer variants ≈ 45 KB saved). Every chunk above the line in either chart must be justified in the PR that introduces it; the lint rule is the gate.

---

## 10. The 30-Second Polling Loop (Web Sync)

The web app does not run an embedded libSQL replica (that's mobile/desktop only). Instead, it polls the user's Turso DB over HTTP every 30 seconds for fresh rows. The flow is in `src/hooks/use-sync-poll.ts`:

```
┌───────────────────────────┐
│  Dashboard mounts (RSC)   │
│  → initial fetch server   │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│  Client island mounts     │
│  → TanStack Query cache   │
│  → useSyncPoll() starts   │
└─────────────┬─────────────┘
              │ every 30s
              ▼
┌───────────────────────────┐
│  fetch('/api/sync/pull',  │
│    { since: lastSyncAt }) │
│  → merged into Query cache│
│  → LEDGER_MUTATED event   │
└───────────────────────────┘
```

Mutations are optimistic: the Client island writes to the Zustand store + TanStack cache immediately, then calls the Server Action, and rolls back on `Err`. The 30-second poll catches mutations made from other devices (mobile, desktop).

Cross-references: full sync state machine in top-level `02_Core_Logic.md` §9; `BR-SYN-*` rules (BR-SYN-01 through BR-SYN-09) in `12_Business_Rules.md` §9; web-specific data flow in this directory's `02_State_and_Data_Flow.md`.

---

## 11. Cross-References

- Top-level `02_Core_Logic.md` §1 — the `GlassShell` design; §2 — the 5-screen surface map. (Earlier drafts cited §5; that section is engine state machines — the 5-screen rule lives in §2.)
- Top-level `13_UI_Guidelines.md` §5 — glass tiers (`glass`, `glass-strong`, `glass-faint`).
- Top-level `13_UI_Guidelines.md` §13 — sticky-footer rule (mandatory on web).
- Top-level `10_Security.md` §17 — CSP, no-telemetry, allowed `connect-src`.
- Top-level `AGENTS.md` §3.2 — web stack snapshot.
- Top-level `AGENTS.md` §6.4 — API route discipline.
- This directory's `02_State_and_Data_Flow.md` — TanStack + Zustand + IndexedDB layering.
- This directory's `03_Auth_and_Provisioning.md` — middleware + Supabase SSR + provisioning.
- This directory's `04_API_Routes.md` — every `/api/*` contract.

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ architecture file must carry ≥ 2 ASCII art mockups. The mockups below complement the existing §3.0 route-group tree, §4.3.1 RSC composition diagram, and §9.1 bundle-budget bar chart — they add three new views the earlier mockups do not cover: (1) the route-group tree annotated with auth state + render mode, (2) the RSC payload stream as a network waterfall, and (3) the bundle-budget growth-over-time trend. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the character set is the §20.2 set; accent colours are named, never hexed; every glass surface is tier-annotated per §5.5; every neumorphic control is recipe-annotated per §6.6; cross-references use canonical IDs only.

### 12.1 Design System Reference — Architecture Layer

> **The single rule (§6.6).** If it is a **control** (button, toggle, input, stepper, segmented control), it is **neumorphic**. If it is a **surface** (card, panel, row, modal, sidebar, topbar, footer), it is **glass**. The architecture layer (this file) does not render controls directly — it renders surfaces (the GlassShell, the marketing nav, the auth card) and composes controls inside them via the screen specs (`04_Dashboard.md`–`08_Settings.md`) and the landing-page spec (`07_Landing_Page.md`). The tables below list every surface the architecture layer creates; the controls are catalogued in `07_Landing_Page.md` §13.1 and the per-screen specs' design-system callouts.

| Surface (architectural) | Glass tier | Where on web | Cross-ref |
|---|---|---|---|
| Root canvas (cosmic gradient) | (none — raw gradient `#0f0c29 → #24243e → #0a0a1a`) | `src/app/layout.tsx` `<body>` | §2.2 Root Background Recipe (13_UI_Guidelines.md) |
| Marketing nav + footer | `glass-faint` (footer sticky per §13) | `(marketing)/layout.tsx` | §5.5, §13, `07 §11` |
| Auth centered card | `glass-strong` + `bg-black/60 + backdrop-blur-sm` backdrop | `(auth)/layout.tsx` | §5.5, §8.7 |
| App sidebar (GlassShell) | `glass-strong` sticky | `(app)/layout.tsx` | §5.5, `02_Core_Logic.md §1` |
| App topbar | `glass-strong` sticky | `(app)/layout.tsx` | §5.5 |
| App footer | `glass-faint` sticky | `(app)/layout.tsx` | §5.5, §13 |
| Modal backdrop (when invoked from app shell) | `bg-black/60 + backdrop-blur-sm` | composed by screen spec | §8.7 |

| Control (architectural) | Neumo recipe | Where on web | Cross-ref |
|---|---|---|---|
| Command palette ⌘K trigger (topbar) | `neumo-raised` | GlassShell topbar | §6.6, §8.11 |
| Global search bar (topbar) | `neumo-inset` | GlassShell topbar | §6.6, §8.10 |
| Sidebar collapse toggle (desktop) | `neumo-raised`; `:active` → `neumo-pressed` | GlassShell sidebar | §6.6, §8.2 |

> **References.** Next.js 16 App Router docs (route groups, RSC, PPR, Server Actions, middleware); Smashing Magazine — "A Visual Guide To React Server Components"; Josh W. Comeau — "The 'What' And 'Why' Of Server Components"; Vercel docs (Edge runtime, `output: "standalone"`, `@vercel/analytics`); TanStack Query v5 docs (the cache + optimistic-update layer this architecture composes); CSS-Tricks — "An Overview Of React Server Components". These are the same references cited in `README.md` §7.2.

### 12.2 Mockup M1 — Route-Group Tree (Auth + Render-Mode Annotated)

The §3.0 tree showed the file layout; this mockup shows the **runtime view** — each route group annotated with its auth gate, render mode, and the glass tier of its layout surface. Read top-down: the root layout (RSC, no glass — it paints the cosmic canvas) branches into three route groups, each with its own gate, render mode, and layout surface.

```
                              src/app/layout.tsx
                              ┌──────────────────────────────────────────────────────┐
                              │  RootLayout (RSC — server-only)                      │
                              │  • <html lang="en-IN"> <body className="cosmic bg">   │  ← raw gradient §2.2
                              │  • <Providers>  ← Client island wrapper (theme,      │     NOT glass — the canvas
                              │    queryClient, toaster)                              │
                              │  • Inter + JetBrainsMono via next/font (display:swap) │
                              └─────────────────────────┬────────────────────────────┘
                                                        │  (no auth gate at root)
              ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
              ▼                                         ▼                                         ▼
  ╔════════════════════════════╗          ╔════════════════════════════╗          ╔════════════════════════════╗
  ║  (marketing)/              ║          ║  (auth)/                    ║          ║  (app)/                    ║
  ║  ──────────                ║          ║  ────────                   ║          ║  ───────                   ║
  ║  Auth gate: NONE           ║          ║  Auth gate: optional        ║          ║  Auth gate: REQUIRED       ║
  ║  Render:    RSC + PPR      ║          ║   (redirect to /dashboard   ║          ║   + provisioned            ║
  ║  Budget:    ≤ 90 KB JS     ║          ║    if already logged in)    ║          ║   (db_url in user_metadata)║
  ║  Shell: MarketingLayout    ║          ║  Render: RSC + small        ║          ║  Render: RSC + Client      ║
  ║   • nav  = .glass-faint    ║          ║   Client islands (OTP,      ║          ║   islands (Recharts,       ║
  ║     band (sticky top)      ║          ║   submit button)            ║          ║   drawers, toggles)        ║
  ║   • footer = .glass-faint  ║          ║  Budget: ≤ 90 KB JS         ║          ║  Budget: ≤ 180 KB JS       ║
  ║     (sticky bottom §13)    ║          ║  Shell: AuthLayout          ║          ║  Shell: GlassShell         ║
  ║  ↑ §5.5 §13               ║          ║   • centered .glass-strong  ║          ║   • sidebar  = .glass-     ║
  ║                            ║          ║     card + bg-black/60 +    ║          ║     strong sticky (§5.5)   ║
  ║  Routes:                   ║          ║     backdrop-blur-sm (§8.7) ║          ║   • topbar   = .glass-     ║
  ║   /                        ║          ║  ↑ §5.5 §8.7                ║          ║     strong sticky (§5.5)   ║
  ║   /pricing                 ║          ║                             ║          ║   • footer   = .glass-     ║
  ║   /faq                     ║          ║  Routes:                    ║          ║     faint sticky (§13)     ║
  ║   /download                ║          ║   /login                    ║          ║  ↑ §5.5 §13                ║
  ║   /changelog/[version]     ║          ║   /signup                   ║          ║                            ║
  ║   /opengraph-image         ║          ║   /verify                   ║          ║  Routes:                   ║
  ║   /sitemap.xml /robots.txt ║          ║   /signup/provision         ║          ║   /dashboard               ║
  ║                            ║          ║   /callback                 ║          ║   /students, /students/[id]║
  ║  Controls (in landing):    ║          ║                             ║          ║   /attendance              ║
  ║   • CTA buttons .neumo-    ║          ║  Controls (in auth card):   ║          ║   /fees                    ║
  ║     raised (§6.6 §8.2)     ║          ║   • OTP wells .neumo-inset  ║          ║   /settings                ║
  ║   • search (FAQ) .neumo-   ║          ║     (§6.6 §8.9)             ║          ║                            ║
  ║     inset (§6.6 §8.10)     ║          ║   • submit .neumo-raised    ║          ║  Controls (in screens):    ║
  ║                            ║          ║     (§6.6 §8.2)             ║          ║   • KPI accent borders §5.4║
  ╚════════════════════════════╝          ║   • Google OAuth .neumo-    ║          ║   • toggles .neumo-inset   ║
                                          ║     raised transparent     ║          ║     (§6.6 §8.16)           ║
                                          ╚════════════════════════════╝          ║   • segmented .neumo-inset ║
                                                                                   ║     well + raised pill     ║
                                                                                   ║     (§6.6 §8.5)            ║
                                                                                   ╚════════════════════════════╝
                                                              ↓
                                              src/app/api/*  (server-only; NO glass / NO neumo)
                                              • /api/spec, /api/provision, /api/students/*,
                                                /api/ledger/*, /api/attendance/mark,
                                                /api/reports/[type], /api/backup/*,
                                                /api/releases/latest, /api/sync/pull,
                                                /api/cron/* (CRON_SECRET gated)
                                              ↑ see 04_API_Routes.md for the full tree.
```

The mockup reads top-down: the root layout paints the cosmic canvas (no glass — it IS the aurora source per §1.2); the three route groups branch off with progressively stricter auth gates (none → optional → required+provisioned). Each leaf is annotated with its render mode (RSC + PPR for marketing; RSC + small Client islands for auth; RSC + heavier Client islands for app), its JS budget (90 KB marketing / 180 KB app — per §9), and the glass tier of its layout surface. The `/api/*` rail at the bottom is server-only — no glass, no neumo, no UI surface at all.

### 12.3 Mockup M2 — RSC Payload Stream (Network Waterfall)

The §4.3.1 diagram showed the React tree; this mockup shows the **wire** — the actual RSC payload stream from server to browser for `/dashboard` first paint. The point: the server ships HTML + RSC chunks in parallel; the Client islands hydrate after the static shell paints, so the LCP is the KPI figures server-rendered in HTML, not the Recharts island.

```
   Browser navigates to /dashboard                                     t = 0 ms
   │
   ▼
   ┌────────────────────────────────────────────────────────────────────────────────┐
   │  GET /dashboard (HTTP/2, cookie: sb-access-token=...)                           │
   └────────────────────────────────────────────────────────────────────────────────┘
   │ ← server: middleware runs (locale + auth + provision check)                    t = 4 ms
   ▼
   ┌────────────────────────────────────────────────────────────────────────────────┐
   │  RSC tree renders on server (no client JS yet)                                  │
   │  ┌─ RootLayout (RSC) ──────────────────────────────────────────────────────┐    │
   │  │  <body className="cosmic bg">                                           │    │
   │  │  ┌─ GlassShell (Client island — sidebar state) ──────────────────────┐  │    │
   │  │  │  ┌─ Sidebar .glass-strong sticky (§5.5) ──────────────────────┐  │  │    │
   │  │  │  │  ◈ Dashboard ←active   ● Students   ● Attendance …        │  │  │    │
   │  │  │  └────────────────────────────────────────────────────────────┘  │  │    │
   │  │  │  ┌─ Topbar .glass-strong sticky (§5.5) ───────────────────────┐  │  │    │
   │  │  │  │  Tenant · [neumo-inset search ⌘K] · avatar                 │  │  │    │
   │  │  │  └────────────────────────────────────────────────────────────┘  │  │    │
   │  │  │  ┌─ <Outlet/> — Dashboard RSC ────────────────────────────────┐  │  │    │
   │  │  │  │  ┌─ KPI cards .glass + accent L-border (§5.4 §8.1) ─────┐ │  │  │    │
   │  │  │  │  │ ▌Collected ₹2,45,500   ▌Due Today ₹48,000  ▌Present 92% │ │  │  │    │
   │  │  │  │  └─────────────────────────────────────────────────────────┘ │  │  │    │
   │  │  │  │  ┌─ Heatmap .glass card (§5.5) ───────────────────────────┐ │  │  │    │
   │  │  │  │  │  ██░██▓░░██  (cells = flat bg-white/[0.04] — §5.3)     │ │  │  │    │
   │  │  │  │  └─────────────────────────────────────────────────────────┘ │  │  │    │
   │  │  │  │  ┌─ Recharts island (Client) — placeholder ───────────────┐ │  │  │    │
   │  │  │  │  │  <Suspense fallback={<Skeleton className="h-[280px]"/>}>│ │  │  │    │
   │  │  │  │  │    <RevenueChart/>  ← Client island (Recharts ~30 KB)   │ │  │  │    │
   │  │  │  │  │  </Suspense>                                              │ │  │  │    │
   │  │  │  │  └─────────────────────────────────────────────────────────┘ │  │  │    │
   │  │  │  └────────────────────────────────────────────────────────────┘  │  │    │
   │  │  └─ Footer .glass-faint sticky (§13) ─────────────────────────────┘  │    │
   │  └────────────────────────────────────────────────────────────────────┘  │    │
   └────────────────────────────────────────────────────────────────────────┘
   │ ← server: streams HTML + RSC chunks (HTTP/2 multiplexed)                       t = 120 ms
   ▼
   Browser paints the static shell (cosmic bg + sidebar + KPI figures)  ← LCP      t = 180 ms
   ↑ LCP element = KPI figure ₹2,45,500 (server-rendered, no client JS)
   ↑ accent left-border on KPI cards already painted (.glass + §5.4 border inlined)
   │
   ▼
   ┌────────────────────────────────────────────────────────────────────────────────┐
   │  RSC payload stream (the React tree as serialized chunks)                       │
   │  ┌─ chunk 0: RootLayout HTML (already painted) ─────────────────────────────┐   │
   │  ├─ chunk 1: GlassShell Client ref ("use client" boundary) ───────────────┤   │
   │  ├─ chunk 2: KPI cards RSC payload (figures, sparkline data) ─────────────┤   │
   │  ├─ chunk 3: Heatmap RSC payload (cell intensities) ──────────────────────┤   │
   │  └─ chunk 4: <Suspense> boundary for Recharts island (promise pending) ───┘   │
   └────────────────────────────────────────────────────────────────────────────────┘
   │ ← server: ships the Recharts Client island bundle (~30 KB gzipped)              t = 240 ms
   ▼
   Recharts island hydrates; chart paints inside the .glass card                    t = 320 ms
   ↑ chart parent = .glass card; chart itself = flat tinted (no glass-on-glass §5.3)
   ↑ Recharts is the ONLY new client JS after first paint (the rest is RSC)
   │
   ▼
   TanStack Query useSyncPoll() starts (30 s interval — §10 of this file)            t = 330 ms
   ┌────────────────────────────────────────────────────────────────────────────────┐
   │  useQuery(['dashboard','kpis']) → cache HIT (server pre-warmed)                 │
   │  useSyncPoll() → fetch('/api/sync/pull', { since: lastSyncAt }) every 30 s      │
   └────────────────────────────────────────────────────────────────────────────────┘
   ↑ no client-side fetch on first paint (BR-SYN-01 still honoured: server prefetched)
   ↑ Zod validates the sync response before it touches the Query cache (§6 of 02_)
```

The waterfall makes the RSC contract visible: the LCP paints at 180 ms with **zero** client JS — the KPI figures are server-rendered HTML in the `.glass` cards, the accent left-borders are inlined CSS, the cosmic canvas is the body background. The Recharts Client island hydrates at 320 ms inside a `<Suspense>` boundary; its parent is a `.glass` card but the chart itself is flat-tinted per the no-glass-on-glass rule (§5.3). TanStack Query then takes over for the 30-second poll loop. The whole stream is ~180 KB of client JS (the §9 budget) — Recharts is the largest single chunk after React itself.

### 12.4 Mockup M3 — Bundle Budget Growth-Over-Time Trend

The §9.1 bar chart showed the current budget; this mockup shows the **trend** across three milestone builds (v0.1 MVP → v1.0 launch → v1.4 current) so a future agent can see what grew, what shrank, and what is at risk of breaching the 180 KB ceiling. Each row is a build; each column is a chunk; the right margin tracks the running total against the ceiling.

```
First-load JS budget (gzipped, KB) — /dashboard ≤ 180 KB ceiling (§9)

  Chunk                  v0.1 MVP   v1.0 launch   v1.4 current   Δ v0.1→v1.4   Notes
  ─────────────────────────────────────────────────────────────────────────────────────
  React + React-DOM         45 KB      45 KB         45 KB           —         framework floor (immutable)
  Next.js runtime (App      38 KB      39 KB         40 KB           +2        App Router + RSC protocol grew slightly
   Router, PPR path)
  Framer Motion             18 KB      22 KB         25 KB           +7        added whileInView + layout variants
  Radix primitives          10 KB      12 KB         15 KB           +5        added Dialog + Dropdown for drawers
   (Tooltip/Dialog/Dropdown)
  Recharts                  —          28 KB         30 KB           +30       introduced in v1.0 for dashboard chart
   (tree-shaken)
  TanStack Query            —          10 KB         12 KB           +12       introduced in v1.0 for cache layer
  Zustand                    2 KB       3 KB          3 KB           +1        tiny — selector pattern keeps it flat
  src/components/buddysaradhi/*   6 KB       8 KB         10 KB           +4        GlassShell + dashboard islands
  ─────────────────────────────────────────────────────────────────────────────────────
  TOTAL /dashboard         119 KB     167 KB        180 KB           +61       ← at ceiling — any new dep needs a PR
  ─────────────────────────────────────────────────────────────────────────────────────
  CEILING (§9)              180 KB     180 KB        180 KB                    enforced by `bundle-budget-guard` lint
  ↑ slack v0.1              61 KB      13 KB          0 KB                    v1.4 has ZERO slack

  Visual trend (each █ = 4 KB; │ marks the 180 KB ceiling):

  v0.1 MVP      ██████████████████████████████                                      119 KB
  v1.0 launch   █████████████████████████████████████████████████████████████       167 KB
  v1.4 current  ██████████████████████████████████████████████████████████████████ 180 KB │
                                                                                ↑
                                          ceiling — any new chunk here must justify a swap
                                          (e.g. swap Recharts for visx if a chart need
                                          grows — that's a PR-level decision, not a
                                          Friday-afternoon one)

  /  (marketing landing) — same axis, 90 KB ceiling — trend:
  v0.1 MVP      ████████████████████                                                  78 KB
  v1.0 launch   █████████████████████                                                85 KB
  v1.4 current  ██████████████████████                                               88 KB │
                                                                                ↑
                                          2 KB slack — the marketing budget is tighter;
                                          the FAQ fuse.js + QR lazy-load are the levers
```

The trend shows the `/dashboard` budget has consumed its entire 61 KB of v0.1 slack over 14 releases. The biggest single jumps were Recharts (+30 KB, introduced v1.0) and TanStack Query (+12 KB, introduced v1.0). Framer Motion grew +7 KB as we added `whileInView` and layout variants. The marketing budget has 2 KB of slack left — the lazy-loaded `qrcode.react` (currently ~14 KB but only fetched when the QR card scrolls into view) is the lever; if a future feature pushes `/` over 90 KB, the QR card becomes a `next/dynamic` import with a manual `IntersectionObserver` trigger. The lint rule `bundle-budget-guard` (configured in `eslint.config.js`) fails CI if either ceiling is breached — the rule is the gate, the trend is the early-warning system.

---

*The architecture in this file is the contract. When a route, a layout, or a rendering decision diverges from this spec, the spec wins — unless the spec is wrong, in which case you amend this file first, then the code, then the worklog. The order matters.*
