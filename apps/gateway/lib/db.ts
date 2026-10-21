// Implements: AGENTS.md §3.4 — the libsql connection factory for the gateway.
// Statement helpers live in lib/sql.ts and are re-exported here so existing
// callers (`lib/orm.ts` historically, `lib/schema.ts`, `graphql/resolvers.ts`)
// keep one import site.
import { createClient as createLibsql } from "@libsql/client/web";
import { resolveTenantTarget } from "./db-url-policy.ts";
import { AuthError } from "./auth.ts";
import { logWarn } from "./log.ts";

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
  // GW-07 (AUD-005): the resolution is TOTAL and NON-SUBSTITUTING. The target
  // the request signed is the target the gateway runs against; if the two
  // differ, the request is refused rather than executed against a database
  // (or with a credential) the signature never covered.
  //
  // The refusal is an `AuthError` so `index.ts` renders it as a TYPED 4xx with
  // the `DB_TARGET_MISMATCH` code instead of a generic 500 (Rule 9 — the
  // status must tell the truth: this is a client-side target the gateway
  // will not execute, not an internal fault).
  const decision = resolveTenantTarget(dbUrl, dbToken);
  if (!decision.allowed) {
    // 10_Security.md §8: the log names the VARIABLES, never their values.
    logWarn("security.db_target_refused", {
      requestedVariable: decision.refusal.requestedVariable,
      resolvedVariable: decision.refusal.resolvedVariable,
      reason: decision.refusal.reason,
    });
    throw new AuthError(
      "DB_TARGET_MISMATCH: the database this request named is not the one it " +
        "signed, so the gateway refuses to run it. Nothing was read or written.",
      400,
      "DB_TARGET_MISMATCH",
    );
  }

  const targetUrl = decision.url;
  const token = decision.token;
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