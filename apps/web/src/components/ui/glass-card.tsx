// Implements: UI/03_Component_Library.md §2 Glass Card Recipe
// The fundamental surface. Every card in the app is a variant of this base.
// Glass + neumorphism, never either/or.

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

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
            background: "var(--surface-glass-strong)",
            backdropFilter: "blur(48px) saturate(150%)",
            WebkitBackdropFilter: "blur(48px) saturate(150%)",
            border: "1px solid var(--border-glass-strong)",
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
              background: "var(--surface-glass-faint)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid var(--border-glass)",
              boxShadow: [
                "0 1px 1px 0 rgba(255,255,255,0.10) inset",
                "0 6px 20px 0 rgba(0,0,0,0.12)",
              ].join(", "),
            }
          : {
              background: "var(--surface-glass)",
              backdropFilter: "blur(36px) saturate(130%)",
              WebkitBackdropFilter: "blur(36px) saturate(130%)",
              border: "1px solid var(--border-glass)",
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
          interactive && "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_16px_48px_0_rgba(0,0,0,0.28),0_4px_16px_0_rgba(0,0,0,0.18)]",
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
//   background: linear-gradient(135deg, var(--accent-cyan), var(--accent-emerald));
//   -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
//   -webkit-mask-composite: xor;
//   mask-composite: exclude;
//   pointer-events: none;
// }
