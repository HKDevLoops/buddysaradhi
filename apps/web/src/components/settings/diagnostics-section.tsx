"use client";

// Implements: 01_Product_Principles.md P5 (offline-first) + P15 (honest states)
// — Device storage card in Settings → Diagnostics: shows whether the browser
// will keep offline records under disk pressure, the estimated usage, and one
// action to request persistence. 13_UI_Guidelines.md §8 (glass-card surface,
// glass button idiom shared with Export Logs) + §10 (icon + text status, 44px
// target, aria-live result, motion-safe transitions).

import { useEffect, useState } from "react";
import { Activity, Database, WifiOff, CloudOff, HardDrive, ShieldCheck, ShieldAlert, Info, LoaderCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { log } from "@/lib/logger";
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

// Status is carried three ways (icon + text + tone) so it never depends on
// colour alone (Rule 10 / AP-14).
const STORAGE_STATE_META: Record<StorageCardState, PersistCardMeta> = {
  checking: {
    icon: LoaderCircle,
    label: "Checking storage…",
    className: "text-[var(--text-muted)]",
    spin: true,
  },
  persisted: {
    icon: ShieldCheck,
    label: "Kept on this device",
    className: "text-[var(--success)]",
    spin: false,
  },
  "not-persisted": {
    icon: ShieldAlert,
    label: "Not kept yet",
    className: "text-[var(--warning)]",
    spin: false,
  },
  unsupported: {
    icon: Info,
    label: "Not offered by this browser",
    className: "text-[var(--text-muted)]",
    spin: false,
  },
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
      if (!cancelled) {
        setStorageState(state);
        setStorageUsage(estimate);
      }
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
      toast.error("Could not request storage", result.message);
    });
  };

  const stateMeta = STORAGE_STATE_META[storageState];
  const StateIcon = stateMeta.icon;
  const usageText =
    storageUsage === null
      ? "Storage use is unknown on this browser."
      : storageUsage.quotaBytes === null
        ? `Using ${formatBytes(storageUsage.usageBytes)}.`
        : `Using ${formatBytes(storageUsage.usageBytes)} of about ${formatBytes(storageUsage.quotaBytes)}.`;

  const handleExportLogs = () => {
    try {
      const logs = `[2026-07-08T11:20:01Z] [SYNC] Heartbeat OK
[2026-07-08T11:21:45Z] [LEDGER] Created entry LE-2495-2
[2026-07-08T11:22:10Z] [AUTH] Session extended
[2026-07-08T11:24:32Z] [UI] Rendered Settings View`;
      const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(logs);
      const a = document.createElement("a");
      a.setAttribute("href", dataStr);
      a.setAttribute("download", `buddysaradhi_system_logs_${new Date().toISOString().slice(0, 10)}.txt`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      log.error("diagnostics_export_failed", "Failed to export logs");
    }
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-[var(--text-secondary)]" />
          System Health
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="glass-card p-5 rounded-xl border border-[var(--success)]/20 text-center">
            <Database className="w-6 h-6 text-[var(--success)] mx-auto mb-2" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">4.2 MB</p>
            <p className="text-xs text-[var(--text-muted)]">Local Database Size</p>
          </div>
          
          <div className="glass-card p-5 rounded-xl border border-[var(--success)]/20 text-center">
            <WifiOff className="w-6 h-6 text-[var(--success)] mx-auto mb-2" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">0</p>
            <p className="text-xs text-[var(--text-muted)]">Offline Mutations Pending</p>
          </div>
          
          <div className="glass-card p-5 rounded-xl border border-[var(--success)]/20 text-center">
            <CloudOff className="w-6 h-6 text-[var(--success)] mx-auto mb-2" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">OK</p>
            <p className="text-xs text-[var(--text-muted)]">Sync Status</p>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
          Device storage
        </h3>
        <div className="glass-card p-5 rounded-xl border border-[var(--border-default)] mt-4 space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Browsers may delete saved data when disk space runs low. Keeping data on
            this device asks the browser to leave your offline records alone.
          </p>
          <div aria-live="polite" className="flex items-center gap-2">
            <StateIcon
              className={`w-5 h-5 ${stateMeta.spin ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span className={`text-sm font-medium ${stateMeta.className}`}>{stateMeta.label}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">{usageText}</p>
          {storageState === "not-persisted" && (
            <button
              type="button"
              onClick={handleRequestPersistence}
              disabled={requesting}
              className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold text-[var(--text-primary)] btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--accent-primary)] hover:border-[color-mix(in srgb,var(--accent-primary)_35%,transparent)] motion-safe:transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {requesting ? "Requesting…" : "Keep data on this device"}
            </button>
          )}
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)]">Debug Logs</h3>
        <div className="glass-card p-4 rounded-xl border border-[var(--border-default)]">
          <pre className="text-xs text-[var(--text-muted)] font-mono overflow-auto h-48 bg-black/40 p-4 rounded-lg">
            [2026-07-08T11:20:01Z] [SYNC] Heartbeat OK
            [2026-07-08T11:21:45Z] [LEDGER] Created entry LE-2495-2
            [2026-07-08T11:22:10Z] [AUTH] Session extended
            [2026-07-08T11:24:32Z] [UI] Rendered Settings View
          </pre>
          <div className="mt-4 flex justify-end">
            <button 
              onClick={handleExportLogs}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-[var(--text-primary)] btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--accent-primary)] hover:border-[color-mix(in srgb,var(--accent-primary)_35%,transparent)] transition-all cursor-pointer"
            >
              Export Logs
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
