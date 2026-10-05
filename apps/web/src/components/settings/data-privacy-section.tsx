"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteTenantDataAction, updateSettingAction, deleteAccountAction } from "@/server/actions/settings";
import { Trash2, AlertOctagon, ShieldAlert, Archive } from "lucide-react";
import { cn } from "@/lib/utils";

import type { Settings } from "@/types/settings";

interface DataPrivacySectionProps {
  settings: Settings;
}

export function DataPrivacySection({ settings }: DataPrivacySectionProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState("");
  const [pin, setPin] = useState("");
  
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [typedConfirmAccount, setTypedConfirmAccount] = useState("");
  const [accountPin, setAccountPin] = useState("");
  
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string, value: unknown }) => {
      await updateSettingAction(field, value);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] })
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await deleteTenantDataAction(pin);
      // Surface the typed Result as a thrown error — otherwise a wrong PIN
      // resolves silently and the UI never explains the failure (Rule 9).
      if (!res.success) throw new Error(res.error || "Failed to delete data");
      return res;
    },
    onSuccess: (res) => {
      if (res.success) {
        queryClient.clear();
        window.location.href = '/'; 
      }
    }
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await deleteAccountAction(accountPin);
      if (!res.success) throw new Error(res.error || "Failed to delete account");
      return res;
    },
    onSuccess: (res) => {
      if (res.success) {
        queryClient.clear();
        window.location.href = '/login';
      }
    }
  });

  const isValid = typedConfirm === "DELETE" && pin.length >= 4;
  const isAccountValid = typedConfirmAccount === "DELETE MY ACCOUNT FOREVER" && accountPin.length >= 4;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = settings as any;
  const autoArchiveInactiveDays = s?.auto_archive_inactive_days ?? s?.autoArchiveInactiveDays ?? 90;

  return (
    <div className="space-y-8 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-[var(--text-secondary)]" />
          Data Management
        </h3>
        
        <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4 glass-card p-5 rounded-xl border border-[var(--border-default)]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[var(--info)]/10 flex items-center justify-center shrink-0">
              <Archive className="w-6 h-6 text-[var(--info)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Auto-Archive Inactive Students</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Automatically archive students who haven&apos;t attended.</p>
            </div>
          </div>
          
          <div className="relative w-full sm:w-44">
            <select
              value={autoArchiveInactiveDays}
              onChange={(e) => updateMutation.mutate({ field: "autoArchiveInactiveDays", value: parseInt(e.target.value) })}
              aria-label="Auto-archive inactive students after"
              className="neumo-inset w-full pl-4 pr-10 py-3 text-sm text-[var(--text-primary)] rounded-xl appearance-none cursor-pointer focus:outline-none focus:border-[var(--info)] focus:ring-1 focus:ring-[var(--info)]"
            >
              <option value={30} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">After 30 days</option>
              <option value={60} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">After 60 days</option>
              <option value={90} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">After 90 days</option>
              <option value={180} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">After 180 days</option>
              <option value={0} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Never</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
              <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Danger Zone</h2>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-4">
          Destructive actions that cannot be easily undone. Proceed with caution.
        </p>

        <div className="border border-[var(--danger)]/20 rounded-xl p-6 bg-white/[0.01]">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h3 className="text-base font-medium text-[var(--text-primary)] mb-1">Delete All Data</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Permanently remove all students, attendance records, and ledger entries from this device. 
                This action requires your security PIN.
              </p>
            </div>
            
            {!isDeleting ? (
              <button 
                onClick={() => setIsDeleting(true)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-[var(--danger)] btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--danger)_35%,transparent)] transition-all cursor-pointer shrink-0"
              >
                Delete Data...
              </button>
            ) : (
              <button 
                onClick={() => { setIsDeleting(false); setTypedConfirm(""); setPin(""); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-[var(--text-muted)] btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] transition-all cursor-pointer shrink-0"
              >
                Cancel
              </button>
            )}
          </div>

          {isDeleting && (
            <div className="mt-6 pt-6 border-t border-[var(--danger)]/10 space-y-6 animate-in fade-in slide-in-from-top-4">
              <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-xl p-4 flex gap-4">
                <AlertOctagon className="w-5 h-5 text-[var(--danger)] shrink-0 mt-0.5" />
                <div className="text-sm text-[var(--danger)]">
                  <p className="font-bold mb-1">This is a destructive action</p>
                  <p>If you haven&apos;t backed up recently, this data will be lost forever.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Type <strong>DELETE</strong> to confirm
                  </label>
                  <input 
                    type="text" 
                    value={typedConfirm}
                    onChange={(e) => setTypedConfirm(e.target.value)}
                    placeholder="DELETE"
                    className="glass-input w-full px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--danger)] focus:ring-1 focus:ring-[var(--danger)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Security PIN
                  </label>
                  <input 
                    type="password" 
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    maxLength={4}
                    placeholder="••••"
                    className="glass-input w-full sm:w-48 px-4 py-3 text-xl text-center tracking-[1em] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-primary)]/20 focus:outline-none focus:border-[var(--danger)] focus:ring-1 focus:ring-[var(--danger)]"
                  />
                </div>
              </div>

              {deleteMutation.error && (
                <p className="text-[var(--danger)] text-xs">{deleteMutation.error.message}</p>
              )}

              <button 
                onClick={() => deleteMutation.mutate()}
                disabled={!isValid || deleteMutation.isPending}
                className={cn(
                  "w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                  isValid 
                    ? "bg-[var(--danger)]/20 text-[var(--danger)] border border-[var(--danger)] hover:bg-[var(--danger)]/40 shadow-[0_0_15px_color-mix(in_oklch,var(--danger)_20%,transparent)] cursor-pointer" 
                    : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-70 cursor-not-allowed shadow-none border border-[var(--border-default)]"
                )}
              >
                <Trash2 className="w-4 h-4" />
                {deleteMutation.isPending ? "Deleting..." : "Permanently Delete Data"}
              </button>
            </div>
          )}
        </div>

        <div className="border border-[var(--danger)]/25 rounded-xl p-6 bg-white/[0.01] mt-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h3 className="text-base font-medium text-[var(--text-primary)] mb-1">Delete Account Forever</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Permanently close your BuddySaradhi account and destroy all databases, backups, and settings. This cannot be undone. This action requires your security PIN.
              </p>
            </div>
            {!isDeletingAccount ? (
              <button 
                onClick={() => setIsDeletingAccount(true)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-[var(--danger)] btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--danger)_35%,transparent)] transition-all cursor-pointer shrink-0"
              >
                Delete Account...
              </button>
            ) : (
              <button 
                onClick={() => { setIsDeletingAccount(false); setTypedConfirmAccount(""); setAccountPin(""); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-[var(--text-muted)] btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] transition-all cursor-pointer shrink-0"
              >
                Cancel
              </button>
            )}
          </div>

          {isDeletingAccount && (
            <div className="mt-6 pt-6 border-t border-[var(--danger)]/10 space-y-6 animate-in fade-in slide-in-from-top-4">
              <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-xl p-4 flex gap-4">
                <AlertOctagon className="w-5 h-5 text-[var(--danger)] shrink-0 mt-0.5" />
                <div className="text-sm text-[var(--danger)]">
                  <p className="font-bold mb-1">Warning: Irreversible action</p>
                  <p>Deleting your account will permanently delete your authentication record and wipe clean all subscription configurations. There is no recovery option.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Type <strong>DELETE MY ACCOUNT FOREVER</strong> to confirm
                  </label>
                  <input 
                    type="text" 
                    value={typedConfirmAccount}
                    onChange={(e) => setTypedConfirmAccount(e.target.value)}
                    placeholder="DELETE MY ACCOUNT FOREVER"
                    className="glass-input w-full px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--danger)] focus:ring-1 focus:ring-[var(--danger)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Security PIN
                  </label>
                  <input 
                    type="password" 
                    value={accountPin}
                    onChange={(e) => setAccountPin(e.target.value)}
                    maxLength={4}
                    placeholder="••••"
                    aria-label="Security PIN for account deletion"
                    className="glass-input w-full sm:w-48 px-4 py-3 text-xl text-center tracking-[1em] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-primary)]/20 focus:outline-none focus:border-[var(--danger)] focus:ring-1 focus:ring-[var(--danger)]"
                  />
                </div>
              </div>

              {deleteAccountMutation.error && (
                <p className="text-[var(--danger)] text-xs">{(deleteAccountMutation.error as Error).message}</p>
              )}

              <button 
                onClick={() => deleteAccountMutation.mutate()}
                disabled={!isAccountValid || deleteAccountMutation.isPending}
                className={cn(
                  "w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                  isAccountValid 
                    ? "bg-[var(--danger)]/20 text-[var(--danger)] border border-[var(--danger)] hover:bg-[var(--danger)]/40 shadow-[0_0_15px_color-mix(in_oklch,var(--danger)_20%,transparent)] cursor-pointer" 
                    : "bg-[var(--surface-inset)] text-[var(--text-muted)] opacity-70 cursor-not-allowed shadow-none border border-[var(--border-default)]"
                )}
              >
                <Trash2 className="w-4 h-4" />
                {deleteAccountMutation.isPending ? "Closing Account..." : "Confirm Delete Account"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
