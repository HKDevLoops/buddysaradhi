import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PeriodFilter } from "@buddysaradhi/shared";

interface DashboardState {
  periodFilter: PeriodFilter;
  heatmapMode: "attendance" | "payment";
  activityFeedScrollY: number;
  dueTodayExpanded: boolean;
  lastRefreshedAt: string | null;
  setPeriodFilter: (p: PeriodFilter) => void;
  setHeatmapMode: (m: "attendance" | "payment") => void;
  markRefreshed: () => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
  periodFilter: "this_month",
  heatmapMode: "attendance",
  activityFeedScrollY: 0,
  dueTodayExpanded: false,
  lastRefreshedAt: null,
  setPeriodFilter: (p) => set({ periodFilter: p }),
  setHeatmapMode: (m) => set({ heatmapMode: m }),
  markRefreshed: () => set({ lastRefreshedAt: new Date().toISOString() }),
    }),
    {
      name: "buddysaradhi.dashboard.v1",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ periodFilter: state.periodFilter }),
      version: 1,
    }
  )
);
