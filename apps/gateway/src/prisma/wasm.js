
Object.defineProperty(exports, "__esModule", { value: true });

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
  NotFoundError,
  getPrismaClient,
  sqltag,
  empty,
  join,
  raw,
  skip,
  Decimal,
  Debug,
  objectEnumValues,
  makeStrictEnum,
  Extensions,
  warnOnce,
  defineDmmfProperty,
  Public,
  getRuntime
} = require('./runtime/wasm.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError;
Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError
Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError
Prisma.PrismaClientInitializationError = PrismaClientInitializationError
Prisma.PrismaClientValidationError = PrismaClientValidationError
Prisma.NotFoundError = NotFoundError
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = sqltag
Prisma.empty = empty
Prisma.join = join
Prisma.raw = raw
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = Extensions.getExtensionContext
Prisma.defineExtension = Extensions.defineExtension

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}





/**
 * Enums
 */
exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  Serializable: 'Serializable'
});

exports.Prisma.SettingScalarFieldEnum = {
  tenantId: 'tenantId',
  instituteName: 'instituteName',
  instituteAddress: 'instituteAddress',
  institutePhone: 'institutePhone',
  instituteEmail: 'instituteEmail',
  currencyCode: 'currencyCode',
  locale: 'locale',
  timezone: 'timezone',
  defaultFeeModel: 'defaultFeeModel',
  invoicePrefix: 'invoicePrefix',
  receiptPrefix: 'receiptPrefix',
  graceDays: 'graceDays',
  autoInvoice: 'autoInvoice',
  nextInvoiceSeq: 'nextInvoiceSeq',
  nextReceiptSeq: 'nextReceiptSeq',
  nextStudentSeq: 'nextStudentSeq',
  attendanceLockHours: 'attendanceLockHours',
  defaultAttendanceStatus: 'defaultAttendanceStatus',
  holidayListJson: 'holidayListJson',
  notifyDueFee: 'notifyDueFee',
  notifyUpcomingDue: 'notifyUpcomingDue',
  notifyMissingAttendance: 'notifyMissingAttendance',
  notifyInactiveStudent: 'notifyInactiveStudent',
  sessionTimeoutMin: 'sessionTimeoutMin',
  biometricEnabled: 'biometricEnabled',
  pinHash: 'pinHash',
  backupPassphraseHash: 'backupPassphraseHash',
  autoArchiveInactiveDays: 'autoArchiveInactiveDays',
  theme: 'theme',
  palette: 'palette',
  density: 'density',
  reducedMotion: 'reducedMotion',
  tenantSecret: 'tenantSecret',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TutorScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  name: 'name',
  email: 'email',
  phone: 'phone',
  role: 'role',
  isActive: 'isActive',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BatchScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  tutorId: 'tutorId',
  name: 'name',
  subject: 'subject',
  schedule: 'schedule',
  archivedAt: 'archivedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StudentScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  code: 'code',
  firstName: 'firstName',
  lastName: 'lastName',
  dob: 'dob',
  gender: 'gender',
  phone: 'phone',
  email: 'email',
  address: 'address',
  school: 'school',
  grade: 'grade',
  board: 'board',
  admissionDate: 'admissionDate',
  status: 'status',
  feeModel: 'feeModel',
  baseFeePaise: 'baseFeePaise',
  balancePaise: 'balancePaise',
  dupKey: 'dupKey',
  mergedIntoId: 'mergedIntoId',
  customFields: 'customFields',
  notes: 'notes',
  archivedAt: 'archivedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GuardianScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  studentId: 'studentId',
  name: 'name',
  relation: 'relation',
  phone: 'phone',
  email: 'email',
  isPrimary: 'isPrimary',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StudentEnrollmentScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  studentId: 'studentId',
  batchId: 'batchId',
  joinedOn: 'joinedOn',
  exitedOn: 'exitedOn',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TagScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  name: 'name',
  color: 'color',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StudentTagScalarFieldEnum = {
  studentId: 'studentId',
  tagId: 'tagId'
};

exports.Prisma.StudentNoteScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  studentId: 'studentId',
  category: 'category',
  body: 'body',
  pinned: 'pinned',
  createdBy: 'createdBy',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StudentDocumentScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  studentId: 'studentId',
  label: 'label',
  blobKey: 'blobKey',
  mimeType: 'mimeType',
  sizeBytes: 'sizeBytes',
  sha256: 'sha256',
  deletedAt: 'deletedAt',
  uploadedAt: 'uploadedAt'
};

exports.Prisma.AttendanceSessionScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  batchId: 'batchId',
  sessionDate: 'sessionDate',
  startedAt: 'startedAt',
  lockedAt: 'lockedAt',
  lockedBy: 'lockedBy',
  isHoliday: 'isHoliday',
  notes: 'notes',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AttendanceRecordScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  sessionId: 'sessionId',
  studentId: 'studentId',
  status: 'status',
  markedAt: 'markedAt',
  markedBy: 'markedBy',
  notes: 'notes',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.FeePlanScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  studentId: 'studentId',
  batchId: 'batchId',
  model: 'model',
  cycle: 'cycle',
  baseAmount: 'baseAmount',
  startDate: 'startDate',
  endDate: 'endDate',
  discountType: 'discountType',
  discountValue: 'discountValue',
  scholarship: 'scholarship',
  isActive: 'isActive',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.FeeScheduleItemScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  feePlanId: 'feePlanId',
  label: 'label',
  dueDate: 'dueDate',
  amount: 'amount',
  status: 'status',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InvoiceScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  number: 'number',
  studentId: 'studentId',
  feeScheduleItemId: 'feeScheduleItemId',
  issueDate: 'issueDate',
  dueDate: 'dueDate',
  subtotal: 'subtotal',
  discount: 'discount',
  extraCharges: 'extraCharges',
  total: 'total',
  status: 'status',
  voidedAt: 'voidedAt',
  voidReason: 'voidReason',
  tamperHash: 'tamperHash',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LedgerEntryScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  studentId: 'studentId',
  batchId: 'batchId',
  invoiceId: 'invoiceId',
  type: 'type',
  debitPaise: 'debitPaise',
  creditPaise: 'creditPaise',
  balanceAfterPaise: 'balanceAfterPaise',
  description: 'description',
  receiptNo: 'receiptNo',
  paymentMethod: 'paymentMethod',
  paymentRef: 'paymentRef',
  prevHash: 'prevHash',
  thisHash: 'thisHash',
  voidOfId: 'voidOfId',
  lockedAt: 'lockedAt',
  occurredOn: 'occurredOn',
  source: 'source',
  deviceId: 'deviceId',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReceiptScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  number: 'number',
  ledgerEntryId: 'ledgerEntryId',
  studentId: 'studentId',
  invoiceId: 'invoiceId',
  amount: 'amount',
  paymentMethod: 'paymentMethod',
  paymentRef: 'paymentRef',
  receivedOn: 'receivedOn',
  tamperHash: 'tamperHash',
  voidedAt: 'voidedAt',
  pdfBlobKey: 'pdfBlobKey',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReminderScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  category: 'category',
  refType: 'refType',
  refId: 'refId',
  dueAt: 'dueAt',
  status: 'status',
  snoozeUntil: 'snoozeUntil',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NotificationScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  category: 'category',
  title: 'title',
  body: 'body',
  refType: 'refType',
  refId: 'refId',
  readAt: 'readAt',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  actor: 'actor',
  action: 'action',
  refType: 'refType',
  refId: 'refId',
  metadata: 'metadata',
  createdAt: 'createdAt'
};

