// Implements: 11_Data_Model.md (all shared model shapes), 12_Business_Rules.md
// BR-M-01 (integer paise). Every schema gets accept + reject cases.
// Rule 9 (safeParse, never any). See report for spec-vs-code findings on the
// loose string fields (type/status) documented inline below.
import { describe, it, expect } from "vitest";
import {
  SettingSchema,
  TutorSchema,
  BatchSchema,
  StudentSchema,
  GuardianSchema,
  StudentEnrollmentSchema,
  TagSchema,
  StudentTagSchema,
  StudentNoteSchema,
  StudentDocumentSchema,
  AttendanceSessionSchema,
  AttendanceRecordSchema,
  FeePlanSchema,
  FeeScheduleItemSchema,
  InvoiceSchema,
  LedgerEntrySchema,
  ReceiptSchema,
  ReminderSchema,
  NotificationSchema,
  AuditLogSchema,
  SyncOutboxSchema,
  BackupManifestSchema,
  AppStateSchema,
} from "./models";

const UUID_A = "123e4567-e89b-12d3-a456-426614174000";
const UUID_B = "223e4567-e89b-12d3-a456-426614174001";
const UUID_C = "323e4567-e89b-12d3-a456-426614174002";
const DT = "2026-09-30T12:00:00.000Z";

