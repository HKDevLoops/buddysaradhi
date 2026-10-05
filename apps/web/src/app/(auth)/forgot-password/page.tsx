"use client";

export const dynamic = "force-static";

// Implements: web/03_Auth_and_Provisioning.md §1 (Supabase-owned reset);
// 10_Security.md §11 (rate-limited reset requests); RFC-003 §1 G-AUTH.

import React, { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { requestPasswordResetAction } from "@/server/actions/auth";

// Client-side resend friction (the server action enforces the real
// 5-per-15min throttle per IP+email; this only stops double-clicks).
const RESEND_COOLDOWN_MS = 60_000;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccessMsg("");

    if (!email) {
      setError("Please enter your email address.");
      setLoading(false);
      return;
    }

    if (Date.now() < cooldownUntil) {
      setError("Please wait a minute before requesting another reset link.");
      setLoading(false);
      return;
    }

    try {
      const res = await requestPasswordResetAction({ email, redirectTo: "/reset-password" });
      if (!res.success) {
        setError(res.error || "Could not send the reset link. Try again later.");
        if (res.code === "RATE_LIMITED") {
          setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
        }
      } else {
        // Generic either way — no account enumeration (10_Security.md §2).
        setSuccessMsg("Check your email for the password reset link.");
        setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
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
        <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Forgot Password</h1>
        <p className="text-sm text-text-muted mt-2">Enter your email and we will send a recovery link</p>
      </div>

      <div className="space-y-4 text-left">
        <form onSubmit={handleResetRequest} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="reset-email" className="text-sm font-medium text-text-secondary ml-1">Email Address</label>
            <input 
              id="reset-email" 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tutor@example.com" 
              className="w-full px-4 py-3 bg-transparent text-[var(--text-primary)] placeholder-text-muted rounded-xl neumo-inset focus:outline-none focus:ring-1 focus:ring-[var(--info)]"
              required
              disabled={loading}
            />
          </div>

          {error && <p role="alert" className="text-sm text-[var(--danger)] text-left font-semibold">{error}</p>}
          {successMsg && <p className="text-sm text-[var(--success)] text-left font-semibold">{successMsg}</p>}

          <div className="pt-2">
            <Button 
              type="submit" 
              disabled={loading || !email || Date.now() < cooldownUntil}
              className="w-full py-6 rounded-xl neumo-raised bg-[var(--info)]/10 text-[var(--info)] hover:bg-[var(--info)]/25 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send Reset Link"}
            </Button>
          </div>
        </form>
      </div>

      <div className="text-sm text-text-muted flex items-center justify-center gap-2 pt-2">
        <ArrowLeft className="w-4 h-4 text-text-muted" />
        <Link href="/login" className="text-[var(--info)] underline hover:text-[var(--info)]/80">
          Back to Login
        </Link>
      </div>
    </div>
  );
}
