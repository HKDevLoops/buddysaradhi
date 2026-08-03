# 10 — Security

> Buddysaradhi holds a tutor's livelihood and a minor's personal data. Security is tactile (felt by the user) and structural (enforced by the data model), not theatrical.

> The single non-negotiable invariant: **no plaintext PII ever leaves the device**. The Turso cloud DB is itself an encrypted replica the tutor owns; the only artefact that routinely crosses an untrusted boundary is an AES-256-GCM `.buddysaradhi` envelope keyed to a passphrase the user chose.

---

## 1. Trust Model

| Asset | Owner | Trust Boundary |
|-------|-------|----------------|
| Tutor account (Supabase Auth) | Tutor | Supabase (managed) |
| Per-user Turso DB | Tutor | Turso (managed) + scoped JWT |
| Local SQLite / embedded replica | Tutor's device | OS keychain/keystore + SQLCipher (desktop) |
| Receipts (PDFs) | Tutor + Parent (read-only via signed URL) | Time-limited signed URL |
| Backups (`.buddysaradhi`) | Tutor | AES-256-GCM + user passphrase |
| Audit log | Tutor | Append-only, trigger-guarded |
| `tenant_secret` (receipt-hash pepper) | Tutor's DB only | Generated at provisioning; never exported in plaintext |
| Derived backup key (in-memory) | Process memory only | Zeroed on lock/exit; never persisted |

The tutor is the **sole** authenticated user of their tenant DB. Students/parents have **no** accounts in v1. A parent's only access is a signed URL to a receipt. Data lives in three places — the tutor's device, the Turso cloud replica, the user's `.buddysaradhi` file; anywhere else it should be inert ciphertext.

Mental model: **Buddysaradhi-the-product has no servers that touch plaintext user data.** Turso is encrypted at the storage layer; Supabase auth holds email + password hash only; the `.buddysaradhi` envelope is opaque without the passphrase. No data lake, no analytics pipeline, no central log of tutor activity. If a court ordered us to produce a tutor's data, we could hand over… nothing of value.

---

## 2. Authentication & Provisioning

### 2.1 Signup (Web-initiated)
1. Tutor signs up via Supabase Auth (email/password or Google OAuth). The `user.created` webhook fires the `provision-db` Edge Function.
2. Function calls Turso Platform API: `POST /v1/databases` with name `buddysaradhi-{user_uuid}`.
3. Turso returns `db_url`; function creates a scoped `db_token` with claims `{ db_url, tenant_id: user_uuid }`, writes it into Supabase `user_metadata`, returns success.
4. Client reads `user_metadata.db_url` + `db_token` from the Supabase session and initialises `@libsql/client`.
5. At first local-cache init, the device generates `tenant_secret` (256-bit cryptographically random) and writes it to `app_state` — the pepper for all receipt/invoice tamper hashes (`07_Fees_and_Payments.md` §10, BR-FEE-05).

### 2.2 Service-Role Isolation
- Supabase `service_role` key lives **only** in the Edge Function env. Never in the client bundle. Never in a Next.js client component. Lint rule: `no-restricted-syntax` blocks any import of `process.env.SUPABASE_SERVICE_ROLE` outside `apps/web/server/`.
- All client DB access uses the per-user scoped Turso token, not the service role.
- CI test `no-service-role-in-client.test.ts` fails the build if `service_role` appears in any client-bound chunk.

### 2.3 Mobile / Desktop Inheritance
- Same Supabase project; Google OAuth via `expo-auth-session` (mobile) / popup (desktop).
- Session sync carries `user_metadata.db_url + db_token` to the device.
- Token stored in `expo-secure-store` (Keychain/Keystore) on mobile; OS credential store via Tauri plugin on desktop. **Never** in AsyncStorage / localStorage / plaintext config.
- Startup probe `assertNoPlaintextToken` scrubs and re-auths if the token is detected in `localStorage`/`AsyncStorage`.

---

## 3. App Lock — PIN & Biometric Architecture

### 3.1 Lock States
- `unlocked` — app usable.
- `locked` — content pane blurred, sidebar disabled; only the unlock sheet is interactive.
- `panic` — see §3.6. Visually identical to `unlocked` but on a blank DB.

### 3.2 Lock Triggers
- Cold start; idle timeout (`session_timeout_min`, default 5 min); manual "Lock" in Sync drawer; backgrounded mobile/desktop (`AppState='inactive'`); web tab hidden > 60 s.

### 3.3 Unlock Methods (priority order)
1. **Biometric** (FaceID/TouchID on mobile/desktop; WebAuthn on web v1.x) — preferred.
2. **PIN** (6-digit) — fallback; argon2id-hashed in `settings.pin_hash`.
3. **Panic PIN** (optional, see §3.6).

### 3.4 PIN Storage & Verification

The PIN is **never** stored in plaintext. Verification flow:

```pseudo
# at PIN setup:
salt     = crypto.randomBytes(16)
pepper   = app_state.tenant_secret          # same pepper as receipt hashes
pin_hash = argon2id(pin || pepper, salt, {m:64MiB, t:3, p:2})
settings.pin_hash = base64(salt || pin_hash)

# at unlock:
stored          = decode(settings.pin_hash)
salt, pin_hash  = split(stored, 16)
candidate       = argon2id(entered_pin || pepper, salt, {m:64MiB, t:3, p:2})
match           = constantTimeEquals(candidate, pin_hash)
```

The pepper means that even a full DB exfiltration (e.g., a stolen unlocked laptop with the SQLCipher key in the OS keychain) cannot be brute-forced offline without `tenant_secret`, which is itself encrypted at rest. The Argon2id cost (~400 ms/guess) is far too slow for a 6-digit space (10⁶) to be exhaustively searched.

### 3.5 Lockout & Exponential Backoff

Failed-PIN response is escalating and **server-independent** (works offline):

| Consecutive failures | Lockout | UX |
|---|---|---|
| 1–2 | none | shake animation, "Try again" |
| 3 | 60 s | countdown timer; biometric disabled until countdown ends |
| 4 | 120 s | " |
| 5 | 240 s | " |
| 6+ | 60 s × 2^(n−3), capped at 24 h | " |
| 10 cumulative (non-reset) | local cache wipe | `audit_log` `pin_lockout_wipe`; forces Supabase re-login |

