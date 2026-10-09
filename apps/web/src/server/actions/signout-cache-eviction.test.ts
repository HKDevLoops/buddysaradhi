// Implements: web/03_Auth_and_Provisioning.md §6.4 (logout, BR-SEC-04);
// 10_Security.md §8 (logout audited); AGENTS.md §2 Rule 9 (no silent failures).
//
// Defect 2: sign-out evicted the tenant's cached DB HANDLE and nothing else.
// Two in-process caches survived a revoked session, both keyed by the verified
// user id:
//   - server/cache.ts `referenceCache` — the signed-out tutor's settings
//     singleton, batch list and `search:student-candidates` stayed resident for
//     up to DEFAULT_REFERENCE_TTL_MS (63s) after logout;
//   - server/get-db.ts credential health — kept answering "healthy" for a
//     revoked session for up to 60s.
//
// What is asserted here is OBSERVABLE behaviour, not implementation: after
// signOutAction, a read of the same tenant's cached projection runs its loader
// again (the row was dropped), and a read of a DIFFERENT tenant's does not (the
// wipe was scoped, not global). The reference cache is the real
// `server/cache.ts` — only the session/auth seams are stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  evictDbClient: vi.fn(),
  invalidateCredentialHealth: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  auditAction: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [
      { name: "sb-localhost-auth-token", value: "session-access-token" },
      { name: "unrelated", value: "keep-me" },
    ],
    delete: vi.fn(),
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: vi.fn(async () => ({
    auth: { getUser: mocks.getUser, signOut: mocks.signOut },
  })),
}));

vi.mock("@/lib/db", () => ({ evictDbClient: mocks.evictDbClient }));
vi.mock("@/lib/logger", () => ({ log: mocks.log, auditAction: mocks.auditAction }));
// The health cache is module state in get-db.ts; the real one is exercised in
// credential-health-cache.test.ts. Here we assert sign-out CALLS the eviction,
// keyed by the verified uid — and that it is keyed by the uid rather than by
// anything the request supplied.
vi.mock("@/server/get-db", () => ({
  invalidateCredentialHealth: mocks.invalidateCredentialHealth,
}));

import { signOutAction } from "./signout";
import { DEFAULT_REFERENCE_TTL_MS, getCached, invalidateTenant } from "@/server/cache";

const TENANT_A = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const TENANT_B = "22222222-2222-4222-8222-bbbbbbbbbbbb";

function loaderSpy(tag: string): { loader: () => Promise<string>; calls: () => number } {
  let calls = 0;
  return {
    loader: async () => {
      calls += 1;
      return `${tag}-${calls}`;
    },
    calls: () => calls,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  mocks.getUser.mockImplementation(async () => ({
    data: {
      user: {
        id: TENANT_A,
        user_metadata: { db_url: "libsql://tenant-a.turso.io", db_token: "token-a" },
      },
    },
  }));
  mocks.invalidateCredentialHealth.mockReturnValue(true);
  invalidateTenant(TENANT_A);
  invalidateTenant(TENANT_B);
});

describe("signOutAction cache eviction (defect 2)", () => {
  it("drops the signed-out tenant's cached rows: the next read reloads", async () => {
    const settings = loaderSpy("settings-a");
    const batches = loaderSpy("batches-a");
    const candidates = loaderSpy("candidates-a");

    await getCached(TENANT_A, "settings:singleton", settings.loader);
    await getCached(TENANT_A, "attendance:batches", batches.loader);
    await getCached(TENANT_A, "search:student-candidates", candidates.loader);
    // A second warm read proves all three were actually cached (loader counts 1).
    await getCached(TENANT_A, "settings:singleton", settings.loader);
    await getCached(TENANT_A, "attendance:batches", batches.loader);
    await getCached(TENANT_A, "search:student-candidates", candidates.loader);
    expect(settings.calls()).toBe(1);
    expect(batches.calls()).toBe(1);
    expect(candidates.calls()).toBe(1);

    await signOutAction().catch(() => undefined);

    // EVERY prefix is gone — a sign-out that leaves the batch list behind is
    // the same defect as one that leaves the settings row behind.
    expect(await getCached(TENANT_A, "settings:singleton", settings.loader)).toBe("settings-a-2");
    expect(await getCached(TENANT_A, "attendance:batches", batches.loader)).toBe("batches-a-2");
    expect(await getCached(TENANT_A, "search:student-candidates", candidates.loader)).toBe(
      "candidates-a-2",
    );
  });

  it("scopes the wipe to the signed-out tenant: another tutor stays warm", async () => {
    const a = loaderSpy("settings-a");
    const b = loaderSpy("settings-b");
    await getCached(TENANT_A, "settings:singleton", a.loader);
    await getCached(TENANT_B, "settings:singleton", b.loader);

    await signOutAction().catch(() => undefined);

    // B is untouched — a global clear() here would be a cross-tenant outage.
    expect(await getCached(TENANT_B, "settings:singleton", b.loader)).toBe("settings-b-1");
    expect(b.calls()).toBe(1);
    expect(await getCached(TENANT_A, "settings:singleton", a.loader)).toBe("settings-a-2");
  });

  it("evicts the credential-health entry keyed by the VERIFIED user id", async () => {
    await signOutAction().catch(() => undefined);

    expect(mocks.invalidateCredentialHealth).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateCredentialHealth).toHaveBeenCalledWith(TENANT_A);
  });

  it("evicts the DB handle by metadata db_url and revokes the session", async () => {
    await signOutAction().catch(() => undefined);

    expect(mocks.evictDbClient).toHaveBeenCalledWith("libsql://tenant-a.turso.io");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(mocks.auditAction).toHaveBeenCalledWith("logout_completed");
  });

  it("logs the eviction COUNTS, never ids or payloads (Rule 9)", async () => {
    await getCached(TENANT_A, "settings:singleton", async () => "s");
    await getCached(TENANT_A, "attendance:batches", async () => "b");
    await getCached(TENANT_A, "search:student-candidates", async () => "c");

    await signOutAction().catch(() => undefined);

    const eviction = mocks.log.info.mock.calls.find((call) => call[0] === "signout_cache_evicted");
    expect(eviction).toBeDefined();
    const [, , meta] = eviction ?? [];
    expect(meta).toMatchObject({ healthEntriesDropped: 1, referenceEntriesDropped: 3 });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("turso.io");
    expect(serialized).not.toContain("db_url");
  });

  it("a failed auth read still completes the redirect and never half-evicts", async () => {
    // No session cookie for the user lookup: `getUser` rejects. The sign-out
    // must not claim success, must not evict a tenant it could not verify, and
    // must still land on /login.
    mocks.getUser.mockImplementation(async () => {
      throw new Error("network down");
    });

    await signOutAction().catch(() => undefined);

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.invalidateCredentialHealth).not.toHaveBeenCalled();
    expect(mocks.log.error).toHaveBeenCalledWith(
      "signout_supabase_failed",
      expect.any(String),
    );
  });

  it("documents the TTL the wipe is protecting: reference rows are short-lived", () => {
    expect(DEFAULT_REFERENCE_TTL_MS).toBe(63_000);
  });
});