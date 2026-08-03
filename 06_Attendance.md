# 06 — Attendance

> The third of the five Buddysaradhi screens. A tutor marks today's attendance in 30 seconds, locks it with a fingerprint, and never has to argue about "who was here" again. Apple-feel toggles, Kite-density grids, Discord-flow switching between Daily / Calendar / Heatmap views — all offline-first.

---

## 1. Purpose

The Attendance screen is the daily ritual surface of Buddysaradhi. It exists to convert the tutor's act of *taking attendance* — today a 4-minute register + WhatsApp ritual — into a sub-30-second tactile gesture on a phone, tablet, or laptop. Every record is timestamped, lockable, auditable, and survivable across offline devices.

The screen absorbs three jobs that used to live in three separate tools: (a) the paper register's *mark*, (b) the Excel sheet's *monthly report*, and (c) the parent-facing "my child was marked absent?" dispute resolution. All three collapse into one screen with three view modes (Daily, Calendar, Heatmap) plus a per-day lock that makes the record authoritative the moment the tutor walks away from the class.

---

## 2. Business Objective

A coaching institute's revenue leaks are dominated by two blind spots: (i) students who quietly stop attending but whose fees keep being charged, and (ii) attendance disputes ("my child was there!") that erode trust. Buddysaradhi Attendance attacks both:

- **Dispute defence.** A locked, biometric-sealed, audit-trailed attendance record is non-repudiable. The tutor can show a parent exactly who marked what, when, on which device, and prove it has not been tampered with.
- **Churn visibility.** A per-student heatmap makes a sliding student visible inside 7 days, not 30. The Reminder Engine consumes the same records and surfaces "Inactive Student" reminders (BR-RPT-04) automatically.
- **Time recovery.** Reducing 4 minutes/day of attendance ritual to 30 seconds recovers ~12 hours/year per tutor — time spent on teaching, not bookkeeping.

North-star impact: **lowers** minutes-per-day inside Buddysaradhi. The faster attendance is done, the less the tutor lives in the app.

---

## 3. Navigation Entry

- **Sidebar item #3** in `GlassShell` — icon `CalendarCheck`, label "Attendance", active state cyan inset bar (`13_UI_Guidelines.md` §8.5 Segmented Control + §8.6 Tab Bar).
- **Keyboard shortcut:** `G A` (jump to Attendance — see `13_UI_Guidelines.md` §10.7 Keyboard Parity).
- **Command Palette (`⌘K`):** typing "attendance", "mark today", "yesterday's attendance" deep-links into the screen with the relevant batch + date preselected.
- **Deep-link from Dashboard:** the Dashboard "Missing Attendance" reminder card and the Attendance Heatmap card both deep-link to `?s=attendance&batch=<id>&date=<yyyy-mm-dd>` (parsed by the shell, never a new URL route — see `02_Core_Logic.md` §5).
- **Deep-link from Students:** a student's profile "Attendance" tab opens this screen pre-filtered to that student's batch and heatmap-focused.

---

## 4. User Story

> Rohan teaches a 6 pm Maths batch to 32 Class-10 students. At 6:02 pm he unlocks his phone, taps the Attendance icon. The screen already shows today's date and his only active batch — `Class 10 — Maths — 6pm`. He taps "Mark all Present" (one tap, haptic thunk). Three students walk in late; he long-presses their toggles, each cycling `present → late` with an amber flash. One student is absent; he taps the absent toggle. At 6:05 pm he taps "Lock" and rests his finger on the fingerprint scanner. The toggle compresses with a tactile thunk; the status chip flips from "Saved locally · 3 pending" to "Locked · Synced". He puts the phone away. Total time: 3 minutes for 32 students.
>
> Two weeks later a parent calls: "My daughter was marked absent on the 7th, she was definitely there." Rohan opens the Calendar view, clicks 7 Aug, sees the locked record, taps "Unlock", enters his PIN, edits the toggle, and the audit log captures the change with his name, timestamp, old/new status, and reason. He re-locks. The parent receives a fresh statement showing the corrected record and the audit trail entry. Dispute closed in 90 seconds.

---

## 5. UX Principles

This screen is governed by these `01_Product_Principles.md` principles:

- **P2 — Five Screens, Forever.** Attendance is one of the five; it must absorb calendar, heatmap, reports, holiday management, and locking without spawning sub-screens.
- **P3 — Two-Tap Rule.** "Mark all Present" is one tap from the sidebar; "Lock" is the next tap. Two taps to a locked, synced session.
- **P5 — Offline-First, Always.** The toggle writes to local SQLite in <16 ms. The cloud is the replica; the network is never on the critical path.
- **P7 — Motion Is Meaning.** The toggle's emerald glow confirms *present*; the lock's compressive thunk confirms *frozen*. No decorative animation.
- **P8 — Density Without Clutter.** A 36-student batch is visible on one mobile screen and on one desktop row block, every column earning its pixels.
- **P11 — Security Is Tactile.** Locking with a fingerprint is *felt*; an "Are you sure?" dialog is not. The biometric prompt is the entire confirmation.
- **P12 — Tutor's Time Is the Metric.** The default view is *today's* session for *the most recently used batch*, not a date picker on a blank screen.
- **P15 — Honest Empty States.** A new batch with no sessions yet shows "No sessions yet for this batch — pick a date and mark your first attendance," with a single emerald CTA.

---

## 6. Screen Layout

The Attendance screen has one persistent header (batch + date + view switcher) and three interchangeable view panes. The footer's sync status is global (`02_Core_Logic.md` §1.3) and not redrawn here.

### 6.1 Daily Grid View (default landing)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  ATTENDANCE                                  [ ● Daily | Calendar | Heatmap ]        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Batch  [ Class 10 — Maths — 6pm  ▾ ]   Date  [ ◀  Mon 12 Aug 2024  ▶ ]  [ Today ]  │
│                                                              [ 🔒 Lock ]  [ ⋯ Holiday ] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│   ✓ 28 Present      ✕ 4 Absent      ◐ 3 Late      — 1 Excused                        │
│                                            Saved locally · 3 pending  ▸ Synced ✓     │
├──────┬──────────────────────────────────┬────────┬─────────────┬──────────────────┤
│  #   │  Student                         │  Fee   │  Status     │  Toggle          │
├──────┼──────────────────────────────────┼────────┼─────────────┼──────────────────┤
│  1   │  Aarav Sharma    STU-0007        │   —    │  Present    │  ●━━○  [ ✓ ]      │
│  2   │  Diya Patel      STU-0012        │   ●    │  Present    │  ●━━○  [ ✓ ]      │
│  3   │  Ishaan Verma    STU-0019        │   —    │  Late  ◐    │  ●━━○  [ ✓ ]  ⌐   │  ← long-press
│  4   │  Kabir Singh     STU-0024        │   —    │  Absent     │  ○━━●  [ ✕ ]      │
│  5   │  Meera Iyer      STU-0031        │   —    │  Excused    │    — — —          │
│  ...                                                                                 │
│  36  │  Zoya Khan       STU-0048        │   —    │  Present    │  ●━━○  [ ✓ ]      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  [ ✓ Mark all Present ]   [ ✕ Mark all Absent… ]      36 / 36 marked   [ Synced ✓ ]  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Layout notes:
- **Header row:** `BatchSelector` (glass dropdown), `DatePicker` (segmented ◀ / label / ▶ + Today chip), `LockButton` (emerald when unlocked, slate when locked with a small lock glyph), `HolidayToggle` (in the `⋯` overflow).
- **Summary strip:** present/absent/late/excused counts with their respective accent colors (emerald / flare / amber / muted-violet). Right-aligned sync chip animates from amber "Saved locally · N pending" → cyan "Syncing…" → emerald "Synced ✓".
- **Grid:** sticky-header data table, sticky first column (student name) on horizontal scroll. Each row is a `StudentAttendanceRow`. The `Fee` column shows an amber dot when the student is prepaid-unpaid (BR-FEE-08 soft warning) — tapping the dot opens the fee tooltip; it never blocks marking.
- **Bulk action bar:** sticky-bottom; "Mark all Present" is the primary emerald CTA; "Mark all Absent…" is a destructive flare-tinted ghost button that requires a second confirmation sheet (BR-ATT-06).
- **Lock state:** when `locked_at IS NOT NULL`, every toggle is replaced by a static state pill (no knob), the `LockButton` shows "🔒 Locked · tap to unlock", the `HolidayToggle` is disabled, and the bulk bar is hidden.

### 6.2 Calendar Month View

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ATTENDANCE — Calendar        Batch [ Class 10 ▾ ]     [ ◀  Aug 2024  ▶ ]  [ Today ]  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│   Mon     Tue     Wed     Thu     Fri     Sat     Sun                                  │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                                │
│  │     │ │     │ │     │ │  1  │ │  2  │ │  3  │ │  4  │                                │
│  │     │ │     │ │     │ │ 92% │ │ 88% │ │  —  │ │  —  │                                │
│  │     │ │     │ │     │ │ ●28 │ │ ●26 │ │     │ │     │                                │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                                │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                                │
│  │  5  │ │  6  │ │  7  │ │  8  │ │  9  │ │ 10  │ │ 11  │                                │
│  │ 95% │ │ 90% │ │▒HOL▒│ │ 85% │ │ 91% │ │  —  │ │  —  │                                │
│  │ ●30 │ │ ●27 │ │ ▒▒▒ │ │ ●25 │ │ ●28 │ │     │ │     │                                │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                                │
│  ┌─────┐ ┌─────┐ ┌─────┐                                                            │
│  │ 12  │ │ 13  │ │ 14  │   …   today = 12 Aug (cyan ring + glow)                    │
│  │TODY │ │ 87% │ │ 92% │                                                        │
│  │ ●28 │ │ ●26 │ │ ●28 │                                                        │
│  └─────┘ └─────┘ └─────┘                                                            │
│                                                                                       │
│  Legend:  ● = present count     ▒ = holiday (violet stripe)    — = no session        │
│          heat by %:  emerald ≥90   cyan ≥75   amber ≥50   flare <50                 │
│          🔒 corner ribbon = locked session                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Layout notes:
- Each `CalendarCell` is a glass tile 64×64 (mobile) / 96×72 (desktop) showing day-of-month (top-left), attendance % (centre, mono), and present-count pill (bottom). Cell background colour is interpolated by % per the legend.
- Today's cell carries a cyan ring + soft glow (no parallax, no rotation).
- Holidays get a violet diagonal stripe overlay + a `HolidayBadge`.
- Locked sessions get a small `🔒` glyph in the top-right corner.
- Tap a cell → switches to Daily Grid View with that date preselected.
- Long-press a cell → context sheet (Lock/Unlock, Mark as Holiday, Edit Notes, Jump to Heatmap).
- Weekends are dimmed only if the batch's `schedule` (per `batches.schedule` JSON) excludes them; if the batch meets Saturdays, those cells behave like weekdays.

