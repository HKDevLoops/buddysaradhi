// Implements: 12_Business_Rules.md BR-M-01 (integer paise, never float) and
// AGENTS.md §2 Rule 6 / §14 checklist #3 — "no `+`/`-`/`*` on money, use
// `paiseAdd`/`paiseSub`".
//
// Exact mirror of the two helpers in `packages/shared/src/utils/format.ts`
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
