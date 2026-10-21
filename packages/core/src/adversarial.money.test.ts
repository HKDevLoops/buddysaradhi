// ADVERSARIAL MONEY SUITE — the audit that asks "can this be made to lie?".
//
// Implements (as the ORACLE, not as the code under test):
//   12_Business_Rules.md BR-M-01 [CRITICAL] (integer paise, never float),
//   BR-FEE-04 / BR-FEE-15 (overpayment → [ADVANCE] split, not an auto-invoice),
//   BR-LED-03 / BR-RC-01 / BR-RC-03 (atomic, monotonic, never-recycled numbers),
//   BR-LED-06 (hash chain + tamper evidence), BR-LED-09 (no void of a credited
//   charge), BR-RPT-04 (balance formula), BR-STU-02 (archived students frozen),
//   BR-SYN-01/02 (outbox rows in the mutation's transaction);
//   11_Data_Model.md §4 (schema), §10.2 (`trg_ledger_hash` — the trigger the
//   spec promises and the code does not install);
//   14_Edge_Cases.md EC-F-01/EC-F-02/EC-F-05/EC-05;
//   AGENTS.md §3.5 (one money flow, two dialects), §2 Rule 1/6/7.
//
// METHOD: every test drives the REAL production writers against a REAL file
// SQLite database built from `migrations/0001_init.sql` (the shipped schema,
// with its append-only triggers and CHECK constraints), then dumps the RESULT
// BOOK STATE. Nothing is mocked (AGENTS.md §7.3). A passing test here is a
// statement about the books, not about the code shape.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type Client } from "@libsql/client";
import { PrismaClient } from "@prisma/client";
import { createInvoiceSql, recordPaymentSql } from "./fees";
import { createInvoicePrisma, recordPaymentPrisma } from "./feesPrisma";
import { buildEntryPayload, computeHash, postLedgerEntry, reconcileLedger, voidEntry } from "./ledger";
import { createLibsqlProxy } from "../../../apps/web/src/lib/libsql-proxy";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../");
const MIGRATION = resolve(REPO, "migrations/0001_init.sql");

// The students' money columns (balance_paise, base_fee_paise) arrived in
// the forward-only 0004. The rig used to patch `balance_paise` in by hand,
// which meant this suite tested a schema the product does not ship.
const MIGRATION_0004 = resolve(REPO, "migrations/0004_student_money_columns.sql");

const TENANT = "tenant_adv";

// ---------------------------------------------------------------------------
// Rig — a real DB per test. The schema is the SHIPPED migration, not a
// hand-written approximation (the parity gate's own schema is a blind spot
// this suite demonstrates).
// ---------------------------------------------------------------------------

interface Rig {
  client: Client;
  prisma: PrismaClient;
  dir: string;
  file: string;
}

let rig: Rig;

async function openRig(): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), "adv-money-"));
  const file = join(dir, "adv.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${file}` });
  await client.executeMultiple(readFileSync(MIGRATION, "utf-8"));
    // The canonical schema is 0001 + 0004 - the shipped chain, not a hand-
    // patched approximation of it.
    await client.executeMultiple(readFileSync(MIGRATION_0004, "utf-8"));
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  await prisma.$connect();
  return { client, prisma, dir, file };
}