### 6.3 Heatmap View (student × day matrix)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ATTENDANCE — Heatmap         Batch [ Class 10 ▾ ]      [ ◀  Aug 2024  ▶ ]            │
├──────────────────────────────────────────────────────────────────────────────────────┤
│              01  02  03  04  05  06  07  08  09  10  11  12  13  …  30  │  %   │  Late│
│  Aarav S.   ▓   ▓   ▒   ▓   ▓   ·   ·   ▓   ▓   ▓   ▓   ▓   .   …  ▓   │  96  │   0  │
│  Diya P.    ▓   ▓   ▒   ▓   ▒   ·   ·   ▓   ▓   ▓   ▒   ▓   .   …  ▓   │  88  │   1  │
│  Ishaan V.  ◐   ▓   ▒   ▓   ▓   ·   ·   ◐   ▓   ▓   ▓   ▓   .   …  ▓   │  92  │   3  │
│  Kabir S.   ▓   ▓   ▒   ▓   ▓   ·   ·   ✕   ▓   ▓   ▓   ▓   .   …  ▓   │  88  │   0  │
│  Meera I.   —   —   ▒   —   —   ·   ·   —   —   —   —   —   .   …  —   │   0  │   0  │
│  …                                                                                    │
│  Zoya K.    ▓   ▓   ▒   ▓   ▓   ·   ·   ▓   ▓   ▓   ▓   ▓   .   …  ▓   │  96  │   0  │
│                                                                                       │
│  Legend:  ▓ present (emerald)   ◐ late (amber)   ✕ absent (flare)                     │
│           — excused (muted-violet)   ▒ holiday (violet stripe)   · no session         │
│           today's column highlighted with a vertical cyan band                        │
│  Click a cell → drill to that (student, date) in Daily view.                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Layout notes:
- One row per enrolled student; one column per calendar day in the selected month.
- Cells are 12×12 px (mobile) / 16×16 px (desktop) per `13_UI_Guidelines.md` §8.12 (Heatmap Cell).
- Right-side gutter: per-student attendance % (BR-CALC-06) + late count.
- Today's column carries a vertical cyan band behind the cells.
- Hover (desktop) or long-press (mobile) a cell → tooltip with student, date, status, marked_at, locked/unlocked.
- Click → drill to Daily View with that student's row pre-highlighted.
- Virtualised both axes; 100 students × 30 days = 3 000 cells must render in <300 ms (see §17).
- This is the same heatmap surface that the Dashboard consumes via the Report Engine; the data is generated here and cached in TanStack Query under `['attendance','heatmap', batchId, yyyy-mm]`.

### 6.4 Lock / Unlock Sheet (modal)

```
┌────────────────────────────────────────┐
│         Lock this session?             │
│                                        │
│  Class 10 — Maths — 6pm                │
│  Mon 12 Aug 2024  ·  36 students       │
│                                        │
│  Once locked, edits require your PIN   │
│  and are written to the audit log.     │
│                                        │
│        [ Place your finger ]           │  ← biometric prompt (preferred)
│            ── or ──                    │
│        [ Enter 6-digit PIN  ]          │  ← PIN fallback
│                                        │
│       [ Cancel ]      [ Lock ]         │
└────────────────────────────────────────┘
```

Unlock sheet is identical but titled "Unlock this session?" and the confirm button is flare-tinted (destructive intent — re-opens frozen records).

---

## 7. Component Tree

```tsx
<AttendancePage>
  <AttendanceHeader>
    <ViewSwitcher value={view} onChange={setView} />            // 'daily' | 'calendar' | 'heatmap'
    <BatchSelector value={batchId} onChange={setBatchId} />     // batches with active enrollments only
    <DatePicker value={date} onChange={setDate} />              // ◀ label ▶ + Today chip
    <LockButton session={session} onLock={handleLock} onUnlock={handleUnlock} />
    <HolidayToggle session={session} onSetHoliday={handleHoliday} />
  </AttendanceHeader>

  <AttendanceSummary session={session} records={records} syncStatus={syncStatus} />

  {view === 'daily'    && <DailyGrid session={session} records={records} enrollments={enrollments} />}
  {view === 'calendar' && <CalendarMonth batchId={batchId} month={month} sessions={monthSessions} />}
  {view === 'heatmap'  && <Heatmap batchId={batchId} month={month} matrix={heatMatrix} />}

  <BulkActionBar visible={view === 'daily' && !session.locked_at}>
    <BulkMarkAllPresent onMark={handleBulkPresent} />
    <BulkMarkAllAbsent onMark={handleBulkAbsent} />   // opens confirmation sheet
  </BulkActionBar>

  <LockSheet   open={lockSheetOpen}   session={session} onConfirm={confirmLock}   onClose={closeLockSheet}   />
  <UnlockSheet open={unlockSheetOpen} session={session} onConfirm={confirmUnlock} onClose={closeUnlockSheet} />
  <HolidaySheet open={holidaySheetOpen} session={session} onConfirm={confirmHoliday} onClose={closeHolidaySheet} />
  <EditLockedSheet open={editLockedOpen} record={editTarget} onConfirm={confirmEditLocked} onClose={closeEditLocked} />
  <RequestUnlockSheet open={requestUnlockOpen} session={session} onSubmit={submitRequestUnlock} />
</AttendancePage>
```

### Prop types (TypeScript)

```ts
type AttendanceView = 'daily' | 'calendar' | 'heatmap';
type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'holiday';

interface AttendanceSession {
  id: string;
  batchId: string;
  sessionDate: string;          // ISO yyyy-mm-dd
  startedAt: string | null;
  lockedAt: string | null;
  lockedBy: 'pin' | 'biometric' | 'auto' | null;
  notes: string | null;
}

interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  markedAt: string;
  markedBy: 'tutor' | 'system';
  notes?: string | null;
}

interface DailyGridProps {
  session: AttendanceSession;
  records: AttendanceRecord[];
  enrollments: StudentEnrollment[];   // active on sessionDate
}

interface StudentAttendanceRowProps {
  student: Student;
  record: AttendanceRecord | undefined;   // undefined = not yet marked
  locked: boolean;
  onToggle: (next: AttendanceStatus) => void;
  onLongPress: () => void;                // cycles to 'late'
}

interface PresentAbsentToggleProps {
  value: AttendanceStatus;
  locked: boolean;
  onChange: (next: AttendanceStatus) => void;
  onLongPress: () => void;
}

interface CalendarCellProps {
  date: string;
  session?: AttendanceSession;
  pct?: number;                  // BR-CALC-06
  presentCount?: number;
  isHoliday: boolean;
  isToday: boolean;
  onSelect: (date: string) => void;
  onLongPress: (date: string) => void;
}

interface HeatmapCellProps {
  studentId: string;
  date: string;
  status: AttendanceStatus | 'no_session';
  isToday: boolean;
  onDrill: (studentId: string, date: string) => void;
}

interface LockButtonProps {
  session: AttendanceSession;
  onLock: () => void;
  onUnlock: () => void;
}

interface HolidayBadgeProps { date: string; reason?: string; }

interface LateChipProps { count: number; }
```

Sub-components follow `13_UI_Guidelines.md` recipes (Glass Card §5.1, Neumorphic Toggle §6.4 + §8.16, Heatmap Cell §8.12). The `PresentAbsentToggle` is a specialisation of §6.4 with three-state logic (present ↔ absent, long-press → late). See §10 for the toggle's interaction contract.

---

## 8. State Management

### 8.1 Local UI state (Zustand slice)

```ts
// src/stores/attendance-store.ts
interface AttendanceState {
  view: AttendanceView;
  batchId: string | null;          // defaults to last-used batch (persisted)
  date: string;                    // ISO yyyy-mm-dd, defaults to today
  monthCursor: string;             // yyyy-mm for calendar/heatmap
  lockSheetOpen: boolean;
  unlockSheetOpen: boolean;
  holidaySheetOpen: boolean;
  editLockedTarget: { recordId: string; studentId: string } | null;
  requestUnlockOpen: boolean;

  setView: (v: AttendanceView) => void;
  setBatch: (id: string) => void;
  setDate: (d: string) => void;
  shiftDate: (delta: 1 | -1) => void;
  shiftMonth: (delta: 1 | -1) => void;
  openLockSheet: () => void;
  openUnlockSheet: () => void;
  // ...
}
```

The slice is **persisted** to `localStorage` (web) / `AsyncStorage` (mobile) / `app_config.json` (desktop) so a tutor returning to the screen lands on the same batch + date they left. The persisted shape excludes modal-open flags (those reset on mount).

### 8.2 Server-state (TanStack Query)

| Query key | Returns | Stale time |
|-----------|---------|------------|
| `['attendance','session', batchId, date]` | `{ session, records }` | 30 s |
| `['attendance','month', batchId, yyyy-mm]` | `AttendanceSession[]` (sparse — only days with a session) | 60 s |
| `['attendance','heatmap', batchId, yyyy-mm]` | `HeatMatrix` (student × day grid) | 60 s |
| `['attendance','summary', batchId, studentId]` | Per-student pct + late count (BR-CALC-06) | 5 min |
| `['batches','active']` | Active batches for the BatchSelector | 1 h |

