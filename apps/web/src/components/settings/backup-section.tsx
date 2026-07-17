"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createBackupAction } from "@/server/actions/settings";
import { HardDrive, Download, AlertTriangle, Key, Loader2 } from "lucide-react";

export function BackupSection() {
  const [passphrase, setPassphrase] = useState("");
  const [backupResult, setBackupResult] = useState<{ filename: string; mockBlobUrl: string } | null>(null);

  const mutation = useMutation({
    mutationFn: (pass: string) => createBackupAction(pass),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setBackupResult(res.data);
      }
    },
  });

  const handleDownload = () => {
    if (!backupResult) return;
    const a = document.createElement("a");
    a.href = backupResult.mockBlobUrl;
    a.download = backupResult.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const valid = passphrase.length >= 8;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Create Local Backup</h2>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">
          Your backup is encrypted locally using AES-256-GCM. We never see your passphrase, and we cannot recover your data if you lose it.
        </p>
      </div>

      <div className="bg-[var(--accent-amber)]/10 border border-[var(--accent-amber)]/20 rounded-xl p-4 flex gap-4">
        <AlertTriangle className="w-5 h-5 text-[var(--accent-amber)] shrink-0 mt-0.5" />
        <div className="text-sm text-[var(--accent-amber)]/90">
          <p className="font-medium mb-1">Store your passphrase securely</p>
          <p>Without this exact passphrase, restoring from this backup file will be mathematically impossible. Do not lose it.</p>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Encryption Passphrase</label>
          <div className="relative">
            <Key className="w-4 h-4 text-[var(--text-muted)] absolute left-4 top-3.5 pointer-events-none" />
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Min. 8 characters"
              aria-label="Encryption passphrase"
              className="neumo-inset w-full pl-11 pr-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-cyan)]"
            />
          </div>
          {mutation.error && <p className="text-[var(--accent-flare)] text-xs mt-2">{mutation.error.message}</p>}
        </div>

        <button
          type="button"
          onClick={() => mutation.mutate(passphrase)}
          disabled={!valid || mutation.isPending}
          className="py-3 px-6 rounded-xl text-sm font-bold text-[var(--accent-emerald)] border border-[var(--accent-emerald)] bg-[color-mix(in_srgb,var(--accent-emerald)_15%,transparent)] shadow-[0_0_14px_color-mix(in_srgb,var(--accent-emerald)_20%,transparent)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2 w-full sm:w-auto cursor-pointer transition-all"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><HardDrive className="w-4 h-4" /> Generate Backup</>}
        </button>
      </div>

      {backupResult && (
        <div className="mt-8 p-6 rounded-xl border border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/5 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">Backup Ready</h3>
              <p className="text-xs text-[var(--text-muted)] font-mono">{backupResult.filename}</p>
            </div>
            <button
              type="button"
              onClick={handleDownload}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--accent-cyan)] btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] transition-all flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" /> Download .bsb
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
