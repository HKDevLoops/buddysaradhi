import React from 'react';
import { View, ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';

interface GlassCardProps extends ViewProps {
  intensity?: 'faint' | 'normal' | 'strong';
  tint?: 'dark' | 'light' | 'default';
  blurIntensity?: number;
}

export function GlassCard({ 
  intensity = 'normal', 
  tint = 'dark',
  blurIntensity = 20,
  className, 
  style,
  children,
  ...props 
}: GlassCardProps) {
  let bgClass = 'bg-white/5';
  let borderClass = 'border-white/10';

  if (intensity === 'faint') {
    bgClass = 'bg-white/2';
    borderClass = 'border-white/5';
  } else if (intensity === 'strong') {
    bgClass = 'bg-white/10';
    borderClass = 'border-white/20';
  }

  return (
    <View 
      className={`rounded-2xl border overflow-hidden ${borderClass} ${className || ''}`}
      style={style}
      {...props}
    >
      <BlurView
        intensity={blurIntensity}
        tint={tint}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View className={`flex-1 ${bgClass}`}>
        {children}
      </View>
    </View>
  );
}
