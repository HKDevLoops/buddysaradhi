// Implements: 09_Backup_and_Import_Export.md §6.4 Pipeline D + §14.1 +
// §15.4 (audit action import_students); 12_Business_Rules.md BR-STU-02
// (skip, never merge), BR-STU-04 (code auto-generation), BR-SYN-01 (outbox
// in the same transaction), BR-M-01 (no money path); AGENTS.md §2 Rule 7.
//
// Mock-free at the DB layer (same boundary strategy as
// `server/actions/sql-removal.test.ts` and
// `lib/libsql-proxy.transactions.test.ts`, AGENTS.md §7.3): the session seam
// `getAuthenticatedPrisma` is stubbed, the SQLite file DB behind the real
// `createLibsqlProxy` shim is REAL. Proves:
//   1. every imported student lands its sync_outbox + audit_log rows
//      (Rule 7) with CHECK-valid ops;
//   2. exact duplicates (same name+phone) are skipped and counted;
//   3. financial headers are refused with zero writes;
//   4. invalid rows report row+column+reason while valid rows still commit.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  revalidatePath: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return { ...actual, getAuthenticatedPrisma: mocks.getAuthenticatedPrisma };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/logger", () => ({ log: mocks.log }));

import { importStudentsAction } from "@/server/actions/settings";
import { STUDENT_IMPORT_HEADERS } from "@/lib/csv-parse";

const TENANT = "t-import-1";
const HEADERS = [...STUDENT_IMPORT_HEADERS];

let dir: string;
let client: Client;

async function createTestDb(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "bulk-import-"));
  client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4).
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, code TEXT, first_name TEXT, last_name TEXT, dob TEXT, gender TEXT, phone TEXT, admission_date TEXT, status TEXT, fee_model TEXT, base_fee_paise INTEGER, balance_paise INTEGER, dup_key TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE batches (id TEXT PRIMARY KEY, tenant_id TEXT, tutor_id TEXT, name TEXT, subject TEXT, schedule TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE student_enrollments (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, batch_id TEXT, joined_on TEXT, exited_on TEXT, deleted_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT CHECK(op IN ('insert','update','soft_delete')), payload TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(client),
    userId: TENANT,
    tenantId: TENANT,
  });
}

afterEach(async () => {
  try {
    await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  await createTestDb();
});

function row(cells: string[]): string[] {
  return cells;
}

async function tableCount(table: string): Promise<number> {
  const res = await client.execute(`SELECT COUNT(*) AS c FROM ${table}`);
  return Number((res.rows[0] as Record<string, unknown>)?.c ?? 0);
}

async function outboxOps(): Promise<string[]> {
  const res = await client.execute("SELECT op FROM sync_outbox");
  return res.rows.map((entry) => String((entry as Record<string, unknown>).op));
}

async function auditActions(): Promise<string[]> {
  const res = await client.execute("SELECT action FROM audit_log");
  return res.rows.map((entry) => String((entry as Record<string, unknown>).action));
}

describe("importStudentsAction", () => {
  it("creates students with outbox and audit rows per import", async () => {
    const result = await importStudentsAction({
      headers: HEADERS,
      rows: [
        row(["Aarav", "Sharma", "9876543210", "M", "2015-04-12", "Class 10 Maths 6pm", "active"]),
        row(["Diya", "", "9123456789", "F", "", "", ""]),
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("import failed");
    expect(result.data).toMatchObject({ created: 2, skipped: 0, batchesCreated: 1 });
    expect(result.data.invalid).toEqual([]);

    expect(await tableCount("students")).toBe(2);
    expect(await tableCount("batches")).toBe(1);
    expect(await tableCount("student_enrollments")).toBe(1);

    // Rule 7: every mutation carries its outbox row; every op CHECK-valid.
    const ops = await outboxOps();
    expect(ops.filter((op) => op === "insert")).toHaveLength(ops.length);
    expect(ops.filter((op) => op === "insert").length).toBeGreaterThanOrEqual(2);
    const actions = await auditActions();
    expect(actions.filter((action) => action === "student.create")).toHaveLength(2);
    expect(actions).toContain("import_students");

    // Money never rides an import: balances start at zero paise (Rule 6).
    const balances = await client.execute("SELECT balance_paise, base_fee_paise FROM students");
    for (const entry of balances.rows) {
      const typed = entry as Record<string, unknown>;
      expect(typed.balance_paise).toBe(0);
      expect(typed.base_fee_paise).toBe(0);
    }
  });

  it("skips exact duplicates and counts them, never merging", async () => {
    const db = createLibsqlProxy(client);
    const now = new Date().toISOString();
    await db.student.create({
      data: {
        id: "existing-student",
        tenantId: TENANT,
        code: "S-00000001",
        firstName: "Aarav",
        lastName: "Sharma",
        phone: "9876543210",
        admissionDate: "2026-01-15",
        status: "active",
        feeModel: "postpaid",
        baseFeePaise: 0,
        balancePaise: 0,
        dupKey: "aarav|sharma|9876543210",
        createdAt: now,
        updatedAt: now,
      },
    });

    const result = await importStudentsAction({
      headers: HEADERS,
      // Same name+phone in different case and spacing, plus one fresh row.
      rows: [
        row(["  AARAV ", "sharma", "9876543210", "", "", "", ""]),
        row(["Diya", "", "9123456789", "", "", "", ""]),
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("import failed");
    expect(result.data).toMatchObject({ created: 1, skipped: 1 });
    expect(await tableCount("students")).toBe(2);
  });

  it("skips within-file repeats and counts them", async () => {
    const result = await importStudentsAction({
      headers: HEADERS,
      rows: [
        row(["Aarav", "Sharma", "9876543210", "", "", "", ""]),
        row(["Aarav", "Sharma", "9876543210", "", "", "", ""]),
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("import failed");
    expect(result.data).toMatchObject({ created: 1, skipped: 1 });
    expect(await tableCount("students")).toBe(1);
  });

  it("refuses financial headers with zero writes", async () => {
    const result = await importStudentsAction({
      headers: ["first_name", "amount", "receipt_no"],
      rows: [["Aarav", "100", "R-1"]],
    });
    expect(result).toMatchObject({ success: false, code: "FINANCIAL_HEADERS" });
    expect(await tableCount("students")).toBe(0);
    expect(await tableCount("sync_outbox")).toBe(0);
    expect(await tableCount("audit_log")).toBe(0);
  });

  it("reports invalid rows with row, column, and reason while valid rows commit", async () => {
    const result = await importStudentsAction({
      headers: HEADERS,
      rows: [
        row(["", "", "not-a-phone", "", "", "", ""]),
        row(["Diya", "", "9123456789", "", "", "", ""]),
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("import failed");
    expect(result.data.created).toBe(1);
    expect(result.data.invalid.length).toBeGreaterThan(0);
    // Spreadsheet numbering: header is row 1, the bad row is row 2.
    expect(result.data.invalid[0]?.row).toBe(2);
    expect(typeof result.data.invalid[0]?.column).toBe("string");
    expect(typeof result.data.invalid[0]?.reason).toBe("string");
    expect(await tableCount("students")).toBe(1);
  });
});
