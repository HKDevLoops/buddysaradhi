# RFC-008: GraphQL Reads Through Audited Builders

**Status:** Draft — owner picks. No code changed.
**Date:** 2026-10-04

## 1. Problem (with evidence)

`apps/gateway/graphql/index.ts:219,256` issues raw `SELECT … ORDER BY` reads
that duplicate the audited path: the purpose-built `stmtGraphql*` builders in
`lib/sql.ts:1186-1233` are LIVE via `graphql/resolvers.ts:4-8,71,103` (review
correction 2026-10-04 — `index.ts` is the duplicate path, not the builders).
Raw reads miss whatever the builders guarantee (tenant scoping, consistent
ordering/tie-breaks, soft-delete filtering). CORS/500 handling on the GraphQL
surface is already fixed — this RFC is read-path unification only, not error
handling.

## 2. Governing spec / principles

- AGENTS.md §0.2 (dead builders get used or deleted), §3.4 (ORM-only runtime;
  raw SQL auto-blocked by CI L6), §8 #2-adjacent (new query surface sensitivity).
- `17_API_Gateway_System.md` (gateway as single backend entry point),
  `10_Security.md` (tenant isolation, injection posture).
- P11 (no silent failure — an unfiltered read fails silently for the tutor).

## 3. Paths

### Path A — Route GraphQL reads through audited builders + delete dead code

Replace both raw SELECTs with `orm.ts`/`sql.ts` builder calls; delete
`stmtGraphql*` or re-implement builders on top of them so exactly one read
path exists. **Pros:** one guarantee set; dead code gone. **Cons:** builder
API may need a GraphQL-shaped projection (paginated, field-selected) first.

### Path B — Keep standalone, minimal fix (pk tie-break only)

Leave raw SELECTs; add deterministic pk tie-break to each ORDER BY and
assert tenant predicate + soft-delete filter inline with a comment citing
this RFC. **Pros:** smallest diff. **Cons:** two read paths persist; every
future filter must be duplicated by discipline.

### Path C — Defer

Document the bypass; forbid new GraphQL resolvers until unified.
**Pros:** zero risk. **Cons:** dead builders rot further; bypass normalises.

**RECOMMENDED PATH (RECOMMENDATION ONLY — owner picks): Path A.** A second
read path with weaker guarantees next to audited builders is §3.4 debt with
security adjacency.

## 4. Test plan

- Resolver fixtures: multi-tenant rows + soft-deleted rows → GraphQL returns
  only own-tenant, non-deleted rows (A and B).
- Ordering determinism: duplicate sort keys → stable pk tie-break order.
- Dead-code check: `stmtGraphql*` either called or absent (lint).
- L6 lint (`scripts/principle-lints.ts`) passes on the touched files.

## 5. Rollback

Docs-only: delete this file. If implemented: revert resolvers to prior tag;
restored raw SELECTs keep the pk tie-break (B-level safety retained).

## 6. Reviewers

Security reviewer (§8 #2-adjacent: query-surface change) + 1 gateway reviewer.
