# DESKTOP RUST AUDIT — `apps/desktop/src-tauri/`

**Recorded:** 2026-10-14 · **Source:** read-only audit stream · **Disposition: READ-ONLY, nothing modified**
**Platform state:** `apps/desktop` is **LOCKED** behind `WEB-PROD-GATE` (`AGENTS.md` §9.3).
This file records findings only. **No fix is executed here**, and none should be
until the platform gate is signed.

> **Headline.** This is not a list of rough edges. **Two of the three
> highest-stakes money operations in this backend cannot execute at all**, there
> are **zero tests in 2,045 lines**, and **no CI gate runs any Rust check**.
> Every P0 below would have been caught by the four `desktop/AGENTS.md` §7.2
> mandatory test rows that do not exist.

---

## 1. Toolchain — actual output

`cargo 1.98.0`, `rustc 1.98.0`, Windows.

| Check | Result | Evidence |
|---|---|---|
| `cargo fmt --all -- --check` | **FAIL, exit 1** | 124 hunks; all 19 hand-written files non-conformant (2-space indent vs rustfmt's 4) |
| `cargo clippy --workspace --all-targets -- -D warnings` | **FAIL, exit 101, 8 errors** | see below |
| `cargo test --workspace` | **exit 0 — but 0 tests ran** | `running 0 tests` × lib, bin, doc-tests |
| `cargo audit` | **NOT RUN** | `no such command: audit` — not installed |

**A build blocker, proven not assumed.** The first clippy run died in the *build*:
`libsqlite3-sys v0.28.0` panicked — `Missing environment variable OPENSSL_DIR`.
`rusqlite = { features = ["bundled-sqlcipher"] }` hard-requires OpenSSL headers, and
`.github/workflows/desktop-build.yml` **never installs OpenSSL or sets
`OPENSSL_DIR`** on any of its three runners. Clippy output below was obtained by
supplying `OPENSSL_DIR` manually.

**Clippy's 8 errors:** inconsistent digit grouping ×2 (`students.rs:14`, `ledger.rs:12`),
auto-deref ×4 (`state.rs:99,105`, `envelope.rs:113,174`), **identical `if` blocks**
(`ledger.rs:280`), loop-indexed (`envelope.rs:311`).

The `if_same_then_else` at `ledger.rs:280` is **not cosmetic** — it is flagging the
fee-status ladder whose first two arms both yield `"paid"` (see P0-5).

---

## 2. P0 — non-functional or exploitable

| # | Finding | Evidence |
|---|---|---|
| **P0-1** | **`void_ledger_entry` can never succeed.** `migrations/V0001__init.sql:349` constrains `op TEXT NOT NULL CHECK(op IN ('insert','update','soft_delete'))`; `src/commands/ledger.rs:231` inserts `op='void'`. CHECK violation → `?` returns → transaction drops → **entire void rolls back**. The tutor sees a raw DB error and the money is still recorded as received. | `V0001:349`, `ledger.rs:231` |
| **P0-2** | **`restore_backup` can never succeed.** `V0002__ledger_triggers.sql:9,12` creates `trg_audit_no_update`/`trg_audit_no_delete`. `envelope.rs:251-252` drops **only** the two LEDGER triggers, then `:255-266` deletes `audit_log` → `RAISE(ABORT)` → rollback. **Restore is 100% non-functional.** The author's comment reasons through the ledger triggers and simply not notices the audit pair sits in the same migration file. | `V0002:9,12`, `envelope.rs:251-266` |
| **P0-3** | **SQL injection in backup restore.** `envelope.rs:278-283` takes `table` straight from the JSONL with **no allowlist** (contrast `:269/303`, where names come from a hardcoded literal array); `:341` wraps column keys in backticks **unescaped**; `:366-371` interpolates both. Reachable by anyone who can produce a passphrase-encrypted archive — and the envelope format, Argon2 params and JSONL layout are all documented in this repo. The window is open with the ledger triggers dropped. | `envelope.rs:278,341,366` |
| **P0-4** | **The ledger hash chain does not cover the money columns, and nothing verifies it.** `ledger.rs:90,206` hash `prev_hash\|id\|student_id\|new_balance` — excluding `type`, `debit_paise`, `credit_paise`, `occurred_on`, `receipt_no`, `void_of_id`. The **commented-out** `trg_ledger_hash` in the same migration shows the *intended* formula, which does include them. No `verify_ledger`/`verify_chain`/`reconcile` exists anywhere. Change `credit_paise` 500000→5000 and the chain still verifies — and nothing checks it. **Zero tamper detection on the financial spine.** | `ledger.rs:90,206`, `V0002:17-27` |
| **P0-5** | **Voids are invisible to every money total.** `ledger.rs:270-271`, `dashboard.rs:35-36`, `dashboard.rs:43-44` all **filter voids out** instead of summing them so the reversal nets out. Void a ₹5,000 payment → "collected" unchanged, amount still reads due. Separately, `ledger.rs:280-284` maps `amount_due == 0` → `"paid"`, and no `FEE_CHARGED` row is ever created — so **every student always reports `"paid"`**. | as cited |
| **P0-6** | **Fifteen wrong PINs from the webview destroys the local database.** `security/lockout.rs:29-33` → `shred_local_data` (`:53-87`) deletes the DB, WAL, SHM and all keyring entries. Reachable from `restore_backup`, `create_backup`, `record_payment`, `void_ledger_entry`, `archive_student`, `lock_attendance_session` — with **no owner proof**, only a 30 s / 5 min timer. `security/mod.rs:54-57` returns `Ok(())` when **no PIN is set**, which is the default state. | as cited |
| **P0-7** | **`biometric_unlock` performs no biometric verification.** `commands/auth.rs:47-63` reads `biometric_enabled` and, if true, unlocks and returns `true`. No OS prompt, no keychain round-trip. **`Cargo.toml` has no `tauri-plugin-local-authentication` at all.** Any webview script calls `invoke('biometric_unlock')` and the app unlocks — no PIN, no prompt. Paired with P0-6, a complete PIN-free takeover of a local financial database. | `auth.rs:47-63` |

---

## 3. P1 — serious, spec-violating, or data-affecting

- **P1-1 · PIN hashing is unpeppered and 3.4× weaker than spec.** `security/pin.rs:12,22` uses `Argon2::default()` = m=19456 KiB (19 MiB), t=2, p=1, **no pepper**. `10_Security.md:73` requires `argon2id(pin ‖ pepper, m=64MiB, t=3, p=2)` and `:83` names the pepper `tenant_secret` precisely so a stolen unlocked laptop "cannot be brute-forced offline without `tenant_secret`". `tenant_secret` **is** generated and stored (`state.rs:49,137,150,161,165,167,178`) and **never referenced again** — not a pepper, not chain salt, not AAD. Every defence the spec built is absent.
- **P1-2 · The ≤30 s fresh-PIN gate does not exist.** `security/mod.rs:33-57` verifies the hash and nothing else; `_action` is unused. `10_Security.md:123-128` requires "PIN ≤ 30 s" **plus typed `EXPORT`/`RESTORE`/`ERASE`** for void, unlock, backdate, export and restore. None of the typed words exist. A PIN typed once at login authorises a restore weeks later.
- **P1-3 · 16 of 22 commands have no lock check**, and four of them are mutations — `create_student` (which takes `_pin` and **ignores it**), `update_student`, `mark_attendance`, `update_settings`. Ten unguarded reads leak the full roster, every balance, and the entire audit log while locked.
- **P1-4 · `update_settings` is a silent account-takeover primitive.** `settings.rs:74-76` writes `pin_hash` with no `require_unlocked`, no `require_fresh_pin`; `input.pin` (`:22`) has **no `#[validate]`** (only `institute_name` does) so a 1-character PIN is accepted; **no `audit_log` row** for a PIN change (required by `10_Security.md:197`) and **no `sync_outbox` row** (Rule 7). `session_timeout_min = 0` causes permanent self-lockout. Replace the PIN on an unattended install and the tutor cannot tell.
- **P1-5 · Chain tip has no tie-break.** `ledger.rs:74,83,189,198` all `ORDER BY created_at DESC LIMIT 1` with **no secondary key**; the trigger at `V0002:33` uses the identical expression. Two payments in one clock tick → the Rust read and the trigger read can pick different rows, yielding either a confusing abort or a **committed wrong `balance_after_paise` and wrong `prev_hash`**. `AGENTS.md` §3.6 records this exact bug being found and fixed on web; the desktop port carried it forward.
- **P1-6 · The sync outbox claims success without a transport — and is broken on top of that.** `sync/outbox.rs:76-87` marks every pending row `'sent'` with **no network call**; `_client` is a mocked `String`, `_turso_token` is discarded. Line 84 writes `sent_at` but the column is `flushed_at` (`V0001:355`), so it errors and recurs every 30 s. **Either way it is broken:** fix the column and every tutor mutation is silently discarded while the outbox claims delivery; leave it and `sync_outbox` grows unbounded behind a `log::warn!` that is invisible in production (`tauri_plugin_log` is registered only under `cfg!(debug_assertions)`). No `attempts` increment, no `last_error`, no dead-letter path, no idempotency key — `client_seq` does not exist in the schema at all.
- **P1-7 · `csp: null`** — no Content Security Policy on the webview (`tauri.conf.json:32`), against `desktop/03_IPC_Security.md:113`. With `script-src` unrestricted, a webview XSS can `fetch()` any origin — the exact exfiltration path `10_Security.md` §12 exists to prevent.
- **P1-8 · `create_backup` writes to an arbitrary IPC-supplied path** (`backup.rs:51-52`) with no directory, extension or confirmation check.
- **P1-9 · Restore has no tenant binding** — `backup.rs:100` discards the manifest; nothing ever compares its `tenant_id` to the local one. A backup from a different tutor restores verbatim.
- **P1-10 · The lockout wipe is unlogged and destroys the audit trail**, and uses `let _ =` on all six deletes so a **partial** wipe still reports success. **Thresholds contradict the spec three ways:** code 5/10/15 → 30 s/5 min/wipe; `10_Security.md` §3.5 says 3→60 s then exponential capped at 24 h, wipe at 10 cumulative; `desktop/AGENTS.md` §7.2 says 5/10/15. The code matches **neither**.
- **P1-11 · CI runs no Rust gate and cannot build.** `desktop-build.yml` runs install → web build → `tauri build` → sign → upload. No `fmt`, no `clippy`, no `test`, no `audit`, and no OpenSSL provisioning. `desktop/AGENTS.md` §7.4 requires all four as merge gates.
- **P1-12 · Zero tests in 2,045 lines** — no `#[test]`, no `#[cfg(test)]`, no `tests/`. `desktop/AGENTS.md` §7.2 lists **9 mandatory test concerns**; `10_Security.md:583-586` names four specific files. None exist on either platform.
- **P1-13 · The Fee Matrix can only ever return an empty list.** `get_fee_matrix` INNER JOINs `student_enrollments`, but the **only** `INSERT INTO` targeting a domain table anywhere in `src/` is `students`. Nothing writes `batches`, `student_enrollments`, `fee_plans`, `fee_schedule_items` or `invoices`. So: Fee Matrix → `[]` forever; `mark_attendance`'s FK to `batches` fails forever; `CreateStudentInput.default_fee_paise` is validated then **silently discarded** — a tutor enters a student's fee and it vanishes with no error; `RecordPaymentInput.invoice_id` is accepted then never written, so per-invoice attribution (`AGENTS.md` §3.5) is unimplemented.

---

## 4. Systemic

- **100% of the 2,045 lines are orphan code** by `AGENTS.md` §0.2 and `desktop/AGENTS.md` §4.1. grep for `///`, `//!`, `// Implements:` across `src/`: **zero matches**.
- **The three Rust gates that exist are exactly the three that would have caught the P0s** — and all three are red or vacuous (`fmt` red, `clippy` red, `test` green-but-empty) — and **none run in CI**.
- **Spec contradiction to raise first** (`22_Redundancy_Audit.md`): `10_Security.md` §3.5 vs `desktop/AGENTS.md` §7.2 lockout thresholds, and `02_Rust_Core.md` §2/§4 "the **7** Tauri commands" vs **22** registered (`lib.rs:41-79`). **P1-10 cannot be fixed correctly until this is resolved.**
- P2/P3 (17 further items) are recorded in the audit transcript and include: unescaped PRAGMA key interpolation; non-`Zeroizing` key material; 18 `.unwrap()` on `std::sync` locks that cascade-poison; `(balance as f64)/100.0` money formatting (Rule 6); hardcoded `"t-1"` tenant literal in 15 places; an **invalid PDF generator** (wrong `/Length`, static xref, no escaping of `()\`); inconsistent `updated_at` formats that break LWW; dead `libsql 0.3.5` pulling `tonic`/`axum`/`reqwest`; updater permissions granted with **no `plugins.updater` block** (so no signature verification is possible); and three inconsistent frontend build sources.

---

## 5. What is genuinely correct — do not "fix" these

Recorded because unfamiliar code is not defective code.

1. **Zero `unsafe`**, no `static mut`, no `lazy_static`, no global mutable state.
2. **No string-concatenated SQL in any command handler** — all 22 use `?N` bound parameters.
3. **No tar-slip** — tar entries are read into memory and name-matched; nothing is written to disk.
4. **The backup envelope matches Rule 8 exactly** — `salt(16) ‖ nonce(12) ‖ tag(16) ‖ ciphertext`, AES-256-GCM, 12-byte CSPRNG nonce, `Params::new(65536, 3, 2, Some(32))` = Argon2id m=64 MiB / t=3 / p=2, key in `Zeroizing`, fresh salt per backup.
5. **No secret leaks into errors** — GCM tag failure maps to `AppError::Auth("Incorrect passphrase")`.
6. **`foreign_keys = ON` is set before migrations run**; `PRAGMA wal_checkpoint(TRUNCATE)` precedes the backup export.
7. **No lock is held across an `.await`, and there is no lock-order inversion** — order is consistently `db → settings` and `session → settings`.
8. **Money is `i64` paise end-to-end**; all four ledger CHECKs present; `balance_after_paise` computed **consistently with** the trigger's formula (verified arithmetically, both directions).
9. **Voids are compensating entries** — `void_ledger_entry` only INSERTs, never UPDATEs or DELETEs; `receipts.voided_at` is a receipt, not the ledger. **`next_receipt_seq` is never decremented** (BR-RC-01 ✓).
10. `restore_db_from_jsonl` drops and recreates triggers inside **one transaction**, so a mid-restore failure rolls the DROP back.

---

## 6. Recommended disposition

Because `DESKTOP gate: LOCKED`, the correct action is **not** to fix these
piecemeal. Nothing here should be merged, called "done", or allowed to influence
the web or mobile gates.

1. **File P0-1, P0-2, P1-13 as the `DESKTOP-PHASE-1` blocker list** — three
   user-visible surfaces (Fees, backup restore, attendance) are **non-functional**,
   not rough.
2. **Raise the spec contradictions first** per `22_Redundancy_Audit.md`.
3. **Wire the four CI gates before anything else** — plus the OpenSSL
   provisioning the build demonstrably requires. *A gate that cannot run is not a gate.*
4. **Sequence: the four §7.2 mandatory test rows first (they are the detectors),
   then the P0s, then the P1s.** The backup round-trip test would have surfaced
   P0-2 immediately; the ledger-integrity test would have surfaced P0-1 and P0-4.
5. **Two items need a decision above this audit's authority:** P0-6 (the
   wipe-on-15-failures path needs an owner proof or challenge phrase before it is
   reachable from a webview) and P0-7 (`biometric_unlock` should be deleted or made
   real — there is no biometric dependency in the tree).

**State: COMPLETED (read-only audit). No file in `apps/desktop` was created,
modified or deleted.**