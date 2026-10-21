// Implements: 14_Edge_Cases.md EC-F-05 (the receipt is marked voided AND the
// invoice status reverts, in the SAME transaction) + 12_Business_Rules.md
// BR-RPT-04 [CRITICAL] (a credit counts only while it has NOT been reversed)
// + 07_Fees_and_Payments.md §9.5 (the payment flow only offers the OPEN
// invoices) — and AGENTS.md §3.5 (the money decision lives once, in
// `packages/core/src/feesFlow.ts`, and the gateway is a DIALECT of it).
//
// THE DEFECT. The gateway's void path stamped the receipt `voided_at` and
// restored the balance, but `invoices.status` still read `paid`. Two
// consequences, and the second is the one that costs a tutor money:
//
//   1. The Fees screen said the invoice was settled while nothing was
//      credited against it.
//   2. The NEXT payment could not settle it: the payment flow only offers the
//      OPEN invoices (`unpaid|partial|overdue`, §9.5), so a payment that
//      should have settled the voided invoice was swallowed as an ADVANCE
//      (BR-FEE-15) — the tutor's books said the student still owed the fee
//      AND that the tutor held their money.
//
// The fix is the flow's, not the route's: `revertInvoiceStatusFlow` (in
// core, vendored into the gateway) recomputes the status from what is STILL
// credited, through the same port the payment path uses.
//
// The negative control is the first test below: with the revert removed, the
// invoice still reads `paid` after the void and the second payment becomes an
// advance. Every test runs against the REAL handler over in-memory SQLite
// carrying the gateway's own DDL (AGENTS.md §7.3 — never mock the ledger).
import { describe, expect, it } from "vitest";
import { handleLedger } from "../routes/ledger.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

async function post(
  fixture: LedgerFixture,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: ApiBody }> {
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
  if (!res) throw new Error(`no route matched POST ${path}`);
  return { status: res.status, body: await res.json() as ApiBody };
}

async function get(
  fixture: LedgerFixture,
  path: string,
): Promise<{ status: number; body: ApiBody }> {
  const url = new URL(`https://api.buddysaradhi.app${path}`);
  const res = await handleLedger(
    new Request(url, { method: "GET" }),
    fixture.db as unknown as DB,
    fixture.tenantId,
    path,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${path}`);
  return { status: res.status, body: await res.json() as ApiBody };
}

function rows(fixture: LedgerFixture, sql: string, args: unknown[] = []): Record<string, unknown>[] {
  return fixture.db.query(sql, args);
}

function invoiceRow(fixture: LedgerFixture): { status: string; total: number } {
  const row = rows(fixture, "SELECT status, total FROM invoices ORDER BY created_at, rowid")[0];
  return { status: String(row?.status), total: Number(row?.total) };
}

function balanceOf(fixture: LedgerFixture): number {
  return Number(
    rows(fixture, "SELECT balance_paise FROM students WHERE tenant_id = ?", [fixture.tenantId])[0]
      ?.balance_paise,
  );
}

/** The invoice's credited total, from the route the Fees screen reads. */
async function paidAmount(fixture: LedgerFixture): Promise<number> {
  const res = await get(fixture, "/api/v1/ledger/invoices");
  const list = res.body.data as unknown as Array<{ id: string; paid_amount_minor: number }>;
  return Number(list[0]?.paid_amount_minor ?? 0);
}

describe("EC-F-05 — the invoice's status reverts when its receipt is voided", () => {
  it("a voided payment leaves the invoice UNPAID, not paid", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 100000 });
    expect(invoiceRow(f).status).toBe("paid");

    const paymentId = String(
      rows(f, "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'")[0]?.id,
    );
    const voided = await post(f, "/api/v1/ledger/void", {
      entryId: paymentId,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });
    expect(voided.status).toBe(200);

    // THE MISSING WRITE. The receipt is voided and nothing is credited any
    // more, so the invoice reads `unpaid` — and never `paid`.
    expect(invoiceRow(f).status).toBe("unpaid");
    expect(await paidAmount(f)).toBe(0);
  });

  it("a voided PARTIAL payment leaves the invoice UNPAID (nothing is credited any more)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 40000 });
    expect(invoiceRow(f).status).toBe("partial");

    const paymentId = String(
      rows(f, "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'")[0]?.id,
    );
    await post(f, "/api/v1/ledger/void", {
      entryId: paymentId,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });

    expect(invoiceRow(f).status).toBe("unpaid");
  });

  it("the NEXT payment settles the voided invoice instead of becoming an advance", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 100000 });
    const paymentId = String(
      rows(f, "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'")[0]?.id,
    );
    await post(f, "/api/v1/ledger/void", {
      entryId: paymentId,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });

    // The invoice is open again, so the tutor's next payment settles it.
    const again = await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 100000 });
    expect(again.status).toBe(200);

    expect(invoiceRow(f).status).toBe("paid");
    expect(await paidAmount(f)).toBe(100000);
    // The student owes nothing and the tutor holds no advance: the charge was
    // paid once and reversed once, then paid again.
    expect(balanceOf(f)).toBe(0);
    const advances = rows(
      f,
      "SELECT id FROM ledger_entries WHERE description LIKE '[ADVANCE]%'",
    );
    expect(advances.length).toBe(0);
  });

  it("the reversing row carries the invoice it reverses, exactly as core's void does", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 100000 });
    const invoiceId = String(rows(f, "SELECT id FROM invoices")[0]?.id);
    const paymentId = String(
      rows(f, "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'")[0]?.id,
    );
    await post(f, "/api/v1/ledger/void", {
      entryId: paymentId,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });

    // Core's `postVoid` (packages/core/src/ledger.ts `voidLedgerFlow`) carries
    // `invoiceId: original.invoiceId` onto the reversing row, so the two
    // dialects write the same row. A VOID row is excluded from every credited
    // sum (`type <> 'VOID'`), so carrying it changes no figure.
    const voidRow = rows(
      f,
      "SELECT invoice_id, void_of_id FROM ledger_entries WHERE type = 'VOID'",
    )[0];
    expect(String(voidRow?.invoice_id)).toBe(invoiceId);
    expect(String(voidRow?.void_of_id)).toBe(paymentId);
  });
});
