// Implements: docs/design/overhaul-plan.md §6 — token-backed input well.
import { useState } from "react";
import { TextInput, Text, View } from "react-native";
import type { TextInputProps } from "react-native";

import { useThemeStyles } from "../../theme/styles";

type FocusHandler = NonNullable<TextInputProps["onFocus"]>;
type BlurHandler = NonNullable<TextInputProps["onBlur"]>;

interface NeumoInputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
}

export function NeumoInput({
  label,
  error,
  helperText,
  className,
  onFocus,
  onBlur,
  style,
  ...props
}: NeumoInputProps) {
  const s = useThemeStyles();
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus: FocusHandler = (event) => {
    setIsFocused(true);
    onFocus?.(event);
  };

  const handleBlur: BlurHandler = (event) => {
    setIsFocused(false);
    onBlur?.(event);
  };

  // Focus and error are states, not decorations: the ring colour comes from the
  // border roles, never from an alpha mixed by hand.
  const ring = error ? s.border.edge : isFocused ? s.border.focus : s.border.hairline;

  return (
    <View className={`w-full ${className ?? ""}`}>
      {label ? (
        <Text className="text-xs font-medium mb-1 px-1" style={s.fg.secondary}>
          {label}
        </Text>
      ) : null}

      <View className="rounded-xl overflow-hidden border" style={[s.bg.inset, ring]}>
        <TextInput
          className="px-3 py-3 text-base min-h-[44px]"
          style={[s.fg.primary, style]}
          placeholderTextColor={s.fg.muted.color}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
      </View>

      {error || helperText ? (
        <Text className="text-xs mt-1 px-1" style={error ? s.accent.danger : s.fg.muted}>
          {error ?? helperText}
        </Text>
      ) : null}
    </View>
  );
}