// Implements: 06_Attendance.md §9.2 (session upsert + record upsert in ONE
// transaction), §10.7 BR-ATT-06 (bulk present skips marked / bulk absent
// overwrites, both audited), §11 E1/E9/E10 (empty-session lock, nothing to
// mark), §14 + EC-A-01 (no future dates), §15.2 audit vocabulary; 12_Business
// Rules BR-ATT-01/BR-ATT-02/BR-ATT-12, BR-CALC-06 (excused out of the
// denominator, null on an empty denominator), BR-SYN-01 (outbox in the same
// transaction); AGENTS.md §2 Rules 7/9 + §7.3 (never mock the DB).
//
// Runs against a REAL file-backed libSQL DB (only the session seam
// `getAuthenticatedPrisma` is stubbed) — no mocked ORM, no in-memory fake.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { hashPin } from "@/lib/crypto";
import { BULK_ABSENT_CONFIRM_WORD, isFutureDate, localDayIso, todayIso } from "@/server/attendance-window";

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
  bulkMarkAttendanceAction,
  fetchAttendanceSummaryAction,
  lockSessionAction,
  updateAttendanceAction,
} from "@/server/actions/attendance";
import { attendancePct } from "@/lib/attendance-calc";

const TENANT = "t-att-audit";
const PIN = "123456";

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "att-audit-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4). The UNIQUE index on
  // (session_id, student_id) is the point: BR-ATT-01 requires re-marking to
  // update in place, so a regression to a plain INSERT fails here instead of in
  // a tutor's books.
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
    // Mirrors apps/gateway/lib/schema.ts:287 (the real tenant DDL): NOT NULL
    // columns, and the UNIQUE index that makes BR-ATT-01's in-place re-mark
    // possible at all.
    "CREATE TABLE attendance_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_id TEXT NOT NULL, student_id TEXT NOT NULL, status TEXT DEFAULT 'present', remarks TEXT, marked_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX idx_att_records ON attendance_records (session_id, student_id)",
  );
  await client.execute(
    "CREATE TABLE batches (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, created_at TEXT, updated_at TEXT)",
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

/**
 * Same seam, plus a counter on the libSQL write-transaction entry point. "One
 * transaction per write" (06 §10.7, §17) is a claim about transaction count, so
 * the test counts transactions rather than inferring atomicity from a failure.
 */
function wireSeamCounting(client: Client): () => number {
  let count = 0;
  const counted = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return async (...args: unknown[]) => {
          count += 1;
          // SAFETY: the libsql client's own `transaction` is the real handle;
          // the wrapper only observes the call.
          const fn = Reflect.get(target, prop, receiver) as (
            ...a: unknown[]
          ) => Promise<unknown>;
          return fn.apply(target, args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(counted as unknown as Client),
    userId: TENANT,
    tenantId: TENANT,
  });
  return () => count;
}

async function seedPin(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, created_at, updated_at) VALUES (?, 'Test Institute', 's3cr3t', ?, ?, ?)",
    args: [TENANT, await hashPin(PIN), now, now],
  });
}

async function seedStudent(client: Client, id: string, archived = false): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO students (id, tenant_id, first_name, last_name, status, archived_at, created_at, updated_at) VALUES (?, ?, 'Asha', 'K', 'active', ?, ?, ?)",
    args: [id, TENANT, archived ? now : null, now, now],
  });
}

async function seedSession(client: Client, id: string, sessionDate: string, lockedAt: string | null = null): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, locked_at, locked_by, created_at, updated_at) VALUES (?, ?, 'batch-default', ?, ?, ?, ?, ?)",
    args: [id, TENANT, sessionDate, lockedAt, lockedAt ? TENANT : null, now, now],
  });
}

async function recordsOf(client: Client): Promise<Array<{ student_id: string; status: string }>> {
  const res = await client.execute(
    "SELECT student_id, status FROM attendance_records ORDER BY student_id",
  );
  return res.rows.map((r) => ({
    student_id: String(r.student_id),
    status: String(r.status),
  }));
}

async function auditRows(client: Client): Promise<Array<{ action: string; metadata: string }>> {
  const res = await client.execute("SELECT action, metadata FROM audit_log ORDER BY created_at, rowid");
  return res.rows.map((r) => ({ action: String(r.action), metadata: String(r.metadata) }));
}

async function auditActions(client: Client): Promise<string[]> {
  return (await auditRows(client)).map((r) => r.action);
}

