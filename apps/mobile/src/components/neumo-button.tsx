import React from 'react';
import { Pressable, Text, PressableProps } from 'react-native';
import * as Haptics from 'expo-haptics';

interface NeumoButtonProps extends PressableProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export function NeumoButton({ title, variant = 'primary', className, onPress, ...props }: NeumoButtonProps) {
  const handlePress = (e: any) => {
    Haptics.impactAsync(
      variant === 'danger' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light
    );
    if (onPress) onPress(e);
  };

  let bgClass = 'neumo-raised';
  let textClass = 'text-accent-cyan';
  
  if (variant === 'primary') {
    textClass = 'text-accent-emerald';
  } else if (variant === 'danger') {
    textClass = 'text-accent-flare';
  }

  return (
    <Pressable
      onPress={handlePress}
      className={`rounded-xl px-4 py-3 min-h-[44px] items-center justify-center active:neumo-pressed ${bgClass} ${className || ''}`}
      {...props}
    >
      <Text className={`font-semibold text-base ${textClass}`}>{title}</Text>
    </Pressable>
  );
}
