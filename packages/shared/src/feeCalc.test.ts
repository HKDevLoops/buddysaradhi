// Implements: 12_Business_Rules.md BR-CALC-09/10/11, BR-FEE-20/21/23/24/25
// (via 02_Core_Logic.md §6.9.3, 11_Data_Model.md §15.4, 14_Edge_Cases.md EC-F-18/21).
// Principle: P4 (money exactness). Rules: Rule 6 (integer paise), Rule 9 (no any,
// no console, typed throws).
import { describe, it, expect } from "vitest";
import {
  arrearsForMonth,
  arrearsForPeriod,
  arrearsForQuarter,
  arrearsForYear,
  collectedForMonth,
  collectedForPeriod,
  collectedForQuarter,
  collectedForYear,
  expectedForMonth,
  expectedForPeriod,
  expectedForQuarter,
  expectedForYear,
  monthKeysInPeriod,
  type EnrolmentRow,
  type FeeLedgerRow,
  type FeeRateRow,
} from "./feeCalc";

const RIYA = "11111111-1111-4111-8111-111111111111";
const KARAN = "22222222-2222-4222-8222-222222222222";

function rate(
  studentId: string,
  monthlyFeePaise: number,
  effectiveFrom: string,
  effectiveTo: string | null = null,
): FeeRateRow {
  return { student_id: studentId, monthly_fee_paise: monthlyFeePaise, effective_from: effectiveFrom, effective_to: effectiveTo };
}

function enrolment(
  studentId: string,
  enrolledFrom: string,
  status: EnrolmentRow["status"] = "active",
  pausedPeriods: EnrolmentRow["paused_periods"] = [],
): EnrolmentRow {
  return { student_id: studentId, status, enrolled_from: enrolledFrom, paused_periods: pausedPeriods };
}

function ledger(
  studentId: string,
  type: FeeLedgerRow["type"],
  occurredOn: string,
  opts: { credit?: number; debit?: number; voidedAt?: string | null } = {},
): FeeLedgerRow {
  return {
    student_id: studentId,
    type,
    debit_paise: opts.debit ?? 0,
    credit_paise: opts.credit ?? 0,
    occurred_on: occurredOn,
    voided_at: opts.voidedAt ?? null,
  };
}

// ── BR-CALC-09: expected uses the rate effective on month-1st ──

