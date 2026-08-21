"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatINR = formatINR;
exports.paiseAdd = paiseAdd;
exports.paiseSub = paiseSub;
exports.paiseMul = paiseMul;
exports.assertPaise = assertPaise;
/**
 * BR-M-01: Money is always integer paise. Displayed as ₹ with 2 decimals.
 * Implements: 12_Business_Rules.md BR-M-01, AGENTS.md Rule 6 (integer paise, never float).
 */
function formatINR(paise) {
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
function paiseAdd(a, b) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b))
        throw new Error("paiseAdd: non-safe-integer");
    const r = a + b;
    if (!Number.isSafeInteger(r))
        throw new Error("paiseAdd: overflow");
    return r;
}
function paiseSub(a, b) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b))
        throw new Error("paiseSub: non-safe-integer");
    const r = a - b;
    if (!Number.isSafeInteger(r))
        throw new Error("paiseSub: overflow");
    return r;
}
function paiseMul(amountPaise, multiplier) {
    if (!Number.isSafeInteger(amountPaise) || !Number.isSafeInteger(multiplier))
        throw new Error("paiseMul: non-safe-integer");
    const r = amountPaise * multiplier;
    if (!Number.isSafeInteger(r))
        throw new Error("paiseMul: overflow");
    return r;
}
function assertPaise(v) {
    if (!Number.isSafeInteger(v) || v < 0)
        throw new Error(`assertPaise: invalid paise ${v}`);
}