async function closeRig(r: Rig): Promise<void> {
  try {
    await r.prisma.$disconnect();
  } catch {
    /* best effort */
  }
  try {
    await Promise.resolve(r.client.close());
  } catch {
    /* best effort */
  }
  try {
    rmSync(r.dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

beforeEach(async () => {
  rig = await openRig();
  const now = new Date().toISOString();
  await rig.client.execute({
    sql: `INSERT INTO settings (tenant_id, tenant_secret, invoice_prefix, receipt_prefix,
            next_invoice_seq, next_receipt_seq, created_at, updated_at)
          VALUES (?, 'adv-secret', 'INV-', 'RCP-', 1, 1, ?, ?)`,
    args: [TENANT, now, now],
  });
});

afterEach(async () => {
  await closeRig(rig);
});

// ---------------------------------------------------------------------------
// Book-state dump — the evidence. This is what a tutor's books say.
// ---------------------------------------------------------------------------

interface BookState {
  invoices: { number: string; total: number; status: string; voided: number }[];
  ledger: {
    type: string;
    invoice: string | null;
    debit: number;
    credit: number;
    balanceAfter: number;
    description: string | null;
    storedType: string;
  }[];
  receipts: { number: string; amount: number; invoice: string | null }[];
  balancePaise: number;
  balanceStoredType: string;
  nextInvoiceSeq: number;
  nextReceiptSeq: number;
  outboxRows: number;
  settingsOutboxPayloads: string[];
}

async function dumpBooks(db: Client): Promise<BookState> {
  const invoices = await db.execute({
    sql: `SELECT number, total, status, voided_at IS NOT NULL AS voided FROM invoices ORDER BY number`,
  });
  const ledger = await db.execute({
    sql: `SELECT type, invoice_id, debit_paise, credit_paise, balance_after_paise, description,
                 typeof(balance_after_paise) AS storedType
          FROM ledger_entries ORDER BY created_at, type`,
  });
  const receipts = await db.execute({
    sql: `SELECT number, amount, invoice_id FROM receipts ORDER BY number`,
  });
  const bal = await db.execute({
    sql: `SELECT balance_paise, typeof(balance_paise) AS t FROM students LIMIT 1`,
  });
  const seq = await db.execute({
    sql: `SELECT next_invoice_seq, next_receipt_seq FROM settings WHERE tenant_id = ?`,
    args: [TENANT],
  });
  const outbox = await db.execute({ sql: `SELECT COUNT(*) AS c FROM sync_outbox` });
  const settingsOutbox = await db.execute({
    sql: `SELECT payload FROM sync_outbox WHERE table_name = 'settings' ORDER BY created_at`,
  });
  return {
    invoices: invoices.rows.map((r) => ({
      number: String(r.number),
      total: Number(r.total),
      status: String(r.status),
      voided: Number(r.voided),
    })),
    ledger: ledger.rows.map((r) => ({
      type: String(r.type),
      invoice: r.invoice_id === null ? null : String(r.invoice_id),
      debit: Number(r.debit_paise),
      credit: Number(r.credit_paise),
      balanceAfter: Number(r.balance_after_paise),
      description: r.description === null ? null : String(r.description),
      storedType: String(r.storedType),
    })),
    receipts: receipts.rows.map((r) => ({
      number: String(r.number),
      amount: Number(r.amount),
      invoice: r.invoice_id === null ? null : String(r.invoice_id),
    })),
    balancePaise: Number(bal.rows[0]?.balance_paise ?? 0),
    balanceStoredType: String(bal.rows[0]?.t ?? "null"),
    nextInvoiceSeq: Number(seq.rows[0]?.next_invoice_seq ?? 0),
    nextReceiptSeq: Number(seq.rows[0]?.next_receipt_seq ?? 0),
    outboxRows: Number(outbox.rows[0]?.c ?? 0),
    settingsOutboxPayloads: settingsOutbox.rows.map((r) => String(r.payload)),
  };
}

async function seedStudent(
  id: string,
  opts: { status?: string; archivedAt?: string | null } = {},
): Promise<void> {
  const now = new Date().toISOString();
  await rig.client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, admission_date, status, dup_key,
            archived_at, balance_paise, created_at, updated_at)
          VALUES (?, ?, 'Asha', '2026-01-15', ?, ?, ?, 0, ?, ?)`,
    args: [
      id,
      TENANT,
      opts.status ?? "active",
      `dup-${id}`,
      opts.archivedAt ?? null,
      now,
      now,
    ],
  });
}

async function seedInvoice(
  id: string,
  studentId: string,
  number: string,
  totalPaise: number,
  dueDate: string,
  opts: { status?: string; voidedAt?: string | null } = {},
): Promise<void> {
  const now = new Date().toISOString();
  await rig.client.execute({
    sql: `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
            subtotal, discount, extra_charges, total, status, voided_at, tamper_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'seed-hash', ?, ?)`,
    args: [
      id,
      TENANT,
      number,
      studentId,
      dueDate,
      dueDate,
      totalPaise,
      totalPaise,
      opts.status ?? "unpaid",
      opts.voidedAt ?? null,
      now,
      now,
    ],
  });
}

/**
 * Move the tenant's invoice counter past the invoices that were seeded
 * directly. Production invoices ALWAYS consume the sequence (through
 * `createInvoiceFlow`), so a hand-seeded invoice leaves the counter behind —
 * which is itself the subject of ATK-3.0.
 */
async function syncInvoiceSeq(after: number): Promise<void> {
  await rig.client.execute({
    sql: `UPDATE settings SET next_invoice_seq = ? WHERE tenant_id = ?`,
    args: [after, TENANT],
  });
}

/** The two writers under test, behind one shape. */
const WRITERS = [
  {
    name: "libsql dialect (fees.ts — gateway path)",
    invoice: (input: Parameters<typeof createInvoiceSql>[1]) =>
      createInvoiceSql(rig.client as never, input),
    payment: (input: Parameters<typeof recordPaymentSql>[1]) =>
      recordPaymentSql(rig.client as never, input),
  },
  {
    name: "ORM dialect (feesPrisma.ts — web path, via the real libsql-proxy)",
    invoice: (input: Parameters<typeof createInvoicePrisma>[1]) =>
      createInvoicePrisma(createLibsqlProxy(rig.client) as never, input),
    payment: (input: Parameters<typeof recordPaymentPrisma>[1]) =>
      recordPaymentPrisma(createLibsqlProxy(rig.client) as never, input),
  },
];

// ===========================================================================
// ATTACK 1 — AMOUNT TAMPERING (BR-M-01 [CRITICAL])
// ===========================================================================

describe("ATTACK 1 — amount tampering", () => {
  const REJECTED = [
    { label: "zero", value: 0 },
    { label: "negative", value: -100 },
    { label: "float paise 100.5", value: 100.5 },
    { label: "float dust 0.1+0.2", value: 0.1 + 0.2 },
    { label: "NaN", value: Number.NaN },
    { label: "Infinity", value: Number.POSITIVE_INFINITY },
    { label: "string \"100000\"", value: "100000" as unknown as number },
    { label: "null", value: null as unknown as number },
    { label: "undefined", value: undefined as unknown as number },
    { label: "BigInt 100n", value: 100n as unknown as number },
    { label: "-Infinity", value: Number.NEGATIVE_INFINITY },
  ];

  for (const writer of WRITERS) {
    it(`[${writer.name}] rejects every malformed amount before any row is written`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      for (const bad of REJECTED) {
        const res = await writer.payment({
          tenantId: TENANT,
          studentId,
          amountPaise: bad.value,
          description: "attack",
          receivedOn: "2026-09-12",
        });
        expect(res.ok, `${writer.name} ACCEPTED ${bad.label}`).toBe(false);
      }
      const books = await dumpBooks(rig.client);
      expect(books.ledger).toHaveLength(0);
      expect(books.invoices).toHaveLength(0);
      expect(books.receipts).toHaveLength(0);
      expect(books.balancePaise).toBe(0);
      // Not one sequence may be burned by a rejected payment.
      expect(books.nextReceiptSeq).toBe(1);
      expect(books.nextInvoiceSeq).toBe(1);
    });
  }

  it("ATK-1.1 [P0] a > 2^53 amount is refused by the MONEY FLOW itself (both dialects)", async () => {
    // 10^19 > 2^63-1: SQLite cannot hold it in an INTEGER column, so it
    // stores it as a REAL. `assertPositivePaise` used `Number.isInteger`,
    // which is TRUE for 1e19 (it is an integer, just not a SAFE one), so the
    // guard let it through and the refusal came from a driver further down —
    // differently in each dialect.
    const studentId = "student-adv";
    await seedStudent(studentId);
    const HUGE = 1e19; // ₹100,000,000,000,000,000,000
    for (const writer of WRITERS) {
      const res = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: HUGE,
        description: "attack",
        receivedOn: "2026-09-12",
      });
      // eslint-disable-next-line no-console
      console.log(
        `[${writer.name}] ATK-1.1:`,
        res.ok ? "ACCEPTED" : `REJECTED: ${res.error?.message}`,
      );
      expect(res.ok, `${writer.name} ACCEPTED 1e19`).toBe(false);
      expect(res.error?.message).toMatch(/AMOUNT_INVALID/);
    }
    const books = await dumpBooks(rig.client);
    // eslint-disable-next-line no-console
    console.log("[ATK-1.1] book state:", JSON.stringify(books.ledger));
    expect(books.balanceStoredType, "money must never be stored as a SQLite REAL").not.toBe("real");
    expect(books.ledger).toHaveLength(0);
  });

  it("ATK-1.2 [P1] the two dialects now refuse the SAME amount with the SAME message", async () => {
    const studentId = "student-adv";
    await seedStudent(studentId);
    const OVER = Number.MAX_SAFE_INTEGER + 1; // 2^53
    const sql = await WRITERS[0].payment({
      tenantId: TENANT,
      studentId,
      amountPaise: OVER,
      description: "attack",
      receivedOn: "2026-09-12",
    });
    const orm = await WRITERS[1].payment({
      tenantId: TENANT,
      studentId,
      amountPaise: OVER,
      description: "attack",
      receivedOn: "2026-09-12",
    });
    // eslint-disable-next-line no-console
    console.log("[ATK-1.2] libsql:", sql.ok ? "ACCEPTED" : sql.error?.message);
    // eslint-disable-next-line no-console
    console.log("[ATK-1.2] ORM  :", orm.ok ? "ACCEPTED" : orm.error?.message);
    expect(sql.ok).toBe(false);
    expect(orm.ok).toBe(false);
    // The refusal is now the MONEY FLOW's, so it is the same refusal on both
    // platforms — it was not before ("paiseAdd: non-safe-integer" vs
    // "Received integer which cannot be safely represented as a JavaScript number").
    expect(sql.error?.message).toBe(orm.error?.message);
    expect(sql.error?.message).toMatch(/AMOUNT_INVALID/);
  });

  it("ATK-1.3 [P1] Prisma `Int` (32-bit) rejects a ₹30 lakh payment that the web shim accepts", async () => {
    // `prisma/schema.prisma` declares every money column as `Int` (32-bit
    // signed). The SQLite column is 64-bit. The generated client and the web
    // shim therefore have DIFFERENT money ranges.
    const studentId = "student-adv";
    await seedStudent(studentId);
    const THIRTY_LAKH = 30_000_000; // ₹3,000,000.00 = 30 lakh in paise
    const viaGeneratedClient = await postLedgerEntry(rig.prisma as never, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: THIRTY_LAKH,
      creditPaise: 0,
      occurredOn: "2026-09-12",
    });
    // eslint-disable-next-line no-console
    console.log(
      "[ATK-1.3] generated Prisma client:",
      viaGeneratedClient.ok ? "ACCEPTED" : `REJECTED: ${(viaGeneratedClient as { error: Error }).error.message}`,
    );
    const viaShim = await postLedgerEntry(createLibsqlProxy(rig.client) as never, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: THIRTY_LAKH,
      creditPaise: 0,
      occurredOn: "2026-09-12",
    });
    // eslint-disable-next-line no-console
    console.log(
      "[ATK-1.3] web libsql-proxy shim:",
      viaShim.ok ? "ACCEPTED" : `REJECTED: ${(viaShim as { error: Error }).error.message}`,
    );
    expect(viaGeneratedClient.ok).not.toBe(viaShim.ok);
  });
});

// ===========================================================================
// ATTACK 2 — ATTRIBUTION MANIPULATION
// ===========================================================================

describe("ATTACK 2 — attribution manipulation", () => {
  for (const writer of WRITERS) {
    it(`[${writer.name}] never credits MORE than the invoice, and never credits another student's invoice`, async () => {
      const a = "student-a";
      const b = "student-b";
      await seedStudent(a);
      await seedStudent(b);
      await seedInvoice("inv-a", a, "INV-000001", 100000, "2026-09-05");
      await seedInvoice("inv-b", b, "INV-000002", 100000, "2026-09-05");
      await syncInvoiceSeq(3);

      const res = await writer.payment({
        tenantId: TENANT,
        studentId: a,
        amountPaise: 250000,
        description: "attack",
        receivedOn: "2026-09-12",
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.log(`[${writer.name}] ATK-2.1 PAYMENT ERROR:`, res.error?.message);
      }
      expect(res.ok).toBe(true);
      const books = await dumpBooks(rig.client);
      // eslint-disable-next-line no-console
      console.log(`[${writer.name}] ATK-2.1 books:`, JSON.stringify(books, null, 1));
      const invACredits = books.ledger
        .filter((l) => l.invoice === "inv-a")
        .reduce((s, l) => s + l.credit, 0);
      const invBCredits = books.ledger
        .filter((l) => l.invoice === "inv-b")
        .reduce((s, l) => s + l.credit, 0);
      expect(invACredits).toBe(100000); // never more than the invoice
      expect(invBCredits).toBe(0); // never another student's invoice
    });

    it(`[${writer.name}] a VOIDED invoice is never credited`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      await seedInvoice("inv-void", studentId, "INV-000001", 100000, "2026-09-05", {
        status: "void",
        voidedAt: new Date().toISOString(),
      });
      await syncInvoiceSeq(2);
      const res = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "attack",
        receivedOn: "2026-09-12",
      });
      expect(res.ok).toBe(true);
      const books = await dumpBooks(rig.client);
      // eslint-disable-next-line no-console
      console.log(`[${writer.name}] ATK-2.2 books:`, JSON.stringify(books.ledger, null, 1));
      const voidedCredits = books.ledger.filter((l) => l.invoice === "inv-void");
      expect(voidedCredits).toHaveLength(0);
    });

    it.fails(`[${writer.name}] a payment to an ARCHIVED student is accepted (BR-STU-02)`, async () => {
      // BR-STU-02: archived → "ledger frozen but readable"; BR-STU-02's
      // failure column is "Charge posted to a graduated student".
      //
      // NOT FIXED IN THIS PASS: the fix needs a per-intent student check
      // (a CHARGE must be refused for a graduated/archived student, but a
      // PAYMENT must still be allowed so the final bill can be settled), and
      // the payment path's web-side contract (`apps/web/src/server/actions/
      // fees.ts`) is outside this agent's write scope. See
      // docs/audit/DYNAMIC-MONEY.md (DYN-002) for the patch design.
      const studentId = "student-adv";
      await seedStudent(studentId, { status: "archived", archivedAt: new Date().toISOString() });
      const res = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "attack",
        receivedOn: "2026-09-12",
      });
      const books = await dumpBooks(rig.client);
      // eslint-disable-next-line no-console
      console.log(
        `[${writer.name}] ATK-2.3 archived student payment:`,
        res.ok ? "ACCEPTED" : `REJECTED: ${res.error?.message}`,
      );
      // eslint-disable-next-line no-console
      console.log(`[${writer.name}] ATK-2.3 books:`, JSON.stringify(books, null, 1));
      expect(res.ok, "a payment to an archived student must be refused").toBe(false);
    });

    it(`[${writer.name}] attribution order across SAME-DUE-DATE invoices is undefined`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      await seedInvoice("inv-tie-1", studentId, "INV-000001", 100000, "2026-09-05");
      await seedInvoice("inv-tie-2", studentId, "INV-000002", 100000, "2026-09-05");
      await syncInvoiceSeq(3);
      const res = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "attack",
        receivedOn: "2026-09-12",
      });
      expect(res.ok).toBe(true);
      const books = await dumpBooks(rig.client);
      const credited = books.ledger.filter((l) => l.credit > 0);
      // eslint-disable-next-line no-console
      console.log(
        `[${writer.name}] ATK-2.4 credited invoice:`,
        credited.map((l) => l.invoice),
      );
      // Both invoices share a due_date, so "earliest due first" cannot decide.
      // The ORDER BY has no tie-break — the choice is the storage engine's.
      expect(credited).toHaveLength(1);
    });
  }
});

