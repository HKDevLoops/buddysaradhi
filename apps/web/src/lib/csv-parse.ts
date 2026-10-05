// Implements: 09_Backup_and_Import_Export.md §14 (validation rules) +
// 12_Business_Rules.md BR-IMP-03 (CSV contract: header row, UTF-8, ISO dates,
// integer paise) + BR-STU-02 (skip duplicates, never merge) + BR-STU-04 (code).
//
// Dependency-free CSV parser and builder for the Settings bulk import/export
// flow. Every function here is pure (no DOM, no network, no logging) except
// `downloadCsv`, which is the single client-only download helper. The row
// schema in this file is the single source of truth shared by the client
// preview and the `importStudentsAction` server re-validation, so the two
// sides can never disagree about what a valid row is.

import { z } from "zod";

/**
 * Exact headers of the students import template (order matters in the file).
 * Fourteen columns for the thirteen Add Student properties: the sheet's full
 * name splits into first_name + last_name on import (05_Students.md §6.1,
 * add-student-sheet.tsx FormSchema). Names mirror the canonical create path
 * (server/actions/students.ts CreateStudentInputSchema: dob, admission_date,
 * fee_model, status) so a pasted row and a hand-typed student validate alike.
 */
export const STUDENT_IMPORT_HEADERS = [
  "first_name",
  "last_name",
  "phone",
  "gender",
  "dob",
  "address",
  "school",
  "grade",
  "board",
  "batch",
  "admission_date",
  "fee_model",
  "base_fee_rupees",
  "status",
] as const;

/** Filename of the client-generated CSV template (no server roundtrip). */
export const STUDENT_TEMPLATE_FILENAME = "students-template.csv";

/** Filename of the client-generated Excel template (no server roundtrip). */
export const STUDENT_XLSX_TEMPLATE_FILENAME = "students-template.xlsx";

/** Client-side upload cap (09 §15.6 allows 50 MB; Settings bulk flow caps at 2 MB). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Server-side row cap for one import call (09 §15.6 caps at 50k; one Settings call caps here). */
export const MAX_IMPORT_ROWS = 2000;

/** Per-cell cap (09 §15.6: 4 KB per cell rejects pathological cells). */
export const MAX_CELL_CHARS = 4096;

/** Rows committed per write transaction (keeps the WAL bounded, 09 §11). */
export const IMPORT_CHUNK_SIZE = 50;

/**
 * Headers that signal money or ledger data. A students import never carries
 * financial rows (09 §6.4: v1 imports students only; payments need full ledger
 * grammar), so a file with any of these headers is refused, never coerced.
 * Compared case-insensitively after trim; stems also match inside longer
 * headers (fee_amount, receipt_no, invoice_no).
 */
const MONEY_HEADER_EXACT = new Set([
  "amount",
  "balance",
  "balance_due",
  "paise",
  "rupees",
  "payment",
  "receipt",
  "invoice",
  "ledger",
  "fee",
  "fees",
  "price",
  "total",
  "due",
  "paid",
  "discount",
]);

const MONEY_HEADER_STEMS = [
  "receipt",
  "invoice",
  "ledger",
  "payment",
  "amount",
  "balance",
  "paise",
];

/** Trimmed lowercase header for comparison. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

/** Headers from the file that look like money or ledger data (for refusal). */
export function findMoneyHeaders(headers: string[]): string[] {
  return headers.filter((header) => {
    const name = normalizeHeader(header);
    if (MONEY_HEADER_EXACT.has(name)) return true;
    return MONEY_HEADER_STEMS.some((stem) => name.includes(stem));
  });
}

/**
 * Parse CSV text into a grid of cells. Handles quoted fields containing
 * commas, double-quote escapes (""), newlines inside quotes, CRLF and LF
 * endings, and a leading UTF-8 BOM. Dependency-free by design (no new npm
 * dep for the bulk flow).
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const char = src[i] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
      continue;
    }
    if (char === '"') {
      // An opening quote only starts a quoted field at a field boundary;
      // a stray quote mid-field is kept literally (lenient by design).
      if (field === "") {
        inQuotes = true;
      } else {
        field += char;
      }
      i += 1;
    } else if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (char === "\r" || char === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += char === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i += 1;
    }
  }
  // A trailing newline ends the last row; it never starts a new empty one.
  if (row.length > 0 || field !== "") {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Split pasted TSV text (what Excel puts on the clipboard: tab-separated
 * cells, newline-separated rows) into a grid. Same quoting rules as the CSV
 * parser: double-quote escapes ("") and quoted tabs/newlines. CRLF and LF
 * endings both split rows; a leading BOM is stripped.
 */
