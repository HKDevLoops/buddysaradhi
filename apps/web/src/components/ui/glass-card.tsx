// Implements: UI/03_Component_Library.md §2 Glass Card Recipe
// The fundamental surface. Every card in the app is a variant of this base.
// Glass + neumorphism, never either/or.
//
// AGENTS.md §2 Rule 5 + docs/design/material-modes.md §2: the blur is NOT a
// literal here. The three variants used to hand-write `blur(48px) saturate(150%)`,
// `blur(20px)` and `blur(36px) saturate(130%)`, which meant the material-mode
// control changed the shell but left every card frozen at whatever the author
// typed. All three now read `var(--mat-filter)`, so `minimal` resolves to `none`
// and the mode switch is real. Note `minimal`'s Layer-A surfaces are opaque by
// design (material-modes.md §2.0), so `default` and `faint` stay legible there.

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * The ONE material primitive. Declared once so no variant can reintroduce a
 * literal blur, and so `-webkit-` and standard stay in lockstep.
 */
const MATERIAL: { backdropFilter: string; WebkitBackdropFilter: string } = {
  backdropFilter: "var(--mat-filter)",
  WebkitBackdropFilter: "var(--mat-filter)",
};

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  /** 'default' = base glass; 'strong' = more opaque for modals; 'faint' = nested cards */
  variant?: "default" | "strong" | "faint";
  /** Adds translateY(-2px) hover lift — use on interactive surfaces only */
  interactive?: boolean;
  /** Adds a 1px gradient accent edge (for active/selected state) */
  accentEdge?: boolean;
}

/**
 * GlassCard — the fundamental surface primitive.
 *
 * Usage:
 *   <GlassCard>content</GlassCard>
 *   <GlassCard variant="strong">modal content</GlassCard>
 *   <GlassCard interactive accentEdge>tappable card</GlassCard>
 */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = "default", interactive, accentEdge, style, ...props }, ref) => {
    const glassStyles: Record<string, string> = {
      default: [
        "rounded-2xl p-6 relative overflow-hidden",
        "transition-[transform,box-shadow] duration-250",
      ].join(" "),
      strong: [
        "rounded-2xl p-6 relative overflow-hidden",
        "transition-[transform,box-shadow] duration-250",
      ].join(" "),
      faint: [
        "rounded-xl p-4 relative overflow-hidden",
        "transition-[transform,box-shadow] duration-250",
      ].join(" "),
    };

    const cssVars =
      variant === "strong"
        ? {
            background: "var(--surface-overlay)",
            ...MATERIAL,
            border: "1px solid var(--border-strong)",
            boxShadow: [
              "0 1px 1px 0 rgba(255,255,255,0.20) inset",
              "0 0 24px 0 rgba(255,255,255,0.05) inset",
              "-2px -2px 12px 0 rgba(255,255,255,0.06)",
              "0 16px 48px 0 rgba(0,0,0,0.25)",
              "0 4px 16px 0 rgba(0,0,0,0.15)",
            ].join(", "),
          }
        : variant === "faint"
          ? {
              background: "var(--surface-inset)",
              ...MATERIAL,
              border: "1px solid var(--border-default)",
              boxShadow: [
                "0 1px 1px 0 rgba(255,255,255,0.10) inset",
                "0 6px 20px 0 rgba(0,0,0,0.12)",
              ].join(", "),
            }
          : {
              background: "var(--surface-raised)",
              ...MATERIAL,
              border: "1px solid var(--border-default)",
              boxShadow: [
                "0 1px 1px 0 rgba(255,255,255,0.16) inset",
                "0 0 20px 0 rgba(255,255,255,0.03) inset",
                "-2px -2px 10px 0 rgba(255,255,255,0.05)",
                "0 10px 40px 0 rgba(0,0,0,0.20)",
                "0 2px 8px 0 rgba(0,0,0,0.12)",
              ].join(", "),
            };

    return (
      <div
        ref={ref}
        className={cn(
          glassStyles[variant],
          interactive && "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_16px_48px_0_rgba(0,0,0,0.28),0_4px_16px_0_rgba(0,0,0,0.18)] focus-visible:-translate-y-0.5 focus-visible:shadow-[0_16px_48px_0_rgba(0,0,0,0.28),0_4px_16px_0_rgba(0,0,0,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
          accentEdge && "glass-card-accent-edge",
          className
        )}
        style={{ ...cssVars, ...style }}
        {...props}
      />
    );
  }
);
GlassCard.displayName = "GlassCard";

// ── Accent edge CSS is defined in globals.css ─────────────────────────────────
// .glass-card-accent-edge::before {
//   content: '';
//   position: absolute; inset: 0;
//   border-radius: inherit;
//   padding: 1px;
//   background: linear-gradient(135deg, var(--info), var(--success));
//   -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
//   -webkit-mask-composite: xor;
//   mask-composite: exclude;
//   pointer-events: none;
// }
