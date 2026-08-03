# 02 — Native Modules and Storage

> The deep dive on every native module the Buddysaradhi mobile app uses, and the storage layer that backs it. Local `expo-sqlite` mirrors the Prisma/Turso schema from `11_Data_Model.md`; libSQL HTTP client is the remote sync transport; `expo-secure-store` holds the Turso scoped JWT biometric-protected; `expo-local-authentication` provides FaceID/TouchID; `expo-haptics` fires on every `BR-*` state transition; `expo-file-system` + `expo-sharing` handle encrypted `.buddysaradhi` backups; `expo-notifications` schedules the six reminder types. This file is the storage and native-bridge engineer's manual. For the sync protocol itself (outbox flush, conflict resolution, backoff), see `04_Offline_Sync_and_Conflict_Resolution.md`.

---

## 1. Storage Architecture at a Glance

The mobile app has **three** storage tiers. Each has a single, non-overlapping responsibility. Crossing them is a P1 bug.

```
┌─────────────────────────────────────────────────────────────────┐
│                      MOBILE STORAGE TIERS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tier 1 — expo-sqlite (local SQLite)                            │
│  ─────────────────────────────────────                          │
│  Path: FileSystem.documentDirectory + 'buddysaradhi.db'              │
│  Role:  Source of truth for reads; first write target           │
│         for every mutation (offline-first, P5).                 │
│  Schema: Mirrors migrations/*.sql applied to Turso              │
│         (11_Data_Model.md).                                     │
│  Size:  Typically 2–20 MB per tutor (200 students).             │
│                                                                 │
│  Tier 2 — react-native-mmkv (UI state)                          │
│  ─────────────────────────────────────                          │
│  Path: MMKV default instance (encrypted)                        │
│  Role:  Zustand store persistence — UI preferences, last        │
│         active tab, dashboard filter state. Never business      │
│         data. Never money.                                      │
│  Size:  < 100 KB total.                                         │
│                                                                 │
│  Tier 3 — expo-secure-store (secrets)                           │
│  ─────────────────────────────────────                          │
│  Path: iOS Keychain / Android Keystore                          │
│  Role:  Turso scoped JWT, biometric-protected.                  │
│         Never business data. Never UI state.                    │
│  Size:  < 4 KB total (Keychain item value limit).               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Invariants:**

1. The Turso JWT is **only** in `expo-secure-store`. A startup probe `assertNoPlaintextToken` scrubs and re-auths if the token is detected in MMKV, AsyncStorage, or `expo-file-system` plaintext files (`10_Security.md` §2.3).
2. Money is **only** in `expo-sqlite` (and the encrypted backup blob derived from it). Never in MMKV.
3. UI state is **only** in MMKV. Never in SQLite (would corrupt the schema mirror).
4. The encrypted backup `.buddysaradhi` envelope is derived from SQLite only — MMKV and SecureStore are **not** included in backups. They are device-local.

---

## 2. expo-sqlite — Local Schema Mirror

`expo-sqlite` (v14, the new synchronous-flavored API with `openDatabaseAsync`) provides a per-app SQLite database. We use it as the **local replica** of the per-user Turso DB.

### 2.1 Database File Location

```ts
import * as FileSystem from 'expo-file-system';
import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

const DB_PATH = `${FileSystem.documentDirectory}buddysaradhi.db`;

export async function openDB(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(DB_PATH);
  await db.execAsync(`PRAGMA foreign_keys = ON;`);
  await db.execAsync(`PRAGMA journal_mode = WAL;`);
  await db.execAsync(`PRAGMA synchronous = NORMAL;`);
  return db;
}
```

- `PRAGMA foreign_keys = ON` enforces the FK constraints from `11_Data_Model.md` §3 (`attendance_records.session_id` → `attendance_sessions`, etc.).
- `PRAGMA journal_mode = WAL` enables write-ahead logging, so reads do not block writes. This is critical for the sync engine flushing the outbox while the UI is reading.
- `PRAGMA synchronous = NORMAL` is a small durability tradeoff for a 2x write speedup. Acceptable because every mutation is also queued in `sync_outbox` for remote replication — the local DB is a cache, not the only copy.

> **Two-layer DB architecture — ORM discipline.** Buddysaradhi mobile has two distinct database layers, each with its own access discipline:
> 1. **On-device local SQLite** (`expo-sqlite` / `react-native-quick-sqlite` + SQLCipher) — accessed via the native SQLite driver (`db.execAsync`, `db.runAsync`, `db.getAllAsync`). This layer uses parameterised SQL statements (never string-concatenated) for the local cache. The `PRAGMA` calls above are SQLite connection-init commands with no ORM equivalent; they run ONCE at DB open. All app-level local queries go through typed helper functions in `lib/mobile/db/` (e.g. `localStudentRepo.findMany()`, `localLedgerRepo.create()`) that internally use parameterised `db.runAsync(sql, params)` — no string concatenation, no injection surface.
> 2. **Remote sync layer** (Turso/libSQL via Prisma Client) — accessed via `import { db } from '@/lib/db'` using **Prisma ORM methods only** (`findMany`, `create`, `aggregate`, `$transaction`, etc.). No `$queryRaw` / `$executeRaw` / raw SQL strings at runtime on the sync layer.
>
> The `no-raw-sql-in-sync-layer.test.ts` CI lint enforces that no file under `lib/sync/` or `app/api/` imports `$queryRaw` / `$executeRaw`. Local-device SQL (layer 1) is exempt because it is a different driver (native SQLite, not Prisma) — but it is confined to `lib/mobile/db/` repos that use parameterised statements exclusively.

### 2.2 Schema Mirror — Exact Parity with Turso

The local SQLite schema is **byte-for-byte identical** to the Turso per-user DB schema. Both are produced by the same `migrations/` directory (`AGENTS.md` (top-level) §3.3). The migration runner:

```ts
import { SQLiteDatabase } from 'expo-sqlite';

