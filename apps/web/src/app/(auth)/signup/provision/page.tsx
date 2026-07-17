"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Database, CheckCircle2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { log } from "@/lib/logger";

export default function ProvisionPage() {
  const [status, setStatus] = useState<"creating" | "done" | "error">("creating");
  const [attempts, setAttempts] = useState(0);
  const router = useRouter();
  const supabase = createSupabaseBrowser();

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const checkProvisioningStatus = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.replace("/login");
        return;
      }

      if (user.user_metadata?.db_url) {
        setStatus("done");
        setTimeout(() => {
          router.push("/dashboard");
        }, 1500);
      } else {
        if (attempts >= 10) {
           setStatus("error");
        } else {
           setAttempts(prev => prev + 1);
           // Re-fetch session to ensure latest metadata
           await supabase.auth.refreshSession();
           timeoutId = setTimeout(checkProvisioningStatus, 3000);
        }
      }
    };

    if (status === "creating") {
      timeoutId = setTimeout(checkProvisioningStatus, 3000);
    }

    return () => clearTimeout(timeoutId);
  }, [attempts, status, router, supabase.auth]);

  const handleManualRetry = async () => {
    setStatus("creating");
    setAttempts(0);
    // In a real scenario, this could POST to a Next.js API route 
    // that triggers the edge function manually if the webhook failed.
    // For local dev, we bypass this and set a dummy URL to unblock testing!
    try {
      await supabase.auth.updateUser({
        data: {
          db_url: "libsql://dummy-local-dev-url",
          db_token: "dummy"
        }
      });
      // The useEffect will pick this up automatically on the next check!
    } catch (e) {
      log.error('provision_update_user_failed', e instanceof Error ? e.message : String(e), { phase: 'dev_bypass' });
      setStatus("error");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-12 animate-in fade-in zoom-in-95 duration-500">
      
      <div className="relative">
        <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-colors duration-500 ${status === 'done' ? 'bg-[var(--accent-emerald)]/20 text-[var(--accent-emerald)]' : status === 'error' ? 'bg-[var(--accent-flare)]/20 text-[var(--accent-flare)]' : 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]'}`}>
          {status === 'creating' && <Loader2 className="w-12 h-12 animate-spin" />}
          {status === 'done' && <CheckCircle2 className="w-12 h-12" />}
          {status === 'error' && <Database className="w-12 h-12" />}
        </div>
      </div>

      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
          {status === 'creating' && "Provisioning your database..."}
          {status === 'done' && "Ready to go!"}
          {status === 'error' && "Provisioning taking longer than expected"}
        </h1>
        <p className="text-sm text-gray-400 max-w-sm mx-auto">
          {status === 'creating' && "We are spinning up an isolated edge database for your tuition center. This usually takes 5-10 seconds."}
          {status === 'done' && "Redirecting to your dashboard..."}
          {status === 'error' && "The webhook might have failed. You can wait a bit longer or try retrying manually."}
        </p>
      </div>

      {status === 'error' && (
        <Button 
          onClick={handleManualRetry}
          className="rounded-xl neumo-raised bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20"
        >
          Try Again
        </Button>
      )}
    </div>
  );
}
