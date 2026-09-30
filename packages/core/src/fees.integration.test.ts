// Implements: AGENTS.md §7.2/§7.3 (ledger integrity, sync_outbox-after-
// mutation assertions; "never mock the ledger" — real migrations, real file
// SQLite, no mocked DB), 07_Fees_and_Payments.md §9.6 (atomic payment: all
// steps succeed or none do) + §9.7 (seq increment, pad-6 numbers),
// 12_Business_Rules.md BR-LED-03 (monotonic gap-tolerant numbering),
// BR-SYN-01 (outbox rows per mutation), BR-M-01 (integer paise),
// 14_Edge_Cases.md EC-05 (sequence race), EC-19 (prefix vs sequence);
// regression suite for reviews/overhaul-audit-report-2026-09-26.md
// F1 (fail-closed tamper secret), F2 (web rows must verify against
// reconcileLedger), F3 (random invoice numbers), F4 (no transaction),
// F5 (phantom student), F9 (partial-payment attribution).
//
// Harness: migrations/0001_init.sql applied verbatim via `executeMultiple`
// (the real schema — append-only triggers, CHECKs, FTS included), plus one
// guarded `ALTER TABLE students ADD COLUMN balance_paise` because that column
// arrives via `prisma db push` (prisma/schema.prisma), not 0001. Everything
// is written through the production libsql dialect; `reconcileLedger` (Prisma
// reader) verifies the chain — the exact F2 contract.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { existsSync, unlinkSync, mkdtempSync, readFileSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { createClient, type Client } from "@libsql/client";
import { PrismaClient } from "@prisma/client";
import { reconcileLedger } from "./ledger";
import {
  computeInvoiceTamperHash,
  createInvoiceSql,
  recordPaymentSql,
} from "./fees";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../"); // packages/core/src -> repo root
const MIGRATION = resolve(REPO, "migrations/0001_init.sql");

const FEE_DATE = "2026-09-15";

let client: Client;
let prisma: PrismaClient;
let tmpDir: string;
let TEST_DB: string;

// ---------------------------------------------------------------------------
// Helpers (raw SQL only for seeding/asserting — the units under test are the
// only production writers exercised here).
// ---------------------------------------------------------------------------

async function seedTenant(secret = randomUUID()): Promise<string> {
  const tenantId = randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO settings (tenant_id, tenant_secret, created_at, updated_at)
          VALUES (?, ?, ?, ?)`,
    args: [tenantId, secret, now, now],
  });
  return tenantId;
}

async function seedStudent(tenantId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, admission_date, status, dup_key, created_at, updated_at)
          VALUES (?, ?, 'Test', ?, 'active', ?, ?, ?)`,
    args: [id, tenantId, FEE_DATE, `dup-${id}`, now, now],
  });
  return id;
}

async function scalar(sql: string, args: unknown[] = []): Promise<number> {
  const res = await client.execute({ sql, args });
  const row = res.rows[0];
  if (!row) throw new Error(`scalar query returned no rows: ${sql}`);
  const first = Object.values(row)[0];
  return Number(first ?? 0);
}

async function text(sql: string, args: unknown[] = []): Promise<string> {
  const res = await client.execute({ sql, args });
  const row = res.rows[0];
  if (!row) throw new Error(`text query returned no rows: ${sql}`);
  return String(Object.values(row)[0] ?? "");
}

async function invoiceStatus(invoiceId: string): Promise<string> {
  return text(`SELECT status FROM invoices WHERE id = ?`, [invoiceId]);
}

async function invoiceCredits(invoiceId: string): Promise<number> {
  return scalar(
    `SELECT COALESCE(SUM(credit_paise), 0) FROM ledger_entries
     WHERE invoice_id = ? AND type != 'VOID' AND void_of_id IS NULL`,
    [invoiceId],
  );
}

async function studentBalance(studentId: string): Promise<number> {
  return scalar(`SELECT balance_paise FROM students WHERE id = ?`, [studentId]);
}

