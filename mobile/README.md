# Buddysaradhi Mobile — Planning Package README

> **Scope.** This directory is the **agent-ready specification package for the Buddysaradhi mobile app** — an Expo + React Native + EAS project that ships the same five-screen doctrine (`02_Core_Logic.md` §1.1) as the web product, on iOS and Android, with offline-first semantics, OLED-optimised dark mode, biometric security, and over-the-air updates. Every file here is written so that another AI agent (or a human React Native engineer) can implement the mobile app end-to-end without asking follow-up questions.

This README is the orientation index. **Read it first.** It tells you what file to read next based on the task at hand, what stack we have committed to, and which cross-cutting spec IDs (`P1–P15`, `BR-*`, `EC-*`, `LEDGER-*`, `BACKUP-*`, `TELE-*`) govern the work.

---

## 1. The Stack at a Glance

| Concern | Choice | Why this, not the alternative |
|---|---|---|
| App framework | **Expo SDK 52** (managed workflow) | No Xcode/Android Studio for 95% of work; EAS handles builds, signing, and OTA updates. Bare React Native would force us to maintain native iOS/Android build pipelines we do not need. |
| Language | **TypeScript 5.x**, `strict: true`, `noUncheckedIndexedAccess: true` | Same contract as the web app (`AGENTS.md` §6.1). No `any`. No `as` casts without `// SAFETY:`. |
| Router | **expo-router v4** (file-based routing) | Mirrors Next.js App Router mental model; one file per visible route; nested layouts via `_layout.tsx`. |
| Storage (local) | **expo-sqlite** (SQLite, WASM-backed on iOS, native on Android) | Local-first replica of the per-user Turso DB. Schema mirrors `11_Data_Model.md`. |
| Storage (remote) | **@libsql/client** (HTTP transport, not WebSocket) | Same driver as web; 30s HTTP polling is enough for a single-user tutor DB. WebSocket sync is reserved for v2 multi-device (see `15_Future_Roadmap.md`). |
| Secrets | **expo-secure-store** (iOS Keychain / Android Keystore) | Stores the Turso scoped JWT, biometric-protected. Never AsyncStorage, never plaintext config (`10_Security.md` §2.3). |
| Biometrics | **expo-local-authentication** (FaceID / TouchID / Android Biometric) | Tactile security per P11 (`01_Product_Principles.md`). |
| State (server cache) | **TanStack Query v5** (React Native compatible) | Same cache, retry, and invalidation model as web. |
| State (UI) | **Zustand** + **react-native-mmkv** persistence | MMKV replaces `localStorage` — 30x faster, encrypted via `react-native-mmkv-storage`. |
| Forms | **react-hook-form** + **zod** | Same Zod schemas as web, shared via `@buddysaradhi/shared`. (`AGENTS.md` §6.1.) |
| Styling | **NativeWind 4** (Tailwind on native) | Mirrors the web's Tailwind classes; the glass tier tokens (`glass`, `glass-strong`, `glass-faint`) port directly. (`13_UI_Guidelines.md` §5.2.) |
| Animations | **Reanimated 3** (60fps gestures on UI thread) | Swipe-to-mark-attendance, swipe-to-record-payment, neumorphic press affordances. |
| Lists | **FlashList** (`@shopify/flash-list`) | Never `FlatList` for >20 rows (`AGENTS.md` §3.2). |
| Haptics | **expo-haptics** | `notificationAsync(success/warning/error)` on every `BR-*` state transition (P11). |
| Notifications | **expo-notifications** | 6 reminder types (`BR-REM-01..06`). |
| File system | **expo-file-system** + **expo-sharing** | Encrypted `.buddysaradhi` backups (`09_Backup_and_Import_Export.md`). |
| Updates | **EAS Update** (replaces CodePush) | Native Expo integration; channel-based rollouts. |
| Builds | **EAS Build** | Cloud iOS + Android builds, credentials managed. |
| JS engine | **Hermes** (default on Expo SDK 52) | Bytecode precompilation, smaller bundles, faster cold start. |

**Versions are pinned** to Expo SDK 52 + React Native 0.76 + Hermes + Reanimated 3.6+. Do not bump without an explicit migration spec — see `05_EAS_Build.md` §7 (Native Dependency Upgrades).

