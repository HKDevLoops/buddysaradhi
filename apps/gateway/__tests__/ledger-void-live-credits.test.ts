// Implements: 12_Business_Rules.md BR-LED-09 ("Voiding a FEE_CHARGED is
// permitted only if no PAYMENT_RECEIVED credits it") + BR-RPT-04 [CRITICAL]
// ("a credit counts only while it has NOT been reversed"), 14_Edge_Cases.md
// EC-F-05 (voiding a payment that closed an invoice) + EC-F-06 (voiding a fee
// charge with payments against it), and docs/audit/AUDIT-2026-10-21.md
// AUD-014 — the gateway's SHIPPED void path counted the invoice's credits with
// the defective predicate `void_of_id IS NULL` ON THE CREDIT ROW.
//
// THE DEFECT. "Credited" is not "this row is not a reversal". The ledger has no
// `reverses_entry_id` column on the ORIGINAL row (11_Data_Model.md §4.13): the
// reversal is the LATER row, a VOID entry that carries `void_of_id` pointing
// back at the row it reverses. A payment the tutor ALREADY voided is not a
// reversal row either, so it satisfied `void_of_id IS NULL` and kept counting
// as a live credit. Two consequences on the path that actually runs:
//
//   1. The correction path CLOSED. Void the receipt, then try to void the fee
//      it paid → 409 "void those receipts first" about a receipt that was
//      already voided. On an append-only ledger (Rule 1) a void is the ONLY
//      correction path, so the fee stayed on the books forever (AUD-014).
//   2. The invoice's credited total kept the voided receipt, so a paid invoice
//      read as still paid and the tutor's next payment was swallowed
//      (BR-RPT-04 [CRITICAL], EC-F-05).
//
// The negative control is the first test below: with the defective predicate
// put back, it goes RED (the charge void is refused). Every test runs against
// the REAL handler over in-memory SQLite carrying the gateway's own DDL
// (AGENTS.md §7.3 — never mock the ledger).
import { describe, expect, it } from "vitest";
import { handleLedger, gatewayFeeTx } from "../routes/ledger.ts";
import type { SqlHandle } from "../lib/sql.ts";
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
    // RFC-004 C1 — the gateway is fail-closed on keyless mutations, so every
    // test intent mints a FRESH key (reusing one would replay, not re-execute).
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

function count(fixture: LedgerFixture, table: string): number {
  return Number(rows(fixture, `SELECT COUNT(*) AS n FROM ${table}`)[0]?.n ?? 0);
}

function balanceOf(fixture: LedgerFixture): number {
  return Number(
    rows(fixture, "SELECT balance_paise FROM students WHERE tenant_id = ?", [fixture.tenantId])[0]
      ?.balance_paise,
  );
}

function entryIdOf(fixture: LedgerFixture, type: string, nth = 0): string {
  const found = rows(
    fixture,
    "SELECT id FROM ledger_entries WHERE type = ? ORDER BY created_at, rowid",
    [type],
  );
  const row = found[nth];
  if (!row) throw new Error(`no ${type} row at index ${nth}`);
  return String(row.id);
}

function invoiceIdOf(fixture: LedgerFixture): string {
  return String(
    rows(fixture, "SELECT id FROM invoices ORDER BY created_at, rowid")[0]?.id,
  );
}

