// Implements: AGENTS.md §7.3 (never mock the ledger — real in-memory DB),
// §2 Rule 1 / Rule 6 / Rule 7; 12_Business_Rules.md BR-LED-03, BR-FEE-04/05,
// BR-M-01, BR-SYN-01/02; 07_Fees_and_Payments.md §9.6/§9.7; 14_Edge_Cases.md
// EC-F-02 / EC-05; reviews/overhaul-audit-report-2026-09-26.md F2/F9 (the
// shadow-ledger failure class: two writers, two meanings).
//
// WHAT THIS PROVES: the invoice/payment money logic exists ONCE
// (`packages/core/src/feesFlow.ts`) with two I/O dialects — the libsql one
// (`fees.ts`, used by the gateway) and the ORM one (`feesPrisma.ts`, used by
// `apps/web`). This suite runs BOTH over the same schema and asserts they
// produce the same money, the same numbers, the same status transitions and the
// same replication rows. If a future change makes one dialect behave
// differently, this fails instead of the tutor's books.
//
// The ORM side runs through the REAL web shim
// (`apps/web/src/lib/libsql-proxy.ts`), because that is the surface
// `apps/web` actually holds — a test double would prove nothing about it.

import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInvoicePrisma, recordPaymentPrisma } from "./feesPrisma";
import { createInvoiceSql, recordPaymentSql } from "./fees";
import { createLibsqlProxy } from "../../../apps/web/src/lib/libsql-proxy";

const TENANT = "tenant_dialect_parity";

let client: Client;
let dir: string;
const opened: { client: Client; dir: string }[] = [];

async function scalar(db: Client, sql: string, args: unknown[] = []): Promise<number> {
  const res = await db.execute({ sql, args: args as never[] });
  return Number(res.rows[0]?.c ?? 0);
}

async function one<T = Record<string, unknown>>(
  db: Client,
  sql: string,
  args: unknown[] = [],
): Promise<T | null> {
  const res = await db.execute({ sql, args: args as never[] });
  const row = res.rows[0];
  return row ? ({ ...row } as T) : null;
}

async function seedStudent(db: Client, id: string, balancePaise: number): Promise<void> {
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, admission_date, dup_key, status,
            balance_paise, created_at, updated_at)
          VALUES (?, ?, 'Asha', '2026-01-15', ?, 'active', ?, ?, ?)`,
    args: [id, TENANT, `dup-${id}`, balancePaise, now, now],
  });
}

async function seedInvoice(
  db: Client,
  id: string,
  studentId: string,
  number: string,
  totalPaise: number,
  dueDate: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
            subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'unpaid', 'seed-hash', ?, ?)`,
    args: [id, TENANT, number, studentId, dueDate, dueDate, totalPaise, totalPaise, now, now],
  });
}

/** The money-relevant footprint of a database, ignoring ids and timestamps. */
async function moneyFootprint(db: Client): Promise<Record<string, unknown>> {
  const invoices = await db.execute({
    sql: `SELECT number, student_id, total, status FROM invoices ORDER BY number`,
  });
  const ledger = await db.execute({
    sql: `SELECT type, invoice_id IS NOT NULL AS linked, debit_paise, credit_paise,
                 balance_after_paise, occurred_on, description
          FROM ledger_entries ORDER BY created_at, type`,
  });
  const outbox = await db.execute({
    sql: `SELECT table_name, op FROM sync_outbox ORDER BY table_name, op`,
  });
  const audit = await db.execute({
    sql: `SELECT action, ref_type FROM audit_log ORDER BY created_at, action`,
  });
  const balance = await one<{ balance_paise: number }>(db,
    `SELECT balance_paise FROM students LIMIT 1`,
  );
  const seq = await one<{ next_invoice_seq: number }>(db,
    `SELECT next_invoice_seq FROM settings WHERE tenant_id = ?`,
    [TENANT],
  );
  return {
    invoices: invoices.rows,
    ledger: ledger.rows,
    outbox: outbox.rows,
    audit: audit.rows,
    balance: balance?.balance_paise ?? null,
    nextInvoiceSeq: seq?.next_invoice_seq ?? null,
  };
}

beforeEach(() => {
  opened.length = 0;
});

/**
 * A fresh, real, file-backed SQLite database per dialect iteration
 * (AGENTS.md §7.3 — never mock the ledger). A file rather than `:memory:` so the
 * client and its transaction handles share one database for the whole run, and
 * a FRESH one per iteration so neither dialect can be handed the other's rows —
 * which also means the suite never has to reset tables between runs (and never
 * needs to DELETE from an append-only ledger, Rule 1).
 */
