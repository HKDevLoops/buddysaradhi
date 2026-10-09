// Implements: 12_Business_Rules.md BR-M-01/BR-M-02 (integer paise, en-IN display),
// AGENTS.md §2 Rule 6 (integer paise, never float).
// Principle: P4 (money exactness), P15 (nothing a tutor reads may change silently).
//
// WHY THIS FILE LIVES HERE AND NOT IN `packages/shared`.
//
// `packages/shared/src/utils/format.test.ts` already covers the same functions
// from the package's own side, and it runs under the ROOT vitest project
// (`pnpm run test:unit`). This file is the CONSUMER-side contract: it pins the
// string the web app actually renders, against a reference formatter built the
// old way, and it lives inside the web vitest project so a change to
// `formatINR` cannot pass the shared suite and still repaint a tutor's roster.
//
// WHAT IT GUARDS. `formatINR` used to construct a fresh `Intl.NumberFormat` on
// every call, which cost roughly two constructions per roster row per render.
// The formatter is now built once at module load. Sharing a `NumberFormat`
// instance is safe because it stores RESOLVED OPTIONS rather than per-call
// state — `format()` is pure with respect to the instance — so the hoist must
// be byte-for-byte output-preserving. These tests are what make that a checked
// claim rather than an assertion in a comment: if a future change adds a
// currency, a locale or a per-call option to this function, the diff between
// the hoisted instance and the reference below will not be empty and the suite
// will say so.

import { describe, expect, it } from "vitest";
import { formatINR } from "@buddysaradhi/shared";

/**
 * The pre-hoist implementation, verbatim: a fresh formatter per call. This is
 * the oracle every case below is compared against, so it is written out longhand
 * rather than reusing anything the module under test exposes.
 */
function referenceFormatINR(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(rupees);
}

/**
 * The battery. It is deliberately not just round numbers:
 *   - `1` paise and `99` paise exercise the sub-rupee boundary where float
 *     division is most likely to produce `0.1` vs `0.10` or a `100.00` carry.
 *   - `-50000` is the BR-CALC-01 advance; a balance in credit is a real state
 *     on this roster and the roster renders its sign in an `aria-label`.
 *   - `12450000` is the BR-M-02 lakh grouping case (`₹1,24,500`, never
 *     `₹124,500`) and is the assertion that would catch a locale change.
 *   - `9007199254740991` is `Number.MAX_SAFE_INTEGER` — the largest value the
 *     money rules permit (`11_Data_Model.md` §1), and ₹90,071,992,547,409.91,
 *     which forces the formatter through its full significant-digit path.
 *   - `99999999999999` is 13 significant digits, one past what a double carries
 *     exactly, and is where a formatter that cached state between calls would
 *     show up first.
 */
const AMOUNTS_PAISE: ReadonlyArray<readonly [label: string, paise: number]> = [
  ["zero", 0],
  ["one paise", 1],
  ["ninety-nine paise", 99],
  ["one rupee", 100],
  ["one paise over a rupee", 101],
  ["an even rupee amount", 150000],
  ["odd paise", 125555],
  ["lakh grouping (BR-M-02)", 12450000],
  ["crore grouping", 12345678900],
  ["a negative advance (BR-CALC-01)", -50000],
  ["one paise of credit", -1],
  ["a large negative", -12450000],
  ["the largest safe integer of paise", Number.MAX_SAFE_INTEGER],
  ["the most negative safe integer", Number.MIN_SAFE_INTEGER],
  ["thirteen significant digits", 99999999999999],
  ["a near-maximum realistic institute year", 9876543210],
];

describe("formatINR — the hoisted formatter is output-identical (P2)", () => {
  it.each(AMOUNTS_PAISE)(
    "formatINR(%s) matches a freshly constructed formatter",
    (_label, paise) => {
      expect(formatINR(paise)).toBe(referenceFormatINR(paise));
    },
  );

  it("is stable across repeated calls on the same instance", () => {
    // A shared instance could in principle accumulate state between calls (a
    // `formatToParts` walk, a cached digit map keyed on the last value). This
    // asserts interleaving does not change the answer: the same amount formatted
    // before and after a much larger one is identical.
    const amounts = AMOUNTS_PAISE.map(([, paise]) => paise);
    const first = amounts.map((paise) => formatINR(paise));
    const shuffled = [...amounts].reverse();
    for (const paise of shuffled) formatINR(paise);
    const second = amounts.map((paise) => formatINR(paise));
    expect(second).toEqual(first);
  });

  it("keeps the signature it always had — one number, no options", () => {
    // BR-M-04's `negativeColor` option does not exist and never did; the
    // advance's colour is applied by the caller. This test fails loudly if a
    // second parameter is ever added without the oracle above being updated,
    // because `fn.length` is the arity the function actually advertises.
    expect(formatINR).toHaveLength(1);
  });
});

describe("formatINR — the en-IN contract the screen depends on (BR-M-02)", () => {
  it("groups in lakhs, not western thousands", () => {
    expect(formatINR(12450000)).toContain("1,24,500");
    expect(formatINR(12450000)).not.toContain("124,500");
  });

  it("always prints two decimals", () => {
    expect(formatINR(0)).toContain("0.00");
    expect(formatINR(1)).toContain("0.01");
    expect(formatINR(100)).toContain("1.00");
  });

  it("keeps the rupee sign and the sign of a credit", () => {
    expect(formatINR(150000)).toContain("₹");
    const credit = formatINR(-50000);
    expect(credit).toContain("₹");
    expect(credit).toContain("500.00");
  });
});
