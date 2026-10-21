// VENDORED for edge deployability (17_API_Gateway_System.md §5): byte copy of
// `packages/shared/src/paymentBreakdown.ts`, from its first non-comment line
// onward. The Supabase bundler only uploads `supabase/functions/<fn>/` (CI
// stages `apps/gateway/*` into it — see .github/workflows/supabase-ci.yml), so
// the gateway cannot import `../../../packages`: the deploy bundle 400s. Same
// pattern as `vendor/format.ts`, `vendor/outboxPayload.ts`, `vendor/redact.ts`.
//
// WHY THIS FILE EXISTS: RPT-SHAPE-08. The C6 `paymentBreakdown` contract had no
// single owner - the gateway emitted three keys, the dead report-svc

// (since deleted) emitted four, and the two web consumers each carried

// their own Zod literal.

// emitted four, and the two web consumers each carried their own Zod literal.
// Nothing failed when they diverged; a tutor just saw a wrong number.
//
// The parity is enforced, not hoped for: `__tests__/payment-breakdown-contract
// .test.ts` byte-compares this file against the shared source (same technique as
// `redact-vendor-parity.test.ts`) AND runs the real route against a real
// in-memory SQLite and parses its response through the SHARED schema.
import { z } from "zod";

/**
 * The three buckets, in BR-CALC-02's order. Exported so a consumer that has to
 * iterate them (a legend, a drill table, a test) reads the list from here rather
 * than re-typing three strings that can fall out of step with the schema below.
 */
export const PAYMENT_BREAKDOWN_KEYS = ["paid", "partial", "unpaid"] as const;

/**
 * The C6 wire contract: three non-negative student counts that PARTITION the
 * active roster (`paid + partial + unpaid === totalStudents`, BR-CALC-02).
 *
 * These are counts, never money — no paise helper applies and none should
 * (AGENTS.md §2 Rule 6 governs amounts; a headcount is not one).
 *
 * STRICT on purpose. A plain `z.object` SILENTLY DROPS a key it does not
 * declare, which is precisely how report-svc's fourth key would disappear at the
 * web boundary and leave a card that parses cleanly while describing a different
 * population. `.strict()` turns that into a typed failure — Rule 9: an error
 * surfaces, it never passes as a working screen. The cost is the intended one:
 * adding a bucket is a change to THIS file, reviewed here, not a field that
 * appears in a producer and is quietly absorbed by a consumer.
 */
export const PaymentBreakdownSchema = z
  .object({
    paid: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    unpaid: z.number().int().nonnegative(),
  })
  .strict();

export type PaymentBreakdown = z.infer<typeof PaymentBreakdownSchema>;