Cumulative count resets on a successful unlock. Lockout is per-device (a thief with one phone can't drain attempts from another).

### 3.6 Panic PIN (Optional)

If the tutor configures a panic PIN (`settings.panic_pin_hash`), entering it unlocks the app into a **blank database view**: zero students, zero ledger, zero attendance. The real local cache is overwritten with an empty schema before the home screen renders — no "switch back" affordance; recovery is via Settings → Restore from backup. A trained observer (extortionist, aggressive family member) sees a normal Buddysaradhi install with no data.

> **Invariant (PANIC-1):** Entering the panic PIN MUST NOT log `panic_unlock` to `audit_log` — the audit log would betray the real DB. The panic event goes only to a separate `panic_log` table outside the encrypted envelope, crypto-shredded (key zeroed) on each panic unlock.

Opt-in, off by default, surfaced with clear warnings about the wipe consequence.

### 3.7 Biometric Fallback Discipline

- `expo-local-authentication`: FaceID/TouchID required to unlock (if `settings.biometric_enabled`).
- The biometric **never stores the PIN**. Biometric unlock releases the *envelope key* wrapping the derived session key from the OS keychain — the OS releases it only on a successful biometric prompt. The PIN is never reconstructed.
- Fallback to PIN on biometric failure/unavailability.
- Biometric enrolment change logs `audit_log` `biometric_reenrol` (OS notifies us) — catches the "enrol your face on someone else's phone" attack.

---

## 4. Sensitive-Mutation PIN & Export Controls Matrix

Even when the app is unlocked, the actions below require a **fresh** PIN/biometric entry (≤ 30 s old). The list is duplicated as a code constant in `packages/security/SENSITIVE_ACTIONS.ts`; a CI test asserts the UI registry matches 1:1.

| Action | Why gated | Required auth |
|--------|-----------|---------------|
| Void a receipt | Reverses money; irreversible without audit | PIN ≤ 30s |
| Unlock attendance (post-auto-lock) | Re-opens frozen records | PIN ≤ 30s |
| Post a backdated ledger entry | Money in the past | PIN ≤ 30s |
| Bulk delete (students, batches) | Mass data loss | PIN ≤ 30s + typed "DELETE" |
| Export full backup (`.buddysaradhi`) | Exfiltrates all data | PIN ≤ 30s + typed `EXPORT` |
| Restore a backup | Overwrites current state | PIN ≤ 30s + typed `RESTORE` |
| Change PIN / disable biometric | Trust-boundary change | current PIN + typed "CHANGE" |
| Disable app lock | Disables session security | current PIN + typed "DISABLE" |
| Reveal `tenant_secret` (debug) | Root-of-trust disclosure | PIN + typed "REVEAL" + dev flag |
| Monthly Excel export (`BR-BAT-03`) | Aggregate PII, derived/scrubbed | **exempt** — single-tap confirm |
| Single-receipt / statement PDF | Already visible on screen | **exempt** |

This implements `12_Business_Rules.md` **BR-SEC-02** (sensitive-mutation PIN) and **BR-SEC-04** (typed confirm for full export). Every entry writes `audit_log` *before* the mutation is applied (fail-closed: if the audit write fails, mutation is blocked).

### 4.1 Export Controls Matrix — Full Picture

Cross-referenced with `09_Backup_and_Import_Export.md`:

| Operation | Surface | Sensitivity | Required auth | Cross-ref |
|---|---|---|---|---|
| Full backup (`.buddysaradhi`) create | Settings → Backup | **Critical** | PIN ≤ 30 s + typed `EXPORT` | BR-BAT-01, BR-SEC-04 |
| Restore `.buddysaradhi` | Settings → Restore | **Critical** | PIN ≤ 30 s + typed `RESTORE` | BR-BAT-02 |
| Excel export (3-sheet) | Settings / Reports | Medium (derived PII) | single-tap confirm | BR-BAT-03 |
| Excel template import | Settings → Import | Medium (ingests data) | none (read-only) | BR-BAT-04 |
| Single-receipt PDF | Receipt view | Low (already visible) | none | BR-RC-02 |
| Monthly parent statement | Reports | Low-Medium | none | BR-RC-03 |
| Audit log export | Settings → Security | **High** | PIN ≤ 30 s | BR-SEC-03 |
| `tenant_secret` reveal | Debug menu | **Critical** | PIN + typed `REVEAL` + dev flag | §2.1 |
| Sync push (outbox flush) | Background | Low (encrypted) | none | BR-SYN-03 |

> **Invariant (EXP-1):** No export path may emit `ledger_entries` to a non-encrypted format without typed confirmation. Test `no-plaintext-ledger-export.test.ts` fails if a raw ledger row reaches a writable stream without passing through AES-256-GCM.

---

## 5. Data at Rest

| Surface | Protection | Key holder |
|---------|------------|------------|
| Turso Cloud (per-user DB) | Turso-managed encryption at rest + scoped JWT in transit | Turso + tutor's auth |
| Mobile local SQLite | iOS Data Protection (`NSFileProtectionComplete`) / Android EncryptedFilesystem + `expo-secure-store` for tokens | OS keychain, released on device unlock |
| Desktop local SQLite | **SQLCipher** via Rust `rusqlite`; key in OS keychain | OS keychain (Tauri `keyring`) |
| Web IndexedDB cache | No sensitive PII stored; tokens in httpOnly cookies; cache is derived/scrubbed | n/a — nothing to protect |
| Backups (`.buddysaradhi`) | AES-256-GCM; key derived from user passphrase via argon2id | Tutor's passphrase (only) |
| `tenant_secret` (pepper) | Lives only inside the encrypted DB; never exported except inside a `.buddysaradhi` envelope | DB itself |
| Derived backup key (in-memory) | Process memory only; zeroed on lock/exit | Process; never persisted |
| Audit log | Append-only (trigger-guarded), inside encrypted DB | DB itself |

### 5.1 Key Zeroing Discipline

Every long-lived secret in process memory is wrapped in a `SecureBuffer` whose `clear()` runs on: app lock (§3.2), app background / tab hide (web, after 60 s), process exit (`beforeExit` + `SIGHUP`), and any crypto exception. `SecureBuffer` overwrites with zeros **twice** (some compilers optimise away a single write); on Tauri/Rust we additionally call `memzero` from the `zeroize` crate. The PIN, the derived backup key, the biometric envelope key, and the SQLCipher key are all `SecureBuffer` instances.

---

## 6. Data in Transit

- All API calls over **TLS 1.3** minimum. TLS 1.2 only for legacy Supabase endpoints, forward secrecy enforced (ECDHE-only cipher suites).
- Mobile/desktop **certificate pin** the Supabase and Turso endpoints (public-key hash pinning) — defends against compromised CAs. Pinning disabled in dev for proxy debugging.
- WebSocket (Turso sync) over WSS; same pinning.
- Test `no-http-urls.test.ts` fails the build on any `http:` URL not on the vetted exception list (currently: `http://localhost` for dev only).

---

## 7. Row-Level Security (Defence-in-Depth)

Even though each Turso DB is single-tenant, every table carries `tenant_id` and we enforce: the Turso scoped JWT embeds `tenant_id = user_uuid`; a DB-level view layer appends `WHERE tenant_id = ?` to every query, bound from the JWT claim — never from client input. Protects against a future multi-tenant mishap or token-theft lateral move. CI lint rule `tenant-predicate-required` fails the build if a tenant-scoped table is queried without the predicate. Audit log records every query's `tenant_id` for forensics.

---

## 8. Audit Log

### 8.1 Schema & Retention
Append-only (`11_Data_Model.md` §3.14) — `BEFORE UPDATE`/`BEFORE DELETE` triggers raise `E_AUDIT_IMMUTABLE`. Retained **indefinitely**, included in backups, not truncated by the 200-row notification cap. Viewable in Settings → Security → Audit Log (filter by action, date, actor; read-only; exportable only inside a full backup — BR-SEC-04).

### 8.2 Audited Actions (non-exhaustive)
`attendance_lock`, `attendance_unlock`, `attendance_edit_locked`, `payment_void`, `fee_void`, `backdated_ledger`, `bulk_delete`, `export_full`, `export_excel`, `backup_create`, `backup_restore`, `pin_change`, `biometric_toggle`, `biometric_reenrol`, `sync_conflict_lost`, `provision_db`, `schema_migration`, `token_rotated`, `receipt_tamper_detected`, `ledger_integrity_violation`, `audit_chain_broken`, `pin_lockout_wipe`, `erase_initiated`, `erase_complete`.

### 8.3 Audit Log Tamper-Evidence

A weekly background job (`audit_reconcile_job`, Sun 02:00 local) recomputes a running SHA-256 chain: `h[n] = sha256(h[n−1] || canonical_json(row[n]))`. The chain head lives in `app_state.audit_chain_head`. Any out-of-band insert/update/delete breaks the chain; the next job logs `audit_chain_broken` and surfaces a red banner in Settings → Security.

---

## 9. Ledger Integrity & Tamper Evidence

The ledger is the spine (`07_Fees_and_Payments.md` §3–§10; `12_Business_Rules.md` §3). Three structural invariants make it tamper-evident without cryptography; a fourth cryptographic layer makes tamper provable.

### 9.1 Structural Invariants

> **Invariant (LEDGER-1) — Append-only.** `BEFORE UPDATE` / `BEFORE DELETE` triggers on `ledger_entries` raise `E_LEDGER_IMMUTABLE`. No code path — including migrations — disables these triggers outside a documented, audited migration script.

> **Invariant (LEDGER-2) — Monotonic client sequence.** Each row carries `client_seq` (per-tenant monotonic integer) **and** a UUID v7. Gaps are tolerated (offline rows land out of order on sync); *repeats* are not — `INSERT OR IGNORE` on a UUID collision is treated as sync-idempotency success but logged; an attempted overwrite with different payload raises `E_LEDGER_INTEGRITY_VIOLATION` (BR-LED-02).

> **Invariant (LEDGER-3) — Running balance reconciliation.** For each `student_id`, the running sum of `signed_amount` (charge positive, credit negative) over non-void rows must equal `balance_due`. The `ledger_reconcile_job` (nightly 01:00 local) recomputes the entire ledger from row 0; any drift writes `E_LEDGER_INTEGRITY_VIOLATION` and surfaces in Settings → Security.

### 9.2 Voiding (Not Deleting)

A "void" is a *new row* with `type='VOID'` and `reverses_entry_id` pointing at the original — the original remains, fully visible. Derived balances exclude voided rows via `type <> 'VOID' AND reverses_entry_id IS NULL` (BR-LED-02). "Void a receipt" is in the sensitive-mutation PIN list (§4) because it's a money-reversing operation that must be auditable forever.

> **Invariant (LEDGER-4) — No physical deletes.** No code path calls `db.ledgerEntry.delete()` / `db.ledgerEntry.deleteMany()`. A CI test (`no-ledger-delete.test.ts`) fails the build if any `.ts`/`.tsx`/`.sql` file calls those methods (or invokes `$executeRaw` / `$queryRaw` against `ledger_entries`). The only "deletion" affordance is a void. The single, audited exception is the secure-erase flow (§18.1), which uses the **Prisma ORM method** `db.ledgerEntry.deleteMany({})` inside a `db.$transaction([ ... ])` cascade (see §18.1 step 4) within the audited `lib/security/secureErase.ts` module — the only place in the codebase where `db.ledgerEntry.deleteMany()` is permitted by the lint rule (via an audited `// eslint-disable-next-line no-ledger-delete` allowlist entry), gated behind BR-SEC-04 PIN + typed "ERASE" + crypto-shred. No raw SQL (`$queryRaw` / `$executeRaw`) is used anywhere in the codebase at runtime — the sole exception is the SQLite admin command `VACUUM` (§18.1 step 5), which has no Prisma ORM equivalent and is confined to `lib/db/admin.ts`.

### 9.3 Cryptographic Tamper Layer

Each row carries `row_hash = sha256(canonical_json(tenant_id || client_seq || uuid || student_id || type || direction || amount || occurred_on || reverses_entry_id || tenant_secret))`. The pepper means an attacker with DB-write access (but not the pepper, which lives only inside the encrypted DB) can't recompute valid hashes after editing. The reconciliation job verifies `row_hash` on every row; mismatch raises `E_LEDGER_INTEGRITY_VIOLATION` and locks ledger writes until the tutor acknowledges (audit trail shows *which* row and *when*).

### 9.4 Reconciliation Job Behaviour

`ledger_reconcile_job` runs nightly and is triggerable on-demand from Settings → Security → "Verify integrity". On violation: (1) sets `app_state.ledger_write_locked = 1` — a trigger raises `E_LEDGER_WRITE_LOCKED` on every `INSERT`; (2) writes `audit_log` `ledger_integrity_violation` with offending UUIDs; (3) surfaces a red banner: "Ledger integrity check failed. Recording payments is paused. Restore from last backup or contact support."; (4) disables sync push (to avoid spreading corruption) but continues sync pull into a quarantine buffer for forensics.

---

## 10. Receipt Tamper-Evidence

- Every invoice + receipt carries `tamper_hash = sha256(number || student_id || total || issue_date || tenant_secret)` (BR-FEE-05, BR-RC-02).
- `tenant_secret` (256-bit random) is generated at provisioning (§2.1), stored in `app_state`, never in client-readable config.
- On audit/receipt-view the hash is recomputed; mismatch triggers a red "TAMPERED" badge + `audit_log` `receipt_tamper_detected`.
- The last 8 hex chars of the hash are printed on the PDF as a "verification code" — a parent or CA phones the tutor, reads the code, the tutor re-derives it from the ledger (proving the PDF wasn't fabricated). Catches casual DB edits and screenshot forgery.

---

## 11. Input Validation & Injection Defence

- **Zod** schemas (`packages/shared`) validate every form input before it reaches an API route or DB write.
- **Parameterised queries** only — `@libsql/client` prepared statements. No string interpolation into SQL. Lint rule `no-restricted-syntax` bans `db.exec(template-string-with-${})`.
- **Rich text** (student notes, receipt descriptions) sanitised with DOMPurify before render.
- **File imports** (Excel/CSV) validated cell-by-cell against Zod; malicious rows skipped. Parser runs in a sandboxed worker with no FS/network; formula evaluation disabled (`xlsx` with `cellFormula: false`).
- **Path traversal** blocked via `path.basename()` + positive extension allowlist (`*.buddysaradhi`, `*.xlsx`); `/api/spec` uses the same pattern.

---

## 12. Web Security Posture

### 12.1 CSP (next.config.js)
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline';   (* 'unsafe-inline' only for Next.js runtime; tighten with nonces in v1.x *)
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  connect-src 'self' https://*.supabase.co wss://*.turso.ai https://*.turso.ai;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

### 12.2 Headers
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` · `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy: geolocation=(), microphone=(), camera=()`.

### 12.3 Supabase SSR
- `@supabase/ssr` cookie session (httpOnly, secure, sameSite=lax). Refresh-token rotation enabled. `service_role` read from `process.env` only — never client-side.

---

## 13. Mobile Security Posture

### 13.1 Secure Storage
- Supabase refresh token → `expo-secure-store` (`SecureStore.keychainService`).
- Turso `db_token` → same keychain (device-unlocked only).
- PIN hash → argon2id + pepper, stored in `settings.pin_hash` (in the OS-encrypted local SQLite).

### 13.2 Biometrics — see §3.7 for the architecture.

### 13.3 Network & ATS
- `expo-network` + custom fetch wrapper enforcing HTTPS only.
- Certificate pinning via `expo-build-properties` + platform native config.
- iOS `NSAppTransportSecurity` requires `NSAllowsArbitraryLoads = false` (no per-domain exceptions).
- Android `network_security_config.xml` pins base64 public-key hashes for `*.supabase.co` and `*.turso.ai`; cleartext only for `10.0.2.2` (emulator dev).

### 13.4 Jailbreak / Root Detection
- Soft detection (`expo-local-authentication` + heuristics: Cydia/Substrate/Magisk) sets `app_state.device_rooted = 1`. The app does not refuse to run (punishes legitimate users) but: forces `session_timeout_min` ≤ 2 min; disables biometric unlock; surfaces a one-time yellow banner.

---

## 14. Desktop Security Posture

### 14.1 IPC Isolation
- Frontend (Next.js static export) runs in WebView2/WebKit sandbox; **no** direct filesystem access.
- All FS/DB operations go through Tauri `invoke` commands, each gated by **Capabilities** (allowlist of origins + commands). Inputs validated by `serde` structs in Rust before DB touch.

### 14.2 SQLCipher
- Local SQLite opened with `key='...'` (SQLCipher pragma — a SQLite-level admin command with no Prisma ORM equivalent; runs ONCE at DB init inside `lib/db/admin.ts`). Key in OS keychain (Tauri `keyring` plugin).
- DB file at `%APPDATA%/Buddysaradhi/buddysaradhi.db` (Windows), `~/Library/Application Support/Buddysaradhi/` (macOS), `~/.local/share/Buddysaradhi/` (Linux).
- `journal_mode = WAL`; `synchronous = NORMAL`. Backups issue `PRAGMA wal_checkpoint(TRUNCATE)` before reading — a SQLite-level admin command with no Prisma ORM equivalent; runs ONCE per backup-verify, not in any runtime hot path, inside `lib/db/admin.ts`.

### 14.3 Code Signing & Updater
- Windows EV code-signed (SmartScreen); macOS notarized + Developer ID (Gatekeeper); Linux `.deb`/`.rpm` GPG-signed (key in repo).
- `latest.json` on Vercel Blob is minisign-signed; the updater verifies the signature before applying any patch. Private key in GitHub Secrets; rotated public key shipped with each major version.

---

## 15. Backup Crypto Deep-Dive

Cross-ref `09_Backup_and_Import_Export.md` §15. The `.buddysaradhi` file is the only artefact that routinely crosses an untrusted boundary (a pen-drive, an email inbox, a cloud drive the user controls). Its security is therefore disproportionate to its size.

### 15.1 The Envelope

```
.buddysaradhi = MAGIC(4)  +  FORMAT_VERSION(1)  +  SALT(16)  +  NONCE(12)  +  TAG(16)  +  CIPHERTEXT(variable)
          "TUT0"        0x01                  random       random       GCM tag     AES-256-GCM(key, nonce, plaintext)

where:
   plaintext    = gzipped tar of { data.jsonl, schema_version.txt, manifest.json }
   key          = argon2id(passphrase, salt, { m: 64 MiB, t: 3, p: 2 })
   manifest.json = { sha256(data.jsonl), row_counts{}, tenant_id, created_at, schema_version, app_version }
```

Byte layout: `magic` (offset 0, 4 B) → `format_version` (4, 1 B) → `salt` (5, 16 B, **random per file**) → `nonce` (21, 12 B, **random per file** — GCM is catastrophic under nonce reuse) → `tag` (33, 16 B, read before ciphertext) → `ciphertext` (49, variable). The format-version byte lets us introduce a v2 envelope without breaking old restores.

### 15.2 Why AES-256-GCM?

GCM is an **authenticated** mode — it produces a ciphertext and a 128-bit tag. On decrypt the tag is recomputed; any bit-flip in ciphertext/nonce/tag fails the check before any plaintext is parsed. A corrupted or maliciously-edited `.buddysaradhi` is *detected*, not silently decoded. Combined with the SHA-256 manifest hash, the envelope has two independent integrity layers.

AES-256 (over AES-128) gives regulatory headroom at negligible cost (AES-NI / ARMv8 crypto extensions are universal). ChaCha20-Poly1305 was benchmarked at parity on devices without hardware AES; we standardised on GCM for tooling availability across Web Crypto, Rust `aes-gcm`, and Swift `CryptoKit`.

### 15.3 Why Argon2id (m=64 MiB, t=3, p=2)?

Argon2id is the **memory-hard** KDF recommended by OWASP.
- **m = 64 MiB** — large enough to make GPU brute-force uneconomical (16 GiB GPU runs ~256 parallel instances vs ~100k for bcrypt), small enough for a 2 GiB phone.
- **t = 3** — ~400 ms wall-clock on M1 / Snapdragon 8 Gen 2.
- **p = 2** — exploits multi-core without inviting parallel brute-force (attacker faces the same memory wall).

The salt is **per-file random**: the same tutor backing up the same data with the same passphrase twice yields unrelated derived keys; cracking one file grants nothing about the other.

### 15.4 Key Zeroing & Session Hygiene

The derived backup key lives in a `SecureBuffer` (§5.1) for the duration of the encrypt/decrypt operation, then double-zeroed. The key is **never** persisted — no keychain entry, no IndexedDB record, no log line.

> **Invariant (BACKUP-1):** The passphrase is the only state needed to decrypt a `.buddysaradhi` file. No server-side escrow, no recovery key. Lost passphrase = unrecoverable backup. Surfaced at backup time: "If you forget this, we cannot recover your data." (BR-BAT-01.)

### 15.5 Round-Trip Test

CI test `backup-roundtrip.test.ts` generates a 1k-student fixture, backs it up, mutates one ciphertext byte, asserts restore fails with `E_WRONG_PASSPHRASE` (GCM tag mismatch), then restores the unmutated file and asserts row counts match. Runs on every PR; failure blocks merge.

---

## 16. Data Minimisation Inventory

Every PII field Buddysaradhi stores, with retention, encryption-at-rest status, and export-inclusion. Principle: **collect nothing you don't need, protect everything you collect**.

| Table | Field | PII class | Retention | Encrypted? | `.buddysaradhi`? | Excel? |
|---|---|---|---|---|---|---|
| `students` | `first_name`, `last_name` | Direct | archive + 7 yr | yes | yes | yes |
| `students` | `phone` | Direct | archive + 7 yr | yes | yes | yes |
| `students` | `email` | Direct | archive + 7 yr | yes | yes | no |
| `students` | `guardian_name`, `guardian_phone` | Direct (minor's guardian) | archive + 7 yr | yes | yes | yes |
| `students` | `address` | Direct | archive + 7 yr | yes | yes | no |
| `students` | `dob` | Direct (minor) | archive + 7 yr | yes | yes | no |
| `students` | `notes` | Free text | archive + 7 yr | yes | yes | no |
| `attendance_records` | `status` | Behavioural | archive + 3 yr | yes | yes | yes |
| `ledger_entries` | `amount`, `type`, `direction` | Financial | Indefinite (BR-LED-01) | yes | yes | no (via receipt) |
| `receipts` | `number`, `method`, `reference` | Financial | Indefinite | yes | yes | yes (monthly) |
| `invoices` | `total`, `tamper_hash` | Financial | Indefinite | yes | yes | no |
| `audit_log` | `action`, `actor`, `metadata` | Operational | Indefinite | yes | yes | no |
| `settings` | `pin_hash` | Credential | Until reset | yes (hashed) | **never** | never |
| `app_state` | `tenant_secret` | Credential | Indefinite | yes | yes (in envelope) | never |
| `app_state` | `audit_chain_head` | Integrity | Indefinite | yes | yes | never |

> **Invariant (MIN-1):** No PII field is ever transmitted in plaintext. The only outbound network calls carrying PII are Turso sync (encrypted WSS to the tutor's own DB) and Supabase auth (email only). No analytics SDK, no crash-reporter with PII, no third-party form widget.

---

## 17. No-Telemetry Contract

Buddysaradhi-the-product collects **nothing** from the tutor's device by default. No analytics SDK, no Sentry, no Mixpanel, no Amplitude, no PostHog. Inventory:

| Signal | Collected? | Where it goes | Default |
|---|---|---|---|
| Crash log (JS exception stack) | **Yes, local only** | `app_state.crash_log` (last 50); never uploaded | on |
| Update-check ping | **Yes, anonymous** | `buddysaradhi.app/api/update-check?version=<x.y.z>&platform=<…>` — no UUID/tenant/PII | on |
| "Share anonymous usage" toggle | **Opt-in** | aggregate counts (student/ledger count buckets, app version) monthly | **off** |
| Analytics SDK / Sentry / Mixpanel / Amplitude / PostHog | **Never** | n/a | n/a |
| Third-party form widgets | **Never** | n/a | n/a |
| Supabase auth events | Yes | Supabase (email + hashed password only) | required |
| Turso sync | Yes | Turso (tutor's own DB; encrypted in transit) | required |

The update-check ping is the only outbound call Buddysaradhi-the-product makes on its own behalf — it carries app version + platform label only. Disabling "Check for updates" in Settings stops even this.

> **Invariant (TELE-1):** A network monitor (Little Snitch, GlassWire, Wireshark) pointed at a Buddysaradhi install with "Share anonymous usage" off sees only: Turso WSS sync to `*.turso.ai`, Supabase HTTPS auth/sync to `*.supabase.co`, and one periodic GET to `buddysaradhi.app/api/update-check`. Nothing else. Test `no-unexpected-network.test.ts` fails if any other domain is contacted.

---

## 18. Secure Erase & Device Transfer

### 18.1 Secure Erase Flow

When the tutor taps Settings → Security → "Erase all data on this device":

```pseudo
1. Re-confirm: PIN ≤ 30s + typed "ERASE"
2. audit_log(erase_initiated)            # must succeed before any deletion
3. crypto_shred:
     for each key in OS keychain (SQLCipher key, Supabase refresh token, Turso db_token):
         OS keychain delete              # iOS: immediate; Android FBE keys unrecoverable after delete
     app_state.tenant_secret    = crypto.randomBytes(32)   # orphan all tamper hashes
     app_state.audit_chain_head = crypto.randomBytes(32)   # orphan audit chain
4. `db.$transaction([ db.student.deleteMany(), db.ledgerEntry.deleteMany(), ... ]) — the ONE exception to LEDGER-4`, gated by the audited `lib/security/secureErase.ts` module
5. `db.$executeRaw\`VACUUM\`` — **the sole raw-SQL exception in the entire codebase.** `VACUUM` is a SQLite-level admin command with no Prisma ORM equivalent (Prisma has no `db.vacuum()` method). It is confined to `lib/db/admin.ts` (the single audited admin module), runs ONCE during secure-erase, and is never called from any screen, server action, or API route. All other DB access in the secure-erase flow uses Prisma ORM methods (`deleteMany()` inside `$transaction`).
6. Desktop: write 0x00 over the .db file, then unlink. Mobile: rely on OS file protection + key eviction.
7. Revoke Supabase session server-side; audit_log(erase_complete); force re-login screen
```

Crypto-shredding (step 3) is the *real* erase — even with the raw `.db` recovered from the SSD, the SQLCipher key is gone from the OS keychain and the file is ciphertext with no recoverable key. The `deleteMany()` cascade + `VACUUM` + overwrite is belt-and-braces against a keychain bug.

### 18.2 Factory Reset

The OS handles this — iOS wipes data-protection class keys; Android drops FBE keys. Both render Buddysaradhi data unrecoverable in < 1 s. We only need to not store keys outside the OS keychain (which would defeat the OS's wipe).

### 18.3 Transfer to a New Device

The blessed flow (`08_Settings.md` → Backup & Data):

1. Old device: Settings → Backup → Create `.buddysaradhi` with a strong passphrase (PIN ≤ 30 s + typed `EXPORT`).
2. Move the file (pen-drive, email to self, cloud drive).
3. New device: install Buddysaradhi, sign in with Supabase, skip Turso auto-provision (or accept; the new DB will be overwritten on restore).
4. Settings → Restore → pick the `.buddysaradhi` → enter passphrase (PIN ≤ 30 s + typed `RESTORE`).
5. Verify: Settings → Security → "Verify integrity" runs the full ledger + audit chain + tamper-hash checks.
6. Once verified, on the old device: Settings → Security → "Erase all data on this device" (§18.1).

> **Invariant (XFER-1):** The transfer flow never involves a Buddysaradhi server holding the tutor's data. The Turso cloud DB *is* the user's property; the `.buddysaradhi` file is the user's offline copy; the new device pulls from one or both. Buddysaradhi-the-company is a bystander.

---

## 19. Sync Security (Future — v2.0)

The current sync model is single-device ↔ Turso cloud replica. Multi-device sync (phone + laptop simultaneously) is v2.0 work (`15_Future_Roadmap.md`).

### 19.1 End-to-End Encrypted Sync

The Turso cloud DB remains a **dumb blob store**. Buddysaradhi v2 wraps the per-tenant DB in an additional application-layer encryption envelope keyed to a passphrase-derived key the tutor controls. The cloud replica is ciphertext to Turso and to Buddysaradhi-the-company.

> **Invariant (SYNC-E2E-1):** The Turso server never sees a plaintext ledger row. The decryption key is derived from the tutor's passphrase (same one used for `.buddysaradhi` backups); the server cannot derive it without the passphrase.

### 19.2 Conflict Resolution

- **Ledger rows:** UUID-keyed, append-only, conflict-immune (BR-SYN-02). Two devices posting different entries for the same student both land.
- **Non-ledger rows:** Last-Write-Wins by vector clock + Lamport counter (BR-SYN-01). Loser's version goes to `audit_log` (`sync_conflict_lost`) — no silent overwrite.
- **Schema drift:** if a device's `app_state.schema_version` < server's, the device refuses to sync (BR-SYN-04).

### 19.3 Server Is Dumb

The sync server sees only: encrypted bytes (post v2 E2E), per-tenant opaque blob writes/reads (gated by scoped JWT), aggregate connection metadata (IP for abuse-detection; no payload inspection). It **cannot** decrypt, run content analytics, or surface "tutor engagement" dashboards to Buddysaradhi-the-company. No business model depends on reading tutor data.

---

## 20. Threat Model & STRIDE Analysis

### 20.1 Adversary Matrix

| Adversary | Capability | Motivation | Buddysaradhi Mitigation |
|---|---|---|---|
| Curious family member | Brief physical access to unlocked device | Snooping (curiosity, suspicion) | 5-min idle lock; biometric; PIN; sensitive-action re-prompt (§4); panic PIN (§3.6) |
| Phone thief | Stolen locked device; offline brute-force tools | Resale + identity theft + extortion | OS file encryption; biometric + PIN; lockout escalation (§3.5); cache wipe after 10 fails; remote session revoke |
| Cloud-backup interceptor | Reads user's Google Drive / Dropbox / email | Financial PII harvest | AES-256-GCM envelope; Argon2id KDF; manifest sha256; key never persisted (§15) |
| Malicious import file | Crafts `.xlsx` / `.buddysaradhi` to exploit parser | Code execution / data corruption | Zod per-cell validation; sandboxed parser; GCM tag verifies before parse; no formula eval (§11) |
| Rogue sync node (v2) | MITM or compromised Turso replica | Read/modify tutor data | E2E encryption (§19.1); cert pinning; GCM tags per sync frame; reconciliation detects tamper |
| Side-channel app | Another app reads shared storage / keychain | PII harvest | No PII in shared storage; keychain access group restricted to Buddysaradhi bundle ID; iOS Sandbox / Android isolation |
| Insider (tutor's staff, v1.x) | Has the unlocked device for legitimate work | Snooping beyond scope | v1 single-user; v1.x adds RBAC (Centre Priya persona, `15_Future_Roadmap.md`); every sensitive action audited with actor |
| Phished credential attacker | Tricks tutor into entering Supabase creds on fake site | Account takeover | Supabase refresh-token rotation; scoped Turso JWT (no cross-tenant); httpOnly sameSite cookies; Settings → Revoke all sessions |
| Supply-chain attacker | Pushes malicious dep update | Mass compromise | `bun audit` / `npm audit` fail-on-High/Critical; Renovate; dep pinning; SLSA provenance on Tauri/Rust crates |
| Sophisticated state actor | Zero-day against OS / browser | Targeted surveillance | Out of scope for any single-tenant local app; recommend hardware keys, OS updates, and — for high-risk tutors — panic PIN + secure-erase |

### 20.2 STRIDE Analysis

| Threat class | Example | Buddysaradhi control |
|---|---|---|
| **S**poofing | Phished Supabase token used to access another tenant | Scoped JWT `tenant_id` claim; RLS predicate on every query (§7) |
| **T**ampering | Direct DB edit to a ledger row | Append-only triggers + `row_hash` + reconciliation job (§9) |
| **R**epudiation | Tutor denies voiding a receipt | Audit log (append-only, chain-hashed, §8.3) records every void with actor + timestamp |
| **I**nformation disclosure | Backup file leaked from cloud drive | AES-256-GCM envelope; passphrase never persisted (§15) |
| **D**enial of service | Lockout flood on a stolen device | Lockout is local; cloud DB unaffected; thief can't drain attempts from another device |
| **E**levation of privilege | Service-role key leaked into client bundle | CI test `no-service-role-in-client`; lint rule + runtime probe (§2.2) |

---

## 21. Vulnerability Disclosure & Incident Response

### 21.1 security.txt

Published at `https://buddysaradhi.app/.well-known/security.txt`:

```
Contact: mailto:security@buddysaradhi.app
Expires: 2027-12-31T23:59:59Z
Preferred-Languages: en, hi
Policy: https://buddysaradhi.app/security/disclosure
Encryption: https://buddysaradhi.app/.well-known/pgp-key.asc
Acknowledgments: https://buddysaradhi.app/security/thanks
```

### 21.2 Disclosure Policy

- **Acknowledgement:** within 48 h of report.
- **Triage + severity** (CVSS v3.1): within 7 days.
- **Fix or mitigation:** within 90 days (sooner for Critical).
- **Coordinated public disclosure:** at 90 days or upon fix shipping, whichever is first. Reporters credited in `Acknowledgments` unless they prefer anonymity.
- **Safe harbour:** no legal action against good-faith research.

### 21.3 Breach Notification Commitment

If a *cryptography* flaw is discovered in the `.buddysaradhi` envelope (e.g., GCM nonce-reuse, Argon2id parameter weakness, `tenant_secret` leakage):

1. **Within 24 h:** publish a CVE-style advisory at `buddysaradhi.app/security/advisories/<id>`.
2. **Within 72 h:** in-app notification to every active install (via the update-check channel) directing the tutor to the advisory.
3. **Within 7 days:** ship a patched app version with a `reencrypt_all_backups` tool — the tutor picks each old `.buddysaradhi`, enters its passphrase, the tool re-saves it under a patched envelope with fresh salt + nonce. The old file is securely erased (§18.1) only after the re-encrypted file passes a round-trip verification.

For non-crypto breaches (e.g., a stolen Supabase token leading to one tenant's data access), the affected tutor is notified directly within 24 h; public disclosure at 30 days or upon tutor consent, whichever is first.

### 21.4 User-Facing Incident Response

Three flows always available in Settings → Security: **"Revoke sessions"** (logs out all Supabase sessions, rotates Turso token, `audit_log` `token_rotated`) — use on suspected credential leak. **"Verify integrity"** (recomputes all `tamper_hash` + ledger `row_hash` + audit chain; reports mismatches; offers Restore from last backup) — use on suspected tamper. **"Erase this device"** (§18.1) — use on confirmed device loss/theft after a remote revoke.

---

## 22. Compliance Posture

Buddysaradhi is single-tenant, local-first. The tutor is the **data controller**; Buddysaradhi-the-company is the **processor** — minimal, since we don't process plaintext tutor data on our servers.

### 22.1 Compliance Matrix

| Regulation | Scope | Tutor's obligation | Buddysaradhi-the-product's obligation |
|---|---|---|---|
| **COPPA** (US, < 13) | Some students < 13 | Verifiable parental consent before collecting | No direct collection by Buddysaradhi-the-company; data stays in tutor's tenant; no behavioural advertising; no PII telemetry |
| **GDPR** (EU) | Tutor = controller; Buddysaradhi = processor | Lawful basis (legitimate interest); DSARs via the tutor | DPA available; no cross-border data flow (Turso region pinned); right-to-erasure via §18.1 |
| **DPDP Act 2023** (India) | Same as GDPR | Consent + purpose limitation (tutoring) | No data leaves India if the tutor picks the Mumbai Turso region; right-to-nomination + erasure supported |
| **CCPA / CPRA** (CA) | Tutors are businesses; Buddysaradhi = service provider | Honour consumer requests via the tutor | No "sale" of data; no cross-context behavioural advertising; no PII collection by Buddysaradhi-the-company |
| **FERPA** (US, edu records) | Tutor's records may be "school records" | Maintain as educational records with consent | Append-only ledger + audit log support FERPA record-keeping |
| **PCI DSS** | **Out of scope** | n/a — Buddysaradhi never stores card numbers; payment "method" is a label (cash/UPI/bank/cheque) | No card data flow; v2 gateway integration will use hosted-payment-page |

### 22.2 Data Subject Access Requests

A tutor fulfils a parent's DSAR via existing features: **Access** (Student statement PDF with tamper hash); **Rectification** (edit student record, audit-logged); **Erasure** (Archive → Erase after retention expires; hard-erase via §18.1 on device transfer); **Portability** (`.buddysaradhi` or Excel export). Buddysaradhi-the-company never receives these requests — the tutor is the visible face of the data relationship.

---

## 23. CI/CD Security Harness

### 23.1 Web (Vercel)
- SAST: `eslint-plugin-security` + `@next/eslint-config-next` on every PR.
- Dependency scan: `bun audit` / `npm audit` in GitHub Actions; fail on High/Critical.
- Secret scan: GitGuardian on push; pre-commit hook with `gitleaks`.
- Vercel Preview per PR; production deploy requires manual approval.

### 23.2 Mobile (EAS + Vercel Blob)
- EAS Build handles native compilation in isolated runners. Post-build: `.apk`/`.ipa` uploaded to Vercel Blob with signed 14-day-TTL download URLs. Signing keys (Android Keystore + iOS Distribution Cert) stored as GitHub Secrets (masked, wiped post-job).

### 23.3 Desktop (GH Actions + Vercel Blob)
- Matrix: Ubuntu/macOS/Windows runners. Certs injected into runner memory via `azure/login`-style secret store; wiped in `post` step. Output: signed `.deb/.rpm/.dmg/.exe/.msi` + `latest.json` manifest on Vercel Blob for the Tauri updater.

### 23.4 Reproducible Builds
- Web build pinned to a `bun.lockb` checksum; Vercel verifies before deploy. Desktop build hashes published alongside `latest.json`; the Tauri updater checks both the minisign signature *and* the SHA-256 hash before applying.

---

## 24. Security Testing Checklist

These tests run on every PR and on a nightly release-candidate build. Failure blocks merge.

### 24.1 Unit & Integration Tests

| Test ID | What it verifies |
|---|---|
| `pin-hash-argon2id.test.ts` *(unit)* | PIN hash uses argon2id + pepper + 16B salt; constant-time compare |
| `pin-lockout-escalation.test.ts` *(int)* | 3/4/5/6-fail lockouts match §3.5; 10-fail triggers cache wipe |
| `biometric-releases-envelope-key.test.ts` *(int)* | Biometric path never touches the PIN; key released only on biometric success |
| `panic-pin-wipes-real-db.test.ts` *(int)* | Panic PIN opens blank DB; real cache overwritten; no `audit_log` row |
| `backup-roundtrip.test.ts` *(int)* | Encrypt→decrypt restores original; 1-byte tamper fails `E_WRONG_PASSPHRASE`; salt/nonce unique across 1000 runs |
| `backup-key-zeroing.test.ts` *(unit)* | `SecureBuffer.clear()` on lock/background/exit; memory scan finds no key bytes |
| `ledger-no-delete.test.ts` *(unit+int)* | No `db.ledgerEntry.delete()` / `db.ledgerEntry.deleteMany()` call in the repo (except the audited `lib/security/secureErase.ts`, which uses `db.ledgerEntry.deleteMany({})` inside `$transaction` with an audited eslint-disable allowlist entry); no `$executeRaw` / `$queryRaw` against `ledger_entries` anywhere; Prisma middleware (`packages/core/src/ledgerGuard.ts`) raises `E_LEDGER_IMMUTABLE` on any attempt |
| `ledger-reconciliation.test.ts` *(int)* | Edited row triggers `E_LEDGER_INTEGRITY_VIOLATION`; sets `ledger_write_locked`; banner |
| `audit-chain-verification.test.ts` *(int)* | Out-of-band audit row breaks chain; job logs `audit_chain_broken` |
| `export-controls-matrix.test.ts` *(int)* | Every §4.1 entry requires specified auth; Excel exempt; full backup needs typed `EXPORT` |
| `no-plaintext-ledger-export.test.ts` *(int)* | No export path emits raw ledger rows without GCM encryption |
| `no-service-role-in-client.test.ts` *(unit)* | `service_role` never in a client-bound bundle |
| `no-unexpected-network.test.ts` *(int)* | Telemetry off → only Turso + Supabase + update-check URLs contacted |
| `secure-erase.test.ts` *(int)* | Erase: keychain keys deleted; `tenant_secret` rotated; DB overwritten; Supabase session revoked |
| `tamper-hash-recompute.test.ts` *(int)* | Edited invoice → mismatch → red badge + `audit_log` `receipt_tamper_detected` |
| `tenant-predicate-required.test.ts` *(lint)* | Every SQL on a tenant-scoped table has `WHERE tenant_id = ?` |
| `no-http-urls.test.ts` *(lint)* | No `http://` URLs in code (except dev allowlist) |

### 24.2 Manual Pen-Test Cadence

- **Quarterly:** internal review of the threat model (§20) for new adversaries/vectors.
- **Annually:** third-party pen-test across web, mobile, desktop. Findings prioritised by CVSS; Criticals in 7 days, Highs in 30, Mediums in 90.
- **Pre-release:** focused crypto review of the `.buddysaradhi` envelope + PIN derivation paths on every major version.

### 24.3 Bug Bounty

An invite-only bug bounty launches at v1.0 GA. Scope: Buddysaradhi web, mobile, desktop apps, and the `.buddysaradhi` envelope format. Out of scope: third-party services (Supabase, Turso, Vercel).

---

## 25. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Security doc. The mockups here are **layer diagrams, challenge flows, session lifecycles, and contract diagrams**, with UI surfaces (PIN pad, lock screen, toast) annotated inline. Glass tiers (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) and neumorphic recipes (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) annotated. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only.

### 25.1 Design System Reference — Security

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces on the security layer | Tier | Cross-ref |
|---|---|---|
| Lock screen (locked state) | `glass-strong` + backdrop blur of content pane | §5.5, §8.7 |
| Unlock sheet (PIN/biometric prompt) | `glass-strong` + backdrop | §5.5, §8.7 |
| Panic-confirmation sheet | `glass-strong` + backdrop; flare accent border (§5.4) | §5.4, §8.7 |
| Toast (unlock success / lockout warning / tamper detected) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| Secure-erase confirmation modal | `glass-strong` + backdrop; triple-gate (PIN + typed `ERASE` + passphrase) | §5.5, §8.7 |
| Tamper-detected banner (invoice edited) | `glass` + flare accent left-border | §5.4, §8.3 |
| Lockout countdown overlay | `glass-faint` recede | §5.5 |

| Neumorphic controls on the security layer | Recipe | Cross-ref |
|---|---|---|
| PIN pad digit buttons (0–9, ⌫, ⌐OK) | `neumo-raised`; press = `neumo-pressed` + emerald dot fill | §6.6, §8.2 |
| Biometric prompt primary button ("Use FaceID") | `neumo-raised` (emerald glow) | §6.6, §8.2 |
| "Use PIN instead" secondary button | `neumo-raised` secondary | §6.6, §8.2 |
| Panic-PIN setup input | `neumo-inset` well + strength meter | §6.6, §8.9 |
| Typed-confirmation input (`ERASE` / `VOID` / `EXPORT`) | `neumo-inset` well (case-sensitive, AP-13) | §6.6, §8.9 |
| Lock-Now button (Sync drawer) | `neumo-raised` secondary | §6.6, §8.2 |

> **References:** OWASP — *Authentication Cheat Sheet*, *Cryptographic Storage Cheat Sheet*, *Mobile Security Testing Guide*; RFC 8439 — *AES-GCM* (at-rest SQLCipher + `.buddysaradhi` envelope); RFC 9100 — *Argon2id* (PIN + passphrase derivation); NIST SP 800-63B — *Digital Identity Guidelines* (biometric + PIN fallback pattern); Apple HIG — *Face ID and Touch ID*; Material Design 3 — *Authentication patterns*; WCAG 2.1 AA §3.3.3 (error suggestion — the PIN pad's shake animation + "Try again" satisfies this).

### 25.2 Mockup S1 — Security Layer Diagram (device → app → DB → cloud)

```
SECURITY LAYER STACK (§1–§8) — defence in depth, four concentric layers

   ┌─ LAYER 1 · DEVICE (the physical boundary) ─────────────────────────────────┐
   │  · OS keychain (Keychain on macOS/iOS, Keystore on Android, Credential      │
   │    Manager on Windows) — holds the envelope-key handle                      │
   │  · biometric hardware (FaceID/TouchID/fingerprint) — releases the envelope  │
   │    key only on successful prompt (§3.7)                                      │
   │  · secure enclave / Titan M / T2 — stores biometric template; never the PIN │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │ OS-level release of envelope key
                                        ▼
   ┌─ LAYER 2 · APP (the runtime boundary) ─────────────────────────────────────┐
   │  · GlassShell — content pane blurred when app_lock_state='locked' (§3.1)    │
   │  · Lock screen (.glass-strong + backdrop) + PIN pad (.neumo-raised digits)  │
   │  · E7 Security Engine wraps every §4.1 sensitive mutation in a fresh       │
   │    PIN/biometric gate (≤30s old; BR-SEC-02)                                  │
   │  · audit_log INSERT is fail-closed — if audit write fails, the mutation     │
   │    is rolled back (BR-SEC-06, AP-13)                                         │
   │  · session_timeout_min default 5 min (BR-SEC-04) — auto-lock on idle        │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │ envelope key wraps the derived session key
                                        ▼
   ┌─ LAYER 3 · DATABASE (the at-rest boundary) ────────────────────────────────┐
   │  · local SQLite encrypted via SQLCipher (AES-256-GCM, page-level)            │
   │  · tenant_secret pepper (32-byte hex in settings, never exported)            │
   │  · tamper_hash chain on ledger_entries + receipts (§9, §10)                  │
   │  · triggers: ledger_immutable_guard (BR-LED-01), audit_chain_guard            │
   │  · panic PIN → crypto-shreds the local cache (overwrites with empty schema)  │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │ sync_outbox push (BR-SYN-02)
                                        │ TLS 1.3 + mTLS for libSQL replication
                                        ▼
   ┌─ LAYER 4 · CLOUD (the replication boundary) ───────────────────────────────┐
   │  · Turso Cloud — per-user DB namespace, NOT shared                          │
   │  · Supabase Auth — JWT scopes to per-user Turso DB only                     │
   │  · Row-level security policy: `WHERE tenant_id = ?` enforced at Turso       │
   │    (defence-in-depth — even if the app's predicate is bypassed, Turso       │
   │    refuses the row; §7)                                                     │
   │  · no vendor-side analytics; no Sentry; no remote feature flags (§17)       │
   └──────────────────────────────────────────────────────────────────────────────┘

   ↑ LAYER 1 is the user's device — we never own it. If the device is lost, the
     envelope key is gone with it (the OS keychain does not sync to us).
   ↑ LAYER 2's lock screen is .glass-strong — the content pane behind it is
     blurred (backdrop-blur), not hidden, so the tutor sees "my data is still
     there" without being able to read it (P15 — honest empty state analogue).
   ↑ LAYER 3's tamper_hash is recomputed on every read; a mismatch surfaces a
     flare banner "Ledger tamper detected" + audit_log receipt_tamper_detected.
   ↑ LAYER 4 has NO analytics endpoint. The only outbound calls are Turso
     replication, Supabase OIDC, and (opt-in) the v1.x messaging gateway — all
     documented in §17 TELE-1.
```

- ↑ **Defence in depth = four independent failures required to breach.** A thief who steals the device still needs the biometric/PIN (Layer 2); even with the PIN, they need the `tenant_secret` pepper (Layer 3); even with the pepper, Turso's RLS policy rejects cross-tenant queries (Layer 4).
- ↑ **The audit_log is fail-closed.** A mutation that cannot write its audit row is rolled back — no silent ledger breaks (BR-SEC-06, AP-13).
- ↑ **No telemetry at any layer.** The `no-unexpected-network.test.ts` integration test (§24.1) fails the build if any new outbound URL is added without an allowlist entry.

### 25.3 Mockup S2 — PIN / Biometric Challenge Flow

```
PIN / BIOMETRIC CHALLENGE FLOW (§3) — unlock + sensitive-mutation paths

   ┌─ TRIGGER ──────────────────────────────────────────────────────────────────┐
   │   (a) cold start         (b) idle timeout (5 min default — BR-SEC-04)      │
   │   (c) manual Lock Now    (d) backgrounded mobile/desktop (AppState inactive)│
   │   (e) web tab hidden > 60s                                                 │
   │   (f) §4.1 sensitive mutation while unlocked (needs fresh ≤30s PIN)         │
   └─────────────────────────────────────────┬──────────────────────────────────┘
                                             ▼
   ┌─ STATE: locked ────────────────────────────────────────────────────────────┐
   │  · content pane blurred (backdrop-blur on the cosmic canvas)                │
   │  · sidebar disabled (.glass-strong, but inactive — no .neumo-raised accent) │
   │  · only the unlock sheet is interactive                                     │
   └─────────────────────────────────────────┬──────────────────────────────────┘
                                             ▼
   ┌─ Unlock Sheet (.glass-strong + backdrop, §8.7) ────────────────────────────┐
   │  ┌─ Biometric prompt (preferred, if settings.biometric_enabled) ─────────┐ │
   │  │   [ ● Use FaceID ]   ← .neumo-raised primary (emerald glow)            │ │
   │  │   [ Use PIN instead ] ← .neumo-raised secondary                       │ │
   │  └────────────────────────────────────────┬───────────────────────────────┘ │
   │                                           ▼                                │
   │  ┌─ Biometric success? ─────────────────────────────────────────────────┐  │
   │  │   yes → OS releases envelope key → proceed (audit_log actor='biometric')│
   │  │   no  → fall through to PIN pad (3 fails → PIN pad auto-locks biometric)│
   │  └────────────────────────────────────────┬───────────────────────────────┘ │
   │                                           ▼                                │
   │  ┌─ PIN Pad (.neumo-raised digits, §8.2) ───────────────────────────────┐  │
   │  │     [ 1 ] [ 2 ] [ 3 ]      ← each digit = .neumo-raised                │  │
   │  │     [ 4 ] [ 5 ] [ 6 ]        press = .neumo-pressed                    │  │
   │  │     [ 7 ] [ 8 ] [ 9 ]        emerald dot fills per digit entered       │  │
   │  │     [ ⌫ ] [ 0 ] [ ✓ ]        (P7 — motion is meaning)                  │  │
   │  │                                                                        │  │
   │  │     ● ● ● ○ ○ ○   ← 6 dots; emerald = entered, hollow = pending        │  │
   │  └────────────────────────────────────────┬───────────────────────────────┘  │
   └─────────────────────────────────────────┬──────────────────────────────────┘
                                             ▼
   ┌─ VERIFY (E7 Security Engine, §12.1) ───────────────────────────────────────┐
   │   stored = decode(settings.pin_hash)                                        │
   │   salt, pin_hash = split(stored, 16)                                        │
   │   candidate = argon2id(entered_pin || tenant_secret, salt,                  │
   │                        {m:64MiB, t:3, p:2})                                 │
   │   match = constantTimeEquals(candidate, pin_hash)                            │
   └─────────────────────────────────────────┬──────────────────────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
   ┌─ MATCH ────────────────────────────┐   ┌─ NO MATCH ─────────────────────────┐
   │  · state → unlocked                │   │  · fail_count++                    │
   │  · audit_log(actor='tutor'|'biom') │   │  · shake animation on PIN pad      │
   │  · fail_count = 0                  │   │    (.neumo-pressed + flare glow)   │
   │  · content pane un-blurs           │   │  · toast "Wrong PIN. N left"       │
   │  · Sidebar reactivates             │   │    (.glass-strong + flare left-bar)│
   │  · (if sensitive-mutation gate)    │   │  · check §3.5 lockout policy:       │
   │    mutation proceeds               │   │    1–2: none                        │
   └────────────────────────────────────┘   │    3:   60s lockout + countdown    │
                                            │    4:   120s                        │
                                            │    5:   240s                        │
                                            │    6+:  60s × 2^(n−3), cap 24h      │
                                            │    10 cumulative (non-reset):       │
                                            │      → local cache wipe             │
                                            │      → audit_log pin_lockout_wipe   │
                                            │      → forces Supabase re-login     │
                                            │      → cloud DB intact (P5)         │
                                            └─────────────────────────────────────┘

   ↑ The pepper (tenant_secret) means a stolen DB file cannot be brute-forced
     offline — the attacker needs both the DB AND the tenant_secret, which is
     itself encrypted at rest in the OS keychain.
   ↑ Argon2id cost ~400 ms/guess × 10⁶ PIN space ≈ 110 hours minimum for an
     exhaustive search on a single device — well beyond the lockout policy's
     10-fail wipe threshold (the attacker gets 10 guesses, then the cache is gone).
   ↑ The PIN is held in memory ≤ 200 ms during verification, then zeroed
     (SecureBuffer.clear()). The envelope key is released by the OS, never
     reconstructed from the PIN.
```

- ↑ **P11 honoured.** The PIN pad's tactile friction (`.neumo-raised` → `.neumo-pressed` + emerald dot fill) is the protection; the friction is bounded by the §4.1 allowlist — non-sensitive mutations bypass the gate entirely.
- ↑ **AP-12 honoured.** Backdated entries / locked-period mutations require the PIN gate + a typed reason — the audit_log records both the actor and the reason.
- ↑ **The 10-fail wipe is local-only.** The cloud DB is intact; the tutor re-logs in via Supabase and re-syncs. The wipe is a defensive measure, not a data-loss event (P5 — cloud is a replica).

### 25.4 Mockup S3 — Session Lifecycle (locked / unlocked / panic)

```
SESSION LIFECYCLE STATE MACHINE (§3.1, §3.2, §3.6) — three states, four transitions

                          ┌──────────────────────────────┐
                          │         COLD START            │
                          │  (app launched, no session)   │
                          └──────────────┬───────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                ┌────────►│           LOCKED              │◄────────┐
                │         │  · content pane blurred       │         │
                │         │  · sidebar disabled            │         │
                │         │  · only unlock sheet active   │         │
                │         │  · .glass-strong + backdrop   │         │
                │         └──────────────┬───────────────┘         │
                │                        │                         │
                │         ┌──────────────┴───────────────┐         │
                │         │ unlock (biometric OR PIN)     │         │
                │         │ §3.3 priority order           │         │
                │         │ · argon2id verify              │         │
                │         │ · fail_count = 0 on success    │         │
                │         ▼                              │         │
                │         ┌──────────────────────────────┐│         │
                │         │           UNLOCKED            ││         │
                │         │  · all 5 screens usable       ││         │
                │         │  · §4.1 sensitive mutations   ││         │
                │         │    need fresh ≤30s PIN         ││         │
                │         │  · non-sensitive mutations     ││         │
                │         │    bypass the gate             ││         │
                │         └──────────────┬───────────────┘│         │
                │                        │                │         │
                │   ┌────────────────────┼───────────────┐│         │
                │   │                    │               ││         │
                │   │ (a) idle timeout   │ (b) Lock Now  ││         │
                │   │     (5 min)        │   in Sync drw ││         │
                │   │ (c) AppState inactive              ││         │
                │   │     (mobile/desktop bg)            ││         │
                │   │ (d) web tab hidden > 60s            ││         │
                │   │                    │               ││         │
                └───┴────────────────────┴───────────────┘│         │
                                                             │         │
                                                             │         │
                          ┌──────────────────────────────────┘         │
                          ▼                                            │
                ┌──────────────────────────────────────────┐            │
                │            PANIC (optional)               │            │
                │  · entered via the panic PIN (settings.   │            │
                │    panic_pin_hash — §3.6)                 │            │
                │  · real local cache crypto-shredded       │            │
                │    (key zeroed; empty schema written)     │            │
                │  · visually identical to UNLOCKED         │            │
                │    on a blank DB                          │            │
                │  · NO audit_log row (PANIC-1 invariant)   │            │
                │    — only panic_log (separate envelope)   │            │
                │  · recovery: Settings → Restore backup    │            │
                │  · no "switch back" affordance            │            │
                └────────────────────────────────────────────┘            │

   ↑ The transition table (states × events) is the contract:
       LOCKED    + unlock      → UNLOCKED
       LOCKED    + panic PIN   → PANIC
       UNLOCKED  + lock event  → LOCKED
       UNLOCKED  + panic PIN   → PANIC  (panic works from unlocked too)
       PANIC     + lock event  → LOCKED (on the blank DB)
       PANIC     + restore     → UNLOCKED (via the Settings → Restore flow;
                                       re-decrypts the .buddysaradhi backup)
   ↑ The state is held in `app_state.app_lock_state` (one of: locked, unlocked,
     panic). The Zustand store mirrors it for the UI; the SQLite table is the
     durable source of truth (survives app restart).
   ↑ The panic state is OPT-IN (settings.panic_pin_hash defaults to NULL).
     If not configured, the panic transition is impossible; the diagram's PANIC
     node is absent for tutors who skip the setup.
```

- ↑ **PANIC-1 invariant.** The panic unlock MUST NOT log to `audit_log` — the audit log would betray the real DB's existence. The panic event goes to a separate `panic_log` table outside the encrypted envelope (crypto-shredded on each panic unlock).
- ↑ **Idle timeout is server-independent.** The 5-min default (BR-SEC-04) is enforced by a local timer — no network call to validate the session (P5 — offline-first).
- ↑ **The lock event fires on AppState='inactive'.** Mobile/desktop background triggers an immediate lock; web tab hidden > 60s triggers a lock. The tutor never returns to an unlocked app from background (P11 — tactile security, not theatrical).

### 25.5 Mockup S4 — No-Telemetry Contract Diagram

```
NO-TELEMETRY CONTRACT (§17 TELE-1) — the only outbound calls Buddysaradhi makes

   ┌─ TUTOR'S DEVICE (the only source of state) ────────────────────────────────┐
   │                                                                            │
   │   App code (Next.js / Expo / Tauri)                                        │
   │   · no analytics SDK (no Sentry, no Mixpanel, no PostHog cloud)            │
   │   · no crash reporter that includes user data (crash logs stay local)      │
   │   · no remote feature flags exfiltrating user state                        │
   │   · no "anonymous usage statistics"                                        │
   │   · no vendor-side "AI" trained on tutor data                              │
   │                                                                            │
   │   ✕ telemetry endpoints — enforced by:                                     │
   │      · lint rule: no-telemetry-urls                                        │
   │      · integration test: no-unexpected-network.test.ts (§24.1)             │
   │      · CSP header on web: connect-src restricts to allowlist               │
   │      · Tauri capabilities file: only libSQL + Supabase URLs allowed        │
   │      · Expo Info.plist NSAppTransportSecurity: same allowlist              │
   └──────────────────────────────────┬─────────────────────────────────────────┘
                                      │
                                      │ ALLOWLIST (the only 3 outbound paths):
                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  PATH 1 · Supabase Auth (OIDC)                                                │
   │  · sign-in (email magic-link OR Google OAuth)                                 │
   │  · JWT issuance — scopes to per-user Turso DB only                            │
   │  · webhook fires provision-db Edge Function on first sign-in                  │
   │  · the JWT carries NO user data beyond {user_id, email, db_url, db_token}     │
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  PATH 2 · Turso Cloud (libSQL replication)                                    │
   │  · push sync_outbox rows (BR-SYN-02)                                          │
   │  · pull remote mutations on app launch + every 5 min foreground               │
   │  · TLS 1.3 + mTLS; the JWT scopes the connection to one DB namespace          │
   │  · the payload IS the user's data — but it goes to THEIR DB, not a shared one│
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  PATH 3 · Backup destination (the tutor's explicit choice — P10)              │
   │  · OS share/save sheet → email · Drive · pendrive · iCloud Drive             │
   │  · the file is the encrypted .buddysaradhi envelope (AES-256-GCM + argon2id)      │
   │  · we never see the plaintext; we never see the destination                  │
   │  · the .buddysaradhi file is the tutor's property (AP-7 — no data hostage)        │
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  PATH 4 (v1.x OPT-IN) · Messaging gateway                                     │
   │  · WhatsApp Cloud API / SMS / email — for reminder delivery                  │
   │  · OFF by default; the tutor explicitly enables per-channel                  │
   │  · only reminder text is sent (no PII beyond what's needed for the message)  │
   │  · the gateway NEVER sees the ledger, the receipts, or the audit_log         │
   └──────────────────────────────────────────────────────────────────────────────┘
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  PATH 5 (DESKTOP ONLY) · Tauri update-check                                   │
   │  · signed-manifest fetch from Vercel Blob (deployment/02)                    │
   │  · the response is the updater manifest (version, signature, URLs); no user  │
   │    data is sent in either direction                                          │
   │  · the check is opt-out (the tutor can disable it in Settings → Updates)     │
   └──────────────────────────────────────────────────────────────────────────────┘

   ✕ PATH N (FORBIDDEN) · Any other outbound URL
     · lint rule `no-telemetry-urls` blocks new URLs at compile time
     · the allowlist is the contract; an addition requires a §Decision Protocol
       run (Q1: which principle does this serve? — usually none; reject).
     · AP-10 is the enforcement: telemetry that leaves the device is forbidden.

   ↑ The tutor's workflow is not our dataset. We do not need to understand how
     they use the product; we need only to ship the features they ask for.
   ↑ Crash logs stay local — the tutor can opt to email them to us; we never
     pull them silently. AP-10 + §24.1 no-unexpected-network.test.ts enforce this.
   ↑ The CSP header on web (connect-src) is a runtime check; the lint rule is a
     compile-time check; both must pass for a build to ship.
```

- ↑ **The allowlist is the contract.** Five outbound paths; everything else is forbidden. Adding a sixth requires a §Decision Protocol run (Q1: which principle does it serve? Q5: is the boring-tech cost acceptable? — usually both fail).
- ↑ **AP-10 is the load-bearing anti-principle.** It maps to P5 (offline-first — telemetry would create a network dependency) and `00_Vision.md` §11.3 (no telemetry, ever).
- ↑ **The desktop update-check is opt-out, not opt-in.** This is the one exception — security updates matter even when the tutor does not want to be bothered. The check sends NO user data; the response is a signed manifest only.

---

Security in Buddysaradhi is not a section of the docs — it is the floor the rest of the product stands on. Every screen spec that follows assumes the protections above are in place, and every test in `§24` is a load-bearing wall.
