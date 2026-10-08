// Implements: 06_Attendance.md §9.2 (session + record upsert in ONE
// transaction), §10.1 BR-ATT-01 (re-mark updates in place), §10.3 BR-ATT-03,
// §10.6 BR-ATT-07 three-tier ladder, §10.7 BR-ATT-06, §11 E9 (lock an empty
// session), §14 + EC-A-01; 12_Business_Rules.md BR-SEC-03 (fail-closed on a
// PIN-gated mutation), BR-SYN-01 (outbox in the same transaction); 06 §6/§9.2
// (materialise the batch a mark belongs to); AGENTS.md §2 Rules 1/7/9 + §7.3
// (never mock the DB).
//
// Runs against a REAL file-backed libSQL DB — only the session seam
// `getAuthenticatedPrisma` is stubbed, exactly like the two sibling attendance
// suites. No mocked ORM.
//
// WHAT THIS ADDS, AND WHICH BUGS IT WOULD HAVE CAUGHT:
//   1. THE MARK IS REVERSIBLE. `present → late → present` must leave the day's
//      records byte-identical to what it started with. This is the invariant the
//      Playwright audit needs in order to prove 06 §18's keyboard contract
//      without leaving the QA tenant dirty — and it is what an E2E spec cannot
//      assert, because a spec can only see the screen, never the row it changed.
//      A write path that soft-deleted the row, inserted a duplicate, or bumped
//      `status` without a matching `sync_outbox` row all pass on screen and fail
//      here (and would desynchronise the moment a second device replayed).
//   2. THERE IS NO UNMARK, and the API says so. `status: null` / `undefined` /
//      `""` / `"unmarked"` are all refused by Zod with nothing written. This is
//      the half of the "a tutor cannot clear a mistake" finding that lives on the
//      server: even a hand-crafted POST cannot express "remove this mark", so the
//      gap is in the CONTRACT, not only in the UI. Pin it here so adding a clear
//      path is a deliberate, spec-amended change.
//   3. THE FIRST MARK MATERIALISES ITS BATCH. `attendance_sessions.batch_id` is
//      NOT NULL, so a batch-less mark resolves to the `batch-default` sentinel —
//      and if that row is not created, `GET /api/v1/attendance/batches` answers
//      `[]` forever while every mark lands in a batch the toolbar cannot show.
//      That is the exact regression that made the batch dimension look dead: the
//      toolbar said "No batches yet — everyone is marked together" over a tenant
//      whose marks were being filed under a batch that did not exist.
//   4. THE PIN LADDER IS FAIL-CLOSED ON A DAY THAT HAS NO SESSION. §11 E9 lets a
//      tutor lock a day before it has any marks (a cancelled class), which means
//      the lock path CREATES a session. The PIN must therefore be verified before
//      that create, or a wrong PIN on an empty day still writes a session row —
//      the one mutation on this screen that nothing in the product can undo.
//      The sibling suite only ever locked a day that already had a session.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { hashPin } from "@/lib/crypto";

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
  lockSessionAction,
  unlockSessionAction,
  updateAttendanceAction,
} from "@/server/actions/attendance";
import { localDayIso, todayIso } from "@/server/attendance-window";

const TENANT = "t-att-restore";
/** This tenant's PIN. Deliberately NOT the QA account's real PIN. */
const PIN = "864209";
/** A well-formed PIN that is not this tenant's — 12 BR-SEC-03's fail-closed case. */
const WRONG_PIN = "246813";

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "att-restore-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4).
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, institute_name TEXT, tenant_secret TEXT, pin_hash TEXT, attendance_lock_hours INTEGER, theme TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, code TEXT, first_name TEXT, last_name TEXT, admission_date TEXT, status TEXT, fee_model TEXT, base_fee_paise INTEGER, balance_paise INTEGER, dup_key TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT CHECK(op IN ('insert','update','soft_delete')), payload TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE attendance_sessions (id TEXT PRIMARY KEY, tenant_id TEXT, batch_id TEXT, session_date TEXT, locked_at TEXT, locked_by TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    // Mirrors apps/gateway/lib/schema.ts: NOT NULL columns and the UNIQUE index
    // that makes BR-ATT-01's in-place re-mark the only possible outcome.
    "CREATE TABLE attendance_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_id TEXT NOT NULL, student_id TEXT NOT NULL, status TEXT DEFAULT 'present', remarks TEXT, marked_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX idx_att_records ON attendance_records (session_id, student_id)",
  );
  await client.execute(
    "CREATE TABLE batches (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, subject TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
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

async function seedStudent(client: Client, id: string): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO students (id, tenant_id, first_name, last_name, status, created_at, updated_at) VALUES (?, ?, 'Rohan', 'Gupta', 'active', ?, ?)",
    args: [id, TENANT, now, now],
  });
}

