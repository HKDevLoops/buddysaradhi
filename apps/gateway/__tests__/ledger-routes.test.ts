// Implements: audit 2026-09-26 G2/G3/G4/G8 (reviews/overhaul-audit-report-
// 2026-09-26.md §2, "Gateway ledger route — unvalidated money, stale-balance
// race, void defects") against 12_Business_Rules.md BR-LED-01/03/04/05/06,
// BR-RC-01, BR-SYN-01 and 07_Fees_and_Payments.md §9.6–§9.10, plus
// 14_Edge_Cases.md EC-F-02 / EC-F-05 / EC-F-08.
//
// Runs the production handlers against in-memory SQLite carrying the gateway's
// own DDL (AGENTS.md §7.3 — never mock the ledger), so the append-only
// triggers and the RETURNING-based sequence are the real ones.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleLedger } from "../routes/ledger.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { run } from "../lib/sql.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, TEST_TENANT_SECRET, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

function dataOf<T>(body: ApiBody): T {
  // SAFETY: the test asserts on a payload shape this route owns.
  return body.data as T;
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
    // SAFETY: the SQLite fixture satisfies `SqlHandle` (lib/sql.ts), which is
    // the only capability the route uses at runtime — the `DB` marker type is
    // the libsql client it is structurally replaced by here.
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

function rows(fixture: LedgerFixture, sql: string, args: unknown[] = []): Record<string, unknown>[] {
  return fixture.db.query(sql, args);
}

function balanceOf(fixture: LedgerFixture): number {
  const row = rows(fixture, "SELECT balance_paise FROM students WHERE tenant_id = ?", [
    fixture.tenantId,
  ])[0];
  return Number(row?.balance_paise);
}

function sequenceOf(fixture: LedgerFixture, column: "next_receipt_seq" | "next_invoice_seq"): number {
  const row = rows(fixture, `SELECT ${column} FROM settings WHERE tenant_id = ?`, [
    fixture.tenantId,
  ])[0];
  return Number(row?.[column]);
}

/** sha256 chain over the exact bytes packages/core/src/ledger.ts:29-41 hashes. */
function coreHash(
  prevHash: string | null,
  payload: string,
  createdAt: string,
  tenantSecret: string,
): string {
  const hash = createHash("sha256");
  if (prevHash) hash.update(prevHash);
  hash.update(payload);
  hash.update(createdAt);
  hash.update(tenantSecret);
  return hash.digest("hex");
}

describe("gateway ledger routes — audit G2/G3/G4/G8", () => {
  it("G3: receipt numbers come from settings.next_receipt_seq, one atomic increment (BR-LED-03)", async () => {
    const f = createLedgerFixture();

    const first = await post(f, "/api/v1/ledger/payment", {
      studentId: f.studentId,
      amount: 10000,
    });
    const second = await post(f, "/api/v1/ledger/payment", {
      studentId: f.studentId,
      amount: 5000,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(dataOf<{ receiptNo: string; newBalance: number }>(first.body).receiptNo).toBe(
      "RCP-000001",
    );
    expect(dataOf<{ receiptNo: string; newBalance: number }>(second.body).receiptNo).toBe(
      "RCP-000002",
    );
    expect(sequenceOf(f, "next_receipt_seq")).toBe(3);
    expect(
      rows(f, "SELECT number FROM receipts ORDER BY number").map((r) => r.number),
    ).toEqual(["RCP-000001", "RCP-000002"]);
  });

  it("G3: a voided receipt keeps its number and the sequence is never decremented (BR-RC-01)", async () => {
    const f = createLedgerFixture();
    const a = await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 10000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 20000 });

    const entryId = rows(
      f,
      "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED' ORDER BY rowid LIMIT 1",
    )[0]?.id as string;
    const voided = await post(f, "/api/v1/ledger/void", { entryId, reason: "wrong amount" });
    expect(voided.status).toBe(200);

    const third = await post(f, "/api/v1/ledger/payment", {
      studentId: f.studentId,
      amount: 3000,
    });
    expect(dataOf<{ receiptNo: string }>(third.body).receiptNo).toBe("RCP-000003");
    expect(sequenceOf(f, "next_receipt_seq")).toBe(4);
    expect(dataOf<{ receiptNo: string }>(a.body).receiptNo).toBe("RCP-000001");
  });

  it("G3: invoice numbers come from settings.next_invoice_seq (07 §9.7)", async () => {
    const f = createLedgerFixture();
    const first = await post(f, "/api/v1/ledger/invoice", {
      studentId: f.studentId,
      amount: 100000,
    });
    const second = await post(f, "/api/v1/ledger/invoice", {
      studentId: f.studentId,
      amount: 25000,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(sequenceOf(f, "next_invoice_seq")).toBe(3);
    expect(
      rows(f, "SELECT number FROM invoices ORDER BY number").map((r) => r.number),
    ).toEqual(["INV-000001", "INV-000002"]);
  });

  it("G2: voiding a payment restores the balance from the chain tip (BR-LED-04)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    const payment = await post(f, "/api/v1/ledger/payment", {
      studentId: f.studentId,
      amount: 40000,
    });
    expect(dataOf<{ newBalance: number }>(payment.body).newBalance).toBe(60000);

    const paymentEntry = rows(
      f,
      "SELECT id, receipt_no FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'",
    )[0];
    const voided = await post(f, "/api/v1/ledger/void", {
      entryId: paymentEntry.id,
      reason: "duplicate entry",
    });

    expect(voided.status).toBe(200);
    expect(dataOf<{ newBalance: number }>(voided.body).newBalance).toBe(100000);
    expect(balanceOf(f)).toBe(100000);

    const voidRow = rows(f, "SELECT * FROM ledger_entries WHERE type = 'VOID'")[0];
    expect(Number(voidRow.debit_paise)).toBe(40000);
    expect(Number(voidRow.credit_paise)).toBe(0);
    expect(voidRow.void_of_id).toBe(paymentEntry.id);
    expect(String(voidRow.description)).toBe("VOID: duplicate entry");

    // EC-F-05 — the receipt is marked voided in the same transaction.
    const receipt = rows(f, "SELECT voided_at FROM receipts WHERE number = ?", [
      paymentEntry.receipt_no,
    ])[0];
    expect(receipt.voided_at).not.toBeNull();
  });

  it("G4: voiding a FEE_CHARGED reverses the debit instead of posting a net-zero row", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    expect(balanceOf(f)).toBe(100000);

    const chargeEntry = rows(
      f,
      "SELECT id FROM ledger_entries WHERE type = 'FEE_CHARGED'",
    )[0]?.id as string;
    const voided = await post(f, "/api/v1/ledger/void", {
      entryId: chargeEntry,
      reason: "fee plan corrected",
    });

    expect(voided.status).toBe(200);
    expect(dataOf<{ newBalance: number }>(voided.body).newBalance).toBe(0);
    expect(balanceOf(f)).toBe(0);

    const voidRow = rows(f, "SELECT * FROM ledger_entries WHERE type = 'VOID'")[0];
    expect(Number(voidRow.debit_paise)).toBe(0);
    expect(Number(voidRow.credit_paise)).toBe(100000);
    expect(voidRow.void_of_id).toBe(chargeEntry);
  });

  it("G4: VOID-of-VOID and double-void are 409 conflicts (BR-LED-05 / BR-LED-04)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 10000 });
    const entryId = rows(
      f,
      "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'",
    )[0]?.id as string;

    const first = await post(f, "/api/v1/ledger/void", { entryId, reason: "first" });
    expect(first.status).toBe(200);
    const voidId = dataOf<{ voidId: string }>(first.body).voidId;

    const doubleVoid = await post(f, "/api/v1/ledger/void", { entryId, reason: "again" });
    expect(doubleVoid.status).toBe(409);
    expect(doubleVoid.body.error).toBe("entry_already_voided");

    const voidOfVoid = await post(f, "/api/v1/ledger/void", {
      entryId: voidId,
      reason: "recursively",
    });
    expect(voidOfVoid.status).toBe(409);
    expect(voidOfVoid.body.error).toBe("cannot_void_a_void_entry");

    // Exactly one reversing row — neither conflict wrote anything.
    expect(rows(f, "SELECT id FROM ledger_entries WHERE type = 'VOID'").length).toBe(1);
  });

  it("G4: the void reason lands in audit_log metadata (BR-LED-04, 07 §9.10)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 7500 });
    const entryId = rows(
      f,
      "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'",
    )[0]?.id as string;

    await post(f, "/api/v1/ledger/void", { entryId, reason: "Parent paid twice" });

    const audit = rows(
      f,
      "SELECT ref_id, metadata FROM audit_log WHERE action = 'ledger.void'",
    );
    expect(audit.length).toBe(1);
    expect(String(audit[0]?.metadata)).toContain("Parent paid twice");
    expect(audit[0]?.ref_id).toBe(entryId);
  });

  it("G8: an overpayment is an advance — the Math.max(0, …) clamp is gone (EC-F-02, EC-F-08)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 50000 });
    const payment = await post(f, "/api/v1/ledger/payment", {
      studentId: f.studentId,
      amount: 80000,
    });

    expect(payment.status).toBe(200);
    expect(dataOf<{ newBalance: number }>(payment.body).newBalance).toBe(-30000);
    expect(balanceOf(f)).toBe(-30000);

    const entry = rows(
      f,
      "SELECT balance_after_paise FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'",
    )[0];
    expect(Number(entry.balance_after_paise)).toBe(-30000);
  });

  it("G2: concurrent payments serialise — no lost update, and the chain links (BR-LED-06)", async () => {
    const f = createLedgerFixture();

    const [a, b] = await Promise.all([
      post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 10000 }),
      post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 5000 }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Both writes landed: 0 - 10000 - 5000. The old code read a stale
    // `students.balance_paise` for both and kept only the last one.
    expect(balanceOf(f)).toBe(-15000);

    const receipts = rows(f, "SELECT number FROM receipts ORDER BY number").map(
      (r) => r.number,
    );
    expect(receipts).toEqual(["RCP-000001", "RCP-000002"]);

    const entries = rows(
      f,
      "SELECT prev_hash, this_hash, balance_after_paise FROM ledger_entries ORDER BY created_at, rowid",
    );
    expect(entries.length).toBe(2);
    expect(entries[0]?.prev_hash).toBeNull();
    expect(entries[1]?.prev_hash).toBe(entries[0]?.this_hash);
    expect(Number(entries[1]?.balance_after_paise)).toBe(-15000);

    // 07_Fees_and_Payments.md §9.6 + BR-LED-06: `created_at` is strictly
    // monotonic, so core's reconcileLedger (`ORDER BY created_at ASC`, no
    // secondary key) walks the chain in link order even when both rows land in
    // the same millisecond.
    const times = rows(
      f,
      "SELECT created_at FROM ledger_entries ORDER BY rowid",
    ).map((r) => String(r.created_at));
    expect(times.length).toBe(2);
    expect(times[1]! > times[0]!).toBe(true);
  });

  it("BR-LED-06: rows pass core's reconcileLedger — hash byte-identical, running balance exact", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 25000 });

    const entries = rows(
      f,
      `SELECT id, student_id, type, debit_paise, credit_paise, balance_after_paise,
              occurred_on, created_at, prev_hash, this_hash
         FROM ledger_entries ORDER BY created_at, rowid`,
    );
    let prevHash: string | null = null;
    for (const e of entries) {
      const payload = JSON.stringify({
        id: e.id,
        studentId: e.student_id,
        type: e.type,
        debitPaise: Number(e.debit_paise),
        creditPaise: Number(e.credit_paise),
        balanceAfterPaise: Number(e.balance_after_paise),
        occurredOn: e.occurred_on,
      });
      const expected = coreHash(
        prevHash,
        payload,
        String(e.created_at),
        TEST_TENANT_SECRET,
      );
      expect(e.this_hash).toBe(expected);
      expect(e.prev_hash).toBe(prevHash);
      prevHash = String(e.this_hash);
    }
    expect(entries.length).toBe(2);

    // reconcileLedger's balance half (packages/core/src/ledger.ts:276-285):
    // running + debit - credit must equal balance_after_paise on every row.
    let running = 0;
    for (const e of entries) {
      running = running + Number(e.debit_paise) - Number(e.credit_paise);
      expect(Number(e.balance_after_paise)).toBe(running);
    }
    expect(running).toBe(75000);
  });

  it("BR-LED-06: a ledger row without a chain hash is rejected (no more `?? \"hash\"`)", async () => {
    const f = createLedgerFixture();
    const orm = createPrismaOrm(f.db, f.tenantId);

    await expect(
      orm.ledgerEntry.create({
        data: {
          studentId: f.studentId,
          type: "PAYMENT_RECEIVED",
          debitPaise: 0,
          creditPaise: 100,
          balanceAfterPaise: -100,
          occurredOn: "2026-01-01",
        },
      }),
    ).rejects.toThrow(/this_hash is required/);
    expect(rows(f, "SELECT id FROM ledger_entries").length).toBe(0);
  });

  it("BR-LED-01: the append-only triggers abort UPDATE and DELETE (Rule 1)", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 1000 });

    expect(() => f.db.raw.exec("UPDATE ledger_entries SET description = 'tampered'")).toThrow(
      /append-only/,
    );
    expect(() => f.db.raw.exec("DELETE FROM ledger_entries")).toThrow(/append-only/);
    expect(rows(f, "SELECT description FROM ledger_entries")[0]?.description).toBe(
      "Payment received",
    );
  });

  it("Rule 7: every mutation writes sync_outbox + audit_log in the same transaction", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/invoice", { studentId: f.studentId, amount: 100000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 1000 });

    // B2 (12_Business_Rules.md BR-SYN-01) — every MUTATED table gets its own
    // outbox row, not just the ledger entry: the invoice flow bumps
    // `settings.next_invoice_seq`, writes `invoices` and the derived
    // `students.balance_paise`; the payment flow bumps `next_receipt_seq`,
    // writes `receipts` and the balance again. A replica missing any of these
    // shows a stale balance / reuses a receipt number on reconnect.
    const byTable = (table: string) =>
      rows(f, `SELECT op FROM sync_outbox WHERE table_name = '${table}'`).map((r) => r.op);
    expect(byTable("ledger_entries")).toEqual(["insert", "insert"]);
    expect(byTable("invoices")).toEqual(["insert"]);
    expect(byTable("receipts")).toEqual(["insert"]);
    expect(byTable("students")).toEqual(["update", "update"]);
    expect(byTable("settings")).toEqual(["update", "update"]);

    const actions = rows(f, "SELECT action FROM audit_log ORDER BY created_at, rowid").map(
      (r) => r.action,
    );
    expect(actions).toEqual(["ledger.invoice", "ledger.payment"]);
  });

  it("W1: a failing statement inside the transaction propagates instead of using the pipeline fallback", async () => {
    const f = createLedgerFixture();
    const tx = await f.db.transaction("write");
    try {
      // Without the guard in lib/sql.ts `run()` this would fall back to the
      // HTTP pipeline and surface `TURSO_DATABASE_URL is required` instead of
      // SQLite's own error — i.e. it would run outside BEGIN.
      await expect(run(tx, "SELECT * FROM table_that_does_not_exist")).rejects.toThrow(
        /no such table/,
      );
    } finally {
      await tx.rollback();
      tx.close();
    }
  });

  it("BR-LED-06 read consistency: GET /api/v1/ledger/invoices excludes VOID / reversal-linked rows (routes/ledger.ts:282-291)", async () => {
    const f = createLedgerFixture();
    const now = new Date().toISOString();
    const invVoidId = crypto.randomUUID();
    const invCtrlId = crypto.randomUUID();
    const voidId = crypto.randomUUID();
    const payVoidLinkedId = crypto.randomUUID();
    const payCtrlId = crypto.randomUUID();

    // Gateway POST /api/v1/ledger/payment writes unattributed PAYMENT_RECEIVED
    // rows (no invoice_id — see docs/rfc/005-unified-payment-dialect.md §1), so
    // the invoice-linkage the read filter sums over cannot be built through the
    // route. These invoice-linked rows are inserted directly to prove the READ
    // filter only (query-level `void_of_id IS NULL` + in-memory VOID guard).
    const insInvoice = f.db.raw.prepare(
      `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                             subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'hash', ?, ?)`,
    );
    insInvoice.run(invVoidId, f.tenantId, "INV-000001", f.studentId, "2026-01-01", "2026-02-01", 100000, 100000, "unpaid", now, now);
    insInvoice.run(invCtrlId, f.tenantId, "INV-000002", f.studentId, "2026-01-01", "2026-02-01", 100000, 100000, "unpaid", now, now);

    const insEntry = f.db.raw.prepare(
      `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                   balance_after_paise, description, receipt_no, void_of_id, occurred_on, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'gateway', ?, ?)`,
    );
    // Voided invoice: a PAYMENT_RECEIVED carrying a reversal link (the
    // query-level `void_of_id IS NULL` must exclude it) ...
    insEntry.run(payVoidLinkedId, f.tenantId, f.studentId, invVoidId, "PAYMENT_RECEIVED", 0, 40000, "Payment received", "RCP-000001", voidId, "2026-01-15", now, now);
    // ... plus a VOID row on the same invoice carrying credit (the in-memory
    // `e.type === "VOID"` guard must exclude it even if it reached the loop).
    insEntry.run(voidId, f.tenantId, f.studentId, invVoidId, "VOID", 0, 40000, "VOID: test", null, payVoidLinkedId, "2026-01-16", now, now);
    // Control invoice: a live payment with void_of_id NULL must be counted.
    insEntry.run(payCtrlId, f.tenantId, f.studentId, invCtrlId, "PAYMENT_RECEIVED", 0, 40000, "Payment received", "RCP-000002", null, "2026-01-15", now, now);

    const url = new URL("https://api.buddysaradhi.app/api/v1/ledger/invoices");
    const res = await handleLedger(
      new Request(url, { method: "GET" }),
      f.db as unknown as DB,
      f.tenantId,
      "/api/v1/ledger/invoices",
      "GET",
      url,
      {},
    );
    if (!res) throw new Error("no route matched GET /api/v1/ledger/invoices");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    const data = dataOf<Array<{ id: string; paid_amount_minor: number }>>(body);
    const byId = new Map(data.map((r) => [r.id, r.paid_amount_minor]));
    expect(byId.get(invVoidId)).toBe(0);
    expect(byId.get(invCtrlId)).toBe(40000);
  });
});
