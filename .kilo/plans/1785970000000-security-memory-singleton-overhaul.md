# Plan: Complete Security Overhaul + Memory Leak Fixes + Singleton Hardening

## Goal
Fix all memory leaks, harden security across the entire codebase, implement proper singleton patterns, and ensure multithreaded safety for the web app, product page, and API gateway.

## Audit Results Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 3 | 6 | 8 | 5 | 22 |
| Memory Leaks | 1 | 3 | 3 | 4 | 11 |
| Singletons | — | — | — | — | 5 patterns to verify |

---

## Phase 1: CRITICAL Security Fixes (Immediate)

### 1.1 Remove Hardcoded Turso JWT Token
**File:** `supabase/functions/gateway/lib/db.ts` (lines 23, 45, 136)
**Issue:** Full Turso auth token hardcoded as fallback — leaked in source code.
**Fix:** Remove all 3 hardcoded token fallbacks. Throw on missing token (matching `apps/gateway/lib/db.ts` pattern).
**Risk:** CRITICAL — credential exposure.

### 1.2 Add PIN Re-Authentication to Erase Endpoint
**File:** `apps/gateway/routes/security.ts` (lines 10-16)
**Issue:** `POST /api/v1/security/erase` deletes all enrollments with no PIN confirmation, no rate limit beyond global, no user consent.
**Fix:** Add Zod validation, require `pin_hash` in request body, verify against stored hash before executing erase. Add confirmation token flow.
**Risk:** CRITICAL — data destruction without auth.

### 1.3 Add Zod Validation to Settings PATCH
**File:** `apps/gateway/routes/settings.ts` (lines 29-31)
**Issue:** `...body` spreads unvalidated request body into Prisma create/update — allows field injection (pinHash, tenantId, id).
**Fix:** Whitelist allowed fields: `instituteName`, `currency`, `locale`, `defaultLockHours`, `pinLockTimeoutMinutes`, `receiptPrefix`, `invoicePrefix`. Reject everything else.
**Risk:** CRITICAL — arbitrary field injection.

---

## Phase 2: HIGH Security Fixes

### 2.1 Sanitize Gateway Error Messages
**File:** `apps/gateway/index.ts` (line 290-291)
**Issue:** Full `err.message` returned to client — leaks SQL errors, file paths, stack traces.
**Fix:** Return generic "Internal server error" for non-AuthError exceptions. Log full error server-side.

### 2.2 Validate AES Key Strength
**File:** `apps/web/src/lib/crypto.ts` (lines 3, 26)
**Issue:** `AES_KEY` falls back to empty string when both env vars are missing. `PEPPER` also falls back to empty string.
**Fix:** Throw at module load if `DATA_ENCRYPTION_KEY` is missing and `NODE_ENV === 'production'`.

### 2.3 Move Rate-Limit State to DB (Partial)
**File:** `apps/gateway/lib/security.ts` (lines 52-54)
**Issue:** `failedAuthMap`, `ipRateLimitMap`, `nonceCache` are in-memory — reset on cold start.
**Fix:** Log failed auth attempts to `audit_log` table. Check `audit_log` for recent failures on each request. Accept that rate-limit counters reset on cold start (Supabase Edge Functions are short-lived), but lockout status persists via DB.

### 2.4 Add Max-Size to IP Rate Limit Map
**File:** `apps/gateway/lib/security.ts` (line 52)
**Issue:** `ipRateLimitMap` grows unbounded under adversarial traffic.
**Fix:** Add periodic cleanup (every 60s) to evict expired entries. Add max size guard at 10,000 entries.

### 2.5 Fix CSP `unsafe-inline` for Styles
**File:** `apps/web/src/proxy.ts` (line 165)
**Issue:** `style-src 'self' 'unsafe-inline'` allows CSS injection.
**Fix:** This is acceptable for Tailwind CSS usage — document the decision. Add nonce-based style CSP in a future iteration.

### 2.6 Remove `x-detected-platform` Header in Production
**File:** `apps/web/src/proxy.ts` (line 150)
**Issue:** Platform fingerprinting information leaked to client.
**Fix:** Only set header when `NODE_ENV !== 'production'`.

---

## Phase 3: MEDIUM Security Fixes

### 3.1 Replace `console.error` with Typed Logger in Gateway Routes
**Files:** All `apps/gateway/routes/*.ts` files
**Issue:** `console.error` in catch blocks leaks stack traces to Supabase logs.
**Fix:** Replace with `logError` from `lib/log.ts`.

### 3.2 Add Zod Validation to Notifications POST
**File:** `apps/gateway/routes/notifications.ts` (lines 21-34)
**Issue:** Arbitrary `category`, `title`, `body` accepted without validation.
**Fix:** Add Zod schema for notification body. Sanitize `title` and `body`.

