// Implements: AGENTS.md §2 Rule 9 (no silent failures — a swallowed error is a
// lie to the tutor) + 10_Security.md §3 (fail-closed on an unverified
// identity) + `.planning/REQUIREMENTS.md` §86 ("dev auth is now opt-in
// (`ALLOW_DEV_AUTH=true`) on BOTH the gateway and web … forgetting the flag
// must fail safe, not open a caller-trusting path").
//
// THE DEFECT (audit AUD-008, P1). `getAuthenticatedDb()` had a local-dev
// branch that returned a USABLE database handle with `tenantId = "local-dev"`
// and NO GATE. Two paths reached it:
//   - a SLOW (5 s timeout) or ERRORED Supabase auth read — both branches
//     return "no user";
//   - an UNAUTHENTICATED caller hitting a server action (server actions are
//     public HTTP endpoints; there is no session check on that path).
// Either way the tutor's payment, receipt, ledger rows and outbox rows were
// written with `tenant_id = 'local-dev'` — NOT into their books — and the
// tutor was told "Payment recorded - RCT-2026-000123". The money was not in
// their books and they believed it was.
//
// The gateway path already refused exactly this (`getGatewayHeaders` throws
// AUTH_REQUIRED unless `ALLOW_DEV_AUTH === "true"`). The direct-DB path was
// the outlier; it is now gated the same way.
//
// Only the SESSION seam is mocked — the DB handle itself is a real libsql
// client construction, and the property under test is the gate, not the DB.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  getDb: vi.fn(),
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

const SAVED = {
  allowDevAuth: process.env.ALLOW_DEV_AUTH,
  dbUrl: process.env.TURSO_DATABASE_URL,
  dbToken: process.env.TURSO_AUTH_TOKEN,
};

beforeEach(() => {
  vi.clearAllMocks();
  // No session at all — the state that used to produce a usable handle.
  mocks.getUser.mockImplementation(async () => ({ data: { user: null } }));
  mocks.getSession.mockImplementation(async () => ({ data: { session: null } }));
  mocks.getDb.mockImplementation(() => ({ execute: async () => ({ rows: [] }) }));
  mocks.getDbCredentials.mockImplementation(() => ({
    dbUrl: "libsql://probe.turso.io",
    dbToken: "probe-token",
  }));
});

afterEach(() => {
  if (SAVED.allowDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH;
  else process.env.ALLOW_DEV_AUTH = SAVED.allowDevAuth;
  if (SAVED.dbUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = SAVED.dbUrl;
  if (SAVED.dbToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
  else process.env.TURSO_AUTH_TOKEN = SAVED.dbToken;
});

/**
 * A fresh module instance per test: `getUserAndSession` is MEMOISED (module
 * state — that is the point of the cache), so a shared instance would leak a
 * sessionless result into the next test. `vi.resetModules()` + a dynamic
 * import gets a clean instance without a test backdoor in the runtime surface.
 */
async function loadGetDb(): Promise<GetDbModule> {
  vi.resetModules();
  return await import("./get-db");
}

describe("AUD-008 — no session means NO database handle, not a local-dev one", () => {
  it("getAuthenticatedDb THROWS when there is no session and dev auth is not enabled", async () => {
    delete process.env.ALLOW_DEV_AUTH;
    const mod = await loadGetDb();

    await expect(mod.getAuthenticatedDb()).rejects.toThrow(/ALLOW_DEV_AUTH/);
    // The whole point: no handle was constructed at all.
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("getAuthenticatedPrisma THROWS too — every direct-DB mutation goes through it", async () => {
    delete process.env.ALLOW_DEV_AUTH;
    const mod = await loadGetDb();

    await expect(mod.getAuthenticatedPrisma()).rejects.toThrow(/ALLOW_DEV_AUTH/);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("the thrown error is the typed AUTH_REQUIRED, not a generic Error", async () => {
    delete process.env.ALLOW_DEV_AUTH;
    const mod = await loadGetDb();

    const err = await mod.getAuthenticatedDb().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    const { parseAuthErrorCode } = await import("./auth-errors");
    expect(parseAuthErrorCode(err)).toBe("AUTH_REQUIRED");
  });

  it("dev auth IS opt-in: with ALLOW_DEV_AUTH=true the local-dev handle comes back", async () => {
    process.env.ALLOW_DEV_AUTH = "true";
    const mod = await loadGetDb();

    const handle = await mod.getAuthenticatedDb();
    expect(handle.tenantId).toBe("local-dev");
    expect(handle.userId).toBe("local-dev");
    expect(mocks.getDb).toHaveBeenCalled();
  });

  it("a real session still works and is bound to the tutor's own id", async () => {
    delete process.env.ALLOW_DEV_AUTH;
    mocks.getUser.mockImplementation(async () => ({
      data: { user: { id: "tenant-real-1", user_metadata: {} } },
    }));
    mocks.getSession.mockImplementation(async () => ({
      data: { session: { access_token: "token-1" } },
    }));
    const mod = await loadGetDb();

    const handle = await mod.getAuthenticatedDb();
    expect(handle.tenantId).toBe("tenant-real-1");
  });
});
