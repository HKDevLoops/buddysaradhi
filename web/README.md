# web/ — Buddysaradhi Web Platform Planning Package

> Orientation index for the Next.js 16 web surface of Buddysaradhi: Omni-Core. This directory is the **agent-ready** spec for the web app — every file in here maps 1:1 to a slice of the `apps/web` (in this sandbox: `src/app`) implementation. Read this README first; everything else flows from it. The web surface is one of five platform directories under `Buddysaradhi_Planning/`; the cross-references to its siblings (`product/`, `deployment/`, `mobile/`, `desktop/`) live in §8 below.

---

## 0. Who This Is For

The **target reader** is one of:

1. **A web implementation agent** (Claude / GPT / human engineer) about to write or refactor code under `src/app/`, `src/components/`, `src/lib/`, `src/hooks/`, or `src/server/`.
2. **A QA reviewer** running agent-browser smoke tests against `/`, `/dashboard`, `/students`, `/attendance`, `/fees`, `/settings`.
3. **A platform engineer** wiring Vercel, Vercel Blob, Supabase, and Turso plumbing.

If you are not building, reviewing, or wiring the **web surface only**, you are in the wrong directory. Mobile lives in `../mobile/`, Desktop in `../desktop/`, deployment-wide concerns in `../deployment/`.

---

## 1. Stack At a Glance

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router)** | RSC for data, Server Actions for mutations, Turbopack dev, Partial Prerendering (PPR) for sub-100ms TTFB on marketing pages. |
| Runtime | **Node 20 on Vercel** | Vercel's default; matches `engines.node` in `package.json`. Edge runtime reserved for middleware only. |
| Language | **TypeScript 5, strict** | `strict: true`; `noImplicitAny: false` is a sandbox concession, prod target is `true`. No `any`, no `as` without `// SAFETY:`. |
| Styling | **Tailwind 4 + tw-animate-css** | Inline `@theme` tokens in `globals.css`; glass tiers (`glass`, `glass-strong`, `glass-faint`) as utility classes. |
| UI primitives | **shadcn/ui (Radix)** | Already vendored under `src/components/ui/`. Composed, not imported as a package. |
| Motion | **Framer Motion 12** | Used for neumorphic press, drawer slides, CountUp easing. `prefers-reduced-motion` honoured. |
| Server state | **TanStack Query v5** | `staleTime` per entity; `gcTime` 5 min default. Only inside Client islands. |
| UI state | **Zustand v5** | `useDashboardStore`, `useStudentsStore`, etc. Persisted slices via `idb-keyval`. |
| Validation | **Zod v4** | Single source of truth for types. Every server action + API route parses before DB. |
| Forms | **react-hook-form + @hookform/resolvers** | Zod resolver; never submit before parse. |
| Auth | **Supabase Auth + `@supabase/ssr`** | Email + OTP. Cookies via `cookies()`. No passwords stored by us. |
| DB (per-user) | **Turso (libSQL) via `@libsql/client`** | One DB per tutor. HTTP client in web (no embedded replica — see `02_State_and_Data_Flow.md` §3). |
| ORM | **Prisma 6** | Sandbox dev DB only. Production per-user DBs are raw SQL migrations over `@libsql/client`. |
| Package manager | **Bun** | `bun install`, `bun run build`. Lockfile `bun.lockb`. |
| Hosting | **Vercel** (Hobby → Pro) | `bom1` region (India) primary, `fra1` fallback. |
| Blob storage | **Vercel Blob** | Download hub for Desktop installers + Mobile side-load APKs; manifests + changelogs. |
| Analytics | **Vercel Speed Insights + Web Analytics** | Privacy-respecting, aggregate-only. **No** Sentry/Mixpanel/PostHog (Rule 3, AP-10). |

Cross-references: stack rationale in `01_Architecture.md` §2; auth plumbing in `03_Auth_and_Provisioning.md` §2; data flow in `02_State_and_Data_Flow.md` §1.

---

## 2. File Index

Every file in this directory with a one-paragraph summary. Read in order on first encounter.

### 2.1 File-Index Decision Tree

```
┌──────────────────────────────────────────────────────────────────────────┐
│  "Which web/ file governs my task?"                                       │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
   ┌──────────────┬───────────────┼──────────────┬──────────────┬──────────┐
   ▼              ▼               ▼              ▼              ▼          ▼
route,         state, cache,    Supabase +     /api/* route   vercel.json  /download,
layout,        optimistic UI,   Turso DB        contract,     env vars,    /pricing,
middleware,    sync_outbox      provisioning    Zod schema,   regions      /faq,
next.config    (BR-SYN-01)      (7-step flow)   error codes   crons        /changelog
   │              │               │              │              │          │
   ▼              ▼               ▼              ▼              ▼          ▼
01_Architect  02_State_and_    03_Auth_and_   04_API_Routes  05_Deploy-  07_Landing
ure.md        Data_Flow.md     Provisioning   .md            ment_Vercel _Page.md
              ↑ §5.5 glass     .md            ↑ §5.5 (none   .md         ↑ §5.5 glass
              §6.6 neumo       ↑ §5.5 glass    — server-     ↑ §5.5     hero= glass
              (controls)       auth card       only)         (none —    features = glass
              on Client        = glass-strong                              + accent L-border
              islands          + backdrop                                   pricing featured
                                                               infra)     = glass-strong
   │              │               │              │              │          │
   └──────────────┴───────────────┴──────────────┴──────────────┴──────────┘
                                  │
                                  ▼
            Blob bucket layout, manifest schema, desktop updater
                                  │
                                  ▼
                          06_Build_and_Release.md
                          (↑ server-only; no glass tier)
                                  │
                                  ▼
            Always pair with the top-level AGENTS.md §2 (10 non-negotiables)
            and 13_UI_Guidelines.md §5.5 (glass coverage) + §6.6 (neumo coverage)
```

The tree reads top-down: pick the leaf that matches the task, read that file first, then layer in the cross-cutting design-system spec. Glass/neumo annotations on each leaf point to where the design system surfaces in that file — `01_Architecture.md` and `07_Landing_Page.md` are the heaviest design-system carriers (RSC layouts + marketing cards); `04_API_Routes.md` and `05_Deployment_Vercel.md` carry none (server-only / infra, no UI surfaces).

