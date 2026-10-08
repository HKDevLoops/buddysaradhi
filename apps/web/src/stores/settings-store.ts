// Implements: 08_Settings.md §6.2 — which of the thirteen sections is on show,
// and §8.3's `dirtySections` set that the react-hook-form Profile card writes to
// (`formState.isDirty` drives it, per the spec). AGENTS.md §2 Rule 4 — thirteen
// sections inside ONE screen, not thirteen screens; the active section is view
// state on the `/settings` route, not a URL and not a sixth screen.
//
// THE CONTRACT
// ────────────
// OWNS: `activeSection` (persisted), which sections have unsaved edits, and the
//   two-step discard confirmation for leaving a dirty section.
// RETURNS: an id from `SettingsSectionId`, a `Set` of the same ids, a nullable
//   pending destination, and `hasUnsavedChanges()` as a FUNCTION — not a
//   boolean. That is deliberate: `useSettingsStore(s => s.hasUnsavedChanges)`
//   returns the same function reference on every render and therefore never
//   re-renders a component; `useSettingsStore(s => s.hasUnsavedChanges())`
//   returns a boolean and is equally stable. Returning the boolean directly
//   would have been fine, but a consumer writing the first form would have got
//   an always-truthy object and no re-render on save.
// ON UNMOUNT: nothing. No listener, no timer, no observer. The dirty set
//   deliberately SURVIVES a screen change: it is the thing that must still be
//   true when the tutor comes back, and it is cleared only by `markClean`,
//   `confirmDiscard`, or the Profile card's own successful save.
// DELIBERATELY DOES NOT: persist the dirty set or the pending navigation.
//   `partialize` carries `activeSection` alone. A stale "you have unsaved
//   changes" banner on the next load, over a form whose contents were never
//   persisted, is a claim the app cannot back up.
//
// `Set` AND WHY IT IS COPIED ON EVERY WRITE. `markDirty`/`markClean` build a new
// `Set` instead of mutating in place. That is required, not stylistic: the store
// object is shallow-compared by zustand, and a `Set` mutated in place keeps its
// identity, so every subscriber would believe nothing changed and the "Unsaved"
// marker would never appear. It is also the difference between a store that is
// safe to snapshot and one that mutates shared state under a reader.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type SettingsSectionId =
  | 'profile' | 'appearance' | 'attendance-rules' | 'fee-rules'
  | 'notifications' | 'security' | 'database' | 'backup-restore' | 'import-export'
  | 'data-privacy' | 'about' | 'help' | 'diagnostics';

interface SettingsState {
  activeSection: SettingsSectionId;
  setActiveSection: (id: SettingsSectionId) => void;

  dirtySections: Set<SettingsSectionId>;
  markDirty: (id: SettingsSectionId) => void;
  markClean: (id: SettingsSectionId) => void;
  hasUnsavedChanges: () => boolean;

  pendingNav: SettingsSectionId | null;
  setPendingNav: (id: SettingsSectionId | null) => void;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
  activeSection: 'profile',
  setActiveSection: (id) => set({ activeSection: id }),

  dirtySections: new Set(),
  markDirty: (id) => set((state) => {
    const newSet = new Set(state.dirtySections);
    newSet.add(id);
    return { dirtySections: newSet };
  }),
  markClean: (id) => set((state) => {
    const newSet = new Set(state.dirtySections);
    newSet.delete(id);
    return { dirtySections: newSet };
  }),
  hasUnsavedChanges: () => get().dirtySections.size > 0,

  pendingNav: null,
  setPendingNav: (id) => set({ pendingNav: id }),
  confirmDiscard: () => set((state) => {
    if (state.pendingNav) {
      return { 
        activeSection: state.pendingNav, 
        pendingNav: null, 
        dirtySections: new Set() 
      };
    }
    return { pendingNav: null, dirtySections: new Set() };
  }),
  cancelDiscard: () => set({ pendingNav: null }),
    }),
    {
      name: 'buddysaradhi.settings.v1',
      storage: createJSONStorage(() => sessionStorage),
      // SSR: the server has no sessionStorage, so the store can only hydrate on
      // the client. Without this, zustand restores the persisted slice
      // SYNCHRONOUSLY before first paint, and the server markup (built from the
      // constructor value) disagrees with the client's first render for every
      // returning tutor — a structural hydration mismatch on every load, which
      // AGENTS.md §16 makes a release blocker. The client re-hydrates in an
      // effect instead (see SettingsClient), which is honest about when the
      // value becomes known.
      skipHydration: true,
      partialize: (state) => ({ activeSection: state.activeSection }),
      version: 1,
    }
  )
);
