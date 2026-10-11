// Implements: RPT-SHAPE-08 — ONE declaration of the C6 payment-breakdown shape,
// and a test that PROVES the gateway's copy has not drifted from it.
//
// WHY THIS FILE EXISTS
// The edge runtime cannot import from `packages/` (the Deno bundle boundary), so
// the contract is physically duplicated at
// `apps/gateway/lib/vendor/paymentBreakdown.ts`. Comments in both files claimed
// a parity test enforced the agreement — and no such file existed. A copy that is
// merely *asserted* to match is a copy that silently stops matching: the gateway
// keeps returning three keys, the web keeps parsing three keys, and the day the
// vendored copy gains a fourth key (or drops `.strict()`) nothing breaks at build
// time and a tutor's dashboard quietly renders a different population.
//
// So this test compares the two files mechanically instead of trusting a comment.
// It is the artefact that makes the word "enforced" in those comments true.
//
// SCOPE: this is a SOURCE-level equality check, not a behavioural one, because the
// whole risk being guarded is textual drift between two copies of one schema. A
// behaviour test would pass even when the copies diverge in comments or shape
// helpers, which is exactly the drift that hides.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = resolve(HERE, "../../../packages/shared/src/paymentBreakdown.ts");
const VENDORED = resolve(HERE, "../lib/vendor/paymentBreakdown.ts");

/**
 * Strip the leading block comment (the rationale prose, which legitimately
 * differs: the vendored copy explains WHY it exists and the shared copy explains
 * the contract) and everything after the first real declaration, returning the
 * executable code only.
 *
 * Two copies with identical behaviour can have wildly different comments; two
 * copies with different behaviour can have identical comments. Comparing the
 * CODE is what makes this test meaningful.
 */
function executableBody(source: string): string {
  const start = source.indexOf("export const PAYMENT_BREAKDOWN_KEYS");
  expect(start, "PAYMENT_BREAKDOWN_KEYS must exist in the file").toBeGreaterThan(-1);
  return source
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, "") // inner block comments
    .replace(/\/\/.*$/gm, "") // line comments
    .replace(/\s+/g, " ")
    .trim();
}

describe("paymentBreakdown contract — the vendored copy must not drift", () => {
  it("the gateway's vendored copy is byte-equivalent to the shared source", () => {
    const shared = executableBody(readFileSync(SHARED, "utf8"));
    const vendored = executableBody(readFileSync(VENDORED, "utf8"));
    expect(vendored).toBe(shared);
  });

  it("both copies declare exactly three buckets, and `.strict()`", () => {
    for (const path of [SHARED, VENDORED]) {
      const body = executableBody(readFileSync(path, "utf8"));
      expect(body, path).toContain("paid");
      expect(body, path).toContain("partial");
      expect(body, path).toContain("unpaid");
      // `noDues` is a DERIVED remainder, not a fourth bucket — see the rationale
      // header. If it ever reappears as a key here, both consumers must be
      // re-checked for double counting.
      expect(body, path).not.toContain("noDues");
      // `.strict()` is what turns an unknown key into a typed failure instead of
      // a silently dropped field. Losing it reintroduces the exact silent-drift
      // bug this contract exists to prevent.
      expect(body, path).toContain(".strict()");
    }
  });

  it("rejects a fourth key at runtime — the guarantee `.strict()` provides", async () => {
    const { PaymentBreakdownSchema } = await import(
      "../lib/vendor/paymentBreakdown.ts"
    );
    // The three legitimate keys parse.
    expect(PaymentBreakdownSchema.parse({ paid: 1, partial: 2, unpaid: 3 })).toEqual({
      paid: 1,
      partial: 2,
      unpaid: 3,
    });
    // A fourth key is a hard failure, NOT a silently-trimmed parse. Without
    // `.strict()` this returns `{paid,partial,unpaid}` and the consumer renders
    // a card describing a different population than the producer sent.
    expect(() =>
      PaymentBreakdownSchema.parse({ paid: 1, partial: 2, unpaid: 3, noDues: 4 }),
    ).toThrow();
    // Negative counts are rejected too (these are headcounts, never money, so
    // Rule 6 does not apply — but a negative count is still nonsense).
    expect(() => PaymentBreakdownSchema.parse({ paid: -1, partial: 0, unpaid: 0 })).toThrow();
    // Non-integers are rejected: a fractional student is not a rounding issue,
    // it is a bug in whatever produced the payload.
    expect(() => PaymentBreakdownSchema.parse({ paid: 1.5, partial: 0, unpaid: 0 })).toThrow();
  });
});