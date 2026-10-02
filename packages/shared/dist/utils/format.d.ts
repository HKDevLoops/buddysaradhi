/**
 * BR-M-01: Money is always integer paise. Displayed as ₹ with 2 decimals.
 * Implements: 12_Business_Rules.md BR-M-01, AGENTS.md Rule 6 (integer paise, never float).
 */
export declare function formatINR(paise: number): string;
/**
 * BR-M-01 helpers — integer-paise arithmetic. Never use +/-/* directly on paise.
 * All amounts are validated as safe integers (≤ Number.MAX_SAFE_INTEGER).
 */
export declare function paiseAdd(a: number, b: number): number;
export declare function paiseSub(a: number, b: number): number;
export declare function paiseMul(amountPaise: number, multiplier: number): number;
export declare function assertPaise(v: number): void;
/**
 * BR-FEE-01 + 22_Redundancy_Audit.md P16: division-derived money rounds
 * half-to-even (banker's). EC-F-01: 12555/10 -> 1256. BigInt-exact, no float.
 * Scope: division sites only (discounts, prorations). Display-step rounding
 * stays Math.round per BR-M-05; instalment splits use remainder-to-last per
 * BR-CALC-03. Non-negative dividend, positive divisor — throws otherwise.
 */
export declare function paiseDivHalfEven(dividend: number, divisor: number): number;