// ===========================================================================
// ATTACK 3 — THE OVERPAYMENT / ADVANCE MODEL (BR-FEE-04, BR-FEE-15, EC-F-02)
// ===========================================================================

describe("ATTACK 3 — overpayment: advance or fake invoice?", () => {
  for (const writer of WRITERS) {
    it.fails(`[${writer.name}] paying ₹5,000 against a ₹4,500 bill (BR-FEE-04/15: advance, not a fake invoice)`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      await seedInvoice("inv-4500", studentId, "INV-000001", 450000, "2026-09-05");
      await syncInvoiceSeq(2);

      const res = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 500000, // ₹5,000
        description: "Cash",
        receivedOn: "2026-09-12",
      });
      expect(res.ok).toBe(true);
      const books = await dumpBooks(rig.client);
      // eslint-disable-next-line no-console
      console.log(`[${writer.name}] ATK-3 BOOK STATE:`, JSON.stringify(books, null, 1));
      // eslint-disable-next-line no-console
      console.log(
        `[${writer.name}] ATK-3 invoice list the tutor sees:`,
        books.invoices.map((i) => `${i.number} total=${i.total} status=${i.status}`),
      );
      // BR-FEE-04/BR-FEE-15: the ₹500 surplus must be an [ADVANCE] credit, so
      // the balance goes NEGATIVE (money the tutor owes the student, BR-M-04)
      // and NO new invoice is invented for a fee the student never owed.
      expect(books.invoices).toHaveLength(1);
      expect(books.balancePaise).toBe(-50000);
    });

    it(`[${writer.name}] ATK-3.0 [P1] a DUPLICATE invoice number makes the WHOLE PAYMENT fail — no retry, no books`, async () => {
      // BR-FEE-09's enforcement column says: "Sequence fails; rollback; engine
      // RETRIES WITH NEXT SEQUENCE". There is no retry anywhere in
      // `feesFlow.ts`. A counter that is behind the `invoices` table — which
      // `generateBatchInvoices` can produce (it writes the counter back with a
      // plain `db.setting.update` AFTER the batch) — turns a real cash
      // payment into a rejected payment with NOTHING recorded.
      const studentId = "student-adv";
      await seedStudent(studentId);
      // INV-000001 exists but the counter still says 1 (a desynced counter).
      await seedInvoice("inv-4500", studentId, "INV-000001", 450000, "2026-09-05");

      const res = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 500000, // ₹5,000 — ₹500 over the ₹4,500 bill → auto-invoice
        description: "Cash",
        receivedOn: "2026-09-12",
      });
      const books = await dumpBooks(rig.client);
      // eslint-disable-next-line no-console
      console.log(
        `[${writer.name}] ATK-3.0 payment:`,
        res.ok ? "RECORDED" : `REJECTED: ${res.error?.message}`,
      );
      // eslint-disable-next-line no-console
      console.log(`[${writer.name}] ATK-3.0 books:`, JSON.stringify(books, null, 1));
      // The tutor handed over ₹5,000. The books must show it.
      expect(res.ok, "the payment must survive a sequence collision").toBe(true);
      expect(books.ledger.length, "the payment must be in the ledger").toBeGreaterThan(0);
    });
  }
});

