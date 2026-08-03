# 04 — Offline Sync and Conflict Resolution

> The crux of mobile: **offline-first**. Every mutation writes to local SQLite + `sync_outbox` in the same transaction; the UI never blocks on the network. A background sync task drains the outbox to Turso via libSQL HTTP, applies conflict resolution per `12_Business_Rules.md` §9 (`BR-SYN-*`), retries with exponential backoff on transient failures (`EC-SY-06`), handles clock drift (`EC-SY-07`) and schema drift (`EC-SY-08`), and surfaces a green/amber/red sync indicator. This file is the sync engineer's manual. For the storage primitives (`expo-sqlite`, libSQL client, `sync_outbox` schema) see `02_Native_Modules_and_Storage.md`.

---

## 1. The Offline-First Contract

Buddysaradhi mobile is offline-first by P5 (`01_Product_Principles.md`). This is not a feature — it is the **default mode of operation**. The "happy path" is no network. The network is a replication transport, not a dependency.

The contract has three pillars:

1. **Local writes are immediate.** When a tutor taps "Record Payment," the ledger entry, receipt, outbox row, and audit log are written to local SQLite in a single transaction (~50ms). The UI updates optimistically. The user can put the phone in airplane mode immediately and the data is safe.
2. **Sync is invisible.** The sync engine runs in the background — on app foreground, on `AppState` `active`, on iOS background fetch every ~30 min, on Android foreground service while the app is open. The user never sees a "syncing..." spinner blocking the UI.
3. **The cloud is a replica, not the source of truth.** Turso is a replica of the local DB. The local DB is the source of truth for the UI. If Turso is unreachable, the app continues to work; if local SQLite is corrupted, the app falls back to Turso on next launch.

### 1.1 The Inverted Authority Diagram

```
                  WEB APP (browser)
                        │
                        ▼
                Turso (per-user DB) ◄────┐
                        ▲                │
                        │                │
                  HTTP push (drain)      │
                        │                │
                        │                │
              ┌─────────┴────────┐       │
              │  sync_outbox     │       │
              │  (local SQLite)  │       │
              └─────────┬────────┘       │
                        │                │
              ┌─────────┴────────┐       │
              │  Local SQLite    │       │
              │  (source of      │       │
              │   truth for UI)  │       │
              └─────────┬────────┘       │
                        │                │
                  HTTP pull (changes)    │
                        │                │
                        └────────────────┘
                        (also writes to local SQLite
                         after merging with remote changes)
```

The local SQLite is the **read** authority. Turso is the **write** authority (the source of new rows from other devices). When a row exists in both with different `updated_at`, the conflict resolver decides (`BR-SYN-03`).

---

## 2. The `sync_outbox` Table

The `sync_outbox` table is the queue. Every mutation that must survive to the cloud appends a row in the same transaction (`BR-SYN-01`, Rule 7).

### 2.1 Schema

```sql
CREATE TABLE IF NOT EXISTS sync_outbox (
  id              TEXT PRIMARY KEY,           -- UUID v7
  tenant_id       TEXT NOT NULL,
  table_name      TEXT NOT NULL,              -- 'ledger_entries', 'students', etc.
  row_id          TEXT NOT NULL,              -- the affected row's PK
  operation       TEXT NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
  payload         TEXT NOT NULL,              -- JSON: { sql, params, created_at, client_id }
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','sent','conflict','expired')),
  retries         INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  sent_at         TEXT,
  synced_at       TEXT
);

CREATE INDEX idx_sync_outbox_status_created
  ON sync_outbox(status, created_at);
```

The `payload` is **immutable** after insert (enforced by trigger `trg_sync_outbox_payload_immutable` per `BR-SYN-02`). The `status` transitions are:

```
pending ──drain──► sent ──server ack──► (row deleted or kept for audit)
   │                  │
   │                  └──server conflict──► conflict
   │
   └──5 retries──► expired
```

### 2.2 What Gets Queued

Every `INSERT`/`UPDATE`/`DELETE` on a business table writes an outbox row. Specifically:

