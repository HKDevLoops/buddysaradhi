# 02 — Rust Core (Backend Implementation)

> The Rust backend is the spine of the desktop app. It owns the SQLCipher-encrypted SQLite database, the libsql sync client, the OS keychain handle, the audit log writer, and the typed `Error` enum that every command returns. This file is the contract for `src-tauri/src/`: file layout, `AppState`, the database open + migration flow, the sync engine, the seven Tauri commands the frontend may invoke, the read-only helpers, and the error type that serializes across the IPC boundary.

Cross-references: `01_Architecture.md` (project layout, allowlist), `03_IPC_Security.md` (capability JSON, keychain, CSP), `10_Security.md` §5/§14 (data at rest, SQLCipher), `11_Data_Model.md` (schema), `12_Business_Rules.md` (BR-LED-*, BR-SYN-*, BR-SEC-*, BR-IMP-*, BR-ATT-*, BR-FEE-*), `09_Backup_and_Import_Export.md` §15 (Argon2id + AES-256-GCM envelope), `14_Edge_Cases.md` (EC-SY-*, EC-SEC-*). The 10 non-negotiable rules in top-level `AGENTS.md` §2 apply unchanged — especially Rule 1 (append-only ledger), Rule 6 (integer paise), Rule 7 (sync_outbox), Rule 9 (no silent failures).

---

## 1. Crate Manifest (`Cargo.toml`)

```toml
# src-tauri/Cargo.toml
[package]
name = "buddysaradhi-desktop"
version = "1.4.2"
edition = "2021"
rust-version = "1.82"
authors = ["Buddysaradhi <engineering@buddysaradhi.app>"]
description = "Buddysaradhi desktop backend (Tauri v2 + Rust)"

[lib]
name = "buddysaradhi_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = ["protocol-asset"] }
tauri-plugin-shell = "2.0"
tauri-plugin-dialog = "2.0"
tauri-plugin-fs = "2.0"
tauri-plugin-store = "2.0"
tauri-plugin-updater = "2.0"
tauri-plugin-biometric = "2.0"

# Database
rusqlite = { version = "0.31", features = ["bundled-sqlcipher", "blob", "chrono", "serde_json"] }
libsql = "0.4"
refinery = { version = "0.8", features = ["rusqlite"] }

# Crypto
argon2 = "0.5"
aes-gcm = "0.10"
rand = "0.8"
zeroize = { version = "1.7", features = ["zeroize_derive"] }
sha2 = "0.10"
subtle = "2.5"

# OS / keychain
keyring = "2.3"
directories = "5.0"

# Async + serialization
tokio = { version = "1.37", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Error + logging
thiserror = "1.0"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# Validation
validator = { version = "0.18", features = ["derive"] }

# Misc
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1.8", features = ["v7", "serde"] }
once_cell = "1.19"
parking_lot = "0.12"

[profile.release]
panic = "abort"        # smaller binary
codegen-units = 1      # better optimization, slower compile
lto = true             # link-time optimization
strip = true           # strip debug symbols
opt-level = "z"        # optimize for size (we are < 15 MB ceiling)
```

### 1.1 Why These Crates

- **`rusqlite` with `bundled-sqlcipher`**: Bundles a statically-linked SQLite + SQLCipher; no system dependency. The `bundled-sqlcipher` feature compiles SQLCipher into the binary — at-rest encryption with zero system install.
- **`libsql`**: The official Turso/libSQL Rust client. Used for HTTP polling sync to the per-user Turso DB.
- **`refinery`**: Forward-only migration runner with embedded SQL files. Simpler than `sqlx-cli` for our single-connection model; doesn't require a separate `sqlx-data.json`.
- **`argon2` + `aes-gcm`**: Mirror of the web app's `crypto/backup.ts` (`09_Backup_and_Import_Export.md` §15.2–15.3). Argon2id m=64 MiB / t=3 / p=2; AES-256-GCM with 96-bit nonce + 128-bit tag.
- **`zeroize`**: The `SecureBuffer` pattern from `10_Security.md` §5.1. Every long-lived secret in process memory (SQLCipher key, derived backup key, biometric envelope key, PIN) is wrapped in `Zeroizing<Vec<u8>>` and zeroed on drop.
- **`keyring`**: Cross-platform OS keychain access (macOS Keychain, Windows Credential Manager, Linux Secret Service / D-Bus).
- **`thiserror`**: Derive `Error` for the typed `Error` enum (§8).
- **`validator`**: Derive-based field validation on input structs (mirror of the Zod schemas in `packages/shared`).

### 1.2 Why `panic = "abort"` in Release

A panic in the Rust backend would otherwise unwind the stack and might leave the database connection in an inconsistent state. With `panic = "abort"`, the process dies cleanly, the OS keychain entry remains, and the next launch detects the crash via the `app_state.last_crash` flag in `tauri-plugin-store` and offers to restore from the most recent backup. This is the same panic discipline as `10_Security.md` §3.6 (Panic PIN).

---

## 2. `src-tauri/src/main.rs` Structure

```rust
// src-tauri/src/main.rs
// Implements: Buddysaradhi_Planning/desktop/02_Rust_Core.md §2 (Builder structure)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use buddysaradhi_desktop_lib::{AppState, commands, Error};
use tauri::Manager;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env()
            .add_directive("buddysaradhi=info".parse().unwrap()))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_biometric::Builder::default().build())
        .setup(|app| {
            // Block 1: initialise AppState (opens SQLCipher DB + keychain).
            let state = AppState::init(app.handle())?;
            app.manage(state);

            // Block 2: spawn the sync outbox flusher (every 30s).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                buddysaradhi_desktop_lib::sync::run_flusher(handle).await;
            });

            // Block 3: spawn the updater check (on launch + every 6h).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                buddysaradhi_desktop_lib::updater::run_periodic_check(handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 7 sensitive commands (the bridge contract)
            commands::students::get_students,
            commands::students::create_student,
            commands::ledger::record_payment,
            commands::ledger::void_ledger_entry,
            commands::attendance::mark_attendance,
            commands::backup::create_backup,
            commands::backup::restore_backup,
            // Read-only helpers (full list in §6.2)
            commands::students::get_student,
            commands::students::update_student,
            commands::students::archive_student,
            commands::attendance::get_attendance_session,
            commands::attendance::lock_attendance_session,
            commands::attendance::unlock_attendance_session,
            commands::dashboard::get_kpis,
            commands::dashboard::get_recent_activity,
            commands::dashboard::get_reminders,
            commands::ledger::get_fee_matrix,
            commands::ledger::get_receipt_pdf,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::get_audit_log,
            commands::auth::unlock,
            commands::auth::lock,
            commands::auth::biometric_unlock,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Buddysaradhi desktop application");
}
```

The `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` attribute is critical on Windows — without it, the app opens a console window alongside the GUI in release builds.

### 2.1 The Three Setup Blocks

**Block 1 — `AppState::init`.** Opens (or creates) the SQLCipher-encrypted SQLite DB at the OS-appropriate path (`10_Security.md` §14.2):

| OS | DB path |
|---|---|
| Windows | `%APPDATA%\Buddysaradhi\buddysaradhi.db` |
| macOS | `~/Library/Application Support/Buddysaradhi/buddysaradhi.db` |
| Linux | `~/.local/share/Buddysaradhi/buddysaradhi.db` |

The SQLCipher key is fetched from the OS keychain (`keyring::Entry::new("buddysaradhi", "sqlcipher-key")`). On first run, a 32-byte random key is generated with `rand::thread_rng().fill_bytes()`, stored in the keychain, and used to open the DB. The key is **never** written to disk; the keychain is the only persistent storage.

If the keychain entry is missing on a non-fresh install (e.g. the user wiped the keychain but kept the DB file), the app shows the "Recover from backup" flow (`10_Security.md` §18.1).

**Block 2 — `run_flusher`.** Spawns a tokio task that wakes every 30s, reads pending rows from `sync_outbox`, and pushes them to libsql via HTTP. Details in §5. The flusher respects `BR-SYN-01..07` (offline-first, append-only outbox, LWW for non-ledger rows, UUID-keyed ledger).

**Block 3 — `run_periodic_check`.** Spawns a tokio task that calls `tauri-plugin-updater::check()` on launch and every 6 hours. Details in `05_Updater.md`.

