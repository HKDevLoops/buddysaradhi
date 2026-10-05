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

/** Exact headers of the students import template (order matters in the file). */
export const STUDENT_IMPORT_HEADERS = [
  "first_name",
  "last_name",
  "phone",
  "gender",
  "dob_yyyy_mm_dd",
  "batch",
  "status",
] as const;

/** Filename of the client-generated template (no server roundtrip). */
export const STUDENT_TEMPLATE_FILENAME = "students-template.csv";

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
  ["Aarav", "Sharma", "9876543210", "M", "2015-04-12", "Class 10 Maths 6pm", "active"],
  ["Diya", "", "9123456789", "F", "2016-11-03", "Class 9 Science 5pm", "active"],
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
    "# dob_yyyy_mm_dd: optional, date of birth as YYYY-MM-DD, example 2015-04-12.",
    "# batch: optional, batch name. Your student is enrolled in that batch. A missing batch is created on import.",
    "# status: optional, one of active, inactive, graduated, archived. Blank means active.",
    "# Exact duplicates (same name and phone) are skipped, never merged.",
    "# Financial columns (amount, balance, receipt, invoice, ledger) are never imported. This template has none.",
  ];
  return (
    buildCsv([...STUDENT_IMPORT_HEADERS], TEMPLATE_SAMPLES) + "\n" + guide.join("\n") + "\n"
  );
}

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const dobPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const match = dobPattern.exec(value);
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
 * One imported student row (09 §14.1 StudentImportSchema, narrowed to the
 * seven template headers). Blank means absent for every optional column;
 * status blanks to active; status and gender vocab is strict lowercase
 * (09 §14.4: a typo is a row error, not a guess).
 */
export const StudentImportRowSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(80, "First name must be 80 characters or fewer"),
  last_name: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(80, "Last name must be 80 characters or fewer").optional(),
  ),
  phone: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .transform((value) => value.replace(/[\s\-.()]/g, ""))
      .pipe(
        z
          .string()
          .regex(/^\+?\d{10,15}$/, "Phone must be 10 to 15 digits with optional leading +"),
      )
      .optional(),
  ),
  gender: z.preprocess(emptyToUndefined, z.enum(["M", "F", "O"]).optional()),
  dob_yyyy_mm_dd: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
      .refine(isRealDate, "Date of birth is not a real date")
      .optional(),
  ),
  batch: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(120, "Batch must be 120 characters or fewer").optional(),
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
        message: "This file has no headers. Download students-template.csv and keep its seven headers.",
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
          "Headers do not match the students template. Download students-template.csv and keep its seven headers.",
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
 * Duplicate key for exact-duplicate detection (same name and phone, 09 §14.6
 * shape, full phone for exactness). Case and surrounding space never create
 * a second student.
 */
export function studentDupKey(
  firstName: string,
  lastName: string | null | undefined,
  phone: string | null | undefined,
): string {
  return `${firstName.trim().toLowerCase()}|${(lastName ?? "").trim().toLowerCase()}|${dupPhoneDigits(phone)}`;
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
