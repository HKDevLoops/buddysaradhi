"use server";

import { z } from "zod";
import {
  getAuthenticatedPrisma,
  gatewayPost,
} from "@/server/get-db";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { verifyPin } from "@/lib/crypto";
import { pinVerifyFormatError, formatINR, paiseSub } from "@buddysaradhi/shared";
import {
  createInvoicePrisma,
  recordPaymentPrisma,
  type OrmTx,
  type OrmWriteClient,
} from "@buddysaradhi/core/feesPrisma";
import {
  FEE_AUDIT_ACTOR,
  type RecordPaymentInput,
} from "@buddysaradhi/core/feesFlow";
import { hash64Hex } from "@/lib/intent-key";
import {
  buildLedgerDescription,
  CreateInvoicePayloadSchema,
  PaymentMethodSchema,
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
//
// RFC-004 C1 — `recordPaymentAction` also carries the caller's intent key
// (`RecordPaymentOptions.intentKey`) and CONSUMES it, so a replay of one
// payment returns the original receipt instead of posting a second one. The
// claim lives in `audit_log`, written inside the money flow's own
// transaction; the full rationale — and why it is NOT the gateway's
// `idempotency_keys` table — is in the guard block at the bottom of this file.
// Replay is the only path that does NOT re-read `students.balance_paise`: a
// replay answers with what was recorded, it does not re-judge it against a
// balance the first call already moved.

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
  /**
   * RFC-004 C1 — the caller-minted intent key for ONE payment attempt
   * (`mintIntentKey()`, a UUIDv7 shape), forwarded by
   * `useConfirmedMutation` and reused unchanged on every retry, replay and
   * offline drain.
   *
   * THIS IS THE SERVER HALF OF THE GAP `hooks/use-confirmed-mutation.ts:36-37`
   * NAMES. It was absent, so a payment that COMMITTED whose response never
   * reached the browser (Vercel timeout, network drop, closed tab) was reported
   * to the tutor as "Payment not saved … Nothing was written" — a false claim,
   * because the catch below could not tell pre-commit failure from post-commit
   * failure — and the natural response to that message (tap Record payment
   * again) minted a FRESH `receiptId` and consumed a FRESH `next_receipt_seq`,
   * landing a SECOND credit with a second receipt number. The books were then
   * double-counted, and on an append-only ledger (Rule 1) the only correction
   * path is two compensating voids.
   *
   * WITH the key, a replayed call returns the ORIGINAL receipt instead of
   * posting a second payment — the same contract `voidReceiptAction` already
   * has via the gateway's `idempotency_keys` store, implemented here for the
   * web's own direct-to-tenant write path (see the guard block below).
   */
  intentKey?: string;
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

  // RFC-004 C1: the key is shape-checked at the boundary so a malformed value
  // can never become a claim id. Absent ⇒ the payment still posts (every
  // pre-keyless caller keeps working, and the void path's key is equally
  // optional); PRESENT-BUT-WRONG ⇒ refused, exactly as the gateway's
  // `requireIdempotencyKey` refuses a malformed header rather than posting an
  // unguarded mutation and pretending it was protected.
  const intentKey = normaliseIntentKey(options?.intentKey);
  if (options?.intentKey !== undefined && intentKey === null) {
    log.error("fee_record_payment_invalid_intent_key", "Rejected a malformed Idempotency-Key", {
      studentId,
    });
    return {
      success: false as const,
      error:
        "This payment could not be started because its safety key was invalid. Nothing was written — reopen the sheet and record it again.",
    };
  }
  // The claim records WHAT the key was spent on, so a replay that arrives with
  // a DIFFERENT payload is refused instead of being answered with another
  // payment's receipt (or, worse, being re-run as a second charge).
  const fingerprint = paymentFingerprint({
    studentId: payload.studentId,
    amountPaise: payload.amountPaise,
    receivedOn: payload.receivedOn,
    method: payload.method,
    reference: payload.reference ?? "",
  });

  // BR-SEC-04, enforced server-side and never trusting the client's own
  // `isBackdated` flag: the date decides, not the form. A payment dated before
  // today is a backdated payment and needs a verified PIN; anything else
  // passes through untouched, because requiring a PIN to pay today would be
  // friction with no security value.
  const isBackdated = payload.receivedOn < todayLocalIso();
  if (isBackdated) {
    const pin = options?.pin ?? "";
    // BR-SEC-05 + RFC pin-proof-spec-amendment §4.4: VERIFY accepts 4+ — a
    // grandfathered pre-floor PIN must reach argon2. Setup (6+) is enforced by
    // `setPinAction`/`pinFormatError`, never here.
    const pinProblem = pinVerifyFormatError(pin);
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

    // RFC-004 C1 fast path — a replayed intent is answered from the stored
    // claim and NEVER re-runs the money flow (07 §9.6 runs once per intent,
    // exactly as the gateway's `idempotencyRoute` pre-check behaves).
    //
    // It sits BEFORE the BR-M-04 balance guard on purpose. The first payment
    // already moved `students.balance_paise`, so re-reading it here would make
    // the replay of a legitimate full-balance payment fail the very
    // "amount exceeds balance due" guard the first call passed — turning the
    // fix into a second defect.
    if (intentKey) {
      const seen = await readIntentClaim(db, { tenantId, intentKey, fingerprint });
      if (seen.kind === "replay") {
        log.audit("fee_record_payment_replayed", "Replay of a recorded payment intent", {
          studentId: payload.studentId,
          receiptNo: seen.data.receiptNo,
        });
        revalidatePath("/fees");
        return { success: true as const, data: seen.data };
      }
      if (seen.kind === "conflict") {
        return { success: false as const, error: seen.error };
      }
    }

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
    const paymentInput = {
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
    };

    // Rule 1 + Rule 7: ONE money flow (`feesFlow.recordPaymentFlow` via the ORM
    // dialect) for BOTH paths, and — when the caller sent an intent key — the
    // claim row that makes the effect replayable lands in THE SAME transaction
    // as the payment, its receipt, its ledger rows and its `sync_outbox` rows.
    // A key written outside this transaction would be worthless: a crash
    // between the two would re-double the charge on the retry, which is the
    // defect this guard exists to close.
    const outcome = await recordPaymentIdempotent(
      db,
      {
        tenantId,
        intentKey,
        fingerprint,
        studentId: payload.studentId,
        amountPaise: payload.amountPaise,
        method: payload.method,
        reference: payload.reference ?? "",
      },
      paymentInput,
    );

    if (outcome.kind === "recorded" || outcome.kind === "replayed") {
      if (outcome.kind === "replayed") {
        log.audit("fee_record_payment_replayed", "Duplicate payment intent replayed", {
          studentId: payload.studentId,
          receiptNo: outcome.data.receiptNo,
        });
      }
      revalidatePath("/fees");
      // `data` already carries the tutor's own `method`/`reference` echo, so a
      // replay hands back EXACTLY what the first call returned.
      return { success: true as const, data: outcome.data };
    }
    // A key already spent on a DIFFERENT payment: refused in words (Rule 9),
    // because replaying it would hand the tutor a stranger's receipt number and
    // re-running it would charge twice.
    if (outcome.kind === "conflict") {
      log.audit("fee_record_payment_intent_reused", "Intent key reused for a different payment", {
        studentId: payload.studentId,
        amountPaise: payload.amountPaise,
      });
      return { success: false as const, error: outcome.error };
    }
    throw outcome.error;
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

// ---------------------------------------------------------------------------
// RFC-004 C1 — the payment path's idempotency guard.
//
// WHY IT LIVES HERE AND NOT IN THE GATEWAY. `voidReceiptAction` dedupes
// through `apps/gateway/lib/idempotency.ts` + the `idempotency_keys` DDL
// (gateway `PRIMARY KEY (tenant_id, route, "key")`, RFC-004 C1). A PAYMENT
// cannot: `recordPaymentPrisma` writes straight to the tenant's own libSQL DB
// through the ORM dialect, because the money flow must run in the same
// transaction as the receipt, the ledger rows and their `sync_outbox` rows
// (Rule 7 / 07 §9.6). The web has no route to that store — and AGENTS.md §3.4
// forbids it writing raw SQL to reach one.
//
// WHERE THE CLAIM LIVES. `audit_log.id` is the only per-row uniqueness the
// tenant schema already enforces, and `audit_log` is already the table every
// audited mutation must write to (Rule 7 / BR-SEC-03), so the claim row is
// ALSO a legitimate audit record: "this intent key was spent, on this payment,
// here is its receipt". `AppState` was considered and rejected — it is a
// fixed-column singleton per tenant (`tenant_id` is its `@id`), not a k/v
// store, so there is nowhere in it to put a key without clobbering real state
// such as `last_backup_at`.
//
// THE CLAIM ID IS TENANT-QUALIFIED (`<tenantId>:<intentKey>`). `audit_log`'s
// primary key is the row id alone, so a bare client UUID would let two tenants
// collide on one id — tenant B's legitimate payment refused as a replay of
// tenant A's key, the exact shadowing RFC-004 C1 forbids ("the same UUID from
// two tenants never collides"). Qualifying it makes the DB-level guarantee
// match the documented scope, and the tenant-bound proxy scopes every read and
// write on top of that.
//
// NO TTL, DELIBERATELY. The gateway expires a key after 24h, so a day-old
// replay re-posts there. A payment must not: "retry" is a button a tutor taps
// on the next morning too, and re-posting a settled payment a day later is the
// double-credit this guard exists to prevent. The rows are one small
// append-only audit row per payment — the same order of magnitude as the
// audit trail the payment already writes.
// ---------------------------------------------------------------------------

/** RFC-004 C1 — the same shape the gateway accepts: any well-formed UUID. */
const INTENT_KEY_SHAPE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `audit_log.action` for a spent intent key. */
const PAYMENT_INTENT_ACTION = "payment_intent_spent";

/** `audit_log.ref_type` for a spent intent key. */
const PAYMENT_INTENT_REF_TYPE = "payment_intent";

/** Bumped only if the stored envelope's SHAPE changes (never its money). */
const PAYMENT_INTENT_VERSION = 1;

/** Separator between the tenant and the key in the claim's primary key. */
const INTENT_CLAIM_SEPARATOR = ":";

/**
 * Tutor-facing refusal for a key already spent on a different payment. Product
 * copy, not an internal code (Rule 9: this string reaches the toast).
 */
const INTENT_KEY_REUSED_MESSAGE =
  "That payment was already recorded with a different amount. Nothing was written — close the sheet and record the payment again.";

/** The tenant handle this action writes through (`createLibsqlProxy`). */
type TenantDb = Awaited<ReturnType<typeof getAuthenticatedPrisma>>["db"];

/**
 * The exact response body the action returned, as the replay must reproduce it
 * (the gateway stores `{code, body}` and replays the STORED bytes — this is the
 * same contract on this side of the boundary).
 */
const StoredPaymentDataSchema = z.object({
  entryIds: z.array(z.string().min(1)),
  applied: z.array(
    z.object({
      invoiceId: z.string().min(1),
      number: z.string().min(1),
      paise: z.number().int(),
      status: z.enum(["unpaid", "partial", "paid"]),
    }),
  ),
  autoInvoiceId: z.string().nullable(),
  autoInvoiceNumber: z.string().nullable(),
  receiptId: z.string().min(1),
  receiptNo: z.string().min(1),
  creditedPaise: z.number().int(),
  method: PaymentMethodSchema,
  reference: z.string(),
});

type StoredPaymentData = z.infer<typeof StoredPaymentDataSchema>;

/** The stored claim envelope. Parsed on every replay — never trusted raw. */
const StoredIntentClaimSchema = z.object({
  v: z.literal(PAYMENT_INTENT_VERSION),
  intentKey: z.string().min(1),
  fingerprint: z.string().min(1),
  studentId: z.string().min(1),
  amountPaise: z.number().int(),
  data: StoredPaymentDataSchema,
});

type StoredIntentClaim = z.infer<typeof StoredIntentClaimSchema>;

/** What the caller asked for, and the key that identifies the attempt. */
interface PaymentIntentClaim {
  tenantId: string;
  /** null = a caller that sent no key (a pre-C1 caller). No claim is written. */
  intentKey: string | null;
  fingerprint: string;
  studentId: string;
  amountPaise: number;
  method: PaymentMethod;
  reference: string;
}

type PaymentOutcome =
  /** Committed here. */
  | { kind: "recorded"; data: StoredPaymentData }
  /** Already committed by an earlier or concurrent call with this key. */
  | { kind: "replayed"; data: StoredPaymentData }
  /** The key was spent on a DIFFERENT payment — refused in words. */
  | { kind: "conflict"; error: string }
  /** The money flow itself failed; nothing was written. */
  | { kind: "failed"; error: Error };

type IntentLookup =
  | { kind: "fresh" }
  | { kind: "replay"; data: StoredPaymentData }
  | { kind: "conflict"; error: string };

/** A present, well-formed UUID, or null (absent ⇒ the caller gets no guard). */
function normaliseIntentKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return INTENT_KEY_SHAPE_RE.test(trimmed) ? trimmed : null;
}

/** The claim's tenant-scoped primary key. */
function intentClaimId(tenantId: string, intentKey: string): string {
  return `${tenantId}${INTENT_CLAIM_SEPARATOR}${intentKey}`;
}

/**
 * What the key was spent ON, as a short stable digest. Reuse of one key for a
 * different payment is a client bug or a hostile reuse, and both must be
 * refused rather than answered with someone else's receipt.
 *
 * Covers the money-bearing fields only (student, paise, date, method,
 * reference) — `description` and the advance acknowledgement are tutor-facing
 * labels, not the identity of the charge, and a replay that differs only in
 * wording is still the same payment. `hash64Hex` is the same 64-bit dual-lane
 * FNV-1a `intentKeyFrom` uses, so there is no third hash in the repo.
 */
function paymentFingerprint(fields: {
  studentId: string;
  amountPaise: number;
  receivedOn: string;
  method: PaymentMethod;
  reference: string;
}): string {
  return hash64Hex(
    JSON.stringify([
      fields.studentId,
      fields.amountPaise,
      fields.receivedOn,
      fields.method,
      fields.reference,
    ]),
  );
}

/**
 * True when `error` is the primary-key violation on the claim row — i.e. a
 * concurrent call committed this same key first. Two deliberate tightenings
 * over the gateway's looser `isIdempotencyKeyConflict`:
 *
 *  - the TABLE name must appear, so the money flow's own constraint failures
 *    (`receipts UNIQUE(tenant_id, number)`) are never mistaken for a replay;
 *  - only a UNIQUENESS violation counts. A `CHECK`, `NOT NULL` or `FOREIGN KEY`
 *    failure on the claim row is a genuine failure of THIS call, not evidence
 *    that somebody else won the race — treating it as a replay would invent a
 *    receipt that no transaction ever wrote (Rule 9).
 */
function isIntentClaimConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /audit_log/i.test(message) &&
    /unique constraint failed|primary key|unique violation/i.test(message) &&
    !/check constraint failed|not null constraint failed|foreign key/i.test(message)
  );
}

