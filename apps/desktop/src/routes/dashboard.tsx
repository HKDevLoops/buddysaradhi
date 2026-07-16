import { useState, useEffect } from "react";
import { GlassPanel } from "@buddysaradhi/ui";
import { getKpis } from "../lib/invoke";
import type { Kpis } from "../lib/invoke";

export function Dashboard() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getKpis()
      .then(setKpis)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      </div>

      {error && (
        <GlassPanel tier="glass-strong" accent="flare" className="p-4 text-[#FF5E00]">
          Error loading KPIs: {error}
        </GlassPanel>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <GlassPanel tier="glass" accent="emerald" className="p-6">
          <h3 className="text-white/70 font-medium mb-2">Collected MTD</h3>
          <p className="text-3xl font-bold">
            {kpis ? `₹${(kpis.collected / 100).toLocaleString("en-IN")}` : "---"}
          </p>
        </GlassPanel>

        <GlassPanel tier="glass" accent="amber" className="p-6">
          <h3 className="text-white/70 font-medium mb-2">Due Today</h3>
          <p className="text-3xl font-bold">
            {kpis ? `₹${(kpis.due_today / 100).toLocaleString("en-IN")}` : "---"}
          </p>
        </GlassPanel>

        <GlassPanel tier="glass" accent="cyan" className="p-6">
          <h3 className="text-white/70 font-medium mb-2">Present Today</h3>
          <p className="text-3xl font-bold">
            {kpis ? `${kpis.present_pct}%` : "---"}
          </p>
        </GlassPanel>
      </div>
      
      {/* Additional layout mocks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <GlassPanel tier="glass" className="lg:col-span-2 p-6 min-h-[300px]">
          <h3 className="text-lg font-bold mb-4">Activity Heatmap</h3>
          <div className="w-full h-full rounded-lg bg-white/5 border border-white/5" />
        </GlassPanel>
        
        <GlassPanel tier="glass" className="p-6 min-h-[300px]">
          <h3 className="text-lg font-bold mb-4">Recent Activity</h3>
          <div className="space-y-4">
             <div className="flex items-center gap-3">
               <div className="w-2 h-2 rounded-full bg-[#00FF9D] shadow-[0_0_8px_#00FF9D]" />
               <span className="text-sm">Payment ₹4,500</span>
             </div>
             <div className="flex items-center gap-3">
               <div className="w-2 h-2 rounded-full bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]" />
               <span className="text-sm">Aarav marked present</span>
             </div>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
