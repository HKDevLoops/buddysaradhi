/**
 * ONE formatter, built once at module load.
 *
 * WHY THIS IS NOT A CONSTANT INSIDE `formatINR`. Constructing an
 * `Intl.NumberFormat` is the expensive half of formatting a number — resolving the
 * locale, the currency data and the numbering system — and `.format()` on an
 * existing instance is the cheap half. The function below used to build a fresh
 * formatter per call, and it is called roughly twice per roster row per render
 * (`StudentMasterList` builds an `aria-label` containing a balance), so a
 * 50-row roster on screen meant ~100 constructor calls per keystroke. On top of
 * that, every caller of `formatINR` also SUBSCRIBES to the whole students store
 * — so a keystroke multiplied that by the number of rendered components.
 *
 * WHY HOISTING CANNOT CHANGE ANY OUTPUT:
 *
 *   1. `NumberFormat` holds RESOLVED OPTIONS, not per-call state. `format()` is a
 *      pure function of `(value)`; it does not mutate the instance, and there is
 *      no setter that mutates it either. N fresh instances and one shared
 *      instance produce byte-identical strings for identical inputs. There is no
 *      per-call option mutation anywhere in this file to hoist away, because
 *      there is no per-call option at all.
 *   2. THE SIGNATURE DID NOT CHANGE. `formatINR` takes exactly one number and has
 *      no locale, currency or options parameter, so there is no parameterisation
 *      to preserve. Every caller in the monorepo passes a single paise integer
 *      (the only other `formatINR` in the tree is a different, web-local
 *      implementation in `apps/web/src/lib/utils.ts`, which this change does not
 *      touch). `apps/web/src/lib/format-inr.test.ts` pins the hoisted output
 *      against a freshly constructed reference formatter for a battery of
 *      amounts, so a future option added here cannot silently diverge.
 *
 * NOTE ON THE SPEC. 12_Business_Rules.md BR-M-04 describes `formatINR()` as
 * taking a `negativeColor: 'emerald'` option. It has never taken one, and no
 * caller passes one — the emerald treatment for an advance is applied by the
 * caller (BR-CALC-01), not by this function. That is pre-existing spec drift,
 * not something this change introduces or resolves; it is reported rather than
 * acted on, because adding a colour option here would be a UI decision made in
 * a money-arithmetic module.
 *
 * Implements: 12_Business_Rules.md BR-M-01/BR-M-02, AGENTS.md Rule 6 (integer
 * paise, never float).
 */
const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

/**
 * BR-M-01: Money is always integer paise. Displayed as ₹ with 2 decimals.
 * Implements: 12_Business_Rules.md BR-M-01, AGENTS.md Rule 6 (integer paise, never float).
 */
export function formatINR(paise: number): string {
  return INR_FORMATTER.format(paise / 100);
}

/**
 * BR-M-01 helpers — integer-paise arithmetic. Never use +/-/* directly on paise.
 * All amounts are validated as safe integers (≤ Number.MAX_SAFE_INTEGER).
 */
export function paiseAdd(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error("paiseAdd: non-safe-integer");
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new Error("paiseAdd: overflow");
  return r;
}

export function paiseSub(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error("paiseSub: non-safe-integer");
  const r = a - b;
  if (!Number.isSafeInteger(r)) throw new Error("paiseSub: overflow");
  return r;
}

export function paiseMul(amountPaise: number, multiplier: number): number {
  if (!Number.isSafeInteger(amountPaise) || !Number.isSafeInteger(multiplier)) throw new Error("paiseMul: non-safe-integer");
  const r = amountPaise * multiplier;
  if (!Number.isSafeInteger(r)) throw new Error("paiseMul: overflow");
  return r;
}

export function assertPaise(v: number): void {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`assertPaise: invalid paise ${v}`);
}

/**
 * BR-FEE-01 + 22_Redundancy_Audit.md P16: division-derived money rounds
 * half-to-even (banker's). EC-F-01: 12555/10 -> 1256. BigInt-exact, no float.
 * Scope: division sites only (discounts, prorations). Display-step rounding
 * stays Math.round per BR-M-05; instalment splits use remainder-to-last per
 * BR-CALC-03. Non-negative dividend, positive divisor — throws otherwise.
 */
export function paiseDivHalfEven(dividend: number, divisor: number): number {
  if (!Number.isSafeInteger(dividend) || !Number.isSafeInteger(divisor)) throw new Error("paiseDivHalfEven: non-safe-integer");
  if (dividend < 0 || divisor <= 0) throw new Error("paiseDivHalfEven: non-negative dividend and positive divisor required");
  const q = BigInt(dividend) / BigInt(divisor);
  const r = BigInt(dividend) % BigInt(divisor);
  const twiceR = r * 2n;
  const d = BigInt(divisor);
  let out = q;
  if (twiceR > d) out = q + 1n;
  else if (twiceR === d && q % 2n !== 0n) out = q + 1n;
  const n = Number(out);
  if (!Number.isSafeInteger(n)) throw new Error("paiseDivHalfEven: overflow");
  return n;
}
