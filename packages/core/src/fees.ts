// Implements: 07_Fees_and_Payments.md §9.6 / §9.7 / §9 line 419 (see
// `feesFlow.ts` for the full citation list — the MONEY LOGIC lives there, this
// file is only the libSQL dialect of it); 12_Business_Rules.md BR-LED-03,
// BR-M-01, BR-SYN-01/02; AGENTS.md §2 Rule 1 + Rule 7 + §3.4 (executes NO DDL;
// schema authority is `prisma migrate` / `apps/gateway/lib/schema.ts`).
//
// WHY a dialect: this is the **libsql dialect** of the invoice/payment flows,
// for runtimes whose handle is a raw `@libsql/client` (the gateway and any
// libsql-first caller). `feesPrisma.ts` is the ORM dialect for `apps/web`. Both
// delegate to the single flow in `feesFlow.ts`, so a behaviour change to a
// payment cannot diverge between them (the shadow-ledger failure class —
// reviews/overhaul-audit-report-2026-09-26.md F2/F9).
//
// This adapter's only job is to translate the ten port operations into
// parameterised statements inside ONE write transaction (`withWriteTx`,
// BEGIN IMMEDIATE). It never decides anything about money.
import { randomUUID } from "crypto";
import { encodeOutboxPayload, nextCreatedAtIso, type Result } from "./ledger";
import { computeInvoiceTamperHash } from "./tamper";
import {
  createInvoiceFlow,
  recordPaymentFlow,
  FEE_AUDIT_ACTOR,
  type AppliedInvoice,
  type AuditArgs,
  type CreateInvoiceInput,
  type CreateInvoiceResult,
  type EntryInput,
  type FeeTx,
  type InvoiceInsert,
  type InvoiceStatus,
  type OpenInvoice,
  type ReceiptInsert,
  type RecordPaymentInput,
  type RecordPaymentResult,
} from "./feesFlow";
import {
  postLedgerEntrySql,
  requireTenantSecretTx,
  withWriteTx,
  type SqlExecutor,
  type SqlWriteClient,
} from "./ledgerSql";

// Re-exported so `@buddysaradhi/core`'s public surface keeps exposing the
// canonical formula (10_Security.md §10) from where it always was; the
// implementation now lives in `tamper.ts` because `apps/gateway/routes/
// ledger.ts` computes the same bytes for its own invoice rows.
export { computeInvoiceTamperHash };

// The flow's contracts are the package's contracts; re-exported from here
// because `@buddysaradhi/core/fees` is the public entry for them.
export type {
  AppliedInvoice,
  CreateInvoiceInput,
  CreateInvoiceResult,
  RecordPaymentInput,
  RecordPaymentResult,
};

/** Rule 7 / BR-SYN-01 — queue a replication row in the caller's transaction. */
async function insertOutbox(
  tx: SqlExecutor,
  o: {
    tenantId: string;
    tableName: string;
    rowId: string;
    op: "insert" | "update";
    payload: string;
    createdAt: string;
  },
): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), o.tenantId, o.tableName, o.rowId, o.op, o.payload, o.createdAt],
  });
}

/** §9.6 step 1 — one audit row per tutor action, written fail-closed. */
async function insertAudit(tx: SqlExecutor, a: AuditArgs): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      a.tenantId,
      FEE_AUDIT_ACTOR,
      a.action,
      a.refType,
      a.refId,
      a.metadata,
      a.now,
    ],
  });
}

/** Insert an `invoices` row (0001 columns) + its outbox row in one tx. */
async function insertInvoiceRow(tx: SqlExecutor, inv: InvoiceInsert): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
              subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    args: [
      inv.invoiceId,
      inv.tenantId,
      inv.number,
      inv.studentId,
      inv.issueDate,
      inv.dueDate,
      inv.totalPaise,
      inv.totalPaise,
      inv.status,
      inv.tamperHash,
      inv.now,
      inv.now,
    ],
  });
  await insertOutbox(tx, {
    tenantId: inv.tenantId,
    tableName: "invoices",
    rowId: inv.invoiceId,
    op: "insert",
    // Canonical snake_case envelope (`encodeOutboxPayload` in `ledger.ts`,
    // mirroring `packages/shared/src/outboxPayload.ts` — P3-11).
    payload: encodeOutboxPayload("invoices", "insert", {
      id: inv.invoiceId,
      tenant_id: inv.tenantId,
      number: inv.number,
      student_id: inv.studentId,
      issue_date: inv.issueDate,
      due_date: inv.dueDate,
      subtotal: inv.totalPaise,
      discount: 0,
      extra_charges: 0,
      total: inv.totalPaise,
      status: inv.status,
      tamper_hash: inv.tamperHash,
      created_at: inv.now,
      updated_at: inv.now,
    }).payload,
    createdAt: inv.now,
  });
}

