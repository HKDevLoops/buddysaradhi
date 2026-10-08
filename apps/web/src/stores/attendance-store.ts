// Implements: 06_Attendance.md §Mark — the daily register is addressed by a DATE
// and a BATCH, and "the day I was last looking at" is part of what the tutor is
// doing, not part of the route. AGENTS.md §2 Rule 4 (a persisted day is not a
// sixth screen) and §2 Rule 9 (the register the tutor is about to mark must be
// the register they asked for, not a default one).
//
// THE CONTRACT
// ────────────
// OWNS: which day and which batch the register is showing, the roster's search
//   box, and the two transient sheet flags. Nothing else — no marks, no totals,
//   no session. Those are the query cache's.
// RETURNS: an ISO date string, a batch id or `'all'`, a search string, and two
//   booleans. Primitives only, so a no-selector `useAttendanceStore()` returns
//   the state object itself and stays referentially stable between writes.
// ON UNMOUNT: nothing. No listener, no timer, no observer.
// DELIBERATELY DOES NOT: persist the sheet flags (a lock sheet that reappeared
//   on the next visit would be a dialog nobody opened), nor a marks array, nor
//   the batch list.
//
// WHY `skipHydration` AND A `rehydrate()` EFFECT. `selectedDateIso` and
// `selectedBatch` are persisted tutor state. zustand restores a persisted slice
// SYNCHRONOUSLY at module evaluation — before React hydrates — while the server
// rendered the constructor value. For any tutor who has been here before that is
// a structural hydration mismatch on `/attendance`, which AGENTS §16 makes a
// release blocker. With `skipHydration` the server's value is also the first
// client render's value; `AttendanceClient` calls `persist.rehydrate()` in an
// effect, which is honest about WHEN the stored day becomes known.
//
// THE ONE THING THAT IS EVALUATED ONCE AND CANNOT SELF-HEAL: the default
// `selectedDateIso` is `new Date().toISOString().slice(0, 10)`, computed when
// this module is first evaluated. In the browser that is fine (a reload
// re-evaluates it). On the server it is the date the PROCESS started, which is
// why no screen may read the store during a server render — the route file for
// `/attendance` says the same thing about not prefetching a day the server
// cannot know. Two honest consequences: a long-lived server never advances it,
// and a render that straddles UTC midnight can disagree with its own hydration
// render. Both are contained by the rule above. Do not "fix" this by reading the
// clock inside a selector — a selector that returns a different value on two
// consecutive reads for the same state is the infinite-render loop.

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
      // SSR: see the identical note in settings-store.ts. Without this the
      // persisted slice restores synchronously on the client while the server
      // rendered the constructor value — a hydration mismatch on every load for
      // any tutor who has been here before. AttendanceClient re-hydrates in an
      // effect.
      skipHydration: true,
      partialize: (state) => ({
        selectedDateIso: state.selectedDateIso,
        selectedBatch: state.selectedBatch,
        searchQuery: state.searchQuery,
      }),
      version: 1,
    }
  )
);
