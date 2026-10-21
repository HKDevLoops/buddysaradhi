// Implements: 12_Business_Rules.md BR-LED-09 ("Voiding a FEE_CHARGED is
// permitted only if no PAYMENT_RECEIVED credits it"), BR-LED-04 (a void is a
// new reversing row), BR-LED-05 (a VOID cannot be voided), BR-RPT-04 (the
// credited sum); 14_Edge_Cases.md EC-F-05 (the receipt is marked voided AND
// the invoice status reverts, in the SAME transaction), EC-F-06 (the refusal
// and its recovery path); 07_Fees_and_Payments.md §9.10 steps 1-5;
// docs/audit/AUDIT-2026-10-21.md AUD-014 (a payment that has ALREADY been
// voided must not keep blocking the charge's void — the correction path
// closes on an append-only ledger); AGENTS.md §2 Rule 1 (append-only),
// Rule 7 (outbox in the same transaction), Rule 9 (a refusal is a typed
// error, never a silent no-op), §3.5 (one decision, two dialects), §7.3
// (never mock the ledger).
//
// HARNESS: the SHIPPED migration (`migrations/0001_init.sql` + the forward-only
// 0004 student-money columns) on a real file-backed SQLite database, and the
// REAL writers — `createInvoiceSql` / `recordPaymentSql` (libsql dialect),
// `voidEntry` (ORM dialect, over the web's own ORM surface) and
// `voidEntrySql` (libsql dialect). Nothing is mocked: a mocked DB cannot tell
// you whether a refusal wrote anything.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type Client } from "@libsql/client";
import { createInvoiceSql, recordPaymentSql } from "./fees";
import { voidEntry } from "./ledger";
import { voidEntrySql } from "./ledgerSql";
import { createLibsqlProxy } from "../../../apps/web/src/lib/libsql-proxy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../");
const MIGRATION = resolve(REPO, "migrations/0001_init.sql");
const MIGRATION_0004 = resolve(REPO, "migrations/0004_student_money_columns.sql");

const TENANT = "tenant_void_guard";
const FEE_DATE = "2026-09-01";
const PAY_DATE = "2026-09-12";
const VOID_DATE = "2026-09-13";

interface Rig {
  client: Client;
  dir: string;
}

let rig: Rig;

async function openRig(): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), "ledger-void-guard-"));
  const file = join(dir, "tenant.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${file}` });
  await client.executeMultiple(readFileSync(MIGRATION, "utf-8"));
  await client.executeMultiple(readFileSync(MIGRATION_0004, "utf-8"));
  return { client, dir };
}

beforeEach(async () => {
  rig = await openRig();
  const now = new Date().toISOString();
  await rig.client.execute({
    sql: `INSERT INTO settings (tenant_id, tenant_secret, invoice_prefix, receipt_prefix,
            next_invoice_seq, next_receipt_seq, created_at, updated_at)
          VALUES (?, 'void-guard-secret', 'INV-', 'RCP-', 1, 1, ?, ?)`,
    args: [TENANT, now, now],
  });
});

