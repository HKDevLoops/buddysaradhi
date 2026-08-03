# 05 — Students

> The registry of every learner in the tenant: their identity, their batch enrollments, their fee plan, their immutable ledger, their invoices, their attendance footprint, and their lifecycle. The Students screen is the master-detail surface that turns a name into a 360° business record in one tap.

**Design system:** Vibrant Glass & Neumorphism — Cosmic Indigo (`#0f0c29`) → Midnight Violet (`#24243e`) → Abyss (`#0a0a1a`), glass `rgba(255,255,255,0.05)` + `backdrop-blur(24px)`, accents Emerald (`#00FF9D`), Cyan (`#00F0FF`), Flare (`#FF5E00`), Amber (`#FFB300`), Violet (`#B388FF`). No monochrome. No pure black/white. No indigo/blue primaries.

**Engines touched:** Ledger ● · Search ● · Reminder ◐ · Report ◐ · Sync ◐ · Security ● · Notification — (per `02_Core_Logic.md` §10).

---

## 1. Purpose

The Students screen is the **single source of truth for who is in the tuition business**. It owns four jobs and no others:

1. **Registry** — list every student with their code, name, grade, primary batch, fee model, and current balance due, in a Kite-density virtualised table.
2. **Profile** — expose a 360° per-student view via an expandable detail drawer with eight tabs: Profile, Fee Plan, Ledger, Invoices, Attendance, Timeline, Notes, Documents.
3. **Lifecycle** — move students through `active ⇄ inactive → graduated → archived → restored` with full audit logging and ledger freezing on terminal states.
4. **Money spine** — surface the immutable ledger, the invoice list, and the prepaid/postpaid/mixed fee model per student, with reminder chips for pending dues inline.

The screen deliberately does **not** record payments, mark attendance, or generate invoices directly — those actions live in Fees & Payments / Attendance, but their **results** (a `PAYMENT_RECEIVED` row, an `attendance_marked` timeline event, an `invoices` row) are rendered here. The Students screen is the **read surface** for everything about a person; mutations to money or attendance are delegated to the owning screens via deep-links (`?s=fees&student=…`, `?s=attendance&batch=…&date=…`).

---

## 2. Business Objective

The Students screen wins when a tutor can answer any of these questions in **under 8 seconds** from app launch:

- "What does Aarav Sharma owe me right now?"
- "When did Aarav last attend class?"
- "Has Aarav's guardian been paying on time?"
- "Is Aarav a prepaid student who hasn't paid this cycle yet?"
- "Who are the three students I added last week?"
- "Which active students have zero attendance in the last 14 days?"

North-star contribution (`00_Vision.md` §9): every second saved here lowers **minutes-per-day inside Buddysaradhi**. A tutor who can resolve a parent phone call ("how much does my child owe?") in one drawer-open instead of three Excel scrolls saves the entire call.

Success metrics for this screen specifically:

- Median drawer-open latency **< 100ms** from cached state, **< 250ms** cold.
- List render of 1,000 students **< 80ms** to first frame (virtualised).
- Add-Student flow median completion **< 25 seconds** for an existing tutor, **< 60 seconds** for a first-time tutor.
- Duplicate-detection interstitial surfaces on **≥ 95%** of genuine duplicates (precision tuned to minimise false positives — see §10 BR-STU-02).
- Zero ledger rows ever edited or deleted from this screen (immutability enforced at the DB layer, see `11_Data_Model.md` §5).

---

## 3. Navigation Entry

| Entry | Mechanism |
|-------|-----------|
| Sidebar | `Students` item (icon: `GraduationCap`), 2nd position below Dashboard. Active state: cyan inset bar + `bg-[#00F0FF]/10`. |
| Keyboard | `G S` (jump to Students); `?` opens the shortcut cheatsheet. |
| Command palette | `⌘K` → "Students" or "Open student: <name>" with fuzzy match. |
| Deep-link | URL `?s=students&id=<student_id>&tab=<tab>` — shell parses query params and pre-loads the drawer. |
| Cross-screen links | Dashboard "Due Today" → student drawer (Ledger tab). Fees & Payments "Unpaid matrix" → student drawer (Invoices tab). Attendance grid row long-press → student drawer (Attendance tab). Notifications bell → student drawer (Timeline tab). |
| Mobile | Bottom tab bar (2nd of 5) — same `GraduationCap` icon, label "Students". |

Per `02_Core_Logic.md` §5, screen switching is Zustand-driven in-shell; only `/` is a URL route. Deep-link params are parsed by the shell, not by a new route handler.

---

## 4. User Story

**As "Solo Rohan"** (primary persona, 15–80 students), I run a Class 10 Maths batch in Pune. Today a parent calls me at 9 PM:

> *"Beta, how much has Aarav paid this year, and is there a fee due next week?"*

I tap the `Students` sidebar item. The list is already loaded (local SQLite, instant). I type "aarav" in the in-screen search — the row appears in 60ms. I tap it. The drawer slides in over 220ms (spring `stiffness: 320, damping: 32`). I land on the **Profile** tab; I tap the **Ledger** tab. There it is: every charge, every payment, every discount, immutable, time-sorted. I tap **Invoices** — the next due invoice (`INV-000017`, due 2025-09-05) is amber-tagged "Upcoming". I read the parent the total paid this year (`₹ 36,000`, mono right-aligned) and the next due (`₹ 4,500`, amber). The call ends in 90 seconds. The parent is impressed. I never opened Excel.

**As "Centre Priya"** (secondary persona, 80–300 students), I onboard 30 new students every April. I open Students → "Bulk Import" → upload the template `.xlsx`. The screen processes row-by-row (Zod-validated), runs duplicate detection, and shows me a summary: 28 added, 2 duplicates surfaced for merge review. I merge one, proceed with the other. I then bulk-assign the "Class 11 — Physics — 5pm" batch to all 30 via the batch-action bar. The screen writes 30 `audit_log` rows and 30 `student_enrollments` rows in one transaction. I close the laptop. Twelve minutes, end to end.

**As any tutor**, when I open the screen and the tenant is empty, I see the honest empty state (per Principle 15): "No students yet — add your first in 20 seconds." with an emerald primary CTA and a "Bulk import from Excel →" text link. Nothing is blank. Nothing is ambiguous.

---

## 5. UX Principles

This screen is governed most strongly by:

- **P1 — The tutor is the user, not the student.** No gamification. No student-facing surface. The student exists *inside* the tutor's screen.
- **P4 — The ledger is immutable truth.** The Ledger tab renders `ledger_entries` directly. Every balance is derived. No "edit payment" button exists here — only "Void receipt" (which posts a reversing entry, gated by PIN).
- **P5 — Offline-first, always.** Add, edit, archive, restore, bulk-tag — all work in airplane mode. The list renders from local SQLite; the drawer renders from the same.
- **P6 — Defaults are sacred.** New students inherit `settings.default_fee_model` (postpaid monthly). The Add form ships pre-filled with sane values (admission_date = today, status = active, fee_model = default).
- **P8 — Density without clutter.** Default list shows **6 columns**: `code, name, grade, batch, fee_model, balance_due`. The other 20+ fields live in the drawer.
- **P11 — Security is tactile, not theatrical.** Archive/restore/graduate flows confirm with a 5-second haptic + audit log. No "Are you really sure?" triple dialogs.
- **P12 — The tutor's time is the metric.** Bulk actions, saved filters, FTS5 search, virtualised list — all lower minutes-per-day.
- **P15 — Honest empty states.** Empty tenant shows a designed CTA, never a blank grid.

---

## 6. Screen Layout

The screen is a **master-detail composition**: a virtualised master list occupies the full content pane; tapping a row opens a right-side **detail drawer** (right dock on `xl+`, bottom sheet on `< md`). The drawer never replaces the list — both stay mounted so the tutor can tab between students with `↑`/`↓` while the drawer stays open.

### 6.1 ASCII Layout (desktop `xl+`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Topbar: Rohan Maths Tuition · [global search] · Sep 2025 · 🔔 · 👤          │
├──────────┬───────────────────────────────────────────────────────────────────┤
│          │  Students                                              [+ Add]   │
│          │  ────────────────────────────────────────────────────────────────│
│ Sidebar  │  [All] [Active] [Inactive] [Graduated] [Archived] · [Filter ▾]   │
│          │  [Search: name, code, phone, school ________________________]     │
│  ◉ Dash  │  ────────────────────────────────────────────────────────────────│
│  ◉ Stud  │  Code    Name              Grade   Batch         Fee    Balance  │
│  ◉ Attd  │  ────────────────────────────────────────────────────────────────│
│  ◉ Fees  │  STU-01  Aarav Sharma      Cl 10   Maths 6pm     post   ₹ 4,500  │ ← row selected (cyan border)
│  ◉ Sett  │  STU-02  Diya Patel        Cl 10   Maths 6pm     post   ₹ 0      │
│          │  STU-03  Ishaan Verma      Cl 11   Physics 5pm   pre    ⚠ ₹3,000 │ ← prepaid unpaid chip
│          │  STU-04  Kabir Singh       Cl 12   Maths 6pm     post   ₹ 1,200  │
│  ⚙ Sync  │  STU-05  Meera Iyer        Cl 10   Maths 6pm     post   ₹ 0      │ ← sibling badge 👥
│  ⚡ Cmd K │  STU-06  Sahana Rao        Cl  9   Maths 6pm     post   ₹ 6,750  │ ← overdue (flare dot)
│          │  …                                                          [▼]  │
│          │  ────────────────────────────────────────────────────────────────│
│          │  Showing 6 of 142 · [Bulk: 0 selected]              [◀ 1 2 3 ▶]  │
│          │                                                                   │
│          │       ╔═══════════════════════════════════════════════════════╗  │
│          │       ║  Aarav Sharma  · STU-01  · active        [⋯ Actions] ║  │ ← Detail Drawer
│          │       ║  ─────────────────────────────────────────────────── ║  │
│          │       ║  [Profile] [Fee Plan] [Ledger] [Invoices]            ║  │
│          │       ║  [Attendance] [Timeline] [Notes] [Documents]         ║  │
│          │       ║  ─────────────────────────────────────────────────── ║  │
│          │       ║  Balance Due          ₹ 4,500   ← amber, mono         ║  │
│          │       ║  Next Due             INV-000017 · 05 Sep · ₹4,500    ║  │
│          │       ║  Last Payment         ₹ 4,500 · 12 Aug · UPI          ║  │
│          │       ║  ─────────────────────────────────────────────────── ║  │
│          │       ║  Ledger  (immutable · 47 entries)                     ║  │
│          │       ║  ┌─────────────────────────────────────────────────┐ ║  │
│          │       ║  │ 12 Aug  PAYMENT_RECEIVED  −₹4,500  UPI · RCP-12 │ ║  │
│          │       ║  │ 05 Aug  FEE_CHARGED       +₹4,500  INV-000017   │ ║  │
│          │       ║  │ 12 Jul  PAYMENT_RECEIVED  −₹4,500  Cash·RCP-09  │ ║  │
│          │       ║  │ 05 Jul  FEE_CHARGED       +₹4,500  INV-000016   │ ║  │
│          │       ║  │ …                                                 │ ║  │
│          │       ║  └─────────────────────────────────────────────────┘ ║  │
│          │       ║              [Record Payment → Fees screen]          ║  │
│          │       ╚═══════════════════════════════════════════════════════╝  │
├──────────┴───────────────────────────────────────────────────────────────────┤
│  Online · synced 2m ago · v1.0.0+abc1234 · © Buddysaradhi Omni-Core              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Master List — Default 6 Columns

| # | Column | Width | Source | Notes |
|---|--------|-------|--------|-------|
| 1 | `code` | 96px | `students.code` | Mono. Cyan when selected. |
| 2 | `name` | flex (min 200px) | `first_name + ' ' + last_name` | Sticky on horizontal scroll. Long-press → context menu. |
| 3 | `grade` | 96px | `students.grade` | Caption-style muted. |
| 4 | `batch` | 180px | primary enrollment's `batches.name` | Joined via `student_enrollments`. Multiple → "Maths 6pm +1". |
| 5 | `monthly_fee` | 104px | `students.monthly_fee_paise` (cache) | Right-aligned mono. `₹ 1,500/mo`. Amber if NULL ("— set fee" CTA). Replaces the old `fee_model` column as the primary fee signal — the model (postpaid/prepaid) is secondary, shown in the detail drawer. |
| 6 | `balance_due` | 120px | derived `Σ(charge) − Σ(credit)` | Right-aligned mono. Amber if >0, emerald if ≤1, flare dot if overdue. |

