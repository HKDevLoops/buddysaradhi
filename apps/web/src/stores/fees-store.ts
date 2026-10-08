// Implements: 07_Fees_and_Payments.md §6.5 (the fee sheets are opened for ONE
// named student) and 02_Core_Logic.md §5 (the five screens are one route, so a
// screen switch is a state change that can happen WHILE a sheet is open) and
// AGENTS.md §2 Rule 9 (a state that is invisible is a lie — a sheet that stays
// open across a screen change is a form whose subject just changed underneath
// the tutor's typing).
//
// Deletion test: delete this file and the two "is a sheet open" booleans, the
// description an extra-fee category contributes, and the "close them on a
// screen change" rule reappear in `fees-client`, `record-payment-button`, the
// extras catalog, `ledger-table` and the shell — five call sites that must all
// agree, and which already did not (the payment sheet stayed open across a
// screen change and re-opened over a different student). That agreement is the
// complexity, concentrated.
//
// THE CONTRACT
// ────────────
// OWNS: the Fees screen's own view state — overview/ledger mode, the roster
//   search string, which student the screen is scoped to, and the two sheet
//   flags with the description an extra-fee category seeds. NOT the money: no
//   amount, no invoice, no receipt, no balance lives here.
// RETURNS: primitives plus one nullable string. `closeFeeSheets()` is also
//   exported as a MODULE function so the shell can close the sheets without
//   subscribing to a store it does not render — a hook there would make the
//   screen change depend on the Fees screen re-rendering.
// ON UNMOUNT: nothing. No listener, no timer, no observer. The sheet flags are
//   explicitly NOT cleared on unmount — `closeFeeSheets()` is the deliberate
//   one-way reset for a screen change, and it is called from the chrome.
// DELIBERATELY DOES NOT: persist the sheet flags or the selected student. A
//   payment sheet restored on the next visit would be a form over a student the
//   tutor is no longer looking at. `partialize` therefore persists only `mode`
//   and `searchQuery` — the two that are pure conveniences and are safe to
//   restore into the tutor's own session.
//
// WHY THERE IS NO `skipHydration` HERE, WHEN `settings-store` AND
// `attendance-store` BOTH HAVE IT. Measured, not assumed: `/fees` IS server
// rendered, and zustand restores a persisted slice synchronously, so a mismatch
// was possible — but only if a PERSISTED field were also a RENDERED one.
// `mode` and `searchQuery` have no reader anywhere in the app (the Fees screen
// destructures `selectedStudentId` only; `dashboard-client.tsx` records the same
// finding). The rendered fields — the sheet flags, the seed and the selected
// student — are excluded from `partialize` by construction, so the server value
// and the first client value are the same object and there is nothing to match.
// Adding `skipHydration` here would be the wrong fix: with no `rehydrate()` call
// in `fees-client.tsx` it would silently stop restoring `mode` altogether.
// MEASURE IT AGAIN THE MOMENT `mode` GAINS A READER.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface FeesState {
  mode: 'overview' | 'ledger';
  searchQuery: string;
  selectedStudentId: string | null;
  isPaymentSheetOpen: boolean;
  isInvoiceSheetOpen: boolean;
  /**
   * The extra-fee category a Charge button carried, carried as the invoice's
   * opening description. It is a SEED, not the value: the invoice sheet reads it
   * once when it opens and the tutor owns the field from then on. `null` means
   * "no category chosen", which is the only honest default for a sheet opened
   * from anywhere but the extras catalog.
   */
  invoiceDescriptionSeed: string | null;
  setMode: (mode: 'overview' | 'ledger') => void;
  setSearchQuery: (query: string) => void;
  setSelectedStudentId: (id: string | null) => void;
  setPaymentSheetOpen: (open: boolean) => void;
  setInvoiceSheetOpen: (open: boolean) => void;
  setInvoiceDescriptionSeed: (description: string | null) => void;
  /**
   * Close every fee sheet. Called by the ONE place that changes screen: a sheet
   * left open across a screen change unmounts under the tutor's hands, and the
   * drawer re-mounts it over a different student with a stale subject. The flags
   * are session state, not navigation state — they must not outlive the screen
   * that mounted them.
   */
  closeFeeSheets: () => void;
}

const SHEET_CLOSED = {
  isPaymentSheetOpen: false,
  isInvoiceSheetOpen: false,
  invoiceDescriptionSeed: null,
} as const;

export const useFeesStore = create<FeesState>()(
  persist(
    (set) => ({
  mode: 'overview',
  searchQuery: '',
  selectedStudentId: null,
  isPaymentSheetOpen: false,
  isInvoiceSheetOpen: false,
  invoiceDescriptionSeed: null,
  setMode: (mode) => set({ mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedStudentId: (id) => set({ selectedStudentId: id }),
  setPaymentSheetOpen: (open) => set({ isPaymentSheetOpen: open }),
  setInvoiceSheetOpen: (open) => set({ isInvoiceSheetOpen: open }),
  setInvoiceDescriptionSeed: (description) => set({ invoiceDescriptionSeed: description }),
  closeFeeSheets: () => set({ ...SHEET_CLOSED }),
    }),
    {
      name: 'buddysaradhi.fees.v1',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        mode: state.mode,
        searchQuery: state.searchQuery,
      }),
      version: 1,
    }
  )
);

/**
 * Close the fee sheets from OUTSIDE React — the shell's screen switch has no
 * business subscribing to a store it does not render. A module function rather
 * than a hook on purpose: the shell is the caller, and a hook would make the
 * screen change depend on the Fees screen's re-render.
 */
export function closeFeeSheets(): void {
  useFeesStore.getState().closeFeeSheets();
}
