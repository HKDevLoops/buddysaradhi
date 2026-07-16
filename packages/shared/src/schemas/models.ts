import { z } from "zod";

export const SettingSchema = z.object({
  tenantId: z.string().uuid(),
  instituteName: z.string(),
  instituteAddress: z.string().optional().nullable(),
  institutePhone: z.string().optional().nullable(),
  instituteEmail: z.string().optional().nullable(),
  currencyCode: z.string(),
  locale: z.string(),
  timezone: z.string(),
  defaultFeeModel: z.string(),
  invoicePrefix: z.string(),
  receiptPrefix: z.string(),
  nextInvoiceSeq: z.number().int(),
  nextReceiptSeq: z.number().int(),
  nextStudentSeq: z.number().int(),
  attendanceLockHours: z.number().int(),
  sessionTimeoutMin: z.number().int(),
  theme: z.string(),
  biometricEnabled: z.number().int(),
  pinHash: z.string().optional().nullable(),
  backupPassphraseHash: z.string().optional().nullable(),
  tenantSecret: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Setting = z.infer<typeof SettingSchema>;

export const TutorSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  role: z.string(),
  isActive: z.number().int(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Tutor = z.infer<typeof TutorSchema>;

export const BatchSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tutorId: z.string().uuid().optional().nullable(),
  name: z.string(),
  subject: z.string().optional().nullable(),
  schedule: z.string().optional().nullable(),
  archivedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Batch = z.infer<typeof BatchSchema>;

export const StudentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: z.string().optional().nullable(),
  firstName: z.string(),
  lastName: z.string().optional().nullable(),
  dob: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  school: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  board: z.string().optional().nullable(),
  admissionDate: z.string(),
  status: z.string(),
  feeModel: z.string(),
  dupKey: z.string(),
  mergedIntoId: z.string().uuid().optional().nullable(),
  customFields: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  archivedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Student = z.infer<typeof StudentSchema>;

export const GuardianSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  name: z.string(),
  relation: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  isPrimary: z.number().int(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Guardian = z.infer<typeof GuardianSchema>;

export const StudentEnrollmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  batchId: z.string().uuid(),
  joinedOn: z.string(),
  exitedOn: z.string().optional().nullable(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type StudentEnrollment = z.infer<typeof StudentEnrollmentSchema>;

export const TagSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  color: z.string().optional().nullable(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Tag = z.infer<typeof TagSchema>;

export const StudentTagSchema = z.object({
  studentId: z.string().uuid(),
  tagId: z.string().uuid(),
});

export type StudentTag = z.infer<typeof StudentTagSchema>;

export const StudentNoteSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  category: z.string(),
  body: z.string(),
  pinned: z.number().int(),
  createdBy: z.string().optional().nullable(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type StudentNote = z.infer<typeof StudentNoteSchema>;

export const StudentDocumentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  label: z.string(),
  blobKey: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  deletedAt: z.string().datetime().optional().nullable(),
  uploadedAt: z.string().datetime(),
});

export type StudentDocument = z.infer<typeof StudentDocumentSchema>;

export const AttendanceSessionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  batchId: z.string().uuid(),
  sessionDate: z.string(),
  startedAt: z.string().datetime().optional().nullable(),
  lockedAt: z.string().datetime().optional().nullable(),
  lockedBy: z.string().optional().nullable(),
  isHoliday: z.number().int(),
  notes: z.string().optional().nullable(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AttendanceSession = z.infer<typeof AttendanceSessionSchema>;

export const AttendanceRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
  status: z.string(),
  markedAt: z.string().datetime(),
  markedBy: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;

export const FeePlanSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  batchId: z.string().uuid().optional().nullable(),
});

export type FeePlan = z.infer<typeof FeePlanSchema>;


export const FeeScheduleItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  feePlanId: z.string().uuid(),
  label: z.string(),
  dueDate: z.string(),
  amount: z.number().int(),
  status: z.string(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FeeScheduleItem = z.infer<typeof FeeScheduleItemSchema>;

export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  number: z.string(),
  studentId: z.string().uuid(),
  feeScheduleItemId: z.string().uuid().optional().nullable(),
  issueDate: z.string(),
  dueDate: z.string().optional().nullable(),
  subtotal: z.number().int(),
  discount: z.number().int(),
  extraCharges: z.number().int(),
  total: z.number().int(),
  status: z.string(),
  voidedAt: z.string().datetime().optional().nullable(),
  voidReason: z.string().optional().nullable(),
  tamperHash: z.string(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

export const LedgerEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  batchId: z.string().uuid().optional().nullable(),
  invoiceId: z.string().uuid().optional().nullable(),
  type: z.string(),
  debitPaise: z.number().int(),
  creditPaise: z.number().int(),
  balanceAfterPaise: z.number().int(),
  description: z.string().optional().nullable(),
  receiptNo: z.string().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  paymentRef: z.string().optional().nullable(),
  prevHash: z.string().optional().nullable(),
  thisHash: z.string(),
  voidOfId: z.string().uuid().optional().nullable(),
  lockedAt: z.string().datetime().optional().nullable(),
  occurredOn: z.string(),
  source: z.string(),
  deviceId: z.string().uuid().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const ReceiptSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  number: z.string(),
  ledgerEntryId: z.string().uuid(),
  studentId: z.string().uuid(),
  invoiceId: z.string().uuid().optional().nullable(),
  amount: z.number().int(),
  paymentMethod: z.string(),
  paymentRef: z.string().optional().nullable(),
  receivedOn: z.string(),
  tamperHash: z.string(),
  voidedAt: z.string().datetime().optional().nullable(),
  pdfBlobKey: z.string().optional().nullable(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Receipt = z.infer<typeof ReceiptSchema>;

export const ReminderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  category: z.string(),
  refType: z.string(),
  refId: z.string().uuid(),
  dueAt: z.string().datetime(),
  status: z.string(),
  snoozeUntil: z.string().datetime().optional().nullable(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Reminder = z.infer<typeof ReminderSchema>;

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  category: z.string(),
  title: z.string(),
  body: z.string().optional().nullable(),
  refType: z.string().optional().nullable(),
  refId: z.string().uuid().optional().nullable(),
  readAt: z.string().datetime().optional().nullable(),
  deletedAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
});

export type Notification = z.infer<typeof NotificationSchema>;

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  actor: z.string(),
  action: z.string(),
  refType: z.string().optional().nullable(),
  refId: z.string().uuid().optional().nullable(),
  metadata: z.string().optional().nullable(),
  createdAt: z.string().datetime(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

export const SyncOutboxSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tableName: z.string(),
  rowId: z.string().uuid(),
  op: z.string(),
  payload: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  lastError: z.string().optional().nullable(),
  createdAt: z.string().datetime(),
  flushedAt: z.string().datetime().optional().nullable(),
});

export type SyncOutbox = z.infer<typeof SyncOutboxSchema>;

export const BackupManifestSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  filename: z.string(),
  sizeBytes: z.number().int(),
  schemaVersion: z.number().int(),
  rowCounts: z.string(),
  dataSha256: z.string(),
  encryptedSha256: z.string(),
  keyKdfSalt: z.string(),
  keyKdfParams: z.string(),
  createdAt: z.string().datetime(),
  createdBy: z.string().optional().nullable(),
});

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const AppStateSchema = z.object({
  tenantId: z.string().uuid(),
  schemaVersion: z.number().int(),
  appLockState: z.string(),
  appLockUntil: z.string().datetime().optional().nullable(),
  lastBackupAt: z.string().datetime().optional().nullable(),
  lastExportAt: z.string().datetime().optional().nullable(),
  lastSyncAt: z.string().datetime().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AppState = z.infer<typeof AppStateSchema>;

