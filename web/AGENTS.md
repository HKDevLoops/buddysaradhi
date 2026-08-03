# AGENTS.md — Web Handoff Directive

> Read this file second (after `README.md`) before writing or modifying any code under `src/` for the Buddysaradhi web surface. It is the operating manual for the next web agent. Top-level `AGENTS.md` governs the whole monorepo; this file governs the web slice.

---

## 0. Prime Directive

> **Implement only what is specified. If a feature does not fit the 5-screen rule, STOP and ask.** Top-level `AGENTS.md` §0 says: "Code without a spec is tech debt." On web, the spec is this directory + the top-level specs it cross-references. If you cannot point to a sentence in one of those files that authorises the change, you are writing orphan code — delete it and start over.

The 5-screen rule (top-level `AGENTS.md` Rule 4, P2) is the single tightest constraint on the web surface. **Five routes inside `(app)`**, plus `(marketing)` and `(auth)`. A 6th top-level route is a stop-and-ask trigger (§5 below). A new sub-route (e.g. `/students/[id]/invoices`) is allowed and encouraged for deep-linking, but it renders inside the existing `GlassShell` and adds no sidebar entry.

### 0.1 Platform Boundary & Sequencing — You Are the Web Agent

> **Read `../16_Platform_Delivery_Sequence.md` before any cross-platform thought.** It is the process keystone this project was missing: exactly one platform `In-Flight` at a time, hard Production Gates between them. The "agent does all platforms at once" failure that produced hallucinations is now a stop-and-ask violation.

You are the **Web** agent (platform P1 — the first to ship, the only one In-Flight right now). The boundary rules:

- **You may edit:** `apps/web/` (the sandbox `src/`), `buddysaradhi_Planning/web/*.md`, append-only `worklog.md`, and `packages/*` **only via an RFC** (`docs/rfc/`). You also own the Web-phase infra specs `../17_API_Gateway_System.md`, `../18_Microservice_Architecture.md`, `../19_Concurrency_and_Testing.md`, `../20_3D_Product_Page.md` until the Web Production Gate clears.
- **You may NOT create or edit:** `apps/mobile/`, `apps/desktop/`, `src-tauri/`, `buddysaradhi_Planning/mobile/*.md`, `buddysaradhi_Planning/desktop/*.md`. Mobile and Desktop are **LOCKED** until the worklog carries `Task ID: WEB-PROD-GATE … Next platform unlocked: MOBILE.` (and, for desktop, a later `MOBILE-PROD-GATE … Next platform unlocked: DESKTOP.`).
- **Check the status block** at the top of `/home/z/my-project/worklog.md` first. If `In-Flight` is not `WEB`, you are not cleared to work — STOP and run the close-out (`../AGENTS.md` §9.2.2).
- **All network access goes through the API gateway** (`../17_API_Gateway_System.md`) via the typed SDK from `packages/shared/sdk`. No hardcoded URLs, no direct Prisma calls from client components, no per-platform fetch wrappers. The `no-hardcoded-ingress` lint enforces this.
- **Cross-platform needs** (a shared-schema field, a contract change) are an **RFC**, never a unilateral edit to another platform's tree.

One platform — web — to production. Then, and only then, mobile begins.

---

## 1. Where to Start

The mandatory reading order for a new web agent:

1. This directory's `README.md` — orientation, stack, decision tree, platform cross-references, verification checklist.
2. This `AGENTS.md` — handoff instructions, stop-and-ask triggers, "done" definition.
3. `01_Architecture.md` — route groups, RSC/Client island split, middleware, `next.config.ts`, bundle budget.
4. Top-level `AGENTS.md` §2 — the 10 non-negotiable rules.
5. `02_State_and_Data_Flow.md` — TanStack + Zustand + IndexedDB layering.
6. `03_Auth_and_Provisioning.md` — Supabase + Turso provisioning flow.
7. The screen spec you're working on (e.g. `04_Dashboard.md` for `/dashboard` work).
8. `13_UI_Guidelines.md` — glass tiers, accent map, the "no indigo/blue primaries" rule.
9. (If writing route handlers) `04_API_Routes.md` — every `/api/*` contract.
10. (If shipping) `05_Deployment_Vercel.md` — env vars, regions, rollback.
11. (If touching the download hub or manifests) `06_Build_and_Release.md` — Vercel Blob layout, manifest schema.
12. (If touching the commercial landing page `/`, `/pricing`, `/faq`, `/download`, `/changelog/*`) `07_Landing_Page.md` — and its content source `product/04_Download_Hub.md` (the WHAT) alongside it.

Then look at the existing implementation patterns in:

- `src/app/page.tsx` — the current landing page; the canonical reference for Framer Motion, `CountUp`, `SectionTag`, `useMounted`, `ACCENT_MAP` usage.
- `src/components/buddysaradhi/primitives.tsx` — `useMounted`, `SectionTag`, `NeumoToggle`, `CountUp`. Compose from these; do not reinvent.
- `src/components/buddysaradhi/data.ts` — `ACCENT_MAP`, `SPECS`, `SCREENS`, `ENGINES`, `PALETTE`. The single source of truth for accent colors and screen metadata.
- `src/app/api/spec/route.ts` — the **template** for every file-serving API route. Set allowlist + `path.basename` + `Cache-Control: no-store`.

Then implement. Always: smallest correct change → `bun run lint` → agent-browser smoke → worklog.

### 1.1 Reading-Order Flowchart

```
                       ┌────────────────────────────┐
                       │  New web agent boots up.    │
                       │  Read worklog last 2 entries│
                       └─────────────┬──────────────┘
                                     │
                                     ▼
                       ┌────────────────────────────┐
                       │  STEP 1  (orientation)      │
                       │  web/README.md              │
                       │  + web/AGENTS.md (this file)│
                       │  ↑ surface cross-refs       │
                       └─────────────┬──────────────┘
                                     │
                                     ▼
                       ┌────────────────────────────┐
                       │  STEP 2  (constitution)     │
                       │  top-level AGENTS.md §2     │
                       │  → 10 non-negotiables       │
                       └─────────────┬──────────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  ▼                  ▼                  ▼
        ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
        │  STEP 3a route/ │ │  STEP 3b state/ │ │  STEP 3c auth   │
        │  layout work    │ │  cache work     │ │  provision work │
        │  → 01_Arch.md   │ │  → 02_State.md  │ │  → 03_Auth.md   │
        │  ↑ §5.5 glass-  │ │  ↑ §6.6 neumo   │ │  ↑ §5.5 auth    │
        │  strong sidebar │ │  on Client ctrls│ │  card =         │
        │  + topbar       │ │  (toggles, etc.)│ │  glass-strong + │
        └────────┬────────┘ └────────┬────────┘ │  backdrop       │
                 │                   │          └────────┬────────┘
                 │                   │                   │
                 └───────────────────┼───────────────────┘
                                     ▼
                       ┌────────────────────────────┐
                       │  STEP 4  (screen + DS)      │
                       │  Screen spec 04..08         │
                       │  + 13_UI_Guidelines.md      │
                       │  ↑ §5.5 glass coverage map  │
                       │  ↑ §6.6 neumo coverage map  │
                       └─────────────┬──────────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  ▼                  ▼                  ▼
        ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
        │  STEP 5a        │ │  STEP 5b        │ │  STEP 5c        │
        │  route handler  │ │  deploy / env   │ │  landing page   │
        │  → 04_API.md    │ │  → 05_Deploy.md │ │  → 07_Landing   │
        │  (server-only;  │ │  (no UI surface)│ │  + product/     │
        │  no glass tier) │ │                 │ │  ↑ §5.5 glass   │
        │                 │ │                 │ │  hero/feature/  │
        │                 │ │                 │ │  pricing/dl/FAQ │
        │                 │ │                 │ │  §6.6 neumo CTA │
        └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
                 └───────────────────┼───────────────────┘
                                     ▼
                       ┌────────────────────────────┐
                       │  STEP 6  (build / release)  │
                       │  Only if touching the       │
                       │  download hub / Blob /      │
                       │  Tauri updater → 06_Build   │
                       │  (server-only; no glass)    │
                       └─────────────┬──────────────┘
                                     │
                                     ▼
                       ┌────────────────────────────┐
                       │  IMPLEMENT                  │
                       │  smallest correct change →  │
                       │  bun run lint → smoke →     │
                       │  worklog                    │
                       └─────────────────────────────┘
```