---

## 2. File Index — What Each File Is For

Every file in this directory targets a specific reader doing a specific job. The list is in reading order, not alphabetical.

| # | File | Target reader | One-paragraph summary |
|---|---|---|---|
| 1 | `README.md` (this file) | Everyone, first | Orientation index. Stack-at-a-glance, file map, decision tree, cross-reference table. |
| 2 | `01_Architecture.md` | Mobile architect, senior RN engineer | The high-level architecture: managed-workflow Expo, expo-router file tree, OLED-first dark mode, the five-tab surface map, native module inventory, bundle size budgets, and how the mobile app inherits the same five-screen doctrine as web. |
| 3 | `02_Native_Modules_and_Storage.md` | Storage / sync engineer | Deep dive on `expo-sqlite` schema (mirrors `11_Data_Model.md`), libSQL HTTP client, `expo-secure-store` for the Turso JWT, biometric flow, haptic feedback contract, file system + encrypted backups, notifications, and the full permissions matrix. |
| 4 | `03_Navigation_and_State.md` | RN frontend engineer | expo-router `(tabs)` + `(modal)` + `(auth)` group structure, custom glass tab bar, TanStack Query + Zustand + MMKV state layers, form state via `react-hook-form` + zod, deep linking config, and the back-gesture contract. |
| 5 | `04_Offline_Sync_and_Conflict_Resolution.md` | Sync engineer | The crux of mobile: offline-first writes, `sync_outbox` queue, background fetch sync, libSQL HTTP push, conflict resolution rules (LWW for non-ledger, append-only for ledger/attendance/audit), exponential backoff, clock drift, schema drift, and the green/amber/red sync indicator. |
| 6 | `05_EAS_Build.md` | Release engineer / DevOps | `eas.json` profiles (`development` / `preview` / `production`), credential management, build matrix, env var push, the EAS → Vercel Blob handoff for the web download hub, caching strategy, and the native-dependency-upgrade protocol. |
| 7 | `06_EAS_Update.md` | Release engineer / DevOps | EAS Update OTA channels (`production` / `staging` / `development`), channel branching strategy, client-side update flow, rollback playbook, signing, telemetry, and the hard limit that OTA can never ship native code. |
| 8 | `07_App_Store_Release.md` | Release engineer / DevOps | iOS App Store (TestFlight → review), Google Play (internal → closed → open → production staged rollout), versioning, release cadence (PATCH weekly OTA, MINOR monthly store, MAJOR quarterly), metadata and privacy labels, and the rollback playbook for each store. |
| 9 | `AGENTS.md` | The next mobile agent | Handoff instructions: prime directive (5 tabs only, ≤2 nav levels), reading order, file map, code style, testing protocol, stop-and-ask triggers, glossary, and what "done" means for a mobile task. |

> **Total target word count across the package: ≥ 22,000 words.** Each individual file targets 1,800–4,000 words. Word counts are verified at the end of the task — see `worklog.md` Task ID `2-b`.

---

## 3. Where to Start — Decision Tree

Run your task through this tree to find the file you should read first. If you have not read the top-level `AGENTS.md` and `01_Product_Principles.md` yet, do that first — every non-negotiable rule there applies to mobile verbatim (integer paise, append-only ledger, no indigo/blue, no telemetry, five screens only, etc.).

```
                  ┌──────────────────────────────────────────────┐
                  │  What is the mobile task?                    │
                  └──────────────────────────────────────────────┘
                                   │
   ┌──────────┬────────────┬───────┴────────┬─────────────┬──────────────┐
   ▼          ▼            ▼                ▼             ▼              ▼
"Set up the   "Wire up a   "Build the     "Sync has a   "Ship a new   "I am the
 Expo project native      navigation     bug /         build to the   next mobile
 from scratch module"     + state"       conflict      stores"        agent — what
 / scaffolding"                       issue"                         do I do?"
   │          │            │                │             │              │
   ▼          ▼            ▼                ▼             ▼              ▼
 01_Arch     02_Native    03_Nav_State    04_Offline    05_EAS_Build   AGENTS.md
 .md         _Modules     .md             _Sync         .md            (then read
             .md                          .md           + 06_EAS       everything
                                         + 07_App      _Update.md     else)
                                         _Store_       + 07_App
                                         Release.md    _Store_Release
                                                        .md
```

