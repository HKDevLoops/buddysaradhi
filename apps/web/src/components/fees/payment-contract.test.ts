// Implements: 07_Fees_and_Payments.md §6.4 + §9.6 + §9.10 + §10.1/§10.4;
// 12_Business_Rules.md BR-M-01, BR-FEE-04/05/15, BR-LED-04/05, BR-RC-01,
// BR-SEC-04; 14_Edge_Cases.md EC-F-01/EC-F-02/EC-F-08/EC-F-15/EC-L-07;
// RFC-003 workstream B gates (new tests for every touched mutation path).
//
// Pure contract tests — no DB, no mocks. The action-level tests
// (fees-actions.test.ts) cover the same schemas through the real server
// action + real core transaction.
import { describe, it, expect } from "vitest";
import {
  PAYMENT_METHODS,
  PaymentMethodSchema,
  RecordPaymentPayloadSchema,
  VoidPayloadSchema,
  VoidReasonSchema,
  buildLedgerDescription,
  classifyStatusAfter,
  formatSequenceNumber,
  isBackdated,
  isSequenceMonotonic,
  rupeesStringToPaise,
  splitPaymentPreview,
  validateReferenceForMethod,
} from "./payment-contract";

describe("PaymentMethodSchema (07 §7 — strict enum end-to-end)", () => {
  it("accepts all six methods", () => {
    for (const m of PAYMENT_METHODS) {
      expect(PaymentMethodSchema.safeParse(m).success).toBe(true);
    }
  });

  it("rejects the gateway's loose free-string set (parity gap)", () => {
    // apps/gateway/routes/ledger.ts:61 accepts ANY ≤32-char string. The web
    // boundary must not.
    for (const bad of ["bitcoin", "UPI", "Cash", " ", "cash "]) {
      expect(PaymentMethodSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("rupeesStringToPaise (BR-M-01 — never float)", () => {
  it("parses exact decimals without float dust", () => {
    expect(rupeesStringToPaise("12.99")).toBe(1299);
    expect(rupeesStringToPaise("1500")).toBe(150000);
    expect(rupeesStringToPaise("0.01")).toBe(1);
    expect(rupeesStringToPaise("10000000")).toBe(1000000000);
  });

  it("avoids the classic 0.1+0.2 dust (Number(x)*100 would drift)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 → Math.round guards it, string math
    // never sees it.
    expect(rupeesStringToPaise("0.30")).toBe(30);
    expect(rupeesStringToPaise("1255.55")).toBe(125555);
  });

  it("rejects rather than truncates or rounds", () => {
    expect(rupeesStringToPaise("")).toBeNull();
    expect(rupeesStringToPaise("abc")).toBeNull();
    expect(rupeesStringToPaise("-5")).toBeNull();
    expect(rupeesStringToPaise("0")).toBeNull();
    expect(rupeesStringToPaise("0.00")).toBeNull();
    expect(rupeesStringToPaise("12.999")).toBeNull();
    expect(rupeesStringToPaise("10000000.01")).toBeNull();
    expect(rupeesStringToPaise("1e3")).toBeNull();
  });
});

describe("validateReferenceForMethod (07 §6.4, amended: optional for all)", () => {
  it("cash/card/other keep reference optional", () => {
    expect(validateReferenceForMethod("cash", "")).toBeNull();
    expect(validateReferenceForMethod("card", "last4 1234")).toBeNull();
    expect(validateReferenceForMethod("other", "")).toBeNull();
  });

  it("empty reference is valid for upi/bank/cheque, provided values still patterned", () => {
    expect(validateReferenceForMethod("upi", "")).toBeNull();
    expect(validateReferenceForMethod("bank", "")).toBeNull();
    expect(validateReferenceForMethod("cheque", "")).toBeNull();
    expect(validateReferenceForMethod("upi", "AXISBK123456789")).toBeNull();
    expect(validateReferenceForMethod("bank", "short")).not.toBeNull();
    expect(validateReferenceForMethod("cheque", "12345")).not.toBeNull();
    expect(validateReferenceForMethod("cheque", "482913")).toBeNull();
  });
});

describe("splitPaymentPreview (EC-F-02 — exact + ADVANCE)", () => {
  it("splits overpayment into exact + advance with chip flag", () => {
    const split = splitPaymentPreview(450000, 500000);
    expect(split.appliedPaise).toBe(450000);
    expect(split.advancePaise).toBe(50000);
    expect(split.isAdvance).toBe(true);
    expect(split.balanceAfterPaise).toBe(-50000);
  });

  it("exact payment leaves no advance", () => {
    const split = splitPaymentPreview(300000, 300000);
    expect(split.advancePaise).toBe(0);
    expect(split.isAdvance).toBe(false);
    expect(split.statusAfter).toBe("paid");
  });

  it("partial payment classifies partial", () => {
    const split = splitPaymentPreview(300000, 150000);
    expect(split.statusAfter).toBe("partial");
    expect(split.balanceAfterPaise).toBe(150000);
  });
});

describe("classifyStatusAfter (BR-FEE-05 — 1-paise tolerance)", () => {
  it("treats ±1 paise as paid in full", () => {
    expect(classifyStatusAfter(1, 300000)).toBe("paid");
    expect(classifyStatusAfter(-1, 300000)).toBe("paid");
    expect(classifyStatusAfter(0, 300000)).toBe("paid");
    expect(classifyStatusAfter(2, 300000)).toBe("partial");
  });
});

describe("formatSequenceNumber + isSequenceMonotonic (BR-RC-01)", () => {
  it("zero-pads to 6 digits", () => {
    expect(formatSequenceNumber("RCP-", 42)).toBe("RCP-000042");
    expect(formatSequenceNumber("INV-", 1000000)).toBe("INV-1000000");
  });

  it("never moves backwards — voids consume, never decrement (EC-L-07)", () => {
    expect(isSequenceMonotonic(42, 43)).toBe(true);
    expect(isSequenceMonotonic(42, 42)).toBe(true);
    expect(isSequenceMonotonic(43, 42)).toBe(false);
  });
});

describe("isBackdated (BR-LED-07 — >3 days gates PIN)", () => {
  it("flags only genuinely old receipts", () => {
    expect(isBackdated("2026-09-28", "2026-10-02")).toBe(true);
    expect(isBackdated("2026-09-29", "2026-10-02")).toBe(false);
    expect(isBackdated("2026-10-02", "2026-10-02")).toBe(false);
    expect(isBackdated("not-a-date", "2026-10-02")).toBe(false);
  });
});

describe("VoidReasonSchema (07 §9.10 + BR-LED-04 — typed reason)", () => {
  it("requires a meaningful reason", () => {
    expect(VoidReasonSchema.safeParse("").success).toBe(false);
    expect(VoidReasonSchema.safeParse("oops").success).toBe(false);
    expect(
      VoidReasonSchema.safeParse("Wrong student — should be Ananya STU-0011").success
    ).toBe(true);
  });
});

describe("VoidPayloadSchema (void-reason-required + PIN presence)", () => {
  const entryId = "11111111-1111-4111-8111-111111111111";
  it("rejects missing reason, missing PIN, bad id", () => {
    expect(
      VoidPayloadSchema.safeParse({ entryId, reason: "", pin: "123456" }).success
    ).toBe(false);
    expect(
      VoidPayloadSchema.safeParse({ entryId, reason: "Wrong student entry", pin: "" }).success
    ).toBe(false);
    expect(
      VoidPayloadSchema.safeParse({ entryId: "nope", reason: "Wrong student entry", pin: "123456" }).success
    ).toBe(false);
  });
});

describe("RecordPaymentPayloadSchema (receipt-before-post pass-through)", () => {
  const studentId = "22222222-2222-4222-8222-222222222222";
  it("accepts a full previewed payload and echoes it back byte-identical", () => {
    const preview = {
      studentId,
      amountPaise: 150000,
      method: "upi" as const,
      reference: "AXISBK123456789",
      description: "Tuition Fee Payment",
      receivedOn: "2026-10-02",
      advanceAcknowledged: false,
    };
    const parsed = RecordPaymentPayloadSchema.safeParse(preview);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ ...preview });
  });

  it("rejects non-enum method, float paise, bad date — but accepts empty reference", () => {
    const base = {
      studentId,
      amountPaise: 150000,
      method: "upi" as const,
      reference: "",
      description: "Tuition",
      receivedOn: "2026-10-02",
      advanceAcknowledged: false,
    };
    // SAFETY: intentionally invalid payloads — the schema must reject them.
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, method: "bitcoin" }).success
    ).toBe(false);
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, amountPaise: 1500.5 }).success
    ).toBe(false);
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, receivedOn: "02/10/2026" }).success
    ).toBe(false);
    // Amended 07 §6.4: reference is optional for every method (malformed
    // values still rejected — see validateReferenceForMethod suite above).
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, method: "upi", reference: "" }).success
    ).toBe(true);
    expect(
      RecordPaymentPayloadSchema.safeParse({ ...base, method: "cheque", reference: "abc" }).success
    ).toBe(false);
  });
});

describe("buildLedgerDescription (deterministic enrichment)", () => {
  it("tags method + reference without touching the prose", () => {
    expect(buildLedgerDescription("upi", "AXISBK1", "Tuition Fee Payment")).toBe(
      "[upi · AXISBK1] Tuition Fee Payment"
    );
    expect(buildLedgerDescription("cash", "", "Tuition")).toBe("[cash] Tuition");
  });
});
