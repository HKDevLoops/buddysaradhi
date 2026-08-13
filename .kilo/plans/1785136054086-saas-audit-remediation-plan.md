# SaaS Audit And Remediation Plan

## Goal
Audit and upgrade `apps/web`, `apps/gateway`, and `supabase/functions` so the current free/hobby-tier deployment behaves like a disciplined SaaS product for web first, while preserving a compatible shared gateway contract for future mobile and desktop clients.

## Scope
- `apps/web`
- `apps/gateway`
- `supabase/functions/gateway`
- `supabase/functions/gateway-graphql`
- `supabase/functions/provision-db`
- Relevant shared query/action layers used by web
- Browser/devtools-based responsive and UX validation with screenshots

## Locked Product Decisions
1. Mistaken fee collections use `void/reverse`, not hard delete.
2. Student deletion is destructive by user choice:
   - delete the student and linked history
   - historical dashboard totals may change retroactively
   - this is an intentional product divergence from an auditable SaaS ledger model
3. Remove Reports UI and eventually remove Reports APIs, but use a compatibility phase so shared clients do not break during the transition.
4. Monthly fees are full-month charges with no proration.
5. Attendance becomes a hybrid model:
   - daily session marking remains core
   - analytics-heavy heatmaps are removed
   - simpler preset summaries are added
6. Product becomes dark-default with softer optional light mode.
7. Required responsive matrix:
   - Phone `390x844`
   - Tablet `768x1024`
   - Laptop `1440x900`
   - Full HD TV `1920x1080`
   - Ultrawide `2560x1440`

## Important Risk Note
The destructive student-delete decision conflicts with enterprise-grade auditability and historical financial integrity. The implementing agent should treat this as a user-approved rule change, not a bug. The plan should still isolate this behavior behind explicit confirmations, warnings, and tests because it can rewrite historical revenue and receipt history.

## Current Code Reality To Plan Against
### Confirmed implementation gaps
1. Logout is inconsistent:
   - `apps/web/src/components/buddysaradhi/glass-shell.tsx` performs client-side `sb.auth.signOut()` inside a silent `catch {}` and manually clears cookies before redirect.
   - server-side signout logic also exists in `apps/web/src/app/api/v1/[...slug]/route.ts` at `/auth/signout`.
   - likely symptom: client logout and server session revocation are not using one canonical path.
2. Dashboard data path is fragmented and partially stubbed:
   - web fires multiple separate client queries for KPIs, feed, due-today, payment heatmap, attendance heatmap.
   - `/reports/dashboard/heatmaps` returns `_data_origin: "STUB"` with synthetic data.
   - `/reports/dashboard/kpis` sets `dueForMonthMinor: 0`, so overdue math is not trustworthy.
3. Dashboard CTA behavior is incomplete:
   - quick action `Generate Report` still exists even though Reports is being removed.
   - screen-switch actions are stateful and need responsive/interaction audit.
4. Student detail drawer still exposes a `Reports` tab and lacks delete/remove actions.
5. Student fee/ledger experience is partial:
   - separate `ledger`, `fees`, `attendance`, `reports` tabs create cognitive overload.
   - receipt visibility and fee-period representation are incomplete.
6. Attendance UX does not match requested simplified preset model.
7. Gateway/web contract still uses `/reports/dashboard/*` naming that no longer matches the intended product shape.
8. No confirmed destructive student delete route exists yet in the inspected gateway/student handlers.

## Desired End State
1. One canonical logout flow works reliably from web and maps cleanly to future mobile/desktop behavior.
2. Dashboard loads quickly with fewer round trips and no stubbed KPI/heatmap data.
3. Dashboard buttons are functional and product-aligned.
4. Web layout is usable from phone through TV/ultrawide.
5. Student page is simpler, clearer, and action-oriented.
6. Fee collection, receipts, ledger, and student fee history are complete and internally consistent.
7. Attendance supports daily marking plus simple preset summaries.
8. Reports disappears as a user-visible concept.
9. Gateway contract supports the same domain model for web/mobile/desktop, with a compatibility window for renamed analytics endpoints.

## Execution Plan

