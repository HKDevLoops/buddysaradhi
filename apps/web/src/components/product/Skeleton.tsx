import React from "react";

export function Skeleton() {
  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center">
      <div className="w-[320px] h-[160px] rounded-2xl glass-faint animate-pulse" />
    </div>
  );
}
