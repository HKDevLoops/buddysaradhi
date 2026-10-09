// Implements: AGENTS.md §3.4 — the libsql connection factory for the gateway.
// Statement helpers live in lib/sql.ts and are re-exported here so existing
// callers (`lib/orm.ts` historically, `lib/schema.ts`, `graphql/resolvers.ts`)
// keep one import site.
import { createClient as createLibsql } from "@libsql/client/web";
import { resolveTursoUrl, resolveToken } from "./sql.ts";

export { allRows, batchExecute, oneRow, run } from "./sql.ts";
export type { SqlHandle } from "./sql.ts";

export type DB = ReturnType<typeof createLibsql>;

/**
 * A Deno Edge isolate is long-lived, so this cache grew for the isolate's whole
 * lifetime: one entry per distinct tenant that ever hit it, each holding an HTTP
 * agent with keep-alive sockets, TLS session state and response buffers. There
 * was no eviction, no TTL and no ceiling, and no signout path (logout never
 * reaches the gateway). The key also mixed in `token.slice(-16)`, so every token
 * rotation minted a SECOND live client for a database already in the map and
 * orphaned the first. Bounded now: one client per database, LRU, replaced in
 * place on rotation.
 */
const MAX_CLIENTS = 64;

interface CacheEntry {
  /** Change-detector for credential rotation. NOT a security control. */
  tokenFingerprint: string;
  client: DB;
}

/** Insertion order is the recency order, so the first key is the coldest. */
const tursoCache = new Map<string, CacheEntry>();

/**
 * FNV-1a, 32-bit. Used only to notice that the token CHANGED so the cached
 * client can be rebuilt; it is not a MAC, not a secret derivation, and the
 * fingerprint is never compared against attacker input.
 */
function fingerprint(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${token.length}`;
}

export function getTurso(dbUrl: string, dbToken: string): DB {
  const targetUrl = resolveTursoUrl(dbUrl);
  const token = resolveToken(dbToken);
  const print = fingerprint(token);

  const existing = tursoCache.get(targetUrl);
  if (existing && existing.tokenFingerprint === print) {
    // Refresh recency: delete+set moves the key to the end of the insertion order.
    tursoCache.delete(targetUrl);
    tursoCache.set(targetUrl, existing);
    return existing.client;
  }

  const client = createLibsql({ url: targetUrl, authToken: token });
  tursoCache.delete(targetUrl);
  tursoCache.set(targetUrl, { tokenFingerprint: print, client });

  while (tursoCache.size > MAX_CLIENTS) {
    const coldest = tursoCache.keys().next();
    if (coldest.done) break;
    tursoCache.delete(coldest.value);
  }

  return client;
}

export function tursoCacheStats(): { size: number; max: number } {
  return { size: tursoCache.size, max: MAX_CLIENTS };
}