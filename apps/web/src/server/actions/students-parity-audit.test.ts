// Implements: 05_Students.md §14 (validation rules), §6.1 (Add Student sheet),
// §10.1 (duplicate key, code), §15 (audited actions); 09_Backup_and_Import_Export.md
// §6.4 step 6 + §14 (import parity); 12_Business_Rules.md BR-STU-01/03/04,
// BR-SYN-01 (outbox in the same transaction), BR-M-01 (integer paise);
// AGENTS.md §2 Rules 1, 6, 7, 9 + §7.3 (never mock the DB).
//
// Mock-free at the DB layer, same boundary strategy as `import-students.test.ts`:
// ONLY the session seam (`getAuthenticatedPrisma`) and the network seam (the three
// `gateway*` helpers) are stubbed. The SQLite file DB behind the real
// `createLibsqlProxy` shim is REAL, and the real `importStudentsAction` is the
// comparison arm.
//
// What these tests exist to hold down, in the order they failed in production:
//
//   1. PARITY. One logical student, typed by hand and pasted as a row, must land
//      IDENTICAL persisted values. They did not: the sheet accepted any phone
//      string and unbounded names, and the two paths built the duplicate key from
//      different four characters.
//   2. THE OFFLINE FALLBACK IS A REAL WRITE. `createStudent` falls back to the
//      direct DB when the gateway is unreachable (Rule 7 / P5), and that fallback
//      used to omit phone, email, dob, gender, address, school, grade and board —
//      silent data loss on the exact path offline-first promises to protect.
//   3. EVERY GATEWAY MUTATION CARRIES AN Idempotency-Key (RFC-004 C1). Without it
//      the gateway answers 400 before touching the database, so create/update/delete
//      never used the gateway at all and delete could never succeed.
//   4. THE BATCH WRITE IS IN THE SAME TRANSACTION (Rule 7) with its own outbox and
//      audit rows; it used to run after the commit with neither.
//   5. "PROCEED ANYWAY" IS AUDITED (05_Students.md §15 `student_duplicate_proceed`).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { STUDENT_IMPORT_HEADERS, studentDupKey, todayIso } from "@/lib/csv-parse";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  gatewayPost: vi.fn(),
  gatewayPatch: vi.fn(),
  gatewayDelete: vi.fn(),
  revalidatePath: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return {
    ...actual,
    getAuthenticatedPrisma: mocks.getAuthenticatedPrisma,
    gatewayPost: mocks.gatewayPost,
    gatewayPatch: mocks.gatewayPatch,
    gatewayDelete: mocks.gatewayDelete,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/logger", () => ({ log: mocks.log }));

import { createStudent, updateStudentAction, deleteStudentAction } from "@/server/actions/students";
import { importStudentsAction } from "@/server/actions/settings";

const TENANT = "t-students-audit";
const HEADERS = [...STUDENT_IMPORT_HEADERS];
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
/** RFC-004 C1 accepts any UUID shape; this is the one the gateway must receive. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let dir: string;
let client: Client;

async function createTestDb(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "students-parity-"));
  client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4).
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, code TEXT, first_name TEXT, last_name TEXT, dob TEXT, gender TEXT, phone TEXT, email TEXT, address TEXT, school TEXT, grade TEXT, board TEXT, admission_date TEXT, status TEXT, fee_model TEXT, base_fee_paise INTEGER, balance_paise INTEGER, dup_key TEXT, merged_into_id TEXT, custom_fields TEXT, notes TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    // `tutor_id` is deliberately **NOT NULL** here, and that is the point.
    //
    // All three schema authorities (`prisma/schema.prisma`,
    // `migrations/0001_init.sql`, `apps/gateway/lib/schema.ts`) declare this
    // column NULLABLE, so the fixture used to declare it nullable too — and
    // that is exactly why `createStudent`'s `tutorId: null` passed every test
    // and then broke the primary flow of the screen in production with
    // `SQLITE_CONSTRAINT: NOT NULL constraint failed: batches.tutor_id` on
    // every tutor whose batch did not already exist.
    //
    // A test fixture must model the shape that exists in the world, not the
    // shape that makes the code pass. Modelling the STRICTER of the two legal
    // shapes means a nullable write now fails loudly here instead of silently
    // in a tutor's hands. The companion assertion below pins the value itself,
    // so this cannot be satisfied by loosening the fixture again.
    "CREATE TABLE batches (id TEXT PRIMARY KEY, tenant_id TEXT, tutor_id TEXT NOT NULL, name TEXT, subject TEXT, schedule TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
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

/** Force the offline-first direct-db fallback: the gateway cannot be reached. */
function gatewayUnreachable(): void {
  mocks.gatewayPost.mockResolvedValue({ success: false, error: "Gateway 400: validation" });
  mocks.gatewayPatch.mockResolvedValue({ success: false, error: "Gateway 400: validation" });
  mocks.gatewayDelete.mockResolvedValue({ success: false, error: "Gateway 400: validation" });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await createTestDb();
  gatewayUnreachable();
});

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

