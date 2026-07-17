"use client";

import { Upload, Download, FileJson, AlertCircle } from "lucide-react";

export function ImportExportSection() {
  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Download className="w-5 h-5 text-[var(--text-secondary)]" />
          Export Data
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button className="glass-card p-5 rounded-xl flex items-start gap-4 btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--accent-cyan)_35%,transparent)] text-left cursor-pointer transition-all">
            <div className="w-10 h-10 rounded-lg bg-[var(--accent-cyan)]/10 flex items-center justify-center shrink-0">
              <FileJson className="w-5 h-5 text-[var(--accent-cyan)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Export to JSON</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Download your entire unencrypted ledger and student data.</p>
            </div>
          </button>
          
          <button className="glass-card p-5 rounded-xl flex items-start gap-4 btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--accent-emerald)_35%,transparent)] text-left cursor-pointer transition-all">
            <div className="w-10 h-10 rounded-lg bg-[var(--accent-emerald)]/10 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5 text-[var(--accent-emerald)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Export to CSV</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Download flat files suitable for Excel or accounting software.</p>
            </div>
          </button>
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-[var(--text-secondary)]" />
          Import Data
        </h3>
        
        <div className="glass-card p-6 rounded-xl border border-[var(--border-glass)]">
          <div className="flex gap-4">
            <AlertCircle className="w-5 h-5 text-[var(--accent-amber)] shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Import from v1.x Backup</p>
              <p className="text-sm text-[var(--text-muted)] mb-4 leading-relaxed">
                You can import a `.bsb` backup file. This will merge the backup with your existing data.
                Conflicts will be resolved by keeping the most recently modified record.
              </p>
              <button className="neumo-raised px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--accent-amber)] cursor-pointer">
                Select Backup File...
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
