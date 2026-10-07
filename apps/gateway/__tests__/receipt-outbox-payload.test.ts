// Implements: AGENTS.md §3.5 (ONE money flow — the two I/O dialects must not
// drift), Rule 7 / 12_Business_Rules.md BR-SYN-01 (every mutation appends its
// `sync_outbox` row in the same transaction), 11_Data_Model.md §4.12 (the
// canonical `receipts` row), and 07_Fees_and_Payments.md §9.6 step 4.
//
// The defect this pins: `POST /api/v1/ledger/payment` wrote its receipt outbox
// payload with the RETIRED key `receipt_no` while the row it describes went into
// the canonical `number` column, and omitted `id`, `tenant_id`, `payment_ref`,
// `tamper_hash`, `created_at` and `updated_at`. A replica that replayed the
// payload looked for a column that stopped existing at migration 0002, and the
// payload could not satisfy the NOT NULL contract of the table it claimed to
// describe — so it could not succeed on a canonical database either.
//
// The reference is `packages/core/src/fees.ts` `insertReceiptRow` (lines
// 178-198): the SAME logical row, so the assertion below is a parity assertion,
// not a snapshot of whatever this route happens to emit.
import { describe, expect, it } from "vitest";
import { handleLedger } from "../routes/ledger.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

async function pay(
  fixture: LedgerFixture,
  body: Record<string, unknown>,
): Promise<{ status: number; body: ApiBody }> {
  const path = "/api/v1/ledger/payment";
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const res = await handleLedger(
    req,
    fixture.db as unknown as DB,
    fixture.tenantId,
    path,
    "POST",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error("no route matched POST /api/v1/ledger/payment");
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function receiptOutboxPayload(fx: LedgerFixture): Record<string, unknown> {
  const row = fx.db.query(
    "SELECT payload FROM sync_outbox WHERE tenant_id = ? AND table_name = 'receipts'",
    [fx.tenantId],
  )[0];
  if (!row) throw new Error("no receipts outbox row was written");
  return JSON.parse(String(row.payload)) as Record<string, unknown>;
}

describe("the receipt outbox payload is the canonical receipts row", () => {
  it("uses `number`, never the retired `receipt_no`", async () => {
    const fx = createLedgerFixture();
    const res = await pay(fx, { studentId: fx.studentId, amount: 10000 });
    expect(res.status).toBe(200);

    const payload = receiptOutboxPayload(fx);
    expect(payload.receipt_no).toBeUndefined();
    expect(payload.number).toBe(String(res.body.data?.receiptNo));

    // The row itself is in the canonical column, so the payload describes it.
    const row = fx.db.query("SELECT number FROM receipts WHERE tenant_id = ?", [fx.tenantId])[0];
    expect(row?.number).toBe(payload.number);
  });

  it("carries every NOT NULL column of the canonical shape", async () => {
    const fx = createLedgerFixture();
    const res = await pay(fx, {
      studentId: fx.studentId,
      amount: 10000,
      method: "upi",
      occurredOn: "2026-10-04",
    });
    expect(res.status).toBe(200);

    const payload = receiptOutboxPayload(fx);
    // The exact key set `packages/core/src/fees.ts:183-197` emits, no more and
    // no less — a drifting key set is the defect this file exists to catch.
    expect(Object.keys(payload).sort()).toEqual([
      "amount",
      "created_at",
      "id",
      "invoice_id",
      "ledger_entry_id",
      "number",
      "payment_method",
      "payment_ref",
      "received_on",
      "student_id",
      "tamper_hash",
      "tenant_id",
      "updated_at",
    ]);

    // Values mirror the committed row, so a replica can apply it verbatim.
    const row = fx.db.query("SELECT * FROM receipts WHERE tenant_id = ?", [fx.tenantId])[0];
    expect(payload.id).toBe(row?.id);
    expect(payload.tenant_id).toBe(fx.tenantId);
    expect(payload.student_id).toBe(fx.studentId);
    expect(payload.amount).toBe(10000);
    expect(payload.payment_method).toBe("upi");
    expect(payload.received_on).toBe("2026-10-04");
    expect(payload.payment_ref).toBeNull();
    expect(payload.invoice_id).toBeNull();
    expect(payload.tamper_hash).toBe(row?.tamper_hash);
    expect(payload.created_at).toBe(row?.created_at);
    expect(payload.updated_at).toBe(row?.updated_at);
    expect(String(payload.created_at)).not.toBe("");
    expect(String(payload.updated_at)).not.toBe("");
  });

  it("replays onto a canonical receipts table without a single column left over", async () => {
    const fx = createLedgerFixture();
    await pay(fx, { studentId: fx.studentId, amount: 250000 });

    // Apply the payload the way a replica does: one INSERT naming exactly the
    // envelope's keys. A key the canonical table does not have aborts the
    // statement, and a NOT NULL key the payload omits aborts it too — so this
    // statement executing is the proof that neither defect survives.
    const payload = receiptOutboxPayload(fx);
    const cols = Object.keys(payload).sort();
    // A table with the canonical column set and no defaults: every NOT NULL
    // column must be supplied by the payload or nothing inserts.
    fx.db.raw.exec(`
      CREATE TABLE receipts_replay (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        number TEXT NOT NULL,
        ledger_entry_id TEXT,
        student_id TEXT NOT NULL,
        invoice_id TEXT,
        amount INTEGER NOT NULL,
        payment_method TEXT NOT NULL,
        payment_ref TEXT,
        received_on TEXT NOT NULL,
        tamper_hash TEXT,
        voided_at TEXT,
        pdf_blob_key TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const insert = fx.db.raw.prepare(
      `INSERT INTO receipts_replay (${cols.map((c) => `"${c}"`).join(",")})
       VALUES (${cols.map(() => "?").join(",")})`,
    );
    insert.run(...(cols.map((c) => payload[c]) as never[]));

    const replayed = fx.db.query("SELECT number, amount FROM receipts_replay")[0];
    expect(replayed?.number).toBe(payload.number);
    expect(Number(replayed?.amount)).toBe(250000);
  });

  it("keeps the outbox envelope itself canonical (table_name + insert op)", async () => {
    const fx = createLedgerFixture();
    await pay(fx, { studentId: fx.studentId, amount: 1000 });
    const row = fx.db.query(
      "SELECT table_name, op, row_id FROM sync_outbox WHERE tenant_id = ? AND table_name = 'receipts'",
      [fx.tenantId],
    )[0];
    expect(row?.table_name).toBe("receipts");
    // `create` is normalised to the CHECK set's `insert`.
    expect(row?.op).toBe("insert");
    expect(String(row?.row_id)).toBe(receiptOutboxPayload(fx).id);
  });
});