### 3.3 Fix `verifyPin` Silent Failure
**File:** `apps/web/src/lib/crypto.ts` (lines 16-24)
**Issue:** Catch block returns `false` for all errors including library errors.
**Fix:** Log error type. Return `false` only for verification failures; re-throw for library errors.

### 3.4 Add Pagination to Analytics Dashboard
**File:** `apps/gateway/routes/analytics.ts` (lines 21-31)
**Issue:** Fetches ALL payment records without pagination.
**Fix:** Use `aggregate` for sums, `groupBy` for counts. Never fetch full tables.

### 3.5 Validate Sync Flush Endpoint
**File:** `apps/gateway/routes/sync.ts` (lines 19-24)
**Issue:** Flush endpoint is a no-op stub returning success.
**Fix:** Either implement actual flush logic or return 501 Not Implemented.

### 3.6 Secure A/B Cookies
**File:** `apps/web/src/proxy.ts` (lines 187-194)
**Issue:** `secure: false` in development allows HTTP cookies.
**Fix:** Always set `secure: true`.

### 3.7 Remove Non-Standard Localhost Origins
**File:** `apps/web/src/proxy.ts` (lines 26-28)
**Issue:** `localhost:3001` and `localhost:3100` allowed in CORS.
**Fix:** Remove non-standard origins. Keep only `localhost:3000` and `127.0.0.1:3000`.

### 3.8 Add Startup Validation for HMAC Secret
**File:** `apps/gateway/lib/crypto.ts` (lines 6-10)
**Issue:** Weak HMAC secret only warns, doesn't block startup in production.
**Fix:** Throw in production if `GATEWAY_SHARED_SECRET` is missing or < 32 chars.

---

## Phase 4: Memory Leak Fixes

### 4.1 Fix rAF Leak in CountUp Component
**File:** `apps/web/src/components/ui/count-up.tsx` (lines 8-23)
**Issue:** `requestAnimationFrame` not cancelled on unmount.
**Fix:** Store `rafId`, return `() => window.cancelAnimationFrame(rafId)` from useEffect.

### 4.2 Add LRU Eviction to DB Client Cache
**File:** `apps/web/src/lib/db.ts` (lines 9-10)
**Issue:** `clientCache` and `prismaCache` Maps grow unbounded.
**Fix:** Add max size (64) with LRU eviction. Evict oldest entry when full.

### 4.3 Fix setTimeout Leak in createTimeoutSignal
**File:** `apps/web/src/server/get-db.ts` (lines 241-244)
**Issue:** `setTimeout` never cleared when request completes before timeout.
**Fix:** Return `cleanup` function alongside `signal`. Call `clearTimeout` in `finally` blocks.

### 4.4 Fix Attendance Report Fetch Without Cleanup
**File:** `apps/web/src/components/attendance/attendance-report-client.tsx` (lines 62-68)
**Issue:** `useEffect` fires fetch without AbortController — state update after unmount.
**Fix:** Add AbortController, check `signal.aborted` before setting state.

### 4.5 Fix useMediaQuery to Use matchMedia
**File:** `apps/web/src/hooks/use-media-query.ts` (lines 14-16)
**Issue:** Uses `resize` event listener (fires every pixel) instead of `matchMedia.addEventListener`.
**Fix:** Use `media.addEventListener('change', listener)`.

### 4.6 Fix Attendance Grid setTimeout Cleanup
**File:** `apps/web/src/components/attendance/attendance-grid.tsx` (line 59)
**Issue:** `setTimeout` not cleared on unmount.
**Fix:** Store timeout ID, clear in useEffect cleanup.

### 4.7 Add Periodic Cleanup to Gateway Security Maps
**File:** `apps/gateway/lib/security.ts` (lines 52-54)
**Issue:** `ipRateLimitMap`, `nonceCache`, `failedAuthMap` grow without periodic cleanup.
**Fix:** Add periodic cleanup in `runSecurityChecks` (every 60s) to evict expired entries.

### 4.8 Add Max-Size Guard to Gateway Schema Cache
**File:** `apps/gateway/lib/schema.ts` (line 5)
**Issue:** `healedTenants` Set grows unbounded.
**Fix:** Add max size (10,000) with LRU eviction.

---

## Phase 5: Singleton Pattern Hardening

### 5.1 Verify Gateway DB Client Singleton
**File:** `apps/gateway/lib/db.ts` (line 5)
**Status:** ✅ Already correct — `tursoCache` Map keyed by URL+token.
**Action:** No change needed.

### 5.2 Verify Web DB Client Singleton
**File:** `apps/web/src/lib/db.ts` (lines 9-10)
**Status:** ⚠️ Correct pattern but unbounded — fix in Phase 4.2.

### 5.3 Verify QueryClient Singleton
**File:** `apps/web/src/app/providers.tsx` (lines 8-22)
**Status:** ✅ Already correct — `useState` creates once per component mount.
**Action:** No change needed.