async function seedPin(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, attendance_lock_hours, created_at, updated_at) VALUES (?, 'Test Institute', 's3cr3t', ?, 48, ?, ?)",
    args: [TENANT, await hashPin(PIN), now, now],
  });
}

/** A session that already carries ONE mark, as a real day mid-way through looks. */
async function seedMarkedSession(
  client: Client,
  id: string,
  sessionDate: string,
  studentId: string,
  status: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, locked_at, locked_by, created_at, updated_at) VALUES (?, ?, 'batch-default', ?, NULL, NULL, ?, ?)",
    args: [id, TENANT, sessionDate, now, now],
  });
  await client.execute({
    sql: "INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, marked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [crypto.randomUUID(), TENANT, id, studentId, status, now, now, now],
  });
}

async function recordsOf(client: Client): Promise<Array<{ student_id: string; status: string }>> {
  const res = await client.execute("SELECT student_id, status FROM attendance_records ORDER BY student_id");
  return res.rows.map((r) => ({ student_id: String(r.student_id), status: String(r.status) }));
}

async function outboxRows(client: Client): Promise<Array<{ table: string; op: string }>> {
  const res = await client.execute("SELECT table_name, op FROM sync_outbox ORDER BY rowid");
  return res.rows.map((r) => ({ table: String(r.table_name), op: String(r.op) }));
}

async function auditActions(client: Client): Promise<string[]> {
  const res = await client.execute("SELECT action FROM audit_log ORDER BY created_at, rowid");
  return res.rows.map((r) => String(r.action));
}

async function countOf(client: Client, table: string): Promise<number> {
  const res = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(res.rows[0]?.n ?? -1);
}

function daysAgoIso(days: number): string {
  const now = new Date();
  return localDayIso(now.getFullYear(), now.getMonth(), now.getDate() - days);
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

describe("06 §18 — a mark is reversible, and the restore is provable from the row", () => {
  it("present → late → present leaves exactly one record carrying the original status", async () => {
    ({ client, dir } = await createTestDb());
    const day = daysAgoIso(1);
    await seedStudent(client, "stu-1");
    await seedMarkedSession(client, "s1", day, "stu-1", "present");
    wireSeam(client);

    const before = await recordsOf(client);
    expect(before).toEqual([{ student_id: "stu-1", status: "present" }]);

    expect(
      (await updateAttendanceAction({
        session_date: day,
        batch_id: "batch-default",
        updates: [{ student_id: "stu-1", status: "late" }],
      })).success,
    ).toBe(true);
    expect(await recordsOf(client)).toEqual([{ student_id: "stu-1", status: "late" }]);

    expect(
      (await updateAttendanceAction({
        session_date: day,
        batch_id: "batch-default",
        updates: [{ student_id: "stu-1", status: "present" }],
      })).success,
    ).toBe(true);

    // BR-ATT-01: the restore is an UPDATE in place. A second row here means the
    // restore is not a restore — the day now reads twice for one student.
    expect(await recordsOf(client)).toEqual(before);
    expect(await countOf(client, "attendance_records")).toBe(1);
    expect(await countOf(client, "attendance_sessions")).toBe(1);
  });

  it("queues a sync_outbox row for BOTH writes, so a second device replays to the restored value", async () => {
    ({ client, dir } = await createTestDb());
    const day = daysAgoIso(1);
    await seedStudent(client, "stu-1");
    await seedMarkedSession(client, "s1", day, "stu-1", "present");
    wireSeam(client);

    await updateAttendanceAction({
      session_date: day,
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "late" }],
    });
    await updateAttendanceAction({
      session_date: day,
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });

    // Rule 7 / BR-SYN-01. Two writes, two outbox rows — the restore that never
    // replicated is a restore that only happened on this device, which is exactly
    // the failure mode the whole sync contract exists to prevent.
    const rows = await outboxRows(client);
    expect(rows.filter((r) => r.table === "attendance_records")).toHaveLength(2);
    for (const row of rows) expect(row.op).toBe("update");
    // An unlocked session writes no `attendance_edit_locked` row: §10.6 Tier 1
    // is free re-marking with no audit beyond the timestamp bump.
    expect(await auditActions(client)).toEqual([]);
  });

  it("rolls BOTH writes back when the outbox write fails, so a restore cannot half-land", async () => {
    ({ client, dir } = await createTestDb());
    const day = daysAgoIso(1);
    await seedStudent(client, "stu-1");
    await seedMarkedSession(client, "s1", day, "stu-1", "present");
    await client.execute("DROP TABLE sync_outbox");
    wireSeam(client);

    const res = await updateAttendanceAction({
      session_date: day,
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "absent" }],
    });
    expect(res.success).toBe(false);
    // The mark is the first statement in the transaction, so a per-row write
    // would leave the student's status changed with no replication row. The
    // original mark must survive the failure untouched.
    expect(await recordsOf(client)).toEqual([{ student_id: "stu-1", status: "present" }]);
  });
});

