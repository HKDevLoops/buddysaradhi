# 01 — Mobile Architecture

> The high-level architecture of the Buddysaradhi mobile app: Expo SDK 52 managed workflow, expo-router file-based routing, OLED-first dark mode, the five-tab surface map that mirrors the web's five-screen doctrine (`02_Core_Logic.md` §1.1), the native module inventory, and the bundle-size budgets that protect cold-start time on mid-tier Android devices. This file is the architect's overview — for the storage and sync layer see `02_Native_Modules_and_Storage.md`, for navigation and state see `03_Navigation_and_State.md`, for the offline-first sync model see `04_Offline_Sync_and_Conflict_Resolution.md`.

---

## 1. Why Expo (Managed Workflow)

Buddysaradhi mobile is built on **Expo SDK 52** in **managed workflow** mode, not bare React Native. The decision is structural, not stylistic — it governs which parts of the codebase we touch and which we delegate to EAS.

### 1.1 What Managed Workflow Buys Us

- **No Xcode or Android Studio required for 95% of work.** A React Native engineer can implement the entire five-screen surface, all forms, all animations, all sync logic, and all biometric flows without ever opening a native IDE. Native projects (`ios/`, `android/`) are generated on demand by EAS Build and never checked into the repo.
- **EAS Build handles signing.** iOS App Store key, provisioning profiles, signing certificates, and Android upload keys are managed by EAS Credentials (`05_EAS_Build.md` §3). The engineer never touches a `.p12` or `.mobileprovision` file.
- **EAS Update ships JS-only fixes OTA.** A ledger-void race condition discovered on a Tuesday can be patched in production on the same Tuesday without a store review (`06_EAS_Update.md`).
- **Native modules via config plugins.** When a native module needs custom permissions or Info.plist entries, we write a config plugin in TypeScript — no native code editing (`02_Native_Modules_and_Storage.md` §9).
- **Prebuild escape hatch.** If we ever need a native change that a config plugin cannot express, `npx expo prebuild` generates the `ios/` and `android/` folders and we edit them directly. This is a one-way door — once prebuilt, we own the native projects.

### 1.2 What Managed Workflow Does Not Buy Us

- **Custom native code that bypasses Expo Modules.** If a feature requires a hand-written Swift/Kotlin bridge, we either (a) write an Expo Module (TypeScript + minimal Swift/Kotlin shims), or (b) eject to prebuild. The latter is a stop-and-ask trigger (`AGENTS.md` (mobile) §6).
- **Background execution beyond what `expo-background-fetch` and `expo-task-manager` provide.** iOS limits background fetch to ~30-min intervals; Android allows a foreground service while the app is open. We accept these limits and design sync around them (`04_Offline_Sync_and_Conflict_Resolution.md` §3).
- **Arbitrary native UI.** NativeWind + Reanimated cover 99% of the glass/neumorphism design language. The remaining 1% (e.g. true iOS blur) uses `expo-blur` and `@react-native-community/blur`.

### 1.3 Versions, Pinned

```json
{
  "expo": "~52.0.0",
  "react-native": "0.76.5",
  "react": "18.3.1",
  "expo-router": "~4.0.0",
  "expo-sqlite": "~14.0.0",
  "@libsql/client": "^0.9.0",
  "expo-secure-store": "~13.0.0",
  "expo-local-authentication": "~15.0.0",
  "expo-notifications": "~0.28.0",
  "expo-haptics": "~13.0.0",
  "expo-file-system": "~17.0.0",
  "expo-sharing": "~12.0.0",
  "react-native-reanimated": "~3.16.0",
  "react-native-mmkv": "^2.12.2",
  "react-native-mmkv-storage": "^0.10.0",
  "@shopify/flash-list": "1.7.0",
  "nativewind": "^4.1.0",
  "tailwindcss": "^3.4.0",
  "@tanstack/react-query": "^5.50.0",
  "zustand": "^4.5.0",
  "react-hook-form": "^7.50.0",
  "zod": "^3.23.0"
}
```

Hermes is the JS engine (default on Expo SDK 52). Do not disable Hermes — its bytecode precompilation is what keeps cold-start under 1.5s on a 2020-era Redmi.

---

## 2. Repository Layout

The mobile app lives at `apps/mobile/` in the monorepo (alongside `apps/web/` and `apps/desktop/`). Shared code lives in `packages/`.

