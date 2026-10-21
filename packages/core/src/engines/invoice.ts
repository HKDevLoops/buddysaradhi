// Implements: 07_Fees_and_Payments.md §4 (Batch Invoice Generation), §9 line
// 419 (invoice generate: seq increment → `invoices` row with `tamper_hash`
// → post `FEE_CHARGED` → `audit_log` → `sync_outbox`); 12_Business_Rules.md
// BR-LED-03 (monotonic, gap-tolerant, never-reused invoice numbers),
// BR-FEE-10 (a discount is a PAIRED `DISCOUNT_GRANTED` credit), BR-M-01
// (integer paise), BR-SYN-01/02 (outbox in the mutation's transaction),
// BR-RPT-04 (the balance formula); AGENTS.md §3.4 (ORM only), §3.5 (ONE
// money flow — the flow lives in `packages/core/src/feesFlow.ts` and this
// file is only its caller), §2 Rule 1 (ledger INSERT-only), Rule 6 (paise),
// Rule 7 (outbox + audit).
//
// ── WHAT CHANGED AND WHY (audit 2026-10-21, docs/audit/DYNAMIC-MONEY.md) ──
//
// The batch engine used to be a SECOND, PARALLEL implementation of the
// invoice flow, and it was wrong in three ways that each make a tutor's
// books lie:
//
//   1. It posted NO `FEE_CHARGED` ledger row. It wrote an `invoices` row
//      (status 'unpaid') and a `fee_schedule_items` row ('invoiced'), so the
//      invoice list said "₹1,000 unpaid" while the LEDGER — and therefore
//      `students.balance_paise`, the balance the tutor is shown — said
//      "nothing owed". PROVEN: docs/audit/DYNAMIC-MONEY.md DYN-006.
//   2. It allocated invoice numbers by READ-MODIFY-WRITE: it read
//      `settings.nextInvoiceSeq` once into JS, handed out numbers from that
//      local copy, and wrote the counter back with a plain
//      `db.setting.update` AFTER the batch. Two concurrent batches both read
//      the same counter and both tried to use the same numbers; the UNIQUE
//      constraint then failed HALF the batch (each invoice is its own
//      transaction, so the rest survived). PROVEN: DYN-007.
//   3. It wrote `issue_date`/`due_date` as ISO INSTANTS
//      ("2026-09-30T00:00:00.000Z") where every other writer writes
//      "2026-09-30". A TEXT comparison against "2026-10-01" is FALSE for an
//      instant, so a batch invoice can never be overdue. PROVEN: DYN-008.
//
// The engine now DELEGATES to `createInvoiceFlow` — the ONE money flow — over
// the ORM dialect (`ormFeeTx`). That buys, in one move: an ATOMIC sequence
// take (BR-LED-03), the `FEE_CHARGED` ledger row, the paired
// `DISCOUNT_GRANTED` credit for a discount (BR-FEE-10), the tamper hash, the
// audit row and the outbox row — all in ONE transaction, exactly as a
// tutor-created invoice is written (07 §9 line 419).
import { randomUUID } from "crypto";
import { createInvoiceFlow, type FeeTx } from "../feesFlow";
import { ormFeeTx } from "../feesPrisma";
import { paiseDivHalfEven, paiseMul } from "../money";
import type { PrismaClient } from "@prisma/client";

export interface BatchInvoiceConfig {
  tenantId: string;
  batchId?: string;
  dueDate: string;
  issueDate: string;
  periodLabel: string;
}

export interface InvoiceResult {
  studentId: string;
  invoiceId?: string;
  status: "success" | "error";
  error?: string;
}

/**
 * Implements batch invoice generation.
 *
 * Implements: 07_Fees_and_Payments.md §4 — Batch Invoice Generation (+ §10.3
 * BR-FEE-05 canonical tamper hash, BR-FEE-06 basis-point discounts)
 * Rule 6: amounts stored as integer paise
 * Rule 7: sync_outbox + audit_log written in same transaction as invoice create
 *
 * Each invoice is its own transaction (one student's failure must not take
 * the batch down — the pre-existing behaviour, kept), but the money inside
 * it is written by the one flow.
 */