describe("expectedForMonth/Period (BR-CALC-09, BR-FEE-21)", () => {
  // EC-F-18: ₹1,500 Jan–Jun → ₹1,800 Jul–now; past months keep the old rate.
  const rates = [
    rate(RIYA, 150000, "2025-01-01", "2025-06-30"),
    rate(RIYA, 180000, "2025-07-01", null),
  ];
  const active = [enrolment(RIYA, "2025-01-01")];

  it.each([
    ["2025-01", 150000],
    ["2025-06", 150000],
    ["2025-07", 180000],
    ["2025-08", 180000],
  ])("rate change mid-year: %s expected = %i paise (old rate for past months)", (month, expected) => {
    expect(expectedForMonth(rates, active, RIYA, month)).toBe(expected);
  });

  it("sums each month at its own effective rate across a year", () => {
    // 6 × 150000 + 6 × 180000 = 1980000.
    expect(expectedForPeriod(rates, active, RIYA, { from: "2025-01", to: "2025-12" })).toBe(1980000);
  });

  it("quarterly = Σ 3 months at effective rates (BR-FEE-20 derived, never stored)", () => {
    expect(expectedForQuarter(rates, active, RIYA, 2025, 2)).toBe(450000);
    expect(expectedForQuarter(rates, active, RIYA, 2025, 3)).toBe(540000);
  });

  it("annual = 12 × monthly when the rate is constant (BR-FEE-24 base)", () => {
    const flat = [rate(KARAN, 150000, "2025-01-01", null)];
    const karanActive = [enrolment(KARAN, "2025-01-01")];
    expect(expectedForYear(flat, karanActive, KARAN, 2025)).toBe(1800000);
  });

  it("annual sums per-month rates when the rate changed mid-year", () => {
    expect(expectedForYear(rates, active, RIYA, 2025)).toBe(1980000);
  });

  it("effective_to boundary: old row covers June, new row covers July", () => {
    expect(expectedForMonth(rates, active, RIYA, "2025-06")).toBe(150000);
    expect(expectedForMonth(rates, active, RIYA, "2025-07")).toBe(180000);
  });

  it("month with no effective rate contributes 0", () => {
    expect(expectedForMonth([], active, RIYA, "2025-01")).toBe(0);
  });

  it("other students' rates never leak in", () => {
    expect(expectedForMonth(rates, active, KARAN, "2025-07")).toBe(0);
  });

  it("skips another student's rate rows when selecting the effective rate", () => {
    const mixed = [...rates, rate(KARAN, 99999, "2025-01-01", null)];
    const karanActive = [enrolment(KARAN, "2025-01-01")];
    expect(expectedForMonth(mixed, karanActive, KARAN, "2025-07")).toBe(99999);
    expect(expectedForMonth(mixed, active, RIYA, "2025-07")).toBe(180000);
  });

  it("latest effective_from wins when rows overlap", () => {
    const overlapping = [
      rate(RIYA, 150000, "2025-01-01", null),
      rate(RIYA, 180000, "2025-03-01", null),
    ];
    expect(expectedForMonth(overlapping, active, RIYA, "2025-04")).toBe(180000);
  });

  it("latest effective_from wins regardless of input order", () => {
    const unordered = [
      rate(RIYA, 180000, "2025-03-01", null),
      rate(RIYA, 150000, "2025-01-01", null),
    ];
    expect(expectedForMonth(unordered, active, RIYA, "2025-04")).toBe(180000);
  });

  it("february bounds honour leap and century years", () => {
    const feb29 = [ledger(RIYA, "PAYMENT_RECEIVED", "2024-02-29", { credit: 10000 })];
    expect(collectedForMonth(feb29, RIYA, "2024-02")).toBe(10000);
    const century = [ledger(RIYA, "PAYMENT_RECEIVED", "2000-02-29", { credit: 10000 })];
    expect(collectedForMonth(century, RIYA, "2000-02")).toBe(10000);
    const nonLeapCentury = [ledger(RIYA, "PAYMENT_RECEIVED", "1900-02-28", { credit: 10000 })];
    expect(collectedForMonth(nonLeapCentury, RIYA, "1900-02")).toBe(10000);
    const april = [ledger(RIYA, "PAYMENT_RECEIVED", "2025-04-30", { credit: 10000 })];
    expect(collectedForMonth(april, RIYA, "2025-04")).toBe(10000);
  });
});

// ── BR-FEE-23: paused/inactive/not-yet-enrolled months contribute 0 ──

describe("enrolment gate (BR-FEE-23, BR-CALC-09)", () => {
  const rates = [rate(RIYA, 180000, "2025-01-01", null)];

  it("paused month = 0 and resume month recovers the full rate", () => {
    // EC-S-06: Riya paused August (family trip); September resumes unchanged.
    const paused = [enrolment(RIYA, "2025-01-01", "active", [{ from: "2025-08-01", to: "2025-08-31" }])];
    expect(expectedForMonth(rates, paused, RIYA, "2025-08")).toBe(0);
    expect(expectedForMonth(rates, paused, RIYA, "2025-09")).toBe(180000);
    expect(expectedForMonth(rates, paused, RIYA, "2025-07")).toBe(180000);
  });

  it("paused August zeroes arrears for August (reminder engine stays silent)", () => {
    const paused = [enrolment(RIYA, "2025-01-01", "active", [{ from: "2025-08-01", to: "2025-08-31" }])];
    expect(arrearsForMonth(rates, paused, [], RIYA, "2025-08")).toBe(0);
  });

  it("inactive enrolment contributes 0 for every month", () => {
    const inactive = [enrolment(RIYA, "2025-01-01", "inactive")];
    expect(expectedForPeriod(rates, inactive, RIYA, { from: "2025-01", to: "2025-12" })).toBe(0);
  });

  it("not-yet-enrolled months contribute 0", () => {
    const late = [enrolment(RIYA, "2025-09-01")];
    expect(expectedForMonth(rates, late, RIYA, "2025-08")).toBe(0);
    expect(expectedForMonth(rates, late, RIYA, "2025-09")).toBe(180000);
  });

  it("no enrolment row at all contributes 0", () => {
    expect(expectedForMonth(rates, [], RIYA, "2025-09")).toBe(0);
  });

  it("status paused with no history zeroes the queried months", () => {
    const paused = [enrolment(RIYA, "2025-01-01", "paused")];
    expect(expectedForMonth(rates, paused, RIYA, "2025-09")).toBe(0);
  });
});

