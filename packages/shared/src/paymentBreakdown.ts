// Implements: 04_Dashboard.md §10.1 C6 (Payment Breakdown) + §9.1 (KPI Snapshot)
// + §7.1 `DashboardKpiSnapshot.paymentBreakdown`; 12_Business_Rules.md BR-CALC-02
// (per-student payment status); AGENTS.md §3.5 (one implementation of a rule,
// never a second copy that drifts) + §2 Rule 9 (a boundary declares its shape
// once, and a violation is loud).
//
// ── ONE contract for the C6 card ──────────────────────────────────────────────
// Before this module the shape existed in three places and they disagreed:
//
//   apps/gateway/routes/analytics.ts   3 keys  { paid, partial, unpaid }
//   apps/services/report-svc/src/…     4 keys  { paid, partial, unpaid, noDues }
//   apps/web/…/dashboard-analytics.ts  3 keys, TWICE (two Zod literals + a
//                                     hand-written TS interface, three copies)
//
// Nothing failed when they diverged — every consumer parsed its own literal and
// the dashboard rendered whichever number arrived. A contract that cannot fail is
// not a contract; this file is the one place it is declared, so the next
// divergence is a type error instead of a wrong number on a tutor's screen.
//
// ── WHY THREE KEYS, not four ─────────────────────────────────────────────────
// `noDues` is NOT a peer bucket. In every implementation that computes it
// (report-svc, and the sketch at `04_Dashboard.md:435`) it is a DERIVED
// REMAINDER:
//
//     noDues = totalStudents - paid - partial - unpaid
//
// — arithmetic on the other three, not a classification of a student. And it
// overlaps them: a student holding no open invoice is `paid` by BR-CALC-02's own
// definition ("nothing outstanding"), so `noDues` is a SUBSET of `paid`, not a
// sibling of it. Summing all four therefore counts some students twice and
// reports a population larger than the roster: 3 active students render as
// "3 paid + 2 never invoiced = 5". A card that tells a tutor five people exist
// when three do is worse than a card with three dots.
//
// Nothing is lost by dropping it. A consumer that wants the never-invoiced
// count derives it from the roster it already holds:
//
//     noDues = Math.max(0, totalStudents - (paid + partial + unpaid))
//
// — the same expression `04_Dashboard.md:435` prescribes, evaluated where
// `totalStudents` actually lives rather than shipped across a wire as a fourth
// pre-computed figure that can drift from the three beside it.
//
// ── SPEC DIVERGENCE — RATIFICATION REQUIRED (not ratified; see report) ─────────
// `04_Dashboard.md:184` still declares the FOUR-key shape, and `:602` / `:654`
// repeat `paid / partial / unpaid / noDues`. This module implements the THREE-key
// shape, which is what the gateway ships and what both web consumers parse today.
//
// That is a behaviour change relative to the spec, so per AGENTS.md §8 it is
// recorded here rather than ratified unilaterally, and `04_Dashboard.md` was NOT
// edited in this change. The recommended one-line amendment is reported with the
// PR; on ratification the two prose lines above and this comment are deleted.
//
// Until then this module is deliberately STRICT (below), so the spec's 4-key
// shape cannot leak back in unnoticed.
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