Mutations use `useMutation` with **optimistic update + rollback**:

```ts
const toggleMutation = useMutation({
  mutationFn: (vars: { sessionId: string; studentId: string; status: AttendanceStatus }) =>
    attendanceApi.upsertRecord(vars),
  onMutate: async ({ sessionId, studentId, status }) => {
    const key = ['attendance','session', batchId, date];
    await queryClient.cancelQueries(key);
    const prev = queryClient.getQueryData(key);
    queryClient.setQueryData(key, (old) => ({
      ...old,
      records: old.records.map(r =>
        r.studentId === studentId ? { ...r, status, markedAt: new Date().toISOString() } : r
      ),
    }));
    return { prev };
  },
  onError: (_err, _vars, ctx) => {
    queryClient.setQueryData(['attendance','session', batchId, date], ctx.prev);
    toast.error('Toggle failed — rolled back. Tap to retry.');
  },
  onSettled: () => {
    queryClient.invalidateQueries(['attendance','session', batchId, date]);
    queryClient.invalidateQueries(['attendance','month', batchId, month]);
    queryClient.invalidateQueries(['attendance','heatmap', batchId, month]);
  },
});
```

### 8.3 Optimistic toggle + rollback semantics

Every toggle:
1. Writes to local SQLite immediately (offline-first, < 16 ms).
2. Updates the React Query cache optimistically.
3. Enqueues a `sync_outbox` row.
4. If the upsert fails on the local DB (e.g., locked trigger fires), the cache is rolled back and a toast surfaces.
5. If the local write succeeds but the network flush fails, the record remains visible as "Saved locally · N pending" — never lost, surfaced in the footer.

---

## 9. Database Operations

All queries go through `import { db } from '@/lib/db'` using Prisma ORM methods. No raw SQL, no string interpolation (`10_Security.md` §9).

### 9.1 Fetch session + records (Daily view)

```ts
// Fetch-or-default session (the client lazily creates one on first toggle — see §9.2)
const session = await db.attendanceSession.findFirst({
  where: { batchId, sessionDate, tenantId },
});

// Fetch records (with student data via include)
const records = await db.attendanceRecord.findMany({
  where: { sessionId: session?.id, tenantId },
  include: { student: { select: { firstName: true, lastName: true, code: true, status: true } } },
  orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
});
```

Active enrollments for the grid (so we know which students to render even if they have no record yet):

```ts
const enrollments = await db.studentEnrollment.findMany({
  where: {
    batchId, tenantId,
    joinedOn: { lte: sessionDate },
    OR: [{ exitedOn: null }, { exitedOn: { gte: sessionDate } }],
    student: { status: 'active', archivedAt: null },
  },
  include: { student: { select: { id: true, firstName: true, lastName: true, code: true } } },
  orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
});
```

### 9.2 Upsert record (toggle, bulk, edit)

```ts
await db.$transaction(async (tx) => {
  // Ensure session row exists (idempotent upsert)
  const sess = await tx.attendanceSession.upsert({
    where: { batchId_sessionDate: { batchId, sessionDate } },
    create: { id: uuidv7(), tenantId, batchId, sessionDate, createdAt: nowIso, updatedAt: nowIso },
    update: {},
  });

  // Upsert the record
  await tx.attendanceRecord.upsert({
    where: { sessionId_studentId: { sessionId: sess.id, studentId } },
    create: {
      id: uuidv7(), tenantId, sessionId: sess.id, studentId, status, markedAt: nowIso,
      markedBy: 'tutor', createdAt: nowIso, updatedAt: nowIso,
    },
    update: { status, markedAt: nowIso, markedBy: 'tutor', updatedAt: nowIso },
  });

  // BR-SYN-02: enqueue sync_outbox in the same TX
  await tx.syncOutbox.create({ data: {
    id: uuidv7(), tenantId, tableName: 'attendance_records', rowId: studentId,
    op: 'update', payload: { sessionId: sess.id, studentId, status }, status: 'pending', createdAt: nowIso,
  } });
});
```

If the session is locked (`locked_at IS NOT NULL`), the client refuses to call this without first running through `confirmEditLocked` (BR-ATT-07), which writes the audit row *before* the upsert (fail-closed per `10_Security.md` §4).

### 9.3 Lock session

```ts
const result = await db.attendanceSession.updateMany({
  where: { id: sessionId, tenantId, lockedAt: null },
  data: { lockedAt: nowIso, lockedBy: actor, updatedAt: nowIso },
});
// if result.count === 0, someone else locked it in the meantime → toast "Already locked".

// Audit row (written in the same db.$transaction):
await db.auditLog.create({ data: {
  id: uuidv7(), tenantId, actor, action: 'attendance_lock',
  refType: 'attendance_session', refId: sessionId,
  metadata: { batchId, sessionDate, method }, createdAt: nowIso,
} });
```

### 9.4 Unlock session

```ts
await db.$transaction(async (tx) => {
  await tx.attendanceSession.update({
    where: { id: sessionId, tenantId },
    data: { lockedAt: null, lockedBy: null, updatedAt: nowIso },
  });
  await tx.auditLog.create({ data: {
    id: uuidv7(), tenantId, actor, action: 'attendance_unlock',
    refType: 'attendance_session', refId: sessionId, createdAt: nowIso,
  } });
});
```

### 9.5 Mark session as holiday

```ts
await db.$transaction(async (tx) => {
  // Append 'HOLIDAY:<reason>' to notes
  const sess = await tx.attendanceSession.findUniqueOrThrow({ where: { id: sessionId, tenantId } });
  await tx.attendanceSession.update({
    where: { id: sessionId, tenantId },
    data: { notes: `${sess.notes ?? ''}\nHOLIDAY:${reason}`.trim(), updatedAt: nowIso },
  });

  // Soft-mark existing records so they no longer count toward % (status flip, not hard-delete)
  await tx.attendanceRecord.updateMany({
    where: { sessionId, tenantId },
    data: { status: 'holiday', updatedAt: nowIso },
  });

  await tx.auditLog.create({ data: {
    id: uuidv7(), tenantId, actor, action: 'attendance_holiday',
    refType: 'attendance_session', refId: sessionId, metadata: { reason }, createdAt: nowIso,
  } });
});
```

> Note: per BR-ATT-04 the spec says records are *deleted (soft)*; we implement this as a status flip to `'holiday'` rather than `deleted_at` set, because the audit trail benefits from knowing the prior status (and `BR-CALC-06` already excludes `'holiday'` from the denominator). This is the implementation choice; the user-visible behaviour is identical.

### 9.6 Monthly heatmap aggregation

```ts
// One row per (student, day) for the month; client pivots into a matrix
const rows = await db.attendanceRecord.findMany({
  where: {
    session: {
      tenantId, batchId,
      sessionDate: { gte: monthStart, lt: nextMonthStart },
    },
  },
  include: { session: { select: { sessionDate: true } } },
  orderBy: [{ studentId: 'asc' }, { session: { sessionDate: 'asc' } }],
});
```

The pivot to `{ studentId → { day → status } }` is performed client-side in <5 ms for 100 students × 30 days.

### 9.7 Attendance % per student (BR-CALC-06)

```ts
// Two groupBy calls (total + presentOrLate); engine divides in TS.
const [totals, presentLate] = await Promise.all([
  db.attendanceRecord.groupBy({
    by: ['studentId'],
    where: {
      status: { notIn: ['holiday', 'excused'] },
      session: { tenantId, batchId },
    },
    _count: { _all: true },
  }),
  db.attendanceRecord.groupBy({
    by: ['studentId'],
    where: {
      status: { in: ['present', 'late'] },
      session: { tenantId, batchId },
    },
    _count: { _all: true },
  }),
]);
// pct = round(100 * presentLate_count / max(totals_count, 1), 1)
```

### 9.8 Sync-outbox enqueue (every mutation)

```ts
// Already shown inline in §9.2 / §9.3 / §9.4 / §9.5 — every mutation writes a
// sync_outbox row in the same db.$transaction. Pattern:
await tx.syncOutbox.create({ data: {
  id: uuidv7(), tenantId, tableName: 'attendance_records', rowId: studentId,
  op: 'update', payload: { sessionId, studentId, status }, status: 'pending', createdAt: nowIso,
} });
```

The sync engine (see `13_Sync_Engine.md`, forthcoming) flushes these on connectivity per BR-SYN-01/SY03.

---

## 10. Business Rules

This screen enforces the Attendance rules from `12_Business_Rules.md` §5 plus the auto-lock, hard-lock, and re-marking flows.

### 10.1 BR-ATT-01 — Session Uniqueness
One `attendance_sessions` row per `(batch_id, session_date)`. The upsert in §9.2 is `ON CONFLICT DO NOTHING` for the session insert and `ON CONFLICT DO UPDATE` for the record — guaranteeing re-marking updates in place, never duplicates. The `UNIQUE(batch_id, session_date)` constraint is the last line of defence.

### 10.2 BR-ATT-02 — Status Vocabulary
The five allowed statuses are `present | absent | late | excused | holiday`. The toggle exposes only `present`/`absent` as the primary pair; `late` is reachable via long-press on `present`; `excused` via the row's `⋯` overflow (rare action); `holiday` is set at the session level, not per-record.

- `present` / `late` count as attended for %.
- `absent` counts against %.
- `excused` and `holiday` are excluded from the denominator (BR-CALC-06).

### 10.3 BR-ATT-03 — Locking

| Phase | Trigger | Editable? | Required auth |
|-------|---------|-----------|---------------|
| Unlocked | `locked_at IS NULL` and within `attendance_lock_hours` (default 48 h) of `session_date` | Yes (free) | App unlock suffices |
| Auto-locked | `now - session_date > attendance_lock_hours` | No (frozen) | PIN / biometric to unlock |
| Manually locked | Tutor taps Lock | No (frozen) | PIN / biometric to unlock |
| Hard-locked | `now - session_date > 30 days` | No (frozen, no direct unlock) | "Request unlock" flow (see §10.6) |