| # | File | Words | Summary |
|---|---|---|---|
| 1 | `README.md` | ~1,800 | This file. Orientation, stack, decision tree, "where to start," platform cross-references, word-count budget, verification checklist. |
| 2 | `01_Architecture.md` | ~3,300 | Next.js 16 App Router architecture: route groups `(marketing)` / `(app)` / `(auth)`, RSC vs Client Island table, the 5 visible screens → routes mapping, middleware, `next.config.ts`, bundle budget (≤180 KB JS on `/dashboard` first load). |
| 3 | `02_State_and_Data_Flow.md` | ~3,400 | Three state layers (Server / TanStack / Zustand), cache hierarchy (Query → IndexedDB → in-memory), optimistic ledger writes, 30-second libSQL HTTP polling, schema bootstrap, Zod-before-DB discipline. |
| 4 | `03_Auth_and_Provisioning.md` | ~3,150 | Supabase Auth (email + OTP), `@supabase/ssr` cookie strategy, the 7-step provisioning flow (Supabase → Edge Function → Turso `db-{uuid}` → scoped JWT → libSQL init → schema bootstrap → empty-state), logout cache wipe (BR-SEC-04). |
| 5 | `04_API_Routes.md` | ~3,500 | Every `/api/*` route contract: method, path, Zod request schema, response shape, error codes, BR-/EC- IDs. The hardened `/api/spec` allowlist pattern as the template. Token-bucket rate limiting per IP. |
| 6 | `05_Deployment_Vercel.md` | ~2,800 | `vercel.json` (regions, functions, crons), env var catalogue, preview deploys for QA, production deploy to `buddysaradhi.vercel.app` + `buddysaradhi.app`, `bun run build` (NOT `next build`), Edge Function deploy, free-tier alert thresholds, rollback playbook. |
| 7 | `06_Build_and_Release.md` | ~2,900 | Web build is Vercel-deployed (covered in 05) but the web app is also the **download hub** for Desktop (`.msi`/`.dmg`/`.AppImage`) and Mobile APKs. Vercel Blob bucket layout, manifest schema, SHA-256 verification, retention policy, Tauri updater wiring. |
| 8 | `07_Landing_Page.md` | ~6,900 | The commercial landing page **implementation** contract — the HOW to `product/`'s WHAT. RSC composition of seven sections (Hero, Features, Download Hub, Pricing, FAQ, CTA, Testimonials), Partial Prerendering + ISR wiring, the `/api/releases/latest` manifest endpoint, JSON-LD, Lighthouse ≥95 target. |
| 9 | `AGENTS.md` | ~3,400 | Handoff instructions for the next web agent: prime directive, file map, code style, testing protocol, stop-and-ask triggers, glossary, "done" definition. |

**Target total:** ≥ 18,000 words across all 9 files. Verified with `wc -w` at the end of every writing session. The current total is ~30,900 words — every per-file floor is met with margin (see §10).

---

## 3. Where to Start — Decision Tree

```
                ┌───────────────────────────────────────────┐
                │  What is the task?                        │
                └───────────────────────────────────────────┘
                                  │
   ┌──────────────┬───────────────┼──────────────┬──────────────┬──────────────┐
   ▼              ▼               ▼              ▼              ▼              ▼
"I'm a new    "I need to add   "I'm wiring    "I'm shipping  "I'm onboarding "I'm touching
 web agent;    a feature on     auth/provision a new build    a teammate     the commercial
where do I     /dashboard,     for a new       and need to    to the web     landing page
 begin?"       /students, ...   user"          upload to      project"       (/) or the
   │            │               │              Blob"          │              download hub
   ▼            ▼               ▼              ▼              ▼              ▼
README.md →   01_Architecture  03_Auth_and_   06_Build_and_  README.md →    07_Landing_
AGENTS.md →   .md → relevant   Provisioning   Release.md     AGENTS.md →    Page.md →
01_Architect  screen spec      .md            + 05_Deploy-   01_Architecture product/
ure.md        (04/05/06/07/    + 02_State     ment_Vercel.md .md (skim)      (content
              08)              _and_Data      (env + region)                source)
                              _Flow.md
   │            │               │              │              │              │
   └────────────┴───────────────┴──────────────┴──────────────┴──────────────┘
                                  │
                                  ▼
                  Always: AGENTS.md (top-level) §2
                  Always: 13_UI_Guidelines.md (no indigo/blue)
                  Always: 12_Business_Rules.md (BR-* IDs)
```

If after this tree you are still unsure, **stop and ask** — do not improvise. The decision framework at `AGENTS.md` (top-level) §13 governs feature scope; the stop-and-ask triggers in this directory's `AGENTS.md` §5 govern safety. The commercial landing page (`/`, `/pricing`, `/faq`, `/download`, `/changelog/*`) is owned end-to-end by `07_Landing_Page.md`; that file is the engineering authority for every marketing-route decision and the bidirectional counterpart to the `product/` directory's content spec (see §9).

---

## 4. The Five Visible Screens → Routes Map

The web app exposes **exactly one user-facing route tree**. The 5 screens map to 5 routes inside the `(app)` route group; the marketing landing stays at `/`; auth lives under `(auth)`.

| # | Screen | Route | Spec |
|---|---|---|---|
| — | Marketing landing | `/` | `07_Landing_Page.md` (HOW) + `product/` (WHAT) |
| — | Pricing / FAQ / Changelog | `/pricing`, `/faq`, `/changelog/[version]` | `07_Landing_Page.md` §2 |
| 1 | Dashboard | `/dashboard` | `04_Dashboard.md` |
| 2 | Students | `/students` | `05_Students.md` |
| 3 | Attendance | `/attendance` | `06_Attendance.md` |
| 4 | Fees & Payments | `/fees` | `07_Fees_and_Payments.md` |
| 5 | Settings | `/settings` | `08_Settings.md` |
| — | Login / Signup / OTP | `/login`, `/signup`, `/verify` | `03_Auth_and_Provisioning.md` |
| — | Download hub | `/download` (public) | `07_Landing_Page.md` §6 + `06_Build_and_Release.md` + `product/04_Download_Hub.md` |

A 6th top-level screen or a new top-level route under `(app)` is a **stop-and-ask trigger** (Rule 4, P2). Sub-routes (e.g. `/students/[id]`) are allowed and encouraged for deep-linking, but they render inside the same `GlassShell` and switch no sidebar entry.

---

## 5. The Non-Negotiables (Quick Reference)

These come from top-level `AGENTS.md` §2 and are binding on every line of web code:

1. **Ledger is append-only** — never UPDATE/DELETE on `ledger_entries`. Corrections are new `VOID` rows with `reverses_entry_id`. (Rule 1, P4, BR-LED-06.)
2. **No network calls that process user data** — only Turso HTTP (per-user scoped JWT) and the update-check ping. No third-party API that sees PII. (Rule 2, P5.)
3. **No telemetry SDK** — no Sentry, Mixpanel, PostHog, GA. Vercel Speed Insights is aggregate-only and allowed. (Rule 3, AP-10, TELE-1.)
4. **Five screens only** — a 6th top-level route requires a principle amendment. (Rule 4, P2.)
5. **No indigo/blue primary accents** — Emerald/Cyan/Amber/Flare/Violet only. (Rule 5, AP-6.)
6. **Integer paise, never float** — `INTEGER` in DB; `bigint` or safe-integer `number` in TS; `Intl.NumberFormat('en-IN')` for display. (Rule 6, BR-M-01.)
7. **Every mutation writes `sync_outbox`** — in the same transaction. (Rule 7, BR-SYN-01.)
8. **Backups are AES-256-GCM + Argon2id** — never plaintext. (Rule 8, BACKUP-1.)
9. **No silent failures** — throw or return typed `Result<T, E>`. No empty `catch {}`. No `console.log` in prod. (Rule 9, AP-9.)
10. **Accessibility is mandatory** — WCAG 2.1 AA target AAA. 44×44px touch targets. `prefers-reduced-motion` honoured. (Rule 10, P15.)

---

## 6. Reading Order for a New Web Agent

