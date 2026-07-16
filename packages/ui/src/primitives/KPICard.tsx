import * as React from "react";
import { cn } from "../lib/utils";
import { GlassPanel } from "./GlassPanel";

export interface KPICardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  trend?: {
    value: string | number;
    isPositive?: boolean;
    label?: string;
  };
  accent?: "emerald" | "cyan" | "flare" | "amber" | "violet" | "none";
  icon?: React.ReactNode;
}

export const KPICard = React.forwardRef<HTMLDivElement, KPICardProps>(
  ({ className, title, value, trend, accent = "none", icon, ...props }, ref) => {
    return (
      <GlassPanel
        ref={ref}
        tier="glass"
        accent={accent}
        className={cn("p-4 flex flex-col gap-2", className)}
        {...props}
      >
        <div className="flex justify-between items-start">
          <p className="text-sm font-medium text-white/60">{title}</p>
          {icon && <div className="text-white/40">{icon}</div>}
        </div>
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xl font-bold text-white tracking-tight">{value}</h3>
          {trend && (
            <div className={cn(
              "text-xs font-medium",
              trend.isPositive ? "text-[#00FF9D]" : "text-[#FF5E00]"
            )}>
              {trend.isPositive ? "+" : "-"}{trend.value}
              {trend.label && <span className="text-white/40 ml-1">{trend.label}</span>}
            </div>
          )}
        </div>
      </GlassPanel>
    );
  }
);
KPICard.displayName = "KPICard";
