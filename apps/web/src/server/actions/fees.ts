"use server";

import { z } from "zod";
import {
  getAuthenticatedPrisma,
  gatewayPost,
} from "@/server/get-db";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { verifyPin } from "@/lib/crypto";
import { pinFormatError, formatINR, paiseSub } from "@buddysaradhi/shared";
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
  /**
   * BR-SEC-04: a backdated payment needs a fresh PIN. The sheet collected one,
   * displayed it behind a "fresh PIN required" panel, and then never sent it —
   * so the gate was decoration. It is now part of the action's signature and
   * verified below, but ONLY when the payment is actually backdated.
   */
  pin?: string;
}

/** BR-SEC-04: today in the tenant's local terms, as a YYYY-MM-DD string. */
function todayLocalIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
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
    // Tutor-safe by construction: the Zod detail is logged, not returned.
    return {
      success: false as const,
      error: "That payment was missing or had an invalid amount. Check the figures and try again.",
    };
  }
  const payload = parsed.data;

  // BR-SEC-04, enforced server-side and never trusting the client's own
  // `isBackdated` flag: the date decides, not the form. A payment dated before
  // today is a backdated payment and needs a verified PIN; anything else
  // passes through untouched, because requiring a PIN to pay today would be
  // friction with no security value.
  const isBackdated = payload.receivedOn < todayLocalIso();
  if (isBackdated) {
    const pin = options?.pin ?? "";
    const pinProblem = pinFormatError(pin);
    if (pinProblem) {
      log.audit("fee_record_payment_pin_rejected", "Backdated payment refused on PIN", {
        studentId,
      });
      // `pinProblem` is already a complete sentence ("Enter your PIN.",
      // "Your PIN is at most 8 digits."), so it must not be wrapped in a
      // sentence that also asks for the PIN — that reads as a stutter.
      return { success: false as const, error: pinProblem };
    }
    const { db, tenantId } = await getAuthenticatedPrisma();
    const settingsRow = await db.setting.findFirst({ where: { tenantId } });
    const pinHash = (settingsRow?.pinHash ?? null) as string | null;
    if (!pinHash) {
      return {
        success: false as const,
        error:
          "No PIN is set for this account. Set one in Settings, then record the backdated payment.",
      };
    }
    if (!(await verifyPin(pin, pinHash))) {
      log.audit("fee_record_payment_pin_rejected", "Backdated payment refused on wrong PIN", {
        studentId,
      });
      return { success: false as const, error: "That PIN isn't right. Nothing was written." };
    }
  }

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
      // 07 §10.1 BR-M-04 states the helper as "Amount exceeds balance due by
      // ₹X", and 12_Business_Rules.md BR-M-02 makes `formatINR()` the single
      // source for any displayed amount (FM-02: a raw money value rendering as
      // `1255.5499…` is a P0). This string interpolated the raw paise count, so
      // a ₹200 excess reached the tutor as "20000 paise" — a figure in a unit
      // they never asked for, on the one alert that stops a payment.
      return {
        success: false as const,
        error: `Amount exceeds balance due by ${formatINR(excess)}. Acknowledge 'Mark as advance' to record the surplus.`,
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
      // 07 §7 `TypeChip` + amended §6.4: the method is the tutor's own choice
      // and the reference is OPTIONAL for every method, so `reference` is
      // passed through verbatim (empty string included) rather than defaulted
      // away. Both land on `receipts.payment_method` / `payment_ref` — the
      // fields the printed receipt shows.
      method: payload.method,
      reference: payload.reference ?? "",
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
  // fresh PIN that is actually VERIFIED.
  //
  // This used to check PIN *presence* only and forward nothing, with a comment
  // deferring Argon2 to "workstream A". That is not a deferral, it is an
  // unauthenticated mutation: the ledger is append-only (Rule 1), so a void is
  // the ONLY correction path a mistaken payment has, and any 4-8 digits voided a
  // real receipt — while the dialog's own copy promised "That PIN isn't right",
  // an outcome the server could not produce. `lockSessionAction` in
  // `server/actions/attendance.ts` is the working reference for this exact
  // sequence: format check, load `settings.pinHash`, fail closed when no PIN is
  // configured, `verifyPin`, then proceed.
  const parsed = VoidPayloadSchema.safeParse({
    entryId: entryIdToVoid,
    reason: reason ?? "",
    pin,
  });
  if (!parsed.success) {
    log.error("fee_void_receipt_invalid_input", parsed.error.message, {
      entryIdToVoid,
    });
    // Rule 9: the client shows this string to a tutor, so it must be one the
    // product wrote. A raw Zod message leaks internal field paths, which is
    // exactly what invariant 1 of `components/ui/screen-state.tsx` forbids.
    return {
      success: false as const,
      error: "That void request was missing something. Check the receipt and the reason, then try again.",
    };
  }

  // The PIN is never forwarded to the gateway and never logged (Rule 3): it is
  // verified here, in the server action, against the tenant's own stored hash.
  const pinProblem = pinFormatError(parsed.data.pin);
  if (pinProblem) {
    log.audit("fee_void_receipt_pin_rejected", "Void refused on PIN format", {
      entryIdToVoid,
    });
    return { success: false as const, error: pinProblem };
  }
  {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const settingsRow = await db.setting.findFirst({ where: { tenantId } });
    const pinHash = (settingsRow?.pinHash ?? null) as string | null;
    if (!pinHash) {
      return {
        success: false as const,
        error: "No PIN is set for this account. Set one in Settings, then void again.",
      };
    }
    const pinValid = await verifyPin(parsed.data.pin, pinHash);
    if (!pinValid) {
      log.audit("fee_void_receipt_pin_rejected", "Void refused on wrong PIN", {
        entryIdToVoid,
      });
      return { success: false as const, error: "That PIN isn't right. Nothing was written." };
    }
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
  // BR-LED-09 / EC-F-06: the charge is settled by payments, so reversing it
  // would strand those credits. The tutor needs the ORDER of operations, not the
  // rule id: void the receipts first, then the charge.
  if (/charge_has_credits/i.test(message))
    return "This fee already has payments against it. Void those receipts first, then void the fee — nothing was written.";
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
    // Rule 9 + invariant 1 of `components/ui/screen-state.tsx`: this string is
    // rendered verbatim inside the sheet's `role="alert"`, and a raw Zod
    // message reads as `amountPaise: Number must be greater than 0` — database
    // field names at a tutor. The detail stays in the log; the tutor gets one
    // sentence and the reason they can act on.
    return {
      success: false as const,
      error: "That invoice was missing something, or the amount was not a valid whole-paise figure. Check the amount and try again.",
    };
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