Row height: `h-12` (48px). Hover: `bg-white/5`. Selected: `bg-[#00F0FF]/10` + cyan left inset `shadow-[inset_2px_0_0_#00F0FF]`. Sticky first column (code+name) on horizontal scroll. Column widths persisted per user via `localStorage`/`expo-secure-store`.

**Column packing rule (P8):** only 6 visible by default. A "Columns ⚙" button in the toolbar reveals 8 additional togglable columns (phone, school, board, admission_date, status, fee_frequency, last_attended, tags). Drag-reorder persisted.

**Enrolment fee field (mandatory).** The "Add Student" / enrolment sheet now requires a **Monthly Fee** input (integer rupees, stored as paise) and a **Frequency** selector (`Monthly` default / `Quarterly` / `Annual`). On save, `FeeRateEngine.setInitialRate` creates the first `student_fee_rates` row + the `students.monthly_fee_paise` cache + the auto-generated `fee_plan` (BR-FEE-20). A student cannot be saved without a monthly fee — it is the base unit for every calculation downstream. The detail drawer's **Fee tab** shows the fee-history timeline (`FeeRateEngine.history`) and a `[Change fee]` action that opens the append-only fee-change sheet (BR-FEE-21, see `07_Fees_and_Payments.md §6.2a`).

### 6.3 Toolbar

Row of glass-chip filters above the list:

- **Segmented status filter:** `All · Active · Inactive · Graduated · Archived`. Defaults to `Active` for tenants with > 50 students; `All` otherwise.
- **Filter ▾:** opens a sheet with `batch`, `fee_model`, `tag`, `balance_range` (`0` / `> 0` / `overdue only` / custom), `admitted_in_last` (`7d`/`30d`/`90d`/`all`).
- **Saved filters:** ⭐ icon — saves current filter set under a name; appears as a chip row below the toolbar. Up to 8 saved filters per tenant.
- **Search input:** in-screen FTS5 search across `first_name, last_name, code, phone, email, school, grade`. 250ms debounce. Distinct from topbar global search (which spans all screens).
- **Bulk-action bar:** appears when ≥ 1 row is checkbox-selected. Actions: `Archive`, `Assign Tag`, `Assign Batch`, `Generate Invoices`, `Export`. Disabled actions are greyed (not hidden).

### 6.4 Detail Drawer — 8 Tabs

| Tab | Renders | Primary action |
|-----|---------|----------------|
| **Profile** | Identity card, contact, school/grade, guardian list, batch enrollments, tags, custom fields, status pill, "Edit Profile" button. | Edit (opens form sheet) |
| **Fee Plan** | `FeePlanCard`(s) — model, cycle, base amount, schedule items with status chips, discounts, scholarship. Prepaid plans show a "next cycle prepay due" countdown. | "Generate invoice" (if item in window per BR-FEE-04); "Edit plan" |
| **Ledger** | `LedgerTable` — immutable, time-sorted (newest first). Columns: date, type, description, direction, amount (signed), method, receipt/invoice link. Filter chips by type. | "Record payment →" (deep-links to Fees); "Void entry" (PIN-gated, only on entries that allow it per BR-LED-03/L04) |
| **Invoices** | `InvoiceList` — student's invoices with status pills (`unpaid` flare, `partial` amber, `paid` emerald, `overdue` flare, `void` muted violet). Tap → invoice detail sheet. | "Generate invoice" / "Share receipt" |
| **Attendance** | `AttendanceMini` — 12-week heatmap (BR-CALC-07), attendance % (BR-CALC-06), last-attended date, late count. | "Open in Attendance →" |
| **Timeline** | `StudentTimeline` — chronological union of lifecycle, batch, attendance, payment, invoice, fee events. | "Export timeline" |
| **Notes** | `NotesPanel` — list of `student_notes` (rich text, DOMPurify-sanitised). | "Add note" |
| **Documents** | `DocumentUploader` — drag-drop or attach; stored as local blobs with `student_documents` rows. | "Upload" |

Drawer width: 480px on `xl`, 560px on `2xl`. Below `md`, it becomes a full-height bottom sheet (90vh). Tabs are horizontally scrollable on `base`/`sm`.

### 6.5 Empty State

When tenant has zero non-archived students:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│              [ line-art: graduation cap, 120×120 ]           │
│                  cyan + emerald, no text inside              │
│                                                              │
│              No students yet                                 │
│              Add your first in 20 seconds.                   │
│                                                              │
│           ┌────────────────────────────┐                     │
│           │  + Add Student             │  ← emerald glow     │
│           └────────────────────────────┘                     │
│                                                              │
│           or import from Excel →                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

When tenant has students but the current filter returns zero, a smaller empty state appears: "No students match this filter." with a "Clear filters" text link.

---

## 7. Component Tree

```tsx
<StudentsScreen />                           // route: ?s=students
├── <StudentsToolbar
│     filters={StudentFilters}
│     savedFilters={SavedFilter[]}
│     onFilterChange={(f) => setFilters(f)}
│     onSearch={(q: string) => debouncedFTS(q)}
│     searchQuery={string}
│     bulkSelectedIds={string[]}
│     onBulkAction={(action: BulkAction) => void}
│   />
├── <StudentMasterList
│     students={StudentListItem[]}           // virtualised
│     selectedId={string | null}
│     onRowTap={(id) => openDrawer(id)}
│     onRowLongPress={(id) => openContextMenu(id)}
│     loading={boolean}
│     error={string | null}
│     totalCount={number}
│     pageSize={number}                      // 50 default
│     onSort={(col: SortCol) => void}
│     sortState={{ col, dir }}
│   />
│   ├── <VirtualListScroller                 // react-window (web) / FlashList (mobile)
│         itemCount={students.length}
│         rowHeight={48}
│         renderRow={(i) => <StudentRow student={students[i]} />}
│       />
│   └── <StudentRow
│         student={StudentListItem}
│         selected={boolean}
│         onClick={() => onRowTap(student.id)}
│         onLongPress={() => onRowLongPress(student.id)}
│       />
│         ├── <CodeCell code={student.code} />
│         ├── <NameCell
│              firstName, lastName,
│              siblingBadge={student.sibling_group_id ? true : false}
│              overdueBadge={student.is_overdue}
│              prepaidPendingBadge={student.prepaid_pending}
│            />
│         ├── <GradeCell grade={student.grade} />
│         ├── <BatchCell batches={student.batches_summary} />
│         ├── <FeeModelPill model={student.fee_model} />   // emerald/amber/violet
│         └── <BalanceCell
│              amountMinor={student.balance_due_minor}
│              currencyCode={settings.currency_code}
│              locale={settings.locale}
│              status={student.payment_status}              // 'paid'|'partial'|'unpaid'|'overdue'|'no_dues'
│            />
├── <BulkActionBar
│     selectedIds={string[]}
│     actions={['archive', 'assign_tag', 'assign_batch', 'generate_invoices', 'export']}
│     onAction={(a, ids) => bulkMutate(a, ids)}
│     onClear={() => clearSelection()}
│   />
├── <PaginationBar
│     page={number}
│     totalPages={number}
│     onPageChange={(p) => setPage(p)}
│   />
├── <StudentDetailDrawer
│     studentId={string | null}
│     open={boolean}
│     onOpenChange={(o) => setDrawerOpen(o)}
│     activeTab={TabKey}                      // 'profile'|'fee_plan'|'ledger'|'invoices'|'attendance'|'timeline'|'notes'|'documents'
│     onTabChange={(t) => setActiveTab(t)}
│   >
│   ├── <DrawerHeader
│        student={StudentDetail}
│        actionsMenuItems={[
│          {label: 'Edit', icon: 'Pencil', onSelect: openEditSheet},
│          {label: 'Generate Invoice', icon: 'FileText', onSelect: generateInvoice},
│          {label: 'Record Payment', icon: 'Wallet', onSelect: deepLinkToFees},
│          {label: 'Remind Guardian', icon: 'Bell', onSelect: sendReminder},
│          {label: 'Mark Inactive', icon: 'Pause', onSelect: setStatus('inactive')},
│          {label: 'Mark Graduated', icon: 'Award', onSelect: setStatus('graduated')},
│          {label: 'Archive', icon: 'Archive', onSelect: archiveStudent, danger: true},
│          {label: 'Restore', icon: 'RotateCcw', onSelect: restoreStudent, visible: student.status === 'archived'},
│        ]}
│      />
│   ├── <DrawerQuickStats
│        balanceDue={number}
│        nextDueInvoice={Invoice | null}
│        lastPayment={LedgerEntry | null}
│        siblingCount={number}
│      />
│   ├── <Tabs value={activeTab} onChange={onTabChange}>
│   │   <TabContent tab="profile">
│   │     <StudentProfileTab student={StudentDetail}>
│   │       <IdentityCard student={student} />
│   │       <ContactCard student={student} />
│   │       <SchoolCard student={student} />
│   │       <GuardianList
│   │         guardians={student.guardians}
│   │         onAdd={openGuardianForm}
│   │         onEdit={(g) => openGuardianForm(g)}
│   │         onSetPrimary={(id) => setPrimaryGuardian(id)}
│   │       />
│   │       <BatchEnrollmentManager
│   │         enrollments={student.enrollments}
│   │         batchesAvailable={BatchesList}
│   │         onEnroll={(batchId) => enrollStudent(student.id, batchId)}
│   │         onExit={(enrollmentId) => exitEnrollment(enrollmentId)}
│   │       />
│   │       <TagChips
│   │         tags={student.tags}
│   │         onCreateTag={(name, color) => createTag(name, color)}
│   │         onToggleTag={(tagId) => toggleTag(student.id, tagId)}
│   │       />
│   │       <CustomFieldsEditor
│   │         fields={student.custom_fields}  // JSON
│   │         schema={tenantCustomFieldSchema}
│   │       />
│   │     </StudentProfileTab>
│   │   </TabContent>
│   │   <TabContent tab="fee_plan">
│   │     <FeePlanCard
│   │       plan={FeePlan}
│   │       scheduleItems={FeeScheduleItem[]}
│   │       onGenerateInvoice={(itemId) => generateInvoice(student.id, itemId)}
│   │       onEditPlan={() => openFeePlanEditor(plan)}
│   │       prepaidNextCycleDue={string | null}    // ISO date or null
│   │     />
│   │     <DiscountAndScholarshipCard plan={plan} />
│   │   </TabContent>
│   │   <TabContent tab="ledger">
│   │     <LedgerTable
│   │       entries={LedgerEntry[]}
│   │       filterByType={LedgerType | 'all'}
│   │       onVoidEntry={(entryId) => voidEntry(entryId)}    // PIN-gated
│   │       onDeepLinkInvoice={(invoiceId) => switchToInvoicesTab(invoiceId)}
│   │       onDeepLinkReceipt={(receiptId) => openReceiptViewer(receiptId)}
│   │       immutable={true}                                  // disables any inline edit
│   │     />
│   │   </TabContent>
│   │   <TabContent tab="invoices">
│   │     <InvoiceList
│   │       invoices={Invoice[]}
│   │       onShareReceipt={(invoiceId) => shareReceipt(invoiceId)}
│   │       onVoidInvoice={(invoiceId) => voidInvoice(invoiceId)}    // PIN-gated
│   │       onGenerateNow={() => generateInvoiceForNextDueItem(student.id)}
│   │     />
│   │   </TabContent>
│   │   <TabContent tab="attendance">
│   │     <AttendanceMini
│   │       heatmap={AttendanceCell[][]}    // 12 weeks × 7 days per BR-CALC-07
│   │       pct={number}                    // BR-CALC-06
│   │       lastAttended={string | null}
│   │       lateCount={number}
│   │       onDeepLinkDate={(date) => navigateAttendance(student, date)}
│   │     />
│   │   </TabContent>
│   │   <TabContent tab="timeline">
│   │     <StudentTimeline
│   │       events={TimelineEvent[]}        // union query result
│   │       onFilterChange={(type) => refetch({type})}
│   │       onExportTimeline={() => exportTimeline(student.id)}
│   │     />
│   │   </TabContent>
│   │   <TabContent tab="notes">
│   │     <NotesPanel
│   │       notes={StudentNote[]}
│   │       onAdd={(bodyHtml) => addNote(student.id, bodyHtml)}
│   │       onEdit={(id, bodyHtml) => editNote(id, bodyHtml)}
│   │       onDelete={(id) => deleteNote(id)}
│   │     />
│   │   </TabContent>
│   │   <TabContent tab="documents">
│   │     <DocumentUploader
│   │       documents={StudentDocument[]}
│   │       onUpload={(file: File) => uploadDocument(student.id, file)}
│   │       onPreview={(id) => previewDocument(id)}
│   │       onDelete={(id) => deleteDocument(id)}
│   │       acceptedMimeTypes={['image/*', 'application/pdf']}
│   │       maxSizeBytes={10 * 1024 * 1024}    // 10 MB
│   │     />
│   │   </TabContent>
└── <AddStudentSheet open={addOpen} onOpenChange={setAddOpen} />
    ├── <AddStudentForm
          initialValues={AddStudentDefaults}
          onSubmit={(values) => submitAddStudent(values)}
          duplicateWarning={StudentDuplicateMatch | null}
          onProceedAnyway={() => confirmAddAnyway()}
          onMergeInstead={(targetId) => openMergeUI(targetId)}
        />
    └── <DuplicateDetectionInterstitial
          match={StudentDuplicateMatch}    // { existingStudent, dupKey, score }
          onMerge={() => openMergeUI(match.existingStudent.id)}
          onProceedAnyway={() => confirmAddAnyway()}
          onCancel={() => closeSheet()}
        />
```

