"use client";

// Implements: 08_Settings.md §6.2.7 (Backup & Restore UI surfaces), §15
// SR-01 (fresh PIN), §11 EC-04 (passphrase floor), §9.6 step 6 (audit +
// last-backup stamp), §16 error table (`BackupEncryptionError` states the
// failure; no file is offered when one happened); 09_Backup_and_Import_Export.md
// §3 + §15.4 (typed `EXPORT`, then a fresh PIN — two independent gates);
// AGENTS.md §2 Rule 8 (AES-256-GCM + Argon2id, never plaintext) + Rule 9 (no
// silent failure) + Rule 10 (44px targets, label per control).
//
// WHAT THIS SURFACE WAS: a passphrase box with an 8-character floor, a
// "Generate Backup" button, and a download named `.bsb`. Three defects, all
// load-bearing: the passphrase floor was half the spec'd length; the button
// needed no PIN and no typed word, so the one artefact that leaves the device
// was the one export the spec gates hardest; and the card was named "Download
// .bsb" while the spec's file is `.buddysaradhi` — the extension restore keys
// its magic-byte check on.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  createBackupAction,
} from "@/server/actions/settings";
// The passphrase floor and the filename contract are shared with the server
// action on purpose: the client disables Save at 12 characters and the server
// refuses below 12, and those must not be two literals that drift.
import { BACKUP_PASSPHRASE_MIN, backupFilename } from "@/lib/settings-gates";
import { PIN_INPUT_MAX_LENGTH } from "@buddysaradhi/shared";
import { useSettingsStore, type BackupArtefact } from "@/stores/settings-store";
import { HardDrive, Download, AlertTriangle, Key, Loader2, ShieldCheck, FileJson } from "lucide-react";
import { cn } from "@/lib/utils";