describe("FINDING PINNED — the API cannot express \"clear this mark\"", () => {
  it("refuses every shape of an absent status and writes nothing (AGENTS §6.1 Zod-first)", async () => {
    ({ client, dir } = await createTestDb());
    const day = daysAgoIso(1);
    await seedStudent(client, "stu-1");
    await seedMarkedSession(client, "s1", day, "stu-1", "present");
    wireSeam(client);
    const before = await recordsOf(client);
    const beforeOutbox = (await outboxRows(client)).length;

    // Every shape a caller might reach for when it wants "no mark". Cast to the
    // enum so the compiler accepts the array literal — the point of the test is
    // what the RUNTIME parser makes of each value, not what the types allow.
    type MarkStatus = "present" | "absent" | "late" | "excused";
    const attempts = [null, undefined, "", "unmarked", "none", "cleared", "PRESENT"] as unknown as MarkStatus[];

    for (const status of attempts) {
      const res = await updateAttendanceAction({
        session_date: day,
        batch_id: "batch-default",
        updates: [{ student_id: "stu-1", status }],
      });
      expect(res.success, `status ${JSON.stringify(status)} must be refused`).toBe(false);
      expect(res.error ?? "").toMatch(/^VALIDATION/);
    }

    expect(await recordsOf(client)).toEqual(before);
    expect((await outboxRows(client)).length).toBe(beforeOutbox);
    expect(await auditActions(client)).toEqual([]);
  });
});