const SCHEMA_VERSION_KEY = 'schema_version';

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const current = await db.getFirstAsync<{ v: number }>(
    `SELECT v FROM app_meta WHERE k = ?`,
    [SCHEMA_VERSION_KEY]
  );
  const currentVersion = current?.v ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync(
        `INSERT INTO app_meta (k, v) VALUES (?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
        [SCHEMA_VERSION_KEY, migration.version]
      );
    });
  }
}
```

`MIGRATIONS` is imported from `migrations/index.ts`, which is the **same** file the web app's Supabase Edge Function uses to bootstrap a new Turso DB. This guarantees local and remote schemas never drift.

### 2.3 Tables Mirrored

Every table in `11_Data_Model.md` §4 exists in local SQLite:

| Table | Purpose | Trigger |
|---|---|---|
| `settings` | Singleton — tenant profile, sequences, locks | — |
| `tutors` | Multi-tutor coaching institutes | — |
| `batches` | Batch metadata + schedule | — |
| `students` | Student master + lifecycle | `trg_students_dup_key` |
| `attendance_sessions` | One row per (batch, date) | `trg_attendance_no_update_after_lock` |
| `attendance_records` | Per-student attendance marks | `trg_attendance_records_lock_check` |
| `fee_plans` | Plan definition | — |
| `fee_schedule_items` | Generated schedule items | — |
| `invoices` | Generated invoices | `trg_invoice_tamper_hash` |
| `ledger_entries` | **Append-only** financial spine | `trg_ledger_no_update`, `trg_ledger_no_delete`, `trg_ledger_hash_chain` |
| `receipts` | 1:1 with PAYMENT_RECEIVED | `trg_receipt_tamper_hash` |
| `audit_log` | **Append-only** audit trail | `trg_audit_log_no_update_delete` |
| `sync_outbox` | Outbox queue for remote replication | `trg_sync_outbox_payload_immutable` |
| `backup_manifest` | Backup metadata | — |
| `reminders` | Generated reminders | — |
| `notifications` | FIFO ≤200 in-app notifications | — |
| `app_state` | Singleton — schema version, tenant secret, vector clock | — |
| `app_meta` | KV store for migration runner | — |

The three append-only tables (`ledger_entries`, `audit_log`, `sync_outbox.payload`) carry triggers that abort any `UPDATE` or `DELETE` attempt at the SQLite layer. These triggers are **identical** to the ones in Turso (`11_Data_Model.md` §3.10) — same SQL, same names, same error messages.

### 2.4 The Local-First Write Path

Every mutation follows this sequence (per `BR-SYN-01` and `12_Business_Rules.md` §9):

```
┌────────────────────────────────────────────────────────────────┐
│  User taps "Record Payment" (₹5,000)                           │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  1. Zod-validate the form input (StudentPaymentSchema)         │
│     → throws on invalid                                        │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  2. Open SQLite transaction (db.withTransactionAsync)          │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  3. INSERT INTO ledger_entries (UUID v7, amount=500000,        │
│        direction='credit', type='PAYMENT_RECEIVED')            │
│     → trigger trg_ledger_hash_chain computes this_hash         │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  4. INSERT INTO receipts (number = 'RCP-' + zero-pad(seq),     │
│        tamper_hash = sha256(...))                              │
│     → settings.next_receipt_seq incremented atomically         │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  5. INSERT INTO sync_outbox (payload = JSON of the mutation,   │
│        status='pending', retries=0)                            │
│     → trigger trg_sync_outbox_payload_immutable makes payload  │
│       read-only after insert                                   │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  6. INSERT INTO audit_log (action='payment_recorded', ...)     │
│     → trigger guards append-only                              │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  7. COMMIT transaction                                         │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  8. Haptics.notificationAsync(SUCCESS)                         │
│  9. Toast: "₹5,000 recorded · RCP-000043"                      │
│ 10. UI optimistically shows new balance                        │
│ 11. Sync engine drains outbox row in background                │
└────────────────────────────────────────────────────────────────┘
```

The UI **never** waits on the network. Steps 1–10 happen synchronously (~50ms total on a mid-tier device). Step 11 happens later, possibly much later (EC-SY-01: 72-hour offline session).

### 2.5 Read Path

All reads go to local SQLite. There is no "fetch from server first" path — the local DB is always the source of truth for the UI. The sync engine, when it pulls remote changes, writes them into local SQLite, and the UI re-renders via TanStack Query cache invalidation.

```ts
import { useQuery } from '@tanstack/react-query';

export function useStudentBalance(studentId: string) {
  return useQuery({
    queryKey: ['student', studentId, 'balance'],
    queryFn: async () => {
      const db = await getDB();
      const row = await db.getFirstAsync<{
        balance_paise: number;
        last_payment_at: string | null;
      }>(`
        SELECT
          COALESCE(SUM(CASE WHEN direction='charge' AND type<>'VOID' AND reverses_entry_id IS NULL
                            THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN direction='credit' AND type<>'VOID' AND reverses_entry_id IS NULL
                            THEN amount ELSE 0 END), 0) AS balance_paise,
          MAX(CASE WHEN type='PAYMENT_RECEIVED' THEN occurred_on END) AS last_payment_at
        FROM ledger_entries
        WHERE student_id = ?
      `, [studentId]);
      return row;
    },
    staleTime: 30_000, // local SQLite is fast; refetch on focus
  });
}
```

The `BR-RPT-04` formula (`balance_due = Σ(charges) − Σ(credits)`) is the **only** place this calculation is allowed to live (`12_Business_Rules.md` §13). Re-implementing it elsewhere is a P1 bug.

---

## 3. libSQL HTTP Client — Remote Sync Transport

The remote Turso DB is reached via `@libsql/client`'s HTTP transport. We do **not** use the WebSocket / embedded-replica mode — that requires a persistent connection and is overkill for a single-user tutor DB. HTTP polling every 30s (when online) is the right cadence.

### 3.1 Why HTTP, Not WebSocket?

| Concern | HTTP polling | WebSocket / embedded replica |
|---|---|---|
| Connection state | Stateless — each request independent | Persistent — reconnect logic, backoff, heartbeat |
| Battery | One request per 30s = negligible | Persistent socket keeps radio awake |
| Offline behaviour | Naturally degrades — just stop polling | Requires explicit disconnect/reconnect |
| Complexity | One `fetch` per cycle | Background service, message queue, dedup |
| Latency | ≤ 1s per request | ≤ 100ms per push |
| Adequate for tutor DB? | **Yes** — single user, low write rate | No — overkill |

A tutor writes maybe 50 rows/day. The 30s polling interval catches a remote write within one cycle, which is well within the tutor's perception of "instant." WebSocket would buy us nothing and cost battery.

### 3.2 Client Initialisation

```ts
import { createClient, Client } from '@libsql/client';

let client: Client | null = null;

export async function getTursoClient(): Promise<Client> {
  if (client) return client;

  const token = await SecureStore.getItemAsync('turso_jwt', {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    authenticationPrompt: { title: 'Authenticate to access Buddysaradhi cloud sync' },
  });
  if (!token) throw new Error('No Turso JWT in SecureStore — re-login required');

  const url = await MMKV.getStringAsync('turso_url');
  if (!url) throw new Error('No Turso URL in MMKV — provisioning incomplete');

  client = createClient({
    url,
    authToken: token,
    fetchOptions: { timeout: 10_000 },
  });
  return client;
}
```

The client is a singleton — recreated only when the user logs out and back in. The token is **never** held in JS memory beyond the client's internal closure; `getTursoClient` re-reads from SecureStore only on first init.

### 3.3 What Goes Over the Wire

The libSQL client is used in two ways:

1. **Push** (outbox drain): each `sync_outbox` row's `payload` is replayed against Turso. The payload is the verbatim SQL + bind params of the original local mutation. See `04_Offline_Sync_and_Conflict_Resolution.md` §3 for the drain loop.
2. **Pull** (server changes): the client sends `SELECT * FROM <table> WHERE updated_at > ?` for each table, with the last-seen timestamp. The result is written into local SQLite. See `04_Offline_Sync…md` §4.

We do **not** use libSQL's `SELECT` for the UI's reads — those always go to local SQLite. libSQL is only used by the sync engine.

### 3.4 Error Handling

Every libSQL call returns a `Result<T, E>` (`AGENTS.md` (top-level) §6.1). No throw-on-error. The sync engine handles each error type explicitly:

| Error | Action |
|---|---|
| Network timeout | Retry with exponential backoff (§5) |
| 401 Unauthorized (token expired) | Re-authenticate via Supabase; if that fails, prompt re-login |
| 409 Conflict (LWW violation) | Run merge strategy (§4) |
| 426 Upgrade Required (schema drift) | Pause sync; prompt user to update app (`EC-SY-08`) |
| 5xx | Retry with backoff; surface "Sync degraded" in UI after 3 fails |
| SQL parse error (client bug) | Mark outbox row `status='conflict'`; surface in Sync drawer |

---

## 4. expo-secure-store — The Turso JWT

The Turso scoped JWT is the **only** credential that crosses the device boundary. It lives in `expo-secure-store`, which on iOS uses Keychain Services and on Android uses the Keystore (specifically, the `AndroidKeyStore` provider with `setUserAuthenticationRequired(true)` on API 23+).

### 4.1 Storage API

```ts
import * as SecureStore from 'expo-secure-store';

const JWT_KEY = 'turso_jwt';

export async function storeTursoJWT(jwt: string): Promise<void> {
  await SecureStore.setItemAsync(JWT_KEY, jwt, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    authenticationPrompt: {
      title: 'Authenticate to unlock Buddysaradhi cloud sync',
      subtitle: 'Your fingerprint confirms it is you.',
    },
  });
}

export async function readTursoJWT(): Promise<string | null> {
  return SecureStore.getItemAsync(JWT_KEY, {
    authenticationPrompt: { title: 'Authenticate to access Buddysaradhi cloud sync' },
  });
}

export async function wipeTursoJWT(): Promise<void> {
  await SecureStore.deleteItemAsync(JWT_KEY);
}
```

### 4.2 Access Policy

- `WHEN_UNLOCKED_THIS_DEVICE_ONLY` — the token is readable only when the device is unlocked, and is **not** synced to iCloud Keychain or other devices. This is the most restrictive option that still allows background fetch.
- `authenticationPrompt` — on devices with biometrics, reading the token triggers a `LocalAuthentication` challenge. The user sees "Authenticate to access Buddysaradhi cloud sync." This is the security boundary for sync.
- **No `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`** — that option would allow background access without biometrics, which violates `BR-SEC-01` (the app must re-lock after `session_timeout_min`).

### 4.3 Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  Signup (web or mobile)                                          │
│   ↓                                                              │
│  Supabase Auth → provision-db Edge Function → Turso DB created   │
│   ↓                                                              │
│  Scoped JWT returned in user_metadata                            │
│   ↓                                                              │
│  Mobile: storeTursoJWT(jwt)  ← biometric-protected              │
│  Mobile: MMKV.setString('turso_url', url) ← not sensitive       │
│                                                                  │
│  ─── First app launch after signup ───                           │
│   ↓                                                              │
│  Biometric challenge → readTursoJWT() → getTursoClient()         │
│   ↓                                                              │
│  Schema bootstrap: runMigrations(db) locally + on Turso          │
│   ↓                                                              │
│  Dashboard empty-state                                           │
│                                                                  │
│  ─── Logout / Revoke sessions (BR-SEC-10) ───                    │
│   ↓                                                              │
│  wipeTursoJWT() + MMKV.clearAll() + drop local SQLite file      │
│   ↓                                                              │
│  Redirect to (auth)/login                                        │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 What Else Lives in SecureStore?

**Nothing else.** Only the Turso JWT. The PIN is stored as `argon2id` hash in the `settings` table inside SQLite (`10_Security.md` §3.4) — never in SecureStore. The backup passphrase is likewise a hash in `settings`, never in SecureStore. MMKV stores UI state, encrypted with a separate key, but not the Turso JWT.

---

## 5. Biometric Flow — `expo-local-authentication`

Biometrics (FaceID / TouchID / Android Biometric) is the **preferred** unlock method, per `10_Security.md` §3.3. PIN is the fallback.

### 5.1 Capability Check

```ts
import * as LocalAuthentication from 'expo-local-authentication';

export async function getBiometricCapabilities(): Promise<{
  available: boolean;
  enrolled: boolean;
  type: 'fingerprint' | 'face' | 'iris' | null;
}> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

  const typeMap: Record<number, 'fingerprint' | 'face' | 'iris'> = {
    1: 'fingerprint',
    2: 'face',
    3: 'iris',
  };

  return {
    available: hasHardware,
    enrolled: isEnrolled,
    type: supportedTypes.length > 0 ? typeMap[supportedTypes[0]] ?? null : null,
  };
}
```

### 5.2 The Unlock Challenge

The biometric flow is **two-layered**:

1. **App unlock** — `LocalAuthentication.authenticateAsync()` on app foreground if idle > `session_timeout_min`. On success, the app moves to `unlocked` state.
2. **SecureStore access** — when the sync engine needs the Turso JWT, `SecureStore.getItemAsync` triggers a second biometric prompt. This is the OS-level protection, independent of our app logic.

To avoid double-prompting, we cache the JWT in memory for 60 seconds after the first successful biometric unlock. The cache is wiped on `AppState` `background`. This is acceptable because the in-memory copy is in process memory only — never persisted, never written to disk.

### 5.3 Fallback to PIN

If biometric fails 3 times, or hardware is unavailable (`EC-SEC-02`), the app falls back to PIN entry:

```ts
export async function unlock(): Promise<UnlockResult> {
  // Try biometric first
  const bio = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock Buddysaradhi',
    fallbackLabel: 'Use PIN',
    cancelLabel: 'Cancel',
    disableDeviceFallback: true, // we handle PIN ourselves
  });

  if (bio.success) return { ok: true, method: 'biometric' };

  // Biometric failed or unavailable — show PIN screen
  const pinResult = await showPINSheet();
  if (!pinResult.ok) return { ok: false, error: 'pin_cancelled' };

  // Verify PIN
  const valid = await verifyPIN(pinResult.pin);
  if (!valid) {
    await trackFailedPIN();
    return { ok: false, error: 'pin_invalid' };
  }
  return { ok: true, method: 'pin' };
}
```

### 5.4 Lockout Per `BR-SEC-03`

Per `10_Security.md` §3.5:

| Consecutive PIN failures | Lockout |
|---|---|
| 1–2 | none (shake animation) |
| 3 | 60s |
| 4 | 120s |
| 5 | 240s |
| 6+ | 60s × 2^(n-3), capped at 24h |
| 10 cumulative | local cache wipe + audit `pin_lockout_wipe` + force Supabase re-login |

Biometric failures do **not** count toward PIN lockout — biometric has its own rate limit (iOS allows 3 attempts before requiring device passcode, Android similar).

### 5.5 Sensitive-Action Challenge (`BR-SEC-04`)

The following actions require a fresh biometric/PIN challenge **even when the app is already unlocked** (`12_Business_Rules.md` §10):

- Void a receipt (`BR-LED-04`)
- Unlock/edit a locked attendance session (`BR-ATT-08`)
- Post a backdated ledger entry (`BR-LED-07`)
- Bulk-delete students (`BR-STU-10`)
- Issue a fee waiver / writeoff (`BR-FEE-13`)
- Restore from `.buddysaradhi` backup (`BR-IMP-05`)
- Export full backup (`BR-SEC-04`)

The challenge is implemented as a hook:

```ts
export function useSensitiveAction() {
  return useCallback(async <T>(action: () => Promise<T>): Promise<Result<T, ChallengeError>> => {
    const result = await challenge(); // biometric or PIN
    if (!result.ok) return { ok: false, error: 'challenge_failed' };
    try {
      const data = await action();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: 'action_failed', cause: e };
    }
  }, []);
}
```

Every sensitive action writes an `audit_log` row **in the same transaction** as the mutation (`BR-SEC-08`). The audit row's `actor` is the verified user; `metadata` includes the biometric/PIN method and timestamp.

---

## 6. Haptics — `expo-haptics`

Haptic feedback is mandatory on every `BR-*` state transition (P11 — Security Is Tactile). A tutor's finger should feel whether the action succeeded, failed, or warned — without looking at the screen.

### 6.1 The Haptic Pattern Map

| `BR-*` rule | Haptic | When |
|---|---|---|
| `BR-LED-01` (ledger INSERT) | `notificationAsync(SUCCESS)` | Payment recorded |
| `BR-LED-04` (void) | `notificationAsync(WARNING)` | Receipt voided |
| `BR-ATT-07` (attendance lock) | `notificationAsync(SUCCESS)` + heavy `impactAsync` | Session locked |
| `BR-ATT-08` (unlock locked session) | `notificationAsync(WARNING)` | Unlock confirmed |
| `BR-FEE-13` (writeoff) | `notificationAsync(WARNING)` | Waiver posted |
| `BR-SEC-03` (PIN fail) | `notificationAsync(ERROR)` | Wrong PIN entered |
| `BR-SEC-04` (sensitive challenge success) | `impactAsync(MEDIUM)` | Biometric confirmed |
| `BR-SYN-03` (sync conflict) | `notificationAsync(WARNING)` | Conflict auto-resolved |
| `BR-BAT-02` (backup complete) | `notificationAsync(SUCCESS)` | `.buddysaradhi` written |
| Any mutation save | `impactAsync(LIGHT)` | Optimistic write committed |
| Any swipe commit (attendance, payment) | `impactAsync(LIGHT)` | Swipe past threshold |

### 6.2 Implementation

```ts
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo } from 'react-native';

export async function hapticNotify(
  kind: 'success' | 'warning' | 'error'
): Promise<void> {
  // Respect reduce-motion — but haptics are not motion, so we keep them.
  // Some users disable haptics via system setting; expo-haptics no-ops then.
  const map = {
    success: Haptics.NotificationFeedbackType.Success,
    warning: Haptics.NotificationFeedbackType.Warning,
    error: Haptics.NotificationFeedbackType.Error,
  } as const;
  await Haptics.notificationAsync(map[kind]);
}

export async function hapticImpact(
  style: 'light' | 'medium' | 'heavy' = 'light'
): Promise<void> {
  const map = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  } as const;
  await Haptics.impactAsync(map[style]);
}
```

Haptics fire on **commit**, not on tap-down. A tap-down that the user cancels (drags finger away before release) does not fire a haptic. This matches Apple HIG.

### 6.3 Disable Haptics?

Per `13_UI_Guidelines.md`, there is no in-app haptics toggle. We respect the system setting — on iOS, "System Haptics" in Settings; on Android, "Vibrate on tap" / "Haptic feedback" in Sound settings. If the user has disabled system haptics, `expo-haptics` is a no-op. We do **not** add our own toggle because P11 says security is tactile — if you disable haptics, you have opted out of the tactile security model and PIN becomes the only confirmation.

---

## 7. File System and Encrypted Backups — `expo-file-system` + `expo-sharing`

Backups follow `09_Backup_and_Import_Export.md` and `10_Security.md` §15 to the letter. The `.buddysaradhi` file is AES-256-GCM with an Argon2id-derived key (`BACKUP-1`). No plaintext fallback.

### 7.1 Backup File Location

```
FileSystem.documentDirectory
└── backups/
    ├── Buddysaradhi_2025-06-15_1430.buddysaradhi
    ├── Buddysaradhi_2025-06-22_0915.buddysaradhi
    └── ...
```

The `backups/` directory is created on first run with `FileSystem.makeDirectoryAsync(path, { intermediates: true })`. Backups older than 30 days are auto-pruned on app launch (the tutor can override in Settings → Backup).

### 7.2 The Crypto Envelope

```
.buddysaradhi file = {
  salt(16)        // Argon2id salt, random per backup
  nonce(12)       // AES-256-GCM nonce, random per backup
  tag(16)         // GCM auth tag
  ciphertext      // gzipped tar of:
                  //   - data.jsonl (all rows as NDJSON)
                  //   - schema_version.txt
                  //   - manifest.json (counts, sha256, created_at, tenant_id)
}
```

Argon2id parameters: `m=64MiB, t=3, p=2` (`10_Security.md` §15). The passphrase is ≥ 12 chars (`BR-SEC-06`). The key is derived in JS via `react-native-argon2` (a native module — adding it is a stop-and-ask trigger, but pre-approved by this spec).

### 7.3 Backup Flow

```
┌────────────────────────────────────────────────────────────────┐
│  Tutor taps "Back up now" in Settings → Backup                  │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  PIN/biometric challenge (BR-SEC-04 — sensitive action)         │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Passphrase prompt (≥ 12 chars, BR-SEC-06)                      │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Pause sync (advisory lock — EC-SY-04)                          │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  For each table in dependency order:                            │
│    SELECT * FROM <table> ORDER BY created_at                    │
│    Stream rows to NDJSON writer                                 │
│    Update manifest counts + running sha256                      │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  tar czf - data.jsonl schema_version.txt manifest.json          │
│  → gzipped tar blob                                              │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  salt = crypto.randomBytes(16)                                   │
│  key  = argon2id(passphrase, salt, {m:64MiB,t:3,p:2})           │
│  nonce = crypto.randomBytes(12)                                  │
│  { ciphertext, tag } = aes256gcm(key, nonce, tarBlob)           │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  file = salt || nonce || tag || ciphertext                       │
│  write to FileSystem.documentDirectory + 'backups/<name>.buddysaradhi'│
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  expo-sharing.shareAsync(file, { mimeType: 'application/octet-  │
│    stream', dialogTitle: 'Save or send your Buddysaradhi backup' })  │
│  → OS share sheet (Save to Files, Mail, AirDrop, WhatsApp…)     │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Haptics.notificationAsync(SUCCESS)                             │
│  audit_log row: action='backup_created', metadata={file, size} │
│  Resume sync                                                    │
└────────────────────────────────────────────────────────────────┘
```

### 7.4 Restore Flow

Restore is the highest-stakes operation (`BR-IMP-05`). It requires (a) PIN + passphrase challenge, (b) integrity check per `BR-IMP-02` (recompute sha256, compare to manifest, verify GCM auth tag), (c) schema-version check (refuse if backup schema_version > app schema_version, `EC-SY-08`).

```
┌────────────────────────────────────────────────────────────────┐
│  Tutor selects a .buddysaradhi file via OS document picker            │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Passphrase prompt                                               │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Read file → split salt || nonce || tag || ciphertext            │
│  key = argon2id(passphrase, salt)                                │
│  tarBlob = aes256gcmDecrypt(key, nonce, tag, ciphertext)         │
│  → if auth tag fails: toast "Wrong passphrase" + 60s lockout    │
│    after 5 fails (EC-SEC-06)                                     │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  untar → data.jsonl, schema_version.txt, manifest.json           │
│  recompute sha256(data.jsonl) — must match manifest.sha256       │
│  → if mismatch: refuse restore, toast "Backup corrupted"        │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  if backup.schema_version > app.schema_version:                 │
│    refuse — "Update Buddysaradhi to restore this backup"             │
│  if backup.schema_version < app.schema_version:                 │
│    run forward migrations on the in-memory data                 │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Confirm dialog: "This will REPLACE all current data. Type      │
│  RESTORE to confirm."                                            │
│  → user types RESTORE                                            │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Close current SQLite DB                                         │
│  Delete buddysaradhi.db                                               │
│  Reopen + runMigrations                                          │
│  For each NDJSON line: INSERT INTO <table> (...) VALUES (...)    │
│  Verify counts match manifest                                    │
│  Rebuild ledger hash chain (NightlyJob.verifyChain)              │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Haptics.notificationAsync(SUCCESS)                             │
│  audit_log row: action='backup_restored'                        │
│  Force sync flush (push local to Turso)                         │
└────────────────────────────────────────────────────────────────┘
```

### 7.5 `expo-keep-awake`

Long backups (a 200-student tutor's DB is ~20 MB; the Argon2id derivation alone is ~600ms) can take 5–15 seconds. We use `expo-keep-awake` to prevent the screen from sleeping mid-backup, which would cancel the operation on iOS.

```tsx
import { useKeepAwake } from 'expo-keep-awake';

function BackupScreen() {
  useKeepAwake();
  // ...
}
```

---

## 8. Notifications — `expo-notifications`

The mobile app schedules the six reminder types defined in `12_Business_Rules.md` §7 (`BR-REM-01..06`). All are **tutor obligations**, never engagement or marketing (`BR-REM-01`, `BR-REM-09`).

### 8.1 Reminder Types and Scheduling

| ID | Reminder | Trigger | Quiet hours | Snooze |
|---|---|---|---|---|
| `BR-REM-02` | Fee overdue | `fee_schedule_items.status` flips to `overdue` | 22:00–07:00 local | ≤ 3 times |
| `BR-REM-03` | Missing attendance | Scheduled batch day, no `attendance_sessions` row by 21:00 local | 22:00–07:00 local | Once, to "tomorrow" |
| `BR-REM-04` | Inactive student (14 days) | Weekly scan | 22:00–07:00 local | ≤ 3 times |
| `BR-REM-05` (Critical) | Quiet hours enforcement | Always-on rule | — | — |
| `BR-REM-06` | Snooze cap | After 3rd snooze | — | — |
| `BR-REM-08` | Share via WhatsApp | On user action | — | — |

### 8.2 Scheduling API

```ts
import * as Notifications from 'expo-notifications';

export async function scheduleFeeOverdueReminder(
  studentId: string,
  studentName: string,
  amountPaise: number,
  dueDate: string
): Promise<string> {
  const scheduledTime = nextAllowedTime(new Date()); // respects BR-REM-05
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Fee overdue',
      body: `${studentName} owes ${formatINR(amountPaise)} (due ${dueDate}).`,
      data: { type: 'fee_overdue', studentId, amountPaise, dueDate },
      categoryId: 'fee_overdue',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: scheduledTime,
    },
  });
  return id;
}
```

### 8.3 Notification Categories (Action Buttons)

iOS notifications can have action buttons. We define:

- `fee_overdue` — [Mark Paid] [Snooze] [Share via WhatsApp]
- `missing_attendance` — [Mark Now] [Snooze to Tomorrow]
- `inactive_student` — [Open Student] [Snooze] [Dismiss]

Tapping an action launches the app via deep link (`buddysaradhi://fees?student={id}`, etc.). The action is logged in `audit_log`.

### 8.4 Quiet Hours (`BR-REM-05`)

```ts
function nextAllowedTime(target: Date): Date {
  const hour = target.getHours();
  if (hour >= 7 && hour < 22) return target;
  // Schedule for tomorrow 07:00 local
  const tomorrow = new Date(target);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(7, 0, 0, 0);
  return tomorrow;
}
```

This is **non-negotiable**. A 23:30 "fee overdue" ping wakes the tutor (and their spouse, and their baby). `BR-REM-05` is `[CRITICAL]`.

---

## 9. Permissions Matrix

| Permission | iOS | Android | Required? | When requested | Spec |
|---|---|---|---|---|---|
| FaceID / TouchID | `NSFaceIDUsageDescription` (Info.plist) | `USE_BIOMETRIC` (AndroidManifest) | Required | At first launch, during onboarding | `10_Security.md` §3 |
| Notifications | Request via `Notifications.requestPermissionsAsync()` | `POST_NOTIFICATIONS` (API 33+) | Required | After onboarding, before first reminder schedule | `BR-REM-02` |
| Background fetch | Declared in `app.config.ts` `backgroundModes` | Implicit | Required | No prompt — system-granted | `04_Offline_Sync…md` §3 |
| Documents (read, for restore) | `UIDocumentPickerViewController` via `expo-document-picker` | `READ_EXTERNAL_STORAGE` (API ≤ 28) | Required | On user-initiated restore | §7.4 |
| Camera (v1.x — QR scan) | `NSCameraUsageDescription` | `CAMERA` | Optional | At first QR-scan tap | `15_Future_Roadmap.md` v1.x |
| ATT (App Tracking Transparency) | — | — | **Not needed** | — | We do not track (`TELE-1`) |
| Location | — | — | **Not needed** | — | We do not collect location |

### 9.1 Permission Request Sequencing

Permissions are requested **just-in-time**, not upfront. iOS App Store reviewers reject apps that request all permissions on first launch. The sequence:

1. **Onboarding** — biometric (required for app unlock).
2. **After onboarding, before first reminder** — notifications (required for `BR-REM-02..04`).
3. **On first user-initiated backup export** — no permission needed (`expo-sharing` uses the system share sheet, no prompt).
4. **On first user-initiated restore** — document picker (no explicit permission on iOS 14+; on Android ≤ 28, `READ_EXTERNAL_STORAGE` is requested).
5. **On first QR scan** (v1.x) — camera.

### 9.2 Permission Denial Recovery

If the user denies a required permission, the app degrades gracefully:

| Denied permission | Consequence |
|---|---|
| Biometric | App falls back to PIN unlock (`EC-SEC-02`). Settings shows a "Biometric disabled" amber chip with a "Re-enable" button that links to system Settings. |
| Notifications | Reminders fire as in-app toasts only (no system notification). Settings shows a "Notifications disabled" amber chip. The Dashboard activity feed becomes the only reminder surface. |
| Document picker (restore) | Restore is unavailable. Backup still works. |

The app **never** re-prompts for a permission the user has explicitly denied. It surfaces the consequence and links to system Settings.

---

## 10. Module Inventory Summary

| Module | Initialised when | Singleton? | Lifecycle |
|---|---|---|---|
| `expo-sqlite` | First DB access (lazy) | Yes (one DB file) | Closed on logout; deleted on restore |
| `@libsql/client` | First sync cycle | Yes (one client per session) | Recreated on re-auth |
| `expo-secure-store` | Always available | N/A (key-value API) | Items persist until wiped |
| `expo-local-authentication` | Always available | N/A | — |
| `expo-notifications` | App launch | Yes (notification channel) | Channel set on launch |
| `expo-haptics` | Always available | N/A | — |
| `expo-file-system` | Always available | N/A | — |
| `expo-sharing` | Always available | N/A | — |
| `expo-background-fetch` | App launch (register task) | Yes | Task defined in `app.config.ts` |
| `expo-keep-awake` | Backup/restore screens | Per-screen hook | Released on unmount |

---

## 11. Cross-References

- **Sync protocol (outbox drain, conflict resolution)**: `04_Offline_Sync_and_Conflict_Resolution.md`
- **Architecture and module inventory overview**: `01_Architecture.md` §6
- **Navigation and state**: `03_Navigation_and_State.md` (MMKV usage in §4)
- **EAS Build (native module compilation)**: `05_EAS_Build.md` §7
- **EAS Update (OTA limitations)**: `06_EAS_Update.md` §7
- **Top-level data model**: `../11_Data_Model.md`
- **Top-level security (PIN, biometric, backup crypto)**: `../10_Security.md`
- **Top-level business rules (BR-*)**: `../12_Business_Rules.md`
- **Top-level backup spec**: `../09_Backup_and_Import_Export.md`
- **Cross-cutting EAS choreography (native module upgrades trigger full binary rebuilds)**: `../deployment/03_EAS_Build_and_Update_Channels.md` §5.2 — explains why a new native module here forces a MINOR store build (not OTA)
- **Vercel Blob build storage (where the production APK is mirrored for sideload)**: `../deployment/02_Vercel_Blob_Build_Storage.md`

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (60–80 for component anatomy, 80–100 for storage-tier / file-system diagrams). The three mockups below visualise the *storage primitives* — the SQLite schema tree, the SecureStore keychain diagram, and the file-system layout for encrypted backups — that the sync engine (`04_Offline_Sync…md`) and the backup flow (`§7` below) consume.

### 12.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **storage + native-module layer**, not the live-screen layer. The mockups below are *structural diagrams* (schema trees, keychain access policies, on-disk file layouts) — they are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every platform architecture file gets ≥ 2 mockups), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-screen components that downstream files (`03_Navigation_and_State.md` for the PIN-entry sheet, `01_Architecture.md` §7 for the haptic feedback surfaces) specify; this file's job is to feed those files the schema, the keychain contract, and the on-disk backup layout they consume.

| Storage artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §1 Three storage tiers | `03_Navigation_and_State.md` §4 (state layers) | `.glass` (tier cards if surfaced) |
| §2.3 SQLite schema mirror | `04_Offline_Sync_and_Conflict_Resolution.md` §4 (merge strategy) | (none — schema is structural) |
| §4 SecureStore keychain | `03_Navigation_and_State.md` §2.1.2 (unlock sheet) | `.glass-strong` (sheet) + `.neumo-inset` (PIN field) |
| §7 Encrypted backup flow | Settings → Backup sheet | `.glass-strong` (sheet) + `.neumo-raised` (Backup CTA) |
| §8 Notifications | Settings → Reminders row | `.glass-faint` (list row) |

### 12.2 SQLite Schema Tree (NEW)

The §2.3 table mirror rendered as the actual DDL tree the migration runner produces. Every append-only table is flagged with its guard trigger; every money column is `INTEGER` (paise, `BR-M-01`). The schema is **byte-for-byte identical** to the per-user Turso DB schema (both produced by `migrations/`) — drift is impossible because the migration runner is the same file (`§2.2`).

```
  SQLITE SCHEMA TREE  (buddysaradhi.db, mirrors 11_Data_Model.md §4)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  buddysaradhi.db  (FileSystem.documentDirectory + 'buddysaradhi.db')                │
  │   ↑ PRAGMA foreign_keys=ON, journal_mode=WAL, synchronous=NORMAL (§2.1)   │
  │   ↑ 2–20 MB per tutor (200 students typical)                              │
  │                                                                            │
  │  ├── settings            ← singleton: tenant profile, sequences, locks    │
  │  ├── tutors              ← multi-tutor coaching institutes                │
  │  ├── batches             ← batch metadata + schedule                      │
  │  ├── students            ← master + lifecycle                             │
  │  │   └─ trg_students_dup_key     ← UNIQUE(code) guard (BR-RC-02)         │
  │  ├── attendance_sessions ← one row per (batch, date)                      │
  │  │   └─ trg_attendance_no_update_after_lock  ← BR-ATT-07 24h lock        │
  │  ├── attendance_records  ← per-student marks                              │
  │  │   └─ trg_attendance_records_lock_check    ← BR-ATT-08 unlock needs PIN│
  │  ├── fee_plans           ← plan definition                                │
  │  ├── fee_schedule_items  ← generated schedule                            │
  │  ├── invoices            ← generated invoices                             │
  │  │   └─ trg_invoice_tamper_hash   ← sha256 chain (BR-RC-03)              │
  │  ├── ledger_entries      ← ★ APPEND-ONLY financial spine (BR-LED-01)     │
  │  │   ├─ amount INTEGER  ← paise, never float (BR-M-01, AP-17)            │
  │  │   ├─ trg_ledger_no_update      ← UPDATE blocked                       │
  │  │   ├─ trg_ledger_no_delete      ← DELETE blocked                       │
  │  │   └─ trg_ledger_hash_chain     ← sha256(prev_hash || row) (BR-LED-01) │
  │  ├── receipts            ← 1:1 with PAYMENT_RECEIVED                      │
  │  │   └─ trg_receipt_tamper_hash   ← sha256 chain (BR-RC-01)              │
  │  ├── audit_log           ← ★ APPEND-ONLY audit trail (BR-SEC-08)         │
  │  │   └─ trg_audit_log_no_update_delete                                    │
  │  ├── sync_outbox         ← ★ payload APPEND-ONLY (BR-SYN-02)             │
  │  │   ├─ payload TEXT    ← JSON: {sql, params, created_at, client_id}     │
  │  │   └─ trg_sync_outbox_payload_immutable ← payload read-only after INSERT│
  │  ├── backup_manifest     ← backup metadata (local-only, not synced)      │
  │  ├── reminders           ← generated reminders (regenerated per device)  │
  │  ├── notifications       ← FIFO ≤200 in-app notifications                │
  │  ├── app_state           ← singleton: schema_version, vector clock       │
  │  └── app_meta            ← KV store for migration runner (local-only)    │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ Three tables are append-only (★): ledger_entries, audit_log, sync_outbox.
     Their triggers abort UPDATE/DELETE at the SQLite layer — same SQL, same
     names, same error messages as the Turso-side triggers (11_Data_Model §3.10).
   ↑ tenant_secret is generated per-device from Supabase user_metadata; it is
     NOT in sync_outbox (§2.4) — each device derives its own copy.
   ↑ The schema is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ Cross-refs: §2 (this file), 11_Data_Model.md §4 (canonical schema),
     04_Offline_Sync_and_Conflict_Resolution.md §4 (per-table merge strategy).
```

### 12.3 SecureStore Keychain Access Diagram (NEW)

The §4 access-policy table rendered as the call path the Turso JWT takes — from Supabase Auth return, into `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, through the biometric-protected read on first sync, and into the 60-second in-memory cache (wiped on `AppState` `background`). Only the Turso JWT lives in SecureStore (`§4.4`); the PIN hash and backup passphrase live as Argon2id hashes in the `settings` SQLite table, never in the keychain.

```
  SECURESTORE KEYCHAIN ACCESS DIAGRAM  (Turso JWT lifecycle, §4)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  PROVISIONING  (signup on web or mobile, §4.3)                            │
  │   ┌────────────────────────────────────────────────────────────────────┐ │
  │   │  Supabase Auth  →  provision-db Edge Function  →  Turso DB created  │ │
  │   │   ↓ user_metadata.db_token  (scoped Turso JWT)                      │ │
  │   │   ↓ user_metadata.db_url     (Turso DB URL — not sensitive)         │ │
  │   └────────────────────────────────────────────────────────────────────┘ │
  │       │                                                                  │
  │       ▼  storeTursoJWT(jwt)                                              │
  │   ┌────────────────────────────────────────────────────────────────────┐ │
  │   │  expo-secure-store                                                  │ │
  │   │   key: 'turso_jwt'                                                  │ │
  │   │   keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY  ← §4.2       │ │
  │   │   ↑ NOT synced to iCloud Keychain (THIS_DEVICE_ONLY)               │ │
  │   │   ↑ NOT accessible in background without biometric                  │ │
  │   │   authenticationPrompt: { title: 'Authenticate to access           │ │
  │   │     Buddysaradhi cloud sync' }  ← BR-SEC-04 challenge surface            │ │
  │   │   ↑ iOS: Keychain Services  ·  Android: AndroidKeyStore (API 23+)  │ │
  │   └────────────────────────────────────────────────────────────────────┘ │
  │       │                                                                  │
  │       ▼  first sync cycle (background fetch or app foreground)           │
  │   ┌────────────────────────────────────────────────────────────────────┐ │
  │   │  readTursoJWT()  →  biometric prompt (FaceID/TouchID/Android)       │ │
  │   │   ↓ on success: JWT returned to JS                                  │ │
  │   │   ↓ cached in process memory for 60s (§5.2)                         │ │
  │   │   ↑ cache wiped on AppState 'background' — never persisted to disk  │ │
  │   └────────────────────────────────────────────────────────────────────┘ │
  │       │                                                                  │
  │       ▼  getTursoClient()  (singleton, §3.2)                             │
  │   ┌────────────────────────────────────────────────────────────────────┐ │
  │   │  @libsql/client  →  createClient({ url, authToken: token })         │ │
  │   │   ↑ token never held in JS beyond client's internal closure         │ │
  │   │   ↑ getTursoClient re-reads from SecureStore only on first init    │ │
  │   └────────────────────────────────────────────────────────────────────┘ │
  │       │                                                                  │
  │       ▼  logout / BR-SEC-10 session revoke                               │
  │   ┌────────────────────────────────────────────────────────────────────┐ │
  │   │  wipeTursoJWT()  →  SecureStore.deleteItemAsync('turso_jwt')        │ │
  │   │  MMKV.clearAll()  →  UI state wiped                                 │ │
  │   │  drop buddysaradhi.db   →  business data wiped                           │ │
  │   │  router.replace('/(auth)/login')                                    │ │
  │   └────────────────────────────────────────────────────────────────────┘ │
  │                                                                          │
  │  WHAT ELSE LIVES IN SECURESTORE?  (§4.4)                                 │
  │   ── Nothing else. Only the Turso JWT.                                   │
  │   ── PIN hash → settings.pin_hash (SQLite, Argon2id)                     │
  │   ── Backup passphrase hash → settings.backup_passphrase_hash (SQLite)  │
  │   ── MMKV encryption key → AndroidKeychain (auto-generated, separate)   │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The keychain access policy is structural, not a rendered UI surface —
     no glass tier annotation here (§6.6 single rule applies to live
     components only, per §12.1 above).
   ↑ The biometric prompt IS a live surface (rendered by the OS, not us) —
     we treat it as an opaque system affordance, not a Buddysaradhi component.
   ↑ Cross-refs: §4 (this file), 10_Security.md §2.3 (assertNoPlaintextToken
     startup probe), 10_Security.md §3.5 (BR-SEC-03 lockout), 03_Navigation
     _and_State.md §2.1.2 (unlock screen flow).
```

### 12.4 File-System Layout for Encrypted Backups (NEW)

The §7.1 backup-file location + the §7.2 crypto envelope rendered as the on-disk layout. Every `.buddysaradhi` file is `salt(16) || nonce(12) || tag(16) || ciphertext` — AES-256-GCM with an Argon2id-derived key (`BACKUP-1`). Backups older than 30 days are auto-pruned on app launch (the tutor can override in Settings → Backup). The `backups/` directory is device-local; it is **not** synced — only the SQLite data inside the backup envelope replicates to Turso.

```
  FILE-SYSTEM LAYOUT  (expo-file-system, §7.1 backup directory)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  FileSystem.documentDirectory/                                            │
  │  ├── buddysaradhi.db                    ← local SQLite (Tier 1, §1)            │
  │  │   ↑ source of truth for reads; first write target (P5)                │
  │  │   ↑ 2–20 MB typical, 200 students                                     │
  │  │                                                                        │
  │  ├── backups/                      ← encrypted .buddysaradhi envelopes (§7)    │
  │  │   ├── Buddysaradhi_2025-06-15_1430.buddysaradhi                                  │
  │  │   ├── Buddysaradhi_2025-06-22_0915.buddysaradhi                                  │
  │  │   ├── Buddysaradhi_2025-07-01_0800.buddysaradhi                                  │
  │  │   └── …  ← auto-pruned after 30 days (tutor can override)             │
  │  │       ┌──────────────────────────────────────────────────────────┐    │
  │  │       │  .buddysaradhi file binary layout  (BACKUP-1, §7.2)            │    │
  │  │       │   ┌──────────────────────────────────────────────────┐   │    │
  │  │       │   │ salt(16)      ← Argon2id salt, random per backup │   │    │
  │  │       │   │ nonce(12)     ← AES-256-GCM nonce, random        │   │    │
  │  │       │   │ tag(16)       ← GCM auth tag                     │   │    │
  │  │       │   │ ciphertext    ← gzipped tar of:                  │   │    │
  │  │       │   │                 • data.jsonl (all rows NDJSON)   │   │    │
  │  │       │   │                 • schema_version.txt             │   │    │
  │  │       │   │                 • manifest.json (counts, sha256, │   │    │
  │  │       │   │                   created_at, tenant_id)         │   │    │
  │  │       │   └──────────────────────────────────────────────────┘   │    │
  │  │       │   ↑ Argon2id params: m=64MiB, t=3, p=2 (10_Security §15) │    │
  │  │       │   ↑ Passphrase ≥12 chars (BR-SEC-06)                     │    │
  │  │       │   ↑ Restore needs PIN + passphrase (BR-IMP-05, §7.4)     │    │
  │  │       └──────────────────────────────────────────────────────────┘    │
  │  │                                                                        │
  │  ├── mmkv/                         ← MMKV default instance (Tier 2, §1)   │
  │  │   └── ui-store                  ← Zustand-persisted UI state           │
  │  │       ↑ <100 KB total, encrypted via react-native-mmkv-storage        │
  │  │       ↑ NEVER business data, NEVER money (§4.2.3)                     │
  │  │                                                                        │
  │  └── (no plaintext token files — assertNoPlaintextToken scrubs, §1)      │
  │      ↑ startup probe verifies Turso JWT is NOT in FileSystem plaintext   │
  │                                                                        │
  │  WHAT IS NOT ON DISK  (device-local only, never in backups)              │
  │   ── Turso JWT → expo-secure-store (iOS Keychain / Android Keystore)     │
  │   ── MMKV encryption key → AndroidKeychain (auto-generated)              │
  │   ── app_meta migration runner state → SQLite (local-only, not synced)   │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ MMKV and SecureStore are NOT included in the .buddysaradhi envelope — they
     are device-local. Only the SQLite data is in the backup (§1 invariant 4).
   ↑ expo-sharing.shareAsync() opens the OS share sheet (Save to Files,
     Mail, AirDrop, WhatsApp) — the tutor chooses where the .buddysaradhi goes.
   ↑ The file-system layout is structural, not a rendered UI surface — no
     glass tier annotation here (§6.6 single rule applies to live components).
   ↑ The "Back up now" CTA in Settings → Backup IS a live surface: it is
     .neumo-raised (control, §6.6) inside a .glass-strong sheet (surface, §5.5).
   ↑ Cross-refs: §7 (this file), 09_Backup_and_Import_Export.md (format),
     10_Security.md §15 (BACKUP-1 crypto envelope), product/04_Download_Hub.md
     (the public surface that links to the TestFlight invite — iOS has no
     sideload equivalent to the Android APK mirror documented in 05_EAS_Build).
```

### 12.5 References (External Design Authorities)

The mockups and the storage primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the three-tier storage split, the SecureStore access policy, or the backup crypto envelope.

- **Expo docs** — *expo-sqlite*, *expo-secure-store*, *expo-file-system*, *expo-local-authentication*. The §2 SQLite schema mirror, the §4 SecureStore keychain access, and the §7 file-system layout follow Expo's official module documentation.
- **Apple Human Interface Guidelines** — *Biometric authentication, Keychain Services*. The §4.2 `WHEN_UNLOCKED_THIS_DEVICE_ONLY` access policy and the §5.2 60-second in-memory JWT cache follow Apple HIG's Keychain guidance.
- **Android Developers** — *AndroidKeyStore, Biometric API*. The §4 Android Keystore integration (`setUserAuthenticationRequired(true)` on API 23+) follows Android's Keystore documentation.
- **Turso docs** — *libSQL client, scoped JWTs, per-user database pattern*. The §3 libSQL HTTP client and the §4 scoped JWT lifecycle follow Turso's per-tenant auth documentation.
- **OWASP** — *Mobile Top 10 (M2: Hardcoded Credentials, M9: Insecure Data Storage)*. The §1 three-tier storage invariant (secrets → SecureStore, business data → SQLite, UI state → MMKV) follows OWASP's mobile-data-storage guidance.
- **RFC 8439 (AES-256-GCM)** and **RFC 9106 (Argon2id)** — The §7.2 backup crypto envelope uses AES-256-GCM with an Argon2id-derived key per these RFCs; parameters (`m=64MiB, t=3, p=2`) follow OWASP's 2023 password-storage cheat sheet.
- **Smashing Magazine** — *Mobile-first offline storage patterns*. The §1 read-from-local / write-to-outbox split follows Smashing's offline-first mobile UX research.
- **CSS-Tricks** — *`env(safe-area-inset-*)` on mobile*. The §4 authenticationPrompt surfaces and the §7 OS share sheet respect the safe-area inset (consumed by `03_Navigation_and_State.md` §3 for the bottom tab bar).

---

*End of 02 — Native Modules and Storage. Next file: `03_Navigation_and_State.md`.*
