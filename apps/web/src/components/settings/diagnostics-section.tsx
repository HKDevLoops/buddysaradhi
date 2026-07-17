"use client";

import { Activity, Database, WifiOff, CloudOff } from "lucide-react";

export function DiagnosticsSection() {
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
    } catch (err) {
      console.error("Failed to export logs", err);
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
          <div className="glass-card p-5 rounded-xl border border-[var(--accent-emerald)]/20 text-center">
            <Database className="w-6 h-6 text-[var(--accent-emerald)] mx-auto mb-2" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">4.2 MB</p>
            <p className="text-xs text-[var(--text-muted)]">Local Database Size</p>
          </div>
          
          <div className="glass-card p-5 rounded-xl border border-[var(--accent-emerald)]/20 text-center">
            <WifiOff className="w-6 h-6 text-[var(--accent-emerald)] mx-auto mb-2" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">0</p>
            <p className="text-xs text-[var(--text-muted)]">Offline Mutations Pending</p>
          </div>
          
          <div className="glass-card p-5 rounded-xl border border-[var(--accent-emerald)]/20 text-center">
            <CloudOff className="w-6 h-6 text-[var(--accent-emerald)] mx-auto mb-2" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">OK</p>
            <p className="text-xs text-[var(--text-muted)]">Sync Status</p>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)]">Debug Logs</h3>
        <div className="glass-card p-4 rounded-xl border border-[var(--border-glass)]">
          <pre className="text-xs text-[var(--text-muted)] font-mono overflow-auto h-48 bg-black/40 p-4 rounded-lg">
            [2026-07-08T11:20:01Z] [SYNC] Heartbeat OK
            [2026-07-08T11:21:45Z] [LEDGER] Created entry LE-2495-2
            [2026-07-08T11:22:10Z] [AUTH] Session extended
            [2026-07-08T11:24:32Z] [UI] Rendered Settings View
          </pre>
          <div className="mt-4 flex justify-end">
            <button 
              onClick={handleExportLogs}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-[var(--text-primary)] btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--accent-primary)] hover:border-[color-mix(in srgb,var(--accent-primary)_35%,transparent)] transition-all cursor-pointer"
            >
              Export Logs
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
