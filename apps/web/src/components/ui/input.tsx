// Implements: UI/03_Component_Library.md §3 Input Recipe
// Glass-native input: frosted inset surface + bioluminescent focus ring.
// Never uses plain bg-white or default browser styling.

import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Layout & sizing
        "min-h-[44px] w-full min-w-0 rounded-xl px-4 py-2.5 text-sm",
        // Glass-inset surface — clearly visible against cosmic canvas
        "bg-[var(--surface-inset)]",
        // Borders — strong enough to delineate the field
        "border border-[var(--border-strong)]",
        // Text
        "text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
        // Transitions
        "transition-[border-color,box-shadow] duration-200",
        // Focus ring — bioluminescent cyan glow
        "outline-none",
        "focus:border-[var(--info)]",
        "focus:shadow-[0_0_0_2px_color-mix(in srgb, var(--info) 0.2, transparent),inset_0_1px_2px_rgba(0,0,0,0.3)]",
        // Disabled
        "disabled:pointer-events-none disabled:opacity-40",
        // Invalid
        "aria-invalid:border-[var(--danger)] aria-invalid:focus:shadow-[0_0_0_2px_color-mix(in srgb, var(--danger) 0.2, transparent)]",
        className
      )}
      {...props}
    />
  );
}

export { Input };