1. This `README.md` (you are here).
2. `AGENTS.md` (this directory) — handoff instructions, stop-and-ask triggers.
3. `01_Architecture.md` — understand the route groups and RSC/Client split.
4. Top-level `AGENTS.md` §2 — the 10 non-negotiables.
5. `02_State_and_Data_Flow.md` — TanStack + Zustand + IndexedDB layering.
6. `03_Auth_and_Provisioning.md` — Supabase + Turso provisioning.
7. The screen spec you're working on (e.g. `04_Dashboard.md`).
8. `13_UI_Guidelines.md` — glass tiers, accent map, no indigo/blue.
9. `04_API_Routes.md` — only if you're writing or modifying a route handler.
10. `05_Deployment_Vercel.md` — only if you're shipping or wiring env vars.
11. `06_Build_and_Release.md` — only if you're touching the download hub or manifests.
12. `07_Landing_Page.md` — only if you're touching the commercial landing page (`/`, `/pricing`, `/faq`, `/download`, `/changelog/*`), and its content source `product/04_Download_Hub.md` (the WHAT) alongside it.

---

## 7. Cross-Reference Conventions

Throughout this directory, cross-references take the form:

- `12_Business_Rules.md §BR-FEE-01` — top-level spec, BR ID.
- `02_Core_Logic.md §6.7` — top-level spec, section number.
- `01_Architecture.md §3` — this directory, file + section.
- `07_Landing_Page.md §6` — this directory, the commercial landing page implementation spec, section 6 (the Download Hub).
- `product/04_Download_Hub.md` — sibling directory, the marketing spec for the download hub.
- `AGENTS.md §2` (no path prefix) — the top-level `AGENTS.md`.

All ASCII diagrams render in fixed-width fonts; copy them verbatim into PRs. All code blocks carry a language tag. All hex colors come from the bioluminescent palette (Emerald `#00FF9D`, Cyan `#00F0FF`, Amber `#FFB300`, Flare `#FF5E00`, Violet `#B388FF`) or the cosmic canvas (`#0f0c29`, `#24243e`, `#0a0a1a`). **No indigo. No blue.** Any indigo/blue in a code sample is a bug — file it.

### 7.1 Design-System Surface Coverage

Every UI surface described in this directory references the canonical glass-tier table (`13_UI_Guidelines.md` §5.5) or the canonical neumorphic-recipe table (`13_UI_Guidelines.md` §6.6). The summary below is the cheat-sheet — the full maps live in those two sections.

| Surface (web/) | Glass tier | Where on web | Cross-ref |
|---|---|---|---|
| Marketing hero card (over cosmic gradient) | `glass` | `/` Hero | §5.5, `07_Landing_Page.md §4` |
| Marketing feature card (per principle) | `glass` + accent left-border | `/` Features grid | §5.4, §5.5, `07 §5` |
| Marketing pricing card (featured tier) | `glass-strong` + emerald glow | `/` Pricing | §5.5, `07 §6` (link to `07 §8`) |
| Marketing download card | `glass` | `/` Download Hub | §5.5, `07 §6.2` |
| Marketing FAQ accordion row | `glass-faint` band | `/` FAQ | §5.5, §8.4 |
| Marketing footer | `glass-faint` | all marketing routes | §5.5, §13 |
| App sidebar / topbar (GlassShell) | `glass-strong` sticky | `(app)/layout.tsx` | §5.5, `01_Architecture.md §3.3` |
| App KPI card | `glass` + accent left-border | `/dashboard` | §5.4, §5.5, §8.1 |
| App list row / table row | `glass-faint` band | `/students`, `/fees` | §5.5, §8.4 |
| App drawer / sheet | `glass-strong` | `/students/[id]` | §5.5, §8.7 |
| App modal dialog | `glass-strong` + backdrop | confirm / record-payment | §5.5, §8.7 |
| Auth card (login/signup/verify) | `glass-strong` centered | `(auth)/layout.tsx` | §5.5, `03 §3.2` |
| Toast | `glass-strong` + accent bar | everywhere | §5.5, §8.8 |

| Control (web/) | Neumo recipe | Where on web | Cross-ref |
|---|---|---|---|
| Primary CTA button | `neumo-raised` | Hero, Pricing CTA | §6.6, §8.2 |
| Pressed button (`:active`) | `neumo-pressed` | every CTA | §6.3, §6.6 |
| Search bar tray | `neumo-inset` | app topbar, FAQ | §6.6, §8.10 |
| Input field well | `neumo-inset` | all forms | §6.6, §8.9 |
| Toggle (theme, density) | `neumo-inset` + raised knob | `/settings` | §6.4, §6.6, §8.16 |
| Segmented control (period, filter) | `neumo-inset` well + `neumo-raised` pill | dashboard, fees | §6.6, §8.5 |
| Stepper (page-size, count) | `neumo-inset` well + `neumo-raised` ± buttons | `/students` pagination | §6.6, §8.18 |

The tables above are not a re-declaration; they are a navigation aid back into `13_UI_Guidelines.md`. When a web/ spec describes a surface or control not in this table, file it as a spec defect — either the surface is undocumented (and needs adding to §5.5 / §6.6) or the spec is using the wrong tier/recipe.

### 7.2 References

This directory is a contract on top of three external bodies of work. When a behaviour in a web/ file is unclear, the canonical reference is the named source:

- **Next.js 16 App Router docs** — RSC, Server Actions, Partial Prerendering (PPR), route groups, middleware, `metadata` API, `next/image`, `next/script`, `next/font`. Every claim about RSC vs Client island, `experimental.ppr: true`, or `force-static` + `revalidate` cites the App Router docs.
- **Vercel docs** — Blob (`@vercel/blob`), Edge Functions, Cron Jobs, Speed Insights, Web Analytics, project settings, preview deploys, environment variables, custom domains. Every claim about `vercel.json` knobs, `BLOB_READ_WRITE_TOKEN`, or `@vercel/analytics` cites the Vercel docs.
- **TanStack Query v5 docs** — `useQuery`, `useMutation`, optimistic updates via `onMutate`, `setQueryData`, `invalidateQueries`, `staleTime` / `gcTime` strategy, query-key conventions. Every claim about cache hierarchy or optimistic UI cites the TanStack Query best-practices guide.
- **Zustand v5 docs** — `create`, `persist` middleware, custom storage adapters, selectors, the "no cross-store coupling" rule. Every claim about UI state discipline cites the Zustand patterns guide.
- **Smashing Magazine — "A Visual Guide To React Server Components"** and **Josh W. Comeau — "The 'What' And 'Why' Of Server Components"** — the two clearest public write-ups of the RSC mental model; cited where `01_Architecture.md` and `02_State_and_Data_Flow.md` explain why a component is a Server Component rather than a Client island.

---

## 8. Platform Directory Cross-References

The `web/` directory is one of five platform directories under `Buddysaradhi_Planning/`. Each owns a distinct surface; together they form the agent-ready spec for the whole product. The cross-references below are the contract for which directory owns which decision — when a question straddles two directories, the table tells you which one is authoritative.

### 8.1 Platform Cross-Reference Diagram

