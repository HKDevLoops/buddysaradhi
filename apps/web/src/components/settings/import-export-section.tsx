"use client";

import React, { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Download,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  ListChecks,
  ReceiptText,
  Users,
  CalendarDays,
  FileUp,
} from "lucide-react";
import { log } from "@/lib/logger";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  STUDENT_IMPORT_HEADERS,
  STUDENT_TEMPLATE_FILENAME,
  STUDENT_XLSX_TEMPLATE_FILENAME,
  buildCsv,
  buildStudentsTemplate,
  downloadCsv,
  exportFilename,
  normalizeFlexibleDate,
  parseCsv,
  parseTsv,
  partitionDuplicates,
  splitImportGrid,
  validateImportRows,
  type ImportFileIssue,
  type ImportRowError,
  type ValidImportRow,
} from "@/lib/csv-parse";
import { buildStudentsXlsxTemplate, downloadXlsx } from "@/lib/xlsx-template";
import { importStudentsAction, IMPORT_PIN_REQUIRED_ABOVE_ROWS } from "@/server/actions/settings";
import { fetchStudentsAction } from "@/server/actions/students";
import { fetchAttendanceSummaryAction } from "@/server/actions/attendance";
import { formatINR, PIN_INPUT_MAX_LENGTH, type StudentListRow } from "@buddysaradhi/shared";
import type { StudentFilters } from "@/types/students";

// Implements: 09_Backup_and_Import_Export.md §6.4 Pipeline D (preview before
// any write) + §10.4 (template) + §14 (validation) + §15.4 (no PIN for the
// template); 13_UI_Guidelines.md §8.4 (preview table), §8.5 (segmented
// control), §8.7 (cards), §10 (44px targets, live regions, focus rings).

type ExportEntity = "students" | "attendance" | "fees";
type BulkPhase = "idle" | "preview" | "confirming" | "done";

interface BulkPreview {
  headers: string[];
  rows: string[][];
  valid: ValidImportRow[];
  duplicateCount: number;
  invalid: ImportRowError[];
  fileIssue: ImportFileIssue | null;
}

interface BulkResult {
  created: number;
  skipped: number;
  invalid: ImportRowError[];
  batchesCreated: number;
}

const EXPORT_ENTITIES: Array<{ id: ExportEntity; label: string }> = [
  { id: "students", label: "Students" },
  { id: "attendance", label: "Attendance" },
  { id: "fees", label: "Fees statements" },
];

const ALL_STATUSES: StudentFilters["status"] = ["active", "inactive", "graduated", "archived"];
const ALL_FEE_MODELS: StudentFilters["feeModels"] = ["postpaid", "prepaid", "mixed"];

// Excel-like paste grid (Settings bulk import). Columns are the fourteen
// import headers; the grid posts through the same preview + action as a file
// upload, so file and paste can never disagree about what a valid row is.
const GRID_COLUMNS: string[] = [...STUDENT_IMPORT_HEADERS];
const GRID_START_ROWS = 4;
const GRID_ENUM_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  gender: [
    { value: "", label: "—" },
    { value: "M", label: "M" },
    { value: "F", label: "F" },
    { value: "O", label: "O" },
  ],
  fee_model: [
    { value: "", label: "Auto: postpaid" },
    { value: "postpaid", label: "postpaid" },
    { value: "prepaid", label: "prepaid" },
    { value: "mixed", label: "mixed" },
  ],
  status: [
    { value: "", label: "Auto: active" },
    { value: "active", label: "active" },
    { value: "inactive", label: "inactive" },
    { value: "graduated", label: "graduated" },
    { value: "archived", label: "archived" },
  ],
};
const GRID_DATE_COLUMNS: ReadonlySet<string> = new Set(["dob", "admission_date"]);
const GRID_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  phone: "Phone",
  gender: "Gender",
  dob: "Date of birth",
  address: "Address",
  school: "School",
  grade: "Grade",
  board: "Board",
  batch: "Batch",
  admission_date: "Admission date",
  fee_model: "Fee model",
  base_fee_rupees: "Monthly fee (₹)",
  status: "Status",
};

function gridLabel(header: string): string {
  return GRID_LABELS[header] ?? header;
}

interface GridCheck {
  filled: number;
  validCount: number;
  invalidCount: number;
  cellErrors: Map<string, string>;
  fileIssue: ImportFileIssue | null;
}

