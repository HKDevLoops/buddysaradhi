// Implements: 05_Students.md §Master List — the roster's filters, search, sort,
// paging, drawer, bulk selection and the two mutation sheets. AGENTS.md §2 Rule 4
// (this state does not create a screen: it dresses the one Students route).
//
// THE CONTRACT
// ────────────
// OWNS: what the roster is showing and which row is open. It is CLIENT view
//   state — the server owns the rows, TanStack Query owns the cache, and this
//   store owns the intent ("filter status=active, page 3, drawer open on student
//   X").
// RETURNS: primitives and stable array references. Every setter builds a NEW
//   object inside `set(...)`, never in a selector, so `useStudentsStore(s => …)`
//   never returns a fresh reference and cannot loop a render. That is the whole
//   Zustand discipline and it is why there is no `useShallow` here.
// ON UNMOUNT: nothing. A store is not a subscription; nothing is registered and
//   nothing leaks. State deliberately survives navigation — a tutor who opens a
//   drawer, visits Settings and comes back must land on the same row.
// DELIBERATELY DOES NOT: persist. There is no `persist` middleware here, and
//   that is right: the roster is a view of data the server owns, and rehydrating
//   a stale filter set would show a tutor students they had filtered out of two
//   sessions ago with no visible control explaining why the list is short.
//   It also does not hold student DATA (no row objects) — `["students"]` in the
//   query cache does.
//
// TWO FIELDS THAT ARE DECLARED BY THE SPEC BUT NOT REACHABLE YET. Both are kept
// because `05_Students.md` §Master List puts them in this store's shape and the
// spec's shape is the contract; neither has a writer the UI can reach. See the
// inline notes on `bulkSelectedIds` and `mergeTargetId` — shipping them needs a
// gateway bulk endpoint and a §8 amendment first, not a button.

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
  /**
   * 05_Students.md §Master List declares `bulkSelectedIds` / `toggleBulkSelect` /
   * `clearBulkSelection` in this store's shape, so they are kept — the spec's shape is
   * the contract. They are NOT yet reachable from the UI: the "N selected" indicator
   * they fed was deleted from `students-toolbar.tsx` because it could only ever read
   * zero (`toggleBulkSelect` had no caller) and no bulk action exists to back it. The
   * gateway exposes only single-student POST / PATCH / DELETE
   * (`apps/gateway/routes/students.ts:372, 453, 510`), so shipping selection means new
   * server mutations plus a §8 spec amendment first.
   */
  bulkSelectedIds: string[];
  /**
   * 05_Students.md §Master List also declares `mergeTargetId` here — the row a
   * duplicate match would be merged INTO. Like `bulkSelectedIds` it is kept
   * because the spec's shape is the contract, and like it, it has no writer: the
   * merge flow itself does not exist (the gateway exposes single-student
   * POST/PATCH/DELETE only), so exposing a field that can never change would be
   * a promise the code does not keep. Deliberately NOT removed — §0.2 deletes
   * code that maps to nothing, and this maps to a named spec line.
   */
  mergeTargetId: string | null;

  // Mutation sheets
  addSheetOpen: boolean;
  editSheetOpen: boolean;
  duplicateInterstitial: StudentDuplicateMatch | null;

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
  /**
   * 05_Students.md §Master List — move to a page. Only the LOWER bound is clamped
   * here, because the store does not know how many students match; the upper bound
   * needs the real `total` from the query and is clamped by `pageWindow`
   * (`components/students/students-pager.tsx`) and written back by the client.
   */
  setPage: (p: number) => void;
  /**
   * Rows per page. Changing it resets to page 1: keeping page 5 across a 100 → 25
   * resize would land the tutor on an empty screen with no explanation.
   */
  setPageSize: (n: number) => void;
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

/**
 * 05_Students.md §Master List — the dense default. Kept in one place because
 * `setPageSize` falls back to it, and a literal duplicated in two spots drifts.
 */
export const defaultPageSize = 50;

export const useStudentsStore = create<StudentsStoreState>((set) => ({
  filters: defaultFilters,
  searchQuery: '',
  savedFilters: [],
  page: 1,
  pageSize: defaultPageSize,
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
  
  setPage: (p) => set({ page: Math.max(1, Math.floor(p) || 1) }),
  setPageSize: (n) =>
    set({ pageSize: Math.max(1, Math.floor(n) || defaultPageSize), page: 1 }),
  setSort: (col, dir) => set({ sort: { col, dir } })
}));