```
                          ┌───────────────────────────┐
                          │  Buddysaradhi_Planning/ (root) │
                          │  17 top-level specs —     │
                          │  the WHY (vision, BR-*,   │
                          │  EC-*, P-*, AP-*)         │
                          └─────────────┬─────────────┘
                                        │
       ┌──────────────┬──────────────┬─┴────────────┬──────────────┬──────────────┐
       ▼              ▼              ▼              ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   web/      │ │  product/   │ │  mobile/    │ │  desktop/   │ │ deployment/ │ │    root     │
│  9 files    │ │  11 files   │ │  9 files    │ │  8 files    │ │  8 files    │ │  25 files   │
│ THE HOW     │ │ THE WHAT    │ │ RN + EAS    │ │ Tauri+Rust  │ │ Vercel infra│ │ THE WHY     │
│             │ │             │ │             │ │             │ │             │ │             │
│ /dashboard  ││ /landing     │ │ .apk/.ipa   │ │ .msi/.dmg/  │ │ vercel.json ││ BR-LED-06   │
│ /students   ││ /pricing     │ │ EAS Build   │ │ .AppImage   │ │ EAS channels│ │ EC-F-01..06 │
│ /fees       ││ /faq         │ │ EAS Update  │ │ Tauri upd.  │ │ release.yml │ │ AP-1..20    │
│ /attendance ││ /download    │ │ embedded    │ │ embedded    │ │ Blob bucket │ │ P-1..15     │
│ /settings   ││ /changelog   │ │ replica     │ │ replica     │ │             │ │             │
│ /  (mktg)   ││             │ │             │ │             │ │             │ │             │
│ (app) shell │ │  copy +     │ │  native UI  │ │  native UI  │ │             │ │             │
│ ↑ §5.5      │ │  ↑ §5.5     │ │  ↑ §5.5     │ │  ↑ §5.5     │ │             │ │             │
│ glass-strong│ │ glass hero/ │ │ glass-strong│ │ glass-strong│ │             │ │             │
│ sticky      │ │ feature/    │ │ sidebar +   │ │ sidebar +   │ │             │ │             │
│ sidebar +   │ │ pricing/    │ │ bottom tab  │ │ topbar      │ │             │ │             │
│ topbar      │ │ download    │ │             │ │             │ │             │ │             │
│ §6.6 neumo  │ │ cards       │ │ §6.6 neumo  │ │ §6.6 neumo  │ │             │ │             │
│ buttons +   │ │ §6.6 neumo  │ │ toggles +   │ │ buttons +   │ │             │ │             │
│ toggles     │ │ CTA buttons │ │ steppers    │ │ toggles     │ │             │ │             │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └─────────────┘
       │               │               │               │               │
       │  WHAT↔HOW     │               │  installers   │  installers   │
       │  bidirectional│               │  ←web/06 §3   │  ←web/06 §3   │
       │  product/02..09│              │               │               │
       │  → web/07 §4..9│              │               │               │
       └───────────────┘               │               │               │
                                       └───────────────┴───────────────┘
                                          shared per-user Turso DB
                                          + sync_outbox (BR-SYN-01)
                                          + tamper_hash (BR-LED-06)
                                          + tenant_secret (BR-SEC-*)
```

The diagram is the contract. Read left-to-right: the **WHY** (root) feeds the **WHAT** (`product/`) and the four **HOW** surface directories (`web/`, `mobile/`, `desktop/`). The two bottom rail lines summarise the two cross-cutting invariants every platform directory shares: (a) installers ship through the web download hub on Vercel Blob, and (b) every platform reads/writes the same per-user Turso DB with the same append-only ledger, `sync_outbox`, and `tenant_secret` discipline. The `deployment/` directory owns the infra that hosts `web/` (Vercel) and publishes the installers (`mobile/` + `desktop/` build artifacts). Glass/neumo annotations under each platform tile point to the design-system surface each one carries — they all reference the same `13_UI_Guidelines.md` §5.5 (glass coverage) + §6.6 (neumo coverage) maps, so the OS reads as one artefact across all five surfaces.

| Directory | Files | Words | Owns | Relationship to `web/` |
|---|---|---|---|---|
| `product/` | 11 | ~48,600 | The commercial landing page **content** — positioning, hero copy, feature showcase, download hub copy, pricing tiers, FAQ, CTA strategy, testimonials, SEO. Authored for a copywriter + marketer reader. | The **WHAT** to `web/`'s **HOW**. `product/04_Download_Hub.md` is the marketing spec for the download hub at `/download`; `web/07_Landing_Page.md §6` is its implementation. `product/02_Hero_and_Above_the_Fold.md` owns the H1 string; `web/07 §4` owns the route + RSC. When the two disagree on a fact, marketing owns the words; engineering owns the rendering. |
| `deployment/` | 7 | ~30,600 | Vercel hosting, Vercel Blob build storage, EAS build + update channels, release pipeline, CI/CD. Authored for a platform engineer. | The **WHERE**. `web/05_Deployment_Vercel.md` is the per-surface summary; `deployment/01_Vercel_Hosting.md` is the master. The Blob bucket layout in `web/06_Build_and_Release.md §3` mirrors `deployment/02_Vercel_Blob_Build_Storage.md §2`; the manifest schema is the same file, written once and read by both. |
| `mobile/` | 9 | ~32,600 | React Native + Expo + EAS Build + EAS Update. The mobile surface. Authored for a React Native engineer. | Shares the same per-user Turso DB and the same `sync_outbox` mutation log; the embedded-replica sync is mobile-only (the web app polls HTTP every 30 s — see `02_State_and_Data_Flow.md §3.4`). Mobile installers (`.apk`, `.ipa`) are distributed via the web download hub (`web/07 §6.2`); the Android APK URL is published into the Vercel Blob manifest by the mobile CI workflow. |
| `desktop/` | 8 | ~33,400 | Tauri + Rust desktop app. Authored for a Tauri/Rust engineer. | Shares the same per-user Turso DB. Desktop installers (`.msi`, `.dmg`, `.AppImage`) are distributed via the web download hub (`web/06 §3.1`, `web/07 §6.2`). The Tauri updater polls `manifests/desktop-stable.json` on Vercel Blob every 6 hours and verifies the manifest + binary minisign signatures against a hardcoded pubkey (see `web/06 §5`). |
| Top-level `*.md` | 17 | ~126,700 | The **WHY** — vision, product principles, core logic, data model, business rules, UI guidelines, security, backup, edge cases, future roadmap. Authored for everyone. | Every platform directory cites back to the master specs by stable ID (`BR-*`, `EC-*`, `P-*`, `AP-*`); no platform directory re-declares a master rule. When a platform directory and a master spec disagree, the master spec wins (top-level `AGENTS.md §0`). |

The five-directory layout is intentional: a copywriter authoring `product/02_Hero_and_Above_the_Fold.md` does not need to read `web/01_Architecture.md` to do their job, and a Vercel platform engineer authoring `deployment/02_Vercel_Blob_Build_Storage.md` does not need to read the React Component tree in `web/07_Landing_Page.md`. The cross-references are the contract; the boundaries are the leverage.

---

## 9. Commercial Landing Page — WHAT↔HOW Pair

The commercial landing page at `/` (production) is specified in two places that together form a single contract. Splitting the spec this way lets a copywriter and a Next.js engineer work in parallel without merge conflicts, and keeps the marketing voice and the engineering voice distinct.

- **`product/` directory (the WHAT)** — positioning, copy, funnel narrative, persona targeting, FAQ items, pricing tiers, testimonial roster, SEO keyword strategy, JSON-LD content briefs. Authored for a copywriter + marketer reader. The flagship files are `product/02_Hero_and_Above_the_Fold.md` (the H1 + subhead + trust line), `product/04_Download_Hub.md` (the five-card layout intent + persona narratives), `product/05_Pricing_and_Plans.md` (the ₹0/₹299/₹999 tiers), and `product/06_FAQ.md` (the 49-Q canonical FAQ).
- **`web/07_Landing_Page.md` (the HOW)** — route, React Server Component composition, Partial Prerendering, ISR-cached manifest fetch, JSON-LD injection, Lighthouse ≥95 budget, the five `DownloadCard` components, the FAQ accordion island, conversion-event tracking, the OG image generator, the `sitemap.ts` + `robots.ts` files. Authored for a Next.js engineer.