Locking writes `audit_log` action `attendance_lock` with metadata `{ method: 'biometric'|'pin'|'auto' }`. Auto-lock is performed by a background job (`05_Sync_Engine` / `06_Notification_Engine` cron — see forthcoming specs) that runs every 15 minutes and scans for sessions past their 48 h window without `locked_at`.

### 10.4 BR-ATT-04 — Holiday Handling
Marking a session `holiday` (via `⋯ → Mark as holiday`) soft-deletes all records by setting their status to `'holiday'`. The date is excluded from the % denominator. The Calendar view shows a violet stripe; the Heatmap shows `▒` cells for every student on that date. The action is reversible: un-holidaying restores the prior statuses (we keep a `notes` history trail of the holiday toggle with timestamps).

### 10.5 BR-ATT-05 — Late Attendance Sub-state
`late` is a sub-state of `present`. UI affordances:
- **Long-press** on a `present` toggle (≥ 350 ms with haptic at 150 ms to indicate the long-press is registering) cycles `present → late → present`.
- A `LateChip` (amber, `◐` icon) appears next to the student's name on the row and on their heatmap cells for that date.
- Late count is reported separately in monthly attendance exports (BR-BAT-03 Sheet 2 adds a column).
- In the calendar/heatmap aggregates, `late` counts toward % as `present` does (per BR-CALC-06) but is visually distinct.

