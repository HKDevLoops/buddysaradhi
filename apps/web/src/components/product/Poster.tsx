import React from "react";
import { formatINR } from "@/lib/utils";
import { useHeroKPI } from "./hooks/useHeroKPI";

export function Poster() {
  const kpi = useHeroKPI();

  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center">
      <div className="w-[320px] p-6 rounded-2xl glass-strong border-[var(--border-glass-strong)] flex flex-col items-center justify-center text-center">
        <p className="text-[var(--text-primary)] font-medium text-lg leading-relaxed">
          {formatINR(kpi.owed * 100)} owed &middot; {kpi.students} students
        </p>
        <p className="text-[var(--text-primary)] font-medium text-lg leading-relaxed mt-2">
          {kpi.ledgers} ledger &middot; 5 screens
        </p>
      </div>
    </div>
  );
}