The two files are **bidirectionally** cross-referenced: every section in `web/07_Landing_Page.md` names its `product/*` content source, and every `product/*` file that lands on the public web names `web/07_Landing_Page.md` as its implementation. The contract between them is the **content surface** — the shape of props the implementation expects from the marketing spec. Where they disagree on a fact, `web/07_Landing_Page.md` is the engineering authority (route, rendering, fetch, bundle budget); where the marketing spec changes (a new headline, a new pricing tier, a new FAQ item), the implementation changes second. The codegen step `scripts/sync-product-content.ts` (run pre-build in CI) is the bridge: it reads `product/*.md` and emits `src/content/marketing/*.ts` typed modules that the RSC imports directly. The runtime has zero knowledge of `product/`.

---

## 10. Word Count Budget & Verification Checklist

The web/ directory targets **≥ 18,000 words across all 9 files** (verified with `wc -w` at every session end). Every file meets a per-file floor; the floors below are the minimum a future agent must not regress below when editing.

| File | Floor (words) | Current (words) | Margin |
|---|---|---|---|
| `README.md` | 1,800 | ~1,800 | 0 |
| `01_Architecture.md` | 2,800 | ~3,300 | +500 |
| `02_State_and_Data_Flow.md` | 2,800 | ~3,400 | +600 |
| `03_Auth_and_Provisioning.md` | 2,700 | ~3,150 | +450 |
| `04_API_Routes.md` | 2,800 | ~3,500 | +700 |
| `05_Deployment_Vercel.md` | 2,700 | ~2,800 | +100 |
| `06_Build_and_Release.md` | 2,700 | ~2,900 | +200 |
| `07_Landing_Page.md` | 4,500 | ~6,900 | +2,400 |
| `AGENTS.md` | 2,000 | ~3,400 | +1,400 |
| **Total** | **≥ 18,000** | **~30,900** | **+12,900** |

**Verification checklist** — run at the end of every web/ session, before the worklog entry:

1. `wc -w /home/z/my-project/Buddysaradhi_Planning/web/*.md` — every file at or above its floor; the total at or above 18,000.
2. `rg -i 'indigo|blue' web/*.md` — every hit is a prohibition ("no indigo", "never blue", "avoid indigo", the lint rule `no-indigo-accent`), never an accent. The allowed accents are Emerald `#00FF9D`, Cyan `#00F0FF`, Amber `#FFB300`, Flare `#FF5E00`, Violet `#B388FF`, on the cosmic canvas `#0f0c29` → `#24243e` → `#0a0a1a`.
3. `rg 'BR-[A-Z]+-\d+|EC-[A-Z]+-\d+|AP-\d+|P\d+' web/*.md` — every cited stable ID exists in the cited master spec (`12_Business_Rules.md`, `14_Edge_Cases.md`, `01_Product_Principles.md`).
4. `rg 'product/0[1-9]_' web/*.md` — every commercial copy source referenced from `web/` exists in `product/` (currently 11 files).
5. `rg 'web/07_Landing_Page.md' product/*.md` — every commercial spec that has a web surface points back to `web/07` (bidirectional contract).
6. `rg 'forceUpdateBefore|tamper_hash|sync_outbox' web/*.md` — the load-bearing invariants appear in every relevant spec; missing one is a regression.
7. `rg 'server-only|"use server"|"use client"' web/*.md` — the RSC/Server Action/Client island boundaries are explicit in every architecture, state, auth, and route file.

If any of those checks fails, the session is not done. Fix the regression, re-run the check, then update the worklog.

---

## 11. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ orientation file must carry ≥ 2 ASCII art mockups. The README already carries two mockups in §2.1 (file-index decision tree) and §8.1 (platform cross-reference diagram); the mockups below add three new views: (1) a refined navigation-flow decision tree that consolidates §3 (Where to Start) and §6 (Reading Order) into a single annotated flow, (2) a design-system surface cross-reference diagram showing how the same glass/neumo tokens surface across every web/ file, and (3) a verification-checklist flowchart turning the §10 checklist into a pass/fail decision tree. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the §20.2 character set is in use; accent colours are named, never hexed; cross-references use canonical IDs only.

### 11.1 Design System Reference — README Cross-Cut

> **The single rule (§6.6) carried into the README.** The README is the orientation index — it does not render UI itself, but it catalogues every UI surface and control the other 8 files render. The tables below are the **cheat-sheet** that mirrors `13_UI_Guidelines.md` §5.5 (glass) and §6.6 (neumo); the full maps live in those sections and in each web/ file's design-system callout.

| Surface (catalogued in README §7.1) | Glass tier | Where on web | Cross-ref |
|---|---|---|---|
| Marketing hero card (over cosmic gradient) | `glass` | `/` Hero | §5.5, `07_Landing_Page.md §4` |
| Marketing feature card (per principle) | `glass` + accent L-border | `/` Features grid | §5.4, §5.5, `07 §5` |
| Marketing pricing card (featured tier) | `glass-strong` + emerald glow | `/` Pricing | §5.5, `07 §8` |
| Marketing download card | `glass` | `/` Download Hub | §5.5, `07 §6.2` |
| Marketing FAQ accordion row | `glass-faint` band | `/` FAQ | §5.5, §8.4 |
| Marketing footer | `glass-faint` | all marketing routes | §5.5, §13 |
| App sidebar / topbar (GlassShell) | `glass-strong` sticky | `(app)/layout.tsx` | §5.5, `01_Architecture.md §3.3` |
| App KPI card | `glass` + accent L-border | `/dashboard` | §5.4, §5.5, §8.1 |
| App list row / table row | `glass-faint` band | `/students`, `/fees` | §5.5, §8.4 |
| App drawer / sheet | `glass-strong` | `/students/[id]` | §5.5, §8.7 |
| App modal dialog | `glass-strong` + backdrop | confirm / record-payment | §5.5, §8.7 |
| Auth card (login/signup/verify) | `glass-strong` centered | `(auth)/layout.tsx` | §5.5, `03 §3.2` |
| Toast | `glass-strong` + accent bar | everywhere | §5.5, §8.8 |

| Control (catalogued in README §7.1) | Neumo recipe | Where on web | Cross-ref |
|---|---|---|---|
| Primary CTA button | `neumo-raised` | Hero, Pricing CTA | §6.6, §8.2 |
| Pressed button (`:active`) | `neumo-pressed` | every CTA | §6.3, §6.6 |
| Search bar tray | `neumo-inset` | app topbar, FAQ | §6.6, §8.10 |
| Input field well | `neumo-inset` | all forms | §6.6, §8.9 |
| Toggle (theme, density) | `neumo-inset` + raised knob | `/settings` | §6.4, §6.6, §8.16 |
| Segmented control (period, filter) | `neumo-inset` well + `neumo-raised` pill | dashboard, fees | §6.6, §8.5 |
| Stepper (page-size, count) | `neumo-inset` well + `neumo-raised` ± buttons | `/students` pagination | §6.6, §8.18 |

