// Implements: 09_Backup_and_Import_Export.md §10.4 (import template,
// TemplateGenerator.ts → generateTemplate).
//
// Byte-level tests for the dependency-free .xlsx writer. The archive uses
// stored (uncompressed) entries, so the XML is readable directly in the
// bytes: the test decodes the file and asserts on the workbook structure,
// the shared strings, the validations, and the ZIP framing.

import { describe, expect, it } from "vitest";
import {
  buildStoredZip,
  buildStudentsXlsxTemplate,
  columnLetter,
  crc32,
} from "./xlsx-template";
import { STUDENT_IMPORT_HEADERS } from "./csv-parse";

function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("crc32", () => {
  it("matches the IEEE check value", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });
});

describe("columnLetter", () => {
  it("maps 1-based indexes to Excel letters", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(14)).toBe("N");
    expect(columnLetter(27)).toBe("AA");
  });
});

describe("buildStoredZip", () => {
  it("frames entries with local headers and a central directory", () => {
    const bytes = buildStoredZip([
      { name: "a.txt", data: new TextEncoder().encode("hello") },
    ]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    const text = textOf(bytes);
    expect(text).toContain("a.txt");
    expect(text).toContain("hello");
    // End-of-central-directory record closes the archive.
    expect(bytes[bytes.length - 22]).toBe(0x50);
    expect(bytes[bytes.length - 21]).toBe(0x4b);
    expect(bytes[bytes.length - 20]).toBe(0x05);
    expect(bytes[bytes.length - 19]).toBe(0x06);
  });
});

describe("buildStudentsXlsxTemplate", () => {
  it("opens with the ZIP magic and closes with the end record", () => {
    const bytes = buildStudentsXlsxTemplate();
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    const tail = bytes.length;
    expect(bytes[tail - 22]).toBe(0x50);
    expect(bytes[tail - 21]).toBe(0x4b);
    expect(bytes[tail - 20]).toBe(0x05);
    expect(bytes[tail - 19]).toBe(0x06);
  });

  it("carries both sheets in the workbook", () => {
    const text = textOf(buildStudentsXlsxTemplate());
    expect(text).toContain('name="Template"');
    expect(text).toContain('name="Instructions"');
  });

  it("stores every import header as a shared string", () => {
    const text = textOf(buildStudentsXlsxTemplate());
    for (const header of STUDENT_IMPORT_HEADERS) {
      expect(text).toContain(`<t>${header}</t>`);
    }
  });

  it("ships the enum dropdown validations", () => {
    const text = textOf(buildStudentsXlsxTemplate());
    expect(text).toContain("<dataValidation");
    expect(text).toContain("M,F,O");
    expect(text).toContain("postpaid,prepaid,mixed");
    expect(text).toContain("active,inactive,graduated,archived");
    expect(text).toContain("D2:D1000");
    expect(text).toContain("L2:L1000");
    expect(text).toContain("N2:N1000");
  });

  it("styles the header row and formats sample dates", () => {
    const text = textOf(buildStudentsXlsxTemplate());
    expect(text).toContain("yyyy-mm-dd");
    expect(text).toContain('s="1"');
    expect(text).toContain('s="2"');
  });

  it("documents the CSV and paste-grid parity in the instructions", () => {
    const text = textOf(buildStudentsXlsxTemplate());
    expect(text).toContain("paste grid");
    expect(text).toContain("DD/MM/YYYY");
  });
});
