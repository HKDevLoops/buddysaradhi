import { create } from 'zustand';
import { StudentFilters, SavedFilter, SortCol, TabKey, StudentDuplicateMatch } from '../types/students';

interface StudentsStoreState {
  // Filters & search
  filters: StudentFilters;
  searchQuery: string;
  savedFilters: SavedFilter[];
  page: number;
  pageSize: number;
  sort: { col: SortCol; dir: 'asc' | 'desc' };

  // Selection & drawer
  selectedStudentId: string | null;
  drawerOpen: boolean;
  activeTab: TabKey;
  bulkSelectedIds: string[];

  // Mutation sheets
  addSheetOpen: boolean;
  editSheetOpen: boolean;
  duplicateInterstitial: StudentDuplicateMatch | null;
  mergeTargetId: string | null;

  // Actions
  setFilters: (f: Partial<StudentFilters>) => void;
  setSearchQuery: (q: string) => void;
  openDrawer: (id: string, tab?: TabKey) => void;
  closeDrawer: () => void;
  setActiveTab: (t: TabKey) => void;
  toggleBulkSelect: (id: string) => void;
  clearBulkSelection: () => void;
  openAddSheet: () => void;
  closeAddSheet: () => void;
  openEditSheet: () => void;
  closeEditSheet: () => void;
  setDuplicateInterstitial: (m: StudentDuplicateMatch | null) => void;
  setPage: (p: number) => void;
  setSort: (col: SortCol, dir: 'asc' | 'desc') => void;
}

const defaultFilters: StudentFilters = {
  status: ['active'],
  batchIds: [],
  feeModels: [],
  tagIds: [],
  balanceRange: 'all',
  admittedInLast: 'all',
};

export const useStudentsStore = create<StudentsStoreState>((set) => ({
  filters: defaultFilters,
  searchQuery: '',
  savedFilters: [],
  page: 1,
  pageSize: 50,
  sort: { col: 'name', dir: 'asc' },

  selectedStudentId: null,
  drawerOpen: false,
  activeTab: 'profile',
  bulkSelectedIds: [],

  addSheetOpen: false,
  editSheetOpen: false,
  duplicateInterstitial: null,
  mergeTargetId: null,

  setFilters: (f) => set((state) => ({ filters: { ...state.filters, ...f }, page: 1 })),
  setSearchQuery: (q) => set({ searchQuery: q, page: 1 }),
  openDrawer: (id, tab) => set((state) => ({
    selectedStudentId: id,
    drawerOpen: true,
    activeTab: tab ?? state.activeTab
  })),
  closeDrawer: () => set({ drawerOpen: false }),
  setActiveTab: (t) => set({ activeTab: t }),
  
  toggleBulkSelect: (id) => set((state) => ({
    bulkSelectedIds: state.bulkSelectedIds.includes(id)
      ? state.bulkSelectedIds.filter((x) => x !== id)
      : [...state.bulkSelectedIds, id]
  })),
  clearBulkSelection: () => set({ bulkSelectedIds: [] }),

  openAddSheet: () => set({ addSheetOpen: true }),
  closeAddSheet: () => set({ addSheetOpen: false }),
  
  openEditSheet: () => set({ editSheetOpen: true }),
  closeEditSheet: () => set({ editSheetOpen: false }),
  
  setDuplicateInterstitial: (m) => set({ duplicateInterstitial: m }),
  
  setPage: (p) => set({ page: p }),
  setSort: (col, dir) => set({ sort: { col, dir } })
}));