async function outboxCount(client: Client): Promise<number> {
  const res = await client.execute("SELECT COUNT(*) AS n FROM sync_outbox");
  return Number(res.rows[0]?.n ?? 0);
}

function today(): string {
  return todayIso();
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
    // Windows keeps the file handle for a beat after close; retry so a cleanup
    // hiccup cannot mask a real assertion failure.
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

describe("updateAttendanceAction — one transaction per write (06 §9.2, §10.7, Rule 7)", () => {
  it("re-marks the same student in place (BR-ATT-01) instead of inserting a duplicate", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const first = await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    expect(first.success).toBe(true);
    const second = await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "absent" }],
    });
    expect(second.success).toBe(true);
    expect(await recordsOf(client)).toEqual([{ student_id: "stu-1", status: "absent" }]);
  });

  it("creates the session with an outbox row in the same transaction (Rule 7)", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    const res = await client.execute(
      "SELECT table_name, op FROM sync_outbox ORDER BY rowid",
    );
    const rows = res.rows.map((r) => `${String(r.table_name)}:${String(r.op)}`);
    // session INSERT + record upsert. Before this the session create was a bare
    // write outside every transaction and never replicated.
    expect(rows).toContain("attendance_sessions:insert");
    expect(rows).toContain("attendance_records:update");
  });

  it("writes every row of a batch in ONE transaction, not one per row", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    await seedStudent(client, "stu-2");
    await seedStudent(client, "stu-3");
    const txCount = wireSeamCounting(client);
    const res = await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [
        { student_id: "stu-1", status: "present" },
        { student_id: "stu-2", status: "absent" },
        { student_id: "stu-3", status: "late" },
      ],
    });
    expect(res.success).toBe(true);
    expect(await recordsOf(client)).toHaveLength(3);
    // 06 §10.7 "in a single transaction" / §17 "batched SQL in one transaction".
    // The old loop opened one transaction PER ROW, so this was 3.
    expect(txCount()).toBe(1);
  });

  it("rolls the whole batch back when a write inside it fails", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    // Removing the outbox table makes the FIRST record's sync row fail, i.e.
    // mid-transaction. The record write happens before it, so a per-row
    // transaction would leave `stu-1` committed with no replication row — the
    // Rule 7 hole. With one transaction, nothing lands.
    await client.execute("DROP TABLE sync_outbox");
    wireSeam(client);
    const res = await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    expect(res.success).toBe(false);
    expect(await recordsOf(client)).toEqual([]);
    const sessions = await client.execute("SELECT COUNT(*) AS n FROM attendance_sessions");
    expect(Number(sessions.rows[0]?.n ?? -1)).toBe(0);
  });

  it("a payload naming the same student twice writes one record, not two", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const res = await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [
        { student_id: "stu-1", status: "present" },
        { student_id: "stu-1", status: "late" },
      ],
    });
    expect(res.success).toBe(true);
    expect(await recordsOf(client)).toEqual([{ student_id: "stu-1", status: "late" }]);
  });

  it("refuses a malformed payload instead of writing it (AGENTS §6.1 Zod-first)", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const missingStudent = await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      // A server action is an HTTP endpoint: the payload type is erased at
      // runtime, so a client can post anything. Without a parse this wrote a
      // row with no student.
      updates: [{ status: "present" } as unknown as { student_id: string; status: "present" }],
    });
    expect(missingStudent.success).toBe(false);
    const badStatus = await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "maybe" as unknown as "present" }],
    });
    expect(badStatus.success).toBe(false);
    const badDate = await updateAttendanceAction({
      session_date: "12/08/2026",
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    expect(badDate.success).toBe(false);
    const empty = await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [],
    });
    expect(empty.success).toBe(false);
    expect(await recordsOf(client)).toEqual([]);
    expect(await outboxCount(client)).toBe(0);
  });

  it("refuses a future session date (EC-A-01 / §14) and writes nothing", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const tomorrow = localDayIso(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate() + 1,
    );
    const res = await updateAttendanceAction({
      session_date: tomorrow,
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/future date/i);
    expect(await recordsOf(client)).toEqual([]);
    expect(await outboxCount(client)).toBe(0);
  });
});

