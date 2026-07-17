import React from 'react';
import { View, Text, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../../src/components/ui/glass-card';
import { SettingsRow } from '../../src/components/settings/settings-row';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [hapticsEnabled, setHapticsEnabled] = React.useState(true);

  return (
    <View className="flex-1 bg-[#0C081A]">
      <View className="px-4 pt-6 z-10 pb-4">
        <Text className="text-white text-xl font-bold tracking-tight mb-6">Settings</Text>

        <GlassCard intensity="strong" className="p-4 mb-6 flex-row items-center">
          <View className="w-12 h-12 rounded-full bg-[#B388FF]/20 items-center justify-center mr-4">
            <Text className="text-[#B388FF] text-xl font-bold">VS</Text>
          </View>
          <View className="flex-1">
            <Text className="text-white font-bold text-lg">Vidya Saradhi Academy</Text>
            <Text className="text-white/60 text-sm">vsa_tenant_8x29a</Text>
          </View>
          <Text className="text-[#00F0FF] font-medium text-sm">Edit</Text>
        </GlassCard>
      </View>

      <ScrollView 
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-white/40 uppercase text-[10px] font-bold tracking-wider mb-2 ml-2">Preferences</Text>
        <GlassCard intensity="faint" className="mb-6">
          <View className="flex-row items-center justify-between p-4 border-b border-white/5">
            <View className="flex-row items-center">
              <View className="w-8 h-8 rounded-full bg-white/5 items-center justify-center mr-3">
                <Text className="text-white/60">📳</Text>
              </View>
              <Text className="text-white font-medium">Haptic Feedback</Text>
            </View>
            <Switch 
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#00F0FF' }}
              thumbColor="#FFFFFF"
            />
          </View>
          <SettingsRow 
            icon="🇮🇳" 
            title="Currency & Formatting" 
            value="INR (₹)" 
            onPress={() => {}} 
          />
        </GlassCard>

        <Text className="text-white/40 uppercase text-[10px] font-bold tracking-wider mb-2 ml-2">Data & Sync</Text>
        <GlassCard intensity="faint" className="mb-6">
          <SettingsRow 
            icon="☁️" 
            title="Sync Status" 
            subtitle="Last synced 2m ago"
            value="Up to date" 
            onPress={() => {}} 
          />
          <SettingsRow 
            icon="🔒" 
            title="Encrypted Backup" 
            subtitle="Create AES-256-GCM backup"
            onPress={() => {}} 
          />
          <SettingsRow 
            icon="📄" 
            title="Export Ledger" 
            subtitle="Download as CSV"
            onPress={() => {}} 
          />
        </GlassCard>

        <Text className="text-white/40 uppercase text-[10px] font-bold tracking-wider mb-2 ml-2">App Info</Text>
        <GlassCard intensity="faint" className="mb-8">
          <SettingsRow 
            icon="ℹ️" 
            title="About Buddysaradhi" 
            value="v1.0.0-beta" 
            onPress={() => {}} 
          />
          <SettingsRow 
            icon="🚪" 
            title="Logout" 
            isDestructive
            onPress={() => {}} 
          />
        </GlassCard>
      </ScrollView>
    </View>
  );
}
