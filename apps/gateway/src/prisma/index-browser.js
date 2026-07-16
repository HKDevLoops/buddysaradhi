
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


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

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

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
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
