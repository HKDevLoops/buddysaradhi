// Implements: web/02_State_and_Data_Flow.md §5 (cache hierarchy — server read-through cache);
// 12_Business_Rules.md BR-SYN-01..04 (cheap reads protect the sync/outbox contract);
// 02_Core_Logic.md §9 (sync engine — batch + cache as budget control);
// docs/rfc/003-saas-overhaul.md workstream C + §0 (Vercel Hobby + Supabase Free budgets).
//
// FREE-TIER RATIONALE (RFC-003 §0): Vercel Hobby bills bandwidth + serverless execution
// time; Supabase Free caps bandwidth, rows-read, and Edge invocations. Every cache hit avoids
// one HTTPS round trip to the gateway or Turso: less function time, fewer rows read, fewer
// bytes shipped. Reference data (settings singleton, batch list) changes rarely, so a 63s
// tenant-scoped TTL is pure savings. Per-student ledger/balances are NEVER cached here —
// they stay request-scoped via React `cache()` in server/queries/* (fresh money on every
// request; a stale balance is a livelihood bug, and the guard below rejects such keys).
//
// Design: zero dependencies, tenant-scoped keys only (no cross-tenant leaks), LRU-ish cap
// (~500 entries — a full roster page plus reference rows fit; eviction is oldest-first),
// in-flight dedup (concurrent callers share one loader), fail-fast timeouts (never hang a
// serverless invocation on a stalled upstream).

/** Default TTL for reference data (settings, batches): 63s per RFC-003 workstream C. */
export const DEFAULT_REFERENCE_TTL_MS = 63_000;

/** Hard bound for every query path: 12s max per RFC-003 workstream C. */
export const QUERY_TIMEOUT_MS = 12_000;

/** Size bound for the in-memory reference cache (LRU-ish: oldest-first eviction). */
const MAX_CACHE_ENTRIES = 500;

/**
 * Key prefixes that must NEVER be tenant-cached beyond one request.
 * web/02_State_and_Data_Flow.md §3.2: ledger rows are immutable but per-student balances
 * are derived-live; caching them here would serve stale money. React `cache()` in
 * server/queries/* already gives per-request dedup — that is the ceiling.
 */
const NON_CACHEABLE_PREFIXES = ["ledger:", "balance:"] as const;

interface CacheEntry {
  value: unknown;
  expiresAtMs: number;
}

const referenceCache = new Map<string, CacheEntry>();
const inflightLoads = new Map<string, Promise<unknown>>();

function scopedKey(tenantId: string, key: string): string {
  return `${tenantId}::${key}`;
}

function assertCacheableKey(key: string): void {
  for (const prefix of NON_CACHEABLE_PREFIXES) {
    if (key === prefix || key.startsWith(prefix)) {
      throw new Error(
        `VALIDATION: cache key "${prefix}…" is not tenant-cacheable — ledger/balances stay request-scoped via React cache() (web/02 §3.2)`,
      );
    }
  }
}

function storeSettled(scoped: string, value: unknown, ttlMs: number): void {
  if (referenceCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = referenceCache.keys().next();
    if (!oldest.done) referenceCache.delete(oldest.value);
  }
  referenceCache.set(scoped, { value, expiresAtMs: Date.now() + ttlMs });
}

/**
 * Tenant-scoped read-through cache for reference data (settings, batches).
 * Miss → run loader once per key (concurrent callers share the in-flight load),
 * store on success, propagate failures uncached. Keys always include tenantId —
 * a missing tenantId fails closed (VALIDATION) rather than risking a cross-tenant leak.
 */
