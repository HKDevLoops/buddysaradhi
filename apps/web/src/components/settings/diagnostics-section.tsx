"use client";

// Implements: 01_Product_Principles.md P15 (honest states) + AGENTS.md §2 Rule 9
// (a failed or absent thing is stated, never faked) + Rule 10 (status is never
// colour alone, 44px targets, aria-live results, motion-safe transitions).
// Device-storage card: 08_Settings.md P5 (offline-first) — can the browser be
// asked to leave the tutor's offline records alone under disk pressure.
//
// WHAT THIS SECTION USED TO SHOW, AND WHY IT IS GONE:
//
//   "Local Database Size 4.2 MB"   ← a literal in the JSX. Not measured.
//   "Offline Mutations Pending 0"   ← a literal. Never counted.
//   "Sync Status OK"                ← a literal. Never checked.
//   A <pre> of four log lines      ← a literal, dated 2026-07-08, and the
//     with a "Export Logs" button     "Export Logs" button downloaded that
//                                    same literal string.
//
// Three tiles and a log viewer, every value hardcoded, on the one screen whose
// entire job is telling a tutor whether the app is lying to them. Rule 9 is not
// "log the error"; it is "do not show a tutor a number you invented". All of
// it is removed. What replaces it is measured (storage, which the browser
// reports), and for the rest the section says plainly that this build does not
// report it, rather than asserting something friendly.
//
// KNOWN GAP reported to the lead, not implemented here: 08 §6.2.12 lists five
// real Diagnostics controls (Run integrity check, Clear local cache, Force sync,
// View sync_outbox, Rebuild search index). Each needs a server action or engine
// call this lane does not own — an integrity check recomputes ledger tamper
// hashes (packages/core), force-sync drives the Sync Engine. Adding buttons
// that cannot work would be the same defect as the fake tiles.

import { useEffect, useState } from "react";
import { HardDrive, ShieldCheck, ShieldAlert, Info, LoaderCircle, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  estimateStorage,
  formatBytes,
  persistedState,
  requestPersistence,
} from "@/lib/storage-persist";
import type { PersistedState, StorageUsage } from "@/lib/storage-persist";

type StorageCardState = PersistedState | "checking";

interface PersistCardMeta {
  icon: LucideIcon;
  label: string;
  className: string;
  spin: boolean;
}

// Status is carried three ways — icon, words and tone — so it never depends on
// colour alone (Rule 10 / AP-14).
const STORAGE_STATE_META: Record<StorageCardState, PersistCardMeta> = {
  checking: { icon: LoaderCircle, label: "Checking storage", className: "text-[var(--text-muted)]", spin: true },
  persisted: { icon: ShieldCheck, label: "Kept on this device", className: "text-[var(--success)]", spin: false },
  "not-persisted": { icon: ShieldAlert, label: "Not kept yet", className: "text-[var(--warning)]", spin: false },
  unsupported: { icon: Info, label: "Not offered by this browser", className: "text-[var(--text-muted)]", spin: false },
};

export function DiagnosticsSection() {
  const toast = useToast();
  const [storageState, setStorageState] = useState<StorageCardState>("checking");
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadStorageStatus(): Promise<void> {
      const [state, estimate] = await Promise.all([persistedState(), estimateStorage()]);
      if (cancelled) return;
      setStorageState(state);
      setStorageUsage(estimate);
    }
    void loadStorageStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRequestPersistence = (): void => {
    if (requesting) return;
    setRequesting(true);
    void requestPersistence().then((result) => {
      setRequesting(false);
      if (result.success && result.outcome === "granted") {
        setStorageState("persisted");
        toast.success(
          "Kept on this device",
          "The browser will leave your offline records alone when space runs low.",
        );
        return;
      }
      if (result.success) {
        setStorageState("not-persisted");
        toast.warning(
          "Browser kept temporary storage",
          "Your data is still saved here. It may be removed if space runs very low.",
        );
        return;
      }
      if (result.outcome === "unavailable") {
        setStorageState("unsupported");
        toast.info(
          "Persistent storage unavailable",
          "This browser does not offer it. Your data is still saved on this device.",
        );
        return;
      }
      // A refusal is reported as a refusal, with the browser's own reason.
      setStorageState("not-persisted");
      toast.error("Could not ask the browser to keep data", result.message);
    });
  };

  const stateMeta = STORAGE_STATE_META[storageState];
  const StateIcon = stateMeta.icon;
  const usageText =
    storageUsage === null
      ? "Storage use is not reported by this browser."
      : storageUsage.quotaBytes === null
        ? `Using ${formatBytes(storageUsage.usageBytes)}. This browser does not say how much room there is.`
        : `Using ${formatBytes(storageUsage.usageBytes)} of about ${formatBytes(storageUsage.quotaBytes)} available to this site.`;

  const notReported = [
    "Ledger integrity check (recomputing every receipt hash)",
    "Pending sync rows and any that have hit a conflict",
    "Last successful sync time",
    "A log export",
  ];

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
          <Activity className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
          System Health
        </h3>
        <p className="text-sm text-[var(--text-secondary)] max-w-[68ch]">
          What this screen reports is measured. Where the app cannot measure something, it says so
          instead of printing a number that looks reassuring.
        </p>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
          <div className="flex items-center gap-3">
            <HardDrive className="w-5 h-5 text-[var(--text-secondary)] shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Space used by this site</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">{usageText}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <StateIcon
                className={`w-5 h-5 shrink-0 mt-0.5 ${stateMeta.spin ? "motion-safe:animate-spin" : ""}`}
                style={{ color: "currentColor" }}
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Will the browser keep your offline records?
                </p>
                <p className={`text-xs mt-1 ${stateMeta.className}`}>
                  {stateMeta.label}
                  {storageState === "checking" ? "…" : ""}
                </p>
              </div>
            </div>
            {storageState === "not-persisted" && (
              <button
                type="button"
                onClick={handleRequestPersistence}
                disabled={requesting}
                aria-busy={requesting}
                className="neumo-raised px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors hover:brightness-110 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
              >
                {requesting ? "Asking the browser…" : "Ask the browser to keep my data"}
              </button>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-3 max-w-[68ch]">
            Browsers clear site data when a device runs low on space. Asking marks this site&apos;s
            records as worth keeping. It is a request, not a guarantee, and the browser may still
            refuse.
          </p>
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div className="rounded-xl border border-[color-mix(in_srgb,var(--warning)_25%,transparent)] p-5" style={{ background: "color-mix(in srgb, var(--warning) 5%, transparent)" }}>
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Not reported in this build</h4>
        <p className="text-xs text-[var(--text-secondary)] mb-3 max-w-[68ch]">
          These are the checks this screen is meant to carry. They are not implemented, so nothing
          here reports them, and no button pretends to:
        </p>
        <ul className="space-y-1.5">
          {notReported.map((item) => (
            <li key={item} className="text-xs text-[var(--text-muted)] flex items-start gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--text-muted)] mt-3 max-w-[68ch]">
          Until they exist, your books are verifiable by hand: every receipt number appears once, the
          ledger never loses an entry, and a void shows up as a reversal beside the original.
        </p>
      </div>
    </section>
  );
}
