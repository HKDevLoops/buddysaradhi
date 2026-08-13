// @ts-nocheck
import React from 'react';

export function Poster() {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      <div className="relative flex items-center justify-center w-full h-full">
        {/* Glows */}
        <div className="absolute w-[400px] h-[400px] bg-[#00FF9D]/10 blur-[100px] rounded-full translate-x-32 -translate-y-16" />
        <div className="absolute w-[300px] h-[300px] bg-[#00F0FF]/10 blur-[80px] rounded-full -translate-x-32 translate-y-16" />
        
        {/* Card Fallback */}
        <div className="w-[300px] p-8 text-center rounded-2xl border border-[var(--border-glass)] shadow-[0_20px_40px_rgba(0,0,0,0.4)]" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(24px)' }}>
          <div className="text-xl font-bold tracking-tight text-white/95 font-[family-name:var(--font-heading)]">
            ₹0 owed &middot; 0 students
          </div>
          <div className="text-sm font-medium text-white/70 mt-1 font-[family-name:var(--font-heading)]">
            1 ledger &middot; 5 screens
          </div>
        </div>
      </div>
    </div>
  );
}