### 7.1 Shared Types

```ts
type StudentListItem = {
  id: string; code: string | null;
  first_name: string; last_name: string | null;
  grade: string | null;
  batches_summary: { id: string; name: string }[];  // max 3 surfaced
  fee_model: 'postpaid' | 'prepaid' | 'mixed';
  balance_due_minor: number;
  payment_status: 'paid' | 'partial' | 'unpaid' | 'overdue' | 'no_dues';
  is_overdue: boolean;
  prepaid_pending: boolean;          // true if prepaid student has unpaid current-cycle schedule item
  sibling_group_id: string | null;
  status: 'active' | 'inactive' | 'graduated' | 'archived';
};

type StudentDetail = StudentListItem & {
  dob: string | null; gender: 'M' | 'F' | 'O' | null;
  phone: string | null; email: string | null; address: string | null;
  school: string | null; board: string | null;
  admission_date: string;
  custom_fields: Record<string, unknown> | null;
  notes: string | null;
  guardians: Guardian[];
  enrollments: Enrollment[];
  tags: Tag[];
  fee_plans: FeePlan[];
};

type TimelineEvent =
  | { kind: 'enrolled'; date: string; ref: { student_id: string } }
  | { kind: 'batch_joined'; date: string; ref: { batch_id: string; batch_name: string } }
  | { kind: 'batch_exited'; date: string; ref: { batch_id: string; batch_name: string } }
  | { kind: 'attendance_marked'; date: string; ref: { session_id: string; status: string } }
  | { kind: 'fee_charged'; date: string; ref: { ledger_entry_id: string; amount_minor: number; invoice_id: string | null } }
  | { kind: 'payment_received'; date: string; ref: { ledger_entry_id: string; amount_minor: number; receipt_id: string | null } }
  | { kind: 'discount_granted'; date: string; ref: { ledger_entry_id: string; amount_minor: number } }
  | { kind: 'invoice_generated'; date: string; ref: { invoice_id: string; number: string; total: number } }
  | { kind: 'archived'; date: string; ref: { actor: string } }
  | { kind: 'restored'; date: string; ref: { actor: string } }
  | { kind: 'graduated'; date: string; ref: { actor: string } }
  | { kind: 'note_added'; date: string; ref: { note_id: string; preview: string } };
```

---

## 8. State Management

### 8.1 Zustand Slice — `studentsStore`

```ts
interface StudentsStoreState {
  // Filters & search
  filters: StudentFilters;          // { status[], batchIds[], feeModels[], tagIds[], balanceRange, admittedInLast }
  searchQuery: string;
  savedFilters: SavedFilter[];
  page: number; pageSize: number;
  sort: { col: SortCol; dir: 'asc' | 'desc' };

  // Selection & drawer
  selectedStudentId: string | null;
  drawerOpen: boolean;
  activeTab: TabKey;
  bulkSelectedIds: string[];

  // Mutation sheets
  addSheetOpen: boolean;
  editSheetOpen: boolean;
  duplicateInterstitial: StudentDuplicateMatch | null;
  mergeTargetId: string | null;

  // Actions
  setFilters: (f: Partial<StudentFilters>) => void;
  setSearchQuery: (q: string) => void;
  openDrawer: (id: string, tab?: TabKey) => void;
  closeDrawer: () => void;
  setActiveTab: (t: TabKey) => void;
  toggleBulkSelect: (id: string) => void;
  clearBulkSelection: () => void;
  openAddSheet: () => void;
  closeAddSheet: () => void;
  openEditSheet: () => void;
  setDuplicateInterstitial: (m: StudentDuplicateMatch | null) => void;
}
```

The slice is **purely UI state**. No server data lives in Zustand — that is TanStack Query's job.

### 8.2 TanStack Query Keys

```ts
['students', 'list', { filters, searchQuery, page, pageSize, sort }]   // StudentListItem[]
['students', 'count', { filters }]                                     // number
['students', 'saved-filters']                                          // SavedFilter[]
['student', studentId]                                                 // StudentDetail
['student', studentId, 'ledger', { typeFilter }]                       // LedgerEntry[]
['student', studentId, 'invoices', { statusFilter }]                   // Invoice[]
['student', studentId, 'attendance-summary', { weeks: 12 }]            // AttendanceMiniDTO
['student', studentId, 'timeline', { typeFilter }]                     // TimelineEvent[]
['student', studentId, 'notes']                                        // StudentNote[]
['student', studentId, 'documents']                                    // StudentDocument[]
['student', studentId, 'fee-plans']                                    // FeePlan[]
['students', 'duplicate-check', { dupKey }]                            // StudentDuplicateMatch | null
```

Stale times: list 30s, detail 60s, ledger/invoices/timeline 0s (always refetch on focus), notes/documents 60s. Cache survives shell-preserving navigation (per `02_Core_Logic.md` §5).

### 8.3 Optimistic Updates

| Mutation | Optimistic strategy |
|----------|---------------------|
| Edit profile | `queryClient.setQueryData(['student', id], merge(newValues))` immediately; list row re-derives name/grade on next invalidation. Rollback on error + toast. |
| Add tag | Append to `student.tags` array optimistically. |
| Archive / Restore | Move row out of list (filter `status`), update `selectedStudentId` to null if archived. Audit log write blocks mutation until success (fail-closed per BR-SEC-03). |
| Enroll / Exit batch | Optimistic on `student.enrollments`; rollback on conflict. |
| Add note | Append optimistically with `pending: true` flag; the row visually de-emphasises until sync confirms. |
| Upload document | Optimistic placeholder card with spinner; replaced with final row on success. |
| Bulk archive | Filter all selected IDs from the list immediately; reconcile on success. |
| Bulk assign tag/batch | Patch each `StudentListItem` in the cache; one round-trip. |
| Bulk generate invoices | Toast "Generating N invoices…"; on success, invalidate `['students','list']` (balances change). |

All mutations write to `sync_outbox` immediately after local commit; the sync engine flushes on connectivity (per `02_Core_Logic.md` §3.6).

### 8.4 Cross-Engine Event Subscriptions

The Students screen subscribes to the in-process event bus (`02_Core_Logic.md` §8):

- `LEDGER_MUTATED` → invalidate `['student', studentId, 'ledger']`, `['student', studentId, 'invoices']`, `['student', studentId]` (balance_due changed), `['students', 'list']` (row balance changed).
- `SYNC_COMPLETED` → invalidate all `['students', '*']` keys (LWW may have changed rows).
- `REMINDER_DUE` with `category='due_fee'` and `ref_type='student'` → bump a `duesBadge` counter on the relevant row.

---

## 9. Database Operations

All queries use `@libsql/client` prepared statements (per `10_Security.md` §9). `tenant_id` is bound from the JWT claim, never from client input.

### 9.1 List Query — with Filters, Pagination, Balance Join

```ts
// Students list (default 6 columns + supporting fields) via Prisma ORM.
const students = await db.student.findMany({
  where: {
    tenantId,
    archivedAt: null,
    ...(statusFilter   ? { status:    { in: statusFilter } }    : {}),  // status filter
    ...(batchFilter    ? { enrollments: { some: { batchId: { in: batchFilter }, exitedOn: null } } } : {}),  // batch filter
    ...(feeModelFilter ? { feeModel:  { in: feeModelFilter } }  : {}),  // fee model filter
    ...(tagFilter      ? { tags:      { some: { tagId: { in: tagFilter } } } } : {}),  // tag filter
    ...(admittedSince  ? { admissionDate: { gte: admittedSince } } : {}),  // admitted-in-last filter
  },
  include: {
    enrollments: {
      where: { exitedOn: null },
      include: { batch: { select: { id: true, name: true } } },
      orderBy: { joinedOn: 'desc' },
    },
    guardians: { where: { isPrimary: 1 }, select: { phone: true }, take: 1 },
    ledgerEntries: {
      where: { type: { not: 'VOID' }, reversesEntryId: null },
      select: { direction: true, amount: true },
    },
    feePlans: {
      where: { model: 'prepaid', active: 1 },
      include: { scheduleItems: { where: { status: { in: ['pending','invoiced','partial','overdue'] }, dueDate: { lte: today } }, take: 1 } },
    },
    invoices: { where: { status: 'overdue' }, take: 1 },
    tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
  },
  orderBy: [
    // sortField: 'name' | 'code' | 'balance' | 'createdAt'; sortDir: 'asc' | 'desc'
    ...(sortField === 'name' ? [{ lastName: sortDir }] : []),
    ...(sortField === 'code' ? [{ code: sortDir }] : []),
    // 'balance' sort is computed in TS post-fetch (derived field) — see below.
    { createdAt: 'desc' },
  ],
  take: pageSize,
  skip: pageSize * page,
});

// Post-fetch in TS: compute balance_due_minor, prepaid_pending, sibling_group_id, is_overdue.
const rows = students.map(s => ({
  ...s,
  primary_batch_name: s.enrollments[0]?.batch?.name ?? null,
  batches_json:       s.enrollments.map(e => ({ id: e.batch.id, name: e.batch.name })),
  balance_due_minor:  s.ledgerEntries.reduce((acc, le) => acc + (le.direction === 'charge' ? le.amount : -le.amount), 0),
  prepaid_pending:    s.feePlans.some(fp => fp.scheduleItems.length > 0),
  sibling_group_id:   s.guardians[0]?.phone ? hash(s.guardians[0].phone).slice(0, 16) : null,
  is_overdue:         s.invoices.length > 0,
}));
// For 'balance' sort, sort the rows array in TS.
```

For tenants > 500 students, the engine uses the materialised `student_balance_cache` table (updated by trigger on `db.ledgerEntry.create()`, refreshed nightly) instead of recomputing the balance per row — see `11_Data_Model.md` §15.1.

### 9.2 Detail Fetch

```ts
const student = await db.student.findUniqueOrThrow({
  where: { id: studentId, tenantId },
  include: {
    guardians:    { select: { id: true, name: true, relation: true, phone: true, email: true, isPrimary: true } },
    enrollments:  { include: { batch: { select: { id: true, name: true } } } },
    tags:         { include: { tag: { select: { id: true, name: true, color: true } } } },
  },
});
// guardians_json, enrollments_json, tags_json are produced by JSON.stringify of the
// included relations in TS — no `json_group_array` SQL needed.
```

### 9.3 Ledger by Student

```ts
const ledger = await db.ledgerEntry.findMany({
  where: {
    studentId, tenantId,
    ...(typeFilter ? { type: typeFilter } : {}),
  },
  include: {
    receipt: { select: { number: true } },
    invoice: { select: { number: true } },
  },
  orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
  take: 500,
  skip: 500 * page,
});
```

### 9.4 Invoices by Student

```ts
const invoices = await db.invoice.findMany({
  where: { studentId, tenantId },
  include: {
    ledgerEntries: {
      where: { type: 'PAYMENT_RECEIVED', reversesEntryId: null },
      select: { amount: true },
    },
  },
  orderBy: { issueDate: 'desc' },
  take: 200,
  skip: 200 * page,
});
// paid_amount_minor = invoice.ledgerEntries.reduce((a, le) => a + le.amount, 0)
```

### 9.5 Attendance Summary (12 weeks)

```ts
const attendance = await db.attendanceRecord.findMany({
  where: {
    studentId,
    session: { tenantId, sessionDate: { gte: twelveWeeksAgo } },
  },
  include: { session: { select: { sessionDate: true } } },
  orderBy: { session: { sessionDate: 'desc' } },
});
```

