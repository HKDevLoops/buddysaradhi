"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteTenantDataAction } from "@/server/actions/settings";
import { Trash2, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";


export function SecurityPanel() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState("");
  const [pin, setPin] = useState("");
  
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteTenantDataAction(pin),
    onSuccess: (res) => {
      if (res.success) {
        queryClient.clear();
        window.location.href = '/'; // Reset app state visually for mockup
      }
    }
  });

  const isValid = typedConfirm === "DELETE" && pin.length >= 4;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Danger Zone</h2>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">
          Destructive actions that cannot be easily undone. Proceed with caution.
        </p>
      </div>

      <div className="border border-[var(--accent-flare)]/20 rounded-xl p-6 bg-white/[0.01]">
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
              className="neumo-raised px-4 py-2 rounded-lg text-sm font-medium text-[var(--accent-flare)] hover:bg-[var(--accent-flare)]/10 transition-colors shrink-0"
            >
              Delete Data...
            </button>
          ) : (
            <button 
              onClick={() => { setIsDeleting(false); setTypedConfirm(""); setPin(""); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            >
              Cancel
            </button>
          )}
        </div>

        {isDeleting && (
          <div className="mt-6 pt-6 border-t border-[var(--accent-flare)]/10 space-y-6 animate-in fade-in slide-in-from-top-4">
            <div className="bg-[var(--accent-flare)]/10 border border-[var(--accent-flare)]/30 rounded-xl p-4 flex gap-4">
              <AlertOctagon className="w-5 h-5 text-[var(--accent-flare)] shrink-0 mt-0.5" />
              <div className="text-sm text-[var(--accent-flare)]">
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
                  className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-flare)]"
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
                  className="neumo-inset w-full sm:w-48 bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-xl text-center tracking-[1em] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-primary)]/20 focus:outline-none focus:border-[var(--accent-flare)]"
                />
              </div>
            </div>

            {mutation.error && (
              <p className="text-[var(--accent-flare)] text-xs">{mutation.error.message}</p>
            )}

            <button 
              onClick={() => mutation.mutate()}
              disabled={!isValid || mutation.isPending}
              className={cn(
                "w-full neumo-raised py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                isValid 
                  ? "bg-[var(--accent-flare)]/20 text-[var(--accent-flare)] hover:bg-[var(--accent-flare)]/40 shadow-[0_0_15px_rgba(255,51,102,0.2)]" 
                  : "bg-[var(--bg-surface-inset)] text-[var(--text-muted)] opacity-70 cursor-not-allowed shadow-none"
              )}
            >
              <Trash2 className="w-4 h-4" />
              {mutation.isPending ? "Deleting..." : "Permanently Delete Data"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
