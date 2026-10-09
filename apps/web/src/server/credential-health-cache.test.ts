// Implements: web/03_Auth_and_Provisioning.md §8 (failures & recovery);
// 12_Business_Rules.md BR-SEC-08 (audited sensitive transitions);
// AGENTS.md §2 Rule 9 (bounded state must REPORT its bound, never grow silently);
// AGENTS.md §3.6 (the shim contract — the cache bound is part of it).
//
// Defect 1 + defect 4, held down:
//
//   1. The credential-health cache was bounded by `if (size > 500) clear()` —
//      a burst of 501 distinct users wiped every WARM entry, including hot
//      tutors serving live traffic. The bound is now `BoundedCache`
//      (lib/lru.ts, the primitive lib/db.ts already shares), which evicts ONE
//      least-recently-used entry per insert.
//   4. The key is `user.id` from a VERIFIED session (`supabase.auth.getUser()`,
//      the remote's JWT verification — not a cookie decode) and cannot be
//      request-influenced. These tests prove it by construction: two verified
//      sessions produce two independent entries, and a sessionless request
//      produces NO entry at all.
//
// The DB layer is not mocked at the ORM boundary but the probe itself is a
// fixed-cost no-op (`client.execute` resolves), because the property under test
// is the CACHE's behaviour, not libsql's.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  getDb: vi.fn(),
  execute: vi.fn(),
  getDbCredentials: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: vi.fn(async () => ({
    auth: {
      getUser: mocks.getUser,
      getSession: mocks.getSession,
      refreshSession: vi.fn(async () => ({ error: null })),
    },
  })),
}));

vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
  getDbCredentials: mocks.getDbCredentials,
  evictDbClient: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  auditAction: vi.fn(),
}));

type GetDbModule = typeof import("./get-db");

/**
 * Fresh module instance per test. The health cache is MODULE STATE (it must be
 * — that is the whole point of the cache), so a single shared instance would
 * leak entries between tests and make `size` assertions meaningless. There is
 * deliberately no production-only `resetForTests()` export: `vi.resetModules()`
 * + a dynamic import gets a clean instance without putting a test backdoor in
 * the runtime surface.
 */
let mod: GetDbModule;

async function loadGetDb(): Promise<GetDbModule> {
  vi.resetModules();
  mod = await import("./get-db");
  return mod;
}

let probeCount = 0;

function primeSession(userId: string | null): void {
  mocks.getUser.mockImplementation(async () => ({
    data: { user: userId === null ? null : { id: userId, user_metadata: {} } },
  }));
  mocks.getSession.mockImplementation(async () => ({
    data: { session: userId === null ? null : { access_token: `token-${userId}` } },
  }));
}

beforeEach(async () => {
  mod = await loadGetDb();
  vi.clearAllMocks();
  probeCount = 0;
  mocks.getDbCredentials.mockImplementation(() => ({
    dbUrl: "libsql://probe.turso.io",
    dbToken: "probe-token",
  }));
  mocks.getDb.mockImplementation(() => ({
    execute: async () => {
      probeCount += 1;
      return { rows: [{ "1": 1 }] };
    },
  }));
  primeSession(null);
});

