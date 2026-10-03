// Implements: docs/design/overhaul-plan.md §6 — desktop control primitive.
//
// Replaces `@buddysaradhi/ui`'s `NeumoButton` for the desktop shell, for the same
// reason as Panel.tsx: that package's variant/glow classes are hand-typed rgba
// and hex values, and packages/** is outside this wave's scope.
//
// The neumorphic press is kept (AGENTS.md "tactile" is a cross-platform rule), but
// its colours are the elevation/shadow tokens rather than literal white/black:
// `raised` = the surface token plus the elevation shadow, `inset` = the same
// shadow drawn inside, `flat` = no surface at all.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "raised" | "inset" | "flat";
  accent?: "none" | "success" | "info" | "warning" | "danger";
  children?: ReactNode;
}

const VARIANT: Record<NonNullable<ButtonProps["variant"]>, string> = {
  raised: "bg-surface-raised border-hairline shadow-overlay hover:bg-surface-row",
  inset: "bg-surface-inset border-hairline",
  flat: "bg-transparent border-transparent hover:bg-surface-row",
};

const ACCENT: Record<NonNullable<ButtonProps["accent"]>, string> = {
  none: "text-fg-primary",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  danger: "text-danger",
};

export function Button({
  variant = "raised",
  accent = "none",
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`px-4 py-2 rounded-lg border font-medium transition-colors duration-200 min-h-[44px] ${VARIANT[variant]} ${ACCENT[accent]} ${className ?? ""}`}
      {...props}
    >
      {children}
    </button>
  );
}