// Implements: 07_Fees_and_Payments.md §6.4 (Record Payment Sheet — method,
// reference, live preview, advance toggle) + §9.6 (atomic payment) + §9.10
// (void with reason) + §10.1 BR-M-01 (integer paise) + §10.4 BR-RC-01
// (monotonic receipt numbers); 12_Business_Rules.md BR-FEE-04/BR-FEE-15
// (overpayment split exact + ADVANCE), BR-FEE-05 (1-paise paid-in-full
// tolerance), BR-LED-04/BR-LED-05 (void = reversing entry, never void-a-void),
// BR-SEC-04 (PIN gate on void/backdate); 10_Security.md §4 (sensitive-mutation
// PIN) + §9 (append-only ledger); 02_Core_Logic.md §13.6 (voidLedgerEntry) +
// §6.7 (24h lock windows); 14_Edge_Cases.md EC-F-02/EC-F-08 (overpayment and
// advance display).
//
// This module is the PURE contract shared by the fees server action
// (`@/server/actions/fees`) and the fees sheets. It lives outside the
// `"use server"` file because Next.js only allows async-function exports
// there — schemas and preview builders would break the build. Both sides
// validate through THE SAME Zod schemas, so the sheet posts exactly what it
// previewed and the server re-validates every field before any DB call
// (RFC-003 G-HARDEN: never trust client state; free-tier: preview is computed
// client-side with zero network — no per-keystroke remote calls).
//
// Money (Rule 6 / BR-M-01): every amount here is integer paise. Parsing uses
// integer string math only — never `Number(x) * 100`, never Math.round/floor
// on money. Arithmetic uses shared `paiseAdd`/`paiseSub`/`paiseMul`.
import { z } from "zod";
import { paiseAdd, paiseMul, paiseSub } from "@buddysaradhi/shared";

/** 07 §6.4 Method segmented control + §7 PaymentPayload method union. */
export const PAYMENT_METHODS = [
  "cash",
  "upi",
  "card",
  "bank",
  "cheque",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);

/**
 * Gateway parity note (read-only, apps/gateway/routes/ledger.ts:58-64): the
 * gateway payment path accepts `method: z.string().trim().max(32).optional()`
 * defaulting to `"upi"` — ANY 32-char string passes. This contract enforces
 * the strict 6-method enum web-side per 07 §7 PaymentPayload; a gateway row
 * with a non-enum method is a parity gap (reported, not fixed here).
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank",
  cheque: "Cheque",
  other: "Other",
};

/** EC-F-15: per-entry ceiling — ₹1 crore in paise. */
export const MAX_PAISE_PER_ENTRY = 1000000000;

/** BR-FEE-05: "paid in full" iff |balance_due| ≤ 1 paise. */
export const PAID_IN_FULL_TOLERANCE_PAISE = 1;

const uuidSchema = z.string().uuid("must be a UUID");
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date YYYY-MM-DD");

/**
 * BR-M-01: exact rupee decimal string → integer paise using integer math
 * only. Rejects (returns null) rather than truncating: empty, non-numeric,
 * negative, zero, >2 fraction digits (sub-paisa input carries no value and
 * must not be silently dropped), and amounts above EC-F-15. No float ever
 * touches a money value.
 */
export function rupeesStringToPaise(raw: string): number | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const frac = match[2] ?? "";
  if (frac.length > 2) return null;
  // BigInt() calls (not `100n` literals): tsconfig target is ES2017.
  const paiseBig =
    BigInt(whole) * BigInt(100) + BigInt((frac + "00").slice(0, 2));
  if (paiseBig <= BigInt(0)) return null;
  if (paiseBig > BigInt(MAX_PAISE_PER_ENTRY)) return null;
  const paise = Number(paiseBig);
  if (!Number.isSafeInteger(paise)) return null;
  return paise;
}

/**
 * 07 §6.4 reference rules, enforced both client-side (sheet hint) and
 * server-side (superRefine): optional for cash, required + patterned for
 * upi/bank/cheque. Returns an error string or null when valid.
 */
export function validateReferenceForMethod(
  method: PaymentMethod,
  reference: string,
): string | null {
  const ref = reference.trim();
  if (method === "cash" || method === "card" || method === "other") {
    if (ref.length > 32) return "Reference must be 32 characters or fewer";
    return null;
  }
  if (method === "cheque") {
    if (!/^\d{6}$/.test(ref)) return "Cheque number must be 6 digits";
    return null;
  }
  // upi | bank — UTR pattern per 07 §6.4.
  if (!/^\w{10,22}$/.test(ref)) return "UTR must be 10–22 letters/digits";
  return null;
}

/**
 * The receipt-before-post payload (07 §6.4 live preview). The sheet builds
 * one of these, SHOWS it, then posts THE SAME object — the server parses it
 * with this schema and posts those exact values (no silent recompute).
 * `balanceDuePaiseAtPreview` is display-only context (derived data drifts
 * under concurrency) and is never trusted for posting.
 */