/**
 * Read + validate the stored claim. Rule 9: a claim that cannot be parsed is a
 * LOUD throw, never a silent "fresh" — treating an unreadable claim as absent
 * would re-run the payment and double the charge, which is the defect.
 */
async function readIntentClaim(
  db: TenantDb,
  claim: Pick<PaymentIntentClaim, "tenantId" | "intentKey" | "fingerprint">,
): Promise<IntentLookup> {
  const intentKey = claim.intentKey;
  // SAFETY: the caller only reaches here with a normalised non-null key (both
  // entry points below are guarded by `intentKey !== null`).
  const key = intentKey as string;
  const row = await db.auditLog.findFirst({
    where: { id: intentClaimId(claim.tenantId, key), action: PAYMENT_INTENT_ACTION },
  });
  if (!row) return { kind: "fresh" };
  const stored = parseStoredIntentClaim(row.metadata);
  if (stored.fingerprint !== claim.fingerprint) {
    return { kind: "conflict", error: INTENT_KEY_REUSED_MESSAGE };
  }
  return { kind: "replay", data: stored.data };
}

/** Parse the claim envelope, or throw a typed, loggable error. */
function parseStoredIntentClaim(raw: unknown): StoredIntentClaim {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(
      "INTENT_CLAIM_CORRUPT: the stored payment intent record has no metadata (Rule 9: refusing to re-run the payment).",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error(
      "INTENT_CLAIM_CORRUPT: the stored payment intent record is not JSON (Rule 9: refusing to re-run the payment).",
    );
  }
  const parsed = StoredIntentClaimSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(
      `INTENT_CLAIM_CORRUPT: ${parsed.error.message.slice(0, 200)} (Rule 9: refusing to re-run the payment).`,
    );
  }
  return parsed.data;
}