describe("SettingSchema", () => {
  it("accepts a valid settings row", () => {
    const s = {
      tenantId: UUID_A,
      instituteName: "Sharma Classes",
      currencyCode: "INR",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      defaultFeeModel: "postpaid",
      invoicePrefix: "INV-",
      receiptPrefix: "RCP-",
      nextInvoiceSeq: 1,
      nextReceiptSeq: 1,
      nextStudentSeq: 1,
      attendanceLockHours: 24,
      sessionTimeoutMin: 30,
      theme: "cosmic",
      biometricEnabled: 0,
      tenantSecret: "s3cr3t",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(SettingSchema.safeParse(s).success).toBe(true);
  });

  it("rejects a missing instituteName", () => {
    const s = {
      tenantId: UUID_A,
      currencyCode: "INR",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      defaultFeeModel: "postpaid",
      invoicePrefix: "INV-",
      receiptPrefix: "RCP-",
      nextInvoiceSeq: 1,
      nextReceiptSeq: 1,
      nextStudentSeq: 1,
      attendanceLockHours: 24,
      sessionTimeoutMin: 30,
      theme: "cosmic",
      biometricEnabled: 0,
      tenantSecret: "s3cr3t",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(SettingSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a fractional nextInvoiceSeq (BR-M-01 int sequences)", () => {
    const s = {
      tenantId: UUID_A,
      instituteName: "Sharma Classes",
      currencyCode: "INR",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      defaultFeeModel: "postpaid",
      invoicePrefix: "INV-",
      receiptPrefix: "RCP-",
      nextInvoiceSeq: 1.5,
      nextReceiptSeq: 1,
      nextStudentSeq: 1,
      attendanceLockHours: 24,
      sessionTimeoutMin: 30,
      theme: "cosmic",
      biometricEnabled: 0,
      tenantSecret: "s3cr3t",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(SettingSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a non-datetime createdAt", () => {
    const s = {
      tenantId: UUID_A,
      instituteName: "Sharma Classes",
      currencyCode: "INR",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      defaultFeeModel: "postpaid",
      invoicePrefix: "INV-",
      receiptPrefix: "RCP-",
      nextInvoiceSeq: 1,
      nextReceiptSeq: 1,
      nextStudentSeq: 1,
      attendanceLockHours: 24,
      sessionTimeoutMin: 30,
      theme: "cosmic",
      biometricEnabled: 0,
      tenantSecret: "s3cr3t",
      createdAt: "30-09-2026",
      updatedAt: DT,
    };
    expect(SettingSchema.safeParse(s).success).toBe(false);
  });
});

describe("TutorSchema", () => {
  it("accepts a valid tutor", () => {
    const t = {
      id: UUID_A,
      tenantId: UUID_B,
      name: "Kabir",
      role: "owner",
      isActive: 1,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(TutorSchema.safeParse(t).success).toBe(true);
  });

  it("rejects a missing name", () => {
    const t = {
      id: UUID_A,
      tenantId: UUID_B,
      role: "owner",
      isActive: 1,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(TutorSchema.safeParse(t).success).toBe(false);
  });

  it("rejects a fractional isActive", () => {
    const t = {
      id: UUID_A,
      tenantId: UUID_B,
      name: "Kabir",
      role: "owner",
      isActive: 0.5,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(TutorSchema.safeParse(t).success).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    const t = {
      id: "tutor-1",
      tenantId: UUID_B,
      name: "Kabir",
      role: "owner",
      isActive: 1,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(TutorSchema.safeParse(t).success).toBe(false);
  });
});

describe("BatchSchema", () => {
  it("accepts a valid batch", () => {
    const b = {
      id: UUID_A,
      tenantId: UUID_B,
      name: "Class 10 Morning",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(BatchSchema.safeParse(b).success).toBe(true);
  });

  it("rejects a missing name", () => {
    const b = { id: UUID_A, tenantId: UUID_B, createdAt: DT, updatedAt: DT };
    expect(BatchSchema.safeParse(b).success).toBe(false);
  });

  it("rejects a non-uuid tutorId", () => {
    const b = {
      id: UUID_A,
      tenantId: UUID_B,
      tutorId: "tutor-1",
      name: "Class 10 Morning",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(BatchSchema.safeParse(b).success).toBe(false);
  });
});

describe("StudentSchema (models)", () => {
  it("accepts a valid student", () => {
    const s = {
      id: UUID_A,
      tenantId: UUID_B,
      firstName: "Riya",
      admissionDate: "2026-06-01",
      status: "active",
      feeModel: "postpaid",
      dupKey: "riya|2012-04-01",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentSchema.safeParse(s).success).toBe(true);
  });

  it("rejects a missing firstName", () => {
    const s = {
      id: UUID_A,
      tenantId: UUID_B,
      admissionDate: "2026-06-01",
      status: "active",
      feeModel: "postpaid",
      dupKey: "riya|2012-04-01",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a non-uuid mergedIntoId", () => {
    const s = {
      id: UUID_A,
      tenantId: UUID_B,
      firstName: "Riya",
      admissionDate: "2026-06-01",
      status: "active",
      feeModel: "postpaid",
      dupKey: "riya|2012-04-01",
      mergedIntoId: "nope",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentSchema.safeParse(s).success).toBe(false);
  });
});

describe("GuardianSchema", () => {
  it("accepts a valid guardian", () => {
    const g = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      name: "Meena",
      isPrimary: 1,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(GuardianSchema.safeParse(g).success).toBe(true);
  });

  it("rejects a missing name", () => {
    const g = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      isPrimary: 1,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(GuardianSchema.safeParse(g).success).toBe(false);
  });

  it("rejects a fractional isPrimary", () => {
    const g = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      name: "Meena",
      isPrimary: 0.5,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(GuardianSchema.safeParse(g).success).toBe(false);
  });
});

describe("StudentEnrollmentSchema", () => {
  it("accepts a valid enrollment", () => {
    const e = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      batchId: UUID_A,
      joinedOn: "2026-06-01",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentEnrollmentSchema.safeParse(e).success).toBe(true);
  });

  it("rejects a missing batchId", () => {
    const e = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      joinedOn: "2026-06-01",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentEnrollmentSchema.safeParse(e).success).toBe(false);
  });

  it("rejects a non-uuid studentId", () => {
    const e = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: "stu-1",
      batchId: UUID_A,
      joinedOn: "2026-06-01",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentEnrollmentSchema.safeParse(e).success).toBe(false);
  });
});

describe("TagSchema", () => {
  it("accepts a valid tag", () => {
    const t = {
      id: UUID_A,
      tenantId: UUID_B,
      name: "sibling",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(TagSchema.safeParse(t).success).toBe(true);
  });

  it("rejects a missing name", () => {
    const t = { id: UUID_A, tenantId: UUID_B, createdAt: DT, updatedAt: DT };
    expect(TagSchema.safeParse(t).success).toBe(false);
  });
});

describe("StudentTagSchema", () => {
  it("accepts a valid student-tag link", () => {
    expect(
      StudentTagSchema.safeParse({ studentId: UUID_A, tagId: UUID_B }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid tagId", () => {
    expect(
      StudentTagSchema.safeParse({ studentId: UUID_A, tagId: "tag-1" }).success,
    ).toBe(false);
  });

  it("rejects a missing studentId", () => {
    expect(StudentTagSchema.safeParse({ tagId: UUID_B }).success).toBe(false);
  });
});

describe("StudentNoteSchema", () => {
  it("accepts a valid note", () => {
    const n = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      category: "general",
      body: "Needs extra practice.",
      pinned: 0,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentNoteSchema.safeParse(n).success).toBe(true);
  });

  it("rejects a missing body", () => {
    const n = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      category: "general",
      pinned: 0,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentNoteSchema.safeParse(n).success).toBe(false);
  });

  it("rejects a fractional pinned flag", () => {
    const n = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      category: "general",
      body: "Needs extra practice.",
      pinned: 1.2,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(StudentNoteSchema.safeParse(n).success).toBe(false);
  });
});

describe("StudentDocumentSchema", () => {
  it("accepts a valid document", () => {
    const d = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      label: "report card",
      blobKey: "docs/rc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
      sha256: "a3f4e91",
      uploadedAt: DT,
    };
    expect(StudentDocumentSchema.safeParse(d).success).toBe(true);
  });

  it("rejects a fractional sizeBytes", () => {
    const d = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      label: "report card",
      blobKey: "docs/rc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12.5,
      sha256: "a3f4e91",
      uploadedAt: DT,
    };
    expect(StudentDocumentSchema.safeParse(d).success).toBe(false);
  });

  it("rejects a missing sha256", () => {
    const d = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      label: "report card",
      blobKey: "docs/rc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
      uploadedAt: DT,
    };
    expect(StudentDocumentSchema.safeParse(d).success).toBe(false);
  });
});

describe("AttendanceSessionSchema (models)", () => {
  it("accepts a valid session", () => {
    const s = {
      id: UUID_A,
      tenantId: UUID_B,
      batchId: UUID_C,
      sessionDate: "2026-09-05",
      isHoliday: 0,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AttendanceSessionSchema.safeParse(s).success).toBe(true);
  });

  it("rejects a missing batchId", () => {
    const s = {
      id: UUID_A,
      tenantId: UUID_B,
      sessionDate: "2026-09-05",
      isHoliday: 0,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AttendanceSessionSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a fractional isHoliday flag", () => {
    const s = {
      id: UUID_A,
      tenantId: UUID_B,
      batchId: UUID_C,
      sessionDate: "2026-09-05",
      isHoliday: 0.5,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AttendanceSessionSchema.safeParse(s).success).toBe(false);
  });
});

describe("AttendanceRecordSchema (models)", () => {
  it("accepts a valid record", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      sessionId: UUID_C,
      studentId: UUID_A,
      status: "present",
      markedAt: DT,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AttendanceRecordSchema.safeParse(r).success).toBe(true);
  });

  // FINDING (06_Attendance.md §9.7 / BR-CALC-06): models status is z.string(),
  // so unknown statuses pass here — unlike attendance.ts AttendanceStatusSchema.
  it("documents that any string status passes (looser than attendance.ts)", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      sessionId: UUID_C,
      studentId: UUID_A,
      status: "zzz-unknown",
      markedAt: DT,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AttendanceRecordSchema.safeParse(r).success).toBe(true);
  });

  it("rejects a non-datetime markedAt", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      sessionId: UUID_C,
      studentId: UUID_A,
      status: "present",
      markedAt: "today morning",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AttendanceRecordSchema.safeParse(r).success).toBe(false);
  });
});

describe("FeePlanSchema", () => {
  it("accepts a valid fee plan", () => {
    const f = { id: UUID_A, tenantId: UUID_B, studentId: UUID_C };
    expect(FeePlanSchema.safeParse(f).success).toBe(true);
  });

  it("rejects a missing studentId", () => {
    const f = { id: UUID_A, tenantId: UUID_B };
    expect(FeePlanSchema.safeParse(f).success).toBe(false);
  });
});

describe("FeeScheduleItemSchema", () => {
  it("accepts a valid schedule item (BR-M-01 integer amount)", () => {
    const f = {
      id: UUID_A,
      tenantId: UUID_B,
      feePlanId: UUID_C,
      label: "September",
      dueDate: "2026-09-01",
      amount: 150000,
      status: "pending",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(FeeScheduleItemSchema.safeParse(f).success).toBe(true);
  });

  it("rejects a fractional amount (Rule 6)", () => {
    const f = {
      id: UUID_A,
      tenantId: UUID_B,
      feePlanId: UUID_C,
      label: "September",
      dueDate: "2026-09-01",
      amount: 1500.5,
      status: "pending",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(FeeScheduleItemSchema.safeParse(f).success).toBe(false);
  });

  it("rejects a missing label", () => {
    const f = {
      id: UUID_A,
      tenantId: UUID_B,
      feePlanId: UUID_C,
      dueDate: "2026-09-01",
      amount: 150000,
      status: "pending",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(FeeScheduleItemSchema.safeParse(f).success).toBe(false);
  });
});

describe("InvoiceSchema", () => {
  it("accepts a valid invoice (BR-M-01 integer totals)", () => {
    const inv = {
      id: UUID_A,
      tenantId: UUID_B,
      number: "INV-000017",
      studentId: UUID_C,
      issueDate: "2026-09-01",
      subtotal: 150000,
      discount: 0,
      extraCharges: 0,
      total: 150000,
      status: "unpaid",
      tamperHash: "h4sh",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(InvoiceSchema.safeParse(inv).success).toBe(true);
  });

  it("rejects a fractional total (Rule 6)", () => {
    const inv = {
      id: UUID_A,
      tenantId: UUID_B,
      number: "INV-000017",
      studentId: UUID_C,
      issueDate: "2026-09-01",
      subtotal: 150000,
      discount: 0,
      extraCharges: 0,
      total: 150000.75,
      status: "unpaid",
      tamperHash: "h4sh",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(InvoiceSchema.safeParse(inv).success).toBe(false);
  });

  it("rejects a missing number", () => {
    const inv = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      issueDate: "2026-09-01",
      subtotal: 150000,
      discount: 0,
      extraCharges: 0,
      total: 150000,
      status: "unpaid",
      tamperHash: "h4sh",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(InvoiceSchema.safeParse(inv).success).toBe(false);
  });
});

describe("LedgerEntrySchema (models)", () => {
  it("accepts a valid ledger entry", () => {
    const e = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      type: "PAYMENT_RECEIVED",
      debitPaise: 0,
      creditPaise: 450000,
      balanceAfterPaise: 0,
      thisHash: "a1b2c3",
      occurredOn: "2026-09-05",
      source: "manual",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(LedgerEntrySchema.safeParse(e).success).toBe(true);
  });

  // FINDING (07_Fees_and_Payments.md §2 / BR-LED-01): models type is z.string(),
  // so unknown entry types pass here — unlike ledger.ts LedgerEntrySchema enum.
  it("documents that any string type passes (looser than ledger.ts)", () => {
    const e = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      type: "SOMETHING_ELSE",
      debitPaise: 0,
      creditPaise: 100,
      balanceAfterPaise: 100,
      thisHash: "a1b2c3",
      occurredOn: "2026-09-05",
      source: "manual",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(LedgerEntrySchema.safeParse(e).success).toBe(true);
  });

  it("rejects a fractional debitPaise (Rule 6)", () => {
    const e = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      type: "PAYMENT_RECEIVED",
      debitPaise: 1.5,
      creditPaise: 0,
      balanceAfterPaise: 0,
      thisHash: "a1b2c3",
      occurredOn: "2026-09-05",
      source: "manual",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(LedgerEntrySchema.safeParse(e).success).toBe(false);
  });

  it("rejects a non-uuid deviceId", () => {
    const e = {
      id: UUID_A,
      tenantId: UUID_B,
      studentId: UUID_C,
      type: "PAYMENT_RECEIVED",
      debitPaise: 0,
      creditPaise: 100,
      balanceAfterPaise: 100,
      thisHash: "a1b2c3",
      occurredOn: "2026-09-05",
      source: "manual",
      deviceId: "device-1",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(LedgerEntrySchema.safeParse(e).success).toBe(false);
  });
});

describe("ReceiptSchema", () => {
  it("accepts a valid receipt (BR-RC-01 numbering surface)", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      number: "RCP-000042",
      ledgerEntryId: UUID_C,
      studentId: UUID_A,
      amount: 450000,
      paymentMethod: "cash",
      receivedOn: "2026-09-05",
      tamperHash: "h4sh",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(ReceiptSchema.safeParse(r).success).toBe(true);
  });

  it("rejects a fractional amount (Rule 6)", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      number: "RCP-000042",
      ledgerEntryId: UUID_C,
      studentId: UUID_A,
      amount: 99.99,
      paymentMethod: "cash",
      receivedOn: "2026-09-05",
      tamperHash: "h4sh",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(ReceiptSchema.safeParse(r).success).toBe(false);
  });

  it("rejects a missing paymentMethod", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      number: "RCP-000042",
      ledgerEntryId: UUID_C,
      studentId: UUID_A,
      amount: 450000,
      receivedOn: "2026-09-05",
      tamperHash: "h4sh",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(ReceiptSchema.safeParse(r).success).toBe(false);
  });
});

describe("ReminderSchema", () => {
  it("accepts a valid reminder", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      category: "fee",
      refType: "invoice",
      refId: UUID_C,
      dueAt: DT,
      status: "pending",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(ReminderSchema.safeParse(r).success).toBe(true);
  });

  it("rejects a non-datetime dueAt", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      category: "fee",
      refType: "invoice",
      refId: UUID_C,
      dueAt: "tomorrow",
      status: "pending",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(ReminderSchema.safeParse(r).success).toBe(false);
  });

  it("rejects a missing refId", () => {
    const r = {
      id: UUID_A,
      tenantId: UUID_B,
      category: "fee",
      refType: "invoice",
      dueAt: DT,
      status: "pending",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(ReminderSchema.safeParse(r).success).toBe(false);
  });
});

describe("NotificationSchema", () => {
  it("accepts a valid notification", () => {
    const n = {
      id: UUID_A,
      tenantId: UUID_B,
      category: "fee",
      title: "Fee due",
      createdAt: DT,
    };
    expect(NotificationSchema.safeParse(n).success).toBe(true);
  });

  it("rejects a missing title", () => {
    const n = { id: UUID_A, tenantId: UUID_B, category: "fee", createdAt: DT };
    expect(NotificationSchema.safeParse(n).success).toBe(false);
  });

  it("rejects a non-uuid refId", () => {
    const n = {
      id: UUID_A,
      tenantId: UUID_B,
      category: "fee",
      title: "Fee due",
      refId: "inv-1",
      createdAt: DT,
    };
    expect(NotificationSchema.safeParse(n).success).toBe(false);
  });
});

describe("AuditLogSchema", () => {
  it("accepts a valid audit row", () => {
    const a = {
      id: UUID_A,
      tenantId: UUID_B,
      actor: "tutor",
      action: "fee_waiver",
      createdAt: DT,
    };
    expect(AuditLogSchema.safeParse(a).success).toBe(true);
  });

  it("rejects a missing action", () => {
    const a = { id: UUID_A, tenantId: UUID_B, actor: "tutor", createdAt: DT };
    expect(AuditLogSchema.safeParse(a).success).toBe(false);
  });
});

describe("SyncOutboxSchema (BR-SYN-01)", () => {
  it("accepts a valid outbox row", () => {
    const o = {
      id: UUID_A,
      tenantId: UUID_B,
      tableName: "students",
      rowId: UUID_C,
      op: "upsert",
      payload: "{}",
      status: "pending",
      attempts: 0,
      createdAt: DT,
    };
    expect(SyncOutboxSchema.safeParse(o).success).toBe(true);
  });

  it("rejects fractional attempts", () => {
    const o = {
      id: UUID_A,
      tenantId: UUID_B,
      tableName: "students",
      rowId: UUID_C,
      op: "upsert",
      payload: "{}",
      status: "pending",
      attempts: 1.5,
      createdAt: DT,
    };
    expect(SyncOutboxSchema.safeParse(o).success).toBe(false);
  });

  it("rejects a missing op", () => {
    const o = {
      id: UUID_A,
      tenantId: UUID_B,
      tableName: "students",
      rowId: UUID_C,
      payload: "{}",
      status: "pending",
      attempts: 0,
      createdAt: DT,
    };
    expect(SyncOutboxSchema.safeParse(o).success).toBe(false);
  });
});

describe("BackupManifestSchema (BR-BAT-02)", () => {
  it("accepts a valid manifest", () => {
    const m = {
      id: UUID_A,
      tenantId: UUID_B,
      filename: "backup-2026-09-30.buddysaradhi",
      sizeBytes: 1024,
      schemaVersion: 1,
      rowCounts: "{}",
      dataSha256: "aa",
      encryptedSha256: "bb",
      keyKdfSalt: "ss",
      keyKdfParams: "m=65536,t=3,p=2",
      createdAt: DT,
    };
    expect(BackupManifestSchema.safeParse(m).success).toBe(true);
  });

  it("rejects a fractional schemaVersion", () => {
    const m = {
      id: UUID_A,
      tenantId: UUID_B,
      filename: "backup-2026-09-30.buddysaradhi",
      sizeBytes: 1024,
      schemaVersion: 1.5,
      rowCounts: "{}",
      dataSha256: "aa",
      encryptedSha256: "bb",
      keyKdfSalt: "ss",
      keyKdfParams: "m=65536,t=3,p=2",
      createdAt: DT,
    };
    expect(BackupManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects a missing filename", () => {
    const m = {
      id: UUID_A,
      tenantId: UUID_B,
      sizeBytes: 1024,
      schemaVersion: 1,
      rowCounts: "{}",
      dataSha256: "aa",
      encryptedSha256: "bb",
      keyKdfSalt: "ss",
      keyKdfParams: "m=65536,t=3,p=2",
      createdAt: DT,
    };
    expect(BackupManifestSchema.safeParse(m).success).toBe(false);
  });
});

describe("AppStateSchema", () => {
  it("accepts a valid app-state row", () => {
    const a = {
      tenantId: UUID_A,
      schemaVersion: 1,
      appLockState: "unlocked",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AppStateSchema.safeParse(a).success).toBe(true);
  });

  it("rejects a fractional schemaVersion", () => {
    const a = {
      tenantId: UUID_A,
      schemaVersion: 1.5,
      appLockState: "unlocked",
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AppStateSchema.safeParse(a).success).toBe(false);
  });

  it("rejects a missing appLockState", () => {
    const a = {
      tenantId: UUID_A,
      schemaVersion: 1,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(AppStateSchema.safeParse(a).success).toBe(false);
  });
});