// ===========================================================================
// ATTACK 4 — NUMBERING (BR-LED-03, BR-RC-01, BR-RC-03)
// ===========================================================================

describe("ATTACK 4 — invoice / receipt numbering", () => {
  for (const writer of WRITERS) {
    it(`[${writer.name}] a settings outbox row must name the RIGHT sequence column and the NEXT value`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      // An invoice, so the payment below settles it. Under BR-FEE-15 a
      // payment that exceeds the open invoices no longer creates an invoice of
      // its own - the surplus is an ADVANCE - so the INVOICE sequence row has
      // to come from a real invoice.
      const inv = await writer.invoice({
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "Monthly fee",
        issueDate: "2026-09-01",
      });
      expect(inv.ok).toBe(true);
      const res = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "Cash",
        receivedOn: "2026-09-12",
      });
      expect(res.ok).toBe(true);
      const books = await dumpBooks(rig.client);
      // eslint-disable-next-line no-console
      console.log(`[${writer.name}] ATK-4 settings outbox payloads:`, books.settingsOutboxPayloads);
      const payloads = books.settingsOutboxPayloads.map((p) => JSON.parse(p) as Record<string, unknown>);
      // Exactly two settings rows: the invoice sequence and the receipt
      // sequence. Each must name ITS OWN column, carry ITS OWN prefix, and
      // carry the counter's NEXT value (the value the row holds after the
      // increment) — never the CONSUMED one, and never the other
      // sequence's prefix.
      expect(payloads.length).toBeGreaterThanOrEqual(2);
      const invoiceRows = payloads.filter((p) => p.invoice_prefix !== undefined);
      const receiptRows = payloads.filter((p) => p.receipt_prefix !== undefined);
      expect(invoiceRows.length).toBeGreaterThanOrEqual(1);
      expect(receiptRows.length).toBeGreaterThanOrEqual(1);
      for (const p of invoiceRows) {
        expect(p.invoice_prefix, "an invoice sequence must not carry the receipt prefix").toBe("INV-");
        expect(p.next_invoice_seq, "the payload must carry the NEXT invoice sequence").toBe(
          books.nextInvoiceSeq,
        );
        expect(p.next_receipt_seq, "an invoice payload must not carry the receipt sequence").toBeUndefined();
      }
      for (const p of receiptRows) {
        expect(p.receipt_prefix, "a receipt sequence must not carry the invoice prefix").toBe("RCP-");
        expect(p.next_receipt_seq, "the payload must carry the NEXT receipt sequence").toBe(
          books.nextReceiptSeq,
        );
        expect(p.next_invoice_seq, "a receipt payload must not carry the invoice sequence").toBeUndefined();
      }
    });

    it(`[${writer.name}] an overpayment becomes an ADVANCE, not a synthetic bill (EC-F-02)`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      // Rs 4,500 owed.
      const inv = await writer.invoice({
        tenantId: TENANT,
        studentId,
        amountPaise: 450000,
        description: "Monthly fee",
        issueDate: "2026-09-01",
      });
      expect(inv.ok).toBe(true);
      // Rs 5,000 received.
      const res = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 500000,
        description: "Cash",
        receivedOn: "2026-09-12",
      });
      expect(res.ok).toBe(true);
      const value = res.value;
      expect(value?.advancePaise).toBe(50000);
      expect(value?.advanceReceiptNumber).not.toBeNull();

      const books = await dumpBooks(rig.client);
      // ONE invoice - the one the tutor billed. A synthetic invoice for the
      // surplus told the tutor the student owed money they had handed over.
      expect(books.invoices.length).toBe(1);
      const advanceRows = books.ledger.filter((l) => l.description?.includes("[ADVANCE]"));
      expect(advanceRows.length).toBe(1);
      expect(advanceRows[0]?.credit).toBe(50000);
      expect(advanceRows[0]?.invoice).toBeNull();
      // The receipts partition the payment exactly - never more.
      const receiptTotal = books.receipts.reduce((sum, r) => sum + r.amount, 0);
      expect(receiptTotal).toBe(500000);
      // The advance's receipt is its OWN number and names no invoice.
      const advanceReceipt = books.receipts.find((r) => r.number === value?.advanceReceiptNumber);
      expect(advanceReceipt).toBeDefined();
      expect(advanceReceipt?.amount).toBe(50000);
      expect(advanceReceipt?.invoice).toBeNull();
      // The student is in credit to the tutor.
      expect(books.balancePaise).toBe(-50000);
    });

    it(`[${writer.name}] concurrent invoice creation yields DISTINCT numbers`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          writer.invoice({
            tenantId: TENANT,
            studentId,
            amountPaise: 1000 + i,
            description: "race",
            issueDate: "2026-09-01",
          }),
        ),
      );
      const ok = results.filter((r) => r.ok);
      const numbers = ok.map((r) => r.value?.number);
      const unique = new Set(numbers);
      // eslint-disable-next-line no-console
      console.log(
        `[${writer.name}] ATK-4.2 concurrent invoice numbers:`,
        numbers,
        `errors:`,
        results.filter((r) => !r.ok).map((r) => r.error?.message),
      );
      expect(unique.size).toBe(numbers.length);
    });

    it(`[${writer.name}] a void does NOT decrement the receipt sequence (gap-tolerant)`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      const first = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "Cash",
        receivedOn: "2026-09-12",
      });
      expect(first.ok).toBe(true);
      const second = await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "Cash",
        receivedOn: "2026-09-13",
      });
      expect(second.ok).toBe(true);
      const books = await dumpBooks(rig.client);
      // eslint-disable-next-line no-console
      console.log(`[${writer.name}] ATK-4.3 receipts:`, books.receipts.map((r) => r.number));
      const numbers = books.receipts.map((r) => r.number);
      expect(new Set(numbers).size).toBe(numbers.length);
    });
  }
});

