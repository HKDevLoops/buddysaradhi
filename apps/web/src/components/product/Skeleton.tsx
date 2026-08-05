import React from "react";
import { Skeleton as BoneyardSkeleton } from "boneyard-js/react";

export function Skeleton() {
  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center">
      <BoneyardSkeleton loading={true}>
        <div className="w-[320px] h-[160px] rounded-2xl bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] animate-pulse flex flex-col items-center justify-center p-6 space-y-3">
          <div className="h-5 w-48 bg-[var(--surface-glass-strong)] rounded-md" />
          <div className="h-5 w-40 bg-[var(--surface-glass-strong)] rounded-md" />
        </div>
      </BoneyardSkeleton>
    </div>
  );
}
