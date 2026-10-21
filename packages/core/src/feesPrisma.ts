// Implements: 07_Fees_and_Payments.md §9.6 / §9.7 / §9 line 419 (citations in
// `feesFlow.ts`); 12_Business_Rules.md BR-LED-03, BR-M-01, BR-SYN-01/02;
// AGENTS.md §2 Rule 1 / Rule 6 / Rule 7 and §3.4 (ORM methods only — no raw
// SQL in this file, and no DDL ever).
//
// This is the **ORM dialect** of the invoice/payment flows: the same
// `createInvoiceFlow` / `recordPaymentFlow` in `feesFlow.ts`, with the ten
// port operations expressed as ORM model calls instead of statements. It exists
// so `apps/web` can record a payment without ever holding a raw libSQL client —
// the ORM-ONLY law (AGENTS.md §3.4) had one last exception here because the
// only implementation lived in the libsql dialect.
//
// The tx is typed STRUCTURALLY (`OrmTx`), not as the generated
// `Prisma.TransactionClient`, for the same reason `ledgerSql.ts` duck-types
// `@libsql/client`: the repo has three implementations of the Prisma model
// surface (the generated client, `apps/web/src/lib/libsql-proxy.ts`, and the
// gateway's `createPrismaOrm`), and coupling `packages/core` to one of them
// would either break the other two or drag `@prisma/client` into a package that
// only needs it for types. Structural typing keeps the three upgrade clocks
// decoupled — and lets `apps/web` keep its sanctioned ORM shim.
//
// Row values come back as `unknown` and are narrowed here with explicit
// coercion; money is validated by `paiseSub`/`paiseAdd` inside the flow
// (EC-F-01), so a corrupt total can never become NaN money.
import { randomUUID } from "crypto";
import { encodeOutboxPayload, nextCreatedAtIso, postLedgerEntry, type Result } from "./ledger";
import { paiseAdd } from "./money";
import {
  createInvoiceFlow,
  recordPaymentFlow,
  FEE_AUDIT_ACTOR,
  type CreateInvoiceInput,
  type CreateInvoiceResult,
  type EntryInput,
  type FeeTx,
  type InvoiceInsert,
  type ReceiptInsert,
  type OpenInvoice,
  type RecordPaymentInput,
  type RecordPaymentResult,
} from "./feesFlow";

/** One ORM row as it comes back from any of the three implementations. */
type Row = Record<string, unknown>;

type RowArgs = { where?: Record<string, unknown> };
type DataArgs = { data: Record<string, unknown> };

/**
 * The subset of the Prisma model surface this dialect uses. Method shorthand
 * (not function properties) keeps parameter checking bivariant, which is what
 * lets the web shim's `LibsqlProxy` and the generated client both satisfy it.
 */
/**
 * The most bound parameters one statement may carry.
 *
 * SQLite's `SQLITE_MAX_VARIABLE_NUMBER` is 32,766 on modern builds but only
 * 999 on older ones, and exceeding it is a hard error ("too many SQL
 * variables"), not a truncation. 500 sits comfortably inside both ceilings, so
 * a chunked `IN (...)` list works on every SQLite the product can meet.
 */
export const MAX_SQL_VARIABLES_PER_STATEMENT = 500;

