import React from 'react';
import { Pressable, Text, PressableProps } from 'react-native';
import * as Haptics from 'expo-haptics';

interface NeumoButtonProps extends PressableProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'md' | 'lg';
}

export function NeumoButton({ 
  title, 
  variant = 'primary', 
  size = 'md',
  className,
  onPress,
  ...props 
}: NeumoButtonProps) {
  
  const handlePress = (e: any) => {
    // AGENTS.md: Haptic on every neumorphic press
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onPress) {
      onPress(e);
    }
  };

  let bgClass = 'bg-white/10';
  let textClass = 'text-white';
  
  if (variant === 'primary') {
    bgClass = 'bg-[#00FF9D]/20';
    textClass = 'text-[#00FF9D] font-bold';
  } else if (variant === 'danger') {
    bgClass = 'bg-[#FF5E00]/20';
    textClass = 'text-[#FF5E00] font-bold';
  }

  // AGENTS.md: 44x44px touch targets minimum
  const minHeight = size === 'lg' ? 56 : 44;

  return (
    <Pressable
      onPress={handlePress}
      className={`rounded-xl items-center justify-center border border-white/10 active:opacity-70 ${bgClass} ${className || ''}`}
      style={{ minHeight, minWidth: minHeight }}
      {...props}
    >
      <Text className={`${textClass} tracking-wide`}>
        {title}
      </Text>
    </Pressable>
  );
}
