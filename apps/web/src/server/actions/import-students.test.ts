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
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, code TEXT, first_name TEXT, last_name TEXT, dob TEXT, gender TEXT, phone TEXT, address TEXT, school TEXT, grade TEXT, board TEXT, admission_date TEXT, status TEXT, fee_model TEXT, base_fee_paise INTEGER, balance_paise INTEGER, dup_key TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
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

/** Fourteen-cell row with valid defaults; override any column by name. */
function fullRow(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    first_name: "Aarav",
    last_name: "Sharma",
    phone: "9876543210",
    gender: "M",
    dob: "2015-04-12",
    address: "21 MG Road, Pune",
    school: "Delhi Public School",
    grade: "10",
    board: "CBSE",
    batch: "Class 10 Maths 6pm",
    admission_date: "2026-06-01",
    fee_model: "postpaid",
    base_fee_rupees: "2000",
    status: "active",
  };
  return HEADERS.map((header) => overrides[header] ?? base[header] ?? "");
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
        fullRow({ base_fee_rupees: "" }),
        fullRow({
          first_name: "Diya",
          last_name: "",
          phone: "9123456789",
          gender: "F",
          dob: "",
          address: "",
          school: "",
          grade: "",
          board: "",
          batch: "Class 9 Science 5pm",
          admission_date: "",
          fee_model: "",
          base_fee_rupees: "",
          status: "",
        }),
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("import failed");
    expect(result.data).toMatchObject({ created: 2, skipped: 0, batchesCreated: 2 });
    expect(result.data.invalid).toEqual([]);

    expect(await tableCount("students")).toBe(2);
    expect(await tableCount("batches")).toBe(2);
    expect(await tableCount("student_enrollments")).toBe(2);

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
        // Manual-flow dup key (add-student-sheet.tsx doCreate recipe): the
        // import must collide with a hand-typed student on the same name+phone.
        dupKey: "aaravsharma3210",
        createdAt: now,
        updatedAt: now,
      },
    });

    const result = await importStudentsAction({
      headers: HEADERS,
      // Same name+phone in different case and spacing, plus one fresh row.
      rows: [
        fullRow({ first_name: "  AARAV ", last_name: "sharma" }),
        fullRow({
          first_name: "Diya",
          last_name: "",
          phone: "9123456789",
          gender: "",
          dob: "",
          batch: "Class 9 Science 5pm",
          admission_date: "",
          fee_model: "",
          base_fee_rupees: "",
          status: "",
        }),
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
      rows: [fullRow({ base_fee_rupees: "" }), fullRow({ base_fee_rupees: "" })],
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
        fullRow({ first_name: "", phone: "not-a-phone", fee_model: "yearly" }),
        fullRow({
          first_name: "Diya",
          last_name: "",
          phone: "9123456789",
          gender: "",
          dob: "",
          batch: "Class 9 Science 5pm",
          admission_date: "",
          fee_model: "",
          base_fee_rupees: "",
          status: "",
        }),
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
    expect(
      result.data.invalid.some((error) => error.column === "fee_model"),
    ).toBe(true);
    expect(await tableCount("students")).toBe(1);
  });

  it("lands every Add Student field with integer-paise money and no ledger rows", async () => {
    const result = await importStudentsAction({
      headers: HEADERS,
      rows: [
        fullRow({
          fee_model: "prepaid",
          base_fee_rupees: "2000.50",
          status: "inactive",
          dob: "12/04/2015",
          admission_date: "44927",
        }),
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("import failed");
    expect(result.data).toMatchObject({ created: 1, skipped: 0, batchesCreated: 1 });
    expect(result.data.invalid).toEqual([]);

    const students = await client.execute(
      "SELECT first_name, last_name, dob, gender, phone, address, school, grade, board, admission_date, status, fee_model, base_fee_paise, balance_paise FROM students",
    );
    expect(students.rows).toHaveLength(1);
    const landed = students.rows[0] as Record<string, unknown>;
    expect(landed).toMatchObject({
      first_name: "Aarav",
      last_name: "Sharma",
      dob: "2015-04-12",
      gender: "M",
      phone: "9876543210",
      address: "21 MG Road, Pune",
      school: "Delhi Public School",
      grade: "10",
      board: "CBSE",
      admission_date: "2023-01-01",
      status: "inactive",
      fee_model: "prepaid",
      // Rule 6: the rupee decimal converts with integer math, never a float.
      base_fee_paise: 200050,
      balance_paise: 0,
    });

    // The enrollment joins on the row's admission date (manual-flow parity).
    const enrollments = await client.execute("SELECT joined_on FROM student_enrollments");
    expect(enrollments.rows).toHaveLength(1);
    expect((enrollments.rows[0] as Record<string, unknown>).joined_on).toBe("2023-01-01");
  });
});