/** Split a list into chunks of at most `size` entries. */
export function chunkIds(ids: string[], size: number = MAX_SQL_VARIABLES_PER_STATEMENT): string[][] {
  if (ids.length === 0) return [];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

export interface OrmTx {
  setting: {
    findFirst(args?: RowArgs): Promise<Row | null>;
    update(args: RowArgs & DataArgs): Promise<Row>;
  };
  student: {
    findFirst(args?: RowArgs): Promise<Row | null>;
  };
  invoice: {
    findMany(
      args: RowArgs & { orderBy?: Record<string, unknown>; take?: number },
    ): Promise<Row[]>;
    create(args: DataArgs): Promise<Row>;
    updateMany(args: RowArgs & DataArgs): Promise<{ count: number }>;
  };
  ledgerEntry: {
    aggregate(args: RowArgs & { _sum: Record<string, string> }): Promise<Row>;
    /**
     * AUD-001 (P0): `creditedForInvoice` needs the invoice's credits AND the
     * rows that reverse them, so it can exclude a credit whose id some later
     * row carries in `void_of_id`. `voidOfId: { in: [...] }` is the only
     * operator beyond plain equality this needs — both ORM surfaces (the web
     * shim and the gateway's `createPrismaOrm`) support it.
     */
    findMany(args: RowArgs): Promise<Row[]>;
  };
  receipt: {
    create(args: DataArgs): Promise<Row>;
    /**
     * BR-RC-01 (never recycled): the receipt-number take checks the
     * `receipts` table for the candidate before handing it back, exactly as
     * the libsql dialect checks `invoices`.
     */
    findMany(args: RowArgs & { take?: number }): Promise<Row[]>;
  };
  syncOutbox: {
    create(args: DataArgs): Promise<Row>;
  };
  auditLog: {
    create(args: DataArgs): Promise<Row>;
  };
}

/** A handle that can open a write transaction and hand back an `OrmTx`. */
export interface OrmWriteClient {
  $transaction<T>(fn: (tx: OrmTx) => Promise<T>): Promise<T>;
}

function str(row: Row | null | undefined, key: string): string {
  const value = row?.[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function num(row: Row | null | undefined, key: string): number {
  const value = row?.[key];
  if (value === null || value === undefined) return 0;
  return Number(value);
}

/** Rule 7 / BR-SYN-01 — one replication row per mutated row, same transaction. */
async function writeOutbox(
  tx: OrmTx,
  o: {
    tenantId: string;
    tableName: string;
    rowId: string;
    op: "insert" | "update";
    payload: string;
    createdAt: string;
  },
): Promise<void> {
  await tx.syncOutbox.create({
    data: {
      id: randomUUID(),
      tenantId: o.tenantId,
      tableName: o.tableName,
      rowId: o.rowId,
      op: o.op,
      payload: o.payload,
      createdAt: o.createdAt,
    },
  });
}

/**
 * 07 §9.6 step 4 — the receipt row plus its `sync_outbox` replication row
 * (Rule 7), byte-identical to the libsql dialect's `insertReceiptRow` so
 * `feesDialectParity.test.ts` can hold them to the same books. `voidedAt`,
 * `pdfBlobKey` and `deletedAt` are left undefined (NULL): a receipt is born
 * live and the void path is the only writer allowed to ever set `voidedAt`.
 */
async function insertReceiptRow(tx: OrmTx, r: ReceiptInsert): Promise<void> {
  await tx.receipt.create({
    data: {
      id: r.receiptId,
      tenantId: r.tenantId,
      number: r.number,
      ledgerEntryId: r.ledgerEntryId,
      studentId: r.studentId,
      invoiceId: r.invoiceId,
      amount: r.amountPaise,
      paymentMethod: r.paymentMethod,
      paymentRef: r.paymentRef,
      receivedOn: r.receivedOn,
      tamperHash: r.tamperHash,
      createdAt: r.now,
      updatedAt: r.now,
    },
  });
  await writeOutbox(tx, {
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

async function insertInvoiceRow(tx: OrmTx, inv: InvoiceInsert): Promise<void> {
  await tx.invoice.create({
    data: {
      id: inv.invoiceId,
      tenantId: inv.tenantId,
      number: inv.number,
      studentId: inv.studentId,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      subtotal: inv.subtotalPaise,
      discount: inv.discountPaise,
      extraCharges: 0,
      total: inv.totalPaise,
      status: inv.status,
      tamperHash: inv.tamperHash,
      createdAt: inv.now,
      updatedAt: inv.now,
    },
  });
  await writeOutbox(tx, {
    tenantId: inv.tenantId,
    tableName: "invoices",
    rowId: inv.invoiceId,
    op: "insert",
    // Canonical snake_case envelope (P3-11 — identical to the libsql dialect).
    payload: encodeOutboxPayload("invoices", "insert", {
      id: inv.invoiceId,
      tenant_id: inv.tenantId,
      number: inv.number,
      student_id: inv.studentId,
      issue_date: inv.issueDate,
      due_date: inv.dueDate,
      subtotal: inv.subtotalPaise,
      discount: inv.discountPaise,
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
 * The ORM implementation of the fee-flow port. Same ten operations, same
 * order, same payloads as `sqlFeeTx` in `fees.ts` — only the transport differs.
 */
export function ormFeeTx(tx: OrmTx): FeeTx {
  return {
    async requireStudent(tenantId, studentId) {
      // F5: a ghost id is a typed error, nothing is written.
      const row = await tx.student.findFirst({ where: { tenantId, id: studentId } });
      if (!row) {
        throw new Error(`STUDENT_NOT_FOUND: no student ${studentId} in tenant ${tenantId}`);
      }
    },

    async requireTenantSecret(tenantId) {
      // F1: fail-closed hash pepper (10_Security.md §10).
      const row = await tx.setting.findFirst({ where: { tenantId } });
      if (!row) {
        throw new Error(`TENANT_SETTINGS_NOT_FOUND: no settings row for ${tenantId}`);
      }
      const secret = row.tenantSecret;
      if (typeof secret !== "string" || secret.length === 0) {
        throw new Error("SECURITY_VIOLATION: tenant secret is not initialised");
      }
      return secret;
    },

    /**
     * §9.7 — the sequence is consumed IN THE DATABASE via the atomic
     * `{ increment }` operator, never read-modify-written in JS, so two
     * concurrent invoice generations cannot both read N and both write N+1
     * (BR-LED-03, EC-05).
     *
     * The value is then RE-READ with one indexed PK read rather than taken
     * from `update`'s return value: the generated Prisma client returns the
     * updated row, but the ORM shim returns the `data` payload it was given, so
     * reading the return value would silently produce a `NaN` sequence on one
     * of the two model surfaces. Re-reading is dialect-independent and matches
     * the libsql dialect's UPDATE-then-SELECT pair.
     */
    async takeInvoiceNumber(tenantId, now) {
      // BR-LED-03 / BR-RC-03 (never recycled): the candidate number is checked
      // against the `invoices` table before it is handed back, exactly as the
      // libsql dialect does. A counter that is behind the table would
      // otherwise hand out a LIVE number and the UNIQUE constraint would
      // abort the whole payment with the tutor's cash unrecorded.
      for (let attempt = 0; attempt < 100; attempt++) {
        await tx.setting.update({
          where: { tenantId },
          data: { nextInvoiceSeq: { increment: 1 }, updatedAt: now },
        });
        const row = await tx.setting.findFirst({ where: { tenantId } });
        if (!row) {
          throw new Error(`TENANT_SETTINGS_NOT_FOUND: no settings row for ${tenantId}`);
        }
        const prefix = str(row, "invoicePrefix") || str(row, "invoice_prefix");
        const nextSeq = num(row, "nextInvoiceSeq") || num(row, "next_invoice_seq");
        if (!Number.isSafeInteger(nextSeq) || nextSeq < 1) {
          throw new Error(
            `SEQUENCE_INVALID: next_invoice_seq is not a usable integer for ${tenantId} (BR-LED-03)`,
          );
        }
        const seq = nextSeq - 1;
        const number = `${prefix}${String(seq).padStart(6, "0")}`;
        const taken = await tx.invoice.findMany({
          where: { tenantId, number },
          take: 1,
        });
        if (taken.length === 0) {
          return { number, seq, nextSeq, prefix };
        }
      }
      throw new Error(
        `INVOICE_NUMBER_EXHAUSTED: 100 consecutive invoice numbers were already taken for ${tenantId} (BR-RC-03)`,
      );
    },

    insertInvoice(row) {
      return insertInvoiceRow(tx, row);
    },

    async takeReceiptNumber(tenantId, now) {
      // BR-RC-01: atomic `{increment}` so the sequence is consumed IN the
      // database (never read-modify-written in JS — AGENTS.md §3.6), and never
      // decremented afterwards. The candidate is checked against the
      // `receipts` table so a behind-counter never re-issues a LIVE receipt
      // number — the libsql dialect does the same.
      for (let attempt = 0; attempt < 100; attempt++) {
        await tx.setting.update({
          where: { tenantId },
          data: { nextReceiptSeq: { increment: 1 }, updatedAt: now },
        });
        const row = await tx.setting.findFirst({ where: { tenantId } });
        if (!row) {
          throw new Error(`TENANT_SETTINGS_NOT_FOUND: no settings row for ${tenantId}`);
        }
        const prefix = str(row, "receiptPrefix") || str(row, "receipt_prefix") || "RCP-";
        const nextSeq = num(row, "nextReceiptSeq") || num(row, "next_receipt_seq");
        if (!Number.isSafeInteger(nextSeq) || nextSeq < 1) {
          throw new Error(
            `SEQUENCE_INVALID: next_receipt_seq is not a usable integer for ${tenantId} (BR-LED-03)`,
          );
        }
        const seq = nextSeq - 1;
        const number = `${prefix}${String(seq).padStart(6, "0")}`;
        const taken = await tx.receipt.findMany({
          where: { tenantId, number },
          take: 1,
        });
        if (taken.length === 0) {
          return { number, seq, nextSeq, prefix };
        }
      }
      throw new Error(
        `RECEIPT_NUMBER_EXHAUSTED: 100 consecutive receipt numbers were already taken for ${tenantId} (BR-RC-01)`,
      );
    },

    insertReceipt(row) {
      return insertReceiptRow(tx, row);
    },

    async setInvoiceStatus({ tenantId, invoiceId, status, now }) {
      await tx.invoice.updateMany({
        where: { tenantId, id: invoiceId },
        data: { status, updatedAt: now },
      });
      await writeOutbox(tx, {
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
      const rows = await tx.invoice.findMany({
        where: {
          tenantId,
          studentId,
          // §9.5: only genuinely open statuses; `overdue` is a display state
          // over an unpaid invoice, so it is open too.
          status: { in: ["unpaid", "partial", "overdue"] },
          voidedAt: null,
        },
        orderBy: { dueDate: "asc" },
      });
      return rows.map((row) => ({
        id: str(row, "id"),
        number: str(row, "number"),
        total: num(row, "total"),
        status: str(row, "status"),
      }));
    },

    async creditedForInvoice(tenantId, invoiceId) {
      // AUD-001 (P0) — see the long note in `fees.ts` (the SQL dialect) for
      // why `voidOfId: null` is NOT the same as "has not been reversed".
      //
      // The ORM surface has no subquery, so the reverse lookup is done in two
      // steps: the invoice's candidate credits, then the VOID rows that point
      // back at them. A credit that appears in that reversal set does not
      // count.
      const credits = await tx.ledgerEntry.findMany({
        where: {
          tenantId,
          invoiceId,
          type: { not: "VOID" },
          voidOfId: null,
        },
      });

      const reversed = new Set<string>();
      const creditIds = credits
        .map((c) => (c.id === null || c.id === undefined ? "" : String(c.id)))
        .filter((id) => id.length > 0);
      // The `IN (...)` list is CHUNKED. SQLite's SQLITE_MAX_VARIABLE_NUMBER is
      // 32,766 on modern builds and 999 on older ones, and a statement with
      // more placeholders than the ceiling fails with "too many SQL variables"
      // — a 500, not a truncation. A pathological invoice (hundreds of
      // micro-payments) must not be able to take the whole payment path down.
      for (const chunk of chunkIds(creditIds, MAX_SQL_VARIABLES_PER_STATEMENT)) {
        const reversals = await tx.ledgerEntry.findMany({
          where: { tenantId, type: "VOID", voidOfId: { in: chunk } },
        });
        for (const r of reversals) {
          const target = r.voidOfId;
          if (target !== null && target !== undefined && String(target).length > 0) {
            reversed.add(String(target));
          }
        }
      }

      // Rule 6 / BR-M-01: every addend is a safe integer checked by
      // `paiseAdd`, so a corrupt credit can never become NaN money (EC-F-01).
      let sum = 0;
      for (const c of credits) {
        const id = c.id === null || c.id === undefined ? "" : String(c.id);
        if (id.length > 0 && reversed.has(id)) continue;
        const credit = c.creditPaise === null || c.creditPaise === undefined
          ? 0
          : Number(c.creditPaise);
        sum = paiseAdd(sum, credit);
      }
      return sum;
    },

    async postEntry(input: EntryInput) {
      return postEntryOrm(tx, input);
    },

    async writeAudit(a) {
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: a.tenantId,
          actor: FEE_AUDIT_ACTOR,
          action: a.action,
          refType: a.refType,
          refId: a.refId,
          metadata: a.metadata,
          createdAt: a.now,
        },
      });
    },

    writeSettingsOutbox({ tenantId, kind, prefix, seq, now }) {
      // BR-LED-03 / BR-RC-01 / BR-RC-03: the payload names the sequence it
      // actually mutated and carries the counter's NEXT value — never the
      // receipt's prefix/sequence in the invoice columns, never the consumed
      // value. Identical bytes to the libsql dialect.
      const columns =
        kind === "receipt"
          ? { receipt_prefix: prefix, next_receipt_seq: seq }
          : { invoice_prefix: prefix, next_invoice_seq: seq };
      return writeOutbox(tx, {
        tenantId,
        tableName: "settings",
        rowId: tenantId,
        op: "update",
        payload: encodeOutboxPayload("settings", "update", {
          tenant_id: tenantId,
          ...columns,
          updated_at: now,
        }).payload,
        createdAt: now,
      });
    },
  };
}

/**
 * Append one ledger row through the shared Prisma dialect
 * (`postLedgerEntry` in `ledger.ts`) so the hash chain, the derived
 * `students.balance_paise` sync and the two `sync_outbox` rows are identical
 * to every other Prisma writer. Rule 1: INSERT only.
 *
 * SAFETY: `postLedgerEntry`'s parameter is declared with the generated
 * Prisma client types, which `packages/core` cannot depend on structurally
 * without pinning one of the three model-surface implementations in this repo.
 * `OrmTx` provides every member it touches (`ledgerEntry.findFirst/create`,
 * `setting.findUnique`, `student.update`, `syncOutbox.create` — all present on
 * the web shim and the generated client alike), and it deliberately has no
 * `$transaction`, so the function's "already inside a transaction" branch is
 * the one that runs and no nested transaction is opened.
 */
async function postEntryOrm(tx: OrmTx, input: EntryInput): Promise<string> {
  const res = await postLedgerEntry(tx as never, {
    tenantId: input.tenantId,
    studentId: input.studentId,
    type: input.type,
    debitPaise: input.debitPaise,
    creditPaise: input.creditPaise,
    description: input.description,
    invoiceId: input.invoiceId,
    occurredOn: input.occurredOn,
    source: "manual",
  });
  if (!res.ok) throw res.error;
  return res.value;
}

export async function createInvoicePrisma(
  db: OrmWriteClient,
  input: CreateInvoiceInput,
): Promise<Result<CreateInvoiceResult>> {
  const now = nextCreatedAtIso();
  try {
    return {
      ok: true,
      value: await db.$transaction((tx) => createInvoiceFlow(ormFeeTx(tx), input, now)),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export async function recordPaymentPrisma(
  db: OrmWriteClient,
  input: RecordPaymentInput,
): Promise<Result<RecordPaymentResult>> {
  const now = nextCreatedAtIso();
  try {
    return {
      ok: true,
      value: await db.$transaction((tx) => recordPaymentFlow(ormFeeTx(tx), input, now)),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
