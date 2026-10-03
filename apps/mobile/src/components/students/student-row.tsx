// Implements: docs/design/overhaul-plan.md §6 — token-backed roster row.
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useThemeStyles } from "../../theme/styles";
import { StatusBadge } from "../ui/status-badge";
import type { StatusType } from "../ui/status-badge";

export interface StudentRowProps {
  id: string;
  name: string;
  grade: string;
  guardianPhone: string;
  balanceMinor: number;
  status: StatusType;
  lastAttendance: string;
  onPress: () => void;
}

export const StudentRow = React.memo(
  ({ name, grade, balanceMinor, status, lastAttendance, onPress }: StudentRowProps) => {
    const s = useThemeStyles();
    const hasDue = balanceMinor > 0;
    const balance = hasDue
      ? `₹ ${(balanceMinor / 100).toLocaleString("en-IN", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })}`
      : "No Dues";

    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center justify-between p-4 border-b active:opacity-70"
        style={[s.bg.row, s.border.hairline]}
      >
        <View className="flex-row items-center flex-1">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={s.bg.inset}
          >
            <Text className="font-bold" style={s.fg.secondary}>
              {name.charAt(0)}
            </Text>
          </View>

          <View className="flex-1 mr-2">
            <Text className="font-medium text-base mb-0.5" numberOfLines={1} style={s.fg.primary}>
              {name}
            </Text>
            <View className="flex-row items-center">
              <Text className="text-xs" style={s.fg.muted}>
                {grade}
              </Text>
              <Text className="text-[10px] mx-1" style={s.fg.muted}>
                •
              </Text>
              <Text className="text-[10px]" style={s.fg.muted}>
                Att: {lastAttendance}
              </Text>
            </View>
          </View>
        </View>

        <View className="items-end">
          <Text className="font-mono font-bold mb-1" style={hasDue ? s.accent.warning : s.fg.muted}>
            {balance}
          </Text>
          <StatusBadge status={status} size="sm" />
        </View>
      </Pressable>
    );
  },
);
StudentRow.displayName = "StudentRow";