/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction, setPinAction } from "@/server/actions/settings";
import { Shield, Lock, Fingerprint, Timer, Loader2 } from "lucide-react";
import { SecurityPanel } from "./security-panel";
import { NeumoToggle } from "./neumo-toggle";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { pinFormatError, PIN_MIN_LENGTH, PIN_MAX_LENGTH, PIN_INPUT_MAX_LENGTH } from "@buddysaradhi/shared";
import { useToast } from "@/components/ui/toast";
import { toAppErrorState } from "@/lib/app-errors";
import { cn } from "@/lib/utils";

import type { Settings } from "@/types/settings";

interface SecuritySectionProps {
  settings: Settings;
}

export function SecuritySection({ settings }: SecuritySectionProps) {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      const res = await updateSettingAction(field, value);
      if (!res.success) throw new Error(res.error || "Update failed");
    },
    onMutate: async ({ field, value }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previousSettings = queryClient.getQueryData(["settings"]);
      queryClient.setQueryData(["settings"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          data: {
            ...old.data,
            [field]: value,
          },
        };
      });
      return { previousSettings };
    },
    onError: (err, variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(["settings"], context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "success" | "error">("idle");
  const [passwordError, setPasswordError] = useState("");

  // Change-PIN flow (setPinAction existed with no caller — the button below
  // was dead). PIN-gated sensitive mutation per 10_Security.md §4 /
  // 08_Settings.md BR-SEC-02: current PIN re-verified server-side (with the
  // PIN ladder: lockout/wipe states surface as typed codes), new PIN
  // confirmed client-side before anything is posted.
  const toast = useToast();
  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinFormError, setPinFormError] = useState<string | null>(null);
  const [pinOk, setPinOk] = useState(false);

  const newPinFormatProblem = pinFormatError(newPin);
  const pinsMatch = newPin.length === 0 || newPin === confirmPin;

  const pinMutation = useMutation({
    mutationFn: (args: { next: string; current: string }) =>
      setPinAction(args.next, args.current.length > 0 ? args.current : undefined),
    onSuccess: (res) => {
      if (res.success !== true) {
        // Ladder states (PIN_LOCKED / PIN_WIPE_REQUIRED) arrive as server
        // copy via pinGateMessage — surface verbatim, keep the form open.
        const copy = res.error || "Could not change the PIN.";
        setPinFormError(copy);
        const code = (res as { code?: string }).code;
        toast.error(
          code === "PIN_LOCKED" ? "PIN locked — try again shortly" : "PIN not changed",
          copy,
        );
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setPinFormOpen(false);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setPinFormError(null);
      setPinOk(true);
      toast.success("PIN changed", "Use the new PIN next time you unlock.");
    },
    onError: (err) => {
      const copy = `${toAppErrorState(err).message} Nothing was changed.`;
      setPinFormError(copy);
      toast.error("PIN not changed", copy);
    },
  });

  const canChangePin =
    newPin.length > 0 &&
    newPinFormatProblem === null &&
    pinsMatch &&
    !pinMutation.isPending;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordStatus("error");
      setPasswordError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordStatus("error");
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    setPasswordLoading(true);
    setPasswordStatus("idle");
    setPasswordError("");

    try {
      const supabase = createSupabaseBrowser();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordStatus("error");
        setPasswordError(error.message);
      } else {
        setPasswordStatus("success");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setPasswordStatus("error");
      setPasswordError("An unexpected error occurred");
    } finally {
      setPasswordLoading(false);
    }
  };

  const sessionTimeoutMin = settings?.sessionTimeoutMin ?? 5;
  const biometricEnabled = settings?.biometricEnabled === 1;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--accent-primary)]" />
          Access Control
        </h3>

        <div className="space-y-4 max-w-2xl">
          <div className="flex items-center justify-between bg-[var(--surface-inset)] border border-[var(--border-default)] p-5 rounded-xl hover:bg-[var(--surface-raised)] transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent-primary)]/10 flex items-center justify-center shrink-0">
                <Lock className="w-6 h-6 text-[var(--accent-primary)]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">App PIN</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Requires a 4-digit PIN to open the app.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setPinFormOpen((open) => !open);
                setPinFormError(null);
                setPinOk(false);
              }}
              aria-expanded={pinFormOpen}
              aria-controls="change-pin-form"
              className="py-2.5 px-4 min-h-[44px] rounded-xl text-sm font-semibold text-[var(--accent-primary)] border border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent-primary)_15%,transparent)] hover:brightness-110 cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
            >
              {pinFormOpen ? "Close" : "Change PIN"}
            </button>
          </div>

          {pinFormOpen && (
            <form
              id="change-pin-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!canChangePin) return;
                pinMutation.mutate({ next: newPin, current: currentPin });
              }}
              className="mt-4 space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4"
            >
              <div>
                <label htmlFor="pin-current" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                  Current PIN <span className="normal-case font-normal">(leave blank for first-time setup)</span>
                </label>
                <input
                  id="pin-current"
                  type="password"
                  value={currentPin}
                  onChange={(e) => {
                    setCurrentPin(e.target.value);
                    setPinFormError(null);
                  }}
                  inputMode="numeric"
                  maxLength={PIN_INPUT_MAX_LENGTH}
                  autoComplete="off"
                  placeholder="••••"
                  className="neumo-inset w-full px-4 py-3 min-h-[44px] text-sm text-center tracking-[0.5em] font-mono text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
                />
              </div>
              <div>
                <label htmlFor="pin-new" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                  New PIN ({PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits)
                </label>
                <input
                  id="pin-new"
                  type="password"
                  value={newPin}
                  onChange={(e) => {
                    setNewPin(e.target.value);
                    setPinFormError(null);
                    setPinOk(false);
                  }}
                  inputMode="numeric"
                  maxLength={PIN_INPUT_MAX_LENGTH}
                  autoComplete="off"
                  placeholder="••••"
                  aria-describedby={newPinFormatProblem ? "pin-new-format" : undefined}
                  aria-invalid={newPinFormatProblem ? true : undefined}
                  className="neumo-inset w-full px-4 py-3 min-h-[44px] text-sm text-center tracking-[0.5em] font-mono text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
                />
                {newPinFormatProblem && (
                  <p id="pin-new-format" className="text-[var(--danger)] text-xs mt-2">
                    {newPinFormatProblem}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="pin-confirm" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                  Confirm new PIN
                </label>
                <input
                  id="pin-confirm"
                  type="password"
                  value={confirmPin}
                  onChange={(e) => {
                    setConfirmPin(e.target.value);
                    setPinFormError(null);
                  }}
                  inputMode="numeric"
                  maxLength={PIN_INPUT_MAX_LENGTH}
                  autoComplete="off"
                  placeholder="••••"
                  aria-invalid={!pinsMatch ? true : undefined}
                  className="neumo-inset w-full px-4 py-3 min-h-[44px] text-sm text-center tracking-[0.5em] font-mono text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
                />
                {!pinsMatch && (
                  <p className="text-[var(--danger)] text-xs mt-2">PINs do not match.</p>
                )}
              </div>

              {pinOk && (
                <p role="status" className="text-[var(--success)] text-sm font-semibold">PIN changed successfully.</p>
              )}
              {pinFormError && (
                <p role="alert" className="text-[var(--danger)] text-sm font-semibold">{pinFormError}</p>
              )}

              <button
                type="submit"
                disabled={!canChangePin}
                aria-busy={pinMutation.isPending}
                className={cn(
                  "w-full min-h-[44px] neumo-raised py-3 rounded-xl text-sm font-bold transition-colors",
                  canChangePin
                    ? "text-[var(--accent-on-primary)] bg-gradient-to-r from-[var(--success)] to-[var(--info)]"
                    : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                )}
              >
                {pinMutation.isPending ? "Changing PIN…" : "Save new PIN"}
              </button>
            </form>
          )}

          <div className="flex items-center justify-between bg-[var(--surface-inset)] border border-[var(--border-default)] p-5 rounded-xl hover:bg-[var(--surface-raised)] transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--info)]/10 flex items-center justify-center shrink-0">
                <Fingerprint className="w-6 h-6 text-[var(--info)]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Biometric Unlock</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Use FaceID or Fingerprint instead of PIN.</p>
              </div>
            </div>
            <NeumoToggle
              label="Biometric unlock"
              checked={biometricEnabled}
              onChange={() => updateMutation.mutate({ field: "biometricEnabled", value: biometricEnabled ? 0 : 1 })}
            />
          </div>

          <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4 bg-[var(--surface-inset)] border border-[var(--border-default)] p-5 rounded-xl hover:bg-[var(--surface-raised)] transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--warning)]/10 flex items-center justify-center shrink-0">
                <Timer className="w-6 h-6 text-[var(--warning)]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Auto-Lock Timeout</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Lock the app automatically after a period of inactivity.</p>
              </div>
            </div>

            <div className="relative w-full sm:w-44">
              <select
                value={sessionTimeoutMin}
                onChange={(e) => updateMutation.mutate({ field: "sessionTimeoutMin", value: parseInt(e.target.value) })}
                aria-label="Auto-lock timeout"
                className="neumo-inset w-full pl-4 pr-10 py-3 text-sm text-[var(--text-primary)] rounded-xl appearance-none cursor-pointer focus:outline-none focus:border-[var(--warning)] focus:ring-1 focus:ring-[var(--warning)]"
              >
                <option value={1} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">1 minute</option>
                <option value={5} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">5 minutes</option>
                <option value={15} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">15 minutes</option>
                <option value={30} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">30 minutes</option>
                <option value={60} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">1 hour</option>
                <option value={0} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Never</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Lock className="w-5 h-5 text-[var(--accent-primary)]" />
          Change Password
        </h3>
        
        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-lg">
          <div>
            <label htmlFor="security-newPassword" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">New Password</label>
            <input
              id="security-newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              className="neumo-inset w-full px-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
            />
          </div>
          <div>
            <label htmlFor="security-confirmPassword" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Confirm New Password</label>
            <input
              id="security-confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
              className="neumo-inset w-full px-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
            />
          </div>

          {passwordStatus === "success" && (
            <p className="text-[var(--success)] text-sm font-semibold">Password updated successfully.</p>
          )}
          {passwordStatus === "error" && (
            <p className="text-[var(--danger)] text-sm font-semibold">{passwordError}</p>
          )}

          <button
            type="submit"
            disabled={passwordLoading || newPassword.length < 8}
            className="py-3 px-6 rounded-xl text-sm font-bold text-[var(--accent-primary)] border border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] shadow-[0_0_14px_color-mix(in_srgb,var(--accent-primary)_20%,transparent)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            {passwordLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update Password"}
          </button>
        </form>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <SecurityPanel />
    </section>
  );
}
