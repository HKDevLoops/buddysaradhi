import * as React from "react";
import { cn } from "../lib/utils";

export interface BarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: { label: string; value: number }[];
  accent?: "emerald" | "cyan" | "flare" | "amber" | "violet";
  maxValue?: number;
}

export const BarChart = React.forwardRef<HTMLDivElement, BarChartProps>(
  ({ className, data, accent = "cyan", maxValue: maxProp, ...props }, ref) => {
    
    const maxValue = maxProp || Math.max(...data.map(d => d.value), 1);

    const accentStyles = {
      emerald: "bg-[#00FF9D]",
      cyan: "bg-[#00F0FF]",
      flare: "bg-[#FF5E00]",
      amber: "bg-[#FFB300]",
      violet: "bg-[#B388FF]",
    };

    return (
      <div ref={ref} className={cn("flex flex-col gap-3", className)} {...props}>
        {data.map((item, index) => {
          const percentage = Math.max(0, Math.min(100, (item.value / maxValue) * 100));
          return (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex justify-between text-xs text-white/60">
                <span>{item.label}</span>
                <span className="font-medium text-white/90">{item.value}</span>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div 
                  className={cn("h-full rounded-full transition-all duration-500", accentStyles[accent])}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);
BarChart.displayName = "BarChart";
