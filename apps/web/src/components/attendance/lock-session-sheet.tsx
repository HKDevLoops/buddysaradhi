"use client";

// Implements: 06_Attendance.md §5 (session lock — locks a date+batch against
// further edits), §10.6 BR-ATT-07 (unlock = 60-minute window: Tier 2 PIN,
// Tier 3 reason + PIN; lazy relock on expiry), §10.8 audit trail and
// 12_Business_Rules.md BR-ATT-06 (lock window, default 48h,
// tutor-configurable); 10_Security.md §4 (lock is a sensitive mutation, so it
// requires a PIN); 13_UI_Guidelines.md §8.7 (sheet: Escape, focus return,
// scrim, dirty-form confirm) and AGENTS.md §2 Rule 10 (WCAG 2.1 AA dialog
// pattern) + Rule 9 (no silent failures).
//
// Hardening (docs/design/overhaul-plan.md §2): the sheet closed on a scrim
// click with no Escape key, its close button had no accessible name at all, and
// a `{ success: false }` server answer — which is how `lockSessionAction`
// reports a wrong PIN — hit `onSuccess` and fell through every branch: the sheet
// stayed open with a spinner cleared and NO message, so a refused lock looked
// identical to a lock the tutor never pressed. It now composes
// `useOverlayDismiss` with `dirty` on the PIN, states both outcomes by name, and
// closes only on confirmed success.
//
// Copy: the hint used to read "your PIN (fallback: 1234)". `lockSessionAction`
// verifies the PIN against `settings.pinHash` and fails closed when no PIN is
// configured — there is no 1234 fallback, so the hint disclosed a bypass that
// does not exist. Removed.

import { useCallback, useState } from "react";
import { useAttendanceStore } from "@/stores/attendance-store";
import {
  AttendanceSession,
  pinFormatError,
  PIN_INPUT_MAX_LENGTH,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from "@buddysaradhi/shared";
import { lockSessionAction, unlockSessionAction, requestHardUnlockAction } from "@/server/actions/attendance";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Unlock, FileText } from "lucide-react";
import { useUnlockWindow } from "./use-unlock-window";
import { UNLOCK_WINDOW_MINUTES, HARD_UNLOCK_REASON_MIN_LENGTH } from "@/server/attendance-window";
import { toAppErrorState } from "@/lib/app-errors";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import {
  useOverlayDismiss,
  DiscardChangesPrompt,
  OverlayCloseButton,
} from "@/components/ui/overlay";
import { Explain } from "@/components/ui/explain";

interface LockSessionSheetProps {
  session: AttendanceSession | null;
}

/**
 * `lockSessionAction` reports the two ways a tutor gets this wrong — a wrong
 * PIN, or no PIN configured at all — plus a format rejection. Every other
 * failure is unexpected and goes through the shared taxonomy mapper, which never
 * renders raw server text, stacks or Next.js digests.
 *
 * The PIN verdicts are matched on a SUBSTRING, not the whole string: the server
 * now prefixes its answers with a taxonomy code (`VALIDATION: …`), so an
 * anchored `^invalid pin$` would stop matching and every wrong PIN would fall
 * through to the generic VALIDATION copy.
 */
function lockErrorCopy(raw: string): string {
  const text = raw.trim();
  if (/invalid pin|security pin is incorrect/i.test(text))
    return "That PIN isn't right. Enter your PIN and try again — nothing was written.";
  if (/no pin configured/i.test(text))
    return "You haven't set a PIN yet. Add one in Settings → Security, then lock the session.";
  return `${toAppErrorState(text).message} Nothing was written.`;
}