// ── BR-CALC-10: collected = payments − refunds, voided excluded ──

describe("collectedForPeriod (BR-CALC-10)", () => {
  it("sums PAYMENT_RECEIVED credits in range", () => {
    const entries = [
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 150000 }),
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-20", { credit: 50000 }),
    ];
    expect(collectedForPeriod(entries, RIYA, "2025-08-01", "2025-08-31")).toBe(200000);
  });

  it("refunds subtract (REFUND_ISSUED debits)", () => {
    const entries = [
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 150000 }),
      ledger(RIYA, "REFUND_ISSUED", "2025-08-10", { debit: 50000 }),
    ];
    expect(collectedForPeriod(entries, RIYA, "2025-08-01", "2025-08-31")).toBe(100000);
  });

  it("voided entries excluded (voided_at flag and VOID type)", () => {
    const entries = [
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 150000 }),
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-06", { credit: 150000, voidedAt: "2025-09-01T10:00:00Z" }),
      ledger(RIYA, "VOID", "2025-09-01", { credit: 150000 }),
    ];
    expect(collectedForPeriod(entries, RIYA, "2025-08-01", "2025-08-31")).toBe(150000);
  });

  it("occurred_on outside the range is ignored", () => {
    const entries = [ledger(RIYA, "PAYMENT_RECEIVED", "2025-07-31", { credit: 150000 })];
    expect(collectedForPeriod(entries, RIYA, "2025-08-01", "2025-08-31")).toBe(0);
  });

  it("other students' entries never leak in", () => {
    const entries = [ledger(KARAN, "PAYMENT_RECEIVED", "2025-08-05", { credit: 99999 })];
    expect(collectedForPeriod(entries, RIYA, "2025-08-01", "2025-08-31")).toBe(0);
  });

  it("FEE_CHARGED debits do not count as collected", () => {
    const entries = [ledger(RIYA, "FEE_CHARGED", "2025-08-01", { debit: 180000 })];
    expect(collectedForPeriod(entries, RIYA, "2025-08-01", "2025-08-31")).toBe(0);
  });

  it("month/quarter/year conveniences bound the date range", () => {
    const entries = [
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-07-15", { credit: 180000 }),
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 180000 }),
    ];
    expect(collectedForMonth(entries, RIYA, "2025-08")).toBe(180000);
    expect(collectedForQuarter(entries, RIYA, 2025, 3)).toBe(360000);
    expect(collectedForYear(entries, RIYA, 2025)).toBe(360000);
  });
});

// ── BR-CALC-11: arrears = expected − collected − discounts; never clamped ──