---

## 3. `AppState` (State Management)

```rust
// src-tauri/src/state.rs
// Implements: Buddysaradhi_Planning/desktop/02_Rust_Core.md §3 (AppState struct)

use std::sync::{Mutex, OnceCell, RwLock};
use rusqlite::Connection;
use libsql::Client;
use keyring::Entry;
use parking_lot::Mutex as PMutex;
use tauri::AppHandle;

pub struct AppState {
    /// The single SQLCipher-encrypted SQLite connection.
    /// Every Tauri command acquires this lock, runs in a transaction, releases.
    /// `parking_lot::Mutex` is non-poisoning — a panic in one command does not
    /// brick the whole app.
    pub db: PMutex<Connection>,

    /// The libsql HTTP client. Initialised lazily on first sync (the user might
    /// be offline at launch). `OnceCell` because the client is read-only after
    /// init — no need for a Mutex.
    pub libsql: OnceCell<Client>,

    /// OS keychain handle for the SQLCipher key + Supabase refresh token +
    /// Turso db_token. Three separate `Entry`s under the "buddysaradhi" service.
    pub keyring_sqlcipher: Entry,
    pub keyring_supabase: Entry,
    pub keyring_turso: Entry,

    /// The app's session state: locked / unlocked, last unlock timestamp,
    /// failed PIN attempt count, biometric-disabled-until timestamp.
    /// Mirrors the `app_lock_state` machine in `10_Security.md` §3.1.
    pub session: Mutex<Session>,

    /// Cached `settings` table (the single row). Read-heavy, write-rare.
    /// `RwLock` because reads outnumber writes 100:1.
    pub settings: RwLock<Settings>,

    /// The Tauri app handle, used by background tasks (sync, updater) to
    /// emit events to the frontend.
    pub app_handle: AppHandle,
}

#[derive(Clone, Debug)]
pub struct Session {
    pub state: LockState,
    pub last_unlock: Option<chrono::DateTime<chrono::Utc>>,
    pub fail_count: u32,
    pub biometric_disabled_until: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockState {
    Locked,
    Unlocked,
    Panic, // see 10_Security.md §3.6
}

impl AppState {
    pub fn init(app: AppHandle) -> Result<Self, Error> {
        let dirs = directories::ProjectDirs::from("app", "buddysaradhi", "Buddysaradhi")
            .ok_or(Error::Io("Cannot resolve project dirs".into()))?;
        let db_path = dirs.data_dir().join("buddysaradhi.db");

        let keyring_sqlcipher = Entry::new("buddysaradhi", "sqlcipher-key")?;
        let key = Self::get_or_create_key(&keyring_sqlcipher)?;

        let db = Self::open_encrypted_db(&db_path, &key)?;
        Self::run_migrations(&db)?;

        let settings = Self::load_settings(&db)?;

        Ok(Self {
            db: PMutex::new(db),
            libsql: OnceCell::new(),
            keyring_sqlcipher,
            keyring_supabase: Entry::new("buddysaradhi", "supabase-refresh")?,
            keyring_turso: Entry::new("buddysaradhi", "turso-db-token")?,
            session: Mutex::new(Session {
                state: LockState::Locked,
                last_unlock: None,
                fail_count: 0,
                biometric_disabled_until: None,
            }),
            settings: RwLock::new(settings),
            app_handle: app,
        })
    }

    fn get_or_create_key(entry: &Entry) -> Result<Zeroizing<Vec<u8>>, Error> {
        match entry.get_password() {
            Ok(s) => {
                let mut bytes = Zeroizing::new(vec![0u8; 32]);
                base64::decode_config_slice(&s, base64::STANDARD, &mut *bytes)?;
                Ok(bytes)
            }
            Err(keyring::Error::NoEntry) => {
                let mut bytes = Zeroizing::new(vec![0u8; 32]);
                rand::thread_rng().fill_bytes(&mut *bytes);
                let b64 = base64::encode(&*bytes);
                entry.set_password(&b64)?;
                Ok(bytes)
            }
            Err(e) => Err(Error::Auth(format!("Keychain error: {e}"))),
        }
    }

    fn open_encrypted_db(path: &Path, key: &[u8]) -> Result<Connection, Error> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let key_hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
        conn.pragma_update(None, "key", &key_hex)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "temp_store", "MEMORY")?;
        Ok(conn)
    }

    fn run_migrations(conn: &Connection) -> Result<(), Error> {
        use refinery::embed_migrations;
        embed_migrations!("src-tauri/migrations");
        migrations::runner().run(conn)?;
        Ok(())
    }

    fn load_settings(conn: &Connection) -> Result<Settings, Error> {
        // SELECT * FROM settings LIMIT 1
        // ... (parses the single-row settings table)
    }
}
```

### 3.1 Why `parking_lot::Mutex` for the DB

The standard library's `std::sync::Mutex` is *poisoning* — if a thread panics while holding the lock, all subsequent `lock()` calls return `PoisonError`. For a desktop app where the DB lock is held during every Tauri command, a single panic would brick the app until restart. `parking_lot::Mutex` is non-poisoning; the next command can still acquire the lock (the DB connection itself is unaffected by the panic — the transaction was never committed).

### 3.2 The Session State Machine

The `Session` struct mirrors the `app_lock_state` machine in `10_Security.md` §3.1. State transitions:

```
                cold start / idle timeout / app backgrounded
   Unlocked ──────────────────────────────────────────────► Locked
       ▲                                                      │
       │ biometric OK / PIN OK                                │
       │                                                      │
       └──────────────────────────────────────────────────────┘
                          (5 fails → 30s lockout, biometric disabled;
                           10 fails → 5min lockout;
                           15 fails → wipe local cache per BR-SEC-03)
```

The wipe at 15 fails deletes the keychain entries (SQLCipher key, Supabase token, Turso token) and `VACUUM`s the DB file — the crypto-shred flow from `10_Security.md` §18.1. The cloud DB is intact; the tutor re-logs in and re-syncs.

---

## 4. rusqlite + SQLCipher

The local SQLite database is encrypted at rest with SQLCipher. The key derivation is Argon2id **only for backups** — the SQLCipher key itself is a 32-byte random key stored in the OS keychain, not derived from a user passphrase. (The user passphrase is what unlocks the backup; the SQLCipher key is what the OS keychain releases on biometric unlock.)

### 4.1 The Open Sequence

```
1. Read SQLCipher key from OS keychain (keyring::Entry "buddysaradhi" / "sqlcipher-key")
   ├─ If missing and DB file exists → "Recover from backup" flow (10_Security §18.1)
   └─ If missing and DB file does not exist → first run; generate 32 random bytes;
                                              store in keychain; use to open new DB
2. Connection::open(path)
3. PRAGMA key = '<hex of 32 bytes>'
4. PRAGMA journal_mode = WAL           (write-ahead logging; concurrent reads + writes)
5. PRAGMA synchronous = NORMAL         (WAL-safe, faster than FULL)
6. PRAGMA foreign_keys = ON            (enforce FK constraints)
7. PRAGMA temp_store = MEMORY          (temp tables in RAM, not disk)
8. Run pending migrations (refinery, see §4.3)
```

### 4.2 Why WAL + NORMAL Synchronous

WAL (Write-Ahead Logging) is the only SQLite journal mode that supports concurrent readers during a write — critical for the desktop app where the UI is querying the DB while the sync engine is writing. `synchronous = NORMAL` is safe under WAL (writes are still durable on WAL checkpoint; only the last transaction might be lost on power failure, which we accept for a single-user app). `synchronous = FULL` would halve write throughput for no perceptible safety gain in this context.

Backups issue `PRAGMA wal_checkpoint(TRUNCATE)` before reading — this flushes the WAL into the main DB file and ensures the backup is a consistent snapshot (`10_Security.md` §14.2).

### 4.3 Migrations (refinery)