async function ledgerTailBalance(studentId: string): Promise<number> {
  return scalar(
    `SELECT balance_after_paise FROM ledger_entries WHERE student_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [studentId],
  );
}

async function seqFor(tenantId: string): Promise<number> {
  return scalar(`SELECT next_invoice_seq FROM settings WHERE tenant_id = ?`, [tenantId]);
}

async function countRows(sql: string, args: unknown[] = []): Promise<number> {
  return scalar(`SELECT COUNT(*) FROM (${sql})`, args);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "fees-int-"));
  TEST_DB = join(tmpDir, "fees-int.db").replace(/\\/g, "/");
  client = createClient({ url: `file:${TEST_DB}` });

  // The REAL migration: append-only triggers, CHECK constraints, FTS.
  const migrationSql = readFileSync(MIGRATION, "utf-8");
  await client.executeMultiple(migrationSql);

  // `students.balance_paise` ships in prisma/schema.prisma, not 0001 — add it
  // the way a prisma-db-push DB would have it. Tolerate only "already exists".
  try {
    await client.execute({
      sql: `ALTER TABLE students ADD COLUMN balance_paise INTEGER NOT NULL DEFAULT 0`,
      args: [],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/duplicate column name/i.test(msg)) throw error;
  }

  prisma = new PrismaClient({
    datasources: { db: { url: `file:${TEST_DB}` } },
  });
  await prisma.$connect();
}, 90000);

afterAll(async () => {
  if (prisma) await prisma.$disconnect().catch(() => {});
  try {
    client?.close();
  } catch {
    // already closed
  }
  await new Promise((r) => setTimeout(r, 200));
  for (const ext of ["", "-wal", "-shm", "-journal"]) {
    const p = TEST_DB + ext;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best-effort — libsql may release the handle late (Windows)
    }
  }
  try {
    if (tmpDir && existsSync(tmpDir)) rmdirSync(tmpDir, true);
  } catch {
    // best-effort
  }
}, 30000);

// ---------------------------------------------------------------------------
// W3 / F3 — monotonic, zero-padded, gap-tolerant numbers (BR-LED-03, §9.7)
// ---------------------------------------------------------------------------

describe("invoice numbering (F3 / BR-LED-03 / §9.7)", () => {
  it("assigns INV-000001, INV-000002 … consuming the settings sequence", async () => {
    const tenantId = await seedTenant();
    const studentId = await seedStudent(tenantId);

    const inv1 = await createInvoiceSql(client, {
      tenantId,
      studentId,
      amountPaise: 100000,
      description: "Tuition fee",
      issueDate: FEE_DATE,
    });
    expect(inv1.ok).toBe(true);
    if (!inv1.ok) return;
    expect(inv1.value.number).toBe("INV-000001");

    const inv2 = await createInvoiceSql(client, {
      tenantId,
      studentId,
      amountPaise: 50000,
      description: "Material fee",
      issueDate: FEE_DATE,
    });
    expect(inv2.ok).toBe(true);
    if (!inv2.ok) return;
    expect(inv2.value.number).toBe("INV-000002");

    expect(await seqFor(tenantId)).toBe(3);

    // F1: tamper hash is the canonical §10 formula over the tenant secret.
    const secret = await text(`SELECT tenant_secret FROM settings WHERE tenant_id = ?`, [tenantId]);
    const row = (
      await client.execute({
        sql: `SELECT number, student_id, total, issue_date, tamper_hash FROM invoices WHERE id = ?`,
        args: [inv1.value.invoiceId],
      })
    ).rows[0];
    expect(row).toBeDefined();
    expect(
      computeInvoiceTamperHash(
        {
          number: String(row?.number),
          studentId: String(row?.student_id),
          totalPaise: Number(row?.total),
          issueDate: String(row?.issue_date),
        },
        secret,
      ),
    ).toBe(String(row?.tamper_hash));

    // Invoice + ledger linkage (F9 prerequisite): FEE_CHARGED carries invoice_id.
    const linked = await scalar(
      `SELECT COUNT(*) FROM ledger_entries
       WHERE invoice_id = ? AND type = 'FEE_CHARGED' AND debit_paise = 100000`,
      [inv1.value.invoiceId],
    );
    expect(linked).toBe(1);
    expect(await studentBalance(studentId)).toBe(150000);
    expect(await text(`SELECT status FROM invoices WHERE id = ?`, [inv1.value.invoiceId])).toBe(
      "unpaid",
    );

    // Rule 7 — outbox rows in the same transaction as each mutation.
    expect(await countRows(`SELECT id FROM sync_outbox WHERE tenant_id = ? AND table_name = 'invoices'`, [tenantId])).toBeGreaterThanOrEqual(2);
    expect(await countRows(`SELECT id FROM sync_outbox WHERE tenant_id = ? AND table_name = 'ledger_entries'`, [tenantId])).toBeGreaterThanOrEqual(2);
    expect(await countRows(`SELECT id FROM sync_outbox WHERE tenant_id = ? AND table_name = 'students'`, [tenantId])).toBeGreaterThanOrEqual(2);
    expect(await countRows(`SELECT id FROM sync_outbox WHERE tenant_id = ? AND table_name = 'settings'`, [tenantId])).toBe(2);

    // §9.6 fail-closed audit: one row per action, actor 'tutor' (0001 CHECK).
    expect(await countRows(`SELECT id FROM audit_log WHERE tenant_id = ? AND action = 'invoice.create'`, [tenantId])).toBe(2);
    expect(await countRows(`SELECT id FROM audit_log WHERE tenant_id = ? AND actor = 'tutor'`, [tenantId])).toBe(2);
  });

  it("never reuses a voided invoice's number — the gap is permanent (EC-19)", async () => {
    const tenantId = await seedTenant();
    const studentId = await seedStudent(tenantId);

    const inv1 = await createInvoiceSql(client, {
      tenantId, studentId, amountPaise: 10000, description: "A", issueDate: FEE_DATE,
    });
    const inv2 = await createInvoiceSql(client, {
      tenantId, studentId, amountPaise: 20000, description: "B", issueDate: FEE_DATE,
    });
    expect(inv1.ok && inv1.value.number).toBe("INV-000001");
    expect(inv2.ok && inv2.value.number).toBe("INV-000002");
    expect(await seqFor(tenantId)).toBe(3);

    // Void invoice #1 directly (invoices are not append-only; the ledger rows
    // stay and the sequence must not rewind — BR-LED-03).
    await client.execute({
      sql: `UPDATE invoices SET status = 'void', voided_at = ? WHERE tenant_id = ? AND number = 'INV-000001'`,
      args: [new Date().toISOString(), tenantId],
    });

    const inv3 = await createInvoiceSql(client, {
      tenantId, studentId, amountPaise: 30000, description: "C", issueDate: FEE_DATE,
    });
    expect(inv3.ok && inv3.value.number).toBe("INV-000003");
    expect(await seqFor(tenantId)).toBe(4);

    // INV-000001 stays consumed.
    const still = await countRows(`SELECT id FROM invoices WHERE tenant_id = ? AND number = 'INV-000001'`, [tenantId]);
    expect(still).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F9 — partial-payment attribution against outstanding, not total
// ---------------------------------------------------------------------------

describe("partial payment attribution (F9 / §9.6 step 5)", () => {
  it("applies each payment to the outstanding amount and auto-invoices the remainder", async () => {
    const tenantId = await seedTenant();
    const studentId = await seedStudent(tenantId);

    const inv = await createInvoiceSql(client, {
      tenantId, studentId, amountPaise: 100000, description: "Quarter fee", issueDate: FEE_DATE,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const invoiceId = inv.value.invoiceId;

    // Payment 1: 40000 of 100000 -> partial.
    const p1 = await recordPaymentSql(client, {
      tenantId, studentId, amountPaise: 40000, description: "Cash", receivedOn: FEE_DATE,
    });
    expect(p1.ok).toBe(true);
    expect(await invoiceStatus(invoiceId)).toBe("partial");
    expect(await invoiceCredits(invoiceId)).toBe(40000);
    expect(await studentBalance(studentId)).toBe(60000);

    // Payment 2: 30000 -> still partial; outstanding must be total-Σcredits
    // (the F9 bug used `total` as outstanding on every payment).
    const p2 = await recordPaymentSql(client, {
      tenantId, studentId, amountPaise: 30000, description: "Cash", receivedOn: FEE_DATE,
    });
    expect(p2.ok).toBe(true);
    expect(await invoiceStatus(invoiceId)).toBe("partial");
    expect(await invoiceCredits(invoiceId)).toBe(70000);
    expect(await studentBalance(studentId)).toBe(30000);

    // Payment 3: 100000 — only 30000 is outstanding; the invoice must NOT be
    // credited 170000; the 70000 remainder auto-invoices under the next seq.
    const p3 = await recordPaymentSql(client, {
      tenantId, studentId, amountPaise: 100000, description: "Full cash", receivedOn: FEE_DATE,
    });
    expect(p3.ok).toBe(true);
    if (!p3.ok) return;

    expect(await invoiceCredits(invoiceId)).toBe(100000); // exactly total, not 170000
    expect(await invoiceStatus(invoiceId)).toBe("paid");

    expect(p3.value.creditedPaise).toBe(100000);
    expect(p3.value.applied).toHaveLength(2);
    expect(p3.value.applied[0]).toMatchObject({ invoiceId, paise: 30000, status: "paid" });
    expect(p3.value.autoInvoiceId).not.toBeNull();
    expect(p3.value.autoInvoiceNumber).toBe("INV-000002");
    expect(p3.value.applied[1]).toMatchObject({
      invoiceId: p3.value.autoInvoiceId,
      number: "INV-000002",
      paise: 70000,
      status: "paid",
    });

    const autoTotal = await scalar(`SELECT total FROM invoices WHERE id = ?`, [
      p3.value.autoInvoiceId as string,
    ]);
    expect(autoTotal).toBe(70000);

    // Books net to zero: Σ debits (100000 invoice + 70000 auto) === Σ credits.
    expect(await studentBalance(studentId)).toBe(0);
    expect(await ledgerTailBalance(studentId)).toBe(0);

    // F2: every web-written row verifies against the Prisma-side reconciler.
    const rec = await reconcileLedger(prisma, tenantId, studentId);
    expect(rec.ok && rec.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F2 — the libsql dialect hashes exactly like the Prisma dialect
// ---------------------------------------------------------------------------

describe("hash-dialect unification (F2)", () => {
  it("writes rows that reconcileLedger verifies (invoice + payment + auto-invoice)", async () => {
    const tenantId = await seedTenant();
    const studentId = await seedStudent(tenantId);

    const inv = await createInvoiceSql(client, {
      tenantId, studentId, amountPaise: 100000, description: "Fee", issueDate: FEE_DATE,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    // Overpay -> exercises the auto-invoice rows in the same chain.
    const pay = await recordPaymentSql(client, {
      tenantId, studentId, amountPaise: 150000, description: "Overpay", receivedOn: FEE_DATE,
    });
    expect(pay.ok).toBe(true);

    const rows = await countRows(
      `SELECT id FROM ledger_entries WHERE tenant_id = ? AND student_id = ?`,
      [tenantId, studentId],
    );
    expect(rows).toBe(4); // FEE_CHARGED, PAYMENT_RECEIVED, auto FEE_CHARGED, auto PAYMENT_RECEIVED

    // Chain linkage: each row's prev_hash is the previous row's this_hash.
    const unchained = await countRows(
      `SELECT a.id FROM ledger_entries a
       JOIN ledger_entries b
         ON b.student_id = a.student_id
        AND b.created_at = (
          SELECT MAX(c.created_at) FROM ledger_entries c
          WHERE c.student_id = a.student_id AND c.created_at < a.created_at
        )
       WHERE a.student_id = ? AND COALESCE(b.this_hash, '') != COALESCE(a.prev_hash, '')`,
      [studentId],
    );
    expect(unchained).toBe(0);

    const rec = await reconcileLedger(prisma, tenantId, studentId);
    expect(rec.ok && rec.value).toBe(true);
    expect(await studentBalance(studentId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 — one transaction: a mid-flow failure undoes EVERYTHING
// ---------------------------------------------------------------------------

describe("atomicity (F4 / §9.6 all-or-nothing)", () => {
  it("rolls back audit, ledger, invoice status and the seq increment when the number collides", async () => {
    const tenantId = await seedTenant();
    const studentA = await seedStudent(tenantId);
    const studentB = await seedStudent(tenantId);

    const inv = await createInvoiceSql(client, {
      tenantId, studentId: studentA, amountPaise: 50000, description: "Fee", issueDate: FEE_DATE,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const invoiceId = inv.value.invoiceId;
    expect(await seqFor(tenantId)).toBe(2);

    // Decoy occupies INV-000002 — the number the auto-invoice will claim.
    const now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
              subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
            VALUES (?, ?, 'INV-000002', ?, ?, ?, 1, 0, 0, 1, 'paid', 'decoy', ?, ?)`,
      args: [randomUUID(), tenantId, studentB, FEE_DATE, FEE_DATE, now, now],
    });

    const ledgerBefore = await countRows(`SELECT id FROM ledger_entries WHERE tenant_id = ?`, [tenantId]);
    const auditBefore = await countRows(`SELECT id FROM audit_log WHERE tenant_id = ?`, [tenantId]);
    const outboxBefore = await countRows(`SELECT id FROM sync_outbox WHERE tenant_id = ?`, [tenantId]);
    const balanceBefore = await studentBalance(studentA);

    // 60000 against a 50000 invoice: 50000 applied, 10000 remainder ->
    // auto-invoice number INV-000002 -> UNIQUE(tenant_id, number) -> throw
    // AFTER the audit row, the credit row and the status flip were written.
    const res = await recordPaymentSql(client, {
      tenantId, studentId: studentA, amountPaise: 60000, description: "Cash", receivedOn: FEE_DATE,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(String(res.error.message)).toMatch(/UNIQUE|constraint/i);

    // EVERYTHING from the failed flow is gone (fail-closed, §9.6).
    expect(await countRows(`SELECT id FROM audit_log WHERE tenant_id = ?`, [tenantId])).toBe(auditBefore);
    expect(await countRows(`SELECT id FROM audit_log WHERE tenant_id = ? AND action = 'payment_record'`, [tenantId])).toBe(0);
    expect(await countRows(`SELECT id FROM ledger_entries WHERE tenant_id = ?`, [tenantId])).toBe(ledgerBefore);
    expect(await countRows(`SELECT id FROM sync_outbox WHERE tenant_id = ?`, [tenantId])).toBe(outboxBefore);
    expect(await invoiceStatus(invoiceId)).toBe("unpaid"); // flipped to paid, then undone
    expect(await invoiceCredits(invoiceId)).toBe(0);
    expect(await studentBalance(studentA)).toBe(balanceBefore);
    expect(await ledgerTailBalance(studentA)).toBe(balanceBefore);
    expect(await seqFor(tenantId)).toBe(2); // increment rolled back
  });
});

