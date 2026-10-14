# RFC-007: feeCalc G1 / G2 / G4 Spec-vs-Code Amendments

**Status:** ACCEPTED with per-gap dispositions below — 2026-10-14, owner-authorized close-out. No code changed, deliberately (see evidence).
**Date:** 2026-10-04

## Dispositions (all premises re-verified 2026-10-14, not trusted from 2026-10-04)

- **G1 → DEFER-TO-WIRING (B1 shape already).** The premise holds:
  `student_enrollments` DDL carries no status column while BR-FEE-23 names
  `status='paused'`. But a repo-wide importer check finds ZERO production
  importers of any feeCalc function — only `feeCalc.test.ts` imports it (one
  comment in `fees-client.tsx` names it). A DDL migration + backfill for
  functions nothing calls is orphan schema: real migration risk on tenant DBs
  for zero live benefit. `EnrolmentRowSchema.status` already travels as
  CALL-TIME input (B1's shape), so no code change is needed for the helpers
  to be correct when wired. Migrate if and when an engine persists status.
- **G2 → KEEP the documented projection contract.** `voided_at` projection is
  prescribed in-code (`feeCalc.ts:77-82`, with the DDL-truth citation) and
  pinned by test (`feeCalc.test.ts:207` "voided entries excluded"). B2 (drop
  it for `reverses_entry_id`-only linkage) would churn a tested contract with
  no production callers to benefit. Revisit at wiring.
- **G4 → KEEP returning 0, rationale recorded.** B3 (throw on null rate) would
  break the pinned `expectedForMonth([], …) === 0` case AND conflate two
  different states: "no schedule" (legitimately 0 — nothing to charge) vs
  "uncomputed". The inline comment (`feeCalc.ts:203-205`) already adjudicates
  this per BR-CALC-09 ("contributes 0"); BR-FEE-20's null belongs to the
  dashboard display layer at wiring time, not to this function's contract.

## 1. Problem (with evidence)

`reviews/production-readiness-next-phase-plan-2026-09-30.md:113-116` records
three `packages/shared/src/feeCalc.ts` gaps, each a spec-vs-code question
(AGENTS.md §0.1: spec wins unless amended first):

- **G1 — enrolment status with no DDL.** `feeCalc` branches on enrolment
  status, but no DDL column backs it — computed ghost state feeds money math.
- **G2 — `void_of_id` projection.** Code projects a `void_of_id` field the
  spec grammar does not define; readers cannot tell void from reversal.
- **G4 — null-vs-0.** Nullable amounts coerce to `0` in code, collapsing
  "unknown / not yet computed" into "zero owed" — a money-semantics error.

## 2. Governing spec / principles

- AGENTS.md §0.1–§0.3 (spec → code → test; no orphan code), Rule 6 (integer
  paise), Rule 9 (no silent failure — null→0 coercion is one).
- `12_Business_Rules.md` BR-FEE-* (fee computation), BR-M-01 (paise),
  BR-LED-* (void = reversing entry); `11_Data_Model.md` (column authority).
- `14_Edge_Cases.md` EC-F-* (read before done).

## 3. Paths (per gap; each gap picks amend-spec OR amend-code)

- **G1:** (A1) amend spec + DDL: add `enrolment_status` column, forward-only
  migration, BR-FEE-* citation — ghost state becomes real state. *Cost:*
  migration + backfill. (B1) amend code: derive status from existing
  enrolment rows at call time, no new column. *Cost:* recompute on every call;
  *risk:* two derivations diverging.
- **G2:** (A2) amend spec: define `void_of_id` projection semantics in the
  ledger grammar section. (B2) amend code: drop the projection, expose void
  linkage only via `reverses_entry_id`. *Cheaper; preferred on no-orphan
  grounds unless consumers need the projection.*
- **G4:** (A3) amend spec: declare null = "uncomputed" distinct from 0, with
  display rule. (B3) amend code: `NonNullable` paise at the boundary via Zod,
  rejecting null before math. *B3 is fail-closed and matches Rule 9.*

**RECOMMENDED PATH (RECOMMENDATION ONLY — owner picks): A1 + B2 + B3** —
persist what money depends on (G1), delete what the spec never defined (G2),
reject what must never be zero (G4).

## 4. Test plan

- G1: enrolment-status fixture → feeCalc matches BR-FEE-* expected paise.
- G2: voided invoice → linkage visible exactly once, via the chosen field.
- G4: null amount → typed error (B3) or "uncomputed" display (A3); never ₹0.
- Money-math regression: BR-M-01 half-to-even cases in `14_Edge_Cases.md`.

## 5. Rollback

Docs-only: delete this file. If implemented: G1 migration stands forward-only;
code-side (B2/B3) reverts to prior tag; spec amendments reverted by RFC
supersede note, never by editing history.

## 6. Reviewers

1 reviewer + BR owner (`12_Business_Rules.md` BR-FEE section). Money-adjacent
→ flag Rule 6 compliance in the PR.
