// Implements: RFC-003 workstream E §2 (fee strictness parity) +
// 07_Fees_and_Payments.md §9 (closed collection-method enum, void carries a
// required reason) + 12_Business_Rules.md BR-M-01 (integer paise) + Rule 7
// (outbox + audit in the same transaction for every mutation audited here).
//
// Runs the production handlers against in-memory SQLite carrying the gateway's
// own DDL (AGENTS.md §7.3 — never mock the ledger).
import { describe, expect, it } from "vitest";
import { handleLedger } from "../routes/ledger.ts";
import { handleAttendance } from "../routes/attendance.ts";
import { handleNotifications } from "../routes/notifications.ts";
import { handleSync } from "../routes/sync.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  details?: string;
}

async function call(
  fixture: LedgerFixture,
  handler: typeof handleLedger,
  path: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method,
    // RFC-004 C1 — fail-closed on keyless mutations: every test intent mints a
    // FRESH key (harmless on reads, required on mutations).
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(
    req,
    // SAFETY: the SQLite fixture satisfies `SqlHandle` (lib/sql.ts), which is
    // the only capability the route uses at runtime.
    fixture.db as unknown as DB,
    fixture.tenantId,
    path,
    method,
    new URL(req.url),
    {},
  );
  if (!res) throw new Error(`no route matched ${method} ${path}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function rows(fixture: LedgerFixture, sql: string, args: unknown[] = []): Record<string, unknown>[] {
  return fixture.db.query(sql, args);
}

describe("fee strictness — Zod rejects before any DB touch (BR-M-01)", () => {
  it("rejects float paise with 400 VALIDATION", async () => {
    const f = createLedgerFixture();
    const res = await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 12.99,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
    expect(res.body.details).toContain("amount");
    expect(rows(f, "SELECT id FROM ledger_entries").length).toBe(0);
  });

  it("rejects negative and zero amounts", async () => {
    const f = createLedgerFixture();
    for (const amount of [-100, 0]) {
      const res = await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
        studentId: f.studentId,
        amount,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION");
    }
    expect(rows(f, "SELECT id FROM ledger_entries").length).toBe(0);
  });

  it("rejects a collection method outside the closed enum", async () => {
    const f = createLedgerFixture();
    const res = await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 1000,
      method: "bitcoin",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
    expect(res.body.details).toContain("method");
    expect(rows(f, "SELECT id FROM ledger_entries").length).toBe(0);
  });

  it("accepts every enum method (07 §9: cash | upi | card | bank | cheque | other)", async () => {
    const f = createLedgerFixture();
    for (const method of ["cash", "upi", "card", "bank", "cheque", "other"]) {
      const res = await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
        studentId: f.studentId,
        amount: 1000,
        method,
      });
      expect(res.status).toBe(200);
    }
    expect(rows(f, "SELECT id FROM ledger_entries").length).toBe(6);
  });

  it("rejects non-UUID student ids and non-ISO dates", async () => {
    const f = createLedgerFixture();
    const badId = await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: "not-a-uuid",
      amount: 1000,
    });
    expect(badId.status).toBe(400);
    expect(badId.body.error).toBe("VALIDATION");

    const badDate = await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 1000,
      occurredOn: "04-01-2026",
    });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("VALIDATION");
    expect(rows(f, "SELECT id FROM ledger_entries").length).toBe(0);
  });

  it("rejects float paise on the invoice route", async () => {
    const f = createLedgerFixture();
    const res = await call(f, handleLedger, "/api/v1/ledger/invoice", "POST", {
      studentId: f.studentId,
      amount: 99.99,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
    expect(rows(f, "SELECT id FROM invoices").length).toBe(0);
  });
});

describe("void requires a reason + posts a reversing entry (Rule 1, BR-LED-04/05)", () => {
  it("rejects a void with no reason (was: defaulted to 'Voided via Gateway')", async () => {
    const f = createLedgerFixture();
    await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 1000,
    });
    const entryId = rows(f, "SELECT id FROM ledger_entries")[0]?.id as string;

    const res = await call(f, handleLedger, "/api/v1/ledger/void", "POST", { entryId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
    expect(res.body.details).toContain("reason");
    expect(rows(f, "SELECT id FROM ledger_entries WHERE type = 'VOID'").length).toBe(0);
  });

  it("rejects a blank reason", async () => {
    const f = createLedgerFixture();
    await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 1000,
    });
    const entryId = rows(f, "SELECT id FROM ledger_entries")[0]?.id as string;

    const res = await call(f, handleLedger, "/api/v1/ledger/void", "POST", {
      entryId,
      reason: "   ",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
  });

  it("a reasoned void still posts the reversing entry with audit metadata", async () => {
    const f = createLedgerFixture();
    await call(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 1000,
    });
    const entryId = rows(f, "SELECT id FROM ledger_entries")[0]?.id as string;

    const res = await call(f, handleLedger, "/api/v1/ledger/void", "POST", {
      entryId,
      reason: "duplicate collection",
    });
    expect(res.status).toBe(200);
    const audit = rows(f, "SELECT metadata FROM audit_log WHERE action = 'ledger.void'");
    expect(audit.length).toBe(1);
    expect(String(audit[0]?.metadata)).toContain("duplicate collection");
  });
});

describe("Rule 7 — every audited mutation writes outbox + audit in one transaction", () => {
  // attendance_sessions.batch_id is NOT NULL in the gateway DDL, so marks
  // carry a batch. (A null batch — web's "all" selection — currently fails at
  // the DB layer; fixing that needs a migration, reported as a spec
  // amendment, not changed here.)
  const BATCH_ID = "018f0000-0000-7000-8000-000000000010";

  it("attendance mark writes sync_outbox + audit_log alongside the records", async () => {
    const f = createLedgerFixture();
    const today = new Date().toISOString().slice(0, 10);
    const res = await call(f, handleAttendance, "/api/v1/attendance", "POST", {
      session_date: today,
      batch_id: BATCH_ID,
      updates: [{ student_id: f.studentId, status: "present" }],
    });
    expect(res.status).toBe(200);
    expect(
      rows(f, "SELECT id FROM sync_outbox WHERE table_name = 'attendance_sessions'").length,
    ).toBe(1);
    expect(rows(f, "SELECT id FROM audit_log WHERE action = 'attendance.mark'").length).toBe(1);
  });

  it("attendance mark rejects an unknown status with 400 VALIDATION", async () => {
    const f = createLedgerFixture();
    const res = await call(f, handleAttendance, "/api/v1/attendance", "POST", {
      session_date: new Date().toISOString().slice(0, 10),
      batch_id: BATCH_ID,
      updates: [{ student_id: f.studentId, status: "maybe" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
  });

  it("attendance lock writes sync_outbox (was: audit only)", async () => {
    const f = createLedgerFixture();
    const today = new Date().toISOString().slice(0, 10);
    const marked = await call(f, handleAttendance, "/api/v1/attendance", "POST", {
      session_date: today,
      batch_id: BATCH_ID,
      updates: [{ student_id: f.studentId, status: "present" }],
    });
    const sessionId = (marked.body.data as { sessionId: string }).sessionId;
    const locked = await call(f, handleAttendance, "/api/v1/attendance/lock", "POST", {
      sessionId,
    });
    expect(locked.status).toBe(200);
    expect(
      rows(
        f,
        "SELECT id FROM sync_outbox WHERE table_name = 'attendance_sessions' AND op = 'update'",
      ).length,
    ).toBe(2);
    expect(rows(f, "SELECT id FROM audit_log WHERE action = 'attendance.lock'").length).toBe(1);
  });

  it("notification create writes sync_outbox (was: audit only)", async () => {
    const f = createLedgerFixture();
    const res = await call(f, handleNotifications, "/api/v1/notifications", "POST", {
      category: "fee",
      title: "Fee due",
    });
    expect(res.status).toBe(201);
    expect(
      rows(f, "SELECT id FROM sync_outbox WHERE table_name = 'notifications'").length,
    ).toBe(1);
    expect(rows(f, "SELECT id FROM audit_log WHERE action = 'notification.create'").length).toBe(1);
  });

  it("notification create rejects an unknown category with 400 VALIDATION", async () => {
    const f = createLedgerFixture();
    const res = await call(f, handleNotifications, "/api/v1/notifications", "POST", {
      category: "spam",
      title: "Hello",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
  });

  it("sync flush rejects non-UUID ids with 400 VALIDATION, accepts an empty flush", async () => {
    const f = createLedgerFixture();
    const bad = await call(f, handleSync, "/api/v1/sync/outbox", "POST", {
      ids: ["not-a-uuid"],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("VALIDATION");

    const empty = await call(f, handleSync, "/api/v1/sync/outbox", "POST", {});
    expect(empty.status).toBe(200);
  });
});
