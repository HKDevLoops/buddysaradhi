import React from 'react';
import { View, Text, Pressable } from 'react-native';

export type EntryType = 'payment' | 'invoice' | 'refund' | 'void';

interface LedgerRowProps {
  id: string;
  studentName: string;
  type: EntryType;
  amountMinor: number;
  date: string;
  reference?: string;
  onPress: () => void;
}

export const LedgerRow = React.memo(({ studentName, type, amountMinor, date, reference, onPress }: LedgerRowProps) => {
  const isCredit = type === 'payment' || type === 'refund';
  
  const formattedAmount = `₹ ${(amountMinor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  
  let icon = '₹';
  let iconBg = 'bg-[#00FF9D]/20';
  let iconText = 'text-[#00FF9D]';
  let titlePrefix = 'Payment from';

  if (type === 'invoice') {
    icon = '📄';
    iconBg = 'bg-[#00F0FF]/20';
    iconText = 'text-[#00F0FF]';
    titlePrefix = 'Invoice for';
  } else if (type === 'refund') {
    icon = '↺';
    iconBg = 'bg-[#FFB300]/20';
    iconText = 'text-[#FFB300]';
    titlePrefix = 'Refund to';
  } else if (type === 'void') {
    icon = '✕';
    iconBg = 'bg-[#FF5E00]/20';
    iconText = 'text-[#FF5E00]';
    titlePrefix = 'Voided entry';
  }

  return (
    <Pressable 
      onPress={onPress}
      className="flex-row items-center justify-between p-4 border-b border-white/5 active:bg-white/5"
    >
      <View className="flex-1 flex-row items-center">
        <View className={`w-10 h-10 rounded-full ${iconBg} items-center justify-center mr-3`}>
          <Text className={`font-bold ${iconText}`}>{icon}</Text>
        </View>
        <View className="flex-1 mr-2">
          <Text className="text-white font-medium text-base mb-0.5">
            {titlePrefix} {studentName}
          </Text>
          <View className="flex-row items-center">
            <Text className="text-white/40 text-xs">{date}</Text>
            {reference && (
              <>
                <Text className="text-white/20 text-[10px] mx-1">•</Text>
                <Text className="text-white/40 text-[10px]">{reference}</Text>
              </>
            )}
          </View>
        </View>
      </View>
      
      <View className="items-end">
        <Text className={`font-mono font-bold ${isCredit ? 'text-[#00FF9D]' : 'text-white'}`}>
          {isCredit ? '+' : ''}{formattedAmount}
        </Text>
        <Text className={`text-[10px] uppercase mt-1 ${isCredit ? 'text-[#00FF9D]/60' : 'text-white/40'}`}>
          {type}
        </Text>
      </View>
    </Pressable>
  );
});
LedgerRow.displayName = 'LedgerRow';
