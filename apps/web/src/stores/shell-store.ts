import { create } from "zustand";

export type ScreenId = "/dashboard" | "/students" | "/attendance" | "/fees" | "/settings";

interface ShellState {
  activeScreen: ScreenId;
  setActiveScreen: (screen: ScreenId) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  activeScreen: "/dashboard",
  setActiveScreen: (screen) => set({ activeScreen: screen }),
}));