export function parseTsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const char = src[i] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
      continue;
    }
    if (char === '"') {
      if (field === "") {
        inQuotes = true;
      } else {
        field += char;
      }
      i += 1;
    } else if (char === "\t") {
      row.push(field);
      field = "";
      i += 1;
    } else if (char === "\r" || char === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += char === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i += 1;
    }
  }
  if (row.length > 0 || field !== "") {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Split a parsed grid into headers plus data rows. Drops blank lines and
 * `#` comment lines (the template documents its columns in trailing `#`
 * lines, so they must never parse as student rows).
 */
export function splitImportGrid(grid: string[][]): { headers: string[]; rows: string[][] } {
  const kept = grid.filter((cells) => {
    if (cells.every((cell) => cell.trim() === "")) return false;
    const first = (cells[0] ?? "").trim();
    return !first.startsWith("#");
  });
  const [headers = [], ...rows] = kept;
  return { headers, rows };
}

/** Escape one CSV cell (quotes when it holds a comma, quote, or newline). */
function escapeCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Build a CSV body (no BOM; `downloadCsv` adds it per BR-IMP-03). Amounts
 * passed here are already integer paise (Rule 6); this builder formats
 * nothing, it only escapes.
 */
export function buildCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  return (
    [headers, ...rows].map((cells) => cells.map(escapeCell).join(",")).join("\n") + "\n"
  );
}

/** Client-only download (Blob + anchor, no server roundtrip). */
export function downloadCsv(filename: string, body: string): void {
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Download filename for an entity export: buddysaradhi_<entity>_YYYY-MM-DD.csv. */
export function exportFilename(entity: string): string {
  return `buddysaradhi_${entity}_${new Date().toISOString().slice(0, 10)}.csv`;
}

/** The two fictional sample rows shipped inside the template. */
const TEMPLATE_SAMPLES: string[][] = [
  [
    "Aarav",
    "Sharma",
    "9876543210",
    "M",
    "2015-04-12",
    "21 MG Road, Pune",
    "Delhi Public School",
    "10",
    "CBSE",
    "Class 10 Maths 6pm",
    "2026-06-01",
    "postpaid",
    "2000",
    "active",
  ],
  [
    "Diya",
    "",
    "9123456789",
    "F",
    "2016-11-03",
    "",
    "Kendriya Vidyalaya",
    "9",
    "CBSE",
    "Class 9 Science 5pm",
    "2026-06-01",
    "postpaid",
    "1800",
    "active",
  ],
];

/**
 * Client-generated students template: exact headers, two sample rows, then a
 * `#` section documenting each column's validation rules (a CSV file has no
 * second sheet, so the guide travels as ignored comment lines).
 */
export function buildStudentsTemplate(): string {
  const guide = [
    "# Buddysaradhi students template. Lines starting with # are ignored on import.",
    "# Delete the two sample rows before importing, or leave them and fix the errors they report.",
    "# first_name: required, 1 to 80 characters.",
    "# last_name: optional, up to 80 characters.",
    "# phone: optional, 10 to 15 digits with optional leading +. Spaces, dashes and brackets are removed.",
    "# gender: optional, one of M, F, O. Leave blank if unknown.",
    "# dob: optional date of birth. Accepts YYYY-MM-DD (2015-04-12), DD/MM/YYYY (12/04/2015), or an Excel date number. Not before 1900-01-01, never in the future.",
    "# address: optional, up to 500 characters.",
    "# school: optional, up to 200 characters.",
    "# grade: optional, up to 40 characters, example 10th.",
    "# board: optional, up to 40 characters, example CBSE.",
    "# batch: required, batch name. Your student is enrolled in that batch. A missing batch is created on import.",
    "# admission_date: optional, defaults to today when blank. Same date formats as dob. Not before 2000-01-01, never in the future.",
    "# fee_model: optional, one of postpaid, prepaid, mixed. Blank means postpaid.",
    "# base_fee_rupees: optional monthly fee as a rupee decimal like 2000 or 2000.50. Blank means 0. Converted to integer paise on the server, never as a float.",
    "# status: optional, one of active, inactive, graduated, archived. Blank means active.",
    "# Exact duplicates (same name and phone ending) are skipped, never merged.",
    "# Financial columns (amount, balance, receipt, invoice, ledger) are never imported. This template has none.",
  ];
  return (
    buildCsv([...STUDENT_IMPORT_HEADERS], TEMPLATE_SAMPLES) + "\n" + guide.join("\n") + "\n"
  );
}

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dmyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const serialPattern = /^\d{1,6}(\.\d+)?$/;

/** Excel serial bounds: 1900-01-01 (1) to 2064-03-05 (60000). */
export const MIN_EXCEL_SERIAL = 1;
export const MAX_EXCEL_SERIAL = 60000;

function isRealDate(value: string): boolean {
  const match = isoPattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Excel date serial (days since 1899-12-30) to ISO YYYY-MM-DD. Fractions are
 * time-of-day and drop off for a date column. Returns null outside the sane
 * serial range so a stray number like a phone fragment is a row error, never
 * a guessed date.
 */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  if (whole < MIN_EXCEL_SERIAL || whole > MAX_EXCEL_SERIAL) return null;
  return new Date(Date.UTC(1899, 11, 30) + whole * 86400000).toISOString().slice(0, 10);
}

/**
 * ISO YYYY-MM-DD to Excel date serial (for the .xlsx template writer, which
 * stores sample dates the way Excel does: numbers with a date format).
 */
export function isoToExcelSerial(iso: string): number {
  const match = isoPattern.exec(iso);
  if (!match || !isRealDate(iso)) throw new Error(`isoToExcelSerial: not a real date ${iso}`);
  const ms =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) -
    Date.UTC(1899, 11, 30);
  return Math.round(ms / 86400000);
}

