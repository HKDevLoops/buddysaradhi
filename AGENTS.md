# AGENTS.md — Master Agent Directive

> Read this file first. It governs every AI coding agent operating in the Buddysaradhi Omni-Core monorepo. Code without a spec is tech debt. A "quick fix" that violates a non-negotiable is not a fix. "It compiles" is never sufficient.

---

## 0. Prime Directive

> **Before writing or modifying any code, read the relevant spec section. If no spec covers it, write the spec first, get it reviewed, then code. Code without a spec is tech debt.**

The spec is not a suggestion, a "vibe," or a post-hoc decoration. It is the contract the code is held to. Every line of production code in this monorepo maps to a sentence in some spec under `Buddysaradhi_Planning/`. If you cannot point to that sentence, you are writing orphan code, and orphan code is the most expensive kind — it survives review because nobody knows what it's for, and it breaks in production because nobody knows how it should behave.

### 0.1 The Spec → Code → Test Loop

Every non-trivial change follows this loop, in order:

1. **Spec.** Read or write the spec section that covers the change. If writing, cite the principle (`01_Product_Principles.md`) that authorises the feature and the edge cases (`14_Edge_Cases.md`) it must handle.
2. **Code.** Implement against the spec. Every commit message cites the spec section (see §5).
3. **Test.** Verify the behaviour described in the spec. If you are in this sandbox and tests are not explicitly requested, verify in Agent Browser: render + primary interaction + sticky footer. Add a regression note in the worklog.

If the implementation diverges from the spec, the spec wins — *unless* the spec is wrong, in which case you update the spec first, get the amendment reviewed, and only then change the code. Spec drift is tech debt with a longer half-life than code debt.

### 0.2 The No-Orphan-Code Rule

> Every module, every exported function, every route handler, every component maps to a named spec section. Code that maps to nothing gets deleted.

When you add a new module, the first line of its top comment names the spec it implements — e.g. `// Implements: 07_Fees_and_Payments.md §9 Flow 10 — Void receipt cascade`. When a reviewer asks "what spec is this for?" and you cannot answer in one sentence, the answer is "delete it and start over."

### 0.3 Reading Order (Mandatory)

Before writing any code or doc, read in this order:

1. `AGENTS.md` (this file)
2. `00_Vision.md`
3. `01_Product_Principles.md`
4. `02_Core_Logic.md`
5. The screen spec relevant to your task (`04`–`08`)
6. `11_Data_Model.md` and `12_Business_Rules.md` for any data or money work
7. `13_UI_Guidelines.md` for any UI work
8. `14_Edge_Cases.md` before declaring a feature done
9. **`16_Platform_Delivery_Sequence.md`** — read this BEFORE touching more than one platform (web/mobile/desktop). It is the **process keystone**: exactly one platform is `In-Flight` at a time, with hard Production Gates between them. Violating it is the #1 cause of plan hallucination and the "agent does all platforms at once" failure. The cross-platform infrastructure specs — `17_API_Gateway_System.md` (one edge gateway on Cloudflare Workers + Durable Objects, no per-platform hard-coding), `18_Microservice_Architecture.md` (7 services as co-deployed Worker functions + DOs + Upstash), `19_Concurrency_and_Testing.md` (multithreading + coverage floors), `20_3D_Product_Page.md` (the 3D hero), `21_Automation_Testing.md` (free-tool E2E + visual regression + AI bug-resolution across web/app/desktop/product), `22_Redundancy_Audit.md` (dedup map — read when resolving a contradiction between two docs), `23_Security_Harness_Plan.md` (cross-platform security harness — auth, authz, injection, supply chain, transport, data, gateway, client, observability, SDLC gate + DPDP 2025), `deployment/06_Edge_Function_Hosting.md` (the wrangler/CF + Supabase Edge provision-db deployment recipe for the shared cloud function) — are read when your task reaches them, per `16`'s implementation order.
10. **`21_Automation_Testing.md`** — read BEFORE writing any E2E/visual-regression/a11y/perf test or when the webDevReview cron reports a bug. It defines the 36 automated flows (W-01..W-12 web, M-01..M-08 mobile, D-01..D-06 desktop, P-01..P-10 product), the free-tool stack (Playwright/Maestro/tauri-driver/axe-core/Lighthouse), and the 5-step AI bug-finding loop (Run→Capture→Analyse→Resolve→Verify) that powers autonomous resolution.
11. **`22_Redundancy_Audit.md`** — read when you find a contradiction between two specs. It is the dedup map: topic → canonical home, stale cross-references, precedence rules, and the ~50-item dedup action checklist. If two docs disagree, §5 (precedence) tells you which wins.
12. **`23_Security_Harness_Plan.md`** — read BEFORE any security-relevant change (auth, crypto, IPC, capabilities, secrets, deps) or before any Production Gate security sign-off. It is the HARNESS (10_Security.md is the SPEC): the 10-domain cross-platform threat model (web/Expo/Tauri/CF-Workers-gateway), the automation that enforces it (Semgrep + ZAP + OSV-Scanner + gitleaks), the DPDP-2025 incident-response runbook, and the hard production-readiness security gate.
13. **`deployment/06_Edge_Function_Hosting.md`** — read BEFORE deploying the gateway or any microservice, or when "POST/fetch is not possible" appears. It is the concrete recipe: one `wrangler deploy` → one edge domain `api.buddysaradhi.app` → three platforms (web/mobile/desktop) over HTTPS relative paths via one shared SDK. Covers Prisma v6.16 on the edge, Upstash Redis + QStash wiring, the Supabase Edge `db_provision` function, and the CI/CD pipeline.

---

## 1. Product Context

### 1.1 The Elevator Pitch

> **Buddysaradhi is the operating system that lets a single tutor — or a 200-student coaching institute — run their entire tuition business from five screens, offline-first, with the elegance of Apple, the data density of Kite, and the persistent flow of Discord. Five screens. Seven engines. One ledger. Zero servers to manage.**

### 1.2 Key Facts a New Agent Must Internalise

| Fact | What it means for your code |
|---|---|
| **Single-tenant SQLite** | Every tutor gets their own libSQL/Turso DB. The `tenant_id` column is defence-in-depth, not the partitioning key. (`11_Data_Model.md` §1.) |
| **Offline-first** | Every mutation writes locally first, then to `sync_outbox`. UI never blocks on a remote call when local data exists. (P5; `12_Business_Rules.md` BR-SYN-01..04.) |
| **Immutable ledger** | `ledger_entries` is append-only. Corrections are new rows with `reverses_entry_id`. UPDATE/DELETE on this table is a P0 bug. (P4; `10_Security.md` §9.) |
| **Five screens** | Dashboard, Students, Attendance, Fees & Payments, Settings. A sixth screen requires a ratified principle amendment. (P2; `01_Product_Principles.md`.) |
| **Seven engines** | Search, Reminder, Ledger, Report, Notification, Sync, Security. They run as background jobs, not user-visible surfaces. (`02_Core_Logic.md`.) |
| **Vibrant Glass design system** | Cosmic indigo→violet canvas, glass panels, bioluminescent accents (emerald, cyan, flare, amber, violet). No indigo/blue as primary accents. (`13_UI_Guidelines.md`.) |
| **Cross-platform via Tauri/Expo** | Web (Next.js 16) ships now; mobile (Expo) and desktop (Tauri) are v1.x. Shared code lives in `packages/core`, `packages/ui`, and `packages/design-system`. All three platforms call ONE edge gateway on Cloudflare Workers + Durable Objects (`api.buddysaradhi.app`) — no platform runs its own service. (`15_Future_Roadmap.md`, `17_API_Gateway_System.md` §6, `deployment/06_Edge_Function_Hosting.md`.) |
| **Tailwind everywhere** | Web (Tailwind 4), mobile (NativeWind v5 — the only NativeWind supporting Tailwind 4), and desktop (Tauri shares the web `globals.css`) all consume one `packages/design-system/`. A tutor sees the SAME screen on all three. (`13_UI_Guidelines.md` §24.) |
| **No telemetry** | Not even "anonymous" analytics. No SDK that exfiltrates user data. (AP-10; `10_Security.md` §17.) |

### 1.3 The Livelihood-Tool Framing

> **You are building a livelihood tool, not a toy.** A tutor's month-end fees depend on this ledger being correct. A tutor's receipt numbering must never collide. A tutor's backup must restore on the day their phone is stolen. Every shortcut you take — a float for money, a skipped `sync_outbox` write, a silent `catch {}` — is a shortcut paid for, eventually, by a tutor who cannot afford it.

When you are tempted to skip a step, ask: *would I ship this to the maths teacher in Nagpur who has 40 students, three batches, and one laptop?* If the answer is "no," do not ship it.

---

## 2. Non-Negotiable Rules

The following ten rules are the load-bearing constraints of the system. They are derived from `01_Product_Principles.md` and are not negotiable for an autonomous agent. Each rule carries: **the rule**, **why**, **how it's enforced**, and **what you MUST do if asked to violate it**.

> If asked to violate any of these rules, an agent MUST: (a) refuse, (b) cite the rule by number and the spec it derives from, (c) propose the principled alternative, and (d) escalate to a human reviewer per §8.

### Rule 1 — The ledger is append-only

> **Never call `db.ledgerEntry.update()` or `db.ledgerEntry.delete()`. Only `db.ledgerEntry.create()`. Voids are new rows with `reverses_entry_id`.**

- **Why.** The ledger is the financial spine. Mutability destroys auditability (`12_Business_Rules.md` BR-LED-01/L02).
- **Enforced.** Prisma middleware rejects `ledgerEntry.update` / `ledgerEntry.delete` calls; the underlying SQLite trigger `trg_ledger_no_update` / `trg_ledger_no_delete` aborts any UPDATE/DELETE on the table as defence-in-depth. CI lint `principles/no-ledger-mutation.py` scans PRs for `db.ledgerEntry.update(` / `db.ledgerEntry.delete(` / `db.ledgerEntry.deleteMany(` / `$executeRaw` / `$queryRaw` on `ledger_entries`. `10_Security.md` §9 (LEDGER-1..4).
- **If asked to violate.** Refuse. Cite P4 + BR-LED-01. Propose: call `db.ledgerEntry.create({ data: { ..., reversesEntryId: <original> } })` and write an `audit_log` row `ledger_void` via `db.auditLog.create()` in the same `db.$transaction([...])`.

### Rule 2 — No network calls that process user data

> **The only permitted network calls are the dumb encrypted blob store (v2 sync, see `15_Future_Roadmap.md` v2.0) and the update-check ping (no PII).**

