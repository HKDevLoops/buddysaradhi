// Implements: 07_Fees_and_Payments.md §9.6 (atomic payment recording — audit
// first, fail-closed; "all 8 steps succeed or none do"), §9.7 (atomic invoice
// number: `prefix + String(seq).padStart(6, '0')`), §9 line 419 (invoice
// generate: seq increment → `invoices` row with `tamper_hash` → post
// `FEE_CHARGED` → `audit_log` → `sync_outbox`); 12_Business_Rules.md BR-LED-03
// (monotonic, gap-tolerant, never-reused invoice numbers), BR-FEE-04/05,
// BR-M-01 (integer paise), BR-SYN-01/02 (outbox in the same transaction),
// BR-SEC-03 (audit rows); 10_Security.md §10 (tamper evidence keyed by
// `tenant_secret`); 14_Edge_Cases.md EC-F-02/EC-F-08 (overpayment → advance),
// EC-05 (sequence race → atomic increment, one winner); AGENTS.md §2 Rule 1
// (ledger INSERT-only), Rule 6 (paise), Rule 7 (outbox + audit).
//
// WHY THIS FILE EXISTS — the money logic is dialect-agnostic, the I/O is not.
// `fees.ts` (libsql dialect, used by the gateway) and `feesPrisma.ts` (ORM
// dialect, used by web) both used to carry their own COPY of this flow. Two
// copies of payment attribution is the exact class of bug the overhaul audit
// called out for the previous shadow ledger (reviews/overhaul-audit-report-
// 2026-09-26.md F2/F9: divergent hash construction, partial payments attributed
// against `invoices.total` instead of the outstanding amount). So the flow lives
// ONCE here, against a narrow port, and each dialect supplies only the ten
// I/O operations it can express in its own driver. A behaviour change to a
// payment therefore lands in one place and both paths change together.
//
// The port is intentionally tiny — every method is one row-level operation, so
// no dialect can smuggle in a second opinion about the money.

import { randomUUID } from "crypto";
import { paiseAdd, paiseSub } from "./money";
import { computeInvoiceTamperHash, computeReceiptTamperHash } from "./tamper";
import type { LedgerEntryType, Result } from "./ledger";

// ---------------------------------------------------------------------------
// Public input/output contracts (moved here from `fees.ts`, re-exported there
// so `@buddysaradhi/core/fees` consumers are unchanged).
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  tenantId: string;
  studentId: string;
  amountPaise: number;
  description: string;
  /** `YYYY-MM-DD` from the UI date field; also used as `due_date`. */
  issueDate: string;
}

export interface CreateInvoiceResult {
  invoiceId: string;
  number: string;
  ledgerEntryId: string;
}

export interface RecordPaymentInput {
  tenantId: string;
  studentId: string;
  amountPaise: number;
  description: string;
  /** `YYYY-MM-DD` from the UI; becomes `occurred_on` of every ledger row. */
  receivedOn: string;
  /**
   * 07 §7 `TypeChip` vocabulary, written to `receipts.payment_method`. Optional
   * so a caller that predates receipts keeps compiling; the flow defaults it to
   * `"manual"` rather than inventing a method the tutor never chose.
   */
  method?: string;
  /**
   * 07 §6.4 as AMENDED: the payment reference is OPTIONAL for every method —
   * cash genuinely has none. Malformed values are rejected upstream in
   * `packages/shared`; this layer stores whatever it is handed, verbatim.
   */
  reference?: string;
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
  /** How the payment was attributed, invoice by invoice. */
  applied: AppliedInvoice[];
  autoInvoiceId: string | null;
  autoInvoiceNumber: string | null;
  /**
   * The receipt issued for this payment — 07 §9.6 step 4/7, BR-RC-01. This used
   * to be absent from the port entirely: a web-recorded payment created NO
   * receipt and never consumed `next_receipt_seq`, so a tutor who paid five
   * times on web held zero receipts and the first gateway payment inherited
   * `RCP-000001` for what was really the sixth. Present now because the flow
   * cannot honour §9.6 without it.
   */
  receiptId: string;
  receiptNo: string;
  /** Invariant: === `input.amountPaise` — every paise is attributed somewhere. */
  creditedPaise: number;
}