function emptyGridRow(): string[] {
  return Array(GRID_COLUMNS.length).fill("");
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportExportSection() {
  const queryClient = useQueryClient();

  // Records export (entity choice) + bulk import preview flow.
  const [exportEntity, setExportEntity] = useState<ExportEntity>("students");
  const [exportStatus, setExportStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [exportMessage, setExportMessage] = useState("");
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const [bulkPhase, setBulkPhase] = useState<BulkPhase>("idle");
  const [bulkError, setBulkError] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  // 09_Backup_and_Import_Export.md §15.4 + 12_Business_Rules.md BR-SEC-02: a
  // bulk import of MORE THAN 100 rows is a sensitive mutation and asks for the
  // app PIN. Up to 100 rows does not. The threshold is the spec's, not a taste
  // call, so the UI imports the same constant the server action enforces.
  const [importPin, setImportPin] = useState("");
  const [importPinError, setImportPinError] = useState<string | null>(null);
  const [pinVerified, setPinVerified] = useState(false);

  /** Full roster via the existing students action (paginated, honest total). */
  const collectRoster = async (): Promise<StudentListRow[]> => {
    const filters: StudentFilters = {
      status: ALL_STATUSES,
      batchIds: [],
      feeModels: ALL_FEE_MODELS,
      tagIds: [],
      balanceRange: "all",
      admittedInLast: "all",
    };
    const pageSize = 200;
    const collected: StudentListRow[] = [];
    for (let page = 1; ; page += 1) {
      const res = await fetchStudentsAction(filters, "", page, pageSize, { col: "name", dir: "asc" });
      if (!res.success || !res.data) {
        throw new Error(res.error ?? "Could not load your students.");
      }
      collected.push(...res.data.students);
      if (collected.length >= res.data.total || res.data.students.length < pageSize) break;
    }
    return collected;
  };

  const handleExportRecords = async () => {
    setExportStatus("loading");
    setExportMessage("");
    try {
      if (exportEntity === "students") {
        const roster = await collectRoster();
        if (roster.length === 0) {
          setExportStatus("error");
          setExportMessage("No students to export yet. Add your first student on the Students screen.");
          return;
        }
        downloadCsv(
          exportFilename("students"),
          buildCsv(
            ["code", "name", "grade", "batch", "fee_model", "status"],
            roster.map((student) => [
              student.code,
              student.name,
              student.grade,
              student.batch,
              student.fee_model,
              student.status,
            ]),
          ),
        );
        setExportStatus("success");
        setExportMessage(`Saved ${roster.length} students.`);
      } else if (exportEntity === "attendance") {
        const res = await fetchAttendanceSummaryAction("current_month");
        if (!res.ok || !res.value) {
          throw new Error("Could not load attendance.");
        }
        const summaries = res.value.summaries;
        if (summaries.length === 0) {
          setExportStatus("error");
          setExportMessage("No attendance marked this month, so there is nothing to export.");
          return;
        }
        downloadCsv(
          exportFilename("attendance"),
          buildCsv(
            ["student_id", "student_name", "present", "absent", "late", "excused", "total_sessions", "percentage"],
            summaries.map((entry) => [
              entry.student_id,
              entry.student_name,
              entry.present,
              entry.absent,
              entry.late,
              entry.excused,
              entry.total_sessions,
              entry.percentage,
            ]),
          ),
        );
        setExportStatus("success");
        setExportMessage(`Saved ${summaries.length} attendance rows.`);
      } else {
        // Fees export is a read-only snapshot (Rule 1: ledger rows never
        // leave the app as editable data, and this flow never reads them).
        const roster = await collectRoster();
        if (roster.length === 0) {
          setExportStatus("error");
          setExportMessage("No students to export yet. Add your first student on the Students screen.");
          return;
        }
        downloadCsv(
          exportFilename("fees_statements"),
          buildCsv(
            ["code", "name", "balance_due_paise", "balance_due_inr_read_only"],
            roster.map((student) => [
              student.code,
              student.name,
              student.balance_due,
              formatINR(student.balance_due),
            ]),
          ),
        );
        setExportStatus("success");
        setExportMessage(`Saved ${roster.length} read-only statements.`);
      }
    } catch (error) {
      log.error(
        "settings_records_export_failed",
        error instanceof Error ? error.message : String(error),
      );
      setExportStatus("error");
      setExportMessage("Export failed. Check your connection and try again.");
    }
  };

  const resetBulkInput = () => {
    if (bulkInputRef.current) bulkInputRef.current.value = "";
  };

  const resetBulkFlow = () => {
    setBulkPhase("idle");
    setBulkError("");
    setPreview(null);
    setBulkResult(null);
    resetBulkInput();
  };

  const handleTemplateDownload = () => {
    try {
      downloadCsv(STUDENT_TEMPLATE_FILENAME, buildStudentsTemplate());
    } catch {
      log.error("settings_template_download_failed", "Failed to build the students template");
      setBulkError("Could not build the template. Try again.");
    }
  };

  const handleXlsxTemplateDownload = () => {
    try {
      downloadXlsx(STUDENT_XLSX_TEMPLATE_FILENAME, buildStudentsXlsxTemplate());
    } catch {
      log.error("settings_template_xlsx_download_failed", "Failed to build the Excel students template");
      setBulkError("Could not build the Excel template. Try again.");
    }
  };

  // Paste-grid state: one string per cell, always fourteen cells per row.
  const [grid, setGrid] = useState<string[][]>(() =>
    Array.from({ length: GRID_START_ROWS }, emptyGridRow),
  );
  const [pasteNotice, setPasteNotice] = useState("");

  /** Live validation of the filled grid rows (empty rows are ignored). */
  const gridCheck: GridCheck = useMemo(() => {
    const positions: number[] = [];
    grid.forEach((cells, index) => {
      if (cells.some((cell) => cell.trim() !== "")) positions.push(index);
    });
    const rows = positions.map((index) => grid[index] ?? emptyGridRow());
    const checked = validateImportRows(GRID_COLUMNS, rows);
    if (!checked.ok) {
      return { filled: positions.length, validCount: 0, invalidCount: 0, cellErrors: new Map(), fileIssue: checked.issue };
    }
    const cellErrors = new Map<string, string>();
    for (const error of checked.invalid) {
      const gridIndex = positions[error.row - 2];
      if (gridIndex === undefined) continue;
      const key = `${gridIndex}:${error.column}`;
      const prior = cellErrors.get(key);
      cellErrors.set(key, prior ? `${prior} | ${error.reason}` : error.reason);
    }
    return {
      filled: positions.length,
      validCount: checked.valid.length,
      invalidCount: checked.invalid.length,
      cellErrors,
      fileIssue: null,
    };
  }, [grid]);

  const updateGridCell = (rowIndex: number, colIndex: number, value: string) => {
    setGrid((current) =>
      current.map((cells, index) => {
        if (index !== rowIndex) return cells;
        const next = [...cells];
        next[colIndex] = value;
        return next;
      }),
    );
  };

  const addGridRow = () => {
    setGrid((current) => [...current, emptyGridRow()]);
  };

  const removeGridRow = (rowIndex: number) => {
    setGrid((current) => (current.length <= 1 ? current.map(() => emptyGridRow()) : current.filter((_, index) => index !== rowIndex)));
  };

  /**
   * Excel paste: tab-separated cells land from the focused cell outward.
   * Single-cell text pastes fall through to the browser default; anything
   * with a tab or newline is a grid paste. Date cells normalize through the
   * same flexible parser as file upload (DD/MM/YYYY and Excel serials become
   * YYYY-MM-DD); a date Excel wrote that still will not parse is left blank
   * and named in the notice below, never silently kept.
   */
  const handleGridPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (!text || (!text.includes("\t") && !text.includes("\n") && !text.includes("\r"))) return;
    const target = e.target as HTMLElement | null;
    const originRow = Number(target?.dataset?.gridRow ?? 0);
    const originCol = Number(target?.dataset?.gridCol ?? 0);
    if (!Number.isInteger(originRow) || !Number.isInteger(originCol)) return;
    e.preventDefault();
    const pasted = parseTsv(text).filter((cells) => cells.some((cell) => cell.trim() !== ""));
    if (pasted.length === 0) return;
    const room = MAX_IMPORT_ROWS - originRow;
    const usable = pasted.slice(0, Math.max(0, room));
    const unreadable: string[] = [];
    const next = grid.map((cells) => [...cells]);
    usable.forEach((cells, r) => {
      const rowIndex = originRow + r;
      while (next.length <= rowIndex) next.push(emptyGridRow());
      const row = next[rowIndex] ?? emptyGridRow();
      cells.forEach((value, c) => {
        const colIndex = originCol + c;
        if (colIndex >= GRID_COLUMNS.length) return;
        const header = GRID_COLUMNS[colIndex] ?? "";
        if (GRID_DATE_COLUMNS.has(header)) {
          const trimmed = value.trim();
          if (trimmed === "") {
            row[colIndex] = "";
            return;
          }
          const parsed = normalizeFlexibleDate(trimmed, header);
          if (parsed.ok) {
            row[colIndex] = parsed.iso;
          } else {
            row[colIndex] = "";
            unreadable.push(`row ${rowIndex + 1}, ${gridLabel(header)} ("${trimmed.slice(0, 24)}")`);
          }
          return;
        }
        row[colIndex] = value;
      });
      next[rowIndex] = row;
    });
    setGrid(next);
    const notices: string[] = [];
    if (usable.length < pasted.length) {
      notices.push(`Pasted ${pasted.length} rows, kept ${usable.length}: one import holds 2,000 rows.`);
    }
    if (unreadable.length > 0) {
      notices.push(`These pasted dates would not parse, left blank: ${unreadable.join("; ")}.`);
    }
    setPasteNotice(notices.join(" "));
  };

  /** Grid rows enter the same preview + confirm path as a file upload. */
  const handleGridReview = () => {
    const rows = grid.filter((cells) => cells.some((cell) => cell.trim() !== ""));
    if (rows.length === 0) {
      setBulkError("The grid is empty. Paste rows from Excel or add a row first.");
      return;
    }
    const checked = validateImportRows(GRID_COLUMNS, rows);
    setBulkResult(null);
    if (!checked.ok) {
      setPreview({ headers: GRID_COLUMNS, rows, valid: [], duplicateCount: 0, invalid: [], fileIssue: checked.issue });
    } else {
      const { unique, duplicates } = partitionDuplicates(checked.valid);
      setPreview({
        headers: GRID_COLUMNS,
        rows,
        valid: unique,
        duplicateCount: duplicates.length,
        invalid: checked.invalid,
        fileIssue: null,
      });
    }
    setBulkError("");
    setBulkPhase("preview");
  };

  /** One grid cell: enum columns are selects, date columns are date inputs. */
  const renderGridCell = (rowIndex: number, colIndex: number) => {
    const header = GRID_COLUMNS[colIndex] ?? "";
    const value = grid[rowIndex]?.[colIndex] ?? "";
    const reason = gridCheck.cellErrors.get(`${rowIndex}:${header}`);
    const invalid = reason !== undefined;
    const tone = invalid
      ? "border-[var(--danger)] ring-2 ring-[var(--danger)]/40"
      : "border-[var(--border-default)]";
    const shared = {
      "data-grid-row": rowIndex,
      "data-grid-col": colIndex,
      "aria-label": `${gridLabel(header)}, row ${rowIndex + 1}`,
      "aria-invalid": invalid || undefined,
      title: reason ?? undefined,
      className: `min-h-[44px] w-full rounded-lg bg-[var(--surface-inset)] border px-2 text-xs text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--info)] ${tone}`,
    };
    const options = GRID_ENUM_OPTIONS[header];
    if (options) {
      return (
        <select
          key={`${rowIndex}-${colIndex}`}
          value={options.some((option) => option.value === value) ? value : ""}
          onChange={(e) => updateGridCell(rowIndex, colIndex, e.target.value)}
          {...shared}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    if (GRID_DATE_COLUMNS.has(header)) {
      return (
        <input
          key={`${rowIndex}-${colIndex}`}
          type="date"
          value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
          onChange={(e) => updateGridCell(rowIndex, colIndex, e.target.value)}
          {...shared}
        />
      );
    }
    return (
      <input
        key={`${rowIndex}-${colIndex}`}
        type="text"
        value={value}
        placeholder={gridLabel(header)}
        onChange={(e) => updateGridCell(rowIndex, colIndex, e.target.value)}
        {...shared}
      />
    );
  };

  const handleBulkFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkResult(null);
    setPreview(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setBulkError("That is not a CSV file. Choose a file ending in .csv.");
      resetBulkInput();
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setBulkError(
        `This file is ${formatFileSize(file.size)}. Choose a CSV under 2 MB (about 2,000 rows).`,
      );
      resetBulkInput();
      return;
    }
    try {
      const text = await file.text();
      const { headers, rows } = splitImportGrid(parseCsv(text));
      const checked = validateImportRows(headers, rows);
      if (!checked.ok) {
        setPreview({ headers, rows, valid: [], duplicateCount: 0, invalid: [], fileIssue: checked.issue });
      } else {
        const { unique, duplicates } = partitionDuplicates(checked.valid);
        setPreview({
          headers,
          rows,
          valid: unique,
          duplicateCount: duplicates.length,
          invalid: checked.invalid,
          fileIssue: null,
        });
      }
      setBulkError("");
      setBulkPhase("preview");
    } catch {
      log.error("settings_bulk_parse_failed", "Failed to read the uploaded CSV file");
      setBulkError("Could not read this file. Re-save it as CSV and try again.");
    } finally {
      resetBulkInput();
    }
  };

  /** Error report: original rows plus one errors column, grouped by row. */
  const handleInvalidDownload = () => {
    const invalid = bulkResult?.invalid ?? preview?.invalid ?? [];
    if (invalid.length === 0 || !preview) return;
    const headers = preview.headers;
    const byRow = new Map<number, string[]>();
    for (const error of invalid) {
      const list = byRow.get(error.row) ?? [];
      list.push(`${error.column}: ${error.reason}`);
      byRow.set(error.row, list);
    }
    const body = buildCsv(
      [...headers, "errors"],
      [...byRow.entries()].map(([rowNumber, reasons]) => [
        ...(preview.rows[rowNumber - 2] ?? headers.map(() => "")),
        reasons.join(" | "),
      ]),
    );
    downloadCsv(exportFilename("import_errors"), body);
  };

  // REMOVED (fabrication, AGENTS.md §2 Rule 9):
  //   `handleExportJSON` / `handleExportCSV` — both read the single cached
  //   `settings` row and wrote it out, under the labels "Download your entire
  //   unencrypted ledger and student data" and "flat files suitable for Excel
  //   or accounting software". Neither contained a ledger nor a student. The
  //   real exports are `handleExportRecords` above, which page the real roster
  //   and say exactly what each file holds.
  //   `handleFileChange` / `triggerFileInput` — a "Select Backup File" button
  //   that read a `.bsb` into an ArrayBuffer, discarded it, and after 1500ms
  //   printed "Backup imported successfully." A restore is the highest-stakes
  //   operation in this product; the button reported success for a restore that
  //   never happened. Restore belongs in Backup & Restore behind a typed
  //   RESTORE + fresh PIN + sha256 verification (08 §6.2.7, 09 §15.4), and it
  //   is reported to the lead as unimplemented rather than faked here.

  const importNeedsPin = (preview?.valid.length ?? 0) > IMPORT_PIN_REQUIRED_ABOVE_ROWS;
  const importGateOpen = importNeedsPin && !pinVerified;

  const handleBulkConfirm = async () => {
    if (!preview || preview.fileIssue) return;
    if (importNeedsPin && !pinVerified) {
      setImportPinError("Enter your app PIN to import more than 100 students.");
      return;
    }
    setBulkPhase("confirming");
    setBulkError("");
    setImportPinError(null);
    try {
      const result = await importStudentsAction({ headers: preview.headers, rows: preview.rows, pin: importNeedsPin ? importPin : undefined });
      if (!result.success) {
        setBulkError(result.error);
        setBulkPhase("preview");
        return;
      }
      setBulkResult(result.data);
      setBulkPhase("done");
      setPinVerified(false);
      setImportPin("");
      queryClient.invalidateQueries({ queryKey: ["students"] });
    } catch {
      log.error("settings_bulk_import_failed", "Bulk import request failed");
      setBulkError("Import failed. Check your connection and try again.");
      setBulkPhase("preview");
    }
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
          <Download className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
          Export Data
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-5 max-w-[68ch]">
          These are the exports that exist. Each file says what it holds, and every row your app has
          is in it, so nothing is sampled or dropped quietly. For a restorable copy of everything,
          use Backup &amp; Restore instead.
        </p>

        <div className="glass-card p-5 rounded-xl border border-[var(--border-default)]">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[var(--info)]/10 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Export records</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                Download your students, this month attendance, or read-only fee statements as CSV.
                Fee statements are snapshots for your records. The ledger never leaves as editable rows.
              </p>
              <div
                role="radiogroup"
                aria-label="Choose what to export"
                className="neumo-inset flex flex-wrap gap-1 mt-4 rounded-xl p-1"
              >
                {EXPORT_ENTITIES.map((entity) => {
                  const active = exportEntity === entity.id;
                  const Icon = entity.id === "students" ? Users : entity.id === "attendance" ? CalendarDays : ReceiptText;
                  return (
                    <button
                      key={entity.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setExportEntity(entity.id);
                        setExportStatus("idle");
                        setExportMessage("");
                      }}
                      className={
                        active
                          ? "neumo-raised min-h-[44px] px-4 rounded-lg text-sm font-semibold text-[var(--text-primary)] cursor-pointer flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--info)]"
                          : "min-h-[44px] px-4 rounded-lg text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--info)]"
                      }
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      {entity.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-4">
                <button
                  type="button"
                  onClick={handleExportRecords}
                  disabled={exportStatus === "loading"}
                  className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--success)] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--success)]"
                >
                  {exportStatus === "loading" ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="w-4 h-4" aria-hidden="true" />
                  )}
                  {exportEntity === "students"
                    ? "Download students CSV"
                    : exportEntity === "attendance"
                      ? "Download attendance CSV"
                      : "Download fee statements CSV"}
                </button>
                <div aria-live="polite">
                  {exportStatus === "success" && (
                    <p className="text-[var(--success)] text-xs font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {exportMessage}
                    </p>
                  )}
                  {exportStatus === "error" && (
                    <p className="text-[var(--danger)] text-xs font-semibold flex items-center gap-1.5">
                      <XCircle className="w-4 h-4" aria-hidden="true" /> {exportMessage}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
          <Upload className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
          Import Data
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-5 max-w-[68ch]">
          Adding students in bulk. Nothing here touches fees, payments or the ledger, and an import
          never merges a student who already exists, it skips them.
        </p>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <FileUp className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
          Bulk import
        </h3>

        <div className="glass-card p-6 rounded-xl border border-[var(--border-default)]">
          <div className="flex gap-4">
            <Users className="w-5 h-5 text-[var(--success)] shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Bulk import students</p>
              <p className="text-sm text-[var(--text-muted)] mb-3 leading-relaxed">
                Add many students at once. Download the template (CSV or Excel), fill it in,
                then upload the CSV or paste the rows into the grid below for a row-by-row
                check before anything is saved. Imports add students only and never touch
                the ledger.
              </p>
              <ol className="text-xs text-[var(--text-muted)] mb-4 space-y-1 list-decimal list-inside">
                <li>Download the template and keep its fourteen headers.</li>
                <li>Upload the CSV, or paste rows into the grid, and review every row below.</li>
                <li>Confirm, and your students are added. Matching names and phones are skipped, never merged.</li>
              </ol>

              <input
                type="file"
                ref={bulkInputRef}
                onChange={handleBulkFile}
                accept=".csv"
                aria-label="Choose a students CSV file to import"
                className="hidden"
              />

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <button
                  type="button"
                  onClick={handleTemplateDownload}
                  className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--success)] cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--success)]"
                >
                  <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
                  Download students-template.csv
                </button>
                <button
                  type="button"
                  onClick={handleXlsxTemplateDownload}
                  className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--success)] cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--success)]"
                >
                  <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
                  Download Excel template (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => bulkInputRef.current?.click()}
                  className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--info)] cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--info)]"
                >
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  Choose CSV file
                </button>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">CSV only, under 2 MB, up to 2,000 rows.</p>

              <div className="mt-6 rounded-xl border border-[var(--border-default)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Or paste rows from Excel</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                  Copy rows in Excel, click any grid cell, and paste. Dates accept YYYY-MM-DD,
                  DD/MM/YYYY, or Excel date numbers. Gender, fee model, and status are dropdowns.
                </p>
                <div className="overflow-x-auto mt-3 rounded-xl border border-[var(--border-default)]">
                  <table className="border-collapse" onPaste={handleGridPaste}>
                    <caption className="sr-only">
                      Paste grid with the fourteen student columns. Paste Excel rows from any cell.
                    </caption>
                    <thead>
                      <tr>
                        {GRID_COLUMNS.map((header) => (
                          <th
                            key={header}
                            scope="col"
                            className="px-2 py-2 text-left text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap"
                          >
                            {gridLabel(header)}
                          </th>
                        ))}
                        <th scope="col" className="px-2 py-2">
                          <span className="sr-only">Row actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {grid.map((cells, rowIndex) => (
                        <tr key={rowIndex} className="border-t border-[var(--border-default)]">
                          {GRID_COLUMNS.map((header, colIndex) => (
                            <td key={`${rowIndex}-${header}`} className="px-1 py-1 align-top" style={{ minWidth: header === "address" ? 180 : 120 }}>
                              {renderGridCell(rowIndex, colIndex)}
                            </td>
                          ))}
                          <td className="px-1 py-1 align-top">
                            <button
                              type="button"
                              onClick={() => removeGridRow(rowIndex)}
                              aria-label={`Remove grid row ${rowIndex + 1}`}
                              className="min-h-[44px] min-w-[44px] rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]"
                            >
                              <XCircle className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={addGridRow}
                    className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--info)] cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--info)]"
                  >
                    Add a row
                  </button>
                  <button
                    type="button"
                    onClick={handleGridReview}
                    disabled={gridCheck.filled === 0}
                    className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--success)] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--success)]"
                  >
                    <ListChecks className="w-4 h-4" aria-hidden="true" />
                    Review {gridCheck.filled} {gridCheck.filled === 1 ? "row" : "rows"}
                  </button>
                </div>
                <div aria-live="polite">
                  <p className="text-xs text-[var(--text-secondary)] mt-3">
                    {gridCheck.filled === 0
                      ? "The grid is empty. Nothing to review yet."
                      : `${gridCheck.validCount} ready${gridCheck.invalidCount > 0 ? `, ${gridCheck.invalidCount} need fixes (hover a ringed cell for the reason)` : ""}.`}
                  </p>
                  {pasteNotice && (
                    <p className="text-xs text-[var(--warning)] mt-1 flex items-start gap-1.5">
                      <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{pasteNotice}</span>
                    </p>
                  )}
                </div>
              </div>

              <div aria-live="polite">
                {bulkError && (
                  <p className="text-[var(--danger)] text-xs font-semibold flex items-start gap-1.5 mt-4">
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{bulkError}</span>
                  </p>
                )}

                {preview?.fileIssue && (
                  <div className="mt-4 rounded-xl border border-[color-mix(in srgb,var(--danger)_35%,transparent)] p-4">
                    <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <XCircle className="w-4 h-4 text-[var(--danger)]" aria-hidden="true" />
                      This file was refused, nothing was imported.
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">{preview.fileIssue.message}</p>
                    {preview.fileIssue.detail && preview.fileIssue.detail.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {preview.fileIssue.detail.map((line) => (
                          <li key={line} className="text-xs text-[var(--text-muted)]">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {preview && !preview.fileIssue && bulkPhase !== "done" && (
                  <div className="mt-4 space-y-4">
                    <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <ListChecks className="w-4 h-4 text-[var(--success)]" aria-hidden="true" />
                      {preview.valid.length} ready
                      {preview.duplicateCount > 0 && ` · ${preview.duplicateCount} duplicates skipped`}
                      {preview.invalid.length > 0 && ` · ${preview.invalid.length} need fixes`}
                    </p>

                    {preview.valid.length > 0 && (
                      <div className="overflow-x-auto rounded-xl border border-[var(--border-default)]">
                        <table className="w-full text-xs">
                          <caption className="sr-only">First 10 valid rows of your upload</caption>
                          <thead>
                            <tr className="text-left text-[var(--text-muted)]">
                              {["First name", "Last name", "Phone", "Batch", "Status"].map((head) => (
                                <th key={head} scope="col" className="px-3 py-2 font-semibold">
                                  {head}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.valid.slice(0, 10).map((row) => (
                              <tr
                                key={row.index}
                                className="odd:bg-[var(--surface-inset)] border-t border-[var(--border-default)]"
                              >
                                <td className="px-3 py-2 text-[var(--text-primary)]">{row.data.first_name}</td>
                                <td className="px-3 py-2 text-[var(--text-secondary)]">{row.data.last_name ?? ""}</td>
                                <td className="px-3 py-2 text-[var(--text-secondary)]">{row.data.phone ?? ""}</td>
                                <td className="px-3 py-2 text-[var(--text-secondary)]">{row.data.batch ?? ""}</td>
                                <td className="px-3 py-2 text-[var(--text-secondary)]">{row.data.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {preview.valid.length > 10 && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Showing 10 of {preview.valid.length} ready rows.
                      </p>
                    )}

                    {preview.invalid.length > 0 && (
                      <div className="rounded-xl border border-[color-mix(in srgb,var(--danger)_35%,transparent)] p-4 max-h-56 overflow-y-auto">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">
                          {preview.invalid.length} rows need fixes. Fix the file and upload it again,
                          or import the ready rows now.
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {preview.invalid.map((error, position) => (
                            <li
                              key={`${error.row}-${error.column}-${position}`}
                              className="text-xs text-[var(--text-secondary)] flex items-start gap-1.5"
                            >
                              <XCircle className="w-4 h-4 shrink-0 text-[var(--danger)]" aria-hidden="true" />
                              <span>
                                Row {error.row}, {error.column}: {error.reason}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {importGateOpen && (
                      <div
                        className="rounded-xl border border-[var(--border-default)] p-4 space-y-3"
                        style={{ background: "var(--surface-inset)" }}
                        role="group"
                        aria-label="Confirm a large import with your PIN"
                      >
                        <p className="text-xs text-[var(--text-secondary)] max-w-[68ch]">
                          More than {IMPORT_PIN_REQUIRED_ABOVE_ROWS} students at once is enough to
                          bury a mistake, so this one asks for your PIN first. It changes nothing
                          about the import itself.
                        </p>
                        <div>
                          <label
                            htmlFor="bulk-import-pin"
                            className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
                          >
                            Your app PIN
                          </label>
                          <input
                            id="bulk-import-pin"
                            type="password"
                            value={importPin}
                            onChange={(e) => {
                              setImportPin(e.target.value);
                              setImportPinError(null);
                            }}
                            inputMode="numeric"
                            maxLength={PIN_INPUT_MAX_LENGTH}
                            autoComplete="off"
                            placeholder="Your PIN"
                            className="neumo-inset w-full sm:w-56 px-4 py-3 min-h-[44px] text-sm text-center tracking-[0.4em] font-mono text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--warning)] focus:ring-1 focus:ring-[var(--warning)]"
                          />
                        </div>
                        {importPinError && (
                          <p role="alert" className="text-[var(--danger)] text-xs font-semibold">{importPinError}</p>
                        )}
                        <button
                          type="button"
                          disabled={importPin.length < 4}
                          onClick={() => {
                            // The server re-verifies with the ladder; this only
                            // skips a pointless round trip for an empty field.
                            if (importPin.length < 4) {
                              setImportPinError("Enter your app PIN.");
                              return;
                            }
                            setPinVerified(true);
                            setImportPinError(null);
                          }}
                          className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Continue
                        </button>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                      <button
                        type="button"
                        onClick={handleBulkConfirm}
                        disabled={bulkPhase === "confirming" || preview.valid.length === 0}
                        aria-busy={bulkPhase === "confirming"}
                        className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--success)] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--success)]"
                      >
                        {bulkPhase === "confirming" && (
                          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        )}
                        {importGateOpen
                          ? "Enter your PIN to import"
                          : `Import ${preview.valid.length} students`}
                      </button>
                      {preview.valid.length === 0 && (
                        <p className="text-xs text-[var(--text-muted)]">Nothing ready to import yet.</p>
                      )}
                    </div>
                  </div>
                )}

                {bulkPhase === "done" && bulkResult && (
                  <div className="mt-4 rounded-xl border border-[color-mix(in srgb,var(--success)_35%,transparent)] p-4">
                    <p className="text-xs font-semibold text-[var(--success)] flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      Imported {bulkResult.created} students
                      {bulkResult.skipped > 0 && `, skipped ${bulkResult.skipped} duplicates`}
                      {bulkResult.batchesCreated > 0 &&
                        `, created ${bulkResult.batchesCreated} new ${bulkResult.batchesCreated === 1 ? "batch" : "batches"}`}
                      .
                    </p>
                    {bulkResult.invalid.length > 0 && (
                      <p className="text-xs text-[var(--text-secondary)] mt-1">
                        {bulkResult.invalid.length} rows had errors and were left out.
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mt-3">
                      {bulkResult.invalid.length > 0 && (
                        <button
                          type="button"
                          onClick={handleInvalidDownload}
                          className="neumo-raised min-h-[44px] px-4 rounded-xl text-sm font-semibold text-[var(--warning)] cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--warning)]"
                        >
                          <Download className="w-4 h-4" aria-hidden="true" />
                          Download error report
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={resetBulkFlow}
                        className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--info)]"
                      >
                        Import another file
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
