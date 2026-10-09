// Implements: AGENTS.md §2 Rule 9 (no silent failures — the reason has to survive
// to the screen) and 06_Attendance.md §10.6/§11 E9.
//
// WHY THIS FILE EXISTS. These types started life as `export class` declarations
// inside `server/actions/attendance.ts`. That module carries the `"use server"`
// directive, and a `"use server"` module may only export ASYNC functions — the
// build failed with `Attempted to call the default export of ... from the server
// but it's on the client`, and neither `tsc --noEmit` nor the unit tests noticed
// (AGENTS.md §15 FM-11: `next build` is the ONLY gate that sees this class of
// error). They live here instead, in a plain module, so the taxonomy is
// importable and the directive stays honest.

/**
 * A DELIBERATE refusal that already carries a sentence the tutor can act on —
 * a locked session, an expired unlock window, a hard lock, a foreign batch.
 *
 * These are not failures and must never be genericised into "something went
 * wrong": the distinction the original code did not make is what let a raw
 * SQLite driver string be rendered into the UI.
 *
 * Anything that is NOT one of these is an unexpected fault and gets a fixed
 * generic message, so a driver error cannot reach the client.
 */
export class AttendanceRefusalError extends Error {
  readonly code = "VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "AttendanceRefusalError";
  }
}

/**
 * A batch id that already exists under a different tenant. Adopting it would be a
 * cross-tenant write; creating over it would be a primary-key collision. Both are
 * refused, and the refusal is TYPED so the action returns a sentence the tutor can
 * act on instead of the raw SQLite constraint text (Rule 9).
 */
export class BatchOwnershipError extends AttendanceRefusalError {
  constructor() {
    super("VALIDATION: That batch belongs to another tutor. Choose one of your own batches.");
    this.name = "BatchOwnershipError";
  }
}