afterEach(async () => {
  try {
    await Promise.resolve(rig.client.close());
  } catch {
    /* best effort */
  }
  // The native libSQL handle can hold the file for a moment after close, and
  // Windows refuses to remove a locked directory (EPERM). Retry, then give up
  // quietly — the assertions are the test; a temp directory is not.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(rig.dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

async function seedStudent(id: string): Promise<void> {
  const now = new Date().toISOString();
  await rig.client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, admission_date, status, dup_key,
            balance_paise, created_at, updated_at)
          VALUES (?, ?, 'Asha', '2026-01-15', 'active', ?, 0, ?, ?)`,
    args: [id, TENANT, `dup-${id}`, now, now],
  });
}

async function scalar(sql: string, args: unknown[] = []): Promise<number> {
  const res = await rig.client.execute({ sql, args: args as never[] });
  const row = res.rows[0];
  if (!row) return 0;
  return Number(Object.values(row)[0] ?? 0);
}

async function text(sql: string, args: unknown[] = []): Promise<string | null> {
  const res = await rig.client.execute({ sql, args: args as never[] });
  const row = res.rows[0];
  if (!row) return null;
  const value = Object.values(row)[0];
  return value === null || value === undefined ? null : String(value);
}

async function entryIdOf(type: string): Promise<string> {
  const res = await rig.client.execute({
    sql: `SELECT id FROM ledger_entries WHERE type = ? ORDER BY created_at LIMIT 1`,
    args: [type],
  });
  const row = res.rows[0];
  if (!row) throw new Error(`no ${type} row in the ledger`);
  return String(row.id);
}

async function invoiceStatus(invoiceId: string): Promise<string> {
  return (await text(`SELECT status FROM invoices WHERE id = ?`, [invoiceId])) ?? "";
}

async function balanceOf(studentId: string): Promise<number> {
  return scalar(`SELECT balance_paise FROM students WHERE id = ?`, [studentId]);
}

async function countRows(sql: string, args: unknown[] = []): Promise<number> {
  return scalar(`SELECT COUNT(*) FROM (${sql})`, args);
}

/**
 * Build the books a tutor actually has: a ₹4,500 fee, paid in full.
 * Returns the invoice id and the payment's ledger entry id.
 */
async function paidInvoice(
  studentId: string,
  amountPaise = 450000,
): Promise<{ invoiceId: string; paymentEntryId: string }> {
  const invoice = await createInvoiceSql(rig.client as never, {
    tenantId: TENANT,
    studentId,
    amountPaise,
    description: "August tuition",
    issueDate: FEE_DATE,
  });
  expect(invoice.ok, invoice.ok ? "" : invoice.error.message).toBe(true);
  if (!invoice.ok) throw new Error(invoice.error.message);

  const paid = await recordPaymentSql(rig.client as never, {
    tenantId: TENANT,
    studentId,
    amountPaise,
    description: "Cash",
    receivedOn: PAY_DATE,
  });
  expect(paid.ok, paid.ok ? "" : paid.error.message).toBe(true);
  if (!paid.ok) throw new Error(paid.error.message);

  const invoiceId = (
    await rig.client.execute({ sql: `SELECT id FROM invoices LIMIT 1` })
  ).rows[0];
  return {
    invoiceId: String(invoiceId?.id),
    paymentEntryId: await entryIdOf("PAYMENT_RECEIVED"),
  };
}

/** The ORM dialect, over the web's own ORM surface. */
function ormVoid(entryId: string): ReturnType<typeof voidEntry> {
  return voidEntry(
    createLibsqlProxy(rig.client) as never,
    TENANT,
    entryId,
    "wrong charge",
    VOID_DATE,
    "tutor",
  );
}

/** The libsql dialect. */
function sqlVoid(entryId: string): ReturnType<typeof voidEntrySql> {
  return voidEntrySql(rig.client as never, {
    tenantId: TENANT,
    entryToVoidId: entryId,
    reason: "wrong charge",
    occurredOn: VOID_DATE,
    actor: "tutor",
  });
}

describe("BR-LED-09 — a charge that live payments credit cannot be voided", () => {
  it("the ORM dialect refuses the void and writes NOTHING", async () => {
    const studentId = "student-guard-orm";
    await seedStudent(studentId);
    const { invoiceId, paymentEntryId } = await paidInvoice(studentId);
    const chargeEntryId = await entryIdOf("FEE_CHARGED");

    const balanceBefore = await balanceOf(studentId);
    const voidsBefore = await countRows(
      `SELECT id FROM ledger_entries WHERE type = 'VOID'`,
    );

    const res = await ormVoid(chargeEntryId);

    // The refusal is TYPED (Rule 9) and says which rule refused it.
    expect(res.ok, "BR-LED-09: the void must be refused").toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/CHARGE_HAS_CREDITS/);

    // Nothing was written: no reversing row, the balance did not move, the
    // invoice still reads what it read, and the receipt is still live.
    expect(
      await countRows(`SELECT id FROM ledger_entries WHERE type = 'VOID'`),
    ).toBe(voidsBefore);
    expect(await balanceOf(studentId)).toBe(balanceBefore);
    expect(await invoiceStatus(invoiceId)).toBe("paid");
    expect(
      await countRows(`SELECT id FROM receipts WHERE voided_at IS NULL`),
    ).toBe(1);
    // The payment is untouched.
    expect(await countRows(`SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'`)).toBe(1);
    expect(paymentEntryId.length).toBeGreaterThan(0);
  });

  it("the libsql dialect refuses the SAME void, with the SAME refusal", async () => {
    const studentId = "student-guard-sql";
    await seedStudent(studentId);
    await paidInvoice(studentId);
    const chargeEntryId = await entryIdOf("FEE_CHARGED");

    const res = await sqlVoid(chargeEntryId);

    expect(res.ok, "BR-LED-09: the void must be refused").toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/CHARGE_HAS_CREDITS/);
    expect(
      await countRows(`SELECT id FROM ledger_entries WHERE type = 'VOID'`),
    ).toBe(0);
    expect(await countRows(`SELECT id FROM receipts WHERE voided_at IS NULL`)).toBe(1);
  });

  it("the books never read 'the tutor owes the student' (the −₹4,500 defect)", async () => {
    // The defect this guards: reversing the charge mirrored its debit, so the
    // credit that settled it was left standing and the balance read −450000
    // while the invoice still read `paid`.
    const studentId = "student-guard-balance";
    await seedStudent(studentId);
    await paidInvoice(studentId);
    const chargeEntryId = await entryIdOf("FEE_CHARGED");

    await ormVoid(chargeEntryId);

    expect(await balanceOf(studentId)).toBe(0);
  });

  it("AUD-014: once the payment is voided, the charge CAN be voided (the path stays open)", async () => {
    // A payment that has ALREADY been voided must not keep blocking the
    // charge's void: on an append-only ledger the void is the only correction
    // path, so a guard that never reopens strands the fee on the books forever.
    const studentId = "student-guard-recovery";
    await seedStudent(studentId);
    const { paymentEntryId } = await paidInvoice(studentId);
    const chargeEntryId = await entryIdOf("FEE_CHARGED");

    const first = await ormVoid(paymentEntryId);
    expect(first.ok, first.ok ? "" : first.error.message).toBe(true);

    const second = await ormVoid(chargeEntryId);
    expect(second.ok, second.ok ? "" : second.error.message).toBe(true);

    // Charge, payment, void-of-payment, void-of-charge: the balance nets to
    // zero and both reversing rows are on the books.
    expect(await balanceOf(studentId)).toBe(0);
    expect(
      await countRows(`SELECT id FROM ledger_entries WHERE type = 'VOID'`),
    ).toBe(2);
  });
});

