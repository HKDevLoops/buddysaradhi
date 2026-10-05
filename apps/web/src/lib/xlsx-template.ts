// Implements: 09_Backup_and_Import_Export.md §10.4 (import template,
// TemplateGenerator.ts → generateTemplate) + §14.1 (row schema vocab).
//
// Dependency-free .xlsx writer for the students template (no new npm dep by
// owner order). A stored (no-compression) ZIP is a genuine .xlsx: Excel,
// Google Sheets, and LibreOffice all open method-0 entries. The workbook has
// two sheets — "Template" (styled header row, column widths, two sample rows,
// dropdown validations for the enum columns, date-formatted admission cells)
// and "Instructions" (column rules, date formats, and the note that CSV
// upload and the paste grid accept the same fourteen columns).
//
// Every function here is pure except `downloadXlsx`, the single client-only
// download helper (same shape as `downloadCsv` in csv-parse.ts).

import { STUDENT_IMPORT_HEADERS, isoToExcelSerial } from "./csv-parse";

/** Filename of the client-generated Excel template (no server roundtrip). */
export const STUDENT_XLSX_TEMPLATE_FILENAME = "students-template.xlsx";

/** Client-only download (Blob + anchor, no server roundtrip). */
export function downloadXlsx(filename: string, bytes: Uint8Array): void {
  // Fresh copy: `new Uint8Array(length)` owns a real ArrayBuffer, which keeps
  // the Blob constructor happy under strict TS without any `as` casts.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

let CRC_TABLE: Uint32Array | null = null;

/** CRC-32 (IEEE) over raw bytes — the ZIP integrity field per entry. */
export function crc32(data: Uint8Array): number {
  let table = CRC_TABLE;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    CRC_TABLE = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (table[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Stored (method 0) ZIP writer: local header + raw bytes per entry, then the
 * central directory and end record. Stored entries keep the XML readable in
 * the bytes, which is what the byte-level test asserts on.
 */
export function buildStoredZip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8 filenames
    view.setUint16(8, 0, true); // stored
    view.setUint16(10, 0, true); // time (fixed: template bytes are stable)
    view.setUint16(12, 0x21, true); // date (fixed)
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    header.set(name, 30);
    chunks.push(header, entry.data);

    const dir = new Uint8Array(46 + name.length);
    const dirView = new DataView(dir.buffer);
    dirView.setUint32(0, 0x02014b50, true);
    dirView.setUint16(4, 20, true);
    dirView.setUint16(6, 20, true);
    dirView.setUint16(8, 0x0800, true);
    dirView.setUint16(10, 0, true);
    dirView.setUint16(12, 0, true);
    dirView.setUint16(14, 0x21, true);
    dirView.setUint32(16, crc, true);
    dirView.setUint32(20, entry.data.length, true);
    dirView.setUint32(24, entry.data.length, true);
    dirView.setUint16(28, name.length, true);
    dirView.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);
    offset += header.length + entry.data.length;
  }
  const centralStart = offset;
  const centralBytes = concat(central);
  offset += centralBytes.length;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, centralStart, true);
  return concat([...chunks, centralBytes, end]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 1-based column index to Excel letters (1 → A, 14 → N). */
export function columnLetter(index: number): string {
  let letters = "";
  let rest = index;
  while (rest > 0) {
    const mod = (rest - 1) % 26;
    letters = String.fromCharCode(65 + mod) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

type SheetCell = { value: string; style?: number } | { serial: number; style?: number };

function cellXml(ref: string, sharedIndexByText: Map<string, number>, cell: SheetCell): string {
  if ("serial" in cell) {
    const style = cell.style !== undefined ? ` s="${cell.style}"` : "";
    return `<c r="${ref}"${style}><v>${cell.serial}</v></c>`;
  }
  const index = sharedIndexByText.get(cell.value);
  const style = cell.style !== undefined ? ` s="${cell.style}"` : "";
  if (index === undefined) {
    return `<c r="${ref}"${style} t="inlineStr"><is><t>${escapeXml(cell.value)}</t></is></c>`;
  }
  return `<c r="${ref}"${style} t="s"><v>${index}</v></c>`;
}

function sheetXml(
  rows: SheetCell[][],
  sharedIndexByText: Map<string, number>,
  widths: number[],
  validations: string,
  dimension: string,
): string {
  const cols = widths
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const body = rows
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const xml = cells
        .map((cell, colIndex) => cellXml(`${columnLetter(colIndex + 1)}${rowNumber}`, sharedIndexByText, cell))
        .join("");
      return `<row r="${rowNumber}">${xml}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><selection activeCell="A2" sqref="A2"/></sheetView></sheetViews>` +
    `<sheetFormat defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${body}</sheetData>` +
    validations +
    `</worksheet>`
  );
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets>` +
  `<sheet name="Template" sheetId="1" r:id="rId1"/>` +
  `<sheet name="Instructions" sheetId="2" r:id="rId2"/>` +
  `</sheets>` +
  `</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
  `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF0E7C5B"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

const HEADER_STYLE = 1;
const DATE_STYLE = 2;

const TEMPLATE_WIDTHS = [14, 14, 16, 9, 13, 24, 22, 9, 9, 22, 15, 11, 16, 11];

const GENDER_OPTIONS = "M,F,O";
const FEE_MODEL_OPTIONS = "postpaid,prepaid,mixed";
const STATUS_OPTIONS = "active,inactive,graduated,archived";

/** Dropdown validations over rows 2–1000 for the three enum columns. */
function templateValidations(): string {
  const rule = (options: string, column: string): string =>
    `<dataValidation type="list" allowBlank="1" showDropDown="0" showErrorMessage="1" sqref="${column}2:${column}1000">` +
    `<formula1>&quot;${options}&quot;</formula1>` +
    `</dataValidation>`;
  return (
    `<dataValidations count="3">` +
    rule(GENDER_OPTIONS, "D") +
    rule(FEE_MODEL_OPTIONS, "L") +
    rule(STATUS_OPTIONS, "N") +
    `</dataValidations>`
  );
}

function sharedStringsXml(strings: string[]): string {
  const items = strings.map((text) => `<si><t>${escapeXml(text)}</t></si>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    items +
    `</sst>`
  );
}

const INSTRUCTION_ROWS: string[][] = [
  ["Buddysaradhi students template — how to fill it", ""],
  ["Same columns everywhere", "The CSV upload and the paste grid in Settings → Bulk import accept these same fourteen columns."],
  ["first_name", "Required, 1 to 80 characters."],
  ["last_name", "Optional, up to 80 characters."],
  ["phone", "Optional, 10 to 15 digits with optional leading +. Spaces, dashes and brackets are removed."],
  ["gender", "Optional, one of M, F, O. Leave blank if unknown."],
  ["dob", "Optional date of birth: YYYY-MM-DD (2015-04-12), DD/MM/YYYY (12/04/2015), or an Excel date number."],
  ["address", "Optional, up to 1000 characters."],
  ["school", "Optional, up to 300 characters."],
  ["grade", "Optional, up to 64 characters, example 10th."],
  ["board", "Optional, up to 64 characters, example CBSE."],
  ["batch", "Required. Your student is enrolled in that batch; a missing batch is created on import."],
  ["admission_date", "Optional, defaults to today when blank. Same date formats as dob."],
  ["fee_model", "Optional, one of postpaid, prepaid, mixed. Blank means postpaid."],
  ["base_fee_rupees", "Optional monthly fee as a rupee decimal like 2000 or 2000.50. Blank means 0."],
  ["status", "Optional, one of active, inactive, graduated, archived. Blank means active."],
  ["Matching rows are skipped", "A row with the same name and phone ending as an existing student is skipped, never merged."],
  ["Imports never touch money", "Bulk import adds students only. It never writes to the ledger."],
];

/**
 * Build the genuine .xlsx bytes: Template sheet (styled header, widths, two
 * sample rows with real Excel date serials, enum dropdowns) plus the
 * Instructions sheet above. Sample students are the same fictional pair as
 * the CSV template.
 */
export function buildStudentsXlsxTemplate(): Uint8Array {
  const headers: string[] = [...STUDENT_IMPORT_HEADERS];
  const samples: Array<Array<string | number>> = [
    ["Aarav", "Sharma", "9876543210", "M", "2015-04-12", "21 MG Road, Pune", "Delhi Public School", "10", "CBSE", "Class 10 Maths 6pm", "2026-06-01", "postpaid", "2000", "active"],
    ["Diya", "", "9123456789", "F", "2016-11-03", "", "Kendriya Vidyalaya", "9", "CBSE", "Class 9 Science 5pm", "2026-06-01", "postpaid", "1800", "active"],
  ];
  const dateColumns = new Set(["dob", "admission_date"]);

  const shared: string[] = [];
  const sharedIndexByText = new Map<string, number>();
  const intern = (text: string): void => {
    if (!sharedIndexByText.has(text)) {
      sharedIndexByText.set(text, shared.length);
      shared.push(text);
    }
  };
  for (const header of headers) intern(header);
  for (const row of samples) {
    for (const value of row) {
      if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) intern(value);
    }
  }
  for (const row of INSTRUCTION_ROWS) {
    for (const value of row) intern(value);
  }

  const toCell = (value: string | number, column: string): SheetCell => {
    if (typeof value === "string" && dateColumns.has(column) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { serial: isoToExcelSerial(value), style: DATE_STYLE };
    }
    return { value: String(value) };
  };
  const templateRows: SheetCell[][] = [
    headers.map((header) => ({ value: header, style: HEADER_STYLE })),
    ...samples.map((row) => row.map((value, i) => toCell(value, headers[i] ?? ""))),
  ];
  const lastColumn = columnLetter(headers.length);
  const templateSheet = sheetXml(
    templateRows,
    sharedIndexByText,
    TEMPLATE_WIDTHS,
    templateValidations(),
    `A1:${lastColumn}${templateRows.length}`,
  );
  const instructionRows: SheetCell[][] = INSTRUCTION_ROWS.map((row) =>
    row.map((value) => ({ value })),
  );
  const instructionsSheet = sheetXml(
    instructionRows,
    sharedIndexByText,
    [34, 90],
    "",
    `A1:B${instructionRows.length}`,
  );

  return buildStoredZip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: encoder.encode(WORKBOOK) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(WORKBOOK_RELS) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(templateSheet) },
    { name: "xl/worksheets/sheet2.xml", data: encoder.encode(instructionsSheet) },
    { name: "xl/sharedStrings.xml", data: encoder.encode(sharedStringsXml(shared)) },
    { name: "xl/styles.xml", data: encoder.encode(STYLES) },
  ]);
}
