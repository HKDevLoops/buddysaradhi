// Implements: 11_Data_Model.md §ledger_entries, 12_Business_Rules.md BR-M-01
// (integer paise), BR-LED-01 (append-only entry shape).
// Principle: P4 (immutable ledger). Rule 6 (int paise), Rule 9 (safeParse).
import { describe, it, expect } from "vitest";
import { LedgerEntrySchema } from "./ledger";

const UUID_A = "123e4567-e89b-12d3-a456-426614174000";
const UUID_B = "223e4567-e89b-12d3-a456-426614174001";
const UUID_C = "323e4567-e89b-12d3-a456-426614174002";
const DT = "2026-09-30T12:00:00.000Z";

function validEntry() {
  return {
    id: UUID_A,
    tenant_id: UUID_B,
    student_id: UUID_C,
    type: "PAYMENT_RECEIVED",
    debit_paise: 0,
    credit_paise: 450000,
    balance_after_paise: 0,
    this_hash: "a1b2c3d4e5f6",
    occurred_on: "2026-09-05",
  };
}

describe("LedgerEntrySchema", () => {
  it("accepts a minimal valid entry and defaults source to manual", () => {
    const parsed = LedgerEntrySchema.safeParse(validEntry());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.source).toBe("manual");
    }
  });

  it("accepts a fully-populated entry with links and lock", () => {
    const full = {
      ...validEntry(),
      batch_id: UUID_B,
      invoice_id: UUID_C,
      description: "Sept fee",
      receipt_no: "RCP-000042",
      payment_method: "cash",
      payment_ref: null,
      prev_hash: "000000",
      void_of_id: null,
      locked_at: DT,
      device_id: "device-1",
      created_by: "tutor-1",
      created_at: DT,
      updated_at: DT,
    };
    expect(LedgerEntrySchema.safeParse(full).success).toBe(true);
  });

  it.each([
    "FEE_CHARGED",
    "PAYMENT_RECEIVED",
    "DISCOUNT_GRANTED",
    "REFUND_ISSUED",
    "ADJUSTMENT",
    "WRITEOFF",
    "VOID",
  ])("accepts entry type %s", (type) => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), type }).success,
    ).toBe(true);
  });

  it("accepts a negative balance_after_paise (advance, BR-CALC-01)", () => {
    expect(
      LedgerEntrySchema.safeParse({
        ...validEntry(),
        balance_after_paise: -50000,
      }).success,
    ).toBe(true);
  });

  it("accepts explicit nulls for optional link fields", () => {
    const e = {
      ...validEntry(),
      batch_id: null,
      invoice_id: null,
      void_of_id: null,
      locked_at: null,
    };
    expect(LedgerEntrySchema.safeParse(e).success).toBe(true);
  });

  it("rejects an unknown entry type", () => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), type: "FEE" }).success,
    ).toBe(false);
  });

  it("rejects a negative debit_paise (BR-M-01)", () => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), debit_paise: -1 })
        .success,
    ).toBe(false);
  });

  it("rejects a fractional debit_paise (Rule 6)", () => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), debit_paise: 1.5 })
        .success,
    ).toBe(false);
  });

  it("rejects a negative credit_paise (BR-M-01)", () => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), credit_paise: -100 })
        .success,
    ).toBe(false);
  });

  it("rejects a fractional credit_paise (Rule 6)", () => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), credit_paise: 2.25 })
        .success,
    ).toBe(false);
  });

  it("rejects a missing this_hash (tamper chain, 11_Data_Model §8)", () => {
    const base = validEntry();
    const { this_hash, ...rest } = base;
    void this_hash;
    expect(LedgerEntrySchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a missing student_id", () => {
    const base = validEntry();
    const { student_id, ...rest } = base;
    void student_id;
    expect(LedgerEntrySchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-datetime locked_at", () => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), locked_at: "yesterday" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-uuid void_of_id", () => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), void_of_id: "abc" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    expect(
      LedgerEntrySchema.safeParse({ ...validEntry(), id: "entry-1" }).success,
    ).toBe(false);
  });
});
