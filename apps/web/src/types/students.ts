export type StudentFilters = {
  status: ('active' | 'inactive' | 'graduated' | 'archived')[];
  batchIds: string[];
  feeModels: ('postpaid' | 'prepaid' | 'mixed')[];
  tagIds: string[];
  balanceRange: 'all' | 'zero' | 'has_dues' | 'overdue_only';
  admittedInLast: 'all' | '7d' | '30d' | '90d';
};

export type SavedFilter = {
  id: string;
  name: string;
  filters: StudentFilters;
};

/**
 * The roster's sort vocabulary — EXACTLY the keys of the gateway's
 * `ROSTER_SORT_COLUMN` (`apps/gateway/routes/students.ts:162-170`) and nothing
 * more. Every key maps to a real `students` column the gateway validates, so a
 * value from this union cannot produce a 400.
 *
 * The union used to declare only `name | code | balance` while the server
 * accepted seven. A type NARROWER than the server is a silent truncation of
 * capability: the roster cannot be ordered by grade, status, admission date or
 * age, and nothing says so. A type WIDER than the server is the opposite
 * failure — every value past the end is a runtime 400 — so the union is pinned
 * to the server's set, and this comment is the coupling that keeps them equal.
 * Change one and you must change the other.
 */
export type SortCol = 'name' | 'code' | 'balance' | 'grade' | 'status' | 'joined' | 'created';

export type TabKey = 'profile' | 'fee_plan' | 'ledger' | 'invoices' | 'attendance' | 'timeline' | 'notes' | 'documents';

export type StudentDuplicateMatch = {
  existingStudent: {
    id: string;
    first_name: string;
    last_name: string | null;
    phone: string | null;
    status: string;
  };
  dupKey: string;
  score: number;
};
