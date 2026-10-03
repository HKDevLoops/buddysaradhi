// Implements: docs/design/overhaul-plan.md §6 — the token-backed style surface
// NativeWind components consume.
//
// Every value here is a projection of the resolved theme: no literal colour, no
// hardcoded alpha, no per-component decision about which shade a row is. A
// component asks for a ROLE (`row`, `hairline`, `statusOverdue`) and the palette
// and material decide the value.
//
// Roles are grouped by the two layers in material-modes.md §2.0:
//   - structure (`canvas` … `sunken`, `fg*`, `border*`) is opaque in every mode
//   - material (`overlay`, `nav`, `sheet`, `palette`, `scrim`) is translucent in
//     acrylic / liquid-glass and already remapped to its `-solid` pair when the
//     user has asked for reduced transparency.
import { useMemo } from "react";
import type { ViewStyle, TextStyle } from "react-native";

import { useThemeTokens } from "./appearance";
import type { Theme, ThemeColors, ThemeMaterial } from "./tokens";

export interface ThemeStyles {
  /** Semantic status colours for a fee/attendance state. */
  readonly status: Readonly<Record<StatusRole, string>>;
  /** Role -> colour, for callers that need the raw value (e.g. a chart). */
  readonly color: ThemeColors;
  /** The material layer as resolved (translucency already honoured). */
  readonly material: ThemeMaterial;
  readonly bg: Readonly<{
    canvas: ViewStyle;
    raised: ViewStyle;
    inset: ViewStyle;
    row: ViewStyle;
    sunken: ViewStyle;
    overlay: ViewStyle;
    nav: ViewStyle;
    sheet: ViewStyle;
    palette: ViewStyle;
    scrim: ViewStyle;
  }>;
  readonly border: Readonly<{
    hairline: ViewStyle;
    edge: ViewStyle;
    focus: ViewStyle;
  }>;
  readonly fg: Readonly<{
    primary: TextStyle;
    secondary: TextStyle;
    muted: TextStyle;
    inverse: TextStyle;
    accent: TextStyle;
    accentText: TextStyle;
  }>;
  readonly accent: Readonly<{
    primary: TextStyle;
    success: TextStyle;
    info: TextStyle;
    warning: TextStyle;
    danger: TextStyle;
  }>;
  /** expo-blur intensity + tint, straight from the material tokens. */
  readonly blur: Readonly<{ intensity: number; tint: ThemeMaterial["tint"] }>;
}

export type StatusRole =
  | "paid"
  | "partial"
  | "unpaid"
  | "overdue"
  | "neutral";

const STATUS_ROLE: Readonly<Record<Exclude<StatusRole, "neutral">, keyof ThemeColors>> = {
  paid: "statusPaid",
  partial: "statusPartial",
  unpaid: "statusUnpaid",
  overdue: "statusOverdue",
};

const bg = (backgroundColor: string): ViewStyle => ({ backgroundColor });
const fg = (color: string): TextStyle => ({ color });

export function buildThemeStyles(theme: Theme): ThemeStyles {
  const { colors, material } = theme;
  return {
    status: {
      paid: colors.statusPaid,
      partial: colors.statusPartial,
      unpaid: colors.statusUnpaid,
      overdue: colors.statusOverdue,
      neutral: colors.textMuted,
    },
    color: colors,
    material,
    bg: {
      canvas: bg(colors.canvas),
      raised: bg(colors.surfaceRaised),
      inset: bg(colors.surfaceInset),
      row: bg(colors.surfaceRow),
      sunken: bg(colors.surfaceSunken),
      overlay: bg(material.surfaceOverlay),
      nav: bg(material.surfaceNav),
      sheet: bg(material.surfaceSheet),
      palette: bg(material.surfacePalette),
      scrim: bg(material.surfaceScrim),
    },
    border: {
      hairline: { borderColor: colors.borderDefault },
      edge: { borderColor: colors.borderStrong },
      focus: { borderColor: colors.borderFocus },
    },
    fg: {
      primary: fg(colors.textPrimary),
      secondary: fg(colors.textSecondary),
      muted: fg(colors.textMuted),
      inverse: fg(colors.textInverse),
      accent: fg(colors.accentPrimary),
      accentText: fg(colors.accentText),
    },
    accent: {
      primary: fg(colors.accentPrimary),
      success: fg(colors.success),
      info: fg(colors.info),
      warning: fg(colors.warning),
      danger: fg(colors.danger),
    },
    blur: {
      intensity: material.blurIntensity,
      tint: material.tint,
    },
  };
}

/** Memoised per resolved theme — re-created only when the palette/mode changes. */
export function useThemeStyles(): ThemeStyles {
  const theme = useThemeTokens();
  return useMemo(() => buildThemeStyles(theme), [theme]);
}

/**
 * Status role -> token colour, for callers outside React. Used by the status
 * badge map so a new status cannot invent a colour.
 */
export function statusColor(colors: ThemeColors, role: StatusRole): string {
  return role === "neutral" ? colors.textMuted : colors[STATUS_ROLE[role]];
}