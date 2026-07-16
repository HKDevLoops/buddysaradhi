# 03 — Navigation and State

> The mobile app's navigation graph (expo-router `(tabs)` + `(modal)` + `(auth)` groups), the custom glass tab bar, the state layers (TanStack Query v5 for server cache, Zustand + MMKV for UI state, `react-hook-form` + zod for forms), the back-gesture contract, and the deep-linking config. This file is the React Native frontend engineer's manual. For the file tree of `app/` see `01_Architecture.md` §2; for the storage layers themselves see `02_Native_Modules_and_Storage.md`.

---

## 1. Navigation Architecture at a Glance

```
┌──────────────────────────────────────────────────────────────────┐
│                       ROOT LAYOUT (_layout.tsx)                   │
│   Providers: QueryClient, Reanimated, MMKV, Fonts, SplashGate     │
│   Decides initial route: (auth)/login  OR  (auth)/unlock          │
│                          OR  (tabs)/dashboard                      │
└──────────────────────────────────────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
   │   (auth) group   │ │   (tabs) group   │ │   (modal) group  │
   │   — no tab bar   │ │   — 5-tab shell  │ │   — sheet modals │
   │   — full-screen  │ │   — glass blur   │ │   — slide-up     │
   └──────────────────┘ └──────────────────┘ └──────────────────┘
        │                    │                    │
        ├─ login.tsx         ├─ dashboard.tsx     ├─ record-payment.tsx
        ├─ unlock.tsx        ├─ students.tsx      ├─ add-student.tsx
        └─ setup-pin.tsx     ├─ attendance.tsx    ├─ mark-attendance.tsx
                             ├─ fees.tsx          ├─ student-detail.tsx
                             └─ settings.tsx      └─ void-receipt.tsx
```

expo-router renders the root layout once and swaps child layouts based on the active route. The provider stack is mounted **once**, at root — it survives navigation. This is the mobile equivalent of the web's persistent `GlassShell` (`02_Core_Logic.md` §1; `BR-UI-07`).

---

## 2. Route Groups in Detail

### 2.1 `(auth)` — Unauthenticated / Locked

The `(auth)` group is for the unauthenticated or locked state. It has **no tab bar** — the user should not be able to navigate to a tab while the app is locked (`10_Security.md` §3.1).

```
app/(auth)/
├── _layout.tsx          ← Stack layout, header hidden, opaque background
├── login.tsx            ← Email + password / Google OAuth
├── unlock.tsx           ← Biometric prompt + PIN entry
└── setup-pin.tsx        ← First-run PIN setup (≥ 6 digits, BR-SEC-05)
```

The `(auth)/_layout.tsx` uses a `Stack` with `screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }}`. The unlock screen is the only interactive surface when the app is locked — biometric prompt on top, PIN entry sheet below, no other affordances.

#### 2.1.1 Login Flow

```
┌──────────────────────────────────────────────────────────────┐
│  login.tsx                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Buddysaradhi logo (emerald gradient)                       │  │
│  │  "Welcome back"                                        │  │
│  │                                                        │  │
│  │  [ Email field — neumorphic inset ]                    │  │
│  │  [ Password field — neumorphic inset ]                 │  │
│  │                                                        │  │
│  │  [ Sign in — emerald CTA, 56px height ]                │  │
│  │                                                        │  │
│  │  ──────── or ────────                                  │  │
│  │                                                        │  │
│  │  [ Continue with Google — glass outline ]              │  │
│  │                                                        │  │
│  │  "Forgot password?" (cyan link → web)                  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Sign-in uses Supabase Auth via `@supabase/supabase-js`. On success:

1. Supabase returns a session with `user_metadata.db_url` and `user_metadata.db_token` (the scoped Turso JWT).
2. Mobile stores the JWT in `expo-secure-store` and the URL in MMKV.
3. The TanStack Query client is invalidated; the Dashboard query runs against local SQLite (or bootstraps the schema if first launch).
4. `router.replace('/(tabs)/dashboard')`.

Google OAuth on mobile uses `expo-auth-session` with `SessionProvider` and `makeRedirectUri({ native: 'buddysaradhi://login' })`. The redirect URI is registered in the Google Cloud Console for the iOS bundle ID and Android application ID.

#### 2.1.2 Unlock Flow

Per `10_Security.md` §3, the app locks on cold start, on idle timeout (`session_timeout_min`, default 5), and on `AppState` `background` (with the 5-min grace). The unlock screen shows:

- Biometric prompt (auto-triggered on mount if `biometric_enabled = 1` in `settings`)
- "Use PIN" button (cyan outline) → opens PIN entry sheet

On successful unlock, `router.replace('/(tabs)/dashboard')`. The unlock screen does **not** render behind the dashboard — it's a hard replace, not a modal.

### 2.2 `(tabs)` — The Five-Screen Doctrine

```
app/(tabs)/
├── _layout.tsx          ← Tab bar shell (glass blur, custom component)
├── dashboard.tsx        ← buddysaradhi://dashboard
├── students.tsx         ← buddysaradhi://students
├── attendance.tsx       ← buddysaradhi://attendance
├── fees.tsx             ← buddysaradhi://fees
└── settings.tsx         ← buddysaradhi://settings
```

The `(tabs)/_layout.tsx` declares a `Tabs` navigator with a custom `tabBar` prop pointing to our `TabBar` component (see §3 below). Each tab screen sets:

```ts
<Tabs.Screen
  name="dashboard"
  options={{
    title: 'Dashboard',
    tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} />,
    tabBarActiveTintColor: '#00FF9D', // emerald
    tabBarInactiveTintColor: 'rgba(255,255,255,0.40)',
    header: () => <CustomHeader screen="dashboard" />,
  }}
