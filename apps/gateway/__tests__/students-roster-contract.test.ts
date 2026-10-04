// Implements: 05_Students.md §Roster — a roster control the tutor can see must be
// a control the server honours. Runs the REAL `handleStudents` and the REAL
// `createPrismaOrm` against in-memory SQLite carrying the gateway's own DDL
// (AGENTS.md §7.3 — never mock the DB; a mock cannot tell you whether the
// orderBy allowlist rejected an injection attempt or SQLite accepted a bad
// column).
//
// Every expected value below is a worked-example literal read off the fixture
// table, never recomputed with the same expression the code under test uses.
import { describe, expect, it, beforeEach } from "vitest";
import { handleStudents } from "../routes/students.ts";
import { createPrismaOrm, OrderByNotAllowedError } from "../lib/orm.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000b2";

const BATCH_ALPHA = "018f0000-0000-7000-8000-00000000c001";
const BATCH_BETA = "018f0000-0000-7000-8000-00000000c002";

interface ApiBody {
  success: boolean;
  data?: { students: RosterRow[]; total: number };
  error?: string;
  details?: string;
}

interface RosterRow {
  id: string;
  code: string | null;
  name: string;
  grade: string | null;
  fee_model: string;
  balance_due: number;
  status: string;
}

interface Fixture {
  db: SqliteGatewayDb;
}

/** Worked example — codes are unique, so a code-sorted expectation is a total
 *  order and can be asserted element-for-element. Balances are NOT unique, so
 *  balance-sorted assertions only pin the distinct prefix (see below). */
const SEED: Array<{
  code: string;
  first: string;
  last: string;
  status: string;
  feeModel: string;
  balance: number;
  admission: string;
  grade: string;
  batch: string | null;
}> = [
  { code: "S-100", first: "Aarav", last: "Sharma", status: "active", feeModel: "postpaid", balance: 500000, admission: "2026-01-04", grade: "9", batch: BATCH_ALPHA },
  { code: "S-050", first: "Kabir", last: "Menon", status: "active", feeModel: "prepaid", balance: 0, admission: "2026-02-01", grade: "10", batch: BATCH_BETA },
  { code: "S-075", first: "Diya", last: "Nair", status: "active", feeModel: "prepaid", balance: 250000, admission: "2026-01-20", grade: "9", batch: BATCH_ALPHA },
  { code: "S-010", first: "Ishita", last: "Rao", status: "inactive", feeModel: "postpaid", balance: 0, admission: "2026-03-05", grade: "11", batch: null },
  { code: "S-200", first: "Vivaan", last: "Bose", status: "active", feeModel: "mixed", balance: 100000, admission: "2026-01-11", grade: "10", batch: null },
  { code: "S-025", first: "Neha", last: "Gill", status: "active", feeModel: "postpaid", balance: 750000, admission: "2026-02-20", grade: "9", batch: BATCH_BETA },
];

/** Seeded student ids keyed by student code, populated by `seed` so the invoice
 *  rows satisfy the `invoices.student_id REFERENCES students(id)` FK without a
 *  hand-copied literal that can drift. */
const SEEDED_ID_BY_CODE: Record<string, string> = {};