- **Why.** Offline-first + sovereign (`01_Product_Principles.md` P5; `10_Security.md` §17).
- **Enforced.** CSP `connect-src 'self' https://sync.buddysaradhi.app https://update.buddysaradhi.app`. ESLint `no-fetch-in-client`. Review gate on any new `fetch`/`http`/`axios` import.
- **If asked to violate.** Refuse. Cite P5 + AP-10. Propose: do it locally; if a remote is truly needed, draft a v2 blob-store amendment first.

### Rule 3 — No telemetry/analytics SDK

> **No analytics SDK — not even "anonymous" ones.** No Sentry, no Mixpanel, no PostHog, no Amplitude, no GA. Crash reporting is opt-in, PII-stripped, end-to-end encrypted, and off by default (`10_Security.md` §17, TELE-1).

- **Why.** A tutor's student list is not your asset (`00_Vision.md` §2.4).
- **Enforced.** Dependency lint `no-telemetry-deps.py` rejects PRs that add `sentry`, `mixpanel`, etc. CI scans the bundle for known beacons.
- **If asked to violate.** Refuse. Cite AP-10. Propose: log to local `audit_log`, surface in Settings → Diagnostics.

### Rule 4 — Five screens only

> **Five persistent screens: Dashboard, Students, Attendance, Fees & Payments, Settings.** A sixth top-level screen requires a ratified principle amendment per `01_Product_Principles.md` §Amendment Process.

- **Why.** Screen sprawl is how tutors abandon a tool (P2).
- **Enforced.** Route lint: only `/` is a user-facing route in web. Mobile has 5 bottom-tab entries; a 6th is a build error. New capability goes inside one of the five.
- **If asked to violate.** Refuse. Cite P2. Propose: ship the capability as a sub-screen, drawer, or modal inside an existing surface; or draft an RFC.

### Rule 5 — No indigo/blue primary accents

> **Use the bioluminescent palette (emerald, cyan, flare, amber, violet). Indigo and blue are the visual signature of every generic SaaS dashboard since 2018.** The cosmic indigo→violet *canvas* is neutral; accents are bioluminescent.

- **Why.** Brand distinctiveness + accessibility (`13_UI_Guidelines.md` §1.3, AP-6).
- **Enforced.** ESLint rule `no-indigo-accent` rejects `#4F46E5`, `blue-600`, etc. Design review.
- **If asked to violate.** Refuse. Cite AP-6. Propose: `--accent-emerald` for primary, `--accent-cyan` for info, `--accent-flare` for destructive.

### Rule 6 — Integer paise, never float

> **Every amount is stored as integer paise, displayed as ₹ with 2 decimals.** `INTEGER` in DB; `bigint` or safe-integer `number` in TS; `Intl.NumberFormat('en-IN')` for display.

- **Why.** Floats drift; money must not (`12_Business_Rules.md` BR-M-01, `14_Edge_Cases.md` EC-F-01).
- **Enforced.** Zod schemas in `packages/shared` use `z.bigint()` or paise-int. Lint `no-float-money`. Review gate.
- **If asked to violate.** Refuse. Cite BR-M-01. Propose: store paise, format with `formatINR(paise)` from `packages/shared`.

### Rule 7 — Every mutation writes to `sync_outbox`

> **Every local write that must survive to the cloud appends a row to `sync_outbox` in the same transaction.** No exceptions for "small" mutations.

- **Why.** Offline-first means writes must replay on reconnect (`12_Business_Rules.md` BR-SYN-01..03).
- **Enforced.** Integration tests assert `sync_outbox` row count after every mutation flow. Review gate.
- **If asked to violate.** Refuse. Cite P5 + BR-SYN-01. Propose: write the outbox row in the same transaction as the mutation.

### Rule 8 — Backups are AES-256-GCM + Argon2id, never plaintext

> **`.buddysaradhi` backups are AES-256-GCM with an Argon2id-derived key (m=64MiB, t=3, p=2).** The envelope is `salt(16) || nonce(12) || tag(16) || ciphertext`. No escrow, no plaintext fallback.

- **Why.** A stolen backup file must not leak a tutor's roster (`10_Security.md` §15, BACKUP-1).
- **Enforced.** Round-trip test in CI. Code review on any change to `crypto/backup.ts`.
- **If asked to violate.** Refuse. Cite BR-BAT-01 + BACKUP-1. Propose: use the existing `createBackup(passphrase)` API.

### Rule 9 — No silent failures

> **Every error throws or returns a typed error. No empty `catch {}`. No `console.log` in prod. Use the typed logger.** A swallowed error is a lie to the tutor.

- **Why.** Silent failures produce "why did my payment not save?" tickets (`14_Edge_Cases.md` EC-AU-02, BR-SEC-03 fail-closed).
- **Enforced.** ESLint `no-empty-catch`, `no-console`. `Result<T, E>` pattern in `packages/shared`. Review gate.
- **If asked to violate.** Refuse. Cite P11 (no silent failure). Propose: throw a typed error and surface it via toast + `audit_log`.

### Rule 10 — Accessibility is not optional

> **WCAG 2.1 AA (target AAA). 44×44px touch targets. `prefers-reduced-motion` honoured. Color is never the only signal. Keyboard parity.** (`13_UI_Guidelines.md` §10.)

- **Why.** Tutors with low vision, motor impairments, or in bright sunlight need the app to work.
- **Enforced.** `axe-core` gate in CI. Lint `no-color-only-status`. Manual VoiceOver/TalkBack pass before release.
- **If asked to violate.** Refuse. Cite P15. Propose: add an icon + text label alongside the color; raise the target to 44px.

---

## 3. File Map

```
buddysaradhi/
├── apps/
│   ├── web/            # Next.js 16 (App Router) — primary surface (v1.0)
│   ├── mobile/         # Expo (React Native) — v1.x
│   └── desktop/        # Tauri v2 (Rust + static export) — v1.x
├── packages/
│   ├── core/           # The ledger engine — shared (v1.x)
│   ├── shared/         # Zod schemas, types, calc utils — imported by all apps
│   └── ui/             # Cross-platform glass component primitives (v1.x)
├── prisma/             # The Prisma schema (sandbox local dev DB)
├── migrations/         # Forward-only SQL migrations applied to each per-user DB
├── supabase/functions/
│   └── provision-db/   # Edge function: 1 user → 1 Turso DB
├── Buddysaradhi_Planning/   # THE SPECIFICATION — root 00–22 + web/ mobile/ desktop/ deployment/ product/ subdirs. Read AGENTS.md + 16_Platform_Delivery_Sequence.md first.
├── docs/
└── .github/workflows/  # CI/CD harnesses (web, mobile, desktop)
```

### 3.1 Per-Directory Directives

| Path | What lives here | Agent should | Agent should NOT | Governing spec |
|---|---|---|---|---|
| `apps/web` | Next.js 16 App Router, TS strict, Tailwind 4, shadcn/ui, Framer, Zustand, TanStack, `@libsql/client`, `@supabase/ssr` | Add Server Components for data; Client Components only for interactive glass; server actions for mutations | Import `z-ai-web-dev-sdk` or service-role keys into Client Components; add a 2nd user-facing route | `02_Core_Logic.md` §5, `13_UI_Guidelines.md` |
| `apps/mobile` (v1.x) | Expo SDK 51+, RN, Supabase JS, EAS, `expo-sqlite`, `expo-secure-store`, `expo-haptics`, `expo-local-authentication` | Use `FlashList` (never `FlatList` for >20 items); 44px targets; haptic on every neumorphic press; custom glass modals | Use `Alert.alert()`; ship without `expo-haptics` | `13_UI_Guidelines.md` §4, `15_Future_Roadmap.md` v1.x |
| `apps/desktop` (v1.x) | Tauri v2, Rust (`tokio`, `serde`, `libsql`), Next.js static export | Validate all IPC inputs with `serde` before touching SQLite; SQLCipher for local DB; strict capability allowlist | Broaden Tauri capabilities; bypass `serde` validation | `10_Security.md` §5, `15_Future_Roadmap.md` v1.x |
| `packages/core` (v1.x) | The ledger engine — `postLedgerEntry`, `voidEntry`, `computeBalance`, `reconcileLedger`. Pure functions over a DB handle. | Extend with new entry types via spec amendment; unit-test every path | Touch the engine without reading `12_Business_Rules.md` §3 first | `12_Business_Rules.md`, `10_Security.md` §9 |
| `packages/shared` | Zod schemas (single source of truth for types), calculation utilities (balances, attendance %, due-dates) | Add Zod schemas here first; export inferred types; unit-test calc utils | Hand-write types in an app; duplicate a fee formula | `11_Data_Model.md`, `12_Business_Rules.md` BR-CALC* |
| `packages/ui` (v1.x) | Cross-platform glass primitives: `GlassPanel`, `NeumoToggle`, `Chip`, `BarChart` | Compose from design tokens; never hardcode hex | Use indigo/blue accents; break the 44px target rule | `13_UI_Guidelines.md` |
| `prisma` | Prisma schema — the single source of truth for every model (`prisma/schema.prisma`). All DB access across web, mobile, and desktop goes through `import { db } from '@/lib/db'`. | Add a model + run `bun run db:push`; never bypass ORM with `$queryRaw` / `$executeRaw` | Treat Prisma as a sandbox-only dev tool; introduce raw SQL at runtime | `11_Data_Model.md` |
| `prisma/migrations` | Forward-only, idempotent, Prisma-managed migrations (`prisma migrate dev --name <desc>`). | Add a new numbered migration; never edit a merged one | Edit an existing migration; add a destructive `DROP` | `11_Data_Model.md` §1, `02_Core_Logic.md` §9 |
| `Buddysaradhi_Planning` | The 24-file master spec (00–23 + 6 platform subdirs incl. deployment/06) | Read first; update via RFC when implementation diverges | Treat as documentation after the fact | This file + `01_Product_Principles.md` §Amendment Process |

> The current sandbox ships only the `web` app + `Buddysaradhi_Planning`. Mobile and desktop are scaffolded in v1.x per `15_Future_Roadmap.md`.

### 3.2 Per-App Stack Snapshots

**Web (`apps/web`).** Next.js 16 App Router. Server Components for all data fetching and static composition. Client Components only for glass/neumorphic interactive surfaces (toggles, sheets, heatmaps, command palette). Only the `/` route is user-facing — screen switching is Zustand-driven inside `GlassShell` (`02_Core_Logic.md` §5). Forms: `react-hook-form` + `zod`; never submit before validation. API routes (`/app/api/*`) are the only place `z-ai-web-dev-sdk` or service-role keys may run. Sticky footer is mandatory.

**Mobile (`apps/mobile`).** Expo. `FlashList` (never `FlatList` for >20). Touch targets ≥ 44×44px. Haptic on every neumorphic press. Never `Alert.alert()` — custom glass modal alerts.

