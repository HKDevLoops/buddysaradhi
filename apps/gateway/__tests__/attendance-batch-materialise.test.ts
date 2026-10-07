// Implements: 06_Attendance.md §6/§9.2 (a mark belongs to a batch and the
// batch dimension must be selectable) + 11_Data_Model.md §4.3 + Rule 7 / BR-SYN-01.
//
// The gap this pins: `attendance_sessions.batch_id` is NOT NULL, so both writers
// of a mark resolve a batch-less mark to the `batch-default` sentinel. The web
// writer (`apps/web/src/server/actions/attendance.ts` `ensureBatch`) also
// INSERTS the `batches` row. The edge writer did not: `POST /api/v1/attendance`
// created a session pointing at `batch-default` that did not exist in
// `batches`, so `GET /api/v1/attendance/batches` — which reads `batches`, the
// only table the batch selector can render — answered `[]` and the toolbar
// said "No batches yet" while marks were landing in that very batch.
//
// Every mark therefore has to MATERIALISE its batch row, in the same write
// transaction as the session (Rule 7): the insert, its `sync_outbox` row and
// its `audit_log` row commit together or not at all.
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Read straight off the fixture (see `SqliteGatewayDb.query`). */
function query(
  fx: LedgerFixture,
  sql: string,
  args: unknown[] = [],
): Record<string, unknown>[] {
  return fx.db.query(sql, args);
}

function count(fx: LedgerFixture, sql: string, args: unknown[] = []): number {
  const row = query(fx, sql, args)[0];
  return Number(row?.c ?? 0);
}

function newKey(n: number): string {
  return `018f0000-0000-7000-9000-${String(n).padStart(12, "0")}`;
}

async function postMark(
  fx: LedgerFixture,
  body: Record<string, unknown>,
  key: string,
): Promise<{ status: number; body: ApiBody }> {
  const path = "/api/v1/attendance";
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  const res = await handleAttendance(
    req,
    fx.db as unknown as DB,
    fx.tenantId,
    path,
    "POST",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error("no route matched POST /api/v1/attendance");
  return { status: res.status, body: (await res.json()) as ApiBody };
}

async function getBatches(fx: LedgerFixture): Promise<ApiBody> {
  const path = "/api/v1/attendance/batches";
  const req = new Request(`https://api.buddysaradhi.app${path}`, { method: "GET" });
  const res = await handleAttendance(
    req,
    fx.db as unknown as DB,
    fx.tenantId,
    path,
    "GET",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error("no route matched GET /api/v1/attendance/batches");
  return (await res.json()) as ApiBody;
}

describe("a mark through the edge materialises the batch it writes into", () => {
  it("creates the batch-default row so the selector can render it", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);

    const mark = await postMark(
      fx,
      { session_date: today(), updates: [{ student_id: fx.studentId, status: "present" }] },
      newKey(1),
    );
    expect(mark.status).toBe(200);

    // The session really points at the sentinel.
    const session = query(fx, "SELECT batch_id FROM attendance_sessions WHERE session_date = ?", [
      today(),
    ])[0];
    expect(String(session?.batch_id)).toBe("batch-default");

    // …and that sentinel is now a row a tutor can select.
    const batches = await getBatches(fx);
    expect(batches.success).toBe(true);
    expect(batches.data).toEqual([
      { id: "batch-default", name: "General Batch", subject: null },
    ]);
  });

  it("does not duplicate or rename an existing batch row", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    const now = new Date().toISOString();
    fx.db.raw
      .prepare(
        `INSERT INTO batches (id, tenant_id, name, subject, created_at, updated_at)
         VALUES ('batch-default', ?, 'Class 10 — Maths', 'Maths', ?, ?)`,
      )
      .run(fx.tenantId, now, now);

    const mark = await postMark(
      fx,
      { session_date: today(), updates: [{ student_id: fx.studentId, status: "present" }] },
      newKey(2),
    );
    expect(mark.status).toBe(200);

    expect(
      count(fx, "SELECT COUNT(*) AS c FROM batches WHERE tenant_id = ? AND id = 'batch-default'", [
        fx.tenantId,
      ]),
    ).toBe(1);
    // The tutor's own name survives — the edge must never relabel a real batch.
    const listed = await getBatches(fx);
    expect(listed.data).toEqual([
      { id: "batch-default", name: "Class 10 — Maths", subject: "Maths" },
    ]);
  });

  it("refuses a named batch that does not exist instead of fabricating one", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    const ghostBatch = "018f0000-0000-7000-8000-00000000abcd";

    const mark = await postMark(
      fx,
      {
        session_date: today(),
        batch_id: ghostBatch,
        updates: [{ student_id: fx.studentId, status: "absent" }],
      },
      newKey(3),
    );
    expect(mark.status).toBe(422);
    expect(mark.body.error).toContain("BATCH_NOT_FOUND");

    // Nothing was invented, and nothing half-written survived the refusal.
    expect(
      count(fx, "SELECT COUNT(*) AS c FROM batches WHERE tenant_id = ?", [fx.tenantId]),
    ).toBe(0);
    expect(
      count(fx, "SELECT COUNT(*) AS c FROM attendance_sessions WHERE tenant_id = ?", [fx.tenantId]),
    ).toBe(0);
    expect((await getBatches(fx)).data).toEqual([]);
  });

  it("records the default batch's creation in sync_outbox + audit_log", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);

    await postMark(
      fx,
      { session_date: today(), updates: [{ student_id: fx.studentId, status: "present" }] },
      newKey(5),
    );

    // Rule 7 / BR-SYN-01 — the row replicates and is auditable.
    expect(
      count(
        fx,
        "SELECT COUNT(*) AS c FROM sync_outbox WHERE tenant_id = ? AND table_name = 'batches' AND op = 'insert'",
        [fx.tenantId],
      ),
    ).toBe(1);
    const outboxRow = query(
      fx,
      "SELECT payload FROM sync_outbox WHERE tenant_id = ? AND table_name = 'batches'",
      [fx.tenantId],
    )[0];
    // The payload is the canonical snake_case row, so a replica can apply it.
    expect(JSON.parse(String(outboxRow?.payload))).toMatchObject({
      id: "batch-default",
      tenant_id: fx.tenantId,
      name: "General Batch",
      subject: null,
      archived_at: null,
    });
    expect(
      count(
        fx,
        "SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND action = 'attendance.batch_ensure'",
        [fx.tenantId],
      ),
    ).toBe(1);
  });

  it("writes nothing extra when the batch already exists", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    const now = new Date().toISOString();
    fx.db.raw
      .prepare(
        `INSERT INTO batches (id, tenant_id, name, created_at, updated_at)
         VALUES ('batch-default', ?, 'General Batch', ?, ?)`,
      )
      .run(fx.tenantId, now, now);

    await postMark(
      fx,
      { session_date: today(), updates: [{ student_id: fx.studentId, status: "present" }] },
      newKey(4),
    );

    expect(
      count(fx, "SELECT COUNT(*) AS c FROM sync_outbox WHERE tenant_id = ? AND table_name = 'batches'", [
        fx.tenantId,
      ]),
    ).toBe(0);
    expect(
      count(
        fx,
        "SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND action = 'attendance.batch_ensure'",
        [fx.tenantId],
      ),
    ).toBe(0);
  });
});