### 5.4 Verify Gateway Cache Singleton
**File:** `apps/gateway/lib/cache.ts`
**Status:** ✅ Already correct — LRU with MAX_ENTRIES=512, TTL eviction.
**Action:** No change needed.

### 5.5 Verify Logger Singletons
**File:** `apps/gateway/lib/log.ts`, `apps/web/src/lib/logger.ts`
**Status:** ✅ Already correct — module-level instances.
**Action:** No change needed.

---

## Phase 6: Multithreading Safety

### 6.1 Web App (Next.js 16 — Node.js)
**Status:** ✅ Next.js 16 runs on Node.js which uses worker threads for server components. Client components are single-threaded (browser main thread).
**Action:** No changes needed. Singleton caches are per-process (Node.js is single-threaded per worker).

### 6.2 Product Page (Next.js 16 — Node.js)
**Status:** ✅ Same as web app.
**Action:** No changes needed.

### 6.3 API Gateway (Deno Edge Functions)
**Status:** ✅ Deno Edge Functions are request-isolated (each request gets its own context). Module-level singletons (Maps) are shared across requests within the same isolate.
**Action:** The in-memory Maps (rate limit, nonce, auth) are correctly shared across requests within an isolate. Cold starts reset them (expected behavior). The DB client cache is correctly shared.

### 6.4 Concurrency Safety for In-Memory State
**Issue:** Deno Edge Functions can serve multiple requests concurrently within one isolate.
**Fix:** All Map operations in `security.ts` and `cache.ts` are synchronous (no await between get/set), so they're safe under Deno's cooperative concurrency model.

---

## Implementation Order

1. **Phase 1** (CRITICAL) — Fix hardcoded token, erase endpoint, settings validation
2. **Phase 2** (HIGH) — Error sanitization, key validation, rate-limit DB, CSP, headers
3. **Phase 3** (MEDIUM) — Logger migration, notification validation, analytics pagination
4. **Phase 4** (MEMORY) — rAF cleanup, cache eviction, setTimeout fixes, abort controllers
5. **Phase 5** (SINGLETON) — Verify all patterns (already done)
6. **Phase 6** (THREADING) — Verify all patterns (already done)
7. **Verify** — `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run test:integration`

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/gateway/lib/db.ts` | Remove hardcoded token (3 locations) |
| `apps/gateway/routes/security.ts` | Add PIN re-auth, Zod validation |
| `apps/gateway/routes/settings.ts` | Add Zod whitelist for PATCH body |
| `apps/gateway/index.ts` | Sanitize error messages |
| `apps/web/src/lib/crypto.ts` | Validate key strength at startup |
| `apps/gateway/lib/security.ts` | Add periodic cleanup, max size guards |
| `apps/gateway/lib/crypto.ts` | Block startup on weak secret in production |
| `apps/web/src/components/ui/count-up.tsx` | Fix rAF leak |
| `apps/web/src/lib/db.ts` | Add LRU eviction to caches |
| `apps/web/src/server/get-db.ts` | Fix setTimeout leak, add cleanup |
| `apps/web/src/components/attendance/attendance-report-client.tsx` | Add AbortController |
| `apps/web/src/hooks/use-media-query.ts` | Use matchMedia change events |
| `apps/web/src/components/attendance/attendance-grid.tsx` | Fix setTimeout cleanup |
| `apps/web/src/proxy.ts` | Remove platform header in prod, secure cookies |
| `apps/gateway/routes/notifications.ts` | Add Zod validation |
| `apps/gateway/routes/analytics.ts` | Use aggregate instead of findMany |
| `apps/gateway/routes/sync.ts` | Return 501 for stub endpoint |
| `apps/web/src/lib/logger.ts` | Already correct |
| `apps/gateway/lib/log.ts` | Already correct |

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Remove hardcoded token | LOW — env vars already configured | Verify Supabase Edge Function secrets are set |
| PIN re-auth on erase | LOW — adds security | Test erase flow with correct/incorrect PIN |
| Settings Zod validation | MEDIUM — may reject valid fields | Audit all settings fields before adding schema |
| Error sanitization | LOW — only changes error messages | Verify requestId still works for debugging |
| Cache eviction | LOW — may evict hot entries | LRU is standard; 64 entries sufficient |
| rAF cleanup | LOW — standard React pattern | Verify CountUp still animates |
| setTimeout cleanup | LOW — standard pattern | Verify gateway calls still work |

---

## Success Criteria

- [ ] No hardcoded secrets in source code
- [ ] All mutation endpoints validate input with Zod
- [ ] Erase endpoint requires PIN re-authentication
- [ ] Error messages don't leak internal details
- [ ] All memory leaks fixed (rAF, setTimeout, fetch without abort)
- [ ] All caches have max size + eviction
- [ ] Security maps have periodic cleanup
- [ ] `bun run lint` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run test:unit` passes
- [ ] `bun run test:integration` passes
