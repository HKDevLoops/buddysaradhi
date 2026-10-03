// Implements: docs/design/overhaul-plan.md §6 — token-backed ledger row.
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useThemeStyles } from "../../theme/styles";

export type EntryType = "payment" | "invoice" | "refund" | "void";

interface LedgerRowProps {
  id: string;
  studentName: string;
  type: EntryType;
  amountMinor: number;
  date: string;
  reference?: string;
  onPress: () => void;
}

export const LedgerRow = React.memo(
  ({ studentName, type, amountMinor, date, reference, onPress }: LedgerRowProps) => {
    const s = useThemeStyles();
    const isCredit = type === "payment" || type === "refund";
    const amount = `₹ ${(amountMinor / 100).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`;

    const glyph =
      type === "invoice" ? "▤" : type === "refund" ? "↺" : type === "void" ? "✕" : "₹";
    const glyphTone =
      type === "invoice"
        ? s.accent.info
        : type === "refund"
          ? s.accent.warning
          : type === "void"
            ? s.accent.danger
            : s.accent.success;
    const title =
      type === "invoice"
        ? "Invoice for"
        : type === "refund"
          ? "Refund to"
          : type === "void"
            ? "Voided entry"
            : "Payment from";

    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center justify-between p-4 border-b active:opacity-70"
        style={[s.bg.row, s.border.hairline]}
      >
        <View className="flex-1 flex-row items-center">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={s.bg.inset}
          >
            <Text className="font-bold" style={glyphTone}>
              {glyph}
            </Text>
          </View>
          <View className="flex-1 mr-2">
            <Text className="font-medium text-base mb-0.5" style={s.fg.primary}>
              {title} {studentName}
            </Text>
            <View className="flex-row items-center">
              <Text className="text-xs" style={s.fg.muted}>
                {date}
              </Text>
              {reference ? (
                <>
                  <Text className="text-[10px] mx-1" style={s.fg.muted}>
                    •
                  </Text>
                  <Text className="text-[10px]" style={s.fg.muted}>
                    {reference}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        </View>

        <View className="items-end">
          <Text className="font-mono font-bold" style={isCredit ? s.accent.success : s.fg.primary}>
            {isCredit ? "+" : ""}
            {amount}
          </Text>
          <Text className="text-[10px] uppercase mt-1" style={isCredit ? s.accent.success : s.fg.muted}>
            {type}
          </Text>
        </View>
      </Pressable>
    );
  },
);
LedgerRow.displayName = "LedgerRow";