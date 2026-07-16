import { describe, it, expect } from "vitest";
import { StudentListRowSchema } from "./schemas/student";

describe("Shared Schemas", () => {
  it("should enforce integer paise for balance_due", () => {
    const valid = StudentListRowSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      code: "STU-01",
      name: "John Doe",
      grade: "10th",
      batch: "Morning",
      fee_model: "postpaid",
      balance_due: 150000,
      status: "active",
    });
    expect(valid.success).toBe(true);

    const invalid = StudentListRowSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      code: "STU-01",
      name: "John Doe",
      grade: "10th",
      batch: "Morning",
      fee_model: "postpaid",
      balance_due: 150000.5, // float!
      status: "active",
    });
    expect(invalid.success).toBe(false);
  });
});
