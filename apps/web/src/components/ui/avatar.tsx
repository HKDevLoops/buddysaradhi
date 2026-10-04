// Implements: AGENTS.md §2 Rule 5 (colour comes from the generated palette or it
// does not ship) + Rule 10 (colour is never the only signal; 44x44 targets live
// on the control that wraps this, never on the avatar itself);
// apps/web/DESIGN.md §2 Anti-Slop #4 (typography: initials are a name, not data,
// so they take the body face — never JetBrains Mono as a costume);
// docs/design/material-modes.md §2 (Layer A is opaque and mode-invariant, so an
// avatar never carries a `backdrop-filter` and never changes when the material
// mode changes).
//
// ── The module ────────────────────────────────────────────────────────────────
// ONE avatar implementation for the whole app. There were five inline copies
// (student roster row, student drawer header, attendance grid row, the shell's
// hardcoded "RS", and a gradient monogram), each with its own size ladder, its own
// border weight, and its own colour derivation. A tutor moving between the roster
// and the drawer saw the same person rendered two different ways.
//
// ── Interface (a caller learns this once) ─────────────────────────────────────
//   <Avatar name="Riya Sharma" id={student.id} size="md" />
//   avatarInitials(name)      → "RS"          (deterministic, code-point safe)
//   avatarAccent(id)          → "success"     (custom-property NAME)
//
// ── Invariants callers must not re-implement ─────────────────────────────────
//   1. Colour is derived ONLY from `id`, never from `name`. Renaming a student
//      must not repaint them; two students with the same name must not collide.
//   2. `avatarAccent` returns the custom-property NAME, not the `var()` string.
//      Only this module turns a token name into a colour reference, so a token
//      rename lands here once. Legacy call sites that build `var(--${accent})`
//      keep working, which is why the re-export exists.
//   3. Initials are taken over CODE POINTS, not UTF-16 units, so a Devanagari or
//      CJK initial is not sliced into a lone surrogate half.
//   4. The avatar is DECORATIVE by default (`aria-hidden`): the name is always
//      adjacent text. Pass `label` only when the avatar is the sole carrier of
//      the identity, and then it renders `role="img"` with that label.
//   5. This module never renders an interactive element. A control wraps it —
//      so there is no `role="button"` div pretending to be a menu trigger, and no
//      nested-interactive axe violation (Rule 10).
//
// ── Deletion test (codebase-design) ───────────────────────────────────────────
// Delete this file and the complexity does NOT vanish: it reappears as five
// inline copies — the `h * 31` hash, the two-initials-vs-first-two-characters
// fork, the size ladder, the border weight, the accent alpha, and the
// `aria-hidden`-or-not decision. That reappearance is the evidence this module
// is deep rather than a pass-through: three props of interface buy a large
// behaviour, and the next token or sizing change lands once instead of five
// times. Locality: the fix is one file, not a grep across every screen.

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * The six accent ROLES an avatar may take. These are semantic roles from the
 * generated palette (`packages/design-system/tokens.css`), never literals —
 * Rule 5. Every one of them is a text/role contrast pair that CI verifies, so an
 * avatar can never introduce an unsolved colour.
 */
const ACCENT_ROLES = [
  "success",
  "info",
  "warning",
  "danger",
  "accent-primary",
  "accent-text",
] as const;

export type AvatarAccentRole = (typeof ACCENT_ROLES)[number];

export type AvatarSize = "sm" | "md" | "lg";

/**
 * One size ladder, declared once. `ring` scales with the box so the border reads
 * as the same craft at every size instead of being re-typed per call site.
 */
const SIZE_SCALE: Record<
  AvatarSize,
  { box: string; text: string; ring: `${number}px`; fontWeight: number }
> = {
  sm: { box: "w-8 h-8", text: "text-[11px]", ring: "1px", fontWeight: 600 },
  md: { box: "w-10 h-10", text: "text-sm", ring: "1px", fontWeight: 600 },
  lg: { box: "w-16 h-16", text: "text-xl", ring: "2px", fontWeight: 600 },
};

/** Background alpha of the accent tint. One value, so every avatar matches. */
const ACCENT_SURFACE_ALPHA = "16%";
/** Border alpha. Deliberately higher than the fill so the ring is visible in
 *  both light and dark palettes without becoming the only visual weight. */
const ACCENT_RING_ALPHA = "40%";

/**
 * Deterministic accent role for a stable identity.
 *
 * Hashes over code points with a 32-bit rolling mix, then folds into
 * `ACCENT_ROLES.length`. Returns the custom-property NAME (`"success"`, not
 * `"var(--success)"`) — see invariant 2.
 */
export function avatarAccent(id: string): AvatarAccentRole {
  let hash = 0;
  for (const codePoint of id) {
    hash = (Math.imul(hash, 31) + (codePoint.codePointAt(0) ?? 0)) >>> 0;
  }
  return ACCENT_ROLES[hash % ACCENT_ROLES.length] ?? "accent-primary";
}

/**
 * First and last initials, the way a person writes them on a receipt.
 *
 * `Riya Sharma` → `RS` · `Riya` → `RI` · `  ` → `?` · `Riya Kumari Sharma` → `RS`.
 * Code-point safe (invariant 3) and never returns an empty string, so the avatar
 * is never a bare coloured disc that a screen reader cannot describe.
 */
export function avatarInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  const firstWord = words[0] ?? "";
  const firstLetters = Array.from(firstWord);
  if (words.length === 1) {
    return firstLetters.slice(0, 2).join("").toUpperCase();
  }
  const lastWord = words[words.length - 1] ?? "";
  const lastLetter = Array.from(lastWord)[0] ?? "";
  return `${firstLetters[0] ?? ""}${lastLetter}`.toUpperCase();
}

export interface AvatarProps {
  /** Full name. Only its initials are rendered — never the whole string. */
  name: string;
  /**
   * Stable identity (a student UUID, a tenant id). This — not `name` — picks the
   * accent, so a rename never repaints a person (invariant 1).
   */
  id: string;
  /** Defaults to `md` — the roster density. */
  size?: AvatarSize;
  /**
   * Accessible name, required only when the avatar is the sole carrier of the
   * identity. When omitted the avatar is `aria-hidden`, because the full name is
   * always rendered beside it (invariant 4).
   */
  label?: string;
  className?: string;
}

/**
 * A person's mark in the roster, the drawer, and any future surface that needs to
 * show a human at a glance. Deterministic, token-coloured, and never interactive.
 */
export function Avatar({
  name,
  id,
  size = "md",
  label,
  className,
}: AvatarProps) {
  const scale = SIZE_SCALE[size];
  const accent = avatarAccent(id);
  const style: CSSProperties = {
    background: `color-mix(in srgb, var(--${accent}) ${ACCENT_SURFACE_ALPHA}, var(--surface-raised))`,
    color: `var(--${accent})`,
    border: `${scale.ring} solid color-mix(in srgb, var(--${accent}) ${ACCENT_RING_ALPHA}, transparent)`,
    fontWeight: scale.fontWeight,
  };

  return (
    <span
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 select-none",
        scale.box,
        scale.text,
        className,
      )}
      style={style}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {avatarInitials(name)}
    </span>
  );
}