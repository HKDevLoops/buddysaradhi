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

export type SortCol = 'name' | 'code' | 'balance';

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
