// Implements: 09_Backup_and_Import_Export.md §14 (validation rules) +
// 12_Business_Rules.md BR-IMP-03 (CSV contract).
//
// Unit tests for the dependency-free CSV parser, builder, template, and row
// validation shared by the Settings bulk import/export flow. Pure functions
// only; the DOM download helper is not exercised here.

import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_ROWS,
  STUDENT_ADDRESS_MAX,
  STUDENT_ADMISSION_FLOOR_ISO,
  STUDENT_BOARD_MAX,
  STUDENT_DOB_FLOOR_ISO,
  STUDENT_GRADE_MAX,
  STUDENT_IMPORT_HEADERS,
  STUDENT_SCHOOL_MAX,
  buildCsv,
  buildStudentsTemplate,
  checkDateBounds,
  excelSerialToIso,
  findMoneyHeaders,
  isoToExcelSerial,
  normalizeFlexibleDate,
  normalizeStudentPhone,
  parseCsv,
  parseTsv,
  partitionDuplicates,
  splitImportGrid,
  studentDupKey,
  todayIso,
  validateImportRows,
} from "./csv-parse";

const HEADERS = [...STUDENT_IMPORT_HEADERS];

function row(cells: string[]): string[] {
  return cells;
}

/** Fourteen-cell row with valid defaults; override any column by name. */
function fullRow(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    first_name: "Aarav",
    last_name: "Sharma",
    phone: "9876543210",
    gender: "M",
    dob: "2015-04-12",
    address: "21 MG Road, Pune",
    school: "Delhi Public School",
    grade: "10",
    board: "CBSE",
    batch: "Class 10 Maths 6pm",
    admission_date: "2026-06-01",
    fee_model: "postpaid",
    base_fee_rupees: "2000",
    status: "active",
  };
  return HEADERS.map((header) => overrides[header] ?? base[header] ?? "");
}

describe("parseCsv", () => {
  it("parses a simple grid", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted commas", () => {
    expect(parseCsv('"Sharma, Jr.",active\n')).toEqual([["Sharma, Jr.", "active"]]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('"Say ""hi""",ok\n')).toEqual([['Say "hi"', "ok"]]);
  });

  it("handles newlines inside quotes", () => {
    expect(parseCsv("a,\"line1\nline2\",c\n")).toEqual([["a", "line1\nline2", "c"]]);
  });

  it("handles CRLF endings and a leading BOM", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv("a,,c\n")).toEqual([["a", "", "c"]]);
  });

  it("keeps a stray mid-field quote literally", () => {
    expect(parseCsv("a\"b,c\n")).toEqual([['a"b', "c"]]);
  });
});

describe("import headers (Add Student parity)", () => {
  it("ships fourteen columns, name split into first and last", () => {
    expect(HEADERS).toEqual([
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
    ]);
  });

  it("leaves the money-guard silent on the fee columns", () => {
    expect(findMoneyHeaders(HEADERS)).toEqual([]);
    expect(findMoneyHeaders(["fee_model", "base_fee_rupees"])).toEqual([]);
  });
});

