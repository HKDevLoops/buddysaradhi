// Implements: docs/design/overhaul-plan.md §6 — token-backed card surface.
import { View } from "react-native";
import type { ViewProps } from "react-native";
import { BlurView } from "expo-blur";

import { useThemeStyles } from "../../theme/styles";

/** Three density steps, mapped to the structure tokens (material-modes.md §2.0). */
const INTENSITY_SURFACE = ["row", "raised", "overlay"] as const;
type Intensity = "faint" | "normal" | "strong";

interface GlassCardProps extends ViewProps {
  intensity?: Intensity;
  /**
   * Overrides the blur radius in the token, in pixels. Prefer the material
   * default (omit the prop) so the value stays the one the contract shipped.
   */
  blurIntensity?: number;
}

export function GlassCard({
  intensity = "normal",
  blurIntensity,
  className,
  style,
  children,
  ...props
}: GlassCardProps) {
  const s = useThemeStyles();
  const surface = INTENSITY_SURFACE[intensity === "faint" ? 0 : intensity === "strong" ? 2 : 1];
  const background = surface === "overlay" ? s.bg.overlay : surface === "row" ? s.bg.row : s.bg.raised;
  const blurred = s.material.translucent;

  return (
    <View
      className={`rounded-2xl border ${className ?? ""}`}
      style={[background, s.border.hairline, style]}
      {...props}
    >
      {blurred ? (
        <BlurView
          intensity={blurIntensity ?? s.blur.intensity}
          tint={s.blur.tint}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}