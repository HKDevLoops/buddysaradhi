// Implements: 22_Vector_Search_System.md §1 — composite document blob builders.
//
// Every searchable entity in Buddysaradhi is a *composite text blob* — one
// string that folds all of the entity's fields into a single embedding. The
// blob starts with a type tag (`[STUDENT]`, `[LEDGER]`, `[LESSON]`, `[NOTE]`)
// so the embedding model treats each entity type distinctly. At query time,
// if the tutor's query implies a type, the query blob is prefixed the same
// way, biasing the cosine similarity toward that type.
//
// Why a composite blob (not per-field embeddings):
// Per-field embeddings would require a multi-vector index and a fusion step
// (RRF) at query time — extra complexity and latency. The composite blob
// folds all fields into one vector, so one HNSW search answers any query.
// (Spec 22 §1.1.)
//
// This module is pure TypeScript with no deps. The web agent should copy it
// into `mini-services/search-svc/document-builder.ts` verbatim.

/**
 * A student record. Fields match the spec 22 §1 example blob.
 */
export interface Student {
  id: string;
  name: string;
  /** Optional Devanagari (or other script) alias. */
  alias?: string;
  grade: number | string;
  batch: string;
  guardianName: string;
  guardianRelation: string; // "father", "mother", etc.
  guardianPhone: string;
  feeFrequency: 'monthly' | 'quarterly' | 'annual';
  feeAmount: number; // in rupees
  arrears: number; // in rupees
  notes: string;
  attendancePct: number; // 0-100, last 30 days
  enrolledMonth: string; // "Jan 2026"
}

/**
 * A ledger entry (fee payment, charge, reversal, etc.).
 */
export interface LedgerEntry {
  id: string;
  date: string; // ISO date "2026-07-11"
  studentId: string;
  type: 'fee_payment' | 'charge' | 'reversal' | 'adjustment';
  amount: number; // in rupees
  method?: 'UPI' | 'cash' | 'card' | 'bank_transfer';
  note?: string;
  reversesId?: string | null;
}

/**
 * A lesson / session note (what was taught in a class).
 */
export interface Lesson {
  id: string;
  date: string;
  batch: string;
  topic: string;
  /** Free-text observations about individual students. */
  observations: string;
  homework?: string;
}

/**
 * A free-text tutor note (a quick memo about a student).
 */
export interface TutorNote {
  id: string;
  date: string;
  studentId?: string;
  text: string;
}

/**
 * Format a rupee amount for the blob (e.g. `₹2500`, `₹1,200`).
 *
 * @complexity O(1).
 */
function inr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

/**
 * Build the composite text blob for a Student record. Format from spec 22 §1.
 *
 * @complexity O(L) where L is the total text length. Bounded by the schema
 *   (~500 chars), so O(1) in practice.
 */
export function buildStudentDocument(s: Student): string {
  const alias = s.alias ? ` (${s.alias})` : '';
  return (
    `[STUDENT] Name: ${s.name}${alias}. Grade: ${s.grade}. Batch: ${s.batch}. ` +
    `Guardian: ${s.guardianName} (${s.guardianRelation}), ${s.guardianPhone}. ` +
    `Fee: ${inr(s.feeAmount)}/${s.feeFrequency}. ` +
    `Status: arrears ${inr(s.arrears)}. ` +
    `Notes: ${s.notes}. ` +
    `Attendance: ${s.attendancePct}% (last 30 days). ` +
    `Enrolled: ${s.enrolledMonth}.`
  );
}

/**
 * Build the composite text blob for a LedgerEntry. The student's name is
 * passed in (the indexer fetches it from student-svc before embedding).
 *
 * @complexity O(L) = O(1).
 */
export function buildLedgerDocument(e: LedgerEntry, studentName: string): string {
  const method = e.method ? ` Method: ${e.method}.` : '';
  const note = e.note ? ` Note: ${e.note}.` : '';
  const reverses = e.reversesId ? ` Reverses: ${e.reversesId}.` : ' Reverses: none.';
  return (
    `[LEDGER] Date: ${e.date}. Student: ${studentName}. Type: ${e.type}. ` +
    `Amount: ${inr(e.amount)}.${method}${note}${reverses}`
  );
}

/**
 * Build the composite text blob for a Lesson / session note.
 *
 * @complexity O(L) = O(1).
 */
export function buildLessonDocument(l: Lesson): string {
  const hw = l.homework ? ` Homework: ${l.homework}.` : '';
  return (
    `[LESSON] Date: ${l.date}. Batch: ${l.batch}. Topic: ${l.topic}. ` +
    `${l.observations}.${hw}`
  );
}

/**
 * Build the composite text blob for a free-text TutorNote.
 *
 * @complexity O(L) = O(1).
 */
export function buildNoteDocument(n: TutorNote): string {
  const student = n.studentId ? ` Student: ${n.studentId}.` : '';
  return `[NOTE] ${n.date}.${student} ${n.text}`;
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const student: Student = {
    id: 's_a3b1',
    name: 'Aarav Sharma',
    alias: 'आरव शर्मा',
    grade: 10,
    batch: 'Morning Maths 10A',
    guardianName: 'Ramesh Sharma',
    guardianRelation: 'father',
    guardianPhone: '+91-98xxxxxx21',
    feeFrequency: 'monthly',
    feeAmount: 2500,
    arrears: 1200,
    notes: 'struggles with fractions, strong in algebra',
    attendancePct: 78,
    enrolledMonth: 'Jan 2026',
  };
  console.log('=== buildStudentDocument ===');
  console.log(buildStudentDocument(student));

  const entry: LedgerEntry = {
    id: 'l_1',
    date: '2026-07-11',
    studentId: 's_a3b1',
    type: 'fee_payment',
    amount: 2500,
    method: 'UPI',
    note: 'July tuition',
    reversesId: null,
  };
  console.log('\n=== buildLedgerDocument ===');
  console.log(buildLedgerDocument(entry, 'Aarav Sharma'));

  const lesson: Lesson = {
    id: 'ls_1',
    date: '2026-07-10',
    batch: 'Morning Maths 10A',
    topic: 'Fractions — addition and subtraction',
    observations: 'Aarav struggled; gave extra worksheet. Priya aced it.',
    homework: 'worksheet 3',
  };
  console.log('\n=== buildLessonDocument ===');
  console.log(buildLessonDocument(lesson));

  const note: TutorNote = {
    id: 'tn_1',
    date: '2026-07-09',
    studentId: 's_a3b1',
    text: "Aarav's father called about fee extension. Granted 1 week. Follow up 16 Jul.",
  };
  console.log('\n=== buildNoteDocument ===');
  console.log(buildNoteDocument(note));
}