The flowchart reads top-down. Every "STEP n" box names a single file to read in order; the design-system callouts (§5.5 / §6.6) point to which glass tier or neumorphic recipe the file's surfaces use. The branches at STEP 3 and STEP 5 reflect that most tasks touch only one of the three pillars — read the pillar file, skip the other two. STEP 4 (the screen spec + the design-system chapter) is mandatory for every task that touches UI; STEP 6 is mandatory only for the download-hub / Blob / updater slice.

---

## 2. File Map — This Directory → `src/`

Every file in this directory governs a specific slice of `src/`. If you're touching code outside the slice governed by a file in this directory, you need a different spec.

| This directory | Governs (under `src/`) |
|---|---|
| `README.md` | — (orientation only, no code authority) |
| `01_Architecture.md` | `app/` (route groups, layouts, page.tsx files); `next.config.ts`; `middleware.ts`; `app/globals.css` (Tailwind tokens); `app/providers.tsx`. |
| `02_State_and_Data_Flow.md` | `stores/`; `hooks/` (sync-poll, mounted); `server/queries/`; `server/actions/`; `server/schemas/`; `lib/turso/`; `lib/crypto/`. |
| `03_Auth_and_Provisioning.md` | `lib/supabase/`; `app/(auth)/`; `app/signup/provision/`; `middleware.ts` (auth branch); Supabase Edge Function `provision-db/`. |
| `04_API_Routes.md` | `app/api/` (every `route.ts`); `server/rate-limit.ts`. |
| `05_Deployment_Vercel.md` | `vercel.json`; `.env.example`; GitHub Actions `release.yml` (web-deploy portion); Vercel project settings. |
| `06_Build_and_Release.md` | `app/(marketing)/download/`; `scripts/retain-blob-releases.ts`; `scripts/rotate-encryption-key.ts`; GitHub Actions `release.yml` (Blob-upload portion). |
| `07_Landing_Page.md` | `app/(marketing)/` (the commercial landing route tree — `/`, `/pricing`, `/faq`, `/download`, `/changelog/*`, `/demo/*`, `opengraph-image.tsx`, `sitemap.ts`, `robots.ts`); `components/marketing/*`; `content/marketing/*` (the codegen output of `product/`); `api/releases/latest/route.ts`. |
| `AGENTS.md` (this file) | — (operating manual, no code authority) |

When a code change spans multiple slices (e.g. adding a new Server Action that touches both state and auth), read every governing file before starting.

---

## 3. Code Style

Inherits top-level `AGENTS.md` §6 in full. The web-specific elaborations:

### 3.1 TypeScript

- **Strict mode.** `"strict": true` (the sandbox `tsconfig.json` has `noImplicitAny: false` — a concession; prod target is `true`).
- **No `any`.** Use `unknown` and narrow with a type guard or Zod parse.
- **No `as` casts** unless paired with a `// SAFETY:` comment explaining the invariant.
- **Functional React.** No class components. Hooks for state.
- **Server Components for data; Client Components for interactive glass.** `"use client"` only when the component uses `useState`/`useEffect`/browser APIs/Framer Motion/`cmdk`/TanStack Query.
- **Server Actions for mutations.** Mutations never run in the browser. No `fetch('/api/...')` from a Client Component (lint: `no-fetch-in-client`, FM-05).
- **Prisma for the sandbox dev DB only.** Production per-user DBs are raw SQL over `@libsql/client`. Prisma is not in the production runtime.
- **Zod for all input validation.** Every server action, every API route, every form. Types are inferred from Zod (`type Foo = z.infer<typeof FooSchema>`).

### 3.2 Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Functions, variables | camelCase | `recordPayment`, `studentBalancePaise` |
| React components, types, interfaces | PascalCase | `GlassShell`, `LedgerEntryDTO` |
| Constants, enums | SCREAMING_SNAKE_CASE | `MAX_PIN_ATTEMPTS`, `LEDGER_ENTRY_TYPES` |
| Component files | kebab-case | `glass-shell.tsx`, `student-row.tsx` |
| Non-component files | camelCase | `recordPayment.ts`, `formatINR.ts` |
| Spec files (this dir) | Numbered snake-case | `01_Architecture.md`, `04_API_Routes.md` |
| Zod schemas | PascalCase + `Schema` suffix | `LedgerEntrySchema`, `StudentInputSchema` |
| Server Actions | camelCase + `Action` suffix | `recordPaymentAction`, `createStudentAction` |
| Server-side query fetchers | camelCase + `get`/`list` prefix | `getDashboardKPIs`, `listStudents` |
| Route handlers | `route.ts` (fixed) | `app/api/students/route.ts` |

### 3.3 Money

- **Integer paise.** Always. `number` for values < 2^53; `bigint` for larger. `formatINR(paise)` for display.
- **No `+`/`-`/`*` on money.** Use `paiseAdd(a, b)`, `paiseMul(a, n)` from `lib/crypto/paise.ts`.
- **Lint `no-float-money`** rejects any `+`/`-`/`*` on a variable ending in `paise` or `minor`.

### 3.4 Glass Tiers + Accent Map

- **Glass tiers:** `glass` (default), `glass-strong` (modals, active nav), `glass-faint` (zebra rows). Never raw `rgba()` for surfaces — always the tier class.
- **Accent map:** `ACCENT_MAP` from `src/components/buddysaradhi/data.ts`. The five keys: `emerald`, `cyan`, `amber`, `flare`, `violet`. Never indigo. Never blue. The lint rule `no-indigo-accent` rejects `#4F46E5`, `blue-600`, `indigo-*`, `sky-*` as primary accents.
- The cosmic canvas colors (`#0f0c29`, `#24243e`, `#0a0a1a`) are **neutral** — they're not accents.

### 3.5 Sticky Footer

Root layout is `min-h-screen flex flex-col`. The footer is `mt-auto`. Short pages: footer sticks to the bottom of the viewport. Long pages: footer is pushed below the fold. Mandatory (top-level `AGENTS.md` §6.3, `13_UI_Guidelines.md` §13).

### 3.6 No `console.log` in Prod

Use the typed logger (`log.info`, `log.warn`, `log.error`) from `lib/logger.ts`, which routes to `audit_log` for sensitive events and to Vercel logs for diagnostic events. `console.log` is a lint failure (top-level `AGENTS.md` Rule 9, AP-9).

### 3.7 No Silent Failures

Every `catch` either re-throws or returns a typed `Err`. No empty `catch {}`. No `toast.error('Something went wrong')` that swallows the typed error — surface the typed error code via toast AND write an `audit_log` row `action='error_unhandled'` (top-level `AGENTS.md` Rule 9, AP-9, FM-08).

---

## 4. Testing Protocol

In the sandbox, tests are not written unless explicitly requested (top-level `AGENTS.md` §7.1). When you DO test, follow this protocol in order:

