"use server";

import { z } from "zod";
import {
  getAuthenticatedPrisma,
  gatewayPost,
} from "@/server/get-db";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { paiseSub } from "@buddysaradhi/shared";
import {
  createInvoicePrisma,
  recordPaymentPrisma,
} from "@buddysaradhi/core/feesPrisma";
import {
  buildLedgerDescription,
  CreateInvoicePayloadSchema,
  RecordPaymentPayloadSchema,
  VoidPayloadSchema,
  type PaymentMethod,
} from "@/components/fees/payment-contract";

// Implements: 12_Business_Rules.md BR-M-01 (integer paise), BR-SYN-01 (every
// mutation → sync_outbox), BR-FEE-04/BR-FEE-15 (overpayment split exact +
// ADVANCE), BR-FEE-05 (1-paise tolerance), BR-LED-04/BR-LED-05 (void =
// reversing entry), BR-SEC-04 (PIN gate on void/backdate); AGENTS.md §2
// Rule 1 (append-only ledger), Rule 6 (paise), Rule 7 (outbox + audit),
// Rule 9 (typed Result, no silent failures); 07_Fees_and_Payments.md §9.6
// (atomic payment) + §9.7 (monotonic invoice numbers) + §9.10 (void with
// reason) + §6.4 (receipt-before-post); 10_Security.md §4 + §9 (void is a new
// row); 02_Core_Logic.md §13.6 (voidLedgerEntry); RFC-003 workstream B.
//
// This file is ONLY the Zod boundary + typed-Result mapping for the fees
// mutations. The money logic lives in `packages/core/src/feesFlow.ts` — ONE
// flow, shared by the gateway and web, because the previous web-local
// implementation was a shadow ledger: divergent HMAC hash construction
// (reconcileLedger failed on every row it wrote), `INV-`+Math.random numbers,
// phantom student INSERTs, no transaction, and partial payments attributed
// against `invoices.total` (reviews/overhaul-audit-report-2026-09-26.md
// F1/F2/F3/F4/F5/F9). The flow has two I/O dialects — `fees.ts` (libsql,
// gateway) and `feesPrisma.ts` (ORM, web) — and
// `packages/core/src/feesDialectParity.test.ts` fails if they ever disagree.
// The ledger row itself is posted through the shared Prisma dialect
// (`postLedgerEntry` in `packages/core/src/ledger.ts`).
//
// Receipt-before-post (07 §6.4): the sheet builds a `RecordPaymentPayload`
// (same schema below), SHOWS it, then posts THE SAME values. This action
// re-parses them with `RecordPaymentPayloadSchema` and posts those exact
// values — amount, method, reference, date and description are never
// re-derived here. Description enrichment is the deterministic,
// contract-tested `buildLedgerDescription`, not a silent recompute.
//
// ORM-ONLY (AGENTS.md §3.4): the invoice/payment flows are the ORM dialect
// (`feesPrisma.ts`) over the sanctioned model surface, so this action no longer
// needs a raw libSQL client at all. Both dialects delegate to ONE money flow
// (`feesFlow.ts`), so the web and gateway books cannot diverge.
//
// Free-tier budgets (RFC-003 §0): one DB read (indexed student PK) + one
// core write transaction per payment; one 12s-timeout gateway POST per void;
// smallest sufficient payloads (`{entryId, reason}`); no polling, no
// per-keystroke remote calls.

export interface RecordPaymentOptions {
  method?: PaymentMethod;
  reference?: string;
  advanceAcknowledged?: boolean;
}

