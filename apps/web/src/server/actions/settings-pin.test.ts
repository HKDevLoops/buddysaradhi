// Implements: 08_Settings.md BR-SEC-02 (mandatory app PIN; change requires
// current-PIN re-verification); 10_Security.md §3 (ladder, argon2id);
// AGENTS.md §2 Rule 7 (outbox+audit in the same transaction) + §7.3
// (mock-free DB: real file-backed libSQL, only the session seam stubbed).
//
// Proves: first-time setup without a current PIN, change with correct
// current PIN (old stops verifying, new verifies), wrong current PIN refuses
// with the hash untouched, bad formats refuse, and status reports presence
// without ever exposing the hash.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { hashPin, verifyPin } from "@/lib/crypto";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return { ...actual, getAuthenticatedPrisma: mocks.getAuthenticatedPrisma };
});
vi.mock("@/lib/logger", () => ({ log: mocks.log }));

import {
  setPinAction,
  verifyPinAction,
  getPinStatusAction,
} from "@/server/actions/settings";

const TENANT = "t-pin-1";

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "pin-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4).
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, institute_name TEXT, tenant_secret TEXT, pin_hash TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT CHECK(op IN ('insert','update','soft_delete')), payload TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  return { client, dir };
}

function wireSeam(client: Client): void {
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(client),
    userId: TENANT,
    tenantId: TENANT,
  });
}

async function pinHashOf(client: Client): Promise<string | null> {
  const res = await client.execute({
    sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
    args: [TENANT],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return (row?.pin_hash as string | null) ?? null;
}

let client: Client;
let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  try {
    if (client) await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  client = undefined as unknown as Client; // SAFETY: reset between tests; recreated per test.
  if (dir) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    dir = undefined as unknown as string; // SAFETY: reset between tests; recreated per test.
  }
});

describe("getPinStatusAction", () => {
  it("reports unconfigured with no settings row and never exposes a hash", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const res = await getPinStatusAction();
    expect(res).toEqual({ success: true, configured: false });
    expect(JSON.stringify(res)).not.toMatch(/argon2|\$2|hash/i);
  });

  it("reports configured once a PIN exists", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    expect(await getPinStatusAction()).toEqual({ success: true, configured: true });
  });
});

describe("setPinAction: setup + change", () => {
  it("sets a first PIN with no current PIN and it verifies", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const res = await setPinAction("135790");
    expect(res.success).toBe(true);
    const stored = await pinHashOf(client);
    expect(stored).toBeTruthy();
    expect(await verifyPin("135790", stored as string)).toBe(true);
    expect(await verifyPin("000000", stored as string)).toBe(false);
  });

  it("changes the PIN with the correct current PIN and retires the old one", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const changed = await setPinAction("246813", "135790");
    expect(changed.success).toBe(true);
    const stored = await pinHashOf(client);
    expect(await verifyPin("246813", stored as string)).toBe(true);
    expect(await verifyPin("135790", stored as string)).toBe(false);
    expect((await verifyPinAction("246813")).success).toBe(true);
  });

  it("refuses a wrong current PIN with the hash untouched", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const before = await pinHashOf(client);
    const res = await setPinAction("246813", "000000");
    expect(res.success).toBe(false);
    expect(await pinHashOf(client)).toBe(before);
  });

  it("refuses bad formats without touching the store", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    for (const bad of ["123", "123456789", "12ab"]) {
      const res = await setPinAction(bad);
      expect(res.success).toBe(false);
    }
    expect(await pinHashOf(client)).toBeNull();
  });

  it("writes outbox + audit rows with the change", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const outbox = await client.execute("SELECT op FROM sync_outbox");
    expect(outbox.rows.map((r) => String((r as Record<string, unknown>).op))).toContain("update");
    const audit = await client.execute("SELECT action FROM audit_log");
    expect(audit.rows.map((r) => String((r as Record<string, unknown>).action))).toContain("pin.update");
  });
});