export type InvoiceStatus = "unpaid" | "partial" | "paid";

export interface OpenInvoice {
  id: string;
  number: string;
  /** Total in paise, straight from the row. */
  total: number;
  status: string;
}

export interface InvoiceInsert {
  invoiceId: string;
  tenantId: string;
  studentId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  totalPaise: number;
  status: InvoiceStatus;
  tamperHash: string;
  now: string;
}

export interface EntryInput {
  tenantId: string;
  studentId: string;
  type: LedgerEntryType;
  debitPaise: number;
  creditPaise: number;
  description: string;
  invoiceId: string;
  occurredOn: string;
}

/**
 * The receipt row 07 §9.6 step 4 writes, plus its `sync_outbox` replication
 * row. `invoiceId` is nullable (a pure advance has no invoice to attribute
 * against); `paymentRef` is an OPTIONAL string for every method since the
 * amended §6.4 — an empty string is a legal value, not a missing one.
 */
export interface ReceiptInsert {
  receiptId: string;
  tenantId: string;
  number: string;
  ledgerEntryId: string;
  studentId: string;
  invoiceId: string | null;
  amountPaise: number;
  paymentMethod: string;
  paymentRef: string;
  receivedOn: string;
  tamperHash: string;
  now: string;
}

export interface AuditArgs {
  tenantId: string;
  action: string;
  refType: string;
  refId: string;
  metadata: string;
  now: string;
}

/**
 * The ten I/O operations the fee flows need, inside ONE already-open write
 * transaction. Two adapters implement it — `fees.ts` (libsql statements) and
 * `feesPrisma.ts` (ORM model calls) — and both are exercised against the same
 * database by `feesDialectParity.test.ts`.
 */
export interface FeeTx {
  /** F5: the student must exist for this tenant, or nothing is written. */
  requireStudent(tenantId: string, studentId: string): Promise<void>;
  /** F1: fail-closed hash pepper (10_Security.md §10). */
  requireTenantSecret(tenantId: string): Promise<string>;
  /** §9.7: atomic sequence consumption + number build (EC-05). */
  takeInvoiceNumber(
    tenantId: string,
    now: string,
  ): Promise<{ number: string; seq: number; prefix: string }>;
  /**
   * 07 §9.6 step 7 + 12 BR-RC-01: the receipt number is
   * `receipt_prefix + zero-pad(next_receipt_seq, 6)`, consumed by ATOMIC
   * increment and NEVER decremented — a void leaves a gap by design, because
   * the gap is the audit trail. Same fail-closed shape as the invoice take: no
   * settings row, no number, no payment.
   */
  takeReceiptNumber(
    tenantId: string,
    now: string,
  ): Promise<{ number: string; seq: number; prefix: string }>;
  /** Receipt row + its `sync_outbox` replication row (Rule 7). */
  insertReceipt(row: ReceiptInsert): Promise<void>;
  /** Invoice row + its `sync_outbox` replication row (Rule 7). */
  insertInvoice(row: InvoiceInsert): Promise<void>;
  /** §9.6 step 5: status recompute + its outbox row. */
  setInvoiceStatus(args: {
    tenantId: string;
    invoiceId: string;
    status: InvoiceStatus;
    now: string;
  }): Promise<void>;
  /** §9.6 step 5 inputs: genuinely open, earliest due first. */
  openInvoices(tenantId: string, studentId: string): Promise<OpenInvoice[]>;
  /** Σ credits already attributed to THIS invoice (voids excluded). */
  creditedForInvoice(tenantId: string, invoiceId: string): Promise<number>;
  /** Append one ledger row (+ outbox + balance sync). Rule 1: INSERT only. */
  postEntry(input: EntryInput): Promise<string>;
  /** §9.6 step 1: one audit row per tutor action, written fail-closed. */
  writeAudit(args: AuditArgs): Promise<void>;
  /** `settings.next_*_seq` was mutated → queue it (Rule 7). */
  writeSettingsOutbox(args: {
    tenantId: string;
    prefix: string;
    seq: number;
    now: string;
  }): Promise<void>;
}