function tableCount(table: string): Promise<number> {
  return client.execute(`SELECT COUNT(*) AS c FROM ${table}`).then((res) =>
    Number((res.rows[0] as Record<string, unknown>)?.c ?? 0),
  );
}

async function studentRow(): Promise<Record<string, unknown>> {
  const res = await client.execute("SELECT * FROM students LIMIT 1");
  return (res.rows[0] as Record<string, unknown>) ?? {};
}

async function auditActions(): Promise<string[]> {
  const res = await client.execute("SELECT action FROM audit_log");
  return res.rows.map((entry) => String((entry as Record<string, unknown>).action));
}

/** The exact payload the Add Student sheet builds for one student. */
function sheetPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: STUDENT_ID,
    tenant_id: "00000000-0000-0000-0000-000000000000",
    first_name: "Aarav",
    last_name: "Sharma",
    dob: "2015-04-12",
    gender: "M",
    phone: "+91 98765-43210",
    email: null,
    address: "21 MG Road, Pune",
    school: "Delhi Public School",
    grade: "10",
    board: "CBSE",
    admission_date: "2026-06-01",
    status: "active",
    fee_model: "postpaid",
    baseFee: "2000.50",
    dup_key: "ignored-by-the-server",
    merged_into_id: null,
    custom_fields: null,
    notes: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** The same student as a fourteen-cell import row. */
function importRow(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    first_name: "Aarav",
    last_name: "Sharma",
    phone: "+91 98765-43210",
    gender: "M",
    dob: "2015-04-12",
    address: "21 MG Road, Pune",
    school: "Delhi Public School",
    grade: "10",
    board: "CBSE",
    batch: "Class 10 Maths 6pm",
    admission_date: "2026-06-01",
    fee_model: "postpaid",
    base_fee_rupees: "2000.50",
    status: "active",
  };
  return HEADERS.map((header) => overrides[header] ?? base[header] ?? "");
}

