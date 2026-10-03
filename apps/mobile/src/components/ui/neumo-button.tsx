// Implements: docs/design/overhaul-plan.md §6 — token-backed neumorphic control.
import { Pressable, Text } from "react-native";
import type { GestureResponderEvent, PressableProps } from "react-native";
import * as Haptics from "expo-haptics";

import { useThemeStyles } from "../../theme/styles";

interface NeumoButtonProps extends PressableProps {
  title: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "md" | "lg";
}

export function NeumoButton({
  title,
  variant = "primary",
  size = "md",
  className,
  onPress,
  ...props
}: NeumoButtonProps) {
  const s = useThemeStyles();

  // AGENTS.md: haptic on every neumorphic press.
  const handlePress = (event: GestureResponderEvent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.(event);
  };

  const label =
    variant === "primary" ? s.accent.primary : variant === "danger" ? s.accent.danger : s.fg.primary;
  const surface = variant === "secondary" ? s.bg.raised : s.bg.inset;

  // AGENTS.md Rule 10: 44px minimum touch target.
  const minHeight = size === "lg" ? 56 : 44;

  return (
    <Pressable
      onPress={handlePress}
      className={`rounded-xl items-center justify-center border active:opacity-70 ${className ?? ""}`}
      style={[surface, s.border.hairline, { minHeight, minWidth: minHeight }]}
      {...props}
    >
      <Text className="tracking-wide font-semibold" style={label}>
        {title}
      </Text>
    </Pressable>
  );
}