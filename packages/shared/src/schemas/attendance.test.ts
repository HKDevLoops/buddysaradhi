// Implements: 06_Attendance.md §9.7 (BR-CALC-06 statuses), 11_Data_Model.md
// §attendance, 12_Business_Rules.md BR-ATT-04 (holiday excluded).
// Rule 9 (safeParse, never any).
import { describe, it, expect } from "vitest";
import {
  AttendanceStatusSchema,
  AttendanceSessionSchema,
  AttendanceRecordSchema,
  StudentAttendanceRowSchema,
  UpdateAttendancePayloadSchema,
} from "./attendance";

const UUID_A = "123e4567-e89b-12d3-a456-426614174000";
const UUID_B = "223e4567-e89b-12d3-a456-426614174001";
const UUID_C = "323e4567-e89b-12d3-a456-426614174002";
const DT = "2026-09-30T12:00:00.000Z";

describe("AttendanceStatusSchema (BR-CALC-06)", () => {
  it.each(["present", "absent", "late", "excused"])(
    "accepts status %s",
    (status) => {
      expect(AttendanceStatusSchema.safeParse(status).success).toBe(true);
    },
  );

  it.each(["holiday", "Present", "PRESENT", "", "half-day", "leave"])(
    "rejects non-persisted status %s",
    (status) => {
      expect(AttendanceStatusSchema.safeParse(status).success).toBe(false);
    },
  );

  it("rejects non-string statuses", () => {
    expect(AttendanceStatusSchema.safeParse(1).success).toBe(false);
    expect(AttendanceStatusSchema.safeParse(null).success).toBe(false);
  });
});

describe("AttendanceSessionSchema", () => {
  it("accepts a valid session", () => {
    const s = {
      id: UUID_A,
      tenant_id: UUID_B,
      session_date: "2026-09-05",
      batch_id: UUID_C,
      locked_at: null,
      created_at: DT,
      updated_at: DT,
    };
    expect(AttendanceSessionSchema.safeParse(s).success).toBe(true);
  });

  it("accepts a null batch_id", () => {
    const s = {
      id: UUID_A,
      tenant_id: UUID_B,
      session_date: "2026-09-05",
      batch_id: null,
      locked_at: null,
      created_at: DT,
      updated_at: DT,
    };
    expect(AttendanceSessionSchema.safeParse(s).success).toBe(true);
  });

  it("rejects a non-uuid id", () => {
    const s = {
      id: "session-1",
      tenant_id: UUID_B,
      session_date: "2026-09-05",
      batch_id: null,
      locked_at: null,
      created_at: DT,
      updated_at: DT,
    };
    expect(AttendanceSessionSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a missing session_date", () => {
    const s = {
      id: UUID_A,
      tenant_id: UUID_B,
      batch_id: null,
      locked_at: null,
      created_at: DT,
      updated_at: DT,
    };
    expect(AttendanceSessionSchema.safeParse(s).success).toBe(false);
  });
});

describe("AttendanceRecordSchema", () => {
  it("accepts a valid record", () => {
    const r = {
      id: UUID_A,
      tenant_id: UUID_B,
      session_id: UUID_C,
      student_id: UUID_A,
      status: "late",
      notes: null,
      created_at: DT,
      updated_at: DT,
    };
    expect(AttendanceRecordSchema.safeParse(r).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const r = {
      id: UUID_A,
      tenant_id: UUID_B,
      session_id: UUID_C,
      student_id: UUID_A,
      status: "holiday",
      notes: null,
      created_at: DT,
      updated_at: DT,
    };
    expect(AttendanceRecordSchema.safeParse(r).success).toBe(false);
  });

  it("rejects a non-uuid session_id", () => {
    const r = {
      id: UUID_A,
      tenant_id: UUID_B,
      session_id: "session-1",
      student_id: UUID_A,
      status: "present",
      notes: null,
      created_at: DT,
      updated_at: DT,
    };
    expect(AttendanceRecordSchema.safeParse(r).success).toBe(false);
  });
});

describe("StudentAttendanceRowSchema", () => {
  it("accepts a row with a status", () => {
    const r = {
      student_id: UUID_A,
      name: "Riya Sharma",
      batch: "Morning",
      status: "present",
    };
    expect(StudentAttendanceRowSchema.safeParse(r).success).toBe(true);
  });

  it("accepts a null status (not yet marked)", () => {
    const r = {
      student_id: UUID_A,
      name: "Riya Sharma",
      batch: null,
      status: null,
    };
    expect(StudentAttendanceRowSchema.safeParse(r).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const r = {
      student_id: UUID_A,
      name: "Riya Sharma",
      batch: null,
      status: "half-day",
    };
    expect(StudentAttendanceRowSchema.safeParse(r).success).toBe(false);
  });

  it("rejects a missing name", () => {
    const r = { student_id: UUID_A, batch: null, status: null };
    expect(StudentAttendanceRowSchema.safeParse(r).success).toBe(false);
  });
});

describe("UpdateAttendancePayloadSchema", () => {
  it("accepts a batch update payload", () => {
    const p = {
      session_date: "2026-09-05",
      batch_id: UUID_C,
      updates: [
        { student_id: UUID_A, status: "present" },
        { student_id: UUID_B, status: "excused" },
      ],
    };
    expect(UpdateAttendancePayloadSchema.safeParse(p).success).toBe(true);
  });

  it("accepts an empty updates array", () => {
    const p = {
      session_date: "2026-09-05",
      batch_id: null,
      updates: [],
    };
    expect(UpdateAttendancePayloadSchema.safeParse(p).success).toBe(true);
  });

  it("rejects a bad status inside updates", () => {
    const p = {
      session_date: "2026-09-05",
      batch_id: null,
      updates: [{ student_id: UUID_A, status: "holiday" }],
    };
    expect(UpdateAttendancePayloadSchema.safeParse(p).success).toBe(false);
  });

  it("rejects a non-uuid batch_id", () => {
    const p = {
      session_date: "2026-09-05",
      batch_id: "batch-1",
      updates: [],
    };
    expect(UpdateAttendancePayloadSchema.safeParse(p).success).toBe(false);
  });

  it("rejects a missing session_date", () => {
    const p = { batch_id: null, updates: [] };
    expect(UpdateAttendancePayloadSchema.safeParse(p).success).toBe(false);
  });
});
