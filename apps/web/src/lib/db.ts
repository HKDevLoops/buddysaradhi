import { createClient, type Client } from "@libsql/client";
import { BoundedCache } from "@/lib/lru";
import { createLibsqlProxy, type LibsqlProxy } from "@/lib/libsql-proxy";

// ---------------------------------------------------------------------------
// Per-user cloud DB client cache
// Each tutor has their own Turso DB. Credentials come from Supabase
// user_metadata (db_url + db_token) set by the /api/provision API route.
// Clients are cached in-process by db_url to avoid re-connecting each call.
//
// BOUNDED (docs/plans/TABS-HARDEN-01.md Phase 2). A Next server process is
// long-lived and serves every tenant on the instance, so an unbounded Map here
// grows for the life of the process — the same class of bug as the 1.9 GB
// unignored `deno-lsp` cache under `apps/gateway/.cache/`. Both caches are
// hard-capped by `BoundedCache`; `dbCacheStats()` exposes the live counts so
// the bound is observable rather than asserted in a comment.
//
// WHAT A TENANT LOSES AT THE BOUND: nothing but a cached handle. Eviction drops
// the `Client` and its ORM proxy; the next request for that tenant transparently
// calls `createClient` again and pays one connection setup. No data, session or
// ledger state is affected — the cache holds connection handles only, and every
// handle is reconstructible from `db_url` + `db_token`. The cost is latency on
// the first request after an eviction, never correctness.
// ---------------------------------------------------------------------------

/** Tenants whose DB handle is kept warm per process. */
export const MAX_CACHE_SIZE = 64;

const clientCache = new BoundedCache<string, Client>(MAX_CACHE_SIZE);
// SAFETY of the ordering below: `prismaCache` is declared first so the eviction
// hook below can reference it without touching the temporal dead zone. The hook
// only ever runs from `BoundedCache.set`, which cannot run during module init.
const prismaCache = new BoundedCache<string, LibsqlProxy>(MAX_CACHE_SIZE, (key) => {
  // An ORM proxy holds a live reference to the exact `Client` that wraps its
  // tenant's database. Leaving it cached after its client was evicted would pin
  // that client alive forever while the next `getDb` mints a SECOND client for
  // the same tenant DB — so the Map bound would be true while the real handle
  // count was not. Evicting the proxy with the client is what makes the bound
  // mean what it says.
  prismaCache.delete(key);
});

function normalizeLocalDbUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  let filePath = url.slice("file:".length);
  const cleanPath = filePath.replace(/^\/+/, "").replace(/\\/g, "/");
  return `file:///${cleanPath}`;
}

/**
 * Returns a raw @libsql/client connected to the user's personal Turso cloud DB.
 * Uses the libsql:// URL and auth token from user_metadata.
 *
 * Returns the SAME instance for repeat calls with the same URL and promotes it
 * to most-recently-used, so a tenant serving live traffic is never the one
 * evicted by a burst of one-off tenants.
 */
export function getDb(dbUrl: string, dbToken: string): Client {
  const normalized = normalizeLocalDbUrl(dbUrl);
  const existing = clientCache.get(normalized);
  if (existing) return existing;

  const client = createClient({ url: normalized, authToken: dbToken });
  clientCache.set(normalized, client);
  return client;
}

/**
 * Returns a PrismaClient connected to the user's personal Turso cloud DB.
 *
 * Typed as `LibsqlProxy` rather than `any` (AGENTS.md §6.1 — no `any`): the
 * proxy is the ORM surface the whole app already consumes, so naming its real
 * type is what lets callers keep their own type safety instead of laundering it
 * through an untyped return.
 */
export async function getPrismaClientAsync(dbUrl: string, dbToken: string): Promise<LibsqlProxy> {
  return getPrismaClient(dbUrl, dbToken);
}

export function getPrismaClient(dbUrl: string, dbToken: string): LibsqlProxy {
  // Keyed by the SAME normalized URL as `clientCache`. Keying this map by the
  // raw `dbUrl` while the client map used the normalized form let one database
  // (`file:C:\dev.db` and `file:///C:/dev.db` normalize to the same handle)
  // occupy two entries, and made `evictDbClient` able to delete the client
  // while leaving its proxy behind.
  const normalized = normalizeLocalDbUrl(dbUrl);
  const existing = prismaCache.get(normalized);
  if (existing) return existing;

  const libsql = getDb(dbUrl, dbToken);
  const proxy = createLibsqlProxy(libsql);
  prismaCache.set(normalized, proxy);
  return proxy;
}

