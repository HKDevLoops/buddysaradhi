// Implements: 06_Attendance.md §10.6 BR-ATT-07 (three-tier ladder), §10.3,
// §10.8; 12 BR-ATT-06; RFC-004 C1/K1 (idempotent unlock/request).
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

describe("gateway attendance unlock — tier routing + atomic writes", () => {
  it("unlocks a locked session with window + outbox + audit", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(2), minutesAgoIso(5));
    const res = await post(f, "/api/v1/attendance/unlock", { sessionId: sid });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data?.["window_expires_at"]).toBe("string");
    expect(auditActions(f)).toContain("attendance.unlock");
    expect(outboxOps(f)).toContain("update");
  });

  it("404s an unknown session", async () => {
    const f = createLedgerFixture();
    const res = await post(f, "/api/v1/attendance/unlock", { sessionId: crypto.randomUUID() });
    expect(res.status).toBe(404);
  });

  it("409s a fresh session as not locked", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(0), null);
    const res = await post(f, "/api/v1/attendance/unlock", { sessionId: sid });
    expect(res.status).toBe(409);
    expect(String(res.body.error ?? "")).toMatch(/not_locked/);
  });

  it("409s a hard-locked session with HARD_LOCKED", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(45), minutesAgoIso(5));
    const res = await post(f, "/api/v1/attendance/unlock", { sessionId: sid });
    expect(res.status).toBe(409);
    expect(String(res.body.error ?? "")).toMatch(/HARD_LOCKED/);
    expect(auditActions(f)).toEqual([]);
  });

  it("replays the same intent key with identical bytes (K1)", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(2), minutesAgoIso(5));
    const key = newKey();
    const first = await post(f, "/api/v1/attendance/unlock", { sessionId: sid }, key);
    const second = await post(f, "/api/v1/attendance/unlock", { sessionId: sid }, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
  });
});

describe("gateway hard-unlock request — Tier 3 gate", () => {
  it("grants a hard-locked session and audits the request", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(45), minutesAgoIso(5));
    const res = await post(f, "/api/v1/attendance/request-unlock", {
      sessionId: sid,
      reason: "Parent disputed the 12 Aug absence record; reviewing now.",
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auditActions(f)).toContain("attendance.hard_unlock_request");
  });

  it("400s a short reason (Zod, ≥20 chars)", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(45), minutesAgoIso(5));
    const res = await post(f, "/api/v1/attendance/request-unlock", { sessionId: sid, reason: "fix it" });
    expect(res.status).toBe(400);
    expect(auditActions(f)).toEqual([]);
  });

  it("409s a young session with NOT_HARD_LOCKED", async () => {
    const f = createLedgerFixture();
    const sid = crypto.randomUUID();
    seedSession(f, sid, daysAgoDate(5), minutesAgoIso(5));
    const res = await post(f, "/api/v1/attendance/request-unlock", {
      sessionId: sid,
      reason: "Parent disputed the 12 Aug absence record; reviewing now.",
    });
    expect(res.status).toBe(409);
    expect(String(res.body.error ?? "")).toMatch(/NOT_HARD_LOCKED/);
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
    const unlocked = await post(f, "/api/v1/attendance/unlock", { sessionId: sid });
    expect(unlocked.status).toBe(200);
    const marked = await post(f, "/api/v1/attendance", markBody(daysAgoDate(2), f.studentId));
    expect(marked.status).toBe(200);
    const actions = auditActions(f);
    expect(actions).toContain("attendance.unlock");
    expect(actions.filter((a) => a === "attendance.edit_locked").length).toBe(1);
    expect(actions).not.toContain("attendance.relock");
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
    const unlocked = await post(f, "/api/v1/attendance/unlock", { sessionId: sid });
    expect(unlocked.status).toBe(200);
    const res = await get(f, "/api/v1/attendance", `?date=${daysAgoDate(2)}`);
    expect(res.status).toBe(200);
    const session = res.body.data?.["session"] as Record<string, unknown> | null;
    expect(session).not.toBeNull();
    expect(typeof session?.["unlock_window_expires_at"]).toBe("string");
    expect(session?.["hard_locked"]).toBe(false);
  });
});
