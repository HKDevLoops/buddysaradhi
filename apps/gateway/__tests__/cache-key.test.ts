// Implements: GW-06 (the edge cache key must name the DATABASE), F-23 (the
// key is never echoed).
import { describe, it, expect } from "vitest";
import { cacheKey, dbIdentity } from "../lib/cache-key.ts";

const TENANT = "tenant-gw-06";
const PATH = "/api/v1/students";
const QUERY = "search=Aarav";

function get(): Request {
  return new Request(`https://api.buddysaradhi.app${PATH}?${QUERY}`);
}

describe("GW-06 - the edge cache key names the DATABASE, not only the tenant", () => {
  it("two databases are two cache entries", () => {
    // THE DEFECT: the key was `gw:<tenantId>:<path>:<query>` and the database
    // is a CALLER-SUPPLIED header, so a request naming another database was
    // served the first database's cached rows - one tutor's roster in another
    // database's response.
    const a = cacheKey(get(), PATH, TENANT, "libsql://a.example.turso.io");
    const b = cacheKey(get(), PATH, TENANT, "libsql://b.example.turso.io");
    expect(a).not.toBe(b);
  });

  it("the same database is the same cache entry", () => {
    const url = "libsql://a.example.turso.io";
    expect(cacheKey(get(), PATH, TENANT, url)).toBe(cacheKey(get(), PATH, TENANT, url));
  });

  it("a different path or query is a different entry", () => {
    const url = "libsql://a.example.turso.io";
    const base = cacheKey(get(), PATH, TENANT, url);
    expect(cacheKey(get(), "/api/v1/attendance", TENANT, url)).not.toBe(base);
    expect(
      cacheKey(new Request(`https://api.buddysaradhi.app${PATH}?search=Kabir`), PATH, TENANT, url),
    ).not.toBe(base);
  });

  it("a different tenant is a different entry", () => {
    const url = "libsql://a.example.turso.io";
    expect(cacheKey(get(), PATH, "other-tenant", url)).not.toBe(
      cacheKey(get(), PATH, TENANT, url),
    );
  });

  it("the key never carries the database URL - it carries a digest", () => {
    // The URL holds a credential. F-23: the key is never echoed, and a key
    // that carried the URL would put the credential in every cache entry.
    const url = "libsql://a.example.turso.io?authToken=super-secret";
    const key = cacheKey(get(), PATH, TENANT, url) as string;
    expect(key).not.toContain("super-secret");
    expect(key).not.toContain("libsql://");
    expect(key).toContain(dbIdentity(url));
  });

  it("a non-GET is never cached", () => {
    const url = "libsql://a.example.turso.io";
    const post = new Request(`https://api.buddysaradhi.app${PATH}?${QUERY}`, { method: "POST" });
    expect(cacheKey(post, PATH, TENANT, url)).toBeNull();
  });
});
