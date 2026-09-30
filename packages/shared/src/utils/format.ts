/**
 * BR-M-01: Money is always integer paise. Displayed as ₹ with 2 decimals.
 * Implements: 12_Business_Rules.md BR-M-01, AGENTS.md Rule 6 (integer paise, never float).
 */
export function formatINR(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(rupees);
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
