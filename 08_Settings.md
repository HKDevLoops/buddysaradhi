# 08 — Settings

> The configuration, protection, and lifecycle surface of Buddysaradhi. One screen, twelve sections, zero nesting. Everything the tutor needs to *tune* the operating system — never to *activate* it.

---

## 1. Purpose

The Settings screen is the single, sovereign drawer from which a tutor:

1. **Identifies themselves and their institute** — name, address, phone, email, currency, locale. This is the header block that prints on every receipt, statement, and export.
2. **Tunes the operating system** — theme, density, motion, attendance lock window, fee model defaults, invoice/receipt prefixes, notification categories.
3. **Protects their data** — PIN, biometric, session timeout, audit log, session revocation.
4. **Owns their data** — encrypted `.buddysaradhi` backups, full-data exports, bulk imports, delete-all with typed confirm.
5. **Trusts the system** — diagnostics, integrity verification, sync-outbox inspection, version + build info, help, FAQ.

Settings is **not** an activation surface. Per Principle 6 (*Defaults Are Sacred*), every value ships with the choice a competent tutor would make. A new user can run a clean business for a year without ever opening Settings. The screen exists for **refinement** and **protection**, not for permission.

The screen is also the **only** place where destructive or trust-boundary mutations originate: voiding receipt sequences, restoring a backup, deleting all data, changing the PIN. These flows are deliberately centralised here so the audit trail has a single, predictable entry point.

---

## 2. Business Objective

| Objective | Metric | Source Principle |
|-----------|--------|------------------|
| A tutor can configure their entire institute identity in < 90 seconds | Time-to-first-receipt | P6, P12 |
| A backup can be downloaded and restored on a fresh device in < 60 seconds | Backup round-trip latency | Vision §7, P10 |
| Sensitive mutations require tactile re-auth (PIN/biometric) and audit | 100% of sensitive actions audited | P11, BR-SEC-02/03 |
| Settings load from cache in < 100ms | P95 settings-open latency | §17 |
| Zero data leaves the device without explicit, typed confirmation | Audit-clean export count | P10, BR-SEC-04 |
| Tutors never need to email support to find version, db_url, or schema_version | Support-ticket deflection | P15 |

The Settings screen is the **trust artefact** of the product. A tutor who trusts Settings will trust the whole system; a tutor who loses faith here will stop recording payments.

---

## 3. Navigation Entry

| Entry Point | Mechanism |
|-------------|-----------|
| Sidebar | `◉ Sett` item, 5th in the persistent `GlassShell` sidebar (`02_Core_Logic.md` §1.1). Icon: `Settings` (lucide). |
| Keyboard | `G T` (Goto Settings), or `⌘K` → "Settings". |
| Topbar avatar | Tap → Settings → Profile (deep-link via `?s=settings&sec=profile`). |
| Empty-state CTAs | "Configure your institute" on Dashboard empty state, "Set up PIN" on Attendance first-lock prompt. |
| Toast CTAs | "View audit log" toast on sensitive mutation completes. |

Per the in-shell navigation rule (`02_Core_Logic.md` §5), Settings is rendered inside the content pane via Zustand state `activeScreen='settings'` — never a new URL route. The `/` route is preserved; section navigation uses query params (`?s=settings&sec=security`) parsed by the shell, so deep-links survive refresh.

---

## 4. User Story

> **As** Centre Priya (a 150-student coaching institute owner),
> **when** I open Settings,
> **I want** to see every knob that controls my tuition business in one drawer — my institute letterhead, my fee defaults, my attendance lock window, my backup file, my PIN —
> **so that** I never have to hunt across menus, never have to remember where a setting lives, and never doubt that my data is mine.
>
> **As** Solo Rohan (a 30-student solo tutor),
> **when** I tap "Create backup",
> **I want** a single `.buddysaradhi` file I can email to myself, drop on a pendrive, or hand to my accountant —
> **so that** even if I lose my phone tomorrow, my entire business is recoverable in 60 seconds on a fresh device.
>
> **As** either persona,
> **when** I attempt something destructive (restore over current data, delete all students, change my PIN),
> **I want** the app to require a fresh PIN entry and a typed confirm word —
> **so that** I cannot accidentally ruin my business with a stray tap.

---

## 5. UX Principles

Settings is governed by, in priority order:

1. **P6 — Defaults Are Sacred.** Every field has a sensible default. The Save button is a *refinement*, not an *activation*.
2. **P11 — Security Is Tactile, Not Theatrical.** Sensitive mutations require a physical PIN/biometric prompt, not a checkbox. No triple "Are you sure?" dialogs; one typed confirm word + one PIN entry is enough.
3. **P10 — Backups Are the User's Property.** No backend storage of `.buddysaradhi` files. No paywall on export. The file is the user's artefact.
4. **P15 — Honest Empty States.** Every section, including a freshly-provisioned tenant with no students, has a designed empty state with a CTA.
5. **P13 — Boring Technology, Radical Polish.** Zustand + react-hook-form + TanStack Query + Zod. No novel state library.
6. **P8 — Density Without Clutter.** The left nav lists 12 sections; only one renders at a time. Each section's fields earn their pixels.
7. **P12 — The Tutor's Time Is the Metric.** No setting requires more than 3 taps to reach from any other screen.

---

## 6. Screen Layout

The Settings screen uses a **sectioned master-detail** layout: a left navigation rail of twelve sections, and a right content pane rendering the active section. The rail is sticky; the content pane scrolls vertically. On `base`/`sm` breakpoints the rail collapses to a horizontal pill scroller above the content.

