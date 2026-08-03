# AGENTS.md — Mobile Agent Directive

> Read this file before any other file in `Buddysaradhi_Planning/mobile/`. It is the operating manual for any AI coding agent or human engineer working on the Buddysaradhi mobile app. The top-level `../AGENTS.md` governs the entire monorepo; this file is the mobile-specific supplement. When the two disagree, the top-level file wins — unless the top-level file is wrong, in which case you amend it first, then this file, then the code.

---

## 0. Prime Directive

> **The Buddysaradhi mobile app has exactly five bottom-tab routes: Dashboard, Students, Attendance, Fees & Payments, Settings. A sixth tab is a build error. A nested stack deeper than 2 levels (tab + modal) is a stop-and-ask trigger. There are no exceptions in v1.**

The mobile app is **not** a separate product from the web app. It is the same five-screen doctrine (`P2`), the same ledger (`P4`), the same offline-first contract (`P5`), the same bioluminescent palette (`AP-6`), expressed on a smaller surface. Every principle in `../01_Product_Principles.md` applies verbatim.

### 0.0 Platform Boundary & Sequencing — You Are the Mobile Agent

> **Read `../16_Platform_Delivery_Sequence.md` before any cross-platform thought.** It is the process keystone: exactly one platform `In-Flight` at a time, hard Production Gates between them.

You are the **Mobile** agent (platform P2). The boundary rules:

- **Mobile is LOCKED until the worklog carries `Task ID: WEB-PROD-GATE … State: COMPLETED … Next platform unlocked: MOBILE.`** Until that line exists, you may NOT create `apps/mobile/` or edit any mobile spec. The web agent owns web; the web contract (`contracts/v1.0.0`) must be frozen and proven before mobile begins.
- **Once unlocked, you may edit:** `apps/mobile/`, `buddysaradhi_Planning/mobile/*.md`, append-only `worklog.md`, and `packages/*` **only via an RFC**.
- **You may NOT create or edit:** `apps/web/`, `apps/desktop/`, `src-tauri/`, `buddysaradhi_Planning/web/*.md`, `buddysaradhi_Planning/desktop/*.md`. A mobile bug found in web code is a `BUG-WEB-*` issue for the web agent, not a mobile-agent edit.
- **Pin to the same contract tag web used** (`contracts/v1.0.0`). A newer contract needs an RFC (§7.2 of `16_*.md`), not a unilateral bump.
- **All network access goes through the same API gateway** (`../17_API_Gateway_System.md`) via the typed SDK — no hardcoded endpoints, no mobile-specific fetch wrappers that drift from web. Mobile inherits the web contract; it does not invent one.
- **Check the status block** at the top of `/home/z/my-project/worklog.md` first. If `In-Flight` is not `MOBILE`, STOP and run the close-out (`../AGENTS.md` §9.2.2).

Web to production first; then mobile, to production; then desktop. No parallelism.

### 0.1 What "Agent-Ready" Means for This Package

The 9 files in this directory are written so that a competent React Native engineer (human or AI) can implement the mobile app end-to-end without asking follow-up questions. Each file:

- Cites the relevant top-level spec sections by file name + ID (`BR-*`, `EC-*`, `P*`, `AP-*`).
- Provides TypeScript / Expo SDK 52 / React Native 0.76 code examples that are valid as written.
- States the invariants that must hold (e.g., "5 tabs only", "integer paise", "no indigo/blue").
- Lists the stop-and-ask triggers — situations where the engineer must pause and escalate.

### 0.2 Reading Order for a New Mobile Agent

1. **`../AGENTS.md`** (top-level) — the operating manual for the whole monorepo.
2. **`../00_Vision.md`** — the elevator pitch, personas, five-screen doctrine.
3. **`../01_Product_Principles.md`** — the constitution. P1–P15 + AP-*.
4. **This file** (`mobile/AGENTS.md`) — the mobile-specific supplement.
5. **`mobile/README.md`** — the orientation index for this package.
6. **`mobile/01_Architecture.md`** — the high-level architecture.
7. **The file relevant to your task** (see §2 below).
8. **`../02_Core_Logic.md`** — the seven hidden engines.
9. **`../11_Data_Model.md`** and **`../12_Business_Rules.md`** — for any data or money work.
10. **`../13_UI_Guidelines.md`** — for any UI work.
11. **`../14_Edge_Cases.md`** — before declaring a feature done.

---

## 1. Where to Start — Scaffold Checklist

The mobile app is **not yet scaffolded** in the monorepo. The first mobile agent's job is to scaffold `apps/mobile/` from this package. The checklist:

### 1.1 Scaffold

```bash
# From repo root
cd apps
npx create-expo-app@latest mobile --template default
cd mobile
```

### 1.2 Install Dependencies

```bash
# Core Expo
npx expo install expo-router expo-sqlite expo-secure-store expo-local-authentication \
  expo-notifications expo-haptics expo-file-system expo-sharing expo-blur \
  expo-constants expo-application expo-updates expo-linking expo-keep-awake \
  expo-background-fetch expo-task-manager expo-document-picker

# Navigation + state
npx expo install @react-navigation/native react-native-screens react-native-safe-area-context
bun add @tanstack/react-query zustand react-hook-form @hookform/resolvers zod

# Styling + animation
bun add nativewind react-native-reanimated react-native-gesture-handler @shopify/flash-list
bun add -D tailwindcss@^3.4 prettier-plugin-tailwindcss

# Storage + crypto
bun add @libsql/client react-native-mmkv react-native-mmkv-storage react-native-argon2

# Shared packages (from monorepo)
bun add @buddysaradhi/shared @buddysaradhi/core @buddysaradhi/ui
```

