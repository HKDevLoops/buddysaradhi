import * as React from "react";
import { cn } from "../lib/utils";

export interface NeumoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "raised" | "inset" | "flat";
  glow?: "emerald" | "cyan" | "flare" | "amber" | "violet" | "none";
}

export const NeumoButton = React.forwardRef<HTMLButtonElement, NeumoButtonProps>(
  ({ className, variant = "raised", glow = "none", ...props }, ref) => {
    const variantStyles = {
      raised: "bg-white/5 border border-white/10 shadow-[4px_4px_10px_rgba(0,0,0,0.5),-4px_-4px_10px_rgba(255,255,255,0.05)] active:shadow-[inset_4px_4px_10px_rgba(0,0,0,0.5),inset_-4px_-4px_10px_rgba(255,255,255,0.05)]",
      inset: "bg-white/5 border border-white/5 shadow-[inset_4px_4px_10px_rgba(0,0,0,0.5),inset_-4px_-4px_10px_rgba(255,255,255,0.05)]",
      flat: "bg-transparent hover:bg-white/5 border border-transparent",
    };

    const glowStyles = {
      none: "",
      emerald: "hover:shadow-[0_0_15px_#00FF9D40] focus:shadow-[0_0_15px_#00FF9D80]",
      cyan: "hover:shadow-[0_0_15px_#00F0FF40] focus:shadow-[0_0_15px_#00F0FF80]",
      flare: "hover:shadow-[0_0_15px_#FF5E0040] focus:shadow-[0_0_15px_#FF5E0080]",
      amber: "hover:shadow-[0_0_15px_#FFB30040] focus:shadow-[0_0_15px_#FFB30080]",
      violet: "hover:shadow-[0_0_15px_#B388FF40] focus:shadow-[0_0_15px_#B388FF80]",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "px-4 py-2 rounded-lg font-medium transition-all duration-200 text-white",
          variantStyles[variant],
          glowStyles[glow],
          className
        )}
        {...props}
      />
    );
  }
);
NeumoButton.displayName = "NeumoButton";
