// Implements: 12_Business_Rules.md BR-LED-01 (append-only), BR-LED-06 (hash
// chain), BR-M-01 (integer paise), BR-SYN-01/02 (sync_outbox in the same
// transaction as the mutation); AGENTS.md §2 Rule 1 + §2 Rule 7.
//
// This is the **libsql dialect** of `postLedgerEntry` (`ledger.ts`) for
// runtimes whose handle is a raw `@libsql/client` (web's
// `getAuthenticatedDb()` — `07_Fees_and_Payments.md` §9.9). It exists to
// retire `postLedgerEntryRaw` in `apps/web/src/server/actions/fees.ts`
// (reviews/overhaul-audit-report-2026-09-26.md **F2**: shadow ledger with a
// divergent HMAC hash construction made `reconcileLedger` fail on every
// web-written row). Both dialects build the hash from the SAME
// `buildEntryPayload` + `computeHash` in `ledger.ts`, so any row — Prisma or
// libsql — verifies against `reconcileLedger`.
//
// Executes NO DDL (AGENTS.md §3.4: schema authority is prisma migrate /
// `apps/gateway/lib/schema.ts` only) and never UPDATEs/DELETEs a
// `ledger_entries` row (Rule 1).
import { randomUUID } from "crypto";
import {
  LEDGER_ENTRY_TYPES,
  type LedgerEntryType,
  type Result,
  buildEntryPayload,
  computeHash,
  encodeOutboxPayload,
  nextCreatedAtIso,
  voidLedgerFlow,
  type VoidTx,
} from "./ledger";
import { paiseAdd, paiseSub } from "./money";

// ---------------------------------------------------------------------------
// Minimal structural contract for `@libsql/client`.
//
// Deliberately duck-typed instead of importing `Client`/`Transaction` types:
// `packages/core` depends on `@libsql/client` ^0.14 while `apps/web` pins
// ^0.17 — structural typing keeps either version assignable without coupling
// the two upgrade clocks. Method shorthand (not function properties) keeps
// parameter checking bivariant under `strictFunctionTypes`.
// ---------------------------------------------------------------------------

/**
 * One statement passed to `execute`. Deliberately shaped as a *union*
 * (`{sql, args?} | string`) so it is a supertype of libsql's `InStatement`
 * — that direction of assignability is what lets a real
 * `@libsql/client` `Client`/`Transaction` satisfy `SqlExecutor`/
 * `SqlWriteClient` under `strictFunctionTypes` (method parameters compare
 * bivariantly, so one direction suffices) without importing libsql's types
 * (web pins ^0.17, core ^0.14 — structural typing keeps the upgrade clocks
 * decoupled). `args` is `unknown` so both libsql arg forms are accepted at
 * the type level; callers in this package only ever pass positional arrays.
 */
export type SqlStatement =
  | { readonly sql: string; readonly args?: unknown }
  | string;

export interface SqlResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly rowsAffected: number;
}

export interface SqlExecutor {
  execute(stmt: SqlStatement): Promise<SqlResult>;
}

