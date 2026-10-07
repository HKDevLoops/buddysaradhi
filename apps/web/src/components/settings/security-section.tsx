"use client";

// Implements: 08_Settings.md §6.2.6 (Security fields), §15 SR-04 (change PIN
// re-verifies the current PIN) and SR-05 (disabling biometric requires a PIN),
// §11 EC-02 (reject an obvious PIN) + EC-03 (the ladder's states come back as
// typed copy, not a silent failure); 10_Security.md §3 (PIN ladder); AGENTS.md
// §2 Rule 9 (every outcome stated) + Rule 10 (44px targets, label per control)
// + §6.1 (no `any`).
//
// WHAT CHANGED AND WHY (all four were defects, not preferences):
//
// - `biometricEnabled` went through a bare `updateSettingAction`, which has no
//   PIN gate of any kind. SR-05 says disabling it requires the PIN precisely so
//   a person who lost a finger can turn it off; a scripted request could turn it
//   off with nothing asked. It now goes through `setBiometricEnabledAction`,
//   which verifies the PIN with the ladder on the server.
// - The same toggle promised "Use FaceID or Fingerprint instead of PIN" on a
//   build with no lock screen. The copy now says what is true.
// - The card said "Requires a 4-digit PIN". The stored value is 4 to 8 digits,
//   so a 6-digit PIN holder read a false statement about their own security.
// - The "Danger Zone" that used to hang off the bottom of this section was a
//   second copy of Data & Privacy's delete-all flow (see `security-panel.tsx`,
//   now deleted). Delete-all is not a Security field; §6.2.6 does not list it.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction, setBiometricEnabledAction, setPinAction } from "@/server/actions/settings";
import { Shield, Lock, Fingerprint, Timer, Loader2, KeyRound } from "lucide-react";
import { NeumoToggle } from "./neumo-toggle";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import {
  pinFormatError,
  PIN_MIN_LENGTH,
  PIN_MAX_LENGTH,
  PIN_INPUT_MAX_LENGTH,
} from "@buddysaradhi/shared";
import { obviousPinError } from "@/lib/settings-gates";
import { useToast } from "@/components/ui/toast";
import { toAppErrorState } from "@/lib/app-errors";
import { cn } from "@/lib/utils";

import type { Settings } from "@/types/settings";

interface SecuritySectionProps {
  settings: Settings;
}

const inputCls =
  "neumo-inset w-full px-4 py-3 min-h-[44px] text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]";

