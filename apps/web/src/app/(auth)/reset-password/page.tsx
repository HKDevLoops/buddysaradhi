"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Loader2, ArrowLeft } from "lucide-react";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
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

    try {
      const supabase = createSupabaseBrowser();
      const { error: resetError } = await supabase.auth.updateUser({ password });

      if (resetError) {
        setError(resetError.message);
      } else {
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
        <ArrowLeft className="w-4 h-4 text-gray-500" />
        <Link href="/login" className="text-[var(--accent-cyan)] hover:underline">
          Back to Login
        </Link>
      </div>
    </div>
  );
}
