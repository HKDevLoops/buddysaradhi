# 03 — IPC & Security Model

> Tauri v2 ships with a capability-based IPC system that is the structural answer to "could a malicious script in the webview exfiltrate the ledger?" This file is the security contract for the desktop app: the command allowlist, the Content Security Policy, origin validation, the SQLCipher-at-rest key lifecycle, the Argon2id backup parameters, the audit-log discipline, the no-remote-code rule, the file-scope restriction, and the updater signature verification flow.

Cross-references: `01_Architecture.md` §6 (allowlist summary), `02_Rust_Core.md` (Rust commands, AppState, error enum), `10_Security.md` §5/§12/§14 (data at rest, CSP, desktop posture), `12_Business_Rules.md` BR-SEC-01..10 (security rules), `14_Edge_Cases.md` EC-SEC-01..05 (security edge cases). The 10 non-negotiable rules in top-level `AGENTS.md` §2 apply unchanged — especially Rule 1 (append-only ledger), Rule 2 (no network calls that process user data), Rule 3 (no telemetry), Rule 8 (AES-256-GCM + Argon2id backups), Rule 9 (no silent failures).

---

## 1. Threat Model Recap

The desktop app's threat model is a subset of the master threat model in `10_Security.md` §20 (STRIDE + adversary matrix). The desktop-specific adversaries:

| Adversary | Capability | What we defend with |
|---|---|---|
| A tutor's curious child | Has unlocked-laptop access for 5 min | App auto-lock (5 min idle), PIN re-prompt on sensitive actions (BR-SEC-04), biometric unlock preferred |
| A laptop thief | Steals the laptop, has the disk | SQLCipher at rest (key in OS keychain, not on disk), 15-fail PIN wipe (BR-SEC-03), no plaintext secrets in the DB |
| A malicious script in the webview (XSS) | Tries to invoke arbitrary Tauri commands | Allowlist (§2), CSP (§3), origin validation (§4), input validation (§7) |
| A malicious .buddysaradhi file | Tries to crash the restore flow | AES-GCM auth tag check (§6), sha256 manifest check, schema-version refusal |
| A MITM on the sync channel | Tries to read or modify sync traffic | TLS 1.3 to `*.turso.io` + `*.supabase.co`, no other origins allowed (CSP §3) |
| A malicious update binary | Tries to impersonate a Buddysaradhi update | Updater signature verification (§10), minisign / Tauri updater pubkey pinned in the binary |

The structural defences (allowlist, CSP, origin validation, SQLCipher) are layered — defeating one does not defeat the others. The cryptographic defences (Argon2id, AES-GCM, updater signature) are independent — a bug in one does not cascade.

---

## 2. The Command Allowlist (Capabilities)

Tauri v2 uses a capability-based permission system. Every IPC call from the frontend must be:

1. Defined as a Rust function with the `#[tauri::command]` attribute (the 7 sensitive commands + read-only helpers in `02_Rust_Core.md` §6).
2. Listed in a `*.json` capability file under `src-tauri/capabilities/`.
3. Matched by the window's `permissions` array in `tauri.conf.json`.