```
buddysaradhi/
├── apps/
│   ├── web/              # Next.js 16 — primary surface
│   ├── mobile/           # ← THIS PACKAGE GOVERNS
│   │   ├── app/                      # expo-router file tree
│   │   │   ├── _layout.tsx           # Root: providers, fonts, splash
│   │   │   ├── (auth)/               # Login / biometric unlock group
│   │   │   │   ├── _layout.tsx
│   │   │   │   ├── login.tsx
│   │   │   │   └── unlock.tsx
│   │   │   ├── (tabs)/               # Five bottom-tab routes
│   │   │   │   ├── _layout.tsx       # Tab bar shell (glass blur)
│   │   │   │   ├── dashboard.tsx
│   │   │   │   ├── students.tsx
│   │   │   │   ├── attendance.tsx
│   │   │   │   ├── fees.tsx
│   │   │   │   └── settings.tsx
│   │   │   └── (modal)/              # Sheet modals (full-screen on phone)
│   │   │       ├── _layout.tsx
│   │   │       ├── record-payment.tsx
│   │   │       ├── add-student.tsx
│   │   │       ├── mark-attendance.tsx
│   │   │       ├── student-detail.tsx
│   │   │       └── void-receipt.tsx
│   │   ├── src/
│   │   │   ├── components/           # NativeWind-styled glass primitives
│   │   │   │   ├── GlassPanel.tsx
│   │   │   │   ├── NeumoToggle.tsx
│   │   │   │   ├── TabBar.tsx
│   │   │   │   ├── SyncChip.tsx
│   │   │   │   └── ...
│   │   │   ├── lib/
│   │   │   │   ├── db/               # expo-sqlite open, migrations, queries
│   │   │   │   ├── sync/             # outbox flush, conflict resolution
│   │   │   │   ├── crypto/           # AES-GCM, Argon2id (backup)
│   │   │   │   ├── auth/             # biometric + secure-store
│   │   │   │   └── haptics.ts        # BR-* → haptic pattern map
│   │   │   ├── hooks/                # useSyncStatus, useBiometric, etc.
│   │   │   └── store/                # Zustand stores (UI state)
│   │   ├── assets/                   # Fonts, images, splash
│   │   ├── app.config.ts             # Dynamic Expo config (env-driven)
│   │   ├── eas.json                  # Build profiles (see 05_EAS_Build.md)
│   │   ├── tsconfig.json             # extends ../../tsconfig.base.json
│   │   ├── package.json
│   │   └── tailwind.config.js        # NativeWind — same tokens as web
│   └── desktop/          # Tauri v2
├── packages/
│   ├── shared/           # Zod schemas, types, calc utils — imported by all apps
│   ├── core/             # The ledger engine (v1.x — pure functions over DB handle)
│   └── ui/               # Cross-platform glass primitives (v1.x)
├── prisma/
├── migrations/           # Forward-only SQL — applied to local expo-sqlite AND Turso
├── Buddysaradhi_Planning/
│   ├── mobile/           # ← this package
│   └── ...
└── ...
```

The `app/` directory uses expo-router's file-based convention: file name = route. Parenthesised directory names (`(tabs)`, `(modal)`, `(auth)`) are **route groups** — they group routes for shared layout without contributing a URL segment. `buddysaradhi://dashboard` is the dashboard tab, not `buddysaradhi://(tabs)/dashboard`.

---

## 3. The Five-Tab Surface Map

The web product has five screens (`02_Core_Logic.md` §1.1): Dashboard, Students, Attendance, Fees & Payments, Settings. The mobile product has **exactly the same five**, expressed as five bottom-tab routes. This is not a coincidence — P2 (Five Screens, Forever) applies to mobile verbatim. A sixth tab is a build error (`AGENTS.md` (top-level) §2 Rule 4).

| # | Tab | expo-router file | Icon | Active accent | Mirrors web spec |
|---|---|---|---|---|---|
| 1 | Dashboard | `app/(tabs)/dashboard.tsx` | `LayoutDashboard` | Emerald | `04_Dashboard.md` |
| 2 | Students | `app/(tabs)/students.tsx` | `GraduationCap` | Cyan | `05_Students.md` |
| 3 | Attendance | `app/(tabs)/attendance.tsx` | `CalendarCheck` | Cyan | `06_Attendance.md` |
| 4 | Fees & Payments | `app/(tabs)/fees.tsx` | `Wallet` | Emerald | `07_Fees_and_Payments.md` |
| 5 | Settings | `app/(tabs)/settings.tsx` | `Settings` | Violet | `08_Settings.md` |

```
┌──────────────────────────────────────────────────────────────┐
│  Topbar: Institute · Sync chip · ⋯                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              Active tab content pane                         │
│              (one of: dashboard / students /                 │
│               attendance / fees / settings)                  │
│                                                              │
│                                                              │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ◉ Dash │ ◉ Stud │ ◉ Attd │ ◉ Fees │ ◉ Sett   ← 5 tabs only │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Why a Bottom Tab, Not a Sidebar?

The web uses a left sidebar (`02_Core_Logic.md` §1.1) because the desktop viewport is wide enough to spare 240px. Mobile viewports cannot. A bottom tab bar is the universal mobile pattern, recommended by both Apple HIG and Material Design, and inherited from Discord's mobile app (one of our three lineages per `13_UI_Guidelines.md` §1.1).

### 3.2 No Central "+" Tab

`BR-UI-02` (Critical): "No bottom tab bar with a central '+' (the Instagram/Twitter pattern)." The central "+" signals "this app wants you to post." Buddysaradhi is not a posting app; it is a livelihood tool. Primary actions live inside their natural screen — "Record Payment" is a button on the Fees tab, "Mark Attendance" is a button on the Attendance tab. The tab bar is a flat 5-pack.

### 3.3 Active Indicator

The active tab is marked by a 2px emerald bar above the icon (or cyan, depending on the tab's accent per the table above — Dashboard uses emerald, Students/Attendance use cyan, Fees uses emerald, Settings uses violet). The bar is a Reanimated `SharedValue` that translates between tab positions with a spring animation (`duration: 250ms, dampingRatio: 0.8`). Inactive icons are `rgba(255,255,255,0.40)`; active icons are the full accent at `rgba(255,255,255,0.95)`.

---

## 4. expo-router File-Based Routing

expo-router v4 is the React Native equivalent of Next.js App Router. Every file under `app/` becomes a route; directories become nested routes; `_layout.tsx` files define the layout wrapper for a directory's children.

### 4.1 Route Groups

```
app/
├── _layout.tsx              ← Root layout: providers, fonts, splash gate
├── (auth)/                  ← Route group: login + unlock (no tab bar)
│   ├── _layout.tsx
│   ├── login.tsx            ← buddysaradhi://login
│   └── unlock.tsx           ← buddysaradhi://unlock (biometric / PIN prompt)
├── (tabs)/                  ← Route group: the five persistent tabs
│   ├── _layout.tsx          ← Tab bar shell
│   ├── dashboard.tsx        ← buddysaradhi://dashboard
│   ├── students.tsx         ← buddysaradhi://students
│   ├── attendance.tsx       ← buddysaradhi://attendance
│   ├── fees.tsx             ← buddysaradhi://fees
│   └── settings.tsx         ← buddysaradhi://settings
└── (modal)/                 ← Route group: sheet modals
    ├── _layout.tsx          ← Sheet presenter
    ├── record-payment.tsx   ← buddysaradhi://modal/record-payment
    ├── add-student.tsx      ← buddysaradhi://modal/add-student
    ├── mark-attendance.tsx  ← buddysaradhi://modal/mark-attendance
    ├── student-detail.tsx   ← buddysaradhi://modal/student-detail
    └── void-receipt.tsx     ← buddysaradhi://modal/void-receipt
