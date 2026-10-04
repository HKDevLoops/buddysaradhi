# RFC-006: Enum / DDL Unification (generate_zod, batch_id, Contract Enums)

**Status:** Draft — owner picks. No code changed.
**Date:** 2026-10-04

## 1. Problem (with evidence)

Three enum/DDL divergences, one orphan script:

1. **Session-status 5th value.** DDL `CHECK` admits a 5th value `holiday`
   (`11_Data_Model.md:379`) and `03_User_Flows.md:302` writes it, but the Zod
   layer validates only 4 sets — a valid DB row fails app validation.
2. **Orphan `generate_zod.py`.** Root-level generator exists but is not wired
   as source of truth: either CHECK constraints generate the Zod enums or the
   script should be deleted (no-orphan-code, AGENTS.md §0.2).
3. **`batch_id` nullability.** `gateway/migrations/0001_init.sql:119` declares
   `batch_id NOT NULL`, while `routes/attendance.ts:21` treats it as nullable
   optional and `lib/schema.ts` is mixed; `dev.err` empty-string workaround
   papers over the mismatch instead of resolving it.
4. **Contract enums.** `contracts/openapi.yaml` `kind` enum drifts from the
   core TS type enum — two sources of truth for one vocabulary.

## 2. Governing spec / principles

- AGENTS.md §0.2 (no orphan code), §3.4 (two DDL authorities only),
  §6.1 (Zod is source of truth for types), §8 #6 (spec/constitution changes).
- `11_Data_Model.md` (schema authority), `12_Business_Rules.md` BR-ATT-*.
- P11 (no silent failure — empty-string workaround violates it).

## 3. Paths

### Path A — `generate_zod` as source of truth

CHECK constraints (or a single enum manifest) generate Zod schemas + OpenAPI
enums in CI; hand-edits to generated files rejected by lint. `batch_id`
resolved once in the manifest (nullable with dated decision), migration
follows. **Pros:** one vocabulary, drift impossible. **Cons:** tooling work;
generated diffs need review discipline.

### Path B — Hand-sync with CI check

Keep hand-authored Zod/OpenAPI; add a CI check that diffs CHECK-sets vs Zod
sets vs OpenAPI enums and fails on mismatch. Fix `batch_id` by chosen
nullable/NOT NULL decision + forward-only migration. **Pros:** minimal
tooling. **Cons:** humans still sync; check only catches, never prevents.

### Path C — Defer

Document the three mismatches; forbid new enum values until resolved.
**Pros:** zero churn. **Cons:** `holiday` rows keep failing validation.

**RECOMMENDED PATH (RECOMMENDATION ONLY — owner picks): Path A.** Enum drift
is a generator problem; a checker (B) taxes every future value addition.

## 4. Test plan

- CI assertion: CHECK-set ≡ Zod-set ≡ OpenAPI-set (all session/status/kind
  enums); `holiday` round-trips through Zod.
- `batch_id`: nullable-decision fixture — omitted, null, and set all migrate
  and validate; empty-string workaround removed, no `dev.err` regression.
- Orphan check: `generate_zod.py` either wired into build or deleted.

## 5. Rollback

Docs-only: delete this file. If implemented: revert generated files to last
hand-synced tag; forward-only migration for `batch_id` stands (never edited).

## 6. Reviewers

1 reviewer + spec author of `11_Data_Model.md`. Enum-value addition is a spec
amendment first (§0.1).