### 4.1 Lint

```bash
bun run lint
```

Must produce **0 errors, 0 warnings**. Fix all errors before staging. The lint runs:

- ESLint (with `eslint-config-next` and the custom design-system rules).
- Prettier (format check).
- `no-indigo-accent`, `no-float-money`, `no-empty-catch`, `no-color-only-status`, `no-fetch-in-client`, `no-hardcoded-origin`.

### 4.2 Typecheck

```bash
bun run typecheck   # = tsc --noEmit
```

Must produce 0 errors. The sandbox `tsconfig.json` has `noImplicitAny: false`; the prod target is `true`. Do not add new `any` even if the sandbox permits it.

### 4.3 Agent-Browser Smoke

Using the `agent-browser` skill:

1. Navigate to `http://localhost:3000/` (or the preview URL).
2. Assert: hero renders, no console errors, sticky footer is at the bottom on a short page and pushed down on a long page.
3. Switch to `/dashboard` (or the screen you changed).
4. Perform the primary interaction (click a KPI card, mark attendance, record a payment).
5. Assert: the interaction succeeds; no toast error; the footer still behaves.
6. Take a screenshot; compare to the prior known-good screenshot if available.

### 4.4 Dev Log Scan

```bash
tail -100 dev.log | rg 'Error|Warning|Hydration|Suspense|did not match'
```

Any unexpected line is a blocker. Expected lines: HMR notifications, Next.js dev-only warnings about experimental features. Unexpected: hydration mismatches, runtime errors, `Suspense` fallback warnings.

### 4.5 Worklog Update

Append a `---`-delimited section to `/home/z/my-project/worklog.md` with Task ID, Agent, Task, Work Log, Stage Summary. See §6 below.

---

## 5. Stop-and-Ask Triggers

The following situations require a pause and human review **before** the PR is opened. An autonomous web agent MUST NOT proceed unilaterally. (Inherits top-level `AGENTS.md` §8 plus web-specific triggers.)

| # | Trigger | Why sensitive | Action |
|---|---|---|---|
| W1 | Adding a 6th top-level route under `(app)` (e.g. `/reports`, `/communications`) | Violates the 5-screen rule (P2, top-level Rule 4). | Stop. Open a principle-amendment RFC. Do not implement. |
| W2 | Adding an indigo or blue primary accent (e.g. `bg-indigo-600`, `text-blue-500`) | Violates the brand-distinctiveness rule (AP-6, top-level Rule 5). | Stop. Replace with `ACCENT_MAP.emerald` or `.cyan`. |
| W3 | Any `UPDATE` or `DELETE` on `ledger_entries` (in a route, server action, or raw SQL) | Violates the append-only invariant (top-level Rule 1, BR-LED-06). | Stop. INSERT a `VOID` row with `reverses_entry_id`. |
| W4 | Adding a `fetch()` to a new origin (not in the CSP `connect-src` allowlist) | Violates the no-network-calls rule (top-level Rule 2). | Stop. If Turso or Vercel Blob, add to CSP. If anything else, draft a principle-amendment RFC. |
| W5 | Adding a telemetry SDK (Sentry, Mixpanel, PostHog, GA, Amplitude) | Violates the no-telemetry rule (top-level Rule 3, AP-10). | Stop. Use Vercel Speed Insights + Web Analytics (already allowed). |
| W6 | Storing money as a `float`/`REAL` or doing arithmetic on money with `+`/`-`/`*` | Violates the integer-paise rule (top-level Rule 6, BR-M-01). | Stop. Use `paiseAdd`/`paiseMul`; store as `INTEGER`. |
| W7 | Skipping the `sync_outbox` INSERT in a Server Action | Violates the offline-first rule (top-level Rule 7, BR-SYN-01). | Stop. Add the outbox INSERT in the same `batch()` transaction. |
| W8 | Changing the crypto envelope (AES-256-GCM, Argon2id, envelope layout) | A bug leaks every backup; a migration bricks old backups (top-level Rule 8). | Stop. 2 reviewers incl. security owner. |
| W9 | Adding an empty `catch {}` or swallowing a typed error | Violates the no-silent-failures rule (top-level Rule 9, AP-9). | Stop. Throw or return `Err`; surface via toast + `audit_log`. |
| W10 | Adding a `console.log` in prod code | Lint failure (AP-9). | Stop. Use the typed logger. |
| W11 | Any change to `AGENTS.md` (top-level or this directory) | The constitution; drift propagates everywhere. | Stop. Orchestrator sign-off required. |
| W12 | Any PR > 500 lines | Large PRs hide bugs. | Stop. Split into smaller PRs. If impossible, 2 reviewers + flag in PR description. |
| W13 | Touching the `tenant_secret` (reading, exporting, logging) | A leak breaks every receipt hash ever issued. | Stop. `tenant_secret` lives only in the per-user Turso DB `app_state` table; never in logs, never in backups' plaintext envelope. |
| W14 | Hardcoding an origin (e.g. `http://localhost:3000` in a `fetch` URL) | FM-06 lint failure; couples code to env. | Stop. Use `process.env.NEXT_PUBLIC_APP_URL`. |
| W15 | Importing `z-ai-web-dev-sdk` or `SUPABASE_SERVICE_ROLE_KEY` into a Client Component | Top-level `AGENTS.md` §6.4; massive security hole. | Stop. Move to a Server Action or `/api/*` route. |

### 5.1 What "Stop and Ask" Looks Like

1. Stop coding. Commit what you have with `chore(wip): <what> — pending human review`.
2. Open a draft PR with the `## Spec ref` and `## Risk` blocks filled in, even if incomplete.
3. In the worklog, note: `BLOCKED on human review: <trigger #Wxx>`.
4. Return control to the orchestrator with a clear request.

### 5.2 Stop-and-Ask Decision Tree

```
                        ┌──────────────────────────────┐
                        │  About to commit a change?   │
                        └──────────────┬───────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │  Does the change touch any   │
                        │  of the §2 non-negotiables?  │
                        │  (Rule 1..10)                │
                        └──────────────┬───────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
       ┌───────────────┐       ┌───────────────┐        ┌───────────────┐
       │  No            │       │  Maybe         │       │  Yes (e.g.    │
       │  ↓             │       │  ↓             │       │  ledger,      │
       │  proceed       │       │  branch on the │       │  paise, sync, │
       │  to lint +     │       │  trigger #     │       │  telemetry,   │
       │  smoke         │       │  below         │       │  6th route,   │
       └───────────────┘       └───────┬────────┘       │  indigo/blue, │
                                       │                 │  crypto,      │
                                       │                 │  silent fail) │
                                       │                 │  ↓            │
                                       │                 │  STOP         │
                                       │                 │  (one of      │
                                       │                 │  W1..W15)     │
                                       │                 └───────┬───────┘
                                       │                         │
                                       ▼                         │
       ┌─────────────────────────────────────────────────────────┐│
       │  Trigger classifier                                       ││
       └─┬──────────┬──────────┬──────────┬──────────┬───────────┘│
         │          │          │          │          │             │
         ▼          ▼          ▼          ▼          ▼             │
   W1 6th       W2 indigo/   W3 UPDATE/  W4 new     W5 telemetry  │
   route        blue accent  DELETE on   origin in  SDK           │
   (P2)         (AP-6)       ledger      CSP        (AP-10)       │
                                                            ▼ STOP
   W6 float     W7 skip      W8 crypto   W9 silent  W10 console    │
   money        sync_outbox  envelope    catch      log in prod    │
   (BR-M-01)    (BR-SYN-01)  change      (AP-9)     (AP-9)        │
                                                                           
   W11 AGENTS   W12 PR >     W13 tenant_ W14 hard-  W15 SDK in     │
   edit         500 lines    secret      coded      client         │
                                                origin              │
                                                            ▼ STOP
                                                            ▼
              ┌──────────────────────────────────────────────────┐
              │  Any W* match → STOP                            │
              │  • Commit WIP: "chore(wip): ... pending review" │
              │  • Open draft PR with ## Spec ref + ## Risk     │
              │  • Worklog: "BLOCKED on W<n>"                   │
              │  • Return control to orchestrator               │
              └──────────────────────────────────────────────────┘
```