// ---------------------------------------------------------------------------
// F5 — ghost students are typed errors, never phantom rows
// ---------------------------------------------------------------------------

describe("phantom students (F5)", () => {
  it("fails with STUDENT_NOT_FOUND and writes nothing", async () => {
    const tenantId = await seedTenant();
    const ghost = randomUUID();
    const studentsBefore = await countRows(`SELECT id FROM students WHERE tenant_id = ?`, [tenantId]);
    const auditBefore = await countRows(`SELECT id FROM audit_log WHERE tenant_id = ?`, [tenantId]);
    const ledgerBefore = await countRows(`SELECT id FROM ledger_entries WHERE tenant_id = ?`, [tenantId]);
    const seqBefore = await seqFor(tenantId);

    const pay = await recordPaymentSql(client, {
      tenantId, studentId: ghost, amountPaise: 10000, description: "Cash", receivedOn: FEE_DATE,
    });
    expect(pay.ok).toBe(false);
    if (!pay.ok) expect(String(pay.error.message)).toMatch(/STUDENT_NOT_FOUND/);

    const inv = await createInvoiceSql(client, {
      tenantId, studentId: ghost, amountPaise: 10000, description: "Fee", issueDate: FEE_DATE,
    });
    expect(inv.ok).toBe(false);
    if (!inv.ok) expect(String(inv.error.message)).toMatch(/STUDENT_NOT_FOUND/);

    expect(await countRows(`SELECT id FROM students WHERE tenant_id = ?`, [tenantId])).toBe(studentsBefore);
    expect(await countRows(`SELECT id FROM audit_log WHERE tenant_id = ?`, [tenantId])).toBe(auditBefore);
    expect(await countRows(`SELECT id FROM ledger_entries WHERE tenant_id = ?`, [tenantId])).toBe(ledgerBefore);
    expect(await seqFor(tenantId)).toBe(seqBefore);
  });
});