/**
 * Record the payment exactly once for this intent.
 *
 * The claim row is written by wrapping the flow's OWN transaction rather than
 * by opening a second one: the ORM shim refuses a nested `$transaction`
 * (`ORM_TX_UNSUPPORTED_HANDLE`, libsql-proxy.ts:966) and `recordPaymentPrisma`
 * opens exactly one, so this adapter opens that one and inserts the claim
 * inside it. Same transaction ⇒ Rule 7 holds by construction, and a rollback
 * (including the duplicate-key rollback) leaves neither the payment nor the key.
 */
async function recordPaymentIdempotent(
  db: TenantDb,
  claim: PaymentIntentClaim,
  input: RecordPaymentInput,
): Promise<PaymentOutcome> {
  if (claim.intentKey === null) {
    const posted = await recordPaymentPrisma(db, input);
    if (!posted.ok) return { kind: "failed", error: posted.error };
    return {
      kind: "recorded",
      data: { ...posted.value, method: claim.method, reference: claim.reference },
    };
  }

  const intentKey = claim.intentKey;
  const guarded: OrmWriteClient = {
    $transaction: async <T>(fn: (tx: OrmTx) => Promise<T>): Promise<T> =>
      db.$transaction(async (tx) => {
        const value = await fn(tx);
        await tx.auditLog.create({
          data: {
            id: intentClaimId(claim.tenantId, intentKey),
            tenantId: claim.tenantId,
            actor: FEE_AUDIT_ACTOR,
            action: PAYMENT_INTENT_ACTION,
            refType: PAYMENT_INTENT_REF_TYPE,
            refId: intentKey,
            metadata: JSON.stringify({
              v: PAYMENT_INTENT_VERSION,
              intentKey,
              fingerprint: claim.fingerprint,
              studentId: claim.studentId,
              amountPaise: claim.amountPaise,
              data: {
                ...value,
                method: claim.method,
                reference: claim.reference,
              },
            }),
            createdAt: new Date().toISOString(),
          },
        });
        return value;
      }),
  };

  const posted = await recordPaymentPrisma(guarded, input);
  if (posted.ok) {
    return {
      kind: "recorded",
      data: { ...posted.value, method: claim.method, reference: claim.reference },
    };
  }
  if (!isIntentClaimConflict(posted.error)) {
    return { kind: "failed", error: posted.error };
  }
  // The duplicate claim INSERT aborted THIS transaction, so the payment, its
  // receipt, its ledger rows and its outbox rows are all rolled back with it
  // (nothing was charged), and a concurrent identical intent committed first.
  // Replay the winner — the gateway's `replayIfDuplicate`. A conflict with NO
  // winner row is a loud throw, never an invented receipt (Rule 9).
  const winner = await readIntentClaim(db, claim);
  if (winner.kind === "fresh") {
    throw new Error(
      "INTENT_CLAIM_CONFLICT_WITHOUT_WINNER: this intent key reported as already recorded but no stored claim exists (Rule 9: refusing to invent a receipt).",
    );
  }
  if (winner.kind === "conflict") {
    return { kind: "conflict", error: winner.error };
  }
  return { kind: "replayed", data: winner.data };
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
  // VERIFY floor is 4 (grandfathered pre-BR-SEC-05 PINs reach argon2); setup
  // stays 6+ via `pinFormatError`/`setPinAction`.
  const pinProblem = pinVerifyFormatError(parsed.data.pin);
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
