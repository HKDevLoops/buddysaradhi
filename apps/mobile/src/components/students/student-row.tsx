import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StatusBadge, StatusType } from '../ui/status-badge';

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

export const StudentRow = React.memo(({ 
  name, 
  grade, 
  balanceMinor, 
  status, 
  lastAttendance, 
  onPress 
}: StudentRowProps) => {
  const isCurrency = balanceMinor > 0;
  const balanceStr = isCurrency 
    ? `₹ ${(balanceMinor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
    : 'No Dues';

  return (
    <Pressable 
      onPress={onPress}
      className="flex-row items-center justify-between p-4 border-b border-white/5 active:bg-white/5"
    >
      <View className="flex-row items-center flex-1">
        {/* Avatar Placeholder */}
        <View className="w-10 h-10 rounded-full bg-white/10 items-center justify-center mr-3">
          <Text className="text-white/60 font-bold">{name.charAt(0)}</Text>
        </View>
        
        <View className="flex-1 mr-2">
          <Text className="text-white font-medium text-base mb-0.5" numberOfLines={1}>
            {name}
          </Text>
          <View className="flex-row items-center">
            <Text className="text-white/40 text-xs">{grade}</Text>
            <Text className="text-white/20 text-[10px] mx-1">•</Text>
            <Text className="text-white/40 text-[10px]">Att: {lastAttendance}</Text>
          </View>
        </View>
      </View>
      
      <View className="items-end">
        <Text className={`font-mono font-bold mb-1 ${isCurrency ? 'text-[#FF5E00]' : 'text-white/40'}`}>
          {balanceStr}
        </Text>
        <StatusBadge status={status} size="sm" />
      </View>
    </Pressable>
  );
});
StudentRow.displayName = 'StudentRow';
