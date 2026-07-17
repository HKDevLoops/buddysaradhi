// apps/web/src/app/api/v1/[...slug]/fixtures.ts
//
// Demo data layer for the embedded gateway. The web build runs against a local
// SQLite file (TURSO_DATABASE_URL="file:../../prisma/dev.db"). To guarantee the
// five screens render populated like the spec prototype regardless of DB seed
// state, the data endpoints below return deterministic, internally-consistent
// demo fixtures. `settings` and `security/erase` remain on the real Prisma store.
//
// All money is integer paise (Rule 6). Statuses use the schema enums.

export const DEMO_TENANT = "local-dev";

export interface StudentListRow {
  id: string;
  code: string | null;
  name: string;
  grade: string | null;
  batch: string | null;
  fee_model: "postpaid" | "prepaid" | "mixed";
  balance_due: number;
  status: "active" | "inactive" | "graduated" | "archived";
}

export interface Student {
  id: string;
  tenant_id: string;
  code: string | null;
  first_name: string;
  last_name: string | null;
  dob: string | null;
  gender: "M" | "F" | "O" | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  school: string | null;
  grade: string | null;
  board: string | null;
  admission_date: string;
  status: "active" | "inactive" | "graduated" | "archived";
  fee_model: "postpaid" | "prepaid" | "mixed";
  baseFeePaise: number;
  dup_key: string;
  merged_into_id: string | null;
  custom_fields: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RawStudent {
  id: string;
  code: string;
  first: string;
  last: string;
  grade: string;
  batch: string;
  fee_model: "postpaid" | "prepaid" | "mixed";
  balance: number; // paise
  status: "active" | "inactive" | "graduated" | "archived";
  gender: "M" | "F" | "O";
  phone: string;
  admitted: string;
}

const RAW: RawStudent[] = [
  { id: "11111111-1111-1111-1111-111111111101", code: "S-001", first: "Aarav", last: "Sharma", grade: "10", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "M", phone: "+91 98765 11001", admitted: "2024-04-02" },
  { id: "11111111-1111-1111-1111-111111111102", code: "S-002", first: "Diya", last: "Patel", grade: "10", batch: "Morning Batch", fee_model: "postpaid", balance: 45000, status: "active", gender: "F", phone: "+91 98765 11002", admitted: "2024-04-05" },
  { id: "11111111-1111-1111-1111-111111111103", code: "S-003", first: "Vivaan", last: "Reddy", grade: "9", batch: "Evening Batch", fee_model: "mixed", balance: 120000, status: "active", gender: "M", phone: "+91 98765 11003", admitted: "2024-04-08" },
  { id: "11111111-1111-1111-1111-111111111104", code: "S-004", first: "Ananya", last: "Iyer", grade: "11", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F", phone: "+91 98765 11004", admitted: "2024-04-10" },
  { id: "11111111-1111-1111-1111-111111111105", code: "S-005", first: "Kabir", last: "Singh", grade: "9", batch: "Evening Batch", fee_model: "postpaid", balance: 75000, status: "active", gender: "M", phone: "+91 98765 11005", admitted: "2024-04-12" },
  { id: "11111111-1111-1111-1111-111111111106", code: "S-006", first: "Isha", last: "Khan", grade: "10", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F", phone: "+91 98765 11006", admitted: "2024-04-15" },
  { id: "11111111-1111-1111-1111-111111111107", code: "S-007", first: "Arjun", last: "Nair", grade: "12", batch: "Evening Batch", fee_model: "mixed", balance: 200000, status: "active", gender: "M", phone: "+91 98765 11007", admitted: "2024-04-18" },
  { id: "11111111-1111-1111-1111-111111111108", code: "S-008", first: "Myra", last: "Gupta", grade: "8", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F", phone: "+91 98765 11008", admitted: "2024-04-20" },
  { id: "11111111-1111-1111-1111-111111111109", code: "S-009", first: "Rohan", last: "Mehta", grade: "9", batch: "Evening Batch", fee_model: "postpaid", balance: 30000, status: "inactive", gender: "M", phone: "+91 98765 11009", admitted: "2024-04-22" },
  { id: "11111111-1111-1111-1111-111111111110", code: "S-010", first: "Sara", last: "Jose", grade: "10", batch: "Morning Batch", fee_model: "mixed", balance: 90000, status: "active", gender: "F", phone: "+91 98765 11010", admitted: "2024-04-25" },
  { id: "11111111-1111-1111-1111-111111111111", code: "S-011", first: "Aditya", last: "Das", grade: "11", batch: "Evening Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "M", phone: "+91 98765 11011", admitted: "2024-04-28" },
  { id: "11111111-1111-1111-1111-111111111112", code: "S-012", first: "Kiara", last: "Rao", grade: "8", batch: "Morning Batch", fee_model: "postpaid", balance: 60000, status: "active", gender: "F", phone: "+91 98765 11012", admitted: "2024-05-01" },
  { id: "11111111-1111-1111-1111-111111111113", code: "S-013", first: "Reyansh", last: "Roy", grade: "12", batch: "Evening Batch", fee_model: "prepaid", balance: 0, status: "graduated", gender: "M", phone: "+91 98765 11013", admitted: "2023-05-10" },
  { id: "11111111-1111-1111-1111-111111111114", code: "S-014", first: "Pari", last: "Bhat", grade: "9", batch: "Morning Batch", fee_model: "postpaid", balance: 150000, status: "active", gender: "F", phone: "+91 98765 11014", admitted: "2024-05-05" },
];

export const BATCHES = [
  { id: "b-morning", name: "Morning Batch", subject: "Mathematics" },
  { id: "b-evening", name: "Evening Batch", subject: "Science" },
];

const BASE_FEE = 150000; // ₹1500 base monthly, integer paise

export function getBatches() {
  return BATCHES;
}

function toStudent(r: RawStudent): Student {
  return {
    id: r.id,
    tenant_id: DEMO_TENANT,
    code: r.code,
    first_name: r.first,
    last_name: r.last,
    dob: "2009-01-01",
    gender: r.gender,
    phone: r.phone,
    email: `${r.first.toLowerCase()}.${r.last.toLowerCase()}@example.com`,
    address: "12 Rose Lane, Bengaluru",
    school: "Delhi Public School",
    grade: r.grade,
    board: "CBSE",
    admission_date: r.admitted,
    status: r.status,
    fee_model: r.fee_model,
    baseFeePaise: BASE_FEE,
    dup_key: `${r.code}`,
    merged_into_id: null,
    custom_fields: null,
    notes: null,
    archived_at: null,
    created_at: r.admitted,
    updated_at: r.admitted,
  };
}

export const ALL_STUDENTS: Student[] = RAW.map(toStudent);

export function getStudentList(): StudentListRow[] {
  return RAW.map((r) => ({
    id: r.id,
    code: r.code,
    name: `${r.first} ${r.last}`,
    grade: r.grade,
    batch: r.batch,
    fee_model: r.fee_model,
    balance_due: r.balance,
    status: r.status,
  }));
}

export function getStudentById(id: string): Student | undefined {
  return ALL_STUDENTS.find((s) => s.id === id);
}

// Deterministic hash so attendance is stable per date.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

export function getAttendanceForDate(dateIso: string, batchId?: string) {
  const rows = RAW.filter((r) => !batchId || batchId === "all" || r.batch === BATCHES.find((b) => b.id === batchId)?.name).map((r) => {
    const h = hashStr(`${dateIso}:${r.id}`);
    const mod = h % 10;
    const status: "present" | "absent" | "late" | null = mod === 0 ? "absent" : mod === 1 ? "late" : "present";
    return {
      student_id: r.id,
      name: `${r.first} ${r.last}`,
      batch: r.batch,
      status,
    };
  });
  return {
    session: {
      id: `sess-${dateIso}`,
      tenant_id: DEMO_TENANT,
      session_date: dateIso,
      batch_id: batchId && batchId !== "all" ? batchId : null,
      locked_at: null,
      created_at: dateIso,
      updated_at: dateIso,
    },
    records: rows,
  };
}

export interface DashboardKpis {
  totalStudents: number;
  studentsWithDues: number;
  collectedThisMonthMinor: number;
  dueTillDateMinor: number;
  dueForMonthMinor: number;
  paymentBreakdown: { paid: number; partial: number; unpaid: number; noDues: number };
}

export function getDashboardKpis(): DashboardKpis {
  const active = RAW.filter((r) => r.status === "active");
  const withDues = active.filter((r) => r.balance > 0);
  const dues = active.reduce((sum, r) => sum + r.balance, 0);
  return {
    totalStudents: active.length,
    studentsWithDues: withDues.length,
    collectedThisMonthMinor: 320000,
    dueTillDateMinor: dues,
    dueForMonthMinor: 210000,
    paymentBreakdown: {
      paid: active.length - withDues.length,
      partial: withDues.length,
      unpaid: 0,
      noDues: active.length - withDues.length,
    },
  };
}

export function getActivityFeed(limit = 20) {
  const items = [
    { id: "f1", type: "payment", title: "Diya Patel paid ₹450", description: "Receipt #R-1042", timestamp: "2026-07-12T09:12:00Z" },
    { id: "f2", type: "attendance", title: "Morning Batch marked present", description: "12 of 14 students", timestamp: "2026-07-12T08:05:00Z" },
    { id: "f3", type: "invoice", title: "Invoice #INV-0091 raised", description: "Vivaan Reddy — ₹1,200", timestamp: "2026-07-11T17:40:00Z" },
    { id: "f4", type: "enrollment", title: "Pari Bhat enrolled", description: "Class 9 · Morning Batch", timestamp: "2026-07-10T14:22:00Z" },
    { id: "f5", type: "payment", title: "Kabir Singh paid ₹750", description: "Receipt #R-1041", timestamp: "2026-07-10T11:01:00Z" },
    { id: "f6", type: "reminder", title: "Due-fee reminder sent", description: "3 students notified", timestamp: "2026-07-09T18:00:00Z" },
  ];
  return items.slice(0, limit);
}

export function getDueToday() {
  return RAW.filter((r) => r.balance > 0 && r.status === "active").map((r) => ({
    student_id: r.id,
    student_name: `${r.first} ${r.last}`,
    due_minor: r.balance,
    invoice_number: `INV-${r.code.slice(2)}`,
    due_date: "2026-07-12",
  }));
}

export function getHeatmaps(periodStartIso: string, periodEndIso: string) {
  const start = new Date(periodStartIso);
  const end = new Date(periodEndIso);
  const activeStudents = RAW.filter((r) => r.status === "active");
  const attendanceRecords: Array<{ student_name: string; date: string; status: "present" | "absent" | "late" }> = [];
  const financialRecords: Array<{ student_name: string; week_start: string; cell_status: "paid" | "partial" | "unpaid"; due_minor: number }> = [];

  // Generate day-by-day attendance records for all active students
  const dayMs = 86400000;
  for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
    const curDate = new Date(t);
    const dateStr = curDate.toISOString().slice(0, 10);
    const dow = curDate.getUTCDay();
    if (dow === 0) continue; // skip Sunday

    for (const stud of activeStudents) {
      const h = hashStr(`${dateStr}:${stud.id}`);
      const mod = h % 12;
      const status = mod === 0 ? "absent" : mod === 1 ? "late" : "present";
      attendanceRecords.push({
        student_name: `${stud.first} ${stud.last}`,
        date: dateStr,
        status,
      });
    }
  }

  // Generate week-by-week financial records for all active students
  const startOfPeriod = new Date(start.getFullYear(), start.getMonth(), 1);
  const weeksCount = 4;
  for (let w = 0; w < weeksCount; w++) {
    const weekDate = new Date(startOfPeriod.getTime() + w * 7 * dayMs);
    const weekStartStr = weekDate.toISOString().slice(0, 10);

    for (const stud of activeStudents) {
      const h = hashStr(`${weekStartStr}:${stud.id}`);
      const cell_status = h % 3 === 0 ? "paid" : h % 3 === 1 ? "partial" : "unpaid";
      financialRecords.push({
        student_name: `${stud.first} ${stud.last}`,
        week_start: weekStartStr,
        cell_status,
        due_minor: cell_status === "paid" ? 0 : cell_status === "partial" ? 75000 : 150000,
      });
    }
  }

  return {
    attendance: { records: attendanceRecords, holidays: ["2026-07-15", "2026-07-20"] },
    financial: financialRecords,
  };
}

export interface LedgerEntryRow {
  id: string;
  tenant_id: string;
  student_id: string;
  type: string;
  debit: number;
  credit: number;
  balance_after: number;
  method: string | null;
  description: string | null;
  occurred_on: string;
  invoice_id: string | null;
  receipt_no: string | null;
  reverses_entry_id: string | null;
  this_hash: string | null;
  isVoid: boolean;
}

export function getLedger(studentId: string, limit = 100): LedgerEntryRow[] {
  const raw = RAW.find((r) => r.id === studentId);
  if (!raw) return [];
    const entries: LedgerEntryRow[] = [
    {
      id: `le-${studentId}-1`,
      tenant_id: DEMO_TENANT,
      student_id: studentId,
      type: "fee",
      debit: BASE_FEE,
      credit: 0,
      balance_after: BASE_FEE,
      method: null,
      description: "Monthly tuition — July 2026",
      occurred_on: "2026-07-01",
      invoice_id: `inv-${studentId}`,
      receipt_no: null,
      reverses_entry_id: null,
      this_hash: null,
      isVoid: false,
    },
  ];
  if (raw.balance > 0) {
    entries.push({
      id: `le-${studentId}-2`,
      tenant_id: DEMO_TENANT,
      student_id: studentId,
      type: "payment",
      debit: 0,
      credit: BASE_FEE - raw.balance,
      balance_after: raw.balance,
      method: "upi",
      description: "Part payment",
      occurred_on: "2026-07-05",
      invoice_id: null,
      receipt_no: `R-${studentId.slice(-3)}`,
      reverses_entry_id: null,
      this_hash: null,
      isVoid: false,
    });
  } else {
    entries.push({
      id: `le-${studentId}-2`,
      tenant_id: DEMO_TENANT,
      student_id: studentId,
      type: "payment",
      debit: 0,
      credit: BASE_FEE,
      balance_after: 0,
      method: "upi",
      description: "Full payment",
      occurred_on: "2026-07-03",
      invoice_id: null,
      receipt_no: `R-${studentId.slice(-3)}`,
      reverses_entry_id: null,
      this_hash: null,
      isVoid: false,
    });
  }
  return entries.slice(0, limit);
}

export function getInvoices(studentId: string) {
  const raw = RAW.find((r) => r.id === studentId);
  if (!raw) return [];
  return [
    {
      id: `inv-${studentId}`,
      tenant_id: DEMO_TENANT,
      number: `INV-${raw.code.slice(2)}`,
      student_id: studentId,
      issue_date: "2026-07-01",
      due_date: "2026-07-10",
      subtotal: BASE_FEE,
      total: BASE_FEE,
      status: raw.balance > 0 ? "partial" : "paid",
      paid_amount_minor: BASE_FEE - raw.balance,
    },
  ];
}

export function getLedgerFees(search?: string) {
  let rows = getStudentList();
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q));
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    fee_model: r.fee_model,
    balance_due: r.balance_due,
  }));
}