/>
```

Headers are **custom**, not the default expo-router header. The custom header is a glass panel with the institute name, sync chip, and overflow menu. See §4.

#### 2.2.1 Dashboard Tab

Mirrors `04_Dashboard.md`. Renders KPI cards (collected this month, due today, attendance %, active students), heatmaps (attendance + payment), the activity feed, and quick actions. All data from TanStack Query against local SQLite.

#### 2.2.2 Students Tab

Mirrors `05_Students.md`. FlashList of students, sorted by `code`. Tap → `student-detail` modal. Long-press → context menu (Edit, Archive, Record Payment, Send Statement).

#### 2.2.3 Attendance Tab

Mirrors `06_Attendance.md`. Date + batch selector at top, then FlashList of student rows. Each row supports swipe-to-mark (left swipe cycles present → late → absent → excused). Lock button at top-right; on lock, biometric challenge (`BR-ATT-07`).

#### 2.2.4 Fees Tab

Mirrors `07_Fees_and_Payments.md`. Three-segment filter (Paid / Unpaid / Partial). FlashList of students with their balance, last payment, and overdue chips. Tap → `student-detail` modal. Swipe right → `record-payment` modal pre-filled.

#### 2.2.5 Settings Tab

Mirrors `08_Settings.md`. Section list: Profile, Appearance, Security, Backup, Import/Export, Diagnostics, About. Each section expands inline; deep navigation is avoided (P2 — depth ≤ 2).

### 2.3 `(modal)` — Sheet Modals

```
app/(modal)/
├── _layout.tsx             ← Stack with presentation: 'formSheet' (iOS)
├── record-payment.tsx
├── add-student.tsx
├── mark-attendance.tsx
├── student-detail.tsx
└── void-receipt.tsx
```

iOS uses `presentation: 'formSheet'` (the iOS 15+ sheet with a grabber). Android uses `presentation: 'modal'` (full-screen slide-up). Both are dismissed via swipe-down (iOS) or back button (Android).

#### 2.3.1 Modal Stack Depth

P2 forbids deep navigation. The maximum depth from a tab is **one modal**. If a modal needs to open another modal (e.g., `student-detail` → `record-payment`), the engineer must either:

- **Close the first modal, then open the second.** This is the preferred pattern. Use `router.dismiss()` then `router.push('/(modal)/record-payment')` in the same tick.
- **Redesign** so the second action is a section within the first modal. E.g., `student-detail` includes a "Record Payment" section that opens inline rather than pushing a new modal.

A second-level modal is a **stop-and-ask trigger** (`AGENTS.md` (mobile) §6). The lint rule `no-nested-modal` rejects PRs that introduce `Stack` inside a `(modal)` route.

#### 2.3.2 Modal Anatomy

```
┌────────────────────────────────────────────────────────────┐
│  ── grabber (iOS) ──                                        │
│                                                            │
│  [Title]                                       [ ✕ Close ] │
│  ───────────────────────────────────────────────────────── │
│                                                            │
│  [ Form fields — neumorphic inset ]                        │
│  [ Form fields ]                                            │
│  [ Form fields ]                                            │
│                                                            │
│  ───────────────────────────────────────────────────────── │
│  [ Cancel (glass outline) ]   [ Save (emerald CTA, 56px) ] │
└────────────────────────────────────────────────────────────┘
```

The footer is **sticky** at the bottom of the sheet (Reanimated `useAnimatedStyle` with `position: 'absolute', bottom: 0`). The body scrolls behind it. This mirrors the web's sticky-footer rule (`AGENTS.md` (top-level) §6.3).

---

## 3. Custom Glass Tab Bar

The default expo-router tab bar is a flat panel with a top border. We replace it with a glass-blurred bar that floats above the cosmic canvas, with a Reanimated active indicator.

### 3.1 Anatomy

```
┌────────────────────────────────────────────────────────────────┐
│  ← 4px emerald bar (active indicator, animated)                 │
│  ┌──────┬──────┬──────┬──────┬──────┐                          │
│  │  ◉   │  ◉   │  ◉   │  ◉   │  ◉   │  ← icons                  │
│  │ Dash │ Stud │ Attd │ Fees │ Sett │  ← labels (12px)         │
│  └──────┴──────┴──────┴──────┴──────┘                          │
│  ↑ glass blur (BlurView on iOS, translucent on Android)        │
│  ↑ border-top: 1px rgba(255,255,255,0.08)                      │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 Implementation

