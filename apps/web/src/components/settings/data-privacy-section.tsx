"use client";

// Implements: 08_Settings.md §6.2.9 (Data & Privacy: auto-archive window,
// export-full, delete-all) and §15 SR-03 (delete-all is the triple gate: typed
// `DELETE`, then a fresh PIN, then a second typed `DELETE`) + §11 EC-14
// (backdated entries are allowed but warned about) + §14 `dataPrivacySchema`
// (auto-archive window is 30 to 365 days); 12_Business_Rules.md BR-SEC-02
// (fresh PIN) / BR-STU-01; AGENTS.md §2 Rule 5 (colour comes from a token, not
// a literal) + Rule 9 (every outcome stated) + Rule 10 (44px targets, label per
// control) + §6.1 (no `any`).
//
// WHAT CHANGED AND WHY:
//
// - The delete-all flow had ONE typed word and a PIN. SR-03 asks for three gates
//   on the most destructive action in the product. It now has all three.
// - The PIN field was `maxLength={4}` while the stored PIN is 4 to 8 digits, so
//   a tutor with a 6-digit PIN could not type it: the button armed at four
//   characters and the server then rejected the truncated value, forever.
// - The card said "Permanently remove all students, attendance records, and
//   ledger entries" and the button said "Permanently Delete Data". Neither is
//   true. `deleteTenantDataAction` marks every student archived and touches
//   nothing else — no attendance, no ledger, no receipts. The copy now says
//   exactly that, which is the part a tutor is actually making a decision on.
// - The auto-archive select offered "Never" (0), a value 08 §14's schema
//   rejects (`min(30)`), and capped at 180 of a 365-day range. It now offers
//   values inside the schema's own range.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteAccountAction, deleteTenantDataAction, updateSettingAction } from "@/server/actions/settings";
import { PIN_INPUT_MAX_LENGTH } from "@buddysaradhi/shared";
import { Trash2, AlertOctagon, ShieldAlert, Archive } from "lucide-react";
import { cn } from "@/lib/utils";

import type { Settings } from "@/types/settings";

interface DataPrivacySectionProps {
  settings: Settings;
}

const ARCHIVE_WINDOW_DAYS = [30, 60, 90, 180, 365] as const;

const inputCls =
  "neumo-inset w-full px-4 py-3 min-h-[44px] text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--danger)] focus:ring-1 focus:ring-[var(--danger)]";

