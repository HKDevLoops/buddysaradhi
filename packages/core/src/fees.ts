// Implements: 07_Fees_and_Payments.md §9.6 (atomic payment recording — audit
// first, fail-closed; "all 8 steps succeed or none do"), §9.7 (atomic invoice
// number increment: `prefix + String(seq).padStart(6, '0')`), §9 "Generate"
// line 419 (increment `next_invoice_seq` → insert `invoices` row with
// `tamper_hash` → post `FEE_CHARGED` → write `audit_log` → `sync_outbox`);
// 12_Business_Rules.md BR-LED-03 (invoice numbers: monotonic, gap-tolerant,
// never reused — a voided invoice's number is never reused), BR-M-01 (integer
// paise), BR-SYN-01/02 (sync_outbox in the same transaction), BR-FEE-05;
// 10_Security.md §10 (tamper evidence keyed by `tenant_secret`);
// 14_Edge_Cases.md EC-05 (sequence race → atomic increment, one winner),
// EC-19 (changing `invoice_prefix` mid-stream does not reset the sequence);
// AGENTS.md §2 Rule 1 (ledger INSERT-only) + Rule 7 (outbox + audit_log with
// every mutation).
//
// Replaces the non-atomic web flow in `apps/web/src/server/actions/fees.ts`:
//   - overhaul-audit **F3**: `INV-${Math.floor(1000+Math.random()*9000)}` →
//     monotonic `settings.next_invoice_seq` (collision-prone randoms → unique
//     gap-tolerant numbers),
//   - overhaul-audit **F4**: one `client.execute` per statement, no
//     transaction → one libSQL write transaction for the whole flow
//     (`withWriteTx`, BEGIN IMMEDIATE),
//   - overhaul-audit **F5**: phantom `INSERT INTO students` for unknown ids →
//     typed `STUDENT_NOT_FOUND`, nothing written,
//   - overhaul-audit **F9**: partial payments attributed against
//     `invoices.total` instead of the outstanding amount → outstanding =
//     `total − Σ credits already applied` (the old flow re-applied the full
//     total on every payment and could drive the student balance negative),
//   - overhaul-audit **F1**: unverifiable HMAC+timestamp tamper hash → the
//     canonical formula from `apps/web/src/lib/ledger/tamper-check.ts` §10.
//
// Spec note (reported, spec not edited): 07 §9.9 says "libSQL prepared
// statements" while AGENTS.md §3.4 says "Prisma ORM only" for runtime DB
// access. 07 is the screen-specific spec for this surface and the handle here
// IS the libSQL client from `getAuthenticatedDb()`, so this module speaks
// parameterised statements through the minimal `SqlExecutor` contract in
// `ledgerSql.ts`. It executes NO DDL — schema authority stays with
// `prisma migrate` and `apps/gateway/lib/schema.ts` (AGENTS.md §3.4).
import { randomUUID } from "crypto";
import { nextCreatedAtIso, type Result } from "./ledger";
import { computeInvoiceTamperHash } from "./tamper";
import {
  paiseAdd,
  paiseSub,
} from "./money";
import {
  postLedgerEntrySql,
  requireTenantSecretTx,
  withWriteTx,
  type SqlExecutor,
  type SqlLedgerEntryInput,
  type SqlWriteClient,
} from "./ledgerSql";

// Re-exported so `@buddysaradhi/core`'s public surface keeps exposing the
// canonical formula (10_Security.md §10) from where it always was; the
// implementation now lives in `tamper.ts` because `apps/gateway/routes/
// ledger.ts` computes the same bytes for its own invoice rows.
export { computeInvoiceTamperHash };


// 07 §9.6 step 1 writes `actor: 'tutor'`, and migrations/0001_init.sql
// CHECKs `audit_log.actor IN ('tutor','system','sync')` — a UUID actor would
// abort the transaction (fail-closed) on a migration-built DB.
const ACTOR_TUTOR = "tutor";

/** BR-M-01: every amount crossing this boundary is a positive integer paise count. */
function assertPositivePaise(amountPaise: number): void {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error(
      `AMOUNT_INVALID: expected a positive integer paise amount, got ${String(amountPaise)}`,
    );
  }
}