// ---------------------------------------------------------------------------
// F1 — tamper key fails closed
// ---------------------------------------------------------------------------

describe("tenant secret fail-closed (F1)", () => {
  it("refuses to write under an empty tenant secret and leaves no partial rows", async () => {
    const tenantId = await seedTenant("");
    const studentId = await seedStudent(tenantId);
    const ledgerBefore = await countRows(`SELECT id FROM ledger_entries WHERE tenant_id = ?`, [tenantId]);

    const inv = await createInvoiceSql(client, {
      tenantId, studentId, amountPaise: 10000, description: "Fee", issueDate: FEE_DATE,
    });
    expect(inv.ok).toBe(false);
    if (!inv.ok) expect(String(inv.error.message)).toMatch(/SECURITY_VIOLATION/);

    expect(await countRows(`SELECT id FROM ledger_entries WHERE tenant_id = ?`, [tenantId])).toBe(ledgerBefore);
    expect(await countRows(`SELECT id FROM invoices WHERE tenant_id = ?`, [tenantId])).toBe(0);
    expect(await seqFor(tenantId)).toBe(1); // secret is read before the seq is consumed
  });
});

// ---------------------------------------------------------------------------
// EC-05 — concurrent payments keep one consistent ledger
// ---------------------------------------------------------------------------

