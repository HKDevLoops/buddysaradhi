"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { FcGoogle } from "react-icons/fc";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const router = useRouter();

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccessMsg("");

    try {
      const target = e.target as HTMLFormElement;
      const formEmail = email || (target.elements.namedItem("email") as HTMLInputElement)?.value || "";
      const formPassword = password || (target.elements.namedItem("password") as HTMLInputElement)?.value || "";

      if (!formEmail || !formPassword) {
        setError("Please enter your email and password.");
        setLoading(false);
        return;
      }

      const supabase = createSupabaseBrowser();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: formEmail,
        password: formPassword,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
      } else {
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred. Is your environment configured?");
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoadingGoogle(true);
    setError("");
    setSuccessMsg("");
    try {
      const supabase = createSupabaseBrowser();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/callback`,
        },
      });

      if (signInError) {
        setError(signInError.message);
        setLoadingGoogle(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoadingGoogle(false);
    }
  };

  const isAnyLoading = loading || loadingGoogle;

  return (
    <div className="flex flex-col space-y-6 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Welcome Back</h1>
        <p className="text-sm text-gray-400 mt-2">Sign in to your tuition OS</p>
      </div>

      <div className="space-y-4">
        <Button 
          type="button" 
          onClick={handleGoogleLogin}
          disabled={isAnyLoading}
          className="w-full py-6 rounded-xl neumo-raised bg-[var(--bg-surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-glass-strong)] transition-colors flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {loadingGoogle ? <Loader2 className="w-5 h-5 animate-spin" /> : <FcGoogle className="w-5 h-5" />}
          Continue with Google
        </Button>

        <div className="flex items-center gap-4 py-2">
          <div className="flex-1 h-px bg-[var(--surface-glass-strong)]" />
          <span className="text-xs text-gray-500 uppercase font-medium tracking-wider">OR</span>
          <div className="flex-1 h-px bg-[var(--surface-glass-strong)]" />
        </div>

        <form onSubmit={handlePasswordLogin} className="space-y-4 text-left">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-gray-300 ml-1">Email</label>
            <input 
              id="email" 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tutor@example.com" 
              className="w-full px-4 py-3 bg-transparent text-[var(--text-primary)] placeholder-gray-500 rounded-xl neumo-inset focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald)]"
              required
              disabled={isAnyLoading}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-gray-300 ml-1">Password</label>
            <input 
              id="password" 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" 
              className="w-full px-4 py-3 bg-transparent text-[var(--text-primary)] placeholder-gray-500 rounded-xl neumo-inset focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald)]"
              required
              disabled={isAnyLoading}
            />
          </div>

          {error && <p className="text-sm text-[var(--accent-flare)] text-left">{error}</p>}
          {successMsg && <p className="text-sm text-[var(--accent-emerald)] text-left">{successMsg}</p>}

          <div className="pt-2">
            <Button 
              type="submit" 
              disabled={isAnyLoading}
              className="w-full py-6 rounded-xl neumo-raised bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] hover:bg-[var(--accent-emerald)]/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
            </Button>
          </div>
        </form>
      </div>

      <div className="text-sm text-gray-400">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-[var(--accent-cyan)] hover:underline">
          Sign up
        </Link>
      </div>
    </div>
  );
}
