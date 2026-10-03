// Implements: docs/design/overhaul-plan.md §6 — token-backed attendance row.
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useThemeStyles } from "../../theme/styles";
import type { TextStyle } from "react-native";

export type AttendanceStatus = "present" | "absent" | "late" | "none";

interface AttendanceRowProps {
  studentName: string;
  status: AttendanceStatus;
  onStatusChange: (status: AttendanceStatus) => void;
}

export const AttendanceRow = React.memo(
  ({ studentName, status, onStatusChange }: AttendanceRowProps) => {
    const s = useThemeStyles();

    const action = (next: AttendanceStatus) => () =>
      onStatusChange(status === next ? "none" : next);

    const button = (next: AttendanceStatus, glyph: string, tone: TextStyle) => {
      const selected = status === next;
      return (
        <Pressable
          onPress={action(next)}
          className="w-10 h-10 rounded-full items-center justify-center border"
          style={[s.bg.inset, selected ? s.border.edge : s.border.hairline]}
          accessibilityRole="button"
          accessibilityState={{ selected }}
        >
          <Text className="font-bold text-lg leading-5 pb-1" style={selected ? tone : s.fg.muted}>
            {glyph}
          </Text>
        </Pressable>
      );
    };

    return (
      <View className="flex-row items-center justify-between p-4 border-b" style={s.border.hairline}>
        <View className="flex-1 flex-row items-center">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={s.bg.inset}
          >
            <Text className="font-bold" style={s.fg.secondary}>
              {studentName.charAt(0)}
            </Text>
          </View>
          <Text className="font-medium text-base" style={s.fg.primary}>
            {studentName}
          </Text>
        </View>

        <View className="flex-row gap-2">
          {button("present", "✓", s.accent.success)}
          {button("absent", "✕", s.accent.danger)}
          {button("late", "◐", s.accent.warning)}
        </View>
      </View>
    );
  },
);
AttendanceRow.displayName = "AttendanceRow";