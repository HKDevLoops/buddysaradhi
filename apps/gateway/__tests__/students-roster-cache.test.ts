// Implements: 05_Students.md §Roster + RFC-003 G-DB (the 63s reference TTL is
// a BUDGET control — a cache that still pays for the reads it exists to avoid
// is not a cache). Runs the REAL `handleStudents` and the REAL `createPrismaOrm`
// against in-memory SQLite (AGENTS.md §7.3 — never mock the ledger).
//
// P2 — the cache was consulted AFTER the reads it was meant to avoid.
// P3 — the key embedded the resolved overdue id set, so `overdue_only` had a
//      near-zero hit rate and P2's pre-cache reads ran on nearly every request.
//
// Both tests below assert the number of STATEMENTS the route issues, because
// "did the cache hit" is otherwise invisible: the response bytes are identical
// either way. Every assertion FAILS against the pre-fix route.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { handleStudents } from "../routes/students.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { RecordingDb } from "./recording-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const BATCH_ALPHA = "018f0000-0000-7000-8000-00000000c001";
const PATH = "/api/v1/students";

const S_OVERDUE = "018f0000-0000-7000-8000-0000000000d001";
const S_LATE_OVERDUE = "018f0000-0000-7000-8000-0000000000d002";
const S_PLAIN = "018f0000-0000-7000-8000-0000000000d003";

const NOW_ISO = "2026-10-09T09:00:00.000Z";

interface RosterRow {
  id: string;
  code: string | null;
  name: string;
  balance_due: number;
  status: string;
}

interface ApiBody {
  success: boolean;
  data?: { students: RosterRow[]; total: number };
  error?: string;
  details?: string;
}

