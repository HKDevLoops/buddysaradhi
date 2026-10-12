// Implements: 10_Security.md §3 (a 6-8 digit app PIN at setup gates every sensitive
// mutation: void, unlock, backdate, bulk delete, export; verification accepts 4+
// grandfathered pre-floor PINs) + 08_Settings.md §6 + 12_Business_Rules.md BR-SEC-05
// + docs/rfc/pin-proof-spec-amendment.md §4.4 (grandfathering).
//
// This module owns TWO bounds for ONE stored value, and the split is deliberate:
//
//   - SETUP (`PIN_MIN_LENGTH` = 6, `pinFormatError`): new PINs below 6 digits are
//     refused per BR-SEC-05. A 4-digit (1-in-10k) PIN falls to the 15-attempt wipe
//     ladder, so the floor holds every fresh setup and change.
//   - VERIFY (`PIN_VERIFY_MIN_LENGTH` = 4, `pinVerifyFormatError`): existing 4-5
//     digit PINs predate the floor and MUST keep verifying. Refusing to verify
//     would lock a tutor out of their own books — a login-breaking regression
//     worse than the inconsistency the floor fixed. Verification is argon2, not
//     length: the format gate only rejects what is structurally unusable
//     (non-digits, <4, >8) and lets the hash decide.
//
// The client must never impose a tighter bound than the server verifies, because
// the failure mode is a tutor who is permanently locked out of correcting their
// own books.

/** Inclusive lower bound for SETUP. 6 is the floor per BR-SEC-05
 * (12_Business_Rules.md): new setups below 6 digits are refused by
 * `setPinAction`; verification of pre-floor 4-5 digit PINs stays grandfathered
 * server-side (docs/rfc/pin-proof-spec-amendment.md §4.4). */
export const PIN_MIN_LENGTH = 6;

/** Inclusive lower bound for VERIFY. 4 grandfathered per §4.4: PINs set before
 * the BR-SEC-05 floor existed keep verifying — verification is argon2, not
 * length, so the format gate admits anything the hash could have been made
 * from (4-8 digits) and rejects only what is structurally unusable. */
export const PIN_VERIFY_MIN_LENGTH = 4;

/** Inclusive upper bound. 8 is the ceiling a numeric keypad and a v4 KDF handle. */
export const PIN_MAX_LENGTH = 8;

/** Digits only. No letters, no symbols, no whitespace. */
const PIN_PATTERN = /^\d+$/;

/** True when `pin` is a structurally valid NEW PIN (setup bound: 6-8). */
export function isValidPinFormat(pin: string): boolean {
  return (
    pin.length >= PIN_MIN_LENGTH &&
    pin.length <= PIN_MAX_LENGTH &&
    PIN_PATTERN.test(pin)
  );
}

/**
 * Why a NEW PIN is unacceptable, in the tutor's terms, or `null` when it is fine.
 * SETUP ONLY: floored at 6 per BR-SEC-05. Returned as a sentence so no call site
 * has to compose its own. Never use on a verify path — a grandfathered 4-5 digit
 * PIN is refused here but verifies fine (see `pinVerifyFormatError`).
 */
export function pinFormatError(pin: string): string | null {
  if (pin.length === 0) return "Enter your PIN.";
  if (!PIN_PATTERN.test(pin)) return "Your PIN is digits only.";
  if (pin.length < PIN_MIN_LENGTH) {
    return `Your PIN is at least ${PIN_MIN_LENGTH} digits.`;
  }
  if (pin.length > PIN_MAX_LENGTH) {
    return `Your PIN is at most ${PIN_MAX_LENGTH} digits.`;
  }
  return null;
}

/**
 * Why an ENTERED (to-be-verified) PIN is unusable, in the tutor's terms, or
 * `null` when it may proceed to argon2. VERIFY ONLY: floored at 4 per the §4.4
 * grandfathering rule — existing 4-5 digit PINs predate the BR-SEC-05 floor and
 * verification is argon2, not length. A 4-digit entry that reaches argon2 and
 * mismatches still fails closed with "isn't right"; this gate only stops what
 * no stored hash could match (empty, non-digits, <4, >8).
 */
export function pinVerifyFormatError(pin: string): string | null {
  if (pin.length === 0) return "Enter your PIN.";
  if (!PIN_PATTERN.test(pin)) return "Your PIN is digits only.";
  if (pin.length < PIN_VERIFY_MIN_LENGTH) {
    return `Your PIN is at least ${PIN_VERIFY_MIN_LENGTH} digits.`;
  }
  if (pin.length > PIN_MAX_LENGTH) {
    return `Your PIN is at most ${PIN_MAX_LENGTH} digits.`;
  }
  return null;
}

/** The `maxLength` an input should carry: the ceiling, never tighter. */
export const PIN_INPUT_MAX_LENGTH = PIN_MAX_LENGTH;