describe("arrearsForPeriod (BR-CALC-11, BR-M-04)", () => {
  const rates = [rate(RIYA, 180000, "2025-01-01", null)];
  const active = [enrolment(RIYA, "2025-01-01")];

  it("discount credits subtract (EC-F-21 annual-discount shape)", () => {
    // EC-F-21: expected 2400000-scale logic at month grain — 180000 − 150000 − 20000.
    const entries = [
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 150000 }),
      ledger(RIYA, "DISCOUNT_GRANTED", "2025-08-05", { credit: 20000 }),
    ];
    expect(arrearsForMonth(rates, active, entries, RIYA, "2025-08")).toBe(10000);
  });

  it("discount outside the period is ignored", () => {
    const entries = [ledger(RIYA, "DISCOUNT_GRANTED", "2025-07-05", { credit: 20000 })];
    expect(arrearsForMonth(rates, active, entries, RIYA, "2025-08")).toBe(180000);
  });

  it("voided discounts are ignored", () => {
    const entries = [
      ledger(RIYA, "DISCOUNT_GRANTED", "2025-08-05", { credit: 20000, voidedAt: "2025-08-06T10:00:00Z" }),
    ];
    expect(arrearsForMonth(rates, active, entries, RIYA, "2025-08")).toBe(180000);
  });

  it("overpayment stays negative — the advance is never clamped to zero", () => {
    const entries = [ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 200000 })];
    expect(arrearsForMonth(rates, active, entries, RIYA, "2025-08")).toBe(-20000);
  });

  it("settled month reads exactly zero", () => {
    const entries = [ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 180000 })];
    expect(arrearsForMonth(rates, active, entries, RIYA, "2025-08")).toBe(0);
  });

  it("ignores other students' entries", () => {
    const entries = [
      ledger(KARAN, "PAYMENT_RECEIVED", "2025-08-05", { credit: 99999 }),
      ledger(KARAN, "DISCOUNT_GRANTED", "2025-08-05", { credit: 99999 }),
    ];
    expect(arrearsForMonth(rates, active, entries, RIYA, "2025-08")).toBe(180000);
  });

  it("period/quarter/year arrears compose expected − collected − discounts", () => {
    const entries = [
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-07-05", { credit: 180000 }),
      ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 100000 }),
      ledger(RIYA, "DISCOUNT_GRANTED", "2025-08-05", { credit: 20000 }),
    ];
    // Expected Jul+Aug = 360000; collected = 280000; discounts = 20000 → 60000.
    expect(arrearsForPeriod(rates, active, entries, RIYA, { from: "2025-07", to: "2025-08" })).toBe(60000);
    expect(arrearsForQuarter(rates, active, entries, RIYA, 2025, 3)).toBe(60000 + 180000);
    expect(arrearsForYear(rates, active, entries, RIYA, 2025)).toBe(2160000 - 280000 - 20000);
  });
});

// ── Validation: fail-closed typed errors (Rule 9) ──

describe("input validation (Rule 9: Zod-parse before any computation)", () => {
  const rates = [rate(RIYA, 150000, "2025-01-01", null)];
  const active = [enrolment(RIYA, "2025-01-01")];

  it("rejects an inverted period", () => {
    expect(() => expectedForPeriod(rates, active, RIYA, { from: "2025-09", to: "2025-08" })).toThrow();
  });

  it("rejects a malformed month key", () => {
    expect(() => expectedForMonth(rates, active, RIYA, "2025-13")).toThrow();
    expect(() => expectedForMonth(rates, active, RIYA, "Aug 2025")).toThrow();
  });

  it("rejects an impossible ISO date", () => {
    expect(() => collectedForPeriod([], RIYA, "2025-02-30", "2025-03-01")).toThrow();
  });

  it("rejects a month value outside 01–12", () => {
    expect(() => collectedForPeriod([], RIYA, "2025-13-01", "2025-12-31")).toThrow();
  });

  it("rejects an inverted collected date range", () => {
    expect(() => collectedForPeriod([], RIYA, "2025-09-01", "2025-08-01")).toThrow();
  });

  it("rejects a ledger row with both debit and credit (DDL mutual-exclusion)", () => {
    const bad = [ledger(RIYA, "PAYMENT_RECEIVED", "2025-08-05", { credit: 100, debit: 100 })];
    expect(() => collectedForPeriod(bad, RIYA, "2025-08-01", "2025-08-31")).toThrow();
  });

  it("rejects an invalid quarter and year", () => {
    expect(() => expectedForQuarter(rates, active, RIYA, 2025, 5)).toThrow();
    expect(() => expectedForYear(rates, active, RIYA, 0)).toThrow();
  });

  it("enumerates months inclusively", () => {
    expect(monthKeysInPeriod({ from: "2025-01", to: "2025-03" })).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
    ]);
    expect(monthKeysInPeriod({ from: "2024-12", to: "2025-01" })).toEqual(["2024-12", "2025-01"]);
  });
});
