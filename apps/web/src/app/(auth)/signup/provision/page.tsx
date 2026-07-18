"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Database, CheckCircle2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { log } from "@/lib/logger";

export default function ProvisionPage() {
  const [status, setStatus] = useState<"creating" | "done" | "error">("creating");
  const router = useRouter();
  const supabase = createSupabaseBrowser();

  useEffect(() => {
    let active = true;

    const performProvision = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (active) router.replace("/login");
          return;
        }

        // If the user does not have db_url, provision them immediately!
        if (!user.user_metadata?.db_url) {
          const { error: updateError } = await supabase.auth.updateUser({
            data: {
              db_url: "libsql://dummy-local-dev-url",
              db_token: "dummy"
            }
          });
          if (updateError) throw updateError;
          
          // Refresh session to sync the updated metadata to the session cookie
          await supabase.auth.refreshSession();
        } else {
          // If metadata has db_url but they still landed here, refresh to sync cookie
          await supabase.auth.refreshSession();
        }

        if (active) {
          setStatus("done");
          setTimeout(() => {
            if (active) router.push("/dashboard");
          }, 1500);
        }
      } catch (e) {
        log.error('provision_immediate_failed', e instanceof Error ? e.message : String(e), { phase: 'immediate' });
        if (active) setStatus("error");
      }
    };

    performProvision();

    return () => {
      active = false;
    };
  }, [router, supabase.auth]);

  const handleManualRetry = async () => {
    setStatus("creating");
    try {
      await supabase.auth.updateUser({
        data: {
          db_url: "libsql://dummy-local-dev-url",
          db_token: "dummy"
        }
      });
      // Refresh session to sync the updated metadata to the session cookie
      await supabase.auth.refreshSession();
      
      setStatus("done");
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } catch (e) {
      log.error('provision_manual_retry_failed', e instanceof Error ? e.message : String(e), { phase: 'manual_retry' });
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
          {status === 'creating' && "We are spinning up an isolated edge database for your tuition center. This usually takes a moment."}
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