```tsx
// src/components/TabBar.tsx
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { View, Pressable, Text } from 'react-native';
import Animated, { useAnimatedStyle, withSpring, sharedClone } from 'react-native-reanimated';
import { LayoutDashboard, GraduationCap, CalendarCheck, Wallet, Settings } from 'lucide-react-native';

const TABS = [
  { name: 'dashboard', label: 'Dash', icon: LayoutDashboard, accent: '#00FF9D' },
  { name: 'students', label: 'Stud', icon: GraduationCap, accent: '#00F0FF' },
  { name: 'attendance', label: 'Attd', icon: CalendarCheck, accent: '#00F0FF' },
  { name: 'fees', label: 'Fees', icon: Wallet, accent: '#00FF9D' },
  { name: 'settings', label: 'Sett', icon: Settings, accent: '#B388FF' },
] as const;

export function TabBar({ state, navigation }: Tabs.TabBarProps) {
  const activeIndex = state.index;
  const indicatorTranslate = useSharedValue(activeIndex * (100 / TABS.length));

  useEffect(() => {
    indicatorTranslate.value = withSpring(activeIndex * (100 / TABS.length), {
      damping: 15,
      stiffness: 150,
    });
  }, [activeIndex]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${indicatorTranslate.value}%` }],
  }));

  return (
    <View className="absolute bottom-0 left-0 right-0">
      <BlurView intensity={32} tint="dark" className="border-t border-white/8">
        <View className="flex-row h-16 pb-2">
          <Animated.View
            className="absolute top-0 h-0.5 w-1/5 bg-accent-emerald"
            style={indicatorStyle}
          />
          {TABS.map((tab, i) => {
            const isActive = i === activeIndex;
            const Icon = tab.icon;
            return (
              <Pressable
                key={tab.name}
                onPress={() => navigation.navigate(tab.name)}
                className="flex-1 items-center justify-center"
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={tab.label}
              >
                <Icon
                  size={22}
                  color={isActive ? tab.accent : 'rgba(255,255,255,0.40)'}
                />
                <Text
                  className="mt-1 text-[10px]"
                  style={{ color: isActive ? tab.accent : 'rgba(255,255,255,0.40)' }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}
```

### 3.3 Touch Targets

Each tab is `flex-1` in a `h-16` (64px) bar — well above the 44×44px minimum (Rule 10). The Pressable fills the entire tab area; the icon + label are centered. There is no dead zone.

### 3.4 Haptic on Tab Change

A `Haptics.impactAsync(ImpactFeedbackStyle.Light)` fires on tab change. This is the **only** haptic in the app that fires on a non-`BR-*` transition — it's a navigation confirmation, not a state change. Justified because tab changes are infrequent (5–10 per session) and the haptic reinforces that the tap was registered.

---

## 4. State Layers

The mobile app has three state layers, mirroring the web app's architecture (`AGENTS.md` (top-level) §3.2):

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1 — TanStack Query v5 (server state cache)            │
│  ────────────────────────────────────────────                │
│  Owns: student lists, ledger entries, attendance sessions,   │
│        fee plans — anything that lives in SQLite.            │
│  Source: SQLite reads (via queryFn).                         │
│  Invalidation: triggered by sync engine after outbox flush.  │
│  Persistence: in-memory only (no persistQueryClient —        │
│               SQLite IS the persistence layer).              │
└──────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 2 — Zustand + MMKV (UI state)                         │
│  ────────────────────────────────────                        │
│  Owns: active tab, dashboard filter state, modal open state, │
│        last-used batch, theme preferences.                    │
│  Source: Zustand store, persisted to MMKV via persist        │
│          middleware.                                          │
│  Never: business data, money, ledger rows.                   │
└──────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 3 — react-hook-form + zod (form state)                │
│  ─────────────────────────────────────                       │
│  Owns: form field values, validation state, dirty state.     │
│  Source: shared Zod schemas in @buddysaradhi/shared.              │
│  Lifecycle: dies on form unmount. Nothing persists.          │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 TanStack Query v5 — Server State

```ts
// src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // SQLite reads are fast; 30s staleness is fine
      gcTime: 5 * 60_000,       // 5 min garbage collection
      retry: 1,                 // SQLite doesn't fail twice; network errors handled by sync
      refetchOnWindowFocus: true, // AppState 'active' → refetch
      refetchOnReconnect: false, // we don't have a "reconnect" concept (always local)
    },
    mutations: {
      retry: 0,                 // mutations are local; never retry
      onError: (err) => {
        // Surface via toast + audit_log
        logError(err);
      },
    },
  },
});
```

#### 4.1.1 Query Keys

Query keys are hierarchical strings, mirroring the table names:

- `['students']` — list
- `['students', studentId]` — single student
- `['students', studentId, 'ledger']` — student's ledger entries
- `['students', studentId, 'balance']` — computed balance
- `['attendance', batchId, date]` — one session
- `['fees', 'overdue']` — overdue list

The sync engine invalidates by prefix after a flush: `queryClient.invalidateQueries({ queryKey: ['students'] })` invalidates all student queries.

#### 4.1.2 The Optimistic Update Pattern

```ts
const useRecordPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PaymentInput) => {
      // Writes to local SQLite + sync_outbox (see 02_Native_Modules_and_Storage.md §2.4)
      return postPaymentLocally(input);
    },
    onMutate: async (input) => {
      // Optimistically update the cache
      await queryClient.cancelQueries({ queryKey: ['students', input.studentId, 'balance'] });
      const previous = queryClient.getQueryData(['students', input.studentId, 'balance']);
      queryClient.setQueryData(['students', input.studentId, 'balance'], (old: Balance) => ({
        ...old,
        balance_paise: old.balance_paise - input.amountPaise,
      }));
      return { previous };
    },
    onError: (_err, input, ctx) => {
      // Rollback
      queryClient.setQueryData(['students', input.studentId, 'balance'], ctx?.previous);
    },
    onSettled: (_data, _err, input) => {
      queryClient.invalidateQueries({ queryKey: ['students', input.studentId] });
      queryClient.invalidateQueries({ queryKey: ['fees'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};
```

The optimistic update is safe because the local SQLite write has already happened by the time `onMutate` runs — the mutation function writes synchronously before returning. If the write fails, `onError` rolls back the UI, and the toast surfaces the error. The sync engine will retry the outbox row in the background.

### 4.2 Zustand + MMKV — UI State

```ts
// src/store/ui.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV({ id: 'ui-store', encryptionKey: undefined });

const storage = {
  setItem: (name, value) => mmkv.set(name, value),
  getItem: (name) => mmkv.getString(name) ?? null,
  removeItem: (name) => mmkv.delete(name),
};

interface UIState {
  lastActiveTab: string;
  dashboardFilter: 'today' | 'week' | 'month';
  lastUsedBatchId: string | null;
  setLastActiveTab: (tab: string) => void;
  setDashboardFilter: (f: UIState['dashboardFilter']) => void;
  setLastUsedBatchId: (id: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      lastActiveTab: 'dashboard',
      dashboardFilter: 'today',
      lastUsedBatchId: null,
      setLastActiveTab: (tab) => set({ lastActiveTab: tab }),
      setDashboardFilter: (f) => set({ dashboardFilter: f }),
      setLastUsedBatchId: (id) => set({ lastUsedBatchId: id }),
    }),
    { name: 'ui-store', storage: createJSONStorage(() => storage) }
  )
);
```

#### 4.2.1 Why MMKV, Not AsyncStorage?

`react-native-mmkv` is ~30x faster than `@react-native-async-storage/async-storage` because it writes directly to a memory-mapped file via C++ (no JS bridge). For 100 KB of UI state, MMKV persists in < 1ms; AsyncStorage takes 30ms. On a mid-tier Android device, the difference is perceptible at cold start.

#### 4.2.2 Encrypted MMKV

For sensitive UI state (e.g., whether biometric is enabled, last failed PIN timestamp), we use `react-native-mmkv-storage`'s encrypted mode:

```ts
import { MMKVLoader } from 'react-native-mmkv-storage';

const secureMMKV = new MMKVLoader()
  .withEncryption()
  .withKeychainService('buddysaradhi-secure-ui')
  .initialize();
```

The encryption key is stored in iOS Keychain / Android Keystore, auto-generated on first use. This is **separate** from the Turso JWT in `expo-secure-store` — they use different Keychain items with different access policies.

#### 4.2.3 What Never Lives in Zustand

- **Money.** Money is in SQLite, period. The Zustand store can hold a `dashboardFilter` but never a `balancePaise`.
- **Student data.** A student's name, phone, balance — all in SQLite, surfaced via TanStack Query. Zustand only holds UI state.
- **The Turso JWT.** In `expo-secure-store` only.
- **The PIN hash.** In `settings.pin_hash` (SQLite) only.

### 4.3 react-hook-form + zod — Form State

Forms use `react-hook-form` with `zodResolver`. The Zod schemas are imported from `@buddysaradhi/shared` — the **same** package the web app uses. This guarantees form validation is byte-for-byte identical across web and mobile.

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PaymentInputSchema, PaymentInput } from '@buddysaradhi/shared';

function RecordPaymentForm({ studentId }: { studentId: string }) {
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<PaymentInput>({
    resolver: zodResolver(PaymentInputSchema),
    defaultValues: {
      studentId,
      amountPaise: 0,
      method: 'cash',
      occurredOn: todayISO(),
      note: '',
    },
  });

  const recordPayment = useRecordPayment();

  const onSubmit = handleSubmit(async (data) => {
    const result = await recordPayment.mutateAsync(data);
    if (result.ok) {
      router.dismiss();
    } else {
      // toast error
    }
  });

  return (
    // ... form fields ...
  );
}
```

#### 4.3.1 The Shared Zod Schemas

`@buddysaradhi/shared` exports:

- `StudentInputSchema` — used by `add-student` modal
- `PaymentInputSchema` — used by `record-payment` modal
- `AttendanceMarkSchema` — used by attendance grid
- `LedgerVoidSchema` — used by `void-receipt` modal
- `BackupPassphraseSchema` — used by backup/restore sheets
- `PINSchema` — used by setup/unlock/PIN challenge

Every schema enforces integer paise (Rule 6). For example:

```ts
export const PaymentInputSchema = z.object({
  studentId: z.string().uuid(),
  amountPaise: z.number().int().min(1).max(10_000_000_00), // ₹1 to ₹10,00,000
  method: z.enum(['cash', 'upi', 'card', 'bank', 'cheque', 'other']),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
});
```

If you need to add a field, add it to `@buddysaradhi/shared` first — never to a local schema. A local schema will drift from web's validation within two PRs.

---

## 5. The Back Gesture

The back gesture is one of the most-used affordances on mobile. expo-router handles it natively, but the engineer must understand the behaviour.

### 5.1 iOS — Edge Swipe

iOS users swipe from the left edge to go back. expo-router (via `react-native-screens`) enables this by default for `Stack` navigators. The swipe gesture:

- Pops the current modal (sheet slides down).
- Pops the current `(modal)` route back to the `(tabs)` route that pushed it.
- Does **not** pop between tabs — tab switching is one-shot, not a stack.

### 5.2 Android — Hardware/Software Back Button

Android's back button (hardware or gesture nav) is handled by `BackHandler`. expo-router wires this automatically:

- Modal open → back button dismisses the modal.
- Tab open → back button exits the app (after a confirm toast "Press back again to exit").
- Auth screen → back button does nothing (the user must authenticate).

The "press back again to exit" pattern is implemented via:

```ts
// app/(tabs)/_layout.tsx
import { BackHandler } from 'react-native';

let backPressCount = 0;

useFocusEffect(
  useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (backPressCount === 0) {
        backPressCount = 1;
        Toast.show('Press back again to exit', { duration: 2000 });
        setTimeout(() => { backPressCount = 0; }, 2000);
        return true;
      }
      return false; // let the system handle it (exit app)
    });
    return () => sub.remove();
  }, [])
);
```

### 5.3 Programmatic Back

```ts
import { router } from 'expo-router';

router.back();     // pop one screen
router.dismiss();  // dismiss the current modal (iOS sheet slides down)
```

`router.dismiss()` is preferred over `router.back()` for modals because it triggers the iOS sheet dismiss animation, while `router.back()` may use the stack pop animation (less polished).

---

## 6. Deep Linking

The app registers the `buddysaradhi://` URL scheme in `app.config.ts`:

```ts
export default (): ExpoConfig => ({
  // ...
  scheme: 'buddysaradhi',
  ios: {
    associatedDomains: ['applinks:buddysaradhi.app'],
  },
  android: {
    intentFilters: [
      { action: 'VIEW', data: { scheme: 'buddysaradhi' } },
      { action: 'VIEW', data: { host: 'buddysaradhi.app', scheme: 'https' } },
    ],
  },
});
```

### 6.1 Handled Deep Links

| URL | Target |
|---|---|
| `buddysaradhi://dashboard` | `(tabs)/dashboard` |
| `buddysaradhi://students` | `(tabs)/students` |
| `buddysaradhi://students/{studentId}` | `(tabs)/students` + open `student-detail` modal |
| `buddysaradhi://attendance?batch={batchId}&date={yyyy-mm-dd}` | `(tabs)/attendance` pre-filtered |
| `buddysaradhi://fees?filter=overdue` | `(tabs)/fees` with overdue filter |
| `buddysaradhi://modal/record-payment?student={studentId}` | `(modal)/record-payment` pre-filled |
| `buddysaradhi://login` | `(auth)/login` (used by OAuth redirect) |

### 6.2 Universal Links / App Links

The web app at `buddysaradhi.app` hosts:

- `/apple-app-site-association` — iOS Universal Links config
- `/.well-known/assetlinks.json` — Android App Links config

These enable `https://buddysaradhi.app/r/{receiptId}` to open the mobile app directly (if installed) rather than the web browser. The mobile app's `expo-linking` parses the URL and routes to the appropriate modal.

### 6.3 Pending Deep Link on Cold Start

If the app is launched via a deep link while cold, expo-router delays the initial route until the auth state is resolved:

1. App starts → `(auth)/unlock` (or `(auth)/login` if no session).
2. User authenticates.
3. The pending deep link is replayed via `Linking.getInitialURL()` and routed.

This avoids the race condition where a deep link tries to open a tab before the user has unlocked.

---

## 7. Headers and the Overflow Menu

Each tab has a custom header rendered by the `(tabs)/_layout.tsx`:

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌─ Glass header bar ─────────────────────────────────────────┐ │
│  │  [Institute Avatar]  Institute Name           [● synced] [⋯]│ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

- **Institute avatar + name** — tappable → Settings → Profile.
- **Sync chip** — `● synced` (emerald), `◐ syncing` (cyan, animated), `○ offline · N pending` (amber), `✕ failed` (flare). Tap → opens sync drawer (sheet modal).
- **Overflow menu (`⋯`)** — opens a context menu with: Refresh, Lock now, Diagnostics, About.

The header is **persistent** across tab switches — it does not re-render on navigation. This is `BR-UI-07` on mobile (the mobile equivalent of the web's persistent shell).

---

## 8. The Splash Gate

The root layout gates the app behind a splash screen until:

1. Fonts have loaded (`Inter`, `Inter Display`).
2. MMKV has hydrated (Zustand store).
3. The auth state has resolved (logged in or not).
4. If logged in, the SQLite DB has been opened and migrations have run.
5. If first launch after signup, the schema has been bootstrapped both locally and on Turso.

```tsx
// app/_layout.tsx
import { SplashGate } from '@/components/SplashGate';

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReanimatedProvider>
        <SplashGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(modal)" />
          </Stack>
        </SplashGate>
      </ReanimatedProvider>
    </QueryClientProvider>
  );
}
```

The splash gate renders the Expo splash image (configured in `app.config.ts` `splash`) until all 5 conditions are met. If any condition fails (e.g., Turso bootstrap fails), the gate shows an error screen with a "Retry" button and a "Report" button (which logs to local `audit_log` only — no telemetry, per `TELE-1`).

---

## 9. Navigation Anti-Patterns (What NOT to Do)

| Anti-pattern | Why it's wrong | Do this instead |
|---|---|---|
| Nested `Stack` inside `(modal)` | Creates 3rd-level depth; violates P2 | Close the first modal, then open the second |
| `router.push` from a tab to another tab | Tabs are not a stack — push creates a duplicate | Use `router.replace` or `navigation.navigate` |
| Storing form state in Zustand | Form state is ephemeral; Zustand is persisted | Use `react-hook-form`; let it die on unmount |
| Storing money in Zustand | Money must be in SQLite; Zustand is UI-only | Use TanStack Query against SQLite |
| Custom back button on Android | Breaks system gesture nav | Use `BackHandler` only to intercept (not replace) |
| Tab bar with central "+" | Violates `BR-UI-02` | All primary actions live inside their tab |
| 6th tab "just for now" | Violates P2 | Re-home the capability inside one of the 5 |
| Indigo tab active tint | Violates Rule 5 | Use the tab's accent (emerald/cyan/violet) |
| `Alert.alert()` for errors | Not tactile; doesn't match design language | Use a glass toast with haptic |
| Default expo-router header | Doesn't match design language | Custom header per §7 |

---

## 10. Cross-References

- **Native modules and storage**: `02_Native_Modules_and_Storage.md`
- **Architecture overview (file tree)**: `01_Architecture.md` §2, §3, §4
- **Sync engine (TanStack invalidation triggers)**: `04_Offline_Sync_and_Conflict_Resolution.md` §6
- **Top-level core logic (web equivalent of GlassShell)**: `../02_Core_Logic.md` §1
- **Top-level UI guidelines (design tokens, glass tiers)**: `../13_UI_Guidelines.md`
- **Top-level user flows**: `../03_User_Flows.md`
- **Top-level agent operating manual**: `../AGENTS.md`
- **Cross-cutting EAS choreography (build profiles, channel mapping)**: `../deployment/03_EAS_Build_and_Update_Channels.md` — the runtime channel used by `expo-constants` (`extra.eas.channel`) is baked into the binary at build time per this file's §3 (Build profiles)
- **Commercial download hub (deep-link entry point on the marketing site)**: `../product/04_Download_Hub.md` — the public download page that links to the TestFlight invite (iOS) and the Vercel Blob APK mirror (Android)

---

## 11. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), touch targets annotated `↑ 44×44px hit area (§10.2)`, safe-area insets annotated `↑ env(safe-area-inset-bottom)` per `§4.3`, cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (60–80 for mobile-screen mockups). The three mockups below visualise the *navigation primitives* — the custom glass tab bar, the stack-navigator tree, and the sync drawer sheet — that the five-screen doctrine (P2) renders on the mobile surface.

### 11.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **navigation + state layer** — the live-screen chrome (tab bar, headers, modal sheets) that the tutor interacts with every session. Unlike `01_Architecture.md` and `02_Native_Modules_and_Storage.md` (whose mockups are structural diagrams), the mockups below **are** rendered UI surfaces, so every one carries a glass-tier annotation (per `§5.5`) and every interactive control carries a neumo-recipe annotation (per `§6.6`). The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — is enforced inline below; the tab bar is `.glass-strong` (surface), each tab is `.neumo-raised` on tap-down (control), and the sync drawer is `.glass-strong` over a `bg-black/60` backdrop (surface).

| Navigation artefact (this file) | Glass tier (surface) | Neumo recipe (control) | Where rendered |
|---|---|---|---|
| §3 Custom glass tab bar | `.glass-strong` (bar) + safe-area inset | `.neumo-raised` (active pill on press) | `app/(tabs)/_layout.tsx` |
| §2.2 Five-tab surface map | transparent screen container | (n/a) | each tab's `.tsx` |
| §2.3.2 Modal anatomy | `.glass-strong` (sheet) + backdrop | `.neumo-raised` (Save CTA), `.neumo-inset` (form fields) | `app/(modal)/_layout.tsx` |
| §7 Header bar | `.glass-strong` (sticky) | `.neumo-raised` (overflow ⋯ button) | `src/components/Header.tsx` |
| §3 Sync drawer (below) | `.glass-strong` (sheet) + backdrop | `.neumo-raised` (Sync Now CTA) | `src/components/SyncDrawer.tsx` |
| Login form (§2.1.1) | transparent over cosmic canvas | `.neumo-inset` (email/password wells), `.neumo-raised` (Sign in CTA) | `app/(auth)/login.tsx` |

### 11.2 Custom Glass Tab Bar — 5 Tabs + Safe-Area (NEW)

The §3.1 tab bar anatomy rendered as the live mobile surface. Five tabs only (P2, Rule 4); the active tab carries a 2px accent bar that slides via Reanimated `withSpring` (250ms, damping 0.8). The bar floats above the cosmic canvas at `.glass-strong` (8% white, 24px blur on iOS via `expo-blur`; translucent overlay on Android per `01_Architecture.md` §8.2). The bottom padding is `max(env(safe-area-inset-bottom), 8px)` so the home indicator never underlaps the tab bar (`§4.3`). No central "+" tab (`BR-UI-02`).

```
  CUSTOM GLASS TAB BAR  (5 tabs, mobile-only, P2 + BR-UI-02)
  ┌────────────────────────────────────────────────────────────────────┐
  │  :  active tab content pane (transparent over cosmic canvas)  :    │
  │  :  ↑ screen container is NOT glass — only its cards are         :  │
  │  :    (.glass KPI cards, .glass-faint list rows) per §5.5        :  │
  │  :                                                              :  │
  │  :  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ :  │
  │  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  │
  │  │ ▒ .glass-strong bar  (8% white, 24px blur, §5.2, §5.5)        ▒ │  │
  │  │ ▒ ┌────────────────────────────────────────────────────────┐ ▒ │  │
  │  │ ▒ │ ▓▓▓▓  ← 2px emerald active indicator (Reanimated slide) │ ▒ │  │
  │  │ ▒ │ ┌──────┬──────┬──────┬──────┬──────┐                    │ ▒ │  │
  │  │ ▒ │ │  ◉   │  ◉   │  ◉   │  ◉   │  ◉   │  ← icons (22px)    │ ▒ │  │
  │  │ ▒ │ │ Dash │ Stud │ Attd │ Fees │ Sett │  ← labels (10px)   │ ▒ │  │
  │  │ ▒ │ └──────┴──────┴──────┴──────┴──────┘                    │ ▒ │  │
  │  │ ▒ │ ↑ each tab is flex-1 in h-16 (64px) bar                  │ ▒ │  │
  │  │ ▒ │ ↑ ↑ 44×44px hit area (§10.2, AGENTS.md §3.8)             │ ▒ │  │
  │  │ ▒ │ ↑ ↑ env(safe-area-inset-bottom) — home indicator never   │ ▒ │  │
  │  │ ▒ │     underlaps the bar (§4.3)                              │ ▒ │  │
  │  │ ▒ │ ↑ active tint: emerald (Dash), cyan (Stud/Attd),          │ ▒ │  │
  │  │ ▒ │   emerald (Fees), violet (Sett) — per §3 table            │ ▒ │  │
  │  │ ▒ │ ↑ inactive tint: rgba(255,255,255,0.40)                   │ ▒ │  │
  │  │ ▒ │ ↑ NO central "+", NO 6th tab (BR-UI-02, P2, Rule 4)       │ ▒ │  │
  │  │ ▒ │ ↑ Haptics.impactAsync(LIGHT) on tab change (§3.4)         │ ▒ │  │
  │  │ ▒ │ ↑ active pill on :press = .neumo-raised (control, §6.6)   │ ▒ │  │
  │  │ ▒ └────────────────────────────────────────────────────────┘ ▒ │  │
  │  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  │
  │  └────────────────────────────────────────────────────────────────┘
   ↑ The bar is .glass-strong (surface, §5.5); each tab Pressable is a
     control — on :active it gains .neumo-raised shadow (§6.6).
   ↑ Border-top: 1px rgba(255,255,255,0.08) — the §5.2 glass border recipe.
   ↑ iOS: BlurView intensity=32 tint="dark" (expo-blur); Android falls back
     to bg-black/40 translucent overlay (no real blur — §8.2 of 01_Arch).
   ↑ Active indicator slides between tab positions via withSpring(250ms,
     dampingRatio=0.8) on the UI thread — Reanimated worklet (§7.1).
   ↑ Touch target math: h-16 (64px) bar ÷ 5 tabs = 75px wide × 64px tall;
     every tab exceeds the 44×44px floor (§10.2).
   ↑ Cross-refs: §3 (this file), 01_Architecture.md §3 (five-tab map),
     13_UI_Guidelines.md §5.5 (glass-strong tier), §6.6 (neumo-raised),
     §4.3 (safe-area insets), §10.2 (44px touch targets), BR-UI-02 (no +),
     BR-UI-07 (persistent shell across tab switches).
```

### 11.3 Stack-Navigator Tree (NEW)

The §1 navigation architecture rendered as the actual route tree expo-router compiles. Three route groups (`(auth)` / `(tabs)` / `(modal)`) are mounted under one root `Stack` whose provider stack (QueryClient, Reanimated, MMKV, Fonts, SplashGate) is mounted **once** at root and survives every navigation. A nested `Stack` inside `(modal)` is a stop-and-ask trigger (`AGENTS.md` §5); the maximum depth is 2 (tab + modal) per P2.

```
  STACK-NAVIGATOR TREE  (expo-router v4, §1 + §4 of 01_Architecture.md)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  ROOT  _layout.tsx  (mounted once; provider stack lives here)            │
  │   ├─ <QueryClientProvider client={queryClient}>                          │
  │   ├─ <ReanimatedProvider>                                                │
  │   ├─ <SplashGate>  ← fonts + MMKV + auth + SQLite all ready, §8          │
  │   └─ <Stack screenOptions={{ headerShown: false }}>                      │
  │       │                                                                  │
  │       ├─ (auth) group  ← no tab bar; full-screen; bg #000 (§2.1)        │
  │       │   └─ <Stack presentation="fullScreenModal">                      │
  │       │       ├─ login.tsx        ← buddysaradhi://login                      │
  │       │       │   ↑ .neumo-inset email/password wells (§6.6)             │
  │       │       │   ↑ .neumo-raised Sign in CTA — emerald glow             │
  │       │       │   ↑ .glass outline "Continue with Google"                │
  │       │       ├─ unlock.tsx       ← buddysaradhi://unlock                     │
  │       │       │   ↑ biometric prompt auto-fires if bio_enabled=1         │
  │       │       │   ↑ .neumo-inset PIN sheet on fallback (BR-SEC-03)       │
  │       │       └─ setup-pin.tsx    ← first-run, ≥6 digits (BR-SEC-05)    │
  │       │                                                                  │
  │       ├─ (tabs) group  ← 5-tab shell; .glass-strong tab bar (§3)        │
  │       │   └─ <Tabs tabBar={TabBar}>                                      │
  │       │       ├─ dashboard.tsx    ← Emerald · 04_Dashboard.md            │
  │       │       ├─ students.tsx     ← Cyan · 05_Students.md                │
  │       │       ├─ attendance.tsx   ← Cyan · 06_Attendance.md              │
  │       │       ├─ fees.tsx         ← Emerald · 07_Fees_and_Payments.md    │
  │       │       └─ settings.tsx     ← Violet · 08_Settings.md              │
  │       │           ↑ each tab renders its own header via §7 Header.tsx    │
  │       │           ↑ header = .glass-strong sticky (BR-UI-07)             │
  │       │                                                                  │
  │       └─ (modal) group  ← sheet modals; depth ≤ 2 (P2, §2.3.1)          │
  │           └─ <Stack presentation="formSheet" (iOS) / "modal" (Android)>  │
  │               ├─ record-payment.tsx   ← BR-LED-01 + BR-SYN-01            │
  │               ├─ add-student.tsx      ← BR-STU-01 + BR-RC-02             │
  │               ├─ mark-attendance.tsx  ← BR-ATT-07 lock check             │
  │               ├─ student-detail.tsx   ← read-only, deep-link target      │
  │               └─ void-receipt.tsx     ← BR-LED-04 + BR-SEC-04 challenge  │
  │                   ↑ .glass-strong sheet + bg-black/60 backdrop (§5.5)    │
  │                   ↑ .neumo-raised "Confirm Void" CTA (flare accent)      │
  │                   ↑ .neumo-inset reason field                            │
  │                                                                          │
  │  DEPTH INVARIANTS                                                        │
  │   ↑ Max depth from a tab = 1 modal (P2, §2.3.1).                         │
  │   ↑ Nested Stack inside (modal) = stop-and-ask (AGENTS.md §5 trigger #17)│
  │   ↑ Lint rule no-nested-modal rejects such PRs.                          │
  │   ↑ Preferred 2nd-action pattern: router.dismiss() then router.push()    │
  │     in the same tick (close first modal, open second).                   │
  └────────────────────────────────────────────────────────────────────────┘
   ↑ The tree is structural, not a rendered surface — but each leaf route's
     chrome (tab bar, header, sheet) IS a live surface and carries the
     glass/neumo annotations shown inline above.
   ↑ Cross-refs: §1 + §2 (this file), 01_Architecture.md §4 (route groups),
     13_UI_Guidelines.md §5.5 (glass-strong for sheets + headers), §6.6
     (neumo-inset for form fields, neumo-raised for CTAs).
```

### 11.4 Sync Drawer Sheet (NEW)

The §5.3 sync drawer rendered as the live bottom sheet that slides up when the tutor taps the sync chip in the header. Four sync states (synced / syncing / pending / failed) plus a conflicts list with per-row resolve actions. The drawer is `.glass-strong` over a `bg-black/60 + backdrop-blur-sm` backdrop (`§5.5` modal tier); each conflict row is a `.glass-faint` band (`§5.5` list-row tier); the "Sync Now" CTA is `.neumo-raised` (`§6.6`). Toasts are NOT used for sync state — the chip is the persistent indicator, the drawer is the detail (P12 — minutes-per-day).

```
  SYNC DRAWER SHEET  (slides up from sync chip tap, §5.3 + §8 of this file)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  backdrop: bg-black/60 + backdrop-blur-sm (§5.5) ▓│
  │  ▓                  ↑ dims + blurs the screen beneath the sheet   ▓│
  │  ▓                                                                ▓│
  │  ▓   ┌──────────────────────────────────────────────────────────┐ ▓│
  │  ▓   │  ── grabber (iOS) ──                                      │ ▓│
  │  ▓   │  ↑ .glass-strong sheet (8% white, 24px blur, §5.2, §5.5) │ ▓│
  │  ▓   │  ↑ border-radius: 24px top, slide-up 240ms ease-out-quart│ ▓│
  │  ▓   │                                                            │ ▓│
  │  ▓   │  Sync                              [ ✕ Close ]             │ ▓│
  │  ▓   │  ─────────────────────────────────────────────────────────│ ▓│
  │  ▓   │                                                            │ ▓│
  │  ▓   │  ● Synced — last sync 2 minutes ago                        │ ▓│
  │  ▓   │   ↑ emerald dot (§2.4 accent); "synced 2m ago"             │ ▓│
  │  ▓   │   ↑ OR: ◐ Syncing… 23 of 47 rows pushed   (cyan, animated)│ ▓│
  │  ▓   │   ↑ OR: ○ Offline — 14 rows pending       (amber, count)   │ ▓│
  │  ▓   │   ↑ OR: ✕ Sync failed — tap to retry      (flare)          │ ▓│
  │  ▓   │   ↑ state stored in useSyncStore (Zustand, §8.1)           │ ▓│
  │  ▓   │                                                            │ ▓│
  │  ▓   │  ─────────────────────────────────────────────────────────│ ▓│
  │  ▓   │                                                            │ ▓│
  │  ▓   │  Conflicts (3)                                             │ ▓│
  │  ▓   │  ┌──────────────────────────────────────────────────────┐ │ ▓│
  │  ▓   │  │ ▒ .glass-faint band (2% white, 8px blur, §5.5)       │ │ ▓│
  │  ▓   │  │ ▒  Payment RCP-2025-000042 — duplicate from another  │ │ ▓│
  │  ▓   │  │ ▒    device                                            │ │ ▓│
  │  ▓   │  │ ▒  [ View ]  [ Void ]  [ Dismiss ]                     │ │ ▓│
  │  ▓   │  │ ▒   ↑ each button .neumo-raised (§6.6), 44×44px (§10.2)│ │ ▓│
  │  ▓   │  │ ▒   ↑ "Void" gains flare accent (destructive)         │ │ ▓│
  │  ▓   │  └──────────────────────────────────────────────────────┘ │ ▓│
  │  ▓   │  ┌──────────────────────────────────────────────────────┐ │ ▓│
  │  ▓   │  │ ▒ .glass-faint band                                    │ │ ▓│
  │  ▓   │  │ ▒  Student Aarav Sharma — name updated elsewhere      │ │ ▓│
  │  ▓   │  │ ▒  Local: "Aarav Sharma" · Remote: "Aarav S. Sharma"  │ │ ▓│
  │  ▓   │  │ ▒  [ Keep Local ]  [ Take Remote ]  [ View Audit ]    │ │ ▓│
  │  ▓   │  │ ▒   ↑ LWW resolve (BR-SYN-03) — audit row written     │ │ ▓│
  │  ▓   │  └──────────────────────────────────────────────────────┘ │ ▓│
  │  ▓   │                                                            │ ▓│
  │  ▓   │  ─────────────────────────────────────────────────────────│ ▓│
  │  ▓   │                                                            │ ▓│
  │  ▓   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │ ▓│
  │  ▓   │  │ Sync Now     │  │ Pause sync   │  │ Diagnostics      │ │ ▓│
  │  ▓   │  └──────────────┘  └──────────────┘  └──────────────────┘ │ ▓│
  │  ▓   │   ↑ .neumo-raised    ↑ .neumo-raised   ↑ .neumo-raised     │ ▓│
  │  ▓   │   ↑ emerald glow     ↑ amber accent    ↑ cyan accent       │ ▓│
  │  ▓   │   ↑ 44×44px each (§10.2)                                │ ▓│
  │  ▓   │   ↑ env(safe-area-inset-bottom) padding (§4.3)           │ ▓│
  │  ▓   └──────────────────────────────────────────────────────────┘ ▓│
  │  ▓                                                                ▓│
  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
  └──────────────────────────────────────────────────────────────────────┘
   ↑ Toasts are NOT used for sync state (would be noisy, break P12); the
     chip in the header is the persistent indicator, this drawer is the
     detail surface.
   ↑ Haptics on state change (§8.2): Syncing→Synced fires SUCCESS only if
     >10 rows pushed; Syncing→Failed fires ERROR always.
   ↑ The drawer is the ONLY place sync errors surface — silent failures
     elsewhere are a P1 bug (Rule 9).
   ↑ Cross-refs: §5.3 + §8 (this file), 04_Offline_Sync_and_Conflict_
     Resolution.md §5.3 (sync drawer contract), 13_UI_Guidelines.md §5.5
     (glass-strong for modal/sheet), §6.6 (neumo-raised for CTA buttons),
     §4.3 (safe-area), §10.2 (44px touch targets), BR-SYN-03 (LWW), P12.
```

### 11.5 References (External Design Authorities)

The mockups and the navigation primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the tab-bar anatomy, the modal stack depth limit, or the sync drawer pattern.

- **React Navigation docs** — *Bottom Tabs, Stack Navigator, Modal presentation*. The §3 custom glass tab bar and the §2.3 modal anatomy follow React Navigation's bottom-tabs + stack documentation, adapted for expo-router v4's file-based convention.
- **Expo docs** — *expo-router v4, route groups, deep linking*. The §1 stack-navigator tree and the §6 deep-linking config follow Expo's expo-router documentation.
- **Apple Human Interface Guidelines** — *Mobile, tab bars, sheets, safe-area insets, 44px touch targets*. The §11.2 tab bar (`.glass-strong` + safe-area inset), the §11.4 sheet (formSheet presentation + grabber), and the 44×44px hit-area floor follow Apple HIG's mobile-surface guidance.
- **Material Design 3** — *Bottom navigation, sheets, Android back gesture*. The §11.2 five-tab bar and the §5 Android back-button "press back again to exit" pattern follow Material 3's navigation guidance.
- **Smashing Magazine** — *Mobile UX: Bottom Tab Bars, Sheet Modals*. The §11.4 sync drawer sheet (`.glass-strong` over `bg-black/60` backdrop) follows Smashing's mobile sheet-modal research.
- **CSS-Tricks** — *`env(safe-area-inset-*)` on mobile*. The §11.2 `max(env(safe-area-inset-bottom), 8px)` padding and the §11.4 drawer's safe-area footer follow CSS-Tricks's `env()` primer.
- **Nielsen Norman Group** — *Mobile Navigation: Tab Bars vs. Hamburger Menus*. The §3.1 "bottom tab, not sidebar" rationale and the §3.2 "no central + tab" decision follow NN/g's mobile-navigation research.

---

*End of 03 — Navigation and State. Next file: `04_Offline_Sync_and_Conflict_Resolution.md`.*
