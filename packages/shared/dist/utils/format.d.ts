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
