"use client";

import { useState } from "react";
import { useAttendanceStore } from "@/stores/attendance-store";
import { AttendanceSession } from "@buddysaradhi/shared";
import { lockSessionAction } from "@/server/actions/attendance";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Lock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";


interface LockSessionSheetProps {
  session: AttendanceSession | null;
}

export function LockSessionSheet({ session }: LockSessionSheetProps) {
  const { isLockSheetOpen, setLockSheetOpen, selectedDateIso, selectedBatch } = useAttendanceStore();
  const [pin, setPin] = useState("");
  const queryClient = useQueryClient();

  const isLocked = session?.locked_at != null;

  const mutation = useMutation({
    mutationFn: (subPin: string) => lockSessionAction(session!.id, subPin),
    onSuccess: (res) => {
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ['attendance'] });
        setLockSheetOpen(false);
        setPin("");
      }
    }
  });

  if (!isLockSheetOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-[#0C081A]/80 backdrop-blur-sm transition-opacity" 
        onClick={() => setLockSheetOpen(false)}
      />

      {/* Sheet Content - .glass-strong */}
      <div className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-md shadow-2xl p-6 overflow-hidden">
        
        {/* Glow effect */}
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-[radial-gradient(ellipse_at_center,rgba(0,184,255,0.1)_0%,transparent_70%)] blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Lock className="w-5 h-5 text-[var(--accent-cyan)]" />
            Lock Session
          </h2>
          <button 
            onClick={() => setLockSheetOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface-glass-strong)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLocked ? (
          <div className="text-center py-8 space-y-4">
            <Lock className="w-12 h-12 text-[var(--accent-emerald)] mx-auto opacity-80" />
            <p className="text-[var(--text-primary)] text-lg font-medium">Session is already locked.</p>
            <p className="text-[var(--text-muted)] text-sm">Attendance records for this date and batch cannot be modified without unlocking.</p>
            <button 
              onClick={() => setLockSheetOpen(false)}
              className="mt-4 neumo-raised px-6 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-emerald)] transition-colors"
            >
              Close
            </button>
          </div>
        ) : !session ? (
          <div className="text-center py-8 space-y-4">
            <AlertTriangle className="w-12 h-12 text-[var(--accent-amber)] mx-auto opacity-80" />
            <p className="text-[var(--text-primary)] text-lg font-medium">No active session to lock.</p>
            <p className="text-[var(--text-muted)] text-sm">Please mark attendance for at least one student before locking the session.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-[var(--bg-surface-inset)] rounded-xl p-4 border border-[var(--border-default)]">
              <p className="text-sm text-[var(--text-secondary)] mb-2">
                Locking the session prevents further modifications. You must provide your PIN (fallback: 1234) to confirm this action.
              </p>
              <div className="text-xs text-[var(--text-muted)] flex flex-col gap-1">
                <span>Date: {selectedDateIso}</span>
                <span>Batch: {selectedBatch === 'all' ? 'All Batches' : selectedBatch}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Security PIN</label>
              <input 
                type="password" 
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                maxLength={4}
                autoFocus
                placeholder="••••"
                className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-2xl text-center tracking-[1em] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-cyan)]"
              />
              {mutation.error && (
                <p className="text-[var(--accent-flare)] text-xs mt-2 text-center">{mutation.error.message}</p>
              )}
            </div>

            <button 
              onClick={() => mutation.mutate(pin)}
              disabled={pin.length < 4 || mutation.isPending}
              className={cn(
                "w-full neumo-raised py-3 rounded-xl text-sm font-bold text-[#0a0a1a] transition-all",
                pin.length >= 4 
                  ? "bg-gradient-to-r from-[var(--accent-emerald)] to-[var(--accent-cyan)] shadow-[0_0_15px_rgba(0,255,157,0.4)]"
                  : "bg-[var(--bg-surface-inset)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
              )}
            >
              {mutation.isPending ? "Locking..." : "Confirm & Lock"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
