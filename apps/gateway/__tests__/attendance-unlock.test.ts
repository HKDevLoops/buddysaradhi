// Implements: 06_Attendance.md §9.2 (in-place re-mark), §10.6 BR-ATT-07 (three
// -tier ladder), §10.3, §10.8, §14 + EC-A-01 (no future dates), §15.2 (audit
// vocabulary + metadata); 12 BR-ATT-01, BR-ATT-06, BR-SEC-03/BR-SEC-04; RFC-004
// C1/K1 (idempotent lock).
//
// Runs the production attendance handlers against in-memory SQLite carrying
// the gateway's own DDL (AGENTS.md §7.3 — never mock the DB). Proves the
// unlock contract the web actions rely on: tier routing, atomic
// audit+outbox+envelope writes, window-gated marks with per-row double audit,
// lazy relock on expiry, and K1 replay safety.
import { describe, expect, it } from "vitest";
import { handleAttendance } from "../routes/attendance.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  /** `failZod` puts the human field detail here and the code in `error`. */
  details?: string;
}

let keyCounter = 100;
function newKey(): string {
  keyCounter += 1;
  return `018f0000-0000-7000-9000-${String(keyCounter).padStart(12, "0")}`;
}

async function post(
  fixture: LedgerFixture,
  path: string,
  body: Record<string, unknown>,
  key?: string,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key ?? newKey() },
    body: JSON.stringify(body),
  });
  const res = await handleAttendance(
    req,
    // SAFETY: same structural substitution as ledger-routes.test.ts.
    fixture.db as unknown as DB,
    fixture.tenantId,
    path,
    "POST",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error(`no route matched POST ${path}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

async function get(
  fixture: LedgerFixture,
  path: string,
  query = "",
): Promise<{ status: number; body: ApiBody }> {
  // The handler matches the bare path (index.ts splits query off the URL);
  // the query string rides on the Request URL only.
  const req = new Request(`https://api.buddysaradhi.app${path}${query}`, { method: "GET" });
  const res = await handleAttendance(
    req,
    fixture.db as unknown as DB,
    fixture.tenantId,
    path,
    "GET",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error(`no route matched GET ${path}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function daysAgoDate(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function seedSession(
  fixture: LedgerFixture,
  id: string,
  sessionDate: string,
  lockedAt: string | null,
): void {
  const now = new Date().toISOString();
  fixture.db.raw
    .prepare(
      `INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, locked_at, locked_by, created_at, updated_at)
       VALUES (?, ?, 'batch-default', ?, ?, ?, ?, ?)`,
    )
    .run(id, fixture.tenantId, sessionDate, lockedAt, lockedAt ? fixture.tenantId : null, now, now);
}

function seedAudit(fixture: LedgerFixture, action: string, refId: string, createdAt: string): void {
  fixture.db.raw
    .prepare(
      `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
       VALUES (?, ?, ?, ?, 'attendance_session', ?, '{}', ?)`,
    )
    .run(crypto.randomUUID(), fixture.tenantId, fixture.tenantId, action, refId, createdAt);
}

function auditActions(fixture: LedgerFixture): string[] {
  return fixture.db
    .query("SELECT action FROM audit_log ORDER BY created_at", [])
    .map((r) => String((r as Record<string, unknown>).action));
}

function outboxOps(fixture: LedgerFixture): string[] {
  return fixture.db
    .query("SELECT op FROM sync_outbox", [])
    .map((r) => String((r as Record<string, unknown>).op));
}

describe("gateway attendance unlock — the edge refuses (BR-SEC-04 / §15)", () => {
  it("refuses to open an unlock window at all: the edge cannot verify the PIN", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(2), minutesAgoIso(5));
    // Before this the route granted a 60-minute OVERWRITE-GRADE window on a
    // bearer token alone (no PIN field at all), and the web BFF forwards
    // POST /api/v1/* to it — so any holder of the session token could rewrite a
    // frozen day. argon2id is unavailable on the Deno edge (routes/security.ts
    // documents the same constraint for the erase flow), so the honest answer is
    // to refuse: BR-SEC-03 is fail-closed.
    const res = await post(f, "/api/v1/attendance/unlock", { sessionId: sid });
    expect(res.status).toBe(403);
    expect(String(res.body.error ?? "")).toMatch(/PIN_PROOF_UNAVAILABLE/);
    expect(auditActions(f)).toEqual([]);
    expect(outboxOps(f)).toEqual([]);
  });

  it("refuses the Tier-3 request route for the same reason", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(45), minutesAgoIso(5));
    const res = await post(f, "/api/v1/attendance/request-unlock", {
      sessionId: sid,
      reason: "Parent disputed the 12 Aug absence record; reviewing now.",
    });
    expect(res.status).toBe(403);
    expect(String(res.body.error ?? "")).toMatch(/PIN_PROOF_UNAVAILABLE/);
    expect(auditActions(f)).toEqual([]);
  });

  it("still honours a window granted by the PIN-verifying path", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(2), minutesAgoIso(5));
    // The web server action writes this row (it can verify argon2id). The mark
    // gate reads it, so an unlock done in the app still permits edits from the
    // edge.
    seedAudit(f, "attendance_unlock", sid, minutesAgoIso(5));
    const marked = await post(f, "/api/v1/attendance", {
      session_date: daysAgoDate(2),
      updates: [{ student_id: f.studentId, status: "present" }],
    });
    expect(marked.status).toBe(200);
    expect(auditActions(f).filter((a) => a === "attendance.edit_locked")).toHaveLength(1);
  });
});

describe("gateway mark gate — windows and lazy relock", () => {
  function markBody(date: string, studentId: string) {
    return { session_date: date, updates: [{ student_id: studentId, status: "present" }] };
  }

  it("allows in-window marks with per-row double audit", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(2), minutesAgoIso(5));
    seedAudit(f, "attendance_unlock", sid, minutesAgoIso(5));
    const marked = await post(f, "/api/v1/attendance", markBody(daysAgoDate(2), f.studentId));
    expect(marked.status).toBe(200);
    const actions = auditActions(f);
    expect(actions).toContain("attendance_unlock");
    expect(actions.filter((a) => a === "attendance.edit_locked").length).toBe(1);
    expect(actions).not.toContain("attendance.relock");
  });

  it("re-marks the same student IN PLACE (BR-ATT-01), not a duplicate insert", async () => {
    const f = createLedgerFixture();
    const first = await post(f, "/api/v1/attendance", markBody(daysAgoDate(0), f.studentId));
    expect(first.status).toBe(200);
    const sessionId = String(first.body.data?.["sessionId"]);
    const second = await post(f, "/api/v1/attendance", {
      session_date: daysAgoDate(0),
      updates: [{ student_id: f.studentId, status: "absent" }],
    });
    expect(second.status).toBe(200);
    const rows = f.db.query(
      "SELECT status FROM attendance_records WHERE session_id = ?",
      [sessionId],
    ) as Array<Record<string, unknown>>;
    // `attendanceRecord.createMany` (the previous implementation) aborted here on
    // UNIQUE(session_id, student_id), so the second mark of a day was an ERROR
    // instead of an edit, and re-running a bulk on a partly-marked day failed.
    expect(rows).toHaveLength(1);
    expect(String(rows[0].status)).toBe("absent");
  });

  it("400s a future session date (EC-A-01 / §14)", async () => {
    const f = createLedgerFixture();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await post(f, "/api/v1/attendance", markBody(tomorrow, f.studentId));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
    expect(String(res.body.details ?? "")).toMatch(/future/i);
    expect(auditActions(f)).toEqual([]);
  });

  it("audits a multi-student batch as attendance.bulk_mark (§15.2)", async () => {
    const f = createLedgerFixture();
    const second = "018f0000-0000-7000-8000-0000000000ff";
    f.db.raw
      .prepare(
        `INSERT INTO students (id, tenant_id, first_name, admission_date, status, dup_key, balance_paise, created_at, updated_at)
         VALUES (?, ?, 'Diya', '2026-01-04', 'active', 'S-002', 0, ?, ?)`,
      )
      .run(second, f.tenantId, new Date().toISOString(), new Date().toISOString());
    const res = await post(f, "/api/v1/attendance", {
      session_date: daysAgoDate(0),
      updates: [
        { student_id: f.studentId, status: "absent" },
        { student_id: second, status: "absent" },
      ],
    });
    expect(res.status).toBe(200);
    const bulk = f.db.query("SELECT metadata FROM audit_log WHERE action = ?", [
      "attendance.bulk_mark",
    ]) as Array<Record<string, unknown>>;
    expect(bulk).toHaveLength(1);
    const meta = JSON.parse(String(bulk[0].metadata)) as Record<string, unknown>;
    expect(meta.status).toBe("absent");
    expect(meta.count_affected).toBe(2);
    expect(meta.count_skipped_locked).toBe(0);
  });

  it("rejects expired windows, writing the lazy relock first", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(2), minutesAgoIso(90));
    seedAudit(f, "attendance.unlock", sid, minutesAgoIso(61));
    const marked = await post(f, "/api/v1/attendance", markBody(daysAgoDate(2), f.studentId));
    expect(marked.status).toBe(409);
    expect(String(marked.body.error ?? "")).toMatch(/locked/);
    expect(auditActions(f)).toContain("attendance.relock");
  });

  it("rejects never-unlocked sessions with the pre-existing copy", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(2), minutesAgoIso(5));
    const marked = await post(f, "/api/v1/attendance", markBody(daysAgoDate(2), f.studentId));
    expect(marked.status).toBe(409);
    expect(String(marked.body.error ?? "")).toBe("CONFLICT: session is locked; unlock it to edit");
    expect(auditActions(f)).not.toContain("attendance.relock");
  });

  it("GET surfaces unlock_window_expires_at + hard_locked", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(2), minutesAgoIso(5));
    seedAudit(f, "attendance_unlock", sid, minutesAgoIso(5));
    const res = await get(f, "/api/v1/attendance", `?date=${daysAgoDate(2)}`);
    expect(res.status).toBe(200);
    const session = res.body.data?.["session"] as Record<string, unknown> | null;
    expect(session).not.toBeNull();
    expect(typeof session?.["unlock_window_expires_at"]).toBe("string");
    expect(session?.["hard_locked"]).toBe(false);
  });
});

describe("gateway lock — §15.2 audit metadata", () => {
  it("records which date and batch were frozen and by which method", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    const day = daysAgoDate(0);
    seedSession(f, sid, day, null);
    const res = await post(f, "/api/v1/attendance/lock", { sessionId: sid });
    expect(res.status).toBe(200);
    const rows = f.db.query("SELECT metadata FROM audit_log WHERE action = ?", [
      "attendance.lock",
    ]) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const meta = JSON.parse(String(rows[0].metadata)) as Record<string, unknown>;
    // Previously `{}` — a lock audit row that could not say which day it froze.
    expect(meta.session_date).toBe(day);
    expect(meta.batch_id).toBe("batch-default");
    expect(meta.method).toBe("pin");
  });
});