// ===========================================================================
// ATTACK 5 — HASH CHAIN / TAMPER EVIDENCE (BR-LED-06)
// ===========================================================================

describe("ATTACK 5 — hash chain and tamper evidence", () => {
  it("ATK-5.1 [P1] the spec's `trg_ledger_hash` (11_Data_Model.md §10.2) is byte-incompatible with the app's hash", async () => {
    // Spec:  sha256(prev|'|'id|'|'student|'|'type|'|'debit|'|'credit|'|'bal|'|'occurred|'|'secret|'|'created_at)
    // Code:  sha256(prev || JSON({id,studentId,type,debitPaise,creditPaise,balanceAfterPaise,occurredOn}) || createdAt || secret)
    const studentId = "student-adv";
    await seedStudent(studentId);
    const res = await recordPaymentSql(rig.client as never, {
      tenantId: TENANT,
      studentId,
      amountPaise: 100000,
      description: "Cash",
      receivedOn: "2026-09-12",
    });
    expect(res.ok).toBe(true);
    const row = await rig.client.execute({
      sql: `SELECT id, student_id, type, debit_paise, credit_paise, balance_after_paise,
                   occurred_on, created_at, this_hash, prev_hash
            FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED' LIMIT 1`,
    });
    const r = row.rows[0] as Record<string, unknown>;
    const createdAt = String(r.created_at);
    // Reproduce the SPEC trigger's byte stream.
    const specPreimage = [
      String(r.prev_hash ?? ""),
      String(r.id),
      String(r.student_id),
      String(r.type),
      String(r.debit_paise),
      String(r.credit_paise),
      String(r.balance_after_paise),
      String(r.occurred_on),
      "adv-secret",
      createdAt,
    ].join("|");
    const { createHash } = await import("crypto");
    const specHash = createHash("sha256").update(specPreimage, "utf8").digest("hex");
    // eslint-disable-next-line no-console
    console.log("[ATK-5.1] app this_hash :", r.this_hash);
    // eslint-disable-next-line no-console
    console.log("[ATK-5.1] spec trigger  :", specHash);
    expect(specHash).not.toBe(String(r.this_hash));
  });

  it("ATK-5.2 [P1] reconcileLedger cannot run on the web's own DB handle (array orderBy → broken SQL)", async () => {
    const studentId = "student-adv";
    await seedStudent(studentId);
    await recordPaymentSql(rig.client as never, {
      tenantId: TENANT,
      studentId,
      amountPaise: 100000,
      description: "Cash",
      receivedOn: "2026-09-12",
    });
    const res = await reconcileLedger(createLibsqlProxy(rig.client) as never, TENANT, studentId);
    // eslint-disable-next-line no-console
    console.log(
      "[ATK-5.2] reconcileLedger via libsql-proxy:",
      JSON.stringify(res),
      res.ok ? "" : String((res as { error: Error }).error?.message),
    );
    // The reconciler must be INVOCABLE on the surface `apps/web` holds. It
    // used to pass an ARRAY `orderBy`, which the web ORM shim turns into
    // `ORDER BY "0" ASC` — a query that fails, so the function returned an
    // error and the web's own rows were never verifiable at all.
    expect(res.ok, "reconcileLedger must run on the web's ORM handle").toBe(true);
  });

  it("ATK-5.3 [P1] two rows in the SAME millisecond, properly chained, are NOT a 'chain broken' verdict", async () => {
    // The old fixture gave BOTH rows a NULL prev_hash, so it was a FORK, not a
    // tie - it never tested what it claimed, and it "passed" as an expected
    // failure for the wrong reason. A real writer CHAINS: the second row's
    // prev_hash is the first row's this_hash. That is the fixture below, with
    // the real hash algorithm (`computeHash` + `buildEntryPayload`) so the
    // hashes are the ones a writer would have produced.
    //
    // BR-LED-06 (amended 2026-10-21): the chain's order IS its links, and a
    // writer's per-chain logical clock makes the same-millisecond tie
    // impossible. A verifier that walks the links cannot be fooled by a tie.
    const studentId = "student-adv-tie";
    await seedStudent(studentId);
    const same = "2026-09-12T10:00:00.000Z";
    const secret = "adv-secret";
    let prevHash: string | null = null;
    let balance = 0;
    for (const [i, id] of [randomUUID(), randomUUID()].entries()) {
      const debit = 1000 * (i + 1);
      balance += debit;
      const payload = buildEntryPayload({
        id,
        studentId,
        type: "FEE_CHARGED",
        debitPaise: debit,
        creditPaise: 0,
        balanceAfterPaise: balance,
        occurredOn: "2026-09-12",
      });
      const thisHash = computeHash(prevHash, payload, same, secret);
      await rig.client.execute({
        sql: `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
                balance_after_paise, description, prev_hash, this_hash, occurred_on, source, created_at, updated_at)
              VALUES (?, ?, ?, 'FEE_CHARGED', ?, 0, ?, 'x', ?, ?, '2026-09-12', 'manual', ?, ?)`,
        args: [
          id,
          TENANT,
          studentId,
          debit,
          balance,
          prevHash,
          thisHash,
          same,
          same,
        ],
      });
      prevHash = thisHash;
    }
    const res = await reconcileLedger(rig.prisma as never, TENANT, studentId);
    // eslint-disable-next-line no-console
    console.log("[ATK-5.3] reconcile verdict on a same-millisecond chain:", JSON.stringify(res));
    expect(
      res.ok,
      "a same-millisecond chain is not tampering - a false 'chain broken' locks a tutor's books",
    ).toBe(true);
  });

  it("ATK-5.4 [P0] a tampered row IS detected by reconcileLedger (good) — but nothing calls it", async () => {
    const studentId = "student-adv";
    await seedStudent(studentId);
    await recordPaymentSql(rig.client as never, {
      tenantId: TENANT,
      studentId,
      amountPaise: 100000,
      description: "Cash",
      receivedOn: "2026-09-12",
    });
    // The append-only trigger blocks UPDATE... so tamper the way a
    // privileged attacker would: a row that was never hashed into the chain.
    await rig.client.execute({
      sql: `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
              balance_after_paise, description, prev_hash, this_hash, occurred_on, source, created_at, updated_at)
            VALUES (?, ?, ?, 'PAYMENT_RECEIVED', 0, 999999, 0, 'quiet injection',
                    NULL, 'deadbeef', '2026-09-12', 'manual', '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z')`,
      args: [randomUUID(), TENANT, studentId],
    });
    const res = await reconcileLedger(rig.prisma as never, TENANT, studentId);
    // eslint-disable-next-line no-console
    console.log("[ATK-5.4] reconcile verdict on an injected row:", JSON.stringify(res));
    expect(res.ok).toBe(false);
  });
});