export function LockSessionSheet({ session }: LockSessionSheetProps) {
  const { isLockSheetOpen, setLockSheetOpen, selectedDateIso, selectedBatch } = useAttendanceStore();
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [modeOverride, setModeOverride] = useState<"unlock" | "request" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const isLocked = session?.locked_at != null;
  // Display-only window state (server is the authority). Drives which form
  // shows, the countdown, and nothing else — every submit is re-checked
  // server-side, so a stale open window here can never force a grant.
  const { windowOpen, minutesLeft, hardLocked } = useUnlockWindow(session);
  const mode = modeOverride ?? (hardLocked ? "request" : "unlock");

  /**
   * ONE PIN rule, from the shared module (`packages/shared/src/pin.ts`) — the
   * second site converted after `ledger-table`.
   *
   * This input used to carry `maxLength={4}` and gate on `pin.length < 4`, while
   * `setPinAction` accepts 4–8 digits. A tutor who set a 6-digit PIN therefore
   * COULD NOT TYPE IT, and locking a session is the control that freezes
   * attendance for a date. A client bound tighter than the server is a tutor
   * locked out of their own books — the exact failure that rule exists to
   * prevent, in a different screen.
   *
   * So the client states the bound the server enforces (`pinFormatError`) and
   * adds no gate of its own beyond it. Verification stays server-side and
   * unchanged; `maxLength` is the ceiling, never tighter.
   */
  const pinError = pinFormatError(pin);

  const closeSheet = useCallback(() => {
    setLockSheetOpen(false);
    setPin("");
    setReason("");
    setModeOverride(null);
    setFormError(null);
  }, [setLockSheetOpen]);

  // A typed PIN would be silently destroyed by an Escape or a scrim click, so
  // the shared module asks before discarding it.
  const {
    panelRef,
    onScrimClick,
    confirmThenClose,
    setDiscardOpen,
    discardOpen,
    discardQuestion,
  } = useOverlayDismiss({
    open: isLockSheetOpen,
    onClose: closeSheet,
    dirty: pin.length > 0 || reason.trim().length > 0,
    label: "PIN form",
  });

  const mutation = useMutation({
    mutationFn: (subPin: string) =>
      // `target` is passed on every call, including when no session exists yet:
      // 06 §11 E9 allows locking an empty session, and the server creates it in
      // the same transaction that locks it.
      lockSessionAction(session?.id ?? "pending", subPin, {
        date: selectedDateIso,
        batchId: selectedBatch === "all" ? null : selectedBatch,
      }),
    // Rule 9: the outcome is stated, every time, either way. A refused lock keeps
    // the sheet open with the PIN cleared but the tutor's intent intact.
    onSuccess: (res) => {
      if (res.success !== true) {
        const copy = lockErrorCopy(res.error ?? "");
        setFormError(copy);
        toast.error("Session not locked", copy);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(
        `Session locked${session?.session_date ? ` for ${session.session_date}` : ""}`,
        "Attendance for this date and batch can no longer be edited. Unlock it to make changes.",
      );
      closeSheet();
    },
    onError: (err) => {
      const copy = `${toAppErrorState(err).message} Nothing was written — check your connection and try again.`;
      setFormError(copy);
      toast.error("Session not locked", copy);
    },
  });

  const canLock = pinError === null && !mutation.isPending;

  /**
   * Unlock refusals, stated plainly. HARD_LOCKED routes the tutor to the
   * request form instead of an error toast: the session is not broken, the
   * door is just a different one (06 §10.6 Tier 3).
   */
  const unlockFailure = (raw: string): void => {
    const text = raw.trim();
    if (/hard_locked/i.test(text)) {
      setModeOverride("request");
      setFormError("Sessions older than 30 days need a written reason. Your PIN was fine. Use the request form below.");
      toast.error("Direct unlock disabled", "Sessions older than 30 days need a written reason. Use the request form.");
      return;
    }
    const copy = /invalid pin|security pin is incorrect/i.test(text)
      ? "That PIN isn't right. Nothing was written."
      : /no pin configured/i.test(text)
        ? "You haven't set a PIN yet. Add one in Settings → Security, then unlock."
        : `${toAppErrorState(text).message} Nothing was written.`;
    setFormError(copy);
    toast.error("Session not unlocked", copy);
  };

  const unlockMutation = useMutation({
    mutationFn: (subPin: string) => unlockSessionAction(session!.id, subPin),
    // Rule 9: every outcome stated. A refused unlock keeps the sheet open
    // with the PIN cleared; a granted one closes after announcing the window.
    onSuccess: (res) => {
      if (res.success !== true) {
        unlockFailure(res.error ?? "");
        setPin("");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(
        "Session unlocked for 60 minutes",
        "Edits in the next hour are double-audited. It locks again automatically afterwards.",
      );
      closeSheet();
    },
    onError: (err) => {
      const copy = `${toAppErrorState(err).message} Nothing was written. Check your connection and try again.`;
      setFormError(copy);
      toast.error("Session not unlocked", copy);
    },
  });

  const reasonOk = reason.trim().length >= HARD_UNLOCK_REASON_MIN_LENGTH;
  const requestFailure = (raw: string): void => {
    const text = raw.trim();
    if (/not_hard_locked/i.test(text)) {
      setModeOverride("unlock");
      setFormError("This session is under 30 days old, so unlock it directly with your PIN.");
      toast.error("Request not needed", "This session is under 30 days old. Unlock it directly with your PIN.");
      return;
    }
    const copy = /invalid pin|security pin is incorrect/i.test(text)
      ? "That PIN isn't right. Nothing was written."
      : /no pin configured/i.test(text)
        ? "You haven't set a PIN yet. Add one in Settings → Security first."
        : `${toAppErrorState(text).message} Nothing was written.`;
    setFormError(copy);
    toast.error("Unlock not requested", copy);
  };

  const requestMutation = useMutation({
    mutationFn: (args: { subPin: string; subReason: string }) =>
      requestHardUnlockAction(session!.id, args.subReason, args.subPin),
    onSuccess: (res) => {
      if (res.success !== true) {
        requestFailure(res.error ?? "");
        setPin("");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(
        "Unlock requested and granted for 60 minutes",
        "Your reason is in the audit trail. Every edit in the next hour is double-audited.",
      );
      closeSheet();
    },
    onError: (err) => {
      const copy = `${toAppErrorState(err).message} Nothing was written. Check your connection and try again.`;
      setFormError(copy);
      toast.error("Unlock not requested", copy);
    },
  });

  const canUnlock = pinError === null && !unlockMutation.isPending;
  const canRequest = pinError === null && reasonOk && !requestMutation.isPending;

  if (!isLockSheetOpen) return null;

  const batchLabel = selectedBatch === "all" ? "All Batches" : selectedBatch;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Scrim — asks first while a PIN is typed. */}
      <div
        className="absolute inset-0 bg-[var(--surface-scrim)] [backdrop-filter:var(--mat-filter)]"
        onClick={onScrimClick}
        aria-hidden="true"
      />

      {/* Sheet Content - .glass-strong */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-session-title"
        tabIndex={-1}
        className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-md shadow-2xl p-6 overflow-hidden"
      >
        {/* No decorative glow behind the panel: it carried no meaning, and the
            sheet already has a scrim and a border to establish its depth. */}

        <div className="flex items-center justify-between mb-6 gap-3">
          <h2
            id="lock-session-title"
            className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2"
          >
            {isLocked ? (
              windowOpen && minutesLeft !== null ? (
                <>
                  <Unlock className="w-5 h-5 text-[var(--success)]" aria-hidden="true" />
                  Session Unlocked
                </>
              ) : mode === "request" ? (
                <>
                  <FileText className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
                  Request Unlock
                </>
              ) : (
                <>
                  <Unlock className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
                  Unlock Session
                </>
              )
            ) : (
              <>
                <Lock className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
                Lock Session
              </>
            )}
          </h2>
          <OverlayCloseButton onClick={confirmThenClose} label="Close lock session sheet" />
        </div>

        {isLocked ? (
          windowOpen && minutesLeft !== null ? (
            <div className="text-center py-8 space-y-4">
              <Unlock className="w-12 h-12 text-[var(--success)] mx-auto opacity-80" aria-hidden="true" />
              <p className="text-[var(--text-primary)] text-lg font-medium">
                Unlocked · {minutesLeft} min left
              </p>
              <p className="text-[var(--text-muted)] text-sm">
                You can edit attendance until the window closes. Every change is
                written to the audit trail. It locks again automatically afterwards.
              </p>
              <button
                type="button"
                onClick={closeSheet}
                className="mt-4 min-h-[44px] neumo-raised px-6 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] hover:text-[var(--success)] transition-colors"
              >
                Close
              </button>
            </div>
          ) : mode === "request" ? (
            <div className="space-y-6">
              <div className="bg-[var(--surface-inset)] rounded-xl p-4 border border-[var(--border-default)]">
                <p className="text-sm text-[var(--text-secondary)] mb-2">
                  This session is more than 30 days old, so direct unlock is disabled.
                  Write why you need it open and confirm with your PIN. You get a
                  60-minute window and every edit is double-audited.
                </p>
                <div className="text-xs text-[var(--text-muted)] flex flex-col gap-1">
                  <span>Date: {selectedDateIso}</span>
                  <span>Batch: {batchLabel}</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="unlock-reason"
                  className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
                >
                  Reason (at least {HARD_UNLOCK_REASON_MIN_LENGTH} characters)
                </label>
                <textarea
                  id="unlock-reason"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setFormError(null);
                  }}
                  rows={3}
                  placeholder="Parent disputed the 12 Aug absence record. Reviewing now."
                  autoComplete="off"
                  aria-describedby={formError ? "lock-pin-error" : undefined}
                  className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 min-h-[44px] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--info)]"
                />
              </div>

              <div>
                <label
                  htmlFor="request-pin"
                  className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
                >
                  Security PIN ({PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits)
                </label>
                <input
                  id="request-pin"
                  type="password"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setFormError(null);
                  }}
                  inputMode="numeric"
                  maxLength={PIN_INPUT_MAX_LENGTH}
                  autoFocus
                  placeholder="••••"
                  autoComplete="off"
                  aria-describedby={
                    formError ? "lock-pin-error" : pinError ? "lock-pin-format" : undefined
                  }
                  aria-invalid={formError ? true : pinError ? true : undefined}
                  className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 min-h-[44px] text-2xl text-center tracking-[1em] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--info)]"
                />
                {pinError && (
                  <p id="lock-pin-format" className="text-[var(--danger)] text-xs mt-2 text-center">
                    {pinError}
                  </p>
                )}
                {formError && (
                  <p
                    id="lock-pin-error"
                    role="alert"
                    className="text-[var(--danger)] text-xs mt-2 text-center"
                  >
                    {formError}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => requestMutation.mutate({ subPin: pin, subReason: reason.trim() })}
                disabled={!canRequest}
                aria-busy={requestMutation.isPending}
                className={cn(
                  "w-full min-h-[44px] neumo-raised py-3 rounded-xl text-sm font-bold text-[var(--accent-on-primary)] transition-colors",
                  canRequest
                    ? "bg-gradient-to-r from-[var(--success)] to-[var(--info)] shadow-[0_0_15px_color-mix(in_srgb,var(--success)_0.4,transparent)]"
                    : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                )}
              >
                {requestMutation.isPending ? "Requesting unlock…" : "Request Unlock"}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-[var(--surface-inset)] rounded-xl p-4 border border-[var(--border-default)]">
                <p className="text-sm text-[var(--text-secondary)] mb-2">
                  Unlocking opens a 60-minute window to edit this date and batch.
                  Every change is written to the audit trail. Confirm with your PIN.
                </p>
                <div className="text-xs text-[var(--text-muted)] flex flex-col gap-1">
                  <span>Date: {selectedDateIso}</span>
                  <span>Batch: {batchLabel}</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="unlock-pin"
                  className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
                >
                  Security PIN ({PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits)
                </label>
                <input
                  id="unlock-pin"
                  type="password"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setFormError(null);
                  }}
                  inputMode="numeric"
                  maxLength={PIN_INPUT_MAX_LENGTH}
                  autoFocus
                  placeholder="••••"
                  autoComplete="off"
                  aria-describedby={
                    formError ? "lock-pin-error" : pinError ? "lock-pin-format" : undefined
                  }
                  aria-invalid={formError ? true : pinError ? true : undefined}
                  className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 min-h-[44px] text-2xl text-center tracking-[1em] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--info)]"
                />
                {pinError && (
                  <p id="lock-pin-format" className="text-[var(--danger)] text-xs mt-2 text-center">
                    {pinError}
                  </p>
                )}
                {formError && (
                  <p
                    id="lock-pin-error"
                    role="alert"
                    className="text-[var(--danger)] text-xs mt-2 text-center"
                  >
                    {formError}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => unlockMutation.mutate(pin)}
                disabled={!canUnlock}
                aria-busy={unlockMutation.isPending}
                className={cn(
                  "w-full min-h-[44px] neumo-raised py-3 rounded-xl text-sm font-bold text-[var(--accent-on-primary)] transition-colors",
                  canUnlock
                    ? "bg-gradient-to-r from-[var(--success)] to-[var(--info)] shadow-[0_0_15px_color-mix(in_srgb,var(--success)_0.4,transparent)]"
                    : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                )}
              >
                {unlockMutation.isPending ? "Unlocking session…" : "Confirm & Unlock"}
              </button>
            </div>
          )
        ) : (
          <div className="space-y-6">
            {/* 06 §11 E9: "Lock attempted with no records | Allowed — locks an
                empty session (rare but valid; e.g., tutor pre-locks a cancelled
                class)." The sheet used to dead-end here with "Mark attendance for
                at least one student first", so the one legitimate case for
                pre-locking a day was impossible. */}
            {!session && (
              <div
                className="bg-[var(--surface-inset)] rounded-xl p-4 border border-[var(--border-default)]"
                style={{ borderColor: "var(--warning)" }}
              >
                <p className="text-sm text-[var(--text-secondary)]">
                  Nothing has been marked for {selectedDateIso} yet, so there is no
                  session to lock. You can still lock the date, which is what you
                  want for a class you have already decided to cancel: no one will
                  be able to add marks to it later without unlocking first.
                </p>
              </div>
            )}

            <div className="bg-[var(--surface-inset)] rounded-xl p-4 border border-[var(--border-default)]">
              <p className="text-sm text-[var(--text-secondary)] mb-2">
                Locking freezes attendance for this date and batch — no record can be edited
                afterwards without unlocking first. Enter your PIN to confirm.
              </p>
              <div className="text-xs text-[var(--text-muted)] flex flex-col gap-1">
                <span>Date: {selectedDateIso}</span>
                <span>Batch: {batchLabel}</span>
              </div>
              {/* The panel states the rule ("no record can be edited afterwards
                  without unlocking") but never says why a tutor would WANT that,
                  or what the lock window is for — so it reads as an obstacle put
                  in front of a correction. The disclosure answers both next to the
                  date and batch it applies to, and names the escape (unlock with
                  the PIN). No lock behaviour, gate or payload changed. */}
              <Explain concept="attendance-lock" className="mt-1" />
            </div>

            <div>
              <label
                htmlFor="lock-pin"
                className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
              >
                Security PIN ({PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits)
              </label>
              <input
                id="lock-pin"
                type="password"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setFormError(null);
                }}
                inputMode="numeric"
                maxLength={PIN_INPUT_MAX_LENGTH}
                autoFocus
                placeholder="••••"
                autoComplete="off"
                aria-describedby={
                  formError ? "lock-pin-error" : pinError ? "lock-pin-format" : undefined
                }
                aria-invalid={formError ? true : pinError ? true : undefined}
                className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 min-h-[44px] text-2xl text-center tracking-[1em] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--info)]"
              />
              {pinError && (
                <p id="lock-pin-format" className="text-[var(--danger)] text-xs mt-2 text-center">
                  {pinError}
                </p>
              )}
              {formError && (
                <p
                  id="lock-pin-error"
                  role="alert"
                  className="text-[var(--danger)] text-xs mt-2 text-center"
                >
                  {formError}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => mutation.mutate(pin)}
              disabled={!canLock}
              aria-busy={mutation.isPending}
              className={cn(
                "w-full min-h-[44px] neumo-raised py-3 rounded-xl text-sm font-bold text-[var(--accent-on-primary)] transition-colors",
                canLock
                  ? "bg-gradient-to-r from-[var(--success)] to-[var(--info)] shadow-[0_0_15px_color-mix(in_srgb,var(--success)_0.4,transparent)]"
                  : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
              )}
            >
              {mutation.isPending ? "Locking session…" : "Confirm & Lock"}
            </button>
          </div>
        )}
      </div>

      <DiscardChangesPrompt
        open={discardOpen}
        question={discardQuestion}
        onKeep={() => setDiscardOpen(false)}
        onDiscard={() => {
          setDiscardOpen(false);
          closeSheet();
        }}
      />
    </div>
  );
}