describe("06 §6/§9.2 — the first mark materialises the batch it belongs to", () => {
  it("creates batch-default (not archived) so the batch selector has something to render", async () => {
    ({ client, dir } = await createTestDb());
    const day = daysAgoIso(1);
    await seedStudent(client, "stu-1");
    wireSeam(client);

    // `attendance_sessions.batch_id` is NOT NULL, so a batch-less mark resolves to
    // the `batch-default` sentinel. `GET /api/v1/attendance/batches` reads the
    // `batches` table, so without this row the selector answered `[]` forever
    // while every mark was filed under a batch the tutor could not select.
    const res = await updateAttendanceAction({
      session_date: day,
      batch_id: null,
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    expect(res.success).toBe(true);

    const rows = await client.execute("SELECT id, name, archived_at FROM batches");
    expect(rows.rows).toHaveLength(1);
    expect(String(rows.rows[0].id)).toBe("batch-default");
    // Byte-identical to the gateway's own sentinel name
    // (apps/gateway/routes/attendance.ts DEFAULT_BATCH_NAME) so a tutor sees one
    // label whichever client wrote the mark.
    expect(String(rows.rows[0].name)).toBe("General Batch");
    // Archived rows are filtered OUT of the batches read, so a batch created
    // archived would be invisible — which is the same dead-selector symptom.
    expect(rows.rows[0].archived_at).toBeNull();

    const session = await client.execute("SELECT batch_id FROM attendance_sessions");
    expect(String(session.rows[0].batch_id)).toBe("batch-default");
  });

  it("reuses the existing batch on later marks instead of duplicating it", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    await seedStudent(client, "stu-2");
    wireSeam(client);
    await updateAttendanceAction({
      session_date: daysAgoIso(1),
      batch_id: null,
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    await updateAttendanceAction({
      session_date: daysAgoIso(2),
      batch_id: null,
      updates: [{ student_id: "stu-2", status: "absent" }],
    });
    expect(await countOf(client, "batches")).toBe(1);
  });

  it("marks today's day too — EC-A-01 still refuses a future one", async () => {
    ({ client, dir } = await createTestDb());
    const day = todayIso();
    await seedStudent(client, "stu-1");
    wireSeam(client);
    expect(
      (
        await updateAttendanceAction({
          session_date: day,
          batch_id: "batch-default",
          updates: [{ student_id: "stu-1", status: "present" }],
        })
      ).success,
    ).toBe(true);
    const tomorrow = localDayIso(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate() + 1,
    );
    expect(
      (
        await updateAttendanceAction({
          session_date: tomorrow,
          batch_id: "batch-default",
          updates: [{ student_id: "stu-1", status: "present" }],
        })
      ).success,
    ).toBe(false);
  });
});

describe("06 §10.6 — the PIN ladder is fail-closed (12 BR-SEC-03)", () => {
  it(`refuses ${WRONG_PIN} on a day with NO session and does not create one (06 §11 E9)`, async () => {
    ({ client, dir } = await createTestDb());
    await seedPin(client);
    wireSeam(client);

    // §11 E9: locking an empty session CREATES the session row. So the PIN must
    // be checked before that write, or a wrong PIN on a day nobody has marked
    // still leaves a locked session behind — the one write on this screen that
    // nothing in the product can take back.
    const res = await lockSessionAction("pending", WRONG_PIN, {
      date: daysAgoIso(1),
      batchId: null,
    });
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/VALIDATION.*incorrect/);
    expect(await countOf(client, "attendance_sessions")).toBe(0);
    expect(await countOf(client, "batches")).toBe(0);
    expect(await auditActions(client)).toEqual([]);
    expect(await outboxRows(client)).toEqual([]);
  });

  it(`refuses ${WRONG_PIN} on a locked session, leaving locked_at exactly as it was`, async () => {
    ({ client, dir } = await createTestDb());
    const day = daysAgoIso(1);
    await seedPin(client);
    const now = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, locked_at, locked_by, created_at, updated_at) VALUES ('s1', ?, 'batch-default', ?, ?, ?, ?, ?)",
      args: [TENANT, day, now, TENANT, now, now],
    });
    wireSeam(client);

    const res = await unlockSessionAction("s1", WRONG_PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/VALIDATION.*incorrect/);
    const after = await client.execute("SELECT locked_at FROM attendance_sessions WHERE id = 's1'");
    expect(String(after.rows[0].locked_at)).toBe(now);
    // No window row, no audit row: a refused unlock must leave no trace that
    // could be mistaken for a granted one.
    expect(await auditActions(client)).toEqual([]);
    expect(await outboxRows(client)).toEqual([]);
  });

  it("refuses a malformed PIN with the format message, not an 'incorrect' one", async () => {
    ({ client, dir } = await createTestDb());
    await seedPin(client);
    wireSeam(client);
    const res = await lockSessionAction("pending", "12", { date: daysAgoIso(1), batchId: null });
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/at least 4 digits/);
    // A 3-digit entry is not a wrong PIN, it is an unusable one — the copy must
    // not send the tutor round a loop retyping the same digits.
    expect(res.error ?? "").not.toMatch(/incorrect/);
    expect(await countOf(client, "attendance_sessions")).toBe(0);
  });

  it("refuses when no PIN is configured at all — the ladder never degrades open", async () => {
    ({ client, dir } = await createTestDb());
    const now = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, created_at, updated_at) VALUES (?, 'Test Institute', 's3cr3t', NULL, ?, ?)",
      args: [TENANT, now, now],
    });
    wireSeam(client);
    for (const pin of [WRONG_PIN, PIN]) {
      const res = await lockSessionAction("pending", pin, { date: daysAgoIso(1), batchId: null });
      expect(res.success, `pin ${pin}`).toBe(false);
      expect(res.error ?? "").toMatch(/No PIN configured/);
    }
    expect(await countOf(client, "attendance_sessions")).toBe(0);
  });
});