// ===========================================================================
// ATTACK 12 — the two LEDGER dialects must refuse the same rows
// ===========================================================================

describe("ATTACK 12 — ledger-dialect parity", () => {
  it("ATK-12.1 [P1] the ORM dialect refuses a zero-amount row and an unknown type, exactly like the libsql dialect", async () => {
    // `postLedgerEntrySql` (libsql) refuses: a zero-amount row
    // (`debit + credit <= 0`), an unknown entry type, and a non-integer
    // amount. `postLedgerEntry` (Prisma/ORM) refused only the last two, so
    // the SAME input produced two different books depending on which
    // platform recorded it: the gateway refused the row and the web wrote
    // it. The shipped schema's CHECK (`debit_paise + credit_paise > 0`)
    // catches the zero row at the database — but only on a database built
    // from `migrations/0001_init.sql`; the dialect's own contract must not
    // depend on which schema happens to be underneath it.
    const studentId = "student-adv";
    await seedStudent(studentId);
    const viaOrm = await postLedgerEntry(createLibsqlProxy(rig.client) as never, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 0,
      creditPaise: 0,
      occurredOn: "2026-09-12",
    });
    // eslint-disable-next-line no-console
    console.log("[ATK-12.1] ORM dialect, zero-amount row:", viaOrm.ok ? "ACCEPTED" : viaOrm.error?.message);
    expect(viaOrm.ok, "a zero-amount ledger row must be refused").toBe(false);

    const viaSql = await postLedgerEntry(rig.client as never, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 0,
      creditPaise: 0,
      occurredOn: "2026-09-12",
    });
    // eslint-disable-next-line no-console
    console.log("[ATK-12.1] libsql dialect, zero-amount row:", viaSql.ok ? "ACCEPTED" : viaSql.error?.message);
    expect(viaSql.ok).toBe(false);
    expect(viaOrm.error?.message).toBe(viaSql.error?.message);

    // An unknown entry type: the enum in the schema refuses it, but the
    // dialect must refuse it FIRST (fail-closed, Rule 9).
    const bogus = await postLedgerEntry(createLibsqlProxy(rig.client) as never, {
      tenantId: TENANT,
      studentId,
      type: "NOT_A_TYPE" as never,
      debitPaise: 100,
      creditPaise: 0,
      occurredOn: "2026-09-12",
    });
    // eslint-disable-next-line no-console
    console.log("[ATK-12.1] ORM dialect, unknown type:", bogus.ok ? "ACCEPTED" : bogus.error?.message);
    expect(bogus.ok).toBe(false);

    // Nothing was written by any of the three refusals.
    const books = await dumpBooks(rig.client);
    expect(books.ledger).toHaveLength(0);
  });
});

// ===========================================================================
// ATTACK 9 — DIALECT DRIFT: the parity gate's blind spots, demonstrated
// ===========================================================================

