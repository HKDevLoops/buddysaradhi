"use client";

// Implements: 06_Attendance.md §10.6 BR-ATT-07 (unlock windows).
//
// ONE client reading of the unlock window so the toolbar badge, the grid
// toggles, the lock sheet and the backgrounding relock never disagree. The
// server is the authority (window opens only via `unlockSessionAction` /
// `requestHardUnlockAction`, closes via `relockSessionAction` or 60-minute
// expiry enforced at the edit gate); this hook only derives *display* state
// from the `unlock_window_expires_at` the read paths attach to the session.
// Unknown/absent/expired ⇒ closed (fail-closed read, mirroring the server).

import { useEffect, useState } from "react";
import type { AttendanceSession } from "@buddysaradhi/shared";

export interface UnlockWindowView {
  /** An overwrite-grade window is currently open (edits permitted). */
  readonly windowOpen: boolean;
  /** Whole minutes left, for countdown copy. Null when closed. */
  readonly minutesLeft: number | null;
  /** Tier 3 routing (06 §10.6): request flow, never direct unlock. */
  readonly hardLocked: boolean;
}

function minutesLeftOf(expiresAt: string | null | undefined, nowMs: number): number | null {
  if (!expiresAt) return null;
  const left = Math.ceil((new Date(expiresAt).getTime() - nowMs) / 60_000);
  return left > 0 ? left : null;
}

export function useUnlockWindow(session: AttendanceSession | null): UnlockWindowView {
  // Thirty-second cadence: minute-granularity copy needs no tighter tick, and
  // the number is plain text (never a live region), so screen readers are not
  // spammed. Interval exists only while a window is open.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const expiresAt = session?.unlock_window_expires_at ?? null;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const minutesLeft = minutesLeftOf(expiresAt, nowMs);
  return {
    windowOpen: minutesLeft !== null,
    minutesLeft,
    hardLocked: session?.hard_locked === true,
  };
}