describe("concurrent payments (EC-05)", () => {
  it("keeps the chain verifiable and the balance equal to the ledger tail", async () => {
    const tenantId = await seedTenant();
    const studentId = await seedStudent(tenantId);
    const inv = await createInvoiceSql(client, {
      tenantId, studentId, amountPaise: 100000, description: "Fee", issueDate: FEE_DATE,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    const results = await Promise.all([
      recordPaymentSql(client, { tenantId, studentId, amountPaise: 50000, description: "A", receivedOn: FEE_DATE }),
      recordPaymentSql(client, { tenantId, studentId, amountPaise: 50000, description: "B", receivedOn: FEE_DATE }),
    ]);

    // Every outcome is a typed Result — no crashes, no partial promises.
    for (const r of results) {
      if (!r.ok) expect(r.error).toBeInstanceOf(Error);
    }
    const winners = results.filter((r) => r.ok);
    expect(winners.length).toBeGreaterThanOrEqual(1);

    const paid = await invoiceCredits(inv.value.invoiceId);
    expect(paid).toBe(50000 * winners.length);
    const status = await invoiceStatus(inv.value.invoiceId);
    expect(["partial", "paid"]).toContain(status);
    if (paid === 100000) expect(status).toBe("paid");
    if (paid === 50000) expect(status).toBe("partial");

    expect(await studentBalance(studentId)).toBe(100000 - paid);
    expect(await ledgerTailBalance(studentId)).toBe(100000 - paid);

    const rec = await reconcileLedger(prisma, tenantId, studentId);
    expect(rec.ok && rec.value).toBe(true);
  });
});
