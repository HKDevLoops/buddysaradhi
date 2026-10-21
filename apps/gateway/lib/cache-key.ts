// Implements: GW-06 (the edge cache key must name the DATABASE, not only the
// tenant), and F-23 (the key is never echoed - it names the tenant id and the
// tutor's query string).
//
// WHY THE DATABASE IS IN THE KEY. The database is chosen by a CALLER-SUPPLIED
// header (`x-db-url`), so the same tenant, path and query can name two
// different databases. A key of `gw:<tenantId>:<path>:<query>` gave those two
// requests ONE cache entry: the second was served the first database's rows.
// One tutor's roster can appear in another database's response.
//
// WHY A DIGEST. The URL carries a credential, and the key must never be
// echoed (F-23) - but the identity has to be IN the key for the entry to be
// correct. FNV-1a, run twice with different offsets, so 64 bits, and stable
// across processes (the edge cache is per-isolate, but a key must not depend
// on a random seed).

/**
 * The DATABASE identity, as a short stable digest.
 */
export function dbIdentity(dbUrl: string): string {
  const digest = (seed: number): string => {
    let h = seed >>> 0;
    for (let i = 0; i < dbUrl.length; i++) {
      h ^= dbUrl.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `${digest(0x811c9dc5)}${digest(0x01000193)}`;
}

/**
 * The cache key for a GET, or null for a method that is never cached.
 *
 * The key names the tenant, the DATABASE, the path and the query - in that
 * order, and with the database as a digest rather than a URL.
 */
export function cacheKey(
  req: Request,
  path: string,
  tenantId: string,
  dbUrl: string,
): string | null {
  if (req.method !== "GET") return null;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  return `gw:${tenantId}:${dbIdentity(dbUrl)}:${path}:${qs}`;
}