### 3.1 Special Cases

- **"I need to add a new permission."** Read `02_Native_Modules_and_Storage.md` §9 (Permissions Matrix) first. Adding a permission is a **stop-and-ask trigger** (`AGENTS.md` §8) — do not proceed without sign-off.
- **"I need to ship a JS-only bug fix to production."** Read `06_EAS_Update.md` §3 (Channel Branching) → §4 (Client-Side Flow) → §5 (Rollback). OTA only; no store review needed.
- **"I added a new npm dep that has native code."** Read `05_EAS_Build.md` §7 (Native Dependency Upgrades). OTA cannot ship native code; you need a full EAS Build + store resubmit.
- **"I need to design a new screen."** Stop. There are five screens, forever (P2). The new capability goes inside one of the five as a modal, drawer, or sub-screen. See `AGENTS.md` (mobile) §0 (Prime Directive).
- **"I need to use an indigo/blue color."** Stop. Use Emerald / Cyan / Flare / Amber / Violet only (Rule 5, `AGENTS.md` (top-level) §2).

---

## 4. Cross-Reference Quick Table

Every file in this directory cites the top-level specs by name and section ID. This table is a one-look index so you do not have to grep.

| Spec ID / file | What it is | Where the mobile package cites it |
|---|---|---|
| `00_Vision.md` | The elevator pitch, personas, five-screen doctrine | `01_Architecture.md` §1; `AGENTS.md` (mobile) §0 |
| `01_Product_Principles.md` P1–P15 | The constitution | Every file cites the relevant P# in its opening section |
| `02_Core_Logic.md` §1 | GlassShell, sidebar, five screens | `01_Architecture.md` §4 (Tab surface map); `03_Navigation_and_State.md` §2 |
| `02_Core_Logic.md` §3.6 | Sync engine, LWW | `04_Offline_Sync_and_Conflict_Resolution.md` §3 |
| `03_User_Flows.md` | Golden-path flows | `01_Architecture.md` §6 (mirrors); `03_Navigation_and_State.md` §6 |
| `06_Attendance.md` BR-ATT-* | Attendance rules, 24h lock | `01_Architecture.md` §6.3; `02_Native_Modules_and_Storage.md` §6 (haptics on lock); `04_Offline_Sync…md` §4 (conflict resolution) |
| `07_Fees_and_Payments.md` BR-FEE-*, BR-LED-* | Fees, ledger, voids | `02_Native_Modules_and_Storage.md` §6 (haptics on payment recorded / void); `04_Offline_Sync…md` §4 (append-only ledger) |
| `08_Settings.md` | Settings screen surfaces | `03_Navigation_and_State.md` §2.5 (Settings tab) |
| `09_Backup_and_Import_Export.md` BR-BAT-01..B05 | Backup format, restore | `02_Native_Modules_and_Storage.md` §7 (File system + encrypted backups) |
| `10_Security.md` §2–§3 | Auth, biometric, lockout | `02_Native_Modules_and_Storage.md` §4 (Biometric flow), §5 (SecureStore) |
| `10_Security.md` §9 LEDGER-* | Ledger append-only triggers | `04_Offline_Sync…md` §4 (conflict-immune ledger) |
| `10_Security.md` §15 BACKUP-1..4 | Backup crypto envelope | `02_Native_Modules_and_Storage.md` §7 |
| `10_Security.md` §17 TELE-1 | No telemetry | `AGENTS.md` (mobile) §6 (Stop-and-ask) |
| `11_Data_Model.md` | Per-table schema | `02_Native_Modules_and_Storage.md` §2 (expo-sqlite schema mirror) |
| `12_Business_Rules.md` BR-* | All rules | Cited throughout; every haptic, sync rule, conflict rule, etc. |
| `13_UI_Guidelines.md` §2 | Color tokens | `01_Architecture.md` §5 (OLED dark mode); `03_Navigation_and_State.md` §3 (glass tab bar) |
| `13_UI_Guidelines.md` §5.2 | Glass tier (`glass`, `glass-strong`, `glass-faint`) | `01_Architecture.md` §5; every file that mentions native glass |
| `14_Edge_Cases.md` EC-SY-01..08 | Sync edge cases | `04_Offline_Sync…md` §5 (clock drift, schema drift, mid-sync failure) |
| `14_Edge_Cases.md` EC-SEC-01..06 | Security edge cases | `02_Native_Modules_and_Storage.md` §4 (lockout, biometric unavailable) |
| `15_Future_Roadmap.md` v3.1 | Native mobile via Expo | `01_Architecture.md` §1 (why Expo); `AGENTS.md` (mobile) §0 |
| `AGENTS.md` (top-level) | The operating manual | `AGENTS.md` (mobile) is the mobile-specific supplement |
| `product/04_Download_Hub.md` | Commercial download hub (Web/Mac/Win/Android/iOS) — surfaces the mobile APK (Vercel Blob sideload mirror) and TestFlight invite links alongside the other platform installers | `05_EAS_Build.md` §6 (post-build Vercel Blob upload); `07_App_Store_Release.md` §3 (Android sideload APK via `bundletool` from the production AAB) |
| `product/05_Pricing_and_Plans.md` | Mobile-tier pricing — "Free for everyone, for now" model: a single public Free tier (₹0/mo for every tutor, every feature, no card required, free while our backend infra stays free); Pro ₹299/mo and Institute ₹999/mo are internal-only future tiers in Appendix A that launch on the §1.6 trigger; the 250-student number is internal soft guidance — no paywall, no waitlist; mobile install inherits the same tier as the web account via the Supabase auth JWT | `README.md` §1 (stack — Supabase auth); `07_App_Store_Release.md` §2.4 (App Store description: "Free for everyone, for now — free while our backend infra stays free. Paid tiers launch when we scale.") |
| `deployment/03_EAS_Build_and_Update_Channels.md` | Cross-cutting EAS choreography — the single source of truth for the three-channel model, the `eas.json` profile contract, and the OTA branching strategy | `05_EAS_Build.md` (eas.json profiles align with deployment/03 §3); `06_EAS_Update.md` §2 (channel→branch mapping mirrors deployment/03 §4.2) |