**Desktop (`apps/desktop`).** Tauri v2 + Rust + Next.js static export. All IPC inputs validated with `serde` before touching SQLite. Capabilities strictly limit which frontend origins can invoke which commands. SQLCipher for the local DB file.

### 3.3 Database Conventions

- Schema lives in `prisma/schema.prisma` — the single source of truth for every model. Migrations are Prisma-managed and forward-only (`prisma migrate dev --name <desc>` → `prisma/migrations/<timestamp>_<name>/migration.sql`). Schema DDL never runs at runtime; `bun run db:push` applies the schema during deploys.
- **All runtime DB access goes through Prisma ORM methods** — `import { db } from '@/lib/db'`. Allowed: `findMany`, `findUnique`, `findUniqueOrThrow`, `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`, `count`, `aggregate`, `groupBy`, `db.$transaction([...])` or `db.$transaction(async (tx) => { ... })`, `include`, `select`. **Forbidden at runtime:** `$queryRaw`, `$executeRaw`, raw SQL strings, `PRAGMA`, `sqlite_*` functions.
- The only exceptions are SQLite-level admin commands with no Prisma ORM equivalent (e.g. `PRAGMA key` for SQLCipher encryption, `PRAGMA wal_checkpoint(TRUNCATE)` before a backup snapshot, `PRAGMA foreign_keys=ON` / `journal_mode=WAL` at connection init). These are SQLite-level admin commands with no Prisma ORM equivalent; they run ONCE during DB init or backup verification, not in any runtime hot path, and are confined to `lib/db/admin.ts` (a single, audited module — never called from a screen, server action, or API route).
- All tables have: `id` (UUID v7), `created_at`, `updated_at`, `deleted_at` (soft delete), `tenant_id` (= user uuid, defence-in-depth even within a single-tenant DB).
- Money is stored as **integer minor units** (paise for INR). Never float. (Rule 6.)

---

## 4. The Spec Hierarchy

### 4.1 Reading Order for a New Agent

1. **`AGENTS.md`** (this file) — the operating manual.
2. **`00_Vision.md`** — the elevator pitch, the problem, the market.
3. **`01_Product_Principles.md`** — the constitution. 15 principles + anti-principles + amendment process.
4. **The screen spec you're working on** — `04_Dashboard.md`, `05_Students.md`, `06_Attendance.md`, `07_Fees_and_Payments.md`, or `08_Settings.md`.
5. **The cross-cutting specs:**
   - `02_Core_Logic.md` (the 7 engines, sync state machine)
   - `03_User_Flows.md` (golden-path flows)
   - `10_Security.md` (auth, crypto, threat model)
   - `11_Data_Model.md` (schema, IDs, money)
   - `12_Business_Rules.md` (BR-* rule IDs)
   - `13_UI_Guidelines.md` (the design system)
   - `14_Edge_Cases.md` (EC-* cases — read before declaring done)
   - `09_Backup_and_Import_Export.md` (crypto envelope, import/export)
   - `15_Future_Roadmap.md` (v1.x → v4.0)

### 4.2 Which Spec Do I Read for X?

```
              ┌─────────────────────────────────────────────────┐
              │              What is the task?                  │
              └─────────────────────────────────────────────────┘
                                 │
   ┌────────────┬───────────────┼───────────────┬──────────────┐
   ▼            ▼               ▼               ▼              ▼
"Add a     "Fix a bug      "Touch money    "Change a     "Add a network
 feature    on a screen"     or a ledger    design        call, SDK, or
 on a                        row"           token"        telemetry?"
 screen"        │               │              │              │
   │            ▼               ▼              ▼              ▼
   ▼       04/05/06/        12_BR §3       13_UI §2       AGENTS §2
04/05/06/   07/08           + 11_DM         + 00_Vis §9    STOP. Read
07/08       + 14_Edge       + 10_Sec §9                    01_PP AP-10
+ 13_UI     + 03_Flow                                     + 10_Sec §17
+ 02_Core
   │            │               │              │              │
   └────────────┴───────────────┴──────────────┴──────────────┘
                                 │
                                 ▼
                  Always: 01_Product_Principles
                  Always: 14_Edge_Cases (before "done")
                  Always: AGENTS §8 (stop-and-ask triggers)
```

---

## 5. Commit & PR Conventions

### 5.1 Conventional Commits

Format: `type(scope): summary`

- **type** ∈ `feat | fix | docs | refactor | test | chore | perf | sec`
- **scope** = the screen or engine (e.g. `fees`, `attendance`, `ledger`, `sync`, `ui`, `backup`, `agents`)
- **summary** = imperative, lowercase, ≤72 chars, no period

Examples:

```
feat(fees): add partial-payment ledger entry
fix(attendance): correct LWW tie-break on locked session
docs(agents): expand non-negotiable rules section
refactor(ledger): extract postReversingEntry into packages/core
test(backup): add AES-256-GCM round-trip regression
chore(deps): bump @libsql/client to 0.5.0
perf(students): virtualise roster at 200+ rows
sec(auth): wipe local cache on 15th failed PIN
```

### 5.2 PR Description Template

```markdown
## What changed
<one-paragraph summary>

## Why
<the user pain or the spec gap>

## Spec ref
Implements: `07_Fees_and_Payments.md` §9 Flow 10
Principle: P4 (Immutable Ledger)
Edge cases: EC-F-04, EC-F-03

## Risk
<blast radius if this is wrong; ledger? money? crypto?>

## Test plan
- [ ] Lint + typecheck pass
- [ ] Unit tests pass
- [ ] Integration: <named flow>
- [ ] Agent Browser: <screen> renders, primary interaction works, sticky footer behaves
- [ ] No P0/P1 constraint from AGENTS §2 violated
```

### 5.3 The Spec-Ref Requirement

> Every PR cites the spec section it implements. A PR without a `## Spec ref` block is auto-blocked by CI.

If you cannot find a spec section for your change, the change is either (a) covered by an existing section you haven't read — go read more — or (b) genuinely new, in which case you write the spec first per §0.1.

### 5.4 Reviewer Rules

| Change type | Reviewers required |
|---|---|
| Touches `ledger_entries` grammar or `packages/core` | 2, including one ledger-crypto reviewer |
| Touches `10_Security.md` or crypto envelope | 2, including one security reviewer |
| Touches `01_Product_Principles.md` or this `AGENTS.md` | 2 + orchestrator sign-off |
| Adds a 6th screen or new top-level route | Blocked — requires principle amendment first |
| <300 lines, no ledger/security/AGENTS touch | 1 |
| >500 lines | 2 + flag in PR description for human review (see §8) |

---

## 6. Code Style

### 6.1 TypeScript