describe("the shipped void path counts LIVE credits (BR-LED-09, AUD-014)", () => {
  it("a charge whose receipt was ALREADY voided can be voided — the correction path stays open (EC-F-06, AUD-014)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 40000 });
    const chargeId = entryIdOf(f, "FEE_CHARGED");
    const paymentId = entryIdOf(f, "PAYMENT_RECEIVED");

    // The tutor's order of operations: the receipt was wrong, so it goes
    // first (EC-F-06: "Void those receipts first").
    const voidedReceipt = await post(f, "/api/v1/ledger/void", {
      entryId: paymentId,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });
    expect(voidedReceipt.status).toBe(200);

    // Now the fee. With the defective predicate the voided receipt still
    // counted as a live credit and this was a 409 — the fee could never be
    // removed, and on an append-only ledger there is no other way.
    const voidedCharge = await post(f, "/api/v1/ledger/void", {
      entryId: chargeId,
      reason: "fee plan corrected",
      pinProof: f.pinProof,
    });
    expect(voidedCharge.status).toBe(200);
    expect(balanceOf(f)).toBe(0);

    // Two reversing rows: the receipt's and the charge's, each mirroring its
    // original (BR-LED-04).
    const voids = rows(f, "SELECT void_of_id, debit_paise, credit_paise FROM ledger_entries WHERE type = 'VOID'");
    expect(voids.length).toBe(2);
    const chargeVoid = voids.find((v) => String(v.void_of_id) === chargeId);
    expect(Number(chargeVoid?.credit_paise)).toBe(100000);
    expect(Number(chargeVoid?.debit_paise)).toBe(0);
  });

  it("a charge with a LIVE receipt is refused, and the refusal writes nothing (BR-LED-09, EC-F-06)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 40000 });
    const chargeId = entryIdOf(f, "FEE_CHARGED");

    const before = {
      voids: count(f, "ledger_entries"),
      audits: count(f, "audit_log"),
      outbox: count(f, "sync_outbox"),
    };

    const refused = await post(f, "/api/v1/ledger/void", {
      entryId: chargeId,
      reason: "fee plan corrected",
      pinProof: f.pinProof,
    });

    expect(refused.status).toBe(409);
    // The typed code the web dispatches on (apps/web/src/server/actions/fees.ts
    // `mapVoidGatewayError` matches it case-insensitively) and the
    // tutor-facing half of EC-F-06: "void those receipts first".
    expect(refused.body.error).toMatch(/CHARGE_HAS_CREDITS/i);
    expect(refused.body.error).toMatch(/void those receipts first/i);

    // NOTHING was written: no reversing row, no audit row, no outbox row, and
    // the balance still reads the money the tutor is owed.
    expect(count(f, "ledger_entries")).toBe(before.voids);
    expect(count(f, "audit_log")).toBe(before.audits);
    expect(count(f, "sync_outbox")).toBe(before.outbox);
    expect(rows(f, "SELECT id FROM ledger_entries WHERE type = 'VOID'").length).toBe(0);
    expect(balanceOf(f)).toBe(60000);
  });

  it("a charge with one voided receipt AND one live receipt is still refused (BR-LED-09)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 40000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 30000 });
    const chargeId = entryIdOf(f, "FEE_CHARGED");
    const [firstPayment, secondPayment] = rows(
      f,
      "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED' ORDER BY created_at, rowid",
    ).map((r) => String(r.id));

    // Void the first receipt; the second one is still live against the same
    // invoice, so the charge must stay protected (the fix must not OPEN the
    // path it closes).
    const voided = await post(f, "/api/v1/ledger/void", {
      entryId: firstPayment,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });
    expect(voided.status).toBe(200);

    const refused = await post(f, "/api/v1/ledger/void", {
      entryId: chargeId,
      reason: "fee plan corrected",
      pinProof: f.pinProof,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/CHARGE_HAS_CREDITS/i);
    expect(secondPayment.length).toBeGreaterThan(0);
  });

  it("the invoice's credited total drops when its receipt is voided (BR-RPT-04 [CRITICAL], EC-F-05)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 40000 });
    const invoiceId = invoiceIdOf(f);
    const paymentId = entryIdOf(f, "PAYMENT_RECEIVED");

    const before = await get(f, "/api/v1/ledger/invoices");
    const paidBefore = Number(
      (before.body.data as Array<{ id: string; paid_amount_minor: number }>)
        .find((r) => r.id === invoiceId)?.paid_amount_minor,
    );
    expect(paidBefore).toBe(40000);

    await post(f, "/api/v1/ledger/void", {
      entryId: paymentId,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });

    // The voided receipt does NOT count as money received any more.
    const after = await get(f, "/api/v1/ledger/invoices");
    const paidAfter = Number(
      (after.body.data as Array<{ id: string; paid_amount_minor: number }>)
        .find((r) => r.id === invoiceId)?.paid_amount_minor,
    );
    expect(paidAfter).toBe(0);
  });

  it("the gateway's FeeTx dialect agrees with core: a voided receipt is not credited (AGENTS.md §3.5)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 40000 });
    const invoiceId = invoiceIdOf(f);
    const paymentId = entryIdOf(f, "PAYMENT_RECEIVED");

    // SAFETY: the SQLite fixture satisfies `SqlHandle` (lib/sql.ts) — the same
    // structural cast the route itself makes.
    const feeTx = gatewayFeeTx(f.db as unknown as SqlHandle, f.tenantId);
    expect(await feeTx.creditedForInvoice(f.tenantId, invoiceId)).toBe(40000);

    await post(f, "/api/v1/ledger/void", {
      entryId: paymentId,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });

    // Core's two dialects (packages/core/src/fees.ts, feesPrisma.ts) both say
    // zero here. The gateway is the THIRD dialect of the same flow; a
    // different number here is a different set of books (AGENTS.md §3.5).
    expect(await feeTx.creditedForInvoice(f.tenantId, invoiceId)).toBe(0);
  });
});