describe("bulkMarkAttendanceAction — BR-ATT-06 / §10.7 / §15.2", () => {
  it("marks only the unmarked students and leaves individual overrides alone", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    await seedStudent(client, "stu-2");
    wireSeam(client);
    // One student is already marked late by hand.
    await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "late" }],
    });
    const res = await bulkMarkAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      status: "present",
      student_ids: ["stu-1", "stu-2"],
      overwrite: false,
    });
    expect(res.success).toBe(true);
    if (res.success !== true) throw new Error("bulk failed in test");
    expect(res.count_affected).toBe(1);
    expect(res.count_skipped).toBe(1);
    // The tutor's individual `late` wins over the bulk — §10.7 "Already-marked
    // students are not overwritten (the tutor's individual overrides win)".
    expect(await recordsOf(client)).toEqual([
      { student_id: "stu-1", status: "late" },
      { student_id: "stu-2", status: "present" },
    ]);
  });

  it("overwrites every mark for a bulk absent and audits the batch", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    await seedStudent(client, "stu-2");
    wireSeam(client);
    await bulkMarkAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      status: "present",
      student_ids: ["stu-1", "stu-2"],
      overwrite: false,
    });
    await client.execute("DELETE FROM audit_log");
    const res = await bulkMarkAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      status: "absent",
      student_ids: ["stu-1", "stu-2"],
      overwrite: true,
    });
    expect(res.success).toBe(true);
    expect(await recordsOf(client)).toEqual([
      { student_id: "stu-1", status: "absent" },
      { student_id: "stu-2", status: "absent" },
    ]);
    const bulk = (await auditRows(client)).filter((r) => r.action === "attendance_bulk_mark");
    expect(bulk).toHaveLength(1);
    const meta = JSON.parse(bulk[0].metadata) as Record<string, unknown>;
    expect(meta.status).toBe("absent");
    expect(meta.count_affected).toBe(2);
    expect(meta.count_skipped_locked).toBe(0);
    expect(meta.session_date).toBe(today());
    expect(meta.batch_id).toBe("batch-default");
  });

  it("refuses a bulk status outside present/absent", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const res = await bulkMarkAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      status: "late",
      student_ids: ["stu-1"],
      overwrite: true,
    });
    expect(res.success).toBe(false);
    expect(await recordsOf(client)).toEqual([]);
  });

  it("is an honest no-op with nothing in view (§11 E10)", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const res = await bulkMarkAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      status: "present",
      student_ids: [],
      overwrite: false,
    });
    expect(res).toEqual({ success: true, count_affected: 0, count_skipped: 0 });
    expect(await outboxCount(client)).toBe(0);
  });
});

describe("lockSessionAction — §15.2 vocabulary and §11 E9", () => {
  it("writes attendance_lock with batch, date and method", async () => {
    ({ client, dir } = await createTestDb());
    await seedPin(client);
    await seedSession(client, "s1", today());
    wireSeam(client);
    const res = await lockSessionAction("s1", PIN);
    expect(res.success).toBe(true);
    const actions = await auditActions(client);
    // NOT `session_locked` — 06 §15.2 names `attendance_lock`, and a filter on
    // the spec's vocabulary found nothing before.
    expect(actions).toEqual(["attendance_lock"]);
    const meta = JSON.parse((await auditRows(client))[0].metadata) as Record<string, unknown>;
    expect(meta.method).toBe("pin");
    expect(meta.session_date).toBe(today());
    expect(meta.batch_id).toBe("batch-default");
  });

  it("locks an empty session (§11 E9) with the create, lock and audit in one transaction", async () => {
    ({ client, dir } = await createTestDb());
    await seedPin(client);
    wireSeam(client);
    const res = await lockSessionAction("pending", PIN, { date: today(), batchId: null });
    expect(res.success).toBe(true);
    const sessions = await client.execute(
      "SELECT session_date, locked_at FROM attendance_sessions",
    );
    expect(sessions.rows).toHaveLength(1);
    expect(String(sessions.rows[0].session_date)).toBe(today());
    expect(String(sessions.rows[0].locked_at)).not.toBe("null");
    expect(await auditActions(client)).toEqual(["attendance_lock"]);
  });

  it("refuses a wrong PIN and writes nothing", async () => {
    ({ client, dir } = await createTestDb());
    await seedPin(client);
    await seedSession(client, "s1", today());
    wireSeam(client);
    const res = await lockSessionAction("s1", "999999");
    expect(res.success).toBe(false);
    expect(await auditActions(client)).toEqual([]);
    const locked = await client.execute("SELECT locked_at FROM attendance_sessions WHERE id = 's1'");
    expect(String(locked.rows[0].locked_at)).toBe("null");
  });

  it("refuses to lock a future date", async () => {
    ({ client, dir } = await createTestDb());
    await seedPin(client);
    wireSeam(client);
    const tomorrow = localDayIso(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate() + 1,
    );
    const res = await lockSessionAction("pending", PIN, { date: tomorrow, batchId: null });
    expect(res.success).toBe(false);
    const sessions = await client.execute("SELECT COUNT(*) AS n FROM attendance_sessions");
    expect(Number(sessions.rows[0]?.n ?? -1)).toBe(0);
  });
});