> **References.** Next.js 16 App Router docs (RSC, Server Actions, PPR, route groups, middleware, `metadata` API, `next/image`, `next/script`, `next/font`); Vercel docs (Blob, Edge Functions, Cron Jobs, Speed Insights, Web Analytics, project settings, preview deploys, environment variables, custom domains); TanStack Query v5 docs (`useQuery`, `useMutation`, optimistic updates via `onMutate`, `setQueryData`, `invalidateQueries`, `staleTime` / `gcTime` strategy, query-key conventions); Zustand v5 docs (`create`, `persist` middleware, custom storage adapters, selectors, the "no cross-store coupling" rule); Smashing Magazine — "A Visual Guide To React Server Components"; Josh W. Comeau — "The 'What' And 'Why' Of Server Components"; CSS-Tricks — "An Overview Of React Server Components". These references are cited per-file in each web/ spec's design-system callout.

### 11.2 Mockup M1 — Navigation Flow (Consolidated "Where to Start" + "Reading Order")

The §3 decision tree and §6 reading order list are consolidated here into a single **navigation flow** that a new web agent can follow from "I'm new" to "I'm coding". The point: every task type has a defined reading path; every path terminates at the same three master specs (top-level `AGENTS.md` §2, `13_UI_Guidelines.md`, `12_Business_Rules.md`).

```
   Navigation Flow — "Which web/ file do I read first, and in what order?"
   ↑ consolidates §3 (Where to Start) + §6 (Reading Order) into one annotated flow

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  ENTRY: "I'm a new web agent; where do I begin?"                                                 │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 1: Read this README.md (you are here).                                                     │
   │  • §0 Who this is for · §1 Stack · §2 File index · §5 Non-negotiables · §10 Verification         │
   │  → next: AGENTS.md (this directory) — handoff instructions, stop-and-ask triggers                │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 2: Read AGENTS.md (this directory).                                                        │
   │  • §0 Prime directive · §1 Reading order · §5 Stop-and-ask · §8 "Done" definition                │
   │  → next: 01_Architecture.md — route groups, RSC/Client split, middleware, bundle budget           │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 3: Read 01_Architecture.md.                                                                │
   │  • §3 Route groups · §4 RSC vs Client island · §6 Middleware · §7 next.config.ts · §9 Bundle      │
   │  → next: top-level AGENTS.md §2 — the 10 non-negotiable rules (binding on every line of code)    │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 4: Read top-level AGENTS.md §2 (the 10 non-negotiables).                                   │
   │  • Rule 1 Append-only ledger · Rule 2 No PII third-party · Rule 3 No telemetry · Rule 4 5-screen │
   │    · Rule 5 No indigo/blue · Rule 6 Integer paise · Rule 7 sync_outbox · Rule 8 Backup crypto    │
   │    · Rule 9 No silent failures · Rule 10 WCAG 2.1 AA                                              │
   │  → next: branch by task type (the 6 leaves below)                                                │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
              ┌──────────────────┬──────────────────┬─┴─────────────────┬──────────────────┬──────────────┐
              ▼                  ▼                  ▼                   ▼                  ▼              ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────┐ ┌──────────────┐
   │ "I'm adding a    │ │ "I'm wiring      │ │ "I'm shipping    │ │ "I'm touching    │ │ "I'm onboarding│ │ "I'm touching │
   │  feature on      │ │  auth/provision  │ │  a new build     │ │  the commercial  │ │  a teammate to│ │  an /api/*   │
   │  /dashboard,     │ │  for a new user" │ │  and need to     │ │  landing page    │ │  the web proj"│ │  route"      │
   │  /students, ..." │ │                  │ │  upload to Blob" │ │  (/) or download│ │               │ │              │
   └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘ └──────┬───────┘ └──────┬───────┘
            │                    │                    │                    │                  │                │
            ▼                    ▼                    ▼                    ▼                  ▼                ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────┐ ┌──────────────┐
   │ 02_State_and_    │ │ 03_Auth_and_     │ │ 06_Build_and_    │ │ 07_Landing_      │ │ README.md →  │ │ 04_API_Routes│
   │  Data_Flow.md    │ │  Provisioning.md │ │  Release.md      │ │  Page.md         │ │ AGENTS.md →  │ │  .md         │
   │  + the screen    │ │  + 02_State_and_ │ │  + 05_Deployment │ │  + product/      │ │ 01_Architect │ │              │
   │  spec (04/05/06/ │ │  Data_Flow.md    │ │  _Vercel.md      │ │  (content source)│ │  ure.md skim │ │              │
   │  07/08)          │ │                  │ │  (env + region)  │ │                  │ │              │ │              │
   └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘ └──────┬───────┘ └──────┬───────┘
            │                    │                    │                    │                  │                │
            └────────────────────┴────────────────────┴────────────────────┴──────────────────┴────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  ALWAYS (every task, every path):                                                                │
   │  • top-level AGENTS.md §2 — the 10 non-negotiables (re-read before every PR)                     │
   │  • 13_UI_Guidelines.md — glass tiers (§5.5), neumo recipes (§6.6), no indigo/blue (§1.3)         │
   │  • 12_Business_Rules.md — every BR-* rule the task touches (cite by stable ID)                   │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  EXIT: "I'm coding."                                                                             │
   │  • smallest correct change · one PR per change · < 300 lines per commit                          │
   │  • bun run lint → bun run typecheck → agent-browser smoke → tail dev.log                         │
   │  • append worklog entry · cite spec ref in PR description                                        │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Glass/neumo annotation on each leaf ──────────────────────────────────────────────────────────────
     01_Architecture.md  : RSC + glass-strong sidebar/topbar; the architecture layer
     02_State_and_...    : controls on Client islands (neumo-inset wells, neumo-raised CTAs)
     03_Auth_and_...     : .glass-strong centered auth card + .neumo-inset OTP wells
     04_API_Routes.md    : server-only — NO glass, NO neumo (the explicit exception per §5.5)
     05_Deployment_...   : server-only — NO glass, NO neumo (infrastructure layer)
     06_Build_and_...    : server-only — NO glass, NO neumo (Blob + manifest layer)
     07_Landing_Page.md  : the heaviest design-system carrier — hero .glass, features .glass + accent,
                           pricing .glass / .glass-strong, download .glass, FAQ .glass-faint, CTAs .neumo-raised
     AGENTS.md           : no UI surfaces — handoff directive only
```

The navigation flow consolidates §3 and §6 into a single annotated diagram. A new web agent reads README → AGENTS → 01_Architecture → top-level AGENTS §2, then branches by task type into one of 6 leaves (feature work, auth, build/release, landing page, onboarding, API routes). Every leaf terminates at the same three master specs (top-level AGENTS §2, 13_UI_Guidelines, 12_Business_Rules) before the agent starts coding. The glass/neumo annotation on each leaf reminds the agent which design-system surfaces that file carries — `04_API_Routes`, `05_Deployment_Vercel`, and `06_Build_and_Release` are server-only (NO glass, NO neumo per §5.5 audit rule); `07_Landing_Page` is the heaviest design-system carrier.

### 11.3 Mockup M2 — Design-System Surface Cross-Reference (How the Same Tokens Surface Everywhere)

The §7.1 surface coverage table listed glass/neumo per surface; this mockup shows the **cross-reference diagram** — how the same canonical tokens (`.glass`, `.glass-strong`, `.glass-faint`, `.neumo-raised`, `.neumo-inset`, `.neumo-pressed`) surface across every web/ file. The point: every web/ file consumes the same design-system tokens; the README is the index that maps file → token → §-reference in `13_UI_Guidelines.md`.