export async function generateBatchInvoices(
  db: PrismaClient,
  config: BatchInvoiceConfig,
): Promise<InvoiceResult[]> {
  const { tenantId, batchId, dueDate, issueDate, periodLabel } = config;

  // 1. Fetch all active fee plans for this batch/tenant
  const feePlans = await db.feePlan.findMany({
    where: {
      tenantId,
      isActive: 1,
      ...(batchId ? { batchId } : {}),
    },
    include: {
      student: true,
    },
  });

  if (feePlans.length === 0) return [];

  // 2. Fetch settings for the tenant secret (the flow reads it itself; this
  //    read exists so a tenant with NO settings fails LOUDLY and before any
  //    work, rather than once per invoice).
  const setting = await db.setting.findUnique({
    where: { tenantId },
    select: { tenantSecret: true },
  });

  if (!setting) throw new Error("Settings not found for tenant");

  // 3. One invoice per plan, each in its own transaction. The number, the
  //    ledger row, the audit row and the outbox row are written by the ONE
  //    money flow (`createInvoiceFlow` over the ORM dialect) — never here.
  const results: InvoiceResult[] = [];
  for (const plan of feePlans) {
    try {
      const subtotal = plan.baseAmount;
      const discountValue = plan.discountValue || 0;
      let calculatedDiscount = 0;

      if (plan.discountType === "fixed") {
        calculatedDiscount = discountValue;
      } else if (plan.discountType === "percent") {
        // BR-FEE-06 (07 §10.3): percent discounts are basis points
        // (1000 = 10%). BR-FEE-01 + 22 P16: division rounds half-to-even —
        // floor and ceil both violate BR-FEE-01 (EC-F-01: 12555/10 -> 1256).
        calculatedDiscount = paiseDivHalfEven(paiseMul(subtotal, discountValue), 10000);
      }
      if (calculatedDiscount > subtotal) {
        throw new Error(
          `DISCOUNT_EXCEEDS_SUBTOTAL: discount ${calculatedDiscount} > subtotal ${subtotal}`,
        );
      }
      const total = subtotal - calculatedDiscount;
      if (total <= 0) {
        throw new Error(`INVOICE_TOTAL_INVALID: a batch invoice must demand a positive amount`);
      }

      const invoiceId = await db.$transaction(async (tx) => {
        const itemId = randomUUID();

        // The schedule item is the invoicing unit (BR-FEE-08) and the
        // invoice's foreign-key target — it is created first, in the SAME
        // transaction as the invoice and its ledger row.
        await tx.feeScheduleItem.create({
          data: {
            id: itemId,
            tenantId,
            feePlanId: plan.id,
            label: periodLabel,
            // `fee_schedule_items.due_date` is a DATE string ("2026-09-30"),
            // not an instant — the old `new Date(dueDate).toISOString()` wrote
            // "2026-09-30T00:00:00.000Z", which never compares as overdue
            // against a "YYYY-MM-DD" today (BR-RPT-03, BR-REM-02).
            dueDate,
            amount: total,
            status: "invoiced",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        // THE MONEY FLOW. It takes the number ATOMICALLY, writes the invoice
        // with its tamper hash, posts the `FEE_CHARGED` ledger row (and the
        // paired `DISCOUNT_GRANTED` credit, BR-FEE-10), writes the audit row
        // and queues the outbox row — all in this one transaction (Rule 7).
        const created = await createInvoiceFlow(
          ormFeeTx(tx as never) as FeeTx,
          {
            tenantId,
            studentId: plan.studentId,
            amountPaise: total,
            description: periodLabel,
            issueDate,
            dueDate,
            subtotalPaise: subtotal,
            discountPaise: calculatedDiscount,
          },
          new Date().toISOString(),
        );
        return created.invoiceId;
      });

      results.push({ studentId: plan.studentId, invoiceId, status: "success" });
    } catch (error) {
      results.push({
        studentId: plan.studentId,
        status: "error",
        error: (error as Error).message,
      });
    }
  }

  return results;
}