The decision tree is the operational mirror of the §5 trigger table. The "maybe" branch is the load-bearing one — a web agent that is unsure whether its change touches a non-negotiable should default to STOP. The classifier at the bottom is exhaustive: every W* trigger from §5 has a leaf, and the "STOP" outcome is the same for every leaf. The cost of a false-positive STOP is one extra human review; the cost of a false-negative pass is a non-negotiable violation that ships to production. The asymmetry favours STOP.

---

## 6. Worklog Discipline

After every meaningful change (not every commit), append a `---`-delimited section to `/home/z/my-project/worklog.md`:

```markdown
---
Task ID: <your-task-id>
Agent: <your-agent-type>
Task: <one-line summary>

Work Log:
- <step 1>
- <step 2>
- ...

Stage Summary:
- Files changed: <list>
- Verification: lint clean, agent-browser smoke passed, dev.log clean.
- Cross-references: <specs touched>
- Next recommended task: <one line>
```

The worklog is the **single source of truth for project progress** (top-level `worklog.md` header). The next agent reads it before starting; if your entry is missing or vague, the next agent is blind.

---

## 7. Glossary

| Term | Definition |
|---|---|
| **SSR (Server-Side Rendering)** | The server renders the HTML for a route on every request. In Next.js 16 App Router, this is the default for non-static RSC pages. |
| **RSC (React Server Components)** | React components that run only on the server; they cannot use `useState`, `useEffect`, or browser APIs. They ship zero JS to the browser. The App Router's default. |
| **PPR (Partial Prerendering)** | Next.js 16 feature: the static shell of a page is prerendered at build time; only the dynamic fragments (wrapped in `<Suspense>`) stream at request time. Enabled via `experimental.ppr: true`. |
| **Edge Function** | A serverless function that runs on the Edge runtime (V8 isolate, no Node.js APIs). Used for middleware (Next.js) and for the `provision-db` function (Supabase, Deno runtime). |
| **Turso** | A managed libSQL (SQLite-over-network) service. Each Buddysaradhi user gets one Turso DB (`db-{user_uuid}`). The DB is accessible via the `@libsql/client` HTTP driver. |
| **libSQL** | The open-source fork of SQLite that Turso runs. Adds HTTP transport, embedded replicas, and vector search. The `@libsql/client` npm package is the JavaScript driver. |
| **Supabase SSR** | The `@supabase/ssr` package, the recommended way to use Supabase Auth in Next.js App Router. Manages session cookies via `cookies()` on the server and `createBrowserClient` in the browser. |
| **TanStack Query** | The `@tanstack/react-query` v5 library. The client server-state layer in Buddysaradhi. `staleTime` per entity, `gcTime` 5 min default. Optimistic updates via `onMutate`. |
| **Zustand** | The `zustand` v5 library. The client UI-state layer in Buddysaradhi. Per-screen stores; persisted slices via `idb-keyval`. Never holds server data — only IDs and UI flags. |
| **IndexedDB** | The browser's structured database. Buddysaradhi uses it (via `idb-keyval`) as a read-through cache layer between TanStack Query and the server. |
| **Server Action** | A `'use server'` function in Next.js 16. Invoked over an RPC POST from the browser. The mutation primitive on the web surface. |
| **Scoped JWT** | A Turso-issued JWT that grants access to exactly one DB. 1-year expiry. Stored in `auth.users.user_metadata.db_token`; never in the client bundle. |
| **`sync_outbox`** | A table in every per-user Turso DB. Every mutation appends a row (entity type, entity ID, operation, timestamp) in the same transaction. Mobile/desktop pull this to sync their local replica. |
| **LWW** | Last-Writer-Wins. The conflict-resolution rule for non-ledger rows (top-level `12_Business_Rules.md` BR-SYN-01). The row with the newer `updated_at` wins; the loser is logged to `audit_log`. |
| **`tenant_secret`** | A 256-bit random value generated at provisioning, stored in `app_state`. The pepper for receipt/invoice tamper hashes and for the PIN argon2id hash. Never exported in plaintext. |
| **BR-*** | Business Rule ID. Stable citation string for a rule in `12_Business_Rules.md` (e.g. `BR-LED-06` = the append-only ledger rule). |
| **EC-*** | Edge Case ID. Stable citation string for an edge case in `14_Edge_Cases.md` (e.g. `EC-F-01` = discount produces fractional paise). |
| **P*** | Principle ID. Stable citation string for a principle in `01_Product_Principles.md` (e.g. `P2` = the 5-screen rule). |
| **AP-*** | Anti-Principle ID. The "things we will never do" list in `01_Product_Principles.md` (e.g. `AP-6` = no indigo/blue accents). |
| **FM-*** | Failure Mode ID. From top-level `AGENTS.md` §15 (e.g. `FM-05` = mutation via `fetch` in a Client Component). |

---

## 8. What "Done" Means

A web task is done when **all** are true:

1. **Lint passes.** `bun run lint` → 0 errors, 0 warnings.
2. **Typecheck passes.** `bun run typecheck` → 0 errors.
3. **(If tests requested)** Unit + integration tests pass.
4. **Agent-Browser smoke passes.** The affected screen renders without runtime/hydration errors; the primary interaction works; the sticky footer behaves on short and long pages.
5. **Dev log is clean.** No unexpected `Error`/`Warning`/`Hydration`/`did not match` lines.
6. **No `§2` violation.** None of the 10 non-negotiable rules from top-level `AGENTS.md` are violated.
7. **No `§5` stop-and-ask trigger fired unaddressed.** Every trigger that fired has a recorded human review or a documented decision to proceed.
8. **Worklog updated.** A `---`-delimited section appended to `/home/z/my-project/worklog.md` with Task ID, Agent, Task, Work Log, Stage Summary.
9. **Spec-ref cited.** The PR (or commit message, if no PR) cites the spec section implemented (`## Spec ref: 02_State_and_Data_Flow.md §3.5` etc.).
10. **Cross-references accurate.** Every `BR-*`, `EC-*`, `P*`, `AP-*` cited in code comments or PR description actually exists in the cited spec.

> **"It compiles" is never sufficient.** A green build is the floor, not the ceiling. A web agent that ships "it compiles" is an agent that has not finished.

---

## 9. The Agent Operating Loop

When you (the next web agent) are working a task:

1. Read `/home/z/my-project/worklog.md` to learn prior context (especially the most recent 2 entries).
2. Read the relevant spec per §1 above.
3. Make the smallest correct change. One PR per change; < 300 lines per commit.
4. Run `bun run lint`. Fix all errors.
5. Run `bun run typecheck`. Fix all errors.
6. Run agent-browser smoke on the affected screen(s).
7. Tail `dev.log` and grep for unexpected lines.
8. If any §5 stop-and-ask trigger fired, stop and follow §5.1.
9. Append a `---`-delimited section to `/home/z/my-project/worklog.md` **with a `State: COMPLETED | PAUSED | BLOCKED` field in the Stage Summary** (top-level `AGENTS.md` §9.2.2).
10. Report back with: files changed, verification result, next recommended task.

