// Implements: 07_Fees_and_Payments.md §6.3 (VOID rows strike the ORIGINAL, not
// themselves), §6.4 (live receipt preview), §9.1/§9.4 (balances derived in
// integer paise), §9.6/§9.7/§9.10 (receipt-before-post, monotonic sequences,
// void with reason + PIN), §10.1 BR-M-01/BR-M-02 (integer paise; every displayed
// amount through `formatINR`), §10.2 BR-LED-01/03/04/09 (the seven entry types;
// a reversing row; a void needs a new row; a charge with credits cannot be
// voided), §10.4 BR-RC-01 (monotonic, never-reused numbers); 12_Business_Rules.md
// BR-M-01, BR-M-02, BR-M-04 (a negative balance is CREDIT, in emerald, never
// red), BR-FEE-01, BR-FEE-05, BR-LED-02/03/04/09, BR-RC-01;
// 14_Edge_Cases.md EC-F-02/EC-F-05/EC-F-08/EC-L-02/EC-L-07/EC-L-08;
// AGENTS.md §2 Rule 1 (append-only), Rule 4 (no new screen), Rule 6 (paise),
// Rule 7 (outbox + audit), Rule 9 (no silent failure), Rule 10 (colour is never
// the only signal).
//
// What this file is for. The Fees audit (2026-10-05) changed money behaviour in
// three places — the preview classifier, the gateway's void guards, and the
// gateway's ledger read — and every claim below is a claim a tutor's books
// depend on. They are grouped by the defect they close so a future change that
// undoes one fails here by name.
//
// Boundary strategy (AGENTS §7.3 — never mock the ledger):
//   · `payment-contract` is PURE, so its tests are pure: exact integer-paise
//     assertions, no DB, no doubles.
//   · The gateway read/void guards are NOT unit-testable from `apps/web` —
//     `apps/gateway` is a Deno module graph. The regression tests for them
//     belong in `apps/gateway/__tests__/`; the exact cases to paste are in the
//     hand-off report to the lead, and the assertions are stated here as
//     executable pseudo-specs so the intent cannot drift.
//   · §9.6 receipt-before-post cannot be proven GREEN until `packages/core`
//     creates the receipt: `grep -rn "receipts\|next_receipt_seq" packages/core
//     /src` returns nothing, so `recordPaymentFlow` posts ledger rows and no
//     receipt, and never consumes the receipt sequence. That is a P0 owned by
//     `packages/core` (not this lane). The one `it.fails` case below pins the
//     spec invariant so the day it lands the suite flips loudly in the opposite
//     direction.

import { describe, it, expect } from "vitest";
import {
  classifyStatusAfter,
  rupeesStringToPaise,
  splitPaymentPreview,
  formatSequenceNumber,
  isSequenceMonotonic,
  isBackdated,
  validateReferenceForMethod,
  buildLedgerDescription,
  RecordPaymentPayloadSchema,
  VoidPayloadSchema,
  MAX_PAISE_PER_ENTRY,
  PAID_IN_FULL_TOLERANCE_PAISE,
} from "./payment-contract";

const STUDENT = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// 1. splitPaymentPreview — the preview may never claim a negative application.
// ---------------------------------------------------------------------------

