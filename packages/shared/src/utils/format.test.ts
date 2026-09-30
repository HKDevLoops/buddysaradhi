// Implements: 12_Business_Rules.md BR-M-01 (integer paise), BR-M-02 (en-IN display)
// Principle: P4 (money exactness), AGENTS.md Rule 6 (integer paise, never float),
// Rule 9 (typed throws, no silent failures).
import { describe, it, expect } from "vitest";
import {
  formatINR,
  paiseAdd,
  paiseSub,
  paiseMul,
  assertPaise,
} from "./format";

describe("formatINR (BR-M-01/BR-M-02)", () => {
  it("returns a string containing the rupee symbol", () => {
    const out = formatINR(150000);
    expect(typeof out).toBe("string");
    expect(out).toContain("₹");
  });

  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [100, "1.00"],
    [150000, "1,500.00"],
    [125555, "1,255.55"],
    [12450000, "1,24,500"],
  ])("formats %i paise with 2 decimals (%s)", (paise, fragment) => {
    expect(formatINR(paise)).toContain(fragment);
  });

  it("uses en-IN lakh grouping, not western grouping", () => {
    // ₹1,24,500 (lakh) — never ₹124,500 (BR-M-02).
    expect(formatINR(12450000)).toContain("1,24,500");
    expect(formatINR(12450000)).not.toContain("124,500");
  });

  it("formats advances (negative balances) with the amount intact (BR-CALC-01)", () => {
    const out = formatINR(-50000);
    expect(out).toContain("500.00");
    expect(out).toContain("₹");
  });
});

describe("paiseAdd (BR-M-01: never +/- directly on paise)", () => {
  it.each([
    [0, 0, 0],
    [100, 250, 350],
    [150000, 150000, 300000],
    [0, 1, 1],
    [-5000, 5000, 0],
    [Number.MAX_SAFE_INTEGER - 1, 1, Number.MAX_SAFE_INTEGER],
  ])("paiseAdd(%i, %i) === %i", (a, b, expected) => {
    expect(paiseAdd(a, b)).toBe(expected);
  });

  it.each([
    [1.5, 0],
    [0, 0.5],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
    [Number.MAX_SAFE_INTEGER + 1, 0],
  ])("throws non-safe-integer for paiseAdd(%s, %s)", (a, b) => {
    expect(() => paiseAdd(a, b)).toThrow(
      new Error("paiseAdd: non-safe-integer"),
    );
  });

  it.each([
    [Number.MAX_SAFE_INTEGER, 1],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])("throws overflow for paiseAdd(%i, %i)", (a, b) => {
    expect(() => paiseAdd(a, b)).toThrow(new Error("paiseAdd: overflow"));
  });
});

describe("paiseSub (BR-M-01)", () => {
  it.each([
    [0, 0, 0],
    [5000, 2500, 2500],
    [2500, 5000, -2500],
    [150000, 150000, 0],
    [Number.MIN_SAFE_INTEGER + 1, 1, Number.MIN_SAFE_INTEGER],
  ])("paiseSub(%i, %i) === %i", (a, b, expected) => {
    expect(paiseSub(a, b)).toBe(expected);
  });

  it.each([
    [1.5, 0],
    [0, Number.NaN],
    [0, Number.NEGATIVE_INFINITY],
  ])("throws non-safe-integer for paiseSub(%s, %s)", (a, b) => {
    expect(() => paiseSub(a, b)).toThrow(
      new Error("paiseSub: non-safe-integer"),
    );
  });

  it.each([
    [Number.MIN_SAFE_INTEGER, 1],
    [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])("throws overflow for paiseSub(%i, %i)", (a, b) => {
    expect(() => paiseSub(a, b)).toThrow(new Error("paiseSub: overflow"));
  });
});

describe("paiseMul (BR-FEE-20: quarterly = monthly x 3, annual = monthly x 12)", () => {
  it.each([
    [150000, 3, 450000],
    [150000, 12, 1800000],
    [0, 999, 0],
    [100, 0, 0],
    [1, 1, 1],
    [25000, 4, 100000],
  ])("paiseMul(%i, %i) === %i", (amount, multiplier, expected) => {
    expect(paiseMul(amount, multiplier)).toBe(expected);
  });

  it.each([
    [1.5, 2],
    [100, 2.5],
    [Number.NaN, 1],
  ])("throws non-safe-integer for paiseMul(%s, %s)", (amount, multiplier) => {
    expect(() => paiseMul(amount, multiplier)).toThrow(
      new Error("paiseMul: non-safe-integer"),
    );
  });

  it.each([
    [Number.MAX_SAFE_INTEGER, 2],
    [Number.MIN_SAFE_INTEGER, 2],
  ])("throws overflow for paiseMul(%i, %i)", (amount, multiplier) => {
    expect(() => paiseMul(amount, multiplier)).toThrow(
      new Error("paiseMul: overflow"),
    );
  });
});

describe("assertPaise (BR-M-01 input guard)", () => {
  it.each([0, 1, 100, 150000, Number.MAX_SAFE_INTEGER])(
    "accepts valid paise %i",
    (v) => {
      expect(assertPaise(v)).toBeUndefined();
    },
  );

  it("rejects negative paise exactly", () => {
    expect(() => assertPaise(-1)).toThrow(
      new Error("assertPaise: invalid paise -1"),
    );
  });

  it("rejects fractional paise exactly", () => {
    expect(() => assertPaise(1.5)).toThrow(
      new Error("assertPaise: invalid paise 1.5"),
    );
  });

  it("rejects NaN exactly", () => {
    expect(() => assertPaise(Number.NaN)).toThrow(
      new Error("assertPaise: invalid paise NaN"),
    );
  });

  it("rejects Infinity exactly", () => {
    expect(() => assertPaise(Number.POSITIVE_INFINITY)).toThrow(
      new Error("assertPaise: invalid paise Infinity"),
    );
  });
});