describe("parseTsv", () => {
  it("splits Excel clipboard text on tabs and newlines", () => {
    expect(parseTsv("Aarav\tSharma\t9876543210\nDiya\t\t9123456789\n")).toEqual([
      ["Aarav", "Sharma", "9876543210"],
      ["Diya", "", "9123456789"],
    ]);
  });

  it("handles quoted tabs and newlines inside a pasted cell", () => {
    expect(parseTsv("a\t\"line1\nline2\tstill\"\tc\n")).toEqual([
      ["a", "line1\nline2\tstill", "c"],
    ]);
  });

  it("handles CRLF endings and a leading BOM", () => {
    expect(parseTsv("﻿a\tb\r\n1\t2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("flexible dates (migrated sheets)", () => {
  it("passes ISO through untouched", () => {
    expect(normalizeFlexibleDate("2015-04-12", "dob")).toEqual({ ok: true, iso: "2015-04-12" });
  });

  it("converts DD/MM/YYYY to ISO", () => {
    expect(normalizeFlexibleDate("12/04/2015", "dob")).toEqual({ ok: true, iso: "2015-04-12" });
    expect(normalizeFlexibleDate("3/6/2026", "admission_date")).toEqual({
      ok: true,
      iso: "2026-06-03",
    });
  });

  it("converts Excel serials to ISO", () => {
    expect(normalizeFlexibleDate("44927", "dob")).toEqual({ ok: true, iso: "2023-01-01" });
    expect(normalizeFlexibleDate("44197", "admission_date")).toEqual({
      ok: true,
      iso: "2021-01-01",
    });
  });

  it("names the cell on garbage input", () => {
    const parsed = normalizeFlexibleDate("not a date", "dob");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toContain("dob");
      expect(parsed.reason).toContain("YYYY-MM-DD");
    }
  });

  it("rejects impossible DD/MM dates as not real", () => {
    const parsed = normalizeFlexibleDate("31/02/2024", "dob");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("real date");
  });

  it("rejects MM/DD/YYYY-style values instead of guessing", () => {
    const parsed = normalizeFlexibleDate("12/31/2015", "dob");
    expect(parsed.ok).toBe(false);
  });

  it("rejects out-of-range serials instead of guessing", () => {
    const parsed = normalizeFlexibleDate("99999999", "dob");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("dob");
  });

  it("round-trips ISO through Excel serials", () => {
    expect(isoToExcelSerial("2023-01-01")).toBe(44927);
    expect(excelSerialToIso(44927)).toBe("2023-01-01");
    expect(excelSerialToIso(0)).toBe(null);
    expect(excelSerialToIso(60001)).toBe(null);
  });
});

describe("buildCsv", () => {
  it("escapes commas, quotes, and newlines", () => {
    const body = buildCsv(["name", "note"], [["Sharma, Jr.", 'Say "hi"\nbye']]);
    expect(body).toBe('name,note\n"Sharma, Jr.","Say ""hi""\nbye"\n');
  });

  it("round-trips through parseCsv", () => {
    const headers = ["first_name", "last_name"];
    const rows = [["Aar,av", 'O"Brien'], ["Plain", "Name"]];
    expect(parseCsv(buildCsv(headers, rows))).toEqual([headers, ...rows]);
  });
});

describe("splitImportGrid", () => {
  it("drops blank lines and # comment lines", () => {
    const grid = parseCsv(
      HEADERS.join(",") + "\nAarav,Sharma\n\n# guide line\nDiya,,\n",
    );
    expect(splitImportGrid(grid)).toEqual({
      headers: HEADERS,
      rows: [row(["Aarav", "Sharma"]), row(["Diya", "", ""])],
    });
  });
});

describe("buildStudentsTemplate", () => {
  it("ships exact headers, two samples, and a column guide", () => {
    const body = buildStudentsTemplate();
    const { headers, rows } = splitImportGrid(parseCsv(body));
    expect(headers).toEqual(HEADERS);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[0]).toBe("Aarav");
    expect(rows[1]?.[0]).toBe("Diya");
    for (const name of HEADERS) {
      expect(body).toContain(`# ${name}:`);
    }
  });

  it("template samples validate cleanly", () => {
    const { headers, rows } = splitImportGrid(parseCsv(buildStudentsTemplate()));
    const result = validateImportRows(headers, rows);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invalid).toEqual([]);
      expect(result.valid).toHaveLength(2);
    }
  });
});

describe("findMoneyHeaders", () => {
  it("flags money and ledger headers", () => {
    expect(findMoneyHeaders(["first_name", "amount", "receipt_no"])).toEqual([
      "amount",
      "receipt_no",
    ]);
  });

  it("leaves the student template headers alone", () => {
    expect(findMoneyHeaders(HEADERS)).toEqual([]);
  });
});