function seed(f: Fixture): void {
  const now = "2026-01-01T00:00:00.000Z";
  const insStudent = f.db.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, fee_model,
                           balance_paise, admission_date, grade, dup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insBatch = f.db.raw.prepare(
    `INSERT INTO batches (id, tenant_id, name, subject, created_at, updated_at)
     VALUES (?, ?, ?, 'General', ?, ?)`,
  );
  const insEnrollment = f.db.raw.prepare(
    `INSERT INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  insBatch.run(BATCH_ALPHA, TENANT, "Alpha", now, now);
  insBatch.run(BATCH_BETA, TENANT, "Beta", now, now);

let n = 0;
  for (const s of SEED) {
    n += 1;
    const id = `018f0000-0000-7000-8000-0000000000d${String(n).padStart(3, "0")}`;
    // Recorded so the invoice rows below can reference real students instead of
    // a hand-copied id that drifts the moment the seed changes (FK constraint).
    SEEDED_ID_BY_CODE[s.code] = id;
    insStudent.run(id, TENANT, s.code, s.first, s.last, s.status, s.feeModel, s.balance, s.admission, s.grade, s.code, now, now);
    if (s.batch) {
      insEnrollment.run(`018f0000-0000-7000-8000-0000000000e${String(n).padStart(3, "0")}`, TENANT, id, s.batch, s.admission, now, now);
    }
  }

  // A second tenant's student: proves every roster read is tenant-scoped and
  // that a filter never leaks across tenants.
  insStudent.run(
    "018f0000-0000-7000-8000-00000000d999", OTHER_TENANT, "X-999", "Outsider",
    "Tenant", "active", "postpaid", 999999, "2026-01-01", "9", "X-999", now, now,
  );

  // notifications + attendance_sessions rows. Their sql.ts sort allowlists used
  // to name columns that did not exist (`read`, `batch_name`); the gate now
  // names the real columns (`read_at`, `batch_id` — lib/schema.ts:268, :277) and
  // is asserted against the live DDL in `sql-range-operators.test.ts`.
  const insNotif = f.db.raw.prepare(
    `INSERT INTO notifications (id, tenant_id, category, title, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insNotif.run("018f0000-0000-7000-8000-00000000f001", TENANT, "fee_due", "Fee due for Aarav", null, "2026-03-01T00:00:00.000Z");
  insNotif.run("018f0000-0000-7000-8000-00000000f002", TENANT, "reminder", "Class starts soon", null, "2026-01-01T00:00:00.000Z");
  insNotif.run("018f0000-0000-7000-8000-00000000f003", TENANT, "reminder", "Class starts later", "2026-02-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z");

  const insSession = f.db.raw.prepare(
    `INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insSession.run("018f0000-0000-7000-8000-00000000a002", TENANT, BATCH_ALPHA, "2026-02-10", now, now);
  insSession.run("018f0000-0000-7000-8000-8000-00000000a001", TENANT, BATCH_ALPHA, "2026-01-10", now, now);

  // Invoices for the `overdue_only` roster filter. "Overdue" is a property of an
  // INVOICE (`due_date < today` AND an unsettled status), not of a student, so
  // the route resolves overdue student ids in one audited read and intersects
  // them on students.id. One row of each shape, so the filter has to pick.
  // due_date is computed from `today` so the test never rots with the calendar.
  const today = new Date();
  const iso = (offsetDays: number): string => {
    const d = new Date(today.getTime() + offsetDays * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  const insInvoice = f.db.raw.prepare(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                           subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 100000, 0, 0, 100000, ?, 'hash', ?, ?)`,
  );
  const S100 = SEEDED_ID_BY_CODE["S-100"]; // 500000 due, Alpha, unpaid+past due
  const S075 = SEEDED_ID_BY_CODE["S-075"]; // 250000 due, Alpha, partial+past due
  const S200 = SEEDED_ID_BY_CODE["S-200"]; // 100000 due, no batch, PAID+past due
  // Past due and unpaid → overdue.
  insInvoice.run("018f0000-0000-7000-8000-00000000c101", TENANT, "INV-1", S100, iso(-40), iso(-10), "unpaid", now, now);
  // Past due and PARTIALLY paid → still overdue (10_Security.md: a tutor chasing
  // a balance must still see the student who owes the remainder).
  insInvoice.run("018f0000-0000-7000-8000-00000000c102", TENANT, "INV-2", S075, iso(-40), iso(-5), "partial", now, now);
  // Past due but PAID → not overdue.
  insInvoice.run("018f0000-0000-7000-8000-00000000c103", TENANT, "INV-3", S200, iso(-40), iso(-1), "paid", now, now);
  // Not yet due and unpaid → not overdue.
  insInvoice.run("018f0000-0000-7000-8000-00000000c104", TENANT, "INV-4", S100, iso(-1), iso(20), "unpaid", now, now);
}

async function get(
  f: Fixture,
  query: string,
  tenantId = TENANT,
): Promise<{ status: number; body: ApiBody }> {
  const path = "/api/v1/students";
  const url = new URL(`https://api.buddysaradhi.app${path}${query ? `?${query}` : ""}`);
  const res = await handleStudents(
    new Request(url, { method: "GET" }),
    // SAFETY: SqliteGatewayDb satisfies `SqlHandle`, the only capability the
    // route uses; `DB` is the libsql client marker it structurally replaces.
    f.db as unknown as DB,
    tenantId,
    path,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${path}${query}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function codes(body: ApiBody): (string | null)[] {
  return (body.data?.students ?? []).map((s) => s.code);
}

let f: Fixture;

beforeEach(() => {
  f = { db: new SqliteGatewayDb() };
  seed(f);
  invalidateTenant(TENANT);
  invalidateTenant(OTHER_TENANT);
});

describe("roster sort — the control is real", () => {
  it("defaults to name ascending: Aarav, Diya, Ishita, Kabir, Neha, Vivaan", async () => {
    const { status, body } = await get(f, "");
    expect(status).toBe(200);
    expect(codes(body)).toEqual(["S-100", "S-075", "S-010", "S-050", "S-025", "S-200"]);
    expect(body.data?.total).toBe(6);
  });

  it("sortCol=code&sortDir=asc orders by the code column", async () => {
    const { body } = await get(f, "sortCol=code&sortDir=asc");
    expect(codes(body)).toEqual(["S-010", "S-025", "S-050", "S-075", "S-100", "S-200"]);
  });

  it("sortCol=code&sortDir=desc reverses the code column", async () => {
    const { body } = await get(f, "sortCol=code&sortDir=desc");
    expect(codes(body)).toEqual(["S-200", "S-100", "S-075", "S-050", "S-025", "S-010"]);
  });

  it("sortCol=balance&sortDir=desc puts the largest balance first", async () => {
    const rows = (await get(f, "sortCol=balance&sortDir=desc")).body.data?.students ?? [];
    // Balances are not unique (two students are at 0), so only the distinct
    // prefix is a contract; the tie order is deliberately NOT asserted.
    expect(rows.slice(0, 4).map((s) => [s.code, s.balance_due])).toEqual([
      ["S-025", 750000],
      ["S-100", 500000],
      ["S-075", 250000],
      ["S-200", 100000],
    ]);
    expect(rows.slice(4).map((s) => s.balance_due)).toEqual([0, 0]);
  });

  it("sortCol=joined orders by admission_date", async () => {
    const rows = (await get(f, "sortCol=joined&sortDir=asc")).body.data?.students ?? [];
    expect(rows.slice(0, 3).map((s) => s.code)).toEqual(["S-100", "S-200", "S-075"]);
  });

  it("sorting does not change `total`", async () => {
    expect((await get(f, "sortCol=code&sortDir=desc")).body.data?.total).toBe(6);
  });

  it("an unknown sortCol is a 400 naming the field and the supported set", async () => {
    const { status, body } = await get(f, "sortCol=drop_table&sortDir=asc");
    expect(status).toBe(400);
    expect(body.error).toBe("VALIDATION");
    expect(body.details).toContain("sortCol=drop_table");
    expect(body.details).toContain("Supported: name, code, balance, grade, status, joined, created");
  });

  it("an unknown sortDir is a 400 naming the field", async () => {
    const { status, body } = await get(f, "sortCol=code&sortDir=sideways");
    expect(status).toBe(400);
    expect(body.error).toBe("VALIDATION");
    expect(body.details).toContain("sortDir=sideways");
    expect(body.details).toContain("asc, desc");
  });
});

describe("roster filters — honoured or rejected, never dropped", () => {
  it("status=inactive narrows the roster to the one inactive student", async () => {
    const { body } = await get(f, "status=inactive");
    expect(codes(body)).toEqual(["S-010"]);
    expect(body.data?.total).toBe(1);
  });

  it("an unknown status is a 400 naming the field", async () => {
    const { status, body } = await get(f, "status=enrolled");
    expect(status).toBe(400);
    expect(body.details).toContain("status=enrolled");
  });

  it("feeModels=prepaid returns only prepaid students and counts only them", async () => {
    const { body } = await get(f, "feeModels=prepaid");
    expect(codes(body)).toEqual(["S-075", "S-050"]);
    expect(body.data?.total).toBe(2);
  });

  it("feeModels with two values returns the union", async () => {
    const { body } = await get(f, "feeModels=prepaid,mixed");
    expect(codes(body)).toEqual(["S-075", "S-050", "S-200"]);
    expect(body.data?.total).toBe(3);
  });

  it("an unknown feeModels value is a 400 naming the field", async () => {
    const { status, body } = await get(f, "feeModels=monthly");
    expect(status).toBe(400);
    expect(body.details).toContain("feeModels=monthly");
  });

  it("batchIds returns only students enrolled in that batch", async () => {
    const { body } = await get(f, `batchIds=${BATCH_ALPHA}`);
    expect(codes(body)).toEqual(["S-100", "S-075"]);
    expect(body.data?.total).toBe(2);
  });

  it("a batch with no enrolments returns zero rows and total 0 (not the whole roster)", async () => {
    const { body } = await get(f, "batchIds=018f0000-0000-7000-8000-00000000c0ff");
    expect(codes(body)).toEqual([]);
    expect(body.data?.total).toBe(0);
  });

  it("balanceRange=zero returns only students at zero balance, in the requested sort", async () => {
    const { body } = await get(f, "balanceRange=zero");
    expect(codes(body)).toEqual(["S-010", "S-050"]);
    expect(body.data?.total).toBe(2);
  });

  it("balanceRange=has_dues narrows to students with a positive balance", async () => {
    const { status, body } = await get(f, "balanceRange=has_dues");
    expect(status).toBe(200);
    // Default sort is first_name asc: Aarav, Diya, Neha, Vivaan. S-025 (Neha)
    // carries 750000 — the largest balance in the seed — and is not forgotten.
    expect(codes(body)).toEqual(["S-100", "S-075", "S-025", "S-200"]);
    expect(body.data?.total).toBe(4);
  });

  it("balanceRange=overdue_only resolves overdue INVOICES, not merely a positive balance", async () => {
    // The distinction this test exists for: S-025 and S-200 also have a positive
    // balance, so an implementation that aliased overdue_only to has_dues would
    // return four rows instead of two — and a tutor chasing a missed due date
    // would see a student whose invoice is fully paid, and one with no invoice
    // at all.
    const { body } = await get(f, "balanceRange=overdue_only");
    expect(codes(body)).toEqual(["S-100", "S-075"]); // default sort: first_name asc
    expect(body.data?.total).toBe(2);
  });

  it("overdue_only excludes a past-due invoice that is already paid", async () => {
    const { body } = await get(f, "balanceRange=overdue_only&sortCol=code&sortDir=asc");
    expect(codes(body)).toEqual(["S-075", "S-100"]);
    expect(codes(body)).not.toContain("S-200"); // past due but PAID
    expect(codes(body)).not.toContain("S-025"); // has dues, but no invoice
  });

  it("an unknown balanceRange is a 400 naming the field and the supported set", async () => {
    const { status, body } = await get(f, "balanceRange=negative");
    expect(status).toBe(400);
    expect(body.error).toBe("VALIDATION");
    expect(body.details).toContain("balanceRange=negative");
    expect(body.details).toContain("all, zero, has_dues, overdue_only");
  });

  it("admittedInLast=7d excludes every student admitted longer ago than 7 days", async () => {
    // Every seeded admission_date is in Jan 2026, so a 7-day window is empty at
    // any plausible test-run date — and stays empty forever, unlike a positive
    // window assertion would.
    const { body } = await get(f, "admittedInLast=7d");
    expect(codes(body)).toEqual([]);
    expect(body.data?.total).toBe(0);
  });

  it("admittedInLast=all is unchanged — the default still returns the whole roster", async () => {
    const { body } = await get(f, "admittedInLast=all");
    expect(body.data?.total).toBe(6);
  });

  it("an unknown admittedInLast is a 400 naming the field and the supported set", async () => {
    const { status, body } = await get(f, "admittedInLast=last-tuesday");
    expect(status).toBe(400);
    expect(body.error).toBe("VALIDATION");
    expect(body.details).toContain("admittedInLast=last-tuesday");
    expect(body.details).toContain("all, 7d, 30d, 90d, 180d, 365d");
  });

  it("a range filter composes with the others (status + has_dues + batch)", async () => {
    const { body } = await get(f, "status=active&balanceRange=has_dues&batchIds=" + BATCH_ALPHA);
    expect(codes(body)).toEqual(["S-100", "S-075"]);
    expect(body.data?.total).toBe(2);
  });

  it("batchIds INTERSECTS overdue_only rather than one overwriting the other", async () => {
    // S-100 (Alpha, overdue) and S-075 (Alpha, overdue) vs S-200 (no batch,
    // overdue-by-balance-only). Batch + overdue must be the intersection, not
    // whichever was assigned last.
    const { body } = await get(f, `balanceRange=overdue_only&batchIds=${BATCH_ALPHA}`);
    expect(codes(body)).toEqual(["S-100", "S-075"]);
    const inverted = await get(f, `batchIds=${BATCH_ALPHA}&balanceRange=overdue_only`);
    expect(codes(inverted.body)).toEqual(["S-100", "S-075"]);
  });

  it("an id-filter intersection that is empty returns zero rows, not the wider set", async () => {
    // BATCH_BETA holds S-050 and S-025, neither of which has an overdue invoice.
    const { body } = await get(f, `balanceRange=overdue_only&batchIds=${BATCH_BETA}`);
    expect(codes(body)).toEqual([]);
    expect(body.data?.total).toBe(0);
  });

  it("the cache key separates has_dues from zero — one does not serve the other", async () => {
    const hasDues = await get(f, "balanceRange=has_dues");
    const zero = await get(f, "balanceRange=zero");
    expect(codes(hasDues.body)).toEqual(["S-100", "S-075", "S-025", "S-200"]);
    expect(codes(zero.body)).toEqual(["S-010", "S-050"]);
  });

  it("the cache key separates overdue_only from has_dues", async () => {
    const overdue = await get(f, "balanceRange=overdue_only&sortCol=code&sortDir=asc");
    expect(codes(overdue.body)).toEqual(["S-075", "S-100"]);
    const hasDues = await get(f, "balanceRange=has_dues&sortCol=code&sortDir=asc");
    expect(codes(hasDues.body)).toEqual(["S-025", "S-075", "S-100", "S-200"]);
  });

  it("admittedInLast is part of the cache key", async () => {
    const all = await get(f, "admittedInLast=all");
    expect(all.body.data?.total).toBe(6);
    const recent = await get(f, "admittedInLast=7d");
    expect(recent.body.data?.total).toBe(0);
  });

  it("tagIds is a 400 naming the field (the gateway has no student_tags table)", async () => {
    const { status, body } = await get(f, "tagIds=tag-1");
    expect(status).toBe(400);
    expect(body.details).toContain("tagIds");
    expect(body.details).toContain("student_tags");
  });

  it("filters compose: active + prepaid + zero balance is exactly S-050", async () => {
    const { body } = await get(f, "status=active&feeModels=prepaid&balanceRange=zero");
    expect(codes(body)).toEqual(["S-050"]);
    expect(body.data?.total).toBe(1);
  });

  it("search still narrows the roster and its own `total`", async () => {
    const { body } = await get(f, "search=ishita");
    expect(codes(body)).toEqual(["S-010"]);
    expect(body.data?.total).toBe(1);
  });

  it("never crosses the tenant boundary", async () => {
    const { body } = await get(f, "sortCol=code&sortDir=asc");
    expect(codes(body)).not.toContain("X-999");
    expect(body.data?.total).toBe(6);
  });
});

describe("roster cache key — every input that changes the result is in it", () => {
  it("pageSize is part of the key (50-row page is not served to a 100-row request)", async () => {
    const small = await get(f, "sortCol=code&sortDir=asc&pageSize=2");
    expect(small.body.data?.students).toHaveLength(2);
    const large = await get(f, "sortCol=code&sortDir=asc&pageSize=6");
    expect(large.body.data?.students).toHaveLength(6);
    expect(codes(large.body)).toEqual(["S-010", "S-025", "S-050", "S-075", "S-100", "S-200"]);
  });

  it("page is part of the key", async () => {
    const p1 = await get(f, "sortCol=code&sortDir=asc&pageSize=2&page=1");
    const p2 = await get(f, "sortCol=code&sortDir=asc&pageSize=2&page=2");
    expect(codes(p1.body)).toEqual(["S-010", "S-025"]);
    expect(codes(p2.body)).toEqual(["S-050", "S-075"]);
  });

  it("sort is part of the key", async () => {
    const asc = await get(f, "sortCol=code&sortDir=asc");
    const desc = await get(f, "sortCol=code&sortDir=desc");
    expect(codes(asc.body)).toEqual(["S-010", "S-025", "S-050", "S-075", "S-100", "S-200"]);
    expect(codes(desc.body)).toEqual(["S-200", "S-100", "S-075", "S-050", "S-025", "S-010"]);
  });

  it("the filter set is part of the key", async () => {
    const unfiltered = await get(f, "sortCol=code&sortDir=asc");
    expect(unfiltered.body.data?.total).toBe(6);
    const filtered = await get(f, "sortCol=code&sortDir=asc&balanceRange=zero");
    expect(filtered.body.data?.total).toBe(2);
  });

  it("a repeated identical request is served from cache with the same rows", async () => {
    const first = await get(f, "sortCol=code&sortDir=asc");
    const second = await get(f, "sortCol=code&sortDir=asc");
    expect(second.body.data?.students).toEqual(first.body.data?.students);
    expect(second.body.data?.total).toBe(first.body.data?.total);
  });
});

describe("the orm orderBy seam — one allowlist, loud on anything else", () => {
  function orm() {
    return createPrismaOrm(f.db as unknown as DB, TENANT);
  }

  it("sorts students by a real column", async () => {
    const rows = await orm().student.findMany({ orderBy: { firstName: "asc" } });
    expect(rows.map((r) => r.firstName)).toEqual([
      "Aarav", "Diya", "Ishita", "Kabir", "Neha", "Vivaan",
    ]);
  });

  it("batches sort by name — the column attendance.ts:41 asks for and used to lose", async () => {
    const rows = await orm().batch.findMany({ orderBy: { name: "asc" } });
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });

  it("rejects a real-but-unsortable student column, naming it", async () => {
    await expect(orm().student.findMany({ orderBy: { phone: "asc" } }))
      .rejects.toBeInstanceOf(OrderByNotAllowedError);
    await expect(orm().student.findMany({ orderBy: { phone: "asc" } }))
      .rejects.toThrow(/phone/);
  });

  it("sorts notifications by read_at — the column that IS there (was the phantom `read`)", async () => {
    // Unread first, read last: NULL sorts before a timestamp in SQLite.
    const rows = await orm().notification.findMany({ orderBy: { readAt: "asc" } });
    expect(rows.map((r) => r.title)).toEqual([
      "Fee due for Aarav", "Class starts soon", "Class starts later",
    ]);
  });

  it("still rejects the phantom notifications.read — no such column exists", async () => {
    await expect(orm().notification.findMany({ orderBy: { read: "asc" } }))
      .rejects.toBeInstanceOf(OrderByNotAllowedError);
    await expect(orm().notification.findMany({ orderBy: { read: "asc" } }))
      .rejects.toThrow(/no such sortable column/);
  });

  it("sorts attendance sessions by batch_id — the column that IS there (was `batch_name`)", async () => {
    const rows = await orm().attendanceSession.findMany({ orderBy: { batchId: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.batchId === BATCH_ALPHA)).toBe(true);
    // Both sessions are in the same batch, so the pk tie-break must order them
    // deterministically by session_date rather than arbitrarily.
    const byDate = await orm().attendanceSession.findMany({ orderBy: { sessionDate: "asc" } });
    expect(byDate.map((r) => r.sessionDate)).toEqual(["2026-01-10", "2026-02-10"]);
  });

  it("still rejects the phantom attendance_sessions.batch_name", async () => {
    await expect(orm().attendanceSession.findMany({ orderBy: { batchName: "asc" } }))
      .rejects.toBeInstanceOf(OrderByNotAllowedError);
    await expect(orm().attendanceSession.findMany({ orderBy: { batchName: "asc" } }))
      .rejects.toThrow(/no such sortable column/);
  });

  it("rejects a multi-key orderBy rather than silently using the first key", async () => {
    await expect(
      orm().student.findMany({ orderBy: { firstName: "asc", code: "asc" } }),
    ).rejects.toThrow(/single column/);
  });

  it("an injection attempt in a sort key is rejected and the table survives", async () => {
    await expect(
      orm().student.findMany({ orderBy: { "id); DROP TABLE students;--": "asc" } }),
    ).rejects.toBeInstanceOf(OrderByNotAllowedError);
    const after = f.db.query("SELECT COUNT(*) AS c FROM students");
    expect(Number(after[0].c)).toBe(7); // 6 for TENANT + 1 for OTHER_TENANT
  });

  it("money stays integer paise through the sorted read (no float creep)", async () => {
    const rows = await orm().student.findMany({ orderBy: { balancePaise: "desc" } });
    for (const r of rows) {
      expect(Number.isSafeInteger(r.balancePaise)).toBe(true);
    }
    expect(rows[0].balancePaise).toBe(750000);
  });
});