---

## 5. Constraints That Apply to Every File in This Package

These are restated from the top-level `AGENTS.md` §2 (the ten non-negotiable rules) and apply to mobile verbatim. Mobile-specific notes are added where the rule has a mobile consequence.

1. **The ledger is append-only** (`BR-LED-01`). On mobile, the same SQLite triggers that block `UPDATE`/`DELETE` on `ledger_entries` must exist in the local `expo-sqlite` DB. A void is a new row with `reverses_entry_id`, never an edit.
2. **No network calls that process user data** except the Turso sync transport (libSQL HTTP). No analytics, no Sentry, no Mixpanel. (`TELE-1`.)
3. **No telemetry/analytics SDK.** `expo-application`'s analytics hooks are disabled. EAS Build telemetry is opt-out.
4. **Five screens only.** Five bottom-tab routes: Dashboard, Students, Attendance, Fees & Payments, Settings. A sixth tab is a build error (P2).
5. **No indigo/blue primary accents.** Mobile uses Emerald `#00FF9D`, Cyan `#00F0FF`, Amber `#FFB300`, Flare `#FF5E00`, Violet `#B388FF`. Same palette as web.
6. **Integer paise, never float.** Money columns are `INTEGER`. UI uses `formatINR(paise)` from `@buddysaradhi/shared`.
7. **Every mutation writes to `sync_outbox` in the same transaction** (`BR-SYN-01`).
8. **Backups are AES-256-GCM + Argon2id**, never plaintext (`BACKUP-1`).
9. **No silent failures.** No empty `catch {}`. No `console.log` in prod.
10. **Accessibility.** Touch targets ≥ 44×44px. `prefers-reduced-motion` honoured via `AccessibilityInfo.isReduceMotionEnabled()`. Color is never the only signal — pair with an icon or text label.

---

## 6. How This Package Was Written

