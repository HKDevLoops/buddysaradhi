// Implements: 08_Settings.md EC-04 + §14 (backup passphrase floor),
// §6.2.7 (the backup filename contract), §11 EC-02 (an obvious PIN is refused),
// and 09_Backup_and_Import_Export.md §15.4 (a bulk import over 100 rows needs a
// fresh PIN).
//
// WHY THIS FILE EXISTS. These three values used to live in
// `server/actions/settings.ts`, which carries `"use server"`. A `"use server"`
// module may only export ASYNC functions — Next.js rejects a synchronous export
// at BUILD time with "Only async functions are allowed to be exported in a
// 'use server' file", and `tsc` does not catch it. So the build broke while the
// typecheck and all 619 unit tests stayed green: the exact trap recorded in the
// `TABS-AUDIT-01` worklog for `dashboard-analytics.ts` earlier in this project.
//
// A rule is only true if it is enforced. These three now live in an isomorphic
// module that BOTH the server action and the client component import, so the
// gate the client renders and the gate the server enforces are provably the
// same constant — not two literals that can drift.

/**
 * 08_Settings.md EC-04 + §14 `passphraseSchema`: a backup passphrase is at
 * least 12 characters. The floor was 8, which is short enough that a tutor who
 * picked "buddy1234" would have a KDF input a dictionary attack reaches; the
 * spec names 12 and 12 is what ships.
 */
export const BACKUP_PASSPHRASE_MIN = 12;

/**
 * 08_Settings.md §6.2.7: `Buddysaradhi_Backup_<YYYYMMDD-HHmm>.buddysaradhi`.
 * The extension IS the contract — 08 §9.7 keys restore's magic-byte check and
 * the tutor's own file-naming habit off it, and the previous `.bsb` +
 * `buddysaradhi_backup_<YYYY-MM-DD>` was neither.
 */
export function backupFilename(now: Date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `Buddysaradhi_Backup_${stamp}.buddysaradhi`;
}

/**
 * 09 §15.4: importing more than this many students requires the app PIN. Above
 * the line the blast radius of a bad file is big enough that it is a security
 * action, not a convenience.
 */
export const IMPORT_PIN_REQUIRED_ABOVE_ROWS = 100;

/**
 * 08_Settings.md §11 EC-02: `Tutor enters PIN 123456 / 000000 / 111111` →
 * `Rejected: "PIN is too obvious. Choose a less sequential pattern."`
 *
 * EC-02 was specified and never implemented. `pinFormatError`
 * (`packages/shared/src/pin.ts`) — the module that owns the FORMAT rule — had
 * no strength rule, so `setPinAction` accepted `123456` and a six-digit
 * ascending run guards the backup export, the bulk archive and the ledger void
 * (10_Security.md §3): the three actions with the worst blast radius. The PIN's
 * only defence against someone reading it over a tutor's shoulder is that it is
 * not guessable, and a format check does not make `111111` guessable.
 *
 * WHERE IT LIVES. The canonical home is `packages/shared/src/pin.ts` next to
 * `pinFormatError` — one fact about the product, in one place, for all three
 * platforms. That package is outside this lane's ownership, so the rule is
 * implemented here instead, in the isomorphic settings-gate module both
 * `server/actions/settings.ts` and `security-section.tsx` already import, for the
 * same reason this file exists at all: so the gate the client renders and the
 * gate the server enforces are one function and cannot drift. The patch that
 * moves it is `pin.ts`'s to take — see the report.
 *
 * SCOPE — SET ONLY, NEVER VERIFY. A strength rule must not run on
 * `verifyPinAction` / `verifyPinWithLadder`: if it did, a tutor who had already
 * set an obvious PIN could be locked out of their own books, and refusing to
 * verify is a far worse failure than a weak PIN. The predicate therefore only
 * gates SETTING a PIN.
 */
/** EC-02's own words, so the client and the server say the same thing. */
export const OBVIOUS_PIN_MESSAGE = "PIN is too obvious. Choose a less sequential pattern.";

export function obviousPinError(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return null; // Format is `pinFormatError`'s job.
  const digits = [...pin].map(Number);

  // 000000 / 111111 — one digit repeated.
  if (digits.every((d) => d === digits[0])) return OBVIOUS_PIN_MESSAGE;

  // 123456 / 876543 / 246813 / 97531 — a constant step across every pair.
  const step = digits[1]! - digits[0]!;
  if (step !== 0 && digits.every((d, i) => i === 0 || d - digits[i - 1]! === step))
    return OBVIOUS_PIN_MESSAGE;

  // 1212 / 121212 — a short block repeated. Periods 1 and 2 only, deliberately:
  // a wider period check starts rejecting perfectly reasonable PINs, and this
  // rule's whole cost is a tutor who cannot set the PIN they want.
  for (const period of [1, 2]) {
    if (digits.length % period !== 0 || digits.length / period < 2) continue;
    const block = digits.slice(0, period).join("");
    if (digits.join("") === block.repeat(digits.length / period)) return OBVIOUS_PIN_MESSAGE;
  }

  return null;
}