```rust
// src-tauri/migrations/V0001__init.sql
-- Implements: 11_Data_Model.md §4 (per-entity schema)
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tenant_id TEXT NOT NULL,
    tutor_name TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'INR',
    session_timeout_min INTEGER NOT NULL DEFAULT 5,
    pin_hash TEXT,
    biometric_enabled INTEGER NOT NULL DEFAULT 0 CHECK (biometric_enabled IN (0,1)),
    next_receipt_seq INTEGER NOT NULL DEFAULT 1,
    next_invoice_seq INTEGER NOT NULL DEFAULT 1,
    receipt_prefix TEXT NOT NULL DEFAULT 'RCT',
    invoice_prefix TEXT NOT NULL DEFAULT 'INV',
    tenant_secret TEXT NOT NULL,          -- pepper for tamper hashes
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,                  -- UUID v7
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT,
    -- ... (full schema in 11_Data_Model.md §4.3)
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
-- ... (continued in 11_Data_Model.md §4)

-- src-tauri/migrations/V0002__ledger_triggers.sql
-- Implements: 12_Business_Rules.md BR-LED-01 (append-only triggers)
CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
    SELECT RAISE(ABORT, 'ledger_entries is append-only (BR-LED-01). Use void_ledger_entry.');
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
    SELECT RAISE(ABORT, 'ledger_entries is append-only (BR-LED-01). Voids are new rows.');
END;
```

Migrations are forward-only (per `11_Data_Model.md` §11). `refinery` tracks applied migrations in a `refinery_schema_history` table; on app launch, `migrations::runner().run(&conn)` applies any pending migrations in order. A migration that fails aborts the app launch with a typed `Error::Db` and shows a "Database migration failed — restore from backup?" dialog.

### 4.4 Migration Discipline

