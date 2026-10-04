// Implements: 10_Security.md §3 (a 4-8 digit app PIN gates every sensitive
// mutation: void, unlock, backdate, bulk delete, export) + 08_Settings.md §6.
//
// This constant exists because the app had THREE different PIN rules for ONE stored
// value, and the disagreement was not cosmetic:
//
//   - `setPinAction` accepted 4-8 digits, so a tutor could SET a 6-digit PIN.
//   - `lock-session-sheet` had `maxLength={4}`, so a tutor with a 6-digit PIN could
//     never lock an attendance session.
//   - `ledger-table` required `>= 6` to enable Void, so a tutor with a 4-digit PIN
//     could never void a receipt — and voiding a reversing ledger row is the ONLY
//     correction path an append-only ledger has (Rule 1, BR-LED-04).
//
// A PIN length rule is one fact about the product. It lives here, once. The client
// must never impose a tighter bound than the server accepts, because the failure mode
// is a tutor who is permanently locked out of correcting their own books.

/** Inclusive lower bound. 4 is the floor for a numeric keypad. */
export const PIN_MIN_LENGTH = 4;

/** Inclusive upper bound. 8 is the ceiling a numeric keypad and a v4 KDF handle. */
export const PIN_MAX_LENGTH = 8;

/** Digits only. No letters, no symbols, no whitespace. */
const PIN_PATTERN = /^\d+$/;

/** True when `pin` is a structurally valid PIN. */
export function isValidPinFormat(pin: string): boolean {
  return (
    pin.length >= PIN_MIN_LENGTH &&
    pin.length <= PIN_MAX_LENGTH &&
    PIN_PATTERN.test(pin)
  );
}

/**
 * Why a PIN is unacceptable, in the tutor's terms, or `null` when it is fine.
 * Returned as a sentence so no call site has to compose its own.
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

/** The `maxLength` an input should carry: the ceiling, never tighter. */
export const PIN_INPUT_MAX_LENGTH = PIN_MAX_LENGTH;