export function SecuritySection({ settings }: SecuritySectionProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "success" | "error">("idle");
  const [passwordError, setPasswordError] = useState("");

  // Change-PIN flow. SR-04: the current PIN is re-verified on the server
  // (with the PIN ladder, so lockout and wipe arrive as typed states) before
  // the new hash is ever written.
  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinFormError, setPinFormError] = useState<string | null>(null);
  const [pinOk, setPinOk] = useState(false);

  // SR-05: the PIN gate for the biometric toggle, inline rather than in a
  // sheet because it is one field and one button.
  const [biometricGateOpen, setBiometricGateOpen] = useState(false);
  const [biometricPin, setBiometricPin] = useState("");
  const [biometricError, setBiometricError] = useState<string | null>(null);

  const newPinFormatProblem = pinFormatError(newPin);
  const currentPinProblem = currentPin.length > 0 ? pinFormatError(currentPin) : null;
  // 08 §11 EC-02, client half. `pinFormatError` only knows the FORMAT rule, so
  // `123456` armed this form and the server accepted it. The strength rule is
  // the same function the server runs (`obviousPinError`), so the reason on
  // screen and the reason on the wire are the same sentence. It is deliberately
  // NOT applied to `currentPin` or `biometricPin`: refusing to VERIFY a PIN a
  // tutor already has would lock them out of their own books.
  const newPinStrengthProblem = newPin.length > 0 ? obviousPinError(newPin) : null;
  const newPinProblem = newPinFormatProblem ?? newPinStrengthProblem;
  const pinsMatch = newPin.length === 0 || newPin === confirmPin;
  const biometricPinProblem = biometricPin.length > 0 ? pinFormatError(biometricPin) : null;

  const pinMutation = useMutation({
    mutationFn: (args: { next: string; current: string }) =>
      setPinAction(args.next, args.current.length > 0 ? args.current : undefined),
    onSuccess: (res) => {
      if (res.success !== true) {
        const copy = res.error || "Could not change the PIN.";
        setPinFormError(copy);
        const code = (res as { code?: string }).code;
        toast.error(
          code === "PIN_LOCKED" ? "PIN locked, try again shortly" : "PIN not changed",
          copy,
        );
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["pin-status"] });
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

  const biometricMutation = useMutation({
    mutationFn: (next: boolean) => setBiometricEnabledAction(next, biometricPin),
    onSuccess: (res) => {
      if (res.success !== true) {
        setBiometricError(res.error || "Nothing was changed.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setBiometricGateOpen(false);
      setBiometricPin("");
      setBiometricError(null);
      toast.success(
        res.enabled ? "Biometric unlock on" : "Biometric unlock off",
        res.enabled
          ? "Stored for the app lock screen. This build has no lock screen yet, so nothing changes on screen today."
          : "Stored. Biometric unlock is off for this account.",
      );
    },
    onError: (err) => {
      setBiometricError(`${toAppErrorState(err).message} Nothing was changed.`);
    },
  });

  const canChangePin =
    newPin.length > 0 && newPinProblem === null && pinsMatch && !pinMutation.isPending;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordStatus("error");
      setPasswordError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordStatus("error");
      setPasswordError("Password must be at least 8 characters.");
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
    } catch (caught) {
      setPasswordStatus("error");
      setPasswordError(toAppErrorState(caught).message);
    } finally {
      setPasswordLoading(false);
    }
  };

  const timeoutMutation = useMutation({
    mutationFn: async (minutes: number) => {
      const res = await updateSettingAction("sessionTimeoutMin", minutes);
      if (!res.success) throw new Error(res.error || "Could not save the timeout.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
    onError: (err) => toast.error("Timeout not saved", toAppErrorState(err).message),
  });

  const sessionTimeoutMin = settings?.sessionTimeoutMin ?? 5;
  const biometricEnabled = settings?.biometricEnabled === 1;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--accent-primary)]" aria-hidden="true" />
          Access Control
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-5 max-w-[68ch]">
          Your app PIN is what proves a sensitive action is you and not someone at an open screen.
          It gates voids, attendance unlocks, backups and exports.
        </p>

        <div className="space-y-4 max-w-2xl">
          <div className="rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}>
                  <Lock className="w-6 h-6 text-[var(--accent-primary)]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">App PIN</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {PIN_MIN_LENGTH} to {PIN_MAX_LENGTH} digits. You will be asked for it before a
                    void, an attendance unlock, a backup or an export.
                  </p>
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
                className="neumo-raised px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold text-[var(--accent-primary)] cursor-pointer transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
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
                className="mt-5 space-y-4 border-t border-[var(--border-default)] pt-5"
              >
                <p className="text-xs text-[var(--text-secondary)] max-w-[68ch]">
                  Enter your current PIN, then the new one twice. Changing it does not affect your
                  backup passphrase.
                </p>
                <div>
                  <label htmlFor="pin-current" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Current PIN <span className="normal-case font-normal">(leave blank only if you have never set one)</span>
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
                    placeholder="Your current PIN"
                    aria-invalid={currentPinProblem ? true : undefined}
                    aria-describedby={currentPinProblem ? "pin-current-format" : undefined}
                    className={inputCls}
                  />
                  {currentPinProblem && (
                    <p id="pin-current-format" className="text-[var(--danger)] text-xs mt-2">{currentPinProblem}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="pin-new" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    New PIN ({PIN_MIN_LENGTH} to {PIN_MAX_LENGTH} digits)
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
                    placeholder="New PIN"
                    aria-invalid={newPinProblem ? true : undefined}
                    aria-describedby={newPinProblem ? "pin-new-format" : undefined}
                    className={inputCls}
                  />
                  {newPinProblem && (
                    <p id="pin-new-format" className="text-[var(--danger)] text-xs mt-2">{newPinProblem}</p>
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
                    placeholder="Repeat the new PIN"
                    aria-invalid={!pinsMatch ? true : undefined}
                    className={inputCls}
                  />
                  {!pinsMatch && (
                    <p className="text-[var(--danger)] text-xs mt-2">The two new PINs do not match.</p>
                  )}
                </div>

                {pinOk && (
                  <p role="status" className="text-[var(--success)] text-sm font-semibold">PIN changed.</p>
                )}
                {pinFormError && (
                  <p role="alert" className="text-[var(--danger)] text-sm font-semibold">{pinFormError}</p>
                )}

                <button
                  type="submit"
                  disabled={!canChangePin}
                  aria-busy={pinMutation.isPending}
                  className={cn(
                    "w-full neumo-raised py-3 min-h-[44px] rounded-xl text-sm font-bold transition-colors",
                    canChangePin
                      ? "text-[var(--accent-on-primary)] bg-[var(--success)] cursor-pointer hover:brightness-110"
                      : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-60 cursor-not-allowed",
                  )}
                >
                  {pinMutation.isPending ? "Changing PIN…" : "Save new PIN"}
                </button>
              </form>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--info) 12%, transparent)" }}>
                  <Fingerprint className="w-6 h-6 text-[var(--info)]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Biometric Unlock</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[42ch]">
                    Turn this off with your PIN, so a lost finger or a sold device still leaves you a
                    way in. This build has no lock screen yet, so the choice is stored for when it
                    does.
                  </p>
                </div>
              </div>
              <NeumoToggle
                label="Biometric unlock"
                checked={biometricEnabled}
                onChange={() => {
                  if (biometricEnabled) {
                    // SR-05: turning it OFF is the gated direction.
                    setBiometricGateOpen((open) => !open);
                    setBiometricError(null);
                    return;
                  }
                  // Turning it ON is also gated here. §6.2.6 wants a biometric
                  // challenge; web has no enrolment to challenge against, so the
                  // PIN is the gate. A PIN-less enable would be a downgrade.
                  setBiometricGateOpen(true);
                  setBiometricError(null);
                }}
              />
            </div>

            {biometricGateOpen && (
              <div className="mt-5 space-y-4 border-t border-[var(--border-default)] pt-5">
                <p className="text-xs text-[var(--text-secondary)] max-w-[68ch]">
                  {biometricEnabled
                    ? "Confirm with your PIN so nobody else can lock you out of your own account."
                    : "Confirm with your PIN to turn biometric unlock on."}
                </p>
                <div>
                  <label htmlFor="biometric-pin" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Your app PIN
                  </label>
                  <input
                    id="biometric-pin"
                    type="password"
                    value={biometricPin}
                    onChange={(e) => {
                      setBiometricPin(e.target.value);
                      setBiometricError(null);
                    }}
                    inputMode="numeric"
                    maxLength={PIN_INPUT_MAX_LENGTH}
                    autoComplete="off"
                    placeholder="Your PIN"
                    aria-invalid={biometricPinProblem ? true : undefined}
                    className={`${inputCls} sm:w-64 text-center tracking-[0.4em] font-mono`}
                  />
                  {biometricPinProblem && (
                    <p className="text-[var(--danger)] text-xs mt-2">{biometricPinProblem}</p>
                  )}
                </div>
                {biometricError && (
                  <p role="alert" className="text-[var(--danger)] text-sm font-semibold">{biometricError}</p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={biometricPinProblem !== null || biometricMutation.isPending}
                    aria-busy={biometricMutation.isPending}
                    onClick={() => biometricMutation.mutate(!biometricEnabled)}
                    className="neumo-raised px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:brightness-110"
                  >
                    {biometricMutation.isPending
                      ? "Saving…"
                      : biometricEnabled
                        ? "Turn biometric unlock off"
                        : "Turn biometric unlock on"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBiometricGateOpen(false);
                      setBiometricPin("");
                      setBiometricError(null);
                    }}
                    className="px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-medium text-[var(--text-secondary)] cursor-pointer transition-colors hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)" }}>
                  <Timer className="w-6 h-6 text-[var(--warning)]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Auto-Lock Timeout</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[42ch]">
                    Stored now, enforced when the app lock screen ships. Until then your PIN is still
                    asked for every sensitive action, whatever this says.
                  </p>
                </div>
              </div>

              <div className="relative w-full sm:w-44">
                <select
                  value={sessionTimeoutMin}
                  onChange={(e) => timeoutMutation.mutate(parseInt(e.target.value, 10))}
                  disabled={timeoutMutation.isPending}
                  aria-label="Auto-lock timeout in minutes"
                  className={cn(inputCls, "pl-4 pr-10 appearance-none cursor-pointer focus:border-[var(--warning)] focus:ring-[var(--warning)]")}
                >
                  <option value={1}>After 1 minute</option>
                  <option value={5}>After 5 minutes</option>
                  <option value={15}>After 15 minutes</option>
                  <option value={30}>After 30 minutes</option>
                  <option value={60}>After 1 hour</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20" aria-hidden="true"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-[var(--accent-primary)]" aria-hidden="true" />
          Sign-in Password
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-5 max-w-[68ch]">
          This is the password you type to sign in. Your app PIN is separate and much shorter.
        </p>

        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-lg">
          <div>
            <label htmlFor="security-newPassword" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">New password</label>
            <input
              id="security-newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              minLength={8}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="security-confirmPassword" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Confirm new password</label>
            <input
              id="security-confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Type it again"
              autoComplete="new-password"
              required
              minLength={8}
              className={inputCls}
            />
          </div>

          {passwordStatus === "success" && (
            <p role="status" className="text-[var(--success)] text-sm font-semibold">Password updated.</p>
          )}
          {passwordStatus === "error" && (
            <p role="alert" className="text-[var(--danger)] text-sm font-semibold">{passwordError}</p>
          )}

          <button
            type="submit"
            disabled={passwordLoading || newPassword.length < 8}
            aria-busy={passwordLoading}
            className="neumo-raised px-6 py-3 min-h-[44px] rounded-xl text-sm font-bold text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
          >
            {passwordLoading ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {passwordLoading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </section>
  );
}