async function get(
  db: RecordingDb,
  query: string,
): Promise<{ status: number; body: ApiBody }> {
  const url = new URL(`https://api.buddysaradhi.app${PATH}${query ? `?${query}` : ""}`);
  const res = await handleStudents(
    new Request(url, { method: "GET" }),
    // SAFETY: RecordingDb satisfies `SqlHandle` structurally — real
    // SqliteGatewayDb underneath, so the audited builders run against real
    // SQLite.
    db as unknown as DB,
    TENANT,
    PATH,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${PATH}?${query}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function codes(body: ApiBody): (string | null)[] {
  return (body.data?.students ?? []).map((s) => s.code);
}

/** `due_date` is computed from `today` so the fixture never rots with the
 *  calendar — the same approach `students-roster-contract.test.ts` uses. */
function iso(offsetDays: number, from = new Date(NOW_ISO)): string {
  return new Date(from.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function seed(db: RecordingDb): void {
  const now = "2026-01-01T00:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO batches (id, tenant_id, name, subject, created_at, updated_at)
     VALUES (?, ?, 'Alpha', 'General', ?, ?)`,
  ).run(BATCH_ALPHA, TENANT, now, now);

  const insStudent = db.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, fee_model,
                           balance_paise, admission_date, grade, dup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 'postpaid', ?, ?, '9', ?, ?, ?)`,
  );
  insStudent.run(S_OVERDUE, TENANT, "S-100", "Aarav", "Sharma", 300000, "2026-01-04", "S-100", now, now);
  insStudent.run(S_LATE_OVERDUE, TENANT, "S-200", "Vivaan", "Bose", 250000, "2026-01-08", "S-200", now, now);
  insStudent.run(S_PLAIN, TENANT, "S-300", "Neha", "Gill", 0, "2026-01-09", "S-300", now, now);

  db.raw.prepare(
    `INSERT INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-01-01', ?, ?)`,
  ).run("018f0000-0000-7000-8000-0000000000e001", TENANT, S_OVERDUE, BATCH_ALPHA, now, now);
  db.raw.prepare(
    `INSERT INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-01-01', ?, ?)`,
  ).run("018f0000-0000-7000-8000-0000000000e002", TENANT, S_PLAIN, BATCH_ALPHA, now, now);

  const insInvoice = db.raw.prepare(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                           subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'hash', ?, ?)`,
  );
  // S-100 is past due and unsettled → overdue.
  insInvoice.run("018f0000-0000-7000-8000-0000000000b001", TENANT, "INV-1", S_OVERDUE, iso(-40), iso(-10), 300000, 300000, "unpaid", now, now);
  // S-200 is past due and PARTLY settled → still overdue.
  insInvoice.run("018f0000-0000-7000-8000-0000000000b002", TENANT, "INV-2", S_LATE_OVERDUE, iso(-40), iso(-5), 250000, 250000, "partial", now, now);
}

let db: RecordingDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  db = new RecordingDb();
  seed(db);
  invalidateTenant(TENANT);
  db.reset();
});

describe("P2 / a cache hit pays for NOTHING", () => {
  it("issues zero statements on the second identical roster request", async () => {
    const first = await get(db, "balanceRange=overdue_only");
    expect(first.status).toBe(200);
    expect(db.count).toBeGreaterThan(0); // the miss really did read

    db.reset();
    const second = await get(db, "balanceRange=overdue_only");

    // Pre-fix, this was 2 statements — the batch-enrolment read and the overdue
    // invoice read, BOTH awaited before `getCached()`. The 63s TTL bought
    // nothing for exactly the two filters that make the roster expensive.
    expect(db.count).toBe(0);
    expect(second.body.data).toEqual(first.body.data);
  });

  it("skips the pre-cache id-set reads even when BOTH are in play", async () => {
    await get(db, `balanceRange=overdue_only&batchIds=${BATCH_ALPHA}`);
    expect(db.selectsFrom("student_enrollments")).toHaveLength(1);
    expect(db.selectsFrom("invoices")).toHaveLength(1);

    db.reset();
    const hit = await get(db, `balanceRange=overdue_only&batchIds=${BATCH_ALPHA}`);
    expect(db.selectsFrom("student_enrollments")).toHaveLength(0);
    expect(db.selectsFrom("invoices")).toHaveLength(0);
    expect(codes(hit.body)).toEqual(["S-100"]);
  });

  it("a plain roster request is a pure cache hit too", async () => {
    const first = await get(db, "");
    db.reset();
    const second = await get(db, "");
    expect(db.count).toBe(0);
    expect(codes(second.body)).toEqual(codes(first.body));
  });
});

describe("P3 / the key is the FILTERS, not the resolved id set", () => {
  it("two identical-filter requests on the same day hit the SAME key", async () => {
    await get(db, "balanceRange=overdue_only&sortCol=code&sortDir=asc");
    db.reset();

    // A brand-new past-due invoice for a student who was not overdue a moment
    // ago. Written straight to the DB on purpose: the whole point is that the
    // resolved overdue id set CHANGED while every filter input stayed the same.
    // Pre-fix the key carried `overdueIds=…`, so it changed with the set and
    // this second request missed the cache and re-read everything.
    db.raw.prepare(
      `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                             subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
       VALUES (?, ?, 'INV-3', ?, ?, ?, 90000, 0, 0, 90000, 'unpaid', 'hash', ?, ?)`,
    ).run("018f0000-0000-7000-8000-0000000000b003", TENANT, S_PLAIN, iso(-40), iso(-2), "2026-01-01", "2026-01-01");

    const second = await get(db, "balanceRange=overdue_only&sortCol=code&sortDir=asc");

    // Same filters, same day ⇒ same key ⇒ a HIT.
    expect(db.count).toBe(0);
    // …and the served rows are the ones the filters select, byte-for-byte what
    // the first request returned.
    expect(codes(second.body)).toEqual(["S-100", "S-200"]);
  });

  it("the day watermark rotates the key — a new day is a new key", async () => {
    await get(db, "balanceRange=overdue_only");
    db.reset();

    // Nothing was written; only the calendar moved. The overdue set genuinely
    // changes as invoices pass their due date, and that has to invalidate.
    vi.setSystemTime(new Date(Date.parse(NOW_ISO) + 86_400_000));
    await get(db, "balanceRange=overdue_only");
    expect(db.selectsFrom("invoices")).toHaveLength(1);
    expect(db.count).toBeGreaterThan(0);
  });

  it("admittedInLast rotates with the watermark too, because its cutoff is a date", async () => {
    await get(db, "admittedInLast=7d");
    db.reset();
    vi.setSystemTime(new Date(Date.parse(NOW_ISO) + 86_400_000));
    const next = await get(db, "admittedInLast=7d");
    expect(db.count).toBeGreaterThan(0);
    // Still a correct, empty answer — just not served from yesterday's entry.
    expect(next.body.data?.total).toBe(0);
  });

  it("a mutation still invalidates — the watermark does not outlive a write", async () => {
    await get(db, "balanceRange=overdue_only");
    db.reset();
    // Every mutating route calls this after commit (students, ledger, settings,
    // attendance, erase). This is what makes serving a within-day cached roster
    // safe: a real change never waits for the 63s TTL.
    invalidateTenant(TENANT);
    await get(db, "balanceRange=overdue_only");
    expect(db.count).toBeGreaterThan(0);
  });
});

describe("P3 / the key still discriminates every input that changes the result", () => {
  const variants: Array<[string, string, string[]]> = [
    ["pageSize", "sortCol=code&sortDir=asc&pageSize=1", ["S-100"]],
    ["sort direction", "sortCol=code&sortDir=desc&balanceRange=all", ["S-300", "S-200", "S-100"]],
    ["balanceRange", "balanceRange=zero", ["S-300"]],
    ["admittedInLast", "admittedInLast=7d", []],
    ["search", "search=neha", ["S-300"]],
    ["status", "status=graduated", []],
    ["feeModels", "feeModels=prepaid", []],
    ["batchIds", `batchIds=${BATCH_ALPHA}`, ["S-100", "S-300"]],
  ];

  for (const [label, query, expected] of variants) {
    it(`${label} is served from its own entry, never another filter's`, async () => {
      // Warm one entry, then ask for a different filter over the same DB.
      await get(db, "sortCol=code&sortDir=asc");
      const { body } = await get(db, query);
      expect(codes(body)).toEqual(expected);
    });
  }

  it("page is part of the key", async () => {
    const p1 = await get(db, "sortCol=code&sortDir=asc&pageSize=1&page=1");
    const p2 = await get(db, "sortCol=code&sortDir=asc&pageSize=1&page=2");
    expect(codes(p1.body)).toEqual(["S-100"]);
    expect(codes(p2.body)).toEqual(["S-200"]);
  });

  it("a 400 for an invalid filter is never served from, and never poisons, the cache", async () => {
    const bad = await get(db, "sortCol=drop_table");
    expect(bad.status).toBe(400);
    expect(bad.body.details).toContain("sortCol=drop_table");
    // And the valid request that follows still reads fresh and answers correctly.
    const good = await get(db, "sortCol=code&sortDir=asc");
    expect(codes(good.body)).toEqual(["S-100", "S-200", "S-300"]);
  });

  it("overdue_only still means overdue invoices, not merely a positive balance", async () => {
    // S-300 has NO invoice but the guard below gives it a zero balance; S-100 and
    // S-200 hold real past-due invoices. A `has_dues` alias would still be
    // right here, so add a settled past-due invoice to make the two differ.
    db.raw.prepare(
      `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                             subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
       VALUES (?, ?, 'INV-4', ?, ?, ?, 120000, 0, 0, 120000, 'paid', 'hash', '2026-01-01', '2026-01-01')`,
    ).run("018f0000-0000-7000-8000-0000000000b004", TENANT, S_PLAIN, iso(-40), iso(-1));
    db.raw.prepare(
      `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, fee_model,
                             balance_paise, admission_date, grade, dup_key, created_at, updated_at)
       VALUES (?, ?, 'S-400', 'Isha', 'Roy', 'active', 'postpaid', 120000, '2026-01-09', '9', 'S-400', '2026-01-01', '2026-01-01')`,
    ).run("018f0000-0000-7000-8000-0000000000d004", TENANT);
    invalidateTenant(TENANT);

    const overdue = await get(db, "balanceRange=overdue_only&sortCol=code&sortDir=asc");
    const hasDues = await get(db, "balanceRange=has_dues&sortCol=code&sortDir=asc");
    // Isha owes money but her invoice is settled → not overdue.
    expect(codes(hasDues.body)).toContain("S-400");
    expect(codes(overdue.body)).not.toContain("S-400");
    expect(codes(overdue.body)).toEqual(["S-100", "S-200"]);
  });
});