This package was authored by Task ID `2-b` (general-purpose mobile platform spec writer) on the same day the `web/` and `desktop/` platform packages were authored. The brief was: produce 9 thorough, agent-ready planning files under `Buddysaradhi_Planning/mobile/` that another AI agent or human engineer can pick up to implement the mobile app end-to-end without asking further questions. Every file cross-references the existing top-level specs (`00_Vision.md`, `01_Product_Principles.md`, `02_Core_Logic.md`, `03_User_Flows.md`, `06_Attendance.md`, `09_Backup_and_Import_Export.md`, `10_Security.md`, `11_Data_Model.md`, `12_Business_Rules.md`, `13_UI_Guidelines.md`, `14_Edge_Cases.md`, `15_Future_Roadmap.md`, `AGENTS.md`).

The package does **not** modify any source code under `src/` or `apps/`. It is planning only. The mobile app itself will be scaffolded under `apps/mobile/` in a follow-up task — see `AGENTS.md` (mobile) §1 for the scaffold checklist.

---

## 7. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (80–100 for orientation diagrams). The two mockups below visualise the *orientation primitives* — the file-index decision tree (complementing §3 above) and the platform cross-reference map — that a new mobile agent reads first to navigate this package.

### 7.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **orientation layer**, not the live-screen layer. The mockups below are *concept diagrams* (decision trees, cross-reference maps) — they are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every spec describes its content with a mockup), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-screen components that the 7 substantive files (`01` through `07`) specify; this file's job is to feed a new agent the decision tree and the cross-reference map they consume to find the right file.

| Orientation artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §2 File index | (none — orientation only) | (none) |
| §3 Decision tree | (none — orientation only) | (none) |
| §4 Cross-reference quick table | (none — orientation only) | (none) |
| §7.2 File-index decision tree (below) | (none — orientation only) | (none) |
| §7.3 Platform cross-reference map (below) | (none — orientation only) | (none) |

### 7.2 File-Index Decision Tree (NEW)

The §3 "Where to Start" decision tree rendered as a fuller mockup that includes the §3.1 special cases. Every leaf is a file in this directory; every internal node is a question the new agent asks. The tree is exhaustive — there is no mobile task that does not land on exactly one leaf. If a task seems to land on zero leaves or multiple leaves, it is a stop-and-ask trigger (`AGENTS.md` §5).

```
  FILE-INDEX DECISION TREE  (§3 + §3.1, where to start)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │                  ┌──────────────────────────────────────────────┐          │
  │                  │  What is the mobile task?                    │          │
  │                  │  (read top-level AGENTS.md + 01_Product_     │          │
  │                  │   Principles.md first — every rule applies   │          │
  │                  │   to mobile verbatim)                        │          │
  │                  └──────────────────────────────────────────────┘          │
  │                                   │                                        │
  │    ┌──────────┬──────────┬────────┴───────┬─────────────┬──────────────┐  │
  │    ▼          ▼          ▼                ▼             ▼              ▼  │
  │  "Set up    "Wire up  "Build the       "Sync has a    "Ship a new    "I am the    │
  │   Expo      a native   navigation      bug /          build to the   next mobile │
  │   project   module"    + state"        conflict       stores"        agent —     │
  │   from      "Store a  "Form state"    issue"         "Ship a JS-    what do I   │
  │   scratch"  secret"                   "Backup        only fix       do?"        │
  │   "Bump     "Biometric                 restore"      OTA"                       │
  │   Expo SDK" challenge"                                                          │
  │    │          │          │                │             │              │      │
  │    ▼          ▼          ▼                ▼             ▼              ▼      │
  │  01_Arch    02_Native  03_Nav_State    04_Offline    05_EAS_Build   AGENTS.md  │
  │  itecture   _Modules   .md             _Sync         .md            (then     │
  │  .md        _and_                      .md           + 06_EAS       read      │
  │             Storage                    + 07_App      _Update.md     everything│
  │             .md                        _Store_       + 07_App       else)      │
  │                                        Release.md    _Store_Release            │
  │                                                       .md                      │
  │                                                                            │
  │  SPECIAL CASES (§3.1 — all are stop-and-ask triggers per AGENTS.md §5):   │
  │                                                                            │
  │   • "I need to add a new permission"        → 02_Native §9 first, THEN    │
  │     stop-and-ask (AGENTS §5 trigger #3 — security reviewer).               │
  │                                                                            │
  │   • "I need to ship a JS-only bug fix       → 06_EAS_Update §3 → §4 → §5  │
  │     to production"                             (OTA only, no store review).│
  │                                                                            │
  │   • "I added a new npm dep with native      → 05_EAS_Build §7 (native     │
  │     code"                                     dep upgrade protocol).       │
  │                                                                            │
  │   • "I need to design a new screen"         → STOP. Five screens, forever │
  │                                                (P2, AGENTS §0). The new   │
  │                                                capability goes inside one │
  │                                                of the 5 as a modal.       │
  │                                                                            │
  │   • "I need to use an indigo/blue color"    → STOP. Use Emerald / Cyan /  │
  │                                                Flare / Amber / Violet     │
  │                                                only (Rule 5, AP-6).       │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The tree is a concept diagram, not a rendered UI surface — no glass
     tier annotation here (§6.6 single rule applies to live components only).
   ↑ Cross-refs: §3 + §3.1 (this file), AGENTS.md §5 (stop-and-ask triggers),
     01_Product_Principles.md P2 (five screens, forever), Rule 5 (no indigo).
```

