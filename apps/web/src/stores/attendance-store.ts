import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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

export const useAttendanceStore = create<AttendanceState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'buddysaradhi.attendance.v1',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        selectedDateIso: state.selectedDateIso,
        selectedBatch: state.selectedBatch,
        searchQuery: state.searchQuery,
      }),
      version: 1,
    }
  )
);
