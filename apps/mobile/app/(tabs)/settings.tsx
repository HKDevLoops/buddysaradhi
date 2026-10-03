// Implements: docs/design/overhaul-plan.md §6 — Settings on the token system.
//
// The Appearance section is the palette/material picker seam: `useAppearance()`
// already exposes every palette and mode with a swatch, so adding the control is
// a rendering task, not a token task. It is deliberately not added here — this
// wave is token consumption only.
import { useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "../../src/components/ui/glass-card";
import { SettingsRow } from "../../src/components/settings/settings-row";
import { useThemeStyles } from "../../src/theme/styles";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const s = useThemeStyles();
  const [hapticsEnabled, setHapticsEnabled] = useState(true);

  return (
    <View className="flex-1" style={s.bg.canvas}>
      <View className="px-4 pt-6 z-10 pb-4">
        <Text className="text-xl font-bold tracking-tight mb-6" style={s.fg.primary}>
          Settings
        </Text>

        <GlassCard intensity="strong" className="p-4 mb-6 flex-row items-center">
          <View
            className="w-12 h-12 rounded-full items-center justify-center mr-4 border"
            style={[s.bg.inset, s.border.hairline]}
          >
            <Text className="text-xl font-bold" style={s.fg.accent}>
              VS
            </Text>
          </View>
          <View className="flex-1">
            <Text className="font-bold text-lg" style={s.fg.primary}>
              Vidya Saradhi Academy
            </Text>
            <Text className="text-sm" style={s.fg.secondary}>
              vsa_tenant_8x29a
            </Text>
          </View>
          <Text className="font-medium text-sm" style={s.accent.info}>
            Edit
          </Text>
        </GlassCard>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="uppercase text-[10px] font-bold tracking-wider mb-2 ml-2" style={s.fg.muted}>
          Preferences
        </Text>
        <GlassCard intensity="faint" className="mb-6">
          <View className="flex-row items-center justify-between p-4 border-b" style={s.border.hairline}>
            <View className="flex-row items-center">
              <View
                className="w-8 h-8 rounded-full items-center justify-center mr-3"
                style={s.bg.inset}
              >
                <Text style={s.fg.secondary}>◍</Text>
              </View>
              <Text className="font-medium" style={s.fg.primary}>
                Haptic Feedback
              </Text>
            </View>
            <Switch
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
              trackColor={{ false: s.color.surfaceSunken, true: s.color.info }}
              thumbColor={s.color.textPrimary}
            />
          </View>
          <SettingsRow icon="₹" title="Currency &amp; Formatting" value="INR (₹)" onPress={() => undefined} />
        </GlassCard>

        <Text className="uppercase text-[10px] font-bold tracking-wider mb-2 ml-2" style={s.fg.muted}>
          Data &amp; Sync
        </Text>
        <GlassCard intensity="faint" className="mb-6">
          <SettingsRow
            icon="↻"
            title="Sync Status"
            subtitle="Last synced 2m ago"
            value="Up to date"
            onPress={() => undefined}
          />
          <SettingsRow
            icon="⌘"
            title="Encrypted Backup"
            subtitle="Create AES-256-GCM backup"
            onPress={() => undefined}
          />
          <SettingsRow
            icon="⇩"
            title="Export Ledger"
            subtitle="Download as CSV"
            onPress={() => undefined}
          />
        </GlassCard>

        <Text className="uppercase text-[10px] font-bold tracking-wider mb-2 ml-2" style={s.fg.muted}>
          App Info
        </Text>
        <GlassCard intensity="faint" className="mb-8">
          <SettingsRow
            icon="ⓘ"
            title="About Buddysaradhi"
            value="v1.0.0-beta"
            onPress={() => undefined}
          />
          <SettingsRow icon="⏻" title="Logout" isDestructive onPress={() => undefined} />
        </GlassCard>
      </ScrollView>
    </View>
  );
}