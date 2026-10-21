// Implements: 12_Business_Rules.md BR-RPT-04 [CRITICAL] (a credit counts only
// while it has NOT been reversed) + 14_Edge_Cases.md EC-F-05 (a voided receipt
// does not count) + 07_Fees_and_Payments.md §9.6 step 5 (the invoice's
// credited total) — and docs/audit/AUDIT-2026-10-21.md AUD-015 (the
// `paid_amount_minor` figure was built from an arbitrary, UNORDERED 200-row
// tenant-wide cap).
//
// THE DEFECT. The invoice read took a PAGE of the tenant's PAYMENT_RECEIVED
// rows — `take: 200`, no ORDER BY — and reduced it in JavaScript. That is a
// money figure taken from a SAMPLE of the rows, with no defined order: on the
// audit's own trigger (250 students, 260 payments) ~60 payments were invisible
// and their invoices read `paid_amount_minor: 0` — an invoice the tutor had
// PAID IN FULL read as unpaid, so the Fees screen showed settled invoices as
// outstanding and the tutor chased money already collected.
//
// The treatment the Dashboard's period leg got (row d52a635 / 7623693) is the
// model: the figure is a SCALAR, so the sum happens in the DATABASE, and the
// reversal exclusion is TYPE-AGNOSTIC — a voided row is excluded whatever its
// type, and so is the reversal itself.
//
// The parity discipline is the same one the period leg uses: the SQL
// aggregate and a JavaScript reference implementation of the same rule are
// compared PAISE FOR PAISE over one fixture carrying every hard case, and the
// route's own shape is asserted (the aggregate is issued, and no page of
// ledger rows is read for the figure).
import { describe, expect, it } from "vitest";
import { handleLedger } from "../routes/ledger.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: unknown;
  total?: number;
  truncated?: boolean;
  error?: string;
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

/** One ledger row, inserted directly with the attributes the rule reads. */
function insertEntry(
  fixture: LedgerFixture,
  args: {
    id: string;
    type: string;
    creditPaise: number;
    debitPaise?: number;
    invoiceId?: string | null;
    voidOfId?: string | null;
    tenantId?: string;
    createdAt?: string;
  },
): void {
  const now = args.createdAt ?? new Date().toISOString();
  fixture.db.raw
    .prepare(
      `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise,
         credit_paise, balance_after_paise, description, prev_hash, this_hash, void_of_id,
         occurred_on, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, 'gateway', ?, ?)`,
    )
    .run(
      args.id,
      args.tenantId ?? fixture.tenantId,
      fixture.studentId,
      args.invoiceId ?? null,
      args.type,
      args.debitPaise ?? 0,
      args.creditPaise,
      args.voidOfId ?? null,
      now.slice(0, 10),
      now,
      now,
    );
}

/**
 * The rule, in JavaScript — the reference the SQL aggregate is compared with.
 *
 * The candidates are the invoice's rows that are not reversals; the rows a
 * VOID row reverses are removed; the credits are summed. The exclusion does
 * NOT look at the row's type, so a voided DISCOUNT is excluded exactly like a
 * voided payment.
 */
function creditedForInvoice(fixture: LedgerFixture, invoiceId: string): number {
  const candidates = rows(
    fixture,
    `SELECT id, type, credit_paise FROM ledger_entries
      WHERE tenant_id = ? AND invoice_id = ? AND type <> 'VOID' AND void_of_id IS NULL`,
    [fixture.tenantId, invoiceId],
  );
  const reversed = new Set(
    rows(
      fixture,
      `SELECT void_of_id FROM ledger_entries
        WHERE tenant_id = ? AND type = 'VOID' AND void_of_id IS NOT NULL`,
      [fixture.tenantId],
    )
      .map((row) => String(row.void_of_id)),
  );
  let sum = 0;
  for (const row of candidates) {
    if (reversed.has(String(row.id))) continue;
    sum += Number(row.credit_paise ?? 0);
  }
  return sum;
}

/** One invoice row, inserted directly (the figure is what the test is about). */
function insertInvoice(
  fixture: LedgerFixture,
  args: { id: string; number: string; total: number; status?: string },
): void {
  const now = new Date().toISOString();
  fixture.db.raw
    .prepare(
      `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date, subtotal,
         discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 0, ?, ?, 'test-tamper-hash', ?, ?)`,
    )
    .run(
      args.id,
      fixture.tenantId,
      args.number,
      fixture.studentId,
      "2026-10-01",
      args.total,
      args.total,
      args.status ?? "partial",
      now,
      now,
    );
}

