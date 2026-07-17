import { create } from 'zustand';

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

export const useSettingsStore = create<SettingsState>((set, get) => ({
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
}));