export type FlexibleDateResult = { ok: true; iso: string } | { ok: false; reason: string };

/**
 * 05_Students.md §14 — the three field caps the manual Add Student sheet and the
 * import both enforce, plus the two date floors. The sheet, the import schema
 * and the server action all read these constants, so a cap can never be widened
 * on one path and left behind on the other (05_Students.md §14 is a MUST and
 * "Server-side validation re-runs every rule (defence-in-depth)").
 */
export const STUDENT_FIRST_NAME_MAX = 80;
export const STUDENT_LAST_NAME_MAX = 80;
export const STUDENT_BATCH_MAX = 120;
export const STUDENT_GRADE_MAX = 40;
export const STUDENT_SCHOOL_MAX = 200;
export const STUDENT_ADDRESS_MAX = 500;
export const STUDENT_BOARD_MAX = 40;
export const STUDENT_DOB_FLOOR_ISO = "1900-01-01";
export const STUDENT_ADMISSION_FLOOR_ISO = "2000-01-01";

/** Phone characters 09 §14.5 says to strip before re-validating. */
const PHONE_STRIP = /[\s\-.]/g;

/** The clean form 09 §14.5 validates and stores: optional `+`, then 10–15 digits. */
const PHONE_CLEAN = /^\+?\d{10,15}$/;

/** Tenant-local today as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type PhoneResult = { ok: true; phone: string | null } | { ok: false; reason: string };

/**
 * THE phone rule (09 §14.5), in one place: strip spaces, dashes, dots and
 * brackets, then require an optional `+` followed by 10–15 digits. Blank is
 * absent, not an error.
 *
 * It is exported because the manual Add Student sheet, the import schema and
 * the server action must agree byte for byte. When the sheet accepted any
 * string while the import demanded 10–15 digits, the same tutor could not add a
 * student by hand that the same file would have accepted, and the stored
 * `dup_key` was built from a different four characters on each path — which
 * silently imports a second copy of a student.
 */
export function normalizeStudentPhone(raw: string, column = "phone"): PhoneResult {
  const cleaned = raw.replace(/[()]/g, "").replace(PHONE_STRIP, "");
  if (cleaned === "") return { ok: true, phone: null };
  if (!PHONE_CLEAN.test(cleaned)) {
    return {
      ok: false,
      reason: `${column}: "${shortValue(raw)}" is not a phone number. Use 10 to 15 digits, optionally starting with +.`,
    };
  }
  return { ok: true, phone: cleaned };
}

