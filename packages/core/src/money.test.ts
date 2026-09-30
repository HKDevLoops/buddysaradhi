// Implements: 12_Business_Rules.md BR-M-01 / BR-FEE-01 (integer paise, never
// float), 14_Edge_Cases.md EC-F-01 (fractional-paise boundaries),
// AGENTS.md §2 Rule 6 (money in integer paise) + §7.1 (unit: pure functions,
// table-driven incl. boundary values).
//
// Pure unit tests for `money.ts` — no DB, no I/O. Every amount is an exact
// integer; assertions compare exact paise integers, never floats.
import { describe, it, expect } from "vitest";
import { paiseAdd, paiseSub } from "./money";

const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 9007199254740991
const MIN_SAFE = Number.MIN_SAFE_INTEGER;

describe("paiseAdd (BR-M-01 — exact integer paise)", () => {
  it.each([
    [0, 0, 0],
    [150000, 0, 150000],
    [0, 150000, 150000],
    [99999, 1, 100000],
    [1, 99999, 100000],
    [125500, 125500, 251000],
    [-500, -200, -700],
    [-500, 700, 200],
    [MAX_SAFE, 0, MAX_SAFE],
    [0, MAX_SAFE, MAX_SAFE],
    [MIN_SAFE, 0, MIN_SAFE],
    [MAX_SAFE - 1, 1, MAX_SAFE],
  ])("adds %i + %i = %i exactly", (a, b, expected) => {
    expect(paiseAdd(a, b)).toBe(expected);
  });

  it("rejects overflow past MAX_SAFE_INTEGER (Rule 6 fail-closed)", () => {
    expect(() => paiseAdd(MAX_SAFE, 1)).toThrow(/overflow/);
    expect(() => paiseAdd(MAX_SAFE, MAX_SAFE)).toThrow(/overflow/);
    expect(() => paiseAdd(1, MAX_SAFE)).toThrow(/overflow/);
  });

  it.each([[100.5], [0.1], [Number.NaN], [Number.POSITIVE_INFINITY], [MAX_SAFE + 1]])(
    "rejects non-safe-integer input %s",
    (bad) => {
      expect(() => paiseAdd(bad, 0)).toThrow(/non-safe-integer/);
      expect(() => paiseAdd(0, bad)).toThrow(/non-safe-integer/);
    },
  );
});

describe("paiseSub (BR-M-01 — exact integer paise)", () => {
  it.each([
    [0, 0, 0],
    [150000, 150000, 0],
    [150000, 40000, 110000],
    [100000, 40000, 60000],
    [0, 1, -1],
    [MIN_SAFE, 0, MIN_SAFE],
    [1, MAX_SAFE, 1 - MAX_SAFE],
    [MAX_SAFE, MAX_SAFE, 0],
  ])("subtracts %i - %i = %i exactly", (a, b, expected) => {
    expect(paiseSub(a, b)).toBe(expected);
  });

  it("rejects underflow past MIN_SAFE_INTEGER (Rule 6 fail-closed)", () => {
    expect(() => paiseSub(MIN_SAFE, 1)).toThrow(/overflow/);
    expect(() => paiseSub(MIN_SAFE, MAX_SAFE)).toThrow(/overflow/);
  });

  it.each([[100.5], [Number.NaN], [Number.NEGATIVE_INFINITY], [MIN_SAFE - 1]])(
    "rejects non-safe-integer input %s",
    (bad) => {
      expect(() => paiseSub(bad, 0)).toThrow(/non-safe-integer/);
      expect(() => paiseSub(0, bad)).toThrow(/non-safe-integer/);
    },
  );
});

describe("paiseAdd/paiseSub EC-F-01 regression (no float dust)", () => {
  it("adds 10% attribution parts without float drift (40000 + 30000 + 30000 = 100000)", () => {
    // The F9 attribution loop in `fees.ts` reduces over paiseAdd; a float
    // implementation would risk 99999.9999-style dust breaking the
    // creditedPaise === amountPaise invariant.
    const credited = [40000, 30000, 30000].reduce((sum, p) => paiseAdd(sum, p), 0);
    expect(credited).toBe(100000);
  });

  it("never produces a fractional paise from integer inputs", () => {
    for (const [a, b] of [[125555, 12556], [1, 2], [999999999, 888888888]] as Array<[number, number]>) {
      expect(Number.isInteger(paiseAdd(a, b))).toBe(true);
      expect(Number.isInteger(paiseSub(a, b))).toBe(true);
    }
  });
});
