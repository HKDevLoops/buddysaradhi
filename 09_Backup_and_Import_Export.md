# 09 — Backup & Import/Export

> The subsystem that lets a tutor take their entire business in their hand, move it across devices, hand a clean Excel sheet to an accountant, and rebuild from zero on a fresh laptop in under a minute. Cross-references: `08_Settings.md` (UI entry points), `10_Security.md` §13 (backup crypto), `11_Data_Model.md` (table contract), `12_Business_Rules.md` §9 (BR-BAT-01..B05).

---

## 1. Purpose

The Backup & Import/Export subsystem is the **portability spine** of Buddysaradhi. It exists for three reasons:

1. **Disaster recovery.** A tutor's laptop is stolen, dropped in a bucket of chai, or simply retired. The tutor must be able to download a single file today and restore the entire business on a fresh device tomorrow with zero data loss and zero ledger corruption.
2. **Excel interop.** Tutors live in spreadsheets. Migrating from an existing Google Sheet of students, sharing a monthly collection report with an accountant, and bulk-uploading 200 student records at the start of an academic year are all first-class operations, not afterthoughts.
3. **User ownership of data (Principle 10).** A backup is the tutor's property. We never hold it hostage to a subscription, never gate Excel export behind a paywall, and never silently upload the user's data to a backend we control. The `.buddysaradhi` file is an offline artefact the user can put on a pen-drive, email to themselves, or store in a vault.

This subsystem covers the **internals**: file formats, encryption, parsing, validation, migration, streaming. The Settings UI surfaces (buttons, drawers, file pickers, progress bars) are specified in `08_Settings.md` §"Backup & Data" tab. This document defines the contracts those UI entry points invoke.

---

## 2. Business Objective

A release of Buddysaradhi is judged by three measurable outcomes that this subsystem owns:

- **Backup-to-restore on a fresh device in under 60 seconds** for a 1,000-student tenant (Vision §7.4). This includes install, signup, file pick, passphrase entry, migrate, render. The 60s budget breaks down as: install/signup pre-done (40s external), restore itself ≤ 20s.
- **Excel export of 10,000 rows under 8 seconds** with a single .xlsx file containing the three mandated worksheets (Students, Attendance, Payments).
- **Bulk import of 1,000 student rows under 3 seconds** with a per-row validation report and a deduplication interstitial that never silently merges.

The deeper business objective is **trust-by-portability**: a tutor who can hold their data in their hand and walk away is a tutor who will trust the system with ten years of fees. The `.buddysaradhi` format is therefore documented, stable across versions, and independent of any backend we operate.

---

## 3. Navigation Entry

Per `02_Core_Logic.md` §1, only the `/` route is exposed; everything is in-shell state. Backup/Import/Export surfaces are reached via the **Settings** screen, "Backup & Data" tab — see `08_Settings.md` for the drawer layout. This subsystem exposes the following programmatic entry points the UI binds to:

| Entry | Invoker | Component |
|-------|---------|-----------|
| Create backup | Settings → Backup & Data → "Create backup" | `backup/CreateBackup.ts` → `runBackup()` |
| Restore backup | Settings → Backup & Data → "Restore backup" | `backup/RestoreBackup.ts` → `runRestore()` |
| Export Excel | Settings → Backup & Data → "Export to Excel" + Fees screen "Export month" action | `export/ExcelExporter.ts` → `exportExcel()` |
| Export CSV | Fees/Attendance report panels "Download CSV" | `export/CsvExporter.ts` → `exportCsv()` |
| Import students | Settings → Backup & Data → "Import students" + Students empty state | `import/ExcelImporter.ts` → `importStudents()` |
| Import CSV | Same entry, auto-detected by extension | `import/CsvImporter.ts` → `importCsv()` |
| Download template | Settings → Backup & Data → "Download template" | `import/TemplateGenerator.ts` → `generateTemplate()` |

The Settings UI surfaces, file-picker interactions, progress toasts, and confirmation dialogs are defined in `08_Settings.md`. This document defines the **contracts** those surfaces invoke.

---

## 4. User Story

> **Rohan, the solo tutor, on the night his laptop dies.**
>
> Rohan's six-year-old laptop finally refuses to boot. He has 84 students, three batches, twelve months of fees, and parents who will ask about receipts tomorrow morning. He buys a new laptop, installs Buddysaradhi, signs in with the same Google account, and the app loads — empty. He plugs in his pen-drive, opens Settings → Backup & Data → Restore backup, picks `Buddysaradhi_Backup_20250814.buddysaradhi`, types the passphrase he wrote on a Post-it in his wallet (`monsoon-river-lantern-42`), confirms by typing `RESTORE`, and waits. A progress bar fills: *Decrypting… Verifying integrity… Migrating schema… Restoring students… Restoring ledger… Done.* Eighteen seconds. The dashboard renders with all 84 students, today's attendance pending, and last month's ₹1,24,500 collected.
>
> He then exports this month's collection to Excel (`Buddysaradhi_Export_20250815.xlsx`) and emails it to his CA. The CA opens the three worksheets — Students, Attendance, Payments — and reconciles against the bank. No back-and-forth. No "send me a screenshot." Rohan's business did not skip a beat.

This story is the acceptance test for the entire subsystem. Every design decision below is in service of it.

---

## 5. UX Principles

This subsystem inherits the global principles (`01_Product_Principles.md`) and adds subsystem-specific ones:

- **P10 — Backups are the user's property.** The format is open, documented, and stable. A tutor can decrypt a `.buddysaradhi` file with standard tools if Buddysaradhi disappears. (We publish the format spec publicly; the magic bytes `BSR1` are a deliberate marker.)
- **P5 — Offline-first, always.** Backup, restore, export, and import are all purely local operations. No network call is in the critical path. The user can run a full backup in airplane mode.
- **P11 — Security is tactile, not theatrical.** Passphrase entry is a deliberate, focused act. Restore requires typing `RESTORE` — not because the user might be confused, but because the action is irreversible and we make it felt.
- **P7 — Motion is meaning.** Progress bars fill because they communicate real work, not to entertain. The fill rate reflects actual row throughput, not a fake animation.
- **P15 — Honest empty states.** When import yields zero valid rows, the report says so plainly: "0 students imported. 47 rows invalid. Download the error report." Not "Import complete!"
- **P4 — The ledger is immutable truth.** Restore never edits a ledger row. It either inserts (UPSERT by id) or skips (if the row already exists with a different shape — flagged as a conflict). Importing an Excel sheet never creates ledger entries; it creates students, optionally batches and fee plans. Payments always come in through the normal flow.

---

## 6. Subsystem Layout

The subsystem is four pipelines plus a shared crypto/validators/progress core. Each pipeline is a single async function that streams work and emits progress events. Below is each pipeline as a flow diagram.

### 6.1 Pipeline A — Backup Create

```
runBackup({ passphrase, scope }) →

  1. PRE-FLIGHT
     ├─ require PIN + typed "EXPORT" (BR-SEC-02, BR-SEC-04)
     ├─ write audit_log {action: 'export_full', status: 'started'}
     └─ acquire write-lock on tenant DB (advisory)

  2. COLLECT (streaming)
     ├─ for each table in RESTORE_ORDER (see §9):
     │     ├─ stream rows via libSQL cursor (batch_size = 500)
     │     ├─ for each row: emit JSONL line {"table":"<t>","row":{...}}
     │     └─ progress.emit(stage: 'collect', table, pct)
     └─ data.jsonl accumulated in memory-bounded buffer

  3. MANIFEST
     ├─ compute sha256(data.jsonl)
     ├─ per-table row_counts{table:int}
     ├─ manifest = {version:1, tenant_id, created_at, schema_version,
     │              row_counts, sha256_data, app_version, currency_code}
     └─ schema_version.txt written

  4. TAR + GZIP
     ├─ tar(manifest.json, data.jsonl, schema_version.txt)
     └─ gzip the tar stream (level 6)

  5. ENCRYPT
     ├─ salt = randomBytes(16)
     ├─ key = argon2id(passphrase, salt, {m:64MB, t:3, p:2})
     ├─ nonce = randomBytes(12)
     ├─ ciphertext = AES-256-GCM(key, nonce, gzipped_tar)
     └─ tag = GCM auth tag (appended to ciphertext)

  6. ASSEMBLE FILE
     ├─ magic = 'BSR1'           (4 bytes ASCII)
     ├─ format_version = 1       (1 byte)
     ├─ salt (16 bytes) + nonce (12 bytes) + tag (16 bytes)
     ├─ ciphertext (variable)
     └─ atomic write to temp file → rename to Buddysaradhi_Backup_<YYYYMMDDHHmm>.buddysaradhi

  7. FINALIZE
     ├─ update app_state.last_backup_at
     ├─ write audit_log {action: 'backup_create', bytes, sha256_data}
     ├─ emit BACKUP_CREATED on cross-engine bus
     └─ return {filename, bytes, sha256_data, row_counts}
```

The file is **never** uploaded. The user is offered the OS share/save sheet (mobile) or a download link (web/desktop). BR-BAT-05.

### 6.2 Pipeline B — Backup Restore

