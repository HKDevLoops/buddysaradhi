// Implements: 12_Business_Rules.md BR-M-01 (integer paise, never float) and
// AGENTS.md §2 Rule 6 / §14 checklist #3 — "no `+`/`-`/`*` on money, use
// `paiseAdd`/`paiseSub`".
//
// Exact mirror of the helpers in `packages/shared/src/utils/format.ts`
// (the canonical home, same semantics and same error strings). `packages/core`
// cannot import that module: its `tsconfig.json` pins `rootDir: ./src` and it
// carries no `@buddysaradhi/shared` workspace dependency, so a cross-package
// source import fails `tsc` with TS6059. Keep the two in sync — changing the
// overflow semantics or the message strings here without changing
// `format.ts` re-opens Rule 6.
//
// `apps/gateway` does import `packages/shared` directly (Deno/vitest both
// resolve it), so only the core dialect needs this mirror.

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

// Mirror of `paiseMul` in `packages/shared/src/utils/format.ts` — same
// semantics, same error strings.
export function paiseMul(amountPaise: number, multiplier: number): number {
  if (!Number.isSafeInteger(amountPaise) || !Number.isSafeInteger(multiplier)) throw new Error("paiseMul: non-safe-integer");
  const r = amountPaise * multiplier;
  if (!Number.isSafeInteger(r)) throw new Error("paiseMul: overflow");
  return r;
}

// Mirror of `paiseDivHalfEven` in `packages/shared/src/utils/format.ts` —
// same BigInt-exact half-to-even semantics, same error strings (see above).
// Canonical spec: BR-FEE-01 + 22_Redundancy_Audit.md P16 (division sites only).
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