/**
 * Drops every cached client and proxy for every tenant.
 *
 * Test-harness counterpart to `evictDbClient`, matching the
 * `resetQueueStorageForTests()` convention in `lib/offline-queue.ts`: the
 * caches are module-level singletons, so a test that asserts the eviction
 * bound needs a known starting size rather than whatever the previous test
 * left behind. Eviction cascades client → proxy via the hook above.
 */
export function clearDbCaches(): void {
  clientCache.clear();
  prismaCache.clear();
}

/**
 * Live entry counts for both bounded caches. Exposed so the bound is a runtime
 * fact an operator can read, not a claim in a comment — mirrors the gateway's
 * `cacheStats()` (apps/gateway/lib/cache.ts).
 */
export function dbCacheStats(): {
  clients: { size: number; max: number };
  proxies: { size: number; max: number };
} {
  return {
    clients: { size: clientCache.size, max: clientCache.max },
    proxies: { size: prismaCache.size, max: prismaCache.max },
  };
}

/**
 * Sentinel value placed in user_metadata when a real DB has not yet been
 * provisioned (legacy/dummy value from the old provision page).
 */
const DUMMY_SENTINELS = ["dummy-local-dev-url", "file:", "dummy"];

function isDummyUrl(url: string): boolean {
  return DUMMY_SENTINELS.some((s) => url.includes(s));
}

/**
 * Extracts db_url + db_token from a Supabase user object.
 *
 * Resolution order:
 *   1. user_metadata.db_url + db_token (real Turso DB, not a dummy placeholder)
 *   2. TURSO_DATABASE_URL + TURSO_AUTH_TOKEN environment variables
 *      (shared DB for dev, staging, or Vercel preview deployments)
 *
 * RFC-003 workstream A (web/03_Auth_and_Provisioning.md §8.3): falling
 * through to env vars while a USER session exists is the silent-wrong-DB
 * class behind the "Could not load student" incident — on Vercel the env
 * vars do not exist (→ opaque failure) or point at the wrong DB. Callers
 * with a session pass `{ allowEnvFallback: false }` in production so a
 * missing/unprovisioned credential throws typed DB_NOT_PROVISIONED instead.
 * The default preserves local-dev ergonomics (no session → env fallback).
 *
 * Throws a typed DB_NOT_PROVISIONED error if no valid credentials are found.
 */
export function getDbCredentials(
  userMetadata: Record<string, unknown> | undefined,
  opts?: { allowEnvFallback?: boolean },
): { dbUrl: string; dbToken: string } {
  const metaUrl = userMetadata?.db_url as string | undefined;
  const metaToken = userMetadata?.db_token as string | undefined;

  // Use user's real Turso DB credentials if they look valid
  if (metaUrl && metaToken && !isDummyUrl(metaUrl)) {
    return { dbUrl: metaUrl, dbToken: metaToken };
  }

  const allowEnvFallback = opts?.allowEnvFallback ?? process.env.NODE_ENV !== "production";
  if (!allowEnvFallback) {
    throw new Error("DB_NOT_PROVISIONED: User database is not yet provisioned.");
  }

  const envUrl = process.env.TURSO_DATABASE_URL;
  const envToken = process.env.TURSO_AUTH_TOKEN;

  if (!envUrl || !envToken) {
    throw new Error("DB_NOT_PROVISIONED: User database is not yet provisioned.");
  }

  return { dbUrl: envUrl, dbToken: envToken };
}

/**
 * Evicts a tenant's cached clients AND its ORM proxy (RFC-003 workstream A,
 * session hygiene). Called by `signOutAction` AFTER the Supabase global revoke
 * so a signed-out tenant's libSQL handle cannot serve a later request from this
 * process.
 *
 * Both maps are keyed by the normalized URL, so one call drops both. The
 * previous version deleted the client by normalized URL and the proxy by the
 * raw one — for any `file:` DB those two strings differ, so a sign-out could
 * remove the handle while leaving the proxy (and its live client reference)
 * resident in the process.
 *
 * Deleting the client cascades to the proxy via the eviction hook above, so
 * there is no silent empty `catch` here (AGENTS.md §2 Rule 9): `Map.delete`
 * cannot throw, and a hypothetical throw must surface rather than be swallowed.
 */
export function evictDbClient(dbUrl: string): void {
  const normalized = normalizeLocalDbUrl(dbUrl);
  prismaCache.delete(normalized);
  clientCache.delete(normalized);
}