```
   Design-System Surface Cross-Reference — same tokens, every web/ file
   ↑ every web/ file consumes the canonical tokens defined in 13_UI_Guidelines.md §5.5 + §6.6
   ↑ the README is the index; the per-file design-system callouts are the contracts

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  13_UI_Guidelines.md (the canonical design system)                                               │
   │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
   │  │  §5.5 Glass Backgrounds Coverage Map (surfaces)                                            │  │
   │  │  §6.6 Neumorphic Component Coverage Map (controls)                                         │  │
   │  │  §8   Component Vocabulary (20 components with ASCII mockups as templates)                │  │
   │  │  §20  ASCII Art Conventions (character set, layout rules, mockup types)                   │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  (canonical tokens flow down to every web/ file)
              ┌──────────────────┬──────────────────┬─┴─────────────────┬──────────────────┬──────────────┐
              ▼                  ▼                  ▼                   ▼                  ▼              ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────┐ ┌──────────────┐
   │ 01_Architecture  │ │ 02_State_and_    │ │ 03_Auth_and_     │ │ 04_API_Routes    │ │ 05_Deployment│ │ 06_Build_and │
   │   .md            │ │  Data_Flow.md    │ │  Provisioning.md │ │   .md            │ │  _Vercel.md  │ │  _Release.md │
   │ ──────────────── │ │ ──────────────── │ │ ──────────────── │ │ ──────────────── │ │ ──────────── │ │ ──────────── │
   │ Surfaces:        │ │ Surfaces:        │ │ Surfaces:        │ │ Surfaces:        │ │ Surfaces:    │ │ Surfaces:    │
   │  • root canvas   │ │  • KPI card      │ │  • auth card     │ │  (NONE — server- │ │  (NONE —     │ │  (NONE —     │
   │    (raw gradient)│ │    .glass+accent │ │    .glass-strong │ │   only; NO glass,│ │   server-    │ │   server-    │
   │  • marketing nav │ │  • list row      │ │    + backdrop    │ │   NO neumo per   │ │   only; NO   │ │   only; NO   │
   │    .glass-faint  │ │    .glass-faint  │ │  • spinner card  │ │   §5.5 audit     │ │   glass, NO  │ │   glass, NO  │
   │  • auth card     │ │  • drawer        │ │    .glass        │ │   rule exception)│ │   neumo)     │ │   neumo)     │
   │    .glass-strong │ │    .glass-strong │ │  • lockout       │ │                  │ │              │ │              │
   │  • app sidebar   │ │  • modal         │ │    overlay       │ │ Controls:        │ │ Controls:    │ │ Controls:    │
   │    .glass-strong │ │    .glass-strong │ │    .glass-strong │ │  (NONE — server- │ │  (NONE)      │ │  (NONE)      │
   │  • app topbar    │ │  • toast         │ │  • toast         │ │   only)          │ │              │ │              │
   │    .glass-strong │ │    .glass-strong │ │    .glass-strong │ │                  │ │              │ │              │
   │  • app footer    │ │                  │ │                  │ │ Consumer surface │ │ Consumer     │ │ Consumer     │
   │    .glass-faint  │ │ Controls:        │ │ Controls:        │ │  (in-app):       │ │  surface:    │ │  surface:    │
   │                  │ │  • period seg    │ │  • email input   │ │  • toast .glass- │ │  • 500/404   │ │  • Download  │
   │ Controls:        │ │    .neumo-inset  │ │    .neumo-inset  │ │    strong + 4px  │ │    page .glass│ │    Card .glass│
   │  • ⌘K trigger    │ │  • filter seg    │ │  • OTP wells     │ │    accent bar    │ │  • Retry btn │ │  • changelog │
   │    .neumo-raised │ │    .neumo-inset  │ │    .neumo-inset  │ │  • confirm modal │ │    .neumo-   │ │    .glass-   │
   │  • search bar    │ │  • PIN toggle    │ │  • submit btn    │ │    .glass-strong │ │    raised    │ │    faint     │
   │    .neumo-inset  │ │    .neumo-inset  │ │    .neumo-raised │ │  • list row      │ │  • Go home   │ │  • TestFlight│
   │  • sidebar       │ │  • stepper       │ │  • Google OAuth  │ │    .glass-faint  │ │    ghost link│ │    card .glass│
   │    collapse      │ │    .neumo-inset  │ │    .neumo-raised │ │                  │ │              │ │              │
   │    .neumo-raised │ │                  │ │    (transparent) │ │                  │ │              │ │              │
   └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────┘ └──────────────┘

   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────────────────────────────────────────────────────┐
   │ 07_Landing_Page  │ │ AGENTS.md        │ │ README.md (this file — the index)                                          │
   │   .md            │ │ ──────────────── │ │ ──────────────                                                              │
   │ ──────────────── │ │ Surfaces:        │ │ Surfaces: (catalogues all of the above in §7.1)                            │
   │ Surfaces:        │ │  (NONE — handoff │ │  • 13 surfaces from 01 + 03 + 07 (glass tiers)                             │
   │  • hero .glass   │ │   directive only)│ │  • 7 controls from 02 + 07 (neumo recipes)                                 │
   │  • feature .glass│ │                  │ │                                                                            │
   │    + accent      │ │ Controls:        │ │ Controls: (catalogues all of the above in §7.1)                            │
   │  • pricing .glass│ │  (NONE)          │ │  • cross-references each surface/control back to §5.5 / §6.6               │
   │    / .glass-strong│ │                  │ │                                                                            │
   │  • download .glass│ │                  │ │ The README is the NAVIGATION AID — not a re-declaration.                   │
   │  • FAQ row       │ │                  │ │ When a web/ spec describes a surface or control not in this table,          │
   │    .glass-faint  │ │                  │ │ file it as a spec defect per §5.5 audit rule.                              │
   │  • testimonial   │ │                  │ │                                                                            │
   │    .glass-faint  │ │                  │ │                                                                            │
   │  • final CTA     │ │                  │ │                                                                            │
   │    .glass-strong │ │                  │ │                                                                            │
   │  • footer        │ │                  │ │                                                                            │
   │    .glass-faint  │ │                  │ │                                                                            │
   │ Controls:        │ │                  │ │                                                                            │
   │  • hero CTA      │ │                  │ │                                                                            │
   │    .neumo-raised │ │                  │ │                                                                            │
   │  • download CTA  │ │                  │ │                                                                            │
   │    .neumo-raised │ │                  │ │                                                                            │
   │  • pricing CTA   │ │                  │ │                                                                            │
   │    .neumo-raised │ │                  │ │                                                                            │
   │  • FAQ search    │ │                  │ │                                                                            │
   │    .neumo-inset  │ │                  │ │                                                                            │
   │  • billing toggle│ │                  │ │                                                                            │
   │    .neumo-inset  │ │                  │ │                                                                            │
   │  • newsletter    │ │                  │ │                                                                            │
   │    input .neumo- │ │                  │ │                                                                            │
   │    inset; sub-   │ │                  │ │                                                                            │
   │    scribe .neumo-│ │                  │ │                                                                            │
   │    raised violet │ │                  │ │                                                                            │
   └──────────────────┘ └──────────────────┘ └──────────────────────────────────────────────────────────────────────────┘

   ── Token → file coverage matrix ──────────────────────────────────────────────────────────────────────
     Token            │ 01  │ 02  │ 03  │ 04  │ 05  │ 06  │ 07  │ AGENTS │ README
     ─────────────────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼────────┼────────
     .glass           │  ✓  │  ✓  │  ✓  │  —  │  —  │  —  │  ✓  │   —    │   ✓ (catalogue)
     .glass-strong    │  ✓  │  ✓  │  ✓  │  ✓* │  ✓* │  ✓* │  ✓  │   —    │   ✓ (catalogue)
     .glass-faint     │  ✓  │  ✓  │  —  │  —  │  —  │  —  │  ✓  │   —    │   ✓ (catalogue)
     .neumo-raised    │  ✓  │  ✓  │  ✓  │  ✓* │  ✓* │  ✓* │  ✓  │   —    │   ✓ (catalogue)
     .neumo-inset     │  ✓  │  ✓  │  ✓  │  —  │  —  │  —  │  ✓  │   —    │   ✓ (catalogue)
     .neumo-pressed   │  —  │  —  │  —  │  —  │  —  │  —  │  ✓  │   —    │   ✓ (catalogue)
     ─────────────────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┴────────┴────────
     ✓  = file directly renders the token
     ✓* = file does NOT render the token itself, but its consumer surfaces (toast, 500 page,
          DownloadCard) do — catalogued in the file's design-system callout
     —  = file does not touch the token (server-only or handoff-only)

   ── The single rule (§6.6), restated for the README ───────────────────────────────────────────────────
     If it is a CONTROL (button, toggle, input, stepper, segmented control), it is NEUMORPHIC.
     If it is a SURFACE (card, panel, row, modal, sidebar, topbar, footer), it is GLASS.
     Never invert. Never mix. A glass button or a neumorphic content panel is a design-system
     violation — file it. The README is the index that enforces this; the per-file design-system
     callouts are the contracts.
```

