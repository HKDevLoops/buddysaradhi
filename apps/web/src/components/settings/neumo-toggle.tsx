"use client";

import { cn } from "@/lib/utils";

interface NeumoToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}

/**
 * Neumorphic toggle: an inset well (.toggle) with a raised knob.
 * The outer button is the 44px accessible hit target; the inner span is the visual.
 */
export function NeumoToggle({ checked, onChange, label, disabled }: NeumoToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 rounded-full transition-opacity cursor-pointer",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span aria-hidden="true" className={cn("toggle", checked && "toggle-on")} />
    </button>
  );
}