/** F5: the student must exist — a ghost id is a typed error, never a phantom row. */
async function requireStudent(
  tx: SqlExecutor,
  tenantId: string,
  studentId: string,
): Promise<void> {
  const res = await tx.execute({
    sql: `SELECT id FROM students WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [studentId, tenantId],
  });
  if (res.rows.length === 0) {
    throw new Error(
      `STUDENT_NOT_FOUND: no student ${studentId} in tenant ${tenantId}`,
    );
  }
}

/**
 * 07 §9.7 — atomic `next_invoice_seq` increment + number build, inside the
 * caller's write transaction (BEGIN IMMEDIATE holds the settings row lock, so
 * EC-05's racer cannot read the same seq: one winner, the loser fails and
 * retries). The increment is rolled back with the transaction if any later
 * step fails, so a failed flow consumes no number (§9.6 principle: the
 * sequence is only consumed if everything else succeeded).
 * BR-LED-03 / §9.7 line 1023: `invoice_prefix + String(seq).padStart(6, '0')`.
 * EC-19: `invoice_prefix` is read fresh each call — a prefix change mid-stream
 * affects only new numbers; the sequence continues (never reset).
 */
async function nextInvoiceNumber(
  tx: SqlExecutor,
  tenantId: string,
  now: string,
): Promise<{ number: string; seq: number; prefix: string }> {
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
}

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
async function insertAudit(
  tx: SqlExecutor,
  a: {
    tenantId: string;
    action: string;
    refType: string;
    refId: string;
    metadata: string;
    createdAt: string;
  },
): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), a.tenantId, ACTOR_TUTOR, a.action, a.refType, a.refId, a.metadata, a.createdAt],
  });
}

/** Insert an `invoices` row (0001 columns) + its outbox row in one tx. */
async function insertInvoiceRow(
  tx: SqlExecutor,
  inv: {
    invoiceId: string;
    tenantId: string;
    studentId: string;
    number: string;
    issueDate: string;
    dueDate: string;
    totalPaise: number;
    status: "unpaid" | "paid";
    tamperHash: string;
    now: string;
  },
): Promise<void> {
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
    payload: JSON.stringify({
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
    }),
    createdAt: inv.now,
  });
}

/** §9.6 step 5 — status recompute result + outbox row for the update. */
async function updateInvoiceStatus(
  tx: SqlExecutor,
  invoiceId: string,
  status: "unpaid" | "partial" | "paid",
  now: string,
  tenantId: string,
): Promise<void> {
  await tx.execute({
    sql: `UPDATE invoices SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    args: [status, now, invoiceId, tenantId],
  });
  await insertOutbox(tx, {
    tenantId,
    tableName: "invoices",
    rowId: invoiceId,
    op: "update",
    payload: JSON.stringify({ id: invoiceId, status, updated_at: now }),
    createdAt: now,
  });
}

/**
 * Post one ledger row inside the open transaction. `postLedgerEntrySql`
 * returns `Result` (validation failures) OR throws (fatal) — either way the
 * caller inside a transaction MUST abort, so failures re-throw here. Mirrors
 * `voidEntry`'s `if (!res.ok) throw res.error` pattern in `ledger.ts`.
 */
async function mustPost(
  tx: SqlExecutor,
  input: SqlLedgerEntryInput,
): Promise<string> {
  const res = await postLedgerEntrySql(tx, input);
  if (!res.ok) throw res.error;
  return res.value;
}

// ---------------------------------------------------------------------------
// createInvoiceSql — 07 §9 line 419 "Generate", in ONE transaction.
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  tenantId: string;
  studentId: string;
  amountPaise: number;
  description: string;
  /** `YYYY-MM-DD` from the UI date field; also used as `due_date` (as before). */
  issueDate: string;
}

export interface CreateInvoiceResult {
  invoiceId: string;
  number: string;
  ledgerEntryId: string;
}