/**
 * 07 §9.6 step 4 — the receipt row plus its `sync_outbox` replication row
 * (Rule 7). `voided_at`, `pdf_blob_key` and `deleted_at` are left NULL: a
 * receipt is born live, and the void path is the only thing that may ever set
 * `voided_at` (Rule 1 — a receipt is never updated into a different receipt).
 */
async function insertReceiptRow(tx: SqlExecutor, r: ReceiptInsert): Promise<void> {
  await tx.execute({
    // `deleted_at` is deliberately NOT in the column list: a new receipt has no
    // soft-delete, and naming a column that is absent from the older
    // `migrations/0001_init.sql` shape aborts the whole insert. It stays NULL by
    // default on every authority (11_Data_Model.md §3.7).
    sql: `INSERT INTO receipts (id, tenant_id, number, ledger_entry_id, student_id, invoice_id,
              amount, payment_method, payment_ref, received_on, tamper_hash,
              voided_at, pdf_blob_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    args: [
      r.receiptId,
      r.tenantId,
      r.number,
      r.ledgerEntryId,
      r.studentId,
      r.invoiceId,
      r.amountPaise,
      r.paymentMethod,
      r.paymentRef,
      r.receivedOn,
      r.tamperHash,
      r.now,
      r.now,
    ],
  });
  await insertOutbox(tx, {
    tenantId: r.tenantId,
    tableName: "receipts",
    rowId: r.receiptId,
    op: "insert",
    payload: encodeOutboxPayload("receipts", "insert", {
      id: r.receiptId,
      tenant_id: r.tenantId,
      number: r.number,
      ledger_entry_id: r.ledgerEntryId,
      student_id: r.studentId,
      invoice_id: r.invoiceId,
      amount: r.amountPaise,
      payment_method: r.paymentMethod,
      payment_ref: r.paymentRef,
      received_on: r.receivedOn,
      tamper_hash: r.tamperHash,
      created_at: r.now,
      updated_at: r.now,
    }).payload,
    createdAt: r.now,
  });
}

/**
 * The libsql implementation of the fee-flow port. Every method is one
 * row-level statement or one indexed read — no decisions about money happen
 * here (they live in `feesFlow.ts`).
 */
function sqlFeeTx(tx: SqlExecutor): FeeTx {
  return {
    async requireStudent(tenantId, studentId) {
      // F5: a ghost id is a typed error, never a phantom row.
      const res = await tx.execute({
        sql: `SELECT id FROM students WHERE id = ? AND tenant_id = ? LIMIT 1`,
        args: [studentId, tenantId],
      });
      if (res.rows.length === 0) {
        throw new Error(`STUDENT_NOT_FOUND: no student ${studentId} in tenant ${tenantId}`);
      }
    },

    requireTenantSecret(tenantId) {
      return requireTenantSecretTx(tx, tenantId);
    },

    /**
     * §9.7 — atomic `next_invoice_seq` increment + number build, inside the
     * caller's write transaction (BEGIN IMMEDIATE holds the settings row lock,
     * so EC-05's racer cannot read the same seq). The increment rolls back with
     * the transaction if any later step fails, so a failed flow consumes no
     * number. EC-19: `invoice_prefix` is read fresh each call — a mid-stream
     * prefix change affects only new numbers; the sequence never resets.
     */
    async takeInvoiceNumber(tenantId, now) {
      const upd = await tx.execute({
        sql: `UPDATE settings SET next_invoice_seq = next_invoice_seq + 1, updated_at = ?
              WHERE tenant_id = ?`,
        args: [now, tenantId],
      });
      if (upd.rowsAffected === 0) {
        throw new Error(`TENANT_SETTINGS_NOT_FOUND: no settings row for ${tenantId}`);
      }
      const res = await tx.execute({
        sql: `SELECT invoice_prefix, next_invoice_seq FROM settings WHERE tenant_id = ? LIMIT 1`,
        args: [tenantId],
      });
      const row = res.rows[0];
      if (!row) {
        throw new Error(`TENANT_SETTINGS_NOT_FOUND: no settings row for ${tenantId}`);
      }
      const seq = Number(row.next_invoice_seq) - 1;
      const prefix = String(row.invoice_prefix);
      return { number: `${prefix}${String(seq).padStart(6, "0")}`, seq, prefix };
    },

    insertInvoice(row) {
      return insertInvoiceRow(tx, row);
    },

    async takeReceiptNumber(tenantId, now) {
      // BR-RC-01: atomic increment, never decremented — a void leaves a gap by
      // design (the gap is the audit trail). Identical shape to the invoice take
      // so a missing settings row fails the same closed way.
      const upd = await tx.execute({
        sql: `UPDATE settings SET next_receipt_seq = next_receipt_seq + 1, updated_at = ?
              WHERE tenant_id = ?`,
        args: [now, tenantId],
      });
      if (upd.rowsAffected === 0) {
        throw new Error(`TENANT_SETTINGS_NOT_FOUND: no settings row for ${tenantId}`);
      }
      const res = await tx.execute({
        sql: `SELECT receipt_prefix, next_receipt_seq FROM settings WHERE tenant_id = ? LIMIT 1`,
        args: [tenantId],
      });
      const row = res.rows[0];
      if (!row) {
        throw new Error(`TENANT_SETTINGS_NOT_FOUND: no settings row for ${tenantId}`);
      }
      const seq = Number(row.next_receipt_seq) - 1;
      const prefix = String(row.receipt_prefix ?? "RCP-");
      return { number: `${prefix}${String(seq).padStart(6, "0")}`, seq, prefix };
    },

    insertReceipt(row) {
      return insertReceiptRow(tx, row);
    },

    async setInvoiceStatus({ tenantId, invoiceId, status, now }) {
      await tx.execute({
        sql: `UPDATE invoices SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
        args: [status, now, invoiceId, tenantId],
      });
      await insertOutbox(tx, {
        tenantId,
        tableName: "invoices",
        rowId: invoiceId,
        op: "update",
        payload: encodeOutboxPayload("invoices", "update", {
          id: invoiceId,
          status,
          updated_at: now,
        }).payload,
        createdAt: now,
      });
    },

    async openInvoices(tenantId, studentId): Promise<OpenInvoice[]> {
      const res = await tx.execute({
        sql: `SELECT id, number, total, status FROM invoices
              WHERE tenant_id = ? AND student_id = ?
                AND status IN ('unpaid', 'partial', 'overdue')
                AND voided_at IS NULL
              ORDER BY due_date ASC`,
        args: [tenantId, studentId],
      });
      return res.rows.map((row) => ({
        id: String(row.id),
        number: String(row.number),
        total: Number(row.total),
        status: String(row.status),
      }));
    },

    async creditedForInvoice(tenantId, invoiceId) {
      const res = await tx.execute({
        sql: `SELECT COALESCE(SUM(credit_paise), 0) AS paid FROM ledger_entries
              WHERE tenant_id = ? AND invoice_id = ?
                AND type != 'VOID' AND void_of_id IS NULL`,
        args: [tenantId, invoiceId],
      });
      return Number(res.rows[0]?.paid ?? 0);
    },

    async postEntry(input: EntryInput) {
      const res = await postLedgerEntrySql(tx, input);
      // A validation failure must abort the open transaction, so it re-throws.
      if (!res.ok) throw res.error;
      return res.value;
    },

    writeAudit(a) {
      return insertAudit(tx, a);
    },

    writeSettingsOutbox({ tenantId, prefix, seq, now }) {
      return insertOutbox(tx, {
        tenantId,
        tableName: "settings",
        rowId: tenantId,
        op: "update",
        payload: encodeOutboxPayload("settings", "update", {
          tenant_id: tenantId,
          invoice_prefix: prefix,
          next_invoice_seq: seq,
          updated_at: now,
        }).payload,
        createdAt: now,
      });
    },
  };
}

export async function createInvoiceSql(
  db: SqlWriteClient,
  input: CreateInvoiceInput,
): Promise<Result<CreateInvoiceResult>> {
  const now = nextCreatedAtIso();
  try {
    return await withWriteTx(db, async (tx) => createInvoiceFlow(sqlFeeTx(tx), input, now));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export async function recordPaymentSql(
  db: SqlWriteClient,
  input: RecordPaymentInput,
): Promise<Result<RecordPaymentResult>> {
  const now = nextCreatedAtIso();
  try {
    return await withWriteTx(db, async (tx) => recordPaymentFlow(sqlFeeTx(tx), input, now));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export type { InvoiceStatus };