```
runRestore({ file, passphrase, strategy }) →

  1. PRE-FLIGHT
     ├─ require PIN + typed "RESTORE" (BR-SEC-02)
     ├─ write audit_log {action: 'backup_restore', status: 'started'}
     └─ optional: snapshot current DB to Buddysaradhi_PreRestore_<ts>.buddysaradhi

  2. DECODE WRAPPER
     ├─ read magic bytes; if ≠ 'BSR1' → abort E_BAD_MAGIC
     ├─ read format_version; if > MAX_SUPPORTED → abort E_VERSION_AHEAD
     ├─ read salt, nonce, tag, ciphertext
     └─ progress.emit(stage: 'decode_wrapper', 5%)

  3. DECRYPT
     ├─ key = argon2id(passphrase, salt, {m:64MB, t:3, p:2})
     ├─ plaintext = AES-256-GCM-DECRYPT(key, nonce, ciphertext, tag)
     │     └─ on auth tag failure → E_WRONG_PASSPHRASE
     │        (3 attempts, then 60s lockout — see §11)
     └─ progress.emit(stage: 'decrypt', 15%)

  4. UNGZIP + UNTAR
     ├─ gunzip stream → tar stream
     ├─ extract manifest.json, data.jsonl, schema_version.txt
     └─ progress.emit(stage: 'untar', 25%)

  5. VERIFY INTEGRITY
     ├─ actual_sha = sha256(data.jsonl)
     ├─ if actual_sha ≠ manifest.sha256_data → abort E_CORRUPT
     └─ progress.emit(stage: 'verify', 30%)

  6. SCHEMA-MIGRATE
     ├─ file_schema = manifest.schema_version
     ├─ app_schema = app_state.schema_version
     ├─ if file_schema > app_schema → abort E_SCHEMA_AHEAD (prompt update)
     ├─ if file_schema < app_schema → run migrate(file_schema → app_schema) on data.jsonl
     │     └─ each migrator transforms JSONL lines in place, streaming
     └─ progress.emit(stage: 'migrate', 40%)

  7. PARSE + VALIDATE
     ├─ for each JSONL line:
     │     ├─ Zod-parse the row against table-specific schema
     │     ├─ invalid → push to errors[] with line number + reason
     │     └─ valid → bucket by table
     └─ progress.emit(stage: 'parse', 50%)

  8. CONFLICT-RESOLUTION PREVIEW
     ├─ for each row, check existing DB by id:
     │     ├─ absent → action = INSERT
     │     ├─ present + identical → action = SKIP
     │     └─ present + different → action = CONFLICT (per strategy)
     ├─ strategy = 'overwrite' | 'merge' | 'skip'
     │     ├─ overwrite: existing row replaced by incoming (except ledger_entries — see BR-LED-01)
     │     ├─ merge: non-null incoming fields override; nulls preserved
     │     └─ skip: leave existing row untouched; log in skipped[]
     └─ if conflicts > 0 and strategy unspecified → PAUSE + show interstitial

  9. TRANSACTIONAL WRITE (FK-aware order — see §9)
     ├─ BEGIN TRANSACTION
     ├─ for table in RESTORE_ORDER:
     │     ├─ UPSERT each row by id (idempotent — BR-SYN-02 style)
     │     ├─ FK orphan check: if row's parent_id not in DB (or incoming set) → skip + report
     │     └─ ledger_entries: db.ledgerEntry.createMany({ data, skipDuplicates: true }) (never db.ledgerEntry.update — BR-LED-01)
     ├─ COMMIT (or ROLLBACK on any hard error)
     └─ progress.emit(stage: 'write', 50% → 95%)

  10. POST-RESTORE
      ├─ recompute derived views (balances, FTS index)
      ├─ update app_state.schema_version, last_backup_at
      ├─ emit LEDGER_MUTATED, ATTENDANCE_LOCKED (broad invalidate)
      ├─ write audit_log {action: 'backup_restore', rows_written, conflicts, skipped}
      └─ return {rows_written, conflicts, skipped, errors}
```

The restore is **all-or-nothing at the transaction level**: if step 9 fails midway, ROLLBACK returns the DB to its pre-restore state. The optional pre-restore snapshot (step 1) provides a second safety net.

### 6.3 Pipeline C — Excel Export

```
exportExcel({ scope, periodFilter }) →

  1. PRE-FLIGHT
     ├─ monthly Excel export: no PIN (BR-SEC-04 — only *full* backups need typed confirm)
     ├─ full data export (all tables): require PIN + typed "EXPORT"
     └─ write audit_log {action: 'export_excel', scope}

  2. QUERY (3 parallel Prisma findMany calls — no raw SQL)
     ├─ Students stream:
     │     db.student.findMany({
     │       where: { tenantId, archivedAt: null },
     │       orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
     │       include: {
     │         enrollments: { where: { exitedOn: null }, include: { batch: true } },
     │         ledgerEntries: { where: { type: { not: 'VOID' } }, select: { amount: true, direction: true } },
     │       },
     │     })  // balance_due computed in TS reduce
     ├─ Attendance stream:
     │     db.attendanceRecord.findMany({
     │       where: { session: { tenantId, sessionDate: { gte: start, lte: end } } },
     │       orderBy: [{ session: { sessionDate: 'desc' } }, { student: { firstName: 'asc' } }],
     │       include: { student: true, session: { include: { batch: true } } },
     │     })
     └─ Payments stream:
     │     db.receipt.findMany({
     │       where: { tenantId, voidedAt: null, receivedOn: { gte: start, lte: end } },
     │       orderBy: { receivedOn: 'desc' },
     │       include: { student: true, invoice: true },
     │     })

  3. WRITE .xlsx (streaming via exceljs workbook.writer)
     ├─ Sheet "Students": headers + rows, frozen header row, autofilter
     ├─ Sheet "Attendance": headers + rows
     ├─ Sheet "Payments": headers + rows, currency format on amount column
     └─ progress.emit(stage: 'write', pct)

  4. FINALIZE
     ├─ filename = `Buddysaradhi_Export_<YYYYMMDD>.xlsx` (BR-BAT-03)
     ├─ update app_state.last_export_at
     ├─ write audit_log {action: 'export_excel', bytes, rows_per_sheet}
     ├─ emit EXPORT_REQUESTED on bus
     └─ return {filename, bytes, sheet_counts}
```

### 6.4 Pipeline D — Excel/CSV Import

```
importStudents({ file, options }) →

  1. PRE-FLIGHT
     ├─ detect file type by extension (.xlsx | .csv | .tsv)
     ├─ require PIN if importing > 100 rows (BR-SEC-02 for bulk operations)
     └─ write audit_log {action: 'import_students', source: file.name}

  2. PARSE
     ├─ Excel: exceljs streaming reader, sheet "Students"
     ├─ CSV: stream-parse with delimiter auto-detect (, ; \t |)
     ├─ Template-aware: read header row, map to canonical fields
     │     ├─ if header row matches TemplateGenerator's exact headers → strict mode
     │     └─ else → fuzzy-map (code/Code/Student Code → code)
     └─ progress.emit(stage: 'parse', pct)

  3. VALIDATE (cell-by-cell Zod — see §14)
     ├─ for each row i:
     │     ├─ result = StudentImportSchema.safeParse(row)
     │     ├─ if success → push to valid[] with parsed + dup_key
     │     └─ if fail → push to invalid[] with {row:i, errors: result.error.issues}
     └─ progress.emit(stage: 'validate', pct)

  4. DEDUP
     ├─ for each valid row, compute dup_key = lower(first_name+last_name+phone_last4) (BR-STU-02)
     ├─ query existing students by dup_key in DB
     ├─ for each match → mark as duplicate (do NOT auto-merge)
     └─ progress.emit(stage: 'dedup', pct)

  5. PREVIEW (interstitial before any write)
     ├─ show: {valid_count, invalid_count, duplicate_count, new_count}
     ├─ show invalid rows (first 50) with reason per cell
     ├─ show duplicates with existing student name + "Skip / Merge / Both"
     ├─ batch mapping: any new batch names in 'batch' column → "Create N new batches?"
     └─ user confirms or cancels (cancel = no writes, audit_log closed with status 'cancelled')

  6. TRANSACTIONAL WRITE
     ├─ BEGIN TRANSACTION
     ├─ for each new batch (auto-create with default schedule): INSERT batches
     ├─ for each valid, non-skipped row:
     │     ├─ if code blank → auto-gen STU-<seq> (BR-STU-04)
     │     ├─ INSERT students (UPSERT by dup_key if user chose 'merge')
     │     ├─ INSERT guardian if phone present (mark is_primary)
     │     ├─ INSERT student_enrollments for each batch
     │     └─ INSERT audit_log {action:'student_create', source:'import', ref_id}
     ├─ COMMIT
     └─ progress.emit(stage: 'write', pct)

  7. REPORT
     ├─ return {created, merged, skipped, invalid: [{row, errors}]}
     ├─ toast with counts
     ├─ "Download error report (.xlsx)" button if invalid > 0
     │     (writes the original rows + an 'errors' column with joined issue messages)
     └─ invalidate ['students'], emit LEDGER_MUTATED (no — ledger untouched)
         (emit only STUDENTS_INVALIDATED — refresh Students screen)
```

Import is **students-only in v1**. Importing payments or attendance is a v1.x feature (see §20) because those touch the ledger and require strict FK + sequence integrity.

---

## 7. Component Tree

```
src/features/data/
├── backup/
│   ├── CreateBackup.ts
│   │   ├── runBackup(opts: BackupOptions): Promise<BackupResult>
│   │   ├── collectTables(stream: Writable, opts): Promise<Manifest>
│   │   ├── tarAndGzip(files: TarEntry[]): ReadableStream<Uint8Array>
│   │   └── assembleFile(parts: FileParts): Uint8Array
│   ├── RestoreBackup.ts
│   │   ├── runRestore(opts: RestoreOptions): Promise<RestoreResult>
│   │   ├── decodeWrapper(bytes: Uint8Array): DecodedFile
│   │   ├── verifyIntegrity(data: string, expectedSha: string): boolean
│   │   ├── resolveConflicts(rows: ValidRow[], strategy: Strategy): Resolved[]
│   │   └── transactionalWrite(resolved: Resolved[], tx: TxHandle): Promise<WriteReport>
│   └── migrate.ts
│       ├── migrate(fromV: number, toV: number, line: JsonlLine): JsonlLine
│       ├── migrations: Record<number, (line) => line>   // 1→2, 2→3, ...
│       └── MAX_SUPPORTED_SCHEMA_VERSION = <derived from app build>
├── export/
│   ├── ExcelExporter.ts
│   │   ├── exportExcel(opts: ExportOptions): Promise<ExportResult>
│   │   ├── streamStudentsToSheet(ws: Worksheet, period: Period): Promise<number>
│   │   ├── streamAttendanceToSheet(ws: Worksheet, period: Period): Promise<number>
│   │   └── streamPaymentsToSheet(ws: Worksheet, period: Period): Promise<number>
│   └── CsvExporter.ts
│       ├── exportCsv(opts: ExportOptions): Promise<ExportResult>
│       └── streamRowsToCsv(stream: RowStream, out: WritableStream): Promise<number>
├── import/
│   ├── ExcelImporter.ts
│   │   ├── importStudents(opts: ImportOptions): Promise<ImportResult>
│   │   ├── parseExcelRows(file: File): AsyncGenerator<StudentRow>
│   │   └── mapHeaders(headers: string[]): HeaderMap
│   ├── CsvImporter.ts
│   │   ├── importCsv(opts: ImportOptions): Promise<ImportResult>
│   │   └── parseCsvRows(file: File, delimiter: string): AsyncGenerator<StudentRow>
│   └── TemplateGenerator.ts
│       └── generateTemplate(): Promise<{filename: string, bytes: Uint8Array}>
├── shared/
│   ├── crypto.ts
│   │   ├── deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey>
│   │   ├── encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{nonce, tag, ciphertext}>
│   │   ├── decrypt(key: CryptoKey, nonce, tag, ciphertext): Promise<Uint8Array>
│   │   ├── sha256(data: string | Uint8Array): string  // hex
│   │   └── MAGIC = 'BSR1'  // 4-byte ASCII constant
│   ├── validators.ts
│   │   ├── StudentImportSchema: ZodSchema
│   │   ├── AttendanceExportSchema: ZodSchema
│   │   ├── PaymentExportSchema: ZodSchema
│   │   ├── TableSchemaMap: Record<TableName, ZodSchema>   // for restore validation
│   │   └── parseDate(input: string): string  // ISO or DD/MM/YYYY → ISO
│   └── progress.ts
│       ├── class ProgressEmitter extends EventTarget
│       ├── type ProgressEvent = {stage: Stage, pct: number, detail?: string}
│       └── const STAGES = ['collect','decode_wrapper','decrypt','untar','verify',
│                            'migrate','parse','dedup','write','finalize']
└── index.ts   // re-exports for Settings UI bindings
```