export interface DateBounds {
  /** Inclusive ISO floor. */
  min?: string;
  /** Inclusive ISO ceiling. Defaults to today — no student is admitted tomorrow. */
  max?: string;
  /** What the column is called in the tutor's message. */
  label?: string;
}

export type DateBoundsResult = { ok: true } | { ok: false; reason: string };

/**
 * 05_Students.md §14 + §11 E16: `admission_date` is required, ISO, at most
 * today and no earlier than 2000-01-01; `dob` is optional, ISO, at most today
 * and no earlier than 1900-01-01. ISO strings compare correctly with `<` and
 * `>`, so no Date round-trip (and no timezone shift) is involved.
 */
export function checkDateBounds(iso: string, bounds: DateBounds): DateBoundsResult {
  const label = bounds.label ?? "date";
  const ceiling = bounds.max ?? todayIso();
  if (bounds.min !== undefined && iso < bounds.min) {
    return { ok: false, reason: `${label} cannot be earlier than ${bounds.min}.` };
  }
  if (iso > ceiling) {
    return { ok: false, reason: `${label} cannot be later than ${ceiling}.` };
  }
  return { ok: true };
}

function shortValue(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 32 ? `${trimmed.slice(0, 32)}…` : trimmed;
}

/**
 * Migrated-sheet dates (09 §14.2 + owner order): YYYY-MM-DD, DD/MM/YYYY, or
 * an Excel serial number. Normalizes to YYYY-MM-DD. Anything else is a row
 * error that names the cell and the value, so the tutor knows which cell to
 * fix. MM/DD/YYYY is deliberately not a fourth format (09 §14.2: ambiguous);
 * a value like 31/12/2015 parses as DD/MM/YYYY, while 12/31/2015 fails as an
 * impossible DD/MM date with the same message.
 */
export function normalizeFlexibleDate(raw: string, column: string): FlexibleDateResult {
  const value = raw.trim();
  const iso = isoPattern.exec(value);
  if (iso) {
    if (!isRealDate(value)) {
      return { ok: false, reason: `${column}: "${shortValue(value)}" is not a real date` };
    }
    return { ok: true, iso: value };
  }
  const dmy = dmyPattern.exec(value);
  if (dmy) {
    const candidate = `${dmy[3]}-${dmy[2]?.padStart(2, "0")}-${dmy[1]?.padStart(2, "0")}`;
    if (!isRealDate(candidate)) {
      return { ok: false, reason: `${column}: "${shortValue(value)}" is not a real date` };
    }
    return { ok: true, iso: candidate };
  }
  if (serialPattern.test(value)) {
    const converted = excelSerialToIso(Number(value));
    if (converted === null) {
      return {
        ok: false,
        reason: `${column}: "${shortValue(value)}" is not a readable Excel date number`,
      };
    }
    return { ok: true, iso: converted };
  }
  return {
    ok: false,
    reason: `${column}: "${shortValue(value)}" is not a date. Use YYYY-MM-DD or DD/MM/YYYY.`,
  };
}

/**
 * Zod field for a flexible date column: blank means absent (the caller
 * defaults it — admission_date blanks to today server-side), otherwise the
 * value normalizes to YYYY-MM-DD or the row fails with the cell named.
 *
 * `bounds` enforces 05_Students.md §14's date windows (E16 for dob): nothing
 * before the floor, nothing after today. They apply AFTER the format
 * normalises, so `12/04/2015` and Excel `44927` are checked exactly like
 * `2015-04-12` rather than escaping the window by being written differently.
 */
function flexibleDateField(column: string, bounds?: DateBounds) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(32, `${column} must be 32 characters or fewer`)
      .transform((value, ctx) => {
        const parsed = normalizeFlexibleDate(value, column);
        if (!parsed.ok) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.reason });
          return z.NEVER;
        }
        if (bounds) {
          const window = checkDateBounds(parsed.iso, { ...bounds, label: column });
          if (!window.ok) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: window.reason });
            return z.NEVER;
          }
        }
        return parsed.iso;
      })
      .optional(),
  );
}

