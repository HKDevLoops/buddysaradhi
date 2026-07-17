import React from 'react';
import { View, Text, Pressable } from 'react-native';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'none';

interface AttendanceRowProps {
  studentName: string;
  status: AttendanceStatus;
  onStatusChange: (status: AttendanceStatus) => void;
}

export const AttendanceRow = React.memo(({ studentName, status, onStatusChange }: AttendanceRowProps) => {
  return (
    <View className="flex-row items-center justify-between p-4 border-b border-white/5">
      <View className="flex-1 flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-white/10 items-center justify-center mr-3">
          <Text className="text-white/60 font-bold">{studentName.charAt(0)}</Text>
        </View>
        <Text className="text-white font-medium text-base">{studentName}</Text>
      </View>
      
      <View className="flex-row gap-2">
        {/* Present Button */}
        <Pressable 
          onPress={() => onStatusChange(status === 'present' ? 'none' : 'present')}
          className={`w-10 h-10 rounded-full items-center justify-center border ${
            status === 'present' ? 'bg-[#00FF9D]/20 border-[#00FF9D]/50' : 'bg-transparent border-white/10'
          }`}
        >
          <Text className={`font-bold text-lg ${status === 'present' ? 'text-[#00FF9D]' : 'text-white/40'}`}>✓</Text>
        </Pressable>

        {/* Absent Button */}
        <Pressable 
          onPress={() => onStatusChange(status === 'absent' ? 'none' : 'absent')}
          className={`w-10 h-10 rounded-full items-center justify-center border ${
            status === 'absent' ? 'bg-[#FF5E00]/20 border-[#FF5E00]/50' : 'bg-transparent border-white/10'
          }`}
        >
          <Text className={`font-bold text-lg ${status === 'absent' ? 'text-[#FF5E00]' : 'text-white/40'}`}>✕</Text>
        </Pressable>
        
        {/* Late Button */}
        <Pressable 
          onPress={() => onStatusChange(status === 'late' ? 'none' : 'late')}
          className={`w-10 h-10 rounded-full items-center justify-center border ${
            status === 'late' ? 'bg-[#FFB300]/20 border-[#FFB300]/50' : 'bg-transparent border-white/10'
          }`}
        >
          <Text className={`font-bold text-lg leading-5 pb-1 ${status === 'late' ? 'text-[#FFB300]' : 'text-white/40'}`}>◐</Text>
        </Pressable>
      </View>
    </View>
  );
});
AttendanceRow.displayName = 'AttendanceRow';
