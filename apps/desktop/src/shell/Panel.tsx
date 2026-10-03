// Implements: docs/design/overhaul-plan.md §6 — desktop surface primitive.
//
// This replaces `@buddysaradhi/ui`'s `GlassPanel` for the desktop shell. That
// package still paints `bg-white/5 ring-white/10` and named the retired glass
// tiers, and packages/** is outside this wave's scope, so the desktop shell takes
// its surface from the token contract instead.
//
// Tier -> structure role (material-modes.md §2.0): a panel is a STRUCTURE
// surface and stays opaque in every material mode. The material only ever appears
// on the floating roles, which is what `.mat-nav` / `.mat-sheet` are for.
import type { HTMLAttributes, ReactNode } from "react";

export type PanelTier = "faint" | "normal" | "strong";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tier?: PanelTier;
  accent?: "none" | "success" | "info" | "warning" | "danger";
  children?: ReactNode;
}

const TIER_SURFACE: Record<PanelTier, string> = {
  faint: "bg-surface-row",
  normal: "bg-surface-raised",
  strong: "bg-surface-raised",
};

const ACCENT_BORDER: Record<NonNullable<PanelProps["accent"]>, string> = {
  none: "",
  success: "border-l-2 border-l-success",
  info: "border-l-2 border-l-info",
  warning: "border-l-2 border-l-warning",
  danger: "border-l-2 border-l-danger",
};

export function Panel({
  tier = "normal",
  accent = "none",
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <div
      className={`rounded-xl border border-hairline ${TIER_SURFACE[tier]} ${ACCENT_BORDER[accent]} ${className ?? ""}`}
      {...props}
    >
      {children}
    </div>
  );
}