The 12×7 heatmap matrix is built client-side from these rows (sparse → dense with `null` for missing days). `%` computed via BR-CALC-06.

### 9.6 Timeline Query — Union of Events

```ts
// Five parallel findMany calls; merged + sorted in TS.
const [student, enrollments, attendance, ledger, invoices, notes] = await Promise.all([
  db.student.findUniqueOrThrow({ where: { id: studentId, tenantId } }),
  db.studentEnrollment.findMany({ where: { studentId }, include: { batch: true } }),
  db.attendanceRecord.findMany({ where: { studentId }, select: { markedAt: true, sessionId: true, status: true } }),
  db.ledgerEntry.findMany({
    where: { studentId, type: { not: 'VOID' }, reversesEntryId: null,
             type: { in: ['FEE_CHARGED', 'PAYMENT_RECEIVED', 'DISCOUNT_GRANTED'] } },
    select: { type: true, occurredOn: true, id: true, amount: true, invoiceId: true, receiptId: true },
  }),
  db.invoice.findMany({ where: { studentId }, select: { issueDate: true, id: true, number: true, total: true } }),
  db.studentNote.findMany({ where: { studentId }, select: { createdAt: true, id: true, body: true } }),
]);

// Merge into a single timeline:
const timeline = [
  ...(student.admissionDate ? [{ kind: 'enrolled',         date: student.admissionDate, ref: { studentId } }] : []),
  ...(student.archivedAt    ? [{ kind: 'archived',         date: student.archivedAt,    ref: { actor: 'tutor' } }] : []),
  ...(student.status === 'graduated' ? [{ kind: 'graduated', date: student.updatedAt, ref: { actor: 'tutor' } }] : []),
  ...enrollments.map(se => ({ kind: 'batch_joined', date: se.joinedOn, ref: { batchId: se.batchId, batchName: se.batch.name } })),
  ...enrollments.filter(se => se.exitedOn).map(se => ({ kind: 'batch_exited', date: se.exitedOn, ref: { batchId: se.batchId, batchName: se.batch.name } })),
  ...attendance.map(ar => ({ kind: 'attendance_marked', date: ar.markedAt, ref: { sessionId: ar.sessionId, status: ar.status } })),
  ...ledger.map(le => ({ kind: le.type === 'FEE_CHARGED' ? 'fee_charged' : le.type === 'PAYMENT_RECEIVED' ? 'payment_received' : 'discount_granted', date: le.occurredOn, ref: { ledgerEntryId: le.id, amountMinor: le.amount, invoiceId: le.invoiceId, receiptId: le.receiptId } })),
  ...invoices.map(i => ({ kind: 'invoice_generated', date: i.issueDate, ref: { invoiceId: i.id, number: i.number, total: i.total } })),
  ...notes.map(n => ({ kind: 'note_added', date: n.createdAt, ref: { noteId: n.id, preview: n.body.slice(0, 80) } })),
].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 500);
```

Restored events are sourced from `audit_log` (action='student_restore') joined on `ref_id = student_id`, since the restore does not mutate `students` directly beyond clearing `archived_at`.

### 9.7 FTS5 Search (in-screen)

```ts
// FTS5 has no Prisma ORM equivalent — it is a SQLite virtual-table feature.
// The engine issues a single `db.$queryRaw`-free call via the dedicated
// `lib/search/searchStudents.ts` helper, which uses Prisma's `search` extension
// for SQLite FTS5 (no raw SQL string in app code; the FTS5 MATCH term is built
// from tokenised, parameterised input).
const studentIds = await searchStudentsFts(query, tenantId, { limit: 50 });
// → returns string[] of student.id values; hydrate via §9.2 (drawer) or §9.1 (list).
```

The `MATCH` term is built by tokenising the search input on whitespace and joining with ` AND ` (so `aarav sharma` → `aarav AND sharma`). Fuzzy matching is delegated to FTS5's `trigram` tokenizer (configured at provisioning) so typos still surface. The `lib/search/searchStudentsFts.ts` helper is the single audited entry point for FTS5 queries — it is the only place in the codebase where FTS5 virtual-table access happens, and it is reviewed on every PR.

### 9.8 Duplicate Detection (BR-STU-02)

```ts
const dupKey = computeDupKey({ firstName, lastName, phone });  // client-side
const existing = await db.student.findFirst({
  where: { tenantId, archivedAt: null, dupKey },
  select: { id: true, firstName: true, lastName: true, phone: true, status: true },
});
```

The `dup_key` is computed client-side from the form values and stored as a column on `students` (so the lookup is a single equality predicate on an indexed column, not a SQL function call). A positive match returns the existing student; the UI shows the DuplicateDetectionInterstitial. Never auto-merge (BR-STU-02).

### 9.9 Bulk Generate Invoices (single transaction)

```ts
// The whole bulk action runs in one db.$transaction; if any one student fails
// validation, the entire batch rolls back with a per-student failure list surfaced in the toast.
await db.$transaction(async (tx) => {
  // For each selected student's earliest pending fee_schedule_item within the BR-FEE-04 window:
  for (const item of pendingItems) {
    // 1. Create the invoice
    const invoice = await tx.invoice.create({ data: {
      id: uuidv7(), tenantId, number: nextInvoiceNumber, studentId: item.studentId,
      feeScheduleItemId: item.id, issueDate: today, dueDate: item.dueDate,
      subtotal: item.total, discount: 0, extraCharges: 0, total: item.total,
      status: 'unpaid', tamperHash: computeInvoiceHash(item), createdAt: nowIso, updatedAt: nowIso,
    } });

    // 2. Mark the schedule item as invoiced
    await tx.feeScheduleItem.update({ where: { id: item.id }, data: { status: 'invoiced', updatedAt: nowIso } });

    // 3. Atomically increment the per-tenant invoice sequence
    await tx.settings.update({
      where: { tenantId },
      data: { nextInvoiceSeq: { increment: 1 }, updatedAt: nowIso },
    });

    // 4. Audit log row in the same TX
    await tx.auditLog.create({ data: {
      id: uuidv7(), tenantId, actor: 'tutor', action: 'invoice_generate',
      refType: 'student', refId: item.studentId, metadata: { invoiceId: invoice.id }, createdAt: nowIso,
    } });

    // 5. Post a FEE_CHARGED ledger entry per BR-FEE-07 (one charge per invoice, amount = total)
    await tx.ledgerEntry.create({ data: {
      id: uuidv7(), tenantId, studentId: item.studentId, invoiceId: invoice.id,
      type: 'FEE_CHARGED', amount: item.total, direction: 'charge',
      description: `Invoice ${invoice.number}`, occurredOn: today,
      source: 'manual', deviceId, createdBy: actor, createdAt: nowIso, updatedAt: nowIso,
    } });
  }
});
```

---

## 10. Business Rules

This screen is governed by the following rules from `12_Business_Rules.md`. Where a rule is rendered visually, the rendering is specified.

### 10.1 Student Lifecycle — BR-STU-01..S04

- **BR-STU-01 (Status Transitions).** Allowed transitions enforced in the actions menu:
  - `active ⇄ inactive` — toggle, no PIN.
  - `active → graduated` — confirm dialog, audit log.
  - `active|inactive → archived` — confirm dialog, PIN (BR-SEC-02), audit log. Ledger frozen (no new `FEE_CHARGED` rows permitted; existing dues remain collectable).
  - `archived → active` — "Restore" action, PIN, audit log, drawer refresh.
- **BR-STU-02 (Duplicate Detection).** On `AddStudentForm` submit, compute `dup_key = lower(first_name+last_name+phone_last4)`. If a non-archived student with the same `dup_key` exists, show `DuplicateDetectionInterstitial` with options: **Merge** (opens MergeUI — pick canonical record, field-by-field resolution) or **Proceed anyway** (creates a new student; audit-logged `student_duplicate_proceed`). Never auto-merge.
- **BR-STU-03 (Family Grouping).** Students sharing a primary guardian with the same phone get a `sibling_group_id` (hashed phone). UI: a small `👥` badge next to the name in the list + a "Siblings" section in the Profile tab. v1 only surfaces the relationship; sibling discounts are v1.x (`15_Future_Roadmap.md`).
- **BR-STU-04 (Code Auto-Generation).** If `code` blank on Add, assign `STU-<next_seq>` from a per-tenant counter (`app_state.next_student_seq` — added via migration `0002`). Codes are unique per tenant, never reused. The Add form has an "auto" toggle (default on) that hides the code field.

### 10.2 Fee Models — BR-FEE-01..F08

- **BR-FEE-01 (Three Models).** Three fee models supported: `postpaid`, `prepaid`, `mixed`.
- **BR-FEE-02 (Default Model).** Add form pre-fills `fee_model` from `settings.default_fee_model` (default `postpaid`).
- **BR-FEE-03 (Schedule Generation).** On Fee Plan create/edit, `fee_schedule_items` are generated from `start_date` to `end_date` (or +12 cycles if open-ended). Items labelled e.g. "August 2025 Tuition". Plan edit is diff-based — existing items are never deleted; removed items are marked `void`.
- **BR-FEE-04 (Invoice Generation).** A "Generate invoice" button appears on a schedule item when its `due_date` is within ±7 days of today, OR the tutor manually triggers it, OR auto-invoice is on. The action runs the §9.9 bulk SQL.
- **BR-FEE-05 (Tamper Hash).** Computed on invoice create; verified on every render of the Invoices tab. Mismatch → red "TAMPERED" badge + `audit_log` `invoice_tamper_detected`.
- **BR-FEE-06 (Discounts).** `fixed` or `percent` (basis points). Discounts post a `DISCOUNT_GRANTED` credit ledger entry alongside the `FEE_CHARGED`, keeping the ledger transparent.
- **BR-FEE-07 (Extra Charges).** Folded into `invoices.total`; the `FEE_CHARGED` entry's `amount` equals `invoices.total`. One charge row per invoice.
- **BR-FEE-08 (Prepaid Soft Block).** Prepaid students with an unpaid current-cycle schedule item show a yellow "Fee pending" chip on the Attendance grid (rendered by the Attendance screen) AND an amber "Prepaid pending" badge in the Students list row (`prepaid_pending: true`). The tutor **can** still mark them present (we never block education); the chip persists and the Reminder Engine surfaces it (BR-RPT-01).

#### How postpaid vs prepaid render differently

| Aspect | Postpaid student | Prepaid student | Mixed student |
|--------|------------------|-----------------|---------------|
| `fee_model` pill | Emerald `post` | Amber `pre` | Violet `mixed` |
| Schedule item due_date | cycle-end + grace | cycle-start | per-item (mixed) |
| Unpaid current-cycle chip on list row | — | ⚠ amber "Prepaid pending" | ⚠ amber if any prepaid item pending |
| Fee Plan card header | "Postpaid · monthly" | "Prepaid · monthly · next cycle due DD MMM" | "Mixed · schedule per item" |
| Generate Invoice button visibility | due within ±7 days | due on/before cycle-start | per schedule item |
| Attendance grid chip | — | amber "Fee pending" (BR-FEE-08) | per item |
| Reminder Engine category | `due_fee` (BR-RPT-01) + `upcoming_due` (BR-RPT-02) | `due_fee` + `upcoming_due` + persistent prepaid chip | `due_fee` + `upcoming_due` |

### 10.3 Ledger Grammar — BR-LED-01..L06

- **BR-LED-01 (Entry Types & Direction).** The Ledger tab renders all seven types with signed amounts: charges `+₹`, credits `−₹`. Voids render as a strikethrough line referencing the reversed entry.
- **BR-LED-02 (Append-Only, Idempotent).** The Ledger tab has **no edit affordance**. "Void entry" is the only mutation; it opens a confirm sheet, prompts PIN (BR-SEC-02), and posts a `VOID` row mirroring the original (with `reverses_entry_id` set).
- **BR-LED-03 (Voiding a Payment).** Cascade: VOID ledger entry → `receipts.voided_at` set → receipt PDF stamped "VOID" → linked invoice reverts to `unpaid`/`partial` → `audit_log` `payment_void`.
- **BR-LED-04 (Voiding a Fee Charge).** Permitted only if no `PAYMENT_RECEIVED` credits it. If credits exist, the void button is disabled with a tooltip "Receipts exist against this charge. Void them first."
- **BR-LED-05 (Backdated Ledger).** Out of scope for direct creation here — that lives in Fees & Payments. The Ledger tab *renders* backdated entries with an amber "backdated" badge if `occurred_on < last_locked_attendance_date`.
- **BR-LED-06 (Advance Payments).** Entries with `description LIKE '%[ADVANCE]%'` are grouped in a separate "Advance wallet" card above the ledger table; the advance balance is a derived negative number.