All functions are **pure with respect to side effects** — they take opts and return results, with progress emitted via the injected `ProgressEmitter`. This makes them trivially testable (inject a mock emitter, assert calls) and lets the UI swap a real progress bar for a test stub.

---

## 8. State Management

A dedicated Zustand slice — `useBackupStore` — governs subsystem state. It is consumed by the Settings UI (file pickers, progress toasts) and the cross-engine bus subscribers (audit log, toast system).

```ts
// src/stores/backup-store.ts
interface BackupState {
  // active operation
  inProgress: boolean;
  operationKind: 'backup' | 'restore' | 'export_excel' | 'export_csv' | 'import' | null;
  stage: Stage | null;
  progress: number;          // 0..100
  detail: string | null;     // "Writing 1,243 of 4,821 students..."

  // last result
  lastResult: BackupResult | RestoreResult | ExportResult | ImportResult | null;
  lastResultAt: string | null;

  // error (terminal)
  error: { code: ErrorCode; message: string; retryable: boolean } | null;

  // restore-specific
  pendingConflicts: ConflictPreview[] | null;   // shown in interstitial
  restoreStrategy: 'overwrite' | 'merge' | 'skip';

  // import-specific
  importPreview: ImportPreview | null;          // shown before commit
}
```

Actions: `start(kind)`, `setStage(stage, pct, detail)`, `setConflicts(previews)`, `setRestoreStrategy(s)`, `setImportPreview(p)`, `succeed(result)`, `fail(err)`, `reset()`.

The slice subscribes to the cross-engine bus (`02_Core_Logic.md` §8) on these events:

- **Emits** `BACKUP_CREATED` on success — subscribers: audit_log writer (defensive; the pipeline already wrote it), toast system, footer status (updates "last backup").
- **Emits** `EXPORT_REQUESTED` on Excel/CSV export — subscriber: toast system.
- **Emits** `LEDGER_MUTATED` and a new `STUDENTS_INVALIDATED` after a successful restore — subscribers: TanStack Query cache invalidation, Reminder Engine recompute, Search Engine FTS rebuild.
- **Listens** for `SYNC_COMPLETED` — if a sync landed new rows mid-backup, the backup continues (the snapshot is the start time; new rows are picked up on the next backup). Restore, however, **pauses sync** for the duration (advisory lock on the sync engine).

The store is **per-shell-instance** (not persisted to disk). If the user closes the tab mid-backup, the operation is aborted cleanly by the browser's normal async-cancellation; the partially-written temp file is GC'd on next app start (a sweep of `.buddysaradhi.tmp.*` files in the cache directory).

---

## 9. Database Operations

### 9.1 Export Queries (read-only, streamed)

All queries use libSQL prepared statements with the tenant_id bound from the JWT claim — never from user input (per `10_Security.md` §7). They stream via the libSQL cursor protocol; `fetch_size = 500` rows per network round-trip on web/Tauri; pure local cursor on mobile.

The three export queries are listed in §6.3. They use LEFT JOINs (so students with no enrollment or no ledger still appear) and exclude soft-deleted rows (`archived_at IS NULL`, `voided_at IS NULL`). The balance_due subquery is the BR-CALC-01 formula.

### 9.2 Restore Writes (transactional, FK-aware order)

The restore writes tables in **dependency order** so that FK constraints never fail mid-transaction:

```
RESTORE_ORDER = [
  'settings',          // singleton — UPSERT
  'app_state',         // singleton — UPSERT
  'batches',
  'students',
  'guardians',         // FK: students
  'student_enrollments', // FK: students, batches
  'tags',
  'student_tags',      // FK: students, tags
  'fee_plans',         // FK: students, batches
  'fee_schedule_items', // FK: fee_plans
  'invoices',          // FK: students, fee_schedule_items
  'ledger_entries',    // FK: students, invoices; APPEND-ONLY (INSERT OR IGNORE)
  'receipts',          // FK: ledger_entries, students, invoices
  'attendance_sessions', // FK: batches
  'attendance_records', // FK: attendance_sessions, students
  'reminders',         // FK: students/invoices/batches via ref_id (polymorphic)
  'notifications',
  'audit_log',         // APPEND-ONLY — INSERT OR IGNORE by id
  'sync_outbox',       // optional; usually skipped on restore (see §11)
]
```

Idempotency: every write is an **upsert by id** (`db.<model>.upsert({ where: { id }, create: { ... }, update: { ... } })`), except for `ledger_entries` and `audit_log` which use `db.<model>.createMany({ data, skipDuplicates: true })` — once a UUID-keyed ledger row exists, it is never modified (BR-LED-01/L02). This makes restore idempotent: running it twice yields the same DB.

FK-orphan handling: if a row's parent_id points to a row that does not exist in either the incoming set or the current DB, the row is **skipped and reported** (not inserted). This catches partially-corrupt backups. Example: a `receipt` whose `ledger_entry_id` was not in the backup — the receipt is skipped, the user is told.

### 9.3 Indexes Rebuilt

After restore, the FTS5 virtual tables (`students_fts`, `search_index`) are rebuilt by the dedicated `lib/search/rebuildFts.ts` helper. The helper issues a single `INSERT INTO <fts>(<fts>) VALUES('rebuild')` — this is a SQLite-level FTS5 admin command with no Prisma ORM equivalent; it runs ONCE per restore, not in any runtime hot path. It is fast (<500ms for 10k students) and necessary because FTS5 does not auto-rebuild from a bulk `createMany`.

---

## 10. Business Rules

This subsystem is governed by `12_Business_Rules.md` §9 (BR-BAT-01..B05) plus cross-cutting rules BR-STU-02, BR-STU-04, BR-LED-01/L02, BR-SYN-04, BR-SEC-02/04. Each is cited in code via `// @BR-Bxx` comments.

### 10.1 Backup Format — BR-BAT-01 (extended)

The `.buddysaradhi` file is a layered container:

```
.buddysaradhi = MAGIC(4) + FORMAT_VERSION(1) + SALT(16) + NONCE(12) + TAG(16) + CIPHERTEXT(var)
         where CIPHERTEXT = AES-256-GCM(key, nonce,
           gzip(
             tar(
               manifest.json,
               data.jsonl,
               schema_version.txt
             )
           )
         )
         and key = argon2id(passphrase, salt, {m:64MB, t:3, p:2})
```

**File layout (byte-exact):**

| Offset | Length | Field | Notes |
|--------|--------|-------|-------|
| 0 | 4 | `magic` | ASCII `BSR1` (`0x42 0x53 0x52 0x31`) |
| 4 | 1 | `format_version` | `0x01` (current) |
| 5 | 16 | `salt` | argon2id salt, random per file |
| 21 | 12 | `nonce` | AES-GCM nonce, random per file |
| 33 | 16 | `tag` | GCM authentication tag |
| 49 | … | `ciphertext` | gzipped tar of the three inner files |

**Inner file: `manifest.json`**

```json
{
  "format_version": 1,
  "tenant_id": "01HXY...",
  "created_at": "2025-08-14T18:32:11Z",
  "schema_version": 7,
  "app_version": "1.4.2",
  "currency_code": "INR",
  "row_counts": {
    "students": 1243,
    "attendance_records": 24108,
    "ledger_entries": 8721,
    "receipts": 3120,
    "...": "..."
  },
  "sha256_data": "9a3f...e1b2",
  "totals": {
    "balance_due_minor": 184500,
    "collected_this_month_minor": 124500
  }
}
```

The `totals` block is informational (derived from the data); it lets a user-facing restore preview say "This backup contains 1,243 students, ₹1.84L outstanding" before they commit.

**Inner file: `data.jsonl`**

Newline-delimited JSON, one row per line:

```jsonl
{"table":"settings","row":{"tenant_id":"01HXY...","institute_name":"...","currency_code":"INR",...}}
{"table":"batches","row":{"id":"01HXZ...","name":"Class 10 - Maths - 6pm","subject":"Maths",...}}
{"table":"students","row":{"id":"01HY0...","code":"STU-0001","first_name":"Riya",...}}
...
```

Order within `data.jsonl` follows `RESTORE_ORDER` (§9.2). Each line is independently parseable (no trailing commas, no multi-line JSON) so the parser can recover from a single corrupt line by skipping it.

**Inner file: `schema_version.txt`**

A single integer on one line (`7\n`). Redundant with `manifest.json.schema_version` but provides a fast pre-parse check before full JSON parsing.

### 10.2 Backup Integrity — BR-BAT-02

`manifest.sha256_data` is `sha256(data.jsonl)` over the **exact bytes** (including trailing newline). On restore, the hash is recomputed and compared **before** any row is written. A mismatch aborts with `E_CORRUPT` and writes `audit_log {action: 'backup_restore', status: 'corrupt'}`. The user is offered the option to retry from a different copy of the file.

### 10.3 Excel Export — BR-BAT-03 (exact columns)

Three worksheets, exact columns and order:

**Sheet 1 — "Students"** (frozen row 1, autofilter on all columns)

| # | Column | Source | Notes |
|---|--------|--------|-------|
| 1 | `code` | students.code | blank if none |
| 2 | `first_name` | students.first_name | |
| 3 | `last_name` | students.last_name | blank if none |
| 4 | `phone` | students.phone | E.164 or local format as stored |
| 5 | `email` | students.email | |
| 6 | `grade` | students.grade | "Class 10" |
| 7 | `school` | students.school | |
| 8 | `batch` | batches.name (via current enrollment) | comma-separated if multi-batch |
| 9 | `status` | students.status | `active`/`inactive`/`graduated`/`archived` |
| 10 | `fee_model` | students.fee_model | `postpaid`/`prepaid`/`mixed` |
| 11 | `admission_date` | students.admission_date | ISO date |
| 12 | `balance_due` | derived (BR-CALC-01) | decimal major units, currency-formatted |

**Sheet 2 — "Attendance"**

| # | Column | Source |
|---|--------|--------|
| 1 | `student_code` | students.code |
| 2 | `student_name` | first_name + ' ' + last_name |
| 3 | `date` | attendance_sessions.session_date (ISO) |
| 4 | `batch` | batches.name |
| 5 | `status` | attendance_records.status |
| 6 | `marked_at` | attendance_records.marked_at (ISO timestamp) |
| 7 | `session_locked` | `Y`/`N` from attendance_sessions.locked_at |

**Sheet 3 — "Payments"**