- `ledger_entries` INSERT → outbox row, `operation='INSERT'`, `payload={ sql: 'INSERT INTO ledger_entries ...', params: [...] }`
- `students` INSERT/UPDATE → outbox row
- `attendance_records` INSERT/UPDATE → outbox row
- `fee_schedule_items` INSERT/UPDATE → outbox row
- `invoices` INSERT/UPDATE → outbox row
- `receipts` INSERT → outbox row
- `audit_log` INSERT → outbox row (yes, audit_log is also replicated — it's append-only, but the cloud copy must match the local copy)
- `settings` UPDATE → outbox row (currency, locale, sequences, etc.)
- `app_state` UPDATE → outbox row (schema_version, tenant_secret is NOT synced — see §2.4)

### 2.3 What Does NOT Get Queued

- `sync_outbox` itself (it's a local queue, not data)
- `app_meta` (migration runner metadata)
- `backup_manifest` (local file metadata)
- `notifications` (in-app only; not synced)
- `reminders` (regenerated on each device from underlying data)

### 2.4 The `tenant_secret` Exception

The `app_state.tenant_secret` is generated at provisioning and **never** synced. Each device generates its own copy from the Supabase `user_metadata.tenant_secret` returned at signup. This means the receipt tamper hashes are reproducible across devices (same `tenant_secret`), but the secret itself never traverses the sync outbox.

---

## 3. The Sync Engine — Push (Outbox Drain)

The push side drains the outbox: each `pending` row is replayed against Turso via the libSQL client.

### 3.1 The Drain Loop

```ts
// src/lib/sync/push.ts
import { getTursoClient } from '../turso';
import { getDB } from '../db';

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000; // 1s, 2s, 4s, 8s, 16s

export async function drainOutbox(): Promise<DrainResult> {
  const db = await getDB();
  const client = await getTursoClient();

  const pending = await db.getAllAsync<OutboxRow>(`
    SELECT * FROM sync_outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 50
  `);

  let pushed = 0;
  let conflicts = 0;
  let failed = 0;

  for (const row of pending) {
    const result = await pushOne(client, db, row);
    if (result === 'pushed') pushed++;
    else if (result === 'conflict') conflicts++;
    else if (result === 'failed') failed++;
  }

  return { pushed, conflicts, failed, remaining: pending.length - pushed };
}

async function pushOne(
  client: Client,
  db: SQLiteDatabase,
  row: OutboxRow
): Promise<'pushed' | 'conflict' | 'failed'> {
  const payload = JSON.parse(row.payload) as OutboxPayload;

  try {
    await client.execute({
      sql: payload.sql,
      args: payload.params,
    });

    await db.runAsync(
      `UPDATE sync_outbox
       SET status = 'sent', sent_at = ?, synced_at = ?
       WHERE id = ?`,
      [nowISO(), nowISO(), row.id]
    );
    return 'pushed';
  } catch (err) {
    return await handlePushError(db, row, err);
  }
}
```

### 3.2 The Drain Trigger

The drain loop is triggered by four events:

1. **App foreground** — `AppState` transitions to `active`. Wait 2 seconds (let the UI settle), then drain.
2. **Manual sync tap** — User taps the sync chip in the header. Forces a drain + pull.
3. **Background fetch (iOS)** — Registered with `expo-background-fetch`. iOS calls it every ~30 min.
4. **Foreground service (Android)** — While the app is `active`, a 30-second interval timer drains.

```ts
// src/lib/sync/scheduler.ts
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

const SYNC_TASK = 'buddysaradhi-sync';

TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    await drainOutbox();
    await pullChanges();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync() {
  await BackgroundFetch.registerTaskAsync(SYNC_TASK, {
    minimumInterval: 60 * 30, // 30 min
    stopOnTerminate: false,
    startOnBoot: false,
  });
}
```

### 3.3 The Drain Rate Limit

Each drain batch is 50 rows. Larger batches risk timeout (libSQL HTTP has a 10s timeout per request, but a 50-row batch is 50 sequential requests ≈ 5s on 4G). The drain loop runs to completion (drains all pending rows in batches of 50) before returning.

If the outbox has 5,000+ rows (offline for 30 days, `EC-SY-05`), the drain runs in the background and the UI shows a progress chip: "Syncing 5,000 rows · 1,234 remaining."

---

## 4. The Sync Engine — Pull (Remote Changes)

The pull side fetches changes from Turso and merges them into local SQLite.

### 4.1 The Pull Strategy

For each table, we track `last_pulled_at` in `app_state`:

```sql
SELECT * FROM <table>
WHERE updated_at > ?
  AND tenant_id = ?
ORDER BY updated_at ASC
LIMIT 500
```

The 500-row limit prevents a single pull from blocking the UI. If 500+ rows are returned, another pull fires immediately.

### 4.2 Merge Strategy per Table

| Table | Merge strategy | Reason |
|---|---|---|
| `ledger_entries` | INSERT only (UUID-keyed, conflict-immune per `BR-SYN-04`) | Append-only; no UPDATE/DELETE possible |
| `audit_log` | INSERT only (UUID-keyed) | Append-only |
| `attendance_sessions` | LWW on `updated_at` (`BR-SYN-03`) | Tutors edit sessions; latest wins |
| `attendance_records` | LWW on `updated_at` | Same |
| `students` | LWW on `updated_at` | Same |
| `batches` | LWW on `updated_at` | Same |
| `fee_plans` | LWW on `updated_at` | Same |
| `fee_schedule_items` | LWW on `updated_at` | Same |
| `invoices` | LWW on `updated_at` (tamper_hash recomputed on merge) | Same |
| `receipts` | INSERT only (UUID-keyed, append-only by nature) | Same as ledger |
| `settings` | LWW on `updated_at` (with field-level merge for some fields) | See §4.3 |
| `app_state` | Pull only `schema_version` (ignore `tenant_secret`) | Each device has its own `tenant_secret` |

### 4.3 The `settings` LWW + Field-Level Merge

Most `settings` fields use straight LWW. Three fields use field-level merge:

- `next_invoice_seq` / `next_receipt_seq` / `next_student_seq` — **max-wins**. If local is 42 and remote is 50, local becomes 50. Never decrement. This handles the case where two devices allocate sequence numbers concurrently (each device reserved a different range locally; the higher number wins on merge).
- `attendance_lock_hours` — LWW.
- `theme` — LWW (the tutor's preference propagates across devices).

### 4.4 Conflict Resolution Implementation

```ts
async function mergeRow(
  db: SQLiteDatabase,
  tableName: string,
  remoteRow: Record<string, unknown>
): Promise<'merged' | 'local_won' | 'remote_won' | 'no_conflict'> {
  const rowId = remoteRow.id as string;
  const local = await db.getFirstAsync<{ updated_at: string }>(
    `SELECT updated_at FROM ${tableName} WHERE id = ?`,
    [rowId]
  );

  if (!local) {
    // Remote is new — INSERT
    await insertRow(db, tableName, remoteRow);
    return 'merged';
  }

  if (local.updated_at === remoteRow.updated_at) {
    return 'no_conflict';
  }

  if (new Date(remoteRow.updated_at) > new Date(local.updated_at)) {
    // Remote wins — UPDATE local
    await updateRow(db, tableName, remoteRow);
    await auditLogConflict(db, tableName, rowId, 'remote_won', local.updated_at, remoteRow.updated_at);
    return 'remote_won';
  }

  // Local wins — log the conflict for audit, do nothing to local
  await auditLogConflict(db, tableName, rowId, 'local_won', local.updated_at, remoteRow.updated_at);
  return 'local_won';
}
```

Every conflict writes an `audit_log` row with `action='sync_conflict_resolved'`, `metadata={ table, row_id, winner, local_updated_at, remote_updated_at }`. This is `BR-SEC-08` (audit every sensitive action) and `BR-SYN-03` (surface conflicts for audit).

### 4.5 The Ledger Is Conflict-Immune (`BR-SYN-04`)

The ledger is **never** conflicted. Why?

- Each `ledger_entries` row has a UUID v7 primary key (time-sortable, globally unique).
- Two devices cannot INSERT the same UUID (different UUIDs are generated on each device).
- The table is INSERT-only (no UPDATE/DELETE).
- Therefore, two devices inserting payments for the same student simply produce two different ledger rows. Both land on Turso. Both replicate to the other device.

The only "conflict" is at the **business logic** level: if both devices recorded a payment for the same invoice, the invoice may end up overpaid. This is handled by `BR-FEE-04` (over-payment split into `[ADVANCE]` row) and `EC-SY-03` (the tutor voids the duplicate receipt). The sync engine itself does nothing special — it just lands both rows.

### 4.6 The 24h Attendance Lock (`BR-ATT-07`) and Sync

The 24h lock is enforced at the **session** level, not the row level. If a tutor on Device A locks a session at 18:00, and Device B (offline) tries to edit a record in that session at 18:30, Device B's edit is rejected locally by the `trg_attendance_records_lock_check` trigger. The outbox row is never written. When Device B comes back online and pulls, it sees the locked session and the local attempt is logged in `audit_log` (`action='attendance_edit_blocked_by_lock'`).

If Device B edited the record at 17:55 (before the lock), the edit lands in the outbox. When it pushes to Turso, the server's `trg_attendance_records_lock_check` (same trigger) rejects it because the session is now locked. The outbox row goes to `status='conflict'`. The sync drawer surfaces this with a "Resolve" action: either void the local edit (post a compensating audit) or unlock the session (requires PIN per `BR-ATT-08`).

---

## 5. Error Handling and Backoff

### 5.1 Exponential Backoff (`EC-SY-06`)

When a push fails with a transient error (network timeout, 5xx), the outbox row's `retries` count increments. The next drain attempt for that row is delayed by `BACKOFF_BASE_MS * 2^retries`:

| Retry # | Delay |
|---|---|
| 0 (first attempt) | immediate |
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| 6+ | row marked `expired` (`EC-SY-02`) |

The backoff is per-row, not per-drain. A row that has failed 3 times will be skipped on the next drain if < 4s have elapsed since its last attempt. This prevents a single bad row from blocking the drain.

### 5.2 Error Categories

```ts
async function handlePushError(
  db: SQLiteDatabase,
  row: OutboxRow,
  err: unknown
): Promise<'conflict' | 'failed'> {
  const error = categorizeError(err);

  switch (error.kind) {
    case 'conflict':
      await db.runAsync(
        `UPDATE sync_outbox SET status = 'conflict', last_error = ?, retries = retries + 1 WHERE id = ?`,
        [error.message, row.id]
      );
      return 'conflict';

    case 'schema_drift':
      // EC-SY-08: pause sync, prompt update
      await pauseSync('schema_drift');
      return 'failed';

    case 'auth_expired':
      // Re-authenticate via Supabase
      await reauth();
      return 'failed'; // will retry on next drain

    case 'transient':
      // Network timeout, 5xx — backoff
      await db.runAsync(
        `UPDATE sync_outbox SET retries = retries + 1, last_error = ? WHERE id = ?`,
        [error.message, row.id]
      );
      if (row.retries + 1 >= MAX_RETRIES) {
        await db.runAsync(
          `UPDATE sync_outbox SET status = 'expired' WHERE id = ?`,
          [row.id]
        );
        await auditLogExpired(db, row);
      }
      return 'failed';

    case 'permanent':
      // SQL parse error, type mismatch — client bug
      await db.runAsync(
        `UPDATE sync_outbox SET status = 'conflict', last_error = ? WHERE id = ?`,
        [`Permanent: ${error.message}`, row.id]
      );
      return 'conflict';
  }
}
```

### 5.3 The Sync Drawer

When the user taps the sync chip, a sheet slides up showing the sync state:

```
┌────────────────────────────────────────────────────────────┐
│  Sync                                                       │
│  ───────────────────────────────────────────────────────── │
│                                                            │
│  ● Synced — last sync 2 minutes ago                        │
│  (or) ◐ Syncing… 23 of 47 rows pushed                      │
│  (or) ○ Offline — 14 rows pending                          │
│  (or) ✕ Sync failed — tap to retry                         │
│                                                            │
│  ───────────────────────────────────────────────────────── │
│                                                            │
│  Conflicts (3)                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Payment RCP-000042 — duplicate from another device  │  │
│  │  [ View ]  [ Void ]  [ Dismiss ]                      │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Student Aarav Sharma — name updated elsewhere        │  │
│  │  Local: "Aarav Sharma" · Remote: "Aarav S. Sharma"    │  │
│  │  [ Keep Local ]  [ Take Remote ]  [ View Audit ]      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ───────────────────────────────────────────────────────── │
│                                                            │
│  [ Sync Now ]   [ Pause sync ]   [ Diagnostics ]           │
└────────────────────────────────────────────────────────────┘
```

The drawer is the only place sync errors are surfaced. Toasts are **not** used for sync state — they would be noisy and break P12 (minutes-per-day). The sync chip in the header is the persistent indicator; the drawer is the detail.

---

## 6. Clock Drift (`EC-SY-07`)

### 6.1 The Problem

If a device's clock is 2 hours ahead of the server, locally-generated `created_at` timestamps will be 2 hours in the future. This breaks LWW: a local edit with a future `updated_at` will always "win" against a remote edit, even if the remote edit happened later in wall-clock time.

### 6.2 The Solution — Server Time Skew

Every libSQL response includes a `server_time` field (Turso's `CURRENT_TIMESTAMP` at response time). The sync engine computes the skew:

```ts
const skew = Date.parse(response.server_time) - Date.now();
// positive skew = device is behind server
// negative skew = device is ahead of server
```

The skew is stored in `app_state.clock_skew_ms`. Every timestamp written to `sync_outbox.payload.created_at` is adjusted:

```ts
const adjustedCreatedAt = new Date(Date.now() + skew).toISOString();
```

This ensures the `created_at` in the payload matches the server's view of "now."

### 6.3 Business Dates vs Timestamps

`P-DM7` (`11_Data_Model.md` §1): business dates (`session_date`, `occurred_on`, `due_date`) are ISO date only — no time component. A tutor in Kolkata recording a payment on 15 Aug 2024 at 23:30 IST writes `occurred_on = '2024-08-15'`, regardless of where the server sits. The date is the tutor's local date, full stop.

Timestamps (`created_at`, `updated_at`, `locked_at`) are ISO-8601 UTC, adjusted for skew per §6.2.

### 6.4 The Nightly Lock Job

The nightly attendance-lock job (`BR-ATT-07` — auto-lock 24h after session end) uses the **configured timezone** in `settings.timezone`, not the device clock. So even if the device clock is wrong, the lock job fires at the right wall-clock time in the tutor's timezone.

---

## 7. Schema Drift (`EC-SY-08`)

### 7.1 The Problem

If the app supports `schema_version 6` and the Turso DB is at `schema_version 7`, pushing local mutations could fail (column doesn't exist) or silently corrupt (column exists but with different semantics). Pulling remote rows could fail (unknown column).

### 7.2 The Solution — Header-Based Version Check

Every libSQL request includes a `X-Schema-Version` header:

```ts
client.execute({
  sql: payload.sql,
  args: payload.params,
  // libsql client doesn't support custom headers directly;
  // we use a wrapper that adds the header via fetchOptions
  headers: { 'X-Schema-Version': String(localSchemaVersion) },
});
```

The Turso-side edge function (the one that provisions the per-user DB) runs schema migrations and stores the current `schema_version` in the DB. When a request arrives with `X-Schema-Version < server_schema_version`, Turso returns `426 Upgrade Required`.

### 7.3 The Client Response

```ts
if (response.status === 426) {
  await pauseSync('schema_drift');
  await showUpdatePrompt(
    'Buddysaradhi update required',
    'Your app is older than your cloud database. Update Buddysaradhi to continue syncing.',
    'Update now'  // deep links to App Store / Play Store
  );
}
```

While sync is paused:

- **Reads** continue from local SQLite — the app remains usable.
- **Writes** continue to land in local SQLite + `sync_outbox` — no data loss.
- **Drain** is paused — outbox grows.
- **Pull** is paused.

When the user updates the app and relaunches, the new schema_version is sent; sync resumes; the outbox drains.

### 7.4 The Forward-Only Migration Guarantee

`P-DM8` (`11_Data_Model.md` §1): forward-only migrations. The server never rolls back a schema. Therefore, an old app can always upgrade to a new schema by running the missing migrations locally. A new app cannot downgrade to an old schema (but this never happens in practice — apps are only updated forward).

---

## 8. The Sync Indicator

The sync chip in the header has four states:

| State | Visual | When |
|---|---|---|
| Synced | `● synced` (emerald dot, "synced 2m ago") | Last drain + pull succeeded; outbox empty |
| Syncing | `◐ syncing…` (cyan, animated rotation) | Drain or pull in progress |
| Pending | `○ offline · N pending` (amber dot, count) | Outbox has rows; no network or drain paused |
| Failed | `✕ failed` (flare dot) | Last drain had ≥1 permanent failure; tap to view |

### 8.1 State Machine

```
                ┌─────────────┐
                │   Synced    │ ◄─── drain success + outbox empty
                └──────┬──────┘
                       │ user writes (outbox row appended)
                       ▼
                ┌─────────────┐
                │   Pending   │
                └──────┬──────┘
                       │ network available + drain trigger
                       ▼
                ┌─────────────┐
                │  Syncing    │
                └──────┬──────┘
                       │
              ┌────────┼────────┐
              │        │        │
              ▼        ▼        ▼
        ┌─────────┐ ┌─────┐ ┌────────┐
        │ Synced  │ │Failed│ │ Pending│
        │(drained)│ │(error)│(partial)│
        └─────────┘ └─────┘ └────────┘
```

The state is stored in a Zustand store (`useSyncStore`) so any component can read it reactively. The chip re-renders on state change without re-rendering the entire header.

### 8.2 Haptics on State Change

- `Synced → Pending`: no haptic (writes are frequent; haptics would be noisy)
- `Pending → Syncing`: no haptic (sync triggers are frequent)
- `Syncing → Synced`: `Haptics.notificationAsync(SUCCESS)` (only if >10 rows were pushed; otherwise no haptic)
- `Syncing → Failed`: `Haptics.notificationAsync(ERROR)` (always)

---

## 9. The Pull-Push Window

Sync runs pull first, then push. Why?

- Pulling first brings in any remote changes that might affect local writes (e.g., another device locked a session).
- Pushing second sends local mutations to a fresh view of the server state.
- If we pushed first, a stale view could cause conflicts that pull would have prevented.

The window between pull and push is typically <100ms (a single HTTP round-trip). During this window:

- The local SQLite is **briefly** ahead of the server (it has the pulled rows + the local pending writes that haven't pushed yet).
- This is fine — the UI reads local SQLite, which is always the most current view.

### 9.1 The Sync Lock

During a sync cycle, a sync lock (`app_state.sync_in_progress = 1`) prevents:

- Concurrent sync cycles (e.g., background fetch fires while manual sync is running).
- Backup running during sync (`EC-SY-04`).
- Restore running during sync.

The lock is advisory — set in `app_state` and checked at the start of each sync cycle. If a cycle crashes, the lock is cleared on next app launch (a startup probe `clearStaleSyncLock`).

---

## 10. Performance Characteristics

| Operation | Typical | Worst case | Notes |
|---|---|---|---|
| Outbox row append | 2ms | 10ms | Single INSERT in existing transaction |
| Drain 50 rows | 3s | 8s | 50 sequential HTTP requests, 4G |
| Pull 500 rows | 1.5s | 5s | Single SELECT + 500 local INSERTs |
| Conflict resolution per row | 5ms | 20ms | Local SELECT + audit INSERT |
| Full sync cycle (drain + pull) | 5s | 30s | 50-row outbox + 500-row pull |

A typical tutor's day (50 mutations) drains in ~3 seconds. The tutor never sees this — sync runs in the background.

---

## 11. Testing the Sync Engine

### 11.1 Unit Tests (in-memory SQLite)

- LWW merge: local `updated_at` wins / remote wins / tie → audit log written
- Ledger conflict-immunity: two devices insert different UUIDs → both land
- Settings sequence merge: local 42, remote 50 → 50 wins
- Backoff: row fails 5 times → status='expired'

### 11.2 Integration Tests (in-memory SQLite + mocked libSQL)

- Drain 50 pending rows → all status='sent'
- Mid-drain network drop → pushed rows 'sent', unsent 'pending' (EC-SY-06)
- Schema drift → drain pauses, prompt shown (EC-SY-08)
- Clock drift → `created_at` adjusted by skew (EC-SY-07)
- 24h lock during sync → outbox row status='conflict', surfaced in drawer

### 11.3 E2E Tests (two-device simulation)

- Device A records payment offline; Device B records payment for same invoice offline; both come online → both rows land, invoice overpaid → `BR-FEE-04` splits advance → audit log shows the cascade
- Device A locks session; Device B tries to edit → blocked locally; audit logged

---

## 12. Cross-References

- **Native modules and storage (sqlite, libsql, secure-store)**: `02_Native_Modules_and_Storage.md`
- **Architecture (sync engine in module inventory)**: `01_Architecture.md` §6
- **Navigation and state (TanStack invalidation on sync)**: `03_Navigation_and_State.md` §4.1
- **Top-level sync rules (`BR-SYN-*`)**: `../12_Business_Rules.md` §9
- **Top-level sync edge cases (`EC-SY-*`)**: `../14_Edge_Cases.md` §5
- **Top-level security (audit log, `BR-SEC-08`)**: `../10_Security.md`
- **Top-level data model (`sync_outbox` schema, `app_state`)**: `../11_Data_Model.md`
- **Top-level core logic (sync state machine)**: `../02_Core_Logic.md` §3.6
- **Cross-cutting EAS choreography (OTA branching + sync_outbox interaction)**: `../deployment/03_EAS_Build_and_Update_Channels.md` §5 — explains why a sync-engine logic change is OTA-eligible (JS-only) but a sync-engine schema migration is not (requires a binary rebuild)
- **Vercel Blob build storage (where the production APK is mirrored for sideload)**: `../deployment/02_Vercel_Blob_Build_Storage.md`

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated (`.glass` / `.glass-strong` / `.glass-faint` per §5.5), neumorphic controls recipe-annotated (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6), cross-references canonical (`P*`, `BR-*`, `EC-*`, `AP-*`, `§*`). Box widths honour §20.3 rule 2 (80–100 for sync-engine diagrams). The three mockups below visualise the *sync primitives* — the `sync_outbox` queue state machine, the LWW conflict-resolution flow, and the pull→push merge sequence — that the sync engine (`src/lib/sync/*`) implements and that the sync drawer (`03_Navigation_and_State.md` §11.4) renders.

### 13.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **sync-engine layer**, not the live-screen layer. The mockups below are *process diagrams* (queue state machines, conflict-resolution flows, merge sequences) — they are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every platform architecture file gets ≥ 2 mockups), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-screen component that `03_Navigation_and_State.md` §11.4 specifies (the sync drawer: `.glass-strong` sheet + `.glass-faint` conflict rows + `.neumo-raised` resolve buttons); this file's job is to feed that drawer the queue states, the conflict metadata, and the merge sequence it consumes.

| Sync artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §2 `sync_outbox` queue | `03_Navigation_and_State.md` §11.4 (sync drawer) | `.glass-strong` (sheet) + `.glass-faint` (conflict rows) |
| §4.4 LWW conflict resolution | sync drawer conflict rows | `.glass-faint` (row) + `.neumo-raised` (Keep Local / Take Remote) |
| §9 pull→push window | sync chip in header (§7 of 03) | `.glass-strong` (header bar) + status dot (emerald/cyan/amber/flare) |
| §8 sync indicator state machine | sync chip 4-state | flat tinted dot + text label (not glass — chip is inline) |
| §5 backoff retry schedule | Diagnostics view in Settings | `.glass-faint` (list row) |

### 13.2 `sync_outbox` Queue State Machine (NEW)

The §2.1 schema + the §2 status transitions rendered as the queue's state machine. Every mutation appends a `pending` row in the same transaction (`BR-SYN-01`); the drain loop moves rows through `pending → sent` (success) or `pending → conflict` (409 from server) or `pending → expired` (5 retries exceeded, `EC-SY-02`). The `payload` column is **immutable** after insert (`BR-SYN-02`, enforced by `trg_sync_outbox_payload_immutable`); only `status`, `retries`, `last_error`, `sent_at`, `synced_at` are mutable.

```
  SYNC_OUTBOX QUEUE STATE MACHINE  (§2.1 schema, §2 status transitions)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │   ┌──────────────────────┐                                                 │
  │   │  (mutation happens)   │   ← INSERT/UPDATE/DELETE on a business table   │
  │   │   e.g. record payment │      (ledger_entries, students, attendance…)   │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              │  same SQLite transaction (BR-SYN-01)                         │
  │              │  ← trigger trg_sync_outbox_payload_immutable makes payload   │
  │              │    read-only after INSERT (BR-SYN-02)                        │
  │              ▼                                                             │
  │   ┌──────────────────────┐                                                 │
  │   │  status = 'pending'   │   ← created_at = nowISO() (skew-adjusted §6.2) │
  │   │  retries = 0          │      payload = {sql, params, created_at,        │
  │   │  last_error = NULL    │                 client_id}  (IMMUTABLE)          │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │              │  drain loop picks row (ORDER BY created_at ASC, LIMIT 50)    │
  │              │  ← triggered by: app foreground, manual sync tap, iOS        │
  │              │    background fetch (~30 min), Android foreground service    │
  │              ▼                                                             │
  │   ┌──────────────────────┐                                                 │
  │   │  client.execute({     │   ← libSQL HTTP, 10s timeout (§3.2)            │
  │   │    sql, args })       │                                                 │
  │   └──────────┬───────────┘                                                 │
  │              │                                                             │
  │      ┌───────┼────────┬─────────────┬──────────────┐                       │
  │      │       │        │             │              │                       │
  │      ▼       ▼        ▼             ▼              ▼                       │
  │   ┌──────┐ ┌──────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
  │   │ 200  │ │ 409  │ │ 426      │ │ 401      │ │ 5xx /    │                 │
  │   │ OK   │ │ conf-│ │ Upgrade  │ │ Unauth-  │ │ timeout  │                 │
  │   │      │ │ lict │ │ Required │ │ expired  │ │ (transient)               │
  │   └──┬───┘ └──┬───┘ └────┬─────┘ └────┬─────┘ └────┬─────┘                 │
  │      │        │          │            │            │                       │
  │      ▼        ▼          ▼            ▼            ▼                       │
  │   ┌──────┐ ┌──────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
  │   │ sent │ │ conf-│ │ pause    │ │ reauth   │ │ retries+1│                 │
  │   │      │ │ lict │ │ sync     │ │ via      │ │ backoff  │                 │
  │   │      │ │      │ │ (EC-SY-  │ │ Supabase │ │ 1s,2s,4s,│                 │
  │   │      │ │      │ │  08)     │ │          │ │ 8s,16s   │                 │
  │   └──┬───┘ └──┬───┘ └──────────┘ └──────────┘ └────┬─────┘                 │
  │      │        │                                    │                       │
  │      │        │                                    │ retries >= 5?         │
  │      │        │                                    ├─────YES─────┐         │
  │      │        │                                    │             ▼         │
  │      │        │                                    │      ┌──────────┐      │
  │      │        │                                    │      │ expired  │      │
  │      │        │                                    │      │ (EC-SY-02)│     │
  │      │        │                                    │      └──────────┘      │
  │      │        │                                    │                        │
  │      │        │                                    └─────NO─────┐           │
  │      │        │                                                 ▼           │
  │      │        │                                          (back to pending)  │
  │      │        │                                                             │
  │      ▼        ▼                                                             │
  │   ┌──────────────────────────────────────────────────────────────┐         │
  │   │  audit_log row written for every transition:                 │         │
  │   │   action='sync_sent' / 'sync_conflict' / 'sync_expired'      │         │
  │   │   metadata={ table, row_id, retries, last_error }            │         │
  │   │   ← BR-SEC-08 (audit every sensitive action)                  │         │
  │   └──────────────────────────────────────────────────────────────┘         │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The queue is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ The sync drawer in 03_Navigation_and_State.md §11.4 IS the live surface
     that renders conflict rows as .glass-faint bands with .neumo-raised
     "Keep Local / Take Remote / View Audit" buttons.
   ↑ Money in payload is INTEGER paise (BR-M-01, AP-17); no float crosses
     the queue — amount=500000 in the payload replays as ₹5,000.00 on Turso.
   ↑ Cross-refs: §2 + §3 + §5 (this file), 02_Native_Modules_and_Storage.md
     §2.4 (local-first write path that appends the row), 03_Navigation_and_
     State.md §11.4 (sync drawer consumer), BR-SYN-01, BR-SYN-02, EC-SY-02.
```

### 13.3 LWW Conflict-Resolution Flow (NEW)

The §4.4 `mergeRow` implementation rendered as the decision tree each pulled remote row traverses. Three terminal states: `merged` (remote is new, INSERT locally), `remote_won` (remote `updated_at` newer, UPDATE locally + audit), `local_won` (local `updated_at` newer, no change + audit). Every conflict writes an `audit_log` row with `action='sync_conflict_resolved'` (`BR-SEC-08`, `BR-SYN-03`). The ledger is conflict-immune (`BR-SYN-04`) — its rows are UUID v7-keyed and INSERT-only, so two devices posting payments for the same student simply produce two different ledger rows that both land.

```
  LWW CONFLICT-RESOLUTION FLOW  (§4.4 mergeRow, BR-SYN-03)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                            │
  │   ┌────────────────────────┐                                               │
  │   │  pull brings remote row │   ← SELECT * FROM <table>                    │
  │   │  for table T, row id R  │     WHERE updated_at > last_pulled_at         │
  │   │  (e.g. students, id=42) │     ORDER BY updated_at ASC LIMIT 500 (§4.1) │
  │   └────────────┬───────────┘                                               │
  │                │                                                           │
  │                ▼                                                           │
  │   ┌────────────────────────┐                                               │
  │   │  SELECT updated_at      │   ← local SQLite lookup                      │
  │   │  FROM T WHERE id = R    │                                              │
  │   └────────────┬───────────┘                                               │
  │                │                                                           │
  │       ┌────────┴────────┐                                                  │
  │       │ local row exists?│                                                  │
  │       └────────┬────────┘                                                  │
  │           NO   │   YES                                                     │
  │        ┌───────┘   └───────┐                                                │
  │        ▼                   ▼                                                │
  │   ┌──────────┐    ┌─────────────────────┐                                  │
  │   │  INSERT   │    │ compare timestamps  │                                  │
  │   │  locally  │    │ local.updated_at vs │                                  │
  │   │           │    │ remote.updated_at   │                                  │
  │   └─────┬────┘    └──────────┬──────────┘                                  │
  │         │                    │                                             │
  │         │           ┌────────┼────────┬─────────────┐                      │
  │         │           │        │        │             │                      │
  │         │           ▼        ▼        ▼             ▼                      │
  │         │      equal    remote >  remote <      (tie — Lamport             │
  │         │      timestamps local     local        counter, §4.4)            │
  │         │           │        │        │             │                      │
  │         │           ▼        ▼        ▼             ▼                      │
  │         │      ┌──────┐ ┌──────┐ ┌──────┐    ┌──────────────┐              │
  │         │      │ no   │ │UPDATE│ │ no   │    │ client_id    │              │
  │         │      │ conf-│ │ local│ │ conf-│    │ tiebreak     │              │
  │         │      │ lict │ │ from │ │ lict │    │ (deterministic)             │
  │         │      │      │ │ remote│ │      │    │              │              │
  │         │      └──┬───┘ └──┬───┘ └──┬───┘    └──────┬───────┘              │
  │         │         │        │        │               │                      │
  │         ▼         ▼        ▼        ▼               ▼                      │
  │   ┌──────────────────────────────────────────────────────────────┐         │
  │   │  terminal state written to audit_log:                         │         │
  │   │   'merged'       (remote new, INSERTed)                       │         │
  │   │   'no_conflict'  (timestamps equal, no-op)                    │         │
  │   │   'remote_won'   (UPDATEd local from remote)                  │         │
  │   │   'local_won'    (no change; audit for trail)                 │         │
  │   │   ← action='sync_conflict_resolved' (BR-SEC-08, BR-SYN-03)    │         │
  │   │   ← metadata={ table, row_id, winner, local_updated_at,       │         │
  │   │               remote_updated_at }                              │         │
  │   └──────────────────────────────────────────────────────────────┘         │
  │                                                                            │
  │  PER-TABLE STRATEGY EXCEPTIONS (§4.2)                                      │
  │   ↑ ledger_entries  → INSERT-only (UUID v7-keyed, BR-SYN-04 conflict-     │
  │     immune — never enters this flow)                                       │
  │   ↑ audit_log       → INSERT-only (UUID v7-keyed)                          │
  │   ↑ receipts        → INSERT-only (append-only by nature)                  │
  │   ↑ settings        → LWW + field-level merge for next_invoice_seq,        │
  │     next_receipt_seq, next_student_seq (max-wins, never decrement)         │
  │   ↑ app_state       → pull only schema_version (ignore tenant_secret)     │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The flow is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ The audit row IS the canonical trail; the sync drawer's "View Audit"
     button (03_Navigation_and_State.md §11.4) opens the audit row inline.
   ↑ Cross-refs: §4.4 (this file), 02_Native_Modules_and_Storage.md §2.3
     (append-only tables bypass this flow), 03_Navigation_and_State.md §11.4
     (sync drawer consumer), BR-SYN-03 (LWW), BR-SYN-04 (ledger immune),
     BR-SEC-08 (audit), 10_Security.md §9 (LEDGER-* triggers).
```

### 13.4 Pull→Push Merge Sequence (NEW)

The §9 pull-push window rendered as the temporal sequence of a single sync cycle. Pull runs first (brings in remote changes that might affect local writes), then push (sends local mutations to a fresh view of the server). The window between pull and push is typically <100ms (one HTTP round-trip); during it, local SQLite is briefly ahead of the server (it has pulled rows + local pending writes that haven't pushed yet). This is fine — the UI reads local SQLite, which is always the most current view. A sync lock (`app_state.sync_in_progress = 1`) prevents concurrent cycles, backup during sync (`EC-SY-04`), and restore during sync.

```
  PULL→PUSH MERGE SEQUENCE  (one sync cycle, §9 + §9.1 sync lock)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  TIME →                                                                    │
  │                                                                            │
  │  t=0ms   sync trigger fires                                                │
  │          (app foreground OR manual tap OR iOS bg fetch OR Android svc)     │
  │                              │                                             │
  │                              ▼                                             │
  │  t=10ms  ┌─────────────────────────────────────┐                          │
  │          │  check sync lock                     │   ← app_state.           │
  │          │  app_state.sync_in_progress = 1      │     sync_in_progress     │
  │          │  ← prevents concurrent cycles,       │                          │
  │          │    backup during sync (EC-SY-04),    │                          │
  │          │    restore during sync               │                          │
  │          └──────────────┬──────────────────────┘                          │
  │                         │                                                 │
  │                         ▼                                                 │
  │  t=20ms  ┌─────────────────────────────────────┐                          │
  │          │  PULL phase  (§4)                    │                          │
  │          │   for each table T (dependency order)│                          │
  │          │     SELECT * FROM T                  │                          │
  │          │     WHERE updated_at > last_pulled   │                          │
  │          │     ORDER BY updated_at ASC LIMIT 500│                          │
  │          │   ← libSQL HTTP, 10s timeout         │                          │
  │          │   ← merge each row via §4.4 mergeRow │                          │
  │          │   ← audit rows written for conflicts │                          │
  │          └──────────────┬──────────────────────┘                          │
  │                         │                                                 │
  │            (window: <100ms; local SQLite briefly ahead of server)         │
  │                         │                                                 │
  │                         ▼                                                 │
  │  t=1.5s  ┌─────────────────────────────────────┐   (500-row pull typical) │
  │          │  PULL complete                       │                          │
  │          │  app_state.last_pulled_at = nowISO() │                          │
  │          │  queryClient.invalidateQueries()     │   ← UI re-renders        │
  │          └──────────────┬──────────────────────┘                          │
  │                         │                                                 │
  │                         ▼                                                 │
  │  t=1.6s  ┌─────────────────────────────────────┐                          │
  │          │  PUSH phase  (§3, drain outbox)     │                          │
  │          │   SELECT * FROM sync_outbox          │                          │
  │          │   WHERE status='pending'             │                          │
  │          │   ORDER BY created_at ASC LIMIT 50   │                          │
  │          │   for each row: client.execute(sql)  │                          │
  │          │   ← status transition per §13.2      │                          │
  │          │   ← backoff per §5.1 (1s,2s,4s,8s,16s)│                         │
  │          └──────────────┬──────────────────────┘                          │
  │                         │                                                 │
  │                         ▼                                                 │
  │  t=4.5s  ┌─────────────────────────────────────┐   (50-row drain typical) │
  │          │  PUSH complete                       │                          │
  │          │  app_state.sync_in_progress = 0      │   ← lock released        │
  │          │  sync chip → 'synced' (emerald dot)  │   ← 03_Nav §8.1          │
  │          │  Haptics.notificationAsync(SUCCESS)  │   ← only if >10 rows     │
  │          │     (§8.2)                           │      pushed              │
  │          └──────────────────────────────────────┘                          │
  │                                                                            │
  │  IF LOCK CRASHES MID-CYCLE:                                                │
  │   ↑ clearStaleSyncLock startup probe (§9.1) clears the lock on next        │
  │     app launch — a crashed cycle never permanently wedges sync.             │
  │                                                                            │
  └──────────────────────────────────────────────────────────────────────────┘
   ↑ The sequence is structural, not a rendered UI surface — no glass tier
     annotation here (§6.6 single rule applies to live components only).
   ↑ The sync chip (03_Navigation_and_State.md §7 + §8) is the live surface
     that reflects the cycle: ◐ syncing (cyan) → ● synced (emerald) OR
     ✕ failed (flare). The sync drawer (03_Nav §11.4) is the detail surface.
   ↑ Money is INTEGER paise throughout (BR-M-01, AP-17); the pull and push
     never convert to float — amount=500000 in the payload replays exactly.
   ↑ Cross-refs: §3 + §4 + §9 (this file), 02_Native_Modules_and_Storage.md
     §3.3 (what goes over the wire), 03_Navigation_and_State.md §8 (sync
     indicator state machine), 03_Navigation_and_State.md §11.4 (drawer),
     BR-SYN-01 (same-tx outbox), BR-SYN-03 (LWW), EC-SY-04 (sync vs backup).
```

### 13.5 References (External Design Authorities)

The mockups and the sync primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the outbox pattern, the LWW strategy, or the pull→push ordering.

- **Pat Helland** — *Life beyond Distributed Transactions* (2016). The §2 outbox pattern (write the mutation + the outbox row in one local transaction; drain asynchronously) follows Helland's canonical outbox design.
- **Turso docs** — *libSQL client, embedded replicas, HTTP transport*. The §3 libSQL HTTP client choice (over WebSocket / embedded-replica) and the §4.1 pull strategy follow Turso's per-tenant sync documentation.
- **Apple Human Interface Guidelines** — *Mobile, background execution, sync indicators*. The §8 sync indicator four-state (synced / syncing / pending / failed) follows Apple HIG's mobile-status-indicator guidance.
- **Material Design 3** — *Android sync patterns, background services*. The §3.2 Android foreground service drain (30s interval while app is active) follows Material 3's background-task guidance.
- **Smashing Magazine** — *Mobile UX: Offline-First Conflict Resolution*. The §4.4 LWW strategy and the §9 pull→push ordering follow Smashing's offline-first mobile UX research.
- **Martin Kleppmann** — *Designing Data-Intensive Applications* (2017). The §4.5 ledger conflict-immunity rationale (UUID v7 + append-only = no conflict possible) follows Kleppmann's chapter on conflict resolution.
- **Jepsen** — *SQLite and Turso consistency analysis*. The §2.1 `PRAGMA synchronous=NORMAL` durability tradeoff (acceptable because every mutation is also in the outbox for remote replication) follows Jepsen's SQLite consistency research.
- **CSS-Tricks** — *`env(safe-area-inset-*)` on mobile*. The sync drawer (consumer in `03_Navigation_and_State.md` §11.4) respects the safe-area inset for its footer CTAs.

---

*End of 04 — Offline Sync and Conflict Resolution. Next file: `05_EAS_Build.md`.*