describe("createStudent — the offline fallback is a real write", () => {
  it("persists every Add Student field, not just the eight it used to keep", async () => {
    const result = await createStudent(sheetPayload(), "Class 10 Maths 6pm");
    expect(result.success).toBe(true);

    const landed = await studentRow();
    expect(landed).toMatchObject({
      tenant_id: TENANT,
      first_name: "Aarav",
      last_name: "Sharma",
      dob: "2015-04-12",
      gender: "M",
      phone: "+919876543210",
      address: "21 MG Road, Pune",
      school: "Delhi Public School",
      grade: "10",
      board: "CBSE",
      admission_date: "2026-06-01",
      status: "active",
      fee_model: "postpaid",
      // Rule 6 / BR-M-01: integer paise from integer math, never a float.
      base_fee_paise: 200050,
      balance_paise: 0,
    });
  });

  it("normalises the phone and computes the duplicate key server-side", async () => {
    await createStudent(sheetPayload(), "Class 10 Maths 6pm");
    const landed = await studentRow();
    // The sheet sends punctuation; 09 §14.5 stores the cleaned form.
    expect(landed.phone).toBe("+919876543210");
    // The client-sent key is IGNORED — the server derives it, so a client that
    // computed it differently cannot write an unmatchable key.
    expect(landed.dup_key).toBe(studentDupKey("Aarav", "Sharma", "+919876543210"));
    expect(landed.dup_key).not.toBe("ignored-by-the-server");
  });

  it("writes the student, its batch and its enrollment with outbox and audit rows", async () => {
    const result = await createStudent(sheetPayload(), "Class 10 Maths 6pm");
    expect(result.success).toBe(true);

    expect(await tableCount("students")).toBe(1);
    expect(await tableCount("batches")).toBe(1);
    expect(await tableCount("student_enrollments")).toBe(1);

    // Rule 7: every mutation has an outbox row, and the enrollment joined on the
    // admission date (not today) so a mid-year admission is not rewritten.
    const outbox = await client.execute("SELECT table_name, row_id FROM sync_outbox");
    const tables = outbox.rows.map((entry) => String((entry as Record<string, unknown>).table_name));
    expect(tables.filter((name) => name === "students")).toHaveLength(1);
    expect(tables.filter((name) => name === "student_enrollments")).toHaveLength(1);
    expect(tables.filter((name) => name === "batches")).toHaveLength(1);
    const enrollment = await client.execute("SELECT joined_on FROM student_enrollments");
    expect((enrollment.rows[0] as Record<string, unknown>).joined_on).toBe("2026-06-01");

    const actions = await auditActions();
    expect(actions.filter((action) => action === "student.create")).toHaveLength(1);
    expect(actions.filter((action) => action === "batch.create")).toHaveLength(1);
  });

  it("gives the auto-created batch a real owner, so it survives a NOT NULL tutor_id", async () => {
    // The reported production failure, verbatim:
    //   `Student not added — SQLITE_CONSTRAINT: SQLite error: NOT NULL
    //    constraint failed: batches.tutor_id`
    // on every add whose batch did not already exist. The fixture's `batches`
    // table now declares `tutor_id NOT NULL` precisely so this cannot regress
    // quietly; this assertion pins the VALUE as well, so loosening the fixture
    // is not a way out.
    const result = await createStudent(sheetPayload(), "Class 10 Maths 6pm");
    expect(result.success, `add failed: ${result.error}`).toBe(true);

    const batch = await client.execute("SELECT tutor_id, tenant_id, name FROM batches");
    expect(batch.rows).toHaveLength(1);
    const row = batch.rows[0] as Record<string, unknown>;
    // 11_Data_Model.md §1 — the tenant IS the tutor, which is why this is the
    // same value `audit_log.actor` carries.
    expect(row.tutor_id).toBe(TENANT);
    expect(row.tenant_id).toBe(TENANT);
    expect(row.name).toBe("Class 10 Maths 6pm");
  });

  it("reuses an existing batch rather than creating a second ownerless one", async () => {
    // A distinct id AND a distinct phone. `sheetPayload()` pins both: the id is the
    // primary key (a repeat collides) and the duplicate key is phone-derived
    // (BR-STU-02 — two adds sharing a number are the SAME student, correctly
    // refused). Neither is what this test is about.
    await createStudent(sheetPayload(), "Class 10 Maths 6pm");
    await createStudent(
      {
        ...sheetPayload(),
        id: "22222222-2222-4222-8222-222222222222",
        first_name: "Kabir",
        phone: "+91 90000-11111",
      },
      "Class 10 Maths 6pm",
    );
    const batches = await client.execute("SELECT tutor_id FROM batches");
    expect(batches.rows).toHaveLength(1);
    expect((batches.rows[0] as Record<string, unknown>).tutor_id).toBe(TENANT);
    // Two students, one shared batch — not two batches.
    expect(await tableCount("students")).toBe(2);
  });

  it("does not write to ledger_entries — an add-student never touches money", async () => {
    await client.execute("CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, student_id TEXT)");
    await createStudent(sheetPayload(), "Class 10 Maths 6pm");
    expect(await tableCount("ledger_entries")).toBe(0);
  });

  it("records student_duplicate_proceed only when the tutor chose add anyway", async () => {
    const first = await createStudent(sheetPayload({ id: "22222222-2222-4222-8222-222222222222" }), "B1");
    expect(first.success).toBe(true);
    expect(await auditActions()).not.toContain("student_duplicate_proceed");

    const second = await createStudent(
      sheetPayload({ id: "33333333-3333-4333-8333-333333333333" }),
      "B1",
      { duplicateProceed: true },
    );
    expect(second.success).toBe(true);
    const actions = await auditActions();
    expect(actions.filter((action) => action === "student_duplicate_proceed")).toHaveLength(1);
    expect(await tableCount("students")).toBe(2);
  });

  it("defaults a blank admission date to today", async () => {
    const result = await createStudent(sheetPayload({ admission_date: "" }), "Class 10 Maths 6pm");
    expect(result.success).toBe(true);
    const landed = await studentRow();
    expect(landed.admission_date).toBe(todayIso());
  });

  it("honours a supplied code and generates one when blank (BR-STU-04)", async () => {
    await createStudent(sheetPayload({ id: "44444444-4444-4444-8444-444444444444", code: "STU-2026-0007" }), "B1");
    expect((await studentRow()).code).toBe("STU-2026-0007");

    await createStudent(sheetPayload({ id: "55555555-5555-4555-8555-555555555555" }), "B1");
    const auto = await client.execute("SELECT code FROM students ORDER BY created_at DESC LIMIT 1");
    const generated = String((auto.rows[0] as Record<string, unknown>).code);
    // KNOWN DIVERGENCE from BR-RC-02's `STU-<YYYY>-<NNNN>` — reported, not
    // silently changed. What is asserted here is the part that must hold today:
    // a code always exists and matches the server's own shape rule.
    expect(generated).toMatch(/^[A-Za-z0-9-]{1,20}$/);
  });
});