| # | Column | Source |
|---|--------|--------|
| 1 | `receipt_no` | receipts.number |
| 2 | `student_code` | students.code |
| 3 | `student_name` | first + last |
| 4 | `received_on` | receipts.received_on (ISO date) |
| 5 | `amount` | receipts.amount, formatted with currency symbol per `settings.currency_code` |
| 6 | `method` | receipts.payment_method |
| 7 | `reference` | receipts.payment_ref (UTR/cheque no.) |
| 8 | `invoice_no` | invoices.number (blank if no linked invoice) |
| 9 | `invoice_status` | invoices.status (blank if no linked invoice) |

Filename: `Buddysaradhi_Export_<YYYYMMDD>.xlsx` (e.g., `Buddysaradhi_Export_20250815.xlsx`). Multiple exports on the same day get a `-2`, `-3` suffix to avoid overwriting.

### 10.4 Import Template — BR-BAT-04

The downloadable template is generated by `TemplateGenerator.ts` and contains four sheets:

1. **"Read me"** — rules sheet:
   - Date format: `DD/MM/YYYY` or ISO `YYYY-MM-DD`.
   - Status vocab: `active | inactive | graduated | archived`.
   - Fee model vocab: `postpaid | prepaid | mixed`.
   - Phone: optional; if present, must be 10 digits (IN) or `+<cc><number>`.
   - `code` column: leave blank to auto-generate as `STU-<seq>` (BR-STU-04).
   - `batch` column: use an existing batch name; new names will be created on import (with confirmation).
   - `balance_due` column: ignored on import (read-only field on Students sheet — derived from ledger).
2. **"Students"** — headers row 1 + one example row 2 (a fictional "Aarav Sharma").
3. **"Attendance"** — headers + example (read-only; importing attendance is v1.x).
4. **"Payments"** — headers + example (read-only; importing payments is v1.x).

The example rows are clearly marked with a comment: "← Example row. Delete before importing."

### 10.5 No Backend Storage — BR-BAT-05

Backups are **never** uploaded. The "cloud copy" of a tutor's data is their Turso DB itself (synced via the Sync Engine). The `.buddysaradhi` file is a user-controlled offline artefact. This is enforced structurally: no API route exists for backup upload; the Supabase Edge Functions have no `/backup` endpoint; the CSP `connect-src` does not include any backup-related domain. A PR adding such an endpoint would be rejected by review.

### 10.6 Cross-Cutting Business Rules

- **BR-STU-02 (Duplicate Detection)** — applied during import: `dup_key = lower(first_name + last_name + phone_last4)`. Matches are surfaced in the preview interstitial; the user chooses Skip / Merge / Both per duplicate or for all.
- **BR-STU-04 (Code Auto-Generation)** — if `code` is blank on an imported row, the importer assigns `STU-<next_seq>` from the per-tenant counter. Sequence increments atomically inside the import transaction.
- **BR-LED-01/L02 (Ledger Immutability)** — restore writes ledger rows with `INSERT OR IGNORE` only. A backup containing a row that conflicts with an existing ledger row (same id, different content) is a **red flag**: the restore refuses that row, logs it as `E_LEDGER_INTEGRITY_VIOLATION`, and continues. The user is told explicitly. We never silently overwrite a ledger row.
- **BR-SYN-04 (Schema Drift)** — if the backup's `schema_version` is higher than the app supports, restore aborts with `E_SCHEMA_AHEAD` and prompts the user to update the app. If lower, the migrator runs forward (§10.7).
- **BR-SEC-02 / BR-SEC-04** — full backup creation and full restore require PIN + typed "EXPORT"/"RESTORE". Monthly Excel export does not (it is a derived view, not the full PII set). Bulk import of >100 rows requires PIN.

### 10.7 Version Migration

Migrations are forward-only (per `11_Data_Model.md` §7). Each migration is a pure function on a JSONL line:

```ts
// src/features/data/backup/migrate.ts
const migrations: Record<number, (line: JsonlLine) => JsonlLine> = {
  1: (line) => line,  // no-op baseline
  2: (line) => {
    if (line.table === 'students' && !line.row.code) {
      // v2 introduced auto-gen code; backfill if missing
      return {...line, row: {...line.row, code: null}};
    }
    return line;
  },
  3: (line) => {
    if (line.table === 'ledger_entries') {
      // v3 renamed payment_method enum value 'upi-int' → 'upi'
      if (line.row.payment_method === 'upi-int') {
        return {...line, row: {...line.row, payment_method: 'upi'}};
      }
    }
    return line;
  },
  // ... one entry per schema bump
};

export function migrate(fromV: number, toV: number, line: JsonlLine): JsonlLine {
  let l = line;
  for (let v = fromV + 1; v <= toV; v++) {
    l = migrations[v](l);
  }
  return l;
}
```

Migrations are **idempotent** (running migrate(3, 5, line) twice yields the same output). They never touch the live DB — they transform the JSONL stream in memory before the transactional write. The `audit_log` records the migration path: `metadata: {from: 3, to: 7, path: [4,5,6,7]}`.

---

