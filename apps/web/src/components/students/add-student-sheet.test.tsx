// Implements: 05_Students.md §6.1 (Add Student sheet) + §14 (validation rules),
// 09_Backup_and_Import_Export.md §14.1/§14.2/§14.5/§14.6,
// 12_Business_Rules.md BR-STU-03 (duplicate key), BR-M-01 (integer paise).
//
// The sheet-side half of the import↔manual parity audit. The server-side halves —
// the real file-backed libSQL writes, the gateway Idempotency-Key, the batch
// transaction — live in `server/actions/students-parity-audit.test.ts`.
//
// What is proven here is the pair that could silently disagree: the form's own
// Zod schema and the import's Zod schema, fed the SAME logical student, must
// accept and reject the same values. Before this audit the sheet accepted any
// phone string, unbounded names, and a future date, while the import demanded
// 10–15 digits, 80-character names and a bounded date window.

import { describe, expect, it } from "vitest";

import { FormSchema, splitStudentName } from "./add-student-sheet";
import { StudentImportRowSchema, studentDupKey } from "@/lib/csv-parse";

/** One student, expressed the way a tutor types it into the sheet. */
const SHEET_ROW = {
  name: "Aarav Sharma",
  code: "",
  batch: "Class 10 Maths 6pm",
  phone: "+91 98765-43210",
  joined_at: "2026-06-01",
  dob: "2015-04-12",
  grade: "10",
  school: "Delhi Public School",
  board: "CBSE",
  gender: "M",
  address: "21 MG Road, Pune",
  fee_model: "postpaid",
  baseFee: 2000.5,
};

/** The same student, expressed the way a spreadsheet row carries them. */
const IMPORT_ROW = {
  first_name: "Aarav",
  last_name: "Sharma",
  phone: "+91 98765-43210",
  gender: "M",
  dob: "2015-04-12",
  address: "21 MG Road, Pune",
  school: "Delhi Public School",
  grade: "10",
  board: "CBSE",
  batch: "Class 10 Maths 6pm",
  admission_date: "2026-06-01",
  fee_model: "postpaid",
  base_fee_rupees: "2000.50",
  status: "active",
};

describe("splitStudentName", () => {
  it("splits a full name into first and last", () => {
    expect(splitStudentName("Aarav Sharma")).toEqual({ firstName: "Aarav", lastName: "Sharma" });
  });

  it("keeps a multi-word last name whole", () => {
    expect(splitStudentName("Diya Rose Mary Patel")).toEqual({
      firstName: "Diya",
      lastName: "Rose Mary Patel",
    });
  });

  it("collapses runs of whitespace and trims", () => {
    // "Aarav  Sharma" used to persist a last name of " Sharma" — a leading space
    // the tutor never typed.
    expect(splitStudentName("  Aarav   Sharma  ")).toEqual({ firstName: "Aarav", lastName: "Sharma" });
  });

  it("returns a null last name for a single-word name", () => {
    expect(splitStudentName("Aarav")).toEqual({ firstName: "Aarav", lastName: null });
  });

  it("never returns an undefined first name for whitespace input", () => {
    expect(splitStudentName("   ").firstName).toBe("");
  });
});