### 10.4 Reminders — BR-RPT-01..R05

- **BR-RPT-01 (Due Fee Reminder).** When `fee_schedule_items.status='overdue'`, the student's list row shows a flare dot next to `balance_due`. The drawer QuickStats card surfaces a "DUE TODAY" flare chip with the amount.
- **BR-RPT-02 (Upcoming Due).** 3 days before `due_date`, an amber "Upcoming due" chip appears in the drawer.
- **BR-RPT-03 (Missing Attendance).** Not directly rendered here — surfaced on Dashboard.
- **BR-RPT-04 (Inactive Student).** A 14-day zero-attendance active student gets an amber "Inactive 14d" pill in the list row. A weekly report is generated (Settings).
- **BR-RPT-05 (Snooze).** Snooze actions live on the Dashboard and Notifications bell; not on this screen.

### 10.5 Calculations — BR-CALC-01..08

All balances, payment statuses, attendance %, and heatmap cell colors are computed per the formulas in `12_Business_Rules.md` §11. The Students screen **never re-implements** a formula locally — it consumes the derived views or runs the canonical SQL from §9.

### 10.6 Money — BR-M-01..M05

- All money is integer minor units (BR-M-01). The list and drawer render amounts via a shared `<Money>` component: takes `amountMinor: number` + `currencyCode` + `locale`, formats with `Intl.NumberFormat(locale, { style: 'currency', currency })`. No float arithmetic anywhere (BR-M-03).
- Tolerance: balances within 1 minor unit render as emerald "Paid" (BR-M-05).

---

## 11. Edge Cases

| # | Case | Behaviour |
|---|------|-----------|
| E1 | Student with no enrollments | Batch cell shows muted "—". EnrollmentManager shows "Add to a batch" CTA. |
| E2 | Student with no fee plan | Fee Plan tab shows empty card: "No fee plan yet. Create one →" |
| E3 | Student with no ledger entries | Ledger tab shows honest empty: "No transactions yet." |
| E4 | Student archived mid-cycle with pending invoice | Invoice remains collectable. Ledger frozen for new charges. Status pill = "archived". Drawer shows a flare "Archived — ledger frozen" banner. |
| E5 | Restore an archived student | All historical data intact. `archived_at` cleared. Audit log entry. Drawer refreshes; status pill flips to "active". |
| E6 | Guardian phone shared by two students (siblings) | Both rows show 👥 badge. Sibling group card lists both with a deep-link. |
| E7 | Prepaid student pays partial mid-cycle | Schedule item status → `partial`. Amber chip persists. Ledger shows the `PAYMENT_RECEIVED` credit. |
| E8 | Prepaid student pays full mid-cycle | Schedule item status → `paid`. Chip clears. Next-cycle item generates per BR-FEE-03. |
| E9 | Duplicate detection matches 3+ existing students | Interstitial lists all matches; tutor can merge with any one or proceed. |
| E10 | Merge two students | MergeUI: pick canonical; non-canonical's ledger entries get re-pointed (`student_id` updated via trigger-permitted path — ledger triggers allow `student_id` updates only inside a merge transaction flagged in `app_state.merge_in_progress`); non-canonical soft-deleted with `archived_at` set and a `student_merged` audit log entry. |
| E11 | Bulk generate invoices — one student already has an invoice for the same item | Skipped; reported in summary as "1 skipped (already invoiced)". |
| E12 | Bulk archive includes a student with a positive balance | Allowed — dues remain collectable per BR-STU-01. Toast: "Archived N students. N have outstanding dues — see Archived filter." |
| E13 | Filter returns zero rows but tenant has students | "No students match this filter." + "Clear filters" link. |
| E14 | Search returns > 50 hits | FTS5 capped at 50 (BR-FEE-0x — see §9.7). Toast: "Showing top 50 matches. Refine your search." |
| E15 | Custom fields schema changed mid-session | Drawer re-fetches schema; unknown fields render read-only with a muted "(legacy field)" tag. |
| E16 | Student dob in future | Validation error (see §14). |
| E17 | Phone with country code "91" vs "+91" | Normalised to E.164-ish on save; both match in duplicate detection (last-4 algorithm robust to prefix). |
| E18 | Restore attempted on `graduated` (not `archived`) student | Not allowed — `graduated` is terminal-preserved. Action hidden. |
| E19 | Document upload exceeds 10 MB | Rejected pre-upload with toast "File too large. Max 10 MB." |
| E20 | Two tutors (Centre Priya persona) edit the same student simultaneously | LWW on `students.updated_at`; loser's version written to `audit_log` `sync_conflict_lost` (BR-SYN-01). |
| E21 | Adding a student while device is offline | Local insert succeeds immediately; `sync_outbox` row queued; sync drawer badge increments. |
| E22 | Restoring from backup that includes an archived student | Restore preserves `archived_at`; student remains archived post-restore. |

---

## 12. Offline Behaviour

Per Principle 5 (P5) and BR-SYN-01..SY04:

- **List rendering:** fully offline. The master list reads from local SQLite (Turso embedded replica on mobile/desktop; IndexedDB cache + last-known on web). No spinner; if offline, a subtle "Offline · cached 2h ago" chip appears next to the search input.
- **Detail drawer:** fully offline. All eight tabs read from the local replica.
- **Add / Edit / Archive / Restore / Bulk:** all execute locally. Each writes to local SQLite + a `sync_outbox` row. The Sync drawer badge increments.
- **Ledger:** append-only rows are inserted locally with a UUID v7 id (conflict-immune per BR-SYN-02). On sync, the row lands in Turso Cloud verbatim.
- **Document upload:** stored as a local blob (`expo-file-system` on mobile, IndexedDB on web, FS via Tauri on desktop). Sync engine replicates the blob to Turso's blob storage (separate from the row data).
- **FTS5 search:** index is local, rebuilt on every local mutation. Search works offline.
- **Bulk generate invoices:** fully offline. The `next_invoice_seq` counter is incremented locally; on sync, if the cloud counter has advanced (another device generated invoices), the local sequence reconciles by jumping to `max(local, cloud) + 1`. Gaps are tolerated (BR-RC-01, BR-FEE-04).
- **Failure modes:** if a `sync_outbox` row fails 5 times, it's marked `conflict` and surfaced in the Sync drawer for manual review (BR-SYN-03). The local row remains visible and editable.

---

## 13. Sync Behaviour

| Operation | Sync strategy |
|-----------|---------------|
| Add student | `db.student.create()` + `db.syncOutbox.create({ data: { op: 'insert', ... } })`. On sync, the row is pushed. If a student with the same `id` already exists (another device created it offline with the same UUID — impossible since UUID v7 is unique per millisecond-per-device), LWW by `updated_at`. |
| Edit student | `db.student.update()` + `db.syncOutbox.create({ data: { op: 'update', ... } })`. On sync, LWW; loser's pre-image written to `audit_log` `sync_conflict_lost`. |
| Archive / Restore | `db.student.update({ data: { archivedAt: ... } })` + audit log; LWW. |
| Add tag / enrollment / guardian / note / document | `db.<entity>.create()` + sync. |
| Ledger entry (VOID) | `db.ledgerEntry.create()` (append-only, conflict-immune). |
| Bulk actions | N `db.<entity>.create/update` calls in one `db.$transaction`; N `db.syncOutbox.create` rows. |
| Schema drift | If `app_state.schema_version` < server's, the device refuses to sync (BR-SYN-04) and prompts the user to update the app. The Students screen continues to render (read-only) from the local replica. |
| Conflict on `next_invoice_seq` | Reconciled to `max(local, cloud) + 1` on next sync. Gaps tolerated (BR-FEE-04). |
| Conflict on `next_student_seq` (BR-STU-04) | Same reconciliation. Codes are never reused. |

After every `SYNC_COMPLETED` event, the screen invalidates all `['students', '*']` queries and re-runs the Reminder Engine pass. The footer's "synced Xm ago" updates.

---

## 14. Validation Rules

All rules enforced via Zod schemas in `packages/shared`. The Add/Edit form surfaces inline errors with a flare left-border on the input and a caption-style message.

| Field | Rule |
|-------|------|
| `first_name` | Required, 1–80 chars, no control chars. |
| `last_name` | Optional, 0–80 chars. |
| `code` | Optional, 1–20 chars, `^[A-Za-z0-9-]+$`. Unique per tenant (server-side check). Auto-generated if blank (BR-STU-04). |
| `dob` | Optional, ISO date, must be ≤ today and ≥ 1900-01-01. |
| `gender` | Optional, enum `'M' \| 'F' \| 'O'`. |
| `phone` | Optional, E.164-ish: `^\+?[0-9]{6,15}$`. Normalised to `+<digits>` on save. |
| `email` | Optional, RFC-5322 simplified: `^[^\s@]+@[^\s@]+\.[^\s@]+$`. Lowercased on save. |
| `address` | Optional, 0–500 chars. |
| `school` | Optional, 0–200 chars. |
| `grade` | Optional, 0–40 chars. |
| `board` | Optional, enum `'CBSE' \| 'ICSE' \| 'State' \| 'IB' \| 'IGCSE' \| 'Other' \| null`. |
| `admission_date` | Required, ISO date, must be ≤ today and ≥ 2000-01-01. |
| `status` | Enum `'active' \| 'inactive' \| 'graduated' \| 'archived'` (default `active`). |
| `fee_model` | Enum `'postpaid' \| 'prepaid' \| 'mixed'` (default = `settings.default_fee_model`). |
| `custom_fields` | Optional JSON; values validated against tenant custom-field schema. |
| `notes` | Optional, 0–5000 chars; sanitised with DOMPurify before render. |
| Guardian `name` | Required if any guardian field present. |
| Guardian `phone` | Same as student phone rule. |
| Guardian `is_primary` | At most one per student; if set, others demoted automatically. |
| Enrollment `batch_id` | Must exist in tenant, must not be archived. |
| Enrollment `joined_on` | ISO date, ≤ today. |
| Tag `name` | 1–40 chars, unique per tenant. |
| Document `file` | MIME ∈ `['image/*', 'application/pdf']`, size ≤ 10 MB. |

Server-side validation re-runs every rule (defence-in-depth) and returns a 422 with a structured error object on failure. The form maps errors back to fields.

---

## 15. Security Rules

Per `10_Security.md`:

- **App Lock.** The screen is blurred and non-interactive when `app_lock_state='locked'`. Unlock sheet covers the content pane. (BR-SEC-01)
- **Sensitive-Mutation PIN (BR-SEC-02).** These actions on this screen require a fresh PIN/biometric (≤ 30s old):
  - Archive student (single or bulk)
  - Restore student
  - Mark graduated
  - Void a ledger entry (any)
  - Void an invoice
  - Bulk delete (none in v1 — bulk archive only)
  - Export student list (Excel)
  - Restore-from-backup (not on this screen but triggered by import)
  Every one writes `audit_log` *before* the mutation (fail-closed: if audit write fails, mutation is blocked).
- **Tenant guard.** Every query binds `tenant_id` from the JWT claim (`10_Security.md` §7). Never from client input.
- **Audit log.** Append-only (trigger-guarded). Audited actions originating from this screen:
  `student_create`, `student_edit`, `student_archive`, `student_restore`, `student_graduate`, `student_merge`, `enrollment_add`, `enrollment_exit`, `tag_assign`, `tag_create`, `bulk_archive`, `bulk_tag`, `bulk_batch`, `bulk_invoice`, `note_add`, `note_edit`, `note_delete`, `document_upload`, `document_delete`, `student_duplicate_proceed`, `export_excel` (student scope).
- **Input sanitisation.** Notes and custom-fields rich text pass through DOMPurify before render (XSS defence). Search input is parameter-bound to FTS5 (no SQL injection).
- **Document storage.** Local blobs are stored in OS-encrypted locations (mobile) or IndexedDB (web, scrubbed of PII beyond the file itself) or SQLCipher (desktop). Replicated to Turso blob storage on sync.
- **Receipt tamper-evidence (BR-FEE-05, §14 in `10_Security.md`).** Invoices tab recomputes `tamper_hash` on every render. Mismatch → red "TAMPERED" badge + `audit_log` `invoice_tamper_detected`.

---