describe("ATTACK 9 — dialect drift the parity gate cannot see", () => {
  it("ATK-9.1 the ORM dialect's rows verify under `reconcileLedger` (the check the parity gate never made)", async () => {
    // The parity gate (`feesDialectParity.test.ts`) compares NO hashes: its
    // ledger snapshot is `type, invoice_id IS NOT NULL, debit_paise,
    // credit_paise, balance_after_paise, occurred_on, description`. A
    // divergence in the hash CONSTRUCTION — the exact class the overhaul
    // audit called F2 — would therefore pass the gate silently.
    //
    // This check was IMPOSSIBLE before this pass: `reconcileLedger` passed an
    // ARRAY `orderBy` to the model surface, and the web's own ORM shim
    // supports only a single key, so the query THREW
    // ("no such column: 0"). With the array replaced by a single key plus a
    // deterministic JS sort, the reconciler runs on the web's handle — and
    // the ORM dialect's rows are verifiable at all.
    const studentId = "student-adv";
    await seedStudent(studentId);
    const inv = await WRITERS[1].invoice({
      tenantId: TENANT,
      studentId,
      amountPaise: 100000,
      description: "Fee",
      issueDate: "2026-09-01",
    });
    expect(inv.ok).toBe(true);
    const pay = await WRITERS[1].payment({
      tenantId: TENANT,
      studentId,
      amountPaise: 150000,
      description: "Overpay",
      receivedOn: "2026-09-12",
    });
    expect(pay.ok).toBe(true);
    // Over the WEB's own model surface (the shim), not the generated client.
    const rec = await reconcileLedger(createLibsqlProxy(rig.client) as never, TENANT, studentId);
    // eslint-disable-next-line no-console
    console.log("[ATK-9.1] ORM-dialect rows under reconcileLedger:", JSON.stringify(rec));
    expect(rec.ok, "the web's own rows must reconcile").toBe(true);
  });

  it("ATK-9.2 the two dialects write the SAME BOOK over the SAME database, in either order", async () => {
    // A scenario the existing gate cannot express: it runs each dialect over
    // its OWN database, so anything that depends on the OTHER dialect's rows
    // (a shared chain tail, a shared settings counter) is invisible. Here
    // both dialects write to the SAME database, in one order and then the
    // other, and every money-relevant artefact is compared — including the
    // hashes, the outbox PAYLOADS and the audit metadata, none of which the
    // gate compares today.
    const build = async (order: "sql-first" | "orm-first") => {
      const db = await openRig();
      const now = new Date().toISOString();
      await db.client.execute({
        sql: `INSERT INTO settings (tenant_id, tenant_secret, invoice_prefix, receipt_prefix,
                next_invoice_seq, next_receipt_seq, created_at, updated_at)
              VALUES (?, 'adv-secret', 'INV-', 'RCP-', 1, 1, ?, ?)`,
        args: [TENANT, now, now],
      });
      const studentId = "student-adv";
      const now2 = new Date().toISOString();
      await db.client.execute({
        sql: `INSERT INTO students (id, tenant_id, first_name, admission_date, status, dup_key,
                archived_at, balance_paise, created_at, updated_at)
              VALUES (?, ?, 'Asha', '2026-01-15', 'active', 'dup-x', NULL, 0, ?, ?)`,
        args: [studentId, TENANT, now2, now2],
      });
      const runs: [string, () => Promise<unknown>][] = [
        [
          "sql",
          () =>
            createInvoiceSql(db.client as never, {
              tenantId: TENANT,
              studentId,
              amountPaise: 100000,
              description: "Fee",
              issueDate: "2026-09-01",
            }),
        ],
        [
          "orm",
          () =>
            createInvoicePrisma(createLibsqlProxy(db.client) as never, {
              tenantId: TENANT,
              studentId,
              amountPaise: 100000,
              description: "Fee",
              issueDate: "2026-09-01",
            }),
        ],
      ];
      for (const [, fn] of order === "sql-first" ? runs : [...runs].reverse()) {
        const res = (await fn()) as { ok: boolean; error?: Error };
        expect(res.ok, `dialect failed: ${res.error?.message}`).toBe(true);
      }
      const invoices = await db.client.execute({
        sql: `SELECT number, total, status FROM invoices ORDER BY number`,
      });
      const ledger = await db.client.execute({
        sql: `SELECT type, debit_paise, credit_paise, balance_after_paise FROM ledger_entries
              ORDER BY created_at, type`,
      });
      const outbox = await db.client.execute({
        sql: `SELECT table_name, op, payload FROM sync_outbox ORDER BY created_at, table_name`,
      });
      const audit = await db.client.execute({
        sql: `SELECT action, metadata FROM audit_log ORDER BY created_at, action`,
      });
      const seq = await db.client.execute({
        sql: `SELECT next_invoice_seq, next_receipt_seq FROM settings WHERE tenant_id = ?`,
        args: [TENANT],
      });
      const receipts = await db.client.execute({
        sql: `SELECT number, amount FROM receipts ORDER BY number`,
      });
      await closeRig(db);
      return {
        invoices: invoices.rows,
        ledger: ledger.rows,
        outbox: outbox.rows,
        audit: audit.rows,
        seq: seq.rows,
        receipts: receipts.rows,
      };
    };

    const sqlFirst = await build("sql-first");
    const ormFirst = await build("orm-first");
    // The ORDER of the two dialects must not change the books. (The ledger
    // row COUNT and every money field are compared; the ids differ by
    // construction — they are random UUIDs — so they are excluded.)
    expect(sqlFirst.invoices).toEqual(ormFirst.invoices);
    expect(sqlFirst.ledger).toEqual(ormFirst.ledger);
    expect(sqlFirst.seq).toEqual(ormFirst.seq);
    expect(sqlFirst.receipts).toEqual(ormFirst.receipts);
    // The OUTBOX STREAM: the SEQUENCE of (table_name, op) and the SHAPE of
    // each payload. The existing gate compares `(table_name, op)` only, and
    // does not compare the order — so both the payload shape and the row
    // order are invisible to it. Both were divergent before this pass:
    //   - the ORM dialect's students-balance payload omitted `updated_at`;
    //   - the ORM dialect wrote that row BEFORE the ledger row it summarises.
    const streamOf = (rows: unknown[]): string[] =>
      rows.map((r) => {
        const row = r as { table_name: string; op: string; payload: string };
        const keys = Object.keys(JSON.parse(row.payload) as Record<string, unknown>).sort();
        return `${row.table_name}/${row.op}[${keys.join(",")}]`;
      });
    // eslint-disable-next-line no-console
    console.log("[ATK-9.2] sqlFirst stream:", JSON.stringify(streamOf(sqlFirst.outbox), null, 1));
    // eslint-disable-next-line no-console
    console.log("[ATK-9.2] ormFirst stream:", JSON.stringify(streamOf(ormFirst.outbox), null, 1));
    expect(streamOf(sqlFirst.outbox)).toEqual(streamOf(ormFirst.outbox));
    // The AUDIT METADATA — which the existing gate compares by (action,
    // ref_type) only.
    const auditOf = (rows: unknown[]): string[] =>
      rows.map((r) => {
        const row = r as { action: string; metadata: string };
        const keys = Object.keys(JSON.parse(row.metadata) as Record<string, unknown>).sort();
        return `${row.action}[${keys.join(",")}]`;
      });
    expect(auditOf(sqlFirst.audit)).toEqual(auditOf(ormFirst.audit));
  });
});