## 11. Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| **Backup interrupted (app killed, power loss)** | The pipeline writes to a temp file `Buddysaradhi_Backup_<ts>.buddysaradhi.tmp` and renames atomically on success. An interrupted backup leaves a `.tmp` file; on next app start, a sweep GCs `.buddysaradhi.tmp.*` files older than 24h. No partial `.buddysaradhi` is ever produced. |
| **Corrupted file (sha256 mismatch)** | `E_CORRUPT` — abort before any DB write. Audit-logged. User offered retry from a different copy. |
| **Wrong passphrase** | AES-GCM auth tag verification fails → `E_WRONG_PASSPHRASE`. Three attempts allowed, then 60s lockout per file. After 3 lockouts in a session, restore is disabled until app restart. Audit-logged each attempt. |
| **Schema newer than app** (`file_schema > app_schema`) | `E_SCHEMA_AHEAD` — refuse restore, show "This backup was made by Buddysaradhi v2.x. Please update your app." Do not attempt backward migration (we are forward-only). |
| **Schema older than app** (`file_schema < app_schema`) | Auto-migrate forward (§10.7). Migration path is logged. If a migration is missing for some step (shouldn't happen — CI enforces), abort with `E_MIGRATION_GAP`. |
| **Duplicate students on import** | `dup_key` matches existing student → shown in preview interstitial. User picks Skip/Merge/Both. Never auto-merge (BR-STU-02). |
| **FK orphan on restore** (e.g., receipt with no ledger entry) | Row skipped, added to `skipped[]` report. Restore continues. User told in the post-restore report. |
| **Huge DB (>50k rows)** | Streaming is mandatory: `data.jsonl` is never fully held in memory. The collector streams rows in 500-row batches; the parser yields row-by-row; the writer commits in 1000-row sub-transactions within the outer transaction (to keep the WAL bounded). Progress bar reflects actual throughput. Tested up to 100k students in CI. |
| **Import file with wrong sheet name** | `E_TEMPLATE_MISMATCH` — abort. User told to download the template. (Loose header mapping is allowed within the "Students" sheet, but the sheet must be named "Students".) |
| **Import with all rows invalid** | Commit succeeds with 0 writes. Toast: "0 students imported. 47 rows invalid. Download error report." Audit log: `action: 'import_students', status: 'no_valid_rows'`. |
| **Restore on a non-empty DB** | Strategy governs: `overwrite` replaces (UPSERT), `merge` merges non-nulls, `skip` leaves existing rows untouched. Default strategy is `merge` (safest). User must confirm strategy if any conflicts detected. |
| **Restore mid-sync** | Sync engine is paused (advisory lock) for the duration. Pending outbox rows are preserved. Sync resumes after restore commits. |
| **sync_outbox in backup** | Restoring `sync_outbox` would re-send already-applied mutations. The restore **skips** `sync_outbox` rows by default (they are re-derived from the restored data). A `--include-outbox` flag exists for expert use. |
| **Passphrase lost** | Unrecoverable. The UI states this clearly at backup time: "If you forget this, we cannot recover your data." There is no passphrase-reset flow. The Turso Cloud DB remains the user's online recovery path (if they still have Supabase access). |
| **App version downgrade after restore** | If a higher-schema backup was migrated down by an older app... wait, we are forward-only. If the user reinstalls an older app version after a higher-schema backup was migrated to their current app, the older app refuses to render (`schema_version > MAX_SUPPORTED_SCHEMA`). The fix is to reinstall the newer app. |

---

## 12. Offline Behaviour

The entire subsystem is offline-first by design (Principle 5). Specifically:

- **No network call in the critical path** of any pipeline. Crypto is local (Web Crypto / `expo-crypto` / Rust `ring`). Excel writing is local (`exceljs` in JS, `calamine`-style in Rust on desktop). Parsing is local.
- **No "checking with server"** before backup/restore. The Turso DB is the local SQLite/embedded replica; all reads are local.
- **Sync is paused** during restore (advisory lock) to avoid write-write contention. Sync resumes automatically on restore completion.
- **Import does not require sync** — imported students land in the local DB and join the sync outbox normally; they sync to Turso Cloud when next online.
- **Excel export** is independent of sync state. A tutor can export to Excel from a stale local DB; the file reflects local truth at export time.

The only network-aware aspect is the audit log: on web, audit_log writes go to the local cache and flush to Turso on next sync; on mobile/desktop, they write to the local SQLite immediately. Neither blocks the user.

---

## 13. Sync Behaviour

| Operation | Sync interaction |
|-----------|------------------|
| **Backup create** | None. Backup reads a consistent snapshot via a read transaction (`BEGIN ... COMMIT` with `ISOLATION LEVEL SNAPSHOT` semantics in libSQL). Sync may continue in the background; the backup reflects the state at the moment the read transaction started. |
| **Backup restore** | Sync **paused** (advisory lock with 5-min timeout). Pending outbox rows preserved. On restore commit, sync resumes; the next sync round pushes the restored rows to Turso Cloud. If sync is mid-flight when restore starts, restore waits up to 5s for it to settle, then proceeds. |
| **Excel export** | None. Read-only. |
| **CSV export** | None. Read-only. |
| **Import** | None during the import transaction. Imported rows join the sync outbox normally; they sync to Turso Cloud when next online. |
| **Template download** | None. Pure local file generation. |

Conflict on restored rows reaching Turso: the restored rows have the same UUIDs as the originals, so Turso's LWW logic sees them as identical (or newer by `updated_at`) — no conflict, no data loss. Ledger entries are conflict-immune (BR-SYN-02).

---

## 14. Validation Rules

All validation uses Zod schemas in `packages/shared/validators.ts`. Restore validation uses the full per-table schemas (matching the data model); import validation uses the more lenient import schemas (which auto-coerce dates, amounts, and enums).

### 14.1 StudentImportSchema (used by Excel/CSV import)

```ts
const StudentImportSchema = z.object({
  code: z.string().trim().optional().nullable(),
  first_name: z.string().trim().min(1, 'First name required').max(80),
  last_name: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().regex(/^(\+?\d{10,15})?$/, 'Phone must be 10-15 digits').optional().nullable(),
  email: z.string().trim().email('Invalid email').optional().nullable(),
  grade: z.string().trim().max(40).optional().nullable(),
  school: z.string().trim().max(120).optional().nullable(),
  batch: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['active','inactive','graduated','archived']).default('active'),
  fee_model: z.enum(['postpaid','prepaid','mixed']).default('postpaid'),
  admission_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                           z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
                           z.null()]).transform(parseDate).default(() => todayISO()),
  // balance_due is read on the Students sheet of the template but ignored on import
  balance_due: z.any().optional(),
});
```

### 14.2 Date formats

- ISO `YYYY-MM-DD` (preferred).
- `DD/MM/YYYY` (template-specified; common in India).
- `MM/DD/YYYY` is **not** accepted (ambiguous); the parser detects this format and rejects it with a clear message: "Use DD/MM/YYYY or YYYY-MM-DD."
- Date-times (e.g., `marked_at`) are ISO 8601 with timezone, or local naive (interpreted as the tenant's locale timezone).

### 14.3 Amounts

- Excel/CSV import does not accept payment rows (students only in v1).
- On the **export** side, amounts are written as decimal major units with the currency symbol prefixed: `₹ 1,24,500.00` for INR, `$1,245.00` for USD. The cell format is set to text (not number) to preserve the symbol; an additional numeric column is not provided (accountants can parse the string).
- Internal storage remains integer minor units (BR-M-01) — export formats convert at write time.

### 14.4 Status enums

Strictly validated against the data-model CHECK constraints. A typo (`'Active'` vs `'active'`) is rejected with the row added to `invalid[]` and the error `"status must be one of: active, inactive, graduated, archived"`.

### 14.5 Phone pattern

Optional, but if present must match `/^(\+?\d{10,15})?$/`. Non-digit characters (spaces, dashes, parens) are stripped before validation, then re-validated. The cleaned form is stored.

### 14.6 Duplicate handling (dup_key)

Per BR-STU-02: `dup_key = lower(trim(first_name) + trim(last_name) + last4(phone))`. If phone is blank, `last4` is empty — duplicates are detected only by name match (which is more permissive). The interstitial always shows the matching existing student's full record so the user can decide confidently.

### 14.7 Restore validation (per-table)

Restore uses the full per-table Zod schemas (mirroring `11_Data_Model.md` exactly). A row that fails (e.g., a `ledger_entries` row with `direction='charge'` and `amount=-500`, violating BR-M-03) is added to `errors[]` and **not written**. The restore continues; the user sees a report of N invalid rows at the end.

---

## 15. Security Rules

This subsystem is the primary exfiltration vector for a tutor's data. Security is therefore layered.

### 15.1 Passphrase

- **Length:** ≥ 12 characters recommended. Complexity (mixed case, digits, symbols) is *encouraged* via a strength meter but not *enforced*. We trust the user with their own password policy; we protect the key, not their habits (Principle 10 + `10_Security.md` §13).
- **Storage:** never persisted. The derived key is held in memory only for the duration of the encrypt/decrypt operation, then zeroed (JS `crypto.subtle` does not expose zeroing, but the key object is dropped from scope and GC'd; on Rust desktop, explicit `zeroize`).
- **Loss:** unrecoverable. UI states this clearly. No backdoor, no escrow, no admin override.

### 15.2 Key derivation — argon2id

Parameters (per `10_Security.md` §13):
- `memory = 64 MiB` (65536 KiB) — memory-hard, defends against GPU/ASIC attacks.
- `iterations = 3` — time cost.
- `parallelism = 2` — uses 2 lanes (matches typical mobile CPU big-cores).
- `salt = 16 random bytes` per file (prepended in the file header).

The 64 MiB memory cost means derivation takes ~300-500ms on a mid-range device — a deliberate speed bump that makes brute-force expensive without making legitimate use painful.

### 15.3 Encryption — AES-256-GCM

- 256-bit key from argon2id.
- 96-bit random nonce per file (prepended).
- 128-bit GCM authentication tag (prepended after nonce).
- GCM provides both confidentiality and integrity — a tampered file fails decryption (auth tag mismatch) before any data is parsed.

### 15.4 Sensitive-mutation gating (BR-SEC-02 / BR-SEC-04)

| Operation | PIN required? | Typed confirm? | Audit log action |
|-----------|:-------------:|:---------------:|------------------|
| Full backup create (`.buddysaradhi`) | Yes | Type `EXPORT` | `export_full` |
| Restore backup | Yes | Type `RESTORE` | `backup_restore` |
| Monthly Excel export | No | No | `export_excel` |
| CSV export | No | No | `export_csv` |
| Import students (≤100 rows) | No | No | `import_students` |
| Import students (>100 rows) | Yes | No | `import_students` |
| Download template | No | No | (none — it's a static template) |

The typed confirm is a single inline input in the dialog, button disabled until match (per `13_UI_Guidelines.md` §11). It is not a "are you sure" double-confirmation — it is a deliberate, focused act.

### 15.5 Audit log entries

Every operation writes `audit_log` **before** the mutation (fail-closed: if the audit write fails, the mutation is blocked). Entries:

- `backup_create` — metadata: `{filename, bytes, sha256_data, row_counts, schema_version}`
- `backup_restore` — metadata: `{filename, rows_written, conflicts, skipped, errors, migration_path}`
- `export_excel` — metadata: `{filename, bytes, sheet_counts, period_filter}`
- `export_full` — metadata: `{filename, bytes, sha256_data}` (only for full backups)
- `import_students` — metadata: `{source_filename, created, merged, skipped, invalid}`

Audit log entries are themselves included in backups (they are part of `data.jsonl`) and are append-only on restore (INSERT OR IGNORE).

### 15.6 Malicious-file defence

- Excel/CSV imports are parsed with **sandboxed parsers** (`exceljs` does not execute Excel formulas; CSV is parsed as plain text).
- File size cap: 50 MB per import file (rejects larger with `E_FILE_TOO_LARGE`).
- Row cap: 50,000 rows per import (rejects larger — split the file).
- Cell content cap: 4 KB per cell (rejects pathological cells).
- The Excel parser does **not** load macros (`xlsx` format with macros `.xlsm` is rejected outright; only `.xlsx` accepted).

---

## 16. Error Handling

Errors are typed, recoverable where possible, and always user-visible (never silent).

### 16.1 Error codes

| Code | Meaning | Recoverable? | User-facing message |
|------|---------|:--------------|---------------------|
| `E_BAD_MAGIC` | File is not a `.buddysaradhi` (wrong magic bytes) | No | "This is not a Buddysaradhi backup file." |
| `E_VERSION_AHEAD` | File format_version > supported | No (update app) | "This backup was made by a newer Buddysaradhi. Please update the app." |
| `E_WRONG_PASSPHRASE` | GCM auth tag failed | Yes (3 attempts) | "Wrong passphrase. N attempts remaining." |
| `E_PASSPHRASE_LOCKOUT` | 3 failed attempts → 60s lockout | Yes (wait) | "Too many attempts. Try again in 60s." |
| `E_CORRUPT` | sha256 mismatch | No (try different copy) | "This backup file is corrupted. The data doesn't match its checksum." |
| `E_SCHEMA_AHEAD` | file schema_version > app schema_version | No (update app) | "This backup uses a newer database schema. Please update the app." |
| `E_MIGRATION_GAP` | A migration step is missing | No (bug) | "Cannot migrate from schema N. Please contact support." |
| `E_LEDGER_INTEGRITY_VIOLATION` | Backup row conflicts with existing ledger row | Yes (skip row) | "Skipped 1 ledger row that conflicts with existing data. See report." |
| `E_FK_ORPHAN` | Row's parent_id missing | Yes (skip row) | "Skipped N rows with missing references. See report." |
| `E_TEMPLATE_MISMATCH` | Import sheet name wrong | Yes (fix file) | "Sheet 'Students' not found. Download the template for the correct format." |
| `E_FILE_TOO_LARGE` | Import > 50 MB | Yes (split file) | "File too large. Split into files under 50 MB." |
| `E_ROW_CAP_EXCEEDED` | Import > 50k rows | Yes (split file) | "Too many rows. Split into files under 50,000 rows." |
| `E_DISK_FULL` | Atomic write fails | Yes (free space) | "Not enough disk space. Free up N MB and try again." |
| `E_TX_FAILED` | Transactional write rolled back | Yes (retry) | "Restore failed midway. Your data is unchanged. Try again." |

### 16.2 Error reporting

- **Terminal errors** (`E_BAD_MAGIC`, `E_CORRUPT`, `E_SCHEMA_AHEAD`): toast (flare, persistent) + inline message in the restore dialog. No retry button on unrecoverable; "Try different file" on `E_CORRUPT`.
- **Recoverable errors** (`E_WRONG_PASSPHRASE`, `E_PASSPHRASE_LOCKOUT`): inline message, retry button enabled.
- **Partial-success errors** (`E_FK_ORPHAN`, `E_LEDGER_INTEGRITY_VIOLATION`): restore completes with skipped rows; post-restore report lists every skipped row with reason. Downloadable as `.csv`.
- **Import errors**: every invalid row is collected with `{row_number, field, message}`. Post-import, an "Download error report (.xlsx)" button writes the original rows + an `errors` column. The user fixes the file and re-imports.

### 16.3 Transactional guarantees

Restore and import writes are wrapped in a single transaction. If any **hard** error occurs (DB corruption, disk full), the transaction rolls back and the DB is unchanged. Partial-success cases (skipped rows) are **not** hard errors — the transaction commits with the valid rows and the skipped rows are reported.

The pre-restore snapshot (`Buddysaradhi_PreRestore_<ts>.buddysaradhi`) is an additional safety net: if the user is unhappy with the restore result, they can re-restore from the snapshot. The snapshot uses the same passphrase as the user's current session (or a freshly prompted one if no session passphrase is available).

---

## 17. Performance Targets

| Operation | Target | Hard ceiling | Notes |
|-----------|--------|:------------:|-------|
| Backup create (1k students) | < 2s | 5s | Dominated by argon2id (~400ms) + gzip (~500ms) + stream reads |
| Backup create (10k students) | < 5s | 10s | Streaming; memory bounded to ~50 MB |
| Backup create (50k students) | < 15s | 30s | Memory bounded; WAL checkpoint may add latency |
| Restore (1k students) | < 3s | 8s | Includes argon2id + ungzip + parse + write |
| Restore (10k students) | < 10s | 25s | Sub-transactions of 1k rows keep WAL bounded |
| Excel export (1k rows) | < 1.5s | 4s | Three parallel streams |
| Excel export (10k rows) | < 8s | 15s | Streaming exceljs writer |
| Excel export (50k rows) | < 30s | 60s | Memory bounded to ~100 MB |
| CSV export (10k rows) | < 1s | 3s | Trivial format |
| Import (1k rows) | < 3s | 6s | Parse + validate + dedup + write |
| Import (10k rows) | < 15s | 30s | Includes dedup query (indexed on dup_key) |
| Template download | < 500ms | 1s | Static file generation |
| Argon2id key derivation | < 500ms | 1s | 64 MiB memory cost — deliberate |

**Memory bounds:** no pipeline ever holds the full DB in memory. The collector streams rows in 500-row batches; the parser yields row-by-row; the writer commits in 1000-row sub-transactions. Peak memory for a 50k-student backup is ~80 MB (gzip buffer + tar buffer + current batch). This is enforced by CI tests that run pipelines on 100k-row fixtures with `--max-old-space-size=256` and assert no OOM.

**CPU:** argon2id and AES-GCM run on the main thread on web (Web Crypto is async but blocks the event loop briefly). On mobile/desktop they run on a native background thread. The progress bar updates between batches so the UI never appears frozen.

---

## 18. Accessibility

The Backup & Import/Export **UI surfaces** (in `08_Settings.md`) follow `13_UI_Guidelines.md` §8. The subsystem-specific concerns:

- **Progress bars** announce stage + percentage via `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-label="Backup progress: 45%, writing students"`. The `aria-live="polite"` region announces stage transitions ("Decrypting…", "Verifying…", "Done.").
- **File pickers** are native OS pickers (mobile: share sheet / document picker; desktop: Tauri dialog; web: `<input type="file">`). They are keyboard-accessible (Enter triggers, Esc cancels).
- **Typed-confirm inputs** have `aria-describedby` pointing to the instruction text ("Type RESTORE to confirm"). The confirm button's `disabled` state is announced.
- **Error reports** (post-import `.xlsx` with invalid rows) are also downloadable as `.csv` for screen-reader users who prefer plain text.
- **Passphrase input** has `type="password"` with a show/hide toggle (eye icon, `aria-label="Show passphrase"`). The strength meter has `role="meter"` and `aria-valuenow` reflecting strength 0-100.
- **Color-blind safety**: progress bar fill is emerald (success) but the percentage text is always shown numerically — never color alone. Error states pair the flare color with an `X` icon and text.

---

## 19. Testing Requirements

The subsystem has the highest test burden in the codebase because it touches every table and is the user's disaster-recovery path. Tests live in `src/features/data/__tests__/`.

### 19.1 Unit tests

- `crypto.ts`: round-trip encrypt→decrypt; wrong passphrase fails; tampered ciphertext fails; salt/nonce uniqueness across 1000 invocations.
- `migrate.ts`: each migration step tested with a fixture line; migrate(1, 7, line) produces the expected v7 shape; idempotency (migrate twice = migrate once).
- `validators.ts`: each schema with valid/invalid fixtures; date format coercion; phone cleaning; enum rejection.
- `TemplateGenerator.ts`: generated template has all four sheets, correct headers, example row marked.

### 19.2 Integration tests (against a real libSQL in-memory DB)

- **Backup round-trip:** seed DB → backup → wipe DB → restore → assert DB identical (row counts + spot-check rows).
- **Restore with conflicts:** seed DB → backup → modify some rows in DB → restore with each strategy (overwrite/merge/skip) → assert expected merged state.
- **Schema migration:** seed DB at schema v3 → bump app to v7 → backup at v3 → restore → assert migrations applied.
- **FK orphan:** backup with a manually-deleted parent row → restore → assert row skipped, reported.
- **Ledger integrity:** backup with a ledger row that conflicts with existing → restore → assert row refused with `E_LEDGER_INTEGRITY_VIOLATION`.
- **Excel export:** seed DB → export → parse the .xlsx with `exceljs` → assert three sheets, correct columns, row counts match.
- **Excel import:** seed DB → generate template → fill with test rows (some valid, some invalid, some duplicates) → import → assert correct counts in result.

### 19.3 Performance tests (CI)

- Backup 10k students < 5s (assert wall-clock).
- Export 10k rows .xlsx < 8s.
- Import 1k rows < 3s.
- All three run with `--max-old-space-size=256` to assert memory bounds.

### 19.4 Chaos tests

- **Kill mid-backup:** start backup, kill process at 50% → assert no `.buddysaradhi` file written (only `.tmp`), temp file GC'd on restart.
- **Kill mid-restore:** start restore, kill at 50% → assert DB unchanged (transaction rolled back).
- **Corrupt backup file:** flip a random byte in a `.buddysaradhi` → assert `E_CORRUPT` on restore.
- **Wrong passphrase 4x:** assert 60s lockout after 3 failures; 4th attempt refused during lockout.

### 19.5 Recovery walkthrough test (the user story)

An end-to-end test that mirrors §4: provision fresh tenant → seed 84 students → backup → spin up a fresh tenant (simulating new device) → restore → assert all 84 students + ledger + attendance present and identical. This test runs on every PR touching this subsystem.

---

## 20. Future Extensions

These are explicitly **out of scope for v1** (per `00_Vision.md` §6 and `01_Product_Principles.md` P2 discipline). They are tracked for v1.x/v2:

- **Import attendance and payments from Excel.** v1 imports students only; v1.x will add attendance import (with FK validation against existing students + sessions) and payment import (with full ledger grammar validation — every imported payment becomes a `PAYMENT_RECEIVED` + `receipts` row, sequenced per BR-RC-01).
- **Cloud backup storage (optional, opt-in).** A "Send a copy to my Buddysaradhi vault" feature that uploads an encrypted `.buddysaradhi` to a Buddysaradhi-managed bucket (still encrypted with the user's passphrase; we never see plaintext). This is a convenience, not a replacement for local backups. BR-BAT-05 is amended to allow opt-in cloud, never default.
- **Incremental backups.** A `.buddysaradhi.delta` format that stores only rows changed since the last full backup. Reduces backup size for 50k+ row tenants from ~5 MB to ~200 KB. v1.x.
- **Backup scheduling.** A "Remind me to back up weekly" notification (no auto-backup — we never want a background process holding the user's passphrase). v1.x.
- **Multi-tenant merge.** For "Academy Vikram" persona (300-1k students, multi-branch): merge two `.buddysaradhi` backups from different tenants into one. Requires tenant_id remapping. v2.
- **Backup to USB auto-detect.** On desktop, detect a freshly-inserted USB drive and offer "Back up to this drive?". v1.x.
- **Open format publication.** Publish the `.buddysaradhi` format spec + a reference Rust decoder on GitHub, so third parties can build tools. v1.x (after format stabilises post-launch).
- **End-to-end-encrypted backup sharing.** Share a `.buddysaradhi` with an accountant via a one-time link, encrypted with a separate "share passphrase" derived from a one-time code. v2.

---

### Recovery Process Walkthrough (canonical reference)

This is the script the subsystem is built to support, end-to-end:

1. **Fresh device.** Tutor installs Buddysaradhi (web/mobile/desktop).
2. **Signup.** Tutors signs in with the same Supabase account (email/Google) used on the old device. Supabase webhook fires `provision-db` — but wait, the user already has a Turso DB from the old device. The Edge Function is idempotent: it checks for an existing `buddysaradhi-{user_uuid}` database and skips creation if it exists. The client reads the existing `db_url + db_token` from `user_metadata`.
3. **Empty state.** The client connects to the existing Turso DB. Because it is a fresh device with no local cache, the client pulls the cloud DB state — but the cloud DB may be empty if the old device never synced (e.g., laptop died before last sync). The dashboard shows the empty state.
4. **Settings → Backup & Data → Restore backup.** Tutor picks `Buddysaradhi_Backup_<ts>.buddysaradhi` from their pen-drive/cloud storage.
5. **Passphrase.** Tutor types the passphrase they wrote down. (If forgotten: the cloud DB is the only fallback. If the cloud DB is also empty: data is lost. This is why the UI nags about backups and passphrase storage.)
6. **Typed "RESTORE".** Tutor types `RESTORE` to confirm. PIN entry if not already unlocked.
7. **Progress.** Progress bar fills: *Decrypting (15%) → Verifying integrity (30%) → Migrating schema (40%) → Parsing (50%) → Writing students (60%) → Writing ledger (80%) → Rebuilding indexes (95%) → Done.*
8. **Conflict interstitial (if any).** If the cloud DB had partial data, conflicts are shown. Tutor picks strategy (default: merge) and confirms.
9. **Done.** Dashboard re-renders with all students, today's attendance pending, ledger intact. Footer: "Last sync: just now · Last backup: <ts>."
10. **Audit.** `audit_log` records the full restore: rows written, conflicts, migration path. The pre-restore snapshot (`Buddysaradhi_PreRestore_<ts>.buddysaradhi`) is offered for download as a safety net.

Total time from install to "done": under 60 seconds for a 1,000-student tenant. This is the subsystem's north star.

---

## 21. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Backup & Import/Export doc. The mockups here are **envelope anatomy, pipeline flows, and import-mapping trees**, with UI surfaces (modals, progress bars, toasts) annotated inline. Glass tiers (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) and neumorphic recipes (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) annotated. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only.

### 21.1 Design System Reference — Backup & Import/Export

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces on this subsystem | Tier | Cross-ref |
|---|---|---|
| Backup-create modal (PIN + typed `EXPORT` + passphrase) | `glass-strong` + backdrop | §5.5, §8.7 |
| Backup-restore modal (triple gate + progress bar) | `glass-strong` + backdrop | §5.5, §8.7 |
| Conflict interstitial (strategy picker) | `glass-strong` + backdrop | §5.5, §8.7 |
| Progress bar | `glass-faint` track + emerald fill (or amber if migrating) | §5.5, §8.13 |
| Toast (backup complete / restore complete / wrong passphrase) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| CSV-import preview table | `glass-faint` rows | §5.5, §8.4 |
| Empty-state card (no backup yet) | `glass` centered | §5.5, §8.19 |

| Neumorphic controls on this subsystem | Recipe | Cross-ref |
|---|---|---|
| Passphrase input field | `neumo-inset` well | §6.6, §8.9 |
| Typed-confirmation input (`EXPORT` / `RESTORE`) | `neumo-inset` well (case-sensitive) | §6.6, §8.9 |
| PIN pad (unlock before backup/restore) | `neumo-raised` digits; press = `neumo-pressed` | §6.6, §8.2 |
| "Back up now" primary button | `neumo-raised` (emerald glow) | §6.6, §8.2 |
| "Restore" primary button | `neumo-raised` (emerald glow); blocked state = `neumo-raised` flat | §6.6, §8.2 |
| "Cancel" / "Skip" secondary buttons | `neumo-raised` secondary | §6.6, §8.2 |
| Conflict-strategy segmented control | `neumo-inset` well; active option = `neumo-raised` pill | §6.6, §8.5 |
| CSV column-mapping dropdowns | `neumo-inset` tray + `neumo-raised` chevron | §6.6, §8.9 |
| File picker trigger | `neumo-raised` | §6.6, §8.2 |

> **References:** RFC 8439 — *ChaCha20-Poly1305 / AES-GCM* (the AES-256-GCM choice for the `.buddysaradhi` envelope); RFC 9100 — *Argon2 Password Hashing* (the KDF params m=64MiB t=3 p=4); OWASP — *Cryptographic Storage Cheat Sheet*; Martin Kleppmann — *Designing Data-Intensive Applications* (the streaming + idempotent UPSERT pattern); Smashing Magazine — *Designing Better Confirmations* (typed-confirm pattern); Apple HIG — *File Handling* (the OS share/save sheet integration); Material Design 3 — *Progress Indicators*; Nielsen Norman Group — *Progress Indicators*.

### 21.2 Mockup B1 — .buddysaradhi Crypto Envelope Anatomy

```
.BUDDYSARADHI ENVELOPE — AES-256-GCM + Argon2id (RFC 8439 + RFC 9100)

   file layout (byte offsets from start of file):
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  offset  size   field                notes                                  │
   ├──────────────────────────────────────────────────────────────────────────────┤
   │  0       4B     magic                ASCII "BSR1" (file signature)          │
   │  4       1B     format_version       currently 1 (bump on breaking changes) │
   │  5       16B    salt                 random per file; feeds argon2id        │
   │  21      12B    nonce / iv           AES-GCM nonce (96-bit per RFC 8439)    │
   │  33      16B    tag                  GCM authentication tag                 │
   │  49      var    ciphertext           AES-256-GCM(ciphertext of gzipped tar) │
   │              ─────                                                      ── │
   │                                                                       total │
   │              = 49 bytes header + len(gzipped tar of manifest+data+schema)   │
   └──────────────────────────────────────────────────────────────────────────────┘

        │
        ▼   key derivation (never persisted; computed in-memory at decrypt time)

   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  argon2id(passphrase, salt, params={m:64MiB, t:3, p:4})                     │
   │  → 32-byte AES key (lives in memory ≤ duration of decrypt; then zeroed)     │
   │                                                                              │
   │  ↑ m=64MiB  memory cost — defeats GPU brute-force                            │
   │  ↑ t=3      time cost — 3 passes over memory                                 │
   │  ↑ p=4      parallelism — 4 lanes (matches modern mobile CPU big cores)     │
   │  ↑ RFC 9100 canonical params; supersedes RFC 9106                            │
   └──────────────────────────────────────────────────────────────────────────────┘

        │
        ▼   ciphertext = AES-256-GCM(key, nonce, plaintext)

   plaintext (after AES-GCM decrypt):
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  gzipped tar containing:                                                    │
   │    ├── manifest.json         (sha256_data, row_counts, schema_version, …)   │
   │    ├── data.jsonl            (streaming JSONL of business-table rows)        │
   │    └── schema_version.txt    (the SQLite PRAGMA user_version of the source — │
   │                                 an admin-level integer, not a runtime query)  │
   │                                                                              │
   │  ↑ sha256_data is computed over the JSONL plaintext BEFORE encryption        │
   │    so restore can verify integrity post-decrypt (step 5 of pipeline B)       │
   └──────────────────────────────────────────────────────────────────────────────┘

   file naming: Buddysaradhi_Backup_<YYYYMMDDHHmm>.buddysaradhi
                Buddysaradhi_PreRestore_<YYYYMMDDHHmm>.buddysaradhi  (safety-net snapshot)
   ↑ atomic write: temp file + rename — never a half-written .buddysaradhi on disk
   ↑ the file is the tutor's property; we have NO vendor-side copy (P10, AP-7)
   ↑ passphrase is NEVER persisted; only the argon2id hash of the onboarding
     passphrase hint (encrypted with the PIN-derived key) is stored locally
     so the "did you mean to type X?" hint can fire on restore attempts.
```

- ↑ **Argon2id params are tunable, not hardcoded.** The format records them in `manifest.json` so future restores can re-derive with the params the file was created with (forward/backward compatibility).
- ↑ **AES-GCM, not AES-CBC.** The GCM auth tag detects tampering — a byte-flipped ciphertext aborts at step 3 of pipeline B (`E_WRONG_PASSPHRASE` masks `E_CORRUPT` to avoid leaking whether the passphrase was wrong vs. the file was tampered with).
- ↑ **No vendor-side copy.** Even the optional v1.x cloud backup (§20 future extension) uploads the *encrypted* `.buddysaradhi` to a Buddysaradhi-managed bucket — we never see plaintext (BR-BAT-05, amended for opt-in cloud, never default).

### 21.3 Mockup B2 — Backup-Create Flow (Pipeline A)

```
BACKUP-CREATE PIPELINE A (§6.1) — Settings → Back up now → .buddysaradhi on disk
                                                                target: <5s for 1k students

   ┌─ Settings → Backup & Data ──────────────────────────────────────────────────┐
   │  Last backup: 2025-06-26 21:14 · 4.8 MB · 1,043 rows                        │
   │  [ ● Back up now ]  ← .neumo-raised primary (emerald glow); tap 1           │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        ▼
   ┌─ Backup Modal (.glass-strong + backdrop, §8.7) ─────────────────────────────┐
   │  Back up your Buddysaradhi data                                                 │
   │                                                                            │
   │  Passphrase:  [ ••••••••••••••••••   ]  ← .neumo-inset well                │
   │  Type "EXPORT" to confirm: [ EXPORT   ]  ← .neumo-inset (AP-13 typed gate) │
   │  PIN:         [ •• •• ••              ]  ← .neumo-raised digit pad          │
   │                                                                            │
   │  [ Cancel ]   [ ● Start backup ]                                          │
   │   ↑ secondary ↑ primary (.neumo-raised emerald)                           │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │ triple gate verifies (BR-SEC-02, BR-SEC-04)
                                        ▼
   ┌─ STEP 1. PRE-FLIGHT ───────────────────────────────────────────────────────┐
   │  · audit_log INSERT (action='export_full', status='started')              │
   │  · acquire advisory write-lock on tenant DB                                │
   │  · progress bar 0% (.glass-faint track, emerald fill)                      │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 2. COLLECT (streaming JSONL) ────────────────────────────────────────┐
   │  for each table in RESTORE_ORDER (see §9):                                  │
   │    · libSQL cursor batch_size=500                                           │
   │    · emit JSONL line per row: {"table":"students","row":{…}}                │
   │    · progress.emit(stage='collect', table, pct)                             │
   │  progress bar 5% → 35%                                                      │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 3. MANIFEST ──────────────────────────────────────────────────────────┐
   │  · sha256_data = sha256(data.jsonl)                                         │
   │  · manifest = {version:1, tenant_id, created_at, schema_version,            │
   │                row_counts, sha256_data, app_version, currency_code}         │
   │  progress bar 40%                                                           │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 4. TAR + GZIP ────────────────────────────────────────────────────────┐
   │  tar(manifest.json, data.jsonl, schema_version.txt) → gzip level 6         │
   │  progress bar 50%                                                           │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 5. ENCRYPT ──────────────────────────────────────────────────────────┐
   │  · salt = randomBytes(16)                                                   │
   │  · key = argon2id(passphrase, salt, {m:64MiB, t:3, p:4})  [in-memory]      │
   │  · nonce = randomBytes(12)                                                  │
   │  · ciphertext = AES-256-GCM(key, nonce, gzipped_tar)                        │
   │  · tag = GCM auth tag                                                       │
   │  progress bar 75%                                                           │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 6. ASSEMBLE FILE ─────────────────────────────────────────────────────┐
   │  header = magic(4) + format_version(1) + salt(16) + nonce(12) + tag(16)    │
   │  body = ciphertext                                                          │
   │  atomic write: temp file → rename to Buddysaradhi_Backup_<YYYYMMDDHHmm>.buddysaradhi │
   │  progress bar 95%                                                           │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 7. FINALIZE ──────────────────────────────────────────────────────────┐
   │  · update app_state.last_backup_at                                          │
   │  · audit_log INSERT (action='backup_create', bytes, sha256_data)            │
   │  · emit BACKUP_CREATED on cross-engine bus                                  │
   │  · key zeroed from memory                                                   │
   │  progress bar 100%                                                          │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ Toast (.glass-strong + emerald left-bar, §8.8) ────────────────────────────┐
   │  ● Backup created · 4.8 MB · 1,043 rows                  [Save]  [Share]    │
   └──────────────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
   OS share/save sheet (mobile) or download link (web/desktop)
   · the file is NEVER uploaded (BR-BAT-05); the tutor picks the destination:
     email · Drive · pendrive · iCloud Drive — the tutor's choice (P10)

   ↑ Total time: <5s for 1k students on mid-range Android (success criterion #4
     of 00_Vision.md §13.1: <60s backup+restore on fresh device).
   ↑ The triple gate (passphrase + typed EXPORT + PIN) is the strongest friction
     in the backup path (P11). Excel exports do NOT need the typed gate (only PIN).
   ↑ audit_log records the bytes + sha256_data; the cloud DB is NOT touched by
     a backup operation (P5 — local-first).
```

- ↑ **Idempotent.** Re-running with the same passphrase produces a different ciphertext (random salt + nonce) but the same plaintext sha256 — restore is deterministic.
- ↑ **Memory-bounded.** The `data.jsonl` is streamed; a 50k-row tenant (~5 MB plaintext) never holds the full table in memory. The 64 MiB argon2id cost is the dominant memory consumer.
- ↑ **The audit_log row is in the SAME logical transaction as the file write.** If the file write fails (disk full, etc.), the audit row's status is set to `failed` and the temp file is unlinked.

### 21.4 Mockup B3 — Backup-Restore Flow (Pipeline B)

```
BACKUP-RESTORE PIPELINE B (§6.2) — Settings → Restore → .buddysaradhi decrypted → DB overwrite
                                                                target: <60s for 1k students

   ┌─ Settings → Backup & Data → Restore backup ─────────────────────────────────┐
   │  [ Choose .buddysaradhi file… ]  ← .neumo-raised; opens OS file picker           │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        ▼
   ┌─ File picker returns: buddysaradhi-backup-2025-06-26.buddysaradhi ────────────────────┐
   │  preview: 4.8 MB · created 2025-06-26 21:14 · schema_version 14             │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        ▼
   ┌─ Restore Modal (.glass-strong + backdrop) — triple gate ────────────────────┐
   │  Restore from this backup?                                                  │
   │  ⚠ This OVERWRITES the current local database. A pre-restore snapshot will  │
   │    be saved as Buddysaradhi_PreRestore_<ts>.buddysaradhi (safety net).                │
   │                                                                            │
   │  Passphrase:       [ ••••••••••••••••••   ]  ← .neumo-inset well            │
   │  Type "RESTORE":   [ RESTORE               ]  ← .neumo-inset (AP-13)        │
   │  PIN:              [ •• •• ••              ]  ← .neumo-raised digit pad      │
   │                                                                            │
   │  [ Cancel ]   [ ● Start restore ]                                          │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │ triple gate verifies (BR-SEC-02)
                                        ▼
   ┌─ STEP 1. PRE-FLIGHT ───────────────────────────────────────────────────────┐
   │  · audit_log INSERT (action='backup_restore', status='started')             │
   │  · snapshot current DB → Buddysaradhi_PreRestore_<ts>.buddysaradhi (safety net)       │
   │  · progress bar 0%                                                          │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 2. DECODE WRAPPER ────────────────────────────────────────────────────┐
   │  · read magic bytes; if ≠ "BSR1" → abort E_BAD_MAGIC                        │
   │  · read format_version; if > MAX_SUPPORTED → abort E_VERSION_AHEAD          │
   │  · extract salt, nonce, tag, ciphertext                                     │
   │  · progress bar 5%                                                          │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 3. DECRYPT ──────────────────────────────────────────────────────────┐
   │  · key = argon2id(passphrase, salt, {m:64MiB, t:3, p:4})  [in-memory]      │
   │  · plaintext = AES-256-GCM-DECRYPT(key, nonce, ciphertext, tag)             │
   │  · on auth-tag failure → E_WRONG_PASSPHRASE (3 tries, then 60s lockout)     │
   │  · progress bar 15%                                                         │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 4. UNGZIP + UNTAR ────────────────────────────────────────────────────┐
   │  · gunzip → untar → manifest.json, data.jsonl, schema_version.txt           │
   │  · progress bar 25%                                                         │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 5. VERIFY INTEGRITY ──────────────────────────────────────────────────┐
   │  · actual_sha = sha256(data.jsonl)                                          │
   │  · if actual_sha ≠ manifest.sha256_data → abort E_CORRUPT                   │
   │  · progress bar 30%                                                         │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 6. SCHEMA-MIGRATE ────────────────────────────────────────────────────┐
   │  · file_schema = manifest.schema_version                                    │
   │  · app_schema = app_state.schema_version                                    │
   │  · if file_schema > app_schema → abort E_SCHEMA_AHEAD (prompt app update)   │
   │  · if file_schema < app_schema → run streaming migrators over JSONL          │
   │  · progress bar 40%                                                         │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 7. PARSE + VALIDATE ──────────────────────────────────────────────────┐
   │  · for each JSONL line: Zod-parse against table-specific schema             │
   │  · invalid → push to errors[] with line number + reason                     │
   │  · valid → bucket by table                                                  │
   │  · progress bar 50%                                                         │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 8. CONFLICT-RESOLUTION PREVIEW ───────────────────────────────────────┐
   │  · for each row, check existing DB by id:                                    │
   │      absent       → INSERT                                                  │
   │      present+same → SKIP                                                    │
   │      present+diff → CONFLICT (per strategy)                                  │
   │  · strategy = overwrite | merge | skip                                       │
   │  · if conflicts > 0 and strategy unspecified → PAUSE → conflict interstitial│
   │      (.glass-strong + backdrop; segmented control = .neumo-inset, §8.5)    │
   │  · progress bar 60% (paused if interstitial shown)                          │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 9. TRANSACTIONAL WRITE (FK-aware order) ──────────────────────────────┐
   │  BEGIN TRANSACTION                                                          │
   │  · for table in RESTORE_ORDER (§9):                                         │
   │      · UPSERT each row by id (idempotent — BR-SYN-02 style)                  │
   │      · FK orphan check: skip + report if parent_id not in DB/incoming set    │
   │      · ledger_entries: db.ledgerEntry.createMany({ skipDuplicates: true }) (NEVER db.ledgerEntry.update — BR-LED-01) │
   │  · db.auditLog.create({ data: { action: 'backup_restore_complete', ... } })   │
   │  · db.syncOutbox.create({ data: { op: 'restore', ... } })   ← AP-13           │
   │  COMMIT                                                                     │
   │  · progress bar 80% → 95%                                                   │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ STEP 10. REINDEX + FINALIZE ───────────────────────────────────────────────┐
   │  · REINDEX (FTS5 + BM25 + student_balance_cache recompute)                  │
   │  · key zeroed from memory                                                   │
   │  · progress bar 100%                                                        │
   │  · GlassShell reloads                                                       │
   └────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
   ┌─ Toast (.glass-strong + emerald left-bar) ──────────────────────────────────┐
   │  ● Restore complete · 1,043 rows · 0 conflicts                              │
   │    Last sync: just now · Last backup: 2025-06-26 21:14                      │
   └──────────────────────────────────────────────────────────────────────────────┘

   ↑ Total time: <60s for 1,000-student tenant (success criterion #4 of 00_Vision.md §13.1).
   ↑ ledger_entries is INSERT-OR-IGNORE only — restore NEVER mutates an existing
     ledger row (BR-LED-01, P4). A conflict on a ledger row's id is reported but
     the existing row wins; the incoming row is logged to skipped[].
   ↑ The pre-restore snapshot IS the safety net. If the restore corrupts anything
     (it shouldn't — atomic TX), the tutor can restore from the snapshot.
```

- ↑ **AP-13 honoured in restore too.** STEP 9 writes an `audit_log` row AND a `sync_outbox` row in the same transaction as the bulk UPSERT — the cloud DB eventually mirrors the restored state.
- ↑ **Conflict interstitial uses `.neumo-inset` segmented control.** The three strategies (overwrite / merge / skip) are presented as a pill segmented control with the active option as a `.neumo-raised` pill (§8.5).
- ↑ **EC-RV-01..03 cover the edge cases** (wrong passphrase 3× → 60s lockout; schema too new → prompt update; partial restore due to FK orphan → report and continue).

### 21.5 Mockup B4 — CSV-Import Mapping Tree (v1 students-only)

```
CSV-IMPORT MAPPING TREE (§10 — v1 imports students only; v1.x adds attendance + payments)

   ┌─ Settings → Backup & Data → Import CSV ────────────────────────────────────┐
   │  [ Choose .csv file… ]  ← .neumo-raised; opens OS file picker               │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        ▼
   ┌─ File picker returns: students_export.csv ──────────────────────────────────┐
   │  preview first 3 rows in a .glass-faint table (§8.4):                       │
   │    name, grade, phone, batch, fee, parent_contact                           │
   │    Aarav Sharma, 10, +9198…, Evening-A, 2000, +9198…                       │
   │    Priya Patel, 9, +9198…, Morning-B, 1500, +9198…                         │
   │    …                                                                        │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        ▼
   ┌─ Column Mapping Sheet (.glass-strong drawer + backdrop) ────────────────────┐
   │  Map CSV columns to Buddysaradhi fields:                                          │
   │                                                                            │
   │  CSV "name"           → [ Student.name          ▾ ]  ← .neumo-inset         │
   │  CSV "grade"          → [ Student.grade         ▾ ]  ← .neumo-inset         │
   │  CSV "phone"          → [ Student.phone         ▾ ]  ← .neumo-inset         │
   │  CSV "batch"          → [ Batch.name            ▾ ]  ← .neumo-inset         │
   │  CSV "fee"            → [ Fee.amount_paise      ▾ ]  ← .neumo-inset         │
   │  CSV "parent_contact" → [ Student.parent_phone  ▾ ]  ← .neumo-inset         │
   │  CSV "_notes"         → [ (skip)                ▾ ]  ← .neumo-inset         │
   │                                                                            │
   │  ↑ each dropdown is a .neumo-inset tray with .neumo-raised chevron (§8.9)   │
   │  ↑ auto-match by header name (case-insensitive Levenshtein ≤2)             │
   │  ↑ required: name (BR-STU-01). Others optional with sensible defaults.     │
   │                                                                            │
   │  [ Cancel ]   [ ● Preview import ]                                          │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        ▼
   ┌─ Preview Interstitial (.glass-strong + backdrop) ───────────────────────────┐
   │  104 rows ready to import:                                                  │
   │    · 98 will INSERT (new students)                                          │
   │    · 4 will SKIP (duplicate phone — BR-STU-02)                             │
   │    · 2 will CONFLICT (existing student_code — pick strategy)                │
   │                                                                            │
   │  Conflict strategy:  [ ● Skip  ○ Overwrite  ○ Merge ]  ← .neumo-inset seg  │
   │                                                                            │
   │  [ Cancel ]   [ ● Import 104 rows ]                                         │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │ E7 Security Engine gate (PIN — bulk import
                                        │ is in the §12.3 sensitive-action allowlist)
                                        ▼
   ┌─ BEGIN TRANSACTION ─────────────────────────────────────────────────────────┐
   │  for each row:                                                               │
   │    · Zod-parse → student schema (BR-STU-01..09)                              │
   │    · duplicate phone check (BR-STU-02)                                       │
   │    · auto-generate student_code if blank (BR-STU-04)                         │
   │    · INSERT students + student_enrollments (batch link)                      │
   │    · INSERT fee_schedule_items if fee > 0 (BR-FEE-03)                        │
   │    · amount_paise = INTEGER paise (BR-M-01, AP-17) — never float            │
   │  · db.auditLog.create({ data: { action: 'csv_import', metadata: { rowCount } } }) │
   │  · db.syncOutbox.create({ data: { op: 'csv_import', ... } })   ← AP-13        │
   │  COMMIT                                                                      │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        ▼
   ┌─ Toast (.glass-strong + emerald left-bar) ──────────────────────────────────┐
   │  ● Import complete · 98 new · 4 skipped · 2 conflicts resolved              │
   │    [ View skipped rows ]   [ View conflicts ]                                │
   └──────────────────────────────────────────────────────────────────────────────┘

   ↑ v1 imports STUDENTS ONLY. Attendance and payment import are v1.x
     (§20 future extensions) — they require full ledger-grammar validation
     (BR-LED-01..L06) and the receipts two-row invariant.
   ↑ Money fields parse to INTEGER paise at the Zod layer; float CSV cells are
     rejected with a row-level error (BR-M-01, AP-17).
   ↑ Duplicate phone (BR-STU-02) and student_code conflicts surface as preview
     rows; the tutor picks the strategy BEFORE the import commits — no silent
     overwrites (P1 — the tutor is the user; their data is not silently mutated).
```

- ↑ **The mapping tree is the contract.** A CSV without a `name` column is rejected (BR-STU-01 — name is the only required student field). All other fields have sensible defaults (P6).
- ↑ **Idempotent re-import.** Running the same CSV twice with `Skip` strategy produces zero new rows on the second run (idempotency via duplicate-phone + student_code check, BR-STU-02/STU-04).
- ↑ **AP-13 honoured.** The CSV import writes a single `audit_log` row + a single `sync_outbox` row representing the entire batch (one row per CSV, not one per student — keeps the outbox small).

---

*End of 09 — Backup & Import/Export. Cross-references: `08_Settings.md` (UI surfaces), `10_Security.md` §13 (crypto params), `11_Data_Model.md` (table contract + FK graph), `12_Business_Rules.md` §9 (BR-BAT-01..B05) + §3 (BR-LED-01/L02) + §8 (BR-SYN-02/SY04), `13_UI_Guidelines.md` (progress bars, typed confirm, toasts).*