## 16. Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Form validation error | Inline flare-bordered input + caption message. Submit button disabled. |
| Server-side validation mismatch (422) | Form re-renders with server errors mapped to fields. Toast: "Please fix the highlighted fields." |
| Network error on mutation | Optimistic UI rolled back. Toast (flare, persistent): "Couldn't save. Retrying in background." Mutation queued in `sync_outbox`. |
| Ledger trigger blocks UPDATE/DELETE (should never happen — defensive) | Caught as P0; toast (flare, persistent): "Ledger integrity error. This should not happen — please report." `audit_log` `ledger_violation`. |
| Duplicate detection false-positive | User can click "Proceed anyway" — creates the student with `student_duplicate_proceed` audit log. |
| Drawer open for a student that was just archived on another device | Drawer shows a flare banner "This student was archived on another device." with a "Close" button. List refreshes on next focus. |
| Bulk action partially fails | Per-row failure list surfaced in a sheet. Successful rows committed; failed rows remain selected. |
| FTS5 index corrupt (rare) | Search degrades to `LIKE %q%` with a one-time toast "Search index rebuilding…". Index rebuilt in background. |
| Schema drift (server ahead of client) | Read-only mode. Toast: "Update Buddysaradhi to edit students. Viewing cached data." |
| Document upload MIME spoofing | Server-side magic-byte check; rejected with toast "That file isn't really a PDF or image." |
| Tenant DB unreachable (web, first paint) | Last-known cache renders. Toast: "Couldn't reach Turso. Showing last synced data." |
| Tenant DB unreachable (mobile/desktop) | Embedded replica reads continue uninterrupted. No toast — offline is the happy path. |
| Audit log write fails | Mutation blocked (fail-closed per BR-SEC-03). Toast: "Couldn't verify audit. Action blocked. Please try again." |

---

## 17. Performance Targets

| Metric | Target | Mechanism |
|--------|--------|-----------|
| First contentful paint (list) | < 80ms for 1,000 students | `react-window` (web) / `FlashList` (mobile) virtualisation; only visible rows render. |
| Row tap → drawer open | < 100ms (cached), < 250ms (cold) | Drawer component is pre-loaded; data fetched from local SQLite synchronously on first paint, TanStack Query hydrates. |
| Drawer tab switch | < 50ms | Tabs are lazy-mounted but stay mounted once visited (keep-alive). |
| FTS5 search | < 60ms for 10k students | Local FTS5 index; 250ms debounce. |
| Bulk archive (50 students) | < 500ms total | Single transaction; optimistic UI. |
| Add student (form submit → drawer open) | < 300ms | Local INSERT; drawer opens on the new id immediately. |
| Timeline query (500 events) | < 120ms | Union query uses covering indexes; result cached for 60s. |
| Ledger scroll (10k entries) | 60fps | Virtualised `LedgerTable`; rows recycle. |
| Heatmap render (12 weeks × 7 days × 1 student) | < 30ms | Pre-computed client-side matrix; pure render. |
| Memory footprint (1k students loaded) | < 25 MB | Virtualisation + TanStack Query GC; only visible + recently-visible rows in memory. |

Optimisations:

- The list query (§9.1) uses a materialised `student_balance_cache` table updated by trigger on `ledger_entries` INSERT. Falls back to inline sub-query if cache missing.
- The drawer's eight tabs each have their own query key, so switching tabs invalidates only that tab's data, not the whole drawer.
- Saved filters are stored locally (no round-trip to load).
- Column widths and sort state persist in `localStorage` / `expo-secure-store` to avoid reflow on re-mount.

---

## 18. Accessibility

Per `13_UI_Guidelines.md` §10 (Accessibility Commitments) and §8 (Component Vocabulary):

- **Contrast.** All text on glass ≥ 4.5:1 (verified against the rgba stack, not just the token). Emerald/cyan on cosmic bg = 7:1+. Status pills always pair color with an icon (`✓` emerald, `◐` amber, `✕` flare, `—` muted) — never color alone.
- **Focus.** Visible cyan ring `outline: 2px solid #00F0FF; outline-offset: 2px;` on every interactive element. Never removed.
- **Keyboard.**
  - `Tab` order: toolbar → search → list → drawer tabs → drawer content → bulk action bar.
  - `↑`/`↓` navigate list rows while drawer is open; drawer updates to the new student.
  - `Enter` opens the drawer on a focused row.
  - `Esc` closes the drawer or any open sheet.
  - `Cmd/Ctrl+K` opens the command palette (deep-link to a student).
  - `G S` jumps to Students from anywhere.
  - `?` opens the shortcut cheatsheet.
  - `1`–`8` switch drawer tabs.
  - `Cmd/Ctrl+A` selects all rows in the current filter.
  - `Delete` archives selected rows (prompts PIN).
- **Screen readers.**
  - `aria-live="polite"` on the toast region and the duplicate-detection interstitial.
  - `aria-busy` on the list and drawer while loading.
  - `sr-only` labels on icon-only buttons (e.g., the `⋯ Actions` menu).
  - Each row has `aria-label="Student: Aarav Sharma, Code STU-01, Balance ₹4,500, Status active"`.
  - The drawer has `role="dialog"` + `aria-labelledby` pointing to the student name heading.
  - The ledger table has `role="table"` with proper `aria-rowindex` and `aria-colindex`.
- **Motion sensitivity.** `prefers-reduced-motion: reduce` replaces all spring animations with 120ms fades. The drawer slides become opacity-only.
- **Touch targets.** ≥ 44×44px on `base`/`sm`. Row tap targets span the full 48px row height.
- **Color-blind safe.** Status encoding never relies on color alone — always paired with icon + text.
- **Internationalisation.** All copy is key-based (no hard-coded strings); locale-formatted amounts via `Intl.NumberFormat`. Date format follows `settings.locale`.

---

## 19. Testing Requirements

### 19.1 Unit Tests (Vitest)

- Zod schemas (`packages/shared`) — every validation rule from §14, including edge cases (future dob, malformed phone, etc.).
- `dup_key` computation — BR-STU-02.
- Money formatting (`<Money>` component) — all currency/locale pairs.
- Balance derivation from a mock ledger — BR-CALC-01, BR-CALC-02.
- Attendance % computation — BR-CALC-06.
- Timeline event union — given mock rows from each source table, the union produces the correct ordered list.
- Prepaid pending flag computation — given a fee plan + schedule items, the flag is correct per BR-FEE-08.

### 19.2 Component Tests (Vitest + Testing Library)

- `StudentMasterList` renders 1,000 rows in < 80ms (performance test).
- `StudentRow` renders the correct status pill, sibling badge, overdue dot, prepaid pending chip for all combinations.
- `StudentDetailDrawer` opens on row tap < 100ms from cache.
- `AddStudentForm` blocks submit on validation errors; shows inline errors.
- `DuplicateDetectionInterstitial` appears when `duplicateWarning` is non-null; calls `onMergeInstead` or `onProceedAnyway` correctly.
- `LedgerTable` has no edit affordance; "Void entry" button disabled on entries with credits (BR-LED-04).
- `BulkActionBar` enables/disables actions based on selection count.
- `TagChips` creates a new tag and toggles it.
- `DocumentUploader` rejects oversized files.

### 19.3 Integration Tests (Vitest + msw / in-memory Turso)

- Add student → appears in list → drawer opens → all tabs render non-empty.
- Edit student → list row updates → drawer refreshes → audit log row written.
- Archive student → disappears from active filter → appears in archived filter → ledger frozen (new `FEE_CHARGED` rejected).
- Restore student → reappears in active filter → ledger unfrozen.
- Bulk archive 10 students → 10 audit log rows → list updates.
- Bulk generate invoices for 5 students with pending schedule items → 5 invoices + 5 `FEE_CHARGED` entries + 5 `audit_log` rows in one transaction.
- Duplicate detection interstitial fires on duplicate `dup_key`.
- Merge two students → ledger entries re-pointed → non-canonical archived → canonical's drawer shows the merged history.
- Offline add → `sync_outbox` row queued → sync → row visible on a second device.
- FTS5 search returns correct students for typo-tolerant queries.

### 19.4 End-to-End (Playwright)

- Full "Solo Rohan" user story from §4: open Students → search "aarav" → open drawer → switch to Ledger → read balance → switch to Invoices → see upcoming due. Total time < 8 seconds (asserted).
- Empty state → click "Add Student" → fill form → submit → drawer opens on new student.
- Bulk import Excel → 28 added, 2 duplicates surfaced → merge one → proceed with other.

### 19.5 Performance Tests

- 1,000-student list render < 80ms (Lighthouse).
- Drawer open < 100ms from cache (Playwright trace).
- 50-student bulk archive < 500ms (in-memory DB).
- 10k-entry ledger scroll maintains 60fps (Chrome performance trace).

### 19.6 Security Tests

