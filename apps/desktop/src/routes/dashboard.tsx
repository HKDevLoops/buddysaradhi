// Implements: docs/design/overhaul-plan.md §6 — Dashboard on tokens.
import { useEffect, useState } from "react";

import { Panel } from "../shell/Panel";
import { useThemeTokens } from "../theme/appearance-state";
import { getKpis } from "../lib/invoke";
import type { Kpis } from "../lib/invoke";

export function Dashboard() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useThemeTokens();

  useEffect(() => {
    getKpis()
      .then(setKpis)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const kpi = (title: string, value: string, tone: string) => (
    <Panel className="p-6" accent={tone === colors.success ? "success" : tone === colors.warning ? "warning" : "info"}>
      <h3 className="font-medium mb-2" style={{ color: colors.textSecondary }}>
        {title}
      </h3>
      <p className="text-3xl font-bold" style={{ color: colors.textPrimary }}>
        {value}
      </p>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: colors.textPrimary }}>
          Dashboard
        </h1>
      </div>

      {error ? (
        <Panel tier="strong" accent="danger" className="p-4" style={{ color: colors.danger }}>
          Error loading KPIs: {error}
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {kpi("Collected MTD", kpis ? `₹${(kpis.collected / 100).toLocaleString("en-IN")}` : "---", colors.success)}
        {kpi("Due Today", kpis ? `₹${(kpis.due_today / 100).toLocaleString("en-IN")}` : "---", colors.warning)}
        {kpi("Present Today", kpis ? `${kpis.present_pct}%` : "---", colors.info)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel className="lg:col-span-2 p-6 min-h-[300px]">
          <h3 className="text-lg font-bold mb-4" style={{ color: colors.textPrimary }}>
            Attendance
          </h3>
          <div className="w-full h-full rounded-lg bg-surface-inset border border-hairline" />
        </Panel>

        <Panel className="p-6 min-h-[300px]">
          <h3 className="text-lg font-bold mb-4" style={{ color: colors.textPrimary }}>
            Recent Activity
          </h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.success }} />
              <span className="text-sm" style={{ color: colors.textPrimary }}>
                Payment ₹4,500
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.info }} />
              <span className="text-sm" style={{ color: colors.textPrimary }}>
                Aarav marked present
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
