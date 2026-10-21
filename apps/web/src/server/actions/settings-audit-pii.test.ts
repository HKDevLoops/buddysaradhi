// Implements: RFC-010 §4.3 (audit metadata names the FIELD, never its VALUE)
// + AGENTS.md §2 Rules 7/9 + §3.4 (no runtime raw SQL in apps/web).
//
// THE DEFECT. `updateSettingAction` wrote `JSON.stringify({ field, value })`
// into `audit_log.metadata`. `value` is the tutor's own instituteEmail, phone
// or address. Audit rows are the ones slated for ADMIN exposure (RFC-010's
// whole point: metadata only, books stay tutor-only), so a table being opened
// up must not already be carrying PII in its free-text column. Accountability
// needs who / when / which-setting — never the value.
//
// WHAT IS PINNED, in order of worth:
//   1. the audit row for a settings write names the field and carries NO
//      value (so `instituteEmail` never appears in `audit_log.metadata`);
//   2. the OUTBOX row still carries the full payload — the replica needs
//      values to apply, so narrowing must NOT have gutted the sync path;
//   3. both rows still land in ONE transaction with one timestamp (Rule 7).
//
// The DB layer is REAL (a file-backed libSQL), only the session seam and the
// network hop are stubbed — same boundary strategy as sql-removal.test.ts
// (AGENTS.md §7.3: never mock the DB).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";

const mocks = vi.hoisted(() => ({
  getAuthenticatedDb: vi.fn(),
  getAuthenticatedPrisma: vi.fn(),
  gatewayPatch: vi.fn(),
  gatewayPost: vi.fn(),
  revalidatePath: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return {
    ...actual,
    getAuthenticatedDb: mocks.getAuthenticatedDb,
    getAuthenticatedPrisma: mocks.getAuthenticatedPrisma,
    gatewayPatch: mocks.gatewayPatch,
    gatewayPost: mocks.gatewayPost,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/logger", () => ({ log: mocks.log }));
// The auth-email mirror hop is a NETWORK seam (Supabase), not a DB seam, so
// stubbing it is legitimate: the assertion is about what lands in the audit
// row, and the settings write itself still runs against the real DB.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: TENANT, email: "old@example.com" } }, error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
    },
  })),
  createSupabaseAdmin: vi.fn(() => ({
    auth: {
      getUserById: vi.fn(async () => ({ data: { user: { id: TENANT, email: "old@example.com" } }, error: null })),
      updateUserById: vi.fn(async () => ({ error: null })),
    },
  })),
}));

import { updateSettingAction } from "@/server/actions/settings";

const TENANT = "t-audit-pii-1";

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "audit-pii-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4).
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, institute_name TEXT, institute_email TEXT, institute_phone TEXT, tenant_secret TEXT, pin_hash TEXT, pin_proof TEXT, theme TEXT, created_at TEXT, updated_at TEXT)",
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
  mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(client),
    userId: TENANT,
    tenantId: TENANT,
  });
  // Gateway unreachable → the local ORM fallback runs, where the outbox and
  // audit writes are observable.
  mocks.gatewayPatch.mockResolvedValue({ success: false, error: "Gateway 503: service unavailable" });
  mocks.gatewayPost.mockResolvedValue({ success: false, error: "Gateway 503: service unavailable" });
}

async function seedSettings(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, institute_name, institute_email, tenant_secret, created_at, updated_at) VALUES (?, 'Old Institute', 'old@example.com', 's3cr3t', ?, ?)",
    args: [TENANT, now, now],
  });
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

describe("RFC-010 §4.3 — audit metadata carries the field, not the value", () => {
  it("the audit row names the field and does NOT carry the value", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);

    const res = await updateSettingAction("instituteEmail", "tutor@example.com");
    expect(res).toMatchObject({ success: true });

    const audit = await client.execute("SELECT metadata FROM audit_log WHERE action = 'settings.update'");
    expect(audit.rows).toHaveLength(1);
    const metadata = String(audit.rows[0]?.metadata ?? "");
    expect(metadata).toContain("instituteEmail");
    // The whole point: the PII must not be in the audit trail.
    expect(metadata).not.toContain("tutor@example.com");
    expect(metadata).not.toContain("value");
  });

  it("no audit row anywhere in the table contains the written value", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);

    await updateSettingAction("instituteEmail", "leaked-value@example.com");

    const all = await client.execute("SELECT metadata FROM audit_log");
    for (const row of all.rows) {
      expect(String(row.metadata ?? "")).not.toContain("leaked-value@example.com");
    }
  });

  it("the outbox row STILL carries the full payload — narrowing must not gut sync", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);

    await updateSettingAction("instituteEmail", "replica@example.com");

    const outbox = await client.execute("SELECT payload FROM sync_outbox WHERE table_name = 'settings'");
    expect(outbox.rows).toHaveLength(1);
    // The replica needs values to apply; only the AUDIT row is narrowed.
    expect(String(outbox.rows[0]?.payload ?? "")).toContain("replica@example.com");
  });

  it("both rows still land in ONE transaction with one timestamp (Rule 7)", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);

    await updateSettingAction("instituteName", "New Institute");

    const stamped = await client.execute(
      "SELECT created_at FROM sync_outbox UNION SELECT created_at FROM audit_log",
    );
    expect(stamped.rows).toHaveLength(1);
    const audit = await client.execute("SELECT action FROM audit_log");
    expect(audit.rows.map((r) => String(r.action))).toEqual(["settings.update"]);
  });
});
