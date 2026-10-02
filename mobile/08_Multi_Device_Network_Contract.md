# Mobile 08 — Multi-Device + Network-Resilience Contract (LOCKED — read first on unlock)

- Platform state: LOCKED per `16_Platform_Delivery_Sequence.md` (waits on
  WEB-PROD-GATE). This file is forward instruction so no work goes in vain:
  implement it verbatim when mobile unlocks. Do NOT implement now (§9.3).
- Parent contract: `docs/rfc/004-multi-device-network-contract.md` (C1–C6) +
  `mobile/04_Offline_Sync_and_Conflict_Resolution.md` (existing sync rules —
  this file does not replace them; on any conflict between the two, `04` wins
  for sync semantics and this file wins for network mechanics).

## Bindings (Expo, NativeWind — same C1–C6, native APIs)

1. **C1 Idempotency-Key**: UUIDv7 per user intent, minted in the action layer
   (never in the component), sent as `Idempotency-Key` header on every
   mutating gateway call. Same key across retries AND across the offline queue.
2. **C2 retry**: `expo-network` / NetInfo state + fetch wrapper: exponential
   backoff + jitter, max 3 attempts, same key; 4xx (≠408/429) never retried.
3. **C3 offline queue**: `expo-sqlite` table `pending_intents(key, tenant_id,
   route, body, created_at)`; NetInfo `isConnected`/`isInternetReachable`
   events + app-foreground flush, FIFO, same keys; UI shows queued vs confirmed
   (FlashList rows carry a pending chip — never silent). WiFi→data handover
   mid-upload: the in-flight attempt aborts, the SAME key retries (K2).
4. **C4 CAS**: settings/profile/schedule mutations send base `updated_at`;
   on `409 CONFLICT` refresh + user-reviewed re-apply (new key). Ledger rows
   need no CAS (append-only UUIDs).
5. **C5 sessions**: Supabase Auth multi-session; PIN/lockout per-device
   (EC-SEC-01) via `expo-secure-store` + `expo-local-authentication` —
   never synced, never logged.
6. **C6 budgets**: no polling; NetInfo events only; haptic on queue-drain
   completion (existing convention); 44px targets on retry affordances.

## Kill tests on unlock

Run RFC-004 §2 K1–K6 against the Expo build (Maestro per
`21_Automation_Testing.md` M-flows) before the mobile gate. K5 must pass on a
real device with airplane-mode toggling (simulator network conditioning lies
about handover aborts).
