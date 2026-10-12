# 0007. Tenant auto-scope in the web ORM proxy

- **Status:** PROPOSED
- **Date:** 2026-10-12
- **Deciders:** owner (approval pending), security owner, ledger-crypto reviewer
- **Phase:** PHASE 4 (`docs/rfc/rfc-009-010-ratification.md` §3A Option 1)

## Context

`createLibsqlProxy(client)` (`apps/web/src/lib/libsql-proxy.ts:289`) took no
tenant and the proxy body contained zero `tenant_id` predicates (measured:
`rg -c "tenant_id"` → no matches). `getAuthenticatedPrisma()`
(`apps/web/src/server/get-db.ts:97-104`) held `tenantId` in scope and dropped
it. Isolation therefore rested on ~142 production data statements
(`docs/rfc/rfc-009-010-ratification.md` §4.2) each remembering the filter —
and four had already forgotten it (`docs/rfc/009-tenant-isolation-invariant.md`
§1.1, closed by SEC-HARDEN-01). The next forgotten filter would not be a bug
anyone reports, because nothing made it wrong: the contract
(AGENTS.md §3.6) contained no tenant clause.

The gateway needed no change: `buildTenantWhere`
(`apps/gateway/lib/sql.ts:416-421`) already opens with an unconditional
`tenant_id = ?` and `apps/gateway/lib/auth.ts:124` pins the tenant to the
verified session.

## Decision

Bind the session-derived tenant into the proxy and auto-scope every
statement at the boundary:

- `createLibsqlProxy(client, tenantId?)`. `getAuthenticatedPrisma()` passes
  the session-derived `tenantId` (never a request value); the two direct-DB
  fallback constructions (`server/queries/attendance.ts`,
  `server/queries/students.ts`) bind theirs too. `$transaction` inherits the
  bound tenant into the transaction proxy, so a transaction cannot straddle
  two tenants — a cross-tenant `create` inside it throws and rolls back.
- **Inject:** a non-empty `where` without a tenant claim gets
  `tenantId: <bound>` merged in (both `tenantId` and `tenant_id` spellings
  are recognised). `create`/`upsert`-create payloads inject when absent.
  Call sites need NO edits — the ~142 statements keep working unchanged.
- **Strict:** an absent/empty `where` on a tenant table throws
  `TenantScopeError` (`TENANT_SCOPE_UNSCOPED`) instead of running a
  full-table operation across tenants. Every legitimate full-scope write
  (e.g. the erase cascade) already passes `{ tenantId }`.
- **Fail-closed:** a caller-supplied tenant id that differs from the bound
  tenant throws `TENANT_SCOPE_MISMATCH` — the proxy never overwrites it.
  `update` payloads are validated but never injected (rewriting `tenant_id`
  would move the row; it is the PK of `settings`/`app_state`).
- **Global-table allowlist (frozen):** `student_tags` (pure join table, no
  `tenant_id` column — scoped by the tenant's own student ids at the call
  site), `admin_users` (operator auth, not tenant data — lookups precede any
  tenant context), `schema_migrations` (process bookkeeping). These never
  receive the injection, and a tenant claim on one throws
  `TENANT_SCOPE_ON_GLOBAL` instead of emitting SQL against a missing column.
  Any other table — including unknown model names — is tenant-scoped by
  default, so a new table without `tenant_id` must be added here
  deliberately (RFC 009 §3.3).
- **One escape hatch:** `allowUnscopedTenantAccess`, a sibling of `where`
  consumed before SQL is built. Its only production use is the deliberate
  cross-tenant existence probe in `ensureBatch`
  (`server/actions/attendance.ts:112`) — a probe whose purpose is to see
  another tenant's row, so auto-scope would have silently neutered it. Grep
  the name to audit every bypass; a second use needs its own review. The
  hatch never overrides an explicit conflicting tenant claim.
- **Residual (documented, not hidden):** the parameter is optional, so the
  legacy single-arg form keeps passthrough behaviour for the test suite and
  `lib/db.ts` (no production callers, no tenant in scope). Binding to an
  empty string throws. Making the parameter required is the follow-up once
  test constructions are swept (RFC 009 §3.2 step 3).

## Consequences

**Positive:**

- The four-findings class becomes unrepeatable: a forgotten filter on a
  bound proxy is a loud `TenantScopeError`, not a silent cross-tenant read.
  The single-tenant-per-DB boundary stays primary; the shim becomes the
  secondary enforcement AGENTS.md §1.2 claims it is.
- The 142 call sites needed zero edits — the guarantee is structural, not
  conventional. The only data-statement edit is the deliberate probe, which
  now declares its intent instead of looking like the bug it resembles.
- `orderBy`/`select`/`$transaction` semantics are untouched (§3.6 contract
  preserved); unbound proxies behave byte-identically to before, so the
  existing suite passes without fixture changes.

**Negative:**

- Strictness has a sharp edge: any future tenant-table statement with a
  genuinely empty `where` on a bound proxy throws at runtime, not at
  compile time. Mitigated by the code (`TENANT_SCOPE_UNSCOPED` names the
  model, the table, and the fix) but not eliminated — reviewers must still
  read the error.
- The optional parameter leaves one un-enforced construction path
  (`lib/db.ts`, test fixtures). Until the required-parameter follow-up
  lands, a NEW production construction that forgets the tenant silently gets
  legacy behaviour — the exact class this ADR kills everywhere else.
  Mitigated by `lint:principles` coverage of `createLibsqlProxy(` call
  sites (RFC 009 §5), not eliminated.
- `create` now returns the scoped copy (injected `tenantId` included)
  rather than the caller's object identity. No caller depended on identity
  (verified by the unchanged suite), but it is a visible shape change on
  the contract surface.

## Alternatives Considered

1. **Edit all ~142 call sites to pass the tenant (bulk sweep).**
   Rejected: it re-states the convention without enforcing it — the 143rd
   call site can forget again, and nothing makes it wrong. The proxy
   boundary is the single choke point every statement already flows
   through; enforcing there subsumes the sweep (ratification doc §4.2).
2. **Startup assertion + lint rule only (Option 2).** Rejected as the
   sole fix: a cheap tripwire that catches the realistic failure but
   guarantees nothing — a dynamic filter still slips through (review
   packet Phase 4a con). Kept as a complementary follow-up, not the fix.
3. **Accept single-tenant-per-DB as sufficient (Option 3).** Rejected: it
   leaves any DB-connection mix-up unrecoverable, and is only valid while
   the shared-DB fallback deletion holds — without the physical boundary,
   `tenant_id` is the only isolation and the shim enforced none (§2.1).
4. **Required tenant parameter immediately.** Rejected for this slice: it
   breaks ~40 test constructions at once and forces fixture edits across
   suites that pin legacy behaviour — a >500-line-adjacent diff that trips
   the §8 large-PR gate. Phased instead: optional now (this ADR), required
   as the recorded follow-up (RFC 009 §3.2 steps 1→3).
