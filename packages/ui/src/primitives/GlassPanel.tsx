import * as React from "react";
import { cn } from "../lib/utils";

export type GlassTier = "glass" | "glass-strong" | "glass-faint";

export interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  tier?: GlassTier;
  accent?: "emerald" | "cyan" | "flare" | "amber" | "violet" | "none";
}

export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ className, tier = "glass", accent = "none", ...props }, ref) => {
    
    const tierStyles = {
      "glass-strong": "bg-white/8 backdrop-blur-2xl ring-1 ring-white/10",
      "glass": "bg-white/5 backdrop-blur-xl ring-1 ring-white/10",
      "glass-faint": "bg-white/2 backdrop-blur-lg ring-1 ring-white/5",
    };

    const accentStyles = {
      "none": "",
      "emerald": "border-l-2 border-[#00FF9D]",
      "cyan": "border-l-2 border-[#00F0FF]",
      "flare": "border-l-2 border-[#FF5E00]",
      "amber": "border-l-2 border-[#FFB300]",
      "violet": "border-l-2 border-[#B388FF]",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl shadow-glass transition-all duration-300",
          tierStyles[tier],
          accentStyles[accent],
          className
        )}
        {...props}
      />
    );
  }
);
GlassPanel.displayName = "GlassPanel";