### 10.6 BR-ATT-07 — Re-marking Rules (the three-tier ladder)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Tier 1 — Unlocked (within 48 h, locked_at IS NULL)                     │
│  • Free re-mark, no auth, no audit beyond the standard updated_at bump. │
│                                                                         │
│  Tier 2 — Locked (locked_at set OR > 48 h, < 30 days)                   │
│  • Tap unlock → PIN/biometric → audit_log attendance_unlock.            │
│  • Edit row → audit_log attendance_edit_locked with                     │
│    { student_id, old_status, new_status, reason }.                      │
│  • Re-lock automatically after 60 min OR on backgrounding the app.      │
│                                                                         │
│  Tier 3 — Hard-locked (> 30 days)                                       │
│  • Direct unlock disabled. "Request unlock" sheet appears.              │
│  • Tutor types a reason (≥ 20 chars), submits.                          │
│  • System unlocks for 60 minutes, all edits double-audited              │
│    (one row per keystroke change, batched every 500 ms).                │
│  • Request itself is logged: action='attendance_hard_unlock_request'.   │
│  • After 60 min, session re-locks; the reason + edits are permanent.    │
└─────────────────────────────────────────────────────────────────────────┘
```

The "Request unlock" sheet:

```
┌────────────────────────────────────────────────┐
│  Hard-locked session                          │
│                                                │
│  This session is more than 30 days old.       │
│  Edits are normally blocked. You can request  │
│  a temporary 60-minute unlock; all changes    │
│  will be double-audited.                      │
│                                                │
│  Reason (required, min 20 chars):             │
│  ┌──────────────────────────────────────────┐ │
│  │ Parent disputed 12 Aug absence; review…  │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  [ Cancel ]              [ Request unlock ]   │
└────────────────────────────────────────────────┘
```

### 10.7 BR-ATT-06 — Bulk Mark
- **Mark all Present:** one tap, no confirmation (rare-but-correct intent). Sets every enrolled-but-unmarked student to `present` in a single transaction. Already-marked students are *not* overwritten (the tutor's individual overrides win).
- **Mark all Absent:** opens a confirmation sheet "Mark all 36 as absent? This will overwrite existing marks." with a typed confirm input `ABSENT`. This guards against the catastrophic misclick (rare intent).
- **Locked sessions:** bulk actions are disabled. Locked rows are surfaced with a `🔒` overlay; the bulk bar shows "12 students locked — skipped".

### 10.8 Audit Trail
Every edit after lock writes:

```ts
await db.auditLog.create({ data: {
  id: uuidv7(), tenantId, actor: 'tutor', action: 'attendance_edit_locked',
  refType: 'attendance_session', refId: sessionId,
  metadata: { studentId, oldStatus, newStatus, reason }, createdAt: nowIso,
} });
```

Audit log is viewable in Settings → Security → Audit Log, filterable by `action = 'attendance_edit_locked'`.

### 10.9 Apple-style Toggle Interaction Contract

| Gesture | Result |
|---------|--------|
| Tap (present) | Toggle to `absent`. Knob slides right-to-left, glow shifts emerald → slate, haptic light. |
| Tap (absent) | Toggle to `present`. Knob slides left-to-right, glow shifts slate → emerald, haptic light. |
| Long-press (≥ 350 ms, present) | Cycle to `late`. Knob pulses amber, `LateChip` appears, haptic medium. |
| Long-press (late) | Cycle back to `present`. |
| Long-press (absent) | No-op (late is a sub-state of present, not absent). |
| Swipe right (mobile) | Same as tap-to-present. |
| Swipe left (mobile) | Same as tap-to-absent. |
| Keyboard `P` / `A` / `L` (desktop, when row focused) | Set present / absent / late. |
| Keyboard `Enter` (desktop, when row focused) | Toggle present ↔ absent. |

Spring motion: `{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }` per `13_UI_Guidelines.md` §7.1 (`ease-spring` token), target 120 fps. Knob uses `bg-gradient-to-br from-[#00FF9D] to-[#00F0FF]` when present, `from-[#2a2a5a] to-[#1a1a3a]` when absent, `from-[#FFB300] to-[#FF5E00]` when late.

### 10.10 "Upload After Marking" Semantics
There is **no Save button**. The screen autosaves:
1. Every toggle writes to local SQLite synchronously (<16 ms) — this is the source of truth at interaction time.
2. The same mutation enqueues a `sync_outbox` row.
3. The status chip in the summary strip animates: `Saved locally · 3 pending` (amber) → `Syncing…` (cyan, on flush) → `Synced ✓` (emerald, on success).
4. On offline, the chip stays amber and the count grows; on reconnect, the Sync Engine flushes in FIFO order per BR-SYN-03.
5. Conflicts on flush (LWW loss) are surfaced as a toast "1 record conflict resolved — view audit log" with a deep-link.

---

## 11. Edge Cases

| # | Case | Behaviour |
|---|------|-----------|
| E1 | Student enrolled mid-month (joined_on = 14 Aug) | Heatmap shows empty cells for 1–13 Aug (not absent), reflecting `joined_on <= session_date` filter. |
| E2 | Student exited mid-month (exited_on = 20 Aug) | Cells after 20 Aug show `·` (no session), not `absent`. |
| E3 | Student archived after marking | Records remain visible in the heatmap with a muted row, marked "Archived". Edits blocked. |
| E4 | Graduated student | Cannot be marked (BR-STU-01 frozen ledger and lifecycle). Row hidden from grid. |
| E5 | Future date selected | DatePicker refuses to advance beyond today; "Mark" actions disabled with tooltip "Cannot mark future dates". |
| E6 | Weekend / non-scheduled day | Calendar shows the day greyed; tapping it opens an empty grid with a "No session scheduled" empty state. |
| E7 | Batch with zero active enrollments | Grid shows empty state "This batch has no active students. Add students or restore archived ones." with a link to the Students screen. |
| E8 | Holiday set, then unset | Prior statuses restored from the `notes` history trail; audit log records both transitions. |
| E9 | Lock attempted with no records | Allowed — locks an empty session (rare but valid; e.g., tutor pre-locks a cancelled class). |
| E10 | Bulk present on a session with 0 students | Button disabled; tooltip "No students to mark". |
| E11 | Two devices edit the same record offline | On sync, LWW by `updated_at` wins (BR-SYN-01); loser's version logged to `audit_log` action `sync_conflict_lost`. |
| E12 | Device clock skewed (offline tutor marks "today" but device date is wrong) | We use the device's local date for the session; on sync, the cloud DB accepts the date as-is. Audit log captures the actual `marked_at` UTC, so the discrepancy is visible. |
| E13 | Tutor marks attendance, then archives the batch | Records remain; batch is hidden from `BatchSelector` unless "Show archived" toggle is on. |
| E14 | PIN attempts exhausted (5 / 10 / 15 escalation) | Unlock sheet blocks for 30 s / 5 min / wipes local cache (BR-SEC-01 §3.4). |

---

## 12. Offline Behaviour

The screen is **fully functional offline** (P5 — Offline-First):

- All reads hit local SQLite (Turso embedded replica on mobile/desktop; IndexedDB-backed cache on web).
- All writes go to local SQLite + `sync_outbox`.
- The `syncStatus` chip in the summary strip reflects `sync_outbox.status = 'pending'` count; the global footer shows `Offline · N pending`.
- The `LockButton` works offline (locks local row + enqueues sync).
- The `BulkActionBar` works offline.
- The Calendar and Heatmap views render from local data; missing months show "Partial data — will refresh on reconnect" if the embedded replica has not yet pulled that range.
- **PIN / biometric prompt** works offline — the PIN hash is local; biometric is OS-native.
- **Auto-lock** runs offline (it's a local timer based on `session_date + attendance_lock_hours`).
- **Hard-lock** (30 days) is computed locally from `session_date`; no server round-trip needed.

---

## 13. Sync Behaviour

### 13.1 Conflict resolution
- `attendance_records`: **Last-Write-Wins** by `updated_at` vector clock (device_id + lamport counter — see BR-SYN-01). The losing version is written to `audit_log` action `sync_conflict_lost` with metadata `{ table, row_id, loser_updated_at, winner_updated_at, loser_status, winner_status }`.
- `attendance_sessions`: same LWW. If two devices lock the same session simultaneously, both `locked_at` timestamps survive — the later one wins, the earlier one's lock is logged as a conflict.
- `audit_log`: append-only, conflict-immune (both versions land; deduplicated by `id` UUID).

### 13.2 Outbox flush
On reconnect:
1. Sync Engine drains `sync_outbox` in FIFO order.
2. Each row's `payload` (JSON snapshot of the record) is POSTed to Turso.
3. On 200, the row is marked `sent` and `flushed_at` set.
4. On 409 (conflict), the row is marked `conflict` and surfaced in the Sync drawer for manual review. The LWW algorithm above is applied as the default resolution; the tutor can override via "Keep mine" / "Accept theirs" buttons in the drawer.
5. After 5 failures, the row is marked `dropped` and a notification is raised.

### 13.3 Vector-clock update
Each `attendance_records.updated_at` is stored as an ISO string, but a sibling column `updated_at_vc` (TEXT JSON `{ device_id, lamport }`) is the actual LWW arbiter. On every update, the lamport is incremented; on sync merge, the higher lamport wins; ties broken by `device_id` lexicographic order (deterministic).

---

## 14. Validation Rules

All validations are enforced via Zod schemas in `packages/shared` and re-checked at the SQL layer via CHECK constraints.

| Rule | Zod | SQL |
|------|-----|-----|
| `status` ∈ {present, absent, late, excused, holiday} | `z.enum([...])` | `CHECK(status IN (...))` |
| `session_date` ≤ today | `z.string().refine(d => d <= todayIso())` | client-side guard; not DB-enforced (clock-skew tolerant) |
| Student is active on `session_date` | refine against enrollment window | `WHERE joined_on <= ? AND (exited_on IS NULL OR exited_on >= ?)` |
| Student not graduated/archived | refine against `students.status` | `WHERE s.status = 'active' AND s.archived_at IS NULL` |
| Session belongs to the selected batch | path param check | `WHERE batch_id = ? AND tenant_id = ?` |
| Lock requires unlocked session | client guard | `WHERE locked_at IS NULL` (update guards) |
| Bulk absent requires typed confirm | UI flow | n/a |
| Holiday note length ≤ 500 chars | `z.string().max(500)` | n/a |
| Edit-locked requires reason ≥ 20 chars | `z.string().min(20)` | client-side; audit metadata stored |

A validation failure surfaces as a toast with the specific field + reason; the optimistic update is rolled back.

---

## 15. Security Rules

This screen enforces BR-SEC-02 (sensitive-mutation PIN) for two actions: **unlocking attendance** and **editing a locked record**. Both require a fresh PIN/biometric entry (≤ 30 s old) even when the app is already unlocked — defence-in-depth.

### 15.1 Biometric-preferred, PIN-fallback
- On mobile/desktop: `expo-local-authentication` / Tauri biometric plugin is invoked first.
- On web: WebAuthn is supported in v1.x; in v1 only PIN is available. The UI gracefully degrades — if `settings.biometric_enabled = 0` or the OS reports no biometric hardware, the sheet shows only the PIN field.
- After 5 failed PIN attempts: 30 s lockout. After 10: 5 min. After 15: local cache wipe (BR-SEC-01 §3.4). The tutor can still log in fresh from Supabase and re-replicate from cloud, so no data is permanently lost.

### 15.2 Audit entries (per BR-SEC-03)
Every one of the following writes `audit_log` *before* the mutation (fail-closed):

| Action | audit_log.action | metadata |
|--------|------------------|----------|
| Manual lock | `attendance_lock` | `{ batch_id, session_date, method }` |
| Auto-lock | `attendance_lock` | `{ batch_id, session_date, method: 'auto' }` |
| Unlock | `attendance_unlock` | `{ batch_id, session_date, method, duration_minutes: null }` |
| Auto re-lock after unlock | `attendance_relock` | `{ batch_id, session_date, reason: 'unlock_window_expired' }` |
| Edit while locked | `attendance_edit_locked` | `{ student_id, old_status, new_status, reason }` |
| Hard-unlock request | `attendance_hard_unlock_request` | `{ batch_id, session_date, reason, unlock_duration_min: 60 }` |
| Mark holiday | `attendance_holiday` | `{ batch_id, session_date, on/off }` |
| Bulk mark | `attendance_bulk_mark` | `{ batch_id, session_date, status, count_affected, count_skipped_locked }` |
| Sync conflict lost | `sync_conflict_lost` | `{ table, row_id, loser_status, winner_status }` |

### 15.3 RLS / tenant guard
Every query in §9 binds `tenant_id` from the Turso scoped JWT (never from client input). The `student_enrollments`, `attendance_sessions`, and `attendance_records` queries all filter on `tenant_id = ?` even though the JWT already constrains the connection to a single-tenant DB — defence-in-depth per `10_Security.md` §7.

### 15.4 Tamper-evidence
Attendance records are not tamper-hashed like receipts (BR-FEE-05) — the audit log is the tamper evidence. Any edit after lock creates an audit row; an auditor comparing `attendance_records.updated_at` against `audit_log.created_at` for the same `ref_id` can detect tampering with the audit log itself (which is trigger-guarded append-only, identical mechanism to the ledger).

---

## 16. Error Handling

| Scenario | UX |
|----------|----|
| Local SQLite write fails (disk full, SQLCipher locked) | Optimistic UI rolled back; toast "Could not save mark — tap to retry." Retry button re-runs the mutation. |
| Network flush fails (timeout, 5xx) | Status chip stays amber "Saved locally · N pending"; no user-facing error (offline-first is the happy path). |
| Network flush returns 409 conflict | Status chip → "1 conflict resolved"; toast with "View in Sync drawer" deep-link; audit log row written. |
| Biometric unavailable | Sheet auto-falls back to PIN field; tooltip "Biometric unavailable — enter PIN." |
| PIN exhausted | Sheet blocks with countdown; "Forgot PIN? Reset via Settings → Security" link. |
| Session locked by another device while editing | On next query invalidation, the row appears locked; toast "Session was locked on another device." |
| Student enrolled but `students.status = 'archived'` mid-edit | Row greyed out on next query; toast "Student archived — record frozen." |
| Schema drift (server schema_version > client) | Sync drawer surfaces "Update the app to continue syncing"; the screen still works offline from local data. |
| Date picker pushed beyond today | No-op; the `▶` button is disabled when `date === today`. |
| Bulk absent typed-confirm mismatch | Confirm button stays disabled; subtle inline hint "Type ABSENT to confirm." |

---

## 17. Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Toggle → visual reflect | < 16 ms (one frame at 60 fps) | `performance.mark` around the optimistic update |
| Toggle → haptic fire | < 32 ms | `expo-haptics` / `navigator.vibrate` |
| Toggle → SQLite write commit | < 8 ms (single row upsert, indexed by `UNIQUE(session_id, student_id)`) | `performance.measure` around `db.execute` |
| 100-student batch Daily Grid first paint | < 200 ms | Lighthouse / `web-vitals` |
| 100 × 30 heatmap render | < 300 ms | virtualised grid; `react-window` fixed-size grid |
| Calendar month render (31 cells + sparse sessions) | < 120 ms | n/a — tiny |
| Lock → audit + UI freeze | < 100 ms | single transaction |
| Bulk present (100 students) | < 250 ms | batched SQL in one transaction |
| Sync flush (100 pending records) | < 5 s | Turso HTTP, batched 20-at-a-time |
| Frame rate during toggle storm (rapid tapping) | ≥ 55 fps on Redmi Note 12 class | Chrome DevTools / Flipper perf |

Virtualisation:
- Daily Grid uses `react-window` `FixedSizeRow` for > 50 students; below that, plain `map` is faster.
- Heatmap uses `react-window` `FixedSizeGrid` for both axes; only visible cells render.
- Calendar always renders all 42 cells (6 weeks × 7 days) — no virtualisation needed.

Memoisation:
- `StudentAttendanceRow` is `React.memo`'d on `[student.id, record?.status, locked]`. A toggle on row 17 does not re-render rows 1–16 or 18–36.
- `HeatmapCell` is `React.memo`'d on `[studentId, date, status, isToday]`.

---

## 18. Accessibility

Per `13_UI_Guidelines.md` §10 (Accessibility Commitments) and §8 (Component Vocabulary):

- **Keyboard:**
  - `Tab` cycles through header controls → summary strip → first grid row → bulk bar.
  - `↑` / `↓` moves between rows in the Daily Grid.
  - `P` / `A` / `L` sets present / absent / late on the focused row.
  - `Enter` toggles present ↔ absent.
  - `Cmd/Ctrl + L` triggers lock (when a session is open).
  - `?` shows the shortcut cheatsheet.
- **Screen reader:** each toggle exposes `aria-label="Mark Aarav Sharma present"` and `aria-pressed` reflects state. The summary strip uses `aria-live="polite"` to announce count changes ("28 present, 4 absent"). The status chip uses `aria-live="polite"` for sync state.
- **Focus:** visible cyan ring (`outline: 2px solid #00F0FF; outline-offset: 2px`) — never removed.
- **Colour-blind safe:** every status is paired with an icon (`✓` present, `✕` absent, `◐` late, `—` excused, `▒` holiday) — colour is never the sole encoder (BR-CALC-07 / UI §8).
- **Motion sensitivity:** `prefers-reduced-motion` replaces spring transitions with 120 ms fades; long-press haptic replaced with a 200 ms dwell + visual confirm.
- **Touch targets:** ≥ 44 × 44 px on `base`/`sm`; the toggle knob is 28 px but the hit area is padded to 44 px.
- **Contrast:** text-on-glass ≥ 4.5:1; emerald/cyan accents on cosmic bg ≥ 7:1.

---

## 19. Testing Requirements

### 19.1 Unit tests (Vitest)
- `attendance-store.ts` — view switching, date shifting, modal open/close.
- `attendance-rules.ts` — pure functions for: `canEdit(session, now)`, `isHardLocked(session, now)`, `nextStatus(current, gesture)`, `pct(records)` (BR-CALC-06).
- `audit-helpers.ts` — `buildAuditMetadata(action, …)` shape correctness.

### 19.2 Component tests (React Testing Library)
- `PresentAbsentToggle` — tap, long-press, keyboard, locked-state, disabled-state.
- `StudentAttendanceRow` — memo re-render boundary (only re-renders on own record change).
- `CalendarCell` — colour interpolation by %, holiday overlay, today ring.
- `HeatmapCell` — drill callback, tooltip content.
- `LockSheet` / `UnlockSheet` — biometric fallback to PIN, audit-before-mutation ordering.
- `BulkActionBar` — confirmation flow for "Mark all Absent".

### 19.3 Integration tests (Vitest + in-memory libSQL)
- Full session lifecycle: create → mark 10 → bulk present → lock → unlock-with-PIN → edit one → re-lock → audit log has all 5 entries in order.
- Holiday set → records status flipped → % excludes them → holiday unset → records restored.
- Auto-lock: simulate `now = session_date + 49 h`, run cron, assert `locked_at` set with `locked_by='auto'`.
- Hard-lock: simulate `now = session_date + 31 days`, attempt unlock, assert "Request unlock" sheet appears; submit reason; assert 60-min window opens; assert double-audit.

### 19.4 E2E tests (Playwright)
- Walk the User Story in §4 end-to-end on web (mobile E2E is via Maestro in the mobile spec).
- Offline: throttle network to offline, mark 5 students, reconnect, assert sync flush + status chip transition.
- Conflict: two Playwright contexts with different `device_id`, both edit the same record offline, sync, assert LWW + audit log entry.

### 19.5 Performance tests
- 100-student batch toggle storm: 100 toggles in 5 s, assert no frame drops > 50 ms (Chrome DevTools Performance panel).
- 100 × 30 heatmap render: assert < 300 ms first paint.
- Memory: 10-minute session with 1 000 toggles, assert heap growth < 20 MB (no leak).

### 19.6 Accessibility tests
- axe-core scan on each view; zero critical violations.
- Keyboard-only walkthrough: lock, mark, bulk, edit-locked — all reachable without pointer.
- VoiceOver / TalkBack smoke test on mobile.

---

## 20. Future Extensions

These are explicitly **out of scope for v1** and parked for v1.x / v2. Citing them here prevents scope creep.

- **QR-code attendance:** students scan a QR at the door; auto-marks present. Requires a student-facing surface (violates P1 in v1).
- **Geofenced attendance:** mark present only within 50 m of the class GPS. Privacy + reliability concerns; v1.x at earliest.
- **Parent-facing attendance portal:** read-only daily/weekly view for parents. Violates P14 in v1; revisited in v1.x alongside parent auth.
- **Auto-attendance from class schedule:** if `batches.schedule` says Mon/Wed/Fri 6 pm, the app auto-creates empty sessions and reminds the tutor. Currently the tutor must open the screen — a one-tap action. Auto-create is a low-risk v1.x add.
- **Multi-tutor marking:** for the "Centre Priya" persona — multiple tutors marking the same batch. Requires role-based access (v1.x).
- **Biometric per-student check-in:** student places finger on a fingerprint scanner at class entry. Hardware-dependent; v2.
- **AI-powered attendance insights:** "Aarav's attendance drops 20% in the week before exams — consider a check-in call." Requires Report Engine v2 + LLM integration.
- **Calendar export (iCal):** publish a batch's session + holiday calendar as an iCal feed for tutors to subscribe. v1.x.
- **Per-student attendance contracts:** "minimum 80% to qualify for the next module." A v1.x rule-engine concern; v1 only surfaces the %.

---

## 21. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 for the Attendance screen. Attendance is the most *tactile* screen in Buddysaradhi — every row carries a neumorphic toggle that the tutor taps 30+ times in 30 seconds, then a biometric-gated lock button. Every mockup below annotates the **glass tier** or **neumorphic recipe** so the design contract is unambiguous. Character set per §20.2; accent colours named; cross-references use canonical IDs only.

### 21.1 Design System Reference — Attendance

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces on this screen | Tier | Cross-ref |
|---|---|---|
| Sidebar / bottom-tab bar (mobile) | `glass-strong` | §5.5, §8.6 |
| Top header bar | `glass-strong` sticky | §5.5 |
| Summary strip (28 Present / 4 Absent / 3 Late / 1 Excused + sync chip) | `glass-faint` band | §5.2 |
| Daily Grid header / row separators | `glass-faint` gridlines | §5.2, §8.4 |
| Calendar Month cell | `glass` tile (64×64 mobile, 96×72 desktop) | §5.5, §8.4 |
| Heatmap parent panel | `glass` (parent); cells = flat `bg-white/[0.04]` (no-glass-on-glass) | §5.3, §8.12 |
| Lock / Unlock sheet | `glass-strong` + backdrop `bg-black/60` | §5.5, §8.7 |
| Holiday sheet | `glass-strong` + backdrop | §5.5, §8.7 |
| Edit-Locked-Record sheet | `glass-strong` + backdrop | §5.5, §8.7 |
| Hard-locked request-unlock sheet | `glass-strong` + backdrop | §5.5, §8.7 |
| Toast (lock succeeded / sync conflict / bulk-action done) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| Bulk-action bar (Mark all Present / Mark all Absent…) | `glass-strong` sticky bottom | §5.5 |
| Empty-state card | `glass` centered | §5.5, §8.19 |
| Footer | `glass-faint` (recede), sticky per §13 | §5.5 |

| Neumorphic controls on this screen | Recipe | Cross-ref |
|---|---|---|
| PresentAbsentToggle (the per-row switch) | well = `neumo-inset`; knob = `neumo-raised`; on = emerald→cyan gradient + glow; off = slate knob; late = amber→flare gradient | §6.4, §8.16, §6.6 coverage map |
| View switcher (Daily / Calendar / Heatmap) | well = `neumo-inset`; active pill = `neumo-raised` + cyan glow | §6.6, §8.5 |
| Batch selector dropdown trigger | `neumo-raised` | §6.6 |
| Date picker ◀ / Today / ▶ | `neumo-raised` compact; Today = `neumo-raised` + cyan glow | §6.6 |
| Lock button (unlocked state) | `neumo-raised` + emerald glow | §6.6, §8.2 |
| Lock button (locked state) | `neumo-pressed` (inset, frozen affordance) + lock glyph | §6.3, §6.6 |
| Holiday toggle (overflow) | `neumo-raised` secondary | §6.6 |
| "Mark all Present" bulk button | `neumo-raised` + emerald glow (primary) | §6.6, §8.2 |
| "Mark all Absent…" bulk button | `neumo-raised` + flare glow (destructive) | §6.6, §8.2 |
| Calendar cell tap target | flat tinted (tile is a surface, not a control — §5.5); 44px hit wrapper | §10.2 |
| PinPad (in Lock/Unlock sheet) | digits = `neumo-raised`; backspace = `neumo-raised` + flare glow | §6.6 |
| Edit-Locked-Record reason input | `neumo-inset` | §6.6, §8.9 |
| Bulk-absent typed-confirm input | `neumo-inset` well (word = `ABSENT`) | §6.6, §8.9 |
| Sync status chip in summary strip | flat tinted chip (informational, not a control — §8.3); amber→cyan→emerald by state | §8.3 |

> **References:** Apple HIG — *Toggles* (the canonical switch anatomy — our `PresentAbsentToggle` is a 3-state specialisation); Material Design 3 — *Switches* (knob extrudes on, flattens on press); Nielsen Norman Group — *Haptic Feedback in Mobile UX* (60ms haptic timing on toggle); Smashing Magazine — *Designing Tactile Touch Targets* (44×44px hit area for the 28px knob); WCAG 2.1 AA §1.4.11 (Non-text Contrast — the on/off state of the toggle must pair shadow with emerald glow + ✓/✕ icon, never shadow alone); WCAG 2.1 AA §4.1.2 (toggle exposes `aria-pressed` and `aria-label="Mark <name> present"`).

### 21.2 Mockup M1 — Full-Screen Desktop Layout (Daily Grid View, default landing)

```
DESKTOP (≥ 1024px) — Daily Grid View, 36 students, unlocked session
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Header (.glass-strong sticky) ──────────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Attendance      [ ● Daily | Calendar | Heatmap ]    │ │
│ │  ◈ Dashboard              │ ├──────────────────────────────────────────────────────┤ │
│ │  👥 Students              │ │  Batch [Class 10 — Maths — 6pm ▾]                    │ │
│ │  ◉ Attendance  ← active   │ │  Date  [◀ Mon 12 Aug 2024 ▶] [Today]    [🔒 Lock] [⋯]│ │
│ │  ₹ Fees                   │ ├──────────────────────────────────────────────────────┤ │
│ │  ⚙ Settings               │ │ ┌─ Summary strip (.glass-faint band) ───────────────┐ │ │
│ │                           │ │ │ ✓ 28 Present   ✕ 4 Absent   ◐ 3 Late   — 1 Excused│ │ │
│ │  ──────                   │ │ │              Saved locally · 3 pending ▸ Synced ✓ │ │ │
│ │  Rohan M.                 │ │ └────────────────────────────────────────────────────┘ │ │
│ │  Pune · 36 students       │ │ ┌─ Daily Grid (rows = .glass-faint bands) ──────────┐ │ │
│ │                           │ │ │ #  Student                Fee  Status    Toggle   │ │ │
│ │  ⚙ Sync                   │ │ │ ──────────────────────────────────────────────────│ │ │
│ │  ⚡ ⌘K                    │ │ │ 1  Aarav Sharma STU-07   —   Present   ●━━○ [✓]  │ │ │
│ │                           │ │ │ 2  Diya Patel   STU-12   ●   Present   ●━━○ [✓]  │ │ │
│ │                           │ │ │ 3  Ishaan Verma STU-19   —   Late ◐    ●━━○ [✓] ⌐│ │ │
│ │                           │ │ │ 4  Kabir Singh  STU-24   —   Absent    ○━━● [✕]  │ │ │
│ │                           │ │ │ 5  Meera Iyer   STU-31   —   Excused     — — —    │ │ │
│ │                           │ │ │ …                                                   │ │ │
│ │                           │ │ │ 36 Zoya Khan    STU-48   —   Present   ●━━○ [✓]  │ │ │
│ │                           │ │ └────────────────────────────────────────────────────┘ │ │
│ │                           │ │ ┌─ Bulk-action bar (.glass-strong sticky) ──────────┐ │ │
│ │                           │ │ │ [✓ Mark all Present]  [✕ Mark all Absent…]  36/36 │ │ │
│ │                           │ │ └────────────────────────────────────────────────────┘ │ │
│ └───────────────────────────┘ └──────────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint, sticky) ─────────────────────────────────────────────────────┐ │
│ │  ● Online · synced 2m ago · 36 students · 28 present (78%) · v1.4.2 · © Buddysaradhi     │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
   ↑ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2)
   ↑ sidebar + header = .glass-strong (8% white, 24px blur) — persistent chrome (§5.5)
   ↑ summary strip = .glass-faint band (recedes so counts read)
   ↑ daily grid rows = .glass-faint bands; sticky first column (student name) on horizontal scroll
   ↑ view switcher well = .neumo-inset; active pill = .neumo-raised + cyan glow (§8.5)
   ↑ batch selector + date picker = .neumo-raised (controls, §6.6)
   ↑ lock button = .neumo-raised + emerald glow (unlocked state)
   ↑ per-row PresentAbsentToggle:
     • well = .neumo-inset
     • knob = .neumo-raised (28px visual, 44px hit area per §10.2)
     • on = emerald→cyan gradient knob + glow
     • off = slate knob, no glow
     • late (long-press) = amber→flare gradient + LateChip ◐
   ↑ "Mark all Present" = .neumo-raised + emerald glow (primary, §8.2)
   ↑ "Mark all Absent…" = .neumo-raised + flare glow (destructive, requires typed ABSENT, BR-ATT-06)
   ↑ footer = .glass-faint (recede), sticky per §13
```

### 21.3 Mockup M2 — Empty State (new batch, no sessions yet, P15)

```
EMPTY STATE — batch with zero sessions, tutor's first visit
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Content (transparent over canvas) ────────────┐ │
│ │  ◈ Buddysaradhi                │ │                                                │ │
│ │  ◈ Dashboard              │ │   ┌─ Empty-state card (.glass) ──────────────┐ │ │
│ │  👥 Students              │ │   │                                          │ │ │
│ │  ◉ Attendance  ← active   │ │   │            ╭──────────╮                  │ │ │
│ │  ₹ Fees                   │ │   │            │  ┌────┐  │  ← 120×120       │ │ │
│ │  ⚙ Settings               │ │   │            │  │ ✓  │  │     line-art     │ │ │
│ │                           │ │   │            │  │    │  │     cyan+emerald │ │ │
│ │  ──────                   │ │   │            │  └────┘  │                  │ │ │
│ │  Rohan M.                 │ │   │            ╰──────────╯                  │ │ │
│ │  Pune · 36 students       │ │   │      No sessions yet for this batch.     │ │ │
│ │                           │ │   │   Pick a date and mark your first        │ │ │
│ │  ⚙ Sync                   │ │   │   attendance.                            │ │ │
│ │                           │ │   │                                          │ │ │
│ │                           │ │   │   ┌────────────────────────────────┐     │ │ │
│ │                           │ │   │   │  ✓  Mark Today's Attendance    │     │ │ │
│ │                           │ │   │   └────────────────────────────────┘     │ │ │
│ │                           │ │   │                                          │ │ │
│ │                           │ │   └──────────────────────────────────────────┘ │ │
│ └───────────────────────────┘ └────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ─────────────────────────────────────────────────────────┐ │
│ │  ● Online · synced just now · 0 sessions this month · v1.4.2 · © Buddysaradhi        │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
   ↑ empty-state card = .glass (5% white, 24px blur) — centered, not elevated (§8.19)
   ↑ CTA = .neumo-raised + emerald glow (primary, §8.2)
   ↑ illustration = custom SVG line-art checkmark-in-circle (NOT lucide), cyan + emerald (§9.3)
   ↑ honest-empty-state rule (P15): never a blank grid; always a designed CTA
   ↑ CTA tap → creates today's session lazily on first toggle (§9.2)
```

### 21.4 Mockup M3 — Loading / Skeleton (session + records first paint)

```
SKELETON — first paint, session + records loading, < 200ms budget (§17)
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Header (.glass-strong sticky) ──────────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Attendance      [ ░░░ | ░░░░░░ | ░░░░░ ]             │ │
│ │  ◉ Attendance  ← active   │ ├──────────────────────────────────────────────────────┤ │
│ │                           │ │  Batch [░░░░░░░░░░░░░░░░░░░░░░░ ▾]                  │ │
│ │                           │ │  Date  [◀ ░░░░░░░░░░░░░░░░ ▶] [░░░]   [░░] [⋯]       │ │
│ │                           │ ├──────────────────────────────────────────────────────┤ │
│ │                           │ │ ┌─ Summary strip skel (.glass-faint) ───────────────┐ │ │
│ │                           │ │ │ ✓ ░░  ✕ ░░  ◐ ░░  — ░░   · ░░░░░░░░░░░░░░░░░░░░░░ │ │ │
│ │                           │ │ └────────────────────────────────────────────────────┘ │ │
│ │                           │ │ ┌─ Grid skel (.glass-faint + shimmer) ───────────────┐ │ │
│ │                           │ │ │ 1  ●░░░░░░░░░░░░░░░░░░░░░░  ░  ░░░░░░░  ░░░░░░░░░ │ │ │
│ │                           │ │ │ 2  ●░░░░░░░░░░░░░░░░░░░░░░  ░  ░░░░░░░  ░░░░░░░░░ │ │ │
│ │                           │ │ │ 3  ●░░░░░░░░░░░░░░░░░░░░░░  ░  ░░░░░░░  ░░░░░░░░░ │ │ │
│ │                           │ │ │ 4  ●░░░░░░░░░░░░░░░░░░░░░░  ░  ░░░░░░░  ░░░░░░░░░ │ │ │
│ │                           │ │ │ 5  ●░░░░░░░░░░░░░░░░░░░░░░  ░  ░░░░░░░  ░░░░░░░░░ │ │ │
│ │                           │ │ │ …                                                  │ │ │
│ │                           │ │ └────────────────────────────────────────────────────┘ │ │
│ │                           │ │ ┌─ Bulk bar skel ─────────────────────────────────┐  │ │
│ │                           │ │ │ ░░░░░░░░░░░░░░░░░░░░       ░░░░░░░░░░░░░░░░  ░░ │  │ │
│ │                           │ │ └────────────────────────────────────────────────────┘ │ │
│ └───────────────────────────┘ └──────────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ─────────────────────────────────────────────────────────────┐ │
│ │  ● Online · syncing… · — students · — present · v1.4.2 · © Buddysaradhi                 │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
   ↑ grid rows = .glass-faint + shimmer (1.2s loop, §8.20); avatar dot + text bars + toggle knob
   ↑ view switcher well = .neumo-inset; shimmer on each pill slot
   ↑ batch selector + date picker = .neumo-raised; shimmer on label region (the recipe stays
     neumo-raised so the affordance is unambiguous even mid-load)
   ↑ summary strip = .glass-faint band; shimmer on each count + sync chip
   ↑ aria-busy="true" on the grid parent (§10.5)
   ↑ 100-student batch first paint budget < 200ms (§17)
   ↑ 120ms fade-out on resolve; toggles are disabled during skeleton (prevents accidental mark
     on a row that doesn't yet exist in cache)
```

### 21.5 Mockup M4 — Primary Modal: Lock Session Sheet (biometric-preferred, PIN-fallback)

```
MODAL — Lock Session Sheet (BR-ATT-03, BR-SEC-02)
┌──────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░ backdrop: bg-black/60 + backdrop-blur-sm ░░░░░░░░░░░░░ │
│  ░░░░░░░  ┌──────────────────────────────────────────────╲░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  │  Lock this session?                       ✕       │░░░░░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────┤░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Class 10 — Maths — 6pm                     │░░░░░░░░░░░  │
│  ░░░░░░░  │  Mon 12 Aug 2024  ·  36 students            │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Once locked, edits require your PIN        │░░░░░░░░░░░  │
│  ░░░░░░░  │  and are written to the audit log.          │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │       ┌────────────────────────────┐        │░░░░░░░░░░░  │
│  ░░░░░░░  │       │     [ Place your finger ]   │ ← bio  │░░░░░░░░░░░  │
│  ░░░░░░░  │       │     ━━━━━━━━━━━━━━━━━━━     │ prompt │░░░░░░░░░░░  │
│  ░░░░░░░  │       └────────────────────────────┘        │░░░░░░░░░░░  │
│  ░░░░░░░  │              ── or ──                       │░░░░░░░░░░░  │
│  ░░░░░░░  │  Enter 6-digit PIN                          │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐   │░░░░░░░░░░░  │
│  ░░░░░░░  │  │  • • • • • •                         │   │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘   │░░░░░░░░░░░  │
│  ░░░░░░░  │      1  2  3                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      4  5  6                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      7  8  9                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      •  0  ⌫                                │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │   [Cancel]              [Lock]  ← disabled   │░░░░░░░░░░░  │
│  ░░░░░░░  │                          until PIN/bio verify │░░░░░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────┘░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ backdrop = bg-black/60 + backdrop-blur-sm — click = cancel, ESC = cancel (§8.7)
   ↑ panel = .glass-strong (8% white, 24px blur) — highest-focus tier (§5.5)
   ↑ biometric prompt = .neumo-raised panel + emerald glow ring (preferred path)
   ↑ PinPad digits = .neumo-raised; ⌫ backspace = .neumo-raised + flare glow (destructive)
   ↑ [Cancel] = ghost; [Lock] = .neumo-raised + emerald glow (primary, §8.2)
   ↑ aria-modal="true" + focus-trap active (§10.5); ESC = cancel
   ↑ 5/10/15 PIN attempts → 30s / 5min / wipe+relogin (BR-SEC-01 §3.4, EC-03 in 08_Settings)
   ↑ audit row written BEFORE the lock mutation (BR-SEC-03 fail-closed, §15.2)
   ↑ 240ms ease-spring-soft enter (§7.3 modal-enter); mirror exit 180ms
```

### 21.6 Mockup M5 — Toast / Confirmation: "Mark all Absent" Typed-Confirm (primary destructive)

```
TOAST + TYPED-CONFIRM — Mark all Absent (BR-ATT-06, catastrophic-misclick guard)
┌──────────────────────────────────────────────────────────────────────────────┐
│                       (Attendance screen underneath, dimmed by backdrop)      │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  ┌──────────────────────────────────────────────╲░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  │  Mark all 36 students as absent?         ✕       │░░░░░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────┤░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  This will OVERWRITE existing marks.         │░░░░░░░░░░░  │
│  ░░░░░░░  │  28 currently Present · 3 Late · 1 Excused  │░░░░░░░░░░░  │
│  ░░░░░░░  │  will all flip to Absent.                    │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Audit row will be written before mutation.  │░░░░░░░░░░░  │
│  ░░░░░░░  │  You can re-mark individually after, but     │░░░░░░░░░░░  │
│  ░░░░░░░  │  bulk-revert is not available.               │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Type ABSENT to confirm                      │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐    │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ ABSEN_                              │    │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘    │░░░░░░░░░░░  │
│  ░░░░░░░  │  ↑ type the word ABSENT; button disabled     │░░░░░░░░░░░  │
│  ░░░░░░░  │    until exact match                         │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │   [Cancel]            [Mark 36 Absent] (dis.)│░░░░░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────┘░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘

AFTER typed-confirm + transaction commit (Toast surfaces bottom-right):

                          ┌▌──────────────────────────────────┐
                          │▌ ✓  36 students marked absent     │
                          │▌    audit row written · [Undo] ✕  │
                          └▌──────────────────────────────────┘
                             ↑ 4px emerald left-bar (success)
                             ↑ .glass-strong (8% white, 24px blur) per §8.8
                             ↑ aria-live="polite" (success = polite, §10.5)
                             ↑ 4s auto-dismiss; swipe-down to dismiss (§15.3)
                             ↑ [Undo] = .neumo-raised compact (re-marks all to previous
                               snapshot, enqueues 36 sync_outbox rows per BR-SYN-01)
                             ↑ ✕ = ghost close
```

> **Why typed-confirm for bulk-absent (BR-ATT-06, §10.7):** a misclick on "Mark all Absent" would silently flip 28 present + 3 late + 1 excused to absent — a catastrophic attendance record the tutor would have to re-enter row-by-row. The typed word forces *intent*. PIN is not required here (the tutor is already unlocked); the typed word is the only gate because the action is reversible per-row.

### 21.7 Mockup M6 — Mobile Variant (`base` < 640px, single-column daily grid)

```
MOBILE (base < 640px) — single column, bottom-tab bar, lock button in header
┌──────────────────────────────────────┐
│ ▔▔▔▔▔▔ ← env(safe-area-inset-top)    │
│ ┌─ Header (.glass-strong sticky) ───┐│
│ │ Attendance   [●D][Ca][He]         ││
│ │ Batch [Class 10 ▾]   [Today]      ││
│ │ Date  ◀ Mon 12 Aug ▶     [🔒]    ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Summary strip (.glass-faint) ───┐│
│ │ ✓28 ✕4 ◐3 —1   · Synced ✓        ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Grid (.glass-faint bands) ──────┐│
│ │ 1 Aarav Sharma     ●━━○ [✓]      ││
│ │   STU-07 · Cl10                   ││
│ │ ─────────────────────────────── ││
│ │ 2 Diya Patel       ●━━○ [✓]      ││
│ │   STU-12 · Cl10                   ││
│ │ ─────────────────────────────── ││
│ │ 3 Ishaan Verma     ●━━○ [✓] ◐    ││
│ │   STU-19 · Cl10      ← late chip  ││
│ │ ─────────────────────────────── ││
│ │ 4 Kabir Singh      ○━━● [✕]      ││
│ │   STU-24 · Cl10                   ││
│ │ ─────────────────────────────── ││
│ │ 5 Meera Iyer        — — —         ││
│ │   STU-31 · Cl10  ← excused        ││
│ │ ─────────────────────────────── ││
│ │ ⋯ +31 more                        ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Bulk bar (.glass-strong sticky) ┐│
│ │ [✓ Mark all Present]              ││
│ │ [✕ Mark all Absent…]              ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Bottom Tab Bar (.glass-strong) ─┐│
│ │  ◈    👥    ✓    ₹    ⚙           ││
│ │ Home Stud Att  Fees Set           ││
│ └────────────────────────────────────┘│
│ ▁▁▁▁▁ ← env(safe-area-inset-bottom)  │
└──────────────────────────────────────┘
   ↑ cosmic canvas same as desktop (dark-only, §12)
   ↑ header = .glass-strong sticky (§5.5); view switcher compact (3-letter pills)
   ↑ summary strip = .glass-faint band; sync chip emerald (Synced) / amber (pending)
   ↑ grid rows = .glass-faint bands, 48px row height, full-width tap target = 44px (§10.2)
   ↑ per-row PresentAbsentToggle:
     • well = .neumo-inset (64×36 visual)
     • knob = .neumo-raised (28×28 visual)
     • hit area padded to 44×44px (§10.2, §8.16)
     • on = emerald→cyan gradient knob + glow; off = slate; late = amber→flare + LateChip ◐
   ↑ "Mark all Present" = .neumo-raised + emerald glow (primary, full-width)
   ↑ "Mark all Absent…" = .neumo-raised + flare glow (full-width, destructive)
   ↑ bottom tab bar = .glass-strong + safe-area inset (§4.3, §8.6)
   ↑ every tab + toggle + button ≥ 44×44px hit area (§10.2)
   ↑ swipe-right = tap-to-present; swipe-left = tap-to-absent (§10.9 toggle contract)
   ↑ long-press ≥ 350ms on present = cycle to late (haptic at 150ms)
```

### 21.8 Mockup M7 — State Matrix: PresentAbsentToggle (primary interactive control)

```
STATE MATRIX — PresentAbsentToggle (the per-row switch — 30+ taps in 30 seconds)
Box: 64–80 char width per §20.3 rule 2.

PRESENT (default)                 ABSENT                          LATE (long-press)
┌──────────────────────┐          ┌──────────────────────┐       ┌──────────────────────┐
│  ●━━○                │          │  ○━━●                │       │  ●━━○  ◐             │
└──────────────────────┘          └──────────────────────┘       └──────────────────────┘
 ↑ .neumo-inset well                ↑ .neumo-inset well            ↑ .neumo-inset well
   inset 4px 4px 8px #0a0a1a          inset 4px 4px 8px #0a0a1a      inset 4px 4px 8px #0a0a1a
  -4px -4px 8px #2a2a5a              -4px -4px 8px #2a2a5a          -4px -4px 8px #2a2a5a
 ↑ knob = .neumo-raised             ↑ knob = .neumo-raised         ↑ knob = .neumo-raised
   emerald→cyan gradient              slate (#3a3a5a)                amber→flare gradient
   + 0 0 12px rgba(0,255,157,0.6)    no glow                        + 0 0 12px rgba(255,179,0,0.6)
 ↑ knob translated right (28px)     ↑ knob at left (off position) ↑ LateChip ◐ amber, appears
 ↑ 44×44px hit area (§10.2)         ↑ 44×44px hit area              beside student name
 ↑ ✓ emerald icon                   ↑ ✕ flare icon                 ↑ long-press ≥ 350ms
 ↑ aria-pressed="true"              ↑ aria-pressed="false"           to cycle present→late

PRESSED (during tap)               FOCUS (keyboard)                DISABLED (session locked)
┌──────────────────────┐          ╔══════════════════════╗        ┌──────────────────────┐
│  ●━━○                │          ║  ●━━○                ║        │  ●━━○                │
└──────────────────────┘          ╚══════════════════════╝        └──────────────────────┘
 ↑ .neumo-pressed                   ↑ cyan 2px ring + glow          ↑ opacity-50
   inset 2px 2px 4px #0a0a1a         (§10.3 focus-visible)         ↑ cursor-not-allowed
  -2px -2px 4px #2a2a5a            ↑ keyboard: P / A / L / Enter    ↑ locked_at IS NOT NULL
 ↑ translateY(1px)                    (§10.7)                       (BR-ATT-03)
 ↑ 60ms haptic on mobile            ↑ Space toggles P↔A             ↑ status shown as static pill
 ↑ fires only while finger is down                                    ↑ tap = toast "Session locked.
   (60ms max, then reverts if                                           Unlock (PIN) to edit."
   move > 8px = drag-cancel)                                         ↑ audit row required to unlock

HOVER (desktop only)
┌──────────────────────┐
│  ●━━○                │  ← knob glow brightens (12px → 16px)
└──────────────────────┘    rgba(0,255,157,0.8)
 ↑ well shadow unchanged
 ↑ cursor-pointer
 ↑ row background tints bg-white/5
 ↑ 180ms ease-spring (card-hover-lift variant, §7.3)
 ↑ tooltip "Tap to mark absent. Long-press for late."
```

> **References:** Apple HIG — *Toggles* (canonical switch anatomy); Material Design 3 — *Switches* (knob-on extrudes, knob-off flattens); Nielsen Norman Group — *Haptic Feedback in Mobile UX* (60ms timing on toggle confirm); Smashing Magazine — *Designing Tactile Touch Targets* (44×44px hit area around a 28px knob — the universal neumorphic-toggle rule); WCAG 2.1 AA §1.4.11 (Non-text Contrast — the on/off state must pair shadow with emerald glow + ✓/✕ icon, never shadow alone); WCAG 2.1 AA §4.1.2 (toggle exposes `aria-pressed` + `aria-label`); CSS-Tricks — *Three-State Toggles* (the late sub-state pattern, a specialisation of the binary toggle).

---

This specification is the contract for the Attendance screen. Any change here is a P0 review item and requires amending `12_Business_Rules.md` §5 and `11_Data_Model.md` §3.7 in the same PR.
