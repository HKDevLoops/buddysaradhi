"use client";

import React, { useState } from 'react';
import { Delete, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PinPadProps {
  onSuccess: () => void;
  isLoading?: boolean;
  expectedPin?: string; // In a real app, this would be validated server-side, but for mockup purposes
}

export function PinPad({ onSuccess, isLoading, expectedPin = "1234" }: PinPadProps) {
  const [pin, setPin] = useState<string>("");
  const [error, setError] = useState(false);


  const handlePress = (num: string) => {
    if (pin.length < 4 && !isLoading) {
      const newPin = pin + num;
      setPin(newPin);
      setError(false);
      
      if (newPin.length === 4) {
        if (newPin === expectedPin) {
          onSuccess();
        } else {
          setError(true);
          setTimeout(() => {
            setPin("");
            setError(false);
          }, 500);
        }
      }
    }
  };

  const handleDelete = () => {
    if (!isLoading) {
      setPin(prev => prev.slice(0, -1));
      setError(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-sm mx-auto">
      <div className="flex gap-4 mb-8 h-4">
        {[0, 1, 2, 3].map((i) => (
          <div 
            key={i} 
            className={cn(
              "w-4 h-4 rounded-full transition-all duration-200",
              pin.length > i ? "bg-[var(--bg-surface)] scale-100" : "bg-[var(--surface-glass-strong)] scale-75",
              error && "bg-[var(--accent-flare)] animate-shake"
            )} 
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 sm:gap-6 w-full max-w-[280px]">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            onClick={() => handlePress(num.toString())}
            disabled={isLoading}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full btn-glass glass hover:bg-[var(--surface-glass-strong)] active:scale-95 transition-all flex items-center justify-center text-2xl font-light text-[var(--text-primary)] disabled:opacity-50 mx-auto"
          >
            {num}
          </button>
        ))}
        <div />
        <button
          onClick={() => handlePress("0")}
          disabled={isLoading}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-full btn-glass glass hover:bg-[var(--surface-glass-strong)] active:scale-95 transition-all flex items-center justify-center text-2xl font-light text-[var(--text-primary)] disabled:opacity-50 mx-auto"
        >
          0
        </button>
        <button
          onClick={handleDelete}
          disabled={isLoading || pin.length === 0}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-full btn-glass glass hover:bg-[var(--accent-flare)]/10 text-[var(--text-muted)] hover:text-[var(--accent-flare)] active:scale-95 transition-all flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)] mx-auto"
        >
          <Delete className="w-6 h-6" />
        </button>
      </div>

      {isLoading && (
        <div className="mt-8 flex items-center gap-2 text-[var(--text-muted)] text-sm animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin" /> Verifying...
        </div>
      )}
    </div>
  );
}