export interface SqlTransaction extends SqlExecutor {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface SqlWriteClient {
  transaction(mode: "write"): Promise<SqlTransaction>;
}

export interface SqlLedgerEntryInput {
  tenantId: string;
  studentId: string;
  type: LedgerEntryType;
  debitPaise: number;
  creditPaise: number;
  description?: string;
  voidOfId?: string | null;
  invoiceId?: string | null;
  occurredOn: string;
  source?: string;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Run `fn` inside ONE libsql write transaction (`BEGIN IMMEDIATE`):
 * commit on success, rollback on any thrown error (BR-SEC-03 fail-closed,
 * 07_Fees_and_Payments.md §9.6 — "All 8 steps succeed or none do").
 * If the rollback itself fails, both failures surface in the returned error
 * (Rule 9: no silent swallow).
 */
export async function withWriteTx<T>(
  db: SqlWriteClient,
  fn: (tx: SqlTransaction) => Promise<T>,
): Promise<Result<T>> {
  let tx: SqlTransaction;
  try {
    tx = await db.transaction("write");
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
  try {
    const value = await fn(tx);
    await tx.commit();
    return { ok: true, value };
  } catch (error) {
    const primary = toError(error);
    try {
      await tx.rollback();
    } catch (rollbackError) {
      return {
        ok: false,
        error: new Error(
          `${primary.message}; rollback also failed: ${toError(rollbackError).message}`,
        ),
      };
    }
    return { ok: false, error: primary };
  }
}

/**
 * Append one ledger row inside an open transaction — byte-identical payload
 * and hash construction to `postLedgerEntry` (BR-LED-06; F2 unification).
 *
 * - chain tail is read INSIDE the transaction (no stale-balance race; the
 *   `student.balance_paise` cache is never used as an input, only written),
 * - `students.balance_paise` is synced to the new ledger-derived balance
 *   (live UI: `apps/web/src/server/queries/students.ts`) — a 0-row UPDATE
 *   means the student does not exist and throws `STUDENT_NOT_FOUND`
 *   (reviews/overhaul-audit-report-2026-09-26.md **F5** — no phantom rows),
 * - Rule 7: `sync_outbox` rows for the ledger insert and the balance update
 *   are written here, in the same transaction.
 *
 * Returns `Result<string>` (the entry id) exactly like `postLedgerEntry`;
 * validation failures return `Err` without touching the DB.
 */
export async function postLedgerEntrySql(
  tx: SqlExecutor,
  input: SqlLedgerEntryInput,
): Promise<Result<string>> {
  if (input.debitPaise < 0 || input.creditPaise < 0) {
    return { ok: false, error: new Error("Amounts must be positive") };
  }
  if (
    !Number.isInteger(input.debitPaise) ||
    !Number.isInteger(input.creditPaise)
  ) {
    return { ok: false, error: new Error("Amounts must be integers") };
  }
  if (input.debitPaise + input.creditPaise <= 0) {
    return { ok: false, error: new Error("Amounts must be positive") };
  }
  if (!LEDGER_ENTRY_TYPES.includes(input.type)) {
    return { ok: false, error: new Error(`Invalid ledger entry type: ${input.type}`) };
  }

  const entryId = randomUUID();
  const now = nextCreatedAtIso();
  const source = input.source || "manual";

  try {
    // 1. Chain tail (prev balance + prev hash) — read inside the caller's
    // transaction so concurrent writers cannot interleave between read and
    // insert (07 §9.6; the gateway's stale-`balance_paise` race class).
    const lastRes = await tx.execute({
      sql: `SELECT balance_after_paise, this_hash FROM ledger_entries
            WHERE tenant_id = ? AND student_id = ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [input.tenantId, input.studentId],
    });
    const lastRow = lastRes.rows[0];
    const prevBalance = lastRow ? Number(lastRow.balance_after_paise) : 0;
    const prevHash = lastRow ? String(lastRow.this_hash) : null;

    // 2. Hash pepper — fail-closed (F1: never hash under a guessable key).
    const secret = await requireTenantSecretTx(tx, input.tenantId);

    // 3. New running balance + canonical payload + chained hash (BR-LED-06).
    // Rule 6 / BR-M-01: `prevBalance` was read back from SQLite, so both
    // operands and the result are validated as safe-integer paise — an
    // overflow or a corrupt `balance_after_paise` becomes a typed Err instead
    // of a poisoned `balance_after_paise` on every later row (EC-F-01).
    const newBalance = paiseAdd(paiseSub(prevBalance, input.creditPaise), input.debitPaise);
    const payload = buildEntryPayload({
      id: entryId,
      studentId: input.studentId,
      type: input.type,
      debitPaise: input.debitPaise,
      creditPaise: input.creditPaise,
      balanceAfterPaise: newBalance,
      occurredOn: input.occurredOn,
    });
    const thisHash = computeHash(prevHash, payload, now, secret);

    // 4. Append (INSERT only — Rule 1).
    await tx.execute({
      sql: `INSERT INTO ledger_entries (
              id, tenant_id, student_id, invoice_id, type,
              debit_paise, credit_paise, balance_after_paise,
              description, void_of_id, prev_hash, this_hash,
              occurred_on, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entryId,
        input.tenantId,
        input.studentId,
        input.invoiceId ?? null,
        input.type,
        input.debitPaise,
        input.creditPaise,
        newBalance,
        input.description ?? null,
        input.voidOfId ?? null,
        prevHash,
        thisHash,
        input.occurredOn,
        source,
        now,
        now,
      ],
    });

    // 4b. Sync the derived balance to `students` (core `postLedgerEntry`
    // step 4b parity). Scoped by tenant_id (defence-in-depth).
    const balanceUpdate = await tx.execute({
      sql: `UPDATE students SET balance_paise = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      args: [newBalance, now, input.studentId, input.tenantId],
    });
    if (balanceUpdate.rowsAffected === 0) {
      throw new Error(
        `STUDENT_NOT_FOUND: no student ${input.studentId} in tenant ${input.tenantId}`,
      );
    }

    // 4c. Rule 7 / BR-SYN-01 — outbox rows in the same transaction: the
    // ledger insert plus the derived student-balance update (dialect parity:
    // `postLedgerEntry` writes the identical pair). Payloads are the canonical
    // snake_case envelope (`encodeOutboxPayload` in `ledger.ts`, mirroring
    // `packages/shared/src/outboxPayload.ts` — P3-11).
    const encodedLedger = encodeOutboxPayload("ledger_entries", "insert", {
      id: entryId,
      tenant_id: input.tenantId,
      student_id: input.studentId,
      invoice_id: input.invoiceId ?? null,
      type: input.type,
      debit_paise: input.debitPaise,
      credit_paise: input.creditPaise,
      balance_after_paise: newBalance,
      description: input.description ?? null,
      void_of_id: input.voidOfId ?? null,
      prev_hash: prevHash,
      this_hash: thisHash,
      occurred_on: input.occurredOn,
      source,
      created_at: now,
      // DIALECT PARITY (AGENTS.md §3.5): the Prisma dialect (`ledger.ts`)
      // mirrors the INSERTED ROW (`{...newEntry}`), so its payload carries
      // `updated_at`; the gateway's writer does the same. This dialect built
      // an explicit field list and omitted it, so the two platforms emitted
      // DIFFERENT replication payloads for the SAME ledger row — and the
      // parity gate compares the outbox by `(table_name, op)` only, so it
      // never saw it.
      updated_at: now,
    });
    await tx.execute({
      sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at)
            VALUES (?, ?, 'ledger_entries', ?, 'insert', ?, ?)`,
      args: [randomUUID(), input.tenantId, entryId, encodedLedger.payload, now],
    });
    const encodedBalance = encodeOutboxPayload("students", "update", {
      id: input.studentId,
      balance_paise: newBalance,
      updated_at: now,
    });
    await tx.execute({
      sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at)
            VALUES (?, ?, 'students', ?, 'update', ?, ?)`,
      args: [
        randomUUID(),
        input.tenantId,
        input.studentId,
        encodedBalance.payload,
        now,
      ],
    });

    return { ok: true, value: entryId };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

/**
 * Fail-closed tenant-secret read (10_Security.md §10 / F1): an unprovisioned
 * tenant must never get a hash under an empty or missing key.
 * Throws — callers decide the transaction fate.
 */
export async function requireTenantSecretTx(
  tx: SqlExecutor,
  tenantId: string,
): Promise<string> {
  const res = await tx.execute({
    sql: `SELECT tenant_secret FROM settings WHERE tenant_id = ? LIMIT 1`,
    args: [tenantId],
  });
  const row = res.rows[0];
  if (!row) {
    throw new Error(`TENANT_SETTINGS_NOT_FOUND: no settings row for ${tenantId}`);
  }
  const secret = row.tenant_secret;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("SECURITY_VIOLATION: tenant secret is not initialised");
  }
  return secret;
}

// ---------------------------------------------------------------------------
// The void path — the libsql dialect.
//
// Implements: 12_Business_Rules.md BR-LED-04/05/09, BR-RPT-04;
// 14_Edge_Cases.md EC-F-05; 07_Fees_and_Payments.md §9.10; AGENTS.md §2 Rule 1
// (the ledger is INSERT-only), Rule 7 (outbox in the same transaction).
//
// The DECISION is `voidLedgerFlow` in `ledger.ts` — this file is only the
// statement set under it, the twin of the ORM dialect in the same file
// (AGENTS.md §3.5: one money flow, two I/O dialects). The statements here are
// the core's own audited set; `apps/gateway/lib/sql.ts` holds the gateway's,
// and neither file borrows from the other.
// ---------------------------------------------------------------------------

/** Rule 7 / BR-SYN-01 — one replication row per mutated row, same transaction. */
async function insertOutboxRow(
  tx: SqlExecutor,
  o: {
    tenantId: string;
    tableName: string;
    rowId: string;
    op: "insert" | "update";
    payload: string;
    now: string;
  },
): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), o.tenantId, o.tableName, o.rowId, o.op, o.payload, o.now],
  });
}

/** BR-SEC-03 — the audit row, written fail-closed inside the same transaction. */
async function insertAuditRow(
  tx: SqlExecutor,
  a: {
    tenantId: string;
    actor: string;
    action: string;
    refType: string;
    refId: string;
    metadata: string;
    now: string;
  },
): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      a.tenantId,
      a.actor,
      a.action,
      a.refType,
      a.refId,
      a.metadata,
      a.now,
    ],
  });
}

/**
 * The libsql dialect of the void port. Every statement is parameterised and
 * tenant-scoped; the ORM twin lives in `ledger.ts`.
 */
export function sqlVoidTx(tx: SqlExecutor): VoidTx {
  return {
    async findEntry(tenantId, entryId) {
      const res = await tx.execute({
        sql: `SELECT id, student_id, invoice_id, type, debit_paise, credit_paise
              FROM ledger_entries WHERE tenant_id = ? AND id = ? LIMIT 1`,
        args: [tenantId, entryId],
      });
      const row = res.rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        studentId: String(row.student_id),
        invoiceId: row.invoice_id === null || row.invoice_id === undefined ? null : String(row.invoice_id),
        type: String(row.type),
        debitPaise: Number(row.debit_paise),
        creditPaise: Number(row.credit_paise),
      };
    },

    async findReversal(tenantId, entryId) {
      const res = await tx.execute({
        sql: `SELECT id FROM ledger_entries
              WHERE tenant_id = ? AND type = 'VOID' AND void_of_id = ? LIMIT 1`,
        args: [tenantId, entryId],
      });
      const row = res.rows[0];
      return row ? { id: String(row.id) } : null;
    },

    // BR-RPT-04 [CRITICAL] + BR-LED-09: a credit counts only while it has NOT
    // been reversed, and "reversed" is a reverse lookup — the original row
    // carries no `reverses_entry_id`, so the reversal is the LATER row that
    // points back at it. `void_of_id IS NULL` on the row itself would keep
    // counting a voided original (AUD-001).
    async livePaymentCredits(tenantId, invoiceId) {
      const res = await tx.execute({
        sql: `SELECT COALESCE(SUM(e.credit_paise), 0) AS paid FROM ledger_entries e
              WHERE e.tenant_id = ? AND e.invoice_id = ? AND e.type = 'PAYMENT_RECEIVED'
                AND e.void_of_id IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM ledger_entries v
                  WHERE v.tenant_id = e.tenant_id AND v.void_of_id = e.id AND v.type = 'VOID'
                )`,
        args: [tenantId, invoiceId],
      });
      return Number(res.rows[0]?.paid ?? 0);
    },

    async liveCreditedForInvoice(tenantId, invoiceId) {
      const res = await tx.execute({
        sql: `SELECT COALESCE(SUM(e.credit_paise), 0) AS paid FROM ledger_entries e
              WHERE e.tenant_id = ? AND e.invoice_id = ?
                AND e.type != 'VOID' AND e.void_of_id IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM ledger_entries v
                  WHERE v.tenant_id = e.tenant_id AND v.void_of_id = e.id AND v.type = 'VOID'
                )`,
        args: [tenantId, invoiceId],
      });
      return Number(res.rows[0]?.paid ?? 0);
    },

    async invoiceTotal(tenantId, invoiceId) {
      const res = await tx.execute({
        sql: `SELECT total FROM invoices WHERE tenant_id = ? AND id = ? LIMIT 1`,
        args: [tenantId, invoiceId],
      });
      const row = res.rows[0];
      return row ? Number(row.total) : null;
    },

    async postVoid(entry) {
      const res = await postLedgerEntrySql(tx, {
        tenantId: entry.tenantId,
        studentId: entry.studentId,
        type: "VOID",
        debitPaise: entry.debitPaise,
        creditPaise: entry.creditPaise,
        description: entry.description,
        voidOfId: entry.voidOfId,
        invoiceId: entry.invoiceId,
        occurredOn: entry.occurredOn,
        source: "manual",
      });
      if (!res.ok) throw res.error;
      return res.value;
    },

    // EC-F-05 — the receipt is marked voided in the SAME transaction. It is
    // found by its canonical link (`receipts.ledger_entry_id`); the retired
    // denormalised `receipt_no` on the ledger row is not consulted.
    async voidReceipt(tenantId, ledgerEntryId, now) {
      const found = await tx.execute({
        sql: `SELECT id FROM receipts
              WHERE tenant_id = ? AND ledger_entry_id = ? AND voided_at IS NULL LIMIT 1`,
        args: [tenantId, ledgerEntryId],
      });
      const row = found.rows[0];
      if (!row) return null;
      const receiptId = String(row.id);
      const updated = await tx.execute({
        sql: `UPDATE receipts SET voided_at = ?, updated_at = ?
              WHERE tenant_id = ? AND id = ? AND voided_at IS NULL`,
        args: [now, now, tenantId, receiptId],
      });
      if (updated.rowsAffected === 0) return null;
      await insertOutboxRow(tx, {
        tenantId,
        tableName: "receipts",
        rowId: receiptId,
        op: "update",
        payload: encodeOutboxPayload("receipts", "update", {
          id: receiptId,
          tenant_id: tenantId,
          voided_at: now,
          updated_at: now,
        }).payload,
        now,
      });
      return receiptId;
    },

    async setInvoiceStatus(tenantId, invoiceId, status, now) {
      await tx.execute({
        sql: `UPDATE invoices SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
        args: [status, now, invoiceId, tenantId],
      });
      await insertOutboxRow(tx, {
        tenantId,
        tableName: "invoices",
        rowId: invoiceId,
        op: "update",
        payload: encodeOutboxPayload("invoices", "update", {
          id: invoiceId,
          status,
          updated_at: now,
        }).payload,
        now,
      });
    },

    async writeAudit(a) {
      await insertAuditRow(tx, a);
    },
  };
}

export interface VoidEntrySqlInput {
  tenantId: string;
  entryToVoidId: string;
  reason: string;
  occurredOn: string;
  actor: string;
}

/**
 * Void one ledger entry, libsql dialect.
 *
 * The same decision as `voidEntry` (ORM dialect): BR-LED-04's reversing row,
 * BR-LED-05's refusal to void a void, BR-LED-09's refusal to void a charge
 * that live payments credit, and EC-F-05's receipt-voided + invoice-revert
 * in the SAME transaction. Rule 7: the outbox rows for the receipt and the
 * invoice go out with them.
 *
 * Returns `Result<string>` (the reversing row's id) — a refusal is `Err`,
 * never a silent no-op (Rule 9).
 */
export async function voidEntrySql(
  db: SqlWriteClient,
  input: VoidEntrySqlInput,
): Promise<Result<string>> {
  const res = await withWriteTx(db, (tx) => voidLedgerFlow(sqlVoidTx(tx), input));
  return res.ok ? { ok: true, value: res.value } : { ok: false, error: res.error };
}