/**
 * One imported student row (09 §14.1 StudentImportSchema, extended to the
 * fourteen template headers). Field parity with the Add Student sheet
 * (add-student-sheet.tsx FormSchema) and the canonical create path
 * (server/actions/students.ts CreateStudentInputSchema): same required
 * columns (first_name, batch), same enum vocabs, the SAME length caps read
 * from the shared constants above (05_Students.md §14: first/last name 80,
 * grade 40, school 200, address 500, board 40, batch 120), the same phone
 * rule via `normalizeStudentPhone`, the same date windows via
 * `flexibleDateField`, the same fee_model default (postpaid), the same status
 * default (active), and the same base-fee decimal-string shape converted to
 * integer paise server-side with integer math only (Rule 6, BR-M-01). Blank
 * means absent for every optional column.
 *
 * Every cap and every rule below is imported by the manual sheet and the server
 * action rather than restated, which is the whole point: when the three were
 * independent literals, a paste and a hand-typed student that a tutor believed
 * were the same person produced different `dup_key` values and the app created
 * two students (05_Students.md §10.1 duplicate key; BR-STU-03).
 */
export const StudentImportRowSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(STUDENT_FIRST_NAME_MAX, `First name must be ${STUDENT_FIRST_NAME_MAX} characters or fewer`),
  last_name: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(STUDENT_LAST_NAME_MAX, `Last name must be ${STUDENT_LAST_NAME_MAX} characters or fewer`)
      .optional(),
  ),
  phone: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .transform((value, ctx) => {
        const parsed = normalizeStudentPhone(value);
        if (!parsed.ok) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.reason });
          return z.NEVER;
        }
        return parsed.phone;
      })
      .pipe(z.string().min(1))
      .optional(),
  ),
  gender: z.preprocess(emptyToUndefined, z.enum(["M", "F", "O"]).optional()),
  dob: flexibleDateField("dob", { min: STUDENT_DOB_FLOOR_ISO }),
  address: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(STUDENT_ADDRESS_MAX, `Address must be ${STUDENT_ADDRESS_MAX} characters or fewer`)
      .optional(),
  ),
  school: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(STUDENT_SCHOOL_MAX, `School must be ${STUDENT_SCHOOL_MAX} characters or fewer`)
      .optional(),
  ),
  grade: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(STUDENT_GRADE_MAX, `Grade must be ${STUDENT_GRADE_MAX} characters or fewer`)
      .optional(),
  ),
  board: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(STUDENT_BOARD_MAX, `Board must be ${STUDENT_BOARD_MAX} characters or fewer`)
      .optional(),
  ),
  batch: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .min(1, "Batch is required")
      .max(STUDENT_BATCH_MAX, `Batch must be ${STUDENT_BATCH_MAX} characters or fewer`),
  ),
  admission_date: flexibleDateField("admission_date", { min: STUDENT_ADMISSION_FLOOR_ISO }),
  fee_model: z.preprocess(
    (value: unknown) => (typeof value === "string" && value.trim() === "" ? "postpaid" : value),
    z.enum(["postpaid", "prepaid", "mixed"]),
  ),
  base_fee_rupees: z.preprocess(
    (value: unknown) => (typeof value === "string" && value.trim() === "" ? "0" : value),
    z
      .string()
      .trim()
      .regex(
        /^\d{1,12}(\.\d{1,6})?$/,
        "Monthly fee must be a non-negative rupee amount like 2000 or 2000.50",
      ),
  ),
  status: z.preprocess(
    (value: unknown) => (typeof value === "string" && value.trim() === "" ? "active" : value),
    z.enum(["active", "inactive", "graduated", "archived"]),
  ),
});

export type StudentImportRow = z.infer<typeof StudentImportRowSchema>;

/** One validated row plus its 1-based source index (0 = first data row). */
export interface ValidImportRow {
  index: number;
  data: StudentImportRow;
}

/** One row-level failure: spreadsheet row number, column, and reason. */
export interface ImportRowError {
  row: number;
  column: string;
  reason: string;
}

export type ImportFileCode =
  | "FINANCIAL_HEADERS"
  | "HEADER_MISMATCH"
  | "TOO_MANY_ROWS"
  | "EMPTY_FILE";

export interface ImportFileIssue {
  code: ImportFileCode;
  message: string;
  detail?: string[];
}

export type ValidateImportResult =
  | { ok: true; valid: ValidImportRow[]; invalid: ImportRowError[] }
  | { ok: false; issue: ImportFileIssue };