- **Never edit a merged migration.** New schema changes are a new `V####__description.sql` file. Editing a merged migration is a P0 bug (top-level `AGENTS.md` §10 #8).
- **Every migration is idempotent.** `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN ...` with a non-NULL default. A migration must succeed if re-run.
- **No destructive `DROP`.** No `DROP TABLE`, no `DROP COLUMN` in v1.x (`11_Data_Model.md` P-DM8). Soft-delete via `archived_at` is the only deletion path.

### 4.5 The Four Ledger Invariants (LEDGER-1..4)

The desktop app inherits the four ledger invariants from `10_Security.md` §9 verbatim:

| ID | Invariant | Desktop enforcement |
|---|---|---|
| **LEDGER-1** | `BEFORE UPDATE` / `BEFORE DELETE` triggers on `ledger_entries` raise `E_LEDGER_IMMUTABLE`. No code path — including migrations — disables these triggers outside a documented, audited migration script. | `trg_ledger_no_update` + `trg_ledger_no_delete` in `V0002__ledger_triggers.sql`. CI lint `no-ledger-mutation.rs` scans for `UPDATE ledger_entries` / `DELETE FROM ledger_entries` in any `.rs` or `.sql` file. |
| **LEDGER-2** | Each row carries `client_seq` (per-tenant monotonic integer) and a UUID v7. Gaps are tolerated; *repeats* are not — `INSERT OR IGNORE` on a UUID collision is sync-idempotency success but logged; an attempted overwrite with different payload raises `E_LEDGER_INTEGRITY_VIOLATION` (`BR-LED-02`). | The `client_seq` column is `INTEGER NOT NULL` with a `UNIQUE(tenant_id, client_seq)` constraint. UUID v7 generated by the `uuid` crate (`uuid::Uuid::now_v7()`). |
| **LEDGER-3** | The running sum of `signed_amount` (charge positive, credit negative) over non-void rows must equal `balance_due` for each `student_id`. The `ledger_reconcile_job` (nightly 01:00 local) recomputes the entire ledger from row 0; any drift writes `E_LEDGER_INTEGRITY_VIOLATION` and surfaces in Settings → Security. | The reconcile job is a Rust tokio task spawned at 01:00 local; on mismatch, it writes an `audit_log` row `action='ledger_integrity_violation'` and emits a `ledger-corrupted` event to the frontend. |
| **LEDGER-4** | No `DELETE FROM ledger_entries` in the codebase. A CI test (`no-ledger-delete.rs`) fails the build if the literal appears in any `.rs` / `.sql` file. The only "deletion" affordance is a void. The single, audited exception is the secure-erase flow (`10_Security.md` §18.1). | The CI lint runs on every PR; the secure-erase flow is the only Rust code path that issues `DELETE FROM ledger_entries`, and it is gated behind `BR-SEC-04` PIN + typed "ERASE" confirmation. |

---

## 5. libsql Sync Engine

The sync engine is a tokio task that wakes every 30s, reads pending rows from `sync_outbox`, and pushes them to the per-user Turso DB via libsql's HTTP client. The pattern mirrors the mobile app (per `02_Core_Logic.md` §3.6 + §19) and the web app's TanStack Query polling.

### 5.1 The Sync Outbox Table

```sql
-- 11_Data_Model.md §3.13
CREATE TABLE IF NOT EXISTS sync_outbox (
    id TEXT PRIMARY KEY,                  -- UUID v7
    tenant_id TEXT NOT NULL,
    table_name TEXT NOT NULL,             -- 'students', 'ledger_entries', etc.
    row_id TEXT NOT NULL,                 -- the row's UUID v7
    operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'void')),
    payload TEXT NOT NULL,                -- JSON snapshot of the row
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'conflict', 'expired')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox(status, created_at);
```

### 5.2 The Flush Loop

```rust
// src-tauri/src/sync/outbox.rs (excerpt)
pub async fn run_flusher(app: AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        if let Err(e) = flush_once(&app).await {
            tracing::warn!("sync flush failed: {e:?}");
            // Do NOT panic — sync failures are recoverable (BR-SYN-02).
            // The next tick will retry.
        }
    }
}

async fn flush_once(app: &AppHandle) -> Result<(), Error> {
    let state = app.state::<AppState>();
    let client = state.libsql.get_or_try_init(|| async {
        let token = state.keyring_turso.get_password()
            .map_err(|e| Error::Auth(format!("Turso token missing: {e}")))?;
        let url = format!("https://buddysaradhi-{}.turso.io", tenant_id(&state)?);
        Client::with_url_and_token(url, token)
    }).await?;

    let pending: Vec<OutboxRow> = {
        let db = state.db.lock();
        db.prepare("SELECT * FROM sync_outbox WHERE status='pending' ORDER BY created_at LIMIT 100")?
            .query_map([], OutboxRow::from_row)?
            .collect::<Result<Vec<_>, _>>()?
    };

    for row in pending {
        match push(&client, &row).await {
            Ok(()) => mark_sent(&state.db.lock(), &row.id)?,
            Err(SyncError::Conflict(server_row)) => {
                resolve_conflict(&state.db.lock(), &row, &server_row)?;
                mark_conflict(&state.db.lock(), &row.id)?;
            }
            Err(SyncError::Transient(e)) => {
                increment_attempts(&state.db.lock(), &row.id, &e.to_string())?;
                if row.attempts >= 5 {
                    mark_expired(&state.db.lock(), &row.id)?;
                    // BR-SYN-02: 5 attempts → status='conflict'; surfaced in Settings → Sync.
                }
            }
        }
    }
    Ok(())
}

async fn push(client: &Client, row: &OutboxRow) -> Result<(), SyncError> {
    match row.operation.as_str() {
        "insert" | "update" => {
            let sql = format!("INSERT OR REPLACE INTO {} (id, ...) VALUES (?1, ...)", row.table_name);
            client.execute(&sql, params![row.row_id, row.payload]).await?;
        }
        "void" => {
            // Ledger voids are just new inserts; this branch is for non-ledger
            // soft-deletes (archived_at = now()).
            let sql = format!("UPDATE {} SET archived_at = ?2 WHERE id = ?1", row.table_name);
            client.execute(&sql, params![row.row_id, row.created_at]).await?;
        }
        _ => return Err(SyncError::Transient("Unknown operation".into())),
    }
    Ok(())
}
```

### 5.3 Conflict Resolution

Per `BR-SYN-03`: non-ledger rows resolve by Last-Writer-Wins on `updated_at`. The `resolve_conflict` function compares the local row's `updated_at` to the server row's; the newer one wins, the loser is logged to `audit_log` with `action='sync_conflict_lost'` and `metadata={before, after}`.

Ledger rows are UUID v7-keyed and append-only (`BR-SYN-04`); two devices posting different entries for the same student both land — there is no conflict to resolve. The only ledger-side concern is duplicate receipts, handled by the `UNIQUE(receipts.number)` constraint + `INSERT OR IGNORE` + a follow-up audit row.

### 5.4 Schema-Drift Refusal

Per `BR-SYN-05`: if the device's `schema_version` < server's, the sync engine refuses to push and surfaces a "Please update Buddysaradhi" notification. Local data remains readable; sync is paused. This prevents an old client from corrupting a new schema.

---

## 6. The 7 Sensitive Tauri Commands (+ Read-Only Helpers)

The frontend may invoke exactly seven sensitive commands (the bridge contract from `01_Architecture.md` §6). Every sensitive command:

1. Validates input with `serde` + `validator` (mirror of the web's Zod parse).
2. Acquires the session lock — if `LockState::Locked`, returns `Error::Auth("App locked")`.
3. For commands on the `BR-SEC-04` allowlist (void, backdate, bulk delete, restore), requires a fresh PIN/biometric challenge (≤ 30s old).
4. Runs the mutation in a single `BEGIN TRANSACTION ... COMMIT` block, with the `audit_log` INSERT and the `sync_outbox` INSERT in the same transaction.
5. Returns `Result<T, Error>` where `Error` is the typed enum from §8.

### 6.1 The 7 Sensitive Commands

```rust
// src-tauri/src/commands/students.rs
use serde::{Deserialize, Serialize};
use tauri::State;
use validator::Validate;
use crate::{AppState, Error, security};

#[derive(Debug, Deserialize, Validate)]
pub struct CreateStudentInput {
    #[validate(length(min = 1, max = 100))]
    pub first_name: String,
    #[validate(length(max = 100))]
    pub last_name: Option<String>,
    #[validate(regex(path = "PHONE_RE"))]
    pub phone: Option<String>,
    // ... (mirror of StudentInputSchema in packages/shared)
    pub batch_id: String,
    #[validate(range(min = 0, max = 1_000_000_00))] // ≤ ₹1 lakh
    pub default_fee_paise: i64,
}

#[derive(Debug, Serialize)]
pub struct Student {
    pub id: String,
    pub code: String,
    pub first_name: String,
    // ... (mirror of Student in packages/shared)
}

#[tauri::command]
pub async fn get_students(
    filter: StudentFilter,
    state: State<'_, AppState>,
) -> Result<Vec<Student>, Error> {
    let db = state.db.lock();
    let mut stmt = db.prepare_cached(
        "SELECT id, code, first_name, last_name, phone, status, archived_at
         FROM students
         WHERE tenant_id = ?1 AND archived_at IS NULL
         ORDER BY first_name, last_name
         LIMIT 500"
    )?;
    let rows = stmt.query_map(params![tenant_id(&state)?], Student::from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub async fn create_student(
    input: CreateStudentInput,
    pin: Option<String>,
    state: State<'_, AppState>,
) -> Result<Student, Error> {
    input.validate()?;
    security::require_unlocked(&state)?;
    // Note: create_student is NOT on the BR-SEC-04 allowlist (it's not destructive).
    // PIN is required only if the tutor has "PIN for every mutation" enabled.

    let student = {
        let mut db = state.db.lock();
        let tx = db.transaction()?;

        let id = uuid::Uuid::now_v7().to_string();
        let code = next_student_code(&tx)?;
        let now = chrono::Utc::now().to_rfc3339();

        tx.execute(
            "INSERT INTO students (id, tenant_id, code, first_name, last_name, phone, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)",
            params![id, tenant_id(&state)?, code, input.first_name, input.last_name, input.phone, now],
        )?;

        // Append to sync_outbox in the same transaction (Rule 7 — BR-SYN-02).
        tx.execute(
            "INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, operation, payload, status, created_at)
             VALUES (?1, ?2, 'students', ?3, 'insert', ?4, 'pending', ?5)",
            params![uuid::Uuid::now_v7().to_string(), tenant_id(&state)?, id, serde_json::to_string(&input)?, now],
        )?;

        // Audit log (BR-SEC-08).
        tx.execute(
            "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
             VALUES (?1, ?2, 'tutor', 'student_create', 'students', ?3, ?4, ?5)",
            params![uuid::Uuid::now_v7().to_string(), tenant_id(&state)?, id, serde_json::json!({"source": "manual"}).to_string(), now],
        )?;

        tx.commit()?;

        Student { id, code, first_name: input.first_name, /* ... */ }
    };

    Ok(student)
}
```

```rust
// src-tauri/src/commands/ledger.rs
#[derive(Debug, Deserialize, Validate)]
pub struct RecordPaymentInput {
    pub student_id: String,
    pub invoice_id: Option<String>,
    #[validate(range(min = 1, max = 1_000_000_00))]  // 1 paise to ₹1 lakh
    pub amount_paise: i64,
    pub method: String,        // cash | upi | cheque | card | bank_transfer
    pub reference: Option<String>,  // UTR / cheque number
    pub occurred_on: chrono::NaiveDate,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn record_payment(
    input: RecordPaymentInput,
    pin: String,
    state: State<'_, AppState>,
) -> Result<LedgerEntry, Error> {
    input.validate()?;
    security::require_unlocked(&state)?;
    security::require_fresh_pin(&state, &pin, "record_payment")?; // BR-SEC-04

    let mut db = state.db.lock();
    let tx = db.transaction()?;

    // 1. Backdated check (BR-LED-07): if occurred_on < last locked session date,
    //    require PIN (already required above) and log audit.
    // 2. Overpayment check (BR-FEE-04): if amount > balance_due, split into
    //    PAYMENT_RECEIVED + [ADVANCE] PAYMENT_RECEIVED.
    // 3. Insert ledger_entries row with prev_hash chain (BR-LED-06).
    // 4. Insert receipts row with tamper_hash.
    // 5. Update invoices.status (paid / partial).
    // 6. Update fee_schedule_items.status.
    // 7. Atomic next_receipt_seq increment via RETURNING.
    // 8. Append sync_outbox + audit_log rows.
    // (Full 8-step transaction in 07_Fees_and_Payments.md §9.)

    let entry = ledger::post_payment(&tx, &input, &tenant_id(&state)?)?;
    tx.commit()?;
    Ok(entry)
}

#[tauri::command]
pub async fn void_ledger_entry(
    id: String,
    reason: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<LedgerEntry, Error> {
    // BR-LED-04: voiding requires PIN + new VOID row mirroring original.
    // BR-LED-05: a VOID cannot itself be voided.
    // BR-LED-08: 24h lock of attendance session applies to linked ledger entries.
    // BR-LED-09: voiding a FEE_CHARGED requires no crediting PAYMENT_RECEIVED.
    // ...
}
```

```rust
// src-tauri/src/commands/attendance.rs
#[derive(Debug, Deserialize, Validate)]
pub struct MarkAttendanceInput {
    pub batch_id: String,
    pub session_date: chrono::NaiveDate,
    pub marks: Vec<Mark>,  // [{student_id, status, notes}]
}

#[tauri::command]
pub async fn mark_attendance(
    input: MarkAttendanceInput,
    state: State<'_, AppState>,
) -> Result<AttendanceRow, Error> {
    // BR-ATT-01: one session per (batch, date). Upsert.
    // BR-ATT-02: status ∈ {present, absent, late, excused, holiday}.
    // BR-ATT-03: bulk present OK; bulk absent requires typed "ABSENT" confirm (frontend).
    // BR-ATT-06: bulk mark only affects unlocked sessions.
    // BR-ATT-07: auto-lock 24h after session_date.
    // ...
}

#[tauri::command]
pub async fn lock_attendance_session(
    batch_id: String,
    session_date: chrono::NaiveDate,
    pin: String,
    state: State<'_, AppState>,
) -> Result<(), Error> {
    // BR-ATT-07: requires PIN (BR-SEC-04).
    // ...
}
```

```rust
// src-tauri/src/commands/backup.rs
#[derive(Debug, Deserialize, Validate)]
pub struct CreateBackupInput {
    #[validate(length(min = 12, max = 256))]  // BR-SEC-06
    pub passphrase: String,
    pub destination: std::path::PathBuf,  // from dialog:allow-save
}

#[tauri::command]
pub async fn create_backup(
    input: CreateBackupInput,
    pin: String,
    state: State<'_, AppState>,
) -> Result<BackupFile, Error> {
    // BACKUP-1: AES-256-GCM + Argon2id(m=64MiB, t=3, p=2). Salt is random per file.
    // Envelope: BSR1(4) + version(1) + salt(16) + nonce(12) + tag(16) + ciphertext.
    // Full pipeline in 09_Backup_and_Import_Export.md §5.
    // ...
}

#[tauri::command]
pub async fn restore_backup(
    file_path: std::path::PathBuf,
    passphrase: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<RestoreSummary, Error> {
    // BR-IMP-02: verify AES-GCM auth tag + sha256 of data.jsonl against manifest.
    // BR-IMP-05: PIN + passphrase challenge; integrity check; schema-version check.
    // EC-IE-05: schema_version ahead → refuse with E_SCHEMA_AHEAD.
    // ...
}
```

### 6.2 Read-Only Helpers (Not on the Sensitive Allowlist)

| Command | Returns | Notes |
|---|---|---|
| `get_student(id)` | `Student` | |
| `update_student(input)` | `Student` | Not on BR-SEC-04 allowlist (not destructive). |
| `archive_student(id)` | `Student` | Requires PIN (BR-SEC-04). |
| `get_attendance_session(batch, date)` | `AttendanceSession` | |
| `lock_attendance_session(batch, date, pin)` | `()` | Requires PIN (BR-SEC-04). |
| `unlock_attendance_session(batch, date, pin, reason)` | `()` | Requires PIN + reason (BR-ATT-08). |
| `get_kpis()` | `Kpis` | Read-only. |
| `get_recent_activity(limit)` | `Vec<Activity>` | |
| `get_reminders()` | `Vec<Reminder>` | |
| `get_fee_matrix(batch, month)` | `FeeMatrix` | |
| `get_receipt_pdf(receipt_id)` | `Vec<u8>` | Generated in Rust via `printpdf` crate; opened via `shell:allow-open`. |
| `get_settings()` | `Settings` | |
| `update_settings(input)` | `Settings` | Some fields require PIN (e.g. changing `session_timeout_min` ≤ 2 min). |
| `get_audit_log(filter)` | `Vec<AuditEntry>` | Read-only. |
| `unlock(pin)` | `bool` | Verifies PIN, sets `LockState::Unlocked`. |
| `lock()` | `()` | Sets `LockState::Locked`. |
| `biometric_unlock()` | `bool` | Prompts biometric via `tauri-plugin-biometric`. |

---

## 7. The Audit Log Discipline

Per `BR-SEC-08`: every sensitive mutation writes an `audit_log` row in the same transaction as the mutation. The audit log itself is append-only (`BEFORE UPDATE` / `BEFORE DELETE` triggers raise `E_AUDIT_IMMUTABLE`).

```rust
// src-tauri/src/security/audit.rs
pub fn write_audit(
    tx: &rusqlite::Transaction,
    tenant_id: &str,
    actor: &str,         // "tutor" | "biometric" | "system"
    action: &str,        // "student_create" | "ledger_void" | "backup_create" | ...
    ref_type: &str,
    ref_id: &str,
    metadata: serde_json::Value,
) -> Result<(), Error> {
    tx.execute(
        "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            uuid::Uuid::now_v7().to_string(),
            tenant_id,
            actor,
            action,
            ref_type,
            ref_id,
            metadata.to_string(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}
```

The audited actions (from `10_Security.md` §8.2): `attendance_lock`, `attendance_unlock`, `attendance_edit_locked`, `payment_void`, `fee_void`, `backdated_ledger`, `bulk_delete`, `export_full`, `export_excel`, `backup_create`, `backup_restore`, `pin_change`, `biometric_toggle`, `biometric_reenrol`, `sync_conflict_lost`, `provision_db`, `schema_migration`, `token_rotated`, `receipt_tamper_detected`, `ledger_integrity_violation`, `audit_chain_broken`, `pin_lockout_wipe`, `erase_initiated`, `erase_complete`.

---

## 8. The Typed Error Enum

```rust
// src-tauri/src/error.rs
use thiserror::Error;
use serde::Serialize;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum Error {
    #[error("database error: {0}")]
    #[serde(rename = "DB_ERROR")]
    Db(String),

    #[error("sync error: {0}")]
    #[serde(rename = "SYNC_ERROR")]
    Sync(String),

    #[error("auth error: {0}")]
    #[serde(rename = "AUTH_ERROR")]
    Auth(String),

    #[error("validation error: {0}")]
    #[serde(rename = "VALIDATION_ERROR")]
    Validation(String),

    #[error("io error: {0}")]
    #[serde(rename = "IO_ERROR")]
    Io(String),

    #[error("crypto error: {0}")]
    #[serde(rename = "CRYPTO_ERROR")]
    Crypto(String),

    #[error("ledger integrity violation: {0}")]
    #[serde(rename = "LEDGER_INTEGRITY")]
    LedgerIntegrity(String),

    #[error("backup error: {0}")]
    #[serde(rename = "BACKUP_ERROR")]
    Backup(String),

    #[error("not found: {0}")]
    #[serde(rename = "NOT_FOUND")]
    NotFound(String),

    #[error("conflict: {0}")]
    #[serde(rename = "CONFLICT")]
    Conflict(String),
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        // Detect SQLCipher-specific errors (wrong key, corrupted page)
        // and map them to Auth / Db appropriately.
        if e.to_string().contains("file is not a database") {
            Error::Auth("SQLCipher key mismatch".into())
        } else {
            Error::Db(e.to_string())
        }
    }
}

impl From<keyring::Error> for Error {
    fn from(e: keyring::Error) -> Self {
        Error::Auth(format!("Keychain: {e}"))
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Validation(format!("JSON: {e}"))
    }
}
```

### 8.1 Serialization Across IPC

Tauri serializes the `Result<T, Error>` return value to JSON via `serde`. The frontend receives:

```ts
// On success:
{ "id": "01HX...", "code": "BAT-2026-0001", "first_name": "Rohan", ... }

// On error (the Result is a Result in Rust; Tauri unwraps it):
// throws Error with .code and .message properties
```

The frontend's `invoke.ts` wrapper unwraps this into a typed `Result<T, DesktopError>`:

```ts
// apps/desktop/src/lib/invoke.ts
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export class DesktopError extends Error {
  constructor(public code: string, public message: string) {
    super(`${code}: ${message}`);
    this.name = "DesktopError";
  }
}

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
      throw new DesktopError(String(e.code), String(e.message));
    }
    throw new DesktopError("UNKNOWN", String(e));
  }
}
```

### 8.2 No Silent Failures (Rule 9)

Per `AGENTS.md` §2 Rule 9: no empty `catch {}`, no `unwrap()` in production code. Every `?` propagates a typed `Error`. The frontend's `invoke.ts` wrapper converts the IPC error into a `DesktopError` which is then surfaced via toast + `audit_log` row (`action='error_unhandled'`) — never silently swallowed.

---

## 9. The Crypto Module (Backup Envelope)

The `crypto/envelope.rs` module implements the `.buddysaradhi` envelope — a line-for-line Rust port of the web's `crypto/backup.ts` (`09_Backup_and_Import_Export.md` §15). The envelope:

```
.buddysaradhi = MAGIC(4) + FORMAT_VERSION(1) + SALT(16) + NONCE(12) + TAG(16) + CIPHERTEXT(var)
         where CIPHERTEXT = AES-256-GCM(key, nonce,
           gzip(
             tar(
               data.jsonl,        // NDJSON of all rows
               schema_version.txt,
               manifest.json      // counts, sha256(data.jsonl), tenant_id, created_at
             )
           )
         )
         and key = argon2id(passphrase, salt, {m: 64 MiB, t: 3, p: 2})
```

### 9.1 Key Zeroing

Every long-lived secret in process memory is wrapped in `Zeroizing<Vec<u8>>` (from the `zeroize` crate). The derived backup key, the SQLCipher key, the biometric envelope key, and the PIN are all `Zeroizing` — on drop, the memory is overwritten with zeros twice (some compilers optimize away a single write; `zeroize` does two).

This mirrors the `SecureBuffer` pattern in `10_Security.md` §5.1 and is the structural defence against memory-dumping attacks (e.g. `lldb` attaching to the process).

### 9.2 Round-Trip Test (CI Mandatory)

Per `10_Security.md` §15.5 and `AGENTS.md` §7.2: a CI test creates a backup with a known passphrase, restores it, and asserts every table row matches. The test runs on every PR touching `crypto/envelope.rs` or `src-tauri/migrations/`. A failure is a release blocker.

---

## 10. Code Style Discipline

Per `desktop/AGENTS.md` §5:

- **`cargo fmt --check`** — no manual formatting.
- **`cargo clippy -D warnings`** — all warnings are errors.
- **No `unwrap()` / `expect()` in production code.** Use `?` and the typed `Error`. The single exception is `main()`'s final `.expect("error while running Buddysaradhi")` — the app cannot recover from a builder failure.
- **No `unsafe` without a `// SAFETY:` comment** explaining the invariant. `unsafe` blocks require a security reviewer per `desktop/AGENTS.md` §8.
- **No `panic!()` in commands.** A panic in a `#[tauri::command]` propagates to the frontend as an opaque "command panicked" error — always convert to a typed `Error` first.
- **Every public function has a doc comment** naming the spec section it implements. Example: `// Implements: 12_Business_Rules.md BR-LED-04 (void requires PIN + new row)`.

---

## 11. Testing Protocol

| Layer | Tool | What's tested |
|---|---|---|
| Unit | `cargo test` | Pure functions: `next_student_code`, `paise_format`, `audit_chain_verify`, `envelope encrypt/decrypt round-trip`. |
| Integration | `cargo test --features integration` | Multi-step flows against in-memory SQLite (`:memory:` with SQLCipher): create student → record payment → void → verify audit_log + sync_outbox rows. |
| IPC contract | `tauri::test::mock_app` | Every command's input validation, error mapping, and audit-logging. |
| Cross-platform | GitHub Actions matrix (Win/Mac/Linux) | The build + tests run on all three OSes; SQLCipher + keychain quirks surface here. |

Per top-level `AGENTS.md` §7.3: never mock the database in a ledger test. Use an in-memory SQLite (`:memory:`) with SQLCipher and run real migrations. A mocked DB tells you nothing about whether the append-only trigger fires.

---

## 12. What This File Does NOT Cover

- **Tauri capability JSON, CSP, origin validation, file scope** → `03_IPC_Security.md`.
- **Code signing (EV cert, notarization, GPG)** → `04_Code_Signing.md`.
- **Updater manifest, channels, rollback** → `05_Updater.md`.
- **WiX .msi, .dmg layout, .AppImage, file association, auto-launch** → `06_Installers.md`.
- **Frontend implementation** → the existing web components in `src/components/buddysaradhi/*.tsx`, the `@buddysaradhi/ui` workspace package, `13_UI_Guidelines.md`.

---

*This file is the Rust backend contract. If the implementation diverges, this file wins — unless this file is wrong, in which case you amend this file first, then the code, then `worklog.md`. The order matters.*

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Per `13_UI_Guidelines.md` §20.6, every platform architecture file carries ≥2 ASCII mockups. This suite covers three Rust-backend artefacts: the `src-tauri/src/` module tree (the file layout the next Rust engineer reads first), the ledger engine call graph (the `record_payment` → 8-step transaction that every sensitive command mirrors), and the backup crypto envelope flow (the `.buddysaradhi` AES-256-GCM + Argon2id pipeline that protects every backup).

### 13.1 Design System Reference

> **The single rule (`13_UI_Guidelines.md` §6.6):** controls are neumorphic, surfaces are glass. The Rust backend produces the data that fills those surfaces and the errors that surface in those controls — it owns no pixels directly. The two UI touchpoints the Rust code *does* own are: (a) the typed `Error` enum that the frontend renders as a flare-bordered `.glass-strong` toast per §8.8, and (b) the `audit_log` rows whose state changes the frontend renders as `.glass-faint` list rows in Settings → Audit Log per §8.4.

**Glass surfaces the Rust backend feeds (§5.5 coverage map excerpt):**

| Surface | Glass tier | Rust data source |
|---|---|---|
| KPI cards (Collected, Due, Present) | `.glass` + 2px accent left-border (§5.4) | `get_kpis()` → `Kpis { collected_paise: i64, due_paise: i64, present_pct: f32 }` |
| List rows (student roster, ledger entries) | `.glass-faint` | `get_students()`, `get_fee_matrix()` → `Vec<Student>`, `FeeMatrix` |
| Audit log rows (Settings → Audit) | `.glass-faint` | `get_audit_log()` → `Vec<AuditEntry>` (append-only per BR-SEC-08) |
| Modal (Record Payment, Restore Backup) | `.glass-strong` + backdrop | `record_payment()`, `restore_backup()` → `Result<T, Error>` |
| Toast (DesktopError, update available) | `.glass-strong` + 4px accent left-bar | `Error` enum serialized via serde → `DesktopError(code, message)` |

**Neumorphic controls the Rust backend triggers (§6.6 coverage map excerpt):**

| Control | Recipe | Rust trigger |
|---|---|---|
| PIN prompt (fresh PIN ≤30s) | `.neumo-inset` + cyan focus ring | `security::require_fresh_pin()` → `Error::Auth("PIN required")` |
| Primary CTA (Save Payment, Restore) | `.neumo-raised` + emerald glow | `Result<T, Error>::Ok` → frontend enables the CTA |
| Toggle (auto-launch, biometric) | `.neumo-inset` well + raised knob | `update_settings()` → `Result<Settings, Error>` |
| Input field (passphrase, amount) | `.neumo-inset` + cyan focus / flare error | `validator::Validate` → `Error::Validation` on fail |

> **References.** Rust API Guidelines (rust-lang.github.io/api-guidelines); The Rust Book — Error Handling (doc.rust-lang.org/book/ch09-00-error-handling.html); rusqlite docs (docs.rs/rusqlite); SQLCipher design docs (www.zetetic.net/sqlcipher/design); Argon2 RFC 9106 (datatracker.ietf.org/doc/html/rfc9106); AES-GCM NIST SP 800-38D (nvlpubs.nist.gov); Smashing Magazine — "Desktop UX Patterns For Native Apps"; CSS-Tricks — "Backdrop-Filter Performance Case Study". The mockups below are the backend contract; the prose above is the rationale.

### 13.2 M1 — `src-tauri/src/` Module Tree

```
src-tauri/
├── Cargo.toml                              ← crate manifest (§1)
├── tauri.conf.json                         ← window + security + plugins + bundle (01 §6, §7, 05 §2)
├── build.rs                                ← tauri-build hook
├── capabilities/
│   └── main.json                           ← allowlist (03 §2.1)
├── entitlements.plist                      ← macOS Hardened Runtime (04 §3.4)
├── migrations/                             ← refinery forward-only (§4.3)
│   ├── V0001__init.sql                     ← settings, students, batches, ledger_entries, receipts, audit_log, sync_outbox
│   ├── V0002__ledger_triggers.sql          ← trg_ledger_no_update / no_delete (LEDGER-1, BR-LED-01)
│   ├── V0003__audit_chain.sql              ← audit_log prev_hash/this_hash chain (BR-SEC-08)
│   └── V####__*.sql                        ← new migrations are additive only (§4.4)
├── src/
│   ├── main.rs                             ← tauri::Builder + 3 setup blocks (§2)
│   ├── state.rs                            ← AppState struct + init (§3)
│   ├── error.rs                            ← typed Error enum + From impls (§8)
│   ├── lib.rs                              ← re-exports for tests + cdylib
│   ├── commands/                           ← #[tauri::command] functions (§6)
│   │   ├── mod.rs                          ← invoke_handler registration (7 sensitive + helpers)
│   │   ├── students.rs                     ← get_students, get_student, create_student, update_student, archive_student
│   │   ├── ledger.rs                       ← record_payment, void_ledger_entry, get_fee_matrix, get_receipt_pdf
│   │   ├── attendance.rs                   ← mark_attendance, lock/unlock_attendance_session, get_attendance_session
│   │   ├── backup.rs                       ← create_backup, restore_backup (BR-IMP-01/02/05)
│   │   ├── settings.rs                     ← get_settings, update_settings, get_audit_log
│   │   ├── dashboard.rs                    ← get_kpis, get_recent_activity, get_reminders
│   │   └── auth.rs                         ← unlock, lock, biometric_unlock (BR-SEC-01/04)
│   ├── db/                                 ← rusqlite + SQLCipher (§4)
│   │   ├── mod.rs                          ← open_encrypted_db, PRAGMA key/WAL/foreign_keys
│   │   └── migrations.rs                   ← refinery embed_migrations! macro
│   ├── sync/                               ← libsql HTTP client + outbox flusher (§5)
│   │   ├── mod.rs                          ← run_flusher (30s tick)
│   │   ├── outbox.rs                       ← flush_once, push, mark_sent, resolve_conflict
│   │   └── conflict.rs                     ← LWW on updated_at (BR-SYN-03)
│   ├── crypto/                             ← AES-256-GCM + Argon2id (§9)
│   │   ├── mod.rs                          ← envelope entry point
│   │   ├── envelope.rs                     ← .buddysaradhi format: MAGIC + version + salt + nonce + tag + ciphertext
│   │   ├── argon2id.rs                     ← m=64MiB, t=3, p=2 (BACKUP-1, BR-SEC-06)
│   │   └── zeroize.rs                      ← Zeroizing<Vec<u8>> wrapper for keys (§9.1)
│   ├── security/                           ← session + PIN + audit (03 §5, §12)
│   │   ├── mod.rs                          ← require_unlocked, require_fresh_pin (≤30s window)
│   │   ├── audit.rs                        ← write_audit (BR-SEC-08)
│   │   ├── pin.rs                          ← argon2id::verify on settings.pin_hash (BR-SEC-05)
│   │   └── lockout.rs                      ← 5/10/15 fail → 30s/5min/wipe (BR-SEC-03)
│   ├── updater.rs                          ← run_periodic_check (6h tick) + install_now/tonight/skip (05 §4)
│   └── auto_launch.rs                      ← auto_launch crate wrapper (06 §6.1)
└── tests/                                  ← integration tests (in-memory :memory: + SQLCipher, §11)
    ├── ledger_append_only.rs               ← LEDGER-1..4 invariants (BR-LED-01/02/04/10)
    ├── backup_roundtrip.rs                 ← envelope encrypt → decrypt → restore → row-by-row verify (§9.2)
    ├── sync_outbox.rs                      ← every mutation writes a row (Rule 7, BR-SYN-02)
    └── pin_lockout.rs                      ← 5/10/15 fail → 30s/5min/wipe (BR-SEC-03)
   ↑ every module file carries a doc comment naming the spec section it implements (per §10 Code Style)
   ↑ the migrations dir is forward-only — never edit a merged V#### file (§4.4, AGENTS §10 #9)
   ↑ commands/ is the IPC boundary — every function here crosses serde, so every struct derives
     Debug + Clone + Serialize + Deserialize + Validate (§6.1)
   ↑ sync/outbox.rs is the BR-SYN-02 contract — the same-transaction INSERT is in commands/*.rs,
     not in sync/ — sync/ only flushes pending rows
   ↑ crypto/envelope.rs is the BACKUP-1 invariant — params pinned to match web's crypto/backup.ts
   ↑ tests use in-memory :memory: SQLite with real SQLCipher + real migrations (AGENTS §7.3)
   ↑ cross-refs: §1 (Cargo.toml), §2 (main.rs), §3 (AppState), §4 (db), §5 (sync), §6 (commands),
     §7 (audit), §8 (Error), §9 (crypto), §10 (style), §11 (testing) — all internal to this file
```

### 13.3 M2 — Ledger Engine Call Graph (`record_payment` 8-step TX)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND  →  invoke('record_payment', { input, pin })                              │
│  input: { student_id, invoice_id?, amount_paise: i64, method, reference?,           │
│           occurred_on: NaiveDate, notes? }                                          │
│  pin: String  (≤30s old per BR-SEC-04 — frontend re-prompts if older)               │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (Tauri IPC, origin-validated per 03 §4)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  #[tauri::command] record_payment(input, pin, state: State<'_, AppState>)            │
│  src-tauri/src/commands/ledger.rs                                                   │
│                                                                                      │
│   1. input.validate()?                          ← validator crate (range, regex)    │
│      └─ amount_paise ∈ [1, 1_000_000_00]        ← 1 paise to ₹1 lakh (BR-M-01 i64)  │
│      └─ method ∈ {cash, upi, cheque, card, bank_transfer}                           │
│      └─ occurred_on ≤ today                     ← no future backdate (BR-LED-07)    │
│                                                                                      │
│   2. security::require_unlocked(&state)?        ← LockState::Unlocked (BR-SEC-01)   │
│      └─ if Locked → Err(Auth("App locked"))                                         │
│                                                                                      │
│   3. security::require_fresh_pin(&state, &pin, "record_payment")?                   │
│      ├─ argon2id::verify(pin, settings.pin_hash)?   ← BR-SEC-05                     │
│      ├─ if fail → increment fail_count → lockout policy (BR-SEC-03)                 │
│      └─ if success → session.last_pin_verify = now()  (≤30s window)                 │
│                                                                                      │
│   4. let tx = db.transaction()?                  ← single SQLCipher TX              │
│      ┌─────────────────────────────────────────────────────────────────────────┐    │
│      │  STEP A: Backdated check (BR-LED-07)                                     │    │
│      │    if occurred_on < last_locked_session_date → log audit 'backdated'     │    │
│      │                                                                          │    │
│      │  STEP B: Overpayment check (BR-FEE-04)                                   │    │
│      │    if amount > balance_due → split into                                  │    │
│      │       PAYMENT_RECEIVED (exact) + [ADVANCE] PAYMENT_RECEIVED (remainder)  │    │
│      │                                                                          │    │
│      │  STEP C: INSERT INTO ledger_entries                                      │    │
│      │    id = uuid::Uuid::now_v7()              ← LEDGER-2 monotonic            │    │
│      │    direction = 'credit'                   ← BR-LED-02                    │    │
│      │    amount_paise = i64 (NEVER f64)         ← BR-M-01 (Rule 6)             │    │
│      │    prev_hash = chain_link(prev)           ← LEDGER-3 integrity            │    │
│      │    client_seq = UPDATE settings SET next_client_seq = next_client_seq + 1│    │
│      │                 RETURNING next_client_seq  ← atomic, same TX              │    │
│      │                                                                          │    │
│      │  STEP D: INSERT INTO receipts                                            │    │
│      │    number = RCT-<YYYY>-<NNNNNN>           ← BR-RC-01 (never recycled)     │    │
│      │    tamper_hash = sha256(number + tenant_secret + amount_paise)           │    │
│      │    next_receipt_seq += 1 (same TX, RETURNING)                            │    │
│      │                                                                          │    │
│      │  STEP E: UPDATE invoices SET status = 'paid' | 'partial'                 │    │
│      │    derivation per BR-CALC-02 (1-paise tolerance, BR-FEE-05)              │    │
│      │                                                                          │    │
│      │  STEP F: UPDATE fee_schedule_items SET status = ...                      │    │
│      │                                                                          │    │
│      │  STEP G: INSERT INTO audit_log                                           │    │
│      │    action = 'payment_received' | 'backdated_ledger'                      │    │
│      │    metadata = { before, after } (JSON)                                   │    │
│      │    prev_hash = audit_chain_head  ← BR-SEC-08 tamper-evident chain        │    │
│      │    this_hash = sha256(id || actor || action || metadata || prev_hash)    │    │
│      │                                                                          │    │
│      │  STEP H: INSERT INTO sync_outbox          ← BR-SYN-02 (Rule 7, same TX)  │    │
│      │    operation = 'insert'                                                  │    │
│      │    payload = JSON snapshot of the ledger_entries row                     │    │
│      │    status = 'pending'                                                    │    │
│      └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│   5. tx.commit()?                               ← atomic: all 8 steps land or none │
│                                                                                      │
│   6. return Ok(LedgerEntry)                      ← serialized via serde to frontend │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (frontend receives Result<LedgerEntry, Error>)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  RESOLVE PATH                                                                        │
│  • on Ok  → close .glass-strong modal, push entry to Zustand, emerald toast (4s)     │
│  • on Err → DesktopError(code, message) → flare toast (persistent) + audit row       │
│  • sync_outbox row → async push to libsql on next 30s flusher tick (§5 of this file) │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the 8-step TX is the heart of the ledger — every sensitive command (void, backup, restore)
     follows the same shape: validate → require_unlocked → require_fresh_pin → BEGIN TX →
     INSERT mutation + INSERT audit_log + INSERT sync_outbox → COMMIT → return Result<T, Error>
   ↑ STEP C is the BR-LED-01 append-only INSERT — the trg_ledger_no_update / no_delete triggers
     in V0002 fire on any UPDATE/DELETE attempt (LEDGER-1, LEDGER-4)
   ↑ STEP D's next_receipt_seq increment is atomic via RETURNING — no race possible (BR-RC-01)
   ↑ STEP G's audit_log row is in the SAME TX as the mutation — never a separate write (BR-SEC-08)
   ↑ STEP H's sync_outbox row is in the SAME TX as the mutation — never a separate write (BR-SYN-02)
   ↑ amount_paise is i64 throughout — no f64, no float, no REAL (BR-M-01, Rule 6)
   ↑ cross-refs: BR-LED-01/02/04/07/10, BR-RC-01, BR-FEE-04/05, BR-CALC-02, BR-SEC-01/03/05/08,
     BR-SYN-02, BR-M-01, LEDGER-1..4 — all defined in 12_Business_Rules.md or 10_Security.md §9
```

### 13.4 M3 — Backup Crypto Envelope Flow (`.buddysaradhi` AES-256-GCM + Argon2id)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  BACKUP CREATE  (commands/backup.rs → crypto/envelope.rs)                           │
│  input: { passphrase: String (≥12 chars per BR-SEC-06), destination: PathBuf }      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: WAL CHECKPOINT                                                            │
│    PRAGMA wal_checkpoint(TRUNCATE)             ← flush WAL into main DB (§4.2)      │
│    ensures the backup is a consistent snapshot (10_Security.md §14.2)              │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: EXPORT TO NDJSON + MANIFEST                                                │
│    for each table (settings, students, batches, ledger_entries, receipts,           │
│                    attendance_sessions, attendance_records, audit_log, sync_outbox):│
│      SELECT * → serialize each row as a JSON line → data.jsonl                      │
│    write manifest.json: { counts: {table → row_count},                              │
│                          sha256: sha256(data.jsonl),                                │
│                          tenant_id, schema_version, created_at }                    │
│    write schema_version.txt                                                         │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: TAR + GZIP                                                                 │
│    tar -cf - data.jsonl schema_version.txt manifest.json | gzip > payload.gz        │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: ARGON2ID KEY DERIVATION                                                    │
│    salt = rand::thread_rng().fill_bytes(16)     ← random per file (BR-SEC-06)       │
│    key  = argon2id(passphrase, salt, { m: 64 MiB, t: 3, p: 2 })  → 32 bytes        │
│    key wrapped in Zeroizing<Vec<u8>>             ← zeroed on drop (§9.1)            │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: AES-256-GCM ENCRYPT                                                        │
│    nonce = rand::thread_rng().fill_bytes(12)    ← 96-bit nonce, random per file     │
│    (ciphertext, tag) = aes_256_gcm::encrypt(key, nonce, payload.gz)                 │
│    tag is 16 bytes (128-bit auth tag)                                               │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: WRITE .buddysaradhi ENVELOPE                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ offset 0  │ MAGIC (4 bytes)        = b"BSR1"            ← magic number       │  │
│  │ offset 4  │ FORMAT_VERSION (1 byte) = 0x01               ← envelope version   │  │
│  │ offset 5  │ SALT (16 bytes)         = <random per file>  ← Argon2id salt      │  │
│  │ offset 21 │ NONCE (12 bytes)        = <random per file>  ← AES-GCM nonce      │  │
│  │ offset 33 │ TAG (16 bytes)          = <auth tag>         ← integrity check    │  │
│  │ offset 49 │ CIPHERTEXT (var)        = AES-256-GCM(payload.gz)                  │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│    write to destination path (from dialog:allow-save, 03 §11.2)                     │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 7: AUDIT + RETURN                                                             │
│    INSERT INTO audit_log (action='backup_create', ref_id=<file path>)               │
│    INSERT INTO sync_outbox (operation='audit')    ← if audit_log syncs              │
│    return Ok(BackupFile { path, size_bytes, sha256, created_at })                   │
└────────────────────────────────────────────────────────────────────────────────────┘

                  ▼  ▼  ▼  REVERSE FLOW (restore_backup)  ▼  ▼  ▼

┌────────────────────────────────────────────────────────────────────────────────────┐
│  RESTORE  (commands/backup.rs::restore_backup)                                      │
│  input: { file_path, passphrase, pin }                                              │
│   1. read .buddysaradhi → parse MAGIC (must be b"BSR1") → else E_BACKUP_FORMAT          │
│   2. parse salt(16) + nonce(12) + tag(16) + ciphertext(var)                         │
│   3. argon2id(passphrase, salt) → key (Zeroizing)                                   │
│   4. aes_256_gcm::decrypt(key, nonce, ciphertext, tag)                              │
│      └─ tag mismatch → E_WRONG_PASSPHRASE (BR-SEC-06, EC-SEC-02)                   │
│      └─ 3 fails on same file → 60s lockout; 3 lockouts → restore disabled          │
│   5. gunzip → untar → data.jsonl + manifest.json + schema_version.txt              │
│   6. verify sha256(data.jsonl) == manifest.sha256   ← integrity check               │
│   7. if schema_version > local → E_SCHEMA_AHEAD (BR-SYN-05, EC-IE-05)              │
│   8. BEGIN TX: DELETE all rows → INSERT from data.jsonl → COMMIT                    │
│   9. audit_log (action='backup_restore') + sync_outbox                              │
│  10. return Ok(RestoreSummary { rows_restored, schema_version, ... })               │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the .buddysaradhi envelope is line-for-line Rust port of web's crypto/backup.ts
     (09_Backup_and_Import_Export.md §15) — cross-platform compatibility is BACKUP-1
   ↑ Argon2id params (m=64MiB, t=3, p=2) are pinned — a change is a stop-and-ask (§8 #3 of AGENTS)
   ↑ the key lives in Zeroizing<Vec<u8>> — double-zeroed on drop, never persisted (§9.1)
   ↑ the 3-attempt lockout is per-file, not per-session (03 §6.2)
   ↑ the schema-version refusal prevents an old client from corrupting a new schema (BR-SYN-05)
   ↑ cross-refs: BACKUP-1, BR-SEC-06, BR-IMP-01/02/05, BR-SYN-02/05, EC-SEC-02, EC-IE-05,
     LEDGER-1..4 (the DELETE in step 8 is the audited exception per 03 §8.4)
```

### 13.5 Coverage Audit

| §20.4 mockup type | Coverage in this file |
|---|---|
| Concept diagram (architecture / flow) | M1 module tree, M2 ledger call graph, M3 backup envelope flow |
| Full-screen layout | (n/a — 02 is a backend spec, not a screen) |
| Component anatomy | (n/a — Rust code, not UI components) |
| State matrix | (n/a — covered in screen specs 04–08) |

> All three mockups above sit inside fenced code blocks per §20.3 rule 1. Box widths 84–116 chars (within the 80–120 desktop window range per §20.3 rule 2). Character set per §20.2 (┌┐└┘├┤┬┴─│▌░▒▓█●○◉◐✕✓▲▼›»←→↑↓⌘⌥⇧₹·). Glass tiers annotated (`.glass`, `.glass-strong`, `.glass-faint`) per §5.5 in the design-system callout above; neumorphic recipes referenced in the same callout. Accent colours named (emerald / cyan / amber / flare / violet), never hexed in mockup notes per §20.3 rule 6. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.6`, `§8.4`, `§8.8`, `§9.1`, `§10`, `§11`, `BR-FEE-04/05`, `BR-LED-01/02/04/07/10`, `BR-M-01`, `BR-RC-01`, `BR-CALC-02`, `BR-SEC-01/03/05/06/08`, `BR-SYN-02/05`, `BR-IMP-01/02/05`, `BACKUP-1`, `LEDGER-1`..`LEDGER-4`, `EC-SEC-02`, `EC-IE-05`).