/** `biometricEnabled` etc. arrive as 0/1; `Settings` carries an index signature. */
function readNumber(settings: Settings, camel: string, snake: string, fallback: number): number {
  const raw = settings[camel] ?? settings[snake];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export function DataPrivacySection({ settings }: DataPrivacySectionProps) {
  const queryClient = useQueryClient();

  // ---- auto-archive window (BR-STU-01) ------------------------------------
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const archiveMutation = useMutation({
    mutationFn: async (days: number) => {
      const res = await updateSettingAction("autoArchiveInactiveDays", days);
      if (!res.success) throw new Error(res.error || "Could not save the window.");
    },
    onSuccess: () => {
      setArchiveError(null);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => {
      setArchiveError(err instanceof Error ? err.message : "Could not save the window.");
    },
  });
  const autoArchiveInactiveDays = readNumber(settings, "autoArchiveInactiveDays", "auto_archive_inactive_days", 90);

  // ---- delete all students: SR-03 triple gate -----------------------------
  type DeleteStep = "idle" | "step1" | "step2" | "step3";
  const [step, setStep] = useState<DeleteStep>("idle");
  const [firstWord, setFirstWord] = useState("");
  const [pin, setPin] = useState("");
  const [secondWord, setSecondWord] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const firstWordOk = firstWord === "DELETE";
  const pinOk = pin.length >= 4 && pin.length <= PIN_INPUT_MAX_LENGTH;
  const secondWordOk = secondWord === "DELETE";

  const deleteMutation = useMutation({
    mutationFn: () => deleteTenantDataAction(pin),
    onSuccess: (res) => {
      if (!res.success) {
        // Rule 9: a refusal is a refusal, and the tutor is told which gate it was.
        setDeleteError(res.error ?? "Nothing was deleted.");
        setStep("step1");
        return;
      }
      queryClient.clear();
      window.location.href = "/";
    },
  });

  const closeDeleteFlow = () => {
    setStep("idle");
    setFirstWord("");
    setPin("");
    setSecondWord("");
    setDeleteError(null);
    deleteMutation.reset();
  };

  // ---- delete account: irreversible, own gate -----------------------------
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountWord, setAccountWord] = useState("");
  const [accountPin, setAccountPin] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const accountWordOk = accountWord === "DELETE MY ACCOUNT FOREVER";
  const accountPinOk = accountPin.length >= 4 && accountPin.length <= PIN_INPUT_MAX_LENGTH;

  const deleteAccountMutation = useMutation({
    mutationFn: () => deleteAccountAction(accountPin),
    onSuccess: (res) => {
      if (!res.success) {
        setAccountError(res.error ?? "Nothing was deleted.");
        return;
      }
      queryClient.clear();
      window.location.href = "/login";
    },
  });

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8 max-w-2xl">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
          Data Management
        </h3>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--info) 12%, transparent)" }}>
              <Archive className="w-6 h-6 text-[var(--info)]" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Auto-Archive Inactive Students</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[46ch]">
                Moves a student out of your active lists after this many days with no attendance. It
                is a filing choice, not a deletion: their fees and history stay.
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-44">
            <select
              value={autoArchiveInactiveDays}
              onChange={(e) => archiveMutation.mutate(parseInt(e.target.value, 10))}
              disabled={archiveMutation.isPending}
              aria-label="Auto-archive inactive students after this many days"
              className={cn(inputCls, "pl-4 pr-10 appearance-none cursor-pointer focus:border-[var(--info)] focus:ring-[var(--info)]")}
            >
              {ARCHIVE_WINDOW_DAYS.map((days) => (
                <option key={days} value={days} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">
                  After {days} days
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
              <svg className="fill-current h-4 w-4" viewBox="0 0 20 20" aria-hidden="true"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
            </div>
          </div>
        </div>
        {archiveError && (
          <p role="alert" className="text-[var(--danger)] text-xs mt-2">{archiveError}</p>
        )}
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Two actions you cannot take back with a tap</h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-5 max-w-[68ch]">
          Both of these clear your working screens. Both ask for your PIN. Read what each one does
          before you decide which you meant.
        </p>

        <div className="space-y-6">
          {/* ---- archive every student (SR-03 triple gate) ---- */}
          <div
            className="rounded-xl p-5 space-y-4"
            style={{
              border: "1px solid color-mix(in srgb, var(--danger) 22%, transparent)",
              background: "color-mix(in srgb, var(--danger) 4%, transparent)",
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-medium text-[var(--text-primary)] mb-1">Archive every student</h3>
                <p className="text-sm text-[var(--text-secondary)] max-w-[46ch]">
                  Marks all of your students archived. They leave the roster, the dashboard and every
                  list. Nothing is destroyed: their fee history, receipts and attendance are exactly
                  where they were, and you can bring any student back from the Students screen.
                </p>
              </div>
              {step === "idle" ? (
                <button
                  type="button"
                  onClick={() => {
                    closeDeleteFlow();
                    setStep("step1");
                  }}
                  className="neumo-raised px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold text-[var(--danger)] cursor-pointer transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
                >
                  Archive all students…
                </button>
              ) : (
                <button
                  type="button"
                  onClick={closeDeleteFlow}
                  className="px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-[var(--text-secondary)] cursor-pointer transition-colors hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
              )}
            </div>

            {step !== "idle" && (
              <div className="space-y-4 border-t border-[var(--border-default)] pt-4" role="group" aria-label="Archive every student, step by step">
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  Step {step === "step1" ? 1 : step === "step2" ? 2 : 3} of 3
                </p>

                {step === "step1" && (
                  <div>
                    <label htmlFor="archive-first-word" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Type <strong className="text-[var(--text-primary)]">DELETE</strong> to confirm
                    </label>
                    <input
                      id="archive-first-word"
                      type="text"
                      value={firstWord}
                      onChange={(e) => setFirstWord(e.target.value)}
                      placeholder="DELETE"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={firstWord.length > 0 && !firstWordOk ? true : undefined}
                      className={`${inputCls} font-mono`}
                    />
                    {firstWord.length > 0 && !firstWordOk && (
                      <p className="text-[var(--danger)] text-xs mt-2">The word must be exactly DELETE.</p>
                    )}
                    <button
                      type="button"
                      disabled={!firstWordOk}
                      onClick={() => setStep("step2")}
                      className="mt-3 neumo-raised px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors hover:brightness-110"
                    >
                      Continue
                    </button>
                  </div>
                )}

                {step === "step2" && (
                  <div>
                    <label htmlFor="archive-pin" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Your app PIN
                    </label>
                    <input
                      id="archive-pin"
                      type="password"
                      value={pin}
                      onChange={(e) => {
                        setPin(e.target.value);
                        setDeleteError(null);
                      }}
                      inputMode="numeric"
                      maxLength={PIN_INPUT_MAX_LENGTH}
                      autoComplete="off"
                      placeholder="Your PIN"
                      aria-invalid={pin.length > 0 && !pinOk ? true : undefined}
                      className={`${inputCls} sm:w-56 text-center tracking-[0.4em] font-mono`}
                    />
                    {pin.length > 0 && !pinOk && (
                      <p className="text-[var(--danger)] text-xs mt-2">
                        A PIN is 4 to 8 digits.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={!pinOk}
                      onClick={() => setStep("step3")}
                      className="mt-3 neumo-raised px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors hover:brightness-110"
                    >
                      Continue
                    </button>
                  </div>
                )}

                {step === "step3" && (
                  <div>
                    <label htmlFor="archive-second-word" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Type <strong className="text-[var(--text-primary)]">DELETE</strong> again to confirm
                    </label>
                    <input
                      id="archive-second-word"
                      type="text"
                      value={secondWord}
                      onChange={(e) => setSecondWord(e.target.value)}
                      placeholder="DELETE"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={secondWord.length > 0 && !secondWordOk ? true : undefined}
                      className={`${inputCls} font-mono`}
                    />
                    {secondWord.length > 0 && !secondWordOk && (
                      <p className="text-[var(--danger)] text-xs mt-2">The word must be exactly DELETE.</p>
                    )}
                    <button
                      type="button"
                      disabled={!secondWordOk || deleteMutation.isPending}
                      aria-busy={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate()}
                      className={cn(
                        "mt-3 neumo-raised w-full sm:w-auto px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors",
                        secondWordOk
                          ? "text-[var(--accent-on-primary)] bg-[var(--danger)] cursor-pointer hover:brightness-110"
                          : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-60 cursor-not-allowed",
                      )}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      {deleteMutation.isPending ? "Archiving…" : "Archive every student"}
                    </button>
                  </div>
                )}

                {deleteError && (
                  <p role="alert" className="text-[var(--danger)] text-sm font-semibold">{deleteError}</p>
                )}
              </div>
            )}
          </div>

          {/* ---- delete the account (irreversible) ---- */}
          <div
            className="rounded-xl p-5 space-y-4"
            style={{
              border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
              background: "color-mix(in srgb, var(--danger) 7%, transparent)",
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-medium text-[var(--text-primary)] mb-1">Close your account</h3>
                <p className="text-sm text-[var(--text-secondary)] max-w-[46ch]">
                  Destroys your authentication record and deletes every student, fee, receipt and
                  attendance row for this account. There is no undo, no recovery window and no
                  support that can bring it back. If you are unsure, take a backup first and come
                  back to it later.
                </p>
              </div>
              {!accountOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(true);
                    setAccountError(null);
                    setAccountWord("");
                    setAccountPin("");
                  }}
                  className="neumo-raised px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold text-[var(--danger)] cursor-pointer transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
                >
                  Close my account…
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    setAccountError(null);
                    setAccountWord("");
                    setAccountPin("");
                  }}
                  className="px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-[var(--text-secondary)] cursor-pointer transition-colors hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
              )}
            </div>

            {accountOpen && (
              <div className="space-y-4 border-t border-[var(--border-default)] pt-4" role="group" aria-label="Close your account">
                <div className="flex gap-3">
                  <AlertOctagon className="w-5 h-5 text-[var(--danger)] shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-[var(--danger)]">
                    This is the one action in the app with no way back. Your audit trail survives as
                    a record that the account existed; everything else goes.
                  </p>
                </div>

                <div>
                  <label htmlFor="account-confirm-word" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Type <strong className="text-[var(--text-primary)]">DELETE MY ACCOUNT FOREVER</strong>
                  </label>
                  <input
                    id="account-confirm-word"
                    type="text"
                    value={accountWord}
                    onChange={(e) => setAccountWord(e.target.value)}
                    placeholder="DELETE MY ACCOUNT FOREVER"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={accountWord.length > 0 && !accountWordOk ? true : undefined}
                    className={`${inputCls} font-mono`}
                  />
                  {accountWord.length > 0 && !accountWordOk && (
                    <p className="text-[var(--danger)] text-xs mt-2">
                      The phrase must be exactly DELETE MY ACCOUNT FOREVER.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="account-pin" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Your app PIN
                  </label>
                  <input
                    id="account-pin"
                    type="password"
                    value={accountPin}
                    onChange={(e) => {
                      setAccountPin(e.target.value);
                      setAccountError(null);
                    }}
                    inputMode="numeric"
                    maxLength={PIN_INPUT_MAX_LENGTH}
                    autoComplete="off"
                    placeholder="Your PIN"
                    aria-invalid={accountPin.length > 0 && !accountPinOk ? true : undefined}
                    className={`${inputCls} sm:w-56 text-center tracking-[0.4em] font-mono`}
                  />
                  {accountPin.length > 0 && !accountPinOk && (
                    <p className="text-[var(--danger)] text-xs mt-2">A PIN is 4 to 8 digits.</p>
                  )}
                </div>

                {accountError && (
                  <p role="alert" className="text-[var(--danger)] text-sm font-semibold">{accountError}</p>
                )}

                <button
                  type="button"
                  disabled={!accountWordOk || !accountPinOk || deleteAccountMutation.isPending}
                  aria-busy={deleteAccountMutation.isPending}
                  onClick={() => deleteAccountMutation.mutate()}
                  className={cn(
                    "neumo-raised w-full sm:w-auto px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors",
                    accountWordOk && accountPinOk
                      ? "text-[var(--accent-on-primary)] bg-[var(--danger)] cursor-pointer hover:brightness-110"
                      : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-60 cursor-not-allowed",
                  )}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  {deleteAccountMutation.isPending ? "Closing…" : "Close my account for good"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
