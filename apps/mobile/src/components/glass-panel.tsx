import React from 'react';
import { View, ViewProps } from 'react-native';

interface GlassPanelProps extends ViewProps {
  intensity?: 'faint' | 'normal' | 'strong';
}

export function GlassPanel({ intensity = 'normal', className, style, ...props }: GlassPanelProps) {
  let bgClass = 'glass';
  if (intensity === 'faint') bgClass = 'glass-faint';
  if (intensity === 'strong') bgClass = 'glass-strong';

  return (
    <View 
      className={`rounded-2xl border border-white/10 ${bgClass} ${className || ''}`}
      style={style}
      {...props} 
    />
  );
}
