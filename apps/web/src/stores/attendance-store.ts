import { create } from 'zustand';

interface AttendanceState {
  selectedDateIso: string;
  selectedBatch: string | 'all';
  searchQuery: string;
  isLockSheetOpen: boolean;
  isReportOpen: boolean;
  setDate: (dateIso: string) => void;
  setBatch: (batch: string) => void;
  setSearchQuery: (query: string) => void;
  setLockSheetOpen: (open: boolean) => void;
  setReportOpen: (open: boolean) => void;
}

export const useAttendanceStore = create<AttendanceState>((set) => ({
  selectedDateIso: new Date().toISOString().split('T')[0] as string,
  selectedBatch: 'all',
  searchQuery: '',
  isLockSheetOpen: false,
  isReportOpen: false,
  setDate: (dateIso) => set({ selectedDateIso: dateIso }),
  setBatch: (batch) => set({ selectedBatch: batch }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLockSheetOpen: (open) => set({ isLockSheetOpen: open }),
  setReportOpen: (open) => set({ isReportOpen: open }),
}));