export const RecordPaymentPayloadSchema = z
  .object({
    studentId: uuidSchema,
    amountPaise: z
      .number()
      .int("amount must be whole paise")
      .positive("amount must be greater than zero paise")
      .max(MAX_PAISE_PER_ENTRY, "Amount exceeds per-entry limit"),
    method: PaymentMethodSchema,
    reference: z.string().trim().max(32).optional().default(""),
    description: z.string().trim().min(1).max(280),
    receivedOn: isoDateSchema,
    /** BR-M-04 soft guard: tutor saw the excess and acknowledged advance. */
    advanceAcknowledged: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    const err = validateReferenceForMethod(v.method, v.reference ?? "");
    if (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reference"], message: err });
    }
  });

export type RecordPaymentPayload = z.infer<typeof RecordPaymentPayloadSchema>;

/**
 * Deterministic ledger-description enrichment. Core's `RecordPaymentInput`
 * has no method/reference columns (parity gap — reported), so the method and
 * reference ride in the description where the ledger, the receipt preview,
 * and the audit metadata all preserve them. Pure and tested: the SAME
 * function runs on both sides of the boundary, so enrichment is contract,
 * not silent recompute.
 */
export function buildLedgerDescription(
  method: PaymentMethod,
  reference: string,
  description: string,
): string {
  const ref = reference.trim();
  const tag = ref.length > 0 ? `[${method} · ${ref}]` : `[${method}]`;
  return `${tag} ${description.trim()}`;
}

/** Invoice status machine states (07 §9.6 step 5 recompute). */
export type InvoicePaymentStatus = "unpaid" | "partial" | "paid";

/**
 * EC-F-02 preview split (BR-FEE-04/BR-FEE-15): how a payment divides against
 * the currently-known outstanding. `appliedPaise` credits invoices;
 * `advancePaise` is the surplus (advance wallet / auto-invoice). paise-only.
 */
export interface PaymentSplitPreview {
  appliedPaise: number;
  advancePaise: number;
  isAdvance: boolean;
  balanceAfterPaise: number;
  statusAfter: InvoicePaymentStatus;
}

export function splitPaymentPreview(
  balanceDuePaise: number,
  amountPaise: number,
): PaymentSplitPreview {
  const appliedPaise = Math.min(balanceDuePaise, amountPaise);
  const advancePaise = paiseSub(amountPaise, appliedPaise);
  const balanceAfterPaise = paiseSub(balanceDuePaise, amountPaise);
  return {
    appliedPaise,
    advancePaise,
    isAdvance: advancePaise > 0,
    balanceAfterPaise,
    statusAfter: classifyStatusAfter(balanceAfterPaise, amountPaise),
  };
}

/**
 * 07 §9.6 step 5 status recompute preview with BR-FEE-05 tolerance:
 * |balance| ≤ 1 paise reads as paid.
 */
export function classifyStatusAfter(
  balanceAfterPaise: number,
  paidPaise: number,
): InvoicePaymentStatus {
  if (Math.abs(balanceAfterPaise) <= PAID_IN_FULL_TOLERANCE_PAISE) return "paid";
  if (paidPaise > 0) return "partial";
  return "unpaid";
}

/**
 * BR-RC-01 number build: `prefix + zero-pad(seq, 6)`. The counter is
 * consumed, never decremented — gaps (voids) are audit features (EC-L-07).
 */
export function formatSequenceNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

/** BR-RC-01 regression helper: a consumed sequence never moves backwards. */
export function isSequenceMonotonic(prevSeq: number, nextSeq: number): boolean {
  return nextSeq >= prevSeq;
}

/**
 * 07 §6.4 backdate gate (BR-LED-07): received >3 days before today surfaces
 * the amber warning and requires a fresh PIN. Pure date math on YYYY-MM-DD.
 */
export function isBackdated(receivedOn: string, todayIso: string): boolean {
  const ms =
    Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${receivedOn}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  // 3 days in ms — duration arithmetic, not money; division here is time.
  return ms > 3 * 24 * 60 * 60 * 1000;
}

/**
 * 07 §9.10 + BR-LED-04: a void carries the typed reason that ends up in
 * `audit_log.metadata`. Empty or one-word reasons are rejected fail-closed.
 */
export const VoidReasonSchema = z
  .string()
  .trim()
  .min(8, "Void reason must be at least 8 characters")
  .max(500, "Void reason must be 500 characters or fewer");

export const VoidPayloadSchema = z.object({
  entryId: uuidSchema,
  reason: VoidReasonSchema,
  /** Presence-gated here; Argon2 verification is workstream A (auth). */
  pin: z.string().trim().min(1, "PIN required to void a receipt"),
});

export type VoidPayload = z.infer<typeof VoidPayloadSchema>;

/** Invoice-create boundary (BR-M-01 integer paise at the action edge). */
export const CreateInvoicePayloadSchema = z.object({
  studentId: uuidSchema,
  amountPaise: z
    .number()
    .int("amount must be whole paise")
    .positive("amount must be greater than zero paise")
    .max(MAX_PAISE_PER_ENTRY, "Amount exceeds per-entry limit"),
  description: z.string().trim().min(1).max(280),
  issueDate: isoDateSchema,
});

export type CreateInvoicePayload = z.infer<typeof CreateInvoicePayloadSchema>;

/** Re-export shared paise helpers so sheets do arithmetic without imports. */
export { paiseAdd, paiseMul, paiseSub };
