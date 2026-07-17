"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction } from "@/server/actions/settings";
import { Shield, Lock, Fingerprint, Timer, Loader2 } from "lucide-react";
import { SecurityPanel } from "./security-panel";
import { NeumoToggle } from "./neumo-toggle";
import { createSupabaseBrowser } from "@/lib/supabase/client";

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
    } catch (err) {
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
          <div className="flex items-center justify-between glass-card p-5 rounded-xl">
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
              className="py-2.5 px-4 rounded-xl text-sm font-semibold text-[var(--accent-primary)] border border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent-primary)_15%,transparent)] hover:brightness-110 cursor-pointer transition-all"
            >
              Change PIN
            </button>
          </div>

          <div className="flex items-center justify-between glass-card p-5 rounded-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent-violet)]/10 flex items-center justify-center shrink-0">
                <Fingerprint className="w-6 h-6 text-[var(--accent-violet)]" />
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

          <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4 glass-card p-5 rounded-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent-amber)]/10 flex items-center justify-center shrink-0">
                <Timer className="w-6 h-6 text-[var(--accent-amber)]" />
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
                className="neumo-inset w-full pl-4 pr-10 py-3 text-sm text-[var(--text-primary)] rounded-xl appearance-none cursor-pointer focus:outline-none focus:border-[var(--accent-amber)]"
              >
                <option value={1} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">1 minute</option>
                <option value={5} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">5 minutes</option>
                <option value={15} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">15 minutes</option>
                <option value={30} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">30 minutes</option>
                <option value={60} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">1 hour</option>
                <option value={0} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Never</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

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
              className="neumo-inset w-full px-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)]"
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
              className="neumo-inset w-full px-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)]"
            />
          </div>

          {passwordStatus === "success" && (
            <p className="text-[var(--accent-emerald)] text-sm font-semibold">Password updated successfully.</p>
          )}
          {passwordStatus === "error" && (
            <p className="text-[var(--accent-flare)] text-sm font-semibold">{passwordError}</p>
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

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <SecurityPanel />
    </section>
  );
}