export async function getCached<T>(
  tenantId: string,
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_REFERENCE_TTL_MS,
): Promise<T> {
  if (!tenantId || !key) {
    throw new Error("VALIDATION: tenant-scoped cache requires a non-empty tenantId and key");
  }
  assertCacheableKey(key);
  const scoped = scopedKey(tenantId, key);
  const now = Date.now();
  const hit = referenceCache.get(scoped);
  if (hit) {
    if (hit.expiresAtMs > now) {
      // LRU touch: re-insert so eviction stays oldest-first.
      referenceCache.delete(scoped);
      referenceCache.set(scoped, hit);
      return hit.value as T;
    }
    referenceCache.delete(scoped);
  }
  const ongoing = inflightLoads.get(scoped);
  if (ongoing) return ongoing as Promise<T>;
  const bound = Math.min(Math.max(ttlMs, 1), QUERY_TIMEOUT_MS);
  const task: Promise<T> = (async (): Promise<T> => {
    try {
      const value = await withQueryTimeout(loader(), bound);
      storeSettled(scoped, value, ttlMs);
      return value;
    } finally {
      inflightLoads.delete(scoped);
    }
  })();
  inflightLoads.set(scoped, task);
  return task;
}

/**
 * Mutation invalidation for the reference cache. OUT OF SCOPE for this workstream to call
 * (actions/* own their mutations per RFC-003 workstream split) — the orchestrator wires
 * these calls at the mutation sites listed in the worklog. Returns entries removed.
 */
export function invalidateTenant(tenantId: string, prefix?: string): number {
  if (!tenantId) return 0;
  const scope = scopedKey(tenantId, "");
  let removed = 0;
  for (const cacheKey of Array.from(referenceCache.keys())) {
    if (!cacheKey.startsWith(scope)) continue;
    if (prefix && !cacheKey.slice(scope.length).startsWith(prefix)) continue;
    referenceCache.delete(cacheKey);
    removed += 1;
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Fail-fast timeout + typed-error helpers (RFC-003 workstream C: 12s max everywhere).
//
// NOTE (intentional duplication): server/get-db.ts owns an identical ~10-line
// createTimeoutSignal for its gateway fetch calls. It is duplicated here — not
// imported — because this workstream's scope is server/queries/** + this file ONLY;
// editing server/get-db.ts to export/share it belongs to workstream A (web-auth).
// ---------------------------------------------------------------------------

/**
 * Abort signal bound by timeout. Direct-DB (libsql) calls take no signal, so
 * withQueryTimeout below races instead — this helper serves gateway-style fetch paths.
 */
export function createTimeoutSignal(
  timeoutMs: number = QUERY_TIMEOUT_MS,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timerId),
  };
}

/**
 * Bounds any query promise by QUERY_TIMEOUT_MS. The underlying driver call cannot be
 * cancelled mid-flight, but the waiter fails fast with a typed UPSTREAM error instead
 * of hanging a metered serverless invocation (RFC-003 §0).
 */
export function withQueryTimeout<T>(task: Promise<T>, timeoutMs: number = QUERY_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(`UPSTREAM: query timed out after ${timeoutMs}ms — retry on a stable connection`),
      );
    }, timeoutMs);
  });
  const raced = Promise.race([task, timeout]);
  return raced.finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

const CONFLICT_RE = /locked|conflict|duplicate|already exists|unique constraint|version mismatch/i;
const TYPED_PREFIX_RE = /^\s*([A-Z][A-Z0-9_]{2,40})\s*[:\-–]\s*/;

/**
 * Maps any thrown/returned failure to a typed `CODE: static detail` string.
 * Already-typed codes (gateway preflight: AUTH_REQUIRED, DB_NOT_PROVISIONED,
 * CREDENTIALS_EXPIRED, UPSTREAM, …) pass through untouched. Raw driver text is
 * NEVER echoed — lock/duplicate shapes become CONFLICT, everything else UPSTREAM
 * (AGENTS.md §2 Rule 9: typed errors, no raw driver errors to the caller).
 */
export function toTypedQueryError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const prefix = TYPED_PREFIX_RE.exec(text)?.[1];
  if (
    prefix === "AUTH_REQUIRED" ||
    prefix === "DB_NOT_PROVISIONED" ||
    prefix === "CREDENTIALS_EXPIRED" ||
    prefix === "NEEDS_PROVISION" ||
    prefix === "VALIDATION" ||
    prefix === "CONFLICT" ||
    prefix === "UPSTREAM" ||
    prefix === "NOT_FOUND"
  ) {
    return text;
  }
  if (CONFLICT_RE.test(text)) {
    return "CONFLICT: record changed elsewhere (locked session or duplicate) — refresh and retry";
  }
  return "UPSTREAM: database request failed — check connection and retry";
}