describe("EC-F-05 — voiding a payment voids the receipt and reopens the invoice", () => {
  it("the receipt is marked voided in the SAME transaction", async () => {
    const studentId = "student-ec-f-05";
    await seedStudent(studentId);
    const { paymentEntryId } = await paidInvoice(studentId);

    const before = await rig.client.execute({
      sql: `SELECT id, number, voided_at FROM receipts LIMIT 1`,
    });
    expect(before.rows[0]?.voided_at ?? null).toBeNull();

    const res = await ormVoid(paymentEntryId);
    expect(res.ok, res.ok ? "" : res.error.message).toBe(true);

    const after = await rig.client.execute({
      sql: `SELECT id, number, voided_at FROM receipts LIMIT 1`,
    });
    expect(after.rows[0]?.voided_at ?? null).not.toBeNull();
  });

  it("the invoice reverts to unpaid when nothing is credited any more", async () => {
    const studentId = "student-ec-f-05-invoice";
    await seedStudent(studentId);
    const { invoiceId, paymentEntryId } = await paidInvoice(studentId);
    expect(await invoiceStatus(invoiceId)).toBe("paid");

    await ormVoid(paymentEntryId);

    expect(await invoiceStatus(invoiceId)).toBe("unpaid");
  });

  it("the invoice stays partial while another payment is still credited", async () => {
    const studentId = "student-ec-f-05-partial";
    await seedStudent(studentId);
    const invoice = await createInvoiceSql(rig.client as never, {
      tenantId: TENANT,
      studentId,
      amountPaise: 100000,
      description: "August tuition",
      issueDate: FEE_DATE,
    });
    expect(invoice.ok).toBe(true);
    const invoiceId = (
      await rig.client.execute({ sql: `SELECT id FROM invoices LIMIT 1` })
    ).rows[0];

    // Two payments: ₹60,000 then ₹40,000 — the invoice closes on the second.
    await recordPaymentSql(rig.client as never, {
      tenantId: TENANT,
      studentId,
      amountPaise: 60000,
      description: "Cash",
      receivedOn: PAY_DATE,
    });
    await recordPaymentSql(rig.client as never, {
      tenantId: TENANT,
      studentId,
      amountPaise: 40000,
      description: "Cash",
      receivedOn: PAY_DATE,
    });
    expect(await invoiceStatus(String(invoiceId?.id))).toBe("paid");

    // Void the SECOND payment: ₹60,000 is still credited.
    const second = await rig.client.execute({
      sql: `SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'
            ORDER BY created_at DESC LIMIT 1`,
    });
    const res = await ormVoid(String(second.rows[0]?.id));
    expect(res.ok, res.ok ? "" : res.error.message).toBe(true);

    expect(await invoiceStatus(String(invoiceId?.id))).toBe("partial");
  });

  it("Rule 7: the receipt and the invoice replicate with the void", async () => {
    const studentId = "student-ec-f-05-outbox";
    await seedStudent(studentId);
    const { paymentEntryId } = await paidInvoice(studentId);

    // The payment already queued an `invoices/update` row of its own (the
    // §9.6 step 5 status recompute), so the void's rows are a DELTA.
    const receiptsBefore = await countRows(
      `SELECT id FROM sync_outbox WHERE table_name = 'receipts' AND op = 'update'`,
    );
    const invoicesBefore = await countRows(
      `SELECT id FROM sync_outbox WHERE table_name = 'invoices' AND op = 'update'`,
    );

    await ormVoid(paymentEntryId);

    expect(
      await countRows(
        `SELECT id FROM sync_outbox WHERE table_name = 'receipts' AND op = 'update'`,
      ),
    ).toBe(receiptsBefore + 1);
    expect(
      await countRows(
        `SELECT id FROM sync_outbox WHERE table_name = 'invoices' AND op = 'update'`,
      ),
    ).toBe(invoicesBefore + 1);
  });

  it("the libsql dialect voids the same receipt and the same invoice", async () => {
    const studentId = "student-ec-f-05-sql";
    await seedStudent(studentId);
    const { invoiceId, paymentEntryId } = await paidInvoice(studentId);

    const res = await sqlVoid(paymentEntryId);
    expect(res.ok, res.ok ? "" : res.error.message).toBe(true);

    expect(
      await countRows(`SELECT id FROM receipts WHERE voided_at IS NULL`),
    ).toBe(0);
    expect(await invoiceStatus(invoiceId)).toBe("unpaid");
  });
});
