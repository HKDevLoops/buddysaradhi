import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KpiCard } from '../../src/components/dashboard/kpi-card';
import { GlassCard } from '../../src/components/ui/glass-card';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1">
      {/* Scrollable Content */}
      <ScrollView 
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-4 py-6">
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-white text-xl font-bold tracking-tight">Dashboard</Text>
            <GlassCard intensity="faint" className="px-3 py-1.5 rounded-full">
              <Text className="text-white/80 text-sm">Sept 2025 ▾</Text>
            </GlassCard>
          </View>

          {/* KPI Strip */}
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            className="mb-8 overflow-visible"
            snapToInterval={292} // 280 (card width) + 12 (margin right)
            decelerationRate="fast"
          >
            <KpiCard 
              label="Collected This Month"
              valueMinor={12450000} 
              deltaPct={18}
              deltaLabel="vs Aug"
              accent="emerald"
            />
            <KpiCard 
              label="Due Till Date"
              valueMinor={3820000} 
              caption="All-time, ignores filter"
              accent="flare"
            />
            <KpiCard 
              label="Due Month"
              valueMinor={1450000} 
              deltaPct={-5}
              deltaLabel="vs Aug"
              accent="amber"
            />
            <KpiCard 
              label="Total Students"
              valueCount={87} 
              caption="5 batches active"
              accent="cyan"
            />
            <KpiCard 
              label="Students With Dues"
              valueCount={12} 
              deltaPct={2}
              deltaLabel="vs Aug"
              accent="flare"
            />
            <GlassCard intensity="strong" className="p-4 flex-col justify-between min-w-[280px] h-32 mr-4">
              <Text className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
                Payment Breakdown
              </Text>
              <View className="flex-row items-center space-x-3 mt-1 gap-4">
                <View className="items-center">
                  <Text className="text-[#00FF9D] text-lg font-bold">42</Text>
                  <Text className="text-white/40 text-[10px]">paid</Text>
                </View>
                <View className="items-center">
                  <Text className="text-[#FFB300] text-lg font-bold">8</Text>
                  <Text className="text-white/40 text-[10px]">partial</Text>
                </View>
                <View className="items-center">
                  <Text className="text-[#FF5E00] text-lg font-bold">12</Text>
                  <Text className="text-white/40 text-[10px]">unpaid</Text>
                </View>
              </View>
            </GlassCard>
          </ScrollView>

          {/* Due Today Panel */}
          <Text className="text-white text-lg font-bold tracking-tight mb-3">Due Today</Text>
          <GlassCard intensity="faint" className="p-0 mb-8 overflow-hidden">
            <View className="p-4 border-b border-white/5 flex-row justify-between items-center bg-[#FF5E00]/5">
              <View>
                <Text className="text-white font-medium">4 students — fee due today</Text>
              </View>
              <View className="w-2 h-2 rounded-full bg-[#FF5E00]" />
            </View>
            <View className="p-4 border-b border-white/5 flex-row justify-between items-center bg-[#FFB300]/5">
              <View>
                <Text className="text-white font-medium">Batch 9-Sci — attendance missing</Text>
              </View>
              <View className="w-2 h-2 rounded-full bg-[#FFB300]" />
            </View>
            <View className="p-4 flex-row justify-between items-center">
              <View>
                <Text className="text-white font-medium">2 students inactive 14d</Text>
                <Text className="text-white/50 text-xs mt-1">M. Sharma, S. Gupta</Text>
              </View>
              <View className="w-2 h-2 rounded-full bg-white/20" />
            </View>
          </GlassCard>

          {/* Activity Feed Placeholder */}
          <Text className="text-white text-lg font-bold tracking-tight mb-3">Recent Activity</Text>
          <GlassCard intensity="faint" className="p-4">
            <View className="flex-row items-start mb-4">
              <View className="w-8 h-8 rounded-full bg-[#00FF9D]/20 items-center justify-center mr-3 mt-1">
                <Text className="text-[#00FF9D] text-xs font-bold">₹</Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-medium">₹ 3,500 received</Text>
                <Text className="text-white/60 text-sm">from A. Sharma (INV-0017)</Text>
                <Text className="text-white/40 text-xs mt-1">18:32 · UPI</Text>
              </View>
            </View>
            
            <View className="flex-row items-start">
              <View className="w-8 h-8 rounded-full bg-[#00F0FF]/20 items-center justify-center mr-3 mt-1">
                <Text className="text-[#00F0FF] text-xs font-bold">✓</Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-medium">Batch 10-Maths locked</Text>
                <Text className="text-white/60 text-sm">Attendance marked for 14 students</Text>
                <Text className="text-white/40 text-xs mt-1">18:10 · Auto-lock</Text>
              </View>
            </View>
          </GlassCard>
        </View>
      </ScrollView>

      {/* Floating Quick Actions Bar */}
      <View 
        className="absolute left-4 right-4" 
        style={{ bottom: 20 + insets.bottom }}
      >
        <GlassCard intensity="strong" className="p-2 flex-row justify-around items-center" blurIntensity={40}>
          <Pressable 
            className="items-center justify-center p-2 rounded-xl active:bg-white/10 min-w-[44px] min-h-[44px]"
            onPress={() => Haptics.selectionAsync()}
          >
            <View className="w-10 h-10 rounded-full bg-[#00FF9D]/10 items-center justify-center mb-1">
              <Text className="text-[#00FF9D] font-bold text-xl">+</Text>
            </View>
            <Text className="text-white/80 text-[10px] font-medium">Payment</Text>
          </Pressable>
          <Pressable 
            className="items-center justify-center p-2 rounded-xl active:bg-white/10 min-w-[44px] min-h-[44px]"
            onPress={() => Haptics.selectionAsync()}
          >
            <View className="w-10 h-10 rounded-full bg-[#00F0FF]/10 items-center justify-center mb-1">
              <Text className="text-[#00F0FF] font-bold text-xl">✓</Text>
            </View>
            <Text className="text-white/80 text-[10px] font-medium">Attendance</Text>
          </Pressable>
          <Pressable 
            className="items-center justify-center p-2 rounded-xl active:bg-white/10 min-w-[44px] min-h-[44px]"
            onPress={() => Haptics.selectionAsync()}
          >
            <View className="w-10 h-10 rounded-full bg-white/10 items-center justify-center mb-1">
              <Text className="text-white font-bold text-xl">+</Text>
            </View>
            <Text className="text-white/80 text-[10px] font-medium">Student</Text>
          </Pressable>
        </GlassCard>
      </View>
    </View>
  );
}