### Phase 1: Audit Baseline And Capture Evidence
1. Run browser/devtools audit on these pages and flows:
   - login
   - dashboard
   - students list
   - student detail
   - attendance
   - fees/payments
   - logout
2. Capture for each required viewport:
   - screenshot
   - overflow/clipping issues
   - broken interactions
   - console/network errors
   - slow requests and duplicate requests
3. Produce a trace table with:
   - page
   - action
   - request path(s)
   - latency
   - visual issue
   - functional issue
4. Record which data is stubbed vs real.

### Phase 2: Canonical Auth And Logout Fix
1. Pick one logout path as canonical for all clients:
   - recommended implementation target: server-mediated signout endpoint with cookie/session revocation
2. Remove client-side silent-failure logout logic as the primary mechanism.
3. Ensure logout does all of the following in one flow:
   - revoke Supabase session if present
   - clear app cookies
   - clear local client cache/state
   - redirect deterministically to login
4. Validate:
   - logout from desktop-width menu
   - logout from mobile nav/profile path
   - back-button does not restore authenticated app state
   - protected routes bounce to login after logout

### Phase 3: Dashboard Performance And Data Integrity
1. Replace fragmented dashboard fetch pattern with a consolidated page-data contract where practical.
2. Remove or redesign any dashboard component depending on stub heatmap data.
3. Replace `/reports/dashboard/*` internals with real analytics calculations while maintaining temporary compatibility aliases.
4. Fix KPI semantics:
   - total students
n   - collected this month
   - total dues
   - overdue for active period
   - revenue totals
5. Rework quick actions:
   - keep only product-valid actions
   - remove `Generate Report`
   - confirm all first-page actions navigate or open the intended workflow
6. Optimize for hobby-tier constraints:
   - reduce duplicate queries
   - avoid unnecessary client waterfalls
   - add caching/revalidation discipline where safe
   - avoid expensive per-render recomputations
7. Validation:
   - compare before/after request count and latency
   - verify no dashboard widget uses stub data

### Phase 4: Responsive Shell And Theme Hardening
1. Audit and correct shell layout for all target viewports.
2. Fix these likely shell issues first:
   - overflow from fixed-width controls
   - hidden/awkward search/avatar interactions
   - mobile bottom nav behavior
   - footer behavior
   - overly sparse layout on TV/ultrawide
3. Define responsive rules for:
   - content max-widths
   - card grids
   - table-to-stack transitions
   - drawer/sheet behavior
4. Theme changes:
   - dark becomes default
   - light mode remains available but with reduced glow/saturation/contrast
   - tone down bright accent wash on light surfaces
5. Validate all pages with screenshots for the required viewport matrix.

### Phase 5: Student Domain Redesign
1. Simplify student page information architecture.
2. Remove the current student-detail `Reports` tab.
3. Collapse student detail into clearer sections:
   - overview
   - fees and receipts
   - attendance summary/history
   - actions
4. Add explicit student actions:
   - edit
   - record payment
   - destructive delete student
5. Because delete is destructive by user choice, require:
   - multi-step confirmation
   - explicit warning that receipts, attendance, and history will be removed
   - post-delete recalculation of dashboard and fee totals
6. Add student-level monthly fee statistics:
   - monthly fee amount
   - paid months
   - outstanding months/current due
   - total collected for selected horizon
7. Ensure the students list is clearer on first use:
   - reduce tab clutter
   - simplify labels
   - ensure important numbers are readable without opening too many subviews

### Phase 6: Fees, Receipts, And Ledger Completion
1. Treat fees domain as the canonical financial surface after Reports removal.
2. Ensure the fees page and student fee tab agree on the same underlying calculations and statuses.
3. Implement/verify these behaviors:
   - full-month fee generation, no proration
   - per-student expected amount by month
   - payment recording
   - receipt generation and listing
   - ledger entry visibility
   - void/reverse mistaken payment
   - recalculated balances after void
4. Show receipts wherever tutors expect them:
   - fees page recent receipts/history
   - student fee/ledger view
5. Replace partial/inconsistent financial views with one coherent model:
   - fee periods
   - invoices/expected charges
   - payments received
   - reversed/voided receipts
   - resulting balance