describe("createStudent — 05_Students.md §14 validation", () => {
  it("rejects a future admission date and names the field", async () => {
    const result = await createStudent(sheetPayload({ admission_date: "2999-01-01" }), "B1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("admission_date");
    expect(await tableCount("students")).toBe(0);
  });

  it("rejects an admission date before 2000-01-01", async () => {
    const result = await createStudent(sheetPayload({ admission_date: "1999-06-01" }), "B1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("admission_date");
  });

  it("rejects a dob in the future (EC-S-16)", async () => {
    const result = await createStudent(sheetPayload({ dob: "2999-01-01" }), "B1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("dob");
  });

  it("rejects a dob before 1900-01-01", async () => {
    const result = await createStudent(sheetPayload({ dob: "1899-12-31" }), "B1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("dob");
  });

  it("rejects a non-ISO date the Date object would happily parse", async () => {
    // `new Date("12/04/2015")` is a valid Date in Node, which is exactly why the
    // rule is a regex and not a parse.
    const result = await createStudent(sheetPayload({ dob: "12/04/2015" }), "B1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("dob");
  });

  it("rejects a phone that is not 10 to 15 digits and names the field", async () => {
    const result = await createStudent(sheetPayload({ phone: "call me" }), "B1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
    expect(await tableCount("students")).toBe(0);
  });

  it("rejects a name longer than 05_Students.md §14 allows", async () => {
    const result = await createStudent(sheetPayload({ first_name: "a".repeat(81) }), "B1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("first_name");
  });

  it("rejects a negative or non-integer paise amount (Rule 6)", async () => {
    expect((await createStudent(sheetPayload({ baseFeePaise: 1.5 }), "B1")).success).toBe(false);
    expect((await createStudent(sheetPayload({ baseFee: "-100" }), "B1")).success).toBe(false);
    expect((await createStudent(sheetPayload({ baseFee: "100.1234567" }), "B1")).success).toBe(false);
    expect(await tableCount("students")).toBe(0);
  });

  it("rejects a batch name over the cap", async () => {
    const result = await createStudent(sheetPayload(), "x".repeat(121));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Batch");
  });

  it("writes nothing at all when validation fails", async () => {
    await createStudent(sheetPayload({ phone: "nope" }), "B1");
    expect(await tableCount("students")).toBe(0);
    expect(await tableCount("sync_outbox")).toBe(0);
    expect(await tableCount("audit_log")).toBe(0);
    expect(await tableCount("batches")).toBe(0);
  });
});

describe("RFC-004 C1 — every gateway mutation carries an Idempotency-Key", () => {
  it("sends one on create", async () => {
    await createStudent(sheetPayload(), "B1");
    const call = mocks.gatewayPost.mock.calls[0];
    expect(call).toBeDefined();
    const headers = (call?.[2] ?? {}) as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(UUID_SHAPE);
    // The batch name still rides its own header.
    expect(headers["X-Batch-Name"]).toBe("B1");
  });

  it("sends one on update", async () => {
    mocks.gatewayPatch.mockResolvedValue({ success: true, data: {} });
    await createStudent(sheetPayload(), "B1");
    await updateStudentAction(STUDENT_ID, { grade: "11" });
    const headers = (mocks.gatewayPatch.mock.calls[0]?.[2] ?? {}) as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(UUID_SHAPE);
  });

  it("sends one on delete", async () => {
    mocks.gatewayDelete.mockResolvedValue({ success: true, data: { ok: true } });
    const result = await deleteStudentAction(STUDENT_ID);
    expect(result.success).toBe(true);
    const headers = (mocks.gatewayDelete.mock.calls[0]?.[1] ?? {}) as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(UUID_SHAPE);
  });

  it("refuses a non-UUID student id before it reaches the gateway", async () => {
    const result = await deleteStudentAction("not-a-uuid");
    expect(result.success).toBe(false);
    expect(mocks.gatewayDelete).not.toHaveBeenCalled();
  });
});

describe("updateStudentAction", () => {
  it("applies the same caps and phone rule as create", async () => {
    expect((await updateStudentAction(STUDENT_ID, { first_name: "a".repeat(81) })).success).toBe(false);
    expect((await updateStudentAction(STUDENT_ID, { phone: "abc" })).success).toBe(false);
    expect((await updateStudentAction(STUDENT_ID, { admission_date: "2999-01-01" })).success).toBe(false);
  });

  it("normalises the phone on the way through", async () => {
    await createStudent(sheetPayload(), "B1");
    const result = await updateStudentAction(STUDENT_ID, { phone: "(98765) 43210" });
    expect(result.success).toBe(true);
    expect((await studentRow()).phone).toBe("9876543210");
  });
});

describe("IMPORT ↔ MANUAL PARITY — one student through both paths", () => {
  it("persists identical values from the sheet and from a pasted row", async () => {
    // Arm A — the manual form.
    const manual = await createStudent(sheetPayload(), "Class 10 Maths 6pm");
    expect(manual.success).toBe(true);
    const manualRow = await studentRow();

    // Arm B — the same student pasted into the bulk-import grid. The phone
    // differs so the two rows are NOT each other's duplicate (that collision is
    // proved separately, below); every other property is byte-identical.
    const pasted = await importStudentsAction({
      headers: HEADERS,
      rows: [importRow({ phone: "9123456789" })],
    });
    expect(pasted.success).toBe(true);
    if (!pasted.success) throw new Error("import failed");
    expect(pasted.data).toMatchObject({ created: 1, skipped: 0, invalid: [] });

    const imported = await client.execute(
      "SELECT first_name, last_name, phone, gender, dob, address, school, grade, board, admission_date, status, fee_model, base_fee_paise, balance_paise FROM students WHERE id <> ?",
      [STUDENT_ID],
    );
    expect(imported.rows).toHaveLength(1);
    const importRowLanded = imported.rows[0] as Record<string, unknown>;

    // Field by field. Every one of these diverged before this audit.
    const comparable = [
      "first_name",
      "last_name",
      "gender",
      "dob",
      "address",
      "school",
      "grade",
      "board",
      "admission_date",
      "status",
      "fee_model",
      "base_fee_paise",
      "balance_paise",
    ] as const;
    for (const field of comparable) {
      expect({ field, value: importRowLanded[field] }, `field ${field} must match on both paths`).toEqual({
        field,
        value: manualRow[field],
      });
    }
    // Phone: both normalise the punctuation away (09 §14.5), so they differ only
    // because the input differed.
    expect(manualRow.phone).toBe("+919876543210");
    expect(importRowLanded.phone).toBe("9123456789");
    // And the duplicate key each path derived is the shared formula's output.
    expect(manualRow.dup_key).toBe("aaravsharma3210");
    expect(importRowLanded.dup_key).toBeUndefined();
    const keys = await client.execute("SELECT dup_key FROM students");
    expect(keys.rows.map((entry) => String((entry as Record<string, unknown>).dup_key))).toEqual([
      "aaravsharma3210",
      "aaravsharma6789",
    ]);
  });

  it("collides on the same name and phone however each path is written", async () => {
    // Typed with a trailing space and a dash; pasted with a +91 prefix and a
    // space. Both must land on one key, so the import skips it rather than
    // creating a second Aarav.
    await createStudent(sheetPayload({ phone: "98765-43210 " }), "B1");
    const result = await importStudentsAction({
      headers: HEADERS,
      rows: [importRow({ phone: "+91 98765 43210" })],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("import failed");
    expect(result.data).toMatchObject({ created: 0, skipped: 1 });
    expect(await tableCount("students")).toBe(1);
  });

  it("rejects the same invalid value on both paths", async () => {
    // A phone the sheet used to accept and store.
    const manual = await createStudent(sheetPayload({ phone: "not a phone" }), "B1");
    expect(manual.success).toBe(false);
    const pasted = await importStudentsAction({ headers: HEADERS, rows: [importRow({ phone: "not a phone" })] });
    expect(pasted.success).toBe(true);
    if (!pasted.success) throw new Error("import failed");
    expect(pasted.data.created).toBe(0);
    expect(pasted.data.invalid.some((error) => error.column === "phone")).toBe(true);
    expect(await tableCount("students")).toBe(0);
  });

  it("rejects a future admission date on both paths", async () => {
    const manual = await createStudent(sheetPayload({ admission_date: "01/01/2999" }), "B1");
    expect(manual.success).toBe(false);
    const pasted = await importStudentsAction({
      headers: HEADERS,
      rows: [importRow({ admission_date: "01/01/2999" })],
    });
    expect(pasted.success).toBe(true);
    if (!pasted.success) throw new Error("import failed");
    expect(pasted.data.created).toBe(0);
    expect(pasted.data.invalid.some((error) => error.column === "admission_date")).toBe(true);
    expect(await tableCount("students")).toBe(0);
  });

  it("refuses a financial-header file outright, with no partial apply", async () => {
    // A `balance_due` column makes it financial data, and the refusal names THAT
    // rather than a generic header mismatch — a tutor who pasted their fee sheet
    // is told what was wrong with it.
    const result = await importStudentsAction({
      headers: [...HEADERS, "balance_due"],
      rows: [[...importRow(), "4500"]],
    });
    expect(result).toMatchObject({ success: false, code: "FINANCIAL_HEADERS" });
    expect(await tableCount("students")).toBe(0);
    expect(await tableCount("sync_outbox")).toBe(0);
  });
});
