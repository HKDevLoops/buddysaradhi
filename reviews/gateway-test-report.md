# Gateway Live Test Report — BuddySaradhi

- **Project**: `gmqwdnvbfnwpzpctwvho`
- **Date**: 2026-07-13
- **Tester**: QA
- **Method**: Live `curl.exe` against the deployed Supabase Edge Functions (read-only; no schema/function changes).
- **Demo tenant (JWT `sub`)**: `6b30c96a-28a8-4674-87ad-cf01d8cdd670`

## Summary

| Function | Status | Notes |
|---|---|---|
| **Auth (token endpoint)** | ✅ PASS | JWT acquired, 200. |
| **Gateway REST** | ⚠️ PARTIAL | Auth, GET, PATCH all return 200 with `{success, data}` envelope. Endpoint works. **But `palette` field is NOT supported** — PATCH silently drops it, GET never returns it. |
| **GraphQL gateway** | ❌ FAIL | Every request (incl. `{ health }`) returns **HTTP 500 INTERNAL_SERVER_ERROR**. Entire endpoint is non-functional. |
| **Provision-db** | ✅ PASS | HTTP 200, `{"status":"provisioned","tenantId":"..."}`. |

## Auth

- **Succeeded.** `POST /auth/v1/token?grant_type=password` with demo creds returned `HTTP 200` and a valid `access_token`.
- JWT `sub` (tenant_id) = `6b30c96a-28a8-4674-87ad-cf01d8cdd670`.
- Token sample (redacted): `eyJhbGciOiJFUzI1NiI…iFGz7wECnqAfobLfoop6qTBt38nWYrSpMYO-50YlEF0jW2qQLSaBt8DHznyQEvR79RnzvlCEhjXrtGiuRJRSug`
- Both the REST and GraphQL gateways accepted this JWT (REST served data; GraphQL passed the platform JWT check and reached function code before crashing).

## Gateway REST

**Envelope shape**: `{ "success": boolean, "data": <payload|null> }`. Errors use `{ "success": false, "error": "<msg>" }`.

- **GET `/api/v1/settings`** → `HTTP 200`, `{"success":true,"data":{...settings...}}`.
  - Before provisioning: `data` was `null` (no settings row yet).
  - After `provision-db` ran, the row exists and GET returns the full settings object, including `theme`, `density`, `reducedMotion` (values: `"system"`, `"comfortable"`, `0`).
  - **`palette` is absent from the response entirely.**
- **PATCH `/api/v1/settings` with `{"palette":"emerald-ledger"}`** → `HTTP 200`, `{"success":true,"data":{...}}` (no error).
- **GET again to confirm persistence** → `HTTP 200`, settings returned, **`palette` still NOT present.**

**Palette persistence confirmed: NO.**

Root cause (from source `supabase/functions/gateway/index.ts`):
- `SETTINGS_KEYS` map (lines 83–112) has **no `palette` entry**, so PATCH ignores the key (`patch` only gets `updated_at`). The call "succeeds" but writes nothing for `palette` — a silent no-op, not a validation error.
- `mapSettings()` (lines 47–81) also never maps a `palette` field, and `data` returned by GET contains no `palette`.
- Likely the `settings` table also lacks a `palette` column (could not be verified without schema write; consistent with the function code).

This means the task's expectation ("should include … `palette`") is **not met by the deployed build** — the `palette` feature was not wired into the REST gateway.

## GraphQL

**Endpoint**: `POST /functions/v1/gateway-graphql` with `Authorization: Bearer <JWT>` + `Content-Type: application/json`.

- Query tested: `{ settings(tenantId:"6b30c96a-28a8-4674-87ad-cf01d8cdd670") { palette theme density } }`
- **Result: `HTTP 500`** with body:
  ```json
  {"errors":[{"message":"Unexpected error.","extensions":{"code":"INTERNAL_SERVER_ERROR"}}]}
  ```
- **Isolated test — `{ health }`** (no DB, no tenant arg): also `HTTP 500` with the same error. So the failure is **not** palette-specific and **not** data-specific; the whole Yoga server crashes before executing any resolver.
- **No-auth control**: `POST` with no `Authorization` header returns `HTTP 401` `UNAUTHORIZED_NO_AUTH_HEADER` — this is the Supabase platform JWT gate, proving the function *is* deployed and reachable; the 500 happens *inside* function execution after the platform passes a valid JWT.

**Conclusion**: The GraphQL gateway is **completely non-functional** in its current deployment. The `Setting` GraphQL type (lines 165–198 of `gateway-graphql/index.ts`) also has no `palette` field, so even if the 500 were fixed, the requested query would fail schema validation. The 500 on `{ health }` points to a runtime/deploy fault (likely a graphql-yoga@5 import or context-creation crash in the Deno edge runtime) — function logs would be needed to pin the exact throw.

## Provision-db

- **POST `/functions/v1/provision-db`** (empty body `{}`, `Authorization: Bearer <JWT>`) → `HTTP 200`:
  ```json
  {"status":"provisioned","tenantId":"6b30c96a-28a8-4674-87ad-cf01d8cdd670"}
  ```
- For this already-existing demo tenant it returned `provisioned` (idempotent — it created/confirmed the tenant row and seed data, which is what made the subsequent REST `GET /settings` return a real row instead of `null`).
- No missing-arg or auth error. Works as expected for the demo user.

## Issues / Blockers

1. **[BLOCKER] GraphQL gateway returns 500 on every request** — including `{ health }`. Function is unusable. Needs function logs to diagnose; probable graphql-yoga@5 / Deno runtime crash in `gateway-graphql/index.ts`.
2. **[BUG] REST gateway silently ignores `palette`** — `PATCH /api/v1/settings {"palette":"emerald-ledger"}` returns `HTTP 200` and `success:true` but does not persist or echo `palette`. No error is surfaced, so clients believe the write succeeded. `GET` never returns `palette`. `SETTINGS_KEYS` and `mapSettings()` in `gateway/index.ts` lack `palette`, and the `Setting` type in the GraphQL schema also lacks it. The "palette" requirement is not implemented in the deployed build.
3. **[MINOR] Empty settings on fresh tenant** — `GET /settings` returns `data:null` until `provision-db` seeds the row. Acceptable if provision-db is meant to run first, but the REST gateway offers no "create settings" path (only PATCH on an existing row), so a tenant that is never provisioned can never get settings via REST.

## Redacted credentials used

- Anon key (redacted): `eyJhbGciOiJIUzI1NiI…M--_VPKADCmwai3jHgF1id7kIpBAtvA6qvljDHU6JUI`
- Access token (redacted, above).
- No secrets were written to disk other than temporary request/response files under `%TEMP%\opencode\`.
