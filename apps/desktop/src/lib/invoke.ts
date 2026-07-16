import { invoke as tauriInvoke } from '@tauri-apps/api/core';

// Kpis
export interface Kpis {
  collected: number;
  due_today: number;
  present_pct: number;
}

export async function getKpis(): Promise<Kpis> {
  return await tauriInvoke<Kpis>('get_kpis');
}

// Students
export interface Student {
  id: string;
  code: string;
  first_name: string;
  last_name?: string;
  phone?: string;
  status: string;
  archived_at?: string;
}

export interface CreateStudentInput {
  first_name: string;
  last_name?: string;
  phone?: string;
  batch_id: string;
  default_fee_paise: number;
}

export async function getStudents(filter: { search?: string } = {}): Promise<Student[]> {
  return await tauriInvoke<Student[]>('get_students', { filter });
}

export async function createStudent(input: CreateStudentInput, pin?: string): Promise<Student> {
  return await tauriInvoke<Student>('create_student', { input, pin });
}

// Ledger
export interface LedgerEntry {
  id: string;
  student_id: string;
  entry_type: string;
  debit_paise: number;
  credit_paise: number;
  balance_after_paise: number;
  receipt_no?: string;
}

export interface RecordPaymentInput {
  student_id: string;
  invoice_id?: string;
  amount_paise: number;
  method: string;
  reference?: string;
  occurred_on: string;
  notes?: string;
}

export async function recordPayment(input: RecordPaymentInput, pin: string): Promise<LedgerEntry> {
  return await tauriInvoke<LedgerEntry>('record_payment', { input, pin });
}

export async function voidLedgerEntry(id: string, reason: string, pin: string): Promise<LedgerEntry> {
  return await tauriInvoke<LedgerEntry>('void_ledger_entry', { id, reason, pin });
}

// Attendance
export interface Mark {
  student_id: string;
  status: string;
  notes?: string;
}

export interface MarkAttendanceInput {
  batch_id: string;
  session_date: string;
  marks: Mark[];
}

export interface AttendanceSession {
  id: string;
  batch_id: string;
  session_date: string;
}

export async function markAttendance(input: MarkAttendanceInput): Promise<AttendanceSession> {
  return await tauriInvoke<AttendanceSession>('mark_attendance', { input });
}

// Settings
export interface Settings {
  institute_name: string;
  currency_code: string;
  session_timeout_min: number;
  theme: string;
}

export interface UpdateSettingsInput {
  institute_name?: string;
  theme?: string;
  session_timeout_min?: number;
}

export async function getSettings(): Promise<Settings> {
  return await tauriInvoke<Settings>('get_settings');
}

export async function updateSettings(input: UpdateSettingsInput): Promise<Settings> {
  return await tauriInvoke<Settings>('update_settings', { input });
}
