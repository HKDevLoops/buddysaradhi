import React from 'react';
import { View, Text, Pressable } from 'react-native';

interface SettingsRowProps {
  icon: string;
  title: string;
  subtitle?: string;
  value?: string;
  isDestructive?: boolean;
  onPress: () => void;
}

export function SettingsRow({ icon, title, subtitle, value, isDestructive, onPress }: SettingsRowProps) {
  return (
    <Pressable 
      onPress={onPress}
      className="flex-row items-center p-4 border-b border-white/5 active:bg-white/5"
    >
      <View className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${isDestructive ? 'bg-[#FF5E00]/10' : 'bg-white/5'}`}>
        <Text className={isDestructive ? 'text-[#FF5E00]' : 'text-white/60'}>{icon}</Text>
      </View>
      
      <View className="flex-1 mr-2">
        <Text className={`font-medium ${isDestructive ? 'text-[#FF5E00]' : 'text-white'}`}>
          {title}
        </Text>
        {subtitle && (
          <Text className="text-white/40 text-xs mt-0.5">{subtitle}</Text>
        )}
      </View>

      <View className="flex-row items-center">
        {value && <Text className="text-white/60 text-sm mr-2">{value}</Text>}
        <Text className="text-white/20 text-lg">›</Text>
      </View>
    </Pressable>
  );
}
