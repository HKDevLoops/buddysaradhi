"use client";

import React, { useActionState } from "react";
import { adminLoginAction } from "../actions";
import { Shield, Key, User, Loader2 } from "lucide-react";

export default function AdminLoginPage() {
  const [state, formAction, isPending] = useActionState(adminLoginAction, null);
  
  return (
    <main className="relative min-h-screen w-full flex items-center justify-center bg-[#060414] px-6">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[20%] left-[10%] w-[35vw] h-[35vw] rounded-full filter blur-[120px] opacity-[0.1] bg-[#00FF9D]" />
        <div className="absolute bottom-[20%] right-[10%] w-[35vw] h-[35vw] rounded-full filter blur-[120px] opacity-[0.1] bg-[#00F0FF]" />
      </div>
      
      <div className="relative z-10 w-full max-w-md glass-strong border border-[var(--border-glass)]/25 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-heading)]">Admin Portal</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">BuddySaradhi Core Subscription Management</p>
        </div>
        
        <form action={formAction} className="space-y-4">
          {state?.error && (
            <div className="p-3 bg-[var(--accent-flare)]/10 border border-[var(--accent-flare)]/30 rounded-xl text-xs text-[var(--accent-flare)] text-center">
              {state.error}
            </div>
          )}
          
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Username</label>
            <div className="relative">
              <input
                type="text"
                name="username"
                required
                placeholder="hkdevs"
                className="w-full pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] bg-[#141225]/50 border border-[var(--border-glass)] rounded-xl outline-none focus:border-[var(--accent-emerald)] transition"
              />
              <User className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-3.5" />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <input
                type="password"
                name="password"
                required
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] bg-[#141225]/50 border border-[var(--border-glass)] rounded-xl outline-none focus:border-[var(--accent-emerald)] transition"
              />
              <Key className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-3.5" />
            </div>
          </div>
          
          <button
            type="submit"
            disabled={isPending}
            className="w-full py-3.5 rounded-xl text-sm font-bold text-[var(--accent-emerald)] bg-[var(--accent-emerald)]/10 border border-[var(--accent-emerald)]/25 shadow-[0_0_12px_rgba(0,255,157,0.15)] hover:bg-[var(--accent-emerald)]/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-6 transition"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying Credentials...
              </>
            ) : (
              "Authorize Login"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