```

### 4.2 Why Three Route Groups

- **`(auth)`** is for the unauthenticated or locked state. It has no tab bar — the user should not be able to navigate to a tab while the app is locked (`10_Security.md` §3.1). The unlock screen is the only interactive surface.
- **`(tabs)`** is the five-screen doctrine, expressed as bottom-tab routes. The user spends 99% of their time here.
- **`(modal)`** is for sheet-style interactions that overlay a tab. On iOS these present as native sheets (`presentation: 'formSheet'`); on Android they present as full-screen overlays with a slide-up animation. Modals are used for create/edit flows (record payment, add student, mark attendance) and detail views (student detail, void receipt). A modal is **never** a sixth tab — it is invoked from within a tab and dismissed back to it.

### 4.3 The Modal Stack Depth Limit

P2 forbids deep nesting. The maximum navigation depth on mobile is **2 levels**: a tab + a modal. A "student detail" modal can show a "record payment" button that pushes another modal, but that second modal is a **stop-and-ask trigger** — the engineer must instead redesign so the second action is a section within the first modal, or restructure so the first modal closes before opening the second. If you cannot avoid a 3rd level, open an RFC.

### 4.4 Deep Linking

`app.config.ts` declares the URL scheme:

```ts
import { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Buddysaradhi',
  slug: 'buddysaradhi',
  scheme: 'buddysaradhi',
  // ...
});
```

Deep links handled by expo-router:

- `buddysaradhi://dashboard` → Dashboard tab
- `buddysaradhi://students/{studentId}` → Students tab, opens the `student-detail` modal pre-loaded with that student
- `buddysaradhi://attendance?batch={batchId}&date={yyyy-mm-dd}` → Attendance tab, pre-filtered
- `buddysaradhi://fees?filter=overdue` → Fees tab, overdue filter applied

Universal links (iOS) and App Links (Android) are configured in `app.config.ts` via `associatedDomains`. The web app's receipt PDFs include a `buddysaradhi://fees?student={id}` QR code for quick navigation between devices (v1.x — web generates, mobile scans).

---

## 5. OLED-First Dark Mode

The web product uses a cosmic canvas (`#0f0c29` → `#24243e` → `#0a0a1a`). The mobile product **does not** use the same gradient on its root view. Instead, mobile uses **pure black** (`#000000`) for the root background, with the cosmic gradient applied only as a low-opacity overlay.

### 5.1 Why Pure Black on Mobile

- **OLED battery savings.** On OLED displays (every modern iPhone since iPhone X, every flagship Android), pure black pixels are off. A `#0a0a1a` background lights every pixel dimly — a 5–10% battery cost over a day of typical use. A `#000000` background lights only the text and accent pixels.
- **Contrast.** Pure black raises the effective contrast of glass panels (`rgba(255,255,255,0.05)` over `#000` is more legible than over `#0a0a1a`).
- **AMOLED burn-in avoidance.** Static UI on a colored gradient burns in faster than on pure black.

### 5.2 The Compromise — Aurora Overlay

The "Vibrant Glass & Neumorphism" design language (`13_UI_Guidelines.md` §1.2) calls for an aurora-drift background. We preserve this on mobile as a **static aurora overlay** at 4% opacity, rendered once into a `react-native-skia` canvas and cached as a PNG. The overlay is drawn above the `#000` root and below the glass panels.

```tsx
// app/_layout.tsx (excerpt)
<View className="flex-1 bg-black">
  <SkiaAuroraOverlay opacity={0.04} />
  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
</View>
```

