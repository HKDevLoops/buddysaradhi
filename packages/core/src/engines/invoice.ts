import { PrismaClient } from "@prisma/client";
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

  // 2. Fetch the latest sequence for invoices to allocate numbers safely
  // (In a real high-concurrency environment we'd use a transaction for sequence allocation,
  // but for parallel processing we allocate a block of IDs in memory)
  const setting = await db.setting.findUnique({
    where: { tenantId },
    select: { nextInvoiceSeq: true, invoicePrefix: true },
  });

  if (!setting) throw new Error("Settings not found for tenant");

  let currentSeq = setting.nextInvoiceSeq;
  const invoicePrefix = setting.invoicePrefix;

  // 3. Process each invoice generation in parallel using Promise.allSettled
  const invoicePromises = feePlans.map(async (plan): Promise<InvoiceResult> => {
    try {
      const invoiceId = randomUUID();
      const seq = currentSeq++; // Local sequential increment
      const number = `${invoicePrefix}${seq.toString().padStart(5, "0")}`;

      const subtotal = plan.baseAmount;
      const discount = plan.discountValue || 0;
      let calculatedDiscount = 0;

      if (plan.discountType === "fixed") {
        calculatedDiscount = discount;
      } else if (plan.discountType === "percent") {
        calculatedDiscount = Math.floor(subtotal * (discount / 100));
      }

      const total = subtotal - calculatedDiscount;
      const tamperHash = createHash("sha256")
        .update(`${invoiceId}${total}${issueDate}`)
        .digest("hex");

      // Use a transaction for the individual invoice creation
      await db.$transaction(async (tx) => {
        // Create fee schedule item
        const itemId = randomUUID();
        await tx.feeScheduleItem.create({
          data: {
            id: itemId,
            tenantId,
            feePlanId: plan.id,
            label: periodLabel,
            dueDate: new Date(dueDate).toISOString(), // string due to schema
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

        // Append to sync_outbox
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
  });

  const results = await Promise.allSettled(invoicePromises);

  // 4. Update the global sequence number in settings
  await db.setting.update({
    where: { tenantId },
    data: { nextInvoiceSeq: currentSeq },
  });

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { studentId: "unknown", status: "error", error: "Promise rejected" },
  );
}
