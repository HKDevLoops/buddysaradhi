// Implements: 11_Data_Model.md §students, 12_Business_Rules.md BR-M-01 (integer
// paise), BR-CALC-01 (negative balance = advance display).
// Principle: P4. Rule 6 (z.number().int() paise), Rule 9 (safeParse, never any).
import { describe, it, expect } from "vitest";
import { StudentSchema, StudentListRowSchema } from "./student";

const UUID_A = "123e4567-e89b-12d3-a456-426614174000";
const UUID_B = "223e4567-e89b-12d3-a456-426614174001";
const DT = "2026-09-30T12:00:00.000Z";

function validStudent() {
  return {
    id: UUID_A,
    tenant_id: UUID_B,
    code: "STU-0001",
    first_name: "Riya",
    last_name: "Sharma",
    dob: "2012-04-01",
    gender: "F",
    phone: "9876543210",
    email: "riya@example.com",
    address: "Nagpur",
    school: "City School",
    grade: "10th",
    board: "CBSE",
    admission_date: "2026-06-01",
    status: "active",
    fee_model: "postpaid",
    baseFeePaise: 150000,
    dup_key: "riya|2012-04-01",
    merged_into_id: null,
    custom_fields: null,
    notes: null,
    archived_at: null,
    created_at: DT,
    updated_at: DT,
  };
}

function validListRow() {
  return {
    id: UUID_A,
    code: "STU-0001",
    name: "Riya Sharma",
    grade: "10th",
    batch: "Morning",
    fee_model: "postpaid",
    balance_due: 150000,
    status: "active",
  };
}

describe("StudentSchema", () => {
  it("accepts a fully-populated student", () => {
    expect(StudentSchema.safeParse(validStudent()).success).toBe(true);
  });

  it("applies defaults for status / fee_model / baseFeePaise", () => {
    const base = validStudent();
    const { status, fee_model, baseFeePaise, ...rest } = base;
    void status;
    void fee_model;
    void baseFeePaise;
    const parsed = StudentSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("active");
      expect(parsed.data.fee_model).toBe("postpaid");
      expect(parsed.data.baseFeePaise).toBe(0);
    }
  });

  it("accepts nulls for every nullable column", () => {
    const s = {
      ...validStudent(),
      last_name: null,
      merged_into_id: null,
      notes: null,
    };
    expect(StudentSchema.safeParse(s).success).toBe(true);
  });

  it.each(["active", "inactive", "graduated", "archived"])(
    "accepts status %s",
    (status) => {
      expect(
        StudentSchema.safeParse({ ...validStudent(), status }).success,
      ).toBe(true);
    },
  );

  it.each(["postpaid", "prepaid", "mixed"])(
    "accepts fee_model %s",
    (fee_model) => {
      expect(
        StudentSchema.safeParse({ ...validStudent(), fee_model }).success,
      ).toBe(true);
    },
  );

  it("rejects a non-uuid id", () => {
    expect(
      StudentSchema.safeParse({ ...validStudent(), id: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejects an empty first_name", () => {
    expect(
      StudentSchema.safeParse({ ...validStudent(), first_name: "" }).success,
    ).toBe(false);
  });

  it("rejects a missing first_name", () => {
    const base = validStudent();
    const { first_name, ...rest } = base;
    void first_name;
    expect(StudentSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an unknown gender code", () => {
    expect(
      StudentSchema.safeParse({ ...validStudent(), gender: "X" }).success,
    ).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(
      StudentSchema.safeParse({ ...validStudent(), status: "pending" }).success,
    ).toBe(false);
  });

  it("rejects an unknown fee_model", () => {
    expect(
      StudentSchema.safeParse({ ...validStudent(), fee_model: "yearly" })
        .success,
    ).toBe(false);
  });

  it("rejects negative baseFeePaise (BR-M-01)", () => {
    expect(
      StudentSchema.safeParse({ ...validStudent(), baseFeePaise: -5 }).success,
    ).toBe(false);
  });

  it("rejects fractional baseFeePaise (Rule 6: integer paise)", () => {
    expect(
      StudentSchema.safeParse({ ...validStudent(), baseFeePaise: 10.5 })
        .success,
    ).toBe(false);
  });

  it("rejects a non-uuid merged_into_id", () => {
    expect(
      StudentSchema.safeParse({
        ...validStudent(),
        merged_into_id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("StudentListRowSchema", () => {
  it("accepts a valid row", () => {
    expect(StudentListRowSchema.safeParse(validListRow()).success).toBe(true);
  });

  it("accepts null grade / batch / code", () => {
    const r = { ...validListRow(), grade: null, batch: null, code: null };
    expect(StudentListRowSchema.safeParse(r).success).toBe(true);
  });

  it("accepts zero balance (no dues)", () => {
    expect(
      StudentListRowSchema.safeParse({ ...validListRow(), balance_due: 0 })
        .success,
    ).toBe(true);
  });

  it("accepts a negative balance (advance, BR-CALC-01 — emerald display)", () => {
    expect(
      StudentListRowSchema.safeParse({ ...validListRow(), balance_due: -50000 })
        .success,
    ).toBe(true);
  });

  it("rejects a float balance_due (Rule 6)", () => {
    expect(
      StudentListRowSchema.safeParse({
        ...validListRow(),
        balance_due: 150000.5,
      }).success,
    ).toBe(false);
  });

  it("rejects a string balance_due", () => {
    const bad = { ...validListRow(), balance_due: "150000" };
    expect(StudentListRowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing name", () => {
    const base = validListRow();
    const { name, ...rest } = base;
    void name;
    expect(StudentListRowSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an unknown fee_model", () => {
    expect(
      StudentListRowSchema.safeParse({ ...validListRow(), fee_model: "yearly" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(
      StudentListRowSchema.safeParse({ ...validListRow(), status: "pending" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    expect(
      StudentListRowSchema.safeParse({ ...validListRow(), id: "stu-1" })
        .success,
    ).toBe(false);
  });
});