export function BackupSection() {
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [typedWord, setTypedWord] = useState("");
  const [pin, setPin] = useState("");
  // THE ARTEFACHT LIVES IN THE SCREEN'S STORE, not in a `useState` here. Measured
  // on 2026-10-08: this section's success card was found missing 120 seconds
  // after a backup that had actually been created, encrypted and audited. A
  // component-local result is destroyed by any remount of this pane, and this
  // pane IS remounted — every settings mutation calls `revalidatePath
  // ("/settings")`. The consequence is the worst kind for this one file: the
  // tutor is told nothing, and the only way back is to pay for Argon2id again.
  const result = useSettingsStore((s) => s.lastBackup);
  const setLastBackup = useSettingsStore((s) => s.setLastBackup);

  const mutation = useMutation({
    mutationFn: () => createBackupAction(passphrase, pin, typedWord),
    onSuccess: (res) => {
      // A typed refusal is a refusal, not a crash: keep the copy on screen and
      // let the tutor fix the one thing that is wrong (Rule 9).
      if (res.success !== true) {
        setLastBackup(null);
        return;
      }
      setLastBackup({ ...res.data, counts: res.data.counts } as BackupArtefact);
      setPin("");
    },
  });

  const refusal =
    mutation.data && mutation.data.success !== true ? mutation.data.error : null;

  const passphraseLong = passphrase.length >= BACKUP_PASSPHRASE_MIN;
  const passphraseMatches = passphraseConfirm.length > 0 && passphraseConfirm === passphrase;
  const wordMatches = typedWord === "EXPORT";
  const pinFilled = pin.length >= 4 && pin.length <= PIN_INPUT_MAX_LENGTH;
  const canSubmit = passphraseLong && passphraseMatches && wordMatches && pinFilled;

  const handleDownload = () => {
    if (!result) return;
    const anchor = document.createElement("a");
    anchor.href = result.blobUrl;
    anchor.download = result.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8 max-w-2xl">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-[var(--success)]" aria-hidden="true" />
          Create Local Backup
        </h3>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-[68ch]">
          Your backup is encrypted on this device with AES-256-GCM and a key derived from your
          passphrase. The passphrase is never sent anywhere and we cannot recover your data without
          it.
        </p>
      </div>

      <div
        className="rounded-xl border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] p-4 flex gap-3"
        style={{ background: "color-mix(in srgb, var(--warning) 8%, transparent)" }}
      >
        <AlertTriangle className="w-5 h-5 text-[var(--warning)] shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-sm text-[var(--text-secondary)]">
          <p className="font-semibold text-[var(--text-primary)] mb-1">
            Write this passphrase down somewhere you will find it
          </p>
          <p>
            Without this exact passphrase, restoring from this file is impossible. There is no reset
            and no recovery, because a reset would defeat the encryption.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <label
            htmlFor="backup-passphrase"
            className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
          >
            Encryption passphrase (at least {BACKUP_PASSPHRASE_MIN} characters)
          </label>
          <div className="relative">
            <Key className="w-4 h-4 text-[var(--text-muted)] absolute left-4 top-3.5 pointer-events-none" aria-hidden="true" />
            <input
              id="backup-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => {
                setPassphrase(e.target.value);
                mutation.reset();
              }}
              placeholder="Min. 12 characters"
              autoComplete="new-password"
              aria-describedby="backup-passphrase-help"
              className="neumo-inset w-full pl-11 pr-4 py-3 min-h-[44px] text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--success)] focus:ring-1 focus:ring-[var(--success)]"
            />
          </div>
          <p id="backup-passphrase-help" className="text-xs text-[var(--text-muted)] mt-2">
            A sentence you will remember beats a word you will not. This is the only thing standing
            between your file and anyone who finds it.
          </p>
        </div>

        <div>
          <label
            htmlFor="backup-passphrase-confirm"
            className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
          >
            Confirm passphrase
          </label>
          <div className="relative">
            <Key className="w-4 h-4 text-[var(--text-muted)] absolute left-4 top-3.5 pointer-events-none" aria-hidden="true" />
            <input
              id="backup-passphrase-confirm"
              type="password"
              value={passphraseConfirm}
              onChange={(e) => {
                setPassphraseConfirm(e.target.value);
                mutation.reset();
              }}
              autoComplete="new-password"
              aria-invalid={passphraseConfirm.length > 0 && !passphraseMatches ? true : undefined}
              className="neumo-inset w-full pl-11 pr-4 py-3 min-h-[44px] text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--success)] focus:ring-1 focus:ring-[var(--success)]"
            />
          </div>
          {passphraseConfirm.length > 0 && !passphraseMatches && (
            <p className="text-[var(--danger)] text-xs mt-2">The two passphrases do not match.</p>
          )}
        </div>

        {/* 09 §15.4: full backup create is a sensitive export. Two gates — the
            typed word, then the PIN — and the PIN is re-verified on the server
            with the brute-force ladder, so a scripted client buys nothing. */}
        <div className="rounded-xl border border-[var(--border-default)] p-4 space-y-4" style={{ background: "var(--surface-inset)" }}>
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-[var(--text-secondary)] shrink-0" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Two gates before the file is made
            </p>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            A backup holds every student and every payment you have recorded. The typed word proves
            you meant it, and your PIN proves it is you.
          </p>

          <div>
            <label
              htmlFor="backup-typed-word"
              className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
            >
              Type <strong className="text-[var(--text-primary)]">EXPORT</strong> to confirm
            </label>
            <input
              id="backup-typed-word"
              type="text"
              value={typedWord}
              onChange={(e) => {
                setTypedWord(e.target.value);
                mutation.reset();
              }}
              placeholder="EXPORT"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={typedWord.length > 0 && !wordMatches ? true : undefined}
              className="neumo-inset w-full px-4 py-3 min-h-[44px] text-sm font-mono text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--warning)] focus:ring-1 focus:ring-[var(--warning)]"
            />
            {typedWord.length > 0 && !wordMatches && (
              <p className="text-[var(--danger)] text-xs mt-2">The word must be exactly EXPORT.</p>
            )}
          </div>

          <div>
            <label
              htmlFor="backup-pin"
              className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
            >
              Your app PIN
            </label>
            <input
              id="backup-pin"
              type="password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                mutation.reset();
              }}
              inputMode="numeric"
              maxLength={PIN_INPUT_MAX_LENGTH}
              autoComplete="off"
              placeholder="Your PIN"
              className="neumo-inset w-full sm:w-48 px-4 py-3 min-h-[44px] text-sm text-center tracking-[0.4em] font-mono text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--warning)] focus:ring-1 focus:ring-[var(--warning)]"
            />
          </div>
        </div>

        {refusal && (
          <p role="alert" className="text-[var(--danger)] text-sm font-semibold">
            {refusal}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            if (!canSubmit) return;
            setLastBackup(null);
            mutation.mutate();
          }}
          disabled={!canSubmit || mutation.isPending}
          aria-busy={mutation.isPending}
          className={cn(
            "neumo-raised px-6 py-3 min-h-[44px] rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors",
            canSubmit
              ? "text-[var(--accent-on-primary)] bg-[var(--success)] cursor-pointer hover:brightness-110"
              : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-60 cursor-not-allowed",
          )}
        >
          {mutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          )}
          {mutation.isPending ? "Creating backup…" : "Create encrypted backup"}
        </button>
      </div>

      {result && (
        <div
          className="rounded-xl border border-[color-mix(in_srgb,var(--success)_35%,transparent)] p-5 space-y-4"
          style={{ background: "color-mix(in srgb, var(--success) 6%, transparent)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[var(--success)]" aria-hidden="true" />
                Encrypted backup ready
              </p>
              <p className="text-xs font-mono text-[var(--text-secondary)] break-all">{result.filename}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {/* EVERY table the action read, in the order it reads them, with
                    no hand-written summary. `08_Settings.md` §6.2.7 makes this
                    line the tutor's only evidence of what the file holds, and the
                    measured defect (settings audit, 2026-10-08) was exactly a
                    gap in it: receipts, attendance and batches went into the
                    tenant's books but not into the file, and a restore would have
                    dropped all 12 receipts without one word on screen. A count
                    that is printed cannot be silently absent.

                    `null` prints as "not in this build" and NOT as "0" — a zero
                    would be a claim that the tutor has no receipts, which is the
                    same lie in a different font. See `readForBackup`. */}
                {result.size} · {result.counts.students ?? "—"} students ·{" "}
                {result.counts.ledger ?? "—"} ledger entries ·{" "}
                {result.counts.invoices ?? "—"} invoices ·{" "}
                {result.counts.receipts ?? "—"} receipts ·{" "}
                {result.counts.attendanceSessions ?? "—"} attendance sessions ·{" "}
                {result.counts.attendanceRecords ?? "—"} attendance records ·{" "}
                {result.counts.batches ?? "—"} batches · {result.counts.audit ?? "—"} audit rows
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownload}
              className="neumo-raised px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold text-[var(--success)] flex items-center gap-2 cursor-pointer transition-colors hover:brightness-110"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              Download the file
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-[68ch]">
            Keep it somewhere that is not this laptop. A backup you never move is not a backup.
            Saving it now? The next one is the one that matters.
          </p>
        </div>
      )}
    </section>
  );
}
