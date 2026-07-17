import React from 'react';
import { View, Text, ViewProps } from 'react-native';

export type StatusType = 
  | 'paid' | 'partial' | 'unpaid' | 'overdue' | 'no_dues'
  | 'present' | 'absent' | 'late' | 'excused' | 'holiday'
  | 'postpaid' | 'prepaid' | 'mixed'
  | 'active' | 'inactive' | 'graduated' | 'archived';

interface StatusBadgeProps extends ViewProps {
  status: StatusType;
  label?: string;
  size?: 'sm' | 'md';
}

const statusConfig: Record<StatusType, { bg: string; text: string; defaultLabel: string }> = {
  paid: { bg: 'bg-[#00FF9D]/20', text: 'text-[#00FF9D]', defaultLabel: 'Paid' },
  present: { bg: 'bg-[#00FF9D]/20', text: 'text-[#00FF9D]', defaultLabel: 'Present' },
  postpaid: { bg: 'bg-[#00FF9D]/20', text: 'text-[#00FF9D]', defaultLabel: 'Postpaid' },
  active: { bg: 'bg-[#00FF9D]/20', text: 'text-[#00FF9D]', defaultLabel: 'Active' },
  
  partial: { bg: 'bg-[#FFB300]/20', text: 'text-[#FFB300]', defaultLabel: 'Partial' },
  late: { bg: 'bg-[#FFB300]/20', text: 'text-[#FFB300]', defaultLabel: 'Late' },
  prepaid: { bg: 'bg-[#FFB300]/20', text: 'text-[#FFB300]', defaultLabel: 'Prepaid' },

  unpaid: { bg: 'bg-[#FF5E00]/20', text: 'text-[#FF5E00]', defaultLabel: 'Unpaid' },
  absent: { bg: 'bg-[#FF5E00]/20', text: 'text-[#FF5E00]', defaultLabel: 'Absent' },
  overdue: { bg: 'bg-[#FF5E00]/20', text: 'text-[#FF5E00]', defaultLabel: 'Overdue' },
  
  excused: { bg: 'bg-[#B388FF]/20', text: 'text-[#B388FF]', defaultLabel: 'Excused' },
  mixed: { bg: 'bg-[#B388FF]/20', text: 'text-[#B388FF]', defaultLabel: 'Mixed' },

  holiday: { bg: 'bg-[#00F0FF]/20', text: 'text-[#00F0FF]', defaultLabel: 'Holiday' },

  inactive: { bg: 'bg-white/10', text: 'text-white/60', defaultLabel: 'Inactive' },
  graduated: { bg: 'bg-white/10', text: 'text-white/60', defaultLabel: 'Graduated' },
  archived: { bg: 'bg-white/10', text: 'text-white/60', defaultLabel: 'Archived' },
  no_dues: { bg: 'bg-white/10', text: 'text-white/60', defaultLabel: 'No Dues' },
};

export function StatusBadge({ status, label, size = 'md', className, ...props }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.no_dues;
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <View 
      className={`rounded-full flex-row items-center justify-center ${config.bg} ${padding} ${className || ''}`}
      {...props}
    >
      <Text className={`font-medium ${config.text} ${textSize}`}>
        {label || config.defaultLabel}
      </Text>
    </View>
  );
}
