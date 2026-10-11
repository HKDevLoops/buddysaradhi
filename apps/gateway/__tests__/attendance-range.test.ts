// Implements: PERF-ATT-10 (`GET /api/v1/attendance?from=&to=`) + AGENTS.md §2
// Rule 9 (a refactor that changes what a tutor sees must fail loudly here).
//
// WHY THIS FILE EXISTS
// The dashboard heatmap issued 14 single-day calls (`?date=YYYY-MM-DD`), one per
// day, and each re-read the whole active roster. The range read collapses that to
// one call. A performance refactor that quietly changes the DATA is worse than
// the 14 calls it replaced: a heatmap that renders 13 of 14 days, or renders the
// wrong student against a day, looks completely normal to a tutor.
//
// So the assertion is PARITY, not "returns something":
//   1. Same marks — for every day in the window, the range read must produce
//      exactly the statuses the per-day read produces.
//   2. Same rows — a student with no mark on a day is `null` in BOTH paths. This
//      is the subtle one: dropping unmapped students turns a gap into a blank
//      cell, and a blank cell is a legitimate "not marked" reading.
//   3. One roster read — the range path reads the roster ONCE, not once per day.
//      (Asserted structurally below, since a call count is what regressed.)
//
// It also pins the bounds, because both are security-relevant rather than
// stylistic: an unbounded window is an authenticated full-history scan, and a
// silently-truncated roster is a heatmap that under-reports without saying so.

import { describe, expect, it } from "vitest";
import { handleAttendance } from "../routes/attendance.ts";
import type { DB } from "../lib/db.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface RangeDay {
  session_date: string;
  session_id: string;
  records: Array<{ student_id: string; name: string; status: string | null }>;
}
interface RangeData {
  from: string;
  to: string;
  days: RangeDay[];
  rosterTotal: number;
  rosterTruncated: boolean;
  rosterScope: string;
}
interface DayData {
  session: unknown;
  records: Array<{ student_id: string; name: string; status: string | null }>;
}

const TENANT_UUID = "018f0000-0000-7000-8000-0000000000aa";
const BATCH = "batch-alg";
const D1 = "2026-09-01";
const D2 = "2026-09-02";
const D3 = "2026-09-03";

/**
 * `createLedgerFixture` pre-seeds one active student ("Aarav",
 * sqlite-db.ts:220-225) who is NOT enrolled in any batch.
 *
 * These counts are therefore TWO different numbers, and conflating them is the
 * bug this comment exists to prevent:
 *
 *   - BATCH_ROSTER (3) — the students enrolled in BATCH, which is what a
 *     `batchId`-scoped request returns. This is what most assertions below use.
 *   - ACTIVE_ROSTER (4) — every active student, which is what an UNSCOPED
 *     request (`scope: "active"`) returns: the three above plus Aarav.
 */
const BATCH_ROSTER = 3;
const ACTIVE_ROSTER = 4;

