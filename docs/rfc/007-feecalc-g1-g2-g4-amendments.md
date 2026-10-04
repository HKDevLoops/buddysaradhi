# RFC-007: feeCalc G1 / G2 / G4 Spec-vs-Code Amendments

**Status:** Draft — owner picks. No code changed.
**Date:** 2026-10-04

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