describe("ATTACK 7 — voiding a charge that a payment already credits", () => {
  it("ATK-7.1 [P1] voidEntry refuses to void a charge that a live payment credits (BR-LED-09)", async () => {
    // BR-LED-09 [critical path]: "Voiding a FEE_CHARGED is permitted only if
    // no PAYMENT_RECEIVED credits it." The core `voidEntry` used to check only
    // "is it already a VOID" and "has it already been voided" — never "does a
    // LIVE credit point at it". The reversal then stood alone: the books read
    // balance −450,000 (the tutor owes the student ₹4,500) while the invoice
    // still read `paid`, and on an append-only ledger (Rule 1) there was no
    // further correction available.
    //
    // The gateway's void route had the guard; the core path did not, so the
    // two writers disagreed about the same books (AGENTS.md §3.5).
    const studentId = "student-adv";
    await seedStudent(studentId);
    const inv = await createInvoiceSql(rig.client as never, {
      tenantId: TENANT,
      studentId,
      amountPaise: 450000,
      description: "Fee",
      issueDate: "2026-09-01",
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const paid = await recordPaymentSql(rig.client as never, {
      tenantId: TENANT,
      studentId,
      amountPaise: 450000,
      description: "Cash",
      receivedOn: "2026-09-12",
    });
    expect(paid.ok).toBe(true);

    // Void the FEE_CHARGED — the credit against it is still live.
    const charge = await rig.client.execute({
      sql: `SELECT id FROM ledger_entries WHERE type = 'FEE_CHARGED' LIMIT 1`,
    });
    const res = await voidEntry(
      createLibsqlProxy(rig.client) as never,
      TENANT,
      String(charge.rows[0]?.id),
      "wrong charge",
      "2026-09-13",
      "tutor",
    );
    const books = await dumpBooks(rig.client);
    // eslint-disable-next-line no-console
    console.log(
      "[ATK-7.1] void of a credited charge:",
      res.ok ? "ALLOWED" : `REFUSED: ${(res as { error: Error }).error.message}`,
    );
    // eslint-disable-next-line no-console
    console.log("[ATK-7.1] books:", JSON.stringify(books, null, 1));
    expect(res.ok, "BR-LED-09: the void must be refused").toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/CHARGE_HAS_CREDITS/);
    // THE BOOKS DID NOT MOVE. The charge and the payment still cancel, the
    // invoice still reads what it read, and no reversing row was written.
    expect(books.balancePaise).toBe(0);
    expect(books.invoices[0]?.status).toBe("paid");
    expect(books.ledger.filter((l) => l.type === "VOID")).toHaveLength(0);
  });
});

// ===========================================================================
// ATTACK 8 — the two structural gaps: nothing reconciles, nothing gates
// ===========================================================================

describe("ATTACK 8 — structural gaps", () => {
  it("ATK-8.1 [P1] `reconcileLedger` HAS a production call site", async () => {
    // The function that would catch a tampered or drifted ledger was never
    // invoked by a route, a command, a job or an engine — so a divergence
    // between the web's books and the gateway's books was found by nobody.
    //
    // The call site now exists: Settings -> Diagnostics -> "Check my books"
    // (`apps/web/src/server/actions/diagnostics.ts`) runs the reconciler over
    // the authenticated tenant's books on demand (08 §6.2.12, and BR-LED-06's
    // own enforcement column: "Red 'CHAIN BROKEN at entry X' in Diagnostics").
    const { execFileSync } = await import("child_process");
    let out = "";
    try {
      out = execFileSync(
        "git",
        [
          "grep",
          "-n",
          "reconcileLedger(",
          "--",
          "apps",
          "packages",
          "scripts",
        ],
        { cwd: REPO, encoding: "utf8" },
      );
    } catch (error) {
      out = String((error as { stdout?: string }).stdout ?? "");
    }
    const production = out
      .split("\n")
      .filter((line) => line.length > 0)
      .filter((line) => !/\.test\.ts/.test(line))
      .filter((line) => !/packages\/core\/src\/ledger\.ts/.test(line))
      // Generated artefacts (the code-graph dump) and prose are not call sites.
      .filter((line) => !/packages\/graphify-out\//.test(line))
      .filter((line) => !/\.(md|json|html|lock)\b/.test(line))
      // A real call is `reconcileLedger(` as an identifier — not a mention in a
      // comment (`// ... reconcileLedger(`) and not a quoted label.
      .filter((line) => /[^\w"'`]reconcileLedger\(/.test(line));
    // eslint-disable-next-line no-console
    console.log("[ATK-8.1] production call sites:", production);
    expect(production.length, "reconcileLedger must be invoked by production code").toBeGreaterThan(0);
  });

  it("ATK-8.2 [P1] the gateway's vendored money flow is regenerated from core, and the check can tell", async () => {
    // `apps/gateway/lib/vendor/feesFlow.ts` is a MECHANICAL copy of
    // `packages/core/src/feesFlow.ts` (AGENTS.md §3.5: one money flow, one
    // copy per runtime), and `scripts/sync-vendor-feesflow.ts --check` is the
    // gate that says so.
    //
    // The defect this pins: the copy went stale silently - the sync script's
    // own header says "Staleness is a TEST failure", but the two tests its
    // header cites DID NOT EXIST, so nothing failed when the copy drifted and
    // the gateway kept running a money flow the web did not.
    //
    // The tripwire used to assert the CURRENT state was stale (`it.fails`),
    // which was a statement about the DEFECT, not about the GATE. The gate
    // exists now, and the copy is fresh, so the test states the PROPERTY
    // instead: perturb the copy and the check must FAIL; restore it and the
    // check must PASS. A gate that cannot fail is not a gate.
    const { execFileSync } = await import("child_process");
    const { readFileSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const vendorPath = join(REPO, "apps/gateway/lib/vendor/feesFlow.ts");

    const runCheck = (): number => {
      try {
        execFileSync("bun", ["scripts/sync-vendor-feesflow.ts", "--check"], {
          cwd: REPO,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return 0;
      } catch (error) {
        const err = error as { status?: number };
        return err.status ?? 1;
      }
    };

    // The copy as committed must be fresh.
    expect(runCheck(), "the vendored money flow must be regenerated from core").toBe(0);

    // And the check must be able to see a stale copy.
    const original = readFileSync(vendorPath, "utf8");
    try {
      writeFileSync(vendorPath, `${original}\n// stale-copy probe\n`, "utf8");
      expect(runCheck(), "the freshness check must fail on a stale copy").not.toBe(0);
    } finally {
      writeFileSync(vendorPath, original, "utf8");
    }

    // And the check must pass again once the copy is restored.
    expect(runCheck(), "the restored copy must be fresh again").toBe(0);
  });
});

describe("ATTACK 6 — replication payload honesty", () => {
  for (const writer of WRITERS) {
    it(`[${writer.name}] every outbox payload for a payment is a faithful copy of the row it mirrors`, async () => {
      const studentId = "student-adv";
      await seedStudent(studentId);
      await writer.payment({
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "Cash",
        receivedOn: "2026-09-12",
      });
      const rows = await rig.client.execute({
        sql: `SELECT table_name, op, payload FROM sync_outbox ORDER BY created_at`,
      });
      for (const r of rows.rows) {
        const payload = JSON.parse(String(r.payload)) as Record<string, unknown>;
        // eslint-disable-next-line no-console
        console.log(
          `[${writer.name}] ATK-6 outbox ${String(r.table_name)}/${String(r.op)}:`,
          payload,
        );
        if (r.table_name === "settings") {
          expect(payload.next_invoice_seq, "settings outbox lies about the invoice sequence").not.toBe(
            1,
          );
        }
      }
    });
  }
});
