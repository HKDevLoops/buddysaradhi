# RFC-004: Multi-Device + Network-Resilience Contract

- Status: ACCEPTED FOR IMPLEMENTATION (user directive 2026-09-30).
- Problem: one tutor on web + desktop + mobile at once, some online / some
  flapping (WiFi↔data handover mid-request). Today: NO idempotency keys, NO
  client retry, NO offline queue, NO compare-and-swap on shared rows. A retried
  POST mints duplicates (double payment / double receipt); concurrent edits
  last-write-wins silently; a handover abort loses the intent.
- Parent: RFC-003 (SaaS overhaul). Platform rule: implement NOW for
  web + gateway + product page; mobile/desktop get contract docs only
  (`mobile/08_*`, `desktop/07_*` + AGENTS pointers) until unlocked per §16.

## 1. Contract (all platforms, all runtimes — one behaviour)

1. **Idempotency-Key (C1)**: every mutating call carries a client-generated
   UUIDv7 minted ONCE per user intent (form submit, not per attempt). Server
   persists `(key, tenant, route, response, created_at)` 24h and replays the
   STORED response byte-identically on duplicate key. Double-click, retry,
   multi-device echo of the same intent → one effect.
2. **Retry policy (C2)**: transport failure/timeout → exponential backoff +
   jitter, max 3 attempts, SAME key. 4xx (except 408/429) never retried; 429
   honours `Retry-After`; 503/timeout always retried with same key.
3. **Offline queue (C3)**: intents created offline persist to a durable local
   queue (web: localStorage namespaced per tenant; mobile: sqlite; desktop:
   sqlite) and flush in order on `online`/reconnect, same keys. UI marks
   queued vs confirmed states distinctly (never silent).
4. **Compare-and-swap (C4)**: shared mutable rows (settings, student profile,
   fee schedules) carry `updated_at`; mutations send base `updated_at`;
   mismatch → `409 CONFLICT` + server row; client refreshes and re-applies
   intent (new key — it is a NEW intent after user review). Ledger rows are
   conflict-immune (append-only UUIDs, Rule 1); sequences are atomic
   single-statements (BR-RC-01).
5. **Sessions (C5)**: Supabase Auth multi-session is the source of truth.
   PIN/lockout stays per-device (EC-SEC-01, already decided — never synced).
6. **Budgets (C6)**: retries/queue-drain obey RFC-003 §0 free-tier limits —
   bounded attempts, small payloads, no hot polling (online/offline events +
   visibilitychange only).

## 2. Kill-test matrix (acceptance — must all pass)

| # | Scenario | Expect |
|---|---|---|
| K1 | Double-click record-payment | 1 ledger row, 1 receipt; 2nd response identical (replay) |
| K2 | Abort mid-POST (handover), auto-retry same key | 1 effect, 2nd is replay |
| K3 | Same intent from web + mobile simultaneously | 1 effect (key dedup wins) |
| K4 | Concurrent profile edits, two devices, stale base | 1 wins, loser gets 409 + fresh row (no silent overwrite) |
| K5 | Offline queue 3 intents → reconnect | FIFO drain, same keys, all confirmed, order preserved |
| K6 | Sequence storm (10 concurrent receipts) | 10 unique monotonic numbers, no gaps-from-rollback, no dupes |

## 3. Platform duties

- **Gateway**: `idempotency_keys` store (per-tenant DB, TTL sweep), key
  middleware on mutating routes, CAS checks on settings/students/schedules,
  typed `409 CONFLICT` + `429`/`503` codes. Tests: K1–K4,K6 ( Concurrent tx ).
- **Web**: intent-key minter, retrying fetch wrapper, localStorage queue +
  online flush, optimistic UI with rollback, CAS base passing, K1–K5 e2e.
- **Product page**: static marketing — NO data paths (verified by grep); build
  gate only. No changes.
- **Mobile** (`mobile/08_Multi_Device_Network_Contract.md`): same C1–C6 with
  `expo-sqlite` queue + NetInfo events + `expo-secure-store` keys; FlashList
  never blocks on drain.
- **Desktop** (`desktop/07_Multi_Device_Network_Contract.md`): same C1–C6 with
  libsql queue + Tauri online events + SQLCipher; IPC-validated intents.

## 4. Non-goals

CRDTs/vector clocks (v2 per P13 — LWW + CAS is the v1 contract), cross-device
PIN sync (forbidden by EC-SEC-01), new screens/routes, ledger grammar changes.
