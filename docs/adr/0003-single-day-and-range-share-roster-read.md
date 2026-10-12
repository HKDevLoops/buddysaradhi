# 0003. Single-day and range attendance reads share `readAttendanceRoster`

- **Status:** PROPOSED
- **Date:** 2026-10-12
- **Deciders:** owner (approval pending)

## Context

`GET /api/v1/attendance` serves two shapes from one route: the single-day
view (`?date=&batchId=`) and the range view for the dashboard heatmap
(`?from=&to=`, PERF-ATT-10). The single-day path used an inline roster read
that (a) ignored `batchId` and (b) had no bound — so the same
`?date=&batchId=X` request returned every active student instead of X's
batch, uncapped. The day view and the heatmap could therefore disagree about
who is markable, and a heatmap gap was indistinguishable from a missing mark
(`apps/gateway/routes/attendance.ts:349-354`).

## Decision

Both paths call one shared helper, `readAttendanceRoster(orm, batchId)`
(`apps/gateway/routes/attendance.ts:155-194`), which:

- scopes to the batch's enrolled students when `batchId` is supplied
  (two-read pattern: enrollment ids first, then students), otherwise to
  active unarchived students (`status: "active"`, `archivedAt: null` per
  BR-ATT-12);
- caps rows at `ATTENDANCE_ROSTER_MAX` (200) while counting the true
  population over the same filter, returning `{ rows, total, truncated,
  scope }` so a capped roster can never masquerade as complete (Rule 9);
- is called once per request in both the range path
  (`apps/gateway/routes/attendance.ts:280`) and the single-day path
  (`apps/gateway/routes/attendance.ts:355-363`), with per-roster-row
  records and `status: null` for "missing" rendered identically in both.

## Consequences

**Positive:**

- The day view and the heatmap cannot disagree about the markable
  population; "missing" means the same null status in both shapes.
- The batch-scope filter is the primary bound on dashboard cost (the heatmap
  previously re-read an unbounded roster per day); the hard cap plus
  `rosterTotal`/`rosterTruncated` keeps the honesty contract for large
  batches.
- One place to change roster semantics (archival exclusion, ordering,
  cap) instead of two that drift.

**Negative:**

- The cap *can* under-report for batches over 200 members; callers must read
  `rosterTruncated` rather than assuming completeness. The metadata exists,
  but every consumer must honour it.
- The batch-scope path costs an extra enrollment read per request; accepted
  because the ORM cannot join and the alternative (unscoped roster) is the
  bug being fixed.
- Both paths now share one failure domain: a bug in the helper breaks the
  day view and the heatmap together instead of one.

## Alternatives Considered

1. **Fix the inline single-day read in place (add `batchId` + cap),
   keep two reads.** Rejected: two copies of roster semantics is what
   produced the divergence; patching both leaves the next edit to diverge
   them again.
2. **Unbounded roster with client-side truncation.** Rejected: ships up to
   the full student table per dashboard render to display at most 30
   (`HEATMAP_MAX_STUDENTS`); unbounded reads also break past SQLite's
   variable-number limit on the session-id binding.
3. **Separate roster endpoints per view.** Rejected: a new surface for a
   shared concept; the route already fans session + roster out in one
   `Promise.all`, so no round-trip is saved.
