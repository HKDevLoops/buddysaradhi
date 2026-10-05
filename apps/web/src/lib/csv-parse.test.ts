// Implements: 09_Backup_and_Import_Export.md §14 (validation rules) +
// 12_Business_Rules.md BR-IMP-03 (CSV contract).
//
// Unit tests for the dependency-free CSV parser, builder, template, and row
// validation shared by the Settings bulk import/export flow. Pure functions
// only; the DOM download helper is not exercised here.

import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_ROWS,
  STUDENT_IMPORT_HEADERS,
  buildCsv,
  buildStudentsTemplate,
  findMoneyHeaders,
  parseCsv,
  partitionDuplicates,
  splitImportGrid,
  studentDupKey,
  validateImportRows,
} from "./csv-parse";

const HEADERS = [...STUDENT_IMPORT_HEADERS];

function row(cells: string[]): string[] {
  return cells;
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
      ["", "", "abc", "X", "12-31-2015", "", "Active"],
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
        reasonsFor("dob_yyyy_mm_dd").some((reason) => reason.includes("YYYY-MM-DD")),
      ).toBe(true);
      expect(reasonsFor("status").some((reason) => reason.includes("active"))).toBe(true);
      for (const error of result.invalid) {
        expect(typeof error.column).toBe("string");
        expect(typeof error.reason).toBe("string");
      }
    }
  });

  it("rejects an impossible date", () => {
    const result = validateImportRows(HEADERS, [
      ["Aarav", "", "", "", "2024-02-30", "", ""],
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0]?.reason).toContain("real date");
    }
  });

  it("blanks out optional columns and defaults status to active", () => {
    const result = validateImportRows(HEADERS, [["Aarav", "", "", "", "", "", ""]]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid[0]?.data).toMatchObject({ first_name: "Aarav", status: "active" });
      expect(result.valid[0]?.data.phone).toBeUndefined();
      expect(result.valid[0]?.data.gender).toBeUndefined();
    }
  });

  it("cleans phone punctuation before validating", () => {
    const result = validateImportRows(HEADERS, [
      ["Aarav", "", "+91 98765-43210", "", "", "", ""],
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

  it("marks the second within-file occurrence a duplicate", () => {
    const result = validateImportRows(HEADERS, [
      ["Aarav", "Sharma", "9876543210", "", "", "", ""],
      ["Aarav", "Sharma", "9876543210", "", "", "", ""],
      ["Diya", "", "9123456789", "", "", "", ""],
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { unique, duplicates } = partitionDuplicates(result.valid);
      expect(unique).toHaveLength(2);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.index).toBe(1);
    }
  });
});
