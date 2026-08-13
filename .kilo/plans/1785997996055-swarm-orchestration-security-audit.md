# Plan: Swarm-Orchestrated Concurrency Audit + Remaining P1/P2 Fixes

## Goal
Apply swarm orchestration to: (1) audit concurrency safety across all runtimes, (2) verify production stability via TestSprite, and (3) fix remaining lower-priority security findings.

## Context
- **Commit `4492fbf`**: 3 P0 + 9 P1 + 2 P2 security/memory/quality fixes across 13 files. All lint+typecheck pass.
- **Phase 2 concurrency audit COMPLETED**: ALL SAFE with 1 recommended hardening + 3 race-condition risks in `fees.ts`.

---

## Phase 2: Concurrency Audit Results (COMPLETED)

### Deno Edge (apps/gateway/) — ALL SAFE
All module-level mutable state (Maps, Sets) operates synchronously between `await` points. Cooperative concurrency guarantees atomicity.

| State | File | Safe? |
|-------|------|-------|
| `tursoCache` Map | `db.ts:5` | YES |
| `failedAuthMap`, `ipRateLimitMap`, `nonceCache` | `security.ts:52-54` | YES |
| `nodeMap` LRU Map | `cache.ts:16` | YES |
| `healedTenants` Set (capped 10K) | `schema.ts:5` | YES |

**Hardening needed**: `crypto.ts:133` — `rateLimitMap` is unbounded. Add `RATE_LIMIT_MAX_ENTRIES = 10_000` + eviction.

### Next.js Server + Browser — 22 SAFE, 3 RISK, 1 LOW-RISK
- `QueryClient` singleton — correct `useState` per-React-tree ✅
- `getDb()`/`getDbClient()` caches — atomic get/set, worst case double-create ✅
- Zustand stores — single-threaded browser ✅
- `useEffect` cleanups (rAF, AbortController) — correct ✅
- **RISK**: `apps/web/src/server/actions/fees.ts` — balance race conditions under concurrent attendance + fee submissions (3 race windows)
- **LOW-RISK**: `use-media-query.ts` — re-subscribes on every render (perf, not correctness)

---

## Phase 3: Remaining Fixes — 4 Tasks

### Task 3A: CORS-1 + ERR-2 in `errors.ts`
**Current** (line 5): `"Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*"` — defaults to `*` (P1 CORS-1). Line 10: `"Allow-Credentials": "true"` with wildcard origin (P2 ERR-1).

**Fix**:
1. Replace `|| "*"` with env-var split into Set + hardcoded fallback list:
   - `https://buddysaradhi.vercel.app` (production web)
   - `http://localhost:3000` (local dev)
   - `http://127.0.0.1:3000` (alternative localhost)
2. Set `CORS["Access-Control-Allow-Origin"]` to the matching origin from the request's `Origin` header, NOT `*`.
3. Only set `"Allow-Credentials": "true"` when origin matches the allowlist (not `*`).

### Task 3B: LOG-1 in `log.ts`
**Current** (line 23): `/\b(?:\d{4}[-\s]?){3}\d{4}\b/g` — matches any 16-digit sequence. Over-broad: catches student IDs, phone numbers, etc.

**Fix**: Tighten to Luhn-compatible or at minimum require 4 groups of exactly 4 digits with optional separators:
- Keep current regex but add word boundary + length constraints to reduce false positives.
- Or: match known card prefix patterns (Visa `4xxx`, MC `5xxx`/`2xxx`, Amex `3xxx`).
- SSN regex (`/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g`) is also broad but acceptable for log redaction.

### Task 3C: SQL-1 in `orm.ts` — orderBy injection
**Current**: `student.findMany` (line 122-131) has `ALLOWED_SORT_COLUMNS` whitelist validation. But `attendanceSession.findMany` (line 263), `ledgerEntry.findMany` (line 360), and `notification.findMany` (line 482) use `camelToSnake(col) + dir.toUpperCase()` with NO validation.

**Fix**: Extract `ALLOWED_SORT_COLUMNS` + validation into a shared helper. Apply to all three vulnerable models:

```typescript
function validateOrderBy(col: string, dir: string, allowedColumns: Set<string>): string {
  const ALLOWED_DIRECTIONS = new Set(["ASC", "DESC"]);
  const snakeCol = camelToSnake(col);
  const upperDir = dir.toUpperCase();
  if (allowedColumns.has(snakeCol) && ALLOWED_DIRECTIONS.has(upperDir)) {
    return ` ORDER BY ${snakeCol} ${upperDir}`;
  }
  return "";
}
```

Define allowed columns per model:
- `attendanceSession`: `session_date`, `batch_name`, `created_at`
- `ledgerEntry`: `occurred_on`, `type`, `created_at`
- `notification`: `category`, `created_at`, `read`

### Task HARDEN: `crypto.ts` rateLimitMap max size
**Current** (line 133): `const rateLimitMap = new Map<string, RateLimitEntry>()` — unbounded. Only `cleanExpiredEntries()` (line 64-78) removes stale entries.

**Fix**: Add `RATE_LIMIT_MAX_ENTRIES = 10_000` constant. In `getRateLimitEntry()` or `cleanExpiredEntries()`, if `rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES`, delete oldest 25% of entries (sorted by `resetAt`). Same pattern as `security.ts` `periodicSecurityCleanup()`.

---

## Files to Modify

| File | Task | Risk |
|------|------|------|
| `apps/gateway/lib/errors.ts` | 3A — CORS origin validation | Medium — must not break web/mobile/desktop |
| `apps/gateway/lib/log.ts` | 3B — Tighten credit card regex | Low — redaction-only, no runtime impact |
| `apps/gateway/lib/orm.ts` | 3C — orderBy whitelist for 3 models | Medium — SQL injection prevention |
| `apps/gateway/lib/crypto.ts` | HARDEN — rateLimitMap max size | Low — matches security.ts pattern |

## Execution Order

1. **Task 3C** (SQL-1) — highest severity (SQL injection vector)
2. **Task 3A** (CORS-1 + ERR-2) — second highest (CORS bypass)
3. **Task HARDEN** (crypto.ts max size) — from concurrency audit
4. **Task 3B** (LOG-1) — lowest severity (log redaction false positives)
5. **Verify**: `deno lint apps/gateway/` + `pnpm run lint` + `pnpm run typecheck`
6. **Commit + push**
7. **TestSprite verification** (requires bash-enabled session)
8. **CI verification** via `gh run list`

## Success Criteria

- [ ] `orm.ts` orderBy injection: All 4 models use `ALLOWED_SORT_COLUMNS` whitelist
- [ ] `errors.ts` CORS: Origin validated against allowlist, no wildcard `*` in production
- [ ] `crypto.ts` rateLimitMap: Capped at 10K with eviction
- [ ] `log.ts` credit card regex: Tightened to reduce false positives
- [ ] `deno lint` + `pnpm run lint` + `pnpm run typecheck`: All pass
- [ ] CI: All workflows green
