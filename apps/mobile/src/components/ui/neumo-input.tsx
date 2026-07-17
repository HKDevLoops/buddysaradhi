import React, { useState } from 'react';
import { TextInput, TextInputProps, View, Text } from 'react-native';

interface NeumoInputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
}

export function NeumoInput({ label, error, helperText, className, onFocus, onBlur, ...props }: NeumoInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = (e: any) => {
    setIsFocused(true);
    onFocus && onFocus(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    onBlur && onBlur(e);
  };

  let ringClass = 'border border-white/5';
  if (isFocused) {
    ringClass = 'border border-[#00F0FF]/40 shadow-[inset_0_0_0_2px_rgba(0,240,255,0.4)] bg-[#00F0FF]/5';
  }
  if (error) {
    ringClass = 'border border-[#FF5E00]/40 shadow-[inset_0_0_0_2px_rgba(255,94,0,0.4)] bg-[#FF5E00]/5';
  }

  return (
    <View className={`w-full ${className || ''}`}>
      {label && (
        <Text className="text-white/60 text-xs font-medium mb-1 px-1">
          {label}
        </Text>
      )}
      
      <View className={`rounded-xl bg-[#0a0a1a]/80 overflow-hidden ${ringClass}`}>
        <TextInput
          className="px-3 py-3 text-white text-base min-h-[44px]"
          placeholderTextColor="rgba(255,255,255,0.4)"
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
      </View>
      
      {(error || helperText) && (
        <Text className={`text-xs mt-1 px-1 ${error ? 'text-[#FF5E00]' : 'text-white/40'}`}>
          {error || helperText}
        </Text>
      )}
    </View>
  );
}
