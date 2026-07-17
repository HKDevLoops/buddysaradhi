import React, { useEffect, useState, useRef } from 'react';
import { View, Text } from 'react-native';
import { GlassCard } from '../ui/glass-card';

// Animated counter component
function AnimatedCounter({ value, isCurrency = false }: { value: number, isCurrency?: boolean }) {
  // Simple fake animated counter for now, in a real app this uses react-native-reanimated
  const [displayValue, setDisplayValue] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    let start = prevValue.current;
    let end = value;
    if (start === end) {
      setDisplayValue(end);
      return;
    }
    
    let startTime: number | null = null;
    const duration = 400; // 400ms count-up
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = Math.floor(start + (end - start) * easeProgress);
      
      setDisplayValue(current);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        setDisplayValue(end);
        prevValue.current = end;
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value]);

  const formatted = isCurrency 
    ? `₹ ${(displayValue / 100).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
    : displayValue.toString();

  return <Text className="text-white text-2xl font-bold font-mono tracking-tight">{formatted}</Text>;
}

interface KpiCardProps {
  label: string;
  valueMinor?: number;
  valueCount?: number;
  deltaPct?: number;
  deltaLabel?: string;
  caption?: string;
  accent: 'emerald' | 'cyan' | 'flare' | 'amber' | 'violet';
  empty?: boolean;
}

const accentColors: Record<string, string> = {
  emerald: 'text-[#00FF9D]',
  cyan: 'text-[#00F0FF]',
  flare: 'text-[#FF5E00]',
  amber: 'text-[#FFB300]',
  violet: 'text-[#B388FF]',
};

export function KpiCard({ 
  label, 
  valueMinor, 
  valueCount, 
  deltaPct, 
  deltaLabel, 
  caption, 
  accent, 
  empty 
}: KpiCardProps) {
  
  const accentTextClass = accentColors[accent];
  const valueToAnimate = valueMinor !== undefined ? valueMinor : (valueCount || 0);
  const isCurrency = valueMinor !== undefined;

  return (
    <GlassCard intensity="strong" className="p-4 flex-col justify-between min-w-[280px] h-32 mr-3">
      <View>
        <Text className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
          {label}
        </Text>
        {empty ? (
          <Text className={`text-2xl font-bold font-mono tracking-tight ${accentTextClass}`}>
            {isCurrency ? '₹ 0.00' : '0'}
          </Text>
        ) : (
          <AnimatedCounter value={valueToAnimate} isCurrency={isCurrency} />
        )}
      </View>
      
      <View className="mt-2">
        {caption ? (
          <Text className="text-white/40 text-[10px]">{caption}</Text>
        ) : deltaPct !== undefined && deltaLabel ? (
          <View className="flex-row items-center">
            <Text className={`text-xs font-medium mr-1 ${deltaPct >= 0 ? 'text-[#00FF9D]' : 'text-[#FF5E00]'}`}>
              {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(deltaPct)}%
            </Text>
            <Text className="text-white/40 text-xs">{deltaLabel}</Text>
          </View>
        ) : null}
      </View>
    </GlassCard>
  );
}
