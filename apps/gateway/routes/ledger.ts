import type { RouteHandler } from "./students.ts";
import { ok, fail, failZod } from "../lib/errors.ts";
import { recordOutbox, recordAudit } from "./students.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { oneRow, run, type SqlHandle } from "../lib/sql.ts";
import {
  computeChainHash,
  ledgerEntryPayload,
  loadChainTip,
  loadTenantSecret,
  nextCreatedAtIso,
} from "../lib/ledger-chain.ts";
import { withWriteTransaction } from "../lib/tx.ts";
import { z } from "zod";
import { paiseAdd, paiseSub } from "../../../packages/shared/src/utils/format.ts";
import { encodeOutboxPayload } from "../../../packages/shared/src/outboxPayload.ts";
import { computeInvoiceTamperHash } from "../../../packages/core/src/tamper.ts";

// AGENTS.md §6.1 (Zod for all input validation) + Rule 6
// (12_Business_Rules.md BR-M-01 — integer paise, never float). Audit
// 2026-09-26 "Gateway ledger route — unvalidated money": "routes/ledger.ts:104-161:
// no Zod/integer/UUID validation — Number("12.99") float paise enters the ledger".
// Mirrors packages/shared/src/schemas/ledger.ts + student.ts — Zod is the
// repo-wide validation standard, so adding npm:zod to deno.json is consistency,
// not a new tech choice.
//
// The three POST paths below now also carry the S3 fixes this file was held
// back for (STOP-AND-ASK #2/#3, human-approved):
//   G2 — one write transaction per mutation; balance and chain head are read
//        from the SAME transaction that writes (BR-SYN-01, BR-LED-06).
//   G3 — receipt/invoice numbers come from settings.<x>_seq via a single
//        atomic UPSERT ... RETURNING (BR-LED-03, BR-RC-01, 07 §9.6/§9.7).
//   G4 — void mirrors BOTH directions, guards VOID-of-VOID and double-void,
//        and writes a reason into audit metadata (BR-LED-04/05, 07 §9.10).
//   G8 — the `Math.max(0, …)` clamp is gone: an overpayment is an advance
//        (EC-F-02, EC-F-08).
//   W5  — every row carries core's `computeHash` over core's payload with a
//        linked `prev_hash`, and a strictly monotonic `created_at` so
//        `reconcileLedger`'s `ORDER BY created_at ASC` walks the chain in link
//        order (BR-LED-06, 07 §9.6, audit F2 hash-dialect unification).
const uuidSchema = z.string().uuid("must be a UUID");
const paiseSchema = z
  .number({
    invalid_type_error:
      "amount must be a JSON number of integer paise (12_Business_Rules.md BR-M-01)",
  })
  .int(
    "amount must be whole paise — send 1299 for ₹12.99, not 12.99 (12_Business_Rules.md BR-M-01)",
  )
  .positive("amount must be greater than zero paise")
  .max(Number.MAX_SAFE_INTEGER, "amount exceeds the maximum safe paise value");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date YYYY-MM-DD");
const descriptionSchema = z.string().trim().max(500, "must be 500 characters or fewer");

// Client sends one of several historical key spellings; each route normalises
// to one canonical key before parsing.
const LedgerPaymentSchema = z.object({
  studentId: uuidSchema,
  amount: paiseSchema,
  method: z.string().trim().max(32).optional(),
  occurredOn: isoDateSchema.optional(),
  description: descriptionSchema.optional(),
});

const LedgerInvoiceSchema = z.object({
  studentId: uuidSchema,
  amount: paiseSchema,
  number: z.string().trim().min(1).max(64).optional(),
  issueDate: isoDateSchema.optional(),
  dueDate: isoDateSchema.nullable().optional(),
  occurredOn: isoDateSchema.optional(),
  description: descriptionSchema.optional(),
});

// BR-LED-04/05 + 07_Fees_and_Payments.md §9.10 — a void carries the reason
// that ends up in `audit_log.metadata` (the empty-metadata defect G4).
const LedgerVoidSchema = z.object({
  entryId: uuidSchema,
  reason: descriptionSchema.optional(),
});

/** Zero-pad a sequence to 6 digits — BR-LED-03 / 07 §9.7. */
function padSequence(seq: number): string {
  return String(seq).padStart(6, "0");
}

/**
 * Rule 9 (no silent failures): a rejection that has a defined HTTP status is
 * carried out of the write transaction as a typed error; anything else keeps
 * propagating and becomes a typed 500 upstream.
 */
class LedgerRouteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LedgerRouteError";
    this.status = status;
  }
}

function mapLedgerRouteError(err: unknown): Response {
  if (err instanceof LedgerRouteError) return fail(err.message, err.status);
  throw err;
}

/**
 * Consume one number from the per-tenant sequence and return the prefix to
 * build it with (12_Business_Rules.md BR-LED-03: `receipt_prefix +
 * zero-pad(next_receipt_seq, 6)`; 07_Fees_and_Payments.md §9.7).
 *
 * One statement does increment + RETURNING, so the number is taken atomically
 * inside the caller's write transaction — never read-then-write. The returned
 * value is the post-increment counter (§9.7: `seq = updated nextReceiptSeq -
 * 1`). Gaps are legal and expected (BR-RC-01); the counter is never
 * decremented.
 *
 * P2-3 / BR-SEC-03: the previous statement INSERTed a missing `settings` row,
 * minting a fresh `tenant_secret` for a tenant provisioning never created.
 * `settings` is provisioning state (17_API_Gateway_System.md §5.1,
 * web/03_Auth_and_Provisioning.md Step 7), so a missing row or an absent
 * secret is a typed fail-closed error — never a silently minted key that would
 * sign a hash chain nobody can verify again.
 */
async function takeSequence(
  tx: SqlHandle,
  tenantId: string,
  kind: "receipt" | "invoice",
): Promise<{ usedSeq: number; prefix: string; tenantSecret: string }> {
  const now = new Date().toISOString();
  const [seqCol, prefixCol, defaultPrefix] = kind === "receipt"
    ? ["next_receipt_seq", "receipt_prefix", "RCP-"]
    : ["next_invoice_seq", "invoice_prefix", "INV-"];

  // Same fail-closed helper the void path uses (10_Security.md §10): it throws
  // when the row is absent or `tenant_secret` is missing/empty, so the key is
  // validated BEFORE any sequence state is touched.
  let tenantSecret: string;
  try {
    tenantSecret = await loadTenantSecret(tx, tenantId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new LedgerRouteError(`tenant_settings_unavailable: ${reason}`, 500);
  }

  const row = await oneRow(
    tx,
    `UPDATE settings SET ${seqCol} = COALESCE(${seqCol}, 1) + 1, updated_at = ?
      WHERE tenant_id = ?
      RETURNING ${seqCol}, ${prefixCol}`,
    [now, tenantId],
  );
  if (!row) {
    // Rule 9 — `loadTenantSecret` above proved the row existed, so a missing
    // RETURNING row means it vanished mid-transaction (or the statement never
    // ran). Abort rather than invent a number.
    throw new LedgerRouteError(
      `could not consume ${kind} sequence for tenant ${tenantId}`,
      500,
    );
  }
  const rawPrefix = row[prefixCol];
  const prefix = typeof rawPrefix === "string" && rawPrefix.length > 0
    ? rawPrefix
    : defaultPrefix;
  const nextSeq = Number(row[seqCol]);
  // Rule 7 / BR-SYN-01 — `settings.next_<x>_seq` was just mutated, so the
  // sequence bump replays like every other write. Without this row a lost
  // bump resurfaces as a REUSED receipt/invoice number on the replica
  // (BR-RC-01 / BR-LED-03). Payload via the canonical shared codec
  // (`packages/shared/src/outboxPayload.ts` — P3-11).
  await recordOutbox(tx, tenantId, "settings", tenantId, "update", encodeOutboxPayload("settings", "update", {
    tenant_id: tenantId,
    [seqCol]: nextSeq,
    updated_at: now,
  }).payload);
  return {
    usedSeq: nextSeq - 1,
    prefix,
    tenantSecret,
  };
}

/**
 * Write the denormalised `students.balance_paise` cache from inside the same
 * transaction as the ledger entry (packages/core/src/ledger.ts:132 does the
 * same). A zero-row update means the student vanished mid-transaction — abort
 * rather than commit a ledger row with an unsynced cache (Rule 9).
 */
async function syncStudentBalance(
  tx: SqlHandle,
  tenantId: string,
  studentId: string,
  balancePaise: number,
): Promise<void> {
  const now = new Date().toISOString();
  const res = await run(
    tx,
    `UPDATE students SET balance_paise = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
    [balancePaise, now, tenantId, studentId],
  );
  if (!res.rowsAffected) {
    throw new Error(`student ${studentId} not found inside transaction`);
  }
  // Rule 7 / BR-SYN-01 — `students.balance_paise` was just UPDATEd above, so
  // it gets its own outbox row in the same transaction. The ledger insert is
  // NOT a substitute: a replica that received only the ledger row would show a
  // stale `balance_due` on Students/Attendance until its own recompute ran.
  // Payload via the canonical shared codec (P3-11).
  await recordOutbox(tx, tenantId, "students", studentId, "update", encodeOutboxPayload("students", "update", {
    id: studentId,
    tenant_id: tenantId,
    balance_paise: balancePaise,
    updated_at: now,
  }).payload);
}

export const handleLedger: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/ledger
  if (path === "/api/v1/ledger" && method === "GET") {
    const studentId = sp.get("studentId");
    const rows = await orm.ledgerEntry.findMany({
      where: studentId ? { studentId } : {},
      orderBy: { occurredOn: "desc" },
      take: 200,
    });

    return ok(
      rows.map((e) => ({
        id: e.id,
        tenant_id: tenantId,
        student_id: e.studentId,
        type: e.type,
        debit: e.debitPaise,
        credit: e.creditPaise,
        balance_after: e.balanceAfterPaise,
        method: e.paymentMethod,
        description: e.description,
        occurred_on: e.occurredOn,
        invoice_id: e.invoiceId,
        receipt_no: e.receiptNo,
        reverses_entry_id: e.voidOfId,
        this_hash: e.thisHash,
      })),
    );
  }

  // GET /api/v1/ledger/invoices
  if (path === "/api/v1/ledger/invoices" && method === "GET") {
    const studentId = sp.get("studentId");
    const invs = await orm.invoice.findMany({
      where: studentId ? { studentId } : {},
      take: 100,
    });

    const entries = await orm.ledgerEntry.findMany({
      where: { type: "PAYMENT_RECEIVED" },
      take: 200,
    });

    const paidMap = new Map<string, number>();
    for (const e of entries) {
      if (e.invoiceId) {
        paidMap.set(e.invoiceId, (paidMap.get(e.invoiceId) ?? 0) + (e.creditPaise ?? 0));
      }
    }

    const data = invs.map((inv) => ({
      id: inv.id,
      tenant_id: tenantId,
      number: inv.number,
      student_id: inv.studentId,
      issue_date: inv.issueDate,
      due_date: inv.dueDate,
      subtotal: inv.subtotal,
      total: inv.total,
      status: inv.status,
      paid_amount_minor: paidMap.get(inv.id) ?? 0,
    }));
    return ok(data);
  }

  // GET /api/v1/ledger/fees
  if (path === "/api/v1/ledger/fees" && method === "GET") {
    const search = (sp.get("search") ?? "").toLowerCase();
    const rawStudents = await orm.student.findMany({
      where: { status: "active", archivedAt: null },
      orderBy: { firstName: "asc" },
      take: 200,
    });

    const filtered = search
      ? rawStudents.filter(
          (s) =>
            (s.firstName && s.firstName.toLowerCase().includes(search)) ||
            (s.lastName && s.lastName.toLowerCase().includes(search)) ||
            (s.code && s.code.toLowerCase().includes(search)),
        )
      : rawStudents;

    return ok(
      filtered.map((s) => ({
        id: s.id,
        name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
        code: s.code,
        fee_model: s.feeModel || "postpaid",
        balance_due: s.balancePaise || 0,
      })),
    );
  }

  // POST /api/v1/ledger/payment
  if (path === "/api/v1/ledger/payment" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    // amountPaise is the contracts/openapi.yaml name; amount / amount_minor are
    // the historical spellings this route already accepted.
    const parsed = LedgerPaymentSchema.safeParse({
      studentId: body.studentId ?? body.student_id,
      amount: body.amountPaise ?? body.amount ?? body.amount_minor,
      method: body.method ?? body.payment_method,
      occurredOn: body.occurredOn ?? body.occurred_on,
      description: body.description,
    });
    if (!parsed.success) return failZod(parsed.error);
    const studentId = parsed.data.studentId;
    const credit = parsed.data.amount;
    const paymentMethod = parsed.data.method ?? "upi";
    const occurredOn =
      parsed.data.occurredOn ?? new Date().toISOString().slice(0, 10);
    const description = parsed.data.description ?? "Payment received";

    const stu = await orm.student.findFirst({ where: { id: studentId } });
    if (!stu) return fail("student_not_found", 404);

    try {
      const result = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);

        // G2 / BR-LED-06: the chain head is read in the transaction that
        // writes, so two concurrent payments can no longer both compute from
        // the same stale `students.balance_paise`.
        const tip = await loadChainTip(tx, tenantId, studentId);
        // G8 / EC-F-02, EC-F-08: an overpayment becomes an advance (negative
        // balance = "Advance: ₹X"), never silently clamped to zero.
        // Rule 6 / BR-M-01: `paiseSub` validates both operands as safe-integer
        // paise instead of letting a corrupt chain tip produce NaN money.
        const newBalance = paiseSub(tip.balanceAfterPaise, credit);

        const seq = await takeSequence(tx, tenantId, "receipt");
        const receiptNo = `${seq.prefix}${padSequence(seq.usedSeq)}`;

        const entryId = crypto.randomUUID();
        const createdAt = nextCreatedAtIso();
        const thisHash = computeChainHash(
          tip.prevHash,
          ledgerEntryPayload({
            id: entryId,
            studentId,
            type: "PAYMENT_RECEIVED",
            debitPaise: 0,
            creditPaise: credit,
            balanceAfterPaise: newBalance,
            occurredOn,
          }),
          createdAt,
          seq.tenantSecret,
        );

        const le = await txOrm.ledgerEntry.create({
          data: {
            id: entryId,
            studentId,
            type: "PAYMENT_RECEIVED",
            debitPaise: 0,
            creditPaise: credit,
            balanceAfterPaise: newBalance,
            description,
            receiptNo,
            paymentMethod,
            occurredOn,
            source: "gateway",
            prevHash: tip.prevHash,
            thisHash,
            createdAt,
          },
        });

        const rcpt = await txOrm.receipt.create({
          data: {
            number: receiptNo,
            ledgerEntryId: le.id,
            studentId,
            amount: credit,
            paymentMethod,
            receivedOn: occurredOn,
          },
        });

        await syncStudentBalance(tx, tenantId, studentId, newBalance);

        await recordOutbox(tx, tenantId, "ledger_entries", le.id, "create", encodeOutboxPayload("ledger_entries", "create", {
          type: "payment",
          receiptNo,
        }).payload);
        // Rule 7 / BR-SYN-01 — `receipts` is a distinct mutated table: without
        // its own outbox row the replica never learns the receipt exists, and
        // EC-F-05's voided flag would have nothing to attach to.
        await recordOutbox(tx, tenantId, "receipts", rcpt.id, "create", encodeOutboxPayload("receipts", "create", {
          id: rcpt.id,
          tenant_id: tenantId,
          receipt_no: receiptNo,
          ledger_entry_id: le.id,
          student_id: studentId,
          amount: credit,
          payment_method: paymentMethod,
          received_on: occurredOn,
          voided_at: null,
        }).payload);
        await recordAudit(tx, tenantId, tenantId, "ledger.payment", "student", studentId, {
          credit,
          receiptNo,
        });
        return { receiptNo, newBalance };
      });
      // Cache invalidation follows COMMIT (BR-SYN-01): a rolled-back
      // transaction left the rows untouched, so the cached GET is still
      // correct, while a committed one must never keep serving the
      // pre-mutation response.
      invalidateTenant(tenantId);
      return ok({ ok: true, receiptNo: result.receiptNo, newBalance: result.newBalance });
    } catch (err) {
      return mapLedgerRouteError(err);
    }
  }

  // POST /api/v1/ledger/invoice
  if (path === "/api/v1/ledger/invoice" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    // amountPaise is the contracts/openapi.yaml name; amount / amount_minor are
    // the historical spellings this route already accepted.
    const parsed = LedgerInvoiceSchema.safeParse({
      studentId: body.studentId ?? body.student_id,
      amount: body.amountPaise ?? body.amount ?? body.amount_minor,
      number: body.number,
      issueDate: body.issueDate ?? body.issue_date,
      dueDate: body.dueDate ?? body.due_date,
      occurredOn: body.occurredOn ?? body.occurred_on,
      description: body.description,
    });
    if (!parsed.success) return failZod(parsed.error);
    const studentId = parsed.data.studentId;
    const amount = parsed.data.amount;
    const description = parsed.data.description ?? "Fee charged";

    const stu = await orm.student.findFirst({ where: { id: studentId } });
    if (!stu) return fail("student_not_found", 404);

    try {
      const result = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);

        const tip = await loadChainTip(tx, tenantId, studentId);
        // Rule 6 / BR-M-01 — guarded paise addition (overflow is a typed
        // throw, never an `Infinity` balance).
        const newBalance = paiseAdd(tip.balanceAfterPaise, amount);

        // G3 / BR-LED-03: numbers come from `settings.next_invoice_seq`, one
        // atomic increment per invoice (07 §9.7). An explicit client `number`
        // still consumes a sequence so a later auto number can never collide
        // with it — the counter is never decremented (BR-RC-01).
        const seq = await takeSequence(tx, tenantId, "invoice");
        const invNo = parsed.data.number ?? `${seq.prefix}${padSequence(seq.usedSeq)}`;
        const issueDate = parsed.data.issueDate ?? new Date().toISOString().slice(0, 10);

        // 10_Security.md §10 / 11_Data_Model.md §4.12 — `tamper_hash` is NOT
        // NULL and must be the CANONICAL bytes the web verifier recomputes
        // (`apps/web/src/lib/ledger/tamper-check.ts:22`), so it is built from
        // the shared `computeInvoiceTamperHash`, not re-derived here. Writing
        // the invoice without it would make every gateway invoice read as
        // tampered the moment a tutor runs Diagnostics.
        const tamperHash = computeInvoiceTamperHash(
          { number: invNo, studentId, totalPaise: amount, issueDate },
          seq.tenantSecret,
        );

        const inv = await txOrm.invoice.create({
          data: {
            number: invNo,
            studentId,
            issueDate,
            dueDate: parsed.data.dueDate ?? null,
            subtotal: amount,
            total: amount,
            status: "unpaid",
            tamperHash,
          },
        });

        const entryId = crypto.randomUUID();
        const createdAt = nextCreatedAtIso();
        const occurredOn = parsed.data.occurredOn ?? createdAt.slice(0, 10);
        const thisHash = computeChainHash(
          tip.prevHash,
          ledgerEntryPayload({
            id: entryId,
            studentId,
            type: "FEE_CHARGED",
            debitPaise: amount,
            creditPaise: 0,
            balanceAfterPaise: newBalance,
            occurredOn,
          }),
          createdAt,
          seq.tenantSecret,
        );

        const le = await txOrm.ledgerEntry.create({
          data: {
            id: entryId,
            studentId,
            invoiceId: inv.id,
            type: "FEE_CHARGED",
            debitPaise: amount,
            creditPaise: 0,
            balanceAfterPaise: newBalance,
            description,
            occurredOn,
            source: "gateway",
            prevHash: tip.prevHash,
            thisHash,
            createdAt,
          },
        });

        await syncStudentBalance(tx, tenantId, studentId, newBalance);

        await recordOutbox(tx, tenantId, "ledger_entries", le.id, "create", encodeOutboxPayload("ledger_entries", "create", {
          type: "invoice",
          invoiceNo: invNo,
        }).payload);
        // Rule 7 / BR-SYN-01 — `invoices` is a distinct mutated table; its
        // outbox row carries the spec §4.12 columns (including the tamper
        // evidence) so the replica's Fees screen can render the invoice
        // without re-deriving it from the ledger.
        await recordOutbox(tx, tenantId, "invoices", inv.id, "create", encodeOutboxPayload("invoices", "create", {
          id: inv.id,
          tenant_id: tenantId,
          number: invNo,
          student_id: studentId,
          issue_date: issueDate,
          due_date: parsed.data.dueDate ?? null,
          subtotal: amount,
          discount: 0,
          extra_charges: 0,
          total: amount,
          status: "unpaid",
          tamper_hash: tamperHash,
        }).payload);
        await recordAudit(tx, tenantId, tenantId, "ledger.invoice", "student", studentId, {
          amount,
          invoiceNo: invNo,
        });
        return { invoiceId: inv.id, newBalance };
      });
      // Cache invalidation follows COMMIT — see the payment path.
      invalidateTenant(tenantId);
      return ok({ ok: true, invoiceId: result.invoiceId, newBalance: result.newBalance });
    } catch (err) {
      return mapLedgerRouteError(err);
    }
  }

  // POST /api/v1/ledger/void
  if (path === "/api/v1/ledger/void" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const parsed = LedgerVoidSchema.safeParse({
      entryId: body.entryId ?? body.entryIdToVoid,
      reason: body.reason,
    });
    if (!parsed.success) return failZod(parsed.error);
    const entryId = parsed.data.entryId;
    const reason = parsed.data.reason ?? "Voided via Gateway";

    try {
      const result = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);

        const entries = await txOrm.ledgerEntry.findMany({ where: { id: entryId } });
        const entry = entries[0];
        if (!entry) throw new LedgerRouteError("entry_not_found", 404);

        // BR-LED-05 — a VOID entry cannot itself be voided.
        if (entry.type === "VOID") {
          throw new LedgerRouteError("cannot_void_a_void_entry", 409);
        }
        // BR-LED-04 — double-void is a conflict, not a second reversing row.
        const prior = await txOrm.ledgerEntry.findMany({
          where: { voidOfId: entryId },
          take: 1,
        });
        if (prior.length > 0) {
          throw new LedgerRouteError("entry_already_voided", 409);
        }

        // 07 §9.10 step 1 — audit first: if the audit write fails the whole
        // transaction aborts (fail-closed, 10_Security.md §4). Metadata now
        // carries the reason (audit finding G4).
        await recordAudit(tx, tenantId, tenantId, "ledger.void", "ledger", entryId, {
          reason,
          original_type: entry.type,
        });

        const tip = await loadChainTip(tx, tenantId, entry.studentId);
        // BR-LED-04 — mirror BOTH directions (equal amount, opposite sign),
        // so voiding a FEE_CHARGED reverses the debit instead of posting a
        // net-zero row that reports success (audit finding G4).
        const debit = Number(entry.creditPaise ?? 0);
        const credit = Number(entry.debitPaise ?? 0);
        // Rule 6 / BR-M-01 — mirrored amounts are still money: guard the
        // arithmetic so a corrupt tip/debit/credit yields a typed throw
        // instead of NaN on the reversing row (which would break the chain).
        const newBalance = paiseSub(paiseAdd(tip.balanceAfterPaise, debit), credit);

        const tenantSecret = await loadTenantSecret(tx, tenantId);
        const voidEntryId = crypto.randomUUID();
        const createdAt = nextCreatedAtIso();
        // 07 §9.10: the reversing row is dated the day it is written.
        const occurredOn = createdAt.slice(0, 10);
        const thisHash = computeChainHash(
          tip.prevHash,
          ledgerEntryPayload({
            id: voidEntryId,
            studentId: entry.studentId,
            type: "VOID",
            debitPaise: debit,
            creditPaise: credit,
            balanceAfterPaise: newBalance,
            occurredOn,
          }),
          createdAt,
          tenantSecret,
        );

        // Enforces Rule 1 (Void is a new reversing ledger entry)
        const voidRow = await txOrm.ledgerEntry.create({
          data: {
            id: voidEntryId,
            studentId: entry.studentId,
            type: "VOID",
            debitPaise: debit,
            creditPaise: credit,
            balanceAfterPaise: newBalance,
            description: `VOID: ${reason}`,
            occurredOn,
            voidOfId: entryId,
            source: "gateway",
            prevHash: tip.prevHash,
            thisHash,
            createdAt,
          },
        });

        await syncStudentBalance(tx, tenantId, entry.studentId, newBalance);

        // EC-F-05 — mark the receipt voided in the same transaction. (The
        // invoice-status revert of §9.10 step 4 is deferred: gateway payments
        // carry no invoice link, so "which invoice to reopen" is undecidable
        // here — see the handoff notes.)
        if (entry.receiptNo) {
          const receipt = await oneRow(
            tx,
            `SELECT id FROM receipts WHERE tenant_id = ? AND receipt_no = ? AND voided_at IS NULL`,
            [tenantId, entry.receiptNo],
          );
          if (receipt) {
            await run(
              tx,
              `UPDATE receipts SET voided_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
              [createdAt, createdAt, tenantId, receipt.id],
            );
            // Rule 7 / BR-SYN-01 — the EC-F-05 `voided_at` UPDATE above must
            // replicate too, or a reconnected replica shows a receipt as live
            // that the ledger already reversed.
            await recordOutbox(tx, tenantId, "receipts", String(receipt.id), "update", encodeOutboxPayload("receipts", "update", {
              id: receipt.id,
              tenant_id: tenantId,
              receipt_no: entry.receiptNo,
              voided_at: createdAt,
              updated_at: createdAt,
            }).payload);
          }
        }

        await recordOutbox(tx, tenantId, "ledger_entries", voidRow.id, "create", encodeOutboxPayload("ledger_entries", "create", {
          void_of: entryId,
        }).payload);
        return { voidId: voidRow.id, newBalance };
      });
      // Cache invalidation follows COMMIT — see the payment path.
      invalidateTenant(tenantId);
      return ok({ ok: true, voidId: result.voidId, newBalance: result.newBalance });
    } catch (err) {
      return mapLedgerRouteError(err);
    }
  }

  return null;
};