### 9.1 Task-to-Task Transition Protocol (extends top-level `AGENTS.md` §9.2)

When a new user instruction, a blocker, a higher-priority task, or a session-end preempts the current task, **do not silently context-switch.** Run the top-level §9.2.2 Close-Out Checklist (lint → mark todo `completed`/`paused`/`BLOCKED` → worklog entry with `State:` + `Resume point:` → WIP commit → update todos → read-back verify). The single in-flight task rule (§9.2.1) means exactly ONE web todo is `in_progress` at a time; a second task is not "started" until the first is closed out. The `no-orphaned-task.test.ts` lint (§9.2.6) fails the build if a web todo is left `in_progress` with no worklog entry in the last 30 minutes.

**Web-specific shift triggers** (in addition to the top-level §9.2.5 table):
- A hydration error or runtime crash surfaces mid-task → close-out the current task as `BLOCKED`, file the bug, then start the fix.
- A `dev.log` error appears that predates the current task → close-out as `PAUSED`, investigate the regression first.
- The agent-browser smoke reveals a sticky-footer or responsive-layout break → close-out the feature task as `PAUSED`, fix the layout regression, resume.

---

## 10. Anti-Patterns Specific to Web

Inherits the 24 anti-patterns from top-level `AGENTS.md` §10. The web-specific extensions:

| # | Anti-pattern | Correction |
|---|---|---|
| W-AP-1 | Adding a 6th sidebar entry "just for now" | The 5-screen rule is hard (P2). Ship the capability inside an existing screen. |
| W-AP-2 | Using `localStorage` for auth tokens | CSP blocks it; use HTTP-only cookies via `@supabase/ssr`. |
| W-AP-3 | Storing the Supabase service-role key in a Client Component | Massive security hole. Server-only. |
| W-AP-4 | `fetch('/api/...')` from a Client Component | Use a Server Action. (FM-05) |
| W-AP-5 | Hardcoding `http://localhost:3000` in a `fetch` URL | Use `process.env.NEXT_PUBLIC_APP_URL`. (FM-06) |
| W-AP-6 | `console.log(err)` in a catch | Use `log.error(err)` (typed logger); surface via toast + `audit_log`. |
| W-AP-7 | Skipping `qc.invalidateQueries` after a mutation | UI shows stale data. Always invalidate in `onSettled`. |
| W-AP-8 | Caching the fees matrix with `staleTime: Infinity` | It's derived from the ledger; it goes stale on every payment. `staleTime: 30_000`. |
| W-AP-9 | Using `Recharts` `ResponsiveContainer` without a fixed height | Hydration mismatch. Use a fixed height (e.g. `h-[280px]`). |
| W-AP-10 | Importing `recharts` into a Server Component | Recharts is client-only. Move to a Client island. |
| W-AP-11 | Forgetting `"use client"` on a Framer Motion component | Build error. Add the directive. |
| W-AP-12 | Using `useEffect` for data fetching | Use TanStack Query or an RSC. `useEffect` for fetching causes waterfalls. |
| W-AP-13 | Calling `supabase.auth.getSession()` in a Server Component | Use the `cookies()` adapter via `createSupabaseServer()`. The browser client doesn't work server-side. |
| W-AP-14 | Storing `pinEntry` in a persisted Zustand slice | PIN must never touch disk. Transient slice only. |
| W-AP-15 | Skipping the logout IndexedDB wipe | Shared computer leak (BR-SEC-04). Always `wipeLocalCache()` on sign-out. |

---

## 11. Cross-References

- Top-level `AGENTS.md` — the master directive for the whole monorepo.
- Top-level `01_Product_Principles.md` — the 15-rule constitution.
- Top-level `13_UI_Guidelines.md` — the design system (glass tiers, accent map, motion).
- Top-level `12_Business_Rules.md` — every BR-* rule.
- Top-level `14_Edge_Cases.md` — every EC-* edge case.
- This directory's `README.md` — orientation index (file index, decision tree, platform cross-references, verification checklist).
- This directory's `01_Architecture.md` — Next.js 16 structure.
- This directory's `02_State_and_Data_Flow.md` — state layers.
- This directory's `03_Auth_and_Provisioning.md` — auth + Turso.
- This directory's `04_API_Routes.md` — every `/api/*` contract.
- This directory's `05_Deployment_Vercel.md` — Vercel deploy.
- This directory's `06_Build_and_Release.md` — Vercel Blob + manifest.
- This directory's `07_Landing_Page.md` — the commercial landing page implementation (route tree, RSC composition, manifest fetch, JSON-LD, Lighthouse ≥95 budget).
- Sibling `product/` directory — the marketing content source for `07_Landing_Page.md` (the WHAT to its HOW).

### 11.1 References

The handoff directive above is layered on three external bodies of work. When the directive and an external source disagree, the directive wins (the external source is the inspiration; the directive is the contract).

