import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../../src/components/ui/glass-card';
import { LedgerRow, EntryType } from '../../src/components/fees/ledger-row';

const MOCK_LEDGER = [
  { id: '1', studentName: 'Aarav Sharma', type: 'payment' as EntryType, amountMinor: 350000, date: 'Today, 18:32', reference: 'UPI' },
  { id: '2', studentName: 'Diya Patel', type: 'payment' as EntryType, amountMinor: 500000, date: 'Today, 14:15', reference: 'Cash' },
  { id: '3', studentName: 'Rohan Gupta', type: 'invoice' as EntryType, amountMinor: 350000, date: 'Yesterday', reference: 'Oct Fee' },
  { id: '4', studentName: 'Sneha Reddy', type: 'payment' as EntryType, amountMinor: 350000, date: 'Yesterday', reference: 'Bank Xfer' },
  { id: '5', studentName: 'Aarav Sharma', type: 'void' as EntryType, amountMinor: 350000, date: 'Mon, 09:12', reference: 'Void INV-04' },
];

export default function FeesScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'feed' | 'unpaid'>('feed');

  return (
    <View className="flex-1 bg-[#0C081A]">
      <View className="px-4 pt-6 z-10 pb-4">
        <View className="flex-row items-center justify-between mb-6">
          <Text className="text-white text-xl font-bold tracking-tight">Fees & Payments</Text>
          <GlassCard intensity="strong" className="w-8 h-8 rounded-full items-center justify-center">
            <Text className="text-white font-bold text-lg leading-5">+</Text>
          </GlassCard>
        </View>

        {/* Top Summary Card */}
        <GlassCard intensity="faint" className="p-4 mb-6">
          <Text className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
            October Collection
          </Text>
          <View className="flex-row items-end justify-between">
            <Text className="text-white text-3xl font-bold font-mono tracking-tight text-[#00FF9D]">
              ₹ 1,24,500
            </Text>
            <View className="items-end">
              <Text className="text-white/40 text-xs line-through">₹ 1,40,000</Text>
              <Text className="text-white/60 text-xs">Target</Text>
            </View>
          </View>
          {/* Progress Bar */}
          <View className="h-1.5 w-full bg-white/10 rounded-full mt-4 overflow-hidden">
            <View className="h-full bg-[#00FF9D] w-[88%]" />
          </View>
        </GlassCard>

        {/* Custom Segmented Control */}
        <View className="flex-row bg-white/5 rounded-xl p-1 mb-2">
          <Pressable 
            onPress={() => setActiveTab('feed')}
            className={`flex-1 py-2 items-center rounded-lg ${activeTab === 'feed' ? 'bg-[#00F0FF]/20' : 'bg-transparent'}`}
          >
            <Text className={`font-medium text-sm ${activeTab === 'feed' ? 'text-[#00F0FF]' : 'text-white/60'}`}>Ledger Feed</Text>
          </Pressable>
          <Pressable 
            onPress={() => setActiveTab('unpaid')}
            className={`flex-1 py-2 items-center rounded-lg ${activeTab === 'unpaid' ? 'bg-[#FF5E00]/20' : 'bg-transparent'}`}
          >
            <Text className={`font-medium text-sm ${activeTab === 'unpaid' ? 'text-[#FF5E00]' : 'text-white/60'}`}>Unpaid Invoices</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView 
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'feed' ? (
          MOCK_LEDGER.map(entry => (
            <LedgerRow 
              key={entry.id}
              {...entry}
              onPress={() => console.log('Tap entry', entry.id)}
            />
          ))
        ) : (
          <View className="flex-1 items-center justify-center pt-10">
            <Text className="text-[#FF5E00] text-4xl mb-2">!</Text>
            <Text className="text-white/60">No overdue invoices right now.</Text>
          </View>
        )}
      </ScrollView>

      {/* Floating Action */}
      <View 
        className="absolute left-4 right-4" 
        style={{ bottom: 20 + insets.bottom }}
      >
        <Pressable className="bg-white/10 border border-[#00FF9D]/30 backdrop-blur-xl rounded-2xl p-4 shadow-[0_0_20px_rgba(0,255,157,0.1)] flex-row items-center justify-center active:bg-white/20">
          <Text className="text-[#00FF9D] font-bold text-xl mr-2 mb-1">+</Text>
          <Text className="text-white font-bold text-lg">Record Payment</Text>
        </Pressable>
      </View>
    </View>
  );
}
