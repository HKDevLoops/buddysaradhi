import React from "react";
import { formatINR } from "@/lib/utils";
import { useHeroKPI } from "./hooks/useHeroKPI";

export function Poster() {
  const kpi = useHeroKPI();

  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center">
      <div className="w-[380px] p-6 rounded-2xl bg-[#0A0D1A]/80 backdrop-blur-xl border border-white/10 text-left shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-[var(--accent-emerald)] font-semibold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--accent-emerald)]" />
            Tuition OS &middot; Offline Sovereign
          </span>
          <span className="text-[10px] text-gray-400 font-mono bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
            5 Screens
          </span>
        </div>

        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">
            Built for Relentless Tutors
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Zero server friction. Instant billing &amp; roster management.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-[10px] text-gray-400 uppercase font-medium">Pending Dues</span>
            <p className="text-sm font-semibold text-[var(--accent-flare)] mt-0.5">
              {formatINR(kpi.owed)}
            </p>
          </div>
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="text-[10px] text-gray-400 uppercase font-medium">Active Roster</span>
            <p className="text-sm font-semibold text-[var(--accent-cyan)] mt-0.5">
              {kpi.students} Students
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-300 pt-1 border-t border-white/5">
          <span className="flex items-center gap-1 text-[var(--accent-emerald)]">
            ✓ 1-Click WhatsApp Receipts
          </span>
          <span className="text-[10px] text-gray-500 font-mono">
            Paise Precision
          </span>
        </div>
      </div>
    </div>
  );
}