exports.Prisma.SyncOutboxScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  tableName: 'tableName',
  rowId: 'rowId',
  op: 'op',
  payload: 'payload',
  status: 'status',
  attempts: 'attempts',
  lastError: 'lastError',
  createdAt: 'createdAt',
  flushedAt: 'flushedAt'
};

exports.Prisma.BackupManifestScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  filename: 'filename',
  sizeBytes: 'sizeBytes',
  schemaVersion: 'schemaVersion',
  rowCounts: 'rowCounts',
  dataSha256: 'dataSha256',
  encryptedSha256: 'encryptedSha256',
  keyKdfSalt: 'keyKdfSalt',
  keyKdfParams: 'keyKdfParams',
  createdAt: 'createdAt',
  createdBy: 'createdBy'
};

exports.Prisma.AppStateScalarFieldEnum = {
  tenantId: 'tenantId',
  schemaVersion: 'schemaVersion',
  appLockState: 'appLockState',
  appLockUntil: 'appLockUntil',
  lastBackupAt: 'lastBackupAt',
  lastExportAt: 'lastExportAt',
  lastSyncAt: 'lastSyncAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  Setting: 'Setting',
  Tutor: 'Tutor',
  Batch: 'Batch',
  Student: 'Student',
  Guardian: 'Guardian',
  StudentEnrollment: 'StudentEnrollment',
  Tag: 'Tag',
  StudentTag: 'StudentTag',
  StudentNote: 'StudentNote',
  StudentDocument: 'StudentDocument',
  AttendanceSession: 'AttendanceSession',
  AttendanceRecord: 'AttendanceRecord',
  FeePlan: 'FeePlan',
  FeeScheduleItem: 'FeeScheduleItem',
  Invoice: 'Invoice',
  LedgerEntry: 'LedgerEntry',
  Receipt: 'Receipt',
  Reminder: 'Reminder',
  Notification: 'Notification',
  AuditLog: 'AuditLog',
  SyncOutbox: 'SyncOutbox',
  BackupManifest: 'BackupManifest',
  AppState: 'AppState'
};
/**
 * Create the Client
 */