- **Next.js 16 App Router docs** — the source of truth for RSC, Server Actions, PPR, route groups, middleware, the `"use client"` / `"use server"` boundary. Cited in §1, §2 (file map), §3.1 (TypeScript), §5 (W1 6th-route trigger), and the glossary (§7 — RSC, PPR, Edge Function, Server Action).
- **Vercel docs** — the source of truth for project settings, preview deploys, env vars, cron jobs, the `@vercel/speed-insights` + `@vercel/analytics` packages. Cited in §2 (file map → `05_Deployment_Vercel.md`) and §10 (W-AP-9 hydration guidance inherits Vercel's Next.js deployment notes).
- **TanStack Query v5 docs** — the source of truth for `useQuery`, `useMutation`, `setQueryData`, `invalidateQueries`, optimistic-update patterns. Cited in §7 (glossary — TanStack Query, optimistic UI) and §10 (W-AP-7, W-AP-8 cache-invalidation anti-patterns).
- **Zustand v5 docs** — the source of truth for `create`, `persist`, custom storage, the "selector stability" rule. Cited in §7 (glossary — Zustand) and §10 (W-AP-14 PIN-persistence anti-pattern).
- **Smashing Magazine — "A Visual Guide To React Server Components"** and **Josh W. Comeau — "The 'What' And 'Why' Of Server Components"** — the two clearest public write-ups of the RSC mental model; recommended reading for any agent who is new to the App Router before tackling STEP 3a in §1.1.

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ handoff file must carry ≥ 2 ASCII art mockups. The AGENTS.md already carries a stop-and-ask decision tree in §5; the mockups below add three new views: (1) a reading-order flowchart that consolidates §1 (Where to Start) into a single annotated diagram, (2) a refined stop-and-ask decision tree that complements §5's table with explicit "STOP → draft PR → worklog" branches, and (3) a "Done" verification flowchart turning §8's 10-point checklist into a serial pass/fail tree. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the §20.2 character set is in use; accent colours are named, never hexed; cross-references use canonical IDs only. The handoff directive itself carries **no glass tier and no neumorphic recipe** (it is a directive, not a UI surface); the in-app surfaces the directive *governs* ARE in the design system, catalogued in each web/ spec's design-system callout.

### 12.1 Design System Reference — Handoff Directive Cross-Cut

> **The single rule (§6.6) does not apply to the AGENTS.md handoff directive.** This file is a directive — it governs how agents write code, not how the UI renders. The **in-app surfaces the directive governs** (the GlassShell, the marketing landing, the auth card, the API error toasts) ARE in the design system; the tables below list the surfaces the directive references and the glass/neumo tokens each carries, so the agent reading this file knows which design-system contract each W* trigger protects.

| Surface (governed by this directive) | Glass tier | Protected by trigger | Cross-ref |
|---|---|---|---|
| GlassShell sidebar + topbar (the 5-screen app shell) | `glass-strong` sticky | W1 (6th route), W11 (AGENTS edit) | §5.5, `01 §3.3` |
| Marketing landing (hero + features + download + pricing + FAQ + CTA + footer) | `glass` / `glass-strong` / `glass-faint` per surface | W2 (indigo/blue), W5 (telemetry) | §5.5, `07 §13.1` |
| Auth card (login/signup/verify) | `glass-strong` centered + backdrop | W3 (ledger UPDATE — does not touch auth card, but the directive is uniform) | §5.5, `03 §10.1` |
| API error toast (surfaces typed `error.code` from any `/api/*` Err) | `glass-strong` + 4px accent bar | W7 (skip sync_outbox), W9 (silent catch), W10 (console.log) | §5.5, §8.8, `04 §12.4` |
| Confirm modal (surfaces `DESTRUCTIVE_CONFIRM_REQUIRED`) | `glass-strong` + backdrop | W3 (ledger UPDATE — the modal confirms the void) | §5.5, §8.7 |

| Control (governed by this directive) | Neumo recipe | Protected by trigger | Cross-ref |
|---|---|---|---|
| Primary CTA (hero, pricing, final CTA) | `neumo-raised` + emerald glow | W2 (indigo/blue accent on a CTA is the most common violation) | §6.6, §8.2 |
| Toggle (PIN, biometric, theme) | `neumo-inset` + raised knob | W14 (pinEntry in persisted Zustand slice) | §6.4, §6.6, §8.16 |
| Input field (all forms) | `neumo-inset` | W6 (float money in an input value) | §6.6, §8.9 |
| Search bar (topbar, FAQ) | `neumo-inset` | (no specific trigger — general design-system hygiene) | §6.6, §8.10 |

> **References.** Next.js 16 App Router docs (RSC, Server Actions, PPR, route groups, middleware, the `"use client"` / `"use server"` boundary); Vercel docs (project settings, preview deploys, env vars, cron jobs, `@vercel/speed-insights`, `@vercel/analytics`); TanStack Query v5 docs (`useQuery`, `useMutation`, `setQueryData`, `invalidateQueries`, optimistic-update patterns); Zustand v5 docs (`create`, `persist`, custom storage, the "selector stability" rule); Smashing Magazine — "A Visual Guide To React Server Components"; Josh W. Comeau — "The 'What' And 'Why' Of Server Components"; CSS-Tricks — "An Overview Of React Server Components". These are the same references cited in `README.md` §7.2.

### 12.2 Mockup M1 — Reading-Order Flowchart (§1 Consolidated)

The §1 narrative listed the 12-step reading order; this mockup shows it as a **flowchart** with branch points and the "always" master-spec rail at the bottom. The point: every step gates the next; an agent who skips a step lands on a stop-and-ask trigger downstream.

```
   Reading-Order Flowchart — "What to read before coding, in order"
   ↑ consolidates §1 (Where to Start) into a single annotated flowchart with branch points

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 1: README.md (this directory)                                                              │
   │  • orientation, stack, decision tree, platform cross-references, verification checklist          │
   │  • ↑ catalogues the 13 glass surfaces + 7 neumo controls (README §7.1)                           │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 2: AGENTS.md (this file — you are here)                                                    │
   │  • handoff instructions, stop-and-ask triggers, "done" definition, anti-patterns                  │
   │  • ↑ the 15 W-AP anti-patterns in §10 are the operational mirror of §5's W1..W15 triggers         │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 3: 01_Architecture.md                                                                      │
   │  • route groups, RSC/Client island split, middleware, next.config.ts, bundle budget              │
   │  • ↑ the §12 ASCII suite adds: route-group tree (auth + render-mode annotated),                  │
   │    RSC payload stream waterfall, bundle-budget growth-over-time trend                            │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 4: top-level AGENTS.md §2 — the 10 non-negotiable rules                                    │
   │  • Rule 1..Rule 10 (binding on every line of code)                                               │
   │  • ↑ this is the GATE — every W* trigger in §5 below traces back to one of these 10 rules        │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 5: 02_State_and_Data_Flow.md                                                               │
   │  • TanStack + Zustand + IndexedDB layering, optimistic updates, 30-second sync poll              │
   │  • ↑ the §10 ASCII suite adds: Zustand store tree, TanStack cache key-tree,                      │
   │    optimistic-update horizontal sequence diagram                                                 │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 6: 03_Auth_and_Provisioning.md                                                             │
   │  • Supabase + Turso provisioning flow, SSR cookie strategy, scoped JWT boundary                  │
   │  • ↑ the §10 ASCII suite adds: signup funnel state machine, session/JWT token-flow diagram,      │
   │    credential scope matrix                                                                        │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 7: BRANCH — the screen spec you're working on                                              │
   │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
   │  │ 04_Dashboard.md  │  │ 05_Students.md   │  │ 06_Attendance.md │  │ 07_Fees_and_     │          │
   │  │  (the screen     │  │  (the screen     │  │  (the screen     │  │  Payments.md     │          │
   │  │   spec, NOT the  │  │   spec)          │  │   spec)          │  │  (the screen     │          │
   │  │   API spec)      │  │                  │  │                  │  │   spec)          │          │
   │  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
   │  ┌──────────────────┐                                                                              │
   │  │ 08_Settings.md   │  ← the 5th screen spec (each carries §21 ASCII suite from task 5-REFINE-   │
   │  │  (the screen     │    ROOT-SCREENS — 7 mockups each: full-screen / empty / loading / modal /   │
   │  │   spec)          │    toast+confirm / mobile / state matrix)                                  │
   │  └──────────────────┘                                                                              │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 8: 13_UI_Guidelines.md — glass tiers, accent map, no indigo/blue                            │
   │  • §5.5 glass coverage map · §6.6 neumo coverage map · §8 component vocabulary · §20 ASCII rules │
   │  • ↑ this is the DESIGN-SYSTEM GATE — every surface and control in your code must trace here     │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  STEP 9-12: CONDITIONAL (read only if the task touches them)                                     │
   │  • 04_API_Routes.md (if writing/modifying a route handler — the §12 ASCII suite adds:            │
   │    /api/* route tree, request/response envelope wire diagram, error-response matrix)             │
   │  • 05_Deployment_Vercel.md (if shipping/wiring env vars — the §12 ASCII suite adds: Vercel       │
   │    project topology, Edge regions map, cron 24-hour timeline)                                    │
   │  • 06_Build_and_Release.md (if touching the download hub or manifests — the §12 ASCII suite      │
   │    adds: Blob bucket annotated tree, manifest field-tree, atomic-update state machine)           │
   │  • 07_Landing_Page.md (if touching the commercial landing page — the §13 ASCII suite adds:       │
   │    hero composition, features 6-card grid, download 5-card hub, FAQ accordion, CTA stack,        │
   │    footer with newsletter)                                                                       │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  ALWAYS (every task, every step):                                                                │
   │  • top-level AGENTS.md §2 — the 10 non-negotiables (re-read before every PR)                     │
   │  • 12_Business_Rules.md — every BR-* rule the task touches (cite by stable ID)                   │
   │  • 14_Edge_Cases.md — every EC-* edge case the task touches                                       │
   │  • 01_Product_Principles.md — every P-* / AP-* the task touches                                   │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Skip-step consequences ───────────────────────────────────────────────────────────────────────────
     • skip STEP 2 (this file) → you miss the W1..W15 stop-and-ask triggers → you ship a violation
     • skip STEP 4 (top-level §2) → you miss Rule 1..10 → you ship a non-negotiable violation
     • skip STEP 8 (13_UI_Guidelines) → you miss the glass/neumo coverage maps → you ship a design-
       system violation (the most common: indigo/blue accent, glass-on-glass nesting, neumorphic
       content panel)
     • skip STEP 9-12 (conditional) → you miss the per-file ASCII suites → you mis-implement a route,
       a deploy knob, a manifest field, or a landing-page section
```

The flowchart consolidates §1's 12-step reading order into a single annotated diagram. The first 6 steps are mandatory for every task; step 7 branches by the screen being worked on; step 8 is the design-system gate; steps 9–12 are conditional on the task touching API routes, deployment, build/release, or the landing page. The "always" rail at the bottom restates the four master specs every task touches (top-level AGENTS §2, 12_Business_Rules, 14_Edge_Cases, 01_Product_Principles). The skip-step consequences at the bottom make the cost of skipping concrete: skipping STEP 2 means missing the W1..W15 triggers; skipping STEP 8 means shipping a design-system violation (most commonly indigo/blue accent, glass-on-glass nesting, or a neumorphic content panel).

### 12.3 Mockup M2 — Stop-and-Ask Decision Tree (Refined §5 with STOP Branches)

The §5 narrative listed the 15 W* triggers in a table; the existing ASCII tree shows the classifier. This mockup refines it with explicit **STOP → draft PR → worklog** branches so an agent knows exactly what to do when a trigger fires. The point: a fired trigger is not a failure — it is the system working as designed; the cost of a false-positive STOP is one extra human review, the cost of a false-negative pass is a non-negotiable violation that ships to production.

```
   Stop-and-Ask Decision Tree — refined §5 with explicit STOP → draft PR → worklog branches
   ↑ a fired trigger is NOT a failure; it is the system working as designed
   ↑ the asymmetry favours STOP: false-positive = 1 extra review; false-negative = a shipped violation

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  ENTRY: "I'm about to make a change under src/."                                                 │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Q1: Does the change add a 6th top-level route under (app)?                                      │
   │      (e.g. /reports, /communications)                                                            │
   │  ├─ YES → STOP. W1 fired. (P2, top-level Rule 4)                                                │
   │  │        → DO NOT implement. Open a principle-amendment RFC (12_Business_Rules.md §16).         │
   │  │        → Commit WIP: "chore(wip): 6th route proposal — pending RFC"                           │
   │  │        → Worklog: "BLOCKED on W1 — RFC required"                                              │
   │  │        → Return control to orchestrator.                                                      │
   │  └─ NO → continue to Q2                                                                          │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Q2: Does the change add an indigo or blue primary accent?                                       │
   │      (e.g. bg-indigo-600, text-blue-500, #6366f1)                                                │
   │  ├─ YES → STOP. W2 fired. (AP-6, top-level Rule 5)                                              │
   │  │        → Replace with ACCENT_MAP.emerald or .cyan (per §2.4).                                │
   │  │        → If the indigo/blue is in a design tool export (Figma → code), flag the export        │
   │  │          as a spec defect — the design system is dark-only cosmic, not generic SaaS.          │
   │  │        → Commit: "fix(design): replace indigo with emerald per AP-6"                          │
   │  │        → Worklog: "W2 fired + fixed" (the fix is in the same PR; not blocked).               │
   │  └─ NO → continue to Q3                                                                          │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Q3: Does the change UPDATE or DELETE on ledger_entries?                                         │
   │      (in a route, server action, or raw SQL)                                                     │
   │  ├─ YES → STOP. W3 fired. (top-level Rule 1, BR-LED-06)                                         │
   │  │        → INSERT a VOID row with reverses_entry_id instead.                                    │
   │  │        → If you "need" to UPDATE because of a data migration: write a one-off, audited        │
   │  │          migration script that DISABLES the trigger, runs, RE-ENABLES — and review-board it.  │
   │  │        → Commit: "fix(ledger): replace UPDATE with VOID per BR-LED-06"                        │
   │  │        → Worklog: "W3 fired + fixed" (same PR; not blocked).                                  │
   │  └─ NO → continue to Q4                                                                          │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Q4-Q15: the remaining 12 triggers (W4..W15) — same shape:                                       │
   │  • Q4: new origin in CSP?                     → STOP. W4. (top-level 10_Security.md §12)         │
   │  • Q5: telemetry SDK added?                   → STOP. W5. (AP-10, top-level Rule 3)              │
   │  • Q6: money as float / arithmetic on paise?  → STOP. W6. (BR-M-01, top-level Rule 6)            │
   │  • Q7: skip sync_outbox INSERT?               → STOP. W7. (BR-SYN-01, top-level Rule 7)          │
   │  • Q8: crypto envelope change?                → STOP. W8. (10_Security.md §15)                   │
   │  • Q9: empty catch {} or swallow typed error? → STOP. W9. (AP-9, top-level Rule 9)               │
   │  • Q10: console.log in prod code?             → STOP. W10. (AP-9 lint failure)                   │
   │  • Q11: AGENTS.md edit (this file)?           → STOP. W11. (handoff directive change — needs     │
   │            human review; the directive is the contract for every future agent)                   │
   │  • Q12: PR > 500 lines?                       → STOP. W12. (split into smaller PRs; < 300 lines   │
   │            per commit is the target)                                                             │
   │  • Q13: tenant_secret export?                 → STOP. W13. (10_Security.md — tenant_secret never  │
   │            leaves the per-user Turso DB)                                                         │
   │  • Q14: hardcoded origin (http://localhost)?  → STOP. W14. (FM-06 lint; use NEXT_PUBLIC_APP_URL) │
   │  • Q15: SDK import in client bundle?          → STOP. W15. (z-ai-web-dev-sdk, supabase service-  │
   │            role key, TURSO_API_TOKEN, db_token — all server-only)                                │
   │                                                                                                  │
   │  Each follows the same recovery shape:                                                          │
   │    STOP → identify the fix → commit the fix in the same PR (if the fix is mechanical) OR         │
   │            open a draft PR + worklog "BLOCKED on W<n>" (if the fix needs human review)           │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼ (no trigger fired)
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  PROCEED: "The change is safe to implement."                                                     │
   │  → smallest correct change · one PR per change · < 300 lines per commit                          │
   │  → bun run lint → bun run typecheck → agent-browser smoke → tail dev.log                         │
   │  → §8 "Done" checklist (10 points) — see M3 below                                                │
   │  → append worklog entry · cite spec ref in PR description                                        │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── STOP recovery discipline ─────────────────────────────────────────────────────────────────────────
     When a trigger fires, the agent has two paths:
     PATH A (mechanical fix): the trigger fired because of a habit, not a missing spec. Fix it in the
       same PR. Example: W2 (indigo accent) → replace with emerald. W6 (float money) → use paiseAdd.
       Worklog: "W<n> fired + fixed in this PR."
     PATH B (needs human review): the trigger fired because the spec is ambiguous or absent. Open a
       draft PR with ## Spec ref + ## Risk + ## Test plan. Worklog: "BLOCKED on W<n> — needs review."
       Return control to orchestrator. Example: W1 (6th route) → needs a principle-amendment RFC.
       Example: W11 (AGENTS.md edit) → needs human review of the directive change.

   ── The asymmetry (restated) ──────────────────────────────────────────────────────────────────────────
     False-positive STOP (you stopped, but the change was actually fine):
       cost = 1 extra human review. Recovery = reviewer says "looks good, proceed."
     False-negative PASS (you proceeded, but the change violated a non-negotiable):
       cost = a violation that ships to production. Recovery = rollback, post-mortem, RFC, audit_log
       entries for every affected tutor.
     The asymmetry favours STOP. An agent that is unsure whether its change touches a non-negotiable
     should default to STOP. (§5 narrative: "the cost of a false-positive STOP is one extra human
     review; the cost of a false-negative pass is a non-negotiable violation that ships to production.")
```

The refined decision tree shows the first 3 triggers (W1–W3) in full detail with explicit STOP → fix → commit → worklog branches, then collapses W4–W15 into the same shape. Each trigger has two recovery paths: PATH A (mechanical fix in the same PR — the trigger fired because of a habit, not a missing spec) or PATH B (needs human review — open a draft PR + worklog "BLOCKED on W<n>" + return control to orchestrator). The asymmetry restatement at the bottom is the load-bearing safety property: false-positive STOP costs one extra review; false-negative pass costs a shipped violation. The asymmetry favours STOP.

### 12.4 Mockup M3 — "Done" Verification Flowchart (§8 Consolidated)

The §8 narrative listed the 10 "done" criteria; this mockup turns them into a **serial pass/fail flowchart** that an agent runs before appending the worklog entry. The point: a task is done only when all 10 pass; "it compiles" is the floor, not the ceiling.

```
   "Done" Verification Flowchart — §8's 10-point checklist as a serial pass/fail tree
   ↑ a task is done ONLY when all 10 pass; "it compiles" is the floor, not the ceiling

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  START: "I think the task is done. Run the §8 checklist."                                        │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  1. Lint passes.  bun run lint → 0 errors, 0 warnings                                            │
   │  • pass: clean lint output                                                                       │
   │  • fail: fix every error + every warning (warnings are not acceptable in web/ code)              │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  2. Typecheck passes.  bun run typecheck → 0 errors                                              │
   │  • pass: tsc --noEmit clean                                                                      │
   │  • fail: fix every type error (no `as any` without // SAFETY: comment; no implicit any)          │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  3. (If tests requested) Unit + integration tests pass.                                          │
   │  • pass: bun test green                                                                          │
   │  • fail: fix the test OR fix the code (decide which is wrong; do not delete the test)            │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  4. Agent-Browser smoke passes.                                                                  │
   │  • the affected screen renders without runtime/hydration errors                                  │
   │  • the primary interaction works (button click, form submit, toggle press)                       │
   │  • the sticky footer behaves on short and long pages                                             │
   │  • pass: smoke green; screenshot attached to PR                                                  │
   │  • fail: fix the runtime/hydration error; re-run smoke                                            │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  5. Dev log is clean.                                                                            │
   │  • no unexpected Error / Warning / Hydration / "did not match" lines                             │
   │  • pass: tail dev.log clean                                                                      │
   │  • fail: investigate every unexpected line; fix or document (do not silence)                     │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  6. No §2 violation.  (top-level AGENTS.md — the 10 non-negotiables)                              │
   │  • Rule 1: ledger append-only (no UPDATE/DELETE on ledger_entries)                               │
   │  • Rule 2: no PII third-party network calls (only Turso HTTP + update-check ping)                │
   │  • Rule 3: no telemetry SDK (Vercel Speed Insights + Web Analytics only)                        │
   │  • Rule 4: five screens only (no 6th top-level route under (app))                                │
   │  • Rule 5: no indigo/blue accents (Emerald/Cyan/Amber/Flare/Violet only)                        │
   │  • Rule 6: integer paise (no float money; bigint or safe-integer number)                        │
   │  • Rule 7: every mutation writes sync_outbox (in the same batch() transaction)                  │
   │  • Rule 8: backups AES-256-GCM + Argon2id (never plaintext)                                      │
   │  • Rule 9: no silent failures (throw or return typed Result<T, E>)                              │
   │  • Rule 10: WCAG 2.1 AA (44×44px touch targets, prefers-reduced-motion honoured)                │
   │  • pass: every rule verified                                                                     │
   │  • fail: STOP. The violation is a P0 review block. Fix it before proceeding.                     │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  7. No §5 stop-and-ask trigger fired unaddressed.                                                │
   │  • every W1..W15 trigger that fired has a recorded human review OR a documented decision         │
   │    to proceed (PATH A mechanical fix in the same PR; OR PATH B draft PR + worklog "BLOCKED")     │
   │  • pass: every fired trigger has a paper trail                                                    │
   │  • fail: document the trigger's resolution in the worklog before proceeding                       │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  8. Worklog updated.                                                                             │
   │  • a ---delimited section appended to /home/z/my-project/worklog.md                              │
   │  • Task ID · Agent · Task · Work Log · Stage Summary                                              │
   │  • pass: worklog entry exists                                                                    │
   │  • fail: append the worklog entry (use the template in §6 of this file)                          │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  9. Spec-ref cited.                                                                              │
   │  • the PR (or commit message, if no PR) cites the spec section implemented                       │
   │    (e.g. ## Spec ref: 02_State_and_Data_Flow.md §3.5)                                            │
   │  • pass: spec ref in PR description                                                              │
   │  • fail: add the spec ref to the PR description                                                  │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  10. Cross-references accurate.                                                                  │
   │  • every BR-*, EC-*, P*, AP-* cited in code comments or PR description actually exists           │
   │    in the cited master spec                                                                      │
   │  • pass: every stable ID resolves                                                                │
   │  • fail: fix the stale reference (do NOT rename the ID — that's an RFC per 12_Business_Rules §16)│
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │ pass?
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  ALL 10 PASS: "The task is done."                                                                │
   │  → report back with: files changed, verification result, next recommended task                   │
   │  → close the PR (request review if human reviewer available; merge if auto-merge enabled)        │
   │  → the worklog entry (criterion 8) is the single source of truth for project progress            │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── The "it compiles" anti-pattern (restated) ─────────────────────────────────────────────────────────
     > "It compiles" is never sufficient. A green build is the floor, not the ceiling.
     > A web agent that ships "it compiles" is an agent that has not finished. (§8 narrative)

     The 10-point checklist exists because compile-time success does not imply:
       • the change respects the 10 non-negotiable rules (criterion 6)
       • the change passes agent-browser smoke (criterion 4) — hydration errors are runtime, not compile
       • the change addresses every stop-and-ask trigger (criterion 7) — triggers are judgement, not lint
       • the worklog + spec-ref + cross-refs are accurate (criteria 8, 9, 10) — paper trail, not code

     A green build is necessary but not sufficient. The 10-point checklist is the sufficient condition.
```

The "Done" flowchart shows the 10 criteria as a serial pass/fail tree. Each criterion has a defined pass condition and a defined fail-recovery — the task is done only when all 10 pass. Criterion 6 (no §2 violation) is the load-bearing one: it explicitly enumerates the 10 non-negotiable rules from top-level `AGENTS.md` §2, and a failure here is a P0 review block. Criterion 7 (no §5 trigger fired unaddressed) ensures every W1..W15 trigger has a paper trail — either a PATH A mechanical fix in the same PR or a PATH B draft PR + worklog "BLOCKED" entry. The "it compiles" anti-pattern restatement at the bottom makes the philosophy explicit: compile-time success does not imply runtime correctness, design-system compliance, or paper-trail completeness; the 10-point checklist is the sufficient condition.

---

*This file is the operating manual for the web surface. It is read second, after `README.md`, before any spec or code. When a spec and this file disagree, the spec wins — unless the spec is wrong, in which case you amend the spec first, then the code, then this file. The order matters.*