- **Strict mode** (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- **No `any`.** Use `unknown` and narrow with a type guard or Zod parse.
- **No `as` casts** unless paired with a `// SAFETY:` comment explaining the invariant.
- **Functional React.** No class components. Hooks for state. Server Components for data; Client Components for interactive glass.
- **Server actions for mutations** (Next.js 16). Mutations never run in the browser.
- **Prisma for all DB access.** All DB calls go through `import { db } from '@/lib/db'` and use ORM methods (`findMany`, `create`, `aggregate`, `$transaction`, etc.). No `$queryRaw`, no `$executeRaw`, no raw SQL strings at runtime. The ledger engine in `packages/core` exposes typed functions (`postLedgerEntry`, `voidEntry`, `computeBalance`) that internally call `db.ledgerEntry.create()` — never raw SQL.
- **Zod for all input validation.** Every server action, every API route, every import row, every form submission. Types are inferred from Zod, never hand-written.

### 6.2 Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Functions, variables | camelCase | `postLedgerEntry`, `studentBalance` |
| React components, types, interfaces | PascalCase | `GlassPanel`, `LedgerEntry`, `StudentRow` |
| Constants, enums | SCREAMING_SNAKE_CASE | `MAX_PIN_ATTEMPTS`, `LEDGER_ENTRY_TYPE` |
| Component files | kebab-case | `glass-panel.tsx`, `student-row.tsx` |
| Non-component files | camelCase | `postLedgerEntry.ts`, `formatINR.ts` |
| Spec files | Numbered snake-case | `07_Fees_and_Payments.md` |
| Zod schemas | PascalCase + `Schema` suffix | `LedgerEntrySchema`, `StudentInputSchema` |

### 6.3 The Sticky-Footer Rule (Web)

Root layout is `min-h-screen flex flex-col`. The footer is `mt-auto`. Short pages: footer sticks to the bottom of the viewport. Long pages: footer is pushed below the fold. This is mandatory, not optional (`13_UI_Guidelines.md` §13).

### 6.4 API Route Discipline (Web)

`/app/api/*` routes are the only place `z-ai-web-dev-sdk` or Supabase service-role keys may run. Never import the SDK into a Client Component. Every API route parses its input with Zod before doing anything else. Every API route returns a typed `Result<T, E>` (no thrown-JSON pattern).

---

## 7. Testing Conventions

### 7.1 The Test Pyramid

```
                    ┌─────┐
                    │ e2e │  ← 5% — golden-path flows only (Playwright / Detox)
                ┌───┴─────┴───┐
                │ integration │  ← 25% — multi-module, real in-memory SQLite
            ┌───┴─────────────┴───┐
            │      unit           │  ← 70% — pure functions, Zod schemas, calc utils
            └─────────────────────┘
```

> In this sandbox, tests are not written unless explicitly requested (`AGENTS.md` §0 hard-repo-rule). When tests *are* requested, follow this pyramid exactly.

### 7.2 What MUST Be Tested

| Concern | Test | Spec ref |
|---|---|---|
| Ledger integrity | Append-only trigger fires on UPDATE/DELETE attempt; reversing entry net-zero; running balance after 10k entries | `10_Security.md` §9, `12_Business_Rules.md` BR-LED-01..06 |
| Backup round-trip | Encrypt → decrypt → restore → verify every table row matches | `09_Backup_and_Import_Export.md` §11, `10_Security.md` §15 |
| Auth lockout | 5/10/15 failed PIN → 30s/5min/wipe; biometric fallback | `10_Security.md` §3 |
| Sync conflict resolution | LWW picks newer `updated_at`; loser → audit_log; ledger UUID-keyed, conflict-immune | `12_Business_Rules.md` BR-SYN-01..04, `14_Edge_Cases.md` EC-SY* |
| Receipt numbering | Void does not decrement `next_receipt_seq`; gap is intentional | `12_Business_Rules.md` BR-RC-01 |
| Money math | 10% discount on ₹1,255.55 rounds half-to-even on paise | `12_Business_Rules.md` BR-M-01, `14_Edge_Cases.md` EC-F-01 |
| Crypto envelope | AES-256-GCM + Argon2id round-trip; wrong-passphrase lockout | `10_Security.md` §15, BR-BAT-02 |

### 7.3 The "Never Mock the Ledger" Rule

> In a ledger test, never mock the database. Use an in-memory SQLite (`:memory:`). A mocked DB tells you nothing about whether your trigger fires.

```ts
// ✅ Good
const db = createClient({ url: ':memory:' });
await runMigrations(db);
await postLedgerEntry(db, entry);
expect(await getBalance(db, studentId)).toBe(470000n);

// ❌ Bad — proves nothing
const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
await postLedgerEntry(db, entry); // what did this test?
```

### 7.4 CI Gate

Merge is blocked unless **all** pass:

1. `bun run lint` — ESLint + Prettier + design-system rules (`no-indigo-accent`, `no-float-money`, `no-empty-catch`, `no-color-only-status`).
2. `bun run typecheck` — `tsc --noEmit` across `apps/web`, `packages/*`.
3. `bun run test:unit` — Vitest, ≥70% line coverage on `packages/core` and `packages/shared`.
4. `bun run test:integration` — Vitest with in-memory SQLite, every flow in §7.2.
5. `bun run test:a11y` — `axe-core` on every screen.
6. (If web) Agent Browser smoke: every screen renders, sticky footer behaves, primary interaction works.

---

## 8. "Stop and Ask" Triggers

> The following situations require a pause and human review **before** the PR is opened. An autonomous agent MUST NOT proceed unilaterally.

| # | Trigger | Why sensitive | Who reviews |
|---|---|---|---|
| 1 | Touching the ledger schema (`ledger_entries` columns, triggers, or `packages/core` posting logic) | Ledger is the financial spine; a bad change corrupts every tutor's books | 2 reviewers incl. ledger-crypto owner |
| 2 | Adding a network call (any `fetch`/`http`/`axios` to a new origin) | Violates offline-first + no-telemetry if not in the allowlist | Security reviewer |
| 3 | Adding a 6th screen or a new top-level route | Violates P2; requires principle amendment | Orchestrator + principle review |
| 4 | Changing the crypto envelope (key derivation, cipher, envelope layout) | A bug leaks every backup; a migration bricks old backups | 2 reviewers incl. security owner |
| 5 | Any PR that touches >500 lines | Large PRs hide bugs; large ledger/security PRs hide catastrophes | 2 reviewers + flag in PR description |
| 6 | Any change to `AGENTS.md` or `01_Product_Principles.md` | These are the constitution; drift here propagates everywhere | Orchestrator sign-off |
| 7 | Any "quick fix" that violates a non-negotiable (§2) | Quick fixes that violate rules are not fixes — they are debt with a deadline | The rule's named reviewer (see §2) |

### 8.1 What "Stop and Ask" Looks Like

1. Stop coding. Commit what you have with `chore(wip): <what> — pending human review`.
2. Open a draft PR with the `## Spec ref` and `## Risk` blocks filled in, even if incomplete.
3. In the worklog, note: `BLOCKED on human review: <trigger #>`.
4. Return control to the orchestrator with a clear request.

---

## 9. Agent Hygiene

1. **Keep commits small.** <300 lines per commit. A 600-line commit is two commits.
2. **Run `bun run lint` before every commit.** Fix all errors before staging.
3. **Never commit secrets.** The `.env.example` pattern: `.env.example` documents the keys; `.env.local` holds the values and is git-ignored. If you accidentally commit a secret, rotate it — do not just delete the line.
4. **Update the spec if the implementation diverges.** Spec drift is tech debt with a longer half-life than code debt. Open the spec amendment first, then change the code.
5. **Update the worklog after each meaningful change.** Append a `---`-delimited section with Task ID, Agent, Task, Work Log, Stage Summary.
6. **Use TodoRead / TodoWrite for multi-step tasks.** A task with ≥3 steps gets a todo list; the agent marks each step complete as it ships.
7. **Cite the spec in every PR.** (See §5.3.)
8. **No orphan code.** (See §0.2.)
9. **Verify in Agent Browser (web).** Render + primary interaction + sticky footer.
10. **Report back.** Files changed, verification result, next recommended task.

### 9.1 The Agent Operating Loop

When an autonomous agent is working a task:

1. Read `worklog.md` to learn prior context.
2. Read the relevant spec section per §4.
3. Make the smallest correct change.
4. Run `bun run lint`. Fix all errors.
5. (If web) verify in Agent Browser: render + primary interaction + sticky footer.
6. Append a `---`-delimited section to `worklog.md` with Task ID, Agent, Task, Work Log, Stage Summary.
7. Report back with: files changed, verification result, next recommended task.

### 9.2 The Task-to-Task Transition Protocol (When an Agent Shifts Work)

The Operating Loop in §9.1 governs a **single task** end-to-end. But agents frequently **shift from one work item to another mid-session** — a new user instruction arrives, a blocker surfaces, a higher-priority task preempts the current one, or the context window fills and a fresh agent resumes. Uncontrolled, these shifts produce **orphaned work**: a half-finished task left `in_progress`, files half-edited, no worklog entry, no resume state — the next agent is blind. This protocol makes every shift auditable.

#### 9.2.1 The Single In-Flight Task Rule

**At any moment, exactly ONE task is `in_progress` in the todo list.** This is enforced by the `TodoWrite` tool (it rejects a second `in_progress` entry), but the agent must also *honour* the constraint semantically — a second task is not "started" until the first is `completed` or explicitly `paused` (see §9.2.3). Starting a second task while the first is still `in_progress` is an anti-pattern (AP-25 below).

#### 9.2.2 Before You Shift — The Close-Out Checklist

Before an agent abandons, pauses, or finishes the current task to start a new one, it MUST run this 6-step close-out. No exceptions, no "I'll come back to it."

1. **Run `bun run lint`** on the current diff. If lint fails, either fix it (preferred) or `git stash` with a message `WIP: <task-id> <reason>` and note the stash ref in the worklog. Never leave a red-lint diff on disk for the next agent.
2. **Mark the todo state honestly.**
   - If the task is genuinely finished → `completed`.
   - If the task is partially done and you are switching → `paused` (a non-terminal state; see §9.2.3). Do NOT mark a half-done task `completed` — that is AP-26.
3. **Append a `---`-delimited worklog entry** — even if the task is not "done." The entry's `Stage Summary` must answer 4 questions explicitly:
   - **State:** `COMPLETED` | `PAUSED` | `BLOCKED`
   - **Files touched:** full list with one-line change summary each
   - **Resume point:** the exact next micro-step (e.g. "§3.2 of product/05 — replace the 3-tier ASCII art block with the single Free card; the new block is drafted in `/tmp/new-card.txt`")
   - **Blocker (if any):** the trigger that stopped work (e.g. "subagent backend timed out at 2nd retry; fell back to direct execution")
4. **Commit the WIP** (if the diff is lint-clean). Conventional Commits `type(scope): subject` with ` [task-id] [WIP]` suffix, e.g. `refactor(pricing): single Free card layout [9-FREE-FOR-EVERYONE] [WIP]`. The `[WIP]` suffix is the signal to the next agent that this commit is not "done."
5. **Update the todo list** so the next agent sees the true state. Remove stale items; add the resume item with the exact resume point from step 3.
6. **Read the worklog tail back** — open `worklog.md`, read the last entry you just wrote, confirm a fresh agent with zero context could resume from it. If they couldn't, rewrite the entry.

#### 9.2.3 The `paused` State — How a Half-Done Task is Tracked

A task that is neither `completed` nor abandoned is `paused`. The todo list carries it as `pending` with a `[PAUSED — resume at <worklog Task ID>]` prefix in the content. The worklog entry for the pausing agent ends with:

```markdown
Stage Summary:
- State: PAUSED
- Resume point: <exact next micro-step + file + section>
- WIP commit: <sha> (or "uncommitted — stashed as stash@{0}")
- Next agent: read this entry, then continue from the Resume point.
```

The resuming agent's first worklog entry begins with:

```markdown
Task ID: <new-task-id> (resumes <prior-task-id>)
Agent: <agent-type>
Task: Resume <prior-task-id> — <one-line summary>

Work Log:
- Read prior worklog entry <prior-task-id>; resume point was: <quote>.
- Verified WIP commit <sha> is on disk; ran `bun run lint` → clean.
- <next micro-step>
```

#### 9.2.4 The Resume Protocol — Picking Up a Paused Task

When an agent is assigned (or self-selects) a task that a prior agent paused:

1. **Read the most recent worklog entry for that Task ID.** Extract the Resume point, the WIP commit SHA, and the blocker (if any).
2. **Verify the WIP state.** `git log --oneline -5` to confirm the WIP commit is present; `git status` to confirm no uncommitted drift; `bun run lint` to confirm the tree is clean. If any of these fail, the WIP is corrupt — do not blindly continue. File a `BLOCKED` worklog entry and escalate.
3. **Re-read the spec section** the task touches. Do not trust memory; the spec may have been amended by another agent in the interim. The spec is the contract, not the prior agent's worklog.
4. **Continue from the Resume point**, not from the top of the task. Re-doing finished work wastes time and risks divergence.
5. **When the task is genuinely complete**, mark the todo `completed` AND append a final worklog entry with `State: COMPLETED` that supersedes the paused entry. The next agent reads the *latest* entry for a Task ID, not the first.

#### 9.2.5 Shift Triggers — When an Agent MUST Run the Close-Out

The close-out (§9.2.2) is mandatory whenever ANY of these fire:

| Trigger | Example | Close-out action |
|---|---|---|
| **New user instruction preempts current task** | User says "also look into X" while you're mid-task on Y | Close-out Y → start X. Do not silently context-switch. |
| **Blocker surfaces** | Subagent backend times out; a spec contradiction blocks progress | Close-out as `BLOCKED` → start next available task or escalate. |
| **Context window approaching limit** | You sense the session is long; a fresh agent will resume | Close-out as `PAUSED` with explicit resume point. |
| **Task genuinely complete** | All §9.1 steps done, worklog appended | Close-out as `COMPLETED`. |
| **End of session / handoff** | The cron job fires; a new agent instance begins | Close-out whatever is in-flight. |
| **Pre-empted by higher priority** | A P0 bug is reported mid-feature | Close-out the feature as `PAUSED` → start the P0. |

#### 9.2.6 The Anti-Shift Lint — `no-orphaned-task.test.ts`

A CI lint (`tools/no-orphaned-task.test.ts`) scans the worklog and todo state at session end:

- **Fail** if any todo is `in_progress` with no worklog entry in the last 30 minutes (orphaned in-flight work).
- **Fail** if a worklog entry's `Stage Summary` lacks a `State:` field (ambiguous close-out).
- **Fail** if a `PAUSED` task's worklog entry lacks a `Resume point:` field (unresumable).
- **Fail** if two `in_progress` todos exist simultaneously (single in-flight task violation, §9.2.1).

This lint runs in the `webDevReview` cron job and on every PR. Orphaned work is the most expensive kind — it survives because no one knows it's half-done.

### 9.3 Platform Sequencing Discipline (the anti-hallucination rule)

§9.2 governs shifting between **tasks** within a platform. This section governs shifting between **platforms** — and it is the rule that stops the failure mode the project hit: *"the agent completes all platforms at once,"* producing hallucinations and orphaned code across `apps/web`, `apps/mobile`, `apps/desktop` simultaneously.

The full specification is `16_Platform_Delivery_Sequence.md`. This section is the executable summary every agent must obey:

1. **Exactly one platform is `In-Flight` at any moment** — Web, Mobile, or Desktop. The state lives in a status block at the top of `/home/z/my-project/worklog.md`. Read it first.
2. **An In-Flight agent edits only its own platform's files** — its app path (`apps/<platform>/`) and spec subdir (`buddysaradhi_Planning/<platform>/`). It may NOT create or edit another platform's app path or spec subdir. Cross-platform needs (a contract change, a shared-schema field) are an **RFC** (`docs/rfc/`), never a unilateral edit.
3. **A platform unlocks only on a signed Production Gate** (G1–G5) in the worklog, ending with `Next platform unlocked: <NEXT>.` Four-out-of-five is not a gate; it is `In-Flight (Gate Pending)`.
4. **Contracts are pinned to a tag** (`contracts/v1.0.0`), never `main`, so a frozen gate cannot silently break when another platform begins.
5. **The `no-parallel-platform` lint fails any PR** whose diff touches two or more of `apps/web/`, `apps/mobile/`, `apps/desktop/` (the sole exception: a reviewed contract-version bump).

The `webDevReview` cron is bound by this: it works **only** on the `In-Flight` platform and may NOT propose scaffolding a locked platform as a "new requirement." That proposal is a §8 stop-and-ask, not an autonomous action. If you are about to create `apps/mobile/` while `In-Flight: WEB`, **STOP** — read `16_Platform_Delivery_Sequence.md` §7, and do not proceed without a `WEB-PROD-GATE` sign-off.

---

## 10. Anti-Patterns for Agents

| # | Anti-pattern (what agents commonly do wrong) | Correction |
|---|---|---|
| 1 | Adding a feature without a spec | Write the spec first (`AGENTS.md` §0.1); cite the principle that authorises it. |
| 2 | Using a `float`/`number` for money | Use integer paise (`bigint` or safe-integer `number`); format with `formatINR(paise)`. |
| 3 | Adding a `console.log` in prod code | Use the typed logger (`log.info`, `log.warn`, `log.error`) which routes to `audit_log`. |
| 4 | Skipping the `sync_outbox` write on a mutation | Append the outbox row in the same transaction as the mutation (BR-SYN-01). |
| 5 | Using indigo because "it looks nice" | Use the bioluminescent palette (AP-6); indigo is the canvas, not the accent. |
| 6 | Mocking the DB in a ledger test | Use an in-memory SQLite (`:memory:`) and run real migrations. |
| 7 | Returning `any` from a server action | Return a typed `Result<T, E>`; parse inputs with Zod. |
| 8 | Editing a merged SQL migration | Add a new numbered migration; never edit history. |
| 9 | Catching an error and silently continuing | Throw a typed error or return `Err`; surface via toast + `audit_log`. |
| 10 | Adding a 6th bottom tab "just for now" | Ship the capability inside one of the five screens; open an RFC if a 6th is truly needed. |
| 11 | Calling `db.ledgerEntry.update()` / `db.ledgerEntry.delete()` on a row to "fix" it | Call `db.ledgerEntry.create({ data: { ..., reversesEntryId: <original> } })` to insert a reversing entry. Always. |
| 12 | Hardcoding a Turso `db_url` / `db_token` | Read from the Supabase JWT `user_metadata`. Hardcoded credentials are a P0 bug. |
| 13 | Skipping the `audit_log` write on lock/unlock/void/export/backup | Every sensitive mutation writes an audit row in the same transaction (BR-SEC-03). |
| 14 | Treating "it compiles" as done | Done = lint + typecheck + tests + Agent Browser + worklog + no §2 violation. |
| 15 | Using `FlatList` for >20 mobile rows | Use `FlashList` (P7). |
| 16 | Reusing a voided invoice/receipt number | `next_invoice_seq` / `next_receipt_seq` never decrement (BR-RC-01). |
| 17 | Adding a class component | Functional components only; hooks for state. |
| 18 | Hand-writing a TypeScript type that mirrors a Zod schema | `type Foo = z.infer<typeof FooSchema>`; the schema is the source of truth. |
| 19 | Adding a destructive `DROP` to a migration | Forward-only migrations; `DROP` is a manual, audited, out-of-band operation. |
| 20 | Skipping `prefers-reduced-motion` on a new animation | Honour the media query (P15, `13_UI_Guidelines.md` §7.2). |
| 21 | Blocking primary UI on a remote call when local data exists | Optimistic UI from local SQLite; sync in the background (P5). |
| 22 | Reusing a voided invoice/receipt number "because it's cleaner" | Gaps are intentional; the sequence is monotonic (BR-RC-01). |
| 23 | Hardcoding `http://localhost:3000` (or any origin) inside a `fetch` URL | Read the base URL from `env.NEXT_PUBLIC_APP_URL`; never hardcode an origin (FM-06). |
| 24 | Wrapping a `try/catch` with `toast.error('Something went wrong')` and swallowing the typed error | Re-throw the typed error; surface via toast + `audit_log` row `error_unhandled` (Rule 9, AP-9). |
| 25 | **Silently context-switching to a new task without close-out** — leaving the prior task `in_progress`, no worklog entry, half-edited files on disk | Run the §9.2.2 Close-Out Checklist before shifting. The single in-flight task rule (§9.2.1) is enforced by `TodoWrite` AND by the `no-orphaned-task.test.ts` lint. |
| 26 | **Marking a half-done task `completed`** to "clean up" the todo list | Mark it `paused` (§9.2.3) with an explicit resume point. A false `completed` is worse than an honest `paused` — it tells the next agent the work is done when it isn't. |
| 27 | **Resuming a paused task from the top** instead of from the Resume point | Read the prior worklog entry's `Resume point:` field (§9.2.4) and continue from there. Re-doing finished work risks divergence from the prior agent's partial commit. |
| 28 | **Appending a worklog entry without a `State:` field** | Every worklog `Stage Summary` must declare `State: COMPLETED \| PAUSED \| BLOCKED` (§9.2.2 step 3). Ambiguous close-out fails `no-orphaned-task.test.ts`. |

---

## 11. Glossary

| Term | Definition |
|---|---|
| **Sovereign** | The tutor owns their data, their DB, their backup, and their exit. No vendor lock-in, no telemetry, no hostage-taking. (`00_Vision.md` §10.) |
| **Ledger** | The append-only `ledger_entries` table; the financial spine. Every fee, payment, discount, refund, adjustment, void is a row. (`11_Data_Model.md` §3.7, `12_Business_Rules.md` §3.) |
| **Immutable** | Once written, never UPDATEd or DELETEd. Corrections are new rows. (`10_Security.md` §9, LEDGER-1.) |
| **Single-tenant** | One Turso DB per tutor. The `tenant_id` column is defence-in-depth, not the partitioning key. (`00_Vision.md` §10, `10_Security.md` §2.) |
| **Doctrine** | The body of principles + anti-principles + non-negotiables that govern every decision. "A thing is forbidden unless a principle permits it." (`01_Product_Principles.md`.) |
| **Engine** | One of seven background systems: Search, Reminder, Ledger, Report, Notification, Sync, Security. Not user-visible surfaces. (`02_Core_Logic.md`.) |
| **Tactile** | The neumorphic, pressable quality of glass + neumorphic surfaces. Buttons feel extruded; toggles feel like physical switches. (`13_UI_Guidelines.md` §6.) |
| **Bioluminescent** | The accent palette: emerald `#00FF9D`, cyan `#00F0FF`, amber `#FFB300`, flare `#FF5E00`, violet `#B388FF`. The "life" on the cosmic canvas. (`13_UI_Guidelines.md` §2.1.) |
| **Paise** | The minor unit of INR. ₹1 = 100 paise. All money is stored as integer paise. (`11_Data_Model.md` §1, BR-M-01.) |
| **sync_outbox** | A table that queues local writes for replay to the cloud on reconnect. Every mutation appends a row in the same transaction. (`12_Business_Rules.md` BR-SYN-01..03.) |
| **Blob store** | The v2 dumb encrypted sync target. Stores opaque encrypted blobs; cannot read user data. (`15_Future_Roadmap.md` v2.0, `10_Security.md` §19.) |
| **Vector clock** | A per-row logical clock used by v2 sync to detect concurrent edits across devices. (`10_Security.md` §19, `15_Future_Roadmap.md` v2.0.) |
| **LWW** | Last-Writer-Wins. The conflict-resolution rule for non-ledger rows: the row with the newer `updated_at` wins; the loser is logged to `audit_log`. (`12_Business_Rules.md` BR-SYN-01.) |
| **Neumorphism** | A visual style of soft extruded/inset shadows on a same-color background, producing a tactile, pressable surface. Used for toggles, knobs, buttons on the cosmic canvas. (`13_UI_Guidelines.md` §6.) |
| **Glass tier** | One of three translucent surface levels: `glass` (0.05), `glass-strong` (0.08), `glass-faint` (0.02). Default cards use `glass`; modals use `glass-strong`; zebra rows use `glass-faint`. (`13_UI_Guidelines.md` §5.2.) |
| **Close-out** | The 6-step checklist an agent runs before shifting from one task to another (lint → mark todo state → worklog entry with `State:` → WIP commit → update todos → read-back verify). (`AGENTS.md` §9.2.2.) |
| **Paused** | A non-terminal todo state for a half-done task that is being set down intentionally. Carries an explicit `Resume point:` in the worklog. Distinguished from `completed` (genuinely done) and `BLOCKED` (stopped by an external trigger). (`AGENTS.md` §9.2.3.) |
| **Resume point** | The exact next micro-step a pausing agent leaves for the resuming agent — file + section + one-line description. The resuming agent continues from here, not from the task top. (`AGENTS.md` §9.2.2 step 3, §9.2.4.) |
| **Orphaned work** | A task left `in_progress` with no worklog entry and no close-out. The most expensive failure mode — it survives because no one knows it's half-done. Caught by `no-orphaned-task.test.ts`. (`AGENTS.md` §9.2.6, AP-25.) |

---

## 12. What "Done" Means

A task is done when **all** are true:

- Lint passes (`bun run lint`).
- Typecheck passes (`bun run typecheck`).
- Unit + integration tests pass (when tests are requested — see §7.1).
- The relevant screen renders without runtime/hydration errors in Agent Browser (web).
- The golden-path interaction works end-to-end.
- The sticky footer behaves (sticks on short pages, pushes on long).
- `worklog.md` is updated with a `---`-delimited entry **whose `Stage Summary` declares `State: COMPLETED`** (§9.2.2 step 3). Entries without a `State:` field fail `no-orphaned-task.test.ts`.
- No P0/P1 constraint from §2 is violated.
- The PR cites its spec section (`## Spec ref`).
- Every "stop and ask" trigger (§8) that fired has a recorded human review.
- **If the task was resumed from a prior `PAUSED` entry** (§9.2.4), the final `COMPLETED` entry explicitly supersedes the paused entry and references its Task ID.

> **"It compiles" is never sufficient.** A green build is the floor, not the ceiling. And "it's mostly done" is never `completed` — it is `paused` with a resume point (§9.2.3).

---

## 13. Decision Framework — "Should I Add Feature X?"

> Run a feature request through this sequence before any spec or code. If `REJECT` or `DEFER`, do not start.

```
Q1. Does it fit inside one of the 5 screens (sub-screen, drawer, modal)?
    ├─ NO  → REJECT. Open a principle amendment RFC first (P2).
    └─ YES → Q2.
Q2. Does it violate the immutable ledger?
    ├─ YES    → REJECT. Cite P4 + BR-LED-01; propose a reversing-entry design.
    ├─ MAYBE  → STOP AND ASK (§8). Defer pending a ledger-crypto reviewer.
    └─ NO     → Q3.
Q3. Does it raise the tutor's minutes-per-day on the app (P12)?
    ├─ YES → REJECT. Re-design for fewer taps; or DEFER with a measurement plan.
    └─ NO  → Q4.
Q4. Does it require a new network call, SDK, or telemetry beacon?
    ├─ YES → REJECT. Cite P5 + AP-10. (Blob-store is v2 only.)
    └─ NO  → CONTINUE. Write the spec (§0.1), implement, QA per §14.
```

**Branch semantics.** `REJECT` = log and stop. `DEFER` = RFC stub in `Buddysaradhi_Planning/rfc/`, return to orchestrator. `STOP AND ASK` = §8.1. `CONTINUE` = §0.1 + §14. *Examples:* WhatsApp auto-messaging → reject on Q3+Q4; reminder engine (Case Study 1). Edit-payment-5-min → `MAYBE` on Q2; reversing-entry design (Case Study 3). Command palette (Ctrl+K) → all `NO`; continue; P3.

---

## 14. Code Review Checklist

> Run before declaring a PR ready.

| # | Check | Rule / Ref |
|---|---|---|
| 1 | `bun run lint` + `bun run typecheck` pass (0 errors, 0 warnings) | §9, §6.1 |
| 2 | No `any`; no `as` casts without `// SAFETY:` comment | §6.1, AP-7 |
| 3 | Money in integer paise; never `float`; no `+`/`-`/`*` on money — use `paiseAdd`/`paiseMul` | Rule 6, BR-M-01, EC-F-01 |
| 4 | Glass tier classes used (`glass`/`glass-strong`/`glass-faint`); no raw `rgba()` | `13_UI_Guidelines.md` §5.2 |
| 5 | Accent from `ACCENT_MAP` (emerald/cyan/flare/amber/violet); no indigo/blue as primary | Rule 5, AP-6 |
| 6 | Interactive elements have `aria-label` or visible text; touch targets ≥ 44×44px | Rule 10, P15 |
| 7 | `prefers-reduced-motion` honoured; color never the only status signal | Rule 10, AP-20 |
| 8 | Server actions/API routes parse input with Zod before DB; return typed `Result<T, E>` | §6.1, §6.4 |
| 9 | Every mutation appends `sync_outbox` + `audit_log` rows in the same transaction | Rule 7, BR-SYN-01, AP-13 |
| 10 | No `console.log` in prod; no empty `catch {}`; no new telemetry dep; PR `## Spec ref` cites a real section | Rule 9, AP-9, AP-10, §5.3 |

---

## 15. Failure Modes & Recovery

| FM | Symptom | Root cause | Fix | Prevention |
|---|---|---|---|---|
| **FM-01** | Ledger `UPDATE`d; audit gap | Edited row directly | Re-apply trigger; post reversing entry | Lint `no-ledger-mutation.py`; review gate (Rule 1) |
| **FM-02** | Fee renders as `₹1,255.5499…` | Used `number` (float) | Migrate to `INTEGER` paise; `paiseAdd`/`paiseMul` | Lint `no-float-money`; Zod rejects `number` for money (Rule 6, BR-M-01) |
| **FM-03** | 6th tab or `/route` exists | Added top-level surface "just for now" | Remove; re-home inside one of 5 screens | Route lint: only `/` user-facing in web; mobile 5 tabs (Rule 4, P2) |
| **FM-04** | UI uses `bg-indigo-600`/`text-blue-500` as primary | Reached for default Tailwind palette | Replace with `bg-accent-emerald`/`text-accent-cyan` from `ACCENT_MAP` | Lint `no-indigo-accent` rejects `#4F46E5`, `blue-600`, etc. (Rule 5, AP-6) |
| **FM-05** | Mutation via `fetch('/api/...')` in Client Component | Called a server action client-side | Move into Server Action (`'use server'`); `startTransition` | ESLint `no-fetch-in-client`; review gate on `fetch` imports (§6.4) |
| **FM-06** | `fetch` URL hardcodes `http://localhost:3000` | Copied a dev URL into prod | Read base URL from `env.NEXT_PUBLIC_APP_URL` | Lint `no-hardcoded-origin`; review gate on string-literal URLs |
| **FM-07** | Receipt number reused after void | Decremented `next_receipt_seq` to "fill gap" | Restore value; gap intentional (BR-RC-01) | Trigger `receipt_no_decrement`; CI `receipt-gap-after-void` |
| **FM-08** | Backup restores on different passphrase | Changed Argon2id params without version field | Roll back; add `kdf_version` envelope + migration | Round-trip test in CI; review gate on `crypto/backup.ts` (Rule 8, BACKUP-1) |

---

## 16. Testing & QA Protocol

> Bar to clear before "done" (§12). Run in order; fix failures before proceeding.

1. **Lint + typecheck.** `bun run lint` (0 errors, 0 warnings) + `bun run typecheck` (`tsc --noEmit` across `apps/web`, `packages/*`).
2. **Unit + integration tests** (if requested, §7.1). `bun run test:unit` (≥70% line coverage on `packages/core` and `packages/shared`); `bun run test:integration` against in-memory SQLite (`:memory:`). Never mock the DB in a ledger test (§7.3).
3. **Accessibility.** `bun run test:a11y` — `axe-core` on every screen rendered in Agent Browser. Zero critical or serious violations.
4. **Agent Browser smoke (web).** Using the `agent-browser` skill: navigate to `/`, switch to the affected screen via Zustand, perform the primary interaction, assert the sticky footer behaves on short and long pages.
5. **Dev log scan.** Tail `dev.log`; grep for `Error`, `Warning`, `Hydration`, `Suspense`, `did not match`. Any unexpected line is a blocker.
6. **Screenshot diff + worklog + spec-ref.** Attach before/after screenshots to the PR; append a `---`-delimited entry to `worklog.md` (§9.5); confirm PR `## Spec ref` cites a real spec section (§5.3).

---

## 17. Cross-Reference Index

| Spec file | Primary principles | Primary BR-/EC-/rule IDs |
|---|---|---|
| `00_Vision.md` | P1, P5, P10, P14 | — (vision, not rules) |
| `01_Product_Principles.md` | All P1–P15 + AP-* | — (the source) |
| `02_Core_Logic.md` | P5, P7, P12 | BR-SYN-01..04, BR-LED-01..06 |
| `03_User_Flows.md` | P3, P6, P12 | BR-FEE*, BR-ATT* |
| `04_Dashboard.md` | P8, P12, P15 | BR-RPT*, EC-SY* |
| `05_Students.md` | P1, P2, P6 | BR-STU*, EC-S-* |
| `06_Attendance.md` | P3, P7, P12 | BR-ATT*, EC-A-* |
| `07_Fees_and_Payments.md` | P4, P9, P12 | BR-FEE*, BR-LED-*, EC-F-*, EC-L-* |
| `08_Settings.md` | P6, P10, P11 | BR-SEC*, BR-B* |
| `09_Backup_and_Import_Export.md` | P10, P5 | BR-BAT-01..B03, BR-IMP*, BACKUP-1..4 |
| `10_Security.md` | P11, P5, P1 | BR-SEC*, LEDGER-1..4, BACKUP-1..4, TELE-1 |
| `11_Data_Model.md` | P4, P5 | BR-M-01, BR-LED-*, BR-SY* |
| `12_Business_Rules.md` | All | All BR-* |
| `13_UI_Guidelines.md` | P2, P7, P8, P15 | BR-UI* |
| `14_Edge_Cases.md` | All | All EC-* |
| `15_Future_Roadmap.md` | P5, P13 | — (roadmap) |
| `AGENTS.md` (this file) | All P + AP | All BR-/EC- (operationally) |

---

## 18. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the AGENTS.md doc. The mockups here are **decision trees, stop-and-ask flowcharts, and PR-template anatomy diagrams**, with UI surfaces referenced where they appear. Glass tiers (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) and neumorphic recipes (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) annotated. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.6`, `BR-*`, `EC-*`, `P*`, `AP-*`).

### 18.1 Design System Reference — AGENTS

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces referenced by AGENTS.md | Tier | Cross-ref |
|---|---|---|
| Lock screen / PIN pad (when an agent test triggers the lock) | `glass-strong` + backdrop; PIN pad = `neumo-raised` digits | §5.5, §8.7 |
| Toast (agent-shipped feature surfaces a success/fail) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| Bug-report modal (Diagnostics, when an agent files a P0) | `glass-strong` + backdrop | §5.5, §8.7 |
| Empty-state card (agent ships a new screen's first-visit state) | `glass` centered | §5.5, §8.19 |
| Banner (agent surfaces a deprecation / migration notice) | `glass` + amber accent left-border | §5.4, §8.3 |

| Neumorphic controls referenced by AGENTS.md | Recipe | Cross-ref |
|---|---|---|
| All primary buttons an agent's feature ships | `neumo-raised` (emerald glow); press = `neumo-pressed` | §6.6, §8.2 |
| All secondary / cancel buttons | `neumo-raised` secondary | §6.6, §8.2 |
| All input fields an agent's feature ships | `neumo-inset` well | §6.6, §8.9 |
| All segmented controls | `neumo-inset` well; active = `neumo-raised` pill | §6.6, §8.5 |
| All toggles | `neumo-inset` well + raised knob (emerald→cyan glow when on) | §6.4, §8.16 |

> **References:** Nielsen Norman Group — *Error Recovery*; OWASP — *Secure Coding Practices*; Apple HIG — *Programming Guide*; Material Design 3 — *Code Review*; WCAG 2.1 AA (Rule 10); Martin Kleppmann — *DDIA* (Rule 1 append-only); RFC 8439 + RFC 9100 (Rule 8 backup crypto).

### 18.2 Mockup A1 — The 10-Non-Negotiable-Rules Decision Tree

```
THE 10-NON-NEGOTIABLE-RULES DECISION TREE (§2) — does my PR touch any load-bearing rule?

   START: PR opens (or agent begins work)
          │
          ▼
   ┌─ Q1. Does the PR touch the ledger? ──────────────────────────────────────────┐
   │   (any change to ledger_entries grammar, packages/core, or the triggers)      │
   └─────────────────────────────────────────┬────────────────────────────────────┘
                                             │
                          ┌──────────────────┴──────────────────┐
                          ▼                                     ▼
                        yes                                    no
                          │                                     │
                          ▼                                     │
   ┌─ RULE 1 — Ledger is append-only ─────────────────────────┐ │
   │  · never call db.ledgerEntry.update() / .delete()         │ │
   │  · voids are new rows with reverses_entry_id              │ │
   │  · enforced by Prisma middleware + SQLite trigger + lint  │ │
   │  · if asked to violate: REFUSE → cite P4 + BR-LED-01      │ │
   │  · propose: postReversingEntry() + audit_log row           │ │
   │  · reviewer gate: 2 reviewers, including ledger-crypto    │ │
   └────────────────────────────────────────────────────────────┘ │
                                                                    │
                                                                    ▼
                                              ┌─ Q2. Does the PR add a fetch/http/axios? ─┐
                                              │  (any new outbound network call)          │
                                              └────────────────────┬─────────────────────┘
                                                                   │
                                              ┌────────────────────┴───────────────────┐
                                              ▼                                        ▼
                                            yes                                       no
                                              │                                        │
                                              ▼                                        │
   ┌─ RULE 2 + RULE 3 — No network calls / no telemetry SDK ──────────────────┐  │
   │  · the only allowed outbound: dumb blob store (v2 sync) + update-check    │  │
   │  · no Sentry, no Mixpanel, no PostHog, no GA, no Amplitude                │  │
   │  · CSP connect-src restricts to allowlist                                  │  │
   │  · lint: no-fetch-in-client, no-telemetry-deps                            │  │
   │  · if asked to violate: REFUSE → cite P5 + AP-10                          │  │
   │  · propose: do it locally; or draft a v2 blob-store amendment first       │  │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                    │
                                                                                    ▼
                                              ┌─ Q3. Does the PR add a route or screen? ─┐
                                              │  (any new top-level surface)              │
                                              └────────────────────┬─────────────────────┘
                                                                   │
                                              ┌────────────────────┴───────────────────┐
                                              ▼                                        ▼
                                            yes                                       no
                                              │                                        │
                                              ▼                                        │
   ┌─ RULE 4 — Five screens only ─────────────────────────────────────────────┐  │
   │  · only /, /students, /attendance, /fees, /settings are user routes       │  │
   │  · a 6th top-level screen requires a ratified principle amendment         │  │
   │  · lint: route-count.test.ts (web) + bottom-tab literal type (mobile)     │  │
   │  · if asked to violate: REFUSE → cite P2                                  │  │
   │  · propose: ship as sub-screen / drawer / modal inside existing surface   │  │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                    │
                                                                                    ▼
                                              ┌─ Q4. Does the PR touch UI / accents? ────┐
                                              │  (any colour, glass, or neumo change)     │
                                              └────────────────────┬─────────────────────┘
                                                                   │
                                              ┌────────────────────┴───────────────────┐
                                              ▼                                        ▼
                                            yes                                       no
                                              │                                        │
                                              ▼                                        │
   ┌─ RULE 5 — No indigo/blue primary accents ────────────────────────────────┐  │
   │  · use bioluminescent palette: emerald, cyan, flare, amber, violet       │  │
   │  · cosmic indigo→violet canvas is NEUTRAL, not an accent                  │  │
   │  · lint: no-indigo-accent blocks #4F46E5, blue-600, etc.                 │  │
   │  · if asked to violate: REFUSE → cite AP-6                                │  │
   │  · propose: --accent-emerald (primary), --accent-cyan (info),            │  │
   │    --accent-flare (destructive), --accent-amber #FFB300 (warning)         │  │
   │  · design review required                                                 │  │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                    │
                                                                                    ▼
                                              ┌─ Q5. Does the PR touch money? ──────────┐
                                              │  (any amount, fee, or balance)            │
                                              └────────────────────┬─────────────────────┘
                                                                   │
                                              ┌────────────────────┴───────────────────┐
                                              ▼                                        ▼
                                            yes                                       no
                                              │                                        │
                                              ▼                                        │
   ┌─ RULE 6 — Integer paise, never float ────────────────────────────────────┐  │
   │  · every amount stored as INTEGER paise (or bigint in TS)                 │  │
   │  · displayed as ₹ with 2 decimals via Intl.NumberFormat('en-IN')         │  │
   │  · lint: no-float-money; Zod: z.bigint() or paise-int                     │  │
   │  · if asked to violate: REFUSE → cite BR-M-01                             │  │
   │  · propose: store paise, format with formatINR(paise)                     │  │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                    │
                                                                                    ▼
                                              ┌─ Q6. Does the PR mutate data? ──────────┐
                                              │  (any db.<model>.create/update/delete)   │
                                              └────────────────────┬─────────────────────┘
                                                                   │
                                              ┌────────────────────┴───────────────────┐
                                              ▼                                        ▼
                                            yes                                       no
                                              │                                        │
                                              ▼                                        │
   ┌─ RULE 7 — Every mutation writes sync_outbox + audit_log ─────────────────┐  │
   │  · same transaction as the mutation; no "small mutation" exception       │  │
   │  · integration tests assert outbox row count after every flow             │  │
   │  · if asked to violate: REFUSE → cite P5 + BR-SYN-01                      │  │
   │  · propose: write the outbox + audit row in the same TX                   │  │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                    │
                                                                                    ▼
                                              ┌─ Q7. Does the PR touch crypto/backup? ───┐
                                              │  (any change to crypto/backup.ts)         │
                                              └────────────────────┬─────────────────────┘
                                                                   │
                                              ┌────────────────────┴───────────────────┐
                                              ▼                                        ▼
                                            yes                                       no
                                              │                                        │
                                              ▼                                        │
   ┌─ RULE 8 — Backups are AES-256-GCM + Argon2id ────────────────────────────┐  │
   │  · envelope: salt(16) || nonce(12) || tag(16) || ciphertext              │  │
   │  · KDF: argon2id m=64MiB t=3 p=2 (PIN) or p=4 (passphrase)                │  │
   │  · no escrow, no plaintext fallback                                       │  │
   │  · round-trip test in CI; code review on any crypto/backup.ts change      │  │
   │  · if asked to violate: REFUSE → cite BR-BAT-01 + BACKUP-1                │  │
   │  · propose: use the existing createBackup(passphrase) API                 │  │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                    │
                                                                                    ▼
                                              ┌─ Q8. Does the PR have a try/catch? ──────┐
                                              │  (any error-handling code)                │
                                              └────────────────────┬─────────────────────┘
                                                                   │
                                              ┌────────────────────┴───────────────────┐
                                              ▼                                        ▼
                                            yes                                       no
                                              │                                        │
                                              ▼                                        │
   ┌─ RULE 9 — No silent failures ────────────────────────────────────────────┐  │
   │  · every error throws or returns a typed Result<T, E>                      │  │
   │  · no empty catch {}; no console.log in prod                               │  │
   │  · lint: no-empty-catch, no-console                                        │  │
   │  · if asked to violate: REFUSE → cite P11 (no silent failure)              │  │
   │  · propose: throw typed error + toast + audit_log                          │  │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                    │
                                                                                    ▼
                                              ┌─ Q9. Does the PR ship UI? ───────────────┐
                                              │  (any user-facing component)              │
                                              └────────────────────┬─────────────────────┘
                                                                   │
                                              ┌────────────────────┴───────────────────┐
                                              ▼                                        ▼
                                            yes                                       no
                                              │                                        │
                                              ▼                                        │
   ┌─ RULE 10 — Accessibility is not optional ────────────────────────────────┐  │
   │  · WCAG 2.1 AA (target AAA); 44px touch targets; reduced-motion honoured │  │
   │  · colour is NEVER the only signal (AP-14); keyboard parity              │  │
   │  · axe-core gate in CI; lint: no-color-only-status                       │  │
   │  · VoiceOver/TalkBack manual pass before release                         │  │
   │  · if asked to violate: REFUSE → cite P15                                │  │
   │  · propose: add icon + text label alongside colour; raise target to 44px │  │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                    │
                                                                                    ▼
   ┌─ PR READY ─────────────────────────────────────────────────────────────────┐
   │  · all touched rules verified (or refusal documented)                       │
   │  · spec ref cited (§5.3)                                                    │
   │  · test plan complete (§5.2)                                                │
   │  · reviewer count per §5.4                                                  │
   └──────────────────────────────────────────────────────────────────────────────┘

   ↑ The tree is exhaustive — every PR touches at least one rule. A PR that
     touches none is either docs-only or a no-op.
   ↑ "If asked to violate" is the agent's refusal script. The agent REFUSES,
     CITES the rule, PROPOSES the principled alternative, ESCALATES per §8.
   ↑ The 10 rules are derived from 01_Product_Principles.md P1–P15 + AP-*.
     They are not negotiable for an autonomous agent.
```

- ↑ **Every PR touches at least one rule.** A PR that touches none is either docs-only (no code) or a no-op (no behaviour change). The tree is exhaustive by construction.
- ↑ **Refusal is scripted.** The agent does not negotiate; it refuses, cites the rule by number, proposes the principled alternative, and escalates per §8. The script is in §2 (each rule's "If asked to violate" block).
- ↑ **Reviewer count scales with rule touch.** A PR touching Rule 1 (ledger) or Rule 8 (crypto) requires 2 reviewers including a specialist; a PR touching only Rule 4 (route) requires 1 reviewer + the route-count test (`§5.4`).

### 18.3 Mockup A2 — Stop-and-Ask Flowchart (§8)

```
STOP-AND-ASK FLOWCHART (§8) — when an agent MUST pause and escalate to a human

   START: agent is mid-task
          │
          ▼
   ┌─ TRIGGER CHECK — any of these fire? ──────────────────────────────────────┐
   │                                                                            │
   │  (a) asked to violate a §2 non-negotiable rule                             │
   │  (b) spec is silent on the situation                                       │
   │  (c) spec is internally contradictory                                      │
   │  (d) two principles strain each other and §15 conflict matrix is silent    │
   │  (e) the change touches money + crypto + ledger (triple-risk)              │
   │  (f) the change requires a new top-level screen (Rule 4)                   │
   │  (g) the change requires a new dependency (Rule 5 — boring tech)           │
   │  (h) the change touches settings.pin_hash or settings.biometric_enabled    │
   │  (i) the change touches the .buddysaradhi envelope format                       │
   │  (j) the change touches the sync_outbox schema                             │
   │  (k) a test fails and the agent doesn't understand why                     │
   │  (l) a reviewer requests a change the agent believes violates a rule       │
   │                                                                            │
   └─────────────────────────────────────────┬──────────────────────────────────┘
                                             │
                          ┌──────────────────┴──────────────────┐
                          ▼                                     ▼
                no trigger fires                         ≥ 1 trigger fires
                          │                                     │
                          │                                     ▼
                          │              ┌─ STEP 1. STOP coding immediately ──────┐
                          │              │  · do not commit; do not push            │
                          │              │  · do not "finish the PR and ask later"  │
                          │              └────────────────────┬─────────────────────┘
                          │                                   ▼
                          │              ┌─ STEP 2. Document the trigger ─────────┐
                          │              │  · which (a)–(l) fired?                  │
                          │              │  · cite the spec section / rule / EC-*   │
                          │              │  · one-paragraph summary of the situation│
                          │              └────────────────────┬─────────────────────┘
                          │                                   ▼
                          │              ┌─ STEP 3. Propose ≥ 2 paths ─────────────┐
                          │              │  · path A: the principled alternative    │
                          │              │    (what the spec would say if amended)  │
                          │              │  · path B: the minimum viable change     │
                          │              │    that stays in-bounds                  │
                          │              │  · path C (if applicable): defer the     │
                          │              │    feature to v1.x / v2.0                │
                          │              └────────────────────┬─────────────────────┘
                          │                                   ▼
                          │              ┌─ STEP 4. Open a "stop-and-ask" issue ───┐
                          │              │  · tag: `stop-and-ask`                   │
                          │              │  · body: steps 1–3                       │
                          │              │  · CC: project lead + spec author of     │
                          │              │    the cited section                     │
                          │              └────────────────────┬─────────────────────┘
                          │                                   ▼
                          │              ┌─ STEP 5. Wait for human resolution ─────┐
                          │              │  · the agent does NOT merge the PR       │
                          │              │  · the agent does NOT mark the task done │
                          │              │  · the agent may continue other work     │
                          │              │    that does not touch the trigger       │
                          │              └────────────────────┬─────────────────────┘
                          │                                   │
                          │                                   ▼
                          │              ┌─ STEP 6. Human resolves ─────────────────┐
                          │              │  · (a) amend the spec first (RFC + 14-day │
                          │              │    + ratify) then code                    │
                          │              │  · (b) reject the feature (defer to vX.Y) │
                          │              │  · (c) approve path A/B/C                 │
                          │              └────────────────────┬─────────────────────┘
                          │                                   │
                          │                                   ▼
                          │              ┌─ STEP 7. Resume ─────────────────────────┐
                          │              │  · agent implements the chosen path      │
                          │              │  · cites the resolution in the PR        │
                          │              │  · closes the stop-and-ask issue         │
                          │              └──────────────────────────────────────────┘
                          ▼
   ┌─ CONTINUE coding (no trigger fired) ───────────────────────────────────────┐
   │  · proceed with the task per the spec                                       │
   │  · cite the spec section in the commit message (§5.3)                       │
   │  · run the test plan (§5.2)                                                 │
   │  · open the PR; reviewer count per §5.4                                     │
   └──────────────────────────────────────────────────────────────────────────────┘

   ↑ The 12 triggers (a–l) are exhaustive — an agent should never find itself
     "stuck" without a trigger to cite. If it does, the trigger list is amended.
   ↑ STOP coding is mandatory. The agent does not "finish the PR and ask later" —
     that is how silent violations ship (Rule 9 — no silent failures).
   ↑ The human resolution is the contract. The agent does not negotiate; it
     proposes ≥ 2 paths and waits. The human picks; the agent implements.
```

- ↑ **The 12 triggers are exhaustive.** A new trigger discovered in production is added to (a)–(l) in the next spec amendment. An agent that finds itself stuck without a trigger to cite is itself a spec defect.
- **STEP 1 is the load-bearing step.** The agent stops coding IMMEDIATELY — no "let me finish the PR first." This is how silent violations ship (Rule 9).
- **STEP 3 is the agent's value-add.** The agent does not just escalate; it proposes ≥ 2 principled paths. The human picks; the agent implements. This is the agent-as-colleague pattern, not the agent-as-order-taker.

### 18.4 Mockup A3 — PR-Template Anatomy (§5.2)

```
PR-TEMPLATE ANATOMY (§5.2) — every PR cites spec, principle, edge cases, risk, test plan
                              (CI auto-blocks a PR missing ## Spec ref — §5.3)

   ┌─ PR TITLE ──────────────────────────────────────────────────────────────────┐
   │  type(scope): summary                                                        │
   │  · type  ∈ feat | fix | docs | refactor | test | chore | perf | sec          │
   │  · scope = screen or engine (fees, attendance, ledger, sync, ui, backup, …)  │
   │  · summary = imperative, lowercase, ≤72 chars, no period                     │
   │  · examples:                                                                 │
   │    feat(fees): add partial-payment ledger entry                              │
   │    fix(attendance): correct LWW tie-break on locked session                  │
   │    sec(auth): wipe local cache on 15th failed PIN                            │
   └──────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ PR BODY (5 mandatory sections) ────────────────────────────────────────────┐
   │                                                                              │
   │  ## What changed                                                             │
   │  <one-paragraph summary of the change>                                       │
   │  · what the user sees (if anything)                                          │
   │  · what the data model does (if anything)                                    │
   │  · what the engines do (if anything)                                         │
   │                                                                              │
   │  ## Why                                                                      │
   │  <the user pain or the spec gap>                                             │
   │  · name the persona (Riya / Kabir / Menon) and the pain                      │
   │  · OR name the spec gap ("§X says nothing about Y")                          │
   │                                                                              │
   │  ## Spec ref                          ← MANDATORY (CI auto-blocks if missing)│
   │  Implements: `07_Fees_and_Payments.md` §9 Flow 10                            │
   │  Principle: P4 (Immutable Ledger)                                            │
   │  Edge cases: EC-F-04, EC-F-03                                                │
   │  Rules touched: Rule 1 (ledger append-only), Rule 6 (integer paise)          │
   │                                                                              │
   │  ## Risk                                                                     │
   │  <blast radius if this is wrong>                                             │
   │  · ledger? (highest — financial spine)                                       │
   │  · money? (high — integer paise drift)                                       │
   │  · crypto? (high — backup envelope)                                          │
   │  · sync_outbox? (medium — replication contract)                              │
   │  · UI only? (low — reversible)                                               │
   │                                                                              │
   │  ## Test plan                                                                │
   │  - [ ] Lint + typecheck pass                                                 │
   │  - [ ] Unit tests pass                                                       │
   │  - [ ] Integration: <named flow>                                             │
   │  - [ ] Agent Browser: <screen> renders, primary interaction works,           │
   │        sticky footer behaves (.glass-faint, §13)                             │
   │  - [ ] No P0/P1 constraint from AGENTS §2 violated                           │
   │  - [ ] WCAG 2.1 AA: axe-core passes (Rule 10)                                │
   │  - [ ] No new telemetry URLs (Rule 2 + Rule 3)                               │
   │  - [ ] All mutations write sync_outbox + audit_log (Rule 7)                  │
   │                                                                              │
   └──────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ REVIEWER ASSIGNMENT (§5.4) ────────────────────────────────────────────────┐
   │  · change type → reviewer count                                              │
   │    - ledger_entries / packages/core → 2 (incl. ledger-crypto reviewer)       │
   │    - crypto/backup.ts                       → 2 (incl. security reviewer)    │
   │    - sync_outbox schema                     → 2 (incl. sync reviewer)        │
   │    - new top-level route                    → 2 (incl. design reviewer)      │
   │    - 1-3 line fix / docs                    → 1                              │
   │  · all reviewers must be humans (no auto-merge, no auto-approve)             │
   └──────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ MERGE GATE (CI) ───────────────────────────────────────────────────────────┐
   │  · lint + typecheck + tests all green                                        │
   │  · axe-core passes (Rule 10)                                                 │
   │  · no-telemetry-deps + no-fetch-in-client pass (Rules 2, 3)                  │
   │  · no-ledger-mutation + no-float-money pass (Rules 1, 6)                     │
   │  · no-indigo-accent + no-color-only-status pass (Rules 5, 10)                │
   │  · spec-ref-present check passes (§5.3)                                      │
   │  · reviewer count met (§5.4)                                                 │
   │  · if any RED → block merge; agent does NOT self-merge                       │
   └──────────────────────────────────────────────────────────────────────────────┘

   ↑ ## Spec ref is MANDATORY — CI auto-blocks a PR without it (§5.3).
   ↑ ## Risk names the blast radius — ledger/money/crypto are the highest-risk
     changes; a P0 bug in any of these is a release blocker.
   ↑ The test plan includes Agent Browser verification of the .glass-faint sticky
     footer (§13) — the footer is the canary for shell integrity.
```

- ↑ **The 5 mandatory sections are the contract.** A PR missing any of them is auto-blocked by CI (`§5.3` enforces `## Spec ref`; the rest are enforced by reviewer gate).
- ↑ **Reviewer count scales with blast radius.** Ledger, crypto, sync, and new-route changes require 2 reviewers including a specialist; everything else requires 1. No auto-merge, no auto-approve.
- ↑ **The merge gate is the load-bearing wall.** CI enforces Rules 1–3, 5, 6, 10 at compile time; the agent does NOT self-merge under any circumstance (Rule 9 — no silent failures extends to no silent merges).

---

*This file is the operating manual. It is read first, before any spec. When a spec and this file disagree, the spec wins — unless the spec is wrong, in which case you amend the spec first, then the code, then this file. The order matters.*
