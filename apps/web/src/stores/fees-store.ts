import { create } from 'zustand';

interface FeesState {
  mode: 'overview' | 'ledger';
  searchQuery: string;
  selectedStudentId: string | null;
  isPaymentSheetOpen: boolean;
  isInvoiceSheetOpen: boolean;
  setMode: (mode: 'overview' | 'ledger') => void;
  setSearchQuery: (query: string) => void;
  setSelectedStudentId: (id: string | null) => void;
  setPaymentSheetOpen: (open: boolean) => void;
  setInvoiceSheetOpen: (open: boolean) => void;
}

export const useFeesStore = create<FeesState>((set) => ({
  mode: 'overview',
  searchQuery: '',
  selectedStudentId: null,
  isPaymentSheetOpen: false,
  isInvoiceSheetOpen: false,
  setMode: (mode) => set({ mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedStudentId: (id) => set({ selectedStudentId: id }),
  setPaymentSheetOpen: (open) => set({ isPaymentSheetOpen: open }),
  setInvoiceSheetOpen: (open) => set({ isInvoiceSheetOpen: open }),
}));
