// Implements: 02_Core_Logic.md §12.4 (lockout policy table);
// 12_Business_Rules.md BR-SEC-03; 14_Edge_Cases.md EC-SEC-01;
// 08_Settings.md EC-03; 10_Security.md §3 (PIN architecture).
//
// SINGLE SOURCE for the PIN lockout ladder — the only place the
// 5→30s / 10→5min / 15→wipe thresholds live. `server/actions/settings.ts`
// consults `evaluatePinLockout` before every PIN verification; UI surfaces
// only render the returned codes (mapping is workstream D's job).
//
// SPEC NOTE (gap, see report): 10_Security.md §3.5 describes a DIFFERENT
// ladder (3→60s, 4→120s, 5→240s, 6+ exponential, wipe at 10 cumulative).
// The majority contract (02 §12.4 + BR-SEC-03 + EC-SEC-01 + 08 EC-03) is
// 5→30s / 10→5min / 15→wipe — implemented here. §3.5 needs a spec-repair
// RFC (22_Redundancy_Audit.md §5 precedence).

export const PIN_LOCKOUT_30S_AT = 5;
export const PIN_LOCKOUT_5MIN_AT = 10;
export const PIN_WIPE_AT = 15;

export const PIN_LOCKOUT_30S_MS = 30_000;
export const PIN_LOCKOUT_5MIN_MS = 5 * 60_000;

export interface PinLockoutState {
  /** No verification attempt may proceed while true. */
  locked: boolean;
  /** Lockout duration for this fail-count (0 when not locked). */
  lockoutMs: number;
  /** Remaining forgiving attempts before the next lockout (0 when locked). */
  attemptsLeft: number;
  /** Fail count hit the brute-force wipe threshold (BR-SEC-03). */
  wipeRequired: boolean;
}

/** Pure ladder evaluation over the CONSECUTIVE fail count (resets on any
 * successful unlock — EC-SEC-01). No I/O, no parallel thresholds anywhere. */
export function evaluatePinLockout(consecutiveFails: number): PinLockoutState {
  const fails = Math.max(0, Math.floor(consecutiveFails));
  if (fails >= PIN_WIPE_AT) {
    return { locked: true, lockoutMs: 0, attemptsLeft: 0, wipeRequired: true };
  }
  if (fails >= PIN_LOCKOUT_5MIN_AT) {
    return { locked: true, lockoutMs: PIN_LOCKOUT_5MIN_MS, attemptsLeft: 0, wipeRequired: false };
  }
  if (fails >= PIN_LOCKOUT_30S_AT) {
    return { locked: true, lockoutMs: PIN_LOCKOUT_30S_MS, attemptsLeft: 0, wipeRequired: false };
  }
  return { locked: false, lockoutMs: 0, attemptsLeft: PIN_LOCKOUT_30S_AT - fails, wipeRequired: false };
}

/** A stored `locked_until` (ISO, written into the `pin_lockout` audit row's
 * metadata) still gates verification. String comparison is safe: both sides
 * are ISO-8601 UTC from the same writer. */
export function isPinLockoutActive(lockedUntilIso: string | null, nowIso: string): boolean {
  if (!lockedUntilIso) return false;
  return lockedUntilIso > nowIso;
}

/** Stable emission for a ladder state (workstream D maps these to UI). */
export function pinLockoutCode(state: PinLockoutState): "PIN_LOCKED" | "PIN_WIPE_REQUIRED" | null {
  if (state.wipeRequired) return "PIN_WIPE_REQUIRED";
  if (state.locked) return "PIN_LOCKED";
  return null;
}