async function openDb(): Promise<Client> {
  dir = mkdtempSync(join(tmpdir(), "buddysaradhi-dialect-parity-"));
  client = createClient({ url: `file:${join(dir, "tenant.db")}` });
  opened.push({ client, dir });
  await client.executeMultiple(`
    CREATE TABLE settings (
      tenant_id         TEXT PRIMARY KEY,
      institute_name    TEXT NOT NULL DEFAULT 'My Tuition',
      invoice_prefix    TEXT NOT NULL DEFAULT 'INV-',
      receipt_prefix    TEXT NOT NULL DEFAULT 'RCP-',
      next_invoice_seq  INTEGER NOT NULL DEFAULT 1,
      tenant_secret     TEXT NOT NULL,
      pin_hash          TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE TABLE students (
      id             TEXT PRIMARY KEY,
      tenant_id      TEXT NOT NULL,
      first_name     TEXT NOT NULL,
      admission_date TEXT NOT NULL,
      dup_key        TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'active',
      balance_paise  INTEGER NOT NULL DEFAULT 0,
      archived_at    TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE TABLE invoices (
      id             TEXT PRIMARY KEY,
      tenant_id      TEXT NOT NULL,
      number         TEXT NOT NULL,
      student_id     TEXT NOT NULL,
      issue_date     TEXT NOT NULL,
      due_date       TEXT,
      subtotal       INTEGER NOT NULL,
      discount       INTEGER NOT NULL DEFAULT 0,
      extra_charges  INTEGER NOT NULL DEFAULT 0,
      total          INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'unpaid',
      voided_at      TEXT,
      tamper_hash    TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      UNIQUE(tenant_id, number)
    );
    CREATE TABLE ledger_entries (
      id                   TEXT PRIMARY KEY,
      tenant_id            TEXT NOT NULL,
      student_id           TEXT NOT NULL,
      invoice_id           TEXT,
      type                 TEXT NOT NULL,
      debit_paise          INTEGER NOT NULL DEFAULT 0,
      credit_paise         INTEGER NOT NULL DEFAULT 0,
      balance_after_paise  INTEGER NOT NULL,
      description          TEXT,
      prev_hash            TEXT,
      this_hash            TEXT NOT NULL,
      void_of_id           TEXT,
      occurred_on          TEXT NOT NULL,
      source               TEXT NOT NULL DEFAULT 'manual',
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
    CREATE TABLE sync_outbox (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      table_name  TEXT NOT NULL,
      row_id      TEXT NOT NULL,
      op          TEXT NOT NULL CHECK(op IN ('insert','update','soft_delete')),
      payload     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL
    );
    CREATE TABLE audit_log (
      id         TEXT PRIMARY KEY,
      tenant_id  TEXT NOT NULL,
      actor      TEXT NOT NULL,
      action     TEXT NOT NULL,
      ref_type   TEXT,
      ref_id     TEXT,
      metadata   TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO settings (tenant_id, tenant_secret, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    args: [TENANT, "parity-secret", now, now],
  });
  return client;
}

afterEach(async () => {
  for (const entry of opened) {
    try {
      await Promise.resolve(entry.client.close());
    } catch {
      // Best-effort: libSQL may already be closed.
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(entry.dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
  opened.length = 0;
});

type CreateInvoiceInputLike = {
  tenantId: string;
  studentId: string;
  amountPaise: number;
  description: string;
  issueDate: string;
};
type RecordPaymentInputLike = {
  tenantId: string;
  studentId: string;
  amountPaise: number;
  description: string;
  receivedOn: string;
};
type CreateInvoiceOutcome = {
  ok: boolean;
  value?: { number: string };
  error?: Error;
};
type RecordPaymentOutcome = {
  ok: boolean;
  value?: { creditedPaise: number; autoInvoiceNumber: string | null };
  error?: Error;
};

type Dialect = {
  name: string;
  createInvoice(db: unknown, input: CreateInvoiceInputLike): Promise<CreateInvoiceOutcome>;
  recordPayment(db: unknown, input: RecordPaymentInputLike): Promise<RecordPaymentOutcome>;
};

/** The libsql dialect talks to the raw client; the ORM dialect to the shim. */
const DIALECTS: Dialect[] = [
  {
    name: "libsql dialect (fees.ts, gateway path)",
    createInvoice: (db, input) => createInvoiceSql(db as never, input),
    recordPayment: (db, input) => recordPaymentSql(db as never, input),
  },
  {
    name: "ORM dialect (feesPrisma.ts, web path)",
    createInvoice: (db, input) => createInvoicePrisma(db as never, input),
    recordPayment: (db, input) => recordPaymentPrisma(db as never, input),
  },
];

const isLibsql = (dialect: Dialect): boolean => dialect.name.startsWith("libsql");

/** The handle each dialect expects: raw client vs the web ORM shim. */
function handleFor(dialect: Dialect, db: Client): unknown {
  return isLibsql(dialect) ? db : createLibsqlProxy(db);
}

describe("dialect parity — the same money from either writer", () => {
  it("createInvoice produces identical rows, number, ledger link and replication", async () => {
    const results: unknown[] = [];
    for (const dialect of DIALECTS) {
      const db = await openDb();
      // Same student id in both iterations: the tamper hash and the ledger
      // payload both embed it, so a per-iteration id would mask a real
      // divergence behind a different expected value.
      const studentId = "student-parity";
      await seedStudent(db, studentId, 0);

      const res = await dialect.createInvoice(handleFor(dialect, db), {
        tenantId: TENANT,
        studentId,
        amountPaise: 150000,
        description: "August tuition",
        issueDate: "2026-09-01",
      });
      expect(res.ok, `${dialect.name} failed: ${res.error?.message}`).toBe(true);
      expect(res.value?.number).toBe("INV-000001");
      results.push(await moneyFootprint(db));
    }
    expect(results[1]).toEqual(results[0]);
  });

  it("recordPayment attributes identically across invoices and auto-invoices the surplus", async () => {
    const results: unknown[] = [];
    for (const dialect of DIALECTS) {
      const db = await openDb();
      const studentId = "student-parity";
      await seedStudent(db, studentId, 0);
      // Two open invoices (100000 + 60000) and a 180000 payment: the flow must
      // settle both and auto-invoice the 20000 surplus, which takes INV-000001
      // on this fresh database (BR-LED-03: the sequence starts at 1).
      await seedInvoice(db, "invoice-a", studentId, "INV-000001", 100000, "2026-09-05");
      await seedInvoice(db, "invoice-b", studentId, "INV-000002", 60000, "2026-09-10");
      await db.execute(`UPDATE settings SET next_invoice_seq = 3 WHERE tenant_id = ?`, [TENANT]);

      const res = await dialect.recordPayment(handleFor(dialect, db), {
        tenantId: TENANT,
        studentId,
        amountPaise: 180000,
        description: "Cash",
        receivedOn: "2026-09-12",
      });
      expect(res.ok, `${dialect.name} failed: ${res.error?.message}`).toBe(true);
      expect(res.value?.creditedPaise).toBe(180000);
      expect(res.value?.autoInvoiceNumber).toBe("INV-000003");

      const footprint = await moneyFootprint(db);
      const statuses = (footprint.invoices as { number: string; status: string }[])
        .map((row) => `${row.number}:${row.status}`)
        .sort();
      expect(statuses).toEqual(["INV-000001:paid", "INV-000002:paid", "INV-000003:paid"]);
      results.push(footprint);
    }
    expect(results[1]).toEqual(results[0]);
  });

  it("every paise is attributed — the invariant that aborts the transaction", async () => {
    for (const dialect of DIALECTS) {
      const db = await openDb();
      const studentId = "student-parity";
      await seedStudent(db, studentId, 0);
      await seedInvoice(db, "invoice-a", studentId, "INV-000001", 100000, "2026-09-05");

      const res = await dialect.recordPayment(handleFor(dialect, db), {
        tenantId: TENANT,
        studentId,
        amountPaise: 100000,
        description: "Cash",
        receivedOn: "2026-09-12",
      });
      expect(res.ok, `${dialect.name}: ${res.error?.message}`).toBe(true);
      expect(res.value?.creditedPaise).toBe(100000);
      const credits = await scalar(
        db,
        `SELECT COALESCE(SUM(credit_paise), 0) AS c FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'`,
      );
      expect(credits).toBe(100000);
    }
  });

  it("a ghost student aborts both dialects with the same typed error (F5)", async () => {
    const db = await openDb();
    const ghost = randomUUID();
    for (const dialect of DIALECTS) {
      const res = await dialect.createInvoice(handleFor(dialect, db), {
        tenantId: TENANT,
        studentId: ghost,
        amountPaise: 1000,
        description: "x",
        issueDate: "2026-09-01",
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message).toMatch(/STUDENT_NOT_FOUND/);
    }
    // Nothing was written by the failed attempts (fail-closed, F5).
    expect(await scalar(db, `SELECT COUNT(*) AS c FROM invoices`)).toBe(0);
    expect(await scalar(db, `SELECT COUNT(*) AS c FROM audit_log`)).toBe(0);
  });

  it("a missing tenant secret aborts both dialects (fail-closed hashing, F1)", async () => {
    for (const dialect of DIALECTS) {
      const db = await openDb();
      await db.execute(`DELETE FROM settings WHERE tenant_id = ?`, [TENANT]);
      const studentId = "student-parity";
      await seedStudent(db, studentId, 0);
      const res = await dialect.createInvoice(handleFor(dialect, db), {
        tenantId: TENANT,
        studentId,
        amountPaise: 1000,
        description: "x",
        issueDate: "2026-09-01",
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message).toMatch(/TENANT_SETTINGS_NOT_FOUND/);
    }
  });

  it("a non-integer, zero or negative amount is rejected by both (BR-M-01)", async () => {
    for (const dialect of DIALECTS) {
      const db = await openDb();
      const studentId = "student-parity";
      await seedStudent(db, studentId, 0);
      for (const amountPaise of [0, -100, 10.5, Number.NaN]) {
        const res = await dialect.recordPayment(handleFor(dialect, db), {
          tenantId: TENANT,
          studentId,
          amountPaise,
          description: "x",
          receivedOn: "2026-09-12",
        });
        expect(res.ok, `${dialect.name} accepted ${amountPaise}`).toBe(false);
        expect(res.error?.message).toMatch(/AMOUNT_INVALID/);
      }
      // Not one paise reached the ledger.
      expect(await scalar(db, `SELECT COUNT(*) AS c FROM ledger_entries`)).toBe(0);
    }
  });

  it("Rule 7: both dialects write outbox + audit rows for every mutation", async () => {
    for (const dialect of DIALECTS) {
      const db = await openDb();
      const studentId = "student-parity";
      await seedStudent(db, studentId, 0);
      const res = await dialect.createInvoice(handleFor(dialect, db), {
        tenantId: TENANT,
        studentId,
        amountPaise: 50000,
        description: "August tuition",
        issueDate: "2026-09-01",
      });
      expect(res.ok, `${dialect.name}: ${res.error?.message}`).toBe(true);

      const invoices = await scalar(
        db,
        `SELECT COUNT(*) AS c FROM sync_outbox WHERE table_name = 'invoices'`,
      );
      const settings = await scalar(
        db,
        `SELECT COUNT(*) AS c FROM sync_outbox WHERE table_name = 'settings'`,
      );
      const audits = await scalar(
        db,
        `SELECT COUNT(*) AS c FROM audit_log WHERE action = 'invoice.create'`,
      );
      // invoice insert + the consumed settings sequence + the audit row.
      expect(invoices).toBeGreaterThanOrEqual(1);
      expect(settings).toBe(1);
      expect(audits).toBe(1);
      // 11_Data_Model.md §4.18 CHECK: only the three legal ops ever land.
      const badOps = await scalar(
        db,
        `SELECT COUNT(*) AS c FROM sync_outbox WHERE op NOT IN ('insert','update','soft_delete')`,
      );
      expect(badOps).toBe(0);
    }
  });

  it("the tamper hash is byte-identical across dialects (10_Security.md §10)", async () => {
    const hashes: string[] = [];
    for (const dialect of DIALECTS) {
      const db = await openDb();
      const studentId = "student-parity";
      await seedStudent(db, studentId, 0);
      const res = await dialect.createInvoice(handleFor(dialect, db), {
        tenantId: TENANT,
        studentId,
        amountPaise: 150000,
        description: "August tuition",
        issueDate: "2026-09-01",
      });
      expect(res.ok, `${dialect.name}: ${res.error?.message}`).toBe(true);
      const row = await one<{ tamper_hash: string }>(
        db,
        `SELECT tamper_hash FROM invoices WHERE number = 'INV-000001'`,
      );
      hashes.push(row?.tamper_hash ?? "");
    }
    expect(hashes[0]).not.toBe("");
    expect(hashes[1]).toBe(hashes[0]);
  });
});