// 07 §9.6 step 1 writes `actor: 'tutor'`, and migrations/0001_init.sql CHECKs
// `audit_log.actor IN ('tutor','system','sync')` — a UUID actor would abort the
// transaction (fail-closed) on a migration-built DB.
const ACTOR_TUTOR = "tutor";

/** BR-M-01: every amount crossing this boundary is a positive integer paise count. */
export function assertPositivePaise(amountPaise: number): void {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error(
      `AMOUNT_INVALID: expected a positive integer paise amount, got ${String(amountPaise)}`,
    );
  }
}

function auditMetadata(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

// ---------------------------------------------------------------------------
// createInvoiceFlow — 07 §9 line 419, audit-first, all-or-nothing.
// ---------------------------------------------------------------------------

export async function createInvoiceFlow(
  tx: FeeTx,
  input: CreateInvoiceInput,
  now: string,
): Promise<CreateInvoiceResult> {
  assertPositivePaise(input.amountPaise);
  await tx.requireStudent(input.tenantId, input.studentId); // F5
  const secret = await tx.requireTenantSecret(input.tenantId); // F1 fail-closed
  const { number, seq, prefix } = await tx.takeInvoiceNumber(input.tenantId, now); // F3
  const invoiceId = randomUUID();

  // Fail-closed audit (§9.6 step 1 principle): the audit row lands before any
  // money row — if this write fails, nothing else happens.
  await tx.writeAudit({
    tenantId: input.tenantId,
    action: "invoice.create",
    refType: "invoice",
    refId: invoiceId,
    metadata: auditMetadata({
      number,
      student_id: input.studentId,
      amount_paise: input.amountPaise,
      issue_date: input.issueDate,
    }),
    now,
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
  await tx.insertInvoice({
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

  // Posted through the shared ledger dialect so the row is hash-chained
  // identically to every other writer and `reconcileLedger` verifies it — and
  // linked to the invoice so §9.6 step 5 can sum credits per invoice.
  const ledgerEntryId = await tx.postEntry({
    tenantId: input.tenantId,
    studentId: input.studentId,
    type: "FEE_CHARGED",
    debitPaise: input.amountPaise,
    creditPaise: 0,
    description: input.description,
    invoiceId,
    occurredOn: input.issueDate,
  });

  // Rule 7: `settings.next_invoice_seq` was mutated → queue it too.
  await tx.writeSettingsOutbox({
    tenantId: input.tenantId,
    prefix,
    seq,
    now,
  });

  return { invoiceId, number, ledgerEntryId };
}

// ---------------------------------------------------------------------------
// recordPaymentFlow — 07 §9.6, atomic payment, audit-first, every paise
// attributed (F9) and the remainder auto-invoiced under a monotonic number.
// ---------------------------------------------------------------------------

export async function recordPaymentFlow(
  tx: FeeTx,
  input: RecordPaymentInput,
  now: string,
): Promise<RecordPaymentResult> {
  assertPositivePaise(input.amountPaise);
  await tx.requireStudent(input.tenantId, input.studentId); // F5

  // §9.6 step 1 — audit FIRST, fail-closed (the "all 8 steps or none" guarantee
  // comes from the single write transaction the adapter opened). One row per
  // tutor action; the ledger rows below carry the per-invoice detail.
  await tx.writeAudit({
    tenantId: input.tenantId,
    action: "payment_record",
    refType: "student",
    refId: input.studentId,
    metadata: auditMetadata({
      amount_paise: input.amountPaise,
      description: input.description,
      received_on: input.receivedOn,
    }),
    now,
  });

  // §9.6 step 3 — the receipt number, consumed BEFORE any ledger row posts.
  //
  // Ordering is the whole point of this step. The number comes from
  // `settings.next_receipt_seq` by atomic increment (BR-RC-01, never
  // decremented), and because the adapter has one write transaction open, a
  // throw anywhere below rolls the increment back with everything else — so a
  // crash can leave neither a payment with no receipt nor a receipt with no
  // payment. Taking it up front (rather than after the ledger rows) is what
  // makes the "all 8 steps or none" guarantee hold for the SEQUENCE as well as
  // the rows.
  const receiptSecret = await tx.requireTenantSecret(input.tenantId); // F1
  const receiptSeq = await tx.takeReceiptNumber(input.tenantId, now);
  const receiptId = randomUUID();
  const receiptNo = receiptSeq.number;
  const receiptTamperHash = computeReceiptTamperHash(
    {
      number: receiptNo,
      studentId: input.studentId,
      amountPaise: input.amountPaise,
      receivedOn: input.receivedOn,
    },
    receiptSecret,
  );
  let receiptWritten = false;
  // §9.6 step 4: `receipts.ledger_entry_id` is NOT NULL, so the row lands right
  // after the FIRST ledger entry — still before any invoice UPDATE, still
  // inside the one transaction. `invoiceId` names the invoice the payment
  // principally settled, or null for a pure advance.
  const writeReceiptFor = async (ledgerEntryId: string, invoiceId: string | null) => {
    if (receiptWritten) return;
    receiptWritten = true;
    await tx.insertReceipt({
      receiptId,
      tenantId: input.tenantId,
      number: receiptNo,
      ledgerEntryId,
      studentId: input.studentId,
      invoiceId,
      amountPaise: input.amountPaise,
      paymentMethod: input.method ?? "manual",
      paymentRef: input.reference ?? "",
      receivedOn: input.receivedOn,
      tamperHash: receiptTamperHash,
      now,
    });
    await tx.writeSettingsOutbox({
      tenantId: input.tenantId,
      prefix: receiptSeq.prefix,
      seq: receiptSeq.seq,
      now,
    });
  };

  // §9.6 step 5 inputs — open invoices, earliest due first, restricted to
  // genuinely open statuses per §9.5 (`unpaid|partial|overdue`) with
  // `voided_at IS NULL` as the second gate.
  const open = await tx.openInvoices(input.tenantId, input.studentId);

  const entryIds: string[] = [];
  const applied: AppliedInvoice[] = [];
  let remaining = input.amountPaise;

  for (const invoice of open) {
    if (remaining <= 0) break;
    // F9: outstanding = total − Σ credits already attributed to THIS invoice
    // (VOID rows and reversal-linked rows excluded, per §9.6 step 5's
    // `type != 'VOID' AND void_of_id IS NULL` filter).
    const alreadyPaid = await tx.creditedForInvoice(input.tenantId, invoice.id);
    // Rule 6 / BR-M-01: `total` and the sum come straight out of SQLite, so
    // paiseSub validates both are safe integers instead of silently producing
    // NaN/Infinity money (EC-F-01).
    const outstanding = paiseSub(invoice.total, alreadyPaid);

    if (outstanding <= 0) {
      // Stale status: settled in the ledger already. Close it, consume none.
      if (invoice.status !== "paid") {
        await tx.setInvoiceStatus({
          tenantId: input.tenantId,
          invoiceId: invoice.id,
          status: "paid",
          now,
        });
      }
      continue;
    }

    const paise = Math.min(remaining, outstanding);
    const entryId = await tx.postEntry({
      tenantId: input.tenantId,
      studentId: input.studentId,
      type: "PAYMENT_RECEIVED",
      debitPaise: 0,
      creditPaise: paise,
      description: input.description,
      invoiceId: invoice.id,
      occurredOn: input.receivedOn,
    });
    entryIds.push(entryId);
    await writeReceiptFor(entryId, invoice.id);

    // §9.6 step 5 status recompute: paid ≥ total → 'paid', paid > 0 → 'partial'.
    const paidAfter = paiseAdd(alreadyPaid, paise);
    const status: InvoiceStatus =
      paidAfter >= invoice.total ? "paid" : paidAfter > 0 ? "partial" : "unpaid";
    await tx.setInvoiceStatus({
      tenantId: input.tenantId,
      invoiceId: invoice.id,
      status,
      now,
    });
    applied.push({ invoiceId: invoice.id, number: invoice.number, paise, status });
    remaining = paiseSub(remaining, paise);
  }

  // Remainder (or no open invoices): auto-invoice the unmatched paise, paid by
  // this same payment — FEE_CHARGED debit + PAYMENT_RECEIVED credit both linked
  // to it, so the books net to zero exactly, under a monotonic number (F3) and
  // with no unattributed remainder (F9).
  let autoInvoiceId: string | null = null;
  let autoInvoiceNumber: string | null = null;
  if (remaining > 0) {
    const secret = await tx.requireTenantSecret(input.tenantId); // F1
    const { number, seq, prefix } = await tx.takeInvoiceNumber(input.tenantId, now); // F3
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
    await tx.insertInvoice({
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
    await tx.writeSettingsOutbox({
      tenantId: input.tenantId,
      prefix,
      seq,
      now,
    });

    const autoChargeEntryId = await tx.postEntry({
      tenantId: input.tenantId,
      studentId: input.studentId,
      type: "FEE_CHARGED",
      debitPaise: remaining,
      creditPaise: 0,
      description: `Auto-invoice for payment: ${input.description}`,
      invoiceId: autoInvoiceId,
      occurredOn: input.receivedOn,
    });
    entryIds.push(autoChargeEntryId);
    // A pure advance (no open invoice) lands its receipt against the
    // auto-invoice's FEE_CHARGED row — §9.6 still gets a receipt for every
    // payment, and the row is inside the same transaction.
    await writeReceiptFor(autoChargeEntryId, autoInvoiceId);
    entryIds.push(
      await tx.postEntry({
        tenantId: input.tenantId,
        studentId: input.studentId,
        type: "PAYMENT_RECEIVED",
        debitPaise: 0,
        creditPaise: remaining,
        description: input.description,
        invoiceId: autoInvoiceId,
        occurredOn: input.receivedOn,
      }),
    );
    applied.push({ invoiceId: autoInvoiceId, number, paise: remaining, status: "paid" });
    remaining = 0;
  }

  // Fail-closed invariant (Rule 9): attribution must exactly cover the payment
  // — if it ever does not, the adapter's transaction rolls back. The receipt is
  // part of that same guarantee: an amount can never post without one, because
  // the two writes share a transaction and the sequence increment is rolled
  // back with them.
  const creditedPaise = applied.reduce((sum, a) => paiseAdd(sum, a.paise), 0);
  if (creditedPaise !== input.amountPaise) {
    throw new Error(
      `PAYMENT_ATTRIBUTION_BUG: credited ${creditedPaise} of ${input.amountPaise} paise`,
    );
  }
  if (!receiptWritten) {
    // Unreachable while `assertPositivePaise` holds (a zero/negative amount
    // throws before the sequence is touched), but the check is the difference
    // between "a payment without a receipt" and a loud typed error.
    throw new Error(`RECEIPT_MISSING: no receipt written for ${receiptNo}`);
  }

  return {
    entryIds,
    applied,
    autoInvoiceId,
    autoInvoiceNumber,
    receiptId,
    receiptNo,
    creditedPaise,
  };
}

/** The audit actor both dialects write (07 §9.6 step 1). */
export const FEE_AUDIT_ACTOR = ACTOR_TUTOR;

/** Re-exported so adapters do not each import `Result` from two places. */
export type FeeResult<T> = Result<T>;