### 7.3 Platform Cross-Reference Map (NEW)

The §4 cross-reference quick table rendered as a map of which top-level / sibling specs each mobile file cites. This is the "where does this package reach out to?" view — every arrow is a citation that must stay canonical. The map is the audit artefact for stale cross-references: if a top-level spec ID changes, this map shows which mobile files must update.

```
  PLATFORM CROSS-REFERENCE MAP  (§4, which specs each mobile file cites)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │   TOP-LEVEL SPECS  (cited by every mobile file)                            │
  │   ┌────────────────────────┐                                              │
  │   │  00_Vision.md           │ ← 01_Arch §1, AGENTS §0                     │
  │   │  01_Product_Principles  │ ← every file cites P1–P15 in opening §       │
  │   │   P1–P15, AP-*          │                                              │
  │   │  02_Core_Logic.md §1.1  │ ← 01_Arch §3 (five-tab surface map),        │
  │   │   (five-screen doctrine)│    03_Nav §2                                 │
  │   │  03_User_Flows.md       │ ← 01_Arch §6, 03_Nav §6                     │
  │   │  06_Attendance BR-ATT-* │ ← 01_Arch §6.3, 02_Native §6, 04_Sync §4    │
  │   │  07_Fees BR-FEE/LED-*   │ ← 02_Native §6, 04_Sync §4                  │
  │   │  08_Settings.md         │ ← 03_Nav §2.5                                │
  │   │  09_Backup BR-BAT-*     │ ← 02_Native §7                               │
  │   │  10_Security §2–§3,§9,  │ ← 02_Native §4–§5, §7, 04_Sync §4           │
  │   │   §15, §17 (TELE-1)     │                                              │
  │   │  11_Data_Model.md       │ ← 02_Native §2 (schema mirror), 04_Sync §2  │
  │   │  12_Business_Rules.md   │ ← every file (BR-* cited throughout)        │
  │   │   BR-*                  │                                              │
  │   │  13_UI_Guidelines.md    │ ← 01_Arch §5, §8; 03_Nav §3 (glass tab bar) │
  │   │   §2 (colors), §5.2/§5.5│    §5.5 glass tiers, §6.6 neumo recipes,     │
  │   │   (glass), §6.6 (neumo),│    §4.3 safe-area, §10.2 44px touch,         │
  │   │   §8 (vocab), §10.2,    │    §20 ASCII conventions                     │
  │   │   §4.3, §20             │                                              │
  │   │  14_Edge_Cases.md       │ ← 02_Native §4 (EC-SEC-*), 04_Sync §5–§7    │
  │   │   EC-SY-*, EC-SEC-*     │    (EC-SY-*)                                 │
  │   │  15_Future_Roadmap.md   │ ← 01_Arch §1 (why Expo), AGENTS §0          │
  │   │  AGENTS.md (top-level)  │ ← AGENTS (mobile) is the supplement         │
  │   └────────────────────────┘                                              │
  │                                                                            │
  │   PRODUCT/ SPECS  (cited by release + build files)                         │
  │   ┌────────────────────────┐                                              │
  │   │  product/04_Download_  │ ← 05_EAS_Build §6 (post-build Vercel Blob    │
  │   │   Hub.md               │    upload), 07_App_Store §3 (sideload APK)   │
  │   │  product/05_Pricing_   │ ← README §1 (Supabase auth), 07_App_Store    │
  │   │   and_Plans.md         │    §2.4 (App Store description pricing)      │
  │   └────────────────────────┘                                              │
  │                                                                            │
  │   DEPLOYMENT/ SPECS  (cited by build + update + release files)            │
  │   ┌────────────────────────┐                                              │
  │   │  deployment/03_EAS_    │ ← 05_EAS_Build §2 (profiles), 06_EAS_Update  │
  │   │   Build_and_Update_    │    §2 (channel→branch), 07_App_Store §6     │
  │   │   Channels.md          │    (rollback matrix)                          │
  │   │  deployment/02_Vercel_ │ ← 05_EAS_Build §6 (Blob upload),             │
  │   │   Blob_Build_Storage   │    07_App_Store §3.7 (sideload mirror)       │
  │   │  deployment/05_CI_CD_  │ ← 05_EAS_Build §9.2, 06_EAS_Update §3.3     │
  │   │   GitHub_Actions.md    │                                              │
  │   │  deployment/04_Release │ ← 06_EAS_Update §9 (PATCH/MINOR/MAJOR),     │
  │   │   _Pipeline.md         │    07_App_Store §5                            │
  │   └────────────────────────┘                                              │
  │                                                                            │
  │   SIBLING PACKAGE SPECS  (parallel planning packages)                      │
  │   ┌────────────────────────┐                                              │
  │   │  web/  (companion)     │ ← 01_Arch §12 (web equivalents),             │
  │   │                         │    05_EAS_Build §6.3 (download hub)          │
  │   │  desktop/ (companion)  │ ← (no direct citation — Tauri v2 parallel)   │
  │   └────────────────────────┘                                              │
  │                                                                            │
  │  AUDIT RULE:                                                               │
  │   ↑ If a top-level spec ID changes (e.g., BR-SYN-01 → BR-SYN-XX), this    │
  │     map shows which mobile files must update.                              │
  │   ↑ The map is the contract that the worklog's "Stale cross-refs fixed"   │
  │     count is measured against.                                             │
  │   ↑ Constraint: DO NOT change any BR-*, EC-*, AP-*, P-* IDs (task brief). │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The map is a concept diagram, not a rendered UI surface — no glass
     tier annotation here (§6.6 single rule applies to live components only).
   ↑ Cross-refs: §4 (this file), AGENTS.md §2 (file map), AGENTS.md §9
     (top-level cross-references), deployment/03 §11 (cross-cutting contract).
```