describe("credential health cache bound (defect 1)", () => {
  it("stays bounded by the declared ceiling across a burst of distinct tenants", async () => {
    expect(mod.CREDENTIAL_HEALTH_MAX_ENTRIES).toBe(500);

    for (let i = 0; i < mod.CREDENTIAL_HEALTH_MAX_ENTRIES + 25; i += 1) {
      primeSession(`tenant-burst-${i}`);
      await mod.checkCredentialsHealthCached();
    }

    expect(mod.credentialHealthCacheSize()).toBe(mod.CREDENTIAL_HEALTH_MAX_ENTRIES);
  });

  it("a burst evicts the COLDEST entry and never wipes the warm ones", async () => {
    // Two warm tenants: HOT is written first (so it is the coldest), then COLD.
    primeSession("tenant-hot");
    await mod.checkCredentialsHealthCached();
    primeSession("tenant-cold");
    await mod.checkCredentialsHealthCached();
    expect(probeCount).toBe(2);

    // A read of HOT promotes it above COLD, so COLD is now the LRU victim.
    primeSession("tenant-hot");
    await mod.checkCredentialsHealthCached();
    expect(probeCount).toBe(2);

    // The burst the blunt `clear()` used to detonate on: 500 distinct users,
    // each warming HOT again so it stays hot.
    for (let i = 0; i < mod.CREDENTIAL_HEALTH_MAX_ENTRIES; i += 1) {
      primeSession(`tenant-burst-${i}`);
      await mod.checkCredentialsHealthCached();
      primeSession("tenant-hot");
      await mod.checkCredentialsHealthCached();
    }
    const probesAfterBurst = probeCount;

    // HOT survived the whole burst — still cached, so still NO new probe.
    // Under `if (size > 500) clear()` the burst emptied the map and this call
    // would have probed again.
    expect(mod.credentialHealthCacheSize()).toBe(mod.CREDENTIAL_HEALTH_MAX_ENTRIES);
    await mod.checkCredentialsHealthCached();
    expect(probeCount).toBe(probesAfterBurst);

    // COLD was the least-recently-used entry, so it is the one that went —
    // exactly one eviction, not a flush.
    primeSession("tenant-cold");
    await mod.checkCredentialsHealthCached();
    expect(probeCount).toBe(probesAfterBurst + 1);
  });

  it("serves a warm tenant without re-probing (TTL read path promotes, not reloads)", async () => {
    primeSession("tenant-warm");
    await mod.checkCredentialsHealthCached();
    expect(probeCount).toBe(1);

    primeSession("tenant-warm");
    const first = await mod.checkCredentialsHealthCached();
    primeSession("tenant-warm");
    const second = await mod.checkCredentialsHealthCached();

    expect(probeCount).toBe(1);
    expect(first.status).toBe("healthy");
    expect(second.status).toBe("healthy");
  });
});

describe("credential health cache key provenance (defect 4)", () => {
  it("keys on the VERIFIED user id: two sessions are two independent entries", async () => {
    primeSession("tenant-alpha");
    await mod.checkCredentialsHealthCached();
    primeSession("tenant-beta");
    await mod.checkCredentialsHealthCached();

    expect(mod.credentialHealthCacheSize()).toBe(2);

    // Invalidating one tenant cannot reach the other: the key is the uid, not
    // anything a request can set.
    expect(mod.invalidateCredentialHealth("tenant-alpha")).toBe(true);
    expect(mod.credentialHealthCacheSize()).toBe(1);

    primeSession("tenant-beta");
    const before = probeCount;
    await mod.checkCredentialsHealthCached();
    expect(probeCount).toBe(before);
  });

  it("a sessionless request creates NO cache entry (the local-dev tenant is never a key)", async () => {
    primeSession(null);
    const health = await mod.checkCredentialsHealthCached();

    expect(health.skipped).toBe(true);
    expect(mod.credentialHealthCacheSize()).toBe(0);
    expect(probeCount).toBe(0);
  });

  it("mod.invalidateCredentialHealth is a no-op for an unknown or empty id", () => {
    expect(mod.invalidateCredentialHealth("")).toBe(false);
    expect(mod.invalidateCredentialHealth("never-seen")).toBe(false);
    expect(mod.credentialHealthCacheSize()).toBe(0);
  });

  it("sign-out eviction drops the entry so a revoked session is re-probed", async () => {
    primeSession("tenant-revoked");
    await mod.checkCredentialsHealthCached();
    expect(mod.credentialHealthCacheSize()).toBe(1);

    expect(mod.invalidateCredentialHealth("tenant-revoked")).toBe(true);
    expect(mod.credentialHealthCacheSize()).toBe(0);

    await mod.checkCredentialsHealthCached();
    expect(probeCount).toBe(2);
  });
});