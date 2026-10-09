// Account-erase cascade (10_Security.md §18.1, BR-SEC-03/BR-SEC-04).
//
// This cascade had NO coverage at all, which is how `studentTag.deleteMany({})`
// survived: student_tags is a pure join table with no tenant_id, so the author
// concluded an unfiltered delete was "the only valid form". On a single-tenant
// database that is true; on a shared one it wipes every tutor's tags. The
// predicate is now scoped by the tenant's own student ids.
//
// The tables below carry only `id`/`tenant_id` because the cascade only ever
// issues `deleteMany({ where: { tenantId } })` and one `findMany` selecting
// `id`. student_tags gets its real shape: (student_id, tag_id), no id, no
// tenant_id — which is precisely why it needed the different treatment.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { hashPin } from "@/lib/crypto";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  createSupabaseServer: vi.fn(),
  createSupabaseAdmin: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return { ...actual, getAuthenticatedPrisma: mocks.getAuthenticatedPrisma };
});
vi.mock("@/lib/logger", () => ({ log: mocks.log }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  // Both are overridden: the real createSupabaseAdmin throws on missing env.
  return { ...actual, createSupabaseServer: mocks.createSupabaseServer, createSupabaseAdmin: mocks.createSupabaseAdmin };
});

import { deleteAccountAction } from "@/server/actions/settings";

const TENANT = "t-erase-me";
const OTHER_TENANT = "t-erase-neighbour";
const PIN = "864209";
const WRONG_PIN = "246813";

/**
 * Every table the cascade touches, in the shim's OWN naming
 * (apps/web/src/lib/libsql-proxy.ts:284 tableMap). Only `id`/`tenant_id` are
 * needed because the cascade issues nothing but `deleteMany({ where: { tenantId } })`
 * plus one `findMany` selecting `id`.
 */
const TENANT_TABLES = [
  "ledger_entries",
  "receipts",
  "invoices",
  "fee_schedule_items",
  "fee_plans",
  "attendance_records",
  "attendance_sessions",
  "student_documents",
  "student_notes",
  "tags",
  "student_enrollments",
  "guardians",
  "students",
  "batches",
  "reminders",
  "notifications",
  "backup_manifest",
  "app_state",
  "tutors",
] as const;

let client: Client;
let dir: string;

