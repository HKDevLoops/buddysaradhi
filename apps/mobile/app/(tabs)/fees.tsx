// Implements: docs/design/overhaul-plan.md §6 — Fees & Payments on the token system.
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "../../src/components/ui/glass-card";
import { LedgerRow, type EntryType } from "../../src/components/fees/ledger-row";
import { useThemeStyles } from "../../src/theme/styles";

const MOCK_LEDGER = [
  { id: "1", studentName: "Aarav Sharma", type: "payment" as EntryType, amountMinor: 350000, date: "Today, 18:32", reference: "UPI" },
  { id: "2", studentName: "Diya Patel", type: "payment" as EntryType, amountMinor: 500000, date: "Today, 14:15", reference: "Cash" },
  { id: "3", studentName: "Rohan Gupta", type: "invoice" as EntryType, amountMinor: 350000, date: "Yesterday", reference: "Oct Fee" },
  { id: "4", studentName: "Sneha Reddy", type: "payment" as EntryType, amountMinor: 350000, date: "Yesterday", reference: "Bank Xfer" },
  { id: "5", studentName: "Aarav Sharma", type: "void" as EntryType, amountMinor: 350000, date: "Mon, 09:12", reference: "Void INV-04" },
];

export default function FeesScreen() {
  const insets = useSafeAreaInsets();
  const s = useThemeStyles();
  const [activeTab, setActiveTab] = useState<"feed" | "unpaid">("feed");

  const tabs = [
    { id: "feed" as const, label: "Ledger Feed", tone: s.accent.info },
    { id: "unpaid" as const, label: "Unpaid Invoices", tone: s.accent.danger },
  ];

  return (
    <View className="flex-1" style={s.bg.canvas}>
      <View className="px-4 pt-6 z-10 pb-4">
        <View className="flex-row items-center justify-between mb-6">
          <Text className="text-xl font-bold tracking-tight" style={s.fg.primary}>
            Fees &amp; Payments
          </Text>
          <GlassCard intensity="strong" className="w-8 h-8 rounded-full items-center justify-center">
            <Text className="font-bold text-lg leading-5" style={s.fg.primary}>
              +
            </Text>
          </GlassCard>
        </View>

        <GlassCard intensity="faint" className="p-4 mb-6">
          <Text className="text-xs font-semibold uppercase tracking-wider mb-2" style={s.fg.secondary}>
            October Collection
          </Text>
          <View className="flex-row items-end justify-between">
            <Text className="text-3xl font-bold font-mono tracking-tight" style={s.accent.success}>
              ₹ 1,24,500
            </Text>
            <View className="items-end">
              <Text className="text-xs line-through" style={s.fg.muted}>
                ₹ 1,40,000
              </Text>
              <Text className="text-xs" style={s.fg.secondary}>
                Target
              </Text>
            </View>
          </View>
          <View className="h-1.5 w-full rounded-full mt-4 overflow-hidden" style={s.bg.sunken}>
            <View className="h-full w-[88%]" style={s.bg.raised} />
          </View>
        </GlassCard>

        <View className="flex-row rounded-xl p-1 mb-2" style={s.bg.inset}>
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                className="flex-1 py-2 items-center rounded-lg"
                style={selected ? s.bg.raised : null}
              >
                <Text className="font-medium text-sm" style={selected ? tab.tone : s.fg.secondary}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "feed" ? (
          MOCK_LEDGER.map((entry) => (
            <LedgerRow key={entry.id} {...entry} onPress={() => undefined} />
          ))
        ) : (
          <View className="flex-1 items-center justify-center pt-10">
            <Text className="text-4xl mb-2" style={s.accent.danger}>
              !
            </Text>
            <Text style={s.fg.secondary}>No overdue invoices right now.</Text>
          </View>
        )}
      </ScrollView>

      <View className="absolute left-4 right-4" style={{ bottom: 20 + insets.bottom }}>
        <Pressable
          className="rounded-2xl p-4 flex-row items-center justify-center active:opacity-80 border"
          style={[s.bg.raised, s.border.edge]}
        >
          <Text className="font-bold text-xl mr-2 mb-1" style={s.accent.success}>
            +
          </Text>
          <Text className="font-bold text-lg" style={s.fg.primary}>
            Record Payment
          </Text>
        </Pressable>
      </View>
    </View>
  );
}