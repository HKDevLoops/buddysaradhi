import type { PrismaClient } from "@prisma/client";
import { randomUUID, createHash } from "crypto";

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
 * Implements batch invoice generation via parallel processing
 * using Promise.allSettled as required by the specification.
 *
 * Implements: 07_Fees_and_Payments.md §4 — Batch Invoice Generation
 * Rule 6: amounts stored as integer paise
 * Rule 7: sync_outbox written in same transaction as invoice create
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

  // 2. Fetch settings for sequence number and invoice prefix
  const setting = await db.setting.findUnique({
    where: { tenantId },
    select: { nextInvoiceSeq: true, invoicePrefix: true },
  });

  if (!setting) throw new Error("Settings not found for tenant");

  const invoicePrefix = setting.invoicePrefix;

  // 3. Pre-allocate all invoice sequence numbers BEFORE spawning parallel
  // promises. If we allocated inside map(), multiple async continuations could
  // read the same currentSeq value before any other had incremented it,
  // producing duplicate invoice numbers — a P0 data integrity bug.
  // By assigning from a synchronous loop first, each plan gets a unique,
  // monotonically-increasing number. (BR-M-01, 07_Fees_and_Payments §4.3)
  const seqMap = new Map<string, number>();
  let nextSeq = setting.nextInvoiceSeq;
  for (const plan of feePlans) {
    seqMap.set(plan.id, nextSeq++);
  }
  const finalSeq = nextSeq;

  // 4. Process each invoice in parallel using Promise.allSettled
  const invoicePromises = feePlans.map(
    async (plan: (typeof feePlans)[number]): Promise<InvoiceResult> => {
      try {
        const invoiceId = randomUUID();
        const seq = seqMap.get(plan.id)!;
        const number = `${invoicePrefix}${seq.toString().padStart(5, "0")}`;

        const subtotal = plan.baseAmount;
        const discountValue = plan.discountValue || 0;
        let calculatedDiscount = 0;

        if (plan.discountType === "fixed") {
          calculatedDiscount = discountValue;
        } else if (plan.discountType === "percent") {
          // Floor to paise — never ceil (Rule 6: integer paise only)
          calculatedDiscount = Math.floor(subtotal * (discountValue / 100));
        }

        const total = subtotal - calculatedDiscount;
        const tamperHash = createHash("sha256")
          .update(`${invoiceId}${total}${issueDate}`)
          .digest("hex");

        // All three writes happen in a single atomic transaction.
        // Losing any one of them makes the record incomplete (Rule 7).
        await db.$transaction(async (tx: any) => {
          const itemId = randomUUID();

          // Create fee schedule item first (foreign key target)
          await tx.feeScheduleItem.create({
            data: {
              id: itemId,
              tenantId,
              feePlanId: plan.id,
              label: periodLabel,
              dueDate: new Date(dueDate).toISOString(),
              amount: total,
              status: "invoiced",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });

          // Create the invoice
          await tx.invoice.create({
            data: {
              id: invoiceId,
              tenantId,
              number,
              studentId: plan.studentId,
              feeScheduleItemId: itemId,
              issueDate: new Date(issueDate).toISOString(),
              dueDate: new Date(dueDate).toISOString(),
              subtotal,
              discount: calculatedDiscount,
              extraCharges: 0,
              total,
              status: "unpaid",
              tamperHash,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });

          // Append to sync_outbox in the same transaction (BR-SYN-01)
          await tx.syncOutbox.create({
            data: {
              id: randomUUID(),
              tenantId,
              tableName: "invoices",
              rowId: invoiceId,
              op: "insert",
              payload: JSON.stringify({ id: invoiceId, number, total }),
              status: "pending",
              createdAt: new Date(),
            },
          });
        });

        return { studentId: plan.studentId, invoiceId, status: "success" };
      } catch (error) {
        return {
          studentId: plan.studentId,
          status: "error",
          error: (error as Error).message,
        };
      }
    },
  );

  const results = await Promise.allSettled(invoicePromises);

  // 5. Persist the final sequence number — only after all invoices are settled
  // so a partial batch failure doesn't leave the counter ahead of reality.
  await db.setting.update({
    where: { tenantId },
    data: { nextInvoiceSeq: finalSeq },
  });

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { studentId: "unknown", status: "error", error: "Promise rejected" },
  );
}