The cross-reference diagram shows every web/ file consuming the same canonical tokens from `13_UI_Guidelines.md` §5.5 (glass) and §6.6 (neumo). The token → file coverage matrix at the bottom is the audit: `01_Architecture`, `02_State_and_Data_Flow`, `03_Auth_and_Provisioning`, and `07_Landing_Page` directly render glass + neumo tokens; `04_API_Routes`, `05_Deployment_Vercel`, and `06_Build_and_Release` are server-only (NO glass, NO neumo — the explicit §5.5 audit-rule exception) but catalogue their consumer surfaces; `AGENTS.md` is handoff-only (no UI); `README.md` is the index that catalogues all 13 surfaces + 7 controls and cross-references each back to §5.5 / §6.6. The single rule (§6.6) is restated at the bottom — the README is the index that enforces it; the per-file design-system callouts are the contracts.

### 11.4 Mockup M3 — Verification Checklist Flowchart (Pass/Fail Decision Tree)

The §10 narrative listed the 7 verification checks; this mockup turns them into a **pass/fail decision tree** that a web agent runs at session end. The point: every check has a defined pass condition and a defined fail-recovery; the session is not done until all 7 pass.

```
   Verification Checklist — Pass/Fail Decision Tree (run at session end, before worklog)
   ↑ every check has a pass condition + a fail-recovery; the session is NOT done until all 7 pass

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  START: "I think I'm done. Run the verification checklist."                                      │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  CHECK 1: wc -w web/*.md                                                                         │
   │  • pass: every file ≥ its floor; total ≥ 18,000 words                                            │
   │  • fail: identify the regressed file; add content (do NOT pad — add real spec)                   │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  CHECK 2: rg -i 'indigo|blue' web/*.md                                                           │
   │  • pass: every hit is a PROHIBITION ("no indigo", "never blue", "avoid indigo",                  │
   │    the lint rule `no-indigo-accent`), never an accent                                            │
   │  • fail: replace the indigo/blue accent with emerald/cyan/amber/flare/violet per §2.4            │
   │    (file a design-system violation; the lint rule `no-indigo-accent` should have caught it)      │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  CHECK 3: rg 'BR-[A-Z]+-\d+|EC-[A-Z]+-\d+|AP-\d+|P\d+' web/*.md                                 │
   │  • pass: every cited stable ID exists in the cited master spec                                   │
   │    (BR-* in 12_Business_Rules.md, EC-* in 14_Edge_Cases.md, AP-* + P-* in 01_Product_Principles)│
   │  • fail: fix the stale reference (wrong §X, wrong ID) — do NOT change the ID itself              │
   │    (renaming a BR/EC/AP/P ID is a separate RFC process per 12_Business_Rules.md §16)             │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  CHECK 4: rg 'product/0[1-9]_' web/*.md                                                          │
   │  • pass: every commercial copy source referenced from web/ exists in product/ (11 files)         │
   │  • fail: either the product/ file is missing (create it) OR the web/ reference is wrong (fix it) │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  CHECK 5: rg 'web/07_Landing_Page.md' product/*.md                                               │
   │  • pass: every commercial spec that has a web surface points back to web/07 (bidirectional)      │
   │  • fail: add the back-reference in the product/ file (the contract is bidirectional — §9)        │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  CHECK 6: rg 'forceUpdateBefore|tamper_hash|sync_outbox' web/*.md                                │
   │  • pass: the load-bearing invariants appear in every relevant spec                               │
   │    (sync_outbox in 01, 02, 04; tamper_hash in 04, 06; forceUpdateBefore in 06)                   │
   │  • fail: add the missing invariant reference to the relevant spec                                │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  CHECK 7: rg 'server-only|"use server"|"use client"' web/*.md                                    │
   │  • pass: RSC/Server Action/Client island boundaries are explicit in every architecture, state,   │
   │    auth, and route file                                                                          │
   │  • fail: add the missing directive ("use client" / "use server" / "server-only" comment)         │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  ALL 7 PASS: "The session is done."                                                              │
   │  → append worklog entry (---, Task ID, Agent, Task, Work Log, Stage Summary)                     │
   │  → cite spec ref in PR description (## Spec ref: <file> §<section>)                              │
   │  → report back: files changed, verification result, next recommended task                        │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Fail-recovery discipline ─────────────────────────────────────────────────────────────────────────
     • a failed check is a REGRESSION — fix it before the worklog entry, not after
     • a failed check 2 (indigo/blue) is a DESIGN-SYSTEM violation — file it in the PR description
     • a failed check 3 (stale ID) is a SPEC defect — fix the §-reference; do NOT rename the ID
     • a failed check 6 (missing invariant) is a LOAD-BEARING regression — the spec is incomplete
     • "it compiles" is never sufficient — a green build is the floor, not the ceiling (AGENTS.md §8)
```

The flowchart shows the 7 verification checks as a serial pass/fail decision tree. Each check has a defined pass condition and a defined fail-recovery — the session is not done until all 7 pass. The fail-recovery discipline at the bottom restates the severity: a failed check 2 (indigo/blue) is a design-system violation; a failed check 3 (stale ID) is a spec defect (fix the §-reference, do NOT rename the ID — that's a separate RFC per `12_Business_Rules.md` §16); a failed check 6 (missing invariant) is a load-bearing regression. The closing reminder — "it compiles" is never sufficient — echoes `AGENTS.md` §8.

---

*This directory is the contract for the web surface. When the implementation diverges, this spec wins — unless this spec is wrong, in which case you amend it first, then the code, then the worklog. The order matters.*