describe("the sheet schema accepts what the import schema accepts", () => {
  it("accepts the same valid student on both paths", () => {
    const sheet = FormSchema.safeParse(SHEET_ROW);
    const pasted = StudentImportRowSchema.safeParse(IMPORT_ROW);
    expect(sheet.success).toBe(true);
    expect(pasted.success).toBe(true);
  });

  it("normalises the phone the same way (09 §14.5)", () => {
    const sheet = FormSchema.parse({ ...SHEET_ROW, phone: "(98765) 43210" });
    const pasted = StudentImportRowSchema.parse({ ...IMPORT_ROW, phone: "(98765) 43210" });
    expect(sheet.phone).toBe("9876543210");
    expect(pasted.phone).toBe("9876543210");
  });

  it("treats a blank phone as absent on both paths", () => {
    // The sheet spells it `null` (the phone normaliser's own answer) and the
    // import `undefined` (its blank-means-absent preprocessor). Both mean the
    // same thing: `createStudent` collapses them with `|| null`, so the
    // persisted value is identical. Asserted on the meaning, not the spelling.
    const sheet = FormSchema.parse({ ...SHEET_ROW, phone: "" });
    const pasted = StudentImportRowSchema.parse({ ...IMPORT_ROW, phone: "" });
    expect(sheet.phone ?? null).toBeNull();
    expect(pasted.phone ?? null).toBeNull();
  });

  it("rejects a non-numeric phone on BOTH paths", () => {
    // The defect: the sheet used to accept this, so a tutor could store "abc" as
    // a phone and the duplicate key was built from its last four characters.
    expect(FormSchema.safeParse({ ...SHEET_ROW, phone: "not a phone" }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, phone: "not a phone" }).success).toBe(false);
  });

  it("rejects a short phone on both paths", () => {
    expect(FormSchema.safeParse({ ...SHEET_ROW, phone: "12345" }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, phone: "12345" }).success).toBe(false);
  });

  it("rejects a first name over 80 characters on both paths (05 §14)", () => {
    const long = "a".repeat(81);
    expect(FormSchema.safeParse({ ...SHEET_ROW, name: `${long} Sharma` }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, first_name: long }).success).toBe(false);
  });

  it("rejects a last name over 80 characters on both paths (05 §14)", () => {
    const long = "b".repeat(81);
    expect(FormSchema.safeParse({ ...SHEET_ROW, name: `Aarav ${long}` }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, last_name: long }).success).toBe(false);
  });

  it("rejects a grade over 40 characters on both paths (05 §14)", () => {
    const long = "c".repeat(41);
    expect(FormSchema.safeParse({ ...SHEET_ROW, grade: long }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, grade: long }).success).toBe(false);
  });

  it("rejects a future admission date on both paths (05 §14)", () => {
    expect(FormSchema.safeParse({ ...SHEET_ROW, joined_at: "2999-01-01" }).success).toBe(false);
    expect(
      StudentImportRowSchema.safeParse({ ...IMPORT_ROW, admission_date: "01/01/2999" }).success,
    ).toBe(false);
  });

  it("rejects a future dob on both paths (EC-S-16)", () => {
    expect(FormSchema.safeParse({ ...SHEET_ROW, dob: "2999-01-01" }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, dob: "01/01/2999" }).success).toBe(false);
  });

  it("rejects an admission date before 2000-01-01 on both paths (05 §14)", () => {
    expect(FormSchema.safeParse({ ...SHEET_ROW, joined_at: "1999-06-01" }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, admission_date: "1999-06-01" }).success).toBe(
      false,
    );
  });

  it("rejects an empty name and an empty batch on both paths", () => {
    expect(FormSchema.safeParse({ ...SHEET_ROW, name: "" }).success).toBe(false);
    expect(FormSchema.safeParse({ ...SHEET_ROW, batch: "" }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, first_name: "" }).success).toBe(false);
    expect(StudentImportRowSchema.safeParse({ ...IMPORT_ROW, batch: "" }).success).toBe(false);
  });

  it("rejects a code with spaces or symbols (05 §14 / BR-STU-04)", () => {
    expect(FormSchema.safeParse({ ...SHEET_ROW, code: "STU 2026" }).success).toBe(false);
    expect(FormSchema.safeParse({ ...SHEET_ROW, code: "STU_2026" }).success).toBe(false);
    expect(FormSchema.safeParse({ ...SHEET_ROW, code: "STU-2026-0001" }).success).toBe(true);
  });

  it("leaves a blank code absent so the server generates one (BR-STU-04)", () => {
    const sheet = FormSchema.parse({ ...SHEET_ROW, code: "" });
    expect(sheet.code).toBeUndefined();
  });

  it("defaults fee_model to postpaid and keeps a blank base fee at zero (P6 / BR-M-01)", () => {
    const sheet = FormSchema.parse({ ...SHEET_ROW, fee_model: undefined, baseFee: undefined });
    expect(sheet.fee_model).toBe("postpaid");
    expect(sheet.baseFee).toBe(0);
    const pasted = StudentImportRowSchema.parse({ ...IMPORT_ROW, fee_model: "", base_fee_rupees: "" });
    expect(pasted.fee_model).toBe("postpaid");
    expect(pasted.base_fee_rupees).toBe("0");
  });

  it("names the field in its message, so the tutor knows which box to fix", () => {
    const result = FormSchema.safeParse({ ...SHEET_ROW, phone: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toMatch(/phone/i);
    }
  });
});

describe("the sheet's duplicate key is the import's duplicate key", () => {
  it("derives the same key from the same tutor input on both paths", () => {
    const sheet = FormSchema.parse(SHEET_ROW);
    const pasted = StudentImportRowSchema.parse(IMPORT_ROW);
    const { firstName, lastName } = splitStudentName(sheet.name);
    expect(studentDupKey(firstName, lastName, sheet.phone ?? null)).toBe(
      studentDupKey(pasted.first_name, pasted.last_name ?? null, pasted.phone ?? null),
    );
  });

  it("does not depend on how the phone was punctuated", () => {
    const canonical = studentDupKey("Aarav", "Sharma", "9876543210");
    // A trailing space is one keystroke and used to produce a different key.
    expect(studentDupKey("Aarav", "Sharma", "9876543210 ")).toBe(canonical);
    expect(studentDupKey("Aarav", "Sharma", "+91 98765-43210")).toBe(canonical);
    expect(studentDupKey("Aarav", "Sharma", "098765.43210")).toBe(canonical);
  });
});