6. If current schema/handlers cannot support this cleanly, redesign the read models before UI polish.

### Phase 7: Attendance Redesign
1. Keep daily marking as the primary action.
2. Replace heatmap-heavy presentation with preset-driven summaries:
   - Current Month
   - Last Month
   - Last 3 Months
   - Last 6 Months
   - Full Year
3. Provide simple outputs per preset:
   - present count
   - absent count
   - late count if retained
   - percentage
   - per-student or per-batch breakdowns as appropriate
4. Keep session marking fast on mobile and desktop widths.
5. Ensure attendance history remains readable without chart complexity.

### Phase 8: Reports Removal And Gateway Contract Migration
1. Remove all user-visible Reports UI:
   - student detail tab
   - dashboard/report quick actions
   - any leftover navigation affordances
2. Introduce replacement endpoint naming for shared analytics/domain reads, for example under neutral dashboard/analytics namespaces.
3. Keep compatibility aliases for current `/reports/dashboard/*` routes during migration.
4. Migrate web to the new endpoints.
5. After web verifies cleanly, retire old aliases when mobile/desktop consumers are ready.
6. Update gateway and Supabase functions together so the contract remains shared, not web-specific.

### Phase 9: Gateway And Supabase Function Alignment
1. Audit every web-used domain route against gateway and Supabase function behavior.
2. Ensure parity for future clients in these domains:
   - auth-adjacent session handling
   - students
   - attendance
   - fees/ledger/receipts
   - dashboard analytics
3. Remove web-only assumptions from route shape where possible.
4. Document temporary compatibility endpoints introduced during the Reports removal migration.
5. Validate failure behavior for free/hobby tier conditions:
   - cold starts
   - transient upstream failures
   - missing provisioned DB metadata
   - rate/latency pressure

### Phase 10: Validation And Acceptance
1. Functional test matrix:
   - login/logout
   - dashboard load and actions
   - add/edit/delete student
   - record payment
   - void mistaken payment
   - receipt visibility
   - attendance mark/save/view summaries
   - totals recalc after delete and void
2. Browser validation:
   - screenshots for all required viewports
   - devtools network and console clean
   - no broken buttons on first screen
3. Data validation:
   - dashboard totals match underlying fee/ledger state
   - student detail totals match fees page totals
   - destructive student delete removes linked history exactly as requested
   - payment void preserves receipt history but recalculates balances
4. Contract validation:
   - web uses the shared gateway contract only
   - compatibility endpoints continue to work until retirement

## Implementation Order
1. Capture baseline evidence
2. Fix canonical logout
3. Consolidate dashboard data and remove stub dependencies
4. Fix responsive shell and theme defaults
5. Remove user-visible Reports surfaces
6. Redesign student detail and add delete flow
7. Complete fees/receipts/ledger domain behavior
8. Redesign attendance summaries
9. Migrate gateway contract with compatibility layer
10. Run full validation pass and screenshot set

## Non-Negotiable Safety Checks For The Implementing Agent
1. Do not accidentally hard-delete payments; only student deletion is destructive by product choice.
2. Keep payment correction as `void/reverse`.
3. Put explicit warning copy on student delete because it rewrites historical totals.
4. Do not remove compatibility routes before web is migrated.
5. Eliminate silent catches in auth and destructive flows.
6. Replace stub dashboard data before claiming performance or correctness fixes complete.

## Deliverables Expected From Implementation Pass
1. Code changes in web, gateway, and Supabase functions
2. Before/after screenshot pack for required viewports
3. Browser/devtools issue log with resolved status
4. Route contract map old-to-new for reports/analytics migration
5. Final validation checklist with pass/fail notes

## Out Of Scope For This Plan
1. New pricing/business-tier monetization features beyond current product behavior
2. Native mobile or desktop UI implementation
3. Infrastructure migration off current free/hobby hosting

## Final Instruction To Implementer
Treat this as one coordinated audit-remediation program, not isolated bug tickets. Fixing logout, dashboard speed, student clarity, fees correctness, attendance simplicity, and gateway parity separately will reintroduce inconsistency. The work should be executed domain-first, then UI, then compatibility cleanup, then validation.