describe("splitPaymentPreview — appliedPaise is never negative (EC-F-08, BR-FEE-04)", () => {
  it("splits a normal overpayment: exact to the invoice, surplus to advance", () => {
    const s = splitPaymentPreview(450000, 500000);
    expect(s.appliedPaise).toBe(450000);
    expect(s.advancePaise).toBe(50000);
    expect(s.isAdvance).toBe(true);
    expect(s.balanceAfterPaise).toBe(-50000);
    expect(s.statusAfter).toBe("partial");
  });

  it("a student already IN CREDIT has nothing to apply — applied is 0, whole amount is advance", () => {
    // The defect: `Math.min(-200, 50000)` produced `appliedPaise: -200`, a
    // negative amount "applied to an invoice" that no invoice can carry, while
    // `advancePaise` double-counted the credit.
    const s = splitPaymentPreview(-20000, 50000);
    expect(s.appliedPaise).toBe(0);
    expect(s.advancePaise).toBe(50000);
    expect(s.balanceAfterPaise).toBe(-70000);
    expect(s.isAdvance).toBe(true);
  });

  it("a payment against a ZERO balance applies nothing and is entirely advance", () => {
    const s = splitPaymentPreview(0, 50000);
    expect(s.appliedPaise).toBe(0);
    expect(s.advancePaise).toBe(50000);
    expect(s.balanceAfterPaise).toBe(-50000);
    expect(s.isAdvance).toBe(true);
  });

  it("conserves every paise: applied + advance === amount, for every balance sign", () => {
    // The fail-closed invariant from `feesFlow.ts` (`creditedPaise !==
    // amountPaise` throws) has to hold in the PREVIEW too, or the sheet shows a
    // split the server will refuse.
    for (const balance of [0, 1, -1, 300000, -20000, 1, 999999999]) {
      for (const amount of [1, 150000, 500000, 300000]) {
        const s = splitPaymentPreview(balance, amount);
        expect(s.appliedPaise + s.advancePaise, `balance=${balance} amount=${amount}`).toBe(amount);
        expect(s.appliedPaise).toBeGreaterThanOrEqual(0);
        expect(s.advancePaise).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("an exact settlement leaves nothing over", () => {
    const s = splitPaymentPreview(300000, 300000);
    expect(s.appliedPaise).toBe(300000);
    expect(s.advancePaise).toBe(0);
    expect(s.isAdvance).toBe(false);
    expect(s.balanceAfterPaise).toBe(0);
    expect(s.statusAfter).toBe("paid");
  });

  it("a part payment is partial and keeps the remainder as the balance due", () => {
    const s = splitPaymentPreview(300000, 150000);
    expect(s.appliedPaise).toBe(150000);
    expect(s.advancePaise).toBe(0);
    expect(s.balanceAfterPaise).toBe(150000);
    expect(s.statusAfter).toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// 2. classifyStatusAfter — the status word must not contradict the amounts
//    printed beside it. This was "partial" for a payment into a credit.
// ---------------------------------------------------------------------------

describe("classifyStatusAfter — derived from what was OWED, not from what moved", () => {
  it("nothing owed before, nothing owed after → paid (not partial)", () => {
    // The false claim on screen: a ₹500 payment against a ₹0 balance previewed
    // "Balance −₹500 · ◐ Partial". There is no invoice to be part-way through.
    expect(classifyStatusAfter(-50000, 0)).toBe("paid");
    expect(classifyStatusAfter(-50000, 1)).toBe("paid");
    expect(classifyStatusAfter(-50000, PAID_IN_FULL_TOLERANCE_PAISE)).toBe("paid");
  });

  it("already in credit before → paid; the money is held, not part-paid", () => {
    expect(classifyStatusAfter(-70000, -20000)).toBe("paid");
  });

  it("something owed, fully settled → paid (BR-FEE-05 tolerance)", () => {
    expect(classifyStatusAfter(0, 300000)).toBe("paid");
    expect(classifyStatusAfter(1, 300000)).toBe("paid");
    expect(classifyStatusAfter(-1, 300000)).toBe("paid");
  });

  it("something owed, partly settled → partial", () => {
    expect(classifyStatusAfter(150000, 300000)).toBe("partial");
    expect(classifyStatusAfter(2, 300000)).toBe("partial");
  });

  it("never reports unpaid from this path — a payment was made", () => {
    // The flow's own recompute can only reach "unpaid" from a zero-credit
    // invoice; this preview is only ever asked about a payment.
    for (const after of [-70000, -1, 0, 1, 2, 150000]) {
      for (const before of [-20000, 0, 1, 300000]) {
        expect(classifyStatusAfter(after, before)).not.toBe("unpaid");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. rupeesStringToPaise — half-rupees are money; sub-paise input is refused,
//    never truncated. (EC-F-01 / BR-M-01.)
// ---------------------------------------------------------------------------

describe("rupeesStringToPaise — paise, never floats, never truncation", () => {
  it("accepts a half rupee exactly (no rounding needed, so nothing is lost)", () => {
    expect(rupeesStringToPaise("1500.5")).toBe(150050);
    expect(rupeesStringToPaise("1500.50")).toBe(150050);
    expect(rupeesStringToPaise("0.1")).toBe(10);
    expect(rupeesStringToPaise("0.01")).toBe(1);
    expect(rupeesStringToPaise("12.99")).toBe(1299);
    expect(rupeesStringToPaise("1255.55")).toBe(125555);
  });

  it("REFUSES sub-paise precision instead of truncating or rounding it away", () => {
    // "truncate" would make ₹1,500.555 a ₹1,500 payment nobody authorised.
    expect(rupeesStringToPaise("1500.555")).toBeNull();
    expect(rupeesStringToPaise("1500.005")).toBeNull();
  });

  it("refuses zero, negative, non-numeric, exponent and over-cap input", () => {
    expect(rupeesStringToPaise("0")).toBeNull();
    expect(rupeesStringToPaise("0.00")).toBeNull();
    expect(rupeesStringToPaise("-1")).toBeNull();
    expect(rupeesStringToPaise("")).toBeNull();
    expect(rupeesStringToPaise("abc")).toBeNull();
    expect(rupeesStringToPaise("1e3")).toBeNull();
    expect(rupeesStringToPaise("1,500")).toBeNull();
    expect(rupeesStringToPaise("10000000.01")).toBeNull();
  });

  it("the per-entry cap is EC-F-15's ₹1 crore in paise and is exactly reachable", () => {
    expect(MAX_PAISE_PER_ENTRY).toBe(1000000000);
    expect(rupeesStringToPaise("10000000")).toBe(1000000000);
    expect(rupeesStringToPaise("10000000.01")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Sequences — BR-RC-01 / EC-L-07 / EC-L-08. A void CONSUMES a number; it
//    never returns one. The pair below is the record → void → record test in
//    its pure form: the second number is strictly higher, and the gap is the
//    voided one.
// ---------------------------------------------------------------------------

describe("BR-RC-01 — receipt numbers are consumed, never returned", () => {
  it("record → void → record produces two DIFFERENT, ASCENDING numbers", () => {
    // seq 42 is issued, then voided, then the next payment takes 43.
    const first = formatSequenceNumber("RCP-", 42);
    const voided = first; // a void does not un-issue it
    const second = formatSequenceNumber("RCP-", 43);
    expect(voided).toBe("RCP-000042");
    expect(second).toBe("RCP-000043");
    expect(second).not.toBe(first);
    expect(isSequenceMonotonic(42, 43)).toBe(true);
  });

  it("zero-pads to 6 digits and never reuses a consumed value", () => {
    expect(formatSequenceNumber("RCP-", 1)).toBe("RCP-000001");
    expect(formatSequenceNumber("RCP-", 999999)).toBe("RCP-999999");
    expect(formatSequenceNumber("INV-", 42)).toBe("INV-000042");
  });

  it("a sequence never moves backwards", () => {
    expect(isSequenceMonotonic(43, 42)).toBe(false);
    expect(isSequenceMonotonic(42, 42)).toBe(true);
    expect(isSequenceMonotonic(0, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. The backdate gate and the optional-but-validated reference.
// ---------------------------------------------------------------------------

describe("isBackdated — BR-LED-07 / BR-SEC-04 boundary is 3 days, inclusive-safe", () => {
  it("gates anything more than 3 days old, and nothing at or inside 3 days", () => {
    expect(isBackdated("2026-10-01", "2026-10-05")).toBe(true); // 4 days
    expect(isBackdated("2026-09-30", "2026-10-05")).toBe(true); // 5 days
    expect(isBackdated("2026-10-02", "2026-10-05")).toBe(false); // 3 days
    expect(isBackdated("2026-10-03", "2026-10-05")).toBe(false); // 2 days
    expect(isBackdated("2026-10-05", "2026-10-05")).toBe(false); // today
  });

  it("an unparseable date is not silently treated as 'backdated' or 'today'", () => {
    expect(isBackdated("not-a-date", "2026-10-05")).toBe(false);
    expect(isBackdated("", "2026-10-05")).toBe(false);
  });
});

describe("reference — OPTIONAL for every method, never unvalidated (amended 07 §6.4)", () => {
  it("empty is always valid", () => {
    for (const m of ["cash", "upi", "card", "bank", "cheque", "other"] as const) {
      expect(validateReferenceForMethod(m, "")).toBeNull();
      expect(validateReferenceForMethod(m, "   ")).toBeNull();
    }
  });

  it("a PROVIDED value is still checked against its method's pattern", () => {
    expect(validateReferenceForMethod("upi", "AXISBK123456789")).toBeNull();
    expect(validateReferenceForMethod("cheque", "482913")).toBeNull();
    expect(validateReferenceForMethod("cheque", "48291")).not.toBeNull();
    expect(validateReferenceForMethod("cheque", "4829131")).not.toBeNull();
    expect(validateReferenceForMethod("upi", "short")).not.toBeNull();
    expect(validateReferenceForMethod("upi", "way-too-long-utr-value-here")).not.toBeNull();
  });

  it("free-text methods cap length rather than pattern-matching", () => {
    expect(validateReferenceForMethod("cash", "coins in a jar")).toBeNull();
    expect(validateReferenceForMethod("cash", "x".repeat(33))).not.toBeNull();
  });

  it("the enrichment preserves the reference verbatim, and omits it when absent", () => {
    expect(buildLedgerDescription("upi", "AXISBK123456789", "Tuition Fee Payment")).toBe(
      "[upi · AXISBK123456789] Tuition Fee Payment"
    );
    expect(buildLedgerDescription("cash", "", "Tuition Fee Payment")).toBe(
      "[cash] Tuition Fee Payment"
    );
  });
});

// ---------------------------------------------------------------------------
// 6. The action boundary: what the server accepts, so the preview can never
//    promise something the action rejects (or the reverse).
// ---------------------------------------------------------------------------

describe("RecordPaymentPayloadSchema — the preview's payload IS the posted payload", () => {
  const base = {
    studentId: STUDENT,
    amountPaise: 150000,
    method: "upi" as const,
    reference: "",
    description: "Tuition Fee Payment",
    receivedOn: "2026-10-05",
    advanceAcknowledged: false,
  };

  it("accepts the exact previewed payload and returns it unchanged", () => {
    const parsed = RecordPaymentPayloadSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ ...base });
  });

  it("refuses float paise, a non-enum method and a non-ISO date", () => {
    // SAFETY: intentionally invalid — the boundary must reject each.
    expect(RecordPaymentPayloadSchema.safeParse({ ...base, amountPaise: 1500.5 }).success).toBe(false);
    expect(RecordPaymentPayloadSchema.safeParse({ ...base, amountPaise: 0 }).success).toBe(false);
    expect(RecordPaymentPayloadSchema.safeParse({ ...base, amountPaise: -1 }).success).toBe(false);
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, method: "bitcoin" }).success
    ).toBe(false);
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, receivedOn: "05/10/2026" }).success
    ).toBe(false);
  });

  it("refuses a malformed reference but accepts an absent one", () => {
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, method: "cheque", reference: "abc" }).success
    ).toBe(false);
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, method: "cheque", reference: "" }).success
    ).toBe(true);
  });
});

describe("VoidPayloadSchema — a void needs a reason AND a PIN (BR-LED-04, BR-SEC-04)", () => {
  const entryId = "44444444-4444-4444-8444-444444444444";
  const reason = "Wrong student — should be Ananya STU-0011";

  it("accepts a complete void request", () => {
    expect(VoidPayloadSchema.safeParse({ entryId, reason, pin: "135790" }).success).toBe(true);
  });

  it("refuses without a reason, without a PIN, or with a non-uuid entry", () => {
    // SAFETY: intentionally invalid.
    expect(VoidPayloadSchema.safeParse({ entryId, reason: "", pin: "135790" }).success).toBe(false);
    expect(VoidPayloadSchema.safeParse({ entryId, reason: "oops", pin: "135790" }).success).toBe(false);
    expect(VoidPayloadSchema.safeParse({ entryId, reason, pin: "" }).success).toBe(false);
    expect(VoidPayloadSchema.safeParse({ entryId: "nope", reason, pin: "135790" }).success).toBe(false);
  });

  it("accepts a 4-digit PIN — the client must not invent a tighter bound than the server", () => {
    // `setPinAction` accepts 4–8 digits; a void dialog that required 6 locked a
    // 4-digit-PIN tutor out of the only correction path an append-only ledger
    // has. The bound lives in `pinFormatError`, once.
    expect(VoidPayloadSchema.safeParse({ entryId, reason, pin: "1357" }).success).toBe(true);
    expect(VoidPayloadSchema.safeParse({ entryId, reason, pin: "1357" }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. THE P0 THIS LANE COULD NOT FIX — now closed in packages/core, and proved
//    THERE rather than here.
//
// 07 §9.6 step 3 requires the receipt to be taken from the sequence and
// persisted BEFORE the ledger entry posts, so a crash can never leave a payment
// with no receipt or a receipt with no payment. §6.4 requires the live preview to
// show the receipt number the tutor is about to get, and §10.4 BR-RC-01 requires
// that number to be consumed from settings.next_receipt_seq.
//
// This lane originally asserted that invariant against a hardcoded
// `{ receiptNo: null }` inside `it.fails` — a placeholder that proved nothing about
// the code. `recordPaymentFlow` now calls `tx.takeReceiptNumber` and
// `tx.insertReceipt` inside the one write transaction (the port grew two methods;
// both dialects implement them). The REAL proof is
// `packages/core/src/feesDialectParity.test.ts`, which runs both dialects over the
// same schema on a fresh real database and compares the receipt row, its tamper
// hash and the consumed `next_receipt_seq` byte-for-byte. A UI-layer fake could
// never detect a dialect that issued the wrong number; that gate can.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 8. Gateway guards — the cases to run in `apps/gateway/__tests__/ledger*.test.ts`
//    once the lane that owns that directory adds them. Stated here so the intent
//    is on the record next to the change that introduced it.
//
//   a) GET /api/v1/ledger returns `isVoid: true` for the entry a later row
//      reverses, and `isVoid: false` for the reversing row itself (which is
//      identified by `reverses_entry_id` and must NOT be dimmed — it is the
//      live correcting entry BR-LED-04 exists to keep).
//   b) POST /api/v1/ledger/void on a FEE_CHARGED whose invoice carries a live
//      PAYMENT_RECEIVED → 409 `charge_has_credits`, and NO ledger row written
//      (BR-LED-09 / EC-F-06). Before the guard it succeeded and stranded the
//      credits.
//   c) Same call where the only crediting PAYMENT_RECEIVED has itself been
//      reversed → allowed (BR-LED-02's double guard; void those receipts first).
//   d) POST /api/v1/ledger/void on an entry that is already reversed → 409
//      `entry_already_voided`, and the receipt sequence is UNCHANGED (BR-RC-01:
//      a void never returns a number).
// ---------------------------------------------------------------------------