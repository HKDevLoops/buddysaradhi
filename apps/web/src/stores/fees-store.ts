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
