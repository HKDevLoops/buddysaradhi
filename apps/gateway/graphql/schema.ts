export const typeDefs = `
type Query {
  health: String!
  settings(tenantId: ID!): Settings
  students(tenantId: ID!, page: Int, pageSize: Int, search: String): StudentPage!
  ledgerEntries(tenantId: ID!, page: Int, pageSize: Int): LedgerEntryPage!
}

type Settings {
  id: ID!
  tenantId: String!
  instituteName: String!
  instituteAddress: String
  institutePhone: String
  instituteEmail: String
  currencyCode: String!
  locale: String!
  timezone: String!
  defaultFeeModel: String!
  invoicePrefix: String!
  receiptPrefix: String!
  graceDays: Int!
  autoInvoice: Int!
  nextInvoiceSeq: Int!
  nextReceiptSeq: Int!
  nextStudentSeq: Int!
  attendanceLockHours: Int!
  defaultAttendanceStatus: String
  holidayListJson: String
  notifyDueFee: Int!
  notifyUpcomingDue: Int!
  notifyMissingAttendance: Int!
  notifyInactiveStudent: Int!
  sessionTimeoutMin: Int!
  biometricEnabled: Int!
  autoArchiveInactiveDays: Int
  theme: String!
  palette: String!
  density: String
  reducedMotion: Int
}

type Student {
  id: ID!
  name: String!
  rollNo: String
  gender: String
  phone: String
  email: String
  school: String
  grade: String
  board: String
  admissionDate: String
  status: String!
  feeModel: String!
  baseFeePaise: Int!
  balancePaise: Int!
  dupKey: String
  createdAt: String
}

type StudentPage {
  items: [Student!]!
  total: Int!
  page: Int!
  pageSize: Int!
}

type LedgerEntry {
  id: ID!
  tenantId: String!
  studentId: String!
  type: String!
  debitPaise: Int!
  creditPaise: Int!
  balanceAfterPaise: Int!
  description: String
  receiptNo: String
  paymentMethod: String
  occurredOn: String
  createdAt: String
}

type LedgerEntryPage {
  items: [LedgerEntry!]!
  total: Int!
  page: Int!
  pageSize: Int!
}
`;
