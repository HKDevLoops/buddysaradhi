import * as React from "react";
import { cn } from "../lib/utils";

export interface HeatMapData {
  date: string;
  count: number;
}

export interface HeatMapProps extends React.HTMLAttributes<HTMLDivElement> {
  data: HeatMapData[];
  accent?: "emerald" | "cyan" | "flare" | "amber" | "violet";
  startDate?: Date;
  endDate?: Date;
}

export const HeatMap = React.forwardRef<HTMLDivElement, HeatMapProps>(
  ({ className, data, accent = "emerald", startDate = new Date(new Date().setMonth(new Date().getMonth() - 3)), endDate = new Date(), ...props }, ref) => {
    
    // Simplistic heatmap rendering
    // Generate dates between start and end
    const getDaysArray = (s: Date, e: Date) => {
      for(var a=[],d=new Date(s);d<=new Date(e);d.setDate(d.getDate()+1)){
        a.push(new Date(d));
      }
      return a;
    };
    
    const dates = getDaysArray(startDate, endDate);
    const maxCount = Math.max(...data.map(d => d.count), 1);

    const accentMap: Record<string, string[]> = {
      emerald: ["bg-white/5", "bg-[#00FF9D]/20", "bg-[#00FF9D]/50", "bg-[#00FF9D]/80", "bg-[#00FF9D]"],
      cyan: ["bg-white/5", "bg-[#00F0FF]/20", "bg-[#00F0FF]/50", "bg-[#00F0FF]/80", "bg-[#00F0FF]"],
      flare: ["bg-white/5", "bg-[#FF5E00]/20", "bg-[#FF5E00]/50", "bg-[#FF5E00]/80", "bg-[#FF5E00]"],
      amber: ["bg-white/5", "bg-[#FFB300]/20", "bg-[#FFB300]/50", "bg-[#FFB300]/80", "bg-[#FFB300]"],
      violet: ["bg-white/5", "bg-[#B388FF]/20", "bg-[#B388FF]/50", "bg-[#B388FF]/80", "bg-[#B388FF]"],
    };

    const colors = accentMap[accent];

    return (
      <div ref={ref} className={cn("flex flex-wrap gap-1", className)} {...props}>
        {dates.map((date, i) => {
          const dateStr = date.toISOString().split('T')[0];
          const entry = data.find(d => d.date === dateStr);
          const count = entry ? entry.count : 0;
          
          let colorIndex = 0;
          if (count > 0) {
            const ratio = count / maxCount;
            if (ratio <= 0.25) colorIndex = 1;
            else if (ratio <= 0.5) colorIndex = 2;
            else if (ratio <= 0.75) colorIndex = 3;
            else colorIndex = 4;
          }

          return (
            <div 
              key={i} 
              title={`${dateStr}: ${count}`}
              className={cn("w-3 h-3 rounded-sm transition-colors", colors[colorIndex])}
            />
          );
        })}
      </div>
    );
  }
);
HeatMap.displayName = "HeatMap";