The aurora overlay is disabled when `AccessibilityInfo.isReduceMotionEnabled()` returns true — not because it moves (it doesn't), but because low-vision users benefit from maximum contrast.

### 5.3 Light Mode — Not in v1

`BR-UI-05`: "v1 ships dark-mode only." This applies to mobile verbatim. A `theme` column in `settings` accepts `'dark'` only in v1.x; the toggle is hidden in Settings → Appearance. Light mode is a v2.x feature (`15_Future_Roadmap.md` v1.x).

### 5.4 Color Token Parity with Web

The mobile app uses the **same color tokens** as web (`13_UI_Guidelines.md` §2.1), expressed as NativeWind theme variables in `tailwind.config.js`. The only differences:

| Token | Web | Mobile | Why |
|---|---|---|---|
| `--bg-cosmic` | `#0f0c29` | `#000000` (root) + aurora overlay | OLED battery |
| `--bg-abyss` | `#0a0a1a` | `#000000` | Same — OLED |
| `--surface-glass` | `rgba(255,255,255,0.05)` | `rgba(255,255,255,0.06)` | Slightly higher opacity to compensate for pure-black background |
| All accent tokens | identical | identical | Same palette |

No indigo, no blue. Use Emerald `#00FF9D`, Cyan `#00F0FF`, Amber `#FFB300`, Flare `#FF5E00`, Violet `#B388FF` only (Rule 5).

---

## 6. Native Module Inventory

The mobile app uses the following Expo modules. Each is justified against a specific business need; nothing is imported "just in case."

| Module | Version | Purpose | Governing spec |
|---|---|---|---|
| `expo-sqlite` | `~14.0.0` | Local SQLite replica of the per-user Turso DB. Schema mirrors `11_Data_Model.md`. | `02_Native_Modules_and_Storage.md` §2 |
| `@libsql/client` | `^0.9.0` | HTTP client for Turso remote sync. Same driver as web. | `04_Offline_Sync…md` §3 |
| `expo-secure-store` | `~13.0.0` | iOS Keychain / Android Keystore for the Turso scoped JWT. Biometric-protected. | `02_Native_Modules_and_Storage.md` §4–§5 |
| `expo-local-authentication` | `~15.0.0` | FaceID / TouchID / Android Biometric. | `02_Native_Modules_and_Storage.md` §4 |
| `expo-notifications` | `~0.28.0` | Schedule 6 reminder types (`BR-REM-01..06`). | `02_Native_Modules_and_Storage.md` §8 |
| `expo-haptics` | `~13.0.0` | Tactile feedback on every `BR-*` state transition (P11). | `02_Native_Modules_and_Storage.md` §6 |
| `expo-file-system` | `~17.0.0` | Read/write encrypted `.buddysaradhi` backups. | `02_Native_Modules_and_Storage.md` §7 |
| `expo-sharing` | `~12.0.0` | OS share sheet for backup export. | `02_Native_Modules_and_Storage.md` §7 |
| `expo-background-fetch` | `~12.0.0` | iOS background fetch (sync every ~30 min). | `04_Offline_Sync…md` §3 |
| `expo-task-manager` | `~12.0.0` | Defines background tasks for `expo-background-fetch`. | `04_Offline_Sync…md` §3 |
| `expo-keep-awake` | `~13.0.0` | Prevent screen sleep during long backup/restore. | `02_Native_Modules_and_Storage.md` §7 |
| `expo-blur` | `~13.0.0` | Native blur for glass tab bar and modals (iOS). Android falls back to a translucent overlay. | `13_UI_Guidelines.md` §5.2 |
| `expo-linking` | `~7.0.0` | Deep link parsing. | §4.4 above |
| `expo-constants` | `~17.0.0` | Read app version, build hash, channel. | `06_EAS_Update.md` §4 |
| `expo-application` | `~6.0.0` | App version, build number. **Analytics hooks disabled.** | `06_EAS_Update.md` §4 |
| `expo-updates` | `~0.27.0` | OTA update runtime (code-signing verification). | `06_EAS_Update.md` §6 |
| `@shopify/flash-list` | `1.7.0` | Virtualised lists for >20 rows. Never `FlatList`. | `AGENTS.md` (top-level) §3.2 |
| `react-native-reanimated` | `~3.16.0` | 60fps gestures, neumorphic presses, swipe-to-mark. | §7 below |
| `react-native-mmkv` | `^2.12.2` | UI state persistence (30x faster than AsyncStorage). | `03_Navigation_and_State.md` §4 |
| `react-native-mmkv-storage` | `^0.10.0` | Encrypted MMKV instance for sensitive UI state. | `03_Navigation_and_State.md` §4 |
| `@react-native-async-storage/async-storage` | — | **Not used.** Replaced by MMKV. Listed here only to make the exclusion explicit. | — |

Adding any native module not on this list is a **stop-and-ask trigger** (`AGENTS.md` (mobile) §6).

---

## 7. Reanimated 3 — Gestures and Tactile Surfaces

Reanimated 3 is the animation library. All animations run on the **UI thread** via worklets; the JS thread is never blocked. This is what makes swipe-to-mark-attendance and swipe-to-record-payment feel native, not web.

### 7.1 Worklet Discipline

Every Reanimated worklet must be marked `'worklet'`:

```ts
import { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

const offset = useSharedValue(0);

const animatedStyle = useAnimatedStyle(() => {
  'worklet';
  return {
    transform: [{ translateX: offset.value }],
  };
});
```

A worklet that closes over a JS-side variable will throw at runtime. Worklets may only close over `SharedValue`s, primitives, and pure functions. The lint rule `react-native-reanimated/worklet` enforces this.

### 7.2 Swipe-to-Mark-Attendance

On the Attendance tab, each student row supports a left swipe that cycles `present → late → absent → excused → present`. The swipe uses a `Gesture.Pan()` from `react-native-gesture-handler`:

```
┌──────────────────────────────────────────────────────────┐
│  [Student Row]                                            │
│   ↗ swipe left →  ◐ late    (amber chip slides in)        │
│   ↗ swipe left →  ✕ absent  (flare chip slides in)        │
│   ↗ swipe left →  − excused (violet chip slides in)       │
│   ↗ swipe left →  ✓ present (emerald chip slides in)      │
└──────────────────────────────────────────────────────────┘
```

The swipe threshold is 40px. A swipe of <40px snaps back. A swipe of ≥40px commits the state change with a `Haptics.impactAsync(ImpactFeedbackStyle.Light)` thunk. This satisfies P3 (Two-Tap Rule) — the tutor marks attendance in one swipe per student, no tap required.

### 7.3 Swipe-to-Record-Payment

On the Fees tab, each unpaid student row supports a right swipe that opens the `record-payment` modal pre-filled with that student's outstanding balance. The swipe threshold is 60px (higher than attendance, because the action is higher-stakes).

### 7.4 Neumorphic Press

Every neumorphic button (`NeumoToggle`, `NeumoButton`) uses a Reanimated `withSpring` to compress by 4% on press and rebound on release. The spring config is `{ damping: 15, stiffness: 150, mass: 0.8 }` — Apple's "tactile" preset. A `Haptics.impactAsync(ImpactFeedbackStyle.Light)` fires on press-in, not on release, so the user feels the response before their finger leaves the screen.

### 7.5 `prefers-reduced-motion`

Per Rule 10 (`AGENTS.md` (top-level) §2) and P15, every animation must respect `AccessibilityInfo.isReduceMotionEnabled()`. The pattern:

```ts
import { AccessibilityInfo } from 'react-native';

const [reduceMotion, setReduceMotion] = useState(false);
useEffect(() => {
  AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
  return () => sub.remove();
}, []);

const spring = reduceMotion ? { duration: 0 } : { damping: 15, stiffness: 150 };
```

When `reduceMotion` is true, springs become instant (duration: 0). The visual state change still happens; only the motion is removed. Haptics remain — they are tactile, not motion, and are essential for P11.

---

## 8. NativeWind 4 — Tailwind on Native

NativeWind 4 compiles Tailwind classes to StyleSheet objects at build time. The same `glass`, `glass-strong`, `glass-faint` utility classes used on web work on native. The `tailwind.config.js` is shared between web and mobile via the monorepo's `packages/ui/tailwind.config.shared.js`.

### 8.1 Token Parity

```js
// apps/mobile/tailwind.config.js
import sharedConfig from '@buddysaradhi/ui/tailwind.config.shared';

export default {
  ...sharedConfig,
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Same tokens as web, plus pure-black overrides
        'bg-root': '#000000',
        'bg-abyss': '#000000',
        'surface-glass': 'rgba(255,255,255,0.06)',
      },
    },
  },
};
```

### 8.2 Glass Tier on Native

Glass on web is `backdrop-filter: blur(24px)` over `rgba(255,255,255,0.05)`. On native, the equivalent is:

```tsx
// iOS: BlurView (real blur)
import { BlurView } from 'expo-blur';

<BlurView intensity={24} tint="dark" className="bg-white/6 border border-white/8">
  {children}
</BlurView>

// Android: translucent overlay (no real blur — Android's RenderEffect is API 31+)
<View className="bg-black/40 border border-white/8">
  {children}
</View>
```

The `GlassPanel` component abstracts this — the engineer writes `<GlassPanel tier="default">…</GlassPanel>` and the platform difference is hidden. Android's lack of real blur is acceptable; the design language tolerates it because the cosmic canvas behind the glass is already very dark, so a translucent overlay reads as glass.

### 8.3 Dark Mode — No `dark:` Variant Needed

Because v1 ships dark-mode only (`BR-UI-05`), there is no `dark:` variant. All classes are written for dark mode. When light mode ships in v2.x, the `dark:` variants will be added retroactively.

---

## 9. Bundle Size Budgets

| Platform | Budget | Hard ceiling | Why |
|---|---|---|---|
| iOS IPA (compressed) | ≤ 30 MB | 50 MB | App Store cellular download limit is 200 MB; we aim well under. |
| Android APK (universal) | ≤ 20 MB | 30 MB | Mid-tier Android devices have limited storage. |
| Android AAB (compressed) | ≤ 18 MB | 25 MB | AAB is smaller than universal APK due to per-ABI splitting. |
| JS bundle (Hermes bytecode) | ≤ 8 MB | 12 MB | Hermes precompiles; bytecode is ~30% smaller than source. |

Bundle size is measured on every EAS Build (`05_EAS_Build.md` §6). A build that exceeds the hard ceiling fails CI. The major contributors are:

- Hermes bytecode (~3–4 MB for a typical Expo app)
- Reanimated 3 (~1.2 MB)
- libSQL native binary (~2 MB per platform)
- Fonts (Inter, Inter Display — ~600 KB total, subsetted)

If the bundle exceeds budget, the first action is to audit `packages/shared` imports for tree-shaking failures — a single `import { everything } from '@buddysaradhi/shared'` can drag in the entire Zod schema graph.

---

## 10. Process Lifecycle and AppState

React Native's `AppState` API is the bridge between native lifecycle events and JS. The mobile app uses it to:

- **`active` → `inactive`** (user backgrounds the app): lock the app if `session_timeout_min` has elapsed since last interaction (`BR-SEC-01`). Pause sync.
- **`inactive` → `active`** (user foregrounds): check for OTA updates (`06_EAS_Update.md` §4). Flush `sync_outbox` if network is available.
- **`active` → `background`** (iOS): schedule a background fetch task for ~30 min later.
- **`background` → `active`**: re-verify biometric if the app was backgrounded > `session_timeout_min` ago.

```ts
// src/hooks/useAppLifecycle.ts
import { AppState, AppStateStatus } from 'react-native';
import { useEffect } from 'react';
import { useLockStore } from '@/store/lock';
import { checkForUpdates } from '@/lib/updates';
import { flushOutbox } from '@/lib/sync';

export function useAppLifecycle() {
  const lock = useLockStore((s) => s.lock);
  const lastActive = useLockStore((s) => s.lastActive);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const idleMs = Date.now() - lastActive;
        if (idleMs > SESSION_TIMEOUT_MIN * 60_000) {
          lock();
        }
        checkForUpdates();
        flushOutbox();
      } else if (state === 'inactive' || state === 'background') {
        useLockStore.getState().setLastActive(Date.now());
      }
    });
    return () => sub.remove();
  }, [lock, lastActive]);
}
```

---

## 11. Performance Invariants

These are the floors below which the app is not shippable. Verified in EAS Build's perf-test job (`05_EAS_Build.md` §6).

| Metric | Target | Hard floor | Measurement |
|---|---|---|---|
| Cold start (splash → first paint) | ≤ 1.2s | 2.0s | `expo-performance` marker on dashboard mount |
| Attendance grid render (36 rows) | ≤ 100ms | 250ms | Reanimated frame callback |
| Sync outbox flush (100 rows) | ≤ 3s | 8s | Instrumented in `lib/sync` |
| Biometric prompt → unlock | ≤ 400ms | 800ms | `expo-local-authentication` callback |
| JS bundle parse (Hermes) | ≤ 200ms | 500ms | Hermes profiler |

If a build regresses any of these by > 20%, the build is blocked for review.

---

## 12. Cross-References

- **Storage and native modules deep dive**: `02_Native_Modules_and_Storage.md`
- **Navigation, state, deep linking**: `03_Navigation_and_State.md`
- **Offline-first sync and conflict resolution**: `04_Offline_Sync_and_Conflict_Resolution.md`
- **EAS Build profiles and credentials**: `05_EAS_Build.md`
- **EAS Update OTA channels**: `06_EAS_Update.md`
- **App Store and Play Store release**: `07_App_Store_Release.md`
- **Handoff instructions for the next mobile agent**: `AGENTS.md` (mobile)
- **Web equivalents**: `../web/` package (companion spec, parallel to this one)
- **Top-level design system**: `../13_UI_Guidelines.md`
- **Top-level data model**: `../11_Data_Model.md`
- **Top-level business rules**: `../12_Business_Rules.md`
- **Top-level agent operating manual**: `../AGENTS.md`
- **Cross-cutting EAS choreography (build profiles, channel mapping, OTA branching)**: `../deployment/03_EAS_Build_and_Update_Channels.md` — this file is the single source of truth for the three-channel model; `mobile/05_EAS_Build.md` and `mobile/06_EAS_Update.md` are the mobile-specific implementations
- **Commercial download hub (mobile APK + TestFlight invite links alongside other platform installers)**: `../product/04_Download_Hub.md` — the public surface that consumes the Vercel Blob APK mirror produced by the post-build hook in `05_EAS_Build.md` §6
- **Vercel Blob build storage (where the post-build hook uploads the APK)**: `../deployment/02_Vercel_Blob_Build_Storage.md`

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (60–80 for mobile-screen mockups, 80–100 for architecture diagrams). The three mockups below visualise the *architecture primitives* — the Expo app shell tree, the native-bridge call path, and the per-user Turso DB sync diagram — that every other file in this directory inherits.

### 13.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **architecture layer**, not the live-screen layer. The mockups below are *structural diagrams* (shell trees, bridge call paths, replication topologies) — they are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every platform architecture file gets ≥ 2 mockups), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-screen components that downstream files (`03_Navigation_and_State.md` for the tab bar, `02_Native_Modules_and_Storage.md` for the SQLite schema viewer) specify; this file's job is to feed those files the shell topology, the bridge contract, and the replication contract they consume.

| Architecture artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §2 Expo app shell tree | `03_Navigation_and_State.md` §2 (route groups) | (none — route group is a structure, not a surface) |
| §3 Five-tab surface map | `03_Navigation_and_State.md` §3 (custom glass tab bar) | `.glass-strong` (tab bar) + `.neumo-raised` (active pill) |
| §6 Native module inventory | `02_Native_Modules_and_Storage.md` §1 (storage tiers) | `.glass` (tier cards) |
| §4.1 Route groups | `03_Navigation_and_State.md` §2.3 (modal anatomy) | `.glass-strong` (modal sheet) + backdrop |
| §5 OLED dark mode | `02_Native_Modules_and_Storage.md` §7 (backup sheet) | `.glass-strong` (sheet) over `#000000` root |

### 13.2 Expo App Shell Tree (NEW)

The §2 repository layout rendered as the actual tree the engineer scaffolds. Every leaf is a file that ships in `apps/mobile/`. The three route groups (`(auth)` / `(tabs)` / `(modal)`) are the five-screen doctrine's mobile expression — five bottom-tab routes, one auth stack, one modal stack. P2 forbids a sixth tab; this tree is the lint-enforced shape.

```
  EXPO APP SHELL TREE  (apps/mobile/, §2 repository layout)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  apps/mobile/                       ← managed workflow, Expo SDK 52 (§1.3)  │
  │  ├── app/                           ← expo-router v4 file-based routing     │
  │  │   ├── _layout.tsx                ← root: providers + splash gate (§8)    │
  │  │   ├── (auth)/                    ← route group: locked/unauthenticated   │
  │  │   │   ├── _layout.tsx            ← Stack, headerShown:false, bg #000     │
  │  │   │   ├── login.tsx              ← buddysaradhi://login                       │
  │  │   │   ├── unlock.tsx             ← biometric + PIN sheet                 │
  │  │   │   └── setup-pin.tsx          ← first-run ≥6-digit (BR-SEC-05)        │
  │  │   ├── (tabs)/                    ← route group: the 5-tab doctrine (P2)  │
  │  │   │   ├── _layout.tsx            ← custom glass tab bar (§3, §13.3)      │
  │  │   │   ├── dashboard.tsx          ← Emerald accent — 04_Dashboard.md      │
  │  │   │   ├── students.tsx           ← Cyan accent — 05_Students.md          │
  │  │   │   ├── attendance.tsx         ← Cyan accent — 06_Attendance.md        │
  │  │   │   ├── fees.tsx               ← Emerald accent — 07_Fees_and_Payments │
  │  │   │   └── settings.tsx           ← Violet accent — 08_Settings.md        │
  │  │   └── (modal)/                   ← route group: sheet modals (depth ≤2)  │
  │  │       ├── _layout.tsx            ← presentation:'formSheet' (iOS)        │
  │  │       ├── record-payment.tsx     ← BR-LED-01 + BR-SYN-01 outbox row      │
  │  │       ├── add-student.tsx        ← BR-STU-01 + BR-RC-02 code assignment  │
  │  │       ├── mark-attendance.tsx    ← BR-ATT-07 lock check                  │
  │  │       ├── student-detail.tsx     ← read-only surface, deep-link target   │
  │  │       └── void-receipt.tsx       ← BR-LED-04 + BR-SEC-04 challenge       │
  │  ├── src/                                                                  │
  │  │   ├── components/                ← GlassPanel, NeumoToggle, TabBar…      │
  │  │   ├── lib/{db,sync,crypto,auth}/ ← storage + sync primitives (02_Native) │
  │  │   ├── hooks/                     ← useSyncStatus, useBiometric…          │
  │  │   └── store/                     ← Zustand UI stores (MMKV-persisted)    │
  │  ├── assets/                       ← Inter, Inter Display, splash PNG      │
  │  ├── app.config.ts                 ← dynamic Expo config (env-driven)       │
  │  ├── eas.json                      ← build profiles (see 05_EAS_Build §2)   │
  │  ├── tsconfig.json                 ← extends ../../tsconfig.base.json       │
  │  └── tailwind.config.js            ← NativeWind — same tokens as web (§8)   │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ (tabs) group has exactly 5 leaf routes — a 6th is a build error (P2, Rule 4).
   ↑ (modal) group depth ≤ 2; nested Stack inside (modal) = stop-and-ask (AGENTS §5).
   ↑ The shell is structural, not a rendered surface — no glass tier annotation
     here (§6.6 single rule applies to live components only, per §13.1 above).
   ↑ Cross-refs: §2 (this file), 03_Navigation_and_State.md §2 (route groups),
     02_Native_Modules_and_Storage.md §1 (storage tiers under src/lib/).
```

### 13.3 Native-Bridge Call Path (NEW)

The §6 native module inventory rendered as the call path a single "Record Payment" tap traverses — from the Pressable in the React tree, through the JSI bridge, into the SQLite native binary, and back as a resolved Promise. The bridge is JSI-direct (no async bridge queue) on Hermes; every call is synchronous-flavoured (`openDatabaseAsync` returns a Promise but the SQL itself runs on a native thread). This is what makes the ~50ms local-first write path possible (§2.4 of `02_Native_Modules_and_Storage.md`).

```
  NATIVE-BRIDGE CALL PATH  (one "Record Payment" tap, §6 module inventory)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  REACT TREE (Hermes JS thread)                                          │
  │   └─ <Pressable onPress={recordPayment.mutate}>  ← .neumo-raised        │
  │      ↑ 44×44px hit area (§10.2, AGENTS.md §3.8)                        │
  │      ↑ neumo-pressed on :active — Reanimated withSpring 4% compress    │
  │       │                                                                │
  │       ▼  JS callback (Zod-validated input → Result<T,E>)               │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │  @buddysaradhi/shared  (Zod schema, web+mobile parity)                │  │
  │  │   PaymentInputSchema.safeParse(input)  →  parsed.data            │  │
  │  └──────────────────────────────────────────────────────────────────┘  │
  │       │                                                                │
  │       ▼  await db.withTransactionAsync(async () => { … })              │
  │  ┌───────────────────── JSI BRIDGE ──────────────────────────────────┐ │
  │  │  expo-sqlite (TurboModule, JSI-direct)                            │ │
  │  │   SQLite C library  →  native thread  →  WAL journal               │ │
  │  │   ↑ PRAGMA foreign_keys=ON, journal_mode=WAL (02_Native §2.1)     │ │
  │  │   INSERT INTO ledger_entries …  →  trg_ledger_hash_chain fires    │ │
  │  │   INSERT INTO receipts …        →  trg_receipt_tamper_hash fires  │ │
  │  │   INSERT INTO sync_outbox …     →  trg_sync_outbox_payload_immu   │ │
  │  │   INSERT INTO audit_log …       →  trg_audit_log_no_update_delete │ │
  │  │   COMMIT  →  4 rows in one ~50ms transaction (BR-SYN-01)          │ │
  │  └─────────────────────────────────────────────────────────────────────┘ │
  │       │                                                                │
  │       ▼  resolved Promise (no throw — Result<T,E> discipline)          │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │  React tree re-render                                             │  │
  │  │   TanStack Query setQueryData (optimistic balance update)         │  │
  │  │   Haptics.notificationAsync(SUCCESS)  via expo-haptics (P11)      │  │
  │  │   Toast.show("₹5,000 recorded · RCP-2025-000043")  ← .glass-strong│  │
  │  └──────────────────────────────────────────────────────────────────┘  │
  │       │                                                                │
  │       ▼  background (UI never waits)                                    │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │  @libsql/client (HTTP, 10s timeout)                               │  │
  │  │   drainOutbox() →  client.execute({ sql, args })                  │  │
  │  │   Turso per-user DB  →  INSERT replayed, ack received             │  │
  │  │   UPDATE sync_outbox SET status='sent' WHERE id=?                 │  │
  │  └──────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
   ↑ Money is INTEGER paise throughout (BR-M-01, AP-17); no float crosses
     the bridge — amount=500000 represents ₹5,000.00 exactly.
   ↑ The 4 INSERTs are one atomic transaction (BR-SYN-01); a mid-tx crash
     rolls all 4 back, so the ledger never has a payment without its receipt.
   ↑ expo-haptics fires on COMMIT, not on tap-down (§7.4) — matches Apple HIG.
   ↑ The toast is .glass-strong (elevated focus, §5.2); the Pressable is
     .neumo-raised (control, §6.6) — surfaces vs. controls never inverted.
   ↑ Cross-refs: §6 (this file), 02_Native_Modules_and_Storage.md §2.4 (write
     path), 04_Offline_Sync_and_Conflict_Resolution.md §3 (drain loop).
```

### 13.4 Per-User Turso DB Sync Topology (NEW)

The §1.1 managed-workflow rationale + the §3 inverted-authority diagram rendered as the full replication topology. The local SQLite is the read authority; Turso is the write-replay authority. Every device owned by the same tutor (phone + tablet + the eventual v2 desktop) converges via the per-user Turso DB. The Turso scoped JWT (in `expo-secure-store`) is the only credential that crosses the device boundary — biometric-protected, device-local, never synced.

```
  PER-USER TURSO DB SYNC TOPOLOGY  (single tutor, multiple devices, P5)
  ┌────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │                       ┌──────────────────────────────┐                   │
  │                       │  Turso per-user DB            │                   │
  │                       │  (app.buddysaradhi/<tenant_id>)    │                   │
  │                       │  ↑ write-replay authority     │                   │
  │                       │  ↑ schema mirrors migrations/ │                   │
  │                       │  ↑ 11_Data_Model.md §4 tables │                   │
  │                       └──────────────────────────────┘                   │
  │                          ▲                          │                     │
  │                          │ HTTP push                │ HTTP pull           │
  │                          │ (outbox drain,           │ (SELECT * WHERE    │
  │                          │  libSQL client)          │  updated_at > ?)    │
  │                          │                          ▼                     │
  │   ┌──────────────────────┴──────────┐   ┌───────────────────────────┐    │
  │   │  Device A — primary phone        │   │  Device B — tablet (v2)   │    │
  │   │  ┌────────────────────────────┐ │   │  ┌──────────────────────┐ │    │
  │   │  │  Local SQLite (buddysaradhi.db) │ │   │  │  Local SQLite        │ │    │
  │   │  │  ↑ read authority for UI   │ │   │  │  ↑ read authority    │ │    │
  │   │  │  ↑ source of truth         │ │   │  │  ↑ source of truth   │ │    │
  │   │  └────────────────────────────┘ │   │  └──────────────────────┘ │    │
  │   │  ┌────────────────────────────┐ │   │  ┌──────────────────────┐ │    │
  │   │  │  sync_outbox (queue)       │ │   │  │  sync_outbox (queue) │ │    │
  │   │  │  ↑ BR-SYN-01 same-tx write │ │   │  │  ↑ BR-SYN-01         │ │    │
  │   │  └────────────────────────────┘ │   │  └──────────────────────┘ │    │
  │   │  ┌────────────────────────────┐ │   │  ┌──────────────────────┐ │    │
  │   │  │  expo-secure-store         │ │   │  │  expo-secure-store   │ │    │
  │   │  │  ↑ Turso scoped JWT only   │ │   │  │  ↑ Turso scoped JWT  │ │    │
  │   │  │  ↑ biometric-protected     │ │   │  │  ↑ biometric-protect │ │    │
  │   │  │  ↑ BR-SEC-04 challenge     │ │   │  │  ↑ BR-SEC-04         │ │    │
  │   │  └────────────────────────────┘ │   │  └──────────────────────┘ │    │
  │   └──────────────────────────────────┘   └───────────────────────────┘    │
  │                                                                          │
  │   Conflict resolution (BR-SYN-03 LWW for non-ledger; BR-SYN-04          │
  │   append-only conflict-immune for ledger; BR-SYN-02 payload immutable)  │
  │   runs in each device's local SQLite on pull — never on the server.     │
  │                                                                          │
  └────────────────────────────────────────────────────────────────────────┘
   ↑ The web app (browser) is a third consumer of the same Turso DB — it
     reads/writes via Supabase Edge Function, not via the libSQL client.
   ↑ A new device's first sync (BR-SYN-09) is a single streaming SELECT *
     pass with resumable rowid checkpoint — see 06_EAS_Update.md §4.5
     implementation and 04_Offline_Sync_and_Conflict_Resolution.md §4.1.
   ↑ The topology is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ Cross-refs: §1.1 (this file), 04_Offline_Sync_and_Conflict_Resolution.md
     §1.1 (inverted authority), 02_Native_Modules_and_Storage.md §3 (libSQL
     client), 02_Native_Modules_and_Storage.md §4 (SecureStore lifecycle).
```

### 13.5 References (External Design Authorities)

The mockups and the architecture primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the managed-workflow choice, the JSI bridge contract, or the per-user Turso topology.

- **Expo docs** — *Managed Workflow*, *Configuration with app.config.ts*, *Prebuild*. The §1 managed-workflow rationale and the §13.2 shell tree follow Expo's official managed-workflow doctrine.
- **Apple Human Interface Guidelines** — *Mobile, safe-area insets, 44px touch targets*. The §13.3 44×44px hit-area annotation and the §5 OLED-dark-mode choice follow Apple HIG's mobile-surface guidance.
- **Material Design 3** — *Android theming, AMOLED dark mode*. The §5 pure-black root (`#000000`) follows Material 3's AMOLED-dark guidance for battery and contrast.
- **Turso docs** — *Per-user database pattern, libSQL HTTP client, embedded replicas*. The §13.4 per-user Turso topology follows Turso's documented per-tenant pattern; we use the HTTP transport (not embedded-replica) per `02_Native_Modules_and_Storage.md` §3.1.
- **Smashing Magazine** — *Mobile UX: Offline-First Architecture*. The §1.1 offline-first pillar and the §13.3 read-from-local / write-to-outbox split follow Smashing's offline-first mobile UX research.
- **CSS-Tricks** — *`env(safe-area-inset-*)` on mobile web*. The §4.3 safe-area inset discipline (consumed by `03_Navigation_and_State.md` §3 for the bottom tab bar) follows CSS-Tricks's `env()` primer.
- **React Native docs** — *Hermes engine, Reanimated 3, JSI*. The §13.3 JSI-bridge call path follows the React Native JSI architecture documentation.

---

*End of 01 — Architecture. Next file: `02_Native_Modules_and_Storage.md`.*