/**
 * Validate parsed headers plus data rows. File-level refusals (financial
 * headers, header mismatch, row cap) come back as `ok: false`; row-level
 * failures come back per row with number, column, and reason. Spreadsheet row
 * numbers count the header as row 1, so the first data row is row 2.
 */
export function validateImportRows(headers: string[], rows: string[][]): ValidateImportResult {
  if (headers.length === 0) {
    return {
      ok: false,
      issue: {
        code: "EMPTY_FILE",
        message: "This file has no headers. Download students-template.csv and keep its fourteen headers.",
      },
    };
  }
  const money = findMoneyHeaders(headers);
  if (money.length > 0) {
    return {
      ok: false,
      issue: {
        code: "FINANCIAL_HEADERS",
        message:
          "This file looks like financial data, so it was refused. Bulk import takes students only and never touches money or the ledger.",
        detail: money,
      },
    };
  }
  const normalized = headers.map(normalizeHeader);
  const expected: string[] = [...STUDENT_IMPORT_HEADERS];
  const missing = expected.filter((name) => !normalized.includes(name));
  const unexpected = normalized.filter((name) => !expected.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    return {
      ok: false,
      issue: {
        code: "HEADER_MISMATCH",
        message:
          "Headers do not match the students template. Download students-template.csv and keep its fourteen headers.",
        detail: [
          ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
          ...(unexpected.length > 0 ? [`unexpected: ${unexpected.join(", ")}`] : []),
        ],
      },
    };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      issue: {
        code: "TOO_MANY_ROWS",
        message: `This file has ${rows.length} rows. Split it into files of ${MAX_IMPORT_ROWS} rows or fewer.`,
      },
    };
  }
  const indexByHeader = new Map(normalized.map((name, index) => [name, index]));
  const valid: ValidImportRow[] = [];
  const invalid: ImportRowError[] = [];
  rows.forEach((cells, index) => {
    const rowNumber = index + 2;
    const record: Record<string, string> = {};
    for (const name of expected) {
      const cellIndex = indexByHeader.get(name) ?? -1;
      record[name] = cellIndex === -1 ? "" : (cells[cellIndex] ?? "");
    }
    const oversized = expected.find((name) => (record[name] ?? "").length > MAX_CELL_CHARS);
    if (oversized !== undefined) {
      invalid.push({
        row: rowNumber,
        column: oversized,
        reason: `Cell exceeds ${MAX_CELL_CHARS} characters`,
      });
      return;
    }
    const parsed = StudentImportRowSchema.safeParse(record);
    if (parsed.success) {
      valid.push({ index, data: parsed.data });
      return;
    }
    for (const issue of parsed.error.issues) {
      const column = typeof issue.path[0] === "string" ? (issue.path[0] as string) : "(row)";
      invalid.push({ row: rowNumber, column, reason: issue.message });
    }
  });
  return { ok: true, valid, invalid };
}

/** Digits-only phone for duplicate comparison (leading + ignored). */
export function dupPhoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * Duplicate key for exact-duplicate detection (09 §14.6 shape). This is the
 * SAME recipe as the manual Add Student flow (add-student-sheet.tsx doCreate:
 * first + last + last-4-of-phone, lowercased, non-alphanumeric stripped), so
 * a pasted row collides with a hand-typed student exactly when the sheet
 * would warn about it. Case, spacing, punctuation, and phone formatting never
 * create a second student; only the last four phone digits count, so a tutor
 * retyping +91 or a leading 0 still matches.
 */
export function studentDupKey(
  firstName: string,
  lastName: string | null | undefined,
  phone: string | null | undefined,
): string {
  const last4 = dupPhoneDigits(phone).slice(-4);
  return `${firstName ?? ""}${lastName ?? ""}${last4}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Split validated rows into first-seen rows and within-file repeats. Repeats
 * are skips, not errors (BR-STU-02: never silently merge, and never double
 * insert either).
 */
export function partitionDuplicates(valid: ValidImportRow[]): {
  unique: ValidImportRow[];
  duplicates: ValidImportRow[];
} {
  const seen = new Set<string>();
  const unique: ValidImportRow[] = [];
  const duplicates: ValidImportRow[] = [];
  for (const row of valid) {
    const key = studentDupKey(row.data.first_name, row.data.last_name, row.data.phone);
    if (seen.has(key)) {
      duplicates.push(row);
    } else {
      seen.add(key);
      unique.push(row);
    }
  }
  return { unique, duplicates };
}
