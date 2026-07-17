import { create } from "zustand";
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

export const useDashboardStore = create<DashboardState>((set) => ({
  periodFilter: "this_month",
  heatmapMode: "attendance",
  activityFeedScrollY: 0,
  dueTodayExpanded: false,
  lastRefreshedAt: null,
  setPeriodFilter: (p) => set({ periodFilter: p }),
  setHeatmapMode: (m) => set({ heatmapMode: m }),
  markRefreshed: () => set({ lastRefreshedAt: new Date().toISOString() }),
}));