const config = {
  "generator": {
    "name": "client",
    "provider": {
      "fromEnvVar": null,
      "value": "prisma-client-js"
    },
    "output": {
      "value": "D:\\Projects\\buddysaradhi\\buddysaradhi\\apps\\gateway\\src\\prisma",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "windows",
        "native": true
      }
    ],
    "previewFeatures": [
      "driverAdapters"
    ],
    "sourceFilePath": "D:\\Projects\\buddysaradhi\\buddysaradhi\\apps\\gateway\\prisma\\schema.prisma",
    "isCustomOutput": true
  },
  "relativeEnvPaths": {
    "rootEnvPath": null,
    "schemaEnvPath": "../../.env"
  },
  "relativePath": "../../prisma",
  "clientVersion": "5.22.0",
  "engineVersion": "605197351a3c8bdd595af2d2a9bc3025bca48ea2",
  "datasourceNames": [
    "db"
  ],
  "activeProvider": "sqlite",
  "inlineDatasources": {
    "db": {
      "url": {
        "fromEnvVar": "DATABASE_URL",
        "value": null
      }
    }
  },
  "inlineSchema": "generator client {\n  provider        = \"prisma-client-js\"\n  previewFeatures = [\"driverAdapters\"]\n  output          = \"../src/prisma\"\n}\n\ndatasource db {\n  provider = \"sqlite\"\n  url      = env(\"DATABASE_URL\")\n}\n\nmodel Setting {\n  tenantId         String  @id @map(\"tenant_id\")\n  instituteName    String  @default(\"My Tuition\") @map(\"institute_name\")\n  instituteAddress String? @map(\"institute_address\")\n  institutePhone   String? @map(\"institute_phone\")\n  instituteEmail   String? @map(\"institute_email\")\n  currencyCode     String  @default(\"INR\") @map(\"currency_code\")\n  locale           String  @default(\"en-IN\")\n  timezone         String  @default(\"Asia/Kolkata\")\n\n  // Fee Rules\n  defaultFeeModel String @default(\"postpaid\") @map(\"default_fee_model\")\n  invoicePrefix   String @default(\"INV-\") @map(\"invoice_prefix\")\n  receiptPrefix   String @default(\"RCP-\") @map(\"receipt_prefix\")\n  graceDays       Int    @default(0) @map(\"grace_days\")\n  autoInvoice     Int    @default(0) @map(\"auto_invoice\") // Boolean as Int 0/1\n  nextInvoiceSeq  Int    @default(1) @map(\"next_invoice_seq\")\n  nextReceiptSeq  Int    @default(1) @map(\"next_receipt_seq\")\n  nextStudentSeq  Int    @default(1) @map(\"next_student_seq\")\n\n  // Attendance Rules\n  attendanceLockHours     Int    @default(48) @map(\"attendance_lock_hours\")\n  defaultAttendanceStatus String @default(\"present\") @map(\"default_attendance_status\")\n  holidayListJson         String @default(\"[]\") @map(\"holiday_list_json\")\n\n  // Notifications\n  notifyDueFee            Int @default(1) @map(\"notify_due_fee\")\n  notifyUpcomingDue       Int @default(1) @map(\"notify_upcoming_due\")\n  notifyMissingAttendance Int @default(1) @map(\"notify_missing_attendance\")\n  notifyInactiveStudent   Int @default(1) @map(\"notify_inactive_student\")\n\n  // Security\n  sessionTimeoutMin    Int     @default(5) @map(\"session_timeout_min\")\n  biometricEnabled     Int     @default(0) @map(\"biometric_enabled\")\n  pinHash              String? @map(\"pin_hash\")\n  backupPassphraseHash String? @map(\"backup_passphrase_hash\")\n\n  // Data Privacy\n  autoArchiveInactiveDays Int @default(90) @map(\"auto_archive_inactive_days\")\n\n  // Appearance\n  theme         String @default(\"system\")\n  palette       String @default(\"aurora-cosmic\") @map(\"palette\")\n  density       String @default(\"comfortable\")\n  reducedMotion Int    @default(0) @map(\"reduced_motion\")\n\n  tenantSecret String   @map(\"tenant_secret\")\n  createdAt    DateTime @map(\"created_at\")\n  updatedAt    DateTime @updatedAt @map(\"updated_at\")\n\n  @@map(\"settings\")\n}\n\nmodel Tutor {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  name      String\n  email     String?\n  phone     String?\n  role      String    @default(\"tutor\")\n  isActive  Int       @default(1) @map(\"is_active\")\n  deletedAt DateTime? @map(\"deleted_at\")\n  createdAt DateTime  @map(\"created_at\")\n  updatedAt DateTime  @updatedAt @map(\"updated_at\")\n\n  batches Batch[]\n\n  @@index([tenantId, isActive])\n  @@map(\"tutors\")\n}\n\nmodel Batch {\n  id         String    @id\n  tenantId   String    @map(\"tenant_id\")\n  tutorId    String?   @map(\"tutor_id\")\n  name       String\n  subject    String?\n  schedule   String?\n  archivedAt DateTime? @map(\"archived_at\")\n  createdAt  DateTime  @map(\"created_at\")\n  updatedAt  DateTime  @updatedAt @map(\"updated_at\")\n\n  tutor         Tutor?              @relation(fields: [tutorId], references: [id])\n  students      StudentEnrollment[]\n  sessions      AttendanceSession[]\n  feePlans      FeePlan[]\n  ledgerEntries LedgerEntry[]\n\n  @@index([tenantId, archivedAt])\n  @@index([tutorId, archivedAt])\n  @@map(\"batches\")\n}\n\nmodel Student {\n  id            String    @id\n  tenantId      String    @map(\"tenant_id\")\n  code          String?\n  firstName     String    @map(\"first_name\")\n  lastName      String?   @map(\"last_name\")\n  dob           String?\n  gender        String?\n  phone         String?\n  email         String?\n  address       String?\n  school        String?\n  grade         String?\n  board         String?\n  admissionDate String    @map(\"admission_date\")\n  status        String    @default(\"active\")\n  feeModel      String    @default(\"postpaid\") @map(\"fee_model\")\n  baseFeePaise  Int       @default(0) @map(\"base_fee_paise\")\n  balancePaise  Int       @default(0) @map(\"balance_paise\")\n  dupKey        String    @map(\"dup_key\")\n  mergedIntoId  String?   @map(\"merged_into_id\")\n  customFields  String?   @map(\"custom_fields\")\n  notes         String?\n  archivedAt    DateTime? @map(\"archived_at\")\n  createdAt     DateTime  @map(\"created_at\")\n  updatedAt     DateTime  @updatedAt @map(\"updated_at\")\n\n  mergedInto Student?  @relation(\"StudentMerge\", fields: [mergedIntoId], references: [id])\n  mergedFrom Student[] @relation(\"StudentMerge\")\n\n  guardians     Guardian[]\n  enrollments   StudentEnrollment[]\n  tags          StudentTag[]\n  studentNotes  StudentNote[]\n  documents     StudentDocument[]\n  attendance    AttendanceRecord[]\n  feePlans      FeePlan[]\n  invoices      Invoice[]\n  ledgerEntries LedgerEntry[]\n  receipts      Receipt[]\n\n  @@index([tenantId, status, archivedAt])\n  @@index([tenantId, lastName, firstName])\n  @@index([tenantId, dupKey])\n  @@index([tenantId, balancePaise])\n  @@map(\"students\")\n}\n\nmodel Guardian {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  studentId String    @map(\"student_id\")\n  name      String\n  relation  String?\n  phone     String?\n  email     String?\n  isPrimary Int       @default(0) @map(\"is_primary\")\n  deletedAt DateTime? @map(\"deleted_at\")\n  createdAt DateTime  @map(\"created_at\")\n  updatedAt DateTime  @updatedAt @map(\"updated_at\")\n\n  student Student @relation(fields: [studentId], references: [id])\n\n  @@index([studentId])\n  @@index([tenantId, phone])\n  @@map(\"guardians\")\n}\n\nmodel StudentEnrollment {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  studentId String    @map(\"student_id\")\n  batchId   String    @map(\"batch_id\")\n  joinedOn  String    @map(\"joined_on\")\n  exitedOn  String?   @map(\"exited_on\")\n  deletedAt DateTime? @map(\"deleted_at\")\n  createdAt DateTime  @map(\"created_at\")\n  updatedAt DateTime  @updatedAt @map(\"updated_at\")\n\n  student Student @relation(fields: [studentId], references: [id])\n  batch   Batch   @relation(fields: [batchId], references: [id])\n\n  @@unique([studentId, batchId, joinedOn])\n  @@index([batchId, exitedOn])\n  @@index([studentId])\n  @@map(\"student_enrollments\")\n}\n\nmodel Tag {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  name      String\n  color     String?\n  deletedAt DateTime? @map(\"deleted_at\")\n  createdAt DateTime  @map(\"created_at\")\n  updatedAt DateTime  @updatedAt @map(\"updated_at\")\n\n  students StudentTag[]\n\n  @@unique([tenantId, name])\n  @@map(\"tags\")\n}\n\nmodel StudentTag {\n  studentId String @map(\"student_id\")\n  tagId     String @map(\"tag_id\")\n\n  student Student @relation(fields: [studentId], references: [id])\n  tag     Tag     @relation(fields: [tagId], references: [id])\n\n  @@id([studentId, tagId])\n  @@map(\"student_tags\")\n}\n\nmodel StudentNote {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  studentId String    @map(\"student_id\")\n  category  String\n  body      String\n  pinned    Int       @default(0)\n  createdBy String?   @map(\"created_by\")\n  deletedAt DateTime? @map(\"deleted_at\")\n  createdAt DateTime  @map(\"created_at\")\n  updatedAt DateTime  @updatedAt @map(\"updated_at\")\n\n  student Student @relation(fields: [studentId], references: [id])\n\n  @@index([studentId, createdAt(sort: Desc)])\n  @@map(\"student_notes\")\n}\n\nmodel StudentDocument {\n  id         String    @id\n  tenantId   String    @map(\"tenant_id\")\n  studentId  String    @map(\"student_id\")\n  label      String\n  blobKey    String    @map(\"blob_key\")\n  mimeType   String    @map(\"mime_type\")\n  sizeBytes  Int       @map(\"size_bytes\")\n  sha256     String\n  deletedAt  DateTime? @map(\"deleted_at\")\n  uploadedAt DateTime  @map(\"uploaded_at\")\n\n  student Student @relation(fields: [studentId], references: [id])\n\n  @@index([studentId])\n  @@map(\"student_documents\")\n}\n\nmodel AttendanceSession {\n  id          String    @id\n  tenantId    String    @map(\"tenant_id\")\n  batchId     String    @map(\"batch_id\")\n  sessionDate String    @map(\"session_date\")\n  startedAt   DateTime? @map(\"started_at\")\n  lockedAt    DateTime? @map(\"locked_at\")\n  lockedBy    String?   @map(\"locked_by\")\n  isHoliday   Int       @default(0) @map(\"is_holiday\")\n  notes       String?\n  deletedAt   DateTime? @map(\"deleted_at\")\n  createdAt   DateTime  @map(\"created_at\")\n  updatedAt   DateTime  @updatedAt @map(\"updated_at\")\n\n  batch   Batch              @relation(fields: [batchId], references: [id])\n  records AttendanceRecord[]\n\n  @@unique([batchId, sessionDate])\n  @@index([sessionDate])\n  @@map(\"attendance_sessions\")\n}\n\nmodel AttendanceRecord {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  sessionId String    @map(\"session_id\")\n  studentId String    @map(\"student_id\")\n  status    String\n  markedAt  DateTime  @map(\"marked_at\")\n  markedBy  String?   @map(\"marked_by\")\n  notes     String?\n  deletedAt DateTime? @map(\"deleted_at\")\n  createdAt DateTime  @map(\"created_at\")\n  updatedAt DateTime  @updatedAt @map(\"updated_at\")\n\n  session AttendanceSession @relation(fields: [sessionId], references: [id])\n  student Student           @relation(fields: [studentId], references: [id])\n\n  @@unique([sessionId, studentId])\n  @@index([studentId, sessionId])\n  @@index([sessionId, status])\n  @@map(\"attendance_records\")\n}\n\nmodel FeePlan {\n  id            String    @id\n  tenantId      String    @map(\"tenant_id\")\n  studentId     String    @map(\"student_id\")\n  batchId       String?   @map(\"batch_id\")\n  model         String\n  cycle         String\n  baseAmount    Int       @map(\"base_amount\")\n  startDate     String    @map(\"start_date\")\n  endDate       String?   @map(\"end_date\")\n  discountType  String?   @map(\"discount_type\")\n  discountValue Int?      @map(\"discount_value\")\n  scholarship   String?\n  isActive      Int       @default(1) @map(\"is_active\")\n  deletedAt     DateTime? @map(\"deleted_at\")\n  createdAt     DateTime  @map(\"created_at\")\n  updatedAt     DateTime  @updatedAt @map(\"updated_at\")\n\n  student       Student           @relation(fields: [studentId], references: [id])\n  batch         Batch?            @relation(fields: [batchId], references: [id])\n  scheduleItems FeeScheduleItem[]\n\n  @@index([studentId, isActive])\n  @@index([batchId])\n  @@map(\"fee_plans\")\n}\n\nmodel FeeScheduleItem {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  feePlanId String    @map(\"fee_plan_id\")\n  label     String\n  dueDate   String    @map(\"due_date\")\n  amount    Int\n  status    String    @default(\"pending\")\n  deletedAt DateTime? @map(\"deleted_at\")\n  createdAt DateTime  @map(\"created_at\")\n  updatedAt DateTime  @updatedAt @map(\"updated_at\")\n\n  plan     FeePlan   @relation(fields: [feePlanId], references: [id])\n  invoices Invoice[]\n\n  @@index([dueDate, status])\n  @@index([feePlanId, status])\n  @@map(\"fee_schedule_items\")\n}\n\nmodel Invoice {\n  id                String    @id\n  tenantId          String    @map(\"tenant_id\")\n  number            String\n  studentId         String    @map(\"student_id\")\n  feeScheduleItemId String?   @map(\"fee_schedule_item_id\")\n  issueDate         String    @map(\"issue_date\")\n  dueDate           String?   @map(\"due_date\")\n  subtotal          Int\n  discount          Int       @default(0)\n  extraCharges      Int       @default(0) @map(\"extra_charges\")\n  total             Int\n  status            String    @default(\"unpaid\")\n  voidedAt          DateTime? @map(\"voided_at\")\n  voidReason        String?   @map(\"void_reason\")\n  tamperHash        String    @map(\"tamper_hash\")\n  deletedAt         DateTime? @map(\"deleted_at\")\n  createdAt         DateTime  @map(\"created_at\")\n  updatedAt         DateTime  @updatedAt @map(\"updated_at\")\n\n  student         Student          @relation(fields: [studentId], references: [id])\n  feeScheduleItem FeeScheduleItem? @relation(fields: [feeScheduleItemId], references: [id])\n  ledgerEntries   LedgerEntry[]\n  receipts        Receipt[]\n\n  @@unique([tenantId, number])\n  @@index([studentId, status])\n  @@index([dueDate, status])\n  @@index([feeScheduleItemId])\n  @@map(\"invoices\")\n}\n\nmodel LedgerEntry {\n  id                String    @id\n  tenantId          String    @map(\"tenant_id\")\n  studentId         String    @map(\"student_id\")\n  batchId           String?   @map(\"batch_id\")\n  invoiceId         String?   @map(\"invoice_id\")\n  type              String\n  debitPaise        Int       @default(0) @map(\"debit_paise\")\n  creditPaise       Int       @default(0) @map(\"credit_paise\")\n  balanceAfterPaise Int       @map(\"balance_after_paise\")\n  description       String?\n  receiptNo         String?   @map(\"receipt_no\")\n  paymentMethod     String?   @map(\"payment_method\")\n  paymentRef        String?   @map(\"payment_ref\")\n  prevHash          String?   @map(\"prev_hash\")\n  thisHash          String    @map(\"this_hash\")\n  voidOfId          String?   @map(\"void_of_id\")\n  lockedAt          DateTime? @map(\"locked_at\")\n  occurredOn        String    @map(\"occurred_on\")\n  source            String    @default(\"manual\")\n  deviceId          String?   @map(\"device_id\")\n  createdBy         String?   @map(\"created_by\")\n  createdAt         DateTime  @map(\"created_at\")\n  updatedAt         DateTime  @updatedAt @map(\"updated_at\")\n\n  student  Student       @relation(fields: [studentId], references: [id])\n  batch    Batch?        @relation(fields: [batchId], references: [id])\n  invoice  Invoice?      @relation(fields: [invoiceId], references: [id])\n  voidOf   LedgerEntry?  @relation(\"VoidOf\", fields: [voidOfId], references: [id])\n  voidedBy LedgerEntry[] @relation(\"VoidOf\")\n  receipts Receipt[]\n\n  @@index([studentId, createdAt])\n  @@index([batchId])\n  @@index([invoiceId])\n  @@index([tenantId, type, occurredOn])\n  @@index([receiptNo])\n  @@index([thisHash])\n  @@index([voidOfId])\n  @@map(\"ledger_entries\")\n}\n\nmodel Receipt {\n  id            String    @id\n  tenantId      String    @map(\"tenant_id\")\n  number        String\n  ledgerEntryId String    @map(\"ledger_entry_id\")\n  studentId     String    @map(\"student_id\")\n  invoiceId     String?   @map(\"invoice_id\")\n  amount        Int\n  paymentMethod String    @map(\"payment_method\")\n  paymentRef    String?   @map(\"payment_ref\")\n  receivedOn    String    @map(\"received_on\")\n  tamperHash    String    @map(\"tamper_hash\")\n  voidedAt      DateTime? @map(\"voided_at\")\n  pdfBlobKey    String?   @map(\"pdf_blob_key\")\n  deletedAt     DateTime? @map(\"deleted_at\")\n  createdAt     DateTime  @map(\"created_at\")\n  updatedAt     DateTime  @updatedAt @map(\"updated_at\")\n\n  ledgerEntry LedgerEntry @relation(fields: [ledgerEntryId], references: [id])\n  student     Student     @relation(fields: [studentId], references: [id])\n  invoice     Invoice?    @relation(fields: [invoiceId], references: [id])\n\n  @@unique([tenantId, number])\n  @@index([studentId, receivedOn])\n  @@index([ledgerEntryId])\n  @@index([invoiceId])\n  @@map(\"receipts\")\n}\n\nmodel Reminder {\n  id          String    @id\n  tenantId    String    @map(\"tenant_id\")\n  category    String\n  refType     String    @map(\"ref_type\")\n  refId       String    @map(\"ref_id\")\n  dueAt       DateTime  @map(\"due_at\")\n  status      String    @default(\"pending\")\n  snoozeUntil DateTime? @map(\"snooze_until\")\n  deletedAt   DateTime? @map(\"deleted_at\")\n  createdAt   DateTime  @map(\"created_at\")\n  updatedAt   DateTime  @updatedAt @map(\"updated_at\")\n\n  @@index([status, dueAt])\n  @@index([tenantId, refType, refId])\n  @@map(\"reminders\")\n}\n\nmodel Notification {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  category  String\n  title     String\n  body      String?\n  refType   String?   @map(\"ref_type\")\n  refId     String?   @map(\"ref_id\")\n  readAt    DateTime? @map(\"read_at\")\n  deletedAt DateTime? @map(\"deleted_at\")\n  createdAt DateTime  @map(\"created_at\")\n\n  @@index([tenantId, readAt, createdAt])\n  @@index([tenantId, refType, refId])\n  @@map(\"notifications\")\n}\n\nmodel AuditLog {\n  id        String   @id\n  tenantId  String   @map(\"tenant_id\")\n  actor     String\n  action    String\n  refType   String?  @map(\"ref_type\")\n  refId     String?  @map(\"ref_id\")\n  metadata  String?\n  createdAt DateTime @map(\"created_at\")\n\n  @@index([tenantId, createdAt])\n  @@index([tenantId, action, createdAt])\n  @@index([tenantId, refType, refId])\n  @@map(\"audit_log\")\n}\n\nmodel SyncOutbox {\n  id        String    @id\n  tenantId  String    @map(\"tenant_id\")\n  tableName String    @map(\"table_name\")\n  rowId     String    @map(\"row_id\")\n  op        String\n  payload   String\n  status    String    @default(\"pending\")\n  attempts  Int       @default(0)\n  lastError String?   @map(\"last_error\")\n  createdAt DateTime  @map(\"created_at\")\n  flushedAt DateTime? @map(\"flushed_at\")\n\n  @@index([tenantId])\n  @@index([status, createdAt])\n  @@index([tableName, rowId])\n  @@map(\"sync_outbox\")\n}\n\nmodel BackupManifest {\n  id              String   @id\n  tenantId        String   @map(\"tenant_id\")\n  filename        String\n  sizeBytes       Int      @map(\"size_bytes\")\n  schemaVersion   Int      @map(\"schema_version\")\n  rowCounts       String   @map(\"row_counts\")\n  dataSha256      String   @map(\"data_sha256\")\n  encryptedSha256 String   @map(\"encrypted_sha256\")\n  keyKdfSalt      String   @map(\"key_kdf_salt\")\n  keyKdfParams    String   @map(\"key_kdf_params\")\n  createdAt       DateTime @map(\"created_at\")\n  createdBy       String?  @map(\"created_by\")\n\n  @@index([tenantId, createdAt(sort: Desc)])\n  @@map(\"backup_manifest\")\n}\n\nmodel AppState {\n  tenantId      String    @id @map(\"tenant_id\")\n  schemaVersion Int       @map(\"schema_version\")\n  appLockState  String    @default(\"unlocked\") @map(\"app_lock_state\")\n  appLockUntil  DateTime? @map(\"app_lock_until\")\n  lastBackupAt  DateTime? @map(\"last_backup_at\")\n  lastExportAt  DateTime? @map(\"last_export_at\")\n  lastSyncAt    DateTime? @map(\"last_sync_at\")\n  createdAt     DateTime  @map(\"created_at\")\n  updatedAt     DateTime  @updatedAt @map(\"updated_at\")\n\n  @@map(\"app_state\")\n}\n",
  "inlineSchemaHash": "f659e7408f845c9e77525d22e6d29acff5367b978bb2937066ea8a55336af8ce",
  "copyEngine": true
}
config.dirname = '/'