describe("validateImportRows", () => {
  it("refuses financial headers with a typed code", () => {
    const result = validateImportRows(["first_name", "amount"], [["Aarav", "100"]]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("FINANCIAL_HEADERS");
      expect(result.issue.detail).toContain("amount");
    }
  });

  it("refuses header mismatch with missing and unexpected lists", () => {
    const result = validateImportRows(["first_name", "nickname"], [["Aarav", "x"]]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("HEADER_MISMATCH");
      expect(result.issue.detail?.join(" ")).toContain("missing");
      expect(result.issue.detail?.join(" ")).toContain("nickname");
    }
  });

  it("refuses an empty file with a typed code", () => {
    const result = validateImportRows([], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe("EMPTY_FILE");
  });

  it("refuses oversized files with a typed code", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ["Aarav", "", "", "", "", "", ""]);
    const result = validateImportRows(HEADERS, rows);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe("TOO_MANY_ROWS");
  });

  it("reports per-row errors with row number, column, and reason", () => {
    const result = validateImportRows(HEADERS, [
      fullRow({ first_name: "", phone: "abc", gender: "X", dob: "12-31-2015", status: "Active" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid).toHaveLength(0);
      const reasonsFor = (column: string): string[] =>
        result.invalid.filter((error) => error.column === column).map((error) => error.reason);
      expect(result.invalid[0]?.row).toBe(2);
      expect(reasonsFor("first_name").some((reason) => reason.includes("required"))).toBe(true);
      expect(reasonsFor("phone").some((reason) => reason.includes("10 to 15 digits"))).toBe(true);
      expect(reasonsFor("gender").some((reason) => reason.includes("M"))).toBe(true);
      expect(
        reasonsFor("dob").some((reason) => reason.includes("YYYY-MM-DD")),
      ).toBe(true);
      expect(reasonsFor("status").some((reason) => reason.includes("active"))).toBe(true);
      for (const error of result.invalid) {
        expect(typeof error.column).toBe("string");
        expect(typeof error.reason).toBe("string");
      }
    }
  });

  it("rejects an impossible date", () => {
    const result = validateImportRows(
      HEADERS,
      [fullRow({ dob: "2024-02-30" })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0]?.reason).toContain("real date");
    }
  });

  it("accepts DD/MM/YYYY and Excel serials in date columns", () => {
    const result = validateImportRows(HEADERS, [
      fullRow({ dob: "12/04/2015", admission_date: "44927" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invalid).toEqual([]);
      expect(result.valid[0]?.data).toMatchObject({ dob: "2015-04-12", admission_date: "2023-01-01" });
    }
  });

  it("reports an unparseable date with the cell named", () => {
    const result = validateImportRows(HEADERS, [fullRow({ dob: "sometime" })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid).toHaveLength(0);
      const dobErrors = result.invalid.filter((error) => error.column === "dob");
      expect(dobErrors).toHaveLength(1);
      expect(dobErrors[0]?.reason).toContain("dob");
    }
  });

  it("requires batch like the Add Student sheet", () => {
    const result = validateImportRows(HEADERS, [fullRow({ batch: "" })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid).toHaveLength(0);
      expect(result.invalid.some((error) => error.column === "batch")).toBe(true);
    }
  });

  it("defaults fee_model, base fee, status, and blanks out dates", () => {
    const result = validateImportRows(
      HEADERS,
      [fullRow({ fee_model: "", base_fee_rupees: "", status: "", dob: "", admission_date: "" })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid[0]?.data).toMatchObject({
        first_name: "Aarav",
        fee_model: "postpaid",
        base_fee_rupees: "0",
        status: "active",
      });
      expect(result.valid[0]?.data.phone).toBe("9876543210");
      expect(result.valid[0]?.data.dob).toBeUndefined();
      expect(result.valid[0]?.data.admission_date).toBeUndefined();
    }
  });

  it("rejects an unknown fee_model instead of guessing", () => {
    const result = validateImportRows(HEADERS, [fullRow({ fee_model: "yearly" })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid).toHaveLength(0);
      expect(result.invalid.some((error) => error.column === "fee_model")).toBe(true);
    }
  });

  it("rejects non-decimal monthly fees (negative, letters, sub-paisa)", () => {
    for (const fee of ["-5", "abc", "12.3456789"]) {
      const result = validateImportRows(HEADERS, [fullRow({ base_fee_rupees: fee })]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.valid).toHaveLength(0);
        expect(
          result.invalid.some((error) => error.column === "base_fee_rupees"),
        ).toBe(true);
      }
    }
  });

  it("caps the new text fields at the manual create limits", () => {
    // 05_Students.md §14 — these are now the SHARED caps the manual Add Student
    // sheet and the server action also read (`STUDENT_*_MAX` in csv-parse.ts), not
    // three independent literals. They used to be grade 64 / school 300 /
    // address 1000 / board 64 here while §14 said 40 / 200 / 500 / 40.
    const cases: Array<[string, string, number]> = [
      ["address", "Address", STUDENT_ADDRESS_MAX],
      ["school", "School", STUDENT_SCHOOL_MAX],
      ["grade", "Grade", STUDENT_GRADE_MAX],
      ["board", "Board", STUDENT_BOARD_MAX],
    ];
    for (const [column, label, limit] of cases) {
      const tooLong = "x".repeat(limit + 1);
      const result = validateImportRows(HEADERS, [fullRow({ [column]: tooLong })]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.valid).toHaveLength(0);
        expect(
          result.invalid.some(
            (error) => error.column === column && error.reason.includes(label),
          ),
        ).toBe(true);
      }
    }
  });

  it("cleans phone punctuation before validating", () => {
    const result = validateImportRows(HEADERS, [
      fullRow({ phone: "+91 98765-43210" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid[0]?.data.phone).toBe("+919876543210");
    }
  });
});

describe("studentDupKey + partitionDuplicates", () => {
  it("treats case, spacing, and phone format as the same student", () => {
    expect(studentDupKey("Aarav", "Sharma", "+91 98765 43210")).toBe(
      studentDupKey("  aarav ", "sharma", "919876543210"),
    );
  });

  it("matches the Add Student sheet dup key (name plus last four digits)", () => {
    // add-student-sheet.tsx doCreate: (first + last + phoneLast4).toLowerCase()
    // with non-alphanumerics stripped. A pasted row collides exactly when the
    // sheet would warn, so the same name+phone always means the same student.
    const manualDupKey = ("Aarav" + "Sharma" + "9876543210".slice(-4))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    expect(studentDupKey("Aarav", "Sharma", "9876543210")).toBe(manualDupKey);
    expect(manualDupKey).toBe("aaravsharma3210");
    expect(studentDupKey("Aarav", "Sharma", "+91-98765-43210")).toBe(manualDupKey);
    expect(studentDupKey("Aarav", "Sharma", "9123456789")).not.toBe(manualDupKey);
  });

  it("marks the second within-file occurrence a duplicate", () => {
    const result = validateImportRows(HEADERS, [
      fullRow(),
      fullRow(),
      fullRow({ first_name: "Diya", last_name: "", phone: "9123456789", gender: "F", dob: "", batch: "Class 9 Science 5pm" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { unique, duplicates } = partitionDuplicates(result.valid);
      expect(unique).toHaveLength(2);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.index).toBe(1);
    }
  });

  // The defect this locks down: the Add Student sheet used to compute its own
  // key by slicing the last four characters off the RAW phone string, so
  // "9876543210" and "9876543210 " (a trailing space is one keystroke) hashed
  // differently and the second student was written with no duplicate warning.
  it("is insensitive to trailing whitespace and punctuation in the phone", () => {
    const canonical = studentDupKey("Aarav", "Sharma", "9876543210");
    expect(studentDupKey("Aarav", "Sharma", "9876543210 ")).toBe(canonical);
    expect(studentDupKey("Aarav", "Sharma", "+91 98765-43210")).toBe(canonical);
    expect(studentDupKey("Aarav", "Sharma", "098765-43210")).toBe(canonical);
  });
});

// ---------------------------------------------------------------------------
// 05_Students.md §14 + §11 E16 — the date windows. Neither path enforced them:
// a student could be admitted in 2099 or born yesterday's century.
// ---------------------------------------------------------------------------

describe("checkDateBounds", () => {
  it("rejects a date after today (EC-S-16 / a dob in the future)", () => {
    const future = "2999-01-01";
    const result = checkDateBounds(future, { min: STUDENT_DOB_FLOOR_ISO, label: "dob" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("later than");
  });

  it("rejects a date before the field's floor", () => {
    expect(checkDateBounds("1899-12-31", { min: STUDENT_DOB_FLOOR_ISO, label: "dob" }).ok).toBe(false);
    expect(checkDateBounds("1999-12-31", { min: STUDENT_ADMISSION_FLOOR_ISO, label: "admission_date" }).ok).toBe(
      false,
    );
  });

  it("accepts today and any date inside the window", () => {
    const today = todayIso();
    expect(checkDateBounds(today, { min: STUDENT_ADMISSION_FLOOR_ISO, label: "admission_date" }).ok).toBe(true);
    expect(checkDateBounds(STUDENT_ADMISSION_FLOOR_ISO, { min: STUDENT_ADMISSION_FLOOR_ISO }).ok).toBe(true);
    expect(checkDateBounds("2015-04-12", { min: STUDENT_DOB_FLOOR_ISO }).ok).toBe(true);
  });

  it("honours an explicit ceiling", () => {
    expect(checkDateBounds("2020-01-01", { max: "2019-12-31" }).ok).toBe(false);
  });

  it("applies the window to an IMPORT row after the date normalises", () => {
    // A future date written as DD/MM/YYYY, not as ISO, must not slip past the
    // check — that is the whole reason the bound runs post-transform.
    const result = validateImportRows(HEADERS, [
      fullRow({ dob: "01/01/2999", admission_date: "01/01/2999" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid).toHaveLength(0);
      const dobErrors = result.invalid.filter((error) => error.column === "dob");
      const admissionErrors = result.invalid.filter((error) => error.column === "admission_date");
      expect(dobErrors).toHaveLength(1);
      expect(admissionErrors).toHaveLength(1);
      expect(dobErrors[0]?.reason).toContain("later than");
    }
  });

  it("applies the floor to an Excel serial in the import", () => {
    // Serial 1 = 1900-01-01, below the dob floor.
    const result = validateImportRows(HEADERS, [fullRow({ dob: "1" })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid).toHaveLength(0);
      expect(result.invalid.some((error) => error.column === "dob")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 09 §14.5 — ONE phone rule, shared by the sheet, the import and the server.
// The sheet used to accept any string, so "abc" was a storable phone and the
// duplicate key was built from its last four characters.
// ---------------------------------------------------------------------------

describe("normalizeStudentPhone", () => {
  it("cleans punctuation and keeps the digits", () => {
    expect(normalizeStudentPhone("+91 98765-43210")).toEqual({ ok: true, phone: "+919876543210" });
    expect(normalizeStudentPhone("(98765) 43210")).toEqual({ ok: true, phone: "9876543210" });
    expect(normalizeStudentPhone("98765.43210")).toEqual({ ok: true, phone: "9876543210" });
  });

  it("treats blank as absent, not as an error", () => {
    expect(normalizeStudentPhone("")).toEqual({ ok: true, phone: null });
    expect(normalizeStudentPhone("   ")).toEqual({ ok: true, phone: null });
  });

  it("rejects letters, short numbers and long numbers", () => {
    for (const bad of ["abc", "12345", "1234567890123456"]) {
      const result = normalizeStudentPhone(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("names the column in its message so the tutor knows which cell to fix", () => {
    const result = normalizeStudentPhone("abc", "phone");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("phone");
      expect(result.reason).toContain("abc");
    }
  });

  it("is the same rule the import row schema applies", () => {
    const result = validateImportRows(HEADERS, [fullRow({ phone: "+91 98765-43210" })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid[0]?.data.phone).toBe("+919876543210");
    }
    const rejected = validateImportRows(HEADERS, [fullRow({ phone: "call me" })]);
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(rejected.valid).toHaveLength(0);
      expect(rejected.invalid.some((error) => error.column === "phone")).toBe(true);
    }
  });
});
