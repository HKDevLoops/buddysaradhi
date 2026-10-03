// Implements: docs/design/overhaul-plan.md §6 — token-backed settings row.
import { Pressable, Text, View } from "react-native";

import { useThemeStyles } from "../../theme/styles";

interface SettingsRowProps {
  icon: string;
  title: string;
  subtitle?: string;
  value?: string;
  isDestructive?: boolean;
  onPress: () => void;
}

export function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  isDestructive,
  onPress,
}: SettingsRowProps) {
  const s = useThemeStyles();
  const tone = isDestructive ? s.accent.danger : s.fg.primary;

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center p-4 border-b active:opacity-70"
      style={[s.bg.row, s.border.hairline]}
    >
      <View
        className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${isDestructive ? "border" : ""}`}
        style={[s.bg.inset, isDestructive ? s.border.edge : null]}
      >
        <Text style={isDestructive ? s.accent.danger : s.fg.secondary}>{icon}</Text>
      </View>

      <View className="flex-1 mr-2">
        <Text className="font-medium" style={tone}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs mt-0.5" style={s.fg.muted}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View className="flex-row items-center">
        {value ? (
          <Text className="text-sm mr-2" style={s.fg.secondary}>
            {value}
          </Text>
        ) : null}
        <Text className="text-lg" style={s.fg.muted}>
          ›
        </Text>
      </View>
    </Pressable>
  );
}