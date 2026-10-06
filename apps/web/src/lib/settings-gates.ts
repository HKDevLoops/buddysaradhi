// Implements: 08_Settings.md EC-04 + §14 (backup passphrase floor),
// §6.2.7 (the backup filename contract), and 09_Backup_and_Import_Export.md
// §15.4 (a bulk import over 100 rows needs a fresh PIN).
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