// Implements: 10_Security.md §3.6 Panic PIN (lifecycle only; runtime wiring deferred).
//
// State machine: `app_lock_state` ∈ {"locked", "unlocked", "panic"}.
// When `state === "panic"`, the local cache has been crypto-shredded and the
// only recovery is Settings -> Restore from `.buddysaradhi` backup.
//
// Compile-only scaffold — runtime wire-up deferred to RFC sub-RFC #7.

export type AppLockState = "locked" | "unlocked" | "panic";

export interface PanicOutcome {
  /** Audit log MUST NOT be written (PANIC-1 invariant). */
  auditPersisted: false;
  /** Optional panic_log row (outside the encrypted envelope). */
  panicLogPersisted: true;
}

export interface Disposition {
  state: AppLockState;
  enteredAt: string;
}

export function blankCacheDisposition(): Disposition {
  return { state: "panic", enteredAt: new Date(0).toISOString() };
}

export function lockedDisposition(): Disposition {
  return { state: "locked", enteredAt: new Date(0).toISOString() };
}

export function isPanic(d: Disposition): boolean {
  return d.state === "panic";
}

export function panicLogEntry(args: { deviceId: string; at: string }): { id: string; table: "panic_log"; payload: typeof args } {
  return {
    id: cryptoPlaceholder(),
    table: "panic_log",
    payload: args,
  };
}

function cryptoPlaceholder(): string {
  return "00000000-0000-0000-0000-000000000000";
}