describe("attendancePct — BR-CALC-06", () => {
  it("counts late as attended", () => {
    expect(attendancePct({ present: 8, late: 2, absent: 0 })).toBe(100);
    expect(attendancePct({ present: 8, late: 0, absent: 2 })).toBe(80);
  });

  it("excludes excused days by never counting them (the caller does not pass them)", () => {
    // 8 present + 1 excused day and no absence = 100%, not 89%: an excused day
    // is out of the denominator entirely (BR-ATT-02 / BR-CALC-06).
    expect(attendancePct({ present: 8, late: 0, absent: 0 })).toBe(100);
  });

  it("returns null, not 0, when there is nothing to measure", () => {
    expect(attendancePct({ present: 0, late: 0, absent: 0 })).toBeNull();
  });
});

describe("fetchAttendanceSummaryAction — period bounds and the honest percentage", () => {
  it("returns a null percentage and no period rows for an empty period (P15)", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const res = await fetchAttendanceSummaryAction("current_month");
    expect(res.ok).toBe(true);
    if (!res.value) throw new Error("summary failed in test");
    // EC-A-04 / P15: an empty period is an empty state. `0%` here would claim
    // the student attended nothing; BR-CALC-06 says display "—".
    expect(res.value.overall.overall_percentage).toBeNull();
    expect(res.value.summaries[0]?.percentage).toBeNull();
  });

  it("excludes excused days from the denominator and counts late as attended", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    await updateAttendanceAction({
      session_date: today(),
      batch_id: "batch-default",
      updates: [
        { student_id: "stu-1", status: "present" },
        { student_id: "stu-1", status: "late" },
      ],
    });
    // A second mark for the same student in the same session updates in place,
    // so build the mixed history across two sessions instead.
    const yesterday = localDayIso(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate() - 1,
    );
    await updateAttendanceAction({
      session_date: yesterday,
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "excused" }],
    });
    const res = await fetchAttendanceSummaryAction("current_month");
    if (!res.value) throw new Error("summary failed in test");
    // 1 present + 1 late, 0 absent → 100%. Including the excused day in the
    // denominator would have reported 67%.
    expect(res.value.overall.overall_percentage).toBe(100);
    expect(res.value.overall.overall_excused).toBe(1);
  });

  it("bounds last_month by local calendar days, not a UTC round trip", async () => {
    ({ client, dir } = await createTestDb());
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const res = await fetchAttendanceSummaryAction("last_month");
    if (!res.value) throw new Error("summary failed in test");
    const now = new Date();
    expect(res.value.period_start).toBe(localDayIso(now.getFullYear(), now.getMonth() - 1, 1));
    expect(res.value.period_end).toBe(localDayIso(now.getFullYear(), now.getMonth(), 0));
    // The old `new Date(y, m, 1).toISOString()` returned the PREVIOUS day east of
    // UTC, which silently widened every preset by a day at one edge.
    expect(res.value.period_start.endsWith("-01")).toBe(true);
  });

  it("reports a failed read as a failure, not as an empty month (Rule 9)", async () => {
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: {
        student: {
          findMany: async () => {
            throw new Error("connection reset");
          },
        },
      },
      userId: TENANT,
      tenantId: TENANT,
    });
    const res = await fetchAttendanceSummaryAction("current_month");
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toMatch(/connection reset/);
  });
});

describe("date helpers — EC-A-01", () => {
  it("isFutureDate compares whole UTC days", () => {
    expect(isFutureDate("2026-01-02", "2026-01-02T23:00:00.000Z")).toBe(false);
    expect(isFutureDate("2026-01-03", "2026-01-02T23:00:00.000Z")).toBe(true);
    expect(isFutureDate("2026-01-01", "2026-01-02T00:00:00.000Z")).toBe(false);
  });

  it("localDayIso pads and never shifts a local calendar day", () => {
    expect(localDayIso(2026, 0, 5)).toBe("2026-01-05");
    expect(localDayIso(2026, 11, 31)).toBe("2026-12-31");
  });

  it("names one confirm word for the typed bulk-absent gate", () => {
    expect(BULK_ABSENT_CONFIRM_WORD).toBe("ABSENT");
  });
});