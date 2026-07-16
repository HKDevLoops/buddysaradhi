import * as React from "react";
import { cn } from "../lib/utils";

export interface NeumoToggleProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  glow?: "emerald" | "cyan" | "flare" | "amber" | "violet" | "none";
}

export const NeumoToggle = React.forwardRef<HTMLInputElement, NeumoToggleProps>(
  ({ className, glow = "emerald", ...props }, ref) => {
    
    const glowStyles = {
      none: "",
      emerald: "peer-checked:bg-[#00FF9D]/20 peer-checked:shadow-[0_0_10px_#00FF9D40]",
      cyan: "peer-checked:bg-[#00F0FF]/20 peer-checked:shadow-[0_0_10px_#00F0FF40]",
      flare: "peer-checked:bg-[#FF5E00]/20 peer-checked:shadow-[0_0_10px_#FF5E0040]",
      amber: "peer-checked:bg-[#FFB300]/20 peer-checked:shadow-[0_0_10px_#FFB30040]",
      violet: "peer-checked:bg-[#B388FF]/20 peer-checked:shadow-[0_0_10px_#B388FF40]",
    };

    return (
      <label className={cn("relative inline-flex items-center cursor-pointer", className)}>
        <input type="checkbox" className="sr-only peer" ref={ref} {...props} />
        <div className={cn(
          "w-11 h-6 rounded-full peer",
          "bg-white/5 border border-white/10 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.5),inset_-2px_-2px_5px_rgba(255,255,255,0.05)]",
          "peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-white/20",
          "after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white/80 after:border-white/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all",
          "peer-checked:after:translate-x-full peer-checked:after:border-white",
          glowStyles[glow]
        )}></div>
      </label>
    );
  }
);
NeumoToggle.displayName = "NeumoToggle";
