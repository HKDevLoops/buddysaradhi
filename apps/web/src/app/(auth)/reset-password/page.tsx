"use client";

export const dynamic = "force-static";

// Implements: web/03_Auth_and_Provisioning.md §1 (recovery session owned by
// Supabase; token expiry per Supabase defaults — this page sets no custom
// expiry); 10_Security.md §8 (reset_completed audited); RFC-003 §1 G-AUTH.

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { auditAction } from "@/lib/logger";
import { Loader2, ArrowLeft } from "lucide-react";

// Client-side attempt friction (Supabase enforces the real token-attempt
// limits server-side; this only slows a casual retry loop).
const MAX_ATTEMPTS = 5;

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [attempts, setAttempts] = useState(0);
  const router = useRouter();

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccessMsg("");

    if (!password || !confirmPassword) {
      setError("Please fill in all password fields.");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }

    if (attempts >= MAX_ATTEMPTS) {
      setError("Too many attempts — request a fresh reset link and try again.");
      setLoading(false);
      return;
    }

    try {
      const supabase = createSupabaseBrowser();
      const { error: resetError } = await supabase.auth.updateUser({ password });

      if (resetError) {
        setAttempts((n) => n + 1);
        setError(resetError.message);
      } else {
        // Audited without PII (the logger never carries the password/token).
        auditAction("reset_completed");
        setSuccessMsg("Password successfully reset! Redirecting to login...");
        setTimeout(() => {
          router.push("/login");
        }, 2000);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col space-y-6 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Reset Password</h1>
        <p className="text-sm text-gray-400 mt-2">Enter your new password below</p>
      </div>

      <div className="space-y-4 text-left">
        <form onSubmit={handlePasswordReset} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="reset-newPassword" className="text-sm font-medium text-gray-300 ml-1">New Password</label>
            <input 
              id="reset-newPassword" 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" 
              className="w-full px-4 py-3 bg-transparent text-[var(--text-primary)] placeholder-gray-500 rounded-xl neumo-inset focus:outline-none focus:ring-1 focus:ring-[var(--accent-cyan)]"
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reset-confirmPassword" className="text-sm font-medium text-gray-300 ml-1">Confirm Password</label>
            <input 
              id="reset-confirmPassword" 
              type="password" 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••" 
              className="w-full px-4 py-3 bg-transparent text-[var(--text-primary)] placeholder-gray-500 rounded-xl neumo-inset focus:outline-none focus:ring-1 focus:ring-[var(--accent-cyan)]"
              required
              disabled={loading}
            />
          </div>

          {error && <p className="text-sm text-[var(--accent-flare)] text-left font-semibold">{error}</p>}
          {successMsg && <p className="text-sm text-[var(--accent-emerald)] text-left font-semibold">{successMsg}</p>}

          <div className="pt-2">
            <Button 
              type="submit" 
              disabled={loading || password.length < 8}
              className="w-full py-6 rounded-xl neumo-raised bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/25 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save New Password"}
            </Button>
          </div>
        </form>
      </div>

      <div className="text-sm text-gray-400 flex items-center justify-center gap-2 pt-2">
        <ArrowLeft className="w-4 h-4 text-gray-400" />
        <Link href="/login" className="text-[var(--accent-cyan)] underline hover:text-[var(--accent-cyan)]/80">
          Back to Login
        </Link>
      </div>
    </div>
  );
}