### 1.3 Configure `app.config.ts`

Read `01_Architecture.md` §1.3 for the version pins, §4.1 for the route groups, §5 for OLED dark mode, §6 for the native module inventory. Configure the file.

### 1.4 Configure `tailwind.config.js`

Read `01_Architecture.md` §8. Mirror the web's `tailwind.config.shared.js` from `packages/ui/`. Add the mobile-specific overrides (`bg-root: '#000000'`, etc.).

### 1.5 Mirror the Web's Visual Patterns

Before writing any custom component, read the web's `src/components/buddysaradhi/*.tsx` for visual patterns. The mobile app **mirrors** these patterns via NativeWind. The `GlassPanel`, `NeumoToggle`, `Chip`, `BarChart` primitives should look and feel identical to their web counterparts. The only differences are:

- `bg-black` instead of `bg-cosmic` (OLED, `01_Architecture.md` §5)
- `BlurView` instead of `backdrop-filter: blur()` (§8.2)
- Reanimated instead of Framer Motion (§7)
- Haptics instead of (no web equivalent)

### 1.6 Wire Up the Sync Engine

Read `02_Native_Modules_and_Storage.md` §2 (SQLite), §3 (libSQL), and `04_Offline_Sync_and_Conflict_Resolution.md` (the full sync protocol). Implement the local-first write path, the outbox drain, the conflict resolver, and the sync indicator.

### 1.7 Verify

```bash
bun run lint
bun run typecheck
eas build --platform ios --profile development
eas build --platform android --profile development
```

All four must pass before the scaffold is "done."

---

## 2. File Map — Which File Governs Which `app/` Path

Every file in this package maps to specific paths in the eventual `apps/mobile/` codebase. Use this table to find the spec for the code you're touching.

| Spec file in this package | Governs `apps/mobile/` paths |
|---|---|
| `README.md` | (orientation only — no code paths) |
| `01_Architecture.md` | `app.config.ts`, `package.json`, `tsconfig.json`, `tailwind.config.js`, `app/_layout.tsx` (root), high-level `app/` structure |
| `02_Native_Modules_and_Storage.md` | `src/lib/db/*`, `src/lib/sync/*` (storage primitives only), `src/lib/crypto/*`, `src/lib/auth/*`, `src/lib/haptics.ts`, `src/hooks/useBiometric*`, `app.config.ts` (permissions) |
| `03_Navigation_and_State.md` | `app/(auth)/*`, `app/(tabs)/_layout.tsx`, `app/(modal)/*`, `src/components/TabBar.tsx`, `src/components/Header.tsx`, `src/store/*`, `src/lib/queryClient.ts` |
| `04_Offline_Sync_and_Conflict_Resolution.md` | `src/lib/sync/push.ts`, `src/lib/sync/pull.ts`, `src/lib/sync/conflict.ts`, `src/lib/sync/scheduler.ts`, `migrations/*` (shared with web) |
| `05_EAS_Build.md` | `eas.json`, `scripts/post-build-upload.js`, `.github/workflows/mobile-build.yml`, `credentials/*` (gitignored) |
| `06_EAS_Update.md` | `src/lib/updates.ts`, `.github/workflows/mobile-ota.yml`, `app.config.ts` `updates` block |
| `07_App_Store_Release.md` | App Store Connect metadata (external), Play Console metadata (external), `Buddysaradhi_Planning/postmortems/*`, `Buddysaradhi_Planning/release-notes/*` |
| `AGENTS.md` (this file) | (process only — no code paths) |

If a code path is not listed here, it's either (a) shared with web (governed by `../` specs), or (b) not yet specced (write the spec first per `../AGENTS.md` §0.1).

---

## 3. Code Style

The mobile app follows the same TypeScript discipline as the web app (`../AGENTS.md` §6.1), with mobile-specific additions.

### 3.1 TypeScript