export async function recordPaymentAction(
  studentId: string,
  amountMinor: number,
  description: string,
  dateIso: string,
  options?: RecordPaymentOptions
) {
  // BR-M-01 + 07 §7 PaymentPayload: strict enum end-to-end (method defaults
  // to cash per 07 §6.4 — never the gateway's loose free-string default).
  const parsed = RecordPaymentPayloadSchema.safeParse({
    studentId,
    amountPaise: amountMinor,
    method: options?.method ?? "cash",
    reference: options?.reference ?? "",
    description,
    receivedOn: dateIso,
    advanceAcknowledged: options?.advanceAcknowledged ?? false,
  });
  if (!parsed.success) {
    log.error("fee_record_payment_invalid_input", parsed.error.message, {
      studentId,
    });
    return { success: false as const, error: parsed.error.message };
  }
  const payload = parsed.data;
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    // BR-M-04 soft guard, server-enforced (G-HARDEN: never trust client
    // state): when the known balance is covered, an excess requires the
    // tutor's explicit advance acknowledgement from the preview. One indexed
    // PK read — the write itself stays a single core transaction.
    const student = await db.student.findUnique({
      where: { id: payload.studentId, tenantId },
    });
    const knownBalance =
      student !== null && typeof student.balancePaise === "number"
        ? student.balancePaise
        : null;
    if (
      knownBalance !== null &&
      Number.isSafeInteger(knownBalance) &&
      payload.amountPaise > knownBalance &&
      knownBalance >= 0 &&
      !payload.advanceAcknowledged
    ) {
      const excess = paiseSub(payload.amountPaise, knownBalance);
      log.error("fee_record_payment_excess_unacknowledged", "Overpayment without advance acknowledgement", {
        studentId: payload.studentId,
        excessPaise: excess,
      });
      return {
        success: false as const,
        error: `Amount exceeds balance due by ${excess} paise. Acknowledge 'Mark as advance' to record the surplus.`,
      };
    }
    // 07 §9.6: audit-first, all-or-nothing, partial payments attributed per
    // invoice (F9) with unpaid→partial→paid recompute, remainder auto-invoiced
    // under a monotonic number (F3). The posted values are EXACTLY the
    // previewed ones; only the description gains the deterministic
    // method/reference tag (contract-tested, preserved into audit metadata).
    const result = await recordPaymentPrisma(db, {
      tenantId,
      studentId: payload.studentId,
      amountPaise: payload.amountPaise,
      description: buildLedgerDescription(
        payload.method,
        payload.reference ?? "",
        payload.description
      ),
      receivedOn: payload.receivedOn,
    });
    if (!result.ok) throw result.error;
    revalidatePath("/fees");
    return {
      success: true as const,
      data: {
        ...result.value,
        method: payload.method,
        reference: payload.reference ?? "",
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to record payment";
    log.error("fee_record_payment_failed", message, {
      studentId,
      amountMinor,
    });
    return { success: false as const, error: message };
  }
}

const VoidGatewayResponseSchema = z.object({
  ok: z.boolean().optional(),
  voidId: z.string().uuid().optional(),
  newBalance: z.number().int().optional(),
});

export async function voidReceiptAction(
  entryIdToVoid: string,
  pin: string,
  reason?: string,
  opts?: { intentKey?: string }
) {
  // 07 §9.10 + BR-LED-04 + BR-SEC-04: void requires a typed reason AND a
  // fresh PIN. PIN *presence* is gated here fail-closed; Argon2 verification
  // is workstream A (auth) — until it lands, presence + audit is the boundary
  // (the old `pin !== "1234"` backdoor stays removed; the PIN is never logged
  // and never forwarded — the gateway void contract carries only
  // `{entryId, reason}`).
  const parsed = VoidPayloadSchema.safeParse({
    entryId: entryIdToVoid,
    reason: reason ?? "",
    pin,
  });
  if (!parsed.success) {
    log.error("fee_void_receipt_invalid_input", parsed.error.message, {
      entryIdToVoid,
    });
    return { success: false as const, error: parsed.error.message };
  }
  try {
    // Rule 1 + Rule 7: the reversing VOID entry, the receipt `voided_at`,
    // the invoice-status revert, the `audit_log` row (reason in metadata)
    // and the `sync_outbox` rows all land in ONE gateway write transaction
    // (apps/gateway/routes/ledger.ts void path — read-only parity, never
    // re-implemented here). BR-RC-01: the gateway sequence is only ever
    // incremented, so voiding can never reuse or decrement a receipt number.
    // Smallest sufficient payload: `{entryId, reason}` — one POST, 12s abort.
    // RFC-004 C1: the caller's intent key rides as Idempotency-Key so a
    // retried/aborted void replays instead of double-voiding (gateway 409
    // double-void guard is the backstop, not the mechanism).
    const res = await gatewayPost<unknown>("/api/v1/ledger/void", {
      entryId: parsed.data.entryId,
      reason: parsed.data.reason,
    }, opts?.intentKey ? { "Idempotency-Key": opts.intentKey } : undefined);
    if (!res.success) {
      throw new Error(mapVoidGatewayError(res.error));
    }
    const body = VoidGatewayResponseSchema.safeParse(res.data);
    if (!body.success || !body.data.voidId) {
      throw new Error("Void failed: unexpected gateway response");
    }
    log.audit("fee_void_receipt_posted", "Void reversing entry posted", {
      entryId: parsed.data.entryId,
      voidId: body.data.voidId,
    });
    revalidatePath("/fees");
    return {
      success: true as const,
      data: { voidId: body.data.voidId, newBalance: body.data.newBalance ?? null },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to void receipt";
    log.error("fee_void_receipt_failed", message, { entryIdToVoid });
    return { success: false as const, error: message };
  }
}

/** Typed mapping for the gateway void contract (Rule 9: no opaque errors). */
function mapVoidGatewayError(message: string): string {
  if (/entry_not_found/i.test(message)) return "Entry not found — it may have been voided already";
  if (/cannot_void_a_void_entry/i.test(message))
    return "Cannot void a void entry (BR-LED-05). Post a compensating ADJUSTMENT instead.";
  if (/entry_already_voided/i.test(message))
    return "Entry already voided (BR-LED-04) — no second reversing row posted";
  return message;
}

export async function createInvoiceAction(
  studentId: string,
  amountMinor: number,
  description: string,
  dateIso: string
) {
  // BR-M-01: validate integer-paise at the gateway boundary.
  const parsed = CreateInvoicePayloadSchema.safeParse({
    studentId,
    amountPaise: amountMinor,
    description,
    issueDate: dateIso,
  });
  if (!parsed.success) {
    log.error("fee_create_invoice_invalid_input", parsed.error.message, {
      studentId,
    });
    return { success: false as const, error: parsed.error.message };
  }
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    // 07 §9 line 419: seq increment → invoice row with tamper_hash →
    // FEE_CHARGED → audit_log → sync_outbox, in ONE transaction.
    const result = await createInvoicePrisma(db, {
      tenantId,
      studentId: parsed.data.studentId,
      amountPaise: parsed.data.amountPaise,
      description: parsed.data.description,
      issueDate: parsed.data.issueDate,
    });
    if (!result.ok) throw result.error;
    revalidatePath("/fees");
    return { success: true as const, data: result.value };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create invoice";
    log.error("fee_create_invoice_failed", message, { studentId, amountMinor });
    return { success: false as const, error: message };
  }
}