### 6.1 ASCII Layout (lg ≥ 1024px)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Topbar: Buddysaradhi · 🔍 Search · ⌘K · 🔔 · 👤 (avatar → Profile)            │
├──────────┬───────────────────────────────────────────────────────────────┤
│          │                                                               │
│ Sidebar  │   Content Pane  (Settings)                                    │
│          │                                                               │
│ ◉ Dash   │  ┌──────────────┬───────────────────────────────────────────┐ │
│ ◉ Stud   │  │ Settings Nav │  Settings Content                          │ │
│ ◉ Attd   │  │              │                                            │ │
│ ◉ Fees   │  │ ◉ Profile    │  ┌─ Profile ─────────────────────────────┐ │ │
│ ◉ Sett ◀ │  │ ○ Appearance │  │                                       │ │ │
│          │  │ ○ Attendance │  │  Institute Letterhead                 │ │ │
│ ───────  │  │   Rules      │  │  ┌─────────────────────────────────┐  │ │ │
│ ⚙ Sync   │  │ ○ Fee Rules  │  │  │ Institute Name  [My Tuition   ]│  │ │ │
│ ⚡ ⌘K    │  │ ○ Notificat. │  │  │ Address         [ …            ]│  │ │ │
│          │  │ ○ Security   │  │  │ Phone (+E.164)  [+91…          ]│  │ │ │
│          │  │ ○ Backup &   │  │  │ Email           [tutor@…       ]│  │ │ │
│          │  │   Restore    │  │  │ Currency        [INR ▾]  🔒     │  │ │ │
│          │  │ ○ Import &   │  │  │ Locale          [en-IN ▾]       │  │ │ │
│          │  │   Export     │  │  └─────────────────────────────────┘  │ │ │
│          │  │ ○ Data &     │  │                                       │ │ │
│          │  │   Privacy    │  │  [Discard]              [Save ✓]      │ │ │
│          │  │ ○ About      │  └───────────────────────────────────────┘ │ │
│          │  │ ○ Help       │                                            │ │
│          │  │ ○ Diagnostics│                                            │ │
│          │  └──────────────┴───────────────────────────────────────────┘ │
├──────────┴───────────────────────────────────────────────────────────────┤
│  Footer: Online · synced 2m ago · v1.4.2 (#a3f9c1) · © Buddysaradhi Omni-Core │
└──────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Section Inventory

Each of the twelve sections below has its own scrollable glass card. Section nav items show an icon, label, and (where relevant) a tiny status dot (e.g., amber dot if there are unsaved changes in Profile; emerald dot if backup is fresh; flare dot if PIN is unset).

#### 6.2.1 Profile
**Fields:** `institute_name`, `institute_address` (textarea, 3 lines), `institute_phone` (E.164), `institute_email`, `currency_code` (select, **immutable after first ledger entry** per BR-M-02 — show a 🔒 chip when locked), `locale` (select).
**Controls:** `Discard` (ghost) + `Save` (emerald) buttons; both disabled when form is clean. A live "Receipt preview" mini-card on the right shows the institute letterhead as it will print on receipts (BR-RC-02).
**Empty state:** Provisioned defaults are pre-filled; nothing is ever blank.
**Unsaved-changes guard:** navigating away with a dirty form triggers a glass-sheet confirm ("Discard changes?").

#### 6.2.2 Appearance
**Fields:** `theme` (segmented control: `Dark` / `Light` / `System`, default `system`), `density` (segmented: `Comfortable` / `Compact`, default `comfortable`), `reduced_motion` (neumorphic toggle, default off but auto-on if OS `prefers-reduced-motion`).
**Behaviour:** Theme applies instantly (no Save required — this is an *interaction* preference, not a *business* preference). Density + motion also apply instantly and persist on blur.
**Note:** Per `13_UI_Guidelines.md` §12 (Dark-Only Doctrine), dark is the only mode in v1; the previous light-variant spec has been removed. The print stylesheet (§12.2) is the only light-surface code path.

#### 6.2.3 Attendance Rules
**Fields:** `attendance_lock_hours` (range slider 1–168, default 48, with numeric readout), `default_attendance_status` (segmented: `present` / `absent`, default `present`), `holiday_list` (editor: a list of `{date, label}` pairs, with "Add holiday" button and per-row delete).
**Audit:** Changing `attendance_lock_hours` writes `audit_log` `settings_change` with `field=attendance_lock_hours, old, new`.
**Cross-ref:** BR-ATT-03 (Locking), `06_Attendance.md`.

#### 6.2.4 Fee Rules
**Fields:** `default_fee_model` (segmented: `postpaid` / `prepaid` / `mixed`, default `postpaid`), `invoice_prefix` (text, alphanumeric, default `INV-`), `receipt_prefix` (text, alphanumeric, default `RCP-`), `grace_days` (number, 0–30, default 0 — days after `due_date` before an invoice flips to `overdue`), `auto_invoice` (neumorphic toggle, default off).
**Read-only displays:** `next_invoice_seq` and `next_receipt_seq` (current counters; non-editable — sequences are monotonic per BR-FEE-04 / BR-RC-01).
**Audit:** Prefix changes write `audit_log` `settings_change` with old/new — these affect future receipt numbering.
**Cross-ref:** BR-FEE-02, BR-FEE-04, BR-RC-01.

#### 6.2.5 Notifications
**Fields:** Per-category toggles (neumorphic, default on for all):
- `due_fee` — fires when a `fee_schedule_item` flips to `overdue`.
- `upcoming_due` — fires 3 days before `due_date`.
- `missing_attendance` — fires at 9 PM local on a scheduled batch day with no session.
- `inactive_student` — fires weekly for students with zero attendance in 14 days.
**Note:** v1 is in-app only (Notification Engine, `02_Core_Logic.md` §3.5). No push/email/SMS toggles exist yet — they will appear here in v1.x.
**Cross-ref:** BR-RPT-01..R05.

#### 6.2.6 Security
**Fields:**
- `pin` — `Set PIN` (if unset) or `Change PIN` (if set). Triggers a 3-step sheet: (1) old PIN, (2) new PIN, (3) confirm new PIN. Writes `settings.pin_hash` (argon2id) + `audit_log` `pin_change`.
- `biometric_enabled` — neumorphic toggle. Enabling triggers a biometric prompt to confirm capability. Disabling requires PIN. Writes `settings.biometric_enabled` + `audit_log` `biometric_toggle`.
- `session_timeout_min` — range slider 1–60, default 5. Writes `audit_log` `settings_change`.
- `audit_log_viewer` — a paginated, filterable table (filters: `action`, `date_range`, `actor`). Read-only. Each row shows `created_at`, `actor`, `action`, `ref_type`, `ref_id`, `metadata` (collapsed JSON). 50 rows per page.
- `revoke_sessions` — destructive button (flare). Triggers Supabase session revoke + Turso token rotation + `audit_log` `token_rotated`.

#### 6.2.7 Backup & Restore
**Controls:**
- `Create backup` — primary emerald button. Opens a sheet: passphrase prompt (≥ 12 chars, show/hide toggle), "If you forget this, we cannot recover your data" warning, `Confirm` button. On confirm: requires fresh PIN (BR-SEC-02) → streams `.buddysaradhi` file to download with a progress bar. Filename: `Buddysaradhi_Backup_<YYYYMMDD-HHmm>.buddysaradhi`. Writes `audit_log` `backup_create` + `app_state.last_backup_at`.
- `Restore backup` — secondary cyan button. Opens file picker → on file selected, opens sheet: passphrase prompt + **typed confirm** field requiring exact word `RESTORE` (button disabled until match) + fresh PIN (BR-SEC-02). On confirm: stream-decrypts, verifies manifest sha256 (BR-BAT-02), aborts on mismatch. Writes `audit_log` `backup_restore`. The current DB is **overwritten** — tutors are warned "This replaces your current data" with the most recent local backup timestamp.
- `Last backup` — read-only timestamp + "Download again" link (if same session).
**Cross-ref:** §09_Backup_and_Import_Export.md for the `.buddysaradhi` file format, AES-256-GCM encryption, argon2id key derivation, manifest schema. This section only specifies the **UI surfaces**.

#### 6.2.8 Import & Export
**Controls (3 primary actions, stacked vertically):**
- `Download import template` — tertiary cyan button. Downloads `Buddysaradhi_Import_Template.xlsx` (a 4-sheet workbook: Students, Attendance, Payments, Read me — per BR-BAT-04). No PIN required (it's a template, no data leaves).
- `Import students from Excel` — primary emerald button. File picker → on file selected, parses + validates each row against the `StudentImportRowSchema` (Zod). Shows a **validation report** before any DB write: total rows, valid rows, invalid rows (with row number + error message per invalid row). Tutors choose `Import N valid rows` (emerald) or `Discard` (ghost). Invalid rows are skipped + reported (BR-BAT-04). Writes `audit_log` `student_bulk_import` with `{valid, invalid, total}`.
- `Export to Excel` — primary cyan button. Triggers the Report Engine to generate `Buddysaradhi_Export_<YYYYMMDD>.xlsx` with **three worksheets** (Students, Attendance, Payments) per BR-BAT-03. No PIN required (this is a derived monthly export, not a full backup). Writes `audit_log` `export_excel`. Progress bar shown for >50 students.
**Cross-ref:** §09 for the import-row Zod schema, template column order, export column mappings.

#### 6.2.9 Data & Privacy
**Controls:**
- `auto_archive_inactive_days` — range slider 30–365, default 90. After N days of `inactive` status, a student is auto-archived (BR-STU-01). Writes `audit_log` `settings_change`.
- `export_full_data` — primary cyan button. Generates a `.buddysaradhi` backup **plus** a JSON dump of `audit_log` and `app_state` (GDPR-style full export). Requires typed `EXPORT` confirm + fresh PIN (BR-SEC-04). Writes `audit_log` `export_full`.
- `delete_all_data` — destructive flare button. Triggers a 3-step sheet: (1) typed `DELETE` confirm, (2) fresh PIN (BR-SEC-02), (3) second typed `DELETE` confirm. On confirm: soft-deletes all students, batches, attendance, ledger entries (preserves audit_log + a tombstone `app_state.deleted_at` for sync conflict resolution). Writes `audit_log` `bulk_delete` with counts. The Turso cloud DB is **not** dropped (the user can re-provision by logging in elsewhere); the local cache is wiped.

#### 6.2.10 About
**Fields (read-only):**
- App version + build hash (e.g., `v1.4.2 (#a3f9c1)`).
- Turso `db_url` — masked: `libsql://buddysaradhi-••••••••-••••.turso.io`. Tap to reveal (requires fresh PIN — defensive, even though the URL is in the JWT).
- `schema_version` (e.g., `7`).
- `tenant_id` (UUID v7, full).
- Links: Privacy Policy, Terms, GitHub (issues), Changelog, `mailto:support@buddysaradhi.dev`.
- "Check for updates" button (desktop/Tauri updater).

#### 6.2.11 Help
**Controls:**
- **Shortcut cheatsheet** — collapsible `<kbd>` grid: `⌘K` palette, `G D/S/A/F/T` screen jumps, `?` cheatsheet, `Esc` close, `/` focus search, `N` new student (in Students), `L` lock attendance (in Attendance).
- **FAQ links** — 6–10 anchored links to `/help#faq-*` (rendered in a glass sheet, not a new route).
- **Contact** — `mailto:support@buddysaradhi.dev` + a "Send diagnostics" button that bundles `app_state`, last 50 `audit_log` rows, and `sync_outbox` summary into an encrypted `.buddysaradhi-diag` file (PIN-gated).

#### 6.2.12 Diagnostics
**Controls:**
- `Run integrity check` — primary cyan button. Recomputes every `invoices.tamper_hash` and `receipts.tamper_hash` (BR-FEE-05), reports mismatches in a table. Writes `audit_log` `integrity_check` with pass/fail counts. On mismatch: offers "Restore from last backup" CTA.
- `Clear local cache` — secondary button. Wipes the IndexedDB / `expo-sqlite` cache layer (not the cloud DB; not the local SQLCipher DB on desktop). Re-syncs on next foreground.
- `Force sync` — secondary button. Triggers an immediate `sync_outbox` flush + Turso pull.
- `View sync_outbox` — opens a sheet listing pending/conflict rows from `sync_outbox` (BR-SYN-03). Conflict rows show retry count + last error; "Retry" or "Drop" actions per row.
- `Rebuild search index` — secondary button. Rebuilds the FTS5 index (`11_Data_Model.md` §6).

---

## 7. Component Tree

```
SettingsPage
├── SettingsNav                          // left rail of 12 sections
│   ├── SettingsNavItem × 12            // icon + label + status dot
│   └── SettingsNavFooter               // version chip, "Send feedback" link
└── SettingsContent                      // renders the active section
    └── <ActiveSection />                // one of:
        ├── ProfileSection
        ├── AppearanceSection
        ├── AttendanceRulesSection
        ├── FeeRulesSection
        ├── NotificationsSection
        ├── SecuritySection
        ├── BackupRestoreSection
        ├── ImportExportSection
        ├── DataPrivacySection
        ├── AboutSection
        ├── HelpSection
        └── DiagnosticsSection
```

### 7.1 Key Component Prop Types

```ts
// SettingsPage — top-level client component
type SettingsPageProps = {
  initialSection?: SettingsSectionId;
};

type SettingsSectionId =
  | 'profile' | 'appearance' | 'attendance-rules' | 'fee-rules'
  | 'notifications' | 'security' | 'backup-restore' | 'import-export'
  | 'data-privacy' | 'about' | 'help' | 'diagnostics';

// SettingsNav
type SettingsNavProps = {
  active: SettingsSectionId;
  onChange: (id: SettingsSectionId) => void;
  statusDots: Partial<Record<SettingsSectionId, 'clean' | 'dirty' | 'warn' | 'danger'>>;
};

// SettingsContent — switch on active section
type SettingsContentProps = {
  active: SettingsSectionId;
  settings: Settings;           // from TanStack Query ['settings']
};

// ProfileSection — react-hook-form-managed
type ProfileSectionProps = {
  settings: Settings;
  onSaved: () => void;          // triggers query invalidation
};
type ProfileFormValues = {
  institute_name: string;
  institute_address: string | null;
  institute_phone: string | null;
  institute_email: string | null;
  currency_code: 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED';
  locale: string;
};

// AppearanceSection — instant-apply, no Save button
type AppearanceSectionProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;   // debounced 200ms
};

// SecuritySection
type SecuritySectionProps = {
  settings: Settings;
  auditLog: AuditLogEntry[];      // paginated, filterable
  onPinChange: (oldPin: string, newPin: string) => Promise<void>;
  onBiometricToggle: (enabled: boolean) => Promise<void>;
  onRevokeSessions: () => Promise<void>;
};

// BackupRestoreSection
type BackupRestoreSectionProps = {
  lastBackupAt: string | null;
  onCreateBackup: (passphrase: string) => Promise<{ filename: string; bytes: number }>;
  onRestoreBackup: (file: File, passphrase: string) => Promise<void>;
};

// ImportExportSection
type ImportExportSectionProps = {
  onDownloadTemplate: () => void;
  onImportStudents: (file: File) => Promise<ImportValidationReport>;
  onExportExcel: () => Promise<{ filename: string; bytes: number }>;
};
type ImportValidationReport = {
  total: number; valid: number; invalid: number;
  errors: { row: number; field: string; message: string }[];
  preview: StudentImportRow[];     // first 10 valid rows
};

// DataPrivacySection
type DataPrivacySectionProps = {
  settings: Settings;
  onExportFull: () => Promise<void>;
  onDeleteAll: (typedConfirm: string, pin: string) => Promise<void>;
};

// DiagnosticsSection
type DiagnosticsSectionProps = {
  onIntegrityCheck: () => Promise<{ passed: number; failed: number; mismatches: TamperMismatch[] }>;
  onClearCache: () => Promise<void>;
  onForceSync: () => Promise<void>;
  syncOutbox: SyncOutboxRow[];
};
```

### 7.2 Shared Sub-Components
- `GlassSheet` — modal sheet for confirm flows (PIN entry, passphrase, typed confirm).
- `PinPad` — 6-digit neumorphic PIN entry pad (Apple-style), used by Security, Backup, Restore, Delete.
- `TypedConfirmInput` — text input that disables the confirm button until the value matches an exact word (`RESTORE`, `DELETE`, `EXPORT`).
- `RangeSlider` — neumorphic range slider with cyan fill and tabular-numeric readout.
- `SegmentedControl` — glass segmented control (used for theme, density, fee model, default status).
- `NeumorphicToggle` — see `13_UI_Guidelines.md` §6.4 (Toggle Anatomy) + §8.16 (Toggle component).
- `AuditLogTable` — Kite-density table, sticky header, paginated, filterable.

---

## 8. State Management

### 8.1 Zustand Slice (`settings-store.ts`)

```ts
interface SettingsStore {
  activeSection: SettingsSectionId;
  setActiveSection: (id: SettingsSectionId) => void;

  // dirty-form tracking — keyed by section ID
  dirtySections: Set<SettingsSectionId>;
  markDirty: (id: SettingsSectionId) => void;
  markClean: (id: SettingsSectionId) => void;
  hasUnsavedChanges: () => boolean;

  // unsaved-changes navigation guard
  pendingNav: SettingsSectionId | null;
  setPendingNav: (id: SettingsSectionId | null) => void;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
}
```

The shell reads `hasUnsavedChanges()` on every sidebar/nav interaction and intercepts with a `GlassSheet` confirm. This is the *only* place in Buddysaradhi that intercepts navigation — Settings is the one screen where a stray tap could lose a half-typed institute address.

### 8.2 TanStack Query

- **Read:** `useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get() })`. Single-row singleton. `staleTime: Infinity` (settings rarely change; we invalidate explicitly). Initial data is seeded from the local cache so the screen paints in < 100ms.
- **Mutate (general):** `useMutation({ mutationFn: settingsApi.update, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }) })`. Optimistic update with rollback on error.
- **Mutate (sensitive):** each sensitive flow (PIN change, biometric toggle, backup, restore, delete-all, export-full) has its own mutation that:
  1. Requires a fresh PIN (≤ 30s old) — enforced by the Security Engine before the mutation fires.
  2. Writes `audit_log` *before* the mutation (fail-closed).
  3. Invalidates `['settings']` and (where relevant) `['students']`, `['audit-log']`, `['sync-outbox']`.

### 8.3 react-hook-form (Profile Section Only)

Profile is the only section with a multi-field form requiring batched validation. We use `react-hook-form` with a `zodResolver(profileSchema)` (see §14). `formState.isDirty` drives the Save button enablement and the `dirtySections` set in the Zustand store.

Other sections use **instant-apply** (Appearance, Notifications, Attendance Rules, Fee Rules) — each field change is a debounced (200ms) `useMutation` patch. No Save button; the change persists on blur. This matches P6 (defaults are sacred, refinement is frictionless) and avoids stale-form bugs.

### 8.4 Event Bus Subscriptions
- `BACKUP_CREATED` → toast "Backup downloaded" + update `app_state.last_backup_at` + invalidate `['settings']`.
- `EXPORT_REQUESTED` → toast "Export ready" + invalidate `['audit-log']`.
- `SYNC_COMPLETED` → if `schema_version` changed, force a settings reload + show "App update available" banner.

---

## 9. Database Operations

### 9.1 Read Settings (singleton)
```ts
const settings = await db.settings.findUniqueOrThrow({ where: { tenantId } });
```
Returned as a single row; parsed by Zod (`settingsSchema`) before reaching the UI.

### 9.2 Update Settings (general, transactional)
```ts
await db.$transaction(async (tx) => {
  await tx.settings.update({
    where: { tenantId },
    data: { instituteName, instituteAddress, institutePhone, instituteEmail, locale, updatedAt: nowIso },
  });
  await tx.auditLog.create({ data: {
    id: uuidv7(), tenantId, actor: 'tutor', action: 'settings_change',
    refType: 'settings', refId: tenantId, metadata: { changes }, createdAt: nowIso,
  } });
});
```
The audit `metadata` JSON contains `{ field, old, new }` for every changed field. The transaction guarantees the audit row lands iff the update lands (BR-SEC-03).

### 9.3 Currency Immutability (BR-M-02)
Before any update that touches `currency_code`, the engine checks:
```ts
const feeChargeCount = await db.ledgerEntry.count({
  where: { tenantId, type: 'FEE_CHARGED' },
});
```
If `> 0`, the UI rejects the change with toast "Currency cannot be changed after the first fee charge (BR-M-02)." The currency `<select>` is rendered disabled with a 🔒 chip in this state.

### 9.4 PIN Change
```ts
await db.$transaction(async (tx) => {
  await tx.settings.update({
    where: { tenantId },
    data: { pinHash: newPinHash, updatedAt: nowIso },
  });
  await tx.auditLog.create({ data: {
    id: uuidv7(), tenantId, actor: 'tutor', action: 'pin_change',
    refType: 'settings', refId: tenantId, metadata: { method: 'argon2id' }, createdAt: nowIso,
  } });
});
```
`pinHash` is the argon2id hash of the new 6-digit PIN (m=65536 KiB, t=3, p=2 — same params as the backup KDF for consistency). The old PIN is verified **before** the transaction begins (in the Security Engine). The new PIN never touches the audit log.

### 9.5 Biometric Toggle
```ts
await db.$transaction(async (tx) => {
  await tx.settings.update({
    where: { tenantId },
    data: { biometricEnabled, updatedAt: nowIso },
  });
  await tx.auditLog.create({ data: {
    id: uuidv7(), tenantId, actor: 'tutor', action: 'biometric_toggle',
    refType: 'settings', refId: tenantId, metadata: { enabled: biometricEnabled }, createdAt: nowIso,
  } });
});
```
Enabling biometric requires a successful `expo-local-authentication` (or WebAuthn) challenge. Disabling requires PIN (BR-SEC-02).

### 9.6 Backup Create
Calls the **Backup Engine** (cross-ref `09_Backup_and_Import_Export.md` §3):
1. Engine streams all table rows to `data.jsonl`.
2. Computes sha256 → writes `manifest.json` (BR-BAT-02).
3. Derives AES-256-GCM key from passphrase via argon2id.
4. Encrypts tarball → `.buddysaradhi` blob.
5. Returns blob to UI; UI triggers a browser download (`<a download>`) or `Share.sheet` (mobile).
6. Writes `audit_log` `backup_create` with `{ bytes, filename, manifest_sha }` + updates `app_state.last_backup_at`.

### 9.7 Backup Restore
Calls the Backup Engine (cross-ref §09 §4):
1. Read file → derive key from passphrase → decrypt.
2. Verify `manifest.json` sha256 against decrypted `data.jsonl` (BR-BAT-02). Mismatch → abort + toast "Backup file is corrupted or passphrase is wrong."
3. Verify `schema_version` ≤ `MAX_SUPPORTED_SCHEMA` (BR-SYN-04). Mismatch → abort + toast "This backup is from a newer Buddysaradhi. Update the app first."
4. Within a single `db.$transaction`: `db.<model>.deleteMany()` on every table (except `audit_log` — restored backup includes its own audit), then `db.<model>.createMany({ data: rows, skipDuplicates: true })` for each table from `data.jsonl`.
5. Write `audit_log` `backup_restore` with `{ filename, manifest_sha, rows_restored }`.

### 9.8 Excel Export (3 worksheets)
Calls the **Report Engine** (cross-ref `09_Backup_and_Import_Export.md` §5):
1. Three Prisma `findMany` calls (one per sheet):
   - Students: `db.student.findMany({ where: { deletedAt: null }, include: { ledgerEntries: { where: { type: { not: 'VOID' } }, select: { amount: true, direction: true } } } })` — balance_due computed in TS.
   - Attendance: `db.attendanceRecord.findMany({ include: { student: true, session: { include: { batch: true } } } })`.
   - Payments: `db.receipt.findMany({ include: { student: true, invoice: true } })`.
2. Generates `.xlsx` with `exceljs` (web/mobile) or Rust `rust_xlsxwriter` (desktop).
3. Returns blob → UI triggers download.
4. Writes `audit_log` `export_excel` with `{ rows_students, rows_attendance, rows_payments, filename }`.

### 9.9 Bulk Student Import
1. Parse `.xlsx` → array of row objects.
2. Validate each row against `StudentImportRowSchema` (Zod). Collect errors with row numbers.
3. UI shows validation report. On "Import N valid rows":
4. Transactionally `db.student.createMany({ data: validRows })` inside a `db.$transaction`, generating UUID v7 IDs, `STU-<seq>` codes (BR-STU-04), and `db.auditLog.create({ data: { action: 'student_bulk_import', metadata: { count } } })` with counts.

### 9.10 Audit Log Query (paginated, filterable)
```ts
const logs = await db.auditLog.findMany({
  where: {
    tenantId,
    ...(actionFilter ? { action: actionFilter } : {}),
    createdAt: { gte: startIso, lte: endIso },
  },
  orderBy: { createdAt: 'desc' },
  take: 50,
  skip: 50 * page,
});
```
Indexed by `idx_audit_created` (`11_Data_Model.md` §3.14).

### 9.11 Revoke Sessions
1. Calls Supabase Auth `signOut({ scope: 'global' })` — invalidates all refresh tokens.
2. Triggers `provision-db` Edge Function with `action=rotate_token` to mint a new Turso JWT.
3. Writes `audit_log` `token_rotated`.
4. Forces app re-login on next interaction.

---

## 10. Business Rules

The Settings screen is the surface where the following business rules are configured, enforced, or surfaced. Each rule is cited from `12_Business_Rules.md` or `10_Security.md`.

| Rule ID | Description | Settings Surface |
|---------|-------------|------------------|
| **BR-SEC-01** | App locks after `session_timeout_min` idle or on cold start; unlock via biometric (preferred) or PIN. | Security section: `session_timeout_min` slider; `biometric_enabled` toggle; PIN setup. |
| **BR-SEC-02** | Sensitive mutations (void, unlock attendance, backdated ledger, bulk delete, export full backup, restore backup, change PIN, disable biometric) require a **fresh** PIN/biometric entry ≤ 30s old. | All destructive flows in Settings (backup export, restore, delete-all, PIN change, biometric disable, export-full) enforce this. |
| **BR-SEC-03** | Every sensitive action writes `audit_log` *before* the mutation. Fail-closed. | Every transactional write in §9. |
| **BR-SEC-04** | Full backup export shows a typed `EXPORT` confirm. Monthly Excel export does not. | Data & Privacy → `export_full_data`; Import & Export → `Export to Excel`. |
| **BR-M-02** | Currency is immutable after the first `FEE_CHARGED` ledger entry. | Profile → `currency_code` select locks with 🔒 chip. |
| **BR-ATT-03** | Attendance session auto-locks after `attendance_lock_hours` (default 48h). Unlock requires PIN + audit. | Attendance Rules → `attendance_lock_hours` slider (1–168). |
| **BR-FEE-02** | New students inherit `settings.default_fee_model`. | Fee Rules → `default_fee_model` segmented control. |
| **BR-FEE-04** | Invoice `number = invoice_prefix + zero-pad(next_invoice_seq, 6)`. Sequence increments atomically. | Fee Rules → `invoice_prefix` input + read-only `next_invoice_seq`. |
| **BR-RC-01** | Receipt `number = receipt_prefix + zero-pad(next_receipt_seq, 6)`. Monotonic, gap-tolerant. | Fee Rules → `receipt_prefix` input + read-only `next_receipt_seq`. |
| **BR-FEE-05** | Invoice + receipt tamper hashes use sha256 over `number || student_id || total || issue_date || tenant_secret`. | Diagnostics → integrity check recomputes these. |
| **BR-RPT-01..R05** | Reminder categories: `due_fee`, `upcoming_due`, `missing_attendance`, `inactive_student`. | Notifications section — toggles per category. |
| **BR-STU-01** | Student status transitions; `inactive → archived` after `auto_archive_inactive_days`. | Data & Privacy → `auto_archive_inactive_days` slider. |
| **BR-SYN-03** | `sync_outbox` rows that fail 5 times are marked `conflict`; surfaced in Sync drawer. | Diagnostics → "View sync_outbox" sheet. |
| **BR-SYN-04** | Schema drift: device refuses to sync if local `schema_version` < server. | About → `schema_version` display; Diagnostics surfaces mismatches. |
| **BR-BAT-01..B05** | Backup format, integrity, Excel export (3 sheets), import template, no backend storage. | Backup & Restore + Import & Export sections — **UI surfaces only**; file-format internals in `09_Backup_and_Import_Export.md`. |

### 10.1 Rule Precedence in Settings
Per `12_Business_Rules.md` §12: Immutability (BR-LED-01/L02) > Audit (BR-SEC-03) > Offline-first (BR-SYN-01..SY04) > Tutor intent. In Settings, this means: a tutor's intent to change currency is *rejected* if immutability says no; a tutor's intent to skip audit on a PIN change is *rejected* by the transactional guard.

---

## 11. Edge Cases

| # | Scenario | Behaviour |
|---|----------|-----------|
| EC-01 | Tutor attempts to change currency after first fee charge. | UI blocks + toast "Currency cannot be changed after the first fee charge (BR-M-02)." Select disabled with 🔒. |
| EC-02 | Tutor enters PIN 123456 / 000000 / 111111. | Rejected: "PIN is too obvious. Choose a less sequential pattern." |
| EC-03 | Tutor fails PIN entry 5/10/15 times. | 5 → 30s lockout; 10 → 5min; 15 → wipe local cache (cloud intact) + force re-login (per `10_Security.md` §3.4). |
| EC-04 | Backup passphrase < 12 chars. | "Passphrase must be at least 12 characters." Confirm disabled. |
| EC-05 | Restore: passphrase wrong / file corrupted. | Decryption fails or sha256 mismatches → toast "Backup file is corrupted or passphrase is wrong." No DB write. |
| EC-06 | Restore: backup `schema_version` > app's `MAX_SUPPORTED_SCHEMA`. | Abort + toast "This backup is from a newer Buddysaradhi (v1.5). Update the app before restoring." |
| EC-07 | Import: Excel file has 0 valid rows. | Validation report shows "0 valid, N invalid." `Import 0 valid rows` button disabled. |
| EC-08 | Import: duplicate students (same `dup_key` per BR-STU-02). | Each duplicate row flagged in the validation report; tutor can "proceed" or "skip" per row. |
| EC-09 | Restore overwrites during a sync in flight. | Sync engine pauses; restore transaction takes precedence; sync resumes after commit. `sync_outbox` rows are preserved (they reference row IDs that may now be gone — marked `dropped` with audit). |
| EC-10 | Diagnostics integrity check finds a tampered receipt. | Red "TAMPERED" badge on the receipt row in the report; `audit_log` `receipt_tamper_detected` written; CTA "Restore from last backup" offered. |
| EC-11 | Tutor navigates away from Profile with unsaved changes. | Glass-sheet confirm: "Discard changes?" with `Discard` (flare) / `Cancel` (ghost). |
| EC-12 | Biometric enrolment changes between app sessions. | OS notifies us; we log `audit_log` `biometric_reenrol` (informational, not blocking — per `10_Security.md` §11.2). |
| EC-13 | `revoke_sessions` called while offline. | Supabase call queued in `sync_outbox`; UI shows "Will revoke on next sync." Local lock applies immediately. |
| EC-14 | Holiday list editor: tutor enters a date in the past. | Allowed (holidays can be backfilled), but warned: "This date is in the past." |
| EC-15 | Tutor deletes all data while `sync_outbox` has pending rows. | Pending rows are dropped (tombstoned). `audit_log` survives. Cloud DB rows are soft-deleted on next sync. |
| EC-16 | Settings load when `settings` row is missing (provisioning race). | Engine calls `ensureSettingsSingleton()` — INSERTs default row. UI shows a 200ms skeleton then content. |
| EC-17 | `invoice_prefix` changed to a non-alphanumeric value. | Zod rejects: "Prefix must be alphanumeric (letters, digits, hyphen)." |
| EC-18 | Tutor exports Excel with 0 students. | File still generates with empty worksheets (headers only) + a "Read me" note. No error. |
| EC-19 | PIN unset + biometric unavailable + tutor attempts a sensitive action. | Forced PIN setup sheet before the action proceeds. |
| EC-20 | Restore mid-backup (race). | Backup write holds a read lock on the DB; restore waits. Backup completes first; restore then proceeds. |

---

## 12. Offline Behaviour

Settings is **fully offline-capable** (Principle 5). Every read, write, backup, restore, import, and export operates against the local SQLite/libSQL replica. The only operations that *require* connectivity are:

| Operation | Network Required? | Offline Behaviour |
|-----------|:-----------------:|-------------------|
| Read settings | ❌ | Local cache; `staleTime: Infinity`. |
| Update settings | ❌ | Local write → `sync_outbox` row → flush on reconnect. |
| PIN change | ❌ | PIN hash is local-only. |
| Biometric toggle | ❌ | Local-only. |
| Create backup | ❌ | Pure local compute + file download. |
| Restore backup | ❌ | Local file → local DB. |
| Import students | ❌ | Local file → local DB. |
| Export Excel | ❌ | Local query → local file generation. |
| Export full data | ❌ | Local backup + local JSON dump. |
| Delete all data | ❌ | Local soft-delete → `sync_outbox`. |
| Integrity check | ❌ | Local hash recompute. |
| Revoke sessions | ✅ | Supabase call queued; local lock applies immediately. |
| Force sync | ⚠️ | If offline, shows toast "No connection. Will sync on reconnect." |
| Send diagnostics | ✅ | Queued as `.buddysaradhi-diag` file for manual email. |

The footer status chip reflects offline state: "Offline · 14 pending" (per `02_Core_GitLogic.md` §1.3).

---

## 13. Sync Behaviour

### 13.1 Settings Row
The `settings` singleton syncs via Last-Write-Wins (BR-SYN-01) on `updated_at` vector clock. If two devices edit settings concurrently, the loser's version is preserved in `audit_log` `sync_conflict_lost` and the winner's takes effect. The user is **not** prompted — settings changes are rarely conflicting, and a stale loser is acceptable (the tutor can re-apply).

### 13.2 Audit Log
Append-only; sync merges by `id` (UUID v7). No conflicts possible — two devices writing different audit rows both land.

### 13.3 sync_outbox
Settings writes (PIN change, biometric toggle, prefix change, etc.) enqueue a `sync_outbox` row with `op='update'`, `table_name='settings'`, `payload=<full row JSON>`. Flush is FIFO. A row that fails 5 times is marked `conflict` and surfaced in Diagnostics → "View sync_outbox."

### 13.4 Backup/Restore Interactions
- **Backup create** does **not** enqueue sync rows — it's a read-only snapshot.
- **Restore** is a **local-only** operation that overwrites the local DB; the cloud DB is updated via the normal sync flow (the restored rows become `sync_outbox` entries that overwrite cloud rows by ID). This is the one place where LWW is bypassed — restore is an explicit "make my data look like this" intent.
- **Conflict on a restored row**: if another device edited the same row while restore was in flight, the restored version wins (restore intent overrides LWW). The loser's version is logged in `audit_log` `sync_conflict_lost` with `metadata.reason='restore_overwrite'`.

### 13.5 Schema Version Sync
On every `SYNC_COMPLETED` event, Settings checks `app_state.schema_version` against `MAX_SUPPORTED_SCHEMA`. If drift is detected (server ahead), Settings shows a banner: "App update required. Your cloud data is on a newer schema." All mutations are disabled until the app is updated.

---

## 14. Validation Rules

All validation uses Zod schemas in `packages/shared`. Settings-relevant schemas:

```ts
// profileSchema (react-hook-form resolver)
const profileSchema = z.object({
  institute_name: z.string().min(1, 'Institute name is required').max(80),
  institute_address: z.string().max(200).nullable(),
  institute_phone: z.string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 (e.g., +919876543210)')
    .nullable(),
  institute_email: z.string().email('Invalid email').nullable(),
  currency_code: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']),
  locale: z.string().min(2).max(10),
});

// feeRulesSchema
const feeRulesSchema = z.object({
  default_fee_model: z.enum(['postpaid', 'prepaid', 'mixed']),
  invoice_prefix: z.string().regex(/^[A-Za-z0-9-]+$/, 'Alphanumeric only').min(1).max(10),
  receipt_prefix: z.string().regex(/^[A-Za-z0-9-]+$/, 'Alphanumeric only').min(1).max(10),
  grace_days: z.number().int().min(0).max(30),
  auto_invoice: z.boolean(),
});

// attendanceRulesSchema
const attendanceRulesSchema = z.object({
  attendance_lock_hours: z.number().int().min(1).max(168),
  default_attendance_status: z.enum(['present', 'absent']),
  holiday_list: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().max(40),
  })),
});

// securitySchema
const securitySchema = z.object({
  session_timeout_min: z.number().int().min(1).max(60),
  biometric_enabled: z.boolean(),
});

// pinSchema (used by PinPad)
const pinSchema = z.string()
  .length(6, 'PIN must be 6 digits')
  .regex(/^\d{6}$/, 'PIN must be digits only')
  .refine(p => !/^(.)\1{5}$/.test(p), 'PIN cannot be all same digits')
  .refine(p => !['123456','654321','0123456','111111','000000'].includes(p), 'PIN is too obvious');

// passphraseSchema (backup)
const passphraseSchema = z.string()
  .min(12, 'Passphrase must be at least 12 characters')
  .max(256);

// dataPrivacySchema
const dataPrivacySchema = z.object({
  auto_archive_inactive_days: z.number().int().min(30).max(365),
});

// importRowSchema (cross-ref 09 for full version)
const studentImportRowSchema = z.object({
  first_name: z.string().min(1).max(60),
  last_name: z.string().max(60).nullable(),
  phone: z.string().regex(/^\+?[1-9]\d{6,14}$/).nullable(),
  email: z.string().email().nullable(),
  grade: z.string().max(40).nullable(),
  // ... full schema in 09
});
```

### 14.1 Validation UX
- **Inline errors** appear below each field on blur (red flare text, 12px).
- **Submit-blocked** — Save / Confirm buttons disabled while a form has validation errors.
- **Cross-field validation** — e.g., if `auto_invoice` is on but `default_fee_model='mixed'`, show warning "Auto-invoice works best with a single fee model."

---

## 15. Security Rules

Settings is the most security-sensitive screen in Buddysaradhi. Every rule below is enforced in code; violations are P0 bugs.

| # | Rule | Enforcement |
|---|------|-------------|
| SR-01 | **Backup export requires fresh PIN (BR-SEC-02).** Even if app is unlocked, the Backup Engine refuses to fire until the PinPad produces a verified PIN ≤ 30s old. | `PinPad` → Security Engine `requireFreshPin()` → Backup Engine. |
| SR-02 | **Restore requires typed `RESTORE` confirm + fresh PIN.** Two independent gates — typed confirm prevents accidental tap; PIN prevents malicious scripted restore. | `TypedConfirmInput` (word=`RESTORE`) + `PinPad`. |
| SR-03 | **Delete-all-data requires typed `DELETE` + fresh PIN + second typed `DELETE`.** Triple gate for the most destructive action in the system. | Two `TypedConfirmInput` steps + `PinPad`. |
| SR-04 | **PIN change requires old PIN.** Verifies against `settings.pin_hash` (argon2id). 5/10/15 failed attempts trigger lockouts per EC-03. | `PinPad` (old) → `PinPad` (new) → `PinPad` (confirm). |
| SR-05 | **Biometric disable requires PIN.** A tutor who loses a finger or sells a device must be able to disable biometric with their PIN. | `PinPad` before the toggle commit. |
| SR-06 | **Export-full requires typed `EXPORT` + fresh PIN (BR-SEC-04).** Full export contains audit log + app_state — more sensitive than a monthly Excel. | `TypedConfirmInput` (word=`EXPORT`) + `PinPad`. |
| SR-07 | **Audit log is append-only.** Settings writes audit *before* the mutation; if audit write fails, mutation is blocked (fail-closed, BR-SEC-03). | Transactional guard in §9.2. |
| SR-08 | **`db_url` reveal requires fresh PIN.** Even though it's in the JWT, masking + PIN-gated reveal is defensive. | `PinPad` → unmask. |
| SR-09 | **Revoke sessions rotates the Turso token.** Old device's local cache becomes inert without the (now-rotated) token. | Supabase `signOut({scope:'global'})` + `provision-db` `action=rotate_token`. |
| SR-10 | **Diagnostics bundle is PIN-gated.** The `.buddysaradhi-diag` file contains audit + sync data; treated as a sensitive export. | `PinPad` before bundle generation. |
| SR-11 | **Passphrase never leaves the device.** The AES-256-GCM key is derived locally (argon2id); the passphrase is never logged, never synced, never sent to any API. | Backup Engine runs entirely client-side. |
| SR-12 | **PIN hash uses argon2id (m=64MB, t=3, p=2).** Same KDF as backup passphrase for consistency. Hash never synced (settings row is, but `pin_hash` column is excluded from sync payload by the Sync Engine). | `packages/shared/crypto.ts`. |
| SR-13 | **Sensitive mutations disable optimistic UI.** No optimistic update on PIN change, backup, restore, delete — the user sees the result only after the transaction commits. | Mutation `mutationFn` is awaited; spinner shown. |

---

## 16. Error Handling

| Error Class | Trigger | UI Response | Audit |
|-------------|---------|-------------|-------|
| `SettingsNotFound` | `settings` row missing despite provisioning. | Auto-INSERT default row; show 200ms skeleton. | `audit_log` `settings_auto_provisioned`. |
| `CurrencyImmutableError` | BR-M-02 violation. | Toast "Currency cannot be changed after the first fee charge." Select disabled. | None (no mutation attempted). |
| `PinValidationError` | Obvious/sequential PIN. | Inline red flare error on PinPad. | `audit_log` `pin_change_rejected` with `metadata.reason`. |
| `PinLockoutError` | 5/10/15 failed attempts. | 30s / 5min / wipe+relogin. | `audit_log` `pin_lockout`. |
| `BackupEncryptionError` | argon2id or AES-GCM failure. | Toast "Backup failed: encryption error." No file written. | `audit_log` `backup_create_failed`. |
| `BackupIntegrityError` | Restore sha256 mismatch. | Toast "Backup file is corrupted or passphrase is wrong." No DB write. | `audit_log` `backup_restore_failed`. |
| `SchemaDriftError` | Backup `schema_version` > app max. | Toast "This backup is from a newer Buddysaradhi. Update the app first." | `audit_log` `backup_restore_rejected`. |
| `ImportValidationError` | 0 valid rows / file unreadable. | Validation report with errors per row. | None until "Import" confirmed. |
| `ExportGenerationError` | `exceljs` failure / disk full. | Toast "Export failed: try again." Cleanup partial file. | `audit_log` `export_excel_failed`. |
| `AuditWriteError` | Audit insert failed (transaction abort). | Toast "Action blocked: audit unavailable." Mutation **not** applied (fail-closed). | (paradoxical — surfaced to Sync drawer) |
| `BiometricUnavailableError` | Device has no biometric or user declined. | Toast "Biometric unavailable. Set a PIN instead." Toggle remains off. | None. |
| `RevokeSessionsNetworkError` | Supabase call failed (offline). | Toast "Will revoke on next sync." Local lock applies. | `audit_log` `token_rotate_queued`. |
| `IntegrityMismatchError` | Tamper hash recompute mismatch. | Red "TAMPERED" badge on receipt row; CTA "Restore from last backup." | `audit_log` `receipt_tamper_detected`. |
| `RestoreConflictError` | Restore would overwrite un-synced local rows. | Confirm sheet: "You have 14 unsynced changes that will be lost. Continue?" | `audit_log` `backup_restore_overwrote_unsynced`. |

### 16.1 Error Toast Pattern
- **Success:** emerald left bar, 4s auto-dismiss.
- **Info:** cyan left bar, 4s.
- **Warning:** amber left bar, 6s.
- **Error:** flare left bar, persistent until dismissed (per `13_UI_Guidelines.md` §15.3 Toasts & Confirmations + §8.8 Toast component).

---

## 17. Performance Targets

| Metric | Target | Mechanism |
|--------|--------|-----------|
| Settings screen first paint (cache hit) | < 100ms P95 | TanStack Query initial data from local cache; `staleTime: Infinity`. |
| Settings screen first paint (cold) | < 300ms P95 | Local SQLite read; no network. |
| Section switch (no data fetch) | < 16ms (1 frame) | Sections are pre-loaded; switching is a Zustand state change. |
| Profile save | < 200ms | Single-row UPDATE + audit INSERT in one transaction. |
| Backup creation (1,000 students) | < 8s | Streamed JSONL + AES-GCM; progress bar every 10%. |
| Restore (1,000 students) | < 12s | Transactional bulk INSERT. |
| Excel export (1,000 students, 3 sheets) | < 5s | Streaming `exceljs` writer. |
| Bulk import (1,000 rows) | < 4s parse + < 3s INSERT | Zod validation in worker; bulk INSERT. |
| Integrity check (10,000 receipts) | < 6s | sha256 in batch. |
| Audit log query (50 rows, filtered) | < 50ms | Indexed by `idx_audit_created`. |
| Theme toggle apply | < 16ms (1 frame) | CSS variable swap; no re-render. |
| Frame rate during backup progress bar | ≥ 55fps on mid-range Android | Progress updates throttled to 10/s. |

### 17.1 Caching Strategy
- `['settings']` — `staleTime: Infinity`, cached across navigations. Invalidated explicitly on mutation.
- `['audit-log', filters]` — `staleTime: 30s`, paginated.
- `['sync-outbox']` — `staleTime: 5s` (live-ish, since it reflects sync state).
- Backup/restore/import/export blobs are **not** cached — they're one-shot operations.

---

## 18. Accessibility

Settings follows `13_UI_Guidelines.md` §10 (Accessibility Commitments) and §8 (Component Vocabulary) in full. Settings-specific additions:

| Concern | Implementation |
|---------|----------------|
| **Keyboard navigation** | `Tab` cycles through SettingsNav items → active section's fields. `Enter` activates a nav item. `Esc` closes any open sheet. |
| **Section jump shortcuts** | `G T` (Settings) + `1`–`9`, `0`, `-`, `=` jump to the 12 sections in order. |
| **Focus rings** | Cyan outline `2px solid #00F0FF` on every focusable element; never removed. |
| **Screen reader labels** | Every icon-only button has `sr-only` text. Toggle states announce `aria-checked`. PIN pad announces "PIN entry, digit 3 of 6" (without reading the digit). |
| **PIN pad accessibility** | Digit buttons are real `<button>` elements with `aria-label="1"`, etc. The masked dots are `aria-hidden`. |
| **Color + icon pairing** | Status dots (emerald/amber/flare) always paired with an icon (`Check` / `CircleDot` / `X`). Never color alone. |
| **Reduced motion** | `prefers-reduced-motion: reduce` → instant-apply replaces springs; backup progress bar updates without animation. |
| **Contrast** | All text on glass verified ≥ 4.5:1. Captions (muted) verified ≥ 3:1 (large-text threshold). |
| **Touch targets** | ≥ 44×44px on `base`/`sm`. Slider thumbs are 24px visual + 44px hit area. |
| **Form errors** | `aria-invalid="true"` on fields with errors; `aria-describedby` links to the error message. Error region is `aria-live="polite"`. |
| **Audit log table** | Sortable via keyboard (`Enter` on column header). Row expand via `Enter`. |
| **Typed confirm inputs** | `aria-label` announces expected word: "Type RESTORE to confirm." Live region announces when match is achieved. |

---

## 19. Testing Requirements

Although the sandbox rule is "no tests unless asked," this section documents the **test plan** for when tests are added (v1.x). Cited here so engineers know what to build.

### 19.1 Unit Tests (`packages/shared`)
- `profileSchema` — valid/invalid phone (E.164), email, currency enum.
- `feeRulesSchema` — alphanumeric prefix enforcement, grace_days bounds.
- `pinSchema` — rejects 123456, 000000, 111111, non-6-digit.
- `passphraseSchema` — min 12 chars.
- Argon2id KDF — deterministic key derivation for a known passphrase + salt.

### 19.2 Integration Tests (web)
- **Profile save** — fills form, clicks Save, asserts `settings` row updated + `audit_log` row written in same transaction.
- **Currency immutability** — seed a `FEE_CHARGED` row, attempt currency change, assert UI blocks + toast.
- **PIN change** — old PIN wrong → 5 attempts → lockout.
- **Biometric toggle** — disable requires PIN; enabling requires biometric capability mock.
- **Backup create** — passphrase entered, PIN verified, `.buddysaradhi` blob downloaded, `audit_log` `backup_create` written, `app_state.last_backup_at` updated.
- **Restore** — restore a known fixture `.buddysaradhi`, assert all rows land + sha256 verified.
- **Restore wrong passphrase** — assert abort + toast + no DB write.
- **Excel export** — assert 3 worksheets, correct column headers, row counts match.
- **Bulk import** — fixture `.xlsx` with 10 valid + 5 invalid rows; assert validation report; assert 10 inserted.
- **Delete-all** — triple gate (DELETE + PIN + DELETE); assert soft-delete on all tables + audit row.
- **Integrity check** — fixture with 1 tampered receipt; assert mismatch surfaced.

### 19.3 End-to-End (Agent Browser)
- Render `/` → `G T` → Settings paints in < 100ms.
- Navigate through all 12 sections; each renders without console errors.
- Profile → fill → Save → toast appears.
- Backup → passphrase → PIN → file downloads.
- Theme toggle → instant apply, persisted on reload.
- Sticky footer sticks on short sections (About), pushes on long (Diagnostics with 10k audit rows).

### 19.4 Performance Tests
- Backup creation benchmark: 1k, 10k, 50k students — assert < 8s / < 30s / < 120s.
- Audit log query: 100k rows — assert < 100ms with filter.
- Excel export: 10k students × 3 sheets — assert < 15s.

### 19.5 Security Tests
- Attempt backup without PIN → blocked.
- Attempt restore without typed `RESTORE` → blocked.
- Attempt delete-all without triple gate → blocked.
- Inspect `sync_outbox` payload after PIN change → assert `pin_hash` is **not** in the payload (SR-12).
- Inspect bundle after backup create → assert passphrase is **not** in any log/audit/blob.

---

## 20. Future Extensions

These are **not** v1. They live here as a parking lot for v1.x and v2, ranked by north-star impact (lowers minutes-per-day first).

| # | Extension | Version | Principle Tension |
|---|-----------|---------|-------------------|
| FE-01 | **Push notifications** (FCM/APNs) with per-channel toggles. | v1.x | None — extends existing Notifications section. |
| FE-02 | **Email + SMS reminders** with provider config (SendGrid / Twilio). | v1.x | P14 (parent as guest) — email goes to parent, but tutor-configured. |
| FE-03 | **Multi-user / role-based access** for Centre Priya persona (tutor, assistant, accountant roles). | v1.x | None — surfaces in Security section as "Users & Roles." |
| FE-04 | **Online payment gateway** (Razorpay / Stripe) with toggle + webhook config. | v1.x | Vision §6 non-goal lifted. |
| FE-05 | **Custom receipt logo upload** + branding colour picker. | v1.x | P12 — raises minutes-per-day marginally; deferred per Principle 12. |
| FE-06 | **GST/tax configuration** (HSN codes, tax rates, GSTIN). | v2 | Vision §6 non-goal lifted. |
| FE-07 | **Multi-branch federation** — one tenant, multiple branches with isolated ledgers. | v2 | Data model supports it; UI does not. |
| FE-08 | **WebAuthn biometric on web** (replacing PIN-only fallback). | v1.x | `02_Core_Logic.md` §6 already lists it. |
| FE-09 | **Scheduled backups** — auto-create `.buddysaradhi` weekly, save to user-chosen cloud drive (Drive/iCloud/Dropbox). | v1.x | P10 — backups are user's property; auto-save to user's drive respects this. |
| FE-10 | **Custom report builder** — drag-and-drop columns, save as template. | v2 | P8 — density without clutter. |
| FE-11 | **Localization** — full i18n for `hi`, `bn`, `ta`, `te`, `mr` (Indian language support). | v1.x | P1 — tutor's time; native language lowers friction. |
| FE-12 | **Audit log export** — separate `.csv` export of audit log for compliance. | v1.x | Already in full export; standalone is convenience. |

---

## 21. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 for the Settings screen. Settings is the most *control-dense* screen in Buddysaradhi — 12 sections, each with sliders, toggles, segmented controls, PinPads, typed-confirm inputs, range sliders, audit-log tables, and destructive triple-gate flows. Every mockup below annotates the **glass tier** or **neumorphic recipe** so the design contract is unambiguous. Character set per §20.2; accent colours named; cross-references use canonical IDs only.

### 21.1 Design System Reference — Settings

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces on this screen | Tier | Cross-ref |
|---|---|---|
| Sidebar / bottom-tab bar (mobile) | `glass-strong` | §5.5, §8.6 |
| Topbar | `glass-strong` sticky | §5.5 |
| Settings nav rail (left, 12 sections) | `glass` workhorse | §5.5 |
| Settings content pane (right, scrollable) | transparent over canvas (its sub-cards are glass) | §5.5 |
| Section card (per section) | `glass` workhorse; p-6 | §5.5 |
| Audit log table row | `glass-faint` band | §5.2, §8.4 |
| Backup / Restore / Delete sheets | `glass-strong` + backdrop `bg-black/60` | §5.5, §8.7 |
| Revoke-sessions confirm sheet | `glass-strong` + backdrop | §5.5, §8.7 |
| Unsaved-changes navigation guard sheet | `glass-strong` + backdrop | §5.5, §8.7 |
| Toast (settings saved / backup done / sync conflict) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| Empty-state card (fresh tenant Settings) | `glass` centered | §5.5, §8.19 |
| Holiday-list row | `glass-faint` band | §5.2 |
| Footer | `glass-faint` (recede), sticky per §13 | §5.5 |

| Neumorphic controls on this screen | Recipe | Cross-ref |
|---|---|---|
| Section nav item (left rail) | `neumo-raised` compact; active = `neumo-pressed` + cyan left-bar | §6.6, §8.6 |
| Profile form inputs (institute name, address, phone, email) | `neumo-inset`; focus = cyan 2px inset ring + glow | §6.6, §8.9 |
| `currency_code` select (locked with 🔒 after first ledger entry) | `neumo-inset` disabled state + 🔒 chip; cursor-not-allowed | §6.6, §8.9 |
| `locale` select | `neumo-inset` | §6.6, §8.9 |
| Theme / Density / Fee model / Default status segmented controls | well = `neumo-inset`; active pill = `neumo-raised` + cyan glow | §6.6, §8.5 |
| `reduced_motion` / `biometric_enabled` / `auto_invoice` toggles | well = `neumo-inset`; knob = `neumo-raised` (emerald→cyan when on) | §6.4, §8.16 |
| `attendance_lock_hours` / `session_timeout_min` / `auto_archive_inactive_days` range sliders | track = `neumo-inset`; knob = `neumo-raised` (scales 1.1 on drag); fill = flat cyan tint | §6.6, §8.17 |
| `grace_days` stepper | well = `neumo-inset`; `±` buttons = `neumo-raised` | §6.6, §8.18 |
| `invoice_prefix` / `receipt_prefix` text inputs | `neumo-inset` (alphanumeric only) | §6.6, §8.9 |
| `PinPad` (6-digit, used by Security / Backup / Restore / Delete) | digits = `neumo-raised`; ⌫ backspace = `neumo-raised` + flare glow | §6.6 |
| `TypedConfirmInput` (RESTORE / DELETE / EXPORT) | `neumo-inset` well; cyan glow when match achieved | §6.6, §8.9 |
| Discard / Save buttons (Profile section) | `neumo-raised` secondary (Discard = ghost); Save = `neumo-raised` + emerald glow | §6.6, §8.2 |
| Create Backup / Restore Backup / Delete All buttons | primary = `neumo-raised` + emerald glow; destructive = `neumo-raised` + flare glow | §6.6, §8.2 |
| Audit-log filter chips | flat tinted (chips are not controls — §8.3); active chip X-button = `neumo-raised` micro | §8.3 |
| Revoke Sessions button | `neumo-raised` + flare glow (destructive) | §6.6, §8.2 |
| Integrity Check / Clear Cache / Force Sync / Rebuild Search buttons | `neumo-raised` secondary (cyan glow) | §6.6, §8.2 |
| Holiday-list "Add holiday" button | `neumo-raised` + emerald glow (primary) | §6.6, §8.2 |
| Holiday-list per-row delete button | `neumo-raised` + flare glow (destructive) | §6.6, §8.2 |

> **References:** Nielsen Norman Group — *Settings Pages: A UX Design Guide* (sectioned master-detail + status dots); Smashing Magazine — *Designing Better Settings Screens* (instant-apply vs Save-button split, our Appearance vs Profile split); Apple HIG — *Settings* (sectioned navigation rail, status dots); Material Design 3 — *Lists* (audit log table anatomy); WCAG 2.1 AA §3.3.3 (Error Suggestion — PinPad + typed-confirm pattern); WCAG 2.1 AA §3.3.4 (Error Prevention for Legal/Financial Actions — triple-gate Delete-All); A List Apart — *Coping With Data Loss Aversion* (typed-confirm word = `DELETE` reduces catastrophic misclicks); CSS-Tricks — *Designing Destructive Actions* (typed-confirm + PIN + second typed-confirm triple gate).

### 21.2 Mockup M1 — Full-Screen Desktop Layout (sectioned master-detail, Profile section active)

```
DESKTOP (≥ 1024px) — Sectioned master-detail, 12-section nav rail + content pane
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Topbar (.glass-strong sticky) ──────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Buddysaradhi · 🔍 Search · ⌘K · 🔔 · 👤 (avatar)     │ │
│ │  ◈ Dashboard              │ ├──────────────────────────────────────────────────┤ │
│ │  👥 Students              │ │                                                  │ │
│ │  ✓ Attendance             │ │  ┌─ Settings nav rail (.glass) ─┐ ┌─ Profile ─┐ │ │
│ │  ₹ Fees                   │ │  │ ◉ Profile   ← active (cyan) │ │  Institute │ │ │
│ │  ◉ Settings    ← active   │ │  │ ○ Appearance              │ │  Letterhead│ │ │
│ │                           │ │  │ ○ Attendance Rules        │ │ ┌────────┐│ │ │
│ │  ──────                   │ │  │ ○ Fee Rules               │ │ │Name    ││ │ │
│ │  Priya B.                 │ │  │ ○ Notifications            │ │ │[BrightM││ │ │
│ │  Pune · 142 students      │ │  │ ○ Security       ●  (PIN)  │ │ │inds  ] ││ │ │
│ │                           │ │  │ ○ Backup & Restore  ●(ok)  │ │ │Address ││ │ │
│ │  ⚙ Sync                   │ │  │ ○ Import & Export          │ │ │[12 MG  ││ │ │
│ │  ⚡ ⌘K                    │ │  │ ○ Data & Privacy           │ │ │Road …] ││ │ │
│ │                           │ │  │ ○ About                   │ │ │Phone   ││ │ │
│ │                           │ │  │ ○ Help                     │ │ │[+91 98x││ │ │
│ │                           │ │  │ ○ Diagnostics              │ │ │Email   ││ │ │
│ │                           │ │  └────────────────────────────┘ │ │[priya@ ││ │ │
│ │                           │ │                                  │ │Currency││ │ │
│ │                           │ │                                  │ │[INR ▾]🔒│ │ │
│ │                           │ │                                  │ │Locale  ││ │ │
│ │                           │ │                                  │ │[en-IN ▾]│ │ │
│ │                           │ │                                  │ └────────┘│ │ │
│ │                           │ │                                  │ [Discard] │ │ │
│ │                           │ │                                  │      [Save✓]│ │
│ │                           │ │                                  └───────────┘│ │
│ └───────────────────────────┘ └──────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint, sticky) ─────────────────────────────────────────────────┐ │
│ │  ● Online · synced 2m ago · v1.4.2 (#a3f9c1) · © Buddysaradhi Omni-Core              │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
   ↑ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2)
   ↑ sidebar + topbar = .glass-strong (8% white, 24px blur) — persistent chrome (§5.5)
   ↑ settings nav rail = .glass workhorse; section items = .neumo-raised compact
     active item = .neumo-pressed + 2px cyan left-bar (§8.6)
   ↑ status dots on nav items: emerald=ok, amber=unsaved, flare=PIN-unset, cyan=info
   ↑ Profile section card = .glass workhorse, p-6
   ↑ form inputs = .neumo-inset; focus = cyan 2px inset ring + glow (§8.9)
   ↑ currency_code select = .neumo-inset DISABLED state + 🔒 chip (BR-M-02 immutability)
   ↑ [Discard] = ghost (--text-secondary, no shadow); [Save ✓] = .neumo-raised + emerald glow
   ↑ both buttons disabled when form is clean (P6 Defaults Are Sacred)
   ↑ footer = .glass-faint (recede), sticky per §13
```

### 21.3 Mockup M2 — Empty State (fresh-tenant Settings, Profile section with defaults pre-filled)

```
EMPTY STATE — fresh tenant, Settings → Profile (defaults pre-filled per P6)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Topbar (.glass-strong sticky) ──────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Buddysaradhi · 🔍 Search · ⌘K · 🔔 · 👤              │ │
│ │  ◉ Settings    ← active   │ ├──────────────────────────────────────────────────┤ │
│ │                           │ │  ┌─ Settings nav rail ─┐ ┌─ Profile ───────────┐│ │
│ │  ──────                   │ │  │ ◉ Profile  ← active │ │                     ││ │
│ │  (new tutor)              │ │  │ ○ Appearance         │ │  ┌─ Welcome ──────┐ ││ │
│ │  0 students · ₹ 0         │ │  │ ○ Attendance Rules   │ │  │ Configure your │ ││ │
│ │                           │ │  │ ○ Fee Rules          │ │  │ institute       │ ││ │
│ │  ⚙ Sync                   │ │  │ ○ Notifications      │ │  │ letterhead in   │ ││ │
│ │                           │ │  │ ○ Security   ⚠(PIN)  │ │  │ < 90 seconds.   │ ││ │
│ │                           │ │  │ ○ Backup & Restore   │ │  │                 │ ││ │
│ │                           │ │  │ ○ Import & Export    │ │  │ Defaults are    │ ││ │
│ │                           │ │  │ ○ Data & Privacy     │ │  │ pre-filled —    │ ││ │
│ │                           │ │  │ ○ About              │ │  │ refine as you   │ ││ │
│ │                           │ │  │ ○ Help                │ │  │ like.           │ ││ │
│ │                           │ │  │ ○ Diagnostics        │ │  └─────────────────┘ ││ │
│ │                           │ │  │                      │ │                     ││ │
│ │                           │ │  │                      │ │  [Institute Name ]  ││ │
│ │                           │ │  │                      │ │  [Address        ]  ││ │
│ │                           │ │  │                      │ │  [+91 …         ]   ││ │
│ │                           │ │  │                      │ │  [tutor@…        ]  ││ │
│ │                           │ │  │                      │ │  [INR ▾]            ││ │
│ │                           │ │  │                      │ │  [en-IN ▾]          ││ │
│ │                           │ │  │                      │ │                     ││ │
│ │                           │ │  │                      │ │  [Discard] [Save ✓] ││ │
│ │                           │ │  └──────────────────────┘ └─────────────────────┘│ │
│ └───────────────────────────┘ └──────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ─────────────────────────────────────────────────────────┐ │
│ │  ● Online · synced just now · v1.4.2 · © Buddysaradhi Omni-Core                      │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
   ↑ Profile section card = .glass workhorse; welcome sub-card = flat bg-white/[0.04]
     (no-glass-on-glass, §5.3) with cyan left-border
   ↑ inputs = .neumo-inset, pre-filled with defaults (institute_name = tenant name from
     provisioning, currency = INR, locale = en-IN per BR-M-02)
   ↑ Security nav item shows ⚠ flare dot (PIN unset) — surfaces the most critical
     "must-do" affordance without forcing a modal (P15 honest empty state)
   ↑ [Save ✓] is enabled (form is dirty from defaults being shown for the first time);
     tutor can save-as-is or refine then save
   ↑ honest-empty-state rule (P15): no blank grid; defaults + a welcome card
   ↑ the only flare-coloured element is the Security ⚠ dot — visual priority queue
```

### 21.4 Mockup M3 — Loading / Skeleton (settings singleton first paint)

```
SKELETON — first paint, settings singleton loading, < 100ms budget (§17)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Topbar (.glass-strong sticky) ──────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Buddysaradhi · 🔍 Search · ⌘K · 🔔 · 👤              │ │
│ │  ◉ Settings    ← active   │ ├──────────────────────────────────────────────────┤ │
│ │                           │ │  ┌─ Nav rail skel ─┐ ┌─ Profile section skel ─┐│ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │                        ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  ░░░░░░░░░░░░░░░░░░░░  ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  ░░░░░░░░░░░░░░░░░░░░  ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  ░░░░░░░░░░░░░░        ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  ░░░░░░░░░░░░░░░░░░░░  ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  ░░░░░░░░░░░░░░        ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  ░░░░░░░░░░░░░░░░░░░░  ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  ░░░░░░░░░░░░░░░░░░░░  ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  ░░░░░░░░░░░░░░░░░░░░  ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │  [░░░░░]      [░░░░░] ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │                        ││ │
│ │                           │ │  │ ░░░░░░░░░░░░░░░ │ │                        ││ │
│ │                           │ │  └─────────────────┘ └────────────────────────┘│ │
│ └───────────────────────────┘ └──────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ─────────────────────────────────────────────────────────┐ │
│ │  ● Online · syncing… · v— · © Buddysaradhi                                          │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
   ↑ nav rail skeleton = .glass-faint blocks + shimmer (§8.20); 12 placeholder rows
   ↑ Profile section skeleton = .glass-faint blocks + shimmer; field-label bars + input bars
   ↑ input skeletons keep the .neumo-inset affordance (the inset shadow stays) so the
     user reads "input field" even mid-load
   ↑ button skeletons at bottom = .neumo-raised compact shape with shimmer overlay
   ↑ aria-busy="true" on both nav rail + content pane parents (§10.5)
   ↑ budget < 100ms from cache, < 300ms cold (§17 Performance Targets)
   ↑ 120ms fade-out on resolve; section switch after load = < 16ms (Zustand state change)
   ↑ if settings row is missing (provisioning race, EC-16), engine calls
     ensureSettingsSingleton() → 200ms skeleton → content
```

### 21.5 Mockup M4 — Primary Modal: Backup Create Sheet (passphrase + PIN-gated)

```
MODAL — Create Backup Sheet (BR-SEC-02, BR-BAT-01..B05, §09_Backup_and_Import_Export.md §3)
┌──────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░ backdrop: bg-black/60 + backdrop-blur-sm ░░░░░░░░░░░░░ │
│  ░░░░░░░  ┌──────────────────────────────────────────────╲░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  │  Create encrypted backup                 ✕       │░░░░░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────┤░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Filename: Buddysaradhi_Backup_20250115-1842.buddysaradhi│░░░░░░░░░░░  │
│  ░░░░░░░  │  Students: 142 · Ledger entries: 8,431         │░░░░░░░░░░░  │
│  ░░░░░░░  │  Encrypted: AES-256-GCM · Key: argon2id        │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  ⚠ If you forget this passphrase, we cannot   │░░░░░░░░░░░  │
│  ░░░░░░░  │    recover your data. Write it down.          │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Passphrase (min 12 chars)                   │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐   │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ ••••••••••••••••••                  👁 │   │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘   │░░░░░░░░░░░  │
│  ░░░░░░░  │  Confirm passphrase                          │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐   │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ ••••••••••••••••••                  👁 │   │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘   │░░░░░░░░░░░  │
│  ░░░░░░░  │  ✓ match                                    │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Enter PIN to confirm (fresh, ≤ 30s old)     │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐   │░░░░░░░░░░░  │
│  ░░░░░░░  │  │  • • • • • •                         │   │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘   │░░░░░░░░░░░  │
│  ░░░░░░░  │      1  2  3                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      4  5  6                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      7  8  9                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      •  0  ⌫                                │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │   [Cancel]              [Create Backup] (dis.)│░░░░░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────┘░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ backdrop = bg-black/60 + backdrop-blur-sm — click = cancel, ESC = cancel (§8.7)
   ↑ panel = .glass-strong (8% white, 24px blur) — highest-focus tier (§5.5)
   ↑ passphrase inputs = .neumo-inset; 👁 = .neumo-raised micro show/hide toggle
   ↑ passphrase strength meter (not shown) = flat tinted bar (emerald ≥ 12 chars + complexity)
   ↑ PIN Pad digits = .neumo-raised; ⌫ backspace = .neumo-raised + flare glow
   ↑ ⚠ amber warning = lucide AlertTriangle, amber accent
   ↑ [Cancel] = ghost; [Create Backup] = .neumo-raised + emerald glow (primary, §8.2)
     button disabled until: passphrase ≥ 12 chars + confirm match + PIN verified
   ↑ aria-modal="true" + focus-trap active (§10.5); ESC = cancel
   ↑ on submit: stream JSONL → manifest sha256 → argon2id → AES-256-GCM → .buddysaradhi blob
   ↑ audit_log written BEFORE the backup mutation (BR-SEC-03 fail-closed, §9.6)
   ↑ no optimistic UI — user sees the file only after the transaction commits (SR-13)
   ↑ 240ms ease-spring-soft enter (§7.3 modal-enter); mirror exit 180ms
```

### 21.6 Mockup M5 — Toast / Confirmation: Delete All Data (primary destructive, triple-gate)

```
TRIPLE-GATE — Delete All Data (SR-03, BR-SEC-02, BR-SEC-04)
STEP 1 of 3: First typed-confirm "DELETE"
┌──────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░ backdrop: bg-black/60 + backdrop-blur-sm ░░░░░░░░░░░░░ │
│  ░░░░░░░  ┌──────────────────────────────────────────────╲░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  │  Delete all data?  (Step 1 of 3)         ✕       │░░░░░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────┤░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  This will soft-delete:                       │░░░░░░░░░░░  │
│  ░░░░░░░  │   • 142 students + their ledger (8,431 rows) │░░░░░░░░░░░  │
│  ░░░░░░░  │   • 36 batches · 4,200 attendance records    │░░░░░░░░░░░  │
│  ░░░░░░░  │   • 8,431 ledger entries + 412 receipts      │░░░░░░░░░░░  │
│  ░░░░░░░  │   • All invoices + fee plans + schedule      │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Preserved:                                  │░░░░░░░░░░░  │
│  ░░░░░░░  │   • audit_log (8,901 rows — append-only)    │░░░░░░░░░░░  │
│  ░░░░░░░  │   • app_state (with deleted_at tombstone)   │░░░░░░░░░░░  │
│  ░░░░░░░  │   • settings (so you can reconfigure)       │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  ⚠ The Turso cloud DB is NOT dropped.       │░░░░░░░░░░░  │
│  ░░░░░░░  │    You can re-provision by logging in       │░░░░░░░░░░░  │
│  ░░░░░░░  │    elsewhere. The local cache is wiped.     │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Type DELETE to confirm                      │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐    │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ DELET_                              │    │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘    │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │   [Cancel]            [Continue →]  (dis.)   │░░░░░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────┘░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ backdrop = bg-black/60 + backdrop-blur-sm — click = cancel, ESC = cancel (§8.7)
   ↑ panel = .glass-strong (8% white, 24px blur) — highest-focus tier (§5.5)
   ↑ ⚠ amber warning = lucide AlertTriangle, amber accent
   ↑ red-tinted list items = flat bg-flare/[0.08] sub-cards with flare left-border
     (no-glass-on-glass, §5.3)
   ↑ green-tinted list items = flat bg-emerald/[0.08] sub-cards with emerald left-border
   ↑ TypedConfirmInput = .neumo-inset well; cyan glow when "DELETE" matches
   ↑ [Cancel] = ghost; [Continue →] = .neumo-raised + flare glow (destructive)
     button disabled until "DELETE" matches exactly
   ↑ aria-modal="true" + focus-trap active (§10.5); ESC = cancel
   ↑ step 2 (not shown): PinPad prompt (BR-SEC-02)
   ↑ step 3 (not shown): second typed-confirm "DELETE" (SR-03 triple-gate)

AFTER triple-gate + transaction commit (Toast surfaces bottom-right):

                          ┌▌──────────────────────────────────┐
                          │▌ ✓  12,883 rows soft-deleted       │
                          │▌    audit_log preserved · [Undo] ✕ │
                          └▌──────────────────────────────────┘
                             ↑ 4px emerald left-bar (success)
                             ↑ .glass-strong (8% white, 24px blur) per §8.8
                             ↑ aria-live="polite" (success = polite, §10.5)
                             ↑ 4s auto-dismiss; swipe-down to dismiss (§15.3)
                             ↑ [Undo] = .neumo-raised compact (restores from
                               app_state.deleted_at tombstone within 24h,
                               enqueues sync_outbox per BR-SYN-01)
                             ↑ ✕ = ghost close
                             ↑ after 24h, tombstone is permanent — [Undo] disabled
```

> **Why triple-gate for delete-all (SR-03, BR-SEC-04):** a misclick on "Delete all data" would wipe the tutor's entire business locally. Even with audit_log preserved, recovery requires a backup restore (which itself needs a passphrase + PIN). Three independent gates — typed `DELETE` + PIN + typed `DELETE` — guarantee *deliberate* intent. The 24h tombstone `[Undo]` window is the safety net for the "I just accidentally did this" realisation (which would otherwise require a backup restore).

### 21.7 Mockup M6 — Mobile Variant (`base` < 640px, nav rail collapses to horizontal pill scroller)

```
MOBILE (base < 640px) — single column, nav rail = horizontal pill scroller above content
┌──────────────────────────────────────┐
│ ▔▔▔▔▔▔ ← env(safe-area-inset-top)    │
│ ┌─ Topbar (.glass-strong sticky) ───┐│
│ │ ◈  Settings    🔍 ⌘K   🔔        ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Nav rail (horizontal scroller) ─┐│
│ │ ◉Prof ○Appr ○Att ○Fee ○Not ○Sec ││
│ │ ○Bak ○Imp ○Dat ○Abt ○Hlp ○Dia   ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Profile section (.glass) ───────┐│
│ │  Institute Letterhead            ││
│ │  ┌────────────────────────────┐  ││
│ │  │ Institute Name             │  ││
│ │  │ [Bright Minds Tuition    ] │  ││
│ │  │ Address                    │  ││
│ │  │ [12, MG Road, Pune …    ]  │  ││
│ │  │ Phone (+E.164)             │  ││
│ │  │ [+91 98xxx              ]   │  ││
│ │  │ Email                      │  ││
│ │  │ [priya@brightminds.in  ]   │  ││
│ │  │ Currency        [INR ▾] 🔒  │  ││
│ │  │ Locale          [en-IN ▾]   │  ││
│ │  └────────────────────────────┘  ││
│ │  [Discard]            [Save ✓]   ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Bottom Tab Bar (.glass-strong) ─┐│
│ │  ◈    👥    ✓    ₹    ⚙           ││
│ │ Home Stud Att  Fees Set           ││
│ └────────────────────────────────────┘│
│ ▁▁▁▁▁ ← env(safe-area-inset-bottom)  │
└──────────────────────────────────────┘
   ↑ topbar = .glass-strong sticky (§5.5)
   ↑ nav rail = horizontal pill scroller (.glass-strong rail); section pills = .neumo-raised compact
     active pill = .neumo-pressed + 2px cyan left-bar (§8.6 mobile variant)
   ↑ Profile section card = .glass workhorse, p-6
   ↑ form inputs = .neumo-inset; 44×44px hit area (§10.2)
   ↑ currency_code select = .neumo-inset disabled + 🔒 chip (BR-M-02 immutability)
   ↑ [Discard] = ghost; [Save ✓] = .neumo-raised + emerald glow (primary, §8.2)
   ↑ Backup / Restore / Delete sheets = full-screen 90vh bottom sheet on mobile (§8.7)
   ↑ PinPad = 6-digit neumorphic, full-width digits, 44×44px hit area each (§10.2)
   ↑ bottom tab bar = .glass-strong + safe-area inset (§4.3, §8.6)
   ↑ every tab + pill + button ≥ 44×44px hit area (§10.2)
   ↑ unsaved-changes navigation guard = .glass-strong sheet on mobile (§8.7)
```

### 21.8 Mockup M7 — State Matrix: Section Nav Item (primary interactive control)

```
STATE MATRIX — Section Nav Item (left rail, drives the entire content pane)
Box: 64–80 char width per §20.3 rule 2.

DEFAULT (inactive)                  HOVER (on "Security")
┌──────────────────────────┐        ┌──────────────────────────┐
│  ○  Appearance            │        │  ○  Security       ●  ⚠  │
└──────────────────────────┘        └──────────────────────────┘
 ↑ .neumo-raised compact              ↑ .neumo-raised compact
   4px 4px 8px #0a0a1a                  (shadow stays equal;
  -4px -4px 8px #2a2a5a                  bg shifts to #1e1e3e)
 ↑ --text-secondary                  ↑ cursor-pointer
 ↑ 36px height per item              ↑ --text-secondary → --text-primary
 ↑ status dot (if any) at right        transition 60ms
   • emerald = ok (fresh backup)     ↑ status dot ⚠ flare = PIN unset (P15 honest surfacing)
   • amber = unsaved changes
   • flare = PIN unset (Security only)
   • cyan = info (schema drift)

ACTIVE (selected)                   PRESSED (during tap)
┌▌──────────────────────────┐       ┌──────────────────────────┐
│▌◉  Profile    ← active    │       │  ◉  Profile              │
└▌──────────────────────────┘       └──────────────────────────┘
 ↑ .neumo-pressed                    ↑ .neumo-pressed
   inset 2px 2px 4px #0a0a1a           inset 2px 2px 4px #0a0a1a
  -2px -2px 4px #2a2a5a              -2px -2px 4px #2a2a5a
 ↑ 2px cyan left-bar (selection     ↑ translateY(1px)
   marker, §5.4)                    ↑ 60ms haptic on mobile
 ↑ bg-cyan/10 overlay                ↑ fires only while finger is down;
 ↑ --text-primary (full contrast)     reverts on up if move > 8px (drag-cancel)
 ↑ aria-current="page"               ↑ ESC returns focus to nav rail
 ↑ 44×44px hit area (§10.2)

FOCUS (keyboard)                    DISABLED (mutation in flight)
╔════════════════════════════╗      ┌──────────────────────────┐
║  ◉  Profile    ← active    ║      │  ░  Profile   (saving…)  │
╚════════════════════════════╝      └──────────────────────────┘
 ↑ cyan 2px ring + glow              ↑ opacity-40
   (§10.3 focus-visible)            ↑ cursor-not-allowed
 ↑ keyboard: 1-9, 0, -, = jump       ↑ --text-muted
   to the 12 sections in order       ↑ disabled while a mutation is in flight
   (§10.7 Settings jump shortcuts)     (e.g., backup creating, restore restoring)
 ↑ ↑/↓ moves between sections         ↑ aria-disabled="true" announced
 ↑ Enter / Space activates
```

> **References:** Apple HIG — *Settings* (canonical sectioned-nav rail anatomy); Material Design 3 — *Navigation Drawer* + *Navigation Rail* (mobile-collapse pattern); Nielsen Norman Group — *Settings Pages: A UX Design Guide* (status dots = honest empty-state surfacing); Smashing Magazine — *Designing Better Settings Screens* (instant-apply vs Save-button split — our Appearance vs Profile split); WCAG 2.1 AA §4.1.2 (each nav item needs `role="tab"` + `aria-selected` / `aria-current="page"`); WCAG 2.1 AA §1.4.11 (Non-text Contrast — status dots must pair with text label + icon, never dot alone — emerald ✓ / amber ◐ / flare ✕ / cyan • per §9.4 Status Icon Pairings); CSS-Tricks — *Designing Destructive Actions* (the sectioned nav surfaces destructive-section status dots so the tutor can see "PIN unset" without opening Security).

---

This specification is the contract for the Settings screen. Any change to a field, a flow, or a security gate here is a spec amendment requiring review of `10_Security.md`, `12_Business_Rules.md`, and `09_Backup_and_Import_Export.md` in the same PR.