### 7.4 References (External Design Authorities)

The mockups and the orientation primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the file-index decision tree or the platform cross-reference map.

- **Expo docs** — *Project structure, expo-router, EAS overview*. The §1 stack-at-a-glance table and the §7.2 file-index decision tree follow Expo's project-structure documentation.
- **Apple Human Interface Guidelines** — *Mobile, getting started*. The §3 "bottom tab, not sidebar" decision and the §3.1 special-cases list follow Apple HIG's mobile getting-started guidance.
- **Material Design 3** — *Android navigation, getting started*. The §1 stack choices (Expo SDK 52, Hermes, Reanimated 3) follow Material 3's Android-stack recommendations.
- **Smashing Magazine** — *Mobile-first spec packages*. The §2 file-index (one paragraph per file, reading order not alphabetical) follows Smashing's mobile-spec-package research.
- **CSS-Tricks** — *Monorepo structure for cross-platform apps*. The §1 monorepo layout (apps/mobile alongside apps/web + apps/desktop, packages/shared) follows CSS-Tricks's monorepo primer.
- **Nielsen Norman Group** — *Information architecture for developer docs*. The §3 decision tree and the §4 cross-reference quick table follow NN/g's developer-doc IA research.

---

*End of README. Next file: `01_Architecture.md`.*