describe("AUD-015 — the invoice's credited total is aggregated in SQL", () => {
  it("the SQL aggregate and the JavaScript rule agree PAISE FOR PAISE", async () => {
    const f = createLedgerFixture();
    const invoiceId = "018f0000-0000-7000-8000-0000000000c1";
    const otherInvoice = "018f0000-0000-7000-8000-0000000000c2";
    insertInvoice(f, { id: invoiceId, number: "INV-000001", total: 100000 });
    insertInvoice(f, { id: otherInvoice, number: "INV-000002", total: 50000 });

    // A plain payment — counts.
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d1", type: "PAYMENT_RECEIVED", creditPaise: 40000, invoiceId });
    // A second payment on the same invoice — counts.
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d2", type: "PAYMENT_RECEIVED", creditPaise: 6000, invoiceId });
    // A DISCOUNT credit — counts: the credited total is EVERY live credit,
    // not only payments (the old read filtered the candidates to
    // `type = 'PAYMENT_RECEIVED'`, so this row was not counted at all).
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d3", type: "DISCOUNT_GRANTED", creditPaise: 1500, invoiceId });
    // A VOIDED payment — does NOT count: the reversal names it.
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d4", type: "PAYMENT_RECEIVED", creditPaise: 9000, invoiceId });
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d5", type: "VOID", creditPaise: 0, debitPaise: 9000, invoiceId, voidOfId: "018f0000-0000-7000-8000-0000000000d4" });
    // A VOIDED DISCOUNT — does NOT count either: the exclusion is
    // TYPE-AGNOSTIC (this is the case the period leg got wrong).
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d6", type: "DISCOUNT_GRANTED", creditPaise: 700, invoiceId });
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d7", type: "VOID", creditPaise: 0, debitPaise: 700, invoiceId, voidOfId: "018f0000-0000-7000-8000-0000000000d6" });
    // A payment with no invoice — an ADVANCE: attributed to no invoice.
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d8", type: "PAYMENT_RECEIVED", creditPaise: 5000, invoiceId: null });
    // Another tenant's payment — not this tenant's money.
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000d9", type: "PAYMENT_RECEIVED", creditPaise: 999999, invoiceId, tenantId: "018f0000-0000-7000-8000-0000000000ff" });
    // A credit on a DIFFERENT invoice — not this one's.
    insertEntry(f, { id: "018f0000-0000-7000-8000-0000000000da", type: "PAYMENT_RECEIVED", creditPaise: 1234, invoiceId: otherInvoice });

    // The rule, in JavaScript.
    const expected = creditedForInvoice(f, invoiceId);
    expect(expected).toBe(47500); // 40000 + 6000 + 1500

    // The route's figure is the same number, and the other invoice's is its
    // own — no cross-contamination between invoices.
    const res = await get(f, "/api/v1/ledger/invoices");
    const list = res.body.data as Array<{ id: string; paid_amount_minor: number }>;
    expect(Number(list.find((r) => r.id === invoiceId)?.paid_amount_minor)).toBe(expected);
    expect(Number(list.find((r) => r.id === otherInvoice)?.paid_amount_minor)).toBe(1234);
  });

  it("the aggregate is issued, and the figure is not built from a page of ledger rows", async () => {
    const f = createLedgerFixture();
    // The statements the route issues are visible on the handle.
    const issued: string[] = [];
    const original = f.db.execute.bind(f.db);
    f.db.execute = (stmt: unknown) => {
      const sql = typeof stmt === "object" && stmt !== null && "sql" in stmt
        ? String((stmt as { sql: unknown }).sql)
        : String(stmt);
      issued.push(sql);
      return original(stmt);
    };

    await get(f, "/api/v1/ledger/invoices");

    // ONE aggregate over the ledger, grouped by invoice …
    const aggregates = issued.filter((sql) => sql.includes("GROUP BY invoice_id"));
    expect(aggregates.length).toBe(1);
    // … and NO page of the tenant's ledger rows for the figure.
    const ledgerReads = issued.filter(
      (sql) => sql.includes("FROM ledger_entries") && !sql.includes("GROUP BY invoice_id"),
    );
    expect(ledgerReads).toEqual([]);
  });

  it("a tenant with MORE than 200 payments still reads the full credited total (AUD-015)", async () => {
    const f = createLedgerFixture();
    const invoiceId = "018f0000-0000-7000-8000-8000-0000000000e1";
    insertInvoice(f, { id: invoiceId, number: "INV-000001", total: 25000 });
    // The audit's trigger: 250 payments against one invoice. The old read
    // took 200 of them — an arbitrary, unordered subset — so the figure was
    // 5,000 paise short of the truth.
    for (let index = 0; index < 250; index += 1) {
      insertEntry(f, {
        id: `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`,
        type: "PAYMENT_RECEIVED",
        creditPaise: 100,
        invoiceId,
      });
    }

    const expected = creditedForInvoice(f, invoiceId);
    expect(expected).toBe(25000);

    // The ROUTE's figure: the same number. With the old 200-row read it read
    // 20,000 — 5,000 paise short, and short by a DIFFERENT amount on a
    // different day, because the subset was unordered.
    const res = await get(f, "/api/v1/ledger/invoices");
    const list = res.body.data as Array<{ id: string; paid_amount_minor: number }>;
    expect(Number(list.find((r) => r.id === invoiceId)?.paid_amount_minor)).toBe(25000);
  });

  it("the envelope discloses the population size and the truncation", async () => {
    const f = createLedgerFixture();
    const res = await get(f, "/api/v1/ledger/invoices");
    expect(res.body.success).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.truncated).toBe("boolean");
  });
});
