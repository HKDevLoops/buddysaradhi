import * as React from "react";
import { cn } from "../lib/utils";

export interface ChipProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "solid" | "outline" | "glass";
  color?: "emerald" | "cyan" | "flare" | "amber" | "violet" | "neutral";
}

export const Chip = React.forwardRef<HTMLDivElement, ChipProps>(
  ({ className, variant = "glass", color = "neutral", children, ...props }, ref) => {
    
    const colorStyles = {
      solid: {
        emerald: "bg-[#00FF9D]/20 text-[#00FF9D]",
        cyan: "bg-[#00F0FF]/20 text-[#00F0FF]",
        flare: "bg-[#FF5E00]/20 text-[#FF5E00]",
        amber: "bg-[#FFB300]/20 text-[#FFB300]",
        violet: "bg-[#B388FF]/20 text-[#B388FF]",
        neutral: "bg-white/10 text-white",
      },
      outline: {
        emerald: "border border-[#00FF9D]/50 text-[#00FF9D]",
        cyan: "border border-[#00F0FF]/50 text-[#00F0FF]",
        flare: "border border-[#FF5E00]/50 text-[#FF5E00]",
        amber: "border border-[#FFB300]/50 text-[#FFB300]",
        violet: "border border-[#B388FF]/50 text-[#B388FF]",
        neutral: "border border-white/20 text-white",
      },
      glass: {
        emerald: "bg-[#00FF9D]/10 backdrop-blur-md border border-[#00FF9D]/20 text-[#00FF9D]",
        cyan: "bg-[#00F0FF]/10 backdrop-blur-md border border-[#00F0FF]/20 text-[#00F0FF]",
        flare: "bg-[#FF5E00]/10 backdrop-blur-md border border-[#FF5E00]/20 text-[#FF5E00]",
        amber: "bg-[#FFB300]/10 backdrop-blur-md border border-[#FFB300]/20 text-[#FFB300]",
        violet: "bg-[#B388FF]/10 backdrop-blur-md border border-[#B388FF]/20 text-[#B388FF]",
        neutral: "bg-white/5 backdrop-blur-md border border-white/10 text-white",
      }
    };

    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors",
          colorStyles[variant][color],
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Chip.displayName = "Chip";