async function createTestDb(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "erase-"));
  client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4).
  for (const table of TENANT_TABLES) {
    await client.execute(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, tenant_id TEXT)`);
  }
  // The join table, in its real shape.
  await client.execute(
    "CREATE TABLE student_tags (student_id TEXT, tag_id TEXT, PRIMARY KEY (student_id, tag_id))",
  );
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, institute_name TEXT, tenant_secret TEXT, pin_hash TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT, payload TEXT, created_at TEXT)",
  );
}

function wireSeam(): void {
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(client),
    userId: TENANT,
    tenantId: TENANT,
  });
  mocks.createSupabaseServer.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: TENANT } } }) },
  });
  mocks.createSupabaseAdmin.mockResolvedValue({
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  });
}

async function seedPin(): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, created_at, updated_at) VALUES (?, 'Test Institute', 's3cr3t', ?, ?, ?)",
    args: [TENANT, await hashPin(PIN), now, now],
  });
}

/** Two students in each tenant, each carrying one tag link. */
async function seedTwoTenants(): Promise<void> {
  const now = new Date().toISOString();
  for (const [tenant, prefix] of [[TENANT, "mine"], [OTHER_TENANT, "theirs"]] as const) {
    for (const n of [1, 2]) {
      const studentId = `${prefix}-stu-${n}`;
      await client.execute({
        sql: "INSERT INTO students (id, tenant_id) VALUES (?, ?)",
        args: [studentId, tenant],
      });
      await client.execute({
        sql: "INSERT INTO student_tags (student_id, tag_id) VALUES (?, ?)",
        args: [studentId, `${prefix}-tag-${n}`],
      });
    }
    await client.execute({
      sql: "INSERT INTO batches (id, tenant_id) VALUES (?, ?)",
      args: [`${prefix}-batch`, tenant],
    });
    await client.execute({
      sql: "INSERT INTO notifications (id, tenant_id) VALUES (?, ?)",
      args: [`${prefix}-notif`, tenant],
    });
  }
  await client.execute({
    sql: "INSERT INTO audit_log (id, tenant_id, actor, action, created_at) VALUES (?, ?, ?, 'noise', ?)",
    args: [crypto.randomUUID(), OTHER_TENANT, OTHER_TENANT, now],
  });
}

async function countRows(table: string, tenantId?: string): Promise<number> {
  const sql = tenantId
    ? `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`
    : `SELECT COUNT(*) AS n FROM ${table}`;
  const res = await client.execute({ sql, args: tenantId ? [tenantId] : [] });
  return Number(res.rows[0]?.n ?? 0);
}

/** student_tags has no tenant_id, so it is counted through its student prefix. */
async function countTagLinks(prefix: string): Promise<number> {
  const res = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM student_tags WHERE student_id LIKE ?",
    args: [`${prefix}-%`],
  });
  return Number(res.rows[0]?.n ?? 0);
}

async function tagLinkOwners(): Promise<string[]> {
  const res = await client.execute("SELECT student_id FROM student_tags ORDER BY student_id");
  return res.rows.map((r) => String(r.student_id));
}

beforeEach(async () => {
  await createTestDb();
  wireSeam();
  await seedPin();
});

afterEach(async () => {
  vi.clearAllMocks();
  try {
    if (client) await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  client = undefined as unknown as Client; // SAFETY: reset between tests; recreated per test.
  // Temp-dir removal is best-effort and MUST NOT fail a test. The native libSQL
  // driver can hold the file briefly past close() on Windows, and a locked temp
  // directory is not an assertion failure.
  for (let attempt = 0; attempt < 5 && dir; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      dir = "";
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 40));
    }
  }
});

describe("account erase — student_tags is scoped, not blanket-deleted", () => {
  it("leaves the other tenant's tag links in place", async () => {
    await seedTwoTenants();
    expect(await countTagLinks("theirs")).toBe(2);

    const res = await deleteAccountAction(PIN);
    expect(res.success, `${res.error} :: ${JSON.stringify(mocks.log.error.mock.calls)}`).toBe(true);

    // THE regression. `deleteMany({})` would have taken these with it.
    expect(await countTagLinks("theirs")).toBe(2);
    expect(await tagLinkOwners()).toEqual(["theirs-stu-1", "theirs-stu-2"]);
  });

  it("removes this tenant's own tag links", async () => {
    await seedTwoTenants();
    expect(await countTagLinks("mine")).toBe(2);

    await deleteAccountAction(PIN);

    expect(await countTagLinks("mine")).toBe(0);
    expect(await countTagLinks("theirs")).toBe(2);
  });

  it("erases every other table for this tenant and none for the neighbour", async () => {
    await seedTwoTenants();
    const res = await deleteAccountAction(PIN);
    expect(res.success, `${res.error} :: logs=${JSON.stringify(mocks.log.error.mock.calls)}`).toBe(true);

    expect(await countRows("students", TENANT)).toBe(0);
    expect(await countRows("batches", TENANT)).toBe(0);
    expect(await countRows("notifications", TENANT)).toBe(0);

    expect(await countRows("students", OTHER_TENANT)).toBe(2);
    expect(await countRows("batches", OTHER_TENANT)).toBe(1);
    expect(await countRows("notifications", OTHER_TENANT)).toBe(1);
  });

  it("records erase_initiated and erase_complete but destroys no audit history of its own", async () => {
    await seedTwoTenants();
    await deleteAccountAction(PIN);

    const actions = await client.execute(
      "SELECT action FROM audit_log WHERE tenant_id = ? ORDER BY action",
      [TENANT],
    );
    const names = actions.rows.map((r) => String(r.action));
    expect(names).toContain("erase_initiated");
    expect(names).toContain("erase_complete");

    // 10_Security.md §18.1 step 7 — audit rows SURVIVE as the erase record.
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(await countRows("audit_log", OTHER_TENANT)).toBe(1);
  });
});

describe("account erase — the PIN gate holds (BR-SEC-04)", () => {
  it("refuses a wrong PIN and erases nothing", async () => {
    await seedTwoTenants();
    const res = await deleteAccountAction(WRONG_PIN);
    expect(res.success).toBe(false);
    expect(await countRows("students", TENANT)).toBe(2);
    expect(await countRows("students", OTHER_TENANT)).toBe(2);
    expect(await countTagLinks("mine")).toBe(2);
    expect(await countTagLinks("theirs")).toBe(2);
  });

  it("refuses when no PIN is configured at all", async () => {
    await client.execute("DELETE FROM settings");
    const res = await deleteAccountAction(PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/no pin/i);
  });
});