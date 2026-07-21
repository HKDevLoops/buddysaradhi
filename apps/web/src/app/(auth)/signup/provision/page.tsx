"use client";

// Implements: 18_Microservice_Architecture.md — provision-db client
// This page is shown when a user needs their database provisioned.
// It calls /api/provision which creates a real Turso DB and stores
// credentials in Supabase user_metadata, then refreshes the session.

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { log } from "@/lib/logger";

type ProvisionStatus = "checking" | "creating" | "done" | "error";

export default function ProvisionPage() {
  const [status, setStatus] = useState<ProvisionStatus>("checking");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const router = useRouter();
  const supabase = createSupabaseBrowser();

  const provision = async () => {
    setStatus("checking");
    setErrorMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      // Check if user is already provisioned (has a real, non-dummy db_url)
      const dbUrl = session.user.user_metadata?.db_url as string | undefined;
      if (
        dbUrl &&
        !dbUrl.includes("dummy-local-dev-url") &&
        !dbUrl.includes("file:")
      ) {
      // Already provisioned — just refresh session and hard-redirect
      // so the middleware reads the fresh session token from the cookie.
      await supabase.auth.refreshSession();
      setStatus("done");
      setTimeout(() => { window.location.href = '/dashboard'; }, 800);
      return;

      }

      setStatus("creating");

      // Call our provisioning API to create a real Turso DB
      const res = await fetch("/api/provision", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      const data = (await res.json()) as {
        success: boolean;
        message?: string;
        error?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Provisioning failed (HTTP ${res.status})`);
      }

      // Refresh the Supabase session so the new db_url/db_token land in the cookie
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        // Non-fatal: the metadata is stored, cookie refresh may take a moment
        log.warn("session_refresh_failed", refreshErr.message);
      }

      setStatus("done");
      // Hard navigation so the browser sends a fresh request with the
      // updated Supabase session cookie (which now contains db_url/db_token).
      setTimeout(() => { window.location.href = '/dashboard'; }, 1200);

    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown provisioning error";
      log.error("provision_page_failed", msg, { phase: "auto" });
      setErrorMessage(msg);
      setStatus("error");
    }
  };

  useEffect(() => {
    provision();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusConfig = {
    checking: {
      icon: <Loader2 className="w-12 h-12 animate-spin" />,
      color: "bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]",
      title: "Checking your workspace...",
      desc: "Just a moment while we verify your account.",
    },
    creating: {
      icon: <Loader2 className="w-12 h-12 animate-spin" />,
      color: "bg-[var(--accent-violet)]/20 text-[var(--accent-violet)]",
      title: "Provisioning your database...",
      desc: "We are spinning up an isolated edge database for your tuition center. This usually takes a few seconds.",
    },
    done: {
      icon: <CheckCircle2 className="w-12 h-12" />,
      color: "bg-[var(--accent-emerald)]/20 text-[var(--accent-emerald)]",
      title: "Ready to go!",
      desc: "Redirecting you to your dashboard...",
    },
    error: {
      icon: <AlertCircle className="w-12 h-12" />,
      color: "bg-[var(--accent-flare)]/20 text-[var(--accent-flare)]",
      title: "Provisioning failed",
      desc:
        errorMessage ||
        "Something went wrong while setting up your workspace. Please try again.",
    },
  };

  const cfg = statusConfig[status];

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-12 animate-in fade-in zoom-in-95 duration-500">
      <div className="relative">
        <div
          className={`w-24 h-24 rounded-full flex items-center justify-center transition-colors duration-500 ${cfg.color}`}
        >
          {cfg.icon}
        </div>
        {status === "creating" && (
          <div className="absolute inset-0 rounded-full border-2 border-[var(--accent-violet)]/30 animate-ping" />
        )}
      </div>

      <div className="text-center space-y-2 max-w-sm mx-auto">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
          {cfg.title}
        </h1>
        <p className="text-sm text-gray-400">{cfg.desc}</p>
      </div>

      {status === "creating" && (
        <div className="flex flex-col items-center gap-2 text-xs text-gray-500">
          <div className="flex gap-1">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-[var(--accent-violet)]/60 animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
          <span>Setting up your isolated workspace</span>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3">
          <Button
            onClick={provision}
            className="rounded-xl neumo-raised bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20 px-6"
          >
            Try Again
          </Button>
          <a
            href="mailto:support@buddysaradhi.app"
            className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2"
          >
            Contact support
          </a>
        </div>
      )}

      {status === "done" && (
        <div className="flex items-center gap-2 text-sm text-[var(--accent-emerald)]">
          <CheckCircle2 className="w-4 h-4" />
          <span>Database ready</span>
        </div>
      )}
    </div>
  );
}