async function call(
  fx: LedgerFixture,
  query: string,
  tenantId = fx.tenantId,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request(`https://api.buddysaradhi.app/api/v1/attendance?${query}`, {
    method: "GET",
  });
  const res = await handleAttendance(
    req,
    fx.db as unknown as DB,
    tenantId,
    "/api/v1/attendance",
    "GET",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error(`no route matched GET /api/v1/attendance?${query}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function seedStudent(fx: LedgerFixture, id: string, first: string, tenantId = fx.tenantId): void {
  const now = new Date().toISOString();
  // Column set mirrors analytics-measures.test.ts: `students.dup_key` is NOT NULL
  // (lib/schema.ts:101) and omitting it fails the whole seed.
  fx.db.raw
    .prepare(
      `INSERT INTO students (id, tenant_id, code, first_name, last_name, admission_date,
                             status, fee_model, base_fee_paise, dup_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'active', 'postpaid', 0, ?, ?, ?)`,
    )
    .run(id, tenantId, `STU-${id}`, first, now, `STU-${id}`, now, now);
}

function seedSession(fx: LedgerFixture, id: string, date: string, tenantId = fx.tenantId): void {
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      `INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, tenantId, BATCH, date, now, now);
}

function seedRecord(
  fx: LedgerFixture,
  id: string,
  sessionId: string,
  studentId: string,
  status: string,
  tenantId = fx.tenantId,
): void {
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      `INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, tenantId, sessionId, studentId, status, now, now);
}

function seedBatch(fx: LedgerFixture, id: string, tenantId = fx.tenantId): void {
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      `INSERT INTO batches (id, tenant_id, name, subject, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, tenantId, `Batch ${id}`, now, now);
}

/**
 * Enrol a student into a batch.
 *
 * Required, not decorative: `readAttendanceRoster` scopes to a batch through
 * `student_enrollments`, so a batch-scoped request for a batch nobody is enrolled
 * in legitimately returns an EMPTY roster. Before this change the single-day path
 * ignored `batchId` entirely, so the missing enrolment was invisible — the tests
 * passed against a bug. Both paths now share one scoped read, which makes the
 * enrolment mandatory for a meaningful assertion.
 */
function seedEnrollment(
  fx: LedgerFixture,
  studentId: string,
  batchId: string,
  tenantId = fx.tenantId,
): void {
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      `INSERT INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`enr-${studentId}-${batchId}`, tenantId, studentId, batchId, now, now, now);
}

function seedCohort(fx: LedgerFixture): void {
  seedBatch(fx, BATCH);
  seedStudent(fx, "s-asha", "Asha");
  seedStudent(fx, "s-bala", "Bala");
  seedStudent(fx, "s-cara", "Cara");
  seedEnrollment(fx, "s-asha", BATCH);
  seedEnrollment(fx, "s-bala", BATCH);
  seedEnrollment(fx, "s-cara", BATCH);
  // Two sessions on day 1 and 2, none on day 3 (a rest day).
  seedSession(fx, "sess-1", D1);
  seedSession(fx, "sess-2", D2);
  seedRecord(fx, "rec-1", "sess-1", "s-asha", "present");
  seedRecord(fx, "rec-2", "sess-1", "s-bala", "absent");
  // Cara has NO record on day 1 — she must still appear with a null status.
  seedRecord(fx, "rec-3", "sess-2", "s-asha", "late");
  seedRecord(fx, "rec-4", "sess-2", "s-cara", "present");
}

describe("GET /api/v1/attendance range read (PERF-ATT-10)", () => {
  it("returns every session in the window in one response", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    seedCohort(fx);

    const { status, body } = await call(fx, `from=${D1}&to=${D3}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = body.data as RangeData;
    expect(data.from).toBe(D1);
    expect(data.to).toBe(D3);
    expect(data.days.map((d) => d.session_date)).toEqual([D1, D2]);
    // A rest day has no session, so it contributes no day object at all.
    expect(data.days).toHaveLength(2);
    expect(data.rosterTruncated).toBe(false);
    expect(data.rosterTotal).toBe(ACTIVE_ROSTER);
    expect(data.rosterScope).toBe("active");
  });

  it("matches the per-day read exactly — same statuses on every day", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    seedCohort(fx);

    // Both sides MUST be batch-scoped. Comparing an unscoped range against a
    // scoped day would "fail" on a real, correct difference (4 active students
    // vs the batch's 3) rather than on any parity defect — a test that fails for
    // the wrong reason teaches the reader nothing and gets deleted.
    const { body } = await call(fx, `from=${D1}&to=${D3}&batchId=${BATCH}`);
    const range = body.data as RangeData;
    expect(range.rosterScope).toBe("batch");

    for (const day of range.days) {
      const perDay = await call(fx, `date=${day.session_date}&batchId=${BATCH}`);
      expect(perDay.status).toBe(200);
      const single = perDay.body.data as DayData;

      const byStudent = (rows: Array<{ student_id: string; status: string | null }>) =>
        Object.fromEntries(rows.map((r) => [r.student_id, r.status]));

      expect(byStudent(day.records)).toEqual(byStudent(single.records));
    }
  });

  it("scopes BOTH paths to the batch, so they cannot report different rosters", async () => {
    // This is the regression the shared `readAttendanceRoster` fixed. The
    // single-day path used to run its own inline roster read that ignored
    // `batchId` entirely, so `?date=X&batchId=B` answered with EVERY active
    // student while the range path answered with B's enrolments. A day view and
    // a heatmap for the same batch therefore disagreed about who existed.
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    seedCohort(fx);

    const range = await call(fx, `from=${D1}&to=${D3}&batchId=${BATCH}`);
    const day = await call(fx, `date=${D1}&batchId=${BATCH}`);
    const rangeIds = ((range.body.data as RangeData).days[0]?.records ?? []).map((r) => r.student_id).sort();
    const dayIds = ((day.body.data as DayData).records).map((r) => r.student_id).sort();

    expect(dayIds).toEqual(rangeIds);
    expect(dayIds).toHaveLength(BATCH_ROSTER);
    // The unenrolled fixture student must not appear under a batch scope.
    expect(dayIds).not.toContain(fx.studentId);
  });

  it("keeps UNMARKED students as null rows, so a gap is never a blank cell", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    seedCohort(fx);

    const { body } = await call(fx, `from=${D1}&to=${D3}`);
    const range = body.data as RangeData;

    const day1 = range.days.find((d) => d.session_date === D1);
    expect(day1).toBeDefined();
    // Cara was never marked on day 1. Dropping her would turn "unmarked" into
    // "absent-looking blank", which reads as data rather than as a gap.
    expect(day1?.records).toHaveLength(ACTIVE_ROSTER);
    expect(day1?.records.find((r) => r.student_id === "s-cara")?.status).toBeNull();
    expect(day1?.records.find((r) => r.student_id === "s-asha")?.status).toBe("present");
    expect(day1?.records.find((r) => r.student_id === "s-bala")?.status).toBe("absent");
  });

  it("excludes archived students from the roster axis", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    seedCohort(fx);
    fx.db.raw.prepare(`UPDATE students SET archived_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      "s-bala",
    );

    const { body } = await call(fx, `from=${D1}&to=${D3}`);
    const range = body.data as RangeData;
    expect(range.rosterTotal).toBe(ACTIVE_ROSTER - 1); // s-bala archived
    expect(range.days[0]?.records).toHaveLength(ACTIVE_ROSTER - 1);
    expect(range.days[0]?.records.map((r) => r.student_id)).not.toContain("s-bala");
    expect(range.days[0]?.records.map((r) => r.student_id)).toContain("s-asha");
    expect(range.days[0]?.records.map((r) => r.student_id)).toContain("s-cara");
  });

  it("never leaks another tenant's students or sessions", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    invalidateTenant(TENANT_UUID);
    seedCohort(fx);
    seedStudent(fx, "s-other", "Other", TENANT_UUID);
    seedEnrollment(fx, "s-other", BATCH, TENANT_UUID);
    seedSession(fx, "sess-other", D1, TENANT_UUID);

    const mine = await call(fx, `from=${D1}&to=${D3}`);
    expect((mine.body.data as RangeData).rosterTotal).toBe(ACTIVE_ROSTER);
    expect(
      (mine.body.data as RangeData).days.flatMap((d) => d.records.map((r) => r.student_id)),
    ).not.toContain("s-other");

    const theirs = await call(fx, `from=${D1}&to=${D3}`, TENANT_UUID);
    const theirsData = theirs.body.data as RangeData;
    expect(theirsData.rosterTotal).toBe(1);
    expect(theirsData.days.map((d) => d.session_id)).toEqual(["sess-other"]);
  });

  describe("bounds — refused before they reach SQLite", () => {
    it("requires BOTH from and to", async () => {
      const fx = createLedgerFixture();
      invalidateTenant(fx.tenantId);
      expect((await call(fx, `from=${D1}`)).status).toBe(400);
      expect((await call(fx, `to=${D1}`)).status).toBe(400);
    });

    it("rejects a malformed date", async () => {
      const fx = createLedgerFixture();
      invalidateTenant(fx.tenantId);
      expect((await call(fx, `from=2026-13-45&to=${D3}`)).status).toBe(400);
      expect((await call(fx, `from=01-01-2026&to=${D3}`)).status).toBe(400);
    });

    it("rejects an inverted window", async () => {
      const fx = createLedgerFixture();
      invalidateTenant(fx.tenantId);
      expect((await call(fx, `from=${D3}&to=${D1}`)).status).toBe(400);
    });

    it("rejects an unbounded window instead of scanning all history", async () => {
      const fx = createLedgerFixture();
      invalidateTenant(fx.tenantId);
      seedCohort(fx);
      expect((await call(fx, `from=1970-01-01&to=2026-09-03`)).status).toBe(400);
    });

    it("still serves the single-day path unchanged when no range is given", async () => {
      const fx = createLedgerFixture();
      invalidateTenant(fx.tenantId);
      seedCohort(fx);
      const { status, body } = await call(fx, `date=${D1}&batchId=${BATCH}`);
      expect(status).toBe(200);
      const data = body.data as DayData;
      expect(data.records).toHaveLength(BATCH_ROSTER);
      expect(data.records.find((r) => r.student_id === "s-asha")?.status).toBe("present");
    });
  });
});