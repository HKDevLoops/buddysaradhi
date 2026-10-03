// Implements: docs/design/overhaul-plan.md §6 — Dashboard on the token system.
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KpiCard } from "../../src/components/dashboard/kpi-card";
import { GlassCard } from "../../src/components/ui/glass-card";
import { useThemeStyles } from "../../src/theme/styles";

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const s = useThemeStyles();

  const breakdown = [
    { label: "paid", count: "42", tone: s.accent.success },
    { label: "partial", count: "8", tone: s.accent.warning },
    { label: "unpaid", count: "12", tone: s.accent.danger },
  ] as const;

  const dueToday = [
    { title: "4 students — fee due today", dot: s.accent.danger },
    { title: "Batch 9-Sci — attendance missing", dot: s.accent.warning },
    { title: "2 students inactive 14d", dot: s.fg.muted },
  ] as const;

  const quickActions = [
    { glyph: "+", label: "Payment", tone: s.accent.success },
    { glyph: "✓", label: "Attendance", tone: s.accent.info },
    { glyph: "+", label: "Student", tone: s.fg.primary },
  ] as const;

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-4 py-6">
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-xl font-bold tracking-tight" style={s.fg.primary}>
              Dashboard
            </Text>
            <GlassCard intensity="faint" className="px-3 py-1.5 rounded-full">
              <Text className="text-sm" style={s.fg.secondary}>
                Sept 2025 ▾
              </Text>
            </GlassCard>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-8 overflow-visible"
            snapToInterval={292}
            decelerationRate="fast"
          >
            <KpiCard
              label="Collected This Month"
              valueMinor={12450000}
              deltaPct={18}
              deltaLabel="vs Aug"
              accent="success"
            />
            <KpiCard
              label="Due Till Date"
              valueMinor={3820000}
              caption="All-time, ignores filter"
              accent="danger"
            />
            <KpiCard label="Due Month" valueMinor={1450000} deltaPct={-5} deltaLabel="vs Aug" accent="warning" />
            <KpiCard label="Total Students" valueCount={87} caption="5 batches active" accent="info" />
            <KpiCard
              label="Students With Dues"
              valueCount={12}
              deltaPct={2}
              deltaLabel="vs Aug"
              accent="danger"
            />
            <GlassCard intensity="strong" className="p-4 flex-col justify-between min-w-[280px] h-32 mr-4">
              <Text className="text-xs font-semibold uppercase tracking-wider mb-2" style={s.fg.secondary}>
                Payment Breakdown
              </Text>
              <View className="flex-row items-center space-x-3 mt-1 gap-4">
                {breakdown.map((item) => (
                  <View className="items-center" key={item.label}>
                    <Text className="text-lg font-bold" style={item.tone}>
                      {item.count}
                    </Text>
                    <Text className="text-[10px]" style={s.fg.muted}>
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
            </GlassCard>
          </ScrollView>

          <Text className="text-lg font-bold tracking-tight mb-3" style={s.fg.primary}>
            Due Today
          </Text>
          <GlassCard intensity="faint" className="p-0 mb-8 overflow-hidden">
            {dueToday.map((item, index) => (
              <View
                key={item.title}
                className={`p-4 flex-row justify-between items-center ${index < dueToday.length - 1 ? "border-b" : ""}`}
                style={[index < dueToday.length - 1 ? s.border.hairline : null]}
              >
                <Text className="font-medium" style={s.fg.primary}>
                  {item.title}
                </Text>
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: item.dot.color }} />
              </View>
            ))}
          </GlassCard>

          <Text className="text-lg font-bold tracking-tight mb-3" style={s.fg.primary}>
            Recent Activity
          </Text>
          <GlassCard intensity="faint" className="p-4">
            <View className="flex-row items-start mb-4">
              <View
                className="w-8 h-8 rounded-full items-center justify-center mr-3 mt-1"
                style={s.bg.inset}
              >
                <Text className="text-xs font-bold" style={s.accent.success}>
                  ₹
                </Text>
              </View>
              <View className="flex-1">
                <Text className="font-medium" style={s.fg.primary}>
                  ₹ 3,500 received
                </Text>
                <Text className="text-sm" style={s.fg.secondary}>
                  from A. Sharma (INV-0017)
                </Text>
                <Text className="text-xs mt-1" style={s.fg.muted}>
                  18:32 · UPI
                </Text>
              </View>
            </View>

            <View className="flex-row items-start">
              <View
                className="w-8 h-8 rounded-full items-center justify-center mr-3 mt-1"
                style={s.bg.inset}
              >
                <Text className="text-xs font-bold" style={s.accent.info}>
                  ✓
                </Text>
              </View>
              <View className="flex-1">
                <Text className="font-medium" style={s.fg.primary}>
                  Batch 10-Maths locked
                </Text>
                <Text className="text-sm" style={s.fg.secondary}>
                  Attendance marked for 14 students
                </Text>
                <Text className="text-xs mt-1" style={s.fg.muted}>
                  18:10 · Auto-lock
                </Text>
              </View>
            </View>
          </GlassCard>
        </View>
      </ScrollView>

      <View className="absolute left-4 right-4" style={{ bottom: 20 + insets.bottom }}>
        <GlassCard intensity="strong" className="p-2 flex-row justify-around items-center">
          {quickActions.map((action) => (
            <Pressable
              key={action.label}
              className="items-center justify-center p-2 rounded-xl active:opacity-70 min-w-[44px] min-h-[44px]"
              onPress={() => {
                void Haptics.selectionAsync();
              }}
            >
              <View className="w-10 h-10 rounded-full items-center justify-center mb-1" style={s.bg.inset}>
                <Text className="font-bold text-xl" style={action.tone}>
                  {action.glyph}
                </Text>
              </View>
              <Text className="text-[10px] font-medium" style={s.fg.secondary}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </GlassCard>
      </View>
    </View>
  );
}