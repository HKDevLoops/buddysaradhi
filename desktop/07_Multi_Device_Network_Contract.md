# Desktop 07 — Multi-Device + Network-Resilience Contract (LOCKED — read first on unlock)

- Platform state: LOCKED per `16_Platform_Delivery_Sequence.md` (waits on
  WEB-PROD-GATE, then mobile). Forward instruction so no work goes in vain:
  implement verbatim on unlock. Do NOT implement now (§9.3).
- Parent contract: `docs/rfc/004-multi-device-network-contract.md` (C1–C6).
  Security spine stays `desktop/03_IPC_Security.md` + `10_Security.md` §5.

## Bindings (Tauri v2 + Rust + SQLCipher — same C1–C6, desktop APIs)

1. **C1 Idempotency-Key**: UUIDv7 per intent, minted in the Rust command layer
   (validated with `serde` before touching SQLite — `03` §IPC rules); sent as
   `Idempotency-Key` on every mutating gateway call. Same key across retries.
2. **C2 retry**: `reqwest` with exponential backoff + jitter (max 3, same key);
   honour `Retry-After` on 429; never retry 4xx (≠408/429). Timeouts bounded
   (12s) so a dead network never hangs the webview.
3. **C3 offline queue**: SQLCipher table `pending_intents(key, tenant_id,
   route, body, created_at)`; Tauri online/offline window events + focus
   flush, FIFO, same keys; tray/badge shows queued count (never silent).
   Sleep/wake and network-switch aborts retry with the SAME key (K2).
4. **C4 CAS**: settings/profile/schedule mutations send base `updated_at`;
   `409 CONFLICT` → refresh + user-reviewed re-apply (new key). Ledger rows
   need no CAS (append-only UUIDs).
5. **C5 sessions**: Supabase Auth multi-session; PIN/lockout per-device
   (EC-SEC-01) in SQLCipher — never synced, never logged.
6. **C6 budgets**: no polling; event-driven only; capability allowlist
   unchanged (no new origins — gateway only).

## Kill tests on unlock

Run RFC-004 §2 K1–K6 via `tauri-driver` per `21_Automation_Testing.md` D-flows
before the desktop gate, including a sleep/wake + network-switch cycle (K2)
and a 10-concurrent-receipt storm (K6) against the shared gateway.