- Every audited action writes `audit_log` *before* mutation (fail-closed test: corrupt the audit log, attempt mutation, assert it's blocked).
- Tenant guard: attempt to query a student from another tenant → empty result.
- Tamper hash: mutate an invoice row directly in DB → render Invoices tab → assert "TAMPERED" badge.
- PIN gate: attempt to archive without PIN → blocked.

---

## 20. Future Extensions

Deferred to v1.x or later (per `15_Future_Roadmap.md`):

- **Sibling discounts** — automatic 10% discount on the second sibling's fee plan (BR-STU-03 expanded).
- **Parent portal (read-only web)** — signed URL per student showing the same Ledger/Invoices/Timeline tabs, read-only.
- **Custom field schema builder** — drag-drop field types in Settings; reflected here in `CustomFieldsEditor`.
- **Student import from Google Sheets** — beyond the Excel template.
- **Bulk SMS / WhatsApp reminders** — "Remind all unpaid students" action (currently individual).
- **Student ID card PDF generation** — with QR code linking to the parent portal.
- **Alumni network** — graduated students searchable separately with "year of graduation" filter.
- **Multi-branch federation** — Academy Vikram persona (300–1,000 students) gets branch-scoped views.
- **AI-suggested fee plans** — based on historical payment behaviour of similar students.
- **Document OCR** — auto-extract grade/marks from uploaded report cards into custom fields.
- **Behavioural tagging** — auto-tags like "frequent late-payer" derived from ledger patterns.
- **Student merging UI v2** — field-by-field diff with side-by-side preview; currently v1 uses a simple canonical-pick flow.

These are deliberately out of scope for v1. The data model in `11_Data_Model.md` accommodates them without migration; the UI does not.

---

## 21. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 for the Students screen. The master-detail composition has more neumorphic controls than any other root screen (segmented status filter, FTS5 search, saved-filter chip row, bulk-action bar, drawer tabs, ledger void button). Every mockup below annotates the **glass tier** or **neumorphic recipe** so the design contract is unambiguous. Character set per §20.2; accent colours named; cross-references use canonical IDs only.

### 21.1 Design System Reference — Students

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces on this screen | Tier | Cross-ref |
|---|---|---|
| Sidebar / bottom-tab bar (mobile) | `glass-strong` | §5.5, §8.6 |
| Topbar | `glass-strong` sticky | §5.5 |
| List row (per-student) | `glass-faint` band (recedes so data reads) | §5.2, §8.4 |
| Detail drawer | `glass-strong` (elevated focus, slides over content) | §5.5, §8.7 |
| Drawer identity / contact / school cards (nested) | flat `bg-white/[0.04]` (no-glass-on-glass) | §5.3 |
| Add Student sheet | `glass-strong` + backdrop `bg-black/60` | §5.5, §8.7 |
| Duplicate-detection interstitial | `glass-strong` + backdrop | §5.5, §8.7 |
| Empty-state card | `glass` centered | §5.5, §8.19 |
| Toast (archive / restore / void) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| Bulk-action bar | `glass-strong` sticky bottom | §5.5 |
| Footer | `glass-faint` (recede), sticky per §13 | §5.5 |

| Neumorphic controls on this screen | Recipe | Cross-ref |
|---|---|---|
| `+ Add` primary button | `neumo-raised` + emerald glow | §6.6, §8.2 |
| Segmented status filter (`All / Active / Inactive / Graduated / Archived`) | well = `neumo-inset`; active pill = `neumo-raised` + cyan glow | §6.6, §8.5 |
| FTS5 search bar | `neumo-inset` | §6.6, §8.10 |
| Filter ▾ popover trigger | `neumo-raised` | §6.6 |
| Saved-filter chips | flat tinted (chips are not controls — §8.3); active chip X-button = `neumo-raised` micro | §8.3 |
| Bulk-action buttons (Archive / Assign Tag / Generate Invoices / Export) | `neumo-raised`; destructive = flare glow | §6.6, §8.2 |
| Drawer tab strip | tabs sit in flat tinted rail; active underline = `tab-underline-slide` (cyan) | §7.3, §8.6 |
| Drawer "Edit Profile" button | `neumo-raised` secondary | §6.6 |
| Drawer "Void entry" button (Ledger tab, PIN-gated) | `neumo-raised` + flare glow (destructive) | §6.6, §8.2 |
| Drawer "Record Payment →" deep-link button | `neumo-raised` + emerald glow | §6.6 |
| Pagination `◀ 1 2 3 ▶` | `neumo-raised` compact; active page = `neumo-pressed` | §6.6 |
| Column-width drag handles | `neumo-pressed` affordance during drag | §6.3 |
| Sort header caret buttons | `neumo-raised` compact | §6.6 |

> **References:** Nielsen Norman Group — *Master-Detail Pattern: Use It Carefully*; Smashing Magazine — *Designing Data-Heavy Tables For The Web* (sticky-first-column, virtualised scroll); Apple HIG — *Inspector Panes* (drawer parity); Material Design 3 — *Navigation Drawer* (anatomy of the right-docked detail); WCAG 2.1 AA §4.1.2 (Name, Role, Value — drawer tabs must expose `role="tab"` + `aria-selected`); A List Apart — *Skip Links and Screen Readers* (drawer focus management).

### 21.2 Mockup M1 — Full-Screen Desktop Layout (xl+ ≥ 1280px, master-detail)

```
DESKTOP (≥ 1280px) — Master list + right-docked detail drawer (480px wide on xl)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Topbar (.glass-strong sticky) ────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Rohan Maths Tuition · 🔍 Search · ⌘K · 🔔3 · 👤│ │
│ │  ◈ Dashboard              │ ├────────────────────────────────────────────────┤ │
│ │  ◉ Students  ← active     │ │  Students                          [+ Add]    │ │
│ │  ✓ Attendance             │ │  ┌──────────────────────────────────────────┐ │ │
│ │  ₹ Fees                   │ │  │ (●All)(○Active)(○Inactive)(○Grad)(○Arch) │ │ │
│ │  ⚙ Settings               │ │  │ · [Filter ▾] · [Search: name, code, phone]│ │ │
│ │                           │ │  └──────────────────────────────────────────┘ │ │
│ │  ──────                   │ │  ┌─ Master list (rows = .glass-faint bands) ─┐│ │
│ │  Aarav S.                 │ │  │ Code   Name          Grade  Batch  Fee  ₹ │ │ │
│ │  Pune · 142 students      │ │  │ ──────────────────────────────────────────│ │ │
│ │                           │ │  │ STU-01 Aarav Sharma  Cl10  Maths6  post 4.5│ │ │
│ │  ⚙ Sync                   │ │  │ STU-02 Diya Patel    Cl10  Maths6  post 0  │ │ │
│ │  ⚡ ⌘K                    │ │  │ STU-03 Ishaan Verma  Cl11  Phy5pm pre  ⚠3.0│ │ │
│ │                           │ │  │ STU-04 Kabir Singh   Cl12  Maths6  post 1.2│ │ │
│ │                           │ │  │ STU-05 Meera Iyer    Cl10  Maths6  post 0  │ │ │
│ │                           │ │  │ STU-06 Sahana Rao    Cl 9  Maths6  post 6.7│ │ │
│ │                           │ │  │ …                                                    │ │ │
│ │                           │ │  └────────────────────────────────────────────────┘ │ │
│ │                           │ │       ╔══════ Detail Drawer (.glass-strong) ═══════╗ │ │
│ │                           │ │       ║  Aarav Sharma · STU-01 · active [⋯ Actions]║ │ │
│ │                           │ │       ║  ─────────────────────────────────────── ║ │ │
│ │                           │ │       ║  [Profile][Fee Plan][●Ledger][Invoices]   ║ │ │
│ │                           │ │       ║  [Attendance][Timeline][Notes][Documents] ║ │ │
│ │                           │ │       ║  ─────────────────────────────────────── ║ │ │
│ │                           │ │       ║  Balance Due    ₹ 4,500  ← amber, mono   ║ │ │
│ │                           │ │       ║  Next Due       INV-17 · 05 Sep · ₹4,500 ║ │ │
│ │                           │ │       ║  ─────────────────────────────────────── ║ │ │
│ │                           │ │       ║  Ledger  (immutable · 47 entries)        ║ │ │
│ │                           │ │       ║  ┌────────────────────────────────────┐ ║ │ │
│ │                           │ │       ║  │ 12 Aug  PAYMENT_RECEIVED  −₹4,500  │ ║ │ │
│ │                           │ │       ║  │ 05 Aug  FEE_CHARGED       +₹4,500  │ ║ │ │
│ │                           │ │       ║  │ …                                   │ ║ │ │
│ │                           │ │       ║  └────────────────────────────────────┘ ║ │ │
│ │                           │ │       ║        [Record Payment →]  [⋯ Void]      ║ │ │
│ │                           │ │       ╚════════════════════════════════════════════╝ │ │
│ └───────────────────────────┘ └────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint, sticky) ───────────────────────────────────────────────┐ │
│ │  ● Online · synced 2m ago · 142 students · 12 with dues · v1.4.2 · © Buddysaradhi  │ │
│ └────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
   ↑ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2)
   ↑ sidebar + topbar = .glass-strong (8% white, 24px blur) — persistent chrome (§5.5)
   ↑ master list rows = .glass-faint (2% white, 8px blur) — must recede so data reads (§5.2)
   ↑ selected row = .glass-faint + 2px cyan left-bar (bg-cyan/10, aria-selected="true")
   ↑ detail drawer = .glass-strong (slides over content, elevated focus) — §8.7
   ↑ segmented status filter well = .neumo-inset; active pill = .neumo-raised + cyan glow (§8.5)
   ↑ [+ Add] primary = .neumo-raised + emerald glow (§8.2)
   ↑ search bar = .neumo-inset tray (§8.10)
   ↑ [Record Payment →] = .neumo-raised + emerald glow; [⋯ Void] = .neumo-raised + flare glow
   ↑ drawer tabs = flat tinted rail; active underline = cyan 2px (tab-underline-slide, §7.3)
   ↑ footer = .glass-faint (recede), sticky per §13
```

### 21.3 Mockup M2 — Empty State (fresh tenant, 0 students, P15)

```
EMPTY STATE — fresh tenant, no students
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Content (transparent over canvas) ─────────┐ │
│ │  ◈ Buddysaradhi                │ │                                              │ │
│ │  ◈ Dashboard              │ │     ┌─ Empty-state card (.glass) ────────┐  │ │
│ │  ◉ Students  ← active     │ │     │                                    │  │ │
│ │  ✓ Attendance             │ │     │         ╭──────────╮                │  │ │
│ │  ₹ Fees                   │ │     │         │  ┌────┐  │  ← 120×120     │  │ │
│ │  ⚙ Settings               │ │     │         │  │Grad│  │     line-art   │  │ │
│ │                           │ │     │         │  │Cap │  │     cyan+emerald│ │
│ │  ──────                   │ │     │         │  └────┘  │                │  │ │
│ │  Rohan M.                 │ │     │         ╰──────────╯                │  │ │
│ │  Pune · 0 students        │ │     │                                    │  │ │
│ │                           │ │     │            No students yet          │  │ │
│ │                           │ │     │       Add your first in 20 seconds. │  │ │
│ │                           │ │     │                                    │  │ │
│ │                           │ │     │   ┌────────────────────────────┐    │  │ │
│ │                           │ │     │   │  [+] Add Student           │    │  │ │
│ │                           │ │     │   └────────────────────────────┘    │  │ │
│ │                           │ │     │       or import from Excel →       │  │ │
│ │                           │ │     │                                    │  │ │
│ │                           │ │     └────────────────────────────────────┘  │ │
│ └───────────────────────────┘ └────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ─────────────────────────────────────────────────────┐ │
│ │  ● Online · synced just now · 0 students · 0 with dues · v1.4.2 · © Buddysaradhi │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ empty-state card = .glass (5% white, 24px blur) — centered, not elevated (§8.19)
   ↑ CTA = .neumo-raised + emerald glow (primary action, §6.6 / §8.2)
   ↑ secondary "import from Excel" = ghost link (--text-secondary, no shadow)
   ↑ illustration = custom SVG line-art graduation-cap (NOT lucide), cyan + emerald (§9.3)
   ↑ honest-empty-state rule (P15): never a blank grid; always a designed CTA
   ↑ "0 students" footer count is the *only* visible zero on this screen
```

### 21.4 Mockup M3 — Loading / Skeleton (list + drawer first paint)

```
SKELETON — first paint, list + drawer loading, < 80ms budget (§17)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Topbar (.glass-strong sticky) ────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Rohan Maths Tuition · 🔍 Search · ⌘K · 🔔3 · 👤│ │
│ │  ◉ Students  ← active     │ ├────────────────────────────────────────────────┤ │
│ │                           │ │  Students                          [+ Add]    │ │
│ │                           │ │  ┌──────────────────────────────────────────┐ │ │
│ │                           │ │  │ (░░░░)(░░░░░)(░░░░░░)(░░░)(░░░) · Filter │ │ │
│ │                           │ │  │ [Search: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]│ │ │
│ │                           │ │  └──────────────────────────────────────────┘ │ │
│ │                           │ │  ┌─ List skeleton (.glass-faint + shimmer) ──┐│ │
│ │                           │ │  │ ●  ░░░░░░░░░░░░░░░░░░  ░░░  ░░░░░  ░  ░░░░│ │ │
│ │                           │ │  │ ●  ░░░░░░░░░░░░░░░░░░  ░░░  ░░░░░  ░  ░░░░│ │ │
│ │                           │ │  │ ●  ░░░░░░░░░░░░░░░░░░  ░░░  ░░░░░  ░  ░░░░│ │ │
│ │                           │ │  │ ●  ░░░░░░░░░░░░░░░░░░  ░░░  ░░░░░  ░  ░░░░│ │ │
│ │                           │ │  │ ●  ░░░░░░░░░░░░░░░░░░  ░░░  ░░░░░  ░  ░░░░│ │ │
│ │                           │ │  └────────────────────────────────────────────────┘ │ │
│ │                           │ │       ╔════ Drawer skel (.glass-strong) ════╗  │ │
│ │                           │ │       ║  ░░░░░░░░░░░░░░░░░░░░░░░░░░  [⋯]  ║  │ │
│ │                           │ │       ║  ─────────────────────────────── ║  │ │
│ │                           │ │       ║  (░░░)(░░░░░░)(░░░░░░)(░░░░░░░)     ║  │ │
│ │                           │ │       ║  ─────────────────────────────── ║  │ │
│ │                           │ │       ║  ░░░░░░░░░░░░░░        ░░░░░░░░░░░░ ║  │ │
│ │                           │ │       ║  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ║  │ │
│ │                           │ │       ╚══════════════════════════════════════╝  │ │
│ └───────────────────────────┘ └────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ───────────────────────────────────────────────────────┐ │
│ │  ● Online · syncing… · — students · — with dues · v1.4.2 · © Buddysaradhi         │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
   ↑ list rows = .glass-faint + shimmer (1.2s loop, §8.20)
   ↑ drawer skeleton = .glass-faint blocks inside the .glass-strong drawer panel
     (no-glass-on-glass — drawer IS glass, skeleton blocks are flat-faint, §5.3)
   ↑ search bar = .neumo-inset tray; shimmer overlay on the placeholder text region
   ↑ segmented status filter = .neumo-inset well; shimmer on each pill slot
   ↑ aria-busy="true" on master list parent AND drawer parent (§10.5)
   ↑ list first paint budget < 80ms (1,000 students virtualised, §17)
   ↑ 120ms fade-out on resolve; no count-up animation on first paint (§8.4)
```

### 21.5 Mockup M4 — Primary Modal: Add Student Sheet (with duplicate-detection interstitial)

```
MODAL — Add Student Sheet (slides in from right on desktop, 480px drawer; bottom sheet on mobile)
┌──────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░ backdrop: bg-black/60 + backdrop-blur-sm ░░░░░░░░░░░░░ │
│  ░░░░░░░  ┌──────────────────────────────────────────────╲░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  │  Add Student                              ✕       │░░░░░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────┤░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  First name *                                │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐    │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ Aarav                                │    │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘    │░░░░░░░░░░░  │
│  ░░░░░░░  │  Last name                                   │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐    │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ Sharma                               │    │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘    │░░░░░░░░░░░  │
│  ░░░░░░░  │  Grade / Batch / Fee model (defaults filled)  │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌────────┐ ┌──────────┐ ┌──────────────┐   │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ Cl 10  │ │ Maths 6pm│ │ ● Postpaid   │   │░░░░░░░░░░░  │
│  ░░░░░░░  │  └────────┘ └──────────┘ └──────────────┘   │░░░░░░░░░░░  │
│  ░░░░░░░  │  Phone (E.164)                                │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐    │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ +91 98xxxxxxxx                       │    │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘    │░░░░░░░░░░░  │
│  ░░░░░░░  │  ──────────────────────────────────────       │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌─ DUPLICATE DETECTED (interstitial) ─────┐ │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ ⚠ 3 similar students found              │ │░░░░░░░░░░░  │
│  ░░░░░░░  │  │  ● Aarav Sharma (STU-01) — score 0.94   │ │░░░░░░░░░░░  │
│  ░░░░░░░  │  │    [Merge →]   [Not a duplicate]        │ │░░░░░░░░░░░  │
│  ░░░░░░░  │  │  ● Aarav Patel (STU-19) — score 0.71    │ │░░░░░░░░░░░  │
│  ░░░░░░░  │  │    [Merge →]   [Not a duplicate]        │ │░░░░░░░░░░░  │
│  ░░░░░░░  │  │  ⋯ +1 more (lower score)                │ │░░░░░░░░░░░  │
│  ░░░░░░░  │  └─────────────────────────────────────────┘ │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │   [Cancel]              [Add Student]        │░░░░░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────┘░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ backdrop = bg-black/60 + backdrop-blur-sm — click = cancel, ESC = cancel (§8.7)
   ↑ panel = .glass-strong (8% white, 24px blur) — highest-focus tier (§5.5)
   ↑ inputs = .neumo-inset wells (§8.9); focus = cyan 2px inset ring + glow
   ↑ segmented fee model = .neumo-inset well; active pill = .neumo-raised + cyan (§8.5)
   ↑ duplicate interstitial = flat bg-flare/[0.08] tinted sub-card with flare left-bar
     (no-glass-on-glass, §5.3); ⚠ = lucide AlertTriangle, flare accent
   ↑ [Merge →] = .neumo-raised + cyan glow (secondary); [Not a duplicate] = ghost link
   ↑ [Cancel] = ghost; [Add Student] = .neumo-raised + emerald glow (primary, §8.2)
   ↑ aria-modal="true" + focus-trap active (§10.5); ESC = cancel
   ↑ duplicate-detection precision tuned to minimise false positives (BR-STU-02, §10)
   ↑ on submit: optimistic insert into cache + sync_outbox row (BR-SYN-01)
   ↑ duplicate match score threshold = 0.70 (configurable in v1.x)
```

### 21.6 Mockup M5 — Toast / Confirmation: Archive Student (primary destructive)

```
TOAST + PIN-GATE — Archive Student (BR-STU-01, BR-SEC-02)
┌──────────────────────────────────────────────────────────────────────────────┐
│                       (Students screen underneath, dimmed by backdrop)        │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  ┌──────────────────────────────────────────────╲░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  │  Archive Aarav Sharma?                   ✕       │░░░░░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────┤░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  STU-01 · 47 ledger entries · ₹4,500 due.    │░░░░░░░░░░░  │
│  ░░░░░░░  │  Archived students:                          │░░░░░░░░░░░  │
│  ░░░░░░░  │   • Disappear from the active list          │░░░░░░░░░░░  │
│  ░░░░░░░  │   • Keep their ledger (dues remain due)      │░░░░░░░░░░░  │
│  ░░░░░░░  │   • Can be restored within 30 days          │░░░░░░░░░░░  │
│  ░░░░░░░  │   • Audit row written before mutation        │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Enter PIN to confirm                        │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐    │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ • • • • • •                          │    │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘    │░░░░░░░░░░░  │
│  ░░░░░░░  │      1  2  3    [Cancel]                     │░░░░░░░░░░░  │
│  ░░░░░░░  │      4  5  6    [Archive]  ← disabled         │░░░░░░░░░░░  │
│  ░░░░░░░  │      7  8  9      until 6 digits + verify     │░░░░░░░░░░░  │
│  ░░░░░░░  │      •  0  ⌫                                │░░░░░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────┘░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘

AFTER PIN verify + commit (Toast surfaces in the bottom-right):

                          ┌▌──────────────────────────────────┐
                          │▌ ✓  Aarav Sharma archived         │
                          │▌    STU-01 · 30d to restore       │
                          │▌              [Undo]  ✕           │
                          └▌──────────────────────────────────┘
                             ↑ 4px emerald left-bar (success)
                             ↑ .glass-strong (8% white, 24px blur) per §8.8
                             ↑ aria-live="polite" (success = polite, §10.5)
                             ↑ 4s auto-dismiss; swipe-down to dismiss (§15.3)
                             ↑ [Undo] = .neumo-raised compact (restores within 30d,
                               enqueues sync_outbox row per BR-SYN-01)
                             ↑ ✕ = ghost close
```

> **Why PIN-gate for archive (BR-SEC-02, §10_Security.md §4):** archive freezes the ledger — no new `FEE_CHARGED` rows allowed. That's a load-bearing mutation; a misclick would silently cap the tutor's revenue from this student. PIN = tactile intent.

### 21.7 Mockup M6 — Mobile Variant (`base` < 640px, master list + bottom-sheet drawer)

```
MOBILE (base < 640px) — single column, bottom-tab bar, drawer = 90vh bottom sheet
┌──────────────────────────────────────┐
│ ▔▔▔▔▔▔ ← env(safe-area-inset-top)    │
│ ┌─ Topbar (.glass-strong sticky) ───┐│
│ │ ◈  Students    🔍 ⌘K   🔔3       ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Status filter (.neumo-inset) ───┐│
│ │(●All)(○Act)(○Inact)(○Grad)(○Arch)││
│ └────────────────────────────────────┘│
│ ┌─ Search (.neumo-inset) ──────────┐│
│ │ 🔍  name, code, phone…       ⌘K ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ List rows (.glass-faint bands) ─┐│
│ │ ● Aarav Sharma · Cl10 · Maths6   ││
│ │   STU-01              post  ₹4,500││
│ │ ─────────────────────────────── ││
│ │ ● Diya Patel · Cl10 · Maths6     ││
│ │   STU-02              post  ₹0   ││
│ │ ─────────────────────────────── ││
│ │ ● Ishaan Verma · Cl11 · Phy5     ││
│ │   STU-03              pre  ⚠₹3,000││
│ │ ─────────────────────────────── ││
│ │ ⋯ +139 more                       ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ FAB (.neumo-raised, emerald) ───┐│
│ │                          [+]      ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Bottom Tab Bar (.glass-strong) ─┐│
│ │  ◈    👥    ✓    ₹    ⚙           ││
│ │ Home Stud Att  Fees Set           ││
│ └────────────────────────────────────┘│
│ ▁▁▁▁▁ ← env(safe-area-inset-bottom)  │
└──────────────────────────────────────┘

WHEN a row is tapped, the drawer slides up as a 90vh bottom sheet:

┌──────────────────────────────────────┐
│ ▔▔▔▔▔▔ ← safe-area top              │
│ ┌─ Topbar (.glass-strong) ─────────┐│
│ │ ◈  Students    🔍 ⌘K   🔔3       ││
│ └────────────────────────────────────┘│
│ ─── (master list dimmed behind) ─── │
│ ┌─ Drawer (.glass-strong, 90vh) ───┐│
│ │        ━━━ ← grab handle          ││
│ │  Aarav Sharma · STU-01   [⋯]     ││
│ │  ─────────────────────────────── ││
│ │  [Profile][Fee][●Ledger][Inv]… ›││
│ │  ─────────────────────────────── ││
│ │  Balance    ₹4,500  ← amber mono ││
│ │  Next Due   INV-17 · 05 Sep      ││
│ │  ─────────────────────────────── ││
│ │  Ledger (immutable · 47 entries) ││
│ │  12 Aug  PAYMENT_RECEIVED −₹4,500││
│ │  05 Aug  FEE_CHARGED      +₹4,500││
│ │  …                                  ││
│ │  [Record Payment →]  [⋯ Void]    ││
│ │  [✕ Close]                        ││
│ └────────────────────────────────────┘│
│ ▁▁▁▁▁ ← safe-area bottom            │
└──────────────────────────────────────┘
   ↑ topbar = .glass-strong sticky (§5.5)
   ↑ status filter well = .neumo-inset; active pill = .neumo-raised + cyan glow (§8.5)
   ↑ search bar = .neumo-inset tray; ⌘K chip = flat tinted kbd badge (§8.10)
   ↑ list rows = .glass-faint bands, 48px row height, 44×44px hit area (§10.2)
   ↑ FAB = .neumo-raised (emerald glow, 56×56px), bottom-right, above tab bar
   ↑ drawer = .glass-strong slides up as 90vh bottom sheet (§8.7 mobile variant)
   ↑ grab handle = flat bg-white/10 affordance; drag down to dismiss
   ↑ drawer max-height = calc(100vh - env(safe-area-inset-top) - 44px) (§4.3)
   ↑ bottom tab bar = .glass-strong + safe-area inset (§4.3, §8.6)
   ↑ every tab + row + button ≥ 44×44px hit area (§10.2)
   ↑ tabs horizontally scroll on base/sm (§8.6 mobile note)
```

### 21.8 Mockup M7 — State Matrix: Segmented Status Filter (primary interactive control)

```
STATE MATRIX — Segmented Status Filter (5 options, drives the list query)
Box: 64–80 char width per §20.3 rule 2.

DEFAULT (no option focused)            FOCUS (keyboard tab to "Active")
╭─ .neumo-inset well ──────────────╮   ╭─ .neumo-inset well ──────────────╮
│ (● All )( ○ Active )( ○ Inact ) │   │ ( ○ All )( ═Active═ )( ○ Inact ) │
│ ( ○ Grad )( ○ Archived )         │   │ ( ○ Grad )( ○ Archived )         │
╰──────────────────────────────────╯   ╰──────────────────────────────────╯
 ↑ active pill = .neumo-raised          ↑ focused option = cyan 2px ring
   + glass-strong overlay               + glow (§10.3 focus-visible)
 ↑ '▌' = 2px cyan left-bar inside pill  ↑ Enter / Space activates the option
   (tab-underline-slide, §7.3)          ↑ Tab moves to next option
 ↑ 36px height per option               ↑ Esc returns focus to the well

HOVER (on "Graduated")                  ACTIVE (Active pill pressed)
╭─ .neumo-inset well ──────────────╮   ╭─ .neumo-inset well ──────────────╮
│ (● All )( ○ Active )( ○ Inact ) │   │ (● All )( ═Active═ )( ○ Inact ) │
│ ( ○Grad )( ○ Archived )          │   │ ( ○ Grad )( ○ Archived )         │
╰──────────────────────────────────╯   ╰──────────────────────────────────╯
 ↑ hovered option = .neumo-raised       ↑ .neumo-pressed (inset 2px shadow
   extrudes up slightly                     + 1px translateY, §6.3)
 ↑ --text-secondary → --text-primary    ↑ 60ms haptic on mobile
   transition                            ↑ fires only while finger is down;
 ↑ cursor-pointer                          reverts on up if move > 8px
                                          (drag-cancel)

DISABLED (drawer open with unsaved form)
╭─ .neumo-inset well ──────────────╮
│ ( ░ All )( ░ Active )( ░ Inact ) │
│ ( ░ Grad )( ░ Archived )          │
╰──────────────────────────────────╯
 ↑ opacity-40
 ↑ cursor-not-allowed
 ↑ --text-muted
 ↑ disabled while the Add-Student or Edit-Profile sheet is open
   (prevents mid-mutation filter change, §8.1 settingsStore guard)
 ↑ aria-disabled="true" announced on each option
```

> **References:** Apple HIG — *Segmented Controls* (the canonical anatomy); Material Design 3 — *Segmented Buttons* (single-select variant); WCAG 2.1 AA §4.1.2 (Name, Role, Value — each segment needs `role="radio"` inside `role="radiogroup"`); WCAG 2.1 AA §1.4.11 (Non-text Contrast — neumorphic shadow must pair with cyan ring on focus and `▌` left-bar on active); Nielsen Norman Group — *Toggle, Switch, Checkbox, Radio: When to Use Which* (segmented control = single-select, mutually exclusive); CSS-Tricks — *Glassmorphism Done Right* (segmented well as the canonical neumo-inset surface).

---

This screen is the registry. Every other screen reads from it; every other engine writes back to it. Get the Students screen right, and the rest of Buddysaradhi has a spine to lean on.