**No wildcards.** There is no `*` permission anywhere in the desktop app. The capability files are reviewed on every PR (`desktop/AGENTS.md` §8 stop-and-ask #1).

### 2.1 The Main Window Capability

```json
// src-tauri/capabilities/main.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Allowlist for the main Buddysaradhi window. Every permission must be justified by a spec citation.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:window:default",
    "core:webview:default",
    "core:app:default",

    "fs:allow-read-dir",
    "shell:allow-open",
    "dialog:allow-save",

    "biometric:allow-authenticate",

    "updater:allow-check",
    "updater:allow-download",

    "store:allow-get",
    "store:allow-set"
  ]
}
```

### 2.2 Permission Justification Table

Every permission in the allowlist maps to a specific use case. Adding a permission without a row in this table is a stop-and-ask (`desktop/AGENTS.md` §8).

| Permission | Use case | Spec ref | Scope restriction |
|---|---|---|---|
| `core:default` | Tauri's safe default (event listeners, window metadata, webview lifecycle). | Tauri docs | None (safe by design) |
| `core:event:default` | Emitting + listening to events between Rust and the webview. | `02_Rust_Core.md` §2 (sync progress events) | None |
| `core:window:default` | Window state queries (is maximised, is focused). | `01_Architecture.md` §7.4 (window persistence) | None |
| `core:webview:default` | Webview lifecycle (load URL, reload). | n/a | None |
| `core:app:default` | App metadata (version, bundle ID). | `05_Updater.md` §3 (version compare) | None |
| `fs:allow-read-dir` | Reading the backup directory for the "Recent backups" list in Settings → Backups. | `08_Settings.md` "Backup & Data" tab | Restricted to `${APP_CONFIG_DIR}/backups/` only (§11) |
| `shell:allow-open` | Opening a generated receipt PDF in the OS's default viewer. | `07_Fees_and_Payments.md` §13 (receipt PDF) | Restricted to `*.pdf` files in `${APP_CONFIG_DIR}/receipts/` only |
| `dialog:allow-save` | The native Save dialog for backup destination picker. | `08_Settings.md` "Backup & Data" tab | Single-shot, no path persistence |
| `biometric:allow-authenticate` | Biometric unlock prompt. | `10_Security.md` §3.3, §3.7 | n/a |
| `updater:allow-check` | Calling `updater::check()`. | `05_Updater.md` §3 | n/a |
| `updater:allow-download` | Downloading an update binary. | `05_Updater.md` §4 | n/a |
| `store:allow-get` | Reading `window.state` (persisted window geometry + active route). | `01_Architecture.md` §7.4 | Scope: `${APP_CONFIG_DIR}/.store.dat` |
| `store:allow-set` | Writing `window.state` and `app_state.last_crash`. | `01_Architecture.md` §7.4 | Same scope |

### 2.3 What Is Explicitly NOT Allowed

The following permissions are **not** in the allowlist and adding any of them requires a stop-and-ask (`desktop/AGENTS.md` §8 #1):

- `fs:allow-write-file` — the webview never writes to the filesystem directly; all writes go through Rust commands.
- `fs:allow-read-file` — the webview never reads arbitrary files; backups are read by Rust.
- `fs:allow-exists` — same.
- `shell:allow-execute` — the webview cannot spawn processes.
- `shell:allow-open` (without scope) — restricted to `*.pdf` in `${APP_CONFIG_DIR}/receipts/` only.
- `http:default` — the webview cannot make arbitrary HTTP requests; all network calls go through Rust (libsql sync, updater check).
- `process:default` — no process management from the webview.
- `clipboard:default` — no clipboard access from the webview (tutors copying student phone numbers is handled by the OS text selection, not a Tauri API).
- `notification:default` — desktop notifications are handled by Rust via the `notify-rust` crate, not by the webview.
- `global-shortcut:default` — global shortcuts (e.g. for the v3.2 menu-bar widget) are out of scope for v1.

---

## 3. Content Security Policy

The CSP is set in `tauri.conf.json` under `app.security.csp`. It is the second line of defence (after the allowlist) against XSS in the webview.

```json
// src-tauri/tauri.conf.json (excerpt)
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' https://*.turso.io https://*.supabase.co https://buddysaradhi.app/api/releases/desktop/; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      "devCsp": "default-src 'self'; connect-src 'self' http://localhost:* https://*.turso.io https://*.supabase.co https://buddysaradhi.app/api/releases/desktop/; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    }
  }
}
```

### 3.1 CSP Directives Explained

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Everything defaults to the tauri:// origin. No other origins may load anything by default. |
| `connect-src` | `'self' https://*.turso.io https://*.supabase.co https://buddysaradhi.app/api/releases/desktop/` | The only three remote origins the webview may connect to. Turso (sync), Supabase (auth), and the Buddysaradhi update manifest. No other HTTPS origins, no WebSocket to anywhere except libsql's WSS (covered by `*.turso.io`). |
| `img-src` | `'self' data: blob:` | Local images, data URIs (inline SVG icons), blob URLs (generated receipt PDFs displayed in `<embed>`). |
| `style-src` | `'self' 'unsafe-inline'` | `'unsafe-inline'` is required for Tailwind's runtime styles and Framer Motion's computed styles. There is no `'unsafe-eval'`. |
| `font-src` | `'self' data:` | Local fonts + data-URI fonts (the latter for the monospace KPI font). |
| `script-src` | `'self'` | Only the bundled JS. No inline scripts, no `eval`, no remote CDNs. |
| `frame-ancestors` | `'none'` | The webview cannot be embedded in an iframe anywhere. |
| `base-uri` | `'self'` | The `<base>` tag cannot be hijacked. |
| `form-action` | `'self'` | Forms can only submit to the tauri:// origin (which doesn't accept form posts — all form submissions go through `invoke`). |

### 3.2 What's Missing (Intentional)

- **`'unsafe-eval'`** — not in production CSP. This blocks `eval()`, `new Function()`, `setTimeout("string")`. Required for some dev tools (hence the separate `devCsp`) but never in prod.
- **`'unsafe-inline'` for `script-src`** — not allowed. All JS must come from the bundled script files. No inline event handlers (`<button onclick="...">`).
- **Any `https://*` wildcard** — every remote origin is enumerated. Adding a new origin is a stop-and-ask (`desktop/AGENTS.md` §8 #7).

### 3.3 The Dev CSP

`devCsp` loosens `connect-src` to `http://localhost:*` (for the Vite dev server + libsql local testing) and adds `'unsafe-inline' 'unsafe-eval'` to `script-src` (for Vite's HMR + React Refresh). The dev CSP is **never** shipped to production — Tauri's release build uses `csp`, not `devCsp`.

---

## 4. Origin Validation

Tauri v2 automatically rejects IPC calls from origins other than:

- **Production:** `tauri://localhost` (Windows / Linux) or `https://tauri.localhost` (macOS WebKit, which requires the `https://` scheme).
- **Dev:** `http://localhost:1420` (the Vite dev server).

There is no configuration to broaden this. The `dangerousRemoteDomainIpcAccess` setting in Tauri v1 (which allowed specific remote domains to invoke commands) is **removed** in Tauri v2 and is not used in the desktop app. The webview cannot load a remote URL and invoke commands — even if a future bug let the webview navigate to `https://evil.com`, that origin would have zero IPC access.

### 4.1 Why This Matters

The combination of (a) strict CSP, (b) strict origin validation, (c) the command allowlist, and (d) `serde` input validation on every command means an XSS in the webview has *no* path to the filesystem, the database, or the network. The XSS can render arbitrary HTML in the webview (bad — it could phish the user for their PIN), but it cannot:

- Read the SQLCipher key (it's in the OS keychain, only accessible from Rust).
- Read the database (it's in Rust, accessed via commands that require an unlocked session + PIN for sensitive actions).
- Make arbitrary network calls (CSP `connect-src` is locked to three origins).
- Spawn a process (no `shell:allow-execute` permission).
- Write to the filesystem (no `fs:allow-write-file` permission).

This is the "defence in depth" that `10_Security.md` §1 promises.

---

## 5. SQLCipher at Rest

The local SQLite database is encrypted at rest with SQLCipher. The full open sequence is in `02_Rust_Core.md` §4; the security-relevant details:

### 5.1 Key Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  First run                                                       │
│  1. App detects no DB file at ${APP_DATA_DIR}/buddysaradhi.db        │
│  2. App detects no keychain entry "buddysaradhi" / "sqlcipher-key"   │
│  3. Generate 32 random bytes (rand::thread_rng().fill_bytes)    │
│  4. Store base64(bytes) in OS keychain                          │
│  5. Open DB with PRAGMA key = '<hex of bytes>'                  │
│  6. Run migrations → empty schema ready                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Subsequent runs                                                 │
│  1. App detects DB file exists                                   │
│  2. App reads keychain entry "buddysaradhi" / "sqlcipher-key"        │
│     ├─ Success → bytes → PRAGMA key → open                       │
│     ├─ NoEntry (keychain wiped but DB file remains) →            │
│     │   show "Recover from backup" dialog (10_Security §18.1)   │
│     └─ Other keyring error → Error::Auth, app exits             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  15th failed PIN attempt (BR-SEC-03)                            │
│  1. crypto-shred: delete keychain entries (SQLCipher key,       │
│     Supabase refresh token, Turso db_token)                     │
│  2. app_state.tenant_secret = random_bytes(32)                  │
│  3. app_state.audit_chain_head = random_bytes(32)               │
│  4. DELETE FROM <every table>                                   │
│  5. VACUUM                                                      │
│  6. Write 0x00 over the .db file, then unlink                   │
│  7. Revoke Supabase session server-side                         │
│  8. Force re-login screen                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Why a Random Key (Not a Passphrase-Derived Key)

The SQLCipher key is a 32-byte random value stored in the OS keychain, **not** derived from the user's passphrase. This is deliberate:

- The OS keychain is the trust root — biometric unlock releases the keychain entry, which releases the SQLCipher key, which opens the DB. The user's passphrase is for `.buddysaradhi` backups, not for the live DB.
- A passphrase-derived key would require the user to enter their passphrase on every app launch. That's terrible UX and pushes tutors to choose weak passphrases.
- The OS keychain is hardware-backed on macOS (Secure Enclave), Android (Keystore), and modern Windows (TPM-backed Credential Manager). A random key in the keychain is harder to extract than a passphrase in the user's head.

### 5.3 What's in the Keychain (Three Entries)

| Service | Account | Contents |
|---|---|---|
| `buddysaradhi` | `sqlcipher-key` | Base64 of 32 random bytes. Released on biometric unlock. |
| `buddysaradhi` | `supabase-refresh` | Supabase refresh token (for silent session restore). |
| `buddysaradhi` | `turso-db-token` | Scoped Turso JWT (for libsql sync). |

All three are deleted in the secure-erase flow (§5.1 step 1).

### 5.4 The DB File on Disk

The DB file at `${APP_DATA_DIR}/buddysaradhi.db` is SQLCipher ciphertext. Even if an attacker copies the file, they cannot decrypt it without the keychain entry. The file is also protected by the OS:

- **macOS:** `NSFileProtectionComplete` (file is unreadable while the device is locked).
- **Windows:** BitLocker-protected if the user has it enabled; the file is in `%APPDATA%` which is per-user.
- **Linux:** File permissions `0600` (owner read/write only); LUKS-protected if the user has full-disk encryption.

These OS-level protections are belt-and-braces — the SQLCipher encryption is the primary defence.

---

## 6. Argon2id for Backup Passwords

`.buddysaradhi` backups are AES-256-GCM encrypted with a key derived from the user's passphrase via Argon2id. The parameters are exactly the same as the web app (`10_Security.md` §15.3, `09_Backup_and_Import_Export.md` §15.2):

| Parameter | Value | Why |
|---|---|---|
| Memory cost (`m`) | 64 MiB | Large enough to make GPU brute-force uneconomical (16 GiB GPU runs ~256 parallel instances vs ~100k for bcrypt); small enough for a 2 GiB phone (the desktop app inherits the same params for cross-platform backup compatibility). |
| Time cost (`t`) | 3 iterations | ~400 ms wall-clock on M1 / Snapdragon 8 Gen 2 / Ryzen 7. Deliberate speed bump for brute-force. |
| Parallelism (`p`) | 2 lanes | Exploits multi-core without inviting parallel brute-force (the attacker faces the same 64 MiB memory wall per lane). |
| Salt length | 16 bytes | Random per file (prepended in the file header at offset 5). |
| Hash output | 32 bytes | Used as the AES-256-GCM key. |

### 6.1 Cross-Platform Backup Compatibility

A `.buddysaradhi` file created on the web app must be restorable on the desktop app, and vice versa. The Argon2id parameters are pinned in both implementations (`packages/shared/crypto/backup.ts` for web, `src-tauri/src/crypto/envelope.rs` for desktop). A change to these parameters is a `BACKUP-1` violation and a stop-and-ask (`desktop/AGENTS.md` §8 #3).

### 6.2 Wrong-Passphrase Handling

Per `09_Backup_and_Import_Export.md` §11 and `14_Edge_Cases.md` EC-SEC-02:

- AES-GCM auth tag verification fails → `E_WRONG_PASSPHRASE`.
- 3 failed attempts on a single file → 60s lockout.
- 3 lockouts in a session → restore disabled until app restart.
- Every attempt logged to `audit_log` with `action='backup_restore_failed'`.

The lockout is per-file (not per-session) — a tutor who tries the wrong passphrase on file A, then opens file B, gets a fresh 3 attempts on file B.

### 6.3 Key Zeroing

The derived backup key lives in a `Zeroizing<Vec<u8>>` for the duration of the encrypt/decrypt operation, then is double-zeroed on drop. The key is **never** persisted — no keychain entry, no log line, no crash dump. This is the `BACKUP-1` invariant (`10_Security.md` §15.4).

---

## 7. Input Validation (`serde` + `validator`)

Every Tauri command parses its input via `serde::Deserialize` + `validator::Validate`. This is the Rust mirror of the web app's Zod parse (`AGENTS.md` §6.1: "Zod for all input validation").

```rust
#[derive(Debug, Deserialize, Validate)]
pub struct RecordPaymentInput {
    pub student_id: String,
    pub invoice_id: Option<String>,
    #[validate(range(min = 1, max = 1_000_000_00))]  // 1 paise to ₹1 lakh
    pub amount_paise: i64,
    #[validate(regex(path = "PAYMENT_METHOD_RE"))]
    pub method: String,        // cash | upi | cheque | card | bank_transfer
    pub reference: Option<String>,
    pub occurred_on: chrono::NaiveDate,
    #[validate(length(max = 5000))]
    pub notes: Option<String>,
}
```

### 7.1 The Zod ↔ `validator` Parity Rule

For every Zod schema in `packages/shared`, there is a Rust struct in `src-tauri/src/commands/*.rs` with the same field names, types, and constraints. A CI test (`packages/shared/zod-rust-parity.test.ts`) parses a fixture input through both and asserts the validation results match. Drift is a release blocker.

| Zod schema | Rust struct | Constraints (both sides) |
|---|---|---|
| `StudentInputSchema` | `CreateStudentInput` | first_name 1..100, phone E.164, default_fee 0..₹1 lakh |
| `LedgerEntrySchema` | `RecordPaymentInput` | amount 1..₹1 lakh, method enum, occurred_on ≤ today |
| `BackupPassphraseSchema` | `CreateBackupInput` | passphrase ≥ 12 chars (BR-SEC-06) |
| `MarkAttendanceInputSchema` | `MarkAttendanceInput` | status enum, batch_id exists, session_date ≤ today |

### 7.2 What Happens on Validation Failure

`input.validate()?` returns `Err(validator::ValidationErrors)`, which is converted to `Error::Validation(formatted_errors)`. The frontend receives:

```ts
{
  code: "VALIDATION_ERROR",
  message: "amount_paise: Validation error: range; method: Validation error: regex"
}
```

The frontend's `react-hook-form` integration surfaces this as inline field errors. No mutation reaches the database.

---

## 8. Audit Log Discipline

Per `BR-SEC-08`: every sensitive mutation writes an `audit_log` row in the same transaction as the mutation. The audit log itself is append-only — `BEFORE UPDATE` and `BEFORE DELETE` triggers raise `E_AUDIT_IMMUTABLE`.

### 8.1 The Audit Log Schema

```sql
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,                  -- UUID v7
    tenant_id TEXT NOT NULL,
    actor TEXT NOT NULL,                  -- 'tutor' | 'biometric' | 'system'
    action TEXT NOT NULL,                 -- 'student_create', 'ledger_void', ...
    ref_type TEXT,                        -- 'students', 'ledger_entries', ...
    ref_id TEXT,                          -- the row's UUID v7
    metadata TEXT,                        -- JSON {before, after, ...}
    prev_hash TEXT,                       -- chain: sha256(prev_row.id || prev_row.hash || tenant_secret)
    this_hash TEXT NOT NULL,              -- sha256(id || actor || action || ref_id || metadata || prev_hash || tenant_secret)
    created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only (BR-SEC-08)');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only (BR-SEC-08)');
END;
```

### 8.2 The Tamper-Evident Chain

Each audit row carries `prev_hash` (the previous row's `this_hash`) and `this_hash` (sha256 of its own fields + `prev_hash` + `tenant_secret`). This forms a chain rooted in the `tenant_secret` — modifying or deleting a row breaks the chain. The nightly `audit_reconcile_job` recomputes the chain from row 0 and surfaces a `audit_chain_broken` audit row if any drift is detected (`10_Security.md` §8.3).

### 8.3 Audited Actions (Per `10_Security.md` §8.2)

The desktop app writes audit rows for every action in the master allowlist: `attendance_lock`, `attendance_unlock`, `attendance_edit_locked`, `payment_void`, `fee_void`, `backdated_ledger`, `bulk_delete`, `export_full`, `export_excel`, `backup_create`, `backup_restore`, `pin_change`, `biometric_toggle`, `biometric_reenrol`, `sync_conflict_lost`, `provision_db`, `schema_migration`, `token_rotated`, `receipt_tamper_detected`, `ledger_integrity_violation`, `audit_chain_broken`, `pin_lockout_wipe`, `erase_initiated`, `erase_complete`. Plus a desktop-specific: `updater_signature_failed`, `updater_rollback`, `window_geometry_changed` (debug only).

### 8.4 The Four Ledger Invariants (LEDGER-1..4, Cross-Reference)

The desktop app enforces the four ledger invariants from `10_Security.md` §9 structurally — the SQLCipher triggers, the `client_seq` monotonic counter, the `ledger_reconcile_job` nightly verification, and the CI `no-ledger-delete.rs` lint are all defined in `02_Rust_Core.md` §4.5. From the IPC-security perspective:

- **LEDGER-1 (append-only):** No Tauri command exposes a path to `UPDATE` or `DELETE` a `ledger_entries` row. The `void_ledger_entry` command (the only correction path) inserts a new `VOID` row with `reverses_entry_id` set; the trigger refuses any direct mutation.
- **LEDGER-2 (monotonic client_seq + UUID v7):** Every `record_payment` command generates a UUID v7 server-side (`uuid::Uuid::now_v7()`); the `client_seq` is atomically incremented via `UPDATE settings SET next_client_seq = next_client_seq + 1 RETURNING next_client_seq` inside the same transaction.
- **LEDGER-3 (running-balance reconciliation):** The nightly reconcile job runs as a background tokio task; on mismatch it writes `audit_log` row `action='ledger_integrity_violation'` and emits a `ledger-corrupted` event the frontend surfaces as a flare toast.
- **LEDGER-4 (no physical deletes):** The CI lint `no-ledger-delete.rs` fails the build if `DELETE FROM ledger_entries` appears in any `.rs` / `.sql` file. The single audited exception is the secure-erase flow (`10_Security.md` §18.1), gated behind `BR-SEC-04` PIN + typed "ERASE" confirmation + crypto-shred of the keychain.

---

## 9. No Remote Code

The webview **cannot load remote URLs**. Tauri v2's `dangerousRemoteDomainIpcAccess` setting (which in v1 allowed specific remote domains to invoke commands) is removed in v2 and is not used. The webview loads only from:

- **Production:** `tauri://localhost` (Windows / Linux) or `https://tauri.localhost` (macOS) — the bundled static export.
- **Dev:** `http://localhost:1420` — the Vite dev server.

If a future bug let the webview navigate to `https://evil.com`, that origin would have zero IPC access (origin validation, §4), zero database access (no `fs:allow-read-file`, no commands), and zero ability to make arbitrary network calls (CSP §3). The XSS surface is the webview's HTML rendering only.

### 9.1 No `eval` in Production

The production CSP (`script-src 'self'`) blocks `eval()`, `new Function()`, and `setTimeout("string")`. The webview cannot dynamically execute code. This blocks a class of XSS payloads that rely on `eval` to bootstrap.

### 9.2 No Remote Worker Scripts

Web Workers must be loaded from `'self'`. No `new Worker('https://evil.com/worker.js')`. This is enforced by CSP `worker-src` (implicit `default-src 'self'`).

---

## 10. Updater Signature Verification

Every update binary is signed with the Tauri updater private key. The public key is pinned in `tauri.conf.json`:

```json
// src-tauri/tauri.conf.json (excerpt)
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": ["https://buddysaradhi.app/api/releases/desktop/stable"],
      "pubkey": "BASE64_OF_ED25519_PUBLIC_KEY"
    }
  }
}
```

The updater flow (`05_Updater.md` §4):

1. `updater::check()` fetches the manifest from the endpoint.
2. The manifest is signed with minisign / the Tauri updater signature scheme. The updater verifies the signature with the pinned `pubkey`.
3. If the signature fails → abort, write `audit_log` `action='updater_signature_failed'`, show a flare error toast, do not retry until next periodic check (6h).
4. If the signature verifies → download the binary, verify the binary's signature against the manifest, write to a temp path, swap on next restart.

The private key is stored in GitHub Actions secrets (never on a developer machine except via 1Password). Key rotation is a release-blocker review (`04_Code_Signing.md` §5).

### 10.1 Why Pin the Public Key in the Binary

Pinning the pubkey in the binary means an attacker who compromises `buddysaradhi.app` cannot ship a malicious update — they cannot sign it without the private key. The pinned pubkey is the trust root for the updater, just as the OS keychain is the trust root for the SQLCipher key.

### 10.2 Rollback on Signature Failure

Per `05_Updater.md` §6: if the updater fails 3 times in a row (signature failure, download corruption, swap failure), it rolls back to the previous binary (`app.exe.bak` on Windows, `Buddysaradhi.app.bak` on macOS, `buddysaradhi.AppImage.bak` on Linux). The rollback is logged to `audit_log` with `action='updater_rollback'`. The user is notified and offered a manual download link.

---

## 11. File Scope (`fs:allow-read-dir`)

The single `fs:` permission in the allowlist is `fs:allow-read-dir`, restricted to `${APP_CONFIG_DIR}/backups/` only. This is used by the "Recent backups" list in Settings → Backups (`08_Settings.md` "Backup & Data" tab).

```json
// src-tauri/capabilities/main.json (excerpt)
{
  "permissions": [
    {
      "identifier": "fs:allow-read-dir",
      "allow": [
        { "path": "${APP_CONFIG_DIR}/backups" }
      ]
    }
  ]
}
```

The webview cannot read any other directory. It cannot read `${APP_DATA_DIR}/buddysaradhi.db` (the SQLCipher file). It cannot read the user's home directory. It cannot read the OS keychain.

### 11.1 Why `APP_CONFIG_DIR` and not `APP_DATA_DIR`

| OS | `APP_CONFIG_DIR` | `APP_DATA_DIR` |
|---|---|---|
| Windows | `%APPDATA%\Buddysaradhi\` | `%LOCALAPPDATA%\Buddysaradhi\` |
| macOS | `~/Library/Application Support/Buddysaradhi/` | `~/Library/Application Support/Buddysaradhi/` (same) |
| Linux | `~/.config/Buddysaradhi/` | `~/.local/share/Buddysaradhi/` |

Backups go in `APP_CONFIG_DIR` (per-user, roamed on Windows). The DB file goes in `APP_DATA_DIR` (per-user, local — never roamed, because the SQLCipher key is in the keychain and roaming the DB without the key would brick it).

### 11.2 The Receipt PDF Scope (`shell:allow-open`)

`shell:allow-open` is restricted to `*.pdf` files in `${APP_CONFIG_DIR}/receipts/`. The Rust command `get_receipt_pdf` writes the PDF to that directory and returns the path; the frontend then invokes `shell:open(path)` to launch the OS's default PDF viewer.

```json
{
  "identifier": "shell:allow-open",
  "allow": [
    { "path": "${APP_CONFIG_DIR}/receipts/*.pdf" }
  ]
}
```

The webview cannot open any other file type, any other directory, or any URL. (Tauri v2's `shell:allow-open` does not open URLs by default — the `openUrl` API requires a separate `shell:allow-open-url` permission, which is not in the allowlist.)

---

## 12. Session Lock & Sensitive-Action PIN Gate

Per `BR-SEC-01` (app locks after 5 min idle) and `BR-SEC-04` (sensitive actions require PIN even when app is unlocked):

```
┌─────────────────────────────────────────────────────────────────┐
│  App is unlocked. User clicks "Void receipt".                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Frontend: invoke('void_ledger_entry', { id, reason, pin })     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Rust command void_ledger_entry:                                 │
│  1. input.validate()?                                            │
│  2. security::require_unlocked(&state)?  // session state check │
│  3. security::require_fresh_pin(&state, &pin, "void_ledger")?   │
│     ├─ argon2id::verify(pin, settings.pin_hash)?                │
│     ├─ if fail → increment fail_count, lockout policy (BR-SEC-03)│
│     └─ if success → record last_pin_verify = now()              │
│  4. BEGIN TRANSACTION                                            │
│  5. INSERT INTO ledger_entries (...) VALUES (...) -- the VOID    │
│  6. INSERT INTO audit_log (...) -- action='payment_void'        │
│  7. INSERT INTO sync_outbox (...) -- operation='insert'         │
│  8. COMMIT                                                       │
│  9. Return Ok(LedgerEntry)                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 12.1 The "Fresh PIN" Rule

Per `BR-SEC-04`: sensitive actions require a PIN entry that is ≤ 30 seconds old. The Rust command checks `state.session.last_pin_verify` — if it's older than 30s (or never set), the command returns `Error::Auth("PIN required")` and the frontend shows the PIN prompt. After a successful verify, `last_pin_verify` is updated to `now()`.

### 12.2 Biometric in Place of PIN

If `settings.biometric_enabled = 1`, the frontend tries biometric first (via `tauri-plugin-biometric`). On success, the Rust command `biometric_unlock` is called, which sets `state.session.last_pin_verify = now()` (biometric unlock is treated as a PIN verify for the 30s window). On failure (3 tries or hardware unavailable), the frontend falls back to PIN (`10_Security.md` §3.7).

### 12.3 Lockout Policy (BR-SEC-03)

| Failed attempts | Lockout |
|---|---|
| 1–2 | none |
| 3 | 60 s |
| 4 | 120 s |
| 5 | 240 s |
| 6+ | 60 s × 2^(n−3), capped at 24 h |
| 15 | wipe local cache (§5.1) |

The lockout counter is per-device — a thief with one laptop cannot drain attempts from another device. The counter resets on a successful unlock.

---

## 13. No Telemetry

Per `AGENTS.md` §2 Rule 3 and `10_Security.md` §17 (TELE-1): the desktop app makes exactly three outbound network calls:

1. **libsql sync** to `*.turso.io` (WSS, encrypted, only when the user has signed in and enabled sync).
2. **Supabase auth** to `*.supabase.co` (HTTPS, only during sign-in / token refresh).
3. **Updater check** to `buddysaradhi.app/api/releases/desktop/stable` (HTTPS, GET only, no PII, every 6h).

A network monitor (Little Snitch on macOS, GlassWire on Windows, Wireshark on Linux) pointed at a Buddysaradhi install with "Share anonymous usage" off sees only those three destinations. Nothing else. The CI test `no-unexpected-network.test.ts` (adapted for desktop as a Rust integration test) fails the build if any other domain is contacted.

### 13.1 No Crash Reporting SDK

No Sentry, no Crashpad, no Breakpad. Crash dumps are written to `${APP_DATA_DIR}/crash-<timestamp>.dmp` and surfaced in Settings → Diagnostics → "Crash dumps". The user can opt to email the dump to `security@buddysaradhi.app` — but the app never sends anything automatically.

### 13.2 No Analytics

No Mixpanel, no PostHog, no Amplitude, no GA. The desktop app does not track "how many tutors use this feature" or "average fee in your region" — those are telemetry dressed as helpfulness (`12_Business_Rules.md` BR-RPT-07).

---

## 14. Cross-Reference Summary

| Topic in this file | Master spec cross-ref |
|---|---|
| Threat model | `10_Security.md` §20 |
| Allowlist discipline | top-level `AGENTS.md` §3.2 (desktop stack snapshot) |
| CSP | `10_Security.md` §12 (web CSP — desktop mirrors with stricter `script-src`) |
| SQLCipher at rest | `10_Security.md` §5, §14.2 |
| Argon2id backup params | `10_Security.md` §15.3, `09_Backup_and_Import_Export.md` §15.2 |
| Audit log | `10_Security.md` §8, `12_Business_Rules.md` BR-SEC-08 |
| Sensitive-action PIN gate | `12_Business_Rules.md` BR-SEC-04, `10_Security.md` §4 |
| Lockout policy | `12_Business_Rules.md` BR-SEC-03, `10_Security.md` §3.5 |
| Updater signature | `05_Updater.md` §4, `10_Security.md` §14.3 |
| No telemetry | `10_Security.md` §17 (TELE-1), top-level `AGENTS.md` §2 Rule 3 |
| Crypto-shred on wipe | `10_Security.md` §18.1 |

---

## 15. What This File Does NOT Cover

- **Rust command implementations** → `02_Rust_Core.md`.
- **Code signing (EV cert, notarization)** → `04_Code_Signing.md`.
- **Updater manifest format, channels, rollback** → `05_Updater.md`.
- **Installer formats (WiX, DMG, AppImage)** → `06_Installers.md`.
- **Architecture, project layout, window config** → `01_Architecture.md`.

---

*This file is the IPC + security contract. If the implementation diverges, this file wins — unless this file is wrong, in which case you amend this file first, then the code, then `worklog.md`. The order matters.*

---

## 16. ASCII Art Mockup Suite (§20 Compliance)

> Per `13_UI_Guidelines.md` §20.6, every platform architecture file carries ≥2 ASCII mockups. This suite covers three security artefacts: the IPC allowlist tree (the `capabilities/main.json` permission map, scope-restricted per permission), the PIN/biometric challenge flow (the ≤30s fresh-PIN gate that every `BR-SEC-04` action funnels through), and the scope diagram per scoped command (the three `fs:` / `shell:` / `dialog:` permissions and the directory boundaries they cannot cross).

### 16.1 Design System Reference

> **The single rule (`13_UI_Guidelines.md` §6.6):** controls are neumorphic, surfaces are glass. The security layer produces the affordances that gate every sensitive action — the PIN prompt is a `.glass-strong` modal with a `.neumo-inset` input well (cyan focus ring per §8.9); the biometric prompt delegates to the OS-native sheet; the lockout error surfaces as a flare-bordered `.glass-strong` toast per §8.8 (persistent, no auto-dismiss per `BR-SEC-03`).

**Glass surfaces in the security flow (§5.5 coverage map excerpt):**

| Surface | Glass tier | Security purpose |
|---|---|---|
| Lock screen (cold start / idle timeout) | `.glass-strong` + backdrop | BR-SEC-01 auto-lock gate |
| PIN prompt (fresh PIN ≤30s) | `.glass-strong` + `bg-black/60` backdrop | BR-SEC-04 sensitive-action gate |
| Biometric prompt | OS-native sheet (macOS Touch ID / Windows Hello) | BR-SEC-04 alternate path |
| Lockout error toast (5/10/15 fails) | `.glass-strong` + 4px flare left-bar | BR-SEC-03 escalation |
| Audit log row (Settings → Audit) | `.glass-faint` band | BR-SEC-08 tamper-evident chain |
| Updater signature-failed toast | `.glass-strong` + 4px flare left-bar | §10.2 rollback trigger |

**Neumorphic controls in the security flow (§6.6 coverage map excerpt):**

| Control | Recipe | Security purpose |
|---|---|---|
| PIN input (6-digit) | `.neumo-inset` + cyan focus ring / flare on error | BR-SEC-05 verification |
| Cancel button (PIN prompt) | `.neumo-raised` (no glow) | Dismiss sensitive action |
| Submit button (PIN verify) | `.neumo-raised` + emerald glow | Confirm sensitive action |
| Toggle (biometric enable) | `.neumo-inset` well + raised knob | BR-SEC-04 opt-in |

> **References.** Tauri 2 capabilities + security docs (tauri.app); Apple Developer — App Sandbox + Hardened Runtime (developer.apple.com); Microsoft — AppInstaller + SmartScreen docs (learn.microsoft.com); OWASP — Content Security Policy Cheat Sheet (cheatsheetseries.owasp.org); SQLCipher design docs (www.zetetic.net/sqlcipher/design); Argon2 RFC 9106 (datatracker.ietf.org/doc/html/rfc9106); Smashing Magazine — "Desktop UX Patterns For Native Apps"; CSS-Tricks — "Backdrop-Filter Performance Case Study". The mockups below are the security contract; the prose above is the rationale.

### 16.2 M1 — IPC Allowlist Tree (`capabilities/main.json`)

```
src-tauri/capabilities/main.json
┌────────────────────────────────────────────────────────────────────────────────────┐
│  identifier: "main-capability"                                                      │
│  windows: ["main"]                          ← only the main window, no second window│
│  permissions:                                                                       │
│                                                                                      │
│  ┌─ core:* (Tauri's safe defaults — no scope restriction) ──────────────────────┐  │
│  │  ├── core:default                  ← event listeners, window metadata         │  │
│  │  ├── core:event:default            ← Rust ↔ webview events (sync progress)    │  │
│  │  ├── core:window:default           ← window state queries (01 §7.4)           │  │
│  │  ├── core:webview:default          ← webview lifecycle                        │  │
│  │  └── core:app:default              ← app metadata (version, bundle ID)        │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ fs:* (scoped — the ONLY fs permission) ──────────────────────────────────────┐  │
│  │  └── fs:allow-read-dir                                                         │  │
│  │        scope: ${APP_CONFIG_DIR}/backups/   ← ONLY the backups dir, nothing else│  │
│  │        use: Settings → Backups → "Recent backups" list (08_Settings.md)       │  │
│  │        ❌ fs:allow-write-file   NOT ALLOWED — webview never writes filesystem   │  │
│  │        ❌ fs:allow-read-file   NOT ALLOWED — webview never reads arbitrary files│  │
│  │        ❌ fs:allow-exists      NOT ALLOWED                                     │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ shell:* (scoped — only *.pdf in receipts dir) ───────────────────────────────┐  │
│  │  └── shell:allow-open                                                          │  │
│  │        scope: ${APP_CONFIG_DIR}/receipts/*.pdf   ← ONLY PDFs in receipts dir  │  │
│  │        use: open generated receipt PDF in OS default viewer (07 §13)          │  │
│  │        ❌ shell:allow-execute   NOT ALLOWED — webview cannot spawn processes   │  │
│  │        ❌ shell:allow-open-url  NOT ALLOWED — no URL opening from webview      │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ dialog:* (single-shot, no path persistence) ─────────────────────────────────┐  │
│  │  └── dialog:allow-save                                                         │  │
│  │        scope: single-shot (no path remembered between calls)                  │  │
│  │        use: native Save dialog for backup destination picker (08 §Backup)     │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ biometric:* (n/a scope) ─────────────────────────────────────────────────────┐  │
│  │  └── biometric:allow-authenticate                                              │  │
│  │        use: biometric unlock prompt (10_Security.md §3.3, §3.7)               │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ updater:* (n/a scope — HTTPS GET to pinned endpoint) ────────────────────────┐  │
│  │  ├── updater:allow-check                                                      │  │
│  │  └── updater:allow-download                                                   │  │
│  │        use: tauri-plugin-updater::check() + download() (05 §4)                │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ store:* (scoped to .store.dat in APP_CONFIG_DIR) ────────────────────────────┐  │
│  │  ├── store:allow-get                                                           │  │
│  │  └── store:allow-set                                                           │  │
│  │        scope: ${APP_CONFIG_DIR}/.store.dat                                     │  │
│  │        use: window.state, app_state.last_crash, updater.pending_version        │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ❌ http:default        NOT ALLOWED — webview cannot make HTTP requests            │
│  ❌ process:default     NOT ALLOWED — no process management from webview            │
│  ❌ clipboard:default   NOT ALLOWED — OS text selection handles clipboard           │
│  ❌ notification:default NOT ALLOWED — notify-rust (Rust-side) handles desktop notif│
│  ❌ global-shortcut:default NOT ALLOWED — out of scope for v1 (15_Future_Roadmap)   │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ every permission maps to a row in §2.2 (Permission Justification Table) — no orphan perms
   ↑ the 3 scoped permissions (fs, shell, dialog) are the load-bearing scope restrictions
   ↑ the ❌ list is the §2.3 "What Is Explicitly NOT Allowed" — adding any requires stop-and-ask
     (desktop/AGENTS.md §8 #1)
   ↑ core:default is Tauri's safe-by-design baseline — no scope restriction needed
   ↑ the allowlist is reviewed on every PR; broadening it is the #1 stop-and-ask trigger
   ↑ cross-refs: §2.1 (main.json), §2.2 (justification), §2.3 (NOT ALLOWED), §11 (fs scope),
     §11.2 (shell scope), 01 §6 (allowlist summary), desktop/AGENTS §8 #1 (stop-and-ask)
```

### 16.3 M2 — PIN/Biometric Challenge Flow (BR-SEC-04 ≤30s Fresh-PIN Gate)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  App is unlocked. User clicks "Void receipt RCT-2025-000043" (a BR-SEC-04 action). │
│  ┌─ .glass card (Fees screen, ledger row) ─────────────────────────────────────┐   │
│  │ ●  RCT-2025-000043   Aarav Sharma   ₹4,500   Paid        [Void]  ›          │   │
│  └──────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (frontend invokes void_ledger_entry)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND  →  invoke('void_ledger_entry', { id, reason, pin })                      │
│  note: the frontend tracks `last_pin_verify` in a Zustand store; if > 30s old,      │
│        it shows the PIN prompt BEFORE invoking. If ≤ 30s old, it passes the pin     │
│        directly (the Rust command re-verifies — never trusts the frontend's clock). │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (Tauri IPC bridge, origin-validated per §4)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  RUST COMMAND:  void_ledger_entry(id, reason, pin, state)                           │
│  src-tauri/src/commands/ledger.rs                                                  │
│                                                                                      │
│   1. input.validate()?                          ← reason ≥ 1 char (BR-LED-04)      │
│   2. security::require_unlocked(&state)?        ← LockState::Unlocked (BR-SEC-01)   │
│   3. security::require_fresh_pin(&state, &pin, "void_ledger_entry")?                │
│      ┌─────────────────────────────────────────────────────────────────────────┐    │
│      │  if state.session.last_pin_verify < now() - 30s:                         │    │
│      │    return Err(Auth("PIN required — fresh PIN ≤30s window expired"))      │    │
│      │                                                                          │    │
│      │  argon2id::verify(pin, settings.pin_hash)?                               │    │
│      │    ├─ success → session.last_pin_verify = now()                          │    │
│      │    │              session.fail_count = 0                                 │    │
│      │    │              return Ok(())                                          │    │
│      │    └─ fail → session.fail_count += 1                                     │    │
│      │                ┌─ lockout policy (BR-SEC-03) ─────────────────┐          │    │
│      │                │  fail_count 1–2  → no lockout                │          │    │
│      │                │  fail_count 3    → 60s lockout               │          │    │
│      │                │  fail_count 4    → 120s lockout              │          │    │
│      │                │  fail_count 5    → 240s lockout              │          │    │
│      │                │  fail_count 6+   → 60s × 2^(n−3), cap 24h    │          │    │
│      │                │  fail_count 15   → WIPE local cache (§5.1)   │          │    │
│      │                └───────────────────────────────────────────────┘          │    │
│      │                audit_log (action='pin_lockout', metadata={fail_count})    │    │
│      │                return Err(Auth("PIN incorrect"))                          │    │
│      └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│   4. BEGIN TRANSACTION                                                              │
│      ├─ INSERT INTO ledger_entries (VOID row, reverses_entry_id = id)  ← BR-LED-04 │
│      ├─ INSERT INTO audit_log (action='payment_void', metadata={before, after})    │
│      └─ INSERT INTO sync_outbox (operation='insert')   ← BR-SYN-02 (Rule 7)        │
│   5. COMMIT                                                                         │
│   6. return Ok(LedgerEntry)                                                         │
└────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (Result<LedgerEntry, Error> serialized via serde)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND RESOLVE                                                                   │
│  • on Ok  → close row, push VOID entry to Zustand, emerald toast (4s) "Receipt     │
│             RCT-2025-000043 voided. Reversing entry RCT-2025-000044 created."       │
│  • on Err(Auth("PIN required")) → show PIN prompt modal (below)                     │
│  • on Err(Auth("PIN incorrect")) → flare toast "PIN incorrect. 3 attempts before    │
│             60s lockout." (persistent until user dismisses or 60s elapses)          │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  PIN PROMPT MODAL  (shown when last_pin_verify > 30s old)                           │
│  ┌─ backdrop: bg-black/60 + backdrop-blur-sm (§8.7) ──────────────────────────────┐│
│  │  ┌─ .glass-strong modal (8% white, 24px blur, p-6, gap-4) ──────────────────┐  ││
│  │  │  Confirm void receipt                                  ✕   ← ghost btn  │  ││
│  │  ├──────────────────────────────────────────────────────────────────────────┤  ││
│  │  │  You are voiding RCT-2025-000043 (₹4,500, Aarav Sharma).                │  ││
│  │  │  A reversing entry will be created. This cannot be undone.              │  ││
│  │  │                                                                          │  ││
│  │  │  Reason (required)                                                       │  ││
│  │  │  ┌────────────────────────────────────────────┐  ← .neumo-inset (§8.9)  │  ││
│  │  │  │ Duplicate payment                         │     cyan focus ring       │  ││
│  │  │  └────────────────────────────────────────────┘                          │  ││
│  │  │                                                                          │  ││
│  │  │  Enter PIN to confirm                                                    │  ││
│  │  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                  │  ││
│  │  │  │  •   │ │  •   │ │  •   │ │      │ │      │ │      │  ← .neumo-inset  │  ││
│  │  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     6-digit PIN   │  ││
│  │  │                                                                          │  ││
│  │  │  ┌────────────┐  ┌──────────────────────┐                                │  ││
│  │  │  │  Cancel    │  │ ▌ Void Receipt        │  ← primary = .neumo-raised     │  ││
│  │  │  └────────────┘  └──────────────────────┘     (ghost = transparent, §8.2)│  ││
│  │  └──────────────────────────────────────────────────────────────────────────┘  ││
│  └──────────────────────────────────────────────────────────────────────────────────┘│
│   ↑ the modal = .glass-strong (8% white, 24px blur) + bg-black/60 backdrop per §8.7│
│   ↑ the PIN input = .neumo-inset well + cyan 2px inset ring on focus (§8.9)         │
│   ↑ the reason input = .neumo-inset (same recipe, larger well for free text)        │
│   ↑ the primary CTA "Void Receipt" = .neumo-raised + FLARE glow (destructive, §8.2) │
│   ↑ the ✕ close button = ghost (transparent, --text-secondary) per §8.2             │
│   ↑ the biometric fallback button (if settings.biometric_enabled=1) appears below    │
│     the PIN input — tapping it calls biometric_unlock() which sets last_pin_verify  │
│   ↑ the BR-SEC-04 ≤30s window is enforced in RUST, not the frontend — the frontend  │
│     clock is untrusted; only state.session.last_pin_verify (server-side) counts     │
│   ↑ the lockout counter is per-device (BR-SEC-03) — a thief cannot drain attempts    │
│   ↑ cross-refs: §5.1 (key lifecycle), §12 (PIN gate), BR-SEC-01/03/04/05/08,         │
│     BR-LED-04 (void requires PIN), BR-SYN-02 (sync_outbox same TX), §8.7 (modal),    │
│     §8.9 (input), §8.2 (button), §8.8 (toast)                                       │
```

### 16.4 M3 — Scope Diagram per Command (fs / shell / dialog boundaries)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  DESKTOP FILESYSTEM (per OS — paths from §11.1)                                     │
│                                                                                      │
│  Windows:                                                                            │
│  C:\Users\<user>\AppData\                                                            │
│  ├── Local\Buddysaradhi\                ← APP_DATA_DIR  (binary, NOT roamed)             │
│  │   └── buddysaradhi.db                ← SQLCipher ciphertext (10_Security §14.2)       │
│  └── Roaming\Buddysaradhi\              ← APP_CONFIG_DIR (roamed on domain join)         │
│      ├── .store.dat                ← tauri-plugin-store (window.state, last_crash)  │
│      ├── backups\                  ← fs:allow-read-dir scope  ✅ ALLOWED             │
│      │   ├── 2025-01-15.buddysaradhi                                                     │
│      │   └── 2025-01-22.buddysaradhi                                                     │
│      ├── receipts\                 ← shell:allow-open scope  ✅ ALLOWED (*.pdf only)│
│      │   ├── RCT-2025-000043.pdf                                                    │
│      │   └── RCT-2025-000044.pdf                                                    │
│      └── crash-<ts>.dmp            ← crash dumps (10_Security §3.6, never sent)     │
│                                                                                      │
│  macOS / Linux:                                                                      │
│  ~/Library/Application Support/Buddysaradhi/   (macOS)                                   │
│  ~/.local/share/Buddysaradhi/                  (Linux, APP_DATA_DIR)                     │
│  └── (same structure as Windows APP_CONFIG_DIR above)                               │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  PERMISSION SCOPE BOUNDARIES                                                        │
│                                                                                      │
│  ┌─ fs:allow-read-dir ─────────────────────────────────────────────────────────┐    │
│  │  webview MAY read:   ${APP_CONFIG_DIR}/backups/   ← the "Recent backups" list│   │
│  │  webview MAY NOT read:                                                       │   │
│  │    ✕ ${APP_DATA_DIR}/buddysaradhi.db     ← SQLCipher DB (Rust-only)              │   │
│  │    ✕ ${APP_CONFIG_DIR}/.store.dat   ← tauri-plugin-store (Rust-only)        │   │
│  │    ✕ ${APP_CONFIG_DIR}/receipts/    ← receipts (Rust writes, shell opens)   │   │
│  │    ✕ ${APP_CONFIG_DIR}/crash-*.dmp  ← crash dumps (Rust-only)               │   │
│  │    ✕ ~ (user home)                  ← never                                   │   │
│  │    ✕ / (filesystem root)            ← never                                   │   │
│  │    ✕ OS keychain                    ← not a file; only Rust via keyring crate│  │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│  ┌─ shell:allow-open ──────────────────────────────────────────────────────────┐    │
│  │  webview MAY open:   ${APP_CONFIG_DIR}/receipts/*.pdf   ← via shell:open()  │   │
│  │                       (opens in OS default PDF viewer)                       │   │
│  │  webview MAY NOT open:                                                       │   │
│  │    ✕ *.pdf outside receipts/        ← scope restricted                       │   │
│  │    ✕ *.exe / *.app / *.dmg          ← no executable opening                  │   │
│  │    ✕ https://* URLs                 ← shell:allow-open-url NOT in allowlist  │   │
│  │    ✕ mailto: / tel: / sms:          ← no scheme handling from webview        │   │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│  ┌─ dialog:allow-save ─────────────────────────────────────────────────────────┐    │
│  │  webview MAY show:   native Save dialog (single-shot, no path persistence)   │   │
│  │                       returns a PathBuf the user chose                       │   │
│  │  webview MAY NOT:                                                            │   │
│  │    ✕ remember the last save path    ← single-shot only                       │   │
│  │    ✕ write to the chosen path       ← Rust writes; webview only picks        │   │
│  │    ✕ show the dialog without user gesture   ← requires a click event         │   │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ the three scoped permissions are the load-bearing filesystem defence — broadening
     any scope is a stop-and-ask (desktop/AGENTS §8 #1)
   ↑ the SQLCipher DB at ${APP_DATA_DIR}/buddysaradhi.db is NEVER accessible to the webview —
     even an XSS in the webview cannot read it (no fs permission, only Rust opens it)
   ↑ the OS keychain is not a file — it is accessed only via the Rust `keyring` crate,
     which calls Security.framework (macOS), Credential Manager (Windows), or Secret
     Service / D-Bus (Linux). The webview has zero keychain access.
   ↑ the receipts/ dir is write-Rust, open-shell — the webview picks the path via
     dialog:allow-save, Rust writes the PDF, the webview then opens it via shell:open
   ↑ the .store.dat file holds window.state + last_crash + updater.pending_version —
     Rust reads/writes via tauri-plugin-store; the webview reads via store:allow-get
   ↑ cross-refs: §2.1 (main.json), §2.2 (justification), §11 (fs scope), §11.1 (APP_CONFIG_DIR),
     §11.2 (shell scope), §5.3 (keychain entries), 10_Security §14.2 (DB paths),
     desktop/AGENTS §8 #1 (stop-and-ask on permission changes)
```

### 16.5 Coverage Audit

| §20.4 mockup type | Coverage in this file |
|---|---|
| Concept diagram (architecture / scope) | M1 allowlist tree, M3 scope diagram |
| Component anatomy | M2 PIN prompt modal (annotated with glass/neumo tiers) |
| State matrix | M2 lockout policy table (5/10/15 fails → 30s/5min/wipe) |
| Full-screen layout | (n/a — 03 is a security spec, not a screen) |

> All three mockups above sit inside fenced code blocks per §20.3 rule 1. Box widths 84–116 chars (within the 80–120 desktop window range per §20.3 rule 2). Character set per §20.2 (┌┐└┘├┤┬┴─│▌░▒▓█●○◉◐✕✓▲▼›»←→↑↓⌘⌥⇧₹·). Glass tiers annotated (`.glass`, `.glass-strong`, `.glass-faint`) per §5.5; neumorphic controls recipe-annotated (`.neumo-raised`, `.neumo-inset`, `.neumo-pressed`) per §6.6. Accent colours named (emerald / cyan / amber / flare / violet), never hexed in mockup notes per §20.3 rule 6. Cross-references use canonical IDs only (`§5.1`, `§5.3`, `§8.2`, `§8.7`, `§8.8`, `§8.9`, `§10.2`, `§11`, `§11.1`, `§11.2`, `§12`, `BR-SEC-01/03/04/05/08`, `BR-LED-04`, `BR-SYN-02`, `LEDGER-1`..`LEDGER-4`).
