"use server";

import { z } from "zod";
import { getAuthenticatedDb } from "@/server/get-db";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { createInvoiceSql, recordPaymentSql } from "@buddysaradhi/core/fees";

// Implements: 12_Business_Rules.md BR-M-01 (integer paise), BR-SYN-01 (every
// mutation → sync_outbox), AGENTS.md §2 Rule 1 (append-only ledger), Rule 9
// (typed Result, no silent failures); 07_Fees_and_Payments.md §9.6 (atomic
// payment) + §9.7 (monotonic invoice numbers).
//
// This file is ONLY the Zod boundary + typed-Result mapping for the fees
// mutations. The transaction, the ledger posting, the numbering and the
// tamper hash all live in `packages/core/src/fees.ts` — shared with the
// gateway — because the previous web-local implementation was a shadow
// ledger: divergent HMAC hash construction (reconcileLedger failed on every
// row it wrote), `INV-`+Math.random numbers, phantom student INSERTs, no
// transaction, and partial payments attributed against `invoices.total`
// (reviews/overhaul-audit-report-2026-09-26.md F1/F2/F3/F4/F5/F9). One
// writer dialect now exists: `postLedgerEntrySql` in packages/core.
//
// Amounts are integer paise only (no float, no negative, no fractional).
const FeeInputSchema = z.object({
  studentId: z.string().uuid(),
  amountMinor: z.number().int().positive().finite(),
  description: z.string().min(1).max(280),
  dateIso: z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid date" }),
});

export async function recordPaymentAction(
  studentId: string,
  amountMinor: number,
  description: string,
  dateIso: string
) {
  // BR-M-01: validate integer-paise at the gateway boundary.
  const parsed = FeeInputSchema.safeParse({ studentId, amountMinor, description, dateIso });
  if (!parsed.success) {
    log.error('fee_record_payment_invalid_input', parsed.error.message, { studentId });
    return { success: false as const, error: parsed.error.message };
  }
  try {
    const { client, tenantId } = await getAuthenticatedDb();
    // 07 §9.6: audit-first, all-or-nothing, partial payments attributed per
    // invoice (F9), remainder auto-invoiced under a monotonic number (F3).
    const result = await recordPaymentSql(client, {
      tenantId,
      studentId: parsed.data.studentId,
      amountPaise: parsed.data.amountMinor,
      description: parsed.data.description,
      receivedOn: parsed.data.dateIso,
    });
    if (!result.ok) throw result.error;
    revalidatePath("/fees");
    return { success: true as const, data: result.value };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record payment";
    log.error('fee_record_payment_failed', message, { studentId, amountMinor });
    return { success: false as const, error: message };
  }
}

export async function voidReceiptAction(entryIdToVoid: string, pin: string) {
  try {
    // Fail-closed: previous `if (pin !== "1234")` was a backdoor.
    if (!pin || !pin.trim()) {
      return { success: false as const, error: "PIN required to void a receipt" };
    }
    log.error('fee_void_receipt_blocked', 'PIN verification disabled; awaiting Argon2', { entryIdToVoid });
    return { success: false as const, error: "PIN verification disabled — contact support" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to void receipt";
    log.error('fee_void_receipt_failed', message, { entryIdToVoid });
    return { success: false as const, error: message };
  }
}

export async function createInvoiceAction(
  studentId: string,
  amountMinor: number,
  description: string,
  dateIso: string
) {
  // BR-M-01: validate integer-paise at the gateway boundary.
  const parsed = FeeInputSchema.safeParse({ studentId, amountMinor, description, dateIso });
  if (!parsed.success) {
    log.error('fee_create_invoice_invalid_input', parsed.error.message, { studentId });
    return { success: false as const, error: parsed.error.message };
  }
  try {
    const { client, tenantId } = await getAuthenticatedDb();
    // 07 §9 line 419: seq increment → invoice row with tamper_hash →
    // FEE_CHARGED → audit_log → sync_outbox, in ONE transaction.
    const result = await createInvoiceSql(client, {
      tenantId,
      studentId: parsed.data.studentId,
      amountPaise: parsed.data.amountMinor,
      description: parsed.data.description,
      issueDate: parsed.data.dateIso,
    });
    if (!result.ok) throw result.error;
    revalidatePath("/fees");
    return { success: true as const, data: result.value };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create invoice";
    log.error('fee_create_invoice_failed', message, { studentId, amountMinor });
    return { success: false as const, error: message };
  }
}