config.runtimeDataModel = JSON.parse("{\"models\":{\"Setting\":{\"fields\":[{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"instituteName\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"institute_name\"},{\"name\":\"instituteAddress\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"institute_address\"},{\"name\":\"institutePhone\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"institute_phone\"},{\"name\":\"instituteEmail\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"institute_email\"},{\"name\":\"currencyCode\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"currency_code\"},{\"name\":\"locale\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"timezone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"defaultFeeModel\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"default_fee_model\"},{\"name\":\"invoicePrefix\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"invoice_prefix\"},{\"name\":\"receiptPrefix\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"receipt_prefix\"},{\"name\":\"graceDays\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"grace_days\"},{\"name\":\"autoInvoice\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"auto_invoice\"},{\"name\":\"nextInvoiceSeq\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"next_invoice_seq\"},{\"name\":\"nextReceiptSeq\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"next_receipt_seq\"},{\"name\":\"nextStudentSeq\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"next_student_seq\"},{\"name\":\"attendanceLockHours\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"attendance_lock_hours\"},{\"name\":\"defaultAttendanceStatus\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"default_attendance_status\"},{\"name\":\"holidayListJson\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"holiday_list_json\"},{\"name\":\"notifyDueFee\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"notify_due_fee\"},{\"name\":\"notifyUpcomingDue\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"notify_upcoming_due\"},{\"name\":\"notifyMissingAttendance\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"notify_missing_attendance\"},{\"name\":\"notifyInactiveStudent\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"notify_inactive_student\"},{\"name\":\"sessionTimeoutMin\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"session_timeout_min\"},{\"name\":\"biometricEnabled\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"biometric_enabled\"},{\"name\":\"pinHash\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"pin_hash\"},{\"name\":\"backupPassphraseHash\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"backup_passphrase_hash\"},{\"name\":\"autoArchiveInactiveDays\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"auto_archive_inactive_days\"},{\"name\":\"theme\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"palette\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"palette\"},{\"name\":\"density\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reducedMotion\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"reduced_motion\"},{\"name\":\"tenantSecret\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_secret\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"}],\"dbName\":\"settings\"},\"Tutor\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"phone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"role\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"is_active\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"batches\",\"kind\":\"object\",\"type\":\"Batch\",\"relationName\":\"BatchToTutor\"}],\"dbName\":\"tutors\"},\"Batch\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"tutorId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tutor_id\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"subject\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"schedule\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"archivedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"archived_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"tutor\",\"kind\":\"object\",\"type\":\"Tutor\",\"relationName\":\"BatchToTutor\"},{\"name\":\"students\",\"kind\":\"object\",\"type\":\"StudentEnrollment\",\"relationName\":\"BatchToStudentEnrollment\"},{\"name\":\"sessions\",\"kind\":\"object\",\"type\":\"AttendanceSession\",\"relationName\":\"AttendanceSessionToBatch\"},{\"name\":\"feePlans\",\"kind\":\"object\",\"type\":\"FeePlan\",\"relationName\":\"BatchToFeePlan\"},{\"name\":\"ledgerEntries\",\"kind\":\"object\",\"type\":\"LedgerEntry\",\"relationName\":\"BatchToLedgerEntry\"}],\"dbName\":\"batches\"},\"Student\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"code\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"firstName\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"first_name\"},{\"name\":\"lastName\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"last_name\"},{\"name\":\"dob\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"gender\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"phone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"address\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"school\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"grade\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"board\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"admissionDate\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"admission_date\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"feeModel\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"fee_model\"},{\"name\":\"baseFeePaise\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"base_fee_paise\"},{\"name\":\"balancePaise\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"balance_paise\"},{\"name\":\"dupKey\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"dup_key\"},{\"name\":\"mergedIntoId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"merged_into_id\"},{\"name\":\"customFields\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"custom_fields\"},{\"name\":\"notes\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"archivedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"archived_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"mergedInto\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"StudentMerge\"},{\"name\":\"mergedFrom\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"StudentMerge\"},{\"name\":\"guardians\",\"kind\":\"object\",\"type\":\"Guardian\",\"relationName\":\"GuardianToStudent\"},{\"name\":\"enrollments\",\"kind\":\"object\",\"type\":\"StudentEnrollment\",\"relationName\":\"StudentToStudentEnrollment\"},{\"name\":\"tags\",\"kind\":\"object\",\"type\":\"StudentTag\",\"relationName\":\"StudentToStudentTag\"},{\"name\":\"studentNotes\",\"kind\":\"object\",\"type\":\"StudentNote\",\"relationName\":\"StudentToStudentNote\"},{\"name\":\"documents\",\"kind\":\"object\",\"type\":\"StudentDocument\",\"relationName\":\"StudentToStudentDocument\"},{\"name\":\"attendance\",\"kind\":\"object\",\"type\":\"AttendanceRecord\",\"relationName\":\"AttendanceRecordToStudent\"},{\"name\":\"feePlans\",\"kind\":\"object\",\"type\":\"FeePlan\",\"relationName\":\"FeePlanToStudent\"},{\"name\":\"invoices\",\"kind\":\"object\",\"type\":\"Invoice\",\"relationName\":\"InvoiceToStudent\"},{\"name\":\"ledgerEntries\",\"kind\":\"object\",\"type\":\"LedgerEntry\",\"relationName\":\"LedgerEntryToStudent\"},{\"name\":\"receipts\",\"kind\":\"object\",\"type\":\"Receipt\",\"relationName\":\"ReceiptToStudent\"}],\"dbName\":\"students\"},\"Guardian\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"relation\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"phone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isPrimary\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"is_primary\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"GuardianToStudent\"}],\"dbName\":\"guardians\"},\"StudentEnrollment\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"batchId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"batch_id\"},{\"name\":\"joinedOn\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"joined_on\"},{\"name\":\"exitedOn\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"exited_on\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"StudentToStudentEnrollment\"},{\"name\":\"batch\",\"kind\":\"object\",\"type\":\"Batch\",\"relationName\":\"BatchToStudentEnrollment\"}],\"dbName\":\"student_enrollments\"},\"Tag\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"color\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"students\",\"kind\":\"object\",\"type\":\"StudentTag\",\"relationName\":\"StudentTagToTag\"}],\"dbName\":\"tags\"},\"StudentTag\":{\"fields\":[{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"tagId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tag_id\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"StudentToStudentTag\"},{\"name\":\"tag\",\"kind\":\"object\",\"type\":\"Tag\",\"relationName\":\"StudentTagToTag\"}],\"dbName\":\"student_tags\"},\"StudentNote\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"category\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"body\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"pinned\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"created_by\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"StudentToStudentNote\"}],\"dbName\":\"student_notes\"},\"StudentDocument\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"label\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"blobKey\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"blob_key\"},{\"name\":\"mimeType\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"mime_type\"},{\"name\":\"sizeBytes\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"size_bytes\"},{\"name\":\"sha256\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"uploadedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"uploaded_at\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"StudentToStudentDocument\"}],\"dbName\":\"student_documents\"},\"AttendanceSession\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"batchId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"batch_id\"},{\"name\":\"sessionDate\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"session_date\"},{\"name\":\"startedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"started_at\"},{\"name\":\"lockedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"locked_at\"},{\"name\":\"lockedBy\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"locked_by\"},{\"name\":\"isHoliday\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"is_holiday\"},{\"name\":\"notes\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"batch\",\"kind\":\"object\",\"type\":\"Batch\",\"relationName\":\"AttendanceSessionToBatch\"},{\"name\":\"records\",\"kind\":\"object\",\"type\":\"AttendanceRecord\",\"relationName\":\"AttendanceRecordToAttendanceSession\"}],\"dbName\":\"attendance_sessions\"},\"AttendanceRecord\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"sessionId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"session_id\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"markedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"marked_at\"},{\"name\":\"markedBy\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"marked_by\"},{\"name\":\"notes\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"session\",\"kind\":\"object\",\"type\":\"AttendanceSession\",\"relationName\":\"AttendanceRecordToAttendanceSession\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"AttendanceRecordToStudent\"}],\"dbName\":\"attendance_records\"},\"FeePlan\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"batchId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"batch_id\"},{\"name\":\"model\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"cycle\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"baseAmount\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"base_amount\"},{\"name\":\"startDate\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"start_date\"},{\"name\":\"endDate\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"end_date\"},{\"name\":\"discountType\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"discount_type\"},{\"name\":\"discountValue\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"discount_value\"},{\"name\":\"scholarship\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"is_active\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"FeePlanToStudent\"},{\"name\":\"batch\",\"kind\":\"object\",\"type\":\"Batch\",\"relationName\":\"BatchToFeePlan\"},{\"name\":\"scheduleItems\",\"kind\":\"object\",\"type\":\"FeeScheduleItem\",\"relationName\":\"FeePlanToFeeScheduleItem\"}],\"dbName\":\"fee_plans\"},\"FeeScheduleItem\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"feePlanId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"fee_plan_id\"},{\"name\":\"label\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"dueDate\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"due_date\"},{\"name\":\"amount\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"plan\",\"kind\":\"object\",\"type\":\"FeePlan\",\"relationName\":\"FeePlanToFeeScheduleItem\"},{\"name\":\"invoices\",\"kind\":\"object\",\"type\":\"Invoice\",\"relationName\":\"FeeScheduleItemToInvoice\"}],\"dbName\":\"fee_schedule_items\"},\"Invoice\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"number\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"feeScheduleItemId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"fee_schedule_item_id\"},{\"name\":\"issueDate\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"issue_date\"},{\"name\":\"dueDate\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"due_date\"},{\"name\":\"subtotal\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"discount\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"extraCharges\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"extra_charges\"},{\"name\":\"total\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"voidedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"voided_at\"},{\"name\":\"voidReason\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"void_reason\"},{\"name\":\"tamperHash\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tamper_hash\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"InvoiceToStudent\"},{\"name\":\"feeScheduleItem\",\"kind\":\"object\",\"type\":\"FeeScheduleItem\",\"relationName\":\"FeeScheduleItemToInvoice\"},{\"name\":\"ledgerEntries\",\"kind\":\"object\",\"type\":\"LedgerEntry\",\"relationName\":\"InvoiceToLedgerEntry\"},{\"name\":\"receipts\",\"kind\":\"object\",\"type\":\"Receipt\",\"relationName\":\"InvoiceToReceipt\"}],\"dbName\":\"invoices\"},\"LedgerEntry\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"batchId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"batch_id\"},{\"name\":\"invoiceId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"invoice_id\"},{\"name\":\"type\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"debitPaise\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"debit_paise\"},{\"name\":\"creditPaise\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"credit_paise\"},{\"name\":\"balanceAfterPaise\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"balance_after_paise\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"receiptNo\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"receipt_no\"},{\"name\":\"paymentMethod\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"payment_method\"},{\"name\":\"paymentRef\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"payment_ref\"},{\"name\":\"prevHash\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"prev_hash\"},{\"name\":\"thisHash\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"this_hash\"},{\"name\":\"voidOfId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"void_of_id\"},{\"name\":\"lockedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"locked_at\"},{\"name\":\"occurredOn\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"occurred_on\"},{\"name\":\"source\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deviceId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"device_id\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"created_by\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"LedgerEntryToStudent\"},{\"name\":\"batch\",\"kind\":\"object\",\"type\":\"Batch\",\"relationName\":\"BatchToLedgerEntry\"},{\"name\":\"invoice\",\"kind\":\"object\",\"type\":\"Invoice\",\"relationName\":\"InvoiceToLedgerEntry\"},{\"name\":\"voidOf\",\"kind\":\"object\",\"type\":\"LedgerEntry\",\"relationName\":\"VoidOf\"},{\"name\":\"voidedBy\",\"kind\":\"object\",\"type\":\"LedgerEntry\",\"relationName\":\"VoidOf\"},{\"name\":\"receipts\",\"kind\":\"object\",\"type\":\"Receipt\",\"relationName\":\"LedgerEntryToReceipt\"}],\"dbName\":\"ledger_entries\"},\"Receipt\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"number\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"ledgerEntryId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"ledger_entry_id\"},{\"name\":\"studentId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"student_id\"},{\"name\":\"invoiceId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"invoice_id\"},{\"name\":\"amount\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"paymentMethod\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"payment_method\"},{\"name\":\"paymentRef\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"payment_ref\"},{\"name\":\"receivedOn\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"received_on\"},{\"name\":\"tamperHash\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tamper_hash\"},{\"name\":\"voidedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"voided_at\"},{\"name\":\"pdfBlobKey\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"pdf_blob_key\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"},{\"name\":\"ledgerEntry\",\"kind\":\"object\",\"type\":\"LedgerEntry\",\"relationName\":\"LedgerEntryToReceipt\"},{\"name\":\"student\",\"kind\":\"object\",\"type\":\"Student\",\"relationName\":\"ReceiptToStudent\"},{\"name\":\"invoice\",\"kind\":\"object\",\"type\":\"Invoice\",\"relationName\":\"InvoiceToReceipt\"}],\"dbName\":\"receipts\"},\"Reminder\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"category\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"refType\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"ref_type\"},{\"name\":\"refId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"ref_id\"},{\"name\":\"dueAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"due_at\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"snoozeUntil\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"snooze_until\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"}],\"dbName\":\"reminders\"},\"Notification\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"category\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"title\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"body\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"refType\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"ref_type\"},{\"name\":\"refId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"ref_id\"},{\"name\":\"readAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"read_at\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"deleted_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"}],\"dbName\":\"notifications\"},\"AuditLog\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"actor\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"action\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"refType\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"ref_type\"},{\"name\":\"refId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"ref_id\"},{\"name\":\"metadata\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"}],\"dbName\":\"audit_log\"},\"SyncOutbox\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"tableName\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"table_name\"},{\"name\":\"rowId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"row_id\"},{\"name\":\"op\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"payload\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"attempts\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"lastError\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"last_error\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"flushedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"flushed_at\"}],\"dbName\":\"sync_outbox\"},\"BackupManifest\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"filename\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"sizeBytes\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"size_bytes\"},{\"name\":\"schemaVersion\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"schema_version\"},{\"name\":\"rowCounts\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"row_counts\"},{\"name\":\"dataSha256\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"data_sha256\"},{\"name\":\"encryptedSha256\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"encrypted_sha256\"},{\"name\":\"keyKdfSalt\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"key_kdf_salt\"},{\"name\":\"keyKdfParams\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"key_kdf_params\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"created_by\"}],\"dbName\":\"backup_manifest\"},\"AppState\":{\"fields\":[{\"name\":\"tenantId\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"tenant_id\"},{\"name\":\"schemaVersion\",\"kind\":\"scalar\",\"type\":\"Int\",\"dbName\":\"schema_version\"},{\"name\":\"appLockState\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"app_lock_state\"},{\"name\":\"appLockUntil\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"app_lock_until\"},{\"name\":\"lastBackupAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"last_backup_at\"},{\"name\":\"lastExportAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"last_export_at\"},{\"name\":\"lastSyncAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"last_sync_at\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"created_at\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\",\"dbName\":\"updated_at\"}],\"dbName\":\"app_state\"}},\"enums\":{},\"types\":{}}")
defineDmmfProperty(exports.Prisma, config.runtimeDataModel)
config.engineWasm = {
  getRuntime: () => require('./query_engine_bg.js'),
  getQueryEngineWasmModule: async () => {
    const loader = (await import('#wasm-engine-loader')).default
    const engine = (await loader).default
    return engine 
  }
}

config.injectableEdgeEnv = () => ({
  parsed: {
    DATABASE_URL: typeof globalThis !== 'undefined' && globalThis['DATABASE_URL'] || typeof process !== 'undefined' && process.env && process.env.DATABASE_URL || undefined
  }
})

if (typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined) {
  Debug.enable(typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined)
}

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

