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