- **Strict mode** (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- **No `any`.** Use `unknown` and narrow with a type guard or Zod parse.
- **No `as` casts** unless paired with a `// SAFETY:` comment explaining the invariant.
- **Functional React.** No class components. Hooks for state.
- **Zod for all input validation.** Every form submission, every deep link param, every document-picker file. Types are inferred from Zod, never hand-written.

### 3.2 Integer Paise

Money is integer paise, never float (Rule 6, `BR-M-01`). The mobile app uses `number` (safe up to 2^53) for paise because SQLite's `INTEGER` is 64-bit but JS `number` is 53-bit safe. For amounts > ₹90,071,992,547,409.92 (90 trillion rupees — not a real concern for a tutor app), we'd need `bigint`. We don't.

```ts
// ✅ Good
const balancePaise: number = 470000; // ₹4,700.00
const formatted = formatINR(balancePaise); // "₹4,700.00"

// ❌ Bad — float
const balance: number = 4700.00;

// ❌ Bad — string concatenation
const display = `₹${balance}`; // use formatINR instead
```

### 3.3 Zod Before DB

Every mutation runs through a Zod schema **before** touching SQLite. The schema lives in `@buddysaradhi/shared`, shared with web.

```ts
import { PaymentInputSchema, PaymentInput } from '@buddysaradhi/shared';

async function postPayment(input: unknown): Promise<Result<Receipt, ZodError | DBError>> {
  const parsed = PaymentInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error };
  // ... write to SQLite + sync_outbox ...
}
```

### 3.4 No `console.log`

Use the typed logger (`log.info`, `log.warn`, `log.error`) which routes to local `audit_log`. `console.log` in prod is a P1 lint violation (`../AGENTS.md` §2 Rule 9).

```ts
// ✅ Good
import { log } from '@/lib/logger';
log.info('payment_recorded', { studentId, amountPaise, receiptNo });

// ❌ Bad
console.log('payment recorded', studentId, amountPaise);
```

### 3.5 Reanimated Worklets

Every Reanimated worklet must be marked `'worklet'`. The lint rule `react-native-reanimated/worklet` enforces this.

```ts
// ✅ Good
const animatedStyle = useAnimatedStyle(() => {
  'worklet';
  return { transform: [{ translateX: offset.value }] };
});

// ❌ Bad — no 'worklet' marker
const animatedStyle = useAnimatedStyle(() => {
  return { transform: [{ translateX: offset.value }] };
});
```

A worklet that closes over a JS-side variable will throw at runtime. Worklets may only close over `SharedValue`s, primitives, and pure functions.

### 3.6 No `Alert.alert()`

`Alert.alert()` is the default RN alert API. It is **banned** in Buddysaradhi mobile — it's not tactile, doesn't match the design language, and breaks the glass aesthetic. Use a glass toast with haptic instead:

```tsx
// ✅ Good
import { Toast } from '@/components/Toast';
import { hapticNotify } from '@/lib/haptics';

async function onError(msg: string) {
  await hapticNotify('error');
  Toast.show({ message: msg, accent: 'flare' });
}

// ❌ Bad
Alert.alert('Error', msg);
```

### 3.7 FlashList, Not FlatList

`FlatList` is banned for lists > 20 rows (`../AGENTS.md` §3.2). Use `@shopify/flash-list`:

```tsx
// ✅ Good
import { FlashList } from '@shopify/flash-list';

<FlashList
  data={students}
  renderItem={({ item }) => <StudentRow student={item} />}
  estimatedItemSize={72}
  keyExtractor={(item) => item.id}
/>

// ❌ Bad
<FlatList data={students} renderItem={...} />
```

### 3.8 Touch Targets ≥ 44×44px

Every interactive element must be ≥ 44×44px (Rule 10). NativeWind's `min-h-11 min-w-11` (44px) enforces this:

```tsx
<Pressable className="min-h-11 min-w-11 items-center justify-center" onPress={...}>
  <Icon size={22} color={...} />
</Pressable>
```

### 3.9 No Indigo/Blue

The lint rule `no-indigo-accent` rejects any PR introducing an indigo or blue accent. Use the bioluminescent palette only:

| Token | Hex | Use |
|---|---|---|
| Emerald | `#00FF9D` | Paid / present / active / primary CTA |
| Cyan | `#00F0FF` | Info / links / focus rings / active nav |
| Amber | `#FFB300` | Partial / late / upcoming-due / pending |
| Flare | `#FF5E00` | Overdue / void / destructive / error |
| Violet | `#B388FF` | Secondary highlights / archived / inactive |

If you find yourself reaching for `bg-blue-500`, stop. Use `bg-accent-cyan` or `bg-accent-emerald` depending on the semantic.

---

## 4. Testing Protocol

The mobile app's testing protocol mirrors the web's (`../AGENTS.md` §7), with mobile additions.

### 4.1 Lint + Typecheck

```bash
bun run lint
bun run typecheck
```

Both must pass (0 errors, 0 warnings) before any commit.

### 4.2 Shared Schema Tests

The Zod schemas in `@buddysaradhi/shared` have unit tests. Run them:

```bash
cd packages/shared && bun run test:unit
```

These tests verify the schemas accept valid input and reject invalid input. They are the single source of truth for validation behavior across web and mobile.

### 4.3 In-Memory SQLite Integration Tests

The sync engine and ledger engine have integration tests against in-memory SQLite (`:memory:`). Never mock the DB in a ledger test (`../AGENTS.md` §7.3):

```ts
import { openDatabaseAsync } from 'expo-sqlite';

// ✅ Good — real in-memory DB
const db = await openDatabaseAsync(':memory:');
await runMigrations(db);
await postLedgerEntry(db, entry);
expect(await getBalance(db, studentId)).toBe(470000);

// ❌ Bad — mocked DB proves nothing
const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
```

### 4.4 EAS Development Build Smoke Test

After every meaningful change, run a development build on both platforms:

```bash
eas build --platform ios --profile development
eas build --platform android --profile development
```

Install on a physical device (or simulator for iOS Simulator builds). Smoke test:

- App launches, splash gate clears, lands on Dashboard
- All 5 tabs render
- Record payment → receipt generated → ledger hash chain intact
- Mark attendance → lock → biometric challenge → audit log written
- Background the app → return → sync drains outbox
- Toggle reduce-motion → animations disable

### 4.5 Agent Browser (Web Parity)

The mobile app does not run in a browser. For UI smoke testing, use the **web app** as a parity reference — the same five screens, the same data, the same flows. If a flow works on web but not on mobile, the mobile implementation has a bug (not the web one).

---

## 5. Stop-and-Ask Triggers

The following situations require a pause and human review **before** the PR is opened. An autonomous mobile agent MUST NOT proceed unilaterally.

| # | Trigger | Why sensitive | Who reviews |
|---|---|---|---|
| 1 | Adding a 6th bottom tab or a new top-level route | Violates P2; requires principle amendment | Orchestrator + principle review |
| 2 | Adding a new native module (any package with native code) | Native code cannot be OTA-shipped; requires store resubmit; security surface | 2 reviewers incl. security owner |
| 3 | Adding a new permission (camera, location, contacts) | Privacy surface; review rejection risk | Security reviewer |
| 4 | Changing the sync conflict resolution strategy | Data integrity; silent data loss risk | 2 reviewers incl. sync-engine owner |
| 5 | Any change to the crypto envelope (backup, PIN hash, Turso JWT storage) | A bug leaks every backup or every JWT | 2 reviewers incl. security owner |
| 6 | Using an indigo or blue color as a primary accent | Violates Rule 5; lint will reject, but escalate to understand why the engineer reached for it | Design reviewer |
| 7 | Any PR that touches > 500 lines | Large PRs hide bugs | 2 reviewers + flag in PR description |
| 8 | Editing a merged SQL migration | Forward-only migrations; editing history corrupts every existing DB | Orchestrator sign-off |
| 9 | Bumping Expo SDK or React Native version | Native upgrade; requires full store resubmit; potential breaking changes | 2 reviewers incl. release engineer |
| 10 | Adding any telemetry/analytics SDK (Sentry, Mixpanel, PostHog, Amplitude, GA) | Violates Rule 3; `TELE-1` | Security reviewer + orchestrator |
| 11 | Ejecting from managed workflow (`npx expo prebuild` and editing native code) | One-way door; we own the native projects thereafter | 2 reviewers incl. release engineer |
| 12 | Modifying the ledger schema or `packages/core` posting logic | Ledger is the financial spine | 2 reviewers incl. ledger-crypto owner |

### 5.1 What "Stop and Ask" Looks Like

1. Stop coding. Commit what you have with `chore(wip): <what> — pending human review`.
2. Open a draft PR with the `## Spec ref` and `## Risk` blocks filled in, even if incomplete.
3. In the worklog, note: `BLOCKED on human review: <trigger #>`.
4. Return control to the orchestrator with a clear request.

---

## 6. Glossary

| Term | Definition |
|---|---|
| **Expo** | A framework and platform for building React Native apps. Managed workflow means Expo handles native iOS/Android build configuration; we write only TypeScript. |
| **EAS** | Expo Application Services. Cloud services for building (`EAS Build`), updating (`EAS Update`), and submitting (`EAS Submit`) Expo apps. |
| **expo-router** | Expo's file-based routing library for React Native. Mirrors Next.js App Router conventions. Files in `app/` become routes; `_layout.tsx` files define layouts. |
| **Reanimated** | React Native animation library (`react-native-reanimated`). Animations run on the UI thread via worklets; the JS thread is never blocked. |
| **Hermes** | Facebook's JS engine for React Native. Default on Expo SDK 52. Compiles JS to bytecode ahead of time, reducing cold-start and memory usage. |
| **TurboModule** | React Native's new native module architecture (replacing the legacy bridge). All Expo modules are TurboModules. |
| **MMKV** | `react-native-mmkv`. A key-value storage library that uses memory-mapped files via C++. ~30x faster than AsyncStorage. |
| **OTA (Over-The-Air)** | Shipping a JS-only update to the app without going through the App Store / Play Store review process. |
| **CodePush** | Microsoft's OTA service (now deprecated for React Native). Replaced by EAS Update. |
| **TestFlight** | Apple's pre-release testing platform. Internal testers (up to 100) + external testers (up to 10,000). |
| **AAB** | Android App Bundle. The Play Store's upload format. Google Play splits the AAB into per-ABI APKs for distribution. |
| **APK** | Android Package. The sideloadable Android app format. Used for preview builds; not for Play Store production. |
| **IPA** | iOS App Store Package. The iOS app archive format, signed with a distribution certificate. Uploaded to App Store Connect. |
| **EAS Build profile** | A named build configuration in `eas.json` (`development` / `preview` / `production`). Each profile sets distribution, build type, env vars, channel. |
| **EAS Update channel** | A named distribution target for OTA updates (`production` / `staging` / `development`). Each channel maps to a Git branch. |
| **Biometric** | FaceID (iOS) or fingerprint/face biometric (Android). Used for app unlock and sensitive-action challenges per `BR-SEC-04`. |
| **Scoped JWT** | A Turso database token scoped to a single per-user DB. Stored in `expo-secure-store`, biometric-protected. |
| **LWW** | Last-Writer-Wins. The conflict resolution rule for non-ledger rows (`BR-SYN-03`). The row with the newer `updated_at` wins. |
| **Append-only** | A table that accepts `INSERT` only; `UPDATE`/`DELETE` are blocked by triggers. The `ledger_entries`, `audit_log`, and `sync_outbox.payload` tables are append-only. |
| **Outbox** | The `sync_outbox` table. Every mutation appends a row in the same transaction; the sync engine drains the outbox to Turso on reconnect. |
| **Schema drift** | When the app's local schema version is older than the server's. Sync pauses; the user is prompted to update (`EC-SY-08`). |
| **Glass tier** | One of three translucent surface levels: `glass` (0.06 on mobile), `glass-strong` (0.08), `glass-faint` (0.02). Mirrors web (`13_UI_Guidelines.md` §5.2). |
| **NativeWind** | Tailwind CSS for React Native. Compiles Tailwind classes to StyleSheet objects at build time. |
| **Splash gate** | The root layout's gate that prevents navigation until fonts, MMKV, auth, and SQLite are ready. |
| **Sync chip** | The header indicator showing sync state (synced / syncing / pending / failed). |

---

## 7. What "Done" Means for a Mobile Task

A mobile task is done when **all** of the following are true:

1. **Lint + typecheck pass.** `bun run lint` and `bun run typecheck` (0 errors, 0 warnings).
2. **Shared schema tests pass.** `cd packages/shared && bun run test:unit` (if you touched a Zod schema).
3. **EAS development build succeeds** on both iOS and Android.
4. **Smoke test on device (or simulator)** passes for the affected flow.
5. **The relevant screen renders** without runtime errors.
6. **The golden-path interaction works** end-to-end (e.g., record payment → receipt → ledger hash chain).
7. **The sync outbox row is appended** in the same transaction as the mutation (`BR-SYN-01`).
8. **The audit log row is appended** for every sensitive action (`BR-SEC-08`).
9. **Haptics fire** on the relevant `BR-*` state transitions (P11).
10. **Touch targets ≥ 44×44px** for every new interactive element (Rule 10).
11. **No indigo/blue accents** introduced (Rule 5).
12. **No new telemetry/analytics SDK** introduced (Rule 3).
13. **No new native module or permission** added without stop-and-ask sign-off (§5).
14. **`worklog.md` is updated** with a `---`-delimited entry **whose `Stage Summary` declares `State: COMPLETED | PAUSED | BLOCKED`** (top-level `AGENTS.md` §9.2.2).
15. **The PR cites its spec section** (`## Spec ref` block, per `../AGENTS.md` §5.3).
16. **Every stop-and-ask trigger** that fired has a recorded human review.
17. **If the task was resumed from a prior `PAUSED` entry**, the final `COMPLETED` entry supersedes the paused entry and references its Task ID (top-level `AGENTS.md` §9.2.4).

> **"It compiles" is never sufficient.** A green EAS Build is the floor, not the ceiling. And "it's mostly done" is never `completed` — it is `paused` with a resume point (top-level `AGENTS.md` §9.2.3).

### 7.1 Task-to-Task Transition Protocol (extends top-level `AGENTS.md` §9.2)

Mobile agents frequently shift between native-module work, screen work, and EAS build/release work. Every shift runs the top-level §9.2.2 Close-Out Checklist. **Mobile-specific shift triggers** (in addition to the top-level §9.2.5 table):
- A native build fails mid-screen-task → close-out the screen task as `PAUSED`, fix the build break, resume.
- A new permission/native-module request surfaces → close-out current task as `BLOCKED`, run the §5 stop-and-ask flow, then resume or pivot.
- EAS build channel mismatch detected → close-out the feature task as `PAUSED`, fix the channel/branch mapping (`deployment/03_EAS_Build_and_Update_Channels.md`), resume.
- A device-only crash (not reproducible in simulator) → close-out as `BLOCKED` with the device logs in the worklog; do not mark `completed` on a simulator-only pass.

The `no-orphaned-task.test.ts` lint (§9.2.6) runs in the `webDevReview` cron and fails if a mobile todo is left `in_progress` with no worklog entry in the last 30 minutes.

---

## 8. Common Anti-Patterns for Mobile Agents

| # | Anti-pattern | Correction |
|---|---|---|
| 1 | Adding a 6th bottom tab "just for now" | Ship the capability inside one of the 5 tabs as a modal or sub-screen; open an RFC if a 6th is truly needed |
| 2 | Using `FlatList` for > 20 rows | Use `FlashList` |
| 3 | Using `Alert.alert()` for errors or confirms | Use a glass toast + haptic |
| 4 | Hardcoding an indigo color | Use `bg-accent-emerald` / `bg-accent-cyan` / etc. from the bioluminescent palette |
| 5 | Using `float` for money | Use integer paise; format with `formatINR` |
| 6 | Skipping the `sync_outbox` write on a mutation | Append the outbox row in the same transaction as the mutation (`BR-SYN-01`) |
| 7 | Skipping the `audit_log` write on a sensitive action | Append the audit row in the same transaction (`BR-SEC-08`) |
| 8 | Skipping haptics on a `BR-*` state transition | Add the haptic per `02_Native_Modules_and_Storage.md` §6 |
| 9 | Using `console.log` in prod code | Use the typed logger |
| 10 | Mocking the DB in a ledger test | Use in-memory SQLite + real migrations |
| 11 | Closing a Reanimated worklet over a JS variable | Use `SharedValue` or pass the value via `runOnJS` |
| 12 | Blocking the main thread with a sync call | All sync runs in background; UI reads local SQLite |
| 13 | Storing money or business data in Zustand | Zustand is UI-only; business data lives in SQLite via TanStack Query |
| 14 | Storing the Turso JWT in MMKV or AsyncStorage | Use `expo-secure-store` only |
| 15 | Adding a permission without updating the permissions matrix | Update `02_Native_Modules_and_Storage.md` §9 first; this is a stop-and-ask trigger |
| 16 | Shipping a native change via EAS Update | OTA cannot ship native code; ship a full EAS Build + store resubmit |
| 17 | Adding a 3rd-level modal (modal-from-modal) | Close the first modal, then open the second; or redesign |
| 18 | Using `router.push` between tabs | Use `router.replace` or `navigation.navigate`; tabs are not a stack |
| 19 | Reusing a voided receipt number | `next_receipt_seq` never decrements (`BR-RC-01`) |
| 20 | Editing a merged SQL migration | Add a new numbered migration; never edit history |
| 21 | Bumping a native dep without a stop-and-ask | Native dep upgrades are stop-and-ask trigger #2 |
| 22 | Disabling Hermes | Hermes is the default and required for performance budgets |
| 23 | Using `setTimeout` for sync scheduling | Use `expo-background-fetch` (iOS) + `expo-task-manager` (Android) |
| 24 | Caching the Turso JWT in JS memory > 60s | Re-read from SecureStore; cache is wiped on background |
| 25 | Skipping `prefers-reduced-motion` on a new animation | Honour `AccessibilityInfo.isReduceMotionEnabled()` |

---

## 9. Cross-References

- **Top-level operating manual**: `../AGENTS.md`
- **Top-level vision**: `../00_Vision.md`
- **Top-level principles**: `../01_Product_Principles.md`
- **Top-level core logic**: `../02_Core_Logic.md`
- **Top-level user flows**: `../03_User_Flows.md`
- **Top-level data model**: `../11_Data_Model.md`
- **Top-level business rules**: `../12_Business_Rules.md`
- **Top-level UI guidelines**: `../13_UI_Guidelines.md`
- **Top-level edge cases**: `../14_Edge_Cases.md`
- **Top-level security**: `../10_Security.md`
- **Top-level backup spec**: `../09_Backup_and_Import_Export.md`
- **Top-level roadmap**: `../15_Future_Roadmap.md`
- **Mobile architecture**: `01_Architecture.md`
- **Mobile native modules and storage**: `02_Native_Modules_and_Storage.md`
- **Mobile navigation and state**: `03_Navigation_and_State.md`
- **Mobile offline sync**: `04_Offline_Sync_and_Conflict_Resolution.md`
- **Mobile EAS Build**: `05_EAS_Build.md`
- **Mobile EAS Update**: `06_EAS_Update.md`
- **Mobile App Store release**: `07_App_Store_Release.md`
- **Commercial download hub (APK + TestFlight links)**: `../product/04_Download_Hub.md` — the marketing surface that surfaces the mobile APK sideload mirror and the TestFlight invite link alongside the other platform installers
- **Commercial pricing (mobile inherits the same tier as web)**: `../product/05_Pricing_and_Plans.md` — "Free for everyone, for now" model: a single public Free tier (₹0/mo for every tutor, every feature, no card required, free while our backend infra stays free); Pro ₹299/mo and Institute ₹999/mo are internal-only future tiers in Appendix A that launch on the §1.6 trigger; the 250-student number is internal soft guidance — no paywall, no waitlist; the mobile app authenticates against the same Supabase auth JWT, so tier is account-scoped, not device-scoped
- **Cross-cutting EAS choreography (channel + branch strategy)**: `../deployment/03_EAS_Build_and_Update_Channels.md` — the single source of truth for the three-channel model and the `eas.json` profile contract; `mobile/05_EAS_Build.md` and `mobile/06_EAS_Update.md` are the mobile-specific implementations of this file
- **Vercel Blob build storage (APK mirror target)**: `../deployment/02_Vercel_Blob_Build_Storage.md` — the post-build hook in `05_EAS_Build.md` §6 uploads to this Blob bucket
- **CI/CD GitHub Actions (EAS_TOKEN secret, build + OTA workflows)**: `../deployment/05_CI_CD_GitHub_Actions.md`

---

## 10. Final Note

The Buddysaradhi mobile app is a livelihood tool, not a toy (`../AGENTS.md` §1.3). A tutor's month-end fees depend on this ledger being correct. A tutor's receipt numbering must never collide. A tutor's backup must restore on the day their phone is stolen. Every shortcut you take — a float for money, a skipped `sync_outbox` write, a silent `catch {}`, an indigo accent "because it looks nice" — is a shortcut paid for, eventually, by a tutor who cannot afford it.

When you are tempted to skip a step, ask: *would I ship this to the maths teacher in Nagpur who has 40 students, three batches, and one laptop?* If the answer is "no," do not ship it.

Build the five screens. Wire the seven engines. Keep the ledger append-only. Keep the network off the critical path. Keep the bioluminescent palette. Ship.

---

## 11. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (60–80 for flowcharts, 80–100 for decision trees). The two mockups below visualise the *agent-handoff primitives* — the reading-order flowchart (§0.2) and the stop-and-ask decision tree (§5) — that a new mobile agent reads first to internalise the discipline this package enforces.

### 11.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **agent-handoff layer**, not the live-screen layer. The mockups below are *process flowcharts* (reading-order diagrams, stop-and-ask decision trees) — they are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every spec describes its content with a mockup), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-screen components that `03_Navigation_and_State.md` specifies (the tab bar, modal sheets, sync drawer); this file's job is to feed the next agent the reading order and the stop-and-ask triggers they consume to navigate the package without violating P2, the integer-paise rule, or the no-telemetry rule.

| Handoff artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §0.2 Reading order | (none — process only) | (none) |
| §1 Scaffold checklist | (none — process only) | (none) |
| §2 File map | (none — process only) | (none) |
| §5 Stop-and-ask triggers | (none — process only) | (none) |
| §7 "Done" checklist | (none — process only) | (none) |
| §8 Anti-patterns | (none — process only) | (none) |
| §11.2 Reading-order flowchart (below) | (none — process only) | (none) |
| §11.3 Stop-and-ask decision tree (below) | (none — process only) | (none) |

### 11.2 Reading-Order Flowchart (NEW)

The §0.2 reading-order list rendered as a flowchart that shows the dependency chain — each file builds on the one before it, and skipping ahead is a defect. The flowchart is the contract that prevents an agent from jumping straight to `05_EAS_Build.md` without first reading `01_Architecture.md` (which would miss the OLED-dark-mode choice, the five-tab doctrine, and the native-module inventory that the build profiles compile).

```
  READING-ORDER FLOWCHART  (§0.2, the 11-step reading order)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │   ┌─────────────────────┐                                                  │
  │   │  1. ../AGENTS.md     │   ← top-level operating manual for monorepo   │
  │   │     (top-level)      │      (RULES 1–10 apply verbatim to mobile)     │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │  2. ../00_Vision.md  │   ← elevator pitch, personas, five-screen      │
  │   │                      │      doctrine (Riya, Kabir, Ananya)            │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │  3. ../01_Product_   │   ← the constitution. P1–P15 + AP-*.           │
  │   │     Principles.md    │      Every rule applies verbatim to mobile.    │
  │   │                      │      ↑ P1 (tutor is user), P2 (5 screens),     │
  │   │                      │        P4 (append-only ledger), P5 (offline-   │
  │   │                      │        first), P10 (backups yours), P11        │
  │   │                      │        (security tactile), P12 (minutes/day),  │
  │   │                      │        P15 (honest progress), AP-6 (palette),  │
  │   │                      │        AP-11 (sequences), AP-17 (int paise)    │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │  4. mobile/AGENTS.md │   ← THIS FILE. The mobile-specific supplement. │
  │   │     (this file)      │      Read after top-level AGENTS, before any   │
  │   │                      │      mobile/ substantive file.                 │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │  5. mobile/README.md │   ← orientation index. Stack-at-a-glance, file │
  │   │                      │      map, decision tree, cross-ref table.      │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │  6. mobile/01_       │   ← high-level architecture. Managed workflow, │
  │   │     Architecture.md  │      route groups, OLED dark mode, module      │
  │   │                      │      inventory, bundle budgets.                │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │  7. <task-specific   │   ← THE FILE RELEVANT TO YOUR TASK.            │
  │   │     file>            │      Use §3 decision tree (README) to pick.    │
  │   │     (02..07)         │      ↑ 02_Native (storage), 03_Nav (state),    │
  │   │                      │        04_Sync (outbox/LWW), 05_EAS_Build,     │
  │   │                      │        06_EAS_Update, 07_App_Store_Release     │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │  8. ../02_Core_      │   ← the seven hidden engines. Read for any     │
  │   │     Logic.md         │      engine-touching work (search, reminders,  │
  │   │                      │      ledger, reports, notifications, sync,     │
  │   │                      │      security).                                │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │  9. ../11_Data_      │   ← for any data or money work. Schema,        │
  │   │     Model.md +       │      triggers, INTEGER paise (BR-M-01).        │
  │   │     ../12_Business_  │      ↑ BR-* cited throughout; every haptic,    │
  │   │     Rules.md         │        sync rule, conflict rule.               │
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │ 10. ../13_UI_        │   ← for any UI work. Glass tiers (§5.5),       │
  │   │     Guidelines.md    │      neumo recipes (§6.6), 44px touch (§10.2), │
  │   │                      │      safe-area (§4.3), ASCII conventions (§20).│
  │   └──────────┬──────────┘                                                  │
  │              ▼                                                             │
  │   ┌─────────────────────┐                                                  │
  │   │ 11. ../14_Edge_      │   ← BEFORE declaring a feature done. EC-SY-*   │
  │   │     Cases.md         │      (sync edge cases), EC-SEC-* (security),   │
  │   │                      │      EC-F-*, EC-A-*, EC-AU-*.                  │
  │   └─────────────────────┘                                                  │
  │                                                                            │
  │  RULE:                                                                    │
  │   ↑ Skipping ahead (e.g., jumping to 05_EAS_Build without 01_Architecture)│
  │     is a defect — you'll miss the OLED-dark-mode choice, the five-tab     │
  │     doctrine, and the native-module inventory the build profiles compile. │
  │   ↑ The flowchart is the contract that the §7 "Done" checklist enforces.  │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The flowchart is a process diagram, not a rendered UI surface — no
     glass tier annotation here (§6.6 single rule applies to live components
     only, per §11.1 above).
   ↑ Cross-refs: §0.2 (this file), README §3 (decision tree to pick step 7),
     13_UI_Guidelines.md §20 (ASCII conventions this mockup follows).
```

### 11.3 Stop-and-Ask Decision Tree (NEW)

The §5 stop-and-ask trigger table rendered as a decision tree. Every trigger is a fork where the agent MUST pause and escalate — proceeding unilaterally is a defect. The 12 triggers (numbered in §5's table) cover the six classes of sensitivity: principle violations (P2), native surface (modules, permissions, SDK bumps), data integrity (sync, crypto, ledger), security (indigo, telemetry), scale (>500 lines), and history (editing merged migrations). When in doubt, stop and ask — the orchestrator would rather answer a question than roll back a P0.

```
  STOP-AND-ASK DECISION TREE  (§5, the 12 triggers)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │                  ┌──────────────────────────────────────────────┐          │
  │                  │  Is the change you're about to make on the   │          │
  │                  │  stop-and-ask list?  (§5 triggers #1–#12)    │          │
  │                  └──────────────────────────────────────────────┘          │
  │                                   │                                        │
  │            ┌──────────┬──────────┬────────┴───────┬─────────────┐         │
  │            ▼          ▼          ▼                ▼             ▼         │
  │       PRINCIPLE   NATIVE      DATA             SECURITY       SCALE/      │
  │       (#1, #6)    (#2,#3,#9,  INTEGRITY        (#6 indigo,    HISTORY     │
  │                    #11)        (#4,#5,#8,#12)   #10 telemetry) (#7,#8)    │
  │            │          │          │                │             │         │
  │            ▼          ▼          ▼                ▼             ▼         │
  │   ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
  │   │ #1 6th tab │ │ #2 new   │ │ #4 sync  │ │ #6 indigo│ │ #7 >500  │     │
  │   │   or new   │ │   native │ │   conf-  │ │   /blue  │ │   lines  │     │
  │   │   top-     │ │   module │ │   lict   │ │   accent  │ │   in a PR│     │
  │   │   level    │ │ #3 new   │ │   strat  │ │ #10 tele- │ │ #8 edit  │     │
  │   │   route    │ │   permis-│ │ #5 crypto│ │   metry/  │ │   merged │     │
  │   │            │ │   sion   │ │   envel. │ │   analytics│ │   SQL    │     │
  │   │            │ │ #9 Expo  │ │   (back- │ │   SDK     │ │   migr.  │     │
  │   │            │ │   SDK or │ │   up,PIN,│ │           │ │          │     │
  │   │            │ │   RN     │ │   JWT)   │ │           │ │          │     │
  │   │            │ │   bump   │ │ #8 ledger│ │           │ │          │     │
  │   │            │ │ #11 ejec-│ │   schema │ │           │ │          │     │
  │   │            │ │   t from │ │   or     │ │           │ │          │     │
  │   │            │ │   managed│ │   posting│ │           │ │          │     │
  │   │            │ │   workfl.│ │   logic  │ │           │ │          │     │
  │   │            │ │          │ │ #12 ledg │ │           │ │          │     │
  │   │            │ │          │ │   er sch.│ │           │ │          │     │
  │   └─────┬──────┘ └─────┬────┘ └─────┬────┘ └─────┬────┘ └─────┬────┘     │
  │         │              │            │            │            │           │
  │         ▼              ▼            ▼            ▼            ▼           │
  │   ┌──────────────────────────────────────────────────────────────────┐   │
  │   │  STOP CODING. Commit what you have with:                          │   │
  │   │    chore(wip): <what> — pending human review                      │   │
  │   │  (§5.1 step 1)                                                    │   │
  │   └────────────────────────────┬─────────────────────────────────────┘   │
  │                                ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────┐   │
  │   │  OPEN A DRAFT PR with the ## Spec ref and ## Risk blocks filled  │   │
  │   │  in, even if incomplete.  (§5.1 step 2)                           │   │
  │   └────────────────────────────┬─────────────────────────────────────┘   │
  │                                ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────┐   │
  │   │  IN THE WORKLOG, note:                                           │   │
  │   │    BLOCKED on human review: <trigger #>                          │   │
  │   │  (§5.1 step 3)                                                   │   │
  │   └────────────────────────────┬─────────────────────────────────────┘   │
  │                                ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────┐   │
  │   │  RETURN CONTROL TO THE ORCHESTRATOR with a clear request.        │   │
  │   │  Identify which reviewer is needed:                               │   │
  │   │    • #1 → orchestrator + principle review                         │   │
  │   │    • #2, #9, #11 → 2 reviewers incl. release engineer             │   │
  │   │    • #3, #6, #10 → security reviewer (+ orchestrator for #10)     │   │
  │   │    • #4, #5, #8, #12 → 2 reviewers incl. sync-engine / ledger-    │   │
  │   │      crypto owner                                                │   │
  │   │    • #7 → 2 reviewers + flag in PR description                    │   │
  │   │    • #8 (editing merged migration) → orchestrator sign-off       │   │
  │   │  (§5 table + §5.1 step 4)                                        │   │
  │   └──────────────────────────────────────────────────────────────────┘   │
  │                                                                            │
  │  WHEN IN DOUBT: STOP AND ASK.                                              │
  │   ↑ The orchestrator would rather answer a question than roll back a P0.  │
  │   ↑ "It compiles" is never sufficient (§7). A green EAS Build is the      │
  │     floor, not the ceiling.                                               │
  │   ↑ Every stop-and-ask trigger that fires MUST have a recorded human     │
  │     review before the PR merges (§7 checklist item #16).                  │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The decision tree is a process diagram, not a rendered UI surface —
     no glass tier annotation here (§6.6 single rule applies to live
     components only, per §11.1 above).
   ↑ Cross-refs: §5 (this file, trigger table + reviewer assignments),
     §7 (the "Done" checklist that enforces recorded human review),
     §8 (anti-patterns that often precede a stop-and-ask), 13_UI_Guidelines
     §20 (ASCII conventions this mockup follows).
```

### 11.4 References (External Design Authorities)

The mockups and the handoff primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the reading order, the stop-and-ask triggers, or the "done" checklist.

- **Expo docs** — *Getting started, project structure, EAS overview*. The §1 scaffold checklist and the §11.2 reading-order flowchart follow Expo's getting-started documentation.
- **Apple Human Interface Guidelines** — *Mobile, 44px touch targets, safe-area insets*. The §3.8 touch-target rule and the §3.9 no-indigo/blue palette rule follow Apple HIG's mobile-surface guidance.
- **Material Design 3** — *Android theming, AMOLED dark mode, biometric prompts*. The §1 stack choices (Expo SDK 52, Hermes, Reanimated 3) and the §5 biometric-related stop-and-ask triggers follow Material 3's Android guidance.
- **React Native docs** — *Hermes engine, Reanimated 3 worklets, JSI*. The §3.5 worklet-discipline rule and the §3.7 FlashList-not-FlatList rule follow React Native documentation.
- **Smashing Magazine** — *Mobile-first spec packages for AI agents*. The §0.1 "agent-ready" definition and the §11.2 reading-order flowchart follow Smashing's mobile-spec-package research.
- **CSS-Tricks** — *Monorepo code style for cross-platform apps*. The §3 TypeScript discipline (strict, no `any`, no `as` without `// SAFETY:`) follows CSS-Tricks's monorepo code-style primer.
- **Nielsen Norman Group** — *Developer handoff documentation*. The §7 "done" checklist (16 items, every one required) and the §11.3 stop-and-ask decision tree follow NN/g's developer-handoff research.
- **GitLab Engineering Handbook** — *Code review, stop-and-escalate triggers*. The §5 stop-and-ask trigger table and the §5.1 "what stop-and-ask looks like" four-step process follow GitLab's code-review handbook.

---

*End of AGENTS.md — mobile supplement. Read `../AGENTS.md` first; read this file second; read `mobile/README.md` third.*