export async function createInvoiceSql(
  db: SqlWriteClient,
  input: CreateInvoiceInput,
): Promise<Result<CreateInvoiceResult>> {
  try {
    assertPositivePaise(input.amountPaise);
    const now = nextCreatedAtIso();
    return await withWriteTx(db, async (tx) => {
      await requireStudent(tx, input.tenantId, input.studentId); // F5
      const secret = await requireTenantSecretTx(tx, input.tenantId); // F1 fail-closed
      const { number, seq, prefix } = await nextInvoiceNumber(tx, input.tenantId, now); // F3
      const invoiceId = randomUUID();

      // Fail-closed audit (§9.6 step 1 principle): the audit row lands before
      // any money row — if this INSERT fails, nothing else happens.
      await insertAudit(tx, {
        tenantId: input.tenantId,
        action: "invoice.create",
        refType: "invoice",
        refId: invoiceId,
        metadata: JSON.stringify({
          number,
          student_id: input.studentId,
          amount_paise: input.amountPaise,
          issue_date: input.issueDate,
        }),
        createdAt: now,
      });

      const tamperHash = computeInvoiceTamperHash(
        {
          number,
          studentId: input.studentId,
          totalPaise: input.amountPaise,
          issueDate: input.issueDate,
        },
        secret,
      );
      await insertInvoiceRow(tx, {
        invoiceId,
        tenantId: input.tenantId,
        studentId: input.studentId,
        number,
        issueDate: input.issueDate,
        dueDate: input.issueDate,
        totalPaise: input.amountPaise,
        status: "unpaid",
        tamperHash,
        now,
      });

      // F2: posted through the shared core dialect (payload + hash identical
      // to `postLedgerEntry`), so `reconcileLedger` verifies these rows —
      // and linked to the invoice so §9.6 step 5 can sum credits per invoice.
      const ledgerEntryId = await mustPost(tx, {
        tenantId: input.tenantId,
        studentId: input.studentId,
        type: "FEE_CHARGED",
        debitPaise: input.amountPaise,
        creditPaise: 0,
        description: input.description,
        invoiceId,
        occurredOn: input.issueDate,
        source: "manual",
      });

      // Rule 7: `settings.next_invoice_seq` was mutated → queue it too.
      await insertOutbox(tx, {
        tenantId: input.tenantId,
        tableName: "settings",
        rowId: input.tenantId,
        op: "update",
        payload: JSON.stringify({
          tenant_id: input.tenantId,
          invoice_prefix: prefix,
          next_invoice_seq: seq,
          updated_at: now,
        }),
        createdAt: now,
      });

      return { invoiceId, number, ledgerEntryId };
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

// ---------------------------------------------------------------------------
// recordPaymentSql — 07 §9.6 atomic payment recording, in ONE transaction.
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  tenantId: string;
  studentId: string;
  amountPaise: number;
  description: string;
  /** `YYYY-MM-DD` from the UI; becomes `occurred_on` of every ledger row. */
  receivedOn: string;
}

export interface AppliedInvoice {
  invoiceId: string;
  number: string;
  paise: number;
  status: "unpaid" | "partial" | "paid";
}

export interface RecordPaymentResult {
  /** Ledger entry ids created, in posting order. */
  entryIds: string[];
  /** How the payment was attributed, invoice by invoice (F9). */
  applied: AppliedInvoice[];
  autoInvoiceId: string | null;
  autoInvoiceNumber: string | null;
  /** Invariant: === `input.amountPaise` — every paise is attributed somewhere. */
  creditedPaise: number;
}

export async function recordPaymentSql(
  db: SqlWriteClient,
  input: RecordPaymentInput,
): Promise<Result<RecordPaymentResult>> {
  try {
    assertPositivePaise(input.amountPaise);
    const now = nextCreatedAtIso();
    return await withWriteTx(db, async (tx) => {
      await requireStudent(tx, input.tenantId, input.studentId); // F5

      // §9.6 step 1 — audit FIRST, fail-closed (the "all 8 steps or none"
      // guarantee comes from the single write transaction). One row per tutor
      // action; the ledger rows below carry the per-invoice detail.
      await insertAudit(tx, {
        tenantId: input.tenantId,
        action: "payment_record",
        refType: "student",
        refId: input.studentId,
        metadata: JSON.stringify({
          amount_paise: input.amountPaise,
          description: input.description,
          received_on: input.receivedOn,
        }),
        createdAt: now,
      });

      // §9.6 step 5 inputs — open invoices, earliest due first (as before),
      // restricted to genuinely open statuses per §9.5 (`unpaid|partial|
      // overdue`) with `voided_at IS NULL` as the second gate.
      const openRes = await tx.execute({
        sql: `SELECT id, number, total, status FROM invoices
              WHERE tenant_id = ? AND student_id = ?
                AND status IN ('unpaid', 'partial', 'overdue')
                AND voided_at IS NULL
              ORDER BY due_date ASC`,
        args: [input.tenantId, input.studentId],
      });

      const entryIds: string[] = [];
      const applied: AppliedInvoice[] = [];
      let remaining = input.amountPaise;

      for (const row of openRes.rows) {
        if (remaining <= 0) break;
        const invoiceId = String(row.id);
        const total = Number(row.total);

        // F9: outstanding = total − Σ credits already attributed to THIS
        // invoice (VOID rows and reversal-linked rows excluded, per §9.6
        // step 5's `type != 'VOID' AND reversesEntryId: null` filter). The old
        // flow used `row.total` as the outstanding amount for every payment.
        const paidRes = await tx.execute({
          sql: `SELECT COALESCE(SUM(credit_paise), 0) AS paid FROM ledger_entries
                WHERE tenant_id = ? AND invoice_id = ?
                  AND type != 'VOID' AND void_of_id IS NULL`,
          args: [input.tenantId, invoiceId],
        });
        const alreadyPaid = Number(paidRes.rows[0]?.paid ?? 0);
        // Rule 6 / BR-M-01: `total` and the SUM() come straight out of SQLite
        // — paiseSub validates both are safe integers before the subtraction
        // instead of silently producing NaN/Infinity money.
        const outstanding = paiseSub(total, alreadyPaid);

        if (outstanding <= 0) {
          // Stale status: settled in the ledger already. Close it, consume
          // none of this payment.
          if (String(row.status) !== "paid") {
            await updateInvoiceStatus(tx, invoiceId, "paid", now, input.tenantId);
          }
          continue;
        }

        const paise = Math.min(remaining, outstanding);
        entryIds.push(
          await mustPost(tx, {
            tenantId: input.tenantId,
            studentId: input.studentId,
            type: "PAYMENT_RECEIVED",
            debitPaise: 0,
            creditPaise: paise,
            description: input.description,
            invoiceId,
            occurredOn: input.receivedOn,
            source: "manual",
          }),
        );

        // §9.6 step 5 status recompute: paid ≥ total → 'paid',
        // paid > 0 → 'partial', else 'unpaid'.
        const paidAfter = paiseAdd(alreadyPaid, paise);
        const status: AppliedInvoice["status"] =
          paidAfter >= total ? "paid" : paidAfter > 0 ? "partial" : "unpaid";
        await updateInvoiceStatus(tx, invoiceId, status, now, input.tenantId);
        applied.push({ invoiceId, number: String(row.number), paise, status });
        remaining = paiseSub(remaining, paise);
      }

      // Remainder (or no open invoices): auto-invoice the unmatched paise,
      // paid by this same payment — FEE_CHARGED debit + PAYMENT_RECEIVED
      // credit both linked to it, so the books net to zero exactly as the old
      // flow did, but now with a monotonic number (F3) and no unattributed
      // remainder (F9).
      let autoInvoiceId: string | null = null;
      let autoInvoiceNumber: string | null = null;
      if (remaining > 0) {
        const secret = await requireTenantSecretTx(tx, input.tenantId); // F1
        const { number, seq, prefix } = await nextInvoiceNumber(tx, input.tenantId, now); // F3
        autoInvoiceId = randomUUID();
        autoInvoiceNumber = number;

        const tamperHash = computeInvoiceTamperHash(
          {
            number,
            studentId: input.studentId,
            totalPaise: remaining,
            issueDate: input.receivedOn,
          },
          secret,
        );
        await insertInvoiceRow(tx, {
          invoiceId: autoInvoiceId,
          tenantId: input.tenantId,
          studentId: input.studentId,
          number,
          issueDate: input.receivedOn,
          dueDate: input.receivedOn,
          totalPaise: remaining,
          status: "paid",
          tamperHash,
          now,
        });
        await insertOutbox(tx, {
          tenantId: input.tenantId,
          tableName: "settings",
          rowId: input.tenantId,
          op: "update",
          payload: JSON.stringify({
            tenant_id: input.tenantId,
            invoice_prefix: prefix,
            next_invoice_seq: seq,
            updated_at: now,
          }),
          createdAt: now,
        });

        entryIds.push(
          await mustPost(tx, {
            tenantId: input.tenantId,
            studentId: input.studentId,
            type: "FEE_CHARGED",
            debitPaise: remaining,
            creditPaise: 0,
            description: `Auto-invoice for payment: ${input.description}`,
            invoiceId: autoInvoiceId,
            occurredOn: input.receivedOn,
            source: "manual",
          }),
        );
        entryIds.push(
          await mustPost(tx, {
            tenantId: input.tenantId,
            studentId: input.studentId,
            type: "PAYMENT_RECEIVED",
            debitPaise: 0,
            creditPaise: remaining,
            description: input.description,
            invoiceId: autoInvoiceId,
            occurredOn: input.receivedOn,
            source: "manual",
          }),
        );
        applied.push({
          invoiceId: autoInvoiceId,
          number,
          paise: remaining,
          status: "paid",
        });
        remaining = 0;
      }

      // Fail-closed invariant (Rule 9): attribution must exactly cover the
      // payment — if it ever does not, abort the whole transaction.
      const creditedPaise = applied.reduce((sum, a) => paiseAdd(sum, a.paise), 0);
      if (creditedPaise !== input.amountPaise) {
        throw new Error(
          `PAYMENT_ATTRIBUTION_BUG: credited ${creditedPaise} of ${input.amountPaise} paise`,
        );
      }

      return {
        entryIds,
        applied,
        autoInvoiceId,
        autoInvoiceNumber,
        creditedPaise,
      };
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
