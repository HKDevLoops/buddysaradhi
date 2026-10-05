"use client";

// Implements: 08_Settings.md BR-SEC-02 (mandatory app PIN) — an account with
// no PIN configured is forced through setup before touching the app.
// 10_Security.md §4 (PIN-gated sensitive mutations); AGENTS.md §2 Rule 10
// (alertdialog pattern, focus management, 44px targets) + Rule 9 (every
// outcome stated, nothing silent).
//
// Blocking rules, deliberately narrow:
// - Blocks ONLY on a definitive `configured: false` answer. Loading, transport
//   errors, and offline all render NOTHING — an offline-first tutor must never
//   lose their local data to a gate that cannot reach the server.
// - No dismiss path by design (no scrim close, no Escape, no close button):
//   this is a setup requirement, not a sheet. The only exit is a verified PIN.
// - First-time setup posts no current PIN (the server skips re-verification
//   when no hash exists); the same `setPinAction` serves later changes with
//   the current PIN from the Security section.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPinStatusAction, setPinAction } from "@/server/actions/settings";
import { pinFormatError, PIN_MIN_LENGTH, PIN_MAX_LENGTH, PIN_INPUT_MAX_LENGTH } from "@buddysaradhi/shared";
import { useToast } from "@/components/ui/toast";
import { toAppErrorState } from "@/lib/app-errors";
import { cn } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";

export function PinSetupGate() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["pin-status"],
    queryFn: () => getPinStatusAction(),
    // The answer changes only when the tutor sets a PIN (this gate or the
    // Security section both invalidate explicitly). No polling on metered
    // tiers; a stale `true` is harmless (gate stays down), a stale `false`
    // self-heals on the next mount or explicit invalidation.
    staleTime: Infinity,
    retry: 1,
  });

  const formatProblem = pinFormatError(newPin);
  const pinsMatch = newPin.length === 0 || newPin === confirmPin;

  const mutation = useMutation({
    mutationFn: (next: string) => setPinAction(next),
    onSuccess: (res) => {
      if (res.success !== true) {
        const copy = res.error || "Could not set the PIN.";
        setFormError(copy);
        toast.error("PIN not set", copy);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["pin-status"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("PIN set", "Your app is now protected. You will use this PIN to unlock.");
    },
    onError: (err) => {
      const copy = `${toAppErrorState(err).message} Nothing was changed.`;
      setFormError(copy);
      toast.error("PIN not set", copy);
    },
  });

  const canSubmit =
    newPin.length > 0 && formatProblem === null && pinsMatch && !mutation.isPending;

  // Gate DOWN in every non-definitive case: still loading, transport error,
  // or an explicit configured:true. Only a verified `configured: false`
  // blocks — offline tutors keep their data.
  if (!data || data.success !== true || data.configured !== false) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: "var(--canvas)" }} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pin-setup-title"
        aria-describedby="pin-setup-desc"
        className="relative w-full max-w-md rounded-2xl border border-[var(--border-default)] p-6 md:p-8 shadow-2xl"
        style={{ background: "var(--surface-overlay)" }}
      >
        <div className="flex items-center gap-3 mb-2">
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--accent-primary) 15%, transparent)" }}
          >
            <ShieldCheck className="w-5 h-5 text-[var(--accent-primary)]" aria-hidden="true" />
          </span>
          <h2 id="pin-setup-title" className="text-xl font-bold text-[var(--text-primary)]">
            Set up your app PIN
          </h2>
        </div>
        <p id="pin-setup-desc" className="text-sm text-[var(--text-secondary)] mb-6">
          This account has no app PIN yet. Your PIN protects voids, attendance unlocks,
          backups and exports. Set one now to continue — it takes ten seconds.
        </p>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="pin-setup-new"
              className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
            >
              New PIN ({PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits)
            </label>
            <input
              id="pin-setup-new"
              type="password"
              value={newPin}
              onChange={(e) => {
                setNewPin(e.target.value);
                setFormError(null);
              }}
              inputMode="numeric"
              maxLength={PIN_INPUT_MAX_LENGTH}
              autoFocus
              autoComplete="off"
              placeholder="••••"
              aria-describedby={formatProblem ? "pin-setup-format" : undefined}
              aria-invalid={formatProblem ? true : undefined}
              className="neumo-inset w-full px-4 py-3 min-h-[44px] text-sm text-center tracking-[0.5em] font-mono text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
            />
            {formatProblem && (
              <p id="pin-setup-format" className="text-[var(--danger)] text-xs mt-2">
                {formatProblem}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="pin-setup-confirm"
              className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
            >
              Confirm new PIN
            </label>
            <input
              id="pin-setup-confirm"
              type="password"
              value={confirmPin}
              onChange={(e) => {
                setConfirmPin(e.target.value);
                setFormError(null);
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

          {formError && (
            <p role="alert" className="text-[var(--danger)] text-sm font-semibold">
              {formError}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              if (!canSubmit) return;
              mutation.mutate(newPin);
            }}
            disabled={!canSubmit}
            aria-busy={mutation.isPending}
            className={cn(
              "w-full min-h-[44px] neumo-raised py-3 rounded-xl text-sm font-bold transition-colors",
              canSubmit
                ? "text-[var(--accent-on-primary)] bg-gradient-to-r from-[var(--success)] to-[var(--info)]"
                : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-50 cursor-not-allowed",
            )}
          >
            {mutation.isPending ? "Setting PIN…" : "Set PIN and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
